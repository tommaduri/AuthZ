# Phase 6: Enhanced Consensus & Technical Enhancements

**Status**: Planning
**Duration**: 3-4 weeks (Sprint 2)
**Priority**: P1 (Technical Foundation)
**Depends On**: Phase 5 Complete ✅

---

## Executive Summary

Phase 6 transforms CretoAI from a customer demo platform (Phase 5: 60% ready) to a **production-ready distributed system** (Target: 90%+ ready). We're implementing the deferred technical enhancements that enable real-world deployment.

**Key Deliverables**:
1. ✅ **Consensus Node Binary** - Enable distributed DAG consensus
2. ✅ **Byzantine Fault Tolerance** - Withstand 33% malicious nodes
3. ✅ **QUIC-based Networking** - Low-latency P2P transport
4. ✅ **DAG Persistence** - RocksDB storage layer
5. ✅ **Production Hardening** - Kubernetes, monitoring, backup

---

## Phase 6 Goals

### Primary Objectives

| Goal | Metric | Target | Current |
|------|--------|--------|---------|
| **Distributed Consensus** | 3-node cluster | Working | Simulated |
| **Fault Tolerance** | Byzantine nodes | 33% (1/3) | 0% |
| **Finality Time** | Sub-second | <500ms | 177ms (simulated) |
| **Persistence** | DAG storage | RocksDB | In-memory |
| **Network Transport** | QUIC latency | <50ms p99 | N/A |
| **Production Ready** | Deployment | Kubernetes | Docker only |

### Success Criteria

- ✅ **3-node consensus cluster** running in Docker
- ✅ **1 Byzantine node** tolerated without data loss
- ✅ **<500ms finality** with BFT consensus
- ✅ **Persistent DAG** survives node restarts
- ✅ **QUIC transport** with <50ms p99 latency
- ✅ **Kubernetes manifests** for production deployment
- ✅ **Prometheus metrics** + Grafana dashboards
- ✅ **Automated backup/restore** procedures

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Phase 6 Architecture                     │
└─────────────────────────────────────────────────────────────┘

┌───────────────┐      QUIC/TLS 1.3       ┌───────────────┐
│  Node 1       │◄────────────────────────►│  Node 2       │
│  (Leader)     │      Encrypted P2P       │  (Follower)   │
│               │                          │               │
│ ┌───────────┐ │                          │ ┌───────────┐ │
│ │ Consensus │ │      Byzantine Fault     │ │ Consensus │ │
│ │  Engine   │ │◄─────  Tolerance  ──────►│ │  Engine   │ │
│ │  (BFT)    │ │                          │ │  (BFT)    │ │
│ └───────────┘ │                          │ └───────────┘ │
│       │       │                          │       │       │
│       ▼       │                          │       ▼       │
│ ┌───────────┐ │                          │ ┌───────────┐ │
│ │  RocksDB  │ │      Leader Election     │ │  RocksDB  │ │
│ │   (DAG)   │ │◄─────  (Raft-based)  ───►│ │   (DAG)   │ │
│ └───────────┘ │                          │ └───────────┘ │
└───────────────┘                          └───────────────┘
        │                                          │
        │              QUIC Transport              │
        │◄────────────────────────────────────────►│
        │                                          │
        ▼                                          ▼
┌───────────────┐                          ┌───────────────┐
│  Node 3       │                          │  REST API     │
│  (Follower)   │                          │  (Phase 5)    │
│               │                          │               │
│ ┌───────────┐ │      Query Interface     │ ┌───────────┐ │
│ │ Consensus │ │◄────────────────────────►│ │  Axum     │ │
│ │  Engine   │ │                          │ │  Server   │ │
│ └───────────┘ │                          │ └───────────┘ │
│       │       │                          │               │
│       ▼       │                          │  Swagger UI   │
│ ┌───────────┐ │                          │  (Phase 5)    │
│ │  RocksDB  │ │                          └───────────────┘
│ │   (DAG)   │ │
│ └───────────┘ │
└───────────────┘
```

---

## Technical Specifications

### 1. Consensus Node Binary (`cretoai-node`)

**Location**: `src/node/src/main.rs`

**Responsibilities**:
- DAG vertex creation and validation
- Byzantine Fault Tolerant consensus
- QUIC-based P2P communication
- Persistent storage (RocksDB)
- Leader election (Raft-based)
- Metric collection (Prometheus)

**Architecture**:
```rust
// src/node/src/main.rs
struct ConsensusNode {
    node_id: NodeId,
    consensus_engine: BftEngine,
    network: QuicTransport,
    storage: DagStorage<RocksDB>,
    metrics: PrometheusRegistry,
}

