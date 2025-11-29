//! Reputation Tracking System (Phase 7)
//!
//! Implements a production-ready reputation scoring system for validators with:
//! - Historical reputation tracking with exponential time decay
//! - Behavior analysis (uptime, correctness, response time)
//! - Byzantine violation tracking and penalties
//! - Thread-safe concurrent access via DashMap
//! - Activity history management

use crate::error::Result;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

// Re-export types from types module
pub use crate::types::{
    ActivityEvent, ActivityType, NodeId, ReputationConfig, ReputationScore, ViolationType,
};

/// Maximum activity events stored per node
const MAX_ACTIVITY_HISTORY: usize = 1000;

/// Default decay period (30 days in seconds)
const DEFAULT_DECAY_HALF_LIFE: u64 = 30 * 24 * 3600;

/// Node reputation data
#[derive(Debug, Clone, Serialize, Deserialize)]
struct NodeReputation {
    /// Current reputation score (0.0 - 1.0)
    score: f64,

    /// Last activity timestamp
    last_activity: SystemTime,

    /// First activity timestamp (for uptime calculation)
    first_activity: SystemTime,

    /// Activity history (limited to MAX_ACTIVITY_HISTORY)
    activity_history: VecDeque<ActivityEvent>,

    /// Violation counts by type
    violations: HashMap<ViolationType, u64>,

    /// Total positive events
    positive_events: u64,

    /// Total negative events
    negative_events: u64,
}

impl NodeReputation {
    /// Create new node reputation with initial score
    fn new(initial_score: f64) -> Self {
        let now = SystemTime::now();
        Self {
            score: initial_score,
            last_activity: now,
            first_activity: now,
            activity_history: VecDeque::with_capacity(MAX_ACTIVITY_HISTORY),
            violations: HashMap::new(),
            positive_events: 0,
            negative_events: 0,
        }
    }

    /// Add activity event to history
    fn add_activity(&mut self, event: ActivityEvent) {
        self.last_activity = event.timestamp;

        // Maintain max history size
        if self.activity_history.len() >= MAX_ACTIVITY_HISTORY {
            self.activity_history.pop_front();
        }

        self.activity_history.push_back(event);
    }

    /// Increment violation count
    fn record_violation(&mut self, violation_type: ViolationType) {
        *self.violations.entry(violation_type).or_insert(0) += 1;
        self.negative_events += 1;
    }

    /// Calculate uptime percentage based on activity history
    fn calculate_uptime(&self) -> f64 {
        if self.activity_history.is_empty() {
            return 0.0;
        }

        let total_duration = SystemTime::now()
            .duration_since(self.first_activity)
            .unwrap_or(Duration::from_secs(1))
            .as_secs() as f64;

        if total_duration < 1.0 {
            return 1.0;
        }

        // Calculate activity windows
        let mut active_time = 0.0;
        let activity_timeout = 300.0; // 5 minutes

        // Convert VecDeque to slice for iteration
        let history: Vec<_> = self.activity_history.iter().collect();
        for window in history.windows(2) {
            if let Ok(gap) = window[1].timestamp.duration_since(window[0].timestamp) {
                let gap_secs = gap.as_secs() as f64;
                // Count as active if gap is less than timeout
                if gap_secs < activity_timeout {
                    active_time += gap_secs;
                }
            }
        }

        (active_time / total_duration).min(1.0)
    }
}

/// Production-ready reputation tracker with thread-safe concurrent access
#[derive(Clone)]
pub struct ReputationTracker {
    /// Node reputation data (thread-safe)
    nodes: Arc<DashMap<NodeId, NodeReputation>>,

    /// Configuration
    config: Arc<ReputationConfig>,
}

impl ReputationTracker {
    /// Create a new reputation tracker with default configuration
    pub fn new() -> Self {
        Self::with_config(ReputationConfig::default())
    }

    /// Create a reputation tracker with custom configuration
    pub fn with_config(config: ReputationConfig) -> Self {
        Self {
            nodes: Arc::new(DashMap::new()),
            config: Arc::new(config),
        }
    }

    /// Get reputation score for a node
    pub fn get_reputation(&self, node_id: &NodeId) -> f64 {
        self.nodes
            .get(node_id)
            .map(|entry| entry.score)
            .unwrap_or(self.config.initial_reputation)
    }

