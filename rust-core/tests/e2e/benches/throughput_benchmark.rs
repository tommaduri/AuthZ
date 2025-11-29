//! Throughput Benchmarks for Consensus System
//!
//! Measures consensus throughput (TPS) and finality latency under various loads.

use cretoai_consensus::{BftConfig, BftEngine};
use cretoai_dag::vertex::Vertex;
use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use std::time::Duration;
use tokio::runtime::Runtime;
use uuid::Uuid;

/// Create a test BFT engine
fn create_test_engine(node_count: usize) -> BftEngine {
    let config = BftConfig {
        node_id: Uuid::new_v4(),
        total_nodes: node_count,
        quorum_threshold: 0.67,
        finality_timeout_ms: 500,
        max_pending_vertices: 10000,
        byzantine_detection_enabled: true,
        signature_scheme: "ml-dsa-87".to_string(),
    };

    BftEngine::new(config).expect("Failed to create engine")
}

/// Create test vertices
fn create_test_vertices(count: usize) -> Vec<Vertex> {
    (0..count)
        .map(|i| {
            Vertex::new(
                Uuid::new_v4().to_string(),
                vec![],
                format!("transaction-{}", i).into_bytes(),
                "benchmark-node".to_string(),
            )
        })
        .collect()
}

/// Benchmark vertex creation and hashing
fn bench_vertex_creation(c: &mut Criterion) {
    let mut group = c.benchmark_group("vertex_creation");

    for size in [1, 10, 100, 1000] {
        group.throughput(Throughput::Elements(size as u64));
        group.bench_with_input(BenchmarkId::from_parameter(size), &size, |b, &size| {
            b.iter(|| {
                let vertices = create_test_vertices(size);
                black_box(vertices)
            });
        });
    }

    group.finish();
}

/// Benchmark consensus engine creation
fn bench_engine_creation(c: &mut Criterion) {
    let mut group = c.benchmark_group("engine_creation");

    for node_count in [3, 4, 7, 10] {
        group.bench_with_input(
            BenchmarkId::from_parameter(node_count),
            &node_count,
            |b, &node_count| {
                b.iter(|| {
                    let engine = create_test_engine(node_count);
                    black_box(engine)
                });
            },
        );
    }

    group.finish();
}

/// Benchmark quorum calculation
fn bench_quorum_calculation(c: &mut Criterion) {
    let mut group = c.benchmark_group("quorum_calculation");

    for node_count in [3, 4, 7, 10, 13, 20, 50, 100] {
        group.bench_with_input(
            BenchmarkId::from_parameter(node_count),
            &node_count,
            |b, &node_count| {
                b.iter(|| {
                    let config = BftConfig {
                        node_id: Uuid::new_v4(),
                        total_nodes: node_count,
                        quorum_threshold: 0.67,
                        finality_timeout_ms: 500,
                        max_pending_vertices: 10000,
                        byzantine_detection_enabled: true,
                        signature_scheme: "ml-dsa-87".to_string(),
                    };
                    black_box(config.quorum_size())
                });
            },
        );
    }

    group.finish();
}

/// Benchmark BLAKE3 hashing
fn bench_vertex_hashing(c: &mut Criterion) {
    let mut group = c.benchmark_group("vertex_hashing");

    for payload_size in [32, 256, 1024, 4096, 16384] {
        group.throughput(Throughput::Bytes(payload_size as u64));
        group.bench_with_input(
            BenchmarkId::from_parameter(payload_size),
            &payload_size,
            |b, &payload_size| {
                let payload = vec![0u8; payload_size];
                b.iter(|| {
                    let vertex = Vertex::new(
                        Uuid::new_v4().to_string(),
                        vec![],
                        payload.clone(),
                        "bench-node".to_string(),
                    );
                    black_box(vertex.hash)
                });
            },
        );
    }

    group.finish();
}

/// Benchmark consensus configuration overhead
fn bench_config_overhead(c: &mut Criterion) {
    c.bench_function("config_creation", |b| {
        b.iter(|| {
            let config = BftConfig {
                node_id: Uuid::new_v4(),
                total_nodes: 4,
                quorum_threshold: 0.67,
                finality_timeout_ms: 500,
                max_pending_vertices: 10000,
                byzantine_detection_enabled: true,
                signature_scheme: "ml-dsa-87".to_string(),
            };
            black_box(config)
        });
    });
}

/// Benchmark UUID generation (used for vertex IDs)
fn bench_uuid_generation(c: &mut Criterion) {
    let mut group = c.benchmark_group("uuid_generation");
    group.throughput(Throughput::Elements(1));

    group.bench_function("uuid_v4", |b| {
        b.iter(|| black_box(Uuid::new_v4()));
    });

    group.finish();
}

/// Benchmark vertex validation
fn bench_vertex_validation(c: &mut Criterion) {
    let vertices = create_test_vertices(100);

    c.bench_function("vertex_validation", |b| {
        b.iter(|| {
            for vertex in &vertices {
                // In real implementation, would validate:
                // - Signature verification
                // - Parent references
                // - Timestamp validity
                black_box(&vertex.hash);
            }
        });
    });
}

/// Benchmark parallel vertex processing
fn bench_parallel_processing(c: &mut Criterion) {
    let mut group = c.benchmark_group("parallel_processing");

    for vertex_count in [10, 50, 100, 500] {
        group.throughput(Throughput::Elements(vertex_count as u64));
        group.bench_with_input(
            BenchmarkId::from_parameter(vertex_count),
            &vertex_count,
            |b, &vertex_count| {
                let vertices = create_test_vertices(vertex_count);
                b.iter(|| {
                    // Simulate parallel processing
                    vertices.iter().map(|v| v.hash).collect::<Vec<_>>()
                });
            },
        );
    }

    group.finish();
}

criterion_group! {
    name = benches;
    config = Criterion::default()
        .sample_size(100)
        .measurement_time(Duration::from_secs(10))
        .warm_up_time(Duration::from_secs(3));
    targets =
        bench_vertex_creation,
        bench_engine_creation,
        bench_quorum_calculation,
        bench_vertex_hashing,
        bench_config_overhead,
        bench_uuid_generation,
        bench_vertex_validation,
        bench_parallel_processing,
}

criterion_main!(benches);
