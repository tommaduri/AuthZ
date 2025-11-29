//! P2P networking implementation using LibP2P
//!
//! This module provides the core peer-to-peer networking layer for Vigilia AI,
//! including peer management, connection handling, and network behavior coordination.

use crate::error::Result;
use std::collections::HashMap;
use std::time::{Duration, SystemTime};

/// P2P node configuration
#[derive(Debug, Clone)]
pub struct P2PConfig {
    /// Addresses to listen on
    pub listen_addresses: Vec<String>,

    /// Maximum number of peers to maintain
    pub max_peers: usize,

    /// Connection timeout duration
    pub connection_timeout: Duration,

    /// Enable mDNS for local peer discovery
    pub enable_mdns: bool,

    /// Enable relay support for NAT traversal
    pub enable_relay: bool,

    /// Kad configuration
    pub kad_config: KadConfig,

    /// Gossipsub configuration
    pub gossip_config: GossipConfig,
}

impl Default for P2PConfig {
    fn default() -> Self {
        Self {
            listen_addresses: vec![
                "/ip4/0.0.0.0/tcp/0".to_string(),
                "/ip4/0.0.0.0/udp/0/quic-v1".to_string(),
            ],
            max_peers: 100,
            connection_timeout: Duration::from_secs(30),
            enable_mdns: true,
            enable_relay: true,
            kad_config: KadConfig::default(),
            gossip_config: GossipConfig::default(),
        }
    }
}

/// Kademlia DHT configuration
#[derive(Debug, Clone)]
pub struct KadConfig {
    /// Protocol name for Kademlia
    pub protocol_name: String,

    /// Replication factor (k-value)
    pub replication_factor: usize,

    /// Query timeout
    pub query_timeout: Duration,
}

impl Default for KadConfig {
    fn default() -> Self {
        Self {
            protocol_name: "/vigilia/kad/1.0.0".to_string(),
            replication_factor: 20,
            query_timeout: Duration::from_secs(60),
        }
    }
}

/// Gossipsub configuration
#[derive(Debug, Clone)]
pub struct GossipConfig {
    /// Heartbeat interval
    pub heartbeat_interval: Duration,

    /// Mesh network size
    pub mesh_n: usize,

    /// Low watermark for mesh
    pub mesh_n_low: usize,

    /// High watermark for mesh
    pub mesh_n_high: usize,

    /// History length
    pub history_length: usize,

    /// History gossip
    pub history_gossip: usize,
}

impl Default for GossipConfig {
    fn default() -> Self {
        Self {
            heartbeat_interval: Duration::from_secs(1),
            mesh_n: 6,
            mesh_n_low: 4,
            mesh_n_high: 12,
            history_length: 5,
            history_gossip: 3,
        }
    }
}

/// Peer metadata
#[derive(Debug, Clone)]
pub struct PeerInfo {
    /// Peer ID
    pub peer_id: String,

    /// Known addresses
    pub addresses: Vec<String>,

    /// Last seen timestamp
    pub last_seen: SystemTime,

    /// Reputation score (0.0 to 1.0)
    pub reputation: f64,

    /// Agent ID (if known)
    pub agent_id: Option<String>,

    /// Protocol versions supported
    pub protocols: Vec<String>,
}

impl PeerInfo {
    /// Create new peer info
    pub fn new(peer_id: String) -> Self {
        Self {
            peer_id,
            addresses: Vec::new(),
            last_seen: SystemTime::now(),
            reputation: 0.5, // Start with neutral reputation
            agent_id: None,
            protocols: Vec::new(),
        }
    }

    /// Update last seen timestamp
    pub fn touch(&mut self) {
        self.last_seen = SystemTime::now();
    }

    /// Add an address
    pub fn add_address(&mut self, addr: String) {
        if !self.addresses.contains(&addr) {
            self.addresses.push(addr);
        }
    }

    /// Adjust reputation (clamped to 0.0-1.0)
    pub fn adjust_reputation(&mut self, delta: f64) {
        self.reputation = (self.reputation + delta).clamp(0.0, 1.0);
    }
}

/// Main P2P node
pub struct P2PNode {
    /// Local peer ID
    local_peer_id: String,

    /// Node configuration
    config: P2PConfig,

