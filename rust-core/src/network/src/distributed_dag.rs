//! Distributed DAG Node with Network-Integrated Consensus
//!
//! This module provides a high-level distributed DAG node that combines:
//! - Local DAG graph storage and management
//! - QR-Avalanche consensus engine
//! - P2P network propagation via gossip protocol
//! - Byzantine fault-tolerant distributed consensus
//!
//! ## Architecture
//!
//! ```text
//! ┌──────────────────────────────────────────────────────────────┐
//! │                 DistributedDagNode                           │
//! ├──────────────────────────────────────────────────────────────┤
//! │                                                              │
//! │  ┌──────────┐    ┌──────────┐    ┌───────────────────┐    │
//! │  │   DAG    │◄───┤ Consensus│◄───┤  Consensus P2P    │    │
//! │  │  Graph   │    │  Engine  │    │      Node         │    │
//! │  └──────────┘    └──────────┘    └───────────────────┘    │
//! │       │               │                     │               │
//! │       │               │                     │               │
//! │       ▼               ▼                     ▼               │
//! │  ┌────────────────────────────────────────────────┐        │
//! │  │         Coordinated Operations:                │        │
//! │  │  • Add vertex → Broadcast → Consensus          │        │
//! │  │  • Receive vertex → Validate → Consensus       │        │
//! │  │  • Query network → Aggregate → Finalize        │        │
//! │  └────────────────────────────────────────────────┘        │
//! └──────────────────────────────────────────────────────────────┘
//!                          │
//!                          ▼
//!              Network (Gossip Protocol)
//! ```

use crate::consensus_p2p::{ConsensusP2PNode, VertexMessage};
use crate::error::{NetworkError, Result};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::task::JoinHandle;
use tracing::{debug, info, warn};

/// Configuration for distributed DAG node
#[derive(Debug, Clone)]
pub struct DistributedDagConfig {
    /// Agent ID for this node
    pub agent_id: String,

    /// Minimum network size for consensus
    pub min_network_size: usize,

    /// Sample size for consensus queries
    pub sample_size: usize,

    /// Alpha threshold (successful responses needed)
    pub alpha_threshold: usize,

    /// Beta threshold (consecutive successes for finalization)
    pub beta_threshold: usize,

    /// Confidence threshold for finalization
    pub finalization_threshold: f64,

    /// Maximum rounds before timeout
    pub max_rounds: u64,

    /// Query timeout duration
    pub query_timeout: Duration,

    /// Background cleanup interval
    pub cleanup_interval: Duration,
}

impl Default for DistributedDagConfig {
    fn default() -> Self {
        Self {
            agent_id: uuid::Uuid::new_v4().to_string(),
            min_network_size: 100,
            sample_size: 30,
            alpha_threshold: 24, // 80% of 30
            beta_threshold: 20,
            finalization_threshold: 0.95,
            max_rounds: 1000,
            query_timeout: Duration::from_secs(10),
            cleanup_interval: Duration::from_secs(30),
        }
    }
}

/// Distributed DAG node with network-integrated consensus
pub struct DistributedDagNode {
    /// Configuration
    config: DistributedDagConfig,

    /// P2P consensus node
    p2p_node: Arc<ConsensusP2PNode>,

    /// Local vertex store (vertex_id -> VertexMessage)
    local_vertices: Arc<RwLock<std::collections::HashMap<String, VertexMessage>>>,

    /// Consensus state (vertex_id -> ConsensusState)
    consensus_state: Arc<RwLock<std::collections::HashMap<String, VertexConsensusState>>>,

    /// Background task handle
    bg_task_handle: Arc<RwLock<Option<JoinHandle<()>>>>,
}

/// Consensus state for a vertex in the distributed system
#[derive(Debug, Clone)]
pub struct VertexConsensusState {
    /// Vertex ID
    pub vertex_id: String,

    /// Current confidence level
    pub confidence: f64,

    /// Consecutive successful rounds
    pub consecutive_successes: u32,

    /// Total rounds executed
    pub total_rounds: u64,

    /// Total positive responses
    pub positive_responses: u32,

    /// Total responses
    pub total_responses: u32,

    /// Whether finalized
    pub finalized: bool,

    /// Current round
    pub current_round: u64,
}

impl Default for VertexConsensusState {
    fn default() -> Self {
        Self {
            vertex_id: String::new(),
            confidence: 0.0,
            consecutive_successes: 0,
            total_rounds: 0,
            positive_responses: 0,
            total_responses: 0,
            finalized: false,
            current_round: 0,
        }
    }
}

impl DistributedDagNode {
    /// Create a new distributed DAG node
    pub fn new(config: DistributedDagConfig) -> Self {
        let agent_id = config.agent_id.clone();
        let p2p_node = Arc::new(ConsensusP2PNode::new(agent_id));

        Self {
            config,
            p2p_node,
            local_vertices: Arc::new(RwLock::new(std::collections::HashMap::new())),
            consensus_state: Arc::new(RwLock::new(std::collections::HashMap::new())),
            bg_task_handle: Arc::new(RwLock::new(None)),
        }
    }

