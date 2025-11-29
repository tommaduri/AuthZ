// Package auth provides JWT token validation with JWKS support
package auth

import (
	"context"
	"fmt"

	gojwt "github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
)

// JWTValidatorWithJWKS validates JWT tokens using JWKS for key resolution
type JWTValidatorWithJWKS struct {
	jwksProvider *JWKSProvider
	config       *JWTConfig
	logger       *zap.Logger
}

// NewJWTValidatorWithJWKS creates a new JWT validator with JWKS support
func NewJWTValidatorWithJWKS(provider *JWKSProvider, cfg *JWTConfig) (*JWTValidatorWithJWKS, error) {
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

	logger := zap.NewNop() // Default logger

	return &JWTValidatorWithJWKS{
		jwksProvider: provider,
		config:       cfg,
		logger:       logger,
	}, nil
}

// Validate validates a JWT token using JWKS for key resolution
func (v *JWTValidatorWithJWKS) Validate(ctx context.Context, tokenString string) (*Claims, error) {
	if tokenString == "" {
		return nil, fmt.Errorf("empty token")
	}

	// Parse token to extract kid from header
	var claims Claims
	token, err := gojwt.ParseWithClaims(tokenString, &claims, func(token *gojwt.Token) (interface{}, error) {
		// Verify algorithm is RS256
		if _, ok := token.Method.(*gojwt.SigningMethodRSA); !ok {
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

	// Validate standard claims using config
	if err := v.validateClaims(&claims); err != nil {
		return nil, fmt.Errorf("invalid claims: %w", err)
	}

	// Check if token is revoked (if revocation store is configured)
	if v.config.RevocationStore != nil && claims.ID != "" {
		isRevoked, err := v.config.RevocationStore.IsRevoked(ctx, claims.ID)
		if err != nil {
			v.logger.Warn("Failed to check token revocation", zap.Error(err), zap.String("jti", claims.ID))
			// Continue anyway - don't fail if Redis is temporarily unavailable
		} else if isRevoked {
			return nil, fmt.Errorf("token has been revoked")
		}
	}

	return &claims, nil
}

// validateClaims validates JWT standard and custom claims
func (v *JWTValidatorWithJWKS) validateClaims(claims *Claims) error {
	// Validate issuer
	if !v.config.SkipIssuerCheck && v.config.Issuer != "" {
		if claims.Issuer != v.config.Issuer {
			return fmt.Errorf("invalid issuer: expected %s, got %s", v.config.Issuer, claims.Issuer)
		}
	}

	// Validate audience
	if !v.config.SkipAudienceCheck && v.config.Audience != "" {
		found := false
		for _, aud := range claims.Audience {
			if aud == v.config.Audience {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("invalid audience: expected %s", v.config.Audience)
		}
	}

	// Note: Expiration (exp), Not Before (nbf), and Issued At (iat)
	// are automatically validated by gojwt.ParseWithClaims via RegisteredClaims
	// unless v.config.SkipExpirationCheck is true

	return nil
}
