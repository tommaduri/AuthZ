//! Connection Pool Performance Benchmarks
//!
//! Comprehensive benchmarks measuring:
//! - Connection acquisition latency (with/without pool)
//! - Concurrent connection request throughput
//! - Connection reuse rate
//! - Pool auto-scaling performance
//! - LRU cache hit rate

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use cretoai_network::connection_pool::{
    ConnectionFactory, ConnectionPool, PoolConfig, PooledConnection,
};
use cretoai_network::error::Result;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::runtime::Runtime;

/// Mock connection factory for benchmarking
struct BenchFactory {
    latency: Duration,
}

impl BenchFactory {
    fn new(latency: Duration) -> Self {
        Self { latency }
    }
}

#[async_trait::async_trait]
impl ConnectionFactory for BenchFactory {
    async fn create_connection(&self, addr: SocketAddr) -> Result<PooledConnection> {
        tokio::time::sleep(self.latency).await;
        Ok(PooledConnection::new(
            format!("conn-{}", uuid::Uuid::new_v4()),
            addr,
        ))
    }

    async fn health_check(&self, _conn: &PooledConnection) -> Result<(bool, Option<Duration>)> {
        Ok((true, Some(Duration::from_micros(100))))
    }

    async fn close_connection(&self, _conn: &PooledConnection) -> Result<()> {
        Ok(())
    }
}

/// Benchmark connection acquisition without pooling
fn bench_direct_connection(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let mut group = c.benchmark_group("connection_acquisition");

    for latency_ms in [10, 20, 50, 100].iter() {
        let latency = Duration::from_millis(*latency_ms);
        let factory = Arc::new(BenchFactory::new(latency));

        group.bench_with_input(
            BenchmarkId::new("direct", latency_ms),
            latency_ms,
            |b, _| {
                b.to_async(&rt).iter(|| async {
                    let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
                    let conn = factory.create_connection(addr).await.unwrap();
                    black_box(conn);
                });
            },
        );
    }

    group.finish();
}

/// Benchmark connection acquisition with pooling (first call)
fn bench_pool_first_acquisition(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let mut group = c.benchmark_group("pool_first_acquisition");

    for latency_ms in [10, 20, 50, 100].iter() {
        let latency = Duration::from_millis(*latency_ms);
        let factory = Arc::new(BenchFactory::new(latency));
        let config = PoolConfig::default();

        group.bench_with_input(
            BenchmarkId::new("pooled", latency_ms),
            latency_ms,
            |b, _| {
                b.to_async(&rt).iter(|| async {
                    let pool = ConnectionPool::new(config.clone(), factory.clone());
                    let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
                    let conn = pool.acquire(addr).await.unwrap();
                    black_box(conn);
                });
            },
        );
    }

    group.finish();
}

/// Benchmark connection reuse from pool (second call)
fn bench_pool_reuse(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let mut group = c.benchmark_group("pool_reuse");
    group.throughput(Throughput::Elements(1));

    let latency = Duration::from_millis(50);
    let factory = Arc::new(BenchFactory::new(latency));
    let config = PoolConfig::default();

    group.bench_function("reuse", |b| {
        b.to_async(&rt).iter(|| async {
            let pool = ConnectionPool::new(config.clone(), factory.clone());
            let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();

            // First acquisition (creates connection)
            let conn1 = pool.acquire(addr).await.unwrap();
            pool.release(conn1).await;

            // Second acquisition (reuses connection)
            let start = std::time::Instant::now();
            let conn2 = pool.acquire(addr).await.unwrap();
            let reuse_time = start.elapsed();
            pool.release(conn2).await;

            black_box(reuse_time);
        });
    });

    group.finish();
}

/// Benchmark concurrent connection requests
fn bench_concurrent_requests(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let mut group = c.benchmark_group("concurrent_requests");

    for concurrent in [10, 50, 100, 200].iter() {
        let latency = Duration::from_millis(20);
        let factory = Arc::new(BenchFactory::new(latency));
        let config = PoolConfig {
            max_connections: 200,
            ..Default::default()
        };

        group.throughput(Throughput::Elements(*concurrent as u64));
        group.bench_with_input(
            BenchmarkId::new("concurrent", concurrent),
            concurrent,
            |b, &count| {
                b.to_async(&rt).iter(|| async {
                    let pool = Arc::new(ConnectionPool::new(config.clone(), factory.clone()));
                    let mut handles = vec![];

                    for i in 0..count {
                        let pool = pool.clone();
                        let handle = tokio::spawn(async move {
                            let addr: SocketAddr =
                                format!("127.0.0.1:{}", 8000 + (i % 10)).parse().unwrap();
                            let conn = pool.acquire(addr).await.unwrap();
                            tokio::time::sleep(Duration::from_millis(5)).await;
                            pool.release(conn).await;
                        });
                        handles.push(handle);
                    }

                    for handle in handles {
                        handle.await.unwrap();
                    }
                });
            },
        );
    }

    group.finish();
}

