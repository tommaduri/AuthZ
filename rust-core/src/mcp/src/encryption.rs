//! End-to-End Encryption with ML-KEM-768
//!
//! Provides quantum-resistant encryption for MCP message payloads using ML-KEM-768
//! (Kyber) key encapsulation with AES-256-GCM for symmetric encryption.

use crate::error::{McpError, Result};
use crate::protocol::McpMessage;
use serde::{Deserialize, Serialize};
use cretoai_crypto::kem::{MLKem768, MLKem768Ciphertext, MLKem768PublicKey, MLKem768SecretKey};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Encrypted message wrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedMessage {
    /// KEM ciphertext (encapsulated shared secret)
    pub kem_ciphertext: Vec<u8>,
    /// Encrypted message payload (AES-256-GCM)
    pub encrypted_payload: Vec<u8>,
    /// Nonce for AES-256-GCM
    pub nonce: Vec<u8>,
    /// Recipient agent ID
    pub recipient_id: String,
    /// Timestamp
    pub timestamp: i64,
}

/// Encryption layer for message encryption
pub struct EncryptionLayer {
    /// Recipient public keys for KEM
    recipient_keys: Arc<RwLock<HashMap<String, MLKem768PublicKey>>>,
    /// Our secret key for decryption
    our_secret_key: Arc<RwLock<Option<MLKem768SecretKey>>>,
}

impl EncryptionLayer {
    /// Create a new encryption layer
    pub fn new() -> Self {
        Self {
            recipient_keys: Arc::new(RwLock::new(HashMap::new())),
            our_secret_key: Arc::new(RwLock::new(None)),
        }
    }

    /// Set our secret key for decryption
    pub async fn set_secret_key(&self, secret_key: MLKem768SecretKey) {
        let mut sk = self.our_secret_key.write().await;
        *sk = Some(secret_key);
    }

    /// Add a recipient's public key
    pub async fn add_recipient_key(
        &self,
        recipient_id: String,
        public_key_bytes: Vec<u8>,
    ) -> Result<()> {
        let public_key = MLKem768PublicKey::from_bytes(&public_key_bytes)
            .map_err(|e| McpError::Generic(format!("Invalid ML-KEM public key: {}", e)))?;

        let mut keys = self.recipient_keys.write().await;
        keys.insert(recipient_id, public_key);
        Ok(())
    }

    /// Add a recipient's public key (direct)
    pub async fn add_recipient_key_direct(
        &self,
        recipient_id: String,
        public_key: MLKem768PublicKey,
    ) -> Result<()> {
        let mut keys = self.recipient_keys.write().await;
        keys.insert(recipient_id, public_key);
        Ok(())
    }

    /// Remove a recipient's public key
    pub async fn remove_recipient_key(&self, recipient_id: &str) -> Result<()> {
        let mut keys = self.recipient_keys.write().await;
        keys.remove(recipient_id);
        Ok(())
    }

    /// Encrypt a message for a specific recipient
    pub async fn encrypt_message(
        &self,
        message: &McpMessage,
        recipient_id: String,
    ) -> Result<EncryptedMessage> {
        // Get recipient's public key
        let keys = self.recipient_keys.read().await;
        let recipient_key = keys
            .get(&recipient_id)
            .ok_or_else(|| McpError::Generic(format!("No key for recipient: {}", recipient_id)))?;

        // Serialize message
        let message_bytes = serde_json::to_vec(message)
            .map_err(|e| McpError::Generic(format!("Serialization failed: {}", e)))?;

        // Encapsulate to get shared secret and KEM ciphertext
        let (shared_secret, kem_ciphertext) = MLKem768::encapsulate(recipient_key);

        // Use shared secret to derive AES-256 key
        let aes_key = Self::derive_aes_key(shared_secret.as_bytes());

        // Generate random nonce
        let nonce = Self::generate_nonce();

        // Encrypt message with AES-256-GCM
        let encrypted_payload = Self::aes_encrypt(&message_bytes, &aes_key, &nonce)?;

        Ok(EncryptedMessage {
            kem_ciphertext: kem_ciphertext.as_bytes().to_vec(),
            encrypted_payload,
            nonce,
            recipient_id,
            timestamp: chrono::Utc::now().timestamp(),
        })
    }

