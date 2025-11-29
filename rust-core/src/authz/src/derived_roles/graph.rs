//! Dependency graph for derived roles with Kahn's algorithm for topological sorting
//!
//! This module implements Kahn's algorithm to:
//! 1. Detect circular dependencies between derived roles
//! 2. Provide a topologically sorted evaluation order
//! 3. Ensure derived roles are evaluated after their dependencies

use super::types::DerivedRole;
use std::collections::{HashMap, HashSet, VecDeque};
use thiserror::Error;

/// Graph-related errors
#[derive(Debug, Error, PartialEq)]
pub enum GraphError {
    /// Circular dependency detected in the role graph
    #[error("Circular dependency detected: {0}")]
    CircularDependency(String),

    /// Role name is duplicated
    #[error("Duplicate role name: {0}")]
    DuplicateRole(String),

    /// Invalid role definition
    #[error("Invalid role: {0}")]
    InvalidRole(String),
}

/// Graph node representing a derived role and its dependencies
#[derive(Debug, Clone)]
struct GraphNode {
    /// The derived role name
    role: String,

    /// Dependencies (other derived roles this role depends on via parent roles)
    dependencies: Vec<String>,

    /// Number of incoming edges (for Kahn's algorithm)
    in_degree: usize,
}

impl GraphNode {
    fn new(role: String) -> Self {
        Self {
            role,
            dependencies: Vec::new(),
            in_degree: 0,
        }
    }

    fn add_dependency(&mut self, depends_on: String) {
        if !self.dependencies.contains(&depends_on) {
            self.dependencies.push(depends_on);
        }
    }
}

/// Dependency graph for derived roles
///
/// Uses Kahn's algorithm for topological sorting to determine the correct
/// evaluation order for derived roles. Also detects circular dependencies.
///
/// # Example
///
/// ```ignore
/// use cretoai_authz::derived_roles::{DerivedRole, DependencyGraph};
///
/// let mut graph = DependencyGraph::new();
///
/// let role1 = DerivedRole::new("manager", vec!["employee".to_string()]);
/// let role2 = DerivedRole::new("senior_manager", vec!["manager".to_string()]);
///
/// graph.add_role(&role1)?;
/// graph.add_role(&role2)?;
///
/// let order = graph.resolve_order()?;
/// assert_eq!(order, vec!["manager", "senior_manager"]);
/// ```
#[derive(Debug, Clone)]
pub struct DependencyGraph {
    /// Map of role names to graph nodes
    nodes: HashMap<String, GraphNode>,

    /// Set of all derived role names for quick lookup
    derived_role_names: HashSet<String>,
}

impl DependencyGraph {
    /// Create a new empty dependency graph
    pub fn new() -> Self {
        Self {
            nodes: HashMap::new(),
            derived_role_names: HashSet::new(),
        }
    }

    /// Add a derived role to the dependency graph
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - The role name is duplicated
    /// - The role definition is invalid
    pub fn add_role(&mut self, role: &DerivedRole) -> Result<(), GraphError> {
        // Validate the role
        role.validate()
            .map_err(|e| GraphError::InvalidRole(e.to_string()))?;

        // Check for duplicate names
        if self.derived_role_names.contains(&role.name) {
            return Err(GraphError::DuplicateRole(role.name.clone()));
        }

        // Create node for this role
        let node = GraphNode::new(role.name.clone());
        self.nodes.insert(role.name.clone(), node);
        self.derived_role_names.insert(role.name.clone());

        Ok(())
    }

