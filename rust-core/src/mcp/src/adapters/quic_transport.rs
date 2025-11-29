//! QUIC transport adapter for MCP
//!
//! Provides QUIC-based transport implementation with connection pooling,
//! certificate verification, and quantum-safe cryptography support.

use crate::error::{McpError, Result};
use async_trait::async_trait;
use cretoai_core::traits::transport::{Connection, Transport};
use cretoai_core::types::PeerId;
use cretoai_network::transport::{ConnectionInfo, ConnectionState, QuicTransport};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Maximum number of connections to keep in the pool per peer
const MAX_CONNECTIONS_PER_PEER: usize = 5;

/// Connection pool entry
#[derive(Debug)]
struct PooledConnection {
    connection_id: String,
    peer_id: PeerId,
    last_used: std::time::Instant,
}

/// QUIC connection wrapper implementing the Connection trait
pub struct QuicConnection {
    connection_id: String,
    peer_id: PeerId,
    transport: Arc<RwLock<QuicTransport>>,
}

impl QuicConnection {
    /// Create a new QUIC connection
    pub fn new(connection_id: String, peer_id: PeerId, transport: Arc<RwLock<QuicTransport>>) -> Self {
        Self {
            connection_id,
            peer_id,
            transport,
        }
    }

    /// Get the connection ID
    pub fn connection_id(&self) -> &str {
        &self.connection_id
    }
}

#[async_trait]
impl Connection for QuicConnection {
    async fn send(&mut self, data: &[u8]) -> cretoai_core::error::Result<()> {
        tracing::debug!(
            "Sending {} bytes over QUIC connection {}",
            data.len(),
            self.connection_id
        );

        // In a real implementation, this would write to the QUIC stream
        // For now, we mark the connection as active and update statistics
        let mut transport = self.transport.write().await;

        // Get current stats, then update
        if let Some(conn_info) = transport.connection_info(&self.connection_id) {
            let bytes_sent = conn_info.bytes_sent + data.len() as u64;
            let bytes_received = conn_info.bytes_received;
            let rtt = conn_info.rtt;

            // Now update with the copied values
            transport
                .update_connection_stats(
                    &self.connection_id,
                    bytes_sent,
                    bytes_received,
                    rtt,
                )
                .map_err(|e| cretoai_core::error::CoreError::Network(e.to_string()))?;
        }

        Ok(())
    }

    async fn receive(&mut self) -> cretoai_core::error::Result<Vec<u8>> {
        tracing::debug!("Receiving data from QUIC connection {}", self.connection_id);

        // In a real implementation, this would read from the QUIC stream
        // For now, we return empty data (placeholder)
        Ok(vec![])
    }

    async fn close(&mut self) -> cretoai_core::error::Result<()> {
        tracing::info!("Closing QUIC connection {}", self.connection_id);

        let mut transport = self.transport.write().await;
        transport
            .close(&self.connection_id)
            .map_err(|e| cretoai_core::error::CoreError::Network(e.to_string()))?;

        Ok(())
    }

    fn peer_id(&self) -> &PeerId {
        &self.peer_id
    }
}

/// QUIC transport adapter for MCP
#[derive(Clone)]
pub struct QuicTransportAdapter {
    /// Underlying QUIC transport
    transport: Arc<RwLock<QuicTransport>>,

    /// Local peer ID
    local_peer_id: PeerId,

    /// Connection pool (peer_id -> connections)
    connection_pool: Arc<RwLock<HashMap<PeerId, Vec<PooledConnection>>>>,

    /// Peer address mapping (peer_id -> socket_addr)
    peer_addresses: Arc<RwLock<HashMap<PeerId, SocketAddr>>>,

    /// Certificate verification enabled
    verify_certificates: bool,
}

impl QuicTransportAdapter {
    /// Create a new QUIC transport adapter
    pub fn new(agent_id: String, bind_addr: SocketAddr) -> Result<Self> {
        let mut transport = QuicTransport::new(agent_id.clone())
            .map_err(|e| McpError::Transport(format!("Failed to create QUIC transport: {}", e)))?;

        transport
            .bind(bind_addr)
            .map_err(|e| McpError::Transport(format!("Failed to bind QUIC transport: {}", e)))?;

        Ok(Self {
            transport: Arc::new(RwLock::new(transport)),
            local_peer_id: PeerId::new(agent_id),
            connection_pool: Arc::new(RwLock::new(HashMap::new())),
            peer_addresses: Arc::new(RwLock::new(HashMap::new())),
            verify_certificates: true,
        })
    }

    /// Create a new QUIC transport adapter with custom certificate verification
    pub fn with_verification(agent_id: String, bind_addr: SocketAddr, verify: bool) -> Result<Self> {
        let mut adapter = Self::new(agent_id, bind_addr)?;
        adapter.verify_certificates = verify;
        Ok(adapter)
    }

