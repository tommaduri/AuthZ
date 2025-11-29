# CretoAI Node Module Structure

**Crate**: `cretoai-node`
**Location**: `/Users/tommaduri/cretoai/src/node/`
**Type**: Binary crate
**Purpose**: Standalone Byzantine Fault Tolerant consensus node

---

## Crate Structure

```
src/node/
├── Cargo.toml                  # Crate manifest
├── README.md                   # Node documentation
├── DESIGN.md                   # This file
│
├── src/
│   ├── main.rs                 # Binary entry point
│   ├── lib.rs                  # Library exports (for testing)
│   │
│   ├── node.rs                 # ConsensusNode orchestrator
│   ├── config.rs               # Configuration parsing
│   ├── error.rs                # Node-specific errors
│   │
│   ├── consensus/              # BFT consensus implementation
│   │   ├── mod.rs
│   │   ├── bft.rs              # PBFT engine
│   │   ├── phase_coordinator.rs # Pre-Prepare/Prepare/Commit/Execute
│   │   ├── message_log.rs      # BFT message history
│   │   ├── view_change.rs      # Leader election
│   │   ├── byzantine.rs        # Byzantine detection
│   │   └── tests.rs
│   │
│   ├── network/                # QUIC transport layer
│   │   ├── mod.rs
│   │   ├── quic_transport.rs   # Quinn-based QUIC
│   │   ├── connection.rs       # Peer connection management
│   │   ├── peer_discovery.rs   # mDNS + DHT discovery
│   │   ├── nat_traversal.rs    # STUN/TURN client
│   │   └── tests.rs
│   │
│   ├── storage/                # RocksDB persistence
│   │   ├── mod.rs
│   │   ├── rocksdb.rs          # RocksDB storage backend
│   │   ├── schema.rs           # Column family definitions
│   │   ├── backup.rs           # Backup/restore
│   │   └── tests.rs
│   │
│   ├── crypto/                 # Crypto integration wrapper
│   │   ├── mod.rs
│   │   ├── verifier.rs         # Fast signature verification
│   │   └── cache.rs            # Public key cache
│   │
│   ├── metrics/                # Prometheus metrics
│   │   ├── mod.rs
│   │   ├── registry.rs         # Metric definitions
│   │   └── exporter.rs         # HTTP metrics endpoint
│   │
│   ├── api/                    # Optional HTTP/WebSocket API
│   │   ├── mod.rs
│   │   ├── http.rs             # REST API (Axum)
│   │   ├── websocket.rs        # WebSocket streaming
│   │   └── handlers.rs         # API route handlers
│   │
│   └── cli/                    # CLI commands
│       ├── mod.rs
│       ├── start.rs            # Start node
│       ├── health.rs           # Health check
│       └── keygen.rs           # Generate keypair
│
├── tests/                      # Integration tests
│   ├── three_node_cluster.rs
│   ├── byzantine_node.rs
│   └── network_partition.rs
│
├── benches/                    # Performance benchmarks
│   ├── consensus_bench.rs
│   └── network_bench.rs
│
└── examples/                   # Example usage
    ├── local_cluster.rs
    └── single_node.rs
```

---

## Module Responsibilities

### 1. `main.rs` - Binary Entry Point

```rust
//! CretoAI Consensus Node Binary
//!
//! Usage:
//!   cretoai-node start --config /path/to/node.toml
//!   cretoai-node health
//!   cretoai-node keygen --output /path/to/keys

use clap::{Parser, Subcommand};
use cretoai_node::{ConsensusNode, Config};
use tracing_subscriber::{fmt, EnvFilter};

#[derive(Parser)]
#[command(name = "cretoai-node")]
#[command(about = "CretoAI Byzantine Fault Tolerant Consensus Node")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start consensus node
    Start {
        #[arg(short, long, default_value = "config/node.toml")]
        config: String,
    },
    /// Health check
    Health,
    /// Generate node keypair
    Keygen {
        #[arg(short, long)]
        output: String,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Start { config } => {
            let config = Config::from_file(&config)?;
            let mut node = ConsensusNode::new(config).await?;
            node.start().await?;
        }
        Commands::Health => {
            // Check if node is responsive
            check_health().await?;
        }
        Commands::Keygen { output } => {
            // Generate ML-DSA-87 keypair
            generate_keypair(&output)?;
        }
    }

    Ok(())
}
```

