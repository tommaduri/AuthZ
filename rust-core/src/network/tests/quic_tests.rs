//! Integration tests for QUIC transport

use cretoai_network::{
    NetworkConfig, NetworkMessage, PeerId, QuicTransport,
};
use std::time::Duration;
use tokio::time::timeout;

#[tokio::test]
async fn test_quic_transport_creation() {
    let peer_id = PeerId::new();
    let config = NetworkConfig::default();

    let transport = QuicTransport::new(peer_id, config);

    assert_eq!(transport.get_peers().len(), 0);
}

#[tokio::test]
async fn test_quic_bind_and_listen() {
    let peer_id = PeerId::new();
    let mut config = NetworkConfig::default();
    config.quic_port = 19001; // Use different port for testing

    let mut transport = QuicTransport::new(peer_id, config);

    let result = transport.bind_and_listen().await;
    assert!(result.is_ok(), "Failed to bind: {:?}", result.err());

    // Cleanup
    transport.shutdown().await.unwrap();
}

#[tokio::test]
async fn test_quic_peer_connection() {
    // Start first transport (listener)
    let peer1_id = PeerId::new();
    let mut config1 = NetworkConfig::default();
    config1.quic_port = 19002;

    let mut transport1 = QuicTransport::new(peer1_id, config1.clone());
    transport1.bind_and_listen().await.unwrap();

    // Give listener time to start
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Start second transport (connector)
    let peer2_id = PeerId::new();
    let mut config2 = NetworkConfig::default();
    config2.quic_port = 19003;

    let mut transport2 = QuicTransport::new(peer2_id, config2);
    transport2.bind_and_listen().await.unwrap();

    // Connect peer2 to peer1
    let addr1 = format!("127.0.0.1:{}", config1.quic_port).parse().unwrap();
    let result = timeout(
        Duration::from_secs(5),
        transport2.connect_peer(addr1)
    ).await;

    assert!(result.is_ok(), "Connection timeout");
    let peer_id = result.unwrap();
    assert!(peer_id.is_ok(), "Connection failed: {:?}", peer_id.err());

    // Verify connection
    assert_eq!(transport2.get_peers().len(), 1);

    // Cleanup
    transport1.shutdown().await.unwrap();
    transport2.shutdown().await.unwrap();
}

#[tokio::test]
async fn test_quic_message_broadcast() {
    // Start listener
    let peer1_id = PeerId::new();
    let mut config1 = NetworkConfig::default();
    config1.quic_port = 19004;

    let mut transport1 = QuicTransport::new(peer1_id, config1.clone());
    transport1.bind_and_listen().await.unwrap();

    // Start connector
    let peer2_id = PeerId::new();
    let mut config2 = NetworkConfig::default();
    config2.quic_port = 19005;

    let mut transport2 = QuicTransport::new(peer2_id, config2);
    transport2.bind_and_listen().await.unwrap();

    // Connect
    let addr1 = format!("127.0.0.1:{}", config1.quic_port).parse().unwrap();
    transport2.connect_peer(addr1).await.unwrap();

    // Broadcast message
    let message = NetworkMessage::Ping { timestamp: 12345 };
    let result = transport2.broadcast(message).await;
    assert!(result.is_ok(), "Broadcast failed: {:?}", result.err());

    // Cleanup
    transport1.shutdown().await.unwrap();
    transport2.shutdown().await.unwrap();
}

#[tokio::test]
async fn test_quic_connection_stats() {
    let peer_id = PeerId::new();
    let mut config = NetworkConfig::default();
    config.quic_port = 19006;

    let mut transport = QuicTransport::new(peer_id, config);
    transport.bind_and_listen().await.unwrap();

    // Initially no stats
    let fake_peer = PeerId::new();
    assert!(transport.get_stats(fake_peer).is_none());

    // Cleanup
    transport.shutdown().await.unwrap();
}

#[tokio::test]
async fn test_quic_disconnect_peer() {
    // Start listener
    let peer1_id = PeerId::new();
    let mut config1 = NetworkConfig::default();
    config1.quic_port = 19007;

    let mut transport1 = QuicTransport::new(peer1_id, config1.clone());
    transport1.bind_and_listen().await.unwrap();

    // Start connector
    let peer2_id = PeerId::new();
    let mut config2 = NetworkConfig::default();
    config2.quic_port = 19008;

    let mut transport2 = QuicTransport::new(peer2_id, config2);
    transport2.bind_and_listen().await.unwrap();

    // Connect
    let addr1 = format!("127.0.0.1:{}", config1.quic_port).parse().unwrap();
    let connected_peer = transport2.connect_peer(addr1).await.unwrap();

    assert_eq!(transport2.get_peers().len(), 1);

    // Disconnect
    transport2.disconnect_peer(connected_peer).await.unwrap();

    assert_eq!(transport2.get_peers().len(), 0);

    // Cleanup
    transport1.shutdown().await.unwrap();
    transport2.shutdown().await.unwrap();
}

#[tokio::test]
async fn test_quic_multiple_connections() {
    // Start listener
    let peer1_id = PeerId::new();
    let mut config1 = NetworkConfig::default();
    config1.quic_port = 19009;
    config1.max_connections = 10;

    let mut transport1 = QuicTransport::new(peer1_id, config1.clone());
    transport1.bind_and_listen().await.unwrap();

    tokio::time::sleep(Duration::from_millis(100)).await;

    // Start multiple connectors
    let mut transports = vec![];

    for i in 0..3 {
        let peer_id = PeerId::new();
        let mut config = NetworkConfig::default();
        config.quic_port = 19010 + i;

        let mut transport = QuicTransport::new(peer_id, config);
        transport.bind_and_listen().await.unwrap();

        // Connect to listener
        let addr1 = format!("127.0.0.1:{}", config1.quic_port).parse().unwrap();
        let _ = transport.connect_peer(addr1).await;

        transports.push(transport);
    }

    tokio::time::sleep(Duration::from_millis(500)).await;

    // Verify all connections
    for transport in &transports {
        assert!(transport.get_peers().len() > 0);
    }

    // Cleanup
    transport1.shutdown().await.unwrap();
    for mut transport in transports {
        transport.shutdown().await.unwrap();
    }
}
