use hmp_core::{Engine, EventKind, Snapshot, calculate_local_checksum, ports::*};
use hmp_domain::*;
use hmp_infra::*;
use std::{sync::Arc, time::Duration};

struct Harness {
    engine: Engine,
    remote: Arc<SimRemote>,
    disk: Arc<SandboxDestination>,
    events: Arc<RecordingSink>,
}
impl Harness {
    fn new(config: EngineConfig) -> Self {
        let remote = Arc::new(SimRemote::default());
        let disk = Arc::new(SandboxDestination::new().unwrap());
        let events = Arc::new(RecordingSink::default());
        let engine = Engine::spawn(
            EnginePorts {
                remote: remote.clone(),
                destination: disk.clone(),
                events: events.clone(),
                clock: Arc::new(StepClock::default()),
                ids: Arc::new(SequentialIds::default()),
            },
            config,
        )
        .unwrap();
        Self {
            engine,
            remote,
            disk,
            events,
        }
    }
    fn standard() -> Self {
        Self::new(EngineConfig::default())
    }
    fn file(
        &self,
        recorder: u128,
        path: &str,
        destination: &str,
        file: SimFile,
        size: Option<u64>,
    ) -> JobRequest {
        let recorder = Recorder::new(
            RecorderId::new(Uuid::from_u128(recorder)).unwrap(),
            "Synthetic Deck",
            "192.0.2.10",
            21,
        )
        .unwrap();
        let path = RemotePath::new(path).unwrap();
        self.remote.insert(recorder.clone(), path.clone(), file);
        JobRequest::new(
            recorder.clone(),
            MediaEntry::new(recorder.id(), path, size, false).unwrap(),
            LocalName::new(destination).unwrap(),
        )
        .unwrap()
    }
    async fn enqueue(
        &self,
        requests: Vec<JobRequest>,
        duplicate: DuplicatePolicy,
        checksum: ChecksumMode,
    ) -> BatchId {
        self.engine
            .enqueue_batch(requests, BatchOptions::new(duplicate, checksum))
            .await
            .unwrap()
    }
    async fn wait(&self, predicate: impl Fn(&Snapshot) -> bool) -> Snapshot {
        tokio::time::timeout(Duration::from_secs(5), async {
            let mut sub = self.engine.subscribe().await.unwrap();
            loop {
                let snapshot = self.engine.snapshot().await.unwrap();
                if predicate(&snapshot) {
                    return snapshot;
                }
                let _ = sub.events.recv().await;
            }
        })
        .await
        .expect("engine scenario timed out")
    }
    async fn settled(&self) -> Snapshot {
        self.wait(|s| s.active == 0 && s.jobs.iter().all(|j| j.status().terminal()))
            .await
    }
    async fn shutdown(&self) {
        let s = self.engine.shutdown().await.unwrap();
        assert_eq!(s.active, 0);
        assert_eq!(self.remote.active(), (0, 0));
        assert_eq!(self.disk.reservations(), 0);
    }
}
async fn entered(gate: &Gate) {
    tokio::time::timeout(Duration::from_secs(5), gate.entered())
        .await
        .expect("gate never entered");
}
fn name(s: &str) -> LocalName {
    LocalName::new(s).unwrap()
}

#[tokio::test]
async fn safe01_success_is_not_visible_until_publication() {
    let h = Harness::standard();
    let gate = Arc::new(Gate::default());
    h.disk.set_faults(DiskFaults {
        prepare_gate: Some(gate.clone()),
        ..Default::default()
    });
    let request = h.file(
        10,
        "/1/clip.mov",
        "clip.mov",
        SimFile::new(b"DATA".to_vec()),
        Some(4),
    );
    let b = h
        .enqueue(vec![request], DuplicatePolicy::Rename, ChecksumMode::Both)
        .await;
    h.engine.start(b).await.unwrap();
    entered(&gate).await;
    let s = h.engine.snapshot().await.unwrap();
    assert!(!s.jobs[0].status().terminal());
    assert!(h.disk.final_bytes(&name("clip.mov")).is_err());
    assert_eq!(h.disk.publications(), 0);
    assert_eq!(h.disk.partial_bytes(&s.jobs[0]).unwrap(), b"DATA");
    gate.release();
    let s = h.settled().await;
    assert_eq!(s.jobs[0].status(), TransferStatus::Verified);
    assert_eq!(h.disk.final_bytes(&name("clip.mov")).unwrap(), b"DATA");
    assert!(h.disk.partial_names().is_empty());
    let checksum = s.jobs[0].checksum().unwrap();
    assert_eq!(
        checksum.scope,
        VerificationScope::TransferStreamComparedToLocal
    );
    assert_eq!(
        checksum.md5.as_deref(),
        Some("e44f9e348e41cb272efa87387728571b")
    );
    assert_eq!(checksum.sha256.as_ref().unwrap().len(), 64);
    h.shutdown().await;
}

#[tokio::test]
async fn safe01_partial_creation_is_exclusive_and_foreign_reservations_fail() {
    let disk = SandboxDestination::new().unwrap();
    let job = JobId::new(Uuid::from_u128(1)).unwrap();
    let attempt = AttemptId::new(Uuid::from_u128(2)).unwrap();
    let ReservationOutcome::Reserved(r) = disk
        .reserve(&name("clip.mov"), DuplicatePolicy::Rename, job, attempt)
        .await
        .unwrap()
    else {
        panic!()
    };
    let writer = disk.create_partial(&r).await.unwrap();
    assert_eq!(
        disk.create_partial(&r).await.err().unwrap().code,
        ErrorCode::DestinationConflict
    );
    let mut forged = r.clone();
    forged.partial_name = "../outside".into();
    assert!(disk.create_partial(&forged).await.is_err());
    drop(writer);
    disk.release(&r);
    disk.release(&r);
    assert_eq!(disk.reservations(), 0);
}

