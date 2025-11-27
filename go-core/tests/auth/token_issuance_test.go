package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"database/sql"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/agent"
	"github.com/authz-engine/go-core/internal/auth"
	"github.com/authz-engine/go-core/internal/auth/jwt"
	"github.com/authz-engine/go-core/internal/cache"
	"github.com/authz-engine/go-core/internal/database"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zaptest"
)

// TestIssueToken tests the IssueToken function with valid credentials
func TestIssueToken(t *testing.T) {
	ctx := context.Background()
	issuer, cleanup := setupIssuer(t)
	defer cleanup()

	// Create test agent
	agentID := "test-agent-" + randomID()
	password := "SecureP@ss123"
	tenantID := "tenant-123"

	// Store agent credentials
	passwordHash, err := auth.HashPassword(password)
	require.NoError(t, err)

	testAgent := &agent.Agent{
		ID:           agentID,
		Type:         "service",
		Status:       "active",
		TenantID:     tenantID,
		PasswordHash: passwordHash,
		Metadata: map[string]interface{}{
			"roles":  []string{"admin", "policy:write"},
			"scopes": []string{"read:*", "write:policies"},
		},
	}

	err = issuer.AgentStore.Create(ctx, testAgent)
	require.NoError(t, err)

	// Issue token
	tokenPair, err := issuer.IssueToken(agentID, password, tenantID)
	require.NoError(t, err)
	assert.NotEmpty(t, tokenPair.AccessToken)
	assert.NotEmpty(t, tokenPair.RefreshToken)
	assert.Equal(t, "Bearer", tokenPair.TokenType)
	assert.Greater(t, tokenPair.ExpiresIn, int64(0))

	// Validate access token structure
	token, err := jwt.ParseWithClaims(tokenPair.AccessToken, &jwt.Claims{}, func(token *jwt.Token) (interface{}, error) {
		return &issuer.PrivateKey.PublicKey, nil
	})
	require.NoError(t, err)
	assert.True(t, token.Valid)

	claims := token.Claims.(*jwt.Claims)
	assert.Equal(t, agentID, claims.AgentID)
	assert.Equal(t, tenantID, claims.TenantID)
	assert.Contains(t, claims.Roles, "admin")
	assert.Contains(t, claims.Scopes, "read:*")
}

// TestIssueTokenInvalidPassword tests token issuance with invalid password
func TestIssueTokenInvalidPassword(t *testing.T) {
	ctx := context.Background()
	issuer, cleanup := setupIssuer(t)
	defer cleanup()

	// Create test agent
	agentID := "test-agent-" + randomID()
	password := "SecureP@ss123"
	tenantID := "tenant-123"

	passwordHash, err := auth.HashPassword(password)
	require.NoError(t, err)

	testAgent := &agent.Agent{
		ID:           agentID,
		Type:         "service",
		Status:       "active",
		TenantID:     tenantID,
		PasswordHash: passwordHash,
	}

	err = issuer.AgentStore.Create(ctx, testAgent)
	require.NoError(t, err)

	// Attempt with wrong password
	_, err = issuer.IssueToken(agentID, "WrongPassword", tenantID)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid credentials")
}

// TestIssueTokenNonexistentAgent tests token issuance with nonexistent agent
func TestIssueTokenNonexistentAgent(t *testing.T) {
	issuer, cleanup := setupIssuer(t)
	defer cleanup()

	_, err := issuer.IssueToken("nonexistent-agent", "password", "tenant-123")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "agent not found")
}

// TestIssueTokenInactiveAgent tests that inactive agents cannot get tokens
func TestIssueTokenInactiveAgent(t *testing.T) {
	ctx := context.Background()
	issuer, cleanup := setupIssuer(t)
	defer cleanup()

	agentID := "test-agent-" + randomID()
	password := "SecureP@ss123"
	passwordHash, err := auth.HashPassword(password)
	require.NoError(t, err)

	testAgent := &agent.Agent{
		ID:           agentID,
		Type:         "service",
		Status:       "inactive", // Not active
		TenantID:     "tenant-123",
		PasswordHash: passwordHash,
	}

	err = issuer.AgentStore.Create(ctx, testAgent)
	require.NoError(t, err)

	_, err = issuer.IssueToken(agentID, password, "tenant-123")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not active")
}

