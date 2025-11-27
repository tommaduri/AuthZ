package jwt

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"fmt"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewJWTValidator(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	publicKey := &privateKey.PublicKey

	tests := []struct {
		name    string
		config  *ValidatorConfig
		wantErr bool
	}{
		{
			name:    "nil config",
			config:  nil,
			wantErr: true,
		},
		{
			name: "missing public key",
			config: &ValidatorConfig{
				Issuer:   "test-issuer",
				Audience: "test-audience",
			},
			wantErr: true,
		},
		{
			name: "missing issuer",
			config: &ValidatorConfig{
				PublicKey: publicKey,
				Audience:  "test-audience",
			},
			wantErr: true,
		},
		{
			name: "missing audience",
			config: &ValidatorConfig{
				PublicKey: publicKey,
				Issuer:    "test-issuer",
			},
			wantErr: true,
		},
		{
			name: "valid config",
			config: &ValidatorConfig{
				PublicKey: publicKey,
				Issuer:    "test-issuer",
				Audience:  "test-audience",
			},
			wantErr: false,
		},
		{
			name: "skip checks for testing",
			config: &ValidatorConfig{
				PublicKey:         publicKey,
				SkipIssuerCheck:   true,
				SkipAudienceCheck: true,
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			validator, err := NewJWTValidator(tt.config)
			if tt.wantErr {
				assert.Error(t, err)
				assert.Nil(t, validator)
			} else {
				assert.NoError(t, err)
				assert.NotNil(t, validator)
			}
		})
	}
}

func TestValidate(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	issuer, err := NewJWTIssuer(&IssuerConfig{
		PrivateKey: privateKey,
		Issuer:     "authz-engine",
		Audience:   "authz-api",
		AccessTTL:  1 * time.Hour,
	})
	require.NoError(t, err)

	validator, err := NewJWTValidator(&ValidatorConfig{
		PublicKey: &privateKey.PublicKey,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	})
	require.NoError(t, err)

	ctx := context.Background()

	t.Run("valid token", func(t *testing.T) {
		// Generate token
		pair, err := issuer.IssueToken(ctx, "agent:test", []string{"admin"}, "tenant-1", []string{"read:*"})
		require.NoError(t, err)

		// Validate token
		claims, err := validator.Validate(ctx, pair.AccessToken)
		require.NoError(t, err)
		assert.NotNil(t, claims)
		assert.Equal(t, "agent:test", claims.Subject)
		assert.Equal(t, []string{"admin"}, claims.Roles)
		assert.Equal(t, "tenant-1", claims.TenantID)
	})

	t.Run("empty token", func(t *testing.T) {
		_, err := validator.Validate(ctx, "")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "empty token")
	})

	t.Run("malformed token", func(t *testing.T) {
		_, err := validator.Validate(ctx, "not-a-jwt-token")
		assert.Error(t, err)
	})

	t.Run("token with wrong signature", func(t *testing.T) {
		// Create token with different private key
		wrongKey, err := rsa.GenerateKey(rand.Reader, 2048)
		require.NoError(t, err)

		claims := &Claims{
			RegisteredClaims: jwt.RegisteredClaims{
				Subject:   "agent:test",
				Issuer:    "authz-engine",
				Audience:  jwt.ClaimStrings{"authz-api"},
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
				IssuedAt:  jwt.NewNumericDate(time.Now()),
				ID:        "test-jti",
			},
		}

		token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
		signedToken, err := token.SignedString(wrongKey)
		require.NoError(t, err)

		// Should fail validation
		_, err = validator.Validate(ctx, signedToken)
		assert.Error(t, err)
	})

	t.Run("expired token", func(t *testing.T) {
		// Create issuer with very short TTL
		shortIssuer, err := NewJWTIssuer(&IssuerConfig{
			PrivateKey: privateKey,
			Issuer:     "authz-engine",
			Audience:   "authz-api",
			AccessTTL:  1 * time.Millisecond,
		})
		require.NoError(t, err)

		pair, err := shortIssuer.IssueToken(ctx, "agent:test", []string{}, "", []string{})
		require.NoError(t, err)

		// Wait for expiration
		time.Sleep(10 * time.Millisecond)

		// Should fail validation
		_, err = validator.Validate(ctx, pair.AccessToken)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "expired")
	})

	t.Run("wrong issuer", func(t *testing.T) {
		// Create token with wrong issuer
		claims := &Claims{
			RegisteredClaims: jwt.RegisteredClaims{
				Subject:   "agent:test",
				Issuer:    "wrong-issuer",
				Audience:  jwt.ClaimStrings{"authz-api"},
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
				IssuedAt:  jwt.NewNumericDate(time.Now()),
				ID:        "test-jti",
			},
		}

		token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
		signedToken, err := token.SignedString(privateKey)
		require.NoError(t, err)

		_, err = validator.Validate(ctx, signedToken)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid issuer")
	})

	t.Run("wrong audience", func(t *testing.T) {
		claims := &Claims{
			RegisteredClaims: jwt.RegisteredClaims{
				Subject:   "agent:test",
				Issuer:    "authz-engine",
				Audience:  jwt.ClaimStrings{"wrong-audience"},
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
				IssuedAt:  jwt.NewNumericDate(time.Now()),
				ID:        "test-jti",
			},
		}

		token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
		signedToken, err := token.SignedString(privateKey)
		require.NoError(t, err)

		_, err = validator.Validate(ctx, signedToken)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid audience")
	})

	t.Run("missing JTI", func(t *testing.T) {
		claims := &Claims{
			RegisteredClaims: jwt.RegisteredClaims{
				Subject:   "agent:test",
				Issuer:    "authz-engine",
				Audience:  jwt.ClaimStrings{"authz-api"},
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
				IssuedAt:  jwt.NewNumericDate(time.Now()),
				// ID (JTI) intentionally missing
			},
		}

		token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
		signedToken, err := token.SignedString(privateKey)
		require.NoError(t, err)

		_, err = validator.Validate(ctx, signedToken)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "jti")
	})
}

