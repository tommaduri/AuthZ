# CretoAI Network Module - Implementation Plan

**Status**: Phase 3 of CretoAI AI Roadmap
**Priority**: HIGH - Critical for distributed consensus
**Current Completion**: 5% (skeleton only)
**Target Completion**: 100% production-ready

---

## 🎯 Overview

The Network Module provides P2P networking infrastructure with quantum-resistant security, privacy-preserving dark domains, and efficient message propagation for the CretoAI AI distributed consensus system.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Network Layer                             │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   P2P Core   │  │  Transport   │  │ Dark Domain  │      │
│  │   (LibP2P)   │  │    (QUIC)    │  │  Isolation   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Discovery   │  │    Gossip    │  │    Relay     │      │
│  │ (Kademlia)   │  │   Protocol   │  │ NAT Trav.    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                               │
│  ┌────────────────────────────────────────────────────┐     │
│  │     Quantum-Resistant Security (cretoai-crypto)    │     │
│  │  - ML-KEM-768 Key Exchange  - BLAKE3 Hashing      │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 Module Structure

### Current Files (Skeleton)
```
src/network/
├── Cargo.toml              ✅ Dependencies configured
├── src/
│   ├── lib.rs              ✅ Module exports
│   ├── error.rs            ✅ Error types
│   ├── p2p.rs              🔨 Placeholder (4 lines)
│   ├── transport.rs        🔨 Placeholder (4 lines)
│   ├── dark_domain.rs      🔨 Placeholder (4 lines)
│   ├── discovery.rs        🔨 Placeholder (4 lines)
│   ├── gossip.rs           🔨 Placeholder (4 lines)
│   └── relay.rs            🔨 Placeholder (4 lines)
└── benches/
    └── network_bench.rs    🔨 Placeholder
```

---

## 🚀 Implementation Phases

### Phase 1: LibP2P Core P2P (p2p.rs) ⭐ **START HERE**

**Goal**: Establish basic peer-to-peer networking foundation

**Components to Implement**:

```rust
// Core structures
pub struct P2PNode {
    local_peer_id: PeerId,
    swarm: Swarm<Behaviour>,
    keypair: Keypair,
    config: P2PConfig,
}

pub struct P2PConfig {
    pub listen_addresses: Vec<Multiaddr>,
    pub max_peers: usize,
    pub connection_timeout: Duration,
    pub enable_mdns: bool,
    pub enable_relay: bool,
}

pub struct Behaviour {
    kademlia: Kademlia<MemoryStore>,
    gossipsub: Gossipsub,
    mdns: Mdns,
    identify: Identify,
}
```

**Features**:
- ✅ Peer ID management with quantum-resistant keys
- ✅ Swarm initialization and configuration
- ✅ Connection management (dial, accept, disconnect)
- ✅ Peer tracking and metadata
- ✅ Event handling loop
- ✅ Multi-address support

**Dependencies Used**:
- `libp2p::Swarm`
- `libp2p::PeerId`
- `libp2p::Multiaddr`
- `cretoai-crypto` for key generation

**Tests Required**:
1. Peer connection establishment
2. Multiple peer management
3. Peer disconnection handling
4. Event processing
5. Configuration validation

**Estimated Lines**: ~500-700

---

### Phase 2: QUIC Transport with PQC (transport.rs)

**Goal**: Implement quantum-safe QUIC transport layer

**Components to Implement**:

```rust
pub struct QuicTransport {
    endpoint: quinn::Endpoint,
    server_config: quinn::ServerConfig,
    client_config: quinn::ClientConfig,
    pqc_keys: PQCKeyPair,
}

pub struct PQCHandshake {
    kem_keypair: MLKem768KeyPair,
    sig_keypair: MLDSA87KeyPair,
}

pub struct TransportConfig {
    pub bind_address: SocketAddr,
    pub max_idle_timeout: Duration,
    pub keep_alive_interval: Duration,
    pub max_concurrent_streams: u64,
    pub enable_0rtt: bool,
}
```

**Features**:
- ✅ QUIC endpoint setup
- ✅ Post-quantum TLS handshake
- ✅ Hybrid key exchange (X25519 + ML-KEM-768)
- ✅ Stream multiplexing
- ✅ Connection migration
- ✅ 0-RTT support

**Security Integration**:
- ML-KEM-768 for key encapsulation
- BLAKE3 for session keys
- Certificate validation

**Tests Required**:
1. QUIC connection establishment
2. PQC handshake verification
3. Stream creation and data transfer
4. Connection migration
5. Error handling and retries

**Estimated Lines**: ~600-800

---

### Phase 3: Dark Domain Isolation (dark_domain.rs)

**Goal**: Privacy-preserving network isolation with onion routing

**Components to Implement**:

