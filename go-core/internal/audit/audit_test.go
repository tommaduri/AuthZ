package audit

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Test Event Generation

func TestGenerateEventID(t *testing.T) {
	id1 := generateEventID()
	id2 := generateEventID()

	assert.NotEmpty(t, id1)
	assert.NotEmpty(t, id2)
	assert.NotEqual(t, id1, id2)
	assert.Contains(t, id1, "evt-")
}

func TestGetRequestID(t *testing.T) {
	t.Run("with request ID", func(t *testing.T) {
		ctx := context.WithValue(context.Background(), "request_id", "req-123")
		id := getRequestID(ctx)
		assert.Equal(t, "req-123", id)
	})

	t.Run("without request ID", func(t *testing.T) {
		ctx := context.Background()
		id := getRequestID(ctx)
		assert.Empty(t, id)
	})

	t.Run("nil context", func(t *testing.T) {
		id := getRequestID(nil)
		assert.Empty(t, id)
	})
}

// Test Configuration

func TestConfigValidate(t *testing.T) {
	t.Run("valid stdout config", func(t *testing.T) {
		cfg := Config{
			Enabled:       true,
			Type:          "stdout",
			BufferSize:    1000,
			FlushInterval: 100 * time.Millisecond,
		}
		err := cfg.Validate()
		assert.NoError(t, err)
	})

	t.Run("valid file config", func(t *testing.T) {
		cfg := Config{
			Enabled:    true,
			Type:       "file",
			FilePath:   "/tmp/audit.log",
			BufferSize: 1000,
		}
		err := cfg.Validate()
		assert.NoError(t, err)
	})

	t.Run("invalid type", func(t *testing.T) {
		cfg := Config{
			Enabled: true,
			Type:    "invalid",
		}
		err := cfg.Validate()
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid audit type")
	})

	t.Run("file without path", func(t *testing.T) {
		cfg := Config{
			Enabled: true,
			Type:    "file",
		}
		err := cfg.Validate()
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "file path is required")
	})

	t.Run("disabled config", func(t *testing.T) {
		cfg := Config{
			Enabled: false,
		}
		err := cfg.Validate()
		assert.NoError(t, err)
	})
}

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()

	assert.True(t, cfg.Enabled)
	assert.Equal(t, "stdout", cfg.Type)
	assert.Equal(t, 1000, cfg.BufferSize)
	assert.Equal(t, 100*time.Millisecond, cfg.FlushInterval)
	assert.Equal(t, 100, cfg.FileMaxSize)
	assert.Equal(t, 30, cfg.FileMaxAge)
	assert.Equal(t, 10, cfg.FileMaxBackups)
}

// Test Noop Logger

func TestNoopLogger(t *testing.T) {
	cfg := Config{Enabled: false}
	logger, err := NewLogger(cfg)
	require.NoError(t, err)

	ctx := context.Background()
	event := &AuthzCheckEvent{
		Principal: Principal{ID: "user:alice"},
		Resource:  Resource{Kind: "document", ID: "doc-123"},
		Action:    "read",
		Decision:  DecisionAllow,
	}

	// Should not panic or error
	logger.LogAuthzCheck(ctx, event)
	err = logger.Flush()
	assert.NoError(t, err)
	err = logger.Close()
	assert.NoError(t, err)
}

// Test Stdout Writer

func TestStdoutWriter(t *testing.T) {
	writer := NewStdoutWriter()

	event := AuthzCheckEvent{
		Timestamp: time.Now(),
		EventType: EventTypeAuthzCheck,
		EventID:   "evt-test-123",
		Principal: Principal{ID: "user:alice"},
		Resource:  Resource{Kind: "document", ID: "doc-123"},
		Action:    "read",
		Decision:  DecisionAllow,
		Performance: Performance{
			DurationUs: 1750,
			CacheHit:   true,
		},
	}

	err := writer.Write(event)
	assert.NoError(t, err)

	err = writer.Close()
	assert.NoError(t, err)
}

// Test File Writer

