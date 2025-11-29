//! Phase 3: Integrated Policy Engine
//!
//! Orchestrates role resolution, scope filtering, CEL evaluation, and policy matching
//! with multi-level caching, audit logging, and metrics.

pub mod decision;
pub mod cache;
#[cfg(feature = "postgres")]
pub mod audit;
pub mod metrics;

pub use decision::{AuthRequest, AuthDecision, DecisionReason, RequestPrincipal, RequestResource, RequestAction};
pub use cache::{DecisionCache, CacheConfig};
#[cfg(feature = "postgres")]
pub use audit::{AuditLogger, AuditEntry};
pub use metrics::{MetricsCollector, EngineMetrics};

use crate::derived_roles::RoleResolver;
use crate::scope::{Scope, ScopeResolver};
use crate::policy::{PolicyStore, Policy, PolicyEffect};
use crate::cel::engine::Engine as CelEvaluator;
use crate::cel::context::EvalContext;
use crate::error::{AuthzError, Result};

use std::sync::Arc;
use std::time::Instant;
use tracing::{debug, info, warn};

/// Policy Engine configuration
#[derive(Debug, Clone)]
pub struct EngineConfig {
    /// Enable multi-level caching
    pub enable_cache: bool,

    /// Cache configuration
    pub cache_config: CacheConfig,

    /// Enable audit logging
    pub enable_audit: bool,

    /// Enable metrics collection
    pub enable_metrics: bool,

    /// Default decision when no policy matches
    pub default_decision: PolicyEffect,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            enable_cache: true,
            cache_config: CacheConfig::default(),
            enable_audit: true,
            enable_metrics: true,
            default_decision: PolicyEffect::Deny,
        }
    }
}

/// Main Policy Engine - orchestrates all authorization components
///
/// # Architecture
///
/// ```text
/// Request → RoleResolver → ScopeResolver → PolicyStore → CEL → Decision
///             ↓              ↓                ↓           ↓       ↓
///          [Cache] ──────────────────────────────────────────┘
///             ↓                                               ↓
///          [Audit Log]                                    [Metrics]
/// ```
pub struct PolicyEngine {
    /// Role resolution with caching
    role_resolver: Arc<RoleResolver>,

    /// Scope resolution with hierarchical chain building
    scope_resolver: Arc<ScopeResolver>,

    /// Policy storage backend
    policy_store: Arc<dyn PolicyStore>,

    /// CEL expression evaluator with program caching
    cel_evaluator: Arc<CelEvaluator>,

    /// Multi-level decision cache (in-memory + optional Redis)
    cache: Option<Arc<DecisionCache>>,

    /// Audit logger (PostgreSQL backend)
    #[cfg(feature = "postgres")]
    audit_logger: Option<Arc<AuditLogger>>,

    /// Metrics collector (Prometheus)
    metrics: Option<Arc<MetricsCollector>>,

    /// Engine configuration
    config: EngineConfig,
}

impl PolicyEngine {
    /// Create a new Policy Engine with the given configuration
    ///
    /// # Arguments
    ///
    /// * `config` - Engine configuration
    /// * `policy_store` - Policy storage backend
    ///
    /// # Returns
    ///
    /// Initialized Policy Engine ready to process authorization requests
    pub async fn new(
        config: EngineConfig,
        policy_store: Arc<dyn PolicyStore>,
    ) -> Result<Self> {
        let role_resolver = Arc::new(RoleResolver::new());
        let scope_resolver = Arc::new(ScopeResolver::new());
        let cel_evaluator = Arc::new(CelEvaluator::new());

        let cache = if config.enable_cache {
            Some(Arc::new(DecisionCache::new(config.cache_config.clone()).await?))
        } else {
            None
        };

        #[cfg(feature = "postgres")]
        let audit_logger = if config.enable_audit {
            Some(Arc::new(AuditLogger::new().await?))
        } else {
            None
        };

        let metrics = if config.enable_metrics {
            Some(Arc::new(MetricsCollector::new()))
        } else {
            None
        };

        info!("PolicyEngine initialized with cache={}, audit={}, metrics={}",
            config.enable_cache, config.enable_audit, config.enable_metrics);

        Ok(Self {
            role_resolver,
            scope_resolver,
            policy_store,
            cel_evaluator,
            cache,
            #[cfg(feature = "postgres")]
            audit_logger,
            metrics,
            config,
        })
    }