---

### 2. `node.rs` - ConsensusNode Orchestrator

```rust
//! Main consensus node orchestrator
//!
//! Coordinates all subsystems: consensus, network, storage, metrics.

use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use crate::{
    config::Config,
    consensus::BftEngine,
    network::QuicTransport,
    storage::RocksDbStorage,
    metrics::MetricsRegistry,
    error::NodeError,
};

/// Main consensus node
pub struct ConsensusNode {
    config: Config,
    node_id: NodeId,

    // Core subsystems
    consensus: Arc<BftEngine>,
    network: Arc<QuicTransport>,
    storage: Arc<RocksDbStorage>,
    metrics: Arc<MetricsRegistry>,

    // Communication channels
    api_rx: mpsc::Receiver<Vertex>,        // From API server
    consensus_tx: mpsc::Sender<Message>,   // To consensus engine

    // Lifecycle management
    shutdown_tx: mpsc::Sender<()>,
    shutdown_rx: mpsc::Receiver<()>,
}

impl ConsensusNode {
    /// Create new consensus node
    pub async fn new(config: Config) -> Result<Self, NodeError> {
        // 1. Initialize crypto
        let keypair = load_or_generate_keypair(&config.crypto.key_path)?;
        let node_id = NodeId::from_public_key(&keypair.public);

        // 2. Initialize storage
        let storage = Arc::new(RocksDbStorage::new(
            &config.storage.path,
            config.storage.into()
        )?);

        // 3. Initialize network
        let network = Arc::new(QuicTransport::new(
            node_id.clone(),
            config.network.clone(),
            keypair.clone()
        ).await?);

        // 4. Initialize consensus
        let consensus = Arc::new(BftEngine::new(
            node_id.clone(),
            config.consensus.clone(),
            storage.clone(),
            network.clone()
        )?);

        // 5. Initialize metrics
        let metrics = Arc::new(MetricsRegistry::new(node_id.clone()));

        // 6. Create communication channels
        let (api_tx, api_rx) = mpsc::channel(1000);
        let (consensus_tx, consensus_rx) = mpsc::channel(10000);
        let (shutdown_tx, shutdown_rx) = mpsc::channel(1);

        Ok(Self {
            config,
            node_id,
            consensus,
            network,
            storage,
            metrics,
            api_rx,
            consensus_tx,
            shutdown_tx,
            shutdown_rx,
        })
    }

    /// Start node (blocking)
    pub async fn start(&mut self) -> Result<(), NodeError> {
        tracing::info!("Starting CretoAI consensus node: {}", self.node_id);

        // 1. Connect to bootstrap peers
        self.bootstrap().await?;

        // 2. Start metrics server
        let metrics_server = self.metrics.start_server(self.config.metrics.port);

        // 3. Start API server (optional)
        let api_server = if self.config.api.http_enabled {
            Some(self.start_api_server().await?)
        } else {
            None
        };

        // 4. Start consensus engine
        let consensus_task = tokio::spawn({
            let consensus = self.consensus.clone();
            async move { consensus.run().await }
        });

        // 5. Main event loop
        self.run_event_loop().await?;

        // 6. Graceful shutdown
        tracing::info!("Shutting down node...");
        consensus_task.abort();
        if let Some(server) = api_server {
            server.abort();
        }
        metrics_server.abort();

        Ok(())
    }

    /// Main event loop
    async fn run_event_loop(&mut self) -> Result<(), NodeError> {
        let finality_timer = tokio::time::interval(
            Duration::from_millis(self.config.consensus.finality_timeout_ms)
        );
        let metrics_timer = tokio::time::interval(Duration::from_secs(15));

        loop {
            tokio::select! {
                // Incoming vertex from API
                Some(vertex) = self.api_rx.recv() => {
                    self.handle_new_vertex(vertex).await?;
                }

                // Incoming BFT message
                Some((peer, msg)) = self.network.recv_message() => {
                    self.consensus.handle_message(peer, msg).await?;
                }

                // Finality timeout
                _ = finality_timer.tick() => {
                    self.consensus.check_finality().await?;
                }

                // New peer discovered
                Some(peer) = self.network.discovered_peer() => {
                    self.connect_peer(peer).await?;
                }

                // Metrics export
                _ = metrics_timer.tick() => {
                    self.export_metrics().await?;
                }

                // Shutdown signal
                _ = self.shutdown_rx.recv() => {
                    break;
                }
            }
        }

        Ok(())
    }

    /// Handle new vertex from API
    async fn handle_new_vertex(&self, vertex: Vertex) -> Result<(), NodeError> {
        // 1. Validate vertex
        vertex.validate()?;

        // 2. Propose to consensus
        self.consensus.propose_vertex(vertex).await?;

        // 3. Update metrics
        self.metrics.vertices_proposed.inc();

        Ok(())
    }

    /// Bootstrap: connect to initial peers
    async fn bootstrap(&mut self) -> Result<(), NodeError> {
        for peer_addr in &self.config.network.bootstrap_peers {
            match self.network.connect_peer(peer_addr).await {
                Ok(_) => tracing::info!("Connected to bootstrap peer: {}", peer_addr),
                Err(e) => tracing::warn!("Failed to connect to {}: {}", peer_addr, e),
            }
        }

        // Start peer discovery
        self.network.start_discovery().await?;

        Ok(())
    }

    /// Export Prometheus metrics
    async fn export_metrics(&self) -> Result<(), NodeError> {
        // Consensus metrics
        let finalized = self.storage.finalized_count().await?;
        self.metrics.vertices_finalized.set(finalized as i64);

        // Network metrics
        let peer_count = self.network.peer_count().await;
        self.metrics.peers_connected.set(peer_count as i64);

        // Storage metrics
        let dag_size = self.storage.dag_size().await?;
        self.metrics.dag_vertices.set(dag_size.vertices as i64);
        self.metrics.dag_edges.set(dag_size.edges as i64);

        Ok(())
    }
}
```