impl ConsensusNode {
    async fn start(&mut self) -> Result<()> {
        // 1. Initialize RocksDB storage
        self.storage.initialize()?;

        // 2. Start QUIC transport
        self.network.bind_and_listen().await?;

        // 3. Bootstrap or join cluster
        self.bootstrap_cluster().await?;

        // 4. Start BFT consensus loop
        self.consensus_engine.run().await?;

        // 5. Start metrics server
        self.metrics.serve().await?;

        Ok(())
    }

    async fn create_vertex(&mut self, data: Vec<u8>) -> Result<VertexHash> {
        // 1. Create vertex with BLAKE3 hash
        let vertex = Vertex::new(data, self.get_parent_hashes());

        // 2. Sign with ML-DSA-87
        let signature = self.sign_vertex(&vertex)?;

        // 3. Propose to BFT consensus
        let (commit_tx, commit_rx) = oneshot::channel();
        self.consensus_engine.propose(vertex.clone(), commit_tx).await?;

        // 4. Wait for quorum (2f+1 signatures)
        commit_rx.await?;

        // 5. Persist to RocksDB
        self.storage.store_vertex(&vertex, &signature)?;

        // 6. Broadcast to peers via QUIC
        self.network.broadcast_vertex(vertex.clone()).await?;

        Ok(vertex.hash)
    }
}
```

**Configuration** (`config/node.toml`):
```toml
[node]
id = "node-1"
data_dir = "/data"
log_level = "info"

[consensus]
algorithm = "bft"
quorum_threshold = 0.67  # 2f+1 for f Byzantine nodes
finality_timeout_ms = 500
max_pending_vertices = 10000

[network]
listen_addr = "0.0.0.0:9000"
quic_port = 9001
bootstrap_peers = [
    "/ip4/172.21.0.11/udp/9001/quic",
    "/ip4/172.21.0.12/udp/9001/quic"
]

[storage]
backend = "rocksdb"
path = "/data/db"
cache_size_mb = 512
write_buffer_mb = 128

[crypto]
signature_algorithm = "ml-dsa-87"
hash_algorithm = "blake3"
key_path = "/data/keys"

[metrics]
enabled = true
port = 9090
endpoint = "/metrics"
```

---

### 2. Byzantine Fault Tolerance (BFT)

**Location**: `src/consensus/src/bft.rs`

**Algorithm**: PBFT (Practical Byzantine Fault Tolerance) with optimizations

**Phases**:
1. **Pre-Prepare**: Leader proposes vertex
2. **Prepare**: Nodes validate and broadcast prepare messages
3. **Commit**: After 2f+1 prepares, nodes broadcast commit
4. **Execute**: After 2f+1 commits, vertex is finalized

**Implementation**:
```rust
// src/consensus/src/bft.rs
pub struct BftEngine {
    node_id: NodeId,
    view: AtomicU64,
    sequence: AtomicU64,
    state: Arc<RwLock<ConsensusState>>,
    message_log: Arc<RwLock<MessageLog>>,
    quorum_threshold: f64,
}

impl BftEngine {
    pub async fn propose(&self, vertex: Vertex) -> Result<()> {
        // Only leader proposes
        if !self.is_leader() {
            return Err(Error::NotLeader);
        }

        let seq = self.sequence.fetch_add(1, Ordering::SeqCst);

        // Phase 1: Pre-Prepare
        let pre_prepare = PrePrepare {
            view: self.view.load(Ordering::SeqCst),
            sequence: seq,
            vertex: vertex.clone(),
            signature: self.sign(&vertex)?,
        };

        self.broadcast(Message::PrePrepare(pre_prepare)).await?;

        Ok(())
    }

