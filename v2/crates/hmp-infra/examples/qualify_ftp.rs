//! Read-only qualification for one explicitly selected recorder.
use hmp_core::{Engine, ports::*};
use hmp_domain::*;
use hmp_infra::*;
use std::{
    net::{Ipv4Addr, SocketAddrV4},
    sync::Arc,
    time::Duration,
};

#[tokio::main]
async fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let host: Ipv4Addr = args
        .next()
        .ok_or("usage: qualify_ftp IP [absolute media path]")?
        .parse()?;
    let media = args
        .next()
        .map(|value| RemotePath::new(&value))
        .transpose()?;
    if args.next().is_some() {
        return Err("usage: qualify_ftp IP [absolute media path]".into());
    }
    let cancel = Cancellation::default();
    let identity = HyperDeckDiscovery::new(Duration::from_secs(3))?
        .identify(SocketAddrV4::new(host, 9993), &cancel)
        .await?;
    println!(
        "Model: {} | protocol: {}",
        identity.model,
        identity.protocol_version.as_deref().unwrap_or("unknown")
    );
    let recorder = identity.recorder;
    let ftp = Arc::new(FtpRemote::new(Duration::from_secs(30))?);
    let mut session = ftp.connect(&recorder, &cancel).await?;
    let root = session.list(&RemotePath::new("/")?, &cancel).await?;
    println!(
        "Root entries: {}",
        serde_json::to_string(
            &root
                .iter()
                .map(hmp_contract::MediaEntryDto::from)
                .collect::<Vec<_>>()
        )?
    );
    let Some(media) = media else {
        session.close().await?;
        return Ok(());
    };
    let (parent, _) = media
        .as_str()
        .rsplit_once('/')
        .ok_or("absolute media path required")?;
    let files = if parent.is_empty() {
        root
    } else {
        session.list(&RemotePath::new(parent)?, &cancel).await?
    };
    let entry = files
        .into_iter()
        .find(|entry| !entry.is_directory() && entry.path() == &media)
        .ok_or("requested file is absent from its server listing")?;
    session.close().await?;

    let destination = LocalName::new("qualification.media")?;
    let disk = Arc::new(SandboxDestination::new()?);
    let engine = Engine::spawn(
        EnginePorts {
            remote: ftp,
            destination: disk,
            events: Arc::new(RecordingSink::default()),
            clock: Arc::new(StepClock::default()),
            ids: Arc::new(SequentialIds::default()),
        },
        EngineConfig::default(),
    )?;
    let mut events = engine.subscribe().await?.events;
    let batch = engine
        .enqueue_batch(
            vec![JobRequest::new(recorder, entry, destination)?],
            BatchOptions::new(DuplicatePolicy::Rename, ChecksumMode::Both),
        )
        .await?;
    engine.start(batch).await?;
    loop {
        let snapshot = engine.snapshot().await?;
        if snapshot.active == 0 && snapshot.jobs.iter().all(|job| job.status().terminal()) {
            break;
        }
        match events.recv().await {
            Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
            Err(error) => return Err(error.into()),
        }
    }
    let result = engine.shutdown().await?;
    println!(
        "{}",
        serde_json::to_string_pretty(&hmp_contract::SnapshotDto::from(&result))?
    );
    if result.jobs[0].status() != TransferStatus::Verified {
        return Err("qualification transfer did not reach Verified".into());
    }
    Ok(())
}
