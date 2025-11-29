//! Finality detection and conflict resolution
//!
//! Tracks finalized vertices and propagates finality to children,
//! resolving conflicts according to Avalanche consensus rules.

use super::protocol::VertexId;
use crate::error::{NetworkError, Result};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};
use tracing::{debug, info, warn};

/// Finality state for a vertex
#[derive(Debug, Clone)]
pub struct FinalityState {
    /// Vertex ID
    pub vertex_id: VertexId,

    /// Whether finalized
    pub finalized: bool,

    /// Finalization timestamp
    pub finalized_at: Option<u64>,

    /// Parent vertices
    pub parents: Vec<VertexId>,

    /// Child vertices
    pub children: Vec<VertexId>,

    /// Conflicting vertices (if any)
    pub conflicts: HashSet<VertexId>,
}

impl FinalityState {
    /// Create a new finality state
    pub fn new(vertex_id: VertexId, parents: Vec<VertexId>) -> Self {
        Self {
            vertex_id,
            finalized: false,
            finalized_at: None,
            parents,
            children: Vec::new(),
            conflicts: HashSet::new(),
        }
    }

    /// Mark as finalized
    pub fn finalize(&mut self) {
        self.finalized = true;
        self.finalized_at = Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64
        );
    }

    /// Add a child vertex
    pub fn add_child(&mut self, child_id: VertexId) {
        if !self.children.contains(&child_id) {
            self.children.push(child_id);
        }
    }

    /// Add a conflict
    pub fn add_conflict(&mut self, conflict_id: VertexId) {
        self.conflicts.insert(conflict_id);
    }
}

/// Finality detector
pub struct FinalityDetector {
    /// Finality states
    states: Arc<RwLock<HashMap<VertexId, FinalityState>>>,

    /// Finalization order (for consistency)
    finalization_order: Arc<RwLock<Vec<VertexId>>>,
}

