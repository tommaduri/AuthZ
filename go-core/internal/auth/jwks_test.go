package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Helper to encode big.Int to base64url
func encodeBase64URL(b *big.Int) string {
	data := b.Bytes()
	encoded := base64.URLEncoding.EncodeToString(data)
	// Remove padding
	return strings.TrimRight(encoded, "=")
}

// Helper to create a test JWK from RSA public key
func createTestJWK(kid string, pubKey *rsa.PublicKey) JWK {
	return JWK{
		Kid: kid,
		Kty: "RSA",
		Use: "sig",
		Alg: "RS256",
		N:   encodeBase64URL(pubKey.N),
		E:   encodeBase64URL(big.NewInt(int64(pubKey.E))),
	}
}

func TestJWK_ToRSAPublicKey(t *testing.T) {
	// Generate test RSA key
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	publicKey := &privateKey.PublicKey

	// Create JWK from public key
	jwk := createTestJWK("test-key-1", publicKey)

	// Convert back to RSA public key
	convertedKey, err := jwk.ToRSAPublicKey()
	require.NoError(t, err)
	require.NotNil(t, convertedKey)

	// Verify the keys match
	assert.Equal(t, publicKey.N, convertedKey.N)
	assert.Equal(t, publicKey.E, convertedKey.E)
}

func TestJWK_ToRSAPublicKey_InvalidKeyType(t *testing.T) {
	jwk := JWK{
		Kty: "EC",
		N:   "test",
		E:   "AQAB",
	}

	_, err := jwk.ToRSAPublicKey()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported key type")
}

func TestJWK_ToRSAPublicKey_MissingModulus(t *testing.T) {
	jwk := JWK{
		Kty: "RSA",
		E:   "AQAB",
	}

	_, err := jwk.ToRSAPublicKey()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "missing required RSA parameters")
}

func TestJWK_ToRSAPublicKey_MissingExponent(t *testing.T) {
	jwk := JWK{
		Kty: "RSA",
		N:   "test",
	}

	_, err := jwk.ToRSAPublicKey()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "missing required RSA parameters")
}

func TestJWK_ToRSAPublicKey_InvalidBase64(t *testing.T) {
	jwk := JWK{
		Kty: "RSA",
		N:   "invalid base64!!!",
		E:   "AQAB",
	}

	_, err := jwk.ToRSAPublicKey()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "decode modulus")
}

func TestDecodeBase64URL(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected []byte
		wantErr  bool
	}{
		{
			name:     "standard base64url",
			input:    "SGVsbG8",
			expected: []byte("Hello"),
			wantErr:  false,
		},
		{
			name:     "with - and _",
			input:    "PDw_Pz8-Pg",
			expected: []byte("<<???>>"),
			wantErr:  false,
		},
		{
			name:     "AQAB (common RSA exponent 65537)",
			input:    "AQAB",
			expected: []byte{0x01, 0x00, 0x01},
			wantErr:  false,
		},
		{
			name:    "invalid base64",
			input:   "!!!invalid!!!",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := decodeBase64URL(tt.input)
			if tt.wantErr {
				assert.Error(t, err)
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.expected, result)
			}
		})
	}
}

func TestJWKSProvider_Fetch(t *testing.T) {
	// Generate test keys
	key1, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	key2, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	// Create JWKS with multiple keys
	jwks := JWKS{
		Keys: []JWK{
			createTestJWK("key-2024-01", &key1.PublicKey),
			createTestJWK("key-2024-02", &key2.PublicKey),
		},
	}

	// Create test HTTP server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(jwks)
	}))
	defer server.Close()

	// Create provider
	provider, err := NewJWKSProvider(server.URL, 1*time.Hour)
	require.NoError(t, err)
	defer provider.Close()

	// Test: Get first key
	pubKey1, err := provider.GetKey("key-2024-01")
	require.NoError(t, err)
	assert.NotNil(t, pubKey1)
	assert.Equal(t, key1.PublicKey.N, pubKey1.N)
	assert.Equal(t, key1.PublicKey.E, pubKey1.E)

	// Test: Get second key
	pubKey2, err := provider.GetKey("key-2024-02")
	require.NoError(t, err)
	assert.NotNil(t, pubKey2)
	assert.Equal(t, key2.PublicKey.N, pubKey2.N)

	// Test: Non-existent key
	_, err = provider.GetKey("non-existent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestJWKSProvider_CacheHit(t *testing.T) {
	requestCount := 0
	key1, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	jwks := JWKS{
		Keys: []JWK{createTestJWK("test-key", &key1.PublicKey)},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(jwks)
	}))
	defer server.Close()

	provider, err := NewJWKSProvider(server.URL, 1*time.Hour)
	require.NoError(t, err)
	defer provider.Close()

	initialRequests := requestCount

	// Multiple requests should hit cache
	for i := 0; i < 5; i++ {
		_, err := provider.GetKey("test-key")
		require.NoError(t, err)
	}

	// Should only have made 1 initial request (cache hit for others)
	assert.Equal(t, initialRequests, requestCount)
}

func TestJWKSProvider_CacheExpiry(t *testing.T) {
	requestCount := 0
	key1, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	jwks := JWKS{
		Keys: []JWK{createTestJWK("test-key", &key1.PublicKey)},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(jwks)
	}))
	defer server.Close()

	// Very short TTL for testing
	provider, err := NewJWKSProvider(server.URL, 100*time.Millisecond)
	require.NoError(t, err)
	defer provider.Close()

	initialRequests := requestCount

	// First request
	_, err = provider.GetKey("test-key")
	require.NoError(t, err)

	// Wait for cache to expire
	time.Sleep(150 * time.Millisecond)

	// Second request should trigger refresh
	_, err = provider.GetKey("test-key")
	require.NoError(t, err)

	// Should have made 2 requests (initial + refresh)
	assert.Greater(t, requestCount, initialRequests)
}

