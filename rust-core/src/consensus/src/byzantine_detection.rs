//! Byzantine node detection and reputation management

use crate::{NodeId, SequenceNumber};
use cretoai_dag::types::VertexHash;
use std::collections::{HashMap, HashSet};
use tracing::{info, warn};

/// Types of Byzantine violations
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Violation {
    /// Node sent conflicting messages for same (view, sequence)
    Equivocation {
        node_id: NodeId,
        sequence: SequenceNumber,
        hash1: VertexHash,
        hash2: VertexHash,
    },

    /// Node sent message with invalid signature
    InvalidSignature { node_id: NodeId },

    /// Node exceeded timeout constraints
    TimeoutViolation {
        node_id: NodeId,
        sequence: SequenceNumber,
    },

    /// Node sent malformed message
    MalformedMessage { node_id: NodeId },

    /// Node failed to participate in consensus
    NonParticipation { node_id: NodeId },
}

/// Byzantine behavior detector with reputation scoring
pub struct ByzantineDetector {
    /// Total nodes in network
    total_nodes: usize,

    /// Reputation scores (0.0 = banned, 1.0 = trusted)
    reputation_scores: HashMap<NodeId, f64>,

    /// Violation log
    violations: Vec<Violation>,

    /// Banned nodes
    banned_nodes: HashSet<NodeId>,

    /// Equivocation cache for detection
    message_cache: HashMap<(NodeId, SequenceNumber), VertexHash>,

    /// Reputation threshold for banning (default: 0.3)
    ban_threshold: f64,

    /// Reputation decay per violation (default: 0.1)
    violation_penalty: f64,
}

impl ByzantineDetector {
    /// Create new Byzantine detector
    pub fn new(total_nodes: usize) -> Self {
        Self {
            total_nodes,
            reputation_scores: HashMap::new(),
            violations: Vec::new(),
            banned_nodes: HashSet::new(),
            message_cache: HashMap::new(),
            ban_threshold: 0.3,
            violation_penalty: 0.1,
        }
    }

    /// Detect equivocation (conflicting messages)
    pub fn detect_equivocation(
        &mut self,
        node_id: NodeId,
        sequence: SequenceNumber,
        hash1: &VertexHash,
        hash2: &VertexHash,
    ) -> bool {
        if hash1 == hash2 {
            return false; // Not equivocation
        }

        // Check cache for existing message
        let key = (node_id, sequence);
        if let Some(cached_hash) = self.message_cache.get(&key) {
            if cached_hash != hash1 && cached_hash != hash2 {
                // Found third conflicting hash - severe violation
                warn!(
                    node_id = %node_id,
                    sequence,
                    "Multiple equivocations detected"
                );
                self.record_violation(Violation::Equivocation {
                    node_id,
                    sequence,
                    hash1: hash1.clone(),
                    hash2: hash2.clone(),
                });
                return true;
            }
        }

        // Cache this message
        self.message_cache.insert(key, hash1.clone());

        warn!(
            node_id = %node_id,
            sequence,
            "Equivocation detected"
        );

        self.record_violation(Violation::Equivocation {
            node_id,
            sequence,
            hash1: hash1.clone(),
            hash2: hash2.clone(),
        });

        true
    }

    /// Detect invalid signature
    pub fn detect_invalid_signature(&mut self, node_id: NodeId) -> bool {
        warn!(node_id = %node_id, "Invalid signature detected");
        self.record_violation(Violation::InvalidSignature { node_id });
        true
    }

    /// Detect timeout violation
    pub fn detect_timeout_violation(&mut self, node_id: NodeId, sequence: SequenceNumber) -> bool {
        warn!(
            node_id = %node_id,
            sequence,
            "Timeout violation detected"
        );
        self.record_violation(Violation::TimeoutViolation { node_id, sequence });
        true
    }

    /// Detect malformed message
    pub fn detect_malformed_message(&mut self, node_id: NodeId) -> bool {
        warn!(node_id = %node_id, "Malformed message detected");
        self.record_violation(Violation::MalformedMessage { node_id });
        true
    }

    /// Record violation and update reputation
    fn record_violation(&mut self, violation: Violation) {
        let node_id = match violation {
            Violation::Equivocation { node_id, .. } => node_id,
            Violation::InvalidSignature { node_id } => node_id,
            Violation::TimeoutViolation { node_id, .. } => node_id,
            Violation::MalformedMessage { node_id } => node_id,
            Violation::NonParticipation { node_id } => node_id,
        };

        // Add to violation log
        self.violations.push(violation.clone());

        // Update reputation
        self.update_reputation(node_id);
    }

