use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId, Throughput};
use cretoai_dag::vertex::{Vertex, VertexBuilder};
use cretoai_dag::graph::Graph;
use cretoai_dag::consensus::{ConsensusEngine, ConsensusParams};
use cretoai_dag::pruning::{PruningManager, PruningConfig};
use cretoai_dag::storage::Storage;
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;

// ============================================================================
// Vertex Benchmarks
// ============================================================================

fn bench_vertex_creation(c: &mut Criterion) {
    let mut group = c.benchmark_group("vertex_creation");

    group.bench_function("genesis", |b| {
        b.iter(|| {
            let vertex = VertexBuilder::new("agent-001".to_string())
                .id("genesis".to_string())
                .build();
            black_box(vertex);
        });
    });

    group.bench_function("with_parents", |b| {
        b.iter(|| {
            let vertex = VertexBuilder::new("agent-001".to_string())
                .parent("parent-1".to_string())
                .parent("parent-2".to_string())
                .payload(vec![1, 2, 3, 4, 5])
                .build();
            black_box(vertex);
        });
    });

    group.bench_function("with_large_payload", |b| {
        let payload = vec![0u8; 1024 * 10]; // 10KB
        b.iter(|| {
            let vertex = VertexBuilder::new("agent-001".to_string())
                .payload(payload.clone())
                .build();
            black_box(vertex);
        });
    });

    group.finish();
}

fn bench_vertex_hash(c: &mut Criterion) {
    let mut group = c.benchmark_group("vertex_hash");

    for payload_size in [100, 1024, 10240].iter() {
        group.throughput(Throughput::Bytes(*payload_size as u64));
        group.bench_with_input(
            BenchmarkId::new("compute_hash", payload_size),
            payload_size,
            |b, &size| {
                let payload = vec![0u8; size];
                b.iter(|| {
                    let hash = Vertex::compute_hash(
                        "test-vertex",
                        &["parent-1".to_string()],
                        &payload,
                        1234567890,
                    );
                    black_box(hash);
                });
            },
        );
    }

    group.finish();
}

// ============================================================================
// Graph Benchmarks
// ============================================================================

fn bench_graph_add_vertex(c: &mut Criterion) {
    let mut group = c.benchmark_group("graph_add_vertex");

    for vertex_count in [100, 500, 1000].iter() {
        group.bench_with_input(
            BenchmarkId::from_parameter(vertex_count),
            vertex_count,
            |b, &count| {
                b.iter(|| {
                    let graph = Graph::new();
                    for i in 0..count {
                        let vertex = VertexBuilder::new("agent-001".to_string())
                            .id(format!("vertex-{}", i))
                            .build();
                        graph.add_vertex(vertex).unwrap();
                    }
                    black_box(graph);
                });
            },
        );
    }

    group.finish();
}

fn bench_graph_queries(c: &mut Criterion) {
    let mut group = c.benchmark_group("graph_queries");

    // Setup: Create a graph with 1000 vertices
    let graph = Arc::new(Graph::new());

    // Add genesis
    let genesis = VertexBuilder::new("agent-001".to_string())
        .id("genesis".to_string())
        .build();
    graph.add_vertex(genesis).unwrap();

    // Add vertices in a chain
    for i in 1..1000 {
        let parent = if i == 1 {
            "genesis".to_string()
        } else {
            format!("vertex-{}", i - 1)
        };

        let vertex = VertexBuilder::new("agent-001".to_string())
            .id(format!("vertex-{}", i))
            .parent(parent)
            .build();
        graph.add_vertex(vertex).unwrap();
    }

    group.bench_function("get_vertex", |b| {
        b.iter(|| {
            let vertex = graph.get_vertex(&"vertex-500".to_string()).unwrap();
            black_box(vertex);
        });
    });

    group.bench_function("get_children", |b| {
        b.iter(|| {
            let children = graph.get_children(&"vertex-500".to_string()).unwrap();
            black_box(children);
        });
    });

    group.bench_function("get_parents", |b| {
        b.iter(|| {
            let parents = graph.get_parents(&"vertex-500".to_string()).unwrap();
            black_box(parents);
        });
    });

    group.bench_function("get_ancestors", |b| {
        b.iter(|| {
            let ancestors = graph.get_ancestors(&"vertex-500".to_string()).unwrap();
            black_box(ancestors);
        });
    });

    group.bench_function("topological_sort", |b| {
        b.iter(|| {
            let sorted = graph.topological_sort().unwrap();
            black_box(sorted);
        });
    });

    group.finish();
}