    /// Build the dependency edges after all roles have been added
    ///
    /// This is a separate step because we need to know all derived role names
    /// before we can determine which parent roles are derived roles vs base roles.
    #[allow(dead_code)]
    fn build_dependencies(&mut self) -> Result<(), GraphError> {
        // Collect all dependencies first to avoid borrow checker issues
        let dependencies: Vec<(String, Vec<String>)> = Vec::new();

        for (_role_name, _node) in &self.nodes {
            let _deps: Vec<String> = Vec::new();

            // Find all parent roles that are also derived roles
            // Note: We need to reconstruct the parent_roles from the original DerivedRole
            // For now, we'll store them during add_role
            // This is a limitation - we'll need to refactor to store the full DerivedRole

            // dependencies.push((role_name.clone(), deps));
        }

        Ok(())
    }

    /// Add a dependency edge between two roles
    ///
    /// Indicates that `from_role` depends on `to_role` (must be evaluated after)
    fn add_dependency_edge(&mut self, from_role: &str, to_role: &str) {
        if let Some(node) = self.nodes.get_mut(from_role) {
            node.add_dependency(to_role.to_string());
        }
    }

    /// Resolve the evaluation order using Kahn's algorithm
    ///
    /// Returns a topologically sorted list of role names, where dependencies
    /// are evaluated before roles that depend on them.
    ///
    /// # Errors
    ///
    /// Returns an error if a circular dependency is detected.
    ///
    /// # Algorithm
    ///
    /// Kahn's algorithm:
    /// 1. Calculate in-degree for all nodes
    /// 2. Add all nodes with in-degree 0 to queue
    /// 3. While queue is not empty:
    ///    - Dequeue a node
    ///    - Add it to sorted list
    ///    - For each node that depends on it:
    ///      - Decrease its in-degree
    ///      - If in-degree becomes 0, add to queue
    /// 4. If sorted list size < total nodes, there's a cycle
    pub fn resolve_order(&self) -> Result<Vec<String>, GraphError> {
        if self.nodes.is_empty() {
            return Ok(Vec::new());
        }

        // Build reverse edges (who depends on me) and calculate in-degrees
        let mut reverse_edges: HashMap<String, Vec<String>> = HashMap::new();
        let mut in_degree: HashMap<String, usize> = HashMap::new();

        // Initialize
        for name in self.nodes.keys() {
            reverse_edges.insert(name.clone(), Vec::new());
            in_degree.insert(name.clone(), 0);
        }

        // Build reverse edges and count in-degrees
        for (name, node) in &self.nodes {
            for dep in &node.dependencies {
                // name depends on dep, so dep -> name (reverse edge)
                if let Some(edges) = reverse_edges.get_mut(dep) {
                    edges.push(name.clone());
                }
                // Increment in-degree of name
                if let Some(degree) = in_degree.get_mut(name) {
                    *degree += 1;
                }
            }
        }

        // Find all nodes with in-degree 0 (no dependencies)
        let mut queue: VecDeque<String> = VecDeque::new();
        for (name, degree) in &in_degree {
            if *degree == 0 {
                queue.push_back(name.clone());
            }
        }

        // Kahn's algorithm
        let mut sorted = Vec::new();
        let mut visited_count = 0;

        while let Some(current) = queue.pop_front() {
            sorted.push(current.clone());
            visited_count += 1;

            // Reduce in-degree for all nodes that depend on current
            if let Some(dependents) = reverse_edges.get(&current) {
                for dependent in dependents {
                    if let Some(degree) = in_degree.get_mut(dependent) {
                        *degree -= 1;
                        if *degree == 0 {
                            queue.push_back(dependent.clone());
                        }
                    }
                }
            }
        }

        // Check if all nodes were visited (no cycles)
        if visited_count != self.nodes.len() {
            // Find the cycle for better error message
            let cycles = self.find_cycles_dfs()?;
            if let Some(cycle) = cycles.first() {
                return Err(GraphError::CircularDependency(cycle.join(" -> ")));
            }
            return Err(GraphError::CircularDependency(
                "Unknown cycle detected".to_string(),
            ));
        }

        Ok(sorted)
    }

