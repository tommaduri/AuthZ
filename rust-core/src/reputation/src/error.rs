//! Error types for reputation system

use thiserror::Error;
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum ReputationError {
    #[error("Node not found: {0}")]
    NodeNotFound(Uuid),

    #[error("Invalid reputation score: {0} (must be 0-1)")]
    InvalidScore(f64),

    #[error("Insufficient stake: have {have}, need {need}")]
    InsufficientStake { have: u64, need: u64 },

    #[error("Database error: {0}")]
    Database(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Invalid slashing percentage: {0} (must be 0-1)")]
    InvalidSlashPercentage(f64),

    #[error("Prometheus metric error: {0}")]
    Metrics(#[from] prometheus::Error),

    #[error("Resource not found: {0}")]
    NotFound(String),

    #[error("Invalid operation: {0}")]
    InvalidOperation(String),
}

pub type Result<T> = std::result::Result<T, ReputationError>;
