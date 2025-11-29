//! Core types for derived roles
//!
//! This module provides the fundamental data structures for representing
//! derived roles and their dependency graph for topological sorting.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use crate::error::{AuthzError, Result};
use super::pattern::matches_pattern;

/// Represents a role computed from parent roles and conditions
///
/// Derived roles enable dynamic role assignment based on runtime evaluation
/// of CEL expressions against principal and resource attributes.
///
/// ## Fields
///
/// - `name`: Unique derived role name (e.g., "document_approver")
/// - `parent_roles`: Parent roles required (supports wildcards: *, prefix:*, *:suffix)
/// - `condition`: Optional CEL expression for conditional activation
///
/// ## Examples
///
/// ```rust
/// use authz::derived_roles::DerivedRole;
///
/// // Simple derived role
/// let role = DerivedRole::new(
///     "senior_manager".to_string(),
///     vec!["manager".to_string()],
///     Some("P.attr.years_experience > 5".to_string()),
/// );
///
/// // Derived role with wildcards
/// let role = DerivedRole::new(
///     "department_lead".to_string(),
///     vec!["manager".to_string(), "department:*".to_string()],
///     None,
/// );
/// ```
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DerivedRole {
    /// Unique derived role name
    pub name: String,

    /// Parent roles required (supports wildcard patterns)
    #[serde(rename = "parentRoles")]
    pub parent_roles: Vec<String>,

    /// Optional CEL expression for conditional activation
    /// Empty condition evaluates to true
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition: Option<String>,
}

impl DerivedRole {
    /// Creates a new derived role
    ///
    /// # Arguments
    ///
    /// * `name` - Unique role identifier
    /// * `parent_roles` - List of parent role patterns
    /// * `condition` - Optional CEL expression
    ///
    /// # Examples
    ///
    /// ```rust
    /// use authz::derived_roles::DerivedRole;
    ///
    /// let role = DerivedRole::new(
    ///     "approver".to_string(),
    ///     vec!["manager".to_string(), "senior:*".to_string()],
    ///     Some("P.attr.clearance_level >= 3".to_string()),
    /// );
    /// ```
    pub fn new(name: String, parent_roles: Vec<String>, condition: Option<String>) -> Self {
        Self {
            name,
            parent_roles,
            condition,
        }
    }

    /// Checks if a principal qualifies for this derived role based on parent roles
    ///
    /// Returns true if the principal has ALL required parent roles (AND logic).
    /// Each parent role pattern must match at least one of the principal's roles.
    ///
    /// # Pattern Support
    ///
    /// - Exact match: `"admin"` matches `"admin"`
    /// - Universal wildcard: `"*"` matches any role
    /// - Prefix wildcard: `"admin:*"` matches `"admin:read"`, `"admin:write"`
    /// - Suffix wildcard: `"*:viewer"` matches `"document:viewer"`, `"project:viewer"`
    ///
    /// # Arguments
    ///
    /// * `principal_roles` - The principal's current roles
    ///
    /// # Returns
    ///
    /// `true` if all parent role requirements are met, `false` otherwise
    ///
    /// # Examples
    ///
    /// ```rust
    /// use authz::derived_roles::DerivedRole;
    ///
    /// let role = DerivedRole::new(
    ///     "approver".to_string(),
    ///     vec!["manager".to_string(), "department:*".to_string()],
    ///     None,
    /// );
    ///
    /// let principal_roles = vec![
    ///     "manager".to_string(),
    ///     "department:finance".to_string(),
    /// ];
    ///
    /// assert!(role.matches(&principal_roles));
    /// ```
    pub fn matches(&self, principal_roles: &[String]) -> bool {
        if self.parent_roles.is_empty() {
            return false; // No parent roles defined - invalid derived role
        }

        // ALL parent roles must match (AND logic)
        for parent_pattern in &self.parent_roles {
            let found_match = principal_roles
                .iter()
                .any(|principal_role| matches_pattern(principal_role, parent_pattern));

            if !found_match {
                return false; // This parent role requirement not met
            }
        }

        true // All parent role requirements met
    }

    /// Validates the derived role definition
    ///
    /// # Validation Rules
    ///
    /// 1. Role name cannot be empty
    /// 2. Must have at least one parent role
    /// 3. Parent roles cannot be empty strings
    /// 4. Wildcard patterns cannot contain multiple wildcards
    ///
    /// Note: CEL condition validation is performed separately by the CEL engine.
    /// Empty conditions are valid and always evaluate to true.
    ///
    /// # Returns
    ///
    /// `Ok(())` if validation passes, `Err(AuthzError)` otherwise
    ///
    /// # Examples
    ///
    /// ```rust
    /// use authz::derived_roles::DerivedRole;
    ///
    /// let role = DerivedRole::new(
    ///     "approver".to_string(),
    ///     vec!["manager".to_string()],
    ///     None,
    /// );
    ///
    /// assert!(role.validate().is_ok());
    /// ```
    pub fn validate(&self) -> Result<()> {
        // Check role name
        if self.name.is_empty() {
            return Err(AuthzError::EmptyRoleName);
        }

        // Check parent roles exist
        if self.parent_roles.is_empty() {
            return Err(AuthzError::EmptyParentRoles {
                role: self.name.clone(),
            });
        }

        // Validate each parent role pattern
        for parent_role in &self.parent_roles {
            // Check for empty parent role
            if parent_role.is_empty() {
                return Err(AuthzError::EmptyParentRole {
                    role: self.name.clone(),
                });
            }

            // Check for invalid wildcard patterns (multiple wildcards)
            let wildcard_count = parent_role.matches('*').count();
            if wildcard_count > 1 {
                return Err(AuthzError::MultipleWildcards {
                    role: self.name.clone(),
                    pattern: parent_role.clone(),
                });
            }
        }

        Ok(())
    }
}

