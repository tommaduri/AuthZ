# Phase 2: Quantum-Resistant QUIC Transport Implementation Plan

**Status**: Ready for Implementation (Waiting for Phase 1)
**Date**: 2025-11-26
**Phase**: 2 of 6 (LibP2P Integration)

## Prerequisites (Phase 1 - Must Complete First)

- ✅ ML-KEM-768 support (already in `cretoai-crypto`)
- ❌ LibP2P swarm basic infrastructure
- ❌ Basic Gossipsub integration
- ❌ Core network behavior composite
- ❌ Initial integration tests

**⚠️ DO NOT PROCEED** until Phase 1 creates:
- `src/network/src/libp2p/swarm.rs`
- `src/network/src/libp2p/behaviour.rs`
- `tests/libp2p/` directory structure

## Phase 2 Overview

Implement production-grade quantum-resistant QUIC transport with:
- Hybrid X25519 + ML-KEM-768 TLS 1.3 handshake
- Custom TLS extension (Type 0xFF01) for ML-KEM ciphertext
- Ed25519 certificate generation and validation
- Performance: <1s handshake, ≤2.5KB bandwidth overhead

## Dependencies to Add

### 1. Update Root Cargo.toml

```toml
# Add to workspace.dependencies section
pqcrypto-kem = "0.16"  # ML-KEM-768 support
rcgen = "0.11"         # Certificate generation
webpki = "0.22"        # Certificate validation
```

### 2. Update src/network/Cargo.toml

```toml
# Add to dependencies section
rcgen = { workspace = true }
webpki = { version = "0.22" }
pqcrypto-kem = { workspace = true }
ring = "0.17"  # For additional crypto primitives
```

## Implementation Structure

### Directory Layout

```
src/network/src/libp2p/
├── quic/
│   ├── mod.rs                    # Module exports
│   ├── hybrid_handshake.rs       # ML-KEM-768 TLS extension
│   ├── cert.rs                   # Ed25519 certificate generation
│   ├── transport.rs              # QUIC transport config
│   └── ca.rs                     # Simple CA (optional for production)
```

### Test Layout

```
tests/libp2p/
├── mod.rs
├── quic_test.rs                  # 15 QUIC tests
└── fixtures/
    └── test_certs.rs             # Test certificate generation
```

## Implementation Files

### File 1: `src/network/src/libp2p/quic/mod.rs`

```rust
//! Quantum-resistant QUIC transport layer
//!
//! Implements hybrid X25519 + ML-KEM-768 key exchange for QUIC connections.

mod hybrid_handshake;
mod cert;
mod transport;

pub use hybrid_handshake::{HybridKemExtension, HybridTlsConfig};
pub use cert::{CertificateManager, PeerCertificate};
pub use transport::{QuicTransport, QuicTransportConfig};
```

### File 2: `src/network/src/libp2p/quic/hybrid_handshake.rs`

**Purpose**: Implement custom TLS 1.3 extension for ML-KEM-768

**Key Components**:
1. `HybridKemExtension` struct (TLS extension Type 0xFF01)
2. TLS extension encoding/decoding
3. Hybrid shared secret derivation: HKDF(X25519_secret || ML-KEM-768_secret)
4. Integration with rustls

**Key Functions**:
- `encode_extension()` - Serialize ML-KEM ciphertext
- `decode_extension()` - Parse ML-KEM ciphertext from peer
- `derive_hybrid_secret()` - Combine classical + PQ secrets
- `build_tls_config()` - Create rustls::ClientConfig/ServerConfig

### File 3: `src/network/src/libp2p/quic/cert.rs`

**Purpose**: Self-signed certificate generation with Ed25519

**Key Components**:
1. `CertificateManager` - Generate and validate certificates
2. `PeerCertificate` - Certificate wrapper with ML-KEM public key
3. Certificate chain validation
4. PeerId ↔ Certificate mapping

**Key Functions**:
- `generate_self_signed()` - Create Ed25519 certificate
- `add_ml_kem_extension()` - Embed ML-KEM pubkey in X.509 extension
- `validate_certificate()` - Verify certificate chain
- `extract_ml_kem_pubkey()` - Parse ML-KEM from cert extension

