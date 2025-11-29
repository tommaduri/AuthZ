//! DAG graph structure implementation
//!
//! Manages the directed acyclic graph of vertices with efficient
//! parent/child relationships and topological operations.

use crate::error::{DagError, Result};
use crate::vertex::{Vertex, VertexId};
use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::visit::EdgeRef;
use petgraph::Direction;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, RwLock};

/// DAG graph structure
pub struct Graph {
    /// Petgraph directed graph
    graph: Arc<RwLock<DiGraph<VertexId, ()>>>,

    /// Vertex storage (vertex_id -> Vertex)
    vertices: Arc<RwLock<HashMap<VertexId, Vertex>>>,

    /// Node index mapping (vertex_id -> NodeIndex)
    node_indices: Arc<RwLock<HashMap<VertexId, NodeIndex>>>,

    /// Genesis vertices (entry points to DAG)
    genesis: Arc<RwLock<HashSet<VertexId>>>,
}

impl Graph {
    /// Create a new empty DAG
    pub fn new() -> Self {
        Graph {
            graph: Arc::new(RwLock::new(DiGraph::new())),
            vertices: Arc::new(RwLock::new(HashMap::new())),
            node_indices: Arc::new(RwLock::new(HashMap::new())),
            genesis: Arc::new(RwLock::new(HashSet::new())),
        }
    }

    /// Add a vertex to the DAG
    pub fn add_vertex(&self, vertex: Vertex) -> Result<()> {
        let vertex_id = vertex.id.clone();

        // Verify vertex hash and signature
        vertex.verify_hash()?;

        // Check for cycles
        if self.would_create_cycle(&vertex)? {
            return Err(DagError::CycleDetected);
        }

        // Add to graph
        let mut graph = self.graph.write().map_err(|_| DagError::Graph("Lock error".to_string()))?;
        let mut node_indices = self.node_indices.write().map_err(|_| DagError::Graph("Lock error".to_string()))?;

        let node_idx = graph.add_node(vertex_id.clone());
        node_indices.insert(vertex_id.clone(), node_idx);

        // Add edges from parents to this vertex
        for parent_id in &vertex.parents {
            if let Some(&parent_idx) = node_indices.get(parent_id) {
                graph.add_edge(parent_idx, node_idx, ());
            } else {
                return Err(DagError::InvalidVertex(format!("Parent not found: {}", parent_id)));
            }
        }

        // Store vertex
        let mut vertices = self.vertices.write().map_err(|_| DagError::Graph("Lock error".to_string()))?;
        vertices.insert(vertex_id.clone(), vertex.clone());

        // Track genesis vertices
        if vertex.is_genesis() {
            let mut genesis = self.genesis.write().map_err(|_| DagError::Graph("Lock error".to_string()))?;
            genesis.insert(vertex_id);
        }

        Ok(())
    }

    /// Get a vertex by ID
    pub fn get_vertex(&self, vertex_id: &VertexId) -> Result<Vertex> {
        let vertices = self.vertices.read().map_err(|_| DagError::Graph("Lock error".to_string()))?;
        vertices.get(vertex_id)
            .cloned()
            .ok_or_else(|| DagError::InvalidVertex(format!("Vertex not found: {}", vertex_id)))
    }

    /// Get all vertices
    pub fn get_all_vertices(&self) -> Result<Vec<Vertex>> {
        let vertices = self.vertices.read().map_err(|_| DagError::Graph("Lock error".to_string()))?;
        Ok(vertices.values().cloned().collect())
    }

    /// Get children of a vertex
    pub fn get_children(&self, vertex_id: &VertexId) -> Result<Vec<VertexId>> {
        let graph = self.graph.read().map_err(|_| DagError::Graph("Lock error".to_string()))?;
        let node_indices = self.node_indices.read().map_err(|_| DagError::Graph("Lock error".to_string()))?;

        let node_idx = node_indices.get(vertex_id)
            .ok_or_else(|| DagError::InvalidVertex(format!("Vertex not found: {}", vertex_id)))?;

        let mut children = Vec::new();
        for edge in graph.edges_directed(*node_idx, Direction::Outgoing) {
            let child_idx = edge.target();
            if let Some(child_id) = graph.node_weight(child_idx) {
                children.push(child_id.clone());
            }
        }

        Ok(children)
    }

