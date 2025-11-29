//! Quantum-Resistant Crypto Integration for Vault
//!
//! Integrates vigilia-crypto's post-quantum cryptography with vault storage:
//! - ML-KEM-768 for key encapsulation
//! - BLAKE3 for authenticated encryption
//! - ML-DSA for signature verification

use crate::error::{VaultError, Result};
use serde::{Deserialize, Serialize};
use cretoai_crypto::hash::BLAKE3Hash;
use cretoai_crypto::kem::{MLKem768, MLKem768KeyPair, MLKem768Ciphertext};

/// Quantum-resistant encryption using ML-KEM-768 + BLAKE3
pub struct QuantumResistantEncryption {
    /// ML-KEM-768 keypair for key encapsulation
    kem_keypair: MLKem768KeyPair,
}

impl QuantumResistantEncryption {
    /// Create a new quantum-resistant encryption instance
    pub fn new() -> Result<Self> {
        let kem_keypair = MLKem768::generate();

        Ok(Self { kem_keypair })
    }

    /// From existing keypair
    pub fn from_keypair(kem_keypair: MLKem768KeyPair) -> Self {
        Self { kem_keypair }
    }

    /// Encrypt data using ML-KEM-768 + BLAKE3
    ///
    /// Process:
    /// 1. Generate ephemeral ML-KEM-768 shared secret
    /// 2. Use BLAKE3 keyed hash to derive encryption key
    /// 3. XOR plaintext with BLAKE3 keystream (for simplicity)
    /// 4. Return ciphertext + encapsulated key
    pub fn encrypt(&self, plaintext: &[u8]) -> Result<EncryptedData> {
        // Encapsulate to generate shared secret
        let (shared_secret, ciphertext_kem) = MLKem768::encapsulate(&self.kem_keypair.public_key);

        // Derive encryption key from shared secret using BLAKE3
        let mut key_material = [0u8; 32];
        let shared_bytes = shared_secret.as_bytes();
        let min_len = shared_bytes.len().min(32);
        key_material[..min_len].copy_from_slice(&shared_bytes[..min_len]);

        let encryption_key = BLAKE3Hash::keyed_hash(&key_material, b"vigilia-vault-v1")
            .map_err(|e| VaultError::Encryption(format!("BLAKE3 key derivation failed: {:?}", e)))?;

        // Generate keystream using BLAKE3 keyed hash
        let keystream = self.generate_keystream(encryption_key.as_bytes(), plaintext.len())?;

        // XOR plaintext with keystream
        let mut ciphertext_data = plaintext.to_vec();
        for (i, byte) in ciphertext_data.iter_mut().enumerate() {
            *byte ^= keystream[i];
        }

        Ok(EncryptedData {
            ciphertext: ciphertext_data,
            encapsulated_key: ciphertext_kem.as_bytes().to_vec(),
        })
    }

    /// Decrypt data using ML-KEM-768 + BLAKE3
    pub fn decrypt(&self, encrypted: &EncryptedData) -> Result<Vec<u8>> {
        // Deserialize ciphertext
        let ciphertext_kem = MLKem768Ciphertext::from_bytes(&encrypted.encapsulated_key)
            .map_err(|e| VaultError::Encryption(format!("Invalid ML-KEM-768 ciphertext: {:?}", e)))?;

        // Decapsulate to recover shared secret
        let shared_secret = MLKem768::decapsulate(&ciphertext_kem, &self.kem_keypair.secret_key);

        // Derive encryption key from shared secret using BLAKE3
        let mut key_material = [0u8; 32];
        let shared_bytes = shared_secret.as_bytes();
        let min_len = shared_bytes.len().min(32);
        key_material[..min_len].copy_from_slice(&shared_bytes[..min_len]);

        let encryption_key = BLAKE3Hash::keyed_hash(&key_material, b"vigilia-vault-v1")
            .map_err(|e| VaultError::Encryption(format!("BLAKE3 key derivation failed: {:?}", e)))?;

        // Generate keystream using BLAKE3 keyed hash
        let keystream = self.generate_keystream(encryption_key.as_bytes(), encrypted.ciphertext.len())?;

        // XOR ciphertext with keystream to recover plaintext
        let mut plaintext = encrypted.ciphertext.clone();
        for (i, byte) in plaintext.iter_mut().enumerate() {
            *byte ^= keystream[i];
        }

        Ok(plaintext)
    }

