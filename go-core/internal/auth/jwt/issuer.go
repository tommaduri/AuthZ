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

	"github.com/authz-engine/go-core/internal/agent"
	"github.com/authz-engine/go-core/internal/cache"
	"github.com/authz-engine/go-core/pkg/types"
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
	Roles        []string `json:"roles"`
	TenantID     string   `json:"tenant_id"`
	Scopes       []string `json:"scopes"`
	AgentID      string   `json:"agent_id,omitempty"`
	AgentType    string   `json:"agent_type,omitempty"`
	AgentStatus  string   `json:"agent_status,omitempty"`
	Capabilities []string `json:"capabilities,omitempty"`
}

// IssuerConfig contains configuration for JWT token issuance
type IssuerConfig struct {
	PrivateKey    *rsa.PrivateKey
	Issuer        string
	Audience      string
	AccessTTL     time.Duration
	RefreshTTL    time.Duration
	RefreshStore  RefreshTokenStore
	AgentStore    agent.AgentStore
	AgentCache    cache.Cache
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
	agentStore   agent.AgentStore
	agentCache   cache.Cache
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

	// Create default agent cache if not provided but agent store is
	agentCache := cfg.AgentCache
	if agentCache == nil && cfg.AgentStore != nil {
		agentCache = cache.NewLRU(1000, 5*time.Minute) // 5 min TTL for agent metadata
	}

	return &JWTIssuer{
		privateKey:   cfg.PrivateKey,
		issuer:       cfg.Issuer,
		audience:     cfg.Audience,
		accessTTL:    cfg.AccessTTL,
		refreshTTL:   cfg.RefreshTTL,
		refreshStore: cfg.RefreshStore,
		agentStore:   cfg.AgentStore,
		agentCache:   agentCache,
		logger:       cfg.Logger,
	}, nil
}

// IssueToken generates a new access token and refresh token pair
func (i *JWTIssuer) IssueToken(ctx context.Context, agentID string, roles []string, tenantID string, scopes []string) (*TokenPair, error) {
	now := time.Now()

	// Load agent metadata if agent store is configured
	var agentMetadata *agentMetadata
	if i.agentStore != nil {
		metadata, err := i.getAgentMetadata(ctx, agentID)
		if err != nil {
			return nil, fmt.Errorf("get agent metadata: %w", err)
		}
		agentMetadata = metadata
	}

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

	// Add agent metadata to claims if available
	if agentMetadata != nil {
		claims.AgentID = agentMetadata.ID
		claims.AgentType = agentMetadata.Type
		claims.AgentStatus = agentMetadata.Status
		claims.Capabilities = agentMetadata.Capabilities
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

	// Load agent metadata from agent store
	agentID := refreshToken.AgentID
	var roles []string
	var tenantID string
	var scopes []string

	if i.agentStore != nil {
		metadata, err := i.getAgentMetadata(ctx, agentID)
		if err != nil {
			return nil, fmt.Errorf("get agent metadata: %w", err)
		}

		// Extract roles from agent metadata
		roles = metadata.Capabilities

		// Add base role for agent type
		roles = append(roles, "agent:"+metadata.Type)

		// Extract tenant ID if available in metadata
		if metadata.Metadata != nil {
			if tid, ok := metadata.Metadata["tenant_id"].(string); ok {
				tenantID = tid
			}
			// Extract custom roles from metadata
			if customRoles, ok := metadata.Metadata["roles"].([]string); ok {
				roles = append(roles, customRoles...)
			} else if rolesAny, ok := metadata.Metadata["roles"].([]interface{}); ok {
				for _, r := range rolesAny {
					if roleStr, ok := r.(string); ok {
						roles = append(roles, roleStr)
					}
				}
			}
			// Extract scopes from metadata
			if scopesInterface, ok := metadata.Metadata["scopes"].([]string); ok {
				scopes = scopesInterface
			} else if scopesAny, ok := metadata.Metadata["scopes"].([]interface{}); ok {
				for _, s := range scopesAny {
					if scopeStr, ok := s.(string); ok {
						scopes = append(scopes, scopeStr)
					}
				}
			}
		}
	}

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

// agentMetadata represents cached agent metadata for JWT claims
type agentMetadata struct {
	ID           string
	Type         string
	Status       string
	Capabilities []string
	Metadata     map[string]interface{}
}

// getAgentMetadata retrieves agent metadata from cache or agent store
// Returns error if agent is not found or not active
func (i *JWTIssuer) getAgentMetadata(ctx context.Context, agentID string) (*agentMetadata, error) {
	// Check cache first
	if i.agentCache != nil {
		if cached, ok := i.agentCache.Get("agent:" + agentID); ok {
			if metadata, ok := cached.(*agentMetadata); ok {
				// Verify agent is still active
				if metadata.Status != types.StatusActive {
					return nil, fmt.Errorf("agent %s is not active (status: %s)", agentID, metadata.Status)
				}
				return metadata, nil
			}
		}
	}

	// Load from agent store
	agent, err := i.agentStore.Get(ctx, agentID)
	if err != nil {
		return nil, fmt.Errorf("agent not found: %w", err)
	}

	// Validate agent is active
	if !agent.IsActive() {
		return nil, fmt.Errorf("agent %s is not active (status: %s)", agentID, agent.Status)
	}

	// Check if agent is expired
	if agent.IsExpired() {
		// Update status to expired
		_ = i.agentStore.UpdateStatus(ctx, agentID, types.StatusExpired)
		return nil, fmt.Errorf("agent %s has expired", agentID)
	}

	// Extract capabilities from agent metadata or credentials
	capabilities := []string{}
	if agent.Metadata != nil {
		if caps, ok := agent.Metadata["capabilities"].([]string); ok {
			capabilities = caps
		} else if capsAny, ok := agent.Metadata["capabilities"].([]interface{}); ok {
			for _, c := range capsAny {
				if capStr, ok := c.(string); ok {
					capabilities = append(capabilities, capStr)
				}
			}
		}
	}

	// Create metadata object
	metadata := &agentMetadata{
		ID:           agent.ID,
		Type:         agent.Type,
		Status:       agent.Status,
		Capabilities: capabilities,
		Metadata:     agent.Metadata,
	}

	// Store in cache
	if i.agentCache != nil {
		i.agentCache.Set("agent:"+agentID, metadata)
	}

	return metadata, nil
}

// InvalidateAgentCache removes an agent from the cache
// Should be called when agent status changes
func (i *JWTIssuer) InvalidateAgentCache(agentID string) {
	if i.agentCache != nil {
		i.agentCache.Delete("agent:" + agentID)
	}
}
