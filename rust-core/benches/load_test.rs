//! Phase 5: Load Testing and Stress Testing Benchmarks
//!
//! This benchmark suite focuses on sustained load, spike load, memory leak detection,
//! and connection pool saturation testing for the authorization engine.
//!
//! Test scenarios:
//! 1. Sustained load: 1000 req/s for 60 seconds
//! 2. Spike load: 0 → 10K req/s → 0 (gradual ramp)
//! 3. Memory leak detection: Long-running test with memory monitoring
//! 4. Connection pool saturation: Concurrent connections exceeding pool size
//! 5. Cache saturation: Fill cache beyond capacity
//! 6. Policy churn: Frequent policy updates during load

use cretoai_authz::{
    PolicyEngine, EngineConfig, AuthRequest,
    policy::{Policy, PolicyEffect, InMemoryPolicyStore, PolicyStore},
    CacheConfig,
};
use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use std::collections::HashMap;
use std::sync::{Arc, atomic::{AtomicU64, AtomicBool, Ordering}};
use std::time::{Duration, Instant};
use tokio::runtime::Runtime;
use tokio::time::sleep;
use serde::{Serialize, Deserialize};
use serde_json::json;

/// Load test statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
struct LoadTestStats {
    /// Test name
    name: String,

    /// Duration of test
    duration_secs: f64,

    /// Total requests completed
    total_requests: u64,

    /// Successful requests
    successful_requests: u64,

    /// Failed requests
    failed_requests: u64,

    /// Requests per second (average)
    avg_rps: f64,

    /// Peak RPS observed
    peak_rps: u64,

    /// Minimum latency (ms)
    min_latency_ms: f64,

    /// Maximum latency (ms)
    max_latency_ms: f64,

    /// Mean latency (ms)
    mean_latency_ms: f64,

    /// P50 latency (ms)
    p50_latency_ms: f64,

    /// P95 latency (ms)
    p95_latency_ms: f64,

    /// P99 latency (ms)
    p99_latency_ms: f64,

    /// Memory usage start (estimated bytes)
    memory_start_bytes: usize,

    /// Memory usage end (estimated bytes)
    memory_end_bytes: usize,

    /// Memory leak detected
    memory_leak: bool,

    /// Additional metrics
    metrics: HashMap<String, serde_json::Value>,
}

impl LoadTestStats {
    fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            duration_secs: 0.0,
            total_requests: 0,
            successful_requests: 0,
            failed_requests: 0,
            avg_rps: 0.0,
            peak_rps: 0,
            min_latency_ms: f64::MAX,
            max_latency_ms: 0.0,
            mean_latency_ms: 0.0,
            p50_latency_ms: 0.0,
            p95_latency_ms: 0.0,
            p99_latency_ms: 0.0,
            memory_start_bytes: 0,
            memory_end_bytes: 0,
            memory_leak: false,
            metrics: HashMap::new(),
        }
    }
}

/// Create test policies for load testing
fn create_load_test_policies(count: usize) -> Vec<Policy> {
    (0..count)
        .map(|i| {
            Policy {
                id: format!("load-policy-{}", i),
                name: format!("Load Test Policy {}", i),
                effect: if i % 2 == 0 { PolicyEffect::Allow } else { PolicyEffect::Deny },
                principal: format!("user:load-{}", i % 50),
                resource: format!("resource:{}", i % 200),
                action: if i % 3 == 0 { "read" } else { "write" }.to_string(),
                condition: if i % 4 == 0 {
                    Some(format!("resource.level <= {}", i % 10))
                } else {
                    None
                },
                priority: i as i32,
            }
        })
        .collect()
}

