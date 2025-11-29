//! P2P wrapper for consensus operations
//!
//! Provides a simplified interface to ConsensusP2PNode for the network adapter.

use crate::consensus_p2p::{ConsensusP2PNode, ConsensusResponse, VertexMessage};
use crate::gossip::MessageId;
use crate::error::Result;
use std::sync::Arc;

/// Wrapper around ConsensusP2PNode for cleaner adapter interface
pub struct ConsensusP2P {
    node: Arc<ConsensusP2PNode>,
}

impl ConsensusP2P {
    /// Create new P2P wrapper
    pub fn new(node: Arc<ConsensusP2PNode>) -> Self {
        Self { node }
    }

    /// Get agent ID
    pub fn agent_id(&self) -> &str {
        self.node.agent_id()
    }

    /// Send consensus query
    pub fn send_consensus_query(&self, vertex_id: String, sample_size: usize) -> Result<String> {
        self.node.send_consensus_query(vertex_id, sample_size)
    }

    /// Get query responses
    pub fn get_query_responses(&self, query_id: &str) -> Option<Vec<ConsensusResponse>> {
        self.node.get_query_responses(query_id)
    }

    /// Check if query is complete
    pub fn is_query_complete(&self, query_id: &str) -> bool {
        self.node.is_query_complete(query_id)
    }

    /// Clear query
    pub fn clear_query(&self, query_id: &str) {
        self.node.clear_query(query_id)
    }

    /// Broadcast vertex
    pub fn broadcast_vertex(&self, vertex: VertexMessage) -> Result<MessageId> {
        self.node.broadcast_vertex(vertex)
    }

    /// Get cached vertex
    pub fn get_vertex(&self, vertex_id: &str) -> Option<VertexMessage> {
        self.node.get_vertex(vertex_id)
    }

    /// Get statistics
    pub fn get_stats(&self) -> crate::consensus_p2p::ConsensusP2PStats {
        self.node.get_stats()
    }

    /// Add peer
    pub fn add_peer(&self, peer_id: String) {
        self.node.add_peer(peer_id)
    }

    /// Get peer count
    pub fn peer_count(&self) -> usize {
        self.node.peer_count()
    }
}
