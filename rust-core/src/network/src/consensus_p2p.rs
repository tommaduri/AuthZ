//! Network-integrated consensus for distributed DAG vertex propagation
//!
//! This module bridges the LibP2P gossip protocol with the DAG consensus engine,
//! enabling distributed Byzantine fault-tolerant consensus across a P2P network.
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                   ConsensusP2PNode                          │
//! ├─────────────────────────────────────────────────────────────┤
//! │                                                             │
//! │  ┌──────────────┐         ┌───────────────────┐           │
//! │  │   Gossip     │◄────────►   Consensus       │           │
//! │  │  Protocol    │         │    Engine         │           │
//! │  └──────┬───────┘         └────────┬──────────┘           │
//! │         │                          │                       │
//! │         │ publish vertex           │ query network         │
//! │         ▼                          ▼                       │
//! │  ┌────────────────────────────────────┐                   │
//! │  │       Network Propagation          │                   │
//! │  │  • Vertex broadcast                │                   │
//! │  │  • Consensus queries                │                   │
//! │  │  • Response aggregation            │                   │
//! │  └────────────────────────────────────┘                   │
//! └─────────────────────────────────────────────────────────────┘
//!              │                    │                    │
//!              ▼                    ▼                    ▼
//!         [Peer 1]             [Peer 2]             [Peer 3]
//! ```

use crate::error::{NetworkError, Result};
use crate::gossip::{GossipProtocol, Message, TopicHash, MessageId};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tokio::sync::mpsc;
use tracing::{debug, info};
use cretoai_crypto::signatures::{MLDSA87, MLDSA87KeyPair};

/// Topic for DAG vertex propagation
pub const VERTEX_TOPIC: &str = "vigilia/dag/vertices";

/// Topic for consensus queries
pub const CONSENSUS_QUERY_TOPIC: &str = "vigilia/dag/consensus/query";

/// Topic for consensus responses
pub const CONSENSUS_RESPONSE_TOPIC: &str = "vigilia/dag/consensus/response";

/// DAG vertex message for network propagation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VertexMessage {
    /// Vertex ID
    pub vertex_id: String,

    /// Parent vertex IDs
    pub parents: Vec<String>,

    /// Transaction payload
    pub payload: Vec<u8>,

    /// Timestamp
    pub timestamp: u64,

    /// Creator agent ID
    pub creator: String,

    /// Quantum-resistant signature (ML-DSA)
    pub signature: Vec<u8>,

    /// Vertex hash (BLAKE3)
    pub hash: [u8; 32],
}

/// Consensus query message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsensusQuery {
    /// Query ID for response matching
    pub query_id: String,

    /// Vertex ID being queried
    pub vertex_id: String,

    /// Requester peer ID
    pub requester: String,

    /// Query timestamp
    pub timestamp: u64,
}

/// Consensus response message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsensusResponse {
    /// Query ID this responds to
    pub query_id: String,

    /// Vertex ID
    pub vertex_id: String,

    /// Responder peer ID
    pub responder: String,

    /// Vote: true = accept, false = reject
    pub vote: bool,

    /// Confidence score (0.0 - 1.0)
    pub confidence: f64,

    /// Response timestamp
    pub timestamp: u64,

    /// Response signature
    pub signature: Vec<u8>,
}

/// P2P message types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum P2PMessage {
    /// New vertex broadcast
    Vertex(VertexMessage),

    /// Consensus query
    Query(ConsensusQuery),

    /// Consensus response
    Response(ConsensusResponse),
}

impl P2PMessage {
    /// Serialize to bytes
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        bincode::serialize(self)
            .map_err(|e| NetworkError::Serialization(e.to_string()))
    }

    /// Deserialize from bytes
    pub fn from_bytes(data: &[u8]) -> Result<Self> {
        bincode::deserialize(data)
            .map_err(|e| NetworkError::Serialization(e.to_string()))
    }
}

/// Pending consensus query tracker
#[derive(Debug)]
struct PendingQuery {
    /// Query details
    #[allow(dead_code)]
    pub query: ConsensusQuery,

    /// Received responses
    pub responses: Vec<ConsensusResponse>,

    /// Expected number of responses
    pub expected_count: usize,

    /// Creation timestamp
    pub created_at: std::time::SystemTime,
}

/// Network-integrated consensus node
pub struct ConsensusP2PNode {
    /// Gossip protocol instance
    gossip: Arc<RwLock<GossipProtocol>>,

    /// Pending consensus queries
    pending_queries: Arc<RwLock<HashMap<String, PendingQuery>>>,

    /// Received vertex cache (deduplication)
    vertex_cache: Arc<RwLock<HashMap<String, VertexMessage>>>,

