//! Desktop window binary.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(all(not(debug_assertions), dev))]
compile_error!("Release desktop builds require the production asset protocol; use cargo tauri build");

fn main() {
    dsh_desktop::run();
}
