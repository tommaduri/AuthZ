//! State Synchronization
//!
//! Implements incremental state transfer with Merkle tree verification

use crate::{
    error::{ConsensusError, Result},
    NodeId,
};
use cretoai_dag::types::{Vertex, VertexHash};
use dashmap::DashMap;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tokio::time::timeout;
use tracing::{debug, info, warn};

/// Consensus state snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    /// Snapshot ID
    pub id: String,

    /// Height at which snapshot was taken
    pub height: u64,

    /// Root hash of state
    pub state_hash: StateHash,

    /// Finalized vertices
    pub vertices: Vec<Vertex>,

    /// Pending transactions
    pub pending_txs: Vec<Vec<u8>>,

    /// Timestamp
    pub created_at: SystemTime,

    /// Merkle tree root
    pub merkle_root: Vec<u8>,
}

/// State hash type
pub type StateHash = Vec<u8>;

/// Merkle tree for state verification
pub struct MerkleTree {
    /// Leaf hashes (state components)
    leaves: Vec<Vec<u8>>,

    /// Internal nodes
    nodes: Vec<Vec<u8>>,

    /// Root hash
    root: Vec<u8>,
}

impl MerkleTree {
    /// Build Merkle tree from leaves
    pub fn build(leaves: Vec<Vec<u8>>) -> Self {
        if leaves.is_empty() {
            return Self {
                leaves: vec![],
                nodes: vec![],
                root: vec![0u8; 32],
            };
        }

        let mut current_level = leaves.clone();
        let mut all_nodes = vec![];

        // Build tree bottom-up
        while current_level.len() > 1 {
            let mut next_level = vec![];

            for chunk in current_level.chunks(2) {
                let left = &chunk[0];
                let right = if chunk.len() > 1 { &chunk[1] } else { left };

                let parent = Self::hash_pair(left, right);
                next_level.push(parent);
            }

            all_nodes.extend(current_level.clone());
            current_level = next_level;
        }

        let root = current_level[0].clone();

        Self {
            leaves,
            nodes: all_nodes,
            root,
        }
    }

    /// Get root hash
    pub fn root(&self) -> &[u8] {
        &self.root
    }

    /// Verify a leaf is in the tree
    pub fn verify(&self, leaf: &[u8], proof: &[Vec<u8>]) -> bool {
        let mut current = leaf.to_vec();

        for sibling in proof {
            current = Self::hash_pair(&current, sibling);
        }

        current == self.root
    }

    /// Hash two nodes together
    fn hash_pair(left: &[u8], right: &[u8]) -> Vec<u8> {
        let mut hasher = Sha256::new();
        hasher.update(left);
        hasher.update(right);
        hasher.finalize().to_vec()
    }

    /// Generate proof for a leaf
    pub fn generate_proof(&self, leaf_index: usize) -> Vec<Vec<u8>> {
        let mut proof = vec![];
        let mut index = leaf_index;
        let mut level = &self.leaves;

        while level.len() > 1 {
            let sibling_index = if index % 2 == 0 { index + 1 } else { index - 1 };

            if sibling_index < level.len() {
                proof.push(level[sibling_index].clone());
            }

            index /= 2;
            // Move to next level (would need to track levels in real implementation)
            break;
        }

        proof
    }
}

/// Sync status for a peer
#[derive(Debug, Clone)]
pub enum SyncStatus {
    /// Not syncing
    Idle,

    /// Syncing in progress
    Syncing {
        peer: NodeId,
        progress: f64,
        started_at: SystemTime,
    },

    /// Sync completed
    Completed { peer: NodeId, at: SystemTime },

    /// Sync failed
    Failed {
        peer: NodeId,
        reason: String,
        at: SystemTime,
    },
}

/// Consensus state
#[derive(Debug, Clone)]
pub struct ConsensusState {
    /// Current height
    pub height: u64,

    /// Finalized vertices by height
    pub finalized_vertices: HashMap<u64, Vec<VertexHash>>,

    /// Last finalized vertex
    pub last_finalized: Option<VertexHash>,

    /// State hash
    pub state_hash: StateHash,
}

