//! Derived roles module
//!
//! Provides derived role definitions, dependency graph resolution with cycle detection,
//! and a high-performance role resolver with caching.
//!
//! # Features
//!
//! - **Pattern Matching**: Support for wildcards (`*`, `prefix:*`, `*:suffix`)
//! - **Dependency Resolution**: Kahn's algorithm for topological sorting
//! - **Cycle Detection**: DFS-based detection with complete path reporting
//! - **Thread-Safe Caching**: DashMap for lock-free concurrent access
//! - **AND Logic**: All parent roles must match for derived role activation
//!
//! # Example
//!
//! ```rust
//! use cretoai_authz::derived_roles::{DerivedRole, RoleResolver};
//! use std::collections::HashMap;
//!
//! # async fn example() -> Result<(), Box<dyn std::error::Error>> {
//! let mut resolver = RoleResolver::new();
//!
//! // Define derived roles
//! let manager = DerivedRole::new("manager", vec!["employee".to_string()]);
//! let senior = DerivedRole::new("senior_manager", vec!["manager".to_string()]);
//!
//! // Add to resolver
//! resolver.add_derived_roles(vec![manager, senior])?;
//!
//! // Resolve roles for a principal
//! let principal_roles = vec!["employee".to_string()];
//! let resolved = resolver.resolve_roles(&principal_roles, &HashMap::new()).await?;
//!
//! // resolved contains: ["employee", "manager", "senior_manager"]
//! assert!(resolved.contains(&"manager".to_string()));
//! # Ok(())
//! # }
//! ```

pub mod graph;
pub mod types;
pub mod resolver;

#[cfg(test)]
mod tests;

pub use graph::{DependencyGraph, DependencyGraphBuilder, GraphError};
pub use types::DerivedRole;
pub use resolver::{RoleResolver, CacheStats};

// Type aliases for compatibility with integration tests
pub type DerivedRoleResolver = RoleResolver;
