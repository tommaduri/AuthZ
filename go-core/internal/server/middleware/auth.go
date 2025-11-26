// Package middleware provides server interceptors and middleware
package middleware

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/authz-engine/go-core/internal/auth"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// contextKey is a custom type for context keys to avoid collisions
type contextKey string

const (
	claimsContextKey contextKey = "jwt_claims"
)

// Authenticator provides authentication middleware for gRPC and HTTP
type Authenticator struct {
	validator *auth.JWTValidator
	skipPaths map[string]bool
}

// NewAuthenticator creates a new authenticator with the given JWT validator
func NewAuthenticator(validator *auth.JWTValidator, skipPaths []string) *Authenticator {
	skipMap := make(map[string]bool)
	for _, path := range skipPaths {
		skipMap[path] = true
	}

	return &Authenticator{
		validator: validator,
		skipPaths: skipMap,
	}
}

// GRPCUnaryInterceptor returns a gRPC unary server interceptor for authentication
func (a *Authenticator) GRPCUnaryInterceptor() grpc.UnaryServerInterceptor {
	return func(
		ctx context.Context,
		req interface{},
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (interface{}, error) {
		// Skip authentication for certain methods
		if a.shouldSkip(info.FullMethod) {
			return handler(ctx, req)
		}

		// Extract token from metadata
		token, err := extractTokenFromGRPC(ctx)
		if err != nil {
			return nil, status.Error(codes.Unauthenticated, "missing or invalid authorization header")
		}

		// Validate token
		claims, err := a.validator.Validate(token)
		if err != nil {
			return nil, status.Error(codes.Unauthenticated, "invalid token")
		}

		// Inject claims into context
		ctx = withClaims(ctx, claims)

		// Continue with handler
		return handler(ctx, req)
	}
}

// GRPCStreamInterceptor returns a gRPC stream server interceptor for authentication
func (a *Authenticator) GRPCStreamInterceptor() grpc.StreamServerInterceptor {
	return func(
		srv interface{},
		ss grpc.ServerStream,
		info *grpc.StreamServerInfo,
		handler grpc.StreamHandler,
	) error {
		// Skip authentication for certain methods
		if a.shouldSkip(info.FullMethod) {
			return handler(srv, ss)
		}

		// Extract token from metadata
		token, err := extractTokenFromGRPC(ss.Context())
		if err != nil {
			return status.Error(codes.Unauthenticated, "missing or invalid authorization header")
		}

		// Validate token
		claims, err := a.validator.Validate(token)
		if err != nil {
			return status.Error(codes.Unauthenticated, "invalid token")
		}

		// Inject claims into context
		ctx := withClaims(ss.Context(), claims)

		// Wrap the stream with the new context
		wrappedStream := &authenticatedStream{
			ServerStream: ss,
			ctx:          ctx,
		}

		// Continue with handler
		return handler(srv, wrappedStream)
	}
}

// HTTPMiddleware returns an HTTP middleware for authentication
func (a *Authenticator) HTTPMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip authentication for certain paths
		if a.shouldSkip(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}

		// Extract token from Authorization header
		token, err := extractTokenFromHTTP(r)
		if err != nil {
			http.Error(w, "Unauthorized: missing or invalid authorization header", http.StatusUnauthorized)
			return
		}

		// Validate token
		claims, err := a.validator.Validate(token)
		if err != nil {
			http.Error(w, "Unauthorized: invalid token", http.StatusUnauthorized)
			return
		}

		// Inject claims into request context
		ctx := withClaims(r.Context(), claims)
		r = r.WithContext(ctx)

		// Continue with next handler
		next.ServeHTTP(w, r)
	})
}

// shouldSkip checks if authentication should be skipped for the given path/method
func (a *Authenticator) shouldSkip(path string) bool {
	return a.skipPaths[path]
}

// extractTokenFromGRPC extracts the JWT token from gRPC metadata
func extractTokenFromGRPC(ctx context.Context) (string, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return "", fmt.Errorf("missing metadata")
	}

	values := md.Get("authorization")
	if len(values) == 0 {
		return "", fmt.Errorf("missing authorization header")
	}

	return parseBearer(values[0])
}

// extractTokenFromHTTP extracts the JWT token from HTTP Authorization header
func extractTokenFromHTTP(r *http.Request) (string, error) {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return "", fmt.Errorf("missing authorization header")
	}

	return parseBearer(authHeader)
}

// parseBearer parses "Bearer <token>" format and returns the token
func parseBearer(authHeader string) (string, error) {
	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 {
		return "", fmt.Errorf("invalid authorization format")
	}

	if !strings.EqualFold(parts[0], "Bearer") {
		return "", fmt.Errorf("authorization header must be Bearer scheme")
	}

	return parts[1], nil
}

// withClaims adds JWT claims to the context
func withClaims(ctx context.Context, claims *auth.Claims) context.Context {
	return context.WithValue(ctx, claimsContextKey, claims)
}

// ClaimsFromContext extracts JWT claims from the context
func ClaimsFromContext(ctx context.Context) (*auth.Claims, bool) {
	claims, ok := ctx.Value(claimsContextKey).(*auth.Claims)
	return claims, ok
}

// authenticatedStream wraps a grpc.ServerStream with an authenticated context
type authenticatedStream struct {
	grpc.ServerStream
	ctx context.Context
}

// Context returns the authenticated context
func (s *authenticatedStream) Context() context.Context {
	return s.ctx
}
