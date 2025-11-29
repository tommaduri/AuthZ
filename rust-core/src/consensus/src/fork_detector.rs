//! Fork Detection and Resolution for CretoAI
//!
//! Detects and resolves blockchain forks caused by:
//! - Network partitions
//! - Byzantine nodes proposing conflicting blocks
//! - Race conditions in block production
//!
//! ## Resolution Strategy
//!
//! Uses **longest chain rule** with tie-breaking by:
//! 1. Chain length (more blocks wins)
//! 2. Total cumulative weight
//! 3. Lexicographic hash comparison

use crate::{NodeId, Result, ConsensusError, SequenceNumber};
use cretoai_dag::types::{Vertex, VertexHash};
use dashmap::DashMap;
use parking_lot::RwLock;
use prometheus::{register_counter, register_gauge, Counter, Gauge};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::time::Instant;
use tracing::{debug, info, warn, error};

/// Fork information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForkInfo {
    /// Sequence number where fork occurred
    pub fork_point: SequenceNumber,

    /// Competing chain branches
    pub branches: Vec<ChainBranch>,

    /// When fork was detected (not serialized)
    #[serde(skip, default = "Instant::now")]
    pub detected_at: Instant,

    /// Fork resolution status
    pub status: ForkStatus,
}

/// Status of fork resolution
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ForkStatus {
    /// Fork detected, awaiting resolution
    Detected,
    /// Resolution in progress
    Resolving,
    /// Fork resolved, canonical chain selected
    Resolved { winning_branch: usize },
    /// Fork could not be resolved automatically
    Failed { reason: String },
}

/// A competing chain branch
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainBranch {
    /// Branch identifier
    pub branch_id: usize,

    /// Vertices in this branch (after fork point)
    pub vertices: Vec<VertexHash>,

    /// Nodes supporting this branch
    pub supporters: HashSet<NodeId>,

    /// Total weight of supporters
    pub total_weight: f64,

    /// Chain length from genesis
    pub chain_length: usize,
}

impl ChainBranch {
    /// Calculate branch score for comparison
    fn score(&self) -> (usize, u64, String) {
        // Primary: chain length
        // Secondary: total weight (as integer to avoid float comparison)
        // Tertiary: lexicographic hash of first vertex
        let weight_score = (self.total_weight * 1_000_000.0) as u64;
        let hash_str = self.vertices.first()
            .map(|h| hex::encode(h))
            .unwrap_or_default();

        (self.chain_length, weight_score, hash_str)
    }
}

/// Fork detector configuration
#[derive(Debug, Clone)]
pub struct ForkDetectorConfig {
    /// Maximum forks to track simultaneously
    pub max_tracked_forks: usize,

    /// Confirmation depth for finality (blocks)
    pub confirmation_depth: usize,

    /// Timeout for fork resolution (seconds)
    pub resolution_timeout_secs: u64,

    /// Minimum weight advantage for branch selection
    pub min_weight_advantage: f64,
}

impl Default for ForkDetectorConfig {
    fn default() -> Self {
        Self {
            max_tracked_forks: 100,
            confirmation_depth: 6,
            resolution_timeout_secs: 300, // 5 minutes
            min_weight_advantage: 0.1,    // 10% weight advantage
        }
    }
}

/// Fork detector and resolver
pub struct ForkDetector {
    /// Configuration
    config: ForkDetectorConfig,

    /// Active forks (fork_point -> ForkInfo)
    active_forks: Arc<DashMap<SequenceNumber, ForkInfo>>,

    /// Canonical chain (sequence -> VertexHash)
    canonical_chain: Arc<DashMap<SequenceNumber, VertexHash>>,

    /// Vertex parent mapping (child -> parent)
    parent_map: Arc<DashMap<VertexHash, VertexHash>>,

    /// Node vote weights (for weighted resolution)
    node_weights: Arc<DashMap<NodeId, f64>>,

    /// Metrics
    metrics: Arc<ForkMetrics>,
}

/// Prometheus metrics
struct ForkMetrics {
    /// Total forks detected
    forks_detected: Counter,

