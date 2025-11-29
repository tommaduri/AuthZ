pub mod tests;

use std::collections::{HashMap, HashSet};
use crate::types::RoleGraphNode;

#[derive(Debug, thiserror::Error)]
pub enum GraphError {
    #[error("circular dependency detected: {0}")]
    CircularDependency(String),
}

pub struct RoleGraph {
    nodes: HashMap<String, RoleGraphNode>,
}

impl RoleGraph {
    pub fn new() -> Self {
        Self {
            nodes: HashMap::new(),
        }
    }

    pub fn add_node(&mut self, node: RoleGraphNode) {
        self.nodes.insert(node.name.clone(), node);
    }

    pub fn detect_cycles(&self) -> Result<(), GraphError> {
        let mut state: HashMap<String, VisitState> = HashMap::new();

        for node_name in self.nodes.keys() {
            if state.get(node_name) == Some(&VisitState::Unvisited) || !state.contains_key(node_name) {
                self.dfs_cycle_detection(node_name, &mut state, &mut Vec::new())?;
            }
        }

        Ok(())
    }

    fn dfs_cycle_detection(
        &self,
        node: &str,
        state: &mut HashMap<String, VisitState>,
        path: &mut Vec<String>,
    ) -> Result<(), GraphError> {
        if let Some(&VisitState::Visiting) = state.get(node) {
            path.push(node.to_string());
            return Err(GraphError::CircularDependency(path.join(" -> ")));
        }

        if state.get(node) == Some(&VisitState::Visited) {
            return Ok(());
        }

        state.insert(node.to_string(), VisitState::Visiting);
        path.push(node.to_string());

        if let Some(graph_node) = self.nodes.get(node) {
            for dep in &graph_node.dependencies {
                self.dfs_cycle_detection(dep, state, path)?;
            }
        }

        path.pop();
        state.insert(node.to_string(), VisitState::Visited);
        Ok(())
    }

    pub fn topological_sort(&self) -> Result<Vec<String>, GraphError> {
        self.detect_cycles()?;

        let mut in_degree: HashMap<String, usize> = HashMap::new();
        let mut reverse_edges: HashMap<String, Vec<String>> = HashMap::new();

        for (name, _) in &self.nodes {
            in_degree.insert(name.clone(), 0);
            reverse_edges.insert(name.clone(), Vec::new());
        }

        for (name, node) in &self.nodes {
            in_degree.insert(name.clone(), node.dependencies.len());
            for dep in &node.dependencies {
                reverse_edges.entry(dep.clone()).or_default().push(name.clone());
            }
        }

        let mut queue: Vec<String> = in_degree
            .iter()
            .filter(|(_, &degree)| degree == 0)
            .map(|(name, _)| name.clone())
            .collect();

        let mut sorted = Vec::new();

        while let Some(current) = queue.pop() {
            sorted.push(current.clone());

            if let Some(dependents) = reverse_edges.get(&current) {
                for dependent in dependents {
                    if let Some(degree) = in_degree.get_mut(dependent) {
                        *degree -= 1;
                        if *degree == 0 {
                            queue.push(dependent.clone());
                        }
                    }
                }
            }
        }

        if sorted.len() != self.nodes.len() {
            return Err(GraphError::CircularDependency(
                "cycle detected during topological sort".to_string(),
            ));
        }

        Ok(sorted)
    }
}

impl Default for RoleGraph {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, PartialEq, Clone, Copy)]
enum VisitState {
    Unvisited,
    Visiting,
    Visited,
}
