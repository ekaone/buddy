use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

mod audio;
mod screenshot;

use audio::AudioState;

#[tauri::command]
fn show_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn hide_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn show_selector(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("selector") {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn hide_selector(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("selector") {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn sanitize_export_filename(filename: &str) -> String {
    let safe_filename = filename
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => ch,
            _ => '-',
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();

    if safe_filename.is_empty() {
        "buddy-export.txt".into()
    } else if safe_filename.to_ascii_lowercase().ends_with(".txt") {
        safe_filename
    } else {
        format!("{safe_filename}.txt")
    }
}

#[tauri::command]
fn export_text_file(
    window: tauri::Window,
    default_filename: String,
    content: String,
) -> Result<Option<String>, String> {
    if content.trim().is_empty() {
        return Err("Nothing to export".into());
    }

    let safe_filename = sanitize_export_filename(&default_filename);
    let Some(path) = rfd::FileDialog::new()
        .set_parent(&window)
        .set_title("Save Buddy output")
        .set_file_name(&safe_filename)
        .add_filter("Text file", &["txt"])
        .save_file()
    else {
        return Ok(None);
    };

    std::fs::write(&path, content).map_err(|e| e.to_string())?;

    Ok(Some(path.to_string_lossy().to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(AudioState(std::sync::Mutex::new(None)))
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            let _ = app.autolaunch().enable();

            let main_win = app.get_webview_window("main").expect("main window not found");

            // Closing hides to the tray; Quit Buddy exits the process.
            let main_clone = main_win.clone();
            main_win.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    main_clone.hide().ok();
                }
            });

            tauri::WebviewWindowBuilder::new(
                app,
                "selector",
                tauri::WebviewUrl::App("/".into()),
            )
            .fullscreen(true)
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .build()?;

            let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);

            let item_autostart = CheckMenuItem::with_id(
                app,
                "autostart",
                "Start on login",
                true,
                autostart_enabled,
                None::<&str>,
            )?;
            let separator = PredefinedMenuItem::separator(app)?;
            let item_quit = MenuItem::with_id(app, "quit", "Quit Buddy", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&item_autostart, &separator, &item_quit])?;

            let item_autostart_ref = item_autostart.clone();

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("buddy")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "autostart" => {
                        let al = app.autolaunch();
                        let now_enabled = al.is_enabled().unwrap_or(false);
                        if now_enabled {
                            let _ = al.disable();
                            let _ = item_autostart_ref.set_checked(false);
                        } else {
                            let _ = al.enable();
                            let _ = item_autostart_ref.set_checked(true);
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            if let Err(err) = app.handle().global_shortcut().on_shortcut(
                "CmdOrCtrl+Shift+Space",
                |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        app.emit("buddy:trigger", ()).ok();
                    }
                },
            ) {
                eprintln!("[shortcut] Ctrl+Shift+Space unavailable: {err}");
            }

            if let Err(err) = app.handle().global_shortcut().on_shortcut(
                "CmdOrCtrl+Shift+R",
                |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        app.emit("buddy:capture_toggle", ()).ok();
                    }
                },
            ) {
                eprintln!("[shortcut] Ctrl+Shift+R unavailable: {err}");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            screenshot::capture_screen,
            screenshot::capture_region,
            show_overlay,
            hide_overlay,
            show_selector,
            hide_selector,
            export_text_file,
            audio::start_capture,
            audio::stop_capture,
            audio::set_drawer_open,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
