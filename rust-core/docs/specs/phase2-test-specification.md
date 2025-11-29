# Phase 2: QUIC Transport Test Specification

**Status**: Test-Driven Development Plan
**Date**: 2025-11-26
**Test Count**: 15 Required Tests

## Test Philosophy

Follow TDD (Test-Driven Development):
1. Write test first (it fails)
2. Implement minimum code to pass
3. Refactor and optimize
4. Verify test still passes

## Test Suite Organization

```
tests/libp2p/
├── mod.rs                      # Test module setup
├── quic_test.rs                # 15 QUIC transport tests
├── fixtures/
│   ├── mod.rs
│   ├── test_certs.rs           # Certificate generation helpers
│   └── test_keys.rs            # Key generation helpers
└── helpers/
    ├── mod.rs
    ├── mock_quinn.rs           # Quinn mocking (if needed)
    └── assertions.rs           # Custom assertions
```

---

## Test 1: Hybrid Handshake Success

**File**: `tests/libp2p/quic_test.rs::test_hybrid_handshake_success`

**Purpose**: Verify basic hybrid X25519 + ML-KEM-768 handshake works

**Test Steps**:
1. Create two QUIC endpoints (client and server)
2. Start server listening on localhost
3. Client initiates connection
4. Verify handshake completes successfully
5. Verify ML-KEM-768 was used (check logs or state)

**Success Criteria**:
- Connection established without errors
- Both endpoints have shared secret
- Handshake completes in <1 second

**Mock Requirements**:
- None (end-to-end test)

**Dependencies**:
- `QuicTransport` implemented
- `HybridTlsConfig` implemented
- `CertificateManager` implemented

---

## Test 2: ML-KEM Encapsulation/Decapsulation

**File**: `tests/libp2p/quic_test.rs::test_ml_kem_encapsulation`

**Purpose**: Verify ML-KEM-768 KEM operations are correct

**Test Steps**:
1. Create `HybridTlsConfig`
2. Get ML-KEM-768 public key
3. Perform encapsulation (generate shared secret + ciphertext)
4. Perform decapsulation with ciphertext
5. Verify both secrets match

**Success Criteria**:
- Encapsulation produces 32-byte shared secret
- Encapsulation produces 1088-byte ciphertext
- Decapsulation recovers identical shared secret

**Mock Requirements**:
- None (uses cretoai-crypto directly)

**Example**:
```rust
#[tokio::test]
async fn test_ml_kem_encapsulation() {
    let config = HybridTlsConfig::new();

    // Client encapsulates
    let (secret1, ciphertext) = config.encapsulate(config.public_key());

    // Server decapsulates
    let secret2 = config.decapsulate(&ciphertext);

    assert_eq!(secret1, secret2);
    assert_eq!(secret1.len(), 32);
    assert_eq!(ciphertext.as_bytes().len(), 1088);
}
```

---

## Test 3: TLS Extension Encoding/Decoding

**File**: `tests/libp2p/quic_test.rs::test_tls_extension_encoding`

**Purpose**: Verify custom TLS extension (Type 0xFF01) serialization

**Test Steps**:
1. Create `HybridKemExtension` with ML-KEM public key
2. Encode to bytes
3. Decode from bytes
4. Verify round-trip is lossless

**Success Criteria**:
- Encoded extension has correct format
- Extension type is 0xFF01
- Algorithm ID is 0x0304 (ML-KEM-768)
- Public key is 1184 bytes
- Ciphertext is 1088 bytes (if present)

**Example**:
```rust
#[tokio::test]
async fn test_tls_extension_encoding() {
    let keypair = MLKem768::generate();
    let mut ext = HybridKemExtension::new(&keypair.public_key);

    // Add ciphertext
    let (_, ciphertext) = MLKem768::encapsulate(&keypair.public_key);
    ext.set_ciphertext(&ciphertext);

    // Encode
    let encoded = ext.encode();

    // Verify format
    assert_eq!(u16::from_be_bytes([encoded[0], encoded[1]]), 0xFF01);
    assert_eq!(u16::from_be_bytes([encoded[4], encoded[5]]), 0x0304);

    // Decode
    let decoded = HybridKemExtension::decode(&encoded).unwrap();
    assert_eq!(decoded.public_key, ext.public_key);
    assert_eq!(decoded.ciphertext, ext.ciphertext);
}
```

---

## Test 4: Certificate Generation

**File**: `tests/libp2p/quic_test.rs::test_certificate_generation`

**Purpose**: Verify self-signed Ed25519 certificate generation

