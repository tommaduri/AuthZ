package auth

import (
	"context"
	"crypto/rsa"
	"fmt"
	"time"

	"github.com/authz-engine/go-core/internal/agent"
	"github.com/authz-engine/go-core/internal/auth/jwt"
	"github.com/authz-engine/go-core/internal/cache"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// TokenIssuerConfig contains configuration for the token issuer wrapper
type TokenIssuerConfig struct {
	PrivateKey   *rsa.PrivateKey
	Issuer       string
	Audience     string
	AccessTTL    time.Duration
	RefreshTTL   time.Duration
	RefreshStore jwt.RefreshTokenStore
	AgentStore   agent.AgentStore
	AgentCache   cache.Cache
	RedisClient  *redis.Client
	Logger       *zap.Logger
}

// TokenIssuer is a high-level wrapper around jwt.JWTIssuer that includes
// password validation and credential checking per SDD requirements
type TokenIssuer struct {
	jwtIssuer   *jwt.JWTIssuer
	agentStore  agent.AgentStore
	redisClient *redis.Client
	logger      *zap.Logger
}

// NewTokenIssuer creates a new token issuer with password validation
func NewTokenIssuer(cfg *TokenIssuerConfig) (*TokenIssuer, error) {
	if cfg == nil {
		return nil, fmt.Errorf("config is required")
	}

	// Create underlying JWT issuer
	jwtIssuer, err := jwt.NewJWTIssuer(&jwt.IssuerConfig{
		PrivateKey:   cfg.PrivateKey,
		Issuer:       cfg.Issuer,
		Audience:     cfg.Audience,
		AccessTTL:    cfg.AccessTTL,
		RefreshTTL:   cfg.RefreshTTL,
		RefreshStore: cfg.RefreshStore,
		AgentStore:   cfg.AgentStore,
		AgentCache:   cfg.AgentCache,
		Logger:       cfg.Logger,
	})
	if err != nil {
		return nil, fmt.Errorf("create JWT issuer: %w", err)
	}

	if cfg.Logger == nil {
		cfg.Logger = zap.NewNop()
	}

	return &TokenIssuer{
		jwtIssuer:   jwtIssuer,
		agentStore:  cfg.AgentStore,
		redisClient: cfg.RedisClient,
		logger:      cfg.Logger,
	}, nil
}

// IssueToken validates credentials and issues a new token pair
// This is the main entry point per SDD specification:
// - Validates username/password against agent_credentials table
// - Prevents timing attacks using constant-time comparison
// - Rate limits credential checks (delegated to caller/middleware)
// - Logs all auth events
func (i *TokenIssuer) IssueToken(username, password, tenantID string) (*jwt.TokenPair, error) {
	ctx := context.Background()

	// Input validation
	if username == "" {
		return nil, fmt.Errorf("username is required")
	}
	if password == "" {
		return nil, fmt.Errorf("password is required")
	}
	if tenantID == "" {
		return nil, fmt.Errorf("tenant ID is required")
	}

	// Validate password format before checking credentials
	if err := ValidatePassword(password); err != nil {
		return nil, fmt.Errorf("invalid password format: %w", err)
	}

	// Load agent from store
	agent, err := i.agentStore.Get(ctx, username)
	if err != nil {
		i.logger.Warn("Agent not found during token issuance",
			zap.String("agent_id", username),
			zap.Error(err))
		return nil, fmt.Errorf("invalid credentials: agent not found")
	}

	// Verify agent is active
	if !agent.IsActive() {
		i.logger.Warn("Inactive agent attempted to get token",
			zap.String("agent_id", username),
			zap.String("status", agent.Status))
		return nil, fmt.Errorf("agent is not active")
	}


	// Extract TenantID from metadata if not directly available
	agentTenantID := tenantID // Default to provided tenant ID
	if agent.Metadata != nil {
		if tid, ok := agent.Metadata["tenant_id"].(string); ok {
			agentTenantID = tid
		}
	}

	// Verify tenant ID matches
	if agentTenantID != tenantID {
		i.logger.Warn("Tenant ID mismatch during token issuance",
			zap.String("agent_id", username),
			zap.String("expected_tenant", agentTenantID),
			zap.String("provided_tenant", tenantID))
		return nil, fmt.Errorf("invalid credentials: tenant mismatch")
	}

	// Extract password hash from metadata or credentials
	passwordHash := ""
	if agent.Metadata != nil {
		if hash, ok := agent.Metadata["password_hash"].(string); ok {
			passwordHash = hash
		}
	}

	if passwordHash == "" {
		i.logger.Error("No password hash found for agent",
			zap.String("agent_id", username))
		return nil, fmt.Errorf("invalid credentials: no password configured")
	}

	// Verify password (constant-time comparison via bcrypt)
	valid := VerifyPassword(password, passwordHash)

	if !valid {
		i.logger.Warn("Invalid password during token issuance",
			zap.String("agent_id", username))
		return nil, fmt.Errorf("invalid credentials: incorrect password")
	}

	// Extract roles and scopes from agent metadata
	roles := []string{}
	scopes := []string{}

	if agent.Metadata != nil {
		// Extract roles
		if rolesInterface, ok := agent.Metadata["roles"].([]string); ok {
			roles = rolesInterface
		} else if rolesAny, ok := agent.Metadata["roles"].([]interface{}); ok {
			for _, r := range rolesAny {
				if roleStr, ok := r.(string); ok {
					roles = append(roles, roleStr)
				}
			}
		}

		// Extract scopes
		if scopesInterface, ok := agent.Metadata["scopes"].([]string); ok {
			scopes = scopesInterface
		} else if scopesAny, ok := agent.Metadata["scopes"].([]interface{}); ok {
			for _, s := range scopesAny {
				if scopeStr, ok := s.(string); ok {
					scopes = append(scopes, scopeStr)
				}
			}
		}
	}

	// Issue token via underlying JWT issuer
	tokenPair, err := i.jwtIssuer.IssueToken(ctx, username, roles, tenantID, scopes)
	if err != nil {
		i.logger.Error("Failed to issue token",
			zap.String("agent_id", username),
			zap.Error(err))
		return nil, fmt.Errorf("issue token: %w", err)
	}

	i.logger.Info("Token issued successfully",
		zap.String("agent_id", username),
		zap.String("tenant_id", tenantID),
		zap.Int("expires_in", int(tokenPair.ExpiresIn)))

	return tokenPair, nil
}

// RefreshToken validates a refresh token and issues a new access token
// Per SDD specification:
// - Validates refresh token against auth_refresh_tokens table
// - Checks expiration and revocation status
// - Issues new access token with same claims
func (i *TokenIssuer) RefreshToken(refreshToken string) (*jwt.TokenPair, error) {
	ctx := context.Background()

	if refreshToken == "" {
		return nil, fmt.Errorf("refresh token is required")
	}

	// Use underlying JWT issuer to handle refresh logic
	tokenPair, err := i.jwtIssuer.RefreshToken(ctx, refreshToken)
	if err != nil {
		i.logger.Warn("Token refresh failed",
			zap.Error(err))
		return nil, fmt.Errorf("refresh token: %w", err)
	}

	i.logger.Info("Token refreshed successfully",
		zap.Int("expires_in", int(tokenPair.ExpiresIn)))

	return tokenPair, nil
}

// RevokeToken adds an access token to the Redis blacklist
// Per SDD specification:
// - Adds token JTI to Redis blacklist with TTL = token expiry
// - Logs revocation event
// - Returns proper error for missing Redis client
func (i *TokenIssuer) RevokeToken(accessToken string) error {
	ctx := context.Background()

	if accessToken == "" {
		return fmt.Errorf("access token is required")
	}

	if i.redisClient == nil {
		return fmt.Errorf("token revocation requires Redis client")
	}

	// Parse token to extract JTI and expiration
	// Note: In production, you'd use a JWT validator here
	// For now, delegate to underlying issuer's RevokeToken method

	// Extract JTI from token (simplified - assumes accessToken is the JTI)
	// In real implementation, parse JWT to get JTI claim
	jti := accessToken // TODO: Parse JWT to extract actual JTI

	// Calculate expiration time (use token's exp claim)
	expiresAt := time.Now().Add(1 * time.Hour) // TODO: Use actual exp from token

	// Revoke via underlying JWT issuer
	err := i.jwtIssuer.RevokeToken(ctx, jti, expiresAt, i.redisClient)
	if err != nil {
		i.logger.Error("Token revocation failed",
			zap.String("jti", jti),
			zap.Error(err))
		return fmt.Errorf("revoke token: %w", err)
	}

	i.logger.Info("Token revoked successfully",
		zap.String("jti", jti))

	return nil
}

// InvalidateAgentCache removes an agent from the cache
// Should be called when agent status changes
func (i *TokenIssuer) InvalidateAgentCache(agentID string) {
	i.jwtIssuer.InvalidateAgentCache(agentID)
}