/// Benchmark LRU cache hit rate
fn bench_lru_cache_performance(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let mut group = c.benchmark_group("lru_cache");

    let latency = Duration::from_millis(10);
    let factory = Arc::new(BenchFactory::new(latency));
    let config = PoolConfig {
        lru_cache_capacity: 100,
        ..Default::default()
    };

    group.bench_function("cache_hit_rate", |b| {
        b.to_async(&rt).iter(|| async {
            let pool = Arc::new(ConnectionPool::new(config.clone(), factory.clone()));

            // Warm up cache with 10 addresses
            for i in 0..10 {
                let addr: SocketAddr = format!("127.0.0.1:{}", 8000 + i).parse().unwrap();
                let conn = pool.acquire(addr).await.unwrap();
                pool.release(conn).await;
            }

            // Benchmark repeated access (should hit cache)
            let mut total_time = Duration::ZERO;
            for i in 0..100 {
                let addr: SocketAddr =
                    format!("127.0.0.1:{}", 8000 + (i % 10)).parse().unwrap();
                let start = std::time::Instant::now();
                let conn = pool.acquire(addr).await.unwrap();
                total_time += start.elapsed();
                pool.release(conn).await;
            }

            black_box(total_time);
        });
    });

    group.finish();
}

/// Benchmark pool auto-scaling
fn bench_auto_scaling(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let mut group = c.benchmark_group("auto_scaling");

    let latency = Duration::from_millis(10);
    let factory = Arc::new(BenchFactory::new(latency));
    let config = PoolConfig {
        min_connections: 4,
        max_connections: 50,
        auto_scale: true,
        ..Default::default()
    };

    group.bench_function("scale_up", |b| {
        b.to_async(&rt).iter(|| async {
            let pool = Arc::new(ConnectionPool::new(config.clone(), factory.clone()));

            // Create load to trigger scale up
            let mut handles = vec![];
            for i in 0..40 {
                let pool = pool.clone();
                let handle = tokio::spawn(async move {
                    let addr: SocketAddr =
                        format!("127.0.0.1:{}", 8000 + i).parse().unwrap();
                    let conn = pool.acquire(addr).await.unwrap();
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    pool.release(conn).await;
                });
                handles.push(handle);
            }

            for handle in handles {
                handle.await.unwrap();
            }

            let metrics = pool.get_metrics();
            black_box(metrics);
        });
    });

    group.finish();
}

/// Benchmark latency reduction comparison
fn bench_latency_reduction(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let mut group = c.benchmark_group("latency_comparison");

    let handshake_latency = Duration::from_millis(50); // Simulated TLS+PQC handshake
    let factory = Arc::new(BenchFactory::new(handshake_latency));
    let config = PoolConfig::default();

    // Without pool (direct connection)
    group.bench_function("without_pool", |b| {
        b.to_async(&rt).iter(|| async {
            let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
            let mut total_time = Duration::ZERO;

            for _ in 0..10 {
                let start = std::time::Instant::now();
                let conn = factory.create_connection(addr).await.unwrap();
                total_time += start.elapsed();
                black_box(conn);
            }

            black_box(total_time);
        });
    });

    // With pool (connection reuse)
    group.bench_function("with_pool", |b| {
        b.to_async(&rt).iter(|| async {
            let pool = ConnectionPool::new(config.clone(), factory.clone());
            let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
            let mut total_time = Duration::ZERO;

            // First connection (includes handshake)
            let conn = pool.acquire(addr).await.unwrap();
            pool.release(conn).await;

            // Subsequent connections (reused)
            for _ in 0..9 {
                let start = std::time::Instant::now();
                let conn = pool.acquire(addr).await.unwrap();
                total_time += start.elapsed();
                pool.release(conn).await;
            }

            black_box(total_time);
        });
    });

    group.finish();
}

/// Benchmark connection pool metrics overhead
fn bench_metrics_overhead(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let mut group = c.benchmark_group("metrics");

    let latency = Duration::from_millis(1);
    let factory = Arc::new(BenchFactory::new(latency));
    let config = PoolConfig::default();
    let pool = Arc::new(ConnectionPool::new(config, factory));

    group.bench_function("get_metrics", |b| {
        b.to_async(&rt).iter(|| async {
            let metrics = pool.get_metrics();
            black_box(metrics);
        });
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_direct_connection,
    bench_pool_first_acquisition,
    bench_pool_reuse,
    bench_concurrent_requests,
    bench_lru_cache_performance,
    bench_auto_scaling,
    bench_latency_reduction,
    bench_metrics_overhead,
);
criterion_main!(benches);
