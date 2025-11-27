// Package db provides database schema constants and helpers
package db

import (
	"time"

	"github.com/google/uuid"
)

// Table names as constants for type safety
const (
	TableAPIKeys         = "api_keys"
	TableRefreshTokens   = "refresh_tokens"
	TableAuthAuditLogs   = "auth_audit_logs"
	TableRateLimitState  = "rate_limit_state"
)

// Column names for compile-time checking
const (
	// Common columns
	ColID        = "id"
	ColTenantID  = "tenant_id"
	ColCreatedAt = "created_at"
	ColUpdatedAt = "updated_at"

	// API Keys columns
	ColKeyHash      = "key_hash"
	ColName         = "name"
	ColAgentID      = "agent_id"
	ColScopes       = "scopes"
	ColExpiresAt    = "expires_at"
	ColLastUsedAt   = "last_used_at"
	ColRevokedAt    = "revoked_at"
	ColRateLimitRPS = "rate_limit_rps"
	ColMetadata     = "metadata"
	ColCreatedBy    = "created_by"

	// Refresh Tokens columns
	ColTokenHash     = "token_hash"
	ColUserID        = "user_id"
	ColParentTokenID = "parent_token_id"

	// Auth Audit Logs columns
	ColEventType     = "event_type"
	ColAPIKeyID      = "api_key_id"
	ColIPAddress     = "ip_address"
	ColUserAgent     = "user_agent"
	ColSuccess       = "success"
	ColErrorMessage  = "error_message"
	ColTimestamp     = "timestamp"
	ColRequestID     = "request_id"

	// Rate Limit State columns
	ColKey        = "key"
	ColTokens     = "tokens"
	ColLastRefill = "last_refill"
)

// Event types for audit logs
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

// Schema models matching database tables

// APIKey represents an API key record
type APIKey struct {
	ID           uuid.UUID   `db:"id" json:"id"`
	KeyHash      string      `db:"key_hash" json:"-"` // Never expose in JSON
	Name         string      `db:"name" json:"name"`
	AgentID      string      `db:"agent_id" json:"agent_id"`
	Scopes       []string    `db:"scopes" json:"scopes"`
	CreatedAt    time.Time   `db:"created_at" json:"created_at"`
	ExpiresAt    *time.Time  `db:"expires_at" json:"expires_at,omitempty"`
	LastUsedAt   *time.Time  `db:"last_used_at" json:"last_used_at,omitempty"`
	RevokedAt    *time.Time  `db:"revoked_at" json:"revoked_at,omitempty"`
	RateLimitRPS int         `db:"rate_limit_rps" json:"rate_limit_rps"`
	TenantID     string      `db:"tenant_id" json:"tenant_id"`
	Metadata     interface{} `db:"metadata" json:"metadata,omitempty"`
	CreatedBy    *string     `db:"created_by" json:"created_by,omitempty"`
}

// IsActive returns true if the key is not revoked and not expired
func (k *APIKey) IsActive() bool {
	if k.RevokedAt != nil {
		return false
	}
	if k.ExpiresAt != nil && k.ExpiresAt.Before(time.Now()) {
		return false
	}
	return true
}

// RefreshToken represents a refresh token record
type RefreshToken struct {
	ID            uuid.UUID   `db:"id" json:"id"`
	TokenHash     string      `db:"token_hash" json:"-"` // Never expose in JSON
	UserID        string      `db:"user_id" json:"user_id"`
	AgentID       *string     `db:"agent_id" json:"agent_id,omitempty"`
	ExpiresAt     time.Time   `db:"expires_at" json:"expires_at"`
	CreatedAt     time.Time   `db:"created_at" json:"created_at"`
	RevokedAt     *time.Time  `db:"revoked_at" json:"revoked_at,omitempty"`
	TenantID      string      `db:"tenant_id" json:"tenant_id"`
	ParentTokenID *uuid.UUID  `db:"parent_token_id" json:"parent_token_id,omitempty"`
	Metadata      interface{} `db:"metadata" json:"metadata,omitempty"`
}

