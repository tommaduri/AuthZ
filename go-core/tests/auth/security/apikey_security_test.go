package security_test

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// APIKey represents an API key with security metadata
type APIKey struct {
	ID           string
	HashedKey    string
	TenantID     string
	CreatedAt    time.Time
	ExpiresAt    *time.Time
	RevokedAt    *time.Time
	LastUsedAt   *time.Time
	RateLimitRPM int
	Scopes       []string
}

// APIKeyStore simulates secure API key storage
type APIKeyStore struct {
	keys     map[string]*APIKey
	mu       sync.RWMutex
	rateLimits map[string]*RateLimiter
}

// RateLimiter implements token bucket rate limiting
type RateLimiter struct {
	tokens     int64
	maxTokens  int64
	refillRate int64
	lastRefill int64
	mu         sync.Mutex
}

func NewAPIKeyStore() *APIKeyStore {
	return &APIKeyStore{
		keys:       make(map[string]*APIKey),
		rateLimits: make(map[string]*RateLimiter),
	}
}

// TestHashedAPIKeyStorage validates API keys are never stored in plaintext
func TestHashedAPIKeyStorage(t *testing.T) {
	store := NewAPIKeyStore()

	// Generate API key
	rawKey := generateAPIKey(t)
	hashedKey := hashAPIKey(rawKey)

	// Store the key
	apiKey := &APIKey{
		ID:           "key-123",
		HashedKey:    hashedKey,
		TenantID:     "tenant-123",
		CreatedAt:    time.Now(),
		RateLimitRPM: 1000,
		Scopes:       []string{"read", "write"},
	}

	store.Store(apiKey)

	// Verify raw key is NOT in storage
	store.mu.RLock()
	for _, key := range store.keys {
		assert.NotEqual(t, rawKey, key.HashedKey, "Raw key must not be stored")
		assert.NotContains(t, key.HashedKey, rawKey, "Raw key must not be in hash")
	}
	store.mu.RUnlock()

	// Verify we can validate with raw key
	valid := store.ValidateKey(rawKey, "tenant-123")
	assert.True(t, valid, "Should validate with correct raw key")

	// Verify wrong key fails
	wrongKey := generateAPIKey(t)
	valid = store.ValidateKey(wrongKey, "tenant-123")
	assert.False(t, valid, "Should reject wrong key")
}

// TestConstantTimeComparison validates timing attack prevention
func TestConstantTimeComparison(t *testing.T) {
	store := NewAPIKeyStore()

	rawKey := generateAPIKey(t)
	hashedKey := hashAPIKey(rawKey)

	apiKey := &APIKey{
		ID:        "key-123",
		HashedKey: hashedKey,
		TenantID:  "tenant-123",
		CreatedAt: time.Now(),
	}
	store.Store(apiKey)

	// Test correct key timing
	var correctTimes []time.Duration
	for i := 0; i < 1000; i++ {
		start := time.Now()
		store.ValidateKey(rawKey, "tenant-123")
		correctTimes = append(correctTimes, time.Since(start))
	}

	// Test incorrect key timing (different lengths)
	var incorrectTimes []time.Duration
	for i := 0; i < 1000; i++ {
		wrongKey := generateAPIKey(t)[:len(rawKey)/2] // Different length
		start := time.Now()
		store.ValidateKey(wrongKey, "tenant-123")
		incorrectTimes = append(incorrectTimes, time.Since(start))
	}

	// Calculate average times
	correctAvg := average(correctTimes)
	incorrectAvg := average(incorrectTimes)

	// Timing difference should be minimal (< 20% variation)
	// This indicates constant-time comparison
	diff := float64(abs(correctAvg-incorrectAvg)) / float64(correctAvg)
	assert.Less(t, diff, 0.2, "Timing difference suggests timing attack vulnerability")
}