    /// Message receiver channel (for future LibP2P integration)
    #[allow(dead_code)]
    message_rx: Arc<tokio::sync::Mutex<mpsc::UnboundedReceiver<(TopicHash, Message)>>>,

    /// Message sender channel (for future LibP2P integration)
    #[allow(dead_code)]
    message_tx: mpsc::UnboundedSender<(TopicHash, Message)>,

    /// Agent ID
    agent_id: String,

    /// Agent keypair for signing messages
    keypair: Arc<MLDSA87KeyPair>,
}

impl ConsensusP2PNode {
    /// Create a new consensus P2P node
    pub fn new(agent_id: String) -> Self {
        let gossip = Arc::new(RwLock::new(GossipProtocol::new(agent_id.clone())));
        let (message_tx, message_rx) = mpsc::unbounded_channel();

        // Subscribe to consensus topics
        {
            let mut g = gossip.write().unwrap();
            g.subscribe(VERTEX_TOPIC.to_string()).ok();
            g.subscribe(CONSENSUS_QUERY_TOPIC.to_string()).ok();
            g.subscribe(CONSENSUS_RESPONSE_TOPIC.to_string()).ok();
        }

        // Generate ML-DSA keypair for this node
        let keypair = Arc::new(MLDSA87::generate());

        Self {
            gossip,
            pending_queries: Arc::new(RwLock::new(HashMap::new())),
            vertex_cache: Arc::new(RwLock::new(HashMap::new())),
            message_rx: Arc::new(tokio::sync::Mutex::new(message_rx)),
            message_tx,
            agent_id,
            keypair,
        }
    }

    /// Get agent ID
    pub fn agent_id(&self) -> &str {
        &self.agent_id
    }

    /// Add a peer to the network
    pub fn add_peer(&self, peer_id: String) {
        let mut gossip = self.gossip.write().unwrap();
        gossip.add_peer(peer_id.clone());

        // Add peer to all consensus topics
        gossip.add_to_mesh(&VERTEX_TOPIC.to_string(), peer_id.clone()).ok();
        gossip.add_to_mesh(&CONSENSUS_QUERY_TOPIC.to_string(), peer_id.clone()).ok();
        gossip.add_to_mesh(&CONSENSUS_RESPONSE_TOPIC.to_string(), peer_id).ok();
    }

    /// Remove a peer from the network
    pub fn remove_peer(&self, peer_id: &str) {
        let mut gossip = self.gossip.write().unwrap();
        gossip.remove_peer(peer_id);
    }

    /// Get peer count
    pub fn peer_count(&self) -> usize {
        self.gossip.read().unwrap().peer_count()
    }

    /// Broadcast a vertex to the network
    pub fn broadcast_vertex(&self, vertex: VertexMessage) -> Result<MessageId> {
        // Cache the vertex
        {
            let mut cache = self.vertex_cache.write().unwrap();
            cache.insert(vertex.vertex_id.clone(), vertex.clone());
        }

        // Serialize and publish
        let p2p_msg = P2PMessage::Vertex(vertex.clone());
        let data = p2p_msg.to_bytes()?;

        // Sign with ML-DSA
        let signature_obj = self.keypair.sign(&data);
        let signature = signature_obj.as_bytes().to_vec();

        let mut gossip = self.gossip.write().unwrap();
        let msg_id = gossip.publish(
            VERTEX_TOPIC.to_string(),
            data,
            signature,
        )?;

        info!("Broadcast vertex {} (msg_id: {})", vertex.vertex_id, msg_id);
        Ok(msg_id)
    }

    /// Send a consensus query to the network
    pub fn send_consensus_query(
        &self,
        vertex_id: String,
        sample_size: usize,
    ) -> Result<String> {
        let query_id = uuid::Uuid::new_v4().to_string();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let query = ConsensusQuery {
            query_id: query_id.clone(),
            vertex_id,
            requester: self.agent_id.clone(),
            timestamp,
        };

        // Register pending query
        {
            let mut pending = self.pending_queries.write().unwrap();
            pending.insert(
                query_id.clone(),
                PendingQuery {
                    query: query.clone(),
                    responses: Vec::new(),
                    expected_count: sample_size,
                    created_at: std::time::SystemTime::now(),
                },
            );
        }

        // Serialize and publish
        let p2p_msg = P2PMessage::Query(query);
        let data = p2p_msg.to_bytes()?;

        // Sign with ML-DSA
        let signature_obj = self.keypair.sign(&data);
        let signature = signature_obj.as_bytes().to_vec();

        let mut gossip = self.gossip.write().unwrap();
        gossip.publish(
            CONSENSUS_QUERY_TOPIC.to_string(),
            data,
            signature,
        )?;

        debug!("Sent consensus query {}", query_id);
        Ok(query_id)
    }

