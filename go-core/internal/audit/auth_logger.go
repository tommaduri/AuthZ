package audit

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/authz-engine/go-core/pkg/types"
)

// AuthAuditLogger provides specialized audit logging for authentication events
// Integrates with the existing async logger infrastructure while adding
// authentication-specific functionality like hash chains and PostgreSQL storage
type AuthAuditLogger struct {
	backend       *PostgresBackend
	hashChain     *HashChain
	eventBuffer   chan *types.AuditEvent
	flushInterval time.Duration
	batchSize     int
	bufferSize    int

	ctx    context.Context
	cancel context.CancelFunc

	// Metrics
	eventsLogged      int64
	eventsDropped     int64
	eventsFailed      int64
	lastFlushTime     time.Time
	lastFlushDuration time.Duration
}

// AuthAuditConfig holds configuration for the auth audit logger
type AuthAuditConfig struct {
	DB            *sql.DB
	BufferSize    int
	FlushInterval time.Duration
	BatchSize     int
}

const (
	// DefaultAuthBufferSize is the default capacity for the event buffer
	DefaultAuthBufferSize = 10000

	// DefaultAuthFlushInterval is how often to flush buffered events
	DefaultAuthFlushInterval = 1 * time.Second

	// DefaultAuthBatchSize is the max number of events to write in one batch
	DefaultAuthBatchSize = 100
)

// NewAuthAuditLogger creates a new authentication audit logger
func NewAuthAuditLogger(cfg *AuthAuditConfig) (*AuthAuditLogger, error) {
	if cfg.DB == nil {
		return nil, fmt.Errorf("database connection is required")
	}

	bufferSize := DefaultAuthBufferSize
	if cfg.BufferSize > 0 {
		bufferSize = cfg.BufferSize
	}

	flushInterval := DefaultAuthFlushInterval
	if cfg.FlushInterval > 0 {
		flushInterval = cfg.FlushInterval
	}

	batchSize := DefaultAuthBatchSize
	if cfg.BatchSize > 0 {
		batchSize = cfg.BatchSize
	}

	ctx, cancel := context.WithCancel(context.Background())

	logger := &AuthAuditLogger{
		backend:       NewPostgresBackend(cfg.DB),
		hashChain:     NewHashChain(),
		eventBuffer:   make(chan *types.AuditEvent, bufferSize),
		flushInterval: flushInterval,
		batchSize:     batchSize,
		bufferSize:    bufferSize,
		ctx:           ctx,
		cancel:        cancel,
	}

	// Initialize database schema
	if err := logger.backend.InitializeSchema(context.Background()); err != nil {
		cancel()
		return nil, fmt.Errorf("failed to initialize schema: %w", err)
	}

	// Load last hash from database
	lastHash, err := logger.backend.GetLastHash(context.Background())
	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to load last hash: %w", err)
	}
	if lastHash != "" {
		logger.hashChain.InitializeWithHash(lastHash)
	}

	// Start background worker
	go logger.worker()

	return logger, nil
}

// LogAuthEvent asynchronously logs an authentication audit event
func (l *AuthAuditLogger) LogAuthEvent(event *types.AuditEvent) error {
	// Compute hash (adds prev_hash and hash to event)
	_, err := l.hashChain.ComputeEventHash(event)
	if err != nil {
		l.eventsFailed++
		return fmt.Errorf("failed to compute event hash: %w", err)
	}

	// Non-blocking send to buffer
	select {
	case l.eventBuffer <- event:
		l.eventsLogged++
		return nil
	default:
		// Buffer full - drop event (or could block here for critical events)
		l.eventsDropped++
		return fmt.Errorf("audit buffer full, event dropped")
	}
}

