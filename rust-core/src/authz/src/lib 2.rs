//! # CretoAI Authorization Engine
//!
//! Quantum-resistant authorization engine with DAG-based audit trails.
//!
//! ## Features
//!
//! - **Zero-copy integration** with Creto-AI platform (no FFI overhead)
//! - **Async-first design** using Tokio runtime
//! - **Policy evaluation** with CEL (Common Expression Language)
//! - **DAG-based audit trail** for authorization decisions
//! - **Quantum-resistant signatures** using ML-DSA-87
//! - **LRU caching** for policy evaluation results
//! - **WASM support** for browser-based authorization
//!
//! ## Example
//!
//! ```rust
//! use cretoai_authz::{AuthzEngine, AuthzRequest, Principal, Resource, Action};
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     let engine = AuthzEngine::new().await?;
//!
//!     let request = AuthzRequest {
//!         principal: Principal::new("user:alice@example.com"),
//!         resource: Resource::new("document:secret-doc-123"),
//!         action: Action::new("read"),
//!         context: Default::default(),
//!     };
//!
//!     let decision = engine.check(&request).await?;
//!
//!     if decision.allowed {
//!         println!("Access granted!");
//!     }
//!
//!     Ok(())
//! }
//! ```

pub mod types;
pub mod engine;
pub mod policy;
pub mod audit;
pub mod cache;
pub mod error;
pub mod cel;  // CEL expression engine
pub mod derived_roles;
pub mod scope;  // Hierarchical scope resolver

// Re-export commonly used types
pub use types::{
    Principal, Resource, Action, AuthzRequest, Decision,
    PolicyId, RoleId, PermissionId
};
pub use engine::AuthzEngine;
pub use policy::{Policy, PolicyStore, PolicyEffect};
pub use error::{AuthzError, Result};
pub use scope::{Scope, ScopeResolver, ScopeError, CacheStats};

/// Library version
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
