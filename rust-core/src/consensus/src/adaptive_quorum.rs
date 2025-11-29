//! Adaptive Quorum Thresholds for CretoAI
//!
//! Dynamically adjusts quorum requirements (67% → 82%) based on:
//! - Network threat level
//! - Byzantine node detection rate
//! - Network stability metrics
//!
//! ## Threat Response
//!
//! - **Normal**: 67% quorum (2f+1 standard PBFT)
//! - **Elevated**: 75% quorum (increased safety)
//! - **High**: 82% quorum (maximum Byzantine resistance)

use crate::{NodeId, Result, ConsensusError};
use parking_lot::RwLock;
use prometheus::{register_gauge, register_histogram, Gauge, Histogram};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{debug, info, warn};

/// Threat level classifications
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum ThreatLevel {
    /// Normal operation: 67% quorum
    Normal,
    /// Elevated threat: 75% quorum
    Elevated,
    /// High threat: 82% quorum
    High,
}

impl ThreatLevel {
    /// Get quorum threshold for this threat level
    pub fn quorum_threshold(&self) -> f64 {
        match self {
            ThreatLevel::Normal => 0.67,
            ThreatLevel::Elevated => 0.75,
            ThreatLevel::High => 0.82,
        }
    }

    /// Get minimum nodes for quorum (given total network size)
    pub fn min_nodes(&self, total_nodes: usize) -> usize {
        (total_nodes as f64 * self.quorum_threshold()).ceil() as usize
    }
}

/// Configuration for adaptive quorum system
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdaptiveQuorumConfig {
    /// Minimum detection rate to trigger elevated threat
    pub elevated_detection_threshold: f64,

    /// Minimum detection rate to trigger high threat
    pub high_detection_threshold: f64,

    /// Window size for calculating detection rates (seconds)
    pub detection_window_secs: u64,

    /// Network stability threshold (lower = less stable)
    pub stability_threshold: f64,

    /// Cooldown period before downgrading threat level (seconds)
    pub cooldown_period_secs: u64,
}

impl Default for AdaptiveQuorumConfig {
    fn default() -> Self {
        Self {
            elevated_detection_threshold: 0.05, // 5% Byzantine detection rate
            high_detection_threshold: 0.15,     // 15% Byzantine detection rate
            detection_window_secs: 300,         // 5 minute window
            stability_threshold: 0.9,           // 90% uptime
            cooldown_period_secs: 600,          // 10 minute cooldown
        }
    }
}

/// Byzantine detection event
#[derive(Debug, Clone)]
struct DetectionEvent {
    /// When the detection occurred
    timestamp: Instant,
    /// Node that was detected as Byzantine
    node_id: NodeId,
    /// Type of violation
    violation_type: String,
}

/// Network stability metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StabilityMetrics {
    /// Average node uptime (0-1)
    avg_uptime: f64,
    /// Network partition events in window
    partition_events: usize,
    /// Average consensus latency (ms)
    avg_latency_ms: u64,
}

/// Adaptive quorum manager
pub struct AdaptiveQuorumManager {
    /// Configuration
    config: AdaptiveQuorumConfig,

    /// Current threat level
    threat_level: Arc<RwLock<ThreatLevel>>,

    /// Recent Byzantine detection events (sliding window)
    detections: Arc<RwLock<VecDeque<DetectionEvent>>>,

    /// Network stability metrics
    stability: Arc<RwLock<StabilityMetrics>>,

    /// Total nodes in network
    total_nodes: Arc<RwLock<usize>>,

    /// Last threat level change timestamp
    last_level_change: Arc<RwLock<Instant>>,

    /// Metrics
    metrics: Arc<AdaptiveQuorumMetrics>,
}

/// Prometheus metrics
struct AdaptiveQuorumMetrics {
    /// Current quorum threshold
    quorum_threshold: Gauge,

    /// Current threat level (0=normal, 1=elevated, 2=high)
    threat_level: Gauge,

    /// Byzantine detection rate
    detection_rate: Gauge,

    /// Network stability score
    stability_score: Gauge,

    /// Threat level adjustments
    level_adjustments: prometheus::Counter,

    /// Quorum calculation time
    calculation_duration: Histogram,
}

