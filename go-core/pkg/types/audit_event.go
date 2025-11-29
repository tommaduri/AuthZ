package types

import (
	"time"
)

// AuditEventType represents the type of audit event
type AuditEventType string

const (
	// Authentication Events
	EventAuthLoginSuccess      AuditEventType = "auth.login.success"
	EventAuthLoginFailure      AuditEventType = "auth.login.failure"
	EventAuthLogout            AuditEventType = "auth.logout"

	// Token Events
	EventAuthTokenIssued       AuditEventType = "auth.token.issued"
	EventAuthTokenValidated    AuditEventType = "auth.token.validated"
	EventAuthTokenRevoked      AuditEventType = "auth.token.revoked"
	EventAuthTokenRefreshed    AuditEventType = "auth.token.refreshed"

	// API Key Events
	EventAuthAPIKeyCreated     AuditEventType = "auth.apikey.created"
	EventAuthAPIKeyUsed        AuditEventType = "auth.apikey.used"
	EventAuthAPIKeyRevoked     AuditEventType = "auth.apikey.revoked"

	// Password Events
	EventAuthPasswordChanged   AuditEventType = "auth.password.changed"
	EventAuthPasswordReset     AuditEventType = "auth.password.reset"
	EventAuthPasswordResetRequested AuditEventType = "auth.password.reset_requested"

	// MFA Events
	EventAuthMFAEnabled        AuditEventType = "auth.mfa.enabled"
	EventAuthMFADisabled       AuditEventType = "auth.mfa.disabled"
	EventAuthMFASuccess        AuditEventType = "auth.mfa.success"
	EventAuthMFAFailure        AuditEventType = "auth.mfa.failure"

	// Session Events
	EventAuthSessionCreated    AuditEventType = "auth.session.created"
	EventAuthSessionTerminated AuditEventType = "auth.session.terminated"

	// Authorization Events
	EventAuthzAccessGranted    AuditEventType = "authz.access.granted"
	EventAuthzAccessDenied     AuditEventType = "authz.access.denied"
)

// AuditEvent represents a single audit log entry with tamper detection
type AuditEvent struct {
	// Core Identification
	ID        string         `json:"id" db:"id"`
	Timestamp time.Time      `json:"timestamp" db:"timestamp"`
	EventType AuditEventType `json:"event_type" db:"event_type"`

	// Actor Information
	ActorID   string `json:"actor_id" db:"actor_id"`                     // User/service performing action
	AgentID   string `json:"agent_id,omitempty" db:"agent_id"`          // AI agent if applicable
	TenantID  string `json:"tenant_id" db:"tenant_id"`                  // Multi-tenant isolation

	// Request Context
	IPAddress  string `json:"ip_address" db:"ip_address"`
	UserAgent  string `json:"user_agent" db:"user_agent"`
	RequestID  string `json:"request_id,omitempty" db:"request_id"`     // Correlation ID

	// Event Details
	Success      bool   `json:"success" db:"success"`
	ErrorMessage string `json:"error_message,omitempty" db:"error_message"`
	ErrorCode    string `json:"error_code,omitempty" db:"error_code"`

	// Additional Context (stored as JSONB in PostgreSQL)
	Metadata map[string]interface{} `json:"metadata,omitempty" db:"metadata"`

	// Tamper Detection (Hash Chain)
	PrevHash string `json:"prev_hash" db:"prev_hash"` // SHA-256 of previous event
	Hash     string `json:"hash" db:"hash"`           // SHA-256 of this event
}

// AuditEventBuilder provides a fluent interface for building audit events
type AuditEventBuilder struct {
	event *AuditEvent
}

// NewAuditEventBuilder creates a new audit event builder
func NewAuditEventBuilder(eventType AuditEventType, actorID, tenantID string) *AuditEventBuilder {
	return &AuditEventBuilder{
		event: &AuditEvent{
			EventType: eventType,
			ActorID:   actorID,
			TenantID:  tenantID,
			Timestamp: time.Now().UTC(),
			Metadata:  make(map[string]interface{}),
		},
	}
}

// WithAgentID sets the agent ID
func (b *AuditEventBuilder) WithAgentID(agentID string) *AuditEventBuilder {
	b.event.AgentID = agentID
	return b
}

// WithRequestContext sets IP address and user agent
func (b *AuditEventBuilder) WithRequestContext(ipAddress, userAgent string) *AuditEventBuilder {
	b.event.IPAddress = ipAddress
	b.event.UserAgent = userAgent
	return b
}

// WithRequestID sets the request correlation ID
func (b *AuditEventBuilder) WithRequestID(requestID string) *AuditEventBuilder {
	b.event.RequestID = requestID
	return b
}

// WithSuccess sets the success status
func (b *AuditEventBuilder) WithSuccess(success bool) *AuditEventBuilder {
	b.event.Success = success
	return b
}

// WithError sets error details
func (b *AuditEventBuilder) WithError(message, code string) *AuditEventBuilder {
	b.event.ErrorMessage = message
	b.event.ErrorCode = code
	b.event.Success = false
	return b
}

// WithMetadata adds metadata key-value pairs
func (b *AuditEventBuilder) WithMetadata(key string, value interface{}) *AuditEventBuilder {
	b.event.Metadata[key] = value
	return b
}

// WithMetadataMap sets multiple metadata values
func (b *AuditEventBuilder) WithMetadataMap(metadata map[string]interface{}) *AuditEventBuilder {
	for k, v := range metadata {
		b.event.Metadata[k] = v
	}
	return b
}

// Build returns the constructed audit event
func (b *AuditEventBuilder) Build() *AuditEvent {
	return b.event
}

// AuditQuery represents search criteria for audit logs
type AuditQuery struct {
	// Time Range
	StartTime *time.Time
	EndTime   *time.Time

	// Filters
	EventTypes []AuditEventType
	ActorID    *string
	TenantID   *string
	Success    *bool

	// Pagination
	Limit  int
	Offset int

	// Sorting
	SortBy    string // timestamp, event_type, actor_id
	SortOrder string // asc, desc
}

// AuditQueryResult represents the result of an audit log query
type AuditQueryResult struct {
	Events     []*AuditEvent `json:"events"`
	TotalCount int           `json:"total_count"`
	HasMore    bool          `json:"has_more"`
}

// AuditStatistics provides aggregate statistics for audit events
type AuditStatistics struct {
	TenantID       string                    `json:"tenant_id"`
	TimeRange      string                    `json:"time_range"`
	TotalEvents    int64                     `json:"total_events"`
	SuccessCount   int64                     `json:"success_count"`
	FailureCount   int64                     `json:"failure_count"`
	EventsByType   map[AuditEventType]int64  `json:"events_by_type"`
	EventsByActor  map[string]int64          `json:"events_by_actor"`
	UniqueActors   int64                     `json:"unique_actors"`
	UniqueIPAddrs  int64                     `json:"unique_ip_addresses"`
}