---

### 3. `consensus/bft.rs` - BFT Engine

```rust
//! Byzantine Fault Tolerant consensus engine
//!
//! Implements Practical Byzantine Fault Tolerance (PBFT) with optimizations.

use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use crate::{
    consensus::{PhaseCoordinator, MessageLog, ViewChange, ByzantineDetector},
    storage::Storage,
    network::Network,
};

/// BFT consensus engine
pub struct BftEngine {
    node_id: NodeId,
    view: Arc<AtomicU64>,
    sequence: Arc<AtomicU64>,

    // State management
    state: Arc<RwLock<ConsensusState>>,
    message_log: Arc<RwLock<MessageLog>>,

    // Subsystems
    phase_coordinator: PhaseCoordinator,
    view_change: ViewChange,
    byzantine_detector: ByzantineDetector,

    // Storage & Network
    storage: Arc<dyn Storage>,
    network: Arc<dyn Network>,

    // Configuration
    quorum_threshold: f64,
    finality_timeout: Duration,
}

impl BftEngine {
    pub fn new(
        node_id: NodeId,
        config: ConsensusConfig,
        storage: Arc<dyn Storage>,
        network: Arc<dyn Network>,
    ) -> Result<Self, ConsensusError> {
        let view = Arc::new(AtomicU64::new(0));
        let sequence = Arc::new(AtomicU64::new(
            storage.last_finalized_sequence()?
        ));

        let state = Arc::new(RwLock::new(ConsensusState::default()));
        let message_log = Arc::new(RwLock::new(MessageLog::new()));

        let phase_coordinator = PhaseCoordinator::new(
            node_id.clone(),
            view.clone(),
            sequence.clone(),
            storage.clone(),
            network.clone(),
        );

        let view_change = ViewChange::new(
            node_id.clone(),
            view.clone(),
            config.view_change_timeout,
        );

        let byzantine_detector = ByzantineDetector::new(
            node_id.clone(),
            config.reputation_threshold,
        );

        Ok(Self {
            node_id,
            view,
            sequence,
            state,
            message_log,
            phase_coordinator,
            view_change,
            byzantine_detector,
            storage,
            network,
            quorum_threshold: config.quorum_threshold,
            finality_timeout: Duration::from_millis(config.finality_timeout_ms),
        })
    }

    /// Main consensus loop
    pub async fn run(&self) -> Result<(), ConsensusError> {
        loop {
            tokio::select! {
                // Incoming BFT message
                Some((peer, msg)) = self.network.recv_message() => {
                    self.handle_message(peer, msg).await?;
                }

                // View change timeout
                _ = self.view_change.timeout() => {
                    self.initiate_view_change().await?;
                }

                // Byzantine detection check
                _ = self.byzantine_detector.check_interval() => {
                    self.check_byzantine().await?;
                }
            }
        }
    }

    /// Propose new vertex (leader only)
    pub async fn propose_vertex(&self, vertex: Vertex) -> Result<(), ConsensusError> {
        if !self.is_leader() {
            return Err(ConsensusError::NotLeader);
        }

        let seq = self.sequence.fetch_add(1, Ordering::SeqCst);

        // Phase 1: Pre-Prepare
        self.phase_coordinator.pre_prepare(vertex, seq).await?;

        Ok(())
    }

    /// Handle incoming BFT message
    pub async fn handle_message(
        &self,
        peer: NodeId,
        msg: Message,
    ) -> Result<(), ConsensusError> {
        // 1. Byzantine detection
        if self.byzantine_detector.detect(&msg).await {
            tracing::warn!("Byzantine behavior detected from {}", peer);
            self.byzantine_detector.ban(peer).await;
            return Ok(());
        }

        // 2. Add to message log
        self.message_log.write().await.add(msg.clone());

        // 3. Process based on message type
        match msg {
            Message::PrePrepare(pp) => {
                self.phase_coordinator.handle_pre_prepare(pp).await?;
            }
            Message::Prepare(p) => {
                self.phase_coordinator.handle_prepare(p).await?;
            }
            Message::Commit(c) => {
                self.phase_coordinator.handle_commit(c).await?;
            }
            Message::ViewChange(vc) => {
                self.view_change.handle(vc).await?;
            }
        }

        Ok(())
    }

    /// Check if node is current leader
    fn is_leader(&self) -> bool {
        let view = self.view.load(Ordering::SeqCst);
        let leader_index = view % self.total_nodes();
        leader_index == self.node_index()
    }

    /// Initiate view change (leader failure)
    async fn initiate_view_change(&self) -> Result<(), ConsensusError> {
        tracing::warn!("Initiating view change (leader timeout)");

        let new_view = self.view.fetch_add(1, Ordering::SeqCst) + 1;

        self.view_change.initiate(new_view).await?;

        Ok(())
    }

    /// Check for Byzantine behavior
    async fn check_byzantine(&self) -> Result<(), ConsensusError> {
        let violations = self.byzantine_detector.check_violations().await?;

        for (node, violations) in violations {
            tracing::warn!("Node {} has {} violations", node, violations.len());

            if violations.len() > 5 {
                self.byzantine_detector.ban(node).await;
            }
        }

        Ok(())
    }
}
```

