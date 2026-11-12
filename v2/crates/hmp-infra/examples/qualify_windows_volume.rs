use hmp_core::ports::{DestinationPort, ReservationOutcome};
use hmp_domain::{AttemptId, DuplicatePolicy, ErrorCode, JobId, LocalName, Uuid};
use hmp_infra::LocalDestination;
use std::{path::PathBuf, time::Duration};

#[tokio::main]
async fn main() {
    if std::env::consts::OS != "windows" {
        eprintln!("Windows is required");
        std::process::exit(2);
    }
    assert_eq!(std::env::var("GITHUB_ACTIONS").as_deref(), Ok("true"));
    let mut args = std::env::args().skip(1);
    let mode = args.next().expect("mode");
    let root = PathBuf::from(args.next().expect("disposable VHD root"));
    let folder = root.join("hmp-qualification");
    std::fs::create_dir(&folder).unwrap();
    let selected = LocalDestination::open(folder.clone()).await;
    if mode == "exfat" {
        let error = selected
            .err()
            .expect("exFAT unexpectedly supports this publication");
        assert_eq!(error.phase, hmp_domain::Phase::Planning);
        assert_eq!(std::fs::read_dir(folder).unwrap().count(), 0);
        println!("exFAT destination rejected before writing a media file: {error}");
        return;
    }
    assert!(matches!(mode.as_str(), "full" | "remove"));
    let disk = selected.unwrap();
    let free = disk.available_space().await.unwrap();
    assert!(
        free > 0 && free <= 128 * 1024 * 1024,
        "requires a small disposable VHD"
    );
    let ReservationOutcome::Reserved(reservation) = disk
        .reserve(
            &LocalName::new("volume-probe.mov").unwrap(),
            DuplicatePolicy::Rename,
            JobId::new(Uuid::new_v4()).unwrap(),
            AttemptId::new(Uuid::new_v4()).unwrap(),
        )
        .await
        .unwrap()
    else {
        panic!("expected exclusive reservation")
    };
    let mut writer = disk.create_partial(&reservation).await.unwrap();
    let data = vec![0x52; 64 * 1024];
    let mut failure = None;
    for index in 0..(128 * 16 + 16) {
        if let Err(error) = writer.write_all(&data).await {
            failure = Some(error);
            break;
        }
        if mode == "remove" {
            if let Err(error) = writer.finish().await {
                failure = Some(error);
                break;
            }
            if index == 0 {
                std::fs::write(args.next().expect("test coordination file"), b"ready").unwrap();
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
            assert!(index < 90, "disposable volume was not detached");
        }
    }
    let error = failure.expect("expected native disk error");
    if mode == "full" {
        assert_eq!(error.code, ErrorCode::DestinationFull);
        assert_eq!(
            std::fs::metadata(disk.staging_path().join(&reservation.partial_name))
                .unwrap()
                .len(),
            writer.bytes_written(),
        );
        assert!(!folder.join("volume-probe.mov").exists());
    }
    println!(
        "{mode}: {:?}; {} bytes acknowledged",
        error.code,
        writer.bytes_written()
    );
    drop(writer);
    disk.release(&reservation);
}
