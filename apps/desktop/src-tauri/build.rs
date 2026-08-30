use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let cli_src = manifest_dir.join("../../../packages/boot/installed-runtime/lib/cli.js");
    let resource_dir = manifest_dir.join("resources");
    fs::create_dir_all(&resource_dir).expect("create resource directory");
    if cli_src.is_file() {
        fs::copy(&cli_src, resource_dir.join("installed-runtime-cli.js"))
            .expect("copy installed-runtime CLI into resources");
    } else {
        println!(
            "cargo:warning=installed-runtime CLI is missing at {}; cargo test can proceed, but a packaged app needs that file",
            cli_src.display()
        );
    }
    println!("cargo:rerun-if-changed={}", cli_src.display());
    tauri_build::build();
}