// IsValid returns true if the token is not revoked and not expired
func (t *RefreshToken) IsValid() bool {
	if t.RevokedAt != nil {
		return false
	}
	return t.ExpiresAt.After(time.Now())
}

// AuthAuditLog represents an authentication audit log entry
type AuthAuditLog struct {
	ID           uuid.UUID   `db:"id" json:"id"`
	EventType    string      `db:"event_type" json:"event_type"`
	UserID       *string     `db:"user_id" json:"user_id,omitempty"`
	AgentID      *string     `db:"agent_id" json:"agent_id,omitempty"`
	APIKeyID     *uuid.UUID  `db:"api_key_id" json:"api_key_id,omitempty"`
	IPAddress    *string     `db:"ip_address" json:"ip_address,omitempty"`
	UserAgent    *string     `db:"user_agent" json:"user_agent,omitempty"`
	Success      bool        `db:"success" json:"success"`
	ErrorMessage *string     `db:"error_message" json:"error_message,omitempty"`
	Timestamp    time.Time   `db:"timestamp" json:"timestamp"`
	TenantID     string      `db:"tenant_id" json:"tenant_id"`
	RequestID    *string     `db:"request_id" json:"request_id,omitempty"`
	Metadata     interface{} `db:"metadata" json:"metadata,omitempty"`
}

// RateLimitState represents rate limiting state for a key
type RateLimitState struct {
	Key        string    `db:"key" json:"key"`
	Tokens     float64   `db:"tokens" json:"tokens"`
	LastRefill time.Time `db:"last_refill" json:"last_refill"`
	TenantID   string    `db:"tenant_id" json:"tenant_id"`
	CreatedAt  time.Time `db:"created_at" json:"created_at"`
	UpdatedAt  time.Time `db:"updated_at" json:"updated_at"`
}

// Schema validation helpers

// ValidEventTypes returns all valid event type constants
func ValidEventTypes() []string {
	return []string{
		EventAPIKeyCreated,
		EventAPIKeyValidated,
		EventAPIKeyRevoked,
		EventTokenIssued,
		EventTokenRefreshed,
		EventTokenRevoked,
		EventLoginSuccess,
		EventLoginFailure,
		EventLogout,
		EventRateLimitExceeded,
		EventPermissionDenied,
	}
}

// IsValidEventType checks if an event type is valid
func IsValidEventType(eventType string) bool {
	for _, valid := range ValidEventTypes() {
		if eventType == valid {
			return true
		}
	}
	return false
}

// Schema constraints as constants
const (
	MaxNameLength        = 255
	MaxRateLimitRPS      = 10000
	MinRateLimitRPS      = 1
	DefaultRateLimitRPS  = 100
)

// ValidateAPIKeyName validates API key name constraints
func ValidateAPIKeyName(name string) error {
	if len(name) == 0 {
		return ErrNameEmpty
	}
	if len(name) > MaxNameLength {
		return ErrNameTooLong
	}
	return nil
}

// ValidateRateLimitRPS validates rate limit RPS constraints
func ValidateRateLimitRPS(rps int) error {
	if rps < MinRateLimitRPS {
		return ErrRateLimitTooLow
	}
	if rps > MaxRateLimitRPS {
		return ErrRateLimitTooHigh
	}
	return nil
}

// Schema validation errors
var (
	ErrNameEmpty        = &ValidationError{Field: "name", Message: "name cannot be empty"}
	ErrNameTooLong      = &ValidationError{Field: "name", Message: "name exceeds maximum length"}
	ErrRateLimitTooLow  = &ValidationError{Field: "rate_limit_rps", Message: "rate limit below minimum"}
	ErrRateLimitTooHigh = &ValidationError{Field: "rate_limit_rps", Message: "rate limit exceeds maximum"}
)

// ValidationError represents a schema validation error
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	return e.Field + ": " + e.Message
}
