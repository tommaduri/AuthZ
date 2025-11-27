package auth

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// AuditEvent represents an audit log event
type AuditEvent struct {
	EventID    uuid.UUID              `json:"event_id"`
	Timestamp  time.Time              `json:"timestamp"`
	EventType  string                 `json:"event_type"`
	AgentID    string                 `json:"agent_id,omitempty"`
	TenantID   string                 `json:"tenant_id,omitempty"`
	KeyID      *uuid.UUID             `json:"key_id,omitempty"`
	KeyPrefix  string                 `json:"key_prefix,omitempty"`
	Action     string                 `json:"action"`
	Result     string                 `json:"result"` // success, failure, error
	IPAddress  string                 `json:"ip_address,omitempty"`
	UserAgent  string                 `json:"user_agent,omitempty"`
	Details    map[string]interface{} `json:"details,omitempty"`
	ErrorMsg   string                 `json:"error_msg,omitempty"`
}

// AuditLogger defines the interface for audit logging
type AuditLogger interface {
	// Log logs an audit event
	Log(ctx context.Context, event *AuditEvent) error

	// LogAPIKeyCreated logs API key creation
	LogAPIKeyCreated(ctx context.Context, key *APIKey, ipAddress, userAgent string) error

	// LogAPIKeyValidation logs API key validation attempt
	LogAPIKeyValidation(ctx context.Context, keyPrefix, agentID, tenantID, result, ipAddress, userAgent string) error

	// LogAPIKeyRevoked logs API key revocation
	LogAPIKeyRevoked(ctx context.Context, keyID uuid.UUID, revokedBy, ipAddress, userAgent string) error

	// LogAPIKeyDeleted logs API key deletion
	LogAPIKeyDeleted(ctx context.Context, keyID uuid.UUID, deletedBy, ipAddress, userAgent string) error

	// LogRateLimitExceeded logs rate limit violations
	LogRateLimitExceeded(ctx context.Context, keyID uuid.UUID, keyPrefix, agentID, ipAddress string) error
}

// NoOpAuditLogger is a no-op implementation for when audit logging is disabled
type NoOpAuditLogger struct{}

func (l *NoOpAuditLogger) Log(ctx context.Context, event *AuditEvent) error {
	return nil
}

func (l *NoOpAuditLogger) LogAPIKeyCreated(ctx context.Context, key *APIKey, ipAddress, userAgent string) error {
	return nil
}

func (l *NoOpAuditLogger) LogAPIKeyValidation(ctx context.Context, keyPrefix, agentID, tenantID, result, ipAddress, userAgent string) error {
	return nil
}

func (l *NoOpAuditLogger) LogAPIKeyRevoked(ctx context.Context, keyID uuid.UUID, revokedBy, ipAddress, userAgent string) error {
	return nil
}

func (l *NoOpAuditLogger) LogAPIKeyDeleted(ctx context.Context, keyID uuid.UUID, deletedBy, ipAddress, userAgent string) error {
	return nil
}

func (l *NoOpAuditLogger) LogRateLimitExceeded(ctx context.Context, keyID uuid.UUID, keyPrefix, agentID, ipAddress string) error {
	return nil
}

// StructuredAuditLogger logs to structured logging (JSON)
type StructuredAuditLogger struct {
	logger Logger // Generic logger interface
}

// Logger interface for structured logging
type Logger interface {
	Info(msg string, fields ...interface{})
	Error(msg string, fields ...interface{})
}

// NewStructuredAuditLogger creates a new structured audit logger
func NewStructuredAuditLogger(logger Logger) *StructuredAuditLogger {
	return &StructuredAuditLogger{
		logger: logger,
	}
}

func (l *StructuredAuditLogger) Log(ctx context.Context, event *AuditEvent) error {
	// Convert event to JSON for structured logging
	eventJSON, err := json.Marshal(event)
	if err != nil {
		l.logger.Error("Failed to marshal audit event", "error", err)
		return err
	}

	if event.Result == "failure" || event.Result == "error" {
		l.logger.Error("Audit event", "event", string(eventJSON))
	} else {
		l.logger.Info("Audit event", "event", string(eventJSON))
	}

	return nil
}

func (l *StructuredAuditLogger) LogAPIKeyCreated(ctx context.Context, key *APIKey, ipAddress, userAgent string) error {
	event := &AuditEvent{
		EventID:   uuid.New(),
		Timestamp: time.Now(),
		EventType: "api_key.created",
		AgentID:   key.AgentID,
		TenantID:  key.TenantID,
		KeyID:     &key.KeyID,
		KeyPrefix: key.KeyPrefix,
		Action:    "create_api_key",
		Result:    "success",
		IPAddress: ipAddress,
		UserAgent: userAgent,
		Details: map[string]interface{}{
			"name":              key.Name,
			"scopes":            key.Scopes,
			"rate_limit_per_sec": key.RateLimitPerSec,
			"expires_at":        key.ExpiresAt,
		},
	}

	return l.Log(ctx, event)
}

func (l *StructuredAuditLogger) LogAPIKeyValidation(ctx context.Context, keyPrefix, agentID, tenantID, result, ipAddress, userAgent string) error {
	event := &AuditEvent{
		EventID:   uuid.New(),
		Timestamp: time.Now(),
		EventType: "api_key.validation",
		AgentID:   agentID,
		TenantID:  tenantID,
		KeyPrefix: keyPrefix,
		Action:    "validate_api_key",
		Result:    result,
		IPAddress: ipAddress,
		UserAgent: userAgent,
	}

	return l.Log(ctx, event)
}

