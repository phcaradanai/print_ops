const APP_COMMANDS: &[&str] = &["write_export_file", "get_nats_settings", "save_nats_settings"];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
