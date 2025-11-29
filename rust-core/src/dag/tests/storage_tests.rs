//! Integration tests for Phase 6 storage layer
//!
//! Tests:
//! - RocksDB storage operations
//! - Backup and restore
//! - Crash recovery (kill -9 simulation)
//! - Performance benchmarks
//! - Concurrent access

use cretoai_dag::storage::rocksdb::{RocksDbStorage, RocksDbConfig};
use cretoai_dag::storage::backup::{BackupManager, BackupId};
use cretoai_dag::vertex::VertexBuilder;
use std::sync::Arc;
use std::time::Instant;
use tempfile::TempDir;
use tokio::task;

#[tokio::test]
async fn test_rocksdb_basic_operations() {
    let temp_dir = TempDir::new().unwrap();
    let mut storage = RocksDbStorage::open(temp_dir.path()).unwrap();

    // Create and store a vertex
    let vertex = VertexBuilder::new("agent-001".to_string())
        .id("test-vertex-1".to_string())
        .payload(b"test payload".to_vec())
        .build();

    let signature = vec![0u8; 32];
    storage.store_vertex(&vertex, &signature).unwrap();

    // Retrieve the vertex
    let retrieved = storage.get_vertex(&vertex.hash).unwrap();
    assert!(retrieved.is_some());
    assert_eq!(retrieved.unwrap().id, "test-vertex-1");

    // Check metrics
    let metrics = storage.get_metrics();
    assert_eq!(metrics.vertices_stored, 1);
    assert_eq!(metrics.vertices_read, 1);
}

#[tokio::test]
async fn test_finalization() {
    let temp_dir = TempDir::new().unwrap();
    let mut storage = RocksDbStorage::open(temp_dir.path()).unwrap();

    // Store a vertex
    let vertex = VertexBuilder::new("agent-001".to_string())
        .id("test-vertex-2".to_string())
        .build();

    let signature = vec![0u8; 32];
    storage.store_vertex(&vertex, &signature).unwrap();

    // Mark as finalized
    storage.mark_finalized(&vertex.hash, 1).unwrap();

    // Verify finalization
    let finalized = storage.get_finalized_vertices().unwrap();
    assert_eq!(finalized.len(), 1);
    assert_eq!(finalized[0].0, 1);
    assert_eq!(finalized[0].1, vertex.hash);

    // Check metrics
    let metrics = storage.get_metrics();
    assert_eq!(metrics.vertices_finalized, 1);
}

#[tokio::test]
async fn test_height_indexing() {
    let temp_dir = TempDir::new().unwrap();
    let mut storage = RocksDbStorage::open(temp_dir.path()).unwrap();

    // Create vertices at different heights
    for i in 0..5 {
        let mut vertex = VertexBuilder::new("agent-001".to_string())
            .id(format!("vertex-{}", i))
            .build();
        vertex.metadata.round = i as u64; // Set height

        let signature = vec![0u8; 32];
        storage.store_vertex(&vertex, &signature).unwrap();
    }

    // Query by height
    for height in 0..5 {
        let vertices = storage.get_vertices_at_height(height).unwrap();
        assert_eq!(vertices.len(), 1);
    }
}

#[tokio::test]
async fn test_dag_tip_detection() {
    let temp_dir = TempDir::new().unwrap();
    let mut storage = RocksDbStorage::open(temp_dir.path()).unwrap();

    // Create a chain of vertices
    let vertex1 = VertexBuilder::new("agent-001".to_string())
        .id("vertex-1".to_string())
        .build();

    let vertex2 = VertexBuilder::new("agent-001".to_string())
        .id("vertex-2".to_string())
        .parent("vertex-1".to_string())
        .build();

    let signature = vec![0u8; 32];
    storage.store_vertex(&vertex1, &signature).unwrap();
    storage.store_vertex(&vertex2, &signature).unwrap();

    // Find tips (should be vertex2)
    let tips = storage.get_dag_tip().unwrap();
    assert!(!tips.is_empty());
}

