/// Benchmarks for scope resolver module
///
/// Measures performance of:
/// - Scope parsing
/// - Pattern matching
/// - Chain building
/// - Cache performance
/// - Concurrent access

use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use cretoai_authz::scope::{Scope, ScopeResolver};
use std::sync::Arc;
use std::thread;

fn bench_scope_parsing(c: &mut Criterion) {
    let mut group = c.benchmark_group("scope_parsing");

    let test_cases = vec![
        ("simple", "org:acme"),
        ("medium", "org:acme:dept:engineering"),
        ("deep", "a:b:c:d:e:f:g:h:i:j"),
    ];

    for (name, scope_str) in test_cases {
        group.bench_with_input(BenchmarkId::from_parameter(name), &scope_str, |b, &s| {
            b.iter(|| {
                Scope::new(black_box(s)).unwrap()
            });
        });
    }

    group.finish();
}

fn bench_pattern_matching(c: &mut Criterion) {
    let mut group = c.benchmark_group("pattern_matching");

    let scope = Scope::new("org:acme:dept:engineering").unwrap();

    group.bench_function("exact_match", |b| {
        b.iter(|| {
            scope.matches(black_box("org:acme:dept:engineering")).unwrap()
        });
    });

    group.bench_function("single_wildcard", |b| {
        b.iter(|| {
            scope.matches(black_box("org:acme:dept:*")).unwrap()
        });
    });

    group.bench_function("double_wildcard", |b| {
        b.iter(|| {
            scope.matches(black_box("org:**")).unwrap()
        });
    });

    group.bench_function("complex_pattern", |b| {
        b.iter(|| {
            scope.matches(black_box("org:*:*:engineering")).unwrap()
        });
    });

    group.finish();
}

fn bench_chain_building(c: &mut Criterion) {
    let mut group = c.benchmark_group("chain_building");

    let resolver = ScopeResolver::new();

    let test_cases = vec![
        ("depth_2", "org:acme"),
        ("depth_4", "org:acme:dept:engineering"),
        ("depth_8", "a:b:c:d:e:f:g:h"),
        ("depth_16", "a:b:c:d:e:f:g:h:i:j:k:l:m:n:o:p"),
    ];

    for (name, scope_str) in test_cases {
        let scope = Scope::new(scope_str).unwrap();
        group.bench_with_input(BenchmarkId::from_parameter(name), &scope, |b, s| {
            b.iter(|| {
                resolver.build_chain(black_box(s))
            });
        });
    }

    group.finish();
}

fn bench_cache_performance(c: &mut Criterion) {
    let mut group = c.benchmark_group("cache_performance");

    let resolver = ScopeResolver::new();
    let scope = Scope::new("org:acme:dept:engineering").unwrap();

    // Prime the cache
    resolver.build_chain(&scope);
    resolver.matches_pattern(&scope, "org:acme:*").unwrap();

    group.bench_function("chain_cache_hit", |b| {
        b.iter(|| {
            resolver.build_chain(black_box(&scope))
        });
    });

    group.bench_function("pattern_cache_hit", |b| {
        b.iter(|| {
            resolver.matches_pattern(black_box(&scope), black_box("org:acme:*")).unwrap()
        });
    });

    group.bench_function("chain_cache_miss", |b| {
        let mut counter = 0;
        b.iter(|| {
            let s = Scope::new(&format!("org:acme:dept{}", counter)).unwrap();
            counter += 1;
            resolver.build_chain(black_box(&s))
        });
    });

    group.finish();
}

fn bench_bulk_operations(c: &mut Criterion) {
    let mut group = c.benchmark_group("bulk_operations");

    let resolver = ScopeResolver::new();
    let scopes = vec![
        Scope::new("org:acme:dept:engineering").unwrap(),
        Scope::new("org:acme:dept:sales").unwrap(),
        Scope::new("org:acme:dept:marketing").unwrap(),
        Scope::new("org:other:dept:engineering").unwrap(),
        Scope::new("different:acme:dept").unwrap(),
    ];

    group.bench_function("matches_any", |b| {
        let patterns = vec!["org:acme:*", "org:other:*", "different:**"];
        b.iter(|| {
            for scope in &scopes {
                resolver.matches_any(black_box(scope), black_box(&patterns)).unwrap();
            }
        });
    });

    group.bench_function("matches_all", |b| {
        let patterns = vec!["org:*:dept:*", "org:**"];
        b.iter(|| {
            for scope in &scopes {
                resolver.matches_all(black_box(scope), black_box(&patterns)).unwrap();
            }
        });
    });

    group.bench_function("filter_matching", |b| {
        b.iter(|| {
            resolver.filter_matching(black_box(&scopes), black_box("org:acme:*")).unwrap()
        });
    });

    group.finish();
}

fn bench_concurrent_access(c: &mut Criterion) {
    let mut group = c.benchmark_group("concurrent_access");

    group.bench_function("parallel_chain_building", |b| {
        let resolver = Arc::new(ScopeResolver::new());
        b.iter(|| {
            let mut handles = vec![];
            for i in 0..4 {
                let resolver = Arc::clone(&resolver);
                let handle = thread::spawn(move || {
                    let scope = Scope::new(&format!("org:acme:dept{}", i)).unwrap();
                    resolver.build_chain(&scope);
                });
                handles.push(handle);
            }
            for handle in handles {
                handle.join().unwrap();
            }
        });
    });

    group.bench_function("parallel_pattern_matching", |b| {
        let resolver = Arc::new(ScopeResolver::new());
        let scopes: Vec<_> = (0..4)
            .map(|i| Scope::new(&format!("org:acme:dept{}", i)).unwrap())
            .collect();

        b.iter(|| {
            let mut handles = vec![];
            for scope in &scopes {
                let resolver = Arc::clone(&resolver);
                let scope = scope.clone();
                let handle = thread::spawn(move || {
                    resolver.matches_pattern(&scope, "org:acme:*").unwrap()
                });
                handles.push(handle);
            }
            for handle in handles {
                handle.join().unwrap();
            }
        });
    });

    group.finish();
}

fn bench_hierarchical_operations(c: &mut Criterion) {
    let mut group = c.benchmark_group("hierarchical_operations");

    let scope = Scope::new("org:acme:dept:engineering:team1").unwrap();

    group.bench_function("parent_extraction", |b| {
        b.iter(|| {
            let mut current = Some(black_box(&scope).clone());
            while let Some(s) = current {
                current = s.parent();
            }
        });
    });

    group.bench_function("is_parent_of", |b| {
        let child = Scope::new("org:acme:dept:engineering:team1:member1").unwrap();
        b.iter(|| {
            scope.is_parent_of(black_box(&child))
        });
    });

    group.bench_function("is_child_of", |b| {
        let parent = Scope::new("org:acme").unwrap();
        b.iter(|| {
            scope.is_child_of(black_box(&parent))
        });
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_scope_parsing,
    bench_pattern_matching,
    bench_chain_building,
    bench_cache_performance,
    bench_bulk_operations,
    bench_concurrent_access,
    bench_hierarchical_operations,
);

criterion_main!(benches);
