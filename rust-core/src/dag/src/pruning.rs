//! DAG Pruning and Compaction
//!
//! Manages the lifecycle of DAG vertices, removing old finalized vertices
//! while preserving consensus integrity and maintaining efficient storage.
//!
//! ## Pruning Strategy
//! - Only prune finalized vertices (consensus complete)
//! - Maintain minimum retention period (default: 24 hours)
//! - Keep genesis vertices and recent tips
//! - Preserve dependency chains for non-finalized vertices
//! - Compact storage by removing orphaned data

use crate::error::Result;
use crate::graph::Graph;
use crate::vertex::VertexId;
use std::collections::{HashSet, HashMap};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

/// Pruning configuration parameters
#[derive(Debug, Clone)]
pub struct PruningConfig {
    /// Minimum age before a vertex can be pruned (default: 24 hours)
    pub min_retention_period: Duration,

    /// Maximum number of vertices to keep (0 = unlimited)
    pub max_vertices: usize,

    /// Maximum depth to keep from tips (0 = unlimited)
    pub max_depth_from_tips: usize,

    /// Whether to keep all genesis vertices
    pub keep_genesis: bool,

    /// Whether to automatically compact after pruning
    pub auto_compact: bool,
}

impl Default for PruningConfig {
    fn default() -> Self {
        PruningConfig {
            min_retention_period: Duration::from_secs(24 * 60 * 60), // 24 hours
            max_vertices: 1_000_000, // 1M vertices
            max_depth_from_tips: 1000, // Keep 1000 layers from tips
            keep_genesis: true,
            auto_compact: true,
        }
    }
}

/// DAG pruning manager
pub struct PruningManager {
    /// DAG graph reference
    graph: Arc<Graph>,

    /// Pruning configuration
    config: PruningConfig,

    /// Vertices marked for preservation (never prune)
    preserved_vertices: HashSet<VertexId>,

    /// Last pruning timestamp
    last_pruned: SystemTime,
}

impl PruningManager {
    /// Create a new pruning manager
    pub fn new(graph: Arc<Graph>) -> Self {
        PruningManager {
            graph,
            config: PruningConfig::default(),
            preserved_vertices: HashSet::new(),
            last_pruned: SystemTime::now(),
        }
    }

    /// Create with custom configuration
    pub fn with_config(graph: Arc<Graph>, config: PruningConfig) -> Self {
        PruningManager {
            graph,
            config,
            preserved_vertices: HashSet::new(),
            last_pruned: SystemTime::now(),
        }
    }

    /// Mark a vertex for preservation (will never be pruned)
    pub fn preserve_vertex(&mut self, vertex_id: VertexId) {
        self.preserved_vertices.insert(vertex_id);
    }

    /// Unmark a vertex from preservation
    pub fn unpreserve_vertex(&mut self, vertex_id: &VertexId) {
        self.preserved_vertices.remove(vertex_id);
    }

    /// Check if a vertex can be pruned
    fn can_prune_vertex(&self, vertex_id: &VertexId) -> Result<bool> {
        // Never prune preserved vertices
        if self.preserved_vertices.contains(vertex_id) {
            return Ok(false);
        }

        let vertex = self.graph.get_vertex(vertex_id)?;

        // Never prune genesis vertices if configured
        if self.config.keep_genesis && vertex.is_genesis() {
            return Ok(false);
        }

        // Only prune finalized vertices
        if !vertex.metadata.finalized {
            return Ok(false);
        }

        // Check minimum retention period
        let now = SystemTime::now();
        let vertex_age = now.duration_since(
            SystemTime::UNIX_EPOCH + Duration::from_millis(vertex.timestamp)
        ).unwrap_or(Duration::ZERO);

        if vertex_age < self.config.min_retention_period {
            return Ok(false);
        }

        // Check if this vertex is a dependency of non-finalized vertices
        if self.is_dependency_of_unfinalized(vertex_id)? {
            return Ok(false);
        }

        Ok(true)
    }

    /// Check if a vertex is a dependency of any non-finalized vertex
    fn is_dependency_of_unfinalized(&self, vertex_id: &VertexId) -> Result<bool> {
        let all_vertices = self.graph.get_all_vertices()?;

        for vertex in all_vertices {
            if !vertex.metadata.finalized {
                // Check if vertex_id is in the ancestry of this unfinalized vertex
                let ancestors = self.graph.get_ancestors(&vertex.id)?;
                if ancestors.contains(vertex_id) {
                    return Ok(true);
                }
            }
        }

        Ok(false)
    }

    /// Get vertices that are eligible for pruning
    pub fn get_pruneable_vertices(&self) -> Result<Vec<VertexId>> {
        let mut pruneable = Vec::new();
        let all_vertices = self.graph.get_all_vertices()?;

        for vertex in all_vertices {
            if self.can_prune_vertex(&vertex.id)? {
                pruneable.push(vertex.id);
            }
        }

        Ok(pruneable)
    }

