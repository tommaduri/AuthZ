// Package jwt provides JWT token generation and validation
package jwt

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// TokenPair represents an access token and refresh token pair
type TokenPair struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
}

// Claims represents JWT claims structure per SDD specification
type Claims struct {
	jwt.RegisteredClaims
	Roles    []string `json:"roles"`
	TenantID string   `json:"tenant_id"`
	Scopes   []string `json:"scopes"`
}

// IssuerConfig contains configuration for JWT token issuance
type IssuerConfig struct {
	PrivateKey    *rsa.PrivateKey
	Issuer        string
	Audience      string
	AccessTTL     time.Duration
	RefreshTTL    time.Duration
	RefreshStore  RefreshTokenStore
	Logger        *zap.Logger
}

// JWTIssuer generates and signs JWT tokens
type JWTIssuer struct {
	privateKey   *rsa.PrivateKey
	issuer       string
	audience     string
	accessTTL    time.Duration
	refreshTTL   time.Duration
	refreshStore RefreshTokenStore
	logger       *zap.Logger
}

// RefreshTokenStore defines the interface for refresh token storage
type RefreshTokenStore interface {
	Store(ctx context.Context, token *RefreshToken) error
	Get(ctx context.Context, tokenHash string) (*RefreshToken, error)
	Revoke(ctx context.Context, tokenHash string) error
	DeleteExpired(ctx context.Context) error
}

// RefreshToken represents a stored refresh token
type RefreshToken struct {
	ID             string
	TokenHash      string
	AgentID        string
	AccessTokenJTI string
	CreatedAt      time.Time
	ExpiresAt      time.Time
	RevokedAt      *time.Time
	LastUsedAt     *time.Time
}

// NewJWTIssuer creates a new JWT token issuer
func NewJWTIssuer(cfg *IssuerConfig) (*JWTIssuer, error) {
	if cfg == nil {
		return nil, fmt.Errorf("config is required")
	}
	if cfg.PrivateKey == nil {
		return nil, fmt.Errorf("private key is required")
	}
	if cfg.Issuer == "" {
		return nil, fmt.Errorf("issuer is required")
	}
	if cfg.Audience == "" {
		return nil, fmt.Errorf("audience is required")
	}

	// Set defaults
	if cfg.AccessTTL == 0 {
		cfg.AccessTTL = 1 * time.Hour
	}
	if cfg.RefreshTTL == 0 {
		cfg.RefreshTTL = 7 * 24 * time.Hour
	}
	if cfg.Logger == nil {
		cfg.Logger = zap.NewNop()
	}

	return &JWTIssuer{
		privateKey:   cfg.PrivateKey,
		issuer:       cfg.Issuer,
		audience:     cfg.Audience,
		accessTTL:    cfg.AccessTTL,
		refreshTTL:   cfg.RefreshTTL,
		refreshStore: cfg.RefreshStore,
		logger:       cfg.Logger,
	}, nil
}

// IssueToken generates a new access token and refresh token pair
func (i *JWTIssuer) IssueToken(ctx context.Context, agentID string, roles []string, tenantID string, scopes []string) (*TokenPair, error) {
	now := time.Now()

	// Generate unique JTI (JWT ID) for access token
	jti, err := generateSecureID()
	if err != nil {
		return nil, fmt.Errorf("generate JTI: %w", err)
	}

	// Create access token claims
	claims := &Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   agentID,
			Issuer:    i.issuer,
			Audience:  jwt.ClaimStrings{i.audience},
			ExpiresAt: jwt.NewNumericDate(now.Add(i.accessTTL)),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        jti,
		},
		Roles:    roles,
		TenantID: tenantID,
		Scopes:   scopes,
	}

	// Sign access token with RS256
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	accessToken, err := token.SignedString(i.privateKey)
	if err != nil {
		return nil, fmt.Errorf("sign access token: %w", err)
	}

	// Generate refresh token
	refreshToken, err := i.GenerateRefreshToken(ctx, agentID, jti)
	if err != nil {
		return nil, fmt.Errorf("generate refresh token: %w", err)
	}

	// Build scope string
	scopeStr := ""
	if len(scopes) > 0 {
		for idx, scope := range scopes {
			if idx > 0 {
				scopeStr += " "
			}
			scopeStr += scope
		}
	}

	return &TokenPair{
		AccessToken:  accessToken,
		TokenType:    "Bearer",
		ExpiresIn:    int64(i.accessTTL.Seconds()),
		RefreshToken: refreshToken,
		Scope:        scopeStr,
	}, nil
}

