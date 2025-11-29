//! CretoAI Consensus Node - Main Binary
//!
//! Byzantine Fault Tolerant consensus node with:
//! - QUIC-based P2P networking
//! - RocksDB persistent storage
//! - Quantum-resistant cryptography
//! - Prometheus metrics
//! - <500ms finality

use anyhow::Result;
use clap::Parser;
use cretoai_crypto::signatures::SignatureScheme;
use std::path::PathBuf;
use tokio::signal;
use tracing::{info, error};

mod node;
mod config;

use node::ConsensusNode;
use config::NodeConfig;

/// CretoAI Consensus Node CLI
#[derive(Parser)]
#[command(name = "cretoai-node")]
#[command(about = "CretoAI Consensus Node - Byzantine Fault Tolerant DAG")]
#[command(version)]
struct Cli {
    /// Path to configuration file
    #[arg(short, long, default_value = "/etc/cretoai/node.toml", env = "CRETOAI_CONFIG")]
    config: PathBuf,

    /// Node ID (overrides config)
    #[arg(long, env = "NODE_ID")]
    node_id: Option<String>,

    /// Override listen address
    #[arg(long, env = "LISTEN_ADDR")]
    listen: Option<String>,

    /// Enable verbose logging
    #[arg(short, long)]
    verbose: bool,

    /// Subcommand
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Parser)]
enum Command {
    /// Check node health status
    Health,

    /// Show node version
    Version,

    /// Generate new keypair
    Keygen {
        /// Output directory for keys
        #[arg(short, long, default_value = "./keys")]
        output: PathBuf,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Initialize logging
    let log_level = if cli.verbose { "debug" } else { "info" };
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| format!("{},cretoai_node=debug", log_level).into())
        )
        .with_target(true)
        .with_thread_ids(true)
        .with_line_number(true)
        .init();

    // Handle subcommands
    if let Some(cmd) = cli.command {
        match cmd {
            Command::Health => {
                println!("Health check not yet implemented");
                return Ok(());
            }
            Command::Version => {
                println!("CretoAI Node v{}", env!("CARGO_PKG_VERSION"));
                return Ok(());
            }
            Command::Keygen { output } => {
                generate_keypair(output)?;
                return Ok(());
            }
        }
    }

    info!("Starting CretoAI Consensus Node v{}", env!("CARGO_PKG_VERSION"));

    // Load configuration
    let mut config = NodeConfig::load(&cli.config)?;
    info!("Loaded configuration from {:?}", cli.config);

    // Apply CLI overrides
    if let Some(node_id) = cli.node_id {
        config.node.id = node_id;
    }
    if let Some(listen_addr) = cli.listen {
        config.network.listen_addr = listen_addr;
    }

    // Validate configuration
    config.validate()?;

    // Create and start consensus node
    let mut node = ConsensusNode::new(config).await?;
    info!("Consensus node initialized");

    // Run node with graceful shutdown
    tokio::select! {
        result = node.run() => {
            if let Err(e) = result {
                error!("Node error: {}", e);
                return Err(e);
            }
        }
        _ = signal::ctrl_c() => {
            info!("Received shutdown signal (Ctrl+C)");
            node.shutdown().await?;
        }
        _ = shutdown_signal() => {
            info!("Received shutdown signal (SIGTERM)");
            node.shutdown().await?;
        }
    }

    info!("Node stopped gracefully");
    Ok(())
}

/// Generate a new keypair
fn generate_keypair(output_dir: PathBuf) -> Result<()> {
    use cretoai_crypto::signatures::ML_DSA_87;

    std::fs::create_dir_all(&output_dir)?;

    info!("Generating ML-DSA-87 keypair...");
    let ml_dsa = ML_DSA_87::new();
    let (private_key, public_key) = ml_dsa.generate_keypair();

    let private_key_path = output_dir.join("private_key.bin");
    let public_key_path = output_dir.join("public_key.bin");

    std::fs::write(&private_key_path, &private_key)?;
    std::fs::write(&public_key_path, &public_key)?;

    info!("Keypair generated:");
    info!("  Private key: {:?}", private_key_path);
    info!("  Public key:  {:?}", public_key_path);
    info!("  Public key size: {} bytes", public_key.len());
    info!("  Private key size: {} bytes", private_key.len());

    Ok(())
}

/// Cross-platform shutdown signal handling
#[cfg(unix)]
async fn shutdown_signal() {
    use tokio::signal::unix::{signal, SignalKind};

    let mut sigterm = signal(SignalKind::terminate())
        .expect("Failed to register SIGTERM handler");

    sigterm.recv().await;
}

#[cfg(not(unix))]
async fn shutdown_signal() {
    // On non-Unix systems, only Ctrl+C is supported
    std::future::pending::<()>().await
}