// ============================================================================
// Consensus Benchmarks
// ============================================================================

fn bench_consensus_engine(c: &mut Criterion) {
    let mut group = c.benchmark_group("consensus_engine");
    group.measurement_time(Duration::from_secs(10));

    // Fast consensus parameters for benchmarking
    let params = ConsensusParams {
        sample_size: 30,
        alpha_threshold: 24,
        beta_threshold: 3, // Fast finalization
        finalization_threshold: 0.7,
        max_rounds: 50,
        min_network_size: 100,
    };

    group.bench_function("single_vertex", |b| {
        b.iter(|| {
            let graph = Arc::new(Graph::new());
            let engine = ConsensusEngine::with_params(
                graph.clone(),
                "bench-agent".to_string(),
                params.clone(),
            );

            // Register 150 nodes
            for i in 0..150 {
                engine.register_node(format!("node-{}", i)).unwrap();
            }

            // Add vertex
            let vertex = VertexBuilder::new("agent-001".to_string())
                .id("bench-vertex".to_string())
                .build();
            graph.add_vertex(vertex).unwrap();

            // Run consensus
            engine.run_consensus(&"bench-vertex".to_string()).unwrap();
            black_box(engine);
        });
    });

    group.bench_function("batch_10_vertices", |b| {
        b.iter(|| {
            let graph = Arc::new(Graph::new());
            let engine = ConsensusEngine::with_params(
                graph.clone(),
                "bench-agent".to_string(),
                params.clone(),
            );

            for i in 0..150 {
                engine.register_node(format!("node-{}", i)).unwrap();
            }

            // Add 10 vertices
            let mut vertex_ids = Vec::new();
            for i in 0..10 {
                let vertex = VertexBuilder::new("agent-001".to_string())
                    .id(format!("vertex-{}", i))
                    .build();
                vertex_ids.push(vertex.id.clone());
                graph.add_vertex(vertex).unwrap();
            }

            // Batch consensus
            let finalized = engine.batch_consensus(&vertex_ids).unwrap();
            black_box(finalized);
        });
    });

    group.finish();
}

fn bench_consensus_rounds(c: &mut Criterion) {
    let mut group = c.benchmark_group("consensus_rounds");

    let graph = Arc::new(Graph::new());
    // Use faster params for benchmarking - single round won't finalize with strict params
    let params = ConsensusParams {
        sample_size: 30,
        alpha_threshold: 24,
        beta_threshold: 3,           // Lower for benchmarking
        finalization_threshold: 0.7,  // Lower for benchmarking
        max_rounds: 50,
        min_network_size: 100,
    };
    let engine = ConsensusEngine::with_params(
        graph.clone(),
        "bench-agent".to_string(),
        params,
    );

    for i in 0..150 {
        engine.register_node(format!("node-{}", i)).unwrap();
    }

    let vertex = VertexBuilder::new("agent-001".to_string())
        .id("round-test".to_string())
        .build();
    graph.add_vertex(vertex).unwrap();

    group.bench_function("single_round", |b| {
        b.iter(|| {
            engine.init_vertex(&"round-test".to_string()).unwrap();
            let finalized = engine.consensus_round(&"round-test".to_string()).unwrap();
            black_box(finalized);
        });
    });

    group.finish();
}

// ============================================================================
// Pruning Benchmarks
// ============================================================================

fn bench_pruning_operations(c: &mut Criterion) {
    let mut group = c.benchmark_group("pruning_operations");

    for vertex_count in [100, 500, 1000].iter() {
        group.bench_with_input(
            BenchmarkId::new("identify_pruneable", vertex_count),
            vertex_count,
            |b, &count| {
                let graph = Arc::new(Graph::new());
                let config = PruningConfig {
                    min_retention_period: Duration::ZERO,
                    ..Default::default()
                };
                let manager = PruningManager::with_config(graph.clone(), config);

                // Add genesis
                let genesis = VertexBuilder::new("agent-001".to_string())
                    .id("genesis".to_string())
                    .build();
                graph.add_vertex(genesis).unwrap();

                // Add finalized vertices
                for i in 0..count {
                    let mut vertex = VertexBuilder::new("agent-001".to_string())
                        .id(format!("vertex-{}", i))
                        .parent("genesis".to_string())
                        .build();
                    vertex.finalize();
                    graph.add_vertex(vertex).unwrap();
                }

                b.iter(|| {
                    let pruneable = manager.get_pruneable_vertices().unwrap();
                    black_box(pruneable);
                });
            },
        );
    }

    group.finish();
}

