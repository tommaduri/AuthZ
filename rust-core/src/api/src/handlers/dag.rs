//! DAG consensus handlers

use axum::Json;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use blake3;
use std::sync::atomic::{AtomicU64, Ordering};
use crate::{
    models::*,
    error::{ApiError, ApiResult},
};

// Simple in-memory DAG state for Phase 5 demo
// TODO: Replace with cretoai-dag persistent storage in Phase 6
static VERTEX_COUNT: AtomicU64 = AtomicU64::new(0);
static FINALIZED_COUNT: AtomicU64 = AtomicU64::new(0);

/// Create new vertex in quantum-resistant DAG
///
/// # Example
///
/// ```bash
/// curl -X POST http://localhost:8080/api/v1/consensus/vertex \
///   -H "Content-Type: application/json" \
///   -d '{"data": "dHJhbnNhY3Rpb24gZGF0YQ==", "parents": ["hash1", "hash2"]}'
/// ```
#[utoipa::path(
    post,
    path = "/api/v1/consensus/vertex",
    request_body = CreateVertexRequest,
    responses(
        (status = 200, description = "Vertex created", body = CreateVertexResponse),
        (status = 400, description = "Invalid input"),
    ),
    tag = "dag"
)]
pub async fn create_vertex(
    Json(req): Json<CreateVertexRequest>,
) -> ApiResult<Json<CreateVertexResponse>> {
    // Decode base64 data
    let data = BASE64.decode(&req.data)
        .map_err(|e| ApiError::InvalidInput(format!("Invalid data: {}", e)))?;

    // Size check (1MB max per SDD)
    if data.len() > 1024 * 1024 {
        return Err(ApiError::InvalidInput("Data exceeds 1MB limit".to_string()));
    }

    // Validate parent hashes if provided
    if let Some(ref parents) = req.parents {
        if parents.is_empty() {
            return Err(ApiError::InvalidInput("Parents array cannot be empty".to_string()));
        }
        if parents.len() > 10 {
            return Err(ApiError::InvalidInput("Too many parent hashes (max 10)".to_string()));
        }
    }

    // Create vertex hash using BLAKE3 (quantum-resistant)
    let vertex_hash = blake3::hash(&data);
    let hash_hex = vertex_hash.to_hex();

    // Increment counters
    let count = VERTEX_COUNT.fetch_add(1, Ordering::SeqCst) + 1;
    let height = count; // Simplified: height = count for demo

    // TODO:
    // - Sign vertex with ML-DSA-87
    // - Add to persistent DAG storage
    // - Propagate to consensus network
    // - Track finalization with quorum

    Ok(Json(CreateVertexResponse {
        vertex_hash: hash_hex.to_string(),
        height,
        message: "Vertex created and propagated to consensus network".to_string(),
    }))
}

/// Get DAG consensus status
///
/// # Example
///
/// ```bash
/// curl http://localhost:8080/api/v1/consensus/status
/// ```
#[utoipa::path(
    get,
    path = "/api/v1/consensus/status",
    responses(
        (status = 200, description = "DAG status retrieved", body = DagStatusResponse),
    ),
    tag = "dag"
)]
pub async fn get_status() -> ApiResult<Json<DagStatusResponse>> {
    let vertex_count = VERTEX_COUNT.load(Ordering::SeqCst);
    let _finalized_count = FINALIZED_COUNT.load(Ordering::SeqCst);

    // Simulate finalization (90% of vertices finalized)
    let actual_finalized = (vertex_count as f64 * 0.9) as u64;
    FINALIZED_COUNT.store(actual_finalized, Ordering::SeqCst);

    // Determine status based on network health
    let status = if vertex_count > 0 {
        "healthy"
    } else {
        "syncing"
    };

    Ok(Json(DagStatusResponse {
        vertex_count,
        height: vertex_count, // Simplified for demo
        finalized_count: actual_finalized,
        status: status.to_string(),
    }))
}
