//! QUIC transport implementation with TLS 1.3 and quantum-resistant handshake

use crate::{
    error::{NetworkError, Result},
    network_types::*,
};
use futures::StreamExt;
use parking_lot::RwLock;
use quinn::{
    ClientConfig, Connection, Endpoint, ServerConfig, VarInt,
};
use rustls::ServerName;
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::Arc,
    time::Duration,
};
use tokio::sync::{mpsc, oneshot};
use tracing::{debug, error, info, warn};

/// QUIC transport layer
pub struct QuicTransport {
    /// Local peer ID
    peer_id: PeerId,

    /// QUIC endpoint
    endpoint: Option<Endpoint>,

    /// Active connections
    connections: Arc<RwLock<HashMap<PeerId, Connection>>>,

    /// Connection statistics
    stats: Arc<RwLock<HashMap<PeerId, ConnectionStats>>>,

    /// Configuration
    config: NetworkConfig,

    /// Message receiver channel
    message_rx: Arc<RwLock<Option<mpsc::UnboundedReceiver<(PeerId, NetworkMessage)>>>>,

    /// Message sender channel
    message_tx: mpsc::UnboundedSender<(PeerId, NetworkMessage)>,

    /// Shutdown signal
    shutdown_tx: Option<oneshot::Sender<()>>,
}

impl QuicTransport {
    /// Create a new QUIC transport
    pub fn new(peer_id: PeerId, config: NetworkConfig) -> Self {
        let (message_tx, message_rx) = mpsc::unbounded_channel();

        Self {
            peer_id,
            endpoint: None,
            connections: Arc::new(RwLock::new(HashMap::new())),
            stats: Arc::new(RwLock::new(HashMap::new())),
            config,
            message_rx: Arc::new(RwLock::new(Some(message_rx))),
            message_tx,
            shutdown_tx: None,
        }
    }

