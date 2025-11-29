// API Server for CretoAI Authorization Engine
// Phase 4: REST API Layer with OpenAPI documentation

pub mod error;
pub mod handlers;
pub mod middleware;
pub mod models;
pub mod routes;
pub mod server;
pub mod state;

pub use error::{ApiError, Result};
pub use server::Server;
pub use state::AppState;

/// API version
pub const API_VERSION: &str = "v1";

/// Health check response
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub uptime_seconds: u64,
}

/// Version information
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct VersionInfo {
    pub version: String,
    pub build_time: String,
    pub git_commit: String,
}
