//! # Vigilia AI Cryptography Module
//!
//! This module implements quantum-resistant cryptographic primitives for the Vigilia AI protocol.
//!
//! ## Features
//!
//! - **Post-Quantum Signatures**: Dilithium and SPHINCS+ for quantum-resistant digital signatures
//! - **Post-Quantum KEM**: Kyber for key encapsulation mechanism
//! - **Hybrid Cryptography**: Combines classical (Ed25519) with post-quantum algorithms
//! - **Hashing**: SHA3 and BLAKE3 for secure hashing
//! - **Key Management**: Secure key generation, storage, and rotation
//!
//! ## Module Structure
//!
//! ```text
//! crypto/
//! ├── signatures/     - Quantum-resistant signature schemes
//! ├── kem/           - Key encapsulation mechanisms
//! ├── hash/          - Cryptographic hash functions
//! ├── keys/          - Key generation and management
//! ├── hybrid/        - Hybrid classical/quantum schemes
//! └── batch_verify/  - Batch signature verification
//! ```

pub mod batch_verify;
pub mod error;
pub mod hash;
pub mod hybrid;
pub mod kem;
pub mod keys;
pub mod signatures;
pub mod simd_hash;
pub mod simd_intrinsics;

pub use error::{CryptoError, Result};
pub use simd_hash::{hash_batch, hash_batch_simd, hash_single, SIMDHasher};
pub use simd_intrinsics::{detect_simd_features, SIMDOps, SIMDPlatform};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_module_import() {
        // Basic smoke test to ensure module compiles
        assert!(true);
    }
}
