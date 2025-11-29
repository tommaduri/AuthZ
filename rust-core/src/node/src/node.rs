//! Consensus node orchestrator integrating all subsystems

use anyhow::{Context, Result};
use cretoai_consensus::bft::{BftConfig, BftEngine};
use cretoai_crypto::signatures::{ML_DSA_87, SignatureScheme};
use cretoai_dag::storage::rocksdb::RocksDbStorage;
// TODO Phase 7: Re-enable when experimental-quic feature is complete
// use cretoai_network::{QuicTransport, NetworkConfig};
use cretoai_network::NetworkConfig;
use cretoai_network::network_types::PeerId;
use parking_lot::RwLock;
use prometheus::{Encoder, TextEncoder};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::interval;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::config::NodeConfig;

/// Main consensus node that integrates all subsystems
pub struct ConsensusNode {
    /// Node identifier
    node_id: String,

    /// Configuration
    config: NodeConfig,

    /// Consensus engine
    consensus: Arc<BftEngine>,

    /// Network transport (TODO Phase 7: Re-enable with experimental-quic feature)
    // network: Arc<QuicTransport>,

    /// Storage layer
    storage: Arc<RwLock<RocksDbStorage>>,

    /// Metrics port
    metrics_port: u16,

    /// Shutdown signal
    shutdown_tx: Option<mpsc::Sender<()>>,
}

impl ConsensusNode {
    /// Create a new consensus node
    pub async fn new(config: NodeConfig) -> Result<Self> {
        info!("Initializing consensus node '{}'", config.node.id);

        // Create data directories
        let data_dir = config.data_dir();
        let storage_path = config.storage_path();
        let key_path = config.key_path();

        std::fs::create_dir_all(&data_dir)
            .context("Failed to create data directory")?;
        std::fs::create_dir_all(storage_path.parent().unwrap())
            .context("Failed to create storage directory")?;
        std::fs::create_dir_all(&key_path)
            .context("Failed to create key directory")?;

        // 1. Initialize cryptographic keys
        let (private_key, public_key) = Self::load_or_generate_keypair(&key_path, config.crypto.auto_generate_keys)?;
        info!("Loaded cryptographic keypair ({} bytes)", private_key.len());

        // 2. Initialize storage layer
        let storage = RocksDbStorage::open(&storage_path)
            .context("Failed to initialize RocksDB storage")?;
        info!("RocksDB storage initialized at {:?}", storage_path);
        let storage = Arc::new(RwLock::new(storage));

        // 3. Initialize network transport
        let peer_id = PeerId::new();
        let network_config = NetworkConfig {
            listen_addr: config.network.listen_addr.clone(),
            quic_port: config.network.quic_port,
            bootstrap_peers: config.network.bootstrap_peers.clone(),
            max_connections: config.network.max_peers,
            connection_timeout_ms: config.network.connection_timeout_ms,
            keep_alive_interval_secs: config.network.keep_alive_interval_secs,
            max_bandwidth_bps: 100_000_000, // 100 Mbps default
            enable_nat_traversal: config.network.enable_nat_traversal,
            stun_servers: config.network.stun_servers.clone(),
            turn_servers: vec![], // TODO: Add from config if needed
            enable_mdns: config.network.mdns_enabled,
            enable_dht: config.network.kad_enabled,
        };

        // TODO Phase 7: Re-enable when experimental-quic feature is complete
        // let mut network = QuicTransport::new(peer_id, network_config);
        // network.bind_and_listen().await
        //     .context("Failed to initialize QUIC transport")?;
        // info!("QUIC transport initialized on {}:{}", config.network.listen_addr, config.network.quic_port);
        // let network = Arc::new(network);

        // 4. Initialize consensus engine
        let total_nodes = if config.network.bootstrap_peers.is_empty() {
            1 // Bootstrap node
        } else {
            config.network.bootstrap_peers.len() + 1
        };

        let bft_config = BftConfig {
            node_id: Uuid::parse_str(&config.node.id).unwrap_or_else(|_| Uuid::new_v4()),
            total_nodes,
            quorum_threshold: config.consensus.quorum_threshold,
            finality_timeout_ms: config.consensus.finality_timeout_ms,
            max_pending_vertices: config.consensus.max_pending_vertices,
            byzantine_detection_enabled: true,
            signature_scheme: config.crypto.signature_algorithm.clone(),
        };

        let consensus = BftEngine::new(bft_config, private_key, public_key)
            .context("Failed to initialize BFT consensus engine")?;
        info!("BFT consensus engine initialized (quorum: {}, timeout: {}ms)",
              consensus.config().quorum_size(),
              consensus.config().finality_timeout_ms);
        let consensus = Arc::new(consensus);

        // Save metrics port before moving config
        let metrics_port = config.metrics.port;

        Ok(Self {
            node_id: config.node.id.clone(),
            config,
            consensus,
            // network,  // TODO Phase 7: Re-enable with experimental-quic
            storage,
            metrics_port,
            shutdown_tx: None,
        })
    }

