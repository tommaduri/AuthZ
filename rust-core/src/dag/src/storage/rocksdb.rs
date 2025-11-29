//! RocksDB Storage Layer for Phase 6
//!
//! Production-grade persistent storage with:
//! - 6 column families for efficient indexing
//! - BLAKE3 hash-based vertex storage
//! - Atomic batch operations
//! - Finalization tracking
//! - Height and timestamp indices
//! - <10ms p99 write latency

use crate::error::{DagError, Result};
use crate::vertex::{Vertex, VertexHash, VertexId, VertexMetadata};
use rocksdb::{
    ColumnFamily, ColumnFamilyDescriptor, DBCompressionType, IteratorMode, Options, WriteBatch,
    WriteOptions, DB,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

/// Column family names
pub const CF_VERTICES: &str = "vertices";
pub const CF_EDGES: &str = "edges";
pub const CF_METADATA: &str = "metadata";
pub const CF_INDEX_HEIGHT: &str = "index_height";
pub const CF_INDEX_TIMESTAMP: &str = "index_timestamp";
pub const CF_FINALIZED: &str = "finalized";

/// Storage configuration optimized for performance
#[derive(Debug, Clone)]
pub struct RocksDbConfig {
    /// Database path
    pub path: PathBuf,

    /// Write buffer size (128MB default)
    pub write_buffer_size: usize,

    /// Max open files (2000 default)
    pub max_open_files: i32,

    /// Cache size (512MB default)
    pub cache_size: usize,

    /// Enable write-ahead log
    pub enable_wal: bool,

    /// Enable statistics
    pub enable_statistics: bool,

    /// Compaction style
    pub compaction_style: CompactionStyle,
}

#[derive(Debug, Clone)]
pub enum CompactionStyle {
    Level,
    Universal,
    Fifo,
}

impl Default for RocksDbConfig {
    fn default() -> Self {
        Self {
            path: PathBuf::from("./data/dag"),
            write_buffer_size: 128 * 1024 * 1024, // 128MB
            max_open_files: 2000,
            cache_size: 512 * 1024 * 1024, // 512MB
            enable_wal: true,
            enable_statistics: true,
            compaction_style: CompactionStyle::Level,
        }
    }
}

/// Edge metadata for parent-child relationships
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdgeMetadata {
    pub parent_hash: VertexHash,
    pub child_hash: VertexHash,
    pub timestamp: u64,
}

/// Extended vertex metadata for storage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageVertexMetadata {
    pub hash: VertexHash,
    pub height: u64,
    pub timestamp: u64,
    pub signature: Vec<u8>,
    pub finalized: bool,
    pub sequence: Option<u64>,
    pub finalized_at: Option<u64>,
}

/// RocksDB storage implementation
pub struct RocksDbStorage {
    db: Arc<DB>,
    config: RocksDbConfig,
    metrics: StorageMetrics,
}

/// Storage metrics for Prometheus
#[derive(Debug, Clone, Default)]
pub struct StorageMetrics {
    pub vertices_stored: u64,
    pub vertices_read: u64,
    pub vertices_finalized: u64,
    pub write_latency_ms: f64,
    pub read_latency_ms: f64,
    pub db_size_bytes: u64,
    pub cache_hits: u64,
    pub cache_misses: u64,
}

