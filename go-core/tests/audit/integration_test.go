package audit_test

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/audit"
	"github.com/authz-engine/go-core/pkg/types"
	_ "github.com/lib/pq"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupTestDB(t *testing.T) *sql.DB {
	// Use environment variable or skip if not available
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}

	db, err := sql.Open("postgres", dsn)
	require.NoError(t, err)

	// Verify connection
	err = db.Ping()
	require.NoError(t, err)

	return db
}

func cleanupTestData(t *testing.T, db *sql.DB, tenantID string) {
	_, err := db.Exec("DELETE FROM auth_audit_logs WHERE tenant_id = $1", tenantID)
	require.NoError(t, err)
}

func TestAuthAuditLogger_EndToEnd(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	tenantID := "test-tenant-e2e"
	defer cleanupTestData(t, db, tenantID)

	// Create logger
	cfg := &audit.AuthAuditConfig{
		DB:            db,
		BufferSize:    100,
		FlushInterval: 100 * time.Millisecond,
		BatchSize:     10,
	}

	logger, err := audit.NewAuthAuditLogger(cfg)
	require.NoError(t, err)
	defer logger.Close()

	ctx := context.Background()

	// 1. Log multiple events
	events := []struct {
		eventType types.EventType
		actorID   string
		success   bool
	}{
		{types.EventTypeLoginSuccess, "user-1", true},
		{types.EventTypeTokenIssued, "user-1", true},
		{types.EventTypeAPIKeyCreated, "user-1", true},
		{types.EventTypeLoginFailure, "user-2", false},
		{types.EventTypeRateLimitExceeded, "user-3", false},
	}

	for _, e := range events {
		event := &types.AuditEvent{
			EventType: e.eventType,
			ActorID:   e.actorID,
			TenantID:  tenantID,
			IPAddress: "192.168.1.1",
			UserAgent: "TestAgent/1.0",
			Success:   e.success,
			Timestamp: time.Now().UTC(),
			RequestID: "req-" + e.actorID,
			Metadata:  map[string]interface{}{"test": true},
		}

		err := logger.LogAuthEvent(event)
		require.NoError(t, err)
	}

	// Wait for flush
	time.Sleep(200 * time.Millisecond)

	// 2. Query events
	query := &types.AuditQuery{
		TenantID: tenantID,
		Limit:    100,
	}

	result, err := logger.Query(ctx, query)
	require.NoError(t, err)
	assert.Len(t, result.Events, 5, "Should retrieve all logged events")

	// 3. Verify hash chain integrity
	valid, err := logger.VerifyIntegrity(ctx, tenantID, time.Now().Add(-1*time.Hour), time.Now())
	require.NoError(t, err)
	assert.True(t, valid, "Hash chain should be valid")

	// 4. Query by event type
	queryByType := &types.AuditQuery{
		TenantID:   tenantID,
		EventTypes: []types.EventType{types.EventTypeLoginSuccess},
		Limit:      100,
	}

	resultByType, err := logger.Query(ctx, queryByType)
	require.NoError(t, err)
	assert.Len(t, resultByType.Events, 1, "Should retrieve only login success events")
	assert.Equal(t, types.EventTypeLoginSuccess, resultByType.Events[0].EventType)

	// 5. Query failures only
	queryFailures := &types.AuditQuery{
		TenantID:    tenantID,
		SuccessOnly: false,
		Limit:       100,
	}

	resultFailures, err := logger.Query(ctx, queryFailures)
	require.NoError(t, err)
	failureCount := 0
	for _, event := range resultFailures.Events {
		if !event.Success {
			failureCount++
		}
	}
	assert.Equal(t, 2, failureCount, "Should have 2 failed events")
}

func TestAuthAuditLogger_Statistics(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	tenantID := "test-tenant-stats"
	defer cleanupTestData(t, db, tenantID)

	cfg := &audit.AuthAuditConfig{
		DB:            db,
		BufferSize:    100,
		FlushInterval: 100 * time.Millisecond,
	}

	logger, err := audit.NewAuthAuditLogger(cfg)
	require.NoError(t, err)
	defer logger.Close()

	ctx := context.Background()

	// Log events with specific patterns
	for i := 0; i < 10; i++ {
		event := &types.AuditEvent{
			EventType: types.EventTypeLoginSuccess,
			ActorID:   "user-1",
			TenantID:  tenantID,
			Success:   true,
			Timestamp: time.Now().UTC(),
		}
		logger.LogAuthEventSync(ctx, event)
	}

	for i := 0; i < 3; i++ {
		event := &types.AuditEvent{
			EventType: types.EventTypeLoginFailure,
			ActorID:   "user-2",
			TenantID:  tenantID,
			Success:   false,
			Timestamp: time.Now().UTC(),
		}
		logger.LogAuthEventSync(ctx, event)
	}

	// Get statistics
	stats, err := logger.GetStatistics(ctx, tenantID, 1*time.Hour)
	require.NoError(t, err)

	assert.Equal(t, int64(13), stats.TotalEvents, "Should have 13 total events")
	assert.Equal(t, int64(10), stats.SuccessfulEvents, "Should have 10 successful events")
	assert.Equal(t, int64(3), stats.FailedEvents, "Should have 3 failed events")
}

