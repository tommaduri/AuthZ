//! LibP2P-based consensus node implementation
//!
//! Migrates consensus from simulated GossipProtocol to real LibP2P Gossipsub.
//! Preserves all ML-DSA signature verification from Option 1.

use crate::error::{NetworkError, Result};
use crate::libp2p::swarm::{VigiliaEvent, VigiliaSwarm};
use libp2p::{gossipsub::MessageId, Multiaddr, PeerId};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::SystemTime;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};
use cretoai_crypto::signatures::{MLDSA87, MLDSA87KeyPair, MLDSA87Signature};

/// Topic for DAG vertex propagation
pub const VERTEX_TOPIC: &str = "vigilia/consensus/v1";

/// Topic for consensus queries
pub const CONSENSUS_QUERY_TOPIC: &str = "vigilia/consensus/query/v1";

/// Topic for consensus responses
pub const CONSENSUS_RESPONSE_TOPIC: &str = "vigilia/consensus/response/v1";

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

    /// Quantum-resistant signature (ML-DSA-87)
    pub signature: Vec<u8>,

    /// Vertex hash (BLAKE3)
    pub hash: [u8; 32],
}

impl VertexMessage {
    /// Verify ML-DSA signature on this vertex
    pub fn verify_signature(&self, public_key: &[u8]) -> Result<()> {
        // Reconstruct the signed data (everything except signature)
        let mut data_to_verify = Vec::new();
        data_to_verify.extend_from_slice(self.vertex_id.as_bytes());
        for parent in &self.parents {
            data_to_verify.extend_from_slice(parent.as_bytes());
        }
        data_to_verify.extend_from_slice(&self.payload);
        data_to_verify.extend_from_slice(&self.timestamp.to_le_bytes());
        data_to_verify.extend_from_slice(self.creator.as_bytes());
        data_to_verify.extend_from_slice(&self.hash);

        // Parse signature
        let signature = MLDSA87Signature::from_bytes(&self.signature)
            .map_err(|e| NetworkError::InvalidSignature(format!("Invalid signature format: {}", e)))?;

        // Parse public key
        let pub_key = cretoai_crypto::signatures::MLDSA87PublicKey::from_bytes(public_key)
            .map_err(|e| NetworkError::InvalidSignature(format!("Invalid public key format: {}", e)))?;

        // Verify signature (correct order: message, signature, public_key)
        MLDSA87::verify(&data_to_verify, &signature, &pub_key)
            .map_err(|_| NetworkError::InvalidSignature("ML-DSA signature verification failed".to_string()))
    }

    /// Sign this vertex with ML-DSA
    pub fn sign(&mut self, keypair: &MLDSA87KeyPair) -> Result<()> {
        // Create data to sign
        let mut data_to_sign = Vec::new();
        data_to_sign.extend_from_slice(self.vertex_id.as_bytes());
        for parent in &self.parents {
            data_to_sign.extend_from_slice(parent.as_bytes());
        }
        data_to_sign.extend_from_slice(&self.payload);
        data_to_sign.extend_from_slice(&self.timestamp.to_le_bytes());
        data_to_sign.extend_from_slice(self.creator.as_bytes());
        data_to_sign.extend_from_slice(&self.hash);

        // Sign with ML-DSA
        let signature = keypair.sign(&data_to_sign);
        self.signature = signature.as_bytes().to_vec();

        Ok(())
    }
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

    /// Response signature (ML-DSA)
    pub signature: Vec<u8>,
}

/// P2P message types (preserved from simulated version)
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
    pub query: ConsensusQuery,
    pub responses: Vec<ConsensusResponse>,
    pub expected_count: usize,
    pub created_at: SystemTime,
}

/// Peer public key cache for signature verification
#[derive(Debug)]
struct PeerKeyCache {
    keys: HashMap<PeerId, Vec<u8>>,
}

impl PeerKeyCache {
    fn new() -> Self {
        Self {
            keys: HashMap::new(),
        }
    }

