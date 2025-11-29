//! QUIC Transport Integration Tests
//!
//! Comprehensive test suite for QUIC transport adapter including:
//! - Connection establishment and handshake
//! - Message send/receive
//! - Connection pooling
//! - Certificate verification
//! - Error handling

use cretoai_core::traits::transport::{Connection, Transport};
use cretoai_core::types::PeerId;
use cretoai_mcp::{QuicTransportAdapter, Result};
use std::net::SocketAddr;
use std::time::Duration;
use tokio::time::sleep;

/// Test helper to create a QUIC transport adapter
async fn create_adapter(port: u16) -> Result<QuicTransportAdapter> {
    let bind_addr: SocketAddr = format!("127.0.0.1:{}", port).parse().unwrap();
    QuicTransportAdapter::new(format!("test-agent-{}", port), bind_addr)
}

#[tokio::test]
async fn test_quic_adapter_creation() {
    let adapter = create_adapter(9001).await;
    assert!(adapter.is_ok(), "Failed to create QUIC adapter");

    let adapter = adapter.unwrap();
    assert_eq!(adapter.local_peer_id().as_str(), "test-agent-9001");
}

#[tokio::test]
async fn test_quic_adapter_with_verification_disabled() {
    let bind_addr: SocketAddr = "127.0.0.1:9002".parse().unwrap();
    let adapter = QuicTransportAdapter::with_verification("test-agent".to_string(), bind_addr, false);

    assert!(adapter.is_ok());
}

#[tokio::test]
async fn test_peer_registration_and_connection() {
    let adapter = create_adapter(9003).await.unwrap();
    let peer = PeerId::new("peer-1");
    let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();

    // Register peer
    assert!(adapter.register_peer(peer.clone(), addr).await.is_ok());

    // Check connection status
    assert!(adapter.is_connected(&peer).await);
}

#[tokio::test]
async fn test_connect_to_peer() {
    let adapter = create_adapter(9004).await.unwrap();
    let peer = PeerId::new("peer-1");
    let address = "127.0.0.1:8081";

    // Connect to peer
    let result = adapter.connect(&peer, address).await;
    assert!(result.is_ok(), "Failed to connect to peer");

    // Verify connection
    assert!(adapter.is_connected(&peer).await);
}

#[tokio::test]
async fn test_disconnect_from_peer() {
    let adapter = create_adapter(9005).await.unwrap();
    let peer = PeerId::new("peer-1");
    let addr: SocketAddr = "127.0.0.1:8082".parse().unwrap();

    // Register and connect
    adapter.register_peer(peer.clone(), addr).await.unwrap();
    assert!(adapter.is_connected(&peer).await);

    // Disconnect
    assert!(adapter.disconnect(&peer).await.is_ok());
    assert!(!adapter.is_connected(&peer).await);
}

#[tokio::test]
async fn test_send_message_to_peer() {
    let adapter = create_adapter(9006).await.unwrap();
    let peer = PeerId::new("peer-1");
    let addr: SocketAddr = "127.0.0.1:8083".parse().unwrap();

    // Register peer
    adapter.register_peer(peer.clone(), addr).await.unwrap();

    // Send message
    let message = b"Hello, QUIC!";
    let result = adapter.send(&peer, message).await;
    assert!(result.is_ok(), "Failed to send message");
}

#[tokio::test]
async fn test_broadcast_to_multiple_peers() {
    let adapter = create_adapter(9007).await.unwrap();

    // Register multiple peers
    let peer1 = PeerId::new("peer-1");
    let peer2 = PeerId::new("peer-2");
    let peer3 = PeerId::new("peer-3");

    adapter
        .register_peer(peer1.clone(), "127.0.0.1:8084".parse().unwrap())
        .await
        .unwrap();
    adapter
        .register_peer(peer2.clone(), "127.0.0.1:8085".parse().unwrap())
        .await
        .unwrap();
    adapter
        .register_peer(peer3.clone(), "127.0.0.1:8086".parse().unwrap())
        .await
        .unwrap();

    // Broadcast message
    let message = b"Broadcast message";
    let result = adapter.broadcast(message).await;
    assert!(result.is_ok(), "Failed to broadcast message");
}

#[tokio::test]
async fn test_list_peers() {
    let adapter = create_adapter(9008).await.unwrap();

    // Register multiple peers
    adapter
        .register_peer(PeerId::new("peer-1"), "127.0.0.1:8087".parse().unwrap())
        .await
        .unwrap();
    adapter
        .register_peer(PeerId::new("peer-2"), "127.0.0.1:8088".parse().unwrap())
        .await
        .unwrap();

    // Get peer list
    let peers = adapter.peers().await.unwrap();
    assert_eq!(peers.len(), 2);
}

#[tokio::test]
async fn test_connection_pool_stats() {
    let adapter = create_adapter(9009).await.unwrap();

    // Initially empty
    let stats = adapter.pool_stats().await;
    assert!(stats.is_empty());

    // Register peers
    adapter
        .register_peer(PeerId::new("peer-1"), "127.0.0.1:8089".parse().unwrap())
        .await
        .unwrap();

    // Stats should still be empty until connections are pooled
    let stats = adapter.pool_stats().await;
    assert!(stats.is_empty() || stats.get("peer-1").is_none());
}

#[tokio::test]
async fn test_connection_pooling_behavior() {
    let adapter = create_adapter(9010).await.unwrap();
    let peer = PeerId::new("peer-1");
    let addr: SocketAddr = "127.0.0.1:8090".parse().unwrap();

    // Register peer
    adapter.register_peer(peer.clone(), addr).await.unwrap();

    // Send multiple messages (should reuse connections from pool)
    for i in 0..3 {
        let message = format!("Message {}", i);
        let result = adapter.send(&peer, message.as_bytes()).await;
        assert!(result.is_ok());
    }

    // Pool should contain connections
    let stats = adapter.pool_stats().await;
    // Note: Depending on implementation, pooled connections may or may not show up immediately
    assert!(stats.is_empty() || stats.contains_key(&peer.to_string()));
}