/// Represents a node in the derived roles dependency graph
///
/// Used for topological sorting to resolve roles in the correct dependency order
/// using Kahn's algorithm for cycle detection.
///
/// ## Fields
///
/// - `role`: The derived role name
/// - `dependencies`: Other derived roles this role depends on (via parent roles)
/// - `in_degree`: Number of incoming edges (for Kahn's algorithm)
/// - `resolved`: Whether this role has been resolved in the current pass
/// - `adj_list`: Adjacency list for efficient dependency lookups
///
/// ## Examples
///
/// ```rust
/// use authz::derived_roles::RoleGraphNode;
///
/// let mut node = RoleGraphNode::new("senior_manager".to_string());
/// node.add_dependency("manager".to_string());
/// node.add_dependency("department_lead".to_string());
///
/// assert_eq!(node.in_degree, 2);
/// assert_eq!(node.dependencies.len(), 2);
/// ```
#[derive(Debug, Clone)]
pub struct RoleGraphNode {
    /// The derived role name
    pub role: String,

    /// Other derived roles this role depends on (via parent roles)
    pub dependencies: Vec<String>,

    /// Number of incoming edges (for Kahn's algorithm)
    pub in_degree: usize,

    /// Whether this role has been resolved in the current pass
    pub resolved: bool,

    /// Adjacency list for efficient lookups
    pub adj_list: HashMap<String, bool>,
}

impl RoleGraphNode {
    /// Creates a new graph node for topological sorting
    ///
    /// # Arguments
    ///
    /// * `role_name` - The derived role name
    ///
    /// # Examples
    ///
    /// ```rust
    /// use authz::derived_roles::RoleGraphNode;
    ///
    /// let node = RoleGraphNode::new("approver".to_string());
    /// assert_eq!(node.role, "approver");
    /// assert_eq!(node.in_degree, 0);
    /// ```
    pub fn new(role_name: String) -> Self {
        Self {
            role: role_name,
            dependencies: Vec::new(),
            in_degree: 0,
            resolved: false,
            adj_list: HashMap::new(),
        }
    }

    /// Adds a dependency to this node
    ///
    /// If the dependency already exists, it is not added again.
    /// Increments the in-degree counter for each new dependency.
    ///
    /// # Arguments
    ///
    /// * `depends_on` - The role this node depends on
    ///
    /// # Examples
    ///
    /// ```rust
    /// use authz::derived_roles::RoleGraphNode;
    ///
    /// let mut node = RoleGraphNode::new("senior_manager".to_string());
    /// node.add_dependency("manager".to_string());
    /// node.add_dependency("manager".to_string()); // Duplicate, ignored
    ///
    /// assert_eq!(node.in_degree, 1);
    /// assert_eq!(node.dependencies.len(), 1);
    /// ```
    pub fn add_dependency(&mut self, depends_on: String) {
        if !self.adj_list.contains_key(&depends_on) {
            self.dependencies.push(depends_on.clone());
            self.adj_list.insert(depends_on, true);
            self.in_degree += 1;
        }
    }

    /// Marks this node as resolved
    pub fn mark_resolved(&mut self) {
        self.resolved = true;
    }

    /// Checks if this node is resolved
    pub fn is_resolved(&self) -> bool {
        self.resolved
    }

    /// Decrements the in-degree counter
    ///
    /// Used when a dependency is resolved in topological sorting.
    pub fn decrement_in_degree(&mut self) {
        if self.in_degree > 0 {
            self.in_degree -= 1;
        }
    }

