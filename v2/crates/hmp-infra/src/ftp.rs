//! Read-only FTP transport. A RETR reader owns both sockets until completion.
use async_trait::async_trait;
use hmp_core::ports::*;
use hmp_domain::*;
use std::{collections::HashMap, future::Future, io, net::SocketAddr, time::Duration};
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::TcpStream,
};

const LINE_LIMIT: usize = 8192;
const LIST_LIMIT: u64 = 4 * 1024 * 1024;
const ANONYMOUS_PASSWORDS: [&str; 3] = ["", "anonymous@hmp.local", "guest@"];

#[derive(Clone)]
pub struct FtpCredentials {
    user: String,
    password: String,
}
impl FtpCredentials {
    pub fn new(user: impl Into<String>, password: impl Into<String>) -> Result<Self> {
        let user = user.into();
        let password = password.into();
        if user.trim().is_empty() || !safe_argument(&user) || !safe_argument(&password) {
            return Err(TransferError::invalid("invalid FTP credentials"));
        }
        Ok(Self {
            user: user.trim().to_owned(),
            password,
        })
    }
    pub fn anonymous() -> Self {
        Self {
            user: "anonymous".into(),
            password: String::new(),
        }
    }
}

pub struct FtpRemote {
    timeout: Duration,
    credentials: HashMap<RecorderId, FtpCredentials>,
}
impl FtpRemote {
    pub fn new(timeout: Duration) -> Result<Self> {
        if timeout.is_zero() {
            return Err(TransferError::invalid("FTP timeout must be positive"));
        }
        Ok(Self {
            timeout,
            credentials: HashMap::new(),
        })
    }
    pub fn with_credentials(mut self, recorder: RecorderId, credentials: FtpCredentials) -> Self {
        self.credentials.insert(recorder, credentials);
        self
    }
}
fn safe_argument(value: &str) -> bool {
    value.len() <= LINE_LIMIT - 16 && !value.bytes().any(|b| b < 32 || b == 127 || b == 255)
}
fn protocol(phase: Phase, message: &'static str) -> TransferError {
    TransferError::new(ErrorCode::RemoteUnavailable, phase, message)
}
fn io_error(phase: Phase, error: io::Error) -> TransferError {
    let code = if error.kind() == io::ErrorKind::TimedOut {
        ErrorCode::Timeout
    } else {
        ErrorCode::ConnectionLost
    };
    TransferError::new(code, phase, "FTP socket I/O failed")
}
fn rejected(phase: Phase, code: u16) -> TransferError {
    let kind = match code {
        530 => ErrorCode::Authentication,
        421 | 425 | 426 => ErrorCode::ConnectionLost,
        _ => ErrorCode::RemoteUnavailable,
    };
    let mut error = TransferError::new(kind, phase, format!("FTP rejected the operation ({code})"));
    error.protocol_code = Some(code);
    error
}
pub(crate) async fn bounded<T>(
    timeout: Duration,
    cancel: &Cancellation,
    phase: Phase,
    operation: impl Future<Output = Result<T>>,
) -> Result<T> {
    tokio::select! {
        biased;
        () = cancel.cancelled() => Err(TransferError::new(ErrorCode::Cancelled, phase, "operation cancelled")),
        result = tokio::time::timeout(timeout, operation) => result.unwrap_or_else(|_| Err(TransferError::new(ErrorCode::Timeout, phase, "network operation timed out"))),
    }
}