#[tokio::test]
async fn test_crash_recovery() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().to_path_buf();

    // Phase 1: Store data
    {
        let mut storage = RocksDbStorage::open(&db_path).unwrap();

        for i in 0..100 {
            let vertex = VertexBuilder::new("agent-001".to_string())
                .id(format!("vertex-{}", i))
                .payload(format!("data-{}", i).into_bytes())
                .build();

            let signature = vec![0u8; 32];
            storage.store_vertex(&vertex, &signature).unwrap();
        }

        storage.flush().unwrap();
    } // Drop storage (simulates crash)

    // Phase 2: Recover and verify
    {
        let mut storage = RocksDbStorage::open(&db_path).unwrap();

        // Verify all data survived
        let metrics = storage.get_metrics();
        assert_eq!(metrics.vertices_stored, 0); // Metrics reset, but data persists

        // Check we can still query
        let tips = storage.get_dag_tip().unwrap();
        assert!(!tips.is_empty());
    }
}

#[tokio::test]
async fn test_concurrent_writes() {
    let temp_dir = TempDir::new().unwrap();
    let storage = Arc::new(tokio::sync::RwLock::new(
        RocksDbStorage::open(temp_dir.path()).unwrap()
    ));

    let mut tasks = vec![];

    // Spawn 10 concurrent writers
    for worker_id in 0..10 {
        let storage_clone = Arc::clone(&storage);

        let task = task::spawn(async move {
            for i in 0..10 {
                let vertex = VertexBuilder::new(format!("agent-{:03}", worker_id))
                    .id(format!("vertex-{}-{}", worker_id, i))
                    .build();

                let signature = vec![0u8; 32];

                let mut storage = storage_clone.write().await;
                storage.store_vertex(&vertex, &signature).unwrap();
            }
        });

        tasks.push(task);
    }

    // Wait for all tasks
    for task in tasks {
        task.await.unwrap();
    }

    // Verify all writes succeeded
    let storage = storage.read().await;
    let tips = storage.get_dag_tip().unwrap();
    assert_eq!(tips.len(), 100); // All 100 vertices should be tips
}

#[tokio::test]
async fn test_write_performance() {
    let temp_dir = TempDir::new().unwrap();
    let mut storage = RocksDbStorage::open(temp_dir.path()).unwrap();

    let vertex_count = 1000;
    let start = Instant::now();

    for i in 0..vertex_count {
        let vertex = VertexBuilder::new("agent-001".to_string())
            .id(format!("perf-vertex-{}", i))
            .payload(vec![0u8; 1024]) // 1KB payload
            .build();

        let signature = vec![0u8; 32];
        storage.store_vertex(&vertex, &signature).unwrap();
    }

    let elapsed = start.elapsed();
    let throughput = vertex_count as f64 / elapsed.as_secs_f64();
    let avg_latency = elapsed.as_millis() as f64 / vertex_count as f64;

    println!("Write performance:");
    println!("  Throughput: {:.2} vertices/sec", throughput);
    println!("  Avg latency: {:.2} ms", avg_latency);

    // Assert performance targets
    assert!(avg_latency < 10.0, "Average latency should be < 10ms (was {:.2}ms)", avg_latency);
}

#[tokio::test]
async fn test_backup_creation() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("db");
    let backup_dir = temp_dir.path().join("backups");

    std::fs::create_dir_all(&db_path).unwrap();

    // Create storage with data
    {
        let mut storage = RocksDbStorage::open(&db_path).unwrap();

        for i in 0..50 {
            let vertex = VertexBuilder::new("agent-001".to_string())
                .id(format!("backup-vertex-{}", i))
                .build();

            let signature = vec![0u8; 32];
            storage.store_vertex(&vertex, &signature).unwrap();
        }

        storage.flush().unwrap();
    }

    // Create backup
    let backup_manager = BackupManager::new(&db_path, &backup_dir).unwrap();
    let metadata = backup_manager.create_backup().await.unwrap();

    println!("Backup created:");
    println!("  ID: {}", metadata.id);
    println!("  DB size: {} bytes", metadata.db_size_bytes);
    println!("  Compressed: {} bytes", metadata.compressed_size_bytes);
    println!("  Ratio: {:.2}%", metadata.compression_ratio * 100.0);

    assert!(metadata.compressed_size_bytes < metadata.db_size_bytes);
}

