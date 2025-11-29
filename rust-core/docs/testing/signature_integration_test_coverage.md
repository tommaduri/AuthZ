# Signature Integration Test Coverage - Option 1 (Security First)

## Overview

Comprehensive TDD test suite for ML-DSA (Dilithium5/87) signature integration into CretoAI AI's DAG consensus and network layers.

**Status**: Tests written BEFORE implementation (TDD Red Phase)
**Expected**: All tests should FAIL initially
**Test File**: `/tests/security/signature_integration_test.rs`

---

## Test Suites

### 1. ML-DSA Signature Generation for Vertices (4 tests)

| Test Name | Description | Expected Behavior |
|-----------|-------------|-------------------|
| `test_vertex_sign_with_mldsa87` | Generate ML-DSA-87 signature for vertex | Signature length = 4627 bytes |
| `test_vertex_signature_includes_all_fields` | Verify signature includes all vertex fields | ID, parents, payload, timestamp, creator, hash included |
| `test_genesis_vertex_signature` | Sign genesis vertex (no parents) | Genesis vertices can be signed |
| `test_signature_determinism` | Same input produces same signature | Deterministic signing |

**Coverage**: Basic signature generation workflow

---

### 2. Signature Verification - Valid Cases (4 tests)

| Test Name | Description | Expected Behavior |
|-----------|-------------|-------------------|
| `test_verify_valid_vertex_signature` | Verify correctly signed vertex | Verification succeeds |
| `test_verify_genesis_vertex_signature` | Verify genesis vertex signature | Genesis signatures verify |
| `test_verify_vertex_with_multiple_parents` | Verify vertex with 3+ parents | Multi-parent vertices verify |
| `test_verify_large_payload_vertex` | Verify vertex with 1MB payload | Large payloads don't affect verification |

**Coverage**: Valid signature verification scenarios

---

### 3. Signature Verification - Invalid Cases (6 tests)

| Test Name | Description | Expected Behavior |
|-----------|-------------|-------------------|
| `test_verify_tampered_payload` | Tamper with payload after signing | Verification FAILS |
| `test_verify_tampered_vertex_id` | Tamper with vertex ID after signing | Verification FAILS |
| `test_verify_tampered_timestamp` | Tamper with timestamp after signing | Verification FAILS |
| `test_verify_missing_signature` | Verify vertex without signature | Verification FAILS |
| `test_verify_corrupted_signature_bytes` | Corrupt signature bytes | Verification FAILS |
| `test_verify_truncated_signature` | Truncate signature bytes | Verification FAILS |

**Coverage**: Tampering detection and signature integrity

---

### 4. Wrong Key Scenarios (3 tests)

| Test Name | Description | Expected Behavior |
|-----------|-------------|-------------------|
| `test_verify_with_different_public_key` | Sign with key A, verify with key B | Verification FAILS |
| `test_cross_agent_signature_rejection` | Agent 1 signs, Agent 2 verifies | Cross-agent verification FAILS |
| `test_signature_replay_with_different_key` | Replay signature on different data | Replay attack FAILS |

**Coverage**: Key mismatch and cross-agent security

---

### 5. Network Message Signing (6 tests)

| Test Name | Description | Expected Behavior |
|-----------|-------------|-------------------|
| `test_sign_consensus_query` | Sign ConsensusQuery message | Signature generated |
| `test_verify_consensus_query_signature` | Verify ConsensusQuery signature | Verification succeeds |
| `test_sign_consensus_response` | Sign ConsensusResponse message | Signature generated |
| `test_verify_consensus_response_signature` | Verify ConsensusResponse signature | Verification succeeds |
| `test_sign_vertex_message_for_broadcast` | Sign VertexMessage for network | Broadcast messages signed |
| `test_reject_unsigned_network_message` | Network layer rejects unsigned messages | Unsigned messages rejected |

**Coverage**: Network protocol message signing

---

### 6. Key Rotation Scenarios (4 tests)

