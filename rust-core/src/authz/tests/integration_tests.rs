//! Phase 3 TDD: End-to-End Integration Tests
//!
//! Tests for complete authorization pipeline including:
//! Role resolution → Scope matching → CEL evaluation → Decision → Cache → Audit

use cretoai_authz::{
    engine::{AuthzEngine, EngineConfig},
    policy::{Policy, PolicyEffect},
    types::{Action, AuthzRequest, Decision, Principal, Resource},
};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::time::{sleep, Duration};

// ============================================================================
// COMPLETE PIPELINE TESTS
// ============================================================================

#[tokio::test]
async fn test_full_authorization_pipeline() {
    // TDD: Test complete authorization flow from request to audited decision
    let config = EngineConfig {
        enable_cache: true,
        cache_capacity: 1000,
        enable_audit: true,
        default_decision: PolicyEffect::Deny,
    };

    let engine = AuthzEngine::with_config(config).await.unwrap();

    // Setup: Add complex policy with CEL condition
    let policy = Policy {
        id: "complex-policy".to_string(),
        name: "Complex authorization policy".to_string(),
        effect: PolicyEffect::Allow,
        principal: "user:*".to_string(),
        resource: "document:*".to_string(),
        action: "write".to_string(),
        condition: Some(
            "principal.attributes.department == 'engineering' && resource.attributes.classification != 'secret'"
                .to_string()
        ),
        priority: 100,
    };

    engine.add_policy(policy).await.unwrap();

    // Test 1: Request that should be allowed
    let request_allow = AuthzRequest {
        principal: Principal::new("user:alice@example.com")
            .with_attribute("department", "engineering")
            .with_attribute("role", "developer"),
        resource: Resource::new("document:project-plan")
            .with_attribute("classification", "internal")
            .with_attribute("owner", "alice"),
        action: Action::new("write"),
        context: HashMap::new(),
    };

    let decision = engine.check(&request_allow).await.unwrap();

    assert!(decision.allowed, "Engineering user should be allowed to write internal docs");
    assert_eq!(decision.policy_id, "complex-policy");
    assert!(decision.signature.is_some(), "Decision should be signed for audit");

    // Test 2: Same request should hit cache
    let cached_decision = engine.check(&request_allow).await.unwrap();
    assert_eq!(decision.id, cached_decision.id, "Decision should be cached");

    // Test 3: Request that should be denied (different department)
    let request_deny = AuthzRequest {
        principal: Principal::new("user:bob@example.com")
            .with_attribute("department", "marketing")
            .with_attribute("role", "analyst"),
        resource: Resource::new("document:project-plan")
            .with_attribute("classification", "internal"),
        action: Action::new("write"),
        context: HashMap::new(),
    };

    let deny_decision = engine.check(&request_deny).await.unwrap();
    assert!(!deny_decision.allowed, "Marketing user should be denied");

    // Test 4: Request denied by secret classification
    let request_secret = AuthzRequest {
        principal: Principal::new("user:charlie@example.com")
            .with_attribute("department", "engineering"),
        resource: Resource::new("document:secret-plan")
            .with_attribute("classification", "secret"),
        action: Action::new("write"),
        context: HashMap::new(),
    };

    let secret_decision = engine.check(&request_secret).await.unwrap();
    assert!(!secret_decision.allowed, "Secret documents should be denied");
}