// GenerateRefreshToken generates a new refresh token and stores it
func (i *JWTIssuer) GenerateRefreshToken(ctx context.Context, agentID string, accessTokenJTI string) (string, error) {
	// Generate secure random token (256-bit)
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", fmt.Errorf("generate random token: %w", err)
	}

	// Format: refresh_{base64url(token)}
	tokenStr := "refresh_" + base64.RawURLEncoding.EncodeToString(tokenBytes)

	// Hash the token for storage (SHA-256)
	hash := sha256.Sum256([]byte(tokenStr))
	tokenHash := base64.RawURLEncoding.EncodeToString(hash[:])

	// Store refresh token if store is configured
	if i.refreshStore != nil {
		refreshToken := &RefreshToken{
			ID:             generateUUID(),
			TokenHash:      tokenHash,
			AgentID:        agentID,
			AccessTokenJTI: accessTokenJTI,
			CreatedAt:      time.Now(),
			ExpiresAt:      time.Now().Add(i.refreshTTL),
		}

		if err := i.refreshStore.Store(ctx, refreshToken); err != nil {
			return "", fmt.Errorf("store refresh token: %w", err)
		}
	}

	return tokenStr, nil
}

// RefreshToken validates a refresh token and issues a new access token
func (i *JWTIssuer) RefreshToken(ctx context.Context, refreshTokenStr string) (*TokenPair, error) {
	if i.refreshStore == nil {
		return nil, fmt.Errorf("refresh token store not configured")
	}

	// Hash the refresh token
	hash := sha256.Sum256([]byte(refreshTokenStr))
	tokenHash := base64.RawURLEncoding.EncodeToString(hash[:])

	// Lookup refresh token
	refreshToken, err := i.refreshStore.Get(ctx, tokenHash)
	if err != nil {
		return nil, fmt.Errorf("refresh token not found: %w", err)
	}

	// Check if token is revoked
	if refreshToken.RevokedAt != nil {
		return nil, fmt.Errorf("refresh token has been revoked")
	}

	// Check if token is expired
	if time.Now().After(refreshToken.ExpiresAt) {
		return nil, fmt.Errorf("refresh token has expired")
	}

	// TODO: Load agent details to get roles, tenant_id, scopes
	// For now, issue token with minimal claims - this should be enhanced to fetch from agent store
	// This is a placeholder that assumes we'll integrate with the agent service
	agentID := refreshToken.AgentID
	roles := []string{} // Should be loaded from agent store
	tenantID := ""      // Should be loaded from agent store
	scopes := []string{} // Should be loaded from agent store

	// Issue new token pair
	newPair, err := i.IssueToken(ctx, agentID, roles, tenantID, scopes)
	if err != nil {
		return nil, fmt.Errorf("issue new token: %w", err)
	}

	// Update last used timestamp (optional - for audit)
	// This could be done async to reduce latency

	return newPair, nil
}

// RevokeToken revokes an access or refresh token
// Requires Redis client to be configured
func (i *JWTIssuer) RevokeToken(ctx context.Context, jti string, expiresAt time.Time, redisClient *redis.Client) error {
	if redisClient == nil {
		return fmt.Errorf("redis client not configured")
	}

	// Use TokenRevoker for centralized revocation logic
	revoker := NewTokenRevoker(redisClient)
	err := revoker.RevokeToken(ctx, jti, expiresAt)
	if err != nil {
		return fmt.Errorf("revoke token: %w", err)
	}

	i.logger.Info("Token revoked via issuer", zap.String("jti", jti))
	return nil
}

// Helper functions

// generateSecureID generates a cryptographically secure random ID
func generateSecureID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// generateUUID generates a simple UUID-like string (not RFC 4122 compliant)
// For production, use github.com/google/uuid
func generateUUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
