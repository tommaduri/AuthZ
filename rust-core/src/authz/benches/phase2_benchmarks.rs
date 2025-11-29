//! Phase 2 performance benchmarks using Criterion
//!
//! Benchmarks for:
//! - Derived role resolution
//! - Scope matching
//! - Cache performance
//! - Concurrent operations

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use cretoai_authz::derived_roles::{DerivedRoleResolver, RoleResolutionCache};
use cretoai_authz::policy::Role;
use cretoai_authz::scope::{ScopeResolver, ScopeCache, ScopePattern, ResourcePath};
use std::sync::Arc;
use std::time::Duration;
use tokio::runtime::Runtime;

/// Create a sample role hierarchy for benchmarking
fn create_test_roles() -> Vec<Role> {
    vec![
        Role {
            id: "admin".to_string(),
            name: "Admin".to_string(),
            description: Some("System Administrator".to_string()),
            permissions: vec!["*".to_string()].into_iter().collect(),
            inherits_from: vec![],
            metadata: Default::default(),
        },
        Role {
            id: "manager".to_string(),
            name: "Manager".to_string(),
            description: Some("Team Manager".to_string()),
            permissions: vec!["manage:*".to_string()].into_iter().collect(),
            inherits_from: vec!["admin".to_string()],
            metadata: Default::default(),
        },
        Role {
            id: "developer".to_string(),
            name: "Developer".to_string(),
            description: Some("Software Developer".to_string()),
            permissions: vec!["code:write".to_string(), "code:read".to_string()]
                .into_iter()
                .collect(),
            inherits_from: vec!["manager".to_string()],
            metadata: Default::default(),
        },
        Role {
            id: "intern".to_string(),
            name: "Intern".to_string(),
            description: Some("Engineering Intern".to_string()),
            permissions: vec!["code:read".to_string()].into_iter().collect(),
            inherits_from: vec!["developer".to_string()],
            metadata: Default::default(),
        },
    ]
}

/// Create sample scope patterns for benchmarking
fn create_test_scopes() -> Vec<(ScopePattern, ResourcePath)> {
    vec![
        (
            ScopePattern::new("org:*"),
            ResourcePath::new("/org/acme"),
        ),
        (
            ScopePattern::new("org:acme/dept:*"),
            ResourcePath::new("/org/acme/dept/engineering"),
        ),
        (
            ScopePattern::new("org:acme/dept:engineering/team:*"),
            ResourcePath::new("/org/acme/dept/engineering/team/backend"),
        ),
    ]
}

/// Benchmark derived role resolution
fn bench_role_resolution(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let roles = create_test_roles();

    let mut group = c.benchmark_group("role_resolution");

    // Benchmark without cache
    group.bench_function("no_cache", |b| {
        b.to_async(&rt).iter(|| async {
            let cache = Arc::new(RoleResolutionCache::new(0, Duration::from_secs(300)));
            let resolver = DerivedRoleResolver::new(roles.clone(), cache);
            black_box(resolver.resolve_role_permissions("intern").await.unwrap())
        });
    });

    // Benchmark with cache (cold)
    group.bench_function("cache_cold", |b| {
        b.to_async(&rt).iter(|| async {
            let cache = Arc::new(RoleResolutionCache::new(1000, Duration::from_secs(300)));
            let resolver = DerivedRoleResolver::new(roles.clone(), cache);
            black_box(resolver.resolve_role_permissions("intern").await.unwrap())
        });
    });

    // Benchmark with cache (warm)
    group.bench_function("cache_warm", |b| {
        let cache = Arc::new(RoleResolutionCache::new(1000, Duration::from_secs(300)));
        let resolver = DerivedRoleResolver::new(roles.clone(), cache);

        // Pre-warm cache
        rt.block_on(async {
            resolver.resolve_role_permissions("intern").await.unwrap();
        });

        b.to_async(&rt).iter(|| async {
            black_box(resolver.resolve_role_permissions("intern").await.unwrap())
        });
    });

    group.finish();
}

/// Benchmark role resolution at different hierarchy depths
fn bench_role_resolution_depth(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let mut group = c.benchmark_group("role_resolution_depth");

    for depth in [1, 2, 4, 8, 16] {
        // Create hierarchy of specified depth
        let mut roles = vec![Role {
            id: "level_0".to_string(),
            name: "Level 0".to_string(),
            description: Some("Root role".to_string()),
            permissions: vec!["level_0:permission".to_string()].into_iter().collect(),
            inherits_from: vec![],
            metadata: Default::default(),
        }];

        for i in 1..depth {
            roles.push(Role {
                id: format!("level_{}", i),
                name: format!("Level {}", i),
                description: Some(format!("Role at level {}", i)),
                permissions: vec![format!("level_{}:permission", i)].into_iter().collect(),
                inherits_from: vec![format!("level_{}", i - 1)],
                metadata: Default::default(),
            });
        }

        let cache = Arc::new(RoleResolutionCache::new(1000, Duration::from_secs(300)));
        let resolver = DerivedRoleResolver::new(roles, cache);
        let role_id = format!("level_{}", depth - 1);

        group.throughput(Throughput::Elements(depth as u64));
        group.bench_with_input(BenchmarkId::from_parameter(depth), &depth, |b, _| {
            b.to_async(&rt).iter(|| {
                let role_id = role_id.clone();
                async move {
                    black_box(resolver.resolve_role_permissions(&role_id).await.unwrap())
                }
            });
        });
    }

    group.finish();
}

