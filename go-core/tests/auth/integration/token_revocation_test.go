package integration

import (
	"context"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stretchr/testify/suite"

	jwtpkg "authz-engine/internal/auth/jwt"
)

type TokenRevocationSuite struct {
	suite.Suite
	redisClient  *redis.Client
	revoker      *jwtpkg.TokenRevoker
	issuer       *jwtpkg.JWTIssuer
	validator    *jwtpkg.JWTValidator
	testSecret   []byte
}

func (s *TokenRevocationSuite) SetupSuite() {
	// Setup Redis client
	s.redisClient = redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
		DB:   1, // Use separate DB for testing
	})

	ctx := context.Background()
	if err := s.redisClient.Ping(ctx).Err(); err != nil {
		s.T().Skip("Redis not available for integration tests")
	}

	s.testSecret = []byte("test-secret-key-32-bytes-long!")

	// Initialize components
	s.revoker = jwtpkg.NewTokenRevoker(s.redisClient)
	s.issuer = jwtpkg.NewJWTIssuer(s.testSecret, s.revoker)
	s.validator = jwtpkg.NewJWTValidator(s.testSecret, s.revoker)
}

func (s *TokenRevocationSuite) TearDownSuite() {
	if s.redisClient != nil {
		s.redisClient.FlushDB(context.Background())
		s.redisClient.Close()
	}
}

func (s *TokenRevocationSuite) SetupTest() {
	// Clear Redis before each test
	s.redisClient.FlushDB(context.Background())
}

func TestTokenRevocationSuite(t *testing.T) {
	suite.Run(t, new(TokenRevocationSuite))
}

func (s *TokenRevocationSuite) TestFullRevocationFlow() {
	ctx := context.Background()

	// 1. Issue a token
	claims := jwt.MapClaims{
		"sub": "user-123",
		"exp": time.Now().Add(1 * time.Hour).Unix(),
		"iat": time.Now().Unix(),
		"jti": "test-token-123",
	}

	tokenString, err := s.issuer.IssueToken(claims)
	require.NoError(s.T(), err)
	require.NotEmpty(s.T(), tokenString)

	// 2. Validate token (should be valid)
	validatedClaims, err := s.validator.ValidateToken(ctx, tokenString)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), "user-123", validatedClaims["sub"])

	// 3. Revoke the token
	expiresAt := time.Unix(int64(claims["exp"].(int64)), 0)
	err = s.revoker.RevokeToken(ctx, "test-token-123", expiresAt)
	require.NoError(s.T(), err)

	// 4. Validate token again (should fail)
	_, err = s.validator.ValidateToken(ctx, tokenString)
	assert.Error(s.T(), err)
	assert.Contains(s.T(), err.Error(), "revoked")
}

func (s *TokenRevocationSuite) TestRevokeAccessAndRefreshTokens() {
	ctx := context.Background()

	// Issue access token
	accessClaims := jwt.MapClaims{
		"sub":  "user-456",
		"type": "access",
		"exp":  time.Now().Add(15 * time.Minute).Unix(),
		"jti":  "access-token-456",
	}
	accessToken, err := s.issuer.IssueToken(accessClaims)
	require.NoError(s.T(), err)

	// Issue refresh token
	refreshClaims := jwt.MapClaims{
		"sub":  "user-456",
		"type": "refresh",
		"exp":  time.Now().Add(7 * 24 * time.Hour).Unix(),
		"jti":  "refresh-token-456",
	}
	refreshToken, err := s.issuer.IssueToken(refreshClaims)
	require.NoError(s.T(), err)

	// Both should be valid
	_, err = s.validator.ValidateToken(ctx, accessToken)
	require.NoError(s.T(), err)
	_, err = s.validator.ValidateToken(ctx, refreshToken)
	require.NoError(s.T(), err)

	// Revoke both tokens
	tokens := map[string]time.Time{
		"access-token-456":  time.Unix(accessClaims["exp"].(int64), 0),
		"refresh-token-456": time.Unix(refreshClaims["exp"].(int64), 0),
	}
	err = s.revoker.RevokeTokenBatch(ctx, tokens)
	require.NoError(s.T(), err)

	// Both should now be revoked
	_, err = s.validator.ValidateToken(ctx, accessToken)
	assert.Error(s.T(), err)
	_, err = s.validator.ValidateToken(ctx, refreshToken)
	assert.Error(s.T(), err)
}

func (s *TokenRevocationSuite) TestRevocationWithExpiredToken() {
	ctx := context.Background()

	// Issue token with very short expiration
	claims := jwt.MapClaims{
		"sub": "user-789",
		"exp": time.Now().Add(1 * time.Second).Unix(),
		"jti": "short-lived-token",
	}

	tokenString, err := s.issuer.IssueToken(claims)
	require.NoError(s.T(), err)

	// Wait for token to expire
	time.Sleep(2 * time.Second)

	// Validate should fail due to expiration
	_, err = s.validator.ValidateToken(ctx, tokenString)
	assert.Error(s.T(), err)

	// Revoke expired token (should succeed but not add to Redis)
	expiresAt := time.Unix(claims["exp"].(int64), 0)
	err = s.revoker.RevokeToken(ctx, "short-lived-token", expiresAt)
	require.NoError(s.T(), err)

	// Verify it's not in Redis
	isRevoked, err := s.revoker.IsRevoked(ctx, "short-lived-token")
	require.NoError(s.T(), err)
	assert.False(s.T(), isRevoked, "Expired token should not be added to blacklist")
}

