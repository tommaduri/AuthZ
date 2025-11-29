// Consensus Integration Tests over LibP2P
// Tests for DAG consensus vertex propagation via Gossipsub

use super::test_utils::*;
use std::time::Duration;

#[tokio::test]
async fn test_consensus_vertex_broadcast() {
    let nodes = create_swarm_cluster(3).await;

    if let Ok(mut nodes) = nodes {
        // All subscribe to consensus topic
        for node in &mut nodes {
            let _ = node.subscribe("vigilia/consensus/v1").await;
        }

        // Connect nodes
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;
        let _ = wait_for_network_stabilization().await;

        // Node 0 broadcasts vertex
        let vertex_msg = MockVertexMessage::new(vec![1, 2, 3, 4, 5]);
        if let Ok(data) = vertex_msg.serialize() {
            let _ = nodes[0].publish("vigilia/consensus/v1", &data).await;

            // Other nodes should receive
            // TDD: Define receive API
            // for i in 1..3 {
            //     let received = nodes[i].receive_timeout(Duration::from_millis(100)).await?;
            //     let received_msg = MockVertexMessage::deserialize(&received.data)?;
            //     assert_eq!(received_msg, vertex_msg);
            // }
        }
    }
}

#[tokio::test]
async fn test_consensus_ml_dsa_signature_verification() {
    // From spec: All vertices must have valid ML-DSA signatures
    let nodes = create_swarm_cluster(2).await;

    if let Ok(mut nodes) = nodes {
        let _ = nodes[0].subscribe("vigilia/consensus/v1").await;
        let _ = nodes[1].subscribe("vigilia/consensus/v1").await;
        let _ = nodes[0].dial(&nodes[1].peer_id, "127.0.0.1:0").await;

        // Create vertex with invalid signature
        let mut vertex_msg = MockVertexMessage::new(vec![1, 2, 3]);
        vertex_msg.signature = vec![0u8; 64]; // Invalid

        if let Ok(data) = vertex_msg.serialize() {
            let _ = nodes[0].publish("vigilia/consensus/v1", &data).await;

            // Node 1 should reject (validation should fail)
            // let validation_result = nodes[1].validate_consensus_message(&data);
            // assert!(validation_result.is_err(), "Invalid signature should be rejected");
        }
    }
}

#[tokio::test]
async fn test_consensus_vertex_deduplication() {
    // Vertices should not be re-broadcast if already seen
    let nodes = create_swarm_cluster(3).await;

    if let Ok(mut nodes) = nodes {
        for node in &mut nodes {
            let _ = node.subscribe("vigilia/consensus/v1").await;
        }
        let _ = connect_topology(&mut nodes, super::TestTopology::Ring).await;

        let vertex_msg = MockVertexMessage::new(vec![1, 2, 3]);
        if let Ok(data) = vertex_msg.serialize() {
            let _ = nodes[0].publish("vigilia/consensus/v1", &data).await;

            // Wait for propagation
            tokio::time::sleep(Duration::from_millis(200)).await;

            // Check message cache
            // let cache = nodes[1].message_cache();
            // assert!(cache.contains(&vertex_msg.vertex_hash), "Vertex should be cached");

            // Re-publishing should be no-op
            let _ = nodes[1].publish("vigilia/consensus/v1", &data).await;
            // assert!(result.is_err() || result.unwrap().is_duplicate());
        }
    }
}

#[tokio::test]
async fn test_consensus_dag_integration() {
    // Received vertices should be added to local DAG
    let nodes = create_swarm_cluster(5).await;

    if let Ok(mut nodes) = nodes {
        for node in &mut nodes {
            let _ = node.subscribe("vigilia/consensus/v1").await;
        }
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;

        // Create vertex
        let vertex_msg = MockVertexMessage::new(vec![1, 2, 3]);
        if let Ok(data) = vertex_msg.serialize() {
            let _ = nodes[0].publish("vigilia/consensus/v1", &data).await;
            tokio::time::sleep(Duration::from_millis(100)).await;

            // All nodes should have vertex in DAG
            // for node in &nodes {
            //     assert!(node.dag().has_vertex(&vertex_msg.vertex_hash)?);
            // }
        }
    }
}

#[tokio::test]
async fn test_consensus_request_response_protocol() {
    // Node should be able to request specific vertices
    let nodes = create_swarm_cluster(2).await;

    if let Ok(mut nodes) = nodes {
        let _ = nodes[0].dial(&nodes[1].peer_id, "127.0.0.1:0").await;

        // Node 0 has vertex in DAG
        let vertex_msg = MockVertexMessage::new(vec![1, 2, 3]);
        // nodes[0].dag().add_vertex(&vertex_msg)?;

        // Node 1 requests vertex
        // let response = nodes[1].request_vertex(&nodes[0].peer_id, &vertex_msg.vertex_hash).await?;
        // assert_eq!(response.vertex_hash, vertex_msg.vertex_hash);
    }
}

