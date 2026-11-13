const COMMANDS: &[&str] = &[
    "preview_info",
    "identify_deck",
    "saved_recorders",
    "verify_recorder",
    "edit_recorders",
    "equipment_json",
    "list_media",
    "transfer_settings",
    "choose_destination",
    "save_transfer_options",
    "enqueue_transfer",
    "transfer_action",
    "transfer_queue",
    "transfer_report",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("build Tauri Preview resources");
}
