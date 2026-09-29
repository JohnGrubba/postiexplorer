fn main() {
    // Tauri's codegen only watches tauri.conf.json + capabilities by default.
    // Without these, changing icons or rebuilding the frontend leaves stale
    // assets in target/.../out (wrong window/Start Menu icon, wrong navbar
    // logo in the bundled app) until a manual `cargo clean`.
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.icns");
    println!("cargo:rerun-if-changed=icons/32x32.png");
    println!("cargo:rerun-if-changed=icons/128x128.png");
    println!("cargo:rerun-if-changed=icons/128x128@2x.png");
    println!("cargo:rerun-if-changed=../dist/index.html");
    tauri_build::build()
}
