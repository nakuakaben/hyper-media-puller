//! Port implementations must be cancellation safe; commit/release are short,
//! non-blocking linearization operations. No remote mutation capability exists.
use crate::EngineEvent;
use async_trait::async_trait;
use hmp_domain::*;
use std::{sync::Arc, time::Duration};
use tokio::sync::watch;

#[derive(Clone, Debug)]
pub struct Cancellation(watch::Sender<bool>);
impl Default for Cancellation {
    fn default() -> Self {
        Self(watch::channel(false).0)
    }
}
impl Cancellation {
    pub fn cancel(&self) {
        self.0.send_replace(true);
    }
    pub fn is_cancelled(&self) -> bool {
        *self.0.borrow()
    }
    pub async fn cancelled(&self) {
        let mut receiver = self.0.subscribe();
        let _ = receiver.wait_for(|value| *value).await;
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EngineConfig {
    pub global_limit: usize,
    pub recorder_limit: usize,
    pub verification_limit: usize,
    pub operation_timeout: Duration,
}
impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            global_limit: 2,
            recorder_limit: 1,
            verification_limit: 1,
            operation_timeout: Duration::from_secs(30),
        }
    }
}
impl EngineConfig {
    pub fn validate(&self) -> Result<()> {
        if self.global_limit == 0
            || self.global_limit > 64
            || self.recorder_limit == 0
            || self.recorder_limit > self.global_limit
            || self.verification_limit == 0
            || self.verification_limit > 64
            || self.operation_timeout.is_zero()
        {
            return Err(TransferError::new(
                ErrorCode::InvalidSettings,
                Phase::Planning,
                "invalid scheduler limits",
            ));
        }
        Ok(())
    }
}
#[async_trait]
pub trait DiscoveryPort: Send + Sync {
    async fn interfaces(&self) -> Result<Vec<String>>;
    async fn discover(&self, scope: &str, cancel: &Cancellation) -> Result<Vec<Recorder>>;
}
#[async_trait]
pub trait RemoteReadPort: Send + Sync {
    async fn connect(
        &self,
        recorder: &Recorder,
        cancel: &Cancellation,
    ) -> Result<Box<dyn RemoteReadSession>>;
}
#[async_trait]
pub trait RemoteReadSession: Send {
    async fn list(&mut self, path: &RemotePath, cancel: &Cancellation) -> Result<Vec<MediaEntry>>;
    async fn open_read(
        &mut self,
        path: &RemotePath,
        cancel: &Cancellation,
    ) -> Result<Box<dyn RemoteReader>>;
    async fn close(&mut self) -> Result<()>;
}
#[derive(Clone, Debug)]
pub struct RemoteCompletion {
    pub source_size: Option<u64>,
}
#[async_trait]
pub trait RemoteReader: Send {
    async fn read_chunk(&mut self, buffer: &mut [u8], cancel: &Cancellation) -> Result<usize>;
    /// Must confirm protocol completion after data EOF, not just byte delivery.
    async fn finish(&mut self, cancel: &Cancellation) -> Result<RemoteCompletion>;
    async fn close(&mut self) -> Result<()>;
}

#[derive(Clone, Debug)]
pub struct Reservation {
    pub token: Uuid,
    pub final_name: LocalName,
    pub partial_name: String,
    pub job: JobId,
    pub attempt: AttemptId,
}
#[derive(Clone, Debug)]
pub enum ReservationOutcome {
    Reserved(Reservation),
    Skipped(String),
}
#[async_trait]
pub trait DestinationPort: Send + Sync {
    async fn check_space(&self, _expected: Option<u64>) -> Result<()> {
        Ok(())
    }
    async fn reserve(
        &self,
        name: &LocalName,
        policy: DuplicatePolicy,
        job: JobId,
        attempt: AttemptId,
    ) -> Result<ReservationOutcome>;
    async fn create_partial(&self, reservation: &Reservation) -> Result<Box<dyn LocalWriter>>;
    async fn open_readback(&self, reservation: &Reservation) -> Result<Box<dyn LocalReader>>;
    /// Asynchronous preflight; safe to abandon. Actual publication is separate.
    async fn prepare_commit(&self, reservation: &Reservation, expected_size: u64) -> Result<()>;
    /// Exactly-once, atomic publication. Called only by the scheduler; cannot await.
    fn commit(&self, reservation: &Reservation, policy: DuplicatePolicy) -> Result<String>;
    /// Idempotent; releases the name while keeping any partial for diagnostics.
    fn release(&self, reservation: &Reservation);
}
#[async_trait]
pub trait LocalWriter: Send {
    async fn write_all(&mut self, data: &[u8]) -> Result<()>;
    async fn finish(&mut self) -> Result<()>;
    fn bytes_written(&self) -> u64;
}
#[async_trait]
pub trait LocalReader: Send {
    async fn read_chunk(&mut self, buffer: &mut [u8]) -> Result<usize>;
}
#[async_trait]
pub trait SettingsPort: Send + Sync {
    async fn load(&self) -> Result<EngineConfig>;
    async fn save(&self, config: &EngineConfig) -> Result<()>;
}
pub trait EventSink: Send + Sync {
    fn publish(&self, event: &EngineEvent);
}
pub trait Clock: Send + Sync {
    fn now_millis(&self) -> u64;
}
pub trait IdSource: Send + Sync {
    fn next(&self) -> Uuid;
}

#[derive(Clone)]
pub struct EnginePorts {
    pub remote: Arc<dyn RemoteReadPort>,
    pub destination: Arc<dyn DestinationPort>,
    pub events: Arc<dyn EventSink>,
    pub clock: Arc<dyn Clock>,
    pub ids: Arc<dyn IdSource>,
}