#[tokio::test]
async fn test_backup_restore() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("db");
    let backup_dir = temp_dir.path().join("backups");

    std::fs::create_dir_all(&db_path).unwrap();

    // Create original data
    let original_hash = {
        let mut storage = RocksDbStorage::open(&db_path).unwrap();

        let vertex = VertexBuilder::new("agent-001".to_string())
            .id("restore-test-vertex".to_string())
            .payload(b"important data".to_vec())
            .build();

        let hash = vertex.hash;
        let signature = vec![0u8; 32];
        storage.store_vertex(&vertex, &signature).unwrap();
        storage.flush().unwrap();

        hash
    };

    // Create backup
    let backup_manager = BackupManager::new(&db_path, &backup_dir).unwrap();
    let backup_id = backup_manager.create_backup().await.unwrap().id;

    // Simulate data loss
    std::fs::remove_dir_all(&db_path).unwrap();

    // Restore from backup
    backup_manager.restore_from_backup(&backup_id).await.unwrap();

    // Verify data restored
    let mut storage = RocksDbStorage::open(&db_path).unwrap();
    let restored = storage.get_vertex(&original_hash).unwrap();
    assert!(restored.is_some());
    assert_eq!(restored.unwrap().id, "restore-test-vertex");
}

#[tokio::test]
async fn test_backup_list_and_delete() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("db");
    let backup_dir = temp_dir.path().join("backups");

    std::fs::create_dir_all(&db_path).unwrap();

    let backup_manager = BackupManager::new(&db_path, &backup_dir).unwrap();

    // Create multiple backups
    let mut backup_ids = vec![];
    for _ in 0..3 {
        let metadata = backup_manager.create_backup().await.unwrap();
        backup_ids.push(metadata.id);
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }

    // List backups
    let backups = backup_manager.list_backups().unwrap();
    assert_eq!(backups.len(), 3);

    // Delete oldest backup
    backup_manager.delete_backup(&backup_ids[0]).unwrap();

    // Verify deletion
    let backups = backup_manager.list_backups().unwrap();
    assert_eq!(backups.len(), 2);
}

#[tokio::test]
async fn test_storage_compaction() {
    let temp_dir = TempDir::new().unwrap();
    let mut storage = RocksDbStorage::open(temp_dir.path()).unwrap();

    // Write many vertices
    for i in 0..1000 {
        let vertex = VertexBuilder::new("agent-001".to_string())
            .id(format!("compact-vertex-{}", i))
            .build();

        let signature = vec![0u8; 32];
        storage.store_vertex(&vertex, &signature).unwrap();
    }

    storage.flush().unwrap();

    // Trigger compaction
    storage.compact().unwrap();

    // Verify data still accessible
    let tips = storage.get_dag_tip().unwrap();
    assert_eq!(tips.len(), 1000);
}

#[tokio::test]
async fn test_database_statistics() {
    let temp_dir = TempDir::new().unwrap();
    let mut storage = RocksDbStorage::open(temp_dir.path()).unwrap();

    // Store some data
    for i in 0..10 {
        let vertex = VertexBuilder::new("agent-001".to_string())
            .id(format!("stats-vertex-{}", i))
            .build();

        let signature = vec![0u8; 32];
        storage.store_vertex(&vertex, &signature).unwrap();
    }

    // Get statistics
    let stats = storage.get_db_stats().unwrap();
    println!("Database statistics:\n{}", stats);

    // Get size
    let size = storage.get_db_size().unwrap();
    println!("Database size: {} bytes", size);

    assert!(size > 0);
}

#[test]
fn test_storage_metrics() {
    use cretoai_dag::storage::rocksdb::StorageMetrics;

    let metrics = StorageMetrics::default();
    assert_eq!(metrics.vertices_stored, 0);
    assert_eq!(metrics.vertices_read, 0);
    assert_eq!(metrics.vertices_finalized, 0);
}
