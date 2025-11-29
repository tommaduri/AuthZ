//! Error types for consensus operations

use thiserror::Error;

pub type Result<T> = std::result::Result<T, ConsensusError>;

#[derive(Error, Debug, Clone)]
pub enum ConsensusError {
    #[error("Not the current leader for view {view}")]
    NotLeader { view: u64 },

    #[error("Invalid message signature from node {node_id}")]
    InvalidSignature { node_id: uuid::Uuid },

    #[error("Invalid view number: expected {expected}, got {actual}")]
    InvalidView { expected: u64, actual: u64 },

    #[error("Invalid sequence number: expected {expected}, got {actual}")]
    InvalidSequence { expected: u64, actual: u64 },

    #[error("Quorum not reached: have {current}/{required} signatures")]
    QuorumNotReached { current: usize, required: usize },

    #[error("Byzantine behavior detected: {0}")]
    ByzantineBehavior(String),

    #[error("Equivocation detected from node {node_id}")]
    Equivocation { node_id: uuid::Uuid },

    #[error("Message timeout: sequence {sequence}")]
    MessageTimeout { sequence: u64 },

    #[error("View change in progress")]
    ViewChangeInProgress,

    #[error("Node is banned: {node_id}")]
    NodeBanned { node_id: uuid::Uuid },

    #[error("Storage error: {0}")]
    Storage(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Network error: {0}")]
    Network(String),

    #[error("Internal error: {0}")]
    Internal(String),

    // Phase 7: Weighted Voting errors
    #[error("Invalid stake: {0}")]
    InvalidStake(String),

    #[error("Unknown node: {0}")]
    UnknownNode(uuid::Uuid),

    #[error("Invalid reputation score: {0}")]
    InvalidReputation(f64),

    #[error("Invalid uptime: {0}")]
    InvalidUptime(f64),

    #[error("No stake in network")]
    NoStake,

    #[error("No eligible voters")]
    NoEligibleVoters,

    #[error("Invalid slash percentage: {0}")]
    InvalidSlashPercentage(f64),

    #[error("Configuration error: {0}")]
    Configuration(String),

    // Phase 7: Multi-signature errors
    #[error("Duplicate signature from node {0}")]
    DuplicateSignature(uuid::Uuid),

    #[error("Stale signature")]
    StaleSignature,

    #[error("No signature collection found")]
    NoSignatureCollection,

    #[error("Insufficient signatures: have {have}, need {need}")]
    InsufficientSignatures { have: f64, need: f64 },

    // Phase 7: Fork detection errors
    #[error("Fork not found at sequence {0}")]
    ForkNotFound(u64),

    #[error("Fork already resolved at sequence {0}")]
    ForkAlreadyResolved(u64),

    #[error("Fork resolution timeout at sequence {0}")]
    ForkResolutionTimeout(u64),

    #[error("Fork not resolved at sequence {0}")]
    ForkNotResolved(u64),

    #[error("Empty branch in fork")]
    EmptyBranch,

    #[error("Insufficient consensus: have {have}, need {need}")]
    InsufficientConsensus { have: f64, need: f64 },

    // Prometheus metrics error
    #[error("Prometheus metric error: {0}")]
    Metrics(String),

    // Phase 7: Circuit breaker errors
    #[error("Circuit breaker open for peer: {0}")]
    CircuitOpen(String),

    #[error("Request timeout: {0}")]
    Timeout(String),
}

impl From<bincode::Error> for ConsensusError {
    fn from(e: bincode::Error) -> Self {
        ConsensusError::Serialization(e.to_string())
    }
}

impl From<serde_json::Error> for ConsensusError {
    fn from(e: serde_json::Error) -> Self {
        ConsensusError::Serialization(e.to_string())
    }
}

impl From<prometheus::Error> for ConsensusError {
    fn from(e: prometheus::Error) -> Self {
        ConsensusError::Metrics(e.to_string())
    }
}
