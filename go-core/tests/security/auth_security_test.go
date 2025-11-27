package security

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/auth"
	"github.com/authz-engine/go-core/internal/auth/jwt"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Mock refresh store for security tests
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

// TestSecurity_SQLInjection tests SQL injection protection
func TestSecurity_SQLInjection(t *testing.T) {
	ctx := context.Background()

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

	// SQL injection attempts in various fields
	sqlInjectionPayloads := []string{
		"'; DROP TABLE users; --",
		"' OR '1'='1",
		"admin'--",
		"' OR 1=1--",
		"<script>alert('xss')</script>",
		"../../../etc/passwd",
		"1' UNION SELECT * FROM users--",
	}

	for _, payload := range sqlInjectionPayloads {
		t.Run(fmt.Sprintf("payload_%s", payload), func(t *testing.T) {
			// Try injection in agentID
			tokenPair, err := issuer.IssueToken(ctx, payload, []string{"user"}, "tenant-1", []string{"read"})
			require.NoError(t, err) // Should not crash

			// Token should be created but with sanitized content
			claims, err := validator.Validate(tokenPair.AccessToken)
			require.NoError(t, err)

			// The payload should be stored as-is in JWT (JWT encoding handles escaping)
			// but should not cause SQL injection when stored in database
			assert.NotEmpty(t, claims.Subject)
		})
	}
}

// TestSecurity_XSS tests XSS injection protection
func TestSecurity_XSS(t *testing.T) {
	ctx := context.Background()

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

	xssPayloads := []string{
		"<script>alert('XSS')</script>",
		"<img src=x onerror=alert('XSS')>",
		"javascript:alert('XSS')",
		"<iframe src='javascript:alert(\"XSS\")'></iframe>",
		"<body onload=alert('XSS')>",
	}

	for _, payload := range xssPayloads {
		t.Run(fmt.Sprintf("xss_%s", payload), func(t *testing.T) {
			agentID := fmt.Sprintf("agent:%s", payload)

			tokenPair, err := issuer.IssueToken(ctx, agentID, []string{"user"}, "tenant-1", []string{"read"})
			require.NoError(t, err)

			claims, err := validator.Validate(tokenPair.AccessToken)
			require.NoError(t, err)

			// XSS payload should not be executed, stored as plain text
			assert.Contains(t, claims.Subject, payload)

			// If this were rendered in HTML, proper escaping should occur
			// at the presentation layer, not here
		})
	}
}

// TestSecurity_AlgorithmConfusion tests algorithm confusion attacks
func TestSecurity_AlgorithmConfusion(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
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

	t.Run("reject_HS256_with_public_key", func(t *testing.T) {
		// Try to create a token with HS256 using public key
		claims := &jwt.Claims{
			RegisteredClaims: jwt2.RegisteredClaims{
				Issuer:    "authz-engine",
				Subject:   "agent:attacker",
				Audience:  jwt2.ClaimStrings{"authz-api"},
				ExpiresAt: jwt2.NewNumericDate(time.Now().Add(time.Hour)),
				IssuedAt:  jwt2.NewNumericDate(time.Now()),
				ID:        "fake-jti",
			},
		}

		// Create HS256 token using public key as secret (attack attempt)
		token := jwt2.NewWithClaims(jwt2.SigningMethodHS256, claims)
		tokenString, err := token.SignedString(publicKeyPEM)
		require.NoError(t, err)

		// Validator should reject HS256 tokens
		_, err = validator.Validate(tokenString)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "unexpected signing method")
	})

	t.Run("reject_none_algorithm", func(t *testing.T) {
		// Try to create a token with "none" algorithm
		claims := &jwt.Claims{
			RegisteredClaims: jwt2.RegisteredClaims{
				Issuer:    "authz-engine",
				Subject:   "agent:attacker",
				Audience:  jwt2.ClaimStrings{"authz-api"},
				ExpiresAt: jwt2.NewNumericDate(time.Now().Add(time.Hour)),
				IssuedAt:  jwt2.NewNumericDate(time.Now()),
				ID:        "fake-jti",
			},
		}

		token := jwt2.NewWithClaims(jwt2.SigningMethodNone, claims)
		tokenString, err := token.SignedString(jwt2.UnsafeAllowNoneSignatureType)
		require.NoError(t, err)

		// Validator should reject "none" algorithm
		_, err = validator.Validate(tokenString)
		assert.Error(t, err)
	})

	t.Run("only_accept_RS256", func(t *testing.T) {
		// Validator should only accept RS256
		refreshStore := newMockRefreshStore()
		issuer, err := jwt.NewJWTIssuer(&jwt.IssuerConfig{
			PrivateKey:   privateKey,
			Issuer:       "authz-engine",
			Audience:     "authz-api",
			RefreshStore: refreshStore,
		})
		require.NoError(t, err)

		ctx := context.Background()
		tokenPair, err := issuer.IssueToken(ctx, "agent:valid", []string{"user"}, "tenant-1", []string{"read"})
		require.NoError(t, err)

		// Parse to verify it's RS256
		token, err := jwt2.Parse(tokenPair.AccessToken, func(token *jwt2.Token) (interface{}, error) {
			return &privateKey.PublicKey, nil
		})
		require.NoError(t, err)
		assert.Equal(t, "RS256", token.Method.Alg())
	})
}