| Test Name | Description | Expected Behavior |
|-----------|-------------|-------------------|
| `test_verify_old_signatures_after_key_rotation` | Old signatures still verify with old key | Backward compatibility |
| `test_re_sign_vertex_with_new_key` | Re-sign vertex after rotation | New signature replaces old |
| `test_key_rotation_grace_period` | Both keys work during grace period | Smooth transition |
| `test_key_rotation_metadata` | Rotation includes metadata | Audit trail maintained |

**Coverage**: Key lifecycle management

---

### 7. Byzantine Fault Scenarios (7 tests)

| Test Name | Description | Expected Behavior |
|-----------|-------------|-------------------|
| `test_reject_forged_signature` | Attacker signs with their key | Forged signatures rejected |
| `test_reject_signature_on_tampered_vertex` | Sign, then tamper with data | Tampering detected |
| `test_reject_replayed_signature` | Replay signature on different vertex | Replay attack detected |
| `test_reject_malformed_signature` | Random bytes as signature | Malformed signatures rejected |
| `test_reject_signature_length_attack` | Wrong signature length | Length validation works |
| `test_reject_double_signing_attack` | Sign two conflicting vertices | Double-signing detected |
| `test_reject_timestamp_manipulation` | Manipulate timestamp post-signing | Manipulation detected |

**Coverage**: Byzantine fault tolerance and attack resistance

---

### 8. Edge Cases and Error Handling (8 tests)

| Test Name | Description | Expected Behavior |
|-----------|-------------|-------------------|
| `test_empty_payload_signature` | Sign vertex with empty payload | Empty payloads handled |
| `test_maximum_payload_signature` | Sign 10MB payload | Large payloads handled |
| `test_unicode_vertex_id_signature` | Unicode characters in vertex ID | Unicode handled correctly |
| `test_binary_payload_signature` | Binary data (0-255) in payload | Binary data handled |
| `test_zero_timestamp_signature` | Timestamp = 0 | Zero timestamp handled |
| `test_max_u64_timestamp_signature` | Timestamp = u64::MAX | Max timestamp handled |
| `test_multiple_parents_same_id` | Duplicate parent IDs | Duplicates handled |
| `test_concurrent_signature_operations` | 10 concurrent signing operations | Thread-safe signing |

**Coverage**: Edge cases, boundary conditions, concurrency

---

## Test Data & Fixtures

### Test Keypairs
- Generated using `MLDSA87::generate()`
- Fresh keypair per test (no shared state)

### Sample Vertices
- Simple vertices: ID, creator, payload
- Genesis vertices: No parents
- Multi-parent vertices: 2-3 parents
- Large payload vertices: 1-10MB payloads

### Network Messages
- `ConsensusQuery`: Query ID, vertex ID, requester, timestamp
- `ConsensusResponse`: Query ID, vertex ID, responder, vote, confidence
- `VertexMessage`: Complete vertex data for broadcast

---

## Implementation Requirements

### Functions to Implement (Based on Tests)

1. **Vertex Signing**
   ```rust
   impl Vertex {
       pub fn sign_with_mldsa87(&mut self, secret_key: &MLDSA87SecretKey);
       pub fn verify_mldsa87_signature(&self, public_key: &MLDSA87PublicKey) -> Result<()>;
   }
   ```

2. **Serialization for Signing**
   ```rust
   fn vertex_to_signable_bytes(vertex: &Vertex) -> Vec<u8>;
   fn consensus_query_to_bytes(query: &ConsensusQuery) -> Vec<u8>;
   fn consensus_response_to_bytes(response: &ConsensusResponse) -> Vec<u8>;
   fn vertex_message_to_bytes(msg: &VertexMessage) -> Vec<u8>;
   ```

3. **Network Message Signing**
   ```rust
   impl ConsensusQuery {
       pub fn sign(&mut self, secret_key: &MLDSA87SecretKey);
       pub fn verify(&self, public_key: &MLDSA87PublicKey) -> Result<()>;
   }

   impl ConsensusResponse {
       pub fn sign(&mut self, secret_key: &MLDSA87SecretKey);
       pub fn verify(&self, public_key: &MLDSA87PublicKey) -> Result<()>;
   }
   ```