    pub async fn handle_pre_prepare(&self, msg: PrePrepare) -> Result<()> {
        // Validate pre-prepare
        self.validate_pre_prepare(&msg)?;

        // Phase 2: Prepare
        let prepare = Prepare {
            view: msg.view,
            sequence: msg.sequence,
            vertex_hash: msg.vertex.hash(),
            node_id: self.node_id,
            signature: self.sign(&msg.vertex)?,
        };

        self.broadcast(Message::Prepare(prepare)).await?;
        self.message_log.write().await.add_prepare(prepare.clone());

        // Check if we have 2f+1 prepares (quorum)
        if self.has_quorum_prepares(msg.sequence).await? {
            self.handle_prepared(msg.sequence).await?;
        }

        Ok(())
    }

    pub async fn handle_prepared(&self, sequence: u64) -> Result<()> {
        // Phase 3: Commit
        let commit = Commit {
            view: self.view.load(Ordering::SeqCst),
            sequence,
            node_id: self.node_id,
            signature: self.sign_commit(sequence)?,
        };

        self.broadcast(Message::Commit(commit)).await?;
        self.message_log.write().await.add_commit(commit.clone());

        // Check if we have 2f+1 commits
        if self.has_quorum_commits(sequence).await? {
            self.handle_committed(sequence).await?;
        }

        Ok(())
    }

    pub async fn handle_committed(&self, sequence: u64) -> Result<()> {
        // Phase 4: Execute
        let vertex = self.get_vertex(sequence).await?;

        // Persist to storage
        self.storage.write().await.store_vertex(&vertex)?;

        // Update metrics
        self.metrics.vertices_finalized.inc();
        self.metrics.finality_time.observe(
            vertex.timestamp.elapsed().as_millis() as f64
        );

        Ok(())
    }

    fn has_quorum_prepares(&self, seq: u64) -> bool {
        let prepares = self.message_log.read().get_prepares(seq);
        prepares.len() >= self.quorum_size()
    }

    fn quorum_size(&self) -> usize {
        // 2f+1 for f Byzantine nodes
        let n = self.total_nodes();
        let f = (n - 1) / 3;  // Max Byzantine nodes
        2 * f + 1
    }
}
```

**Byzantine Detection**:
```rust
// src/consensus/src/byzantine_detection.rs
pub struct ByzantineDetector {
    reputation_scores: HashMap<NodeId, f64>,
    violation_log: Vec<Violation>,
}

impl ByzantineDetector {
    pub fn detect_equivocation(&mut self, msg1: &Message, msg2: &Message) -> bool {
        // Two conflicting messages with same (view, sequence) from same node
        if msg1.view == msg2.view &&
           msg1.sequence == msg2.sequence &&
           msg1.node_id == msg2.node_id &&
           msg1.vertex_hash != msg2.vertex_hash {

            self.record_violation(Violation::Equivocation {
                node_id: msg1.node_id,
                view: msg1.view,
                sequence: msg1.sequence,
            });

            return true;
        }
        false
    }

    pub fn detect_invalid_signature(&mut self, msg: &Message) -> bool {
        if !self.verify_signature(msg) {
            self.record_violation(Violation::InvalidSignature {
                node_id: msg.node_id,
            });
            return true;
        }
        false
    }

    pub fn update_reputation(&mut self, node_id: NodeId) {
        let violations = self.get_violations(node_id);
        let score = 1.0 - (violations.len() as f64 * 0.1);
        self.reputation_scores.insert(node_id, score.max(0.0));

        // Ban nodes with reputation < 0.3
        if score < 0.3 {
            self.ban_node(node_id);
        }
    }
}
```

---

### 3. QUIC-based P2P Networking

**Location**: `src/network/src/quic_transport.rs`

**Features**:
- TLS 1.3 encryption with quantum-resistant handshake
- 0-RTT connection establishment
- Stream multiplexing (100+ concurrent streams)
- NAT traversal (STUN/TURN)
- Peer discovery (mDNS + DHT)

**Implementation**:
```rust
// src/network/src/quic_transport.rs
use quinn::{Endpoint, ServerConfig, ClientConfig};
use rustls::Certificate;

pub struct QuicTransport {
    endpoint: Endpoint,
    peers: Arc<RwLock<HashMap<NodeId, Connection>>>,
    peer_discovery: PeerDiscovery,
}

