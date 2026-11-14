use crate::{
    Offload, public_error,
    recorders::{EquipmentStore, Identified, check_ftp},
};
use hmp_contract::ErrorDto;
use hmp_core::ports::Cancellation;
use hmp_domain::{ErrorCode, TransferError};
use hmp_infra::{DeckIdentity, HyperDeckDiscovery, ScanObservation};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    net::Ipv4Addr,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

#[derive(Clone, Serialize)]
pub struct ScanRow {
    address: Ipv4Addr,
    name: Option<String>,
    model: Option<String>,
    ftp: Option<bool>,
    saved: bool,
}

#[derive(Serialize)]
pub struct Interface {
    name: String,
    address: Ipv4Addr,
    cidr: String,
}

#[derive(Clone, Default, Serialize)]
pub struct Progress {
    scanned: u32,
    total: u32,
    cancelled: bool,
    finished: bool,
    error: Option<String>,
    rows: BTreeMap<Ipv4Addr, ScanRow>,
}

struct Scan {
    id: Uuid,
    cancel: Cancellation,
    progress: Progress,
    confirmed: BTreeMap<Ipv4Addr, DeckIdentity>,
}

#[derive(Default)]
pub struct NetworkScan(Mutex<Option<Scan>>);

impl NetworkScan {
    fn with<T>(&self, id: Uuid, action: impl FnOnce(&mut Scan) -> T) -> Result<T, ErrorDto> {
        self.0
            .lock()
            .expect("network scan")
            .as_mut()
            .filter(|scan| scan.id == id)
            .map(action)
            .ok_or_else(|| public_error(TransferError::invalid("Recherche réseau inconnue")))
    }
}

#[tauri::command]
pub fn network_interfaces() -> Result<Vec<Interface>, ErrorDto> {
    Ok(HyperDeckDiscovery::scan_interfaces()
        .map_err(public_error)?
        .into_iter()
        .map(|entry| Interface {
            name: entry.name,
            address: entry.address,
            cidr: entry.cidr,
        })
        .collect())
}

#[tauri::command]
pub fn start_network_scan(
    app: AppHandle,
    state: State<'_, NetworkScan>,
    name: String,
    address: Ipv4Addr,
    cidr: String,
) -> Result<Uuid, ErrorDto> {
    let mut state = state.0.lock().expect("network scan");
    if state.as_ref().is_some_and(|scan| !scan.progress.finished) {
        return Err(public_error(TransferError::invalid(
            "Une recherche est déjà en cours",
        )));
    }
    let id = Uuid::new_v4();
    let cancel = Cancellation::default();
    *state = Some(Scan {
        id,
        cancel: cancel.clone(),
        progress: Progress::default(),
        confirmed: BTreeMap::new(),
    });
    tauri::async_runtime::spawn(async move {
        let store = app.state::<EquipmentStore>();
        let state = app.state::<NetworkScan>();
        let result = run(&state, &store, id, &name, address, &cidr, &cancel).await;
        let _ = state.with(id, |scan| {
            scan.progress.finished = true;
            if let Err(error) = result {
                scan.progress.cancelled = error.code == ErrorCode::Cancelled;
                if !scan.progress.cancelled {
                    scan.progress.error = Some(error.message);
                }
            }
        });
    });
    Ok(id)
}

async fn run(
    state: &NetworkScan,
    store: &EquipmentStore,
    id: Uuid,
    name: &str,
    address: Ipv4Addr,
    cidr: &str,
    cancel: &Cancellation,
) -> hmp_domain::Result<()> {
    let mut checks = tokio::task::JoinSet::new();
    let ftp_slots = Arc::new(tokio::sync::Semaphore::new(16));
    HyperDeckDiscovery::new(Duration::from_secs(2))?
        .scan(
            cidr.trim(),
            Some((name, address)),
            cancel,
            |scanned, total, observation| {
                let row = match observation {
                    Some(ScanObservation::Open(address)) => Some(ScanRow {
                        address,
                        name: None,
                        model: None,
                        ftp: None,
                        saved: false,
                    }),
                    Some(ScanObservation::Identified(identity)) => {
                        let address = identity.recorder.host().parse().expect("IPv4 from scan");
                        let saved = store.discovery_match(&identity).ok().flatten();
                        let row = ScanRow {
                            address,
                            name: Some(
                                saved
                                    .clone()
                                    .unwrap_or_else(|| identity.recorder.name().to_owned()),
                            ),
                            model: Some(identity.model.clone()),
                            ftp: None,
                            saved: saved.is_some(),
                        };
                        let cancel = cancel.clone();
                        let slots = ftp_slots.clone();
                        checks.spawn(async move {
                            let _permit =
                                slots.acquire().await.expect("scan semaphore remains open");
                            let ftp = check_ftp(&identity.recorder, &cancel).await.is_ok();
                            (address, identity, ftp)
                        });
                        Some(row)
                    }
                    _ => None,
                };
                let _ = state.with(id, |scan| {
                    scan.progress.scanned = scanned;
                    scan.progress.total = total;
                    if let Some(row) = row {
                        scan.progress.rows.insert(row.address, row);
                    }
                });
            },
        )
        .await?;
    if cancel.is_cancelled() {
        return Err(TransferError::cancelled());
    }
    while !checks.is_empty() {
        let next = tokio::select! {
            biased;
            () = cancel.cancelled() => return Err(TransferError::cancelled()),
            next = checks.join_next() => next,
        };
        if let Some(Ok((address, identity, ftp))) = next {
            let _ = state.with(id, |scan| {
                if let Some(row) = scan.progress.rows.get_mut(&address) {
                    row.ftp = Some(ftp);
                }
                scan.confirmed.insert(address, identity);
            });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn network_scan_progress(
    state: State<'_, NetworkScan>,
    id: Uuid,
) -> Result<Progress, ErrorDto> {
    state.with(id, |scan| scan.progress.clone())
}

#[tauri::command]
pub fn cancel_network_scan(state: State<'_, NetworkScan>, id: Uuid) -> Result<(), ErrorDto> {
    state.with(id, |scan| scan.cancel.cancel())
}

#[tauri::command]
pub async fn add_network_recorder(
    state: State<'_, NetworkScan>,
    store: State<'_, EquipmentStore>,
    offload: State<'_, Arc<Offload>>,
    id: Uuid,
    address: Ipv4Addr,
) -> Result<Identified, ErrorDto> {
    let identity = state
        .with(id, |scan| scan.confirmed.get(&address).cloned())?
        .ok_or_else(|| public_error(TransferError::invalid("HyperDeck à confirmer")))?;
    store
        .add_discovered(&identity, &offload)
        .await
        .map_err(public_error)
}
