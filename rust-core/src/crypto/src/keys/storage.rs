use crate::error::{CryptoError, Result};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// In-memory key storage (for development/testing)
/// Production systems should use secure key management systems
pub struct KeyStore {
    keys: Arc<RwLock<HashMap<String, Vec<u8>>>>,
}

impl KeyStore {
    /// Create a new key store
    pub fn new() -> Self {
        KeyStore {
            keys: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Store a key
    pub fn store(&self, key_id: String, key_data: Vec<u8>) -> Result<()> {
        let mut keys = self.keys.write().map_err(|_| CryptoError::KeyStorageError)?;
        keys.insert(key_id, key_data);
        Ok(())
    }

    /// Retrieve a key
    pub fn retrieve(&self, key_id: &str) -> Result<Vec<u8>> {
        let keys = self.keys.read().map_err(|_| CryptoError::KeyRetrievalError)?;
        keys.get(key_id)
            .cloned()
            .ok_or(CryptoError::KeyNotFound)
    }

    /// Delete a key
    pub fn delete(&self, key_id: &str) -> Result<()> {
        let mut keys = self.keys.write().map_err(|_| CryptoError::KeyStorageError)?;
        keys.remove(key_id);
        Ok(())
    }

    /// List all key IDs
    pub fn list_keys(&self) -> Result<Vec<String>> {
        let keys = self.keys.read().map_err(|_| CryptoError::KeyRetrievalError)?;
        Ok(keys.keys().cloned().collect())
    }
}

impl Default for KeyStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_storage() {
        let store = KeyStore::new();
        let key_data = vec![1, 2, 3, 4];

        store.store("test-key".to_string(), key_data.clone()).unwrap();
        let retrieved = store.retrieve("test-key").unwrap();

        assert_eq!(retrieved, key_data);
    }

    #[test]
    fn test_key_deletion() {
        let store = KeyStore::new();
        store.store("test-key".to_string(), vec![1, 2, 3]).unwrap();
        store.delete("test-key").unwrap();

        let result = store.retrieve("test-key");
        assert!(result.is_err());
    }
}
