package apikey

import (
	"context"
	"net/http"
	"strings"

	"github.com/authz-engine/go-core/internal/auth"
)

const (
	// API Key header name
	APIKeyHeader = "X-API-Key"

	// Context key for storing the principal
	PrincipalContextKey = "principal"
)

// Middleware provides HTTP middleware for API key authentication
type Middleware struct {
	validator *Validator
	optional  bool // If true, allows requests without API keys
}

// NewMiddleware creates a new API key middleware
func NewMiddleware(validator *Validator, optional bool) *Middleware {
	return &Middleware{
		validator: validator,
		optional:  optional,
	}
}

// Authenticate is an HTTP middleware that validates API keys
func (m *Middleware) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Extract API key from header
		apiKey := r.Header.Get(APIKeyHeader)

		// If no API key and optional mode, continue
		if apiKey == "" {
			if m.optional {
				next.ServeHTTP(w, r)
				return
			}
			http.Error(w, "missing API key", http.StatusUnauthorized)
			return
		}

		// Validate API key
		principal, err := m.validator.ValidateAPIKey(r.Context(), apiKey)
		if err != nil {
			if err == ErrAPIKeyExpired {
				http.Error(w, "API key expired", http.StatusUnauthorized)
			} else if err == ErrAPIKeyRevoked {
				http.Error(w, "API key revoked", http.StatusUnauthorized)
			} else if strings.Contains(err.Error(), "rate limit exceeded") {
				http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
			} else {
				http.Error(w, "invalid API key", http.StatusUnauthorized)
			}
			return
		}

		// Set principal in context
		ctx := context.WithValue(r.Context(), PrincipalContextKey, principal)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetPrincipal extracts the principal from the request context
func GetPrincipal(ctx context.Context) *auth.Principal {
	principal, ok := ctx.Value(PrincipalContextKey).(*auth.Principal)
	if !ok {
		return nil
	}
	return principal
}
