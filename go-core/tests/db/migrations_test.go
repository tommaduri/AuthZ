// Package db_test provides migration tests
package db_test

import (
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"authz-engine/internal/db"
)

// Test database configuration
const (
	testDBHost     = "localhost"
	testDBPort     = "5432"
	testDBUser     = "postgres"
	testDBPassword = "postgres"
	testDBName     = "authz_test"
)

// setupTestDB creates a test database connection
func setupTestDB(t *testing.T) *sql.DB {
	t.Helper()

	// Connect to postgres database to create test database
	connStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=postgres sslmode=disable",
		testDBHost, testDBPort, testDBUser, testDBPassword)

	adminDB, err := sql.Open("postgres", connStr)
	require.NoError(t, err)
	defer adminDB.Close()

	// Drop test database if exists
	_, err = adminDB.Exec(fmt.Sprintf("DROP DATABASE IF EXISTS %s", testDBName))
	require.NoError(t, err)

	// Create test database
	_, err = adminDB.Exec(fmt.Sprintf("CREATE DATABASE %s", testDBName))
	require.NoError(t, err)

	// Connect to test database
	testConnStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		testDBHost, testDBPort, testDBUser, testDBPassword, testDBName)

	testDB, err := sql.Open("postgres", testConnStr)
	require.NoError(t, err)

	return testDB
}

// teardownTestDB cleans up test database
func teardownTestDB(t *testing.T, testDB *sql.DB) {
	t.Helper()

	testDB.Close()

	// Connect to postgres database to drop test database
	connStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=postgres sslmode=disable",
		testDBHost, testDBPort, testDBUser, testDBPassword)

	adminDB, err := sql.Open("postgres", connStr)
	require.NoError(t, err)
	defer adminDB.Close()

	_, err = adminDB.Exec(fmt.Sprintf("DROP DATABASE IF EXISTS %s", testDBName))
	require.NoError(t, err)
}

func TestMigrations_UpDown(t *testing.T) {
	testDB := setupTestDB(t)
	defer teardownTestDB(t, testDB)

	// Create migration runner
	runner, err := db.NewMigrationRunner(testDB)
	require.NoError(t, err)
	defer runner.Close()

	// Test: Run migrations up
	t.Run("MigrationsUp", func(t *testing.T) {
		err := runner.Up()
		assert.NoError(t, err)

		// Verify tables exist
		tables := []string{"api_keys", "refresh_tokens", "auth_audit_logs", "rate_limit_state"}
		for _, table := range tables {
			var exists bool
			err := testDB.QueryRow(`
				SELECT EXISTS (
					SELECT FROM information_schema.tables
					WHERE table_schema = 'public'
					AND table_name = $1
				)
			`, table).Scan(&exists)
			require.NoError(t, err)
			assert.True(t, exists, "Table %s should exist", table)
		}
	})

	// Test: Check migration version
	t.Run("CheckVersion", func(t *testing.T) {
		version, dirty, err := runner.Version()
		assert.NoError(t, err)
		assert.False(t, dirty, "Database should not be in dirty state")
		assert.Greater(t, version, uint(0), "Version should be greater than 0")
	})

	// Test: Run migrations down
	t.Run("MigrationsDown", func(t *testing.T) {
		// Roll back all migrations
		for i := 0; i < 10; i++ { // Max 10 iterations to prevent infinite loop
			err := runner.Down()
			if err != nil {
				break
			}
		}

		// Verify tables don't exist
		tables := []string{"api_keys", "refresh_tokens", "auth_audit_logs", "rate_limit_state"}
		for _, table := range tables {
			var exists bool
			err := testDB.QueryRow(`
				SELECT EXISTS (
					SELECT FROM information_schema.tables
					WHERE table_schema = 'public'
					AND table_name = $1
				)
			`, table).Scan(&exists)
			require.NoError(t, err)
			assert.False(t, exists, "Table %s should not exist after rollback", table)
		}
	})
}