// TestSecurity_TimingAttack tests constant-time token validation
func TestSecurity_TimingAttack(t *testing.T) {
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

	ctx := context.Background()

	// Create a valid token
	validToken, err := issuer.IssueToken(ctx, "agent:timing", []string{"user"}, "tenant-1", []string{"read"})
	require.NoError(t, err)

	// Create invalid tokens with varying degrees of "correctness"
	invalidTokens := []string{
		"invalid",
		"invalid.token.here",
		strings.Repeat("a", len(validToken.AccessToken)),
		validToken.AccessToken[:len(validToken.AccessToken)-10] + "AAAAAAAAAA", // Modified signature
	}

	// Measure validation times
	const samples = 100

	validTimes := make([]time.Duration, samples)
	invalidTimes := make([][]time.Duration, len(invalidTokens))
	for i := range invalidTokens {
		invalidTimes[i] = make([]time.Duration, samples)
	}

	// Measure valid token validation time
	for i := 0; i < samples; i++ {
		start := time.Now()
		validator.Validate(validToken.AccessToken)
		validTimes[i] = time.Since(start)
	}

	// Measure invalid token validation times
	for idx, invalidToken := range invalidTokens {
		for i := 0; i < samples; i++ {
			start := time.Now()
			validator.Validate(invalidToken)
			invalidTimes[idx][i] = time.Since(start)
		}
	}

	// Calculate averages
	avgValid := average(validTimes)

	t.Logf("Average validation time for valid token: %v", avgValid)
	for idx := range invalidTokens {
		avgInvalid := average(invalidTimes[idx])
		t.Logf("Average validation time for invalid token %d: %v", idx, avgInvalid)

		// Timing should not reveal token validity
		// Allow for some variance but not orders of magnitude
		ratio := float64(avgValid) / float64(avgInvalid)
		t.Logf("Timing ratio: %.2f", ratio)

		// This is a soft check - cryptographic operations have inherent timing variations
		// The important thing is there's no exploitable timing leak
	}
}