pub(crate) async fn bounded_line(reader: &mut (impl AsyncBufRead + Unpin)) -> io::Result<Vec<u8>> {
    let mut line = Vec::new();
    loop {
        let bytes = reader.fill_buf().await?;
        if bytes.is_empty() {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        let end = bytes.iter().position(|&b| b == b'\n');
        let count = end.map_or(bytes.len(), |index| index + 1);
        if line.len() + count > LINE_LIMIT {
            return Err(io::ErrorKind::InvalidData.into());
        }
        line.extend_from_slice(&bytes[..count]);
        reader.consume(count);
        if end.is_some() {
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            return Ok(line);
        }
    }
}

struct Reply {
    code: u16,
    line: Vec<u8>,
}
impl Reply {
    fn expect(self, accepted: &[u16], phase: Phase) -> Result<Self> {
        if accepted.contains(&self.code) {
            Ok(self)
        } else {
            Err(rejected(phase, self.code))
        }
    }
}
struct Control {
    socket: BufReader<TcpStream>,
    peer: SocketAddr,
    pasv_only: bool,
    root: bool,
}
impl Control {
    async fn response(&mut self, phase: Phase) -> Result<Reply> {
        let line = bounded_line(&mut self.socket)
            .await
            .map_err(|e| io_error(phase, e))?;
        let code = line
            .get(..3)
            .filter(|s| s.iter().all(u8::is_ascii_digit))
            .and_then(|s| std::str::from_utf8(s).ok())
            .and_then(|s| s.parse().ok())
            .ok_or_else(|| protocol(phase, "invalid FTP reply"))?;
        match line.get(3) {
            Some(b' ') | None => Ok(Reply { code, line }),
            Some(b'-') => {
                for _ in 0..63 {
                    let end = bounded_line(&mut self.socket)
                        .await
                        .map_err(|e| io_error(phase, e))?;
                    if end.get(..3) == line.get(..3) && end.get(3) == Some(&b' ') {
                        return Ok(Reply { code, line: end });
                    }
                }
                Err(protocol(phase, "FTP multiline reply exceeded limit"))
            }
            _ => Err(protocol(phase, "invalid FTP reply delimiter")),
        }
    }

    async fn command(&mut self, command: Command<'_>, phase: Phase) -> Result<Reply> {
        self.socket
            .get_mut()
            .write_all(command.line().as_bytes())
            .await
            .map_err(|e| io_error(phase, e))?;
        self.response(phase).await
    }

    async fn login(recorder: &Recorder, user: &str, password: &str) -> Result<Self> {
        let phase = Phase::Connecting;
        let socket = TcpStream::connect((recorder.host(), recorder.port()))
            .await
            .map_err(|e| io_error(phase, e))?;
        let peer = socket.peer_addr().map_err(|e| io_error(phase, e))?;
        let mut control = Self {
            socket: BufReader::new(socket),
            peer,
            pasv_only: false,
            root: true,
        };
        let greeting = control.response(phase).await?;
        if greeting.code == 120 {
            control.response(phase).await?.expect(&[220], phase)?;
        } else {
            greeting.expect(&[220], phase)?;
        }
        control.optional(Command::Utf8).await?;
        let reply = control.command(Command::User(user), phase).await?;
        let login = match reply.code {
            230 => Ok(reply),
            331 => control.command(Command::Pass(password), phase).await,
            _ => Ok(reply),
        }?;
        if login.code != 230 {
            let mut error = rejected(phase, login.code);
            if (500..=599).contains(&login.code) {
                error.code = ErrorCode::Authentication;
                error.retryable = false;
            }
            return Err(error);
        }
        control
            .command(Command::Binary, phase)
            .await?
            .expect(&[200], phase)?;
        control.optional(Command::FileStructure).await?;
        control.optional(Command::Utf8).await?;
        Ok(control)
    }
    async fn optional(&mut self, command: Command<'_>) -> Result<()> {
        let phase = Phase::Connecting;
        let reply = self.command(command, phase).await?;
        match reply.code {
            200..=299 | 400..=420 | 422..=599 => Ok(()),
            code => Err(rejected(phase, code)),
        }
    }
    async fn passive(&mut self, phase: Phase) -> Result<TcpStream> {
        let mut port = None;
        if !self.pasv_only {
            let reply = self.command(Command::Epsv, phase).await?;
            match reply.code {
                229 => port = passive_port(&reply.line, true),
                500 | 501 | 502 | 504 | 522 if self.peer.is_ipv4() => self.pasv_only = true,
                code => return Err(rejected(phase, code)),
            }
        }
        if self.pasv_only {
            let reply = self
                .command(Command::Pasv, phase)
                .await?
                .expect(&[227], phase)?;
            port = passive_port(&reply.line, false);
        }
        let port = port
            .filter(|p| *p != 0)
            .ok_or_else(|| protocol(phase, "invalid passive FTP port"))?;
        // The control peer owns the data connection. Ignore the address in 227.
        TcpStream::connect(SocketAddr::new(self.peer.ip(), port))
            .await
            .map_err(|e| io_error(phase, e))
    }
    async fn begin(&mut self, command: Command<'_>, phase: Phase) -> Result<TcpStream> {
        let data = self.passive(phase).await?;
        self.command(command, phase)
            .await?
            .expect(&[125, 150], phase)?;
        Ok(data)
    }
    async fn completion(&mut self) -> Result<()> {
        self.response(Phase::Copying)
            .await?
            .expect(&[226, 250], Phase::Copying)?;
        Ok(())
    }
    async fn quit(mut self) {
        let _ = self
            .socket
            .get_mut()
            .write_all(Command::Quit.line().as_bytes())
            .await;
    }
}

enum Command<'a> {
    User(&'a str),
    Pass(&'a str),
    Utf8,
    Binary,
    FileStructure,
    Epsv,
    Pasv,
    List { all: bool, path: Option<&'a str> },
    Cwd(&'a str),
    Retr(&'a str),
    Quit,
}
impl Command<'_> {
    fn line(self) -> String {
        let command = match self {
            Self::User(value) => format!("USER {value}"),
            Self::Pass(value) => format!("PASS {value}"),
            Self::Utf8 => "OPTS UTF8 ON".into(),
            Self::Binary => "TYPE I".into(),
            Self::FileStructure => "STRU F".into(),
            Self::Epsv => "EPSV".into(),
            Self::Pasv => "PASV".into(),
            Self::List { all, path } => {
                let mut line = String::from(if all { "LIST -a" } else { "LIST" });
                if let Some(path) = path {
                    line.push(' ');
                    line.push_str(path);
                }
                line
            }
            Self::Cwd(path) => format!("CWD {path}"),
            Self::Retr(path) => format!("RETR {path}"),
            Self::Quit => "QUIT".into(),
        };
        command + "\r\n"
    }
}
fn passive_port(line: &[u8], extended: bool) -> Option<u16> {
    let line = std::str::from_utf8(line).ok()?;
    let (_, values) = line.split_once('(')?;
    let (values, _) = values.split_once(')')?;
    if extended {
        let delimiter = values
            .as_bytes()
            .first()
            .copied()
            .filter(|b| (33..=126).contains(b))?;
        let mut fields = values.split(char::from(delimiter));
        if !fields.next()?.is_empty() || !fields.next()?.is_empty() || !fields.next()?.is_empty() {
            return None;
        }
        let port = fields.next()?.parse().ok()?;
        return (fields.next()?.is_empty() && fields.next().is_none()).then_some(port);
    }
    let bytes = values
        .split(',')
        .map(str::parse::<u8>)
        .collect::<std::result::Result<Vec<_>, _>>()
        .ok()?;
    let [_, _, _, _, high, low] = bytes.as_slice() else {
        return None;
    };
    Some(u16::from_be_bytes([*high, *low]))
}

#[async_trait]
impl RemoteReadPort for FtpRemote {
    async fn connect(
        &self,
        recorder: &Recorder,
        cancel: &Cancellation,
    ) -> Result<Box<dyn RemoteReadSession>> {
        let default = FtpCredentials::anonymous();
        let credentials = self.credentials.get(&recorder.id()).unwrap_or(&default);
        let explicit = [credentials.password.as_str()];
        let passwords = if credentials.user.eq_ignore_ascii_case("anonymous")
            && credentials.password.is_empty()
        {
            ANONYMOUS_PASSWORDS.as_slice()
        } else {
            explicit.as_slice()
        };
        bounded(self.timeout, cancel, Phase::Connecting, async {
            for (index, password) in passwords.iter().enumerate() {
                match Control::login(recorder, &credentials.user, password).await {
                    Ok(control) => {
                        return Ok(Box::new(Session {
                            recorder: recorder.id(),
                            timeout: self.timeout,
                            control: Some(control),
                        }) as Box<dyn RemoteReadSession>);
                    }
                    Err(error)
                        if index + 1 < passwords.len()
                            && error.code == ErrorCode::Authentication
                            && matches!(error.protocol_code, Some(501 | 530)) => {}
                    Err(error) => return Err(error),
                }
            }
            unreachable!("password attempts are nonempty")
        })
        .await
    }
}

struct Session {
    recorder: RecorderId,
    timeout: Duration,
    control: Option<Control>,
}
impl Session {
    fn take_control(&mut self) -> Result<Control> {
        self.control
            .take()
            .ok_or_else(|| protocol(Phase::Connecting, "FTP session closed or consumed by RETR"))
    }
}
#[async_trait]
impl RemoteReadSession for Session {
    async fn list(&mut self, path: &RemotePath, cancel: &Cancellation) -> Result<Vec<MediaEntry>> {
        validate_path(path)?;
        let mut control = self.take_control()?;
        let listing = bounded(
            self.timeout,
            cancel,
            Phase::Planning,
            list(&mut control, path.as_str()),
        )
        .await?;
        let entries = parse_listing(self.recorder, path, &listing)?;
        self.control = Some(control);
        Ok(entries)
    }
    async fn open_read(
        &mut self,
        path: &RemotePath,
        cancel: &Cancellation,
    ) -> Result<Box<dyn RemoteReader>> {
        validate_path(path)?;
        path.file_name()?;
        let mut control = self.take_control()?;
        let data = bounded(
            self.timeout,
            cancel,
            Phase::Connecting,
            control.begin(Command::Retr(path.as_str()), Phase::Connecting),
        )
        .await?;
        Ok(Box::new(Reader {
            control: Some(control),
            data: Some(data),
            eof: false,
            timeout: self.timeout,
        }))
    }
    async fn close(&mut self) -> Result<()> {
        if let Some(control) = self.control.take() {
            let _ = tokio::time::timeout(self.timeout.min(Duration::from_secs(1)), control.quit())
                .await;
        }
        Ok(())
    }
}
fn validate_path(path: &RemotePath) -> Result<()> {
    if safe_argument(path.as_str()) {
        Ok(())
    } else {
        Err(TransferError::new(
            ErrorCode::InvalidPath,
            Phase::Planning,
            "unsafe FTP path",
        ))
    }
}

async fn list(control: &mut Control, path: &str) -> Result<Vec<u8>> {
    let phase = Phase::Planning;
    let refusal = match list_candidates(control, Some(path)).await? {
        Ok(data) => return Ok(data),
        Err(code) => code,
    };
    let retry = refusal == 501 || (path == "/" && matches!(refusal, 450 | 500..=504 | 550));
    if !retry {
        return Err(rejected(phase, refusal));
    }
    if path != "/" || !control.root {
        control
            .command(Command::Cwd(path), phase)
            .await?
            .expect(&[250], phase)?;
        control.root = path == "/";
    }
    list_candidates(control, None)
        .await?
        .map_err(|code| rejected(phase, code))
}

// The inner error is a refusal of LIST before the transfer started.
// Errors on passive negotiation, data or completion never enter the fallback.
async fn list_candidates(
    control: &mut Control,
    path: Option<&str>,
) -> Result<std::result::Result<Vec<u8>, u16>> {
    let phase = Phase::Planning;
    for all in [true, false] {
        let socket = control.passive(phase).await?;
        let reply = control.command(Command::List { all, path }, phase).await?;
        if matches!(reply.code, 125 | 150) {
            let mut bytes = Vec::new();
            socket
                .take(LIST_LIMIT + 1)
                .read_to_end(&mut bytes)
                .await
                .map_err(|e| io_error(phase, e))?;
            if bytes.len() as u64 > LIST_LIMIT {
                return Err(protocol(phase, "FTP listing exceeded size limit"));
            }
            control.completion().await?;
            return Ok(Ok(bytes));
        }
        if !all || !matches!(reply.code, 450 | 500..=504 | 550) {
            return Ok(Err(reply.code));
        }
    }
    unreachable!("plain LIST always returns a result")
}
fn parse_listing(
    recorder: RecorderId,
    parent: &RemotePath,
    bytes: &[u8],
) -> Result<Vec<MediaEntry>> {
    let mut entries = Vec::new();
    let text = std::str::from_utf8(bytes)
        .map_err(|_| protocol(Phase::Planning, "FTP listing is not UTF-8"))?;
    for line in text.lines() {
        if line.trim().is_empty()
            || line
                .strip_prefix("total ")
                .is_some_and(|n| n.trim().parse::<u64>().is_ok())
        {
            continue;
        }
        let entry = listing_entry(line)
            .ok_or_else(|| protocol(Phase::Planning, "unsupported FTP listing record"))?;
        let Some((name, directory, size)) = entry else {
            continue;
        };
        if name == "." || name == ".." {
            continue;
        }
        if name.is_empty() || name.contains('/') || !safe_argument(name) {
            return Err(protocol(Phase::Planning, "invalid FTP listing name"));
        }
        let path = RemotePath::new(&format!("{}/{name}", parent.as_str().trim_end_matches('/')))?;
        validate_path(&path)?;
        entries.push(MediaEntry::new(recorder, path, size, directory)?);
    }
    entries.sort_by(|a, b| {
        b.is_directory()
            .cmp(&a.is_directory())
            .then_with(|| a.path().cmp(b.path()))
    });
    Ok(entries)
}

type ListingEntry<'a> = (&'a str, bool, Option<u64>);
fn listing_entry(line: &str) -> Option<Option<ListingEntry<'_>>> {
    let first = line.split_ascii_whitespace().next()?;
    if first.len() >= 10
        && first
            .as_bytes()
            .get(1)
            .is_some_and(|b| matches!(b, b'r' | b'-'))
    {
        let (fields, name) = fields_and_name(line, 8)?;
        return match first.as_bytes()[0] {
            b'd' => Some(Some((name, true, None))),
            b'-' => Some(Some((name, false, Some(fields[4].parse().ok()?)))),
            b'l' | b'b' | b'c' | b'p' | b's' => Some(None),
            _ => None,
        };
    }
    let (fields, name) = fields_and_name(line, 3)?;
    if first.split('-').count() != 3 || !fields[1].contains(':') {
        return None;
    }
    if fields[2].eq_ignore_ascii_case("<DIR>") {
        Some(Some((name.trim_start_matches([' ', '\t']), true, None)))
    } else {
        Some(Some((
            name.trim_start_matches([' ', '\t']),
            false,
            Some(fields[2].parse().ok()?),
        )))
    }
}
fn fields_and_name(mut line: &str, count: usize) -> Option<(Vec<&str>, &str)> {
    let mut fields = Vec::with_capacity(count);
    for _ in 0..count {
        line = line.trim_start_matches([' ', '\t']);
        let end = line.find([' ', '\t'])?;
        fields.push(&line[..end]);
        line = &line[end + 1..];
    }
    Some((fields, line))
}

struct Reader {
    control: Option<Control>,
    data: Option<TcpStream>,
    eof: bool,
    timeout: Duration,
}
#[async_trait]
impl RemoteReader for Reader {
    async fn read_chunk(&mut self, buffer: &mut [u8], cancel: &Cancellation) -> Result<usize> {
        if buffer.is_empty() {
            return Err(TransferError::invalid("empty FTP read buffer"));
        }
        if self.eof && self.data.is_some() {
            return Ok(0);
        }
        let mut data = self
            .data
            .take()
            .ok_or_else(|| protocol(Phase::Copying, "FTP data stream closed"))?;
        // Move both sockets into the future so external cancellation also closes them.
        let control = self.control.take();
        let bytes = bounded(self.timeout, cancel, Phase::Copying, async {
            data.read(buffer)
                .await
                .map_err(|e| io_error(Phase::Copying, e))
        })
        .await?;
        self.eof = bytes == 0;
        self.data = Some(data);
        self.control = control;
        Ok(bytes)
    }
    async fn finish(&mut self, cancel: &Cancellation) -> Result<RemoteCompletion> {
        if !self.eof {
            return Err(protocol(Phase::Copying, "FTP data EOF not reached"));
        }
        self.data.take();
        let mut control = self
            .control
            .take()
            .ok_or_else(|| protocol(Phase::Copying, "FTP completion already consumed"))?;
        bounded(self.timeout, cancel, Phase::Copying, control.completion()).await?;
        self.control = Some(control);
        Ok(RemoteCompletion { source_size: None })
    }
    async fn close(&mut self) -> Result<()> {
        self.data.take();
        if let Some(control) = self.control.take() {
            if self.eof {
                let _ =
                    tokio::time::timeout(self.timeout.min(Duration::from_secs(1)), control.quit())
                        .await;
            }
        }
        Ok(())
    }
}
