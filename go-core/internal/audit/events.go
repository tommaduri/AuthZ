package audit

import (
	"time"

	"github.com/google/uuid"
)

// Event type constants
const (
	EventAPIKeyCreated     = "api_key_created"
	EventAPIKeyValidated   = "api_key_validated"
	EventAPIKeyRevoked     = "api_key_revoked"
	EventTokenIssued       = "token_issued"
	EventTokenRefreshed    = "token_refreshed"
	EventTokenRevoked      = "token_revoked"
	EventLoginSuccess      = "login_success"
	EventLoginFailure      = "login_failure"
	EventLogout            = "logout"
	EventRateLimitExceeded = "rate_limit_exceeded"
	EventPermissionDenied  = "permission_denied"
)

// AuditEvent represents an authentication audit log entry
type AuditEvent struct {
	ID            uuid.UUID              `json:"id"`
	EventType     string                 `json:"event_type"`
	UserID        *string                `json:"user_id,omitempty"`
	AgentID       *string                `json:"agent_id,omitempty"`
	APIKeyID      *uuid.UUID             `json:"api_key_id,omitempty"`
	TenantID      string                 `json:"tenant_id"`
	Timestamp     time.Time              `json:"timestamp"`
	IPAddress     string                 `json:"ip_address"`
	UserAgent     string                 `json:"user_agent"`
	Success       bool                   `json:"success"`
	ErrorMessage  string                 `json:"error_message,omitempty"`
	RequestID     string                 `json:"request_id"`
	Metadata      map[string]interface{} `json:"metadata,omitempty"`
	EventHash     string                 `json:"current_hash"`
	PrevEventHash string                 `json:"prev_hash,omitempty"`
}

// AuditFilter filters audit log queries
type AuditFilter struct {
	TenantID   string
	UserID     string
	EventTypes []string
	Success    *bool     // nil = all, true = success only, false = failures only
	StartTime  time.Time
	EndTime    time.Time
	Limit      int
	Offset     int
}

// NewAuditEvent creates a new audit event with defaults
func NewAuditEvent(eventType, tenantID string) *AuditEvent {
	return &AuditEvent{
		ID:        uuid.New(),
		EventType: eventType,
		TenantID:  tenantID,
		Timestamp: time.Now().UTC(),
		Metadata:  make(map[string]interface{}),
		Success:   true, // Default to success, caller should set to false if needed
	}
}

// WithUserID sets the user ID for the event
func (e *AuditEvent) WithUserID(userID string) *AuditEvent {
	e.UserID = &userID
	return e
}

// WithAgentID sets the agent ID for the event
func (e *AuditEvent) WithAgentID(agentID string) *AuditEvent {
	e.AgentID = &agentID
	return e
}

// WithAPIKeyID sets the API key ID for the event
func (e *AuditEvent) WithAPIKeyID(keyID uuid.UUID) *AuditEvent {
	e.APIKeyID = &keyID
	return e
}

// WithIPAddress sets the IP address for the event
func (e *AuditEvent) WithIPAddress(ip string) *AuditEvent {
	e.IPAddress = ip
	return e
}

// WithUserAgent sets the user agent for the event
func (e *AuditEvent) WithUserAgent(ua string) *AuditEvent {
	e.UserAgent = ua
	return e
}

// WithRequestID sets the request ID for the event
func (e *AuditEvent) WithRequestID(reqID string) *AuditEvent {
	e.RequestID = reqID
	return e
}

// WithSuccess sets the success status for the event
func (e *AuditEvent) WithSuccess(success bool) *AuditEvent {
	e.Success = success
	return e
}

// WithError sets the error message for the event and marks it as failed
func (e *AuditEvent) WithError(err string) *AuditEvent {
	e.ErrorMessage = err
	e.Success = false
	return e
}

// WithMetadata adds metadata to the event
func (e *AuditEvent) WithMetadata(key string, value interface{}) *AuditEvent {
	if e.Metadata == nil {
		e.Metadata = make(map[string]interface{})
	}
	e.Metadata[key] = value
	return e
}