impl QuicTransport {
    pub async fn bind_and_listen(&mut self, addr: SocketAddr) -> Result<()> {
        // Configure TLS with quantum-resistant ciphers
        let server_config = ServerConfig::with_crypto(
            Arc::new(self.create_crypto_config()?)
        );

        // Bind QUIC endpoint
        self.endpoint = Endpoint::server(server_config, addr)?;

        // Start accepting connections
        tokio::spawn(async move {
            while let Some(incoming) = self.endpoint.accept().await {
                self.handle_incoming_connection(incoming).await;
            }
        });

        // Start peer discovery
        self.peer_discovery.start().await?;

        Ok(())
    }

    pub async fn connect_peer(&mut self, peer_addr: SocketAddr) -> Result<Connection> {
        let client_config = ClientConfig::with_crypto(
            Arc::new(self.create_crypto_config()?)
        );

        let conn = self.endpoint
            .connect_with(client_config, peer_addr, "cretoai")?
            .await?;

        self.peers.write().await.insert(peer_id, conn.clone());

        Ok(conn)
    }

    pub async fn broadcast_vertex(&self, vertex: Vertex) -> Result<()> {
        let serialized = bincode::serialize(&vertex)?;

        let peers = self.peers.read().await;
        let mut tasks = Vec::new();

        for (peer_id, conn) in peers.iter() {
            let data = serialized.clone();
            let conn = conn.clone();

            tasks.push(tokio::spawn(async move {
                let mut stream = conn.open_uni().await?;
                stream.write_all(&data).await?;
                stream.finish().await?;
                Ok::<_, Error>(())
            }));
        }

        // Wait for all broadcasts to complete
        futures::future::try_join_all(tasks).await?;

        Ok(())
    }

    fn create_crypto_config(&self) -> Result<rustls::ServerConfig> {
        let cert = self.load_certificate()?;
        let key = self.load_private_key()?;

        let mut config = rustls::ServerConfig::builder()
            .with_safe_defaults()
            .with_no_client_auth()
            .with_single_cert(vec![cert], key)?;

        // Add quantum-resistant cipher suites
        config.alpn_protocols = vec![b"cretoai/1.0".to_vec()];

        Ok(config)
    }
}

// Peer Discovery
pub struct PeerDiscovery {
    mdns: MdnsService,
    dht: KademliaDht,
}

impl PeerDiscovery {
    pub async fn discover_peers(&mut self) -> Result<Vec<PeerInfo>> {
        let mut peers = Vec::new();

        // Local network discovery (mDNS)
        peers.extend(self.mdns.discover("_cretoai._udp.local").await?);

        // Wide area discovery (DHT)
        peers.extend(self.dht.find_peers("cretoai").await?);

        Ok(peers)
    }
}
```

**NAT Traversal**:
```rust
// src/network/src/nat_traversal.rs
pub struct NatTraversal {
    stun_servers: Vec<SocketAddr>,
    turn_servers: Vec<TurnConfig>,
}

impl NatTraversal {
    pub async fn get_external_address(&self) -> Result<SocketAddr> {
        // STUN binding request
        for server in &self.stun_servers {
            if let Ok(addr) = self.stun_request(*server).await {
                return Ok(addr);
            }
        }

        Err(Error::StunFailed)
    }

    pub async fn relay_connection(&self, peer: SocketAddr) -> Result<Connection> {
        // TURN relay for symmetric NAT
        for server in &self.turn_servers {
            if let Ok(conn) = self.turn_allocate(server, peer).await {
                return Ok(conn);
            }
        }

        Err(Error::TurnFailed)
    }
}
```

---

### 4. DAG Persistence Layer (RocksDB)

**Location**: `src/dag/src/storage/rocksdb.rs`

**Schema**:
```
Column Families:
1. vertices: hash → Vertex
2. edges: (parent_hash, child_hash) → EdgeMetadata
3. metadata: vertex_hash → VertexMetadata
4. index_height: height → Vec<VertexHash>
5. index_timestamp: timestamp → Vec<VertexHash>
6. finalized: sequence → FinalizedVertex
```

**Implementation**:
```rust
// src/dag/src/storage/rocksdb.rs
use rocksdb::{DB, Options, ColumnFamilyDescriptor};

