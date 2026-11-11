//! Destination rooted in an open directory capability. Only portable leaf names
//! reach publication. Each destination has its own exclusively created staging area.
use async_trait::async_trait;
use cap_std::{
    ambient_authority,
    fs::{Dir, DirBuilder, File, Metadata, MetadataExt, OpenOptions},
};
use hmp_core::ports::*;
use hmp_domain::*;
use std::{
    collections::{HashMap, HashSet},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

pub struct LocalDestination {
    path: PathBuf,
    root: Arc<Dir>,
    stage_name: String,
    stage: Arc<Dir>,
    held: Mutex<HashMap<Uuid, Held>>,
}

struct Held {
    reservation: Reservation,
    policy: DuplicatePolicy,
    replace: bool,
    file: Option<File>,
    prepared: Option<u64>,
}

fn disk(error: io::Error, phase: Phase) -> TransferError {
    let code = match error.kind() {
        io::ErrorKind::PermissionDenied | io::ErrorKind::ReadOnlyFilesystem => {
            ErrorCode::PermissionDenied
        }
        io::ErrorKind::AlreadyExists => ErrorCode::DestinationConflict,
        io::ErrorKind::StorageFull | io::ErrorKind::QuotaExceeded => ErrorCode::DestinationFull,
        _ if phase == Phase::Finalizing => ErrorCode::FinalizationFailed,
        _ => ErrorCode::LocalIo,
    };
    TransferError::new(code, phase, format!("Destination : {error}"))
}

fn conflict(phase: Phase, message: &str) -> TransferError {
    TransferError::new(ErrorCode::DestinationConflict, phase, message)
}

fn regular(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    if metadata.file_attributes() & 0x400 != 0 {
        return false;
    }
    metadata.is_file() && !metadata.is_symlink()
}

#[cfg(unix)]
fn same_file(left: &Metadata, right: &Metadata) -> bool {
    left.dev() == right.dev() && left.ino() == right.ino()
}

#[cfg(windows)]
fn same_handle(left: std::fs::File, right: std::fs::File) -> io::Result<bool> {
    Ok(same_file::Handle::from_file(left)? == same_file::Handle::from_file(right)?)
}

async fn blocking<T: Send + 'static>(
    phase: Phase,
    work: impl FnOnce() -> io::Result<T> + Send + 'static,
) -> Result<T> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| disk(io::Error::other(error), phase))?
        .map_err(|error| disk(error, phase))
}

