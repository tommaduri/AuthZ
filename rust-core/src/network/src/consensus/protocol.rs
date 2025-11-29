//! Avalanche consensus protocol messages
//!
//! Defines message types used in the Avalanche DAG consensus protocol,
//! including vertex proposals, queries, votes, and responses.

use serde::{Deserialize, Serialize};
use cretoai_crypto::signatures::MLDSA87;

/// Vertex ID type
pub type VertexId = String;

/// Avalanche consensus message types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConsensusMessage {
    /// Propose a new vertex to the network
    ProposeVertex(VertexProposal),

    /// Query peers about their preference for a vertex
    QueryVertex {
        /// Vertex ID being queried
        vertex_id: VertexId,
        /// Query round number
        round: u64,
        /// Query ID for response matching
        query_id: String,
    },

    /// Vote to accept a vertex
    VoteAccept {
        /// Vertex ID being accepted
        vertex_id: VertexId,
        /// ML-DSA signature of the vote
        signature: Vec<u8>,
        /// Round number
        round: u64,
        /// Query ID this responds to
        query_id: String,
    },

    /// Vote to reject a vertex
    VoteReject {
        /// Vertex ID being rejected
        vertex_id: VertexId,
        /// Reason for rejection
        reason: String,
        /// Round number
        round: u64,
        /// Query ID this responds to
        query_id: String,
    },
}

/// Vertex proposal message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VertexProposal {
    /// Vertex ID
    pub vertex_id: VertexId,

    /// Parent vertex IDs
    pub parents: Vec<VertexId>,

    /// Transaction payload
    pub payload: Vec<u8>,

    /// Timestamp
    pub timestamp: u64,

    /// Creator agent ID
    pub creator: String,

    /// ML-DSA signature
    pub signature: Vec<u8>,

    /// BLAKE3 hash
    pub hash: [u8; 32],
}

impl VertexProposal {
    /// Create a new vertex proposal
    pub fn new(
        vertex_id: VertexId,
        parents: Vec<VertexId>,
        payload: Vec<u8>,
        creator: String,
    ) -> Self {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let hash = Self::compute_hash(&vertex_id, &parents, &payload, timestamp);

        Self {
            vertex_id,
            parents,
            payload,
            timestamp,
            creator,
            signature: Vec::new(),
            hash,
        }
    }

    /// Compute BLAKE3 hash of vertex
    pub fn compute_hash(
        id: &str,
        parents: &[VertexId],
        payload: &[u8],
        timestamp: u64,
    ) -> [u8; 32] {
        use blake3::Hasher;

        let mut hasher = Hasher::new();
        hasher.update(id.as_bytes());

        for parent in parents {
            hasher.update(parent.as_bytes());
        }

        hasher.update(payload);
        hasher.update(&timestamp.to_le_bytes());

        hasher.finalize().into()
    }

    /// Sign the vertex proposal with ML-DSA
    /// Note: Signing not implemented yet - placeholder for future integration
    pub fn sign(&mut self, _signer: &MLDSA87) -> Result<(), String> {
        // TODO: Implement actual signing when ML-DSA API is ready
        // let message = self.signable_content();
        // self.signature = signer.sign(&message)
        //     .map_err(|e| format!("Failed to sign: {}", e))?;
        Ok(())
    }

    /// Verify the vertex proposal signature
    /// Note: Verification not implemented yet - placeholder for future integration
    pub fn verify(&self, _public_key: &[u8]) -> Result<(), String> {
        // TODO: Implement actual verification when ML-DSA API is ready
        // let message = self.signable_content();
        // MLDSA87::verify(public_key, &message, &self.signature)
        //     .map_err(|e| format!("Signature verification failed: {}", e))
        Ok(())
    }

    /// Get the signable content (hash + creator)
    fn signable_content(&self) -> Vec<u8> {
        let mut content = Vec::new();
        content.extend_from_slice(&self.hash);
        content.extend_from_slice(self.creator.as_bytes());
        content
    }
}

/// Query response aggregation
#[derive(Debug, Clone)]
pub struct QueryResponse {
    /// Number of accept votes
    pub accepts: usize,

    /// Number of reject votes
    pub rejects: usize,

    /// Total responses received
    pub total: usize,

    /// Query ID
    pub query_id: String,
}

impl QueryResponse {
    /// Create a new query response tracker
    pub fn new(query_id: String) -> Self {
        Self {
            accepts: 0,
            rejects: 0,
            total: 0,
            query_id,
        }
    }

    /// Add an accept vote
    pub fn add_accept(&mut self) {
        self.accepts += 1;
        self.total += 1;
    }

    /// Add a reject vote
    pub fn add_reject(&mut self) {
        self.rejects += 1;
        self.total += 1;
    }

    /// Check if query has reached threshold
    pub fn has_threshold(&self, threshold: usize) -> bool {
        self.accepts >= threshold
    }

    /// Get acceptance ratio
    pub fn acceptance_ratio(&self) -> f64 {
        if self.total == 0 {
            0.0
        } else {
            self.accepts as f64 / self.total as f64
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vertex_proposal_creation() {
        let proposal = VertexProposal::new(
            "vertex-1".to_string(),
            vec!["parent-1".to_string()],
            vec![1, 2, 3],
            "agent-1".to_string(),
        );

        assert_eq!(proposal.vertex_id, "vertex-1");
        assert_eq!(proposal.parents.len(), 1);
        assert_eq!(proposal.payload, vec![1, 2, 3]);
    }

    #[test]
    fn test_vertex_hash_computation() {
        let proposal1 = VertexProposal::new(
            "vertex-1".to_string(),
            vec![],
            vec![1, 2, 3],
            "agent-1".to_string(),
        );

        // Sleep to ensure different timestamp
        std::thread::sleep(std::time::Duration::from_millis(2));

        let proposal2 = VertexProposal::new(
            "vertex-1".to_string(),
            vec![],
            vec![1, 2, 3],
            "agent-1".to_string(),
        );

        // Hashes should be different due to timestamp
        assert_ne!(proposal1.hash, proposal2.hash);
    }

    #[test]
    fn test_query_response_tracking() {
        let mut response = QueryResponse::new("query-1".to_string());

        response.add_accept();
        response.add_accept();
        response.add_reject();

        assert_eq!(response.accepts, 2);
        assert_eq!(response.rejects, 1);
        assert_eq!(response.total, 3);
        assert_eq!(response.acceptance_ratio(), 2.0 / 3.0);
    }

    #[test]
    fn test_query_threshold() {
        let mut response = QueryResponse::new("query-1".to_string());

        for _ in 0..24 {
            response.add_accept();
        }

        assert!(response.has_threshold(24));
        assert!(!response.has_threshold(25));
    }
}
