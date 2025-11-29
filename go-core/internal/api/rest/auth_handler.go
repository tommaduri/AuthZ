package rest

import (
	"net/http"
	"time"

	"github.com/authz-engine/go-core/internal/auth"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// AuthHandler handles authentication-related HTTP requests
type AuthHandler struct {
	issuer *auth.TokenIssuer
	logger *zap.Logger
}

// NewAuthHandler creates a new authentication handler
func NewAuthHandler(issuer *auth.TokenIssuer, logger *zap.Logger) *AuthHandler {
	if logger == nil {
		logger = zap.NewNop()
	}

	return &AuthHandler{
		issuer: issuer,
		logger: logger,
	}
}

// TokenRequest represents the OAuth2 client credentials token request
type TokenRequest struct {
	GrantType    string `json:"grant_type" binding:"required"`
	ClientID     string `json:"client_id" binding:"required"`
	ClientSecret string `json:"client_secret" binding:"required"`
	Scope        string `json:"scope"`
	TenantID     string `json:"tenant_id"` // Added for multi-tenancy
}

// RefreshRequest represents a token refresh request
type RefreshRequest struct {
	GrantType    string `json:"grant_type" binding:"required"`
	RefreshToken string `json:"refresh_token" binding:"required"`
}

// RevokeRequest represents a token revocation request
type RevokeRequest struct {
	Token         string `json:"token" binding:"required"`
	TokenTypeHint string `json:"token_type_hint"` // "access_token" or "refresh_token"
}

// TokenResponse represents the OAuth2 token response
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in"`
	RefreshToken string `json:"refresh_token,omitempty"`
	Scope        string `json:"scope,omitempty"`
}

// OAuth2ErrorResponse represents an error response per OAuth2 spec (RFC 6749)
type OAuth2ErrorResponse struct {
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description,omitempty"`
}

// IssueToken handles POST /v1/auth/token (OAuth2 client credentials flow)
// Per SDD specification:
// - Validates client_id and client_secret
// - Issues access and refresh tokens
// - Returns 200 OK with token pair
// - Returns 401 for invalid credentials
// - Returns 429 for rate limit exceeded (handled by middleware)
func (h *AuthHandler) IssueToken(c *gin.Context) {
	var req TokenRequest

	// Bind and validate request
	if err := c.ShouldBindJSON(&req); err != nil {
		h.logger.Warn("Invalid token request",
			zap.Error(err),
			zap.String("remote_addr", c.ClientIP()))

		c.JSON(http.StatusBadRequest, OAuth2ErrorResponse{
			Error:            "invalid_request",
			ErrorDescription: "Missing or invalid request parameters",
		})
		return
	}

	// Validate grant_type
	if req.GrantType != "client_credentials" {
		c.JSON(http.StatusBadRequest, OAuth2ErrorResponse{
			Error:            "unsupported_grant_type",
			ErrorDescription: "Only 'client_credentials' grant type is supported",
		})
		return
	}

	// Extract tenant ID (default to client_id's tenant if not provided)
	tenantID := req.TenantID
	if tenantID == "" {
		// Extract from client_id or use default
		tenantID = "default"
	}

	// Issue token (includes password validation and credential checking)
	startTime := time.Now()
	tokenPair, err := h.issuer.IssueToken(req.ClientID, req.ClientSecret, tenantID)
	duration := time.Since(startTime)

	if err != nil {
		h.logger.Warn("Token issuance failed",
			zap.String("client_id", req.ClientID),
			zap.String("tenant_id", tenantID),
			zap.Error(err),
			zap.Duration("duration", duration),
			zap.String("remote_addr", c.ClientIP()))

		// Check error type for proper HTTP status
		if err.Error() == "invalid credentials" ||
			err.Error() == "agent not found" ||
			err.Error() == "incorrect password" {
			c.JSON(http.StatusUnauthorized, OAuth2ErrorResponse{
				Error:            "invalid_client",
				ErrorDescription: "Invalid client credentials",
			})
			return
		}

		if err.Error() == "agent is not active" {
			c.JSON(http.StatusForbidden, OAuth2ErrorResponse{
				Error:            "access_denied",
				ErrorDescription: "Client account is not active",
			})
			return
		}

		// Generic server error
		c.JSON(http.StatusInternalServerError, OAuth2ErrorResponse{
			Error:            "server_error",
			ErrorDescription: "An error occurred while processing the request",
		})
		return
	}

	h.logger.Info("Token issued successfully",
		zap.String("client_id", req.ClientID),
		zap.String("tenant_id", tenantID),
		zap.Duration("duration", duration),
		zap.String("remote_addr", c.ClientIP()))

	// Return OAuth2-compliant token response
	c.JSON(http.StatusOK, TokenResponse{
		AccessToken:  tokenPair.AccessToken,
		TokenType:    tokenPair.TokenType,
		ExpiresIn:    tokenPair.ExpiresIn,
		RefreshToken: tokenPair.RefreshToken,
		Scope:        tokenPair.Scope,
	})
}