    /// Authorize a request through the complete policy evaluation pipeline
    ///
    /// # Pipeline
    ///
    /// 1. Check cache for previous decision
    /// 2. Resolve derived roles for principal
    /// 3. Build scope hierarchy for resource
    /// 4. Filter policies by principal/resource/action
    /// 5. Evaluate CEL conditions for matching policies
    /// 6. Return first allow/deny decision
    /// 7. Cache, audit, and record metrics
    ///
    /// # Arguments
    ///
    /// * `request` - Authorization request with principal, resource, action, context
    ///
    /// # Returns
    ///
    /// Authorization decision with allow/deny, reason, and metadata
    pub async fn authorize(&self, request: &AuthRequest) -> Result<AuthDecision> {
        let start = Instant::now();

        debug!(
            "Authorization request: principal={}, resource={}, action={}",
            request.principal.id, request.resource.id, request.action.name
        );

        // Step 1: Check cache
        if let Some(cache) = &self.cache {
            if let Some(cached_decision) = cache.get(request).await {
                if let Some(metrics) = &self.metrics {
                    metrics.record_cache_hit().await;
                    metrics.record_latency(start.elapsed()).await;
                }

                debug!("Cache hit for request");
                return Ok(cached_decision);
            }

            if let Some(metrics) = &self.metrics {
                metrics.record_cache_miss().await;
            }
        }

        // Step 2: Resolve derived roles
        let resolved_roles = self.role_resolver
            .resolve_roles(
                &request.principal.roles,
                &request.context,
            )
            .await?;

        debug!("Resolved roles: {:?}", resolved_roles);

        // Step 3: Build scope hierarchy
        let resource_scope = Scope::new(&request.resource.id)
            .map_err(|e| AuthzError::InvalidInput(format!("Invalid resource scope: {}", e)))?;
        let scope_chain = self.scope_resolver.build_chain(&resource_scope);

        debug!("Scope chain: {} levels", scope_chain.len());

        // Step 4: Filter policies
        let matching_policies = self.policy_store
            .find_matching(&self.create_policy_request(request, &resolved_roles))
            .await?;

        if matching_policies.is_empty() {
            debug!("No policies match the request");
            let decision = self.create_default_decision(request, "No policies match");
            return self.finalize_decision(request, decision, start).await;
        }

        debug!("Found {} matching policies", matching_policies.len());

        // Step 5: Evaluate policies in priority order
        for policy in &matching_policies {
            debug!("Evaluating policy: {} (priority={})", policy.id, policy.priority);

            // Check if policy scope matches resource scope
            if let Some(policy_scope) = policy.resource.strip_prefix("scope:") {
                match self.scope_resolver.matches_pattern(&resource_scope, policy_scope) {
                    Ok(true) => {
                        debug!("Policy scope matches resource");
                    }
                    Ok(false) => {
                        debug!("Policy scope does not match resource");
                        continue;
                    }
                    Err(e) => {
                        warn!("Scope pattern matching error: {}", e);
                        continue;
                    }
                }
            }

            // Evaluate CEL condition if present
            if let Some(condition) = &policy.condition {
                let cel_context = self.create_cel_context(request, &resolved_roles);

                match self.cel_evaluator.evaluate_expression(condition, &cel_context) {
                    Ok(true) => {
                        debug!("CEL condition passed: {}", condition);
                    }
                    Ok(false) => {
                        debug!("CEL condition failed: {}", condition);
                        continue;
                    }
                    Err(e) => {
                        warn!("CEL evaluation error: {}", e);
                        continue;
                    }
                }
            }

            // Policy matches - return decision
            let decision = match policy.effect {
                PolicyEffect::Allow => AuthDecision::allow(
                    policy.id.clone(),
                    format!("Policy '{}' allows this action", policy.name),
                    resolved_roles.clone(),
                ),
                PolicyEffect::Deny => AuthDecision::deny(
                    policy.id.clone(),
                    format!("Policy '{}' denies this action", policy.name),
                    resolved_roles.clone(),
                ),
            };

            info!(
                "Decision: {} by policy '{}' ({})",
                if decision.allowed { "ALLOW" } else { "DENY" },
                policy.name,
                policy.id
            );

            return self.finalize_decision(request, decision, start).await;
        }

        // No policies matched after evaluation
        debug!("No policies matched after CEL evaluation");
        let decision = self.create_default_decision(
            request,
            "No policies matched conditions",
        );

        self.finalize_decision(request, decision, start).await
    }