pub struct RocksDbStorage {
    db: Arc<DB>,
    metrics: StorageMetrics,
}

impl RocksDbStorage {
    pub fn new(path: &Path, config: StorageConfig) -> Result<Self> {
        let mut opts = Options::default();
        opts.create_if_missing(true);
        opts.create_missing_column_families(true);
        opts.set_max_open_files(config.max_open_files);
        opts.set_write_buffer_size(config.write_buffer_size);

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

    pub fn store_vertex(&self, vertex: &Vertex, signature: &Signature) -> Result<()> {
        let cf_vertices = self.db.cf_handle("vertices").unwrap();
        let cf_metadata = self.db.cf_handle("metadata").unwrap();
        let cf_index_height = self.db.cf_handle("index_height").unwrap();

        let hash = vertex.hash();
        let serialized = bincode::serialize(&vertex)?;

        // Write vertex
        self.db.put_cf(cf_vertices, hash.as_bytes(), &serialized)?;

        // Write metadata
        let metadata = VertexMetadata {
            hash: hash.clone(),
            height: vertex.height,
            timestamp: vertex.timestamp,
            signature: signature.clone(),
            finalized: false,
        };
        self.db.put_cf(cf_metadata, hash.as_bytes(), bincode::serialize(&metadata)?)?;

        // Update height index
        let mut height_vertices = self.get_vertices_at_height(vertex.height)?;
        height_vertices.push(hash.clone());
        self.db.put_cf(
            cf_index_height,
            &vertex.height.to_le_bytes(),
            bincode::serialize(&height_vertices)?
        )?;

        self.metrics.vertices_stored.inc();
        Ok(())
    }

    pub fn get_vertex(&self, hash: &VertexHash) -> Result<Option<Vertex>> {
        let cf = self.db.cf_handle("vertices").unwrap();

        match self.db.get_cf(cf, hash.as_bytes())? {
            Some(bytes) => {
                let vertex = bincode::deserialize(&bytes)?;
                self.metrics.vertices_read.inc();
                Ok(Some(vertex))
            }
            None => Ok(None),
        }
    }

    pub fn mark_finalized(&self, hash: &VertexHash, sequence: u64) -> Result<()> {
        let cf_metadata = self.db.cf_handle("metadata").unwrap();
        let cf_finalized = self.db.cf_handle("finalized").unwrap();

        // Update metadata
        let mut metadata: VertexMetadata = bincode::deserialize(
            &self.db.get_cf(cf_metadata, hash.as_bytes())?.unwrap()
        )?;
        metadata.finalized = true;
        self.db.put_cf(cf_metadata, hash.as_bytes(), bincode::serialize(&metadata)?)?;

        // Add to finalized index
        self.db.put_cf(
            cf_finalized,
            &sequence.to_le_bytes(),
            hash.as_bytes()
        )?;

        self.metrics.vertices_finalized.inc();
        Ok(())
    }

    pub fn get_dag_tip(&self) -> Result<Vec<VertexHash>> {
        // Find vertices with no children (current DAG tips)
        let cf_vertices = self.db.cf_handle("vertices").unwrap();
        let cf_edges = self.db.cf_handle("edges").unwrap();

        let mut tips = Vec::new();
        let iter = self.db.iterator_cf(cf_vertices, rocksdb::IteratorMode::Start);

        for item in iter {
            let (hash, _) = item?;
            let vertex_hash = VertexHash::from_bytes(&hash);

            // Check if this vertex has children
            let has_children = self.has_children_in_edges(cf_edges, &vertex_hash)?;

            if !has_children {
                tips.push(vertex_hash);
            }
        }

        Ok(tips)
    }
}
```

**Backup/Restore**:
```rust
// src/dag/src/storage/backup.rs
pub struct BackupManager {
    storage: Arc<RocksDbStorage>,
    backup_dir: PathBuf,
}

impl BackupManager {
    pub async fn create_backup(&self) -> Result<BackupId> {
        let backup_id = BackupId::new();
        let backup_path = self.backup_dir.join(backup_id.to_string());

        // Create RocksDB checkpoint (hard links, instant)
        self.storage.db.checkpoint(&backup_path)?;

        // Compress to tar.gz
        let compressed = self.compress_backup(&backup_path).await?;

        // Upload to S3/Object Storage (optional)
        self.upload_to_cloud(&compressed).await?;

        Ok(backup_id)
    }

