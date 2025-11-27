package auth

import (
	"context"
	"crypto/rsa"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// JWTIssuer issues JWT tokens using the active signing key
type JWTIssuer struct {
	rotationMgr *KeyRotationManager
	issuer      string
	audience    string
}

// NewJWTIssuer creates a new JWT issuer
func NewJWTIssuer(rotationMgr *KeyRotationManager, issuer, audience string) *JWTIssuer {
	return &JWTIssuer{
		rotationMgr: rotationMgr,
		issuer:      issuer,
		audience:    audience,
	}
}

// TokenClaims represents JWT token claims
type TokenClaims struct {
	jwt.RegisteredClaims
	Subject     string                 `json:"sub,omitempty"`
	Scope       string                 `json:"scope,omitempty"`
	Permissions []string               `json:"permissions,omitempty"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

// IssueToken issues a new JWT token using the active signing key
func (ji *JWTIssuer) IssueToken(ctx context.Context, subject string, expiresIn time.Duration, scope string, permissions []string) (string, error) {
	// Get the active signing key
	activeKey, err := ji.rotationMgr.GetActiveKey(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to get active signing key: %w", err)
	}

	now := time.Now()
	claims := TokenClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    ji.issuer,
			Subject:   subject,
			Audience:  jwt.ClaimStrings{ji.audience},
			ExpiresAt: jwt.NewNumericDate(now.Add(expiresIn)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ID:        generateJTI(),
		},
		Scope:       scope,
		Permissions: permissions,
	}

	// Create token with KID in header
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = activeKey.KID

	// Sign token with active private key
	tokenString, err := token.SignedString(activeKey.GetPrivateKey())
	if err != nil {
		return "", fmt.Errorf("failed to sign token: %w", err)
	}

	return tokenString, nil
}

// VerifyToken verifies a JWT token and returns its claims
func (ji *JWTIssuer) VerifyToken(ctx context.Context, tokenString string) (*TokenClaims, error) {
	// Parse token to get KID from header
	token, err := jwt.ParseWithClaims(tokenString, &TokenClaims{}, func(token *jwt.Token) (interface{}, error) {
		// Verify signing method
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}

		// Get KID from header
		kid, ok := token.Header["kid"].(string)
		if !ok {
			return nil, fmt.Errorf("missing kid in token header")
		}

		// Get all active keys to find the one matching KID
		activeKeys, err := ji.rotationMgr.GetAllActiveKeys(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to get active keys: %w", err)
		}

		// Find the key with matching KID
		for _, key := range activeKeys {
			if key.KID == kid {
				// Parse and return the public key
				publicKey, err := ParsePublicKeyPEM(key.PublicKey)
				if err != nil {
					return nil, fmt.Errorf("failed to parse public key: %w", err)
				}
				return publicKey, nil
			}
		}

		return nil, fmt.Errorf("key with kid '%s' not found or expired", kid)
	})

	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}

	if !token.Valid {
		return nil, fmt.Errorf("token is invalid")
	}

	claims, ok := token.Claims.(*TokenClaims)
	if !ok {
		return nil, fmt.Errorf("invalid token claims")
	}

	// Verify issuer
	if claims.Issuer != ji.issuer {
		return nil, fmt.Errorf("invalid issuer: expected %s, got %s", ji.issuer, claims.Issuer)
	}

	// Verify audience (manual check since VerifyAudience method doesn't exist)
	audienceValid := false
	for _, aud := range claims.Audience {
		if aud == ji.audience {
			audienceValid = true
			break
		}
	}
	if !audienceValid {
		return nil, fmt.Errorf("invalid audience: expected %s", ji.audience)
	}

	return claims, nil
}

// RefreshToken issues a new token based on an existing valid token
func (ji *JWTIssuer) RefreshToken(ctx context.Context, tokenString string, expiresIn time.Duration) (string, error) {
	// Verify the existing token
	claims, err := ji.VerifyToken(ctx, tokenString)
	if err != nil {
		return "", fmt.Errorf("invalid token for refresh: %w", err)
	}

	// Issue a new token with the same subject and permissions
	return ji.IssueToken(ctx, claims.Subject, expiresIn, claims.Scope, claims.Permissions)
}

// generateJTI generates a unique JWT ID
func generateJTI() string {
	// In production, use a more robust method (UUID, etc.)
	return fmt.Sprintf("%d", time.Now().UnixNano())
}

// GetPublicKeyForKID returns the public key for a specific KID
func (ji *JWTIssuer) GetPublicKeyForKID(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	activeKeys, err := ji.rotationMgr.GetAllActiveKeys(ctx)
	if err != nil {
		return nil, err
	}

	for _, key := range activeKeys {
		if key.KID == kid {
			publicKey, err := ParsePublicKeyPEM(key.PublicKey)
			if err != nil {
				return nil, err
			}
			rsaKey, ok := publicKey.(*rsa.PublicKey)
			if !ok {
				return nil, fmt.Errorf("key is not an RSA public key")
			}
			return rsaKey, nil
		}
	}

	return nil, fmt.Errorf("key with kid '%s' not found", kid)
}