    /// Record activity event and update reputation
    pub fn record_activity(&self, event: ActivityEvent) -> Result<()> {
        let node_id = event.node_id;
        let mut entry = self.nodes.entry(node_id).or_insert_with(|| {
            NodeReputation::new(self.config.initial_reputation)
        });

        // Calculate reputation change based on event type
        let delta = match &event.event_type {
            ActivityType::VertexFinalized => 0.01,           // +1%
            ActivityType::ConsensusParticipation => 0.005,   // +0.5%
            ActivityType::VertexPropagation => 0.002,        // +0.2%
            ActivityType::ByzantineDetection => 0.03,        // +3%
            ActivityType::ViolationDetected(violation) => {
                entry.record_violation(*violation);
                match violation {
                    ViolationType::Equivocation => -0.20,          // -20%
                    ViolationType::ByzantineBehavior => -0.15,     // -15%
                    ViolationType::InvalidSignature => -0.10,      // -10%
                    ViolationType::ProtocolViolation => -0.05,     // -5%
                    ViolationType::TimeoutViolation => -0.02,      // -2%
                }
            }
        };

        // Update score with bounds checking
        let new_score = (entry.score + delta).clamp(0.0, self.config.max_reputation);
        entry.score = new_score;

        // Track event type
        if delta > 0.0 {
            entry.positive_events += 1;
        }

        // Add to activity history
        entry.add_activity(event);

        Ok(())
    }

    /// Apply exponential time decay to a node's reputation
    /// Formula: score * exp(-ln(2) * elapsed / half_life)
    pub fn decay_reputation(&self, node_id: &NodeId) -> f64 {
        let mut entry = match self.nodes.get_mut(node_id) {
            Some(entry) => entry,
            None => return self.config.initial_reputation,
        };

        let now = SystemTime::now();
        let elapsed = now
            .duration_since(entry.last_activity)
            .unwrap_or(Duration::from_secs(0))
            .as_secs() as f64;

        let half_life = self.config.decay_half_life.as_secs() as f64;

        // Exponential decay: score * exp(-ln(2) * elapsed / half_life)
        let decay_factor = (-std::f64::consts::LN_2 * elapsed / half_life).exp();
        let decayed_score = entry.score * decay_factor;

        // Apply minimum threshold
        let new_score = decayed_score.max(0.0);
        entry.score = new_score;

        new_score
    }

    /// Check if a node is considered reliable (above minimum threshold)
    pub fn is_reliable(&self, node_id: &NodeId) -> bool {
        let score = self.get_reputation(node_id);
        score >= self.config.min_threshold
    }

    /// Get violation counts for a node
    pub fn get_violations(&self, node_id: &NodeId) -> HashMap<ViolationType, u64> {
        self.nodes
            .get(node_id)
            .map(|entry| entry.violations.clone())
            .unwrap_or_default()
    }

