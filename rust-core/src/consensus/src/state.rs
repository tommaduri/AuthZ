//! Consensus state management

use crate::{
    message::{Commit, Prepare, PrePrepare},
    NodeId, SequenceNumber, ViewNumber,
};
use cretoai_dag::types::VertexHash;
use dashmap::DashMap;
use parking_lot::RwLock;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

/// Current consensus state
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ConsensusState {
    /// Waiting for pre-prepare
    Idle,
    /// Received pre-prepare, waiting for prepares
    PrePrepared,
    /// Received 2f+1 prepares, waiting for commits
    Prepared,
    /// Received 2f+1 commits, ready to execute
    Committed,
    /// View change in progress
    ViewChanging,
}

/// Message log for consensus protocol
pub struct MessageLog {
    /// Pre-prepare messages by sequence number
    pre_prepares: DashMap<SequenceNumber, PrePrepare>,

    /// Prepare messages by (sequence, node_id)
    prepares: DashMap<SequenceNumber, HashMap<NodeId, Prepare>>,

    /// Commit messages by (sequence, node_id)
    commits: DashMap<SequenceNumber, HashMap<NodeId, Commit>>,

    /// State for each sequence number
    states: DashMap<SequenceNumber, ConsensusState>,

    /// Finalized vertices by sequence number
    finalized: DashMap<SequenceNumber, VertexHash>,
}

impl MessageLog {
    pub fn new() -> Self {
        Self {
            pre_prepares: DashMap::new(),
            prepares: DashMap::new(),
            commits: DashMap::new(),
            states: DashMap::new(),
            finalized: DashMap::new(),
        }
    }

    /// Add pre-prepare message
    pub fn add_pre_prepare(&self, msg: PrePrepare) -> bool {
        let sequence = msg.sequence;
        self.states.insert(sequence, ConsensusState::PrePrepared);
        self.pre_prepares.insert(sequence, msg).is_none()
    }

    /// Get pre-prepare message
    pub fn get_pre_prepare(&self, sequence: SequenceNumber) -> Option<PrePrepare> {
        self.pre_prepares.get(&sequence).map(|r| r.clone())
    }

    /// Add prepare message
    pub fn add_prepare(&self, msg: Prepare) -> usize {
        let sequence = msg.sequence;
        let node_id = msg.node_id;

        self.prepares
            .entry(sequence)
            .or_insert_with(HashMap::new)
            .insert(node_id, msg);

        self.prepares.get(&sequence).map(|r| r.len()).unwrap_or(0)
    }

    /// Get prepare messages for sequence
    pub fn get_prepares(&self, sequence: SequenceNumber) -> Vec<Prepare> {
        self.prepares
            .get(&sequence)
            .map(|r| r.values().cloned().collect())
            .unwrap_or_default()
    }

    /// Count prepare messages for sequence
    pub fn count_prepares(&self, sequence: SequenceNumber) -> usize {
        self.prepares
            .get(&sequence)
            .map(|r| r.len())
            .unwrap_or(0)
    }

    /// Add commit message
    pub fn add_commit(&self, msg: Commit) -> usize {
        let sequence = msg.sequence;
        let node_id = msg.node_id;

        self.commits
            .entry(sequence)
            .or_insert_with(HashMap::new)
            .insert(node_id, msg);

        self.commits.get(&sequence).map(|r| r.len()).unwrap_or(0)
    }

    /// Get commit messages for sequence
    pub fn get_commits(&self, sequence: SequenceNumber) -> Vec<Commit> {
        self.commits
            .get(&sequence)
            .map(|r| r.values().cloned().collect())
            .unwrap_or_default()
    }

    /// Count commit messages for sequence
    pub fn count_commits(&self, sequence: SequenceNumber) -> usize {
        self.commits
            .get(&sequence)
            .map(|r| r.len())
            .unwrap_or(0)
    }

    /// Update state for sequence
    pub fn set_state(&self, sequence: SequenceNumber, state: ConsensusState) {
        self.states.insert(sequence, state);
    }

    /// Get state for sequence
    pub fn get_state(&self, sequence: SequenceNumber) -> ConsensusState {
        self.states
            .get(&sequence)
            .map(|r| *r)
            .unwrap_or(ConsensusState::Idle)
    }

    /// Mark sequence as finalized
    pub fn mark_finalized(&self, sequence: SequenceNumber, vertex_hash: VertexHash) {
        self.finalized.insert(sequence, vertex_hash);
        self.set_state(sequence, ConsensusState::Committed);
    }

    /// Check if sequence is finalized
    pub fn is_finalized(&self, sequence: SequenceNumber) -> bool {
        self.finalized.contains_key(&sequence)
    }

    /// Get finalized vertex hash
    pub fn get_finalized(&self, sequence: SequenceNumber) -> Option<VertexHash> {
        self.finalized.get(&sequence).map(|r| r.clone())
    }

    /// Clean up old messages (keep last N sequences)
    pub fn cleanup(&self, keep_last: usize) {
        if self.finalized.len() <= keep_last {
            return;
        }

        let mut sequences: Vec<_> = self.finalized.iter().map(|r| *r.key()).collect();
        sequences.sort_unstable();

        let cutoff = sequences.len() - keep_last;
        for seq in sequences.iter().take(cutoff) {
            self.pre_prepares.remove(seq);
            self.prepares.remove(seq);
            self.commits.remove(seq);
            self.states.remove(seq);
        }
    }

    /// Get statistics
    pub fn stats(&self) -> MessageLogStats {
        MessageLogStats {
            pre_prepares: self.pre_prepares.len(),
            prepares: self.prepares.len(),
            commits: self.commits.len(),
            finalized: self.finalized.len(),
        }
    }
}

impl Default for MessageLog {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone)]
pub struct MessageLogStats {
    pub pre_prepares: usize,
    pub prepares: usize,
    pub commits: usize,
    pub finalized: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_log() {
        let log = MessageLog::new();
        let seq = 1;

        // Initially idle
        assert_eq!(log.get_state(seq), ConsensusState::Idle);

        // Add pre-prepare
        let pre_prepare = PrePrepare::new(
            1,
            seq,
            VertexHash::new([0u8; 32]),
            vec![],
            NodeId::new_v4(),
        );
        log.add_pre_prepare(pre_prepare);
        assert_eq!(log.get_state(seq), ConsensusState::PrePrepared);

        // Add prepares
        for i in 0..3 {
            let prepare = Prepare::new(
                1,
                seq,
                VertexHash::new([0u8; 32]),
                NodeId::new_v4(),
            );
            log.add_prepare(prepare);
        }
        assert_eq!(log.count_prepares(seq), 3);
    }
}
