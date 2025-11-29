//! Exchange P2P Integration
//!
//! Integrates the resource marketplace with the P2P network for distributed
//! resource trading, order matching, and reputation tracking.
//!
//! ## Architecture
//!
//! ```text
//! ┌──────────────────────────────────────────────────────────────┐
//! │                   ExchangeP2PNode                            │
//! ├──────────────────────────────────────────────────────────────┤
//! │                                                              │
//! │  ┌────────────┐    ┌───────────┐    ┌──────────────────┐  │
//! │  │ Marketplace│◄───┤  Gossip   │◄───┤  Distributed     │  │
//! │  │            │    │  Protocol │    │  Consensus       │  │
//! │  └────────────┘    └───────────┘    └──────────────────┘  │
//! │       │                  │                    │             │
//! │       │                  │                    │             │
//! │       ▼                  ▼                    ▼             │
//! │  ┌────────────────────────────────────────────────┐        │
//! │  │         Operations:                            │        │
//! │  │  • Broadcast listings → Network → Discovery   │        │
//! │  │  • Create order → Consensus → Execute         │        │
//! │  │  • Update reputation → Propagate → Sync       │        │
//! │  └────────────────────────────────────────────────┘        │
//! └──────────────────────────────────────────────────────────────┘
//! ```

use crate::consensus_p2p::VertexMessage;
use crate::distributed_dag::{DistributedDagNode, DistributedDagConfig};
use crate::error::{NetworkError, Result};
use crate::gossip::GossipProtocol;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tokio::sync::mpsc;
use tracing::{info, warn};
use uuid::Uuid;
use cretoai_crypto::signatures::{MLDSA87, MLDSA87KeyPair};

/// P2P message types for exchange operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ExchangeMessage {
    /// Resource listing broadcast
    ListingBroadcast(ResourceListingMessage),
    /// Order creation request
    OrderRequest(OrderRequestMessage),
    /// Order status update
    OrderUpdate(OrderUpdateMessage),
    /// Reputation update
    ReputationUpdate(ReputationUpdateMessage),
}

/// Resource listing message for P2P propagation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceListingMessage {
    pub listing_id: String,
    pub provider_id: String,
    pub resource_type: String,
    pub quantity: f64,
    pub price_per_unit: f64,
    pub min_quantity: f64,
    pub reputation: f64,
    pub created_at: i64,
    pub expires_at: i64,
    pub metadata: HashMap<String, String>,
    pub signature: Vec<u8>,
}

/// Order request message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderRequestMessage {
    pub order_id: String,
    pub listing_id: String,
    pub buyer_id: String,
    pub quantity: f64,
    pub total_price: f64,
    pub timestamp: i64,
    pub signature: Vec<u8>,
}

/// Order update message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderUpdateMessage {
    pub order_id: String,
    pub status: String,
    pub timestamp: i64,
    pub signature: Vec<u8>,
}

/// Reputation update message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReputationUpdateMessage {
    pub agent_id: String,
    pub transaction_success: Option<bool>,
    pub review_rating: Option<f64>,
    pub timestamp: i64,
    pub signature: Vec<u8>,
}

impl ExchangeMessage {
    /// Serialize message to bytes
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        bincode::serialize(self).map_err(|e| NetworkError::Serialization(e.to_string()))
    }

    /// Deserialize message from bytes
    pub fn from_bytes(data: &[u8]) -> Result<Self> {
        bincode::deserialize(data).map_err(|e| NetworkError::Serialization(e.to_string()))
    }
}

/// Topic names for exchange operations
pub const LISTING_TOPIC: &str = "vigilia.exchange.listings";
pub const ORDER_TOPIC: &str = "vigilia.exchange.orders";
pub const REPUTATION_TOPIC: &str = "vigilia.exchange.reputation";

/// Exchange P2P Node configuration
#[derive(Debug, Clone)]
pub struct ExchangeP2PConfig {
    /// Agent ID for this node
    pub agent_id: String,
    /// Enable distributed consensus for orders
    pub enable_consensus: bool,
    /// Minimum network size for order consensus
    pub min_network_size: usize,
    /// Consensus sample size
    pub consensus_sample_size: usize,
    /// Order timeout in seconds
    pub order_timeout: u64,
}

impl Default for ExchangeP2PConfig {
    fn default() -> Self {
        Self {
            agent_id: Uuid::new_v4().to_string(),
            enable_consensus: true,
            min_network_size: 5,
            consensus_sample_size: 4,
            order_timeout: 300, // 5 minutes
        }
    }
}

/// Exchange P2P Node - Distributed marketplace with network integration
pub struct ExchangeP2PNode {
    /// Configuration
    config: ExchangeP2PConfig,

    /// P2P consensus node for distributed order matching
    consensus_node: Option<Arc<DistributedDagNode>>,

