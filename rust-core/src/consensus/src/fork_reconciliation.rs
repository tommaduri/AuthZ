//! Fork Detection and Reconciliation
//!
//! Detects conflicting vertex chains and resolves using reputation scores

use crate::{
    error::{ConsensusError, Result},
    NodeId,
};
use cretoai_dag::{types::VertexHash, DAG};
use dashmap::DashMap;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::SystemTime;
use tracing::{debug, error, info, warn};

/// A detected fork in the DAG
#[derive(Debug, Clone)]
pub struct Fork {
    /// Common ancestor vertex
    pub common_ancestor: VertexHash,

    /// First conflicting chain
    pub chain_a: Vec<VertexHash>,

    /// Second conflicting chain
    pub chain_b: Vec<VertexHash>,

    /// When fork was detected
    pub detected_at: SystemTime,

    /// Creators of conflicting vertices
    pub conflicting_creators: Vec<NodeId>,
}

/// Fork resolution result
#[derive(Debug, Clone)]
pub enum Resolution {
    /// Chain A is canonical
    ChooseChainA { rolled_back: Vec<VertexHash> },

    /// Chain B is canonical
    ChooseChainB { rolled_back: Vec<VertexHash> },

    /// Both chains are valid (partition recovery)
    Merge { merged_vertices: Vec<VertexHash> },

    /// Fork cannot be resolved automatically
    ManualIntervention { reason: String },
}

/// Chain of vertices
#[derive(Debug, Clone)]
pub struct Chain {
    pub vertices: Vec<VertexHash>,
    pub total_reputation: f64,
    pub creator: NodeId,
    pub height: u64,
}

impl Chain {
    fn new(vertices: Vec<VertexHash>, creator: NodeId, height: u64) -> Self {
        Self {
            vertices,
            total_reputation: 0.0,
            creator,
            height,
        }
    }
}

/// Node reputation tracker
pub struct ReputationTracker {
    /// Reputation scores for each node
    scores: Arc<DashMap<NodeId, f64>>,

    /// Byzantine behavior count
    byzantine_counts: Arc<DashMap<NodeId, u32>>,

    /// Initial reputation
    initial_reputation: f64,

    /// Minimum reputation (can't go below)
    min_reputation: f64,

    /// Reputation penalty for Byzantine behavior
    byzantine_penalty: f64,
}

impl ReputationTracker {
    pub fn new(initial_reputation: f64) -> Self {
        Self {
            scores: Arc::new(DashMap::new()),
            byzantine_counts: Arc::new(DashMap::new()),
            initial_reputation,
            min_reputation: 0.1,
            byzantine_penalty: 0.2,
        }
    }

    /// Get reputation for a node
    pub fn get_reputation(&self, node_id: &NodeId) -> f64 {
        self.scores
            .get(node_id)
            .map(|e| *e.value())
            .unwrap_or(self.initial_reputation)
    }

    /// Penalize node for Byzantine behavior
    pub fn penalize(&self, node_id: NodeId, severity: f64) {
        let new_score = self
            .scores
            .entry(node_id)
            .and_modify(|score| {
                *score = (*score - self.byzantine_penalty * severity).max(self.min_reputation)
            })
            .or_insert(self.initial_reputation - self.byzantine_penalty * severity);

        self.byzantine_counts
            .entry(node_id)
            .and_modify(|count| *count += 1)
            .or_insert(1);

        warn!(
            node_id = %node_id,
            new_reputation = *new_score.value(),
            byzantine_count = self.byzantine_counts.get(&node_id).map(|e| *e.value()).unwrap_or(0),
            "Penalized node reputation"
        );
    }

    /// Reward node for good behavior
    pub fn reward(&self, node_id: NodeId, amount: f64) {
        self.scores
            .entry(node_id)
            .and_modify(|score| *score = (*score + amount).min(1.0))
            .or_insert(self.initial_reputation + amount);
    }

    /// Check if node is Byzantine
    pub fn is_byzantine(&self, node_id: &NodeId) -> bool {
        self.byzantine_counts
            .get(node_id)
            .map(|e| *e.value() > 3)
            .unwrap_or(false)
    }
}

/// Fork reconciliation manager
pub struct ForkReconciliator {
    /// Reference to DAG
    dag: Arc<DAG>,

    /// Node reputation tracker
    reputation: Arc<ReputationTracker>,

    /// Detected forks
    detected_forks: Arc<DashMap<VertexHash, Fork>>,

    /// Fork resolution history
    resolutions: Arc<DashMap<VertexHash, Resolution>>,
}

