use hmp_core::{Engine, Snapshot, ports::*};
use hmp_domain::*;
use hmp_infra::*;
use serde_json::Value;
use std::{
    io,
    net::SocketAddrV4,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
    task::{JoinHandle, JoinSet},
};

const TIMEOUT: Duration = Duration::from_secs(3);
const FILE: &str = "/1/été #?.mov";

#[derive(Clone, Copy, Default)]
enum Completion {
    #[default]
    Ok,
    Interrupted,
    Disconnect,
    HoldData,
    HoldReply,
    WrongSuccess,
}

#[derive(Clone, Default)]
struct Script {
    auth_failures: Vec<Option<u16>>,
    accept_user: bool,
    passive_only: bool,
    silent: bool,
    listing_rules: Vec<(String, u16)>,
    listing: Vec<u8>,
    payload: Vec<u8>,
    repeat_payload: Option<usize>,
    data_pause: Duration,
    completion: Completion,
    list_completion: Option<u16>,
}

struct Server {
    recorder: Recorder,
    commands: Arc<Mutex<Vec<String>>>,
    task: JoinHandle<()>,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl Server {
    async fn start(id: u128, script: Script) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let recorder = Recorder::new(
            RecorderId::new(Uuid::from_u128(id)).unwrap(),
            "Synthetic HyperDeck",
            "127.0.0.1",
            listener.local_addr().unwrap().port(),
        )
        .unwrap();
        let commands = Arc::new(Mutex::new(Vec::new()));
        let trace = commands.clone();
        let script = Arc::new(script);
        let task = tokio::spawn(async move {
            let mut sessions = JoinSet::new();
            let mut index = 0;
            loop {
                tokio::select! {
                    accepted = listener.accept() => {
                        let (socket, _) = accepted.unwrap();
                        sessions.spawn(serve(socket, script.clone(), trace.clone(), index));
                        index += 1;
                    }
                    completed = sessions.join_next(), if !sessions.is_empty() => {
                        completed.unwrap().expect("synthetic FTP handler panicked").ok();
                    }
                }
            }
        });
        Self {
            recorder,
            commands,
            task,
        }
    }
    fn commands(&self) -> Vec<String> {
        self.commands.lock().unwrap().clone()
    }
    fn assert_read_only(&self) {
        for line in self.commands() {
            assert!(
                matches!(
                    line.split(' ').next().unwrap(),
                    "USER"
                        | "PASS"
                        | "OPTS"
                        | "TYPE"
                        | "STRU"
                        | "EPSV"
                        | "PASV"
                        | "LIST"
                        | "CWD"
                        | "RETR"
                        | "QUIT"
                ),
                "{line}"
            );
        }
    }
}
async fn serve(
    socket: TcpStream,
    script: Arc<Script>,
    trace: Arc<Mutex<Vec<String>>>,
    index: usize,
) -> io::Result<()> {
    let mut socket = BufReader::new(socket);
    if !script.silent {
        socket
            .get_mut()
            .write_all(b"220-Synthetic bench\r\n220 Ready\r\n")
            .await?;
    }
    let mut passive = None;
    loop {
        let mut line = String::new();
        if socket.read_line(&mut line).await? == 0 {
            break;
        }
        let line = line.trim_end_matches(['\r', '\n']);
        trace.lock().unwrap().push(line.into());
        let (verb, _) = line.split_once(' ').unwrap_or((line, ""));
        let reply = match verb {
            "USER" if script.accept_user => "230 logged in".into(),
            "USER" => "331 password required".into(),
            "PASS" => match script.auth_failures.get(index) {
                Some(Some(code)) => format!("{code} rejected"),
                Some(None) => return Ok(()),
                None => "230 logged in".into(),
            },
            "OPTS" => "530 optional UTF-8 negotiation refused".into(),
            "STRU" => "502 optional command unsupported".into(),
            "TYPE" => "200 binary".into(),
            "CWD" => "250 changed".into(),
            "EPSV" if script.passive_only => "502 use PASV".into(),
            "EPSV" | "PASV" => {
                let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
                let port = listener.local_addr()?.port();
                passive = Some(listener);
                if verb == "EPSV" {
                    format!("229 (|||{port}|)")
                } else {
                    format!("227 (192,0,2,123,{},{})", port >> 8, port & 255)
                }
            }
            "LIST" | "RETR" => {
                let listener = passive.take().expect("no passive listener");
                let (mut data, _) = listener.accept().await?;
                if let Some((_, code)) = script
                    .listing_rules
                    .iter()
                    .find(|(expected, _)| expected == line)
                {
                    format!("{code} listing refused")
                } else {
                    socket.get_mut().write_all(b"150 Opening data\r\n").await?;
                    let bytes = if verb == "LIST" {
                        &script.listing
                    } else {
                        &script.payload
                    };
                    let repeats = if verb == "RETR" {
                        script.repeat_payload.unwrap_or(1)
                    } else {
                        1
                    };
                    for _ in 0..repeats {
                        data.write_all(bytes).await?;
                    }
                    if verb == "RETR" && !script.data_pause.is_zero() {
                        tokio::time::sleep(script.data_pause).await;
                    }
                    if verb == "RETR" && matches!(script.completion, Completion::HoldData) {
                        let mut probe = [0; 1];
                        assert_eq!(data.read(&mut probe).await?, 0);
                        return Ok(());
                    }
                    data.shutdown().await?;
                    drop(data);
                    if verb == "LIST" {
                        format!("{} listing complete", script.list_completion.unwrap_or(226))
                    } else {
                        match script.completion {
                            Completion::Ok => "226 complete".into(),
                            Completion::Interrupted => {
                                "426 transfer interrupted\r\n226 abort cleanup".into()
                            }
                            Completion::WrongSuccess => "200 unrelated success".into(),
                            Completion::Disconnect => return Ok(()),
                            Completion::HoldReply => {
                                let mut probe = [0; 1];
                                assert_eq!(socket.read(&mut probe).await?, 0);
                                return Ok(());
                            }
                            Completion::HoldData => unreachable!(),
                        }
                    }
                }
            }
            "QUIT" => return Ok(()),
            _ => panic!("unexpected command {line}"),
        };
        socket
            .get_mut()
            .write_all(format!("{reply}\r\n").as_bytes())
            .await?;
    }
    Ok(())
}

