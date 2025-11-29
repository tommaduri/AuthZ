//! Authorization engine benchmarks
//!
//! Compare performance with Go implementation:
//! Go: ~1,218 ns/op, 2,186 bytes/op
//! Rust target: 300-600 ns/op, 500-1,000 bytes/op (2-4x faster, 50-70% less memory)

use cretoai_authz::{
    AuthzEngine, AuthzRequest, Principal, Resource, Action,
    Policy, PolicyEffect, EngineConfig,
};
use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use std::collections::HashMap;
use tokio::runtime::Runtime;

fn create_test_policies(count: usize) -> Vec<Policy> {
    (0..count)
        .map(|i| Policy {
            id: format!("policy-{}", i),
            name: format!("Test policy {}", i),
            effect: if i % 2 == 0 { PolicyEffect::Allow } else { PolicyEffect::Deny },
            principal: format!("user:test-{}", i % 10),
            resource: format!("document:{}", i % 100),
            action: "read".to_string(),
            condition: None,
            priority: i as i32,
        })
        .collect()
}

fn bench_authorization_check(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let mut group = c.benchmark_group("authorization_check");

    for policy_count in [10, 100, 1000].iter() {
        group.benchmark_with_input(
            BenchmarkId::new("policies", policy_count),
            policy_count,
            |b, &count| {
                let engine = rt.block_on(async {
                    let config = EngineConfig {
                        enable_cache: false,  // Benchmark without cache
                        enable_audit: false,  // Benchmark without audit
                        ..Default::default()
                    };
                    let engine = AuthzEngine::with_config(config).await.unwrap();

                    let policies = create_test_policies(count);
                    for policy in policies {
                        engine.add_policy(policy).await.unwrap();
                    }

                    engine
                });

                let request = AuthzRequest {
                    principal: Principal::new("user:alice@example.com"),
                    resource: Resource::new("document:sensitive-123"),
                    action: Action::new("read"),
                    context: HashMap::new(),
                };

                b.to_async(&rt).iter(|| async {
                    let decision = engine.check(black_box(&request)).await.unwrap();
                    black_box(decision);
                });
            },
        );
    }

    group.finish();
}

fn bench_authorization_with_cache(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let mut group = c.benchmark_group("authorization_with_cache");

    for policy_count in [10, 100, 1000].iter() {
        group.benchmark_with_input(
            BenchmarkId::new("policies", policy_count),
            policy_count,
            |b, &count| {
                let engine = rt.block_on(async {
                    let config = EngineConfig {
                        enable_cache: true,
                        cache_capacity: 10000,
                        enable_audit: false,
                        ..Default::default()
                    };
                    let engine = AuthzEngine::with_config(config).await.unwrap();

                    let policies = create_test_policies(count);
                    for policy in policies {
                        engine.add_policy(policy).await.unwrap();
                    }

                    engine
                });

                let request = AuthzRequest {
                    principal: Principal::new("user:alice@example.com"),
                    resource: Resource::new("document:sensitive-123"),
                    action: Action::new("read"),
                    context: HashMap::new(),
                };

                // Prime the cache
                rt.block_on(async {
                    engine.check(&request).await.unwrap();
                });

                b.to_async(&rt).iter(|| async {
                    let decision = engine.check(black_box(&request)).await.unwrap();
                    black_box(decision);
                });
            },
        );
    }

    group.finish();
}

fn bench_policy_evaluation(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    c.bench_function("policy_evaluation", |b| {
        let policy = Policy {
            id: "test-policy".to_string(),
            name: "Test".to_string(),
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

        b.to_async(&rt).iter(|| async {
            let matches = policy.matches(black_box(&request));
            black_box(matches);
        });
    });
}

fn bench_dag_audit_trail(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    c.bench_function("dag_audit_trail", |b| {
        let engine = rt.block_on(async {
            let config = EngineConfig {
                enable_cache: false,
                enable_audit: true,  // Enable DAG audit
                ..Default::default()
            };
            let engine = AuthzEngine::with_config(config).await.unwrap();

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
            engine
        });

        let request = AuthzRequest {
            principal: Principal::new("user:alice@example.com"),
            resource: Resource::new("document:123"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        b.to_async(&rt).iter(|| async {
            let decision = engine.check(black_box(&request)).await.unwrap();
            black_box(decision);
        });
    });
}

criterion_group!(
    benches,
    bench_authorization_check,
    bench_authorization_with_cache,
    bench_policy_evaluation,
    bench_dag_audit_trail
);
criterion_main!(benches);
