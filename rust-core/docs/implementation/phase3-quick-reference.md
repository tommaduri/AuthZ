# Phase 3: Consensus Implementation - Quick Reference

## Overview

Avalanche-based DAG consensus with quantum-resistant cryptography integrated with QUIC transport.

## Usage Examples

### 1. Basic Consensus Node Setup

```rust
use vigilia_network::{ConsensusNode, ConsensusConfig};
use vigilia_crypto::keys::AgentIdentity;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Create agent identity
    let identity = Arc::new(AgentIdentity::generate("agent-1".to_string())?);

    // Create consensus node with default config
    let config = ConsensusConfig::default();
    let node = ConsensusNode::new(identity, config).await?;

    // Start the node
    node.start().await?;

    // Register peers
    node.register_peer("peer-1".to_string());
    node.register_peer("peer-2".to_string());

    Ok(())
}
```

### 2. Proposing a Vertex

```rust
// Propose a new vertex with parents
let parents = vec!["genesis".to_string()];
let payload = vec![1, 2, 3, 4]; // Transaction data

let vertex_id = node.propose_vertex(parents, payload).await?;
println!("Proposed vertex: {}", vertex_id);

// Check if finalized
if node.is_finalized(&vertex_id) {
    println!("Vertex finalized!");
}

// Get confidence level
if let Some(confidence) = node.get_confidence(&vertex_id) {
    println!("Confidence: {:.2}%", confidence * 100.0);
}
```

### 3. Handling Consensus Messages

```rust
use vigilia_network::ConsensusMessage;

async fn handle_network_message(
    node: &ConsensusNode,
    peer_id: String,
    message_bytes: Vec<u8>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Deserialize message
    let message: ConsensusMessage = bincode::deserialize(&message_bytes)?;

    // Handle message
    node.handle_message(peer_id, message).await?;

    Ok(())
}
```

### 4. Custom Configuration

```rust
use vigilia_network::{ConsensusConfig, ConfidenceParams, PropagatorConfig, QueryConfig};
use std::time::Duration;

let config = ConsensusConfig {
    confidence_params: ConfidenceParams {
        alpha_threshold: 24,           // 80% agreement
        beta_threshold: 20,            // 20 consecutive successes
        finalization_threshold: 0.95,  // 95% confidence
        max_rounds: 1000,
    },
    propagator_config: PropagatorConfig {
        max_cache_size: 10000,
        validate_before_propagate: true,
    },
    query_config: QueryConfig {
        sample_size: 30,
        query_timeout: Duration::from_secs(5),
        max_concurrent_queries: 100,
    },
    sample_size: 30,
    min_network_size: 100,
    ..Default::default()
};

let node = ConsensusNode::new(identity, config).await?;
```

### 5. Monitoring Finalized Vertices

```rust
// Get all finalized vertices in order
let finalized = node.get_finalized_vertices();
for vertex_id in finalized {
    println!("Finalized: {}", vertex_id);
}

// Check specific vertex
if node.is_finalized(&vertex_id) {
    println!("Vertex {} is finalized", vertex_id);
}
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      ConsensusNode                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              QUIC Transport Layer                     │  │
│  │  (Hybrid ML-KEM-768 + X25519 Key Exchange)          │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ▲                                  │
│                           │                                  │
│  ┌────────────┬───────────┴──────────┬────────────────┐   │
│  │            │                       │                 │   │
│  ▼            ▼                       ▼                 ▼   │
│ ┌──────┐  ┌──────┐  ┌──────────┐  ┌──────┐  ┌──────┐    │
│ │Proto │  │Conf  │  │Propagator│  │Query │  │Final │    │
│ │-col  │  │-idence│  │          │  │      │  │-ity  │    │
│ └──────┘  └──────┘  └──────────┘  └──────┘  └──────┘    │
│                                                             │
│  Protocol   Confidence   Vertex      Query    Finality     │
│  Messages   Tracking     Broadcast   Handler  Detection    │
└─────────────────────────────────────────────────────────────┘
```

## Consensus Flow

```
1. PROPOSE VERTEX
   ├─> Create VertexProposal (with BLAKE3 hash)
   ├─> Sign with ML-DSA-87 (placeholder)
   ├─> Register with FinalityDetector
   ├─> Initialize ConfidenceTracker
   └─> Broadcast via VertexPropagator

2. QUERY ROUND
   ├─> Sample k nodes from network
   ├─> Send QueryVertex message
   ├─> Wait for VoteAccept/VoteReject
   ├─> Aggregate responses (QueryResponse)
   └─> Update confidence (exponential moving average)

3. CHECK FINALIZATION
   ├─> consecutive_successes >= beta_threshold?
   ├─> confidence >= finalization_threshold?
   ├─> All parents finalized?
   ├─> No conflicts?
   └─> If yes: FINALIZE

4. FINALIZE VERTEX
   ├─> Mark as finalized
   ├─> Record timestamp
   ├─> Add to finalization order
   └─> Propagate finality to children
```