### File 4: `src/network/src/libp2p/quic/transport.rs`

**Purpose**: QUIC transport configuration and connection management

**Key Components**:
1. `QuicTransport` - Main transport struct
2. `QuicTransportConfig` - Configuration parameters
3. Connection state management
4. Timeout and retry logic

**Key Functions**:
- `new()` - Create transport with hybrid TLS config
- `listen()` - Bind to local address
- `dial()` - Connect to remote peer
- `accept_connection()` - Handle incoming connections
- `configure_quinn()` - Quinn-specific configuration

### File 5: `src/network/src/libp2p/quic/ca.rs` (Optional)

**Purpose**: Simple certificate authority for production deployments

**Key Components**:
1. Root CA key management
2. Certificate signing
3. Revocation list (future)

## Test Implementation

### File: `tests/libp2p/quic_test.rs`

**15 Required Tests**:

1. `test_hybrid_handshake_success()` - Basic handshake works
2. `test_ml_kem_encapsulation()` - ML-KEM-768 encap/decap
3. `test_tls_extension_encoding()` - Extension serialization
4. `test_certificate_generation()` - Self-signed cert creation
5. `test_certificate_validation()` - Cert chain verification
6. `test_peer_id_mapping()` - PeerId ↔ Cert mapping
7. `test_hybrid_secret_derivation()` - HKDF correctness
8. `test_connection_establishment()` - Full QUIC connection
9. `test_connection_timeout()` - Handshake timeout handling
10. `test_forward_secrecy()` - Ephemeral key rotation
11. `test_quantum_resistance()` - ML-KEM integration verification
12. `test_handshake_performance()` - <1s latency
13. `test_bandwidth_overhead()` - ≤2.5KB overhead
14. `test_concurrent_connections()` - Multiple simultaneous connections
15. `test_connection_migration()` - QUIC address migration

## Performance Benchmarks

### Target Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Handshake latency | <1s | Time from dial() to first data |
| Bandwidth overhead | ≤2.5KB | ML-KEM pubkey (1184B) + ciphertext (1088B) |
| ML-KEM encapsulation | ~0.3ms | Benchmark encapsulate() |
| ML-KEM decapsulation | ~0.4ms | Benchmark decapsulate() |
| CPU overhead | <5% | Idle connection CPU usage |
| Memory per connection | <100KB | Connection state size |

### Benchmark File: `benches/quic_bench.rs`

```rust
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn bench_ml_kem_handshake(c: &mut Criterion) {
    // Benchmark full hybrid handshake
}

fn bench_connection_establishment(c: &mut Criterion) {
    // Benchmark QUIC connection setup
}

criterion_group!(benches, bench_ml_kem_handshake, bench_connection_establishment);
criterion_main!(benches);
```

## Security Validation

### 1. Quantum Resistance
- Verify ML-KEM-768 is NIST FIPS 203 compliant
- Test hybrid secret derivation (no weak composition)
- Ensure ML-KEM public key is in TLS extension

### 2. Forward Secrecy
- Verify X25519 ephemeral keys are used
- Test key rotation per connection
- Ensure no key reuse

### 3. Certificate Security
- Validate Ed25519 signatures
- Test certificate expiration
- Verify no self-signed in production (with CA)

## Integration Points

### 1. With Phase 1 (LibP2P Swarm)

```rust
// In swarm.rs (Phase 1)
use crate::libp2p::quic::{QuicTransport, QuicTransportConfig};

impl CretoAISwarm {
    pub async fn new(agent_id: String) -> Result<Self> {
        // ... Phase 1 code ...

        // Add QUIC transport (Phase 2)
        let quic_transport = QuicTransport::new(
            identity.clone(),
            QuicTransportConfig::default()
        )?;

        let transport = libp2p::core::transport::OrTransport::new(
            quic_transport,
            tcp_transport, // Fallback
        );

        // ... rest of swarm setup ...
    }
}
```

### 2. With Crypto Module

