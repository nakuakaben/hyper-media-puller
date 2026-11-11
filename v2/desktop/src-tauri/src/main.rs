#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use hmp_contract::{ErrorDto, MediaEntryDto, RecorderDto, SCHEMA_VERSION};
use hmp_core::ports::{Cancellation, RemoteReadPort};
use hmp_domain::{Recorder, RemotePath, TransferError};
use hmp_infra::{FtpRemote, HyperDeckDiscovery};
use serde::Serialize;
use std::{
    net::{Ipv4Addr, SocketAddrV4},
    time::Duration,
};
use tauri::Manager;

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

fn public_error(error: TransferError) -> ErrorDto {
    ErrorDto::from(&error)
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
async fn identify_deck(host: String) -> Result<Deck, ErrorDto> {
    let ip = local_ipv4(host.trim()).map_err(public_error)?;
    let identity = HyperDeckDiscovery::new(Duration::from_secs(3))
        .map_err(public_error)?
        .identify(SocketAddrV4::new(ip, 9993), &Cancellation::default())
        .await
        .map_err(public_error)?;
    Ok(Deck {
        recorder: RecorderDto::from(&identity.recorder),
        model: identity.model,
    })
}

#[tauri::command]
async fn list_media(recorder: RecorderDto, path: String) -> Result<Vec<MediaEntryDto>, ErrorDto> {
    local_ipv4(&recorder.host).map_err(public_error)?;
    if recorder.port != 21 {
        return Err(public_error(TransferError::invalid("Port FTP 21 requis")));
    }
    let recorder = Recorder::try_from(recorder).map_err(public_error)?;
    let path = RemotePath::new(&path).map_err(public_error)?;
    let cancel = Cancellation::default();
    let ftp = FtpRemote::new(Duration::from_secs(6)).map_err(public_error)?;
    let mut session = ftp
        .connect(&recorder, &cancel)
        .await
        .map_err(public_error)?;
    let listing = session.list(&path, &cancel).await;
    let _ = session.close().await;
    Ok(listing
        .map_err(public_error)?
        .iter()
        .map(MediaEntryDto::from)
        .collect())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            std::fs::create_dir_all(app.path().app_data_dir()?)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            preview_info,
            identify_deck,
            list_media
        ])
        .run(tauri::generate_context!())
        .expect("run HMP V2 Preview");
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