#[tokio::test]
async fn test_multi_policy_evaluation_pipeline() {
    // TDD: Test pipeline with multiple policies at different priority levels
    let engine = AuthzEngine::new().await.unwrap();

    // Policy 1: Allow all reads (low priority)
    let read_policy = Policy {
        id: "read-all".to_string(),
        name: "Allow all reads".to_string(),
        effect: PolicyEffect::Allow,
        principal: "*".to_string(),
        resource: "*".to_string(),
        action: "read".to_string(),
        condition: None,
        priority: 50,
    };

    // Policy 2: Deny sensitive resources (high priority)
    let deny_sensitive = Policy {
        id: "deny-sensitive".to_string(),
        name: "Deny sensitive resources".to_string(),
        effect: PolicyEffect::Deny,
        principal: "*".to_string(),
        resource: "document:sensitive-*".to_string(),
        action: "*".to_string(),
        condition: None,
        priority: 200,
    };

    // Policy 3: Allow admins everything (highest priority)
    let admin_policy = Policy {
        id: "admin-all".to_string(),
        name: "Admin full access".to_string(),
        effect: PolicyEffect::Allow,
        principal: "role:admin".to_string(),
        resource: "*".to_string(),
        action: "*".to_string(),
        condition: None,
        priority: 300,
    };

    engine.add_policy(read_policy).await.unwrap();
    engine.add_policy(deny_sensitive).await.unwrap();
    engine.add_policy(admin_policy).await.unwrap();

    // Test 1: Regular user reading normal document (allowed by read-all)
    let request1 = AuthzRequest {
        principal: Principal::new("user:david@example.com"),
        resource: Resource::new("document:normal"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    let decision1 = engine.check(&request1).await.unwrap();
    assert!(decision1.allowed);
    assert_eq!(decision1.policy_id, "read-all");

    // Test 2: Regular user reading sensitive document (denied by deny-sensitive)
    let request2 = AuthzRequest {
        principal: Principal::new("user:david@example.com"),
        resource: Resource::new("document:sensitive-data"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    let decision2 = engine.check(&request2).await.unwrap();
    assert!(!decision2.allowed);
    assert_eq!(decision2.policy_id, "deny-sensitive");

    // Test 3: Admin reading sensitive document (allowed by admin-all)
    let request3 = AuthzRequest {
        principal: Principal::new("user:admin@example.com")
            .with_attribute("roles", "admin"),
        resource: Resource::new("document:sensitive-data"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    let decision3 = engine.check(&request3).await.unwrap();
    assert!(decision3.allowed);
    assert_eq!(decision3.policy_id, "admin-all");
}

// ============================================================================
// CACHE + AUDIT INTEGRATION
// ============================================================================

#[tokio::test]
async fn test_cache_audit_integration() {
    // TDD: Test that both cache and audit work together
    let config = EngineConfig {
        enable_cache: true,
        cache_capacity: 100,
        enable_audit: true,
        default_decision: PolicyEffect::Deny,
    };

    let engine = AuthzEngine::with_config(config).await.unwrap();

    let policy = Policy {
        id: "test-policy".to_string(),
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
        principal: Principal::new("user:eve@example.com"),
        resource: Resource::new("document:test"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    // First request: cache miss, audit recorded
    let decision1 = engine.check(&request).await.unwrap();
    assert!(decision1.allowed);
    assert!(decision1.signature.is_some(), "Decision should be audited");

    // Second request: cache hit, should return same decision
    let decision2 = engine.check(&request).await.unwrap();
    assert_eq!(decision1.id, decision2.id, "Should return cached decision");
    assert!(decision2.signature.is_some(), "Cached decision should preserve signature");
}

#[tokio::test]
async fn test_cache_invalidation_triggers_new_audit() {
    // TDD: Test that cache invalidation creates new audit entries
    let config = EngineConfig {
        enable_cache: true,
        cache_capacity: 100,
        enable_audit: true,
        default_decision: PolicyEffect::Deny,
    };

    let engine = AuthzEngine::with_config(config).await.unwrap();

    let policy1 = Policy {
        id: "policy-v1".to_string(),
        name: "Policy version 1".to_string(),
        effect: PolicyEffect::Deny,
        principal: "user:*".to_string(),
        resource: "document:*".to_string(),
        action: "write".to_string(),
        condition: None,
        priority: 100,
    };

    engine.add_policy(policy1).await.unwrap();

    let request = AuthzRequest {
        principal: Principal::new("user:frank@example.com"),
        resource: Resource::new("document:test"),
        action: Action::new("write"),
        context: HashMap::new(),
    };

    // First check - denied and cached
    let decision1 = engine.check(&request).await.unwrap();
    assert!(!decision1.allowed);

    // Update policy (clears cache)
    let policy2 = Policy {
        id: "policy-v2".to_string(),
        name: "Policy version 2".to_string(),
        effect: PolicyEffect::Allow,
        principal: "user:*".to_string(),
        resource: "document:*".to_string(),
        action: "write".to_string(),
        condition: None,
        priority: 200,
    };

    engine.add_policy(policy2).await.unwrap();

    // Second check - allowed and new audit entry
    let decision2 = engine.check(&request).await.unwrap();
    assert!(decision2.allowed);
    assert_ne!(decision1.id, decision2.id, "Should be a new decision with new audit entry");
}

// ============================================================================
// REAL-WORLD SCENARIO TESTS
// ============================================================================

#[tokio::test]
async fn test_document_management_system_scenario() {
    // TDD: Simulate a document management system authorization flow
    let config = EngineConfig {
        enable_cache: true,
        cache_capacity: 10000,
        enable_audit: true,
        default_decision: PolicyEffect::Deny,
    };

    let engine = AuthzEngine::with_config(config).await.unwrap();

    // Policy 1: Owners can do anything with their documents
    let owner_policy = Policy {
        id: "owner-full-access".to_string(),
        name: "Document owners have full access".to_string(),
        effect: PolicyEffect::Allow,
        principal: "user:*".to_string(),
        resource: "document:*".to_string(),
        action: "*".to_string(),
        condition: Some("resource.attributes.owner == principal.id".to_string()),
        priority: 200,
    };

    // Policy 2: Same department can read
    let department_read = Policy {
        id: "department-read".to_string(),
        name: "Department members can read".to_string(),
        effect: PolicyEffect::Allow,
        principal: "user:*".to_string(),
        resource: "document:*".to_string(),
        action: "read".to_string(),
        condition: Some(
            "principal.attributes.department == resource.attributes.department".to_string()
        ),
        priority: 100,
    };

    // Policy 3: Admins can read everything
    let admin_read = Policy {
        id: "admin-read-all".to_string(),
        name: "Admins can read all documents".to_string(),
        effect: PolicyEffect::Allow,
        principal: "role:admin".to_string(),
        resource: "document:*".to_string(),
        action: "read".to_string(),
        condition: None,
        priority: 150,
    };

    engine.add_policy(owner_policy).await.unwrap();
    engine.add_policy(department_read).await.unwrap();
    engine.add_policy(admin_read).await.unwrap();

    // Scenario 1: Owner deletes their own document
    let owner_delete = AuthzRequest {
        principal: Principal::new("user:grace@example.com")
            .with_attribute("department", "engineering"),
        resource: Resource::new("document:design-doc")
            .with_attribute("owner", "user:grace@example.com")
            .with_attribute("department", "engineering"),
        action: Action::new("delete"),
        context: HashMap::new(),
    };

    let decision = engine.check(&owner_delete).await.unwrap();
    assert!(decision.allowed, "Owner should be able to delete own document");

    // Scenario 2: Department member reads colleague's document
    let dept_read = AuthzRequest {
        principal: Principal::new("user:henry@example.com")
            .with_attribute("department", "engineering"),
        resource: Resource::new("document:design-doc")
            .with_attribute("owner", "user:grace@example.com")
            .with_attribute("department", "engineering"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    let decision = engine.check(&dept_read).await.unwrap();
    assert!(decision.allowed, "Department member should read colleague's doc");

    // Scenario 3: Different department cannot read
    let other_dept = AuthzRequest {
        principal: Principal::new("user:iris@example.com")
            .with_attribute("department", "marketing"),
        resource: Resource::new("document:design-doc")
            .with_attribute("owner", "user:grace@example.com")
            .with_attribute("department", "engineering"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    let decision = engine.check(&other_dept).await.unwrap();
    assert!(!decision.allowed, "Other department should not read");

    // Scenario 4: Admin reads across departments
    let admin_read_req = AuthzRequest {
        principal: Principal::new("user:admin@example.com")
            .with_attribute("roles", "admin")
            .with_attribute("department", "operations"),
        resource: Resource::new("document:design-doc")
            .with_attribute("owner", "user:grace@example.com")
            .with_attribute("department", "engineering"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    let decision = engine.check(&admin_read_req).await.unwrap();
    assert!(decision.allowed, "Admin should read across departments");
}

#[tokio::test]
async fn test_api_access_control_scenario() {
    // TDD: Simulate API endpoint access control
    let engine = AuthzEngine::new().await.unwrap();

    // API policies based on request context (time, IP, rate limit)
    let business_hours_policy = Policy {
        id: "api-business-hours".to_string(),
        name: "API access during business hours".to_string(),
        effect: PolicyEffect::Allow,
        principal: "user:*".to_string(),
        resource: "api:sensitive/*".to_string(),
        action: "execute".to_string(),
        condition: Some(
            "request.context.hour >= 9 && request.context.hour < 17".to_string()
        ),
        priority: 100,
    };

    let trusted_ip_policy = Policy {
        id: "api-trusted-ip".to_string(),
        name: "Always allow from trusted IPs".to_string(),
        effect: PolicyEffect::Allow,
        principal: "*".to_string(),
        resource: "api:*".to_string(),
        action: "execute".to_string(),
        condition: Some(
            "request.context.ip.startsWith('10.0.') || request.context.ip.startsWith('192.168.')".to_string()
        ),
        priority: 200,
    };

    engine.add_policy(business_hours_policy).await.unwrap();
    engine.add_policy(trusted_ip_policy).await.unwrap();

    // Test 1: Business hours access
    let mut business_context = HashMap::new();
    business_context.insert("hour".to_string(), "14".to_string());
    business_context.insert("ip".to_string(), "203.0.113.1".to_string());

    let request1 = AuthzRequest {
        principal: Principal::new("user:jack@example.com"),
        resource: Resource::new("api:sensitive/data"),
        action: Action::new("execute"),
        context: business_context,
    };

    let decision = engine.check(&request1).await.unwrap();
    assert!(decision.allowed, "Should allow during business hours");

    // Test 2: After hours from external IP
    let mut after_hours_context = HashMap::new();
    after_hours_context.insert("hour".to_string(), "22".to_string());
    after_hours_context.insert("ip".to_string(), "203.0.113.1".to_string());

    let request2 = AuthzRequest {
        principal: Principal::new("user:jack@example.com"),
        resource: Resource::new("api:sensitive/data"),
        action: Action::new("execute"),
        context: after_hours_context,
    };

    let decision = engine.check(&request2).await.unwrap();
    assert!(!decision.allowed, "Should deny after hours from external IP");

    // Test 3: After hours from trusted IP
    let mut trusted_context = HashMap::new();
    trusted_context.insert("hour".to_string(), "22".to_string());
    trusted_context.insert("ip".to_string(), "10.0.1.100".to_string());

    let request3 = AuthzRequest {
        principal: Principal::new("user:jack@example.com"),
        resource: Resource::new("api:sensitive/data"),
        action: Action::new("execute"),
        context: trusted_context,
    };

    let decision = engine.check(&request3).await.unwrap();
    assert!(decision.allowed, "Should allow from trusted IP even after hours");
}

// ============================================================================
// PERFORMANCE AND LOAD TESTS
// ============================================================================

#[tokio::test]
async fn test_sustained_load_integration() {
    // TDD: Test engine under sustained load with all features enabled
    let config = EngineConfig {
        enable_cache: true,
        cache_capacity: 10000,
        enable_audit: true,
        default_decision: PolicyEffect::Deny,
    };

    let engine = Arc::new(AuthzEngine::with_config(config).await.unwrap());

    // Add policies
    let policy = Policy {
        id: "load-test-policy".to_string(),
        name: "Load test policy".to_string(),
        effect: PolicyEffect::Allow,
        principal: "user:*".to_string(),
        resource: "document:*".to_string(),
        action: "read".to_string(),
        condition: None,
        priority: 100,
    };

    engine.add_policy(policy).await.unwrap();

    let start = std::time::Instant::now();

    // Simulate 10,000 requests over 10 seconds
    let mut handles = vec![];

    for i in 0..10000 {
        let engine_clone = Arc::clone(&engine);
        let handle = tokio::spawn(async move {
            let request = AuthzRequest {
                principal: Principal::new(format!("user:user{}@example.com", i % 100)),
                resource: Resource::new(format!("document:{}", i % 500)),
                action: Action::new("read"),
                context: HashMap::new(),
            };

            engine_clone.check(&request).await
        });

        handles.push(handle);

        // Pace requests
        if i % 1000 == 0 {
            sleep(Duration::from_millis(100)).await;
        }
    }

    // Wait for completion
    let mut success_count = 0;
    for handle in handles {
        let result = handle.await.unwrap();
        if result.is_ok() && result.unwrap().allowed {
            success_count += 1;
        }
    }

    let duration = start.elapsed();

    assert_eq!(success_count, 10000, "All requests should succeed");
    println!("Processed 10,000 requests in {:?}", duration);
    println!("Throughput: {:.2} req/sec", 10000.0 / duration.as_secs_f64());

    // Should achieve > 1000 req/sec
    assert!(duration.as_secs() < 10, "Should complete under load");
}

#[tokio::test]
async fn test_cache_hit_rate_under_load() {
    // TDD: Test cache effectiveness under realistic load
    let config = EngineConfig {
        enable_cache: true,
        cache_capacity: 1000,
        enable_audit: false, // Disable for pure cache testing
        default_decision: PolicyEffect::Deny,
    };

    let engine = Arc::new(AuthzEngine::with_config(config).await.unwrap());

    let policy = Policy {
        id: "cache-test".to_string(),
        name: "Cache test policy".to_string(),
        effect: PolicyEffect::Allow,
        principal: "user:*".to_string(),
        resource: "document:*".to_string(),
        action: "read".to_string(),
        condition: None,
        priority: 100,
    };

    engine.add_policy(policy).await.unwrap();

    // Simulate realistic access pattern (80/20 rule - 80% requests for 20% resources)
    let mut handles = vec![];

    for i in 0..5000 {
        let engine_clone = Arc::clone(&engine);
        let handle = tokio::spawn(async move {
            let resource_id = if i % 100 < 80 {
                // 80% of requests go to 20% of resources
                format!("document:{}", i % 20)
            } else {
                // 20% of requests go to 80% of resources
                format!("document:{}", 20 + (i % 80))
            };

            let request = AuthzRequest {
                principal: Principal::new(format!("user:user{}@example.com", i % 50)),
                resource: Resource::new(resource_id),
                action: Action::new("read"),
                context: HashMap::new(),
            };

            engine_clone.check(&request).await
        });

        handles.push(handle);
    }

    for handle in handles {
        let _ = handle.await.unwrap();
    }

    // With 80/20 distribution, cache hit rate should be > 80%
    // TODO: Add cache statistics to measure actual hit rate
}
