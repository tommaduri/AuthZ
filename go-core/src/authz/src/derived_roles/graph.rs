//! Dependency graph and topological sorting for derived roles
//!
//! Implements Kahn's algorithm for:
//! - Topological sorting of derived roles
//! - Circular dependency detection
//! - Correct resolution order

use std::collections::{HashMap, HashSet, VecDeque};

use crate::error::{AuthzError, Result};
use super::types::RoleGraphNode;

/// Dependency graph for derived roles
///
/// Uses Kahn's algorithm for topological sorting to ensure roles are
/// resolved in the correct dependency order and to detect circular dependencies.
///
/// # Examples
///
/// ```rust
/// use authz::derived_roles::RoleGraph;
///
/// let mut graph = RoleGraph::new();
/// graph.add_node("senior_manager".to_string());
/// graph.add_node("manager".to_string());
/// graph.add_dependency("senior_manager".to_string(), "manager".to_string());
///
/// let sorted = graph.topological_sort().unwrap();
/// assert_eq!(sorted, vec!["manager".to_string(), "senior_manager".to_string()]);
/// ```
#[derive(Debug, Clone)]
pub struct RoleGraph {
    /// Map of role name to graph node
    nodes: HashMap<String, RoleGraphNode>,

    /// Reverse adjacency list (who depends on this role)
    reverse_deps: HashMap<String, HashSet<String>>,
}

impl RoleGraph {
    /// Creates a new empty role graph
    pub fn new() -> Self {
        Self {
            nodes: HashMap::new(),
            reverse_deps: HashMap::new(),
        }
    }

    /// Adds a node to the graph
    ///
    /// # Arguments
    ///
    /// * `role_name` - The derived role name
    pub fn add_node(&mut self, role_name: String) {
        if !self.nodes.contains_key(&role_name) {
            self.nodes.insert(role_name.clone(), RoleGraphNode::new(role_name.clone()));
            self.reverse_deps.insert(role_name, HashSet::new());
        }
    }

    /// Adds a dependency between two nodes
    ///
    /// # Arguments
    ///
    /// * `from_role` - The dependent role
    /// * `to_role` - The role that `from_role` depends on
    pub fn add_dependency(&mut self, from_role: String, to_role: String) {
        // Ensure both nodes exist
        self.add_node(from_role.clone());
        self.add_node(to_role.clone());

        // Add dependency to from_role
        if let Some(node) = self.nodes.get_mut(&from_role) {
            node.add_dependency(to_role.clone());
        }

        // Add reverse dependency
        if let Some(reverse_set) = self.reverse_deps.get_mut(&to_role) {
            reverse_set.insert(from_role);
        }
    }

    /// Performs topological sort using Kahn's algorithm
    ///
    /// Returns roles in dependency order (dependencies before dependents).
    /// Detects circular dependencies.
    ///
    /// # Returns
    ///
    /// `Ok(Vec<String>)` with roles in topological order, or
    /// `Err(AuthzError::CircularDependency)` if a cycle is detected
    ///
    /// # Examples
    ///
    /// ```rust
    /// use authz::derived_roles::RoleGraph;
    ///
    /// let mut graph = RoleGraph::new();
    /// graph.add_node("role_a".to_string());
    /// graph.add_node("role_b".to_string());
    /// graph.add_dependency("role_b".to_string(), "role_a".to_string());
    ///
    /// let sorted = graph.topological_sort().unwrap();
    /// assert_eq!(sorted, vec!["role_a".to_string(), "role_b".to_string()]);
    /// ```
    pub fn topological_sort(&self) -> Result<Vec<String>> {
        if self.nodes.is_empty() {
            return Ok(Vec::new());
        }

        // Clone nodes for processing
        let mut nodes: HashMap<String, RoleGraphNode> = self.nodes.clone();
        let mut queue: VecDeque<String> = VecDeque::new();
        let mut sorted: Vec<String> = Vec::new();

        // Find all nodes with in-degree 0
        for (role, node) in &nodes {
            if node.in_degree == 0 {
                queue.push_back(role.clone());
            }
        }

        // Process nodes in topological order
        while let Some(role) = queue.pop_front() {
            sorted.push(role.clone());

            // Mark as resolved
            if let Some(node) = nodes.get_mut(&role) {
                node.mark_resolved();
            }

            // Decrement in-degree of dependent nodes
            if let Some(dependents) = self.reverse_deps.get(&role) {
                for dependent in dependents {
                    if let Some(dep_node) = nodes.get_mut(dependent) {
                        dep_node.decrement_in_degree();

                        // If in-degree reaches 0, add to queue
                        if dep_node.in_degree == 0 && !dep_node.is_resolved() {
                            queue.push_back(dependent.clone());
                        }
                    }
                }
            }
        }

        // Check if all nodes were processed (no cycles)
        if sorted.len() != nodes.len() {
            // Find the cycle
            let unresolved: Vec<String> = nodes
                .iter()
                .filter(|(_, node)| !node.is_resolved())
                .map(|(role, _)| role.clone())
                .collect();

            return Err(AuthzError::CircularDependency {
                cycle: unresolved,
            });
        }

        Ok(sorted)
    }

    /// Checks if the graph contains a cycle
    ///
    /// # Returns
    ///
    /// `true` if a cycle exists, `false` otherwise
    pub fn has_cycle(&self) -> bool {
        self.topological_sort().is_err()
    }

    /// Gets all nodes that depend on a given role
    ///
    /// # Arguments
    ///
    /// * `role` - The role to check dependents for
    ///
    /// # Returns
    ///
    /// A set of role names that depend on the given role
    pub fn get_dependents(&self, role: &str) -> HashSet<String> {
        self.reverse_deps
            .get(role)
            .cloned()
            .unwrap_or_default()
    }