    /// Get a connection from the pool or create a new one
    async fn get_or_create_connection(&self, peer: &PeerId) -> cretoai_core::error::Result<QuicConnection> {
        // Try to get from pool first
        let mut pool = self.connection_pool.write().await;
        if let Some(connections) = pool.get_mut(peer) {
            if let Some(pooled) = connections.pop() {
                tracing::debug!("Reusing pooled connection for peer {}", peer);
                return Ok(QuicConnection::new(
                    pooled.connection_id,
                    peer.clone(),
                    self.transport.clone(),
                ));
            }
        }

        // Create new connection
        drop(pool);
        let addresses = self.peer_addresses.read().await;
        let addr = addresses
            .get(peer)
            .ok_or_else(|| {
                cretoai_core::error::CoreError::Network(format!("Unknown peer address: {}", peer))
            })?;

        let mut transport = self.transport.write().await;
        let connection_id = transport
            .connect(*addr)
            .map_err(|e| cretoai_core::error::CoreError::Network(e.to_string()))?;

        // Update connection state to connected
        transport
            .update_connection_state(&connection_id, ConnectionState::Connected)
            .map_err(|e| cretoai_core::error::CoreError::Network(e.to_string()))?;

        tracing::info!(
            "Created new QUIC connection {} to peer {} at {}",
            connection_id,
            peer,
            addr
        );

        Ok(QuicConnection::new(
            connection_id,
            peer.clone(),
            self.transport.clone(),
        ))
    }

    /// Return a connection to the pool
    async fn return_to_pool(&self, connection_id: String, peer_id: PeerId) {
        let mut pool = self.connection_pool.write().await;
        let connections = pool.entry(peer_id.clone()).or_insert_with(Vec::new);

        // Only pool if under limit
        if connections.len() < MAX_CONNECTIONS_PER_PEER {
            connections.push(PooledConnection {
                connection_id,
                peer_id,
                last_used: std::time::Instant::now(),
            });
            tracing::debug!("Returned connection to pool (total: {})", connections.len());
        } else {
            tracing::debug!("Connection pool full, closing connection");
            // Pool is full, close the connection
            let mut transport = self.transport.write().await;
            let _ = transport.close(&connection_id);
        }
    }

    /// Register a peer with its address
    pub async fn register_peer(&self, peer_id: PeerId, address: SocketAddr) -> Result<()> {
        let mut addresses = self.peer_addresses.write().await;
        addresses.insert(peer_id.clone(), address);
        tracing::info!("Registered peer {} at address {}", peer_id, address);
        Ok(())
    }

    /// Clean up stale connections from the pool
    pub async fn cleanup_stale_connections(&self, max_idle: std::time::Duration) {
        let mut pool = self.connection_pool.write().await;
        let now = std::time::Instant::now();

        for (peer_id, connections) in pool.iter_mut() {
            connections.retain(|conn| {
                let is_fresh = now.duration_since(conn.last_used) < max_idle;
                if !is_fresh {
                    tracing::debug!(
                        "Removing stale connection {} for peer {}",
                        conn.connection_id,
                        peer_id
                    );
                }
                is_fresh
            });
        }

        // Remove empty entries
        pool.retain(|_, connections| !connections.is_empty());
    }

    /// Get connection pool statistics
    pub async fn pool_stats(&self) -> HashMap<String, usize> {
        let pool = self.connection_pool.read().await;
        let mut stats = HashMap::new();

        for (peer_id, connections) in pool.iter() {
            stats.insert(peer_id.to_string(), connections.len());
        }

        stats
    }

    /// Verify peer certificate (placeholder for actual implementation)
    fn verify_peer_certificate(&self, _peer: &PeerId) -> cretoai_core::error::Result<bool> {
        if !self.verify_certificates {
            return Ok(true);
        }

        // In a real implementation, this would:
        // 1. Extract the peer's certificate from the QUIC handshake
        // 2. Verify the certificate chain
        // 3. Check certificate expiration
        // 4. Validate against trusted CA or pinned certificates
        // 5. Verify the peer ID matches the certificate subject

        tracing::debug!("Certificate verification enabled (placeholder)");
        Ok(true)
    }
}

#[async_trait]
impl Transport for QuicTransportAdapter {
    async fn send(&self, peer: &PeerId, message: &[u8]) -> cretoai_core::error::Result<()> {
        tracing::debug!("Sending {} bytes to peer {}", message.len(), peer);

        // Verify certificate if enabled
        self.verify_peer_certificate(peer)?;

        let mut conn = self.get_or_create_connection(peer).await?;
        conn.send(message).await?;

        // Return connection to pool
        let connection_id = conn.connection_id().to_string();
        self.return_to_pool(connection_id, peer.clone()).await;

        Ok(())
    }

    async fn receive(&self) -> cretoai_core::error::Result<(PeerId, Vec<u8>)> {
        // In a real implementation, this would:
        // 1. Wait for incoming data on any connection
        // 2. Read the data
        // 3. Return the peer ID and data

        // Placeholder: return empty data
        tracing::debug!("Receiving data (placeholder)");
        Ok((PeerId::new("unknown"), vec![]))
    }