---

### 4. `consensus/phase_coordinator.rs` - PBFT Phase Transitions

```rust
//! PBFT phase coordinator (Pre-Prepare → Prepare → Commit → Execute)

use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};

/// Coordinates BFT consensus phases
pub struct PhaseCoordinator {
    node_id: NodeId,
    view: Arc<AtomicU64>,
    sequence: Arc<AtomicU64>,

    // Pending proposals
    pending: Arc<RwLock<HashMap<u64, PendingProposal>>>,

    // Quorum tracking
    prepare_votes: Arc<RwLock<HashMap<u64, HashSet<NodeId>>>>,
    commit_votes: Arc<RwLock<HashMap<u64, HashSet<NodeId>>>>,

    storage: Arc<dyn Storage>,
    network: Arc<dyn Network>,

    quorum_size: usize,
}

impl PhaseCoordinator {
    /// Phase 1: Pre-Prepare (leader broadcasts proposal)
    pub async fn pre_prepare(
        &self,
        vertex: Vertex,
        sequence: u64,
    ) -> Result<(), ConsensusError> {
        let view = self.view.load(Ordering::SeqCst);

        // Create pre-prepare message
        let pre_prepare = PrePrepare {
            view,
            sequence,
            vertex: vertex.clone(),
            signature: self.sign_vertex(&vertex)?,
        };

        // Broadcast to all replicas
        self.network.broadcast(Message::PrePrepare(pre_prepare)).await?;

        // Store pending proposal
        let mut pending = self.pending.write().await;
        pending.insert(sequence, PendingProposal {
            vertex,
            timestamp: Instant::now(),
        });

        Ok(())
    }

    /// Phase 2: Prepare (replicas validate and vote)
    pub async fn handle_pre_prepare(
        &self,
        pre_prepare: PrePrepare,
    ) -> Result<(), ConsensusError> {
        // 1. Validate pre-prepare
        self.validate_pre_prepare(&pre_prepare).await?;

        // 2. Send prepare message
        let prepare = Prepare {
            view: pre_prepare.view,
            sequence: pre_prepare.sequence,
            vertex_hash: pre_prepare.vertex.hash(),
            node_id: self.node_id.clone(),
            signature: self.sign_vertex(&pre_prepare.vertex)?,
        };

        self.network.broadcast(Message::Prepare(prepare.clone())).await?;

        // 3. Add own prepare vote
        self.add_prepare_vote(prepare.sequence, self.node_id.clone()).await;

        Ok(())
    }

    /// Phase 2: Prepare (collect votes)
    pub async fn handle_prepare(
        &self,
        prepare: Prepare,
    ) -> Result<(), ConsensusError> {
        // Add prepare vote
        self.add_prepare_vote(prepare.sequence, prepare.node_id).await;

        // Check if we have quorum (2f+1 prepares)
        if self.has_prepare_quorum(prepare.sequence).await {
            self.on_prepared(prepare.sequence).await?;
        }

        Ok(())
    }

    /// Phase 3: Commit (send commit message)
    async fn on_prepared(&self, sequence: u64) -> Result<(), ConsensusError> {
        let view = self.view.load(Ordering::SeqCst);

        let commit = Commit {
            view,
            sequence,
            node_id: self.node_id.clone(),
            signature: self.sign_commit(sequence)?,
        };

        self.network.broadcast(Message::Commit(commit.clone())).await?;

        // Add own commit vote
        self.add_commit_vote(sequence, self.node_id.clone()).await;

        Ok(())
    }

    /// Phase 3: Commit (collect votes)
    pub async fn handle_commit(
        &self,
        commit: Commit,
    ) -> Result<(), ConsensusError> {
        // Add commit vote
        self.add_commit_vote(commit.sequence, commit.node_id).await;

        // Check if we have quorum (2f+1 commits)
        if self.has_commit_quorum(commit.sequence).await {
            self.on_committed(commit.sequence).await?;
        }

        Ok(())
    }

    /// Phase 4: Execute (finalize vertex)
    async fn on_committed(&self, sequence: u64) -> Result<(), ConsensusError> {
        // 1. Get pending proposal
        let vertex = {
            let pending = self.pending.read().await;
            pending.get(&sequence)
                .ok_or(ConsensusError::ProposalNotFound)?
                .vertex.clone()
        };

        // 2. Persist to storage
        self.storage.store_finalized(&vertex, sequence).await?;

        // 3. Remove from pending
        self.pending.write().await.remove(&sequence);

        // 4. Update metrics
        tracing::info!("Vertex finalized: {} (sequence: {})", vertex.hash(), sequence);

        Ok(())
    }

    /// Check if we have prepare quorum
    async fn has_prepare_quorum(&self, sequence: u64) -> bool {
        let votes = self.prepare_votes.read().await;
        votes.get(&sequence)
            .map(|v| v.len() >= self.quorum_size)
            .unwrap_or(false)
    }

    /// Check if we have commit quorum
    async fn has_commit_quorum(&self, sequence: u64) -> bool {
        let votes = self.commit_votes.read().await;
        votes.get(&sequence)
            .map(|v| v.len() >= self.quorum_size)
            .unwrap_or(false)
    }
}
```

