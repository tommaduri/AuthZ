//! Mock implementations for London School TDD
//!
//! These mocks allow testing without real cryptographic operations
//! and enable testing of error conditions and edge cases.

use cretoai_crypto::error::{CryptoError, Result};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Mock signature scheme for testing
pub struct MockSigner {
    pub key_id: String,
    pub should_fail: bool,
    pub signature_count: Arc<Mutex<usize>>,
}

impl MockSigner {
    pub fn new(key_id: &str) -> Self {
        Self {
            key_id: key_id.to_string(),
            should_fail: false,
            signature_count: Arc::new(Mutex::new(0)),
        }
    }

    pub fn new_failing() -> Self {
        Self {
            key_id: "failing-key".to_string(),
            should_fail: true,
            signature_count: Arc::new(Mutex::new(0)),
        }
    }

    pub fn sign(&self, _message: &[u8]) -> Result<Vec<u8>> {
        if self.should_fail {
            return Err(CryptoError::SignatureGeneration("mock failure".to_string()));
        }

        let mut count = self.signature_count.lock().unwrap();
        *count += 1;

        Ok(format!("mock-signature-{}-{}", self.key_id, *count).into_bytes())
    }

    pub fn verify(&self, _message: &[u8], signature: &[u8]) -> Result<()> {
        if self.should_fail {
            return Err(CryptoError::SignatureVerificationFailed);
        }

        // Mock verification just checks signature format
        if signature.starts_with(b"mock-signature") {
            Ok(())
        } else {
            Err(CryptoError::SignatureVerificationFailed)
        }
    }

    pub fn signature_count(&self) -> usize {
        *self.signature_count.lock().unwrap()
    }
}

/// Mock key store for testing
pub struct MockKeyStore {
    storage: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    should_fail_on_store: bool,
    should_fail_on_retrieve: bool,
}

impl MockKeyStore {
    pub fn new() -> Self {
        Self {
            storage: Arc::new(Mutex::new(HashMap::new())),
            should_fail_on_store: false,
            should_fail_on_retrieve: false,
        }
    }

    pub fn new_failing_store() -> Self {
        Self {
            storage: Arc::new(Mutex::new(HashMap::new())),
            should_fail_on_store: true,
            should_fail_on_retrieve: false,
        }
    }

    pub fn new_failing_retrieve() -> Self {
        Self {
            storage: Arc::new(Mutex::new(HashMap::new())),
            should_fail_on_store: false,
            should_fail_on_retrieve: true,
        }
    }

    pub fn store(&self, key_id: &str, key_data: &[u8]) -> Result<()> {
        if self.should_fail_on_store {
            return Err(CryptoError::KeyStorageError);
        }

        let mut storage = self.storage.lock().unwrap();
        storage.insert(key_id.to_string(), key_data.to_vec());
        Ok(())
    }

    pub fn retrieve(&self, key_id: &str) -> Result<Vec<u8>> {
        if self.should_fail_on_retrieve {
            return Err(CryptoError::KeyRetrievalError);
        }

        let storage = self.storage.lock().unwrap();
        storage
            .get(key_id)
            .map(|v| v.clone())
            .ok_or(CryptoError::KeyNotFound)
    }

    pub fn delete(&self, key_id: &str) -> Result<()> {
        let mut storage = self.storage.lock().unwrap();
        storage.remove(key_id).ok_or(CryptoError::KeyNotFound)?;
        Ok(())
    }

    pub fn list_keys(&self) -> Vec<String> {
        let storage = self.storage.lock().unwrap();
        storage.keys().cloned().collect()
    }

    pub fn clear(&self) {
        let mut storage = self.storage.lock().unwrap();
        storage.clear();
    }

    pub fn size(&self) -> usize {
        let storage = self.storage.lock().unwrap();
        storage.len()
    }
}

/// Mock KEM for testing
pub struct MockKEM {
    should_fail_encapsulate: bool,
    should_fail_decapsulate: bool,
}

impl MockKEM {
    pub fn new() -> Self {
        Self {
            should_fail_encapsulate: false,
            should_fail_decapsulate: false,
        }
    }

    pub fn new_failing_encapsulate() -> Self {
        Self {
            should_fail_encapsulate: true,
            should_fail_decapsulate: false,
        }
    }

    pub fn new_failing_decapsulate() -> Self {
        Self {
            should_fail_encapsulate: false,
            should_fail_decapsulate: true,
        }
    }

    pub fn encapsulate(&self, _public_key: &[u8]) -> Result<(Vec<u8>, Vec<u8>)> {
        if self.should_fail_encapsulate {
            return Err(CryptoError::Encryption("mock encapsulation failure".to_string()));
        }

        let ciphertext = b"mock-ciphertext".to_vec();
        let shared_secret = b"mock-shared-secret-32-bytes!".to_vec();

        Ok((ciphertext, shared_secret))
    }

    pub fn decapsulate(&self, ciphertext: &[u8], _secret_key: &[u8]) -> Result<Vec<u8>> {
        if self.should_fail_decapsulate {
            return Err(CryptoError::Decryption("mock decapsulation failure".to_string()));
        }

        if ciphertext != b"mock-ciphertext" {
            return Err(CryptoError::InvalidCiphertext);
        }

        Ok(b"mock-shared-secret-32-bytes!".to_vec())
    }
}

