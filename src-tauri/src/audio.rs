use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc, Mutex,
};

use base64::{engine::general_purpose::STANDARD, Engine};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use futures_util::{SinkExt, StreamExt};
use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::{client::IntoClientRequest, Message},
};

// ── Scribe WebSocket endpoint ─────────────────────────────────────────────────

const SCRIBE_WS_URL: &str =
    "wss://api.elevenlabs.io/v1/speech-to-text/realtime\
     ?model_id=scribe_v2_realtime\
     &audio_format=pcm_16000\
     &commit_strategy=vad";

// ── Managed state ─────────────────────────────────────────────────────────────

pub struct CaptureSession {
    stop_flag:      Arc<AtomicBool>,
    task_handle:    tokio::task::AbortHandle,
    /// Keeps the cpal stream alive (stream is created inside this thread).
    _audio_thread:  std::thread::JoinHandle<()>,
}

pub struct AudioState(pub Mutex<Option<CaptureSession>>);

// ── Tauri events emitted to the frontend ──────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct TranscriptEvent {
    pub text:      String,
    pub committed: bool,
}

// ── cpal setup — stream lives entirely inside a background thread ─────────────
//
// cpal::Stream is !Send on Windows (it contains PhantomData<*mut ()>).
// The workaround: create the stream *inside* the thread so it never needs
// to cross a thread boundary.  A one-shot channel carries the native sample
// rate back to the caller.

fn start_audio_thread(
    stop_flag: Arc<AtomicBool>,
) -> Result<(mpsc::Receiver<Vec<f32>>, u32, std::thread::JoinHandle<()>), String> {
    let (pcm_tx, pcm_rx) = mpsc::sync_channel::<Vec<f32>>(256);
    // One-shot channel: thread sends (sample_rate, channels) or an error string.
    let (info_tx, info_rx) = mpsc::channel::<Result<u32, String>>();

    let sf = stop_flag.clone();
    let handle = std::thread::spawn(move || {
        // ── Device selection (platform-specific) ──────────────────────────────
        #[cfg(target_os = "windows")]
        let result: Result<(cpal::Stream, u32), String> = (|| {
            let host = cpal::host_from_id(
                cpal::available_hosts()
                    .into_iter()
                    .find(|id| *id == cpal::HostId::Wasapi)
                    .ok_or("WASAPI host not available")?,
            )
            .map_err(|e| e.to_string())?;

            let device = host
                .default_output_device()
                .ok_or("No default output device")?;
            let config = device
                .default_output_config()
                .map_err(|e| e.to_string())?;
            let sample_rate = config.sample_rate().0;
            let channels    = config.channels() as usize;
            let tx          = pcm_tx.clone();

            let stream = device
                .build_input_stream(
                    &config.into(),
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        let mono: Vec<f32> = data
                            .chunks(channels)
                            .map(|f| f.iter().sum::<f32>() / channels as f32)
                            .collect();
                        let _ = tx.try_send(mono);
                    },
                    |err| eprintln!("[audio] cpal: {err}"),
                    None,
                )
                .map_err(|e| e.to_string())?;

            stream.play().map_err(|e| e.to_string())?;
            Ok((stream, sample_rate))
        })();

        #[cfg(not(target_os = "windows"))]
        let result: Result<(cpal::Stream, u32), String> = (|| {
            let host    = cpal::default_host();
            let device  = host.default_input_device().ok_or("No input device")?;
            let config  = device.default_input_config().map_err(|e| e.to_string())?;
            let sample_rate = config.sample_rate().0;
            let channels    = config.channels() as usize;
            let tx          = pcm_tx.clone();

            let stream = device
                .build_input_stream(
                    &config.into(),
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        let mono: Vec<f32> = data
                            .chunks(channels)
                            .map(|f| f.iter().sum::<f32>() / channels as f32)
                            .collect();
                        let _ = tx.try_send(mono);
                    },
                    |err| eprintln!("[audio] cpal: {err}"),
                    None,
                )
                .map_err(|e| e.to_string())?;

            stream.play().map_err(|e| e.to_string())?;
            Ok((stream, sample_rate))
        })();

        match result {
            Err(e) => {
                let _ = info_tx.send(Err(e));
            }
            Ok((_stream, sample_rate)) => {
                let _ = info_tx.send(Ok(sample_rate));
                // _stream lives here — dropped when we exit the loop.
                while !sf.load(Ordering::Relaxed) {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                // _stream drops here → cpal stops capturing.
            }
        }
    });

    let sample_rate = info_rx
        .recv()
        .map_err(|_| "Audio thread exited before setup".to_string())??;

    Ok((pcm_rx, sample_rate, handle))
}

