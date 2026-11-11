use hmp_contract::{BatchOptionsDto, ErrorDto, JobDto, MediaEntryDto, SCHEMA_VERSION, SnapshotDto};
use hmp_core::{
    BatchExecution, Engine, EngineEvent, EventKind, Snapshot,
    ports::{Cancellation, Clock, EngineConfig, EnginePorts, EventSink, IdSource, RemoteReadPort},
};
use hmp_domain::*;
use hmp_infra::{FtpRemote, LocalDestination};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex as AsyncMutex;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Options {
    pub batch: BatchOptionsDto,
    pub global_limit: usize,
    pub recorder_limit: usize,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            batch: BatchOptionsDto {
                duplicate: hmp_contract::DuplicateDto::Rename,
                checksum: hmp_contract::ChecksumDto::Md5,
            },
            global_limit: 2,
            recorder_limit: 1,
        }
    }
}

impl Options {
    fn config(&self) -> Result<EngineConfig> {
        let config = EngineConfig {
            global_limit: self.global_limit,
            recorder_limit: self.recorder_limit,
            ..EngineConfig::default()
        };
        config.validate()?;
        Ok(config)
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct Preferences {
    destination: Option<PathBuf>,
    options: Options,
}

#[derive(Serialize)]
pub struct SettingsView {
    pub schema_version: u32,
    pub destination: Option<String>,
    pub available: Option<String>,
    pub options: Options,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Enqueue {
    pub schema_version: u32,
    pub recorder_id: RecorderIdDto,
    pub paths: Vec<String>,
    pub options: Options,
}

#[derive(Deserialize)]
#[serde(transparent)]
pub struct RecorderIdDto(String);

#[derive(Clone, Serialize)]
pub struct BatchView {
    id: String,
    destination: String,
    staging: String,
    options: Options,
    created_at_millis: String,
}

#[derive(Serialize)]
pub struct QueueView {
    #[serde(flatten)]
    snapshot: SnapshotDto,
    destinations: Vec<BatchView>,
    recorders: BTreeMap<String, String>,
}

#[derive(Serialize)]
pub struct Report {
    schema_version: u32,
    batch: BatchView,
    elapsed_millis: String,
    generated_at_millis: String,
    jobs: Vec<ReportJob>,
}

#[derive(Serialize)]
struct ReportJob {
    source: hmp_contract::RecorderDto,
    transfer: JobDto,
    started_at_millis: Option<String>,
    ended_at_millis: Option<String>,
    elapsed_millis: Option<String>,
}

#[derive(Clone, Copy, Default)]
struct AttemptTiming {
    started: Option<u64>,
    ended: Option<u64>,
}

#[derive(Default)]
struct Timing(Mutex<HashMap<AttemptId, AttemptTiming>>);

fn now() -> u64 {
    u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(u64::MAX)
}
struct WallClock;
impl Clock for WallClock {
    fn now_millis(&self) -> u64 {
        now()
    }
}
struct RandomIds;
impl IdSource for RandomIds {
    fn next(&self) -> Uuid {
        Uuid::new_v4()
    }
}
impl EventSink for Timing {
    fn publish(&self, event: &EngineEvent) {
        if let EventKind::JobChanged(job) = &event.kind {
            let mut times = self.0.lock().expect("timing");
            if job.status() == TransferStatus::Running {
                times
                    .entry(job.attempt())
                    .or_default()
                    .started
                    .get_or_insert(event.timestamp_millis);
            } else if job.status().terminal() {
                times
                    .entry(job.attempt())
                    .or_default()
                    .ended
                    .get_or_insert(event.timestamp_millis);
            }
        }
    }
}

// The UI must select a destination for each batch. The engine's default cannot write.
struct Unselected;
#[async_trait::async_trait]
impl hmp_core::ports::DestinationPort for Unselected {
    async fn reserve(
        &self,
        _: &LocalName,
        _: DuplicatePolicy,
        _: JobId,
        _: AttemptId,
    ) -> Result<hmp_core::ports::ReservationOutcome> {
        Err(TransferError::invalid("Sélectionnez une destination"))
    }
    async fn create_partial(
        &self,
        _: &hmp_core::ports::Reservation,
    ) -> Result<Box<dyn hmp_core::ports::LocalWriter>> {
        Err(TransferError::invalid("Sélectionnez une destination"))
    }
    async fn open_readback(
        &self,
        _: &hmp_core::ports::Reservation,
    ) -> Result<Box<dyn hmp_core::ports::LocalReader>> {
        Err(TransferError::invalid("Sélectionnez une destination"))
    }
    async fn prepare_commit(&self, _: &hmp_core::ports::Reservation, _: u64) -> Result<()> {
        Err(TransferError::invalid("Sélectionnez une destination"))
    }
    fn commit(&self, _: &hmp_core::ports::Reservation, _: DuplicatePolicy) -> Result<String> {
        Err(TransferError::invalid("Sélectionnez une destination"))
    }
    fn release(&self, _: &hmp_core::ports::Reservation) {}
}

#[derive(Default)]
struct Registry {
    recorders: HashMap<RecorderId, Recorder>,
    listings: HashMap<(RecorderId, RemotePath), Vec<MediaEntry>>,
}

struct LocalState {
    preferences: Preferences,
    roots: HashMap<PathBuf, Arc<LocalDestination>>,
    batches: BTreeMap<BatchId, BatchView>,
}

pub struct Offload {
    engine: Engine,
    timing: Arc<Timing>,
    registry: Mutex<Registry>,
    local: AsyncMutex<LocalState>,
    preferences_file: PathBuf,
}

fn settings_io(error: io::Error) -> TransferError {
    TransferError::new(
        ErrorCode::LocalIo,
        Phase::Planning,
        format!("Profil V2 : {error}"),
    )
}

fn load(path: &Path) -> Result<Preferences> {
    match fs::read(path) {
        Ok(data) => {
            let preferences: Preferences = serde_json::from_slice(&data)
                .map_err(|error| settings_io(io::Error::other(error)))?;
            preferences.options.config()?;
            Ok(preferences)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Preferences::default()),
        Err(error) => Err(settings_io(error)),
    }
}

fn save(path: &Path, preferences: &Preferences) -> io::Result<()> {
    let mut file = tempfile::NamedTempFile::new_in(path.parent().expect("profile directory"))?;
    serde_json::to_writer_pretty(&mut file, preferences)?;
    file.flush()?;
    file.as_file().sync_all()?;
    file.persist(path).map_err(|error| error.error)?;
    Ok(())
}

pub fn public_error(error: TransferError) -> ErrorDto {
    ErrorDto::from(&error)
}

fn local_name(path: &RemotePath) -> Result<LocalName> {
    let basename = path.file_name()?;
    if !basename.to_ascii_lowercase().starts_with("hmp-")
        && let Ok(name) = LocalName::new(basename)
    {
        return Ok(name);
    }
    LocalName::from_remote(path)
}

impl Offload {
    pub fn new(profile: &Path) -> Result<Self> {
        let preferences_file = profile.join("offload-settings-v1.json");
        let preferences = load(&preferences_file)?;
        let timing = Arc::new(Timing::default());
        let engine = Engine::spawn(
            EnginePorts {
                remote: Arc::new(FtpRemote::new(Duration::from_secs(20))?),
                destination: Arc::new(Unselected),
                events: timing.clone(),
                clock: Arc::new(WallClock),
                ids: Arc::new(RandomIds),
            },
            EngineConfig::default(),
        )?;
        Ok(Self {
            engine,
            timing,
            preferences_file,
            registry: Mutex::default(),
            local: AsyncMutex::new(LocalState {
                preferences,
                roots: HashMap::new(),
                batches: BTreeMap::new(),
            }),
        })
    }

    pub fn remember(&self, recorder: Recorder) {
        let mut registry = self.registry.lock().expect("recorders");
        let id = recorder.id();
        if registry
            .recorders
            .get(&id)
            .is_some_and(|previous| previous != &recorder)
        {
            registry.listings.retain(|(recorder, _), _| *recorder != id);
        }
        registry.recorders.insert(id, recorder);
    }

    pub fn recorder(&self, id: &str) -> Result<Recorder> {
        self.registry
            .lock()
            .expect("recorders")
            .recorders
            .get(&id.parse()?)
            .cloned()
            .ok_or_else(|| TransferError::invalid("HyperDeck à identifier"))
    }

    pub async fn list(&self, id: &str, parent: &str) -> Result<Vec<MediaEntryDto>> {
        let recorder = self.recorder(id)?;
        let parent = RemotePath::new(parent)?;
        let cancel = Cancellation::default();
        let ftp = FtpRemote::new(Duration::from_secs(6))?;
        let mut session = ftp.connect(&recorder, &cancel).await?;
        let listing = session.list(&parent, &cancel).await;
        let _ = session.close().await;
        let listing = listing?;
        let result = listing.iter().map(MediaEntryDto::from).collect();
        self.remember_listing(recorder.id(), parent, listing);
        Ok(result)
    }

    pub fn remember_listing(&self, id: RecorderId, parent: RemotePath, media: Vec<MediaEntry>) {
        let mut registry = self.registry.lock().expect("recorders");
        if registry.listings.len() >= 256 {
            registry.listings.clear();
        }
        registry.listings.insert((id, parent), media);
    }

    async fn persist(&self, preferences: Preferences) -> Result<()> {
        let path = self.preferences_file.clone();
        tokio::task::spawn_blocking(move || save(&path, &preferences))
            .await
            .map_err(|error| settings_io(io::Error::other(error)))?
            .map_err(settings_io)
    }

    async fn root(local: &mut LocalState, path: PathBuf) -> Result<Arc<LocalDestination>> {
        if let Some(root) = local.roots.get(&path) {
            return Ok(root.clone());
        }
        let root = Arc::new(LocalDestination::open(path.clone()).await?);
        if let Some(existing) = local.roots.get(root.path()) {
            return Ok(existing.clone());
        }
        local.roots.insert(path, root.clone());
        local.roots.insert(root.path().to_owned(), root.clone());
        Ok(root)
    }

    pub async fn select(&self, path: PathBuf) -> Result<SettingsView> {
        let mut local = self.local.lock().await;
        let root = Self::root(&mut local, path).await?;
        let mut preferences = local.preferences.clone();
        preferences.destination = Some(root.path().to_owned());
        self.persist(preferences.clone()).await?;
        local.preferences = preferences;
        Ok(Self::settings_locked(&local).await)
    }

    pub async fn save_options(
        &self,
        schema_version: u32,
        options: Options,
    ) -> Result<SettingsView> {
        if schema_version != SCHEMA_VERSION {
            return Err(TransferError::invalid("Version des paramètres inconnue"));
        }
        options.config()?;
        let mut local = self.local.lock().await;
        let mut preferences = local.preferences.clone();
        preferences.options = options;
        self.persist(preferences.clone()).await?;
        local.preferences = preferences;
        Ok(Self::settings_locked(&local).await)
    }

    pub async fn settings(&self) -> SettingsView {
        Self::settings_locked(&*self.local.lock().await).await
    }

    async fn settings_locked(local: &LocalState) -> SettingsView {
        let destination = local.preferences.destination.as_deref();
        let available = match destination.and_then(|path| local.roots.get(path)) {
            Some(root) => root.available_space().await.map(|bytes| bytes.to_string()),
            None => None,
        };
        SettingsView {
            schema_version: SCHEMA_VERSION,
            destination: destination.map(|path| path.to_string_lossy().into_owned()),
            available,
            options: local.preferences.options.clone(),
        }
    }

    pub async fn enqueue(&self, request: Enqueue) -> Result<String> {
        if request.schema_version != SCHEMA_VERSION
            || request.paths.is_empty()
            || request.paths.len() > 1000
        {
            return Err(TransferError::invalid(
                "Lot vide, trop grand ou version inconnue",
            ));
        }
        let config = request.options.config()?;
        let recorder = self.recorder(&request.recorder_id.0)?;
        let requests = {
            let registry = self.registry.lock().expect("recorders");
            let mut unique = std::collections::HashSet::new();
            request
                .paths
                .iter()
                .map(|raw| {
                    let path = RemotePath::new(raw)?;
                    if !unique.insert(path.clone()) {
                        return Err(TransferError::invalid("Le fichier figure déjà dans ce lot"));
                    }
                    let (parent, _) = path
                        .as_str()
                        .rsplit_once('/')
                        .ok_or_else(|| TransferError::invalid("Chemin absolu requis"))?;
                    let parent = RemotePath::new(if parent.is_empty() { "/" } else { parent })?;
                    let source = registry
                        .listings
                        .get(&(recorder.id(), parent))
                        .and_then(|entries| {
                            entries
                                .iter()
                                .find(|entry| entry.path() == &path && !entry.is_directory())
                        })
                        .ok_or_else(|| {
                            TransferError::invalid(
                                "Média absent du listing FTP. Actualisez le dossier.",
                            )
                        })?;
                    JobRequest::new(recorder.clone(), source.clone(), local_name(&path)?)
                })
                .collect::<Result<Vec<_>>>()?
        };
        let mut local = self.local.lock().await;
        let path = local
            .preferences
            .destination
            .clone()
            .ok_or_else(|| TransferError::invalid("Sélectionnez une destination"))?;
        let root = Self::root(&mut local, path).await?;
        let created = now();
        let batch = self
            .engine
            .enqueue_with_destination(
                requests,
                request.options.batch.clone().into(),
                BatchExecution {
                    destination: root.clone(),
                    config,
                },
            )
            .await?;
        local.batches.insert(
            batch,
            BatchView {
                id: batch.to_string(),
                destination: root.path().to_string_lossy().into_owned(),
                staging: root.staging_path().to_string_lossy().into_owned(),
                options: request.options,
                created_at_millis: created.to_string(),
            },
        );
        Ok(batch.to_string())
    }

    pub async fn queue(&self) -> Result<QueueView> {
        let local = self.local.lock().await;
        let snapshot = self.engine.snapshot().await?;
        let recorders = self
            .registry
            .lock()
            .expect("recorders")
            .recorders
            .iter()
            .map(|(id, recorder)| (id.to_string(), recorder.name().into()))
            .collect();
        let mut destinations: Vec<_> = local.batches.values().cloned().collect();
        destinations.sort_by(|left, right| left.created_at_millis.cmp(&right.created_at_millis));
        Ok(QueueView {
            snapshot: SnapshotDto::from(&snapshot),
            destinations,
            recorders,
        })
    }

    pub async fn report(&self, batch: BatchId) -> Result<Report> {
        let local = self.local.lock().await;
        let details = local
            .batches
            .get(&batch)
            .cloned()
            .ok_or_else(|| TransferError::invalid("Lot inconnu"))?;
        Ok(self.project_report(details, self.engine.snapshot().await?))
    }

    fn project_report(&self, batch: BatchView, snapshot: Snapshot) -> Report {
        let generated = now();
        let timing = self.timing.0.lock().expect("timing");
        let mut started = None::<u64>;
        let mut last = None::<u64>;
        let jobs = snapshot
            .jobs
            .iter()
            .filter(|job| job.batch().to_string() == batch.id)
            .map(|job| {
                let time = timing.get(&job.attempt()).copied().unwrap_or_default();
                if let Some(start) = time.started {
                    started = Some(started.map_or(start, |prior| prior.min(start)));
                    let end = time.ended.unwrap_or(generated);
                    last = Some(last.map_or(end, |prior| prior.max(end)));
                }
                ReportJob {
                    source: hmp_contract::RecorderDto::from(job.request().recorder()),
                    transfer: JobDto::from(job),
                    started_at_millis: time.started.map(|time| time.to_string()),
                    ended_at_millis: time.ended.map(|time| time.to_string()),
                    elapsed_millis: time.started.map(|start| {
                        time.ended
                            .unwrap_or(generated)
                            .saturating_sub(start)
                            .to_string()
                    }),
                }
            })
            .collect();
        Report {
            schema_version: SCHEMA_VERSION,
            batch,
            elapsed_millis: last
                .zip(started)
                .map_or(0, |(end, start)| end.saturating_sub(start))
                .to_string(),
            generated_at_millis: generated.to_string(),
            jobs,
        }
    }

    pub fn engine(&self) -> &Engine {
        &self.engine
    }
}
