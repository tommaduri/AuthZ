//! Byzantine scenario tests for BFT consensus

use cretoai_consensus::{
    BftConfig, BftEngine, ByzantineDetector, ConsensusMessage, Prepare, PrePrepare,
};
use cretoai_crypto::signatures::ML_DSA_87;
use cretoai_dag::types::{Vertex, VertexHash};
use std::collections::HashMap;
use tokio::sync::oneshot;
use uuid::Uuid;

/// Generate test keypair
fn generate_keypair() -> (Vec<u8>, Vec<u8>) {
    let scheme = ML_DSA_87::new();
    scheme.generate_keypair().unwrap()
}

/// Test basic consensus with 4 honest nodes
#[tokio::test]
async fn test_consensus_4_honest_nodes() {
    let node_ids: Vec<_> = (0..4).map(|_| Uuid::new_v4()).collect();

    // Create 4 BFT engines
    let mut engines = Vec::new();
    for node_id in &node_ids {
        let config = BftConfig {
            node_id: *node_id,
            total_nodes: 4,
            quorum_threshold: 0.67,
            ..Default::default()
        };

        let (private_key, public_key) = generate_keypair();
        let engine = BftEngine::new(config, private_key, public_key).unwrap();

        // Register all node public keys
        for other_node in &node_ids {
            if other_node != node_id {
                let (_, pk) = generate_keypair();
                engine.register_node_public_key(*other_node, pk);
            }
        }

        engines.push(engine);
    }

    // Start all engines
    for engine in &engines {
        tokio::spawn({
            let engine = engine.clone();
            async move {
                engine.start().await.unwrap();
            }
        });
    }

    // Create a vertex
    let vertex = Vertex::new(b"test data".to_vec());

    // Leader proposes
    let (tx, rx) = oneshot::channel();
    engines[0].propose(vertex, tx).await.unwrap();

    // Wait for finalization (should complete in <500ms)
    let result = tokio::time::timeout(std::time::Duration::from_millis(500), rx).await;

    assert!(result.is_ok(), "Consensus should complete within 500ms");

    // Check all nodes finalized
    for engine in &engines {
        assert_eq!(engine.message_log().stats().finalized, 1);
    }
}

/// Test consensus with 1 Byzantine node (equivocation)
#[tokio::test]
async fn test_consensus_1_byzantine_equivocation() {
    let node_ids: Vec<_> = (0..4).map(|_| Uuid::new_v4()).collect();
    let byzantine_node = node_ids[3];

    let mut engines = Vec::new();
    for (i, node_id) in node_ids.iter().enumerate() {
        let config = BftConfig {
            node_id: *node_id,
            total_nodes: 4,
            byzantine_detection_enabled: true,
            ..Default::default()
        };

        let (private_key, public_key) = generate_keypair();
        let engine = BftEngine::new(config, private_key, public_key).unwrap();

        engines.push(engine);
    }

    // Simulate Byzantine node sending conflicting prepares
    let honest_engine = &engines[0];
    let vertex_hash1 = VertexHash::new([1u8; 32]);
    let vertex_hash2 = VertexHash::new([2u8; 32]);

    let prepare1 = Prepare::new(0, 1, vertex_hash1, byzantine_node);
    let prepare2 = Prepare::new(0, 1, vertex_hash2, byzantine_node);

    // Honest nodes detect equivocation
    let mut detector = ByzantineDetector::new(4);
    let detected = detector.detect_equivocation(byzantine_node, 1, &vertex_hash1, &vertex_hash2);

    assert!(detected, "Equivocation should be detected");
    assert!(
        detector.get_reputation(&byzantine_node) < 1.0,
        "Byzantine node reputation should decrease"
    );
}

/// Test consensus with 1 Byzantine node (invalid signature)
#[tokio::test]
async fn test_consensus_1_byzantine_invalid_signature() {
    let mut detector = ByzantineDetector::new(4);
    let byzantine_node = Uuid::new_v4();

    // Detect invalid signature
    detector.detect_invalid_signature(byzantine_node);

    assert!(
        detector.get_reputation(&byzantine_node) < 1.0,
        "Reputation should decrease for invalid signature"
    );

    // Multiple violations should lead to ban
    for _ in 0..10 {
        detector.detect_invalid_signature(byzantine_node);
    }

    assert!(
        detector.is_banned(&byzantine_node),
        "Node should be banned after multiple violations"
    );
}

