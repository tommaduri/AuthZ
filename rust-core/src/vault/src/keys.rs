//! Key management and encryption/decryption for vault secrets
//!
//! Integrates with vigilia-crypto for quantum-resistant encryption of vault secrets.

use crate::error::{VaultError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::SystemTime;
use cretoai_crypto::hash::BLAKE3Hash;

/// Encryption algorithm
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EncryptionAlgorithm {
    /// AES-256-GCM (classical)
    Aes256Gcm,

    /// ChaCha20-Poly1305 (classical)
    ChaCha20Poly1305,

    /// BLAKE3 keyed mode (quantum-resistant hashing)
    Blake3Keyed,

    /// ML-KEM-768 + BLAKE3 (quantum-resistant encryption)
    /// Note: Uses separate QuantumResistantEncryption instance
    MLKem768,
}

/// Encryption key metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyMetadata {
    /// Key ID
    pub id: String,

    /// Encryption algorithm
    pub algorithm: EncryptionAlgorithm,

    /// Creation timestamp
    pub created_at: SystemTime,

    /// Key version
    pub version: u32,

    /// Key purpose
    pub purpose: String,
}

impl KeyMetadata {
    pub fn new(id: String, algorithm: EncryptionAlgorithm, purpose: String) -> Self {
        Self {
            id,
            algorithm,
            created_at: SystemTime::now(),
            version: 1,
            purpose,
        }
    }
}

/// Encryption key
#[derive(Debug, Clone)]
pub struct EncryptionKey {
    /// Metadata
    pub metadata: KeyMetadata,

    /// Key material (sensitive - keep encrypted in production)
    key_material: Vec<u8>,
}

impl EncryptionKey {
    /// Create a new encryption key
    pub fn new(id: String, algorithm: EncryptionAlgorithm, purpose: String) -> Result<Self> {
        let key_material = match algorithm {
            EncryptionAlgorithm::Aes256Gcm => {
                // Generate 256-bit key
                // Placeholder - use rand::thread_rng() in production
                // Using non-zero test key for now
                (1..=32).collect::<Vec<u8>>()
            }
            EncryptionAlgorithm::ChaCha20Poly1305 => {
                // Generate 256-bit key
                // Placeholder - using incremental bytes for testing
                (1..=32).collect::<Vec<u8>>()
            }
            EncryptionAlgorithm::Blake3Keyed => {
                // BLAKE3 key is 32 bytes
                // Placeholder - using incremental bytes for testing
                (1..=32).collect::<Vec<u8>>()
            }
            EncryptionAlgorithm::MLKem768 => {
                // ML-KEM-768 doesn't use simple key material
                // It requires a full keypair from QuantumResistantEncryption
                // Return empty vec as placeholder (actual encryption handled separately)
                vec![]
            }
        };

        Ok(Self {
            metadata: KeyMetadata::new(id, algorithm, purpose),
            key_material,
        })
    }

    /// Encrypt data
    pub fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>> {
        match self.metadata.algorithm {
            EncryptionAlgorithm::Aes256Gcm => {
                // Placeholder: In production, use aes-gcm crate
                // For now, simple XOR for testing
                self.xor_encrypt(plaintext)
            }
            EncryptionAlgorithm::ChaCha20Poly1305 => {
                // Placeholder: In production, use chacha20poly1305 crate
                self.xor_encrypt(plaintext)
            }
            EncryptionAlgorithm::Blake3Keyed => {
                // BLAKE3 keyed hashing for encryption
                self.blake3_encrypt(plaintext)
            }
            EncryptionAlgorithm::MLKem768 => {
                // ML-KEM-768 encryption requires QuantumResistantEncryption instance
                // This is handled separately in VaultStorage
                Err(VaultError::Encryption(
                    "ML-KEM-768 encryption requires QuantumResistantEncryption instance".to_string()
                ))
            }
        }
    }

