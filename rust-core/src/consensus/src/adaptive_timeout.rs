use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use parking_lot::RwLock;

/// Tracks latency percentiles for dynamic timeout calculation
#[derive(Debug)]
pub struct PercentileTracker {
    samples: Vec<f64>,
    max_samples: usize,
    sorted: bool,
}

impl PercentileTracker {
    pub fn new(max_samples: usize) -> Self {
        Self {
            samples: Vec::with_capacity(max_samples),
            max_samples,
            sorted: true,
        }
    }

    pub fn record(&mut self, latency_ms: f64) {
        if self.samples.len() >= self.max_samples {
            // Remove oldest sample (simple ring buffer)
            self.samples.remove(0);
        }
        self.samples.push(latency_ms);
        self.sorted = false;
    }

    pub fn get_percentile(&mut self, percentile: f64) -> f64 {
        if self.samples.is_empty() {
            return 0.0;
        }

        if !self.sorted {
            self.samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
            self.sorted = true;
        }

        let index = ((self.samples.len() as f64 - 1.0) * percentile / 100.0) as usize;
        self.samples[index]
    }

    pub fn get_p50(&mut self) -> f64 {
        self.get_percentile(50.0)
    }

    pub fn get_p95(&mut self) -> f64 {
        self.get_percentile(95.0)
    }

    pub fn get_p99(&mut self) -> f64 {
        self.get_percentile(99.0)
    }

    pub fn mean(&self) -> f64 {
        if self.samples.is_empty() {
            return 0.0;
        }
        self.samples.iter().sum::<f64>() / self.samples.len() as f64
    }

    pub fn sample_count(&self) -> usize {
        self.samples.len()
    }
}

/// Configuration for adaptive timeout
#[derive(Debug, Clone)]
pub struct AdaptiveTimeoutConfig {
    /// Base timeout duration as fallback
    pub base_timeout: Duration,
    /// Percentile to use for timeout calculation (95 or 99)
    pub percentile: f64,
    /// Multiplier applied to percentile value
    pub multiplier: f64,
    /// Minimum timeout to prevent too aggressive values
    pub min_timeout: Duration,
    /// Maximum timeout to prevent too conservative values
    pub max_timeout: Duration,
    /// Maximum number of samples to track per peer
    pub max_samples: usize,
}

impl Default for AdaptiveTimeoutConfig {
    fn default() -> Self {
        Self {
            base_timeout: Duration::from_secs(10),
            percentile: 99.0,
            multiplier: 2.0, // 2x P99 latency
            min_timeout: Duration::from_millis(100),
            max_timeout: Duration::from_secs(30),
            max_samples: 100,
        }
    }
}

/// Adaptive timeout calculator that adjusts based on observed latencies
pub struct AdaptiveTimeout {
    config: AdaptiveTimeoutConfig,
    peer_trackers: Arc<RwLock<HashMap<String, PercentileTracker>>>,
}

