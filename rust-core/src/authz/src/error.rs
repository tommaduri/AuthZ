//! Error types for the authorization engine

use thiserror::Error;

/// Authorization engine errors
#[derive(Debug, Error)]
pub enum AuthzError {
    /// Invalid input
    #[error("Invalid input: {0}")]
    InvalidInput(String),

    /// Policy not found
    #[error("Policy not found: {0}")]
    PolicyNotFound(String),

    /// Invalid policy definition
    #[error("Invalid policy: {0}")]
    InvalidPolicy(String),

    /// Policy evaluation error
    #[error("Policy evaluation failed: {0}")]
    EvaluationError(String),

    /// DAG integration error
    #[error("DAG error: {0}")]
    DagError(#[from] cretoai_dag::error::DagError),

    /// Cryptographic error
    #[error("Crypto error: {0}")]
    CryptoError(String),

    /// Vault storage error
    #[error("Vault error: {0}")]
    VaultError(String),

    /// Cache error
    #[error("Cache error: {0}")]
    CacheError(String),

    /// Database error
    #[error("Database error: {0}")]
    DatabaseError(String),

    /// Internal error
    #[error("Internal error: {0}")]
    Internal(String),

    /// I/O error
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

/// Result type for authorization operations
pub type Result<T> = std::result::Result<T, AuthzError>;
