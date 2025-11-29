//! Role resolver with caching and dependency resolution
//!
//! This module provides the `RoleResolver` for resolving derived roles
//! based on principal roles and CEL conditions. It uses:
//!
//! - **DependencyGraph**: For topological ordering of derived roles
//! - **DashMap**: For thread-safe, lock-free caching
//! - **Pattern matching**: For wildcard role matching
//!
//! # Example
//!
//! ```rust
//! use cretoai_authz::derived_roles::{DerivedRole, RoleResolver};
//!
//! # async fn example() -> Result<(), Box<dyn std::error::Error>> {
//! let mut resolver = RoleResolver::new();
//!
//! // Add derived roles
//! let manager = DerivedRole::new("manager", vec!["employee".to_string()]);
//! let senior = DerivedRole::new("senior_manager", vec!["manager".to_string()]);
//!
//! resolver.add_derived_role(manager)?;
//! resolver.add_derived_role(senior)?;
//!
//! // Resolve roles for a principal
//! let principal_roles = vec!["employee".to_string()];
//! let resolved = resolver.resolve_roles(&principal_roles, &Default::default()).await?;
//!
//! // resolved includes: ["employee", "manager"]
//! # Ok(())
//! # }
//! ```

use super::graph::{DependencyGraphBuilder, GraphError};
use super::types::DerivedRole;
use crate::error::{AuthzError, Result};
use dashmap::DashMap;
use std::collections::HashMap;
use std::sync::Arc;

/// Cache key for role resolution
#[derive(Debug, Clone, Hash, Eq, PartialEq)]
struct CacheKey {
    /// Sorted principal roles for consistent hashing
    principal_roles: Vec<String>,
    /// Optional context hash (for CEL conditions)
    context_hash: u64,
}

impl CacheKey {
    fn new(mut principal_roles: Vec<String>, context: &HashMap<String, serde_json::Value>) -> Self {
        // Sort for consistent hashing
        principal_roles.sort();

        // Hash context for cache key
        let context_hash = Self::hash_context(context);

        Self {
            principal_roles,
            context_hash,
        }
    }

    fn hash_context(context: &HashMap<String, serde_json::Value>) -> u64 {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();

        // Sort keys for consistent hashing
        let mut keys: Vec<_> = context.keys().collect();
        keys.sort();

        for key in keys {
            key.hash(&mut hasher);
            if let Some(value) = context.get(key) {
                // Hash the JSON string representation
                value.to_string().hash(&mut hasher);
            }
        }

        hasher.finish()
    }
}

/// Cached resolution result
#[derive(Debug, Clone)]
struct CachedResult {
    /// Resolved roles (including principal roles and derived roles)
    roles: Vec<String>,
    /// Cache timestamp for TTL
    cached_at: std::time::Instant,
}

impl CachedResult {
    fn new(roles: Vec<String>) -> Self {
        Self {
            roles,
            cached_at: std::time::Instant::now(),
        }
    }

    fn is_expired(&self, ttl: std::time::Duration) -> bool {
        self.cached_at.elapsed() > ttl
    }
}

/// Role resolver with caching and dependency resolution
///
/// The resolver:
/// 1. Builds a dependency graph from derived roles
/// 2. Resolves roles in topological order
/// 3. Caches resolution results for performance
/// 4. Supports CEL condition evaluation (future)
///
/// # Thread Safety
///
/// The resolver is thread-safe and can be shared across threads using `Arc`.
/// It uses `DashMap` for lock-free concurrent access to the cache.
#[derive(Clone)]
pub struct RoleResolver {
    /// Derived role definitions
    derived_roles: Arc<Vec<DerivedRole>>,

    /// Topologically sorted role names for evaluation order
    evaluation_order: Arc<Vec<String>>,

    /// Cache of resolved roles (principal_roles -> resolved_roles)
    cache: Arc<DashMap<CacheKey, CachedResult>>,

    /// Cache TTL (time-to-live)
    cache_ttl: std::time::Duration,

    /// Maximum cache size
    max_cache_size: usize,
}

impl RoleResolver {
    /// Create a new role resolver with default settings
    ///
    /// Default cache TTL: 60 seconds
    /// Default max cache size: 10,000 entries
    pub fn new() -> Self {
        Self {
            derived_roles: Arc::new(Vec::new()),
            evaluation_order: Arc::new(Vec::new()),
            cache: Arc::new(DashMap::new()),
            cache_ttl: std::time::Duration::from_secs(60),
            max_cache_size: 10_000,
        }
    }

