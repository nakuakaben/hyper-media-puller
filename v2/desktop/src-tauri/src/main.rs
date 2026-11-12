#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use hmp_contract::{ErrorDto, MediaEntryDto, RecorderDto, SCHEMA_VERSION};
mod offload;
#[cfg(all(windows, feature = "windows-qualification"))]
mod windows_qualification;

use hmp_core::ports::Cancellation;
use hmp_domain::TransferError;
use hmp_infra::HyperDeckDiscovery;
use offload::{Enqueue, Offload, Options, QueueView, Report, SettingsView, public_error};
use serde::{Deserialize, Serialize};
use std::{
    net::{Ipv4Addr, SocketAddrV4},
    sync::{
        Arc,
        atomic::{AtomicU8, Ordering},
    },
    time::Duration,
};
use tauri::{Manager, State, Window};
use tauri_plugin_dialog::DialogExt;

const PROFILE: &str = "fr.tktprod.hyperdeck-media-puller.v2.preview";

#[derive(Serialize)]
struct PreviewInfo {
    version: &'static str,
    schema_version: u32,
    profile: &'static str,
}

#[derive(Serialize)]
struct Deck {
    recorder: RecorderDto,
    model: String,
}

fn local_ipv4(host: &str) -> Result<Ipv4Addr, TransferError> {
    let ip: Ipv4Addr = host
        .parse()
        .map_err(|_| TransferError::invalid("IPv4 invalide"))?;
    if ip.is_private() || ip.is_link_local() {
        Ok(ip)
    } else {
        Err(TransferError::invalid(
            "Adresse IPv4 privée ou link-local requise",
        ))
    }
}

#[tauri::command]
fn preview_info() -> PreviewInfo {
    PreviewInfo {
        version: env!("CARGO_PKG_VERSION"),
        schema_version: SCHEMA_VERSION,
        profile: PROFILE,
    }
}

#[tauri::command]
async fn identify_deck(state: State<'_, Arc<Offload>>, host: String) -> Result<Deck, ErrorDto> {
    let ip = local_ipv4(host.trim()).map_err(public_error)?;
    let identity = HyperDeckDiscovery::new(Duration::from_secs(3))
        .map_err(public_error)?
        .identify(SocketAddrV4::new(ip, 9993), &Cancellation::default())
        .await
        .map_err(public_error)?;
    let recorder = RecorderDto::from(&identity.recorder);
    state.remember(identity.recorder);
    Ok(Deck {
        recorder,
        model: identity.model,
    })
}

#[tauri::command]
async fn list_media(
    state: State<'_, Arc<Offload>>,
    recorder_id: String,
    path: String,
) -> Result<Vec<MediaEntryDto>, ErrorDto> {
    state.list(&recorder_id, &path).await.map_err(public_error)
}

#[tauri::command]
async fn transfer_settings(state: State<'_, Arc<Offload>>) -> Result<SettingsView, ErrorDto> {
    Ok(state.settings().await)
}

#[tauri::command]
async fn choose_destination(
    window: Window,
    state: State<'_, Arc<Offload>>,
) -> Result<Option<SettingsView>, ErrorDto> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .dialog()
        .file()
        .set_title("Choisir une destination HMP V2")
        .set_parent(&window)
        .pick_folder(move |folder| {
            let _ = tx.send(folder);
        });
    let selected = rx
        .await
        .map_err(|_| public_error(TransferError::invalid("Dialogue de destination interrompu")))?;
    let Some(folder) = selected else {
        return Ok(None);
    };
    let path = folder
        .into_path()
        .map_err(|_| public_error(TransferError::invalid("Dossier local requis")))?;
    state.select(path).await.map(Some).map_err(public_error)
}

#[tauri::command]
async fn save_transfer_options(
    state: State<'_, Arc<Offload>>,
    schema_version: u32,
    options: Options,
) -> Result<SettingsView, ErrorDto> {
    state
        .save_options(schema_version, options)
        .await
        .map_err(public_error)
}

#[tauri::command]
async fn enqueue_transfer(
    state: State<'_, Arc<Offload>>,
    request: Enqueue,
) -> Result<String, ErrorDto> {
    state.enqueue(request).await.map_err(public_error)
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Action {
    Start,
    Pause,
    Cancel,
    Retry,
}

#[tauri::command]
async fn transfer_action(
    state: State<'_, Arc<Offload>>,
    schema_version: u32,
    id: String,
    action: Action,
) -> Result<(), ErrorDto> {
    if schema_version != SCHEMA_VERSION {
        return Err(public_error(TransferError::invalid(
            "Version de commande inconnue",
        )));
    }
    let engine = state.engine();
    match action {
        Action::Start => engine.start(id.parse().map_err(public_error)?).await,
        Action::Pause => engine.pause(id.parse().map_err(public_error)?).await,
        Action::Cancel => engine.cancel(id.parse().map_err(public_error)?).await,
        Action::Retry => engine.retry(id.parse().map_err(public_error)?).await,
    }
    .map_err(public_error)
}

#[tauri::command]
async fn transfer_queue(state: State<'_, Arc<Offload>>) -> Result<QueueView, ErrorDto> {
    state.queue().await.map_err(public_error)
}

#[tauri::command]
async fn transfer_report(
    state: State<'_, Arc<Offload>>,
    batch_id: String,
) -> Result<Report, ErrorDto> {
    state
        .report(batch_id.parse().map_err(public_error)?)
        .await
        .map_err(public_error)
}

fn context<R: tauri::Runtime>() -> tauri::Context<R> {
    tauri::generate_context!()
}

fn main() {
    let stopping = Arc::new(AtomicU8::new(0));
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let profile = app.path().app_data_dir()?;
            std::fs::create_dir_all(&profile)?;
            let service = tauri::async_runtime::block_on(async { Offload::new(&profile) })?;
            app.manage(Arc::new(service));
            #[cfg(all(windows, feature = "windows-qualification"))]
            if let Some(window) = app.get_webview_window("main") {
                windows_qualification::start(window);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            preview_info,
            identify_deck,
            list_media,
            transfer_settings,
            choose_destination,
            save_transfer_options,
            enqueue_transfer,
            transfer_action,
            transfer_queue,
            transfer_report
        ])
        .build(context())
        .expect("build HMP V2 Preview");
    app.run(move |app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if stopping.load(Ordering::Acquire) == 2 {
                return;
            }
            api.prevent_exit();
            if stopping.swap(1, Ordering::AcqRel) == 0 {
                let state = app.state::<Arc<Offload>>().inner().clone();
                let app = app.clone();
                let stopping = stopping.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = state.engine().shutdown().await {
                        eprintln!("Arrêt du moteur : {error}");
                    }
                    stopping.store(2, Ordering::Release);
                    app.exit(0);
                });
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_only_accepts_explicit_private_or_link_local_ipv4() {
        for accepted in ["192.168.1.20", "10.0.0.4", "172.31.255.4", "169.254.2.5"] {
            assert!(local_ipv4(accepted).is_ok());
        }
        for rejected in [
            "example.com",
            "::1",
            "127.0.0.1",
            "0.0.0.0",
            "8.8.8.8",
            "224.1.1.2",
        ] {
            assert!(local_ipv4(rejected).is_err());
        }
    }
}

#[cfg(test)]
mod integration;
