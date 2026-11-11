use async_trait::async_trait;
use hmp_core::{EngineEvent, ports::*};
use hmp_domain::*;
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tokio::sync::{Semaphore, watch};

/// A manually released, cancellation-safe rendezvous, with no timing assumptions.
pub struct Gate {
    entered: watch::Sender<u64>,
    permits: Semaphore,
}
impl Default for Gate {
    fn default() -> Self {
        Self {
            entered: watch::channel(0).0,
            permits: Semaphore::new(0),
        }
    }
}
impl Gate {
    pub async fn wait(&self) {
        self.entered.send_modify(|count| *count += 1);
        self.permits.acquire().await.expect("gate open").forget();
    }
    pub async fn entered(&self) {
        self.entered_count(1).await;
    }
    pub async fn entered_count(&self, count: u64) {
        let mut receiver = self.entered.subscribe();
        let _ = receiver.wait_for(|v| *v >= count).await;
    }
    pub fn entries(&self) -> u64 {
        *self.entered.borrow()
    }
    pub fn release(&self) {
        self.permits.add_permits(1);
    }
}
#[derive(Default)]
pub struct SequentialIds(AtomicU64);
impl IdSource for SequentialIds {
    fn next(&self) -> Uuid {
        Uuid::from_u128(u128::from(self.0.fetch_add(1, Ordering::SeqCst)) + 1)
    }
}
#[derive(Default)]
pub struct StepClock(AtomicU64);
impl Clock for StepClock {
    fn now_millis(&self) -> u64 {
        self.0.fetch_add(1, Ordering::SeqCst)
    }
}
#[derive(Default)]
pub struct RecordingSink(Mutex<VecDeque<EngineEvent>>);
impl RecordingSink {
    pub fn events(&self) -> Vec<EngineEvent> {
        self.0.lock().expect("events").iter().cloned().collect()
    }
}
impl EventSink for RecordingSink {
    fn publish(&self, event: &EngineEvent) {
        let mut events = self.0.lock().expect("events");
        if events.len() == 256 {
            events.pop_front();
        }
        events.push_back(event.clone());
    }
}
#[derive(Default)]
pub struct MemorySettings(Mutex<EngineConfig>);
#[async_trait]
impl SettingsPort for MemorySettings {
    async fn load(&self) -> Result<EngineConfig> {
        Ok(self.0.lock().expect("settings").clone())
    }
    async fn save(&self, config: &EngineConfig) -> Result<()> {
        config.validate()?;
        *self.0.lock().expect("settings") = config.clone();
        Ok(())
    }
}

