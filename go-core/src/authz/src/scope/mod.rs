//! Scope module for hierarchical scope resolution and pattern matching.
//!
//! This module provides efficient scope-based policy filtering with:
//! - Hierarchical scope matching (e.g., `org:acme:dept:eng` matches `org:acme:*`)
//! - Wildcard support at any level
//! - Thread-safe caching using DashMap
//! - Validation and normalization

mod resolver;
mod types;

pub use resolver::{ScopeResolver, ScopeConfig, CacheStats};
pub use types::{Scope, ScopeError};

#[cfg(test)]
mod tests;
