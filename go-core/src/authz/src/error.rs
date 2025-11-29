//! Error types for the authorization engine

use std::fmt;

/// Result type alias for authorization operations
pub type Result<T> = std::result::Result<T, AuthzError>;

/// Comprehensive error types for authorization operations
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthzError {
    /// Derived role validation error
    InvalidDerivedRole {
        role: String,
        reason: String,
    },

    /// Circular dependency detected in derived roles
    CircularDependency {
        cycle: Vec<String>,
    },

    /// Invalid wildcard pattern
    InvalidPattern {
        pattern: String,
        reason: String,
    },

    /// CEL expression compilation error
    CelCompilationError {
        expression: String,
        error: String,
    },

    /// CEL expression evaluation error
    CelEvaluationError {
        expression: String,
        error: String,
    },

    /// Role not found
    RoleNotFound {
        role: String,
    },

    /// Empty role name
    EmptyRoleName,

    /// Empty parent roles
    EmptyParentRoles {
        role: String,
    },

    /// Empty parent role in list
    EmptyParentRole {
        role: String,
    },

    /// Multiple wildcards in pattern (not supported)
    MultipleWildcards {
        role: String,
        pattern: String,
    },

    /// Graph resolution error
    GraphResolutionError {
        reason: String,
    },

    /// Generic internal error
    Internal {
        message: String,
    },
}

impl fmt::Display for AuthzError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AuthzError::InvalidDerivedRole { role, reason } => {
                write!(f, "Invalid derived role '{}': {}", role, reason)
            }
            AuthzError::CircularDependency { cycle } => {
                write!(f, "Circular dependency detected: {}", cycle.join(" -> "))
            }
            AuthzError::InvalidPattern { pattern, reason } => {
                write!(f, "Invalid pattern '{}': {}", pattern, reason)
            }
            AuthzError::CelCompilationError { expression, error } => {
                write!(f, "CEL compilation error in '{}': {}", expression, error)
            }
            AuthzError::CelEvaluationError { expression, error } => {
                write!(f, "CEL evaluation error in '{}': {}", expression, error)
            }
            AuthzError::RoleNotFound { role } => {
                write!(f, "Role '{}' not found", role)
            }
            AuthzError::EmptyRoleName => {
                write!(f, "Derived role name cannot be empty")
            }
            AuthzError::EmptyParentRoles { role } => {
                write!(f, "Derived role '{}' must have at least one parent role", role)
            }
            AuthzError::EmptyParentRole { role } => {
                write!(f, "Derived role '{}' has empty parent role", role)
            }
            AuthzError::MultipleWildcards { role, pattern } => {
                write!(
                    f,
                    "Derived role '{}' has invalid parent role pattern '{}' (multiple wildcards not supported)",
                    role, pattern
                )
            }
            AuthzError::GraphResolutionError { reason } => {
                write!(f, "Graph resolution error: {}", reason)
            }
            AuthzError::Internal { message } => {
                write!(f, "Internal error: {}", message)
            }
        }
    }
}

impl std::error::Error for AuthzError {}

impl From<anyhow::Error> for AuthzError {
    fn from(err: anyhow::Error) -> Self {
        AuthzError::Internal {
            message: err.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let err = AuthzError::InvalidDerivedRole {
            role: "test_role".to_string(),
            reason: "missing parent roles".to_string(),
        };
        assert!(err.to_string().contains("Invalid derived role"));
        assert!(err.to_string().contains("test_role"));
    }

    #[test]
    fn test_circular_dependency_display() {
        let err = AuthzError::CircularDependency {
            cycle: vec!["role_a".to_string(), "role_b".to_string(), "role_a".to_string()],
        };
        assert!(err.to_string().contains("Circular dependency"));
        assert!(err.to_string().contains("role_a -> role_b -> role_a"));
    }

    #[test]
    fn test_error_equality() {
        let err1 = AuthzError::EmptyRoleName;
        let err2 = AuthzError::EmptyRoleName;
        assert_eq!(err1, err2);
    }
}
