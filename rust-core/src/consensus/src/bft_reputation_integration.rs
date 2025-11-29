//! Reputation-Integrated BFT Consensus Engine
//!
//! This module extends the BFT consensus engine with integrated reputation tracking.
//! All consensus events (finalization, participation, violations) are automatically
//! recorded in the reputation system.

use crate::{
    byzantine_detection::ByzantineDetector,
    error::{ConsensusError, Result},
    message::{Commit, ConsensusMessage, PrePrepare, Prepare},
    metrics::ConsensusMetrics,
    state::{ConsensusState, MessageLog},
    view_change::ViewChangeManager,
    NodeId, SequenceNumber, ViewNumber,
};
use cretoai_crypto::signatures::{SignatureScheme, ML_DSA_87};
use cretoai_dag::types::{Vertex, VertexHash};
use cretoai_reputation::{
    ActivityEvent, ActivityType, ReputationStatistics, ReputationTracker, ViolationType,
};
use dashmap::DashMap;
use parking_lot::RwLock;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Instant, SystemTime};
use tokio::sync::{mpsc, oneshot, RwLock as TokioRwLock};
use tracing::{debug, error, info, warn};

/// BFT Engine with integrated reputation tracking
pub struct ReputationBftEngine {
    /// Configuration
    config: super::BftConfig,

    /// Current view number
    view: AtomicU64,

    /// Current sequence number
    sequence: AtomicU64,

    /// Consensus state and message log
    message_log: Arc<MessageLog>,

    /// Byzantine detection
    byzantine_detector: Arc<RwLock<ByzantineDetector>>,

    /// View change manager
    view_change_manager: Arc<ViewChangeManager>,

    /// Metrics
    metrics: Arc<ConsensusMetrics>,

    /// Message channel
    message_tx: mpsc::UnboundedSender<ConsensusMessage>,
    message_rx: Arc<TokioRwLock<mpsc::UnboundedReceiver<ConsensusMessage>>>,

    /// Pending finalization callbacks
    pending_finalizations: Arc<DashMap<SequenceNumber, oneshot::Sender<VertexHash>>>,

    /// Signature scheme
    signature_scheme: Arc<dyn SignatureScheme>,

    /// Node's private key
    private_key: Vec<u8>,

    /// Node's public key
    public_key: Vec<u8>,

    /// Public keys of all nodes
    node_public_keys: Arc<DashMap<NodeId, Vec<u8>>>,

    /// Running flag
    running: Arc<AtomicBool>,

    /// Reputation tracker (INTEGRATED)
    reputation_tracker: Arc<ReputationTracker>,
}

impl ReputationBftEngine {
    /// Create new reputation-integrated BFT engine
    pub fn new(
        config: super::BftConfig,
        private_key: Vec<u8>,
        public_key: Vec<u8>,
    ) -> Result<Self> {
        let (message_tx, message_rx) = mpsc::unbounded_channel();
        let signature_scheme: Arc<dyn SignatureScheme> = Arc::new(ML_DSA_87::new());

        Ok(Self {
            config: config.clone(),
            view: AtomicU64::new(0),
            sequence: AtomicU64::new(0),
            message_log: Arc::new(MessageLog::new()),
            byzantine_detector: Arc::new(RwLock::new(ByzantineDetector::new(
                config.total_nodes,
            ))),
            view_change_manager: Arc::new(ViewChangeManager::new(
                config.node_id,
                config.total_nodes,
            )),
            metrics: Arc::new(ConsensusMetrics::new()),
            message_tx,
            message_rx: Arc::new(TokioRwLock::new(message_rx)),
            pending_finalizations: Arc::new(DashMap::new()),
            signature_scheme,
            private_key,
            public_key,
            node_public_keys: Arc::new(DashMap::new()),
            running: Arc::new(AtomicBool::new(false)),
            reputation_tracker: Arc::new(ReputationTracker::new()),
        })
    }

    /// Record activity with reputation system
    fn record_reputation_event(&self, node_id: NodeId, event_type: ActivityType) {
        if let Err(e) = self.reputation_tracker.record_activity(ActivityEvent {
            node_id,
            timestamp: SystemTime::now(),
            event_type,
            metadata: None,
        }) {
            error!(error = %e, node_id = %node_id, "Failed to record reputation event");
        }
    }

