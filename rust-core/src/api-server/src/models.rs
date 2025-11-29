use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use validator::Validate;

/// Authorization check request
#[derive(Debug, Clone, Serialize, Deserialize, Validate, ToSchema)]
pub struct AuthzCheckRequest {
    /// Principal (user) identifier
    #[validate(length(min = 1, max = 255))]
    pub principal_id: String,

    /// Resource identifier
    #[validate(length(min = 1, max = 255))]
    pub resource_id: String,

    /// Action to perform
    #[validate(length(min = 1, max = 100))]
    pub action: String,

    /// Optional context for condition evaluation
    #[serde(default)]
    pub context: serde_json::Value,
}

/// Authorization check response
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct AuthzCheckResponse {
    /// Whether the action is allowed
    pub allowed: bool,

    /// Reason for the decision
    pub reason: String,

    /// Policy ID that made the decision
    pub policy_id: Option<String>,

    /// Decision latency in milliseconds
    pub latency_ms: u64,
}

/// Policy creation/update request
#[derive(Debug, Clone, Serialize, Deserialize, Validate, ToSchema)]
pub struct PolicyRequest {
    /// Policy ID
    #[validate(length(min = 1, max = 255))]
    pub id: String,

    /// Policy version
    #[validate(length(min = 1, max = 50))]
    pub version: String,

    /// Policy effect (allow/deny)
    pub effect: PolicyEffect,

    /// Principals this policy applies to
    pub principals: Vec<String>,

    /// Resources this policy applies to
    pub resources: Vec<String>,

    /// Actions this policy permits
    pub actions: Vec<String>,

    /// Optional condition (CEL expression)
    pub condition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum PolicyEffect {
    Allow,
    Deny,
}

/// Audit log query request
#[derive(Debug, Clone, Serialize, Deserialize, Validate, ToSchema)]
pub struct AuditQueryRequest {
    /// Principal ID to filter by
    pub principal_id: Option<String>,

    /// Resource ID to filter by
    pub resource_id: Option<String>,

    /// Maximum number of results
    #[validate(range(min = 1, max = 1000))]
    #[serde(default = "default_limit")]
    pub limit: usize,

    /// Start time (ISO 8601)
    pub start_time: Option<String>,

    /// End time (ISO 8601)
    pub end_time: Option<String>,
}

fn default_limit() -> usize {
    100
}

/// Audit log entry response
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct AuditLogEntry {
    pub id: String,
    pub principal_id: String,
    pub resource_id: String,
    pub action: String,
    pub allowed: bool,
    pub policy_id: String,
    pub reason: String,
    pub latency_ms: u64,
    pub timestamp: u64,
    pub metadata: serde_json::Value,
}

/// Metrics response
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct MetricsResponse {
    pub total_decisions: usize,
    pub allowed_decisions: usize,
    pub denied_decisions: usize,
    pub cache_hits: usize,
    pub cache_misses: usize,
    pub avg_latency_ms: f64,
}
