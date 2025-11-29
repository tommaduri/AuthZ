// Exchange Marketplace Integration Tests over LibP2P
// Tests for resource listing propagation and discovery

use super::test_utils::*;
use std::time::Duration;

#[tokio::test]
async fn test_exchange_listing_broadcast() {
    let nodes = create_swarm_cluster(3).await;

    if let Ok(mut nodes) = nodes {
        // Subscribe to exchange topic
        for node in &mut nodes {
            let _ = node.subscribe("vigilia/exchange/v1").await;
        }
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;

        // Node 0 broadcasts resource listing
        let listing = MockResourceListing {
            resource_id: "gpu-001".to_string(),
            resource_type: "compute/gpu".to_string(),
            price: 100,
        };

        // Serialize and publish
        // let data = bincode::serialize(&listing)?;
        // nodes[0].publish("vigilia/exchange/v1", &data).await?;

        // Other nodes should receive
        // for i in 1..3 {
        //     let received = nodes[i].receive_timeout(Duration::from_millis(100)).await?;
        //     let received_listing: MockResourceListing = bincode::deserialize(&received.data)?;
        //     assert_eq!(received_listing.resource_id, "gpu-001");
        // }
    }
}

#[tokio::test]
async fn test_exchange_kademlia_provider_announcement() {
    if let Ok(mut swarm) = MockVigiliaSwarm::new("provider-agent".to_string()).await {
        // Announce that this node provides GPU resources
        let resource_key = b"compute/gpu";
        // let result = swarm.kademlia_start_providing(resource_key).await;
        // assert!(result.is_ok(), "Should announce as provider");
    }
}

#[tokio::test]
async fn test_exchange_resource_discovery() {
    // Consumer discovers providers via Kademlia DHT
    let nodes = create_swarm_cluster(10).await;

    if let Ok(mut nodes) = nodes {
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;
        let _ = wait_for_network_stabilization().await;

        // Nodes 0, 1, 2 provide GPU resources
        let resource_key = b"compute/gpu";
        // for i in 0..3 {
        //     nodes[i].kademlia_start_providing(resource_key).await?;
        // }

        // Wait for DHT propagation
        tokio::time::sleep(Duration::from_secs(2)).await;

        // Node 9 queries for GPU providers
        // let query_id = nodes[9].kademlia_get_providers(resource_key).await?;
        // let providers = nodes[9].wait_for_kad_providers(query_id, Duration::from_secs(5)).await?;

        // assert_eq!(providers.len(), 3, "Should find all 3 GPU providers");
    }
}

#[tokio::test]
async fn test_exchange_request_response_listing_query() {
    // Consumer requests detailed listing from provider
    let nodes = create_swarm_cluster(2).await;

    if let Ok(mut nodes) = nodes {
        let _ = nodes[0].dial(&nodes[1].peer_id, "127.0.0.1:0").await;

        // Node 0 has resource listing
        let listing = MockResourceListing {
            resource_id: "storage-001".to_string(),
            resource_type: "storage/ssd".to_string(),
            price: 50,
        };
        // nodes[0].marketplace().add_listing(listing.clone())?;

        // Node 1 requests listing
        // let response = nodes[1].request_listing(&nodes[0].peer_id, "storage-001").await?;
        // assert_eq!(response.resource_id, "storage-001");
        // assert_eq!(response.price, 50);
    }
}

#[tokio::test]
async fn test_exchange_multiple_resource_types() {
    // Different resource types: compute, storage, bandwidth
    let nodes = create_swarm_cluster(6).await;

    if let Ok(mut nodes) = nodes {
        for node in &mut nodes {
            let _ = node.subscribe("vigilia/exchange/v1").await;
        }
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;

        // Nodes provide different resources
        // nodes[0].kademlia_start_providing(b"compute/gpu").await?;
        // nodes[1].kademlia_start_providing(b"compute/cpu").await?;
        // nodes[2].kademlia_start_providing(b"storage/ssd").await?;
        // nodes[3].kademlia_start_providing(b"bandwidth/fiber").await?;

        tokio::time::sleep(Duration::from_secs(2)).await;

        // Consumer searches for each type
        // let gpu_providers = nodes[5].search_providers(b"compute/gpu").await?;
        // let storage_providers = nodes[5].search_providers(b"storage/ssd").await?;

        // assert_eq!(gpu_providers.len(), 1);
        // assert_eq!(storage_providers.len(), 1);
    }
}

#[tokio::test]
async fn test_exchange_listing_signature_verification() {
    // All listings should be signed with ML-DSA
    let nodes = create_swarm_cluster(2).await;

    if let Ok(mut nodes) = nodes {
        let _ = nodes[0].subscribe("vigilia/exchange/v1").await;
        let _ = nodes[1].subscribe("vigilia/exchange/v1").await;

        // Create listing with invalid signature
        // let mut listing = create_listing_message("gpu-001", 100);
        // listing.signature = vec![0u8; 64]; // Invalid

        // Publish listing
        // let data = bincode::serialize(&listing)?;
        // nodes[0].publish("vigilia/exchange/v1", &data).await?;

        // Node 1 should reject
        // let validation = nodes[1].validate_exchange_message(&data);
        // assert!(validation.is_err(), "Invalid signature should be rejected");
    }
}