#[tokio::test]
async fn safe02_simultaneous_case_collisions_are_reserved_and_renamed() {
    let h = Harness::standard();
    let a = h.file(
        10,
        "/1/clip.mov",
        "Clip.mov",
        SimFile::new(b"AAAA".to_vec()),
        Some(4),
    );
    let b = h.file(
        20,
        "/2/clip.mov",
        "clip.mov",
        SimFile::new(b"BBBB".to_vec()),
        Some(4),
    );
    let batch = h
        .enqueue(vec![a, b], DuplicatePolicy::Rename, ChecksumMode::None)
        .await;
    h.engine.start(batch).await.unwrap();
    let s = h.settled().await;
    assert!(s.jobs.iter().all(|j| j.status() == TransferStatus::Done));
    let a = s.jobs[0].destination().unwrap();
    let b = s.jobs[1].destination().unwrap();
    assert_ne!(a.to_ascii_lowercase(), b.to_ascii_lowercase());
    assert_eq!(h.disk.final_bytes(&name(a)).unwrap(), b"AAAA");
    assert_eq!(h.disk.final_bytes(&name(b)).unwrap(), b"BBBB");
    h.shutdown().await;
}

#[tokio::test]
async fn safe02_a_late_existing_file_is_never_implicitly_overwritten() {
    let h = Harness::standard();
    let gate = Arc::new(Gate::default());
    h.disk.set_faults(DiskFaults {
        prepare_gate: Some(gate.clone()),
        ..Default::default()
    });
    let a = h.file(
        10,
        "/1/a.mov",
        "a.mov",
        SimFile::new(b"AAAA".to_vec()),
        Some(4),
    );
    let b = h
        .enqueue(vec![a], DuplicatePolicy::Rename, ChecksumMode::None)
        .await;
    h.engine.start(b).await.unwrap();
    entered(&gate).await;
    h.disk.seed(&name("a.mov"), b"ORIGINAL").unwrap();
    gate.release();
    let s = h.settled().await;
    assert_eq!(s.jobs[0].status(), TransferStatus::Error);
    assert_eq!(
        s.jobs[0].error().unwrap().code,
        ErrorCode::DestinationConflict
    );
    assert_eq!(h.disk.final_bytes(&name("a.mov")).unwrap(), b"ORIGINAL");
    assert_eq!(h.disk.publications(), 0);
    h.shutdown().await;
}

#[tokio::test]
async fn safe03_same_size_policies_do_not_imply_content_identity() {
    for policy in [
        DuplicatePolicy::Overwrite,
        DuplicatePolicy::Skip,
        DuplicatePolicy::Rename,
    ] {
        let h = Harness::standard();
        h.disk.seed(&name("clip.mov"), b"OLD!").unwrap();
        let request = h.file(
            10,
            "/1/clip.mov",
            "clip.mov",
            SimFile::new(b"NEW!".to_vec()),
            Some(4),
        );
        let b = h.enqueue(vec![request], policy, ChecksumMode::None).await;
        h.engine.start(b).await.unwrap();
        let s = h.settled().await;
        let j = &s.jobs[0];
        assert!(j.checksum().is_none());
        if policy == DuplicatePolicy::Skip {
            assert_eq!(j.status(), TransferStatus::Skipped);
        } else {
            assert_eq!(j.status(), TransferStatus::Done);
            assert_eq!(
                h.disk.final_bytes(&name(j.destination().unwrap())).unwrap(),
                b"NEW!"
            );
        }
        assert_eq!(
            h.disk.final_bytes(&name("clip.mov")).unwrap(),
            if policy == DuplicatePolicy::Overwrite {
                b"NEW!"
            } else {
                b"OLD!"
            }
        );
        h.shutdown().await;
    }
}

#[tokio::test]
async fn safe04_batch_options_are_immutable_and_not_reloaded_from_settings() {
    let h = Harness::standard();
    h.disk.seed(&name("clip.mov"), b"OLD!").unwrap();
    let settings = MemorySettings::default();
    settings
        .save(&EngineConfig {
            global_limit: 1,
            ..Default::default()
        })
        .await
        .unwrap();
    let mut options = BatchOptions::new(DuplicatePolicy::Overwrite, ChecksumMode::Both);
    let request = h.file(
        10,
        "/1/clip.mov",
        "clip.mov",
        SimFile::new(b"NEW!".to_vec()),
        Some(4),
    );
    let batch = h
        .engine
        .enqueue_batch(vec![request], options.clone())
        .await
        .unwrap();
    options = BatchOptions::new(DuplicatePolicy::Skip, ChecksumMode::None);
    assert_eq!(options.duplicate(), DuplicatePolicy::Skip);
    h.engine.start(batch).await.unwrap();
    let s = h.settled().await;
    assert_eq!(
        s.batches[0].batch.options().duplicate(),
        DuplicatePolicy::Overwrite
    );
    assert_eq!(s.jobs[0].status(), TransferStatus::Verified);
    assert_eq!(h.disk.final_bytes(&name("clip.mov")).unwrap(), b"NEW!");
    h.shutdown().await;
}

