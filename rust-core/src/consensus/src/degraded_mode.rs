//! Degraded Mode Operation
//!
//! Manages system operation under adverse conditions with automatic parameter adjustment

use crate::{
    error::Result,
    peer_recovery::PeerRecoveryManager,
    NodeId,
};
use parking_lot::RwLock;
use std::sync::Arc;
use std::time::Duration;
use tracing::{info, warn};

/// Operation mode severity
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum DegradationLevel {
    /// Normal operation
    None = 0,

    /// Minor degradation (10-20% peer loss)
    Minor = 1,

    /// Moderate degradation (20-33% peer loss)
    Moderate = 2,

    /// Severe degradation (33-50% peer loss)
    Severe = 3,

    /// Critical degradation (>50% peer loss)
    Critical = 4,
}

/// System operation mode
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OperationMode {
    /// Normal operation
    Normal,

    /// Degraded operation
    Degraded { severity: DegradationLevel },

    /// Critical mode - minimal operation
    Critical,
}

impl OperationMode {
    /// Check if mode is degraded
    pub fn is_degraded(&self) -> bool {
        !matches!(self, OperationMode::Normal)
    }

    /// Get severity level
    pub fn severity(&self) -> DegradationLevel {
        match self {
            OperationMode::Normal => DegradationLevel::None,
            OperationMode::Degraded { severity } => *severity,
            OperationMode::Critical => DegradationLevel::Critical,
        }
    }
}

/// Consensus parameters (adjustable based on mode)
#[derive(Debug, Clone)]
pub struct ConsensusParams {
    /// Quorum threshold (0.0 - 1.0)
    pub quorum_threshold: f64,

    /// Finality timeout
    pub finality_timeout: Duration,

    /// Maximum concurrent proposals
    pub max_concurrent_proposals: usize,

    /// Heartbeat interval
    pub heartbeat_interval: Duration,

    /// View change timeout
    pub view_change_timeout: Duration,

    /// Maximum pending vertices
    pub max_pending_vertices: usize,

    /// Enable throttling
    pub throttle_enabled: bool,

    /// Throttle rate (vertices per second)
    pub throttle_rate: u64,
}

impl Default for ConsensusParams {
    fn default() -> Self {
        Self {
            quorum_threshold: 0.67,
            finality_timeout: Duration::from_millis(500),
            max_concurrent_proposals: 100,
            heartbeat_interval: Duration::from_secs(1),
            view_change_timeout: Duration::from_secs(10),
            max_pending_vertices: 10000,
            throttle_enabled: false,
            throttle_rate: 1000,
        }
    }
}

/// Degradation metrics
#[derive(Debug, Default)]
pub struct DegradationMetrics {
    /// Total mode transitions
    pub mode_transitions: std::sync::atomic::AtomicU64,

    /// Time in degraded mode (ms)
    pub degraded_time_ms: std::sync::atomic::AtomicU64,

    /// Throttled requests
    pub throttled_requests: std::sync::atomic::AtomicU64,

    /// Rejected proposals
    pub rejected_proposals: std::sync::atomic::AtomicU64,
}

/// Degraded mode manager
pub struct DegradedModeManager {
    /// Current operation mode
    current_mode: Arc<RwLock<OperationMode>>,

    /// Peer monitor
    peer_monitor: Arc<PeerRecoveryManager>,

    /// Base consensus parameters
    base_params: ConsensusParams,

    /// Current adjusted parameters
    current_params: Arc<RwLock<ConsensusParams>>,

    /// Metrics
    metrics: Arc<DegradationMetrics>,

    /// Total nodes in network
    total_nodes: usize,

    /// Minimum nodes for operation
    min_nodes: usize,
}

impl DegradedModeManager {
    /// Create new degraded mode manager
    pub fn new(
        peer_monitor: Arc<PeerRecoveryManager>,
        base_params: ConsensusParams,
        total_nodes: usize,
    ) -> Self {
        let min_nodes = (total_nodes * 2) / 3 + 1; // 2f+1 minimum

        info!(
            total_nodes,
            min_nodes,
            "Initializing degraded mode manager"
        );

        Self {
            current_mode: Arc::new(RwLock::new(OperationMode::Normal)),
            peer_monitor,
            base_params: base_params.clone(),
            current_params: Arc::new(RwLock::new(base_params)),
            metrics: Arc::new(DegradationMetrics::default()),
            total_nodes,
            min_nodes,
        }
    }

