//! Persistent Storage Backend
//!
//! Provides durable storage for DAG vertices using RocksDB with support for:
//! - Atomic vertex operations
//! - Batch writes for performance
//! - Snapshot consistency
//! - Efficient key-value lookups
//! - Column family isolation

use crate::error::{DagError, Result};
use crate::vertex::{Vertex, VertexId};
use rocksdb::{DB, Options, WriteBatch, ColumnFamily, IteratorMode};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

/// Column family names for different data types
const CF_VERTICES: &str = "vertices";
const CF_METADATA: &str = "metadata";
const CF_INDICES: &str = "indices";

/// Storage configuration
#[derive(Debug, Clone)]
pub struct StorageConfig {
    /// Database path
    pub path: PathBuf,

    /// Create if missing
    pub create_if_missing: bool,

    /// Enable compression
    pub enable_compression: bool,

    /// Write buffer size (bytes)
    pub write_buffer_size: usize,

    /// Max open files
    pub max_open_files: i32,

    /// Enable statistics
    pub enable_statistics: bool,
}

impl Default for StorageConfig {
    fn default() -> Self {
        StorageConfig {
            path: PathBuf::from("./data/dag"),
            create_if_missing: true,
            enable_compression: true,
            write_buffer_size: 64 * 1024 * 1024, // 64 MB
            max_open_files: 1000,
            enable_statistics: false,
        }
    }
}

/// Persistent storage backend using RocksDB
pub struct Storage {
    /// RocksDB instance
    db: Arc<DB>,

    /// Storage configuration
    config: StorageConfig,

    /// In-memory cache for frequently accessed vertices
    cache: Arc<RwLock<HashMap<VertexId, Vertex>>>,

    /// Cache size limit
    cache_size_limit: usize,
}

