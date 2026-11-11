//! Real files in a private temporary sandbox, deliberately not a production
//! destination adapter. File I/O here is synchronous and bounded by test chunks.
use crate::Gate;
use async_trait::async_trait;
use hmp_core::ports::*;
use hmp_domain::*;
use std::{
    collections::{BTreeMap, HashMap},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tempfile::TempDir;

#[derive(Clone, Default)]
pub struct DiskFaults {
    pub reserve_error: Option<ErrorCode>,
    pub create_error: Option<ErrorCode>,
    pub write_error_after: Option<u64>,
    pub flush_error: bool,
    pub read_error_after: Option<u64>,
    pub corrupt_readback: bool,
    pub read_gate: Option<Arc<Gate>>,
    pub prepare_gate: Option<Arc<Gate>>,
    pub commit_error: bool,
}
struct Held {
    reservation: Reservation,
    policy: DuplicatePolicy,
    expected_size: Option<u64>,
}
#[derive(Default)]
struct State {
    held: HashMap<Uuid, Held>,
    keys: BTreeMap<String, Uuid>,
    publications: usize,
}
pub struct SandboxDestination {
    directory: TempDir,
    state: Mutex<State>,
    faults: Arc<Mutex<DiskFaults>>,
    tokens: AtomicU64,
}
fn disk_error(error: std::io::Error, phase: Phase) -> TransferError {
    let code = match error.kind() {
        std::io::ErrorKind::PermissionDenied => ErrorCode::PermissionDenied,
        std::io::ErrorKind::AlreadyExists => ErrorCode::DestinationConflict,
        std::io::ErrorKind::StorageFull => ErrorCode::DestinationFull,
        _ => ErrorCode::LocalIo,
    };
    TransferError::new(code, phase, format!("sandbox I/O: {:?}", error.kind()))
}
fn fault(code: ErrorCode, phase: Phase) -> TransferError {
    TransferError::new(code, phase, "injected disk error")
}
impl SandboxDestination {
    pub fn new() -> Result<Self> {
        Ok(Self {
            directory: tempfile::Builder::new()
                .prefix("hmp-v2-test-")
                .tempdir()
                .map_err(|e| disk_error(e, Phase::Planning))?,
            state: Mutex::new(State::default()),
            faults: Arc::new(Mutex::new(DiskFaults::default())),
            tokens: AtomicU64::new(1),
        })
    }
    pub fn set_faults(&self, faults: DiskFaults) {
        *self.faults.lock().expect("faults") = faults;
    }
    pub fn seed(&self, name: &LocalName, data: &[u8]) -> Result<()> {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(self.directory.path().join(name.as_str()))
            .map_err(|e| disk_error(e, Phase::Planning))?;
        file.write_all(data)
            .map_err(|e| disk_error(e, Phase::Planning))
    }
    pub fn final_bytes(&self, name: &LocalName) -> Result<Vec<u8>> {
        fs::read(self.directory.path().join(name.as_str()))
            .map_err(|e| disk_error(e, Phase::Planning))
    }
    pub fn partial_names(&self) -> Vec<String> {
        fs::read_dir(self.directory.path())
            .expect("sandbox exists")
            .map(|e| {
                e.expect("sandbox entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .filter(|name| name.starts_with(".hmp-") && name.ends_with(".part"))
            .collect()
    }
    pub fn partial_bytes(&self, job: &TransferJob) -> Result<Vec<u8>> {
        fs::read(self.directory.path().join(job.partial_name()))
            .map_err(|e| disk_error(e, Phase::Planning))
    }
    pub fn reservations(&self) -> usize {
        self.state.lock().expect("state").held.len()
    }
    pub fn publications(&self) -> usize {
        self.state.lock().expect("state").publications
    }
    fn valid(&self, reservation: &Reservation) -> Result<()> {
        let state = self.state.lock().expect("state");
        let held = state
            .held
            .get(&reservation.token)
            .ok_or_else(|| fault(ErrorCode::DestinationConflict, Phase::Planning))?;
        if held.reservation.job != reservation.job
            || held.reservation.attempt != reservation.attempt
            || held.reservation.partial_name != reservation.partial_name
            || held.reservation.final_name != reservation.final_name
        {
            return Err(TransferError::invalid("forged reservation"));
        }
        Ok(())
    }
    fn existing(&self, name: &LocalName) -> Result<Option<LocalName>> {
        for entry in
            fs::read_dir(self.directory.path()).map_err(|e| disk_error(e, Phase::Planning))?
        {
            let entry = entry.map_err(|e| disk_error(e, Phase::Planning))?;
            if entry.file_name().to_string_lossy().to_ascii_lowercase() == name.reservation_key() {
                let kind = entry
                    .file_type()
                    .map_err(|e| disk_error(e, Phase::Planning))?;
                if !kind.is_file() || kind.is_symlink() {
                    return Err(fault(ErrorCode::PermissionDenied, Phase::Planning));
                }
                return LocalName::new(&entry.file_name().to_string_lossy()).map(Some);
            }
        }
        Ok(None)
    }
    fn regular_file(path: &Path) -> Result<()> {
        let metadata = fs::symlink_metadata(path).map_err(|e| disk_error(e, Phase::Finalizing))?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(fault(ErrorCode::PermissionDenied, Phase::Finalizing));
        }
        Ok(())
    }
}
#[async_trait]
impl DestinationPort for SandboxDestination {
    async fn reserve(
        &self,
        name: &LocalName,
        policy: DuplicatePolicy,
        job: JobId,
        attempt: AttemptId,
    ) -> Result<ReservationOutcome> {
        if let Some(code) = self.faults.lock().expect("faults").reserve_error {
            return Err(fault(code, Phase::Planning));
        }
        let mut state = self.state.lock().expect("state");
        let mut candidate = name.clone();
        for index in 0..10_000 {
            if index > 0 {
                candidate = name.renamed(index)?;
            }
            let existing = self.existing(&candidate)?;
            let busy = state.keys.contains_key(&candidate.reservation_key());
            match policy {
                DuplicatePolicy::Skip if busy => {
                    return Err(fault(ErrorCode::DestinationConflict, Phase::Planning));
                }
                DuplicatePolicy::Skip if existing.is_some() => {
                    return Ok(ReservationOutcome::Skipped(
                        existing.expect("existing").as_str().into(),
                    ));
                }
                DuplicatePolicy::Overwrite if busy => {
                    return Err(fault(ErrorCode::DestinationConflict, Phase::Planning));
                }
                DuplicatePolicy::Rename if existing.is_some() || busy => continue,
                _ => {}
            }
            if let Some(existing) = existing {
                candidate = existing;
            }
            let token = Uuid::from_u128(u128::from(self.tokens.fetch_add(1, Ordering::SeqCst)));
            let reservation = Reservation {
                token,
                final_name: candidate.clone(),
                partial_name: format!(".hmp-{job}-{attempt}.part"),
                job,
                attempt,
            };
            state.keys.insert(candidate.reservation_key(), token);
            state.held.insert(
                token,
                Held {
                    reservation: reservation.clone(),
                    policy,
                    expected_size: None,
                },
            );
            return Ok(ReservationOutcome::Reserved(reservation));
        }
        Err(fault(ErrorCode::DestinationConflict, Phase::Planning))
    }
    async fn create_partial(&self, reservation: &Reservation) -> Result<Box<dyn LocalWriter>> {
        self.valid(reservation)?;
        if let Some(code) = self.faults.lock().expect("faults").create_error {
            return Err(fault(code, Phase::Copying));
        }
        let file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(self.directory.path().join(&reservation.partial_name))
            .map_err(|e| disk_error(e, Phase::Copying))?;
        Ok(Box::new(SandboxWriter {
            file,
            bytes: 0,
            faults: self.faults.clone(),
        }))
    }
    async fn open_readback(&self, reservation: &Reservation) -> Result<Box<dyn LocalReader>> {
        self.valid(reservation)?;
        let path = self.directory.path().join(&reservation.partial_name);
        Self::regular_file(&path)?;
        let file = File::open(path).map_err(|e| disk_error(e, Phase::Verifying))?;
        let faults = self.faults.lock().expect("faults").clone();
        Ok(Box::new(SandboxReader {
            file,
            bytes: 0,
            faults,
            corrupted: false,
        }))
    }
    async fn prepare_commit(&self, reservation: &Reservation, expected_size: u64) -> Result<()> {
        self.valid(reservation)?;
        let gate = self.faults.lock().expect("faults").prepare_gate.clone();
        if let Some(gate) = gate {
            gate.wait().await;
        }
        let path = self.directory.path().join(&reservation.partial_name);
        Self::regular_file(&path)?;
        let size = fs::metadata(path)
            .map_err(|e| disk_error(e, Phase::Finalizing))?
            .len();
        if size != expected_size {
            return Err(fault(ErrorCode::SizeMismatch, Phase::Finalizing));
        }
        self.state
            .lock()
            .expect("state")
            .held
            .get_mut(&reservation.token)
            .expect("reservation")
            .expected_size = Some(size);
        Ok(())
    }
    fn commit(&self, reservation: &Reservation, policy: DuplicatePolicy) -> Result<String> {
        self.valid(reservation)?;
        let mut state = self.state.lock().expect("state");
        let held = &state.held[&reservation.token];
        if held.policy != policy || held.expected_size.is_none() {
            return Err(fault(ErrorCode::FinalizationFailed, Phase::Finalizing));
        }
        if self.faults.lock().expect("faults").commit_error {
            return Err(fault(ErrorCode::FinalizationFailed, Phase::Finalizing));
        }
        let partial = self.directory.path().join(&reservation.partial_name);
        Self::regular_file(&partial)?;
        if fs::metadata(&partial)
            .map_err(|e| disk_error(e, Phase::Finalizing))?
            .len()
            != held.expected_size.expect("prepared")
        {
            return Err(fault(ErrorCode::SizeMismatch, Phase::Finalizing));
        }
        let final_path = self.directory.path().join(reservation.final_name.as_str());
        if policy == DuplicatePolicy::Overwrite {
            if let Some(existing) = self.existing(&reservation.final_name)? {
                Self::regular_file(&self.directory.path().join(existing.as_str()))?;
            }
            fs::rename(&partial, &final_path).map_err(|e| disk_error(e, Phase::Finalizing))?;
        } else {
            if self.existing(&reservation.final_name)?.is_some() {
                return Err(fault(ErrorCode::DestinationConflict, Phase::Finalizing));
            }
            fs::hard_link(&partial, &final_path).map_err(|e| disk_error(e, Phase::Finalizing))?;
            // Publication already committed; failure to unlink is only a duplicate diagnostic partial.
            let _ = fs::remove_file(&partial);
        }
        state.publications += 1;
        Ok(reservation.final_name.as_str().into())
    }
    fn release(&self, reservation: &Reservation) {
        let mut state = self.state.lock().expect("state");
        if let Some(held) = state.held.remove(&reservation.token) {
            state
                .keys
                .remove(&held.reservation.final_name.reservation_key());
        }
    }
}
struct SandboxWriter {
    file: File,
    bytes: u64,
    faults: Arc<Mutex<DiskFaults>>,
}
#[async_trait]
impl LocalWriter for SandboxWriter {
    async fn write_all(&mut self, data: &[u8]) -> Result<()> {
        let after = self.faults.lock().expect("faults").write_error_after;
        let n = after.map_or(data.len(), |limit| {
            data.len().min(limit.saturating_sub(self.bytes) as usize)
        });
        self.file
            .write_all(&data[..n])
            .map_err(|e| disk_error(e, Phase::Copying))?;
        self.bytes += n as u64;
        if n < data.len() {
            return Err(fault(ErrorCode::DestinationFull, Phase::Copying));
        }
        Ok(())
    }
    async fn finish(&mut self) -> Result<()> {
        if self.faults.lock().expect("faults").flush_error {
            return Err(fault(ErrorCode::LocalIo, Phase::Copying));
        }
        self.file
            .flush()
            .and_then(|()| self.file.sync_all())
            .map_err(|e| disk_error(e, Phase::Copying))
    }
    fn bytes_written(&self) -> u64 {
        self.bytes
    }
}
struct SandboxReader {
    file: File,
    bytes: u64,
    faults: DiskFaults,
    corrupted: bool,
}
#[async_trait]
impl LocalReader for SandboxReader {
    async fn read_chunk(&mut self, buffer: &mut [u8]) -> Result<usize> {
        if let Some(gate) = self.faults.read_gate.take() {
            gate.wait().await;
        }
        if self
            .faults
            .read_error_after
            .is_some_and(|after| self.bytes >= after)
        {
            return Err(fault(ErrorCode::LocalIo, Phase::Verifying));
        }
        let n = self
            .file
            .read(buffer)
            .map_err(|e| disk_error(e, Phase::Verifying))?;
        if n > 0 && self.faults.corrupt_readback && !self.corrupted {
            buffer[0] ^= 1;
            self.corrupted = true;
        }
        self.bytes += n as u64;
        Ok(n)
    }
}