#[tokio::test]
async fn safe05_interrupted_reader_keeps_identifiable_partial_and_other_recorder_finishes() {
    let h = Harness::standard();
    let mut file = SimFile::new(b"PARTIAL!".to_vec());
    file.read_error_after = Some(4);
    let a = h.file(10, "/1/a.mov", "a.mov", file, Some(8));
    let b = h.file(
        20,
        "/1/b.mov",
        "b.mov",
        SimFile::new(b"GOOD".to_vec()),
        Some(4),
    );
    let batch = h
        .enqueue(vec![a, b], DuplicatePolicy::Rename, ChecksumMode::None)
        .await;
    h.engine.start(batch).await.unwrap();
    let s = h.settled().await;
    assert_eq!(s.jobs[0].status(), TransferStatus::Error);
    assert_eq!(s.jobs[0].error().unwrap().code, ErrorCode::ConnectionLost);
    assert_eq!(h.disk.partial_bytes(&s.jobs[0]).unwrap(), b"PART");
    assert!(h.disk.final_bytes(&name("a.mov")).is_err());
    assert_eq!(s.jobs[1].status(), TransferStatus::Done);
    h.shutdown().await;
}

#[tokio::test]
async fn safe05_eof_without_final_success_never_completes() {
    let h = Harness::standard();
    let mut file = SimFile::new(b"DATA".to_vec());
    file.finish_error = Some(ErrorCode::ConnectionLost);
    let request = h.file(10, "/1/clip.mov", "clip.mov", file, Some(4));
    let b = h
        .enqueue(vec![request], DuplicatePolicy::Rename, ChecksumMode::Both)
        .await;
    h.engine.start(b).await.unwrap();
    assert_eq!(h.settled().await.jobs[0].status(), TransferStatus::Error);
    assert_eq!(h.disk.publications(), 0);
    h.shutdown().await;
}

#[tokio::test]
async fn safe06_partial_write_enospc_preserves_existing_destination() {
    let h = Harness::standard();
    h.disk.seed(&name("clip.mov"), b"ORIGINAL").unwrap();
    h.disk.set_faults(DiskFaults {
        write_error_after: Some(2),
        ..Default::default()
    });
    let request = h.file(
        10,
        "/1/clip.mov",
        "clip.mov",
        SimFile::new(b"DATA".to_vec()),
        Some(4),
    );
    let b = h
        .enqueue(
            vec![request],
            DuplicatePolicy::Overwrite,
            ChecksumMode::None,
        )
        .await;
    h.engine.start(b).await.unwrap();
    let s = h.settled().await;
    assert_eq!(s.jobs[0].error().unwrap().code, ErrorCode::DestinationFull);
    assert_eq!(s.jobs[0].progress().written, 2);
    assert_eq!(h.disk.partial_bytes(&s.jobs[0]).unwrap(), b"DA");
    assert_eq!(h.disk.final_bytes(&name("clip.mov")).unwrap(), b"ORIGINAL");
    h.shutdown().await;
}

#[tokio::test]
async fn safe06_open_flush_and_commit_failures_cannot_publish_success() {
    for faults in [
        DiskFaults {
            create_error: Some(ErrorCode::PermissionDenied),
            ..Default::default()
        },
        DiskFaults {
            flush_error: true,
            ..Default::default()
        },
        DiskFaults {
            commit_error: true,
            ..Default::default()
        },
    ] {
        let h = Harness::standard();
        h.disk.seed(&name("clip.mov"), b"OLD!").unwrap();
        h.disk.set_faults(faults);
        let request = h.file(
            10,
            "/1/clip.mov",
            "clip.mov",
            SimFile::new(b"DATA".to_vec()),
            Some(4),
        );
        let b = h
            .enqueue(
                vec![request],
                DuplicatePolicy::Overwrite,
                ChecksumMode::Both,
            )
            .await;
        h.engine.start(b).await.unwrap();
        assert_eq!(h.settled().await.jobs[0].status(), TransferStatus::Error);
        assert_eq!(h.disk.publications(), 0);
        assert_eq!(h.disk.final_bytes(&name("clip.mov")).unwrap(), b"OLD!");
        h.shutdown().await;
    }
}

#[tokio::test]
async fn safe07_cancel_during_readback_cannot_become_verified() {
    let h = Harness::standard();
    let gate = Arc::new(Gate::default());
    h.disk.set_faults(DiskFaults {
        read_gate: Some(gate.clone()),
        ..Default::default()
    });
    let request = h.file(
        10,
        "/1/clip.mov",
        "clip.mov",
        SimFile::new(b"DATA".to_vec()),
        Some(4),
    );
    let b = h
        .enqueue(vec![request], DuplicatePolicy::Rename, ChecksumMode::Both)
        .await;
    h.engine.start(b).await.unwrap();
    entered(&gate).await;
    let s = h
        .wait(|s| s.jobs[0].status() == TransferStatus::Verifying)
        .await;
    h.engine.cancel(s.jobs[0].id()).await.unwrap();
    gate.release();
    let s = h.settled().await;
    assert_eq!(s.jobs[0].status(), TransferStatus::Cancelled);
    assert_eq!(h.disk.publications(), 0);
    assert!(!h.events.events().iter().any(
        |e| matches!(&e.kind,EventKind::JobChanged(j) if j.status() == TransferStatus::Verified)
    ));
    h.shutdown().await;
}