    /// Forks resolved successfully
    forks_resolved: Counter,

    /// Forks failed to resolve
    forks_failed: Counter,

    /// Active forks count
    active_forks: Gauge,

    /// Average resolution time
    resolution_time: prometheus::Histogram,
}

impl ForkMetrics {
    fn new() -> Result<Self> {
        Ok(Self {
            forks_detected: register_counter!(
                "fork_detector_forks_detected_total",
                "Total forks detected"
            )?,
            forks_resolved: register_counter!(
                "fork_detector_forks_resolved_total",
                "Forks successfully resolved"
            )?,
            forks_failed: register_counter!(
                "fork_detector_forks_failed_total",
                "Forks that failed to resolve"
            )?,
            active_forks: register_gauge!(
                "fork_detector_active_forks",
                "Currently active forks"
            )?,
            resolution_time: prometheus::register_histogram!(
                "fork_detector_resolution_duration_seconds",
                "Time to resolve a fork"
            )?,
        })
    }
}

impl ForkDetector {
    /// Create new fork detector
    pub fn new(config: ForkDetectorConfig) -> Result<Self> {
        Ok(Self {
            config,
            active_forks: Arc::new(DashMap::new()),
            canonical_chain: Arc::new(DashMap::new()),
            parent_map: Arc::new(DashMap::new()),
            node_weights: Arc::new(DashMap::new()),
            metrics: Arc::new(ForkMetrics::new()?),
        })
    }

    /// Set node vote weight
    pub fn set_node_weight(&self, node_id: NodeId, weight: f64) {
        self.node_weights.insert(node_id, weight);
    }

    /// Add vertex to canonical chain
    pub fn add_canonical_vertex(&self, seq: SequenceNumber, hash: VertexHash, parent: VertexHash) {
        self.canonical_chain.insert(seq, hash.clone());
        self.parent_map.insert(hash, parent);
    }

    /// Detect fork when conflicting blocks are proposed
    pub fn detect_fork(
        &self,
        seq: SequenceNumber,
        vertex1: VertexHash,
        vertex2: VertexHash,
        node1: NodeId,
        node2: NodeId,
    ) -> Result<()> {
        // Check if fork already exists at this sequence
        if self.active_forks.contains_key(&seq) {
            // Update existing fork
            return self.update_fork(seq, vertex2, node2);
        }

        // Create new fork
        let weight1 = self.node_weights.get(&node1).map(|w| *w.value()).unwrap_or(1.0);
        let weight2 = self.node_weights.get(&node2).map(|w| *w.value()).unwrap_or(1.0);

        let mut branch1 = ChainBranch {
            branch_id: 0,
            vertices: vec![vertex1.clone()],
            supporters: HashSet::from([node1]),
            total_weight: weight1,
            chain_length: self.calculate_chain_length(&vertex1),
        };

        let mut branch2 = ChainBranch {
            branch_id: 1,
            vertices: vec![vertex2.clone()],
            supporters: HashSet::from([node2]),
            total_weight: weight2,
            chain_length: self.calculate_chain_length(&vertex2),
        };

        let fork = ForkInfo {
            fork_point: seq,
            branches: vec![branch1, branch2],
            detected_at: Instant::now(),
            status: ForkStatus::Detected,
        };

        self.active_forks.insert(seq, fork);
        self.metrics.forks_detected.inc();
        self.metrics.active_forks.set(self.active_forks.len() as f64);

        warn!("Fork detected at sequence {} between nodes {} and {}", seq, node1, node2);

        Ok(())
    }

