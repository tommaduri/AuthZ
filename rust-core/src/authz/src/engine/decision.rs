//! Authorization decision types and request handling

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// Authorization request with principal, resource, action, and context
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthRequest {
    /// Principal making the request
    pub principal: RequestPrincipal,

    /// Resource being accessed
    pub resource: RequestResource,

    /// Action being performed
    pub action: RequestAction,

    /// Additional context (time, IP, attributes)
    #[serde(default)]
    pub context: HashMap<String, serde_json::Value>,
}

/// Principal information for authorization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestPrincipal {
    /// Principal ID (e.g., "user:alice@example.com")
    pub id: String,

    /// Principal's base roles
    #[serde(default)]
    pub roles: Vec<String>,

    /// Additional principal attributes
    #[serde(default)]
    pub attributes: HashMap<String, String>,
}

/// Resource information for authorization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestResource {
    /// Resource ID (e.g., "document:123")
    pub id: String,

    /// Resource attributes (owner, sensitivity, etc.)
    #[serde(default)]
    pub attributes: HashMap<String, String>,
}

/// Action being performed
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestAction {
    /// Action name (read, write, delete, etc.)
    pub name: String,
}

impl RequestAction {
    pub fn new(name: impl Into<String>) -> Self {
        Self { name: name.into() }
    }
}

/// Authorization decision with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthDecision {
    /// Unique decision ID
    pub id: String,

    /// Whether the request is allowed
    pub allowed: bool,

    /// Policy that made the decision
    pub policy_id: String,

    /// Reason for the decision
    pub reason: DecisionReason,

    /// Resolved roles (base + derived)
    pub resolved_roles: Vec<String>,

    /// Decision timestamp (milliseconds since epoch)
    pub timestamp: u64,

    /// Additional metadata
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

impl AuthDecision {
    /// Create an allow decision
    pub fn allow(
        policy_id: String,
        reason: String,
        resolved_roles: Vec<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            allowed: true,
            policy_id,
            reason: DecisionReason::PolicyMatch { reason },
            resolved_roles,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            metadata: HashMap::new(),
        }
    }

    /// Create a deny decision
    pub fn deny(
        policy_id: String,
        reason: String,
        resolved_roles: Vec<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            allowed: false,
            policy_id,
            reason: DecisionReason::PolicyMatch { reason },
            resolved_roles,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            metadata: HashMap::new(),
        }
    }

    /// Add metadata to the decision
    pub fn with_metadata(
        mut self,
        key: String,
        value: serde_json::Value,
    ) -> Self {
        self.metadata.insert(key, value);
        self
    }
}

/// Reason for authorization decision
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum DecisionReason {
    /// Policy matched and evaluated to allow/deny
    PolicyMatch { reason: String },

    /// No policies matched, using default decision
    DefaultDecision { reason: String },

    /// Error during evaluation
    EvaluationError { error: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_allow_decision() {
        let decision = AuthDecision::allow(
            "policy-1".to_string(),
            "User has required role".to_string(),
            vec!["employee".to_string(), "manager".to_string()],
        );

        assert!(decision.allowed);
        assert_eq!(decision.policy_id, "policy-1");
        assert_eq!(decision.resolved_roles.len(), 2);
        assert!(!decision.id.is_empty());
    }

    #[test]
    fn test_deny_decision() {
        let decision = AuthDecision::deny(
            "policy-2".to_string(),
            "Insufficient permissions".to_string(),
            vec!["user".to_string()],
        );

        assert!(!decision.allowed);
        assert_eq!(decision.policy_id, "policy-2");
    }

    #[test]
    fn test_decision_metadata() {
        let decision = AuthDecision::allow(
            "policy-1".to_string(),
            "Test".to_string(),
            vec![],
        )
        .with_metadata("latency_ms".to_string(), serde_json::json!(5))
        .with_metadata("cache_hit".to_string(), serde_json::json!(false));

        assert_eq!(decision.metadata.len(), 2);
    }
}
