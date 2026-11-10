//! Serializable, versioned projections for future consumers. No GUI dependency.
use hmp_core::{BatchSnapshot, EngineEvent, EventKind, Snapshot};
use hmp_domain::*;
use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RecorderDto {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
}
impl From<&Recorder> for RecorderDto {
    fn from(r: &Recorder) -> Self {
        Self {
            id: r.id().to_string(),
            name: r.name().into(),
            host: r.host().into(),
            port: r.port(),
        }
    }
}
impl TryFrom<RecorderDto> for Recorder {
    type Error = TransferError;
    fn try_from(r: RecorderDto) -> Result<Self> {
        Self::new(r.id.parse()?, &r.name, &r.host, r.port)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct MediaEntryDto {
    pub recorder_id: String,
    pub remote_path: String,
    pub size: Option<String>,
    pub directory: bool,
}
impl From<&MediaEntry> for MediaEntryDto {
    fn from(m: &MediaEntry) -> Self {
        Self {
            recorder_id: m.recorder().to_string(),
            remote_path: m.path().as_str().into(),
            size: m.size().map(|v| v.to_string()),
            directory: m.is_directory(),
        }
    }
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DuplicateDto {
    Rename,
    Skip,
    Overwrite,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChecksumDto {
    None,
    Md5,
    Sha256,
    Both,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BatchOptionsDto {
    pub duplicate: DuplicateDto,
    pub checksum: ChecksumDto,
}
impl From<&BatchOptions> for BatchOptionsDto {
    fn from(o: &BatchOptions) -> Self {
        Self {
            duplicate: match o.duplicate() {
                DuplicatePolicy::Rename => DuplicateDto::Rename,
                DuplicatePolicy::Skip => DuplicateDto::Skip,
                DuplicatePolicy::Overwrite => DuplicateDto::Overwrite,
            },
            checksum: match o.checksum() {
                ChecksumMode::None => ChecksumDto::None,
                ChecksumMode::Md5 => ChecksumDto::Md5,
                ChecksumMode::Sha256 => ChecksumDto::Sha256,
                ChecksumMode::Both => ChecksumDto::Both,
            },
        }
    }
}
impl From<BatchOptionsDto> for BatchOptions {
    fn from(o: BatchOptionsDto) -> Self {
        Self::new(
            match o.duplicate {
                DuplicateDto::Rename => DuplicatePolicy::Rename,
                DuplicateDto::Skip => DuplicatePolicy::Skip,
                DuplicateDto::Overwrite => DuplicatePolicy::Overwrite,
            },
            match o.checksum {
                ChecksumDto::None => ChecksumMode::None,
                ChecksumDto::Md5 => ChecksumMode::Md5,
                ChecksumDto::Sha256 => ChecksumMode::Sha256,
                ChecksumDto::Both => ChecksumMode::Both,
            },
        )
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QueueFileDto {
    pub recorder: RecorderDto,
    pub remote_path: String,
    pub expected_size: Option<String>,
    pub destination: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnqueueDto {
    pub schema_version: u32,
    pub files: Vec<QueueFileDto>,
    pub options: BatchOptionsDto,
}
impl EnqueueDto {
    pub fn validate(self) -> Result<(Vec<JobRequest>, BatchOptions)> {
        if self.schema_version != SCHEMA_VERSION || self.files.is_empty() {
            return Err(TransferError::invalid("unsupported schema or empty batch"));
        }
        let files = self
            .files
            .into_iter()
            .map(|file| {
                let recorder = Recorder::try_from(file.recorder)?;
                let size = file
                    .expected_size
                    .map(|s| {
                        if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
                            return Err(TransferError::invalid("decimal u64 size required"));
                        }
                        s.parse::<u64>()
                            .map_err(|_| TransferError::invalid("size overflow"))
                    })
                    .transpose()?;
                let media = MediaEntry::new(
                    recorder.id(),
                    RemotePath::new(&file.remote_path)?,
                    size,
                    false,
                )?;
                JobRequest::new(recorder, media, LocalName::new(&file.destination)?)
            })
            .collect::<Result<Vec<_>>>()?;
        Ok((files, self.options.into()))
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StatusDto {
    Pending,
    Running,
    Verifying,
    Finalizing,
    Done,
    Verified,
    Skipped,
    Error,
    ChecksumError,
    Cancelled,
}
impl From<TransferStatus> for StatusDto {
    fn from(status: TransferStatus) -> Self {
        match status {
            TransferStatus::Pending => Self::Pending,
            TransferStatus::Running => Self::Running,
            TransferStatus::Verifying => Self::Verifying,
            TransferStatus::Finalizing => Self::Finalizing,
            TransferStatus::Done => Self::Done,
            TransferStatus::Verified => Self::Verified,
            TransferStatus::Skipped => Self::Skipped,
            TransferStatus::Error => Self::Error,
            TransferStatus::ChecksumError => Self::ChecksumError,
            TransferStatus::Cancelled => Self::Cancelled,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProgressDto {
    pub received: String,
    pub written: String,
    pub verified: String,
    pub total: Option<String>,
}
impl From<&TransferProgress> for ProgressDto {
    fn from(p: &TransferProgress) -> Self {
        Self {
            received: p.received.to_string(),
            written: p.written.to_string(),
            verified: p.verified.to_string(),
            total: p.total.map(|v| v.to_string()),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ErrorDto {
    pub code: String,
    pub phase: String,
    pub message: String,
    pub retryable: bool,
    pub protocol_code: Option<u16>,
}
impl From<&TransferError> for ErrorDto {
    fn from(e: &TransferError) -> Self {
        let code = match e.code {
            ErrorCode::InvalidInput => "invalid_input",
            ErrorCode::InvalidPath => "invalid_path",
            ErrorCode::InvalidSettings => "invalid_settings",
            ErrorCode::NotFound => "not_found",
            ErrorCode::Authentication => "authentication",
            ErrorCode::ConnectionLost => "connection_lost",
            ErrorCode::Timeout => "timeout",
            ErrorCode::RemoteUnavailable => "remote_unavailable",
            ErrorCode::SourceChanged => "source_changed",
            ErrorCode::DestinationConflict => "destination_conflict",
            ErrorCode::DestinationFull => "destination_full",
            ErrorCode::PermissionDenied => "permission_denied",
            ErrorCode::LocalIo => "local_io",
            ErrorCode::SizeMismatch => "size_mismatch",
            ErrorCode::ChecksumMismatch => "checksum_mismatch",
            ErrorCode::VerificationReadFailed => "verification_read_failed",
            ErrorCode::FinalizationFailed => "finalization_failed",
            ErrorCode::Cancelled => "cancelled",
            ErrorCode::AlreadyTerminal => "already_terminal",
            ErrorCode::Busy => "busy",
            ErrorCode::Shutdown => "shutdown",
        };
        let phase = match e.phase {
            Phase::Planning => "planning",
            Phase::Connecting => "connecting",
            Phase::Copying => "copying",
            Phase::Verifying => "verifying",
            Phase::Finalizing => "finalizing",
        };
        Self {
            code: code.into(),
            phase: phase.into(),
            message: e.message.clone(),
            retryable: e.retryable,
            protocol_code: e.protocol_code,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScopeDto {
    LocalOnly,
    TransferStreamComparedToLocal,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChecksumResultDto {
    pub scope: ScopeDto,
    pub md5: Option<String>,
    pub sha256: Option<String>,
    pub bytes_covered: String,
}
impl From<&ChecksumResult> for ChecksumResultDto {
    fn from(c: &ChecksumResult) -> Self {
        Self {
            scope: match c.scope {
                VerificationScope::LocalOnly => ScopeDto::LocalOnly,
                VerificationScope::TransferStreamComparedToLocal => {
                    ScopeDto::TransferStreamComparedToLocal
                }
            },
            md5: c.md5.clone(),
            sha256: c.sha256.clone(),
            bytes_covered: c.bytes_covered.to_string(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AttemptDto {
    pub id: String,
    pub status: StatusDto,
    pub progress: ProgressDto,
    pub error: Option<ErrorDto>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct JobDto {
    pub id: String,
    pub batch_id: String,
    pub attempt_id: String,
    pub recorder_id: String,
    pub remote_path: String,
    pub requested_destination: String,
    pub destination: Option<String>,
    pub partial_hint: String,
    pub status: StatusDto,
    pub progress: ProgressDto,
    pub error: Option<ErrorDto>,
    pub checksum: Option<ChecksumResultDto>,
    pub history: Vec<AttemptDto>,
}
impl From<&TransferJob> for JobDto {
    fn from(j: &TransferJob) -> Self {
        Self {
            id: j.id().to_string(),
            batch_id: j.batch().to_string(),
            attempt_id: j.attempt().to_string(),
            recorder_id: j.request().recorder().id().to_string(),
            remote_path: j.request().media().path().as_str().into(),
            requested_destination: j.request().destination().as_str().into(),
            destination: j.destination().map(Into::into),
            partial_hint: j.partial_name(),
            status: j.status().into(),
            progress: j.progress().into(),
            error: j.error().map(Into::into),
            checksum: j.checksum().map(Into::into),
            history: j
                .history()
                .iter()
                .map(|a| AttemptDto {
                    id: a.id.to_string(),
                    status: a.status.into(),
                    progress: (&a.progress).into(),
                    error: a.error.as_ref().map(Into::into),
                })
                .collect(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct BatchDto {
    pub id: String,
    pub options: BatchOptionsDto,
    pub jobs: Vec<String>,
    pub started: bool,
}
impl From<&BatchSnapshot> for BatchDto {
    fn from(b: &BatchSnapshot) -> Self {
        Self {
            id: b.batch.id().to_string(),
            options: b.batch.options().into(),
            jobs: b.batch.jobs().iter().map(ToString::to_string).collect(),
            started: b.started,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SnapshotDto {
    pub schema_version: u32,
    pub sequence: String,
    pub batches: Vec<BatchDto>,
    pub jobs: Vec<JobDto>,
    pub active: usize,
    pub shutting_down: bool,
}
impl From<&Snapshot> for SnapshotDto {
    fn from(s: &Snapshot) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            sequence: s.sequence.to_string(),
            batches: s.batches.iter().map(Into::into).collect(),
            jobs: s.jobs.iter().map(Into::into).collect(),
            active: s.active,
            shutting_down: s.shutting_down,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum EventPayloadDto {
    BatchCreated(BatchDto),
    BatchControl { batch_id: String, started: bool },
    JobChanged(Box<JobDto>),
    ActivityChanged { active: usize },
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct EventDto {
    pub schema_version: u32,
    pub sequence: String,
    pub timestamp_millis: String,
    pub event: EventPayloadDto,
}
impl From<&EngineEvent> for EventDto {
    fn from(e: &EngineEvent) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            sequence: e.sequence.to_string(),
            timestamp_millis: e.timestamp_millis.to_string(),
            event: match &e.kind {
                EventKind::BatchCreated(batch) => EventPayloadDto::BatchCreated(
                    (&BatchSnapshot {
                        batch: batch.clone(),
                        started: false,
                    })
                        .into(),
                ),
                EventKind::BatchControl { batch, started } => EventPayloadDto::BatchControl {
                    batch_id: batch.to_string(),
                    started: *started,
                },
                EventKind::JobChanged(job) => {
                    EventPayloadDto::JobChanged(Box::new(job.as_ref().into()))
                }
                EventKind::ActivityChanged { active } => {
                    EventPayloadDto::ActivityChanged { active: *active }
                }
            },
        }
    }
}