// ── Scribe streaming task ─────────────────────────────────────────────────────

async fn run_scribe(
    rx:          mpsc::Receiver<Vec<f32>>,
    source_rate: u32,
    api_key:     String,
    stop_flag:   Arc<AtomicBool>,
    app:         AppHandle,
) {
    if let Err(e) = scribe_inner(rx, source_rate, api_key, stop_flag, app.clone()).await {
        let _ = app.emit("buddy:capture_error", e);
    }
}

async fn scribe_inner(
    rx:          mpsc::Receiver<Vec<f32>>,
    source_rate: u32,
    api_key:     String,
    stop_flag:   Arc<AtomicBool>,
    app:         AppHandle,
) -> Result<(), String> {
    // ── Connect to Scribe WebSocket ───────────────────────────────────────────
    let mut request = SCRIBE_WS_URL
        .into_client_request()
        .map_err(|e| format!("WS request: {e}"))?;

    request.headers_mut().insert(
        "xi-api-key",
        api_key
            .parse()
            .map_err(|_| "Invalid API key characters".to_string())?,
    );

    let (ws_stream, _) = connect_async_with_config(request, None, false)
        .await
        .map_err(|e| format!("WebSocket connect: {e}"))?;

    let (mut ws_tx, mut ws_rx) = ws_stream.split();

    // ── Receive task (partial / committed transcripts) ────────────────────────
    let app_rx = app.clone();
    let recv_task = tokio::spawn(async move {
        while let Some(msg) = ws_rx.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                        match v["message_type"].as_str().unwrap_or("") {
                            "partial_transcript" => {
                                let _ = app_rx.emit(
                                    "buddy:transcript",
                                    TranscriptEvent {
                                        text:      v["text"].as_str().unwrap_or("").to_string(),
                                        committed: false,
                                    },
                                );
                            }
                            "committed_transcript" => {
                                let _ = app_rx.emit(
                                    "buddy:transcript",
                                    TranscriptEvent {
                                        text:      v["text"].as_str().unwrap_or("").to_string(),
                                        committed: true,
                                    },
                                );
                            }
                            "auth_error" | "quota_exceeded" | "unaccepted_terms_error" => {
                                let _ = app_rx.emit(
                                    "buddy:capture_error",
                                    v["error"]
                                        .as_str()
                                        .unwrap_or("Auth / quota error")
                                        .to_string(),
                                );
                            }
                            _ => {}
                        }
                    }
                }
                Ok(Message::Close(_)) | Err(_) => break,
                _ => {}
            }
        }
    });

    // ── Rubato resampler ──────────────────────────────────────────────────────
    const TARGET_RATE: u32 = 16_000;
    let chunk_src = (source_rate as usize * 250) / 1000; // 250 ms at source rate

    let mut resampler = SincFixedIn::<f32>::new(
        TARGET_RATE as f64 / source_rate as f64,
        2.0,
        SincInterpolationParameters {
            sinc_len:            64,
            f_cutoff:            0.95,
            interpolation:       SincInterpolationType::Linear,
            oversampling_factor: 128,
            window:              WindowFunction::BlackmanHarris2,
        },
        chunk_src,
        1, // mono
    )
    .map_err(|e| format!("Resampler init: {e}"))?;

    let mut pcm_buf: Vec<f32> = Vec::with_capacity(chunk_src * 2);

    // ── Audio → resample → WebSocket loop ────────────────────────────────────
    loop {
        if stop_flag.load(Ordering::Relaxed) {
            break;
        }

        while let Ok(samples) = rx.try_recv() {
            pcm_buf.extend_from_slice(&samples);
        }

        while pcm_buf.len() >= chunk_src {
            let chunk: Vec<f32> = pcm_buf.drain(..chunk_src).collect();

            let resampled = resampler
                .process(&[chunk], None)
                .map_err(|e| format!("Resample: {e}"))?;

            let bytes: Vec<u8> = resampled[0]
                .iter()
                .flat_map(|&s| {
                    let i = (s.clamp(-1.0, 1.0) * 32_767.0) as i16;
                    i.to_le_bytes()
                })
                .collect();

            let msg = serde_json::json!({
                "message_type": "input_audio_chunk",
                "audio_base_64": STANDARD.encode(&bytes),
                "commit": false,
                "sample_rate": TARGET_RATE,
            });

            if ws_tx.send(Message::Text(msg.to_string())).await.is_err() {
                break;
            }
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    }

    let _ = ws_tx.send(Message::Close(None)).await;
    recv_task.abort();
    Ok(())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_capture(
    app:   AppHandle,
    state: tauri::State<'_, AudioState>,
) -> Result<(), String> {
    {
        let g = state.0.lock().map_err(|e| e.to_string())?;
        if g.is_some() {
            return Err("Already capturing".into());
        }
    }

    let api_key = {
        use tauri_plugin_store::StoreExt;
        let store = app
            .store("config.json")
            .map_err(|e| format!("Store: {e}"))?;
        store
            .get("elevenLabsApiKey")
            .and_then(|v| v.as_str().map(String::from))
            .filter(|s| !s.is_empty())
            .ok_or("ElevenLabs API key not configured")?
    };

    let stop_flag = Arc::new(AtomicBool::new(false));
    let (rx, sample_rate, audio_thread) = start_audio_thread(stop_flag.clone())?;

    let task = tokio::spawn(run_scribe(
        rx,
        sample_rate,
        api_key,
        stop_flag.clone(),
        app.clone(),
    ));

    let mut g = state.0.lock().map_err(|e| e.to_string())?;
    *g = Some(CaptureSession {
        stop_flag,
        task_handle:   task.abort_handle(),
        _audio_thread: audio_thread,
    });

    Ok(())
}

#[tauri::command]
pub fn stop_capture(state: tauri::State<'_, AudioState>) -> Result<(), String> {
    let mut g = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(s) = g.take() {
        s.stop_flag.store(true, Ordering::Relaxed);
        s.task_handle.abort();
        // _audio_thread exits its loop and drops the cpal Stream.
    }
    Ok(())
}

/// Resize the main window to the full-height side drawer (open=true)
/// or shrink back to the compact overlay card (open=false).
#[tauri::command]
pub fn set_drawer_open(app: AppHandle, open: bool) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or("main window not found")?;

    let monitor = win
        .current_monitor()
        .map_err(|e: tauri::Error| e.to_string())?
        .ok_or("monitor unavailable")?;

    let scale = monitor.scale_factor();
    let work  = monitor.work_area();

    if open {
        let width  = (360.0 * scale) as u32;
        let height = work.size.height;
        let x      = work.position.x + work.size.width as i32 - width as i32;
        let y      = work.position.y;

        win.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(width, height)))
            .map_err(|e: tauri::Error| e.to_string())?;
        win.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(x, y)))
            .map_err(|e: tauri::Error| e.to_string())?;
    } else {
        let win_w = (420.0 * scale) as u32;
        let win_h = (380.0 * scale) as u32;
        let gap   = (12.0  * scale) as i32;
        let x     = work.position.x + work.size.width  as i32 - win_w as i32 - gap;
        let y     = work.position.y + work.size.height as i32 - win_h as i32 - gap;

        win.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(win_w, win_h)))
            .map_err(|e: tauri::Error| e.to_string())?;
        win.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(x, y)))
            .map_err(|e: tauri::Error| e.to_string())?;
    }

    Ok(())
}
