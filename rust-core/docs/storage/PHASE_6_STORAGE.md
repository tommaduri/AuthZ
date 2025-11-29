# Phase 6 Storage Implementation

## Overview

Phase 6 introduces a production-grade RocksDB storage layer with advanced features for distributed consensus, backup/restore, and comprehensive monitoring.

## Key Features

### 1. Enhanced RocksDB Storage

**6 Column Families:**
- `vertices` - Vertex data indexed by BLAKE3 hash
- `edges` - Parent-child relationships
- `metadata` - Extended vertex metadata
- `index_height` - Height-based indexing
- `index_timestamp` - Timestamp-based indexing
- `finalized` - Finalized vertex tracking

**Performance Characteristics:**
- Write latency: <10ms p99
- Read latency: <5ms p99
- Throughput: 10K+ TPS
- Database size: Efficient compression with LZ4/Zstd

### 2. Backup and Restore

**Checkpoint-based Backups:**
- Instant snapshots using RocksDB checkpoints (hard links)
- Tar.gz compression for efficient storage
- Typical compression ratio: 30-50%

**Cloud Storage Integration:**
- AWS S3 support
- Google Cloud Storage support
- Azure Blob Storage support
- MinIO (self-hosted S3) support

**Automated Scheduling:**
- Daily backup automation
- Configurable retention policies
- Point-in-time recovery

### 3. Prometheus Metrics

**Exposed Metrics:**
```
cretoai_storage_vertices_stored_total
cretoai_storage_vertices_read_total
cretoai_storage_vertices_finalized_total
cretoai_storage_cache_hit_rate
cretoai_storage_write_latency_ms (p50, p95, p99)
cretoai_storage_read_latency_ms (p50, p95, p99)
cretoai_storage_db_size_bytes
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Application Layer                     │
│                 (Consensus, API, etc.)                  │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                  RocksDB Storage Layer                  │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   vertices   │  │    edges     │  │   metadata   │ │
│  │  (hash → V)  │  │  (P→C edge)  │  │  (metadata)  │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ index_height │  │index_timestamp│ │  finalized   │ │
│  │ (height→[H]) │  │  (time→H)    │  │  (seq→H)     │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   Backup Manager                        │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  Checkpoint  │→│  Compression │→│Cloud Storage │ │
│  │  (instant)   │  │  (tar.gz)    │  │  (S3, GCS)   │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Usage Examples

### Basic Storage Operations

```rust
use cretoai_dag::storage::rocksdb::RocksDbStorage;
use cretoai_dag::vertex::VertexBuilder;

// Open storage
let mut storage = RocksDbStorage::open("./data/dag")?;

// Store a vertex
let vertex = VertexBuilder::new("agent-001".to_string())
    .id("my-vertex".to_string())
    .payload(b"transaction data".to_vec())
    .build();

let signature = sign_vertex(&vertex);
storage.store_vertex(&vertex, &signature)?;

// Retrieve by hash
let retrieved = storage.get_vertex(&vertex.hash)?;

// Mark as finalized
storage.mark_finalized(&vertex.hash, sequence_number)?;

// Query by height
let vertices = storage.get_vertices_at_height(100)?;

// Find DAG tips
let tips = storage.get_dag_tip()?;
```

### Backup and Restore

```rust
use cretoai_dag::storage::backup::{BackupManager, CloudStorageConfig, CloudProvider};

// Create backup manager
let backup_manager = BackupManager::new("./data/dag", "./backups")?;

// Optional: Configure cloud storage
let cloud_config = CloudStorageConfig {
    provider: CloudProvider::S3,
    bucket: "my-dag-backups".to_string(),
    region: "us-west-2".to_string(),
    access_key: env::var("AWS_ACCESS_KEY_ID")?,
    secret_key: env::var("AWS_SECRET_ACCESS_KEY")?,
};

let backup_manager = backup_manager.with_cloud_storage(cloud_config);

// Create backup
let metadata = backup_manager.create_backup().await?;
println!("Backup created: {}", metadata.id);
println!("  Compressed: {} bytes", metadata.compressed_size_bytes);
println!("  Ratio: {:.2}%", metadata.compression_ratio * 100.0);

// List backups
let backups = backup_manager.list_backups()?;
for backup in backups {
    println!("Backup: {} ({})", backup.id, backup.created_at);
}

// Restore from backup
backup_manager.restore_from_backup(&backup_id).await?;

// Start automated daily backups
let manager_arc = Arc::new(backup_manager);
tokio::spawn(async move {
    manager_arc.start_daily_backup_scheduler().await;
});
```

### Prometheus Metrics

```rust
use cretoai_dag::storage::metrics::PrometheusMetrics;

// Create metrics collector
let metrics = PrometheusMetrics::new();

// Update from storage stats
metrics.update_from_storage_metrics(storage.get_metrics());

