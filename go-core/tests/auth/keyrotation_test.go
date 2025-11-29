package auth_test

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// JWK represents a JSON Web Key
type JWK struct {
	KID string `json:"kid"`
	Kty string `json:"kty"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	N   string `json:"n"`
	E   string `json:"e"`
}

// JWKS represents a JSON Web Key Set
type JWKS struct {
	Keys []JWK `json:"keys"`
}

// KeyPair represents a signing key with metadata
type KeyPair struct {
	ID         string
	PrivateKey *rsa.PrivateKey
	PublicKey  *rsa.PublicKey
	CreatedAt  time.Time
	ExpiresAt  *time.Time
	IsActive   bool
	IsPrimary  bool
}

// KeyRotationManager manages key rotation
type KeyRotationManager struct {
	keys       map[string]*KeyPair
	primaryKey *KeyPair
	mu         sync.RWMutex
}

func NewKeyRotationManager() *KeyRotationManager {
	return &KeyRotationManager{
		keys: make(map[string]*KeyPair),
	}
}

// GenerateKey generates a new RSA key pair
func (m *KeyRotationManager) GenerateKey(id string, expiresIn *time.Duration) (*KeyPair, error) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}

	var expiresAt *time.Time
	if expiresIn != nil {
		exp := time.Now().Add(*expiresIn)
		expiresAt = &exp
	}

	keyPair := &KeyPair{
		ID:         id,
		PrivateKey: privateKey,
		PublicKey:  &privateKey.PublicKey,
		CreatedAt:  time.Now(),
		ExpiresAt:  expiresAt,
		IsActive:   true,
		IsPrimary:  false,
	}

	m.mu.Lock()
	m.keys[id] = keyPair
	if m.primaryKey == nil {
		m.primaryKey = keyPair
		keyPair.IsPrimary = true
	}
	m.mu.Unlock()

	return keyPair, nil
}

// SetPrimaryKey sets a key as primary
func (m *KeyRotationManager) SetPrimaryKey(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	newPrimary, exists := m.keys[id]
	if !exists {
		return jwt.ErrInvalidKey
	}

	if m.primaryKey != nil {
		m.primaryKey.IsPrimary = false
	}

	newPrimary.IsPrimary = true
	m.primaryKey = newPrimary

	return nil
}

// GetPrimaryKey returns the primary signing key
func (m *KeyRotationManager) GetPrimaryKey() (*KeyPair, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.primaryKey == nil {
		return nil, jwt.ErrInvalidKey
	}

	if !m.primaryKey.IsActive {
		return nil, jwt.ErrInvalidKey
	}

	if m.primaryKey.ExpiresAt != nil && time.Now().After(*m.primaryKey.ExpiresAt) {
		return nil, jwt.ErrTokenExpired
	}

	return m.primaryKey, nil
}

// GetKey returns a specific key by ID
func (m *KeyRotationManager) GetKey(id string) (*KeyPair, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	key, exists := m.keys[id]
	if !exists {
		return nil, jwt.ErrInvalidKey
	}

	return key, nil
}

// GetJWKS returns the public JWKS
func (m *KeyRotationManager) GetJWKS() *JWKS {
	m.mu.RLock()
	defer m.mu.RUnlock()

	jwks := &JWKS{
		Keys: make([]JWK, 0),
	}

	for _, keyPair := range m.keys {
		if !keyPair.IsActive {
			continue
		}

		if keyPair.ExpiresAt != nil && time.Now().After(*keyPair.ExpiresAt) {
			continue
		}

		n := base64.RawURLEncoding.EncodeToString(keyPair.PublicKey.N.Bytes())
		e := base64.RawURLEncoding.EncodeToString([]byte{1, 0, 1})

		jwk := JWK{
			KID: keyPair.ID,
			Kty: "RSA",
			Use: "sig",
			Alg: "RS256",
			N:   n,
			E:   e,
		}

		jwks.Keys = append(jwks.Keys, jwk)
	}

	return jwks
}

// RotateKey performs blue-green key rotation
func (m *KeyRotationManager) RotateKey(gracePeriod time.Duration) (*KeyPair, error) {
	// Generate new key
	newID := "key-" + time.Now().Format("20060102-150405")
	newKey, err := m.GenerateKey(newID, nil)
	if err != nil {
		return nil, err
	}

	// Set expiration on old primary key (grace period)
	m.mu.Lock()
	if m.primaryKey != nil {
		expiry := time.Now().Add(gracePeriod)
		m.primaryKey.ExpiresAt = &expiry
	}
	m.mu.Unlock()

	// Set new key as primary
	err = m.SetPrimaryKey(newID)
	if err != nil {
		return nil, err
	}

	return newKey, nil
}

// DeactivateKey deactivates a key
func (m *KeyRotationManager) DeactivateKey(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key, exists := m.keys[id]
	if !exists {
		return jwt.ErrInvalidKey
	}

	key.IsActive = false
	return nil
}

// CleanupExpiredKeys removes expired keys
func (m *KeyRotationManager) CleanupExpiredKeys() int {
	m.mu.Lock()
	defer m.mu.Unlock()

	count := 0
	for id, key := range m.keys {
		if key.ExpiresAt != nil && time.Now().After(*key.ExpiresAt) {
			delete(m.keys, id)
			count++
		}
	}

	return count
}

// SignToken signs a JWT with the primary key
func (m *KeyRotationManager) SignToken(claims jwt.MapClaims) (string, error) {
	primaryKey, err := m.GetPrimaryKey()
	if err != nil {
		return "", err
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = primaryKey.ID

	return token.SignedString(primaryKey.PrivateKey)
}

// VerifyToken verifies a JWT using any active key
func (m *KeyRotationManager) VerifyToken(tokenString string) (*jwt.Token, error) {
	return jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		kid, ok := token.Header["kid"].(string)
		if !ok {
			return nil, jwt.ErrInvalidKey
		}

		key, err := m.GetKey(kid)
		if err != nil {
			return nil, err
		}

		if !key.IsActive {
			return nil, jwt.ErrInvalidKey
		}

		if key.ExpiresAt != nil && time.Now().After(*key.ExpiresAt) {
			return nil, jwt.ErrTokenExpired
		}

		return key.PublicKey, nil
	})
}

// Test 1: Generate initial key
func TestKeyRotation_GenerateInitialKey(t *testing.T) {
	manager := NewKeyRotationManager()

	key, err := manager.GenerateKey("key-1", nil)
	require.NoError(t, err)
	assert.NotNil(t, key)
	assert.Equal(t, "key-1", key.ID)
	assert.True(t, key.IsActive)
	assert.True(t, key.IsPrimary)
}

// Test 2: Multiple keys in JWKS
func TestKeyRotation_MultipleKeysInJWKS(t *testing.T) {
	manager := NewKeyRotationManager()

	_, err := manager.GenerateKey("key-1", nil)
	require.NoError(t, err)

	_, err = manager.GenerateKey("key-2", nil)
	require.NoError(t, err)

	_, err = manager.GenerateKey("key-3", nil)
	require.NoError(t, err)

	jwks := manager.GetJWKS()
	assert.Len(t, jwks.Keys, 3)

	for _, jwk := range jwks.Keys {
		assert.Equal(t, "RSA", jwk.Kty)
		assert.Equal(t, "sig", jwk.Use)
		assert.Equal(t, "RS256", jwk.Alg)
		assert.NotEmpty(t, jwk.N)
		assert.NotEmpty(t, jwk.E)
	}
}

// Test 3: Blue-green key rotation
func TestKeyRotation_BlueGreenRotation(t *testing.T) {
	manager := NewKeyRotationManager()

	// Generate initial key
	key1, err := manager.GenerateKey("key-1", nil)
	require.NoError(t, err)
	assert.True(t, key1.IsPrimary)

	// Rotate to new key
	gracePeriod := 1 * time.Hour
	key2, err := manager.RotateKey(gracePeriod)
	require.NoError(t, err)

	// New key should be primary
	assert.True(t, key2.IsPrimary)
	assert.False(t, key1.IsPrimary)

	// Old key should have expiration set
	assert.NotNil(t, key1.ExpiresAt)
	assert.True(t, time.Now().Before(*key1.ExpiresAt))

	// Both keys should be in JWKS during grace period
	jwks := manager.GetJWKS()
	assert.Len(t, jwks.Keys, 2)
}

// Test 4: Grace period expiration
func TestKeyRotation_GracePeriodExpiration(t *testing.T) {
	manager := NewKeyRotationManager()

	key1, err := manager.GenerateKey("key-1", nil)
	require.NoError(t, err)

	// Rotate with very short grace period
	gracePeriod := 10 * time.Millisecond
	key2, err := manager.RotateKey(gracePeriod)
	require.NoError(t, err)

	// Both keys should be in JWKS initially
	jwks := manager.GetJWKS()
	assert.Len(t, jwks.Keys, 2)

	// Wait for grace period to expire
	time.Sleep(20 * time.Millisecond)

	// Only new key should be in JWKS
	jwks = manager.GetJWKS()
	assert.Len(t, jwks.Keys, 1)
	assert.Equal(t, key2.ID, jwks.Keys[0].KID)
}

// Test 5: Sign and verify with primary key
func TestKeyRotation_SignAndVerifyWithPrimaryKey(t *testing.T) {
	manager := NewKeyRotationManager()

	_, err := manager.GenerateKey("key-1", nil)
	require.NoError(t, err)

	claims := jwt.MapClaims{
		"sub": "user123",
		"exp": time.Now().Add(1 * time.Hour).Unix(),
	}

	tokenString, err := manager.SignToken(claims)
	require.NoError(t, err)
	assert.NotEmpty(t, tokenString)

	token, err := manager.VerifyToken(tokenString)
	require.NoError(t, err)
	assert.True(t, token.Valid)

	tokenClaims := token.Claims.(jwt.MapClaims)
	assert.Equal(t, "user123", tokenClaims["sub"])
}

// Test 6: Verify token after rotation
func TestKeyRotation_VerifyTokenAfterRotation(t *testing.T) {
	manager := NewKeyRotationManager()

	_, err := manager.GenerateKey("key-1", nil)
	require.NoError(t, err)

	// Sign token with first key
	claims := jwt.MapClaims{
		"sub": "user123",
		"exp": time.Now().Add(1 * time.Hour).Unix(),
	}

	tokenString, err := manager.SignToken(claims)
	require.NoError(t, err)

	// Rotate to new key with grace period
	gracePeriod := 1 * time.Hour
	_, err = manager.RotateKey(gracePeriod)
	require.NoError(t, err)

	// Old token should still verify during grace period
	token, err := manager.VerifyToken(tokenString)
	require.NoError(t, err)
	assert.True(t, token.Valid)
}

// Test 7: Verify token after grace period
func TestKeyRotation_VerifyTokenAfterGracePeriod(t *testing.T) {
	manager := NewKeyRotationManager()

	_, err := manager.GenerateKey("key-1", nil)
	require.NoError(t, err)

	// Sign token with first key
	claims := jwt.MapClaims{
		"sub": "user123",
		"exp": time.Now().Add(1 * time.Hour).Unix(),
	}

	tokenString, err := manager.SignToken(claims)
	require.NoError(t, err)

	// Rotate with very short grace period
	gracePeriod := 10 * time.Millisecond
	_, err = manager.RotateKey(gracePeriod)
	require.NoError(t, err)

	// Wait for grace period to expire
	time.Sleep(20 * time.Millisecond)

	// Old token should fail verification
	_, err = manager.VerifyToken(tokenString)
	assert.Error(t, err)
}

// Test 8: Deactivate key
func TestKeyRotation_DeactivateKey(t *testing.T) {
	manager := NewKeyRotationManager()

	key, err := manager.GenerateKey("key-1", nil)
	require.NoError(t, err)

	// Sign token
	claims := jwt.MapClaims{
		"sub": "user123",
		"exp": time.Now().Add(1 * time.Hour).Unix(),
	}

	tokenString, err := manager.SignToken(claims)
	require.NoError(t, err)

	// Deactivate key
	err = manager.DeactivateKey(key.ID)
	require.NoError(t, err)

	// Token should fail verification
	_, err = manager.VerifyToken(tokenString)
	assert.Error(t, err)

	// Key should not be in JWKS
	jwks := manager.GetJWKS()
	assert.Len(t, jwks.Keys, 0)
}

// Test 9: Cleanup expired keys
func TestKeyRotation_CleanupExpiredKeys(t *testing.T) {
	manager := NewKeyRotationManager()

	// Generate keys with different expirations
	expiry1 := -1 * time.Hour // Already expired
	_, err := manager.GenerateKey("key-1", &expiry1)
	require.NoError(t, err)

	expiry2 := -30 * time.Minute // Already expired
	_, err = manager.GenerateKey("key-2", &expiry2)
	require.NoError(t, err)

	expiry3 := 1 * time.Hour // Not expired
	_, err = manager.GenerateKey("key-3", &expiry3)
	require.NoError(t, err)

	// Cleanup expired keys
	count := manager.CleanupExpiredKeys()
	assert.Equal(t, 2, count)

	// Only one key should remain
	jwks := manager.GetJWKS()
	assert.Len(t, jwks.Keys, 1)
	assert.Equal(t, "key-3", jwks.Keys[0].KID)
}

// Test 10: Auto-expiry of rotated keys
func TestKeyRotation_AutoExpiryOfRotatedKeys(t *testing.T) {
	manager := NewKeyRotationManager()

	_, err := manager.GenerateKey("key-1", nil)
	require.NoError(t, err)

	// Rotate multiple times
	for i := 0; i < 5; i++ {
		gracePeriod := 10 * time.Millisecond
		_, err := manager.RotateKey(gracePeriod)
		require.NoError(t, err)
		time.Sleep(5 * time.Millisecond) // Small delay between rotations
	}

	// Wait for all grace periods to expire
	time.Sleep(50 * time.Millisecond)

	// Only latest key should be in JWKS
	jwks := manager.GetJWKS()
	assert.Len(t, jwks.Keys, 1)

	// Cleanup should remove expired keys
	count := manager.CleanupExpiredKeys()
	assert.Greater(t, count, 0)
}

// Test 11: KID in token header
func TestKeyRotation_KIDInTokenHeader(t *testing.T) {
	manager := NewKeyRotationManager()

	key, err := manager.GenerateKey("key-1", nil)
	require.NoError(t, err)

	claims := jwt.MapClaims{
		"sub": "user123",
		"exp": time.Now().Add(1 * time.Hour).Unix(),
	}

	tokenString, err := manager.SignToken(claims)
	require.NoError(t, err)

	// Parse token without verification to check header
	token, _, err := jwt.NewParser().ParseUnverified(tokenString, jwt.MapClaims{})
	require.NoError(t, err)

	kid, ok := token.Header["kid"].(string)
	assert.True(t, ok)
	assert.Equal(t, key.ID, kid)
}

// Test 12: JWKS JSON serialization
func TestKeyRotation_JWKSJSONSerialization(t *testing.T) {
	manager := NewKeyRotationManager()

	_, err := manager.GenerateKey("key-1", nil)
	require.NoError(t, err)

	_, err = manager.GenerateKey("key-2", nil)
	require.NoError(t, err)

	jwks := manager.GetJWKS()

	// Serialize to JSON
	jsonData, err := json.Marshal(jwks)
	require.NoError(t, err)

	// Deserialize from JSON
	var deserializedJWKS JWKS
	err = json.Unmarshal(jsonData, &deserializedJWKS)
	require.NoError(t, err)

	assert.Len(t, deserializedJWKS.Keys, 2)
}

// Test 13: Concurrent key rotation
func TestKeyRotation_ConcurrentKeyRotation(t *testing.T) {
	manager := NewKeyRotationManager()

	_, err := manager.GenerateKey("key-1", nil)
	require.NoError(t, err)

	numRotations := 10
	var wg sync.WaitGroup
	errors := make(chan error, numRotations)

	for i := 0; i < numRotations; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := manager.RotateKey(10 * time.Millisecond)
			errors <- err
		}()
	}

	wg.Wait()
	close(errors)

	// All rotations should succeed
	for err := range errors {
		assert.NoError(t, err)
	}
}

// Test 14: Concurrent token signing
func TestKeyRotation_ConcurrentTokenSigning(t *testing.T) {
	manager := NewKeyRotationManager()

	_, err := manager.GenerateKey("key-1", nil)
	require.NoError(t, err)

	numTokens := 50
	var wg sync.WaitGroup
	tokens := make(chan string, numTokens)

	for i := 0; i < numTokens; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()

			claims := jwt.MapClaims{
				"sub": fmt.Sprintf("user%d", id),
				"exp": time.Now().Add(1 * time.Hour).Unix(),
			}

			token, err := manager.SignToken(claims)
			if err == nil {
				tokens <- token
			}
		}(i)
	}

	wg.Wait()
	close(tokens)

	// All tokens should be generated
	count := 0
	for range tokens {
		count++
	}
	assert.Equal(t, numTokens, count)
}

// Test 15: Multiple rotations with overlapping grace periods
func TestKeyRotation_OverlappingGracePeriods(t *testing.T) {
	manager := NewKeyRotationManager()

	_, err := manager.GenerateKey("key-1", nil)
	require.NoError(t, err)

	// Rotate with long grace periods
	gracePeriod := 1 * time.Hour
	for i := 0; i < 3; i++ {
		_, err := manager.RotateKey(gracePeriod)
		require.NoError(t, err)
	}

	// All keys should be in JWKS (overlapping grace periods)
	jwks := manager.GetJWKS()
	assert.Len(t, jwks.Keys, 4) // Original + 3 rotations
}

// Benchmark: JWKS multi-key lookup
func BenchmarkJWKSMultiKeyLookup(b *testing.B) {
	manager := NewKeyRotationManager()

	// Generate 10 keys
	for i := 0; i < 10; i++ {
		manager.GenerateKey(fmt.Sprintf("key-%d", i), nil)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		manager.GetJWKS()
	}
}

// Benchmark: Key rotation
func BenchmarkKeyRotation(b *testing.B) {
	manager := NewKeyRotationManager()
	manager.GenerateKey("key-1", nil)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		manager.RotateKey(1 * time.Hour)
	}
}

// Benchmark: Token signing with rotation
func BenchmarkTokenSigningWithRotation(b *testing.B) {
	manager := NewKeyRotationManager()
	manager.GenerateKey("key-1", nil)

	claims := jwt.MapClaims{
		"sub": "user123",
		"exp": time.Now().Add(1 * time.Hour).Unix(),
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		manager.SignToken(claims)
	}
}

// Benchmark: Token verification with multiple keys
func BenchmarkTokenVerificationMultipleKeys(b *testing.B) {
	manager := NewKeyRotationManager()

	// Generate 10 keys
	for i := 0; i < 10; i++ {
		manager.GenerateKey(fmt.Sprintf("key-%d", i), nil)
	}

	claims := jwt.MapClaims{
		"sub": "user123",
		"exp": time.Now().Add(1 * time.Hour).Unix(),
	}

	tokenString, _ := manager.SignToken(claims)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		manager.VerifyToken(tokenString)
	}
}

// Performance test: P99 latency < 10ms for JWKS lookup
func TestKeyRotation_P99LatencyUnder10ms(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping performance test in short mode")
	}

	manager := NewKeyRotationManager()

	// Generate 20 keys
	for i := 0; i < 20; i++ {
		manager.GenerateKey(fmt.Sprintf("key-%d", i), nil)
	}

	numRequests := 1000
	latencies := make([]time.Duration, numRequests)

	for i := 0; i < numRequests; i++ {
		start := time.Now()
		manager.GetJWKS()
		latency := time.Since(start)
		latencies[i] = latency
	}

	// Sort latencies
	for i := 0; i < len(latencies); i++ {
		for j := i + 1; j < len(latencies); j++ {
			if latencies[i] > latencies[j] {
				latencies[i], latencies[j] = latencies[j], latencies[i]
			}
		}
	}

	p99Index := int(float64(numRequests) * 0.99)
	p99Latency := latencies[p99Index]

	t.Logf("P99 Latency: %v", p99Latency)
	assert.Less(t, p99Latency, 10*time.Millisecond, "P99 latency should be under 10ms")
}