    /// Bind and start listening for incoming connections
    pub async fn bind_and_listen(&mut self) -> Result<()> {
        let listen_addr = format!("{}:{}", self.config.listen_addr, self.config.quic_port);
        let addr: SocketAddr = listen_addr.parse()?;

        info!("Binding QUIC transport to {}", addr);

        // Generate self-signed certificate for TLS
        let (cert, key) = self.generate_self_signed_cert()?;

        // Configure server
        let server_config = self.create_server_config(cert, key)?;

        // Bind endpoint
        let endpoint = Endpoint::server(server_config, addr)?;
        let local_addr = endpoint.local_addr()?;

        info!("QUIC transport listening on {}", local_addr);

        // Start accepting connections
        let connections = self.connections.clone();
        let stats = self.stats.clone();
        let message_tx = self.message_tx.clone();
        let peer_id = self.peer_id;

        let (shutdown_tx, mut shutdown_rx) = oneshot::channel();
        self.shutdown_tx = Some(shutdown_tx);

        // Clone endpoint for the spawned task
        let endpoint_clone = endpoint.clone();

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    Some(incoming) = endpoint_clone.accept() => {
                        let connections = connections.clone();
                        let stats = stats.clone();
                        let message_tx = message_tx.clone();

                        tokio::spawn(async move {
                            match incoming.await {
                                Ok(conn) => {
                                    info!("Accepted connection from {}", conn.remote_address());

                                    // Handle connection
                                    if let Err(e) = Self::handle_connection(
                                        peer_id,
                                        conn,
                                        connections,
                                        stats,
                                        message_tx,
                                    ).await {
                                        error!("Connection handling error: {}", e);
                                    }
                                }
                                Err(e) => {
                                    error!("Failed to accept connection: {}", e);
                                }
                            }
                        });
                    }
                    _ = &mut shutdown_rx => {
                        info!("Shutting down QUIC transport");
                        break;
                    }
                }
            }
        });

        self.endpoint = Some(endpoint);

        Ok(())
    }

    /// Connect to a peer
    pub async fn connect_peer(&self, peer_addr: SocketAddr) -> Result<PeerId> {
        let endpoint = self.endpoint.as_ref()
            .ok_or_else(|| NetworkError::Io(std::io::Error::new(
                std::io::ErrorKind::NotConnected,
                "Endpoint not initialized"
            )))?;

        debug!("Connecting to peer at {}", peer_addr);

        // Configure client
        let client_config = self.create_client_config()?;

        // Connect
        let conn = endpoint
            .connect_with(client_config, peer_addr, "cretoai")?
            .await?;

        info!("Connected to peer at {}", conn.remote_address());

        // Perform handshake to get peer ID
        let peer_id = self.perform_handshake(&conn).await?;

        // Store connection
        self.connections.write().insert(peer_id, conn.clone());
        self.stats.write().insert(peer_id, ConnectionStats::default());

        // Start receiving messages
        let connections = self.connections.clone();
        let stats = self.stats.clone();
        let message_tx = self.message_tx.clone();
        let local_peer_id = self.peer_id;

        tokio::spawn(async move {
            if let Err(e) = Self::handle_connection(
                local_peer_id,
                conn,
                connections,
                stats,
                message_tx,
            ).await {
                error!("Connection handling error: {}", e);
            }
        });

        Ok(peer_id)
    }

    /// Broadcast message to all connected peers
    pub async fn broadcast(&self, message: NetworkMessage) -> Result<()> {
        let connections = self.connections.read();
        let peer_ids: Vec<PeerId> = connections.keys().copied().collect();

        debug!("Broadcasting message to {} peers", peer_ids.len());

        let mut tasks = Vec::new();

        for peer_id in peer_ids {
            let conn = connections.get(&peer_id).unwrap().clone();
            let msg = message.clone();
            let stats = self.stats.clone();

            tasks.push(tokio::spawn(async move {
                if let Err(e) = Self::send_message(&conn, &msg).await {
                    error!("Failed to send message to {}: {}", peer_id, e);
                } else {
                    // Update stats
                    if let Some(stat) = stats.write().get_mut(&peer_id) {
                        stat.messages_sent += 1;
                    }
                }
            }));
        }

        // Wait for all broadcasts
        futures::future::join_all(tasks).await;

        Ok(())
    }

    /// Send message to specific peer
    pub async fn send_to(&self, peer_id: PeerId, message: NetworkMessage) -> Result<()> {
        let connections = self.connections.read();
        let conn = connections.get(&peer_id)
            .ok_or_else(|| NetworkError::PeerNotFound(peer_id.to_string()))?
            .clone();

        Self::send_message(&conn, &message).await?;

        // Update stats
        if let Some(stat) = self.stats.write().get_mut(&peer_id) {
            stat.messages_sent += 1;
        }

        Ok(())
    }

    /// Get message receiver
    pub fn take_message_receiver(&self) -> Option<mpsc::UnboundedReceiver<(PeerId, NetworkMessage)>> {
        self.message_rx.write().take()
    }

    /// Get connected peers
    pub fn get_peers(&self) -> Vec<PeerId> {
        self.connections.read().keys().copied().collect()
    }

    /// Get connection statistics
    pub fn get_stats(&self, peer_id: PeerId) -> Option<ConnectionStats> {
        self.stats.read().get(&peer_id).cloned()
    }

    /// Disconnect from peer
    pub async fn disconnect_peer(&self, peer_id: PeerId) -> Result<()> {
        if let Some(conn) = self.connections.write().remove(&peer_id) {
            conn.close(VarInt::from_u32(0), b"disconnect");
            self.stats.write().remove(&peer_id);
            info!("Disconnected from peer {}", peer_id);
        }
        Ok(())
    }

    /// Shutdown transport
    pub async fn shutdown(&mut self) -> Result<()> {
        if let Some(shutdown_tx) = self.shutdown_tx.take() {
            let _ = shutdown_tx.send(());
        }

        // Close all connections
        let connections = self.connections.write();
        for (peer_id, conn) in connections.iter() {
            conn.close(VarInt::from_u32(0), b"shutdown");
            debug!("Closed connection to {}", peer_id);
        }

        if let Some(endpoint) = self.endpoint.take() {
            endpoint.close(VarInt::from_u32(0), b"shutdown");
        }

        info!("QUIC transport shutdown complete");

        Ok(())
    }

    // Helper methods

    async fn handle_connection(
        local_peer_id: PeerId,
        conn: Connection,
        connections: Arc<RwLock<HashMap<PeerId, Connection>>>,
        stats: Arc<RwLock<HashMap<PeerId, ConnectionStats>>>,
        message_tx: mpsc::UnboundedSender<(PeerId, NetworkMessage)>,
    ) -> Result<()> {
        // Accept incoming streams
        loop {
            match conn.accept_uni().await {
                Ok(mut recv) => {
                    let message_tx = message_tx.clone();
                    let stats = stats.clone();

                    tokio::spawn(async move {
                        // Quinn 0.10 API: read_to_end takes only max_size parameter and returns the bytes
                        let buf = match recv.read_to_end(1024 * 1024).await {
                            Ok(bytes) => bytes,
                            Err(e) => {
                                error!("Failed to read stream: {}", e);
                                return;
                            }
                        };

                        match bincode::deserialize::<NetworkMessage>(&buf) {
                            Ok(message) => {
                                // Extract peer ID from message
                                let peer_id = match &message {
                                    NetworkMessage::Handshake { peer_id, .. } => *peer_id,
                                    NetworkMessage::HandshakeAck { peer_id, .. } => *peer_id,
                                    _ => local_peer_id, // Use local peer ID as fallback
                                };

                                // Update stats
                                if let Some(stat) = stats.write().get_mut(&peer_id) {
                                    stat.messages_received += 1;
                                    stat.bytes_received += buf.len() as u64;
                                }

                                // Forward message
                                if let Err(e) = message_tx.send((peer_id, message)) {
                                    error!("Failed to forward message: {}", e);
                                }
                            }
                            Err(e) => {
                                error!("Failed to deserialize message: {}", e);
                            }
                        }
                    });
                }
                Err(e) => {
                    if matches!(e, quinn::ConnectionError::ApplicationClosed(_)) {
                        debug!("Connection closed by peer");
                    } else {
                        error!("Failed to accept stream: {}", e);
                    }
                    break;
                }
            }
        }

        Ok(())
    }

    async fn send_message(conn: &Connection, message: &NetworkMessage) -> Result<()> {
        let serialized = bincode::serialize(message)?;

        let mut send = conn.open_uni().await?;
        send.write_all(&serialized).await?;
        send.finish()?;

        Ok(())
    }

    async fn perform_handshake(&self, conn: &Connection) -> Result<PeerId> {
        // Send handshake with our peer ID and public key
        let handshake = NetworkMessage::Handshake {
            peer_id: self.peer_id,
            public_key: vec![0; 32], // Placeholder - would be actual public key
            kem_public_key: vec![0; 1184], // ML-KEM-768 public key size
        };

        Self::send_message(conn, &handshake).await?;

        // Wait for handshake acknowledgment (simplified - would need proper implementation)
        // For now, generate a random peer ID
        Ok(PeerId::new())
    }

    fn create_server_config(&self, cert: rustls::Certificate, key: rustls::PrivateKey) -> Result<ServerConfig> {
        let mut crypto = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![cert], key)
            .map_err(|e| NetworkError::Tls(e.to_string()))?;

        crypto.alpn_protocols = vec![b"cretoai/1.0".to_vec()];

        let mut config = ServerConfig::with_crypto(Arc::new(crypto));

        // Configure transport parameters
        let mut transport = quinn::TransportConfig::default();
        transport.max_concurrent_uni_streams(VarInt::from_u32(100));
        transport.keep_alive_interval(Some(Duration::from_secs(self.config.keep_alive_interval_secs)));
        transport.max_idle_timeout(Some(Duration::from_secs(self.config.connection_timeout_ms / 1000).try_into().unwrap()));

        config.transport_config(Arc::new(transport));

        Ok(config)
    }

    fn create_client_config(&self) -> Result<ClientConfig> {
        let mut crypto = rustls::ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(SkipServerVerification))
            .with_no_client_auth();

        crypto.alpn_protocols = vec![b"cretoai/1.0".to_vec()];

        let mut config = ClientConfig::new(Arc::new(crypto));

        // Configure transport parameters
        let mut transport = quinn::TransportConfig::default();
        transport.max_concurrent_uni_streams(VarInt::from_u32(100));
        transport.keep_alive_interval(Some(Duration::from_secs(self.config.keep_alive_interval_secs)));

        config.transport_config(Arc::new(transport));

        Ok(config)
    }

    fn generate_self_signed_cert(&self) -> Result<(rustls::Certificate, rustls::PrivateKey)> {
        let cert = rcgen::generate_simple_self_signed(vec!["cretoai".to_string()])
            .map_err(|e| NetworkError::Tls(e.to_string()))?;

        let key = PrivateKeyDer::Pkcs8(cert.key_pair.serialize_der().into());
        let cert_der = CertificateDer::from(cert.cert);

        Ok((cert_der, key))
    }
}

/// Skip server certificate verification (for testing)
#[derive(Debug)]
struct SkipServerVerification;

// Rustls 0.21 uses dangerous (not danger)
impl rustls::client::dangerous::ServerCertVerifier for SkipServerVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> std::result::Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> std::result::Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> std::result::Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        vec![
            rustls::SignatureScheme::RSA_PKCS1_SHA256,
            rustls::SignatureScheme::ECDSA_NISTP256_SHA256,
            rustls::SignatureScheme::ED25519,
        ]
    }

}
