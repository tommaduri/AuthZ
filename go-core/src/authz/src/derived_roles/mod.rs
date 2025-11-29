//! # Derived Roles Module
//!
//! Provides dynamic role assignment based on:
//! - Parent role matching (with wildcard support)
//! - CEL condition evaluation
//! - Topological sorting for dependency resolution
//! - Thread-safe concurrent access
//!
//! ## Features
//!
//! - **Wildcard Patterns**: `*`, `prefix:*`, `*:suffix`
//! - **AND Logic**: ALL parent roles must match
//! - **Circular Detection**: Kahn's algorithm for cycle detection
//! - **CEL Integration**: Runtime condition evaluation
//! - **Thread-Safe**: Concurrent read/write access via DashMap
//!
//! ## Example
//!
//! ```rust,no_run
//! use authz::derived_roles::{DerivedRole, DerivedRoleResolver};
//!
//! # async fn example() -> Result<(), Box<dyn std::error::Error>> {
//! let resolver = DerivedRoleResolver::new();
//!
//! // Create a derived role
//! let role = DerivedRole::new(
//!     "document_approver".to_string(),
//!     vec!["manager".to_string(), "department:*".to_string()],
//!     Some("P.attr.tenure_years > 2".to_string()),
//! );
//!
//! resolver.add_role(role)?;
//!
//! // Resolve roles for a principal
//! let principal_roles = vec!["manager".to_string(), "department:finance".to_string()];
//! let derived = resolver.resolve_roles(&principal_roles, None).await?;
//! # Ok(())
//! # }
//! ```

pub mod pattern;
pub mod resolver;
pub mod types;
pub mod graph;
// Temporarily commented out - integration with other modules needed
// pub mod tests;

pub use pattern::matches_pattern;
pub use resolver::DerivedRoleResolver;
pub use types::{DerivedRole, RoleGraphNode};
pub use graph::RoleGraph;

#[cfg(test)]
mod module_tests {
    use super::*;

    #[test]
    fn test_module_exports() {
        // Verify all public exports are accessible
        let _role = DerivedRole::new(
            "test".to_string(),
            vec!["parent".to_string()],
            None,
        );
        let _resolver = DerivedRoleResolver::new();
        let _node = RoleGraphNode::new("test".to_string());
    }
}
