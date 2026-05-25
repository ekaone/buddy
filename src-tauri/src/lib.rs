use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

mod screenshot;

// ── Overlay show / hide (called from App.tsx via invoke) 

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

// ── Selector show / hide 

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

// ── App entry 

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            // ── Autostart: enable silently on first run (release only) ───
            // Dev binaries must never be registered — they live in a
            // temporary build dir and would show a stale path on login.
            #[cfg(not(debug_assertions))]
            let _ = app.autolaunch().enable();

            // ── Main overlay window: hidden by default 
            let main_win = app.get_webview_window("main").expect("main window not found");
            if let Ok(Some(monitor)) = main_win.current_monitor() {
                let scale = monitor.scale_factor();
                let work  = monitor.work_area(); // physical px, excludes taskbar

                // Convert logical window size (from tauri.conf.json) → physical px
                let win_w = (420.0 * scale) as i32;
                let win_h = (380.0 * scale) as i32;
                let gap   = (12.0  * scale) as i32; // 12 logical px breathing room

                // Anchor bottom-right corner to bottom-right of the usable work area
                let x = work.position.x + work.size.width  as i32 - win_w - gap;
                let y = work.position.y + work.size.height as i32 - win_h - gap;
                let _ = main_win.set_position(tauri::Position::Physical(
                    tauri::PhysicalPosition::new(x, y),
                ));
            }
            // Keep main window hidden — it shows only when pipeline is active

            // Intercept close → hide instead of quit
            let main_clone = main_win.clone();
            main_win.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    main_clone.hide().ok();
                }
            });

            // ── Selector window: pre-created hidden 
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

            // ── System tray 
            let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);

            let item_autostart = CheckMenuItem::with_id(
                app,
                "autostart",
                "Start on login",
                true,
                autostart_enabled,
                None::<&str>,
            )?;
            let separator  = PredefinedMenuItem::separator(app)?;
            let item_quit  = MenuItem::with_id(app, "quit", "Quit buddy", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&item_autostart, &separator, &item_quit])?;

            // Clone so the event closure can toggle the check state
            let item_autostart_ref = item_autostart.clone();

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("buddy — Ctrl+Shift+Space to capture")
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

            // ── Global hotkey 
            app.handle().global_shortcut().on_shortcut(
                "CmdOrCtrl+Shift+Space",
                |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        app.emit("buddy:trigger", ()).ok();
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