    /// Gossip protocol for message propagation
    gossip: Arc<RwLock<GossipProtocol>>,

    /// Local listing cache (listing_id -> ResourceListingMessage)
    local_listings: Arc<RwLock<HashMap<String, ResourceListingMessage>>>,

    /// Order tracking (order_id -> OrderRequestMessage)
    active_orders: Arc<RwLock<HashMap<String, OrderRequestMessage>>>,

    /// Reputation cache (agent_id -> reputation_score)
    reputation_cache: Arc<RwLock<HashMap<String, f64>>>,

    /// Message receiver (for future P2P message handling)
    #[allow(dead_code)]
    message_rx: Arc<tokio::sync::Mutex<mpsc::UnboundedReceiver<(String, Vec<u8>)>>>,

    /// Message sender (for future P2P message handling)
    #[allow(dead_code)]
    message_tx: mpsc::UnboundedSender<(String, Vec<u8>)>,

    /// Agent keypair for signing messages
    keypair: Arc<MLDSA87KeyPair>,
}

impl ExchangeP2PNode {
    /// Create a new exchange P2P node
    pub fn new(config: ExchangeP2PConfig) -> Self {
        let (message_tx, message_rx) = mpsc::unbounded_channel();
        let gossip = Arc::new(RwLock::new(GossipProtocol::new(config.agent_id.clone())));

        // Subscribe to exchange topics
        {
            let mut g = gossip.write().unwrap();
            let _ = g.subscribe(LISTING_TOPIC.to_string());
            let _ = g.subscribe(ORDER_TOPIC.to_string());
            let _ = g.subscribe(REPUTATION_TOPIC.to_string());
        }

        // Initialize consensus node if enabled
        let consensus_node = if config.enable_consensus {
            let dag_config = DistributedDagConfig {
                agent_id: config.agent_id.clone(),
                min_network_size: config.min_network_size,
                sample_size: config.consensus_sample_size,
                alpha_threshold: (config.consensus_sample_size * 3) / 4, // 75%
                beta_threshold: 5,
                finalization_threshold: 0.8,
                max_rounds: 100,
                query_timeout: std::time::Duration::from_secs(config.order_timeout),
                cleanup_interval: std::time::Duration::from_secs(60),
            };
            Some(Arc::new(DistributedDagNode::new(dag_config)))
        } else {
            None
        };

        // Generate ML-DSA keypair for this node
        let keypair = Arc::new(MLDSA87::generate());

        Self {
            config,
            consensus_node,
            gossip,
            local_listings: Arc::new(RwLock::new(HashMap::new())),
            active_orders: Arc::new(RwLock::new(HashMap::new())),
            reputation_cache: Arc::new(RwLock::new(HashMap::new())),
            message_rx: Arc::new(tokio::sync::Mutex::new(message_rx)),
            message_tx,
            keypair,
        }
    }

    /// Get agent ID
    pub fn agent_id(&self) -> &str {
        &self.config.agent_id
    }

    /// Add a peer to the network
    pub fn add_peer(&self, peer_id: String) {
        self.gossip.write().unwrap().add_peer(peer_id.clone());
        if let Some(ref consensus) = self.consensus_node {
            consensus.add_peer(peer_id);
        }
    }

    /// Remove a peer
    pub fn remove_peer(&self, peer_id: &str) {
        self.gossip.write().unwrap().remove_peer(peer_id);
        if let Some(ref consensus) = self.consensus_node {
            consensus.remove_peer(peer_id);
        }
    }

    /// Get peer count
    pub fn peer_count(&self) -> usize {
        self.gossip.read().unwrap().peer_count()
    }

    /// Broadcast a resource listing to the network
    pub fn broadcast_listing(&self, listing: ResourceListingMessage) -> Result<String> {
        let listing_id = listing.listing_id.clone();

        // Store in local cache
        {
            let mut listings = self.local_listings.write().unwrap();
            listings.insert(listing_id.clone(), listing.clone());
        }

        // Broadcast to network
        let msg = ExchangeMessage::ListingBroadcast(listing);
        let data = msg.to_bytes()?;

        // Sign with ML-DSA
        let signature_obj = self.keypair.sign(&data);
        let signature = signature_obj.as_bytes().to_vec();

        let mut gossip = self.gossip.write().unwrap();
        gossip
            .publish(LISTING_TOPIC.to_string(), data, signature)
            .map_err(|e| NetworkError::Gossip(e.to_string()))?;

        info!("Broadcast listing: {}", listing_id);
        Ok(listing_id)
    }