func TestJWKSProvider_KeyRotation(t *testing.T) {
	// Simulate key rotation by changing the JWKS
	key1, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	key2, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	currentKey := key1
	mu := &sync.Mutex{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()

		jwks := JWKS{
			Keys: []JWK{createTestJWK("current-key", &currentKey.PublicKey)},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(jwks)
	}))
	defer server.Close()

	provider, err := NewJWKSProvider(server.URL, 100*time.Millisecond)
	require.NoError(t, err)
	defer provider.Close()

	// Get initial key
	pubKey1, err := provider.GetKey("current-key")
	require.NoError(t, err)
	assert.Equal(t, key1.PublicKey.N, pubKey1.N)

	// Rotate to new key
	mu.Lock()
	currentKey = key2
	mu.Unlock()

	// Wait for cache to expire and refresh
	time.Sleep(150 * time.Millisecond)

	// Get rotated key
	pubKey2, err := provider.GetKey("current-key")
	require.NoError(t, err)
	assert.Equal(t, key2.PublicKey.N, pubKey2.N)
	assert.NotEqual(t, key1.PublicKey.N, pubKey2.N)
}

func TestJWKSProvider_HTTPTimeout(t *testing.T) {
	// Server that never responds
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(5 * time.Second) // Longer than client timeout
	}))
	defer server.Close()

	// Provider with short timeout
	provider := &JWKSProvider{
		url:      server.URL,
		cacheTTL: 1 * time.Hour,
		client: &http.Client{
			Timeout: 100 * time.Millisecond,
		},
		keys:   make(map[string]*rsa.PublicKey),
		stopCh: make(chan struct{}),
	}

	err := provider.refresh()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "fetch JWKS")
}

func TestJWKSProvider_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("invalid json"))
	}))
	defer server.Close()

	provider := &JWKSProvider{
		url:      server.URL,
		cacheTTL: 1 * time.Hour,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
		keys:   make(map[string]*rsa.PublicKey),
		stopCh: make(chan struct{}),
	}

	err := provider.refresh()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "parse JWKS")
}

func TestJWKSProvider_HTTP404(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	provider := &JWKSProvider{
		url:      server.URL,
		cacheTTL: 1 * time.Hour,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
		keys:   make(map[string]*rsa.PublicKey),
		stopCh: make(chan struct{}),
	}

	err := provider.refresh()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "404")
}

func TestJWKSProvider_EmptyKeys(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		jwks := JWKS{Keys: []JWK{}}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(jwks)
	}))
	defer server.Close()

	provider := &JWKSProvider{
		url:      server.URL,
		cacheTTL: 1 * time.Hour,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
		keys:   make(map[string]*rsa.PublicKey),
		stopCh: make(chan struct{}),
	}

	err := provider.refresh()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no valid RSA signing keys")
}

func TestJWKSProvider_FilterNonRSAKeys(t *testing.T) {
	key1, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		jwks := JWKS{
			Keys: []JWK{
				createTestJWK("rsa-key", &key1.PublicKey),
				{Kid: "ec-key", Kty: "EC", Use: "sig"}, // EC key - should be filtered
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(jwks)
	}))
	defer server.Close()

	provider, err := NewJWKSProvider(server.URL, 1*time.Hour)
	require.NoError(t, err)
	defer provider.Close()

	// RSA key should be available
	_, err = provider.GetKey("rsa-key")
	assert.NoError(t, err)

	// EC key should not be available
	_, err = provider.GetKey("ec-key")
	assert.Error(t, err)
}

func TestJWKSProvider_FilterEncryptionKeys(t *testing.T) {
	key1, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		jwks := JWKS{
			Keys: []JWK{
				createTestJWK("sig-key", &key1.PublicKey),
				{
					Kid: "enc-key",
					Kty: "RSA",
					Use: "enc", // Encryption key - should be filtered
					N:   encodeBase64URL(key1.PublicKey.N),
					E:   encodeBase64URL(big.NewInt(int64(key1.PublicKey.E))),
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(jwks)
	}))
	defer server.Close()

	provider, err := NewJWKSProvider(server.URL, 1*time.Hour)
	require.NoError(t, err)
	defer provider.Close()

	// Signature key should be available
	_, err = provider.GetKey("sig-key")
	assert.NoError(t, err)

	// Encryption key should not be available
	_, err = provider.GetKey("enc-key")
	assert.Error(t, err)
}

func TestJWKSProvider_FallbackToExpiredCache(t *testing.T) {
	key1, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	requestCount := 0
	shouldFail := false
	mu := &sync.Mutex{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		mu.Lock()
		defer mu.Unlock()

		if shouldFail {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		jwks := JWKS{
			Keys: []JWK{createTestJWK("test-key", &key1.PublicKey)},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(jwks)
	}))
	defer server.Close()

	provider, err := NewJWKSProvider(server.URL, 100*time.Millisecond)
	require.NoError(t, err)
	defer provider.Close()

	// First request succeeds
	pubKey1, err := provider.GetKey("test-key")
	require.NoError(t, err)
	assert.NotNil(t, pubKey1)

	// Make server fail
	mu.Lock()
	shouldFail = true
	mu.Unlock()

	// Wait for cache to expire
	time.Sleep(150 * time.Millisecond)

	// Should still get the cached key even though server is failing
	pubKey2, err := provider.GetKey("test-key")
	require.NoError(t, err)
	assert.Equal(t, pubKey1.N, pubKey2.N)
}