    /// Decrypt data
    pub fn decrypt(&self, ciphertext: &[u8]) -> Result<Vec<u8>> {
        match self.metadata.algorithm {
            EncryptionAlgorithm::Aes256Gcm => {
                // Placeholder: In production, use aes-gcm crate
                self.xor_decrypt(ciphertext)
            }
            EncryptionAlgorithm::ChaCha20Poly1305 => {
                // Placeholder: In production, use chacha20poly1305 crate
                self.xor_decrypt(ciphertext)
            }
            EncryptionAlgorithm::Blake3Keyed => {
                // BLAKE3 keyed hashing for decryption
                self.blake3_decrypt(ciphertext)
            }
            EncryptionAlgorithm::MLKem768 => {
                // ML-KEM-768 decryption requires QuantumResistantEncryption instance
                Err(VaultError::Decryption(
                    "ML-KEM-768 decryption requires QuantumResistantEncryption instance".to_string()
                ))
            }
        }
    }

    /// BLAKE3 keyed encryption
    fn blake3_encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>> {
        // Ensure we have a 32-byte key
        let mut key = [0u8; 32];
        let min_len = self.key_material.len().min(32);
        key[..min_len].copy_from_slice(&self.key_material[..min_len]);

        // Generate keystream
        let keystream = self.blake3_keystream(&key, plaintext.len())?;

        // XOR plaintext with keystream
        let mut ciphertext = plaintext.to_vec();
        for (i, byte) in ciphertext.iter_mut().enumerate() {
            *byte ^= keystream[i];
        }

        Ok(ciphertext)
    }

    /// BLAKE3 keyed decryption
    fn blake3_decrypt(&self, ciphertext: &[u8]) -> Result<Vec<u8>> {
        // BLAKE3 encryption is symmetric (XOR-based)
        self.blake3_encrypt(ciphertext)
    }

    /// Generate BLAKE3 keystream
    fn blake3_keystream(&self, key: &[u8; 32], length: usize) -> Result<Vec<u8>> {
        let mut keystream = Vec::with_capacity(length);
        let mut counter: u64 = 0;

        while keystream.len() < length {
            // Use BLAKE3 keyed hash with counter as additional input
            let counter_bytes = counter.to_le_bytes();
            let block = BLAKE3Hash::keyed_hash(key, &counter_bytes)
                .map_err(|e| VaultError::Encryption(format!("BLAKE3 keystream generation failed: {:?}", e)))?;

            let remaining = length - keystream.len();
            let take = remaining.min(block.as_bytes().len());
            keystream.extend_from_slice(&block.as_bytes()[..take]);

            counter += 1;
        }

        Ok(keystream)
    }

    /// Placeholder XOR encryption (for testing only)
    fn xor_encrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        let mut encrypted = data.to_vec();
        for (i, byte) in encrypted.iter_mut().enumerate() {
            *byte ^= self.key_material[i % self.key_material.len()];
        }
        Ok(encrypted)
    }

    /// Placeholder XOR decryption (for testing only)
    fn xor_decrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        // XOR is symmetric
        self.xor_encrypt(data)
    }

    /// Get key material (sensitive - use with caution)
    pub fn key_material(&self) -> &[u8] {
        &self.key_material
    }
}

/// Key manager for vault
pub struct KeyManager {
    keys: Arc<RwLock<HashMap<String, EncryptionKey>>>,
    default_algorithm: EncryptionAlgorithm,
}

impl KeyManager {
    /// Create a new key manager
    pub fn new(default_algorithm: EncryptionAlgorithm) -> Self {
        Self {
            keys: Arc::new(RwLock::new(HashMap::new())),
            default_algorithm,
        }
    }

    /// Generate a new key
    pub fn generate_key(&self, purpose: String) -> Result<String> {
        let key_id = format!("key-{}", uuid::Uuid::new_v4());
        let key = EncryptionKey::new(key_id.clone(), self.default_algorithm, purpose)?;

        let mut keys = self.keys.write().unwrap();
        keys.insert(key_id.clone(), key);

        Ok(key_id)
    }

    /// Add a key
    pub fn add_key(&self, key: EncryptionKey) -> Result<()> {
        let mut keys = self.keys.write().unwrap();
        keys.insert(key.metadata.id.clone(), key);
        Ok(())
    }

    /// Get a key
    pub fn get_key(&self, key_id: &str) -> Result<EncryptionKey> {
        let keys = self.keys.read().unwrap();
        keys.get(key_id)
            .cloned()
            .ok_or_else(|| VaultError::Key(format!("Key not found: {}", key_id)))
    }

    /// Delete a key
    pub fn delete_key(&self, key_id: &str) -> Result<()> {
        let mut keys = self.keys.write().unwrap();
        keys.remove(key_id)
            .ok_or_else(|| VaultError::Key(format!("Key not found: {}", key_id)))?;
        Ok(())
    }