    /// Get agent ID
    pub fn agent_id(&self) -> &str {
        &self.config.agent_id
    }

    /// Add a peer to the network
    pub fn add_peer(&self, peer_id: String) {
        self.p2p_node.add_peer(peer_id.clone());
        info!("Added peer: {}", peer_id);
    }

    /// Remove a peer
    pub fn remove_peer(&self, peer_id: &str) {
        self.p2p_node.remove_peer(peer_id);
        info!("Removed peer: {}", peer_id);
    }

    /// Get current network size
    pub fn network_size(&self) -> usize {
        self.p2p_node.peer_count()
    }

    /// Add a vertex to the local DAG and broadcast it to the network
    pub async fn add_vertex(&self, vertex: VertexMessage) -> Result<String> {
        let vertex_id = vertex.vertex_id.clone();

        // Store locally
        {
            let mut vertices = self.local_vertices.write().await;
            vertices.insert(vertex_id.clone(), vertex.clone());
        }

        // Initialize consensus state
        {
            let mut states = self.consensus_state.write().await;
            states.insert(
                vertex_id.clone(),
                VertexConsensusState {
                    vertex_id: vertex_id.clone(),
                    ..Default::default()
                },
            );
        }

        // Broadcast to network
        self.p2p_node.broadcast_vertex(vertex)?;

        info!("Added and broadcast vertex: {}", vertex_id);
        Ok(vertex_id)
    }