**Test Steps**:
1. Call `generate_self_signed_cert()`
2. Verify certificate is valid X.509
3. Verify subject matches agent ID
4. Verify signature algorithm is Ed25519
5. Verify validity period (90 days)

**Success Criteria**:
- Certificate DER encoding is valid
- Subject CN = agent ID
- Signature algorithm = Ed25519
- Not before/after dates are set correctly

**Example**:
```rust
#[tokio::test]
async fn test_certificate_generation() {
    let (cert, der) = generate_self_signed_cert("test-agent".to_string()).unwrap();

    assert!(!der.is_empty());
    // TODO: Parse DER and verify subject
    // TODO: Verify signature algorithm
}
```

---

## Test 5: Certificate Validation

**File**: `tests/libp2p/quic_test.rs::test_certificate_validation`

**Purpose**: Verify certificate validation logic

**Test Steps**:
1. Generate valid certificate
2. Validate with `CertificateManager::validate()`
3. Generate expired certificate
4. Verify validation fails
5. Generate certificate with wrong signature
6. Verify validation fails

**Success Criteria**:
- Valid certificates pass validation
- Expired certificates fail
- Invalid signatures fail

**Example**:
```rust
#[tokio::test]
async fn test_certificate_validation() {
    let identity = Arc::new(AgentIdentity::generate("test".to_string()).unwrap());
    let manager = CertificateManager::new(identity);

    // Valid certificate
    let valid_cert = manager.generate_self_signed().unwrap();
    assert!(manager.validate(&valid_cert).is_ok());

    // TODO: Test expired certificate
    // TODO: Test invalid signature
}
```

---

## Test 6: PeerId ↔ Certificate Mapping

**File**: `tests/libp2p/quic_test.rs::test_peer_id_mapping`

**Purpose**: Verify LibP2P PeerId can be derived from certificate

**Test Steps**:
1. Generate certificate
2. Extract Ed25519 public key
3. Derive LibP2P PeerId
4. Verify PeerId is consistent

**Success Criteria**:
- PeerId is deterministic (same cert → same PeerId)
- PeerId format is valid (Base58 encoded)

**Example**:
```rust
#[tokio::test]
async fn test_peer_id_mapping() {
    let (cert, _) = generate_self_signed_cert("test".to_string()).unwrap();

    // TODO: Extract Ed25519 public key from cert
    // TODO: Create LibP2P PeerId
    // TODO: Verify PeerId format
}
```

---

## Test 7: Hybrid Secret Derivation

**File**: `tests/libp2p/quic_test.rs::test_hybrid_secret_derivation`

**Purpose**: Verify BLAKE3 hybrid secret derivation

**Test Steps**:
1. Create mock X25519 secret (32 bytes)
2. Create mock ML-KEM secret (32 bytes)
3. Call `derive_hybrid_secret()`
4. Verify output is 32 bytes
5. Verify deterministic (same inputs → same output)
6. Verify different inputs → different outputs

**Success Criteria**:
- Output is always 32 bytes
- Derivation is deterministic
- Both secrets are required (changing either changes output)

**Example**:
```rust
#[tokio::test]
async fn test_hybrid_secret_derivation() {
    let x25519_secret = [1u8; 32];
    let ml_kem_secret = [2u8; 32];

    let secret1 = derive_hybrid_secret(&x25519_secret, &ml_kem_secret);
    let secret2 = derive_hybrid_secret(&x25519_secret, &ml_kem_secret);

    // Deterministic
    assert_eq!(secret1, secret2);
    assert_eq!(secret1.len(), 32);

    // Changing X25519 secret changes output
    let x25519_different = [3u8; 32];
    let secret3 = derive_hybrid_secret(&x25519_different, &ml_kem_secret);
    assert_ne!(secret1, secret3);

    // Changing ML-KEM secret changes output
    let ml_kem_different = [4u8; 32];
    let secret4 = derive_hybrid_secret(&x25519_secret, &ml_kem_different);
    assert_ne!(secret1, secret4);
}
```

---

## Test 8: Full Connection Establishment

**File**: `tests/libp2p/quic_test.rs::test_connection_establishment`

**Purpose**: End-to-end QUIC connection with hybrid TLS

**Test Steps**:
1. Create server `QuicTransport`
2. Start listening on localhost:0
3. Create client `QuicTransport`
4. Client dials server
5. Verify connection established
6. Send test data
7. Verify data received

**Success Criteria**:
- Connection established successfully
- Data can be sent/received
- Connection state is `Connected`