// TestRefreshToken tests token refresh functionality
func TestRefreshToken(t *testing.T) {
	ctx := context.Background()
	issuer, cleanup := setupIssuer(t)
	defer cleanup()

	// Setup agent and issue initial token
	agentID := "test-agent-" + randomID()
	password := "SecureP@ss123"
	tenantID := "tenant-123"

	passwordHash, err := auth.HashPassword(password)
	require.NoError(t, err)

	testAgent := &agent.Agent{
		ID:           agentID,
		Type:         "service",
		Status:       "active",
		TenantID:     tenantID,
		PasswordHash: passwordHash,
		Metadata: map[string]interface{}{
			"roles":  []string{"admin"},
			"scopes": []string{"read:*"},
		},
	}

	err = issuer.AgentStore.Create(ctx, testAgent)
	require.NoError(t, err)

	initialPair, err := issuer.IssueToken(agentID, password, tenantID)
	require.NoError(t, err)

	// Wait a moment to ensure timestamps differ
	time.Sleep(100 * time.Millisecond)

	// Refresh token
	newPair, err := issuer.RefreshToken(initialPair.RefreshToken)
	require.NoError(t, err)
	assert.NotEmpty(t, newPair.AccessToken)
	assert.NotEqual(t, initialPair.AccessToken, newPair.AccessToken, "New access token should differ")

	// Validate new access token
	token, err := jwt.ParseWithClaims(newPair.AccessToken, &jwt.Claims{}, func(token *jwt.Token) (interface{}, error) {
		return &issuer.PrivateKey.PublicKey, nil
	})
	require.NoError(t, err)
	assert.True(t, token.Valid)
}

// TestRefreshTokenInvalid tests refresh with invalid refresh token
func TestRefreshTokenInvalid(t *testing.T) {
	issuer, cleanup := setupIssuer(t)
	defer cleanup()

	_, err := issuer.RefreshToken("invalid_refresh_token")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

// TestRefreshTokenExpired tests that expired refresh tokens are rejected
func TestRefreshTokenExpired(t *testing.T) {
	ctx := context.Background()
	issuer, cleanup := setupIssuer(t)
	defer cleanup()

	// Create expired refresh token
	agentID := "test-agent-" + randomID()
	refreshToken := &jwt.RefreshToken{
		ID:             randomID(),
		TokenHash:      "test-hash",
		AgentID:        agentID,
		AccessTokenJTI: randomID(),
		CreatedAt:      time.Now().Add(-8 * 24 * time.Hour),
		ExpiresAt:      time.Now().Add(-1 * time.Hour), // Expired
	}

	err := issuer.RefreshStore.Store(ctx, refreshToken)
	require.NoError(t, err)

	_, err = issuer.RefreshToken("refresh_test-token")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "expired")
}

// TestRefreshTokenRevoked tests that revoked refresh tokens cannot be used
func TestRefreshTokenRevoked(t *testing.T) {
	ctx := context.Background()
	issuer, cleanup := setupIssuer(t)
	defer cleanup()

	// Setup and issue token
	agentID := "test-agent-" + randomID()
	password := "SecureP@ss123"
	passwordHash, err := auth.HashPassword(password)
	require.NoError(t, err)

	testAgent := &agent.Agent{
		ID:           agentID,
		Type:         "service",
		Status:       "active",
		TenantID:     "tenant-123",
		PasswordHash: passwordHash,
	}

	err = issuer.AgentStore.Create(ctx, testAgent)
	require.NoError(t, err)

	tokenPair, err := issuer.IssueToken(agentID, password, "tenant-123")
	require.NoError(t, err)

	// Revoke the refresh token
	// Parse token to get JTI
	token, _ := jwt.ParseWithClaims(tokenPair.AccessToken, &jwt.Claims{}, func(token *jwt.Token) (interface{}, error) {
		return &issuer.PrivateKey.PublicKey, nil
	})
	claims := token.Claims.(*jwt.Claims)

	err = issuer.RevokeToken(claims.ID)
	require.NoError(t, err)

	// Try to use revoked refresh token
	_, err = issuer.RefreshToken(tokenPair.RefreshToken)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "revoked")
}