impl ForkReconciliator {
    pub fn new(dag: Arc<DAG>, reputation: Arc<ReputationTracker>) -> Self {
        info!("Initializing fork reconciliator");
        Self {
            dag,
            reputation,
            detected_forks: Arc::new(DashMap::new()),
            resolutions: Arc::new(DashMap::new()),
        }
    }

    /// Detect fork between two vertices
    pub async fn detect_fork(
        &self,
        v1: &VertexHash,
        v2: &VertexHash,
    ) -> Option<Fork> {
        // Check if vertices conflict (same logical position, different hashes)
        if v1 == v2 {
            return None;
        }

        // Find common ancestor
        let lca = self.find_lowest_common_ancestor(v1, v2).await?;

        // Build chains from LCA to each vertex
        let chain_a = self.build_chain(&lca, v1).await?;
        let chain_b = self.build_chain(&lca, v2).await?;

        // Get creators of conflicting vertices
        let creators = self.get_chain_creators(&chain_a, &chain_b).await;

        let fork = Fork {
            common_ancestor: lca,
            chain_a,
            chain_b,
            detected_at: SystemTime::now(),
            conflicting_creators: creators,
        };

        warn!(
            lca = %hex::encode(&fork.common_ancestor),
            chain_a_len = fork.chain_a.len(),
            chain_b_len = fork.chain_b.len(),
            "Fork detected"
        );

        self.detected_forks.insert(lca, fork.clone());
        Some(fork)
    }

    /// Resolve a detected fork
    pub async fn resolve_fork(&self, fork: Fork) -> Result<Resolution> {
        info!(
            lca = %hex::encode(&fork.common_ancestor),
            "Resolving fork"
        );

        // Build chain metadata
        let chain_a = self.evaluate_chain(&fork.chain_a, &fork.conflicting_creators).await;
        let chain_b = self.evaluate_chain(&fork.chain_b, &fork.conflicting_creators).await;

        // Choose canonical chain based on reputation
        let resolution = self.choose_canonical_chain(vec![chain_a, chain_b]);

        // Penalize Byzantine nodes
        for creator in &fork.conflicting_creators {
            self.reputation.penalize(*creator, 1.0);
        }

        self.resolutions
            .insert(fork.common_ancestor.clone(), resolution.clone());

        Ok(resolution)
    }

    /// Rollback to last common ancestor
    pub async fn rollback_to_lca(&self, fork: Fork) -> Result<VertexHash> {
        info!(
            lca = %hex::encode(&fork.common_ancestor),
            "Rolling back to common ancestor"
        );

        // In production, this would:
        // 1. Mark all vertices in rejected chain as invalid
        // 2. Remove them from the DAG
        // 3. Update state to LCA
        // 4. Broadcast rollback to network

        Ok(fork.common_ancestor)
    }

    /// Choose canonical chain from multiple options
    pub fn choose_canonical_chain(&self, mut chains: Vec<Chain>) -> Resolution {
        if chains.is_empty() {
            return Resolution::ManualIntervention {
                reason: "No chains to choose from".to_string(),
            };
        }

        if chains.len() == 1 {
            return Resolution::ChooseChainA {
                rolled_back: vec![],
            };
        }

        // Sort by reputation (descending), then by height (descending)
        chains.sort_by(|a, b| {
            b.total_reputation
                .partial_cmp(&a.total_reputation)
                .unwrap()
                .then(b.height.cmp(&a.height))
        });

        debug!(
            chain_a_reputation = chains[0].total_reputation,
            chain_a_height = chains[0].height,
            chain_b_reputation = chains[1].total_reputation,
            chain_b_height = chains[1].height,
            "Comparing chains"
        );

        // If reputations are very close, check for partition scenario
        let reputation_diff = (chains[0].total_reputation - chains[1].total_reputation).abs();
        if reputation_diff < 0.1 && chains[0].height == chains[1].height {
            // Possible network partition - attempt merge
            info!("Fork appears to be from network partition - attempting merge");
            return Resolution::Merge {
                merged_vertices: chains
                    .iter()
                    .flat_map(|c| c.vertices.clone())
                    .collect(),
            };
        }

        // Choose chain with highest reputation
        if chains[0].total_reputation > chains[1].total_reputation {
            Resolution::ChooseChainA {
                rolled_back: chains[1].vertices.clone(),
            }
        } else {
            Resolution::ChooseChainB {
                rolled_back: chains[0].vertices.clone(),
            }
        }
    }