    /// Create a new role resolver with custom cache settings
    pub fn with_cache_settings(cache_ttl: std::time::Duration, max_cache_size: usize) -> Self {
        Self {
            derived_roles: Arc::new(Vec::new()),
            evaluation_order: Arc::new(Vec::new()),
            cache: Arc::new(DashMap::new()),
            cache_ttl,
            max_cache_size,
        }
    }

    /// Add a derived role to the resolver
    ///
    /// This rebuilds the dependency graph and invalidates the cache.
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - The role is invalid
    /// - The role creates a circular dependency
    /// - The role name is duplicated
    pub fn add_derived_role(&mut self, role: DerivedRole) -> Result<()> {
        // Validate the role
        role.validate()?;

        // Add to the list of derived roles
        let mut roles = (*self.derived_roles).clone();
        roles.push(role);

        // Rebuild the dependency graph
        let evaluation_order = Self::build_evaluation_order(&roles)?;

        // Update the resolver
        self.derived_roles = Arc::new(roles);
        self.evaluation_order = Arc::new(evaluation_order);

        // Invalidate the cache
        self.invalidate_cache();

        Ok(())
    }

    /// Add multiple derived roles at once
    ///
    /// This is more efficient than adding roles one by one, as it only
    /// rebuilds the dependency graph once.
    pub fn add_derived_roles(&mut self, roles: Vec<DerivedRole>) -> Result<()> {
        // Validate all roles first
        for role in &roles {
            role.validate()?;
        }

        // Add to the list of derived roles
        let mut all_roles = (*self.derived_roles).clone();
        all_roles.extend(roles);

        // Rebuild the dependency graph
        let evaluation_order = Self::build_evaluation_order(&all_roles)?;

        // Update the resolver
        self.derived_roles = Arc::new(all_roles);
        self.evaluation_order = Arc::new(evaluation_order);

        // Invalidate the cache
        self.invalidate_cache();

        Ok(())
    }

    /// Build the evaluation order from derived roles using the dependency graph
    fn build_evaluation_order(roles: &[DerivedRole]) -> Result<Vec<String>> {
        if roles.is_empty() {
            return Ok(Vec::new());
        }

        let mut builder = DependencyGraphBuilder::new();

        for role in roles {
            builder.add_role(role.clone())
                .map_err(|e| match e {
                    GraphError::CircularDependency(msg) => AuthzError::InvalidPolicy(
                        format!("Circular dependency in derived roles: {}", msg)
                    ),
                    GraphError::DuplicateRole(name) => AuthzError::InvalidPolicy(
                        format!("Duplicate derived role: {}", name)
                    ),
                    GraphError::InvalidRole(msg) => AuthzError::InvalidPolicy(msg),
                })?;
        }

        let graph = builder.build()
            .map_err(|e| match e {
                GraphError::CircularDependency(msg) => AuthzError::InvalidPolicy(
                    format!("Circular dependency in derived roles: {}", msg)
                ),
                GraphError::DuplicateRole(name) => AuthzError::InvalidPolicy(
                    format!("Duplicate derived role: {}", name)
                ),
                GraphError::InvalidRole(msg) => AuthzError::InvalidPolicy(msg),
            })?;

        graph.resolve_order()
            .map_err(|e| match e {
                GraphError::CircularDependency(msg) => AuthzError::InvalidPolicy(
                    format!("Circular dependency in derived roles: {}", msg)
                ),
                GraphError::DuplicateRole(name) => AuthzError::InvalidPolicy(
                    format!("Duplicate derived role: {}", name)
                ),
                GraphError::InvalidRole(msg) => AuthzError::InvalidPolicy(msg),
            })
    }

    /// Resolve roles for a principal
    ///
    /// This method:
    /// 1. Checks the cache for a previous result
    /// 2. Evaluates derived roles in topological order
    /// 3. Returns all matched roles (principal roles + derived roles)
    /// 4. Caches the result for future requests
    ///
    /// # Arguments
    ///
    /// * `principal_roles` - The principal's base roles
    /// * `context` - Additional context for CEL condition evaluation
    ///
    /// # Returns
    ///
    /// A vector of all roles (base + derived) that the principal has.
    pub async fn resolve_roles(
        &self,
        principal_roles: &[String],
        context: &HashMap<String, serde_json::Value>,
    ) -> Result<Vec<String>> {
        // Create cache key
        let cache_key = CacheKey::new(principal_roles.to_vec(), context);

        // Check cache first
        if let Some(cached) = self.cache.get(&cache_key) {
            if !cached.is_expired(self.cache_ttl) {
                return Ok(cached.roles.clone());
            }
            // Expired - remove from cache
            drop(cached);
            self.cache.remove(&cache_key);
        }

        // Resolve roles
        let resolved = self.resolve_roles_uncached(principal_roles, context).await?;

        // Cache the result (if cache not full)
        if self.cache.len() < self.max_cache_size {
            self.cache.insert(cache_key, CachedResult::new(resolved.clone()));
        }

        Ok(resolved)
    }