    /// Send a consensus response
    pub fn send_consensus_response(&self, response: ConsensusResponse) -> Result<()> {
        let p2p_msg = P2PMessage::Response(response.clone());
        let data = p2p_msg.to_bytes()?;

        // Sign with ML-DSA
        let signature_obj = self.keypair.sign(&data);
        let signature = signature_obj.as_bytes().to_vec();

        let mut gossip = self.gossip.write().unwrap();
        gossip.publish(
            CONSENSUS_RESPONSE_TOPIC.to_string(),
            data,
            signature,
        )?;

        debug!("Sent consensus response for query {}", response.query_id);
        Ok(())
    }

    /// Handle received message
    pub fn handle_message(&self, _topic: &TopicHash, message: &Message) -> Result<()> {
        // Deserialize P2P message
        let p2p_msg = P2PMessage::from_bytes(&message.data)?;

        match p2p_msg {
            P2PMessage::Vertex(vertex) => {
                self.handle_vertex_message(vertex)?;
            }
            P2PMessage::Query(query) => {
                self.handle_consensus_query(query)?;
            }
            P2PMessage::Response(response) => {
                self.handle_consensus_response(response)?;
            }
        }

        Ok(())
    }

    /// Handle received vertex message
    fn handle_vertex_message(&self, vertex: VertexMessage) -> Result<()> {
        // Check if already cached
        {
            let cache = self.vertex_cache.read().unwrap();
            if cache.contains_key(&vertex.vertex_id) {
                debug!("Vertex {} already cached, ignoring", vertex.vertex_id);
                return Ok(());
            }
        }

        info!("Received new vertex: {}", vertex.vertex_id);

        // Cache the vertex
        {
            let mut cache = self.vertex_cache.write().unwrap();
            cache.insert(vertex.vertex_id.clone(), vertex);
        }

        // TODO: Add to local DAG and initiate consensus
        Ok(())
    }

    /// Handle consensus query
    fn handle_consensus_query(&self, query: ConsensusQuery) -> Result<()> {
        // Don't respond to our own queries
        if query.requester == self.agent_id {
            return Ok(());
        }

        debug!("Received consensus query {} for vertex {}", query.query_id, query.vertex_id);

        // Check if we have the vertex
        let vertex = {
            let cache = self.vertex_cache.read().unwrap();
            cache.get(&query.vertex_id).cloned()
        };

        if vertex.is_none() {
            debug!("Don't have vertex {}, skipping query", query.vertex_id);
            return Ok(());
        }

        // TODO: Calculate actual vote based on vertex validity and parent chain
        let vote = true; // Placeholder
        let confidence = 0.9; // Placeholder

        // Create response data without signature first
        let mut response = ConsensusResponse {
            query_id: query.query_id,
            vertex_id: query.vertex_id,
            responder: self.agent_id.clone(),
            vote,
            confidence,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            signature: vec![],
        };

        // Sign the response
        let response_data = bincode::serialize(&response)
            .map_err(|e| NetworkError::Serialization(e.to_string()))?;
        let signature_obj = self.keypair.sign(&response_data);
        response.signature = signature_obj.as_bytes().to_vec();

        self.send_consensus_response(response)?;
        Ok(())
    }

    /// Handle consensus response
    fn handle_consensus_response(&self, response: ConsensusResponse) -> Result<()> {
        // Don't process our own responses
        if response.responder == self.agent_id {
            return Ok(());
        }

        debug!(
            "Received consensus response from {} for query {}",
            response.responder, response.query_id
        );

        // Add to pending query
        let mut pending = self.pending_queries.write().unwrap();
        if let Some(query) = pending.get_mut(&response.query_id) {
            query.responses.push(response);
        }

        Ok(())
    }

    /// Get consensus responses for a query
    pub fn get_query_responses(&self, query_id: &str) -> Option<Vec<ConsensusResponse>> {
        let pending = self.pending_queries.read().unwrap();
        pending.get(query_id).map(|q| q.responses.clone())
    }

    /// Check if query has received enough responses
    pub fn is_query_complete(&self, query_id: &str) -> bool {
        let pending = self.pending_queries.read().unwrap();
        if let Some(query) = pending.get(query_id) {
            query.responses.len() >= query.expected_count
        } else {
            false
        }
    }

    /// Clear a completed query
    pub fn clear_query(&self, query_id: &str) {
        let mut pending = self.pending_queries.write().unwrap();
        pending.remove(query_id);
    }

