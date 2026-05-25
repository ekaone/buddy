// Never show a console window — buddy is a background tray app
#![windows_subsystem = "windows"]

fn main() {
    buddy_lib::run()
}
