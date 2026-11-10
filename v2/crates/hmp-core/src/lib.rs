pub mod ports;
mod worker;
use hmp_domain::*;
use ports::*;
use std::{
    collections::{BTreeMap, HashSet},
    sync::Arc,
};
use tokio::sync::{Semaphore, broadcast, mpsc, oneshot};
pub use worker::calculate_local_checksum;

#[derive(Clone, Debug)]
pub enum EventKind {
    BatchCreated(TransferBatch),
    BatchControl { batch: BatchId, started: bool },
    JobChanged(Box<TransferJob>),
    ActivityChanged { active: usize },
}
#[derive(Clone, Debug)]
pub struct EngineEvent {
    pub sequence: u64,
    pub timestamp_millis: u64,
    pub kind: EventKind,
}
#[derive(Clone, Debug)]
pub struct BatchSnapshot {
    pub batch: TransferBatch,
    pub started: bool,
}
#[derive(Clone, Debug)]
pub struct Snapshot {
    pub sequence: u64,
    pub batches: Vec<BatchSnapshot>,
    pub jobs: Vec<TransferJob>,
    pub active: usize,
    pub shutting_down: bool,
}
pub struct Subscription {
    pub snapshot: Snapshot,
    pub events: broadcast::Receiver<EngineEvent>,
}

#[derive(Clone)]
pub struct Engine {
    commands: mpsc::Sender<Command>,
}
enum Command {
    Enqueue(
        Vec<JobRequest>,
        BatchOptions,
        oneshot::Sender<Result<BatchId>>,
    ),
    Control(BatchId, bool, oneshot::Sender<Result<()>>),
    Cancel(JobId, oneshot::Sender<Result<()>>),
    Retry(JobId, oneshot::Sender<Result<()>>),
    Snapshot(oneshot::Sender<Snapshot>),
    Subscribe(oneshot::Sender<Subscription>),
    Shutdown(oneshot::Sender<Snapshot>),
}
fn closed() -> TransferError {
    TransferError::new(ErrorCode::Shutdown, Phase::Planning, "engine stopped")
}
impl Engine {
    pub fn spawn(ports: EnginePorts, config: EngineConfig) -> Result<Self> {
        config.validate()?;
        let (commands, receiver) = mpsc::channel(64);
        let (worker_tx, workers) = mpsc::channel(128);
        let (events, _) = broadcast::channel(256);
        let verification = Arc::new(Semaphore::new(config.verification_limit));
        tokio::spawn(
            Actor {
                ports,
                config,
                receiver,
                workers,
                worker_tx,
                events,
                verification,
                batches: BTreeMap::new(),
                jobs: BTreeMap::new(),
                order: vec![],
                active: BTreeMap::new(),
                identities: HashSet::new(),
                sequence: 0,
                shutting_down: false,
                shutdown_waiters: vec![],
            }
            .run(),
        );
        Ok(Self { commands })
    }
    async fn request<T>(&self, build: impl FnOnce(oneshot::Sender<T>) -> Command) -> Result<T> {
        let (tx, rx) = oneshot::channel();
        self.commands.send(build(tx)).await.map_err(|_| closed())?;
        rx.await.map_err(|_| closed())
    }
    pub async fn enqueue_batch(
        &self,
        requests: Vec<JobRequest>,
        options: BatchOptions,
    ) -> Result<BatchId> {
        self.request(|reply| Command::Enqueue(requests, options, reply))
            .await?
    }
    pub async fn start(&self, batch: BatchId) -> Result<()> {
        self.request(|r| Command::Control(batch, true, r)).await?
    }
    pub async fn pause(&self, batch: BatchId) -> Result<()> {
        self.request(|r| Command::Control(batch, false, r)).await?
    }
    pub async fn cancel(&self, job: JobId) -> Result<()> {
        self.request(|r| Command::Cancel(job, r)).await?
    }
    pub async fn retry(&self, job: JobId) -> Result<()> {
        self.request(|r| Command::Retry(job, r)).await?
    }
    pub async fn snapshot(&self) -> Result<Snapshot> {
        self.request(Command::Snapshot).await
    }
    pub async fn subscribe(&self) -> Result<Subscription> {
        self.request(Command::Subscribe).await
    }
    /// Stop accepting work, cancel pending/active attempts, await cleanup, return final state.
    pub async fn shutdown(&self) -> Result<Snapshot> {
        self.request(Command::Shutdown).await
    }
}

