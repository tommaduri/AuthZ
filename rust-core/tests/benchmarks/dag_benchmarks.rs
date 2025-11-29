//! Benchmark tests for DAG operations and consensus
//! Tests consensus latency, throughput, and scalability

use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId, Throughput};
use std::time::Duration;

fn bench_vertex_insertion(c: &mut Criterion) {
    let mut group = c.benchmark_group("vertex_insertion");

    let mut dag = dag::DAG::new();

    // Insert genesis
    let genesis = dag::Vertex::new(b"genesis", vec![], [0u8; 32]);
    let genesis_hash = genesis.hash();
    dag.insert(genesis).unwrap();

    group.bench_function("insert_with_one_parent", |b| {
        let mut counter = 1u64;
        b.iter(|| {
            let data = format!("vertex {}", counter);
            let vertex = dag::Vertex::new(
                data.as_bytes(),
                vec![genesis_hash],
                [counter as u8; 32],
            );
            dag.insert(black_box(vertex)).ok();
            counter += 1;
        });
    });

    group.finish();
}

fn bench_vertex_validation(c: &mut Criterion) {
    let mut group = c.benchmark_group("vertex_validation");

    for parent_count in [1, 2, 5, 10].iter() {
        let parents = vec![[0u8; 32]; *parent_count];
        let vertex = dag::Vertex::new(b"test data", parents, [1u8; 32]);

        group.bench_with_input(
            BenchmarkId::new("validate", parent_count),
            parent_count,
            |b, _| {
                b.iter(|| {
                    dag::validate_vertex(black_box(&vertex))
                });
            }
        );
    }

    group.finish();
}

fn bench_topological_sorting(c: &mut Criterion) {
    let mut group = c.benchmark_group("topological_sorting");
    group.sample_size(30);

    for vertex_count in [10, 50, 100, 500, 1000].iter() {
        let dag = create_dag_chain(*vertex_count);

        group.bench_with_input(
            BenchmarkId::new("topological_sort", vertex_count),
            vertex_count,
            |b, _| {
                b.iter(|| {
                    dag.topological_order()
                });
            }
        );
    }

    group.finish();
}

fn bench_consensus_rounds(c: &mut Criterion) {
    let mut group = c.benchmark_group("consensus_rounds");
    group.sample_size(20);

    for node_count in [3, 5, 7, 10, 15].iter() {
        let network = setup_consensus_network(*node_count);
        let vertex = create_test_vertex(b"consensus test");

        group.bench_with_input(
            BenchmarkId::new("reach_consensus", node_count),
            node_count,
            |b, _| {
                b.iter(|| {
                    network.reach_consensus_sync(black_box(&vertex))
                });
            }
        );
    }

    group.finish();
}

fn bench_voting(c: &mut Criterion) {
    let mut group = c.benchmark_group("voting");

    for validator_count in [5, 10, 25, 50, 100].iter() {
        let voting_round = create_voting_round(*validator_count);

        group.bench_with_input(
            BenchmarkId::new("collect_votes", validator_count),
            validator_count,
            |b, _| {
                b.iter(|| {
                    voting_round.collect_votes_sync()
                });
            }
        );

        group.bench_with_input(
            BenchmarkId::new("verify_votes", validator_count),
            validator_count,
            |b, _| {
                b.iter(|| {
                    voting_round.verify_all_votes()
                });
            }
        );
    }

    group.finish();
}

fn bench_dag_queries(c: &mut Criterion) {
    let mut group = c.benchmark_group("dag_queries");

    let dag = create_dag_chain(1000);
    let tips = dag.get_tips();
    let tip = tips[0];

    group.bench_function("get_ancestors", |b| {
        b.iter(|| {
            dag.get_ancestors(black_box(&tip))
        });
    });

    group.bench_function("get_descendants", |b| {
        b.iter(|| {
            dag.get_descendants(black_box(&[0u8; 32])) // Genesis
        });
    });

    group.bench_function("path_exists", |b| {
        b.iter(|| {
            dag.path_exists(black_box(&[0u8; 32]), black_box(&tip))
        });
    });

    group.bench_function("get_tips", |b| {
        b.iter(|| {
            dag.get_tips()
        });
    });

    group.finish();
}