---

### 5. `network/quic_transport.rs` - QUIC Transport

```rust
//! QUIC-based P2P transport

use quinn::{Endpoint, ServerConfig, ClientConfig, Connection};
use rustls::{Certificate, PrivateKey};

/// QUIC transport layer
pub struct QuicTransport {
    node_id: NodeId,
    endpoint: Endpoint,

    // Peer management
    peers: Arc<RwLock<HashMap<NodeId, PeerConnection>>>,
    peer_discovery: PeerDiscovery,
    nat_traversal: NatTraversal,

    // Crypto config
    keypair: Keypair,
    crypto_config: Arc<rustls::ServerConfig>,

    // Message channels
    message_rx: mpsc::Receiver<(NodeId, Message)>,
    message_tx: mpsc::Sender<(NodeId, Message)>,
}

impl QuicTransport {
    /// Bind QUIC endpoint
    pub async fn bind_and_listen(
        &mut self,
        addr: SocketAddr,
    ) -> Result<(), NetworkError> {
        // 1. Configure TLS with quantum-resistant ciphers
        let server_config = self.create_server_config()?;

        // 2. Bind QUIC endpoint
        self.endpoint = Endpoint::server(server_config, addr)?;

        tracing::info!("QUIC transport listening on {}", addr);

        // 3. Start accepting connections
        tokio::spawn({
            let endpoint = self.endpoint.clone();
            let peers = self.peers.clone();
            let message_tx = self.message_tx.clone();

            async move {
                while let Some(incoming) = endpoint.accept().await {
                    let conn = incoming.await?;
                    let peer_id = extract_peer_id(&conn)?;

                    // Add to peer map
                    peers.write().await.insert(peer_id.clone(), PeerConnection {
                        connection: conn.clone(),
                        established: Instant::now(),
                    });

                    // Handle incoming streams
                    tokio::spawn(handle_connection(conn, peer_id, message_tx.clone()));
                }
            }
        });

        Ok(())
    }

    /// Connect to peer
    pub async fn connect_peer(
        &mut self,
        peer_addr: SocketAddr,
    ) -> Result<(), NetworkError> {
        let client_config = self.create_client_config()?;

        let conn = self.endpoint
            .connect_with(client_config, peer_addr, "cretoai")?
            .await?;

        let peer_id = extract_peer_id(&conn)?;

        self.peers.write().await.insert(peer_id.clone(), PeerConnection {
            connection: conn,
            established: Instant::now(),
        });

        tracing::info!("Connected to peer: {}", peer_id);

        Ok(())
    }

    /// Broadcast message to all peers
    pub async fn broadcast(&self, msg: Message) -> Result<(), NetworkError> {
        let serialized = bincode::serialize(&msg)?;
        let peers = self.peers.read().await;

        let mut tasks = Vec::new();

        for (peer_id, peer) in peers.iter() {
            let data = serialized.clone();
            let conn = peer.connection.clone();

            tasks.push(tokio::spawn(async move {
                let mut stream = conn.open_uni().await?;
                stream.write_all(&data).await?;
                stream.finish().await?;
                Ok::<_, NetworkError>(())
            }));
        }

        // Wait for all sends to complete
        futures::future::try_join_all(tasks).await?;

        Ok(())
    }

    /// Create TLS server config
    fn create_server_config(&self) -> Result<ServerConfig, NetworkError> {
        let cert = self.load_certificate()?;
        let key = self.load_private_key()?;

        let mut config = rustls::ServerConfig::builder()
            .with_safe_defaults()
            .with_no_client_auth()
            .with_single_cert(vec![cert], key)?;

        // Enable 0-RTT
        config.max_early_data_size = 16384;
        config.alpn_protocols = vec![b"cretoai/1.0".to_vec()];

        Ok(ServerConfig::with_crypto(Arc::new(config)))
    }
}
```

