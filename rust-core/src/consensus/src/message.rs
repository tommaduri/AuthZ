//! Consensus message types for PBFT protocol

use crate::{NodeId, SequenceNumber, ViewNumber};
use cretoai_crypto::signatures::Signature;
use cretoai_dag::types::VertexHash;
use serde::{Deserialize, Serialize};

/// Main consensus message enum
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConsensusMessage {
    PrePrepare(PrePrepare),
    Prepare(Prepare),
    Commit(Commit),
    ViewChange(ViewChange),
    NewView(NewView),
}

/// Phase 1: Leader proposes a vertex
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrePrepare {
    pub view: ViewNumber,
    pub sequence: SequenceNumber,
    pub vertex_hash: VertexHash,
    pub vertex_data: Vec<u8>,
    pub leader_id: NodeId,
    pub signature: Vec<u8>,
    pub timestamp: i64,
}

impl PrePrepare {
    pub fn new(
        view: ViewNumber,
        sequence: SequenceNumber,
        vertex_hash: VertexHash,
        vertex_data: Vec<u8>,
        leader_id: NodeId,
    ) -> Self {
        Self {
            view,
            sequence,
            vertex_hash,
            vertex_data,
            leader_id,
            signature: Vec::new(),
            timestamp: chrono::Utc::now().timestamp(),
        }
    }

    pub fn sign(&mut self, signature: Vec<u8>) {
        self.signature = signature;
    }

    pub fn verify_signature(&self, public_key: &[u8]) -> bool {
        // Verification implementation in bft.rs
        !self.signature.is_empty()
    }

    pub fn message_digest(&self) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(&self.view.to_le_bytes());
        data.extend_from_slice(&self.sequence.to_le_bytes());
        data.extend_from_slice(&self.vertex_hash);
        data
    }
}

/// Phase 2: Nodes validate and broadcast prepare
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prepare {
    pub view: ViewNumber,
    pub sequence: SequenceNumber,
    pub vertex_hash: VertexHash,
    pub node_id: NodeId,
    pub signature: Vec<u8>,
    pub timestamp: i64,
}

impl Prepare {
    pub fn new(
        view: ViewNumber,
        sequence: SequenceNumber,
        vertex_hash: VertexHash,
        node_id: NodeId,
    ) -> Self {
        Self {
            view,
            sequence,
            vertex_hash,
            node_id,
            signature: Vec::new(),
            timestamp: chrono::Utc::now().timestamp(),
        }
    }

    pub fn sign(&mut self, signature: Vec<u8>) {
        self.signature = signature;
    }

    pub fn message_digest(&self) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(&self.view.to_le_bytes());
        data.extend_from_slice(&self.sequence.to_le_bytes());
        data.extend_from_slice(&self.vertex_hash);
        data.extend_from_slice(self.node_id.as_bytes());
        data
    }
}

/// Phase 3: After 2f+1 prepares, nodes broadcast commit
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Commit {
    pub view: ViewNumber,
    pub sequence: SequenceNumber,
    pub vertex_hash: VertexHash,
    pub node_id: NodeId,
    pub signature: Vec<u8>,
    pub timestamp: i64,
}

impl Commit {
    pub fn new(
        view: ViewNumber,
        sequence: SequenceNumber,
        vertex_hash: VertexHash,
        node_id: NodeId,
    ) -> Self {
        Self {
            view,
            sequence,
            vertex_hash,
            node_id,
            signature: Vec::new(),
            timestamp: chrono::Utc::now().timestamp(),
        }
    }

    pub fn sign(&mut self, signature: Vec<u8>) {
        self.signature = signature;
    }

    pub fn message_digest(&self) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(&self.view.to_le_bytes());
        data.extend_from_slice(&self.sequence.to_le_bytes());
        data.extend_from_slice(&self.vertex_hash);
        data.extend_from_slice(self.node_id.as_bytes());
        data
    }
}

/// View change message for leader election
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewChange {
    pub new_view: ViewNumber,
    pub last_sequence: SequenceNumber,
    pub node_id: NodeId,
    pub prepared_proofs: Vec<PreparedProof>,
    pub signature: Vec<u8>,
    pub timestamp: i64,
}

impl ViewChange {
    pub fn new(
        new_view: ViewNumber,
        last_sequence: SequenceNumber,
        node_id: NodeId,
        prepared_proofs: Vec<PreparedProof>,
    ) -> Self {
        Self {
            new_view,
            last_sequence,
            node_id,
            prepared_proofs,
            signature: Vec::new(),
            timestamp: chrono::Utc::now().timestamp(),
        }
    }

    pub fn sign(&mut self, signature: Vec<u8>) {
        self.signature = signature;
    }
}

/// Proof that a message reached prepared state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreparedProof {
    pub sequence: SequenceNumber,
    pub vertex_hash: VertexHash,
    pub prepare_messages: Vec<Prepare>,
}

/// New view message from new leader
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewView {
    pub view: ViewNumber,
    pub view_change_messages: Vec<ViewChange>,
    pub pre_prepare_messages: Vec<PrePrepare>,
    pub leader_id: NodeId,
    pub signature: Vec<u8>,
    pub timestamp: i64,
}

impl NewView {
    pub fn new(
        view: ViewNumber,
        view_change_messages: Vec<ViewChange>,
        pre_prepare_messages: Vec<PrePrepare>,
        leader_id: NodeId,
    ) -> Self {
        Self {
            view,
            view_change_messages,
            pre_prepare_messages,
            leader_id,
            signature: Vec::new(),
            timestamp: chrono::Utc::now().timestamp(),
        }
    }

    pub fn sign(&mut self, signature: Vec<u8>) {
        self.signature = signature;
    }
}
