//! Prometheus metrics collection for policy engine observability

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

/// Engine performance metrics
#[derive(Debug, Clone, Default)]
pub struct EngineMetrics {
    /// Total number of authorization requests
    pub total_requests: u64,

    /// Number of allowed decisions
    pub allowed_decisions: u64,

    /// Number of denied decisions
    pub denied_decisions: u64,

    /// Cache hits
    pub cache_hits: u64,

    /// Cache misses
    pub cache_misses: u64,

    /// Latency histogram buckets (p50, p90, p95, p99, p99.9)
    pub latency_p50_ms: f64,
    pub latency_p90_ms: f64,
    pub latency_p95_ms: f64,
    pub latency_p99_ms: f64,
    pub latency_p999_ms: f64,

    /// Average latency
    pub avg_latency_ms: f64,

    /// Error count
    pub error_count: u64,
}

impl EngineMetrics {
    /// Calculate cache hit rate
    pub fn cache_hit_rate(&self) -> f64 {
        let total = self.cache_hits + self.cache_misses;
        if total == 0 {
            0.0
        } else {
            self.cache_hits as f64 / total as f64
        }
    }

    /// Calculate allow rate
    pub fn allow_rate(&self) -> f64 {
        let total = self.allowed_decisions + self.denied_decisions;
        if total == 0 {
            0.0
        } else {
            self.allowed_decisions as f64 / total as f64
        }
    }
}

/// Metrics collector with Prometheus-compatible storage
pub struct MetricsCollector {
    /// Metrics data
    metrics: Arc<RwLock<EngineMetrics>>,

    /// Latency samples for percentile calculation (ring buffer)
    latency_samples: Arc<RwLock<Vec<f64>>>,

    /// Maximum samples to keep
    max_samples: usize,
}

impl MetricsCollector {
    /// Create a new metrics collector
    pub fn new() -> Self {
        Self {
            metrics: Arc::new(RwLock::new(EngineMetrics::default())),
            latency_samples: Arc::new(RwLock::new(Vec::with_capacity(10_000))),
            max_samples: 10_000,
        }
    }

    /// Record a cache hit
    pub async fn record_cache_hit(&self) {
        let mut metrics = self.metrics.write().await;
        metrics.cache_hits += 1;
    }

    /// Record a cache miss
    pub async fn record_cache_miss(&self) {
        let mut metrics = self.metrics.write().await;
        metrics.cache_misses += 1;
    }

    /// Record an authorization decision
    pub async fn record_decision(&self, allowed: bool) {
        let mut metrics = self.metrics.write().await;
        metrics.total_requests += 1;

        if allowed {
            metrics.allowed_decisions += 1;
        } else {
            metrics.denied_decisions += 1;
        }
    }

    /// Record request latency
    pub async fn record_latency(&self, latency: Duration) {
        let latency_ms = latency.as_secs_f64() * 1000.0;

        // Add to samples
        let mut samples = self.latency_samples.write().await;
        samples.push(latency_ms);

        // Keep only recent samples
        if samples.len() > self.max_samples {
            samples.drain(0..1_000);
        }

        // Update metrics
        let mut metrics = self.metrics.write().await;

        // Calculate average
        let sum: f64 = samples.iter().sum();
        metrics.avg_latency_ms = sum / samples.len() as f64;

        // Calculate percentiles
        let mut sorted = samples.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());