func TestAlgorithmConfusion(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	validator, err := NewJWTValidator(&ValidatorConfig{
		PublicKey: &privateKey.PublicKey,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	})
	require.NoError(t, err)

	ctx := context.Background()

	t.Run("reject HS256 token", func(t *testing.T) {
		// Try to create token with HS256 (algorithm confusion attack)
		claims := &Claims{
			RegisteredClaims: jwt.RegisteredClaims{
				Subject:   "agent:test",
				Issuer:    "authz-engine",
				Audience:  jwt.ClaimStrings{"authz-api"},
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
				IssuedAt:  jwt.NewNumericDate(time.Now()),
				ID:        "test-jti",
			},
		}

		token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
		signedToken, err := token.SignedString([]byte("secret"))
		require.NoError(t, err)

		// Should reject HS256
		_, err = validator.Validate(ctx, signedToken)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "unexpected")
	})

	t.Run("reject none algorithm", func(t *testing.T) {
		claims := &Claims{
			RegisteredClaims: jwt.RegisteredClaims{
				Subject:   "agent:test",
				Issuer:    "authz-engine",
				Audience:  jwt.ClaimStrings{"authz-api"},
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
				IssuedAt:  jwt.NewNumericDate(time.Now()),
				ID:        "test-jti",
			},
		}

		token := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
		signedToken, err := token.SignedString(jwt.UnsafeAllowNoneSignatureType)
		require.NoError(t, err)

		_, err = validator.Validate(ctx, signedToken)
		assert.Error(t, err)
	})
}