    /// Get parents of a vertex
    pub fn get_parents(&self, vertex_id: &VertexId) -> Result<Vec<VertexId>> {
        let vertices = self.vertices.read().map_err(|_| DagError::Graph("Lock error".to_string()))?;
        let vertex = vertices.get(vertex_id)
            .ok_or_else(|| DagError::InvalidVertex(format!("Vertex not found: {}", vertex_id)))?;

        Ok(vertex.parents.clone())
    }

    /// Get all ancestors of a vertex (transitive parents)
    pub fn get_ancestors(&self, vertex_id: &VertexId) -> Result<HashSet<VertexId>> {
        let mut ancestors = HashSet::new();
        let mut queue = VecDeque::new();
        queue.push_back(vertex_id.clone());

        while let Some(current_id) = queue.pop_front() {
            let parents = self.get_parents(&current_id)?;

            for parent_id in parents {
                if ancestors.insert(parent_id.clone()) {
                    queue.push_back(parent_id);
                }
            }
        }

        Ok(ancestors)
    }

    /// Check if adding a vertex would create a cycle
    fn would_create_cycle(&self, vertex: &Vertex) -> Result<bool> {
        // A cycle would occur if any parent is a descendant of this vertex
        // Since this vertex doesn't exist yet, we check if any parent
        // would become a descendant through the edges we're adding

        let vertices = self.vertices.read().map_err(|_| DagError::Graph("Lock error".to_string()))?;

        for parent_id in &vertex.parents {
            if !vertices.contains_key(parent_id) {
                continue; // Parent doesn't exist yet, no cycle possible
            }

            // Check if parent is already in the ancestry chain
            // This is simplified - in production, use proper cycle detection
            if vertex.parents.contains(&vertex.id) {
                return Ok(true);
            }
        }

        Ok(false)
    }

    /// Get tips (vertices with no children)
    pub fn get_tips(&self) -> Result<Vec<VertexId>> {
        let graph = self.graph.read().map_err(|_| DagError::Graph("Lock error".to_string()))?;
        let mut tips = Vec::new();

        for node_idx in graph.node_indices() {
            if graph.edges_directed(node_idx, Direction::Outgoing).count() == 0 {
                if let Some(vertex_id) = graph.node_weight(node_idx) {
                    tips.push(vertex_id.clone());
                }
            }
        }

        Ok(tips)
    }

    /// Get genesis vertices
    pub fn get_genesis(&self) -> Result<Vec<VertexId>> {
        let genesis = self.genesis.read().map_err(|_| DagError::Graph("Lock error".to_string()))?;
        Ok(genesis.iter().cloned().collect())
    }

    /// Get number of vertices in the DAG
    pub fn vertex_count(&self) -> usize {
        self.vertices.read().map(|v| v.len()).unwrap_or(0)
    }

    /// Update a vertex in place
    pub fn update_vertex(&self, vertex: Vertex) -> Result<()> {
        let vertex_id = vertex.id.clone();
        let mut vertices = self.vertices.write().map_err(|_| DagError::Graph("Lock error".to_string()))?;

        if !vertices.contains_key(&vertex_id) {
            return Err(DagError::InvalidVertex(format!("Vertex not found: {}", vertex_id)));
        }

        vertices.insert(vertex_id, vertex);
        Ok(())
    }

    /// Remove a vertex from the DAG
    pub fn remove_vertex(&self, vertex_id: &VertexId) -> Result<()> {
        let mut graph = self.graph.write().map_err(|_| DagError::Graph("Lock error".to_string()))?;
        let mut vertices = self.vertices.write().map_err(|_| DagError::Graph("Lock error".to_string()))?;
        let mut node_indices = self.node_indices.write().map_err(|_| DagError::Graph("Lock error".to_string()))?;
        let mut genesis = self.genesis.write().map_err(|_| DagError::Graph("Lock error".to_string()))?;

        // Get the node index
        let node_idx = node_indices.get(vertex_id)
            .ok_or_else(|| DagError::InvalidVertex(format!("Vertex not found: {}", vertex_id)))?;

        // Remove from graph
        graph.remove_node(*node_idx);

        // Remove from storages
        vertices.remove(vertex_id);
        node_indices.remove(vertex_id);
        genesis.remove(vertex_id);

        Ok(())
    }