impl AdaptiveTimeout {
    pub fn new(config: AdaptiveTimeoutConfig) -> Self {
        Self {
            config,
            peer_trackers: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Calculate timeout for a specific peer based on historical latency
    pub fn calculate_timeout(&self, peer_id: &str) -> Duration {
        let mut trackers = self.peer_trackers.write();

        if let Some(tracker) = trackers.get_mut(peer_id) {
            if tracker.sample_count() < 10 {
                // Not enough samples, use base timeout
                return self.config.base_timeout;
            }

            let percentile_ms = tracker.get_percentile(self.config.percentile);
            let timeout_ms = percentile_ms * self.config.multiplier;

            let timeout = Duration::from_millis(timeout_ms as u64);

            // Clamp to min/max bounds
            self.clamp_timeout(timeout)
        } else {
            // No data for this peer, use base timeout
            self.config.base_timeout
        }
    }

    /// Record a latency sample for a peer
    pub fn record_latency(&self, peer_id: &str, latency: Duration) {
        let latency_ms = latency.as_millis() as f64;

        let mut trackers = self.peer_trackers.write();
        trackers
            .entry(peer_id.to_string())
            .or_insert_with(|| PercentileTracker::new(self.config.max_samples))
            .record(latency_ms);
    }

    /// Get latency statistics for a peer
    pub fn get_latency_stats(&self, peer_id: &str) -> Option<LatencyStats> {
        let mut trackers = self.peer_trackers.write();

        trackers.get_mut(peer_id).map(|tracker| {
            LatencyStats {
                mean_ms: tracker.mean(),
                p50_ms: tracker.get_p50(),
                p95_ms: tracker.get_p95(),
                p99_ms: tracker.get_p99(),
                sample_count: tracker.sample_count(),
            }
        })
    }

    /// Get current timeout configuration
    pub fn config(&self) -> &AdaptiveTimeoutConfig {
        &self.config
    }

    /// Update configuration
    pub fn update_config(&mut self, config: AdaptiveTimeoutConfig) {
        self.config = config;
    }

    /// Clear all latency history
    pub fn clear_history(&self) {
        self.peer_trackers.write().clear();
    }

    /// Clear history for a specific peer
    pub fn clear_peer_history(&self, peer_id: &str) {
        self.peer_trackers.write().remove(peer_id);
    }

    fn clamp_timeout(&self, timeout: Duration) -> Duration {
        if timeout < self.config.min_timeout {
            self.config.min_timeout
        } else if timeout > self.config.max_timeout {
            self.config.max_timeout
        } else {
            timeout
        }
    }
}

#[derive(Debug, Clone)]
pub struct LatencyStats {
    pub mean_ms: f64,
    pub p50_ms: f64,
    pub p95_ms: f64,
    pub p99_ms: f64,
    pub sample_count: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_percentile_tracker() {
        let mut tracker = PercentileTracker::new(100);

        // Add samples
        for i in 1..=100 {
            tracker.record(i as f64);
        }

        assert_eq!(tracker.sample_count(), 100);
        assert!((tracker.get_p50() - 50.0).abs() < 1.0);
        assert!((tracker.get_p95() - 95.0).abs() < 1.0);
        assert!((tracker.get_p99() - 99.0).abs() < 1.0);
    }

    #[test]
    fn test_percentile_tracker_mean() {
        let mut tracker = PercentileTracker::new(100);

        tracker.record(10.0);
        tracker.record(20.0);
        tracker.record(30.0);

        assert_eq!(tracker.mean(), 20.0);
    }

    #[test]
    fn test_adaptive_timeout_no_data() {
        let timeout = AdaptiveTimeout::new(AdaptiveTimeoutConfig::default());

        // Should return base timeout when no data
        let calculated = timeout.calculate_timeout("unknown-peer");
        assert_eq!(calculated, Duration::from_secs(10));
    }

    #[test]
    fn test_adaptive_timeout_with_data() {
        let timeout = AdaptiveTimeout::new(AdaptiveTimeoutConfig {
            base_timeout: Duration::from_secs(5),
            percentile: 95.0,
            multiplier: 2.0,
            min_timeout: Duration::from_millis(100),
            max_timeout: Duration::from_secs(30),
            max_samples: 100,
        });

        // Record some latencies
        for _ in 0..20 {
            timeout.record_latency("peer1", Duration::from_millis(100));
        }

        let calculated = timeout.calculate_timeout("peer1");

        // Should be around 2x P95 (which is ~100ms) = 200ms
        assert!(calculated >= Duration::from_millis(100));
        assert!(calculated <= Duration::from_millis(300));
    }

    #[test]
    fn test_adaptive_timeout_clamping() {
        let timeout = AdaptiveTimeout::new(AdaptiveTimeoutConfig {
            base_timeout: Duration::from_secs(5),
            percentile: 99.0,
            multiplier: 2.0,
            min_timeout: Duration::from_millis(500),
            max_timeout: Duration::from_secs(2),
            max_samples: 100,
        });

        // Record very low latencies
        for _ in 0..20 {
            timeout.record_latency("peer1", Duration::from_millis(10));
        }

        let calculated = timeout.calculate_timeout("peer1");
        // Should be clamped to min
        assert!(calculated >= Duration::from_millis(500));

        // Record very high latencies
        for _ in 0..20 {
            timeout.record_latency("peer2", Duration::from_secs(10));
        }

        let calculated = timeout.calculate_timeout("peer2");
        // Should be clamped to max
        assert!(calculated <= Duration::from_secs(2));
    }

    #[test]
    fn test_latency_stats() {
        let timeout = AdaptiveTimeout::new(AdaptiveTimeoutConfig::default());

        for i in 1..=100 {
            timeout.record_latency("peer1", Duration::from_millis(i));
        }

        let stats = timeout.get_latency_stats("peer1").unwrap();
        assert_eq!(stats.sample_count, 100);
        assert!((stats.mean_ms - 50.5).abs() < 1.0);
        assert!(stats.p99_ms > 95.0);
    }

    #[test]
    fn test_clear_history() {
        let timeout = AdaptiveTimeout::new(AdaptiveTimeoutConfig::default());

        timeout.record_latency("peer1", Duration::from_millis(100));
        timeout.record_latency("peer2", Duration::from_millis(100));

        assert!(timeout.get_latency_stats("peer1").is_some());
        assert!(timeout.get_latency_stats("peer2").is_some());

        timeout.clear_peer_history("peer1");
        assert!(timeout.get_latency_stats("peer1").is_none());
        assert!(timeout.get_latency_stats("peer2").is_some());

        timeout.clear_history();
        assert!(timeout.get_latency_stats("peer2").is_none());
    }
}
