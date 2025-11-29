//! Network type definitions

use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::time::Duration;
use uuid::Uuid;

/// Unique peer identifier
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PeerId(Uuid);

impl PeerId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        Uuid::from_slice(bytes).ok().map(Self)
    }

    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }
}

impl Default for PeerId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for PeerId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Network configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkConfig {
    /// Local listen address
    pub listen_addr: SocketAddr,

    /// QUIC port for UDP traffic
    pub quic_port: u16,

    /// Bootstrap peer addresses
    pub bootstrap_peers: Vec<String>,

    /// Maximum number of connections
    pub max_connections: usize,

    /// Connection timeout
    pub connection_timeout: Duration,

    /// Keep-alive interval
    pub keep_alive_interval: Duration,

    /// Maximum message size
    pub max_message_size: usize,

    /// Enable NAT traversal
    pub enable_nat_traversal: bool,

    /// STUN servers for NAT traversal
    pub stun_servers: Vec<String>,
}

impl Default for NetworkConfig {
    fn default() -> Self {
        Self {
            listen_addr: "0.0.0.0:9000".parse().unwrap(),
            quic_port: 9001,
            bootstrap_peers: Vec::new(),
            max_connections: 100,
            connection_timeout: Duration::from_secs(30),
            keep_alive_interval: Duration::from_secs(15),
            max_message_size: 10 * 1024 * 1024, // 10 MB
            enable_nat_traversal: true,
            stun_servers: vec![
                "stun:stun.l.google.com:19302".to_string(),
                "stun:stun1.l.google.com:19302".to_string(),
            ],
        }
    }
}

/// Peer information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerInfo {
    pub peer_id: PeerId,
    pub addresses: Vec<SocketAddr>,
    pub public_key: Vec<u8>,
    pub metadata: PeerMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerMetadata {
    pub node_type: String,
    pub version: String,
    pub capabilities: Vec<String>,
    pub reputation: f64,
}

/// Network message types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NetworkMessage {
    /// Handshake with quantum-resistant key exchange
    Handshake {
        peer_id: PeerId,
        public_key: Vec<u8>,
        kem_public_key: Vec<u8>, // ML-KEM-768 public key
    },

    /// Handshake acknowledgment with shared secret
    HandshakeAck {
        peer_id: PeerId,
        kem_ciphertext: Vec<u8>, // ML-KEM-768 encapsulated shared secret
    },

    /// Vertex broadcast
    Vertex {
        data: Vec<u8>,
    },

    /// Consensus message
    Consensus {
        message_type: ConsensusMessageType,
        data: Vec<u8>,
    },

    /// Peer discovery announcement
    PeerAnnouncement {
        peer_info: PeerInfo,
    },

    /// Peer discovery request
    PeerRequest,

    /// Peer discovery response
    PeerResponse {
        peers: Vec<PeerInfo>,
    },

    /// Keep-alive ping
    Ping {
        timestamp: i64,
    },

    /// Ping response
    Pong {
        timestamp: i64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConsensusMessageType {
    PrePrepare,
    Prepare,
    Commit,
    ViewChange,
}

/// Connection statistics
#[derive(Debug, Clone, Default)]
pub struct ConnectionStats {
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub messages_sent: u64,
    pub messages_received: u64,
    pub avg_latency_ms: f64,
    pub last_activity: Option<std::time::Instant>,
}
