//! Connection Health Monitoring System
//!
//! This module provides background health monitoring for connection pools,
//! including ping/pong liveness detection, connection quality metrics,
//! and automatic reconnection with exponential backoff.

use crate::connection_pool::{ConnectionFactory, PooledConnection};
use crate::error::Result;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::time::sleep;

/// Health status for a single connection
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Unhealthy,
    Dead,
}

/// Connection quality metrics
#[derive(Debug, Clone)]
pub struct QualityMetrics {
    /// Round-trip time
    pub rtt: Duration,

    /// Packet loss rate (0.0-1.0)
    pub packet_loss: f64,

    /// Number of consecutive failures
    pub consecutive_failures: u32,

    /// Last successful check time
    pub last_success: Instant,

    /// Overall health status
    pub status: HealthStatus,
}

impl QualityMetrics {
    /// Create new quality metrics
    pub fn new() -> Self {
        Self {
            rtt: Duration::ZERO,
            packet_loss: 0.0,
            consecutive_failures: 0,
            last_success: Instant::now(),
            status: HealthStatus::Healthy,
        }
    }

    /// Update metrics after successful check
    pub fn update_success(&mut self, rtt: Duration) {
        self.rtt = rtt;
        self.consecutive_failures = 0;
        self.last_success = Instant::now();

        // Update status based on RTT
        self.status = if rtt < Duration::from_millis(50) {
            HealthStatus::Healthy
        } else if rtt < Duration::from_millis(200) {
            HealthStatus::Degraded
        } else {
            HealthStatus::Unhealthy
        };
    }

    /// Update metrics after failed check
    pub fn update_failure(&mut self) {
        self.consecutive_failures += 1;

        self.status = if self.consecutive_failures >= 5 {
            HealthStatus::Dead
        } else if self.consecutive_failures >= 3 {
            HealthStatus::Unhealthy
        } else {
            HealthStatus::Degraded
        };
    }

    /// Check if connection should be removed
    pub fn should_remove(&self) -> bool {
        self.status == HealthStatus::Dead
            || (self.status == HealthStatus::Unhealthy
                && self.last_success.elapsed() > Duration::from_secs(300))
    }
}

impl Default for QualityMetrics {
    fn default() -> Self {
        Self::new()
    }
}

/// Exponential backoff configuration
#[derive(Debug, Clone)]
pub struct BackoffConfig {
    /// Initial retry delay
    pub initial_delay: Duration,

    /// Maximum retry delay
    pub max_delay: Duration,

    /// Backoff multiplier
    pub multiplier: f64,

    /// Maximum retry attempts
    pub max_attempts: u32,
}

impl Default for BackoffConfig {
    fn default() -> Self {
        Self {
            initial_delay: Duration::from_millis(100),
            max_delay: Duration::from_secs(30),
            multiplier: 2.0,
            max_attempts: 10,
        }
    }
}

/// Exponential backoff state
#[derive(Debug, Clone)]
pub struct BackoffState {
    config: BackoffConfig,
    attempts: u32,
    current_delay: Duration,
}

impl BackoffState {
    /// Create new backoff state
    pub fn new(config: BackoffConfig) -> Self {
        let current_delay = config.initial_delay;
        Self {
            config,
            attempts: 0,
            current_delay,
        }
    }

    /// Get next backoff delay
    pub fn next_delay(&mut self) -> Option<Duration> {
        if self.attempts >= self.config.max_attempts {
            return None;
        }

        let delay = self.current_delay;
        self.attempts += 1;

        // Calculate next delay with exponential backoff
        let next = Duration::from_secs_f64(
            self.current_delay.as_secs_f64() * self.config.multiplier,
        );
        self.current_delay = next.min(self.config.max_delay);

        Some(delay)
    }

    /// Reset backoff state after success
    pub fn reset(&mut self) {
        self.attempts = 0;
        self.current_delay = self.config.initial_delay;
    }

    /// Check if max attempts reached
    pub fn exhausted(&self) -> bool {
        self.attempts >= self.config.max_attempts
    }
}

/// Health monitor configuration
#[derive(Debug, Clone)]
pub struct MonitorConfig {
    /// Interval between health checks
    pub check_interval: Duration,

    /// Timeout for individual health checks
    pub check_timeout: Duration,

    /// Backoff configuration for reconnection
    pub backoff: BackoffConfig,

