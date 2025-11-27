package audit

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	_ "github.com/lib/pq"
)

// getTestDB creates a test database connection
func getTestDB(t *testing.T) *sql.DB {
	// Use environment variable or default to test DB
	dsn := "postgres://postgres:postgres@localhost:5432/authz_test?sslmode=disable"
	db, err := sql.Open("postgres", dsn)
	require.NoError(t, err)

	// Test connection
	err = db.Ping()
	if err != nil {
		t.Skipf("Skipping test: cannot connect to test database: %v", err)
	}

	return db
}

// cleanupTestDB removes all audit logs
func cleanupTestDB(t *testing.T, db *sql.DB) {
	_, err := db.Exec("DELETE FROM auth_audit_logs")
	require.NoError(t, err)
}

func TestNewAuthAuditLogger(t *testing.T) {
	db := getTestDB(t)
	defer db.Close()
	defer cleanupTestDB(t, db)

	cfg := &AuthAuditConfig{
		DB:            db,
		BufferSize:    1000,
		FlushInterval: 100 * time.Millisecond,
		BatchSize:     10,
	}

	logger, err := NewAuthAuditLogger(cfg)
	require.NoError(t, err)
	require.NotNil(t, logger)
	defer logger.Close()

	assert.Equal(t, 1000, logger.bufferSize)
	assert.Equal(t, 100*time.Millisecond, logger.flushInterval)
	assert.Equal(t, 10, logger.batchSize)
}

func TestAuthAuditLogger_LogLoginSuccess(t *testing.T) {
	db := getTestDB(t)
	defer db.Close()
	defer cleanupTestDB(t, db)

	logger, err := NewAuthAuditLogger(&AuthAuditConfig{
		DB:            db,
		FlushInterval: 50 * time.Millisecond,
	})
	require.NoError(t, err)
	defer logger.Close()

	ctx := context.Background()
	metadata := map[string]interface{}{
		"login_method": "password",
		"session_id":   "sess-123",
	}

	err = logger.LogLoginSuccess(ctx, "user-123", "tenant-1", "192.168.1.1", "Mozilla/5.0", "req-123", metadata)
	require.NoError(t, err)

	// Wait for flush
	time.Sleep(200 * time.Millisecond)

	// Verify event was stored
	tenantID := "tenant-1"
	query := &types.AuditQuery{
		TenantID: &tenantID,
		Limit:    10,
	}

	result, err := logger.Query(ctx, query)
	require.NoError(t, err)
	require.Len(t, result.Events, 1)

	event := result.Events[0]
	assert.Equal(t, types.EventAuthLoginSuccess, event.EventType)
	assert.Equal(t, "user-123", event.ActorID)
	assert.Equal(t, "tenant-1", event.TenantID)
	assert.True(t, event.Success)
	assert.NotEmpty(t, event.Hash)
}

func TestAuthAuditLogger_LogLoginFailure(t *testing.T) {
	db := getTestDB(t)
	defer db.Close()
	defer cleanupTestDB(t, db)

	logger, err := NewAuthAuditLogger(&AuthAuditConfig{DB: db})
	require.NoError(t, err)
	defer logger.Close()

	ctx := context.Background()
	err = logger.LogLoginFailure(ctx, "attacker-123", "tenant-1", "10.0.0.1", "curl/7.0", "req-456", "Invalid password", "AUTH001", nil)
	require.NoError(t, err)

	time.Sleep(200 * time.Millisecond)

	tenantID := "tenant-1"
	query := &types.AuditQuery{
		TenantID: &tenantID,
		Limit:    10,
	}

	result, err := logger.Query(ctx, query)
	require.NoError(t, err)
	require.Len(t, result.Events, 1)

	event := result.Events[0]
	assert.Equal(t, types.EventAuthLoginFailure, event.EventType)
	assert.False(t, event.Success)
	assert.Equal(t, "AUTH001", event.ErrorCode)
	assert.Equal(t, "Invalid password", event.ErrorMessage)
}

