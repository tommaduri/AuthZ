use axum::{extract::State, Json};
use std::time::Instant;
use validator::Validate;

use crate::{
    error::{ApiError, Result},
    models::*,
    state::AppState,
    HealthResponse, VersionInfo,
};
use cretoai_authz::types::AuthzRequest;

/// Health check endpoint
#[utoipa::path(
    get,
    path = "/health",
    responses(
        (status = 200, description = "Service is healthy", body = HealthResponse)
    ),
    tag = "health"
)]
pub async fn health_check(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy".to_string(),
        version: state.version.clone(),
        uptime_seconds: state.uptime_seconds(),
    })
}

/// Version information endpoint
#[utoipa::path(
    get,
    path = "/version",
    responses(
        (status = 200, description = "Version information", body = VersionInfo)
    ),
    tag = "info"
)]
pub async fn version_info(State(state): State<AppState>) -> Json<VersionInfo> {
    Json(VersionInfo {
        version: state.version.clone(),
        build_time: state.build_time.clone(),
        git_commit: state.git_commit.clone(),
    })
}

/// Authorization check endpoint
#[utoipa::path(
    post,
    path = "/v1/authz/check",
    request_body = AuthzCheckRequest,
    responses(
        (status = 200, description = "Authorization decision", body = AuthzCheckResponse),
        (status = 400, description = "Invalid request"),
        (status = 500, description = "Internal server error")
    ),
    tag = "authorization"
)]
pub async fn authz_check(
    State(state): State<AppState>,
    Json(req): Json<AuthzCheckRequest>,
) -> Result<Json<AuthzCheckResponse>> {
    // Validate request
    req.validate()
        .map_err(|e| ApiError::ValidationError(e.to_string()))?;

    let start = Instant::now();

    // Create authorization request
    let authz_req = AuthzRequest {
        principal_id: req.principal_id,
        resource_id: req.resource_id,
        action: req.action,
        context: req.context,
    };

    // Evaluate authorization
    let decision = state.engine.evaluate(&authz_req).await?;

    let latency_ms = start.elapsed().as_millis() as u64;

    Ok(Json(AuthzCheckResponse {
        allowed: decision.allowed,
        reason: decision.reason,
        policy_id: Some(decision.policy_id),
        latency_ms,
    }))
}

/// Create or update policy
#[utoipa::path(
    post,
    path = "/v1/policies",
    request_body = PolicyRequest,
    responses(
        (status = 200, description = "Policy created/updated successfully"),
        (status = 400, description = "Invalid request"),
        (status = 500, description = "Internal server error")
    ),
    tag = "policies"
)]
pub async fn create_policy(
    State(_state): State<AppState>,
    Json(req): Json<PolicyRequest>,
) -> Result<Json<serde_json::Value>> {
    // Validate request
    req.validate()
        .map_err(|e| ApiError::ValidationError(e.to_string()))?;

    // TODO: Implement policy creation in PolicyEngine
    // For now, return success
    Ok(Json(serde_json::json!({
        "success": true,
        "policy_id": req.id,
        "message": "Policy created successfully"
    })))
}

/// Get policy by ID
#[utoipa::path(
    get,
    path = "/v1/policies/{policy_id}",
    params(
        ("policy_id" = String, Path, description = "Policy ID")
    ),
    responses(
        (status = 200, description = "Policy details"),
        (status = 404, description = "Policy not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "policies"
)]
pub async fn get_policy(
    State(_state): State<AppState>,
    axum::extract::Path(policy_id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>> {
    // TODO: Implement policy retrieval
    Err(ApiError::NotFound(format!(
        "Policy {} not found",
        policy_id
    )))
}

/// Delete policy
#[utoipa::path(
    delete,
    path = "/v1/policies/{policy_id}",
    params(
        ("policy_id" = String, Path, description = "Policy ID")
    ),
    responses(
        (status = 200, description = "Policy deleted successfully"),
        (status = 404, description = "Policy not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "policies"
)]
pub async fn delete_policy(
    State(_state): State<AppState>,
    axum::extract::Path(policy_id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>> {
    // TODO: Implement policy deletion
    Ok(Json(serde_json::json!({
        "success": true,
        "policy_id": policy_id,
        "message": "Policy deleted successfully"
    })))
}

/// Query audit logs
#[utoipa::path(
    post,
    path = "/v1/audit/query",
    request_body = AuditQueryRequest,
    responses(
        (status = 200, description = "Audit log entries", body = Vec<AuditLogEntry>),
        (status = 400, description = "Invalid request"),
        (status = 500, description = "Internal server error")
    ),
    tag = "audit"
)]
pub async fn query_audit_logs(
    State(_state): State<AppState>,
    Json(req): Json<AuditQueryRequest>,
) -> Result<Json<Vec<AuditLogEntry>>> {
    // Validate request
    req.validate()
        .map_err(|e| ApiError::ValidationError(e.to_string()))?;

    // TODO: Implement audit log querying
    // For now, return empty results
    Ok(Json(vec![]))
}

/// Get metrics (Prometheus format)
#[utoipa::path(
    get,
    path = "/metrics",
    responses(
        (status = 200, description = "Prometheus metrics", body = String)
    ),
    tag = "metrics"
)]
pub async fn prometheus_metrics(State(_state): State<AppState>) -> String {
    // TODO: Implement Prometheus metrics export
    // For now, return basic metrics
    r#"# HELP authz_decisions_total Total authorization decisions
# TYPE authz_decisions_total counter
authz_decisions_total{result="allowed"} 0
authz_decisions_total{result="denied"} 0

# HELP authz_decision_duration_seconds Authorization decision latency
# TYPE authz_decision_duration_seconds histogram
authz_decision_duration_seconds_bucket{le="0.001"} 0
authz_decision_duration_seconds_bucket{le="0.01"} 0
authz_decision_duration_seconds_bucket{le="0.1"} 0
authz_decision_duration_seconds_bucket{le="+Inf"} 0
authz_decision_duration_seconds_sum 0
authz_decision_duration_seconds_count 0

# HELP authz_cache_hits_total Cache hits
# TYPE authz_cache_hits_total counter
authz_cache_hits_total 0

# HELP authz_cache_misses_total Cache misses
# TYPE authz_cache_misses_total counter
authz_cache_misses_total 0
"#
    .to_string()
}

/// Get metrics summary
#[utoipa::path(
    get,
    path = "/v1/metrics",
    responses(
        (status = 200, description = "Metrics summary", body = MetricsResponse)
    ),
    tag = "metrics"
)]
pub async fn metrics_summary(State(_state): State<AppState>) -> Json<MetricsResponse> {
    // TODO: Get actual metrics from MetricsCollector
    Json(MetricsResponse {
        total_decisions: 0,
        allowed_decisions: 0,
        denied_decisions: 0,
        cache_hits: 0,
        cache_misses: 0,
        avg_latency_ms: 0.0,
    })
}
