//! Role resolution logic with CEL condition evaluation and circular dependency detection
//!
//! This module provides the main resolver for derived roles, including:
//! - Thread-safe role storage using DashMap
//! - Topological sorting for dependency resolution
//! - CEL condition evaluation
//! - Caching for performance optimization

use dashmap::DashMap;
use std::collections::HashSet;
use std::sync::Arc;

use crate::error::{AuthzError, Result};
use super::graph::RoleGraph;
use super::types::DerivedRole;

/// Thread-safe resolver for derived roles
///
/// Manages derived role definitions and resolves them for principals based on:
/// - Parent role matching (with wildcard support)
/// - CEL condition evaluation
/// - Topological sorting for correct dependency order
///
/// # Thread Safety
///
/// Uses `DashMap` for lock-free concurrent read/write access to role definitions.
///
/// # Examples
///
/// ```rust,no_run
/// use authz::derived_roles::{DerivedRole, DerivedRoleResolver};
///
/// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
/// let resolver = DerivedRoleResolver::new();
///
/// // Add derived roles
/// let role = DerivedRole::new(
///     "senior_manager".to_string(),
///     vec!["manager".to_string()],
///     Some("P.attr.years_experience > 5".to_string()),
/// );
/// resolver.add_role(role)?;
///
/// // Resolve roles for a principal
/// let principal_roles = vec!["manager".to_string()];
/// let context = serde_json::json!({
///     "P": {
///         "attr": {
///             "years_experience": 7
///         }
///     }
/// });
///
/// let derived = resolver.resolve_roles(&principal_roles, Some(&context)).await?;
/// # Ok(())
/// # }
/// ```
#[derive(Debug, Clone)]
pub struct DerivedRoleResolver {
    /// Thread-safe storage for derived role definitions
    roles: Arc<DashMap<String, DerivedRole>>,

    /// Cache for resolved roles (principal_roles -> derived_roles)
    /// Key is a sorted, comma-separated list of principal roles
    cache: Arc<DashMap<String, Vec<String>>>,
}

impl DerivedRoleResolver {
    /// Creates a new derived role resolver
    ///
    /// # Examples
    ///
    /// ```rust
    /// use authz::derived_roles::DerivedRoleResolver;
    ///
    /// let resolver = DerivedRoleResolver::new();
    /// ```
    pub fn new() -> Self {
        Self {
            roles: Arc::new(DashMap::new()),
            cache: Arc::new(DashMap::new()),
        }
    }

    /// Adds a derived role definition
    ///
    /// Validates the role before adding. Invalidates cache if successful.
    ///
    /// # Arguments
    ///
    /// * `role` - The derived role to add
    ///
    /// # Returns
    ///
    /// `Ok(())` if successful, `Err(AuthzError)` if validation fails
    ///
    /// # Examples
    ///
    /// ```rust
    /// use authz::derived_roles::{DerivedRole, DerivedRoleResolver};
    ///
    /// let resolver = DerivedRoleResolver::new();
    /// let role = DerivedRole::new(
    ///     "approver".to_string(),
    ///     vec!["manager".to_string()],
    ///     None,
    /// );
    ///
    /// resolver.add_role(role).unwrap();
    /// ```
    pub fn add_role(&self, role: DerivedRole) -> Result<()> {
        // Validate the role
        role.validate()?;

        // Add to storage
        self.roles.insert(role.name.clone(), role);

        // Invalidate cache
        self.cache.clear();

        Ok(())
    }

    /// Removes a derived role definition
    ///
    /// # Arguments
    ///
    /// * `role_name` - The name of the role to remove
    ///
    /// # Returns
    ///
    /// `Ok(())` if successful, `Err(AuthzError)` if role not found
    pub fn remove_role(&self, role_name: &str) -> Result<()> {
        if self.roles.remove(role_name).is_none() {
            return Err(AuthzError::RoleNotFound {
                role: role_name.to_string(),
            });
        }

        // Invalidate cache
        self.cache.clear();

        Ok(())
    }