## Key Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `sample_size` | 30 | Nodes queried per round |
| `alpha_threshold` | 24 | 80% agreement required |
| `beta_threshold` | 20 | Consecutive successes needed |
| `finalization_threshold` | 0.95 | Confidence level for finality |
| `max_rounds` | 1000 | Maximum consensus rounds |
| `query_timeout` | 5s | Query response timeout |
| `min_network_size` | 100 | Minimum peers for consensus |
| `max_cache_size` | 10000 | Deduplication cache size |

## Message Types

### ConsensusMessage

```rust
enum ConsensusMessage {
    ProposeVertex(VertexProposal),
    QueryVertex { vertex_id, round, query_id },
    VoteAccept { vertex_id, signature, round, query_id },
    VoteReject { vertex_id, reason, round, query_id },
}
```

### VertexProposal

```rust
struct VertexProposal {
    vertex_id: String,
    parents: Vec<String>,
    payload: Vec<u8>,
    timestamp: u64,
    creator: String,
    signature: Vec<u8>,  // ML-DSA-87
    hash: [u8; 32],      // BLAKE3
}
```

## Error Handling

```rust
use vigilia_network::error::NetworkError;

match node.propose_vertex(parents, payload).await {
    Ok(vertex_id) => println!("Success: {}", vertex_id),
    Err(NetworkError::Consensus(msg)) => eprintln!("Consensus error: {}", msg),
    Err(NetworkError::Query(msg)) => eprintln!("Query error: {}", msg),
    Err(NetworkError::Transport(msg)) => eprintln!("Transport error: {}", msg),
    Err(e) => eprintln!("Error: {}", e),
}
```

## Testing

### Run All Consensus Tests

```bash
cargo test --package cretoai-network --lib consensus
```

### Run Specific Module Tests

```bash
# Protocol tests
cargo test --package cretoai-network --lib consensus::protocol

# Confidence tests
cargo test --package cretoai-network --lib consensus::confidence

# Finality tests
cargo test --package cretoai-network --lib consensus::finality

# Query tests
cargo test --package cretoai-network --lib consensus::query

# Node tests
cargo test --package cretoai-network --lib consensus::node
```

### Run Integration Tests

```bash
cargo test --package cretoai-network --lib consensus_p2p
```

## Performance Tips

1. **Tune Sample Size**: Larger sample = slower but more secure
2. **Adjust Timeouts**: Balance between latency and reliability
3. **Cache Management**: Monitor deduplication cache hit rate
4. **Concurrent Queries**: Limit based on available bandwidth
5. **Network Size**: More nodes = better BFT but slower consensus

## Security Considerations

1. **Byzantine Nodes**: Can tolerate up to 33% malicious nodes
2. **Signature Verification**: Always verify ML-DSA signatures in production
3. **Hash Validation**: Verify BLAKE3 hashes before propagation
4. **Conflict Detection**: Monitor conflict rate for attacks
5. **Rate Limiting**: Implement query rate limits per peer

## Troubleshooting

### Consensus Timeout
- Check network connectivity
- Verify sufficient peers (>= min_network_size)
- Increase max_rounds or query_timeout
- Check for network partitions

### Low Confidence
- Verify alpha_threshold is achievable
- Check for conflicting vertices
- Monitor byzantine node behavior
- Inspect query response patterns

### Finalization Failures
- Ensure all parents are finalized first
- Check for unresolved conflicts
- Verify beta_threshold is reachable
- Monitor consecutive_successes counter

## Integration Checklist

- [ ] Connect QUIC transport for message delivery
- [ ] Integrate ML-DSA key management
- [ ] Connect DAG storage for persistence
- [ ] Add performance monitoring
- [ ] Implement rate limiting
- [ ] Add checkpoint/restore
- [ ] Setup alerting for consensus failures
- [ ] Configure production parameters

## API Reference

Full API documentation:
```bash
cargo doc --package cretoai-network --open
```

Navigate to: `vigilia_network::consensus`

## Related Documentation

- `/docs/implementation/phase3-consensus-implementation-summary.md` - Complete implementation details
- `/docs/implementation/phase3-verification-report.md` - Test results and verification
- `src/network/src/consensus/` - Source code with inline documentation

## Support

For issues or questions:
1. Check test cases in `src/network/src/consensus/*/tests.rs`
2. Review inline documentation in source files
3. Consult verification report for known limitations