    /// Update existing fork with new supporting node
    fn update_fork(&self, seq: SequenceNumber, vertex: VertexHash, node: NodeId) -> Result<()> {
        let mut fork = self.active_forks.get_mut(&seq)
            .ok_or_else(|| ConsensusError::ForkNotFound(seq))?;

        let weight = self.node_weights.get(&node).map(|w| *w.value()).unwrap_or(1.0);

        // Find matching branch or create new one
        let mut found = false;
        for branch in &mut fork.branches {
            if branch.vertices.contains(&vertex) {
                branch.supporters.insert(node);
                branch.total_weight += weight;
                found = true;
                break;
            }
        }

        if !found {
            // New branch
            let branch = ChainBranch {
                branch_id: fork.branches.len(),
                vertices: vec![vertex.clone()],
                supporters: HashSet::from([node]),
                total_weight: weight,
                chain_length: self.calculate_chain_length(&vertex),
            };
            fork.branches.push(branch);
        }

        debug!("Updated fork at sequence {} with node {} vote", seq, node);
        Ok(())
    }

    /// Calculate chain length from genesis to vertex
    fn calculate_chain_length(&self, vertex: &VertexHash) -> usize {
        let mut length = 1;
        let mut current = vertex.clone();

        while let Some(parent) = self.parent_map.get(&current) {
            length += 1;
            current = parent.clone();

            // Prevent infinite loops
            if length > 1_000_000 {
                warn!("Chain length calculation exceeded limit");
                break;
            }
        }

        length
    }

    /// Attempt to resolve a fork
    pub fn resolve_fork(&self, seq: SequenceNumber) -> Result<VertexHash> {
        let start = Instant::now();

        let mut fork = self.active_forks.get_mut(&seq)
            .ok_or_else(|| ConsensusError::ForkNotFound(seq))?;

        if matches!(fork.status, ForkStatus::Resolved { .. }) {
            return Err(ConsensusError::ForkAlreadyResolved(seq));
        }

        // Check timeout
        if fork.detected_at.elapsed().as_secs() > self.config.resolution_timeout_secs {
            fork.status = ForkStatus::Failed {
                reason: "Resolution timeout".to_string(),
            };
            self.metrics.forks_failed.inc();
            return Err(ConsensusError::ForkResolutionTimeout(seq));
        }

        fork.status = ForkStatus::Resolving;

        // Clone branches for scoring to avoid borrow conflicts
        let branch_scores: Vec<_> = fork.branches.iter()
            .enumerate()
            .map(|(idx, branch)| (idx, branch.score(), branch.clone()))
            .collect();

        let mut sorted_branches = branch_scores;
        sorted_branches.sort_by(|(_, score_a, _), (_, score_b, _)| score_b.cmp(score_a));

        let (winning_idx, _, winning_branch) = &sorted_branches[0];

        // Verify winning branch has sufficient advantage
        if sorted_branches.len() > 1 {
            let (_, _, second_branch) = &sorted_branches[1];
            let weight_diff = winning_branch.total_weight - second_branch.total_weight;

            if weight_diff < self.config.min_weight_advantage {
                // Not enough advantage, wait for more votes
                return Err(ConsensusError::InsufficientConsensus {
                    have: weight_diff,
                    need: self.config.min_weight_advantage,
                });
            }
        }

        // Select winning branch
        let winning_vertex = winning_branch.vertices.first()
            .ok_or_else(|| ConsensusError::EmptyBranch)?
            .clone();
        let winning_idx = *winning_idx;

        fork.status = ForkStatus::Resolved {
            winning_branch: winning_idx,
        };

        // Update canonical chain
        self.canonical_chain.insert(seq, winning_vertex.clone());

        self.metrics.resolution_time.observe(start.elapsed().as_secs_f64());
        self.metrics.forks_resolved.inc();

        info!("Fork resolved at sequence {}: branch {} selected (length: {}, weight: {:.2})",
              seq, winning_idx, winning_branch.chain_length, winning_branch.total_weight);

        Ok(winning_vertex)
    }

    /// Get fork information
    pub fn get_fork(&self, seq: SequenceNumber) -> Option<ForkInfo> {
        self.active_forks.get(&seq).map(|f| f.clone())
    }

    /// Get canonical vertex at sequence
    pub fn get_canonical(&self, seq: SequenceNumber) -> Option<VertexHash> {
        self.canonical_chain.get(&seq).map(|v| v.clone())
    }

