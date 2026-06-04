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

#[tauri::command]
fn export_transcript(
    app: tauri::AppHandle,
    filename: String,
    content: String,
) -> Result<String, String> {
    if content.trim().is_empty() {
        return Err("Transcript is empty".into());
    }

    let safe_filename = filename
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => ch,
            _ => '-',
        })
        .collect::<String>();

    let safe_filename = if safe_filename.ends_with(".txt") {
        safe_filename
    } else {
        format!("{safe_filename}.txt")
    };

    let mut path = app
        .path()
        .download_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| e.to_string())?;

    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    path.push(safe_filename);
    std::fs::write(&path, content).map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().to_string())
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

            app.handle().global_shortcut().on_shortcut(
                "CmdOrCtrl+Shift+Space",
                |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        app.emit("buddy:trigger", ()).ok();
                    }
                },
            )?;

            app.handle().global_shortcut().on_shortcut(
                "CmdOrCtrl+Shift+R",
                |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        app.emit("buddy:capture_toggle", ()).ok();
                    }
                },
            )?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            screenshot::capture_screen,
            screenshot::capture_region,
            show_overlay,
            hide_overlay,
            show_selector,
            hide_selector,
            export_transcript,
            audio::start_capture,
            audio::stop_capture,
            audio::set_drawer_open,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