**Example**:
```rust
#[tokio::test]
async fn test_connection_establishment() {
    let server_identity = Arc::new(AgentIdentity::generate("server".to_string()).unwrap());
    let client_identity = Arc::new(AgentIdentity::generate("client".to_string()).unwrap());

    let mut server_transport = QuicTransport::new(
        server_identity,
        QuicTransportConfig::default()
    ).unwrap();

    let server_addr = server_transport.listen().await.unwrap();

    let mut client_transport = QuicTransport::new(
        client_identity,
        QuicTransportConfig::default()
    ).unwrap();

    client_transport.dial(server_addr).await.unwrap();

    // TODO: Verify connection state
    // TODO: Send/receive data
}
```

---

## Test 9: Connection Timeout

**File**: `tests/libp2p/quic_test.rs::test_connection_timeout`

**Purpose**: Verify handshake timeout handling

**Test Steps**:
1. Create client with 1-second timeout
2. Try to connect to non-existent server
3. Verify connection times out
4. Verify error type is timeout

**Success Criteria**:
- Connection attempt times out after configured duration
- Error type indicates timeout (not other error)

**Example**:
```rust
#[tokio::test]
async fn test_connection_timeout() {
    let identity = Arc::new(AgentIdentity::generate("test".to_string()).unwrap());

    let mut config = QuicTransportConfig::default();
    config.connection_timeout = Duration::from_secs(1);

    let mut transport = QuicTransport::new(identity, config).unwrap();

    let start = Instant::now();
    let result = transport.dial("127.0.0.1:9999".parse().unwrap()).await;
    let elapsed = start.elapsed();

    assert!(result.is_err());
    assert!(elapsed >= Duration::from_secs(1));
    assert!(elapsed < Duration::from_secs(2));
}
```

---

## Test 10: Forward Secrecy

**File**: `tests/libp2p/quic_test.rs::test_forward_secrecy`

**Purpose**: Verify ephemeral keys provide forward secrecy

**Test Steps**:
1. Establish connection 1
2. Record session keys
3. Close connection 1
4. Establish connection 2
5. Verify session keys are different
6. Verify connection 1 keys cannot decrypt connection 2

**Success Criteria**:
- Each connection uses unique ephemeral keys
- Old session keys cannot decrypt new sessions

**Example**:
```rust
#[tokio::test]
async fn test_forward_secrecy() {
    // TODO: Implement
    // 1. Create two connections
    // 2. Capture session keys (may need debug mode)
    // 3. Verify keys are different
}
```

---

## Test 11: Quantum Resistance

**File**: `tests/libp2p/quic_test.rs::test_quantum_resistance`

**Purpose**: Verify ML-KEM-768 is properly integrated

**Test Steps**:
1. Establish connection
2. Verify TLS extension 0xFF01 was used
3. Verify ML-KEM ciphertext was transmitted
4. Verify hybrid secret includes ML-KEM component

**Success Criteria**:
- ML-KEM-768 ciphertext present in handshake
- Hybrid secret derivation includes ML-KEM secret

**Example**:
```rust
#[tokio::test]
async fn test_quantum_resistance() {
    // TODO: Implement
    // May require handshake inspection or debug logging
}
```

---

## Test 12: Handshake Performance

**File**: `tests/libp2p/quic_test.rs::test_handshake_performance`

**Purpose**: Verify handshake completes in <1 second

**Test Steps**:
1. Create server and client
2. Measure time from dial() to connection established
3. Verify time is <1 second
4. Run 100 iterations for statistical significance

**Success Criteria**:
- p50 latency <500ms
- p95 latency <1000ms
- No handshake takes >2 seconds

**Example**:
```rust
#[tokio::test]
async fn test_handshake_performance() {
    let mut latencies = Vec::new();

    for _ in 0..100 {
        // Setup server
        let server_identity = Arc::new(AgentIdentity::generate("server".to_string()).unwrap());
        let mut server = QuicTransport::new(server_identity, QuicTransportConfig::default()).unwrap();
        let addr = server.listen().await.unwrap();

        // Setup client
        let client_identity = Arc::new(AgentIdentity::generate("client".to_string()).unwrap());
        let mut client = QuicTransport::new(client_identity, QuicTransportConfig::default()).unwrap();

        // Measure handshake
        let start = Instant::now();
        client.dial(addr).await.unwrap();
        let elapsed = start.elapsed();

        latencies.push(elapsed);
    }

    latencies.sort();
    let p50 = latencies[50];
    let p95 = latencies[95];

    assert!(p50 < Duration::from_millis(500));
    assert!(p95 < Duration::from_secs(1));
}
```

---

## Test 13: Bandwidth Overhead

