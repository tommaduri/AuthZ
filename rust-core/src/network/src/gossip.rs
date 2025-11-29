//! Gossip protocol implementation for efficient message propagation
//!
//! **DEPRECATED**: This simulated gossip protocol is deprecated in favor of real LibP2P Gossipsub.
//! Use `libp2p::VigiliaSwarm` instead for production networking.
//!
//! Migration guide: See `docs/specs/option3-libp2p-integration.md`
//!
//! This module provides a gossip-based publish-subscribe protocol for broadcasting
//! messages across the network with efficient mesh-based topology and flood control.

use crate::error::{NetworkError, Result};
use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{Duration, SystemTime};

/// Gossip protocol configuration
#[derive(Debug, Clone)]
pub struct GossipConfig {
    /// Heartbeat interval for mesh maintenance
    pub heartbeat_interval: Duration,

    /// Target mesh network size (D parameter)
    pub mesh_n: usize,

    /// Low watermark for mesh size
    pub mesh_n_low: usize,

    /// High watermark for mesh size
    pub mesh_n_high: usize,

    /// History length for message caching
    pub history_length: usize,

    /// Number of peers to gossip history to
    pub history_gossip: usize,

    /// Fanout size for non-mesh peers
    pub fanout: usize,

    /// Time to live for fanout peers
    pub fanout_ttl: Duration,

    /// Maximum number of IHAVEs to accept
    pub max_ihave_length: usize,

    /// Maximum number of IWANTs to send
    pub max_iwant_message_ids: usize,
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
            fanout: 6,
            fanout_ttl: Duration::from_secs(60),
            max_ihave_length: 1000,
            max_iwant_message_ids: 1000,
        }
    }
}

/// Topic identifier
pub type TopicHash = String;

/// Message identifier
pub type MessageId = String;

/// Gossip message
#[derive(Debug, Clone)]
pub struct Message {
    /// Unique message identifier
    pub id: MessageId,

    /// Topic this message belongs to
    pub topic: TopicHash,

    /// Message payload
    pub data: Vec<u8>,

    /// Sender peer ID
    pub sender: String,

    /// Message signature (from vigilia-crypto)
    pub signature: Vec<u8>,

    /// Timestamp when message was created
    pub timestamp: SystemTime,

    /// Sequence number for ordering
    pub sequence: u64,
}

impl Message {
    /// Create a new message
    pub fn new(
        id: MessageId,
        topic: TopicHash,
        data: Vec<u8>,
        sender: String,
        signature: Vec<u8>,
        sequence: u64,
    ) -> Self {
        Self {
            id,
            topic,
            data,
            sender,
            signature,
            timestamp: SystemTime::now(),
            sequence,
        }
    }

    /// Calculate message size
    pub fn size(&self) -> usize {
        self.id.len() + self.topic.len() + self.data.len() + self.signature.len() + 32
    }

    /// Check if message is expired
    pub fn is_expired(&self, ttl: Duration) -> bool {
        SystemTime::now()
            .duration_since(self.timestamp)
            .unwrap_or(Duration::from_secs(0))
            >= ttl
    }
}

/// Topic subscription state
#[derive(Debug, Clone)]
pub struct Topic {
    /// Topic hash/name
    pub hash: TopicHash,

    /// Peers in the mesh for this topic
    pub mesh: HashSet<String>,

    /// Fanout peers for this topic
    pub fanout: HashSet<String>,

    /// Last time fanout was used
    pub last_fanout: Option<SystemTime>,
}

impl Topic {
    /// Create a new topic
    pub fn new(hash: TopicHash) -> Self {
        Self {
            hash,
            mesh: HashSet::new(),
            fanout: HashSet::new(),
            last_fanout: None,
        }
    }

    /// Add peer to mesh
    pub fn add_to_mesh(&mut self, peer_id: String) -> bool {
        self.mesh.insert(peer_id)
    }

    /// Remove peer from mesh
    pub fn remove_from_mesh(&mut self, peer_id: &str) -> bool {
        self.mesh.remove(peer_id)
    }

    /// Check if peer is in mesh
    pub fn is_in_mesh(&self, peer_id: &str) -> bool {
        self.mesh.contains(peer_id)
    }

