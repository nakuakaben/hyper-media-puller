//! Runs two synthetic recorders in an automatically cleaned private sandbox.
use hmp_core::{Engine, ports::*};
use hmp_domain::*;
use hmp_infra::*;
use std::{sync::Arc, time::Duration};

#[tokio::main]
async fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let remote = Arc::new(SimRemote::default());
    let disk = Arc::new(SandboxDestination::new()?);
    let engine = Engine::spawn(
        EnginePorts {
            remote: remote.clone(),
            destination: disk,
            events: Arc::new(RecordingSink::default()),
            clock: Arc::new(StepClock::default()),
            ids: Arc::new(SequentialIds::default()),
        },
        EngineConfig::default(),
    )?;
    let mut requests = vec![];
    for (id, data) in [(10, b"AAAA"), (20, b"BBBB")] {
        let recorder = Recorder::new(
            RecorderId::new(Uuid::from_u128(id))?,
            "Synthetic Deck",
            "192.0.2.10",
            21,
        )?;
        let path = RemotePath::new("/1/clip.mov")?;
        remote.insert(recorder.clone(), path.clone(), SimFile::new(data.to_vec()));
        let entry = MediaEntry::new(recorder.id(), path.clone(), Some(4), false)?;
        requests.push(JobRequest::new(
            recorder,
            entry,
            LocalName::from_remote(&path)?,
        )?);
    }
    let mut subscription = engine.subscribe().await?;
    let batch = engine
        .enqueue_batch(
            requests,
            BatchOptions::new(DuplicatePolicy::Rename, ChecksumMode::Both),
        )
        .await?;
    engine.start(batch).await?;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let snapshot = engine.snapshot().await?;
            if snapshot.active == 0 && snapshot.jobs.iter().all(|j| j.status().terminal()) {
                break;
            }
            let _ = subscription.events.recv().await;
        }
        Ok::<(), TransferError>(())
    })
    .await??;
    let snapshot = engine.shutdown().await?;
    if snapshot
        .jobs
        .iter()
        .any(|j| j.status() != TransferStatus::Verified)
    {
        return Err("simulation failed".into());
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&hmp_contract::SnapshotDto::from(&snapshot))?
    );
    Ok(())
}
