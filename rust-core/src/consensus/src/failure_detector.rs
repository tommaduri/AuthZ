//! Phi Accrual Failure Detector
//!
//! Implements adaptive failure detection using the Phi Accrual algorithm
//! Based on Akka cluster failure detection with configurable suspicion thresholds

use crate::{NodeId, Result};
use dashmap::DashMap;
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use tracing::{debug, info, warn};

/// Phi Accrual Failure Detector configuration
#[derive(Debug, Clone)]
pub struct FailureDetectorConfig {
    /// Heartbeat interval (default: 1s)
    pub heartbeat_interval: Duration,

    /// Maximum number of samples to keep (default: 200)
    pub max_sample_size: usize,

    /// Minimum standard deviation to prevent division by zero (default: 100ms)
    pub min_std_deviation: Duration,

    /// Acceptable heartbeat pause before suspicion (default: 3s)
    pub acceptable_heartbeat_pause: Duration,

    /// Phi threshold for failure declaration (default: 8.0 = 99.9% confidence)
    pub phi_threshold: f64,

    /// First heartbeat timeout (default: 5s)
    pub first_heartbeat_timeout: Duration,
}

impl Default for FailureDetectorConfig {
    fn default() -> Self {
        Self {
            heartbeat_interval: Duration::from_secs(1),
            max_sample_size: 200,
            min_std_deviation: Duration::from_millis(100),
            acceptable_heartbeat_pause: Duration::from_secs(3),
            phi_threshold: 8.0, // 99.9% confidence
            first_heartbeat_timeout: Duration::from_secs(5),
        }
    }
}

/// Heartbeat history for a single node
#[derive(Debug, Clone)]
struct HeartbeatHistory {
    /// Timestamps of received heartbeats
    timestamps: VecDeque<Instant>,

    /// Calculated inter-arrival intervals
    intervals: VecDeque<Duration>,

    /// Last heartbeat time
    last_heartbeat: Instant,

    /// First heartbeat received time
    first_heartbeat: Instant,

    /// Number of heartbeats received
    heartbeat_count: u64,
}

impl HeartbeatHistory {
    fn new() -> Self {
        let now = Instant::now();
        Self {
            timestamps: VecDeque::new(),
            intervals: VecDeque::new(),
            last_heartbeat: now,
            first_heartbeat: now,
            heartbeat_count: 0,
        }
    }

    fn record(&mut self, timestamp: Instant, max_samples: usize) {
        self.heartbeat_count += 1;

        if self.heartbeat_count == 1 {
            self.first_heartbeat = timestamp;
        } else {
            // Calculate interval from last heartbeat
            let interval = timestamp.duration_since(self.last_heartbeat);
            self.intervals.push_back(interval);

            // Maintain max sample size
            if self.intervals.len() > max_samples {
                self.intervals.pop_front();
            }
        }

        self.timestamps.push_back(timestamp);
        if self.timestamps.len() > max_samples {
            self.timestamps.pop_front();
        }

        self.last_heartbeat = timestamp;
    }

    fn mean_interval(&self) -> Option<Duration> {
        if self.intervals.is_empty() {
            return None;
        }

        let sum: Duration = self.intervals.iter().sum();
        Some(sum / self.intervals.len() as u32)
    }

    fn variance(&self, mean: Duration) -> Option<Duration> {
        if self.intervals.len() < 2 {
            return None;
        }

        let mean_ms = mean.as_millis() as f64;
        let variance: f64 = self
            .intervals
            .iter()
            .map(|interval| {
                let diff = interval.as_millis() as f64 - mean_ms;
                diff * diff
            })
            .sum::<f64>()
            / (self.intervals.len() - 1) as f64;

        Some(Duration::from_millis(variance.sqrt() as u64))
    }
}

/// Phi Accrual Failure Detector
pub struct PhiAccrualFailureDetector {
    /// Heartbeat histories for all nodes
    heartbeat_history: Arc<DashMap<NodeId, HeartbeatHistory>>,

    /// Configuration
    config: FailureDetectorConfig,

    /// Suspected nodes
    suspected: Arc<DashMap<NodeId, SystemTime>>,

    /// Failed nodes
    failed: Arc<DashMap<NodeId, SystemTime>>,
}

impl PhiAccrualFailureDetector {
    /// Create a new failure detector
    pub fn new(config: FailureDetectorConfig) -> Self {
        info!(
            phi_threshold = config.phi_threshold,
            heartbeat_interval_ms = config.heartbeat_interval.as_millis(),
            "Initializing Phi Accrual Failure Detector"
        );

        Self {
            heartbeat_history: Arc::new(DashMap::new()),
            config,
            suspected: Arc::new(DashMap::new()),
            failed: Arc::new(DashMap::new()),
        }
    }