// TestRevokeToken tests token revocation
func TestRevokeToken(t *testing.T) {
	ctx := context.Background()
	issuer, cleanup := setupIssuer(t)
	defer cleanup()

	// Setup and issue token
	agentID := "test-agent-" + randomID()
	password := "SecureP@ss123"
	passwordHash, err := auth.HashPassword(password)
	require.NoError(t, err)

	testAgent := &agent.Agent{
		ID:           agentID,
		Type:         "service",
		Status:       "active",
		TenantID:     "tenant-123",
		PasswordHash: passwordHash,
	}

	err = issuer.AgentStore.Create(ctx, testAgent)
	require.NoError(t, err)

	tokenPair, err := issuer.IssueToken(agentID, password, "tenant-123")
	require.NoError(t, err)

	// Parse token to get JTI
	token, err := jwt.ParseWithClaims(tokenPair.AccessToken, &jwt.Claims{}, func(token *jwt.Token) (interface{}, error) {
		return &issuer.PrivateKey.PublicKey, nil
	})
	require.NoError(t, err)

	claims := token.Claims.(*jwt.Claims)

	// Revoke token
	err = issuer.RevokeToken(claims.ID)
	assert.NoError(t, err)

	// Verify token is in Redis blacklist
	// This would require checking Redis directly in a real test
}

