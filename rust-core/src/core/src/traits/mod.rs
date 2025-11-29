//! Shared traits for the CretoAI platform

pub mod transport;
pub mod consensus;
pub mod security;

// Re-export commonly used traits
pub use transport::Transport;
pub use consensus::ConsensusProtocol;
pub use security::SignatureVerifier;
