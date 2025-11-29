//! Encrypted storage backend for vault
//!
//! Provides secure storage for secrets using quantum-resistant encryption from vigilia-crypto.

use crate::error::{VaultError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime};

/// Configuration for vault storage
#[derive(Debug, Clone)]
pub struct StorageConfig {
    /// Enable encryption at rest
    pub encrypt_at_rest: bool,

    /// Maximum secret size in bytes
    pub max_secret_size: usize,

    /// Secret time-to-live (None = no expiration)
    pub default_ttl: Option<Duration>,

    /// Enable versioning
    pub enable_versioning: bool,

    /// Maximum versions to keep per secret
    pub max_versions: usize,
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            encrypt_at_rest: true,
            max_secret_size: 1024 * 1024, // 1 MB
            default_ttl: Some(Duration::from_secs(365 * 24 * 60 * 60)), // 1 year
            enable_versioning: true,
            max_versions: 10,
        }
    }
}

/// Secret metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretMetadata {
    /// Secret path
    pub path: String,

    /// Creation timestamp
    pub created_at: SystemTime,

    /// Last modified timestamp
    pub modified_at: SystemTime,

    /// Expiration timestamp
    pub expires_at: Option<SystemTime>,

    /// Secret version
    pub version: u32,

    /// Secret size in bytes
    pub size: usize,

    /// Content type
    pub content_type: String,

    /// Custom metadata tags
    pub tags: HashMap<String, String>,
}

impl SecretMetadata {
    pub fn new(path: String, size: usize, ttl: Option<Duration>) -> Self {
        let now = SystemTime::now();
        let expires_at = ttl.map(|t| now + t);

        Self {
            path,
            created_at: now,
            modified_at: now,
            expires_at,
            version: 1,
            size,
            content_type: "application/octet-stream".to_string(),
            tags: HashMap::new(),
        }
    }

    /// Check if secret has expired
    pub fn is_expired(&self) -> bool {
        if let Some(expires_at) = self.expires_at {
            SystemTime::now() > expires_at
        } else {
            false
        }
    }
}

/// Encrypted secret entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretEntry {
    /// Secret metadata
    pub metadata: SecretMetadata,

    /// Encrypted data
    pub encrypted_data: Vec<u8>,

    /// Encryption key ID (references key in crypto module)
    pub key_id: String,

    /// Previous versions (if versioning enabled)
    pub versions: Vec<(u32, Vec<u8>)>,
}

impl SecretEntry {
    pub fn new(
        path: String,
        encrypted_data: Vec<u8>,
        key_id: String,
        ttl: Option<Duration>,
    ) -> Self {
        let size = encrypted_data.len();
        let metadata = SecretMetadata::new(path, size, ttl);

        Self {
            metadata,
            encrypted_data,
            key_id,
            versions: Vec::new(),
        }
    }

    /// Update secret with new encrypted data
    pub fn update(&mut self, encrypted_data: Vec<u8>, max_versions: usize) {
        // Store previous version if versioning is enabled
        if max_versions > 0 {
            self.versions
                .push((self.metadata.version, self.encrypted_data.clone()));

            // Keep only max_versions
            if self.versions.len() > max_versions {
                self.versions.remove(0);
            }
        }

        // Update metadata
        self.metadata.version += 1;
        self.metadata.modified_at = SystemTime::now();
        self.metadata.size = encrypted_data.len();

        // Update data
        self.encrypted_data = encrypted_data;
    }

    /// Get a specific version of the secret
    pub fn get_version(&self, version: u32) -> Result<Vec<u8>> {
        if version == self.metadata.version {
            return Ok(self.encrypted_data.clone());
        }

        for (v, data) in &self.versions {
            if *v == version {
                return Ok(data.clone());
            }
        }

        Err(VaultError::Storage(format!(
            "Version {} not found",
            version
        )))
    }
}

/// Vault storage backend
pub struct VaultStorage {
    config: StorageConfig,
    secrets: Arc<RwLock<HashMap<String, SecretEntry>>>,
}

