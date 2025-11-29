//! Consensus protocol trait

use crate::error::Result;
use crate::types::{ConsensusState, VertexHash, VertexId};
use async_trait::async_trait;

/// Vertex data for consensus
#[derive(Debug, Clone)]
pub struct Vertex {
    /// Vertex identifier
    pub id: VertexId,
    /// Parent vertices
    pub parents: Vec<VertexId>,
    /// Vertex data
    pub data: Vec<u8>,
    /// Vertex hash
    pub hash: VertexHash,
    /// Timestamp
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

impl Vertex {
    /// Create a new vertex
    pub fn new(parents: Vec<VertexId>, data: Vec<u8>) -> Self {
        let hash = VertexHash::from_data(&data);
        let id = VertexId::new(*hash.as_bytes());

        Vertex {
            id,
            parents,
            data,
            hash,
            timestamp: chrono::Utc::now(),
        }
    }
}

/// Query response from a peer
#[derive(Debug, Clone)]
pub struct QueryResponse {
    /// The queried vertex
    pub vertex_id: VertexId,
    /// Peer's preference
    pub preferred: bool,
    /// Response timestamp
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

/// Consensus protocol abstraction
#[async_trait]
pub trait ConsensusProtocol: Send + Sync {
    /// Propose a new vertex
    async fn propose(&self, vertex: Vertex) -> Result<VertexId>;

    /// Query consensus on a vertex
    async fn query(&self, vertex_id: &VertexId) -> Result<ConsensusState>;

    /// Wait for a vertex to be finalized
    async fn wait_finality(&self, vertex_id: &VertexId) -> Result<()>;

    /// Get the consensus state of a vertex
    async fn get_state(&self, vertex_id: &VertexId) -> Result<ConsensusState>;

    /// Get ancestors of a vertex
    async fn get_ancestors(&self, vertex_id: &VertexId) -> Result<Vec<VertexId>>;

    /// Get descendants of a vertex
    async fn get_descendants(&self, vertex_id: &VertexId) -> Result<Vec<VertexId>>;

    /// Check if a vertex is finalized
    async fn is_finalized(&self, vertex_id: &VertexId) -> Result<bool> {
        Ok(self.get_state(vertex_id).await?.is_finalized())
    }

    /// Check if a vertex is rejected
    async fn is_rejected(&self, vertex_id: &VertexId) -> Result<bool> {
        Ok(self.get_state(vertex_id).await?.is_rejected())
    }
}

/// Avalanche-specific consensus protocol
#[async_trait]
pub trait AvalancheProtocol: ConsensusProtocol {
    /// Get confidence value for a vertex
    async fn get_confidence(&self, vertex_id: &VertexId) -> Result<f64>;

    /// Query peers about a vertex
    async fn query_peers(&self, vertex_id: &VertexId) -> Result<Vec<QueryResponse>>;

    /// Update preference based on query results
    async fn update_preference(&self, vertex_id: &VertexId, responses: Vec<QueryResponse>)
        -> Result<()>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vertex_creation() {
        let data = b"test vertex data";
        let vertex = Vertex::new(vec![], data.to_vec());

        assert_eq!(vertex.data, data);
        assert_eq!(vertex.parents.len(), 0);
        assert_eq!(vertex.hash, VertexHash::from_data(data));
    }

    #[test]
    fn test_vertex_with_parents() {
        let parent1 = VertexId::new([1u8; 32]);
        let parent2 = VertexId::new([2u8; 32]);
        let data = b"child vertex";

        let vertex = Vertex::new(vec![parent1, parent2], data.to_vec());
        assert_eq!(vertex.parents.len(), 2);
    }
}