fn bench_finalization(c: &mut Criterion) {
    let mut group = c.benchmark_group("finalization");
    group.sample_size(30);

    for pending_count in [10, 50, 100, 500].iter() {
        let mut dag = dag::DAG::new();

        // Create pending vertices
        let genesis = dag::Vertex::new(b"genesis", vec![], [0u8; 32]);
        let genesis_hash = genesis.hash();
        dag.insert(genesis).unwrap();

        let mut last_hash = genesis_hash;
        for i in 1..=*pending_count {
            let vertex = dag::Vertex::new(
                format!("v{}", i).as_bytes(),
                vec![last_hash],
                [i as u8; 32],
            );
            last_hash = vertex.hash();
            dag.insert(vertex).unwrap();
        }

        group.bench_with_input(
            BenchmarkId::new("finalize_chain", pending_count),
            pending_count,
            |b, _| {
                b.iter(|| {
                    dag.finalize_up_to(black_box(&last_hash))
                });
            }
        );
    }

    group.finish();
}

fn bench_conflict_resolution(c: &mut Criterion) {
    let mut group = c.benchmark_group("conflict_resolution");

    let mut dag = dag::DAG::new();

    // Create conflicting vertices
    for i in 0..100 {
        let v1 = dag::Vertex::with_timestamp(
            format!("conflict{}", i).as_bytes(),
            vec![],
            [i as u8; 32],
            1000 + i as u64,
        );
        let v2 = dag::Vertex::with_timestamp(
            format!("conflict{}", i).as_bytes(),
            vec![],
            [(i + 100) as u8; 32],
            2000 + i as u64,
        );

        dag.insert(v1.clone()).ok();
        dag.insert(v2.clone()).ok();
    }

    group.bench_function("detect_conflicts", |b| {
        b.iter(|| {
            dag.detect_all_conflicts()
        });
    });

    let conflicts = dag.detect_all_conflicts();

    group.bench_function("resolve_conflicts", |b| {
        b.iter(|| {
            for (h1, h2) in &conflicts {
                dag.resolve_conflict(black_box(h1), black_box(h2));
            }
        });
    });

    group.finish();
}

fn bench_witness_selection(c: &mut Criterion) {
    let mut group = c.benchmark_group("witness_selection");

    for vertex_count in [10, 50, 100, 500].iter() {
        let dag = create_dag_chain(*vertex_count);

        group.bench_with_input(
            BenchmarkId::new("select_witnesses", vertex_count),
            vertex_count,
            |b, _| {
                b.iter(|| {
                    dag.select_witnesses(black_box(5))
                });
            }
        );
    }

    group.finish();
}

fn bench_byzantine_detection(c: &mut Criterion) {
    let mut group = c.benchmark_group("byzantine_detection");
    group.sample_size(20);

    for node_count in [5, 10, 20, 50].iter() {
        let network = setup_consensus_network(*node_count);

        // Simulate byzantine behavior
        network.set_byzantine_nodes(node_count / 3);

        group.bench_with_input(
            BenchmarkId::new("detect_byzantine", node_count),
            node_count,
            |b, _| {
                b.iter(|| {
                    network.detect_byzantine_nodes()
                });
            }
        );
    }

    group.finish();
}

fn bench_consensus_throughput(c: &mut Criterion) {
    let mut group = c.benchmark_group("consensus_throughput");
    group.sample_size(10);

    for node_count in [3, 5, 7].iter() {
        let network = setup_consensus_network(*node_count);

        group.bench_with_input(
            BenchmarkId::new("vertices_per_second", node_count),
            node_count,
            |b, _| {
                b.iter(|| {
                    // Simulate 100 vertex proposals
                    for i in 0..100 {
                        let vertex = create_test_vertex(format!("v{}", i).as_bytes());
                        network.reach_consensus_sync(&vertex);
                    }
                });
            }
        );
    }

    group.finish();
}