```rust
pub struct DarkDomain {
    domain_id: String,
    onion_router: OnionRouter,
    entry_nodes: Vec<PeerId>,
    circuit_cache: CircuitCache,
}

pub struct OnionRouter {
    layers: usize,
    path: Vec<PeerId>,
    encryption_keys: Vec<Vec<u8>>,
}

pub struct Circuit {
    circuit_id: Uuid,
    path: Vec<PeerId>,
    created_at: SystemTime,
    last_used: SystemTime,
}
```

**Features**:
- ✅ Multi-hop routing (3-layer default)
- ✅ Onion encryption with BLAKE3
- ✅ Circuit building and management
- ✅ Entry/exit node selection
- ✅ .dark domain resolution
- ✅ Circuit rotation policies

**Privacy Guarantees**:
- No single node knows full path
- Encrypted layers using cretoai-crypto
- Timing obfuscation

**Tests Required**:
1. Circuit construction
2. Onion encryption/decryption
3. Message routing through circuit
4. Circuit rotation
5. Node failure handling

**Estimated Lines**: ~700-900

---

### Phase 4: Kademlia DHT Discovery (discovery.rs)

**Goal**: Distributed peer discovery and routing

**Components to Implement**:

```rust
pub struct Discovery {
    dht: Kademlia<MemoryStore>,
    local_peer_id: PeerId,
    bootstrap_nodes: Vec<Multiaddr>,
    routing_table: RoutingTable,
}

pub struct RoutingTable {
    buckets: Vec<KBucket>,
    local_key: Key,
}

pub struct PeerInfo {
    peer_id: PeerId,
    addresses: Vec<Multiaddr>,
    last_seen: SystemTime,
    reputation: f64,
}
```

**Features**:
- ✅ Kademlia DHT implementation
- ✅ Bootstrap node connection
- ✅ Peer lookup (FIND_NODE)
- ✅ Content routing (FIND_VALUE)
- ✅ Routing table management
- ✅ Peer reputation tracking

**Performance Targets**:
- Lookup: O(log N) hops
- Routing table: k=20 peers per bucket
- Bootstrap: < 5 seconds

**Tests Required**:
1. Bootstrap process
2. Peer lookup
3. Routing table updates
4. Content storage/retrieval
5. Network churn handling

**Estimated Lines**: ~500-700

---

### Phase 5: Gossip Protocol (gossip.rs)

**Goal**: Efficient message propagation across the network

**Components to Implement**:

```rust
pub struct GossipProtocol {
    pubsub: Gossipsub,
    topics: HashMap<TopicHash, Topic>,
    message_cache: MessageCache,
    validators: Vec<Box<dyn MessageValidator>>,
}

pub struct Message {
    id: MessageId,
    topic: TopicHash,
    data: Vec<u8>,
    signature: Vec<u8>,
    timestamp: SystemTime,
}

pub struct GossipConfig {
    pub heartbeat_interval: Duration,
    pub history_length: usize,
    pub history_gossip: usize,
    pub mesh_n: usize,
    pub mesh_n_low: usize,
    pub mesh_n_high: usize,
}
```

**Features**:
- ✅ Topic subscription management
- ✅ Message validation and signing
- ✅ Mesh network optimization
- ✅ Heartbeat mechanism
- ✅ Message deduplication
- ✅ Flood control

**Integration**:
- Uses cretoai-crypto for signatures
- Integrates with DAG for transaction broadcast
- Peer scoring for reliability

**Tests Required**:
1. Topic subscription/unsubscription
2. Message publishing
3. Message propagation
4. Validation logic
5. Duplicate detection

**Estimated Lines**: ~600-800

---

### Phase 6: NAT Traversal & Relay (relay.rs)

**Goal**: Ensure connectivity across NAT and firewalls

**Components to Implement**:

```rust
pub struct RelayClient {
    relay_addrs: Vec<Multiaddr>,
    circuit_relay: CircuitRelay,
    autonat: AutoNAT,
}

pub struct RelayServer {
    max_circuits: usize,
    max_circuit_duration: Duration,
    max_circuit_bytes: u64,
    active_circuits: HashMap<CircuitId, Circuit>,
}

pub struct NATStatus {
    pub nat_type: NATType,
    pub public_addr: Option<Multiaddr>,
    pub requires_relay: bool,
}
```

**Features**:
- ✅ Circuit relay (client & server)
- ✅ AutoNAT for NAT detection
- ✅ Hole punching (DCUtR)
- ✅ Relay server management
- ✅ Bandwidth limits
- ✅ Connection upgrades

**Protocols**:
- libp2p Circuit Relay v2
- Direct Connection Upgrade through Relay (DCUtR)
- AutoNAT

**Tests Required**:
1. NAT type detection
2. Relay connection establishment
3. Hole punching success
4. Bandwidth limiting
5. Relay server behavior

