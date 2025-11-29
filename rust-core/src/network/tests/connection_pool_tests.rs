//! Connection Pool Integration Tests
//!
//! Comprehensive test suite covering:
//! - Pool acquire/release cycle
//! - Connection reuse
//! - Auto-scaling (grow/shrink)
//! - Health monitoring
//! - LRU cache eviction
//! - Concurrent access
//! - Connection lifecycle
//! - Metrics accuracy

use cretoai_network::connection_pool::{
    ConnectionFactory, ConnectionPool, PoolConfig, PooledConnection, ScaleDirection,
};
use cretoai_network::error::{NetworkError, Result};
use cretoai_network::health_monitor::{HealthMonitor, HealthStatus, MonitorConfig};
use cretoai_network::lru_cache::LRUCache;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

/// Mock connection factory for testing
struct TestConnectionFactory {
    connection_count: Arc<AtomicUsize>,
    fail_next: Arc<AtomicBool>,
    health_check_fails: Arc<AtomicBool>,
}

impl TestConnectionFactory {
    fn new() -> Self {
        Self {
            connection_count: Arc::new(AtomicUsize::new(0)),
            fail_next: Arc::new(AtomicBool::new(false)),
            health_check_fails: Arc::new(AtomicBool::new(false)),
        }
    }

    fn connection_count(&self) -> usize {
        self.connection_count.load(Ordering::Relaxed)
    }

    fn set_fail_next(&self, fail: bool) {
        self.fail_next.store(fail, Ordering::Relaxed);
    }

    fn set_health_check_fails(&self, fail: bool) {
        self.health_check_fails.store(fail, Ordering::Relaxed);
    }
}

#[async_trait::async_trait]
impl ConnectionFactory for TestConnectionFactory {
    async fn create_connection(&self, addr: SocketAddr) -> Result<PooledConnection> {
        if self.fail_next.load(Ordering::Relaxed) {
            return Err(NetworkError::Connection("Simulated failure".to_string()));
        }

        self.connection_count.fetch_add(1, Ordering::Relaxed);
        tokio::time::sleep(Duration::from_millis(10)).await; // Simulate handshake
        Ok(PooledConnection::new(
            format!("conn-{}", uuid::Uuid::new_v4()),
            addr,
        ))
    }

    async fn health_check(&self, _conn: &PooledConnection) -> Result<(bool, Option<Duration>)> {
        if self.health_check_fails.load(Ordering::Relaxed) {
            Ok((false, None))
        } else {
            Ok((true, Some(Duration::from_millis(5))))
        }
    }

    async fn close_connection(&self, _conn: &PooledConnection) -> Result<()> {
        Ok(())
    }
}

#[tokio::test]
async fn test_pool_basic_acquire_release() {
    let config = PoolConfig::default();
    let factory = Arc::new(TestConnectionFactory::new());
    let pool = ConnectionPool::new(config, factory.clone());

    let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();

    // Acquire connection
    let conn = pool.acquire(addr).await.unwrap();
    assert_eq!(conn.use_count, 1);
    assert!(conn.in_use);
    assert_eq!(factory.connection_count(), 1);

    // Release connection
    pool.release(conn).await;
    assert_eq!(pool.idle_count(), 1);
    assert_eq!(pool.active_count(), 0);
}

#[tokio::test]
async fn test_pool_connection_reuse() {
    let config = PoolConfig::default();
    let factory = Arc::new(TestConnectionFactory::new());
    let pool = ConnectionPool::new(config, factory.clone());

    let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();

    // First acquisition
    let conn1 = pool.acquire(addr).await.unwrap();
    let conn_id = conn1.connection_id.clone();
    pool.release(conn1).await;

    // Second acquisition should reuse
    let conn2 = pool.acquire(addr).await.unwrap();
    assert_eq!(conn2.connection_id, conn_id);
    assert_eq!(conn2.use_count, 2);
    assert_eq!(factory.connection_count(), 1); // No new connection created
}

#[tokio::test]
async fn test_pool_multiple_peers() {
    let config = PoolConfig::default();
    let factory = Arc::new(TestConnectionFactory::new());
    let pool = ConnectionPool::new(config, factory.clone());

    let addr1: SocketAddr = "127.0.0.1:8080".parse().unwrap();
    let addr2: SocketAddr = "127.0.0.1:8081".parse().unwrap();

    let conn1 = pool.acquire(addr1).await.unwrap();
    let conn2 = pool.acquire(addr2).await.unwrap();

    assert_ne!(conn1.connection_id, conn2.connection_id);
    assert_eq!(factory.connection_count(), 2);

    pool.release(conn1).await;
    pool.release(conn2).await;

    assert_eq!(pool.idle_count(), 2);
}

