//! Comprehensive benchmarks for Phase 2 components
//!
//! Run with: cargo bench
//!
//! Performance targets:
//! - Derived role resolution: <1ms
//! - Scope matching: <100μs
//! - Vector search (10K policies): <50ms

use authz::derived_roles::DerivedRoleResolver;
use authz::{ScopeConfig, ScopeResolver};
use authz::types::DerivedRole;
use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use std::time::Duration;

// ============================================================================
// Derived Roles Benchmarks
// ============================================================================

fn bench_derived_roles_simple(c: &mut Criterion) {
    let mut group = c.benchmark_group("derived_roles/simple");

    let resolver = DerivedRoleResolver::new();
    let principal_roles = vec!["employee".to_string()];

    let role = DerivedRole::new(
        "team_lead".to_string(),
        vec!["employee".to_string()],
        None,
    );
    resolver.add_role(role).unwrap();

    group.bench_function("resolve_single", |b| {
        b.to_async(tokio::runtime::Runtime::new().unwrap())
            .iter(|| async {
                let result = resolver.resolve_roles(black_box(&principal_roles), None).await;
                black_box(result)
            });
    });

    group.finish();
}

fn bench_derived_roles_chain(c: &mut Criterion) {
    let mut group = c.benchmark_group("derived_roles/chain");

    for depth in [2, 5, 10] {
        let resolver = DerivedRoleResolver::new();
        let principal_roles = vec!["employee".to_string()];

        // Create chain of roles
        for i in 0..depth {
            let parent = if i == 0 {
                "employee".to_string()
            } else {
                format!("role_{}", i - 1)
            };

            let role = DerivedRole::new(
                format!("role_{}", i),
                vec![parent],
                None,
            );
            resolver.add_role(role).unwrap();
        }

        group.bench_with_input(BenchmarkId::from_parameter(depth), &depth, |b, _| {
            b.to_async(tokio::runtime::Runtime::new().unwrap())
                .iter(|| async {
                    let result = resolver.resolve_roles(black_box(&principal_roles), None).await;
                    black_box(result)
                });
        });
    }

    group.finish();
}

fn bench_derived_roles_diamond(c: &mut Criterion) {
    let mut group = c.benchmark_group("derived_roles/diamond");

    let resolver = DerivedRoleResolver::new();
    let principal_roles = vec!["employee".to_string()];

    // Diamond dependency: employee -> [a, b] -> director
    resolver.add_role(DerivedRole::new(
        "role_a".to_string(),
        vec!["employee".to_string()],
        None,
    )).unwrap();

    resolver.add_role(DerivedRole::new(
        "role_b".to_string(),
        vec!["employee".to_string()],
        None,
    )).unwrap();

    resolver.add_role(DerivedRole::new(
        "director".to_string(),
        vec!["role_a".to_string(), "role_b".to_string()],
        None,
    )).unwrap();

    group.bench_function("resolve_diamond", |b| {
        b.to_async(tokio::runtime::Runtime::new().unwrap())
            .iter(|| async {
                let result = resolver.resolve_roles(black_box(&principal_roles), None).await;
                black_box(result)
            });
    });

    group.finish();
}

fn bench_derived_roles_wide(c: &mut Criterion) {
    let mut group = c.benchmark_group("derived_roles/wide");

    for width in [10, 50, 100] {
        let resolver = DerivedRoleResolver::new();
        let principal_roles = vec!["employee".to_string()];

        // Create wide dependency (many roles with same parent)
        for i in 0..width {
            let role = DerivedRole::new(
                format!("role_{}", i),
                vec!["employee".to_string()],
                None,
            );
            resolver.add_role(role).unwrap();
        }

        group.throughput(Throughput::Elements(width));
        group.bench_with_input(BenchmarkId::from_parameter(width), &width, |b, _| {
            b.to_async(tokio::runtime::Runtime::new().unwrap())
                .iter(|| async {
                    let result = resolver.resolve_roles(black_box(&principal_roles), None).await;
                    black_box(result)
                });
        });
    }

    group.finish();
}

// ============================================================================
// Scope Resolver Benchmarks
// ============================================================================

fn bench_scope_build_chain(c: &mut Criterion) {
    let mut group = c.benchmark_group("scope/build_chain");

    let resolver = ScopeResolver::new(ScopeConfig::default());

    for depth in [1, 3, 5, 10] {
        let segments: Vec<String> = (0..depth).map(|i| format!("seg{}", i)).collect();
        let scope = segments.join(".");

        group.bench_with_input(BenchmarkId::from_parameter(depth), &scope, |b, scope| {
            b.iter(|| {
                let result = resolver.build_scope_chain(black_box(scope));
                black_box(result)
            });
        });
    }

    group.finish();
}

