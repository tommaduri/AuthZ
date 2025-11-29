//! Storage module for persistent DAG data
//!
//! Phase 6 enhancements:
//! - RocksDB with 6 column families
//! - BLAKE3 hash-based storage
//! - Backup and restore functionality
//! - Cloud storage integration
//! - Prometheus metrics

pub mod rocksdb;
pub mod backup;
pub mod metrics;

pub use self::rocksdb::{
    RocksDbStorage, RocksDbConfig, StorageMetrics, EdgeMetadata, StorageVertexMetadata,
    CompactionStyle,
};
pub use backup::{BackupManager, BackupId, BackupMetadata, CloudStorageConfig, CloudProvider};
pub use metrics::{PrometheusMetrics, LatencyHistogram};

// Re-export Phase 5 storage for backwards compatibility
mod legacy;
pub use legacy::{Storage, StorageConfig, StorageStats};