    /// Create an order with distributed consensus
    pub async fn create_order(&self, order: OrderRequestMessage) -> Result<String> {
        let order_id = order.order_id.clone();

        // Store in active orders
        {
            let mut orders = self.active_orders.write().unwrap();
            orders.insert(order_id.clone(), order.clone());
        }

        // If consensus is enabled, create a vertex and run consensus
        if let Some(ref consensus) = self.consensus_node {
            // Create vertex for order
            let vertex = VertexMessage {
                vertex_id: format!("order-{}", order_id),
                parents: vec![],
                payload: bincode::serialize(&order)
                    .map_err(|e| NetworkError::Serialization(e.to_string()))?,
                timestamp: order.timestamp as u64,
                creator: self.config.agent_id.clone(),
                signature: order.signature.clone(),
                hash: [0u8; 32], // TODO: Compute hash
            };

            // Add vertex and broadcast
            consensus.add_vertex(vertex).await?;

            // Run consensus
            let finalized = consensus
                .run_consensus(&format!("order-{}", order_id))
                .await?;

            if finalized {
                info!("Order {} finalized through consensus", order_id);
            } else {
                warn!("Order {} consensus timeout", order_id);
                return Err(NetworkError::Consensus("Consensus timeout".to_string()));
            }
        } else {
            // Broadcast order without consensus
            let msg = ExchangeMessage::OrderRequest(order);
            let data = msg.to_bytes()?;

            let mut gossip = self.gossip.write().unwrap();
            gossip
                .publish(ORDER_TOPIC.to_string(), data, vec![])
                .map_err(|e| NetworkError::Gossip(e.to_string()))?;
        }

        info!("Created order: {}", order_id);
        Ok(order_id)
    }

    /// Update order status
    pub fn update_order_status(&self, update: OrderUpdateMessage) -> Result<()> {
        let msg = ExchangeMessage::OrderUpdate(update.clone());
        let data = msg.to_bytes()?;

        let mut gossip = self.gossip.write().unwrap();
        gossip
            .publish(ORDER_TOPIC.to_string(), data, update.signature.clone())
            .map_err(|e| NetworkError::Gossip(e.to_string()))?;

        info!("Updated order status: {}", update.order_id);
        Ok(())
    }

    /// Broadcast reputation update
    pub fn update_reputation(&self, update: ReputationUpdateMessage) -> Result<()> {
        // Update local cache
        {
            let mut cache = self.reputation_cache.write().unwrap();
            // For now, just track presence
            cache.insert(update.agent_id.clone(), 0.5);
        }

        let msg = ExchangeMessage::ReputationUpdate(update.clone());
        let data = msg.to_bytes()?;

        let mut gossip = self.gossip.write().unwrap();
        gossip
            .publish(REPUTATION_TOPIC.to_string(), data, update.signature.clone())
            .map_err(|e| NetworkError::Gossip(e.to_string()))?;

        info!("Updated reputation for agent: {}", update.agent_id);
        Ok(())
    }

    /// Get all cached listings
    pub fn get_cached_listings(&self) -> Vec<ResourceListingMessage> {
        let listings = self.local_listings.read().unwrap();
        listings.values().cloned().collect()
    }

    /// Search listings by resource type
    pub fn search_listings(&self, resource_type: &str) -> Vec<ResourceListingMessage> {
        let listings = self.local_listings.read().unwrap();
        listings
            .values()
            .filter(|l| l.resource_type == resource_type)
            .cloned()
            .collect()
    }

    /// Get cached reputation for an agent
    pub fn get_reputation(&self, agent_id: &str) -> Option<f64> {
        let cache = self.reputation_cache.read().unwrap();
        cache.get(agent_id).copied()
    }

    /// Get statistics
    pub fn get_stats(&self) -> ExchangeP2PStats {
        let listings = self.local_listings.read().unwrap();
        let orders = self.active_orders.read().unwrap();
        let reputation = self.reputation_cache.read().unwrap();

        ExchangeP2PStats {
            peer_count: self.peer_count(),
            cached_listings: listings.len(),
            active_orders: orders.len(),
            tracked_agents: reputation.len(),
        }
    }
}

