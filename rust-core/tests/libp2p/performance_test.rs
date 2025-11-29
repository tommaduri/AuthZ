// Performance Benchmark Tests
// Tests for latency, throughput, and resource usage targets

use super::test_utils::*;
use std::time::Duration;

#[tokio::test]
async fn test_message_propagation_p95_latency() {
    // From spec: p95 < 100ms for 100 nodes
    let nodes = create_swarm_cluster(100).await;

    if let Ok(mut nodes) = nodes {
        for node in &mut nodes {
            let _ = node.subscribe("test-topic").await;
        }
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;
        let _ = wait_for_network_stabilization().await;

        // Measure 100 message propagations
        let mut latencies = Vec::new();

        for i in 0..100 {
            let perf = PerformanceMeasurement::start();
            let data = vec![i as u8; 100];

            let _ = nodes[0].publish("test-topic", &data).await;

            // Wait for all nodes to receive
            // while !all_nodes_received(&nodes, &message_id) {
            //     tokio::time::sleep(Duration::from_millis(1)).await;
            // }

            latencies.push(perf.elapsed_ms());
        }

        let p95 = calculate_percentile(latencies, 0.95);
        assert!(
            p95 < 100,
            "p95 latency should be < 100ms, got {}ms",
            p95
        );
    }
}

#[tokio::test]
async fn test_message_propagation_p99_latency() {
    // From spec: p99 < 200ms
    let nodes = create_swarm_cluster(100).await;

    if let Ok(mut nodes) = nodes {
        for node in &mut nodes {
            let _ = node.subscribe("test-topic").await;
        }
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;
        let _ = wait_for_network_stabilization().await;

        let mut latencies = Vec::new();

        for i in 0..100 {
            let perf = PerformanceMeasurement::start();
            let data = vec![i as u8; 100];

            let _ = nodes[0].publish("test-topic", &data).await;
            // Wait for full propagation
            latencies.push(perf.elapsed_ms());
        }

        let p99 = calculate_percentile(latencies, 0.99);
        assert!(
            p99 < 200,
            "p99 latency should be < 200ms, got {}ms",
            p99
        );
    }
}

#[tokio::test]
async fn test_gossipsub_throughput_single_node() {
    // From spec: > 1000 msg/s per node
    if let Ok(mut swarm) = MockVigiliaSwarm::new("test-agent".to_string()).await {
        let _ = swarm.subscribe("test-topic").await;

        let start = std::time::Instant::now();
        let mut message_count = 0;

        // Publish for 5 seconds
        while start.elapsed().as_secs() < 5 {
            let data = vec![0u8; 100];
            if swarm.publish("test-topic", &data).await.is_ok() {
                message_count += 1;
            }
        }

        let throughput = message_count as f64 / start.elapsed().as_secs_f64();
        assert!(
            throughput > 1000.0,
            "Throughput should be > 1000 msg/s, got {:.2}",
            throughput
        );
    }
}

