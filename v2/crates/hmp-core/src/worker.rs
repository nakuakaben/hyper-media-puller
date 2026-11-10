use crate::ports::*;
use hmp_domain::*;
use md5::Md5;
use sha2::{Digest, Sha256};
use std::{future::Future, sync::Arc};
use tokio::sync::{Semaphore, mpsc};

pub(crate) enum Message {
    Progress {
        id: JobId,
        attempt: AttemptId,
        progress: TransferProgress,
    },
    NetworkFinished {
        id: JobId,
        attempt: AttemptId,
    },
    Verifying {
        id: JobId,
        attempt: AttemptId,
    },
    Ready {
        id: JobId,
        attempt: AttemptId,
        reservation: Reservation,
        checksum: Option<ChecksumResult>,
    },
    Failed {
        id: JobId,
        attempt: AttemptId,
        error: TransferError,
        progress: TransferProgress,
    },
    Skipped {
        id: JobId,
        attempt: AttemptId,
        path: String,
    },
}
impl Message {
    pub fn identity(&self) -> (JobId, AttemptId) {
        match self {
            Self::Progress { id, attempt, .. }
            | Self::NetworkFinished { id, attempt }
            | Self::Verifying { id, attempt }
            | Self::Ready { id, attempt, .. }
            | Self::Failed { id, attempt, .. }
            | Self::Skipped { id, attempt, .. } => (*id, *attempt),
        }
    }
}

pub(crate) async fn guarded<T>(
    future: impl Future<Output = Result<T>>,
    cancel: &Cancellation,
    config: &EngineConfig,
    phase: Phase,
) -> Result<T> {
    tokio::select! {
        biased;
        () = cancel.cancelled() => Err(TransferError::cancelled()),
        value = tokio::time::timeout(config.operation_timeout, future) => value.unwrap_or_else(|_| Err(TransferError::new(ErrorCode::Timeout, phase, "operation timed out"))),
    }
}

struct Lease {
    destination: Arc<dyn DestinationPort>,
    reservation: Option<Reservation>,
}
impl Drop for Lease {
    fn drop(&mut self) {
        if let Some(reservation) = &self.reservation {
            self.destination.release(reservation);
        }
    }
}

struct Hashes {
    md5: Option<Md5>,
    sha256: Option<Sha256>,
}
impl Hashes {
    fn new(mode: ChecksumMode) -> Self {
        Self {
            md5: matches!(mode, ChecksumMode::Md5 | ChecksumMode::Both).then(Md5::new),
            sha256: matches!(mode, ChecksumMode::Sha256 | ChecksumMode::Both).then(Sha256::new),
        }
    }
    fn update(&mut self, chunk: &[u8]) {
        if let Some(hash) = &mut self.md5 {
            hash.update(chunk);
        }
        if let Some(hash) = &mut self.sha256 {
            hash.update(chunk);
        }
    }
    fn finish(self, scope: VerificationScope, bytes: u64) -> ChecksumResult {
        ChecksumResult {
            scope,
            bytes_covered: bytes,
            md5: self.md5.map(|h| format!("{:x}", h.finalize())),
            sha256: self.sha256.map(|h| format!("{:x}", h.finalize())),
        }
    }
}

/// A local-only digest is explicitly labelled and cannot certify a transfer.
pub async fn calculate_local_checksum(
    reader: &mut dyn LocalReader,
    mode: ChecksumMode,
    cancel: &Cancellation,
    config: &EngineConfig,
) -> Result<ChecksumResult> {
    if mode == ChecksumMode::None {
        return Err(TransferError::invalid("checksum algorithm required"));
    }
    let mut hashes = Hashes::new(mode);
    let mut bytes = 0u64;
    let mut buffer = vec![0; 64 * 1024];
    loop {
        let n = guarded(
            reader.read_chunk(&mut buffer),
            cancel,
            config,
            Phase::Verifying,
        )
        .await?;
        if n > buffer.len() {
            return Err(TransferError::invalid("reader exceeded buffer"));
        }
        if n == 0 {
            break;
        }
        hashes.update(&buffer[..n]);
        bytes = bytes
            .checked_add(n as u64)
            .ok_or_else(|| TransferError::invalid("byte count overflow"))?;
    }
    Ok(hashes.finish(VerificationScope::LocalOnly, bytes))
}

