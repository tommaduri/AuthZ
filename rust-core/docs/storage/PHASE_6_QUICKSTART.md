# Phase 6 Storage Quick Start

Get up and running with the new Phase 6 RocksDB storage in 5 minutes.

## Installation

Add dependencies to your `Cargo.toml`:

```toml
[dependencies]
cretoai-dag = { path = "../dag" }
tokio = { version = "1", features = ["full"] }
```

## Basic Usage

### 1. Create Storage Instance

```rust
use cretoai_dag::storage::rocksdb::RocksDbStorage;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Open storage (creates if doesn't exist)
    let mut storage = RocksDbStorage::open("./data/dag")?;

    println!("Storage initialized successfully!");
    Ok(())
}
```

### 2. Store and Retrieve Vertices

```rust
use cretoai_dag::vertex::VertexBuilder;

// Create a vertex
let vertex = VertexBuilder::new("agent-001".to_string())
    .id("my-first-vertex".to_string())
    .payload(b"Hello, Phase 6!".to_vec())
    .build();

// Create a signature (in production, use proper crypto)
let signature = vec![0u8; 32];

// Store the vertex
storage.store_vertex(&vertex, &signature)?;
println!("Stored vertex: {}", vertex.id);

// Retrieve by hash
if let Some(retrieved) = storage.get_vertex(&vertex.hash)? {
    println!("Retrieved: {:?}", retrieved.payload);
}
```

### 3. Work with Finalization

```rust
// Mark vertex as finalized
storage.mark_finalized(&vertex.hash, 1)?;

// Query finalized vertices
let finalized = storage.get_finalized_vertices()?;
println!("Finalized vertices: {}", finalized.len());
```

### 4. Query by Height

```rust
// Get all vertices at a specific height
let vertices_at_height = storage.get_vertices_at_height(0)?;
println!("Vertices at height 0: {}", vertices_at_height.len());
```

### 5. Find DAG Tips

```rust
// Find vertices with no children (current tips)
let tips = storage.get_dag_tip()?;
println!("Current DAG tips: {}", tips.len());
```

## Backup and Restore

### Create Backup

```rust
use cretoai_dag::storage::backup::BackupManager;

let backup_manager = BackupManager::new("./data/dag", "./backups")?;

// Create backup (async)
let metadata = backup_manager.create_backup().await?;
println!("Backup created: {}", metadata.id);
println!("  Size: {} bytes", metadata.db_size_bytes);
println!("  Compressed: {} bytes", metadata.compressed_size_bytes);
```

### Restore from Backup

```rust
// List available backups
let backups = backup_manager.list_backups()?;
if let Some(latest) = backups.first() {
    println!("Latest backup: {}", latest.id);

    // Restore
    backup_manager.restore_from_backup(&latest.id).await?;
    println!("Restored successfully!");
}
```

## Cloud Backups

```rust
use cretoai_dag::storage::backup::{CloudStorageConfig, CloudProvider};
use std::env;

// Configure S3 storage
let cloud_config = CloudStorageConfig {
    provider: CloudProvider::S3,
    bucket: "my-dag-backups".to_string(),
    region: "us-west-2".to_string(),
    access_key: env::var("AWS_ACCESS_KEY_ID")?,
    secret_key: env::var("AWS_SECRET_ACCESS_KEY")?,
};

let backup_manager = BackupManager::new("./data/dag", "./backups")?
    .with_cloud_storage(cloud_config);

// Backups will now upload to S3 automatically
let metadata = backup_manager.create_backup().await?;
if metadata.cloud_uploaded {
    println!("Uploaded to: {:?}", metadata.cloud_url);
}
```

## Monitoring

### Export Prometheus Metrics

```rust
use cretoai_dag::storage::metrics::PrometheusMetrics;

let metrics = PrometheusMetrics::new();

// Update from storage
metrics.update_from_storage_metrics(storage.get_metrics());

// Export as Prometheus text
let prometheus_text = metrics.export_prometheus_text();
println!("{}", prometheus_text);

// Or as JSON
let json = metrics.to_json();
println!("{}", serde_json::to_string_pretty(&json)?);
```

### Create HTTP Metrics Endpoint

```rust
use axum::{routing::get, Router};

async fn metrics_handler() -> String {
    let metrics = PrometheusMetrics::new();
    // Update metrics from storage...
    metrics.export_prometheus_text()
}

let app = Router::new().route("/metrics", get(metrics_handler));

// Serve on :9090
axum::Server::bind(&"0.0.0.0:9090".parse()?)
    .serve(app.into_make_service())
    .await?;
```

## Performance Testing

### Benchmark Writes

