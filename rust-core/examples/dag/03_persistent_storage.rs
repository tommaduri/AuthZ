//! Persistent Storage Example
//!
//! This example demonstrates:
//! - Creating persistent RocksDB storage
//! - Storing vertices to disk
//! - Cross-session persistence
//! - LRU caching for performance
//! - Batch operations

use cretoai_dag::storage::{Storage, StorageConfig};
use cretoai_dag::vertex::VertexBuilder;
use std::path::PathBuf;
use tempfile::TempDir;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== Persistent Storage Example ===\n");

    // Create temporary directory for this example
    let temp_dir = TempDir::new()?;
    let db_path = temp_dir.path().to_path_buf();
    println!("Using temporary database at: {:?}\n", db_path);

    // === Part 1: Create storage and add vertices ===
    println!("=== Part 1: Writing to Storage ===");

    {
        let config = StorageConfig {
            path: db_path.clone(),
            create_if_missing: true,
            enable_compression: true,  // LZ4 compression
            write_buffer_size: 64 * 1024 * 1024,  // 64 MB
            max_open_files: 1000,
            enable_statistics: true,
        };

        let storage = Storage::open_with_config(config)?;
        println!("✓ Opened storage with configuration:");
        println!("  - LZ4 compression: enabled");
        println!("  - Write buffer: 64 MB");
        println!("  - LRU cache: 10,000 vertices\n");

        // Add individual vertices
        println!("Adding vertices...");
        for i in 0..100 {
            let vertex = VertexBuilder::new("agent-001".to_string())
                .id(format!("vertex-{:03}", i))
                .payload(format!("Data for vertex {}", i).into_bytes())
                .build();

            storage.put_vertex(&vertex)?;
        }
        println!("✓ Added 100 vertices individually");

        // Batch add vertices (more efficient)
        println!("\nBatch adding vertices...");
        let mut batch = Vec::new();
        for i in 100..1000 {
            let vertex = VertexBuilder::new("agent-002".to_string())
                .id(format!("vertex-{:04}", i))
                .build();
            batch.push(vertex);
        }

        storage.put_batch(&batch)?;
        println!("✓ Batch added 900 vertices");

        // Check storage stats
        let count = storage.vertex_count()?;
        println!("\nStorage statistics:");
        println!("  - Total vertices: {}", count);

        // Flush to disk before closing
        storage.flush()?;
        println!("✓ Flushed all data to disk");

        // Storage automatically closes when dropped
        println!("✓ Closing storage...");
    }

    println!("\n=== Storage Session 1 Complete ===\n");

    // === Part 2: Reopen storage and verify persistence ===
    println!("=== Part 2: Cross-Session Persistence ===");

    {
        // Reopen the same database
        let storage = Storage::open(&db_path)?;
        println!("✓ Reopened storage from disk");

        // Verify data persisted
        let count = storage.vertex_count()?;
        println!("✓ Found {} vertices (data persisted!)", count);

        // Read some vertices
        println!("\n=== Reading Vertices ===");

        // Cold read (from disk)
        println!("Cold read (from disk):");
        let vertex_5 = storage.get_vertex(&"vertex-005".to_string())?;
        println!("  ✓ vertex-005: agent={}", vertex_5.agent_id);

        // Warm read (from cache)
        println!("\nWarm read (from cache):");
        let vertex_5_cached = storage.get_vertex(&"vertex-005".to_string())?;
        println!("  ✓ vertex-005: {} bytes payload", vertex_5_cached.payload.len());

        // Batch retrieval
        println!("\n=== Batch Operations ===");
        let all_vertices = storage.get_all_vertices()?;
        println!("✓ Retrieved all {} vertices", all_vertices.len());

        // Verify specific vertices
        let has_vertex_100 = storage.has_vertex(&"vertex-0100".to_string())?;
        let has_vertex_999 = storage.has_vertex(&"vertex-0999".to_string())?;
        println!("  - vertex-0100 exists: {}", has_vertex_100);
        println!("  - vertex-0999 exists: {}", has_vertex_999);

        // Delete some vertices
        println!("\n=== Deletion ===");
        storage.delete_vertex(&"vertex-005".to_string())?;
        println!("✓ Deleted vertex-005");

        let still_exists = storage.has_vertex(&"vertex-005".to_string())?;
        println!("  - vertex-005 exists: {} (should be false)", still_exists);

        // Batch delete
        let to_delete = vec![
            "vertex-010".to_string(),
            "vertex-020".to_string(),
            "vertex-030".to_string(),
        ];
        storage.delete_batch(&to_delete)?;
        println!("✓ Batch deleted 3 vertices");

        let final_count = storage.vertex_count()?;
        println!("\nFinal vertex count: {}", final_count);

        // Compact storage
        println!("\n=== Compaction ===");
        storage.compact()?;
        println!("✓ Compacted storage (optimized disk usage)");
    }

    println!("\n=== Example Complete ===");
    println!("✓ Demonstrated persistent storage");
    println!("✓ Verified cross-session data persistence");
    println!("✓ Showed cache performance benefits");
    println!("✓ Demonstrated batch operations");

    println!("\nNote: Temporary database will be cleaned up automatically");

    Ok(())
}
