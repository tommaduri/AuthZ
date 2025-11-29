//! Error types for the MCP module

use thiserror::Error;

pub type Result<T> = std::result::Result<T, McpError>;

#[derive(Debug, Error)]
pub enum McpError {
    #[error("Server error: {0}")]
    Server(String),

    #[error("Tool error: {0}")]
    Tool(String),

    #[error("Resource error: {0}")]
    Resource(String),

    #[error("Context error: {0}")]
    Context(String),

    #[error("Transport error: {0}")]
    Transport(String),

    #[error("Authentication error: {0}")]
    Auth(String),

    #[error("Invalid request: {0}")]
    InvalidRequest(String),

    #[error("Protocol error: {0}")]
    Protocol(String),

    #[error("JSON-RPC error: {0}")]
    JsonRpc(String),

    #[error("Generic MCP error: {0}")]
    Generic(String),
}
