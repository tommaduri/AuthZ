use authz::{ScopeResolver, ScopeConfig};
use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};

fn bench_build_scope_chain(c: &mut Criterion) {
    let resolver = ScopeResolver::new(ScopeConfig::default());
    let scopes = vec![
        "org",
        "org.acme",
        "org.acme.dept",
        "org.acme.dept.engineering",
        "org.acme.dept.engineering.team",
    ];

    let mut group = c.benchmark_group("build_scope_chain");
    for scope in scopes {
        group.bench_with_input(
            BenchmarkId::from_parameter(scope),
            &scope,
            |b, &scope| {
                b.iter(|| {
                    resolver.build_scope_chain(black_box(scope)).unwrap()
                });
            },
        );
    }
    group.finish();
}

fn bench_build_scope_chain_cached(c: &mut Criterion) {
    let resolver = ScopeResolver::new(ScopeConfig::default());
    let scope = "org.acme.dept.engineering.team";

    // Warm up cache
    resolver.build_scope_chain(scope).unwrap();

    c.bench_function("build_scope_chain_cached", |b| {
        b.iter(|| {
            resolver.build_scope_chain(black_box(scope)).unwrap()
        });
    });
}

fn bench_match_scope(c: &mut Criterion) {
    let resolver = ScopeResolver::new(ScopeConfig::default());

    let mut group = c.benchmark_group("match_scope");

    group.bench_function("exact", |b| {
        b.iter(|| {
            resolver.match_scope(black_box("org.acme"), black_box("org.acme"))
        });
    });

    group.bench_function("single_wildcard", |b| {
        b.iter(|| {
            resolver.match_scope(black_box("org.*"), black_box("org.acme"))
        });
    });

    group.bench_function("double_wildcard", |b| {
        b.iter(|| {
            resolver.match_scope(black_box("org.**"), black_box("org.acme.dept.engineering"))
        });
    });

    group.finish();
}

fn bench_validate_scope(c: &mut Criterion) {
    let resolver = ScopeResolver::new(ScopeConfig::default());
    let scopes = vec![
        "org",
        "org.acme",
        "org.acme.dept",
        "org.acme.dept.engineering",
    ];

    let mut group = c.benchmark_group("validate_scope");
    for scope in scopes {
        group.bench_with_input(
            BenchmarkId::from_parameter(scope),
            &scope,
            |b, &scope| {
                b.iter(|| {
                    resolver.validate_scope(black_box(scope)).unwrap()
                });
            },
        );
    }
    group.finish();
}

fn bench_concurrent_build(c: &mut Criterion) {
    use std::sync::Arc;

    let resolver = Arc::new(ScopeResolver::new(ScopeConfig::default()));
    let scopes = vec![
        "org.acme",
        "org.acme.dept",
        "org.beta",
        "org.beta.sales",
    ];

    c.bench_function("concurrent_build_scope_chain", |b| {
        b.iter(|| {
            let resolver = Arc::clone(&resolver);
            let scope = scopes[0];
            std::thread::scope(|s| {
                for _ in 0..4 {
                    let resolver = Arc::clone(&resolver);
                    s.spawn(move || {
                        resolver.build_scope_chain(black_box(scope)).unwrap();
                    });
                }
            });
        });
    });
}

criterion_group!(
    benches,
    bench_build_scope_chain,
    bench_build_scope_chain_cached,
    bench_match_scope,
    bench_validate_scope,
    bench_concurrent_build
);
criterion_main!(benches);