    /// Run the consensus node
    pub async fn run(&mut self) -> Result<()> {
        info!("Starting consensus node...");

        // Create shutdown channel
        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        self.shutdown_tx = Some(shutdown_tx);

        // Start consensus engine
        let consensus = self.consensus.clone();
        let consensus_task = tokio::spawn(async move {
            if let Err(e) = consensus.start().await {
                error!("Consensus engine error: {}", e);
            }
        });

        // TODO Phase 7: Start message handler when QUIC is ready
        // let network = self.network.clone();
        // let consensus = self.consensus.clone();
        // let storage = self.storage.clone();
        // let message_task = tokio::spawn(async move {
        //     Self::handle_messages(network, consensus, storage).await
        // });

        // Start metrics server if enabled
        let metrics_task = if self.config.metrics.enabled {
            let port = self.metrics_port;
            let consensus_metrics = self.consensus.metrics();
            Some(tokio::spawn(async move {
                Self::run_metrics_server(port, consensus_metrics).await
            }))
        } else {
            None
        };

        // Start periodic tasks
        let periodic_task = self.start_periodic_tasks();

        // Wait for shutdown or error
        tokio::select! {
            _ = consensus_task => {
                warn!("Consensus engine stopped");
            }
            // TODO Phase 7: Re-enable when message_task is active
            // result = message_task => {
            //     if let Err(e) = result {
            //         error!("Message handler error: {}", e);
            //     }
            // }
            _ = shutdown_rx.recv() => {
                info!("Received internal shutdown signal");
            }
        }

        // Cancel periodic tasks
        periodic_task.abort();

        // Cancel metrics server
        if let Some(task) = metrics_task {
            task.abort();
        }

        Ok(())
    }

    /// Graceful shutdown
    pub async fn shutdown(&mut self) -> Result<()> {
        info!("Initiating graceful shutdown...");

        // Stop consensus engine
        self.consensus.stop().await;

        // TODO Phase 7: Close network connections when QUIC is ready
        // self.network.shutdown().await?;

        // Flush storage
        self.storage.read().flush()?;

        info!("Shutdown complete");
        Ok(())
    }

    /// Handle messages between network and consensus
    /// TODO Phase 7: Re-enable when experimental-quic feature is complete
    #[allow(dead_code)]
    async fn handle_messages(
        // network: Arc<QuicTransport>,
        consensus: Arc<BftEngine>,
        storage: Arc<RwLock<RocksDbStorage>>,
    ) -> Result<()> {
        // TODO Phase 7: Re-enable network message handling
        // let mut message_rx = network.take_message_receiver()
        //     .context("Failed to get message receiver")?;

        info!("Message handler started (QUIC disabled - Phase 7)");

        // TODO Phase 7: Re-enable message loop
        // while let Some((_peer_id, message)) = message_rx.recv().await {
        //     debug!("Received network message");
        //
        //     // In production, deserialize and route messages to consensus
        //     // For now, just log
        //     // TODO: Implement proper message routing
        // }

        Ok(())
    }

    /// Run Prometheus metrics server
    async fn run_metrics_server(
        port: u16,
        _consensus_metrics: Arc<cretoai_consensus::metrics::ConsensusMetrics>,
    ) -> Result<()> {
        use warp::Filter;

        let metrics_route = warp::path("metrics").map(|| {
            let encoder = TextEncoder::new();
            let metric_families = prometheus::gather();
            let mut buffer = Vec::new();

            encoder.encode(&metric_families, &mut buffer).ok();
            String::from_utf8(buffer).unwrap_or_default()
        });

        info!("Metrics server listening on http://0.0.0.0:{}/metrics", port);

        let addr: SocketAddr = format!("0.0.0.0:{}", port).parse()?;
        warp::serve(metrics_route).run(addr).await;

        Ok(())
    }

    /// Start periodic maintenance tasks
    fn start_periodic_tasks(&self) -> tokio::task::JoinHandle<()> {
        let storage = self.storage.clone();
        let metrics_interval = self.config.metrics.collection_interval_secs;

        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_secs(metrics_interval));

            loop {
                ticker.tick().await;

                // Update storage metrics
                let storage_guard = storage.read();
                let metrics = storage_guard.get_metrics();
                debug!(
                    "Storage metrics: {} vertices stored, {} finalized",
                    metrics.vertices_stored,
                    metrics.vertices_finalized
                );

                // Get database size
                if let Ok(size) = storage_guard.get_db_size() {
                    debug!("Database size: {} MB", size / (1024 * 1024));
                }
            }
        })
    }

    /// Load or generate cryptographic keypair
    fn load_or_generate_keypair(
        key_path: &std::path::Path,
        auto_generate: bool,
    ) -> Result<(Vec<u8>, Vec<u8>)> {
        let private_key_path = key_path.join("private_key.bin");
        let public_key_path = key_path.join("public_key.bin");

        if private_key_path.exists() && public_key_path.exists() {
            info!("Loading existing keypair from {:?}", key_path);
            let private_key = std::fs::read(&private_key_path)?;
            let public_key = std::fs::read(&public_key_path)?;
            Ok((private_key, public_key))
        } else if auto_generate {
            info!("Generating new ML-DSA-87 keypair...");
            let ml_dsa = ML_DSA_87::new();
            let (private_key, public_key) = ml_dsa.generate_keypair();

            std::fs::write(&private_key_path, &private_key)?;
            std::fs::write(&public_key_path, &public_key)?;

            info!("Keypair saved to {:?}", key_path);
            Ok((private_key, public_key))
        } else {
            anyhow::bail!("Keypair not found and auto-generation is disabled");
        }
    }
}