func TestMigrations_Indexes(t *testing.T) {
	testDB := setupTestDB(t)
	defer teardownTestDB(t, testDB)

	runner, err := db.NewMigrationRunner(testDB)
	require.NoError(t, err)
	defer runner.Close()

	// Run all migrations
	err = runner.Up()
	require.NoError(t, err)

	// Test: Verify indexes exist
	t.Run("VerifyIndexes", func(t *testing.T) {
		expectedIndexes := []string{
			"idx_api_keys_key_hash",
			"idx_api_keys_agent_id",
			"idx_api_keys_tenant_id",
			"idx_api_keys_scopes",
			"idx_refresh_tokens_token_hash",
			"idx_refresh_tokens_user_id",
			"idx_auth_audit_logs_timestamp",
			"idx_auth_audit_logs_tenant_id",
		}

		for _, indexName := range expectedIndexes {
			var exists bool
			err := testDB.QueryRow(`
				SELECT EXISTS (
					SELECT FROM pg_indexes
					WHERE schemaname = 'public'
					AND indexname = $1
				)
			`, indexName).Scan(&exists)
			require.NoError(t, err)
			assert.True(t, exists, "Index %s should exist", indexName)
		}
	})

	// Test: Verify GIN indexes for JSONB columns
	t.Run("VerifyGINIndexes", func(t *testing.T) {
		var count int
		err := testDB.QueryRow(`
			SELECT COUNT(*)
			FROM pg_indexes
			WHERE schemaname = 'public'
			AND indexdef LIKE '%USING gin%'
			AND (indexname LIKE '%scopes%' OR indexname LIKE '%metadata%')
		`).Scan(&count)
		require.NoError(t, err)
		assert.Greater(t, count, 0, "Should have GIN indexes for JSONB columns")
	})
}

func TestMigrations_RLS(t *testing.T) {
	testDB := setupTestDB(t)
	defer teardownTestDB(t, testDB)

	runner, err := db.NewMigrationRunner(testDB)
	require.NoError(t, err)
	defer runner.Close()

	err = runner.Up()
	require.NoError(t, err)

	// Test: Verify RLS is enabled
	t.Run("VerifyRLSEnabled", func(t *testing.T) {
		tables := []string{"api_keys", "refresh_tokens", "auth_audit_logs", "rate_limit_state"}

		for _, table := range tables {
			var rlsEnabled bool
			err := testDB.QueryRow(`
				SELECT relrowsecurity
				FROM pg_class
				WHERE relname = $1
			`, table).Scan(&rlsEnabled)
			require.NoError(t, err)
			assert.True(t, rlsEnabled, "RLS should be enabled for %s", table)
		}
	})

	// Test: Verify RLS policies exist
	t.Run("VerifyRLSPolicies", func(t *testing.T) {
		var policyCount int
		err := testDB.QueryRow(`
			SELECT COUNT(*)
			FROM pg_policies
			WHERE schemaname = 'public'
		`).Scan(&policyCount)
		require.NoError(t, err)
		assert.Greater(t, policyCount, 0, "Should have RLS policies")
	})

	// Test: RLS tenant isolation
	t.Run("TestTenantIsolation", func(t *testing.T) {
		tenantA := "tenant-a"
		tenantB := "tenant-b"

		// Insert test data for tenant A
		err := db.WithTenant(testDB, tenantA, func(dbConn *sql.DB) error {
			_, err := dbConn.Exec(`
				INSERT INTO api_keys (key_hash, name, agent_id, tenant_id)
				VALUES ('hash-a', 'Key A', 'agent-a', $1)
			`, tenantA)
			return err
		})
		require.NoError(t, err)

		// Insert test data for tenant B
		err = db.WithTenant(testDB, tenantB, func(dbConn *sql.DB) error {
			_, err := dbConn.Exec(`
				INSERT INTO api_keys (key_hash, name, agent_id, tenant_id)
				VALUES ('hash-b', 'Key B', 'agent-b', $1)
			`, tenantB)
			return err
		})
		require.NoError(t, err)

		// Verify tenant A can only see their data
		err = db.WithTenant(testDB, tenantA, func(dbConn *sql.DB) error {
			var count int
			err := dbConn.QueryRow("SELECT COUNT(*) FROM api_keys").Scan(&count)
			require.NoError(t, err)
			assert.Equal(t, 1, count, "Tenant A should only see 1 record")
			return nil
		})
		require.NoError(t, err)

		// Verify tenant B can only see their data
		err = db.WithTenant(testDB, tenantB, func(dbConn *sql.DB) error {
			var count int
			err := dbConn.QueryRow("SELECT COUNT(*) FROM api_keys").Scan(&count)
			require.NoError(t, err)
			assert.Equal(t, 1, count, "Tenant B should only see 1 record")
			return nil
		})
		require.NoError(t, err)
	})
}

