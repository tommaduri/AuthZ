package ratelimit

import (
	"context"
	"time"
)

// Limiter defines the interface for rate limiting operations
type Limiter interface {
	// Allow checks if a request is allowed for the given key
	// Returns:
	//   - allowed: true if request is allowed
	//   - remaining: number of requests remaining in current window
	//   - resetTime: when the rate limit window resets
	Allow(ctx context.Context, key string) (allowed bool, remaining int, resetTime time.Time, err error)

	// AllowN checks if N requests are allowed for the given key
	AllowN(ctx context.Context, key string, n int) (allowed bool, remaining int, resetTime time.Time, err error)

	// Reset clears the rate limit for a key
	Reset(ctx context.Context, key string) error

	// GetLimit returns the current limit for a key
	GetLimit(ctx context.Context, key string) (limit int, err error)

	// Close releases resources
	Close() error
}

// Result holds the result of a rate limit check
type Result struct {
	Allowed   bool
	Remaining int
	ResetTime time.Time
	Limit     int
}
