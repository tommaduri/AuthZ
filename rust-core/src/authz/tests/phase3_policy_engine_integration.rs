//! Phase 3: Policy Engine Integration Tests
//!
//! Tests the complete authorization pipeline:
//! - Role resolution
//! - Scope filtering
//! - CEL evaluation
//! - Policy matching
//! - Caching
//! - Audit logging
//! - Metrics collection

use cretoai_authz::{
    PolicyEngine, EngineConfig, AuthRequest, AuthDecision,
    Policy, PolicyEffect, InMemoryPolicyStore,
    CacheConfig,
};
use cretoai_authz::engine::decision::{RequestPrincipal, RequestResource, RequestAction};
use cretoai_authz::derived_roles::{DerivedRole, RoleResolver};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

#[tokio::test]
async fn test_policy_engine_basic_authorization() {
    // Create engine
    let config = EngineConfig::default();
    let policy_store = Arc::new(InMemoryPolicyStore::new());
    let engine = PolicyEngine::new(config, policy_store.clone()).await.unwrap();

    // Add a policy
    let policy = Policy {
        id: "policy-1".to_string(),
        name: "Allow employees to read documents".to_string(),
        effect: PolicyEffect::Allow,
        principal: "user:*".to_string(),
        resource: "document:*".to_string(),
        action: "read".to_string(),
        condition: None,
        priority: 100,
    };

    policy_store.put(policy).await.unwrap();

    // Create request
    let request = AuthRequest {
        principal: RequestPrincipal {
            id: "user:alice@example.com".to_string(),
            roles: vec!["employee".to_string()],
            attributes: HashMap::new(),
        },
        resource: RequestResource {
            id: "document:123".to_string(),
            attributes: HashMap::new(),
        },
        action: RequestAction::new("read"),
        context: HashMap::new(),
    };

    // Authorize
    let decision = engine.authorize(&request).await.unwrap();

    assert!(decision.allowed);
    assert_eq!(decision.policy_id, "policy-1");
}

#[tokio::test]
async fn test_policy_engine_deny_decision() {
    let config = EngineConfig::default();
    let policy_store = Arc::new(InMemoryPolicyStore::new());
    let engine = PolicyEngine::new(config, policy_store.clone()).await.unwrap();

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

    policy_store.put(policy).await.unwrap();

    let request = AuthRequest {
        principal: RequestPrincipal {
            id: "user:alice@example.com".to_string(),
            roles: vec!["employee".to_string()],
            attributes: HashMap::new(),
        },
        resource: RequestResource {
            id: "document:sensitive-data".to_string(),
            attributes: HashMap::new(),
        },
        action: RequestAction::new("write"),
        context: HashMap::new(),
    };

    let decision = engine.authorize(&request).await.unwrap();

    assert!(!decision.allowed);
    assert_eq!(decision.policy_id, "policy-deny");
}

#[tokio::test]
async fn test_policy_engine_caching() {
    let config = EngineConfig::default();
    let policy_store = Arc::new(InMemoryPolicyStore::new());
    let engine = PolicyEngine::new(config, policy_store.clone()).await.unwrap();

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

    policy_store.put(policy).await.unwrap();

    let request = AuthRequest {
        principal: RequestPrincipal {
            id: "user:alice@example.com".to_string(),
            roles: vec!["employee".to_string()],
            attributes: HashMap::new(),
        },
        resource: RequestResource {
            id: "document:123".to_string(),
            attributes: HashMap::new(),
        },
        action: RequestAction::new("read"),
        context: HashMap::new(),
    };

    // First call - cache miss
    let decision1 = engine.authorize(&request).await.unwrap();

    // Second call - cache hit
    let start = std::time::Instant::now();
    let decision2 = engine.authorize(&request).await.unwrap();
    let latency = start.elapsed();

    // Cache hit should be faster (< 1ms)
    assert!(latency < Duration::from_millis(1));
    assert_eq!(decision1.id, decision2.id);

    // Check cache stats
    let cache_stats = engine.get_cache_stats().await.unwrap();
    assert_eq!(cache_stats.hits, 1);
    assert_eq!(cache_stats.misses, 1);
    assert!(cache_stats.hit_rate() > 0.0);
}

#[tokio::test]
async fn test_policy_engine_cel_evaluation() {
    let config = EngineConfig::default();
    let policy_store = Arc::new(InMemoryPolicyStore::new());
    let engine = PolicyEngine::new(config, policy_store.clone()).await.unwrap();

    // Policy with CEL condition
    let policy = Policy {
        id: "policy-cel".to_string(),
        name: "Allow admins only".to_string(),
        effect: PolicyEffect::Allow,
        principal: "user:*".to_string(),
        resource: "document:*".to_string(),
        action: "write".to_string(),
        condition: Some("'admin' in principal.roles".to_string()),
        priority: 100,
    };

    policy_store.put(policy).await.unwrap();

    // Request without admin role - should be denied
    let request1 = AuthRequest {
        principal: RequestPrincipal {
            id: "user:alice@example.com".to_string(),
            roles: vec!["employee".to_string()],
            attributes: HashMap::new(),
        },
        resource: RequestResource {
            id: "document:123".to_string(),
            attributes: HashMap::new(),
        },
        action: RequestAction::new("write"),
        context: HashMap::new(),
    };

    let decision1 = engine.authorize(&request1).await.unwrap();
    assert!(!decision1.allowed);

    // Request with admin role - should be allowed
    let request2 = AuthRequest {
        principal: RequestPrincipal {
            id: "user:bob@example.com".to_string(),
            roles: vec!["employee".to_string(), "admin".to_string()],
            attributes: HashMap::new(),
        },
        resource: RequestResource {
            id: "document:123".to_string(),
            attributes: HashMap::new(),
        },
        action: RequestAction::new("write"),
        context: HashMap::new(),
    };

    let decision2 = engine.authorize(&request2).await.unwrap();
    assert!(decision2.allowed);
    assert_eq!(decision2.policy_id, "policy-cel");
}

