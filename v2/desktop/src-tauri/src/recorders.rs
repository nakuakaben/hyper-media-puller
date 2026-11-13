use crate::{
    local_ipv4,
    offload::{Offload, public_error, write_json},
};
use hmp_contract::{ErrorDto, RecorderDto};
use hmp_core::ports::{Cancellation, RemoteReadPort};
use hmp_domain::{ErrorCode, Phase, Recorder, Result, TransferError, Uuid};
use hmp_infra::{DeckIdentity, FtpRemote, HyperDeckDiscovery};
use serde::{Deserialize, Serialize};
use std::{
    fs::{File, OpenOptions},
    io::{self, Read},
    net::SocketAddrV4,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};
use tauri::{State, Window};
use tauri_plugin_dialog::DialogExt;

const MAX_BYTES: u64 = 512 * 1024;
const MAX_RECORDERS: usize = 128;
const SCHEMA: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Equipment {
    id: String,
    custom_name: Option<String>,
    model: String,
    host: String,
    unique_id: Option<String>,
    protocol_version: Option<String>,
}

impl Equipment {
    fn recorder(&self) -> Result<Recorder> {
        Recorder::new(
            self.id.parse()?,
            self.custom_name.as_deref().unwrap_or(&self.model),
            &self.host,
            21,
        )
    }

    fn same_hardware(&self, other: &Self) -> bool {
        self.model.eq_ignore_ascii_case(&other.model)
            && self.unique_id.is_some()
            && self.unique_id == other.unique_id
    }

    fn matches_probe(&self, identity: &DeckIdentity, accept_unidentified: bool) -> bool {
        self.model.eq_ignore_ascii_case(&identity.model)
            && (self.unique_id.is_some() || accept_unidentified)
            && self.unique_id == identity.unique_id
    }

    fn conflicts(&self, other: &Self) -> bool {
        self.id == other.id
            || self.host == other.host
            || (self.unique_id.is_some() && self.unique_id == other.unique_id)
    }

    fn validate(&self) -> Result<()> {
        let recorder = self.recorder()?;
        if self.id != recorder.id().to_string()
            || self.host != local_ipv4(&self.host)?.to_string()
            || !self.model.to_ascii_lowercase().contains("hyperdeck")
        {
            return Err(TransferError::invalid(
                "Identité ou adresse HyperDeck invalide",
            ));
        }
        validate_text(&self.model, 200)?;
        for value in [&self.custom_name, &self.unique_id, &self.protocol_version]
            .into_iter()
            .flatten()
        {
            validate_text(value, 200)?;
        }
        Ok(())
    }
}

fn validate_text(value: &str, max: usize) -> Result<()> {
    if value.is_empty()
        || value.len() > max
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(TransferError::invalid("Texte de configuration invalide"));
    }
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Configuration {
    schema_version: u32,
    recorders: Vec<Equipment>,
}

impl Configuration {
    fn validate(&self) -> Result<()> {
        if self.schema_version != SCHEMA || self.recorders.len() > MAX_RECORDERS {
            return Err(TransferError::invalid(
                "Version ou nombre d’enregistreurs invalide",
            ));
        }
        for (index, entry) in self.recorders.iter().enumerate() {
            entry.validate()?;
            if self.recorders[..index]
                .iter()
                .any(|existing| existing.conflicts(entry))
            {
                return Err(TransferError::invalid("Doublon dans la configuration JSON"));
            }
        }
        Ok(())
    }
}

fn configuration_io(error: io::Error) -> TransferError {
    TransferError::new(
        ErrorCode::LocalIo,
        Phase::Planning,
        format!("Configuration matérielle : {error}"),
    )
}

fn read_configuration(file: File) -> Result<Configuration> {
    if !file.metadata().map_err(configuration_io)?.is_file() {
        return Err(TransferError::invalid(
            "Un fichier JSON local ordinaire est requis",
        ));
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(configuration_io)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(TransferError::invalid(
            "Fichier de configuration trop volumineux",
        ));
    }
    let config: Configuration = serde_json::from_slice(&bytes).map_err(|error| {
        TransferError::invalid(format!("Configuration JSON invalide : {error}"))
    })?;
    config.validate()?;
    Ok(config)
}