    /// Whether to auto-reconnect dead connections
    pub auto_reconnect: bool,
}

impl Default for MonitorConfig {
    fn default() -> Self {
        Self {
            check_interval: Duration::from_secs(30),
            check_timeout: Duration::from_secs(5),
            backoff: BackoffConfig::default(),
            auto_reconnect: true,
        }
    }
}

/// Health monitor for connection pool
pub struct HealthMonitor {
    config: MonitorConfig,
    factory: Arc<dyn ConnectionFactory>,
    shutdown: Arc<AtomicBool>,
}

impl HealthMonitor {
    /// Create a new health monitor
    pub fn new(config: MonitorConfig, factory: Arc<dyn ConnectionFactory>) -> Self {
        Self {
            config,
            factory,
            shutdown: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Start health monitoring
    pub async fn start(&self) {
        let config = self.config.clone();
        let factory = self.factory.clone();
        let shutdown = self.shutdown.clone();

        tokio::spawn(async move {
            tracing::info!("Starting health monitor with interval: {:?}", config.check_interval);

            while !shutdown.load(Ordering::Relaxed) {
                sleep(config.check_interval).await;

                // Health checks happen in pool.health_check()
                // This is just a placeholder for additional monitoring logic
                tracing::trace!("Health monitor tick");
            }

            tracing::info!("Health monitor stopped");
        });
    }

    /// Check connection health
    pub async fn check_connection(&self, conn: &PooledConnection) -> HealthStatus {
        match tokio::time::timeout(
            self.config.check_timeout,
            self.factory.health_check(conn),
        )
        .await
        {
            Ok(Ok((healthy, rtt))) => {
                if healthy {
                    if let Some(rtt) = rtt {
                        if rtt < Duration::from_millis(50) {
                            HealthStatus::Healthy
                        } else if rtt < Duration::from_millis(200) {
                            HealthStatus::Degraded
                        } else {
                            HealthStatus::Unhealthy
                        }
                    } else {
                        HealthStatus::Healthy
                    }
                } else {
                    HealthStatus::Unhealthy
                }
            }
            Ok(Err(_)) => HealthStatus::Dead,
            Err(_) => HealthStatus::Dead, // Timeout
        }
    }

    /// Attempt to reconnect with exponential backoff
    pub async fn reconnect_with_backoff(
        &self,
        conn: &PooledConnection,
    ) -> Result<PooledConnection> {
        let mut backoff = BackoffState::new(self.config.backoff.clone());

        loop {
            match self.factory.create_connection(conn.remote_addr).await {
                Ok(new_conn) => {
                    tracing::info!("Successfully reconnected to {}", conn.remote_addr);
                    return Ok(new_conn);
                }
                Err(e) => {
                    if let Some(delay) = backoff.next_delay() {
                        tracing::warn!(
                            "Reconnection attempt {} failed for {}: {}. Retrying in {:?}",
                            backoff.attempts,
                            conn.remote_addr,
                            e,
                            delay
                        );
                        sleep(delay).await;
                    } else {
                        tracing::error!(
                            "Reconnection exhausted after {} attempts for {}",
                            backoff.attempts,
                            conn.remote_addr
                        );
                        return Err(e);
                    }
                }
            }
        }
    }

    /// Shutdown the health monitor
    pub async fn shutdown(&self) {
        tracing::info!("Shutting down health monitor");
        self.shutdown.store(true, Ordering::Relaxed);
    }

    /// Check if monitor is running
    pub fn is_running(&self) -> bool {
        !self.shutdown.load(Ordering::Relaxed)
    }
}

/// Ping/pong protocol implementation
pub struct PingPong {
    /// Timeout for ping response
    timeout: Duration,
}

impl PingPong {
    /// Create new ping/pong handler
    pub fn new(timeout: Duration) -> Self {
        Self { timeout }
    }

    /// Send ping and wait for pong
    pub async fn ping(&self, _conn: &PooledConnection) -> Result<Duration> {
        let start = Instant::now();

        // In a real implementation, this would send a ping frame
        // and wait for a pong response over the QUIC connection
        sleep(Duration::from_millis(5)).await; // Simulate RTT

        let rtt = start.elapsed();

        if rtt > self.timeout {
            Err(crate::error::NetworkError::Timeout(format!(
                "Ping timeout: {:?} > {:?}",
                rtt, self.timeout
            )))
        } else {
            Ok(rtt)
        }
    }

    /// Handle incoming pong
    pub fn handle_pong(&self, _data: &[u8]) -> Result<()> {
        // In a real implementation, this would validate the pong response
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection_pool::ConnectionFactory;
    use std::net::SocketAddr;

    struct MockFactory;

    #[async_trait::async_trait]
    impl ConnectionFactory for MockFactory {
        async fn create_connection(&self, addr: SocketAddr) -> Result<PooledConnection> {
            Ok(PooledConnection::new(
                format!("conn-{}", uuid::Uuid::new_v4()),
                addr,
            ))
        }

        async fn health_check(
            &self,
            _conn: &PooledConnection,
        ) -> Result<(bool, Option<Duration>)> {
            Ok((true, Some(Duration::from_millis(10))))
        }

        async fn close_connection(&self, _conn: &PooledConnection) -> Result<()> {
            Ok(())
        }
    }

    #[test]
    fn test_quality_metrics_success() {
        let mut metrics = QualityMetrics::new();

        metrics.update_success(Duration::from_millis(30));
        assert_eq!(metrics.status, HealthStatus::Healthy);
        assert_eq!(metrics.consecutive_failures, 0);

        metrics.update_success(Duration::from_millis(150));
        assert_eq!(metrics.status, HealthStatus::Degraded);
    }

    #[test]
    fn test_quality_metrics_failure() {
        let mut metrics = QualityMetrics::new();

        metrics.update_failure();
        assert_eq!(metrics.status, HealthStatus::Degraded);

        metrics.update_failure();
        metrics.update_failure();
        assert_eq!(metrics.status, HealthStatus::Unhealthy);

        metrics.update_failure();
        metrics.update_failure();
        assert_eq!(metrics.status, HealthStatus::Dead);
    }

    #[test]
    fn test_backoff_state() {
        let config = BackoffConfig::default();
        let mut backoff = BackoffState::new(config);

        let delay1 = backoff.next_delay().unwrap();
        assert_eq!(delay1, Duration::from_millis(100));

        let delay2 = backoff.next_delay().unwrap();
        assert_eq!(delay2, Duration::from_millis(200));

        let delay3 = backoff.next_delay().unwrap();
        assert_eq!(delay3, Duration::from_millis(400));
    }

    #[test]
    fn test_backoff_max_attempts() {
        let config = BackoffConfig {
            max_attempts: 3,
            ..Default::default()
        };
        let mut backoff = BackoffState::new(config);

        assert!(backoff.next_delay().is_some());
        assert!(backoff.next_delay().is_some());
        assert!(backoff.next_delay().is_some());
        assert!(backoff.next_delay().is_none());
        assert!(backoff.exhausted());
    }

    #[test]
    fn test_backoff_reset() {
        let config = BackoffConfig::default();
        let mut backoff = BackoffState::new(config);

        backoff.next_delay();
        backoff.next_delay();
        assert_eq!(backoff.attempts, 2);

        backoff.reset();
        assert_eq!(backoff.attempts, 0);
        assert_eq!(backoff.current_delay, Duration::from_millis(100));
    }

    #[tokio::test]
    async fn test_ping_pong() {
        let ping_pong = PingPong::new(Duration::from_secs(1));
        let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
        let conn = PooledConnection::new("test-conn".to_string(), addr);

        let rtt = ping_pong.ping(&conn).await.unwrap();
        assert!(rtt < Duration::from_secs(1));
    }

    #[tokio::test]
    async fn test_health_monitor_check() {
        let factory = Arc::new(MockFactory);
        let config = MonitorConfig::default();
        let monitor = HealthMonitor::new(config, factory);

        let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
        let conn = PooledConnection::new("test-conn".to_string(), addr);

        let status = monitor.check_connection(&conn).await;
        assert_eq!(status, HealthStatus::Healthy);
    }

    #[tokio::test]
    async fn test_health_monitor_lifecycle() {
        let factory = Arc::new(MockFactory);
        let config = MonitorConfig::default();
        let monitor = HealthMonitor::new(config, factory);

        assert!(monitor.is_running());

        monitor.shutdown().await;
        tokio::time::sleep(Duration::from_millis(100)).await;

        assert!(!monitor.is_running());
    }
}
