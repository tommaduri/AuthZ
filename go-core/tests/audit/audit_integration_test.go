package audit_test

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/audit"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	_ "github.com/lib/pq"
)

// getTestDB creates a test database connection
func getTestDB(t *testing.T) *sql.DB {
	dsn := "postgres://postgres:postgres@localhost:5432/authz_test?sslmode=disable"
	db, err := sql.Open("postgres", dsn)
	require.NoError(t, err)

	err = db.Ping()
	if err != nil {
		t.Skipf("Skipping integration test: cannot connect to test database: %v", err)
	}

	return db
}

// cleanupTestDB removes all audit logs
func cleanupTestDB(t *testing.T, db *sql.DB) {
	_, err := db.Exec("DELETE FROM auth_audit_logs")
	require.NoError(t, err)
}

func TestIntegration_CompleteAuthFlow(t *testing.T) {
	db := getTestDB(t)
	defer db.Close()
	defer cleanupTestDB(t, db)

	logger, err := audit.NewLogger(&audit.Config{
		DB:            db,
		FlushInterval: 100 * time.Millisecond,
	})
	require.NoError(t, err)
	defer logger.Close()

	ctx := context.Background()
	tenantID := "tenant-integration-1"
	userID := "user-integration-123"

	// Simulate complete authentication flow

	// 1. Login attempt (success)
	loginEvent := types.NewAuditEventBuilder(
		types.EventAuthLoginSuccess,
		userID,
		tenantID,
	).
		WithRequestContext("192.168.1.100", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)").
		WithRequestID("req-login-001").
		WithSuccess(true).
		WithMetadata("login_method", "password").
		Build()

	err = logger.LogSync(ctx, loginEvent)
	require.NoError(t, err)

	// 2. Token issuance
	tokenEvent := types.NewAuditEventBuilder(
		types.EventAuthTokenIssued,
		userID,
		tenantID,
	).
		WithRequestContext("192.168.1.100", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)").
		WithRequestID("req-login-001").
		WithSuccess(true).
		WithMetadata("token_type", "access").
		WithMetadata("expires_in", 3600).
		Build()

	err = logger.LogSync(ctx, tokenEvent)
	require.NoError(t, err)

	// 3. Token validation (multiple times)
	for i := 0; i < 3; i++ {
		validationEvent := types.NewAuditEventBuilder(
			types.EventAuthTokenValidated,
			userID,
			tenantID,
		).
			WithRequestContext("192.168.1.100", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)").
			WithRequestID("req-api-"+string(rune(i))).
			WithSuccess(true).
			WithMetadata("endpoint", "/api/users").
			Build()

		err = logger.LogSync(ctx, validationEvent)
		require.NoError(t, err)
	}

	// 4. Logout
	logoutEvent := types.NewAuditEventBuilder(
		types.EventAuthLogout,
		userID,
		tenantID,
	).
		WithRequestContext("192.168.1.100", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)").
		WithRequestID("req-logout-001").
		WithSuccess(true).
		Build()

	err = logger.LogSync(ctx, logoutEvent)
	require.NoError(t, err)

	// Verify all events were logged
	query := &types.AuditQuery{
		TenantID: &tenantID,
		Limit:    100,
		SortBy:   "timestamp",
		SortOrder: "asc",
	}

	result, err := logger.Query(ctx, query)
	require.NoError(t, err)
	assert.Equal(t, 6, len(result.Events)) // login + token + 3 validations + logout

	// Verify hash chain integrity
	startTime := time.Now().Add(-1 * time.Hour)
	endTime := time.Now().Add(1 * time.Hour)

	valid, err := logger.VerifyIntegrity(ctx, tenantID, startTime, endTime)
	require.NoError(t, err)
	assert.True(t, valid, "Complete auth flow should maintain hash chain integrity")

	// Verify statistics
	stats, err := logger.GetStatistics(ctx, tenantID, 24*time.Hour)
	require.NoError(t, err)

	assert.Equal(t, int64(6), stats.TotalEvents)
	assert.Equal(t, int64(6), stats.SuccessCount)
	assert.Equal(t, int64(0), stats.FailureCount)
	assert.Equal(t, int64(1), stats.UniqueActors)
	assert.Equal(t, int64(1), stats.UniqueIPAddrs)

	// Check event type breakdown
	assert.Equal(t, int64(1), stats.EventsByType[types.EventAuthLoginSuccess])
	assert.Equal(t, int64(1), stats.EventsByType[types.EventAuthTokenIssued])
	assert.Equal(t, int64(3), stats.EventsByType[types.EventAuthTokenValidated])
	assert.Equal(t, int64(1), stats.EventsByType[types.EventAuthLogout])
}