pub struct EquipmentStore {
    path: PathBuf,
    config: Mutex<Result<Configuration>>,
    _lock: Option<File>,
}

#[derive(Serialize)]
pub struct Deck {
    recorder: RecorderDto,
    model: String,
    custom_name: Option<String>,
    unique_id: Option<String>,
    protocol_version: Option<String>,
}

impl Deck {
    fn view(equipment: &Equipment) -> Result<Self> {
        Ok(Self {
            recorder: RecorderDto::from(&equipment.recorder()?),
            model: equipment.model.clone(),
            custom_name: equipment.custom_name.clone(),
            unique_id: equipment.unique_id.clone(),
            protocol_version: equipment.protocol_version.clone(),
        })
    }
}

impl EquipmentStore {
    pub fn open(profile: &Path) -> Self {
        let path = profile.join("equipment-v1.json");
        let (lock, config) = match OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(profile.join("equipment-v1.lock"))
            .and_then(|lock| {
                lock.try_lock().map_err(io::Error::other)?;
                Ok(lock)
            }) {
            Ok(lock) => (
                Some(lock),
                match File::open(&path) {
                    Ok(file) => read_configuration(file),
                    Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Configuration {
                        schema_version: SCHEMA,
                        recorders: Vec::new(),
                    }),
                    Err(error) => Err(configuration_io(error)),
                },
            ),
            Err(error) => (None, Err(configuration_io(error))),
        };
        Self {
            path,
            config: Mutex::new(config),
            _lock: lock,
        }
    }

    fn lock(&self) -> MutexGuard<'_, Result<Configuration>> {
        self.config.lock().expect("configuration matérielle")
    }

    fn change<T>(
        &self,
        update: impl FnOnce(&mut Vec<Equipment>) -> Result<T>,
        committed: impl FnOnce(&T),
    ) -> Result<T> {
        let mut state = self.lock();
        let mut next = state.as_ref().map_err(Clone::clone)?.clone();
        let value = update(&mut next.recorders)?;
        next.validate()?;
        write_json(&self.path, &next, true).map_err(configuration_io)?;
        *state = Ok(next);
        committed(&value);
        Ok(value)
    }

    fn list(&self) -> Result<Vec<Deck>> {
        self.lock()
            .as_ref()
            .map_err(Clone::clone)?
            .recorders
            .iter()
            .map(Deck::view)
            .collect()
    }

    fn identify(&self, incoming: Equipment, online: bool, offload: &Offload) -> Result<Deck> {
        let saved = self.change(|entries| {
            let existing = entries.iter().position(|entry| entry.same_hardware(&incoming));
            if entries.iter().enumerate().any(|(index, entry)| Some(index) != existing && entry.conflicts(&incoming)) {
                return Err(TransferError::invalid("Adresse ou identité déjà enregistrée. Vérifiez l’appareil existant ou retirez-le de la configuration."));
            }
            let mut next = incoming;
            if let Some(index) = existing {
                next.id.clone_from(&entries[index].id);
                next.custom_name.clone_from(&entries[index].custom_name);
                entries[index] = next.clone();
            } else {
                entries.push(next.clone());
            }
            Ok(next)
        }, |entry| {
            if online {
                offload.remember(entry.recorder().expect("configuration validée"));
            } else {
                offload.forget(&entry.id);
            }
        })?;
        Deck::view(&saved)
    }

    fn merge(&self, imported: Configuration) -> Result<ImportResult> {
        self.change(
            |entries| {
                let mut result = ImportResult {
                    added: Vec::new(),
                    skipped: 0,
                };
                for entry in imported.recorders {
                    if entries.iter().any(|local| local.conflicts(&entry)) {
                        result.skipped += 1;
                    } else {
                        result.added.push(Deck::view(&entry)?);
                        entries.push(entry);
                    }
                }
                Ok(result)
            },
            |_| {},
        )
    }
}

async fn probe(host: &str) -> Result<DeckIdentity> {
    let ip = local_ipv4(host.trim())?;
    HyperDeckDiscovery::new(Duration::from_secs(3))?
        .identify(SocketAddrV4::new(ip, 9993), &Cancellation::default())
        .await
}