    /// Get mesh size
    pub fn mesh_size(&self) -> usize {
        self.mesh.len()
    }
}

/// Message cache for deduplication and history
#[derive(Debug)]
pub struct MessageCache {
    /// Cached messages by ID
    messages: HashMap<MessageId, Message>,

    /// Message IDs in chronological order
    message_order: VecDeque<MessageId>,

    /// Maximum cache size
    max_size: usize,

    /// Time-to-live for cached messages
    ttl: Duration,
}

impl MessageCache {
    /// Create a new message cache
    pub fn new(max_size: usize, ttl: Duration) -> Self {
        Self {
            messages: HashMap::new(),
            message_order: VecDeque::with_capacity(max_size),
            max_size,
            ttl,
        }
    }

    /// Add a message to the cache
    pub fn insert(&mut self, message: Message) -> bool {
        let message_id = message.id.clone();

        // Check if already cached
        if self.messages.contains_key(&message_id) {
            return false;
        }

        // Evict oldest if at capacity
        if self.messages.len() >= self.max_size {
            if let Some(oldest_id) = self.message_order.pop_front() {
                self.messages.remove(&oldest_id);
            }
        }

        self.messages.insert(message_id.clone(), message);
        self.message_order.push_back(message_id);
        true
    }

    /// Get a message from cache
    pub fn get(&self, message_id: &MessageId) -> Option<&Message> {
        self.messages.get(message_id)
    }

    /// Check if message exists in cache
    pub fn contains(&self, message_id: &MessageId) -> bool {
        self.messages.contains_key(message_id)
    }

    /// Remove expired messages
    pub fn cleanup_expired(&mut self) -> usize {
        let mut removed = 0;
        let ttl = self.ttl;

        self.message_order.retain(|id| {
            if let Some(msg) = self.messages.get(id) {
                if msg.is_expired(ttl) {
                    self.messages.remove(id);
                    removed += 1;
                    false
                } else {
                    true
                }
            } else {
                false
            }
        });

        removed
    }

    /// Get recent message IDs for gossip
    pub fn recent_message_ids(&self, count: usize) -> Vec<MessageId> {
        self.message_order
            .iter()
            .rev()
            .take(count)
            .cloned()
            .collect()
    }

    /// Get cache size
    pub fn len(&self) -> usize {
        self.messages.len()
    }

    /// Check if cache is empty
    pub fn is_empty(&self) -> bool {
        self.messages.is_empty()
    }
}

/// Peer metadata for gossip
#[derive(Debug, Clone)]
pub struct GossipPeer {
    /// Peer ID
    pub peer_id: String,

    /// Topics this peer is subscribed to
    pub topics: HashSet<TopicHash>,

    /// Last heartbeat time
    pub last_heartbeat: SystemTime,

    /// Score for peer scoring
    pub score: f64,
}

impl GossipPeer {
    /// Create a new gossip peer
    pub fn new(peer_id: String) -> Self {
        Self {
            peer_id,
            topics: HashSet::new(),
            last_heartbeat: SystemTime::now(),
            score: 0.0,
        }
    }

    /// Add topic subscription
    pub fn subscribe(&mut self, topic: TopicHash) {
        self.topics.insert(topic);
    }

    /// Remove topic subscription
    pub fn unsubscribe(&mut self, topic: &TopicHash) {
        self.topics.remove(topic);
    }

    /// Check if subscribed to topic
    pub fn is_subscribed(&self, topic: &TopicHash) -> bool {
        self.topics.contains(topic)
    }

    /// Update heartbeat
    pub fn heartbeat(&mut self) {
        self.last_heartbeat = SystemTime::now();
    }
}

/// Main gossip protocol handler
pub struct GossipProtocol {
    /// Local peer ID
    local_peer_id: String,

    /// Configuration
    config: GossipConfig,

    /// Active topics
    topics: HashMap<TopicHash, Topic>,

    /// Known peers
    peers: HashMap<String, GossipPeer>,

    /// Message cache for deduplication
    message_cache: MessageCache,

    /// Sequence number for messages
    next_sequence: u64,
}