    /// Gets all roles that a given role depends on
    ///
    /// # Arguments
    ///
    /// * `role` - The role to check dependencies for
    ///
    /// # Returns
    ///
    /// A set of role names that the given role depends on
    pub fn get_dependencies(&self, role: &str) -> HashSet<String> {
        self.nodes
            .get(role)
            .map(|node| node.dependency_set())
            .unwrap_or_default()
    }

    /// Returns the number of nodes in the graph
    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    /// Checks if the graph is empty
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// Clears all nodes from the graph
    pub fn clear(&mut self) {
        self.nodes.clear();
        self.reverse_deps.clear();
    }
}

impl Default for RoleGraph {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_graph() {
        let graph = RoleGraph::new();
        assert!(graph.is_empty());
        assert_eq!(graph.len(), 0);
    }

    #[test]
    fn test_add_node() {
        let mut graph = RoleGraph::new();
        graph.add_node("role_a".to_string());
        graph.add_node("role_b".to_string());

        assert_eq!(graph.len(), 2);
    }

    #[test]
    fn test_add_dependency() {
        let mut graph = RoleGraph::new();
        graph.add_dependency("role_b".to_string(), "role_a".to_string());

        assert_eq!(graph.len(), 2);

        let deps = graph.get_dependencies("role_b");
        assert!(deps.contains("role_a"));
    }

    #[test]
    fn test_topological_sort_simple() {
        let mut graph = RoleGraph::new();
        graph.add_dependency("role_b".to_string(), "role_a".to_string());

        let sorted = graph.topological_sort().unwrap();
        assert_eq!(sorted, vec!["role_a".to_string(), "role_b".to_string()]);
    }

    #[test]
    fn test_topological_sort_chain() {
        let mut graph = RoleGraph::new();
        graph.add_dependency("role_c".to_string(), "role_b".to_string());
        graph.add_dependency("role_b".to_string(), "role_a".to_string());

        let sorted = graph.topological_sort().unwrap();
        assert_eq!(
            sorted,
            vec![
                "role_a".to_string(),
                "role_b".to_string(),
                "role_c".to_string()
            ]
        );
    }

    #[test]
    fn test_topological_sort_diamond() {
        let mut graph = RoleGraph::new();
        // Diamond dependency: D -> B, D -> C, B -> A, C -> A
        graph.add_dependency("role_d".to_string(), "role_b".to_string());
        graph.add_dependency("role_d".to_string(), "role_c".to_string());
        graph.add_dependency("role_b".to_string(), "role_a".to_string());
        graph.add_dependency("role_c".to_string(), "role_a".to_string());

        let sorted = graph.topological_sort().unwrap();

        // role_a must come first, role_d must come last
        assert_eq!(sorted[0], "role_a");
        assert_eq!(sorted[3], "role_d");
    }

    #[test]
    fn test_circular_dependency_simple() {
        let mut graph = RoleGraph::new();
        graph.add_dependency("role_a".to_string(), "role_b".to_string());
        graph.add_dependency("role_b".to_string(), "role_a".to_string());

        let result = graph.topological_sort();
        assert!(matches!(result, Err(AuthzError::CircularDependency { .. })));
    }

    #[test]
    fn test_circular_dependency_chain() {
        let mut graph = RoleGraph::new();
        graph.add_dependency("role_a".to_string(), "role_b".to_string());
        graph.add_dependency("role_b".to_string(), "role_c".to_string());
        graph.add_dependency("role_c".to_string(), "role_a".to_string());

        let result = graph.topological_sort();
        assert!(matches!(result, Err(AuthzError::CircularDependency { .. })));
    }

    #[test]
    fn test_has_cycle() {
        let mut graph = RoleGraph::new();
        graph.add_dependency("role_a".to_string(), "role_b".to_string());
        assert!(!graph.has_cycle());

        graph.add_dependency("role_b".to_string(), "role_a".to_string());
        assert!(graph.has_cycle());
    }

    #[test]
    fn test_get_dependents() {
        let mut graph = RoleGraph::new();
        graph.add_dependency("role_b".to_string(), "role_a".to_string());
        graph.add_dependency("role_c".to_string(), "role_a".to_string());

        let dependents = graph.get_dependents("role_a");
        assert_eq!(dependents.len(), 2);
        assert!(dependents.contains("role_b"));
        assert!(dependents.contains("role_c"));
    }

    #[test]
    fn test_get_dependencies() {
        let mut graph = RoleGraph::new();
        graph.add_dependency("role_c".to_string(), "role_a".to_string());
        graph.add_dependency("role_c".to_string(), "role_b".to_string());

        let deps = graph.get_dependencies("role_c");
        assert_eq!(deps.len(), 2);
        assert!(deps.contains("role_a"));
        assert!(deps.contains("role_b"));
    }

    #[test]
    fn test_clear() {
        let mut graph = RoleGraph::new();
        graph.add_dependency("role_b".to_string(), "role_a".to_string());

        assert!(!graph.is_empty());

        graph.clear();
        assert!(graph.is_empty());
        assert_eq!(graph.len(), 0);
    }

    #[test]
    fn test_empty_graph_topological_sort() {
        let graph = RoleGraph::new();
        let sorted = graph.topological_sort().unwrap();
        assert!(sorted.is_empty());
    }

    #[test]
    fn test_single_node() {
        let mut graph = RoleGraph::new();
        graph.add_node("role_a".to_string());

        let sorted = graph.topological_sort().unwrap();
        assert_eq!(sorted, vec!["role_a".to_string()]);
    }
}
