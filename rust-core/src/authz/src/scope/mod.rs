/// Scope-based policy filtering module
///
/// This module provides hierarchical scope resolution with pattern matching
/// and caching capabilities for efficient policy filtering.
///
/// # Examples
///
/// ```
/// use authz::scope::{Scope, ScopeResolver};
///
/// let resolver = ScopeResolver::new();
/// let scope = Scope::from_str("org:acme:dept:engineering").unwrap();
///
/// assert!(scope.matches("org:acme:*").unwrap());
/// assert!(scope.matches("org:*").unwrap());
/// ```

mod types;
mod resolver;

#[cfg(test)]
mod tests;

pub use types::{Scope, ScopeError, ScopeResult};
pub use resolver::{ScopeResolver, CacheStats};

// Type aliases for future compatibility
pub type ScopeCache = ScopeResolver;
pub type ScopePattern = String;  // Pattern strings for wildcard matching
pub type ResourcePath = String;  // Resource path strings
