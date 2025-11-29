//! Recovery Performance Benchmarks
//!
//! Measures failure detection latency, fork resolution time, and state sync performance

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use cretoai_consensus::{
    degraded_mode::{ConsensusParams, DegradedModeManager},
    failure_detector::{FailureDetectorConfig, PhiAccrualFailureDetector},
    fork_reconciliation::{Fork, ForkReconciliator, ReputationTracker},
    peer_recovery::{PeerRecoveryConfig, PeerRecoveryManager},
    state_sync::{Snapshot, StateSynchronizer},
    NodeId,
};
use cretoai_dag::storage::DAGStorage;
use cretoai_dag::DAG;
use std::collections::HashSet;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime};

/// Benchmark failure detection latency
fn bench_failure_detection(c: &mut Criterion) {
    let mut group = c.benchmark_group("failure_detection");

    for &node_count in &[10, 50, 100, 500] {
        group.throughput(Throughput::Elements(node_count));

        group.bench_with_input(
            BenchmarkId::from_parameter(node_count),
            &node_count,
            |b, &count| {
                let detector = PhiAccrualFailureDetector::new(FailureDetectorConfig::default());

                // Setup: Record heartbeats for all nodes
                let nodes: Vec<NodeId> = (0..count).map(|_| NodeId::new_v4()).collect();
                for node in &nodes {
                    detector.record_heartbeat(*node);
                    thread::sleep(Duration::from_millis(10));
                    detector.record_heartbeat(*node);
                }

                // Wait for failure
                thread::sleep(Duration::from_millis(500));

                b.iter(|| {
                    // Measure phi calculation time
                    let start = Instant::now();
                    for node in &nodes {
                        let phi = detector.phi(node);
                        black_box(phi);
                    }
                    start.elapsed()
                });
            },
        );
    }

    group.finish();
}

/// Benchmark failure detection with different phi thresholds
fn bench_phi_thresholds(c: &mut Criterion) {
    let mut group = c.benchmark_group("phi_thresholds");

    for &threshold in &[3.0, 5.0, 8.0, 10.0] {
        group.bench_with_input(
            BenchmarkId::from_parameter(threshold),
            &threshold,
            |b, &thresh| {
                let mut config = FailureDetectorConfig::default();
                config.phi_threshold = thresh;

                let detector = PhiAccrualFailureDetector::new(config);
                let node = NodeId::new_v4();

                // Record regular heartbeats
                for _ in 0..10 {
                    detector.record_heartbeat(node);
                    thread::sleep(Duration::from_millis(50));
                }

                // Wait for failure
                thread::sleep(Duration::from_millis(500));

                b.iter(|| {
                    let start = Instant::now();
                    let suspected = detector.suspect(&node);
                    black_box(suspected);
                    start.elapsed()
                });
            },
        );
    }

    group.finish();
}

/// Benchmark peer replacement speed
fn bench_peer_replacement(c: &mut Criterion) {
    let mut group = c.benchmark_group("peer_replacement");

    for &node_count in &[4, 10, 20] {
        group.bench_with_input(
            BenchmarkId::from_parameter(node_count),
            &node_count,
            |b, &count| {
                let detector = Arc::new(PhiAccrualFailureDetector::new(
                    FailureDetectorConfig::default(),
                ));

                let active_peers: HashSet<NodeId> =
                    (0..count).map(|_| NodeId::new_v4()).collect();
                let backup_peers: Vec<NodeId> = (0..5).map(|_| NodeId::new_v4()).collect();

                let manager = PeerRecoveryManager::new(
                    detector.clone(),
                    active_peers.clone(),
                    backup_peers,
                    PeerRecoveryConfig::default(),
                );

                let failed_node = *active_peers.iter().next().unwrap();
                detector.mark_failed(failed_node);

                b.to_async(tokio::runtime::Runtime::new().unwrap())
                    .iter(|| async {
                        let start = Instant::now();
                        let _ = manager.replace_peer(failed_node).await;
                        start.elapsed()
                    });
            },
        );
    }

    group.finish();
}

