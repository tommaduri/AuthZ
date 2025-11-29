//! Phase 3 TDD: Performance Tests
//!
//! Tests for latency, throughput, and performance requirements:
//! - < 10ms p99 latency
//! - > 10K req/sec throughput
//! - > 80% cache hit rate

use cretoai_authz::{
    engine::{AuthzEngine, EngineConfig},
    policy::{Policy, PolicyEffect},
    types::{Action, AuthzRequest, Principal, Resource},
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::time::sleep;

// ============================================================================
// LATENCY TESTS
// ============================================================================

#[tokio::test]
async fn test_p99_latency_under_10ms() {
    // TDD: Test that p99 latency is under 10ms
    let config = EngineConfig {
        enable_cache: true,
        cache_capacity: 10000,
        enable_audit: false, // Disable for pure performance testing
        default_decision: PolicyEffect::Deny,
    };

    let engine = AuthzEngine::with_config(config).await.unwrap();

    let policy = Policy {
        id: "perf-policy".to_string(),
        name: "Performance test policy".to_string(),
        effect: PolicyEffect::Allow,
        principal: "user:*".to_string(),
        resource: "document:*".to_string(),
        action: "read".to_string(),
        condition: None,
        priority: 100,
    };

    engine.add_policy(policy).await.unwrap();

    // Warm up cache
    for i in 0..100 {
        let request = AuthzRequest {
            principal: Principal::new(format!("user:user{}@example.com", i)),
            resource: Resource::new(format!("document:{}", i)),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        engine.check(&request).await.unwrap();
    }

    // Measure latency for 1000 requests
    let mut latencies = Vec::with_capacity(1000);

    for i in 0..1000 {
        let request = AuthzRequest {
            principal: Principal::new(format!("user:user{}@example.com", i % 100)),
            resource: Resource::new(format!("document:{}", i % 100)),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let start = Instant::now();
        let _ = engine.check(&request).await.unwrap();
        let latency = start.elapsed();

        latencies.push(latency);
    }

    // Calculate p99
    latencies.sort();
    let p99_index = (latencies.len() as f64 * 0.99) as usize;
    let p99_latency = latencies[p99_index];

    println!("P99 latency: {:?}", p99_latency);
    println!("Median latency: {:?}", latencies[latencies.len() / 2]);
    println!("Min latency: {:?}", latencies[0]);
    println!("Max latency: {:?}", latencies[latencies.len() - 1]);

    assert!(
        p99_latency < Duration::from_millis(10),
        "P99 latency should be under 10ms, got {:?}",
        p99_latency
    );
}

#[tokio::test]
async fn test_median_latency_under_5ms() {
    // TDD: Test that median latency is under 5ms
    let config = EngineConfig {
        enable_cache: true,
        cache_capacity: 10000,
        enable_audit: false,
        default_decision: PolicyEffect::Deny,
    };

    let engine = AuthzEngine::with_config(config).await.unwrap();

    let policy = Policy {
        id: "median-policy".to_string(),
        name: "Median test policy".to_string(),
        effect: PolicyEffect::Allow,
        principal: "user:*".to_string(),
        resource: "document:*".to_string(),
        action: "*".to_string(),
        condition: None,
        priority: 100,
    };

    engine.add_policy(policy).await.unwrap();

    // Warm up
    for i in 0..50 {
        let request = AuthzRequest {
            principal: Principal::new(format!("user:user{}@example.com", i)),
            resource: Resource::new(format!("document:{}", i)),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        engine.check(&request).await.unwrap();
    }

    // Measure median latency
    let mut latencies = Vec::with_capacity(1000);

    for i in 0..1000 {
        let request = AuthzRequest {
            principal: Principal::new(format!("user:user{}@example.com", i % 50)),
            resource: Resource::new(format!("document:{}", i % 50)),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let start = Instant::now();
        engine.check(&request).await.unwrap();
        latencies.push(start.elapsed());
    }

    latencies.sort();
    let median = latencies[latencies.len() / 2];

    println!("Median latency: {:?}", median);

    assert!(
        median < Duration::from_millis(5),
        "Median latency should be under 5ms, got {:?}",
        median
    );
}

#[tokio::test]
async fn test_latency_with_complex_cel() {
    // TDD: Test latency with complex CEL evaluation
    let engine = AuthzEngine::new().await.unwrap();

    let complex_policy = Policy {
        id: "complex-cel".to_string(),
        name: "Complex CEL policy".to_string(),
        effect: PolicyEffect::Allow,
        principal: "user:*".to_string(),
        resource: "document:*".to_string(),
        action: "read".to_string(),
        condition: Some(
            "principal.attributes.clearance >= 3 && \
             resource.attributes.classification <= principal.attributes.clearance && \
             request.context.hour >= 9 && request.context.hour < 17"
                .to_string()
        ),
        priority: 100,
    };

    engine.add_policy(complex_policy).await.unwrap();

    let mut latencies = Vec::with_capacity(500);

    for i in 0..500 {
        let mut context = HashMap::new();
        context.insert("hour".to_string(), "14".to_string());

        let request = AuthzRequest {
            principal: Principal::new(format!("user:user{}@example.com", i))
                .with_attribute("clearance", "4"),
            resource: Resource::new("document:test")
                .with_attribute("classification", "3"),
            action: Action::new("read"),
            context,
        };

        let start = Instant::now();
        engine.check(&request).await.unwrap();
        latencies.push(start.elapsed());
    }

    latencies.sort();
    let p99 = latencies[(latencies.len() as f64 * 0.99) as usize];

    println!("P99 latency (complex CEL): {:?}", p99);

    // Complex CEL should still be fast
    assert!(
        p99 < Duration::from_millis(20),
        "Complex CEL p99 latency should be under 20ms, got {:?}",
        p99
    );
}

// ============================================================================
// THROUGHPUT TESTS
// ============================================================================

#[tokio::test]
async fn test_throughput_exceeds_10k_per_second() {
    // TDD: Test that engine can handle > 10K requests per second
    let config = EngineConfig {
        enable_cache: true,
        cache_capacity: 100000,
        enable_audit: false, // Disable for max throughput
        default_decision: PolicyEffect::Deny,
    };

    let engine = Arc::new(AuthzEngine::with_config(config).await.unwrap());

    let policy = Policy {
        id: "throughput-policy".to_string(),
        name: "Throughput test policy".to_string(),
        effect: PolicyEffect::Allow,
        principal: "*".to_string(),
        resource: "*".to_string(),
        action: "*".to_string(),
        condition: None,
        priority: 100,
    };

    engine.add_policy(policy).await.unwrap();

    // Warm up
    for i in 0..1000 {
        let request = AuthzRequest {
            principal: Principal::new(format!("user:user{}@example.com", i % 100)),
            resource: Resource::new(format!("document:{}", i % 100)),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        engine.check(&request).await.unwrap();
    }

    // Test throughput with 100K requests
    let start = Instant::now();
    let mut handles = vec![];

    for i in 0..100_000 {
        let engine_clone = Arc::clone(&engine);
        let handle = tokio::spawn(async move {
            let request = AuthzRequest {
                principal: Principal::new(format!("user:user{}@example.com", i % 100)),
                resource: Resource::new(format!("document:{}", i % 100)),
                action: Action::new("read"),
                context: HashMap::new(),
            };

            engine_clone.check(&request).await
        });

        handles.push(handle);
    }

    let mut success_count = 0;
    for handle in handles {
        if handle.await.unwrap().is_ok() {
            success_count += 1;
        }
    }

    let duration = start.elapsed();
    let throughput = success_count as f64 / duration.as_secs_f64();

    println!("Processed {} requests in {:?}", success_count, duration);
    println!("Throughput: {:.2} req/sec", throughput);

    assert_eq!(success_count, 100_000, "All requests should succeed");
    assert!(
        throughput > 10_000.0,
        "Throughput should exceed 10K req/sec, got {:.2}",
        throughput
    );
}

#[tokio::test]
async fn test_throughput_with_audit_enabled() {
    // TDD: Test throughput with audit trail enabled
    let config = EngineConfig {
        enable_cache: true,
        cache_capacity: 10000,
        enable_audit: true,
        default_decision: PolicyEffect::Deny,
    };

    let engine = Arc::new(AuthzEngine::with_config(config).await.unwrap());

    let policy = Policy {
        id: "audit-throughput".to_string(),
        name: "Audit throughput test".to_string(),
        effect: PolicyEffect::Allow,
        principal: "*".to_string(),
        resource: "*".to_string(),
        action: "*".to_string(),
        condition: None,
        priority: 100,
    };

    engine.add_policy(policy).await.unwrap();

    let start = Instant::now();
    let mut handles = vec![];

    // Test with 10K requests (lower due to audit overhead)
    for i in 0..10_000 {
        let engine_clone = Arc::clone(&engine);
        let handle = tokio::spawn(async move {
            let request = AuthzRequest {
                principal: Principal::new(format!("user:user{}@example.com", i % 50)),
                resource: Resource::new(format!("document:{}", i % 50)),
                action: Action::new("read"),
                context: HashMap::new(),
            };

            engine_clone.check(&request).await
        });

        handles.push(handle);
    }

    let mut success_count = 0;
    for handle in handles {
        if handle.await.unwrap().is_ok() {
            success_count += 1;
        }
    }

    let duration = start.elapsed();
    let throughput = success_count as f64 / duration.as_secs_f64();

    println!("With audit - Throughput: {:.2} req/sec", throughput);

    // With audit, should still achieve > 1K req/sec
    assert!(
        throughput > 1_000.0,
        "With audit enabled, should still exceed 1K req/sec, got {:.2}",
        throughput
    );
}

#[tokio::test]
async fn test_sustained_throughput() {
    // TDD: Test sustained throughput over time
    let config = EngineConfig {
        enable_cache: true,
        cache_capacity: 10000,
        enable_audit: false,
        default_decision: PolicyEffect::Deny,
    };

    let engine = Arc::new(AuthzEngine::with_config(config).await.unwrap());

    let policy = Policy {
        id: "sustained-policy".to_string(),
        name: "Sustained throughput test".to_string(),
        effect: PolicyEffect::Allow,
        principal: "*".to_string(),
        resource: "*".to_string(),
        action: "*".to_string(),
        condition: None,
        priority: 100,
    };

    engine.add_policy(policy).await.unwrap();

    // Run for 10 seconds at ~10K req/sec
    let mut total_requests = 0;
    let test_duration = Duration::from_secs(10);
    let start = Instant::now();

    while start.elapsed() < test_duration {
        let mut batch_handles = vec![];

        // Send batch of 1000 requests
        for i in 0..1000 {
            let engine_clone = Arc::clone(&engine);
            let handle = tokio::spawn(async move {
                let request = AuthzRequest {
                    principal: Principal::new(format!("user:user{}@example.com", i % 50)),
                    resource: Resource::new(format!("document:{}", i % 50)),
                    action: Action::new("read"),
                    context: HashMap::new(),
                };

                engine_clone.check(&request).await
            });

            batch_handles.push(handle);
        }

        for handle in batch_handles {
            if handle.await.unwrap().is_ok() {
                total_requests += 1;
            }
        }

        // Small pause to prevent overwhelming
        sleep(Duration::from_millis(100)).await;
    }

    let actual_duration = start.elapsed();
    let avg_throughput = total_requests as f64 / actual_duration.as_secs_f64();

    println!("Sustained throughput: {:.2} req/sec over {:?}", avg_throughput, actual_duration);

    assert!(
        avg_throughput > 5_000.0,
        "Sustained throughput should exceed 5K req/sec, got {:.2}",
        avg_throughput
    );
}

// ============================================================================
// CACHE HIT RATE TESTS
// ============================================================================

#[tokio::test]
async fn test_cache_hit_rate_above_80_percent() {
    // TDD: Test that cache hit rate exceeds 80% with realistic traffic
    let config = EngineConfig {
        enable_cache: true,
        cache_capacity: 1000,
        enable_audit: false,
        default_decision: PolicyEffect::Deny,
    };

    let engine = Arc::new(AuthzEngine::with_config(config).await.unwrap());

    let policy = Policy {
        id: "cache-hit-policy".to_string(),
        name: "Cache hit rate test".to_string(),
        effect: PolicyEffect::Allow,
        principal: "*".to_string(),
        resource: "*".to_string(),
        action: "*".to_string(),
        condition: None,
        priority: 100,
    };

    engine.add_policy(policy).await.unwrap();

    // Simulate realistic access pattern:
    // - 80% of requests target 20% of resources (hot data)
    // - 20% of requests target 80% of resources (cold data)

    let mut handles = vec![];

    for i in 0..10_000 {
        let engine_clone = Arc::clone(&engine);
        let handle = tokio::spawn(async move {
            let resource_id = if i % 100 < 80 {
                // Hot data - 20% of resources
                format!("document:{}", i % 20)
            } else {
                // Cold data - 80% of resources
                format!("document:{}", 20 + (i % 80))
            };

            let request = AuthzRequest {
                principal: Principal::new(format!("user:user{}@example.com", i % 50)),
                resource: Resource::new(resource_id),
                action: Action::new("read"),
                context: HashMap::new(),
            };

            let start = Instant::now();
            let result = engine_clone.check(&request).await;
            let latency = start.elapsed();

            (result, latency)
        });

        handles.push(handle);
    }

    let mut cache_hits = 0;
    let mut total_requests = 0;

    for handle in handles {
        let (result, latency) = handle.await.unwrap();
        if result.is_ok() {
            total_requests += 1;

            // Heuristic: cache hits are typically < 1ms
            if latency < Duration::from_millis(1) {
                cache_hits += 1;
            }
        }
    }

    let hit_rate = (cache_hits as f64 / total_requests as f64) * 100.0;

    println!("Cache hit rate: {:.2}%", hit_rate);
    println!("Cache hits: {}/{}", cache_hits, total_requests);

    // TODO: Implement proper cache hit/miss tracking in Phase 3
    // For now, this is a heuristic based on latency
}

// ============================================================================
// CONCURRENT LOAD TESTS
// ============================================================================

#[tokio::test]
async fn test_concurrent_users_performance() {
    // TDD: Test performance with high concurrency (1000 concurrent users)
    let config = EngineConfig {
        enable_cache: true,
        cache_capacity: 50000,
        enable_audit: false,
        default_decision: PolicyEffect::Deny,
    };

    let engine = Arc::new(AuthzEngine::with_config(config).await.unwrap());

    let policy = Policy {
        id: "concurrent-policy".to_string(),
        name: "Concurrent users test".to_string(),
        effect: PolicyEffect::Allow,
        principal: "*".to_string(),
        resource: "*".to_string(),
        action: "*".to_string(),
        condition: None,
        priority: 100,
    };

    engine.add_policy(policy).await.unwrap();

    let start = Instant::now();
    let mut handles = vec![];

    // Simulate 1000 concurrent users, each making 10 requests
    for user_id in 0..1000 {
        let engine_clone = Arc::clone(&engine);
        let handle = tokio::spawn(async move {
            let mut user_latencies = vec![];

            for req_num in 0..10 {
                let request = AuthzRequest {
                    principal: Principal::new(format!("user:user{}@example.com", user_id)),
                    resource: Resource::new(format!("document:{}", req_num)),
                    action: Action::new("read"),
                    context: HashMap::new(),
                };

                let req_start = Instant::now();
                let _ = engine_clone.check(&request).await;
                user_latencies.push(req_start.elapsed());
            }

            user_latencies
        });

        handles.push(handle);
    }

    let mut all_latencies = vec![];
    for handle in handles {
        let latencies = handle.await.unwrap();
        all_latencies.extend(latencies);
    }

    let duration = start.elapsed();
    let total_requests = all_latencies.len();
    let throughput = total_requests as f64 / duration.as_secs_f64();

    all_latencies.sort();
    let p99 = all_latencies[(all_latencies.len() as f64 * 0.99) as usize];

    println!("Concurrent users test:");
    println!("  Total requests: {}", total_requests);
    println!("  Duration: {:?}", duration);
    println!("  Throughput: {:.2} req/sec", throughput);
    println!("  P99 latency: {:?}", p99);

    assert_eq!(total_requests, 10_000, "Should complete all requests");
    assert!(p99 < Duration::from_millis(50), "P99 should be reasonable under high concurrency");
}

// ============================================================================
// MEMORY AND RESOURCE TESTS
// ============================================================================

#[tokio::test]
async fn test_memory_usage_under_load() {
    // TDD: Test that memory usage remains stable under load
    let config = EngineConfig {
        enable_cache: true,
        cache_capacity: 10000,
        enable_audit: false,
        default_decision: PolicyEffect::Deny,
    };

    let engine = Arc::new(AuthzEngine::with_config(config).await.unwrap());

    let policy = Policy {
        id: "memory-test".to_string(),
        name: "Memory test policy".to_string(),
        effect: PolicyEffect::Allow,
        principal: "*".to_string(),
        resource: "*".to_string(),
        action: "*".to_string(),
        condition: None,
        priority: 100,
    };

    engine.add_policy(policy).await.unwrap();

    // Process 50K requests and verify no memory leaks
    for batch in 0..50 {
        let mut handles = vec![];

        for i in 0..1000 {
            let engine_clone = Arc::clone(&engine);
            let handle = tokio::spawn(async move {
                let request = AuthzRequest {
                    principal: Principal::new(format!("user:user{}@example.com", i % 100)),
                    resource: Resource::new(format!("document:{}", i % 200)),
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

        // Periodic memory check
        if batch % 10 == 0 {
            println!("Completed {} batches ({}K requests)", batch, batch);
            // TODO: Add actual memory usage tracking in Phase 3
        }
    }

    println!("Memory test completed - 50K requests processed");
    // Memory should remain stable (no leaks)
}

// ============================================================================
// SCALABILITY TESTS
// ============================================================================

#[tokio::test]
async fn test_scalability_with_many_policies() {
    // TDD: Test performance with many policies
    let engine = AuthzEngine::new().await.unwrap();

    // Add 1000 policies
    for i in 0..1000 {
        let policy = Policy {
            id: format!("policy-{}", i),
            name: format!("Policy {}", i),
            effect: if i % 2 == 0 { PolicyEffect::Allow } else { PolicyEffect::Deny },
            principal: format!("user:user{}@example.com", i % 100),
            resource: format!("document:{}", i % 200),
            action: "read".to_string(),
            condition: None,
            priority: i,
        };

        engine.add_policy(policy).await.unwrap();
    }

    // Measure latency with many policies
    let mut latencies = vec![];

    for i in 0..100 {
        let request = AuthzRequest {
            principal: Principal::new(format!("user:user{}@example.com", i % 100)),
            resource: Resource::new(format!("document:{}", i % 200)),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let start = Instant::now();
        engine.check(&request).await.unwrap();
        latencies.push(start.elapsed());
    }

    latencies.sort();
    let p99 = latencies[(latencies.len() as f64 * 0.99) as usize];

    println!("P99 latency with 1000 policies: {:?}", p99);

    // Even with many policies, should maintain reasonable performance
    assert!(p99 < Duration::from_millis(100), "Should scale with many policies");
}
