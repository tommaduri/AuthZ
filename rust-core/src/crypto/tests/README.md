# CretoAI Crypto Test Suite

Comprehensive TDD test suite for the cretoai-crypto package following London School TDD methodology.

## Overview

This test suite provides extensive coverage for all cryptographic operations in CretoAI:

- **Error Handling** - All error types and propagation
- **Signatures** - Dilithium (ML-DSA) and SPHINCS+ post-quantum signatures
- **Key Management** - Generation, storage, rotation, and agent identities
- **KEM** - Kyber key encapsulation mechanism
- **Hash Functions** - Blake3 and SHA3 hashing
- **Hybrid Cryptography** - Classical + post-quantum hybrid schemes
- **Integration** - Complete workflow tests

## Test Organization

```
tests/
├── unit/                      # Unit tests (mock-driven)
│   ├── error_tests.rs         # CryptoError types
│   ├── signature_tests.rs     # Signature schemes
│   ├── key_management_tests.rs # Key lifecycle
│   ├── kem_tests.rs           # KEM operations
│   ├── hash_tests.rs          # Hash functions
│   └── hybrid_crypto_tests.rs # Hybrid schemes
├── integration/               # Integration tests
│   └── full_workflow_tests.rs # End-to-end workflows
├── mocks/                     # Mock implementations
│   └── mod.rs                 # Test doubles and stubs
└── mod.rs                     # Test suite entry point
```

## Running Tests

### Run All Tests
```bash
cd /Users/tommaduri/cretoai/src/crypto
cargo test
```

### Run Specific Test Module
```bash
cargo test error_tests
cargo test signature_tests
cargo test key_management_tests
```

### Run Only Implemented Tests
```bash
# Skip ignored tests (implementation pending)
cargo test
```

### Run All Tests Including Ignored
```bash
# Run tests marked with #[ignore]
cargo test -- --ignored
```

### Run Tests with Output
```bash
cargo test -- --nocapture
```

### Run Tests in Parallel
```bash
cargo test -- --test-threads=4
```

## Test Coverage

### Generate Coverage Report
```bash
cargo tarpaulin --out Html --output-dir coverage
```

### Coverage Goals
- **Statements:** >90%
- **Branches:** >85%
- **Functions:** >90%
- **Lines:** >90%

## TDD Methodology

This test suite follows **London School TDD** (mock-driven):

### Principles
1. **Test behavior, not implementation**
2. **Use mocks to isolate units**
3. **Test one behavior per test**
4. **Clear test names describing behavior**
5. **Arrange-Act-Assert structure**

### Example Test Pattern
```rust
#[test]
fn test_verify_signature_fails_with_wrong_message() {
    // Arrange
    let keypair = MLDSA87::generate();
    let original_message = b"original";
    let tampered_message = b"tampered";
    let signature = keypair.sign(original_message);

    // Act
    let result = keypair.verify(tampered_message, &signature);

    // Assert
    assert!(result.is_err());
    assert!(matches!(
        result.unwrap_err(),
        CryptoError::SignatureVerificationFailed
    ));
}
```

## Test Categories

### ✅ Implemented Tests (Not Ignored)

#### Error Tests (`error_tests.rs`)
- ✅ All 18 error variant construction tests
- ✅ Error message formatting tests
- ✅ Error propagation and Result type tests
- ✅ Error debugging and trait tests
- ✅ Error pattern matching tests

#### Signature Tests (`signature_tests.rs`)
- ✅ MLDSA87 keypair generation tests
- ✅ MLDSA87 signing tests (deterministic, various message sizes)
- ✅ MLDSA87 verification tests (valid, invalid, tampering)
- ✅ MLDSA87 serialization tests (keys and signatures)
- ✅ Edge case tests (binary data, UTF-8, bit flips)

### 🚧 Pending Implementation Tests (Ignored)

#### Key Management Tests (`key_management_tests.rs`)
- ⏸️ Agent identity creation and management
- ⏸️ Key store operations (store, retrieve, delete)
- ⏸️ Key rotation policies and automation
- ⏸️ Key export/import (PEM, DER, encrypted)
- ⏸️ Key metadata tracking

#### KEM Tests (`kem_tests.rs`)
- ⏸️ Kyber keypair generation (512, 768, 1024)
- ⏸️ Encapsulation and decapsulation
- ⏸️ Shared secret generation
- ⏸️ KEM serialization
- ⏸️ Security level tests

#### Hash Tests (`hash_tests.rs`)
- ⏸️ Blake3 hashing (standard, keyed, derive)
- ⏸️ SHA3 hashing (256, 512, SHAKE)
- ⏸️ Hash properties (determinism, avalanche)
- ⏸️ Streaming hashing
- ⏸️ Hash utilities (hex, base64)