/// Exchange P2P statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExchangeP2PStats {
    pub peer_count: usize,
    pub cached_listings: usize,
    pub active_orders: usize,
    pub tracked_agents: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_exchange_p2p_node_creation() {
        let config = ExchangeP2PConfig::default();
        let node = ExchangeP2PNode::new(config);

        assert_eq!(node.peer_count(), 0);
        assert_eq!(node.get_cached_listings().len(), 0);
    }

    #[test]
    fn test_peer_management() {
        let config = ExchangeP2PConfig::default();
        let node = ExchangeP2PNode::new(config);

        node.add_peer("peer-1".to_string());
        node.add_peer("peer-2".to_string());
        assert_eq!(node.peer_count(), 2);

        node.remove_peer("peer-1");
        assert_eq!(node.peer_count(), 1);
    }

    #[test]
    fn test_listing_broadcast() {
        let config = ExchangeP2PConfig::default();
        let node = ExchangeP2PNode::new(config);

        let listing = ResourceListingMessage {
            listing_id: "listing-001".to_string(),
            provider_id: "provider-001".to_string(),
            resource_type: "compute".to_string(),
            quantity: 100.0,
            price_per_unit: 10.0,
            min_quantity: 1.0,
            reputation: 0.8,
            created_at: chrono::Utc::now().timestamp(),
            expires_at: chrono::Utc::now().timestamp() + 86400,
            metadata: HashMap::new(),
            signature: vec![],
        };

        let listing_id = node.broadcast_listing(listing).unwrap();
        assert_eq!(listing_id, "listing-001");

        let cached = node.get_cached_listings();
        assert_eq!(cached.len(), 1);
        assert_eq!(cached[0].listing_id, "listing-001");
    }

    #[test]
    fn test_search_listings() {
        let config = ExchangeP2PConfig::default();
        let node = ExchangeP2PNode::new(config);

        // Add compute listing
        let listing1 = ResourceListingMessage {
            listing_id: "listing-001".to_string(),
            provider_id: "provider-001".to_string(),
            resource_type: "compute".to_string(),
            quantity: 100.0,
            price_per_unit: 10.0,
            min_quantity: 1.0,
            reputation: 0.8,
            created_at: chrono::Utc::now().timestamp(),
            expires_at: chrono::Utc::now().timestamp() + 86400,
            metadata: HashMap::new(),
            signature: vec![],
        };

        // Add storage listing
        let listing2 = ResourceListingMessage {
            listing_id: "listing-002".to_string(),
            provider_id: "provider-002".to_string(),
            resource_type: "storage".to_string(),
            quantity: 500.0,
            price_per_unit: 0.5,
            min_quantity: 1.0,
            reputation: 0.7,
            created_at: chrono::Utc::now().timestamp(),
            expires_at: chrono::Utc::now().timestamp() + 86400,
            metadata: HashMap::new(),
            signature: vec![],
        };

        node.broadcast_listing(listing1).unwrap();
        node.broadcast_listing(listing2).unwrap();

        let compute_listings = node.search_listings("compute");
        assert_eq!(compute_listings.len(), 1);
        assert_eq!(compute_listings[0].listing_id, "listing-001");

        let storage_listings = node.search_listings("storage");
        assert_eq!(storage_listings.len(), 1);
        assert_eq!(storage_listings[0].listing_id, "listing-002");
    }

    #[test]
    fn test_reputation_update() {
        let config = ExchangeP2PConfig::default();
        let node = ExchangeP2PNode::new(config);

        let update = ReputationUpdateMessage {
            agent_id: "agent-001".to_string(),
            transaction_success: Some(true),
            review_rating: None,
            timestamp: chrono::Utc::now().timestamp(),
            signature: vec![],
        };

        node.update_reputation(update).unwrap();

        assert!(node.get_reputation("agent-001").is_some());
    }

    #[test]
    fn test_stats() {
        let config = ExchangeP2PConfig::default();
        let node = ExchangeP2PNode::new(config);

        node.add_peer("peer-1".to_string());

        let listing = ResourceListingMessage {
            listing_id: "listing-001".to_string(),
            provider_id: "provider-001".to_string(),
            resource_type: "compute".to_string(),
            quantity: 100.0,
            price_per_unit: 10.0,
            min_quantity: 1.0,
            reputation: 0.8,
            created_at: chrono::Utc::now().timestamp(),
            expires_at: chrono::Utc::now().timestamp() + 86400,
            metadata: HashMap::new(),
            signature: vec![],
        };

        node.broadcast_listing(listing).unwrap();

        let stats = node.get_stats();
        assert_eq!(stats.peer_count, 1);
        assert_eq!(stats.cached_listings, 1);
    }

    #[test]
    fn test_message_serialization() {
        let listing = ResourceListingMessage {
            listing_id: "listing-001".to_string(),
            provider_id: "provider-001".to_string(),
            resource_type: "compute".to_string(),
            quantity: 100.0,
            price_per_unit: 10.0,
            min_quantity: 1.0,
            reputation: 0.8,
            created_at: 1234567890,
            expires_at: 1234654290,
            metadata: HashMap::new(),
            signature: vec![],
        };

        let msg = ExchangeMessage::ListingBroadcast(listing);
        let bytes = msg.to_bytes().unwrap();
        let deserialized = ExchangeMessage::from_bytes(&bytes).unwrap();

        match deserialized {
            ExchangeMessage::ListingBroadcast(l) => {
                assert_eq!(l.listing_id, "listing-001");
                assert_eq!(l.resource_type, "compute");
            }
            _ => panic!("Wrong message type"),
        }
    }
}