// ============================================================================
// Storage Benchmarks
// ============================================================================

fn bench_storage_operations(c: &mut Criterion) {
    let mut group = c.benchmark_group("storage_operations");

    group.bench_function("put_vertex", |b| {
        let temp_dir = TempDir::new().unwrap();
        let storage = Storage::open(temp_dir.path()).unwrap();

        b.iter(|| {
            let vertex = VertexBuilder::new("agent-001".to_string())
                .id(uuid::Uuid::new_v4().to_string())
                .build();
            storage.put_vertex(&vertex).unwrap();
            black_box(&storage);
        });
    });

    group.bench_function("get_vertex_cold", |b| {
        let temp_dir = TempDir::new().unwrap();
        let storage = Storage::open(temp_dir.path()).unwrap();

        // Add vertex
        let vertex = VertexBuilder::new("agent-001".to_string())
            .id("test-vertex".to_string())
            .build();
        storage.put_vertex(&vertex).unwrap();

        b.iter(|| {
            storage.clear_cache();
            let retrieved = storage.get_vertex(&"test-vertex".to_string()).unwrap();
            black_box(retrieved);
        });
    });

    group.bench_function("get_vertex_cached", |b| {
        let temp_dir = TempDir::new().unwrap();
        let storage = Storage::open(temp_dir.path()).unwrap();

        let vertex = VertexBuilder::new("agent-001".to_string())
            .id("cached-vertex".to_string())
            .build();
        storage.put_vertex(&vertex).unwrap();

        b.iter(|| {
            let retrieved = storage.get_vertex(&"cached-vertex".to_string()).unwrap();
            black_box(retrieved);
        });
    });

    group.bench_function("batch_put_100", |b| {
        let temp_dir = TempDir::new().unwrap();
        let storage = Storage::open(temp_dir.path()).unwrap();

        b.iter(|| {
            let vertices: Vec<_> = (0..100)
                .map(|i| {
                    VertexBuilder::new("agent-001".to_string())
                        .id(format!("batch-{}", i))
                        .build()
                })
                .collect();

            storage.put_batch(&vertices).unwrap();
            black_box(&storage);
        });
    });

    group.finish();
}

fn bench_storage_throughput(c: &mut Criterion) {
    let mut group = c.benchmark_group("storage_throughput");
    group.throughput(Throughput::Elements(1000));

    group.bench_function("sequential_writes_1000", |b| {
        b.iter(|| {
            let temp_dir = TempDir::new().unwrap();
            let storage = Storage::open(temp_dir.path()).unwrap();

            for i in 0..1000 {
                let vertex = VertexBuilder::new("agent-001".to_string())
                    .id(format!("vertex-{}", i))
                    .build();
                storage.put_vertex(&vertex).unwrap();
            }

            black_box(storage);
        });
    });

    group.bench_function("batch_writes_1000", |b| {
        b.iter(|| {
            let temp_dir = TempDir::new().unwrap();
            let storage = Storage::open(temp_dir.path()).unwrap();

            let vertices: Vec<_> = (0..1000)
                .map(|i| {
                    VertexBuilder::new("agent-001".to_string())
                        .id(format!("vertex-{}", i))
                        .build()
                })
                .collect();

            storage.put_batch(&vertices).unwrap();
            black_box(storage);
        });
    });

    group.finish();
}

// ============================================================================
// Benchmark Groups
// ============================================================================

criterion_group!(
    vertex_benches,
    bench_vertex_creation,
    bench_vertex_hash
);

criterion_group!(
    graph_benches,
    bench_graph_add_vertex,
    bench_graph_queries
);

criterion_group!(
    consensus_benches,
    bench_consensus_engine,
    bench_consensus_rounds
);

criterion_group!(
    pruning_benches,
    bench_pruning_operations
);

criterion_group!(
    storage_benches,
    bench_storage_operations,
    bench_storage_throughput
);

criterion_main!(
    vertex_benches,
    graph_benches,
    consensus_benches,
    pruning_benches,
    storage_benches
);