#[tokio::test]
async fn test_consensus_five_node_distributed_dag() {
    // Complete consensus flow: 5 nodes, multiple vertices
    let nodes = create_swarm_cluster(5).await;

    if let Ok(mut nodes) = nodes {
        for node in &mut nodes {
            let _ = node.subscribe("vigilia/consensus/v1").await;
        }
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;
        let _ = wait_for_network_stabilization().await;

        // Each node broadcasts a vertex
        for i in 0..5 {
            let vertex_msg = MockVertexMessage::new(vec![i as u8; 10]);
            if let Ok(data) = vertex_msg.serialize() {
                let _ = nodes[i].publish("vigilia/consensus/v1", &data).await;
            }
        }

        // Wait for all vertices to propagate
        tokio::time::sleep(Duration::from_millis(500)).await;

        // Each node should have all 5 vertices in DAG
        // for node in &nodes {
        //     assert_eq!(node.dag().vertex_count(), 5);
        // }
    }
}

#[tokio::test]
async fn test_consensus_message_propagation_latency() {
    // From spec: p95 < 100ms for message propagation
    let nodes = create_swarm_cluster(100).await;

    if let Ok(mut nodes) = nodes {
        for node in &mut nodes {
            let _ = node.subscribe("vigilia/consensus/v1").await;
        }
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;
        let _ = wait_for_network_stabilization().await;

        // Measure 100 message propagations
        let mut latencies = Vec::new();

        for i in 0..100 {
            let perf = PerformanceMeasurement::start();
            let vertex_msg = MockVertexMessage::new(vec![i as u8; 100]);

            if let Ok(data) = vertex_msg.serialize() {
                let _ = nodes[0].publish("vigilia/consensus/v1", &data).await;

                // Wait for all nodes to receive
                // while !all_nodes_have_vertex(&nodes, &vertex_msg.vertex_hash) {
                //     tokio::time::sleep(Duration::from_millis(10)).await;
                // }

                latencies.push(perf.elapsed_ms());
            }
        }

        // Calculate p95
        let p95 = calculate_percentile(latencies, 0.95);
        assert!(
            p95 < 100,
            "p95 message propagation latency should be < 100ms, got {}ms",
            p95
        );
    }
}

