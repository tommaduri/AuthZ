//! Health check endpoint

use axum::Json;
use serde::Serialize;

#[derive(Serialize, utoipa::ToSchema)]
pub struct HealthResponse {
    status: String,
    version: String,
    quantum_ready: bool,
}

/// Health check endpoint
///
/// Returns service health status
pub async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        quantum_ready: true,
    })
}