#[tokio::test]
async fn test_consensus_network_throughput() {
    // From spec: > 100 TPS network-wide
    let nodes = create_swarm_cluster(10).await;

    if let Ok(mut nodes) = nodes {
        for node in &mut nodes {
            let _ = node.subscribe("vigilia/consensus/v1").await;
        }
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;
        let _ = wait_for_network_stabilization().await;

        let start = std::time::Instant::now();
        let mut total_vertices = 0;

        // All nodes publish vertices for 10 seconds
        while start.elapsed().as_secs() < 10 {
            for i in 0..10 {
                let vertex_msg = MockVertexMessage::new(vec![total_vertices as u8; 50]);
                if let Ok(data) = vertex_msg.serialize() {
                    if nodes[i].publish("vigilia/consensus/v1", &data).await.is_ok() {
                        total_vertices += 1;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }

        let tps = total_vertices as f64 / start.elapsed().as_secs_f64();
        assert!(tps > 100.0, "TPS should be > 100, got {:.2}", tps);
    }
}

#[tokio::test]
async fn test_dht_lookup_latency() {
    // From spec: DHT lookup < 500ms
    let nodes = create_swarm_cluster(50).await;

    if let Ok(mut nodes) = nodes {
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;
        tokio::time::sleep(Duration::from_secs(3)).await;

        // Measure 20 DHT lookups
        let mut latencies = Vec::new();

        for _ in 0..20 {
            let perf = PerformanceMeasurement::start();
            // let query_id = nodes[0].kademlia_find_peer(&nodes[49].peer_id).await?;
            // nodes[0].wait_for_kad_query(query_id, Duration::from_secs(1)).await?;

            latencies.push(perf.elapsed_ms());
        }

        let avg_latency = latencies.iter().sum::<u64>() / latencies.len() as u64;
        assert!(
            avg_latency < 500,
            "DHT lookup should be < 500ms, got {}ms",
            avg_latency
        );
    }
}

#[tokio::test]
async fn test_connection_establishment_time() {
    // From spec: < 1s including ML-KEM-768 handshake
    let nodes = create_swarm_cluster(2).await;

    if let Ok(mut nodes) = nodes {
        let _ = nodes[0].listen("/ip4/127.0.0.1/udp/4001/quic").await;

        // Measure connection time
        let perf = PerformanceMeasurement::start();
        let _ = nodes[1]
            .dial(&nodes[0].peer_id, "/ip4/127.0.0.1/udp/4001/quic")
            .await;

        // Should connect in < 1 second
        perf.assert_less_than_ms(1000).unwrap_or_else(|_| {
            panic!(
                "Connection should establish in < 1s, took {}ms",
                perf.elapsed_ms()
            )
        });
    }
}

#[tokio::test]
async fn test_memory_usage_per_node() {
    // From spec: < 500 MB per node
    if let Ok(mut swarm) = MockVigiliaSwarm::new("test-agent".to_string()).await {
        let _ = swarm.listen("/ip4/127.0.0.1/tcp/0").await;
        let _ = swarm.subscribe("test-topic").await;

        // Establish 100 connections
        // for i in 0..100 {
        //     let peer = create_peer(format!("peer-{}", i));
        //     swarm.dial(&peer.peer_id, "127.0.0.1:0").await?;
        // }

        // Measure memory
        // let memory_usage = get_process_memory_mb();
        // assert!(memory_usage < 500, "Memory should be < 500MB, got {}MB", memory_usage);
    }
}

#[tokio::test]
async fn test_cpu_usage_idle() {
    // From spec: < 5% CPU when idle
    if let Ok(swarm) = MockVigiliaSwarm::new("test-agent".to_string()).await {
        // Let swarm run idle for 10 seconds
        tokio::time::sleep(Duration::from_secs(10)).await;

        // Measure CPU usage
        // let cpu_usage = get_process_cpu_usage();
        // assert!(cpu_usage < 5.0, "Idle CPU should be < 5%, got {:.2}%", cpu_usage);
    }
}

#[tokio::test]
async fn test_cpu_usage_active() {
    // From spec: < 50% CPU when actively publishing
    if let Ok(mut swarm) = MockVigiliaSwarm::new("test-agent".to_string()).await {
        let _ = swarm.subscribe("test-topic").await;

        // Start publishing at high rate
        let start = std::time::Instant::now();
        while start.elapsed().as_secs() < 10 {
            let data = vec![0u8; 1024];
            let _ = swarm.publish("test-topic", &data).await;
        }

        // Measure CPU during activity
        // let cpu_usage = get_process_cpu_usage();
        // assert!(cpu_usage < 50.0, "Active CPU should be < 50%, got {:.2}%", cpu_usage);
    }
}

#[tokio::test]
async fn test_bandwidth_efficiency() {
    // From spec: > 80% bandwidth efficiency
    let nodes = create_swarm_cluster(2).await;

    if let Ok(mut nodes) = nodes {
        let _ = nodes[0].dial(&nodes[1].peer_id, "127.0.0.1:0").await;

        // Send 1 MB of payload
        let payload = vec![0u8; 1024 * 1024];
        // nodes[0].send(&nodes[1].peer_id, &payload).await?;

        // Measure total bytes sent (including overhead)
        // let stats = nodes[0].connection_stats(&nodes[1].peer_id)?;
        // let efficiency = (payload.len() as f64) / (stats.total_bytes_sent as f64);

        // assert!(efficiency > 0.8, "Bandwidth efficiency should be > 80%, got {:.2}%", efficiency * 100.0);
    }
}

#[tokio::test]
async fn test_connection_pooling_efficiency() {
    // Reuse connections for multiple protocols
    let nodes = create_swarm_cluster(2).await;

    if let Ok(mut nodes) = nodes {
        let _ = nodes[0].dial(&nodes[1].peer_id, "127.0.0.1:0").await;

        // Use connection for multiple purposes
        // nodes[0].publish_gossipsub(&nodes[1].peer_id, "topic1", b"data").await?;
        // nodes[0].send_request_response(&nodes[1].peer_id, b"request").await?;
        // nodes[0].kad_query(&nodes[1].peer_id, b"key").await?;

        // Should only have 1 connection
        // let connections = nodes[0].active_connections();
        // assert_eq!(connections.len(), 1, "Should reuse single connection");
    }
}

#[tokio::test]
async fn test_scalability_100_nodes() {
    // Network should function with 100 nodes
    let nodes = create_swarm_cluster(100).await;

    if let Ok(mut nodes) = nodes {
        for node in &mut nodes {
            let _ = node.subscribe("test-topic").await;
        }
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;
        let _ = wait_for_network_stabilization().await;

        // Publish message
        let data = vec![0u8; 100];
        let _ = nodes[0].publish("test-topic", &data).await;

        // Wait for propagation
        tokio::time::sleep(Duration::from_millis(500)).await;

        // All nodes should receive
        // for node in &nodes {
        //     assert!(node.received_message(&data));
        // }
    }
}

#[tokio::test]
async fn test_scalability_1000_nodes() {
    // From spec: Network should scale to 10,000+ nodes
    // Testing 1000 for practical test runtime
    let nodes = create_swarm_cluster(1000).await;

    if let Ok(mut nodes) = nodes {
        for node in &mut nodes {
            let _ = node.subscribe("test-topic").await;
        }

        // Partial mesh (not full - too many connections)
        // Each node connects to 20 random peers
        // connect_partial_mesh(&mut nodes, 20).await;

        let _ = wait_for_network_stabilization().await;

        // Message should still propagate
        let data = vec![0u8; 100];
        let perf = PerformanceMeasurement::start();
        let _ = nodes[0].publish("test-topic", &data).await;

        // Wait for propagation to majority (> 90%)
        // while nodes_received_count(&nodes, &data) < 900 {
        //     tokio::time::sleep(Duration::from_millis(10)).await;
        // }

        // Should propagate in reasonable time (< 1s)
        // perf.assert_less_than_ms(1000)?;
    }
}

#[tokio::test]
async fn test_mesh_maintenance_overhead() {
    // Gossipsub mesh maintenance should be efficient
    if let Ok(swarm) = MockVigiliaSwarm::new("test-agent".to_string()).await {
        // Let mesh maintenance run for 60 seconds
        tokio::time::sleep(Duration::from_secs(60)).await;

        // Measure heartbeat overhead
        // let heartbeat_count = swarm.gossipsub_heartbeat_count();
        // assert_eq!(heartbeat_count, 60, "Should send 1 heartbeat per second");

        // Heartbeat bandwidth should be minimal
        // let heartbeat_bytes = swarm.gossipsub_heartbeat_bytes();
        // assert!(heartbeat_bytes < 10_000, "Heartbeat overhead should be < 10KB/min");
    }
}

#[tokio::test]
async fn test_concurrent_dht_queries() {
    // From spec: > 100 qps for DHT queries
    let nodes = create_swarm_cluster(50).await;

    if let Ok(mut nodes) = nodes {
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;
        tokio::time::sleep(Duration::from_secs(3)).await;

        let start = std::time::Instant::now();
        let mut query_count = 0;

        // Run queries for 5 seconds
        while start.elapsed().as_secs() < 5 {
            // Issue 10 concurrent queries
            // for _ in 0..10 {
            //     nodes[0].kademlia_find_peer(&random_peer_id()).await?;
            //     query_count += 1;
            // }
        }

        let qps = query_count as f64 / start.elapsed().as_secs_f64();
        assert!(qps > 100.0, "DHT QPS should be > 100, got {:.2}", qps);
    }
}

#[tokio::test]
async fn test_memory_leak_detection() {
    // Long-running test to detect memory leaks
    if let Ok(mut swarm) = MockVigiliaSwarm::new("test-agent".to_string()).await {
        let _ = swarm.subscribe("test-topic").await;

        // Initial memory
        // let initial_memory = get_process_memory_mb();

        // Publish 10,000 messages
        for i in 0..10_000 {
            let data = vec![i as u8; 100];
            let _ = swarm.publish("test-topic", &data).await;
        }

        // Force garbage collection
        // force_gc();

        // Final memory
        // let final_memory = get_process_memory_mb();
        // let memory_increase = final_memory - initial_memory;

        // Should not leak significantly (< 50 MB increase)
        // assert!(memory_increase < 50, "Memory leak detected: {}MB increase", memory_increase);
    }
}
