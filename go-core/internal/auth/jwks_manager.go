package auth

import (
	"context"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
)

// JWK represents a JSON Web Key
type JWK struct {
	KID       string `json:"kid"`
	Kty       string `json:"kty"`
	Alg       string `json:"alg"`
	Use       string `json:"use"`
	N         string `json:"n"`
	E         string `json:"e"`
	X5t       string `json:"x5t,omitempty"`
}

// JWKS represents a JSON Web Key Set
type JWKS struct {
	Keys []JWK `json:"keys"`
}

// JWKSManager manages the JWKS endpoint with multi-key support
type JWKSManager struct {
	rotationMgr *KeyRotationManager
}

// NewJWKSManager creates a new JWKS manager
func NewJWKSManager(rotationMgr *KeyRotationManager) *JWKSManager {
	return &JWKSManager{
		rotationMgr: rotationMgr,
	}
}

// GetJWKS returns the current JWKS with all active keys
func (jm *JWKSManager) GetJWKS(ctx context.Context) (*JWKS, error) {
	// Get all active keys (includes current key and keys in grace period)
	keys, err := jm.rotationMgr.GetAllActiveKeys(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get active keys: %w", err)
	}

	if len(keys) == 0 {
		return nil, fmt.Errorf("no active signing keys available")
	}

	jwks := &JWKS{
		Keys: make([]JWK, 0, len(keys)),
	}

	for _, key := range keys {
		jwk, err := jm.convertToJWK(key)
		if err != nil {
			// Log error but continue with other keys
			continue
		}
		jwks.Keys = append(jwks.Keys, *jwk)
	}

	if len(jwks.Keys) == 0 {
		return nil, fmt.Errorf("failed to convert any keys to JWK format")
	}

	return jwks, nil
}

// GetJWKSJSON returns the JWKS as JSON bytes
func (jm *JWKSManager) GetJWKSJSON(ctx context.Context) ([]byte, error) {
	jwks, err := jm.GetJWKS(ctx)
	if err != nil {
		return nil, err
	}

	data, err := json.Marshal(jwks)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal JWKS: %w", err)
	}

	return data, nil
}

// convertToJWK converts a SigningKey to JWK format
func (jm *JWKSManager) convertToJWK(key *SigningKey) (*JWK, error) {
	// Parse public key from PEM
	publicKey, err := ParsePublicKeyPEM(key.PublicKey)
	if err != nil {
		return nil, fmt.Errorf("failed to parse public key: %w", err)
	}

	rsaKey, ok := publicKey.(*rsa.PublicKey)
	if !ok {
		return nil, fmt.Errorf("key is not an RSA public key")
	}

	// Convert modulus and exponent to base64url format
	n := base64.RawURLEncoding.EncodeToString(rsaKey.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(rsaKey.E)).Bytes())

	// Calculate thumbprint (x5t)
	thumbprint := jm.calculateThumbprint(rsaKey)

	return &JWK{
		KID: key.KID,
		Kty: "RSA",
		Alg: key.Algorithm,
		Use: "sig",
		N:   n,
		E:   e,
		X5t: thumbprint,
	}, nil
}

// calculateThumbprint calculates the SHA-256 thumbprint of the public key
func (jm *JWKSManager) calculateThumbprint(key *rsa.PublicKey) string {
	// Create canonical JWK representation for thumbprint
	n := base64.RawURLEncoding.EncodeToString(key.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())

	// Canonical JSON (lexicographic order)
	canonical := fmt.Sprintf(`{"e":"%s","kty":"RSA","n":"%s"}`, e, n)

	// SHA-256 hash
	hash := sha256.Sum256([]byte(canonical))
	return base64.RawURLEncoding.EncodeToString(hash[:])
}

// GetKeyByKID retrieves a specific key by its ID
func (jm *JWKSManager) GetKeyByKID(ctx context.Context, kid string) (*SigningKey, error) {
	keys, err := jm.rotationMgr.GetAllActiveKeys(ctx)
	if err != nil {
		return nil, err
	}

	for _, key := range keys {
		if key.KID == kid {
			return key, nil
		}
	}

	return nil, fmt.Errorf("key with kid '%s' not found", kid)
}

// ValidateJWKS validates the JWKS structure
func (jm *JWKSManager) ValidateJWKS(jwks *JWKS) error {
	if jwks == nil {
		return fmt.Errorf("JWKS is nil")
	}

	if len(jwks.Keys) == 0 {
		return fmt.Errorf("JWKS contains no keys")
	}

	for i, key := range jwks.Keys {
		if key.KID == "" {
			return fmt.Errorf("key at index %d has empty KID", i)
		}
		if key.Kty != "RSA" {
			return fmt.Errorf("key %s has invalid kty: %s", key.KID, key.Kty)
		}
		if key.Alg == "" {
			return fmt.Errorf("key %s has empty alg", key.KID)
		}
		if key.Use != "sig" {
			return fmt.Errorf("key %s has invalid use: %s", key.KID, key.Use)
		}
		if key.N == "" || key.E == "" {
			return fmt.Errorf("key %s has empty modulus or exponent", key.KID)
		}
	}

	return nil
}
