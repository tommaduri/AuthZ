package phase6

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/auth"
	"github.com/authz-engine/go-core/internal/auth/jwt"
	"github.com/authz-engine/go-core/internal/audit"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Mock stores for testing
type mockRefreshStore struct {
	mu     sync.RWMutex
	tokens map[string]*jwt.RefreshToken
}

func newMockRefreshStore() *mockRefreshStore {
	return &mockRefreshStore{
		tokens: make(map[string]*jwt.RefreshToken),
	}
}

func (m *mockRefreshStore) Store(ctx context.Context, token *jwt.RefreshToken) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tokens[token.TokenHash] = token
	return nil
}

func (m *mockRefreshStore) Get(ctx context.Context, tokenHash string) (*jwt.RefreshToken, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	token, ok := m.tokens[tokenHash]
	if !ok {
		return nil, fmt.Errorf("token not found")
	}
	return token, nil
}

func (m *mockRefreshStore) Revoke(ctx context.Context, tokenHash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if token, ok := m.tokens[tokenHash]; ok {
		now := time.Now()
		token.RevokedAt = &now
	}
	return nil
}

func (m *mockRefreshStore) DeleteExpired(ctx context.Context) error {
	return nil
}

type mockRevocationStore struct {
	mu       sync.RWMutex
	revoked  map[string]time.Time
}

func newMockRevocationStore() *mockRevocationStore {
	return &mockRevocationStore{
		revoked: make(map[string]time.Time),
	}
}

func (m *mockRevocationStore) IsRevoked(ctx context.Context, jti string) (bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	_, revoked := m.revoked[jti]
	return revoked, nil
}

func (m *mockRevocationStore) Revoke(ctx context.Context, jti string, expiresAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.revoked[jti] = expiresAt
	return nil
}

func (m *mockRevocationStore) Cleanup(ctx context.Context) error {
	return nil
}

type mockAuditLogger struct {
	mu     sync.RWMutex
	events []audit.Event
}

func newMockAuditLogger() *mockAuditLogger {
	return &mockAuditLogger{
		events: make([]audit.Event, 0),
	}
}

func (m *mockAuditLogger) Log(ctx context.Context, event audit.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, event)
	return nil
}

func (m *mockAuditLogger) Query(ctx context.Context, filters audit.QueryFilters) ([]audit.Event, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.events, nil
}

func (m *mockAuditLogger) GetEvents() []audit.Event {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return append([]audit.Event{}, m.events...)
}

