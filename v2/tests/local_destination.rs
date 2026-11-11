use hmp_core::ports::{DestinationPort, Reservation, ReservationOutcome};
use hmp_domain::{AttemptId, DuplicatePolicy, ErrorCode, JobId, LocalName, Uuid};
use hmp_infra::LocalDestination;
use std::{fs, path::PathBuf};
use tempfile::TempDir;

fn workspace() -> TempDir {
    let builder = tempfile::Builder::new();
    match std::env::var_os("HMP_TEST_VOLUME") {
        Some(path) => {
            let path = PathBuf::from(path);
            assert!(path.is_absolute());
            builder.tempdir_in(path).unwrap()
        }
        None => builder.tempdir().unwrap(),
    }
}

async fn reserve(
    disk: &LocalDestination,
    name: &str,
    policy: DuplicatePolicy,
) -> ReservationOutcome {
    disk.reserve(
        &LocalName::new(name).unwrap(),
        policy,
        JobId::new(Uuid::new_v4()).unwrap(),
        AttemptId::new(Uuid::new_v4()).unwrap(),
    )
    .await
    .unwrap()
}
fn held(outcome: ReservationOutcome) -> Reservation {
    match outcome {
        ReservationOutcome::Reserved(reservation) => reservation,
        ReservationOutcome::Skipped(_) => panic!("expected reservation"),
    }
}
async fn stage(disk: &LocalDestination, reservation: &Reservation, data: &[u8]) {
    let mut writer = disk.create_partial(reservation).await.unwrap();
    writer.write_all(data).await.unwrap();
    writer.finish().await.unwrap();
    assert_eq!(writer.bytes_written(), data.len() as u64);
    drop(writer);
    let mut reader = disk.open_readback(reservation).await.unwrap();
    let mut buffer = [0; 32];
    let size = reader.read_chunk(&mut buffer).await.unwrap();
    assert_eq!(&buffer[..size], data);
    drop(reader);
    disk.prepare_commit(reservation, data.len() as u64)
        .await
        .unwrap();
}

#[tokio::test]
async fn collision_skip_and_explicit_overwrite_on_real_destination() {
    let folder = workspace();
    let disk = LocalDestination::open(folder.path().to_owned())
        .await
        .unwrap();
    let first = held(reserve(&disk, "Clip.mov", DuplicatePolicy::Rename).await);
    let second = held(reserve(&disk, "clip.mov", DuplicatePolicy::Rename).await);
    assert_ne!(
        first.final_name.reservation_key(),
        second.final_name.reservation_key()
    );
    tokio::join!(stage(&disk, &first, b"AAA"), stage(&disk, &second, b"BBB"));
    assert!(!folder.path().join("Clip.mov").exists());
    for item in [&first, &second] {
        disk.commit(item, DuplicatePolicy::Rename).unwrap();
        disk.release(item);
    }
    let original = folder.path().join("Clip.mov");
    assert_eq!(fs::read(&original).unwrap(), b"AAA");
    assert!(matches!(
        reserve(&disk, "clip.mov", DuplicatePolicy::Skip).await,
        ReservationOutcome::Skipped(_)
    ));
    assert_eq!(fs::read(&original).unwrap(), b"AAA");
    let overwrite = held(reserve(&disk, "Clip.mov", DuplicatePolicy::Overwrite).await);
    stage(&disk, &overwrite, b"CCC").await;
    assert_eq!(fs::read(&original).unwrap(), b"AAA");
    disk.commit(&overwrite, DuplicatePolicy::Overwrite).unwrap();
    disk.release(&overwrite);
    assert_eq!(fs::read(&original).unwrap(), b"CCC");
    assert_eq!(
        fs::read(folder.path().join(second.final_name.as_str())).unwrap(),
        b"BBB"
    );
}