4. **Key Rotation**
   ```rust
   pub struct KeyRotation {
       pub old_key_fingerprint: Vec<u8>,
       pub new_key_fingerprint: Vec<u8>,
       pub rotation_timestamp: u64,
       pub grace_period_end: u64,
   }
   ```

---

## Expected Test Failures (TDD Red Phase)

When running `cargo test --package vigilia signature_integration`, expect:

```
running 42 tests

FAILED tests:
  - vertex_signature_generation::test_vertex_sign_with_mldsa87
  - vertex_signature_generation::test_vertex_signature_includes_all_fields
  - vertex_signature_generation::test_genesis_vertex_signature
  - vertex_signature_generation::test_signature_determinism

  - signature_verification_valid::test_verify_valid_vertex_signature
  - signature_verification_valid::test_verify_genesis_vertex_signature
  - signature_verification_valid::test_verify_vertex_with_multiple_parents
  - signature_verification_valid::test_verify_large_payload_vertex

  [... 34 more failures ...]

test result: FAILED. 0 passed; 42 failed; 0 ignored
```

### Reason for Failures
- Implementation functions not yet created
- `sign_with_mldsa87()` method doesn't exist on Vertex
- `verify_mldsa87_signature()` method doesn't exist
- Network message signing methods not implemented
- Serialization helpers not implemented

---

## Test Execution Commands

```bash
# Run all signature integration tests
cargo test --package cretoai-dag signature_integration
cargo test --package cretoai-network signature_integration

# Run specific test suite
cargo test --test signature_integration_test vertex_signature_generation

# Run with verbose output
cargo test --test signature_integration_test -- --nocapture

# Run and show ignored tests
cargo test --test signature_integration_test -- --ignored --show-output
```

---

## Next Steps (After Tests Fail)

1. **Implement Vertex Signing Methods**
   - Add `sign_with_mldsa87()` to Vertex
   - Add `verify_mldsa87_signature()` to Vertex

2. **Implement Serialization**
   - Create deterministic serialization for signing
   - Ensure all fields included in signature

3. **Add Network Message Signing**
   - Extend ConsensusQuery with signing
   - Extend ConsensusResponse with signing
   - Add signature fields to network structs

4. **Implement Key Rotation**
   - Create KeyRotation structure
   - Add grace period logic
   - Maintain key metadata

5. **Run Tests Again (Green Phase)**
   - All 42 tests should PASS
   - Code coverage should be >90%

---

## Test Coverage Metrics

| Category | Tests | Coverage |
|----------|-------|----------|
| Signature Generation | 4 | Basic signing workflow |
| Valid Verification | 4 | Happy path scenarios |
| Invalid Verification | 6 | Error handling |
| Wrong Keys | 3 | Security boundaries |
| Network Messages | 6 | Protocol integration |
| Key Rotation | 4 | Lifecycle management |
| Byzantine Faults | 7 | Attack resistance |
| Edge Cases | 8 | Boundary conditions |
| **Total** | **42** | **Comprehensive** |

---

## Dependencies Required

```toml
[dependencies]
cretoai-crypto = { path = "../crypto" }
cretoai-dag = { path = "../dag" }
cretoai-network = { path = "../network" }
bincode = "1.3"
serde = { version = "1.0", features = ["derive"] }

[dev-dependencies]
tokio-test = "0.4"
proptest = "1.0"
```

---

## Notes

- All tests follow TDD: **Write tests FIRST, then implement**
- Tests are currently in RED phase (failing)
- Implementation will move tests to GREEN phase (passing)
- Refactoring phase follows green phase
- Test coverage is comprehensive (42 tests covering 8 scenarios)
- Byzantine fault scenarios ensure security against malicious actors
- Edge cases ensure robustness in production