    /// List all keys
    pub fn list_keys(&self) -> Vec<KeyMetadata> {
        let keys = self.keys.read().unwrap();
        keys.values().map(|k| k.metadata.clone()).collect()
    }

    /// Encrypt data with a specific key
    pub fn encrypt(&self, key_id: &str, plaintext: &[u8]) -> Result<Vec<u8>> {
        let key = self.get_key(key_id)?;
        key.encrypt(plaintext)
    }

    /// Decrypt data with a specific key
    pub fn decrypt(&self, key_id: &str, ciphertext: &[u8]) -> Result<Vec<u8>> {
        let key = self.get_key(key_id)?;
        key.decrypt(ciphertext)
    }
}

impl Default for KeyManager {
    fn default() -> Self {
        Self::new(EncryptionAlgorithm::Blake3Keyed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encryption_key_creation() {
        let key = EncryptionKey::new(
            "test-key".to_string(),
            EncryptionAlgorithm::Aes256Gcm,
            "vault-secrets".to_string(),
        )
        .unwrap();

        assert_eq!(key.metadata.id, "test-key");
        assert_eq!(key.metadata.algorithm, EncryptionAlgorithm::Aes256Gcm);
        assert_eq!(key.metadata.purpose, "vault-secrets");
        assert_eq!(key.metadata.version, 1);
    }

    #[test]
    fn test_encryption_decryption() {
        let key = EncryptionKey::new(
            "test-key".to_string(),
            EncryptionAlgorithm::Blake3Keyed,
            "vault-secrets".to_string(),
        )
        .unwrap();

        let plaintext = b"secret data";
        let ciphertext = key.encrypt(plaintext).unwrap();

        assert_ne!(ciphertext, plaintext);

        let decrypted = key.decrypt(&ciphertext).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_key_manager_generate() {
        let manager = KeyManager::default();

        let key_id = manager.generate_key("vault-secrets".to_string()).unwrap();
        assert!(key_id.starts_with("key-"));

        let key = manager.get_key(&key_id).unwrap();
        assert_eq!(key.metadata.algorithm, EncryptionAlgorithm::Blake3Keyed);
    }

    #[test]
    fn test_key_manager_add_get() {
        let manager = KeyManager::default();

        let key = EncryptionKey::new(
            "test-key".to_string(),
            EncryptionAlgorithm::Aes256Gcm,
            "vault-secrets".to_string(),
        )
        .unwrap();

        manager.add_key(key.clone()).unwrap();

        let retrieved = manager.get_key("test-key").unwrap();
        assert_eq!(retrieved.metadata.id, "test-key");
    }

    #[test]
    fn test_key_manager_delete() {
        let manager = KeyManager::default();

        let key_id = manager.generate_key("vault-secrets".to_string()).unwrap();
        assert!(manager.get_key(&key_id).is_ok());

        manager.delete_key(&key_id).unwrap();
        assert!(manager.get_key(&key_id).is_err());
    }

    #[test]
    fn test_key_manager_list() {
        let manager = KeyManager::default();

        manager.generate_key("purpose1".to_string()).unwrap();
        manager.generate_key("purpose2".to_string()).unwrap();

        let keys = manager.list_keys();
        assert_eq!(keys.len(), 2);
    }

    #[test]
    fn test_key_manager_encrypt_decrypt() {
        let manager = KeyManager::default();

        let key_id = manager.generate_key("vault-secrets".to_string()).unwrap();

        let plaintext = b"sensitive data";
        let ciphertext = manager.encrypt(&key_id, plaintext).unwrap();
        let decrypted = manager.decrypt(&key_id, &ciphertext).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_multiple_algorithms() {
        let algorithms = vec![
            EncryptionAlgorithm::Aes256Gcm,
            EncryptionAlgorithm::ChaCha20Poly1305,
            EncryptionAlgorithm::Blake3Keyed,
        ];

        for algo in algorithms {
            let key = EncryptionKey::new(
                "test-key".to_string(),
                algo,
                "test".to_string(),
            )
            .unwrap();

            let plaintext = b"test data";
            let ciphertext = key.encrypt(plaintext).unwrap();
            let decrypted = key.decrypt(&ciphertext).unwrap();

            assert_eq!(decrypted, plaintext);
        }
    }
}