impl AdaptiveQuorumMetrics {
    fn new() -> Result<Self> {
        Ok(Self {
            quorum_threshold: register_gauge!(
                "adaptive_quorum_threshold",
                "Current adaptive quorum threshold"
            )?,
            threat_level: register_gauge!(
                "adaptive_quorum_threat_level",
                "Current threat level (0=normal, 1=elevated, 2=high)"
            )?,
            detection_rate: register_gauge!(
                "adaptive_quorum_detection_rate",
                "Byzantine detection rate in current window"
            )?,
            stability_score: register_gauge!(
                "adaptive_quorum_stability",
                "Network stability score (0-1)"
            )?,
            level_adjustments: prometheus::register_counter!(
                "adaptive_quorum_level_changes_total",
                "Total number of threat level adjustments"
            )?,
            calculation_duration: register_histogram!(
                "adaptive_quorum_calc_duration_seconds",
                "Time to calculate adaptive quorum"
            )?,
        })
    }
}

impl AdaptiveQuorumManager {
    /// Create new adaptive quorum manager
    pub fn new(config: AdaptiveQuorumConfig, total_nodes: usize) -> Result<Self> {
        let metrics = Arc::new(AdaptiveQuorumMetrics::new()?);

        // Initialize metrics
        metrics.quorum_threshold.set(ThreatLevel::Normal.quorum_threshold());
        metrics.threat_level.set(0.0);
        metrics.stability_score.set(1.0);

        Ok(Self {
            config,
            threat_level: Arc::new(RwLock::new(ThreatLevel::Normal)),
            detections: Arc::new(RwLock::new(VecDeque::new())),
            stability: Arc::new(RwLock::new(StabilityMetrics {
                avg_uptime: 1.0,
                partition_events: 0,
                avg_latency_ms: 100,
            })),
            total_nodes: Arc::new(RwLock::new(total_nodes)),
            last_level_change: Arc::new(RwLock::new(Instant::now())),
            metrics,
        })
    }

    /// Report Byzantine node detection
    pub fn report_detection(&self, node_id: NodeId, violation_type: String) {
        let event = DetectionEvent {
            timestamp: Instant::now(),
            node_id,
            violation_type: violation_type.clone(),
        };

        let mut detections = self.detections.write();
        detections.push_back(event);

        // Clean old events outside window
        let window = Duration::from_secs(self.config.detection_window_secs);
        let cutoff = Instant::now() - window;
        detections.retain(|e| e.timestamp > cutoff);

        let rate = self.calculate_detection_rate(&detections);
        self.metrics.detection_rate.set(rate);

        info!("Reported Byzantine detection: {} ({}), rate: {:.2}%",
              node_id, violation_type, rate * 100.0);

        // Trigger immediate re-evaluation
        drop(detections);
        let _ = self.evaluate_threat_level();
    }

    /// Calculate Byzantine detection rate
    fn calculate_detection_rate(&self, detections: &VecDeque<DetectionEvent>) -> f64 {
        let total = *self.total_nodes.read();
        if total == 0 {
            return 0.0;
        }

        // Count unique detected nodes in window
        let unique_nodes: std::collections::HashSet<_> =
            detections.iter().map(|e| e.node_id).collect();

        unique_nodes.len() as f64 / total as f64
    }

    /// Update network stability metrics
    pub fn update_stability(&self, avg_uptime: f64, partition_events: usize, avg_latency_ms: u64) {
        let mut stability = self.stability.write();
        stability.avg_uptime = avg_uptime;
        stability.partition_events = partition_events;
        stability.avg_latency_ms = avg_latency_ms;

        // Calculate composite stability score
        let uptime_score = avg_uptime;
        let partition_penalty = (partition_events as f64 * 0.1).min(0.5);
        let latency_score = if avg_latency_ms < 100 { 1.0 }
        else if avg_latency_ms < 500 { 0.8 }
        else { 0.5 };

        let score = (uptime_score * 0.5 + latency_score * 0.5) - partition_penalty;
        let score = score.max(0.0).min(1.0);

        self.metrics.stability_score.set(score);

        debug!("Updated stability: uptime={:.2}%, partitions={}, latency={}ms, score={:.2}",
               avg_uptime * 100.0, partition_events, avg_latency_ms, score);
    }