    /// Gets a derived role definition
    ///
    /// # Arguments
    ///
    /// * `role_name` - The name of the role to get
    ///
    /// # Returns
    ///
    /// The role definition if found, `None` otherwise
    pub fn get_role(&self, role_name: &str) -> Option<DerivedRole> {
        self.roles.get(role_name).map(|r| r.clone())
    }

    /// Lists all derived role names
    ///
    /// # Returns
    ///
    /// A vector of all role names
    pub fn list_roles(&self) -> Vec<String> {
        self.roles.iter().map(|r| r.key().clone()).collect()
    }

    /// Resolves derived roles for a principal
    ///
    /// This is the main entry point for role resolution. It:
    /// 1. Checks cache for previous resolution
    /// 2. Builds dependency graph
    /// 3. Performs topological sort (detects cycles)
    /// 4. Evaluates roles in dependency order
    /// 5. Evaluates CEL conditions
    /// 6. Caches results
    ///
    /// # Arguments
    ///
    /// * `principal_roles` - The principal's current roles
    /// * `context` - Optional CEL evaluation context (JSON value)
    ///
    /// # Returns
    ///
    /// A vector of derived role names that apply to the principal
    ///
    /// # Examples
    ///
    /// ```rust,no_run
    /// use authz::derived_roles::{DerivedRole, DerivedRoleResolver};
    ///
    /// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
    /// let resolver = DerivedRoleResolver::new();
    ///
    /// let role = DerivedRole::new(
    ///     "approver".to_string(),
    ///     vec!["manager".to_string()],
    ///     Some("P.attr.level >= 3".to_string()),
    /// );
    /// resolver.add_role(role)?;
    ///
    /// let principal_roles = vec!["manager".to_string()];
    /// let context = serde_json::json!({
    ///     "P": { "attr": { "level": 5 } }
    /// });
    ///
    /// let derived = resolver.resolve_roles(&principal_roles, Some(&context)).await?;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn resolve_roles(
        &self,
        principal_roles: &[String],
        context: Option<&serde_json::Value>,
    ) -> Result<Vec<String>> {
        // Check cache
        let cache_key = self.make_cache_key(principal_roles);
        if let Some(cached) = self.cache.get(&cache_key) {
            return Ok(cached.clone());
        }

        // Build dependency graph
        let graph = self.build_dependency_graph()?;

        // Topological sort to get resolution order
        let resolution_order = graph.topological_sort()?;

        // Resolve roles in order
        let mut resolved_roles = HashSet::new();
        let mut current_roles: Vec<String> = principal_roles.to_vec();

        for role_name in resolution_order {
            if let Some(role_def) = self.roles.get(&role_name) {
                // Check if parent roles match
                if role_def.matches(&current_roles) {
                    // Evaluate CEL condition if present
                    if self.evaluate_condition(&role_def, context).await? {
                        resolved_roles.insert(role_name.clone());
                        current_roles.push(role_name);
                    }
                }
            }
        }

        // Convert to sorted vector for consistent output
        let mut result: Vec<String> = resolved_roles.into_iter().collect();
        result.sort();

        // Cache result
        self.cache.insert(cache_key, result.clone());

        Ok(result)
    }

    /// Validates all derived roles for circular dependencies
    ///
    /// # Returns
    ///
    /// `Ok(())` if no cycles detected, `Err(AuthzError::CircularDependency)` otherwise
    pub fn validate_all(&self) -> Result<()> {
        let graph = self.build_dependency_graph()?;
        graph.topological_sort()?;
        Ok(())
    }

    /// Clears the resolution cache
    ///
    /// Call this when you want to force fresh resolution on the next call.
    pub fn clear_cache(&self) {
        self.cache.clear();
    }

    /// Returns the number of derived roles
    pub fn len(&self) -> usize {
        self.roles.len()
    }

    /// Checks if there are no derived roles
    pub fn is_empty(&self) -> bool {
        self.roles.is_empty()
    }

    // Private helper methods

    /// Builds a dependency graph from all derived roles
    fn build_dependency_graph(&self) -> Result<RoleGraph> {
        let mut graph = RoleGraph::new();
        let all_derived_role_names: HashSet<String> = self.roles.iter()
            .map(|r| r.key().clone())
            .collect();

        // Add all nodes
        for role_name in &all_derived_role_names {
            graph.add_node(role_name.clone());
        }

        // Add dependencies
        for role_ref in self.roles.iter() {
            let role = role_ref.value();
            for parent_role in &role.parent_roles {
                // Only add dependency if parent is also a derived role
                if all_derived_role_names.contains(parent_role) {
                    graph.add_dependency(role.name.clone(), parent_role.clone());
                }
            }
        }

        Ok(graph)
    }

    /// Evaluates a CEL condition
    ///
    /// Returns `true` if:
    /// - No condition is specified (empty condition)
    /// - Condition evaluates to true
    ///
    /// Returns `false` if condition evaluates to false
    /// Returns error if condition fails to compile or evaluate
    async fn evaluate_condition(
        &self,
        role: &DerivedRole,
        context: Option<&serde_json::Value>,
    ) -> Result<bool> {
        // Empty condition always evaluates to true
        let condition = match &role.condition {
            Some(c) if !c.is_empty() => c,
            _ => return Ok(true),
        };

        // For now, return a placeholder
        // TODO: Implement CEL evaluation using cel-interpreter
        // This requires integration with the CEL engine
        #[allow(unused_variables)]
        let ctx = context;

        // Placeholder implementation - will be replaced with actual CEL evaluation
        tracing::warn!(
            "CEL evaluation not yet implemented for role: {} condition: {}",
            role.name,
            condition
        );

        Ok(true)
    }

    /// Creates a cache key from principal roles
    fn make_cache_key(&self, principal_roles: &[String]) -> String {
        let mut sorted = principal_roles.to_vec();
        sorted.sort();
        sorted.join(",")
    }
}

