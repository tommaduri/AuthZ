//! Unified error types for the CretoAI platform
//!
//! This module provides a central error type that can be converted from
//! any of the subsystem-specific error types.

use thiserror::Error;

pub type Result<T> = std::result::Result<T, CoreError>;

/// Core error type for the CretoAI platform
#[derive(Debug, Error)]
pub enum CoreError {
    /// Network-related errors
    #[error("Network error: {0}")]
    Network(String),

    /// DAG-related errors
    #[error("DAG error: {0}")]
    Dag(String),

    /// MCP protocol errors
    #[error("MCP error: {0}")]
    Mcp(String),

    /// Cryptographic errors
    #[error("Crypto error: {0}")]
    Crypto(String),

    /// Transport layer errors
    #[error("Transport error: {0}")]
    Transport(String),

    /// Consensus protocol errors
    #[error("Consensus error: {0}")]
    Consensus(String),

    /// Authentication/Authorization errors
    #[error("Auth error: {0}")]
    Auth(String),

    /// Serialization/Deserialization errors
    #[error("Serialization error: {0}")]
    Serialization(String),

    /// Configuration errors
    #[error("Configuration error: {0}")]
    Configuration(String),

    /// Resource not found
    #[error("Not found: {0}")]
    NotFound(String),

    /// Operation timeout
    #[error("Timeout")]
    Timeout,

    /// Invalid input/state
    #[error("Invalid: {0}")]
    Invalid(String),

    /// Operation not implemented
    #[error("Not implemented: {0}")]
    NotImplemented(String),

    /// I/O errors
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// Generic error for uncategorized cases
    #[error("Error: {0}")]
    Generic(String),
}

impl CoreError {
    /// Create a network error
    pub fn network<S: Into<String>>(msg: S) -> Self {
        CoreError::Network(msg.into())
    }

    /// Create a DAG error
    pub fn dag<S: Into<String>>(msg: S) -> Self {
        CoreError::Dag(msg.into())
    }

    /// Create an MCP error
    pub fn mcp<S: Into<String>>(msg: S) -> Self {
        CoreError::Mcp(msg.into())
    }

    /// Create a crypto error
    pub fn crypto<S: Into<String>>(msg: S) -> Self {
        CoreError::Crypto(msg.into())
    }

    /// Create a transport error
    pub fn transport<S: Into<String>>(msg: S) -> Self {
        CoreError::Transport(msg.into())
    }

    /// Create a consensus error
    pub fn consensus<S: Into<String>>(msg: S) -> Self {
        CoreError::Consensus(msg.into())
    }

    /// Create an auth error
    pub fn auth<S: Into<String>>(msg: S) -> Self {
        CoreError::Auth(msg.into())
    }

    /// Create a serialization error
    pub fn serialization<S: Into<String>>(msg: S) -> Self {
        CoreError::Serialization(msg.into())
    }

    /// Create a configuration error
    pub fn configuration<S: Into<String>>(msg: S) -> Self {
        CoreError::Configuration(msg.into())
    }

    /// Create a not found error
    pub fn not_found<S: Into<String>>(msg: S) -> Self {
        CoreError::NotFound(msg.into())
    }

    /// Create an invalid error
    pub fn invalid<S: Into<String>>(msg: S) -> Self {
        CoreError::Invalid(msg.into())
    }

    /// Create a not implemented error
    pub fn not_implemented<S: Into<String>>(msg: S) -> Self {
        CoreError::NotImplemented(msg.into())
    }

    /// Create a generic error
    pub fn generic<S: Into<String>>(msg: S) -> Self {
        CoreError::Generic(msg.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_construction() {
        let err = CoreError::network("test");
        assert!(matches!(err, CoreError::Network(_)));

        let err = CoreError::dag("test");
        assert!(matches!(err, CoreError::Dag(_)));

        let err = CoreError::mcp("test");
        assert!(matches!(err, CoreError::Mcp(_)));
    }

    #[test]
    fn test_error_display() {
        let err = CoreError::network("connection failed");
        assert_eq!(err.to_string(), "Network error: connection failed");

        let err = CoreError::Timeout;
        assert_eq!(err.to_string(), "Timeout");
    }
}
