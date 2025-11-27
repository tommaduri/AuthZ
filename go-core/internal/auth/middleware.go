// Package auth provides authentication middleware for HTTP handlers
package auth

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"go.uber.org/zap"

	"github.com/authz-engine/go-core/internal/auth/jwt"
)

// contextKey is a custom type for context keys to avoid collisions
type contextKey string

const (
	// PrincipalContextKey is the context key for the authenticated principal
	PrincipalContextKey contextKey = "principal"
	// ClaimsContextKey is the context key for JWT claims
	ClaimsContextKey contextKey = "jwt_claims"
)

// Middleware provides authentication middleware
type Middleware struct {
	validator *jwt.JWTValidator
	logger    *zap.Logger
	optional  bool // If true, don't reject requests without auth
}

// NewMiddleware creates a new authentication middleware
func NewMiddleware(validator *jwt.JWTValidator, logger *zap.Logger) *Middleware {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &Middleware{
		validator: validator,
		logger:    logger,
		optional:  false,
	}
}

// NewOptionalMiddleware creates middleware that doesn't require authentication
func NewOptionalMiddleware(validator *jwt.JWTValidator, logger *zap.Logger) *Middleware {
	m := NewMiddleware(validator, logger)
	m.optional = true
	return m
}

// Handler returns an HTTP middleware handler
func (m *Middleware) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Extract token from Authorization header
		token, err := m.extractToken(r)
		if err != nil {
			if !m.optional {
				m.respondUnauthorized(w, "missing or invalid authorization header")
				return
			}
			// Optional auth - continue without principal
			next.ServeHTTP(w, r)
			return
		}

		// Validate token
		claims, err := m.validator.Validate(r.Context(), token)
		if err != nil {
			m.logger.Warn("Token validation failed",
				zap.Error(err),
				zap.String("path", r.URL.Path),
			)
			if !m.optional {
				m.respondUnauthorized(w, fmt.Sprintf("invalid token: %v", err))
				return
			}
			// Optional auth - continue without principal
			next.ServeHTTP(w, r)
			return
		}

		// Extract principal from claims
		principal := m.validator.ExtractPrincipal(claims)

		// Add principal and claims to context
		ctx := r.Context()
		ctx = context.WithValue(ctx, PrincipalContextKey, principal)
		ctx = context.WithValue(ctx, ClaimsContextKey, claims)

		// Continue with updated context
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// extractToken extracts the JWT token from the Authorization header
func (m *Middleware) extractToken(r *http.Request) (string, error) {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return "", fmt.Errorf("missing authorization header")
	}

	// Expected format: "Bearer <token>"
	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 {
		return "", fmt.Errorf("invalid authorization header format")
	}

	if parts[0] != "Bearer" {
		return "", fmt.Errorf("authorization header must use Bearer scheme")
	}

	token := strings.TrimSpace(parts[1])
	if token == "" {
		return "", fmt.Errorf("empty token")
	}

	return token, nil
}

// respondUnauthorized sends a 401 Unauthorized response
func (m *Middleware) respondUnauthorized(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("WWW-Authenticate", "Bearer")
	w.WriteHeader(http.StatusUnauthorized)

	response := fmt.Sprintf(`{"error":"unauthorized","message":"%s"}`, message)
	w.Write([]byte(response))
}

// GetPrincipal extracts the Principal from a request context
func GetPrincipal(ctx context.Context) (*jwt.Principal, error) {
	principal, ok := ctx.Value(PrincipalContextKey).(*jwt.Principal)
	if !ok || principal == nil {
		return nil, fmt.Errorf("no principal in context")
	}
	return principal, nil
}

// GetClaims extracts the JWT claims from a request context
func GetClaims(ctx context.Context) (*jwt.Claims, error) {
	claims, ok := ctx.Value(ClaimsContextKey).(*jwt.Claims)
	if !ok || claims == nil {
		return nil, fmt.Errorf("no claims in context")
	}
	return claims, nil
}

// RequireRole returns middleware that requires a specific role
func RequireRole(role string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			principal, err := GetPrincipal(r.Context())
			if err != nil {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}

			hasRole := false
			for _, r := range principal.Roles {
				if r == role {
					hasRole = true
					break
				}
			}

			if !hasRole {
				http.Error(w, "Forbidden: insufficient permissions", http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// RequireAnyRole returns middleware that requires any of the specified roles
func RequireAnyRole(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			principal, err := GetPrincipal(r.Context())
			if err != nil {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}

			hasRole := false
			for _, required := range roles {
				for _, userRole := range principal.Roles {
					if userRole == required {
						hasRole = true
						break
					}
				}
				if hasRole {
					break
				}
			}

			if !hasRole {
				http.Error(w, "Forbidden: insufficient permissions", http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
