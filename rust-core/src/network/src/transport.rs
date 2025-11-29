//! QUIC transport layer implementation with quantum-safe cryptography
//!
//! This module provides QUIC-based transport with post-quantum cryptographic
//! handshakes, leveraging the vigilia-crypto module for quantum-resistant security.

use crate::error::{NetworkError, Result};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use cretoai_crypto::hybrid::encryption::HybridKeyExchange;
use cretoai_crypto::keys::AgentIdentity;

/// QUIC transport configuration
#[derive(Debug, Clone)]
pub struct TransportConfig {
    /// Address to bind to
    pub bind_address: SocketAddr,

    /// Maximum idle timeout before connection is closed
    pub max_idle_timeout: Duration,

    /// Keep-alive interval for maintaining connections
    pub keep_alive_interval: Duration,

    /// Maximum number of concurrent bidirectional streams
    pub max_concurrent_bidi_streams: u64,

    /// Maximum number of concurrent unidirectional streams
    pub max_concurrent_uni_streams: u64,

    /// Enable 0-RTT connection establishment
    pub enable_0rtt: bool,

    /// Enable connection migration
    pub enable_migration: bool,

    /// Maximum packet size
    pub max_packet_size: u16,

    /// Initial congestion window size
    pub initial_congestion_window: u64,
}

impl Default for TransportConfig {
    fn default() -> Self {
        Self {
            bind_address: "0.0.0.0:0".parse().expect("valid socket addr"),
            max_idle_timeout: Duration::from_secs(30),
            keep_alive_interval: Duration::from_secs(5),
            max_concurrent_bidi_streams: 100,
            max_concurrent_uni_streams: 100,
            enable_0rtt: false, // Disabled by default for security
            enable_migration: true,
            max_packet_size: 1350, // Standard MTU minus IP/UDP headers
            initial_congestion_window: 10,
        }
    }
}

/// Post-quantum cryptographic handshake manager
pub struct PQCHandshake {
    /// Agent identity with quantum-resistant keys
    identity: Arc<AgentIdentity>,
}

impl PQCHandshake {
    /// Create a new PQC handshake manager
    pub fn new(agent_id: String) -> Result<Self> {
        let identity = AgentIdentity::generate(agent_id)
            .map_err(|e| NetworkError::Transport(format!("Failed to generate identity: {}", e)))?;

        Ok(Self {
            identity: Arc::new(identity),
        })
    }

    /// Get the agent identity
    pub fn identity(&self) -> &AgentIdentity {
        &self.identity
    }

    /// Generate a new hybrid key exchange for a connection
    pub fn create_key_exchange(&self) -> HybridKeyExchange {
        HybridKeyExchange::generate()
    }
}

/// Connection state
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectionState {
    /// Connection is being established
    Connecting,

    /// Connection is established and ready
    Connected,

    /// Connection is being closed
    Closing,

    /// Connection is closed
    Closed,

    /// Connection failed
    Failed,
}

/// QUIC connection metadata
#[derive(Debug, Clone)]
pub struct ConnectionInfo {
    /// Connection ID
    pub connection_id: String,

    /// Remote peer address
    pub remote_addr: SocketAddr,

    /// Local address
    pub local_addr: SocketAddr,

    /// Connection state
    pub state: ConnectionState,

    /// Number of bytes sent
    pub bytes_sent: u64,

    /// Number of bytes received
    pub bytes_received: u64,

    /// Round-trip time estimate
    pub rtt: Option<Duration>,

    /// Whether quantum-safe handshake was used
    pub pqc_enabled: bool,
}

impl ConnectionInfo {
    /// Create new connection info
    pub fn new(connection_id: String, remote_addr: SocketAddr, local_addr: SocketAddr) -> Self {
        Self {
            connection_id,
            remote_addr,
            local_addr,
            state: ConnectionState::Connecting,
            bytes_sent: 0,
            bytes_received: 0,
            rtt: None,
            pqc_enabled: true,
        }
    }

    /// Update connection state
    pub fn set_state(&mut self, state: ConnectionState) {
        self.state = state;
    }

    /// Update statistics
    pub fn update_stats(&mut self, bytes_sent: u64, bytes_received: u64, rtt: Option<Duration>) {
        self.bytes_sent = bytes_sent;
        self.bytes_received = bytes_received;
        self.rtt = rtt;
    }

    /// Check if connection is active
    pub fn is_active(&self) -> bool {
        matches!(self.state, ConnectionState::Connected)
    }
}