/// Mock hasher for testing
pub struct MockHasher {
    should_fail: bool,
    deterministic: bool,
}

impl MockHasher {
    pub fn new() -> Self {
        Self {
            should_fail: false,
            deterministic: true,
        }
    }

    pub fn new_failing() -> Self {
        Self {
            should_fail: true,
            deterministic: true,
        }
    }

    pub fn new_non_deterministic() -> Self {
        Self {
            should_fail: false,
            deterministic: false,
        }
    }

    pub fn hash(&self, data: &[u8]) -> Result<Vec<u8>> {
        if self.should_fail {
            return Err(CryptoError::Hashing("mock hash failure".to_string()));
        }

        if self.deterministic {
            // Simple deterministic mock hash
            let sum: u64 = data.iter().map(|&b| b as u64).sum();
            Ok(format!("mock-hash-{:016x}", sum)
                .as_bytes()
                .to_vec())
        } else {
            // Non-deterministic (for testing randomness)
            use std::time::{SystemTime, UNIX_EPOCH};
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            Ok(format!("mock-hash-{:032x}", nanos)
                .as_bytes()
                .to_vec())
        }
    }
}

/// Mock agent identity for testing
#[derive(Clone)]
pub struct MockAgentIdentity {
    pub agent_id: String,
    pub public_key: Vec<u8>,
    signer: Arc<MockSigner>,
}

impl MockAgentIdentity {
    pub fn new(agent_id: &str) -> Self {
        Self {
            agent_id: agent_id.to_string(),
            public_key: format!("mock-pubkey-{}", agent_id).into_bytes(),
            signer: Arc::new(MockSigner::new(agent_id)),
        }
    }

    pub fn agent_id(&self) -> &str {
        &self.agent_id
    }

    pub fn public_key(&self) -> &[u8] {
        &self.public_key
    }

    pub fn sign(&self, message: &[u8]) -> Result<Vec<u8>> {
        self.signer.sign(message)
    }

    pub fn verify(&self, message: &[u8], signature: &[u8]) -> Result<()> {
        self.signer.verify(message, signature)
    }

    pub fn signature_count(&self) -> usize {
        self.signer.signature_count()
    }
}

/// Mock key rotation policy for testing
pub struct MockRotationPolicy {
    max_age_days: Option<u32>,
    max_operations: Option<usize>,
}

impl MockRotationPolicy {
    pub fn new() -> Self {
        Self {
            max_age_days: None,
            max_operations: None,
        }
    }

    pub fn with_max_age_days(mut self, days: u32) -> Self {
        self.max_age_days = Some(days);
        self
    }

    pub fn with_max_operations(mut self, operations: usize) -> Self {
        self.max_operations = Some(operations);
        self
    }

    pub fn should_rotate(&self, age_days: u32, operation_count: usize) -> bool {
        if let Some(max_age) = self.max_age_days {
            if age_days >= max_age {
                return true;
            }
        }

        if let Some(max_ops) = self.max_operations {
            if operation_count >= max_ops {
                return true;
            }
        }

        false
    }
}

#[cfg(test)]
mod mock_tests {
    use super::*;

    #[test]
    fn test_mock_signer_basic_usage() {
        let signer = MockSigner::new("test-key");
        let message = b"test message";

        let signature = signer.sign(message).unwrap();
        assert!(signer.verify(message, &signature).is_ok());
    }

    #[test]
    fn test_mock_signer_failure_mode() {
        let signer = MockSigner::new_failing();
        let message = b"test message";

        let result = signer.sign(message);
        assert!(result.is_err());
    }

    #[test]
    fn test_mock_key_store_basic_usage() {
        let store = MockKeyStore::new();

        store.store("key1", b"data1").unwrap();
        let retrieved = store.retrieve("key1").unwrap();

        assert_eq!(retrieved, b"data1");
    }

    #[test]
    fn test_mock_key_store_not_found() {
        let store = MockKeyStore::new();

        let result = store.retrieve("nonexistent");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), CryptoError::KeyNotFound));
    }

    #[test]
    fn test_mock_kem_basic_usage() {
        let kem = MockKEM::new();
        let public_key = b"mock-public-key";

        let (ciphertext, secret1) = kem.encapsulate(public_key).unwrap();
        let secret2 = kem.decapsulate(&ciphertext, b"mock-secret-key").unwrap();

        assert_eq!(secret1, secret2);
    }

    #[test]
    fn test_mock_hasher_deterministic() {
        let hasher = MockHasher::new();

        let hash1 = hasher.hash(b"test").unwrap();
        let hash2 = hasher.hash(b"test").unwrap();

        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_mock_agent_identity() {
        let identity = MockAgentIdentity::new("agent-001");

        assert_eq!(identity.agent_id(), "agent-001");
        assert!(!identity.public_key().is_empty());

        let message = b"test";
        let sig = identity.sign(message).unwrap();
        assert!(identity.verify(message, &sig).is_ok());
    }

    #[test]
    fn test_mock_rotation_policy() {
        let policy = MockRotationPolicy::new()
            .with_max_age_days(90)
            .with_max_operations(1000);

        assert!(!policy.should_rotate(30, 500));
        assert!(policy.should_rotate(100, 500));
        assert!(policy.should_rotate(30, 1500));
    }
}