impl GossipProtocol {
    /// Create a new gossip protocol instance
    pub fn new(local_peer_id: String) -> Self {
        Self::with_config(local_peer_id, GossipConfig::default())
    }

    /// Create with custom configuration
    pub fn with_config(local_peer_id: String, config: GossipConfig) -> Self {
        let message_cache = MessageCache::new(
            config.history_length * 100, // Cache more than history
            Duration::from_secs(120),     // 2 minutes TTL
        );

        Self {
            local_peer_id,
            config,
            topics: HashMap::new(),
            peers: HashMap::new(),
            message_cache,
            next_sequence: 0,
        }
    }

    /// Get local peer ID
    pub fn local_peer_id(&self) -> &str {
        &self.local_peer_id
    }

    /// Get configuration
    pub fn config(&self) -> &GossipConfig {
        &self.config
    }

    /// Subscribe to a topic
    pub fn subscribe(&mut self, topic_hash: TopicHash) -> Result<()> {
        if !self.topics.contains_key(&topic_hash) {
            tracing::info!("Subscribing to topic: {}", topic_hash);
            self.topics.insert(topic_hash.clone(), Topic::new(topic_hash));
        }
        Ok(())
    }

    /// Unsubscribe from a topic
    pub fn unsubscribe(&mut self, topic_hash: &TopicHash) -> Result<()> {
        if self.topics.remove(topic_hash).is_some() {
            tracing::info!("Unsubscribed from topic: {}", topic_hash);
            Ok(())
        } else {
            Err(NetworkError::Gossip(format!(
                "Not subscribed to topic: {}",
                topic_hash
            )))
        }
    }

    /// Check if subscribed to a topic
    pub fn is_subscribed(&self, topic_hash: &TopicHash) -> bool {
        self.topics.contains_key(topic_hash)
    }

    /// Get all subscribed topics
    pub fn subscribed_topics(&self) -> Vec<&TopicHash> {
        self.topics.keys().collect()
    }

    /// Publish a message to a topic
    pub fn publish(
        &mut self,
        topic_hash: TopicHash,
        data: Vec<u8>,
        signature: Vec<u8>,
    ) -> Result<MessageId> {
        if !self.is_subscribed(&topic_hash) {
            return Err(NetworkError::Gossip(format!(
                "Not subscribed to topic: {}",
                topic_hash
            )));
        }

        let message_id = format!("msg-{}", uuid::Uuid::new_v4());
        let sequence = self.next_sequence;
        self.next_sequence += 1;

        let message = Message::new(
            message_id.clone(),
            topic_hash,
            data,
            self.local_peer_id.clone(),
            signature,
            sequence,
        );

        self.message_cache.insert(message);

        tracing::debug!("Published message: {}", message_id);
        Ok(message_id)
    }

    /// Handle received message
    pub fn handle_message(&mut self, message: Message) -> Result<bool> {
        // Check if already seen
        if self.message_cache.contains(&message.id) {
            return Ok(false); // Duplicate
        }

        // Validate topic subscription
        if !self.is_subscribed(&message.topic) {
            return Err(NetworkError::Gossip(format!(
                "Not subscribed to topic: {}",
                message.topic
            )));
        }

        // Add to cache
        self.message_cache.insert(message);

        Ok(true) // New message
    }

    /// Add a peer
    pub fn add_peer(&mut self, peer_id: String) {
        if !self.peers.contains_key(&peer_id) {
            self.peers.insert(peer_id.clone(), GossipPeer::new(peer_id));
        }
    }

    /// Remove a peer
    pub fn remove_peer(&mut self, peer_id: &str) -> Option<GossipPeer> {
        // Remove from all topic meshes
        for topic in self.topics.values_mut() {
            topic.remove_from_mesh(peer_id);
        }

        self.peers.remove(peer_id)
    }

    /// Update peer subscription
    pub fn update_peer_subscription(
        &mut self,
        peer_id: &str,
        topic_hash: TopicHash,
        subscribe: bool,
    ) -> Result<()> {
        let peer = self
            .peers
            .get_mut(peer_id)
            .ok_or_else(|| NetworkError::Gossip(format!("Unknown peer: {}", peer_id)))?;

        if subscribe {
            peer.subscribe(topic_hash);
        } else {
            peer.unsubscribe(&topic_hash);
        }

        Ok(())
    }