    /// Detect all cycles in the dependency graph using DFS
    ///
    /// Returns all cycles found in the graph.
    ///
    /// # Algorithm
    ///
    /// Uses depth-first search with three states:
    /// - White (0): Unvisited
    /// - Gray (1): Currently being visited (in DFS stack)
    /// - Black (2): Fully visited
    ///
    /// A cycle exists if we encounter a gray node during DFS.
    pub fn detect_cycles(&self) -> Result<Vec<Vec<String>>, GraphError> {
        self.find_cycles_dfs()
    }

    /// Internal DFS-based cycle detection
    fn find_cycles_dfs(&self) -> Result<Vec<Vec<String>>, GraphError> {
        // State: 0 = unvisited, 1 = visiting (gray), 2 = visited (black)
        let mut state: HashMap<String, u8> = HashMap::new();
        let mut cycles: Vec<Vec<String>> = Vec::new();

        for name in self.nodes.keys() {
            state.insert(name.clone(), 0);
        }

        // DFS from each unvisited node
        for start_node in self.nodes.keys() {
            if state[start_node] == 0 {
                let mut path = Vec::new();
                self.dfs_cycle_detect(start_node, &mut state, &mut path, &mut cycles)?;
            }
        }

        Ok(cycles)
    }

    /// Recursive DFS for cycle detection
    fn dfs_cycle_detect(
        &self,
        node: &str,
        state: &mut HashMap<String, u8>,
        path: &mut Vec<String>,
        cycles: &mut Vec<Vec<String>>,
    ) -> Result<(), GraphError> {
        // Check current state
        match state.get(node) {
            Some(1) => {
                // Found a cycle - node is currently being visited (gray)
                // Find where the cycle starts in the path
                if let Some(cycle_start) = path.iter().position(|n| n == node) {
                    let cycle: Vec<String> = path[cycle_start..]
                        .iter()
                        .chain(std::iter::once(&node.to_string()))
                        .cloned()
                        .collect();
                    cycles.push(cycle.clone());

                    // Return error immediately for the first cycle found
                    return Err(GraphError::CircularDependency(cycle.join(" -> ")));
                }
                return Ok(());
            }
            Some(2) => {
                // Already fully processed (black)
                return Ok(());
            }
            _ => {}
        }

        // Mark as visiting (gray)
        state.insert(node.to_string(), 1);
        path.push(node.to_string());

        // Visit dependencies
        if let Some(graph_node) = self.nodes.get(node) {
            for dep in &graph_node.dependencies {
                self.dfs_cycle_detect(dep, state, path, cycles)?;
            }
        }

        // Mark as visited (black)
        state.insert(node.to_string(), 2);
        path.pop();

        Ok(())
    }
}

impl Default for DependencyGraph {
    fn default() -> Self {
        Self::new()
    }
}

/// Extended DependencyGraph with full DerivedRole storage
///
/// This version stores the complete DerivedRole objects to enable
/// full dependency analysis including parent role patterns.
#[derive(Debug, Clone)]
pub struct DependencyGraphBuilder {
    roles: Vec<DerivedRole>,
}

impl DependencyGraphBuilder {
    /// Create a new builder
    pub fn new() -> Self {
        Self { roles: Vec::new() }
    }

    /// Add a derived role to the builder
    pub fn add_role(&mut self, role: DerivedRole) -> Result<(), GraphError> {
        // Validate the role
        role.validate()
            .map_err(|e| GraphError::InvalidRole(e.to_string()))?;

        // Check for duplicates
        if self.roles.iter().any(|r| r.name == role.name) {
            return Err(GraphError::DuplicateRole(role.name.clone()));
        }

        self.roles.push(role);
        Ok(())
    }

