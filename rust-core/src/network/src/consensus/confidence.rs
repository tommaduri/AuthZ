//! Confidence tracking for Avalanche consensus
//!
//! Implements counter-based confidence tracking with threshold detection
//! and conflict resolution for Byzantine fault tolerance.

use super::protocol::VertexId;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// Confidence parameters
#[derive(Debug, Clone)]
pub struct ConfidenceParams {
    /// Alpha threshold for successful query (typically 80% of sample_size)
    pub alpha_threshold: usize,

    /// Beta threshold for finalization (consecutive successes)
    pub beta_threshold: usize,

    /// Confidence threshold for finalization (0.0 to 1.0)
    pub finalization_threshold: f64,

    /// Maximum rounds before timeout
    pub max_rounds: u64,
}

impl Default for ConfidenceParams {
    fn default() -> Self {
        Self {
            alpha_threshold: 24, // 80% of 30
            beta_threshold: 20,
            finalization_threshold: 0.95,
            max_rounds: 1000,
        }
    }
}

/// Confidence state for a vertex
#[derive(Debug, Clone)]
pub struct ConfidenceState {
    /// Vertex ID
    pub vertex_id: VertexId,

    /// Current confidence level (0.0 to 1.0)
    pub confidence: f64,

    /// Number of consecutive successful queries
    pub consecutive_successes: u32,

    /// Total queries performed
    pub total_queries: u32,

    /// Total positive responses
    pub positive_responses: u32,

    /// Whether finalized
    pub finalized: bool,

    /// Current round
    pub round: u64,

    /// Last chit value
    pub last_chit: bool,

    /// Conflicting vertices (if any)
    pub conflicts: Vec<VertexId>,
}

impl ConfidenceState {
    /// Create a new confidence state
    pub fn new(vertex_id: VertexId) -> Self {
        Self {
            vertex_id,
            confidence: 0.0,
            consecutive_successes: 0,
            total_queries: 0,
            positive_responses: 0,
            finalized: false,
            round: 0,
            last_chit: false,
            conflicts: Vec::new(),
        }
    }

    /// Update confidence based on query result
    pub fn update(&mut self, positive: usize, total: usize, alpha_threshold: usize) {
        self.total_queries += 1;
        self.positive_responses += positive as u32;
        self.round += 1;

        let success = positive >= alpha_threshold;

        if success {
            self.consecutive_successes += 1;
            self.last_chit = true;
        } else {
            self.consecutive_successes = 0;
            self.last_chit = false;
        }

        // Update confidence using exponential moving average
        let response_ratio = positive as f64 / total as f64;
        self.confidence = (self.confidence * 0.9) + (response_ratio * 0.1);
    }

    /// Check if finalization criteria are met
    pub fn check_finalization(&self, params: &ConfidenceParams) -> bool {
        self.consecutive_successes >= params.beta_threshold as u32
            && self.confidence >= params.finalization_threshold
    }

    /// Mark as finalized
    pub fn finalize(&mut self) {
        self.finalized = true;
    }

    /// Add a conflicting vertex
    pub fn add_conflict(&mut self, vertex_id: VertexId) {
        if !self.conflicts.contains(&vertex_id) {
            self.conflicts.push(vertex_id);
        }
    }

    /// Check if has conflicts
    pub fn has_conflicts(&self) -> bool {
        !self.conflicts.is_empty()
    }
}

/// Confidence tracker for multiple vertices
pub struct ConfidenceTracker {
    /// Confidence states
    states: Arc<RwLock<HashMap<VertexId, ConfidenceState>>>,

    /// Confidence parameters
    params: ConfidenceParams,
}

impl ConfidenceTracker {
    /// Create a new confidence tracker
    pub fn new(params: ConfidenceParams) -> Self {
        Self {
            states: Arc::new(RwLock::new(HashMap::new())),
            params,
        }
    }

    /// Initialize tracking for a vertex
    pub fn init_vertex(&self, vertex_id: VertexId) {
        let mut states = self.states.write().unwrap();
        states.entry(vertex_id.clone())
            .or_insert_with(|| ConfidenceState::new(vertex_id));
    }

    /// Update confidence for a vertex
    pub fn update_confidence(&self, vertex_id: &VertexId, positive: usize, total: usize) {
        let mut states = self.states.write().unwrap();

        if let Some(state) = states.get_mut(vertex_id) {
            state.update(positive, total, self.params.alpha_threshold);

            // Check if should finalize
            if state.check_finalization(&self.params) {
                state.finalize();
            }
        }
    }