---

### 6. `storage/rocksdb.rs` - RocksDB Storage

```rust
//! RocksDB storage backend

use rocksdb::{DB, Options, ColumnFamilyDescriptor, WriteBatch};

/// RocksDB storage implementation
pub struct RocksDbStorage {
    db: Arc<DB>,
    metrics: StorageMetrics,
}

impl RocksDbStorage {
    pub fn new(path: &Path, config: StorageConfig) -> Result<Self, StorageError> {
        let mut opts = Options::default();
        opts.create_if_missing(true);
        opts.create_missing_column_families(true);
        opts.set_max_open_files(config.max_open_files);
        opts.set_write_buffer_size(config.write_buffer_size);
        opts.set_compression_type(rocksdb::DBCompressionType::Snappy);

        // Define column families
        let cfs = vec![
            ColumnFamilyDescriptor::new("vertices", opts.clone()),
            ColumnFamilyDescriptor::new("edges", opts.clone()),
            ColumnFamilyDescriptor::new("metadata", opts.clone()),
            ColumnFamilyDescriptor::new("index_height", opts.clone()),
            ColumnFamilyDescriptor::new("index_timestamp", opts.clone()),
            ColumnFamilyDescriptor::new("finalized", opts.clone()),
        ];

        let db = DB::open_cf_descriptors(&opts, path, cfs)?;

        Ok(Self {
            db: Arc::new(db),
            metrics: StorageMetrics::new(),
        })
    }

    /// Store vertex
    pub fn store_vertex(
        &self,
        vertex: &Vertex,
        signature: &Signature,
    ) -> Result<(), StorageError> {
        let cf_vertices = self.db.cf_handle("vertices").unwrap();
        let cf_metadata = self.db.cf_handle("metadata").unwrap();

        let hash = vertex.hash();
        let vertex_bytes = bincode::serialize(vertex)?;

        // Create write batch (atomic)
        let mut batch = WriteBatch::default();

        // Write vertex
        batch.put_cf(cf_vertices, hash.as_bytes(), &vertex_bytes);

        // Write metadata
        let metadata = VertexMetadata {
            hash: hash.clone(),
            height: vertex.height,
            timestamp: vertex.timestamp,
            signature: signature.clone(),
            finalized: false,
        };
        batch.put_cf(cf_metadata, hash.as_bytes(), bincode::serialize(&metadata)?);

        // Commit batch
        self.db.write(batch)?;

        self.metrics.vertices_stored.inc();

        Ok(())
    }

    /// Mark vertex as finalized
    pub fn mark_finalized(
        &self,
        hash: &VertexHash,
        sequence: u64,
    ) -> Result<(), StorageError> {
        let cf_metadata = self.db.cf_handle("metadata").unwrap();
        let cf_finalized = self.db.cf_handle("finalized").unwrap();

        // Update metadata
        let metadata_bytes = self.db.get_cf(cf_metadata, hash.as_bytes())?
            .ok_or(StorageError::VertexNotFound)?;
        let mut metadata: VertexMetadata = bincode::deserialize(&metadata_bytes)?;
        metadata.finalized = true;

        let mut batch = WriteBatch::default();
        batch.put_cf(cf_metadata, hash.as_bytes(), bincode::serialize(&metadata)?);
        batch.put_cf(cf_finalized, &sequence.to_le_bytes(), hash.as_bytes());

        self.db.write(batch)?;

        self.metrics.vertices_finalized.inc();

        Ok(())
    }
}
```