    /// Record a heartbeat from a node
    pub fn record_heartbeat(&self, node_id: NodeId) {
        let now = Instant::now();

        self.heartbeat_history
            .entry(node_id)
            .and_modify(|history| history.record(now, self.config.max_sample_size))
            .or_insert_with(|| {
                let mut history = HeartbeatHistory::new();
                history.record(now, self.config.max_sample_size);
                history
            });

        // Remove from suspected/failed lists
        self.suspected.remove(&node_id);
        self.failed.remove(&node_id);

        debug!(node_id = %node_id, "Recorded heartbeat");
    }

    /// Calculate phi value for a node (suspicion level)
    /// Higher phi = higher confidence that node has failed
    pub fn phi(&self, node_id: &NodeId) -> f64 {
        let Some(history) = self.heartbeat_history.get(node_id) else {
            // No heartbeat history - assume first heartbeat timeout
            let elapsed = self.config.first_heartbeat_timeout.as_millis() as f64;
            return elapsed / 1000.0; // Return time-based phi
        };

        // Not enough samples for statistical calculation
        if history.intervals.len() < 2 {
            let elapsed = Instant::now()
                .duration_since(history.last_heartbeat)
                .as_millis() as f64;
            let timeout = self.config.acceptable_heartbeat_pause.as_millis() as f64;
            return (elapsed / timeout).max(0.0);
        }

        let Some(mean) = history.mean_interval() else {
            return 0.0;
        };

        let std_dev = history
            .variance(mean)
            .unwrap_or(self.config.min_std_deviation)
            .max(self.config.min_std_deviation);

        let elapsed = Instant::now().duration_since(history.last_heartbeat);

        // Calculate phi using cumulative distribution function (CDF)
        // phi = -log10(1 - CDF(elapsed, mean, std_dev))
        let phi = self.calculate_phi(elapsed, mean, std_dev);

        debug!(
            node_id = %node_id,
            phi,
            elapsed_ms = elapsed.as_millis(),
            mean_ms = mean.as_millis(),
            std_dev_ms = std_dev.as_millis(),
            "Calculated phi value"
        );

        phi
    }

    /// Check if a node is available (not suspected or failed)
    pub fn is_available(&self, node_id: &NodeId) -> bool {
        !self.suspected.contains_key(node_id) && !self.failed.contains_key(node_id)
    }

    /// Check if a node is suspected of failure
    pub fn suspect(&self, node_id: &NodeId) -> bool {
        let phi = self.phi(node_id);

        if phi > self.config.phi_threshold {
            // Mark as suspected if not already
            if !self.suspected.contains_key(node_id) {
                warn!(
                    node_id = %node_id,
                    phi,
                    threshold = self.config.phi_threshold,
                    "Node suspected of failure"
                );
                self.suspected.insert(*node_id, SystemTime::now());
            }
            true
        } else {
            false
        }
    }

    /// Mark a node as definitively failed
    pub fn mark_failed(&self, node_id: NodeId) {
        warn!(node_id = %node_id, "Marking node as failed");
        self.failed.insert(node_id, SystemTime::now());
        self.suspected.remove(&node_id);
    }

    /// Check if a node has failed
    pub fn is_failed(&self, node_id: &NodeId) -> bool {
        self.failed.contains_key(node_id)
    }

    /// Get all suspected nodes
    pub fn get_suspected(&self) -> Vec<NodeId> {
        self.suspected.iter().map(|entry| *entry.key()).collect()
    }

    /// Get all failed nodes
    pub fn get_failed(&self) -> Vec<NodeId> {
        self.failed.iter().map(|entry| *entry.key()).collect()
    }

    /// Clear failure state for a node (for recovery)
    pub fn clear_failure(&self, node_id: &NodeId) {
        info!(node_id = %node_id, "Clearing failure state");
        self.failed.remove(node_id);
        self.suspected.remove(node_id);
    }

    /// Calculate phi using normal distribution CDF
    fn calculate_phi(&self, elapsed: Duration, mean: Duration, std_dev: Duration) -> f64 {
        let elapsed_ms = elapsed.as_millis() as f64;
        let mean_ms = mean.as_millis() as f64;
        let std_dev_ms = std_dev.as_millis() as f64;

        if std_dev_ms == 0.0 {
            return if elapsed_ms > mean_ms { 100.0 } else { 0.0 };
        }

        // Normalize
        let z = (elapsed_ms - mean_ms) / std_dev_ms;

        // Calculate CDF using error function approximation
        let cdf = self.normal_cdf(z);

        // phi = -log10(1 - CDF)
        if cdf >= 1.0 {
            100.0 // Maximum phi
        } else {
            -((1.0 - cdf).log10())
        }
    }