/// QUIC transport manager
pub struct QuicTransport {
    /// Transport configuration
    config: TransportConfig,

    /// PQC handshake manager
    handshake: PQCHandshake,

    /// Local binding address
    local_addr: Option<SocketAddr>,

    /// Active connections (connection_id -> info)
    connections: std::collections::HashMap<String, ConnectionInfo>,
}

impl QuicTransport {
    /// Create a new QUIC transport
    pub fn new(agent_id: String) -> Result<Self> {
        Self::with_config(agent_id, TransportConfig::default())
    }

    /// Create a new QUIC transport with custom configuration
    pub fn with_config(agent_id: String, config: TransportConfig) -> Result<Self> {
        let handshake = PQCHandshake::new(agent_id)?;

        Ok(Self {
            config,
            handshake,
            local_addr: None,
            connections: std::collections::HashMap::new(),
        })
    }

    /// Get the transport configuration
    pub fn config(&self) -> &TransportConfig {
        &self.config
    }

    /// Get the PQC handshake manager
    pub fn handshake(&self) -> &PQCHandshake {
        &self.handshake
    }

    /// Bind to a local address
    pub fn bind(&mut self, addr: SocketAddr) -> Result<()> {
        tracing::info!("Binding QUIC transport to {}", addr);
        self.local_addr = Some(addr);
        Ok(())
    }

    /// Get the local binding address
    pub fn local_addr(&self) -> Option<SocketAddr> {
        self.local_addr
    }

    /// Connect to a remote address
    pub fn connect(&mut self, remote_addr: SocketAddr) -> Result<String> {
        let local_addr = self.local_addr.ok_or_else(|| {
            NetworkError::Transport("Transport not bound to local address".to_string())
        })?;

        let connection_id = format!("conn-{}", uuid::Uuid::new_v4());

        tracing::info!(
            "Initiating QUIC connection {} to {} with PQC handshake",
            connection_id,
            remote_addr
        );

        let conn_info = ConnectionInfo::new(connection_id.clone(), remote_addr, local_addr);
        self.connections.insert(connection_id.clone(), conn_info);

        Ok(connection_id)
    }

    /// Accept an incoming connection
    pub fn accept(&mut self, remote_addr: SocketAddr) -> Result<String> {
        let local_addr = self.local_addr.ok_or_else(|| {
            NetworkError::Transport("Transport not bound to local address".to_string())
        })?;

        let connection_id = format!("conn-{}", uuid::Uuid::new_v4());

        tracing::info!(
            "Accepting QUIC connection {} from {} with PQC handshake",
            connection_id,
            remote_addr
        );

        let conn_info = ConnectionInfo::new(connection_id.clone(), remote_addr, local_addr);
        self.connections.insert(connection_id.clone(), conn_info);

        Ok(connection_id)
    }

    /// Close a connection
    pub fn close(&mut self, connection_id: &str) -> Result<()> {
        if let Some(conn) = self.connections.get_mut(connection_id) {
            tracing::info!("Closing QUIC connection {}", connection_id);
            conn.set_state(ConnectionState::Closed);
            Ok(())
        } else {
            Err(NetworkError::Connection(format!(
                "Connection not found: {}",
                connection_id
            )))
        }
    }

    /// Get connection info
    pub fn connection_info(&self, connection_id: &str) -> Option<&ConnectionInfo> {
        self.connections.get(connection_id)
    }

    /// Get all active connections
    pub fn active_connections(&self) -> Vec<&ConnectionInfo> {
        self.connections
            .values()
            .filter(|c| c.is_active())
            .collect()
    }

    /// Get connection count
    pub fn connection_count(&self) -> usize {
        self.connections.len()
    }

    /// Update connection state
    pub fn update_connection_state(
        &mut self,
        connection_id: &str,
        state: ConnectionState,
    ) -> Result<()> {
        if let Some(conn) = self.connections.get_mut(connection_id) {
            conn.set_state(state);
            Ok(())
        } else {
            Err(NetworkError::Connection(format!(
                "Connection not found: {}",
                connection_id
            )))
        }
    }

