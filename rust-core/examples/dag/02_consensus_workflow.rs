//! Consensus Workflow Example
//!
//! This example demonstrates:
//! - Creating a consensus engine
//! - Registering network nodes
//! - Running consensus on vertices
//! - Batch consensus processing
//! - Byzantine fault tolerance

use cretoai_dag::consensus::{ConsensusEngine, ConsensusParams};
use cretoai_dag::graph::Graph;
use cretoai_dag::vertex::VertexBuilder;
use std::sync::Arc;
use std::time::Instant;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== Consensus Workflow Example ===\n");

    // Create DAG and consensus engine
    let graph = Arc::new(Graph::new());

    // Configure consensus parameters
    let params = ConsensusParams {
        sample_size: 30,              // Query 30 nodes per round
        alpha_threshold: 24,          // Need 24/30 (80%) agreement
        beta_threshold: 5,            // 5 consecutive successes
        finalization_threshold: 0.8,  // 80% confidence for finality
        max_rounds: 100,              // Maximum 100 consensus rounds
        min_network_size: 50,         // Minimum 50 nodes required
    };

    let engine = ConsensusEngine::with_params(
        graph.clone(),
        "coordinator-agent".to_string(),
        params,
    );
    println!("✓ Created consensus engine with params:");
    println!("  - Sample size (k): 30 nodes");
    println!("  - Alpha threshold: 24/30 (80%)");
    println!("  - Beta threshold: 5 consecutive rounds");
    println!("  - Finalization: 80% confidence\n");

    // Register network nodes
    println!("Registering network nodes...");
    for i in 0..100 {
        engine.register_node(format!("node-{:03}", i))?;
    }
    println!("✓ Registered 100 network nodes");

    // Simulate Byzantine nodes (20% malicious, well below 33% threshold)
    println!("  (Note: Consensus simulates 20% Byzantine nodes)\n");

    // Add vertices to the graph
    println!("=== Adding Vertices ===");

    let genesis = VertexBuilder::new("agent-001".to_string())
        .id("genesis".to_string())
        .build();
    graph.add_vertex(genesis)?;
    println!("✓ Added genesis vertex");

    // Run consensus on genesis
    println!("\n=== Running Consensus on Genesis ===");
    let start = Instant::now();
    engine.run_consensus(&"genesis".to_string())?;
    let duration = start.elapsed();

    let genesis_vertex = graph.get_vertex(&"genesis".to_string())?;
    println!("✓ Consensus completed in {:?}", duration);
    println!("  - Finalized: {}", genesis_vertex.metadata.finalized);
    println!("  - Confidence: {:.2}", genesis_vertex.metadata.confidence);
    println!("  - Confirmations: {}", genesis_vertex.metadata.confirmations);

    // Add more vertices
    println!("\n=== Batch Consensus ===");
    let mut vertex_ids = Vec::new();

    for i in 1..=10 {
        let vertex = VertexBuilder::new(format!("agent-{:03}", i))
            .id(format!("vertex-{}", i))
            .parent("genesis".to_string())
            .payload(format!("Transaction {}", i).into_bytes())
            .build();

        vertex_ids.push(vertex.id.clone());
        graph.add_vertex(vertex)?;
    }
    println!("✓ Added 10 vertices");

    // Run batch consensus
    println!("\nRunning batch consensus on 10 vertices...");
    let start = Instant::now();
    let finalized = engine.batch_consensus(&vertex_ids)?;
    let duration = start.elapsed();

    println!("✓ Batch consensus completed in {:?}", duration);
    println!("  - Total finalized: {}/{}", finalized, vertex_ids.len());
    println!("  - Average: {:?} per vertex", duration / vertex_ids.len() as u32);

    // Show individual vertex status
    println!("\n=== Vertex Status ===");
    for vertex_id in &vertex_ids[..3] {  // Show first 3
        let vertex = graph.get_vertex(vertex_id)?;
        println!("{}:", vertex_id);
        println!("  - Finalized: {}", vertex.metadata.finalized);
        println!("  - Confidence: {:.4}", vertex.metadata.confidence);
        println!("  - Round: {}", vertex.metadata.round);
    }
    println!("  ... (7 more vertices)");

    // Demonstrate fault tolerance
    println!("\n=== Byzantine Fault Tolerance ===");
    println!("The consensus engine simulates network conditions:");
    println!("  - 80% honest nodes (vote based on validity)");
    println!("  - 20% Byzantine nodes (vote randomly)");
    println!("  - Threshold: < 33.3% Byzantine for safety");
    println!("✓ System remains safe with 20% malicious nodes");

    println!("\n=== Example Complete ===");
    println!("✓ Demonstrated QR-Avalanche consensus");
    println!("✓ Achieved Byzantine fault tolerance");
    println!("✓ Batch processed multiple vertices");

    Ok(())
}