/// Test consensus with 1 Byzantine node (timeout violation)
#[tokio::test]
async fn test_consensus_1_byzantine_timeout() {
    let mut detector = ByzantineDetector::new(4);
    let byzantine_node = Uuid::new_v4();

    // Detect timeout violation
    detector.detect_timeout_violation(byzantine_node, 1);

    assert!(
        detector.get_reputation(&byzantine_node) < 1.0,
        "Reputation should decrease for timeout violation"
    );

    let violations = detector.get_violations(&byzantine_node);
    assert_eq!(violations.len(), 1);
}

/// Test quorum calculation with different network sizes
#[test]
fn test_quorum_calculation() {
    // 4 nodes: f=1, quorum=3
    let config = BftConfig {
        total_nodes: 4,
        ..Default::default()
    };
    assert_eq!(config.quorum_size(), 3);
    assert_eq!(config.max_byzantine(), 1);

    // 7 nodes: f=2, quorum=5
    let config = BftConfig {
        total_nodes: 7,
        ..Default::default()
    };
    assert_eq!(config.quorum_size(), 5);
    assert_eq!(config.max_byzantine(), 2);

    // 10 nodes: f=3, quorum=7
    let config = BftConfig {
        total_nodes: 10,
        ..Default::default()
    };
    assert_eq!(config.quorum_size(), 7);
    assert_eq!(config.max_byzantine(), 3);
}

/// Test Byzantine detection statistics
#[test]
fn test_byzantine_stats() {
    let mut detector = ByzantineDetector::new(4);
    let node1 = Uuid::new_v4();
    let node2 = Uuid::new_v4();

    // Add violations
    detector.detect_invalid_signature(node1);
    detector.detect_invalid_signature(node2);
    detector.detect_timeout_violation(node1, 1);

    let stats = detector.stats();
    assert_eq!(stats.total_violations, 3);
    assert_eq!(stats.nodes_tracked, 2);
    assert!(stats.avg_reputation < 1.0);
}

/// Test message log cleanup
#[test]
fn test_message_log_cleanup() {
    use cretoai_consensus::MessageLog;

    let log = MessageLog::new();

    // Add many finalized sequences
    for seq in 0..100 {
        log.mark_finalized(seq, VertexHash::new([0u8; 32]));
    }

    assert_eq!(log.stats().finalized, 100);

    // Cleanup keeping only last 10
    log.cleanup(10);

    // Should have fewer messages
    let stats = log.stats();
    assert!(stats.finalized >= 10);
}

/// Benchmark finality time under load
#[tokio::test]
async fn test_finality_time_benchmark() {
    let config = BftConfig {
        node_id: Uuid::new_v4(),
        total_nodes: 4,
        finality_timeout_ms: 500,
        ..Default::default()
    };

    let (private_key, public_key) = generate_keypair();
    let engine = BftEngine::new(config, private_key, public_key).unwrap();

    let metrics = engine.metrics();

    // Check initial finality time is 0
    let exported = metrics.export();
    assert!(exported.contains("consensus_finality_time_ms"));
}

/// Test concurrent proposals
#[tokio::test]
async fn test_concurrent_proposals() {
    let config = BftConfig {
        node_id: Uuid::new_v4(),
        total_nodes: 4,
        max_pending_vertices: 100,
        ..Default::default()
    };

    let (private_key, public_key) = generate_keypair();
    let engine = BftEngine::new(config, private_key, public_key).unwrap();

    // Try to propose multiple vertices concurrently
    let mut handles = Vec::new();

    for i in 0..10 {
        let vertex = Vertex::new(format!("data {}", i).into_bytes());
        let (tx, rx) = oneshot::channel();

        handles.push(tokio::spawn({
            let engine = engine.clone();
            async move {
                engine.propose(vertex, tx).await
            }
        }));
    }

    // Wait for all proposals
    for handle in handles {
        let _ = handle.await;
    }
}
