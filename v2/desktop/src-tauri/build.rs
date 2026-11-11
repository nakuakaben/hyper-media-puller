fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["preview_info", "identify_deck", "list_media"]),
    ))
    .expect("build Tauri Preview resources");
}
