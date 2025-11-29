//! LibP2P Configuration
//!
//! This module provides configuration structures for all LibP2P components.

use libp2p::gossipsub::{
    GossipsubConfigBuilder, MessageAuthenticity, PeerScoreParams, PeerScoreThresholds,
    TopicScoreParams, ValidationMode,
};
use libp2p::kad::{KademliaConfig, store::MemoryStore};
use libp2p::swarm::ConnectionLimits;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

/// Main Vigilia LibP2P configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VigiliaConfig {
    /// Gossipsub configuration
    pub gossipsub: GossipsubParams,

    /// Kademlia DHT configuration
    pub kademlia: KademliaParams,

    /// mDNS configuration
    pub mdns: MdnsParams,

    /// Connection limits
    pub connection_limits: ConnectionLimitParams,

    /// Agent identifier
    pub agent_id: String,
}

impl VigiliaConfig {
    /// Create a new default configuration
    pub fn new(agent_id: String) -> Self {
        Self {
            gossipsub: GossipsubParams::default(),
            kademlia: KademliaParams::default(),
            mdns: MdnsParams::default(),
            connection_limits: ConnectionLimitParams::default(),
            agent_id,
        }
    }

    /// Builder pattern for configuration
    pub fn builder(agent_id: String) -> VigiliaConfigBuilder {
        VigiliaConfigBuilder {
            config: Self::new(agent_id),
        }
    }
}

impl Default for VigiliaConfig {
    fn default() -> Self {
        Self::new("vigilia-agent".to_string())
    }
}

/// Builder for VigiliaConfig
pub struct VigiliaConfigBuilder {
    config: VigiliaConfig,
}

impl VigiliaConfigBuilder {
    pub fn gossipsub(mut self, params: GossipsubParams) -> Self {
        self.config.gossipsub = params;
        self
    }

    pub fn kademlia(mut self, params: KademliaParams) -> Self {
        self.config.kademlia = params;
        self
    }

    pub fn mdns(mut self, params: MdnsParams) -> Self {
        self.config.mdns = params;
        self
    }

    pub fn connection_limits(mut self, limits: ConnectionLimitParams) -> Self {
        self.config.connection_limits = limits;
        self
    }

    pub fn build(self) -> VigiliaConfig {
        self.config
    }
}

/// Gossipsub configuration parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GossipsubParams {
    /// Target mesh size (D parameter)
    pub mesh_n: usize,

    /// Low watermark for mesh maintenance
    pub mesh_n_low: usize,

    /// High watermark for mesh maintenance
    pub mesh_n_high: usize,

    /// Minimum outbound connections
    pub mesh_outbound_min: usize,

    /// Message history window
    pub history_length: usize,

    /// Gossip history rounds
    pub history_gossip: usize,

    /// Heartbeat interval in seconds
    pub heartbeat_interval_secs: u64,

    /// Enable flood publishing
    pub flood_publish: bool,

    /// Duplicate cache time in seconds
    pub duplicate_cache_time_secs: u64,

    /// Validation mode
    pub validation_mode: ValidationModeWrapper,
}

impl Default for GossipsubParams {
    fn default() -> Self {
        Self {
            mesh_n: 6,
            mesh_n_low: 4,
            mesh_n_high: 12,
            mesh_outbound_min: 2,
            history_length: 5,
            history_gossip: 3,
            heartbeat_interval_secs: 1,
            flood_publish: false,
            duplicate_cache_time_secs: 120,
            validation_mode: ValidationModeWrapper::Strict,
        }
    }
}

impl GossipsubParams {
    /// Build libp2p GossipsubConfig from parameters
    pub fn build_config(&self) -> libp2p::gossipsub::GossipsubConfig {
        GossipsubConfigBuilder::default()
            .mesh_n(self.mesh_n)
            .mesh_n_low(self.mesh_n_low)
            .mesh_n_high(self.mesh_n_high)
            .mesh_outbound_min(self.mesh_outbound_min)
            .history_length(self.history_length)
            .history_gossip(self.history_gossip)
            .heartbeat_interval(Duration::from_secs(self.heartbeat_interval_secs))
            .flood_publish(self.flood_publish)
            .duplicate_cache_time(Duration::from_secs(self.duplicate_cache_time_secs))
            .validation_mode(self.validation_mode.into())
            .build()
            .expect("valid gossipsub config")
    }

    /// Build peer scoring parameters for Byzantine resistance
    pub fn build_peer_score_params(&self) -> PeerScoreParams {
        let mut topics = HashMap::new();

        // Consensus topic scoring (critical - high penalties for invalid messages)
        topics.insert(
            libp2p::gossipsub::IdentTopic::new("vigilia/consensus/v1").hash(),
            TopicScoreParams {
                topic_weight: 1.0,
                time_in_mesh_weight: 0.01,
                time_in_mesh_quantum: Duration::from_secs(1),
                time_in_mesh_cap: 3600.0,
                first_message_deliveries_weight: 0.5,
                first_message_deliveries_decay: 0.99,
                first_message_deliveries_cap: 100.0,
                mesh_message_deliveries_weight: -1.0,
                mesh_message_deliveries_decay: 0.97,
                mesh_message_deliveries_cap: 100.0,
                mesh_message_deliveries_threshold: 10.0,
                mesh_message_deliveries_window: Duration::from_secs(5),
                mesh_message_deliveries_activation: Duration::from_secs(10),
                mesh_failure_penalty_weight: -1.0,
                mesh_failure_penalty_decay: 0.95,
                invalid_message_deliveries_weight: -10.0,
                invalid_message_deliveries_decay: 0.99,
            },
        );

        PeerScoreParams {
            topics,
            app_specific_weight: 1.0,
            ip_colocation_factor_weight: -5.0,
            ip_colocation_factor_threshold: 3.0,
            behaviour_penalty_weight: -10.0,
            behaviour_penalty_decay: 0.99,
            ..Default::default()
        }
    }