// Export Prometheus text format
let prometheus_text = metrics.export_prometheus_text();

// Or export as JSON
let json = metrics.to_json();
```

## Configuration

### Storage Configuration

```rust
use cretoai_dag::storage::rocksdb::{RocksDbConfig, CompactionStyle};

let config = RocksDbConfig {
    path: PathBuf::from("./data/dag"),
    write_buffer_size: 128 * 1024 * 1024, // 128MB
    max_open_files: 2000,
    cache_size: 512 * 1024 * 1024, // 512MB
    enable_wal: true,
    enable_statistics: true,
    compaction_style: CompactionStyle::Level,
};

let storage = RocksDbStorage::open_with_config(config)?;
```

### Environment Variables

```bash
# Storage configuration
export CRETOAI_DB_PATH="./data/dag"
export CRETOAI_BACKUP_DIR="./backups"
export CRETOAI_WRITE_BUFFER_SIZE="134217728"  # 128MB
export CRETOAI_MAX_OPEN_FILES="2000"

# Cloud storage (optional)
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_REGION="us-west-2"
export BACKUP_BUCKET="my-dag-backups"

# Metrics
export PROMETHEUS_PORT="9090"
export METRICS_ENABLED="true"
```

## Migration from Phase 5

To migrate from Phase 5 storage to Phase 6:

```bash
# Set environment variables
export OLD_DB_PATH="./data/dag"
export NEW_DB_PATH="./data/dag_v6"
export BACKUP_PATH="./backups"

# Run migration script
./scripts/migrate-to-rocksdb.sh

# Dry run first (recommended)
DRY_RUN=true ./scripts/migrate-to-rocksdb.sh
```

The migration script will:
1. Create a backup of existing data
2. Analyze the current database
3. Create new Phase 6 structure
4. Migrate all vertices and metadata
5. Verify the migration

## Performance Tuning

### Write Performance

```rust
// Increase write buffer size
config.write_buffer_size = 256 * 1024 * 1024; // 256MB

// Use universal compaction for write-heavy workloads
config.compaction_style = CompactionStyle::Universal;

// Disable WAL for maximum throughput (less durable)
config.enable_wal = false;
```

### Read Performance

```rust
// Increase cache size
config.cache_size = 1024 * 1024 * 1024; // 1GB

// More open files for better read performance
config.max_open_files = 4000;

// Use bloom filters (automatic in RocksDB)
```

### Compaction

```rust
// Manual compaction
storage.compact()?;

// Check database statistics
let stats = storage.get_db_stats()?;
println!("{}", stats);
```

## Monitoring

### Grafana Dashboard

Import the provided Grafana dashboard for comprehensive monitoring:

```bash
# Located at: k8s/monitoring/grafana-dashboard.json
# Includes panels for:
# - Write/read latency histograms
# - Throughput metrics
# - Database size over time
# - Cache hit rate
# - Compaction statistics
```

### Key Metrics to Watch

1. **Write Latency P99**: Should stay <10ms
2. **Read Latency P99**: Should stay <5ms
3. **Cache Hit Rate**: Target >80%
4. **Database Size**: Monitor growth rate
5. **Compaction Count**: High values indicate tuning needed

## Troubleshooting

### High Write Latency

```bash
# Check compaction stats
storage.get_db_stats()?;

# Increase write buffer
config.write_buffer_size = 256 * 1024 * 1024;

# Check disk I/O
iostat -x 1
```

### High Memory Usage

```bash
# Reduce cache size
config.cache_size = 256 * 1024 * 1024; // 256MB

# Limit open files
config.max_open_files = 1000;

# Force compaction
storage.compact()?;
```

### Backup Failures

```bash
# Check disk space
df -h

# Verify permissions
ls -la ./backups

# Test cloud credentials
aws s3 ls s3://my-dag-backups/
```

## Testing

Run the comprehensive test suite:

```bash
# All storage tests
cargo test --package cretoai-dag --test storage_tests

# Specific tests
cargo test --test storage_tests test_crash_recovery
cargo test --test storage_tests test_write_performance
cargo test --test storage_tests test_backup_restore

# With output
cargo test --test storage_tests -- --nocapture
```

## Production Checklist

- [ ] Enable WAL for durability
- [ ] Configure automated backups
- [ ] Set up cloud storage for backups
- [ ] Configure Prometheus scraping
- [ ] Import Grafana dashboards
- [ ] Set up alerts for high latency
- [ ] Test crash recovery procedure
- [ ] Document restore process
- [ ] Monitor disk space
- [ ] Tune compaction settings

## Support

For issues or questions:
- GitHub Issues: https://github.com/your-org/cretoai/issues
- Documentation: https://docs.cretoai.io/storage
- Phase 6 Plan: `docs/architecture/PHASE_6_PLAN.md`