    /// Resolve roles without caching (internal method)
    async fn resolve_roles_uncached(
        &self,
        principal_roles: &[String],
        _context: &HashMap<String, serde_json::Value>,
    ) -> Result<Vec<String>> {
        // Start with the principal's base roles
        let mut current_roles: Vec<String> = principal_roles.to_vec();

        // Evaluate derived roles in topological order
        for role_name in self.evaluation_order.iter() {
            // Find the derived role definition
            if let Some(derived_role) = self.derived_roles.iter().find(|r| &r.name == role_name) {
                // Check if the principal matches this derived role
                if derived_role.matches(&current_roles) {
                    // TODO: Evaluate CEL condition if present
                    // For now, if pattern matches, add the derived role

                    // Add the derived role to the current set
                    if !current_roles.contains(&derived_role.name) {
                        current_roles.push(derived_role.name.clone());
                    }
                }
            }
        }

        Ok(current_roles)
    }

    /// Invalidate the entire cache
    ///
    /// This should be called when derived roles are added or modified.
    pub fn invalidate_cache(&self) {
        self.cache.clear();
    }

    /// Get cache statistics
    pub fn cache_stats(&self) -> CacheStats {
        CacheStats {
            size: self.cache.len(),
            max_size: self.max_cache_size,
            ttl_seconds: self.cache_ttl.as_secs(),
        }
    }

    /// Get the number of derived roles
    pub fn role_count(&self) -> usize {
        self.derived_roles.len()
    }

    /// Get all derived role names
    pub fn role_names(&self) -> Vec<String> {
        self.derived_roles.iter().map(|r| r.name.clone()).collect()
    }

    /// Clear all derived roles and cache
    pub fn clear(&mut self) {
        self.derived_roles = Arc::new(Vec::new());
        self.evaluation_order = Arc::new(Vec::new());
        self.invalidate_cache();
    }
}

impl Default for RoleResolver {
    fn default() -> Self {
        Self::new()
    }
}

/// Cache statistics
#[derive(Debug, Clone)]
pub struct CacheStats {
    /// Current cache size
    pub size: usize,
    /// Maximum cache size
    pub max_size: usize,
    /// Cache TTL in seconds
    pub ttl_seconds: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_resolver_creation() {
        let resolver = RoleResolver::new();
        assert_eq!(resolver.role_count(), 0);
        assert_eq!(resolver.cache_stats().size, 0);
    }

    #[tokio::test]
    async fn test_add_single_role() {
        let mut resolver = RoleResolver::new();
        let role = DerivedRole::new("manager", vec!["employee".to_string()]);

        resolver.add_derived_role(role).unwrap();
        assert_eq!(resolver.role_count(), 1);
    }

    #[tokio::test]
    async fn test_simple_resolution() {
        let mut resolver = RoleResolver::new();

        let manager = DerivedRole::new("manager", vec!["employee".to_string()]);
        resolver.add_derived_role(manager).unwrap();

        let principal_roles = vec!["employee".to_string()];
        let resolved = resolver.resolve_roles(&principal_roles, &HashMap::new()).await.unwrap();

        assert!(resolved.contains(&"employee".to_string()));
        assert!(resolved.contains(&"manager".to_string()));
    }

    #[tokio::test]
    async fn test_chained_resolution() {
        let mut resolver = RoleResolver::new();

        // employee -> manager -> senior_manager
        let manager = DerivedRole::new("manager", vec!["employee".to_string()]);
        let senior = DerivedRole::new("senior_manager", vec!["manager".to_string()]);

        resolver.add_derived_roles(vec![manager, senior]).unwrap();

        let principal_roles = vec!["employee".to_string()];
        let resolved = resolver.resolve_roles(&principal_roles, &HashMap::new()).await.unwrap();

        assert_eq!(resolved.len(), 3);
        assert!(resolved.contains(&"employee".to_string()));
        assert!(resolved.contains(&"manager".to_string()));
        assert!(resolved.contains(&"senior_manager".to_string()));
    }

