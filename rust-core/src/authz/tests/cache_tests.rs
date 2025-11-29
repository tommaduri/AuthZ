//! Phase 3 TDD: Decision Caching Tests
//!
//! Tests for cache hit/miss scenarios, TTL expiration, invalidation,
//! and concurrent access patterns.

use cretoai_authz::{
    cache::AuthzCache,
    types::{Action, AuthzRequest, Decision, Principal, Resource},
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::sleep;

// ============================================================================
// BASIC CACHE OPERATIONS
// ============================================================================

#[tokio::test]
async fn test_cache_hit_miss_basic() {
    // TDD: Test basic cache hit and miss scenarios
    let cache = AuthzCache::new(100);

    let request = AuthzRequest {
        principal: Principal::new("user:alice@example.com"),
        resource: Resource::new("document:123"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    let decision = Decision::allow("policy-1", "Test decision");

    // Initial state - cache miss
    let result = cache.get(&request).await;
    assert!(result.is_none(), "Cache should be empty initially");

    // Store decision
    cache.put(&request, decision.clone()).await;

    // Cache hit
    let cached = cache.get(&request).await;
    assert!(cached.is_some(), "Decision should be in cache");
    assert_eq!(cached.unwrap().id, decision.id, "Cached decision should match");
}

#[tokio::test]
async fn test_cache_key_consistency() {
    // TDD: Test that identical requests produce same cache key
    let cache = AuthzCache::new(100);

    let request1 = AuthzRequest {
        principal: Principal::new("user:bob@example.com"),
        resource: Resource::new("document:456"),
        action: Action::new("write"),
        context: HashMap::new(),
    };

    let request2 = AuthzRequest {
        principal: Principal::new("user:bob@example.com"),
        resource: Resource::new("document:456"),
        action: Action::new("write"),
        context: HashMap::new(),
    };

    let decision = Decision::allow("policy-2", "Test");

    cache.put(&request1, decision.clone()).await;

    // Second request should hit cache
    let cached = cache.get(&request2).await;
    assert!(cached.is_some(), "Identical request should hit cache");
    assert_eq!(cached.unwrap().id, decision.id);
}

#[tokio::test]
async fn test_cache_key_attribute_sensitivity() {
    // TDD: Test that different attributes produce different cache keys
    let cache = AuthzCache::new(100);

    let request1 = AuthzRequest {
        principal: Principal::new("user:charlie@example.com")
            .with_attribute("role", "admin"),
        resource: Resource::new("document:789"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    let request2 = AuthzRequest {
        principal: Principal::new("user:charlie@example.com")
            .with_attribute("role", "user"), // Different attribute
        resource: Resource::new("document:789"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    let decision1 = Decision::allow("policy-3", "Admin access");
    let decision2 = Decision::deny("policy-4", "User denied");

    cache.put(&request1, decision1.clone()).await;
    cache.put(&request2, decision2.clone()).await;

    // Different attributes should have different cache entries
    let cached1 = cache.get(&request1).await.unwrap();
    let cached2 = cache.get(&request2).await.unwrap();

    assert_eq!(cached1.id, decision1.id, "Admin decision should be cached");
    assert_eq!(cached2.id, decision2.id, "User decision should be cached separately");
    assert_ne!(cached1.id, cached2.id, "Should be different cache entries");
}

// ============================================================================
// CACHE CAPACITY AND LRU EVICTION
// ============================================================================

#[tokio::test]
async fn test_cache_lru_eviction() {
    // TDD: Test LRU eviction when cache reaches capacity
    let cache = AuthzCache::new(3); // Small capacity for testing

    // Add 3 decisions to fill cache
    for i in 0..3 {
        let request = AuthzRequest {
            principal: Principal::new(format!("user:user{}@example.com", i)),
            resource: Resource::new(format!("document:{}", i)),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let decision = Decision::allow(format!("policy-{}", i), "Test");
        cache.put(&request, decision).await;
    }

    // Cache should have 3 entries
    assert_eq!(cache.len().await, 3, "Cache should be at capacity");

    // Add 4th entry - should evict least recently used (entry 0)
    let request_new = AuthzRequest {
        principal: Principal::new("user:user3@example.com"),
        resource: Resource::new("document:3"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    cache.put(&request_new, Decision::allow("policy-3", "New")).await;

    // First entry should be evicted
    let request_0 = AuthzRequest {
        principal: Principal::new("user:user0@example.com"),
        resource: Resource::new("document:0"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    let evicted = cache.get(&request_0).await;
    assert!(evicted.is_none(), "First entry should be evicted (LRU)");

    // New entry should be present
    let cached_new = cache.get(&request_new).await;
    assert!(cached_new.is_some(), "New entry should be in cache");
}

#[tokio::test]
async fn test_cache_access_updates_lru() {
    // TDD: Test that accessing an entry updates its LRU position
    let cache = AuthzCache::new(3);

    // Add 3 entries
    let mut requests = vec![];
    for i in 0..3 {
        let request = AuthzRequest {
            principal: Principal::new(format!("user:user{}@example.com", i)),
            resource: Resource::new(format!("document:{}", i)),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        cache.put(&request, Decision::allow(format!("policy-{}", i), "Test")).await;
        requests.push(request);
    }

    // Access entry 0 to move it to front
    let _ = cache.get(&requests[0]).await;

    // Add new entry - should evict entry 1 (now least recently used)
    let request_new = AuthzRequest {
        principal: Principal::new("user:user3@example.com"),
        resource: Resource::new("document:3"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    cache.put(&request_new, Decision::allow("policy-3", "New")).await;

    // Entry 0 should still be present (was accessed)
    assert!(cache.get(&requests[0]).await.is_some(), "Entry 0 should remain (recently accessed)");

    // Entry 1 should be evicted
    assert!(cache.get(&requests[1]).await.is_none(), "Entry 1 should be evicted");
}

// ============================================================================
// CACHE INVALIDATION
// ============================================================================

#[tokio::test]
async fn test_cache_clear() {
    // TDD: Test clearing entire cache
    let cache = AuthzCache::new(100);

    // Add multiple entries
    for i in 0..10 {
        let request = AuthzRequest {
            principal: Principal::new(format!("user:user{}@example.com", i)),
            resource: Resource::new(format!("document:{}", i)),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        cache.put(&request, Decision::allow(format!("policy-{}", i), "Test")).await;
    }

    assert_eq!(cache.len().await, 10, "Cache should have 10 entries");

    // Clear cache
    cache.clear().await;

    assert_eq!(cache.len().await, 0, "Cache should be empty after clear");
}

#[tokio::test]
async fn test_cache_selective_invalidation() {
    // TDD: Test invalidating specific cache entries (future feature)
    // This test defines the expected behavior for selective invalidation
    let cache = AuthzCache::new(100);

    let request1 = AuthzRequest {
        principal: Principal::new("user:david@example.com"),
        resource: Resource::new("document:sensitive"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    let request2 = AuthzRequest {
        principal: Principal::new("user:eve@example.com"),
        resource: Resource::new("document:public"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    cache.put(&request1, Decision::allow("policy-1", "Test")).await;
    cache.put(&request2, Decision::allow("policy-2", "Test")).await;

    // TODO: Implement selective invalidation
    // cache.invalidate_by_principal("user:david@example.com").await;
    // cache.invalidate_by_resource("document:sensitive").await;
    // cache.invalidate_by_policy("policy-1").await;

    // For now, we use clear() as a placeholder
    // In Phase 3 implementation, add selective invalidation methods
}

// ============================================================================
// CONCURRENT ACCESS TESTS
// ============================================================================

#[tokio::test]
async fn test_concurrent_cache_reads() {
    // TDD: Test concurrent read operations
    let cache = Arc::new(AuthzCache::new(1000));

    // Pre-populate cache
    for i in 0..100 {
        let request = AuthzRequest {
            principal: Principal::new(format!("user:user{}@example.com", i)),
            resource: Resource::new(format!("document:{}", i)),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        cache.put(&request, Decision::allow(format!("policy-{}", i), "Test")).await;
    }

    // Spawn 1000 concurrent reads
    let mut handles = vec![];

    for i in 0..1000 {
        let cache_clone = Arc::clone(&cache);
        let handle = tokio::spawn(async move {
            let request = AuthzRequest {
                principal: Principal::new(format!("user:user{}@example.com", i % 100)),
                resource: Resource::new(format!("document:{}", i % 100)),
                action: Action::new("read"),
                context: HashMap::new(),
            };

            cache_clone.get(&request).await
        });

        handles.push(handle);
    }

    // All reads should complete successfully
    let mut hit_count = 0;
    for handle in handles {
        let result = handle.await.unwrap();
        if result.is_some() {
            hit_count += 1;
        }
    }

    assert_eq!(hit_count, 1000, "All concurrent reads should hit cache");
}

#[tokio::test]
async fn test_concurrent_cache_writes() {
    // TDD: Test concurrent write operations
    let cache = Arc::new(AuthzCache::new(1000));

    // Spawn 500 concurrent writes
    let mut handles = vec![];

    for i in 0..500 {
        let cache_clone = Arc::clone(&cache);
        let handle = tokio::spawn(async move {
            let request = AuthzRequest {
                principal: Principal::new(format!("user:user{}@example.com", i)),
                resource: Resource::new(format!("document:{}", i)),
                action: Action::new("read"),
                context: HashMap::new(),
            };

            let decision = Decision::allow(format!("policy-{}", i), "Concurrent test");
            cache_clone.put(&request, decision).await;
        });

        handles.push(handle);
    }

    // Wait for all writes
    for handle in handles {
        handle.await.unwrap();
    }

    // Cache should have 500 entries
    assert_eq!(cache.len().await, 500, "All concurrent writes should succeed");
}

#[tokio::test]
async fn test_concurrent_read_write_mix() {
    // TDD: Test mixed concurrent reads and writes
    let cache = Arc::new(AuthzCache::new(1000));

    // Pre-populate with some data
    for i in 0..50 {
        let request = AuthzRequest {
            principal: Principal::new(format!("user:user{}@example.com", i)),
            resource: Resource::new(format!("document:{}", i)),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        cache.put(&request, Decision::allow(format!("policy-{}", i), "Initial")).await;
    }

    // Spawn mixed read/write tasks
    let mut handles = vec![];

    // 250 reads
    for i in 0..250 {
        let cache_clone = Arc::clone(&cache);
        let handle = tokio::spawn(async move {
            let request = AuthzRequest {
                principal: Principal::new(format!("user:user{}@example.com", i % 50)),
                resource: Resource::new(format!("document:{}", i % 50)),
                action: Action::new("read"),
                context: HashMap::new(),
            };

            cache_clone.get(&request).await
        });

        handles.push(handle);
    }

    // 250 writes
    for i in 50..300 {
        let cache_clone = Arc::clone(&cache);
        let handle = tokio::spawn(async move {
            let request = AuthzRequest {
                principal: Principal::new(format!("user:user{}@example.com", i)),
                resource: Resource::new(format!("document:{}", i)),
                action: Action::new("read"),
                context: HashMap::new(),
            };

            cache_clone.put(&request, Decision::allow(format!("policy-{}", i), "New")).await;
        });

        handles.push(handle);
    }

    // All operations should complete
    for handle in handles {
        let _ = handle.await.unwrap();
    }

    // Cache should have entries from both pre-populate and new writes
    let final_len = cache.len().await;
    assert!(final_len >= 50, "Cache should contain data");
}

// ============================================================================
// CACHE STATISTICS AND MONITORING
// ============================================================================

#[tokio::test]
async fn test_cache_statistics() {
    // TDD: Test cache statistics (future feature)
    let cache = AuthzCache::new(100);

    // Add some entries
    for i in 0..10 {
        let request = AuthzRequest {
            principal: Principal::new(format!("user:user{}@example.com", i)),
            resource: Resource::new(format!("document:{}", i)),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        cache.put(&request, Decision::allow(format!("policy-{}", i), "Test")).await;
    }

    // Basic statistic - current size
    assert_eq!(cache.len().await, 10);

    // TODO: Phase 3 should add:
    // - Hit rate tracking
    // - Miss rate tracking
    // - Eviction count
    // - Average access time
}

// ============================================================================
// TTL (TIME-TO-LIVE) TESTS - FUTURE FEATURE
// ============================================================================

#[tokio::test]
#[ignore = "TTL feature not yet implemented"]
async fn test_cache_ttl_expiration() {
    // TDD: Test TTL-based cache expiration (future feature)
    let cache = AuthzCache::new(100);

    let request = AuthzRequest {
        principal: Principal::new("user:frank@example.com"),
        resource: Resource::new("document:ttl-test"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    let decision = Decision::allow("policy-ttl", "TTL test");

    // Put with TTL (future API)
    // cache.put_with_ttl(&request, decision, Duration::from_secs(2)).await;

    // Immediately available
    assert!(cache.get(&request).await.is_some());

    // Wait for TTL to expire
    sleep(Duration::from_secs(3)).await;

    // Should be expired
    assert!(cache.get(&request).await.is_none(), "Entry should expire after TTL");
}

#[tokio::test]
#[ignore = "TTL feature not yet implemented"]
async fn test_cache_ttl_refresh() {
    // TDD: Test TTL refresh on access (future feature)
    let cache = AuthzCache::new(100);

    let request = AuthzRequest {
        principal: Principal::new("user:grace@example.com"),
        resource: Resource::new("document:ttl-refresh"),
        action: Action::new("read"),
        context: HashMap::new(),
    };

    // Put with 3 second TTL
    // cache.put_with_ttl(&request, Decision::allow("policy", "Test"), Duration::from_secs(3)).await;

    // Access every 2 seconds to refresh TTL
    for _ in 0..3 {
        sleep(Duration::from_secs(2)).await;
        let result = cache.get(&request).await;
        assert!(result.is_some(), "Entry should still be valid (TTL refreshed)");
    }
}

// ============================================================================
// CACHE WARMUP TESTS
// ============================================================================

#[tokio::test]
async fn test_cache_warmup() {
    // TDD: Test cache warmup with common requests (future feature)
    let cache = Arc::new(AuthzCache::new(1000));

    // Common requests that should be pre-cached
    let common_requests = vec![
        ("user:admin@example.com", "document:*", "read"),
        ("user:admin@example.com", "document:*", "write"),
        ("user:viewer@example.com", "document:*", "read"),
    ];

    // Warmup cache
    for (principal, resource, action) in common_requests {
        let request = AuthzRequest {
            principal: Principal::new(principal),
            resource: Resource::new(resource),
            action: Action::new(action),
            context: HashMap::new(),
        };

        cache.put(&request, Decision::allow("policy-warmup", "Preloaded")).await;
    }

    // Verify warmup
    assert_eq!(cache.len().await, 3, "Cache should be warmed up with common requests");
}
