package middleware

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/authz-engine/go-core/internal/ratelimit"
)

// AuditLogger is a simple interface for audit logging
type AuditLogger interface {
	Log(ctx context.Context, event interface{}) error
}

// RateLimitMiddleware implements HTTP rate limiting middleware
type RateLimitMiddleware struct {
	limiter ratelimit.Limiter
	audit   AuditLogger
}

// NewRateLimitMiddleware creates a new rate limit middleware
func NewRateLimitMiddleware(limiter ratelimit.Limiter, auditLogger AuditLogger) *RateLimitMiddleware {
	return &RateLimitMiddleware{
		limiter: limiter,
		audit:   auditLogger,
	}
}

// Handler wraps an HTTP handler with rate limiting
func (m *RateLimitMiddleware) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Extract client identifier
		clientIP := m.extractClientIP(r)

		// Build rate limit key based on endpoint
		key := m.buildRateLimitKey(r, clientIP)

		// Check rate limit
		allowed, remaining, resetTime, err := m.limiter.Allow(r.Context(), key)

		if err != nil {
			// Log error but allow request (fail open)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}

		// Add rate limit headers
		m.addRateLimitHeaders(w, allowed, remaining, resetTime)

		if !allowed {
			// Log rate limit exceeded event
			if m.audit != nil {
				m.audit.Log(r.Context(), map[string]interface{}{
					"type":       "rate_limit_exceeded",
					"actor":      clientIP,
					"action":     r.Method + " " + r.URL.Path,
					"resource":   r.URL.Path,
					"timestamp":  time.Now(),
					"ip":         clientIP,
					"user_agent": r.UserAgent(),
					"endpoint":   r.URL.Path,
					"method":     r.Method,
					"reset_time": resetTime,
				})
			}

			// Return 429 Too Many Requests
			w.Header().Set("Retry-After", strconv.FormatInt(int64(time.Until(resetTime).Seconds()), 10))
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"error":"rate_limit_exceeded","message":"Too many requests","retry_after":"` + time.Until(resetTime).String() + `"}`))
			return
		}

		// Request allowed, continue
		next.ServeHTTP(w, r)
	})
}

// extractClientIP extracts the client IP address from the request
func (m *RateLimitMiddleware) extractClientIP(r *http.Request) string {
	// Check X-Forwarded-For header first (for proxies/load balancers)
	xff := r.Header.Get("X-Forwarded-For")
	if xff != "" {
		// Take the first IP in the list
		ips := strings.Split(xff, ",")
		if len(ips) > 0 {
			return strings.TrimSpace(ips[0])
		}
	}

	// Check X-Real-IP header
	xri := r.Header.Get("X-Real-IP")
	if xri != "" {
		return strings.TrimSpace(xri)
	}

	// Fall back to RemoteAddr
	ip := r.RemoteAddr
	// Remove port if present
	if idx := strings.LastIndex(ip, ":"); idx != -1 {
		ip = ip[:idx]
	}

	return ip
}

// buildRateLimitKey constructs the rate limit key based on endpoint and client
func (m *RateLimitMiddleware) buildRateLimitKey(r *http.Request, clientIP string) string {
	// Check if this is an auth endpoint
	if strings.HasPrefix(r.URL.Path, "/v1/auth/") {
		// Use stricter rate limiting for auth endpoints
		return fmt.Sprintf("auth:%s:%s", r.URL.Path, clientIP)
	}

	// Check if we have an authenticated user
	if userID := m.extractUserID(r); userID != "" {
		return fmt.Sprintf("user:%s", userID)
	}

	// Default to IP-based rate limiting
	return fmt.Sprintf("ip:%s", clientIP)
}

// extractUserID extracts user ID from request context or headers
func (m *RateLimitMiddleware) extractUserID(r *http.Request) string {
	// Check context first (set by auth middleware)
	if userID := r.Context().Value("user_id"); userID != nil {
		if uid, ok := userID.(string); ok {
			return uid
		}
	}

	// Check Authorization header for user identification
	authHeader := r.Header.Get("Authorization")
	if authHeader != "" && strings.HasPrefix(authHeader, "Bearer ") {
		// In a real implementation, you would validate and extract user from token
		// For now, we'll use the token hash as identifier
		token := strings.TrimPrefix(authHeader, "Bearer ")
		if len(token) > 0 {
			return fmt.Sprintf("token:%s", token[:min(32, len(token))])
		}
	}

	return ""
}

// addRateLimitHeaders adds rate limit information to response headers
func (m *RateLimitMiddleware) addRateLimitHeaders(w http.ResponseWriter, allowed bool, remaining int, resetTime time.Time) {
	// X-RateLimit-Limit: maximum number of requests
	// This would need to be retrieved from config, using 100 as example
	w.Header().Set("X-RateLimit-Limit", "100")

	// X-RateLimit-Remaining: requests remaining in current window
	w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))

	// X-RateLimit-Reset: Unix timestamp when limit resets
	w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(resetTime.Unix(), 10))

	// Add additional custom header with human-readable reset time
	w.Header().Set("X-RateLimit-Reset-After", time.Until(resetTime).String())
}

// min returns the minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// RateLimitConfig holds configuration for rate limit middleware
type RateLimitConfig struct {
	// SkipPaths are paths to skip rate limiting
	SkipPaths []string

	// CustomLimits maps paths to custom rate limits
	CustomLimits map[string]int
}

// ShouldSkip checks if a path should skip rate limiting
func (c *RateLimitConfig) ShouldSkip(path string) bool {
	for _, skip := range c.SkipPaths {
		if strings.HasPrefix(path, skip) {
			return true
		}
	}
	return false
}