struct Active {
    attempt: AttemptId,
    cancel: Cancellation,
    network: bool,
}
struct Actor {
    ports: EnginePorts,
    config: EngineConfig,
    receiver: mpsc::Receiver<Command>,
    workers: mpsc::Receiver<worker::Message>,
    worker_tx: mpsc::Sender<worker::Message>,
    events: broadcast::Sender<EngineEvent>,
    verification: Arc<Semaphore>,
    batches: BTreeMap<BatchId, BatchSnapshot>,
    jobs: BTreeMap<JobId, TransferJob>,
    order: Vec<JobId>,
    active: BTreeMap<JobId, Active>,
    identities: HashSet<Uuid>,
    sequence: u64,
    shutting_down: bool,
    shutdown_waiters: Vec<oneshot::Sender<Snapshot>>,
}
impl Actor {
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            sequence: self.sequence,
            batches: self.batches.values().cloned().collect(),
            jobs: self.order.iter().map(|id| self.jobs[id].clone()).collect(),
            active: self.active.len(),
            shutting_down: self.shutting_down,
        }
    }
    fn emit(&mut self, kind: EventKind) {
        self.sequence += 1;
        let event = EngineEvent {
            sequence: self.sequence,
            timestamp_millis: self.ports.clock.now_millis(),
            kind,
        };
        self.ports.events.publish(&event);
        let _ = self.events.send(event);
    }
    fn job_event(&mut self, id: JobId) {
        self.emit(EventKind::JobChanged(Box::new(self.jobs[&id].clone())));
    }
    fn next_id(&mut self) -> Result<Uuid> {
        let id = self.ports.ids.next();
        if id.is_nil() || !self.identities.insert(id) {
            return Err(TransferError::invalid(
                "ID source returned nil or duplicate identity",
            ));
        }
        Ok(id)
    }
    fn enqueue(&mut self, requests: Vec<JobRequest>, options: BatchOptions) -> Result<BatchId> {
        if self.shutting_down {
            return Err(closed());
        }
        if requests.is_empty() {
            return Err(TransferError::invalid("empty batch"));
        }
        let batch_id = BatchId::new(self.next_id()?)?;
        let mut jobs = vec![];
        for request in requests {
            jobs.push(TransferJob::new(
                JobId::new(self.next_id()?)?,
                batch_id,
                AttemptId::new(self.next_id()?)?,
                request,
            ));
        }
        let batch = TransferBatch::new(
            batch_id,
            options,
            jobs.iter().map(TransferJob::id).collect(),
        )?;
        self.batches.insert(
            batch_id,
            BatchSnapshot {
                batch: batch.clone(),
                started: false,
            },
        );
        self.emit(EventKind::BatchCreated(batch));
        for job in jobs {
            let id = job.id();
            self.order.push(id);
            self.jobs.insert(id, job);
            self.job_event(id);
        }
        Ok(batch_id)
    }
    fn cancel(&mut self, id: JobId) -> Result<()> {
        let job = self.jobs.get_mut(&id).ok_or_else(|| {
            TransferError::new(ErrorCode::NotFound, Phase::Planning, "job not found")
        })?;
        if job.status().terminal() {
            return Err(TransferError::new(
                ErrorCode::AlreadyTerminal,
                Phase::Planning,
                "job already terminal",
            ));
        }
        if let Some(active) = self.active.get(&id) {
            active.cancel.cancel();
        }
        job.transition(job.attempt(), TransferStatus::Cancelled)?;
        self.job_event(id);
        Ok(())
    }
    fn stop(&mut self) {
        self.shutting_down = true;
        let ids = self.order.clone();
        for id in ids {
            if !self.jobs[&id].status().terminal() {
                let _ = self.cancel(id);
            }
        }
    }
    fn command(&mut self, command: Command) {
        match command {
            Command::Enqueue(requests, options, reply) => {
                let value = self.enqueue(requests, options);
                let _ = reply.send(value);
            }
            Command::Control(id, start, reply) => {
                let result = if self.shutting_down {
                    Err(closed())
                } else if let Some(batch) = self.batches.get_mut(&id) {
                    batch.started = start;
                    self.emit(EventKind::BatchControl {
                        batch: id,
                        started: start,
                    });
                    Ok(())
                } else {
                    Err(TransferError::new(
                        ErrorCode::NotFound,
                        Phase::Planning,
                        "batch not found",
                    ))
                };
                let _ = reply.send(result);
            }
            Command::Cancel(id, reply) => {
                let value = self.cancel(id);
                let _ = reply.send(value);
            }
            Command::Retry(id, reply) => {
                let value = if self.shutting_down {
                    Err(closed())
                } else if self.active.contains_key(&id) {
                    Err(TransferError::new(
                        ErrorCode::Busy,
                        Phase::Planning,
                        "attempt still cleaning up",
                    ))
                } else {
                    self.next_id().and_then(AttemptId::new).and_then(|attempt| {
                        self.jobs
                            .get_mut(&id)
                            .ok_or_else(|| {
                                TransferError::new(
                                    ErrorCode::NotFound,
                                    Phase::Planning,
                                    "job not found",
                                )
                            })?
                            .retry(attempt)
                    })
                };
                if value.is_ok() {
                    self.job_event(id);
                }
                let _ = reply.send(value);
            }
            Command::Snapshot(reply) => {
                let _ = reply.send(self.snapshot());
            }
            Command::Subscribe(reply) => {
                let _ = reply.send(Subscription {
                    snapshot: self.snapshot(),
                    events: self.events.subscribe(),
                });
            }
            Command::Shutdown(reply) => {
                self.shutdown_waiters.push(reply);
                self.stop();
            }
        }
    }
    fn schedule(&mut self) {
        if self.shutting_down {
            return;
        }
        for id in self.order.clone() {
            if self.active.len() >= self.config.global_limit {
                break;
            }
            let job = &self.jobs[&id];
            if job.status() != TransferStatus::Pending || !self.batches[&job.batch()].started {
                continue;
            }
            let recorder = job.request().recorder().id();
            let network = self
                .active
                .iter()
                .filter(|(other, active)| {
                    active.network && self.jobs[other].request().recorder().id() == recorder
                })
                .count();
            if network >= self.config.recorder_limit {
                continue;
            }
            let attempt = job.attempt();
            let options = self.batches[&job.batch()].batch.options().clone();
            let cancel = Cancellation::default();
            let job = self.jobs.get_mut(&id).expect("scheduled job");
            job.transition(attempt, TransferStatus::Running)
                .expect("pending job");
            let running_job = job.clone();
            self.active.insert(
                id,
                Active {
                    attempt,
                    cancel: cancel.clone(),
                    network: true,
                },
            );
            self.job_event(id);
            tokio::spawn(worker::run(
                running_job,
                options,
                self.ports.clone(),
                self.config.clone(),
                self.verification.clone(),
                cancel,
                self.worker_tx.clone(),
            ));
        }
    }
    fn message(&mut self, message: worker::Message) {
        let (id, attempt) = message.identity();
        if self.active.get(&id).is_none_or(|a| a.attempt != attempt) {
            if let worker::Message::Ready { reservation, .. } = message {
                self.ports.destination.release(&reservation);
            }
            return;
        }
        if matches!(message, worker::Message::NetworkFinished { .. }) {
            self.active.get_mut(&id).expect("active").network = false;
            return;
        }
        if self.jobs[&id].status().terminal() {
            let finished = matches!(
                message,
                worker::Message::Ready { .. }
                    | worker::Message::Failed { .. }
                    | worker::Message::Skipped { .. }
            );
            if let worker::Message::Ready { reservation, .. } = message {
                self.ports.destination.release(&reservation);
            }
            if finished {
                self.active.remove(&id);
                self.emit(EventKind::ActivityChanged {
                    active: self.active.len(),
                });
            }
            return;
        }
        match message {
            worker::Message::Progress { progress, .. } => {
                if self
                    .jobs
                    .get_mut(&id)
                    .expect("job")
                    .update_progress(attempt, progress)
                {
                    self.job_event(id);
                }
            }
            worker::Message::Verifying { .. } => {
                self.jobs
                    .get_mut(&id)
                    .expect("job")
                    .transition(attempt, TransferStatus::Verifying)
                    .expect("running job");
                self.job_event(id);
            }
            worker::Message::Ready {
                reservation,
                checksum,
                ..
            } => {
                self.jobs
                    .get_mut(&id)
                    .expect("job")
                    .transition(attempt, TransferStatus::Finalizing)
                    .expect("ready job");
                self.job_event(id);
                // No await here: publication and terminal transition are one actor turn.
                let result = self.ports.destination.commit(
                    &reservation,
                    self.batches[&self.jobs[&id].batch()]
                        .batch
                        .options()
                        .duplicate(),
                );
                let job = self.jobs.get_mut(&id).expect("job");
                match result {
                    Ok(path) => {
                        let status = if checksum.as_ref().is_some_and(|c| {
                            c.scope == VerificationScope::TransferStreamComparedToLocal
                        }) {
                            TransferStatus::Verified
                        } else {
                            TransferStatus::Done
                        };
                        job.set_output(path, checksum);
                        job.transition(attempt, status).expect("finalizing job");
                    }
                    Err(error) => {
                        job.set_error(error);
                        job.transition(attempt, TransferStatus::Error)
                            .expect("finalizing job");
                    }
                }
                self.ports.destination.release(&reservation);
                self.active.remove(&id);
                self.job_event(id);
            }
            worker::Message::Failed {
                error, progress, ..
            } => {
                let job = self.jobs.get_mut(&id).expect("job");
                job.update_progress(attempt, progress);
                let status = match error.code {
                    ErrorCode::Cancelled => TransferStatus::Cancelled,
                    ErrorCode::ChecksumMismatch | ErrorCode::VerificationReadFailed => {
                        TransferStatus::ChecksumError
                    }
                    _ => TransferStatus::Error,
                };
                job.set_error(error);
                job.transition(attempt, status).expect("active job");
                self.active.remove(&id);
                self.job_event(id);
            }
            worker::Message::Skipped { path, .. } => {
                let job = self.jobs.get_mut(&id).expect("job");
                job.set_output(path, None);
                job.transition(attempt, TransferStatus::Skipped)
                    .expect("running job");
                self.active.remove(&id);
                self.job_event(id);
            }
            worker::Message::NetworkFinished { .. } => unreachable!(),
        }
    }
    async fn run(mut self) {
        loop {
            if self.receiver.is_closed() && self.receiver.is_empty() && !self.shutting_down {
                self.stop();
            }
            let settled: Vec<_> = self
                .batches
                .values()
                .filter(|b| {
                    b.started
                        && b.batch.jobs().iter().all(|id| {
                            self.jobs[id].status().terminal() && !self.active.contains_key(id)
                        })
                })
                .map(|b| b.batch.id())
                .collect();
            for id in settled {
                self.batches.get_mut(&id).expect("batch").started = false;
                self.emit(EventKind::BatchControl {
                    batch: id,
                    started: false,
                });
            }
            self.schedule();
            if self.shutting_down && self.active.is_empty() {
                let snapshot = self.snapshot();
                for waiter in self.shutdown_waiters.drain(..) {
                    let _ = waiter.send(snapshot.clone());
                }
                break;
            }
            tokio::select! {
                biased;
                command = self.receiver.recv(), if !self.receiver.is_closed() || !self.receiver.is_empty() => {
                    if let Some(command) = command { self.command(command); } else { self.stop(); }
                }
                message = self.workers.recv() => { if let Some(message) = message { self.message(message); } }
            }
            if self.receiver.is_closed() && self.receiver.is_empty() && !self.shutting_down {
                self.stop();
            }
        }
    }
}