    fn add_peer(&mut self, peer_id: PeerId, public_key: Vec<u8>) {
        self.keys.insert(peer_id, public_key);
    }

    fn get_peer_key(&self, peer_id: &PeerId) -> Option<&[u8]> {
        self.keys.get(peer_id).map(|k| k.as_slice())
    }

    fn remove_peer(&mut self, peer_id: &PeerId) {
        self.keys.remove(peer_id);
    }
}

/// LibP2P-based consensus node (replaces ConsensusP2PNode)
pub struct LibP2PConsensusNode {
    /// Real LibP2P swarm (replaces GossipProtocol)
    swarm: Arc<RwLock<VigiliaSwarm>>,

    /// Pending consensus queries
    pending_queries: Arc<RwLock<HashMap<String, PendingQuery>>>,

    /// Received vertex cache (deduplication)
    vertex_cache: Arc<RwLock<HashMap<String, VertexMessage>>>,

    /// Peer public keys for signature verification
    peer_keys: Arc<RwLock<PeerKeyCache>>,

    /// Agent ID
    agent_id: String,

    /// Agent keypair for signing messages (ML-DSA-87)
    keypair: Arc<MLDSA87KeyPair>,

    /// Event sender for async processing
    event_tx: mpsc::UnboundedSender<VigiliaEvent>,

    /// Event receiver for async processing
    event_rx: Arc<tokio::sync::Mutex<mpsc::UnboundedReceiver<VigiliaEvent>>>,
}

impl LibP2PConsensusNode {
    /// Create a new LibP2P consensus node
    pub async fn new(agent_id: String) -> Result<Self> {
        let mut swarm = VigiliaSwarm::new(agent_id.clone()).await?;

        // Subscribe to all consensus topics
        swarm.subscribe(VERTEX_TOPIC)?;
        swarm.subscribe(CONSENSUS_QUERY_TOPIC)?;
        swarm.subscribe(CONSENSUS_RESPONSE_TOPIC)?;

        // Generate ML-DSA keypair for this node
        let keypair = Arc::new(MLDSA87::generate());

        let (event_tx, event_rx) = mpsc::unbounded_channel();

        Ok(Self {
            swarm: Arc::new(RwLock::new(swarm)),
            pending_queries: Arc::new(RwLock::new(HashMap::new())),
            vertex_cache: Arc::new(RwLock::new(HashMap::new())),
            peer_keys: Arc::new(RwLock::new(PeerKeyCache::new())),
            agent_id,
            keypair,
            event_tx,
            event_rx: Arc::new(tokio::sync::Mutex::new(event_rx)),
        })
    }

    /// Get agent ID
    pub fn agent_id(&self) -> &str {
        &self.agent_id
    }

    /// Get local peer ID
    pub fn local_peer_id(&self) -> PeerId {
        *self.swarm.read().unwrap().local_peer_id()
    }

    /// Listen on an address
    pub fn listen_on(&self, addr: Multiaddr) -> Result<()> {
        self.swarm.write().unwrap().listen_on(addr)
    }

    /// Dial a peer
    pub fn dial(&self, addr: Multiaddr) -> Result<()> {
        self.swarm.write().unwrap().dial(addr)
    }

    /// Add a peer's public key for signature verification
    pub fn add_peer_key(&self, peer_id: PeerId, public_key: Vec<u8>) {
        self.peer_keys.write().unwrap().add_peer(peer_id, public_key);
        info!("Added public key for peer {}", peer_id);
    }

    /// Remove a peer
    pub fn remove_peer(&self, peer_id: &PeerId) {
        self.peer_keys.write().unwrap().remove_peer(peer_id);
        info!("Removed peer {}", peer_id);
    }

    /// Get peer count
    pub fn peer_count(&self) -> usize {
        self.swarm.read().unwrap().peer_count()
    }