#[tokio::test]
async fn test_policy_engine_metrics() {
    let config = EngineConfig::default();
    let policy_store = Arc::new(InMemoryPolicyStore::new());
    let engine = PolicyEngine::new(config, policy_store.clone()).await.unwrap();

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

    policy_store.put(policy).await.unwrap();

    let request = AuthRequest {
        principal: RequestPrincipal {
            id: "user:alice@example.com".to_string(),
            roles: vec!["employee".to_string()],
            attributes: HashMap::new(),
        },
        resource: RequestResource {
            id: "document:123".to_string(),
            attributes: HashMap::new(),
        },
        action: RequestAction::new("read"),
        context: HashMap::new(),
    };

    // Make several requests
    for _ in 0..5 {
        engine.authorize(&request).await.unwrap();
    }

    // Check metrics
    let metrics = engine.get_metrics().await.unwrap();
    assert!(metrics.total_requests >= 5);
    assert!(metrics.allowed_decisions > 0);
    assert!(metrics.avg_latency_ms > 0.0);
    assert!(metrics.latency_p99_ms > 0.0);
}

#[tokio::test]
async fn test_policy_engine_cache_invalidation() {
    let config = EngineConfig::default();
    let policy_store = Arc::new(InMemoryPolicyStore::new());
    let engine = PolicyEngine::new(config, policy_store.clone()).await.unwrap();

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

    policy_store.put(policy).await.unwrap();

    let request = AuthRequest {
        principal: RequestPrincipal {
            id: "user:alice@example.com".to_string(),
            roles: vec!["employee".to_string()],
            attributes: HashMap::new(),
        },
        resource: RequestResource {
            id: "document:123".to_string(),
            attributes: HashMap::new(),
        },
        action: RequestAction::new("read"),
        context: HashMap::new(),
    };

    // Cache a decision
    engine.authorize(&request).await.unwrap();

    let stats1 = engine.get_cache_stats().await.unwrap();
    assert_eq!(stats1.entries, 1);

    // Invalidate cache
    engine.invalidate_cache().await;

    let stats2 = engine.get_cache_stats().await.unwrap();
    assert_eq!(stats2.entries, 0);
}

#[tokio::test]
async fn test_policy_engine_performance() {
    let config = EngineConfig {
        enable_cache: true,
        cache_config: CacheConfig::default(),
        enable_audit: false, // Disable audit for pure performance test
        enable_metrics: true,
        default_decision: PolicyEffect::Deny,
    };

    let policy_store = Arc::new(InMemoryPolicyStore::new());
    let engine = PolicyEngine::new(config, policy_store.clone()).await.unwrap();

    // Add multiple policies
    for i in 0..10 {
        let policy = Policy {
            id: format!("policy-{}", i),
            name: format!("Test policy {}", i),
            effect: PolicyEffect::Allow,
            principal: "user:*".to_string(),
            resource: format!("document:{}*", i),
            action: "read".to_string(),
            condition: None,
            priority: 100 + i,
        };

        policy_store.put(policy).await.unwrap();
    }

    let request = AuthRequest {
        principal: RequestPrincipal {
            id: "user:alice@example.com".to_string(),
            roles: vec!["employee".to_string()],
            attributes: HashMap::new(),
        },
        resource: RequestResource {
            id: "document:5-test".to_string(),
            attributes: HashMap::new(),
        },
        action: RequestAction::new("read"),
        context: HashMap::new(),
    };

    // Measure latency over 100 requests
    let mut latencies = Vec::new();

    for _ in 0..100 {
        let start = std::time::Instant::now();
        engine.authorize(&request).await.unwrap();
        latencies.push(start.elapsed());
    }

    // Calculate p99 latency
    latencies.sort();
    let p99_idx = (latencies.len() as f64 * 0.99) as usize;
    let p99_latency = latencies[p99_idx];

    println!("P99 latency: {:?}", p99_latency);

    // P99 should be < 10ms (target from requirements)
    assert!(
        p99_latency < Duration::from_millis(10),
        "P99 latency {:?} exceeds 10ms target",
        p99_latency
    );

    // Check metrics
    let metrics = engine.get_metrics().await.unwrap();
    assert_eq!(metrics.total_requests, 100);
    assert!(metrics.latency_p99_ms < 10.0);
    assert!(metrics.cache_hit_rate() > 0.8); // > 80% cache hit rate
}

#[tokio::test]
async fn test_policy_engine_default_deny() {
    let config = EngineConfig {
        default_decision: PolicyEffect::Deny,
        ..Default::default()
    };

    let policy_store = Arc::new(InMemoryPolicyStore::new());
    let engine = PolicyEngine::new(config, policy_store).await.unwrap();

    let request = AuthRequest {
        principal: RequestPrincipal {
            id: "user:alice@example.com".to_string(),
            roles: vec!["employee".to_string()],
            attributes: HashMap::new(),
        },
        resource: RequestResource {
            id: "document:123".to_string(),
            attributes: HashMap::new(),
        },
        action: RequestAction::new("read"),
        context: HashMap::new(),
    };

    // No policies - should default to deny
    let decision = engine.authorize(&request).await.unwrap();

    assert!(!decision.allowed);
    assert_eq!(decision.policy_id, "default");
}