impl Storage {
    /// Open or create a storage backend
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let config = StorageConfig {
            path: path.as_ref().to_path_buf(),
            ..Default::default()
        };
        Self::open_with_config(config)
    }

    /// Open with custom configuration
    pub fn open_with_config(config: StorageConfig) -> Result<Self> {
        let mut opts = Options::default();
        opts.create_if_missing(config.create_if_missing);
        opts.create_missing_column_families(true);
        opts.set_write_buffer_size(config.write_buffer_size);
        opts.set_max_open_files(config.max_open_files);

        if config.enable_compression {
            opts.set_compression_type(rocksdb::DBCompressionType::Lz4);
        }

        if config.enable_statistics {
            opts.enable_statistics();
        }

        // Define column families
        let cf_names = vec![CF_VERTICES, CF_METADATA, CF_INDICES];

        let db = DB::open_cf(&opts, &config.path, &cf_names)
            .map_err(|e| DagError::Storage(format!("Failed to open database: {}", e)))?;

        Ok(Storage {
            db: Arc::new(db),
            config,
            cache: Arc::new(RwLock::new(HashMap::new())),
            cache_size_limit: 10000, // Cache up to 10k vertices
        })
    }

    /// Get column family handle
    fn cf_handle(&self, name: &str) -> Result<&ColumnFamily> {
        self.db.cf_handle(name)
            .ok_or_else(|| DagError::Storage(format!("Column family not found: {}", name)))
    }

    /// Store a vertex
    pub fn put_vertex(&self, vertex: &Vertex) -> Result<()> {
        let cf = self.cf_handle(CF_VERTICES)?;

        let key = vertex.id.as_bytes();
        let value = bincode::serialize(vertex)
            .map_err(|e| DagError::Storage(format!("Serialization error: {}", e)))?;

        self.db.put_cf(cf, key, value)
            .map_err(|e| DagError::Storage(format!("Write error: {}", e)))?;

        // Update cache
        self.update_cache(vertex.clone());

        Ok(())
    }

    /// Get a vertex by ID
    pub fn get_vertex(&self, vertex_id: &VertexId) -> Result<Vertex> {
        // Check cache first
        if let Some(vertex) = self.get_from_cache(vertex_id) {
            return Ok(vertex);
        }

        // Fetch from disk
        let cf = self.cf_handle(CF_VERTICES)?;
        let key = vertex_id.as_bytes();

        let value = self.db.get_cf(cf, key)
            .map_err(|e| DagError::Storage(format!("Read error: {}", e)))?
            .ok_or_else(|| DagError::InvalidVertex(format!("Vertex not found: {}", vertex_id)))?;

        let vertex: Vertex = bincode::deserialize(&value)
            .map_err(|e| DagError::Storage(format!("Deserialization error: {}", e)))?;

        // Update cache
        self.update_cache(vertex.clone());

        Ok(vertex)
    }

    /// Check if a vertex exists
    pub fn has_vertex(&self, vertex_id: &VertexId) -> Result<bool> {
        // Check cache first
        if self.cache_contains(vertex_id) {
            return Ok(true);
        }

        let cf = self.cf_handle(CF_VERTICES)?;
        let key = vertex_id.as_bytes();

        self.db.get_cf(cf, key)
            .map(|opt| opt.is_some())
            .map_err(|e| DagError::Storage(format!("Read error: {}", e)))
    }

    /// Delete a vertex
    pub fn delete_vertex(&self, vertex_id: &VertexId) -> Result<()> {
        let cf = self.cf_handle(CF_VERTICES)?;
        let key = vertex_id.as_bytes();

        self.db.delete_cf(cf, key)
            .map_err(|e| DagError::Storage(format!("Delete error: {}", e)))?;

        // Remove from cache
        self.remove_from_cache(vertex_id);

        Ok(())
    }

    /// Get all vertex IDs
    pub fn get_all_vertex_ids(&self) -> Result<Vec<VertexId>> {
        let cf = self.cf_handle(CF_VERTICES)?;
        let mut ids = Vec::new();

        let iter = self.db.iterator_cf(cf, IteratorMode::Start);
        for item in iter {
            let (key, _) = item.map_err(|e| DagError::Storage(format!("Iterator error: {}", e)))?;
            let id = String::from_utf8(key.to_vec())
                .map_err(|e| DagError::Storage(format!("UTF-8 error: {}", e)))?;
            ids.push(id);
        }

        Ok(ids)
    }

    /// Get all vertices
    pub fn get_all_vertices(&self) -> Result<Vec<Vertex>> {
        let cf = self.cf_handle(CF_VERTICES)?;
        let mut vertices = Vec::new();

        let iter = self.db.iterator_cf(cf, IteratorMode::Start);
        for item in iter {
            let (_, value) = item.map_err(|e| DagError::Storage(format!("Iterator error: {}", e)))?;
            let vertex: Vertex = bincode::deserialize(&value)
                .map_err(|e| DagError::Storage(format!("Deserialization error: {}", e)))?;
            vertices.push(vertex);
        }

        Ok(vertices)
    }

    /// Batch write multiple vertices
    pub fn put_batch(&self, vertices: &[Vertex]) -> Result<()> {
        let cf = self.cf_handle(CF_VERTICES)?;
        let mut batch = WriteBatch::default();

        for vertex in vertices {
            let key = vertex.id.as_bytes();
            let value = bincode::serialize(vertex)
                .map_err(|e| DagError::Storage(format!("Serialization error: {}", e)))?;
            batch.put_cf(cf, key, value);
        }

        self.db.write(batch)
            .map_err(|e| DagError::Storage(format!("Batch write error: {}", e)))?;

        // Update cache for all vertices
        for vertex in vertices {
            self.update_cache(vertex.clone());
        }

        Ok(())
    }

    /// Batch delete multiple vertices
    pub fn delete_batch(&self, vertex_ids: &[VertexId]) -> Result<()> {
        let cf = self.cf_handle(CF_VERTICES)?;
        let mut batch = WriteBatch::default();

        for vertex_id in vertex_ids {
            let key = vertex_id.as_bytes();
            batch.delete_cf(cf, key);
        }

        self.db.write(batch)
            .map_err(|e| DagError::Storage(format!("Batch delete error: {}", e)))?;

        // Remove from cache
        for vertex_id in vertex_ids {
            self.remove_from_cache(vertex_id);
        }

        Ok(())
    }

    /// Get vertex count
    pub fn vertex_count(&self) -> Result<usize> {
        let cf = self.cf_handle(CF_VERTICES)?;
        let mut count = 0;

        let iter = self.db.iterator_cf(cf, IteratorMode::Start);
        for _ in iter {
            count += 1;
        }

        Ok(count)
    }

    /// Compact the database
    pub fn compact(&self) -> Result<()> {
        self.db.compact_range::<&[u8], &[u8]>(None, None);
        Ok(())
    }

    /// Flush pending writes to disk
    pub fn flush(&self) -> Result<()> {
        self.db.flush()
            .map_err(|e| DagError::Storage(format!("Flush error: {}", e)))
    }

    /// Get storage statistics
    pub fn get_stats(&self) -> Result<StorageStats> {
        let vertex_count = self.vertex_count()?;
        let cache_size = self.cache.read()
            .map(|c| c.len())
            .unwrap_or(0);

        Ok(StorageStats {
            vertex_count,
            cache_size,
            cache_hit_rate: 0.0, // TODO: Track cache hits/misses
        })
    }

    /// Clear all data (dangerous!)
    pub fn clear(&self) -> Result<()> {
        let vertex_ids = self.get_all_vertex_ids()?;
        self.delete_batch(&vertex_ids)?;

        // Clear cache
        if let Ok(mut cache) = self.cache.write() {
            cache.clear();
        }

        Ok(())
    }

    // Cache management methods

    fn get_from_cache(&self, vertex_id: &VertexId) -> Option<Vertex> {
        self.cache.read().ok()
            .and_then(|cache| cache.get(vertex_id).cloned())
    }

    fn cache_contains(&self, vertex_id: &VertexId) -> bool {
        self.cache.read()
            .map(|cache| cache.contains_key(vertex_id))
            .unwrap_or(false)
    }

    fn update_cache(&self, vertex: Vertex) {
        if let Ok(mut cache) = self.cache.write() {
            // Simple LRU: remove oldest if cache is full
            if cache.len() >= self.cache_size_limit && !cache.contains_key(&vertex.id) {
                if let Some(first_key) = cache.keys().next().cloned() {
                    cache.remove(&first_key);
                }
            }
            cache.insert(vertex.id.clone(), vertex);
        }
    }

    fn remove_from_cache(&self, vertex_id: &VertexId) {
        if let Ok(mut cache) = self.cache.write() {
            cache.remove(vertex_id);
        }
    }

    /// Clear the cache
    pub fn clear_cache(&self) {
        if let Ok(mut cache) = self.cache.write() {
            cache.clear();
        }
    }
}