impl ConsensusState {
    pub fn new() -> Self {
        Self {
            height: 0,
            finalized_vertices: HashMap::new(),
            last_finalized: None,
            state_hash: vec![0u8; 32],
        }
    }

    /// Compute state hash
    pub fn compute_hash(&self) -> StateHash {
        let mut hasher = Sha256::new();
        hasher.update(self.height.to_le_bytes());

        // Hash all finalized vertices
        for (height, vertices) in &self.finalized_vertices {
            hasher.update(height.to_le_bytes());
            for vertex in vertices {
                hasher.update(vertex);
            }
        }

        hasher.finalize().to_vec()
    }
}

/// Sync manager for coordinating state synchronization
pub struct SyncManager {
    /// Active syncs
    active_syncs: Arc<DashMap<NodeId, SyncStatus>>,

    /// Sync timeout
    sync_timeout: Duration,

    /// Bandwidth limit (bytes per second)
    bandwidth_limit: Option<u64>,

    /// Metrics
    metrics: Arc<SyncMetrics>,
}

#[derive(Debug, Default)]
pub struct SyncMetrics {
    pub total_syncs: std::sync::atomic::AtomicU64,
    pub successful_syncs: std::sync::atomic::AtomicU64,
    pub failed_syncs: std::sync::atomic::AtomicU64,
    pub bytes_transferred: std::sync::atomic::AtomicU64,
    pub average_sync_time_ms: std::sync::atomic::AtomicU64,
}

impl SyncManager {
    pub fn new(sync_timeout: Duration, bandwidth_limit: Option<u64>) -> Self {
        Self {
            active_syncs: Arc::new(DashMap::new()),
            sync_timeout,
            bandwidth_limit,
            metrics: Arc::new(SyncMetrics::default()),
        }
    }

    /// Start sync with peer
    pub fn start_sync(&self, peer: NodeId) {
        self.active_syncs.insert(
            peer,
            SyncStatus::Syncing {
                peer,
                progress: 0.0,
                started_at: SystemTime::now(),
            },
        );

        self.metrics
            .total_syncs
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }

    /// Update sync progress
    pub fn update_progress(&self, peer: NodeId, progress: f64) {
        self.active_syncs.entry(peer).and_modify(|status| {
            if let SyncStatus::Syncing { started_at, .. } = status {
                *status = SyncStatus::Syncing {
                    peer,
                    progress,
                    started_at: *started_at,
                };
            }
        });
    }

    /// Complete sync
    pub fn complete_sync(&self, peer: NodeId) {
        self.active_syncs
            .insert(peer, SyncStatus::Completed {
                peer,
                at: SystemTime::now(),
            });

        self.metrics
            .successful_syncs
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }

    /// Fail sync
    pub fn fail_sync(&self, peer: NodeId, reason: String) {
        self.active_syncs.insert(peer, SyncStatus::Failed {
            peer,
            reason,
            at: SystemTime::now(),
        });

        self.metrics
            .failed_syncs
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }

    /// Get sync status
    pub fn get_status(&self, peer: &NodeId) -> Option<SyncStatus> {
        self.active_syncs.get(peer).map(|e| e.value().clone())
    }
}

/// State synchronizer
pub struct StateSynchronizer {
    /// Local consensus state
    local_state: Arc<RwLock<ConsensusState>>,

    /// Merkle tree for verification
    merkle_tree: Arc<RwLock<MerkleTree>>,

    /// Sync manager
    sync_manager: Arc<SyncManager>,

    /// Snapshot storage
    snapshots: Arc<DashMap<String, Snapshot>>,
}

impl StateSynchronizer {
    /// Create new state synchronizer
    pub fn new(sync_timeout: Duration, bandwidth_limit: Option<u64>) -> Self {
        let state = ConsensusState::new();
        let merkle = MerkleTree::build(vec![]);

        Self {
            local_state: Arc::new(RwLock::new(state)),
            merkle_tree: Arc::new(RwLock::new(merkle)),
            sync_manager: Arc::new(SyncManager::new(sync_timeout, bandwidth_limit)),
            snapshots: Arc::new(DashMap::new()),
        }
    }