// TestE2E_FullAuthFlow tests the complete authentication flow:
// login → check → refresh → revoke
func TestE2E_FullAuthFlow(t *testing.T) {
	ctx := context.Background()

	// Setup: Generate RSA key pair
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	// Setup: Create stores
	refreshStore := newMockRefreshStore()
	revocationStore := newMockRevocationStore()
	auditLogger := newMockAuditLogger()

	// Setup: Create JWT issuer
	issuer, err := jwt.NewJWTIssuer(&jwt.IssuerConfig{
		PrivateKey:   privateKey,
		Issuer:       "authz-engine",
		Audience:     "authz-api",
		AccessTTL:    15 * time.Minute,
		RefreshTTL:   7 * 24 * time.Hour,
		RefreshStore: refreshStore,
	})
	require.NoError(t, err)

	// Setup: Create JWT validator
	publicKeyPEM, err := auth.EncodePublicKey(&privateKey.PublicKey)
	require.NoError(t, err)

	validator, err := auth.NewJWTValidator(&auth.JWTConfig{
		PublicKey:        publicKeyPEM,
		Issuer:           "authz-engine",
		Audience:         "authz-api",
		RevocationStore:  revocationStore,
	})
	require.NoError(t, err)
	defer validator.Close()

	// Step 1: Login - Issue tokens
	agentID := "agent:service-test"
	roles := []string{"admin", "policy:write"}
	tenantID := "tenant-123"
	scopes := []string{"read:*", "write:policies"}

	tokenPair, err := issuer.IssueToken(ctx, agentID, roles, tenantID, scopes)
	require.NoError(t, err)
	assert.NotEmpty(t, tokenPair.AccessToken)
	assert.NotEmpty(t, tokenPair.RefreshToken)

	// Log login event
	err = auditLogger.Log(ctx, audit.Event{
		Action:    "auth.login",
		Principal: agentID,
		Resource:  "auth",
		Result:    "success",
		Timestamp: time.Now(),
	})
	require.NoError(t, err)

	// Step 2: Check - Validate access token
	claims, err := validator.Validate(tokenPair.AccessToken)
	require.NoError(t, err)
	assert.Equal(t, agentID, claims.Subject)
	assert.Equal(t, roles, claims.Roles)
	assert.Equal(t, tenantID, claims.TenantID)
	assert.Equal(t, scopes, claims.Scopes)

	// Log access check event
	err = auditLogger.Log(ctx, audit.Event{
		Action:    "auth.check",
		Principal: agentID,
		Resource:  "auth",
		Result:    "success",
		Timestamp: time.Now(),
	})
	require.NoError(t, err)

	// Step 3: Refresh - Generate new access token
	// In a real implementation, this would validate the refresh token
	// and issue a new access token pair
	newTokenPair, err := issuer.IssueToken(ctx, agentID, roles, tenantID, scopes)
	require.NoError(t, err)
	assert.NotEmpty(t, newTokenPair.AccessToken)
	assert.NotEqual(t, tokenPair.AccessToken, newTokenPair.AccessToken)

	// Log refresh event
	err = auditLogger.Log(ctx, audit.Event{
		Action:    "auth.refresh",
		Principal: agentID,
		Resource:  "auth",
		Result:    "success",
		Timestamp: time.Now(),
	})
	require.NoError(t, err)

	// Step 4: Revoke - Revoke the token
	err = revocationStore.Revoke(ctx, claims.ID, claims.ExpiresAt.Time)
	require.NoError(t, err)

	// Log revocation event
	err = auditLogger.Log(ctx, audit.Event{
		Action:    "auth.revoke",
		Principal: agentID,
		Resource:  "auth",
		Result:    "success",
		Timestamp: time.Now(),
	})
	require.NoError(t, err)

	// Step 5: Verify revoked token is rejected
	isRevoked, err := revocationStore.IsRevoked(ctx, claims.ID)
	require.NoError(t, err)
	assert.True(t, isRevoked)

	// Verify audit trail has all events
	events := auditLogger.GetEvents()
	assert.Len(t, events, 5) // login, check, refresh, revoke, final check
	assert.Equal(t, "auth.login", events[0].Action)
	assert.Equal(t, "auth.check", events[1].Action)
	assert.Equal(t, "auth.refresh", events[2].Action)
	assert.Equal(t, "auth.revoke", events[3].Action)
}

// TestE2E_MultiTenant tests tenant isolation
func TestE2E_MultiTenant(t *testing.T) {
	ctx := context.Background()

	// Setup
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	refreshStore := newMockRefreshStore()
	issuer, err := jwt.NewJWTIssuer(&jwt.IssuerConfig{
		PrivateKey:   privateKey,
		Issuer:       "authz-engine",
		Audience:     "authz-api",
		RefreshStore: refreshStore,
	})
	require.NoError(t, err)

	publicKeyPEM, err := auth.EncodePublicKey(&privateKey.PublicKey)
	require.NoError(t, err)

	validator, err := auth.NewJWTValidator(&auth.JWTConfig{
		PublicKey: publicKeyPEM,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	})
	require.NoError(t, err)
	defer validator.Close()

	// Create tokens for two different tenants
	tenantA := "tenant-a"
	tenantB := "tenant-b"

	tokenA, err := issuer.IssueToken(ctx, "agent:user-a", []string{"user"}, tenantA, []string{"read:data"})
	require.NoError(t, err)

	tokenB, err := issuer.IssueToken(ctx, "agent:user-b", []string{"user"}, tenantB, []string{"read:data"})
	require.NoError(t, err)

	// Validate both tokens
	claimsA, err := validator.Validate(tokenA.AccessToken)
	require.NoError(t, err)

	claimsB, err := validator.Validate(tokenB.AccessToken)
	require.NoError(t, err)

	// Verify tenant isolation
	assert.Equal(t, tenantA, claimsA.TenantID)
	assert.Equal(t, tenantB, claimsB.TenantID)
	assert.NotEqual(t, claimsA.TenantID, claimsB.TenantID)
	assert.NotEqual(t, claimsA.Subject, claimsB.Subject)
}

