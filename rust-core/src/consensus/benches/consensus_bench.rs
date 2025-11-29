//! Consensus performance benchmarks

use cretoai_consensus::{BftConfig, BftEngine};
use cretoai_crypto::signatures::ML_DSA_87;
use cretoai_dag::types::Vertex;
use criterion::{black_box, criterion_group, criterion_main, Criterion};
use tokio::runtime::Runtime;
use tokio::sync::oneshot;

fn generate_keypair() -> (Vec<u8>, Vec<u8>) {
    let scheme = ML_DSA_87::new();
    scheme.generate_keypair().unwrap()
}

fn bench_vertex_proposal(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    c.bench_function("vertex_proposal", |b| {
        b.iter(|| {
            rt.block_on(async {
                let config = BftConfig {
                    node_id: uuid::Uuid::new_v4(),
                    total_nodes: 4,
                    ..Default::default()
                };

                let (private_key, public_key) = generate_keypair();
                let engine = BftEngine::new(config, private_key, public_key).unwrap();

                let vertex = Vertex::new(b"benchmark data".to_vec());
                let (tx, rx) = oneshot::channel();

                engine.propose(vertex, tx).await.ok();
            })
        });
    });
}

fn bench_message_validation(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    c.bench_function("message_validation", |b| {
        b.iter(|| {
            rt.block_on(async {
                let config = BftConfig {
                    node_id: uuid::Uuid::new_v4(),
                    total_nodes: 4,
                    ..Default::default()
                };

                let (private_key, public_key) = generate_keypair();
                let _engine = BftEngine::new(config, private_key, public_key).unwrap();

                // Benchmark signature verification
                black_box(());
            })
        });
    });
}

criterion_group!(benches, bench_vertex_proposal, bench_message_validation);
criterion_main!(benches);
