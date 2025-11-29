//! Phase 3 TDD: Policy Decision Engine Tests
//!
//! Tests for the complete authorization decision pipeline:
//! Role resolution → Scope matching → CEL evaluation → Policy decision

use cretoai_authz::{
    engine::{AuthzEngine, EngineConfig},
    error::{AuthzError, Result},
    policy::{Policy, PolicyEffect},
    types::{Action, AuthzRequest, Decision, Principal, Resource},
};
use proptest::prelude::*;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::time::{sleep, Duration};

// ============================================================================
// BASIC DECISION FLOW TESTS
// ============================================================================

#[tokio::test]
async fn test_complete_authorization_flow() {
    // TDD: This test defines the expected behavior for Phase 3
    // Setup: Create engine with role, scope, and policy
    let config = EngineConfig {
        enable_cache: true,
        cache_capacity: 1000,
        enable_audit: true,
        default_decision: PolicyEffect::Deny,
    };

    let engine = AuthzEngine::with_config(config).await.unwrap();

    // Add a policy with CEL condition
    let policy = Policy {
        id: "policy-read-docs".to_string(),
        name: "Allow users to read documents".to_string(),
        effect: PolicyEffect::Allow,
        principal: "user:*".to_string(),
        resource: "document:*".to_string(),
        action: "read".to_string(),
        condition: Some("resource.attributes.owner == principal.id".to_string()),
        priority: 100,
    };

    engine.add_policy(policy).await.unwrap();

    // Execute: Check authorization
    let request = AuthzRequest {
        principal: Principal::new("user:alice@example.com")
            .with_attribute("role", "developer"),
        resource: Resource::new("document:123")
            .with_attribute("owner", "user:alice@example.com"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    let decision = engine.check(&request).await.unwrap();

    // Assert: Correct decision + cached + audited
    assert!(decision.allowed, "Decision should allow access");
    assert_eq!(decision.policy_id, "policy-read-docs");
    assert!(decision.signature.is_some(), "Decision should be signed for audit");

    // Verify decision is cached
    let cached_decision = engine.check(&request).await.unwrap();
    assert_eq!(decision.id, cached_decision.id, "Decision should be cached");
}

#[tokio::test]
async fn test_role_resolution_in_decision() {
    // TDD: Test role-based authorization with derived roles
    let engine = AuthzEngine::new().await.unwrap();

    // Policy that requires "admin" role
    let policy = Policy {
        id: "admin-policy".to_string(),
        name: "Admins can delete resources".to_string(),
        effect: PolicyEffect::Allow,
        principal: "role:admin".to_string(),
        resource: "*".to_string(),
        action: "delete".to_string(),
        condition: None,
        priority: 100,
    };

    engine.add_policy(policy).await.unwrap();

    // User with admin role (derived from direct assignment)
    let request = AuthzRequest {
        principal: Principal::new("user:bob@example.com")
            .with_attribute("roles", "admin,developer"), // Comma-separated roles
        resource: Resource::new("database:prod"),
        action: Action::new("delete"),
        context: HashMap::new(),
    };

    let decision = engine.check(&request).await.unwrap();
    assert!(decision.allowed, "Admin role should grant delete permission");
}

#[tokio::test]
async fn test_scope_matching_wildcards() {
    // TDD: Test scope resolution with wildcard patterns
    let engine = AuthzEngine::new().await.unwrap();

    // Policy with wildcard resource scope
    let policy = Policy {
        id: "wildcard-scope".to_string(),
        name: "Read access to all documents in namespace".to_string(),
        effect: PolicyEffect::Allow,
        principal: "user:*".to_string(),
        resource: "document:prod/*".to_string(), // Wildcard scope
        action: "read".to_string(),
        condition: None,
        priority: 100,
    };

    engine.add_policy(policy).await.unwrap();

    let request = AuthzRequest {
        principal: Principal::new("user:charlie@example.com"),
        resource: Resource::new("document:prod/reports/q4.pdf"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    let decision = engine.check(&request).await.unwrap();
    assert!(decision.allowed, "Wildcard scope should match nested resource");
}

#[tokio::test]
async fn test_cel_condition_evaluation() {
    // TDD: Test CEL (Common Expression Language) condition evaluation
    let engine = AuthzEngine::new().await.unwrap();

    // Policy with complex CEL condition
    let policy = Policy {
        id: "cel-condition".to_string(),
        name: "Allow writes during business hours".to_string(),
        effect: PolicyEffect::Allow,
        principal: "user:*".to_string(),
        resource: "document:*".to_string(),
        action: "write".to_string(),
        condition: Some(
            "request.context.hour >= 9 && request.context.hour < 17".to_string()
        ),
        priority: 100,
    };

    engine.add_policy(policy).await.unwrap();

    // Request during business hours (10 AM)
    let mut context = HashMap::new();
    context.insert("hour".to_string(), "10".to_string());

    let request = AuthzRequest {
        principal: Principal::new("user:david@example.com"),
        resource: Resource::new("document:financial-report"),
        action: Action::new("write"),
        context,
    };

    let decision = engine.check(&request).await.unwrap();
    assert!(decision.allowed, "CEL condition should pass during business hours");

    // Request outside business hours (8 PM)
    let mut context_after_hours = HashMap::new();
    context_after_hours.insert("hour".to_string(), "20".to_string());

    let request_after_hours = AuthzRequest {
        principal: Principal::new("user:david@example.com"),
        resource: Resource::new("document:financial-report"),
        action: Action::new("write"),
        context: context_after_hours,
    };

    let decision_denied = engine.check(&request_after_hours).await.unwrap();
    assert!(!decision_denied.allowed, "CEL condition should fail outside business hours");
}

// ============================================================================
// POLICY PRIORITY AND ORDERING TESTS
// ============================================================================

#[tokio::test]
async fn test_policy_priority_ordering() {
    // TDD: Test that policies are evaluated in priority order
    let engine = AuthzEngine::new().await.unwrap();

    // High priority deny policy
    let deny_policy = Policy {
        id: "deny-high-priority".to_string(),
        name: "Deny sensitive resources".to_string(),
        effect: PolicyEffect::Deny,
        principal: "*".to_string(),
        resource: "document:sensitive-*".to_string(),
        action: "*".to_string(),
        condition: None,
        priority: 200, // Higher priority
    };

    // Low priority allow policy
    let allow_policy = Policy {
        id: "allow-low-priority".to_string(),
        name: "Allow all document access".to_string(),
        effect: PolicyEffect::Allow,
        principal: "*".to_string(),
        resource: "document:*".to_string(),
        action: "read".to_string(),
        condition: None,
        priority: 100, // Lower priority
    };

    engine.add_policy(deny_policy).await.unwrap();
    engine.add_policy(allow_policy).await.unwrap();

    let request = AuthzRequest {
        principal: Principal::new("user:eve@example.com"),
        resource: Resource::new("document:sensitive-data"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    let decision = engine.check(&request).await.unwrap();
    assert!(!decision.allowed, "High priority deny should override low priority allow");
    assert_eq!(decision.policy_id, "deny-high-priority");
}

#[tokio::test]
async fn test_explicit_deny_overrides_allow() {
    // TDD: Test that explicit deny always wins
    let engine = AuthzEngine::new().await.unwrap();

    let allow_policy = Policy {
        id: "allow-all".to_string(),
        name: "Allow all".to_string(),
        effect: PolicyEffect::Allow,
        principal: "*".to_string(),
        resource: "*".to_string(),
        action: "*".to_string(),
        condition: None,
        priority: 50,
    };

    let deny_policy = Policy {
        id: "deny-specific".to_string(),
        name: "Deny specific action".to_string(),
        effect: PolicyEffect::Deny,
        principal: "user:*".to_string(),
        resource: "database:*".to_string(),
        action: "delete".to_string(),
        condition: None,
        priority: 100,
    };

    engine.add_policy(allow_policy).await.unwrap();
    engine.add_policy(deny_policy).await.unwrap();

    let request = AuthzRequest {
        principal: Principal::new("user:frank@example.com"),
        resource: Resource::new("database:production"),
        action: Action::new("delete"),
        context: HashMap::new(),
    };

    let decision = engine.check(&request).await.unwrap();
    assert!(!decision.allowed, "Explicit deny should override allow");
}

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

#[tokio::test]
async fn test_missing_policy_default_deny() {
    // TDD: Test default deny when no policies match
    let config = EngineConfig {
        enable_cache: false,
        cache_capacity: 100,
        enable_audit: false,
        default_decision: PolicyEffect::Deny,
    };

    let engine = AuthzEngine::with_config(config).await.unwrap();

    let request = AuthzRequest {
        principal: Principal::new("user:grace@example.com"),
        resource: Resource::new("unknown:resource"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    let decision = engine.check(&request).await.unwrap();
    assert!(!decision.allowed, "Should deny by default when no policies match");
    assert_eq!(decision.policy_id, "default");
}

#[tokio::test]
async fn test_invalid_cel_condition_handling() {
    // TDD: Test handling of invalid CEL expressions
    let engine = AuthzEngine::new().await.unwrap();

    let policy = Policy {
        id: "invalid-cel".to_string(),
        name: "Policy with invalid CEL".to_string(),
        effect: PolicyEffect::Allow,
        principal: "user:*".to_string(),
        resource: "document:*".to_string(),
        action: "read".to_string(),
        condition: Some("invalid.cel.expression...".to_string()), // Invalid CEL
        priority: 100,
    };

    engine.add_policy(policy).await.unwrap();

    let request = AuthzRequest {
        principal: Principal::new("user:henry@example.com"),
        resource: Resource::new("document:test"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    // Should handle CEL error gracefully and deny
    let decision = engine.check(&request).await.unwrap();
    assert!(!decision.allowed, "Invalid CEL should result in deny");
}

#[tokio::test]
async fn test_database_failure_handling() {
    // TDD: Test graceful degradation when database fails
    // This requires a custom PolicyStore that simulates failures
    // For now, we test that the engine handles store errors properly

    let engine = AuthzEngine::new().await.unwrap();

    // Attempt to remove non-existent policy should not crash
    let result = engine.remove_policy("non-existent-policy").await;

    // Should return Ok (in-memory store doesn't error on missing items)
    // or should handle error gracefully
    assert!(result.is_ok() || matches!(result, Err(AuthzError::PolicyNotFound(_))));
}

// ============================================================================
// CONCURRENT ACCESS TESTS
// ============================================================================

#[tokio::test]
async fn test_concurrent_authorization_requests() {
    // TDD: Test concurrent decision requests
    let engine = Arc::new(AuthzEngine::new().await.unwrap());

    let policy = Policy {
        id: "concurrent-policy".to_string(),
        name: "Concurrent access policy".to_string(),
        effect: PolicyEffect::Allow,
        principal: "user:*".to_string(),
        resource: "document:*".to_string(),
        action: "read".to_string(),
        condition: None,
        priority: 100,
    };

    engine.add_policy(policy).await.unwrap();

    // Spawn 100 concurrent authorization checks
    let mut handles = vec![];

    for i in 0..100 {
        let engine_clone = Arc::clone(&engine);
        let handle = tokio::spawn(async move {
            let request = AuthzRequest {
                principal: Principal::new(format!("user:user{}@example.com", i)),
                resource: Resource::new(format!("document:doc-{}", i)),
                action: Action::new("read"),
                context: HashMap::new(),
            };

            engine_clone.check(&request).await
        });

        handles.push(handle);
    }

    // Wait for all requests to complete
    let mut success_count = 0;
    for handle in handles {
        let result = handle.await.unwrap();
        if result.is_ok() && result.unwrap().allowed {
            success_count += 1;
        }
    }

    assert_eq!(success_count, 100, "All concurrent requests should succeed");
}

#[tokio::test]
async fn test_policy_updates_during_requests() {
    // TDD: Test that policy updates don't cause race conditions
    let engine = Arc::new(AuthzEngine::new().await.unwrap());

    let policy1 = Policy {
        id: "dynamic-policy-1".to_string(),
        name: "Initial policy".to_string(),
        effect: PolicyEffect::Allow,
        principal: "user:*".to_string(),
        resource: "document:*".to_string(),
        action: "read".to_string(),
        condition: None,
        priority: 100,
    };

    engine.add_policy(policy1).await.unwrap();

    // Spawn task that continuously checks authorization
    let engine_check = Arc::clone(&engine);
    let check_handle = tokio::spawn(async move {
        for i in 0..50 {
            let request = AuthzRequest {
                principal: Principal::new(format!("user:user{}@example.com", i)),
                resource: Resource::new("document:test"),
                action: Action::new("read"),
                context: HashMap::new(),
            };

            let _ = engine_check.check(&request).await;
            sleep(Duration::from_millis(10)).await;
        }
    });

    // Spawn task that updates policies
    let engine_update = Arc::clone(&engine);
    let update_handle = tokio::spawn(async move {
        for i in 0..10 {
            let policy = Policy {
                id: format!("dynamic-policy-{}", i + 2),
                name: format!("Updated policy {}", i),
                effect: PolicyEffect::Allow,
                principal: "user:*".to_string(),
                resource: "document:*".to_string(),
                action: "write".to_string(),
                condition: None,
                priority: 100 + i * 10,
            };

            engine_update.add_policy(policy).await.unwrap();
            sleep(Duration::from_millis(50)).await;
        }
    });

    // Wait for both tasks
    let (check_result, update_result) = tokio::join!(check_handle, update_handle);

    assert!(check_result.is_ok(), "Concurrent checks should not panic");
    assert!(update_result.is_ok(), "Concurrent updates should not panic");
}

// ============================================================================
// PROPERTY-BASED TESTS (PROPTEST)
// ============================================================================

proptest! {
    #[test]
    fn test_decision_determinism(
        principal_id in "[a-z]{3,10}@example\\.com",
        resource_id in "document:[a-z0-9]{3,10}",
        action_name in "(read|write|delete)"
    ) {
        // TDD: Test that same request always produces same decision
        tokio_test::block_on(async {
            let engine = AuthzEngine::new().await.unwrap();

            let policy = Policy {
                id: "prop-test-policy".to_string(),
                name: "Property test policy".to_string(),
                effect: PolicyEffect::Allow,
                principal: "user:*".to_string(),
                resource: "document:*".to_string(),
                action: "read".to_string(),
                condition: None,
                priority: 100,
            };

            engine.add_policy(policy).await.unwrap();

            let request = AuthzRequest {
                principal: Principal::new(format!("user:{}", principal_id)),
                resource: Resource::new(resource_id.clone()),
                action: Action::new(action_name.clone()),
                context: HashMap::new(),
            };

            let decision1 = engine.check(&request).await.unwrap();
            let decision2 = engine.check(&request).await.unwrap();

            // Same request should produce consistent allowed/denied result
            assert_eq!(decision1.allowed, decision2.allowed,
                       "Decision should be deterministic for same request");
        });
    }

    #[test]
    fn test_wildcard_scope_matching(
        resource_prefix in "[a-z]{3,8}",
        resource_suffix in "[a-z0-9]{3,8}"
    ) {
        // TDD: Test that wildcard scopes match correctly
        tokio_test::block_on(async {
            let engine = AuthzEngine::new().await.unwrap();

            let policy = Policy {
                id: "wildcard-test".to_string(),
                name: "Wildcard scope test".to_string(),
                effect: PolicyEffect::Allow,
                principal: "*".to_string(),
                resource: format!("{}:*", resource_prefix),
                action: "*".to_string(),
                condition: None,
                priority: 100,
            };

            engine.add_policy(policy).await.unwrap();

            let request = AuthzRequest {
                principal: Principal::new("user:test@example.com"),
                resource: Resource::new(format!("{}:{}", resource_prefix, resource_suffix)),
                action: Action::new("read"),
                context: HashMap::new(),
            };

            let decision = engine.check(&request).await.unwrap();
            assert!(decision.allowed, "Wildcard should match resource: {}:{}",
                    resource_prefix, resource_suffix);
        });
    }
}

// ============================================================================
// CACHE INVALIDATION TESTS
// ============================================================================

#[tokio::test]
async fn test_cache_cleared_on_policy_add() {
    // TDD: Test that cache is invalidated when policies change
    let engine = AuthzEngine::new().await.unwrap();

    let policy1 = Policy {
        id: "initial-policy".to_string(),
        name: "Initial policy".to_string(),
        effect: PolicyEffect::Deny,
        principal: "user:*".to_string(),
        resource: "document:*".to_string(),
        action: "read".to_string(),
        condition: None,
        priority: 100,
    };

    engine.add_policy(policy1).await.unwrap();

    let request = AuthzRequest {
        principal: Principal::new("user:iris@example.com"),
        resource: Resource::new("document:test"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    // First check - should deny and cache
    let decision1 = engine.check(&request).await.unwrap();
    assert!(!decision1.allowed, "Initial policy should deny");

    // Add new allow policy
    let policy2 = Policy {
        id: "override-policy".to_string(),
        name: "Override policy".to_string(),
        effect: PolicyEffect::Allow,
        principal: "user:*".to_string(),
        resource: "document:*".to_string(),
        action: "read".to_string(),
        condition: None,
        priority: 200, // Higher priority
    };

    engine.add_policy(policy2).await.unwrap();

    // Second check - should now allow (cache should be cleared)
    let decision2 = engine.check(&request).await.unwrap();
    assert!(decision2.allowed, "New policy should allow (cache cleared)");
    assert_ne!(decision1.id, decision2.id, "Should be a new decision");
}

#[tokio::test]
async fn test_cache_cleared_on_policy_remove() {
    // TDD: Test cache invalidation on policy removal
    let engine = AuthzEngine::new().await.unwrap();

    let policy = Policy {
        id: "removable-policy".to_string(),
        name: "Removable policy".to_string(),
        effect: PolicyEffect::Allow,
        principal: "user:*".to_string(),
        resource: "document:*".to_string(),
        action: "read".to_string(),
        condition: None,
        priority: 100,
    };

    engine.add_policy(policy).await.unwrap();

    let request = AuthzRequest {
        principal: Principal::new("user:jack@example.com"),
        resource: Resource::new("document:test"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    // Check should allow
    let decision1 = engine.check(&request).await.unwrap();
    assert!(decision1.allowed);

    // Remove policy
    engine.remove_policy("removable-policy").await.unwrap();

    // Check should now deny (cache cleared)
    let decision2 = engine.check(&request).await.unwrap();
    assert!(!decision2.allowed, "Should deny after policy removal");
}