    /// Handle vertex finalization with reputation tracking
    pub async fn handle_committed_with_reputation(
        &self,
        sequence: SequenceNumber,
        vertex_hash: VertexHash,
    ) -> Result<()> {
        if self.message_log.is_finalized(sequence) {
            return Ok(());
        }

        let start_time = Instant::now();
        info!(sequence, vertex_hash = %hex::encode(&vertex_hash), "Vertex finalized");

        // Mark as finalized
        self.message_log
            .mark_finalized(sequence, vertex_hash.clone());
        self.message_log
            .set_state(sequence, ConsensusState::Committed);

        // Record finalization for proposer
        if let Some(pre_prepare) = self.message_log.get_pre_prepare(sequence) {
            self.record_reputation_event(
                pre_prepare.leader_id,
                ActivityType::VertexFinalized,
            );
        }

        // Trigger callback
        if let Some((_, callback)) = self.pending_finalizations.remove(&sequence) {
            let _ = callback.send(vertex_hash.clone());
        }

        // Update metrics
        self.metrics.vertices_finalized.inc();
        let finality_time = start_time.elapsed().as_millis() as f64;
        self.metrics.finality_time.observe(finality_time);

        Ok(())
    }

    /// Handle prepare message with reputation tracking
    pub async fn handle_prepare_with_reputation(&self, prepare: Prepare) -> Result<()> {
        let sequence = prepare.sequence;
        let view = prepare.view;

        debug!(sequence, view, node = %prepare.node_id, "Handling Prepare with reputation");

        // Validate view and sequence
        self.validate_view_and_sequence(view, sequence)?;

        // Verify signature
        if let Some(node_key) = self.node_public_keys.get(&prepare.node_id) {
            if !self.verify_signature(
                &prepare.message_digest(),
                &prepare.signature(),
                &node_key,
            )? {
                // Record violation
                self.record_reputation_event(
                    prepare.node_id,
                    ActivityType::ViolationDetected(ViolationType::InvalidSignature),
                );

                return Err(ConsensusError::InvalidSignature {
                    node_id: prepare.node_id,
                });
            }
        }

        // Add to message log
        let prepare_count = self.message_log.add_prepare(prepare.clone());
        self.metrics.prepares_received.inc();

        // Record consensus participation
        self.record_reputation_event(
            prepare.node_id,
            ActivityType::ConsensusParticipation,
        );

        // Check if we have quorum
        if prepare_count >= self.config.quorum_size() {
            self.handle_committed_with_reputation(sequence, prepare.vertex_hash)
                .await?;
        }

        Ok(())
    }

    /// Handle commit message with reputation tracking
    pub async fn handle_commit_with_reputation(&self, commit: Commit) -> Result<()> {
        let sequence = commit.sequence;
        let view = commit.view;

        debug!(sequence, view, node = %commit.node_id, "Handling Commit with reputation");

        // Validate view and sequence
        self.validate_view_and_sequence(view, sequence)?;

        // Verify signature
        if let Some(node_key) = self.node_public_keys.get(&commit.node_id) {
            if !self.verify_signature(
                &commit.message_digest(),
                &commit.signature(),
                &node_key,
            )? {
                // Record violation
                self.record_reputation_event(
                    commit.node_id,
                    ActivityType::ViolationDetected(ViolationType::InvalidSignature),
                );

                return Err(ConsensusError::InvalidSignature {
                    node_id: commit.node_id,
                });
            }
        }

        // Add to message log
        let commit_count = self.message_log.add_commit(commit.clone());
        self.metrics.commits_received.inc();

        // Record consensus participation
        self.record_reputation_event(
            commit.node_id,
            ActivityType::ConsensusParticipation,
        );

        // Check if we have quorum
        if commit_count >= self.config.quorum_size() {
            self.handle_committed_with_reputation(sequence, commit.vertex_hash)
                .await?;
        }

        Ok(())
    }

    /// Handle equivocation detection with reputation slashing
    pub fn handle_equivocation(&self, node_id: NodeId, sequence: SequenceNumber) {
        warn!(node_id = %node_id, sequence, "Equivocation detected");

        // Record violation
        self.record_reputation_event(
            node_id,
            ActivityType::ViolationDetected(ViolationType::Equivocation),
        );

        // Update byzantine detector
        self.byzantine_detector
            .write()
            .mark_byzantine(node_id);
    }

    /// Validate view and sequence numbers
    fn validate_view_and_sequence(
        &self,
        view: ViewNumber,
        sequence: SequenceNumber,
    ) -> Result<()> {
        let current_view = self.view.load(Ordering::SeqCst);
        if view < current_view {
            return Err(ConsensusError::InvalidView {
                expected: current_view,
                actual: view,
            });
        }
        Ok(())
    }