---

## Dependency Graph

```
┌─────────────────────────────────────────────────────────────────┐
│                     Dependency Hierarchy                         │
└─────────────────────────────────────────────────────────────────┘

main.rs
  └─► node.rs (ConsensusNode)
       ├─► consensus/bft.rs (BftEngine)
       │    ├─► consensus/phase_coordinator.rs
       │    ├─► consensus/message_log.rs
       │    ├─► consensus/view_change.rs
       │    └─► consensus/byzantine.rs
       │
       ├─► network/quic_transport.rs (QuicTransport)
       │    ├─► network/connection.rs
       │    ├─► network/peer_discovery.rs
       │    └─► network/nat_traversal.rs
       │
       ├─► storage/rocksdb.rs (RocksDbStorage)
       │    ├─► storage/schema.rs
       │    └─► storage/backup.rs
       │
       ├─► crypto/verifier.rs
       │    └─► ../crypto (Phase 5 crate)
       │
       ├─► metrics/registry.rs
       │    └─► metrics/exporter.rs
       │
       └─► api/http.rs (optional)
            ├─► api/websocket.rs
            └─► api/handlers.rs
```

---

## Testing Strategy

### Unit Tests

```rust
// src/consensus/tests.rs
#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn test_pre_prepare_broadcast() {
        // Test leader broadcasts pre-prepare
    }

    #[tokio::test]
    async fn test_prepare_quorum() {
        // Test 2f+1 prepare votes collected
    }

    #[tokio::test]
    async fn test_commit_quorum() {
        // Test 2f+1 commit votes collected
    }

    #[tokio::test]
    async fn test_byzantine_detection() {
        // Test equivocation detection
    }
}
```

