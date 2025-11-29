//! Peer Recovery Manager
//!
//! Handles automatic peer removal, replacement, and connection retry with exponential backoff

use crate::{
    error::{ConsensusError, Result},
    failure_detector::PhiAccrualFailureDetector,
    NodeId,
};
use dashmap::DashMap;
use parking_lot::RwLock;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use tokio::time::sleep;
use tracing::{debug, error, info, warn};

/// Recovery state for a peer
#[derive(Debug, Clone)]
pub enum RecoveryState {
    /// Peer is healthy
    Healthy,

    /// Peer is suspected
    Suspected { since: SystemTime },

    /// Recovery in progress
    Recovering {
        attempt: u32,
        last_attempt: Instant,
        next_retry: Instant,
    },

    /// Peer has been replaced
    Replaced {
        replacement: NodeId,
        at: SystemTime,
    },

    /// Recovery failed
    Failed { reason: String, at: SystemTime },
}

/// Configuration for peer recovery
#[derive(Debug, Clone)]
pub struct PeerRecoveryConfig {
    /// Maximum recovery attempts before replacement
    pub max_recovery_attempts: u32,

    /// Initial backoff duration (default: 1s)
    pub initial_backoff: Duration,

    /// Maximum backoff duration (default: 60s)
    pub max_backoff: Duration,

    /// Backoff multiplier (default: 2.0)
    pub backoff_multiplier: f64,

    /// Connection timeout (default: 5s)
    pub connection_timeout: Duration,

    /// State transfer timeout (default: 30s)
    pub state_transfer_timeout: Duration,

    /// Minimum backup peers to maintain
    pub min_backup_peers: usize,
}

impl Default for PeerRecoveryConfig {
    fn default() -> Self {
        Self {
            max_recovery_attempts: 5,
            initial_backoff: Duration::from_secs(1),
            max_backoff: Duration::from_secs(60),
            backoff_multiplier: 2.0,
            connection_timeout: Duration::from_secs(5),
            state_transfer_timeout: Duration::from_secs(30),
            min_backup_peers: 3,
        }
    }
}

/// Peer recovery manager
pub struct PeerRecoveryManager {
    /// Failure detector
    failure_detector: Arc<PhiAccrualFailureDetector>,

    /// Active peers
    active_peers: Arc<RwLock<HashSet<NodeId>>>,

    /// Backup peers (not currently active)
    backup_peers: Arc<RwLock<Vec<NodeId>>>,

    /// Recovery state for each peer
    recovery_state: Arc<DashMap<NodeId, RecoveryState>>,

    /// Configuration
    config: PeerRecoveryConfig,

    /// Recovery metrics
    metrics: Arc<RecoveryMetrics>,
}

/// Recovery metrics
#[derive(Debug, Default)]
pub struct RecoveryMetrics {
    pub total_recoveries: std::sync::atomic::AtomicU64,
    pub successful_recoveries: std::sync::atomic::AtomicU64,
    pub failed_recoveries: std::sync::atomic::AtomicU64,
    pub peer_replacements: std::sync::atomic::AtomicU64,
    pub average_recovery_time_ms: std::sync::atomic::AtomicU64,
}

impl PeerRecoveryManager {
    /// Create new peer recovery manager
    pub fn new(
        failure_detector: Arc<PhiAccrualFailureDetector>,
        active_peers: HashSet<NodeId>,
        backup_peers: Vec<NodeId>,
        config: PeerRecoveryConfig,
    ) -> Self {
        info!(
            active_count = active_peers.len(),
            backup_count = backup_peers.len(),
            "Initializing peer recovery manager"
        );

        Self {
            failure_detector,
            active_peers: Arc::new(RwLock::new(active_peers)),
            backup_peers: Arc::new(RwLock::new(backup_peers)),
            recovery_state: Arc::new(DashMap::new()),
            config,
            metrics: Arc::new(RecoveryMetrics::default()),
        }
    }

    /// Start monitoring peers for failures
    pub async fn monitor_peers(&self) -> Result<()> {
        info!("Starting peer monitoring");

        loop {
            let suspected = self.failure_detector.get_suspected();
            let failed = self.failure_detector.get_failed();

            // Handle suspected peers
            for node_id in suspected {
                if self.active_peers.read().contains(&node_id) {
                    self.handle_suspected_peer(node_id).await?;
                }
            }

            // Handle failed peers
            for node_id in failed {
                if self.active_peers.read().contains(&node_id) {
                    self.handle_dead_peer(node_id).await?;
                }
            }

            // Check for peers in recovery
            self.check_recovery_progress().await?;

            sleep(Duration::from_secs(1)).await;
        }
    }