// TestRateLimitingEnforcement validates rate limit protection
func TestRateLimitingEnforcement(t *testing.T) {
	store := NewAPIKeyStore()

	rawKey := generateAPIKey(t)
	hashedKey := hashAPIKey(rawKey)

	apiKey := &APIKey{
		ID:           "key-123",
		HashedKey:    hashedKey,
		TenantID:     "tenant-123",
		CreatedAt:    time.Now(),
		RateLimitRPM: 60, // 60 requests per minute = 1 per second
	}
	store.Store(apiKey)

	// Create rate limiter
	limiter := NewRateLimiter(60, time.Minute)
	store.rateLimits[apiKey.ID] = limiter

	tests := []struct {
		name          string
		requestCount  int
		interval      time.Duration
		expectBlocked int
	}{
		{
			name:          "Within rate limit",
			requestCount:  50,
			interval:      time.Minute,
			expectBlocked: 0,
		},
		{
			name:          "Exceeds rate limit",
			requestCount:  70,
			interval:      time.Minute,
			expectBlocked: 10,
		},
		{
			name:          "Burst exceeds limit",
			requestCount:  100,
			interval:      time.Second,
			expectBlocked: 40,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			limiter := NewRateLimiter(60, time.Minute)
			blocked := 0

			start := time.Now()
			for i := 0; i < tt.requestCount; i++ {
				if !limiter.Allow() {
					blocked++
				}
				// Simulate request interval
				if tt.interval > 0 {
					time.Sleep(tt.interval / time.Duration(tt.requestCount))
				}
			}

			assert.Equal(t, tt.expectBlocked, blocked,
				"Rate limiting should block expected number of requests")
			t.Logf("Test duration: %v, Blocked: %d/%d", time.Since(start), blocked, tt.requestCount)
		})
	}
}

// TestRevokedKeyRejection validates revoked keys are rejected
func TestRevokedKeyRejection(t *testing.T) {
	store := NewAPIKeyStore()

	rawKey := generateAPIKey(t)
	hashedKey := hashAPIKey(rawKey)

	apiKey := &APIKey{
		ID:        "key-123",
		HashedKey: hashedKey,
		TenantID:  "tenant-123",
		CreatedAt: time.Now(),
	}
	store.Store(apiKey)

	// Key should be valid initially
	valid := store.ValidateKey(rawKey, "tenant-123")
	assert.True(t, valid, "Key should be valid before revocation")

	// Revoke the key
	now := time.Now()
	store.RevokeKey("key-123", now)

	// Key should now be invalid
	valid = store.ValidateKey(rawKey, "tenant-123")
	assert.False(t, valid, "Revoked key should be rejected")

	// Verify revocation timestamp
	key, _ := store.GetKey("key-123")
	assert.NotNil(t, key.RevokedAt)
	assert.Equal(t, now.Unix(), key.RevokedAt.Unix())
}

// TestExpiredKeyRejection validates expired keys are rejected
func TestExpiredKeyRejection(t *testing.T) {
	store := NewAPIKeyStore()

	tests := []struct {
		name       string
		expiresAt  *time.Time
		shouldFail bool
	}{
		{
			name:       "Key expired 1 hour ago",
			expiresAt:  timePtr(time.Now().Add(-1 * time.Hour)),
			shouldFail: true,
		},
		{
			name:       "Key expired 1 second ago",
			expiresAt:  timePtr(time.Now().Add(-1 * time.Second)),
			shouldFail: true,
		},
		{
			name:       "Key expires in 1 hour",
			expiresAt:  timePtr(time.Now().Add(1 * time.Hour)),
			shouldFail: false,
		},
		{
			name:       "Key never expires",
			expiresAt:  nil,
			shouldFail: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rawKey := generateAPIKey(t)
			hashedKey := hashAPIKey(rawKey)

			apiKey := &APIKey{
				ID:        "key-" + tt.name,
				HashedKey: hashedKey,
				TenantID:  "tenant-123",
				CreatedAt: time.Now(),
				ExpiresAt: tt.expiresAt,
			}
			store.Store(apiKey)

			valid := store.ValidateKey(rawKey, "tenant-123")
			if tt.shouldFail {
				assert.False(t, valid, "Expired key should be rejected")
			} else {
				assert.True(t, valid, "Valid key should be accepted")
			}
		})
	}
}

// TestCrossTenantAccessPrevention validates tenant isolation
func TestCrossTenantAccessPrevention(t *testing.T) {
	store := NewAPIKeyStore()

	rawKey := generateAPIKey(t)
	hashedKey := hashAPIKey(rawKey)

	apiKey := &APIKey{
		ID:        "key-123",
		HashedKey: hashedKey,
		TenantID:  "tenant-123",
		CreatedAt: time.Now(),
	}
	store.Store(apiKey)

	tests := []struct {
		name       string
		tenantID   string
		shouldFail bool
	}{
		{
			name:       "Correct tenant",
			tenantID:   "tenant-123",
			shouldFail: false,
		},
		{
			name:       "Wrong tenant",
			tenantID:   "tenant-456",
			shouldFail: true,
		},
		{
			name:       "Empty tenant",
			tenantID:   "",
			shouldFail: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			valid := store.ValidateKey(rawKey, tt.tenantID)
			if tt.shouldFail {
				assert.False(t, valid, "Cross-tenant access should be blocked")
			} else {
				assert.True(t, valid, "Same-tenant access should be allowed")
			}
		})
	}
}