func TestAuthAuditLogger_TamperedChain(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	tenantID := "test-tenant-tamper"
	defer cleanupTestData(t, db, tenantID)

	cfg := &audit.AuthAuditConfig{
		DB:            db,
		BufferSize:    100,
		FlushInterval: 100 * time.Millisecond,
	}

	logger, err := audit.NewAuthAuditLogger(cfg)
	require.NoError(t, err)
	defer logger.Close()

	ctx := context.Background()

	// Log some events
	for i := 0; i < 5; i++ {
		event := &types.AuditEvent{
			EventType: types.EventTypeAPIKeyValidated,
			ActorID:   "user-1",
			TenantID:  tenantID,
			Success:   true,
			Timestamp: time.Now().UTC(),
		}
		err := logger.LogAuthEventSync(ctx, event)
		require.NoError(t, err)
	}

	// Tamper with the database (modify an event)
	_, err = db.Exec(`
		UPDATE auth_audit_logs
		SET actor_id = 'tampered-user'
		WHERE tenant_id = $1
		LIMIT 1
	`, tenantID)
	require.NoError(t, err)

	// Verify integrity should fail
	valid, err := logger.VerifyIntegrity(ctx, tenantID, time.Now().Add(-1*time.Hour), time.Now())
	assert.Error(t, err, "Should detect tampering")
	assert.False(t, valid)
}

func TestAuthAuditLogger_HighLoad(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	tenantID := "test-tenant-load"
	defer cleanupTestData(t, db, tenantID)

	cfg := &audit.AuthAuditConfig{
		DB:            db,
		BufferSize:    1000,
		FlushInterval: 500 * time.Millisecond,
		BatchSize:     100,
	}

	logger, err := audit.NewAuthAuditLogger(cfg)
	require.NoError(t, err)
	defer logger.Close()

	// Log 500 events quickly
	start := time.Now()
	for i := 0; i < 500; i++ {
		event := &types.AuditEvent{
			EventType: types.EventTypeAPIKeyValidated,
			ActorID:   "user-load",
			TenantID:  tenantID,
			Success:   true,
			Timestamp: time.Now().UTC(),
		}
		err := logger.LogAuthEvent(event)
		require.NoError(t, err)
	}
	duration := time.Since(start)

	// Wait for all events to flush
	time.Sleep(1 * time.Second)

	// Verify all events were logged
	query := &types.AuditQuery{
		TenantID: tenantID,
		Limit:    1000,
	}

	ctx := context.Background()
	result, err := logger.Query(ctx, query)
	require.NoError(t, err)
	assert.Len(t, result.Events, 500, "Should have logged all 500 events")

	// Should be fast (async logging)
	t.Logf("Logged 500 events in %v", duration)
	assert.Less(t, duration, 1*time.Second, "Async logging should be fast")
}

func TestAuthAuditLogger_AllEventTypes(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	tenantID := "test-tenant-event-types"
	defer cleanupTestData(t, db, tenantID)

	cfg := &audit.AuthAuditConfig{
		DB:            db,
		BufferSize:    100,
		FlushInterval: 100 * time.Millisecond,
	}

	logger, err := audit.NewAuthAuditLogger(cfg)
	require.NoError(t, err)
	defer logger.Close()

	ctx := context.Background()

	// Test all 11 event types
	eventTypes := []types.EventType{
		types.EventTypeAPIKeyCreated,
		types.EventTypeAPIKeyValidated,
		types.EventTypeAPIKeyRevoked,
		types.EventTypeTokenIssued,
		types.EventTypeTokenRefreshed,
		types.EventTypeTokenRevoked,
		types.EventTypeLoginSuccess,
		types.EventTypeLoginFailure,
		types.EventTypeLogout,
		types.EventTypeRateLimitExceeded,
		types.EventTypePermissionDenied,
	}

	for _, eventType := range eventTypes {
		event := &types.AuditEvent{
			EventType: eventType,
			ActorID:   "user-1",
			TenantID:  tenantID,
			Success:   eventType != types.EventTypeLoginFailure,
			Timestamp: time.Now().UTC(),
		}
		err := logger.LogAuthEventSync(ctx, event)
		require.NoError(t, err, "Failed to log event type: %s", eventType)
	}

	// Query all events
	query := &types.AuditQuery{
		TenantID: tenantID,
		Limit:    100,
	}

	result, err := logger.Query(ctx, query)
	require.NoError(t, err)
	assert.Len(t, result.Events, 11, "Should have all 11 event types")

	// Count by event type
	eventTypeCount := make(map[types.EventType]int)
	for _, event := range result.Events {
		eventTypeCount[event.EventType]++
	}

	for _, eventType := range eventTypes {
		assert.Equal(t, 1, eventTypeCount[eventType], "Should have one event of type: %s", eventType)
	}
}
