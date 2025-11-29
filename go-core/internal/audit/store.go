package audit

import (
	"context"
	"time"
)

// Store is the interface for audit log storage
type Store interface {
	// Insert inserts a single audit event
	Insert(ctx context.Context, event *AuditEvent) error

	// InsertBatch inserts multiple audit events in a single transaction
	InsertBatch(ctx context.Context, events []*AuditEvent) error

	// Query retrieves audit events based on filter criteria
	Query(ctx context.Context, filter *AuditFilter) ([]*AuditEvent, error)

	// GetLastEvent retrieves the most recent audit event for a tenant
	GetLastEvent(ctx context.Context, tenantID string) (*AuditEvent, error)

	// VerifyIntegrity verifies the hash chain integrity for a tenant
	VerifyIntegrity(ctx context.Context, tenantID string, from, to time.Time) error

	// GetEventsByTimeRange retrieves events in chronological order for verification
	GetEventsByTimeRange(ctx context.Context, tenantID string, from, to time.Time) ([]*AuditEvent, error)
}
