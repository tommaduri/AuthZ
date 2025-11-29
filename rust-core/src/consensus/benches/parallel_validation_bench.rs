//! Parallel vertex validation performance benchmarks
//!
//! Tests the parallel validation system against the target of 10,000+ TPS

use cretoai_consensus::{BftConfig, BftEngine};
use cretoai_crypto::signatures::{ML_DSA_87, SignatureScheme};
use cretoai_dag::types::Vertex;
use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};

fn generate_keypair() -> (Vec<u8>, Vec<u8>) {
    let scheme = ML_DSA_87::new();
    scheme.generate_keypair().unwrap()
}

fn create_test_vertices(count: usize) -> Vec<Vertex> {
    (0..count)
        .map(|i| {
            let id = format!("vertex-{}", i);
            let payload = format!("benchmark-payload-{}", i).into_bytes();
            Vertex::new(id, vec![], payload, "benchmark".to_string())
        })
        .collect()
}

/// Benchmark single-threaded vertex validation (baseline)
fn bench_single_threaded_validation(c: &mut Criterion) {
    let mut group = c.benchmark_group("single_threaded_validation");

    for size in [100, 1000, 10000].iter() {
        group.throughput(Throughput::Elements(*size as u64));
        group.bench_with_input(BenchmarkId::from_parameter(size), size, |b, &size| {
            let config = BftConfig::default();
            let (private_key, public_key) = generate_keypair();
            let engine = BftEngine::new(config, private_key, public_key).unwrap();
            let vertices = create_test_vertices(size);

            b.iter(|| {
                let _results: Vec<_> = vertices
                    .iter()
                    .map(|v| engine.validate_vertex(v))
                    .collect();
            });
        });
    }

    group.finish();
}

/// Benchmark parallel vertex validation
fn bench_parallel_validation(c: &mut Criterion) {
    let mut group = c.benchmark_group("parallel_validation");

    for size in [100, 1000, 10000].iter() {
        group.throughput(Throughput::Elements(*size as u64));
        group.bench_with_input(BenchmarkId::from_parameter(size), size, |b, &size| {
            let config = BftConfig::default();
            let (private_key, public_key) = generate_keypair();
            let engine = BftEngine::new(config, private_key, public_key).unwrap();
            let vertices = create_test_vertices(size);

            b.iter(|| {
                let results = engine.validate_vertices_parallel(vertices.clone());
                black_box(results);
            });
        });
    }

    group.finish();
}

/// Benchmark different batch sizes
fn bench_batch_sizes(c: &mut Criterion) {
    let mut group = c.benchmark_group("batch_size_comparison");
    let vertex_count = 10000;
    group.throughput(Throughput::Elements(vertex_count as u64));

    for batch_size in [10, 100, 1000].iter() {
        group.bench_with_input(
            BenchmarkId::from_parameter(format!("batch_{}", batch_size)),
            batch_size,
            |b, &batch_size| {
                let mut config = BftConfig::default();
                config.parallel_config.batch_size = batch_size;

                let (private_key, public_key) = generate_keypair();
                let engine = BftEngine::new(config, private_key, public_key).unwrap();
                let vertices = create_test_vertices(vertex_count);

                b.iter(|| {
                    let results = engine.validate_vertices_parallel(vertices.clone());
                    black_box(results);
                });
            },
        );
    }

    group.finish();
}

/// Benchmark different thread counts
fn bench_thread_counts(c: &mut Criterion) {
    let mut group = c.benchmark_group("thread_count_comparison");
    let vertex_count = 10000;
    group.throughput(Throughput::Elements(vertex_count as u64));

    for thread_count in [1, 2, 4, 8, 16].iter() {
        group.bench_with_input(
            BenchmarkId::from_parameter(format!("{}_threads", thread_count)),
            thread_count,
            |b, &thread_count| {
                let mut config = BftConfig::default();
                config.parallel_config.worker_threads = Some(thread_count);

                let (private_key, public_key) = generate_keypair();
                let engine = BftEngine::new(config, private_key, public_key).unwrap();
                let vertices = create_test_vertices(vertex_count);

                b.iter(|| {
                    let results = engine.validate_vertices_parallel(vertices.clone());
                    black_box(results);
                });
            },
        );
    }

    group.finish();
}

/// Benchmark adaptive batching
fn bench_adaptive_validation(c: &mut Criterion) {
    let mut group = c.benchmark_group("adaptive_validation");

    for size in [100, 1000, 10000].iter() {
        group.throughput(Throughput::Elements(*size as u64));
        group.bench_with_input(BenchmarkId::from_parameter(size), size, |b, &size| {
            let config = BftConfig::default();
            let (private_key, public_key) = generate_keypair();
            let engine = BftEngine::new(config, private_key, public_key).unwrap();
            let vertices = create_test_vertices(size);

            b.iter(|| {
                let results = engine.validate_vertices_adaptive(vertices.clone());
                black_box(results);
            });
        });
    }

    group.finish();
}

/// End-to-end TPS benchmark
fn bench_tps_target(c: &mut Criterion) {
    let mut group = c.benchmark_group("tps_target");
    group.sample_size(10); // Fewer samples for large benchmarks

    // Test against 10,000 TPS target
    let vertex_count = 10000;
    group.throughput(Throughput::Elements(vertex_count as u64));

    group.bench_function("10k_vertices_parallel", |b| {
        let config = BftConfig::default();
        let (private_key, public_key) = generate_keypair();
        let engine = BftEngine::new(config, private_key, public_key).unwrap();
        let vertices = create_test_vertices(vertex_count);

        b.iter(|| {
            let results = engine.validate_vertices_parallel(vertices.clone());
            black_box(results);
        });
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_single_threaded_validation,
    bench_parallel_validation,
    bench_batch_sizes,
    bench_thread_counts,
    bench_adaptive_validation,
    bench_tps_target
);
criterion_main!(benches);