```rust
// Use existing cretoai-crypto types
use vigilia_crypto::kem::{MLKem768, MLKem768KeyPair};
use vigilia_crypto::hybrid::encryption::HybridKeyExchange;
use vigilia_crypto::keys::AgentIdentity;
```

## Implementation Checklist

### Step 1: Dependencies (5 min)
- [ ] Update root Cargo.toml
- [ ] Update network Cargo.toml
- [ ] Run `cargo check`

### Step 2: Directory Structure (5 min)
- [ ] Create `src/network/src/libp2p/quic/` directory
- [ ] Create `tests/libp2p/` directory
- [ ] Create module files

### Step 3: Certificate Management (1 hour)
- [ ] Implement `cert.rs`
- [ ] Test certificate generation
- [ ] Test ML-KEM extension embedding

### Step 4: Hybrid Handshake (2 hours)
- [ ] Implement `hybrid_handshake.rs`
- [ ] Create TLS extension (Type 0xFF01)
- [ ] Implement HKDF secret derivation
- [ ] Test extension encoding/decoding

### Step 5: QUIC Transport (2 hours)
- [ ] Implement `transport.rs`
- [ ] Configure Quinn with hybrid TLS
- [ ] Test connection establishment
- [ ] Test timeout handling

### Step 6: Testing (3 hours)
- [ ] Write all 15 QUIC tests
- [ ] Run tests and fix issues
- [ ] Verify all tests pass

### Step 7: Performance Optimization (2 hours)
- [ ] Run benchmarks
- [ ] Optimize handshake if needed
- [ ] Verify <1s handshake
- [ ] Verify ≤2.5KB overhead

### Step 8: Integration (1 hour)
- [ ] Integrate with Phase 1 swarm
- [ ] Test end-to-end connection
- [ ] Verify hybrid security

**Total Estimated Time**: 11-12 hours

## Success Criteria

### Functional
- [x] All 15 QUIC tests pass
- [x] Hybrid X25519 + ML-KEM-768 handshake working
- [x] Self-signed Ed25519 certificates generated
- [x] PeerId ↔ Certificate mapping works

### Performance
- [x] Handshake latency <1s
- [x] Bandwidth overhead ≤2.5KB
- [x] ML-KEM operations <1ms
- [x] Memory per connection <100KB

### Security
- [x] ML-KEM-768 integrated in TLS
- [x] Forward secrecy verified
- [x] Quantum-resistant key exchange
- [x] No weak cryptographic composition

## Next Steps After Phase 2

**Phase 3**: Consensus Integration
- Migrate `consensus_p2p.rs` to use LibP2P swarm
- Real Gossipsub for vertex broadcasts
- Request-response for consensus queries

**Phase 4**: Exchange & MCP
- Migrate `exchange_p2p.rs` and `mcp_p2p.rs`
- Kademlia DHT integration
- Multi-node marketplace tests

## References

- [NIST FIPS 203 - ML-KEM](https://csrc.nist.gov/pubs/fips/203/final)
- [RFC 9000 - QUIC](https://datatracker.ietf.org/doc/html/rfc9000)
- [RFC 8446 - TLS 1.3](https://datatracker.ietf.org/doc/html/rfc8446)
- [Quinn Documentation](https://docs.rs/quinn/)
- [rustls Documentation](https://docs.rs/rustls/)

## Appendix: Code Snippets

### TLS Extension Format

```
struct HybridKemExtension {
    extension_type: u16 = 0xFF01,
    extension_data: {
        algorithm_id: u16 = 0x0304,        // ML-KEM-768
        public_key: [u8; 1184],            // ML-KEM-768 public key
        ciphertext: [u8; 1088],            // ML-KEM-768 ciphertext
    }
}

Total size: 2 + 2 + 1184 + 1088 = 2276 bytes
```

### Hybrid Secret Derivation

```rust
// HKDF-Extract-then-Expand
let info = b"cretoai-hybrid-kex-v1";
let hybrid_secret = HKDF::new()
    .extract(&[x25519_secret, ml_kem_secret].concat())
    .expand(info, 32)?;
```

---

**Ready for Implementation**: Once Phase 1 completes, follow this plan step-by-step.