func TestAuthAuditLogger_HashChainIntegrity(t *testing.T) {
	db := getTestDB(t)
	defer db.Close()
	defer cleanupTestDB(t, db)

	logger, err := NewAuthAuditLogger(&AuthAuditConfig{
		DB:            db,
		FlushInterval: 50 * time.Millisecond,
	})
	require.NoError(t, err)
	defer logger.Close()

	ctx := context.Background()

	// Log multiple events
	for i := 0; i < 5; i++ {
		err := logger.LogLoginSuccess(ctx, "user-1", "tenant-1", "192.168.1.1", "Mozilla/5.0", "req-123", nil)
		require.NoError(t, err)
	}

	time.Sleep(500 * time.Millisecond)

	// Verify hash chain integrity
	startTime := time.Now().Add(-1 * time.Hour)
	endTime := time.Now().Add(1 * time.Hour)

	valid, err := logger.VerifyIntegrity(ctx, "tenant-1", startTime, endTime)
	require.NoError(t, err)
	assert.True(t, valid, "Hash chain should be valid")
}

func TestAuthAuditLogger_AllEventTypes(t *testing.T) {
	db := getTestDB(t)
	defer db.Close()
	defer cleanupTestDB(t, db)

	logger, err := NewAuthAuditLogger(&AuthAuditConfig{DB: db})
	require.NoError(t, err)
	defer logger.Close()

	ctx := context.Background()

	// Test all convenience methods
	testCases := []struct {
		name     string
		logFunc  func() error
		expected types.AuditEventType
	}{
		{
			name: "Token Issued",
			logFunc: func() error {
				return logger.LogTokenIssued(ctx, "user-1", "tenant-1", "192.168.1.1", "UA", "req-1", map[string]interface{}{"token_type": "access"})
			},
			expected: types.EventAuthTokenIssued,
		},
		{
			name: "Token Validated",
			logFunc: func() error {
				return logger.LogTokenValidated(ctx, "user-1", "tenant-1", "192.168.1.1", "UA", "req-2", nil)
			},
			expected: types.EventAuthTokenValidated,
		},
		{
			name: "Token Revoked",
			logFunc: func() error {
				return logger.LogTokenRevoked(ctx, "user-1", "tenant-1", "192.168.1.1", "UA", "req-3", nil)
			},
			expected: types.EventAuthTokenRevoked,
		},
		{
			name: "API Key Created",
			logFunc: func() error {
				return logger.LogAPIKeyCreated(ctx, "user-1", "tenant-1", "192.168.1.1", "UA", "req-4", map[string]interface{}{"key_id": "key-123"})
			},
			expected: types.EventAuthAPIKeyCreated,
		},
		{
			name: "API Key Used",
			logFunc: func() error {
				return logger.LogAPIKeyUsed(ctx, "user-1", "tenant-1", "192.168.1.1", "UA", "req-5", nil)
			},
			expected: types.EventAuthAPIKeyUsed,
		},
		{
			name: "API Key Revoked",
			logFunc: func() error {
				return logger.LogAPIKeyRevoked(ctx, "user-1", "tenant-1", "192.168.1.1", "UA", "req-6", nil)
			},
			expected: types.EventAuthAPIKeyRevoked,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.logFunc()
			require.NoError(t, err)
		})
	}

	time.Sleep(500 * time.Millisecond)

	// Verify all events were logged
	tenantID := "tenant-1"
	query := &types.AuditQuery{
		TenantID: &tenantID,
		Limit:    100,
	}

	result, err := logger.Query(ctx, query)
	require.NoError(t, err)
	assert.Len(t, result.Events, len(testCases))
}

func TestAuthAuditLogger_Statistics(t *testing.T) {
	db := getTestDB(t)
	defer db.Close()
	defer cleanupTestDB(t, db)

	logger, err := NewAuthAuditLogger(&AuthAuditConfig{DB: db})
	require.NoError(t, err)
	defer logger.Close()

	ctx := context.Background()

	// Log various events
	logger.LogLoginSuccess(ctx, "user-1", "tenant-1", "192.168.1.1", "UA", "req-1", nil)
	logger.LogLoginSuccess(ctx, "user-2", "tenant-1", "192.168.1.2", "UA", "req-2", nil)
	logger.LogLoginFailure(ctx, "user-3", "tenant-1", "192.168.1.3", "UA", "req-3", "Bad password", "AUTH001", nil)
	logger.LogTokenIssued(ctx, "user-1", "tenant-1", "192.168.1.1", "UA", "req-4", nil)

	time.Sleep(500 * time.Millisecond)

	stats, err := logger.GetStatistics(ctx, "tenant-1", 24*time.Hour)
	require.NoError(t, err)

	assert.Equal(t, int64(4), stats.TotalEvents)
	assert.Equal(t, int64(3), stats.SuccessCount)
	assert.Equal(t, int64(1), stats.FailureCount)
	assert.Equal(t, int64(3), stats.UniqueActors)
}