// RefreshToken handles POST /v1/auth/refresh
// Per SDD specification:
// - Validates refresh_token
// - Issues new access token
// - Returns 200 OK with new token
// - Returns 401 for invalid/expired refresh token
func (h *AuthHandler) RefreshToken(c *gin.Context) {
	var req RefreshRequest

	// Bind and validate request
	if err := c.ShouldBindJSON(&req); err != nil {
		h.logger.Warn("Invalid refresh request",
			zap.Error(err),
			zap.String("remote_addr", c.ClientIP()))

		c.JSON(http.StatusBadRequest, OAuth2ErrorResponse{
			Error:            "invalid_request",
			ErrorDescription: "Missing or invalid request parameters",
		})
		return
	}

	// Validate grant_type
	if req.GrantType != "refresh_token" {
		c.JSON(http.StatusBadRequest, OAuth2ErrorResponse{
			Error:            "unsupported_grant_type",
			ErrorDescription: "Only 'refresh_token' grant type is supported for this endpoint",
		})
		return
	}

	// Refresh token
	startTime := time.Now()
	tokenPair, err := h.issuer.RefreshToken(req.RefreshToken)
	duration := time.Since(startTime)

	if err != nil {
		h.logger.Warn("Token refresh failed",
			zap.Error(err),
			zap.Duration("duration", duration),
			zap.String("remote_addr", c.ClientIP()))

		// Check error type
		if err.Error() == "refresh token not found" ||
			err.Error() == "refresh token has expired" ||
			err.Error() == "refresh token has been revoked" {
			c.JSON(http.StatusUnauthorized, OAuth2ErrorResponse{
				Error:            "invalid_grant",
				ErrorDescription: "The refresh token is invalid, expired, or revoked",
			})
			return
		}

		c.JSON(http.StatusInternalServerError, OAuth2ErrorResponse{
			Error:            "server_error",
			ErrorDescription: "An error occurred while processing the request",
		})
		return
	}

	h.logger.Info("Token refreshed successfully",
		zap.Duration("duration", duration),
		zap.String("remote_addr", c.ClientIP()))

	c.JSON(http.StatusOK, TokenResponse{
		AccessToken: tokenPair.AccessToken,
		TokenType:   tokenPair.TokenType,
		ExpiresIn:   tokenPair.ExpiresIn,
		Scope:       tokenPair.Scope,
	})
}

// RevokeToken handles POST /v1/auth/revoke
// Per SDD specification:
// - Revokes access or refresh token
// - Adds to Redis blacklist with TTL = token expiry
// - Returns 200 OK on success
// - Logs revocation event
func (h *AuthHandler) RevokeToken(c *gin.Context) {
	var req RevokeRequest

	// Bind and validate request
	if err := c.ShouldBindJSON(&req); err != nil {
		h.logger.Warn("Invalid revoke request",
			zap.Error(err),
			zap.String("remote_addr", c.ClientIP()))

		c.JSON(http.StatusBadRequest, OAuth2ErrorResponse{
			Error:            "invalid_request",
			ErrorDescription: "Missing or invalid request parameters",
		})
		return
	}

	// Revoke token
	startTime := time.Now()
	err := h.issuer.RevokeToken(req.Token)
	duration := time.Since(startTime)

	if err != nil {
		h.logger.Error("Token revocation failed",
			zap.Error(err),
			zap.Duration("duration", duration),
			zap.String("token_type_hint", req.TokenTypeHint),
			zap.String("remote_addr", c.ClientIP()))

		// Per OAuth2 spec, revocation should always return 200 OK
		// even if token doesn't exist (idempotent operation)
		// But we log the error for monitoring
	}

	h.logger.Info("Token revoked successfully",
		zap.Duration("duration", duration),
		zap.String("token_type_hint", req.TokenTypeHint),
		zap.String("remote_addr", c.ClientIP()))

	// Always return success per OAuth2 RFC 7009 (idempotent)
	c.JSON(http.StatusOK, gin.H{
		"message": "Token revoked successfully",
	})
}

// RegisterRoutes registers authentication routes on the router
func (h *AuthHandler) RegisterRoutes(router *gin.RouterGroup) {
	auth := router.Group("/auth")
	{
		auth.POST("/token", h.IssueToken)
		auth.POST("/refresh", h.RefreshToken)
		auth.POST("/revoke", h.RevokeToken)
	}
}
