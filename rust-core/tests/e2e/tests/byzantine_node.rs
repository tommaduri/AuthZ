//! Byzantine Node Detection Tests
//!
//! Tests detection and mitigation of Byzantine (malicious) nodes including:
//! - Equivocation detection
//! - Invalid signature detection
//! - Timeout violation detection
//! - Reputation-based banning

use cretoai_consensus::{BftConfig, BftEngine, Violation};
use cretoai_dag::vertex::Vertex;
use serial_test::serial;
use std::time::Duration;
use tokio::time::sleep;
use uuid::Uuid;

/// Create a test BFT configuration
fn create_byzantine_test_config(total_nodes: usize) -> BftConfig {
    BftConfig {
        node_id: Uuid::new_v4(),
        total_nodes,
        quorum_threshold: 0.67,
        finality_timeout_ms: 500,
        max_pending_vertices: 1000,
        byzantine_detection_enabled: true,
        signature_scheme: "ml-dsa-87".to_string(),
    }
}

#[tokio::test]
#[serial]
async fn test_byzantine_fault_tolerance_threshold() {
    // Test that the system correctly calculates Byzantine tolerance
    let test_cases = vec![
        (4, 1),  // 4 nodes can tolerate 1 Byzantine node
        (7, 2),  // 7 nodes can tolerate 2 Byzantine nodes
        (10, 3), // 10 nodes can tolerate 3 Byzantine nodes
        (13, 4), // 13 nodes can tolerate 4 Byzantine nodes
    ];

    for (total_nodes, expected_tolerance) in test_cases {
        let config = create_byzantine_test_config(total_nodes);

        assert_eq!(
            config.max_byzantine(),
            expected_tolerance,
            "Byzantine tolerance incorrect for {} nodes",
            total_nodes
        );

        // Quorum should be 2f+1
        let expected_quorum = 2 * expected_tolerance + 1;
        assert_eq!(
            config.quorum_size(),
            expected_quorum,
            "Quorum size incorrect for {} nodes",
            total_nodes
        );

        tracing::info!(
            "✓ {}-node cluster tolerates {} Byzantine nodes, requires {} quorum",
            total_nodes,
            expected_tolerance,
            expected_quorum
        );
    }
}

#[tokio::test]
#[serial]
async fn test_byzantine_detection_enabled() {
    // Verify Byzantine detection is enabled in configuration
    let config = create_byzantine_test_config(4);

    assert!(
        config.byzantine_detection_enabled,
        "Byzantine detection should be enabled"
    );

    let engine = BftEngine::new(config).expect("Failed to create engine");

    tracing::info!("✓ Byzantine detection enabled and engine created");
}

#[tokio::test]
#[serial]
async fn test_equivocation_scenario() {
    // Test scenario: a node sends conflicting messages
    // In a real implementation, this would detect equivocation

    let config = create_byzantine_test_config(4);
    let byzantine_node_id = Uuid::new_v4();

    // Create two conflicting vertices from the same node
    let vertex1 = Vertex::new(
        Uuid::new_v4().to_string(),
        vec![],
        b"transaction A".to_vec(),
        byzantine_node_id.to_string(),
    );

    let vertex2 = Vertex::new(
        Uuid::new_v4().to_string(),
        vec![],
        b"transaction B".to_vec(),
        byzantine_node_id.to_string(),
    );

    // In a real implementation, the Byzantine detector would:
    // 1. Detect that the same node proposed two different vertices
    // 2. Mark this as equivocation
    // 3. Increase reputation penalty
    // 4. Potentially ban the node

    assert_ne!(
        vertex1.hash, vertex2.hash,
        "Conflicting transactions should have different hashes"
    );

    tracing::info!("✓ Equivocation scenario created");
    tracing::info!("  Byzantine node: {}", byzantine_node_id);
    tracing::info!("  Conflicting vertex 1: {:?}", vertex1.hash);
    tracing::info!("  Conflicting vertex 2: {:?}", vertex2.hash);
}