**File**: `tests/libp2p/quic_test.rs::test_bandwidth_overhead`

**Purpose**: Verify ML-KEM overhead is ≤2.5KB

**Test Steps**:
1. Establish connection with packet capture
2. Measure bytes sent during handshake
3. Calculate overhead (total - baseline TLS 1.3)
4. Verify overhead ≤2500 bytes

**Success Criteria**:
- ML-KEM public key: 1184 bytes
- ML-KEM ciphertext: 1088 bytes
- Total overhead: ≤2500 bytes

**Example**:
```rust
#[tokio::test]
async fn test_bandwidth_overhead() {
    // TODO: Implement
    // May require packet capture or Quinn metrics

    // Expected overhead:
    // - ML-KEM pubkey: 1184 bytes
    // - ML-KEM ciphertext: 1088 bytes
    // - TLS extension headers: ~10 bytes
    // Total: ~2282 bytes

    // assert!(overhead <= 2500);
}
```

---

## Test 14: Concurrent Connections

**File**: `tests/libp2p/quic_test.rs::test_concurrent_connections`

**Purpose**: Verify multiple simultaneous connections work

**Test Steps**:
1. Create server
2. Create 10 clients
3. All clients connect simultaneously
4. Verify all connections established
5. Verify no race conditions or deadlocks

**Success Criteria**:
- All 10 connections succeed
- No performance degradation
- No resource leaks

**Example**:
```rust
#[tokio::test]
async fn test_concurrent_connections() {
    let server_identity = Arc::new(AgentIdentity::generate("server".to_string()).unwrap());
    let mut server = QuicTransport::new(server_identity, QuicTransportConfig::default()).unwrap();
    let addr = server.listen().await.unwrap();

    let mut handles = Vec::new();

    for i in 0..10 {
        let addr = addr.clone();
        let handle = tokio::spawn(async move {
            let identity = Arc::new(AgentIdentity::generate(format!("client-{}", i)).unwrap());
            let mut client = QuicTransport::new(identity, QuicTransportConfig::default()).unwrap();
            client.dial(addr).await
        });
        handles.push(handle);
    }

    for handle in handles {
        assert!(handle.await.unwrap().is_ok());
    }
}
```

---

## Test 15: Connection Migration

**File**: `tests/libp2p/quic_test.rs::test_connection_migration`

**Purpose**: Verify QUIC connection survives address changes

**Test Steps**:
1. Establish connection
2. Simulate client IP address change
3. Verify connection migrates successfully
4. Verify data can still be sent/received

**Success Criteria**:
- Connection survives address change
- No data loss during migration
- Connection ID remains valid

**Example**:
```rust
#[tokio::test]
async fn test_connection_migration() {
    // TODO: Implement
    // Requires QUIC connection ID tracking
    // May need to manually trigger migration
}
```

---

## Test Execution Plan

### Phase 1: Unit Tests (Tests 2, 3, 7)
Run first - these don't require full integration.

```bash
cargo test test_ml_kem_encapsulation
cargo test test_tls_extension_encoding
cargo test test_hybrid_secret_derivation
```

### Phase 2: Certificate Tests (Tests 4, 5, 6)
Run after certificate module is implemented.

```bash
cargo test test_certificate_generation
cargo test test_certificate_validation
cargo test test_peer_id_mapping
```

### Phase 3: Integration Tests (Tests 1, 8, 9)
Run after full transport is implemented.

```bash
cargo test test_hybrid_handshake_success
cargo test test_connection_establishment
cargo test test_connection_timeout
```

### Phase 4: Advanced Tests (Tests 10, 11, 14, 15)
Run after basic functionality works.

```bash
cargo test test_forward_secrecy
cargo test test_quantum_resistance
cargo test test_concurrent_connections
cargo test test_connection_migration
```

### Phase 5: Performance Tests (Tests 12, 13)
Run last for optimization.

```bash
cargo test test_handshake_performance --release
cargo test test_bandwidth_overhead --release
```

---

## Success Metrics

### Coverage Target
- Line coverage: >80%
- Branch coverage: >70%
- All 15 tests passing

### Performance Targets
- Handshake p95: <1s
- Bandwidth overhead: ≤2.5KB
- ML-KEM operations: <1ms

### Quality Targets
- Zero flaky tests
- All tests pass in CI
- No race conditions

---

## CI Integration

### GitHub Actions Workflow

```yaml
name: Phase 2 - QUIC Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
      - name: Run QUIC tests
        run: cargo test --test quic_test --release
```

---

**Ready for TDD!** Start with Test 2 (ML-KEM encapsulation) and work through the list.
