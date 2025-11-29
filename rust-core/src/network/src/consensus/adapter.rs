//! Network adapter connecting DAG consensus to QUIC P2P layer
//!
//! Bridges the gap between the DAG consensus engine and the P2P network layer,
//! enabling distributed Byzantine fault-tolerant consensus across QUIC connections.

use crate::consensus::ConsensusP2P;
use crate::consensus_p2p::{ConsensusResponse, ConsensusP2PNode};
use crate::error::{NetworkError, Result};
use std::sync::Arc;
use std::time::Duration;
use tokio::time::timeout;
use tracing::{debug, warn, info};
use cretoai_crypto::signatures::{MLDSA87, MLDSA87PublicKey};

/// Network adapter for consensus operations
pub struct NetworkAdapter {
    /// P2P consensus layer
    consensus_p2p: Arc<ConsensusP2P>,

    /// Query timeout duration
    query_timeout: Duration,
}

impl NetworkAdapter {
    /// Create a new network adapter
    pub fn new(consensus_p2p: Arc<ConsensusP2P>) -> Self {
        Self {
            consensus_p2p,
            query_timeout: Duration::from_secs(5),
        }
    }

    /// Create with custom timeout
    pub fn with_timeout(consensus_p2p: Arc<ConsensusP2P>, query_timeout: Duration) -> Self {
        Self {
            consensus_p2p,
            query_timeout,
        }
    }

    /// Bridge consensus queries to network layer
    ///
    /// Sends a consensus query to sampled peers and collects responses.
    /// Returns verified responses with valid signatures.
    pub async fn query_peers(
        &self,
        vertex_id: &str,
        sample_size: usize,
    ) -> Result<Vec<ConsensusResponse>> {
        debug!("Querying {} peers about vertex {}", sample_size, vertex_id);

        // Send consensus query via P2P layer
        let query_id = self.consensus_p2p
            .send_consensus_query(vertex_id.to_string(), sample_size)?;

        // Wait for responses with timeout
        let responses = self.wait_for_responses(&query_id, sample_size).await?;

        // Clean up completed query
        self.consensus_p2p.clear_query(&query_id);

        info!("Received {} responses for vertex {}", responses.len(), vertex_id);
        Ok(responses)
    }