    #[tokio::test]
    async fn test_multiple_parent_roles() {
        let mut resolver = RoleResolver::new();

        // tech_lead requires both manager AND developer
        let tech_lead = DerivedRole::new(
            "tech_lead",
            vec!["manager".to_string(), "developer".to_string()],
        );

        resolver.add_derived_role(tech_lead).unwrap();

        // Only has manager - should NOT get tech_lead
        let principal_roles1 = vec!["manager".to_string()];
        let resolved1 = resolver.resolve_roles(&principal_roles1, &HashMap::new()).await.unwrap();
        assert!(!resolved1.contains(&"tech_lead".to_string()));

        // Has both - should get tech_lead
        let principal_roles2 = vec!["manager".to_string(), "developer".to_string()];
        let resolved2 = resolver.resolve_roles(&principal_roles2, &HashMap::new()).await.unwrap();
        assert!(resolved2.contains(&"tech_lead".to_string()));
    }

    #[tokio::test]
    async fn test_wildcard_patterns() {
        let mut resolver = RoleResolver::new();

        // admin_user requires any admin:* role
        let admin_user = DerivedRole::new("admin_user", vec!["admin:*".to_string()]);

        resolver.add_derived_role(admin_user).unwrap();

        let principal_roles = vec!["admin:read".to_string()];
        let resolved = resolver.resolve_roles(&principal_roles, &HashMap::new()).await.unwrap();

        assert!(resolved.contains(&"admin_user".to_string()));
    }

    #[tokio::test]
    async fn test_caching() {
        let resolver = RoleResolver::new();
        let principal_roles = vec!["employee".to_string()];

        // First call - not cached
        let _resolved1 = resolver.resolve_roles(&principal_roles, &HashMap::new()).await.unwrap();
        assert_eq!(resolver.cache_stats().size, 1);

        // Second call - should use cache
        let _resolved2 = resolver.resolve_roles(&principal_roles, &HashMap::new()).await.unwrap();
        assert_eq!(resolver.cache_stats().size, 1); // Still 1 (same key)
    }

    #[tokio::test]
    async fn test_cache_invalidation() {
        let mut resolver = RoleResolver::new();

        let principal_roles = vec!["employee".to_string()];
        let _resolved = resolver.resolve_roles(&principal_roles, &HashMap::new()).await.unwrap();

        assert_eq!(resolver.cache_stats().size, 1);

        // Add a new role - should invalidate cache
        let manager = DerivedRole::new("manager", vec!["employee".to_string()]);
        resolver.add_derived_role(manager).unwrap();

        assert_eq!(resolver.cache_stats().size, 0);
    }

    #[tokio::test]
    async fn test_circular_dependency_detection() {
        let mut resolver = RoleResolver::new();

        // A -> B -> A (circular)
        let role_a = DerivedRole::new("role_a", vec!["role_b".to_string()]);
        let role_b = DerivedRole::new("role_b", vec!["role_a".to_string()]);

        let result = resolver.add_derived_roles(vec![role_a, role_b]);
        assert!(result.is_err());

        if let Err(AuthzError::InvalidPolicy(msg)) = result {
            assert!(msg.contains("Circular dependency"));
        } else {
            panic!("Expected InvalidPolicy error");
        }
    }

    #[tokio::test]
    async fn test_duplicate_role_names() {
        let mut resolver = RoleResolver::new();

        let role1 = DerivedRole::new("manager", vec!["employee".to_string()]);
        let role2 = DerivedRole::new("manager", vec!["contributor".to_string()]);

        let result = resolver.add_derived_roles(vec![role1, role2]);
        assert!(result.is_err());

        if let Err(AuthzError::InvalidPolicy(msg)) = result {
            assert!(msg.contains("Duplicate"));
        } else {
            panic!("Expected InvalidPolicy error");
        }
    }

    #[tokio::test]
    async fn test_clear() {
        let mut resolver = RoleResolver::new();

        let manager = DerivedRole::new("manager", vec!["employee".to_string()]);
        resolver.add_derived_role(manager).unwrap();

        assert_eq!(resolver.role_count(), 1);

        resolver.clear();

        assert_eq!(resolver.role_count(), 0);
        assert_eq!(resolver.cache_stats().size, 0);
    }

    #[tokio::test]
    async fn test_custom_cache_settings() {
        use std::time::Duration;

        let resolver = RoleResolver::with_cache_settings(
            Duration::from_secs(120),
            5000,
        );

        let stats = resolver.cache_stats();
        assert_eq!(stats.ttl_seconds, 120);
        assert_eq!(stats.max_size, 5000);
    }
}