#[derive(Clone)]
pub struct SimFile {
    pub data: Arc<Vec<u8>>,
    pub chunk_size: usize,
    pub read_error_after: Option<usize>,
    pub finish_error: Option<ErrorCode>,
    pub source_size: Option<u64>,
    pub read_gate: Option<Arc<Gate>>,
    pub finish_gate: Option<Arc<Gate>>,
}
impl SimFile {
    pub fn new(data: impl Into<Vec<u8>>) -> Self {
        let data = data.into();
        let size = data.len() as u64;
        Self {
            data: Arc::new(data),
            chunk_size: 4,
            read_error_after: None,
            finish_error: None,
            source_size: Some(size),
            read_gate: None,
            finish_gate: None,
        }
    }
}
#[derive(Default)]
struct RemoteState {
    files: BTreeMap<(RecorderId, RemotePath), SimFile>,
    recorders: BTreeMap<RecorderId, Recorder>,
    connection_errors: BTreeMap<RecorderId, ErrorCode>,
    connect_gates: BTreeMap<RecorderId, Arc<Gate>>,
    active: usize,
    peak: usize,
    per_recorder: BTreeMap<RecorderId, usize>,
    per_recorder_peak: BTreeMap<RecorderId, usize>,
    readers: usize,
}
#[derive(Clone, Default)]
pub struct SimRemote(Arc<Mutex<RemoteState>>);
impl SimRemote {
    pub fn insert(&self, recorder: Recorder, path: RemotePath, file: SimFile) {
        let mut state = self.0.lock().expect("remote");
        state.recorders.insert(recorder.id(), recorder.clone());
        state.files.insert((recorder.id(), path), file);
    }
    pub fn connection_error(&self, id: RecorderId, error: Option<ErrorCode>) {
        let mut state = self.0.lock().expect("remote");
        if let Some(error) = error {
            state.connection_errors.insert(id, error);
        } else {
            state.connection_errors.remove(&id);
        }
    }
    pub fn connect_gate(&self, id: RecorderId, gate: Arc<Gate>) {
        self.0
            .lock()
            .expect("remote")
            .connect_gates
            .insert(id, gate);
    }
    pub fn active(&self) -> (usize, usize) {
        let state = self.0.lock().expect("remote");
        (state.active, state.readers)
    }
    pub fn peak(&self) -> usize {
        self.0.lock().expect("remote").peak
    }
    pub fn recorder_peak(&self, id: RecorderId) -> usize {
        *self
            .0
            .lock()
            .expect("remote")
            .per_recorder_peak
            .get(&id)
            .unwrap_or(&0)
    }
    pub fn source_bytes(&self, id: RecorderId, path: &RemotePath) -> Vec<u8> {
        self.0.lock().expect("remote").files[&(id, path.clone())]
            .data
            .as_ref()
            .clone()
    }
}
#[async_trait]
impl DiscoveryPort for SimRemote {
    async fn interfaces(&self) -> Result<Vec<String>> {
        Ok(vec!["simulation-only".into()])
    }
    async fn discover(&self, scope: &str, cancel: &Cancellation) -> Result<Vec<Recorder>> {
        if cancel.is_cancelled() {
            return Err(TransferError::cancelled());
        }
        if scope != "simulation-only" {
            return Err(TransferError::invalid("real discovery is unavailable"));
        }
        Ok(self
            .0
            .lock()
            .expect("remote")
            .recorders
            .values()
            .cloned()
            .collect())
    }
}
#[async_trait]
impl RemoteReadPort for SimRemote {
    async fn connect(
        &self,
        recorder: &Recorder,
        cancel: &Cancellation,
    ) -> Result<Box<dyn RemoteReadSession>> {
        let (error, gate) = {
            let state = self.0.lock().expect("remote");
            (
                state.connection_errors.get(&recorder.id()).copied(),
                state.connect_gates.get(&recorder.id()).cloned(),
            )
        };
        if let Some(gate) = gate {
            gate.wait().await;
        }
        if cancel.is_cancelled() {
            return Err(TransferError::cancelled());
        }
        if let Some(error) = error {
            return Err(TransferError::new(
                error,
                Phase::Connecting,
                "simulated connection failure",
            ));
        }
        let mut state = self.0.lock().expect("remote");
        if !state.recorders.contains_key(&recorder.id()) {
            return Err(TransferError::new(
                ErrorCode::RemoteUnavailable,
                Phase::Connecting,
                "simulated recorder not found",
            ));
        }
        state.active += 1;
        state.peak = state.peak.max(state.active);
        let count = state.per_recorder.entry(recorder.id()).or_default();
        *count += 1;
        let count = *count;
        let peak = state.per_recorder_peak.entry(recorder.id()).or_default();
        *peak = (*peak).max(count);
        Ok(Box::new(SimSession {
            state: self.0.clone(),
            recorder: recorder.id(),
            closed: false,
        }))
    }
}
struct SimSession {
    state: Arc<Mutex<RemoteState>>,
    recorder: RecorderId,
    closed: bool,
}
impl SimSession {
    fn release(&mut self) {
        if !self.closed {
            let mut state = self.state.lock().expect("remote");
            state.active -= 1;
            *state
                .per_recorder
                .get_mut(&self.recorder)
                .expect("active recorder") -= 1;
            self.closed = true;
        }
    }
}
impl Drop for SimSession {
    fn drop(&mut self) {
        self.release();
    }
}
#[async_trait]
impl RemoteReadSession for SimSession {
    async fn list(&mut self, path: &RemotePath, cancel: &Cancellation) -> Result<Vec<MediaEntry>> {
        if self.closed {
            return Err(TransferError::invalid("closed session"));
        }
        if cancel.is_cancelled() {
            return Err(TransferError::cancelled());
        }
        let state = self.state.lock().expect("remote");
        let mut result = BTreeMap::new();
        let prefix = format!("{}/", path.as_str().trim_end_matches('/'));
        for ((id, p), file) in &state.files {
            if *id != self.recorder {
                continue;
            }
            if let Some(suffix) = p.as_str().strip_prefix(&prefix) {
                let name = suffix.split('/').next().unwrap_or_default();
                if name.is_empty() {
                    continue;
                }
                let directory = suffix.contains('/');
                let child = RemotePath::new(&format!("{prefix}{name}"))?;
                result.insert(
                    child.clone(),
                    MediaEntry::new(
                        *id,
                        child,
                        (!directory).then_some(file.data.len() as u64),
                        directory,
                    )?,
                );
            }
        }
        Ok(result.into_values().collect())
    }
    async fn open_read(
        &mut self,
        path: &RemotePath,
        cancel: &Cancellation,
    ) -> Result<Box<dyn RemoteReader>> {
        if self.closed || cancel.is_cancelled() {
            return Err(TransferError::cancelled());
        }
        let mut state = self.state.lock().expect("remote");
        let file = state
            .files
            .get(&(self.recorder, path.clone()))
            .cloned()
            .ok_or_else(|| {
                TransferError::new(
                    ErrorCode::RemoteUnavailable,
                    Phase::Connecting,
                    "simulated file missing",
                )
            })?;
        state.readers += 1;
        Ok(Box::new(SimReader {
            file,
            offset: 0,
            state: self.state.clone(),
            closed: false,
            finished: false,
        }))
    }
    async fn close(&mut self) -> Result<()> {
        self.release();
        Ok(())
    }
}
struct SimReader {
    file: SimFile,
    offset: usize,
    state: Arc<Mutex<RemoteState>>,
    closed: bool,
    finished: bool,
}
impl SimReader {
    fn release(&mut self) {
        if !self.closed {
            self.state.lock().expect("remote").readers -= 1;
            self.closed = true;
        }
    }
}
impl Drop for SimReader {
    fn drop(&mut self) {
        self.release();
    }
}
#[async_trait]
impl RemoteReader for SimReader {
    async fn read_chunk(&mut self, buffer: &mut [u8], cancel: &Cancellation) -> Result<usize> {
        if self.closed || cancel.is_cancelled() {
            return Err(TransferError::cancelled());
        }
        if let Some(gate) = self.file.read_gate.take() {
            gate.wait().await;
        }
        if self
            .file
            .read_error_after
            .is_some_and(|after| self.offset >= after)
        {
            return Err(TransferError::new(
                ErrorCode::ConnectionLost,
                Phase::Copying,
                "simulated connection interruption",
            ));
        }
        let n = buffer
            .len()
            .min(self.file.chunk_size.max(1))
            .min(self.file.data.len() - self.offset);
        buffer[..n].copy_from_slice(&self.file.data[self.offset..self.offset + n]);
        self.offset += n;
        Ok(n)
    }
    async fn finish(&mut self, cancel: &Cancellation) -> Result<RemoteCompletion> {
        if let Some(gate) = self.file.finish_gate.take() {
            gate.wait().await;
        }
        if self.closed || cancel.is_cancelled() {
            return Err(TransferError::cancelled());
        }
        if self.offset != self.file.data.len() {
            return Err(TransferError::new(
                ErrorCode::ConnectionLost,
                Phase::Copying,
                "data EOF not reached",
            ));
        }
        if let Some(error) = self.file.finish_error {
            return Err(TransferError::new(
                error,
                Phase::Copying,
                "simulated missing final success response",
            ));
        }
        self.finished = true;
        Ok(RemoteCompletion {
            source_size: self.file.source_size,
        })
    }
    async fn close(&mut self) -> Result<()> {
        self.release();
        Ok(())
    }
}