// LogAuthEventSync synchronously logs an authentication audit event (for critical events)
func (l *AuthAuditLogger) LogAuthEventSync(ctx context.Context, event *types.AuditEvent) error {
	// Compute hash
	_, err := l.hashChain.ComputeEventHash(event)
	if err != nil {
		l.eventsFailed++
		return fmt.Errorf("failed to compute event hash: %w", err)
	}

	// Store immediately
	if err := l.backend.Store(ctx, event); err != nil {
		l.eventsFailed++
		return fmt.Errorf("failed to store event: %w", err)
	}

	// Update hash chain
	l.hashChain.UpdateLastHash(event.Hash)
	l.eventsLogged++

	return nil
}

// Convenience methods for specific authentication events

// LogLoginSuccess logs a successful login attempt
func (l *AuthAuditLogger) LogLoginSuccess(ctx context.Context, actorID, tenantID, ipAddress, userAgent, requestID string, metadata map[string]interface{}) error {
	event := types.NewAuditEventBuilder(
		types.EventAuthLoginSuccess,
		actorID,
		tenantID,
	).
		WithRequestContext(ipAddress, userAgent).
		WithRequestID(requestID).
		WithSuccess(true).
		WithMetadataMap(metadata).
		Build()

	return l.LogAuthEvent(event)
}

// LogLoginFailure logs a failed login attempt
func (l *AuthAuditLogger) LogLoginFailure(ctx context.Context, actorID, tenantID, ipAddress, userAgent, requestID, errorMsg, errorCode string, metadata map[string]interface{}) error {
	event := types.NewAuditEventBuilder(
		types.EventAuthLoginFailure,
		actorID,
		tenantID,
	).
		WithRequestContext(ipAddress, userAgent).
		WithRequestID(requestID).
		WithError(errorMsg, errorCode).
		WithMetadataMap(metadata).
		Build()

	return l.LogAuthEvent(event)
}

// LogTokenIssued logs when a token is issued
func (l *AuthAuditLogger) LogTokenIssued(ctx context.Context, actorID, tenantID, ipAddress, userAgent, requestID string, metadata map[string]interface{}) error {
	event := types.NewAuditEventBuilder(
		types.EventAuthTokenIssued,
		actorID,
		tenantID,
	).
		WithRequestContext(ipAddress, userAgent).
		WithRequestID(requestID).
		WithSuccess(true).
		WithMetadataMap(metadata).
		Build()

	return l.LogAuthEvent(event)
}

// LogTokenValidated logs when a token is validated
func (l *AuthAuditLogger) LogTokenValidated(ctx context.Context, actorID, tenantID, ipAddress, userAgent, requestID string, metadata map[string]interface{}) error {
	event := types.NewAuditEventBuilder(
		types.EventAuthTokenValidated,
		actorID,
		tenantID,
	).
		WithRequestContext(ipAddress, userAgent).
		WithRequestID(requestID).
		WithSuccess(true).
		WithMetadataMap(metadata).
		Build()

	return l.LogAuthEvent(event)
}

// LogTokenRevoked logs when a token is revoked
func (l *AuthAuditLogger) LogTokenRevoked(ctx context.Context, actorID, tenantID, ipAddress, userAgent, requestID string, metadata map[string]interface{}) error {
	event := types.NewAuditEventBuilder(
		types.EventAuthTokenRevoked,
		actorID,
		tenantID,
	).
		WithRequestContext(ipAddress, userAgent).
		WithRequestID(requestID).
		WithSuccess(true).
		WithMetadataMap(metadata).
		Build()

	return l.LogAuthEvent(event)
}

// LogAPIKeyCreated logs when an API key is created
func (l *AuthAuditLogger) LogAPIKeyCreated(ctx context.Context, actorID, tenantID, ipAddress, userAgent, requestID string, metadata map[string]interface{}) error {
	event := types.NewAuditEventBuilder(
		types.EventAuthAPIKeyCreated,
		actorID,
		tenantID,
	).
		WithRequestContext(ipAddress, userAgent).
		WithRequestID(requestID).
		WithSuccess(true).
		WithMetadataMap(metadata).
		Build()

	return l.LogAuthEvent(event)
}

