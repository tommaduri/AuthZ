//! Vertex propagation over QUIC transport
//!
//! Handles broadcasting vertices to network peers via QUIC,
//! with deduplication and validation.

use super::protocol::{VertexProposal, VertexId};
use crate::error::{NetworkError, Result};
// TODO Phase 7: Use QUIC implementation when experimental-quic feature is complete
// For now, this module serves as documentation of intended architecture
// use crate::quic_transport::QuicTransport;
use std::collections::HashSet;
use std::sync::{Arc, RwLock};
use tracing::{debug, info, warn};

/// Vertex propagator configuration
#[derive(Debug, Clone)]
pub struct PropagatorConfig {
    /// Maximum cache size for seen vertices
    pub max_cache_size: usize,

    /// Whether to validate vertices before propagation
    pub validate_before_propagate: bool,
}

impl Default for PropagatorConfig {
    fn default() -> Self {
        Self {
            max_cache_size: 10000,
            validate_before_propagate: true,
        }
    }
}

/// Vertex propagator
pub struct VertexPropagator {
    /// QUIC transport
    transport: Arc<QuicTransport>,

    /// Configuration
    config: PropagatorConfig,

    /// Cache of seen vertex IDs (for deduplication)
    seen_vertices: Arc<RwLock<HashSet<VertexId>>>,

    /// Peer public keys for validation
    peer_keys: Arc<RwLock<std::collections::HashMap<String, Vec<u8>>>>,
}

impl VertexPropagator {
    /// Create a new vertex propagator
    pub fn new(transport: Arc<QuicTransport>, config: PropagatorConfig) -> Self {
        Self {
            transport,
            config,
            seen_vertices: Arc::new(RwLock::new(HashSet::new())),
            peer_keys: Arc::new(RwLock::new(std::collections::HashMap::new())),
        }
    }

    /// Broadcast a vertex to all connected peers
    pub async fn broadcast(&self, vertex: VertexProposal) -> Result<()> {
        // Check if already seen (deduplication)
        if self.is_seen(&vertex.vertex_id) {
            debug!("Vertex {} already seen, skipping broadcast", vertex.vertex_id);
            return Ok(());
        }

        // Validate vertex if enabled
        if self.config.validate_before_propagate {
            self.validate_vertex(&vertex)?;
        }

        // Mark as seen
        self.mark_seen(vertex.vertex_id.clone());

        // Serialize vertex
        let data = bincode::serialize(&vertex)
            .map_err(|e| NetworkError::Serialization(e.to_string()))?;

        // Broadcast via QUIC to all peers
        // TODO: Implement actual QUIC broadcast when transport API is ready
        info!("Broadcasting vertex {} to network", vertex.vertex_id);

        Ok(())
    }

    /// Validate a vertex before propagation
    fn validate_vertex(&self, vertex: &VertexProposal) -> Result<()> {
        // Verify hash
        let computed_hash = VertexProposal::compute_hash(
            &vertex.vertex_id,
            &vertex.parents,
            &vertex.payload,
            vertex.timestamp,
        );

        if computed_hash != vertex.hash {
            return Err(NetworkError::Consensus(
                format!("Invalid vertex hash for {}", vertex.vertex_id)
            ));
        }

        // Verify signature if we have the creator's public key
        if let Some(public_key) = self.get_peer_key(&vertex.creator) {
            vertex.verify(&public_key)
                .map_err(|e| NetworkError::InvalidSignature(e))?;
        } else {
            warn!("No public key for creator {}, skipping signature verification", vertex.creator);
        }

        Ok(())
    }

    /// Check if vertex was already seen
    fn is_seen(&self, vertex_id: &VertexId) -> bool {
        let seen = self.seen_vertices.read().unwrap();
        seen.contains(vertex_id)
    }

    /// Mark vertex as seen
    fn mark_seen(&self, vertex_id: VertexId) {
        let mut seen = self.seen_vertices.write().unwrap();

        // Check cache size limit
        if seen.len() >= self.config.max_cache_size {
            // Simple eviction: clear oldest half
            let to_keep: HashSet<_> = seen.iter()
                .skip(seen.len() / 2)
                .cloned()
                .collect();
            *seen = to_keep;
        }

        seen.insert(vertex_id);
    }

    /// Register a peer's public key
    pub fn register_peer_key(&self, peer_id: String, public_key: Vec<u8>) {
        let mut keys = self.peer_keys.write().unwrap();
        keys.insert(peer_id, public_key);
    }

    /// Get a peer's public key
    fn get_peer_key(&self, peer_id: &str) -> Option<Vec<u8>> {
        let keys = self.peer_keys.read().unwrap();
        keys.get(peer_id).cloned()
    }

    /// Clear the seen vertices cache
    pub fn clear_cache(&self) {
        let mut seen = self.seen_vertices.write().unwrap();
        seen.clear();
    }

    /// Get cache size
    pub fn cache_size(&self) -> usize {
        let seen = self.seen_vertices.read().unwrap();
        seen.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cretoai_crypto::keys::AgentIdentity;

    fn create_mock_transport() -> Arc<QuicTransport> {
        let identity = Arc::new(AgentIdentity::generate("test-propagator-agent".to_string()).unwrap());
        let config = crate::libp2p::quic::QuicTransportConfig::default();
        Arc::new(QuicTransport::new(identity, config).unwrap())
    }

    #[test]
    fn test_propagator_creation() {
        let transport = create_mock_transport();
        let config = PropagatorConfig::default();
        let propagator = VertexPropagator::new(transport, config);

        assert_eq!(propagator.cache_size(), 0);
    }

    #[test]
    fn test_deduplication() {
        let transport = create_mock_transport();
        let config = PropagatorConfig::default();
        let propagator = VertexPropagator::new(transport, config);

        let vertex_id = "vertex-1".to_string();

        assert!(!propagator.is_seen(&vertex_id));
        propagator.mark_seen(vertex_id.clone());
        assert!(propagator.is_seen(&vertex_id));
    }

    #[test]
    fn test_cache_eviction() {
        let transport = create_mock_transport();
        let config = PropagatorConfig {
            max_cache_size: 10,
            validate_before_propagate: false,
        };
        let propagator = VertexPropagator::new(transport, config);

        // Fill cache beyond limit
        for i in 0..15 {
            propagator.mark_seen(format!("vertex-{}", i));
        }

        // Should have evicted some entries
        assert!(propagator.cache_size() < 15);
    }

    #[test]
    fn test_peer_key_registration() {
        let transport = create_mock_transport();
        let config = PropagatorConfig::default();
        let propagator = VertexPropagator::new(transport, config);

        let peer_id = "peer-1".to_string();
        let public_key = vec![1, 2, 3, 4];

        propagator.register_peer_key(peer_id.clone(), public_key.clone());
        assert_eq!(propagator.get_peer_key(&peer_id), Some(public_key));
    }
}