    pub async fn restore_from_backup(&self, backup_id: BackupId) -> Result<()> {
        let backup_path = self.backup_dir.join(backup_id.to_string());

        // Download from cloud if needed
        if !backup_path.exists() {
            self.download_from_cloud(backup_id, &backup_path).await?;
        }

        // Decompress
        let restored_path = self.decompress_backup(&backup_path).await?;

        // Restore RocksDB from checkpoint
        self.storage.restore_from_path(&restored_path)?;

        Ok(())
    }
}
```

---

### 5. Production Hardening

#### Kubernetes Deployment

**Location**: `k8s/cretoai-cluster.yaml`

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: cretoai

---
apiVersion: v1
kind: ConfigMap
metadata:
  name: cretoai-config
  namespace: cretoai
data:
  node.toml: |
    [node]
    log_level = "info"

    [consensus]
    algorithm = "bft"
    quorum_threshold = 0.67
    finality_timeout_ms = 500

    [network]
    listen_addr = "0.0.0.0:9000"
    quic_port = 9001

    [storage]
    backend = "rocksdb"
    path = "/data/db"
    cache_size_mb = 512

---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: cretoai-node
  namespace: cretoai
spec:
  serviceName: cretoai-nodes
  replicas: 3
  selector:
    matchLabels:
      app: cretoai-node
  template:
    metadata:
      labels:
        app: cretoai-node
    spec:
      containers:
      - name: node
        image: cretoai/node:latest
        ports:
        - containerPort: 9000
          name: p2p
        - containerPort: 9001
          name: quic
          protocol: UDP
        - containerPort: 9090
          name: metrics
        volumeMounts:
        - name: data
          mountPath: /data
        - name: config
          mountPath: /etc/cretoai
        env:
        - name: RUST_LOG
          value: "info,cretoai=debug"
        - name: POD_NAME
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        resources:
          requests:
            cpu: "1"
            memory: "2Gi"
          limits:
            cpu: "2"
            memory: "4Gi"
        livenessProbe:
          exec:
            command: ["/usr/local/bin/cretoai-node", "health"]
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          exec:
            command: ["/usr/local/bin/cretoai-node", "ready"]
          initialDelaySeconds: 10
          periodSeconds: 5
      volumes:
      - name: config
        configMap:
          name: cretoai-config
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 100Gi

---
apiVersion: v1
kind: Service
metadata:
  name: cretoai-nodes
  namespace: cretoai
spec:
  clusterIP: None
  selector:
    app: cretoai-node
  ports:
  - port: 9000
    name: p2p
  - port: 9001
    name: quic
    protocol: UDP

---
apiVersion: v1
kind: Service
metadata:
  name: cretoai-api
  namespace: cretoai
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-type: nlb
spec:
  type: LoadBalancer
  selector:
    app: cretoai-api
  ports:
  - port: 8080
    targetPort: 8080
    name: http

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cretoai-api
  namespace: cretoai
spec:
  replicas: 3
  selector:
    matchLabels:
      app: cretoai-api
  template:
    metadata:
      labels:
        app: cretoai-api
    spec:
      containers:
      - name: api
        image: cretoai/api:latest
        ports:
        - containerPort: 8080
        env:
        - name: CRETOAI_CONSENSUS_NODES
          value: "cretoai-node-0.cretoai-nodes:9000,cretoai-node-1.cretoai-nodes:9000,cretoai-node-2.cretoai-nodes:9000"
        resources:
          requests:
            cpu: "500m"
            memory: "1Gi"
          limits:
            cpu: "1"
            memory: "2Gi"
```

#### Prometheus Monitoring

**Location**: `k8s/monitoring/prometheus.yaml`

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: cretoai-nodes
  namespace: cretoai
spec:
  selector:
    matchLabels:
      app: cretoai-node
  endpoints:
  - port: metrics
    interval: 15s
    path: /metrics

---
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: cretoai-alerts
  namespace: cretoai
spec:
  groups:
  - name: cretoai
    interval: 30s
    rules:
    - alert: HighFinalityLatency
      expr: histogram_quantile(0.99, rate(cretoai_finality_time_seconds_bucket[5m])) > 1.0
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "High finality latency detected"
        description: "P99 finality time is {{ $value }}s (threshold: 1s)"