// TestPasswordValidation tests password validation rules
func TestPasswordValidation(t *testing.T) {
	tests := []struct {
		name     string
		password string
		wantErr  bool
	}{
		{"valid password", "SecureP@ss123", false},
		{"too short", "Pass1!", true},
		{"no uppercase", "securep@ss123", true},
		{"no lowercase", "SECUREP@SS123", true},
		{"no digit", "SecureP@ss", true},
		{"no special char", "SecurePass123", true},
		{"empty", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := auth.ValidatePassword(tt.password)
			if tt.wantErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

// TestPasswordHashing tests password hashing and verification
func TestPasswordHashing(t *testing.T) {
	password := "SecureP@ss123"

	// Hash password
	hash, err := auth.HashPassword(password)
	require.NoError(t, err)
	assert.NotEmpty(t, hash)
	assert.NotEqual(t, password, hash, "Hash should not equal plaintext")

	// Verify correct password
	valid, err := auth.VerifyPassword(password, hash)
	require.NoError(t, err)
	assert.True(t, valid)

	// Verify incorrect password
	valid, err = auth.VerifyPassword("WrongPassword", hash)
	require.NoError(t, err)
	assert.False(t, valid)
}

// TestPasswordTimingAttackResistance tests constant-time comparison
func TestPasswordTimingAttackResistance(t *testing.T) {
	password := "SecureP@ss123"
	hash, err := auth.HashPassword(password)
	require.NoError(t, err)

	// Multiple verification attempts should take similar time
	iterations := 100
	var durations []time.Duration

	for i := 0; i < iterations; i++ {
		start := time.Now()
		auth.VerifyPassword("WrongPassword"+string(rune(i)), hash)
		durations = append(durations, time.Since(start))
	}

	// Check that timing variance is within acceptable range
	// This is a basic check; timing attacks are complex to test
	maxDuration := time.Duration(0)
	minDuration := time.Hour
	for _, d := range durations {
		if d > maxDuration {
			maxDuration = d
		}
		if d < minDuration {
			minDuration = d
		}
	}

	// Variance should be relatively small
	variance := maxDuration - minDuration
	avgDuration := (maxDuration + minDuration) / 2
	assert.Less(t, float64(variance)/float64(avgDuration), 0.5, "Timing variance too high")
}

// TestTokenExpirationEnforcement tests that expired tokens are rejected
func TestTokenExpirationEnforcement(t *testing.T) {
	ctx := context.Background()
	issuer, cleanup := setupIssuer(t)
	defer cleanup()

	// Create issuer with very short TTL
	issuer.AccessTTL = 1 * time.Millisecond

	agentID := "test-agent-" + randomID()
	password := "SecureP@ss123"
	passwordHash, err := auth.HashPassword(password)
	require.NoError(t, err)

	testAgent := &agent.Agent{
		ID:           agentID,
		Type:         "service",
		Status:       "active",
		TenantID:     "tenant-123",
		PasswordHash: passwordHash,
	}

	err = issuer.AgentStore.Create(ctx, testAgent)
	require.NoError(t, err)

	tokenPair, err := issuer.IssueToken(agentID, password, "tenant-123")
	require.NoError(t, err)

	// Wait for token to expire
	time.Sleep(100 * time.Millisecond)

	// Try to parse expired token
	token, err := jwt.ParseWithClaims(tokenPair.AccessToken, &jwt.Claims{}, func(token *jwt.Token) (interface{}, error) {
		return &issuer.PrivateKey.PublicKey, nil
	})

	// Token should be invalid due to expiration
	assert.Error(t, err)
	if token != nil {
		assert.False(t, token.Valid)
	}
}

// TestMultiTenantIsolation tests tenant isolation in token claims
func TestMultiTenantIsolation(t *testing.T) {
	ctx := context.Background()
	issuer, cleanup := setupIssuer(t)
	defer cleanup()

	// Create agents for different tenants
	tenant1ID := "tenant-1"
	tenant2ID := "tenant-2"

	agent1ID := "agent-tenant1-" + randomID()
	agent2ID := "agent-tenant2-" + randomID()

	password := "SecureP@ss123"
	passwordHash, err := auth.HashPassword(password)
	require.NoError(t, err)

	agent1 := &agent.Agent{
		ID:           agent1ID,
		Type:         "service",
		Status:       "active",
		TenantID:     tenant1ID,
		PasswordHash: passwordHash,
	}

	agent2 := &agent.Agent{
		ID:           agent2ID,
		Type:         "service",
		Status:       "active",
		TenantID:     tenant2ID,
		PasswordHash: passwordHash,
	}

	err = issuer.AgentStore.Create(ctx, agent1)
	require.NoError(t, err)
	err = issuer.AgentStore.Create(ctx, agent2)
	require.NoError(t, err)

	// Issue tokens for both agents
	token1, err := issuer.IssueToken(agent1ID, password, tenant1ID)
	require.NoError(t, err)

	token2, err := issuer.IssueToken(agent2ID, password, tenant2ID)
	require.NoError(t, err)

	// Parse tokens and verify tenant isolation
	parsedToken1, _ := jwt.ParseWithClaims(token1.AccessToken, &jwt.Claims{}, func(token *jwt.Token) (interface{}, error) {
		return &issuer.PrivateKey.PublicKey, nil
	})
	claims1 := parsedToken1.Claims.(*jwt.Claims)

	parsedToken2, _ := jwt.ParseWithClaims(token2.AccessToken, &jwt.Claims{}, func(token *jwt.Token) (interface{}, error) {
		return &issuer.PrivateKey.PublicKey, nil
	})
	claims2 := parsedToken2.Claims.(*jwt.Claims)

	assert.Equal(t, tenant1ID, claims1.TenantID)
	assert.Equal(t, tenant2ID, claims2.TenantID)
	assert.NotEqual(t, claims1.TenantID, claims2.TenantID)
}

// Helper functions

func setupIssuer(t *testing.T) (*auth.TokenIssuer, func()) {
	// Generate RSA key pair for testing
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	// Setup in-memory database
	db, err := database.NewTestDB(t)
	require.NoError(t, err)

	// Setup agent store
	agentStore := agent.NewPostgresStore(db)

	// Setup refresh token store
	refreshStore := jwt.NewPostgresRefreshStore(db)

	// Setup Redis for blacklist (mock or testcontainer)
	// For now, use nil and mock if needed
	var redisClient *redis.Client = nil

	// Create cache
	agentCache := cache.NewLRU(100, 5*time.Minute)

	logger := zaptest.NewLogger(t)

	issuer, err := auth.NewTokenIssuer(&auth.TokenIssuerConfig{
		PrivateKey:   privateKey,
		Issuer:       "authz-engine-test",
		Audience:     "authz-api-test",
		AccessTTL:    1 * time.Hour,
		RefreshTTL:   7 * 24 * time.Hour,
		RefreshStore: refreshStore,
		AgentStore:   agentStore,
		AgentCache:   agentCache,
		RedisClient:  redisClient,
		Logger:       logger,
	})
	require.NoError(t, err)

	cleanup := func() {
		db.Close()
		if redisClient != nil {
			redisClient.Close()
		}
	}

	return issuer, cleanup
}

func randomID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return fmt.Sprintf("%x", b)
}
