//! Bounded, opt-in IPv4 discovery using the read-only HyperDeck device info command.
use crate::ftp::{bounded, bounded_line};
use async_trait::async_trait;
use hmp_core::ports::{Cancellation, DiscoveryPort};
use hmp_domain::*;
use if_addrs::IfAddr;
use sha2::{Digest, Sha256};
use std::{
    net::{Ipv4Addr, SocketAddr, SocketAddrV4},
    time::Duration,
};
use tokio::{
    io::{AsyncWriteExt, BufReader},
    net::{TcpSocket, TcpStream},
    task::JoinSet,
};

const CONTROL_PORT: u16 = 9993;
const FTP_PORT: u16 = 21;
const SCAN_CONCURRENCY: usize = 32;

#[derive(Clone, Debug)]
pub struct DeckIdentity {
    pub recorder: Recorder,
    pub model: String,
    pub protocol_version: Option<String>,
    pub unique_id: Option<String>,
}

pub struct HyperDeckDiscovery {
    timeout: Duration,
}
impl HyperDeckDiscovery {
    pub fn new(timeout: Duration) -> Result<Self> {
        if timeout.is_zero() {
            return Err(TransferError::invalid("discovery timeout must be positive"));
        }
        Ok(Self { timeout })
    }

    /// Probe one caller-selected address and return the device metadata.
    pub async fn identify(
        &self,
        endpoint: SocketAddrV4,
        cancel: &Cancellation,
    ) -> Result<DeckIdentity> {
        probe(endpoint, None, self.timeout, cancel).await
    }
}

fn local_interfaces() -> Result<Vec<(String, Ipv4Addr, Ipv4Addr)>> {
    let interfaces =
        if_addrs::get_if_addrs().map_err(|_| error("network interface enumeration failed"))?;
    Ok(interfaces
        .into_iter()
        .filter_map(|interface| match interface.addr {
            IfAddr::V4(addr) if local(addr.ip) => Some((interface.name, addr.ip, addr.netmask)),
            _ => None,
        })
        .collect())
}
fn local(ip: Ipv4Addr) -> bool {
    ip.is_private() || ip.is_link_local()
}
fn error(message: &'static str) -> TransferError {
    TransferError::new(ErrorCode::RemoteUnavailable, Phase::Connecting, message)
}

fn scan_range(scope: &str) -> Result<(u32, u32)> {
    let (ip, prefix) = scope
        .split_once('/')
        .ok_or_else(|| TransferError::invalid("expected IPv4 CIDR"))?;
    let ip: Ipv4Addr = ip
        .parse()
        .map_err(|_| TransferError::invalid("invalid IPv4 scan address"))?;
    let prefix: u32 = prefix
        .parse()
        .map_err(|_| TransferError::invalid("invalid scan prefix"))?;
    if !local(ip) || !(24..=32).contains(&prefix) {
        return Err(TransferError::invalid(
            "scan must use a private or link-local /24 to /32",
        ));
    }
    let mask = u32::MAX << (32 - prefix);
    let network = u32::from(ip) & mask;
    let broadcast = network | !mask;
    // /31 and /32 have no excluded network/broadcast hosts.
    let (first, last) = if prefix <= 30 {
        (network + 1, broadcast - 1)
    } else {
        (network, broadcast)
    };
    Ok((first, last))
}

#[async_trait]
impl DiscoveryPort for HyperDeckDiscovery {
    async fn interfaces(&self) -> Result<Vec<String>> {
        let mut interfaces: Vec<_> = local_interfaces()?
            .into_iter()
            .map(|(name, ip, mask)| {
                let prefix = u32::from(mask).count_ones().max(24);
                let network = Ipv4Addr::from(u32::from(ip) & (u32::MAX << (32 - prefix)));
                format!("{name} ({ip}) {network}/{prefix}")
            })
            .collect();
        interfaces.sort();
        interfaces.dedup();
        Ok(interfaces)
    }