    /// Update node reputation score
    pub fn update_reputation(&mut self, node_id: NodeId) {
        let current_score = self
            .reputation_scores
            .entry(node_id)
            .or_insert(1.0);

        // Decrease reputation by penalty
        *current_score = (*current_score - self.violation_penalty).max(0.0);

        info!(
            node_id = %node_id,
            reputation = current_score,
            "Reputation updated"
        );

        // Check if should be banned
        if *current_score < self.ban_threshold {
            self.ban_node(node_id);
        }
    }

    /// Ban a node
    pub fn ban_node(&mut self, node_id: NodeId) {
        if self.banned_nodes.insert(node_id) {
            warn!(node_id = %node_id, "Node banned for Byzantine behavior");
        }
    }

    /// Check if node is banned
    pub fn is_banned(&self, node_id: &NodeId) -> bool {
        self.banned_nodes.contains(node_id)
    }

    /// Get reputation score
    pub fn get_reputation(&self, node_id: &NodeId) -> f64 {
        self.reputation_scores.get(node_id).copied().unwrap_or(1.0)
    }

    /// Get violations for node
    pub fn get_violations(&self, node_id: &NodeId) -> Vec<&Violation> {
        self.violations
            .iter()
            .filter(|v| {
                match v {
                    Violation::Equivocation { node_id: nid, .. } => nid == node_id,
                    Violation::InvalidSignature { node_id: nid } => nid == node_id,
                    Violation::TimeoutViolation { node_id: nid, .. } => nid == node_id,
                    Violation::MalformedMessage { node_id: nid } => nid == node_id,
                    Violation::NonParticipation { node_id: nid } => nid == node_id,
                }
            })
            .collect()
    }

    /// Get all violations
    pub fn get_all_violations(&self) -> &[Violation] {
        &self.violations
    }

    /// Get banned nodes
    pub fn get_banned_nodes(&self) -> &HashSet<NodeId> {
        &self.banned_nodes
    }

    /// Get statistics
    pub fn stats(&self) -> ByzantineStats {
        ByzantineStats {
            total_violations: self.violations.len(),
            banned_nodes: self.banned_nodes.len(),
            nodes_tracked: self.reputation_scores.len(),
            avg_reputation: if self.reputation_scores.is_empty() {
                1.0
            } else {
                self.reputation_scores.values().sum::<f64>() / self.reputation_scores.len() as f64
            },
        }
    }

    /// Clean up old cache entries
    pub fn cleanup_cache(&mut self, keep_last_sequences: usize) {
        if self.message_cache.len() <= keep_last_sequences {
            return;
        }

        // Keep only recent sequences
        let mut sequences: Vec<_> = self
            .message_cache
            .keys()
            .map(|(_, seq)| *seq)
            .collect();
        sequences.sort_unstable();
        sequences.dedup();

        if sequences.len() > keep_last_sequences {
            let cutoff = sequences[sequences.len() - keep_last_sequences];
            self.message_cache.retain(|(_, seq), _| *seq >= cutoff);
        }
    }
}

#[derive(Debug, Clone)]
pub struct ByzantineStats {
    pub total_violations: usize,
    pub banned_nodes: usize,
    pub nodes_tracked: usize,
    pub avg_reputation: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_equivocation_detection() {
        let mut detector = ByzantineDetector::new(4);
        let node_id = NodeId::new_v4();

        let hash1 = VertexHash::new([1u8; 32]);
        let hash2 = VertexHash::new([2u8; 32]);

        // First message is cached
        assert!(detector.detect_equivocation(node_id, 1, &hash1, &hash2));

        // Reputation should decrease
        assert!(detector.get_reputation(&node_id) < 1.0);
    }

    #[test]
    fn test_reputation_banning() {
        let mut detector = ByzantineDetector::new(4);
        let node_id = NodeId::new_v4();

        // Multiple violations should lead to ban
        for i in 0..10 {
            detector.detect_invalid_signature(node_id);
        }

        assert!(detector.is_banned(&node_id));
        assert!(detector.get_reputation(&node_id) < 0.3);
    }
}