fn metadata(dir: &Dir, name: &str) -> io::Result<Option<Metadata>> {
    match dir.symlink_metadata(name) {
        Ok(entry) => Ok(Some(entry)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn no_replace(source: &Dir, partial: &str, target: &Dir, name: &str) -> io::Result<()> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        rustix::fs::renameat_with(
            source,
            partial,
            target,
            name,
            rustix::fs::RenameFlags::NOREPLACE,
        )
        .map_err(io::Error::from)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        if metadata(target, name)?.is_some() {
            return Err(io::ErrorKind::AlreadyExists.into());
        }
        source.hard_link(partial, target, name)?;
        // The final entry has been published. Cleanup cannot undo that publication.
        let _ = source.remove_file(partial);
        Ok(())
    }
}

impl LocalDestination {
    pub async fn open(path: PathBuf) -> Result<Self> {
        blocking(Phase::Planning, move || Self::open_directory(&path)).await
    }

    fn open_directory(path: &Path) -> io::Result<Self> {
        let selection = std::fs::symlink_metadata(path)?;
        if !path.is_absolute() || !selection.is_dir() || selection.is_symlink() {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "Dossier absolu sans lien requis",
            ));
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt as _;
            if selection.file_attributes() & 0x400 != 0 {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "Point de réanalyse refusé",
                ));
            }
        }
        let path = std::fs::canonicalize(path)?;
        let root = Dir::open_ambient_dir(&path, ambient_authority())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt as _;
            let opened = root.dir_metadata()?;
            if opened.dev() != selection.dev() || opened.ino() != selection.ino() {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "Le dossier sélectionné a changé",
                ));
            }
        }
        let stage_name = format!(".hmp-{}", Uuid::new_v4());
        let builder = DirBuilder::new();
        #[cfg(unix)]
        let builder = {
            use cap_std::fs::DirBuilderExt;
            let mut builder = builder;
            builder.mode(0o700);
            builder
        };
        root.create_dir_with(&stage_name, &builder)?;
        let staged = (|| {
            let stage = root.open_dir(&stage_name)?;
            // Probe only names created by this process, inside its staging directory.
            stage.open_with("probe", OpenOptions::new().write(true).create_new(true))?;
            let published = no_replace(&stage, "probe", &stage, "probe-final");
            let _ = stage.remove_file("probe");
            let _ = stage.remove_file("probe-final");
            published.map_err(|error| {
                if error.kind() == io::ErrorKind::Unsupported {
                    io::Error::new(
                        error.kind(),
                        "Publication sans remplacement indisponible sur ce volume",
                    )
                } else {
                    error
                }
            })?;
            Ok(stage)
        })();
        let stage = match staged {
            Ok(stage) => stage,
            Err(error) => {
                let _ = root.remove_dir(&stage_name);
                return Err(error);
            }
        };
        Ok(Self {
            path,
            root: Arc::new(root),
            stage_name,
            stage: Arc::new(stage),
            held: Mutex::default(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn staging_path(&self) -> PathBuf {
        self.path.join(&self.stage_name)
    }

    pub async fn available_space(&self) -> Option<u64> {
        #[cfg(unix)]
        let work = {
            let root = self.root.clone();
            move || {
                rustix::fs::fstatvfs(&*root)
                    .ok()
                    .map(|stat| stat.f_bavail.saturating_mul(stat.f_frsize))
            }
        };
        #[cfg(windows)]
        let work = {
            let path = self.path.clone();
            move || fs2::available_space(path).ok()
        };
        tokio::task::spawn_blocking(work).await.ok().flatten()
    }

    fn with_held<T>(
        &self,
        reservation: &Reservation,
        action: impl FnOnce(&mut Held) -> Result<T>,
    ) -> Result<T> {
        let mut held = self.held.lock().expect("destination reservations");
        let entry = held
            .get_mut(&reservation.token)
            .filter(|entry| {
                let known = &entry.reservation;
                known.job == reservation.job
                    && known.attempt == reservation.attempt
                    && known.final_name == reservation.final_name
                    && known.partial_name == reservation.partial_name
            })
            .ok_or_else(|| conflict(Phase::Planning, "Réservation inconnue"))?;
        action(entry)
    }
}

impl Drop for LocalDestination {
    fn drop(&mut self) {
        // Only remove an empty staging directory, and only if it is still the one we opened.
        let remove = || -> io::Result<bool> {
            let current = self.root.symlink_metadata(&self.stage_name)?;
            if !current.is_dir() || current.is_symlink() {
                return Ok(false);
            }
            #[cfg(unix)]
            return Ok(same_file(&current, &self.stage.dir_metadata()?));
            #[cfg(windows)]
            {
                if current.file_attributes() & 0x400 != 0 {
                    return Ok(false);
                }
                let named = self.root.open_dir(&self.stage_name)?;
                same_handle(
                    named.into_std_file(),
                    self.stage.try_clone()?.into_std_file(),
                )
            }
        };
        if remove().unwrap_or(false) {
            let stage = std::mem::replace(&mut self.stage, self.root.clone());
            if let Ok(stage) = Arc::try_unwrap(stage) {
                let _ = stage.remove_open_dir();
            }
        }
    }
}

#[async_trait]
impl DestinationPort for LocalDestination {
    async fn check_space(&self, expected: Option<u64>) -> Result<()> {
        if let Some(bytes) = expected {
            if self
                .available_space()
                .await
                .is_some_and(|free| free < bytes)
            {
                return Err(TransferError::new(
                    ErrorCode::DestinationFull,
                    Phase::Planning,
                    "Espace disponible insuffisant",
                ));
            }
        }
        Ok(())
    }

    async fn reserve(
        &self,
        name: &LocalName,
        policy: DuplicatePolicy,
        job: JobId,
        attempt: AttemptId,
    ) -> Result<ReservationOutcome> {
        let root = self.root.clone();
        let listing = blocking(Phase::Planning, move || {
            let mut listing = HashMap::<String, Vec<String>>::new();
            for entry in root.entries()? {
                if let Ok(name) = entry?.file_name().into_string() {
                    listing
                        .entry(name.to_ascii_lowercase())
                        .or_default()
                        .push(name);
                }
            }
            Ok(listing)
        })
        .await?;
        let mut held = self.held.lock().expect("destination reservations");
        let busy: HashSet<_> = held
            .values()
            .map(|entry| entry.reservation.final_name.reservation_key())
            .collect();
        for index in 0..10_000 {
            let mut final_name = if index == 0 {
                name.clone()
            } else {
                name.renamed(index)?
            };
            let key = final_name.reservation_key();
            let existing = listing.get(&key);
            if policy == DuplicatePolicy::Rename && (existing.is_some() || busy.contains(&key)) {
                continue;
            }
            if busy.contains(&key) {
                return Err(conflict(Phase::Planning, "Destination déjà réservée"));
            }
            let exact =
                metadata(&self.root, final_name.as_str()).map_err(|e| disk(e, Phase::Planning))?;
            if policy == DuplicatePolicy::Rename && exact.is_some() {
                continue;
            }
            if let Some(matches) = existing {
                if matches.len() != 1 {
                    return Err(conflict(
                        Phase::Planning,
                        "Plusieurs noms correspondent sur le volume",
                    ));
                }
                final_name = LocalName::new(&matches[0])?;
                let file = metadata(&self.root, final_name.as_str())
                    .map_err(|e| disk(e, Phase::Planning))?;
                if !file.as_ref().is_some_and(regular) {
                    return Err(conflict(
                        Phase::Planning,
                        "La destination existante a changé ou n’est pas un fichier ordinaire",
                    ));
                }
            }
            if existing.is_none() && exact.as_ref().is_some_and(|file| !regular(file)) {
                return Err(conflict(
                    Phase::Planning,
                    "La destination n’est pas un fichier ordinaire",
                ));
            }
            let replace = existing.is_some() || exact.is_some();
            if replace && policy == DuplicatePolicy::Skip {
                return Ok(ReservationOutcome::Skipped(
                    self.path
                        .join(final_name.as_str())
                        .to_string_lossy()
                        .into_owned(),
                ));
            }
            let reservation = Reservation {
                token: Uuid::new_v4(),
                final_name,
                partial_name: format!(".hmp-{job}-{attempt}.part"),
                job,
                attempt,
            };
            held.insert(
                reservation.token,
                Held {
                    reservation: reservation.clone(),
                    policy,
                    replace,
                    file: None,
                    prepared: None,
                },
            );
            return Ok(ReservationOutcome::Reserved(reservation));
        }
        Err(conflict(
            Phase::Planning,
            "Aucun nom de destination disponible",
        ))
    }

    async fn create_partial(&self, reservation: &Reservation) -> Result<Box<dyn LocalWriter>> {
        self.with_held(reservation, |_| Ok(()))?;
        let stage = self.stage.clone();
        let name = reservation.partial_name.clone();
        let file = blocking(Phase::Copying, move || {
            stage.open_with(
                name,
                OpenOptions::new().read(true).write(true).create_new(true),
            )
        })
        .await?;
        let writer = file.try_clone().map_err(|e| disk(e, Phase::Copying))?;
        self.with_held(reservation, |held| {
            held.file = Some(file);
            Ok(())
        })?;
        Ok(Box::new(Writer {
            file: Arc::new(Mutex::new(writer.into_std())),
            bytes: 0,
        }))
    }

    async fn open_readback(&self, reservation: &Reservation) -> Result<Box<dyn LocalReader>> {
        let file = self.with_held(reservation, |held| {
            held.file
                .as_ref()
                .ok_or_else(|| conflict(Phase::Verifying, "Temporaire absent"))?
                .try_clone()
                .map_err(|e| disk(e, Phase::Verifying))
        })?;
        let mut file = tokio::fs::File::from_std(file.into_std());
        file.seek(io::SeekFrom::Start(0))
            .await
            .map_err(|e| disk(e, Phase::Verifying))?;
        Ok(Box::new(Reader(file)))
    }

    async fn prepare_commit(&self, reservation: &Reservation, expected_size: u64) -> Result<()> {
        self.with_held(reservation, |held| {
            if held.file.is_none() {
                return Err(conflict(Phase::Finalizing, "Temporaire absent"));
            }
            held.prepared = Some(expected_size);
            Ok(())
        })
    }

    fn commit(&self, reservation: &Reservation, policy: DuplicatePolicy) -> Result<String> {
        let phase = Phase::Finalizing;
        self.with_held(reservation, |held| {
            let name = reservation.final_name.as_str();
            let partial = &reservation.partial_name;
            let opened = held
                .file
                .as_ref()
                .ok_or_else(|| conflict(phase, "Temporaire absent"))?;
            let current = self
                .stage
                .symlink_metadata(partial)
                .map_err(|e| disk(e, phase))?;
            if !regular(&current) {
                return Err(conflict(
                    phase,
                    "Le temporaire n’est plus un fichier ordinaire",
                ));
            }
            #[cfg(unix)]
            let identical = same_file(&opened.metadata().map_err(|e| disk(e, phase))?, &current);
            #[cfg(windows)]
            let identical = same_handle(
                opened.try_clone().map_err(|e| disk(e, phase))?.into_std(),
                self.stage
                    .open(partial)
                    .map_err(|e| disk(e, phase))?
                    .into_std(),
            )
            .map_err(|e| disk(e, phase))?;
            if !identical {
                return Err(conflict(phase, "Le temporaire a été remplacé"));
            }
            if held.policy != policy || held.prepared != Some(current.len()) {
                return Err(TransferError::new(
                    ErrorCode::SizeMismatch,
                    phase,
                    "Temporaire non préparé ou taille modifiée",
                ));
            }
            if held.replace && policy == DuplicatePolicy::Overwrite {
                if !metadata(&self.root, name)
                    .map_err(|e| disk(e, phase))?
                    .as_ref()
                    .is_some_and(regular)
                {
                    return Err(conflict(
                        phase,
                        "Le fichier à remplacer a disparu ou changé de type",
                    ));
                }
                self.stage
                    .rename(partial, &self.root, name)
                    .map_err(|e| disk(e, phase))?;
            } else {
                no_replace(&self.stage, partial, &self.root, name).map_err(|e| disk(e, phase))?;
            }
            Ok(self.path.join(name).to_string_lossy().into_owned())
        })
    }

    fn release(&self, reservation: &Reservation) {
        self.held
            .lock()
            .expect("destination reservations")
            .remove(&reservation.token);
    }
}

struct Writer {
    file: Arc<Mutex<std::fs::File>>,
    bytes: u64,
}

#[async_trait]
impl LocalWriter for Writer {
    async fn write_all(&mut self, data: &[u8]) -> Result<()> {
        let file = self.file.clone();
        let data = data.to_vec();
        let (written, result) = blocking(Phase::Copying, move || {
            let mut file = file.lock().expect("writer");
            let mut written = 0;
            while written < data.len() {
                match file.write(&data[written..]) {
                    Ok(0) => return Ok((written, Err(io::ErrorKind::WriteZero.into()))),
                    Ok(count) => written += count,
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                    Err(error) => return Ok((written, Err(error))),
                }
            }
            Ok((written, Ok(())))
        })
        .await?;
        self.bytes += written as u64;
        result.map_err(|error| disk(error, Phase::Copying))
    }

    async fn finish(&mut self) -> Result<()> {
        let file = self.file.clone();
        blocking(Phase::Copying, move || {
            let mut file = file.lock().expect("writer");
            file.flush()?;
            file.sync_all()
        })
        .await
    }

    fn bytes_written(&self) -> u64 {
        self.bytes
    }
}

struct Reader(tokio::fs::File);

#[async_trait]
impl LocalReader for Reader {
    async fn read_chunk(&mut self, buffer: &mut [u8]) -> Result<usize> {
        self.0
            .read(buffer)
            .await
            .map_err(|e| disk(e, Phase::Verifying))
    }
}
