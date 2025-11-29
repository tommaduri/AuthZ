//! Policy definition and storage

use crate::error::{AuthzError, Result};
use crate::types::{PolicyId, AuthzRequest, Decision};
use crate::cel::{Engine as CelEngine, EvalContext};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
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
    pub async fn evaluate_condition(&self, request: &AuthzRequest) -> Result<bool> {
        // If no condition, return true
        let Some(condition_expr) = &self.condition else {
            return Ok(true);
        };

        // Create CEL engine
        let engine = CelEngine::new();

        // Build evaluation context from request
        let eval_context = Self::build_eval_context(request);

        // Evaluate CEL expression
        engine.evaluate_expression(condition_expr, &eval_context)
            .map_err(|e| AuthzError::EvaluationError(format!("CEL evaluation failed: {}", e)))
    }

    /// Build CEL evaluation context from authorization request
    fn build_eval_context(request: &AuthzRequest) -> EvalContext {
        // Convert principal to JSON-compatible map
        let mut principal_map = HashMap::new();
        principal_map.insert("id".to_string(), Value::String(request.principal.id.clone()));
        principal_map.insert("type".to_string(), Value::String(request.principal.principal_type.clone()));

        // Add principal attributes
        for (key, value) in &request.principal.attributes {
            principal_map.insert(key.clone(), Value::String(value.clone()));
        }

        // Convert resource to JSON-compatible map
        let mut resource_map = HashMap::new();
        resource_map.insert("id".to_string(), Value::String(request.resource.id.clone()));
        resource_map.insert("type".to_string(), Value::String(request.resource.resource_type.clone()));

        // Add resource attributes
        let mut attributes_map = HashMap::new();
        for (key, value) in &request.resource.attributes {
            attributes_map.insert(key.clone(), Value::String(value.clone()));
        }
        if !attributes_map.is_empty() {
            resource_map.insert("attributes".to_string(), Value::Object(
                attributes_map.into_iter().map(|(k, v)| (k, v)).collect()
            ));
        }

        // Convert request context to JSON-compatible map
        let mut request_map = HashMap::new();
        request_map.insert("action".to_string(), Value::String(request.action.name.clone()));

        // Add additional context
        for (key, value) in &request.context {
            request_map.insert(key.clone(), Value::String(value.clone()));
        }

        // Build evaluation context
        EvalContext::new()
            .with_principal(principal_map)
            .with_resource(resource_map)
            .with_request(request_map)
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

    #[tokio::test]
    async fn test_cel_condition_evaluation_no_condition() {
        let policy = Policy {
            id: "policy-1".to_string(),
            name: "Policy without condition".to_string(),
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

        let result = policy.evaluate_condition(&request).await.unwrap();
        assert!(result, "Policy with no condition should return true");
    }

    #[tokio::test]
    async fn test_cel_condition_evaluation_simple_true() {
        let policy = Policy {
            id: "policy-1".to_string(),
            name: "Policy with simple true condition".to_string(),
            effect: PolicyEffect::Allow,
            principal: "user:*".to_string(),
            resource: "document:*".to_string(),
            action: "read".to_string(),
            condition: Some("true".to_string()),
            priority: 100,
        };

        let request = AuthzRequest {
            principal: Principal::new("user:alice@example.com"),
            resource: Resource::new("document:123"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let result = policy.evaluate_condition(&request).await.unwrap();
        assert!(result);
    }

    #[tokio::test]
    async fn test_cel_condition_evaluation_simple_false() {
        let policy = Policy {
            id: "policy-1".to_string(),
            name: "Policy with simple false condition".to_string(),
            effect: PolicyEffect::Allow,
            principal: "user:*".to_string(),
            resource: "document:*".to_string(),
            action: "read".to_string(),
            condition: Some("false".to_string()),
            priority: 100,
        };

        let request = AuthzRequest {
            principal: Principal::new("user:alice@example.com"),
            resource: Resource::new("document:123"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let result = policy.evaluate_condition(&request).await.unwrap();
        assert!(!result);
    }

    #[tokio::test]
    async fn test_cel_condition_principal_check() {
        let policy = Policy {
            id: "policy-1".to_string(),
            name: "Check principal ID".to_string(),
            effect: PolicyEffect::Allow,
            principal: "user:*".to_string(),
            resource: "document:*".to_string(),
            action: "read".to_string(),
            condition: Some("principal.id == 'user:alice@example.com'".to_string()),
            priority: 100,
        };

        let request = AuthzRequest {
            principal: Principal::new("user:alice@example.com"),
            resource: Resource::new("document:123"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let result = policy.evaluate_condition(&request).await.unwrap();
        assert!(result);

        // Test with different principal
        let request2 = AuthzRequest {
            principal: Principal::new("user:bob@example.com"),
            resource: Resource::new("document:123"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let result2 = policy.evaluate_condition(&request2).await.unwrap();
        assert!(!result2);
    }

    #[tokio::test]
    async fn test_cel_condition_resource_attribute() {
        let policy = Policy {
            id: "policy-1".to_string(),
            name: "Check resource owner".to_string(),
            effect: PolicyEffect::Allow,
            principal: "user:*".to_string(),
            resource: "document:*".to_string(),
            action: "read".to_string(),
            condition: Some("principal.id == resource.attributes.owner".to_string()),
            priority: 100,
        };

        let request = AuthzRequest {
            principal: Principal::new("user:alice@example.com"),
            resource: Resource::new("document:123")
                .with_attribute("owner", "user:alice@example.com"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let result = policy.evaluate_condition(&request).await.unwrap();
        assert!(result);

        // Test with different owner
        let request2 = AuthzRequest {
            principal: Principal::new("user:alice@example.com"),
            resource: Resource::new("document:123")
                .with_attribute("owner", "user:bob@example.com"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let result2 = policy.evaluate_condition(&request2).await.unwrap();
        assert!(!result2);
    }

    #[tokio::test]
    async fn test_cel_condition_principal_attribute() {
        let policy = Policy {
            id: "policy-1".to_string(),
            name: "Check principal role".to_string(),
            effect: PolicyEffect::Allow,
            principal: "user:*".to_string(),
            resource: "document:*".to_string(),
            action: "read".to_string(),
            condition: Some("principal.role == 'admin'".to_string()),
            priority: 100,
        };

        let request = AuthzRequest {
            principal: Principal::new("user:alice@example.com")
                .with_attribute("role", "admin"),
            resource: Resource::new("document:123"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let result = policy.evaluate_condition(&request).await.unwrap();
        assert!(result);

        // Test with different role
        let request2 = AuthzRequest {
            principal: Principal::new("user:bob@example.com")
                .with_attribute("role", "viewer"),
            resource: Resource::new("document:123"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let result2 = policy.evaluate_condition(&request2).await.unwrap();
        assert!(!result2);
    }

    #[tokio::test]
    async fn test_cel_condition_complex_expression() {
        let policy = Policy {
            id: "policy-1".to_string(),
            name: "Complex condition".to_string(),
            effect: PolicyEffect::Allow,
            principal: "user:*".to_string(),
            resource: "document:*".to_string(),
            action: "write".to_string(),
            condition: Some(
                "(principal.role == 'admin') || (principal.id == resource.attributes.owner)"
                    .to_string()
            ),
            priority: 100,
        };

        // Test admin
        let request1 = AuthzRequest {
            principal: Principal::new("user:alice@example.com")
                .with_attribute("role", "admin"),
            resource: Resource::new("document:123")
                .with_attribute("owner", "user:bob@example.com"),
            action: Action::new("write"),
            context: HashMap::new(),
        };

        let result1 = policy.evaluate_condition(&request1).await.unwrap();
        assert!(result1, "Admin should be allowed");

        // Test owner
        let request2 = AuthzRequest {
            principal: Principal::new("user:bob@example.com")
                .with_attribute("role", "viewer"),
            resource: Resource::new("document:123")
                .with_attribute("owner", "user:bob@example.com"),
            action: Action::new("write"),
            context: HashMap::new(),
        };

        let result2 = policy.evaluate_condition(&request2).await.unwrap();
        assert!(result2, "Owner should be allowed");

        // Test neither admin nor owner
        let request3 = AuthzRequest {
            principal: Principal::new("user:charlie@example.com")
                .with_attribute("role", "viewer"),
            resource: Resource::new("document:123")
                .with_attribute("owner", "user:bob@example.com"),
            action: Action::new("write"),
            context: HashMap::new(),
        };

        let result3 = policy.evaluate_condition(&request3).await.unwrap();
        assert!(!result3, "Non-admin non-owner should be denied");
    }

    #[tokio::test]
    async fn test_cel_condition_invalid_expression() {
        let policy = Policy {
            id: "policy-1".to_string(),
            name: "Invalid CEL expression".to_string(),
            effect: PolicyEffect::Allow,
            principal: "user:*".to_string(),
            resource: "document:*".to_string(),
            action: "read".to_string(),
            condition: Some("invalid syntax @#$".to_string()),
            priority: 100,
        };

        let request = AuthzRequest {
            principal: Principal::new("user:alice@example.com"),
            resource: Resource::new("document:123"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let result = policy.evaluate_condition(&request).await;
        assert!(result.is_err(), "Invalid CEL expression should return error");
    }

    #[tokio::test]
    async fn test_cel_condition_non_boolean_result() {
        let policy = Policy {
            id: "policy-1".to_string(),
            name: "Non-boolean result".to_string(),
            effect: PolicyEffect::Allow,
            principal: "user:*".to_string(),
            resource: "document:*".to_string(),
            action: "read".to_string(),
            condition: Some("'hello world'".to_string()),
            priority: 100,
        };

        let request = AuthzRequest {
            principal: Principal::new("user:alice@example.com"),
            resource: Resource::new("document:123"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let result = policy.evaluate_condition(&request).await;
        assert!(result.is_err(), "Non-boolean CEL result should return error");
    }
}