```rust
use std::time::Instant;

let count = 1000;
let start = Instant::now();

for i in 0..count {
    let vertex = VertexBuilder::new("agent-001".to_string())
        .id(format!("vertex-{}", i))
        .payload(vec![0u8; 1024]) // 1KB payload
        .build();

    let signature = vec![0u8; 32];
    storage.store_vertex(&vertex, &signature)?;
}

let elapsed = start.elapsed();
let throughput = count as f64 / elapsed.as_secs_f64();
let avg_latency = elapsed.as_millis() as f64 / count as f64;

println!("Performance:");
println!("  Throughput: {:.2} vertices/sec", throughput);
println!("  Avg latency: {:.2} ms", avg_latency);
```

## Complete Example

```rust
use cretoai_dag::storage::{
    rocksdb::RocksDbStorage,
    backup::BackupManager,
    metrics::PrometheusMetrics,
};
use cretoai_dag::vertex::VertexBuilder;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Initialize storage
    let mut storage = RocksDbStorage::open("./data/dag")?;
    println!("✓ Storage initialized");

    // 2. Create and store vertices
    for i in 0..10 {
        let vertex = VertexBuilder::new("agent-001".to_string())
            .id(format!("vertex-{}", i))
            .payload(format!("Data {}", i).into_bytes())
            .build();

        let signature = vec![0u8; 32];
        storage.store_vertex(&vertex, &signature)?;
    }
    println!("✓ Stored 10 vertices");

    // 3. Query data
    let tips = storage.get_dag_tip()?;
    println!("✓ Found {} DAG tips", tips.len());

    // 4. Create backup
    let backup_manager = BackupManager::new("./data/dag", "./backups")?;
    let backup = backup_manager.create_backup().await?;
    println!("✓ Backup created: {}", backup.id);

    // 5. Check metrics
    let metrics = PrometheusMetrics::new();
    metrics.update_from_storage_metrics(storage.get_metrics());
    let json = metrics.to_json();
    println!("✓ Metrics: {}", serde_json::to_string_pretty(&json)?);

    // 6. Flush to disk
    storage.flush()?;
    println!("✓ Changes flushed to disk");

    println!("\n🎉 Phase 6 storage is working!");
    Ok(())
}
```

## Configuration

### Custom Configuration

```rust
use cretoai_dag::storage::rocksdb::{RocksDbConfig, CompactionStyle};
use std::path::PathBuf;

let config = RocksDbConfig {
    path: PathBuf::from("./data/dag"),
    write_buffer_size: 256 * 1024 * 1024, // 256MB
    max_open_files: 4000,
    cache_size: 1024 * 1024 * 1024, // 1GB
    enable_wal: true,
    enable_statistics: true,
    compaction_style: CompactionStyle::Universal,
};

let storage = RocksDbStorage::open_with_config(config)?;
```

### Environment Variables

```bash
# Create .env file
cat > .env << 'EOF'
CRETOAI_DB_PATH=./data/dag
CRETOAI_BACKUP_DIR=./backups
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_REGION=us-west-2
BACKUP_BUCKET=my-dag-backups
EOF

# Load in Rust
use dotenv::dotenv;
dotenv().ok();
```

## Testing

```bash
# Run storage tests
cargo test --package cretoai-dag --test storage_tests

# Run with output
cargo test --test storage_tests -- --nocapture

# Specific test
cargo test --test storage_tests test_crash_recovery
```

## Migration

Migrate from Phase 5:

```bash
# Backup first!
./scripts/migrate-to-rocksdb.sh

# Or dry run
DRY_RUN=true ./scripts/migrate-to-rocksdb.sh
```

## Troubleshooting

### Permission Denied

```bash
# Fix permissions
chmod -R 755 ./data/dag
```

### Disk Space

```bash
# Check space
df -h ./data/dag

# Compact database
storage.compact()?;
```

### High Memory

```rust
// Reduce cache size in config
config.cache_size = 128 * 1024 * 1024; // 128MB
```

## Next Steps

1. ✅ Basic storage working
2. ⏭️ Set up automated backups
3. ⏭️ Configure Prometheus scraping
4. ⏭️ Import Grafana dashboards
5. ⏭️ Test in production

## Resources

- Full Documentation: `docs/storage/PHASE_6_STORAGE.md`
- Phase 6 Plan: `docs/architecture/PHASE_6_PLAN.md`
- Tests: `src/dag/tests/storage_tests.rs`
- Migration Script: `scripts/migrate-to-rocksdb.sh`

## Need Help?

- GitHub Issues: https://github.com/your-org/cretoai/issues
- Discord: https://discord.gg/cretoai
- Email: support@cretoai.io

---

**Ready to build production-grade distributed systems! 🚀**
