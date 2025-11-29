//! Comprehensive tests for graph algorithms
//!
//! Tests cover:
//! - Cycle detection (direct, indirect, self-loops)
//! - Topological sorting
//! - Graph construction and validation
//! - Edge cases (empty graphs, single nodes, disconnected components)

#[cfg(test)]
mod graph_tests {
    use crate::graph::{GraphError, RoleGraph};
    use crate::types::RoleGraphNode;

    #[test]
    fn test_empty_graph() {
        let graph = RoleGraph::new();
        let result = graph.detect_cycles();
        assert!(result.is_ok());
    }

    #[test]
    fn test_single_node_no_cycle() {
        let mut graph = RoleGraph::new();
        graph.add_node(RoleGraphNode::new("role_a".to_string()));

        let result = graph.detect_cycles();
        assert!(result.is_ok());
    }

    #[test]
    fn test_self_loop_cycle() {
        let mut graph = RoleGraph::new();
        let mut node = RoleGraphNode::new("role_a".to_string());
        node.add_dependency("role_a".to_string());
        graph.add_node(node);

        let result = graph.detect_cycles();
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), GraphError::CircularDependency(_)));
    }

    #[test]
    fn test_direct_cycle_two_nodes() {
        let mut graph = RoleGraph::new();

        let mut node_a = RoleGraphNode::new("role_a".to_string());
        node_a.add_dependency("role_b".to_string());

        let mut node_b = RoleGraphNode::new("role_b".to_string());
        node_b.add_dependency("role_a".to_string());

        graph.add_node(node_a);
        graph.add_node(node_b);

        let result = graph.detect_cycles();
        assert!(result.is_err());
    }

    #[test]
    fn test_indirect_cycle_three_nodes() {
        let mut graph = RoleGraph::new();

        let mut node_a = RoleGraphNode::new("role_a".to_string());
        node_a.add_dependency("role_b".to_string());

        let mut node_b = RoleGraphNode::new("role_b".to_string());
        node_b.add_dependency("role_c".to_string());

        let mut node_c = RoleGraphNode::new("role_c".to_string());
        node_c.add_dependency("role_a".to_string());

        graph.add_node(node_a);
        graph.add_node(node_b);
        graph.add_node(node_c);

        let result = graph.detect_cycles();
        assert!(result.is_err());

        if let Err(GraphError::CircularDependency(msg)) = result {
            assert!(msg.contains("->"));
        }
    }

    #[test]
    fn test_complex_cycle_four_nodes() {
        let mut graph = RoleGraph::new();

        let mut node_a = RoleGraphNode::new("role_a".to_string());
        node_a.add_dependency("role_b".to_string());

        let mut node_b = RoleGraphNode::new("role_b".to_string());
        node_b.add_dependency("role_c".to_string());

        let mut node_c = RoleGraphNode::new("role_c".to_string());
        node_c.add_dependency("role_d".to_string());

        let mut node_d = RoleGraphNode::new("role_d".to_string());
        node_d.add_dependency("role_a".to_string());

        graph.add_node(node_a);
        graph.add_node(node_b);
        graph.add_node(node_c);
        graph.add_node(node_d);

        let result = graph.detect_cycles();
        assert!(result.is_err());
    }

    #[test]
    fn test_no_cycle_linear_chain() {
        let mut graph = RoleGraph::new();

        let mut node_a = RoleGraphNode::new("role_a".to_string());
        node_a.add_dependency("role_b".to_string());

        let mut node_b = RoleGraphNode::new("role_b".to_string());
        node_b.add_dependency("role_c".to_string());

        let node_c = RoleGraphNode::new("role_c".to_string());

        graph.add_node(node_a);
        graph.add_node(node_b);
        graph.add_node(node_c);

        let result = graph.detect_cycles();
        assert!(result.is_ok());
    }

    #[test]
    fn test_no_cycle_diamond_dependency() {
        let mut graph = RoleGraph::new();

        let mut node_a = RoleGraphNode::new("role_a".to_string());
        node_a.add_dependency("role_b".to_string());
        node_a.add_dependency("role_c".to_string());

        let mut node_b = RoleGraphNode::new("role_b".to_string());
        node_b.add_dependency("role_d".to_string());

        let mut node_c = RoleGraphNode::new("role_c".to_string());
        node_c.add_dependency("role_d".to_string());

        let node_d = RoleGraphNode::new("role_d".to_string());

        graph.add_node(node_a);
        graph.add_node(node_b);
        graph.add_node(node_c);
        graph.add_node(node_d);

        let result = graph.detect_cycles();
        assert!(result.is_ok());
    }

    #[test]
    fn test_topological_sort_linear() {
        let mut graph = RoleGraph::new();

        let mut node_a = RoleGraphNode::new("role_a".to_string());
        node_a.add_dependency("role_b".to_string());

        let mut node_b = RoleGraphNode::new("role_b".to_string());
        node_b.add_dependency("role_c".to_string());

        let node_c = RoleGraphNode::new("role_c".to_string());

        graph.add_node(node_a);
        graph.add_node(node_b);
        graph.add_node(node_c);

        let result = graph.topological_sort();
        assert!(result.is_ok());

        let sorted = result.unwrap();
        assert_eq!(sorted.len(), 3);

        // role_c should come before role_b, role_b before role_a
        let pos_a = sorted.iter().position(|r| r == "role_a").unwrap();
        let pos_b = sorted.iter().position(|r| r == "role_b").unwrap();
        let pos_c = sorted.iter().position(|r| r == "role_c").unwrap();

        assert!(pos_c < pos_b);
        assert!(pos_b < pos_a);
    }

    #[test]
    fn test_topological_sort_diamond() {
        let mut graph = RoleGraph::new();

        let mut node_a = RoleGraphNode::new("role_a".to_string());
        node_a.add_dependency("role_b".to_string());
        node_a.add_dependency("role_c".to_string());

        let mut node_b = RoleGraphNode::new("role_b".to_string());
        node_b.add_dependency("role_d".to_string());

        let mut node_c = RoleGraphNode::new("role_c".to_string());
        node_c.add_dependency("role_d".to_string());

        let node_d = RoleGraphNode::new("role_d".to_string());

        graph.add_node(node_a);
        graph.add_node(node_b);
        graph.add_node(node_c);
        graph.add_node(node_d);

        let result = graph.topological_sort();
        assert!(result.is_ok());

        let sorted = result.unwrap();
        assert_eq!(sorted.len(), 4);

        // role_d must come before both role_b and role_c
        let pos_a = sorted.iter().position(|r| r == "role_a").unwrap();
        let pos_b = sorted.iter().position(|r| r == "role_b").unwrap();
        let pos_c = sorted.iter().position(|r| r == "role_c").unwrap();
        let pos_d = sorted.iter().position(|r| r == "role_d").unwrap();

        assert!(pos_d < pos_b);
        assert!(pos_d < pos_c);
        assert!(pos_b < pos_a);
        assert!(pos_c < pos_a);
    }

    #[test]
    fn test_topological_sort_with_cycle_fails() {
        let mut graph = RoleGraph::new();

        let mut node_a = RoleGraphNode::new("role_a".to_string());
        node_a.add_dependency("role_b".to_string());

        let mut node_b = RoleGraphNode::new("role_b".to_string());
        node_b.add_dependency("role_a".to_string());

        graph.add_node(node_a);
        graph.add_node(node_b);

        let result = graph.topological_sort();
        assert!(result.is_err());
    }

    #[test]
    fn test_multiple_independent_chains() {
        let mut graph = RoleGraph::new();

        // Chain 1: a -> b
        let mut node_a = RoleGraphNode::new("role_a".to_string());
        node_a.add_dependency("role_b".to_string());
        let node_b = RoleGraphNode::new("role_b".to_string());

        // Chain 2: c -> d
        let mut node_c = RoleGraphNode::new("role_c".to_string());
        node_c.add_dependency("role_d".to_string());
        let node_d = RoleGraphNode::new("role_d".to_string());

        graph.add_node(node_a);
        graph.add_node(node_b);
        graph.add_node(node_c);
        graph.add_node(node_d);

        let result = graph.detect_cycles();
        assert!(result.is_ok());

        let sorted = graph.topological_sort().unwrap();
        assert_eq!(sorted.len(), 4);
    }

    #[test]
    fn test_add_duplicate_dependency() {
        let mut node = RoleGraphNode::new("role_a".to_string());
        node.add_dependency("role_b".to_string());
        node.add_dependency("role_b".to_string());

        // Should not add duplicate
        assert_eq!(node.dependencies.len(), 1);
    }

    #[test]
    fn test_node_with_no_dependencies() {
        let node = RoleGraphNode::new("role_a".to_string());
        assert_eq!(node.dependencies.len(), 0);
        assert_eq!(node.name, "role_a");
    }

    #[test]
    fn test_node_with_multiple_dependencies() {
        let mut node = RoleGraphNode::new("role_a".to_string());
        node.add_dependency("role_b".to_string());
        node.add_dependency("role_c".to_string());
        node.add_dependency("role_d".to_string());

        assert_eq!(node.dependencies.len(), 3);
        assert!(node.dependencies.contains(&"role_b".to_string()));
        assert!(node.dependencies.contains(&"role_c".to_string()));
        assert!(node.dependencies.contains(&"role_d".to_string()));
    }

    #[test]
    fn test_complex_graph_no_cycle() {
        let mut graph = RoleGraph::new();

        // Complex DAG with multiple paths
        let mut node_a = RoleGraphNode::new("a".to_string());
        node_a.add_dependency("b".to_string());
        node_a.add_dependency("c".to_string());

        let mut node_b = RoleGraphNode::new("b".to_string());
        node_b.add_dependency("d".to_string());

        let mut node_c = RoleGraphNode::new("c".to_string());
        node_c.add_dependency("d".to_string());
        node_c.add_dependency("e".to_string());

        let mut node_d = RoleGraphNode::new("d".to_string());
        node_d.add_dependency("f".to_string());

        let node_e = RoleGraphNode::new("e".to_string());
        let node_f = RoleGraphNode::new("f".to_string());

        graph.add_node(node_a);
        graph.add_node(node_b);
        graph.add_node(node_c);
        graph.add_node(node_d);
        graph.add_node(node_e);
        graph.add_node(node_f);

        assert!(graph.detect_cycles().is_ok());

        let sorted = graph.topological_sort().unwrap();
        assert_eq!(sorted.len(), 6);
    }

    #[test]
    fn test_cycle_detection_performance() {
        // Test with larger graph
        let mut graph = RoleGraph::new();

        for i in 0..100 {
            let mut node = RoleGraphNode::new(format!("role_{}", i));
            if i > 0 {
                node.add_dependency(format!("role_{}", i - 1));
            }
            graph.add_node(node);
        }

        let result = graph.detect_cycles();
        assert!(result.is_ok());
    }

    #[test]
    fn test_topological_sort_empty_graph() {
        let graph = RoleGraph::new();
        let result = graph.topological_sort();
        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 0);
    }

    #[test]
    fn test_topological_sort_single_node() {
        let mut graph = RoleGraph::new();
        graph.add_node(RoleGraphNode::new("role_a".to_string()));

        let result = graph.topological_sort();
        assert!(result.is_ok());

        let sorted = result.unwrap();
        assert_eq!(sorted.len(), 1);
        assert_eq!(sorted[0], "role_a");
    }
}