    /// Decrypt a message
    pub async fn decrypt_message(&self, encrypted: &EncryptedMessage) -> Result<McpMessage> {
        // Get our secret key
        let sk_guard = self.our_secret_key.read().await;
        let secret_key = sk_guard
            .as_ref()
            .ok_or_else(|| McpError::Generic("No secret key configured".to_string()))?;

        // Reconstruct KEM ciphertext
        let kem_ciphertext = MLKem768Ciphertext::from_bytes(&encrypted.kem_ciphertext)
            .map_err(|e| McpError::Generic(format!("Invalid KEM ciphertext: {}", e)))?;

        // Decapsulate to recover shared secret
        let shared_secret = MLKem768::decapsulate(&kem_ciphertext, secret_key);

        // Derive AES-256 key from shared secret
        let aes_key = Self::derive_aes_key(shared_secret.as_bytes());

        // Decrypt payload with AES-256-GCM
        let message_bytes = Self::aes_decrypt(&encrypted.encrypted_payload, &aes_key, &encrypted.nonce)?;

        // Deserialize message
        let message: McpMessage = serde_json::from_slice(&message_bytes)
            .map_err(|e| McpError::Generic(format!("Deserialization failed: {}", e)))?;

        Ok(message)
    }

    /// Get list of known recipients
    pub async fn list_recipients(&self) -> Vec<String> {
        let keys = self.recipient_keys.read().await;
        keys.keys().cloned().collect()
    }

    // Helper: Derive AES-256 key from shared secret using BLAKE3
    fn derive_aes_key(shared_secret: &[u8]) -> [u8; 32] {
        use blake3::Hasher;
        let mut hasher = Hasher::new();
        hasher.update(b"vigilia-mcp-encryption-v1");
        hasher.update(shared_secret);
        let hash = hasher.finalize();
        *hash.as_bytes()
    }

    // Helper: Generate random nonce for AES-GCM
    fn generate_nonce() -> Vec<u8> {
        use rand::RngCore;
        let mut nonce = vec![0u8; 12]; // 96-bit nonce for GCM
        rand::thread_rng().fill_bytes(&mut nonce);
        nonce
    }

    // Helper: AES-256-GCM encryption
    fn aes_encrypt(plaintext: &[u8], key: &[u8; 32], nonce: &[u8]) -> Result<Vec<u8>> {
        use aes_gcm::{
            aead::{Aead, KeyInit},
            Aes256Gcm, Nonce,
        };

        let cipher = Aes256Gcm::new(key.into());
        let nonce = Nonce::from_slice(nonce);

        cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| McpError::Generic(format!("AES encryption failed: {}", e)))
    }

    // Helper: AES-256-GCM decryption
    fn aes_decrypt(ciphertext: &[u8], key: &[u8; 32], nonce: &[u8]) -> Result<Vec<u8>> {
        use aes_gcm::{
            aead::{Aead, KeyInit},
            Aes256Gcm, Nonce,
        };

        let cipher = Aes256Gcm::new(key.into());
        let nonce = Nonce::from_slice(nonce);

        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| McpError::Generic(format!("AES decryption failed: {}", e)))
    }
}

