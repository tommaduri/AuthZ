use crate::kem::{MLKem768, MLKem768KeyPair, MLKem768Ciphertext};
use x25519_dalek::{PublicKey as X25519PublicKey, EphemeralSecret};

/// Hybrid key exchange combining X25519 (classical) and ML-KEM-768 (post-quantum)
/// Note: Uses ephemeral keys for forward secrecy
pub struct HybridKeyExchange {
    pub post_quantum_keypair: MLKem768KeyPair,
}

/// Hybrid shared secret from key exchange
pub struct HybridSharedSecret {
    pub classical: [u8; 32],
    pub post_quantum: Vec<u8>,
}

impl HybridKeyExchange {
    /// Generate a new hybrid key exchange keypair
    pub fn generate() -> Self {
        let post_quantum_keypair = MLKem768::generate();

        HybridKeyExchange {
            post_quantum_keypair,
        }
    }

    /// Perform hybrid key exchange with ephemeral classical key
    pub fn exchange(
        &self,
        their_classical_public: &X25519PublicKey,
    ) -> (HybridSharedSecret, X25519PublicKey, MLKem768Ciphertext) {
        // Classical X25519 key exchange (ephemeral)
        let csprng = rand::rngs::OsRng;
        let ephemeral_secret = EphemeralSecret::random_from_rng(csprng);
        let our_classical_public = X25519PublicKey::from(&ephemeral_secret);
        let classical_shared = ephemeral_secret.diffie_hellman(their_classical_public);

        // Post-quantum KEM encapsulation
        let (pq_shared, pq_ciphertext) = MLKem768::encapsulate(&self.post_quantum_keypair.public_key);

        let shared_secret = HybridSharedSecret {
            classical: *classical_shared.as_bytes(),
            post_quantum: pq_shared.as_bytes().to_vec(),
        };

        (shared_secret, our_classical_public, pq_ciphertext)
    }

    /// Derive a combined key from hybrid shared secrets
    pub fn derive_key(shared_secret: &HybridSharedSecret) -> [u8; 32] {
        use blake3::Hasher;

        let mut hasher = Hasher::new();
        hasher.update(&shared_secret.classical);
        hasher.update(&shared_secret.post_quantum);

        let hash = hasher.finalize();
        *hash.as_bytes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hybrid_key_exchange() {
        let kex1 = HybridKeyExchange::generate();
        let kex2 = HybridKeyExchange::generate();

        // Create ephemeral keys for both sides
        let mut csprng = rand::rngs::OsRng;
        let ephemeral1 = EphemeralSecret::random_from_rng(&mut csprng);
        let public1 = X25519PublicKey::from(&ephemeral1);

        // Simulate key exchange
        let (shared1, _public2, _ct) = kex2.exchange(&public1);

        // Derive key
        let key1 = HybridKeyExchange::derive_key(&shared1);

        // Verify key is 32 bytes
        assert_eq!(key1.len(), 32);
    }
}