func TestIsRevoked(t *testing.T) {
	// Note: This would require a real Redis instance or mock
	// For now, test without Redis client
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	validator, err := NewJWTValidator(&ValidatorConfig{
		PublicKey: &privateKey.PublicKey,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	})
	require.NoError(t, err)

	ctx := context.Background()

	t.Run("no redis client", func(t *testing.T) {
		isRevoked, err := validator.IsRevoked(ctx, "test-jti")
		assert.NoError(t, err)
		assert.False(t, isRevoked)
	})
}

func TestExtractPrincipal(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	validator, err := NewJWTValidator(&ValidatorConfig{
		PublicKey: &privateKey.PublicKey,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	})
	require.NoError(t, err)

	claims := &Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject: "agent:service-123",
		},
		Roles:    []string{"admin", "policy:write"},
		TenantID: "tenant-abc",
		Scopes:   []string{"read:*", "write:policies"},
	}

	principal := validator.ExtractPrincipal(claims)
	assert.NotNil(t, principal)
	assert.Equal(t, "agent:service-123", principal.ID)
	assert.Equal(t, []string{"admin", "policy:write"}, principal.Roles)
	assert.Equal(t, "tenant-abc", principal.TenantID)
	assert.Equal(t, []string{"read:*", "write:policies"}, principal.Scopes)
}

func BenchmarkValidate(b *testing.B) {
	privateKey, _ := rsa.GenerateKey(rand.Reader, 2048)

	issuer, _ := NewJWTIssuer(&IssuerConfig{
		PrivateKey: privateKey,
		Issuer:     "authz-engine",
		Audience:   "authz-api",
	})

	validator, _ := NewJWTValidator(&ValidatorConfig{
		PublicKey: &privateKey.PublicKey,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	})

	ctx := context.Background()
	pair, _ := issuer.IssueToken(ctx, "agent:benchmark", []string{"admin"}, "tenant-1", []string{"read:*"})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := validator.Validate(ctx, pair.AccessToken)
		if err != nil {
			b.Fatal(err)
		}
	}
}

// Integration test with Redis (requires Redis running)
func TestRevokeTokenWithRedis(t *testing.T) {
	// Skip if Redis not available
	redisClient := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
	})

	ctx := context.Background()
	if err := redisClient.Ping(ctx).Err(); err != nil {
		t.Skip("Redis not available, skipping integration test")
	}
	defer redisClient.Close()

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	validator, err := NewJWTValidator(&ValidatorConfig{
		PublicKey:   &privateKey.PublicKey,
		Issuer:      "authz-engine",
		Audience:    "authz-api",
		RedisClient: redisClient,
	})
	require.NoError(t, err)

	jti := "test-jti-" + time.Now().Format("20060102150405")
	expiresAt := time.Now().Add(1 * time.Hour)

	// Initially not revoked
	isRevoked, err := validator.IsRevoked(ctx, jti)
	require.NoError(t, err)
	assert.False(t, isRevoked)

	// Revoke token
	err = validator.RevokeToken(ctx, jti, expiresAt)
	require.NoError(t, err)

	// Now should be revoked
	isRevoked, err = validator.IsRevoked(ctx, jti)
	require.NoError(t, err)
	assert.True(t, isRevoked)

	// Cleanup
	redisClient.Del(ctx, fmt.Sprintf("blacklist:jwt:%s", jti))
}

func BenchmarkRevokeCheck(b *testing.B) {
	// Skip if Redis not available
	redisClient := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
	})

	ctx := context.Background()
	if err := redisClient.Ping(ctx).Err(); err != nil {
		b.Skip("Redis not available")
	}
	defer redisClient.Close()

	privateKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	validator, _ := NewJWTValidator(&ValidatorConfig{
		PublicKey:   &privateKey.PublicKey,
		Issuer:      "authz-engine",
		Audience:    "authz-api",
		RedisClient: redisClient,
	})

	jti := "benchmark-jti"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := validator.IsRevoked(ctx, jti)
		if err != nil {
			b.Fatal(err)
		}
	}
}
