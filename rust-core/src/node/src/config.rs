//! Node configuration loading and validation

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Complete node configuration
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct NodeConfig {
    pub node: NodeSection,
    pub consensus: ConsensusSection,
    pub network: NetworkSection,
    pub storage: StorageSection,
    pub crypto: CryptoSection,
    pub metrics: MetricsSection,
    pub api: ApiSection,

    #[serde(default)]
    pub backup: BackupSection,

    #[serde(default)]
    pub telemetry: TelemetrySection,

    #[serde(default)]
    pub advanced: AdvancedSection,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct NodeSection {
    pub id: String,
    pub data_dir: PathBuf,
    pub log_level: String,
    #[serde(default = "default_true")]
    pub colored_logs: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ConsensusSection {
    pub algorithm: String,
    pub quorum_threshold: f64,
    pub finality_timeout_ms: u64,
    pub max_pending_vertices: usize,
    pub view_change_timeout_ms: u64,
    #[serde(default)]
    pub optimistic_mode: bool,
    #[serde(default = "default_reputation_threshold")]
    pub reputation_threshold: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct NetworkSection {
    pub listen_addr: String,
    pub quic_port: u16,
    #[serde(default)]
    pub bootstrap_peers: Vec<String>,
    #[serde(default = "default_max_peers")]
    pub max_peers: usize,
    #[serde(default = "default_true")]
    pub mdns_enabled: bool,
    #[serde(default = "default_mdns_interval")]
    pub mdns_interval_secs: u64,
    #[serde(default = "default_true")]
    pub kad_enabled: bool,
    #[serde(default)]
    pub kad_bootstrap_nodes: Vec<String>,
    #[serde(default = "default_true")]
    pub enable_nat_traversal: bool,
    #[serde(default)]
    pub stun_servers: Vec<String>,
    #[serde(default = "default_connection_timeout")]
    pub connection_timeout_ms: u64,
    #[serde(default = "default_keep_alive")]
    pub keep_alive_interval_secs: u64,
    #[serde(default = "default_rate_limit")]
    pub rate_limit_per_peer: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StorageSection {
    pub backend: String,
    pub path: PathBuf,
    #[serde(default = "default_cache_size")]
    pub cache_size_mb: usize,
    #[serde(default = "default_write_buffer")]
    pub write_buffer_mb: usize,
    #[serde(default = "default_max_files")]
    pub max_open_files: i32,
    #[serde(default = "default_true")]
    pub compression: bool,
    #[serde(default = "default_true")]
    pub enable_bloom_filters: bool,
    #[serde(default)]
    pub compaction_style: String,
    #[serde(default = "default_compaction_threads")]
    pub compaction_threads: usize,
    #[serde(default = "default_true")]
    pub enable_wal: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CryptoSection {
    pub signature_algorithm: String,
    pub kem_algorithm: String,
    pub hash_algorithm: String,
    #[serde(default = "default_true")]
    pub hybrid_mode: bool,
    pub key_path: PathBuf,
    #[serde(default = "default_true")]
    pub auto_generate_keys: bool,
    #[serde(default)]
    pub key_rotation_days: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MetricsSection {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_metrics_port")]
    pub port: u16,
    #[serde(default = "default_metrics_endpoint")]
    pub endpoint: String,
    #[serde(default = "default_collection_interval")]
    pub collection_interval_secs: u64,
    #[serde(default)]
    pub detailed_peer_metrics: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ApiSection {
    #[serde(default = "default_true")]
    pub http_enabled: bool,
    #[serde(default = "default_api_host")]
    pub http_host: String,
    #[serde(default = "default_http_port")]
    pub http_port: u16,
    #[serde(default)]
    pub ws_enabled: bool,
    #[serde(default = "default_api_host")]
    pub ws_host: String,
    #[serde(default = "default_ws_port")]
    pub ws_port: u16,
    #[serde(default = "default_true")]
    pub cors_enabled: bool,
    #[serde(default)]
    pub cors_origins: Vec<String>,
    #[serde(default = "default_request_timeout")]
    pub request_timeout_secs: u64,
    #[serde(default)]
    pub auth_enabled: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct BackupSection {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_backup_interval")]
    pub interval_hours: u32,
    #[serde(default = "default_retention_days")]
    pub retention_days: u32,
    #[serde(default)]
    pub storage_type: String,
    #[serde(default)]
    pub path: PathBuf,
    #[serde(default = "default_true")]
    pub compress: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct TelemetrySection {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_telemetry_interval")]
    pub export_interval_secs: u64,
    #[serde(default)]
    pub backend: String,
    #[serde(default)]
    pub tracing_enabled: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct AdvancedSection {
    #[serde(default)]
    pub runtime_threads: usize,
    #[serde(default)]
    pub thread_priority: bool,
    #[serde(default)]
    pub allocator: String,
    #[serde(default)]
    pub cpu_affinity: bool,
    #[serde(default)]
    pub numa_aware: bool,
}

// Default value functions
fn default_true() -> bool { true }
fn default_reputation_threshold() -> f64 { 0.3 }
fn default_max_peers() -> usize { 50 }
fn default_mdns_interval() -> u64 { 60 }
fn default_connection_timeout() -> u64 { 30000 }
fn default_keep_alive() -> u64 { 20 }
fn default_rate_limit() -> u64 { 100 }
fn default_cache_size() -> usize { 512 }
fn default_write_buffer() -> usize { 128 }
fn default_max_files() -> i32 { 1000 }
fn default_compaction_threads() -> usize { 4 }
fn default_metrics_port() -> u16 { 9090 }
fn default_metrics_endpoint() -> String { "/metrics".to_string() }
fn default_collection_interval() -> u64 { 15 }
fn default_api_host() -> String { "0.0.0.0".to_string() }
fn default_http_port() -> u16 { 8080 }
fn default_ws_port() -> u16 { 8081 }
fn default_request_timeout() -> u64 { 30 }
fn default_backup_interval() -> u32 { 24 }
fn default_retention_days() -> u32 { 30 }
fn default_telemetry_interval() -> u64 { 60 }

impl NodeConfig {
    /// Load configuration from TOML file
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self> {
        let contents = std::fs::read_to_string(path.as_ref())
            .context("Failed to read configuration file")?;

        let config: NodeConfig = toml::from_str(&contents)
            .context("Failed to parse configuration file")?;

        Ok(config)
    }

    /// Validate configuration
    pub fn validate(&self) -> Result<()> {
        // Validate consensus
        if self.consensus.algorithm != "bft" {
            anyhow::bail!("Only 'bft' consensus algorithm is supported");
        }

        if self.consensus.quorum_threshold < 0.5 || self.consensus.quorum_threshold > 1.0 {
            anyhow::bail!("Quorum threshold must be between 0.5 and 1.0");
        }

        // Validate storage
        if self.storage.backend != "rocksdb" && self.storage.backend != "sled" {
            anyhow::bail!("Storage backend must be 'rocksdb' or 'sled'");
        }

        // Validate crypto
        if self.crypto.signature_algorithm != "ml-dsa-87" {
            anyhow::bail!("Only 'ml-dsa-87' signature algorithm is supported");
        }

        if self.crypto.kem_algorithm != "ml-kem-768" {
            anyhow::bail!("Only 'ml-kem-768' KEM algorithm is supported");
        }

        if self.crypto.hash_algorithm != "blake3" {
            anyhow::bail!("Only 'blake3' hash algorithm is supported");
        }

        Ok(())
    }

    /// Get absolute data directory path
    pub fn data_dir(&self) -> PathBuf {
        if self.node.data_dir.is_absolute() {
            self.node.data_dir.clone()
        } else {
            std::env::current_dir()
                .unwrap_or_default()
                .join(&self.node.data_dir)
        }
    }

    /// Get absolute storage path
    pub fn storage_path(&self) -> PathBuf {
        let data_dir = self.data_dir();
        if self.storage.path.is_absolute() {
            self.storage.path.clone()
        } else {
            data_dir.join(&self.storage.path)
        }
    }

    /// Get absolute key path
    pub fn key_path(&self) -> PathBuf {
        let data_dir = self.data_dir();
        if self.crypto.key_path.is_absolute() {
            self.crypto.key_path.clone()
        } else {
            data_dir.join(&self.crypto.key_path)
        }
    }
}