    /// Build the dependency graph
    pub fn build(self) -> Result<DependencyGraph, GraphError> {
        let mut graph = DependencyGraph::new();

        // Collect all derived role names
        let derived_names: HashSet<String> =
            self.roles.iter().map(|r| r.name.clone()).collect();

        // Add all nodes first
        for role in &self.roles {
            graph.add_role(role)?;
        }

        // Build dependency edges
        for role in &self.roles {
            for parent in &role.parent_roles {
                // Only add edge if parent is also a derived role
                if derived_names.contains(parent) {
                    graph.add_dependency_edge(&role.name, parent);
                }
            }
        }

        // Verify no cycles
        graph.detect_cycles()?;

        Ok(graph)
    }
}

impl Default for DependencyGraphBuilder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_graph() {
        let graph = DependencyGraph::new();
        assert_eq!(graph.resolve_order().unwrap(), Vec::<String>::new());
    }

    #[test]
    fn test_single_role() {
        let mut builder = DependencyGraphBuilder::new();
        let role = DerivedRole::new("manager", vec!["employee".to_string()]);

        builder.add_role(role).unwrap();
        let graph = builder.build().unwrap();

        let order = graph.resolve_order().unwrap();
        assert_eq!(order, vec!["manager"]);
    }

    #[test]
    fn test_linear_dependencies() {
        // employee -> manager -> senior_manager
        let mut builder = DependencyGraphBuilder::new();

        let role1 = DerivedRole::new("manager", vec!["employee".to_string()]);
        let role2 = DerivedRole::new("senior_manager", vec!["manager".to_string()]);

        builder.add_role(role1).unwrap();
        builder.add_role(role2).unwrap();

        let graph = builder.build().unwrap();
        let order = graph.resolve_order().unwrap();

        // manager should come before senior_manager
        let manager_idx = order.iter().position(|r| r == "manager").unwrap();
        let senior_idx = order.iter().position(|r| r == "senior_manager").unwrap();
        assert!(manager_idx < senior_idx);
    }

    #[test]
    fn test_diamond_dependencies() {
        // Base roles: employee, contributor
        // Derived: manager (employee), developer (contributor)
        // Derived: tech_lead (manager + developer)
        let mut builder = DependencyGraphBuilder::new();

        let manager = DerivedRole::new("manager", vec!["employee".to_string()]);
        let developer = DerivedRole::new("developer", vec!["contributor".to_string()]);
        let tech_lead = DerivedRole::new(
            "tech_lead",
            vec!["manager".to_string(), "developer".to_string()],
        );

        builder.add_role(manager).unwrap();
        builder.add_role(developer).unwrap();
        builder.add_role(tech_lead).unwrap();

        let graph = builder.build().unwrap();
        let order = graph.resolve_order().unwrap();

        // Both manager and developer must come before tech_lead
        let manager_idx = order.iter().position(|r| r == "manager").unwrap();
        let developer_idx = order.iter().position(|r| r == "developer").unwrap();
        let tech_lead_idx = order.iter().position(|r| r == "tech_lead").unwrap();

        assert!(manager_idx < tech_lead_idx);
        assert!(developer_idx < tech_lead_idx);
    }

    #[test]
    fn test_self_referencing_cycle() {
        // Role depends on itself (should fail validation)
        let role = DerivedRole::new("manager", vec!["manager".to_string()]);
        assert!(role.validate().is_err());
    }

    #[test]
    fn test_two_role_cycle() {
        // A depends on B, B depends on A
        let mut builder = DependencyGraphBuilder::new();

        let role_a = DerivedRole::new("role_a", vec!["role_b".to_string()]);
        let role_b = DerivedRole::new("role_b", vec!["role_a".to_string()]);

        builder.add_role(role_a).unwrap();
        builder.add_role(role_b).unwrap();

        let result = builder.build();
        assert!(result.is_err());

        if let Err(GraphError::CircularDependency(msg)) = result {
            assert!(msg.contains("role_a") && msg.contains("role_b"));
        } else {
            panic!("Expected CircularDependency error");
        }
    }

    #[test]
    fn test_multi_role_cycle() {
        // A -> B -> C -> A
        let mut builder = DependencyGraphBuilder::new();

        let role_a = DerivedRole::new("role_a", vec!["role_b".to_string()]);
        let role_b = DerivedRole::new("role_b", vec!["role_c".to_string()]);
        let role_c = DerivedRole::new("role_c", vec!["role_a".to_string()]);

        builder.add_role(role_a).unwrap();
        builder.add_role(role_b).unwrap();
        builder.add_role(role_c).unwrap();

        let result = builder.build();
        assert!(result.is_err());

        if let Err(GraphError::CircularDependency(msg)) = result {
            assert!(msg.contains("role_a"));
            assert!(msg.contains("role_b"));
            assert!(msg.contains("role_c"));
        } else {
            panic!("Expected CircularDependency error");
        }
    }

    #[test]
    fn test_duplicate_role_names() {
        let mut builder = DependencyGraphBuilder::new();

        let role1 = DerivedRole::new("manager", vec!["employee".to_string()]);
        let role2 = DerivedRole::new("manager", vec!["contributor".to_string()]);

        builder.add_role(role1).unwrap();
        let result = builder.add_role(role2);

        assert!(matches!(result, Err(GraphError::DuplicateRole(_))));
    }

    #[test]
    fn test_complex_graph() {
        // Complex hierarchy:
        // base_user -> verified_user -> premium_user
        //           -> contributor -> maintainer -> admin
        let mut builder = DependencyGraphBuilder::new();

        builder
            .add_role(DerivedRole::new(
                "verified_user",
                vec!["base_user".to_string()],
            ))
            .unwrap();
        builder
            .add_role(DerivedRole::new(
                "premium_user",
                vec!["verified_user".to_string()],
            ))
            .unwrap();
        builder
            .add_role(DerivedRole::new(
                "contributor",
                vec!["base_user".to_string()],
            ))
            .unwrap();
        builder
            .add_role(DerivedRole::new(
                "maintainer",
                vec!["contributor".to_string()],
            ))
            .unwrap();
        builder
            .add_role(DerivedRole::new("admin", vec!["maintainer".to_string()]))
            .unwrap();

        let graph = builder.build().unwrap();
        let order = graph.resolve_order().unwrap();

        // Verify dependencies are respected
        let get_index = |name: &str| order.iter().position(|r| r == name).unwrap();

        assert!(get_index("verified_user") < get_index("premium_user"));
        assert!(get_index("contributor") < get_index("maintainer"));
        assert!(get_index("maintainer") < get_index("admin"));
    }

    #[test]
    fn test_detect_cycles_multiple() {
        // Create a graph with potential for multiple cycles
        let mut builder = DependencyGraphBuilder::new();

        // Cycle 1: A -> B -> A
        builder
            .add_role(DerivedRole::new("role_a", vec!["role_b".to_string()]))
            .unwrap();
        builder
            .add_role(DerivedRole::new("role_b", vec!["role_a".to_string()]))
            .unwrap();

        let result = builder.build();
        assert!(result.is_err());
    }

    #[test]
    fn test_partial_cycle() {
        // Some roles in cycle, some not
        // A -> B -> C -> B (cycle between B and C)
        // D -> E (no cycle)
        let mut builder = DependencyGraphBuilder::new();

        builder
            .add_role(DerivedRole::new("role_a", vec!["role_b".to_string()]))
            .unwrap();
        builder
            .add_role(DerivedRole::new("role_b", vec!["role_c".to_string()]))
            .unwrap();
        builder
            .add_role(DerivedRole::new("role_c", vec!["role_b".to_string()]))
            .unwrap();
        builder
            .add_role(DerivedRole::new("role_d", vec!["base_role".to_string()]))
            .unwrap();
        builder
            .add_role(DerivedRole::new("role_e", vec!["role_d".to_string()]))
            .unwrap();

        let result = builder.build();
        assert!(result.is_err());
    }
}