func TestFileWriter(t *testing.T) {
	tmpDir := t.TempDir()
	logFile := filepath.Join(tmpDir, "audit.log")

	writer, err := NewFileWriter(logFile, 10, 30, 5)
	require.NoError(t, err)

	// Write test events
	for i := 0; i < 10; i++ {
		event := AuthzCheckEvent{
			Timestamp: time.Now(),
			EventType: EventTypeAuthzCheck,
			EventID:   generateEventID(),
			Principal: Principal{ID: "user:alice"},
			Resource:  Resource{Kind: "document", ID: "doc-123"},
			Action:    "read",
			Decision:  DecisionAllow,
		}
		err := writer.Write(event)
		require.NoError(t, err)
	}

	err = writer.Close()
	require.NoError(t, err)

	// Verify file exists and has content
	_, err = os.Stat(logFile)
	assert.NoError(t, err)

	// Read and verify content
	content, err := os.ReadFile(logFile)
	require.NoError(t, err)
	assert.Contains(t, string(content), "authz_check")
	assert.Contains(t, string(content), "user:alice")
}

// Test Async Logger

func TestAsyncLogger(t *testing.T) {
	cfg := Config{
		Enabled:       true,
		Type:          "stdout",
		BufferSize:    100,
		FlushInterval: 50 * time.Millisecond,
	}

	logger, err := NewLogger(cfg)
	require.NoError(t, err)
	defer logger.Close()

	ctx := context.Background()

	// Log multiple events
	for i := 0; i < 10; i++ {
		event := &AuthzCheckEvent{
			Timestamp: time.Now(),
			Principal: Principal{ID: "user:alice"},
			Resource:  Resource{Kind: "document", ID: "doc-123"},
			Action:    "read",
			Decision:  DecisionAllow,
			Performance: Performance{
				DurationUs: int64(1000 + i*100),
				CacheHit:   true,
			},
		}
		logger.LogAuthzCheck(ctx, event)
	}

	// Flush and verify no errors
	err = logger.Flush()
	assert.NoError(t, err)
}

func TestAsyncLoggerBufferOverflow(t *testing.T) {
	cfg := Config{
		Enabled:       true,
		Type:          "stdout",
		BufferSize:    10, // Small buffer to trigger overflow
		FlushInterval: 1 * time.Second, // Long interval to prevent auto-flush
	}

	logger, err := NewLogger(cfg)
	require.NoError(t, err)
	defer logger.Close()

	ctx := context.Background()

	// Write more events than buffer size
	for i := 0; i < 20; i++ {
		event := &AuthzCheckEvent{
			Principal: Principal{ID: "user:alice"},
			Resource:  Resource{Kind: "document", ID: "doc-123"},
			Action:    "read",
			Decision:  DecisionAllow,
		}
		logger.LogAuthzCheck(ctx, event)
	}

	// Should not crash or block, oldest events should be dropped
	err = logger.Flush()
	assert.NoError(t, err)
}

// Test Policy Change Logging

func TestLogPolicyChange(t *testing.T) {
	cfg := Config{
		Enabled:       true,
		Type:          "stdout",
		BufferSize:    100,
		FlushInterval: 50 * time.Millisecond,
	}

	logger, err := NewLogger(cfg)
	require.NoError(t, err)
	defer logger.Close()

	ctx := context.Background()
	change := &PolicyChange{
		Operation:     "update",
		PolicyID:      "policy-viewer-doc",
		PolicyVersion: "v2",
		ActorID:       "user:admin",
		ActorRoles:    []string{"admin"},
		Changes: map[string]interface{}{
			"before": map[string]string{"version": "v1"},
			"after":  map[string]string{"version": "v2"},
		},
		SourceIP:  "10.0.1.50",
		UserAgent: "kubectl/v1.25",
	}

	logger.LogPolicyChange(ctx, change)

	err = logger.Flush()
	assert.NoError(t, err)
}

// Test Agent Action Logging

