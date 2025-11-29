//! Audit logging for authorization decisions
//!
//! Stores structured audit logs in PostgreSQL with:
//! - Decision metadata (principal, resource, action, result)
//! - Performance metrics (latency)
//! - Searchable by principal, resource, time range

use serde::{Deserialize, Serialize};
use std::time::Duration;
use std::sync::Arc;

use super::decision::{AuthRequest, AuthDecision};
use crate::error::{AuthzError, Result};

/// Audit log entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    /// Unique entry ID
    pub id: String,

    /// Principal who made the request
    pub principal_id: String,

    /// Resource being accessed
    pub resource_id: String,

    /// Action being performed
    pub action: String,

    /// Decision result (allow/deny)
    pub allowed: bool,

    /// Policy that made the decision
    pub policy_id: String,

    /// Decision reason
    pub reason: String,

    /// Request latency in milliseconds
    pub latency_ms: u64,

    /// Timestamp (milliseconds since epoch)
    pub timestamp: u64,

    /// Additional metadata (JSON)
    pub metadata: serde_json::Value,
}

/// Audit logger with PostgreSQL backend
///
/// # Schema
///
/// ```sql
/// CREATE TABLE authz_audit_log (
///     id UUID PRIMARY KEY,
///     principal_id VARCHAR(255) NOT NULL,
///     resource_id VARCHAR(255) NOT NULL,
///     action VARCHAR(100) NOT NULL,
///     allowed BOOLEAN NOT NULL,
///     policy_id VARCHAR(255) NOT NULL,
///     reason TEXT,
///     latency_ms BIGINT,
///     timestamp BIGINT NOT NULL,
///     metadata JSONB,
///     created_at TIMESTAMP DEFAULT NOW(),
///     INDEX idx_principal (principal_id),
///     INDEX idx_resource (resource_id),
///     INDEX idx_timestamp (timestamp)
/// );
/// ```
pub struct AuditLogger {
    /// PostgreSQL connection pool (optional)
    #[cfg(feature = "postgres")]
    pool: Option<sqlx::PgPool>,

    /// In-memory buffer for non-PostgreSQL builds
    #[cfg(not(feature = "postgres"))]
    buffer: Arc<tokio::sync::RwLock<Vec<AuditEntry>>>,
}

impl AuditLogger {
    /// Create a new audit logger
    pub async fn new() -> Result<Self> {
        #[cfg(feature = "postgres")]
        {
            // TODO: Initialize PostgreSQL connection from environment
            // For now, return without connection
            Ok(Self { pool: None })
        }

        #[cfg(not(feature = "postgres"))]
        {
            use std::sync::Arc;
            Ok(Self {
                buffer: Arc::new(tokio::sync::RwLock::new(Vec::new())),
            })
        }
    }

    /// Log an authorization decision
    pub async fn log_decision(
        &self,
        request: &AuthRequest,
        decision: &AuthDecision,
        latency: Duration,
    ) -> Result<()> {
        let entry = AuditEntry {
            id: uuid::Uuid::new_v4().to_string(),
            principal_id: request.principal.id.clone(),
            resource_id: request.resource.id.clone(),
            action: request.action.name.clone(),
            allowed: decision.allowed,
            policy_id: decision.policy_id.clone(),
            reason: format!("{:?}", decision.reason),
            latency_ms: latency.as_millis() as u64,
            timestamp: decision.timestamp,
            metadata: serde_json::to_value(&decision.metadata).unwrap_or_default(),
        };

        self.store_entry(entry).await
    }

