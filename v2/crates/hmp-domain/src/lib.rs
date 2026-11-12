//! UI-independent values and validated state transitions. No network or disk I/O.
use std::{fmt, str::FromStr};
pub use uuid::Uuid;

macro_rules! identity {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(Uuid);
        impl $name {
            pub fn new(value: Uuid) -> Result<Self> {
                if value.is_nil() {
                    Err(TransferError::invalid("nil identity"))
                } else {
                    Ok(Self(value))
                }
            }
        }
        impl FromStr for $name {
            type Err = TransferError;
            fn from_str(s: &str) -> Result<Self> {
                Self::new(Uuid::parse_str(s).map_err(|_| TransferError::invalid("invalid UUID"))?)
            }
        }
        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(f)
            }
        }
    };
}
identity!(RecorderId);
identity!(JobId);
identity!(BatchId);
identity!(AttemptId);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Planning,
    Connecting,
    Copying,
    Verifying,
    Finalizing,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrorCode {
    InvalidInput,
    InvalidPath,
    InvalidSettings,
    NotFound,
    Authentication,
    ConnectionLost,
    Timeout,
    RemoteUnavailable,
    SourceChanged,
    DestinationConflict,
    DestinationFull,
    PermissionDenied,
    LocalIo,
    SizeMismatch,
    ChecksumMismatch,
    VerificationReadFailed,
    FinalizationFailed,
    Cancelled,
    AlreadyTerminal,
    Busy,
    Shutdown,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransferError {
    pub code: ErrorCode,
    pub phase: Phase,
    pub message: String,
    pub retryable: bool,
    pub protocol_code: Option<u16>,
}
impl TransferError {
    pub fn new(code: ErrorCode, phase: Phase, message: impl Into<String>) -> Self {
        Self {
            code,
            phase,
            message: message.into(),
            retryable: matches!(
                code,
                ErrorCode::Timeout | ErrorCode::ConnectionLost | ErrorCode::DestinationFull
            ),
            protocol_code: None,
        }
    }
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidInput, Phase::Planning, message)
    }
    pub fn cancelled() -> Self {
        Self::new(ErrorCode::Cancelled, Phase::Copying, "cancelled")
    }
}
impl fmt::Display for TransferError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}
impl std::error::Error for TransferError {}
pub type Result<T> = std::result::Result<T, TransferError>;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RemotePath(String);
impl RemotePath {
    /// A raw FTP path, not a URL. Preserve #, ?, percent escapes and Unicode.
    pub fn new(raw: &str) -> Result<Self> {
        if !raw.starts_with('/') || raw.contains(['\r', '\n', '\0', '\\']) {
            return Err(TransferError::new(
                ErrorCode::InvalidPath,
                Phase::Planning,
                "absolute FTP path required",
            ));
        }
        let parts: Vec<_> = raw.split('/').filter(|s| !s.is_empty()).collect();
        if parts.iter().any(|p| matches!(*p, "." | "..")) {
            return Err(TransferError::new(
                ErrorCode::InvalidPath,
                Phase::Planning,
                "path traversal rejected",
            ));
        }
        Ok(Self(format!("/{}", parts.join("/"))))
    }
    /// Operator input compatibility is deliberately separate from raw media names.
    pub fn parse_input(raw: &str) -> Result<Self> {
        let input = raw.trim().replace('\\', "/");
        let path = if input
            .get(..6)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("ftp://"))
        {
            let url = &input[6..];
            let (authority, path) = url.split_once('/').unwrap_or((url, ""));
            if authority.is_empty() || authority.contains('@') {
                return Err(TransferError::invalid("FTP URL authority rejected"));
            }
            format!("/{}", path.split(['?', '#']).next().unwrap_or_default())
        } else if let Some((label, p)) = input.split_once(':') {
            if label.contains('/') {
                return Err(TransferError::invalid("invalid recorder prefix"));
            }
            format!("/{}", p.trim_start_matches('/'))
        } else {
            format!("/{}", input.trim_start_matches('/'))
        };
        Self::new(&path)
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
    pub fn file_name(&self) -> Result<&str> {
        self.0
            .rsplit('/')
            .next()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| TransferError::invalid("root is not a media file"))
    }
}

#[cfg(test)]
mod tests;