    /// Run consensus for a vertex
    pub async fn run_consensus(&self, vertex_id: &str) -> Result<bool> {
        // Check network size
        if self.network_size() < self.config.min_network_size {
            return Err(NetworkError::Consensus(format!(
                "Network too small: {} < {}",
                self.network_size(),
                self.config.min_network_size
            )));
        }

        // Initialize state if needed
        {
            let mut states = self.consensus_state.write().await;
            states
                .entry(vertex_id.to_string())
                .or_insert_with(|| VertexConsensusState {
                    vertex_id: vertex_id.to_string(),
                    ..Default::default()
                });
        }

        // Run consensus rounds until finalization or timeout
        loop {
            let finalized = self.consensus_round(vertex_id).await?;
            if finalized {
                info!("Vertex {} finalized!", vertex_id);
                return Ok(true);
            }

            // Check timeout
            let current_round = {
                let states = self.consensus_state.read().await;
                states
                    .get(vertex_id)
                    .map(|s| s.current_round)
                    .unwrap_or(0)
            };

            if current_round >= self.config.max_rounds {
                warn!("Consensus timeout for vertex {} after {} rounds", vertex_id, current_round);
                return Err(NetworkError::Consensus(format!(
                    "Timeout after {} rounds",
                    current_round
                )));
            }

            // Small delay between rounds
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    /// Execute one round of consensus
    async fn consensus_round(&self, vertex_id: &str) -> Result<bool> {
        // Send consensus query
        let query_id = self
            .p2p_node
            .send_consensus_query(vertex_id.to_string(), self.config.sample_size)?;

        debug!("Sent consensus query {} for vertex {}", query_id, vertex_id);

        // Wait for responses with timeout
        let timeout = self.config.query_timeout;
        let start = std::time::Instant::now();

        while start.elapsed() < timeout {
            if self.p2p_node.is_query_complete(&query_id) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        // Get responses
        let responses = self
            .p2p_node
            .get_query_responses(&query_id)
            .unwrap_or_default();

        // Cleanup query
        self.p2p_node.clear_query(&query_id);

        // Count positive responses
        let positive_count = responses.iter().filter(|r| r.vote).count();
        let total_responses = responses.len();

        debug!(
            "Consensus round for {}: {} / {} positive",
            vertex_id, positive_count, total_responses
        );

        // Update consensus state
        let mut states = self.consensus_state.write().await;
        let state = states
            .get_mut(vertex_id)
            .ok_or_else(|| NetworkError::Consensus("State not found".to_string()))?;

        state.current_round += 1;
        state.total_rounds += 1;
        state.total_responses += total_responses as u32;
        state.positive_responses += positive_count as u32;

        // Check alpha threshold
        let success = positive_count >= self.config.alpha_threshold;

        if success {
            state.consecutive_successes += 1;
        } else {
            state.consecutive_successes = 0;
        }

        // Update confidence
        if total_responses > 0 {
            let response_ratio = positive_count as f64 / total_responses as f64;
            state.confidence = (state.confidence * 0.9) + (response_ratio * 0.1);
        }

        // Check for finalization
        if state.consecutive_successes >= self.config.beta_threshold as u32
            && state.confidence >= self.config.finalization_threshold
        {
            state.finalized = true;
            info!(
                "Vertex {} reached finality (confidence: {:.2})",
                vertex_id, state.confidence
            );
            return Ok(true);
        }

        Ok(false)
    }

    /// Get consensus state for a vertex
    pub async fn get_consensus_state(&self, vertex_id: &str) -> Option<VertexConsensusState> {
        let states = self.consensus_state.read().await;
        states.get(vertex_id).cloned()
    }

    /// Check if a vertex is finalized
    pub async fn is_finalized(&self, vertex_id: &str) -> bool {
        let states = self.consensus_state.read().await;
        states
            .get(vertex_id)
            .map(|s| s.finalized)
            .unwrap_or(false)
    }

    /// Get a vertex from local storage
    pub async fn get_vertex(&self, vertex_id: &str) -> Option<VertexMessage> {
        let vertices = self.local_vertices.read().await;
        vertices.get(vertex_id).cloned()
    }

    /// Get all finalized vertices
    pub async fn get_finalized_vertices(&self) -> Vec<String> {
        let states = self.consensus_state.read().await;
        states
            .values()
            .filter(|s| s.finalized)
            .map(|s| s.vertex_id.clone())
            .collect()
    }

    /// Start background cleanup task
    pub async fn start_background_tasks(&self) {
        let p2p_node = self.p2p_node.clone();
        let cleanup_interval = self.config.cleanup_interval;

        let handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(cleanup_interval);
            loop {
                interval.tick().await;

                // Cleanup expired queries
                let cleaned = p2p_node.cleanup_expired_queries(Duration::from_secs(60));
                if cleaned > 0 {
                    debug!("Cleaned up {} expired queries", cleaned);
                }
            }
        });

        let mut bg_handle = self.bg_task_handle.write().await;
        *bg_handle = Some(handle);
    }

    /// Stop background tasks
    pub async fn stop_background_tasks(&self) {
        let mut bg_handle = self.bg_task_handle.write().await;
        if let Some(handle) = bg_handle.take() {
            handle.abort();
        }
    }

    /// Get node statistics
    pub async fn get_stats(&self) -> DistributedDagStats {
        let vertices = self.local_vertices.read().await;
        let states = self.consensus_state.read().await;
        let p2p_stats = self.p2p_node.get_stats();

        let finalized_count = states.values().filter(|s| s.finalized).count();

        DistributedDagStats {
            network_size: self.network_size(),
            local_vertices: vertices.len(),
            pending_consensus: states.len() - finalized_count,
            finalized_vertices: finalized_count,
            pending_queries: p2p_stats.pending_queries,
        }
    }
}

/// Statistics for distributed DAG node
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistributedDagStats {
    pub network_size: usize,
    pub local_vertices: usize,
    pub pending_consensus: usize,
    pub finalized_vertices: usize,
    pub pending_queries: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_distributed_dag_node_creation() {
        let config = DistributedDagConfig::default();
        let node = DistributedDagNode::new(config);

        assert_eq!(node.network_size(), 0);
    }

    #[tokio::test]
    async fn test_peer_management() {
        let config = DistributedDagConfig::default();
        let node = DistributedDagNode::new(config);

        node.add_peer("peer-1".to_string());
        node.add_peer("peer-2".to_string());
        assert_eq!(node.network_size(), 2);

        node.remove_peer("peer-1");
        assert_eq!(node.network_size(), 1);
    }

    #[tokio::test]
    async fn test_add_vertex() {
        let config = DistributedDagConfig::default();
        let node = DistributedDagNode::new(config);

        let vertex = VertexMessage {
            vertex_id: "v1".to_string(),
            parents: vec![],
            payload: vec![1, 2, 3],
            timestamp: 1234567890,
            creator: node.agent_id().to_string(),
            signature: vec![],
            hash: [0u8; 32],
        };

        let vertex_id = node.add_vertex(vertex).await.unwrap();
        assert_eq!(vertex_id, "v1");

        // Verify stored
        assert!(node.get_vertex("v1").await.is_some());
    }

    #[tokio::test]
    async fn test_consensus_insufficient_network() {
        let config = DistributedDagConfig {
            min_network_size: 10,
            ..Default::default()
        };
        let node = DistributedDagNode::new(config);

        // Add only a few peers (less than min_network_size)
        node.add_peer("peer-1".to_string());
        node.add_peer("peer-2".to_string());

        let vertex = VertexMessage {
            vertex_id: "v1".to_string(),
            parents: vec![],
            payload: vec![],
            timestamp: 0,
            creator: node.agent_id().to_string(),
            signature: vec![],
            hash: [0u8; 32],
        };

        node.add_vertex(vertex).await.unwrap();

        // Should fail due to insufficient network size
        let result = node.run_consensus("v1").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_stats() {
        let config = DistributedDagConfig::default();
        let node = DistributedDagNode::new(config);

        node.add_peer("peer-1".to_string());

        let vertex = VertexMessage {
            vertex_id: "v1".to_string(),
            parents: vec![],
            payload: vec![],
            timestamp: 0,
            creator: node.agent_id().to_string(),
            signature: vec![],
            hash: [0u8; 32],
        };
        node.add_vertex(vertex).await.unwrap();

        let stats = node.get_stats().await;
        assert_eq!(stats.network_size, 1);
        assert_eq!(stats.local_vertices, 1);
    }
}