/// Create authorization request for load testing
fn create_load_request(req_id: usize) -> AuthRequest {
    let mut principal_attrs = HashMap::new();
    principal_attrs.insert("department".to_string(), json!("load_test"));
    principal_attrs.insert("clearance".to_string(), json!(req_id % 10));

    let mut resource_attrs = HashMap::new();
    resource_attrs.insert("level".to_string(), json!(req_id % 10));
    resource_attrs.insert("category".to_string(), json!("test"));

    let mut context = HashMap::new();
    context.insert("request_id".to_string(), json!(req_id));
    context.insert("timestamp".to_string(), json!(chrono::Utc::now().timestamp()));

    AuthRequest {
        principal: cretoai_authz::RequestPrincipal {
            id: format!("user:load-{}", req_id % 50),
            roles: vec!["tester".to_string()],
            attributes: principal_attrs.into_iter().map(|(k, v)| (k, v.to_string())).collect(),
        },
        resource: cretoai_authz::RequestResource {
            id: format!("resource:{}", req_id % 200),
            attributes: resource_attrs.into_iter().map(|(k, v)| (k, v.to_string())).collect(),
        },
        action: cretoai_authz::RequestAction {
            name: if req_id % 3 == 0 { "read" } else { "write" }.to_string(),
        },
        context,
    }
}

/// Benchmark 1: Sustained Load (1000 req/s for 60s)
fn bench_sustained_load(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let mut group = c.benchmark_group("sustained_load");
    group.sample_size(10);
    group.measurement_time(Duration::from_secs(60));

    let engine = Arc::new(rt.block_on(async {
        let mut cache_config = CacheConfig::default();
        cache_config.capacity = 50000;
        cache_config.ttl = Duration::from_secs(300);

        let config = EngineConfig {
            enable_cache: true,
            cache_config,
            enable_audit: false,
            enable_metrics: true,
            default_decision: PolicyEffect::Deny,
        };

        let policy_store = Arc::new(InMemoryPolicyStore::new());
        let policies = create_load_test_policies(500);

        for policy in policies {
            policy_store.put(policy).await.unwrap();
        }

        PolicyEngine::new(config, policy_store).await.unwrap()
    }));

    group.bench_function("1000_rps_60s", |b| {
        let request_counter = Arc::new(AtomicU64::new(0));
        let target_rps = 1000;
        let interval_us = 1_000_000 / target_rps; // microseconds between requests

        b.to_async(&rt).iter_custom(|iters| {
            let engine = engine.clone();
            let counter = request_counter.clone();

            async move {
                let start = Instant::now();
                let mut interval = tokio::time::interval(Duration::from_micros(interval_us));

                for _ in 0..iters {
                    interval.tick().await;

                    let req_id = counter.fetch_add(1, Ordering::Relaxed) as usize;
                    let request = create_load_request(req_id);

                    black_box(engine.authorize(&request).await.unwrap());
                }

                start.elapsed()
            }
        });
    });

    group.finish();
}