#[tokio::test]
async fn safe07_cancel_before_commit_and_cancel_after_commit_have_distinct_outcomes() {
    for before in [true, false] {
        let h = Harness::standard();
        let gate = Arc::new(Gate::default());
        h.disk.set_faults(DiskFaults {
            prepare_gate: Some(gate.clone()),
            ..Default::default()
        });
        let request = h.file(
            10,
            "/1/clip.mov",
            "clip.mov",
            SimFile::new(b"DATA".to_vec()),
            Some(4),
        );
        let b = h
            .enqueue(vec![request], DuplicatePolicy::Rename, ChecksumMode::Both)
            .await;
        h.engine.start(b).await.unwrap();
        entered(&gate).await;
        let id = h.engine.snapshot().await.unwrap().jobs[0].id();
        if before {
            h.engine.cancel(id).await.unwrap();
        }
        gate.release();
        let s = h.settled().await;
        if before {
            assert_eq!(s.jobs[0].status(), TransferStatus::Cancelled);
            assert_eq!(h.disk.publications(), 0);
        } else {
            assert_eq!(s.jobs[0].status(), TransferStatus::Verified);
            assert_eq!(
                h.engine.cancel(id).await.unwrap_err().code,
                ErrorCode::AlreadyTerminal
            );
            assert_eq!(h.disk.publications(), 1);
        }
        h.shutdown().await;
    }
}

#[tokio::test]
async fn safe08_hash_mismatch_and_read_error_do_not_finalize() {
    for faults in [
        DiskFaults {
            corrupt_readback: true,
            ..Default::default()
        },
        DiskFaults {
            read_error_after: Some(0),
            ..Default::default()
        },
    ] {
        let h = Harness::standard();
        h.disk.set_faults(faults);
        let request = h.file(
            10,
            "/1/clip.mov",
            "clip.mov",
            SimFile::new(b"DATA".to_vec()),
            Some(4),
        );
        let b = h
            .enqueue(vec![request], DuplicatePolicy::Rename, ChecksumMode::Both)
            .await;
        h.engine.start(b).await.unwrap();
        assert_eq!(
            h.settled().await.jobs[0].status(),
            TransferStatus::ChecksumError
        );
        assert_eq!(h.disk.publications(), 0);
        h.shutdown().await;
    }
}

#[tokio::test]
async fn safe09_local_only_digest_has_explicit_scope() {
    let disk = SandboxDestination::new().unwrap();
    let job = JobId::new(Uuid::from_u128(1)).unwrap();
    let attempt = AttemptId::new(Uuid::from_u128(2)).unwrap();
    let ReservationOutcome::Reserved(r) = disk
        .reserve(&name("clip.mov"), DuplicatePolicy::Rename, job, attempt)
        .await
        .unwrap()
    else {
        panic!()
    };
    let mut writer = disk.create_partial(&r).await.unwrap();
    writer.write_all(b"DATA").await.unwrap();
    writer.finish().await.unwrap();
    drop(writer);
    let mut reader = disk.open_readback(&r).await.unwrap();
    let result = calculate_local_checksum(
        reader.as_mut(),
        ChecksumMode::Both,
        &Cancellation::default(),
        &EngineConfig::default(),
    )
    .await
    .unwrap();
    assert_eq!(result.scope, VerificationScope::LocalOnly);
    assert_eq!(result.bytes_covered, 4);
    disk.release(&r);
}

#[tokio::test]
async fn safe10_size_mismatch_and_source_change_are_errors_not_done() {
    for (expected, reported, code) in [
        (Some(100), Some(4), ErrorCode::SizeMismatch),
        (None, Some(100), ErrorCode::SourceChanged),
    ] {
        let h = Harness::standard();
        let mut file = SimFile::new(b"DATA".to_vec());
        file.source_size = reported;
        let request = h.file(10, "/1/clip.mov", "clip.mov", file, expected);
        let b = h
            .enqueue(vec![request], DuplicatePolicy::Rename, ChecksumMode::None)
            .await;
        h.engine.start(b).await.unwrap();
        let s = h.settled().await;
        assert_eq!(s.jobs[0].status(), TransferStatus::Error);
        assert_eq!(s.jobs[0].error().unwrap().code, code);
        assert_eq!(s.jobs[0].progress().written, 4);
        assert_eq!(h.disk.publications(), 0);
        h.shutdown().await;
    }
}

#[tokio::test]
async fn unknown_sizes_empty_files_and_all_hash_modes_complete() {
    for (mode, data) in [
        (ChecksumMode::None, b"".to_vec()),
        (ChecksumMode::Md5, b"abc".to_vec()),
        (ChecksumMode::Sha256, b"abc".to_vec()),
        (ChecksumMode::Both, b"".to_vec()),
    ] {
        let h = Harness::standard();
        let mut file = SimFile::new(data.clone());
        file.source_size = None;
        let request = h.file(10, "/1/clip.mov", "clip.mov", file, None);
        let b = h
            .enqueue(vec![request], DuplicatePolicy::Rename, mode)
            .await;
        h.engine.start(b).await.unwrap();
        let s = h.settled().await;
        assert_eq!(s.jobs[0].progress().total, None);
        assert_eq!(s.jobs[0].progress().written, data.len() as u64);
        assert_eq!(
            s.jobs[0].status(),
            if mode == ChecksumMode::None {
                TransferStatus::Done
            } else {
                TransferStatus::Verified
            }
        );
        h.shutdown().await;
    }
}