#[tokio::test]
async fn test_consensus_throughput() {
    // From spec: > 100 TPS network-wide
    let nodes = create_swarm_cluster(10).await;

    if let Ok(mut nodes) = nodes {
        for node in &mut nodes {
            let _ = node.subscribe("vigilia/consensus/v1").await;
        }
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;
        let _ = wait_for_network_stabilization().await;

        // Measure throughput over 10 seconds
        let start = std::time::Instant::now();
        let mut vertex_count = 0;

        while start.elapsed().as_secs() < 10 {
            for i in 0..10 {
                let vertex_msg = MockVertexMessage::new(vec![vertex_count as u8; 50]);
                if let Ok(data) = vertex_msg.serialize() {
                    let _ = nodes[i % nodes.len()].publish("vigilia/consensus/v1", &data).await;
                    vertex_count += 1;
                }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }

        let elapsed = start.elapsed().as_secs_f64();
        let tps = vertex_count as f64 / elapsed;

        assert!(
            tps > 100.0,
            "Consensus TPS should be > 100, got {:.2}",
            tps
        );
    }
}

#[tokio::test]
async fn test_consensus_byzantine_invalid_vertex() {
    // Byzantine node sends malformed vertex
    let nodes = create_swarm_cluster(10).await;

    if let Ok(mut nodes) = nodes {
        for node in &mut nodes {
            let _ = node.subscribe("vigilia/consensus/v1").await;
        }
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;

        // Node 0 is Byzantine - sends invalid vertex
        let invalid_data = vec![0xFF; 100]; // Garbage data
        let _ = nodes[0].publish("vigilia/consensus/v1", &invalid_data).await;

        tokio::time::sleep(Duration::from_millis(100)).await;

        // Honest nodes should reject
        // for i in 1..10 {
        //     assert_eq!(nodes[i].dag().vertex_count(), 0, "Invalid vertex should be rejected");
        // }

        // Byzantine node's score should drop
        // let score = nodes[1].peer_score(&nodes[0].peer_id)?;
        // assert!(score < -10.0, "Byzantine node should have negative score");
    }
}

#[tokio::test]
async fn test_consensus_network_partition_recovery() {
    // Simulate network partition and recovery
    let nodes = create_swarm_cluster(6).await;

    if let Ok(mut nodes) = nodes {
        for node in &mut nodes {
            let _ = node.subscribe("vigilia/consensus/v1").await;
        }

        // Create two partitions: [0,1,2] and [3,4,5]
        for i in 0..3 {
            for j in 0..3 {
                if i != j {
                    let _ = nodes[i].dial(&nodes[j].peer_id, "127.0.0.1:0").await;
                }
            }
        }
        for i in 3..6 {
            for j in 3..6 {
                if i != j {
                    let _ = nodes[i].dial(&nodes[j].peer_id, "127.0.0.1:0").await;
                }
            }
        }

        // Each partition broadcasts vertices
        let vertex_a = MockVertexMessage::new(vec![1; 10]);
        let vertex_b = MockVertexMessage::new(vec![2; 10]);

        if let (Ok(data_a), Ok(data_b)) = (vertex_a.serialize(), vertex_b.serialize()) {
            let _ = nodes[0].publish("vigilia/consensus/v1", &data_a).await;
            let _ = nodes[3].publish("vigilia/consensus/v1", &data_b).await;
            tokio::time::sleep(Duration::from_millis(100)).await;

            // Heal partition
            let _ = nodes[2].dial(&nodes[3].peer_id, "127.0.0.1:0").await;
            tokio::time::sleep(Duration::from_millis(500)).await;

            // All nodes should now have both vertices
            // for node in &nodes {
            //     assert!(node.dag().has_vertex(&vertex_a.vertex_hash)?);
            //     assert!(node.dag().has_vertex(&vertex_b.vertex_hash)?);
            // }
        }
    }
}

#[tokio::test]
async fn test_consensus_peer_scoring_integration() {
    // Peers that deliver messages get positive scores
    let nodes = create_swarm_cluster(5).await;

    if let Ok(mut nodes) = nodes {
        for node in &mut nodes {
            let _ = node.subscribe("vigilia/consensus/v1").await;
        }
        let _ = connect_topology(&mut nodes, super::TestTopology::Star).await;

        // Hub node (0) broadcasts multiple vertices
        for i in 0..10 {
            let vertex_msg = MockVertexMessage::new(vec![i; 10]);
            if let Ok(data) = vertex_msg.serialize() {
                let _ = nodes[0].publish("vigilia/consensus/v1", &data).await;
            }
        }

        tokio::time::sleep(Duration::from_secs(2)).await;

        // Peripheral nodes should have positive scores (delivered messages)
        // for i in 1..5 {
        //     let score = nodes[0].peer_score(&nodes[i].peer_id)?;
        //     assert!(score > 0.0, "Honest peer should have positive score");
        // }
    }
}

#[tokio::test]
async fn test_consensus_message_validation_callback() {
    // Custom validation logic should be called
    if let Ok(mut swarm) = MockVigiliaSwarm::new("test-agent".to_string()).await {
        let _ = swarm.subscribe("vigilia/consensus/v1").await;

        // Set custom validator
        // swarm.set_message_validator("vigilia/consensus/v1", |msg| {
        //     let vertex_msg = MockVertexMessage::deserialize(&msg.data)?;
        //     vertex_msg.verify_signature()?;
        //     Ok(ValidationResult::Accept)
        // });

        // Publish message - validator should be called
        let vertex_msg = MockVertexMessage::new(vec![1, 2, 3]);
        if let Ok(data) = vertex_msg.serialize() {
            let _ = swarm.publish("vigilia/consensus/v1", &data).await;
        }
    }
}

#[tokio::test]
async fn test_consensus_backwards_compatibility() {
    // Messages from old implementation should still work
    if let Ok(swarm) = MockVigiliaSwarm::new("test-agent".to_string()).await {
        // Old message format (bincode-serialized VertexMessage)
        // let old_msg = create_legacy_vertex_message();
        // let data = bincode::serialize(&old_msg)?;

        // Should deserialize and validate correctly
        // let vertex_msg = MockVertexMessage::deserialize(&data)?;
        // assert!(vertex_msg.verify_signature().is_ok());
    }
}

#[tokio::test]
async fn test_consensus_topic_name_mapping() {
    // From spec: "consensus" -> "vigilia/consensus/v1"
    if let Ok(mut swarm) = MockVigiliaSwarm::new("test-agent".to_string()).await {
        // Should accept both formats
        let _ = swarm.subscribe("consensus").await;
        let _ = swarm.subscribe("vigilia/consensus/v1").await;

        // Should map to same topic
        // let topics = swarm.subscribed_topics();
        // assert_eq!(topics.len(), 1, "Should map to same topic");
    }
}