func TestIntegration_FailedAuthAttempts(t *testing.T) {
	db := getTestDB(t)
	defer db.Close()
	defer cleanupTestDB(t, db)

	logger, err := audit.NewLogger(&audit.Config{DB: db})
	require.NoError(t, err)
	defer logger.Close()

	ctx := context.Background()
	tenantID := "tenant-security-1"

	// Simulate multiple failed login attempts (brute force)
	for i := 0; i < 5; i++ {
		event := types.NewAuditEventBuilder(
			types.EventAuthLoginFailure,
			"attacker-123",
			tenantID,
		).
			WithRequestContext("10.0.0.1", "curl/7.68.0").
			WithSuccess(false).
			WithError("Invalid credentials", "AUTH_INVALID_CREDENTIALS").
			WithMetadata("attempt_number", i+1).
			Build()

		err = logger.LogSync(ctx, event)
		require.NoError(t, err)
	}

	// Query failed attempts
	successFalse := false
	query := &types.AuditQuery{
		TenantID: &tenantID,
		Success:  &successFalse,
		Limit:    100,
	}

	result, err := logger.Query(ctx, query)
	require.NoError(t, err)
	assert.Equal(t, 5, len(result.Events))

	// All should be failures
	for _, event := range result.Events {
		assert.False(t, event.Success)
		assert.Equal(t, types.EventAuthLoginFailure, event.EventType)
		assert.Equal(t, "AUTH_INVALID_CREDENTIALS", event.ErrorCode)
	}

	// Verify statistics show all failures
	stats, err := logger.GetStatistics(ctx, tenantID, 24*time.Hour)
	require.NoError(t, err)

	assert.Equal(t, int64(5), stats.TotalEvents)
	assert.Equal(t, int64(0), stats.SuccessCount)
	assert.Equal(t, int64(5), stats.FailureCount)
}

func TestIntegration_APIKeyLifecycle(t *testing.T) {
	db := getTestDB(t)
	defer db.Close()
	defer cleanupTestDB(t, db)

	logger, err := audit.NewLogger(&audit.Config{DB: db})
	require.NoError(t, err)
	defer logger.Close()

	ctx := context.Background()
	tenantID := "tenant-apikey-1"
	userID := "user-apikey-123"
	apiKeyID := "apikey-xyz789"

	// 1. API Key creation
	createEvent := types.NewAuditEventBuilder(
		types.EventAuthAPIKeyCreated,
		userID,
		tenantID,
	).
		WithRequestContext("192.168.1.50", "PostmanRuntime/7.29.0").
		WithSuccess(true).
		WithMetadata("api_key_id", apiKeyID).
		WithMetadata("scopes", []string{"read:users", "write:users"}).
		Build()

	err = logger.LogSync(ctx, createEvent)
	require.NoError(t, err)

	// 2. API Key usage (multiple times)
	for i := 0; i < 10; i++ {
		usageEvent := types.NewAuditEventBuilder(
			types.EventAuthAPIKeyUsed,
			userID,
			tenantID,
		).
			WithRequestContext("192.168.1.50", "CustomApp/1.0").
			WithSuccess(true).
			WithMetadata("api_key_id", apiKeyID).
			WithMetadata("endpoint", "/api/v1/data").
			Build()

		err = logger.LogSync(ctx, usageEvent)
		require.NoError(t, err)
	}

	// 3. API Key revocation
	revokeEvent := types.NewAuditEventBuilder(
		types.EventAuthAPIKeyRevoked,
		userID,
		tenantID,
	).
		WithRequestContext("192.168.1.50", "PostmanRuntime/7.29.0").
		WithSuccess(true).
		WithMetadata("api_key_id", apiKeyID).
		WithMetadata("reason", "key rotation").
		Build()

	err = logger.LogSync(ctx, revokeEvent)
	require.NoError(t, err)

	// Verify complete lifecycle
	query := &types.AuditQuery{
		TenantID:  &tenantID,
		ActorID:   &userID,
		Limit:     100,
		SortBy:    "timestamp",
		SortOrder: "asc",
	}

	result, err := logger.Query(ctx, query)
	require.NoError(t, err)
	assert.Equal(t, 12, len(result.Events)) // create + 10 usage + revoke

	// First event should be creation
	assert.Equal(t, types.EventAuthAPIKeyCreated, result.Events[0].EventType)

	// Last event should be revocation
	assert.Equal(t, types.EventAuthAPIKeyRevoked, result.Events[11].EventType)

	// Middle events should be usage
	for i := 1; i <= 10; i++ {
		assert.Equal(t, types.EventAuthAPIKeyUsed, result.Events[i].EventType)
	}
}