#[tokio::test]
async fn safe11_v1_path_corpus_is_reused_with_explicit_security_corrections() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../tests/fixtures/v1-paths.json")).unwrap();
    let mut checked = 0;
    for case in fixture["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let input = case["input"].as_str().unwrap_or_default();
        match id {
            "PATH-09" | "PATH-10" | "PATH-14" | "PATH-15" | "PATH-17" => {
                assert!(RemotePath::parse_input(input).is_err(), "{id}")
            }
            "PATH-12" | "PATH-13" => assert_eq!(RemotePath::new(input).unwrap().as_str(), input),
            _ => assert_eq!(
                RemotePath::parse_input(input).unwrap().as_str(),
                case["expected"].as_str().unwrap(),
                "{id}"
            ),
        }
        checked += 1;
    }
    assert_eq!(checked, 19);
    for bad in ["../x", "/1/../../x", "/1/a\0b", "/1/a\rb"] {
        assert!(RemotePath::new(bad).is_err());
    }
    for bad in [
        "../x",
        "CON.mov",
        "NUL",
        "LPT1.mov",
        "a/b",
        "a\\b",
        "a.",
        "",
        ".hmp-hidden",
    ] {
        assert!(LocalName::new(bad).is_err());
    }
    let a = LocalName::from_remote(&RemotePath::new("/1/Été #01?.mov").unwrap()).unwrap();
    let b = LocalName::from_remote(&RemotePath::new("/1/été #01?.mov").unwrap()).unwrap();
    assert_ne!(a.reservation_key(), b.reservation_key());
}

#[tokio::test]
async fn safe12_shutdown_cancels_active_and_pending_and_waits_for_resources() {
    let h = Harness::new(EngineConfig {
        global_limit: 1,
        ..Default::default()
    });
    let gate = Arc::new(Gate::default());
    let mut file = SimFile::new(b"DATA".to_vec());
    file.read_gate = Some(gate.clone());
    let a = h.file(10, "/1/a.mov", "a.mov", file, Some(4));
    let b = h.file(
        20,
        "/1/b.mov",
        "b.mov",
        SimFile::new(b"DATA".to_vec()),
        Some(4),
    );
    let batch = h
        .enqueue(vec![a, b], DuplicatePolicy::Rename, ChecksumMode::None)
        .await;
    h.engine.start(batch).await.unwrap();
    entered(&gate).await;
    h.engine.pause(batch).await.unwrap();
    let s = h.engine.shutdown().await.unwrap();
    assert!(
        s.jobs
            .iter()
            .all(|j| j.status() == TransferStatus::Cancelled)
    );
    assert_eq!(s.active, 0);
    assert_eq!(h.remote.active(), (0, 0));
    assert_eq!(h.disk.reservations(), 0);
    assert_eq!(h.disk.publications(), 0);
    assert!(!h.disk.partial_names().is_empty());
    assert_eq!(
        h.engine.snapshot().await.unwrap_err().code,
        ErrorCode::Shutdown
    );
}

#[tokio::test]
async fn retry_has_new_attempt_preserves_history_and_keeps_failed_partial() {
    let h = Harness::standard();
    h.disk.set_faults(DiskFaults {
        write_error_after: Some(2),
        ..Default::default()
    });
    let request = h.file(
        10,
        "/1/clip.mov",
        "clip.mov",
        SimFile::new(b"DATA".to_vec()),
        Some(4),
    );
    let batch = h
        .enqueue(vec![request], DuplicatePolicy::Rename, ChecksumMode::Both)
        .await;
    h.engine.start(batch).await.unwrap();
    let s = h.settled().await;
    let old = s.jobs[0].clone();
    h.disk.set_faults(DiskFaults::default());
    h.engine.retry(old.id()).await.unwrap();
    let s = h.engine.snapshot().await.unwrap();
    let retried = &s.jobs[0];
    assert_eq!(retried.status(), TransferStatus::Pending);
    assert_ne!(retried.attempt(), old.attempt());
    assert_eq!(retried.progress().written, 0);
    assert_eq!(retried.history().len(), 1);
    h.engine.start(batch).await.unwrap();
    let s = h.settled().await;
    assert_eq!(s.jobs[0].status(), TransferStatus::Verified);
    assert_eq!(h.disk.partial_bytes(&old).unwrap(), b"DA");
    assert_eq!(h.disk.partial_names().len(), 1);
    h.shutdown().await;
}