    /// Tracked peers
    peers: HashMap<String, PeerInfo>,

    /// Bootstrap nodes
    bootstrap_nodes: Vec<String>,
}

impl P2PNode {
    /// Create a new P2P node with default configuration
    pub fn new() -> Result<Self> {
        Self::with_config(P2PConfig::default())
    }

    /// Create a new P2P node with custom configuration
    pub fn with_config(config: P2PConfig) -> Result<Self> {
        // Generate a simple peer ID for now
        let local_peer_id = format!("peer-{}", uuid::Uuid::new_v4());

        tracing::info!("Creating P2P node with peer ID: {}", local_peer_id);

        Ok(Self {
            local_peer_id,
            config,
            peers: HashMap::new(),
            bootstrap_nodes: Vec::new(),
        })
    }

    /// Get the local peer ID
    pub fn local_peer_id(&self) -> &str {
        &self.local_peer_id
    }

    /// Add a bootstrap node
    pub fn add_bootstrap_node(&mut self, addr: String) -> Result<()> {
        tracing::info!("Adding bootstrap node: {}", addr);
        self.bootstrap_nodes.push(addr);
        Ok(())
    }

    /// Get peer info
    pub fn get_peer_info(&self, peer_id: &str) -> Option<&PeerInfo> {
        self.peers.get(peer_id)
    }

    /// Get all tracked peers
    pub fn all_peers(&self) -> Vec<&PeerInfo> {
        self.peers.values().collect()
    }

    /// Add a peer
    pub fn add_peer(&mut self, peer_info: PeerInfo) {
        self.peers.insert(peer_info.peer_id.clone(), peer_info);
    }

    /// Remove a peer
    pub fn remove_peer(&mut self, peer_id: &str) -> Option<PeerInfo> {
        self.peers.remove(peer_id)
    }

    /// Get configuration
    pub fn config(&self) -> &P2PConfig {
        &self.config
    }
}

impl Default for P2PNode {
    fn default() -> Self {
        Self::new().expect("Failed to create default P2PNode")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_p2p_config_default() {
        let config = P2PConfig::default();
        assert_eq!(config.max_peers, 100);
        assert!(config.enable_mdns);
        assert!(config.enable_relay);
    }

    #[test]
    fn test_peer_info_creation() {
        let peer_id = "test-peer-123".to_string();
        let peer_info = PeerInfo::new(peer_id.clone());

        assert_eq!(peer_info.peer_id, peer_id);
        assert_eq!(peer_info.reputation, 0.5);
        assert!(peer_info.addresses.is_empty());
    }

    #[test]
    fn test_peer_info_reputation() {
        let mut peer_info = PeerInfo::new("test-peer".to_string());

        peer_info.adjust_reputation(0.3);
        assert_eq!(peer_info.reputation, 0.8);

        peer_info.adjust_reputation(0.5);
        assert_eq!(peer_info.reputation, 1.0); // Clamped to 1.0

        peer_info.adjust_reputation(-2.0);
        assert_eq!(peer_info.reputation, 0.0); // Clamped to 0.0
    }

    #[test]
    fn test_p2p_node_creation() {
        let node = P2PNode::new();
        assert!(node.is_ok());
    }

    #[test]
    fn test_p2p_node_with_config() {
        let mut config = P2PConfig::default();
        config.max_peers = 50;

        let node = P2PNode::with_config(config.clone());
        assert!(node.is_ok());

        let node = node.unwrap();
        assert_eq!(node.config.max_peers, 50);
    }

    #[test]
    fn test_peer_management() {
        let mut node = P2PNode::new().unwrap();

        let peer_info = PeerInfo::new("peer-1".to_string());
        node.add_peer(peer_info.clone());

        assert_eq!(node.all_peers().len(), 1);
        assert!(node.get_peer_info("peer-1").is_some());

        node.remove_peer("peer-1");
        assert_eq!(node.all_peers().len(), 0);
    }

    #[test]
    fn test_bootstrap_nodes() {
        let mut node = P2PNode::new().unwrap();

        assert!(node.add_bootstrap_node("/ip4/127.0.0.1/tcp/4001".to_string()).is_ok());
        assert_eq!(node.bootstrap_nodes.len(), 1);
    }
}
