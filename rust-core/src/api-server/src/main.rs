//! Authorization Engine API Server
//!
//! This is the main entry point for the REST API server.
//! It provides a complete authorization engine with:
//! - Policy-based access control (PBAC)
//! - Role-based access control (RBAC)
//! - Attribute-based access control (ABAC)
//! - RESTful API with OpenAPI documentation
//!
//! # Usage
//!
//! ```bash
//! # Start with default settings (0.0.0.0:8080)
//! cargo run
//!
//! # Start on custom host and port
//! cargo run -- --host 127.0.0.1 --port 9090
//!
//! # Enable debug logging
//! RUST_LOG=debug cargo run
//!
//! # Enable trace logging for specific module
//! RUST_LOG=api_server::handlers=trace cargo run
//! ```
//!
//! # Environment Variables
//!
//! - `RUST_LOG`: Logging level (trace, debug, info, warn, error)
//! - `API_SERVER_HOST`: Server host (default: 0.0.0.0)
//! - `API_SERVER_PORT`: Server port (default: 8080)
//! - `API_SERVER_MAX_CONNECTIONS`: Max concurrent connections (default: 10000)
//! - `API_SERVER_REQUEST_TIMEOUT`: Request timeout in seconds (default: 30)

use anyhow::Result;
use api_server::{server::ServerBuilder, state::AppState};
use clap::Parser;
use std::sync::Arc;
use tracing::{error, info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// Authorization Engine API Server
#[derive(Parser, Debug)]
#[command(
    name = "authz-server",
    version,
    about = "REST API server for the Authorization Engine",
    long_about = None
)]
struct Args {
    /// Host to bind to
    #[arg(
        short = 'H',
        long,
        default_value = "0.0.0.0",
        env = "API_SERVER_HOST"
    )]
    host: String,

    /// Port to listen on
    #[arg(
        short = 'p',
        long,
        default_value = "8080",
        env = "API_SERVER_PORT"
    )]
    port: u16,

    /// Maximum concurrent connections
    #[arg(
        long,
        default_value = "10000",
        env = "API_SERVER_MAX_CONNECTIONS"
    )]
    max_connections: usize,

    /// Request timeout in seconds
    #[arg(
        long,
        default_value = "30",
        env = "API_SERVER_REQUEST_TIMEOUT"
    )]
    request_timeout: u64,

    /// Enable JSON logging format
    #[arg(long, env = "API_SERVER_JSON_LOGS")]
    json_logs: bool,

    /// Log level (trace, debug, info, warn, error)
    #[arg(
        short = 'l',
        long,
        default_value = "info",
        env = "RUST_LOG"
    )]
    log_level: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Parse command line arguments
    let args = Args::parse();

    // Initialize tracing/logging
    init_tracing(&args)?;

    // Log startup information
    info!("🚀 Starting Authorization Engine API Server");
    info!("Version: {}", env!("CARGO_PKG_VERSION"));
    info!("Authors: {}", env!("CARGO_PKG_AUTHORS"));

    // Initialize application state
    info!("Initializing application state...");
    let state = Arc::new(AppState::default());
    info!("✓ Application state initialized");

    // Build and start server
    info!("Building server configuration...");
    let server = ServerBuilder::new()
        .host(&args.host)
        .port(args.port)
        .max_connections(args.max_connections)
        .request_timeout(args.request_timeout)
        .state(state)
        .build()?;

    info!("✓ Server configuration complete");
    info!("📚 API documentation: http://{}:{}/api-docs/", args.host, args.port);
    info!("💚 Health check: http://{}:{}/health", args.host, args.port);
    info!("📊 Metrics: http://{}:{}/metrics", args.host, args.port);
    info!("");
    info!("Press Ctrl+C to shutdown gracefully");
    info!("");

    // Run the server
    if let Err(e) = server.run().await {
        error!("Server error: {:#}", e);
        std::process::exit(1);
    }

    info!("👋 Server shutdown complete");
    Ok(())
}

/// Initialize tracing/logging subsystem
fn init_tracing(args: &Args) -> Result<()> {
    let log_level = args.log_level.parse::<tracing::Level>()
        .unwrap_or_else(|_| {
            eprintln!("Invalid log level '{}', using 'info'", args.log_level);
            tracing::Level::INFO
        });

    if args.json_logs {
        // JSON structured logging for production
        let subscriber = tracing_subscriber::registry()
            .with(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| {
                        format!(
                            "api_server={},tower_http={},axum={}",
                            log_level,
                            if log_level <= tracing::Level::DEBUG { "debug" } else { "info" },
                            if log_level <= tracing::Level::DEBUG { "debug" } else { "info" }
                        )
                        .into()
                    }),
            )
            .with(tracing_subscriber::fmt::layer().json());

        subscriber.init();
    } else {
        // Human-readable logging for development
        let subscriber = tracing_subscriber::registry()
            .with(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| {
                        format!(
                            "api_server={},tower_http={},axum={}",
                            log_level,
                            if log_level <= tracing::Level::DEBUG { "debug" } else { "info" },
                            if log_level <= tracing::Level::DEBUG { "debug" } else { "info" }
                        )
                        .into()
                    }),
            )
            .with(
                tracing_subscriber::fmt::layer()
                    .with_target(true)
                    .with_thread_ids(false)
                    .with_thread_names(false)
                    .with_file(true)
                    .with_line_number(true),
            );

        subscriber.init();
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_args_parsing() {
        let args = Args::parse_from(vec![
            "authz-server",
            "--host",
            "127.0.0.1",
            "--port",
            "9090",
            "--max-connections",
            "5000",
            "--request-timeout",
            "60",
        ]);

        assert_eq!(args.host, "127.0.0.1");
        assert_eq!(args.port, 9090);
        assert_eq!(args.max_connections, 5000);
        assert_eq!(args.request_timeout, 60);
        assert!(!args.json_logs);
    }

    #[test]
    fn test_args_defaults() {
        let args = Args::parse_from(vec!["authz-server"]);

        assert_eq!(args.host, "0.0.0.0");
        assert_eq!(args.port, 8080);
        assert_eq!(args.max_connections, 10000);
        assert_eq!(args.request_timeout, 30);
        assert!(!args.json_logs);
        assert_eq!(args.log_level, "info");
    }

    #[test]
    fn test_args_json_logs() {
        let args = Args::parse_from(vec!["authz-server", "--json-logs"]);
        assert!(args.json_logs);
    }

    #[test]
    fn test_args_log_level() {
        let args = Args::parse_from(vec!["authz-server", "--log-level", "debug"]);
        assert_eq!(args.log_level, "debug");
    }

    #[test]
    fn test_version_info() {
        assert!(!env!("CARGO_PKG_VERSION").is_empty());
        assert!(!env!("CARGO_PKG_AUTHORS").is_empty());
    }
}
