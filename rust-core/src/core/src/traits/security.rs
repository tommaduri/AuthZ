//! Security-related traits

use crate::error::Result;
use crate::types::{PublicKey, Signature};
use async_trait::async_trait;

/// Signature verification trait
#[async_trait]
pub trait SignatureVerifier: Send + Sync {
    /// Verify a signature on data
    async fn verify(&self, data: &[u8], signature: &Signature, public_key: &PublicKey) -> Result<bool>;

    /// Verify a batch of signatures
    async fn verify_batch(
        &self,
        messages: &[(&[u8], &Signature, &PublicKey)],
    ) -> Result<Vec<bool>> {
        let mut results = Vec::with_capacity(messages.len());
        for (data, sig, key) in messages {
            results.push(self.verify(data, sig, key).await?);
        }
        Ok(results)
    }
}

/// Key generation trait
#[async_trait]
pub trait KeyGenerator: Send + Sync {
    /// Generate a new keypair
    async fn generate_keypair(&self) -> Result<(PublicKey, Vec<u8>)>;

    /// Derive public key from private key
    async fn derive_public_key(&self, private_key: &[u8]) -> Result<PublicKey>;
}

/// Message signing trait
#[async_trait]
pub trait MessageSigner: Send + Sync {
    /// Sign data with a private key
    async fn sign(&self, data: &[u8], private_key: &[u8]) -> Result<Signature>;

    /// Sign multiple messages in batch
    async fn sign_batch(&self, messages: &[(&[u8], &[u8])]) -> Result<Vec<Signature>> {
        let mut signatures = Vec::with_capacity(messages.len());
        for (data, key) in messages {
            signatures.push(self.sign(data, key).await?);
        }
        Ok(signatures)
    }
}

/// Encryption trait
#[async_trait]
pub trait Encryptor: Send + Sync {
    /// Encrypt data
    async fn encrypt(&self, data: &[u8], public_key: &PublicKey) -> Result<Vec<u8>>;

    /// Decrypt data
    async fn decrypt(&self, encrypted: &[u8], private_key: &[u8]) -> Result<Vec<u8>>;
}

/// Authentication trait
#[async_trait]
pub trait Authenticator: Send + Sync {
    /// Authenticate a peer
    async fn authenticate(&self, peer_id: &str, proof: &[u8]) -> Result<bool>;

    /// Create authentication proof
    async fn create_proof(&self, peer_id: &str, private_key: &[u8]) -> Result<Vec<u8>>;
}

#[cfg(test)]
mod tests {
    use super::*;

    // Mock verifier for testing
    struct MockVerifier;

    #[async_trait]
    impl SignatureVerifier for MockVerifier {
        async fn verify(
            &self,
            _data: &[u8],
            _signature: &Signature,
            _public_key: &PublicKey,
        ) -> Result<bool> {
            Ok(true)
        }
    }

    #[tokio::test]
    async fn test_mock_verifier() {
        let verifier = MockVerifier;
        let data = b"test data";
        let sig = Signature::new(vec![1; 64]);
        let key = PublicKey::new(vec![2; 32]);

        let result = verifier.verify(data, &sig, &key).await;
        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[tokio::test]
    async fn test_batch_verify() {
        let verifier = MockVerifier;
        let sig1 = Signature::new(vec![1; 64]);
        let key1 = PublicKey::new(vec![2; 32]);
        let sig2 = Signature::new(vec![3; 64]);
        let key2 = PublicKey::new(vec![4; 32]);

        let messages = vec![
            (b"msg1".as_slice(), &sig1, &key1),
            (b"msg2".as_slice(), &sig2, &key2),
        ];

        let results = verifier.verify_batch(&messages).await;
        assert!(results.is_ok());
        assert_eq!(results.unwrap().len(), 2);
    }
}