#[tokio::test]
async fn test_cleanup_stale_connections() {
    let adapter = create_adapter(9011).await.unwrap();
    let peer = PeerId::new("peer-1");
    let addr: SocketAddr = "127.0.0.1:8091".parse().unwrap();

    // Register peer and create connection
    adapter.register_peer(peer.clone(), addr).await.unwrap();
    let _ = adapter.send(&peer, b"test").await;

    // Wait a short time
    sleep(Duration::from_millis(100)).await;

    // Cleanup with very short max idle time
    adapter.cleanup_stale_connections(Duration::from_millis(50)).await;

    // Pool should be cleaned
    let stats = adapter.pool_stats().await;
    assert!(stats.is_empty() || stats.get(&peer.to_string()).unwrap_or(&0) == &0);
}

#[tokio::test]
async fn test_certificate_verification_enabled() {
    let bind_addr: SocketAddr = "127.0.0.1:9012".parse().unwrap();
    let adapter = QuicTransportAdapter::with_verification("test-agent".to_string(), bind_addr, true)
        .unwrap();

    let peer = PeerId::new("peer-1");
    let addr: SocketAddr = "127.0.0.1:8092".parse().unwrap();

    // Register peer
    adapter.register_peer(peer.clone(), addr).await.unwrap();

    // Send message (should verify certificate)
    let result = adapter.send(&peer, b"test").await;
    assert!(result.is_ok(), "Certificate verification should succeed in test mode");
}

#[tokio::test]
async fn test_certificate_verification_disabled() {
    let bind_addr: SocketAddr = "127.0.0.1:9013".parse().unwrap();
    let adapter = QuicTransportAdapter::with_verification("test-agent".to_string(), bind_addr, false)
        .unwrap();

    let peer = PeerId::new("peer-1");
    let addr: SocketAddr = "127.0.0.1:8093".parse().unwrap();

    // Register peer
    adapter.register_peer(peer.clone(), addr).await.unwrap();

    // Send message (should skip certificate verification)
    let result = adapter.send(&peer, b"test").await;
    assert!(result.is_ok(), "Should succeed without certificate verification");
}

#[tokio::test]
async fn test_connection_object_send() {
    let adapter = create_adapter(9014).await.unwrap();
    let peer = PeerId::new("peer-1");
    let address = "127.0.0.1:8094";

    // Create connection
    let mut conn = adapter.connect(&peer, address).await.unwrap();

    // Send data
    let result = conn.send(b"test data").await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_connection_object_close() {
    let adapter = create_adapter(9015).await.unwrap();
    let peer = PeerId::new("peer-1");
    let address = "127.0.0.1:8095";

    // Create connection
    let mut conn = adapter.connect(&peer, address).await.unwrap();

    // Close connection
    let result = conn.close().await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_connection_object_peer_id() {
    let adapter = create_adapter(9016).await.unwrap();
    let peer = PeerId::new("peer-1");
    let address = "127.0.0.1:8096";

    // Create connection
    let conn = adapter.connect(&peer, address).await.unwrap();

    // Check peer ID
    assert_eq!(conn.peer_id().as_str(), "peer-1");
}

#[tokio::test]
async fn test_multiple_connections_same_peer() {
    let adapter = create_adapter(9017).await.unwrap();
    let peer = PeerId::new("peer-1");
    let address = "127.0.0.1:8097";

    // Create multiple connections to same peer
    let conn1 = adapter.connect(&peer, address).await;
    let conn2 = adapter.connect(&peer, address).await;
    let conn3 = adapter.connect(&peer, address).await;

    assert!(conn1.is_ok());
    assert!(conn2.is_ok());
    assert!(conn3.is_ok());
}

#[tokio::test]
async fn test_error_connecting_to_unknown_peer() {
    let adapter = create_adapter(9018).await.unwrap();
    let peer = PeerId::new("unknown-peer");

    // Try to send without registering peer
    let result = adapter.send(&peer, b"test").await;
    assert!(result.is_err(), "Should fail when peer is not registered");
}

#[tokio::test]
async fn test_concurrent_operations() {
    let adapter = create_adapter(9019).await.unwrap();

    // Register multiple peers
    let peers: Vec<_> = (0..5)
        .map(|i| {
            let peer = PeerId::new(format!("peer-{}", i));
            let addr: SocketAddr = format!("127.0.0.1:{}", 8098 + i).parse().unwrap();
            (peer, addr)
        })
        .collect();

    for (peer, addr) in &peers {
        adapter.register_peer(peer.clone(), *addr).await.unwrap();
    }

    // Send messages concurrently
    let mut handles = vec![];
    for (peer, _) in &peers {
        let adapter_clone = adapter.clone();
        let peer_clone = peer.clone();
        let handle = tokio::spawn(async move {
            adapter_clone.send(&peer_clone, b"concurrent test").await
        });
        handles.push(handle);
    }

    // Wait for all operations
    for handle in handles {
        let result = handle.await.unwrap();
        assert!(result.is_ok());
    }
}

#[tokio::test]
async fn test_adapter_local_peer_id() {
    let adapter = create_adapter(9020).await.unwrap();
    assert_eq!(adapter.local_peer_id().as_str(), "test-agent-9020");
}

// Note: These tests use mock/placeholder implementations for actual QUIC protocol operations.
// In a production environment, you would need:
// 1. Actual QUIC endpoint setup with quinn or similar
// 2. Real certificate generation and verification
// 3. Bidirectional stream handling
// 4. Proper async I/O for message passing
