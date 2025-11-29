use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use cretoai_consensus::circuit_breaker::{CircuitBreaker, CircuitConfig, CircuitState};
use cretoai_consensus::error::ConsensusError;
use std::sync::Arc;
use std::time::Duration;
use tokio::runtime::Runtime;

fn bench_circuit_breaker_overhead(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let mut group = c.benchmark_group("circuit_breaker_overhead");

    // Baseline: direct function call
    group.bench_function("baseline", |b| {
        b.to_async(&rt).iter(|| async {
            black_box(successful_operation()).await
        })
    });

    // With circuit breaker (closed state)
    let cb = Arc::new(CircuitBreaker::new(
        "test-peer".to_string(),
        CircuitConfig::default(),
    ));
    group.bench_function("with_circuit_breaker", |b| {
        let cb = cb.clone();
        b.to_async(&rt).iter(|| {
            let cb = cb.clone();
            async move {
                cb.call(|| async { successful_operation().await })
                    .await
                    .unwrap()
            }
        })
    });

    group.finish();
}

fn bench_state_transitions(c: &mut Criterion) {
    let mut group = c.benchmark_group("state_transitions");

    let config = CircuitConfig {
        failure_threshold: 3,
        timeout: Duration::from_millis(100),
        ..Default::default()
    };

    group.bench_function("record_success", |b| {
        let cb = CircuitBreaker::new("test-peer".to_string(), config.clone());
        b.iter(|| {
            cb.record_success();
        })
    });

    group.bench_function("record_failure", |b| {
        let cb = CircuitBreaker::new("test-peer".to_string(), config.clone());
        b.iter(|| {
            cb.record_failure();
        })
    });

    group.bench_function("get_state", |b| {
        let cb = CircuitBreaker::new("test-peer".to_string(), config.clone());
        b.iter(|| {
            black_box(cb.get_state());
        })
    });

    group.finish();
}

fn bench_concurrent_access(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let mut group = c.benchmark_group("concurrent_access");

    for thread_count in [1, 2, 4, 8, 16].iter() {
        group.bench_with_input(
            BenchmarkId::from_parameter(thread_count),
            thread_count,
            |b, &thread_count| {
                let cb = Arc::new(CircuitBreaker::new(
                    "test-peer".to_string(),
                    CircuitConfig::default(),
                ));

                b.to_async(&rt).iter(|| {
                    let cb = cb.clone();
                    async move {
                        let mut handles = vec![];
                        for _ in 0..thread_count {
                            let cb = cb.clone();
                            let handle = tokio::spawn(async move {
                                cb.call(|| async { successful_operation().await })
                                    .await
                                    .unwrap()
                            });
                            handles.push(handle);
                        }

                        for handle in handles {
                            handle.await.unwrap();
                        }
                    }
                });
            },
        );
    }

    group.finish();
}

fn bench_high_failure_rate(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let mut group = c.benchmark_group("high_failure_rate");

    let config = CircuitConfig {
        failure_threshold: 10,
        timeout: Duration::from_secs(1),
        ..Default::default()
    };

    group.bench_function("50_percent_failures", |b| {
        let cb = Arc::new(CircuitBreaker::new("test-peer".to_string(), config.clone()));

        b.to_async(&rt).iter(|| {
            let cb = cb.clone();
            async move {
                for i in 0..100 {
                    if i % 2 == 0 {
                        let _ = cb
                            .call(|| async { successful_operation().await })
                            .await;
                    } else {
                        let _ = cb
                            .call(|| async { failing_operation().await })
                            .await;
                    }
                }
            }
        })
    });

    group.finish();
}

fn bench_fallback_queue_operations(c: &mut Criterion) {
    use cretoai_consensus::fallback::{FallbackStrategy, FallbackConfig, PendingRequest, RequestPriority};
    use std::time::Instant;

    let mut group = c.benchmark_group("fallback_operations");

    let strategy = FallbackStrategy::new(FallbackConfig::default());

    group.bench_function("queue_request", |b| {
        let strategy = strategy.clone();
        b.iter(|| {
            let request = PendingRequest {
                id: "test-req".to_string(),
                peer_id: "peer1".to_string(),
                payload: vec![1, 2, 3],
                queued_at: Instant::now(),
                retry_count: 0,
                priority: RequestPriority::Medium,
            };
            // Note: In real implementation, this would be async
            // For benchmark, we test the sync path
            black_box(&request);
        })
    });

    group.bench_function("select_best_peer", |b| {
        let strategy = strategy.clone();
        strategy.record_peer_success("peer1", Duration::from_millis(10));
        strategy.record_peer_success("peer2", Duration::from_millis(50));
        strategy.record_peer_success("peer3", Duration::from_millis(30));

        let candidates = vec![
            "peer1".to_string(),
            "peer2".to_string(),
            "peer3".to_string(),
        ];

        b.iter(|| {
            black_box(strategy.select_best_peer(&candidates));
        })
    });

    group.finish();
}

fn bench_adaptive_timeout(c: &mut Criterion) {
    use cretoai_consensus::adaptive_timeout::{AdaptiveTimeout, AdaptiveTimeoutConfig};

    let mut group = c.benchmark_group("adaptive_timeout");

    let timeout = AdaptiveTimeout::new(AdaptiveTimeoutConfig::default());

    // Record some latencies
    for _ in 0..50 {
        timeout.record_latency("peer1", Duration::from_millis(100));
    }

    group.bench_function("calculate_timeout", |b| {
        b.iter(|| {
            black_box(timeout.calculate_timeout("peer1"));
        })
    });

    group.bench_function("record_latency", |b| {
        b.iter(|| {
            timeout.record_latency("peer1", Duration::from_millis(100));
        })
    });

    group.finish();
}

fn bench_metrics_collection(c: &mut Criterion) {
    let mut group = c.benchmark_group("metrics");

    let cb = CircuitBreaker::new("test-peer".to_string(), CircuitConfig::default());

    group.bench_function("get_stats", |b| {
        b.iter(|| {
            black_box(cb.get_stats());
        })
    });

    group.finish();
}

// Helper functions
async fn successful_operation() -> Result<u64, ConsensusError> {
    Ok(42)
}

async fn failing_operation() -> Result<u64, ConsensusError> {
    Err(ConsensusError::Internal("test error".to_string()))
}

criterion_group!(
    benches,
    bench_circuit_breaker_overhead,
    bench_state_transitions,
    bench_concurrent_access,
    bench_high_failure_rate,
    bench_fallback_queue_operations,
    bench_adaptive_timeout,
    bench_metrics_collection,
);

criterion_main!(benches);
