use super::*;
use hmp_domain::{Recorder, RecorderId, Uuid};
use serde_json::{Value, json};
use std::{fs, io};
use tauri::{
    WebviewWindow,
    ipc::{CallbackFn, InvokeBody},
    test::{INVOKE_KEY, MockRuntime},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
};

const MEDIA: &[u8] = b"DATA";
const NAME: &str = "clip.mov";

async fn ftp_fixture(listener: TcpListener) {
    while let Ok((socket, _)) = listener.accept().await {
        tokio::spawn(async move { ftp_session(socket).await.expect("local FTP session") });
    }
}

async fn ftp_session(socket: TcpStream) -> io::Result<()> {
    let mut socket = BufReader::new(socket);
    socket.get_mut().write_all(b"220 Synthetic FTP\r\n").await?;
    let mut passive = None;
    let mut line = String::new();
    while socket.read_line(&mut line).await? != 0 {
        let reply = match line.split_whitespace().next().unwrap_or_default() {
            "USER" => "331 password\r\n".into(),
            "PASS" => "230 logged in\r\n".into(),
            "OPTS" | "STRU" => "502 optional unsupported\r\n".into(),
            "TYPE" => "200 binary\r\n".into(),
            "EPSV" => {
                let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
                let port = listener.local_addr()?.port();
                passive = Some(listener);
                format!("229 (|||{port}|)\r\n")
            }
            "LIST" | "RETR" => {
                let (mut data, _) = passive.take().expect("EPSV first").accept().await?;
                socket.get_mut().write_all(b"150 Opening data\r\n").await?;
                if line.starts_with("LIST") {
                    data.write_all(b"-rw-r--r-- 1 owner group 4 Jan 01 2026 clip.mov\r\n-rw-r--r-- 1 owner group 4 Jan 01 2026 ._clip.mov\r\n")
                        .await?;
                } else {
                    assert_eq!(line.trim(), "RETR /clip.mov");
                    data.write_all(MEDIA).await?;
                }
                data.shutdown().await?;
                "226 transfer complete\r\n".into()
            }
            "QUIT" => break,
            _ => panic!("unexpected FTP command: {line}"),
        };
        socket.get_mut().write_all(reply.as_bytes()).await?;
        line.clear();
    }
    Ok(())
}

fn invoke(window: &WebviewWindow<MockRuntime>, cmd: &str, body: Value) -> Result<Value, Value> {
    tauri::test::get_ipc_response(
        window,
        tauri::webview::InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: if cfg!(windows) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .unwrap(),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.into(),
        },
    )
    .map(|reply| reply.deserialize::<Value>().unwrap())
}

#[test]
fn ipc_listing_queue_actions_snapshot_and_real_report() {
    let profile = tempfile::tempdir().unwrap();
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    let (service, recorder) = tauri::async_runtime::block_on(async {
        let service = Arc::new(Offload::new(profile.path()).unwrap());
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(ftp_fixture(listener));
        let recorder = Recorder::new(
            RecorderId::new(Uuid::new_v4()).unwrap(),
            "Synthetic",
            "127.0.0.1",
            port,
        )
        .unwrap();
        service.remember(recorder.clone());
        (service, recorder)
    });
    let app = tauri::test::mock_builder()
        .manage(service.clone())
        .invoke_handler(tauri::generate_handler![
            list_media,
            transfer_settings,
            save_transfer_options,
            enqueue_transfer,
            transfer_action,
            transfer_queue,
            transfer_report
        ])
        .build(context())
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let call = |cmd, body| invoke(&window, cmd, body).unwrap();
    let id = recorder.id().to_string();
    let listing = call("list_media", json!({"recorderId": id, "path": "/"}));
    assert_eq!(listing[0]["size"], "4");
    assert!(
        listing
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["remote_path"] == "/._clip.mov")
    );
    let options = json!({"batch": {"duplicate": "rename", "checksum": "both"}, "global_limit": 2, "recorder_limit": 1});
    let request = |path: &str| {
        json!({"request": {
            "schema_version": 1, "recorder_id": id, "paths": [path], "options": options,
        }})
    };
    assert!(invoke(&window, "enqueue_transfer", request("/clip.mov")).is_err());
    tauri::async_runtime::block_on(service.select(first.path().to_owned())).unwrap();
    assert!(invoke(&window, "enqueue_transfer", request("/forged.mov")).is_err());
    for path in ["/._clip.mov", "/System Volume Information/clip.mov"] {
        let error = invoke(&window, "enqueue_transfer", request(path)).unwrap_err();
        assert_eq!(
            error["message"],
            "Les fichiers système sont réservés au diagnostic"
        );
    }
    let batch = call("enqueue_transfer", request("/clip.mov"))
        .as_str()
        .unwrap()
        .to_owned();

    tauri::async_runtime::block_on(service.select(second.path().to_owned())).unwrap();
    let new = json!({"batch": {"duplicate": "skip", "checksum": "none"}, "global_limit": 1, "recorder_limit": 1});
    assert!(
        invoke(
            &window,
            "save_transfer_options",
            json!({"schemaVersion": 9, "options": new})
        )
        .is_err()
    );
    call(
        "save_transfer_options",
        json!({"schemaVersion": 1, "options": new}),
    );
    call(
        "transfer_action",
        json!({"schemaVersion": 1, "action": "start", "id": batch}),
    );
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    let terminal = loop {
        let queue = call("transfer_queue", json!({}));
        let job = &queue["jobs"][0];
        if job["status"] == "verified" && queue["active"] == 0 {
            break job.clone();
        }
        assert!(
            std::time::Instant::now() < deadline,
            "queue never verified: {queue}"
        );
        std::thread::sleep(Duration::from_millis(25));
    };
    assert_eq!(terminal["progress"]["written"], "4");
    assert_eq!(fs::read(first.path().join(NAME)).unwrap(), MEDIA);
    assert!(!second.path().join(NAME).exists());
    let fresh = call("transfer_queue", json!({}));
    assert_eq!(fresh["jobs"][0], terminal);
    let report = call("transfer_report", json!({"batchId": batch}));
    assert_eq!(report["schema_version"], 1);
    assert_eq!(report["batch"]["options"]["batch"]["checksum"], "both");
    assert_eq!(report["jobs"][0]["source"]["id"], id);
    assert_eq!(
        report["jobs"][0]["transfer"]["checksum"]["scope"],
        "transfer_stream_compared_to_local"
    );
    assert_eq!(
        report["jobs"][0]["transfer"]["checksum"]["sha256"],
        "c97c29c7a71b392b437ee03fd17f09bb10b75e879466fc0eb757b2c4a78ac938"
    );
    assert!(report["jobs"][0]["ended_at_millis"].is_string());

    tauri::async_runtime::block_on(async {
        service.engine().shutdown().await.unwrap();
        let reopened = Offload::new(profile.path()).unwrap();
        let settings = reopened.settings().await;
        assert_eq!(
            settings.destination.as_deref(),
            second.path().canonicalize().unwrap().to_str()
        );
        assert_eq!(settings.options.global_limit, 1);
        reopened.engine().shutdown().await.unwrap();
    });
}