#[tokio::test]
async fn global_and_recorder_concurrency_pause_and_resume() {
    let h = Harness::standard();
    let a_gate = Arc::new(Gate::default());
    let b_gate = Arc::new(Gate::default());
    let c_gate = Arc::new(Gate::default());
    let mut a = SimFile::new(b"AAAA".to_vec());
    a.read_gate = Some(a_gate.clone());
    let mut b = SimFile::new(b"BBBB".to_vec());
    b.read_gate = Some(b_gate.clone());
    let mut c = SimFile::new(b"CCCC".to_vec());
    c.read_gate = Some(c_gate.clone());
    let a = h.file(10, "/1/a.mov", "a.mov", a, Some(4));
    let b = h.file(10, "/1/b.mov", "b.mov", b, Some(4));
    let c = h.file(20, "/1/c.mov", "c.mov", c, Some(4));
    let batch = h
        .enqueue(vec![a, b, c], DuplicatePolicy::Rename, ChecksumMode::None)
        .await;
    h.engine.start(batch).await.unwrap();
    entered(&a_gate).await;
    entered(&c_gate).await;
    let s = h.engine.snapshot().await.unwrap();
    assert_eq!(s.active, 2);
    assert_eq!(s.jobs[1].status(), TransferStatus::Pending);
    h.engine.pause(batch).await.unwrap();
    a_gate.release();
    c_gate.release();
    let s = h.wait(|s| s.active == 0).await;
    assert_eq!(s.jobs[1].status(), TransferStatus::Pending);
    assert_eq!(h.remote.peak(), 2);
    assert_eq!(
        h.remote
            .recorder_peak(RecorderId::new(Uuid::from_u128(10)).unwrap()),
        1
    );
    h.engine.start(batch).await.unwrap();
    entered(&b_gate).await;
    b_gate.release();
    assert!(
        h.settled()
            .await
            .jobs
            .iter()
            .all(|j| j.status() == TransferStatus::Done)
    );
    h.shutdown().await;
}

#[tokio::test]
async fn timeout_while_connecting_is_typed_and_releases_reservation() {
    let h = Harness::new(EngineConfig {
        operation_timeout: Duration::from_millis(30),
        ..Default::default()
    });
    let request = h.file(
        10,
        "/1/clip.mov",
        "clip.mov",
        SimFile::new(b"DATA".to_vec()),
        Some(4),
    );
    h.remote
        .connect_gate(request.recorder().id(), Arc::new(Gate::default()));
    let b = h
        .enqueue(vec![request], DuplicatePolicy::Rename, ChecksumMode::None)
        .await;
    h.engine.start(b).await.unwrap();
    let s = h.settled().await;
    assert_eq!(s.jobs[0].error().unwrap().code, ErrorCode::Timeout);
    assert_eq!(s.jobs[0].error().unwrap().phase, Phase::Connecting);
    h.shutdown().await;
}

#[tokio::test]
async fn discovery_and_listing_preserve_stable_media_identity_and_real_volumes() {
    let h = Harness::standard();
    let a = h.file(
        10,
        "/1/été #?.mov",
        "a.mov",
        SimFile::new(b"AAAA".to_vec()),
        Some(4),
    );
    let b = h.file(
        20,
        "/2/b.mov",
        "b.mov",
        SimFile::new(b"BBBB".to_vec()),
        Some(4),
    );
    let cancel = Cancellation::default();
    assert_eq!(
        h.remote
            .discover("simulation-only", &cancel)
            .await
            .unwrap()
            .len(),
        2
    );
    let mut session = h.remote.connect(a.recorder(), &cancel).await.unwrap();
    let root = session
        .list(&RemotePath::new("/").unwrap(), &cancel)
        .await
        .unwrap();
    assert_eq!(root.len(), 1);
    assert_eq!(root[0].path().as_str(), "/1");
    let one = session
        .list(&RemotePath::new("/1").unwrap(), &cancel)
        .await
        .unwrap();
    let two = session
        .list(&RemotePath::new("/1").unwrap(), &cancel)
        .await
        .unwrap();
    assert_eq!(one, two);
    session.close().await.unwrap();
    drop(session);
    let batch = h
        .enqueue(
            vec![a.clone(), b],
            DuplicatePolicy::Rename,
            ChecksumMode::Md5,
        )
        .await;
    h.engine.start(batch).await.unwrap();
    h.settled().await;
    assert_eq!(
        h.remote.source_bytes(a.recorder().id(), a.media().path()),
        b"AAAA"
    );
    h.shutdown().await;
}

#[tokio::test]
async fn dto_counters_roundtrip_without_javascript_precision_loss() {
    use hmp_contract::*;
    let h = Harness::standard();
    let request = h.file(
        10,
        "/1/clip.mov",
        "clip.mov",
        SimFile::new(b"DATA".to_vec()),
        Some(u64::MAX),
    );
    h.enqueue(vec![request], DuplicatePolicy::Rename, ChecksumMode::None)
        .await;
    let snapshot = SnapshotDto::from(&h.engine.snapshot().await.unwrap());
    let json = serde_json::to_string(&snapshot).unwrap();
    assert!(json.contains("18446744073709551615"));
    let decoded: SnapshotDto = serde_json::from_str(&json).unwrap();
    assert_eq!(decoded, snapshot);
    let input = EnqueueDto {
        schema_version: SCHEMA_VERSION,
        files: vec![QueueFileDto {
            recorder: RecorderDto {
                id: Uuid::from_u128(10).to_string(),
                name: "Deck".into(),
                host: "192.0.2.10".into(),
                port: 21,
            },
            remote_path: "/1/take#?.mov".into(),
            expected_size: Some(u64::MAX.to_string()),
            destination: "clip.mov".into(),
        }],
        options: BatchOptionsDto {
            duplicate: DuplicateDto::Rename,
            checksum: ChecksumDto::Both,
        },
    };
    assert_eq!(
        input.clone().validate().unwrap().0[0].media().size(),
        Some(u64::MAX)
    );
    let mut invalid = input.clone();
    invalid.files[0].remote_path = "/1/../2".into();
    assert!(invalid.validate().is_err());
    let mut invalid = input;
    invalid.files[0].expected_size = Some("18446744073709551616".into());
    assert!(invalid.validate().is_err());
    h.shutdown().await;
}

