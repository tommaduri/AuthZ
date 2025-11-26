package audit

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

// asyncLogger implements asynchronous audit logging with ring buffer
type asyncLogger struct {
	writer Writer

	// Ring buffer
	buffer []interface{}
	size   int
	head   int
	tail   int
	mu     sync.Mutex

	// Background writer
	flushCh  chan struct{}
	doneCh   chan struct{}
	interval time.Duration
}

// newAsyncLogger creates a new async logger
func newAsyncLogger(writer Writer, cfg Config) *asyncLogger {
	l := &asyncLogger{
		writer:   writer,
		buffer:   make([]interface{}, cfg.BufferSize),
		size:     cfg.BufferSize,
		flushCh:  make(chan struct{}, 1),
		doneCh:   make(chan struct{}),
		interval: cfg.FlushInterval,
	}

	// Start background writer goroutine
	go l.run()

	return l
}

// LogAuthzCheck logs authorization check event
func (l *asyncLogger) LogAuthzCheck(ctx context.Context, event *AuthzCheckEvent) {
	// Set common fields if not already set
	if event.EventID == "" {
		event.EventID = generateEventID()
	}
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now()
	}
	if event.EventType == "" {
		event.EventType = EventTypeAuthzCheck
	}

	// Extract trace information from context
	if event.RequestID == "" {
		event.RequestID = getRequestID(ctx)
	}
	if event.TraceID == "" {
		event.TraceID = getTraceID(ctx)
	}
	if event.SpanID == "" {
		event.SpanID = getSpanID(ctx)
	}

	l.enqueue(event)
}

// LogPolicyChange logs policy change event
func (l *asyncLogger) LogPolicyChange(ctx context.Context, change *PolicyChange) {
	event := &PolicyChangeEvent{
		Timestamp:     time.Now(),
		EventType:     EventTypePolicyChange,
		EventID:       generateEventID(),
		RequestID:     getRequestID(ctx),
		Operation:     change.Operation,
		PolicyID:      change.PolicyID,
		PolicyVersion: change.PolicyVersion,
		Actor: Actor{
			ID:    change.ActorID,
			Roles: change.ActorRoles,
		},
		Changes: change.Changes,
		Metadata: map[string]interface{}{
			"source_ip":  change.SourceIP,
			"user_agent": change.UserAgent,
		},
	}

	l.enqueue(event)
}

// LogAgentAction logs agent action event
func (l *asyncLogger) LogAgentAction(ctx context.Context, action *AgentAction) {
	event := &AgentActionEvent{
		Timestamp: time.Now(),
		EventType: EventTypeAgentAction,
		EventID:   generateEventID(),
		RequestID: getRequestID(ctx),
		Operation: action.Operation,
		AgentID:   action.AgentID,
		AgentType: action.AgentType,
		Actor: Actor{
			ID:    action.ActorID,
			Roles: action.ActorRoles,
		},
		Metadata: map[string]interface{}{
			"source_ip":  action.SourceIP,
			"user_agent": action.UserAgent,
		},
	}

	l.enqueue(event)
}

// enqueue adds an event to the ring buffer (non-blocking)
func (l *asyncLogger) enqueue(event interface{}) {
	l.mu.Lock()
	defer l.mu.Unlock()

	// Add to ring buffer
	l.buffer[l.tail] = event
	l.tail = (l.tail + 1) % l.size

	// Drop oldest if buffer full (overflow protection)
	if l.tail == l.head {
		l.head = (l.head + 1) % l.size
		// TODO: increment metrics counter for dropped events
	}

	// Trigger flush (non-blocking)
	select {
	case l.flushCh <- struct{}{}:
	default:
	}
}

// run is the background goroutine that flushes events periodically
func (l *asyncLogger) run() {
	ticker := time.NewTicker(l.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			_ = l.flush()
		case <-l.flushCh:
			_ = l.flush()
		case <-l.doneCh:
			_ = l.flush() // Final flush on shutdown
			return
		}
	}
}

// Flush flushes pending events (can be called externally)
func (l *asyncLogger) Flush() error {
	return l.flush()
}

// flush writes all buffered events to the writer
func (l *asyncLogger) flush() error {
	l.mu.Lock()
	events := l.copyEvents()
	l.mu.Unlock()

	if len(events) == 0 {
		return nil
	}

	// Write events (outside of lock)
	var lastErr error
	for _, event := range events {
		if err := l.writer.Write(event); err != nil {
			lastErr = err
			// Continue writing other events even if one fails
			// TODO: increment metrics counter for failed writes
		}
	}

	return lastErr
}

// copyEvents copies events from ring buffer and clears it
func (l *asyncLogger) copyEvents() []interface{} {
	if l.head == l.tail {
		return nil
	}

	var events []interface{}
	i := l.head
	for i != l.tail {
		events = append(events, l.buffer[i])
		i = (i + 1) % l.size
	}

	// Clear buffer
	l.head = l.tail

	return events
}

// Close closes the logger and flushes remaining events
func (l *asyncLogger) Close() error {
	close(l.doneCh)
	time.Sleep(200 * time.Millisecond) // Give background goroutine time to flush
	return l.writer.Close()
}

// Helper functions for extracting context values

func generateEventID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return "evt-" + hex.EncodeToString(b)
}

func getRequestID(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if id, ok := ctx.Value("request_id").(string); ok {
		return id
	}
	return ""
}

func getTraceID(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if id, ok := ctx.Value("trace_id").(string); ok {
		return id
	}
	return ""
}

func getSpanID(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if id, ok := ctx.Value("span_id").(string); ok {
		return id
	}
	return ""
}
