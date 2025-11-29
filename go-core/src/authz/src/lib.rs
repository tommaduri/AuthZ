//! # Authorization Engine (authz)
//!
//! Production-ready authorization engine with support for:
//! - Scoped access control
//! - Derived roles with conditional logic
//! - CEL expression evaluation
//! - Wildcard pattern matching
//! - Circular dependency detection
//! - Thread-safe concurrent access
//!
//! ## Example
//!
//! ```rust,no_run
//! use authz::derived_roles::{DerivedRole, DerivedRoleResolver};
//!
//! # async fn example() -> Result<(), Box<dyn std::error::Error>> {
//! let resolver = DerivedRoleResolver::new();
//!
//! let role = DerivedRole::new(
//!     "document_approver".to_string(),
//!     vec!["manager".to_string(), "senior:*".to_string()],
//!     None,
//! );
//!
//! resolver.add_role(role)?;
//!
//! let principal_roles = vec!["manager".to_string(), "senior:engineer".to_string()];
//! let derived = resolver.resolve_roles(&principal_roles, None).await?;
//! # Ok(())
//! # }
//! ```

pub mod scope;
pub mod derived_roles;
pub mod error;

pub use scope::{Scope, ScopeResolver, ScopeConfig, ScopeError, CacheStats};
pub use error::{AuthzError, Result};