    async fn discover(&self, scope: &str, cancel: &Cancellation) -> Result<Vec<Recorder>> {
        if cancel.is_cancelled() {
            return Err(TransferError::cancelled());
        }
        let (first, last) = scan_range(scope)?;
        let source = local_interfaces()?
            .into_iter()
            .find_map(|(_, ip, mask)| {
                let mask = u32::from(mask);
                let network = u32::from(ip) & mask;
                (first & mask == network && last & mask == network).then_some(ip)
            })
            .ok_or_else(|| TransferError::invalid("scan range is outside the local interfaces"))?;
        let mut candidates = (first..=last)
            .map(Ipv4Addr::from)
            .filter(|ip| *ip != source);
        let mut tasks = JoinSet::new();
        let mut found = Vec::new();
        loop {
            while tasks.len() < SCAN_CONCURRENCY {
                let Some(ip) = candidates.next() else { break };
                let token = cancel.clone();
                let timeout = self.timeout;
                tasks.spawn(async move {
                    probe(
                        SocketAddrV4::new(ip, CONTROL_PORT),
                        Some(source),
                        timeout,
                        &token,
                    )
                    .await
                });
            }
            let completed = tokio::select! {
                biased;
                () = cancel.cancelled() => return Err(TransferError::cancelled()),
                result = tasks.join_next() => result,
            };
            match completed {
                Some(Ok(Ok(identity))) => found.push(identity.recorder),
                Some(_) => {}
                None => break,
            }
        }
        found.sort_by_key(|recorder| recorder.host().parse::<Ipv4Addr>().ok());
        let mut ids = std::collections::HashSet::new();
        found.retain(|recorder| ids.insert(recorder.id()));
        Ok(found)
    }
}
async fn probe(
    endpoint: SocketAddrV4,
    source: Option<Ipv4Addr>,
    timeout: Duration,
    cancel: &Cancellation,
) -> Result<DeckIdentity> {
    bounded(timeout, cancel, Phase::Connecting, async {
        let socket = if let Some(source) = source {
            let socket = TcpSocket::new_v4().map_err(|_| error("HyperDeck socket unavailable"))?;
            socket
                .bind(SocketAddr::V4(SocketAddrV4::new(source, 0)))
                .map_err(|_| error("HyperDeck bind failed"))?;
            socket.connect(endpoint.into()).await
        } else {
            TcpStream::connect(endpoint).await
        }
        .map_err(|_| error("HyperDeck control connection failed"))?;
        let mut socket = BufReader::new(socket);
        socket
            .get_mut()
            .write_all(b"device info\r\n")
            .await
            .map_err(|_| error("HyperDeck query failed"))?;
        let mut in_device_info = false;
        let mut model = None;
        let mut version = None;
        let mut unique = None;
        for _ in 0..64 {
            let bytes = bounded_line(&mut socket)
                .await
                .map_err(|_| error("invalid HyperDeck response"))?;
            let line =
                std::str::from_utf8(&bytes).map_err(|_| error("invalid HyperDeck metadata"))?;
            if line.starts_with("204 ") {
                in_device_info = true;
            } else if in_device_info {
                if line.is_empty() {
                    let model: String = model.ok_or_else(|| error("HyperDeck model missing"))?;
                    if !model.to_ascii_lowercase().contains("hyperdeck") {
                        return Err(error("device is not a HyperDeck"));
                    }
                    let id = identity_id(endpoint, unique.as_deref());
                    let recorder = Recorder::new(id, &model, &endpoint.ip().to_string(), FTP_PORT)?;
                    return Ok(DeckIdentity {
                        recorder,
                        model,
                        protocol_version: version,
                        unique_id: unique,
                    });
                }
                if let Some((key, value)) = line.split_once(':') {
                    let value = value.trim();
                    if value.is_empty() || value.chars().any(char::is_control) {
                        continue;
                    }
                    match key.to_ascii_lowercase().as_str() {
                        "model" => model = Some(value.to_owned()),
                        "protocol version" => version = Some(value.to_owned()),
                        "unique id" => unique = Some(value.to_owned()),
                        _ => {}
                    }
                }
            }
        }
        Err(error("HyperDeck device info reply exceeded limit"))
    })
    .await
}
fn identity_id(endpoint: SocketAddrV4, unique: Option<&str>) -> RecorderId {
    let identity = match unique {
        Some(id) => format!("hmp-hyperdeck-device:{id}"),
        None => format!("hmp-hyperdeck-address:{}", endpoint.ip()),
    };
    let digest = Sha256::digest(identity);
    let mut bytes: [u8; 16] = digest[..16].try_into().expect("SHA-256 prefix");
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    RecorderId::new(Uuid::from_bytes(bytes)).expect("versioned UUID is non-nil")
}