#[tokio::test]
async fn test_pool_concurrent_acquire() {
    let config = PoolConfig {
        max_connections: 50,
        ..Default::default()
    };
    let factory = Arc::new(TestConnectionFactory::new());
    let pool = Arc::new(ConnectionPool::new(config, factory.clone()));

    let mut handles = vec![];
    for i in 0..20 {
        let pool = pool.clone();
        let handle = tokio::spawn(async move {
            let addr: SocketAddr = format!("127.0.0.1:{}", 8000 + i % 5).parse().unwrap();
            let conn = pool.acquire(addr).await.unwrap();
            tokio::time::sleep(Duration::from_millis(10)).await;
            pool.release(conn).await;
        });
        handles.push(handle);
    }

    for handle in handles {
        handle.await.unwrap();
    }

    // Should have created connections for 5 unique addresses
    assert!(factory.connection_count() <= 5);
}

#[tokio::test]
async fn test_pool_max_connections() {
    let config = PoolConfig {
        max_connections: 5,
        ..Default::default()
    };
    let factory = Arc::new(TestConnectionFactory::new());
    let pool = Arc::new(ConnectionPool::new(config, factory));

    let mut connections = vec![];
    for i in 0..5 {
        let addr: SocketAddr = format!("127.0.0.1:{}", 8000 + i).parse().unwrap();
        let conn = pool.acquire(addr).await.unwrap();
        connections.push(conn);
    }

    // Pool is at capacity
    assert_eq!(pool.active_count(), 5);

    // Release all connections
    for conn in connections {
        pool.release(conn).await;
    }
}

#[tokio::test]
async fn test_pool_health_check() {
    let config = PoolConfig::default();
    let factory = Arc::new(TestConnectionFactory::new());
    let pool = ConnectionPool::new(config, factory.clone());

    let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
    let _conn = pool.acquire(addr).await.unwrap();

    let health = pool.health_check().await;
    assert!(health.operational);
    assert_eq!(health.healthy_connections, 1);
    assert_eq!(health.unhealthy_connections, 0);
}

#[tokio::test]
async fn test_pool_unhealthy_connection_removal() {
    let config = PoolConfig::default();
    let factory = Arc::new(TestConnectionFactory::new());
    let pool = ConnectionPool::new(config, factory.clone());

    let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
    let mut conn = pool.acquire(addr).await.unwrap();

    // Mark connection as unhealthy
    conn.healthy = false;

    pool.release(conn).await;

    // Unhealthy connection should be evicted
    let metrics = pool.get_metrics();
    assert_eq!(metrics.evictions, 1);
}

#[tokio::test]
async fn test_pool_expired_connection_removal() {
    let config = PoolConfig {
        max_lifetime: Duration::from_millis(50),
        ..Default::default()
    };
    let factory = Arc::new(TestConnectionFactory::new());
    let pool = ConnectionPool::new(config, factory);

    let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
    let conn = pool.acquire(addr).await.unwrap();

    // Wait for connection to expire
    tokio::time::sleep(Duration::from_millis(100)).await;

    pool.release(conn).await;

    // Expired connection should be evicted
    let metrics = pool.get_metrics();
    assert_eq!(metrics.evictions, 1);
}

#[tokio::test]
async fn test_pool_metrics() {
    let config = PoolConfig::default();
    let factory = Arc::new(TestConnectionFactory::new());
    let pool = ConnectionPool::new(config, factory);

    let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();

    // First acquisition
    let conn1 = pool.acquire(addr).await.unwrap();
    pool.release(conn1).await;

    // Second acquisition (reuse)
    let conn2 = pool.acquire(addr).await.unwrap();
    pool.release(conn2).await;

    let metrics = pool.get_metrics();
    assert_eq!(metrics.acquisitions, 2);
    assert_eq!(metrics.releases, 2);
    assert_eq!(metrics.new_connections, 1);
    assert_eq!(metrics.reuses, 1);
    assert_eq!(metrics.reuse_rate, 0.5);
}

#[tokio::test]
async fn test_pool_auto_scale_up() {
    let config = PoolConfig {
        min_connections: 2,
        max_connections: 20,
        auto_scale: true,
        ..Default::default()
    };
    let factory = Arc::new(TestConnectionFactory::new());
    let pool = Arc::new(ConnectionPool::new(config, factory));

    // Create high load (>80% utilization)
    let mut connections = vec![];
    for i in 0..16 {
        let addr: SocketAddr = format!("127.0.0.1:{}", 8000 + i).parse().unwrap();
        let conn = pool.acquire(addr).await.unwrap();
        connections.push(conn);
    }

    let health = pool.health_check().await;
    assert!(health.utilization > 0.8);
    assert_eq!(health.scale_direction, ScaleDirection::Up);
    assert!(health.needs_scaling);

    // Clean up
    for conn in connections {
        pool.release(conn).await;
    }
}

#[tokio::test]
async fn test_pool_auto_scale_down() {
    let config = PoolConfig {
        min_connections: 2,
        max_connections: 20,
        auto_scale: true,
        ..Default::default()
    };
    let factory = Arc::new(TestConnectionFactory::new());
    let pool = Arc::new(ConnectionPool::new(config, factory));

    // Create and release connections to build up idle pool
    for i in 0..10 {
        let addr: SocketAddr = format!("127.0.0.1:{}", 8000 + i).parse().unwrap();
        let conn = pool.acquire(addr).await.unwrap();
        pool.release(conn).await;
    }

    // With low utilization, should suggest scale down
    let health = pool.health_check().await;
    if health.utilization < 0.3 {
        assert_eq!(health.scale_direction, ScaleDirection::Down);
        assert!(health.needs_scaling);
    }
}