        metrics.latency_p50_ms = Self::percentile(&sorted, 0.50);
        metrics.latency_p90_ms = Self::percentile(&sorted, 0.90);
        metrics.latency_p95_ms = Self::percentile(&sorted, 0.95);
        metrics.latency_p99_ms = Self::percentile(&sorted, 0.99);
        metrics.latency_p999_ms = Self::percentile(&sorted, 0.999);
    }

    /// Record an error
    pub async fn record_error(&self) {
        let mut metrics = self.metrics.write().await;
        metrics.error_count += 1;
    }

    /// Get current metrics snapshot
    pub async fn get_metrics(&self) -> EngineMetrics {
        self.metrics.read().await.clone()
    }

    /// Reset all metrics
    pub async fn reset(&self) {
        let mut metrics = self.metrics.write().await;
        *metrics = EngineMetrics::default();

        let mut samples = self.latency_samples.write().await;
        samples.clear();
    }

    /// Export metrics in Prometheus format
    pub async fn export_prometheus(&self) -> String {
        let metrics = self.metrics.read().await;

        format!(
            r#"# HELP authz_requests_total Total number of authorization requests
# TYPE authz_requests_total counter
authz_requests_total {}

# HELP authz_allowed_total Number of allowed decisions
# TYPE authz_allowed_total counter
authz_allowed_total {}

# HELP authz_denied_total Number of denied decisions
# TYPE authz_denied_total counter
authz_denied_total {}

# HELP authz_cache_hits_total Cache hits
# TYPE authz_cache_hits_total counter
authz_cache_hits_total {}

# HELP authz_cache_misses_total Cache misses
# TYPE authz_cache_misses_total counter
authz_cache_misses_total {}

# HELP authz_latency_seconds Request latency percentiles
# TYPE authz_latency_seconds summary
authz_latency_seconds{{quantile="0.5"}} {}
authz_latency_seconds{{quantile="0.9"}} {}
authz_latency_seconds{{quantile="0.95"}} {}
authz_latency_seconds{{quantile="0.99"}} {}
authz_latency_seconds{{quantile="0.999"}} {}

# HELP authz_errors_total Error count
# TYPE authz_errors_total counter
authz_errors_total {}
"#,
            metrics.total_requests,
            metrics.allowed_decisions,
            metrics.denied_decisions,
            metrics.cache_hits,
            metrics.cache_misses,
            metrics.latency_p50_ms / 1000.0,
            metrics.latency_p90_ms / 1000.0,
            metrics.latency_p95_ms / 1000.0,
            metrics.latency_p99_ms / 1000.0,
            metrics.latency_p999_ms / 1000.0,
            metrics.error_count,
        )
    }

    /// Calculate percentile from sorted data
    fn percentile(sorted: &[f64], p: f64) -> f64 {
        if sorted.is_empty() {
            return 0.0;
        }

        let idx = ((sorted.len() as f64) * p) as usize;
        let idx = idx.min(sorted.len() - 1);
        sorted[idx]
    }
}

impl Default for MetricsCollector {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_metrics_creation() {
        let collector = MetricsCollector::new();
        let metrics = collector.get_metrics().await;

        assert_eq!(metrics.total_requests, 0);
        assert_eq!(metrics.cache_hits, 0);
    }

    #[tokio::test]
    async fn test_record_decision() {
        let collector = MetricsCollector::new();

        collector.record_decision(true).await;
        collector.record_decision(false).await;
        collector.record_decision(true).await;

        let metrics = collector.get_metrics().await;
        assert_eq!(metrics.total_requests, 3);
        assert_eq!(metrics.allowed_decisions, 2);
        assert_eq!(metrics.denied_decisions, 1);
    }

    #[tokio::test]
    async fn test_record_cache() {
        let collector = MetricsCollector::new();

        collector.record_cache_hit().await;
        collector.record_cache_hit().await;
        collector.record_cache_miss().await;

        let metrics = collector.get_metrics().await;
        assert_eq!(metrics.cache_hits, 2);
        assert_eq!(metrics.cache_misses, 1);
        assert!((metrics.cache_hit_rate() - 0.666).abs() < 0.01);
    }

    #[tokio::test]
    async fn test_record_latency() {
        let collector = MetricsCollector::new();

        collector.record_latency(Duration::from_millis(5)).await;
        collector.record_latency(Duration::from_millis(10)).await;
        collector.record_latency(Duration::from_millis(15)).await;

        let metrics = collector.get_metrics().await;
        assert!((metrics.avg_latency_ms - 10.0).abs() < 1.0);
        assert!(metrics.latency_p50_ms > 0.0);
        assert!(metrics.latency_p99_ms > 0.0);
    }

    #[tokio::test]
    async fn test_prometheus_export() {
        let collector = MetricsCollector::new();

        collector.record_decision(true).await;
        collector.record_latency(Duration::from_millis(5)).await;

        let prometheus = collector.export_prometheus().await;
        assert!(prometheus.contains("authz_requests_total 1"));
        assert!(prometheus.contains("authz_allowed_total 1"));
    }

    #[tokio::test]
    async fn test_reset() {
        let collector = MetricsCollector::new();

        collector.record_decision(true).await;
        collector.record_cache_hit().await;

        collector.reset().await;

        let metrics = collector.get_metrics().await;
        assert_eq!(metrics.total_requests, 0);
        assert_eq!(metrics.cache_hits, 0);
    }
}