**Estimated Lines**: ~500-700

---

## 🧪 Testing Strategy

### Unit Tests (Per Module)
```rust
#[cfg(test)]
mod tests {
    // Per-module unit tests
    // Target: 90%+ coverage
}
```

### Integration Tests
```rust
// tests/network_integration.rs
- Full P2P network setup
- Multi-peer communication
- Dark domain routing
- Discovery and gossip interaction
```

### Performance Benchmarks
```rust
// benches/network_bench.rs
- Connection establishment latency
- Message throughput (msgs/sec)
- Peer lookup time
- Circuit building time
- Gossip propagation delay
```

**Benchmark Targets**:
- Connection latency: < 100ms
- Message throughput: 10,000+ msgs/sec
- Peer lookup: < 500ms
- Gossip propagation: < 1 second for 1000 nodes

---

## 📊 Performance Requirements

| Metric | Target | Measurement |
|--------|--------|-------------|
| Connection Establishment | < 100ms | Time to handshake |
| Message Latency | < 50ms | P2P round-trip |
| Throughput | 10,000 msgs/sec | Single node |
| Peer Discovery | < 500ms | DHT lookup time |
| Gossip Propagation | < 1s for 1000 nodes | Message fanout |
| Circuit Building | < 200ms | 3-hop onion |
| Memory per Peer | < 1 MB | Connection state |
| Concurrent Peers | 1000+ | Scalability test |

---

## 🔐 Security Considerations

### Quantum Resistance
- All key exchanges use ML-KEM-768
- Signatures use ML-DSA-87 or SPHINCS+
- Hashing uses BLAKE3

### Privacy
- Dark domains prevent traffic analysis
- Onion routing hides sender/receiver
- No metadata leakage

### Byzantine Resilience
- Peer reputation scoring
- Message validation
- Sybil attack mitigation

---

## 📚 Dependencies

### Already Configured in Cargo.toml
```toml
# Networking
libp2p = { workspace = true }
libp2p-quic = { workspace = true }
quinn = { workspace = true }
rustls = { workspace = true }

# Internal
cretoai-crypto = { path = "../crypto" }

# Async
tokio = { workspace = true }
futures = { workspace = true }
```

### Additional Required (Add to workspace)
```toml
# May need to add specific libp2p features:
libp2p = { version = "0.53", features = [
    "gossipsub", "kad", "identify", "ping",
    "relay", "dcutr", "autonat", "mdns"
]}
```

---

## 🎯 Implementation Order

**Recommended sequence for maximum efficiency**:

1. **Week 1-2**: Phase 1 (P2P Core) - Foundation for everything
2. **Week 3**: Phase 2 (QUIC Transport) - Secure communication
3. **Week 4**: Phase 4 (Discovery) - Peer finding (before gossip)
4. **Week 5**: Phase 5 (Gossip) - Message propagation
5. **Week 6**: Phase 3 (Dark Domains) - Privacy layer
6. **Week 7**: Phase 6 (Relay) - NAT traversal
7. **Week 8**: Integration testing and optimization

---

## 📈 Success Criteria

### Functional
- ✅ Peers can connect across NAT
- ✅ Messages propagate to all subscribed peers
- ✅ Dark domain circuits route correctly
- ✅ DHT lookups succeed in < 500ms
- ✅ Quantum-safe handshakes complete

### Performance
- ✅ All benchmark targets met
- ✅ 1000+ concurrent peer support
- ✅ < 1% message loss rate
- ✅ Linear scalability up to 10,000 nodes

### Security
- ✅ PQC integration verified
- ✅ Privacy guarantees validated
- ✅ Byzantine resilience tested
- ✅ No critical vulnerabilities

---

## 🔗 Integration Points

### With DAG Module
- Gossip broadcasts new vertices
- Discovery finds consensus nodes
- P2P delivers consensus messages

### With Crypto Module
- ML-KEM-768 for key exchange
- ML-DSA for message signing
- BLAKE3 for hashing

### With MCP Server (Future)
- Network events exposed via API
- Agent registration triggers peer discovery
- Real-time network status

---

## 📝 Documentation Requirements

1. **API Documentation**: Rustdoc for all public APIs
2. **Usage Examples**: 3-4 end-to-end examples
3. **Architecture Guide**: High-level design doc
4. **Performance Guide**: Tuning and optimization
5. **Security Guide**: Threat model and mitigations

---

## 🚦 Current Status

**Phase**: Planning Complete ✅
**Next Action**: Begin Phase 1 (P2P Core) implementation
**Blockers**: None
**Dependencies**: All satisfied (cretoai-crypto ready)

---

**Ready to begin implementation!** 🚀

The network module will be the critical bridge connecting the completed cryptography and DAG consensus modules into a fully distributed, quantum-resistant AI agent security platform.
