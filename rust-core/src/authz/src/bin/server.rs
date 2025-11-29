//! # Authorization HTTP Server
//!
//! Production-ready HTTP server for the CretoAI authorization engine.
//! Provides REST API endpoints for authorization checks, health monitoring, and metrics.
//!
//! ## Endpoints
//!
//! - `POST /v1/check` - Authorization check
//! - `GET /health` - Health check
//! - `GET /metrics` - Prometheus metrics
//!
//! ## Configuration
//!
//! Environment variables:
//! - `PORT` - HTTP server port (default: 8080)
//! - `METRICS_PORT` - Metrics server port (default: 9090)
//! - `RUST_LOG` - Log level (default: info)
//! - `CACHE_SIZE` - LRU cache capacity (default: 10000)
//! - `CACHE_TTL` - Cache TTL in seconds (default: 300)

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
    serve,
};
use cretoai_authz::{
    AuthzEngine, AuthzRequest,
    policy::PolicyEffect,
};
use cretoai_authz::engine_legacy::EngineConfig;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::signal;
use tower::ServiceBuilder;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::{DefaultOnResponse, TraceLayer},
};
use tracing::{error, info, Level};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// Shared application state
#[derive(Clone)]
struct AppState {
    engine: Arc<AuthzEngine>,
    start_time: std::time::Instant,
}

/// Error response body
#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
    message: String,
}

/// Application error type
#[derive(Debug)]
enum AppError {
    Engine(String),
    BadRequest(String),
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, error, message) = match self {
            AppError::BadRequest(msg) => (
                StatusCode::BAD_REQUEST,
                "bad_request",
                msg,
            ),
            AppError::Engine(msg) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "engine_error",
                msg,
            ),
            AppError::Internal(msg) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                msg,
            ),
        };

        let body = Json(ErrorResponse {
            error: error.to_string(),
            message,
        });

        (status, body).into_response()
    }
}

impl From<cretoai_authz::AuthzError> for AppError {
    fn from(err: cretoai_authz::AuthzError) -> Self {
        AppError::Engine(err.to_string())
    }
}

/// Authorization check request (matches Go engine API)
#[derive(Debug, Deserialize)]
struct CheckRequest {
    principal: cretoai_authz::Principal,
    resource: cretoai_authz::Resource,
    action: cretoai_authz::Action,
    #[serde(default)]
    context: std::collections::HashMap<String, String>,
}

/// Authorization check response (matches Go engine API)
#[derive(Debug, Serialize)]
struct CheckResponse {
    allowed: bool,
    decision: String,
    policy_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    decision_id: Option<String>,
    timestamp: u64,
}

/// Health check response
#[derive(Debug, Serialize)]
struct HealthResponse {
    status: String,
    uptime_seconds: u64,
    version: String,
}

/// Metrics response (Prometheus format)
struct MetricsResponse {
    metrics: String,
}

impl IntoResponse for MetricsResponse {
    fn into_response(self) -> Response {
        (
            StatusCode::OK,
            [("content-type", "text/plain; version=0.0.4")],
            self.metrics,
        )
            .into_response()
    }
}

/// POST /v1/check - Check authorization
async fn check_authorization(
    State(state): State<AppState>,
    Json(req): Json<CheckRequest>,
) -> Result<Json<CheckResponse>, AppError> {
    info!(
        "Authorization check: principal={}, resource={}, action={}",
        req.principal.id, req.resource.id, req.action.name
    );

    // Create authorization request
    let authz_request = AuthzRequest {
        principal: req.principal,
        resource: req.resource,
        action: req.action,
        context: req.context,
    };

    // Check authorization
    let decision = state.engine.check(&authz_request).await?;

    // Convert to response format
    let response = CheckResponse {
        allowed: decision.allowed,
        decision: if decision.allowed { "allow".to_string() } else { "deny".to_string() },
        policy_id: decision.policy_id.clone(),
        reason: Some(decision.reason.clone()),
        decision_id: Some(decision.id.clone()),
        timestamp: decision.timestamp,
    };

    info!(
        "Authorization decision: {} (policy: {})",
        if response.allowed { "ALLOW" } else { "DENY" },
        response.policy_id
    );

    Ok(Json(response))
}

/// GET /health - Health check endpoint
async fn health_check(State(state): State<AppState>) -> Json<HealthResponse> {
    let uptime = state.start_time.elapsed().as_secs();

    Json(HealthResponse {
        status: "healthy".to_string(),
        uptime_seconds: uptime,
        version: cretoai_authz::VERSION.to_string(),
    })
}