    /// Handle a suspected peer
    async fn handle_suspected_peer(&self, node_id: NodeId) -> Result<()> {
        if !self.recovery_state.contains_key(&node_id) {
            warn!(node_id = %node_id, "Peer suspected - starting monitoring");
            self.recovery_state
                .insert(node_id, RecoveryState::Suspected {
                    since: SystemTime::now(),
                });
        }
        Ok(())
    }

    /// Handle a dead peer
    pub async fn handle_dead_peer(&self, node_id: NodeId) -> Result<()> {
        error!(node_id = %node_id, "Dead peer detected");

        // Check if already being handled
        if let Some(state) = self.recovery_state.get(&node_id) {
            if matches!(
                state.value(),
                RecoveryState::Recovering { .. } | RecoveryState::Replaced { .. }
            ) {
                return Ok(());
            }
        }

        // Attempt recovery
        self.attempt_recovery(node_id).await
    }

    /// Attempt to recover a dead peer
    pub async fn attempt_recovery(&self, node_id: NodeId) -> Result<()> {
        let start_time = Instant::now();

        // Get current attempt number
        let attempt = if let Some(state) = self.recovery_state.get(&node_id) {
            if let RecoveryState::Recovering { attempt, .. } = state.value() {
                attempt + 1
            } else {
                1
            }
        } else {
            1
        };

        info!(
            node_id = %node_id,
            attempt,
            max_attempts = self.config.max_recovery_attempts,
            "Attempting peer recovery"
        );

        self.metrics
            .total_recoveries
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

        // Calculate backoff
        let backoff = self.calculate_backoff(attempt);
        let next_retry = Instant::now() + backoff;

        self.recovery_state.insert(
            node_id,
            RecoveryState::Recovering {
                attempt,
                last_attempt: Instant::now(),
                next_retry,
            },
        );

        // Try to reconnect
        match self.try_reconnect(node_id).await {
            Ok(()) => {
                info!(
                    node_id = %node_id,
                    elapsed_ms = start_time.elapsed().as_millis(),
                    "Successfully recovered peer"
                );

                self.recovery_state.insert(node_id, RecoveryState::Healthy);
                self.failure_detector.clear_failure(&node_id);

                self.metrics
                    .successful_recoveries
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

                // Update average recovery time
                let elapsed_ms = start_time.elapsed().as_millis() as u64;
                self.metrics
                    .average_recovery_time_ms
                    .store(elapsed_ms, std::sync::atomic::Ordering::Relaxed);

                Ok(())
            }
            Err(e) => {
                warn!(
                    node_id = %node_id,
                    attempt,
                    error = %e,
                    "Recovery attempt failed"
                );

                // Check if we should replace the peer
                if attempt >= self.config.max_recovery_attempts {
                    error!(
                        node_id = %node_id,
                        "Max recovery attempts reached - replacing peer"
                    );

                    self.replace_peer(node_id).await?;
                    self.metrics
                        .failed_recoveries
                        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                }

                Err(e)
            }
        }
    }

    /// Try to reconnect to a peer
    async fn try_reconnect(&self, node_id: NodeId) -> Result<()> {
        debug!(node_id = %node_id, "Attempting reconnection");

        // In production, this would:
        // 1. Establish TCP connection
        // 2. Perform handshake
        // 3. Verify node identity
        // 4. Sync state

        // Simulate connection attempt
        tokio::time::timeout(self.config.connection_timeout, async {
            // Connection logic here
            sleep(Duration::from_millis(100)).await;
            Ok::<(), ConsensusError>(())
        })
        .await
        .map_err(|_| ConsensusError::Network("Connection timeout".to_string()))?
    }

    /// Replace a failed peer with a backup
    async fn replace_peer(&self, failed_node: NodeId) -> Result<()> {
        let replacement = self
            .select_replacement()
            .await
            .ok_or_else(|| ConsensusError::NoBackupPeers)?;

        info!(
            failed_node = %failed_node,
            replacement = %replacement,
            "Replacing failed peer"
        );

        // Transfer state to replacement
        self.transfer_state(failed_node, replacement).await?;

        // Update peer sets
        {
            let mut active = self.active_peers.write();
            active.remove(&failed_node);
            active.insert(replacement);
        }

        {
            let mut backup = self.backup_peers.write();
            backup.retain(|id| *id != replacement);
            backup.push(failed_node);
        }

        // Update recovery state
        self.recovery_state.insert(
            failed_node,
            RecoveryState::Replaced {
                replacement,
                at: SystemTime::now(),
            },
        );

        self.recovery_state
            .insert(replacement, RecoveryState::Healthy);

        self.metrics
            .peer_replacements
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

        Ok(())
    }