/// Storage statistics
#[derive(Debug, Clone)]
pub struct StorageStats {
    pub vertex_count: usize,
    pub cache_size: usize,
    pub cache_hit_rate: f64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vertex::VertexBuilder;
    use tempfile::TempDir;

    fn create_test_storage() -> (Storage, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let storage = Storage::open(temp_dir.path()).unwrap();
        (storage, temp_dir)
    }

    #[test]
    fn test_storage_creation() {
        let (storage, _temp_dir) = create_test_storage();
        let stats = storage.get_stats().unwrap();
        assert_eq!(stats.vertex_count, 0);
    }

    #[test]
    fn test_put_and_get_vertex() {
        let (storage, _temp_dir) = create_test_storage();

        let vertex = VertexBuilder::new("agent-001".to_string())
            .id("test-vertex".to_string())
            .payload(vec![1, 2, 3])
            .build();

        storage.put_vertex(&vertex).unwrap();

        let retrieved = storage.get_vertex(&"test-vertex".to_string()).unwrap();
        assert_eq!(retrieved.id, "test-vertex");
        assert_eq!(retrieved.payload, vec![1, 2, 3]);
    }

    #[test]
    fn test_has_vertex() {
        let (storage, _temp_dir) = create_test_storage();

        let vertex = VertexBuilder::new("agent-001".to_string())
            .id("test".to_string())
            .build();

        assert!(!storage.has_vertex(&"test".to_string()).unwrap());
        storage.put_vertex(&vertex).unwrap();
        assert!(storage.has_vertex(&"test".to_string()).unwrap());
    }

