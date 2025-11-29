//! # CretoAI Core
//!
//! Shared types, traits, and error handling for the CretoAI platform.
//! This package breaks circular dependencies between network, dag, and mcp packages.

pub mod types;
pub mod traits;
pub mod error;

// Re-export commonly used types
pub use error::{CoreError, Result};
pub use types::{AgentId, MessageId, PeerId, VertexId};

// Type aliases for authorization engine integration
pub type CretoResult<T> = Result<T>;
pub type TenantId = String;  // Multi-tenancy tenant identifier
pub type UserId = String;    // User identifier for authentication
