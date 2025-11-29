//! Composite Network Behaviour
//!
//! This module implements the composite LibP2P network behaviour combining:
//! - Gossipsub for message propagation
//! - Kademlia for DHT routing
//! - mDNS for local discovery
//! - Identify for peer capability exchange
//! - Ping for liveness checks

use libp2p::{
    gossipsub::{self, MessageAuthenticity, MessageId, TopicHash},
    identify, kad,
    mdns,
    ping,
    swarm::NetworkBehaviour,
    PeerId,
};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use crate::error::Result;
use super::config::VigiliaConfig;

/// Composite network behaviour for Vigilia P2P
#[derive(NetworkBehaviour)]
pub struct VigiliaNetworkBehaviour {
    /// Gossipsub for Byzantine-resistant message propagation
    pub gossipsub: gossipsub::Behaviour,

    /// Kademlia DHT for peer routing and content discovery
    pub kademlia: kad::Behaviour<kad::store::MemoryStore>,

    /// mDNS for automatic local network discovery
    pub mdns: mdns::tokio::Behaviour,

    /// Identify protocol for peer capability exchange
    pub identify: identify::Behaviour,

    /// Ping for liveness checks
    pub ping: ping::Behaviour,
}

impl VigiliaNetworkBehaviour {
    /// Create a new VigiliaNetworkBehaviour
    pub fn new(
        local_peer_id: PeerId,
        config: &VigiliaConfig,
    ) -> Result<Self> {
        // Build Gossipsub behaviour
        let gossipsub = Self::build_gossipsub(local_peer_id, config)?;

        // Build Kademlia behaviour
        let kademlia = Self::build_kademlia(local_peer_id, config)?;

        // Build mDNS behaviour
        let mdns = Self::build_mdns(local_peer_id, config)?;

        // Build Identify behaviour
        let identify = Self::build_identify(local_peer_id, config);

        // Build Ping behaviour
        let ping = ping::Behaviour::new(ping::Config::new());

        Ok(Self {
            gossipsub,
            kademlia,
            mdns,
            identify,
            ping,
        })
    }

    /// Build Gossipsub behaviour with Byzantine resistance
    fn build_gossipsub(
        local_peer_id: PeerId,
        config: &VigiliaConfig,
    ) -> Result<gossipsub::Behaviour> {
        // Build gossipsub config
        let gossipsub_config = config.gossipsub.build_config();

        // Custom message ID function using hash of content
        let message_id_fn = |message: &gossipsub::Message| {
            let mut hasher = DefaultHasher::new();
            message.data.hash(&mut hasher);
            MessageId::from(hasher.finish().to_string())
        };

        // Create gossipsub behaviour with strict validation
        let gossipsub = gossipsub::Behaviour::new(
            MessageAuthenticity::Signed(local_peer_id.into()),
            gossipsub_config,
        )
        .map_err(|e| crate::error::NetworkError::Gossip(e.to_string()))?
        .with_peer_score(
            config.gossipsub.build_peer_score_params(),
            config.gossipsub.build_peer_score_thresholds(),
        )
        .map_err(|e| crate::error::NetworkError::Gossip(e.to_string()))?;

        Ok(gossipsub)
    }

    /// Build Kademlia DHT behaviour
    fn build_kademlia(
        local_peer_id: PeerId,
        config: &VigiliaConfig,
    ) -> Result<kad::Behaviour<kad::store::MemoryStore>> {
        let kademlia_config = config.kademlia.build_config();
        let store = kad::store::MemoryStore::new(local_peer_id);
        let mut kademlia = kad::Behaviour::with_config(
            local_peer_id,
            store,
            kademlia_config,
        );

        // Set Kademlia mode to server (can answer queries)
        kademlia.set_mode(Some(kad::Mode::Server));

        Ok(kademlia)
    }

    /// Build mDNS behaviour for local discovery
    fn build_mdns(
        local_peer_id: PeerId,
        config: &VigiliaConfig,
    ) -> Result<mdns::tokio::Behaviour> {
        let mdns_config = mdns::Config {
            ttl: std::time::Duration::from_secs(60),
            query_interval: std::time::Duration::from_secs(config.mdns.query_interval_secs),
            enable_ipv6: config.mdns.enable_ipv6,
        };

        mdns::tokio::Behaviour::new(mdns_config, local_peer_id)
            .map_err(|e| crate::error::NetworkError::Discovery(e.to_string()))
    }

    /// Build Identify behaviour for peer capability exchange
    fn build_identify(
        local_peer_id: PeerId,
        config: &VigiliaConfig,
    ) -> identify::Behaviour {
        let public_key = local_peer_id.to_bytes().into();
        let identify_config = identify::Config::new(
            "/vigilia/1.0.0".to_string(),
            public_key,
        )
        .with_agent_version(format!("vigilia-agent/{}", config.agent_id));

        identify::Behaviour::new(identify_config)
    }