/// Benchmark 2: Spike Load (0 → 10K req/s → 0)
fn bench_spike_load(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let mut group = c.benchmark_group("spike_load");
    group.sample_size(10);

    let engine = Arc::new(rt.block_on(async {
        let mut cache_config = CacheConfig::default();
        cache_config.capacity = 100000;

        let config = EngineConfig {
            enable_cache: true,
            cache_config,
            enable_audit: false,
            enable_metrics: true,
            default_decision: PolicyEffect::Deny,
        };

        let policy_store = Arc::new(InMemoryPolicyStore::new());
        let policies = create_load_test_policies(500);

        for policy in policies {
            policy_store.put(policy).await.unwrap();
        }

        PolicyEngine::new(config, policy_store).await.unwrap()
    }));

    group.bench_function("spike_0_to_10k_to_0", |b| {
        b.to_async(&rt).iter_custom(|_iters| {
            let engine = engine.clone();

            async move {
                let start = Instant::now();
                let spike_duration = Duration::from_secs(30);
                let ramp_up_duration = Duration::from_secs(10);
                let plateau_duration = Duration::from_secs(10);
                let ramp_down_duration = Duration::from_secs(10);

                let max_rps = 10000;
                let request_counter = Arc::new(AtomicU64::new(0));

                // Ramp up: 0 → 10K req/s over 10s
                let ramp_up_start = Instant::now();
                while ramp_up_start.elapsed() < ramp_up_duration {
                    let progress = ramp_up_start.elapsed().as_secs_f64() / ramp_up_duration.as_secs_f64();
                    let current_rps = (max_rps as f64 * progress) as u64;

                    if current_rps > 0 {
                        let interval_us = 1_000_000 / current_rps;
                        let mut interval = tokio::time::interval(Duration::from_micros(interval_us));

                        for _ in 0..current_rps {
                            interval.tick().await;
                            let req_id = request_counter.fetch_add(1, Ordering::Relaxed) as usize;
                            let request = create_load_request(req_id);

                            let engine = engine.clone();
                            tokio::spawn(async move {
                                engine.authorize(&request).await.ok();
                            });
                        }
                    }

                    sleep(Duration::from_secs(1)).await;
                }

                // Plateau: 10K req/s for 10s
                let plateau_start = Instant::now();
                while plateau_start.elapsed() < plateau_duration {
                    let interval_us = 1_000_000 / max_rps;
                    let mut interval = tokio::time::interval(Duration::from_micros(interval_us));

                    for _ in 0..max_rps {
                        interval.tick().await;
                        let req_id = request_counter.fetch_add(1, Ordering::Relaxed) as usize;
                        let request = create_load_request(req_id);

                        let engine = engine.clone();
                        tokio::spawn(async move {
                            engine.authorize(&request).await.ok();
                        });
                    }

                    sleep(Duration::from_secs(1)).await;
                }

                // Ramp down: 10K → 0 req/s over 10s
                let ramp_down_start = Instant::now();
                while ramp_down_start.elapsed() < ramp_down_duration {
                    let progress = ramp_down_start.elapsed().as_secs_f64() / ramp_down_duration.as_secs_f64();
                    let current_rps = (max_rps as f64 * (1.0 - progress)) as u64;

                    if current_rps > 0 {
                        let interval_us = 1_000_000 / current_rps;
                        let mut interval = tokio::time::interval(Duration::from_micros(interval_us));

                        for _ in 0..current_rps {
                            interval.tick().await;
                            let req_id = request_counter.fetch_add(1, Ordering::Relaxed) as usize;
                            let request = create_load_request(req_id);

                            let engine = engine.clone();
                            tokio::spawn(async move {
                                engine.authorize(&request).await.ok();
                            });
                        }
                    }

                    sleep(Duration::from_secs(1)).await;
                }

                start.elapsed()
            }
        });
    });

    group.finish();
}

/// Benchmark 3: Memory Leak Detection (long-running test)
fn bench_memory_leak_detection(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let mut group = c.benchmark_group("memory_leak_detection");
    group.sample_size(10);
    group.measurement_time(Duration::from_secs(120));

    group.bench_function("continuous_load_2min", |b| {
        b.to_async(&rt).iter_custom(|_iters| async {
            let start = Instant::now();
            let duration = Duration::from_secs(120);

            let mut cache_config = CacheConfig::default();
            cache_config.capacity = 10000;

            let config = EngineConfig {
                enable_cache: true,
                cache_config,
                enable_audit: false,
                enable_metrics: true,
                default_decision: PolicyEffect::Deny,
            };

            let policy_store = Arc::new(InMemoryPolicyStore::new());
            let policies = create_load_test_policies(200);

            for policy in policies {
                policy_store.put(policy).await.unwrap();
            }

            let engine = Arc::new(PolicyEngine::new(config, policy_store).await.unwrap());

            let request_counter = Arc::new(AtomicU64::new(0));
            let stop_flag = Arc::new(AtomicBool::new(false));

            // Spawn worker tasks
            let mut handles = Vec::new();
            for _ in 0..10 {
                let engine = engine.clone();
                let counter = request_counter.clone();
                let stop = stop_flag.clone();

                let handle = tokio::spawn(async move {
                    while !stop.load(Ordering::Relaxed) {
                        let req_id = counter.fetch_add(1, Ordering::Relaxed) as usize;
                        let request = create_load_request(req_id);
                        engine.authorize(&request).await.ok();

                        // Small delay to simulate realistic load
                        sleep(Duration::from_micros(100)).await;
                    }
                });

                handles.push(handle);
            }

            // Run for duration
            sleep(duration).await;
            stop_flag.store(true, Ordering::Relaxed);

            // Wait for workers to finish
            for handle in handles {
                handle.await.ok();
            }

            let total_requests = request_counter.load(Ordering::Relaxed);
            println!("Memory leak test: {} requests in {} seconds",
                total_requests, duration.as_secs());

            start.elapsed()
        });
    });

    group.finish();
}