#### Hybrid Crypto Tests (`hybrid_crypto_tests.rs`)
- ⏸️ Hybrid signature schemes (Ed25519 + Dilithium)
- ⏸️ Hybrid KEM (X25519 + Kyber)
- ⏸️ Migration strategies (classical → hybrid → PQ)
- ⏸️ Hybrid security properties
- ⏸️ Interoperability tests

#### Integration Tests (`full_workflow_tests.rs`)
- ⏸️ Agent registration and authentication workflows
- ⏸️ Secure communication workflows
- ⏸️ Key lifecycle workflows
- ⏸️ Multi-agent workflows
- ⏸️ Performance and error recovery tests

## Mock Implementations

The `mocks/` directory provides test doubles for London School TDD:

### Available Mocks
- `MockSigner` - Signature operations with configurable failures
- `MockKeyStore` - In-memory key storage
- `MockKEM` - KEM operations simulation
- `MockHasher` - Deterministic and non-deterministic hashing
- `MockAgentIdentity` - Agent identity simulation
- `MockRotationPolicy` - Key rotation policy testing

### Using Mocks
```rust
use cretoai_crypto::tests::mocks::*;

#[test]
fn test_with_mock_signer() {
    let signer = MockSigner::new("test-key");
    let message = b"test";

    let signature = signer.sign(message).unwrap();
    assert!(signer.verify(message, &signature).is_ok());
}
```

## Implementation Status

### Phase 1: Foundation (Current)
- ✅ Error types and handling
- ✅ MLDSA87 signature scheme
- ⏸️ SPHINCS+ signature scheme
- ⏸️ Kyber KEM
- ⏸️ Hash functions (Blake3, SHA3)

### Phase 2: Key Management
- ⏸️ Agent identity management
- ⏸️ Key store implementation
- ⏸️ Key rotation policies
- ⏸️ Key export/import

### Phase 3: Advanced Features
- ⏸️ Hybrid cryptography
- ⏸️ Migration strategies
- ⏸️ Performance optimization
- ⏸️ WASM compatibility

## Adding New Tests

### 1. Create Test File
```rust
// tests/unit/new_feature_tests.rs

use cretoai_crypto::error::{CryptoError, Result};

#[cfg(test)]
mod new_feature_basic_tests {
    use super::*;

    #[test]
    #[ignore = "Implementation pending"]
    fn test_new_feature_basic_operation() {
        // TODO: Implement when feature is available
        // let result = new_feature_operation();
        // assert!(result.is_ok());
    }
}
```

### 2. Add to Module
```rust
// tests/unit/mod.rs
pub mod new_feature_tests;
```

### 3. Remove Ignore When Implemented
```rust
#[test] // Remove #[ignore] attribute
fn test_new_feature_basic_operation() {
    let result = new_feature_operation();
    assert!(result.is_ok());
}
```

## Test Naming Convention

- **Format:** `test_<component>_<scenario>_<expected_result>`
- **Examples:**
  - `test_verify_signature_fails_with_wrong_message`
  - `test_blake3_hash_empty_input`
  - `test_key_store_retrieve_nonexistent_key_fails`

## Continuous Integration

### Pre-commit Checks
```bash
cargo fmt --check
cargo clippy -- -D warnings
cargo test
```

### CI Pipeline
```yaml
- name: Run Tests
  run: |
    cargo test --workspace
    cargo test --workspace -- --ignored
    cargo tarpaulin --out Lcov
```

## Debugging Tests

### Run Single Test with Backtrace
```bash
RUST_BACKTRACE=1 cargo test test_name -- --exact
```

### Run Test with Logs
```bash
RUST_LOG=debug cargo test test_name -- --nocapture
```

### Profile Test Performance
```bash
cargo test --release -- --nocapture
```

## Performance Benchmarks

### Run Benchmarks
```bash
cargo bench -p cretoai-crypto
```

### Performance Targets
- **Key Generation:** <100ms (Dilithium5)
- **Signing:** <10ms per signature
- **Verification:** <5ms per signature
- **Hashing:** >1 GB/sec (Blake3)

## Contributing

### Before Submitting PR
1. Write tests first (TDD)
2. Ensure all tests pass: `cargo test`
3. Check coverage: `cargo tarpaulin`
4. Run clippy: `cargo clippy`
5. Format code: `cargo fmt`

### Test Requirements for PR
- ✅ All new code has tests
- ✅ Coverage >90%
- ✅ All tests pass
- ✅ No clippy warnings

## Resources

- [Rust Testing Documentation](https://doc.rust-lang.org/book/ch11-00-testing.html)
- [TDD Best Practices](https://martinfowler.com/bliki/TestDrivenDevelopment.html)
- [London School TDD](http://www.growing-object-oriented-software.com/)
- [NIST Post-Quantum Cryptography](https://csrc.nist.gov/projects/post-quantum-cryptography)

## Questions?

For questions about the test suite, contact the CretoAI development team or open an issue on GitHub.
