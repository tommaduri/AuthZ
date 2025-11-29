//! # Vigilia AI Network Module
//!
//! This module implements P2P networking and Dark Domain support for Vigilia AI protocol.
//!
//! ## Features
//!
//! - **P2P Networking**: Built on libp2p for robust peer-to-peer communication
//! - **Dark Domains**: Privacy-preserving network isolation and routing
//! - **QUIC Transport**: Low-latency, encrypted transport via QUIC protocol
//! - **Gossip Protocol**: Efficient message propagation across the network
//! - **NAT Traversal**: Hole punching and relay support for connectivity
//! - **Network Discovery**: DHT-based peer discovery and routing
//!
//! ## Module Structure
//!
//! ```text
//! network/
//! ├── p2p/           - libp2p integration and peer management
//! ├── dark_domain/   - Dark Domain implementation
//! ├── transport/     - Transport layer (QUIC, TCP)
//! ├── gossip/        - Gossip protocol for message propagation
//! ├── discovery/     - Peer discovery mechanisms
//! └── relay/         - Relay and NAT traversal
//! ```

// LibP2P-based implementations (Phase 3 - Production)
// Temporarily disabled due to rustls 0.21 API conflicts - use new QUIC implementation instead
#[cfg(feature = "legacy-libp2p")]
pub mod libp2p;

// Avalanche consensus module (Phase 3)
// TODO Phase 7: Complete when QUIC transport is stable
#[cfg(feature = "experimental-quic")]
pub mod consensus;

// Phase 6: QUIC-based P2P networking
// TODO Phase 7: Complete QUIC implementation with rustls 0.21 APIs
#[cfg(feature = "experimental-quic")]
pub mod quic_transport;
#[cfg(feature = "experimental-quic")]
pub mod nat_traversal;
#[cfg(feature = "experimental-quic")]
pub mod peer_discovery;
#[cfg(feature = "experimental-quic")]
pub mod connection_pool;
#[cfg(feature = "experimental-quic")]
pub mod lru_cache;
#[cfg(feature = "experimental-quic")]
pub mod health_monitor;
#[cfg(feature = "experimental-quic")]
pub mod bandwidth_limiter;
pub mod network_types;

// Existing modules (backward compatibility)
pub mod consensus_p2p;
pub mod dark_domain;
pub mod distributed_dag;
pub mod error;
pub mod exchange_p2p;
#[cfg(feature = "mcp-integration")]
pub mod mcp_p2p;
pub mod p2p;

// Deprecated modules (Phase 3 - kept for migration period)
#[deprecated(
    since = "0.2.0",
    note = "Use libp2p::VigiliaSwarm with Gossipsub instead. See docs/specs/option3-libp2p-integration.md for migration guide."
)]
pub mod gossip;

#[deprecated(
    since = "0.2.0",
    note = "Use libp2p::VigiliaSwarm with Kademlia and mDNS instead. See docs/specs/option3-libp2p-integration.md for migration guide."
)]
pub mod discovery;

#[deprecated(
    since = "0.2.0",
    note = "Use libp2p::VigiliaSwarm with Circuit Relay v2 instead. See docs/specs/option3-libp2p-integration.md for migration guide."
)]
pub mod relay;

#[deprecated(
    since = "0.2.0",
    note = "Hybrid key exchange migrated to libp2p::swarm. Use VigiliaSwarm for quantum-safe transport."
)]
pub mod transport;

// LibP2P exports (Phase 3 - Production)
#[cfg(feature = "legacy-libp2p")]
pub use libp2p::{LibP2PConsensusNode, VigiliaSwarm};

// Consensus exports (Phase 3) - TODO Phase 7: Complete when QUIC transport is stable
#[cfg(feature = "experimental-quic")]
pub use consensus::{
    ConsensusConfig, ConsensusNode, ConsensusMessage, VertexProposal, QueryResponse,
    ConfidenceParams, ConfidenceTracker, FinalityDetector, VertexPropagator, QueryHandler,
};