    /// Calculate depth from tips for all vertices
    fn calculate_depths_from_tips(&self) -> Result<HashMap<VertexId, usize>> {
        let tips = self.graph.get_tips()?;
        let mut depths = HashMap::new();

        // BFS from all tips
        for tip_id in tips {
            self.calculate_depth_from_vertex(&tip_id, 0, &mut depths)?;
        }

        Ok(depths)
    }

    /// Recursively calculate depth from a vertex
    fn calculate_depth_from_vertex(
        &self,
        vertex_id: &VertexId,
        current_depth: usize,
        depths: &mut HashMap<VertexId, usize>,
    ) -> Result<()> {
        // Update depth if this is shorter
        let should_update = depths.get(vertex_id)
            .map(|&d| current_depth < d)
            .unwrap_or(true);

        if !should_update {
            return Ok(());
        }

        depths.insert(vertex_id.clone(), current_depth);

        // Recurse to parents
        let parents = self.graph.get_parents(vertex_id)?;
        for parent_id in parents {
            self.calculate_depth_from_vertex(&parent_id, current_depth + 1, depths)?;
        }

        Ok(())
    }

    /// Prune vertices based on depth from tips
    fn prune_by_depth(&self) -> Result<Vec<VertexId>> {
        if self.config.max_depth_from_tips == 0 {
            return Ok(Vec::new()); // Unlimited depth
        }

        let depths = self.calculate_depths_from_tips()?;
        let mut pruned = Vec::new();

        for (vertex_id, depth) in depths {
            if depth > self.config.max_depth_from_tips {
                if self.can_prune_vertex(&vertex_id)? {
                    pruned.push(vertex_id);
                }
            }
        }

        Ok(pruned)
    }

    /// Prune vertices to stay under max vertex limit
    fn prune_by_count(&self) -> Result<Vec<VertexId>> {
        if self.config.max_vertices == 0 {
            return Ok(Vec::new()); // Unlimited
        }

        let current_count = self.graph.vertex_count();
        if current_count <= self.config.max_vertices {
            return Ok(Vec::new());
        }

        let to_remove = current_count - self.config.max_vertices;
        let pruneable = self.get_pruneable_vertices()?;

        // Sort by timestamp (oldest first)
        let mut vertices_with_time: Vec<_> = pruneable.iter()
            .filter_map(|id| {
                self.graph.get_vertex(id).ok()
                    .map(|v| (id.clone(), v.timestamp))
            })
            .collect();

        vertices_with_time.sort_by_key(|(_, timestamp)| *timestamp);

        Ok(vertices_with_time.iter()
            .take(to_remove)
            .map(|(id, _)| id.clone())
            .collect())
    }

    /// Execute pruning operation
    pub fn prune(&mut self) -> Result<PruningStats> {
        let start_time = SystemTime::now();
        let initial_count = self.graph.vertex_count();

        let mut to_prune = HashSet::new();

        // Collect vertices to prune based on different criteria
        to_prune.extend(self.get_pruneable_vertices()?);
        to_prune.extend(self.prune_by_depth()?);
        to_prune.extend(self.prune_by_count()?);

        // Actually remove vertices from graph
        let vertex_ids: Vec<_> = to_prune.into_iter().collect();
        let pruned_count = self.graph.remove_vertices(&vertex_ids)?;

        self.last_pruned = SystemTime::now();

        let duration = start_time.elapsed().unwrap_or(Duration::ZERO);

        // Auto-compact if configured
        let compacted = if self.config.auto_compact && pruned_count > 0 {
            self.compact()?;
            true
        } else {
            false
        };

        Ok(PruningStats {
            vertices_before: initial_count,
            vertices_after: self.graph.vertex_count(),
            vertices_pruned: pruned_count,
            duration,
            compacted,
        })
    }

    /// Compact the DAG by rebuilding internal structures
    pub fn compact(&self) -> Result<CompactionStats> {
        let start_time = SystemTime::now();

        // Compaction involves reorganizing internal graph structures for better performance
        // After removing vertices, petgraph may have "holes" in its node index space
        // For now, we track that compaction was requested
        // Future optimization: rebuild petgraph to eliminate fragmentation

        let duration = start_time.elapsed().unwrap_or(Duration::ZERO);

        // Estimate memory freed based on typical vertex size
        // This is a rough estimate - actual implementation would measure before/after
        let estimated_memory_freed = 0; // Would be calculated from actual removals

        Ok(CompactionStats {
            duration,
            memory_freed: estimated_memory_freed,
        })
    }

    /// Get pruning statistics
    pub fn get_stats(&self) -> Result<PruningInfo> {
        let total_vertices = self.graph.vertex_count();
        let pruneable = self.get_pruneable_vertices()?.len();

        Ok(PruningInfo {
            total_vertices,
            pruneable_vertices: pruneable,
            preserved_vertices: self.preserved_vertices.len(),
            last_pruned: self.last_pruned,
        })
    }
}

/// Statistics from a pruning operation
#[derive(Debug, Clone)]
pub struct PruningStats {
    pub vertices_before: usize,
    pub vertices_after: usize,
    pub vertices_pruned: usize,
    pub duration: Duration,
    pub compacted: bool,
}