    /// Evaluate and update threat level
    pub fn evaluate_threat_level(&self) -> Result<ThreatLevel> {
        let start = Instant::now();

        let detections = self.detections.read();
        let detection_rate = self.calculate_detection_rate(&detections);
        drop(detections);

        let stability = self.stability.read();
        let stability_score = {
            let uptime_score = stability.avg_uptime;
            let partition_penalty = (stability.partition_events as f64 * 0.1).min(0.5);
            let latency_score = if stability.avg_latency_ms < 100 { 1.0 }
            else if stability.avg_latency_ms < 500 { 0.8 }
            else { 0.5 };

            (uptime_score * 0.5 + latency_score * 0.5) - partition_penalty
        };
        drop(stability);

        // Determine new threat level
        let new_level = if detection_rate >= self.config.high_detection_threshold ||
                          stability_score < (self.config.stability_threshold - 0.2) {
            ThreatLevel::High
        } else if detection_rate >= self.config.elevated_detection_threshold ||
                  stability_score < self.config.stability_threshold {
            ThreatLevel::Elevated
        } else {
            ThreatLevel::Normal
        };

        // Check cooldown before downgrading
        let current_level = *self.threat_level.read();
        let last_change = *self.last_level_change.read();
        let cooldown = Duration::from_secs(self.config.cooldown_period_secs);

        let can_change = if new_level < current_level {
            // Downgrading requires cooldown
            last_change.elapsed() >= cooldown
        } else {
            // Upgrading has no cooldown
            true
        };

        if can_change && new_level != current_level {
            self.set_threat_level(new_level)?;
            info!("Threat level changed: {:?} -> {:?} (detection: {:.1}%, stability: {:.2})",
                  current_level, new_level, detection_rate * 100.0, stability_score);
        }

        self.metrics.calculation_duration.observe(start.elapsed().as_secs_f64());

        Ok(new_level)
    }

    /// Set threat level (internal)
    fn set_threat_level(&self, level: ThreatLevel) -> Result<()> {
        let mut current = self.threat_level.write();
        *current = level;

        let mut last_change = self.last_level_change.write();
        *last_change = Instant::now();

        // Update metrics
        self.metrics.quorum_threshold.set(level.quorum_threshold());
        self.metrics.threat_level.set(match level {
            ThreatLevel::Normal => 0.0,
            ThreatLevel::Elevated => 1.0,
            ThreatLevel::High => 2.0,
        });
        self.metrics.level_adjustments.inc();

        Ok(())
    }

    /// Get current quorum threshold
    pub fn get_quorum_threshold(&self) -> f64 {
        self.threat_level.read().quorum_threshold()
    }

    /// Get current threat level
    pub fn get_threat_level(&self) -> ThreatLevel {
        *self.threat_level.read()
    }

    /// Check if quorum is met for given votes
    pub fn check_quorum(&self, vote_count: usize) -> bool {
        let total = *self.total_nodes.read();
        let threshold = self.get_quorum_threshold();
        let required = (total as f64 * threshold).ceil() as usize;

        vote_count >= required
    }

    /// Get minimum votes required for current quorum
    pub fn get_required_votes(&self) -> usize {
        let level = self.threat_level.read();
        let total = *self.total_nodes.read();
        level.min_nodes(total)
    }

    /// Update total network size
    pub fn set_total_nodes(&self, total: usize) {
        *self.total_nodes.write() = total;
        info!("Updated network size to {} nodes", total);
    }

    /// Get adaptive quorum statistics
    pub fn get_stats(&self) -> AdaptiveQuorumStats {
        let detections = self.detections.read();
        let detection_rate = self.calculate_detection_rate(&detections);
        let recent_detections = detections.len();
        drop(detections);

        let stability = self.stability.read();
        let stability_metrics = stability.clone();
        drop(stability);

        AdaptiveQuorumStats {
            threat_level: self.get_threat_level(),
            quorum_threshold: self.get_quorum_threshold(),
            required_votes: self.get_required_votes(),
            total_nodes: *self.total_nodes.read(),
            detection_rate,
            recent_detections,
            stability: stability_metrics,
        }
    }

