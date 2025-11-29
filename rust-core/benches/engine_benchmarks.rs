//! Phase 3: Engine Performance Benchmarks
//!
//! Criterion benchmarks for authorization engine performance

use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId, Throughput};
use cretoai_authz::{
    engine::{AuthzEngine, EngineConfig},
    policy::{Policy, PolicyEffect},
    types::{Action, AuthzRequest, Principal, Resource},
};
use std::collections::HashMap;
use tokio::runtime::Runtime;

// ============================================================================
// DECISION LATENCY BENCHMARKS
// ============================================================================

fn bench_simple_decision(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let engine = rt.block_on(async {
        let config = EngineConfig {
            enable_cache: false,
            cache_capacity: 100,
            enable_audit: false,
            default_decision: PolicyEffect::Deny,
        };

        let engine = AuthzEngine::with_config(config).await.unwrap();

        let policy = Policy {
            id: "bench-policy".to_string(),
            name: "Benchmark policy".to_string(),
            effect: PolicyEffect::Allow,
            principal: "user:*".to_string(),
            resource: "document:*".to_string(),
            action: "read".to_string(),
            condition: None,
            priority: 100,
        };

        engine.add_policy(policy).await.unwrap();
        engine
    });

    c.bench_function("simple_decision_no_cache", |b| {
        b.to_async(&rt).iter(|| async {
            let request = AuthzRequest {
                principal: Principal::new("user:alice@example.com"),
                resource: Resource::new("document:test"),
                action: Action::new("read"),
                context: HashMap::new(),
            };

            black_box(engine.check(&request).await.unwrap())
        });
    });
}