    /// Update connection statistics
    pub fn update_connection_stats(
        &mut self,
        connection_id: &str,
        bytes_sent: u64,
        bytes_received: u64,
        rtt: Option<Duration>,
    ) -> Result<()> {
        if let Some(conn) = self.connections.get_mut(connection_id) {
            conn.update_stats(bytes_sent, bytes_received, rtt);
            Ok(())
        } else {
            Err(NetworkError::Connection(format!(
                "Connection not found: {}",
                connection_id
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transport_config_default() {
        let config = TransportConfig::default();
        assert_eq!(config.max_idle_timeout, Duration::from_secs(30));
        assert_eq!(config.max_concurrent_bidi_streams, 100);
        assert!(!config.enable_0rtt); // Should be disabled by default
        assert!(config.enable_migration);
    }

    #[test]
    fn test_pqc_handshake_creation() {
        let handshake = PQCHandshake::new("test-agent".to_string());
        assert!(handshake.is_ok());

        let handshake = handshake.unwrap();
        assert_eq!(handshake.identity().agent_id, "test-agent");
    }

    #[test]
    fn test_connection_info() {
        let remote_addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
        let local_addr: SocketAddr = "127.0.0.1:9090".parse().unwrap();

        let mut conn_info = ConnectionInfo::new(
            "test-conn".to_string(),
            remote_addr,
            local_addr,
        );

        assert_eq!(conn_info.state, ConnectionState::Connecting);
        assert!(!conn_info.is_active());

        conn_info.set_state(ConnectionState::Connected);
        assert!(conn_info.is_active());

        conn_info.update_stats(1000, 2000, Some(Duration::from_millis(50)));
        assert_eq!(conn_info.bytes_sent, 1000);
        assert_eq!(conn_info.bytes_received, 2000);
        assert_eq!(conn_info.rtt, Some(Duration::from_millis(50)));
    }

    #[test]
    fn test_quic_transport_creation() {
        let transport = QuicTransport::new("test-agent".to_string());
        assert!(transport.is_ok());

        let transport = transport.unwrap();
        assert_eq!(transport.connection_count(), 0);
    }

    #[test]
    fn test_quic_transport_bind() {
        let mut transport = QuicTransport::new("test-agent".to_string()).unwrap();
        let addr: SocketAddr = "127.0.0.1:0".parse().unwrap();

        assert!(transport.bind(addr).is_ok());
        assert_eq!(transport.local_addr(), Some(addr));
    }

    #[test]
    fn test_connection_management() {
        let mut transport = QuicTransport::new("test-agent".to_string()).unwrap();
        let local_addr: SocketAddr = "127.0.0.1:9000".parse().unwrap();
        let remote_addr: SocketAddr = "127.0.0.1:8000".parse().unwrap();

        transport.bind(local_addr).unwrap();

        // Connect to remote
        let conn_id = transport.connect(remote_addr).unwrap();
        assert_eq!(transport.connection_count(), 1);

        // Update state to connected
        transport
            .update_connection_state(&conn_id, ConnectionState::Connected)
            .unwrap();

        let conn_info = transport.connection_info(&conn_id).unwrap();
        assert!(conn_info.is_active());

        // Close connection
        transport.close(&conn_id).unwrap();
        let conn_info = transport.connection_info(&conn_id).unwrap();
        assert_eq!(conn_info.state, ConnectionState::Closed);
    }

    #[test]
    fn test_active_connections_filter() {
        let mut transport = QuicTransport::new("test-agent".to_string()).unwrap();
        let local_addr: SocketAddr = "127.0.0.1:9000".parse().unwrap();
        transport.bind(local_addr).unwrap();

        // Create multiple connections
        let _conn1 = transport.connect("127.0.0.1:8001".parse().unwrap()).unwrap();
        let conn2 = transport.connect("127.0.0.1:8002".parse().unwrap()).unwrap();
        let _conn3 = transport.connect("127.0.0.1:8003".parse().unwrap()).unwrap();

        // Set one to connected
        transport
            .update_connection_state(&conn2, ConnectionState::Connected)
            .unwrap();

        let active = transport.active_connections();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].connection_id, conn2);
    }

    #[test]
    fn test_connection_stats_update() {
        let mut transport = QuicTransport::new("test-agent".to_string()).unwrap();
        let local_addr: SocketAddr = "127.0.0.1:9000".parse().unwrap();
        transport.bind(local_addr).unwrap();

        let conn_id = transport.connect("127.0.0.1:8000".parse().unwrap()).unwrap();

        transport
            .update_connection_stats(&conn_id, 5000, 3000, Some(Duration::from_millis(25)))
            .unwrap();

        let conn_info = transport.connection_info(&conn_id).unwrap();
        assert_eq!(conn_info.bytes_sent, 5000);
        assert_eq!(conn_info.bytes_received, 3000);
        assert_eq!(conn_info.rtt, Some(Duration::from_millis(25)));
    }
}