    /// Get a cached vertex
    pub fn get_vertex(&self, vertex_id: &str) -> Option<VertexMessage> {
        let cache = self.vertex_cache.read().unwrap();
        cache.get(vertex_id).cloned()
    }

    /// Cleanup expired queries
    pub fn cleanup_expired_queries(&self, timeout: std::time::Duration) -> usize {
        let mut pending = self.pending_queries.write().unwrap();
        let now = std::time::SystemTime::now();

        let expired: Vec<String> = pending
            .iter()
            .filter(|(_, q)| {
                now.duration_since(q.created_at).unwrap_or_default() > timeout
            })
            .map(|(id, _)| id.clone())
            .collect();

        for id in &expired {
            pending.remove(id);
        }

        expired.len()
    }

    /// Get statistics
    pub fn get_stats(&self) -> ConsensusP2PStats {
        let pending = self.pending_queries.read().unwrap();
        let cache = self.vertex_cache.read().unwrap();

        ConsensusP2PStats {
            peer_count: self.peer_count(),
            pending_queries: pending.len(),
            cached_vertices: cache.len(),
        }
    }
}

/// Statistics for the consensus P2P node
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsensusP2PStats {
    pub peer_count: usize,
    pub pending_queries: usize,
    pub cached_vertices: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_consensus_p2p_node_creation() {
        let node = ConsensusP2PNode::new("test-agent".to_string());
        assert_eq!(node.agent_id(), "test-agent");
        assert_eq!(node.peer_count(), 0);
    }

    #[test]
    fn test_peer_management() {
        let node = ConsensusP2PNode::new("test-agent".to_string());

        node.add_peer("peer-1".to_string());
        node.add_peer("peer-2".to_string());
        assert_eq!(node.peer_count(), 2);

        node.remove_peer("peer-1");
        assert_eq!(node.peer_count(), 1);
    }

    #[test]
    fn test_vertex_broadcast() {
        let node = ConsensusP2PNode::new("test-agent".to_string());

        let vertex = VertexMessage {
            vertex_id: "v1".to_string(),
            parents: vec![],
            payload: vec![1, 2, 3],
            timestamp: 1234567890,
            creator: "test-agent".to_string(),
            signature: vec![],
            hash: [0u8; 32],
        };

        let result = node.broadcast_vertex(vertex.clone());
        assert!(result.is_ok());

        // Verify cached
        assert!(node.get_vertex("v1").is_some());
    }

    #[test]
    fn test_consensus_query() {
        let node = ConsensusP2PNode::new("test-agent".to_string());

        let query_id = node.send_consensus_query("v1".to_string(), 10).unwrap();

        // Should be in pending queries
        assert!(!node.is_query_complete(&query_id));
    }

    #[test]
    fn test_p2p_message_serialization() {
        let vertex = VertexMessage {
            vertex_id: "v1".to_string(),
            parents: vec![],
            payload: vec![1, 2, 3],
            timestamp: 1234567890,
            creator: "test-agent".to_string(),
            signature: vec![],
            hash: [0u8; 32],
        };

        let msg = P2PMessage::Vertex(vertex.clone());
        let bytes = msg.to_bytes().unwrap();
        let deserialized = P2PMessage::from_bytes(&bytes).unwrap();

        match deserialized {
            P2PMessage::Vertex(v) => {
                assert_eq!(v.vertex_id, vertex.vertex_id);
            }
            _ => panic!("Wrong message type"),
        }
    }

    #[test]
    fn test_query_cleanup() {
        let node = ConsensusP2PNode::new("test-agent".to_string());

        node.send_consensus_query("v1".to_string(), 10).unwrap();
        node.send_consensus_query("v2".to_string(), 10).unwrap();

        // Cleanup with very short timeout
        std::thread::sleep(std::time::Duration::from_millis(10));
        let cleaned = node.cleanup_expired_queries(std::time::Duration::from_millis(5));

        assert_eq!(cleaned, 2);
    }

    #[test]
    fn test_stats() {
        let node = ConsensusP2PNode::new("test-agent".to_string());

        node.add_peer("peer-1".to_string());
        node.send_consensus_query("v1".to_string(), 10).unwrap();

        let vertex = VertexMessage {
            vertex_id: "v1".to_string(),
            parents: vec![],
            payload: vec![],
            timestamp: 0,
            creator: "test".to_string(),
            signature: vec![],
            hash: [0u8; 32],
        };
        node.broadcast_vertex(vertex).unwrap();

        let stats = node.get_stats();
        assert_eq!(stats.peer_count, 1);
        assert_eq!(stats.pending_queries, 1);
        assert_eq!(stats.cached_vertices, 1);
    }
}