    - alert: ConsensusStalled
      expr: rate(cretoai_vertices_finalized_total[5m]) == 0
      for: 2m
      labels:
        severity: critical
      annotations:
        summary: "Consensus has stalled"
        description: "No vertices finalized in the last 5 minutes"

    - alert: ByzantineNodeDetected
      expr: increase(cretoai_byzantine_violations_total[5m]) > 0
      labels:
        severity: critical
      annotations:
        summary: "Byzantine node behavior detected"
        description: "Node {{ $labels.node_id }} has {{ $value }} violations"
```

#### Grafana Dashboards

**Location**: `k8s/monitoring/grafana-dashboard.json`

**Panels**:
1. **Consensus Metrics**
   - Vertices finalized per second
   - Finality time (p50, p95, p99)
   - Quorum participation rate

2. **Network Metrics**
   - QUIC connection count
   - Bandwidth usage (in/out)
   - Latency between nodes

3. **Storage Metrics**
   - DAG size (vertices, edges)
   - RocksDB disk usage
   - Compaction stats

4. **Byzantine Detection**
   - Violation counts by type
   - Node reputation scores
   - Banned nodes

---

## Implementation Plan (3-4 Weeks)

### Week 1: Core Consensus Node
- ✅ Create `src/node/` crate
- ✅ Implement `ConsensusNode` binary
- ✅ Add BFT consensus engine
- ✅ Integrate with existing DAG crate

### Week 2: Networking & Storage
- ✅ Implement QUIC transport layer
- ✅ Add NAT traversal (STUN/TURN)
- ✅ Implement RocksDB storage
- ✅ Add backup/restore functionality

### Week 3: Production Features
- ✅ Add Prometheus metrics
- ✅ Implement Byzantine detection
- ✅ Add leader election (Raft)
- ✅ Write Kubernetes manifests

### Week 4: Integration & Testing
- ✅ Update Docker demo (3-node cluster)
- ✅ End-to-end testing
- ✅ Performance benchmarking
- ✅ Documentation updates

---

## Success Metrics

### Performance
- ✅ **Finality**: <500ms p99 (target: <500ms)
- ✅ **Throughput**: 10K+ TPS with 3 nodes
- ✅ **Network**: <50ms p99 QUIC latency
- ✅ **Storage**: <10ms p99 RocksDB write

### Reliability
- ✅ **Byzantine Tolerance**: Withstand 1/3 malicious nodes
- ✅ **Uptime**: 99.9% with automated recovery
- ✅ **Data Integrity**: Zero vertex loss
- ✅ **Crash Recovery**: <60s restart time

### Operations
- ✅ **Deployment**: One-command Kubernetes deploy
- ✅ **Monitoring**: Prometheus + Grafana dashboards
- ✅ **Backup**: Automated daily backups
- ✅ **Scaling**: Add nodes without downtime

---

## Phase 6 Deliverables Summary

1. ✅ **Consensus Node Binary** - `src/node/src/main.rs`
2. ✅ **Byzantine Fault Tolerance** - `src/consensus/src/bft.rs`
3. ✅ **QUIC Networking** - `src/network/src/quic_transport.rs`
4. ✅ **RocksDB Storage** - `src/dag/src/storage/rocksdb.rs`
5. ✅ **Kubernetes Manifests** - `k8s/cretoai-cluster.yaml`
6. ✅ **Prometheus Metrics** - Integrated in all components
7. ✅ **Grafana Dashboards** - Pre-configured monitoring
8. ✅ **Docker Demo** - Updated for 3-node cluster

---

## Next Steps

1. Review and approve Phase 6 plan
2. Initialize SWARM for parallel implementation
3. Begin Week 1: Core consensus node development
4. Set up CI/CD for automated testing

---

**Status**: ✅ Plan Complete, Ready for Approval
**Target Completion**: 3-4 weeks from start date

🤖 Generated with [Claude Code](https://claude.com/claude-code)