impl VaultStorage {
    /// Create a new vault storage
    pub fn new(config: StorageConfig) -> Self {
        Self {
            config,
            secrets: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Store a secret
    pub fn put(
        &self,
        path: String,
        encrypted_data: Vec<u8>,
        key_id: String,
    ) -> Result<SecretMetadata> {
        // Validate secret size
        if encrypted_data.len() > self.config.max_secret_size {
            return Err(VaultError::Storage(format!(
                "Secret too large: {} bytes (max: {})",
                encrypted_data.len(),
                self.config.max_secret_size
            )));
        }

        let mut secrets = self.secrets.write().unwrap();

        // Check if secret exists (update vs create)
        if let Some(entry) = secrets.get_mut(&path) {
            // Check if expired
            if entry.metadata.is_expired() {
                // Remove expired secret
                secrets.remove(&path);
            } else {
                // Update existing secret
                entry.update(encrypted_data, self.config.max_versions);
                return Ok(entry.metadata.clone());
            }
        }

        // Create new secret
        let entry = SecretEntry::new(path.clone(), encrypted_data, key_id, self.config.default_ttl);
        let metadata = entry.metadata.clone();
        secrets.insert(path, entry);

        Ok(metadata)
    }

    /// Get a secret
    pub fn get(&self, path: &str) -> Result<SecretEntry> {
        let secrets = self.secrets.read().unwrap();

        let entry = secrets
            .get(path)
            .ok_or_else(|| VaultError::Storage(format!("Secret not found: {}", path)))?;

        // Check if expired
        if entry.metadata.is_expired() {
            return Err(VaultError::Storage(format!("Secret expired: {}", path)));
        }

        Ok(entry.clone())
    }

    /// Get a specific version of a secret
    pub fn get_version(&self, path: &str, version: u32) -> Result<Vec<u8>> {
        let entry = self.get(path)?;
        entry.get_version(version)
    }

    /// Delete a secret
    pub fn delete(&self, path: &str) -> Result<()> {
        let mut secrets = self.secrets.write().unwrap();

        secrets
            .remove(path)
            .ok_or_else(|| VaultError::Storage(format!("Secret not found: {}", path)))?;

        Ok(())
    }

    /// List all secrets
    pub fn list(&self) -> Result<Vec<SecretMetadata>> {
        let secrets = self.secrets.read().unwrap();

        let mut metadata: Vec<SecretMetadata> = secrets
            .values()
            .filter(|entry| !entry.metadata.is_expired())
            .map(|entry| entry.metadata.clone())
            .collect();

        metadata.sort_by(|a, b| a.path.cmp(&b.path));

        Ok(metadata)
    }

    /// List secrets with prefix
    pub fn list_prefix(&self, prefix: &str) -> Result<Vec<SecretMetadata>> {
        let secrets = self.secrets.read().unwrap();

        let mut metadata: Vec<SecretMetadata> = secrets
            .values()
            .filter(|entry| entry.metadata.path.starts_with(prefix) && !entry.metadata.is_expired())
            .map(|entry| entry.metadata.clone())
            .collect();

        metadata.sort_by(|a, b| a.path.cmp(&b.path));

        Ok(metadata)
    }

    /// Check if a secret exists
    pub fn exists(&self, path: &str) -> bool {
        let secrets = self.secrets.read().unwrap();

        if let Some(entry) = secrets.get(path) {
            !entry.metadata.is_expired()
        } else {
            false
        }
    }

    /// Clean up expired secrets
    pub fn cleanup_expired(&self) -> Result<usize> {
        let mut secrets = self.secrets.write().unwrap();

        let expired_paths: Vec<String> = secrets
            .iter()
            .filter(|(_, entry)| entry.metadata.is_expired())
            .map(|(path, _)| path.clone())
            .collect();

        let count = expired_paths.len();

        for path in expired_paths {
            secrets.remove(&path);
        }

        Ok(count)
    }

    /// Get storage statistics
    pub fn stats(&self) -> StorageStats {
        let secrets = self.secrets.read().unwrap();

        let total_secrets = secrets.len();
        let active_secrets = secrets
            .values()
            .filter(|entry| !entry.metadata.is_expired())
            .count();
        let expired_secrets = total_secrets - active_secrets;

        let total_size: usize = secrets
            .values()
            .map(|entry| entry.metadata.size)
            .sum();

        StorageStats {
            total_secrets,
            active_secrets,
            expired_secrets,
            total_size,
        }
    }
}

/// Storage statistics
#[derive(Debug, Clone)]
pub struct StorageStats {
    pub total_secrets: usize,
    pub active_secrets: usize,
    pub expired_secrets: usize,
    pub total_size: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_storage_config_default() {
        let config = StorageConfig::default();
        assert!(config.encrypt_at_rest);
        assert_eq!(config.max_secret_size, 1024 * 1024);
        assert!(config.enable_versioning);
        assert_eq!(config.max_versions, 10);
    }

    #[test]
    fn test_secret_metadata() {
        let metadata = SecretMetadata::new(
            "test/secret".to_string(),
            100,
            Some(Duration::from_secs(60)),
        );

        assert_eq!(metadata.path, "test/secret");
        assert_eq!(metadata.size, 100);
        assert_eq!(metadata.version, 1);
        assert!(!metadata.is_expired());
    }

    #[test]
    fn test_secret_expiration() {
        let metadata = SecretMetadata::new(
            "test/secret".to_string(),
            100,
            Some(Duration::from_secs(0)), // Expires immediately
        );

        // Give it a moment to expire
        std::thread::sleep(Duration::from_millis(10));
        assert!(metadata.is_expired());
    }

    #[test]
    fn test_storage_put_get() {
        let storage = VaultStorage::new(StorageConfig::default());

        let data = b"secret data".to_vec();
        let metadata = storage
            .put("test/secret".to_string(), data.clone(), "key-001".to_string())
            .unwrap();

        assert_eq!(metadata.path, "test/secret");
        assert_eq!(metadata.version, 1);

        let entry = storage.get("test/secret").unwrap();
        assert_eq!(entry.encrypted_data, data);
        assert_eq!(entry.key_id, "key-001");
    }

    #[test]
    fn test_storage_update_versioning() {
        let storage = VaultStorage::new(StorageConfig::default());

        // Create initial secret
        let data1 = b"version 1".to_vec();
        storage
            .put("test/secret".to_string(), data1.clone(), "key-001".to_string())
            .unwrap();

        // Update secret
        let data2 = b"version 2".to_vec();
        let metadata = storage
            .put("test/secret".to_string(), data2.clone(), "key-001".to_string())
            .unwrap();

        assert_eq!(metadata.version, 2);

        // Get current version
        let entry = storage.get("test/secret").unwrap();
        assert_eq!(entry.encrypted_data, data2);

        // Get old version
        let old_data = entry.get_version(1).unwrap();
        assert_eq!(old_data, data1);
    }

    #[test]
    fn test_storage_delete() {
        let storage = VaultStorage::new(StorageConfig::default());

        storage
            .put(
                "test/secret".to_string(),
                b"data".to_vec(),
                "key-001".to_string(),
            )
            .unwrap();

        assert!(storage.exists("test/secret"));

        storage.delete("test/secret").unwrap();

        assert!(!storage.exists("test/secret"));
    }

    #[test]
    fn test_storage_list() {
        let storage = VaultStorage::new(StorageConfig::default());

        storage
            .put(
                "test/secret1".to_string(),
                b"data1".to_vec(),
                "key-001".to_string(),
            )
            .unwrap();
        storage
            .put(
                "test/secret2".to_string(),
                b"data2".to_vec(),
                "key-002".to_string(),
            )
            .unwrap();
        storage
            .put(
                "prod/secret3".to_string(),
                b"data3".to_vec(),
                "key-003".to_string(),
            )
            .unwrap();

        let all = storage.list().unwrap();
        assert_eq!(all.len(), 3);

        let test_secrets = storage.list_prefix("test/").unwrap();
        assert_eq!(test_secrets.len(), 2);
    }

    #[test]
    fn test_storage_size_limit() {
        let config = StorageConfig {
            max_secret_size: 100,
            ..Default::default()
        };
        let storage = VaultStorage::new(config);

        let large_data = vec![0u8; 200];
        let result = storage.put("test/large".to_string(), large_data, "key-001".to_string());

        assert!(result.is_err());
    }

    #[test]
    fn test_storage_cleanup_expired() {
        let config = StorageConfig {
            default_ttl: Some(Duration::from_secs(0)),
            ..Default::default()
        };
        let storage = VaultStorage::new(config);

        storage
            .put(
                "test/secret1".to_string(),
                b"data".to_vec(),
                "key-001".to_string(),
            )
            .unwrap();

        std::thread::sleep(Duration::from_millis(10));

        let cleaned = storage.cleanup_expired().unwrap();
        assert_eq!(cleaned, 1);

        assert!(!storage.exists("test/secret1"));
    }

    #[test]
    fn test_storage_stats() {
        let storage = VaultStorage::new(StorageConfig::default());

        storage
            .put(
                "test/secret1".to_string(),
                b"data1".to_vec(),
                "key-001".to_string(),
            )
            .unwrap();
        storage
            .put(
                "test/secret2".to_string(),
                b"data2".to_vec(),
                "key-002".to_string(),
            )
            .unwrap();

        let stats = storage.stats();
        assert_eq!(stats.active_secrets, 2);
        assert!(stats.total_size > 0);
    }

    #[test]
    fn test_version_limit() {
        let config = StorageConfig {
            max_versions: 2,
            ..Default::default()
        };
        let storage = VaultStorage::new(config);

        // Create secret with multiple updates
        for i in 1..=5 {
            let data = format!("version {}", i).into_bytes();
            storage
                .put("test/secret".to_string(), data, "key-001".to_string())
                .unwrap();
        }

        let entry = storage.get("test/secret").unwrap();
        assert_eq!(entry.metadata.version, 5);
        assert_eq!(entry.versions.len(), 2); // Only keep last 2 versions
    }
}