#[tokio::test]
async fn snapshot_subscription_watermark_and_bounded_event_lag_are_explicit() {
    let h = Harness::standard();
    let mut subscription = h.engine.subscribe().await.unwrap();
    assert_eq!(subscription.snapshot.sequence, 0);
    let request = h.file(
        10,
        "/1/clip.mov",
        "clip.mov",
        SimFile::new(vec![1; 2048]),
        Some(2048),
    );
    let batch = h
        .enqueue(vec![request], DuplicatePolicy::Rename, ChecksumMode::None)
        .await;
    h.engine.start(batch).await.unwrap();
    let s = h.settled().await;
    assert!(s.sequence > 256);
    assert!(matches!(
        subscription.events.try_recv(),
        Err(tokio::sync::broadcast::error::TryRecvError::Lagged(_))
    ));
    assert_eq!(h.events.events().len(), 256);
    assert_eq!(s.jobs[0].progress().written, 2048);
    let event = h.events.events().pop().unwrap();
    let dto = hmp_contract::EventDto::from(&event);
    assert_eq!(dto.sequence, event.sequence.to_string());
    h.shutdown().await;
}

#[tokio::test]
async fn verification_has_its_own_concurrency_budget() {
    let h = Harness::standard();
    let gate = Arc::new(Gate::default());
    h.disk.set_faults(DiskFaults {
        read_gate: Some(gate.clone()),
        ..Default::default()
    });
    let a = h.file(
        10,
        "/1/a.mov",
        "a.mov",
        SimFile::new(b"AAAA".to_vec()),
        Some(4),
    );
    let b = h.file(
        20,
        "/1/b.mov",
        "b.mov",
        SimFile::new(b"BBBB".to_vec()),
        Some(4),
    );
    let batch = h
        .enqueue(vec![a, b], DuplicatePolicy::Rename, ChecksumMode::Both)
        .await;
    h.engine.start(batch).await.unwrap();
    entered(&gate).await;
    h.wait(|s| {
        s.jobs
            .iter()
            .all(|j| j.status() == TransferStatus::Verifying)
    })
    .await;
    assert_eq!(gate.entries(), 1);
    assert_eq!(h.remote.active(), (0, 0));
    gate.release();
    tokio::time::timeout(Duration::from_secs(5), gate.entered_count(2))
        .await
        .unwrap();
    gate.release();
    assert!(
        h.settled()
            .await
            .jobs
            .iter()
            .all(|j| j.status() == TransferStatus::Verified)
    );
    h.shutdown().await;
}

#[tokio::test]
async fn cancellation_while_connecting_and_copying_is_cooperative() {
    for connecting in [true, false] {
        let h = Harness::standard();
        let gate = Arc::new(Gate::default());
        let mut file = SimFile::new(b"DATA".to_vec());
        if !connecting {
            file.read_gate = Some(gate.clone());
        }
        let request = h.file(10, "/1/clip.mov", "clip.mov", file, Some(4));
        if connecting {
            h.remote.connect_gate(request.recorder().id(), gate.clone());
        }
        let batch = h
            .enqueue(vec![request], DuplicatePolicy::Rename, ChecksumMode::Both)
            .await;
        h.engine.start(batch).await.unwrap();
        entered(&gate).await;
        let id = h.engine.snapshot().await.unwrap().jobs[0].id();
        h.engine.cancel(id).await.unwrap();
        assert_eq!(
            h.settled().await.jobs[0].status(),
            TransferStatus::Cancelled
        );
        assert_eq!(h.disk.publications(), 0);
        h.shutdown().await;
    }
}

#[tokio::test]
async fn cancelled_pending_job_never_opens_a_file_or_connection() {
    let h = Harness::standard();
    let request = h.file(
        10,
        "/1/clip.mov",
        "clip.mov",
        SimFile::new(b"DATA".to_vec()),
        Some(4),
    );
    let b = h
        .enqueue(vec![request], DuplicatePolicy::Rename, ChecksumMode::None)
        .await;
    let id = h.engine.snapshot().await.unwrap().jobs[0].id();
    h.engine.cancel(id).await.unwrap();
    h.engine.start(b).await.unwrap();
    h.settled().await;
    assert_eq!(h.remote.peak(), 0);
    assert!(h.disk.partial_names().is_empty());
    assert_eq!(h.disk.publications(), 0);
    h.shutdown().await;
}

