//! # Vigilia AI MCP Module
//!
//! This module implements the Model Context Protocol (MCP) server for AI agent integration.
//!
//! ## Features
//!
//! - **MCP Server**: Standards-compliant MCP server implementation
//! - **Tool Registration**: Dynamic tool registration and discovery
//! - **Resource Management**: Expose Vigilia AI resources via MCP
//! - **Context Handling**: Maintain conversation context and state
//! - **WebSocket Support**: Real-time bidirectional communication
//! - **Authentication**: Secure API key and token-based auth
//!
//! ## Module Structure
//!
//! ```text
//! mcp/
//! ├── server/        - MCP server implementation
//! ├── tools/         - Vigilia AI tool definitions
//! ├── resources/     - Resource exposure layer
//! ├── context/       - Context management
//! ├── transport/     - WebSocket and HTTP transport
//! └── auth/         - Authentication and authorization
//! ```

// Core modules
pub mod error;
pub mod protocol;
pub mod codec;

// Server components
pub mod server;
pub mod registry;
pub mod security;
pub mod authorization;
pub mod encryption;
pub mod byzantine;
pub mod connection;
pub mod adapters;

// Tool and context management
pub mod tools;
pub mod context;
pub mod executor;

// Legacy modules (to be integrated)
pub mod auth;
pub mod resources;
pub mod transport;

// TDD Test Infrastructure (London School)
pub mod mocks;

// Re-exports for convenience
pub use error::{McpError, Result};
pub use protocol::{McpMessage, MCP_PROTOCOL_VERSION};
pub use codec::{MessageCodec, CodecFormat};
pub use server::{McpServer, McpServerConfig};
pub use registry::{AgentRegistry, AgentInfo, AgentStatus};
pub use security::{SecurityLayer, SignedMessage};
pub use authorization::{AuthorizationManager, AgentPolicy, Capability};
pub use encryption::{EncryptionLayer, EncryptedMessage};
pub use byzantine::{ByzantineDetector, ByzantineFault, ReputationScore};
pub use connection::{ConnectionPool, Connection};
pub use tools::{ToolRouter, ToolDefinition, Tool, ToolResult};
pub use context::{ContextManager, ContextEntry, ContextSnapshot};
pub use executor::{PromptExecutor, PromptRequest, PromptResult};
pub use adapters::{QuicTransportAdapter, QuicConnection};

#[cfg(feature = "dag-integration")]
pub use adapters::DagConsensusAdapter;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod tests_security;
