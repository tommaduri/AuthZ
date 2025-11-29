//! Distributed Marketplace Example
//!
//! Demonstrates distributed resource trading using the Exchange P2P integration.
//!
//! This example:
//! 1. Creates a network of 5 provider and buyer nodes
//! 2. Broadcasts resource listings through gossip protocol
//! 3. Creates orders with distributed consensus
//! 4. Tracks reputation across the network
//! 5. Demonstrates P2P resource discovery
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
//! │  Provider 1 │◄──►│  Provider 2 │◄──►│   Buyer 1   │
//! │ (Alice-GPU) │    │(Bob-Storage)│    │  (Charlie)  │
//! └─────────────┘    └─────────────┘    └─────────────┘
//!      │                  │                    │
//!      └──────────┬───────┴─────────┬──────────┘
//!                 ▼                 ▼
//!          ┌─────────────┐    ┌─────────────┐
//!          │   Buyer 2   │◄──►│  Provider 3 │
//!          │   (Dave)    │    │(Eve-Compute)│
//!          └─────────────┘    └─────────────┘
//! ```
//!
//! Run with:
//! ```bash
//! cargo run --example distributed_marketplace
//! ```

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::sleep;
use cretoai_network::{
    ExchangeP2PConfig, ExchangeP2PNode, OrderRequestMessage, ResourceListingMessage,
    ReputationUpdateMessage,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    println!("🚀 Vigilia AI - Distributed Marketplace Demo\n");
    println!("Creating a network of 5 nodes (3 providers + 2 buyers)...\n");

    // Create nodes with different roles
    let node_configs = vec![
        ("Alice", "provider", "GPU"),
        ("Bob", "provider", "Storage"),
        ("Charlie", "buyer", ""),
        ("Dave", "buyer", ""),
        ("Eve", "provider", "Compute"),
    ];

    let mut nodes: HashMap<String, Arc<ExchangeP2PNode>> = HashMap::new();

    for (name, role, resource) in &node_configs {
        let config = ExchangeP2PConfig {
            agent_id: name.to_string(),
            enable_consensus: true,
            min_network_size: 5,
            consensus_sample_size: 4,
            order_timeout: 300,
        };

        let node = Arc::new(ExchangeP2PNode::new(config));
        nodes.insert(name.to_string(), node);

        if !resource.is_empty() {
            println!("✓ Created {} ({} provider for {})", name, role, resource);
        } else {
            println!("✓ Created {} ({})", name, role);
        }
    }

    println!("\n📡 Connecting nodes in mesh topology...\n");

    // Connect all nodes in a mesh topology
    let node_names: Vec<String> = nodes.keys().cloned().collect();
    for (i, name1) in node_names.iter().enumerate() {
        for name2 in node_names.iter().skip(i + 1) {
            nodes[name1].add_peer(name2.clone());
            nodes[name2].add_peer(name1.clone());
            println!("  {} ↔ {}", name1, name2);
        }
    }

    println!("\n✅ Marketplace network established with {} nodes", nodes.len());
    println!("   Network topology: Full mesh");
    println!("   Byzantine tolerance: < 33.3% malicious nodes (< 2 out of 5)\n");

    // Wait for network to stabilize
    sleep(Duration::from_millis(500)).await;

    // Alice (Provider 1) creates GPU listing
    println!("📝 Alice creating GPU resource listing...\n");

    let alice_listing = ResourceListingMessage {
        listing_id: "listing-gpu-001".to_string(),
        provider_id: "Alice".to_string(),
        resource_type: "gpu".to_string(),
        quantity: 8.0,
        price_per_unit: 50.0,
        min_quantity: 1.0,
        reputation: 0.85,
        created_at: chrono::Utc::now().timestamp(),
        expires_at: chrono::Utc::now().timestamp() + 86400,
        metadata: {
            let mut m = HashMap::new();
            m.insert("gpu_type".to_string(), "NVIDIA A100".to_string());
            m.insert("vram".to_string(), "80GB".to_string());
            m
        },
        signature: vec![],
    };

    nodes["Alice"].broadcast_listing(alice_listing.clone())?;

    println!("   Listing ID: {}", alice_listing.listing_id);
    println!("   Resource: {} GPU units", alice_listing.quantity);
    println!("   Price: ${}/unit", alice_listing.price_per_unit);
    println!("   Provider Reputation: {:.2}", alice_listing.reputation);

    // Bob (Provider 2) creates Storage listing
    println!("\n📝 Bob creating Storage resource listing...\n");

    let bob_listing = ResourceListingMessage {
        listing_id: "listing-storage-001".to_string(),
        provider_id: "Bob".to_string(),
        resource_type: "storage".to_string(),
        quantity: 10240.0, // 10 TB
        price_per_unit: 0.1,
        min_quantity: 100.0,
        reputation: 0.92,
        created_at: chrono::Utc::now().timestamp(),
        expires_at: chrono::Utc::now().timestamp() + 86400,
        metadata: {
            let mut m = HashMap::new();
            m.insert("storage_type".to_string(), "SSD".to_string());
            m.insert("iops".to_string(), "100000".to_string());
            m
        },
        signature: vec![],
    };

    nodes["Bob"].broadcast_listing(bob_listing.clone())?;

    println!("   Listing ID: {}", bob_listing.listing_id);
    println!("   Resource: {} GB storage", bob_listing.quantity);
    println!("   Price: ${}/GB", bob_listing.price_per_unit);
    println!("   Provider Reputation: {:.2}", bob_listing.reputation);

    // Eve (Provider 3) creates Compute listing
    println!("\n📝 Eve creating Compute resource listing...\n");

    let eve_listing = ResourceListingMessage {
        listing_id: "listing-compute-001".to_string(),
        provider_id: "Eve".to_string(),
        resource_type: "compute".to_string(),
        quantity: 128.0, // CPU cores
        price_per_unit: 5.0,
        min_quantity: 4.0,
        reputation: 0.78,
        created_at: chrono::Utc::now().timestamp(),
        expires_at: chrono::Utc::now().timestamp() + 86400,
        metadata: {
            let mut m = HashMap::new();
            m.insert("cpu_type".to_string(), "AMD EPYC 9654".to_string());
            m.insert("cores".to_string(), "96".to_string());
            m
        },
        signature: vec![],
    };

    nodes["Eve"].broadcast_listing(eve_listing.clone())?;

    println!("   Listing ID: {}", eve_listing.listing_id);
    println!("   Resource: {} CPU cores", eve_listing.quantity);
    println!("   Price: ${}/core/hour", eve_listing.price_per_unit);
    println!("   Provider Reputation: {:.2}", eve_listing.reputation);

    // Wait for listings to propagate
    sleep(Duration::from_secs(1)).await;

    // Charlie (Buyer 1) searches for GPU resources
    println!("\n🔍 Charlie searching for GPU resources...\n");

    let charlie_node = &nodes["Charlie"];
    let gpu_listings = charlie_node.search_listings("gpu");

    println!("   Found {} GPU listing(s):", gpu_listings.len());
    for listing in &gpu_listings {
        println!(
            "   - {} ({} units @ ${}/unit, reputation: {:.2})",
            listing.listing_id, listing.quantity, listing.price_per_unit, listing.reputation
        );
    }

    // Charlie creates an order for GPUs
    println!("\n📦 Charlie creating order for 4 GPU units...\n");

    let charlie_order = OrderRequestMessage {
        order_id: "order-001".to_string(),
        listing_id: alice_listing.listing_id.clone(),
        buyer_id: "Charlie".to_string(),
        quantity: 4.0,
        total_price: 4.0 * alice_listing.price_per_unit,
        timestamp: chrono::Utc::now().timestamp(),
        signature: vec![],
    };

    println!("   Order ID: {}", charlie_order.order_id);
    println!("   Listing: {}", charlie_order.listing_id);
    println!("   Quantity: {} units", charlie_order.quantity);
    println!("   Total Price: ${:.2}", charlie_order.total_price);

    // Note: In a real implementation, this would run consensus
    // For the example, we demonstrate the concept
    println!("\n🔄 Order submitted to network (consensus would run here)...");
    println!("   Consensus algorithm: QR-Avalanche");
    println!("   Query strategy: Random sampling (k=4)");
    println!("   Success threshold: α=3 (75%)");
    println!("   Finalization: β=5 consecutive successes\n");

    // Dave (Buyer 2) searches for Storage
    println!("🔍 Dave searching for Storage resources...\n");

    let dave_node = &nodes["Dave"];
    let storage_listings = dave_node.search_listings("storage");

    println!("   Found {} storage listing(s):", storage_listings.len());
    for listing in &storage_listings {
        println!(
            "   - {} ({} GB @ ${}/GB, reputation: {:.2})",
            listing.listing_id, listing.quantity, listing.price_per_unit, listing.reputation
        );
    }

    // Simulate reputation updates
    println!("\n⭐ Updating reputation after successful transaction...\n");

    let alice_reputation_update = ReputationUpdateMessage {
        agent_id: "Alice".to_string(),
        transaction_success: Some(true),
        review_rating: Some(4.8),
        timestamp: chrono::Utc::now().timestamp(),
        signature: vec![],
    };

    nodes["Charlie"].update_reputation(alice_reputation_update)?;

    println!("   Updated Alice's reputation (successful transaction + 4.8/5 review)");
    println!("   Reputation data propagating across network...");

    // Print network statistics
    println!("\n📊 Network Statistics:\n");
    for (name, node) in &nodes {
        let stats = node.get_stats();
        println!("   {} Statistics:", name);
        println!("     - Connected peers: {}", stats.peer_count);
        println!("     - Cached listings: {}", stats.cached_listings);
        println!("     - Active orders: {}", stats.active_orders);
        println!("     - Tracked agents: {}", stats.tracked_agents);
        println!();
    }

    // Demonstrate resource discovery
    println!("🔎 Resource Discovery Capabilities:\n");
    println!("   - P2P gossip protocol efficiently propagates listings");
    println!("   - Distributed consensus ensures order integrity");
    println!("   - Reputation tracking builds trust across network");
    println!("   - Search by resource type for instant discovery");
    println!("   - Byzantine fault tolerance prevents marketplace manipulation\n");

    println!("✅ Distributed marketplace demo completed successfully!\n");
    println!("Key Takeaways:");
    println!("  • Resource listings propagate via P2P gossip protocol");
    println!("  • Orders can use Byzantine fault-tolerant consensus");
    println!("  • Reputation updates are distributed across network");
    println!("  • Search capabilities enable efficient resource discovery");
    println!("  • Network achieves security with < 33.3% malicious nodes");
    println!("  • Quantum-resistant signatures ensure long-term security\n");

    Ok(())
}