#[tokio::test]
async fn dropping_last_handle_cleans_up_without_a_ui_close_callback() {
    let h = Harness::standard();
    let gate = Arc::new(Gate::default());
    let mut file = SimFile::new(b"DATA".to_vec());
    file.read_gate = Some(gate.clone());
    let request = h.file(10, "/1/clip.mov", "clip.mov", file, Some(4));
    let b = h
        .enqueue(vec![request], DuplicatePolicy::Rename, ChecksumMode::None)
        .await;
    h.engine.start(b).await.unwrap();
    entered(&gate).await;
    let Harness {
        engine,
        remote,
        disk,
        ..
    } = h;
    drop(engine);
    tokio::time::timeout(Duration::from_secs(5), async {
        while remote.active() != (0, 0) || disk.reservations() != 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(disk.publications(), 0);
}

#[tokio::test]
async fn snapshots_are_detached_and_ids_and_settings_are_validated() {
    let h = Harness::standard();
    let request = h.file(
        10,
        "/1/clip.mov",
        "clip.mov",
        SimFile::new(b"DATA".to_vec()),
        Some(4),
    );
    h.enqueue(vec![request], DuplicatePolicy::Rename, ChecksumMode::None)
        .await;
    let mut detached = h.engine.snapshot().await.unwrap();
    let attempt = detached.jobs[0].attempt();
    detached.jobs[0]
        .transition(attempt, TransferStatus::Cancelled)
        .unwrap();
    assert_eq!(
        h.engine.snapshot().await.unwrap().jobs[0].status(),
        TransferStatus::Pending
    );
    for config in [
        EngineConfig {
            global_limit: 0,
            ..Default::default()
        },
        EngineConfig {
            recorder_limit: 0,
            ..Default::default()
        },
        EngineConfig {
            verification_limit: 0,
            ..Default::default()
        },
    ] {
        assert_eq!(
            config.validate().unwrap_err().code,
            ErrorCode::InvalidSettings
        );
    }
    let settings = MemorySettings::default();
    assert_eq!(settings.load().await.unwrap(), EngineConfig::default());
    assert!(
        settings
            .save(&EngineConfig {
                global_limit: 0,
                ..Default::default()
            })
            .await
            .is_err()
    );
    h.shutdown().await;
}

#[tokio::test]
async fn non_nil_duplicate_id_sources_are_rejected_atomically() {
    struct Duplicate;
    impl IdSource for Duplicate {
        fn next(&self) -> Uuid {
            Uuid::from_u128(1)
        }
    }
    let h = Harness::standard();
    let request = h.file(
        10,
        "/1/clip.mov",
        "clip.mov",
        SimFile::new(b"DATA".to_vec()),
        Some(4),
    );
    let engine = Engine::spawn(
        EnginePorts {
            remote: h.remote.clone(),
            destination: h.disk.clone(),
            events: h.events.clone(),
            clock: Arc::new(StepClock::default()),
            ids: Arc::new(Duplicate),
        },
        EngineConfig::default(),
    )
    .unwrap();
    assert!(
        engine
            .enqueue_batch(
                vec![request],
                BatchOptions::new(DuplicatePolicy::Rename, ChecksumMode::None)
            )
            .await
            .is_err()
    );
    assert!(engine.snapshot().await.unwrap().jobs.is_empty());
    engine.shutdown().await.unwrap();
    h.shutdown().await;
}

#[tokio::test]
async fn authentication_errors_are_typed_and_do_not_touch_other_recorders() {
    let h = Harness::standard();
    let a = h.file(
        10,
        "/1/a.mov",
        "a.mov",
        SimFile::new(b"AAAA".to_vec()),
        Some(4),
    );
    let b = h.file(
        20,
        "/2/b.mov",
        "b.mov",
        SimFile::new(b"BBBB".to_vec()),
        Some(4),
    );
    h.remote
        .connection_error(a.recorder().id(), Some(ErrorCode::Authentication));
    let batch = h
        .enqueue(vec![a, b], DuplicatePolicy::Rename, ChecksumMode::None)
        .await;
    h.engine.start(batch).await.unwrap();
    let s = h.settled().await;
    assert_eq!(s.jobs[0].error().unwrap().code, ErrorCode::Authentication);
    assert_eq!(s.jobs[1].status(), TransferStatus::Done);
    h.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancellation_racing_publication_agrees_with_command_acknowledgement() {
    for _ in 0..32 {
        let h = Harness::standard();
        let gate = Arc::new(Gate::default());
        h.disk.seed(&name("clip.mov"), b"OLD!").unwrap();
        h.disk.set_faults(DiskFaults {
            prepare_gate: Some(gate.clone()),
            ..Default::default()
        });
        let request = h.file(
            10,
            "/1/clip.mov",
            "clip.mov",
            SimFile::new(b"NEW!".to_vec()),
            Some(4),
        );
        let batch = h
            .enqueue(
                vec![request],
                DuplicatePolicy::Overwrite,
                ChecksumMode::Both,
            )
            .await;
        h.engine.start(batch).await.unwrap();
        entered(&gate).await;
        let id = h.engine.snapshot().await.unwrap().jobs[0].id();
        let barrier = Arc::new(tokio::sync::Barrier::new(2));
        let cancelling = {
            let barrier = barrier.clone();
            let engine = h.engine.clone();
            tokio::spawn(async move {
                barrier.wait().await;
                engine.cancel(id).await
            })
        };
        barrier.wait().await;
        gate.release();
        let acknowledgement = cancelling.await.unwrap();
        let snapshot = h.settled().await;
        match acknowledgement {
            Ok(()) => {
                assert_eq!(snapshot.jobs[0].status(), TransferStatus::Cancelled);
                assert_eq!(h.disk.publications(), 0);
                assert_eq!(h.disk.final_bytes(&name("clip.mov")).unwrap(), b"OLD!");
            }
            Err(error) => {
                assert_eq!(error.code, ErrorCode::AlreadyTerminal);
                assert_eq!(snapshot.jobs[0].status(), TransferStatus::Verified);
                assert_eq!(h.disk.publications(), 1);
                assert_eq!(h.disk.final_bytes(&name("clip.mov")).unwrap(), b"NEW!");
            }
        }
        h.shutdown().await;
    }
}