func TestIntegration_HighVolumeLogging(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping high-volume test in short mode")
	}

	db := getTestDB(t)
	defer db.Close()
	defer cleanupTestDB(t, db)

	logger, err := audit.NewLogger(&audit.Config{
		DB:            db,
		BufferSize:    10000,
		FlushInterval: 100 * time.Millisecond,
		BatchSize:     100,
	})
	require.NoError(t, err)
	defer logger.Close()

	tenantID := "tenant-volume-1"
	numEvents := 1000

	// Log many events asynchronously
	start := time.Now()
	for i := 0; i < numEvents; i++ {
		event := types.NewAuditEventBuilder(
			types.EventAuthTokenValidated,
			"user-volume-123",
			tenantID,
		).
			WithRequestContext("192.168.1.1", "LoadTest/1.0").
			WithSuccess(true).
			WithMetadata("request_num", i).
			Build()

		err = logger.Log(event)
		require.NoError(t, err)
	}
	duration := time.Since(start)

	// Wait for all events to flush
	time.Sleep(500 * time.Millisecond)
	logger.Close()

	// Verify all events were stored
	ctx := context.Background()
	query := &types.AuditQuery{
		TenantID: &tenantID,
		Limit:    numEvents + 100,
	}

	result, err := logger.Query(ctx, query)
	require.NoError(t, err)
	assert.Equal(t, numEvents, len(result.Events), "All events should be stored")

	// Check performance
	eventsPerSecond := float64(numEvents) / duration.Seconds()
	t.Logf("Logged %d events in %v (%.0f events/sec)", numEvents, duration, eventsPerSecond)
	assert.Greater(t, eventsPerSecond, 100000.0, "Should handle >100K events/sec")
}

func TestIntegration_TamperDetection(t *testing.T) {
	db := getTestDB(t)
	defer db.Close()
	defer cleanupTestDB(t, db)

	logger, err := audit.NewLogger(&audit.Config{DB: db})
	require.NoError(t, err)
	defer logger.Close()

	ctx := context.Background()
	tenantID := "tenant-tamper-1"

	// Log some events
	for i := 0; i < 5; i++ {
		event := types.NewAuditEventBuilder(
			types.EventAuthLoginSuccess,
			"user-tamper-123",
			tenantID,
		).WithSuccess(true).Build()

		err = logger.LogSync(ctx, event)
		require.NoError(t, err)
	}

	// Verify integrity (should pass)
	startTime := time.Now().Add(-1 * time.Hour)
	endTime := time.Now().Add(1 * time.Hour)

	valid, err := logger.VerifyIntegrity(ctx, tenantID, startTime, endTime)
	require.NoError(t, err)
	assert.True(t, valid, "Unmodified chain should be valid")

	// Tamper with a record in the database
	_, err = db.ExecContext(ctx, `
		UPDATE auth_audit_logs
		SET actor_id = 'tampered-user'
		WHERE tenant_id = $1
		ORDER BY timestamp
		LIMIT 1
	`, tenantID)
	require.NoError(t, err)

	// Verify integrity (should fail due to tampered data)
	valid, err = logger.VerifyIntegrity(ctx, tenantID, startTime, endTime)
	require.NoError(t, err)
	assert.False(t, valid, "Tampered chain should be detected as invalid")
}

// Benchmark tests
func BenchmarkIntegration_AsyncLogging(b *testing.B) {
	db := getTestDB(&testing.T{})
	defer db.Close()

	logger, err := audit.NewLogger(&audit.Config{
		DB:            db,
		BufferSize:    100000,
		FlushInterval: 1 * time.Second,
		BatchSize:     1000,
	})
	if err != nil {
		b.Fatal(err)
	}
	defer logger.Close()

	event := types.NewAuditEventBuilder(
		types.EventAuthLoginSuccess,
		"user-bench-123",
		"tenant-bench-1",
	).
		WithRequestContext("192.168.1.1", "Benchmark/1.0").
		WithSuccess(true).
		Build()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = logger.Log(event)
	}
}

func BenchmarkIntegration_SyncLogging(b *testing.B) {
	db := getTestDB(&testing.T{})
	defer db.Close()

	logger, err := audit.NewLogger(&audit.Config{DB: db})
	if err != nil {
		b.Fatal(err)
	}
	defer logger.Close()

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		event := types.NewAuditEventBuilder(
			types.EventAuthLoginSuccess,
			"user-bench-123",
			"tenant-bench-1",
		).
			WithRequestContext("192.168.1.1", "Benchmark/1.0").
			WithSuccess(true).
			Build()

		_ = logger.LogSync(ctx, event)
	}
}