    /// Invalidate cache on policy updates
    pub async fn invalidate_cache(&self) {
        if let Some(cache) = &self.cache {
            cache.clear().await;
            info!("Decision cache invalidated");
        }
    }

    /// Get engine metrics
    pub async fn get_metrics(&self) -> Option<EngineMetrics> {
        if let Some(metrics) = &self.metrics {
            Some(metrics.get_metrics().await)
        } else {
            None
        }
    }

    /// Get cache statistics
    pub async fn get_cache_stats(&self) -> Option<cache::CacheStats> {
        if let Some(cache) = &self.cache {
            Some(cache.stats().await)
        } else {
            None
        }
    }

    // Private helper methods

    fn create_policy_request(
        &self,
        request: &AuthRequest,
        resolved_roles: &[String],
    ) -> crate::types::AuthzRequest {
        use crate::types::{Principal, Resource, Action, AuthzRequest};
        use std::collections::HashMap as StdHashMap;

        let mut principal = Principal::new(&request.principal.id);
        for (k, v) in &request.principal.attributes {
            principal = principal.with_attribute(k.clone(), v.clone());
        }

        let mut resource = Resource::new(&request.resource.id);
        for (k, v) in &request.resource.attributes {
            resource = resource.with_attribute(k.clone(), v.clone());
        }

        // Convert serde_json::Value context to String context
        let mut context: StdHashMap<String, String> = StdHashMap::new();
        for (k, v) in &request.context {
            context.insert(k.clone(), v.to_string());
        }

        AuthzRequest {
            principal,
            resource,
            action: Action::new(&request.action.name),
            context,
        }
    }

    fn create_cel_context(
        &self,
        request: &AuthRequest,
        resolved_roles: &[String],
    ) -> EvalContext {
        use serde_json::json;
        use std::collections::HashMap as StdHashMap;

        let mut principal = StdHashMap::new();
        principal.insert("id".to_string(), json!(request.principal.id));
        principal.insert("roles".to_string(), json!(resolved_roles));
        for (k, v) in &request.principal.attributes {
            principal.insert(k.clone(), json!(v));
        }

        let mut resource = StdHashMap::new();
        resource.insert("id".to_string(), json!(request.resource.id));
        resource.insert("attributes".to_string(), json!(request.resource.attributes));

        EvalContext::new()
            .with_principal(principal)
            .with_resource(resource)
    }

    fn create_default_decision(
        &self,
        request: &AuthRequest,
        reason: &str,
    ) -> AuthDecision {
        match self.config.default_decision {
            PolicyEffect::Allow => AuthDecision::allow(
                "default".to_string(),
                format!("{}, default allow", reason),
                request.principal.roles.clone(),
            ),
            PolicyEffect::Deny => AuthDecision::deny(
                "default".to_string(),
                format!("{}, default deny", reason),
                request.principal.roles.clone(),
            ),
        }
    }

    async fn finalize_decision(
        &self,
        request: &AuthRequest,
        decision: AuthDecision,
        start: Instant,
    ) -> Result<AuthDecision> {
        let latency = start.elapsed();

        // Record metrics
        if let Some(metrics) = &self.metrics {
            metrics.record_latency(latency).await;
            metrics.record_decision(decision.allowed).await;
        }

        // Audit log
        #[cfg(feature = "postgres")]
        if let Some(audit) = &self.audit_logger {
            audit.log_decision(request, &decision, latency).await?;
        }

        // Cache decision
        if let Some(cache) = &self.cache {
            cache.put(request, decision.clone()).await;
        }

        Ok(decision)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::InMemoryPolicyStore;

    #[tokio::test]
    async fn test_engine_creation() {
        let config = EngineConfig::default();
        let policy_store = Arc::new(InMemoryPolicyStore::new());

        let engine = PolicyEngine::new(config, policy_store).await.unwrap();
        assert!(engine.cache.is_some());
        #[cfg(feature = "postgres")]
        assert!(engine.audit_logger.is_some());
        assert!(engine.metrics.is_some());
    }
}
