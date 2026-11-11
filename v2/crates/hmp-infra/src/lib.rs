//! Read-only network adapters and deterministic simulation support.
mod sandbox;
mod simulation;
pub use sandbox::{DiskFaults, SandboxDestination};
pub use simulation::{
    Gate, MemorySettings, RecordingSink, SequentialIds, SimFile, SimRemote, StepClock,
};

mod discovery;
mod ftp;
pub use discovery::{DeckIdentity, HyperDeckDiscovery};
pub use ftp::{FtpCredentials, FtpRemote};
