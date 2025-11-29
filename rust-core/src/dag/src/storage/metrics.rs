//! Prometheus metrics for Phase 6 storage
//!
//! Exposes storage metrics for monitoring:
//! - Write/read latency (p50, p95, p99)
//! - Throughput (vertices/sec)
//! - Database size
//! - Cache hit rate
//! - Compaction stats

use crate::storage::rocksdb::StorageMetrics;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

/// Prometheus-compatible metrics collector
pub struct PrometheusMetrics {
    // Counters
    pub vertices_stored_total: AtomicU64,
    pub vertices_read_total: AtomicU64,
    pub vertices_finalized_total: AtomicU64,
    pub cache_hits_total: AtomicU64,
    pub cache_misses_total: AtomicU64,

    // Histograms (simplified - use prometheus crate for full implementation)
    pub write_latency_ms: Arc<LatencyHistogram>,
    pub read_latency_ms: Arc<LatencyHistogram>,

    // Gauges
    pub db_size_bytes: AtomicU64,
    pub cache_size: AtomicU64,
}

/// Simple latency histogram for metrics
pub struct LatencyHistogram {
    samples: std::sync::Mutex<Vec<f64>>,
}

impl LatencyHistogram {
    pub fn new() -> Self {
        Self {
            samples: std::sync::Mutex::new(Vec::new()),
        }
    }

    pub fn observe(&self, value: f64) {
        if let Ok(mut samples) = self.samples.lock() {
            samples.push(value);

            // Keep only last 10,000 samples for memory efficiency
            if samples.len() > 10_000 {
                samples.remove(0);
            }
        }
    }

    pub fn percentile(&self, p: f64) -> f64 {
        let samples = self.samples.lock().unwrap();
        if samples.is_empty() {
            return 0.0;
        }

        let mut sorted = samples.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());

        let index = ((sorted.len() as f64 - 1.0) * p) as usize;
        sorted[index]
    }

    pub fn mean(&self) -> f64 {
        let samples = self.samples.lock().unwrap();
        if samples.is_empty() {
            return 0.0;
        }

        let sum: f64 = samples.iter().sum();
        sum / samples.len() as f64
    }

    pub fn count(&self) -> usize {
        self.samples.lock().unwrap().len()
    }
}

impl Default for PrometheusMetrics {
    fn default() -> Self {
        Self::new()
    }
}

impl PrometheusMetrics {
    pub fn new() -> Self {
        Self {
            vertices_stored_total: AtomicU64::new(0),
            vertices_read_total: AtomicU64::new(0),
            vertices_finalized_total: AtomicU64::new(0),
            cache_hits_total: AtomicU64::new(0),
            cache_misses_total: AtomicU64::new(0),
            write_latency_ms: Arc::new(LatencyHistogram::new()),
            read_latency_ms: Arc::new(LatencyHistogram::new()),
            db_size_bytes: AtomicU64::new(0),
            cache_size: AtomicU64::new(0),
        }
    }

    /// Update metrics from storage stats
    pub fn update_from_storage_metrics(&self, metrics: &StorageMetrics) {
        self.vertices_stored_total.store(metrics.vertices_stored, Ordering::Relaxed);
        self.vertices_read_total.store(metrics.vertices_read, Ordering::Relaxed);
        self.vertices_finalized_total.store(metrics.vertices_finalized, Ordering::Relaxed);
        self.cache_hits_total.store(metrics.cache_hits, Ordering::Relaxed);
        self.cache_misses_total.store(metrics.cache_misses, Ordering::Relaxed);
        self.db_size_bytes.store(metrics.db_size_bytes, Ordering::Relaxed);

        self.write_latency_ms.observe(metrics.write_latency_ms);
        self.read_latency_ms.observe(metrics.read_latency_ms);
    }

