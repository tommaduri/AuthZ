//! CretoAI Consensus Node Library
//!
//! This crate provides the main consensus node implementation that integrates
//! all subsystems: BFT consensus, QUIC networking, RocksDB storage, and
//! quantum-resistant cryptography.

pub mod config;
pub mod node;

pub use config::NodeConfig;
pub use node::ConsensusNode;