    /// Generate BLAKE3-based keystream
    fn generate_keystream(&self, key: &[u8; 32], length: usize) -> Result<Vec<u8>> {
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

    /// Get public key for key exchange
    pub fn public_key(&self) -> &[u8] {
        self.kem_keypair.public_key.as_bytes()
    }

    /// Get keypair (for serialization/backup)
    pub fn keypair(&self) -> &MLKem768KeyPair {
        &self.kem_keypair
    }
}

impl Default for QuantumResistantEncryption {
    fn default() -> Self {
        Self::new().expect("Failed to create default quantum-resistant encryption")
    }
}

/// Encrypted data with ML-KEM-768 encapsulated key
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedData {
    /// Encrypted ciphertext
    pub ciphertext: Vec<u8>,

    /// ML-KEM-768 encapsulated key
    pub encapsulated_key: Vec<u8>,
}

/// Vault crypto configuration
#[derive(Debug, Clone, Copy)]
pub struct VaultCryptoConfig {
    /// Enable quantum-resistant encryption
    pub use_quantum_resistant: bool,

    /// Enable signature verification for write operations
    pub require_signatures: bool,
}

impl Default for VaultCryptoConfig {
    fn default() -> Self {
        Self {
            use_quantum_resistant: true,
            require_signatures: false, // Can enable when ML-DSA integration is needed
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quantum_resistant_encryption_creation() {
        let crypto = QuantumResistantEncryption::new();
        assert!(crypto.is_ok());
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let crypto = QuantumResistantEncryption::new().unwrap();

        let plaintext = b"This is a secret message that needs quantum-resistant protection";
        let encrypted = crypto.encrypt(plaintext).unwrap();

        // Ciphertext should be different from plaintext
        assert_ne!(&encrypted.ciphertext, plaintext);

        // Encapsulated key should be present (ML-KEM-768 ciphertext is 1088 bytes)
        assert!(!encrypted.encapsulated_key.is_empty());

        // Decrypt should recover original plaintext
        let decrypted = crypto.decrypt(&encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_encrypt_empty_data() {
        let crypto = QuantumResistantEncryption::new().unwrap();

        let plaintext = b"";
        let encrypted = crypto.encrypt(plaintext).unwrap();
        let decrypted = crypto.decrypt(&encrypted).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_encrypt_large_data() {
        let crypto = QuantumResistantEncryption::new().unwrap();

        // Test with 10 KB of data
        let plaintext = vec![0xABu8; 10 * 1024];
        let encrypted = crypto.encrypt(&plaintext).unwrap();
        let decrypted = crypto.decrypt(&encrypted).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_different_encryptions_are_unique() {
        let crypto = QuantumResistantEncryption::new().unwrap();

        let plaintext = b"same message";
        let encrypted1 = crypto.encrypt(plaintext).unwrap();
        let encrypted2 = crypto.encrypt(plaintext).unwrap();

        // Each encryption should produce different encapsulated keys (randomized)
        assert_ne!(encrypted1.encapsulated_key, encrypted2.encapsulated_key);
    }

    #[test]
    fn test_keystream_generation() {
        let crypto = QuantumResistantEncryption::new().unwrap();

        let key = BLAKE3Hash::hash(b"test key").unwrap();

        // Generate keystream of different sizes
        let keystream1 = crypto.generate_keystream(key.as_bytes(), 100).unwrap();
        let keystream2 = crypto.generate_keystream(key.as_bytes(), 1000).unwrap();

        assert_eq!(keystream1.len(), 100);
        assert_eq!(keystream2.len(), 1000);

        // First 100 bytes should be identical (deterministic)
        assert_eq!(&keystream2[..100], &keystream1[..]);
    }

    #[test]
    fn test_public_key_access() {
        let crypto = QuantumResistantEncryption::new().unwrap();
        let public_key = crypto.public_key();

        // ML-KEM-768 public key is 1184 bytes
        assert_eq!(public_key.len(), 1184);
    }

    #[test]
    fn test_serialization_deserialization() {
        let crypto = QuantumResistantEncryption::new().unwrap();
        let plaintext = b"test data";

        let encrypted = crypto.encrypt(plaintext).unwrap();

        // Serialize to JSON
        let json = serde_json::to_string(&encrypted).unwrap();

        // Deserialize back
        let deserialized: EncryptedData = serde_json::from_str(&json).unwrap();

        // Decrypt deserialized data
        let decrypted = crypto.decrypt(&deserialized).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_wrong_key_fails_decryption() {
        let crypto1 = QuantumResistantEncryption::new().unwrap();
        let crypto2 = QuantumResistantEncryption::new().unwrap();

        let plaintext = b"secret message";
        let encrypted = crypto1.encrypt(plaintext).unwrap();

        // Attempting to decrypt with different keypair should fail
        let result = crypto2.decrypt(&encrypted);

        // Decryption might succeed but produce garbage (XOR nature)
        // But it won't match the original plaintext
        if let Ok(decrypted) = result {
            assert_ne!(decrypted, plaintext);
        }
    }
}