    #[test]
    fn test_delete_vertex() {
        let (storage, _temp_dir) = create_test_storage();

        let vertex = VertexBuilder::new("agent-001".to_string())
            .id("test".to_string())
            .build();

        storage.put_vertex(&vertex).unwrap();
        assert!(storage.has_vertex(&"test".to_string()).unwrap());

        storage.delete_vertex(&"test".to_string()).unwrap();
        assert!(!storage.has_vertex(&"test".to_string()).unwrap());
    }

    #[test]
    fn test_get_all_vertices() {
        let (storage, _temp_dir) = create_test_storage();

        let v1 = VertexBuilder::new("agent-001".to_string())
            .id("v1".to_string())
            .build();
        let v2 = VertexBuilder::new("agent-001".to_string())
            .id("v2".to_string())
            .build();

        storage.put_vertex(&v1).unwrap();
        storage.put_vertex(&v2).unwrap();

        let all = storage.get_all_vertices().unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn test_batch_operations() {
        let (storage, _temp_dir) = create_test_storage();

        let vertices = vec![
            VertexBuilder::new("agent-001".to_string()).id("v1".to_string()).build(),
            VertexBuilder::new("agent-001".to_string()).id("v2".to_string()).build(),
            VertexBuilder::new("agent-001".to_string()).id("v3".to_string()).build(),
        ];

        storage.put_batch(&vertices).unwrap();
        assert_eq!(storage.vertex_count().unwrap(), 3);

        let ids = vec!["v1".to_string(), "v2".to_string()];
        storage.delete_batch(&ids).unwrap();
        assert_eq!(storage.vertex_count().unwrap(), 1);
    }

    #[test]
    fn test_vertex_count() {
        let (storage, _temp_dir) = create_test_storage();

        assert_eq!(storage.vertex_count().unwrap(), 0);

        let vertex = VertexBuilder::new("agent-001".to_string())
            .id("test".to_string())
            .build();
        storage.put_vertex(&vertex).unwrap();

        assert_eq!(storage.vertex_count().unwrap(), 1);
    }

    #[test]
    fn test_cache() {
        let (storage, _temp_dir) = create_test_storage();

        let vertex = VertexBuilder::new("agent-001".to_string())
            .id("cached".to_string())
            .build();

        storage.put_vertex(&vertex).unwrap();

        // Should be in cache now
        assert!(storage.cache_contains(&"cached".to_string()));

        // Clear cache
        storage.clear_cache();
        assert!(!storage.cache_contains(&"cached".to_string()));

        // Should still be retrievable from disk
        let retrieved = storage.get_vertex(&"cached".to_string()).unwrap();
        assert_eq!(retrieved.id, "cached");

        // Should be back in cache
        assert!(storage.cache_contains(&"cached".to_string()));
    }

    #[test]
    fn test_clear() {
        let (storage, _temp_dir) = create_test_storage();

        let vertex = VertexBuilder::new("agent-001".to_string())
            .id("test".to_string())
            .build();
        storage.put_vertex(&vertex).unwrap();

        assert_eq!(storage.vertex_count().unwrap(), 1);

        storage.clear().unwrap();
        assert_eq!(storage.vertex_count().unwrap(), 0);
    }

    #[test]
    fn test_persistence() {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path();

        // Create storage and add vertex
        {
            let storage = Storage::open(path).unwrap();
            let vertex = VertexBuilder::new("agent-001".to_string())
                .id("persistent".to_string())
                .build();
            storage.put_vertex(&vertex).unwrap();
            storage.flush().unwrap();
        }

        // Reopen storage and verify vertex persisted
        {
            let storage = Storage::open(path).unwrap();
            let vertex = storage.get_vertex(&"persistent".to_string()).unwrap();
            assert_eq!(vertex.id, "persistent");
        }
    }
}
