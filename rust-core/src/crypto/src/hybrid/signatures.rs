use crate::error::{CryptoError, Result};
use crate::signatures::{MLDSA87, MLDSA87KeyPair, MLDSA87Signature};
use ed25519_dalek::{Signer, Verifier, SigningKey, VerifyingKey, Signature as Ed25519Signature};
use rand::RngCore;

/// Hybrid signature combining classical Ed25519 and post-quantum ML-DSA
pub struct HybridSignatureKeyPair {
    pub classical: SigningKey,
    pub post_quantum: MLDSA87KeyPair,
}

/// Hybrid signature containing both classical and post-quantum signatures
pub struct HybridSignature {
    pub classical: Ed25519Signature,
    pub post_quantum: MLDSA87Signature,
}

impl HybridSignatureKeyPair {
    /// Generate a new hybrid signature keypair
    pub fn generate() -> Self {
        let mut csprng = rand::rngs::OsRng;
        let mut seed = [0u8; 32];
        csprng.fill_bytes(&mut seed);
        let classical = SigningKey::from_bytes(&seed);
        let post_quantum = MLDSA87::generate();

        HybridSignatureKeyPair {
            classical,
            post_quantum,
        }
    }

    /// Sign a message with both classical and post-quantum signatures
    pub fn sign(&self, message: &[u8]) -> HybridSignature {
        let classical = self.classical.sign(message);
        let post_quantum = self.post_quantum.sign(message);

        HybridSignature {
            classical,
            post_quantum,
        }
    }

    /// Verify a hybrid signature
    pub fn verify(&self, message: &[u8], signature: &HybridSignature) -> Result<()> {
        // Verify classical signature
        let classical_pubkey = self.classical.verifying_key();
        classical_pubkey
            .verify(message, &signature.classical)
            .map_err(|_| CryptoError::SignatureVerificationFailed)?;

        // Verify post-quantum signature
        self.post_quantum.verify(message, &signature.post_quantum)?;

        Ok(())
    }

    /// Get classical public key
    pub fn classical_public_key(&self) -> VerifyingKey {
        self.classical.verifying_key()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hybrid_signature() {
        let keypair = HybridSignatureKeyPair::generate();
        let message = b"test message";

        let signature = keypair.sign(message);
        let result = keypair.verify(message, &signature);

        assert!(result.is_ok());
    }

    #[test]
    fn test_hybrid_signature_invalid() {
        let keypair1 = HybridSignatureKeyPair::generate();
        let keypair2 = HybridSignatureKeyPair::generate();
        let message = b"test message";

        let signature = keypair1.sign(message);
        let result = keypair2.verify(message, &signature);

        assert!(result.is_err());
    }
}
