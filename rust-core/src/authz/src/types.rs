//! Core authorization types

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// Unique policy identifier
pub type PolicyId = String;

/// Unique role identifier
pub type RoleId = String;

/// Unique permission identifier
pub type PermissionId = String;

/// Principal (user, service account, agent)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Principal {
    /// Principal identifier (e.g., "user:alice@example.com", "agent:shopping-bot")
    pub id: String,

    /// Principal type (user, service, agent, etc.)
    #[serde(rename = "type")]
    pub principal_type: String,

    /// Additional attributes (e.g., department, roles)
    #[serde(default)]
    pub attributes: HashMap<String, String>,
}

impl Principal {
    /// Create a new principal from an ID string
    pub fn new(id: impl Into<String>) -> Self {
        let id = id.into();
        let principal_type = id.split(':').next().unwrap_or("user").to_string();

        Self {
            id,
            principal_type,
            attributes: HashMap::new(),
        }
    }

    /// Add an attribute to the principal
    pub fn with_attribute(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.attributes.insert(key.into(), value.into());
        self
    }
}

/// Resource being accessed
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Resource {
    /// Resource identifier (e.g., "document:123", "api:payments")
    pub id: String,

    /// Resource type (document, api, database, etc.)
    #[serde(rename = "type")]
    pub resource_type: String,

    /// Additional attributes (e.g., owner, sensitivity_level)
    #[serde(default)]
    pub attributes: HashMap<String, String>,
}

impl Resource {
    /// Create a new resource from an ID string
    pub fn new(id: impl Into<String>) -> Self {
        let id = id.into();
        let resource_type = id.split(':').next().unwrap_or("resource").to_string();

        Self {
            id,
            resource_type,
            attributes: HashMap::new(),
        }
    }

    /// Add an attribute to the resource
    pub fn with_attribute(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.attributes.insert(key.into(), value.into());
        self
    }
}

/// Action being performed
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Action {
    /// Action name (read, write, delete, execute, etc.)
    pub name: String,
}

impl Action {
    /// Create a new action
    pub fn new(name: impl Into<String>) -> Self {
        Self { name: name.into() }
    }
}

/// Authorization request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthzRequest {
    /// Who is making the request
    pub principal: Principal,

    /// What resource is being accessed
    pub resource: Resource,

    /// What action is being performed
    pub action: Action,

    /// Additional context (IP address, time, etc.)
    #[serde(default)]
    pub context: HashMap<String, String>,
}

/// Authorization decision
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Decision {
    /// Unique decision identifier
    pub id: String,

    /// Whether the request is allowed
    pub allowed: bool,

    /// Policy that made the decision
    pub policy_id: String,

    /// Reason for the decision
    pub reason: String,

    /// Decision timestamp (milliseconds since epoch)
    pub timestamp: u64,

    /// Optional signature for audit trail
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<Vec<u8>>,
}

impl Decision {
    /// Create a new decision
    pub fn new(allowed: bool, policy_id: impl Into<String>, reason: impl Into<String>) -> Self {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        Self {
            id: Uuid::new_v4().to_string(),
            allowed,
            policy_id: policy_id.into(),
            reason: reason.into(),
            timestamp,
            signature: None,
        }
    }

    /// Allow decision
    pub fn allow(policy_id: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::new(true, policy_id, reason)
    }

    /// Deny decision
    pub fn deny(policy_id: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::new(false, policy_id, reason)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_principal_creation() {
        let principal = Principal::new("user:alice@example.com")
            .with_attribute("department", "engineering")
            .with_attribute("role", "developer");

        assert_eq!(principal.id, "user:alice@example.com");
        assert_eq!(principal.principal_type, "user");
        assert_eq!(principal.attributes.get("department"), Some(&"engineering".to_string()));
    }

    #[test]
    fn test_resource_creation() {
        let resource = Resource::new("document:secret-123")
            .with_attribute("owner", "alice")
            .with_attribute("sensitivity", "high");

        assert_eq!(resource.id, "document:secret-123");
        assert_eq!(resource.resource_type, "document");
        assert_eq!(resource.attributes.get("sensitivity"), Some(&"high".to_string()));
    }

    #[test]
    fn test_decision_creation() {
        let decision = Decision::allow("policy-1", "User has required permission");
        assert!(decision.allowed);
        assert_eq!(decision.policy_id, "policy-1");
        assert!(!decision.id.is_empty());

        let deny = Decision::deny("policy-2", "Insufficient permissions");
        assert!(!deny.allowed);
    }
}