    /// Get confidence state for a vertex
    pub fn get_state(&self, vertex_id: &VertexId) -> Option<ConfidenceState> {
        let states = self.states.read().unwrap();
        states.get(vertex_id).cloned()
    }

    /// Check if vertex is finalized
    pub fn is_finalized(&self, vertex_id: &VertexId) -> bool {
        let states = self.states.read().unwrap();
        states.get(vertex_id)
            .map(|s| s.finalized)
            .unwrap_or(false)
    }

    /// Get all finalized vertices
    pub fn get_finalized(&self) -> Vec<VertexId> {
        let states = self.states.read().unwrap();
        states.values()
            .filter(|s| s.finalized)
            .map(|s| s.vertex_id.clone())
            .collect()
    }

    /// Detect conflicts between vertices
    pub fn detect_conflicts(&self, vertex_id1: &VertexId, vertex_id2: &VertexId) -> bool {
        let states = self.states.read().unwrap();

        if let Some(state1) = states.get(vertex_id1) {
            if state1.conflicts.contains(vertex_id2) {
                return true;
            }
        }

        if let Some(state2) = states.get(vertex_id2) {
            if state2.conflicts.contains(vertex_id1) {
                return true;
            }
        }

        false
    }

    /// Mark vertices as conflicting
    pub fn mark_conflict(&self, vertex_id1: &VertexId, vertex_id2: &VertexId) {
        let mut states = self.states.write().unwrap();

        if let Some(state1) = states.get_mut(vertex_id1) {
            state1.add_conflict(vertex_id2.clone());
        }

        if let Some(state2) = states.get_mut(vertex_id2) {
            state2.add_conflict(vertex_id1.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_confidence_state_creation() {
        let state = ConfidenceState::new("vertex-1".to_string());
        assert_eq!(state.confidence, 0.0);
        assert!(!state.finalized);
        assert_eq!(state.consecutive_successes, 0);
    }

    #[test]
    fn test_confidence_update() {
        let params = ConfidenceParams::default();
        let mut state = ConfidenceState::new("vertex-1".to_string());

        // Successful query (24/30 threshold met)
        state.update(25, 30, params.alpha_threshold);

        assert_eq!(state.consecutive_successes, 1);
        assert!(state.confidence > 0.0);
        assert!(state.last_chit);
    }

    #[test]
    fn test_finalization() {
        let params = ConfidenceParams {
            alpha_threshold: 24,
            beta_threshold: 5, // Lower for testing
            finalization_threshold: 0.80, // Achievable with exponential moving average
            max_rounds: 100,
        };

        let mut state = ConfidenceState::new("vertex-1".to_string());

        // Simulate successful queries - need enough iterations for exponential moving average
        // to reach threshold. With 0.9 decay and 0.1 new value weight:
        // After many iterations with 26/30 ≈ 0.867, confidence converges to ≈ 0.83
        for _ in 0..30 {
            state.update(26, 30, params.alpha_threshold);
        }

        assert!(state.consecutive_successes >= params.beta_threshold as u32,
                "consecutive_successes={} should be >= beta_threshold={}",
                state.consecutive_successes, params.beta_threshold);
        assert!(state.confidence >= params.finalization_threshold,
                "confidence={:.3} should be >= threshold={:.3}",
                state.confidence, params.finalization_threshold);
        assert!(state.check_finalization(&params));
        state.finalize();
        assert!(state.finalized);
    }

    #[test]
    fn test_confidence_tracker() {
        let params = ConfidenceParams::default();
        let tracker = ConfidenceTracker::new(params);

        tracker.init_vertex("vertex-1".to_string());
        tracker.update_confidence(&"vertex-1".to_string(), 25, 30);

        let state = tracker.get_state(&"vertex-1".to_string()).unwrap();
        assert!(state.confidence > 0.0);
    }

    #[test]
    fn test_conflict_detection() {
        let params = ConfidenceParams::default();
        let tracker = ConfidenceTracker::new(params);

        tracker.init_vertex("vertex-1".to_string());
        tracker.init_vertex("vertex-2".to_string());

        tracker.mark_conflict(&"vertex-1".to_string(), &"vertex-2".to_string());

        assert!(tracker.detect_conflicts(&"vertex-1".to_string(), &"vertex-2".to_string()));
    }
}
