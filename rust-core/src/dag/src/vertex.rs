//! DAG vertex implementation
//!
//! A vertex represents a single transaction or event in the DAG,
//! with cryptographic signatures and parent references.

use crate::error::{DagError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use uuid::Uuid;
use cretoai_crypto::signatures::{MLDSA87, MLDSA87SecretKey};

/// Unique vertex identifier
pub type VertexId = String;

/// Vertex hash (BLAKE3)
pub type VertexHash = [u8; 32];

// Note: cretoai-core defines VertexId as [u8; 32] newtype for cross-package use.
// This package uses String internally for flexibility. Future versions may migrate.

/// Vertex in the DAG
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vertex {
    /// Unique vertex identifier
    pub id: VertexId,

    /// Parent vertex references (typically 2 for DAG structure)
    pub parents: Vec<VertexId>,

    /// Transaction payload (arbitrary bytes)
    pub payload: Vec<u8>,

    /// Timestamp (milliseconds since epoch)
    pub timestamp: u64,

    /// Agent/node that created this vertex
    pub creator: String,

    /// Quantum-resistant signature (ML-DSA)
    pub signature: Vec<u8>,

    /// Vertex hash (BLAKE3 of id + parents + payload + timestamp)
    pub hash: VertexHash,

    /// Consensus metadata
    pub metadata: VertexMetadata,
}

/// Metadata for consensus tracking
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VertexMetadata {
    /// Confidence score (0.0 to 1.0)
    pub confidence: f64,

    /// Number of confirmations from other vertices
    pub confirmations: u32,

    /// Whether this vertex is finalized
    pub finalized: bool,

    /// Round number in consensus
    pub round: u64,

    /// Chit value (used in Avalanche consensus)
    pub chit: bool,
}

impl Vertex {
    /// Create a new vertex
    pub fn new(
        id: VertexId,
        parents: Vec<VertexId>,
        payload: Vec<u8>,
        creator: String,
    ) -> Self {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let hash = Self::compute_hash(&id, &parents, &payload, timestamp);

        Vertex {
            id,
            parents,
            payload,
            timestamp,
            creator,
            signature: Vec::new(), // Will be set by signer
            hash,
            metadata: VertexMetadata::default(),
        }
    }

    /// Compute BLAKE3 hash of vertex content
    pub fn compute_hash(
        id: &str,
        parents: &[VertexId],
        payload: &[u8],
        timestamp: u64,
    ) -> VertexHash {
        use blake3::Hasher;

        let mut hasher = Hasher::new();
        hasher.update(id.as_bytes());

        for parent in parents {
            hasher.update(parent.as_bytes());
        }

        hasher.update(payload);
        hasher.update(&timestamp.to_le_bytes());

        let hash = hasher.finalize();
        *hash.as_bytes()
    }

    /// Sign the vertex with a quantum-resistant signature (sets signature directly)
    pub fn sign(&mut self, signature: Vec<u8>) {
        self.signature = signature;
    }

    /// Sign the vertex with ML-DSA using a secret key
    pub fn sign_with_key(&mut self, secret_key: &MLDSA87SecretKey) {
        let message = &self.hash;
        let signature = MLDSA87::sign(message, secret_key);
        self.signature = signature.as_bytes().to_vec();
    }

    /// Verify the vertex signature
    pub fn verify_signature(&self, public_key: &[u8]) -> Result<()> {
        if self.signature.is_empty() {
            return Err(DagError::InvalidVertex("Missing signature".to_string()));
        }

        // Import ML-DSA types from vigilia-crypto
        use cretoai_crypto::signatures::{MLDSA87, MLDSA87PublicKey, MLDSA87Signature};

        // Parse public key
        let pk = MLDSA87PublicKey::from_bytes(public_key)
            .map_err(|_| DagError::InvalidVertex("Invalid public key".to_string()))?;

        // Parse signature
        let sig = MLDSA87Signature::from_bytes(&self.signature)
            .map_err(|_| DagError::InvalidVertex("Invalid signature".to_string()))?;

        // Compute message to verify (hash of vertex data)
        let message = self.hash;

        // Verify ML-DSA signature
        MLDSA87::verify(&message, &sig, &pk)
            .map_err(|_| DagError::InvalidVertex("Signature verification failed".to_string()))
    }

    /// Verify the vertex hash is correct
    pub fn verify_hash(&self) -> Result<()> {
        let computed = Self::compute_hash(
            &self.id,
            &self.parents,
            &self.payload,
            self.timestamp,
        );

        if computed != self.hash {
            return Err(DagError::InvalidVertex("Hash mismatch".to_string()));
        }

        Ok(())
    }

    /// Get parent set as HashSet for efficient lookups
    pub fn parent_set(&self) -> HashSet<VertexId> {
        self.parents.iter().cloned().collect()
    }

    /// Check if this vertex is a genesis vertex (no parents)
    pub fn is_genesis(&self) -> bool {
        self.parents.is_empty()
    }

    /// Update confidence score
    pub fn update_confidence(&mut self, confidence: f64) {
        self.metadata.confidence = confidence.clamp(0.0, 1.0);
    }

    /// Increment confirmation count
    pub fn add_confirmation(&mut self) {
        self.metadata.confirmations += 1;
    }

    /// Mark as finalized
    pub fn finalize(&mut self) {
        self.metadata.finalized = true;
        self.metadata.confidence = 1.0;
    }

    /// Check if vertex can be finalized based on confidence threshold
    pub fn can_finalize(&self, threshold: f64) -> bool {
        !self.metadata.finalized && self.metadata.confidence >= threshold
    }
}

/// Builder for creating vertices
pub struct VertexBuilder {
    id: Option<VertexId>,
    parents: Vec<VertexId>,
    payload: Vec<u8>,
    creator: String,
}

impl VertexBuilder {
    /// Create a new vertex builder
    pub fn new(creator: String) -> Self {
        VertexBuilder {
            id: None,
            parents: Vec::new(),
            payload: Vec::new(),
            creator,
        }
    }

    /// Set vertex ID (auto-generated if not set)
    pub fn id(mut self, id: VertexId) -> Self {
        self.id = Some(id);
        self
    }

    /// Add a parent vertex
    pub fn parent(mut self, parent: VertexId) -> Self {
        self.parents.push(parent);
        self
    }

    /// Add multiple parent vertices
    pub fn parents(mut self, parents: Vec<VertexId>) -> Self {
        self.parents = parents;
        self
    }

    /// Set payload
    pub fn payload(mut self, payload: Vec<u8>) -> Self {
        self.payload = payload;
        self
    }

    /// Build the vertex
    pub fn build(self) -> Vertex {
        let id = self.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        Vertex::new(id, self.parents, self.payload, self.creator)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vertex_creation() {
        let vertex = Vertex::new(
            "vertex-1".to_string(),
            vec![],
            vec![1, 2, 3],
            "agent-001".to_string(),
        );

        assert_eq!(vertex.id, "vertex-1");
        assert!(vertex.is_genesis());
        assert_eq!(vertex.payload, vec![1, 2, 3]);
    }

    #[test]
    fn test_vertex_hash_verification() {
        let vertex = Vertex::new(
            "vertex-1".to_string(),
            vec![],
            vec![1, 2, 3],
            "agent-001".to_string(),
        );

        assert!(vertex.verify_hash().is_ok());
    }

    #[test]
    fn test_vertex_builder() {
        let vertex = VertexBuilder::new("agent-001".to_string())
            .parent("parent-1".to_string())
            .parent("parent-2".to_string())
            .payload(vec![1, 2, 3])
            .build();

        assert_eq!(vertex.parents.len(), 2);
        assert_eq!(vertex.creator, "agent-001");
    }

    #[test]
    fn test_confidence_update() {
        let mut vertex = Vertex::new(
            "vertex-1".to_string(),
            vec![],
            vec![],
            "agent-001".to_string(),
        );

        vertex.update_confidence(0.8);
        assert_eq!(vertex.metadata.confidence, 0.8);

        vertex.update_confidence(1.5); // Should clamp to 1.0
        assert_eq!(vertex.metadata.confidence, 1.0);
    }

    #[test]
    fn test_finalization() {
        let mut vertex = Vertex::new(
            "vertex-1".to_string(),
            vec![],
            vec![],
            "agent-001".to_string(),
        );

        vertex.update_confidence(0.95);
        assert!(vertex.can_finalize(0.9));

        vertex.finalize();
        assert!(vertex.metadata.finalized);
        assert_eq!(vertex.metadata.confidence, 1.0);
    }
}