    /// Gets all dependencies as a set for efficient lookups
    pub fn dependency_set(&self) -> HashSet<String> {
        self.dependencies.iter().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derived_role_new() {
        let role = DerivedRole::new(
            "test_role".to_string(),
            vec!["parent1".to_string(), "parent2".to_string()],
            Some("P.attr.level > 5".to_string()),
        );

        assert_eq!(role.name, "test_role");
        assert_eq!(role.parent_roles.len(), 2);
        assert_eq!(role.condition, Some("P.attr.level > 5".to_string()));
    }

    #[test]
    fn test_derived_role_matches_exact() {
        let role = DerivedRole::new(
            "approver".to_string(),
            vec!["manager".to_string(), "senior".to_string()],
            None,
        );

        let principal_roles = vec!["manager".to_string(), "senior".to_string()];
        assert!(role.matches(&principal_roles));
    }

    #[test]
    fn test_derived_role_matches_wildcard() {
        let role = DerivedRole::new(
            "approver".to_string(),
            vec!["manager".to_string(), "department:*".to_string()],
            None,
        );

        let principal_roles = vec!["manager".to_string(), "department:finance".to_string()];
        assert!(role.matches(&principal_roles));
    }

    #[test]
    fn test_derived_role_matches_missing_parent() {
        let role = DerivedRole::new(
            "approver".to_string(),
            vec!["manager".to_string(), "senior".to_string()],
            None,
        );

        let principal_roles = vec!["manager".to_string()];
        assert!(!role.matches(&principal_roles));
    }

    #[test]
    fn test_derived_role_matches_empty_parents() {
        let role = DerivedRole::new(
            "approver".to_string(),
            vec![],
            None,
        );

        let principal_roles = vec!["manager".to_string()];
        assert!(!role.matches(&principal_roles));
    }

    #[test]
    fn test_derived_role_validate_success() {
        let role = DerivedRole::new(
            "approver".to_string(),
            vec!["manager".to_string()],
            None,
        );

        assert!(role.validate().is_ok());
    }

    #[test]
    fn test_derived_role_validate_empty_name() {
        let role = DerivedRole::new(
            "".to_string(),
            vec!["manager".to_string()],
            None,
        );

        let result = role.validate();
        assert!(matches!(result, Err(AuthzError::EmptyRoleName)));
    }

    #[test]
    fn test_derived_role_validate_empty_parent_roles() {
        let role = DerivedRole::new(
            "approver".to_string(),
            vec![],
            None,
        );

        let result = role.validate();
        assert!(matches!(result, Err(AuthzError::EmptyParentRoles { .. })));
    }

    #[test]
    fn test_derived_role_validate_empty_parent_role() {
        let role = DerivedRole::new(
            "approver".to_string(),
            vec!["manager".to_string(), "".to_string()],
            None,
        );

        let result = role.validate();
        assert!(matches!(result, Err(AuthzError::EmptyParentRole { .. })));
    }

    #[test]
    fn test_derived_role_validate_multiple_wildcards() {
        let role = DerivedRole::new(
            "approver".to_string(),
            vec!["*:*:*".to_string()],
            None,
        );

        let result = role.validate();
        assert!(matches!(result, Err(AuthzError::MultipleWildcards { .. })));
    }

    #[test]
    fn test_role_graph_node_new() {
        let node = RoleGraphNode::new("test_role".to_string());

        assert_eq!(node.role, "test_role");
        assert_eq!(node.in_degree, 0);
        assert!(!node.resolved);
        assert!(node.dependencies.is_empty());
    }

    #[test]
    fn test_role_graph_node_add_dependency() {
        let mut node = RoleGraphNode::new("test_role".to_string());
        node.add_dependency("parent1".to_string());
        node.add_dependency("parent2".to_string());

        assert_eq!(node.in_degree, 2);
        assert_eq!(node.dependencies.len(), 2);
    }

    #[test]
    fn test_role_graph_node_add_duplicate_dependency() {
        let mut node = RoleGraphNode::new("test_role".to_string());
        node.add_dependency("parent1".to_string());
        node.add_dependency("parent1".to_string()); // Duplicate

        assert_eq!(node.in_degree, 1);
        assert_eq!(node.dependencies.len(), 1);
    }

    #[test]
    fn test_role_graph_node_mark_resolved() {
        let mut node = RoleGraphNode::new("test_role".to_string());
        assert!(!node.is_resolved());

        node.mark_resolved();
        assert!(node.is_resolved());
    }

    #[test]
    fn test_role_graph_node_decrement_in_degree() {
        let mut node = RoleGraphNode::new("test_role".to_string());
        node.add_dependency("parent1".to_string());
        node.add_dependency("parent2".to_string());

        assert_eq!(node.in_degree, 2);

        node.decrement_in_degree();
        assert_eq!(node.in_degree, 1);

        node.decrement_in_degree();
        assert_eq!(node.in_degree, 0);

        // Should not go below 0
        node.decrement_in_degree();
        assert_eq!(node.in_degree, 0);
    }

    #[test]
    fn test_role_graph_node_dependency_set() {
        let mut node = RoleGraphNode::new("test_role".to_string());
        node.add_dependency("parent1".to_string());
        node.add_dependency("parent2".to_string());

        let dep_set = node.dependency_set();
        assert_eq!(dep_set.len(), 2);
        assert!(dep_set.contains("parent1"));
        assert!(dep_set.contains("parent2"));
    }

    #[test]
    fn test_derived_role_serialization() {
        let role = DerivedRole::new(
            "approver".to_string(),
            vec!["manager".to_string()],
            Some("P.attr.level > 5".to_string()),
        );

        let json = serde_json::to_string(&role).unwrap();
        let deserialized: DerivedRole = serde_json::from_str(&json).unwrap();

        assert_eq!(role, deserialized);
    }
}
