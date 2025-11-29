//! LibP2P Integration Module
//!
//! This module implements production-grade LibP2P networking for Vigilia AI,
//! replacing simulated implementations with real Gossipsub, mDNS, Kademlia DHT,
//! and QUIC transport.
//!
//! ## Components
//!
//! - **swarm**: VigiliaSwarm orchestration
//! - **consensus**: LibP2P-based consensus with real Gossipsub
//! - **compat**: Compatibility layer for migration
//! - **quic**: Quantum-resistant QUIC transport (Phase 2)

pub mod compat;
pub mod swarm;
pub mod consensus;
pub mod quic;

// Re-export main types
pub use swarm::{VigiliaSwarm, VigiliaEvent, VigiliaNetworkBehaviour};
pub use consensus::LibP2PConsensusNode;
pub use compat::LibP2PCompat;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_module_structure() {
        // Verify module compiles
        assert!(true);
    }
}
