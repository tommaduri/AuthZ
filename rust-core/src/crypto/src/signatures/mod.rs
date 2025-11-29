pub mod dilithium;
pub mod sphincs;

pub use dilithium::{MLDSA87, MLDSA87KeyPair, MLDSA87PublicKey, MLDSA87SecretKey, MLDSA87Signature};
pub use sphincs::{SphincsPlusKeyPair, SphincsPlusPublicKey, SphincsPlusSecretKey, SphincsPlusSignature};

use crate::batch_verify::{BatchItem, BatchVerificationResult};
use crate::error::Result;

/// Generic signature scheme trait for quantum-resistant algorithms
pub trait SignatureScheme: Send + Sync {
    /// Sign a message with a private key
    fn sign(&self, private_key: &[u8], message: &[u8]) -> Result<Vec<u8>>;

    /// Verify a signature with a public key
    fn verify(&self, public_key: &[u8], message: &[u8], signature: &[u8]) -> Result<bool>;

    /// Generate a new keypair (returns (private_key, public_key))
    fn generate_keypair(&self) -> (Vec<u8>, Vec<u8>);

    /// Verify a batch of signatures in parallel (default implementation)
    fn verify_batch(&self, items: Vec<BatchItem>) -> Vec<BatchVerificationResult> {
        use crate::batch_verify::verify_batch;
        verify_batch(items)
    }

    /// Verify a batch of signatures in parallel (default implementation)
    fn verify_batch_parallel(&self, items: Vec<BatchItem>) -> Vec<BatchVerificationResult> {
        use crate::batch_verify::verify_batch_parallel;
        verify_batch_parallel(items)
    }
}

/// ML-DSA-87 signature scheme implementation
pub struct ML_DSA_87;

impl ML_DSA_87 {
    /// Create a new ML-DSA-87 instance
    pub fn new() -> Self {
        Self
    }
}

impl Default for ML_DSA_87 {
    fn default() -> Self {
        Self::new()
    }
}

impl SignatureScheme for ML_DSA_87 {
    fn sign(&self, private_key: &[u8], message: &[u8]) -> Result<Vec<u8>> {
        let secret_key = MLDSA87SecretKey::from_bytes(private_key)?;
        let signature = MLDSA87::sign(message, &secret_key);
        Ok(signature.as_bytes().to_vec())
    }

    fn verify(&self, public_key: &[u8], message: &[u8], signature: &[u8]) -> Result<bool> {
        let pk = MLDSA87PublicKey::from_bytes(public_key)?;
        let sig = MLDSA87Signature::from_bytes(signature)?;
        match MLDSA87::verify(message, &sig, &pk) {
            Ok(()) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    fn generate_keypair(&self) -> (Vec<u8>, Vec<u8>) {
        let keypair = MLDSA87::generate();
        (
            keypair.secret_key.as_bytes().to_vec(),
            keypair.public_key.as_bytes().to_vec(),
        )
    }
}

/// Generic signature wrapper
pub type Signature = Vec<u8>;

/// Generic public key wrapper
pub type PublicKey = Vec<u8>;