/// Statistics from a compaction operation
#[derive(Debug, Clone)]
pub struct CompactionStats {
    pub duration: Duration,
    pub memory_freed: usize,
}

/// Current pruning information
#[derive(Debug, Clone)]
pub struct PruningInfo {
    pub total_vertices: usize,
    pub pruneable_vertices: usize,
    pub preserved_vertices: usize,
    pub last_pruned: SystemTime,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vertex::VertexBuilder;

    #[test]
    fn test_pruning_manager_creation() {
        let graph = Arc::new(Graph::new());
        let manager = PruningManager::new(graph);
        assert_eq!(manager.preserved_vertices.len(), 0);
    }

    #[test]
    fn test_preserve_vertex() {
        let graph = Arc::new(Graph::new());
        let mut manager = PruningManager::new(graph);

        manager.preserve_vertex("vertex-1".to_string());
        assert_eq!(manager.preserved_vertices.len(), 1);
        assert!(manager.preserved_vertices.contains("vertex-1"));
    }

    #[test]
    fn test_unpreserve_vertex() {
        let graph = Arc::new(Graph::new());
        let mut manager = PruningManager::new(graph);

        manager.preserve_vertex("vertex-1".to_string());
        manager.unpreserve_vertex(&"vertex-1".to_string());
        assert_eq!(manager.preserved_vertices.len(), 0);
    }

    #[test]
    fn test_cannot_prune_genesis() {
        let graph = Arc::new(Graph::new());
        let manager = PruningManager::new(graph.clone());

        let genesis = VertexBuilder::new("agent-001".to_string())
            .id("genesis".to_string())
            .build();
        graph.add_vertex(genesis).unwrap();

        let can_prune = manager.can_prune_vertex(&"genesis".to_string()).unwrap();
        assert!(!can_prune, "Genesis vertices should not be pruneable with keep_genesis=true");
    }

    #[test]
    fn test_cannot_prune_unfinalized() {
        let graph = Arc::new(Graph::new());
        let manager = PruningManager::new(graph.clone());

        let vertex = VertexBuilder::new("agent-001".to_string())
            .id("unfinalized".to_string())
            .build();
        graph.add_vertex(vertex).unwrap();

        let can_prune = manager.can_prune_vertex(&"unfinalized".to_string()).unwrap();
        assert!(!can_prune, "Unfinalized vertices should not be pruneable");
    }

    #[test]
    fn test_cannot_prune_preserved() {
        let graph = Arc::new(Graph::new());
        let mut manager = PruningManager::new(graph.clone());

        let mut vertex = VertexBuilder::new("agent-001".to_string())
            .id("preserved".to_string())
            .build();
        vertex.finalize();
        graph.add_vertex(vertex).unwrap();

        manager.preserve_vertex("preserved".to_string());

        let can_prune = manager.can_prune_vertex(&"preserved".to_string()).unwrap();
        assert!(!can_prune, "Preserved vertices should not be pruneable");
    }

    #[test]
    fn test_get_pruneable_vertices() {
        let graph = Arc::new(Graph::new());

        // Use config with zero retention period for testing
        let config = PruningConfig {
            min_retention_period: Duration::ZERO,
            ..Default::default()
        };
        let manager = PruningManager::with_config(graph.clone(), config);

        // Add genesis (needed as parent)
        let genesis = VertexBuilder::new("agent-001".to_string())
            .id("genesis".to_string())
            .build();
        graph.add_vertex(genesis).unwrap();

        // Add finalized vertex with parent (old enough to prune)
        let mut old_vertex = VertexBuilder::new("agent-001".to_string())
            .id("old".to_string())
            .parent("genesis".to_string())
            .build();
        old_vertex.finalize();
        graph.add_vertex(old_vertex).unwrap();

        // Add unfinalized vertex
        let new_vertex = VertexBuilder::new("agent-001".to_string())
            .id("new".to_string())
            .parent("genesis".to_string())
            .build();
        graph.add_vertex(new_vertex).unwrap();

        let pruneable = manager.get_pruneable_vertices().unwrap();
        assert!(pruneable.contains(&"old".to_string()), "Finalized vertex should be pruneable");
        assert!(!pruneable.contains(&"new".to_string()), "Unfinalized vertex should not be pruneable");
        assert!(!pruneable.contains(&"genesis".to_string()), "Genesis vertex should not be pruneable");
    }

    #[test]
    fn test_pruning_stats() {
        let graph = Arc::new(Graph::new());
        let mut manager = PruningManager::new(graph.clone());

        let stats = manager.prune().unwrap();
        assert_eq!(stats.vertices_before, 0);
        assert_eq!(stats.vertices_pruned, 0);
    }

    #[test]
    fn test_get_stats() {
        let graph = Arc::new(Graph::new());
        let manager = PruningManager::new(graph.clone());

        let stats = manager.get_stats().unwrap();
        assert_eq!(stats.total_vertices, 0);
        assert_eq!(stats.pruneable_vertices, 0);
    }
}