impl FinalityDetector {
    /// Create a new finality detector
    pub fn new() -> Self {
        Self {
            states: Arc::new(RwLock::new(HashMap::new())),
            finalization_order: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Register a vertex
    pub fn register_vertex(&self, vertex_id: VertexId, parents: Vec<VertexId>) -> Result<()> {
        let mut states = self.states.write().unwrap();

        // Create new state
        let state = FinalityState::new(vertex_id.clone(), parents.clone());
        states.insert(vertex_id.clone(), state);

        // Update parent-child relationships
        for parent_id in parents {
            if let Some(parent_state) = states.get_mut(&parent_id) {
                parent_state.add_child(vertex_id.clone());
            }
        }

        Ok(())
    }

    /// Mark a vertex as finalized
    pub fn finalize_vertex(&self, vertex_id: &VertexId) -> Result<()> {
        let mut states = self.states.write().unwrap();

        if let Some(state) = states.get_mut(vertex_id) {
            if state.finalized {
                debug!("Vertex {} already finalized", vertex_id);
                return Ok(());
            }

            // Clone parents to avoid borrow issues
            let parents = state.parents.clone();
            let has_conflicts = !state.conflicts.is_empty();

            // Check if all parents are finalized
            for parent_id in &parents {
                if let Some(parent_state) = states.get(parent_id) {
                    if !parent_state.finalized {
                        return Err(NetworkError::Consensus(
                            format!("Cannot finalize vertex {}: parent {} not finalized",
                                vertex_id, parent_id)
                        ));
                    }
                }
            }

            // Check for conflicts
            if has_conflicts {
                return Err(NetworkError::Consensus(
                    format!("Cannot finalize vertex {}: has unresolved conflicts", vertex_id)
                ));
            }

            // Get mutable reference again after parent checks
            if let Some(state) = states.get_mut(vertex_id) {
                state.finalize();
            }

            // Add to finalization order
            let mut order = self.finalization_order.write().unwrap();
            order.push(vertex_id.clone());

            info!("Finalized vertex {} at position {}", vertex_id, order.len());

            Ok(())
        } else {
            Err(NetworkError::Consensus(
                format!("Unknown vertex: {}", vertex_id)
            ))
        }
    }

    /// Propagate finality to children
    pub fn propagate_finality(&self, vertex_id: &VertexId) -> Result<Vec<VertexId>> {
        let states = self.states.read().unwrap();
        let mut finalized_children = Vec::new();

        if let Some(state) = states.get(vertex_id) {
            if !state.finalized {
                return Err(NetworkError::Consensus(
                    format!("Vertex {} is not finalized", vertex_id)
                ));
            }

            // Get children
            for child_id in &state.children {
                if let Some(child_state) = states.get(child_id) {
                    if !child_state.finalized {
                        // Check if all parents of child are finalized
                        let all_parents_finalized = child_state.parents.iter()
                            .all(|p| {
                                states.get(p)
                                    .map(|s| s.finalized)
                                    .unwrap_or(false)
                            });

                        if all_parents_finalized {
                            finalized_children.push(child_id.clone());
                        }
                    }
                }
            }
        }

        Ok(finalized_children)
    }

    /// Resolve conflict between two vertices
    pub fn resolve_conflict(&self, vertex_id1: &VertexId, vertex_id2: &VertexId) -> Result<VertexId> {
        let states = self.states.read().unwrap();

        let state1 = states.get(vertex_id1)
            .ok_or_else(|| NetworkError::Consensus(format!("Unknown vertex: {}", vertex_id1)))?;

        let state2 = states.get(vertex_id2)
            .ok_or_else(|| NetworkError::Consensus(format!("Unknown vertex: {}", vertex_id2)))?;

        // If one is finalized, it wins
        if state1.finalized && !state2.finalized {
            return Ok(vertex_id1.clone());
        }
        if state2.finalized && !state1.finalized {
            return Ok(vertex_id2.clone());
        }

        // If both or neither finalized, use deterministic ordering (lexicographic)
        if vertex_id1 < vertex_id2 {
            Ok(vertex_id1.clone())
        } else {
            Ok(vertex_id2.clone())
        }
    }

    /// Mark vertices as conflicting
    pub fn mark_conflict(&self, vertex_id1: &VertexId, vertex_id2: &VertexId) -> Result<()> {
        let mut states = self.states.write().unwrap();

        if let Some(state1) = states.get_mut(vertex_id1) {
            state1.add_conflict(vertex_id2.clone());
        }

        if let Some(state2) = states.get_mut(vertex_id2) {
            state2.add_conflict(vertex_id1.clone());
        }

        warn!("Marked conflict between {} and {}", vertex_id1, vertex_id2);

        Ok(())
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
        let order = self.finalization_order.read().unwrap();
        order.clone()
    }

    /// Get finalization order
    pub fn get_finalization_order(&self) -> Vec<VertexId> {
        let order = self.finalization_order.read().unwrap();
        order.clone()
    }

    /// Get finality state
    pub fn get_state(&self, vertex_id: &VertexId) -> Option<FinalityState> {
        let states = self.states.read().unwrap();
        states.get(vertex_id).cloned()
    }
}

impl Default for FinalityDetector {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_finality_detector_creation() {
        let detector = FinalityDetector::new();
        assert_eq!(detector.get_finalized().len(), 0);
    }

    #[test]
    fn test_vertex_registration() {
        let detector = FinalityDetector::new();

        detector.register_vertex("genesis".to_string(), vec![]).unwrap();
        detector.register_vertex("v1".to_string(), vec!["genesis".to_string()]).unwrap();

        assert!(!detector.is_finalized(&"genesis".to_string()));
        assert!(!detector.is_finalized(&"v1".to_string()));
    }

    #[test]
    fn test_vertex_finalization() {
        let detector = FinalityDetector::new();

        // Register genesis
        detector.register_vertex("genesis".to_string(), vec![]).unwrap();

        // Finalize genesis
        detector.finalize_vertex(&"genesis".to_string()).unwrap();

        assert!(detector.is_finalized(&"genesis".to_string()));
        assert_eq!(detector.get_finalized().len(), 1);
    }

    #[test]
    fn test_finalization_order() {
        let detector = FinalityDetector::new();

        // Build chain: genesis -> v1 -> v2
        detector.register_vertex("genesis".to_string(), vec![]).unwrap();
        detector.register_vertex("v1".to_string(), vec!["genesis".to_string()]).unwrap();
        detector.register_vertex("v2".to_string(), vec!["v1".to_string()]).unwrap();

        // Finalize in order
        detector.finalize_vertex(&"genesis".to_string()).unwrap();
        detector.finalize_vertex(&"v1".to_string()).unwrap();
        detector.finalize_vertex(&"v2".to_string()).unwrap();

        let order = detector.get_finalization_order();
        assert_eq!(order, vec!["genesis", "v1", "v2"]);
    }

    #[test]
    fn test_parent_check() {
        let detector = FinalityDetector::new();

        detector.register_vertex("genesis".to_string(), vec![]).unwrap();
        detector.register_vertex("v1".to_string(), vec!["genesis".to_string()]).unwrap();

        // Should fail: parent not finalized
        let result = detector.finalize_vertex(&"v1".to_string());
        assert!(result.is_err());

        // Finalize parent first
        detector.finalize_vertex(&"genesis".to_string()).unwrap();

        // Now should succeed
        detector.finalize_vertex(&"v1".to_string()).unwrap();
        assert!(detector.is_finalized(&"v1".to_string()));
    }

    #[test]
    fn test_conflict_resolution() {
        let detector = FinalityDetector::new();

        detector.register_vertex("v1".to_string(), vec![]).unwrap();
        detector.register_vertex("v2".to_string(), vec![]).unwrap();

        // Mark conflict
        detector.mark_conflict(&"v1".to_string(), &"v2".to_string()).unwrap();

        // Resolve conflict (lexicographic ordering)
        let winner = detector.resolve_conflict(&"v1".to_string(), &"v2".to_string()).unwrap();
        assert_eq!(winner, "v1");
    }

    #[test]
    fn test_finality_propagation() {
        let detector = FinalityDetector::new();

        // Build DAG with two parents
        detector.register_vertex("v1".to_string(), vec![]).unwrap();
        detector.register_vertex("v2".to_string(), vec![]).unwrap();
        detector.register_vertex("child".to_string(), vec!["v1".to_string(), "v2".to_string()]).unwrap();

        // Finalize one parent
        detector.finalize_vertex(&"v1".to_string()).unwrap();

        // Child should not be finalized yet (not all parents finalized)
        let children = detector.propagate_finality(&"v1".to_string()).unwrap();
        assert_eq!(children.len(), 0);

        // Finalize second parent
        detector.finalize_vertex(&"v2".to_string()).unwrap();

        // Now child can be finalized
        let children = detector.propagate_finality(&"v2".to_string()).unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0], "child");
    }
}
