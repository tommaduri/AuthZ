package audit

import (
	"context"
	"testing"
	"time"
)

// BenchmarkAsyncLogger_LogAuthzCheck measures the overhead of logging an authorization check
func BenchmarkAsyncLogger_LogAuthzCheck(b *testing.B) {
	cfg := Config{
		Enabled:       true,
		Type:          "stdout",
		BufferSize:    10000,
		FlushInterval: 1 * time.Second, // Long interval to measure enqueue only
	}

	logger, err := NewLogger(cfg)
	if err != nil {
		b.Fatalf("create logger: %v", err)
	}
	defer logger.Close()

	ctx := context.Background()
	event := &AuthzCheckEvent{
		Principal: Principal{ID: "user:alice", Roles: []string{"viewer"}},
		Resource:  Resource{Kind: "document", ID: "doc-123"},
		Action:    "read",
		Decision:  DecisionAllow,
		Performance: Performance{
			DurationUs: 1750,
			CacheHit:   true,
		},
	}

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		logger.LogAuthzCheck(ctx, event)
	}
}

// BenchmarkAsyncLogger_LogAuthzCheck_Parallel measures parallel logging performance
func BenchmarkAsyncLogger_LogAuthzCheck_Parallel(b *testing.B) {
	cfg := Config{
		Enabled:       true,
		Type:          "stdout",
		BufferSize:    10000,
		FlushInterval: 1 * time.Second,
	}

	logger, err := NewLogger(cfg)
	if err != nil {
		b.Fatalf("create logger: %v", err)
	}
	defer logger.Close()

	ctx := context.Background()
	event := &AuthzCheckEvent{
		Principal: Principal{ID: "user:alice", Roles: []string{"viewer"}},
		Resource:  Resource{Kind: "document", ID: "doc-123"},
		Action:    "read",
		Decision:  DecisionAllow,
		Performance: Performance{
			DurationUs: 1750,
			CacheHit:   true,
		},
	}

	b.ResetTimer()
	b.ReportAllocs()

	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			logger.LogAuthzCheck(ctx, event)
		}
	})
}

// BenchmarkGenerateEventID measures event ID generation performance
func BenchmarkGenerateEventID(b *testing.B) {
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		_ = generateEventID()
	}
}

// BenchmarkStdoutWriter_Write measures stdout writer performance
func BenchmarkStdoutWriter_Write(b *testing.B) {
	writer := NewStdoutWriter()
	defer writer.Close()

	event := AuthzCheckEvent{
		Timestamp: time.Now(),
		EventType: EventTypeAuthzCheck,
		EventID:   "evt-test-123",
		Principal: Principal{ID: "user:alice"},
		Resource:  Resource{Kind: "document", ID: "doc-123"},
		Action:    "read",
		Decision:  DecisionAllow,
	}

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		_ = writer.Write(event)
	}
}

// BenchmarkNoopLogger measures overhead of disabled logging
func BenchmarkNoopLogger(b *testing.B) {
	cfg := Config{Enabled: false}
	logger, err := NewLogger(cfg)
	if err != nil {
		b.Fatalf("create logger: %v", err)
	}
	defer logger.Close()

	ctx := context.Background()
	event := &AuthzCheckEvent{
		Principal: Principal{ID: "user:alice"},
		Resource:  Resource{Kind: "document", ID: "doc-123"},
		Action:    "read",
		Decision:  DecisionAllow,
	}

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		logger.LogAuthzCheck(ctx, event)
	}
}

// BenchmarkLogPolicyChange measures policy change logging performance
func BenchmarkLogPolicyChange(b *testing.B) {
	cfg := Config{
		Enabled:       true,
		Type:          "stdout",
		BufferSize:    10000,
		FlushInterval: 1 * time.Second,
	}

	logger, err := NewLogger(cfg)
	if err != nil {
		b.Fatalf("create logger: %v", err)
	}
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
	}

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		logger.LogPolicyChange(ctx, change)
	}
}

// BenchmarkLogAgentAction measures agent action logging performance
func BenchmarkLogAgentAction(b *testing.B) {
	cfg := Config{
		Enabled:       true,
		Type:          "stdout",
		BufferSize:    10000,
		FlushInterval: 1 * time.Second,
	}

	logger, err := NewLogger(cfg)
	if err != nil {
		b.Fatalf("create logger: %v", err)
	}
	defer logger.Close()

	ctx := context.Background()
	action := &AgentAction{
		Operation: "register",
		AgentID:   "agent-avatar-001",
		AgentType: "service",
		ActorID:   "user:admin",
	}

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		logger.LogAgentAction(ctx, action)
	}
}