// Phase 6 QUIC exports (experimental - requires proper rustls 0.21 APIs)
#[cfg(feature = "experimental-quic")]
pub use quic_transport::QuicTransport;
#[cfg(feature = "experimental-quic")]
pub use nat_traversal::{NatTraversal, NatType};
#[cfg(feature = "experimental-quic")]
pub use peer_discovery::PeerDiscovery;
#[cfg(feature = "experimental-quic")]
pub use connection_pool::{ConnectionPool, PoolConfig, PooledConnection, PoolMetrics, ConnectionFactory};
#[cfg(feature = "experimental-quic")]
pub use lru_cache::LRUCache;
#[cfg(feature = "experimental-quic")]
pub use health_monitor::{HealthMonitor, HealthStatus, QualityMetrics};
#[cfg(feature = "experimental-quic")]
pub use bandwidth_limiter::BandwidthLimiter;
pub use network_types::{
    PeerId as QuicPeerId,
    PeerInfo as QuicPeerInfo,
    NetworkMessage,
    ConsensusMessageType,
    ConnectionStats as QuicConnectionStats,
};

// Network configuration for Phase 6 QUIC
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NetworkConfig {
    pub listen_addr: String,
    pub quic_port: u16,
    pub bootstrap_peers: Vec<String>,
    pub max_connections: usize,
    pub connection_timeout_ms: u64,
    pub keep_alive_interval_secs: u64,
    pub max_bandwidth_bps: u64,
    pub enable_nat_traversal: bool,
    pub stun_servers: Vec<String>,
    pub turn_servers: Vec<TurnConfig>,
    pub enable_mdns: bool,
    pub enable_dht: bool,
}

impl Default for NetworkConfig {
    fn default() -> Self {
        Self {
            listen_addr: "0.0.0.0".to_string(),
            quic_port: 9001,
            bootstrap_peers: vec![],
            max_connections: 100,
            connection_timeout_ms: 5000,
            keep_alive_interval_secs: 30,
            max_bandwidth_bps: 100_000_000,
            enable_nat_traversal: true,
            stun_servers: vec![
                "stun.l.google.com:19302".to_string(),
                "stun1.l.google.com:19302".to_string(),
            ],
            turn_servers: vec![],
            enable_mdns: true,
            enable_dht: true,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TurnConfig {
    pub server: String,
    pub username: String,
    pub password: String,
}

// Existing exports (backward compatibility)
pub use consensus_p2p::{ConsensusP2PNode, VertexMessage, ConsensusQuery, ConsensusResponse};
pub use distributed_dag::{DistributedDagNode, DistributedDagConfig, VertexConsensusState};
pub use error::{NetworkError, Result};
pub use exchange_p2p::{
    ExchangeMessage, ExchangeP2PConfig, ExchangeP2PNode, ExchangeP2PStats,
    OrderRequestMessage, OrderUpdateMessage, ReputationUpdateMessage, ResourceListingMessage,
};
#[cfg(feature = "mcp-integration")]
pub use mcp_p2p::{
    AgentAnnouncement, AgentHeartbeat, McpMessage, McpP2PConfig, McpP2PNode, McpP2PStats,
    RemoteAgent, ToolCallRequest, ToolCallResponse,
};

// Deprecated exports (kept for migration period - allow deprecated warnings)
#[allow(deprecated)]
pub use discovery::Discovery;
#[allow(deprecated)]
pub use gossip::{GossipConfig, GossipProtocol, Message, MessageId, TopicHash};
#[allow(deprecated)]
pub use relay::{RelayClient, RelayConfig};
#[allow(deprecated)]
pub use transport::TransportConfig;

// Re-export from crypto for backward compatibility
pub use cretoai_crypto::hybrid::encryption::HybridKeyExchange;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_module_import() {
        assert!(true);
    }
}
