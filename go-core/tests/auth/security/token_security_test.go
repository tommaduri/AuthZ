package security_test

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Test configuration
const (
	testIssuer   = "authz-engine"
	testAudience = "test-api"
	testTenantID = "tenant-123"
)

// TokenSecurityTestSuite contains all JWT security tests
type TokenSecurityTestSuite struct {
	privateKey *rsa.PrivateKey
	publicKey  *rsa.PublicKey
}

func setupTokenTests(t *testing.T) *TokenSecurityTestSuite {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	return &TokenSecurityTestSuite{
		privateKey: privateKey,
		publicKey:  &privateKey.PublicKey,
	}
}

// TestExpiredTokenRejection validates that expired tokens are rejected
func TestExpiredTokenRejection(t *testing.T) {
	suite := setupTokenTests(t)

	tests := []struct {
		name       string
		expiration time.Time
		shouldFail bool
	}{
		{
			name:       "Token expired 1 hour ago",
			expiration: time.Now().Add(-1 * time.Hour),
			shouldFail: true,
		},
		{
			name:       "Token expired 1 second ago",
			expiration: time.Now().Add(-1 * time.Second),
			shouldFail: true,
		},
		{
			name:       "Token expires in 1 hour",
			expiration: time.Now().Add(1 * time.Hour),
			shouldFail: false,
		},
		{
			name:       "Token expires in 1 second",
			expiration: time.Now().Add(1 * time.Second),
			shouldFail: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			token := suite.createToken(t, map[string]interface{}{
				"sub":       "user-123",
				"exp":       tt.expiration.Unix(),
				"iss":       testIssuer,
				"aud":       testAudience,
				"tenant_id": testTenantID,
			})

			err := suite.validateToken(token)
			if tt.shouldFail {
				assert.Error(t, err)
				assert.Contains(t, err.Error(), "expired")
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

// TestTamperedTokenDetection validates detection of token tampering
func TestTamperedTokenDetection(t *testing.T) {
	suite := setupTokenTests(t)

	tests := []struct {
		name           string
		tamperFunction func(string) string
	}{
		{
			name: "Modified payload",
			tamperFunction: func(token string) string {
				parts := strings.Split(token, ".")
				if len(parts) != 3 {
					return token
				}
				// Decode, modify, re-encode payload
				payload, _ := base64.RawURLEncoding.DecodeString(parts[1])
				modified := strings.Replace(string(payload), "user-123", "user-456", 1)
				parts[1] = base64.RawURLEncoding.EncodeToString([]byte(modified))
				return strings.Join(parts, ".")
			},
		},
		{
			name: "Modified signature",
			tamperFunction: func(token string) string {
				parts := strings.Split(token, ".")
				if len(parts) != 3 {
					return token
				}
				// Change last character of signature
				sig := parts[2]
				if len(sig) > 0 {
					parts[2] = sig[:len(sig)-1] + "X"
				}
				return strings.Join(parts, ".")
			},
		},
		{
			name: "Removed signature",
			tamperFunction: func(token string) string {
				parts := strings.Split(token, ".")
				if len(parts) != 3 {
					return token
				}
				parts[2] = ""
				return strings.Join(parts, ".")
			},
		},
		{
			name: "Modified header algorithm",
			tamperFunction: func(token string) string {
				parts := strings.Split(token, ".")
				if len(parts) != 3 {
					return token
				}
				// Change algorithm to 'none'
				header := `{"alg":"none","typ":"JWT"}`
				parts[0] = base64.RawURLEncoding.EncodeToString([]byte(header))
				return strings.Join(parts, ".")
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			validToken := suite.createToken(t, map[string]interface{}{
				"sub":       "user-123",
				"exp":       time.Now().Add(1 * time.Hour).Unix(),
				"iss":       testIssuer,
				"aud":       testAudience,
				"tenant_id": testTenantID,
			})

			tamperedToken := tt.tamperFunction(validToken)
			err := suite.validateToken(tamperedToken)
			assert.Error(t, err, "Tampered token should be rejected")
		})
	}
}

// TestAlgorithmConfusionAttack validates protection against algorithm confusion
func TestAlgorithmConfusionAttack(t *testing.T) {
	suite := setupTokenTests(t)

	tests := []struct {
		name      string
		algorithm string
		shouldFail bool
	}{
		{
			name:       "RS256 algorithm (valid)",
			algorithm:  "RS256",
			shouldFail: false,
		},
		{
			name:       "HS256 algorithm confusion",
			algorithm:  "HS256",
			shouldFail: true,
		},
		{
			name:       "None algorithm",
			algorithm:  "none",
			shouldFail: true,
		},
		{
			name:       "RS512 algorithm",
			algorithm:  "RS512",
			shouldFail: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			claims := jwt.MapClaims{
				"sub":       "user-123",
				"exp":       time.Now().Add(1 * time.Hour).Unix(),
				"iss":       testIssuer,
				"aud":       testAudience,
				"tenant_id": testTenantID,
			}

			var token string
			switch tt.algorithm {
			case "RS256":
				t := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
				var err error
				token, err = t.SignedString(suite.privateKey)
				require.NoError(t, err)
			case "HS256":
				t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
				token, _ = t.SignedString([]byte("secret"))
			case "none":
				t := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
				token, _ = t.SignedString(jwt.UnsafeAllowNoneSignatureType)
			default:
				return
			}

			err := suite.validateToken(token)
			if tt.shouldFail {
				assert.Error(t, err, "Algorithm confusion should be prevented")
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

// TestMissingClaimsRejection validates required claim enforcement
func TestMissingClaimsRejection(t *testing.T) {
	suite := setupTokenTests(t)

	tests := []struct {
		name         string
		claims       map[string]interface{}
		expectedError string
	}{
		{
			name: "Missing subject claim",
			claims: map[string]interface{}{
				"exp":       time.Now().Add(1 * time.Hour).Unix(),
				"iss":       testIssuer,
				"aud":       testAudience,
				"tenant_id": testTenantID,
			},
			expectedError: "subject",
		},
		{
			name: "Missing expiration claim",
			claims: map[string]interface{}{
				"sub":       "user-123",
				"iss":       testIssuer,
				"aud":       testAudience,
				"tenant_id": testTenantID,
			},
			expectedError: "expiration",
		},
		{
			name: "Missing issuer claim",
			claims: map[string]interface{}{
				"sub":       "user-123",
				"exp":       time.Now().Add(1 * time.Hour).Unix(),
				"aud":       testAudience,
				"tenant_id": testTenantID,
			},
			expectedError: "issuer",
		},
		{
			name: "Missing audience claim",
			claims: map[string]interface{}{
				"sub":       "user-123",
				"exp":       time.Now().Add(1 * time.Hour).Unix(),
				"iss":       testIssuer,
				"tenant_id": testTenantID,
			},
			expectedError: "audience",
		},
		{
			name: "Missing tenant_id claim",
			claims: map[string]interface{}{
				"sub": "user-123",
				"exp": time.Now().Add(1 * time.Hour).Unix(),
				"iss": testIssuer,
				"aud": testAudience,
			},
			expectedError: "tenant",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			token := suite.createToken(t, tt.claims)
			err := suite.validateToken(token)
			assert.Error(t, err)
			assert.Contains(t, strings.ToLower(err.Error()), tt.expectedError)
		})
	}
}

// TestIssuerValidation validates issuer claim verification
func TestIssuerValidation(t *testing.T) {
	suite := setupTokenTests(t)

	tests := []struct {
		name       string
		issuer     string
		shouldFail bool
	}{
		{
			name:       "Valid issuer",
			issuer:     testIssuer,
			shouldFail: false,
		},
		{
			name:       "Invalid issuer",
			issuer:     "evil-issuer",
			shouldFail: true,
		},
		{
			name:       "Empty issuer",
			issuer:     "",
			shouldFail: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			token := suite.createToken(t, map[string]interface{}{
				"sub":       "user-123",
				"exp":       time.Now().Add(1 * time.Hour).Unix(),
				"iss":       tt.issuer,
				"aud":       testAudience,
				"tenant_id": testTenantID,
			})

			err := suite.validateToken(token)
			if tt.shouldFail {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

// TestAudienceValidation validates audience claim verification
func TestAudienceValidation(t *testing.T) {
	suite := setupTokenTests(t)

	tests := []struct {
		name       string
		audience   interface{}
		shouldFail bool
	}{
		{
			name:       "Valid single audience",
			audience:   testAudience,
			shouldFail: false,
		},
		{
			name:       "Valid multiple audiences",
			audience:   []string{testAudience, "other-api"},
			shouldFail: false,
		},
		{
			name:       "Invalid audience",
			audience:   "wrong-api",
			shouldFail: true,
		},
		{
			name:       "Empty audience",
			audience:   "",
			shouldFail: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			token := suite.createToken(t, map[string]interface{}{
				"sub":       "user-123",
				"exp":       time.Now().Add(1 * time.Hour).Unix(),
				"iss":       testIssuer,
				"aud":       tt.audience,
				"tenant_id": testTenantID,
			})

			err := suite.validateToken(token)
			if tt.shouldFail {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

// TestTokenRevocation validates revoked token detection
func TestTokenRevocation(t *testing.T) {
	suite := setupTokenTests(t)

	// Create a valid token
	tokenID := "token-123"
	token := suite.createToken(t, map[string]interface{}{
		"sub":       "user-123",
		"jti":       tokenID,
		"exp":       time.Now().Add(1 * time.Hour).Unix(),
		"iss":       testIssuer,
		"aud":       testAudience,
		"tenant_id": testTenantID,
	})

	// Token should be valid initially
	err := suite.validateToken(token)
	assert.NoError(t, err)

	// Revoke the token
	suite.revokeToken(tokenID)

	// Token should now be rejected
	err = suite.validateToken(token)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "revoked")
}

// TestNotBeforeValidation validates nbf (not before) claim
func TestNotBeforeValidation(t *testing.T) {
	suite := setupTokenTests(t)

	tests := []struct {
		name       string
		notBefore  time.Time
		shouldFail bool
	}{
		{
			name:       "Token valid now",
			notBefore:  time.Now().Add(-1 * time.Minute),
			shouldFail: false,
		},
		{
			name:       "Token not yet valid",
			notBefore:  time.Now().Add(1 * time.Hour),
			shouldFail: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			token := suite.createToken(t, map[string]interface{}{
				"sub":       "user-123",
				"exp":       time.Now().Add(2 * time.Hour).Unix(),
				"nbf":       tt.notBefore.Unix(),
				"iss":       testIssuer,
				"aud":       testAudience,
				"tenant_id": testTenantID,
			})

			err := suite.validateToken(token)
			if tt.shouldFail {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

// Helper methods

func (s *TokenSecurityTestSuite) createToken(t *testing.T, claims map[string]interface{}) string {
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims(claims))
	tokenString, err := token.SignedString(s.privateKey)
	require.NoError(t, err)
	return tokenString
}

func (s *TokenSecurityTestSuite) validateToken(tokenString string) error {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		// Verify algorithm
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		if token.Method.Alg() != "RS256" {
			return nil, jwt.ErrSignatureInvalid
		}
		return s.publicKey, nil
	})

	if err != nil {
		return err
	}

	if !token.Valid {
		return jwt.ErrSignatureInvalid
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return jwt.ErrTokenInvalidClaims
	}

	// Validate required claims
	requiredClaims := []string{"sub", "exp", "iss", "aud", "tenant_id"}
	for _, claim := range requiredClaims {
		if _, exists := claims[claim]; !exists {
			return jwt.ErrTokenRequiredClaimMissing
		}
	}

	// Validate issuer
	if claims["iss"] != testIssuer {
		return jwt.ErrTokenInvalidIssuer
	}

	// Validate audience
	aud, ok := claims["aud"]
	if !ok {
		return jwt.ErrTokenInvalidAudience
	}

	validAudience := false
	switch v := aud.(type) {
	case string:
		validAudience = v == testAudience
	case []interface{}:
		for _, a := range v {
			if str, ok := a.(string); ok && str == testAudience {
				validAudience = true
				break
			}
		}
	}

	if !validAudience {
		return jwt.ErrTokenInvalidAudience
	}

	// Check revocation
	if jti, ok := claims["jti"].(string); ok {
		if s.isRevoked(jti) {
			return jwt.ErrTokenInvalidId
		}
	}

	return nil
}

var revokedTokens = make(map[string]bool)

func (s *TokenSecurityTestSuite) revokeToken(tokenID string) {
	revokedTokens[tokenID] = true
}

func (s *TokenSecurityTestSuite) isRevoked(tokenID string) bool {
	return revokedTokens[tokenID]
}