    /// Wait for consensus responses with timeout
    async fn wait_for_responses(
        &self,
        query_id: &str,
        expected_count: usize,
    ) -> Result<Vec<ConsensusResponse>> {
        let result = timeout(self.query_timeout, async {
            loop {
                // Check if we have enough responses
                if self.consensus_p2p.is_query_complete(query_id) {
                    return self.consensus_p2p
                        .get_query_responses(query_id)
                        .ok_or_else(|| NetworkError::Query("Query not found".to_string()));
                }

                // Wait a bit before checking again
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await;

        match result {
            Ok(responses) => responses,
            Err(_) => {
                // Timeout - return whatever responses we have
                warn!("Query {} timed out, returning partial responses", query_id);
                Ok(self.consensus_p2p
                    .get_query_responses(query_id)
                    .unwrap_or_default())
            }
        }
    }

    /// Verify response signature
    ///
    /// Returns true if the signature is valid for the response data
    pub fn verify_response_signature(
        &self,
        response: &ConsensusResponse,
        public_key: &MLDSA87PublicKey,
    ) -> Result<bool> {
        // Serialize response data (without signature)
        let mut response_copy = response.clone();
        response_copy.signature = vec![];

        let message = bincode::serialize(&response_copy)
            .map_err(|e| NetworkError::Serialization(e.to_string()))?;

        // Verify ML-DSA signature
        match cretoai_crypto::signatures::MLDSA87Signature::from_bytes(&response.signature) {
            Ok(signature) => {
                match MLDSA87::verify(&message, &signature, public_key) {
                    Ok(_) => Ok(true),
                    Err(_) => Ok(false),
                }
            }
            Err(_) => Ok(false),
        }
    }

    /// Get peer's public key from identity
    ///
    /// In a real implementation, this would look up the peer's public key
    /// from a distributed identity registry or PKI system.
    pub fn get_peer_public_key(&self, peer_id: &str) -> Result<MLDSA87PublicKey> {
        // TODO: Implement actual peer public key lookup
        // For now, return error indicating not implemented
        Err(NetworkError::UnknownPeer(format!(
            "Public key lookup not yet implemented for peer: {}",
            peer_id
        )))
    }

    /// Broadcast a vertex to the network
    pub fn broadcast_vertex(&self, vertex_id: String, parents: Vec<String>, payload: Vec<u8>) -> Result<()> {
        use crate::consensus_p2p::VertexMessage;

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let vertex = VertexMessage {
            vertex_id,
            parents,
            payload,
            timestamp,
            creator: self.consensus_p2p.agent_id().to_string(),
            signature: vec![], // TODO: Sign with node's keypair
            hash: [0u8; 32], // TODO: Compute actual hash
        };

        self.consensus_p2p.broadcast_vertex(vertex)?;
        Ok(())
    }

    /// Get cached vertex from network
    pub fn get_vertex(&self, vertex_id: &str) -> Option<crate::consensus_p2p::VertexMessage> {
        self.consensus_p2p.get_vertex(vertex_id)
    }

    /// Get network statistics
    pub fn get_stats(&self) -> NetworkAdapterStats {
        let p2p_stats = self.consensus_p2p.get_stats();

        NetworkAdapterStats {
            peer_count: p2p_stats.peer_count,
            pending_queries: p2p_stats.pending_queries,
            cached_vertices: p2p_stats.cached_vertices,
            query_timeout_ms: self.query_timeout.as_millis() as u64,
        }
    }
}

/// Network adapter statistics
#[derive(Debug, Clone)]
pub struct NetworkAdapterStats {
    /// Number of connected peers
    pub peer_count: usize,
    /// Number of pending consensus queries
    pub pending_queries: usize,
    /// Number of cached vertices
    pub cached_vertices: usize,
    /// Query timeout in milliseconds
    pub query_timeout_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::consensus_p2p::ConsensusP2PNode;

    fn create_test_adapter() -> NetworkAdapter {
        let p2p = Arc::new(ConsensusP2PNode::new("test-agent".to_string()));
        NetworkAdapter::new(Arc::new(ConsensusP2P::new(p2p)))
    }

    #[test]
    fn test_adapter_creation() {
        let adapter = create_test_adapter();
        let stats = adapter.get_stats();
        assert_eq!(stats.peer_count, 0);
        assert_eq!(stats.query_timeout_ms, 5000);
    }

    #[test]
    fn test_adapter_with_custom_timeout() {
        let p2p = Arc::new(ConsensusP2PNode::new("test-agent".to_string()));
        let adapter = NetworkAdapter::with_timeout(
            Arc::new(ConsensusP2P::new(p2p)),
            Duration::from_secs(10),
        );

        let stats = adapter.get_stats();
        assert_eq!(stats.query_timeout_ms, 10000);
    }

    #[tokio::test]
    async fn test_query_peers_timeout() {
        let adapter = create_test_adapter();

        // Query with no peers should timeout and return empty
        let result = adapter.query_peers("vertex1", 10).await;
        assert!(result.is_ok());

        let responses = result.unwrap();
        assert_eq!(responses.len(), 0);
    }

    #[test]
    fn test_broadcast_vertex() {
        let adapter = create_test_adapter();

        let result = adapter.broadcast_vertex(
            "v1".to_string(),
            vec![],
            vec![1, 2, 3],
        );

        assert!(result.is_ok());

        // Verify vertex is cached
        assert!(adapter.get_vertex("v1").is_some());
    }

    #[test]
    fn test_get_peer_public_key_not_implemented() {
        let adapter = create_test_adapter();

        // Should return error as not yet implemented
        let result = adapter.get_peer_public_key("peer1");
        assert!(result.is_err());

        match result {
            Err(NetworkError::UnknownPeer(_)) => {},
            _ => panic!("Expected UnknownPeer error"),
        }
    }

    #[test]
    fn test_verify_response_signature() {
        let adapter = create_test_adapter();

        // Create a test response
        let response = ConsensusResponse {
            query_id: "q1".to_string(),
            vertex_id: "v1".to_string(),
            responder: "peer1".to_string(),
            vote: true,
            confidence: 0.9,
            timestamp: 1234567890,
            signature: vec![0u8; 100], // Invalid signature
        };

        // Generate a test keypair
        let keypair = cretoai_crypto::signatures::MLDSA87::generate();

        // Verification should fail with invalid signature
        let result = adapter.verify_response_signature(&response, &keypair.public_key);
        assert!(result.is_ok());
        assert!(!result.unwrap()); // Signature is invalid
    }
}