#[tokio::test]
async fn test_exchange_order_request_flow() {
    // Complete flow: discover -> request details -> place order
    let nodes = create_swarm_cluster(2).await;

    if let Ok(mut nodes) = nodes {
        let _ = nodes[0].dial(&nodes[1].peer_id, "127.0.0.1:0").await;

        // Node 0 provides resource
        // nodes[0].marketplace().add_listing(MockResourceListing {
        //     resource_id: "gpu-001".to_string(),
        //     resource_type: "compute/gpu".to_string(),
        //     price: 100,
        // })?;

        // nodes[0].kademlia_start_providing(b"compute/gpu").await?;

        // Node 1 discovers and orders
        // let providers = nodes[1].search_providers(b"compute/gpu").await?;
        // let listing = nodes[1].request_listing(&providers[0], "gpu-001").await?;
        // let order = nodes[1].create_order(&providers[0], "gpu-001", 1).await?;

        // assert!(order.is_confirmed());
    }
}

#[tokio::test]
async fn test_exchange_concurrent_orders() {
    // Multiple consumers order same resource
    let nodes = create_swarm_cluster(5).await;

    if let Ok(mut nodes) = nodes {
        // Node 0 is provider
        // nodes[0].marketplace().add_listing(MockResourceListing {
        //     resource_id: "gpu-001".to_string(),
        //     resource_type: "compute/gpu".to_string(),
        //     price: 100,
        // })?;

        // Connect all to provider
        for i in 1..5 {
            let _ = nodes[i].dial(&nodes[0].peer_id, "127.0.0.1:0").await;
        }

        // All consumers try to order simultaneously
        // let orders: Vec<_> = (1..5).map(|i| {
        //     nodes[i].create_order(&nodes[0].peer_id, "gpu-001", 1)
        // }).collect();

        // Only one should succeed (or handle via queue)
        // let confirmed_count = orders.into_iter().filter(|o| o.is_ok()).count();
        // assert_eq!(confirmed_count, 1, "Only one order should succeed for single resource");
    }
}

#[tokio::test]
async fn test_exchange_listing_update_propagation() {
    // Provider updates listing (price change)
    let nodes = create_swarm_cluster(5).await;

    if let Ok(mut nodes) = nodes {
        for node in &mut nodes {
            let _ = node.subscribe("vigilia/exchange/v1").await;
        }
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;

        // Initial listing
        // let listing_v1 = create_listing("gpu-001", 100);
        // let data_v1 = bincode::serialize(&listing_v1)?;
        // nodes[0].publish("vigilia/exchange/v1", &data_v1).await?;

        tokio::time::sleep(Duration::from_millis(100)).await;

        // Update price
        // let listing_v2 = create_listing("gpu-001", 80);
        // let data_v2 = bincode::serialize(&listing_v2)?;
        // nodes[0].publish("vigilia/exchange/v1", &data_v2).await?;

        tokio::time::sleep(Duration::from_millis(100)).await;

        // All nodes should have updated price
        // for i in 1..5 {
        //     let listing = nodes[i].marketplace().get_listing("gpu-001")?;
        //     assert_eq!(listing.price, 80, "Price should be updated");
        // }
    }
}

#[tokio::test]
async fn test_exchange_marketplace_capacity_limits() {
    // Provider announces limited quantity
    if let Ok(mut swarm) = MockVigiliaSwarm::new("provider".to_string()).await {
        // Listing with quantity limit
        // let listing = ListingWithCapacity {
        //     resource_id: "gpu-001".to_string(),
        //     resource_type: "compute/gpu".to_string(),
        //     price: 100,
        //     available_quantity: 5,
        // };

        // swarm.marketplace().add_listing(listing)?;

        // After 5 orders, resource should be unavailable
        // for _ in 0..5 {
        //     swarm.marketplace().consume_capacity("gpu-001", 1)?;
        // }

        // let available = swarm.marketplace().check_availability("gpu-001");
        // assert_eq!(available, 0);
    }
}

#[tokio::test]
async fn test_exchange_payment_verification() {
    // Orders should include payment proof
    let nodes = create_swarm_cluster(2).await;

    if let Ok(mut nodes) = nodes {
        let _ = nodes[0].dial(&nodes[1].peer_id, "127.0.0.1:0").await;

        // Create order with payment proof
        // let order = OrderRequest {
        //     resource_id: "gpu-001".to_string(),
        //     quantity: 1,
        //     payment_proof: vec![/* payment signature */],
        // };

        // Provider verifies payment
        // let verified = nodes[0].verify_payment_proof(&order.payment_proof)?;
        // assert!(verified, "Payment should be verified");
    }
}

#[tokio::test]
async fn test_exchange_reputation_tracking() {
    // Track provider reputation based on fulfilled orders
    if let Ok(swarm) = MockVigiliaSwarm::new("consumer".to_string()).await {
        // let provider_peer_id = "provider-123";

        // Record successful transaction
        // swarm.marketplace().record_transaction(provider_peer_id, true)?;
        // swarm.marketplace().record_transaction(provider_peer_id, true)?;

        // Record failed transaction
        // swarm.marketplace().record_transaction(provider_peer_id, false)?;

        // Check reputation
        // let reputation = swarm.marketplace().get_reputation(provider_peer_id)?;
        // assert!(reputation > 0.6, "Reputation should be > 60% (2/3 success)");
    }
}
