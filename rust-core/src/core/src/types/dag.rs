//! DAG-related types

use serde::{Deserialize, Serialize};
use std::fmt;

/// Unique identifier for a DAG vertex (32-byte hash)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct VertexId(pub [u8; 32]);

impl VertexId {
    /// Create a new vertex ID from bytes
    pub fn new(bytes: [u8; 32]) -> Self {
        VertexId(bytes)
    }

    /// Create a vertex ID from a slice
    pub fn from_slice(slice: &[u8]) -> Result<Self, crate::error::CoreError> {
        if slice.len() != 32 {
            return Err(crate::error::CoreError::invalid(
                "VertexId must be 32 bytes",
            ));
        }
        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(slice);
        Ok(VertexId(bytes))
    }

    /// Get the vertex ID as bytes
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// Convert to hex string
    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }
}

impl fmt::Display for VertexId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", &self.to_hex()[..8])
    }
}

/// Hash of vertex content (32-byte BLAKE3 hash)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct VertexHash(pub [u8; 32]);

impl VertexHash {
    /// Create a new vertex hash
    pub fn new(bytes: [u8; 32]) -> Self {
        VertexHash(bytes)
    }

    /// Compute hash from data
    pub fn from_data(data: &[u8]) -> Self {
        let hash = blake3::hash(data);
        VertexHash(*hash.as_bytes())
    }

    /// Get the hash as bytes
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// Convert to hex string
    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }
}

impl fmt::Display for VertexHash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", &self.to_hex()[..8])
    }
}

/// Consensus state for a vertex
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConsensusState {
    /// Vertex is pending consensus
    Pending,
    /// Vertex is being queried
    Querying,
    /// Vertex has reached preferred status
    Preferred,
    /// Vertex has been finalized
    Finalized,
    /// Vertex was rejected
    Rejected,
}

impl ConsensusState {
    /// Check if vertex is finalized
    pub fn is_finalized(&self) -> bool {
        matches!(self, ConsensusState::Finalized)
    }

    /// Check if vertex is rejected
    pub fn is_rejected(&self) -> bool {
        matches!(self, ConsensusState::Rejected)
    }

    /// Check if vertex is decided (finalized or rejected)
    pub fn is_decided(&self) -> bool {
        self.is_finalized() || self.is_rejected()
    }
}

impl fmt::Display for ConsensusState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConsensusState::Pending => write!(f, "Pending"),
            ConsensusState::Querying => write!(f, "Querying"),
            ConsensusState::Preferred => write!(f, "Preferred"),
            ConsensusState::Finalized => write!(f, "Finalized"),
            ConsensusState::Rejected => write!(f, "Rejected"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vertex_id() {
        let bytes = [1u8; 32];
        let id = VertexId::new(bytes);
        assert_eq!(id.as_bytes(), &bytes);
    }

    #[test]
    fn test_vertex_id_from_slice() {
        let bytes = [2u8; 32];
        let id = VertexId::from_slice(&bytes).unwrap();
        assert_eq!(id.as_bytes(), &bytes);

        let invalid = [3u8; 16];
        assert!(VertexId::from_slice(&invalid).is_err());
    }

    #[test]
    fn test_vertex_hash() {
        let data = b"test data";
        let hash = VertexHash::from_data(data);
        assert_eq!(hash.as_bytes().len(), 32);
    }

    #[test]
    fn test_consensus_state() {
        let state = ConsensusState::Pending;
        assert!(!state.is_finalized());
        assert!(!state.is_decided());

        let state = ConsensusState::Finalized;
        assert!(state.is_finalized());
        assert!(state.is_decided());

        let state = ConsensusState::Rejected;
        assert!(state.is_rejected());
        assert!(state.is_decided());
    }
}