    /// Force threat level (for testing/admin override)
    pub fn force_threat_level(&self, level: ThreatLevel) -> Result<()> {
        warn!("Force-setting threat level to {:?}", level);
        self.set_threat_level(level)
    }
}

/// Adaptive quorum statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdaptiveQuorumStats {
    pub threat_level: ThreatLevel,
    pub quorum_threshold: f64,
    pub required_votes: usize,
    pub total_nodes: usize,
    pub detection_rate: f64,
    pub recent_detections: usize,
    pub stability: StabilityMetrics,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_threat_level_quorum() {
        assert_eq!(ThreatLevel::Normal.quorum_threshold(), 0.67);
        assert_eq!(ThreatLevel::Elevated.quorum_threshold(), 0.75);
        assert_eq!(ThreatLevel::High.quorum_threshold(), 0.82);

        // 10 nodes
        assert_eq!(ThreatLevel::Normal.min_nodes(10), 7);   // 67% = 6.7 -> 7
        assert_eq!(ThreatLevel::Elevated.min_nodes(10), 8); // 75% = 7.5 -> 8
        assert_eq!(ThreatLevel::High.min_nodes(10), 9);     // 82% = 8.2 -> 9
    }

    #[tokio::test]
    async fn test_adaptive_quorum_normal() {
        let config = AdaptiveQuorumConfig::default();
        let manager = AdaptiveQuorumManager::new(config, 10).unwrap();

        // Normal operation
        manager.update_stability(0.95, 0, 50);
        let level = manager.evaluate_threat_level().unwrap();

        assert_eq!(level, ThreatLevel::Normal);
        assert_eq!(manager.get_quorum_threshold(), 0.67);
        assert_eq!(manager.get_required_votes(), 7);
    }

    #[tokio::test]
    async fn test_adaptive_quorum_elevated() {
        let config = AdaptiveQuorumConfig::default();
        let manager = AdaptiveQuorumManager::new(config, 10).unwrap();

        // Report Byzantine detections (6% rate triggers elevated)
        manager.report_detection(NodeId::new_v4(), "equivocation".to_string());

        let level = manager.evaluate_threat_level().unwrap();

        assert_eq!(level, ThreatLevel::Elevated);
        assert_eq!(manager.get_quorum_threshold(), 0.75);
        assert_eq!(manager.get_required_votes(), 8);
    }

    #[tokio::test]
    async fn test_adaptive_quorum_high() {
        let config = AdaptiveQuorumConfig::default();
        let manager = AdaptiveQuorumManager::new(config, 10).unwrap();

        // Report multiple Byzantine detections (20% rate triggers high)
        for _ in 0..2 {
            manager.report_detection(NodeId::new_v4(), "double_vote".to_string());
        }

        let level = manager.evaluate_threat_level().unwrap();

        assert_eq!(level, ThreatLevel::High);
        assert_eq!(manager.get_quorum_threshold(), 0.82);
        assert_eq!(manager.get_required_votes(), 9);
    }

    #[tokio::test]
    async fn test_quorum_check() {
        let config = AdaptiveQuorumConfig::default();
        let manager = AdaptiveQuorumManager::new(config, 10).unwrap();

        // Normal: need 7 votes
        assert!(manager.check_quorum(7));
        assert!(!manager.check_quorum(6));

        // Elevated: need 8 votes
        manager.force_threat_level(ThreatLevel::Elevated).unwrap();
        assert!(manager.check_quorum(8));
        assert!(!manager.check_quorum(7));

        // High: need 9 votes
        manager.force_threat_level(ThreatLevel::High).unwrap();
        assert!(manager.check_quorum(9));
        assert!(!manager.check_quorum(8));
    }

    #[tokio::test]
    async fn test_stability_impact() {
        let config = AdaptiveQuorumConfig::default();
        let manager = AdaptiveQuorumManager::new(config, 10).unwrap();

        // Low stability triggers elevated even without detections
        manager.update_stability(0.85, 0, 50); // Below 0.9 threshold
        let level = manager.evaluate_threat_level().unwrap();

        assert_eq!(level, ThreatLevel::Elevated);
    }
}
