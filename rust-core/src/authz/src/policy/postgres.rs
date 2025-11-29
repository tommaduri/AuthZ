//! PostgreSQL policy store implementation

use crate::error::{AuthzError, Result};
use crate::policy::{Policy, PolicyStore};
use crate::types::AuthzRequest;
use async_trait::async_trait;
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::Row;
use std::time::Duration;

/// PostgreSQL policy store with connection pooling
pub struct PostgresPolicyStore {
    pool: PgPool,
    tenant_id: String,
}

impl PostgresPolicyStore {
    /// Create a new PostgreSQL policy store
    ///
    /// # Arguments
    /// * `database_url` - PostgreSQL connection string
    /// * `tenant_id` - Tenant identifier for multi-tenancy
    ///
    /// # Example
    /// ```no_run
    /// use cretoai_authz::policy::PostgresPolicyStore;
    ///
    /// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
    /// let store = PostgresPolicyStore::new(
    ///     "postgresql://user:pass@localhost/authz",
    ///     "default"
    /// ).await?;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn new(database_url: &str, tenant_id: &str) -> Result<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(25)
            .min_connections(5)
            .acquire_timeout(Duration::from_secs(3))
            .idle_timeout(Duration::from_secs(600))
            .max_lifetime(Duration::from_secs(1800))
            .connect(database_url)
            .await
            .map_err(|e| AuthzError::DatabaseError(format!("Failed to connect to database: {}", e)))?;

        Ok(Self {
            pool,
            tenant_id: tenant_id.to_string(),
        })
    }

    /// Run database migrations
    pub async fn run_migrations(&self) -> Result<()> {
        sqlx::migrate!("./migrations")
            .run(&self.pool)
            .await
            .map_err(|e| AuthzError::DatabaseError(format!("Migration failed: {}", e)))?;
        Ok(())
    }

    /// Get database pool for advanced queries
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }
}

#[async_trait]
impl PolicyStore for PostgresPolicyStore {
    async fn get(&self, id: &str) -> Result<Option<Policy>> {
        let result = sqlx::query(
            "SELECT definition FROM policies WHERE name = $1 AND tenant_id = $2 AND enabled = true"
        )
        .bind(id)
        .bind(&self.tenant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| AuthzError::DatabaseError(format!("Failed to get policy: {}", e)))?;

        if let Some(row) = result {
            let definition: serde_json::Value = row.try_get("definition")
                .map_err(|e| AuthzError::DatabaseError(format!("Failed to parse policy: {}", e)))?;

            let policy: Policy = serde_json::from_value(definition)
                .map_err(|e| AuthzError::DatabaseError(format!("Failed to deserialize policy: {}", e)))?;

            Ok(Some(policy))
        } else {
            Ok(None)
        }
    }

    async fn put(&self, policy: Policy) -> Result<()> {
        let definition = serde_json::to_value(&policy)
            .map_err(|e| AuthzError::DatabaseError(format!("Failed to serialize policy: {}", e)))?;

        sqlx::query(
            r#"
            INSERT INTO policies (name, definition, enabled, priority, tenant_id, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            ON CONFLICT (name, tenant_id)
            DO UPDATE SET
                definition = EXCLUDED.definition,
                priority = EXCLUDED.priority,
                updated_at = NOW()
            "#
        )
        .bind(&policy.name)
        .bind(&definition)
        .bind(true)
        .bind(policy.priority)
        .bind(&self.tenant_id)
        .execute(&self.pool)
        .await
        .map_err(|e| AuthzError::DatabaseError(format!("Failed to insert/update policy: {}", e)))?;

        Ok(())
    }

    async fn list(&self) -> Result<Vec<Policy>> {
        let rows = sqlx::query(
            "SELECT definition FROM policies WHERE tenant_id = $1 AND enabled = true ORDER BY priority DESC"
        )
        .bind(&self.tenant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AuthzError::DatabaseError(format!("Failed to list policies: {}", e)))?;

        let mut policies = Vec::new();
        for row in rows {
            let definition: serde_json::Value = row.try_get("definition")
                .map_err(|e| AuthzError::DatabaseError(format!("Failed to parse policy: {}", e)))?;

            let policy: Policy = serde_json::from_value(definition)
                .map_err(|e| AuthzError::DatabaseError(format!("Failed to deserialize policy: {}", e)))?;

            policies.push(policy);
        }

        Ok(policies)
    }

    async fn delete(&self, id: &str) -> Result<()> {
        sqlx::query(
            "UPDATE policies SET enabled = false, updated_at = NOW() WHERE name = $1 AND tenant_id = $2"
        )
        .bind(id)
        .bind(&self.tenant_id)
        .execute(&self.pool)
        .await
        .map_err(|e| AuthzError::DatabaseError(format!("Failed to delete policy: {}", e)))?;

        Ok(())
    }

    async fn find_matching(&self, request: &AuthzRequest) -> Result<Vec<Policy>> {
        // For now, fetch all policies and filter in memory
        // TODO: Optimize with PostgreSQL pattern matching and indexing
        let all_policies = self.list().await?;

        let mut matching: Vec<Policy> = all_policies
            .into_iter()
            .filter(|p| p.matches(request))
            .collect();

        // Sort by priority (descending)
        matching.sort_by(|a, b| b.priority.cmp(&a.priority));

        Ok(matching)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Principal, Resource, Action};
    use crate::policy::PolicyEffect;
    use std::collections::HashMap;

    // Integration tests require a running PostgreSQL instance
    // Run with: docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=test postgres:15

    #[tokio::test]
    #[ignore] // Requires PostgreSQL
    async fn test_postgres_store_lifecycle() {
        let database_url = std::env::var("TEST_DATABASE_URL")
            .unwrap_or_else(|_| "postgresql://postgres:test@localhost:5432/authz_test".to_string());

        let store = PostgresPolicyStore::new(&database_url, "test-tenant").await.unwrap();
        store.run_migrations().await.unwrap();

        let policy = Policy {
            id: "policy-1".to_string(),
            name: "Test policy".to_string(),
            effect: PolicyEffect::Allow,
            principal: "user:*".to_string(),
            resource: "document:*".to_string(),
            action: "read".to_string(),
            condition: None,
            priority: 100,
        };

        // Test put
        store.put(policy.clone()).await.unwrap();

        // Test get
        let retrieved = store.get("policy-1").await.unwrap();
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().id, "policy-1");

        // Test list
        let all = store.list().await.unwrap();
        assert!(!all.is_empty());

        // Test find_matching
        let request = AuthzRequest {
            principal: Principal::new("user:alice@example.com"),
            resource: Resource::new("document:123"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let matching = store.find_matching(&request).await.unwrap();
        assert!(!matching.is_empty());

        // Test delete
        store.delete("policy-1").await.unwrap();
        let deleted = store.get("policy-1").await.unwrap();
        assert!(deleted.is_none());
    }
}
