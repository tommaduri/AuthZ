package auth

import "errors"

var (
	// ErrAPIKeyNotFound is returned when an API key is not found
	ErrAPIKeyNotFound = errors.New("API key not found")

	// ErrAPIKeyRevoked is returned when an API key has been revoked
	ErrAPIKeyRevoked = errors.New("API key has been revoked")

	// ErrAPIKeyExpired is returned when an API key has expired
	ErrAPIKeyExpired = errors.New("API key has expired")

	// ErrInvalidAPIKey is returned when an API key format is invalid
	ErrInvalidAPIKey = errors.New("invalid API key format")

	// ErrRateLimitExceeded is returned when rate limit is exceeded
	ErrRateLimitExceeded = errors.New("rate limit exceeded")

	// ErrUnauthorized is returned when authentication fails
	ErrUnauthorized = errors.New("unauthorized")

	// ErrInsufficientScope is returned when API key lacks required scope
	ErrInsufficientScope = errors.New("insufficient scope")
)