async fn ftp_available(recorder: &Recorder) -> bool {
    let Ok(ftp) = FtpRemote::new(Duration::from_secs(3)) else {
        return false;
    };
    match ftp.connect(recorder, &Cancellation::default()).await {
        Ok(mut session) => {
            let _ = session.close().await;
            true
        }
        Err(_) => false,
    }
}

impl From<DeckIdentity> for Equipment {
    fn from(identity: DeckIdentity) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            custom_name: None,
            host: identity.recorder.host().to_owned(),
            model: identity.model,
            unique_id: identity.unique_id,
            protocol_version: identity.protocol_version,
        }
    }
}

#[tauri::command]
pub fn saved_recorders(
    store: State<'_, EquipmentStore>,
) -> std::result::Result<Vec<Deck>, ErrorDto> {
    store.list().map_err(public_error)
}

#[tauri::command]
pub async fn identify_deck(
    store: State<'_, EquipmentStore>,
    state: State<'_, Arc<Offload>>,
    host: String,
) -> std::result::Result<Identified, ErrorDto> {
    let identity = probe(&host).await.map_err(public_error)?;
    let online = ftp_available(&identity.recorder).await;
    let deck = store
        .identify(identity.into(), online, &state)
        .map_err(public_error)?;
    Ok(Identified {
        deck,
        connection: if online {
            Connection::Online
        } else {
            Connection::Offline
        },
    })
}

#[derive(Serialize)]
pub struct Identified {
    deck: Deck,
    connection: Connection,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Connection {
    Online,
    Offline,
    Unconfirmed,
}

impl EquipmentStore {
    async fn verify(
        &self,
        id: &str,
        accept_unidentified: bool,
        offload: &Offload,
    ) -> Result<Connection> {
        let saved = self
            .lock()
            .as_ref()
            .map_err(Clone::clone)?
            .recorders
            .iter()
            .find(|entry| entry.id == id)
            .cloned()
            .ok_or_else(|| TransferError::invalid("Enregistreur absent de la configuration"))?;
        let identity = probe(&saved.host).await;
        let connection = match identity {
            Err(_) => Connection::Offline,
            Ok(identity) if !saved.matches_probe(&identity, accept_unidentified) => {
                Connection::Unconfirmed
            }
            Ok(identity) if ftp_available(&identity.recorder).await => Connection::Online,
            Ok(_) => Connection::Offline,
        };
        self.finish_verify(&saved, connection, offload)
    }