    /// Build peer score thresholds
    pub fn build_peer_score_thresholds(&self) -> PeerScoreThresholds {
        PeerScoreThresholds {
            gossip_threshold: -100.0,
            publish_threshold: -500.0,
            graylist_threshold: -1000.0,
            accept_px_threshold: 50.0,
            opportunistic_graft_threshold: 5.0,
        }
    }
}

/// Wrapper for ValidationMode to support Serialize/Deserialize
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum ValidationModeWrapper {
    Strict,
    Permissive,
    Anonymous,
    None,
}

impl From<ValidationModeWrapper> for ValidationMode {
    fn from(wrapper: ValidationModeWrapper) -> Self {
        match wrapper {
            ValidationModeWrapper::Strict => ValidationMode::Strict,
            ValidationModeWrapper::Permissive => ValidationMode::Permissive,
            ValidationModeWrapper::Anonymous => ValidationMode::Anonymous,
            ValidationModeWrapper::None => ValidationMode::None,
        }
    }
}

/// Kademlia DHT configuration parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KademliaParams {
    /// K-bucket size (k parameter)
    pub k_value: usize,

    /// Replication factor
    pub replication_factor: usize,

    /// Query timeout in seconds
    pub query_timeout_secs: u64,

    /// Enable automatic bootstrapping
    pub auto_bootstrap: bool,
}

impl Default for KademliaParams {
    fn default() -> Self {
        Self {
            k_value: 20,
            replication_factor: 20,
            query_timeout_secs: 60,
            auto_bootstrap: true,
        }
    }
}

impl KademliaParams {
    /// Build libp2p KademliaConfig from parameters
    pub fn build_config(&self) -> KademliaConfig {
        let mut config = KademliaConfig::default();
        config.set_query_timeout(Duration::from_secs(self.query_timeout_secs));
        config.set_replication_factor(
            std::num::NonZeroUsize::new(self.replication_factor)
                .expect("replication factor must be non-zero"),
        );
        config
    }
}

/// mDNS configuration parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MdnsParams {
    /// Service name for mDNS discovery
    pub service_name: String,

    /// Query interval in seconds
    pub query_interval_secs: u64,

    /// Enable IPv6
    pub enable_ipv6: bool,
}

impl Default for MdnsParams {
    fn default() -> Self {
        Self {
            service_name: "vigilia-p2p".to_string(),
            query_interval_secs: 5,
            enable_ipv6: true,
        }
    }
}

/// Connection limit parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionLimitParams {
    /// Maximum total connections
    pub max_connections: u32,

    /// Maximum connections per peer
    pub max_connections_per_peer: u32,

    /// Maximum pending incoming connections
    pub max_pending_incoming: u32,

    /// Maximum pending outgoing connections
    pub max_pending_outgoing: u32,

    /// Maximum established incoming connections
    pub max_established_incoming: u32,

    /// Maximum established outgoing connections
    pub max_established_outgoing: Option<u32>,
}

impl Default for ConnectionLimitParams {
    fn default() -> Self {
        Self {
            max_connections: 100,
            max_connections_per_peer: 1,
            max_pending_incoming: 10,
            max_pending_outgoing: 20,
            max_established_incoming: 50,
            max_established_outgoing: Some(50),
        }
    }
}

impl From<ConnectionLimitParams> for ConnectionLimits {
    fn from(params: ConnectionLimitParams) -> Self {
        ConnectionLimits::default()
            .with_max_pending_incoming(Some(params.max_pending_incoming))
            .with_max_pending_outgoing(Some(params.max_pending_outgoing))
            .with_max_established_incoming(Some(params.max_established_incoming))
            .with_max_established_outgoing(params.max_established_outgoing)
            .with_max_established_per_peer(Some(params.max_connections_per_peer))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = VigiliaConfig::default();
        assert_eq!(config.gossipsub.mesh_n, 6);
        assert_eq!(config.kademlia.k_value, 20);
        assert_eq!(config.mdns.service_name, "vigilia-p2p");
    }

    #[test]
    fn test_config_builder() {
        let config = VigiliaConfig::builder("test-agent".to_string())
            .gossipsub(GossipsubParams {
                mesh_n: 8,
                ..Default::default()
            })
            .build();

        assert_eq!(config.agent_id, "test-agent");
        assert_eq!(config.gossipsub.mesh_n, 8);
    }

    #[test]
    fn test_gossipsub_config_build() {
        let params = GossipsubParams::default();
        let config = params.build_config();
        // Verify config builds successfully
        assert!(true);
    }

    #[test]
    fn test_peer_score_params() {
        let params = GossipsubParams::default();
        let score_params = params.build_peer_score_params();

        // Verify consensus topic is configured
        assert!(!score_params.topics.is_empty());
    }

    #[test]
    fn test_connection_limits() {
        let params = ConnectionLimitParams::default();
        let limits: ConnectionLimits = params.into();
        // Verify limits build successfully
        assert!(true);
    }
}