// LogAPIKeyUsed logs when an API key is used
func (l *AuthAuditLogger) LogAPIKeyUsed(ctx context.Context, actorID, tenantID, ipAddress, userAgent, requestID string, metadata map[string]interface{}) error {
	event := types.NewAuditEventBuilder(
		types.EventAuthAPIKeyUsed,
		actorID,
		tenantID,
	).
		WithRequestContext(ipAddress, userAgent).
		WithRequestID(requestID).
		WithSuccess(true).
		WithMetadataMap(metadata).
		Build()

	return l.LogAuthEvent(event)
}

// LogAPIKeyRevoked logs when an API key is revoked
func (l *AuthAuditLogger) LogAPIKeyRevoked(ctx context.Context, actorID, tenantID, ipAddress, userAgent, requestID string, metadata map[string]interface{}) error {
	event := types.NewAuditEventBuilder(
		types.EventAuthAPIKeyRevoked,
		actorID,
		tenantID,
	).
		WithRequestContext(ipAddress, userAgent).
		WithRequestID(requestID).
		WithSuccess(true).
		WithMetadataMap(metadata).
		Build()

	return l.LogAuthEvent(event)
}

// worker processes buffered events in batches
func (l *AuthAuditLogger) worker() {
	ticker := time.NewTicker(l.flushInterval)
	defer ticker.Stop()

	batch := make([]*types.AuditEvent, 0, l.batchSize)

	flush := func() {
		if len(batch) == 0 {
			return
		}

		startTime := time.Now()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		// Store batch
		for _, event := range batch {
			if err := l.backend.Store(ctx, event); err != nil {
				l.eventsFailed++
				// Log error but continue processing
				fmt.Printf("Failed to store audit event: %v\n", err)
				continue
			}
			// Update hash chain after successful storage
			l.hashChain.UpdateLastHash(event.Hash)
		}

		// Update metrics
		l.lastFlushTime = time.Now()
		l.lastFlushDuration = time.Since(startTime)

		// Clear batch
		batch = batch[:0]
	}

	for {
		select {
		case <-l.ctx.Done():
			// Flush remaining events before shutdown
			flush()
			return

		case event := <-l.eventBuffer:
			batch = append(batch, event)
			if len(batch) >= l.batchSize {
				flush()
			}

		case <-ticker.C:
			// Periodic flush
			flush()
		}
	}
}

// Close gracefully shuts down the logger
func (l *AuthAuditLogger) Close() error {
	l.cancel()
	// Give worker time to flush
	time.Sleep(200 * time.Millisecond)
	close(l.eventBuffer)
	return nil
}

// Query retrieves audit events based on query criteria
func (l *AuthAuditLogger) Query(ctx context.Context, query *types.AuditQuery) (*types.AuditQueryResult, error) {
	return l.backend.Query(ctx, query)
}

// GetStatistics retrieves aggregate statistics
func (l *AuthAuditLogger) GetStatistics(ctx context.Context, tenantID string, timeRange time.Duration) (*types.AuditStatistics, error) {
	return l.backend.GetStatistics(ctx, tenantID, timeRange)
}

// VerifyIntegrity verifies the hash chain integrity for a range of events
func (l *AuthAuditLogger) VerifyIntegrity(ctx context.Context, tenantID string, startTime, endTime time.Time) (bool, error) {
	query := &types.AuditQuery{
		TenantID:  &tenantID,
		StartTime: &startTime,
		EndTime:   &endTime,
		Limit:     10000, // Process in chunks if needed
		SortBy:    "timestamp",
		SortOrder: "asc",
	}

	result, err := l.backend.Query(ctx, query)
	if err != nil {
		return false, fmt.Errorf("failed to query events for verification: %w", err)
	}

	return VerifyChain(result.Events)
}

// GetMetrics returns current logger metrics
func (l *AuthAuditLogger) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"events_logged":        l.eventsLogged,
		"events_dropped":       l.eventsDropped,
		"events_failed":        l.eventsFailed,
		"buffer_size":          len(l.eventBuffer),
		"buffer_capacity":      l.bufferSize,
		"last_flush_time":      l.lastFlushTime,
		"last_flush_duration":  l.lastFlushDuration.String(),
	}
}