    /// Verify a signature
    fn verify_signature(
        &self,
        data: &[u8],
        signature: &[u8],
        public_key: &[u8],
    ) -> Result<bool> {
        self.signature_scheme
            .verify(public_key, data, signature)
            .map_err(|e| ConsensusError::Internal(e.to_string()))
    }

    // ============================================================================
    // Public Reputation API
    // ============================================================================

    /// Get reputation score for a node
    pub fn get_node_reputation(&self, node_id: &NodeId) -> f64 {
        self.reputation_tracker.get_reputation(node_id)
    }

    /// Get all nodes with reliable reputation (above threshold)
    pub fn get_reliable_nodes(&self) -> Vec<NodeId> {
        self.reputation_tracker
            .get_all_scores()
            .into_iter()
            .filter(|(node_id, _)| self.reputation_tracker.is_reliable(node_id))
            .map(|(node_id, _)| node_id)
            .collect()
    }

    /// Check if a node is reliable
    pub fn is_node_reliable(&self, node_id: &NodeId) -> bool {
        self.reputation_tracker.is_reliable(node_id)
    }

    /// Update reputation based on external event
    pub fn update_reputation(&self, node_id: &NodeId, event: ActivityEvent) -> Result<()> {
        self.reputation_tracker
            .record_activity(event)
            .map_err(|e| ConsensusError::Internal(e.to_string()))
    }

    /// Get reputation tracker reference
    pub fn reputation_tracker(&self) -> Arc<ReputationTracker> {
        self.reputation_tracker.clone()
    }

    /// Get reputation statistics
    pub fn get_reputation_statistics(&self) -> ReputationStatistics {
        self.reputation_tracker.get_statistics()
    }

    /// Apply time decay to all reputations
    pub fn decay_all_reputations(&self) {
        self.reputation_tracker.decay_all_reputations();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn generate_test_keypair() -> (Vec<u8>, Vec<u8>) {
        (vec![0u8; 32], vec![0u8; 32])
    }

    #[tokio::test]
    async fn test_reputation_integration() {
        let config = super::super::BftConfig {
            node_id: Uuid::new_v4(),
            total_nodes: 4,
            ..Default::default()
        };

        let (private_key, public_key) = generate_test_keypair();
        let engine = ReputationBftEngine::new(config, private_key, public_key).unwrap();

        // Initially, nodes should have default reputation
        let node_id = Uuid::new_v4();
        assert_eq!(engine.get_node_reputation(&node_id), 0.5);

        // Record positive event
        engine.record_reputation_event(node_id, ActivityType::VertexFinalized);

        // Reputation should increase
        assert!(engine.get_node_reputation(&node_id) > 0.5);
    }

    #[tokio::test]
    async fn test_violation_tracking() {
        let config = super::super::BftConfig {
            node_id: Uuid::new_v4(),
            total_nodes: 4,
            ..Default::default()
        };

        let (private_key, public_key) = generate_test_keypair();
        let engine = ReputationBftEngine::new(config, private_key, public_key).unwrap();

        let node_id = Uuid::new_v4();

        // Record equivocation violation
        engine.record_reputation_event(
            node_id,
            ActivityType::ViolationDetected(ViolationType::Equivocation),
        );

        // Reputation should decrease significantly
        assert!(engine.get_node_reputation(&node_id) < 0.5);
        assert!(!engine.is_node_reliable(&node_id));
    }

    #[tokio::test]
    async fn test_reliable_nodes_filtering() {
        let config = super::super::BftConfig {
            node_id: Uuid::new_v4(),
            total_nodes: 4,
            ..Default::default()
        };

        let (private_key, public_key) = generate_test_keypair();
        let engine = ReputationBftEngine::new(config, private_key, public_key).unwrap();

        // Create good and bad nodes
        let good_node = Uuid::new_v4();
        let bad_node = Uuid::new_v4();

        // Good node gets positive events
        for _ in 0..10 {
            engine.record_reputation_event(good_node, ActivityType::VertexFinalized);
        }

        // Bad node gets violations
        for _ in 0..5 {
            engine.record_reputation_event(
                bad_node,
                ActivityType::ViolationDetected(ViolationType::Equivocation),
            );
        }

        let reliable_nodes = engine.get_reliable_nodes();
        assert!(reliable_nodes.contains(&good_node));
        assert!(!reliable_nodes.contains(&bad_node));
    }
}