    /// Cleanup resolved forks older than confirmation depth
    pub fn cleanup_resolved_forks(&self) {
        let cutoff = Instant::now() - std::time::Duration::from_secs(self.config.resolution_timeout_secs);

        self.active_forks.retain(|_, fork| {
            !matches!(fork.status, ForkStatus::Resolved { .. }) || fork.detected_at > cutoff
        });

        self.metrics.active_forks.set(self.active_forks.len() as f64);
    }

    /// Reconcile chain after fork resolution
    pub fn reconcile_chain(&self, seq: SequenceNumber) -> Result<Vec<VertexHash>> {
        let fork = self.active_forks.get(&seq)
            .ok_or_else(|| ConsensusError::ForkNotFound(seq))?;

        let winning_idx = match fork.status {
            ForkStatus::Resolved { winning_branch } => winning_branch,
            _ => return Err(ConsensusError::ForkNotResolved(seq)),
        };

        let winning_branch = &fork.branches[winning_idx];

        // Return vertices from winning branch for reprocessing
        Ok(winning_branch.vertices.clone())
    }

    /// Get fork statistics
    pub fn get_stats(&self) -> ForkStats {
        ForkStats {
            active_forks: self.active_forks.len(),
            total_detected: self.metrics.forks_detected.get() as u64,
            total_resolved: self.metrics.forks_resolved.get() as u64,
            total_failed: self.metrics.forks_failed.get() as u64,
        }
    }
}

/// Fork statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForkStats {
    pub active_forks: usize,
    pub total_detected: u64,
    pub total_resolved: u64,
    pub total_failed: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chain_branch_scoring() {
        let branch1 = ChainBranch {
            branch_id: 0,
            vertices: vec![vec![1; 32]],
            supporters: HashSet::new(),
            total_weight: 0.5,
            chain_length: 10,
        };

        let branch2 = ChainBranch {
            branch_id: 1,
            vertices: vec![vec![2; 32]],
            supporters: HashSet::new(),
            total_weight: 0.6,
            chain_length: 10,
        };

        // Same length, branch2 has more weight
        assert!(branch2.score() > branch1.score());
    }

    #[tokio::test]
    async fn test_fork_detection() {
        let config = ForkDetectorConfig::default();
        let detector = ForkDetector::new(config).unwrap();

        let node1 = NodeId::new_v4();
        let node2 = NodeId::new_v4();
        detector.set_node_weight(node1, 0.5);
        detector.set_node_weight(node2, 0.5);

        let seq = 100;
        let vertex1 = vec![1; 32];
        let vertex2 = vec![2; 32];

        detector.detect_fork(seq, vertex1.clone(), vertex2.clone(), node1, node2).unwrap();

        let fork = detector.get_fork(seq).unwrap();
        assert_eq!(fork.fork_point, seq);
        assert_eq!(fork.branches.len(), 2);
        assert_eq!(fork.status, ForkStatus::Detected);
    }

    #[tokio::test]
    async fn test_fork_resolution() {
        let config = ForkDetectorConfig::default();
        let detector = ForkDetector::new(config).unwrap();

        let node1 = NodeId::new_v4();
        let node2 = NodeId::new_v4();
        let node3 = NodeId::new_v4();

        // Node 1 and 3 have more combined weight
        detector.set_node_weight(node1, 0.4);
        detector.set_node_weight(node2, 0.3);
        detector.set_node_weight(node3, 0.3);

        let seq = 100;
        let vertex1 = vec![1; 32];
        let vertex2 = vec![2; 32];

        detector.detect_fork(seq, vertex1.clone(), vertex2.clone(), node1, node2).unwrap();

        // Node 3 votes for vertex1
        detector.update_fork(seq, vertex1.clone(), node3).unwrap();

        // Resolution should succeed (0.7 vs 0.3)
        let winning = detector.resolve_fork(seq).unwrap();
        assert_eq!(winning, vertex1);

        let fork = detector.get_fork(seq).unwrap();
        assert!(matches!(fork.status, ForkStatus::Resolved { .. }));
    }
}