    /// Sync state with a peer
    pub async fn sync_with_peer(&self, peer: NodeId) -> Result<()> {
        info!(peer = %peer, "Starting state synchronization");

        self.sync_manager.start_sync(peer);

        let result = timeout(Duration::from_secs(30), async {
            // 1. Request peer's current height and state hash
            let (peer_height, peer_hash) = self.request_peer_state(peer).await?;

            let local_height = self.local_state.read().height;
            let local_hash = self.local_state.read().state_hash.clone();

            info!(
                peer = %peer,
                local_height,
                peer_height,
                "Comparing state heights"
            );

            // 2. If states match, no sync needed
            if peer_height == local_height && peer_hash == local_hash {
                info!("State already synchronized");
                return Ok(());
            }

            // 3. Determine sync strategy
            if peer_height > local_height + 1000 {
                // Large gap - use snapshot
                self.snapshot_sync(peer, peer_height).await?;
            } else {
                // Small gap - use delta sync
                self.delta_sync(local_height, peer_height, peer).await?;
            }

            // 4. Verify final state
            self.verify_state().await?;

            Ok::<(), ConsensusError>(())
        })
        .await;

        match result {
            Ok(Ok(())) => {
                info!(peer = %peer, "State synchronization completed");
                self.sync_manager.complete_sync(peer);
                Ok(())
            }
            Ok(Err(e)) => {
                warn!(peer = %peer, error = %e, "State synchronization failed");
                self.sync_manager.fail_sync(peer, e.to_string());
                Err(e)
            }
            Err(_) => {
                let err = ConsensusError::Network("Sync timeout".to_string());
                self.sync_manager.fail_sync(peer, "Timeout".to_string());
                Err(err)
            }
        }
    }

    /// Create a snapshot of current state
    pub async fn create_snapshot(&self) -> Snapshot {
        let state = self.local_state.read();

        let id = uuid::Uuid::new_v4().to_string();
        let state_hash = state.compute_hash();

        // Rebuild Merkle tree
        let leaves: Vec<Vec<u8>> = state
            .finalized_vertices
            .values()
            .flat_map(|vertices| vertices.iter().map(|v| v.clone()))
            .collect();

        let merkle = MerkleTree::build(leaves);
        let merkle_root = merkle.root().to_vec();

        *self.merkle_tree.write() = merkle;

        let snapshot = Snapshot {
            id: id.clone(),
            height: state.height,
            state_hash,
            vertices: vec![], // Would include actual vertices in production
            pending_txs: vec![],
            created_at: SystemTime::now(),
            merkle_root,
        };

        self.snapshots.insert(id, snapshot.clone());

        info!(
            snapshot_id = %snapshot.id,
            height = snapshot.height,
            "Created state snapshot"
        );

        snapshot
    }

    /// Apply a snapshot to local state
    pub async fn apply_snapshot(&self, snapshot: Snapshot) -> Result<()> {
        info!(
            snapshot_id = %snapshot.id,
            height = snapshot.height,
            "Applying snapshot"
        );

        // Verify snapshot integrity
        if !self.verify_snapshot(&snapshot)? {
            return Err(ConsensusError::InvalidSnapshot);
        }

        // Apply to local state
        let mut state = self.local_state.write();
        state.height = snapshot.height;
        state.state_hash = snapshot.state_hash.clone();

        // In production, would:
        // 1. Clear current state
        // 2. Load vertices from snapshot
        // 3. Rebuild indices
        // 4. Apply pending transactions

        info!(
            snapshot_id = %snapshot.id,
            height = snapshot.height,
            "Snapshot applied successfully"
        );

        Ok(())
    }

    /// Verify current state integrity
    pub async fn verify_state(&self) -> Result<StateHash> {
        let state = self.local_state.read();
        let computed_hash = state.compute_hash();

        if computed_hash != state.state_hash {
            warn!("State hash mismatch during verification");
            return Err(ConsensusError::StateHashMismatch);
        }

        debug!("State verification successful");
        Ok(computed_hash)
    }