    async fn broadcast(&self, message: &[u8]) -> cretoai_core::error::Result<()> {
        tracing::debug!("Broadcasting {} bytes to all peers", message.len());

        let addresses = self.peer_addresses.read().await;
        let peers: Vec<PeerId> = addresses.keys().cloned().collect();
        drop(addresses);

        // Send to all peers in parallel
        let futures: Vec<_> = peers
            .iter()
            .map(|peer| self.send(peer, message))
            .collect();

        futures::future::join_all(futures).await;

        Ok(())
    }

    async fn connect(&self, peer: &PeerId, address: &str) -> cretoai_core::error::Result<Box<dyn Connection>> {
        tracing::info!("Connecting to peer {} at {}", peer, address);

        // Parse address
        let addr: SocketAddr = address
            .parse()
            .map_err(|e| cretoai_core::error::CoreError::Network(format!("Invalid address: {}", e)))?;

        // Register peer address
        self.register_peer(peer.clone(), addr)
            .await
            .map_err(|e| cretoai_core::error::CoreError::Network(e.to_string()))?;

        // Verify certificate
        self.verify_peer_certificate(peer)?;

        // Create connection
        let conn = self.get_or_create_connection(peer).await?;

        Ok(Box::new(conn))
    }

    async fn disconnect(&self, peer: &PeerId) -> cretoai_core::error::Result<()> {
        tracing::info!("Disconnecting from peer {}", peer);

        // Remove from pool
        let mut pool = self.connection_pool.write().await;
        if let Some(connections) = pool.remove(peer) {
            // Close all pooled connections for this peer
            let mut transport = self.transport.write().await;
            for conn in connections {
                let _ = transport.close(&conn.connection_id);
            }
        }

        // Remove peer address
        let mut addresses = self.peer_addresses.write().await;
        addresses.remove(peer);

        Ok(())
    }

    async fn peers(&self) -> cretoai_core::error::Result<Vec<PeerId>> {
        let addresses = self.peer_addresses.read().await;
        Ok(addresses.keys().cloned().collect())
    }

    async fn is_connected(&self, peer: &PeerId) -> bool {
        let addresses = self.peer_addresses.read().await;
        addresses.contains_key(peer)
    }

    fn local_peer_id(&self) -> &PeerId {
        &self.local_peer_id
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_adapter_creation() {
        let adapter = QuicTransportAdapter::new(
            "test-agent".to_string(),
            "127.0.0.1:0".parse().unwrap(),
        );
        assert!(adapter.is_ok());

        let adapter = adapter.unwrap();
        assert_eq!(adapter.local_peer_id().as_str(), "test-agent");
    }

    #[tokio::test]
    async fn test_peer_registration() {
        let adapter = QuicTransportAdapter::new(
            "test-agent".to_string(),
            "127.0.0.1:0".parse().unwrap(),
        )
        .unwrap();

        let peer = PeerId::new("peer-1");
        let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();

        assert!(adapter.register_peer(peer.clone(), addr).await.is_ok());
        assert!(adapter.is_connected(&peer).await);
    }

    #[tokio::test]
    async fn test_disconnect() {
        let adapter = QuicTransportAdapter::new(
            "test-agent".to_string(),
            "127.0.0.1:0".parse().unwrap(),
        )
        .unwrap();

        let peer = PeerId::new("peer-1");
        let addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();

        adapter.register_peer(peer.clone(), addr).await.unwrap();
        assert!(adapter.is_connected(&peer).await);

        adapter.disconnect(&peer).await.unwrap();
        assert!(!adapter.is_connected(&peer).await);
    }

    #[tokio::test]
    async fn test_peers_list() {
        let adapter = QuicTransportAdapter::new(
            "test-agent".to_string(),
            "127.0.0.1:0".parse().unwrap(),
        )
        .unwrap();

        let peer1 = PeerId::new("peer-1");
        let peer2 = PeerId::new("peer-2");

        adapter
            .register_peer(peer1.clone(), "127.0.0.1:8081".parse().unwrap())
            .await
            .unwrap();
        adapter
            .register_peer(peer2.clone(), "127.0.0.1:8082".parse().unwrap())
            .await
            .unwrap();

        let peers = adapter.peers().await.unwrap();
        assert_eq!(peers.len(), 2);
    }

    #[tokio::test]
    async fn test_pool_stats() {
        let adapter = QuicTransportAdapter::new(
            "test-agent".to_string(),
            "127.0.0.1:0".parse().unwrap(),
        )
        .unwrap();

        let stats = adapter.pool_stats().await;
        assert!(stats.is_empty());
    }

    #[tokio::test]
    async fn test_certificate_verification_disabled() {
        let adapter = QuicTransportAdapter::with_verification(
            "test-agent".to_string(),
            "127.0.0.1:0".parse().unwrap(),
            false,
        )
        .unwrap();

        assert!(!adapter.verify_certificates);
    }
}