    /// Add peer to topic mesh
    pub fn add_to_mesh(&mut self, topic_hash: &TopicHash, peer_id: String) -> Result<()> {
        let topic = self
            .topics
            .get_mut(topic_hash)
            .ok_or_else(|| NetworkError::Gossip(format!("Unknown topic: {}", topic_hash)))?;

        topic.add_to_mesh(peer_id);
        Ok(())
    }

    /// Remove peer from topic mesh
    pub fn remove_from_mesh(&mut self, topic_hash: &TopicHash, peer_id: &str) -> Result<()> {
        let topic = self
            .topics
            .get_mut(topic_hash)
            .ok_or_else(|| NetworkError::Gossip(format!("Unknown topic: {}", topic_hash)))?;

        topic.remove_from_mesh(peer_id);
        Ok(())
    }

    /// Get mesh peers for a topic
    pub fn mesh_peers(&self, topic_hash: &TopicHash) -> Vec<String> {
        self.topics
            .get(topic_hash)
            .map(|t| t.mesh.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Get all peers
    pub fn all_peers(&self) -> Vec<&GossipPeer> {
        self.peers.values().collect()
    }

    /// Get peer count
    pub fn peer_count(&self) -> usize {
        self.peers.len()
    }

    /// Get message from cache
    pub fn get_message(&self, message_id: &MessageId) -> Option<&Message> {
        self.message_cache.get(message_id)
    }

    /// Cleanup expired messages
    pub fn cleanup_expired_messages(&mut self) -> usize {
        self.message_cache.cleanup_expired()
    }

    /// Get recent message IDs for gossip
    pub fn recent_message_ids(&self, count: usize) -> Vec<MessageId> {
        self.message_cache.recent_message_ids(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gossip_config_default() {
        let config = GossipConfig::default();
        assert_eq!(config.heartbeat_interval, Duration::from_secs(1));
        assert_eq!(config.mesh_n, 6);
        assert_eq!(config.mesh_n_low, 4);
        assert_eq!(config.mesh_n_high, 12);
        assert_eq!(config.history_length, 5);
    }

    #[test]
    fn test_message_creation() {
        let msg = Message::new(
            "msg-1".to_string(),
            "topic-1".to_string(),
            vec![1, 2, 3],
            "peer-1".to_string(),
            vec![4, 5, 6],
            1,
        );

        assert_eq!(msg.id, "msg-1");
        assert_eq!(msg.topic, "topic-1");
        assert_eq!(msg.data, vec![1, 2, 3]);
        assert_eq!(msg.sequence, 1);
    }

    #[test]
    fn test_topic_creation() {
        let mut topic = Topic::new("test-topic".to_string());
        assert_eq!(topic.hash, "test-topic");
        assert_eq!(topic.mesh_size(), 0);

        topic.add_to_mesh("peer-1".to_string());
        assert_eq!(topic.mesh_size(), 1);
        assert!(topic.is_in_mesh("peer-1"));

        topic.remove_from_mesh("peer-1");
        assert_eq!(topic.mesh_size(), 0);
    }

    #[test]
    fn test_message_cache() {
        let mut cache = MessageCache::new(3, Duration::from_secs(60));

        let msg1 = Message::new(
            "msg-1".to_string(),
            "topic".to_string(),
            vec![],
            "peer".to_string(),
            vec![],
            1,
        );

        assert!(cache.insert(msg1.clone()));
        assert!(!cache.insert(msg1)); // Duplicate
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn test_message_cache_eviction() {
        let mut cache = MessageCache::new(2, Duration::from_secs(60));

        let msg1 = Message::new("msg-1".to_string(), "t".to_string(), vec![], "p".to_string(), vec![], 1);
        let msg2 = Message::new("msg-2".to_string(), "t".to_string(), vec![], "p".to_string(), vec![], 2);
        let msg3 = Message::new("msg-3".to_string(), "t".to_string(), vec![], "p".to_string(), vec![], 3);

        cache.insert(msg1);
        cache.insert(msg2);
        assert_eq!(cache.len(), 2);

        cache.insert(msg3);
        assert_eq!(cache.len(), 2); // Should evict msg-1
        assert!(!cache.contains(&"msg-1".to_string()));
        assert!(cache.contains(&"msg-2".to_string()));
        assert!(cache.contains(&"msg-3".to_string()));
    }

    #[test]
    fn test_gossip_peer() {
        let mut peer = GossipPeer::new("peer-1".to_string());
        assert_eq!(peer.peer_id, "peer-1");

        peer.subscribe("topic-1".to_string());
        assert!(peer.is_subscribed(&"topic-1".to_string()));

        peer.unsubscribe(&"topic-1".to_string());
        assert!(!peer.is_subscribed(&"topic-1".to_string()));
    }

    #[test]
    fn test_gossip_protocol_creation() {
        let gossip = GossipProtocol::new("local-peer".to_string());
        assert_eq!(gossip.local_peer_id(), "local-peer");
        assert_eq!(gossip.peer_count(), 0);
    }

    #[test]
    fn test_topic_subscription() {
        let mut gossip = GossipProtocol::new("local-peer".to_string());

        assert!(gossip.subscribe("topic-1".to_string()).is_ok());
        assert!(gossip.is_subscribed(&"topic-1".to_string()));

        let topics = gossip.subscribed_topics();
        assert_eq!(topics.len(), 1);

        assert!(gossip.unsubscribe(&"topic-1".to_string()).is_ok());
        assert!(!gossip.is_subscribed(&"topic-1".to_string()));
    }

    #[test]
    fn test_publish_message() {
        let mut gossip = GossipProtocol::new("local-peer".to_string());
        gossip.subscribe("topic-1".to_string()).unwrap();

        let msg_id = gossip
            .publish("topic-1".to_string(), vec![1, 2, 3], vec![])
            .unwrap();

        assert!(!msg_id.is_empty());
        assert!(gossip.get_message(&msg_id).is_some());
    }

    #[test]
    fn test_handle_message_duplicate() {
        let mut gossip = GossipProtocol::new("local-peer".to_string());
        gossip.subscribe("topic-1".to_string()).unwrap();

        let msg = Message::new(
            "msg-1".to_string(),
            "topic-1".to_string(),
            vec![],
            "peer-1".to_string(),
            vec![],
            1,
        );

        assert!(gossip.handle_message(msg.clone()).unwrap()); // New
        assert!(!gossip.handle_message(msg).unwrap()); // Duplicate
    }

    #[test]
    fn test_peer_management() {
        let mut gossip = GossipProtocol::new("local-peer".to_string());

        gossip.add_peer("peer-1".to_string());
        assert_eq!(gossip.peer_count(), 1);

        gossip.remove_peer("peer-1");
        assert_eq!(gossip.peer_count(), 0);
    }

    #[test]
    fn test_mesh_management() {
        let mut gossip = GossipProtocol::new("local-peer".to_string());
        gossip.subscribe("topic-1".to_string()).unwrap();
        gossip.add_peer("peer-1".to_string());

        gossip
            .add_to_mesh(&"topic-1".to_string(), "peer-1".to_string())
            .unwrap();

        let mesh_peers = gossip.mesh_peers(&"topic-1".to_string());
        assert_eq!(mesh_peers.len(), 1);
        assert_eq!(mesh_peers[0], "peer-1");

        gossip
            .remove_from_mesh(&"topic-1".to_string(), "peer-1")
            .unwrap();

        let mesh_peers = gossip.mesh_peers(&"topic-1".to_string());
        assert_eq!(mesh_peers.len(), 0);
    }

    #[test]
    fn test_recent_message_ids() {
        let mut gossip = GossipProtocol::new("local-peer".to_string());
        gossip.subscribe("topic-1".to_string()).unwrap();

        gossip.publish("topic-1".to_string(), vec![1], vec![]).unwrap();
        gossip.publish("topic-1".to_string(), vec![2], vec![]).unwrap();
        gossip.publish("topic-1".to_string(), vec![3], vec![]).unwrap();

        let recent = gossip.recent_message_ids(2);
        assert_eq!(recent.len(), 2);
    }
}
