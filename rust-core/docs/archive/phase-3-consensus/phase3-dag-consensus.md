# Phase 3: DAG Consensus (Avalanche) - Specification

**Version**: 1.0.0
**Date**: 2025-11-27
**Status**: Draft
**Author**: SPARC Specification Agent

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Requirements Analysis](#2-requirements-analysis)
3. [Avalanche Consensus Specification](#3-avalanche-consensus-specification)
4. [Network Protocol Design](#4-network-protocol-design)
5. [Data Flow Architecture](#5-data-flow-architecture)
6. [Integration Points](#6-integration-points)
7. [Success Criteria](#7-success-criteria)
8. [Implementation Roadmap](#8-implementation-roadmap)

---

## 1. Executive Summary

### 1.1 Purpose

This specification defines the integration of Avalanche-based DAG consensus on top of the quantum-resistant QUIC transport layer for the CretoAI AI distributed system. The implementation bridges the existing DAG consensus engine with the QUIC network transport, enabling Byzantine fault-tolerant consensus across a peer-to-peer network.

### 1.2 Context

- **Phase 1 (Crypto)**: ✅ Complete - ML-KEM-768, Ed25519, BLAKE3
- **Phase 2 (QUIC)**: ✅ Complete - Hybrid X25519+ML-KEM-768 handshake working
- **Phase 3 (Consensus)**: 🎯 Current - Integrate DAG consensus with QUIC network

### 1.3 Goals

1. Replace gossip-based P2P protocol with QUIC transport
2. Maintain Avalanche consensus guarantees (Byzantine fault tolerance)
3. Preserve quantum-resistant security from Phase 1 & 2
4. Achieve <1 second finality time
5. Support 100+ node networks with eventual scalability to 1000+ nodes

### 1.4 Non-Goals

- TCP/HTTP fallback mechanisms (QUIC-only)
- Full Snowman++ implementation (focus on core Avalanche)
- Cross-chain bridges or atomic swaps
- Zero-knowledge proofs or advanced privacy features

---

## 2. Requirements Analysis

### 2.1 Functional Requirements

#### FR-001: Vertex Propagation over QUIC
- **ID**: FR-001
- **Priority**: High
- **Description**: Vertices must be propagated across the network using QUIC bidirectional streams
- **Acceptance Criteria**:
  - Vertices serialized with bincode for efficiency
  - QUIC streams handle backpressure automatically
  - ML-DSA signatures verified on receipt
  - Duplicate vertices deduplicated via vertex cache

#### FR-002: Consensus Query Protocol
- **ID**: FR-002
- **Priority**: High
- **Description**: Implement Avalanche query-response protocol over QUIC
- **Acceptance Criteria**:
  - Random sampling of k nodes from network
  - Query timeout handling (1 second default)
  - Response aggregation with signature verification
  - Alpha threshold (α) met for successful round

#### FR-003: Parent Selection Algorithm
- **ID**: FR-003
- **Priority**: High
- **Description**: New vertices select 2 recent, well-connected parents
- **Acceptance Criteria**:
  - Prefer vertices with high confidence (>0.8)
  - Select from recent vertices (last 10 seconds)
  - Maintain DAG structure (no cycles)
  - Balanced parent distribution across network

#### FR-004: Confidence Calculation
- **ID**: FR-004
- **Priority**: High
- **Description**: Track acceptance counters and calculate confidence scores
- **Acceptance Criteria**:
  - Exponential moving average: `confidence = 0.9 * prev + 0.1 * response_ratio`
  - Consecutive success tracking for beta threshold
  - Confidence threshold (0.95) for finalization
  - Confidence scores persisted in vertex metadata

#### FR-005: Finality Detection
- **ID**: FR-005
- **Priority**: High
- **Description**: Detect when vertices reach finality
- **Acceptance Criteria**:
  - Beta consecutive successes (20 rounds)
  - Confidence exceeds finalization threshold (0.95)
  - Finalized vertices immutable
  - Finality propagated to dependent vertices

#### FR-006: Byzantine Fault Tolerance
- **ID**: FR-006
- **Priority**: High
- **Description**: Tolerate up to 33% malicious nodes
- **Acceptance Criteria**:
  - System converges with 20% Byzantine nodes
  - Safety maintained with 33% Byzantine nodes (probabilistic)
  - Liveness maintained with 25% Byzantine nodes
  - Byzantine behavior detected and mitigated

### 2.2 Non-Functional Requirements

#### NFR-001: Performance
- **ID**: NFR-001
- **Category**: Performance
- **Description**: System must achieve high throughput and low latency
- **Metrics**:
  - Finality time: <1 second (p95)
  - Throughput: >1000 vertices/sec (3-node network)
  - Throughput: >5000 vertices/sec (100-node network)
  - Memory: <500MB per node (100-node network)
  - CPU: <50% utilization at max throughput

#### NFR-002: Security
- **ID**: NFR-002
- **Category**: Security
- **Description**: Maintain quantum-resistant security guarantees
- **Metrics**:
  - All messages signed with ML-DSA-87
  - QUIC connections use hybrid X25519+ML-KEM-768
  - Vertex hashes use BLAKE3
  - No downgrade to classical crypto

#### NFR-003: Scalability
- **ID**: NFR-003
- **Category**: Scalability
- **Description**: Support large-scale distributed networks
- **Metrics**:
  - Minimum: 3 nodes (testing)
  - Target: 100 nodes (production)
  - Stretch: 1000+ nodes (future)
  - Linear scaling of consensus latency: O(log N)

#### NFR-004: Reliability
- **ID**: NFR-004
- **Category**: Reliability
- **Description**: System recovers from network partitions and failures
- **Metrics**:
  - Partition recovery: <5 seconds
  - Node crash recovery: <10 seconds
  - Message delivery: at-most-once semantics
  - State persistence: vertices stored in RocksDB

#### NFR-005: Observability
- **ID**: NFR-005
- **Category**: Observability
- **Description**: Comprehensive metrics and logging
- **Metrics**:
  - Prometheus metrics for consensus rounds, latency, throughput
  - Structured logging with tracing crate
  - Query response time histograms
  - Network partition detection

### 2.3 Constraints

#### Technical Constraints

1. **QUIC-Only Transport**
   - No TCP fallback allowed
   - Must use existing `QuicTransport` implementation
   - Leverage QUIC stream multiplexing for efficiency

2. **Quantum-Resistant Crypto**
   - All signatures must use ML-DSA-87
   - All handshakes must use hybrid X25519+ML-KEM-768
   - No downgrade to classical algorithms

3. **Existing DAG Structures**
   - Must use existing `Vertex`, `Graph`, `ConsensusEngine` types
   - Cannot break existing DAG API contracts
   - RocksDB storage backend required

4. **Rust Async**
   - Must use Tokio runtime (compatible with Quinn/QUIC)
   - Async/await for network operations
   - No blocking operations on async tasks

#### Business Constraints

1. **Timeline**: Phase 3 completion target: 4 weeks
2. **Resources**: 1 senior developer + 1 agent (specification)
3. **Budget**: No external dependencies requiring licenses

#### Regulatory Constraints

1. **Cryptographic Compliance**: Use NIST-standardized PQC algorithms
2. **Data Privacy**: No PII in vertex payloads (application layer concern)

### 2.4 Integration Points

#### 2.4.1 Phase 1: Crypto Integration

```rust
// cretoai-crypto crate provides:
use vigilia_crypto::{
    signatures::{MLDSA87, MLDSA87KeyPair, MLDSA87Signature},
    keys::AgentIdentity,
};

// Integration: Sign vertices with ML-DSA-87
vertex.sign_with_key(&agent_identity.mldsa_secret_key());

// Integration: Verify signatures on received vertices
vertex.verify_signature(&remote_agent_public_key)?;
```

**Dependencies**:
- `cretoai-crypto` crate (Phase 1)
- ML-DSA-87 for vertex signatures
- BLAKE3 for vertex hashing

#### 2.4.2 Phase 2: QUIC Integration

```rust
// cretoai-network crate provides:
use vigilia_network::libp2p::quic::{
    QuicTransport,
    QuicTransportConfig,
};

// Integration: Use QUIC for vertex propagation
let mut transport = QuicTransport::new(agent_identity, config)?;
transport.listen().await?;

// Send vertex over QUIC stream
let connection = transport.dial(peer_addr).await?;
let (mut send_stream, _recv_stream) = connection.open_bi().await?;
send_stream.write_all(&vertex_bytes).await?;
```

**Dependencies**:
- `cretoai-network` crate (Phase 2)
- `QuicTransport` for network connections
- Hybrid X25519+ML-KEM-768 handshake

#### 2.4.3 DAG Consensus Integration

```rust
// cretoai-dag crate provides:
use vigilia_dag::{
    vertex::{Vertex, VertexBuilder},
    graph::Graph,
    consensus::{ConsensusEngine, ConsensusParams},
};

// Integration: Add vertices to DAG and run consensus
let vertex = VertexBuilder::new(agent_id)
    .parents(selected_parents)
    .payload(transaction_data)
    .build();

graph.add_vertex(vertex.clone())?;
consensus_engine.run_consensus(&vertex.id)?;
```

**Dependencies**:
- `cretoai-dag` crate (existing)
- `ConsensusEngine` for Avalanche protocol
- `Graph` for DAG storage

---

## 3. Avalanche Consensus Specification

### 3.1 Protocol Overview

Avalanche is a leaderless Byzantine fault-tolerant consensus protocol that uses repeated random sampling and probabilistic safety guarantees. Unlike Nakamoto consensus (PoW) or classical BFT (PBFT), Avalanche achieves sub-second finality with high throughput by leveraging the DAG structure.

#### Key Concepts

1. **Chit**: A binary preference (0 or 1) indicating acceptance/rejection
2. **Confidence**: Accumulated chit values over multiple rounds
3. **Snowball Counter**: Consecutive successful queries meeting alpha threshold
4. **Finality**: When confidence exceeds threshold and snowball counter exceeds beta

### 3.2 Protocol Parameters

```rust
pub struct ConsensusParams {
    /// Sample size k for each query (typically 20-40)
    pub sample_size: usize,              // k = 30

    /// Alpha threshold for successful query (typically 80% of k)
    pub alpha_threshold: usize,          // α = 24 (80% of 30)

    /// Beta threshold for confidence accumulation (consecutive successes)
    pub beta_threshold: usize,           // β = 20

    /// Confidence threshold for finalization (0.0 to 1.0)
    pub finalization_threshold: f64,     // 0.95

    /// Maximum number of rounds before timeout
    pub max_rounds: u64,                 // 1000

    /// Minimum network size for consensus
    pub min_network_size: usize,         // 100
}
```

**Parameter Tuning Guidelines**:

- **k (sample_size)**: Higher k = more security, slower convergence
  - Small networks (3-10): k = min(10, N-1)
  - Medium networks (10-100): k = 30
  - Large networks (100+): k = 40

- **α (alpha_threshold)**: Typically 80% of k
  - Must satisfy: α > k/2 (simple majority)
  - Recommended: α = 0.8 * k

- **β (beta_threshold)**: Higher β = stronger safety, slower finality
  - Quick finality (testing): β = 5
  - Standard: β = 20
  - High security: β = 50

### 3.3 Vertex Propagation Protocol

#### 3.3.1 Vertex Creation

```rust
// Pseudocode: Create and propagate new vertex
fn propose_vertex(payload: Vec<u8>) -> Result<Vertex> {
    // Step 1: Select parent vertices
    let parents = select_parents()?;

    // Step 2: Build vertex
    let mut vertex = VertexBuilder::new(agent_id.clone())
        .parents(parents)
        .payload(payload)
        .build();

    // Step 3: Sign with ML-DSA
    vertex.sign_with_key(&agent_identity.mldsa_secret_key());

    // Step 4: Add to local DAG
    dag.add_vertex(vertex.clone())?;

    // Step 5: Propagate to network
    propagate_vertex(vertex.clone()).await?;

    // Step 6: Initiate consensus
    consensus_engine.run_consensus(&vertex.id)?;

    Ok(vertex)
}
```

#### 3.3.2 Parent Selection Algorithm

```rust
// Pseudocode: Select optimal parents for new vertex
fn select_parents() -> Result<Vec<VertexId>> {
    // Criteria:
    // 1. High confidence (>0.8)
    // 2. Recent (last 10 seconds)
    // 3. Well-connected (many children)
    // 4. Not finalized (prefer active vertices)

    let candidates = dag
        .get_vertices()
        .filter(|v| v.metadata.confidence > 0.8)
        .filter(|v| age(v) < Duration::from_secs(10))
        .sorted_by_key(|v| v.metadata.confirmations)
        .take(10)
        .collect();

    // Select 2 random parents from top candidates
    let mut rng = rand::thread_rng();
    let selected = candidates
        .choose_multiple(&mut rng, 2)
        .map(|v| v.id.clone())
        .collect();

    Ok(selected)
}
```

#### 3.3.3 Vertex Propagation

```rust
// Pseudocode: Propagate vertex to network
async fn propagate_vertex(vertex: Vertex) -> Result<()> {
    // Serialize vertex with bincode (compact binary format)
    let vertex_bytes = bincode::serialize(&vertex)?;

    // Send to all connected peers via QUIC
    let peers = get_connected_peers();

    for peer_addr in peers {
        let connection = get_connection(peer_addr)?;

        // Open bidirectional stream
        let (mut send, _recv) = connection.open_bi().await?;

        // Send vertex data
        send.write_all(&vertex_bytes).await?;
        send.finish().await?;
    }

    Ok(())
}
```

### 3.4 Query-Response Protocol

#### 3.4.1 Query Phase

```rust
// Pseudocode: Query network for vertex preference
async fn query_network(vertex_id: &VertexId) -> Result<Vec<ConsensusResponse>> {
    // Step 1: Sample k random nodes
    let sample = sample_random_nodes(params.sample_size)?;

    // Step 2: Create query message
    let query = ConsensusQuery {
        query_id: Uuid::new_v4().to_string(),
        vertex_id: vertex_id.clone(),
        requester: agent_id.clone(),
        timestamp: now(),
    };

    // Step 3: Send queries in parallel
    let mut response_futures = Vec::new();

    for node_addr in sample {
        let query_clone = query.clone();
        let future = send_query_to_node(node_addr, query_clone);
        response_futures.push(future);
    }

    // Step 4: Wait for responses with timeout
    let responses = timeout(
        Duration::from_secs(1),
        join_all(response_futures)
    ).await?;

    // Step 5: Verify signatures and filter valid responses
    let valid_responses = responses
        .into_iter()
        .filter(|r| verify_response_signature(r).is_ok())
        .collect();

    Ok(valid_responses)
}
```

#### 3.4.2 Response Phase

```rust
// Pseudocode: Respond to consensus query
async fn handle_query(query: ConsensusQuery) -> Result<()> {
    // Step 1: Lookup vertex in local DAG
    let vertex = dag.get_vertex(&query.vertex_id)?;

    // Step 2: Calculate vote based on vertex validity
    let vote = calculate_vote(&vertex)?;

    // Step 3: Calculate confidence based on parent chain
    let confidence = calculate_confidence(&vertex)?;

    // Step 4: Create response
    let response = ConsensusResponse {
        query_id: query.query_id,
        vertex_id: query.vertex_id,
        responder: agent_id.clone(),
        vote,
        confidence,
        timestamp: now(),
        signature: vec![], // Set below
    };

    // Step 5: Sign response with ML-DSA
    let response_bytes = bincode::serialize(&response)?;
    let signature = mldsa_keypair.sign(&response_bytes);
    response.signature = signature.as_bytes().to_vec();

    // Step 6: Send response over QUIC
    send_response_to_requester(&query.requester, response).await?;

    Ok(())
}
```

#### 3.4.3 Vote Calculation

```rust
// Pseudocode: Calculate vote for a vertex
fn calculate_vote(vertex: &Vertex) -> Result<bool> {
    // Vote = true if vertex is valid, false otherwise

    // Check 1: Valid hash
    if vertex.verify_hash().is_err() {
        return Ok(false);
    }

    // Check 2: Valid signature
    let creator_pubkey = get_agent_public_key(&vertex.creator)?;
    if vertex.verify_signature(&creator_pubkey).is_err() {
        return Ok(false);
    }

    // Check 3: Parents exist and are valid
    for parent_id in &vertex.parents {
        let parent = dag.get_vertex(parent_id)?;
        if parent.verify_hash().is_err() {
            return Ok(false);
        }
    }

    // Check 4: No conflicts with finalized vertices
    if has_conflicts_with_finalized(vertex)? {
        return Ok(false);
    }

    Ok(true)
}
```

### 3.5 Confidence Calculation

```rust
// Pseudocode: Update confidence after query round
fn update_confidence(
    vertex_id: &VertexId,
    responses: Vec<ConsensusResponse>,
) -> Result<f64> {
    let positive_count = responses.iter()
        .filter(|r| r.vote)
        .count();

    let total_count = responses.len();
    let response_ratio = positive_count as f64 / total_count as f64;

    // Get current confidence
    let vertex = dag.get_vertex(vertex_id)?;
    let prev_confidence = vertex.metadata.confidence;

    // Exponential moving average: 90% old, 10% new
    let new_confidence = (prev_confidence * 0.9) + (response_ratio * 0.1);

    // Update vertex metadata
    vertex.metadata.confidence = new_confidence;
    dag.update_vertex(vertex)?;

    Ok(new_confidence)
}
```

### 3.6 Finality Conditions

```rust
// Pseudocode: Check if vertex can be finalized
fn check_finality(vertex_id: &VertexId, state: &ConsensusState) -> Result<bool> {
    // Condition 1: Beta consecutive successes
    if state.consecutive_successes < params.beta_threshold {
        return Ok(false);
    }

    // Condition 2: Confidence exceeds threshold
    if state.confidence < params.finalization_threshold {
        return Ok(false);
    }

    // Condition 3: Not already finalized
    let vertex = dag.get_vertex(vertex_id)?;
    if vertex.metadata.finalized {
        return Ok(false);
    }

    // All conditions met - finalize!
    finalize_vertex(vertex_id)?;

    Ok(true)
}

fn finalize_vertex(vertex_id: &VertexId) -> Result<()> {
    let mut vertex = dag.get_vertex(vertex_id)?;

    // Mark as finalized
    vertex.metadata.finalized = true;
    vertex.metadata.confidence = 1.0;

    // Persist to storage
    dag.update_vertex(vertex)?;
    storage.persist_vertex(vertex)?;

    // Propagate finality to children
    propagate_finality(vertex_id)?;

    Ok(())
}
```

### 3.7 Byzantine Fault Tolerance

#### 3.7.1 Threat Model

**Assumptions**:
- Network is partially synchronous (bounded message delay)
- Up to 33% of nodes are Byzantine (malicious or faulty)
- Byzantine nodes can: send arbitrary messages, collude, withhold messages
- Byzantine nodes cannot: break cryptography, forge signatures

**Safety Guarantee** (Probabilistic):
```
P(safety violation) < (1 - α/k)^β
```
With α=24, k=30, β=20:
```
P(safety) > 1 - (1 - 0.8)^20 = 1 - 0.2^20 ≈ 0.99999999999999
```

#### 3.7.2 Byzantine Detection

```rust
// Pseudocode: Detect Byzantine behavior
fn detect_byzantine_behavior(node_id: &str) -> ByzantineScore {
    let mut score = 0.0;

    // Check 1: Invalid signatures
    if has_invalid_signatures(node_id) {
        score += 0.5;
    }

    // Check 2: Conflicting votes
    if has_conflicting_votes(node_id) {
        score += 0.3;
    }

    // Check 3: Timeout violations
    if has_excessive_timeouts(node_id) {
        score += 0.2;
    }

    // Check 4: Malformed messages
    if has_malformed_messages(node_id) {
        score += 0.4;
    }

    if score > 0.5 {
        ByzantineScore::Malicious(score)
    } else {
        ByzantineScore::Honest
    }
}
```

#### 3.7.3 Byzantine Mitigation

```rust
// Pseudocode: Mitigate Byzantine nodes
fn mitigate_byzantine_node(node_id: &str) -> Result<()> {
    // Strategy 1: Exclude from sampling
    excluded_nodes.insert(node_id.to_string());

    // Strategy 2: Ignore responses
    response_filter.add_ignored(node_id);

    // Strategy 3: Close connections
    disconnect_peer(node_id).await?;

    // Strategy 4: Alert network
    broadcast_byzantine_alert(node_id).await?;

    Ok(())
}
```

---

## 4. Network Protocol Design

### 4.1 Message Types

#### 4.1.1 Vertex Propagation Message

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VertexMessage {
    /// Message type identifier
    pub msg_type: u8,  // 0x01 = Vertex

    /// Vertex ID (UUID)
    pub vertex_id: String,

    /// Parent vertex IDs
    pub parents: Vec<String>,

    /// Transaction payload (arbitrary bytes)
    pub payload: Vec<u8>,

    /// Timestamp (milliseconds since epoch)
    pub timestamp: u64,

    /// Creator agent ID
    pub creator: String,

    /// ML-DSA-87 signature (vertex hash signed)
    pub signature: Vec<u8>,

    /// BLAKE3 hash of vertex content
    pub hash: [u8; 32],
}
```

**Size Estimate**:
- Fixed overhead: ~100 bytes
- Parents (2 UUIDs): ~72 bytes
- Payload: variable (typically 100-1000 bytes)
- Signature (ML-DSA-87): 4595 bytes
- **Total**: ~4867 bytes typical

#### 4.1.2 Consensus Query Message

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsensusQuery {
    /// Message type identifier
    pub msg_type: u8,  // 0x02 = Query

    /// Query ID (UUID)
    pub query_id: String,

    /// Vertex ID being queried
    pub vertex_id: String,

    /// Requester agent ID
    pub requester: String,

    /// Query timestamp
    pub timestamp: u64,

    /// ML-DSA-87 signature
    pub signature: Vec<u8>,
}
```

**Size Estimate**: ~4700 bytes

#### 4.1.3 Consensus Response Message

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsensusResponse {
    /// Message type identifier
    pub msg_type: u8,  // 0x03 = Response

    /// Query ID this responds to
    pub query_id: String,

    /// Vertex ID
    pub vertex_id: String,

    /// Responder agent ID
    pub responder: String,

    /// Vote: true = accept, false = reject
    pub vote: bool,

    /// Confidence score (0.0 - 1.0)
    pub confidence: f64,

    /// Response timestamp
    pub timestamp: u64,

    /// ML-DSA-87 signature
    pub signature: Vec<u8>,
}
```

**Size Estimate**: ~4710 bytes

### 4.2 Serialization Format

**Choice**: **bincode** (compact binary serialization)

**Rationale**:
- Smaller message size vs serde_json (~40% reduction)
- Faster serialization/deserialization (~3x)
- Type-safe (strong Rust typing)
- Well-tested in production systems

**Alternative Considered**: serde_json
- Rejected: Human readability not critical for network protocol
- Rejected: Larger message size impacts bandwidth
- Kept for: Logging/debugging (not on wire)

### 4.3 QUIC Stream Usage

#### 4.3.1 Stream Types

1. **Unidirectional Streams**: Vertex propagation (fire-and-forget)
2. **Bidirectional Streams**: Consensus queries (request-response)

```rust
// Vertex propagation (unidirectional)
async fn send_vertex(connection: &Connection, vertex: &Vertex) -> Result<()> {
    let mut send_stream = connection.open_uni().await?;
    let vertex_msg = VertexMessage::from(vertex);
    let bytes = bincode::serialize(&vertex_msg)?;
    send_stream.write_all(&bytes).await?;
    send_stream.finish().await?;
    Ok(())
}

// Consensus query (bidirectional)
async fn send_query(
    connection: &Connection,
    query: ConsensusQuery,
) -> Result<ConsensusResponse> {
    let (mut send, mut recv) = connection.open_bi().await?;

    // Send query
    let query_bytes = bincode::serialize(&query)?;
    send.write_all(&query_bytes).await?;
    send.finish().await?;

    // Receive response
    let response_bytes = recv.read_to_end(10_000).await?;  // 10KB max
    let response = bincode::deserialize(&response_bytes)?;

    Ok(response)
}
```

#### 4.3.2 Flow Control

QUIC provides automatic flow control:
- Stream-level backpressure
- Connection-level congestion control
- Automatic retransmission
- Loss detection and recovery

**No application-level flow control needed**.

### 4.4 Gossip Strategy

#### 4.4.1 Strategy: Structured Gossip (Not Random)

**Decision**: Use **structured gossip** based on peer roles and network topology.

**Rationale**:
- More efficient than random gossip (reduces redundant transmissions)
- Leverages QUIC's connection multiplexing
- Supports future sharding/partitioning

**Implementation**:

```rust
// Gossip to structured peers
async fn gossip_vertex(vertex: &Vertex) -> Result<()> {
    // Tier 1: Direct neighbors (always send)
    let neighbors = get_direct_neighbors();
    for peer in neighbors {
        send_vertex(&peer, vertex).await?;
    }

    // Tier 2: Random sample (gossip protocol)
    let sample = sample_random_peers(5);
    for peer in sample {
        send_vertex(&peer, vertex).await?;
    }

    Ok(())
}
```

### 4.5 Conflict Resolution

#### 4.5.1 Conflict Types

1. **Double-spend**: Two vertices with conflicting transactions
2. **Fork**: Two vertices with same parent but different payloads
3. **Partition**: Network split leads to divergent DAGs

#### 4.5.2 Resolution Rules

```rust
// Pseudocode: Resolve conflict between two vertices
fn resolve_conflict(v1: &Vertex, v2: &Vertex) -> Vertex {
    // Rule 1: Higher confidence wins
    if v1.metadata.confidence > v2.metadata.confidence {
        return v1.clone();
    }

    // Rule 2: Earlier timestamp wins (tie-breaker)
    if v1.timestamp < v2.timestamp {
        return v1.clone();
    }

    // Rule 3: Lexicographic ID comparison (deterministic)
    if v1.id < v2.id {
        return v1.clone();
    }

    v2.clone()
}
```

---

## 5. Data Flow Architecture

### 5.1 Vertex Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                    Vertex Lifecycle                             │
└─────────────────────────────────────────────────────────────────┘

[1] CREATE
    │
    ├─ Select parents (algorithm: prefer recent, high-confidence)
    ├─ Build vertex (VertexBuilder)
    ├─ Compute hash (BLAKE3)
    ├─ Sign with ML-DSA-87
    │
    ▼

[2] PROPAGATE
    │
    ├─ Add to local DAG
    ├─ Serialize with bincode
    ├─ Send via QUIC (unidirectional streams)
    ├─ Gossip to k random peers
    │
    ▼

[3] RECEIVE
    │
    ├─ Deserialize from bincode
    ├─ Verify signature (ML-DSA-87)
    ├─ Verify hash (BLAKE3)
    ├─ Check parents exist
    ├─ Deduplicate (vertex cache)
    │
    ▼

[4] CONSENSUS
    │
    ├─ [Round 1] Query k nodes
    │   ├─ Send ConsensusQuery
    │   ├─ Receive ConsensusResponse
    │   └─ Aggregate votes
    │
    ├─ [Round 2] Update confidence
    │   ├─ Calculate response ratio
    │   ├─ Update exponential moving average
    │   └─ Increment consecutive successes if α met
    │
    ├─ [Round N] Repeat until finalized
    │
    ▼

[5] FINALIZE
    │
    ├─ Check β consecutive successes
    ├─ Check confidence > threshold
    ├─ Mark vertex as finalized
    ├─ Persist to RocksDB
    ├─ Propagate finality to children
    │
    ▼

[6] PERSIST
    │
    └─ Store in RocksDB
```

### 5.2 Query-Response Flow

```
┌────────────────────────────────────────────────────────────────┐
│              Consensus Query-Response Pattern                  │
└────────────────────────────────────────────────────────────────┘

    REQUESTER NODE                                  RESPONDER NODES

    [1] SELECT VERTEX
         │
         ├─ vertex_id = "v123"
         │
         ▼

    [2] SAMPLE PEERS
         │
         ├─ Sample k=30 random nodes
         │
         ▼

    [3] SEND QUERIES ─────────────────────────────► [4] RECEIVE QUERY
                                                          │
         (ConsensusQuery)                                 ├─ Lookup vertex in DAG
                                                          ├─ Calculate vote
         QUIC Bidirectional Stream                        ├─ Calculate confidence
                                                          ├─ Sign response (ML-DSA)
                                                          │
                                                          ▼

    [6] RECEIVE RESPONSES ◄───────────────────────── [5] SEND RESPONSE
         │
         ├─ Verify signatures                            (ConsensusResponse)
         ├─ Count positive votes
         ├─ response_ratio = positive / total
         │
         ▼

    [7] UPDATE CONFIDENCE
         │
         ├─ confidence = 0.9 * prev + 0.1 * ratio
         ├─ consecutive_successes++ if ratio > α
         │
         ▼

    [8] CHECK FINALITY
         │
         ├─ consecutive_successes >= β ?
         ├─ confidence >= 0.95 ?
         │
         ▼

    [9] FINALIZE or REPEAT
```

### 5.3 Network Partition Recovery

```
┌────────────────────────────────────────────────────────────────┐
│              Network Partition Recovery                        │
└────────────────────────────────────────────────────────────────┘

    NORMAL OPERATION              PARTITION              RECOVERY

    ┌─────────────┐              ┌─────────────┐      ┌─────────────┐
    │  Partition A │              │  Partition A │      │  Partition A │
    │  (60 nodes)  │              │  (60 nodes)  │      │  (60 nodes)  │
    │              │              │              │      │              │
    │   DAG-A      │              │   DAG-A      │      │   DAG-A      │
    │   (growing)  │              │   (growing)  │      │   (merged)   │
    └──────┬───────┘              └──────┬───────┘      └──────┬───────┘
           │                              │                     │
           │ gossip                       │ partition           │ reconcile
           │                              │                     │
           ▼                              ▼                     ▼
    ┌─────────────┐              ┌─────────────┐      ┌─────────────┐
    │  Partition B │   ───X───►  │  Partition B │      │  Partition B │
    │  (40 nodes)  │              │  (40 nodes)  │      │  (40 nodes)  │
    │              │              │              │      │              │
    │   DAG-B      │              │   DAG-B      │      │   DAG-B      │
    │   (growing)  │              │   (diverged) │      │   (merged)   │
    └──────────────┘              └──────────────┘      └──────────────┘

Recovery Algorithm:

1. DETECT PARTITION
   - Monitor query timeout rates
   - If >50% queries timeout → partition detected

2. CONTINUE OPERATION
   - Larger partition (A) continues normal consensus
   - Smaller partition (B) operates independently

3. RECONNECT
   - TCP/IP route restored
   - QUIC connections re-established

4. RECONCILE DAGs
   - Exchange missing vertices
   - Re-run consensus on conflicting vertices
   - Resolve conflicts (higher confidence wins)

5. RESUME NORMAL OPERATION
   - Single unified DAG
   - Resume normal consensus rounds
```

---

## 6. Integration Points

### 6.1 API Contracts

#### 6.1.1 QuicConsensusTransport Trait

```rust
/// QUIC-based transport for consensus protocol
#[async_trait]
pub trait QuicConsensusTransport {
    /// Send vertex to peer
    async fn send_vertex(
        &self,
        peer_addr: SocketAddr,
        vertex: &Vertex,
    ) -> Result<()>;

    /// Send consensus query to peer
    async fn send_query(
        &self,
        peer_addr: SocketAddr,
        query: ConsensusQuery,
    ) -> Result<ConsensusResponse>;

    /// Broadcast vertex to all peers
    async fn broadcast_vertex(&self, vertex: &Vertex) -> Result<usize>;

    /// Batch query multiple peers
    async fn batch_query(
        &self,
        peers: Vec<SocketAddr>,
        query: ConsensusQuery,
    ) -> Result<Vec<ConsensusResponse>>;
}
```

#### 6.1.2 ConsensusNetworkBridge

```rust
/// Bridge between DAG consensus engine and QUIC network
pub struct ConsensusNetworkBridge {
    /// QUIC transport
    transport: Arc<QuicTransport>,

    /// DAG consensus engine
    consensus: Arc<ConsensusEngine>,

    /// Message router
    router: MessageRouter,

    /// Peer registry
    peers: Arc<RwLock<PeerRegistry>>,
}

impl ConsensusNetworkBridge {
    /// Create new bridge
    pub fn new(
        transport: Arc<QuicTransport>,
        consensus: Arc<ConsensusEngine>,
    ) -> Self;

    /// Start listening for incoming messages
    pub async fn start(&mut self) -> Result<()>;

    /// Propose new vertex to network
    pub async fn propose_vertex(&self, payload: Vec<u8>) -> Result<Vertex>;

    /// Handle incoming vertex from network
    async fn handle_vertex(&self, vertex: Vertex) -> Result<()>;

    /// Handle incoming query from network
    async fn handle_query(&self, query: ConsensusQuery) -> Result<()>;
}
```

### 6.2 Dependency Graph

```
┌─────────────────────────────────────────────────────────────────┐
│                    Dependency Graph                             │
└─────────────────────────────────────────────────────────────────┘

cretoai-consensus (NEW)
    ├─ cretoai-network (Phase 2)
    │   ├─ QuicTransport
    │   ├─ QuicTransportConfig
    │   └─ HybridTlsConfig
    │
    ├─ cretoai-dag (existing)
    │   ├─ Vertex
    │   ├─ Graph
    │   ├─ ConsensusEngine
    │   └─ ConsensusParams
    │
    ├─ cretoai-crypto (Phase 1)
    │   ├─ MLDSA87
    │   ├─ MLDSA87KeyPair
    │   └─ AgentIdentity
    │
    └─ External Dependencies
        ├─ tokio (async runtime)
        ├─ quinn (QUIC)
        ├─ bincode (serialization)
        ├─ serde (trait)
        └─ tracing (logging)
```

### 6.3 Error Handling

```rust
/// Consensus network errors
#[derive(Debug, thiserror::Error)]
pub enum ConsensusNetworkError {
    /// Network transport error
    #[error("Transport error: {0}")]
    Transport(#[from] NetworkError),

    /// DAG error
    #[error("DAG error: {0}")]
    Dag(#[from] DagError),

    /// Serialization error
    #[error("Serialization error: {0}")]
    Serialization(String),

    /// Signature verification failed
    #[error("Signature verification failed")]
    InvalidSignature,

    /// Query timeout
    #[error("Query timeout after {0:?}")]
    Timeout(Duration),

    /// Insufficient responses
    #[error("Insufficient responses: got {got}, need {need}")]
    InsufficientResponses { got: usize, need: usize },

    /// Byzantine behavior detected
    #[error("Byzantine behavior detected from {0}")]
    Byzantine(String),

    /// Network partition detected
    #[error("Network partition detected")]
    Partition,
}
```

---

## 7. Success Criteria

### 7.1 Functional Success Criteria

| Criterion | Metric | Target | Verification Method |
|-----------|--------|--------|---------------------|
| **FS-001**: 3-node consensus | Finality achieved | 100% success | Integration test |
| **FS-002**: Byzantine tolerance | Consensus with 1 malicious node | 100% success | Integration test |
| **FS-003**: Vertex propagation | All nodes receive vertex | <500ms p95 | Benchmark |
| **FS-004**: Query-response | Response from k nodes | >90% success rate | Unit test |
| **FS-005**: Conflict resolution | Deterministic resolution | 100% consistency | Integration test |

### 7.2 Performance Success Criteria

| Criterion | Metric | Target | Verification Method |
|-----------|--------|--------|---------------------|
| **PS-001**: Finality time | Time to finalize vertex | <1s p95 | Benchmark |
| **PS-002**: Throughput | Vertices finalized/sec | >1000 (3 nodes) | Benchmark |
| **PS-003**: Throughput | Vertices finalized/sec | >5000 (100 nodes) | Load test |
| **PS-004**: Memory usage | Per-node memory | <500MB (100 nodes) | Resource monitor |
| **PS-005**: CPU usage | Per-node CPU | <50% at max throughput | Resource monitor |

### 7.3 Security Success Criteria

| Criterion | Metric | Target | Verification Method |
|-----------|--------|--------|---------------------|
| **SS-001**: Quantum resistance | All crypto uses PQC | 100% | Code audit |
| **SS-002**: Signature verification | Invalid signatures rejected | 100% | Fuzz test |
| **SS-003**: Byzantine detection | Malicious nodes detected | >95% | Security test |
| **SS-004**: Partition recovery | DAG consistency after merge | 100% | Chaos test |

### 7.4 Reliability Success Criteria

| Criterion | Metric | Target | Verification Method |
|-----------|--------|--------|---------------------|
| **RS-001**: Partition recovery | Time to reconcile | <5s | Chaos test |
| **RS-002**: Node crash recovery | Time to rejoin | <10s | Chaos test |
| **RS-003**: Message delivery | At-most-once semantics | 100% | Integration test |
| **RS-004**: State persistence | Vertices survive restart | 100% | Restart test |

---

## 8. Implementation Roadmap

### 8.1 Phase 3A: Core Integration (Week 1-2)

**Goal**: Replace gossip protocol with QUIC transport

#### Tasks:
1. ✅ Create `cretoai-consensus` crate
2. ✅ Implement `QuicConsensusTransport` trait
3. ✅ Implement vertex serialization (bincode)
4. ✅ Implement unidirectional streams for vertex propagation
5. ✅ Implement bidirectional streams for query-response
6. ✅ Add signature verification to message handlers
7. ✅ Write unit tests for message serialization
8. ✅ Write integration tests for 3-node consensus

**Acceptance Criteria**:
- 3 nodes can propagate vertices via QUIC
- All messages signed with ML-DSA-87
- Basic consensus (no Byzantine) works

### 8.2 Phase 3B: Byzantine Tolerance (Week 2-3)

**Goal**: Add Byzantine fault tolerance and detection

#### Tasks:
1. ✅ Implement Byzantine behavior detection
2. ✅ Add node reputation tracking
3. ✅ Implement response signature verification
4. ✅ Add Byzantine mitigation (exclusion, filtering)
5. ✅ Write security tests with 1 malicious node
6. ✅ Write security tests with 2 malicious nodes (33%)
7. ✅ Add Byzantine alerts and logging

**Acceptance Criteria**:
- System tolerates 1 malicious node (3-node network)
- System tolerates 33% malicious nodes (100-node network)
- Byzantine behavior logged and mitigated

### 8.3 Phase 3C: Performance & Scalability (Week 3-4)

**Goal**: Optimize for production throughput

#### Tasks:
1. ✅ Add connection pooling
2. ✅ Implement parallel query sending (tokio::spawn)
3. ✅ Add caching for recent queries
4. ✅ Optimize serialization (zero-copy where possible)
5. ✅ Add backpressure handling
6. ✅ Write benchmarks for throughput
7. ✅ Write benchmarks for latency
8. ✅ Profile and optimize hot paths

**Acceptance Criteria**:
- Finality time <1s p95 (3-node network)
- Throughput >1000 vertices/sec (3-node network)
- Throughput >5000 vertices/sec (100-node network)
- Memory <500MB per node (100-node network)

### 8.4 Phase 3D: Production Readiness (Week 4)

**Goal**: Deploy-ready system with monitoring

#### Tasks:
1. ✅ Add Prometheus metrics
2. ✅ Add structured logging (tracing)
3. ✅ Implement partition detection and recovery
4. ✅ Add health checks
5. ✅ Write deployment documentation
6. ✅ Write operational runbook
7. ✅ Conduct load testing
8. ✅ Conduct chaos testing (partition, crash, Byzantine)

**Acceptance Criteria**:
- Prometheus metrics exported
- Partition recovery <5s
- Node crash recovery <10s
- Operational documentation complete

---

## Appendices

### Appendix A: Reference Implementation Pseudocode

```rust
// Full consensus loop
async fn consensus_loop(bridge: Arc<ConsensusNetworkBridge>) -> Result<()> {
    loop {
        // Get pending vertices from DAG
        let pending = bridge.consensus.get_pending_vertices()?;

        for vertex_id in pending {
            // Run one consensus round
            let responses = bridge.query_network(&vertex_id).await?;

            // Update confidence
            let confidence = bridge.consensus.update_confidence(
                &vertex_id,
                responses,
            )?;

            // Check finality
            if confidence >= 0.95 {
                bridge.consensus.finalize_vertex(&vertex_id)?;
            }
        }

        // Sleep between rounds
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}
```

### Appendix B: Test Scenarios

#### Scenario 1: Happy Path (3 Nodes)

```
Given: 3 honest nodes (A, B, C)
When: Node A proposes vertex V1
Then:
  - V1 propagated to B and C within 100ms
  - Query round 1: A queries B and C
  - B and C both vote "accept" (100% confidence)
  - After 5 rounds: V1 finalized
  - Finality time: <500ms
```

#### Scenario 2: Byzantine Node (4 Nodes)

```
Given: 3 honest nodes (A, B, C), 1 Byzantine node (D)
When: Node A proposes vertex V1
Then:
  - D sends invalid votes (Byzantine behavior)
  - A, B, C outvote D (75% confidence)
  - After 20 rounds: V1 finalized
  - D excluded from future queries
  - Finality time: <1s
```

#### Scenario 3: Network Partition (6 Nodes)

```
Given: 6 nodes split into partitions [A,B,C] and [D,E,F]
When: Network partition occurs
Then:
  - Partition [A,B,C] continues (larger partition)
  - Partition [D,E,F] detects partition (timeout)
  - After network heal:
    - DAGs reconciled
    - Conflicts resolved
    - Single unified DAG
  - Recovery time: <5s
```

### Appendix C: Glossary

| Term | Definition |
|------|------------|
| **Avalanche** | Leaderless BFT consensus protocol using repeated random sampling |
| **Chit** | Binary preference (0 or 1) indicating vertex acceptance |
| **Confidence** | Accumulated acceptance score (0.0 to 1.0) |
| **DAG** | Directed Acyclic Graph - data structure for vertex ordering |
| **Finality** | Irreversible commitment of a vertex |
| **ML-DSA-87** | Post-quantum signature algorithm (formerly CRYSTALS-Dilithium) |
| **ML-KEM-768** | Post-quantum key encapsulation mechanism |
| **QUIC** | Modern transport protocol (UDP-based, multiplexed streams) |
| **Snowball** | Consensus algorithm family (Snowflake, Snowball, Avalanche) |
| **Vertex** | Node in the DAG representing a transaction or event |

---

## Document Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2025-11-27 | SPARC Specification Agent | Initial specification |

---

**END OF SPECIFICATION**