    /// Get activity history for a node with optional limit
    pub fn get_activity_history(&self, node_id: &NodeId, limit: usize) -> Vec<ActivityEvent> {
        self.nodes
            .get(node_id)
            .map(|entry| {
                entry
                    .activity_history
                    .iter()
                    .rev()
                    .take(limit)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get all reputation scores
    pub fn get_all_scores(&self) -> HashMap<NodeId, f64> {
        self.nodes
            .iter()
            .map(|entry| (*entry.key(), entry.value().score))
            .collect()
    }

    /// Get ranked list of nodes by reputation score
    pub fn get_ranked_nodes(&self, limit: usize) -> Vec<(NodeId, f64)> {
        let mut nodes: Vec<(NodeId, f64)> = self
            .nodes
            .iter()
            .map(|entry| (*entry.key(), entry.value().score))
            .collect();

        // Sort by score descending
        nodes.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        nodes.into_iter().take(limit).collect()
    }

    /// Calculate uptime percentage for a node
    pub fn calculate_uptime(&self, node_id: &NodeId) -> f64 {
        self.nodes
            .get(node_id)
            .map(|entry| entry.calculate_uptime())
            .unwrap_or(0.0)
    }

    /// Reset reputation to initial score
    pub fn reset_reputation(&self, node_id: &NodeId) {
        if let Some(mut entry) = self.nodes.get_mut(node_id) {
            entry.score = self.config.initial_reputation;
            entry.violations.clear();
            entry.activity_history.clear();
            entry.positive_events = 0;
            entry.negative_events = 0;
            entry.last_activity = SystemTime::now();
        }
    }

    /// Get comprehensive statistics about the reputation system
    pub fn get_statistics(&self) -> ReputationStatistics {
        let mut stats = ReputationStatistics::default();

        for entry in self.nodes.iter() {
            let node_rep = entry.value();
            stats.total_nodes += 1;

            if node_rep.score >= self.config.min_threshold {
                stats.reliable_nodes += 1;
            }

            if node_rep.score < self.config.min_threshold {
                stats.unreliable_nodes += 1;
            }

            stats.total_violations += node_rep.violations.values().sum::<u64>();
            stats.total_positive_events += node_rep.positive_events;
            stats.total_negative_events += node_rep.negative_events;

            stats.average_score += node_rep.score;

            if node_rep.score > stats.highest_score {
                stats.highest_score = node_rep.score;
            }

            if node_rep.score < stats.lowest_score || stats.lowest_score == 0.0 {
                stats.lowest_score = node_rep.score;
            }
        }

        if stats.total_nodes > 0 {
            stats.average_score /= stats.total_nodes as f64;
        }

        stats
    }

    /// Apply time decay to all nodes
    pub fn decay_all_reputations(&self) {
        for entry in self.nodes.iter() {
            let node_id = *entry.key();
            drop(entry); // Release the read lock
            self.decay_reputation(&node_id);
        }
    }

    /// Remove nodes below minimum threshold (cleanup)
    pub fn prune_unreliable_nodes(&self) -> usize {
        let mut removed = 0;
        let to_remove: Vec<NodeId> = self
            .nodes
            .iter()
            .filter(|entry| entry.value().score < self.config.min_threshold)
            .map(|entry| *entry.key())
            .collect();

        for node_id in to_remove {
            self.nodes.remove(&node_id);
            removed += 1;
        }

        removed
    }

    /// Get configuration
    pub fn get_config(&self) -> &ReputationConfig {
        &self.config
    }

    /// Get total number of tracked nodes
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }
}

impl Default for ReputationTracker {
    fn default() -> Self {
        Self::new()
    }
}

/// Comprehensive reputation system statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ReputationStatistics {
    /// Total number of tracked nodes
    pub total_nodes: usize,

    /// Number of reliable nodes (above threshold)
    pub reliable_nodes: usize,

    /// Number of unreliable nodes (below threshold)
    pub unreliable_nodes: usize,

    /// Average reputation score
    pub average_score: f64,

    /// Highest reputation score
    pub highest_score: f64,

    /// Lowest reputation score
    pub lowest_score: f64,

    /// Total violations across all nodes
    pub total_violations: u64,

    /// Total positive events
    pub total_positive_events: u64,

    /// Total negative events
    pub total_negative_events: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn create_test_event(
        node_id: NodeId,
        event_type: ActivityType,
    ) -> ActivityEvent {
        ActivityEvent {
            node_id,
            timestamp: SystemTime::now(),
            event_type,
            metadata: None,
        }
    }

    #[test]
    fn test_initial_reputation() {
        let tracker = ReputationTracker::new();
        let node_id = Uuid::new_v4();

        // New node should have initial reputation
        assert_eq!(tracker.get_reputation(&node_id), 0.5);
    }

    #[test]
    fn test_reputation_increase() {
        let tracker = ReputationTracker::new();
        let node_id = Uuid::new_v4();

        // Record positive event
        let event = create_test_event(node_id, ActivityType::VertexFinalized);
        tracker.record_activity(event).unwrap();

        // Reputation should increase by 1%
        assert!((tracker.get_reputation(&node_id) - 0.51).abs() < 0.001);
    }

    #[test]
    fn test_reputation_decrease() {
        let tracker = ReputationTracker::new();
        let node_id = Uuid::new_v4();

        // Record violation
        let event = create_test_event(
            node_id,
            ActivityType::ViolationDetected(ViolationType::Equivocation),
        );
        tracker.record_activity(event).unwrap();

        // Reputation should decrease by 20%
        assert!((tracker.get_reputation(&node_id) - 0.30).abs() < 0.001);
    }

    #[test]
    fn test_reputation_capping() {
        let tracker = ReputationTracker::new();
        let node_id = Uuid::new_v4();

        // Record many positive events
        for _ in 0..100 {
            let event = create_test_event(node_id, ActivityType::VertexFinalized);
            tracker.record_activity(event).unwrap();
        }

        // Reputation should cap at 1.0
        assert_eq!(tracker.get_reputation(&node_id), 1.0);

        // Record many violations
        for _ in 0..100 {
            let event = create_test_event(
                node_id,
                ActivityType::ViolationDetected(ViolationType::Equivocation),
            );
            tracker.record_activity(event).unwrap();
        }

        // Reputation should floor at 0.0
        assert_eq!(tracker.get_reputation(&node_id), 0.0);
    }

    #[test]
    fn test_time_decay() {
        let config = ReputationConfig {
            decay_half_life: Duration::from_secs(1), // 1 second half-life for testing
            ..Default::default()
        };
        let tracker = ReputationTracker::with_config(config);
        let node_id = Uuid::new_v4();

        // Set high reputation
        for _ in 0..50 {
            let event = create_test_event(node_id, ActivityType::VertexFinalized);
            tracker.record_activity(event).unwrap();
        }

        let initial_score = tracker.get_reputation(&node_id);
        assert!(initial_score > 0.5);

        // Wait and apply decay
        std::thread::sleep(Duration::from_secs(2));
        let decayed_score = tracker.decay_reputation(&node_id);

        // Score should have decayed
        assert!(decayed_score < initial_score);
    }

    #[test]
    fn test_violation_tracking() {
        let tracker = ReputationTracker::new();
        let node_id = Uuid::new_v4();

        // Record different violations
        let violations = vec![
            ViolationType::Equivocation,
            ViolationType::InvalidSignature,
            ViolationType::Equivocation,
        ];

        for violation in violations {
            let event = create_test_event(
                node_id,
                ActivityType::ViolationDetected(violation),
            );
            tracker.record_activity(event).unwrap();
        }

        let violation_counts = tracker.get_violations(&node_id);
        assert_eq!(violation_counts.get(&ViolationType::Equivocation), Some(&2));
        assert_eq!(violation_counts.get(&ViolationType::InvalidSignature), Some(&1));
    }

    #[test]
    fn test_reliability_threshold() {
        let tracker = ReputationTracker::new();
        let node_id = Uuid::new_v4();

        // Initially reliable (0.5 >= 0.2)
        assert!(tracker.is_reliable(&node_id));

        // Record violations to drop below threshold
        for _ in 0..4 {
            let event = create_test_event(
                node_id,
                ActivityType::ViolationDetected(ViolationType::Equivocation),
            );
            tracker.record_activity(event).unwrap();
        }

        // Should now be unreliable
        assert!(!tracker.is_reliable(&node_id));
    }

    #[test]
    fn test_statistics() {
        let tracker = ReputationTracker::new();

        // Create multiple nodes with different reputations (skip i=0 to ensure activity)
        for i in 1..6 {
            let node_id = Uuid::new_v4();
            for _ in 0..i {
                let event = create_test_event(node_id, ActivityType::VertexFinalized);
                tracker.record_activity(event).unwrap();
            }
        }

        let stats = tracker.get_statistics();
        assert_eq!(stats.total_nodes, 5);
        assert!(stats.average_score >= 0.5);
        assert!(stats.reliable_nodes > 0);
    }

    #[test]
    fn test_activity_history() {
        let tracker = ReputationTracker::new();
        let node_id = Uuid::new_v4();

        // Record multiple events
        for _ in 0..10 {
            let event = create_test_event(node_id, ActivityType::ConsensusParticipation);
            tracker.record_activity(event).unwrap();
        }

        let history = tracker.get_activity_history(&node_id, 5);
        assert_eq!(history.len(), 5);
    }

    #[test]
    fn test_ranked_nodes() {
        let tracker = ReputationTracker::new();

        // Create nodes with different scores
        let nodes: Vec<Uuid> = (0..5).map(|_| Uuid::new_v4()).collect();
        for (i, node_id) in nodes.iter().enumerate() {
            for _ in 0..(i * 2) {
                let event = create_test_event(*node_id, ActivityType::VertexFinalized);
                tracker.record_activity(event).unwrap();
            }
        }

        let ranked = tracker.get_ranked_nodes(3);
        assert_eq!(ranked.len(), 3);

        // Scores should be in descending order
        for i in 0..ranked.len() - 1 {
            assert!(ranked[i].1 >= ranked[i + 1].1);
        }
    }

    #[test]
    fn test_reset_reputation() {
        let tracker = ReputationTracker::new();
        let node_id = Uuid::new_v4();

        // Build up reputation
        for _ in 0..10 {
            let event = create_test_event(node_id, ActivityType::VertexFinalized);
            tracker.record_activity(event).unwrap();
        }

        assert!(tracker.get_reputation(&node_id) > 0.5);

        // Reset
        tracker.reset_reputation(&node_id);
        assert_eq!(tracker.get_reputation(&node_id), 0.5);

        let violations = tracker.get_violations(&node_id);
        assert!(violations.is_empty());
    }

    #[test]
    fn test_concurrent_access() {
        use std::sync::Arc;
        use std::thread;

        let tracker = Arc::new(ReputationTracker::new());
        let node_id = Uuid::new_v4();

        // Spawn multiple threads updating reputation
        let handles: Vec<_> = (0..10)
            .map(|_| {
                let tracker = Arc::clone(&tracker);
                thread::spawn(move || {
                    for _ in 0..100 {
                        let event = create_test_event(node_id, ActivityType::ConsensusParticipation);
                        tracker.record_activity(event).unwrap();
                    }
                })
            })
            .collect();

        for handle in handles {
            handle.join().unwrap();
        }

        // Should have processed all events
        let history = tracker.get_activity_history(&node_id, 1000);
        assert_eq!(history.len(), 1000);
    }
}