/// A single portable destination component, never a path or a remote name.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct LocalName(String);
impl LocalName {
    pub fn new(name: &str) -> Result<Self> {
        let stem = name
            .split('.')
            .next()
            .unwrap_or_default()
            .trim_end_matches(' ')
            .to_ascii_uppercase();
        let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (stem.len() == 4
                && (stem.starts_with("COM") || stem.starts_with("LPT"))
                && matches!(stem.as_bytes()[3], b'1'..=b'9'));
        if name.is_empty()
            || name.len() > 200
            || name.starts_with('.')
            || name.ends_with(['.', ' '])
            || reserved
            || !name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_ .".contains(&b))
        {
            return Err(TransferError::new(
                ErrorCode::InvalidPath,
                Phase::Planning,
                "invalid portable destination name",
            ));
        }
        Ok(Self(name.into()))
    }
    /// Reversible ASCII hex mapping; distinct case/Unicode names cannot alias on disk.
    pub fn from_remote(path: &RemotePath) -> Result<Self> {
        let mut name = String::from("hmp-");
        for byte in path.file_name()?.as_bytes() {
            use fmt::Write;
            write!(name, "{byte:02x}").expect("string write");
        }
        Self::new(&name)
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
    pub fn reservation_key(&self) -> String {
        self.0.to_ascii_lowercase()
    }
    pub fn renamed(&self, index: usize) -> Result<Self> {
        let (stem, ext) = self
            .0
            .rsplit_once('.')
            .map_or((self.0.as_str(), String::new()), |(s, e)| {
                (s, format!(".{e}"))
            });
        Self::new(&format!("{stem}_copy_{index}{ext}"))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Recorder {
    id: RecorderId,
    name: String,
    host: String,
    port: u16,
}
impl Recorder {
    pub fn new(id: RecorderId, name: &str, host: &str, port: u16) -> Result<Self> {
        if name.trim().is_empty()
            || host.is_empty()
            || port == 0
            || host.chars().any(char::is_whitespace)
            || host.contains(['\0', '/', '@'])
        {
            return Err(TransferError::invalid("invalid recorder endpoint"));
        }
        Ok(Self {
            id,
            name: name.into(),
            host: host.into(),
            port,
        })
    }
    pub fn id(&self) -> RecorderId {
        self.id
    }
    pub fn name(&self) -> &str {
        &self.name
    }
    pub fn host(&self) -> &str {
        &self.host
    }
    pub fn port(&self) -> u16 {
        self.port
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MediaEntry {
    recorder: RecorderId,
    path: RemotePath,
    size: Option<u64>,
    directory: bool,
}
impl MediaEntry {
    pub fn new(
        recorder: RecorderId,
        path: RemotePath,
        size: Option<u64>,
        directory: bool,
    ) -> Result<Self> {
        if directory && size.is_some() {
            return Err(TransferError::invalid("directory size must be unknown"));
        }
        if !directory {
            path.file_name()?;
        }
        Ok(Self {
            recorder,
            path,
            size,
            directory,
        })
    }
    pub fn recorder(&self) -> RecorderId {
        self.recorder
    }
    pub fn path(&self) -> &RemotePath {
        &self.path
    }
    pub fn size(&self) -> Option<u64> {
        self.size
    }
    pub fn is_directory(&self) -> bool {
        self.directory
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DuplicatePolicy {
    Rename,
    Skip,
    Overwrite,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChecksumMode {
    None,
    Md5,
    Sha256,
    Both,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VerificationScope {
    LocalOnly,
    TransferStreamComparedToLocal,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChecksumResult {
    pub scope: VerificationScope,
    pub md5: Option<String>,
    pub sha256: Option<String>,
    pub bytes_covered: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BatchOptions {
    duplicate: DuplicatePolicy,
    checksum: ChecksumMode,
}
impl BatchOptions {
    pub fn new(duplicate: DuplicatePolicy, checksum: ChecksumMode) -> Self {
        Self {
            duplicate,
            checksum,
        }
    }
    pub fn duplicate(&self) -> DuplicatePolicy {
        self.duplicate
    }
    pub fn checksum(&self) -> ChecksumMode {
        self.checksum
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JobRequest {
    recorder: Recorder,
    media: MediaEntry,
    destination: LocalName,
}
impl JobRequest {
    pub fn new(recorder: Recorder, media: MediaEntry, destination: LocalName) -> Result<Self> {
        if recorder.id() != media.recorder() || media.is_directory() {
            return Err(TransferError::invalid(
                "file and recorder identity required",
            ));
        }
        Ok(Self {
            recorder,
            media,
            destination,
        })
    }
    pub fn recorder(&self) -> &Recorder {
        &self.recorder
    }
    pub fn media(&self) -> &MediaEntry {
        &self.media
    }
    pub fn destination(&self) -> &LocalName {
        &self.destination
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransferStatus {
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
impl TransferStatus {
    pub fn terminal(self) -> bool {
        matches!(
            self,
            Self::Done
                | Self::Verified
                | Self::Skipped
                | Self::Error
                | Self::ChecksumError
                | Self::Cancelled
        )
    }
    pub fn retryable(self) -> bool {
        matches!(self, Self::Error | Self::ChecksumError | Self::Cancelled)
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TransferProgress {
    pub received: u64,
    pub written: u64,
    pub verified: u64,
    pub total: Option<u64>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AttemptRecord {
    pub id: AttemptId,
    pub status: TransferStatus,
    pub progress: TransferProgress,
    pub error: Option<TransferError>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransferJob {
    id: JobId,
    batch: BatchId,
    attempt: AttemptId,
    request: JobRequest,
    status: TransferStatus,
    progress: TransferProgress,
    error: Option<TransferError>,
    checksum: Option<ChecksumResult>,
    destination: Option<String>,
    history: Vec<AttemptRecord>,
}
impl TransferJob {
    pub fn new(id: JobId, batch: BatchId, attempt: AttemptId, request: JobRequest) -> Self {
        let total = request.media.size();
        Self {
            id,
            batch,
            attempt,
            request,
            status: TransferStatus::Pending,
            progress: TransferProgress {
                total,
                ..Default::default()
            },
            error: None,
            checksum: None,
            destination: None,
            history: vec![],
        }
    }
    pub fn id(&self) -> JobId {
        self.id
    }
    pub fn batch(&self) -> BatchId {
        self.batch
    }
    pub fn attempt(&self) -> AttemptId {
        self.attempt
    }
    pub fn request(&self) -> &JobRequest {
        &self.request
    }
    pub fn status(&self) -> TransferStatus {
        self.status
    }
    pub fn progress(&self) -> &TransferProgress {
        &self.progress
    }
    pub fn error(&self) -> Option<&TransferError> {
        self.error.as_ref()
    }
    pub fn checksum(&self) -> Option<&ChecksumResult> {
        self.checksum.as_ref()
    }
    pub fn destination(&self) -> Option<&str> {
        self.destination.as_deref()
    }
    pub fn history(&self) -> &[AttemptRecord] {
        &self.history
    }
    pub fn partial_name(&self) -> String {
        format!(".hmp-{}-{}.part", self.id, self.attempt)
    }
    pub fn transition(&mut self, attempt: AttemptId, next: TransferStatus) -> Result<()> {
        use TransferStatus::*;
        let valid = !self.status.terminal()
            && (matches!(
                (self.status, next),
                (Pending, Running | Skipped)
                    | (Running, Skipped | Verifying | Finalizing)
                    | (Verifying, Finalizing)
                    | (Finalizing, Done | Verified)
            ) || matches!(next, Error | Cancelled)
                || (self.status == Verifying && next == ChecksumError));
        if attempt != self.attempt || !valid {
            return Err(TransferError::new(
                ErrorCode::AlreadyTerminal,
                Phase::Planning,
                "stale or invalid state transition",
            ));
        }
        self.status = next;
        Ok(())
    }
    pub fn update_progress(&mut self, attempt: AttemptId, progress: TransferProgress) -> bool {
        if attempt != self.attempt
            || self.status.terminal()
            || progress.written > progress.received
            || progress.verified > progress.written
            || progress.total != self.progress.total
            || progress.received < self.progress.received
            || progress.written < self.progress.written
            || progress.verified < self.progress.verified
        {
            return false;
        }
        self.progress = progress;
        true
    }
    pub fn set_error(&mut self, error: TransferError) {
        if !self.status.terminal() {
            self.error = Some(error);
        }
    }
    pub fn set_output(&mut self, destination: String, checksum: Option<ChecksumResult>) {
        if !self.status.terminal() {
            self.destination = Some(destination);
            self.checksum = checksum;
        }
    }
    pub fn retry(&mut self, attempt: AttemptId) -> Result<()> {
        if !self.status.retryable()
            || attempt == self.attempt
            || self.history.iter().any(|a| a.id == attempt)
        {
            return Err(TransferError::invalid("job cannot be retried"));
        }
        self.history.push(AttemptRecord {
            id: self.attempt,
            status: self.status,
            progress: self.progress.clone(),
            error: self.error.clone(),
        });
        self.attempt = attempt;
        self.status = TransferStatus::Pending;
        self.progress = TransferProgress {
            total: self.request.media.size(),
            ..Default::default()
        };
        self.error = None;
        self.checksum = None;
        self.destination = None;
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransferBatch {
    id: BatchId,
    options: BatchOptions,
    jobs: Vec<JobId>,
}
impl TransferBatch {
    pub fn new(id: BatchId, options: BatchOptions, jobs: Vec<JobId>) -> Result<Self> {
        if jobs.is_empty() {
            return Err(TransferError::invalid("empty batch"));
        }
        let unique: std::collections::HashSet<_> = jobs.iter().collect();
        if unique.len() != jobs.len() {
            return Err(TransferError::invalid("duplicate job identity"));
        }
        Ok(Self { id, options, jobs })
    }
    pub fn id(&self) -> BatchId {
        self.id
    }
    pub fn options(&self) -> &BatchOptions {
        &self.options
    }
    pub fn jobs(&self) -> &[JobId] {
        &self.jobs
    }
}