#[tokio::test]
async fn test_pool_scale_manual() {
    let config = PoolConfig {
        min_connections: 2,
        max_connections: 20,
        auto_scale: false,
        ..Default::default()
    };
    let factory = Arc::new(TestConnectionFactory::new());
    let pool = Arc::new(ConnectionPool::new(config, factory));

    // Build up pool
    for i in 0..10 {
        let addr: SocketAddr = format!("127.0.0.1:{}", 8000 + i).parse().unwrap();
        let conn = pool.acquire(addr).await.unwrap();
        pool.release(conn).await;
    }

    let initial_size = pool.total_size();

    // Scale down
    pool.scale(5).await;
    tokio::time::sleep(Duration::from_millis(50)).await;

    assert!(pool.total_size() <= initial_size);
}

#[tokio::test]
async fn test_pool_connection_failure() {
    let config = PoolConfig::default();
    let factory = Arc::new(TestConnectionFactory::new());
    let pool = ConnectionPool::new(config, factory.clone());

    factory.set_fail_next(true);

    let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
    let result = pool.acquire(addr).await;

    assert!(result.is_err());

    let metrics = pool.get_metrics();
    assert_eq!(metrics.failures, 1);
}

#[tokio::test]
async fn test_lru_cache_basic() {
    let mut cache: LRUCache<String, String> = LRUCache::new(3);

    cache.put("key1".to_string(), "value1".to_string());
    cache.put("key2".to_string(), "value2".to_string());
    cache.put("key3".to_string(), "value3".to_string());

    assert_eq!(cache.get(&"key1".to_string()), Some(&"value1".to_string()));
    assert_eq!(cache.len(), 3);
}

#[tokio::test]
async fn test_lru_cache_eviction() {
    let mut cache: LRUCache<String, String> = LRUCache::new(2);

    cache.put("key1".to_string(), "value1".to_string());
    cache.put("key2".to_string(), "value2".to_string());
    cache.put("key3".to_string(), "value3".to_string());

    // key1 should be evicted
    assert_eq!(cache.get(&"key1".to_string()), None);
    assert_eq!(cache.get(&"key2".to_string()), Some(&"value2".to_string()));
    assert_eq!(cache.get(&"key3".to_string()), Some(&"value3".to_string()));
}

#[tokio::test]
async fn test_lru_cache_metrics() {
    let mut cache: LRUCache<String, String> = LRUCache::new(10);

    cache.put("key1".to_string(), "value1".to_string());
    let _ = cache.get(&"key1".to_string()); // Hit
    let _ = cache.get(&"key2".to_string()); // Miss

    let metrics = cache.get_metrics();
    assert_eq!(metrics.hits, 1);
    assert_eq!(metrics.misses, 1);
    assert_eq!(metrics.hit_rate, 0.5);
}

#[tokio::test]
async fn test_health_monitor_check() {
    let factory = Arc::new(TestConnectionFactory::new());
    let config = MonitorConfig::default();
    let monitor = HealthMonitor::new(config, factory);

    let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
    let conn = PooledConnection::new("test-conn".to_string(), addr);

    let status = monitor.check_connection(&conn).await;
    assert_eq!(status, HealthStatus::Healthy);
}

#[tokio::test]
async fn test_health_monitor_unhealthy_detection() {
    let factory = Arc::new(TestConnectionFactory::new());
    factory.set_health_check_fails(true);

    let config = MonitorConfig::default();
    let monitor = HealthMonitor::new(config, factory);

    let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
    let conn = PooledConnection::new("test-conn".to_string(), addr);

    let status = monitor.check_connection(&conn).await;
    assert_eq!(status, HealthStatus::Unhealthy);
}

#[tokio::test]
async fn test_pool_shutdown() {
    let config = PoolConfig::default();
    let factory = Arc::new(TestConnectionFactory::new());
    let pool = Arc::new(ConnectionPool::new(config, factory));

    // Create some connections
    let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
    let conn = pool.acquire(addr).await.unwrap();
    pool.release(conn).await;

    // Shutdown
    pool.shutdown().await;

    assert_eq!(pool.total_size(), 0);
}

#[tokio::test]
async fn test_pool_idle_timeout() {
    let config = PoolConfig {
        idle_timeout: Duration::from_millis(50),
        health_check_interval: Duration::from_millis(100),
        ..Default::default()
    };
    let factory = Arc::new(TestConnectionFactory::new());
    let pool = ConnectionPool::new(config, factory);

    let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
    let conn = pool.acquire(addr).await.unwrap();
    pool.release(conn).await;

    // Wait for idle timeout
    tokio::time::sleep(Duration::from_millis(150)).await;

    // Health check should remove idle connections
    let _ = pool.health_check().await;

    let metrics = pool.get_metrics();
    assert_eq!(metrics.idle_connections, 0);
}