fn bench_cached_decision(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let engine = rt.block_on(async {
        let config = EngineConfig {
            enable_cache: true,
            cache_capacity: 10000,
            enable_audit: false,
            default_decision: PolicyEffect::Deny,
        };

        let engine = AuthzEngine::with_config(config).await.unwrap();

        let policy = Policy {
            id: "bench-cache-policy".to_string(),
            name: "Cache benchmark policy".to_string(),
            effect: PolicyEffect::Allow,
            principal: "user:*".to_string(),
            resource: "document:*".to_string(),
            action: "read".to_string(),
            condition: None,
            priority: 100,
        };

        engine.add_policy(policy).await.unwrap();

        // Warm up cache
        let request = AuthzRequest {
            principal: Principal::new("user:alice@example.com"),
            resource: Resource::new("document:test"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        engine.check(&request).await.unwrap();

        engine
    });

    c.bench_function("cached_decision", |b| {
        b.to_async(&rt).iter(|| async {
            let request = AuthzRequest {
                principal: Principal::new("user:alice@example.com"),
                resource: Resource::new("document:test"),
                action: Action::new("read"),
                context: HashMap::new(),
            };

            black_box(engine.check(&request).await.unwrap())
        });
    });
}

fn bench_cel_evaluation(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let engine = rt.block_on(async {
        let config = EngineConfig {
            enable_cache: false,
            cache_capacity: 100,
            enable_audit: false,
            default_decision: PolicyEffect::Deny,
        };

        let engine = AuthzEngine::with_config(config).await.unwrap();

        let policy = Policy {
            id: "cel-bench-policy".to_string(),
            name: "CEL benchmark policy".to_string(),
            effect: PolicyEffect::Allow,
            principal: "user:*".to_string(),
            resource: "document:*".to_string(),
            action: "read".to_string(),
            condition: Some(
                "principal.attributes.level >= 3 && \
                 resource.attributes.sensitivity <= principal.attributes.level"
                    .to_string()
            ),
            priority: 100,
        };

        engine.add_policy(policy).await.unwrap();
        engine
    });

    c.bench_function("cel_evaluation", |b| {
        b.to_async(&rt).iter(|| async {
            let request = AuthzRequest {
                principal: Principal::new("user:bob@example.com")
                    .with_attribute("level", "5"),
                resource: Resource::new("document:classified")
                    .with_attribute("sensitivity", "4"),
                action: Action::new("read"),
                context: HashMap::new(),
            };

            black_box(engine.check(&request).await.unwrap())
        });
    });
}

// ============================================================================
// THROUGHPUT BENCHMARKS
// ============================================================================

fn bench_throughput_single_thread(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let engine = rt.block_on(async {
        let config = EngineConfig {
            enable_cache: true,
            cache_capacity: 10000,
            enable_audit: false,
            default_decision: PolicyEffect::Deny,
        };

        let engine = AuthzEngine::with_config(config).await.unwrap();

        let policy = Policy {
            id: "throughput-policy".to_string(),
            name: "Throughput benchmark".to_string(),
            effect: PolicyEffect::Allow,
            principal: "*".to_string(),
            resource: "*".to_string(),
            action: "*".to_string(),
            condition: None,
            priority: 100,
        };

        engine.add_policy(policy).await.unwrap();
        engine
    });

    let mut group = c.benchmark_group("throughput_single_thread");

    for batch_size in [10, 100, 1000].iter() {
        group.throughput(Throughput::Elements(*batch_size as u64));
        group.bench_with_input(
            BenchmarkId::from_parameter(batch_size),
            batch_size,
            |b, &batch_size| {
                b.to_async(&rt).iter(|| async {
                    for i in 0..batch_size {
                        let request = AuthzRequest {
                            principal: Principal::new(format!("user:user{}@example.com", i % 50)),
                            resource: Resource::new(format!("document:{}", i % 50)),
                            action: Action::new("read"),
                            context: HashMap::new(),
                        };

                        black_box(engine.check(&request).await.unwrap());
                    }
                });
            },
        );
    }

    group.finish();
}

// ============================================================================
// CACHE PERFORMANCE BENCHMARKS
// ============================================================================

fn bench_cache_operations(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let mut group = c.benchmark_group("cache_operations");

    // Benchmark cache with different hit rates
    for hit_rate in [0, 50, 80, 95].iter() {
        let engine = rt.block_on(async {
            let config = EngineConfig {
                enable_cache: true,
                cache_capacity: 1000,
                enable_audit: false,
                default_decision: PolicyEffect::Deny,
            };

            let engine = AuthzEngine::with_config(config).await.unwrap();

            let policy = Policy {
                id: "cache-bench-policy".to_string(),
                name: "Cache benchmark policy".to_string(),
                effect: PolicyEffect::Allow,
                principal: "*".to_string(),
                resource: "*".to_string(),
                action: "*".to_string(),
                condition: None,
                priority: 100,
            };

            engine.add_policy(policy).await.unwrap();

            // Pre-populate cache based on hit rate
            if *hit_rate > 0 {
                for i in 0..100 {
                    let request = AuthzRequest {
                        principal: Principal::new(format!("user:user{}@example.com", i)),
                        resource: Resource::new(format!("document:{}", i)),
                        action: Action::new("read"),
                        context: HashMap::new(),
                    };

                    engine.check(&request).await.unwrap();
                }
            }

            engine
        });

        group.bench_with_input(
            BenchmarkId::new("cache_hit_rate", hit_rate),
            hit_rate,
            |b, &hit_rate| {
                b.to_async(&rt).iter(|| async {
                    // Simulate access pattern based on hit rate
                    let resource_id = if rand::random::<u8>() % 100 < hit_rate {
                        // Cache hit - access hot data
                        format!("document:{}", rand::random::<u8>() % 100)
                    } else {
                        // Cache miss - access cold data
                        format!("document:{}", 100 + rand::random::<u16>())
                    };

                    let request = AuthzRequest {
                        principal: Principal::new("user:test@example.com"),
                        resource: Resource::new(resource_id),
                        action: Action::new("read"),
                        context: HashMap::new(),
                    };

                    black_box(engine.check(&request).await.unwrap())
                });
            },
        );
    }

    group.finish();
}

// ============================================================================
// POLICY COMPLEXITY BENCHMARKS
// ============================================================================

fn bench_policy_count_impact(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let mut group = c.benchmark_group("policy_count_impact");

    for policy_count in [1, 10, 100, 1000].iter() {
        let engine = rt.block_on(async {
            let engine = AuthzEngine::new().await.unwrap();

            // Add policies
            for i in 0..*policy_count {
                let policy = Policy {
                    id: format!("policy-{}", i),
                    name: format!("Policy {}", i),
                    effect: PolicyEffect::Allow,
                    principal: format!("user:user{}@example.com", i % 50),
                    resource: format!("document:{}", i % 100),
                    action: "read".to_string(),
                    condition: None,
                    priority: i,
                };

                engine.add_policy(policy).await.unwrap();
            }

            engine
        });

        group.bench_with_input(
            BenchmarkId::from_parameter(policy_count),
            policy_count,
            |b, _policy_count| {
                b.to_async(&rt).iter(|| async {
                    let request = AuthzRequest {
                        principal: Principal::new("user:user25@example.com"),
                        resource: Resource::new("document:50"),
                        action: Action::new("read"),
                        context: HashMap::new(),
                    };

                    black_box(engine.check(&request).await.unwrap())
                });
            },
        );
    }

    group.finish();
}

// ============================================================================
// AUDIT TRAIL BENCHMARKS
// ============================================================================

fn bench_with_audit_enabled(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let engine_no_audit = rt.block_on(async {
        let config = EngineConfig {
            enable_cache: true,
            cache_capacity: 1000,
            enable_audit: false,
            default_decision: PolicyEffect::Deny,
        };

        let engine = AuthzEngine::with_config(config).await.unwrap();

        let policy = Policy {
            id: "no-audit-policy".to_string(),
            name: "No audit policy".to_string(),
            effect: PolicyEffect::Allow,
            principal: "*".to_string(),
            resource: "*".to_string(),
            action: "*".to_string(),
            condition: None,
            priority: 100,
        };

        engine.add_policy(policy).await.unwrap();
        engine
    });

    let engine_with_audit = rt.block_on(async {
        let config = EngineConfig {
            enable_cache: true,
            cache_capacity: 1000,
            enable_audit: true,
            default_decision: PolicyEffect::Deny,
        };

        let engine = AuthzEngine::with_config(config).await.unwrap();

        let policy = Policy {
            id: "audit-policy".to_string(),
            name: "Audit policy".to_string(),
            effect: PolicyEffect::Allow,
            principal: "*".to_string(),
            resource: "*".to_string(),
            action: "*".to_string(),
            condition: None,
            priority: 100,
        };

        engine.add_policy(policy).await.unwrap();
        engine
    });

    let mut group = c.benchmark_group("audit_overhead");

    group.bench_function("without_audit", |b| {
        b.to_async(&rt).iter(|| async {
            let request = AuthzRequest {
                principal: Principal::new("user:charlie@example.com"),
                resource: Resource::new("document:test"),
                action: Action::new("read"),
                context: HashMap::new(),
            };

            black_box(engine_no_audit.check(&request).await.unwrap())
        });
    });

    group.bench_function("with_audit", |b| {
        b.to_async(&rt).iter(|| async {
            let request = AuthzRequest {
                principal: Principal::new("user:charlie@example.com"),
                resource: Resource::new("document:test"),
                action: Action::new("read"),
                context: HashMap::new(),
            };

            black_box(engine_with_audit.check(&request).await.unwrap())
        });
    });

    group.finish();
}

// ============================================================================
// CRITERION CONFIGURATION
// ============================================================================

criterion_group!(
    benches,
    bench_simple_decision,
    bench_cached_decision,
    bench_cel_evaluation,
    bench_throughput_single_thread,
    bench_cache_operations,
    bench_policy_count_impact,
    bench_with_audit_enabled,
);

criterion_main!(benches);