/// Benchmark scope matching
fn bench_scope_matching(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let scopes = create_test_scopes();

    let mut group = c.benchmark_group("scope_matching");

    // Benchmark without cache
    group.bench_function("no_cache", |b| {
        b.to_async(&rt).iter(|| async {
            let cache = Arc::new(ScopeCache::new(0, Duration::from_secs(300)));
            let resolver = ScopeResolver::new(scopes.clone(), cache);
            let scope = ScopePattern::new("org:acme/dept:engineering/team:backend");
            let resource = ResourcePath::new("/org/acme/dept/engineering/team/backend/project/auth");
            black_box(resolver.match_scope(&scope, &resource).await.unwrap())
        });
    });

    // Benchmark with cache (warm)
    group.bench_function("cache_warm", |b| {
        let cache = Arc::new(ScopeCache::new(1000, Duration::from_secs(300)));
        let resolver = ScopeResolver::new(scopes.clone(), cache);
        let scope = ScopePattern::new("org:acme/dept:engineering/team:backend");
        let resource = ResourcePath::new("/org/acme/dept/engineering/team/backend/project/auth");

        // Pre-warm cache
        rt.block_on(async {
            resolver.match_scope(&scope, &resource).await.unwrap();
        });

        b.to_async(&rt).iter(|| async {
            black_box(resolver.match_scope(&scope, &resource).await.unwrap())
        });
    });

    group.finish();
}

/// Benchmark concurrent role resolutions
fn bench_concurrent_resolutions(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let roles = create_test_roles();

    let mut group = c.benchmark_group("concurrent_resolutions");

    for concurrency in [1, 10, 50, 100] {
        let cache = Arc::new(RoleResolutionCache::new(1000, Duration::from_secs(300)));
        let resolver = Arc::new(DerivedRoleResolver::new(roles.clone(), cache));

        group.throughput(Throughput::Elements(concurrency as u64));
        group.bench_with_input(
            BenchmarkId::from_parameter(concurrency),
            &concurrency,
            |b, &concurrency| {
                b.to_async(&rt).iter(|| {
                    let resolver = resolver.clone();
                    async move {
                        let mut handles = Vec::new();
                        for i in 0..concurrency {
                            let resolver = resolver.clone();
                            let role_id = match i % 4 {
                                0 => "admin",
                                1 => "manager",
                                2 => "developer",
                                _ => "intern",
                            };
                            handles.push(tokio::spawn(async move {
                                resolver.resolve_role_permissions(role_id).await.unwrap()
                            }));
                        }
                        for handle in handles {
                            black_box(handle.await.unwrap());
                        }
                    }
                });
            },
        );
    }

    group.finish();
}

/// Benchmark cache eviction and replacement
fn bench_cache_eviction(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let roles = create_test_roles();

    let mut group = c.benchmark_group("cache_eviction");

    // Small cache that will trigger evictions
    let cache = Arc::new(RoleResolutionCache::new(2, Duration::from_secs(300)));
    let resolver = DerivedRoleResolver::new(roles.clone(), cache);

    group.bench_function("with_eviction", |b| {
        b.to_async(&rt).iter(|| async {
            // Access different roles to trigger evictions
            black_box(resolver.resolve_role_permissions("admin").await.unwrap());
            black_box(resolver.resolve_role_permissions("manager").await.unwrap());
            black_box(resolver.resolve_role_permissions("developer").await.unwrap());
            black_box(resolver.resolve_role_permissions("intern").await.unwrap());
        });
    });

    // Large cache with no evictions
    let large_cache = Arc::new(RoleResolutionCache::new(1000, Duration::from_secs(300)));
    let large_resolver = DerivedRoleResolver::new(roles, large_cache);

    group.bench_function("no_eviction", |b| {
        b.to_async(&rt).iter(|| async {
            black_box(large_resolver.resolve_role_permissions("admin").await.unwrap());
            black_box(large_resolver.resolve_role_permissions("manager").await.unwrap());
            black_box(large_resolver.resolve_role_permissions("developer").await.unwrap());
            black_box(large_resolver.resolve_role_permissions("intern").await.unwrap());
        });
    });

    group.finish();
}

/// Benchmark scope pattern complexity
fn bench_scope_pattern_complexity(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let mut group = c.benchmark_group("scope_pattern_complexity");

    let patterns = vec![
        ("simple", "org:acme"),
        ("medium", "org:acme/dept:engineering"),
        ("complex", "org:acme/dept:engineering/team:backend"),
        ("very_complex", "org:acme/dept:engineering/team:backend/project:auth"),
    ];

    for (name, pattern_str) in patterns {
        let scopes = vec![(
            ScopePattern::new(pattern_str),
            ResourcePath::new(pattern_str),
        )];
        let cache = Arc::new(ScopeCache::new(1000, Duration::from_secs(300)));
        let resolver = ScopeResolver::new(scopes, cache);
        let scope = ScopePattern::new(pattern_str);
        let resource = ResourcePath::new(pattern_str);

        group.bench_function(name, |b| {
            b.to_async(&rt).iter(|| async {
                black_box(resolver.match_scope(&scope, &resource).await.unwrap())
            });
        });
    }

    group.finish();
}

criterion_group!(
    benches,
    bench_role_resolution,
    bench_role_resolution_depth,
    bench_scope_matching,
    bench_concurrent_resolutions,
    bench_cache_eviction,
    bench_scope_pattern_complexity,
);
criterion_main!(benches);
