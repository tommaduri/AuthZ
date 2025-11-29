//! Derived role type definitions

use crate::error::{AuthzError, Result};
use serde::{Deserialize, Serialize};

/// Derived role definition
///
/// Derived roles are roles that are dynamically assigned based on:
/// 1. Parent roles - the principal must have ALL parent roles
/// 2. Condition - optional CEL expression that must evaluate to true
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DerivedRole {
    /// Unique derived role name (e.g., "document_approver")
    pub name: String,

    /// Parent roles required (supports wildcards: *, prefix:*, *:suffix)
    /// Principal must have ALL parent roles (AND logic)
    pub parent_roles: Vec<String>,

    /// Optional CEL expression for conditional activation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition: Option<String>,
}

impl DerivedRole {
    /// Create a new derived role
    pub fn new(name: impl Into<String>, parent_roles: Vec<String>) -> Self {
        Self {
            name: name.into(),
            parent_roles,
            condition: None,
        }
    }

    /// Add a condition to the derived role
    pub fn with_condition(mut self, condition: impl Into<String>) -> Self {
        self.condition = Some(condition.into());
        self
    }

    /// Validate the derived role definition
    pub fn validate(&self) -> Result<()> {
        // Name must be non-empty
        if self.name.is_empty() {
            return Err(AuthzError::InvalidInput(
                "Derived role name cannot be empty".to_string(),
            ));
        }

        // Must have at least one parent role
        if self.parent_roles.is_empty() {
            return Err(AuthzError::InvalidInput(format!(
                "Derived role '{}' must have at least one parent role",
                self.name
            )));
        }

        // Parent roles must be non-empty
        for parent in &self.parent_roles {
            if parent.is_empty() {
                return Err(AuthzError::InvalidInput(format!(
                    "Derived role '{}' has empty parent role",
                    self.name
                )));
            }
        }

        // Check for self-reference
        for parent in &self.parent_roles {
            if parent == &self.name {
                return Err(AuthzError::InvalidInput(format!(
                    "Derived role '{}' cannot reference itself as a parent role",
                    self.name
                )));
            }
        }

        Ok(())
    }

    /// Check if this derived role matches the given roles
    ///
    /// Returns true if ALL parent roles are satisfied (AND logic)
    /// Supports wildcard patterns: *, prefix:*, *:suffix
    pub fn matches(&self, principal_roles: &[String]) -> bool {
        if self.parent_roles.is_empty() {
            return false;
        }

        // ALL parent roles must match (AND logic)
        self.parent_roles.iter().all(|parent_pattern| {
            principal_roles
                .iter()
                .any(|role| Self::matches_pattern(role, parent_pattern))
        })
    }

    /// Match a role against a pattern (supports wildcards)
    fn matches_pattern(role: &str, pattern: &str) -> bool {
        if pattern == "*" {
            return true;
        }

        // Prefix wildcard: "admin:*"
        if let Some(prefix) = pattern.strip_suffix(":*") {
            return role.starts_with(&format!("{}:", prefix));
        }

        // Suffix wildcard: "*:viewer"
        if let Some(suffix) = pattern.strip_prefix("*:") {
            return role.ends_with(&format!(":{}", suffix));
        }

        // Exact match
        role == pattern
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derived_role_creation() {
        let role = DerivedRole::new("approver", vec!["reviewer".to_string()])
            .with_condition("principal.attr.seniority >= 5");

        assert_eq!(role.name, "approver");
        assert_eq!(role.parent_roles, vec!["reviewer".to_string()]);
        assert!(role.condition.is_some());
    }

    #[test]
    fn test_derived_role_validation() {
        // Valid role
        let role = DerivedRole::new("approver", vec!["reviewer".to_string()]);
        assert!(role.validate().is_ok());

        // Empty name
        let role = DerivedRole::new("", vec!["reviewer".to_string()]);
        assert!(role.validate().is_err());

        // No parent roles
        let role = DerivedRole::new("approver", vec![]);
        assert!(role.validate().is_err());

        // Self-reference
        let role = DerivedRole::new("approver", vec!["approver".to_string()]);
        assert!(role.validate().is_err());
    }

    #[test]
    fn test_pattern_matching() {
        let role = DerivedRole::new("approver", vec!["admin:*".to_string()]);

        assert!(role.matches(&["admin:full".to_string()]));
        assert!(role.matches(&["admin:partial".to_string()]));
        assert!(!role.matches(&["user:normal".to_string()]));
    }

    #[test]
    fn test_wildcard_patterns() {
        // Universal wildcard
        assert!(DerivedRole::matches_pattern("any:role", "*"));

        // Prefix wildcard
        assert!(DerivedRole::matches_pattern("admin:full", "admin:*"));
        assert!(!DerivedRole::matches_pattern("user:full", "admin:*"));

        // Suffix wildcard
        assert!(DerivedRole::matches_pattern("role:viewer", "*:viewer"));
        assert!(!DerivedRole::matches_pattern("role:editor", "*:viewer"));

        // Exact match
        assert!(DerivedRole::matches_pattern("exact:role", "exact:role"));
        assert!(!DerivedRole::matches_pattern("exact:role", "other:role"));
    }

    #[test]
    fn test_multiple_parent_roles() {
        let role = DerivedRole::new(
            "super_approver",
            vec!["reviewer".to_string(), "admin:*".to_string()],
        );

        // Must have ALL parent roles
        assert!(role.matches(&["reviewer".to_string(), "admin:full".to_string()]));
        assert!(!role.matches(&["reviewer".to_string()]));
        assert!(!role.matches(&["admin:full".to_string()]));
    }
}