func TestAuthAuditLogger_Metrics(t *testing.T) {
	db := getTestDB(t)
	defer db.Close()
	defer cleanupTestDB(t, db)

	logger, err := NewAuthAuditLogger(&AuthAuditConfig{
		DB:         db,
		BufferSize: 10,
	})
	require.NoError(t, err)
	defer logger.Close()

	ctx := context.Background()
	err = logger.LogLoginSuccess(ctx, "user-1", "tenant-1", "192.168.1.1", "UA", "req-1", nil)
	require.NoError(t, err)

	metrics := logger.GetMetrics()
	assert.Equal(t, int64(1), metrics["events_logged"])
	assert.Equal(t, 10, metrics["buffer_capacity"])
}

func TestAuthAuditLogger_BufferOverflow(t *testing.T) {
	db := getTestDB(t)
	defer db.Close()
	defer cleanupTestDB(t, db)

	// Create logger with very small buffer
	logger, err := NewAuthAuditLogger(&AuthAuditConfig{
		DB:            db,
		BufferSize:    2,
		FlushInterval: 1 * time.Second, // Long interval
	})
	require.NoError(t, err)
	defer logger.Close()

	ctx := context.Background()

	// Fill buffer beyond capacity
	for i := 0; i < 5; i++ {
		_ = logger.LogLoginSuccess(ctx, "user-1", "tenant-1", "192.168.1.1", "UA", "req-1", nil)
	}

	// Check metrics - some events should be dropped
	metrics := logger.GetMetrics()
	dropped := metrics["events_dropped"].(int64)
	assert.Greater(t, dropped, int64(0), "Some events should be dropped due to buffer overflow")
}

// Benchmark tests for performance verification
func BenchmarkAuthAuditLogger_LogAsync(b *testing.B) {
	db := getTestDB(&testing.T{})
	defer db.Close()

	logger, err := NewAuthAuditLogger(&AuthAuditConfig{
		DB:            db,
		BufferSize:    100000,
		FlushInterval: 1 * time.Second,
		BatchSize:     1000,
	})
	if err != nil {
		b.Fatal(err)
	}
	defer logger.Close()

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = logger.LogLoginSuccess(ctx, "user-bench", "tenant-bench", "192.168.1.1", "Benchmark/1.0", "req-bench", nil)
	}
}

func BenchmarkAuthAuditLogger_LogSync(b *testing.B) {
	db := getTestDB(&testing.T{})
	defer db.Close()

	logger, err := NewAuthAuditLogger(&AuthAuditConfig{DB: db})
	if err != nil {
		b.Fatal(err)
	}
	defer logger.Close()

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		event := types.NewAuditEventBuilder(
			types.EventAuthLoginSuccess,
			"user-bench",
			"tenant-bench",
		).
			WithRequestContext("192.168.1.1", "Benchmark/1.0").
			WithSuccess(true).
			Build()

		_ = logger.LogAuthEventSync(ctx, event)
	}
}

func BenchmarkAuthAuditLogger_HashComputation(b *testing.B) {
	db := getTestDB(&testing.T{})
	defer db.Close()

	logger, err := NewAuthAuditLogger(&AuthAuditConfig{DB: db})
	if err != nil {
		b.Fatal(err)
	}
	defer logger.Close()

	event := types.NewAuditEventBuilder(
		types.EventAuthLoginSuccess,
		"user-bench",
		"tenant-bench",
	).
		WithRequestContext("192.168.1.1", "Benchmark/1.0").
		WithSuccess(true).
		WithMetadata("key1", "value1").
		WithMetadata("key2", "value2").
		Build()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = logger.hashChain.ComputeEventHash(event)
	}
}

func BenchmarkAuthAuditLogger_Throughput(b *testing.B) {
	db := getTestDB(&testing.T{})
	defer db.Close()

	logger, err := NewAuthAuditLogger(&AuthAuditConfig{
		DB:            db,
		BufferSize:    100000,
		FlushInterval: 100 * time.Millisecond,
		BatchSize:     1000,
	})
	if err != nil {
		b.Fatal(err)
	}
	defer logger.Close()

	ctx := context.Background()

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_ = logger.LogLoginSuccess(ctx, "user-parallel", "tenant-parallel", "192.168.1.1", "Parallel/1.0", "req-parallel", nil)
		}
	})
}