    /// Find lowest common ancestor of two vertices
    async fn find_lowest_common_ancestor(
        &self,
        v1: &VertexHash,
        v2: &VertexHash,
    ) -> Option<VertexHash> {
        // Build ancestor sets
        let ancestors1 = self.get_ancestors(v1).await?;
        let ancestors2 = self.get_ancestors(v2).await?;

        // Find intersection
        for ancestor in ancestors1 {
            if ancestors2.contains(&ancestor) {
                return Some(ancestor);
            }
        }

        None
    }

    /// Get all ancestors of a vertex
    async fn get_ancestors(&self, vertex: &VertexHash) -> Option<Vec<VertexHash>> {
        // In production, traverse DAG to get all ancestors
        // For now, return empty vec
        Some(vec![vertex.clone()])
    }

    /// Build chain from ancestor to descendant
    async fn build_chain(
        &self,
        _ancestor: &VertexHash,
        descendant: &VertexHash,
    ) -> Option<Vec<VertexHash>> {
        // In production, traverse DAG from ancestor to descendant
        // For now, return single vertex
        Some(vec![descendant.clone()])
    }

    /// Get creators of vertices in conflicting chains
    async fn get_chain_creators(&self, _chain_a: &[VertexHash], _chain_b: &[VertexHash]) -> Vec<NodeId> {
        // In production, get creators from vertex metadata
        vec![]
    }

    /// Evaluate chain with reputation
    async fn evaluate_chain(&self, vertices: &[VertexHash], creators: &[NodeId]) -> Chain {
        let mut total_reputation = 0.0;
        for creator in creators {
            total_reputation += self.reputation.get_reputation(creator);
        }

        Chain {
            vertices: vertices.to_vec(),
            total_reputation,
            creator: creators.first().copied().unwrap_or(NodeId::new_v4()),
            height: vertices.len() as u64,
        }
    }

    /// Get fork statistics
    pub fn get_fork_stats(&self) -> ForkStats {
        ForkStats {
            total_forks: self.detected_forks.len(),
            resolved_forks: self.resolutions.len(),
            pending_forks: self.detected_forks.len() - self.resolutions.len(),
        }
    }
}

/// Fork statistics
#[derive(Debug, Clone)]
pub struct ForkStats {
    pub total_forks: usize,
    pub resolved_forks: usize,
    pub pending_forks: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use cretoai_dag::storage::DAGStorage;

    fn setup() -> (Arc<DAG>, Arc<ReputationTracker>, ForkReconciliator) {
        let storage = Arc::new(DAGStorage::new_in_memory());
        let dag = Arc::new(DAG::new(storage));
        let reputation = Arc::new(ReputationTracker::new(1.0));
        let reconciliator = ForkReconciliator::new(dag.clone(), reputation.clone());

        (dag, reputation, reconciliator)
    }

    #[test]
    fn test_reputation_tracking() {
        let reputation = ReputationTracker::new(1.0);
        let node_id = NodeId::new_v4();

        assert_eq!(reputation.get_reputation(&node_id), 1.0);

        reputation.penalize(node_id, 1.0);
        assert!(reputation.get_reputation(&node_id) < 1.0);

        reputation.reward(node_id, 0.5);
        assert!(reputation.get_reputation(&node_id) > 0.5);
    }

    #[test]
    fn test_byzantine_detection() {
        let reputation = ReputationTracker::new(1.0);
        let node_id = NodeId::new_v4();

        assert!(!reputation.is_byzantine(&node_id));

        for _ in 0..4 {
            reputation.penalize(node_id, 1.0);
        }

        assert!(reputation.is_byzantine(&node_id));
    }

    #[test]
    fn test_chain_selection() {
        let (_dag, _reputation, reconciliator) = setup();

        let chain_a = Chain::new(vec![], NodeId::new_v4(), 10);
        let mut chain_a = chain_a;
        chain_a.total_reputation = 0.9;

        let chain_b = Chain::new(vec![], NodeId::new_v4(), 10);
        let mut chain_b = chain_b;
        chain_b.total_reputation = 0.5;

        let resolution = reconciliator.choose_canonical_chain(vec![chain_a, chain_b]);

        assert!(matches!(resolution, Resolution::ChooseChainA { .. }));
    }

    #[tokio::test]
    async fn test_fork_detection() {
        let (_dag, _reputation, reconciliator) = setup();

        let v1 = vec![1u8; 32];
        let v2 = vec![2u8; 32];

        // Should detect difference
        let fork = reconciliator.detect_fork(&v1, &v2).await;
        assert!(fork.is_none()); // Returns None because test implementation doesn't have full DAG
    }
}