fn bench_scope_build_chain_cached(c: &mut Criterion) {
    let mut group = c.benchmark_group("scope/build_chain_cached");

    let resolver = ScopeResolver::new(ScopeConfig::default());
    let scope = "org.acme.dept.engineering.team.project";

    // Warm up cache
    let _ = resolver.build_scope_chain(scope);

    group.bench_function("cached", |b| {
        b.iter(|| {
            let result = resolver.build_scope_chain(black_box(scope));
            black_box(result)
        });
    });

    group.finish();
}

fn bench_scope_matching(c: &mut Criterion) {
    let mut group = c.benchmark_group("scope/matching");

    let resolver = ScopeResolver::new(ScopeConfig::default());

    // Test different pattern types
    let test_cases = vec![
        ("exact", "org.acme.dept", "org.acme.dept"),
        ("single_wildcard", "org.*", "org.acme"),
        ("double_wildcard", "org.**", "org.acme.dept.engineering"),
        ("complex", "org.*.dept.**.team", "org.acme.dept.eng.sub.team"),
    ];

    for (name, pattern, scope) in test_cases {
        group.bench_with_input(BenchmarkId::new(name, pattern), &(pattern, scope), |b, (p, s)| {
            b.iter(|| {
                let result = resolver.match_scope(black_box(p), black_box(s));
                black_box(result)
            });
        });
    }

    group.finish();
}

fn bench_scope_validation(c: &mut Criterion) {
    let mut group = c.benchmark_group("scope/validation");

    let resolver = ScopeResolver::new(ScopeConfig::default());

    for depth in [1, 5, 10] {
        let segments: Vec<String> = (0..depth).map(|i| format!("seg{}", i)).collect();
        let scope = segments.join(".");

        group.bench_with_input(BenchmarkId::from_parameter(depth), &scope, |b, scope| {
            b.iter(|| {
                let result = resolver.validate_scope(black_box(scope));
                black_box(result)
            });
        });
    }

    group.finish();
}

fn bench_scope_concurrent(c: &mut Criterion) {
    let mut group = c.benchmark_group("scope/concurrent");
    group.sample_size(10);
    group.measurement_time(Duration::from_secs(10));

    let resolver = std::sync::Arc::new(ScopeResolver::new(ScopeConfig::default()));

    group.bench_function("parallel_100", |b| {
        b.to_async(tokio::runtime::Runtime::new().unwrap())
            .iter(|| {
                let resolver = resolver.clone();
                async move {
                    let mut tasks = Vec::new();
                    for i in 0..100 {
                        let resolver = resolver.clone();
                        tasks.push(tokio::spawn(async move {
                            let scope = format!("org.dept{}.team", i % 10);
                            resolver.build_scope_chain(&scope)
                        }));
                    }

                    for task in tasks {
                        let _ = task.await;
                    }
                }
            });
    });

    group.finish();
}

// ============================================================================
// Combined/Integration Benchmarks
// ============================================================================

fn bench_full_authorization_flow(c: &mut Criterion) {
    let mut group = c.benchmark_group("integration/full_flow");
    group.measurement_time(Duration::from_secs(10));

    let scope_resolver = ScopeResolver::new(ScopeConfig::default());
    let role_resolver = DerivedRoleResolver::new();

    // Setup derived roles
    role_resolver.add_role(DerivedRole::new(
        "manager".to_string(),
        vec!["employee".to_string()],
        None,
    )).unwrap();

    role_resolver.add_role(DerivedRole::new(
        "director".to_string(),
        vec!["manager".to_string()],
        None,
    )).unwrap();

    let principal_roles = vec!["employee".to_string()];
    let scope = "org.acme.dept.engineering";

    group.bench_function("resolve_and_match", |b| {
        b.to_async(tokio::runtime::Runtime::new().unwrap())
            .iter(|| async {
                // Resolve derived roles
                let derived = role_resolver
                    .resolve_roles(black_box(&principal_roles), None)
                    .await
                    .unwrap();
                black_box(&derived);

                // Build scope chain
                let chain = scope_resolver.build_scope_chain(black_box(scope)).unwrap();
                black_box(&chain);

                // Match scope pattern
                let matches = scope_resolver.match_scope(black_box("org.acme.**"), black_box(scope));
                black_box(matches);
            });
    });

    group.finish();
}

// Criterion setup
criterion_group!(
    derived_roles_benches,
    bench_derived_roles_simple,
    bench_derived_roles_chain,
    bench_derived_roles_diamond,
    bench_derived_roles_wide
);

criterion_group!(
    scope_benches,
    bench_scope_build_chain,
    bench_scope_build_chain_cached,
    bench_scope_matching,
    bench_scope_validation,
    bench_scope_concurrent
);

criterion_group!(
    integration_benches,
    bench_full_authorization_flow
);

criterion_main!(
    derived_roles_benches,
    scope_benches,
    integration_benches
);