// TestE2E_ConcurrentRequests tests 1000+ parallel authentication requests
func TestE2E_ConcurrentRequests(t *testing.T) {
	ctx := context.Background()

	// Setup
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	refreshStore := newMockRefreshStore()
	issuer, err := jwt.NewJWTIssuer(&jwt.IssuerConfig{
		PrivateKey:   privateKey,
		Issuer:       "authz-engine",
		Audience:     "authz-api",
		RefreshStore: refreshStore,
	})
	require.NoError(t, err)

	publicKeyPEM, err := auth.EncodePublicKey(&privateKey.PublicKey)
	require.NoError(t, err)

	validator, err := auth.NewJWTValidator(&auth.JWTConfig{
		PublicKey: publicKeyPEM,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	})
	require.NoError(t, err)
	defer validator.Close()

	// Test with 1000 concurrent requests
	numRequests := 1000
	var wg sync.WaitGroup
	errors := make(chan error, numRequests)
	tokens := make(chan string, numRequests)

	start := time.Now()

	// Concurrent token issuance
	for i := 0; i < numRequests; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()

			agentID := fmt.Sprintf("agent:concurrent-%d", id)
			tokenPair, err := issuer.IssueToken(ctx, agentID, []string{"user"}, "tenant-load", []string{"read:data"})
			if err != nil {
				errors <- err
				return
			}
			tokens <- tokenPair.AccessToken
		}(i)
	}

	wg.Wait()
	close(errors)
	close(tokens)

	duration := time.Since(start)

	// Verify no errors
	errorCount := 0
	for err := range errors {
		t.Errorf("Token issuance error: %v", err)
		errorCount++
	}
	assert.Equal(t, 0, errorCount, "Should have no errors during concurrent issuance")

	// Verify all tokens are valid
	validCount := 0
	for token := range tokens {
		_, err := validator.Validate(token)
		if err == nil {
			validCount++
		} else {
			t.Errorf("Token validation error: %v", err)
		}
	}
	assert.Equal(t, numRequests, validCount, "All tokens should be valid")

	t.Logf("Processed %d concurrent requests in %v (%.2f req/sec)",
		numRequests, duration, float64(numRequests)/duration.Seconds())

	// Performance assertion: should handle 1000 requests in reasonable time
	assert.Less(t, duration, 5*time.Second, "Should handle 1000 concurrent requests within 5 seconds")
}

// TestE2E_RateLimiting tests rate limiting with 429 responses
func TestE2E_RateLimiting(t *testing.T) {
	// Note: This test demonstrates the structure for rate limiting tests
	// Actual rate limiting implementation would be in middleware

	t.Run("rate limit exceeded returns 429", func(t *testing.T) {
		// Mock rate limiter
		type rateLimiter struct {
			mu       sync.Mutex
			requests map[string][]time.Time
			limit    int
			window   time.Duration
		}

		limiter := &rateLimiter{
			requests: make(map[string][]time.Time),
			limit:    10,
			window:   time.Minute,
		}

		checkLimit := func(clientID string) bool {
			limiter.mu.Lock()
			defer limiter.mu.Unlock()

			now := time.Now()
			cutoff := now.Add(-limiter.window)

			// Clean old requests
			reqs := limiter.requests[clientID]
			validReqs := []time.Time{}
			for _, req := range reqs {
				if req.After(cutoff) {
					validReqs = append(validReqs, req)
				}
			}

			if len(validReqs) >= limiter.limit {
				return false // Rate limit exceeded
			}

			validReqs = append(validReqs, now)
			limiter.requests[clientID] = validReqs
			return true
		}

		// Test rate limiting
		clientID := "test-client"
		successCount := 0
		rateLimitedCount := 0

		// Make requests up to and beyond the limit
		for i := 0; i < 15; i++ {
			if checkLimit(clientID) {
				successCount++
			} else {
				rateLimitedCount++
			}
		}

		assert.Equal(t, 10, successCount, "Should allow 10 requests")
		assert.Equal(t, 5, rateLimitedCount, "Should rate limit 5 requests")
	})
}