/// GET /metrics - Prometheus metrics endpoint
async fn metrics(State(state): State<AppState>) -> MetricsResponse {
    let uptime = state.start_time.elapsed().as_secs();

    // Generate Prometheus format metrics
    let metrics = format!(
        "# HELP authz_uptime_seconds Server uptime in seconds\n\
         # TYPE authz_uptime_seconds gauge\n\
         authz_uptime_seconds {}\n\
         \n\
         # HELP authz_version Server version info\n\
         # TYPE authz_version gauge\n\
         authz_version{{version=\"{}\"}} 1\n",
        uptime,
        cretoai_authz::VERSION
    );

    MetricsResponse { metrics }
}

/// Create the HTTP router with all endpoints
fn create_router(state: AppState) -> Router {
    // Create CORS layer
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Create tracing layer
    let trace = TraceLayer::new_for_http()
        .on_response(DefaultOnResponse::new().level(Level::INFO));

    // Build the router
    Router::new()
        .route("/v1/check", post(check_authorization))
        .route("/health", get(health_check))
        .layer(
            ServiceBuilder::new()
                .layer(trace)
                .layer(cors)
        )
        .with_state(state)
}

/// Create the metrics router
fn create_metrics_router(state: AppState) -> Router {
    Router::new()
        .route("/metrics", get(metrics))
        .with_state(state)
}

/// Graceful shutdown handler
async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {
            info!("Received Ctrl+C signal");
        }
        _ = terminate => {
            info!("Received SIGTERM signal");
        }
    }

    info!("Starting graceful shutdown");
}

/// Main server entrypoint
#[tokio::main]
async fn main() -> std::io::Result<()> {
    // Initialize tracing subscriber
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting CretoAI Authorization Server v{}", cretoai_authz::VERSION);

    // Load configuration from environment
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8080);

    let metrics_port: u16 = std::env::var("METRICS_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(9090);

    let cache_size: usize = std::env::var("CACHE_SIZE")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(10000);

    info!("Configuration:");
    info!("  Port: {}", port);
    info!("  Metrics Port: {}", metrics_port);
    info!("  Cache Size: {}", cache_size);

    // Create engine configuration
    let config = EngineConfig {
        enable_cache: true,
        cache_capacity: cache_size,
        enable_audit: false, // Disabled by default
        default_decision: PolicyEffect::Deny,
    };

    // Initialize authorization engine
    info!("Initializing authorization engine...");
    let engine = match AuthzEngine::with_config(config).await {
        Ok(e) => e,
        Err(e) => {
            error!("Failed to initialize engine: {}", e);
            return Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("Engine initialization failed: {}", e),
            ));
        }
    };

    info!("Authorization engine initialized successfully");

    // Create shared state
    let state = AppState {
        engine: Arc::new(engine),
        start_time: std::time::Instant::now(),
    };

    // Create HTTP router
    let app = create_router(state.clone());
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    // Create metrics router
    let metrics_app = create_metrics_router(state.clone());
    let metrics_addr = SocketAddr::from(([0, 0, 0, 0], metrics_port));

    info!("Starting HTTP server on {}", addr);
    info!("Starting metrics server on {}", metrics_addr);

    // Create TCP listeners
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            error!("Failed to bind HTTP server: {}", e);
            return Err(e);
        }
    };

    let metrics_listener = match tokio::net::TcpListener::bind(metrics_addr).await {
        Ok(l) => l,
        Err(e) => {
            error!("Failed to bind metrics server: {}", e);
            return Err(e);
        }
    };

    // Start both servers concurrently
    let server = serve(listener, app.into_make_service())
        .with_graceful_shutdown(shutdown_signal());

    let metrics_server = serve(metrics_listener, metrics_app.into_make_service())
        .with_graceful_shutdown(shutdown_signal());

    // Run both servers
    let result = tokio::try_join!(
        async {
            server.await.map_err(|e| {
                error!("HTTP server error: {}", e);
                e
            })
        },
        async {
            metrics_server.await.map_err(|e| {
                error!("Metrics server error: {}", e);
                e
            })
        }
    );

    match result {
        Ok(_) => {
            info!("Servers shut down gracefully");
            Ok(())
        }
        Err(e) => {
            error!("Server error: {}", e);
            Err(e)
        }
    }
}
