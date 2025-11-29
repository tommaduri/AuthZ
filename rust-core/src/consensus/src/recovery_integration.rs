//! Recovery Integration for BFT Engine
//!
//! Integrates graceful degradation components with the main BFT engine

use crate::{
    degraded_mode::DegradedModeManager,
    error::{ConsensusError, Result},
    failure_detector::PhiAccrualFailureDetector,
    fork_reconciliation::{Fork, ForkReconciliator},
    peer_recovery::PeerRecoveryManager,
    state_sync::StateSynchronizer,
    NodeId,
};
use cretoai_dag::types::VertexHash;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::sleep;
use tracing::{error, info, warn};

/// Recovery-enabled BFT engine wrapper
pub struct RecoveryEnabledBft {
    /// Failure detector
    pub failure_detector: Arc<PhiAccrualFailureDetector>,

    /// Peer recovery manager
    pub peer_recovery: Arc<PeerRecoveryManager>,

    /// Fork reconciliator
    pub fork_reconciliator: Arc<ForkReconciliator>,

    /// State synchronizer
    pub state_sync: Arc<StateSynchronizer>,

    /// Degraded mode manager
    pub degraded_mode: Arc<DegradedModeManager>,
}

impl RecoveryEnabledBft {
    /// Create new recovery-enabled BFT wrapper
    pub fn new(
        failure_detector: Arc<PhiAccrualFailureDetector>,
        peer_recovery: Arc<PeerRecoveryManager>,
        fork_reconciliator: Arc<ForkReconciliator>,
        state_sync: Arc<StateSynchronizer>,
        degraded_mode: Arc<DegradedModeManager>,
    ) -> Self {
        info!("Initializing recovery-enabled BFT engine");

        Self {
            failure_detector,
            peer_recovery,
            fork_reconciliator,
            state_sync,
            degraded_mode,
        }
    }

    /// Handle peer failure
    pub async fn handle_peer_failure(&self, node_id: NodeId) -> Result<()> {
        error!(node_id = %node_id, "Handling peer failure");

        // Mark as failed in detector
        self.failure_detector.mark_failed(node_id);

        // Attempt recovery
        self.peer_recovery.handle_dead_peer(node_id).await?;

        // Re-evaluate degraded mode
        self.degraded_mode.evaluate_mode().await;

        Ok(())
    }

    /// Detect and reconcile fork
    pub async fn reconcile_fork(&self, fork: Fork) -> Result<()> {
        warn!(
            lca = %hex::encode(&fork.common_ancestor),
            "Reconciling detected fork"
        );

        // Resolve fork using reputation
        let resolution = self.fork_reconciliator.resolve_fork(fork.clone()).await?;

        // Apply resolution
        match resolution {
            crate::fork_reconciliation::Resolution::ChooseChainA { rolled_back } => {
                info!(
                    rolled_back_count = rolled_back.len(),
                    "Chose chain A, rolling back chain B"
                );
            }
            crate::fork_reconciliation::Resolution::ChooseChainB { rolled_back } => {
                info!(
                    rolled_back_count = rolled_back.len(),
                    "Chose chain B, rolling back chain A"
                );
            }
            crate::fork_reconciliation::Resolution::Merge { merged_vertices } => {
                info!(
                    merged_count = merged_vertices.len(),
                    "Merging both chains (partition recovery)"
                );
            }
            crate::fork_reconciliation::Resolution::ManualIntervention { reason } => {
                error!(reason = %reason, "Fork requires manual intervention");
                return Err(ConsensusError::ForkNotResolved);
            }
        }

        Ok(())
    }

    /// Sync state with peer
    pub async fn sync_state_with_peer(&self, peer: NodeId) -> Result<()> {
        info!(peer = %peer, "Synchronizing state with peer");

        self.state_sync.sync_with_peer(peer).await?;

        info!(peer = %peer, "State synchronization complete");
        Ok(())
    }