    /// Delta sync: transfer only missing vertices
    pub async fn delta_sync(&self, from_height: u64, to_height: u64, peer: NodeId) -> Result<Vec<Vertex>> {
        info!(
            peer = %peer,
            from_height,
            to_height,
            count = to_height - from_height,
            "Starting delta sync"
        );

        let mut vertices = vec![];

        // Request vertices in batches
        const BATCH_SIZE: u64 = 100;
        for batch_start in (from_height..to_height).step_by(BATCH_SIZE as usize) {
            let batch_end = (batch_start + BATCH_SIZE).min(to_height);

            let batch = self.request_vertex_batch(peer, batch_start, batch_end).await?;
            vertices.extend(batch);

            // Update progress
            let progress = (batch_end - from_height) as f64 / (to_height - from_height) as f64;
            self.sync_manager.update_progress(peer, progress);
        }

        info!(
            peer = %peer,
            vertex_count = vertices.len(),
            "Delta sync completed"
        );

        Ok(vertices)
    }

    /// Request peer's current state
    async fn request_peer_state(&self, _peer: NodeId) -> Result<(u64, StateHash)> {
        // In production, send network request
        // For now, return dummy data
        Ok((0, vec![0u8; 32]))
    }

    /// Snapshot-based sync for large gaps
    async fn snapshot_sync(&self, peer: NodeId, _peer_height: u64) -> Result<()> {
        info!(peer = %peer, "Starting snapshot-based sync");

        // Request snapshot from peer
        let snapshot = self.request_snapshot(peer).await?;

        // Apply snapshot
        self.apply_snapshot(snapshot).await?;

        Ok(())
    }

    /// Request snapshot from peer
    async fn request_snapshot(&self, _peer: NodeId) -> Result<Snapshot> {
        // In production, send network request
        Err(ConsensusError::Network("Not implemented".to_string()))
    }

    /// Request batch of vertices from peer
    async fn request_vertex_batch(
        &self,
        _peer: NodeId,
        _start: u64,
        _end: u64,
    ) -> Result<Vec<Vertex>> {
        // In production, send network request
        Ok(vec![])
    }

    /// Verify snapshot integrity
    fn verify_snapshot(&self, snapshot: &Snapshot) -> Result<bool> {
        // Verify Merkle root
        let leaves: Vec<Vec<u8>> = snapshot.vertices.iter().map(|v| v.hash.clone()).collect();

        let merkle = MerkleTree::build(leaves);

        Ok(merkle.root() == snapshot.merkle_root.as_slice())
    }

    /// Get sync status for a peer
    pub fn get_sync_status(&self, peer: &NodeId) -> Option<SyncStatus> {
        self.sync_manager.get_status(peer)
    }

    /// Get current state height
    pub fn current_height(&self) -> u64 {
        self.local_state.read().height
    }

    /// Get metrics
    pub fn metrics(&self) -> &SyncMetrics {
        &self.sync_manager.metrics
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merkle_tree() {
        let leaves = vec![
            vec![1u8; 32],
            vec![2u8; 32],
            vec![3u8; 32],
            vec![4u8; 32],
        ];

        let tree = MerkleTree::build(leaves.clone());
        assert_eq!(tree.root().len(), 32);

        let proof = tree.generate_proof(0);
        assert!(tree.verify(&leaves[0], &proof));
    }

    #[test]
    fn test_state_hash() {
        let mut state = ConsensusState::new();
        state.height = 100;

        let hash1 = state.compute_hash();

        state.height = 101;
        let hash2 = state.compute_hash();

        assert_ne!(hash1, hash2);
    }

    #[tokio::test]
    async fn test_snapshot_creation() {
        let synchronizer = StateSynchronizer::new(Duration::from_secs(30), None);

        let snapshot = synchronizer.create_snapshot().await;
        assert_eq!(snapshot.height, 0);
        assert!(!snapshot.id.is_empty());
    }

    #[tokio::test]
    async fn test_sync_manager() {
        let manager = SyncManager::new(Duration::from_secs(30), None);
        let peer = NodeId::new_v4();

        manager.start_sync(peer);

        let status = manager.get_status(&peer);
        assert!(matches!(status, Some(SyncStatus::Syncing { .. })));

        manager.update_progress(peer, 0.5);
        manager.complete_sync(peer);

        let status = manager.get_status(&peer);
        assert!(matches!(status, Some(SyncStatus::Completed { .. })));
    }
}