impl RocksDbStorage {
    /// Open or create a new RocksDB storage instance
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let config = RocksDbConfig {
            path: path.as_ref().to_path_buf(),
            ..Default::default()
        };
        Self::open_with_config(config)
    }

    /// Open with custom configuration
    pub fn open_with_config(config: RocksDbConfig) -> Result<Self> {
        let mut opts = Options::default();
        opts.create_if_missing(true);
        opts.create_missing_column_families(true);
        opts.set_write_buffer_size(config.write_buffer_size);
        opts.set_max_open_files(config.max_open_files);

        // Set compression
        opts.set_compression_type(DBCompressionType::Lz4);
        opts.set_bottommost_compression_type(DBCompressionType::Zstd);

        // Enable statistics
        if config.enable_statistics {
            opts.enable_statistics();
        }

        // Set compaction style
        match config.compaction_style {
            CompactionStyle::Level => opts.set_compaction_style(rocksdb::DBCompactionStyle::Level),
            CompactionStyle::Universal => opts.set_compaction_style(rocksdb::DBCompactionStyle::Universal),
            CompactionStyle::Fifo => opts.set_compaction_style(rocksdb::DBCompactionStyle::Fifo),
        }

        // Write-ahead log configuration
        if config.enable_wal {
            opts.set_max_total_wal_size(1024 * 1024 * 1024); // 1GB
        }

        // Optimize for writes
        opts.set_max_background_jobs(4);
        opts.set_level_compaction_dynamic_level_bytes(true);

        // Create column family descriptors
        let cf_descriptors = vec![
            ColumnFamilyDescriptor::new(CF_VERTICES, opts.clone()),
            ColumnFamilyDescriptor::new(CF_EDGES, opts.clone()),
            ColumnFamilyDescriptor::new(CF_METADATA, opts.clone()),
            ColumnFamilyDescriptor::new(CF_INDEX_HEIGHT, opts.clone()),
            ColumnFamilyDescriptor::new(CF_INDEX_TIMESTAMP, opts.clone()),
            ColumnFamilyDescriptor::new(CF_FINALIZED, opts.clone()),
        ];

        // Open database
        let db = DB::open_cf_descriptors(&opts, &config.path, cf_descriptors)
            .map_err(|e| DagError::Storage(format!("Failed to open RocksDB: {}", e)))?;

        Ok(Self {
            db: Arc::new(db),
            config,
            metrics: StorageMetrics::default(),
        })
    }

    /// Get column family handle
    fn cf_handle(&self, name: &str) -> Result<&ColumnFamily> {
        self.db
            .cf_handle(name)
            .ok_or_else(|| DagError::Storage(format!("Column family not found: {}", name)))
    }

    /// Store a vertex with BLAKE3 hash
    pub fn store_vertex(&mut self, vertex: &Vertex, signature: &[u8]) -> Result<()> {
        let start = Instant::now();

        let cf_vertices = self.cf_handle(CF_VERTICES)?;
        let cf_metadata = self.cf_handle(CF_METADATA)?;
        let cf_index_height = self.cf_handle(CF_INDEX_HEIGHT)?;
        let cf_index_timestamp = self.cf_handle(CF_INDEX_TIMESTAMP)?;
        let cf_edges = self.cf_handle(CF_EDGES)?;

        // Create write batch for atomicity
        let mut batch = WriteBatch::default();

        // Serialize vertex
        let vertex_data = bincode::serialize(vertex)
            .map_err(|e| DagError::Storage(format!("Serialization error: {}", e)))?;

        // Store vertex by hash
        batch.put_cf(cf_vertices, &vertex.hash, &vertex_data);

        // Store metadata
        let metadata = StorageVertexMetadata {
            hash: vertex.hash,
            height: vertex.metadata.round, // Using round as height
            timestamp: vertex.timestamp,
            signature: signature.to_vec(),
            finalized: vertex.metadata.finalized,
            sequence: None,
            finalized_at: None,
        };
        let metadata_data = bincode::serialize(&metadata)
            .map_err(|e| DagError::Storage(format!("Serialization error: {}", e)))?;
        batch.put_cf(cf_metadata, &vertex.hash, &metadata_data);

        // Update height index
        let height_key = metadata.height.to_le_bytes();
        let mut height_vertices = self.get_vertices_at_height(metadata.height)?;
        height_vertices.push(vertex.hash);
        let height_data = bincode::serialize(&height_vertices)
            .map_err(|e| DagError::Storage(format!("Serialization error: {}", e)))?;
        batch.put_cf(cf_index_height, &height_key, &height_data);

        // Update timestamp index
        let ts_key = vertex.timestamp.to_le_bytes();
        batch.put_cf(cf_index_timestamp, &ts_key, &vertex.hash);

        // Store edges (parent-child relationships)
        for parent_id in &vertex.parents {
            // Convert parent ID to hash (simplified - in production would need proper lookup)
            let parent_hash = self.id_to_hash(parent_id)?;
            let edge = EdgeMetadata {
                parent_hash,
                child_hash: vertex.hash,
                timestamp: vertex.timestamp,
            };
            let edge_key = [parent_hash.as_slice(), vertex.hash.as_slice()].concat();
            let edge_data = bincode::serialize(&edge)
                .map_err(|e| DagError::Storage(format!("Serialization error: {}", e)))?;
            batch.put_cf(cf_edges, &edge_key, &edge_data);
        }

        // Write batch atomically
        let mut write_opts = WriteOptions::default();
        write_opts.set_sync(self.config.enable_wal);

        self.db
            .write_opt(batch, &write_opts)
            .map_err(|e| DagError::Storage(format!("Write error: {}", e)))?;

        // Update metrics
        self.metrics.vertices_stored += 1;
        self.metrics.write_latency_ms = start.elapsed().as_millis() as f64;

        Ok(())
    }

    /// Get a vertex by hash
    pub fn get_vertex(&mut self, hash: &VertexHash) -> Result<Option<Vertex>> {
        let start = Instant::now();

        let cf = self.cf_handle(CF_VERTICES)?;

        let result = self.db
            .get_cf(cf, hash)
            .map_err(|e| DagError::Storage(format!("Read error: {}", e)))?;

        let vertex = match result {
            Some(data) => {
                let vertex: Vertex = bincode::deserialize(&data)
                    .map_err(|e| DagError::Storage(format!("Deserialization error: {}", e)))?;
                self.metrics.cache_hits += 1;
                Some(vertex)
            }
            None => {
                self.metrics.cache_misses += 1;
                None
            }
        };

        self.metrics.vertices_read += 1;
        self.metrics.read_latency_ms = start.elapsed().as_millis() as f64;

        Ok(vertex)
    }

    /// Mark a vertex as finalized
    pub fn mark_finalized(&mut self, hash: &VertexHash, sequence: u64) -> Result<()> {
        let cf_metadata = self.cf_handle(CF_METADATA)?;
        let cf_finalized = self.cf_handle(CF_FINALIZED)?;

        // Get existing metadata
        let metadata_data = self.db
            .get_cf(cf_metadata, hash)
            .map_err(|e| DagError::Storage(format!("Read error: {}", e)))?
            .ok_or_else(|| DagError::Storage("Vertex metadata not found".to_string()))?;

        let mut metadata: StorageVertexMetadata = bincode::deserialize(&metadata_data)
            .map_err(|e| DagError::Storage(format!("Deserialization error: {}", e)))?;

        // Update finalization status
        metadata.finalized = true;
        metadata.sequence = Some(sequence);
        metadata.finalized_at = Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        );

        // Create write batch
        let mut batch = WriteBatch::default();

        // Update metadata
        let metadata_data = bincode::serialize(&metadata)
            .map_err(|e| DagError::Storage(format!("Serialization error: {}", e)))?;
        batch.put_cf(cf_metadata, hash, &metadata_data);

        // Add to finalized index
        let seq_key = sequence.to_le_bytes();
        batch.put_cf(cf_finalized, &seq_key, hash);

        // Write batch
        self.db
            .write(batch)
            .map_err(|e| DagError::Storage(format!("Write error: {}", e)))?;

        self.metrics.vertices_finalized += 1;

        Ok(())
    }

    /// Find DAG tips (vertices with no children)
    pub fn get_dag_tip(&self) -> Result<Vec<VertexHash>> {
        let cf_vertices = self.cf_handle(CF_VERTICES)?;
        let cf_edges = self.cf_handle(CF_EDGES)?;

        let mut tips = Vec::new();
        let iter = self.db.iterator_cf(cf_vertices, IteratorMode::Start);

        for item in iter {
            let (hash_bytes, _) = item
                .map_err(|e| DagError::Storage(format!("Iterator error: {}", e)))?;

            let mut hash = [0u8; 32];
            hash.copy_from_slice(&hash_bytes);

            // Check if this vertex has children
            let has_children = self.has_children(cf_edges, &hash)?;

            if !has_children {
                tips.push(hash);
            }
        }

        Ok(tips)
    }

    /// Get all vertices at a specific height
    pub fn get_vertices_at_height(&self, height: u64) -> Result<Vec<VertexHash>> {
        let cf = self.cf_handle(CF_INDEX_HEIGHT)?;
        let key = height.to_le_bytes();

        match self.db.get_cf(cf, &key) {
            Ok(Some(data)) => {
                let hashes: Vec<VertexHash> = bincode::deserialize(&data)
                    .map_err(|e| DagError::Storage(format!("Deserialization error: {}", e)))?;
                Ok(hashes)
            }
            Ok(None) => Ok(Vec::new()),
            Err(e) => Err(DagError::Storage(format!("Read error: {}", e))),
        }
    }

    /// Get all finalized vertices
    pub fn get_finalized_vertices(&self) -> Result<Vec<(u64, VertexHash)>> {
        let cf = self.cf_handle(CF_FINALIZED)?;
        let mut finalized = Vec::new();

        let iter = self.db.iterator_cf(cf, IteratorMode::Start);
        for item in iter {
            let (seq_bytes, hash_bytes) = item
                .map_err(|e| DagError::Storage(format!("Iterator error: {}", e)))?;

            let sequence = u64::from_le_bytes(seq_bytes.as_ref().try_into().unwrap());
            let mut hash = [0u8; 32];
            hash.copy_from_slice(&hash_bytes);

            finalized.push((sequence, hash));
        }

        Ok(finalized)
    }

    /// Check if a vertex has children
    fn has_children(&self, cf_edges: &ColumnFamily, parent_hash: &VertexHash) -> Result<bool> {
        let iter = self.db.iterator_cf(cf_edges, IteratorMode::Start);

        for item in iter {
            let (key, _) = item
                .map_err(|e| DagError::Storage(format!("Iterator error: {}", e)))?;

            if key.len() >= 32 && &key[0..32] == parent_hash {
                return Ok(true);
            }
        }

        Ok(false)
    }

    /// Convert vertex ID to hash (helper method)
    fn id_to_hash(&self, id: &VertexId) -> Result<VertexHash> {
        // In production, maintain a separate ID->Hash index
        // For now, use BLAKE3 hash of the ID
        use blake3::Hasher;
        let mut hasher = Hasher::new();
        hasher.update(id.as_bytes());
        Ok(*hasher.finalize().as_bytes())
    }

    /// Get storage metrics
    pub fn get_metrics(&self) -> &StorageMetrics {
        &self.metrics
    }

    /// Compact the database
    pub fn compact(&self) -> Result<()> {
        self.db.compact_range::<&[u8], &[u8]>(None, None);
        Ok(())
    }

    /// Flush pending writes
    pub fn flush(&self) -> Result<()> {
        self.db
            .flush()
            .map_err(|e| DagError::Storage(format!("Flush error: {}", e)))
    }

    /// Get database statistics
    pub fn get_db_stats(&self) -> Result<String> {
        self.db
            .property_value("rocksdb.stats")
            .map_err(|e| DagError::Storage(format!("Stats error: {}", e)))
            .map(|s| s.unwrap_or_else(|| "No stats available".to_string()))
    }

    /// Get approximate database size
    pub fn get_db_size(&self) -> Result<u64> {
        let mut total_size = 0u64;

        for cf_name in &[CF_VERTICES, CF_EDGES, CF_METADATA, CF_INDEX_HEIGHT, CF_INDEX_TIMESTAMP, CF_FINALIZED] {
            let cf = self.cf_handle(cf_name)?;
            if let Ok(Some(size_str)) = self.db.property_value_cf(cf, "rocksdb.total-sst-files-size") {
                if let Ok(size) = size_str.parse::<u64>() {
                    total_size += size;
                }
            }
        }

        Ok(total_size)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vertex::VertexBuilder;
    use tempfile::TempDir;

    fn create_test_storage() -> (RocksDbStorage, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let storage = RocksDbStorage::open(temp_dir.path()).unwrap();
        (storage, temp_dir)
    }

    #[test]
    fn test_storage_creation() {
        let (_storage, _temp_dir) = create_test_storage();
        // If we got here, storage was created successfully
    }

    #[test]
    fn test_store_and_retrieve_vertex() {
        let (mut storage, _temp_dir) = create_test_storage();

        let vertex = VertexBuilder::new("agent-001".to_string())
            .id("test-vertex".to_string())
            .payload(vec![1, 2, 3, 4])
            .build();

        let signature = vec![0u8; 32];

        storage.store_vertex(&vertex, &signature).unwrap();

        let retrieved = storage.get_vertex(&vertex.hash).unwrap();
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().id, "test-vertex");
    }

    #[test]
    fn test_mark_finalized() {
        let (mut storage, _temp_dir) = create_test_storage();

        let vertex = VertexBuilder::new("agent-001".to_string())
            .id("test".to_string())
            .build();

        let signature = vec![0u8; 32];
        storage.store_vertex(&vertex, &signature).unwrap();

        storage.mark_finalized(&vertex.hash, 1).unwrap();

        let finalized = storage.get_finalized_vertices().unwrap();
        assert_eq!(finalized.len(), 1);
        assert_eq!(finalized[0].0, 1);
    }

    #[test]
    fn test_height_index() {
        let (mut storage, _temp_dir) = create_test_storage();

        let vertex = VertexBuilder::new("agent-001".to_string())
            .id("test".to_string())
            .build();

        let signature = vec![0u8; 32];
        storage.store_vertex(&vertex, &signature).unwrap();

        let vertices = storage.get_vertices_at_height(0).unwrap();
        assert!(!vertices.is_empty());
    }

    #[test]
    fn test_get_dag_tip() {
        let (mut storage, _temp_dir) = create_test_storage();

        let vertex = VertexBuilder::new("agent-001".to_string())
            .id("tip".to_string())
            .build();

        let signature = vec![0u8; 32];
        storage.store_vertex(&vertex, &signature).unwrap();

        let tips = storage.get_dag_tip().unwrap();
        assert!(!tips.is_empty());
    }
}
