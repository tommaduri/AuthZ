//! PostgreSQL Phase 2 integration tests
//!
//! Tests derived roles CRUD, vector embedding storage, multi-tenancy,
//! RLS policy verification, and index usage.
//!
//! Note: Vector embedding tests are marked with #[ignore] as they require
//! pgvector extension to be installed.

use cretoai_authz::policy::PolicyEffect;
use cretoai_core::{CretoResult, TenantId};
use sqlx::{PgPool, Row};
use std::collections::HashSet;
use serde::{Deserialize, Serialize};

/// Role definition for testing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Role {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub permissions: HashSet<String>,
    pub inherits_from: Vec<String>,
    pub metadata: std::collections::HashMap<String, String>,
}

/// Helper to create a test database pool
async fn create_test_pool() -> CretoResult<PgPool> {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost/authz_test".to_string());

    let pool = PgPool::connect(&database_url).await?;
    Ok(pool)
}

/// Helper to clean up test data
async fn cleanup_test_data(pool: &PgPool, tenant_id: &str) -> CretoResult<()> {
    sqlx::query("DELETE FROM derived_roles WHERE tenant_id = $1")
        .bind(tenant_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[tokio::test]
#[ignore = "Requires PostgreSQL database"]
async fn test_derived_roles_crud_operations() -> CretoResult<()> {
    let pool = create_test_pool().await?;
    let tenant_id = "test_tenant_crud";

    // Cleanup before test
    cleanup_test_data(&pool, tenant_id).await?;

    // Create a role
    let role = Role {
        id: "test_role_1".to_string(),
        name: "Test Role 1".to_string(),
        description: Some("A test role for CRUD operations".to_string()),
        permissions: vec!["read:docs".to_string(), "write:docs".to_string()]
            .into_iter()
            .collect(),
        inherits_from: vec![],
        metadata: [("department".to_string(), "engineering".to_string())]
            .into_iter()
            .collect(),
    };

    // INSERT
    let permissions_json = serde_json::to_value(&role.permissions)?;
    let metadata_json = serde_json::to_value(&role.metadata)?;
    let inherits_from_json = serde_json::to_value(&role.inherits_from)?;

    sqlx::query(
        r#"
        INSERT INTO derived_roles (
            id, tenant_id, name, description, permissions, inherits_from, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(&role.id)
    .bind(tenant_id)
    .bind(&role.name)
    .bind(&role.description)
    .bind(&permissions_json)
    .bind(&inherits_from_json)
    .bind(&metadata_json)
    .execute(&pool)
    .await?;

    // READ
    let row = sqlx::query(
        r#"
        SELECT id, name, description, permissions, inherits_from, metadata
        FROM derived_roles
        WHERE id = $1 AND tenant_id = $2
        "#,
    )
    .bind(&role.id)
    .bind(tenant_id)
    .fetch_one(&pool)
    .await?;

    assert_eq!(row.get::<String, _>("id"), role.id);
    assert_eq!(row.get::<String, _>("name"), role.name);
    assert_eq!(row.get::<Option<String>, _>("description"), role.description);

    let stored_permissions: serde_json::Value = row.get("permissions");
    let stored_permissions_set: HashSet<String> = serde_json::from_value(stored_permissions)?;
    assert_eq!(stored_permissions_set, role.permissions);

    // UPDATE
    let updated_name = "Updated Test Role 1";
    sqlx::query(
        r#"
        UPDATE derived_roles
        SET name = $1, updated_at = NOW()
        WHERE id = $2 AND tenant_id = $3
        "#,
    )
    .bind(updated_name)
    .bind(&role.id)
    .bind(tenant_id)
    .execute(&pool)
    .await?;

    let updated_row = sqlx::query(
        r#"
        SELECT name FROM derived_roles
        WHERE id = $1 AND tenant_id = $2
        "#,
    )
    .bind(&role.id)
    .bind(tenant_id)
    .fetch_one(&pool)
    .await?;

    assert_eq!(updated_row.get::<String, _>("name"), updated_name);

    // DELETE
    let deleted = sqlx::query(
        r#"
        DELETE FROM derived_roles
        WHERE id = $1 AND tenant_id = $2
        "#,
    )
    .bind(&role.id)
    .bind(tenant_id)
    .execute(&pool)
    .await?;

    assert_eq!(deleted.rows_affected(), 1);

    // Verify deletion
    let count = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*) FROM derived_roles
        WHERE id = $1 AND tenant_id = $2
        "#,
    )
    .bind(&role.id)
    .bind(tenant_id)
    .fetch_one(&pool)
    .await?;

    assert_eq!(count, 0);

    cleanup_test_data(&pool, tenant_id).await?;
    Ok(())
}

#[tokio::test]
#[ignore = "Requires PostgreSQL with pgvector extension"]
async fn test_vector_embedding_storage() -> CretoResult<()> {
    let pool = create_test_pool().await?;
    let tenant_id = "test_tenant_vector";

    // Cleanup before test
    cleanup_test_data(&pool, tenant_id).await?;

    // Create a role with embedding
    let role_id = "test_role_vector";
    let embedding: Vec<f32> = vec![0.1, 0.2, 0.3, 0.4, 0.5]; // 5-dimensional embedding

    sqlx::query(
        r#"
        INSERT INTO derived_roles (
            id, tenant_id, name, permissions, embedding
        ) VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(role_id)
    .bind(tenant_id)
    .bind("Vector Test Role")
    .bind(serde_json::json!(["read:docs"]))
    .bind(&embedding)
    .execute(&pool)
    .await?;

    // Retrieve and verify embedding
    let row = sqlx::query(
        r#"
        SELECT embedding FROM derived_roles
        WHERE id = $1 AND tenant_id = $2
        "#,
    )
    .bind(role_id)
    .bind(tenant_id)
    .fetch_one(&pool)
    .await?;

    let stored_embedding: Vec<f32> = row.get("embedding");
    assert_eq!(stored_embedding, embedding);

    // Test vector similarity search (cosine similarity)
    let query_embedding = vec![0.15, 0.25, 0.35, 0.45, 0.55];

    let similar_roles = sqlx::query(
        r#"
        SELECT id, name, 1 - (embedding <=> $1) as similarity
        FROM derived_roles
        WHERE tenant_id = $2
        ORDER BY embedding <=> $1
        LIMIT 5
        "#,
    )
    .bind(&query_embedding)
    .bind(tenant_id)
    .fetch_all(&pool)
    .await?;

    assert!(!similar_roles.is_empty());
    assert_eq!(similar_roles[0].get::<String, _>("id"), role_id);

    cleanup_test_data(&pool, tenant_id).await?;
    Ok(())
}

#[tokio::test]
#[ignore = "Requires PostgreSQL database"]
async fn test_multi_tenancy_isolation() -> CretoResult<()> {
    let pool = create_test_pool().await?;
    let tenant1_id = "tenant1_isolation";
    let tenant2_id = "tenant2_isolation";

    // Cleanup before test
    cleanup_test_data(&pool, tenant1_id).await?;
    cleanup_test_data(&pool, tenant2_id).await?;

    // Create roles for tenant 1
    sqlx::query(
        r#"
        INSERT INTO derived_roles (id, tenant_id, name, permissions)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind("role_tenant1_1")
    .bind(tenant1_id)
    .bind("Tenant 1 Role 1")
    .bind(serde_json::json!(["tenant1:read"]))
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO derived_roles (id, tenant_id, name, permissions)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind("role_tenant1_2")
    .bind(tenant1_id)
    .bind("Tenant 1 Role 2")
    .bind(serde_json::json!(["tenant1:write"]))
    .execute(&pool)
    .await?;

    // Create roles for tenant 2
    sqlx::query(
        r#"
        INSERT INTO derived_roles (id, tenant_id, name, permissions)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind("role_tenant2_1")
    .bind(tenant2_id)
    .bind("Tenant 2 Role 1")
    .bind(serde_json::json!(["tenant2:read"]))
    .execute(&pool)
    .await?;

    // Query tenant 1 roles
    let tenant1_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM derived_roles WHERE tenant_id = $1",
    )
    .bind(tenant1_id)
    .fetch_one(&pool)
    .await?;

    assert_eq!(tenant1_count, 2, "Tenant 1 should have 2 roles");

    // Query tenant 2 roles
    let tenant2_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM derived_roles WHERE tenant_id = $1",
    )
    .bind(tenant2_id)
    .fetch_one(&pool)
    .await?;

    assert_eq!(tenant2_count, 1, "Tenant 2 should have 1 role");

    // Verify tenant 1 cannot see tenant 2 roles
    let cross_tenant_count = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*) FROM derived_roles
        WHERE tenant_id = $1 AND id LIKE 'role_tenant2_%'
        "#,
    )
    .bind(tenant1_id)
    .fetch_one(&pool)
    .await?;

    assert_eq!(cross_tenant_count, 0, "Tenant 1 should not see tenant 2 roles");

    cleanup_test_data(&pool, tenant1_id).await?;
    cleanup_test_data(&pool, tenant2_id).await?;
    Ok(())
}

#[tokio::test]
#[ignore = "Requires PostgreSQL database with RLS enabled"]
async fn test_rls_policy_verification() -> CretoResult<()> {
    let pool = create_test_pool().await?;
    let tenant_id = "tenant_rls_test";

    // Cleanup before test
    cleanup_test_data(&pool, tenant_id).await?;

    // Enable RLS on derived_roles table (if not already enabled)
    sqlx::query("ALTER TABLE derived_roles ENABLE ROW LEVEL SECURITY")
        .execute(&pool)
        .await
        .ok(); // Ignore error if already enabled

    // Create a policy for tenant isolation
    sqlx::query(
        r#"
        CREATE POLICY tenant_isolation_policy ON derived_roles
        FOR ALL
        USING (tenant_id = current_setting('app.current_tenant')::TEXT)
        "#,
    )
    .execute(&pool)
    .await
    .ok(); // Ignore error if policy already exists

    // Set tenant context
    sqlx::query("SET app.current_tenant = $1")
        .bind(tenant_id)
        .execute(&pool)
        .await?;

    // Insert role within tenant context
    sqlx::query(
        r#"
        INSERT INTO derived_roles (id, tenant_id, name, permissions)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind("rls_test_role")
    .bind(tenant_id)
    .bind("RLS Test Role")
    .bind(serde_json::json!(["rls:test"]))
    .execute(&pool)
    .await?;

    // Query should only see roles for current tenant
    let roles = sqlx::query(
        "SELECT id FROM derived_roles WHERE id = 'rls_test_role'"
    )
    .fetch_all(&pool)
    .await?;

    assert_eq!(roles.len(), 1, "Should see role for current tenant");

    // Change tenant context
    sqlx::query("SET app.current_tenant = 'different_tenant'")
        .execute(&pool)
        .await?;

    // Query should not see roles from different tenant
    let roles = sqlx::query(
        "SELECT id FROM derived_roles WHERE id = 'rls_test_role'"
    )
    .fetch_all(&pool)
    .await?;

    assert_eq!(roles.len(), 0, "Should not see role from different tenant");

    // Reset tenant context and cleanup
    sqlx::query("SET app.current_tenant = $1")
        .bind(tenant_id)
        .execute(&pool)
        .await?;

    cleanup_test_data(&pool, tenant_id).await?;

    // Drop the policy
    sqlx::query("DROP POLICY IF EXISTS tenant_isolation_policy ON derived_roles")
        .execute(&pool)
        .await
        .ok();

    Ok(())
}

#[tokio::test]
#[ignore = "Requires PostgreSQL database"]
async fn test_index_usage_verification() -> CretoResult<()> {
    let pool = create_test_pool().await?;
    let tenant_id = "tenant_index_test";

    // Cleanup before test
    cleanup_test_data(&pool, tenant_id).await?;

    // Insert multiple roles
    for i in 0..100 {
        sqlx::query(
            r#"
            INSERT INTO derived_roles (id, tenant_id, name, permissions)
            VALUES ($1, $2, $3, $4)
            "#,
        )
        .bind(format!("role_{}", i))
        .bind(tenant_id)
        .bind(format!("Role {}", i))
        .bind(serde_json::json!(["read:docs"]))
        .execute(&pool)
        .await?;
    }

    // Analyze query plan for tenant_id index usage
    let explain_result = sqlx::query(
        r#"
        EXPLAIN (FORMAT JSON)
        SELECT * FROM derived_roles WHERE tenant_id = $1
        "#,
    )
    .bind(tenant_id)
    .fetch_one(&pool)
    .await?;

    let plan: serde_json::Value = explain_result.get(0);
    let plan_str = plan.to_string();

    // Verify index is being used
    assert!(
        plan_str.contains("Index") || plan_str.contains("Bitmap"),
        "Query should use index for tenant_id lookup"
    );

    // Analyze query plan for id lookup
    let explain_id = sqlx::query(
        r#"
        EXPLAIN (FORMAT JSON)
        SELECT * FROM derived_roles WHERE id = $1 AND tenant_id = $2
        "#,
    )
    .bind("role_0")
    .bind(tenant_id)
    .fetch_one(&pool)
    .await?;

    let id_plan: serde_json::Value = explain_id.get(0);
    let id_plan_str = id_plan.to_string();

    // Verify composite index or primary key is being used
    assert!(
        id_plan_str.contains("Index") && id_plan_str.contains("Scan"),
        "Query should use index for (id, tenant_id) lookup"
    );

    cleanup_test_data(&pool, tenant_id).await?;
    Ok(())
}

#[tokio::test]
#[ignore = "Requires PostgreSQL database"]
async fn test_role_inheritance_storage() -> CretoResult<()> {
    let pool = create_test_pool().await?;
    let tenant_id = "tenant_inheritance_test";

    // Cleanup before test
    cleanup_test_data(&pool, tenant_id).await?;

    // Create parent role
    sqlx::query(
        r#"
        INSERT INTO derived_roles (id, tenant_id, name, permissions, inherits_from)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind("parent_role")
    .bind(tenant_id)
    .bind("Parent Role")
    .bind(serde_json::json!(["parent:permission"]))
    .bind(serde_json::json!([]))
    .execute(&pool)
    .await?;

    // Create child role that inherits from parent
    sqlx::query(
        r#"
        INSERT INTO derived_roles (id, tenant_id, name, permissions, inherits_from)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind("child_role")
    .bind(tenant_id)
    .bind("Child Role")
    .bind(serde_json::json!(["child:permission"]))
    .bind(serde_json::json!(["parent_role"]))
    .execute(&pool)
    .await?;

    // Retrieve child role and verify inheritance
    let row = sqlx::query(
        r#"
        SELECT inherits_from FROM derived_roles
        WHERE id = $1 AND tenant_id = $2
        "#,
    )
    .bind("child_role")
    .bind(tenant_id)
    .fetch_one(&pool)
    .await?;

    let inherits_from: Vec<String> = serde_json::from_value(row.get("inherits_from"))?;
    assert_eq!(inherits_from, vec!["parent_role"]);

    cleanup_test_data(&pool, tenant_id).await?;
    Ok(())
}
