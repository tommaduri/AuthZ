//! Shared types for the CretoAI platform

pub mod network;
pub mod dag;
pub mod mcp;
pub mod crypto;

// Re-export commonly used types
pub use network::{ConnectionInfo, NetworkMessage, PeerId};
pub use dag::{ConsensusState, VertexHash, VertexId};
pub use mcp::{AgentId, AgentInfo, McpMessage, MessageId, ToolDefinition};
pub use crypto::{PublicKey, Signature, SignedMessage};
