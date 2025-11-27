// Package auth provides JWT token validation with JWKS support
package auth

import (
	"context"
	"fmt"
	"time"

	gojwt "github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// JWTValidatorWithJWKS validates JWT tokens using JWKS for key resolution
type JWTValidatorWithJWKS struct {
	jwksProvider      *JWKSProvider
	issuer            string
	audience          string
	redisClient       *redis.Client
	logger            *zap.Logger
	skipExpiryCheck   bool
	skipIssuerCheck   bool
	skipAudienceCheck bool
}

// NewJWTValidatorWithJWKS creates a new JWT validator with JWKS support
func NewJWTValidatorWithJWKS(provider *auth.JWKSProvider, cfg *ValidatorConfig) (*JWTValidatorWithJWKS, error) {
	if provider == nil {
		return nil, fmt.Errorf("JWKS provider is required")
	}
	if cfg == nil {
		return nil, fmt.Errorf("config is required")
	}
	if cfg.Issuer == "" && !cfg.SkipIssuerCheck {
		return nil, fmt.Errorf("issuer is required")
	}
	if cfg.Audience == "" && !cfg.SkipAudienceCheck {
		return nil, fmt.Errorf("audience is required")
	}

	logger := cfg.Logger
	if logger == nil {
		logger = zap.NewNop()
	}

	return &JWTValidatorWithJWKS{
		jwksProvider:      provider,
		issuer:            cfg.Issuer,
		audience:          cfg.Audience,
		redisClient:       cfg.RedisClient,
		logger:            logger,
		skipExpiryCheck:   cfg.SkipExpiryCheck,
		skipIssuerCheck:   cfg.SkipIssuerCheck,
		skipAudienceCheck: cfg.SkipAudienceCheck,
	}, nil
}

// Validate validates a JWT token using JWKS for key resolution
func (v *JWTValidatorWithJWKS) Validate(ctx context.Context, tokenString string) (*auth.Claims, error) {
	if tokenString == "" {
		return nil, fmt.Errorf("empty token")
	}

	// Parse token to extract kid from header
	var claims auth.Claims
	token, err := jwt.ParseWithClaims(tokenString, &claims, func(token *jwt.Token) (interface{}, error) {
		// Verify algorithm is RS256
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		if token.Method.Alg() != "RS256" {
			return nil, fmt.Errorf("unexpected algorithm: %v (expected RS256)", token.Method.Alg())
		}

		// Extract kid from header
		kid, ok := token.Header["kid"].(string)
		if !ok || kid == "" {
			return nil, fmt.Errorf("missing kid in token header")
		}

		// Get public key from JWKS provider
		publicKey, err := v.jwksProvider.GetKey(kid)
		if err != nil {
			return nil, fmt.Errorf("get JWKS key: %w", err)
		}

		return publicKey, nil
	})

	if err != nil {
		return nil, fmt.Errorf("parse token: %w", err)
	}

	if !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	// Validate standard claims
	if err := v.validateStandardClaims(&claims); err != nil {
		return nil, fmt.Errorf("invalid standard claims: %w", err)
	}

	// Check revocation if Redis is configured
	if v.redisClient != nil {
		revoker := NewTokenRevoker(v.redisClient)
		isRevoked, err := revoker.IsRevoked(ctx, claims.ID)
		if err != nil {
			v.logger.Warn("Failed to check token revocation",
				zap.Error(err),
				zap.String("jti", claims.ID))
		} else if isRevoked {
			return nil, fmt.Errorf("token has been revoked")
		}
	}

	return &claims, nil
}

// validateStandardClaims validates JWT standard claims (reuse from base validator)
func (v *JWTValidatorWithJWKS) validateStandardClaims(claims *auth.Claims) error {
	// Create temporary base validator for claim validation
	baseValidator := &JWTValidator{
		issuer:            v.issuer,
		audience:          v.audience,
		skipExpiryCheck:   v.skipExpiryCheck,
		skipIssuerCheck:   v.skipIssuerCheck,
		skipAudienceCheck: v.skipAudienceCheck,
	}
	return baseValidator.validateStandardClaims(claims)
}