// TestConcurrentKeyValidation validates thread-safety
func TestConcurrentKeyValidation(t *testing.T) {
	store := NewAPIKeyStore()

	rawKey := generateAPIKey(t)
	hashedKey := hashAPIKey(rawKey)

	apiKey := &APIKey{
		ID:        "key-123",
		HashedKey: hashedKey,
		TenantID:  "tenant-123",
		CreatedAt: time.Now(),
	}
	store.Store(apiKey)

	// Concurrent validation attempts
	concurrency := 100
	attempts := 1000

	var wg sync.WaitGroup
	successCount := int64(0)

	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < attempts; j++ {
				if store.ValidateKey(rawKey, "tenant-123") {
					atomic.AddInt64(&successCount, 1)
				}
			}
		}()
	}

	wg.Wait()

	// All validations should succeed
	expected := int64(concurrency * attempts)
	assert.Equal(t, expected, successCount,
		"All concurrent validations should succeed")
}

// TestAPIKeyRotation validates key rotation workflow
func TestAPIKeyRotation(t *testing.T) {
	store := NewAPIKeyStore()

	// Create original key
	oldKey := generateAPIKey(t)
	oldHashed := hashAPIKey(oldKey)

	apiKey := &APIKey{
		ID:        "key-123",
		HashedKey: oldHashed,
		TenantID:  "tenant-123",
		CreatedAt: time.Now(),
	}
	store.Store(apiKey)

	// Verify old key works
	assert.True(t, store.ValidateKey(oldKey, "tenant-123"))

	// Rotate to new key
	newKey := generateAPIKey(t)
	newHashed := hashAPIKey(newKey)

	apiKey.HashedKey = newHashed
	store.Store(apiKey)

	// Verify new key works
	assert.True(t, store.ValidateKey(newKey, "tenant-123"))

	// Verify old key no longer works
	assert.False(t, store.ValidateKey(oldKey, "tenant-123"))
}

// Helper functions

func generateAPIKey(t *testing.T) string {
	b := make([]byte, 32)
	_, err := rand.Read(b)
	require.NoError(t, err)
	return base64.URLEncoding.EncodeToString(b)
}

func hashAPIKey(key string) string {
	hash := sha256.Sum256([]byte(key))
	return base64.URLEncoding.EncodeToString(hash[:])
}

func (s *APIKeyStore) Store(key *APIKey) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.keys[key.ID] = key
}

func (s *APIKeyStore) GetKey(id string) (*APIKey, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	key, exists := s.keys[id]
	return key, exists
}

func (s *APIKeyStore) ValidateKey(rawKey, tenantID string) bool {
	hashedInput := hashAPIKey(rawKey)

	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, key := range s.keys {
		// Use constant-time comparison
		if subtle.ConstantTimeCompare([]byte(hashedInput), []byte(key.HashedKey)) == 1 {
			// Check tenant isolation
			if key.TenantID != tenantID {
				return false
			}

			// Check revocation
			if key.RevokedAt != nil {
				return false
			}

			// Check expiration
			if key.ExpiresAt != nil && time.Now().After(*key.ExpiresAt) {
				return false
			}

			return true
		}
	}

	return false
}

func (s *APIKeyStore) RevokeKey(id string, revokedAt time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if key, exists := s.keys[id]; exists {
		key.RevokedAt = &revokedAt
	}
}

func NewRateLimiter(maxRequests int64, window time.Duration) *RateLimiter {
	return &RateLimiter{
		tokens:     maxRequests,
		maxTokens:  maxRequests,
		refillRate: maxRequests * int64(time.Second) / int64(window),
		lastRefill: time.Now().UnixNano(),
	}
}

func (r *RateLimiter) Allow() bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UnixNano()
	elapsed := now - r.lastRefill

	// Refill tokens
	tokensToAdd := (elapsed * r.refillRate) / int64(time.Second)
	r.tokens = min(r.maxTokens, r.tokens+tokensToAdd)
	r.lastRefill = now

	// Consume token
	if r.tokens > 0 {
		r.tokens--
		return true
	}

	return false
}

func average(durations []time.Duration) time.Duration {
	if len(durations) == 0 {
		return 0
	}
	var sum time.Duration
	for _, d := range durations {
		sum += d
	}
	return sum / time.Duration(len(durations))
}

func abs(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

func min(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func timePtr(t time.Time) *time.Time {
	return &t
}
