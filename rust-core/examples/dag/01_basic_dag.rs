//! Basic DAG Usage Example
//!
//! This example demonstrates:
//! - Creating a DAG graph
//! - Adding vertices with parent relationships
//! - Querying the graph structure
//! - Computing topological order

use cretoai_dag::graph::Graph;
use cretoai_dag::vertex::VertexBuilder;
use std::sync::Arc;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== Basic DAG Usage Example ===\n");

    // Create a new DAG graph
    let graph = Arc::new(Graph::new());
    println!("✓ Created empty DAG graph");

    // Create genesis vertex (no parents)
    let genesis = VertexBuilder::new("agent-001".to_string())
        .id("genesis".to_string())
        .payload(b"Genesis block".to_vec())
        .build();

    graph.add_vertex(genesis)?;
    println!("✓ Added genesis vertex");

    // Add child vertices
    let vertex_a = VertexBuilder::new("agent-001".to_string())
        .id("vertex-a".to_string())
        .parent("genesis".to_string())
        .payload(b"Transaction A".to_vec())
        .build();

    graph.add_vertex(vertex_a)?;
    println!("✓ Added vertex-a (child of genesis)");

    let vertex_b = VertexBuilder::new("agent-002".to_string())
        .id("vertex-b".to_string())
        .parent("genesis".to_string())
        .payload(b"Transaction B".to_vec())
        .build();

    graph.add_vertex(vertex_b)?;
    println!("✓ Added vertex-b (child of genesis)");

    // Add vertex with multiple parents
    let vertex_c = VertexBuilder::new("agent-003".to_string())
        .id("vertex-c".to_string())
        .parent("vertex-a".to_string())
        .parent("vertex-b".to_string())
        .payload(b"Transaction C (merges A and B)".to_vec())
        .build();

    graph.add_vertex(vertex_c)?;
    println!("✓ Added vertex-c (merges vertex-a and vertex-b)\n");

    // Query graph structure
    println!("=== Graph Structure ===");
    println!("Total vertices: {}", graph.vertex_count());

    // Get children of genesis
    let children = graph.get_children(&"genesis".to_string())?;
    println!("Genesis children: {:?}", children);

    // Get parents of vertex-c
    let parents = graph.get_parents(&"vertex-c".to_string())?;
    println!("Vertex-C parents: {:?}", parents);

    // Get all ancestors of vertex-c
    let ancestors = graph.get_ancestors(&"vertex-c".to_string())?;
    println!("Vertex-C ancestors: {:?}", ancestors);

    // Get topological order
    let topo_order = graph.topological_sort()?;
    println!("\nTopological order:");
    for (i, vertex_id) in topo_order.iter().enumerate() {
        let vertex = graph.get_vertex(vertex_id)?;
        println!("  {}. {} (by {})", i + 1, vertex.id, vertex.agent_id);
    }

    // Get current tips (vertices with no children)
    let tips = graph.get_tips()?;
    println!("\nCurrent tips (leaves): {:?}", tips);

    println!("\n=== Example Complete ===");
    println!("✓ Successfully demonstrated basic DAG operations");

    Ok(())
}