func TestLogAgentAction(t *testing.T) {
	cfg := Config{
		Enabled:       true,
		Type:          "stdout",
		BufferSize:    100,
		FlushInterval: 50 * time.Millisecond,
	}

	logger, err := NewLogger(cfg)
	require.NoError(t, err)
	defer logger.Close()

	ctx := context.Background()
	action := &AgentAction{
		Operation:  "register",
		AgentID:    "agent-avatar-001",
		AgentType:  "service",
		ActorID:    "user:admin",
		ActorRoles: []string{"admin"},
		SourceIP:   "10.0.1.60",
		UserAgent:  "authz-cli/v1.0",
	}

	logger.LogAgentAction(ctx, action)

	err = logger.Flush()
	assert.NoError(t, err)
}

// Test Event Serialization

func TestAuthzCheckEventSerialization(t *testing.T) {
	event := AuthzCheckEvent{
		Timestamp: time.Date(2025, 11, 26, 10, 30, 45, 123000000, time.UTC),
		EventType: EventTypeAuthzCheck,
		EventID:   "evt-abc123",
		RequestID: "req-xyz789",
		TraceID:   "trace-001",
		SpanID:    "span-001",
		Principal: Principal{
			ID:    "user:alice",
			Roles: []string{"viewer", "editor"},
			Attributes: map[string]interface{}{
				"department": "engineering",
			},
		},
		Resource: Resource{
			Kind: "document",
			ID:   "doc-123",
			Attributes: map[string]interface{}{
				"owner": "user:bob",
			},
		},
		Action:   "view",
		Decision: DecisionAllow,
		Policies: []PolicyMatch{
			{
				ID:      "policy-viewer-doc",
				Version: "v1",
				Matched: true,
			},
		},
		Performance: Performance{
			DurationUs: 1750,
			CacheHit:   true,
		},
		Metadata: map[string]interface{}{
			"source_ip":   "10.0.1.45",
			"user_agent":  "curl/7.68.0",
			"api_version": "v1",
		},
	}

	data, err := json.Marshal(event)
	require.NoError(t, err)

	// Verify JSON structure
	var decoded map[string]interface{}
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	assert.Equal(t, "authz_check", decoded["event_type"])
	assert.Equal(t, "evt-abc123", decoded["event_id"])
	assert.Equal(t, "allow", decoded["decision"])

	principal := decoded["principal"].(map[string]interface{})
	assert.Equal(t, "user:alice", principal["id"])

	resource := decoded["resource"].(map[string]interface{})
	assert.Equal(t, "document", resource["kind"])
	assert.Equal(t, "doc-123", resource["id"])
}

// Test Context Extraction

func TestContextExtraction(t *testing.T) {
	ctx := context.Background()
	ctx = context.WithValue(ctx, "request_id", "req-123")
	ctx = context.WithValue(ctx, "trace_id", "trace-456")
	ctx = context.WithValue(ctx, "span_id", "span-789")

	assert.Equal(t, "req-123", getRequestID(ctx))
	assert.Equal(t, "trace-456", getTraceID(ctx))
	assert.Equal(t, "span-789", getSpanID(ctx))
}

// Test Concurrent Access

func TestConcurrentLogging(t *testing.T) {
	cfg := Config{
		Enabled:       true,
		Type:          "stdout",
		BufferSize:    1000,
		FlushInterval: 100 * time.Millisecond,
	}

	logger, err := NewLogger(cfg)
	require.NoError(t, err)
	defer logger.Close()

	ctx := context.Background()

	// Concurrent writes from multiple goroutines
	done := make(chan bool)
	for i := 0; i < 10; i++ {
		go func(id int) {
			for j := 0; j < 100; j++ {
				event := &AuthzCheckEvent{
					Principal: Principal{ID: "user:alice"},
					Resource:  Resource{Kind: "document", ID: "doc-123"},
					Action:    "read",
					Decision:  DecisionAllow,
				}
				logger.LogAuthzCheck(ctx, event)
			}
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	err = logger.Flush()
	assert.NoError(t, err)
}
