//! View change and leader election (Raft-based)

use crate::{
    error::{ConsensusError, Result},
    message::{NewView, PreparedProof, ViewChange},
    NodeId, SequenceNumber, ViewNumber,
};
use dashmap::DashMap;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

/// View change manager for leader election
pub struct ViewChangeManager {
    /// This node's ID
    node_id: NodeId,

    /// Total nodes in network
    total_nodes: usize,

    /// Current view
    current_view: Arc<RwLock<ViewNumber>>,

    /// View change messages received
    view_change_messages: Arc<DashMap<ViewNumber, HashMap<NodeId, ViewChange>>>,

    /// Last view change timestamp
    last_view_change: Arc<RwLock<Instant>>,

    /// View change timeout (milliseconds)
    view_change_timeout_ms: u64,

    /// Ordered list of node IDs for leader election
    node_order: Vec<NodeId>,
}

impl ViewChangeManager {
    /// Create new view change manager
    pub fn new(node_id: NodeId, total_nodes: usize) -> Self {
        Self {
            node_id,
            total_nodes,
            current_view: Arc::new(RwLock::new(0)),
            view_change_messages: Arc::new(DashMap::new()),
            last_view_change: Arc::new(RwLock::new(Instant::now())),
            view_change_timeout_ms: 2000, // 2 seconds
            node_order: Vec::new(),
        }
    }

    /// Set node order for deterministic leader election
    pub fn set_node_order(&mut self, nodes: Vec<NodeId>) {
        self.node_order = nodes;
        self.node_order.sort();
    }

    /// Calculate leader for given view
    pub fn calculate_leader(&self, view: ViewNumber) -> Option<NodeId> {
        if self.node_order.is_empty() {
            return None;
        }

        let index = (view as usize) % self.node_order.len();
        Some(self.node_order[index])
    }

    /// Check if view change timeout occurred
    pub async fn check_timeout(&self) -> bool {
        let last_change = self.last_view_change.read().await;
        last_change.elapsed() > Duration::from_millis(self.view_change_timeout_ms)
    }

    /// Initiate view change
    pub async fn initiate_view_change(
        &self,
        last_sequence: SequenceNumber,
        prepared_proofs: Vec<PreparedProof>,
    ) -> Result<ViewChange> {
        let mut current_view = self.current_view.write().await;
        let new_view = *current_view + 1;

        info!(
            old_view = *current_view,
            new_view,
            "Initiating view change"
        );

        let view_change = ViewChange::new(new_view, last_sequence, self.node_id, prepared_proofs);

        *current_view = new_view;
        *self.last_view_change.write().await = Instant::now();

        Ok(view_change)
    }

    /// Handle incoming view change message
    pub async fn handle_view_change(&self, view_change: ViewChange) -> Result<()> {
        let new_view = view_change.new_view;
        let node_id = view_change.node_id;

        debug!(
            new_view,
            node_id = %node_id,
            "Handling view change message"
        );

        // Validate view number
        let current_view = *self.current_view.read().await;
        if new_view <= current_view {
            return Err(ConsensusError::InvalidView {
                expected: current_view + 1,
                actual: new_view,
            });
        }

        // Store view change message
        self.view_change_messages
            .entry(new_view)
            .or_insert_with(HashMap::new)
            .insert(node_id, view_change);

        // Check if we have quorum of view change messages
        let quorum_size = self.calculate_quorum();
        if let Some(messages) = self.view_change_messages.get(&new_view) {
            if messages.len() >= quorum_size {
                info!(
                    new_view,
                    count = messages.len(),
                    quorum = quorum_size,
                    "View change quorum reached"
                );

                // If we're the new leader, send NewView
                if self.calculate_leader(new_view) == Some(self.node_id) {
                    self.send_new_view(new_view, messages.values().cloned().collect())
                        .await?;
                }
            }
        }

        Ok(())
    }

