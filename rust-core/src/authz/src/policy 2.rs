//! Policy definition and storage

use crate::error::{AuthzError, Result};
use crate::types::{PolicyId, AuthzRequest, Decision};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[cfg(feature = "postgres")]
pub mod postgres;

#[cfg(feature = "postgres")]
pub use postgres::PostgresPolicyStore;

/// Policy effect
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum PolicyEffect {
    /// Allow the action
    Allow,
    /// Deny the action
    Deny,
}

/// Policy definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Policy {
    /// Unique policy identifier
    pub id: PolicyId,

    /// Policy name
    pub name: String,

    /// Policy effect (allow or deny)
    pub effect: PolicyEffect,

    /// Principal pattern (e.g., "user:*", "agent:shopping-*")
    pub principal: String,

    /// Resource pattern (e.g., "document:*", "api:payments")
    pub resource: String,

    /// Action pattern (e.g., "read", "write", "*")
    pub action: String,

    /// Optional CEL condition expression
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition: Option<String>,

    /// Policy priority (higher = evaluated first)
    #[serde(default)]
    pub priority: i32,
}

impl Policy {
    /// Check if this policy matches the request
    pub fn matches(&self, request: &AuthzRequest) -> bool {
        self.matches_pattern(&self.principal, &request.principal.id)
            && self.matches_pattern(&self.resource, &request.resource.id)
            && self.matches_pattern(&self.action, &request.action.name)
    }

    /// Match a pattern against a value (supports wildcards)
    fn matches_pattern(&self, pattern: &str, value: &str) -> bool {
        if pattern == "*" {
            return true;
        }

        if pattern.contains('*') {
            let regex_pattern = pattern.replace('.', r"\.").replace('*', ".*");
            if let Ok(regex) = regex::Regex::new(&format!("^{}$", regex_pattern)) {
                return regex.is_match(value);
            }
        }

        pattern == value
    }

    /// Evaluate the policy condition (CEL expression)
    pub async fn evaluate_condition(&self, _request: &AuthzRequest) -> Result<bool> {
        // TODO: Integrate CEL interpreter
        // For now, if no condition, return true
        if self.condition.is_none() {
            return Ok(true);
        }

        // Placeholder for CEL evaluation
        Ok(true)
    }
}

/// Policy store trait
#[async_trait]
pub trait PolicyStore: Send + Sync {
    /// Get a policy by ID
    async fn get(&self, id: &str) -> Result<Option<Policy>>;

    /// Store a policy
    async fn put(&self, policy: Policy) -> Result<()>;

    /// List all policies
    async fn list(&self) -> Result<Vec<Policy>>;

    /// Delete a policy
    async fn delete(&self, id: &str) -> Result<()>;

    /// Find policies matching a request (sorted by priority)
    async fn find_matching(&self, request: &AuthzRequest) -> Result<Vec<Policy>>;
}

/// In-memory policy store implementation
pub struct InMemoryPolicyStore {
    policies: Arc<RwLock<HashMap<PolicyId, Policy>>>,
}

impl InMemoryPolicyStore {
    /// Create a new in-memory policy store
    pub fn new() -> Self {
        Self {
            policies: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl Default for InMemoryPolicyStore {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl PolicyStore for InMemoryPolicyStore {
    async fn get(&self, id: &str) -> Result<Option<Policy>> {
        let policies = self.policies.read().await;
        Ok(policies.get(id).cloned())
    }

    async fn put(&self, policy: Policy) -> Result<()> {
        let mut policies = self.policies.write().await;
        policies.insert(policy.id.clone(), policy);
        Ok(())
    }

    async fn list(&self) -> Result<Vec<Policy>> {
        let policies = self.policies.read().await;
        Ok(policies.values().cloned().collect())
    }

    async fn delete(&self, id: &str) -> Result<()> {
        let mut policies = self.policies.write().await;
        policies.remove(id);
        Ok(())
    }

    async fn find_matching(&self, request: &AuthzRequest) -> Result<Vec<Policy>> {
        let policies = self.policies.read().await;
        let mut matching: Vec<Policy> = policies
            .values()
            .filter(|p| p.matches(request))
            .cloned()
            .collect();

        // Sort by priority (descending)
        matching.sort_by(|a, b| b.priority.cmp(&a.priority));

        Ok(matching)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Principal, Resource, Action};

    #[tokio::test]
    async fn test_policy_matching() {
        let policy = Policy {
            id: "policy-1".to_string(),
            name: "Allow users to read documents".to_string(),
            effect: PolicyEffect::Allow,
            principal: "user:*".to_string(),
            resource: "document:*".to_string(),
            action: "read".to_string(),
            condition: None,
            priority: 100,
        };

        let request = AuthzRequest {
            principal: Principal::new("user:alice@example.com"),
            resource: Resource::new("document:123"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        assert!(policy.matches(&request));
    }

    #[tokio::test]
    async fn test_policy_store() {
        let store = InMemoryPolicyStore::new();

        let policy = Policy {
            id: "policy-1".to_string(),
            name: "Test policy".to_string(),
            effect: PolicyEffect::Allow,
            principal: "user:*".to_string(),
            resource: "document:*".to_string(),
            action: "read".to_string(),
            condition: None,
            priority: 100,
        };

        store.put(policy.clone()).await.unwrap();

        let retrieved = store.get("policy-1").await.unwrap();
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().id, "policy-1");

        let all = store.list().await.unwrap();
        assert_eq!(all.len(), 1);
    }
}