fn corpus() -> Value {
    serde_json::from_str(include_str!("../../tests/fixtures/ftp-legacy.json")).unwrap()
}
fn path(value: &str) -> RemotePath {
    RemotePath::new(value).unwrap()
}
fn name(value: &str) -> LocalName {
    LocalName::new(value).unwrap()
}
fn client() -> FtpRemote {
    FtpRemote::new(TIMEOUT).unwrap()
}

#[tokio::test]
async fn anonymous_and_explicit_auth_replay_all_v1_cases() {
    for case in corpus()["authentication"].as_array().unwrap() {
        let failures = case["errors"]
            .as_array()
            .unwrap()
            .iter()
            .map(|error| {
                error
                    .as_str()
                    .unwrap()
                    .get(..3)
                    .and_then(|code| code.parse().ok())
            })
            .collect();
        let server = Server::start(
            100,
            Script {
                auth_failures: failures,
                ..Default::default()
            },
        )
        .await;
        let user = case["user"].as_str().unwrap_or("anonymous");
        let password = case["password"].as_str().unwrap();
        let ftp = client().with_credentials(
            server.recorder.id(),
            FtpCredentials::new(user, password).unwrap(),
        );
        let result = ftp
            .connect(&server.recorder, &Cancellation::default())
            .await;
        if let Some(reject) = case["reject"].as_str() {
            let error = result.err().unwrap();
            assert_eq!(error.protocol_code, reject.parse().ok());
        } else {
            result.unwrap().close().await.unwrap();
        }
        let commands = server.commands();
        let attempts: Vec<_> = commands
            .iter()
            .filter_map(|line| line.strip_prefix("PASS "))
            .collect();
        let expected: Vec<_> = case["attempts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert_eq!(attempts, expected, "{}", case["id"]);
        assert_eq!(
            commands.iter().filter(|c| c.starts_with("USER ")).count(),
            expected.len()
        );
        assert!(
            commands
                .iter()
                .filter(|c| c.starts_with("USER "))
                .all(|c| c == &format!("USER {user}"))
        );
        server.assert_read_only();
    }
}

#[tokio::test]
async fn user_only_login_and_credential_command_injection() {
    assert!(FtpCredentials::new("anonymous\r\nDELE /a", "").is_err());
    assert!(FtpCredentials::new("anonymous", "secret\nSTOR /a").is_err());
    let server = Server::start(
        100,
        Script {
            accept_user: true,
            ..Default::default()
        },
    )
    .await;
    client()
        .connect(&server.recorder, &Cancellation::default())
        .await
        .unwrap()
        .close()
        .await
        .unwrap();
    assert!(!server.commands().iter().any(|c| c.starts_with("PASS")));
}

#[tokio::test]
async fn listing_replays_legacy_paths_statuses_and_passive_fallback() {
    let fixture = corpus();
    for case in fixture["listing"].as_array().unwrap() {
        let remote_path = case["path"].as_str().unwrap();
        let failure: Option<u16> = case["steps"][0][2]
            .as_str()
            .and_then(|msg| msg[..3].parse().ok());
        let rules = failure.map_or_else(Vec::new, |code| {
            vec![
                (format!("LIST -a {remote_path}"), code),
                (format!("LIST {remote_path}"), code),
                ("LIST -a".into(), 501),
            ]
        });
        let server = Server::start(
            100,
            Script {
                passive_only: true,
                listing_rules: rules,
                listing: fixture["unixRoot"].as_str().unwrap().as_bytes().to_vec(),
                ..Default::default()
            },
        )
        .await;
        let cancel = Cancellation::default();
        let mut session = client().connect(&server.recorder, &cancel).await.unwrap();
        let result = session.list(&path(remote_path), &cancel).await;
        if case["reject"].is_string() {
            assert_eq!(result.unwrap_err().protocol_code, Some(550));
        } else {
            let entries = result.unwrap();
            assert_eq!(entries.len(), 2);
            assert!(entries.iter().all(MediaEntry::is_directory));
        }
        let commands = server.commands();
        assert!(commands.iter().any(|c| c == "EPSV"));
        assert!(commands.iter().any(|c| c == "PASV"));
        if remote_path == "/1" {
            assert!(commands.iter().any(|c| c == "CWD /1"));
        }
        if failure.is_some() && !case["reject"].is_string() {
            assert!(commands.iter().any(|c| c == "LIST"));
        }
        server.assert_read_only();
    }
}

#[tokio::test]
async fn listing_preserves_special_names_and_only_returns_server_entries() {
    let fixture = corpus();
    let listing = format!(
        "{}{}-rw-r--r-- 1 owner group 4 Jan 01 2026  été #?.mov \r\n",
        fixture["unixMedia"].as_str().unwrap(),
        fixture["dosMedia"].as_str().unwrap()
    );
    let server = Server::start(
        100,
        Script {
            listing: listing.into_bytes(),
            ..Default::default()
        },
    )
    .await;
    let cancel = Cancellation::default();
    let mut session = client().connect(&server.recorder, &cancel).await.unwrap();
    let entries = session.list(&path("/"), &cancel).await.unwrap();
    assert_eq!(entries.len(), 4);
    assert!(entries.iter().all(|entry| !entry.is_directory()));
    assert!(
        entries
            .iter()
            .any(|entry| entry.path().as_str() == "/ été #?.mov ")
    );
    assert!(
        entries
            .iter()
            .any(|entry| entry.path().as_str() == "/été plan 01.mov")
    );
    assert!(
        entries
            .iter()
            .any(|entry| entry.path().as_str() == "/clip.mov" && entry.size() == Some(4))
    );
    assert!(entries.iter().any(|entry| entry.size() == Some(0)));
    session.close().await.unwrap();
}

#[tokio::test]
async fn list_completion_failure_preserves_code_without_retrying() {
    let server = Server::start(
        100,
        Script {
            list_completion: Some(550),
            ..Default::default()
        },
    )
    .await;
    let cancel = Cancellation::default();
    let mut session = client().connect(&server.recorder, &cancel).await.unwrap();
    assert_eq!(
        session
            .list(&path("/"), &cancel)
            .await
            .unwrap_err()
            .protocol_code,
        Some(550)
    );
    assert_eq!(
        server
            .commands()
            .iter()
            .filter(|c| c.starts_with("LIST"))
            .count(),
        1
    );
}

#[tokio::test]
async fn listing_rejects_invalid_encoding_and_path_injection() {
    for listing in [
        b"-rw-r--r-- 1 o g 4 Jan 01 2026 file\xff\r\n".to_vec(),
        b"-rw-r--r-- 1 o g 4 Jan 01 2026 ../escape\r\n".to_vec(),
    ] {
        let server = Server::start(
            100,
            Script {
                listing,
                ..Default::default()
            },
        )
        .await;
        let cancel = Cancellation::default();
        let mut session = client().connect(&server.recorder, &cancel).await.unwrap();
        assert!(session.list(&path("/"), &cancel).await.is_err());
        server.assert_read_only();
    }
}

fn engine(ftp: FtpRemote) -> (Engine, Arc<SandboxDestination>) {
    let disk = Arc::new(SandboxDestination::new().unwrap());
    let engine = Engine::spawn(
        EnginePorts {
            remote: Arc::new(ftp),
            destination: disk.clone(),
            events: Arc::new(RecordingSink::default()),
            clock: Arc::new(StepClock::default()),
            ids: Arc::new(SequentialIds::default()),
        },
        EngineConfig::default(),
    )
    .unwrap();
    (engine, disk)
}
async fn production_engine(
    root: &std::path::Path,
    ftp: FtpRemote,
) -> (Engine, Arc<LocalDestination>) {
    let disk = Arc::new(LocalDestination::open(root.to_owned()).await.unwrap());
    let engine = Engine::spawn(
        EnginePorts {
            remote: Arc::new(ftp),
            destination: disk.clone(),
            events: Arc::new(RecordingSink::default()),
            clock: Arc::new(StepClock::default()),
            ids: Arc::new(SequentialIds::default()),
        },
        EngineConfig::default(),
    )
    .unwrap();
    (engine, disk)
}
fn request(server: &Server, expected: Option<u64>) -> JobRequest {
    let recorder = server.recorder.clone();
    let entry = MediaEntry::new(recorder.id(), path(FILE), expected, false).unwrap();
    JobRequest::new(recorder, entry, name("clip.mov")).unwrap()
}
async fn start(engine: &Engine, jobs: Vec<JobRequest>, checksum: ChecksumMode) {
    let batch = engine
        .enqueue_batch(jobs, BatchOptions::new(DuplicatePolicy::Rename, checksum))
        .await
        .unwrap();
    engine.start(batch).await.unwrap();
}
async fn wait(engine: &Engine, predicate: impl Fn(&Snapshot) -> bool) -> Snapshot {
    wait_with_timeout(engine, Duration::from_secs(10), predicate).await
}
async fn wait_with_timeout(
    engine: &Engine,
    timeout: Duration,
    predicate: impl Fn(&Snapshot) -> bool,
) -> Snapshot {
    tokio::time::timeout(timeout, async {
        let mut subscription = engine.subscribe().await.unwrap();
        loop {
            let snapshot = engine.snapshot().await.unwrap();
            if predicate(&snapshot) {
                return snapshot;
            }
            let _ = subscription.events.recv().await;
        }
    })
    .await
    .expect("engine did not reach expected state")
}
async fn settled(engine: &Engine) -> Snapshot {
    wait(engine, |snapshot| {
        snapshot.active == 0 && snapshot.jobs.iter().all(|job| job.status().terminal())
    })
    .await
}

#[tokio::test]
async fn multiple_recorders_stream_and_verify_without_destination_collision() {
    let a = Server::start(
        100,
        Script {
            payload: b"DATA".to_vec(),
            listing: "-rw-r--r-- 1 owner group 4 Jan 01 2026 été #?.mov\r\n"
                .as_bytes()
                .to_vec(),
            ..Default::default()
        },
    )
    .await;
    let b = Server::start(
        101,
        Script {
            payload: b"MORE".to_vec(),
            listing: "-rw-r--r-- 1 owner group 4 Jan 01 2026 été #?.mov\r\n"
                .as_bytes()
                .to_vec(),
            passive_only: true,
            ..Default::default()
        },
    )
    .await;
    let ftp = client();
    let cancel = Cancellation::default();
    let mut jobs = Vec::new();
    for server in [&a, &b] {
        let mut session = ftp.connect(&server.recorder, &cancel).await.unwrap();
        let entries = session.list(&path("/1"), &cancel).await.unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path(), &path(FILE));
        jobs.push(
            JobRequest::new(
                server.recorder.clone(),
                entries[0].clone(),
                name("clip.mov"),
            )
            .unwrap(),
        );
        session.close().await.unwrap();
    }
    let folder = tempfile::tempdir().unwrap();
    let (engine, _) = production_engine(folder.path(), ftp).await;
    start(&engine, jobs, ChecksumMode::Both).await;
    let snapshot = settled(&engine).await;
    for (job, expected) in snapshot.jobs.iter().zip([b"DATA", b"MORE"]) {
        assert_eq!(job.status(), TransferStatus::Verified);
        assert_eq!(
            job.checksum().unwrap().scope,
            VerificationScope::TransferStreamComparedToLocal
        );
        assert_eq!(std::fs::read(job.destination().unwrap()).unwrap(), expected);
    }
    assert_ne!(
        snapshot.jobs[0].destination(),
        snapshot.jobs[1].destination()
    );
    assert_eq!(
        snapshot.jobs[0].checksum().unwrap().md5.as_deref(),
        Some("e44f9e348e41cb272efa87387728571b")
    );
    assert_eq!(
        snapshot.jobs[0].checksum().unwrap().sha256.as_deref(),
        Some("c97c29c7a71b392b437ee03fd17f09bb10b75e879466fc0eb757b2c4a78ac938")
    );
    for server in [&a, &b] {
        assert!(server.commands().contains(&format!("RETR {FILE}")));
        server.assert_read_only();
    }
    engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn incomplete_or_unconfirmed_transfers_never_publish() {
    for (completion, expected, kind, code) in [
        (
            Completion::Interrupted,
            Some(4),
            ErrorCode::ConnectionLost,
            Some(426),
        ),
        (
            Completion::Disconnect,
            Some(4),
            ErrorCode::ConnectionLost,
            None,
        ),
        (
            Completion::WrongSuccess,
            Some(4),
            ErrorCode::RemoteUnavailable,
            Some(200),
        ),
        (Completion::Ok, Some(8), ErrorCode::SizeMismatch, None),
    ] {
        let server = Server::start(
            100,
            Script {
                payload: b"DATA".to_vec(),
                completion,
                ..Default::default()
            },
        )
        .await;
        let (engine, disk) = engine(client());
        start(
            &engine,
            vec![request(&server, expected)],
            ChecksumMode::Both,
        )
        .await;
        let snapshot = settled(&engine).await;
        let job = &snapshot.jobs[0];
        assert_eq!(job.status(), TransferStatus::Error);
        assert_eq!(job.error().unwrap().code, kind);
        assert_eq!(job.error().unwrap().protocol_code, code);
        assert_eq!(disk.publications(), 0);
        assert_eq!(disk.partial_bytes(job).unwrap(), b"DATA");
        assert_eq!(disk.reservations(), 0);
        engine.shutdown().await.unwrap();
        server.assert_read_only();
    }
}

#[tokio::test]
async fn cancellation_during_data_read_leaves_only_identifiable_partial() {
    let server = Server::start(
        100,
        Script {
            payload: b"PA".to_vec(),
            completion: Completion::HoldData,
            ..Default::default()
        },
    )
    .await;
    let (engine, disk) = engine(client());
    start(&engine, vec![request(&server, Some(4))], ChecksumMode::Both).await;
    let snapshot = wait(&engine, |s| s.jobs[0].progress().written == 2).await;
    engine.cancel(snapshot.jobs[0].id()).await.unwrap();
    let snapshot = settled(&engine).await;
    assert_eq!(snapshot.jobs[0].status(), TransferStatus::Cancelled);
    assert_eq!(disk.partial_bytes(&snapshot.jobs[0]).unwrap(), b"PA");
    assert_eq!(disk.publications(), 0);
    assert_eq!(disk.reservations(), 0);
    engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn timeout_waiting_for_completion_and_greeting() {
    let server = Server::start(
        100,
        Script {
            silent: true,
            ..Default::default()
        },
    )
    .await;
    let ftp = FtpRemote::new(Duration::from_millis(300)).unwrap();
    assert_eq!(
        ftp.connect(&server.recorder, &Cancellation::default())
            .await
            .err()
            .unwrap()
            .code,
        ErrorCode::Timeout
    );
    assert!(server.commands().is_empty());
    let server = Server::start(
        100,
        Script {
            payload: b"DATA".to_vec(),
            completion: Completion::HoldReply,
            ..Default::default()
        },
    )
    .await;
    let (engine, disk) = engine(FtpRemote::new(Duration::from_millis(500)).unwrap());
    start(&engine, vec![request(&server, Some(4))], ChecksumMode::None).await;
    let snapshot = settled(&engine).await;
    assert_eq!(snapshot.jobs[0].error().unwrap().code, ErrorCode::Timeout);
    assert_eq!(disk.publications(), 0);
    engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn reader_requires_eof_before_final_response() {
    let server = Server::start(
        100,
        Script {
            payload: b"DATA".to_vec(),
            ..Default::default()
        },
    )
    .await;
    let cancel = Cancellation::default();
    let mut session = client().connect(&server.recorder, &cancel).await.unwrap();
    let mut reader = session.open_read(&path(FILE), &cancel).await.unwrap();
    assert!(reader.finish(&cancel).await.is_err());
    let mut data = Vec::new();
    let mut buffer = [0; 2];
    loop {
        let n = reader.read_chunk(&mut buffer, &cancel).await.unwrap();
        if n == 0 {
            break;
        }
        data.extend_from_slice(&buffer[..n]);
    }
    assert_eq!(data, b"DATA");
    reader.finish(&cancel).await.unwrap();
    assert!(reader.finish(&cancel).await.is_err());
    reader.close().await.unwrap();
    session.close().await.unwrap();
}

#[tokio::test]
async fn discovery_requires_device_info_and_keeps_model_and_identity() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let endpoint = match listener.local_addr().unwrap() {
        std::net::SocketAddr::V4(address) => address,
        _ => panic!("IPv4 expected"),
    };
    let task = tokio::spawn(async move {
        for model in [
            "HyperDeck Studio Mini",
            "HyperDeck Studio Mini",
            "Unrelated recorder",
        ] {
            let (socket, _) = listener.accept().await.unwrap();
            let mut socket = BufReader::new(socket);
            socket
                .get_mut()
                .write_all(b"500 connection info:\r\nprotocol version: 1.8\r\n\r\n")
                .await
                .unwrap();
            let mut query = String::new();
            socket.read_line(&mut query).await.unwrap();
            assert_eq!(query, "device info\r\n");
            socket.get_mut().write_all(format!("204 device info:\r\nmodel: {model}\r\nprotocol version: 1.8\r\nunique id: synthetic-2017\r\n\r\n").as_bytes()).await.unwrap();
        }
    });
    let discovery = HyperDeckDiscovery::new(TIMEOUT).unwrap();
    let cancel = Cancellation::default();
    let a = discovery.identify(endpoint, &cancel).await.unwrap();
    let b = discovery.identify(endpoint, &cancel).await.unwrap();
    assert_eq!(a.model, "HyperDeck Studio Mini");
    assert_eq!(a.protocol_version.as_deref(), Some("1.8"));
    assert_eq!(a.unique_id.as_deref(), Some("synthetic-2017"));
    assert_eq!(a.recorder.id(), b.recorder.id());
    assert_eq!(a.recorder.port(), 21);
    assert!(discovery.identify(endpoint, &cancel).await.is_err());
    task.await.unwrap();
}

#[tokio::test]
async fn discovery_refuses_public_and_oversized_ranges_and_honors_cancellation() {
    let discovery = HyperDeckDiscovery::new(TIMEOUT).unwrap();
    let cancel = Cancellation::default();
    for range in [
        "8.8.8.8/32",
        "192.168.0.0/16",
        "127.0.0.0/24",
        "invalid",
        "192.168.1.0/33",
    ] {
        assert_eq!(
            discovery.discover(range, &cancel).await.unwrap_err().code,
            ErrorCode::InvalidInput
        );
    }
    cancel.cancel();
    let endpoint: SocketAddrV4 = "127.0.0.1:9".parse().unwrap();
    assert_eq!(
        discovery
            .identify(endpoint, &cancel)
            .await
            .unwrap_err()
            .code,
        ErrorCode::Cancelled
    );
}

#[tokio::test]
async fn real_destination_survives_interruption_and_shutdown_while_another_deck_finishes() {
    let paused = Server::start(
        201,
        Script {
            completion: Completion::HoldData,
            payload: b"partial".to_vec(),
            ..Default::default()
        },
    )
    .await;
    let interrupted = Server::start(
        202,
        Script {
            completion: Completion::Interrupted,
            payload: b"interrupted".to_vec(),
            ..Default::default()
        },
    )
    .await;
    let healthy = Server::start(203, Script::default()).await;
    let folder = tempfile::tempdir().unwrap();
    let (engine, disk) = production_engine(folder.path(), client()).await;
    start(
        &engine,
        vec![
            request(&paused, None),
            request(&interrupted, None),
            request(&healthy, None),
        ],
        ChecksumMode::Both,
    )
    .await;
    let state = wait(&engine, |snapshot| {
        snapshot.jobs[0].progress().written > 0
            && snapshot.jobs[1].status() == TransferStatus::Error
            && snapshot.jobs[2].status() == TransferStatus::Verified
    })
    .await;
    assert_eq!(state.jobs[1].error().unwrap().protocol_code, Some(426));
    assert_eq!(state.jobs[0].status(), TransferStatus::Running);
    let closed = engine.shutdown().await.unwrap();
    assert_eq!(closed.active, 0);
    assert_eq!(closed.jobs[0].status(), TransferStatus::Cancelled);
    for job in &closed.jobs[..2] {
        assert!(job.destination().is_none());
        assert!(disk.staging_path().join(job.partial_name()).is_file());
    }
    assert!(std::path::Path::new(closed.jobs[2].destination().unwrap()).is_file());
    assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 2);
}

#[tokio::test]
async fn streams_past_four_gib_and_matches_independent_sha256() {
    const SIZE: u64 = (4_u64 << 30) + (1 << 20);
    let server = Server::start(
        220,
        Script {
            payload: (0..=255_u8).cycle().take(1 << 20).collect(),
            repeat_payload: Some(4097),
            ..Default::default()
        },
    )
    .await;
    let folder = tempfile::tempdir().unwrap();
    let (engine, _) = production_engine(folder.path(), client()).await;
    start(
        &engine,
        vec![request(&server, Some(SIZE))],
        ChecksumMode::Sha256,
    )
    .await;
    let snapshot = wait_with_timeout(&engine, Duration::from_secs(360), |state| {
        state.active == 0 && state.jobs.iter().all(|job| job.status().terminal())
    })
    .await;
    let job = &snapshot.jobs[0];
    assert_eq!(job.status(), TransferStatus::Verified, "{:?}", job.error());
    assert_eq!(job.progress().received, SIZE);
    assert_eq!(job.progress().written, SIZE);
    assert_eq!(job.progress().verified, SIZE);
    assert_eq!(
        std::fs::metadata(job.destination().unwrap()).unwrap().len(),
        SIZE
    );
    assert_eq!(
        job.checksum().unwrap().sha256.as_deref(),
        Some("117b24fae2fe12a5145b1b11ec31540994554977cf4a357f7cb602bc5c9b8de6")
    );
    server.assert_read_only();
    engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn transient_data_pause_finishes_when_the_ftp_socket_recovers_before_timeout() {
    let server = Server::start(
        221,
        Script {
            payload: b"DATA".to_vec(),
            data_pause: Duration::from_millis(350),
            ..Default::default()
        },
    )
    .await;
    let folder = tempfile::tempdir().unwrap();
    let (engine, _) = production_engine(folder.path(), client()).await;
    start(
        &engine,
        vec![request(&server, Some(4))],
        ChecksumMode::Sha256,
    )
    .await;
    let snapshot = settled(&engine).await;
    let job = &snapshot.jobs[0];
    assert_eq!(job.status(), TransferStatus::Verified);
    assert_eq!(std::fs::read(job.destination().unwrap()).unwrap(), b"DATA");
    engine.shutdown().await.unwrap();
}