func TestMigrations_SchemaConstraints(t *testing.T) {
	testDB := setupTestDB(t)
	defer teardownTestDB(t, testDB)

	runner, err := db.NewMigrationRunner(testDB)
	require.NoError(t, err)
	defer runner.Close()

	err = runner.Up()
	require.NoError(t, err)

	tenantID := "test-tenant"
	err = db.SetTenant(testDB, tenantID)
	require.NoError(t, err)
	defer db.ResetTenant(testDB)

	// Test: Unique constraints
	t.Run("UniqueConstraints", func(t *testing.T) {
		keyHash := "unique-hash"

		// Insert first record
		_, err := testDB.Exec(`
			INSERT INTO api_keys (key_hash, name, agent_id, tenant_id)
			VALUES ($1, 'Key 1', 'agent-1', $2)
		`, keyHash, tenantID)
		require.NoError(t, err)

		// Try to insert duplicate key_hash
		_, err = testDB.Exec(`
			INSERT INTO api_keys (key_hash, name, agent_id, tenant_id)
			VALUES ($1, 'Key 2', 'agent-2', $2)
		`, keyHash, tenantID)
		assert.Error(t, err, "Should fail on duplicate key_hash")
	})

	// Test: Check constraints
	t.Run("CheckConstraints", func(t *testing.T) {
		// Test rate limit check constraint (should fail for invalid RPS)
		_, err := testDB.Exec(`
			INSERT INTO api_keys (key_hash, name, agent_id, tenant_id, rate_limit_rps)
			VALUES ('hash-invalid-rps', 'Key', 'agent', $1, 20000)
		`, tenantID)
		assert.Error(t, err, "Should fail for rate_limit_rps > 10000")

		// Test empty name constraint
		_, err = testDB.Exec(`
			INSERT INTO api_keys (key_hash, name, agent_id, tenant_id)
			VALUES ('hash-empty-name', '', 'agent', $1)
		`, tenantID)
		assert.Error(t, err, "Should fail for empty name")
	})

	// Test: Foreign key constraints
	t.Run("ForeignKeyConstraints", func(t *testing.T) {
		parentID := uuid.New()
		childTokenHash := "child-token-hash"

		// Insert parent token
		_, err := testDB.Exec(`
			INSERT INTO refresh_tokens (id, token_hash, user_id, expires_at, tenant_id)
			VALUES ($1, 'parent-token-hash', 'user-1', $2, $3)
		`, parentID, time.Now().Add(24*time.Hour), tenantID)
		require.NoError(t, err)

		// Insert child token with valid parent_token_id
		_, err = testDB.Exec(`
			INSERT INTO refresh_tokens (token_hash, user_id, expires_at, tenant_id, parent_token_id)
			VALUES ($1, 'user-1', $2, $3, $4)
		`, childTokenHash, time.Now().Add(24*time.Hour), tenantID, parentID)
		assert.NoError(t, err, "Should succeed with valid parent_token_id")

		// Try to insert with invalid parent_token_id
		invalidParentID := uuid.New()
		_, err = testDB.Exec(`
			INSERT INTO refresh_tokens (token_hash, user_id, expires_at, tenant_id, parent_token_id)
			VALUES ('invalid-parent-token', 'user-2', $1, $2, $3)
		`, time.Now().Add(24*time.Hour), tenantID, invalidParentID)
		assert.Error(t, err, "Should fail with invalid parent_token_id")
	})
}

func TestMigrations_Performance(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping performance test in short mode")
	}

	testDB := setupTestDB(t)
	defer teardownTestDB(t, testDB)

	runner, err := db.NewMigrationRunner(testDB)
	require.NoError(t, err)
	defer runner.Close()

	err = runner.Up()
	require.NoError(t, err)

	tenantID := "perf-tenant"
	err = db.SetTenant(testDB, tenantID)
	require.NoError(t, err)
	defer db.ResetTenant(testDB)

	// Test: Query performance with indexes
	t.Run("IndexedQueryPerformance", func(t *testing.T) {
		// Insert test data
		for i := 0; i < 1000; i++ {
			_, err := testDB.Exec(`
				INSERT INTO api_keys (key_hash, name, agent_id, tenant_id)
				VALUES ($1, $2, $3, $4)
			`, fmt.Sprintf("hash-%d", i), fmt.Sprintf("Key %d", i), "agent-1", tenantID)
			require.NoError(t, err)
		}

		// Measure query time
		start := time.Now()
		var count int
		err := testDB.QueryRow(`
			SELECT COUNT(*) FROM api_keys
			WHERE tenant_id = $1 AND agent_id = 'agent-1'
		`, tenantID).Scan(&count)
		duration := time.Since(start)

		require.NoError(t, err)
		assert.Equal(t, 1000, count)
		assert.Less(t, duration.Milliseconds(), int64(5), "Query should complete in <5ms with indexes")
	})
}