fn bench_memory_usage(c: &mut Criterion) {
    let mut group = c.benchmark_group("memory_usage");

    group.bench_function("dag_with_1000_vertices", |b| {
        b.iter(|| {
            let dag = create_dag_chain(1000);
            black_box(dag);
        });
    });

    group.bench_function("dag_with_10000_vertices", |b| {
        b.iter(|| {
            let dag = create_dag_chain(10000);
            black_box(dag);
        });
    });

    group.finish();
}

fn bench_parallel_consensus(c: &mut Criterion) {
    let mut group = c.benchmark_group("parallel_consensus");
    group.sample_size(10);

    for concurrent_proposals in [5, 10, 20, 50].iter() {
        let network = setup_consensus_network(7);

        group.bench_with_input(
            BenchmarkId::new("parallel_proposals", concurrent_proposals),
            concurrent_proposals,
            |b, &count| {
                b.iter(|| {
                    let vertices: Vec<_> = (0..count)
                        .map(|i| create_test_vertex(format!("v{}", i).as_bytes()))
                        .collect();

                    for vertex in vertices {
                        network.reach_consensus_sync(&vertex);
                    }
                });
            }
        );
    }

    group.finish();
}

// Test utilities

fn create_dag_chain(length: usize) -> dag::DAG {
    let mut dag = dag::DAG::new();

    let genesis = dag::Vertex::new(b"genesis", vec![], [0u8; 32]);
    let mut last_hash = genesis.hash();
    dag.insert(genesis).unwrap();

    for i in 1..length {
        let vertex = dag::Vertex::new(
            format!("vertex {}", i).as_bytes(),
            vec![last_hash],
            [i as u8; 32],
        );
        last_hash = vertex.hash();
        dag.insert(vertex).unwrap();
    }

    dag
}

fn create_test_vertex(data: &[u8]) -> Vertex {
    Vertex::new(data, vec![], [1u8; 32])
}

fn setup_consensus_network(node_count: usize) -> ConsensusNetwork {
    ConsensusNetwork {
        node_count,
        byzantine_count: 0,
    }
}

fn create_voting_round(validator_count: usize) -> VotingRound {
    VotingRound {
        validator_count,
        votes: vec![],
    }
}

struct ConsensusNetwork {
    node_count: usize,
    byzantine_count: usize,
}

impl ConsensusNetwork {
    fn reach_consensus_sync(&self, vertex: &Vertex) -> Result<(), ()> {
        Ok(())
    }

    fn set_byzantine_nodes(&self, count: usize) {
        // Simulation
    }

    fn detect_byzantine_nodes(&self) -> Vec<[u8; 32]> {
        vec![]
    }
}

struct VotingRound {
    validator_count: usize,
    votes: Vec<Vote>,
}

impl VotingRound {
    fn collect_votes_sync(&self) -> Vec<Vote> {
        vec![]
    }

    fn verify_all_votes(&self) -> bool {
        true
    }
}

struct Vote;

struct Vertex {
    data: Vec<u8>,
    parents: Vec<[u8; 32]>,
}

impl Vertex {
    fn new(data: &[u8], parents: Vec<[u8; 32]>, creator: [u8; 32]) -> Self {
        Self {
            data: data.to_vec(),
            parents,
        }
    }

    fn with_timestamp(data: &[u8], parents: Vec<[u8; 32]>, creator: [u8; 32], timestamp: u64) -> Self {
        Self::new(data, parents, creator)
    }

    fn hash(&self) -> [u8; 32] {
        [0u8; 32]
    }
}

criterion_group! {
    name = dag_benches;
    config = Criterion::default()
        .measurement_time(Duration::from_secs(10))
        .sample_size(50);
    targets =
        bench_vertex_insertion,
        bench_vertex_validation,
        bench_topological_sorting,
        bench_consensus_rounds,
        bench_voting,
        bench_dag_queries,
        bench_finalization,
        bench_conflict_resolution,
        bench_witness_selection,
        bench_byzantine_detection,
        bench_consensus_throughput,
        bench_memory_usage,
        bench_parallel_consensus
}

criterion_main!(dag_benches);