    fn finish_verify(
        &self,
        saved: &Equipment,
        connection: Connection,
        offload: &Offload,
    ) -> Result<Connection> {
        let state = self.lock();
        let Some(current) = state
            .as_ref()
            .map_err(Clone::clone)?
            .recorders
            .iter()
            .find(|entry| {
                entry.id == saved.id
                    && entry.host == saved.host
                    && entry.unique_id == saved.unique_id
                    && entry.model == saved.model
            })
        else {
            return Err(TransferError::invalid(
                "Configuration modifiée pendant la vérification",
            ));
        };
        if connection == Connection::Online {
            offload.remember(current.recorder()?);
        } else {
            offload.forget(&saved.id);
        }
        Ok(connection)
    }
}

#[tauri::command]
pub async fn verify_recorder(
    store: State<'_, EquipmentStore>,
    state: State<'_, Arc<Offload>>,
    id: String,
    accept_unidentified: bool,
) -> std::result::Result<Connection, ErrorDto> {
    store
        .verify(&id, accept_unidentified, &state)
        .await
        .map_err(public_error)
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum Edit {
    Rename { id: String, name: String },
    Remove { id: String },
    Reset,
}

#[tauri::command]
pub fn edit_recorders(
    store: State<'_, EquipmentStore>,
    state: State<'_, Arc<Offload>>,
    edit: Edit,
) -> std::result::Result<Vec<Deck>, ErrorDto> {
    store
        .change(
            |entries| {
                match &edit {
                    Edit::Rename { id, name } => {
                        let name = name.trim();
                        validate_text(name, 200)?;
                        let entry = entries
                            .iter_mut()
                            .find(|entry| &entry.id == id)
                            .ok_or_else(|| {
                                TransferError::invalid("Enregistreur absent de la configuration")
                            })?;
                        entry.custom_name = Some(name.to_owned());
                    }
                    Edit::Remove { id } => entries.retain(|entry| &entry.id != id),
                    Edit::Reset => entries.clear(),
                }
                entries.iter().map(Deck::view).collect::<Result<Vec<_>>>()
            },
            |remaining| match &edit {
                Edit::Rename { id, .. } => {
                    if let Some(deck) = remaining.iter().find(|deck| &deck.recorder.id == id) {
                        state.rename_if_online(&deck.recorder);
                    }
                }
                Edit::Remove { id } => state.forget(id),
                Edit::Reset => state.clear_recorders(),
            },
        )
        .map_err(public_error)
}

#[derive(Serialize)]
pub struct ImportResult {
    added: Vec<Deck>,
    skipped: usize,
}

#[tauri::command]
pub async fn equipment_json(
    window: Window,
    store: State<'_, EquipmentStore>,
    import: bool,
) -> std::result::Result<Option<ImportResult>, ErrorDto> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let dialog = window
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("Configuration JSON", &["json"]);
    let selected = move |file| {
        let _ = send.send(file);
    };
    if import {
        dialog
            .set_title("Importer une configuration matérielle")
            .pick_file(selected);
    } else {
        dialog
            .set_title("Exporter la configuration matérielle")
            .set_file_name("hmp-prestation.json")
            .save_file(selected);
    }
    let file = receive.await.map_err(|_| {
        public_error(TransferError::invalid(
            "Dialogue de configuration interrompu",
        ))
    })?;
    let Some(file) = file else { return Ok(None) };
    let path = file
        .into_path()
        .map_err(|_| public_error(TransferError::invalid("Fichier local requis")))?;
    if import {
        let config = tokio::task::spawn_blocking(move || {
            if !path.metadata().map_err(configuration_io)?.is_file() {
                return Err(TransferError::invalid(
                    "Un fichier JSON local ordinaire est requis",
                ));
            }
            read_configuration(File::open(path).map_err(configuration_io)?)
        })
        .await
        .map_err(|error| public_error(configuration_io(io::Error::other(error))))?
        .map_err(public_error)?;
        return store.merge(config).map(Some).map_err(public_error);
    }
    store.export(&path).map_err(public_error)?;
    Ok(Some(ImportResult {
        added: Vec::new(),
        skipped: 0,
    }))
}

impl EquipmentStore {
    fn export(&self, path: &Path) -> Result<()> {
        let state = self.lock();
        let config = state.as_ref().map_err(Clone::clone)?;
        write_json(path, config, false).map_err(configuration_io)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn device(host: &str, unique_id: Option<&str>) -> Equipment {
        Equipment {
            id: Uuid::new_v4().to_string(),
            custom_name: None,
            model: "HyperDeck Studio HD Plus".into(),
            host: host.into(),
            unique_id: unique_id.map(str::to_owned),
            protocol_version: Some("1.8".into()),
        }
    }

    #[tokio::test]
    async fn restores_names_and_merges_without_touching_other_files() {
        let profile = tempfile::tempdir().unwrap();
        let root = profile.path();
        let store = EquipmentStore::open(root);
        let offload = Offload::new(root).unwrap();
        let mut a = device("192.168.1.2", Some("a"));
        a.custom_name = Some("Régie A".into());
        let mut b = device("192.168.1.3", Some("b"));
        b.custom_name = Some("Régie B".into());
        for entry in [a.clone(), b.clone()] {
            store.identify(entry, true, &offload).unwrap();
        }
        let other_files = ["offload-settings-v1.json", "rapport.json", "clip.mov"];
        for file in other_files {
            fs::write(root.join(file), file).unwrap();
        }
        assert!(EquipmentStore::open(root).list().is_err());
        drop(store);

        let store = EquipmentStore::open(root);
        let saved = store.list().unwrap();
        assert_eq!(saved.len(), 2);
        assert_eq!(saved[0].recorder.name, "Régie A");
        assert_eq!(saved[1].recorder.name, "Régie B");
        assert_eq!(saved[0].recorder.id, a.id);
        assert_eq!(saved[1].unique_id.as_deref(), Some("b"));
        assert_eq!(saved[1].protocol_version.as_deref(), Some("1.8"));

        let rediscovered = device("192.168.1.4", Some("a"));
        let updated = store.identify(rediscovered, true, &offload).unwrap();
        assert_eq!(updated.recorder.id, a.id);
        assert_eq!(updated.recorder.name, "Régie A");
        assert_eq!(updated.recorder.host, "192.168.1.4");
        assert!(
            store
                .identify(device("192.168.1.4", Some("other")), true, &offload)
                .is_err()
        );

        let export = root.join("prestation.json");
        store.export(&export).unwrap();
        assert!(store.export(&export).is_err());
        let read = || read_configuration(File::open(&export).unwrap()).unwrap();
        let duplicate = store.merge(read()).unwrap();
        assert_eq!((duplicate.added.len(), duplicate.skipped), (0, 2));

        store
            .change(
                |entries| {
                    entries.clear();
                    Ok(())
                },
                |_| offload.clear_recorders(),
            )
            .unwrap();
        assert!(store.list().unwrap().is_empty());
        let imported = store.merge(read()).unwrap();
        assert_eq!((imported.added.len(), imported.skipped), (2, 0));
        assert_eq!(imported.added[0].recorder.name, "Régie A");
        for file in other_files {
            assert_eq!(fs::read_to_string(root.join(file)).unwrap(), file);
        }
        offload.engine().shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn rejects_ambiguous_identity_and_stale_probe_without_dropping_saved_entries() {
        let profile = tempfile::tempdir().unwrap();
        let store = EquipmentStore::open(profile.path());
        let offload = Offload::new(profile.path()).unwrap();
        let a = device("192.168.1.2", None);
        let probe = DeckIdentity {
            recorder: a.recorder().unwrap(),
            model: a.model.clone(),
            protocol_version: a.protocol_version.clone(),
            unique_id: None,
        };
        assert!(!a.matches_probe(&probe, false));
        assert!(a.matches_probe(&probe, true));
        store.identify(a.clone(), true, &offload).unwrap();
        assert!(
            store
                .identify(device(&a.host, None), true, &offload)
                .is_err()
        );
        assert_eq!(
            store
                .finish_verify(&a, Connection::Offline, &offload)
                .unwrap(),
            Connection::Offline
        );
        assert!(offload.recorder(&a.id).is_err());
        assert_eq!(store.list().unwrap().len(), 1);
        store
            .finish_verify(&a, Connection::Online, &offload)
            .unwrap();
        assert!(offload.recorder(&a.id).is_ok());
        store
            .change(
                |entries| {
                    entries.clear();
                    Ok(())
                },
                |_| offload.clear_recorders(),
            )
            .unwrap();
        assert!(
            store
                .finish_verify(&a, Connection::Online, &offload)
                .is_err()
        );
        assert!(offload.recorder(&a.id).is_err());
        offload.engine().shutdown().await.unwrap();
    }

    #[test]
    fn rejects_invalid_or_corrupt_configuration_without_overwriting_it() {
        let profile = tempfile::tempdir().unwrap();
        let root = profile.path();
        let path = root.join("equipment-v1.json");
        let a = device("192.168.1.2", Some("a"));
        let mut b = device("192.168.1.2", Some("b"));
        let config = |b: &Equipment| Configuration {
            schema_version: SCHEMA,
            recorders: vec![a.clone(), b.clone()],
        };
        assert!(config(&b).validate().is_err());
        b.host = "8.8.8.8".into();
        assert!(config(&b).validate().is_err());
        b.host = "192.168.1.3".into();
        b.custom_name = Some("Régie\nB".into());
        assert!(config(&b).validate().is_err());
        fs::write(&path, b"{").unwrap();
        let store = EquipmentStore::open(root);
        assert!(store.list().is_err());
        assert!(
            store
                .change(
                    |entries| {
                        entries.clear();
                        Ok(())
                    },
                    |_| {}
                )
                .is_err()
        );
        assert_eq!(fs::read(path).unwrap(), b"{");
    }
}
