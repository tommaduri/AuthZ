package jwt

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// RevokeHandler handles token revocation requests
type RevokeHandler struct {
	validator *JWTValidator
	revoker   *TokenRevoker
	logger    *zap.Logger
}

// NewRevokeHandler creates a new revocation handler
func NewRevokeHandler(validator *JWTValidator, redisClient *redis.Client, logger *zap.Logger) *RevokeHandler {
	if logger == nil {
		logger = zap.NewNop()
	}

	return &RevokeHandler{
		validator: validator,
		revoker:   NewTokenRevoker(redisClient),
		logger:    logger,
	}
}

// RevokeRequest represents the revocation request payload
type RevokeRequest struct {
	Token string `json:"token"`
}

// RevokeResponse represents the revocation response
type RevokeResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
}

// ErrorResponse represents an error response
type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

// ServeHTTP handles POST /v1/auth/revoke
// Request body: {"token": "jwt_token_string"}
// Response: {"success": true} or {"error": "...", "message": "..."}
func (h *RevokeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Only accept POST
	if r.Method != http.MethodPost {
		h.writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Only POST method is allowed")
		return
	}

	// Parse request body
	var req RevokeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.logger.Warn("Invalid request body", zap.Error(err))
		h.writeError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON request body")
		return
	}

	// Validate token is provided
	if req.Token == "" {
		h.writeError(w, http.StatusBadRequest, "invalid_request", "Token is required")
		return
	}

	// Parse token to extract JTI and expiration
	token, err := jwt.ParseWithClaims(req.Token, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		// We only need to parse, not validate signature here
		// Return nil key to skip signature verification (we just need claims)
		return nil, nil
	}, jwt.WithoutClaimsValidation())

	var jti string
	var expiresAt time.Time

	if err != nil || token == nil {
		// If parsing fails, we can't extract JTI
		h.logger.Warn("Failed to parse token for revocation", zap.Error(err))
		h.writeError(w, http.StatusBadRequest, "invalid_token", "Unable to parse token")
		return
	}

	// Extract claims
	claims, ok := token.Claims.(*Claims)
	if !ok || claims.ID == "" {
		h.writeError(w, http.StatusBadRequest, "invalid_token", "Token missing JTI claim")
		return
	}

	jti = claims.ID
	if claims.ExpiresAt != nil {
		expiresAt = claims.ExpiresAt.Time
	} else {
		// If no expiration, set a default TTL (e.g., 24 hours)
		expiresAt = time.Now().Add(24 * time.Hour)
		h.logger.Warn("Token has no expiration, using default TTL", zap.String("jti", jti))
	}

	// Revoke the token
	if err := h.revoker.RevokeToken(ctx, jti, expiresAt); err != nil {
		h.logger.Error("Failed to revoke token", zap.Error(err), zap.String("jti", jti))
		h.writeError(w, http.StatusInternalServerError, "revocation_failed", "Failed to revoke token")
		return
	}

	h.logger.Info("Token revoked successfully", zap.String("jti", jti))

	// Return success
	h.writeSuccess(w, "Token revoked successfully")
}

// writeSuccess writes a successful response
func (h *RevokeHandler) writeSuccess(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(RevokeResponse{
		Success: true,
		Message: message,
	})
}

// writeError writes an error response
func (h *RevokeHandler) writeError(w http.ResponseWriter, statusCode int, errorCode string, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(ErrorResponse{
		Error:   errorCode,
		Message: message,
	})
}

// BatchRevokeHandler handles batch revocation requests
type BatchRevokeHandler struct {
	revoker *TokenRevoker
	logger  *zap.Logger
}

// NewBatchRevokeHandler creates a new batch revocation handler
func NewBatchRevokeHandler(redisClient *redis.Client, logger *zap.Logger) *BatchRevokeHandler {
	if logger == nil {
		logger = zap.NewNop()
	}

	return &BatchRevokeHandler{
		revoker: NewTokenRevoker(redisClient),
		logger:  logger,
	}
}

// BatchRevokeRequest represents a batch revocation request
type BatchRevokeRequest struct {
	Tokens []string `json:"tokens"`
}

// BatchRevokeResponse represents a batch revocation response
type BatchRevokeResponse struct {
	Success      bool     `json:"success"`
	RevokedCount int      `json:"revoked_count"`
	FailedTokens []string `json:"failed_tokens,omitempty"`
	Message      string   `json:"message,omitempty"`
}

// ServeHTTP handles POST /v1/auth/revoke/batch
func (h *BatchRevokeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if r.Method != http.MethodPost {
		h.writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Only POST method is allowed")
		return
	}

	var req BatchRevokeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.logger.Warn("Invalid request body", zap.Error(err))
		h.writeError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON request body")
		return
	}

	if len(req.Tokens) == 0 {
		h.writeError(w, http.StatusBadRequest, "invalid_request", "At least one token is required")
		return
	}

	// Parse all tokens to extract JTI and expiration
	tokensMap := make(map[string]time.Time)
	var failedTokens []string

	for _, tokenStr := range req.Tokens {
		token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(token *jwt.Token) (interface{}, error) {
			return nil, nil
		}, jwt.WithoutClaimsValidation())

		if err != nil || token == nil {
			failedTokens = append(failedTokens, tokenStr)
			continue
		}

		claims, ok := token.Claims.(*Claims)
		if !ok || claims.ID == "" {
			failedTokens = append(failedTokens, tokenStr)
			continue
		}

		expiresAt := time.Now().Add(24 * time.Hour) // Default
		if claims.ExpiresAt != nil {
			expiresAt = claims.ExpiresAt.Time
		}

		tokensMap[claims.ID] = expiresAt
	}

	// Batch revoke
	if len(tokensMap) > 0 {
		if err := h.revoker.RevokeTokenBatch(ctx, tokensMap); err != nil {
			h.logger.Error("Batch revocation failed", zap.Error(err))
			h.writeError(w, http.StatusInternalServerError, "revocation_failed", "Batch revocation failed")
			return
		}
	}

	h.logger.Info("Batch revocation completed",
		zap.Int("total", len(req.Tokens)),
		zap.Int("revoked", len(tokensMap)),
		zap.Int("failed", len(failedTokens)))

	// Return response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(BatchRevokeResponse{
		Success:      true,
		RevokedCount: len(tokensMap),
		FailedTokens: failedTokens,
		Message:      "Batch revocation completed",
	})
}

func (h *BatchRevokeHandler) writeError(w http.ResponseWriter, statusCode int, errorCode string, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(ErrorResponse{
		Error:   errorCode,
		Message: message,
	})
}