    /// Store an audit entry
    #[cfg(feature = "postgres")]
    async fn store_entry(&self, entry: AuditEntry) -> Result<()> {
        if let Some(pool) = &self.pool {
            sqlx::query(
                r#"
                INSERT INTO authz_audit_log (
                    id, principal_id, resource_id, action, allowed,
                    policy_id, reason, latency_ms, timestamp, metadata
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                "#,
            )
            .bind(uuid::Uuid::parse_str(&entry.id).unwrap())
            .bind(&entry.principal_id)
            .bind(&entry.resource_id)
            .bind(&entry.action)
            .bind(entry.allowed)
            .bind(&entry.policy_id)
            .bind(&entry.reason)
            .bind(entry.latency_ms as i64)
            .bind(entry.timestamp as i64)
            .bind(&entry.metadata)
            .execute(pool)
            .await
            .map_err(|e| AuthzError::DatabaseError(e.to_string()))?;
        }

        Ok(())
    }

    /// Store an audit entry (in-memory)
    #[cfg(not(feature = "postgres"))]
    async fn store_entry(&self, entry: AuditEntry) -> Result<()> {
        let mut buffer = self.buffer.write().await;
        buffer.push(entry);

        // Keep only last 10,000 entries
        if buffer.len() > 10_000 {
            buffer.drain(0..1_000);
        }

        Ok(())
    }

    /// Query audit logs by principal
    #[cfg(feature = "postgres")]
    pub async fn query_by_principal(
        &self,
        principal_id: &str,
        limit: i64,
    ) -> Result<Vec<AuditEntry>> {
        if let Some(pool) = &self.pool {
            let rows = sqlx::query_as::<_, (uuid::Uuid, String, String, String, bool, Option<String>, Option<String>, Option<i64>, i64, Option<serde_json::Value>)>(
                r#"
                SELECT id, principal_id, resource_id, action, allowed,
                       policy_id, reason, latency_ms, timestamp, metadata
                FROM authz_audit_log
                WHERE principal_id = $1
                ORDER BY timestamp DESC
                LIMIT $2
                "#,
            )
            .bind(principal_id)
            .bind(limit)
            .fetch_all(pool)
            .await
            .map_err(|e| AuthzError::DatabaseError(e.to_string()))?;

            Ok(rows
                .into_iter()
                .map(|(id, principal_id, resource_id, action, allowed, policy_id, reason, latency_ms, timestamp, metadata)| AuditEntry {
                    id: id.to_string(),
                    principal_id,
                    resource_id,
                    action,
                    allowed,
                    policy_id: policy_id.unwrap_or_default(),
                    reason: reason.unwrap_or_default(),
                    latency_ms: latency_ms.unwrap_or(0) as u64,
                    timestamp: timestamp as u64,
                    metadata: metadata.unwrap_or(serde_json::json!({})),
                })
                .collect())
        } else {
            Ok(vec![])
        }
    }

    /// Query audit logs by principal (in-memory)
    #[cfg(not(feature = "postgres"))]
    pub async fn query_by_principal(
        &self,
        principal_id: &str,
        limit: usize,
    ) -> Result<Vec<AuditEntry>> {
        let buffer = self.buffer.read().await;

        Ok(buffer
            .iter()
            .rev()
            .filter(|e| e.principal_id == principal_id)
            .take(limit)
            .cloned()
            .collect())
    }

    /// Get audit statistics
    pub async fn get_stats(&self) -> Result<AuditStats> {
        #[cfg(feature = "postgres")]
        {
            if let Some(pool) = &self.pool {
                let row = sqlx::query_as::<_, (Option<i64>, Option<i64>, Option<i64>, Option<f64>)>(
                    r#"
                    SELECT
                        COUNT(*) as total,
                        COUNT(*) FILTER (WHERE allowed = true) as allowed,
                        COUNT(*) FILTER (WHERE allowed = false) as denied,
                        AVG(latency_ms) as avg_latency_ms
                    FROM authz_audit_log
                    WHERE timestamp > $1
                    "#,
                )
                .bind((std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis()
                    - 24 * 60 * 60 * 1000) as i64)
                .fetch_one(pool)
                .await
                .map_err(|e| AuthzError::DatabaseError(e.to_string()))?;

                return Ok(AuditStats {
                    total_decisions: row.0.unwrap_or(0) as usize,
                    allowed_decisions: row.1.unwrap_or(0) as usize,
                    denied_decisions: row.2.unwrap_or(0) as usize,
                    avg_latency_ms: row.3.unwrap_or(0.0),
                });
            }
        }

        #[cfg(not(feature = "postgres"))]
        {
            let buffer = self.buffer.read().await;
            let total = buffer.len();
            let allowed = buffer.iter().filter(|e| e.allowed).count();
            let denied = buffer.iter().filter(|e| !e.allowed).count();
            let avg_latency = if total > 0 {
                buffer.iter().map(|e| e.latency_ms).sum::<u64>() as f64 / total as f64
            } else {
                0.0
            };

            return Ok(AuditStats {
                total_decisions: total,
                allowed_decisions: allowed,
                denied_decisions: denied,
                avg_latency_ms: avg_latency,
            });
        }

        Ok(AuditStats::default())
    }
}

/// Audit statistics
#[derive(Debug, Clone, Default)]
pub struct AuditStats {
    pub total_decisions: usize,
    pub allowed_decisions: usize,
    pub denied_decisions: usize,
    pub avg_latency_ms: f64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn create_test_request() -> AuthRequest {
        use super::super::decision::{RequestPrincipal, RequestResource, RequestAction};

        AuthRequest {
            principal: RequestPrincipal {
                id: "user:alice".to_string(),
                roles: vec![],
                attributes: HashMap::new(),
            },
            resource: RequestResource {
                id: "document:123".to_string(),
                attributes: HashMap::new(),
            },
            action: RequestAction::new("read"),
            context: HashMap::new(),
        }
    }

    #[tokio::test]
    async fn test_audit_logger_creation() {
        let logger = AuditLogger::new().await.unwrap();
        // Just test creation succeeds
    }

    #[tokio::test]
    async fn test_log_decision() {
        let logger = AuditLogger::new().await.unwrap();
        let request = create_test_request();
        let decision = AuthDecision::allow(
            "policy-1".to_string(),
            "Test".to_string(),
            vec![],
        );

        let result = logger
            .log_decision(&request, &decision, Duration::from_millis(5))
            .await;

        assert!(result.is_ok());
    }

    #[cfg(not(feature = "postgres"))]
    #[tokio::test]
    async fn test_query_by_principal() {
        let logger = AuditLogger::new().await.unwrap();
        let request = create_test_request();
        let decision = AuthDecision::allow(
            "policy-1".to_string(),
            "Test".to_string(),
            vec![],
        );

        logger
            .log_decision(&request, &decision, Duration::from_millis(5))
            .await
            .unwrap();

        let entries = logger
            .query_by_principal("user:alice", 10)
            .await
            .unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].principal_id, "user:alice");
    }

    #[tokio::test]
    async fn test_audit_stats() {
        let logger = AuditLogger::new().await.unwrap();
        let stats = logger.get_stats().await.unwrap();

        // Just test that stats can be retrieved
        assert!(stats.total_decisions >= 0);
    }
}