    /// Normal distribution CDF approximation
    fn normal_cdf(&self, z: f64) -> f64 {
        if z < -8.0 {
            return 0.0;
        }
        if z > 8.0 {
            return 1.0;
        }

        // Use error function approximation
        let t = 1.0 / (1.0 + 0.2316419 * z.abs());
        let d = 0.3989423 * (-z * z / 2.0).exp();
        let prob = d
            * t
            * (0.3193815
                + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));

        if z > 0.0 {
            1.0 - prob
        } else {
            prob
        }
    }

    /// Get statistics for monitoring
    pub fn get_stats(&self) -> FailureDetectorStats {
        let total_nodes = self.heartbeat_history.len();
        let suspected_count = self.suspected.len();
        let failed_count = self.failed.len();

        FailureDetectorStats {
            total_nodes,
            suspected_count,
            failed_count,
            available_count: total_nodes - suspected_count - failed_count,
        }
    }

    /// Detect network partition
    pub fn detect_partition(&self, quorum_size: usize) -> bool {
        let stats = self.get_stats();
        let available = stats.available_count;

        if available < quorum_size {
            warn!(
                available,
                quorum_size,
                suspected = stats.suspected_count,
                failed = stats.failed_count,
                "Network partition detected - insufficient available nodes"
            );
            true
        } else {
            false
        }
    }
}

/// Failure detector statistics
#[derive(Debug, Clone)]
pub struct FailureDetectorStats {
    pub total_nodes: usize,
    pub suspected_count: usize,
    pub failed_count: usize,
    pub available_count: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn test_heartbeat_recording() {
        let detector = PhiAccrualFailureDetector::new(FailureDetectorConfig::default());
        let node_id = NodeId::new_v4();

        detector.record_heartbeat(node_id);
        assert!(detector.is_available(&node_id));
        assert!(!detector.is_failed(&node_id));
    }

    #[test]
    fn test_failure_detection() {
        let mut config = FailureDetectorConfig::default();
        config.phi_threshold = 3.0; // Lower threshold for testing
        config.acceptable_heartbeat_pause = Duration::from_millis(100);

        let detector = PhiAccrualFailureDetector::new(config);
        let node_id = NodeId::new_v4();

        // Record initial heartbeats
        detector.record_heartbeat(node_id);
        thread::sleep(Duration::from_millis(50));
        detector.record_heartbeat(node_id);
        thread::sleep(Duration::from_millis(50));
        detector.record_heartbeat(node_id);

        // Wait for failure
        thread::sleep(Duration::from_millis(500));

        let phi = detector.phi(&node_id);
        assert!(phi > 3.0, "Phi should be high after timeout: {}", phi);
        assert!(detector.suspect(&node_id));
    }

    #[test]
    fn test_phi_calculation() {
        let detector = PhiAccrualFailureDetector::new(FailureDetectorConfig::default());
        let node_id = NodeId::new_v4();

        // Record regular heartbeats
        for _ in 0..10 {
            detector.record_heartbeat(node_id);
            thread::sleep(Duration::from_millis(100));
        }

        // Phi should be low with regular heartbeats
        let phi = detector.phi(&node_id);
        assert!(phi < 1.0, "Phi should be low with regular heartbeats: {}", phi);
    }

    #[test]
    fn test_recovery() {
        let detector = PhiAccrualFailureDetector::new(FailureDetectorConfig::default());
        let node_id = NodeId::new_v4();

        detector.mark_failed(node_id);
        assert!(detector.is_failed(&node_id));

        detector.clear_failure(&node_id);
        assert!(!detector.is_failed(&node_id));
    }

    #[test]
    fn test_partition_detection() {
        let detector = PhiAccrualFailureDetector::new(FailureDetectorConfig::default());

        // Add 10 nodes
        let nodes: Vec<NodeId> = (0..10).map(|_| NodeId::new_v4()).collect();
        for node in &nodes {
            detector.record_heartbeat(*node);
        }

        // Mark 6 nodes as failed (quorum = 7)
        for node in nodes.iter().take(6) {
            detector.mark_failed(*node);
        }

        assert!(detector.detect_partition(7));
    }
}