impl Default for EncryptionLayer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::*;

    #[tokio::test]
    async fn test_encrypt_decrypt() {
        let encryption = EncryptionLayer::new();

        // Generate keypair for recipient
        let recipient_keypair = MLKem768::generate();
        let public_key_bytes = recipient_keypair.public_key.as_bytes().to_vec();
        let public_key = MLKem768PublicKey::from_bytes(&public_key_bytes).unwrap();

        // Add recipient's public key
        encryption
            .add_recipient_key_direct("recipient-1".to_string(), public_key)
            .await
            .unwrap();

        // Set our secret key (we're the recipient)
        encryption
            .set_secret_key(recipient_keypair.secret_key.clone())
            .await;

        let message = McpMessage::Ping(PingMessage {
            id: "test-1".to_string(),
            timestamp: 1234567890,
        });

        // Encrypt
        let encrypted = encryption
            .encrypt_message(&message, "recipient-1".to_string())
            .await
            .unwrap();

        // Decrypt
        let decrypted = encryption.decrypt_message(&encrypted).await.unwrap();

        assert_eq!(message, decrypted);
    }

    #[tokio::test]
    async fn test_encrypt_for_unknown_recipient() {
        let encryption = EncryptionLayer::new();

        let message = McpMessage::Ping(PingMessage {
            id: "test-2".to_string(),
            timestamp: 1234567890,
        });

        let result = encryption
            .encrypt_message(&message, "unknown".to_string())
            .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("No key for recipient"));
    }

    #[tokio::test]
    async fn test_decrypt_without_secret_key() {
        let encryption = EncryptionLayer::new();

        let encrypted = EncryptedMessage {
            kem_ciphertext: vec![1, 2, 3],
            encrypted_payload: vec![4, 5, 6],
            nonce: vec![7, 8, 9],
            recipient_id: "test".to_string(),
            timestamp: 1234567890,
        };

        let result = encryption.decrypt_message(&encrypted).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("No secret key"));
    }

    #[tokio::test]
    async fn test_add_remove_recipient_key() {
        let encryption = EncryptionLayer::new();

        let keypair = MLKem768::generate();
        let public_key_bytes = keypair.public_key.as_bytes().to_vec();

        encryption
            .add_recipient_key("recipient-1".to_string(), public_key_bytes)
            .await
            .unwrap();

        let recipients = encryption.list_recipients().await;
        assert_eq!(recipients.len(), 1);

        encryption
            .remove_recipient_key("recipient-1")
            .await
            .unwrap();

        let recipients = encryption.list_recipients().await;
        assert_eq!(recipients.len(), 0);
    }

    #[tokio::test]
    async fn test_multiple_recipients() {
        let encryption = EncryptionLayer::new();

        // Generate two keypairs
        let keypair1 = MLKem768::generate();
        let public_key1_bytes = keypair1.public_key.as_bytes().to_vec();
        let public_key1 = MLKem768PublicKey::from_bytes(&public_key1_bytes).unwrap();

        let keypair2 = MLKem768::generate();
        let public_key2_bytes = keypair2.public_key.as_bytes().to_vec();
        let public_key2 = MLKem768PublicKey::from_bytes(&public_key2_bytes).unwrap();

        encryption
            .add_recipient_key_direct("recipient-1".to_string(), public_key1)
            .await
            .unwrap();

        encryption
            .add_recipient_key_direct("recipient-2".to_string(), public_key2)
            .await
            .unwrap();

        let message = McpMessage::Ping(PingMessage {
            id: "test-3".to_string(),
            timestamp: 1234567890,
        });

        // Encrypt for recipient 1
        let encrypted1 = encryption
            .encrypt_message(&message, "recipient-1".to_string())
            .await
            .unwrap();

        // Set recipient 1's secret key and decrypt
        encryption.set_secret_key(keypair1.secret_key.clone()).await;
        let decrypted1 = encryption.decrypt_message(&encrypted1).await.unwrap();
        assert_eq!(message, decrypted1);

        // Encrypt for recipient 2
        let encrypted2 = encryption
            .encrypt_message(&message, "recipient-2".to_string())
            .await
            .unwrap();

        // Set recipient 2's secret key and decrypt
        encryption.set_secret_key(keypair2.secret_key.clone()).await;
        let decrypted2 = encryption.decrypt_message(&encrypted2).await.unwrap();
        assert_eq!(message, decrypted2);

        // Encrypted messages should be different (different shared secrets)
        assert_ne!(encrypted1.kem_ciphertext, encrypted2.kem_ciphertext);
        assert_ne!(encrypted1.encrypted_payload, encrypted2.encrypted_payload);
    }

    #[test]
    fn test_aes_key_derivation() {
        let secret1 = b"shared_secret_1";
        let secret2 = b"shared_secret_2";

        let key1 = EncryptionLayer::derive_aes_key(secret1);
        let key2 = EncryptionLayer::derive_aes_key(secret2);

        // Different secrets should produce different keys
        assert_ne!(key1, key2);

        // Same secret should produce same key
        let key1_again = EncryptionLayer::derive_aes_key(secret1);
        assert_eq!(key1, key1_again);
    }

    #[test]
    fn test_nonce_generation() {
        let nonce1 = EncryptionLayer::generate_nonce();
        let nonce2 = EncryptionLayer::generate_nonce();

        // Nonces should be 12 bytes
        assert_eq!(nonce1.len(), 12);
        assert_eq!(nonce2.len(), 12);

        // Nonces should be different (with very high probability)
        assert_ne!(nonce1, nonce2);
    }
}
