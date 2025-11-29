// Vigilia - Multi-Agent Coordination Platform
// Main library entry point

pub mod mcp;

// Re-export commonly used types
pub use mcp::mocks::{
    MockQuicTransport, MockConsensusNode, MockAgentRegistry,
    MockToolRouter, MockContextStore, AgentMetadata,
};