/// Benchmark fork detection
fn bench_fork_detection(c: &mut Criterion) {
    let mut group = c.benchmark_group("fork_detection");

    let storage = Arc::new(DAGStorage::new_in_memory());
    let dag = Arc::new(DAG::new(storage));
    let reputation = Arc::new(ReputationTracker::new(1.0));
    let reconciliator = ForkReconciliator::new(dag, reputation);

    group.bench_function("detect_fork", |b| {
        b.to_async(tokio::runtime::Runtime::new().unwrap())
            .iter(|| async {
                let v1 = vec![1u8; 32];
                let v2 = vec![2u8; 32];

                let start = Instant::now();
                let _ = reconciliator.detect_fork(&v1, &v2).await;
                start.elapsed()
            });
    });

    group.finish();
}

/// Benchmark fork resolution
fn bench_fork_resolution(c: &mut Criterion) {
    let mut group = c.benchmark_group("fork_resolution");

    let storage = Arc::new(DAGStorage::new_in_memory());
    let dag = Arc::new(DAG::new(storage));
    let reputation = Arc::new(ReputationTracker::new(1.0));
    let reconciliator = ForkReconciliator::new(dag, reputation.clone());

    // Setup reputation scores
    let node_a = NodeId::new_v4();
    let node_b = NodeId::new_v4();
    reputation.reward(node_a, 0.5);

    let fork = Fork {
        common_ancestor: vec![0u8; 32],
        chain_a: (0..10).map(|i| vec![i; 32]).collect(),
        chain_b: (10..20).map(|i| vec![i; 32]).collect(),
        detected_at: SystemTime::now(),
        conflicting_creators: vec![node_a, node_b],
    };

    group.bench_function("resolve_fork", |b| {
        b.to_async(tokio::runtime::Runtime::new().unwrap())
            .iter(|| async {
                let fork_clone = fork.clone();
                let start = Instant::now();
                let _ = reconciliator.resolve_fork(fork_clone).await;
                start.elapsed()
            });
    });

    group.finish();
}

/// Benchmark state synchronization
fn bench_state_sync(c: &mut Criterion) {
    let mut group = c.benchmark_group("state_sync");

    for &vertex_count in &[100, 1000, 10000] {
        group.throughput(Throughput::Elements(vertex_count));

        group.bench_with_input(
            BenchmarkId::from_parameter(vertex_count),
            &vertex_count,
            |b, &_count| {
                let synchronizer =
                    StateSynchronizer::new(Duration::from_secs(30), Some(10_000_000));

                b.to_async(tokio::runtime::Runtime::new().unwrap())
                    .iter(|| async {
                        let start = Instant::now();
                        let _ = synchronizer.create_snapshot().await;
                        start.elapsed()
                    });
            },
        );
    }

    group.finish();
}

/// Benchmark snapshot creation and verification
fn bench_snapshot_operations(c: &mut Criterion) {
    let mut group = c.benchmark_group("snapshot_operations");

    let synchronizer = StateSynchronizer::new(Duration::from_secs(30), None);

    group.bench_function("create_snapshot", |b| {
        b.to_async(tokio::runtime::Runtime::new().unwrap())
            .iter(|| async {
                let start = Instant::now();
                let _ = synchronizer.create_snapshot().await;
                start.elapsed()
            });
    });

    // Create a snapshot for verification benchmark
    let rt = tokio::runtime::Runtime::new().unwrap();
    let snapshot = rt.block_on(async { synchronizer.create_snapshot().await });

    group.bench_function("apply_snapshot", |b| {
        b.to_async(tokio::runtime::Runtime::new().unwrap())
            .iter(|| async {
                let snapshot_clone = snapshot.clone();
                let start = Instant::now();
                let _ = synchronizer.apply_snapshot(snapshot_clone).await;
                start.elapsed()
            });
    });

    group.finish();
}