### Integration Tests

```rust
// tests/three_node_cluster.rs
#[tokio::test]
async fn test_three_node_consensus() {
    // 1. Start 3 nodes
    let node1 = ConsensusNode::new(config1).await?;
    let node2 = ConsensusNode::new(config2).await?;
    let node3 = ConsensusNode::new(config3).await?;

    // 2. Connect nodes
    node1.connect_peer(node2.addr()).await?;
    node1.connect_peer(node3.addr()).await?;

    // 3. Propose vertex
    let vertex = Vertex::new(b"test data");
    node1.propose(vertex).await?;

    // 4. Wait for finality
    tokio::time::sleep(Duration::from_millis(500)).await;

    // 5. Verify all nodes finalized
    assert!(node1.is_finalized(&vertex.hash()).await);
    assert!(node2.is_finalized(&vertex.hash()).await);
    assert!(node3.is_finalized(&vertex.hash()).await);
}
```

---

## Implementation Phases

### Phase 1: Core Structure (Week 1)
- [ ] Create `src/node/` crate with Cargo.toml
- [ ] Implement `main.rs` CLI with clap
- [ ] Implement `node.rs` ConsensusNode skeleton
- [ ] Implement `config.rs` TOML parsing
- [ ] Basic integration test (single node)

### Phase 2: Consensus Engine (Week 1-2)
- [ ] Implement `consensus/bft.rs` BftEngine
- [ ] Implement `consensus/phase_coordinator.rs`
- [ ] Implement `consensus/message_log.rs`
- [ ] Implement `consensus/view_change.rs`
- [ ] Implement `consensus/byzantine.rs`
- [ ] Unit tests for each module

### Phase 3: Network Layer (Week 2)
- [ ] Implement `network/quic_transport.rs`
- [ ] Implement `network/connection.rs`
- [ ] Implement `network/peer_discovery.rs`
- [ ] Implement `network/nat_traversal.rs`
- [ ] Integration test (2-node connection)

### Phase 4: Storage Layer (Week 2-3)
- [ ] Implement `storage/rocksdb.rs`
- [ ] Implement `storage/schema.rs`
- [ ] Implement `storage/backup.rs`
- [ ] Performance benchmarks

### Phase 5: Integration (Week 3)
- [ ] Connect all subsystems in `node.rs`
- [ ] Implement metrics export
- [ ] Implement API server (optional)
- [ ] 3-node integration test

### Phase 6: Testing & Hardening (Week 4)
- [ ] Byzantine failure tests
- [ ] Network partition tests
- [ ] Crash recovery tests
- [ ] Performance benchmarks
- [ ] Kubernetes deployment

---

## Performance Targets

| Component | Metric | Target |
|-----------|--------|--------|
| Consensus | Finality time (p99) | <500ms |
| Network | QUIC latency (p99) | <50ms |
| Storage | Write latency (p99) | <10ms |
| Memory | Per-node usage | <2 GB |
| CPU | Per-node usage | <1 core |

---

## Next Steps

1. **Create Cargo.toml** for `cretoai-node` crate
2. **Implement `main.rs`** with CLI framework
3. **Scaffold module structure** (consensus/, network/, storage/)
4. **Begin Phase 1 implementation** (Week 1)

---

**Status**: ✅ Design Complete
**Ready for**: Implementation (Week 1 starts)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