    /// Subscribe to a Gossipsub topic
    pub fn subscribe(&mut self, topic: &gossipsub::IdentTopic) -> Result<bool> {
        self.gossipsub
            .subscribe(topic)
            .map_err(|e| crate::error::NetworkError::Gossip(e.to_string()))
    }

    /// Unsubscribe from a Gossipsub topic
    pub fn unsubscribe(&mut self, topic: &gossipsub::IdentTopic) -> Result<bool> {
        self.gossipsub
            .unsubscribe(topic)
            .map_err(|e| crate::error::NetworkError::Gossip(e.to_string()))
    }

    /// Publish a message to a Gossipsub topic
    pub fn publish(
        &mut self,
        topic: gossipsub::IdentTopic,
        data: Vec<u8>,
    ) -> Result<MessageId> {
        self.gossipsub
            .publish(topic, data)
            .map_err(|e| crate::error::NetworkError::Gossip(e.to_string()))
    }

    /// Get all subscribed topics
    pub fn topics(&self) -> impl Iterator<Item = &TopicHash> {
        self.gossipsub.topics()
    }

    /// Add a peer address to Kademlia routing table
    pub fn add_address(&mut self, peer_id: &PeerId, addr: libp2p::Multiaddr) {
        self.kademlia.add_address(peer_id, addr);
    }

    /// Bootstrap Kademlia DHT
    pub fn bootstrap(&mut self) -> Result<kad::QueryId> {
        self.kademlia
            .bootstrap()
            .map_err(|e| crate::error::NetworkError::Discovery(e.to_string()))
    }

    /// Get peer score for a specific peer
    pub fn peer_score(&self, peer_id: &PeerId) -> Option<f64> {
        self.gossipsub.peer_score(peer_id)
    }

    /// Get all mesh peers for a topic
    pub fn mesh_peers(&self, topic: &TopicHash) -> Vec<PeerId> {
        self.gossipsub.mesh_peers(topic).cloned().collect()
    }

    /// Get all known peers
    pub fn all_peers(&self) -> Vec<PeerId> {
        self.gossipsub.all_peers().map(|(p, _)| *p).collect()
    }
}

/// Vigilia-specific topics for Gossipsub
pub enum VigiliaTopics {
    /// DAG consensus messages
    Consensus,
    /// Exchange marketplace messages
    Exchange,
    /// MCP agent communication
    Mcp,
    /// Dark domain routing
    DarkDomain,
}

impl VigiliaTopics {
    /// Convert to Gossipsub IdentTopic
    pub fn to_topic(&self) -> gossipsub::IdentTopic {
        let topic_name = match self {
            Self::Consensus => "vigilia/consensus/v1",
            Self::Exchange => "vigilia/exchange/v1",
            Self::Mcp => "vigilia/mcp/v1",
            Self::DarkDomain => "vigilia/dark/v1",
        };
        gossipsub::IdentTopic::new(topic_name)
    }

    /// Get topic hash
    pub fn hash(&self) -> TopicHash {
        self.to_topic().hash()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use libp2p::identity::Keypair;

    #[test]
    fn test_vigilia_topics() {
        let consensus_topic = VigiliaTopics::Consensus.to_topic();
        assert_eq!(consensus_topic.into_string(), "vigilia/consensus/v1");

        let exchange_topic = VigiliaTopics::Exchange.to_topic();
        assert_eq!(exchange_topic.into_string(), "vigilia/exchange/v1");
    }

    #[tokio::test]
    async fn test_behaviour_creation() {
        let keypair = Keypair::generate_ed25519();
        let local_peer_id = PeerId::from(keypair.public());
        let config = VigiliaConfig::new("test-agent".to_string());

        let behaviour = VigiliaNetworkBehaviour::new(local_peer_id, &config);
        assert!(behaviour.is_ok());
    }

    #[tokio::test]
    async fn test_topic_subscription() {
        let keypair = Keypair::generate_ed25519();
        let local_peer_id = PeerId::from(keypair.public());
        let config = VigiliaConfig::new("test-agent".to_string());

        let mut behaviour = VigiliaNetworkBehaviour::new(local_peer_id, &config).unwrap();
        let topic = VigiliaTopics::Consensus.to_topic();

        let subscribed = behaviour.subscribe(&topic);
        assert!(subscribed.is_ok());
        assert!(subscribed.unwrap());
    }

    #[tokio::test]
    async fn test_peer_score() {
        let keypair = Keypair::generate_ed25519();
        let local_peer_id = PeerId::from(keypair.public());
        let config = VigiliaConfig::new("test-agent".to_string());

        let behaviour = VigiliaNetworkBehaviour::new(local_peer_id, &config).unwrap();

        // Score for unknown peer should be None
        let unknown_peer = PeerId::random();
        assert!(behaviour.peer_score(&unknown_peer).is_none());
    }
}
