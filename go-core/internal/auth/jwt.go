package auth

import (
	"crypto/rsa"
	"fmt"
	"os"

	"github.com/golang-jwt/jwt/v5"
)

// JWTValidator validates JWT tokens using HS256 or RS256
type JWTValidator struct {
	// HS256 (shared secret)
	secret []byte

	// RS256 (public key)
	publicKey *rsa.PublicKey

	// JWKS (key rotation)
	jwks *JWKSProvider

	// Configuration
	config *JWTConfig
}

// NewJWTValidator creates a new JWT validator with the given configuration
func NewJWTValidator(cfg *JWTConfig) (*JWTValidator, error) {
	if cfg == nil {
		cfg = DefaultJWTConfig()
	}

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}

	validator := &JWTValidator{
		config: cfg,
	}

	// Load HS256 secret
	if cfg.Secret != "" {
		validator.secret = []byte(cfg.Secret)
	}

	// Load RS256 public key from string
	if cfg.PublicKey != "" {
		key, err := jwt.ParseRSAPublicKeyFromPEM([]byte(cfg.PublicKey))
		if err != nil {
			return nil, fmt.Errorf("parse public key: %w", err)
		}
		validator.publicKey = key
	}

	// Load RS256 public key from file
	if cfg.PublicKeyFile != "" {
		pemBytes, err := os.ReadFile(cfg.PublicKeyFile)
		if err != nil {
			return nil, fmt.Errorf("read public key file: %w", err)
		}
		key, err := jwt.ParseRSAPublicKeyFromPEM(pemBytes)
		if err != nil {
			return nil, fmt.Errorf("parse public key from file: %w", err)
		}
		validator.publicKey = key
	}

	// Setup JWKS provider
	if cfg.JWKSUrl != "" {
		jwks, err := NewJWKSProvider(cfg.JWKSUrl, cfg.JWKSCacheTTL)
		if err != nil {
			return nil, fmt.Errorf("create JWKS provider: %w", err)
		}
		validator.jwks = jwks
	}

	return validator, nil
}

// Validate validates a JWT token string and returns the claims
func (v *JWTValidator) Validate(tokenString string) (*Claims, error) {
	if tokenString == "" {
		return nil, fmt.Errorf("empty token")
	}

	// Parse token with claims
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, v.keyFunc)
	if err != nil {
		return nil, fmt.Errorf("parse token: %w", err)
	}

	// Check if token is valid
	if !token.Valid {
		return nil, jwt.ErrSignatureInvalid
	}

	// Extract claims
	claims, ok := token.Claims.(*Claims)
	if !ok {
		return nil, fmt.Errorf("invalid claims type")
	}

	// Validate custom claims
	if err := v.validateClaims(claims); err != nil {
		return nil, fmt.Errorf("invalid claims: %w", err)
	}

	return claims, nil
}

// keyFunc returns the key for token validation based on the algorithm
func (v *JWTValidator) keyFunc(token *jwt.Token) (interface{}, error) {
	// Validate algorithm (prevent algorithm confusion attacks)
	alg := token.Method.Alg()

	switch alg {
	case "HS256":
		if v.secret == nil {
			return nil, fmt.Errorf("HS256 not configured")
		}
		return v.secret, nil

	case "RS256":
		// Try JWKS first (for key rotation)
		if v.jwks != nil {
			kid, ok := token.Header["kid"].(string)
			if !ok || kid == "" {
				return nil, fmt.Errorf("missing kid header")
			}
			return v.jwks.GetKey(kid)
		}

		// Fall back to static public key
		if v.publicKey == nil {
			return nil, fmt.Errorf("RS256 not configured")
		}
		return v.publicKey, nil

	case "none":
		// Explicitly reject "none" algorithm (security)
		return nil, fmt.Errorf("'none' algorithm not allowed")

	default:
		return nil, fmt.Errorf("unexpected signing method: %v", alg)
	}
}

// validateClaims validates JWT standard and custom claims
func (v *JWTValidator) validateClaims(claims *Claims) error {
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
	// are automatically validated by jwt.ParseWithClaims via RegisteredClaims
	// unless v.config.SkipExpirationCheck is true

	return nil
}

// Close closes the JWT validator and releases resources
func (v *JWTValidator) Close() error {
	if v.jwks != nil {
		return v.jwks.Close()
	}
	return nil
}
