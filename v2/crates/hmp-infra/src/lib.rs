//! Deterministic simulation adapters. No real FTP or OS-user settings access.
mod sandbox;
mod simulation;
pub use sandbox::{DiskFaults, SandboxDestination};
pub use simulation::{
    Gate, MemorySettings, RecordingSink, SequentialIds, SimFile, SimRemote, StepClock,
};