    /// Send NewView message (new leader)
    async fn send_new_view(
        &self,
        new_view: ViewNumber,
        view_change_messages: Vec<ViewChange>,
    ) -> Result<()> {
        info!(new_view, "Sending NewView as new leader");

        // Collect prepared proofs from view change messages
        let prepared_proofs = self.collect_prepared_proofs(&view_change_messages);

        // Create pre-prepare messages for prepared sequences
        let pre_prepare_messages = Vec::new(); // Create from prepared proofs

        let new_view_msg = NewView::new(
            new_view,
            view_change_messages,
            pre_prepare_messages,
            self.node_id,
        );

        // Broadcast NewView (implementation depends on network layer)
        // For now, just log
        debug!(new_view, "NewView message created");

        Ok(())
    }

    /// Handle incoming NewView message
    pub async fn handle_new_view(&self, new_view: NewView) -> Result<()> {
        let view = new_view.view;

        info!(view, leader = %new_view.leader_id, "Handling NewView message");

        // Validate that sender is the correct leader
        if self.calculate_leader(view) != Some(new_view.leader_id) {
            return Err(ConsensusError::NotLeader { view });
        }

        // Validate view change quorum
        let quorum_size = self.calculate_quorum();
        if new_view.view_change_messages.len() < quorum_size {
            return Err(ConsensusError::QuorumNotReached {
                current: new_view.view_change_messages.len(),
                required: quorum_size,
            });
        }

        // Update current view
        *self.current_view.write().await = view;
        *self.last_view_change.write().await = Instant::now();

        info!(view, "View change completed");

        Ok(())
    }

    /// Collect prepared proofs from view change messages
    fn collect_prepared_proofs(&self, messages: &[ViewChange]) -> Vec<PreparedProof> {
        let mut proofs: HashMap<SequenceNumber, PreparedProof> = HashMap::new();

        for msg in messages {
            for proof in &msg.prepared_proofs {
                proofs
                    .entry(proof.sequence)
                    .or_insert_with(|| proof.clone());
            }
        }

        proofs.into_values().collect()
    }

    /// Calculate quorum size (2f+1)
    fn calculate_quorum(&self) -> usize {
        let f = (self.total_nodes - 1) / 3;
        2 * f + 1
    }

    /// Get current view
    pub async fn current_view(&self) -> ViewNumber {
        *self.current_view.read().await
    }

    /// Get view change statistics
    pub async fn stats(&self) -> ViewChangeStats {
        ViewChangeStats {
            current_view: *self.current_view.read().await,
            pending_view_changes: self.view_change_messages.len(),
            seconds_since_last_change: self.last_view_change.read().await.elapsed().as_secs(),
        }
    }
}

/// View change proof for consensus
#[derive(Debug, Clone)]
pub struct ViewChangeProof {
    pub view: ViewNumber,
    pub quorum_messages: Vec<ViewChange>,
}

impl ViewChangeProof {
    pub fn new(view: ViewNumber, messages: Vec<ViewChange>) -> Self {
        Self {
            view,
            quorum_messages: messages,
        }
    }

    pub fn verify_quorum(&self, total_nodes: usize) -> bool {
        let f = (total_nodes - 1) / 3;
        let quorum = 2 * f + 1;
        self.quorum_messages.len() >= quorum
    }
}

#[derive(Debug, Clone)]
pub struct ViewChangeStats {
    pub current_view: ViewNumber,
    pub pending_view_changes: usize,
    pub seconds_since_last_change: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_leader_calculation() {
        let node1 = NodeId::new_v4();
        let node2 = NodeId::new_v4();
        let node3 = NodeId::new_v4();

        let mut manager = ViewChangeManager::new(node1, 3);
        manager.set_node_order(vec![node1, node2, node3]);

        // View 0 -> node1 (index 0)
        assert_eq!(manager.calculate_leader(0), Some(node1));

        // View 1 -> node2 (index 1)
        assert_eq!(manager.calculate_leader(1), Some(node2));

        // View 2 -> node3 (index 2)
        assert_eq!(manager.calculate_leader(2), Some(node3));

        // View 3 -> node1 (wraps around)
        assert_eq!(manager.calculate_leader(3), Some(node1));
    }

    #[tokio::test]
    async fn test_view_change_initiation() {
        let node_id = NodeId::new_v4();
        let manager = ViewChangeManager::new(node_id, 4);

        let view_change = manager.initiate_view_change(10, Vec::new()).await.unwrap();

        assert_eq!(view_change.new_view, 1);
        assert_eq!(view_change.last_sequence, 10);
        assert_eq!(view_change.node_id, node_id);
    }
}