    /// Evaluate current operation mode
    pub async fn evaluate_mode(&self) -> OperationMode {
        let active_peers = self.peer_monitor.active_peer_count();
        let peer_loss_pct = 1.0 - (active_peers as f64 / self.total_nodes as f64);

        let new_mode = if active_peers < self.min_nodes {
            // Below minimum - critical mode
            OperationMode::Critical
        } else if peer_loss_pct > 0.50 {
            OperationMode::Degraded {
                severity: DegradationLevel::Critical,
            }
        } else if peer_loss_pct > 0.33 {
            OperationMode::Degraded {
                severity: DegradationLevel::Severe,
            }
        } else if peer_loss_pct > 0.20 {
            OperationMode::Degraded {
                severity: DegradationLevel::Moderate,
            }
        } else if peer_loss_pct > 0.10 {
            OperationMode::Degraded {
                severity: DegradationLevel::Minor,
            }
        } else {
            OperationMode::Normal
        };

        let current = *self.current_mode.read();
        if new_mode != current {
            self.transition_mode(new_mode).await;
        }

        new_mode
    }

    /// Transition to a new operation mode
    pub async fn transition_mode(&self, new_mode: OperationMode) {
        let old_mode = *self.current_mode.read();

        warn!(
            old_mode = ?old_mode,
            new_mode = ?new_mode,
            "Transitioning operation mode"
        );

        *self.current_mode.write() = new_mode;

        // Adjust parameters for new mode
        let adjusted_params = self.adjust_parameters(new_mode);
        *self.current_params.write() = adjusted_params;

        self.metrics
            .mode_transitions
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

        info!(new_mode = ?new_mode, "Mode transition complete");
    }

    /// Adjust consensus parameters based on mode
    pub fn adjust_parameters(&self, mode: OperationMode) -> ConsensusParams {
        let mut params = self.base_params.clone();

        match mode {
            OperationMode::Normal => {
                // Use base parameters
            }
            OperationMode::Degraded { severity } => {
                match severity {
                    DegradationLevel::None => {}
                    DegradationLevel::Minor => {
                        // Increase timeouts by 25%
                        params.finality_timeout =
                            Duration::from_millis((params.finality_timeout.as_millis() * 125) / 100);
                        params.heartbeat_interval = Duration::from_millis(800);
                    }
                    DegradationLevel::Moderate => {
                        // Increase timeouts by 50%
                        params.finality_timeout =
                            Duration::from_millis((params.finality_timeout.as_millis() * 150) / 100);
                        params.heartbeat_interval = Duration::from_millis(600);

                        // Reduce concurrent proposals
                        params.max_concurrent_proposals = 50;
                    }
                    DegradationLevel::Severe => {
                        // Double timeouts
                        params.finality_timeout =
                            Duration::from_millis(params.finality_timeout.as_millis() * 2);
                        params.heartbeat_interval = Duration::from_millis(500);

                        // Aggressive throttling
                        params.max_concurrent_proposals = 25;
                        params.throttle_enabled = true;
                        params.throttle_rate = 500;
                    }
                    DegradationLevel::Critical => {
                        // Triple timeouts
                        params.finality_timeout =
                            Duration::from_millis(params.finality_timeout.as_millis() * 3);
                        params.heartbeat_interval = Duration::from_millis(300);

                        // Maximum throttling
                        params.max_concurrent_proposals = 10;
                        params.throttle_enabled = true;
                        params.throttle_rate = 100;
                        params.max_pending_vertices = 1000;
                    }
                }
            }
            OperationMode::Critical => {
                // Emergency parameters
                params.finality_timeout = Duration::from_secs(5);
                params.heartbeat_interval = Duration::from_millis(200);
                params.max_concurrent_proposals = 5;
                params.throttle_enabled = true;
                params.throttle_rate = 50;
                params.max_pending_vertices = 100;
                params.quorum_threshold = 0.75; // Require higher quorum
            }
        }

        info!(
            mode = ?mode,
            finality_timeout_ms = params.finality_timeout.as_millis(),
            max_proposals = params.max_concurrent_proposals,
            throttle_rate = params.throttle_rate,
            "Adjusted consensus parameters"
        );

        params
    }