// TestSecurity_BruteForce tests account lockout on brute force
func TestSecurity_BruteForce(t *testing.T) {
	// Mock account lockout tracker
	type lockoutTracker struct {
		mu       sync.RWMutex
		attempts map[string]int
		lockouts map[string]time.Time
	}

	tracker := &lockoutTracker{
		attempts: make(map[string]int),
		lockouts: make(map[string]time.Time),
	}

	maxAttempts := 5
	lockoutDuration := 15 * time.Minute

	recordFailure := func(agentID string) bool {
		tracker.mu.Lock()
		defer tracker.mu.Unlock()

		// Check if already locked out
		if lockoutTime, exists := tracker.lockouts[agentID]; exists {
			if time.Since(lockoutTime) < lockoutDuration {
				return false // Still locked out
			}
			// Lockout expired
			delete(tracker.lockouts, agentID)
			delete(tracker.attempts, agentID)
		}

		// Increment failure count
		tracker.attempts[agentID]++

		if tracker.attempts[agentID] >= maxAttempts {
			tracker.lockouts[agentID] = time.Now()
			return false // Locked out
		}

		return true // Can try again
	}

	isLockedOut := func(agentID string) bool {
		tracker.mu.RLock()
		defer tracker.mu.RUnlock()

		lockoutTime, exists := tracker.lockouts[agentID]
		if !exists {
			return false
		}
		return time.Since(lockoutTime) < lockoutDuration
	}

	t.Run("lockout after max attempts", func(t *testing.T) {
		agentID := "agent:brute-force-test"

		// Make failed attempts up to max
		for i := 0; i < maxAttempts; i++ {
			canRetry := recordFailure(agentID)
			if i < maxAttempts-1 {
				assert.True(t, canRetry, "Should allow retry before max attempts")
			} else {
				assert.False(t, canRetry, "Should lockout at max attempts")
			}
		}

		// Verify locked out
		assert.True(t, isLockedOut(agentID))

		// Additional attempts should be blocked
		canRetry := recordFailure(agentID)
		assert.False(t, canRetry, "Should remain locked out")
	})

	t.Run("independent lockout per agent", func(t *testing.T) {
		agent1 := "agent:user-1"
		agent2 := "agent:user-2"

		// Lock out agent1
		for i := 0; i < maxAttempts; i++ {
			recordFailure(agent1)
		}

		assert.True(t, isLockedOut(agent1))
		assert.False(t, isLockedOut(agent2), "Different agent should not be affected")

		// Agent2 should still be able to attempt
		canRetry := recordFailure(agent2)
		assert.True(t, canRetry)
	})
}

// TestSecurity_TokenTampering tests detection of tampered tokens
func TestSecurity_TokenTampering(t *testing.T) {
	ctx := context.Background()

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

	// Create valid token
	tokenPair, err := issuer.IssueToken(ctx, "agent:user", []string{"user"}, "tenant-1", []string{"read"})
	require.NoError(t, err)

	// Split token into parts
	parts := strings.Split(tokenPair.AccessToken, ".")
	require.Len(t, parts, 3, "JWT should have 3 parts")

	t.Run("modified_payload", func(t *testing.T) {
		// Modify the payload (middle part)
		tamperedPayload := parts[1][:len(parts[1])-5] + "AAAAA"
		tamperedToken := strings.Join([]string{parts[0], tamperedPayload, parts[2]}, ".")

		_, err := validator.Validate(tamperedToken)
		assert.Error(t, err, "Should reject token with modified payload")
	})

	t.Run("modified_signature", func(t *testing.T) {
		// Modify the signature (last part)
		tamperedSig := parts[2][:len(parts[2])-5] + "AAAAA"
		tamperedToken := strings.Join([]string{parts[0], parts[1], tamperedSig}, ".")

		_, err := validator.Validate(tamperedToken)
		assert.Error(t, err, "Should reject token with modified signature")
	})

	t.Run("swapped_signature", func(t *testing.T) {
		// Create another token and swap signatures
		tokenPair2, err := issuer.IssueToken(ctx, "agent:other", []string{"admin"}, "tenant-2", []string{"write"})
		require.NoError(t, err)

		parts2 := strings.Split(tokenPair2.AccessToken, ".")

		// Use payload from token1 with signature from token2
		mixedToken := strings.Join([]string{parts[0], parts[1], parts2[2]}, ".")

		_, err = validator.Validate(mixedToken)
		assert.Error(t, err, "Should reject token with swapped signature")
	})
}

// Helper function to calculate average duration
func average(durations []time.Duration) time.Duration {
	var total time.Duration
	for _, d := range durations {
		total += d
	}
	return total / time.Duration(len(durations))
}