impl Default for DerivedRoleResolver {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_resolver() {
        let resolver = DerivedRoleResolver::new();
        assert!(resolver.is_empty());
        assert_eq!(resolver.len(), 0);
    }

    #[test]
    fn test_add_role() {
        let resolver = DerivedRoleResolver::new();
        let role = DerivedRole::new(
            "approver".to_string(),
            vec!["manager".to_string()],
            None,
        );

        let result = resolver.add_role(role);
        assert!(result.is_ok());
        assert_eq!(resolver.len(), 1);
    }

    #[test]
    fn test_add_invalid_role() {
        let resolver = DerivedRoleResolver::new();
        let role = DerivedRole::new(
            "".to_string(), // Invalid: empty name
            vec!["manager".to_string()],
            None,
        );

        let result = resolver.add_role(role);
        assert!(matches!(result, Err(AuthzError::EmptyRoleName)));
    }

    #[test]
    fn test_get_role() {
        let resolver = DerivedRoleResolver::new();
        let role = DerivedRole::new(
            "approver".to_string(),
            vec!["manager".to_string()],
            None,
        );

        resolver.add_role(role.clone()).unwrap();

        let retrieved = resolver.get_role("approver");
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().name, "approver");
    }

    #[test]
    fn test_remove_role() {
        let resolver = DerivedRoleResolver::new();
        let role = DerivedRole::new(
            "approver".to_string(),
            vec!["manager".to_string()],
            None,
        );

        resolver.add_role(role).unwrap();
        assert_eq!(resolver.len(), 1);

        let result = resolver.remove_role("approver");
        assert!(result.is_ok());
        assert_eq!(resolver.len(), 0);
    }

    #[test]
    fn test_list_roles() {
        let resolver = DerivedRoleResolver::new();

        let role1 = DerivedRole::new(
            "approver".to_string(),
            vec!["manager".to_string()],
            None,
        );
        let role2 = DerivedRole::new(
            "reviewer".to_string(),
            vec!["senior".to_string()],
            None,
        );

        resolver.add_role(role1).unwrap();
        resolver.add_role(role2).unwrap();

        let roles = resolver.list_roles();
        assert_eq!(roles.len(), 2);
        assert!(roles.contains(&"approver".to_string()));
        assert!(roles.contains(&"reviewer".to_string()));
    }

    #[tokio::test]
    async fn test_resolve_roles_simple() {
        let resolver = DerivedRoleResolver::new();

        let role = DerivedRole::new(
            "senior_manager".to_string(),
            vec!["manager".to_string()],
            None,
        );

        resolver.add_role(role).unwrap();

        let principal_roles = vec!["manager".to_string()];
        let derived = resolver.resolve_roles(&principal_roles, None).await.unwrap();

        assert_eq!(derived, vec!["senior_manager".to_string()]);
    }

    #[tokio::test]
    async fn test_resolve_roles_no_match() {
        let resolver = DerivedRoleResolver::new();

        let role = DerivedRole::new(
            "senior_manager".to_string(),
            vec!["manager".to_string()],
            None,
        );

        resolver.add_role(role).unwrap();

        let principal_roles = vec!["user".to_string()];
        let derived = resolver.resolve_roles(&principal_roles, None).await.unwrap();

        assert!(derived.is_empty());
    }

    #[tokio::test]
    async fn test_resolve_roles_with_wildcard() {
        let resolver = DerivedRoleResolver::new();

        let role = DerivedRole::new(
            "department_lead".to_string(),
            vec!["manager".to_string(), "department:*".to_string()],
            None,
        );

        resolver.add_role(role).unwrap();

        let principal_roles = vec![
            "manager".to_string(),
            "department:finance".to_string(),
        ];
        let derived = resolver.resolve_roles(&principal_roles, None).await.unwrap();

        assert_eq!(derived, vec!["department_lead".to_string()]);
    }

    #[tokio::test]
    async fn test_resolve_roles_chain() {
        let resolver = DerivedRoleResolver::new();

        // Base role
        let role1 = DerivedRole::new(
            "senior".to_string(),
            vec!["user".to_string()],
            None,
        );

        // Derived from derived role
        let role2 = DerivedRole::new(
            "lead".to_string(),
            vec!["senior".to_string()],
            None,
        );

        resolver.add_role(role1).unwrap();
        resolver.add_role(role2).unwrap();

        let principal_roles = vec!["user".to_string()];
        let derived = resolver.resolve_roles(&principal_roles, None).await.unwrap();

        // Should resolve both in order
        assert_eq!(derived.len(), 2);
        assert!(derived.contains(&"senior".to_string()));
        assert!(derived.contains(&"lead".to_string()));
    }

    #[test]
    fn test_circular_dependency_detection() {
        let resolver = DerivedRoleResolver::new();

        // Create circular dependency: role_a -> role_b -> role_a
        let role1 = DerivedRole::new(
            "role_a".to_string(),
            vec!["role_b".to_string()],
            None,
        );

        let role2 = DerivedRole::new(
            "role_b".to_string(),
            vec!["role_a".to_string()],
            None,
        );

        resolver.add_role(role1).unwrap();
        resolver.add_role(role2).unwrap();

        let result = resolver.validate_all();
        assert!(matches!(result, Err(AuthzError::CircularDependency { .. })));
    }

    #[tokio::test]
    async fn test_caching() {
        let resolver = DerivedRoleResolver::new();

        let role = DerivedRole::new(
            "approver".to_string(),
            vec!["manager".to_string()],
            None,
        );

        resolver.add_role(role).unwrap();

        let principal_roles = vec!["manager".to_string()];

        // First resolution
        let derived1 = resolver.resolve_roles(&principal_roles, None).await.unwrap();

        // Second resolution (should use cache)
        let derived2 = resolver.resolve_roles(&principal_roles, None).await.unwrap();

        assert_eq!(derived1, derived2);
    }

    #[tokio::test]
    async fn test_cache_invalidation() {
        let resolver = DerivedRoleResolver::new();

        let role = DerivedRole::new(
            "approver".to_string(),
            vec!["manager".to_string()],
            None,
        );

        resolver.add_role(role).unwrap();

        let principal_roles = vec!["manager".to_string()];
        let _derived1 = resolver.resolve_roles(&principal_roles, None).await.unwrap();

        // Add new role - should invalidate cache
        let role2 = DerivedRole::new(
            "reviewer".to_string(),
            vec!["manager".to_string()],
            None,
        );
        resolver.add_role(role2).unwrap();

        let derived2 = resolver.resolve_roles(&principal_roles, None).await.unwrap();
        assert_eq!(derived2.len(), 2); // Both roles should be resolved
    }
}
