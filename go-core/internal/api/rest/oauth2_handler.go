package rest

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/authz-engine/go-core/internal/auth"
)

// OAuth2Config holds configuration for OAuth2 endpoints
type OAuth2Config struct {
	// RateLimitPerClient is the maximum requests per minute per client_id
	RateLimitPerClient int

	// RateLimitWindow is the time window for rate limiting
	RateLimitWindow time.Duration
}

// DefaultOAuth2Config returns default OAuth2 configuration
func DefaultOAuth2Config() *OAuth2Config {
	return &OAuth2Config{
		RateLimitPerClient: 60,  // 60 requests per minute
		RateLimitWindow:    time.Minute,
	}
}

// OAuth2HTTPHandler handles HTTP requests for OAuth2 endpoints
type OAuth2HTTPHandler struct {
	handler     *auth.OAuth2Handler
	config      *OAuth2Config
	rateLimiter *clientRateLimiter
}

// NewOAuth2HTTPHandler creates a new OAuth2 HTTP handler
func NewOAuth2HTTPHandler(handler *auth.OAuth2Handler, config *OAuth2Config) *OAuth2HTTPHandler {
	if config == nil {
		config = DefaultOAuth2Config()
	}

	return &OAuth2HTTPHandler{
		handler:     handler,
		config:      config,
		rateLimiter: newClientRateLimiter(config.RateLimitPerClient, config.RateLimitWindow),
	}
}

// HandleTokenRequest handles POST /oauth/token requests (RFC 6749 Section 4.4.2)
func (h *OAuth2HTTPHandler) HandleTokenRequest(w http.ResponseWriter, r *http.Request) {
	// Only accept POST method
	if r.Method != http.MethodPost {
		writeOAuth2Error(w, http.StatusMethodNotAllowed, "invalid_request", "Only POST method is allowed")
		return
	}

	// Parse Content-Type (RFC 6749 requires application/x-www-form-urlencoded or JSON)
	contentType := r.Header.Get("Content-Type")

	var tokenReq auth.TokenRequest
	var err error

	// Support both form-encoded and JSON (though RFC 6749 specifies form-encoded)
	if contentType == "application/json" {
		err = json.NewDecoder(r.Body).Decode(&tokenReq)
	} else {
		// Parse form-encoded data (RFC 6749 Section 4.4.2)
		if err = r.ParseForm(); err == nil {
			tokenReq = auth.TokenRequest{
				GrantType:    r.FormValue("grant_type"),
				ClientID:     r.FormValue("client_id"),
				ClientSecret: r.FormValue("client_secret"),
				Scope:        r.FormValue("scope"),
			}
		}
	}

	if err != nil {
		writeOAuth2Error(w, http.StatusBadRequest, "invalid_request", "Failed to parse request body")
		return
	}

	// Rate limiting per client_id
	if tokenReq.ClientID != "" {
		if !h.rateLimiter.Allow(tokenReq.ClientID) {
			writeOAuth2Error(w, http.StatusTooManyRequests, "invalid_request", "Rate limit exceeded")
			return
		}
	}

	// Issue token
	tokenResp, err := h.handler.IssueToken(r.Context(), &tokenReq)
	if err != nil {
		// Map errors to OAuth2 error codes (RFC 6749 Section 5.2)
		switch err {
		case auth.ErrInvalidGrantType:
			writeOAuth2Error(w, http.StatusBadRequest, "unsupported_grant_type", err.Error())
		case auth.ErrInvalidClientCredentials:
			writeOAuth2Error(w, http.StatusUnauthorized, "invalid_client", "Invalid client credentials")
		case auth.ErrInvalidScope:
			writeOAuth2Error(w, http.StatusBadRequest, "invalid_scope", err.Error())
		case auth.ErrMissingClientID, auth.ErrMissingClientSecret:
			writeOAuth2Error(w, http.StatusBadRequest, "invalid_request", err.Error())
		default:
			writeOAuth2Error(w, http.StatusInternalServerError, "server_error", "Internal server error")
		}
		return
	}

	// Return successful token response (RFC 6749 Section 5.1)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(tokenResp)
}

// writeOAuth2Error writes an OAuth2 error response (RFC 6749 Section 5.2)
func writeOAuth2Error(w http.ResponseWriter, status int, errorCode, description string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	w.WriteHeader(status)

	json.NewEncoder(w).Encode(auth.ErrorResponse{
		Error:            errorCode,
		ErrorDescription: description,
	})
}

// clientRateLimiter implements per-client rate limiting using token bucket
type clientRateLimiter struct {
	mu       sync.RWMutex
	clients  map[string]*rateLimitBucket
	limit    int
	window   time.Duration
	cleanupT *time.Ticker
}

// rateLimitBucket tracks rate limit state for a single client
type rateLimitBucket struct {
	tokens   int
	lastSeen time.Time
}

// newClientRateLimiter creates a new client rate limiter
func newClientRateLimiter(limit int, window time.Duration) *clientRateLimiter {
	rl := &clientRateLimiter{
		clients: make(map[string]*rateLimitBucket),
		limit:   limit,
		window:  window,
	}

	// Cleanup old entries every 5 minutes
	rl.cleanupT = time.NewTicker(5 * time.Minute)
	go rl.cleanup()

	return rl
}

// Allow checks if a request should be allowed for the given client
func (rl *clientRateLimiter) Allow(clientID string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	bucket, exists := rl.clients[clientID]

	if !exists || now.Sub(bucket.lastSeen) > rl.window {
		// Create new bucket or reset expired one
		rl.clients[clientID] = &rateLimitBucket{
			tokens:   rl.limit - 1,
			lastSeen: now,
		}
		return true
	}

	if bucket.tokens > 0 {
		bucket.tokens--
		bucket.lastSeen = now
		return true
	}

	return false
}

// cleanup removes old rate limit entries
func (rl *clientRateLimiter) cleanup() {
	for range rl.cleanupT.C {
		rl.mu.Lock()
		now := time.Now()
		for clientID, bucket := range rl.clients {
			if now.Sub(bucket.lastSeen) > rl.window*2 {
				delete(rl.clients, clientID)
			}
		}
		rl.mu.Unlock()
	}
}

// Stop stops the rate limiter cleanup goroutine
func (rl *clientRateLimiter) Stop() {
	rl.cleanupT.Stop()
}
