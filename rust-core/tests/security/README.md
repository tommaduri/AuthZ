# Security Test Suite - ML-DSA Signature Integration

## Overview

This directory contains comprehensive TDD tests for **Option 1: Security First** - ML-DSA (Dilithium5/87) quantum-resistant signature integration into Vigilia AI's DAG consensus and network layers.

**Status**: 🔴 **RED PHASE** - Tests written, implementation pending
**Total Tests**: 42 comprehensive test cases
**Test Suites**: 8 security-focused scenarios

---

## Files

### Test Implementation
- **`signature_integration_test.rs`** (~1,200 lines)
  - Complete test suite with 42 test cases
  - 8 test modules covering all security scenarios
  - Helper functions and test fixtures
  - Comprehensive documentation

- **`mod.rs`**
  - Module exports and organization

---

## Test Suites

### 1. ML-DSA Signature Generation (4 tests)
- Basic vertex signing workflow
- Signature field inclusion verification
- Genesis vertex handling
- Deterministic signing

### 2. Signature Verification - Valid Cases (4 tests)
- Valid signature acceptance
- Genesis vertex verification
- Multi-parent vertex verification
- Large payload handling

### 3. Signature Verification - Invalid Cases (6 tests)
- Tampered payload detection
- Tampered vertex ID detection
- Tampered timestamp detection
- Missing signature handling
- Corrupted signature detection
- Truncated signature rejection

### 4. Wrong Key Scenarios (3 tests)
- Cross-key verification rejection
- Cross-agent authentication
- Signature replay prevention

### 5. Network Message Signing (6 tests)
- ConsensusQuery signing
- ConsensusResponse signing
- VertexMessage signing
- Signature verification for all message types
- Unsigned message rejection

### 6. Key Rotation Scenarios (4 tests)
- Old signature verification after rotation
- Vertex re-signing with new keys
- Grace period handling
- Rotation metadata tracking

### 7. Byzantine Fault Scenarios (7 tests)
- Forged signature rejection
- Tampering detection
- Replay attack prevention
- Malformed signature rejection
- Length attack prevention
- Double-signing detection
- Timestamp manipulation detection

### 8. Edge Cases and Error Handling (8 tests)
- Empty payload signing
- Maximum payload signing (10MB)
- Unicode vertex ID handling
- Binary payload handling
- Zero timestamp handling
- Maximum timestamp handling
- Duplicate parent IDs
- Concurrent signing operations

---

## Running Tests

### After Implementation:

```bash
# Run all signature integration tests
cargo test --test signature_integration_test

# Run specific test suite
cargo test vertex_signature_generation
cargo test signature_verification_valid
cargo test byzantine_faults

# Run with verbose output
cargo test signature_integration_test -- --nocapture

# Run specific test
cargo test test_vertex_sign_with_mldsa87

# Run and show all output
cargo test signature_integration_test -- --show-output
```

---

## Current Status

### ✅ Completed (Red Phase)
- [x] Test suite created (42 tests)
- [x] Test documentation written
- [x] Test fixtures and helpers implemented
- [x] Comprehensive coverage verified

### ❌ Pending (Green Phase)
- [ ] Vertex signing methods implementation
- [ ] Network message signing implementation
- [ ] Serialization helpers implementation
- [ ] Key rotation implementation
- [ ] All tests passing

### ⚪ Future (Refactor Phase)
- [ ] Performance optimization
- [ ] Error message improvement
- [ ] Caching implementation
- [ ] Telemetry addition

---

## Implementation Requirements

### Functions to Implement:

```rust
// Vertex signing (vigilia-dag)
impl Vertex {
    pub fn sign_with_mldsa87(&mut self, secret_key: &MLDSA87SecretKey);
    pub fn verify_mldsa87_signature(&self, public_key: &MLDSA87PublicKey) -> Result<()>;
}

// Network message signing (vigilia-network)
impl ConsensusQuery {
    pub fn sign(&mut self, secret_key: &MLDSA87SecretKey);
    pub fn verify(&self, public_key: &MLDSA87PublicKey) -> Result<()>;
}

impl ConsensusResponse {
    pub fn sign(&mut self, secret_key: &MLDSA87SecretKey);
    pub fn verify(&self, public_key: &MLDSA87PublicKey) -> Result<()>;
}

// Key rotation (vigilia-crypto)
pub struct KeyRotation {
    pub old_key_fingerprint: Vec<u8>,
    pub new_key_fingerprint: Vec<u8>,
    pub rotation_timestamp: u64,
    pub grace_period_end: u64,
}
```

---

## Documentation

- **Test Coverage**: `/docs/testing/signature_integration_test_coverage.md`
- **Execution Report**: `/docs/testing/test_execution_report.md`
- **Summary**: `/docs/testing/SIGNATURE_INTEGRATION_TEST_SUMMARY.md`
- **TDD Proof**: `/docs/testing/TDD_RED_PHASE_PROOF.md`

---

## Test Metrics

| Metric | Value |
|--------|-------|
| Total Tests | 42 |
| Test Suites | 8 |
| Lines of Test Code | ~1,200 |
| Functions to Implement | ~15 |
| Expected Coverage | >90% |
| Estimated Implementation Time | 4-6 hours |

---

## Security Features Tested

### Cryptographic Strength
- ✅ ML-DSA-87 (NIST Level 5 quantum resistance)
- ✅ 4627-byte signatures
- ✅ Deterministic signing

### Byzantine Fault Tolerance
- ✅ Forged signature detection
- ✅ Replay attack prevention
- ✅ Tamper detection
- ✅ Double-signing detection
- ✅ Timestamp manipulation detection

### Network Security
- ✅ All consensus messages signed
- ✅ Signature verification required
- ✅ Unsigned message rejection
- ✅ Cross-agent authentication

### Key Management
- ✅ Key rotation support
- ✅ Grace period handling
- ✅ Audit trail via metadata

---

## Test-Driven Development

This test suite follows **strict TDD methodology**:

1. **🔴 RED** (Current): Tests written, all failing
2. **🟢 GREEN** (Next): Implement to make tests pass
3. **🔵 REFACTOR** (Future): Optimize and improve

---

## Contributing

When implementing the features to pass these tests:

1. Start with the simplest test suite (Suite 1)
2. Make one test pass at a time
3. Run tests frequently: `cargo test signature_integration`
4. Don't move to the next test until current one passes
5. Refactor only after all tests are green

---

## Support

For questions or issues:
- Review test documentation in `/docs/testing/`
- Check test implementation in `signature_integration_test.rs`
- Refer to TDD proof document for implementation requirements

---

**Status**: 🔴 **RED PHASE COMPLETE** - Ready for implementation
