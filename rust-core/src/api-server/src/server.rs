//! HTTP server setup and lifecycle management
//!
//! This module handles:
//! - Server initialization and configuration
//! - Graceful shutdown on signals (SIGTERM, SIGINT)
//! - TCP listener setup
//! - Health check on startup

use crate::{routes, state::AppState};
use anyhow::{Context, Result};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::signal;
use tracing::{info, warn};

/// Server configuration
#[derive(Debug, Clone)]
pub struct ServerConfig {
    /// Host to bind to (e.g., "0.0.0.0" or "127.0.0.1")
    pub host: String,
    /// Port to listen on
    pub port: u16,
    /// Maximum number of concurrent connections
    pub max_connections: usize,
    /// Request timeout in seconds
    pub request_timeout: u64,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: "0.0.0.0".to_string(),
            port: 8080,
            max_connections: 10000,
            request_timeout: 30,
        }
    }
}

/// HTTP server instance
pub struct Server {
    config: ServerConfig,
    state: Arc<AppState>,
}

impl Server {
    /// Create a new server with the given configuration
    pub fn new(config: ServerConfig, state: Arc<AppState>) -> Self {
        Self { config, state }
    }

    /// Start the server and block until shutdown signal
    ///
    /// This function:
    /// 1. Creates a TCP listener
    /// 2. Builds the Axum router
    /// 3. Starts serving requests
    /// 4. Waits for shutdown signal (SIGTERM or SIGINT)
    /// 5. Performs graceful shutdown
    pub async fn run(self) -> Result<()> {
        let addr = format!("{}:{}", self.config.host, self.config.port);

        info!("Starting Authorization Engine API Server");
        info!("Configuration: {:?}", self.config);

        // Create TCP listener
        let listener = TcpListener::bind(&addr)
            .await
            .context(format!("Failed to bind to {}", addr))?;

        let local_addr = listener.local_addr()?;
        info!("Server listening on http://{}", local_addr);
        info!("API documentation available at http://{}/api-docs/", local_addr);
        info!("Health check endpoint: http://{}/health", local_addr);
        info!("Metrics endpoint: http://{}/metrics", local_addr);

        // Create router
        let app = routes::create_router(self.state.clone());

        // Start server with graceful shutdown
        axum::serve(listener, app)
            .with_graceful_shutdown(shutdown_signal())
            .await
            .context("Server error")?;

        info!("Server shutdown complete");
        Ok(())
    }

    /// Get the server configuration
    pub fn config(&self) -> &ServerConfig {
        &self.config
    }

    /// Get the application state
    pub fn state(&self) -> &Arc<AppState> {
        &self.state
    }
}

/// Wait for shutdown signal
///
/// Listens for:
/// - SIGTERM (kill command, docker stop, kubernetes)
/// - SIGINT (Ctrl+C)
async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("Failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("Failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {
            info!("Received SIGINT (Ctrl+C), initiating graceful shutdown");
        },
        _ = terminate => {
            info!("Received SIGTERM, initiating graceful shutdown");
        },
    }

    info!("Shutdown signal received, waiting for active connections to close...");
}

/// Builder for creating a server with custom configuration
pub struct ServerBuilder {
    config: ServerConfig,
    state: Option<Arc<AppState>>,
}

impl ServerBuilder {
    /// Create a new builder with default configuration
    pub fn new() -> Self {
        Self {
            config: ServerConfig::default(),
            state: None,
        }
    }

    /// Set the host to bind to
    pub fn host(mut self, host: impl Into<String>) -> Self {
        self.config.host = host.into();
        self
    }

    /// Set the port to listen on
    pub fn port(mut self, port: u16) -> Self {
        self.config.port = port;
        self
    }

    /// Set the maximum number of concurrent connections
    pub fn max_connections(mut self, max: usize) -> Self {
        self.config.max_connections = max;
        self
    }

    /// Set the request timeout in seconds
    pub fn request_timeout(mut self, timeout: u64) -> Self {
        self.config.request_timeout = timeout;
        self
    }

    /// Set the application state
    pub fn state(mut self, state: Arc<AppState>) -> Self {
        self.state = Some(state);
        self
    }

    /// Build the server
    pub fn build(self) -> Result<Server> {
        let state = self
            .state
            .context("Application state is required")?;

        Ok(Server::new(self.config, state))
    }
}

impl Default for ServerBuilder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_server_config_default() {
        let config = ServerConfig::default();
        assert_eq!(config.host, "0.0.0.0");
        assert_eq!(config.port, 8080);
        assert_eq!(config.max_connections, 10000);
        assert_eq!(config.request_timeout, 30);
    }

    #[test]
    fn test_server_builder() {
        let state = Arc::new(AppState::default());
        let server = ServerBuilder::new()
            .host("127.0.0.1")
            .port(9090)
            .max_connections(5000)
            .request_timeout(60)
            .state(state)
            .build()
            .unwrap();

        assert_eq!(server.config().host, "127.0.0.1");
        assert_eq!(server.config().port, 9090);
        assert_eq!(server.config().max_connections, 5000);
        assert_eq!(server.config().request_timeout, 60);
    }

    #[test]
    fn test_server_builder_missing_state() {
        let result = ServerBuilder::new().build();
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("state"));
    }

    #[tokio::test]
    async fn test_server_creation() {
        let state = Arc::new(AppState::default());
        let config = ServerConfig {
            host: "127.0.0.1".to_string(),
            port: 0, // Use port 0 to let OS assign a free port
            max_connections: 100,
            request_timeout: 30,
        };

        let server = Server::new(config, state);
        assert_eq!(server.config().host, "127.0.0.1");
        assert_eq!(server.config().port, 0);
    }

    #[tokio::test]
    async fn test_tcp_listener_binding() {
        // Test that we can bind to a port
        let listener = TcpListener::bind("127.0.0.1:0").await;
        assert!(listener.is_ok());

        let listener = listener.unwrap();
        let addr = listener.local_addr();
        assert!(addr.is_ok());
    }
}