func (s *TokenRevocationSuite) TestRevocationPerformance() {
	ctx := context.Background()

	// Pre-populate with 1000 revoked tokens
	tokens := make(map[string]time.Time)
	for i := 0; i < 1000; i++ {
		jti := fmt.Sprintf("perf-token-%d", i)
		tokens[jti] = time.Now().Add(1 * time.Hour)
	}

	err := s.revoker.RevokeTokenBatch(ctx, tokens)
	require.NoError(s.T(), err)

	// Measure check performance
	start := time.Now()
	iterations := 1000

	for i := 0; i < iterations; i++ {
		jti := fmt.Sprintf("perf-token-%d", i%1000)
		_, err := s.revoker.IsRevoked(ctx, jti)
		require.NoError(s.T(), err)
	}

	duration := time.Since(start)
	avgDuration := duration / time.Duration(iterations)

	// Verify <5ms target
	assert.Less(s.T(), avgDuration, 5*time.Millisecond,
		"Average revocation check should be <5ms, got %v", avgDuration)

	s.T().Logf("Average revocation check time: %v", avgDuration)
}

func (s *TokenRevocationSuite) TestConcurrentRevocation() {
	ctx := context.Background()

	// Issue 100 tokens
	var tokens []string
	var jtis []string
	expiresAt := time.Now().Add(1 * time.Hour)

	for i := 0; i < 100; i++ {
		jti := fmt.Sprintf("concurrent-token-%d", i)
		jtis = append(jtis, jti)

		claims := jwt.MapClaims{
			"sub": fmt.Sprintf("user-%d", i),
			"exp": expiresAt.Unix(),
			"jti": jti,
		}

		token, err := s.issuer.IssueToken(claims)
		require.NoError(s.T(), err)
		tokens = append(tokens, token)
	}

	// Concurrently revoke all tokens
	done := make(chan error, 100)
	for i := 0; i < 100; i++ {
		go func(idx int) {
			err := s.revoker.RevokeToken(ctx, jtis[idx], expiresAt)
			done <- err
		}(i)
	}

	// Wait for all revocations
	for i := 0; i < 100; i++ {
		err := <-done
		assert.NoError(s.T(), err)
	}

	// Verify all tokens are revoked
	status, err := s.revoker.IsRevokedBatch(ctx, jtis)
	require.NoError(s.T(), err)

	for jti, revoked := range status {
		assert.True(s.T(), revoked, "Token %s should be revoked", jti)
	}
}

func (s *TokenRevocationSuite) TestBlacklistTTLCleanup() {
	ctx := context.Background()

	// Issue token with 2 second expiration
	expiresAt := time.Now().Add(2 * time.Second)
	jti := "ttl-cleanup-token"

	err := s.revoker.RevokeToken(ctx, jti, expiresAt)
	require.NoError(s.T(), err)

	// Verify it's in blacklist
	isRevoked, err := s.revoker.IsRevoked(ctx, jti)
	require.NoError(s.T(), err)
	assert.True(s.T(), isRevoked)

	// Wait for TTL expiration
	time.Sleep(3 * time.Second)

	// Verify automatic cleanup
	isRevoked, err = s.revoker.IsRevoked(ctx, jti)
	require.NoError(s.T(), err)
	assert.False(s.T(), isRevoked, "Token should be auto-removed after TTL")
}

func (s *TokenRevocationSuite) TestBlacklistSize() {
	ctx := context.Background()

	// Add 50 tokens
	expiresAt := time.Now().Add(1 * time.Hour)
	for i := 0; i < 50; i++ {
		jti := fmt.Sprintf("size-test-token-%d", i)
		err := s.revoker.RevokeToken(ctx, jti, expiresAt)
		require.NoError(s.T(), err)
	}

	// Check blacklist size
	size, err := s.revoker.GetBlacklistSize(ctx)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), int64(50), size)
}

func (s *TokenRevocationSuite) TestRevocationEndpoint() {
	// This test would typically test the HTTP handler
	// For now, we test the underlying functionality
	ctx := context.Background()

	// Simulate revocation request
	jti := "endpoint-test-token"
	expiresAt := time.Now().Add(1 * time.Hour)

	// Revoke token
	err := s.revoker.RevokeToken(ctx, jti, expiresAt)
	require.NoError(s.T(), err)

	// Verify revocation
	isRevoked, err := s.revoker.IsRevoked(ctx, jti)
	require.NoError(s.T(), err)
	assert.True(s.T(), isRevoked)
}

// Helper to add fmt import
import "fmt"