func (l *StructuredAuditLogger) LogAPIKeyRevoked(ctx context.Context, keyID uuid.UUID, revokedBy, ipAddress, userAgent string) error {
	event := &AuditEvent{
		EventID:   uuid.New(),
		Timestamp: time.Now(),
		EventType: "api_key.revoked",
		KeyID:     &keyID,
		Action:    "revoke_api_key",
		Result:    "success",
		IPAddress: ipAddress,
		UserAgent: userAgent,
		Details: map[string]interface{}{
			"revoked_by": revokedBy,
		},
	}

	return l.Log(ctx, event)
}

func (l *StructuredAuditLogger) LogAPIKeyDeleted(ctx context.Context, keyID uuid.UUID, deletedBy, ipAddress, userAgent string) error {
	event := &AuditEvent{
		EventID:   uuid.New(),
		Timestamp: time.Now(),
		EventType: "api_key.deleted",
		KeyID:     &keyID,
		Action:    "delete_api_key",
		Result:    "success",
		IPAddress: ipAddress,
		UserAgent: userAgent,
		Details: map[string]interface{}{
			"deleted_by": deletedBy,
		},
	}

	return l.Log(ctx, event)
}

func (l *StructuredAuditLogger) LogRateLimitExceeded(ctx context.Context, keyID uuid.UUID, keyPrefix, agentID, ipAddress string) error {
	event := &AuditEvent{
		EventID:   uuid.New(),
		Timestamp: time.Now(),
		EventType: "api_key.rate_limit_exceeded",
		AgentID:   agentID,
		KeyID:     &keyID,
		KeyPrefix: keyPrefix,
		Action:    "rate_limit_check",
		Result:    "failure",
		IPAddress: ipAddress,
		Details: map[string]interface{}{
			"reason": "rate_limit_exceeded",
		},
	}

	return l.Log(ctx, event)
}

// DatabaseAuditLogger logs to a database table
type DatabaseAuditLogger struct {
	store AuditStore
}

// AuditStore defines the interface for storing audit events
type AuditStore interface {
	StoreAuditEvent(ctx context.Context, event *AuditEvent) error
}

// NewDatabaseAuditLogger creates a new database audit logger
func NewDatabaseAuditLogger(store AuditStore) *DatabaseAuditLogger {
	return &DatabaseAuditLogger{
		store: store,
	}
}

func (l *DatabaseAuditLogger) Log(ctx context.Context, event *AuditEvent) error {
	return l.store.StoreAuditEvent(ctx, event)
}

func (l *DatabaseAuditLogger) LogAPIKeyCreated(ctx context.Context, key *APIKey, ipAddress, userAgent string) error {
	event := &AuditEvent{
		EventID:   uuid.New(),
		Timestamp: time.Now(),
		EventType: "api_key.created",
		AgentID:   key.AgentID,
		TenantID:  key.TenantID,
		KeyID:     &key.KeyID,
		KeyPrefix: key.KeyPrefix,
		Action:    "create_api_key",
		Result:    "success",
		IPAddress: ipAddress,
		UserAgent: userAgent,
		Details: map[string]interface{}{
			"name":              key.Name,
			"scopes":            key.Scopes,
			"rate_limit_per_sec": key.RateLimitPerSec,
		},
	}

	return l.Log(ctx, event)
}

func (l *DatabaseAuditLogger) LogAPIKeyValidation(ctx context.Context, keyPrefix, agentID, tenantID, result, ipAddress, userAgent string) error {
	event := &AuditEvent{
		EventID:   uuid.New(),
		Timestamp: time.Now(),
		EventType: "api_key.validation",
		AgentID:   agentID,
		TenantID:  tenantID,
		KeyPrefix: keyPrefix,
		Action:    "validate_api_key",
		Result:    result,
		IPAddress: ipAddress,
		UserAgent: userAgent,
	}

	return l.Log(ctx, event)
}

func (l *DatabaseAuditLogger) LogAPIKeyRevoked(ctx context.Context, keyID uuid.UUID, revokedBy, ipAddress, userAgent string) error {
	event := &AuditEvent{
		EventID:   uuid.New(),
		Timestamp: time.Now(),
		EventType: "api_key.revoked",
		KeyID:     &keyID,
		Action:    "revoke_api_key",
		Result:    "success",
		IPAddress: ipAddress,
		UserAgent: userAgent,
		Details: map[string]interface{}{
			"revoked_by": revokedBy,
		},
	}

	return l.Log(ctx, event)
}

func (l *DatabaseAuditLogger) LogAPIKeyDeleted(ctx context.Context, keyID uuid.UUID, deletedBy, ipAddress, userAgent string) error {
	event := &AuditEvent{
		EventID:   uuid.New(),
		Timestamp: time.Now(),
		EventType: "api_key.deleted",
		KeyID:     &keyID,
		Action:    "delete_api_key",
		Result:    "success",
		IPAddress: ipAddress,
		UserAgent: userAgent,
		Details: map[string]interface{}{
			"deleted_by": deletedBy,
		},
	}

	return l.Log(ctx, event)
}

func (l *DatabaseAuditLogger) LogRateLimitExceeded(ctx context.Context, keyID uuid.UUID, keyPrefix, agentID, ipAddress string) error {
	event := &AuditEvent{
		EventID:   uuid.New(),
		Timestamp: time.Now(),
		EventType: "api_key.rate_limit_exceeded",
		AgentID:   agentID,
		KeyID:     &keyID,
		KeyPrefix: keyPrefix,
		Action:    "rate_limit_check",
		Result:    "failure",
		IPAddress: ipAddress,
	}

	return l.Log(ctx, event)
}
