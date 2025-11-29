//! Authorization engine implementation

use crate::audit::AuditTrail;
use crate::cache::AuthzCache;
use crate::error::{AuthzError, Result};
use crate::policy::{Policy, PolicyEffect, PolicyStore, InMemoryPolicyStore};
use crate::types::{AuthzRequest, Decision};
use async_trait::async_trait;
use std::sync::Arc;
use tracing::{debug, info, warn};

/// Authorization engine configuration
#[derive(Debug, Clone)]
pub struct EngineConfig {
    /// Enable caching of authorization decisions
    pub enable_cache: bool,

    /// Cache capacity (number of decisions to cache)
    pub cache_capacity: usize,

    /// Enable DAG-based audit trail
    pub enable_audit: bool,

    /// Default decision when no policy matches (deny by default)
    pub default_decision: PolicyEffect,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            enable_cache: true,
            cache_capacity: 10000,
            enable_audit: false,  // Disabled by default (requires DAG feature)
            default_decision: PolicyEffect::Deny,
        }
    }
}

/// Authorization engine
pub struct AuthzEngine {
    config: EngineConfig,
    policy_store: Arc<dyn PolicyStore>,
    cache: Option<Arc<AuthzCache>>,
    audit: Option<Arc<AuditTrail>>,
}

impl AuthzEngine {
    /// Create a new authorization engine with default configuration
    pub async fn new() -> Result<Self> {
        Self::with_config(EngineConfig::default()).await
    }

    /// Create a new authorization engine with custom configuration
    pub async fn with_config(config: EngineConfig) -> Result<Self> {
        let policy_store = Arc::new(InMemoryPolicyStore::new()) as Arc<dyn PolicyStore>;

        let cache = if config.enable_cache {
            Some(Arc::new(AuthzCache::new(config.cache_capacity)))
        } else {
            None
        };

        let audit = if config.enable_audit {
            Some(Arc::new(AuditTrail::new().await?))
        } else {
            None
        };

        Ok(Self {
            config,
            policy_store,
            cache,
            audit,
        })
    }

    /// Create an engine with a custom policy store
    pub async fn with_store(
        config: EngineConfig,
        policy_store: Arc<dyn PolicyStore>,
    ) -> Result<Self> {
        let cache = if config.enable_cache {
            Some(Arc::new(AuthzCache::new(config.cache_capacity)))
        } else {
            None
        };

        let audit = if config.enable_audit {
            Some(Arc::new(AuditTrail::new().await?))
        } else {
            None
        };

        Ok(Self {
            config,
            policy_store,
            cache,
            audit,
        })
    }

    /// Check an authorization request
    pub async fn check(&self, request: &AuthzRequest) -> Result<Decision> {
        debug!(
            "Checking authorization: principal={}, resource={}, action={}",
            request.principal.id, request.resource.id, request.action.name
        );

        // Check cache first
        if let Some(cache) = &self.cache {
            if let Some(cached_decision) = cache.get(request).await {
                debug!("Cache hit for request");
                return Ok(cached_decision);
            }
        }

        // Find matching policies
        let policies = self.policy_store.find_matching(request).await?;

        if policies.is_empty() {
            debug!("No policies match the request");
            let decision = match self.config.default_decision {
                PolicyEffect::Allow => Decision::allow(
                    "default",
                    "No policies match, default allow",
                ),
                PolicyEffect::Deny => Decision::deny(
                    "default",
                    "No policies match, default deny",
                ),
            };

            self.finalize_decision(request, decision).await
        } else {
            // Evaluate policies in priority order
            self.evaluate_policies(request, &policies).await
        }
    }

