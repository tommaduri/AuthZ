# Phase 3: DAG Consensus Architecture Design

**Version:** 1.0
**Date:** 2025-11-27
**Status:** Architecture Complete
**Agent:** System Architect
**Coordination:** swarm-phase3

---

## Executive Summary

This document defines the architecture for integrating Avalanche-based DAG consensus with QUIC transport in the CretoAI network layer. The design builds on existing implementations while providing clean separation of concerns, testability, and production-grade reliability.

**Key Objectives:**
1. Integrate Avalanche consensus protocol with existing DAG
2. Leverage QUIC transport for low-latency consensus messages
3. Maintain ML-DSA signature verification (quantum-resistant)
4. Support Byzantine fault tolerance (f < n/3)
5. Enable parallel vertex processing for high throughput

**Architecture Principles:**
- **Separation of Concerns:** DAG, Network, Consensus are independent layers
- **Testability:** Mock QUIC for unit tests, real network for integration
- **Observability:** Comprehensive metrics, logging, and tracing
- **Extensibility:** Easy to swap consensus algorithms
- **Performance:** Target 1,000+ vertices/sec per node

---

## Table of Contents

1. [System Context](#1-system-context)
2. [Component Architecture](#2-component-architecture)
3. [Module Structure](#3-module-structure)
4. [Interface Definitions](#4-interface-definitions)
5. [Integration Strategy](#5-integration-strategy)
6. [Concurrency Model](#6-concurrency-model)
7. [Error Handling](#7-error-handling)
8. [Message Protocol](#8-message-protocol)
9. [State Management](#9-state-management)
10. [Testing Strategy](#10-testing-strategy)
11. [Performance Targets](#11-performance-targets)
12. [Deployment Architecture](#12-deployment-architecture)

---

## 1. System Context

### 1.1 Existing Infrastructure

```
┌─────────────────────────────────────────────────────────┐
│                   VIGILIA PLATFORM                       │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌───────────────────────────────────────────────────┐  │
│  │            APPLICATION LAYER                       │  │
│  │  (MCP Server, Vault, Exchange)                     │  │
│  └──────────────────┬────────────────────────────────┘  │
│                     │                                    │
│  ┌──────────────────▼────────────────────────────────┐  │
│  │         CONSENSUS LAYER (NEW - Phase 3)           │  │
│  │  - Avalanche Protocol                              │  │
│  │  - Vertex Consensus Engine                         │  │
│  │  - Query/Response Coordination                     │  │
│  └──────────────────┬────────────────────────────────┘  │
│                     │                                    │
│  ┌──────────────────┼────────────────────────────────┐  │
│  │                  │    DAG LAYER (Existing)        │  │
│  │                  │  - Graph Storage               │  │
│  │     ┌────────────▼─────────┐                      │  │
│  │     │  Vertex Management   │                      │  │
│  │     │  - Creation          │                      │  │
│  │     │  - Validation        │                      │  │
│  │     │  - Ordering          │                      │  │
│  │     └────────────┬─────────┘                      │  │
│  └──────────────────┼────────────────────────────────┘  │
│                     │                                    │
│  ┌──────────────────▼────────────────────────────────┐  │
│  │         NETWORK LAYER (Existing)                  │  │
│  │  - QUIC Transport (Quinn + Rustls)                │  │
│  │  - ML-KEM 1024 Key Exchange                       │  │
│  │  - ML-DSA-87 Signatures                           │  │
│  │  - LibP2P Gossipsub (Phase 3 - deprecated)        │  │
│  └──────────────────┬────────────────────────────────┘  │
│                     │                                    │
│  ┌──────────────────▼────────────────────────────────┐  │
│  │         CRYPTO LAYER (Foundation)                 │  │
│  │  - Post-Quantum Cryptography                      │  │
│  │  - BLAKE3 Hashing                                 │  │
│  └───────────────────────────────────────────────────┘  │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

### 1.2 Integration Points

| Layer | Provides | Consumes |
|-------|----------|----------|
| **Consensus** | Vertex finalization, Confidence scores | DAG vertices, Network transport |
| **DAG** | Vertex storage, Topological ordering | Consensus decisions, Crypto primitives |
| **Network** | QUIC connections, Message routing | Consensus queries, DAG vertex data |
| **Crypto** | Signatures, Hashing, KEM | Raw bytes |

### 1.3 Data Flow

```
1. Vertex Creation:
   Application → DAG → Vertex (unsigned) → Crypto (sign) → DAG (store)

2. Vertex Broadcast:
   DAG → Consensus → Network (QUIC) → Remote Nodes

3. Consensus Query:
   Node A → Network (QUIC) → Node B → Consensus Engine → Response → Network → Node A

4. Finalization:
   Consensus Engine → Confidence Tracker → DAG (mark finalized)
```

---

## 2. Component Architecture

### 2.1 High-Level Components

```
┌───────────────────────────────────────────────────────────┐
│              CONSENSUS NODE (Top-Level API)               │
│                                                            │
│  Public Methods:                                           │
│  - new(agent_id) → ConsensusNode                          │
│  - start() → Result<()>                                   │
│  - propose_vertex(vertex) → Result<VertexId>             │
│  - query_vertex(vertex_id, peers) → Result<Responses>    │
│  - is_finalized(vertex_id) → Result<bool>                │
│  - shutdown() → Result<()>                                │
│                                                            │
│  Components Managed:                                       │
│  ┌────────────┬────────────┬──────────────┬─────────────┐│
│  │ Propagator │   Query    │  Confidence  │  Finality   ││
│  │            │  Handler   │   Tracker    │  Detector   ││
│  └────────────┴────────────┴──────────────┴─────────────┘│
└───────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
┌───────▼────────┐ ┌──────▼──────┐ ┌───────▼────────┐
│ VertexPropagator│ │QueryHandler │ │ConfidenceTracker│
│                │ │             │ │                │
│ - broadcast()  │ │ - handle()  │ │ - update()     │
│ - subscribe()  │ │ - respond() │ │ - threshold()  │
└───────┬────────┘ └──────┬──────┘ └───────┬────────┘
        │                 │                 │
        └─────────────────┼─────────────────┘
                          │
                  ┌───────▼────────┐
                  │  QUIC Transport │
                  │                │
                  │ - connect()    │
                  │ - send()       │
                  │ - receive()    │
                  └────────────────┘
```

### 2.2 Component Responsibilities

#### 2.2.1 ConsensusNode

**Purpose:** Main coordinator for consensus operations

**Responsibilities:**
- Lifecycle management (start, shutdown)
- Component orchestration
- Public API surface
- Configuration management
- Event loop coordination

**Dependencies:**
- `VertexPropagator` - For broadcasting vertices
- `QueryHandler` - For consensus queries
- `ConfidenceTracker` - For acceptance state
- `FinalityDetector` - For finalization decisions
- `QuicTransport` - For network communication
- `Arc<Graph>` - For DAG access

#### 2.2.2 VertexPropagator

**Purpose:** Gossip vertices to network peers

**Responsibilities:**
- Encode vertex to network format
- Broadcast to connected peers via QUIC
- Handle transmission failures
- Deduplicate received vertices
- Verify signatures on incoming vertices

**Key Challenges:**
- Efficient broadcast (avoid duplicate sends)
- Handle partial network partitions
- Rate limiting to prevent flooding

#### 2.2.3 QueryHandler

**Purpose:** Process consensus queries from remote nodes

**Responsibilities:**
- Receive query messages via QUIC
- Determine vertex preference (accept/reject)
- Send response with confidence score
- Validate query signatures
- Track query statistics

**Protocol:**
```rust
Query: { vertex_id, round, signature }
Response: { vertex_id, preference: bool, confidence: f64, signature }
```

#### 2.2.4 ConfidenceTracker

**Purpose:** Maintain acceptance state for vertices

**Responsibilities:**
- Track consecutive successful queries (chit accumulation)
- Calculate confidence scores (0.0 to 1.0)
- Persist state across restarts (optional)
- Provide threshold-based queries

**State Machine:**
```
Pending → Querying → Accumulating → Confident → Finalized
```

#### 2.2.5 FinalityDetector

**Purpose:** Determine when vertices reach finality

**Responsibilities:**
- Monitor confidence thresholds
- Check beta consecutive successes
- Trigger finalization events
- Update DAG metadata
- Emit finalization notifications

**Finality Criteria:**
```rust
finalized = confidence >= 0.95
         && consecutive_successes >= beta_threshold (20)
         && all_parents_finalized
```

---

## 3. Module Structure

### 3.1 File Organization

```
src/network/src/consensus/
├── mod.rs              # Public API, re-exports
├── node.rs             # ConsensusNode (main coordinator)
├── propagator.rs       # VertexPropagator
├── query.rs            # QueryHandler + QueryMessage/Response
├── confidence.rs       # ConfidenceTracker
├── finality.rs         # FinalityDetector
├── protocol.rs         # Message type definitions (VertexMessage, etc.)
├── config.rs           # Configuration structs
└── tests/
    ├── unit/
    │   ├── propagator_test.rs
    │   ├── query_test.rs
    │   ├── confidence_test.rs
    │   └── finality_test.rs
    └── integration/
        ├── consensus_flow_test.rs
        └── multi_node_test.rs
```

### 3.2 Module Dependencies

```
mod.rs
  ├── pub use node::ConsensusNode;
  ├── pub use config::ConsensusConfig;
  └── pub use protocol::{VertexMessage, ConsensusQuery, ConsensusResponse};

node.rs
  ├── use crate::consensus::propagator::VertexPropagator;
  ├── use crate::consensus::query::QueryHandler;
  ├── use crate::consensus::confidence::ConfidenceTracker;
  ├── use crate::consensus::finality::FinalityDetector;
  ├── use crate::libp2p::quic::QuicTransport;
  └── use vigilia_dag::{Graph, Vertex};

propagator.rs
  ├── use crate::consensus::protocol::VertexMessage;
  ├── use crate::libp2p::quic::QuicTransport;
  └── use vigilia_crypto::signatures::MLDSA87;

query.rs
  ├── use crate::consensus::protocol::{ConsensusQuery, ConsensusResponse};
  ├── use crate::libp2p::quic::QuicTransport;
  └── use vigilia_dag::{Graph, VertexId};

confidence.rs
  ├── use vigilia_dag::{VertexId, ConsensusState};
  └── use std::collections::HashMap;

finality.rs
  ├── use crate::consensus::confidence::ConfidenceTracker;
  ├── use vigilia_dag::{Graph, VertexId};
  └── use tokio::sync::mpsc;
```

---

## 4. Interface Definitions

### 4.1 Core Traits

```rust
/// Consensus protocol trait (swappable algorithms)
pub trait ConsensusProtocol: Send + Sync {
    /// Initialize consensus for a vertex
    async fn init_vertex(&mut self, vertex: &Vertex) -> Result<()>;

    /// Run one consensus round
    async fn consensus_round(&mut self, vertex_id: &VertexId) -> Result<RoundResult>;

    /// Check if vertex is finalized
    fn is_finalized(&self, vertex_id: &VertexId) -> Result<bool>;

    /// Get confidence score
    fn get_confidence(&self, vertex_id: &VertexId) -> Result<f64>;

    /// Get protocol parameters
    fn params(&self) -> &ConsensusParams;
}

/// Vertex validator trait (pluggable validation logic)
pub trait VertexValidator: Send + Sync {
    /// Validate vertex structure
    fn validate_structure(&self, vertex: &Vertex) -> Result<()>;

    /// Validate vertex signature
    fn validate_signature(&self, vertex: &Vertex) -> Result<()>;

    /// Validate parent references
    fn validate_parents(&self, vertex: &Vertex, graph: &Graph) -> Result<()>;

    /// Complete validation (all checks)
    fn validate(&self, vertex: &Vertex, graph: &Graph) -> Result<()> {
        self.validate_structure(vertex)?;
        self.validate_signature(vertex)?;
        self.validate_parents(vertex, graph)?;
        Ok(())
    }
}

/// Network transport abstraction (for testing)
#[async_trait]
pub trait ConsensusTransport: Send + Sync {
    /// Send message to peer
    async fn send(&self, peer: &PeerId, message: Vec<u8>) -> Result<()>;

    /// Broadcast message to all peers
    async fn broadcast(&self, message: Vec<u8>) -> Result<()>;

    /// Receive next message
    async fn receive(&mut self) -> Result<(PeerId, Vec<u8>)>;

    /// Get connected peers
    fn peers(&self) -> Vec<PeerId>;
}
```

### 4.2 Message Enums

```rust
/// Top-level consensus message envelope
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConsensusMessage {
    /// Propose a new vertex
    ProposeVertex(VertexMessage),

    /// Query vertex preference
    QueryVertex(ConsensusQuery),

    /// Response to query
    QueryResponse(ConsensusResponse),

    /// Finalization notification
    VertexFinalized(FinalizationNotice),
}

/// Vertex proposal message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VertexMessage {
    /// Vertex to propose
    pub vertex: Vertex,

    /// Proposer's peer ID
    pub proposer: PeerId,

    /// Timestamp
    pub timestamp: u64,

    /// ML-DSA signature (over vertex hash)
    pub signature: Vec<u8>,
}

/// Consensus query message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsensusQuery {
    /// Vertex ID being queried
    pub vertex_id: VertexId,

    /// Consensus round number
    pub round: u64,

    /// Querying peer ID
    pub querier: PeerId,

    /// Timestamp
    pub timestamp: u64,

    /// ML-DSA signature
    pub signature: Vec<u8>,
}

/// Consensus response message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsensusResponse {
    /// Vertex ID being responded to
    pub vertex_id: VertexId,

    /// Preference (accept = true, reject = false)
    pub preference: bool,

    /// Current confidence score (0.0 to 1.0)
    pub confidence: f64,

    /// Round number
    pub round: u64,

    /// Responding peer ID
    pub responder: PeerId,

    /// Timestamp
    pub timestamp: u64,

    /// ML-DSA signature
    pub signature: Vec<u8>,
}

/// Finalization notification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinalizationNotice {
    /// Finalized vertex ID
    pub vertex_id: VertexId,

    /// Final confidence score
    pub confidence: f64,

    /// Round at which finalized
    pub round: u64,

    /// Notifying peer ID
    pub notifier: PeerId,

    /// Timestamp
    pub timestamp: u64,
}
```

### 4.3 Configuration Structs

```rust
/// Consensus configuration
#[derive(Debug, Clone)]
pub struct ConsensusConfig {
    /// Agent/node identifier
    pub agent_id: String,

    /// Avalanche protocol parameters
    pub snowball_params: SnowballParams,

    /// Network configuration
    pub network_config: NetworkConfig,

    /// Validation configuration
    pub validation_config: ValidationConfig,

    /// Performance tuning
    pub performance_config: PerformanceConfig,
}

/// Snowball consensus parameters
#[derive(Debug, Clone)]
pub struct SnowballParams {
    /// Sample size k (nodes to query per round)
    pub sample_size: usize,

    /// Alpha threshold (minimum positive responses)
    pub alpha_threshold: usize,

    /// Beta threshold (consecutive successful rounds)
    pub beta_threshold: usize,

    /// Confidence threshold for finalization
    pub finalization_threshold: f64,

    /// Maximum rounds before timeout
    pub max_rounds: u64,
}

impl Default for SnowballParams {
    fn default() -> Self {
        Self {
            sample_size: 30,
            alpha_threshold: 24, // 80% of 30
            beta_threshold: 20,
            finalization_threshold: 0.95,
            max_rounds: 1000,
        }
    }
}

/// Network configuration
#[derive(Debug, Clone)]
pub struct NetworkConfig {
    /// QUIC bind address
    pub bind_address: SocketAddr,

    /// Bootstrap peers
    pub bootstrap_peers: Vec<SocketAddr>,

    /// Maximum concurrent connections
    pub max_connections: usize,

    /// Message timeout
    pub message_timeout: Duration,

    /// Query timeout
    pub query_timeout: Duration,
}

/// Validation configuration
#[derive(Debug, Clone)]
pub struct ValidationConfig {
    /// Enable signature verification
    pub verify_signatures: bool,

    /// Enable parent validation
    pub verify_parents: bool,

    /// Maximum vertex size (bytes)
    pub max_vertex_size: usize,

    /// Maximum parents per vertex
    pub max_parents: usize,
}

/// Performance configuration
#[derive(Debug, Clone)]
pub struct PerformanceConfig {
    /// Worker threads for consensus
    pub worker_threads: usize,

    /// Channel buffer size
    pub channel_buffer_size: usize,

    /// Batch size for parallel processing
    pub batch_size: usize,

    /// Enable metrics collection
    pub enable_metrics: bool,
}
```

---

## 5. Integration Strategy

### 5.1 Integration Layers

```
Application Layer
      │
      ▼
┌─────────────────────────────────────┐
│   ConsensusNode (Facade)            │
│   - Public API                      │
│   - Hides complexity                │
└─────────────────┬───────────────────┘
                  │
      ┌───────────┼───────────┐
      │           │           │
      ▼           ▼           ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│Propagator│ │  Query   │ │Confidence│
│          │ │ Handler  │ │ Tracker  │
└────┬─────┘ └────┬─────┘ └────┬─────┘
     │            │            │
     └────────────┼────────────┘
                  │
      ┌───────────┼───────────┐
      │           │           │
      ▼           ▼           ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│   DAG    │ │  Network │ │  Crypto  │
│ (Graph)  │ │  (QUIC)  │ │(ML-DSA)  │
└──────────┘ └──────────┘ └──────────┘
```

### 5.2 Integration Sequence

#### Phase 1: DAG Integration

```rust
// 1. ConsensusNode accesses DAG via Arc<Graph>
let graph = Arc::new(Graph::new());
let consensus = ConsensusNode::new("agent-1", graph.clone()).await?;

// 2. Vertex creation remains in DAG layer
let vertex = VertexBuilder::new("agent-1".to_string())
    .payload(b"transaction data".to_vec())
    .build();

// 3. Add to DAG
graph.add_vertex(vertex.clone())?;

// 4. Initiate consensus
consensus.propose_vertex(vertex).await?;

// 5. Consensus updates DAG metadata when finalized
// (handled internally by FinalityDetector)
```

#### Phase 2: Network Integration

```rust
// 1. Create QUIC transport
let transport = QuicTransport::new(identity, config)?;
transport.listen().await?;

// 2. Connect to peers
for peer in bootstrap_peers {
    transport.dial(peer).await?;
}

// 3. ConsensusNode uses transport for messages
let consensus = ConsensusNode::with_transport(
    "agent-1",
    graph,
    transport
).await?;

// 4. Message flow:
//    ConsensusNode → VertexPropagator → QuicTransport → Remote Node
//    Remote Node → QuicTransport → QueryHandler → ConsensusResponse
```

#### Phase 3: Consensus Protocol

```rust
// 1. Configure Snowball parameters
let snowball_params = SnowballParams {
    sample_size: 30,
    alpha_threshold: 24,
    beta_threshold: 20,
    finalization_threshold: 0.95,
    max_rounds: 1000,
};

// 2. Start consensus engine
let config = ConsensusConfig {
    agent_id: "agent-1".to_string(),
    snowball_params,
    network_config,
    validation_config,
    performance_config,
};

let consensus = ConsensusNode::with_config(config, graph, transport).await?;

// 3. Run consensus rounds until finalization
let vertex_id = consensus.propose_vertex(vertex).await?;

// 4. Wait for finalization (or poll)
while !consensus.is_finalized(&vertex_id).await? {
    tokio::time::sleep(Duration::from_millis(100)).await;
}
```

### 5.3 Backward Compatibility

**Existing Code (DAG-only):**
```rust
// Continues to work without consensus
let graph = Arc::new(Graph::new());
let vertex = VertexBuilder::new("agent-1").build();
graph.add_vertex(vertex)?;
```

**With Consensus (Opt-in):**
```rust
// Enable consensus when needed
let consensus = ConsensusNode::new("agent-1", graph.clone()).await?;
consensus.propose_vertex(vertex).await?;
```

---

## 6. Concurrency Model

### 6.1 Tokio Async Patterns

```rust
/// ConsensusNode uses async/await with Tokio runtime
pub struct ConsensusNode {
    // Shared state with RwLock
    state: Arc<RwLock<ConsensusState>>,

    // Message channels (MPSC)
    vertex_tx: mpsc::Sender<VertexMessage>,
    query_tx: mpsc::Sender<ConsensusQuery>,
    response_rx: mpsc::Receiver<ConsensusResponse>,

    // Task handles
    propagator_task: JoinHandle<()>,
    query_task: JoinHandle<()>,
    finality_task: JoinHandle<()>,
}

impl ConsensusNode {
    pub async fn start(&mut self) -> Result<()> {
        // Spawn background tasks
        self.propagator_task = tokio::spawn(
            propagator_loop(self.vertex_tx.clone(), self.transport.clone())
        );

        self.query_task = tokio::spawn(
            query_handler_loop(self.query_tx.clone(), self.graph.clone())
        );

        self.finality_task = tokio::spawn(
            finality_detector_loop(self.state.clone(), self.graph.clone())
        );

        Ok(())
    }
}
```

### 6.2 Lock Strategy

| Data Structure | Lock Type | Rationale |
|----------------|-----------|-----------|
| **ConsensusState** | `RwLock` | Many reads (confidence queries), few writes (round updates) |
| **PeerRegistry** | `RwLock` | Many reads (peer lookup), occasional writes (peer add/remove) |
| **VertexCache** | `RwLock` | Many reads (deduplication), writes on new vertices |
| **QueryQueue** | `Mutex` | Exclusive access required for queue operations |
| **ConfidenceScores** | `RwLock` | Many reads (threshold checks), periodic writes |

### 6.3 Channel-Based Communication

```rust
/// Message flow using Tokio MPSC channels
struct MessageChannels {
    // Vertex propagation
    vertex_tx: mpsc::Sender<VertexMessage>,
    vertex_rx: mpsc::Receiver<VertexMessage>,

    // Consensus queries
    query_tx: mpsc::Sender<ConsensusQuery>,
    query_rx: mpsc::Receiver<ConsensusQuery>,

    // Query responses
    response_tx: mpsc::Sender<ConsensusResponse>,
    response_rx: mpsc::Receiver<ConsensusResponse>,

    // Finalization events
    finality_tx: broadcast::Sender<FinalizationNotice>,
    finality_rx: broadcast::Receiver<FinalizationNotice>,
}

/// Channel buffer sizes (configurable)
const VERTEX_CHANNEL_SIZE: usize = 1000;
const QUERY_CHANNEL_SIZE: usize = 500;
const RESPONSE_CHANNEL_SIZE: usize = 500;
const FINALITY_CHANNEL_SIZE: usize = 100;
```

### 6.4 Thread Safety Guarantees

```rust
// All components are Send + Sync
impl Send for ConsensusNode {}
impl Sync for ConsensusNode {}

// Shared state protected by Arc + RwLock
type SharedState<T> = Arc<RwLock<T>>;

// Example: Safe concurrent access to consensus state
async fn update_confidence(state: SharedState<ConsensusState>, vertex_id: &VertexId, confidence: f64) {
    let mut state = state.write().await;
    state.update_confidence(vertex_id, confidence);
    // Lock automatically released
}

async fn read_confidence(state: SharedState<ConsensusState>, vertex_id: &VertexId) -> f64 {
    let state = state.read().await;
    state.get_confidence(vertex_id).unwrap_or(0.0)
    // Lock automatically released
}
```

---

## 7. Error Handling

### 7.1 Error Hierarchy

```rust
/// Consensus-specific errors
#[derive(Debug, thiserror::Error)]
pub enum ConsensusError {
    /// Network transport error
    #[error("Network error: {0}")]
    Network(#[from] NetworkError),

    /// DAG operation error
    #[error("DAG error: {0}")]
    Dag(#[from] DagError),

    /// Cryptographic verification error
    #[error("Crypto error: {0}")]
    Crypto(#[from] CryptoError),

    /// Consensus timeout
    #[error("Consensus timeout after {rounds} rounds")]
    Timeout { rounds: u64 },

    /// Insufficient network size
    #[error("Network too small: {size} nodes (minimum: {minimum})")]
    InsufficientNetwork { size: usize, minimum: usize },

    /// Invalid vertex
    #[error("Invalid vertex: {reason}")]
    InvalidVertex { reason: String },

    /// Byzantine behavior detected
    #[error("Byzantine node detected: {peer_id} - {reason}")]
    ByzantineNode { peer_id: PeerId, reason: String },

    /// Query failed
    #[error("Query failed: {reason}")]
    QueryFailed { reason: String },

    /// State inconsistency
    #[error("State inconsistency: {0}")]
    StateInconsistency(String),
}
```

### 7.2 Error Recovery Strategies

| Error Type | Recovery Strategy | Retry | Notify |
|------------|-------------------|-------|--------|
| **Network Timeout** | Retry with exponential backoff | Yes (3x) | Log |
| **Byzantine Node** | Add to graylist, exclude from sampling | No | Alert |
| **Invalid Vertex** | Reject, log, continue | No | Log |
| **Consensus Timeout** | Mark vertex as pending, retry later | Yes | Metric |
| **Insufficient Network** | Wait for peers, abort if timeout | Yes | Alert |
| **State Inconsistency** | Reset state, re-sync from DAG | No | Critical |

### 7.3 Network Partition Handling

```rust
/// Detect network partition
async fn detect_partition(&self) -> Result<bool> {
    let active_peers = self.transport.peers();
    let expected_peers = self.config.network_config.bootstrap_peers.len();

    // If we lose >50% of peers, suspect partition
    let partition_threshold = 0.5;
    let partition_detected = (active_peers.len() as f64 / expected_peers as f64) < partition_threshold;

    if partition_detected {
        warn!("Network partition detected: {}/{} peers active", active_peers.len(), expected_peers);

        // Pause consensus until partition heals
        self.state.write().await.paused = true;
    }

    Ok(partition_detected)
}

/// Recover from partition
async fn heal_partition(&self) -> Result<()> {
    info!("Attempting partition recovery...");

    // Re-establish connections to bootstrap peers
    for peer in &self.config.network_config.bootstrap_peers {
        self.transport.dial(*peer).await?;
    }

    // Wait for connections to stabilize
    tokio::time::sleep(Duration::from_secs(5)).await;

    // Resume consensus
    self.state.write().await.paused = false;

    info!("Partition recovery complete");
    Ok(())
}
```

### 7.4 Byzantine Behavior Detection

```rust
/// Byzantine behavior patterns
#[derive(Debug)]
enum ByzantinePattern {
    /// Equivocation (two conflicting vertices)
    Equivocation { vertex_a: VertexId, vertex_b: VertexId },

    /// Invalid signature
    InvalidSignature { vertex_id: VertexId },

    /// Conflicting responses
    ConflictingResponses { query_id: QueryId, responses: Vec<ConsensusResponse> },

    /// Spam (excessive messages)
    Spam { peer_id: PeerId, count: usize, duration: Duration },
}

/// Detect and handle Byzantine behavior
async fn handle_byzantine_behavior(&self, peer: PeerId, pattern: ByzantinePattern) -> Result<()> {
    error!("Byzantine behavior detected from {}: {:?}", peer, pattern);

    // Add to graylist
    self.graylisted_peers.write().await.insert(peer.clone());

    // Disconnect
    self.transport.close_connection(&peer).await?;

    // Emit metric
    metrics::increment_counter!("consensus_byzantine_detected", "peer" => peer.to_string());

    Ok(())
}
```

---

## 8. Message Protocol

### 8.1 Serialization Format

**Encoding:** Bincode (compact binary, fast)

```rust
use bincode::{serialize, deserialize};

/// Encode message
fn encode_message(msg: &ConsensusMessage) -> Result<Vec<u8>> {
    bincode::serialize(msg)
        .map_err(|e| ConsensusError::Serialization(e.to_string()))
}

/// Decode message
fn decode_message(bytes: &[u8]) -> Result<ConsensusMessage> {
    bincode::deserialize(bytes)
        .map_err(|e| ConsensusError::Deserialization(e.to_string()))
}
```

### 8.2 Message Wire Format

```
┌──────────────────────────────────────────────────────────┐
│                     QUIC Stream                          │
├──────────────────────────────────────────────────────────┤
│  Frame 1: Message Header (8 bytes)                       │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Version (1) │ Type (1) │ Length (4) │ Reserved (2) │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                            │
│  Frame 2: Message Payload (variable)                     │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Bincode-serialized ConsensusMessage                │ │
│  │  (VertexMessage / ConsensusQuery / Response)        │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                            │
│  Frame 3: Signature (variable, ~4000 bytes for ML-DSA)  │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  ML-DSA-87 signature over (Header + Payload)        │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 8.3 Message Types

| Type | Code | Direction | Size | Frequency |
|------|------|-----------|------|-----------|
| **ProposeVertex** | 0x01 | Broadcast | ~5 KB | High |
| **QueryVertex** | 0x02 | Peer-to-peer | ~200 B | High |
| **QueryResponse** | 0x03 | Peer-to-peer | ~300 B | High |
| **VertexFinalized** | 0x04 | Broadcast | ~150 B | Medium |

### 8.4 Signature Verification

```rust
/// Verify message signature
async fn verify_message_signature(
    msg: &ConsensusMessage,
    public_key: &[u8]
) -> Result<()> {
    let message_bytes = bincode::serialize(msg)?;
    let message_hash = blake3::hash(&message_bytes);

    let signature = match msg {
        ConsensusMessage::ProposeVertex(v) => &v.signature,
        ConsensusMessage::QueryVertex(q) => &q.signature,
        ConsensusMessage::QueryResponse(r) => &r.signature,
        ConsensusMessage::VertexFinalized(_) => return Ok(()), // No signature required
    };

    use vigilia_crypto::signatures::{MLDSA87, MLDSA87PublicKey, MLDSA87Signature};

    let pk = MLDSA87PublicKey::from_bytes(public_key)?;
    let sig = MLDSA87Signature::from_bytes(signature)?;

    MLDSA87::verify(message_hash.as_bytes(), &sig, &pk)
        .map_err(|_| ConsensusError::InvalidSignature)
}
```

---

## 9. State Management

### 9.1 In-Memory State

```rust
/// In-memory consensus state
pub struct ConsensusState {
    /// Vertex confidence scores
    confidence_scores: HashMap<VertexId, f64>,

    /// Consecutive successful rounds per vertex
    consecutive_successes: HashMap<VertexId, u32>,

    /// Total queries per vertex
    total_queries: HashMap<VertexId, u32>,

    /// Finalized vertices
    finalized_set: HashSet<VertexId>,

    /// Pending vertices (awaiting consensus)
    pending_vertices: HashSet<VertexId>,

    /// Graylisted peers (Byzantine detected)
    graylisted_peers: HashSet<PeerId>,

    /// Consensus paused flag (network partition)
    paused: bool,
}

impl ConsensusState {
    pub fn new() -> Self {
        Self {
            confidence_scores: HashMap::new(),
            consecutive_successes: HashMap::new(),
            total_queries: HashMap::new(),
            finalized_set: HashSet::new(),
            pending_vertices: HashSet::new(),
            graylisted_peers: HashSet::new(),
            paused: false,
        }
    }

    /// Update confidence after query round
    pub fn update_confidence(&mut self, vertex_id: &VertexId, success: bool, response_ratio: f64) {
        let confidence = self.confidence_scores.entry(vertex_id.clone()).or_insert(0.0);

        // Exponential moving average
        *confidence = (*confidence * 0.9) + (response_ratio * 0.1);

        // Update consecutive successes
        let consecutive = self.consecutive_successes.entry(vertex_id.clone()).or_insert(0);
        if success {
            *consecutive += 1;
        } else {
            *consecutive = 0;
        }

        // Increment query count
        *self.total_queries.entry(vertex_id.clone()).or_insert(0) += 1;
    }

    /// Check if vertex can be finalized
    pub fn can_finalize(&self, vertex_id: &VertexId, params: &SnowballParams) -> bool {
        if self.finalized_set.contains(vertex_id) {
            return false; // Already finalized
        }

        let confidence = self.confidence_scores.get(vertex_id).copied().unwrap_or(0.0);
        let consecutive = self.consecutive_successes.get(vertex_id).copied().unwrap_or(0);

        confidence >= params.finalization_threshold && consecutive >= params.beta_threshold as u32
    }

    /// Mark vertex as finalized
    pub fn finalize(&mut self, vertex_id: &VertexId) {
        self.finalized_set.insert(vertex_id.clone());
        self.pending_vertices.remove(vertex_id);
    }
}
```

### 9.2 Persistent State (Optional)

```rust
/// Persistent state backed by RocksDB
pub struct PersistentConsensusState {
    /// RocksDB instance
    db: Arc<rocksdb::DB>,

    /// Column families
    confidence_cf: rocksdb::ColumnFamily,
    finalized_cf: rocksdb::ColumnFamily,
}

impl PersistentConsensusState {
    /// Save confidence score
    pub fn save_confidence(&self, vertex_id: &VertexId, confidence: f64) -> Result<()> {
        let key = vertex_id.as_bytes();
        let value = confidence.to_le_bytes();
        self.db.put_cf(&self.confidence_cf, key, &value)?;
        Ok(())
    }

    /// Load confidence score
    pub fn load_confidence(&self, vertex_id: &VertexId) -> Result<Option<f64>> {
        let key = vertex_id.as_bytes();
        let value = self.db.get_cf(&self.confidence_cf, key)?;

        Ok(value.map(|bytes| {
            let array: [u8; 8] = bytes.try_into().unwrap();
            f64::from_le_bytes(array)
        }))
    }

    /// Mark as finalized (persistent)
    pub fn mark_finalized(&self, vertex_id: &VertexId) -> Result<()> {
        let key = vertex_id.as_bytes();
        self.db.put_cf(&self.finalized_cf, key, &[1])?;
        Ok(())
    }
}
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

```rust
/// Unit test structure
#[cfg(test)]
mod tests {
    use super::*;

    /// Test confidence tracker updates
    #[tokio::test]
    async fn test_confidence_update() {
        let mut state = ConsensusState::new();
        let vertex_id = "vertex-1".to_string();

        // First round: 24/30 positive (80%)
        state.update_confidence(&vertex_id, true, 0.8);
        assert!(state.confidence_scores[&vertex_id] > 0.05);

        // Second round: 26/30 positive (86%)
        state.update_confidence(&vertex_id, true, 0.86);
        assert!(state.consecutive_successes[&vertex_id] == 2);
    }

    /// Test finalization threshold
    #[tokio::test]
    async fn test_finalization_threshold() {
        let mut state = ConsensusState::new();
        let params = SnowballParams::default();
        let vertex_id = "vertex-1".to_string();

        // Simulate 20 successful rounds
        for _ in 0..20 {
            state.update_confidence(&vertex_id, true, 0.95);
        }

        assert!(state.can_finalize(&vertex_id, &params));
    }
}
```

### 10.2 Integration Tests

```rust
/// Integration test: 3-node consensus
#[tokio::test]
async fn test_three_node_consensus() {
    // Setup 3 nodes
    let node1 = setup_node("node-1", 9001).await;
    let node2 = setup_node("node-2", 9002).await;
    let node3 = setup_node("node-3", 9003).await;

    // Connect nodes
    node1.connect(node2.address()).await.unwrap();
    node1.connect(node3.address()).await.unwrap();
    node2.connect(node3.address()).await.unwrap();

    // Create and propose vertex
    let vertex = VertexBuilder::new("node-1".to_string()).build();
    let vertex_id = node1.propose_vertex(vertex).await.unwrap();

    // Wait for consensus
    tokio::time::sleep(Duration::from_secs(2)).await;

    // Verify all nodes finalized
    assert!(node1.is_finalized(&vertex_id).await.unwrap());
    assert!(node2.is_finalized(&vertex_id).await.unwrap());
    assert!(node3.is_finalized(&vertex_id).await.unwrap());
}
```

### 10.3 Byzantine Tests

```rust
/// Test Byzantine node rejection
#[tokio::test]
async fn test_byzantine_node_rejection() {
    // Setup 5 honest + 1 Byzantine
    let honest_nodes = setup_nodes(5, "honest").await;
    let byzantine_node = setup_byzantine_node("byzantine").await;

    // Connect all
    connect_all_nodes(&honest_nodes, &byzantine_node).await;

    // Byzantine sends conflicting vertices
    let vertex_a = create_vertex("data-1");
    let vertex_b = create_vertex("data-2"); // Same ID, different payload
    byzantine_node.broadcast(vertex_a).await.unwrap();
    byzantine_node.broadcast(vertex_b).await.unwrap();

    // Wait for detection
    tokio::time::sleep(Duration::from_secs(1)).await;

    // Verify Byzantine node graylisted
    for node in &honest_nodes {
        assert!(node.is_graylisted(&byzantine_node.peer_id()).await);
    }
}
```

### 10.4 Performance Benchmarks

```rust
/// Benchmark consensus throughput
#[bench]
fn bench_consensus_throughput(b: &mut Bencher) {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let node = runtime.block_on(async { setup_node("bench", 0).await });

    b.iter(|| {
        runtime.block_on(async {
            let vertex = VertexBuilder::new("bench".to_string()).build();
            node.propose_vertex(vertex).await.unwrap();
        })
    });
}

/// Benchmark query latency
#[bench]
fn bench_query_latency(b: &mut Bencher) {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let nodes = runtime.block_on(async { setup_nodes(7, "bench").await });

    b.iter(|| {
        runtime.block_on(async {
            let query = ConsensusQuery { /* ... */ };
            nodes[0].query_peers(&query).await.unwrap();
        })
    });
}
```

---

## 11. Performance Targets

### 11.1 Throughput Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Vertex Insertion** | 1,000+ vertices/sec | Single node |
| **Consensus Latency** | <1s | 7 nodes, LAN |
| **Query Latency** | <50ms | Per query, p95 |
| **Finalization Time** | <100ms | After confidence threshold |
| **Message Throughput** | 10,000+ msg/sec | All message types |

### 11.2 Resource Utilization

| Resource | Target | Limit |
|----------|--------|-------|
| **CPU** | <50% | Per node, 4 cores |
| **Memory** | <500 MB | Per node |
| **Network** | <10 Mbps | Per node |
| **Disk I/O** | <100 IOPS | DAG writes |

### 11.3 Scalability

| Network Size | Consensus Time | Throughput |
|--------------|----------------|------------|
| 3 nodes | <500ms | 500 vertices/sec |
| 7 nodes | <1s | 300 vertices/sec |
| 15 nodes | <2s | 150 vertices/sec |
| 31 nodes | <4s | 75 vertices/sec |

**Note:** Throughput decreases with network size due to increased query overhead.

---

## 12. Deployment Architecture

### 12.1 Single-Node Deployment (Development)

```
┌─────────────────────────────────────┐
│         localhost:9001              │
│                                      │
│  ┌───────────────────────────────┐  │
│  │     ConsensusNode             │  │
│  │  - Agent ID: "dev-node"       │  │
│  │  - DAG: In-memory             │  │
│  │  - Network: Simulated         │  │
│  └───────────────────────────────┘  │
│                                      │
│  ┌───────────────────────────────┐  │
│  │     DAG (In-Memory)           │  │
│  │  - ~10,000 vertices           │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘

Usage:
```bash
cargo run --bin cretoai-node -- --dev
```

### 12.2 Multi-Node Deployment (Testing)

```
         ┌─────────────┐
         │  Bootstrap  │
         │   Node 1    │
         │  :9001      │
         └──────┬──────┘
                │
       ┌────────┼────────┐
       │        │        │
   ┌───▼───┐ ┌─▼────┐ ┌─▼────┐
   │Node 2 │ │Node 3│ │Node 4│
   │:9002  │ │:9003 │ │:9004 │
   └───────┘ └──────┘ └──────┘

Configuration (node1.toml):
```toml
[consensus]
agent_id = "node-1"
bind_address = "0.0.0.0:9001"
bootstrap_peers = []

[snowball]
sample_size = 3
alpha_threshold = 2
beta_threshold = 5
```

Configuration (node2.toml):
```toml
[consensus]
agent_id = "node-2"
bind_address = "0.0.0.0:9002"
bootstrap_peers = ["127.0.0.1:9001"]

[snowball]
sample_size = 3
alpha_threshold = 2
beta_threshold = 5
```

### 12.3 Production Deployment (7-Node Cluster)

```
                    Internet
                       │
            ┌──────────┼──────────┐
            │   Load Balancer     │
            └──────────┬──────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
   ┌────▼────┐    ┌────▼────┐    ┌───▼─────┐
   │ Node 1  │    │ Node 2  │    │ Node 3  │
   │ US-East │    │ US-West │    │  EU     │
   │ :9001   │    │ :9001   │    │ :9001   │
   └────┬────┘    └────┬────┘    └────┬────┘
        │              │              │
        └──────────────┼──────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
   ┌────▼────┐    ┌────▼────┐    ┌───▼─────┐
   │ Node 4  │    │ Node 5  │    │ Node 6  │
   │ Asia    │    │ AU      │    │ SA      │
   │ :9001   │    │ :9001   │    │ :9001   │
   └─────────┘    └─────────┘    └─────────┘
                       │
                  ┌────▼────┐
                  │ Node 7  │
                  │ Backup  │
                  │ :9001   │
                  └─────────┘

RocksDB                RocksDB              RocksDB
(Persistent)           (Persistent)         (Persistent)
```

**Production Configuration:**
```toml
[consensus]
agent_id = "node-us-east-1"
bind_address = "0.0.0.0:9001"
external_address = "PUBLIC_IP:9001"
bootstrap_peers = [
    "node-us-west.vigilia.network:9001",
    "node-eu.vigilia.network:9001",
    # ... other nodes
]

[snowball]
sample_size = 30
alpha_threshold = 24
beta_threshold = 20
finalization_threshold = 0.95
max_rounds = 1000

[network]
max_connections = 100
message_timeout = "5s"
query_timeout = "2s"

[performance]
worker_threads = 4
channel_buffer_size = 1000
batch_size = 100
enable_metrics = true

[storage]
dag_backend = "rocksdb"
dag_path = "/var/lib/vigilia/dag"
consensus_state = "persistent"
consensus_path = "/var/lib/vigilia/consensus"
```

**Systemd Service:**
```ini
[Unit]
Description=CretoAI Consensus Node
After=network.target

[Service]
Type=simple
User=vigilia
ExecStart=/usr/local/bin/cretoai-node --config /etc/vigilia/node.toml
Restart=on-failure
RestartSec=10s

[Install]
WantedBy=multi-user.target
```

### 12.4 Monitoring Stack

```
┌──────────────────────────────────────────┐
│         Prometheus (Metrics)              │
│  - consensus_rounds_total                 │
│  - consensus_latency_seconds              │
│  - vertices_finalized_total               │
│  - byzantine_nodes_detected               │
└──────────────────┬───────────────────────┘
                   │
┌──────────────────▼───────────────────────┐
│         Grafana (Dashboards)              │
│  - Consensus Latency Over Time            │
│  - Finalization Rate                      │
│  - Network Health                         │
│  - Byzantine Activity                     │
└───────────────────────────────────────────┘

┌───────────────────────────────────────────┐
│      Jaeger (Distributed Tracing)         │
│  - Trace: Vertex Proposal                 │
│    ├─ DAG Insert (5ms)                    │
│    ├─ Signature (10ms)                    │
│    ├─ Network Broadcast (20ms)            │
│    └─ Consensus Rounds (500ms)            │
└───────────────────────────────────────────┘
```

---

## Conclusion

This architecture provides a robust, testable, and production-ready foundation for integrating Avalanche consensus with CretoAI's DAG and QUIC transport layers. Key strengths:

✅ **Clean Separation:** DAG, Network, Consensus are independent
✅ **Testability:** Unit, integration, and Byzantine tests
✅ **Performance:** Targets 1,000+ vertices/sec
✅ **Observability:** Comprehensive metrics and tracing
✅ **Extensibility:** Trait-based design for algorithm swapping
✅ **Security:** ML-DSA signatures, Byzantine detection

**Next Steps:**
1. Implement `ConsensusNode` coordinator (src/network/src/consensus/node.rs)
2. Implement `VertexPropagator` (src/network/src/consensus/propagator.rs)
3. Implement `QueryHandler` (src/network/src/consensus/query.rs)
4. Implement `ConfidenceTracker` (src/network/src/consensus/confidence.rs)
5. Implement `FinalityDetector` (src/network/src/consensus/finality.rs)
6. Write integration tests
7. Performance benchmarking

---

**Architecture Designed By:** System Architect
**Coordination Session:** swarm-phase3
**Memory Key:** swarm/phase3/architecture
**Status:** ✅ Complete
**Next Agent:** Implementation Team (Coder, Reviewer, Tester)