    /// Start recovery monitoring loop
    pub async fn start_recovery_monitoring(&self) -> Result<()> {
        info!("Starting recovery monitoring loop");

        tokio::spawn({
            let failure_detector = self.failure_detector.clone();
            let peer_recovery = self.peer_recovery.clone();
            let degraded_mode = self.degraded_mode.clone();

            async move {
                loop {
                    // Check for failed peers
                    let failed_peers = failure_detector.get_failed();
                    for peer in failed_peers {
                        if let Err(e) = peer_recovery.handle_dead_peer(peer).await {
                            error!(peer = %peer, error = %e, "Failed to handle dead peer");
                        }
                    }

                    // Evaluate degraded mode
                    degraded_mode.evaluate_mode().await;

                    sleep(Duration::from_secs(1)).await;
                }
            }
        });

        Ok(())
    }

    /// Get system health status
    pub fn health_status(&self) -> HealthStatus {
        let stats = self.failure_detector.get_stats();
        let mode = self.degraded_mode.current_mode();
        let health_pct = self.degraded_mode.health_percentage();

        HealthStatus {
            total_nodes: stats.total_nodes,
            available_nodes: stats.available_count,
            suspected_nodes: stats.suspected_count,
            failed_nodes: stats.failed_count,
            operation_mode: mode,
            health_percentage: health_pct,
        }
    }

    /// Check if system is operational
    pub fn is_operational(&self, quorum_size: usize) -> bool {
        self.peer_recovery.has_sufficient_peers(quorum_size)
            && !matches!(
                self.degraded_mode.current_mode(),
                crate::degraded_mode::OperationMode::Critical
            )
    }
}

/// System health status
#[derive(Debug, Clone)]
pub struct HealthStatus {
    pub total_nodes: usize,
    pub available_nodes: usize,
    pub suspected_nodes: usize,
    pub failed_nodes: usize,
    pub operation_mode: crate::degraded_mode::OperationMode,
    pub health_percentage: f64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        degraded_mode::ConsensusParams,
        failure_detector::FailureDetectorConfig,
        fork_reconciliation::ReputationTracker,
        peer_recovery::PeerRecoveryConfig,
    };
    use cretoai_dag::storage::DAGStorage;
    use cretoai_dag::DAG;
    use std::collections::HashSet;

    fn setup() -> RecoveryEnabledBft {
        let detector = Arc::new(PhiAccrualFailureDetector::new(
            FailureDetectorConfig::default(),
        ));

        let active_peers: HashSet<NodeId> = (0..10).map(|_| NodeId::new_v4()).collect();
        let backup_peers: Vec<NodeId> = (0..5).map(|_| NodeId::new_v4()).collect();

        let peer_recovery = Arc::new(PeerRecoveryManager::new(
            detector.clone(),
            active_peers,
            backup_peers,
            PeerRecoveryConfig::default(),
        ));

        let storage = Arc::new(DAGStorage::new_in_memory());
        let dag = Arc::new(DAG::new(storage));
        let reputation = Arc::new(ReputationTracker::new(1.0));
        let fork_reconciliator = Arc::new(ForkReconciliator::new(dag, reputation));

        let state_sync = Arc::new(StateSynchronizer::new(Duration::from_secs(30), None));

        let degraded_mode = Arc::new(DegradedModeManager::new(
            peer_recovery.clone(),
            ConsensusParams::default(),
            10,
        ));

        RecoveryEnabledBft::new(
            detector,
            peer_recovery,
            fork_reconciliator,
            state_sync,
            degraded_mode,
        )
    }

    #[tokio::test]
    async fn test_peer_failure_handling() {
        let recovery_bft = setup();
        let node_id = NodeId::new_v4();

        let result = recovery_bft.handle_peer_failure(node_id).await;
        assert!(result.is_ok() || matches!(result, Err(ConsensusError::NoBackupPeers)));
    }

    #[test]
    fn test_health_status() {
        let recovery_bft = setup();
        let status = recovery_bft.health_status();

        assert_eq!(status.total_nodes, 10);
        assert!(status.health_percentage > 0.0);
    }

    #[test]
    fn test_operational_check() {
        let recovery_bft = setup();
        assert!(recovery_bft.is_operational(7));
    }
}