    /// Remove multiple vertices from the DAG
    pub fn remove_vertices(&self, vertex_ids: &[VertexId]) -> Result<usize> {
        let mut removed = 0;
        for vertex_id in vertex_ids {
            if self.remove_vertex(vertex_id).is_ok() {
                removed += 1;
            }
        }
        Ok(removed)
    }

    /// Perform topological sort of the DAG
    pub fn topological_sort(&self) -> Result<Vec<VertexId>> {
        let graph = self.graph.read().map_err(|_| DagError::Graph("Lock error".to_string()))?;

        match petgraph::algo::toposort(&*graph, None) {
            Ok(sorted) => {
                let mut result = Vec::new();
                for node_idx in sorted {
                    if let Some(vertex_id) = graph.node_weight(node_idx) {
                        result.push(vertex_id.clone());
                    }
                }
                Ok(result)
            }
            Err(_) => Err(DagError::CycleDetected),
        }
    }
}

impl Default for Graph {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vertex::VertexBuilder;

    #[test]
    fn test_graph_creation() {
        let graph = Graph::new();
        assert_eq!(graph.vertex_count(), 0);
    }

    #[test]
    fn test_add_genesis_vertex() {
        let graph = Graph::new();
        let vertex = VertexBuilder::new("agent-001".to_string())
            .id("genesis-1".to_string())
            .payload(vec![1, 2, 3])
            .build();

        assert!(graph.add_vertex(vertex).is_ok());
        assert_eq!(graph.vertex_count(), 1);

        let genesis = graph.get_genesis().unwrap();
        assert_eq!(genesis.len(), 1);
    }

    #[test]
    fn test_add_vertex_with_parents() {
        let graph = Graph::new();

        // Add genesis
        let genesis = VertexBuilder::new("agent-001".to_string())
            .id("genesis-1".to_string())
            .build();
        graph.add_vertex(genesis).unwrap();

        // Add child
        let child = VertexBuilder::new("agent-001".to_string())
            .id("child-1".to_string())
            .parent("genesis-1".to_string())
            .build();

        assert!(graph.add_vertex(child).is_ok());
        assert_eq!(graph.vertex_count(), 2);
    }

    #[test]
    fn test_get_children() {
        let graph = Graph::new();

        let genesis = VertexBuilder::new("agent-001".to_string())
            .id("genesis-1".to_string())
            .build();
        graph.add_vertex(genesis).unwrap();

        let child = VertexBuilder::new("agent-001".to_string())
            .id("child-1".to_string())
            .parent("genesis-1".to_string())
            .build();
        graph.add_vertex(child).unwrap();

        let children = graph.get_children(&"genesis-1".to_string()).unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0], "child-1");
    }

    #[test]
    fn test_topological_sort() {
        let graph = Graph::new();

        // Create a simple chain: genesis -> v1 -> v2
        let genesis = VertexBuilder::new("agent-001".to_string())
            .id("genesis".to_string())
            .build();
        graph.add_vertex(genesis).unwrap();

        let v1 = VertexBuilder::new("agent-001".to_string())
            .id("v1".to_string())
            .parent("genesis".to_string())
            .build();
        graph.add_vertex(v1).unwrap();

        let v2 = VertexBuilder::new("agent-001".to_string())
            .id("v2".to_string())
            .parent("v1".to_string())
            .build();
        graph.add_vertex(v2).unwrap();

        let sorted = graph.topological_sort().unwrap();
        assert_eq!(sorted.len(), 3);

        // Genesis should come first
        assert_eq!(sorted[0], "genesis");
    }
}