/// Benchmark degraded mode transitions
fn bench_degraded_mode(c: &mut Criterion) {
    let mut group = c.benchmark_group("degraded_mode");

    let detector = Arc::new(PhiAccrualFailureDetector::new(
        FailureDetectorConfig::default(),
    ));

    let active_peers: HashSet<NodeId> = (0..10).map(|_| NodeId::new_v4()).collect();
    let backup_peers: Vec<NodeId> = (0..2).map(|_| NodeId::new_v4()).collect();

    let peer_monitor = Arc::new(PeerRecoveryManager::new(
        detector,
        active_peers,
        backup_peers,
        PeerRecoveryConfig::default(),
    ));

    let manager = DegradedModeManager::new(peer_monitor, ConsensusParams::default(), 10);

    group.bench_function("evaluate_mode", |b| {
        b.to_async(tokio::runtime::Runtime::new().unwrap())
            .iter(|| async {
                let start = Instant::now();
                let _ = manager.evaluate_mode().await;
                start.elapsed()
            });
    });

    group.bench_function("adjust_parameters", |b| {
        b.iter(|| {
            let start = Instant::now();
            let _ = manager.adjust_parameters(cretoai_consensus::degraded_mode::OperationMode::Normal);
            start.elapsed()
        });
    });

    group.finish();
}

/// Benchmark recovery under high failure rate
fn bench_high_failure_rate(c: &mut Criterion) {
    let mut group = c.benchmark_group("high_failure_rate");

    for &failure_rate in &[0.1, 0.2, 0.33] {
        group.bench_with_input(
            BenchmarkId::from_parameter(failure_rate),
            &failure_rate,
            |b, &rate| {
                let detector = Arc::new(PhiAccrualFailureDetector::new(
                    FailureDetectorConfig::default(),
                ));

                let node_count = 100;
                let active_peers: HashSet<NodeId> =
                    (0..node_count).map(|_| NodeId::new_v4()).collect();
                let backup_peers: Vec<NodeId> = (0..50).map(|_| NodeId::new_v4()).collect();

                // Mark nodes as failed based on rate
                let fail_count = (node_count as f64 * rate) as usize;
                for node in active_peers.iter().take(fail_count) {
                    detector.mark_failed(*node);
                }

                let manager = PeerRecoveryManager::new(
                    detector,
                    active_peers,
                    backup_peers,
                    PeerRecoveryConfig::default(),
                );

                b.iter(|| {
                    let start = Instant::now();
                    let available = manager.active_peer_count();
                    black_box(available);
                    start.elapsed()
                });
            },
        );
    }

    group.finish();
}

/// Benchmark recovery time measurement
fn bench_recovery_time(c: &mut Criterion) {
    let mut group = c.benchmark_group("recovery_time");
    group.measurement_time(Duration::from_secs(10));

    group.bench_function("full_recovery_cycle", |b| {
        b.to_async(tokio::runtime::Runtime::new().unwrap())
            .iter(|| async {
                let detector = Arc::new(PhiAccrualFailureDetector::new(
                    FailureDetectorConfig::default(),
                ));

                let active_peers: HashSet<NodeId> = (0..10).map(|_| NodeId::new_v4()).collect();
                let backup_peers: Vec<NodeId> = (0..5).map(|_| NodeId::new_v4()).collect();

                let manager = PeerRecoveryManager::new(
                    detector.clone(),
                    active_peers.clone(),
                    backup_peers,
                    PeerRecoveryConfig::default(),
                );

                let failed_node = *active_peers.iter().next().unwrap();

                let start = Instant::now();

                // Simulate failure
                detector.mark_failed(failed_node);

                // Attempt recovery
                let _ = manager.handle_dead_peer(failed_node).await;

                start.elapsed()
            });
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_failure_detection,
    bench_phi_thresholds,
    bench_peer_replacement,
    bench_fork_detection,
    bench_fork_resolution,
    bench_state_sync,
    bench_snapshot_operations,
    bench_degraded_mode,
    bench_high_failure_rate,
    bench_recovery_time,
);

criterion_main!(benches);