    /// Export metrics in Prometheus text format
    pub fn export_prometheus_text(&self) -> String {
        let mut output = String::new();

        // Counters
        output.push_str(&format!(
            "# HELP cretoai_storage_vertices_stored_total Total number of vertices stored\n\
             # TYPE cretoai_storage_vertices_stored_total counter\n\
             cretoai_storage_vertices_stored_total {}\n\n",
            self.vertices_stored_total.load(Ordering::Relaxed)
        ));

        output.push_str(&format!(
            "# HELP cretoai_storage_vertices_read_total Total number of vertices read\n\
             # TYPE cretoai_storage_vertices_read_total counter\n\
             cretoai_storage_vertices_read_total {}\n\n",
            self.vertices_read_total.load(Ordering::Relaxed)
        ));

        output.push_str(&format!(
            "# HELP cretoai_storage_vertices_finalized_total Total number of vertices finalized\n\
             # TYPE cretoai_storage_vertices_finalized_total counter\n\
             cretoai_storage_vertices_finalized_total {}\n\n",
            self.vertices_finalized_total.load(Ordering::Relaxed)
        ));

        // Cache metrics
        let cache_hits = self.cache_hits_total.load(Ordering::Relaxed) as f64;
        let cache_misses = self.cache_misses_total.load(Ordering::Relaxed) as f64;
        let cache_total = cache_hits + cache_misses;
        let cache_hit_rate = if cache_total > 0.0 {
            cache_hits / cache_total
        } else {
            0.0
        };

        output.push_str(&format!(
            "# HELP cretoai_storage_cache_hit_rate Cache hit rate (0-1)\n\
             # TYPE cretoai_storage_cache_hit_rate gauge\n\
             cretoai_storage_cache_hit_rate {:.4}\n\n",
            cache_hit_rate
        ));

        // Latency histograms
        output.push_str(&format!(
            "# HELP cretoai_storage_write_latency_ms Write latency in milliseconds\n\
             # TYPE cretoai_storage_write_latency_ms summary\n\
             cretoai_storage_write_latency_ms{{quantile=\"0.5\"}} {:.2}\n\
             cretoai_storage_write_latency_ms{{quantile=\"0.95\"}} {:.2}\n\
             cretoai_storage_write_latency_ms{{quantile=\"0.99\"}} {:.2}\n\
             cretoai_storage_write_latency_ms_sum {:.2}\n\
             cretoai_storage_write_latency_ms_count {}\n\n",
            self.write_latency_ms.percentile(0.5),
            self.write_latency_ms.percentile(0.95),
            self.write_latency_ms.percentile(0.99),
            self.write_latency_ms.mean() * self.write_latency_ms.count() as f64,
            self.write_latency_ms.count()
        ));

        output.push_str(&format!(
            "# HELP cretoai_storage_read_latency_ms Read latency in milliseconds\n\
             # TYPE cretoai_storage_read_latency_ms summary\n\
             cretoai_storage_read_latency_ms{{quantile=\"0.5\"}} {:.2}\n\
             cretoai_storage_read_latency_ms{{quantile=\"0.95\"}} {:.2}\n\
             cretoai_storage_read_latency_ms{{quantile=\"0.99\"}} {:.2}\n\
             cretoai_storage_read_latency_ms_sum {:.2}\n\
             cretoai_storage_read_latency_ms_count {}\n\n",
            self.read_latency_ms.percentile(0.5),
            self.read_latency_ms.percentile(0.95),
            self.read_latency_ms.percentile(0.99),
            self.read_latency_ms.mean() * self.read_latency_ms.count() as f64,
            self.read_latency_ms.count()
        ));

        // Database size
        output.push_str(&format!(
            "# HELP cretoai_storage_db_size_bytes Database size in bytes\n\
             # TYPE cretoai_storage_db_size_bytes gauge\n\
             cretoai_storage_db_size_bytes {}\n\n",
            self.db_size_bytes.load(Ordering::Relaxed)
        ));

        output
    }

    /// Get current metrics as JSON
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "counters": {
                "vertices_stored_total": self.vertices_stored_total.load(Ordering::Relaxed),
                "vertices_read_total": self.vertices_read_total.load(Ordering::Relaxed),
                "vertices_finalized_total": self.vertices_finalized_total.load(Ordering::Relaxed),
                "cache_hits_total": self.cache_hits_total.load(Ordering::Relaxed),
                "cache_misses_total": self.cache_misses_total.load(Ordering::Relaxed),
            },
            "latency": {
                "write_ms": {
                    "p50": self.write_latency_ms.percentile(0.5),
                    "p95": self.write_latency_ms.percentile(0.95),
                    "p99": self.write_latency_ms.percentile(0.99),
                    "mean": self.write_latency_ms.mean(),
                },
                "read_ms": {
                    "p50": self.read_latency_ms.percentile(0.5),
                    "p95": self.read_latency_ms.percentile(0.95),
                    "p99": self.read_latency_ms.percentile(0.99),
                    "mean": self.read_latency_ms.mean(),
                }
            },
            "database": {
                "size_bytes": self.db_size_bytes.load(Ordering::Relaxed),
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metrics_creation() {
        let metrics = PrometheusMetrics::new();
        assert_eq!(metrics.vertices_stored_total.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn test_latency_histogram() {
        let histogram = LatencyHistogram::new();

        for i in 1..=100 {
            histogram.observe(i as f64);
        }

        assert_eq!(histogram.count(), 100);
        assert!(histogram.mean() > 40.0 && histogram.mean() < 60.0);
        assert!(histogram.percentile(0.5) > 40.0);
        assert!(histogram.percentile(0.99) > 90.0);
    }

    #[test]
    fn test_prometheus_export() {
        let metrics = PrometheusMetrics::new();
        metrics.vertices_stored_total.store(100, Ordering::Relaxed);
        metrics.write_latency_ms.observe(5.0);
        metrics.write_latency_ms.observe(10.0);

        let output = metrics.export_prometheus_text();
        assert!(output.contains("cretoai_storage_vertices_stored_total 100"));
        assert!(output.contains("cretoai_storage_write_latency_ms"));
    }

    #[test]
    fn test_json_export() {
        let metrics = PrometheusMetrics::new();
        metrics.vertices_stored_total.store(42, Ordering::Relaxed);

        let json = metrics.to_json();
        assert_eq!(json["counters"]["vertices_stored_total"], 42);
    }
}