struct TransferContext<'a> {
    job: &'a TransferJob,
    options: &'a BatchOptions,
    ports: &'a EnginePorts,
    config: &'a EngineConfig,
    cancel: &'a Cancellation,
    messages: &'a mpsc::Sender<Message>,
    verification: &'a Semaphore,
}
impl TransferContext<'_> {
    async fn report(&self, progress: &TransferProgress) {
        let _ = self
            .messages
            .send(Message::Progress {
                id: self.job.id(),
                attempt: self.job.attempt(),
                progress: progress.clone(),
            })
            .await;
    }
    async fn transfer(
        &self,
        reservation: &Reservation,
        progress: &mut TransferProgress,
    ) -> Result<Option<ChecksumResult>> {
        let request = self.job.request();
        let mut writer = guarded(
            self.ports.destination.create_partial(reservation),
            self.cancel,
            self.config,
            Phase::Copying,
        )
        .await?;
        let mut session = guarded(
            self.ports.remote.connect(request.recorder(), self.cancel),
            self.cancel,
            self.config,
            Phase::Connecting,
        )
        .await?;
        let mut remote = guarded(
            session.open_read(request.media().path(), self.cancel),
            self.cancel,
            self.config,
            Phase::Connecting,
        )
        .await?;
        let mut hashes = Hashes::new(self.options.checksum());
        let mut buffer = vec![0; 64 * 1024];
        loop {
            let n = guarded(
                remote.read_chunk(&mut buffer, self.cancel),
                self.cancel,
                self.config,
                Phase::Copying,
            )
            .await?;
            if n > buffer.len() {
                return Err(TransferError::invalid("remote reader exceeded buffer"));
            }
            if n == 0 {
                break;
            }
            progress.received = progress
                .received
                .checked_add(n as u64)
                .ok_or_else(|| TransferError::invalid("byte count overflow"))?;
            hashes.update(&buffer[..n]);
            let result = guarded(
                writer.write_all(&buffer[..n]),
                self.cancel,
                self.config,
                Phase::Copying,
            )
            .await;
            progress.written = writer.bytes_written();
            self.report(progress).await;
            result?;
        }
        let completion = guarded(
            remote.finish(self.cancel),
            self.cancel,
            self.config,
            Phase::Copying,
        )
        .await?;
        guarded(remote.close(), self.cancel, self.config, Phase::Copying).await?;
        guarded(session.close(), self.cancel, self.config, Phase::Copying).await?;
        let _ = self
            .messages
            .send(Message::NetworkFinished {
                id: self.job.id(),
                attempt: self.job.attempt(),
            })
            .await;
        guarded(writer.finish(), self.cancel, self.config, Phase::Copying).await?;
        progress.written = writer.bytes_written();
        drop(writer);
        if progress.received != progress.written
            || progress.total.is_some_and(|size| size != progress.received)
        {
            return Err(TransferError::new(
                ErrorCode::SizeMismatch,
                Phase::Copying,
                "received, written and expected sizes differ",
            ));
        }
        if completion
            .source_size
            .is_some_and(|size| size != progress.received)
        {
            return Err(TransferError::new(
                ErrorCode::SourceChanged,
                Phase::Copying,
                "source metadata changed during transfer",
            ));
        }
        self.report(progress).await;
        if self.options.checksum() == ChecksumMode::None {
            return Ok(None);
        }
        let _ = self
            .messages
            .send(Message::Verifying {
                id: self.job.id(),
                attempt: self.job.attempt(),
            })
            .await;
        let permit = guarded(
            async {
                self.verification
                    .acquire()
                    .await
                    .map_err(|_| TransferError::invalid("verification semaphore closed"))
            },
            self.cancel,
            self.config,
            Phase::Verifying,
        )
        .await?;
        let mut reader = guarded(
            self.ports.destination.open_readback(reservation),
            self.cancel,
            self.config,
            Phase::Verifying,
        )
        .await
        .map_err(verification_error)?;
        let mut local = Hashes::new(self.options.checksum());
        loop {
            let n = guarded(
                reader.read_chunk(&mut buffer),
                self.cancel,
                self.config,
                Phase::Verifying,
            )
            .await
            .map_err(verification_error)?;
            if n > buffer.len() {
                return Err(TransferError::invalid("local reader exceeded buffer"));
            }
            if n == 0 {
                break;
            }
            local.update(&buffer[..n]);
            progress.verified += n as u64;
            self.report(progress).await;
        }
        drop(permit);
        let expected = hashes.finish(
            VerificationScope::TransferStreamComparedToLocal,
            progress.received,
        );
        let observed = local.finish(
            VerificationScope::TransferStreamComparedToLocal,
            progress.verified,
        );
        if expected != observed {
            return Err(TransferError::new(
                ErrorCode::ChecksumMismatch,
                Phase::Verifying,
                "transfer stream differs from local readback",
            ));
        }
        Ok(Some(observed))
    }
}
fn verification_error(error: TransferError) -> TransferError {
    if matches!(error.code, ErrorCode::Cancelled | ErrorCode::Timeout) {
        error
    } else {
        TransferError::new(
            ErrorCode::VerificationReadFailed,
            Phase::Verifying,
            "local readback failed",
        )
    }
}

pub(crate) async fn run(
    job: TransferJob,
    options: BatchOptions,
    ports: EnginePorts,
    config: EngineConfig,
    verification: Arc<Semaphore>,
    cancel: Cancellation,
    messages: mpsc::Sender<Message>,
) {
    let id = job.id();
    let attempt = job.attempt();
    let mut progress = job.progress().clone();
    let mut lease = Lease {
        destination: ports.destination.clone(),
        reservation: None,
    };
    let outcome = async {
        let outcome = guarded(
            ports.destination.reserve(
                job.request().destination(),
                options.duplicate(),
                id,
                attempt,
            ),
            &cancel,
            &config,
            Phase::Planning,
        )
        .await?;
        let reservation = match outcome {
            ReservationOutcome::Skipped(path) => {
                return Ok(Message::Skipped { id, attempt, path });
            }
            ReservationOutcome::Reserved(reservation) => reservation,
        };
        lease.reservation = Some(reservation.clone());
        let context = TransferContext {
            job: &job,
            options: &options,
            ports: &ports,
            config: &config,
            cancel: &cancel,
            messages: &messages,
            verification: &verification,
        };
        let checksum = context.transfer(&reservation, &mut progress).await?;
        guarded(
            ports
                .destination
                .prepare_commit(&reservation, progress.written),
            &cancel,
            &config,
            Phase::Finalizing,
        )
        .await?;
        if cancel.is_cancelled() {
            return Err(TransferError::cancelled());
        }
        Ok(Message::Ready {
            id,
            attempt,
            reservation,
            checksum,
        })
    }
    .await;
    let message = outcome.unwrap_or_else(|error| Message::Failed {
        id,
        attempt,
        error,
        progress,
    });
    let ready = matches!(message, Message::Ready { .. });
    // Actor owns a successful reservation only after it receives Ready.
    if ready {
        if messages.send(message).await.is_ok() {
            lease.reservation = None;
        }
    } else {
        drop(lease);
        let _ = messages.send(message).await;
    }
}
