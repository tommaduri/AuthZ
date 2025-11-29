// Package jwt provides JWT token validation with Redis blacklist support
package jwt

import (
	"context"
	"crypto/rsa"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// ValidatorConfig contains configuration for JWT token validation
type ValidatorConfig struct {
	PublicKey          *rsa.PublicKey
	Issuer             string
	Audience           string
	RedisClient        *redis.Client
	Logger             *zap.Logger
	SkipExpiryCheck    bool // For testing only
	SkipIssuerCheck    bool // For testing only
	SkipAudienceCheck  bool // For testing only
	SkipAgentStatusCheck bool // For testing only
}

// JWTValidator validates JWT tokens
type JWTValidator struct {
	publicKey            *rsa.PublicKey
	issuer               string
	audience             string
	redisClient          *redis.Client
	logger               *zap.Logger
	skipExpiryCheck      bool
	skipIssuerCheck      bool
	skipAudienceCheck    bool
	skipAgentStatusCheck bool
}

// NewJWTValidator creates a new JWT token validator
func NewJWTValidator(cfg *ValidatorConfig) (*JWTValidator, error) {
	if cfg == nil {
		return nil, fmt.Errorf("config is required")
	}
	if cfg.PublicKey == nil {
		return nil, fmt.Errorf("public key is required")
	}
	if cfg.Issuer == "" && !cfg.SkipIssuerCheck {
		return nil, fmt.Errorf("issuer is required")
	}
	if cfg.Audience == "" && !cfg.SkipAudienceCheck {
		return nil, fmt.Errorf("audience is required")
	}
	if cfg.Logger == nil {
		cfg.Logger = zap.NewNop()
	}

	return &JWTValidator{
		publicKey:            cfg.PublicKey,
		issuer:               cfg.Issuer,
		audience:             cfg.Audience,
		redisClient:          cfg.RedisClient,
		logger:               cfg.Logger,
		skipExpiryCheck:      cfg.SkipExpiryCheck,
		skipIssuerCheck:      cfg.SkipIssuerCheck,
		skipAudienceCheck:    cfg.SkipAudienceCheck,
		skipAgentStatusCheck: cfg.SkipAgentStatusCheck,
	}, nil
}

// Validate validates a JWT token and returns the claims
func (v *JWTValidator) Validate(ctx context.Context, tokenString string) (*Claims, error) {
	if tokenString == "" {
		return nil, fmt.Errorf("empty token")
	}

	// Parse and validate token
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		// Verify algorithm is RS256 (prevent algorithm confusion attacks)
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		if token.Method.Alg() != "RS256" {
			return nil, fmt.Errorf("unexpected algorithm: %v (expected RS256)", token.Method.Alg())
		}
		return v.publicKey, nil
	})

	if err != nil {
		return nil, fmt.Errorf("parse token: %w", err)
	}

	if !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	// Extract claims
	claims, ok := token.Claims.(*Claims)
	if !ok {
		return nil, fmt.Errorf("invalid claims type")
	}

	// Validate standard claims
	if err := v.validateStandardClaims(claims); err != nil {
		return nil, fmt.Errorf("invalid standard claims: %w", err)
	}

	// Check if token is revoked (Redis blacklist)
	if v.redisClient != nil {
		isRevoked, err := v.IsRevoked(ctx, claims.ID)
		if err != nil {
			v.logger.Warn("Failed to check token revocation", zap.Error(err), zap.String("jti", claims.ID))
			// Continue anyway - don't fail if Redis is temporarily unavailable
		} else if isRevoked {
			return nil, fmt.Errorf("token has been revoked")
		}
	}

	// Validate agent status if present in claims
	if err := v.validateAgentStatus(claims); err != nil {
		return nil, fmt.Errorf("invalid agent status: %w", err)
	}

	return claims, nil
}

// validateStandardClaims validates JWT standard claims
func (v *JWTValidator) validateStandardClaims(claims *Claims) error {
	now := time.Now()

	// Validate expiration (exp)
	if !v.skipExpiryCheck {
		if claims.ExpiresAt == nil {
			return fmt.Errorf("missing expiration claim")
		}
		if now.After(claims.ExpiresAt.Time) {
			return fmt.Errorf("token has expired")
		}
	}

	// Validate not before (nbf)
	if claims.NotBefore != nil && now.Before(claims.NotBefore.Time) {
		return fmt.Errorf("token not yet valid")
	}

	// Validate issued at (iat)
	if claims.IssuedAt != nil && now.Before(claims.IssuedAt.Time) {
		return fmt.Errorf("token issued in the future")
	}

	// Validate issuer
	if !v.skipIssuerCheck && claims.Issuer != v.issuer {
		return fmt.Errorf("invalid issuer: expected %s, got %s", v.issuer, claims.Issuer)
	}

	// Validate audience
	if !v.skipAudienceCheck {
		validAudience := false
		for _, aud := range claims.Audience {
			if aud == v.audience {
				validAudience = true
				break
			}
		}
		if !validAudience {
			return fmt.Errorf("invalid audience: expected %s", v.audience)
		}
	}

	// Validate JTI (JWT ID) is present
	if claims.ID == "" {
		return fmt.Errorf("missing jti (JWT ID) claim")
	}

	return nil
}

// IsRevoked checks if a token is in the Redis blacklist
// Uses the TokenRevoker for consistency
func (v *JWTValidator) IsRevoked(ctx context.Context, jti string) (bool, error) {
	if v.redisClient == nil {
		return false, nil // No Redis, assume not revoked
	}

	// Use TokenRevoker for consistent key format
	revoker := NewTokenRevoker(v.redisClient)
	return revoker.IsRevoked(ctx, jti)
}

// RevokeToken adds a token to the Redis blacklist
// Delegates to TokenRevoker for centralized revocation logic
func (v *JWTValidator) RevokeToken(ctx context.Context, jti string, expiresAt time.Time) error {
	if v.redisClient == nil {
		return fmt.Errorf("redis client not configured")
	}

	// Use TokenRevoker for centralized revocation logic
	revoker := NewTokenRevoker(v.redisClient)
	err := revoker.RevokeToken(ctx, jti, expiresAt)
	if err != nil {
		return err
	}

	v.logger.Info("Token revoked", zap.String("jti", jti), zap.Duration("ttl", time.Until(expiresAt)))
	return nil
}

// ExtractPrincipal converts JWT claims to a Principal object
// This integrates with the existing authorization engine
func (v *JWTValidator) ExtractPrincipal(claims *Claims) *Principal {
	return &Principal{
		ID:       claims.Subject,
		Roles:    claims.Roles,
		TenantID: claims.TenantID,
		Scopes:   claims.Scopes,
	}
}

// Principal represents an authenticated principal
type Principal struct {
	ID       string
	Roles    []string
	TenantID string
	Scopes   []string
}

// validateAgentStatus validates agent status claim if present
func (v *JWTValidator) validateAgentStatus(claims *Claims) error {
	// Skip if no agent metadata in token or if check is disabled
	if claims.AgentStatus == "" || v.skipAgentStatusCheck {
		return nil
	}

	// Agent must be active
	if claims.AgentStatus != "active" {
		return fmt.Errorf("agent is not active (status: %s)", claims.AgentStatus)
	}

	return nil
}