    /// Evaluate policies against the request
    async fn evaluate_policies(
        &self,
        request: &AuthzRequest,
        policies: &[Policy],
    ) -> Result<Decision> {
        for policy in policies {
            debug!("Evaluating policy: {}", policy.id);

            // Check condition if present
            if let Some(condition) = &policy.condition {
                match policy.evaluate_condition(request).await {
                    Ok(true) => {
                        debug!("Policy condition passed: {}", policy.id);
                    }
                    Ok(false) => {
                        debug!("Policy condition failed: {}", policy.id);
                        continue;
                    }
                    Err(e) => {
                        warn!("Error evaluating policy condition: {}", e);
                        continue;
                    }
                }
            }

            // Policy matches and condition passed
            let decision = match policy.effect {
                PolicyEffect::Allow => Decision::allow(
                    policy.id.clone(),
                    format!("Policy '{}' allows this action", policy.name),
                ),
                PolicyEffect::Deny => Decision::deny(
                    policy.id.clone(),
                    format!("Policy '{}' denies this action", policy.name),
                ),
            };

            info!(
                "Decision: {} by policy '{}' ({})",
                if decision.allowed { "ALLOW" } else { "DENY" },
                policy.name,
                policy.id
            );

            return self.finalize_decision(request, decision).await;
        }

        // No policies matched after evaluation
        let decision = match self.config.default_decision {
            PolicyEffect::Allow => Decision::allow(
                "default",
                "No policies matched conditions, default allow",
            ),
            PolicyEffect::Deny => Decision::deny(
                "default",
                "No policies matched conditions, default deny",
            ),
        };

        self.finalize_decision(request, decision).await
    }

    /// Finalize the decision (cache, audit, sign)
    async fn finalize_decision(
        &self,
        request: &AuthzRequest,
        mut decision: Decision,
    ) -> Result<Decision> {
        // Add to audit trail
        if let Some(audit) = &self.audit {
            decision = audit.record_decision(request, decision).await?;
        }

        // Cache the decision
        if let Some(cache) = &self.cache {
            cache.put(request, decision.clone()).await;
        }

        Ok(decision)
    }

    /// Add a policy to the engine
    pub async fn add_policy(&self, policy: Policy) -> Result<()> {
        info!("Adding policy: {} ({})", policy.name, policy.id);
        self.policy_store.put(policy).await?;

        // Clear cache when policies change
        if let Some(cache) = &self.cache {
            cache.clear().await;
        }

        Ok(())
    }

    /// Remove a policy from the engine
    pub async fn remove_policy(&self, policy_id: &str) -> Result<()> {
        info!("Removing policy: {}", policy_id);
        self.policy_store.delete(policy_id).await?;

        // Clear cache when policies change
        if let Some(cache) = &self.cache {
            cache.clear().await;
        }

        Ok(())
    }

    /// List all policies
    pub async fn list_policies(&self) -> Result<Vec<Policy>> {
        self.policy_store.list().await
    }

    /// Clear the decision cache
    pub async fn clear_cache(&self) {
        if let Some(cache) = &self.cache {
            cache.clear().await;
            info!("Decision cache cleared");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Principal, Resource, Action};
    use std::collections::HashMap;

    #[tokio::test]
    async fn test_engine_allow_decision() {
        let engine = AuthzEngine::new().await.unwrap();

        // Add a policy
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

        engine.add_policy(policy).await.unwrap();

        // Check authorization
        let request = AuthzRequest {
            principal: Principal::new("user:alice@example.com"),
            resource: Resource::new("document:123"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let decision = engine.check(&request).await.unwrap();
        assert!(decision.allowed);
        assert_eq!(decision.policy_id, "policy-1");
    }

    #[tokio::test]
    async fn test_engine_deny_decision() {
        let engine = AuthzEngine::new().await.unwrap();

        // Add a deny policy
        let policy = Policy {
            id: "policy-deny".to_string(),
            name: "Deny writes to sensitive documents".to_string(),
            effect: PolicyEffect::Deny,
            principal: "*".to_string(),
            resource: "document:sensitive-*".to_string(),
            action: "write".to_string(),
            condition: None,
            priority: 200,
        };

        engine.add_policy(policy).await.unwrap();

        // Check authorization
        let request = AuthzRequest {
            principal: Principal::new("user:alice@example.com"),
            resource: Resource::new("document:sensitive-data"),
            action: Action::new("write"),
            context: HashMap::new(),
        };

        let decision = engine.check(&request).await.unwrap();
        assert!(!decision.allowed);
        assert_eq!(decision.policy_id, "policy-deny");
    }

    #[tokio::test]
    async fn test_engine_caching() {
        let engine = AuthzEngine::new().await.unwrap();

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

        engine.add_policy(policy).await.unwrap();

        let request = AuthzRequest {
            principal: Principal::new("user:alice@example.com"),
            resource: Resource::new("document:123"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        // First check (cache miss)
        let decision1 = engine.check(&request).await.unwrap();

        // Second check (cache hit)
        let decision2 = engine.check(&request).await.unwrap();

        assert_eq!(decision1.id, decision2.id);
    }
}