    /// Select a replacement peer from backup pool
    pub async fn select_replacement(&self) -> Option<NodeId> {
        let backup = self.backup_peers.read();

        if backup.is_empty() {
            warn!("No backup peers available for replacement");
            return None;
        }

        // Select first available backup
        // In production, could use more sophisticated selection:
        // - Geographic proximity
        // - Resource availability
        // - Historical reliability
        backup.first().copied()
    }

    /// Transfer state from failed peer to replacement
    async fn transfer_state(&self, _from: NodeId, to: NodeId) -> Result<()> {
        info!(to = %to, "Transferring state to replacement peer");

        // In production, this would:
        // 1. Retrieve current consensus state
        // 2. Sync DAG vertices
        // 3. Transfer pending transactions
        // 4. Update routing tables

        tokio::time::timeout(self.config.state_transfer_timeout, async {
            sleep(Duration::from_millis(500)).await;
            Ok::<(), ConsensusError>(())
        })
        .await
        .map_err(|_| ConsensusError::Internal("State transfer timeout".to_string()))?
    }

    /// Calculate exponential backoff
    fn calculate_backoff(&self, attempt: u32) -> Duration {
        let backoff_ms = (self.config.initial_backoff.as_millis() as f64
            * self.config.backoff_multiplier.powi(attempt as i32 - 1))
            as u64;

        Duration::from_millis(backoff_ms.min(self.config.max_backoff.as_millis() as u64))
    }

    /// Check recovery progress for all peers
    async fn check_recovery_progress(&self) -> Result<()> {
        let now = Instant::now();

        for entry in self.recovery_state.iter() {
            let node_id = *entry.key();
            let state = entry.value();

            if let RecoveryState::Recovering { next_retry, .. } = state {
                if now >= *next_retry {
                    self.attempt_recovery(node_id).await?;
                }
            }
        }

        Ok(())
    }

    /// Get active peer count
    pub fn active_peer_count(&self) -> usize {
        self.active_peers.read().len()
    }

    /// Get backup peer count
    pub fn backup_peer_count(&self) -> usize {
        self.backup_peers.read().len()
    }

    /// Check if system has sufficient peers
    pub fn has_sufficient_peers(&self, quorum_size: usize) -> bool {
        self.active_peer_count() >= quorum_size
    }

    /// Get recovery metrics
    pub fn metrics(&self) -> &RecoveryMetrics {
        &self.metrics
    }

    /// Add backup peer
    pub fn add_backup_peer(&self, node_id: NodeId) {
        let mut backup = self.backup_peers.write();
        if !backup.contains(&node_id) {
            backup.push(node_id);
            info!(node_id = %node_id, "Added backup peer");
        }
    }

    /// Get recovery state for a peer
    pub fn get_recovery_state(&self, node_id: &NodeId) -> Option<RecoveryState> {
        self.recovery_state.get(node_id).map(|e| e.value().clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::failure_detector::FailureDetectorConfig;

    fn setup() -> (Arc<PhiAccrualFailureDetector>, PeerRecoveryManager) {
        let detector = Arc::new(PhiAccrualFailureDetector::new(
            FailureDetectorConfig::default(),
        ));

        let active_peers: HashSet<NodeId> = (0..4).map(|_| NodeId::new_v4()).collect();
        let backup_peers: Vec<NodeId> = (0..2).map(|_| NodeId::new_v4()).collect();

        let manager = PeerRecoveryManager::new(
            detector.clone(),
            active_peers,
            backup_peers,
            PeerRecoveryConfig::default(),
        );

        (detector, manager)
    }

    #[tokio::test]
    async fn test_peer_replacement() {
        let (detector, manager) = setup();
        let failed_node = *manager.active_peers.read().iter().next().unwrap();

        detector.mark_failed(failed_node);

        let result = manager.replace_peer(failed_node).await;
        assert!(result.is_ok());
        assert!(!manager.active_peers.read().contains(&failed_node));
    }

    #[test]
    fn test_backoff_calculation() {
        let manager = setup().1;

        let backoff1 = manager.calculate_backoff(1);
        let backoff2 = manager.calculate_backoff(2);
        let backoff3 = manager.calculate_backoff(3);

        assert_eq!(backoff1, Duration::from_secs(1));
        assert_eq!(backoff2, Duration::from_secs(2));
        assert_eq!(backoff3, Duration::from_secs(4));
    }

    #[test]
    fn test_sufficient_peers() {
        let manager = setup().1;
        assert!(manager.has_sufficient_peers(3));
        assert!(manager.has_sufficient_peers(4));
        assert!(!manager.has_sufficient_peers(5));
    }
}
