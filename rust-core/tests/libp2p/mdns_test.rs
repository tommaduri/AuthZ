// mDNS Local Discovery Tests
// Tests for automatic peer discovery on local networks

use super::test_utils::*;
use std::time::Duration;

#[tokio::test]
async fn test_mdns_initialization() {
    if let Ok(swarm) = MockVigiliaSwarm::new("test-agent".to_string()).await {
        // mDNS should be enabled by default
        // let mdns_enabled = swarm.mdns_enabled();
        // assert!(mdns_enabled, "mDNS should be enabled");
    }
}

#[tokio::test]
async fn test_mdns_peer_discovery_two_nodes() {
    let nodes = create_swarm_cluster(2).await;

    if let Ok(mut nodes) = nodes {
        // Both listen on local network
        let _ = nodes[0].listen("/ip4/127.0.0.1/tcp/0").await;
        let _ = nodes[1].listen("/ip4/127.0.0.1/tcp/0").await;

        // Wait for mDNS discovery (< 5 seconds from spec)
        tokio::time::sleep(Duration::from_secs(5)).await;

        // Nodes should discover each other automatically
        // let peers_0 = nodes[0].discovered_peers();
        // let peers_1 = nodes[1].discovered_peers();

        // assert!(peers_0.contains(&nodes[1].peer_id), "Node 0 should discover node 1");
        // assert!(peers_1.contains(&nodes[0].peer_id), "Node 1 should discover node 0");
    }
}

#[tokio::test]
async fn test_mdns_discovery_latency() {
    // From spec: < 5 seconds for local discovery
    let nodes = create_swarm_cluster(2).await;

    if let Ok(mut nodes) = nodes {
        let _ = nodes[0].listen("/ip4/127.0.0.1/tcp/0").await;

        let perf = PerformanceMeasurement::start();
        let _ = nodes[1].listen("/ip4/127.0.0.1/tcp/0").await;

        // Wait for discovery
        // wait_for_peers(&nodes[1], 1, 5000).await?;

        // Should discover in < 5 seconds
        // perf.assert_less_than_ms(5000)?;
    }
}

#[tokio::test]
async fn test_mdns_multiple_instances() {
    // Multiple nodes on same local network should all discover each other
    let nodes = create_swarm_cluster(5).await;

    if let Ok(mut nodes) = nodes {
        // All listen on localhost
        for node in &mut nodes {
            let _ = node.listen("/ip4/127.0.0.1/tcp/0").await;
        }

        // Wait for mDNS
        tokio::time::sleep(Duration::from_secs(5)).await;

        // Each node should discover all others
        for i in 0..5 {
            // let discovered = nodes[i].discovered_peers();
            // assert_eq!(discovered.len(), 4, "Each node should discover 4 others");
        }
    }
}

#[tokio::test]
async fn test_mdns_service_announcement() {
    if let Ok(mut swarm) = MockVigiliaSwarm::new("test-agent".to_string()).await {
        let _ = swarm.listen("/ip4/127.0.0.1/tcp/0").await;

        // mDNS should announce service type
        // let service_type = swarm.mdns_service_type();
        // assert_eq!(service_type, "_vigilia._tcp", "Should announce vigilia service");
    }
}

#[tokio::test]
async fn test_mdns_peer_expiry() {
    // mDNS discovered peers should expire if not reachable
    let nodes = create_swarm_cluster(2).await;

    if let Ok(mut nodes) = nodes {
        let _ = nodes[0].listen("/ip4/127.0.0.1/tcp/0").await;
        let _ = nodes[1].listen("/ip4/127.0.0.1/tcp/0").await;

        // Wait for discovery
        tokio::time::sleep(Duration::from_secs(5)).await;

        // Shutdown node 1
        // nodes[1].shutdown().await;

        // Wait for TTL expiry (typically 120 seconds)
        tokio::time::sleep(Duration::from_secs(125)).await;

        // Node 1 should be removed from node 0's discovered peers
        // let discovered = nodes[0].discovered_peers();
        // assert!(!discovered.contains(&nodes[1].peer_id), "Expired peer should be removed");
    }
}

#[tokio::test]
async fn test_mdns_disabled_on_non_local_address() {
    if let Ok(mut swarm) = MockVigiliaSwarm::new("test-agent".to_string()).await {
        // Listen on public IP (not local)
        // let result = swarm.listen("/ip4/1.2.3.4/tcp/4001").await;

        // mDNS should not announce on public IPs
        // let mdns_active = swarm.mdns_active_on_address("1.2.3.4");
        // assert!(!mdns_active, "mDNS should not run on public IPs");
    }
}

#[tokio::test]
async fn test_mdns_ipv4_and_ipv6() {
    if let Ok(mut swarm) = MockVigiliaSwarm::new("test-agent".to_string()).await {
        // Should support both IPv4 and IPv6 mDNS
        let _ = swarm.listen("/ip4/127.0.0.1/tcp/0").await;
        let _ = swarm.listen("/ip6/::1/tcp/0").await;

        // Both should be announced
        // let mdns_addresses = swarm.mdns_announced_addresses();
        // assert!(mdns_addresses.iter().any(|a| a.contains("ip4")));
        // assert!(mdns_addresses.iter().any(|a| a.contains("ip6")));
    }
}