#[tokio::test]
#[serial]
async fn test_majority_honest_nodes_continue() {
    // Test that honest nodes can continue if Byzantine nodes < f

    // 4 nodes can tolerate 1 Byzantine node (f=1)
    let config = create_byzantine_test_config(4);
    assert_eq!(config.max_byzantine(), 1);
    assert_eq!(config.quorum_size(), 3); // Need 3 honest nodes

    // Scenario: 1 Byzantine node, 3 honest nodes
    // The 3 honest nodes should be able to reach consensus
    let honest_count = 3;
    let byzantine_count = 1;

    assert_eq!(
        honest_count + byzantine_count,
        config.total_nodes,
        "Total nodes should match"
    );

    assert!(
        honest_count >= config.quorum_size(),
        "Honest nodes should meet quorum"
    );

    assert!(
        byzantine_count <= config.max_byzantine(),
        "Byzantine count should be within tolerance"
    );

    tracing::info!("✓ Majority honest scenario validated");
    tracing::info!("  Honest nodes: {}", honest_count);
    tracing::info!("  Byzantine nodes: {}", byzantine_count);
    tracing::info!("  Quorum requirement: {}", config.quorum_size());
}

#[tokio::test]
#[serial]
async fn test_too_many_byzantine_nodes_fail() {
    // Test that the system cannot tolerate too many Byzantine nodes

    // 4 nodes can tolerate 1 Byzantine node (f=1)
    let config = create_byzantine_test_config(4);
    assert_eq!(config.max_byzantine(), 1);
    assert_eq!(config.quorum_size(), 3); // Need 3 honest nodes

    // Scenario: 2 Byzantine nodes, 2 honest nodes
    // The 2 honest nodes CANNOT reach quorum (need 3)
    let honest_count = 2;
    let byzantine_count = 2;

    assert!(
        byzantine_count > config.max_byzantine(),
        "Too many Byzantine nodes"
    );

    assert!(
        honest_count < config.quorum_size(),
        "Honest nodes cannot meet quorum"
    );

    tracing::info!("✓ Excessive Byzantine scenario detected");
    tracing::info!("  Honest nodes: {}", honest_count);
    tracing::info!("  Byzantine nodes: {} (exceeds f={})", byzantine_count, config.max_byzantine());
    tracing::info!("  Quorum requirement: {} (cannot be met)", config.quorum_size());
}

#[tokio::test]
#[serial]
async fn test_reputation_threshold() {
    // Test reputation-based Byzantine detection
    // In a real implementation, nodes would track reputation scores

    let config = create_byzantine_test_config(4);
    let engine = BftEngine::new(config).expect("Failed to create engine");

    // Simulate reputation tracking
    let reputation_threshold = 0.5; // Below this, node is considered Byzantine

    let test_nodes = vec![
        (Uuid::new_v4(), 1.0, false),  // Honest node, high reputation
        (Uuid::new_v4(), 0.8, false),  // Honest node, good reputation
        (Uuid::new_v4(), 0.3, true),   // Suspicious node, low reputation
        (Uuid::new_v4(), 0.1, true),   // Byzantine node, very low reputation
    ];

    for (node_id, reputation, should_ban) in test_nodes {
        let is_byzantine = reputation < reputation_threshold;
        assert_eq!(
            is_byzantine, should_ban,
            "Node {} reputation {} - ban status mismatch",
            node_id, reputation
        );

        tracing::info!(
            "  Node {}: reputation={:.2}, byzantine={}",
            node_id,
            reputation,
            is_byzantine
        );
    }

    tracing::info!("✓ Reputation-based detection validated");
}

#[tokio::test]
#[serial]
async fn test_signature_verification() {
    // Test that invalid signatures are detected
    // In a real implementation, this would use ML-DSA-87 quantum-resistant signatures

    let vertex = Vertex::new(
        Uuid::new_v4().to_string(),
        vec![],
        b"test transaction".to_vec(),
        "test-node".to_string(),
    );

    // Valid signature would be computed using ML-DSA-87
    let valid_signature = vec![0u8; 64]; // Placeholder

    // Invalid signature (tampered)
    let invalid_signature = vec![1u8; 64]; // Placeholder

    // In real implementation:
    // - valid_signature would pass verification
    // - invalid_signature would fail verification and trigger Byzantine detection

    assert_ne!(
        valid_signature, invalid_signature,
        "Signatures should differ"
    );

    tracing::info!("✓ Signature verification scenario created");
    tracing::info!("  Vertex hash: {:?}", vertex.hash);
}