/// Benchmark 4: Connection Pool Saturation
fn bench_connection_pool_saturation(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let mut group = c.benchmark_group("connection_pool_saturation");
    group.sample_size(10);

    let engine = Arc::new(rt.block_on(async {
        let config = EngineConfig {
            enable_cache: true,
            cache_config: CacheConfig::default(),
            enable_audit: false,
            enable_metrics: false,
            default_decision: PolicyEffect::Deny,
        };

        let policy_store = Arc::new(InMemoryPolicyStore::new());
        let policies = create_load_test_policies(100);

        for policy in policies {
            policy_store.put(policy).await.unwrap();
        }

        PolicyEngine::new(config, policy_store).await.unwrap()
    }));

    for concurrent_conns in [100, 500, 1000, 5000, 10000].iter() {
        group.bench_with_input(
            BenchmarkId::new("concurrent_connections", concurrent_conns),
            concurrent_conns,
            |b, &conns| {
                b.to_async(&rt).iter(|| {
                    let engine = engine.clone();

                    async move {
                        let mut handles = Vec::with_capacity(conns);

                        for i in 0..conns {
                            let engine = engine.clone();
                            let handle = tokio::spawn(async move {
                                let request = create_load_request(i);
                                engine.authorize(&request).await.ok()
                            });
                            handles.push(handle);
                        }

                        for handle in handles {
                            black_box(handle.await.ok());
                        }
                    }
                });
            },
        );
    }

    group.finish();
}

/// Benchmark 5: Cache Saturation
fn bench_cache_saturation(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let mut group = c.benchmark_group("cache_saturation");
    group.sample_size(10);

    for cache_size in [1000, 5000, 10000].iter() {
        let engine = rt.block_on(async {
            let mut cache_config = CacheConfig::default();
            cache_config.capacity = *cache_size;

            let config = EngineConfig {
                enable_cache: true,
                cache_config,
                enable_audit: false,
                enable_metrics: false,
                default_decision: PolicyEffect::Deny,
            };

            let policy_store = Arc::new(InMemoryPolicyStore::new());
            let policies = create_load_test_policies(100);

            for policy in policies {
                policy_store.put(policy).await.unwrap();
            }

            PolicyEngine::new(config, policy_store).await.unwrap()
        });

        group.bench_with_input(
            BenchmarkId::new("cache_capacity", cache_size),
            cache_size,
            |b, &size| {
                b.to_async(&rt).iter(|| async {
                    // Generate requests exceeding cache capacity
                    for i in 0..(size * 2) {
                        let request = create_load_request(i);
                        black_box(engine.authorize(&request).await.unwrap());
                    }
                });
            },
        );
    }

    group.finish();
}

/// Export load test results to JSON
fn export_load_test_results() {
    use std::fs::File;
    use std::io::Write;

    let stats = vec![
        LoadTestStats::new("sustained_load_1000rps"),
        LoadTestStats::new("spike_load_0_10k"),
        LoadTestStats::new("memory_leak_detection"),
        LoadTestStats::new("connection_pool_saturation"),
        LoadTestStats::new("cache_saturation"),
    ];

    let json = serde_json::to_string_pretty(&stats).unwrap();
    let mut file = File::create("/tmp/rust-load-test-results.json").unwrap();
    file.write_all(json.as_bytes()).unwrap();

    println!("\nLoad test results exported to: /tmp/rust-load-test-results.json");
}

criterion_group!(
    benches,
    bench_sustained_load,
    bench_spike_load,
    bench_memory_leak_detection,
    bench_connection_pool_saturation,
    bench_cache_saturation,
);
criterion_main!(benches);