#[tokio::test]
async fn late_conflict_and_replaced_partial_never_publish() {
    let folder = workspace();
    let disk = LocalDestination::open(folder.path().to_owned())
        .await
        .unwrap();
    let reservation = held(reserve(&disk, "clip.mov", DuplicatePolicy::Rename).await);
    stage(&disk, &reservation, b"part").await;
    let final_path = folder.path().join("clip.mov");
    fs::write(&final_path, b"original").unwrap();
    assert_eq!(
        disk.commit(&reservation, DuplicatePolicy::Rename)
            .unwrap_err()
            .code,
        ErrorCode::DestinationConflict
    );
    assert_eq!(fs::read(&final_path).unwrap(), b"original");
    let staging = disk.staging_path();
    assert!(staging.join(&reservation.partial_name).exists());
    disk.release(&reservation);
    let next = held(reserve(&disk, "other.mov", DuplicatePolicy::Rename).await);
    stage(&disk, &next, b"part").await;
    let path = staging.join(&next.partial_name);
    fs::rename(&path, staging.join("held.part")).unwrap();
    fs::write(&path, b"fake").unwrap();
    assert_eq!(
        disk.commit(&next, DuplicatePolicy::Rename)
            .unwrap_err()
            .code,
        ErrorCode::DestinationConflict
    );
    disk.release(&next);
    drop(disk);
    assert!(!folder.path().join("other.mov").exists());
    assert!(path.exists());
}

#[tokio::test]
async fn space_and_invalid_destination_fail_before_publication() {
    let folder = workspace();
    let disk = LocalDestination::open(folder.path().to_owned())
        .await
        .unwrap();
    assert!(disk.available_space().await.is_some());
    assert_eq!(
        disk.check_space(Some(u64::MAX)).await.unwrap_err().code,
        ErrorCode::DestinationFull
    );
    let file = folder.path().join("not-a-directory");
    fs::write(&file, b"unchanged").unwrap();
    let error = LocalDestination::open(file.clone()).await.err().unwrap();
    assert_eq!(error.code, ErrorCode::PermissionDenied);
    assert_eq!(fs::read(file).unwrap(), b"unchanged");
}

#[cfg(unix)]
#[tokio::test]
async fn destination_permission_and_symlink_checks() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let folder = workspace();
    let protected = folder.path().join("read-only");
    fs::create_dir(&protected).unwrap();
    fs::set_permissions(&protected, fs::Permissions::from_mode(0o500)).unwrap();
    let result = LocalDestination::open(protected.clone()).await;
    fs::set_permissions(&protected, fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(result.err().unwrap().code, ErrorCode::PermissionDenied);
    let link = folder.path().join("link");
    symlink(&protected, &link).unwrap();
    assert_eq!(
        LocalDestination::open(link).await.err().unwrap().code,
        ErrorCode::PermissionDenied
    );
    assert_eq!(fs::read_dir(protected).unwrap().count(), 0);
}

#[cfg(windows)]
#[tokio::test]
async fn destination_denies_subdirectory_creation_by_ntfs_acl() {
    use std::process::Command;
    let folder = workspace();
    let protected = folder.path().join("restricted");
    fs::create_dir(&protected).unwrap();
    let account = Command::new("whoami.exe").output().unwrap();
    assert!(account.status.success());
    let account = String::from_utf8_lossy(&account.stdout);
    let account = account.trim();
    let deny = format!("{account}:(AD)");
    let apply = Command::new("icacls.exe")
        .arg(&protected)
        .args(["/deny", &deny])
        .output()
        .unwrap();
    assert!(apply.status.success(), "{apply:?}");
    let result = LocalDestination::open(protected.clone()).await;
    let restore = Command::new("icacls.exe")
        .arg(&protected)
        .args(["/remove:d", account])
        .output()
        .unwrap();
    assert!(restore.status.success(), "{restore:?}");
    assert_eq!(result.err().unwrap().code, ErrorCode::PermissionDenied);
    assert_eq!(fs::read_dir(protected).unwrap().count(), 0);
}