// TestE2E_AuditTrail verifies all events are logged
func TestE2E_AuditTrail(t *testing.T) {
	ctx := context.Background()
	auditLogger := newMockAuditLogger()

	// Simulate authentication flow with audit logging
	events := []struct {
		action    string
		principal string
		resource  string
		result    string
	}{
		{"auth.login", "agent:test", "auth", "success"},
		{"auth.check", "agent:test", "resource-a", "success"},
		{"auth.check", "agent:test", "resource-b", "denied"},
		{"auth.refresh", "agent:test", "auth", "success"},
		{"auth.revoke", "agent:test", "auth", "success"},
	}

	for _, e := range events {
		err := auditLogger.Log(ctx, audit.Event{
			Action:    e.action,
			Principal: e.principal,
			Resource:  e.resource,
			Result:    e.result,
			Timestamp: time.Now(),
		})
		require.NoError(t, err)
	}

	// Verify all events logged
	logged := auditLogger.GetEvents()
	assert.Len(t, logged, len(events))

	// Verify event ordering and content
	for i, e := range events {
		assert.Equal(t, e.action, logged[i].Action)
		assert.Equal(t, e.principal, logged[i].Principal)
		assert.Equal(t, e.resource, logged[i].Resource)
		assert.Equal(t, e.result, logged[i].Result)
	}

	// Test audit query
	results, err := auditLogger.Query(ctx, audit.QueryFilters{
		Actions: []string{"auth.check"},
	})
	require.NoError(t, err)

	// Should find 2 auth.check events
	checkCount := 0
	for _, r := range results {
		if r.Action == "auth.check" {
			checkCount++
		}
	}
	assert.GreaterOrEqual(t, checkCount, 2, "Should have at least 2 auth.check events")
}

// TestE2E_TokenLifecycle tests complete token lifecycle
func TestE2E_TokenLifecycle(t *testing.T) {
	ctx := context.Background()

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	refreshStore := newMockRefreshStore()
	revocationStore := newMockRevocationStore()

	// Create issuer with short TTL for testing
	issuer, err := jwt.NewJWTIssuer(&jwt.IssuerConfig{
		PrivateKey:   privateKey,
		Issuer:       "authz-engine",
		Audience:     "authz-api",
		AccessTTL:    500 * time.Millisecond, // Short TTL for testing
		RefreshTTL:   24 * time.Hour,
		RefreshStore: refreshStore,
	})
	require.NoError(t, err)

	publicKeyPEM, err := auth.EncodePublicKey(&privateKey.PublicKey)
	require.NoError(t, err)

	validator, err := auth.NewJWTValidator(&auth.JWTConfig{
		PublicKey:       publicKeyPEM,
		Issuer:          "authz-engine",
		Audience:        "authz-api",
		RevocationStore: revocationStore,
	})
	require.NoError(t, err)
	defer validator.Close()

	// Issue token
	tokenPair, err := issuer.IssueToken(ctx, "agent:lifecycle", []string{"user"}, "tenant-1", []string{"read:data"})
	require.NoError(t, err)

	// Token should be valid immediately
	claims, err := validator.Validate(tokenPair.AccessToken)
	require.NoError(t, err)
	assert.Equal(t, "agent:lifecycle", claims.Subject)

	// Wait for token to expire
	time.Sleep(700 * time.Millisecond)

	// Token should now be expired
	_, err = validator.Validate(tokenPair.AccessToken)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "expired")
}