    /// Get current operation mode
    pub fn current_mode(&self) -> OperationMode {
        *self.current_mode.read()
    }

    /// Get current parameters
    pub fn current_params(&self) -> ConsensusParams {
        self.current_params.read().clone()
    }

    /// Check if operation should be throttled
    pub fn should_throttle(&self) -> bool {
        let params = self.current_params.read();
        params.throttle_enabled
    }

    /// Get throttle rate
    pub fn throttle_rate(&self) -> u64 {
        self.current_params.read().throttle_rate
    }

    /// Record throttled request
    pub fn record_throttle(&self) {
        self.metrics
            .throttled_requests
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }

    /// Record rejected proposal
    pub fn record_rejection(&self) {
        self.metrics
            .rejected_proposals
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }

    /// Check if system can accept new proposal
    pub fn can_accept_proposal(&self, pending_count: usize) -> bool {
        let params = self.current_params.read();
        pending_count < params.max_concurrent_proposals
    }

    /// Get metrics
    pub fn metrics(&self) -> &DegradationMetrics {
        &self.metrics
    }

    /// Get system health percentage
    pub fn health_percentage(&self) -> f64 {
        let active = self.peer_monitor.active_peer_count();
        (active as f64 / self.total_nodes as f64) * 100.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::failure_detector::{FailureDetectorConfig, PhiAccrualFailureDetector};
    use crate::peer_recovery::PeerRecoveryConfig;
    use std::collections::HashSet;

    fn setup() -> DegradedModeManager {
        let detector = Arc::new(PhiAccrualFailureDetector::new(
            FailureDetectorConfig::default(),
        ));

        let active_peers: HashSet<NodeId> = (0..10).map(|_| NodeId::new_v4()).collect();
        let backup_peers: Vec<NodeId> = (0..2).map(|_| NodeId::new_v4()).collect();

        let peer_monitor = Arc::new(PeerRecoveryManager::new(
            detector,
            active_peers,
            backup_peers,
            PeerRecoveryConfig::default(),
        ));

        DegradedModeManager::new(peer_monitor, ConsensusParams::default(), 10)
    }

    #[tokio::test]
    async fn test_mode_evaluation() {
        let manager = setup();

        let mode = manager.evaluate_mode().await;
        assert_eq!(mode, OperationMode::Normal);
    }

    #[test]
    fn test_parameter_adjustment() {
        let manager = setup();

        let normal_params = manager.adjust_parameters(OperationMode::Normal);
        assert_eq!(normal_params.finality_timeout, Duration::from_millis(500));

        let degraded_params = manager.adjust_parameters(OperationMode::Degraded {
            severity: DegradationLevel::Severe,
        });
        assert!(degraded_params.finality_timeout > normal_params.finality_timeout);
        assert!(degraded_params.throttle_enabled);
    }

    #[test]
    fn test_throttling() {
        let manager = setup();

        // Normal mode - no throttling
        assert!(!manager.should_throttle());

        // Simulate degraded mode
        *manager.current_mode.write() = OperationMode::Degraded {
            severity: DegradationLevel::Severe,
        };
        let params = manager.adjust_parameters(OperationMode::Degraded {
            severity: DegradationLevel::Severe,
        });
        *manager.current_params.write() = params;

        assert!(manager.should_throttle());
    }

    #[test]
    fn test_proposal_acceptance() {
        let manager = setup();

        assert!(manager.can_accept_proposal(50));
        assert!(!manager.can_accept_proposal(150));
    }

    #[test]
    fn test_health_percentage() {
        let manager = setup();

        let health = manager.health_percentage();
        assert_eq!(health, 100.0);
    }
}
