//! Simple QUIC node example demonstrating quantum-resistant transport
//!
//! This example shows how to:
//! - Create a Vigilia AI agent with quantum-resistant identity
//! - Start a QUIC server with ML-KEM-768 + X25519 hybrid handshake
//! - Accept incoming connections with quantum-resistant encryption
//! - Send and receive messages over QUIC streams
//!
//! Usage:
//!   cargo run --example quic_node -- --mode server --port 9001
//!   cargo run --example quic_node -- --mode client --server 127.0.0.1:9001

use cretoai_crypto::keys::AgentIdentity;
use cretoai_network::libp2p::quic::{QuicTransport, QuicTransportConfig};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tracing::{info, error, warn};

#[derive(Debug, Clone)]
struct Config {
    mode: Mode,
    port: u16,
    server_addr: Option<SocketAddr>,
    agent_id: String,
}

#[derive(Debug, Clone)]
enum Mode {
    Server,
    Client,
}

impl Config {
    fn from_args() -> Self {
        let args: Vec<String> = std::env::args().collect();

        let mut mode = Mode::Server;
        let mut port = 9001;
        let mut server_addr = None;
        let mut agent_id = format!("vigilia-node-{}", uuid::Uuid::new_v4());

        let mut i = 1;
        while i < args.len() {
            match args[i].as_str() {
                "--mode" => {
                    if i + 1 < args.len() {
                        mode = match args[i + 1].as_str() {
                            "server" => Mode::Server,
                            "client" => Mode::Client,
                            _ => Mode::Server,
                        };
                        i += 1;
                    }
                }
                "--port" => {
                    if i + 1 < args.len() {
                        port = args[i + 1].parse().unwrap_or(9001);
                        i += 1;
                    }
                }
                "--server" => {
                    if i + 1 < args.len() {
                        server_addr = args[i + 1].parse().ok();
                        i += 1;
                    }
                }
                "--agent-id" => {
                    if i + 1 < args.len() {
                        agent_id = args[i + 1].clone();
                        i += 1;
                    }
                }
                _ => {}
            }
            i += 1;
        }

        Self { mode, port, server_addr, agent_id }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .with_target(false)
        .init();

    let config = Config::from_args();

    info!("🚀 Vigilia AI Quantum-Resistant QUIC Node");
    info!("Agent ID: {}", config.agent_id);
    info!("Mode: {:?}", config.mode);

    match config.mode {
        Mode::Server => run_server(config).await?,
        Mode::Client => run_client(config).await?,
    }

    Ok(())
}

async fn run_server(config: Config) -> Result<(), Box<dyn std::error::Error>> {
    info!("🛡️ Starting quantum-resistant QUIC server...");

    // Generate agent identity with ML-KEM-768 keypair
    let identity = Arc::new(
        AgentIdentity::generate(config.agent_id.clone())
            .map_err(|e| format!("Failed to generate identity: {}", e))?
    );

    info!("✅ Agent identity generated with ML-KEM-768 keypair");

    // Create QUIC transport configuration
    let transport_config = QuicTransportConfig {
        bind_address: format!("0.0.0.0:{}", config.port).parse()?,
        ..Default::default()
    };

    // Create QUIC transport with hybrid TLS
    let mut transport = QuicTransport::new(identity, transport_config)
        .map_err(|e| format!("Failed to create transport: {}", e))?;

    // Start listening
    let local_addr = transport.listen().await
        .map_err(|e| format!("Failed to start listener: {}", e))?;

    info!("🎧 Server listening on {}", local_addr);
    info!("🔐 Hybrid handshake: X25519 + ML-KEM-768 (NIST FIPS 203)");
    info!("📊 Waiting for quantum-resistant connections...");

    // Accept connections loop
    loop {
        match transport.accept().await {
            Ok((remote_addr, connection)) => {
                info!("✨ New connection from {}", remote_addr);
                info!("🔑 Quantum-resistant handshake completed");

                // Spawn task to handle connection
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(connection, remote_addr).await {
                        error!("Connection error: {}", e);
                    }
                });
            }
            Err(e) => {
                error!("Failed to accept connection: {}", e);
            }
        }
    }
}

async fn run_client(config: Config) -> Result<(), Box<dyn std::error::Error>> {
    let server_addr = config.server_addr.ok_or("Server address required for client mode")?;

    info!("🔌 Connecting to server at {}", server_addr);

    // Generate client identity
    let identity = Arc::new(
        AgentIdentity::generate(config.agent_id.clone())
            .map_err(|e| format!("Failed to generate identity: {}", e))?
    );

    info!("✅ Client identity generated");

    // Create transport
    let transport_config = QuicTransportConfig::default();
    let mut transport = QuicTransport::new(identity, transport_config)
        .map_err(|e| format!("Failed to create transport: {}", e))?;

    // Connect to server
    info!("🤝 Initiating quantum-resistant handshake...");
    transport.dial(server_addr).await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    info!("✨ Connected successfully!");
    info!("🔐 Hybrid handshake complete: X25519 + ML-KEM-768");

    // TODO: Send test messages once stream API is implemented
    info!("📡 Connection established and ready for data transfer");

    // Keep connection alive
    tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;

    info!("👋 Client shutting down");

    Ok(())
}

async fn handle_connection(
    connection: quinn::Connection,
    remote_addr: SocketAddr,
) -> Result<(), Box<dyn std::error::Error>> {
    info!("🔗 Handling connection from {}", remote_addr);

    // Accept bidirectional stream
    match connection.accept_bi().await {
        Ok((mut send, mut recv)) => {
            info!("📨 Stream opened from {}", remote_addr);

            // Read incoming data
            let mut buf = vec![0u8; 1024];
            match recv.read(&mut buf).await {
                Ok(Some(n)) => {
                    let message = String::from_utf8_lossy(&buf[..n]);
                    info!("📩 Received: {}", message);

                    // Echo response
                    let response = format!("Echo: {}", message);
                    send.write_all(response.as_bytes()).await?;
                    info!("📤 Sent echo response");
                }
                Ok(None) => {
                    info!("📭 Stream closed by client");
                }
                Err(e) => {
                    warn!("Stream read error: {}", e);
                }
            }
        }
        Err(e) => {
            warn!("Failed to accept stream: {}", e);
        }
    }

    Ok(())
}