    /// Broadcast a vertex to the network (real Gossipsub)
    pub async fn broadcast_vertex(&self, mut vertex: VertexMessage) -> Result<MessageId> {
        // Sign the vertex with ML-DSA
        vertex.sign(&self.keypair)?;

        // Cache the vertex
        {
            let mut cache = self.vertex_cache.write().unwrap();
            cache.insert(vertex.vertex_id.clone(), vertex.clone());
        }

        // Serialize and publish via real Gossipsub
        let p2p_msg = P2PMessage::Vertex(vertex.clone());
        let data = p2p_msg.to_bytes()?;

        let message_id = {
            let mut swarm = self.swarm.write().unwrap();
            swarm.publish(VERTEX_TOPIC, data).await?
        };

        info!("Broadcast vertex {} via Gossipsub (msg_id: {:?})", vertex.vertex_id, message_id);
        Ok(message_id)
    }

    /// Send a consensus query to the network
    pub async fn send_consensus_query(
        &self,
        vertex_id: String,
        sample_size: usize,
    ) -> Result<String> {
        let query_id = uuid::Uuid::new_v4().to_string();
        let timestamp = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let query = ConsensusQuery {
            query_id: query_id.clone(),
            vertex_id,
            requester: self.local_peer_id().to_string(),
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
                    created_at: SystemTime::now(),
                },
            );
        }

        // Serialize and publish via Gossipsub
        let p2p_msg = P2PMessage::Query(query);
        let data = p2p_msg.to_bytes()?;

        {
            let mut swarm = self.swarm.write().unwrap();
            swarm.publish(CONSENSUS_QUERY_TOPIC, data).await?;
        }

        debug!("Sent consensus query {}", query_id);
        Ok(query_id)
    }

    /// Send a consensus response
    pub async fn send_consensus_response(&self, response: ConsensusResponse) -> Result<()> {
        let p2p_msg = P2PMessage::Response(response.clone());
        let data = p2p_msg.to_bytes()?;

        {
            let mut swarm = self.swarm.write().unwrap();
            swarm.publish(CONSENSUS_RESPONSE_TOPIC, data).await?;
        }

        debug!("Sent consensus response for query {}", response.query_id);
        Ok(())
    }

    /// Handle incoming Gossipsub message
    async fn handle_message(&self, topic: &str, data: Vec<u8>, source: Option<PeerId>) -> Result<()> {
        // Deserialize P2P message
        let p2p_msg = P2PMessage::from_bytes(&data)?;

        match p2p_msg {
            P2PMessage::Vertex(vertex) => {
                self.handle_vertex_message(vertex, source).await?;
            }
            P2PMessage::Query(query) => {
                self.handle_consensus_query(query).await?;
            }
            P2PMessage::Response(response) => {
                self.handle_consensus_response(response)?;
            }
        }

        Ok(())
    }

    /// Handle received vertex message with ML-DSA verification
    async fn handle_vertex_message(&self, vertex: VertexMessage, source: Option<PeerId>) -> Result<()> {
        // Check if already cached
        {
            let cache = self.vertex_cache.read().unwrap();
            if cache.contains_key(&vertex.vertex_id) {
                debug!("Vertex {} already cached, ignoring", vertex.vertex_id);
                return Ok(());
            }
        }

        // Verify ML-DSA signature (Option 1 work - PRESERVED)
        if let Some(peer_id) = source {
            let peer_keys = self.peer_keys.read().unwrap();
            if let Some(public_key) = peer_keys.get_peer_key(&peer_id) {
                vertex.verify_signature(public_key)?;
                info!("Verified ML-DSA signature for vertex {} from peer {}", vertex.vertex_id, peer_id);
            } else {
                warn!("No public key found for peer {}, accepting on first contact (TODO: implement CA)", peer_id);
                // TODO: In production, implement certificate authority for public key distribution
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
    async fn handle_consensus_query(&self, query: ConsensusQuery) -> Result<()> {
        // Don't respond to our own queries
        if query.requester == self.local_peer_id().to_string() {
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

        // Create and send response
        let response = ConsensusResponse {
            query_id: query.query_id,
            vertex_id: query.vertex_id,
            responder: self.local_peer_id().to_string(),
            vote,
            confidence,
            timestamp: SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            signature: vec![], // TODO: Sign with ML-DSA
        };

        self.send_consensus_response(response).await?;
        Ok(())
    }

    /// Handle consensus response
    fn handle_consensus_response(&self, response: ConsensusResponse) -> Result<()> {
        // Don't process our own responses
        if response.responder == self.local_peer_id().to_string() {
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
        let now = SystemTime::now();

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

    /// Process next event from the swarm (call this in a loop)
    pub async fn process_next_event(&self) -> Result<()> {
        let event = {
            let mut swarm = self.swarm.write().unwrap();
            swarm.next_event().await
        };

        if let Some(event) = event {
            match event {
                VigiliaEvent::Message { topic, data, source } => {
                    self.handle_message(&topic, data, source).await?;
                }
                VigiliaEvent::PeerConnected { peer_id } => {
                    info!("Peer connected: {}", peer_id);
                    // TODO: Request public key via Identify protocol
                }
                VigiliaEvent::PeerDisconnected { peer_id } => {
                    info!("Peer disconnected: {}", peer_id);
                    self.remove_peer(&peer_id);
                }
                _ => {}
            }
        }

        Ok(())
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

    #[tokio::test]
    async fn test_libp2p_consensus_node_creation() {
        let node = LibP2PConsensusNode::new("test-agent".to_string()).await.unwrap();
        assert_eq!(node.agent_id(), "test-agent");
        assert_eq!(node.peer_count(), 0);
    }

    #[tokio::test]
    #[ignore] // Requires multiple connected peers - run as integration test
    async fn test_vertex_broadcast_with_signature() {
        let node = LibP2PConsensusNode::new("test-agent".to_string()).await.unwrap();

        let vertex = VertexMessage {
            vertex_id: "v1".to_string(),
            parents: vec![],
            payload: vec![1, 2, 3],
            timestamp: 1234567890,
            creator: "test-agent".to_string(),
            signature: vec![],
            hash: [0u8; 32],
        };

        let result = node.broadcast_vertex(vertex.clone()).await;
        assert!(result.is_ok());

        // Verify cached
        assert!(node.get_vertex("v1").is_some());

        // Verify signature was added
        let cached = node.get_vertex("v1").unwrap();
        assert!(!cached.signature.is_empty());
    }

    #[tokio::test]
    #[ignore] // Requires multiple connected peers - run as integration test
    async fn test_consensus_query_libp2p() {
        let node = LibP2PConsensusNode::new("test-agent".to_string()).await.unwrap();

        let query_id = node.send_consensus_query("v1".to_string(), 10).await.unwrap();

        // Should be in pending queries
        assert!(!node.is_query_complete(&query_id));
    }

    #[tokio::test]
    async fn test_listen_and_dial() {
        let node = LibP2PConsensusNode::new("test-agent".to_string()).await.unwrap();

        let addr: Multiaddr = "/ip4/127.0.0.1/tcp/0".parse().unwrap();
        node.listen_on(addr).unwrap();
    }

    #[tokio::test]
    #[ignore] // Requires multiple connected peers - run as integration test
    async fn test_stats() {
        let node = LibP2PConsensusNode::new("test-agent".to_string()).await.unwrap();

        node.send_consensus_query("v1".to_string(), 10).await.unwrap();

        let vertex = VertexMessage {
            vertex_id: "v1".to_string(),
            parents: vec![],
            payload: vec![],
            timestamp: 0,
            creator: "test".to_string(),
            signature: vec![],
            hash: [0u8; 32],
        };
        node.broadcast_vertex(vertex).await.unwrap();

        let stats = node.get_stats();
        assert_eq!(stats.pending_queries, 1);
        assert_eq!(stats.cached_vertices, 1);
    }
}
