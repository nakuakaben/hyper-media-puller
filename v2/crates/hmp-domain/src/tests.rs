use super::*;
fn job() -> TransferJob {
    let r = Recorder::new(
        RecorderId::new(Uuid::from_u128(10)).unwrap(),
        "Deck",
        "192.0.2.10",
        21,
    )
    .unwrap();
    let m = MediaEntry::new(
        r.id(),
        RemotePath::new("/1/clip.mov").unwrap(),
        Some(4),
        false,
    )
    .unwrap();
    TransferJob::new(
        JobId::new(Uuid::from_u128(20)).unwrap(),
        BatchId::new(Uuid::from_u128(30)).unwrap(),
        AttemptId::new(Uuid::from_u128(40)).unwrap(),
        JobRequest::new(r, m, LocalName::new("clip.mov").unwrap()).unwrap(),
    )
}

#[test]
fn identifiers_reject_nil_and_malformed_values_and_roundtrip() {
    assert!(RecorderId::new(Uuid::nil()).is_err());
    assert!("bad".parse::<RecorderId>().is_err());
    let id = RecorderId::new(Uuid::from_u128(10)).unwrap();
    assert_eq!(id.to_string().parse::<RecorderId>().unwrap(), id);
}
#[test]
fn invalid_metadata_and_recorder_file_mismatches_are_rejected() {
    let j = job();
    let r = j.request().recorder().clone();
    assert!(Recorder::new(r.id(), "", "192.0.2.10", 21).is_err());
    assert!(Recorder::new(r.id(), "Deck", "bad\nhost", 21).is_err());
    assert!(Recorder::new(r.id(), "Deck", "192.0.2.10", 0).is_err());
    assert!(MediaEntry::new(r.id(), RemotePath::new("/").unwrap(), Some(1), false).is_err());
    assert!(MediaEntry::new(r.id(), RemotePath::new("/1").unwrap(), Some(1), true).is_err());
    let other = MediaEntry::new(
        RecorderId::new(Uuid::from_u128(999)).unwrap(),
        RemotePath::new("/1/a.mov").unwrap(),
        None,
        false,
    )
    .unwrap();
    assert!(JobRequest::new(r, other, LocalName::new("a.mov").unwrap()).is_err());
}
#[test]
fn terminal_jobs_ignore_late_progress_outputs_and_errors() {
    let mut j = job();
    let a = j.attempt();
    j.transition(a, TransferStatus::Running).unwrap();
    j.transition(a, TransferStatus::Finalizing).unwrap();
    j.transition(a, TransferStatus::Done).unwrap();
    let settled = j.clone();
    assert!(!j.update_progress(
        a,
        TransferProgress {
            received: 4,
            written: 4,
            total: Some(4),
            ..Default::default()
        }
    ));
    j.set_error(TransferError::invalid("late"));
    j.set_output("late.mov".into(), None);
    assert!(j.transition(a, TransferStatus::Verified).is_err());
    assert!(j.transition(a, TransferStatus::Cancelled).is_err());
    assert_eq!(j, settled);
}
#[test]
fn stale_attempts_and_impossible_progress_are_rejected() {
    let mut j = job();
    let a = j.attempt();
    j.transition(a, TransferStatus::Running).unwrap();
    assert!(!j.update_progress(
        a,
        TransferProgress {
            received: 1,
            written: 2,
            total: Some(4),
            ..Default::default()
        }
    ));
    assert!(!j.update_progress(
        a,
        TransferProgress {
            received: 2,
            written: 2,
            verified: 3,
            total: Some(4)
        }
    ));
    j.transition(a, TransferStatus::Error).unwrap();
    let b = AttemptId::new(Uuid::from_u128(50)).unwrap();
    j.retry(b).unwrap();
    assert!(!j.update_progress(
        a,
        TransferProgress {
            received: 4,
            written: 4,
            total: Some(4),
            ..Default::default()
        }
    ));
    assert!(j.transition(a, TransferStatus::Running).is_err());
    j.transition(b, TransferStatus::Running).unwrap();
    j.transition(b, TransferStatus::Error).unwrap();
    assert!(j.retry(a).is_err());
}
#[test]
fn transitions_cannot_skip_verification_or_finalization() {
    let mut j = job();
    let a = j.attempt();
    assert!(j.transition(a, TransferStatus::Verified).is_err());
    j.transition(a, TransferStatus::Running).unwrap();
    assert!(j.transition(a, TransferStatus::Done).is_err());
    j.transition(a, TransferStatus::Verifying).unwrap();
    assert!(j.transition(a, TransferStatus::Verified).is_err());
    j.transition(a, TransferStatus::Cancelled).unwrap();
    assert!(j.transition(a, TransferStatus::Finalizing).is_err());
}
#[test]
fn raw_names_url_parsing_and_reversible_portable_names_are_separate() {
    assert_eq!(
        RemotePath::parse_input("FTP://192.0.2.10/2")
            .unwrap()
            .as_str(),
        "/2"
    );
    assert!(RemotePath::parse_input("ftp://192.0.2.10/1/../2").is_err());
    assert!(RemotePath::parse_input("ftp://operator@192.0.2.10/1").is_err());
    let path = RemotePath::new("/1/Été #?.mov").unwrap();
    let local = LocalName::from_remote(&path).unwrap();
    let hex = &local.as_str()[4..];
    let decoded: Vec<_> = hex
        .as_bytes()
        .chunks_exact(2)
        .map(|p| u8::from_str_radix(std::str::from_utf8(p).unwrap(), 16).unwrap())
        .collect();
    assert_eq!(
        String::from_utf8(decoded).unwrap(),
        path.file_name().unwrap()
    );
}
#[test]
fn batches_reject_empty_and_duplicate_job_ids() {
    let j = job();
    let options = BatchOptions::new(DuplicatePolicy::Rename, ChecksumMode::None);
    assert!(TransferBatch::new(j.batch(), options.clone(), vec![]).is_err());
    assert!(TransferBatch::new(j.batch(), options, vec![j.id(), j.id()]).is_err());
}
