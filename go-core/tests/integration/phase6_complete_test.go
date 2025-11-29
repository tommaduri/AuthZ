package integration_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

// Complete integration test combining OAuth2, API keys, and key rotation

// IntegratedAuthServer combines all authentication methods
type IntegratedAuthServer struct {
	// OAuth2
	oauth2PrivateKey *rsa.PrivateKey
	oauth2PublicKey  *rsa.PublicKey
	oauth2Clients    map[string]string

	// API Keys
	apiKeys      map[string]*APIKeyData
	apiKeysMutex sync.RWMutex

	// Key Rotation
	signingKeys    map[string]*SigningKey
	primaryKeyID   string
	keyRotationMux sync.RWMutex

	// Rate limiting
	rateLimit      map[string]int
	rateLimitMutex sync.RWMutex
}

type APIKeyData struct {
	ID        string
	KeyHash   string
	Name      string
	ExpiresAt *time.Time
	IsRevoked bool
	Scopes    []string
}

type SigningKey struct {
	ID         string
	PrivateKey *rsa.PrivateKey
	PublicKey  *rsa.PublicKey
	CreatedAt  time.Time
	ExpiresAt  *time.Time
	IsActive   bool
}

func NewIntegratedAuthServer(t *testing.T) *IntegratedAuthServer {
	// Generate OAuth2 keys
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	// Generate initial signing key
	signingPrivateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	server := &IntegratedAuthServer{
		oauth2PrivateKey: privateKey,
		oauth2PublicKey:  &privateKey.PublicKey,
		oauth2Clients: map[string]string{
			"oauth-client": "oauth-secret",
		},
		apiKeys: make(map[string]*APIKeyData),
		signingKeys: map[string]*SigningKey{
			"key-1": {
				ID:         "key-1",
				PrivateKey: signingPrivateKey,
				PublicKey:  &signingPrivateKey.PublicKey,
				CreatedAt:  time.Now(),
				IsActive:   true,
			},
		},
		primaryKeyID: "key-1",
		rateLimit:    make(map[string]int),
	}

	return server
}

func (s *IntegratedAuthServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/oauth2/token":
		s.handleOAuth2Token(w, r)
	case "/apikey/generate":
		s.handleAPIKeyGenerate(w, r)
	case "/apikey/validate":
		s.handleAPIKeyValidate(w, r)
	case "/keys/rotate":
		s.handleKeyRotate(w, r)
	case "/.well-known/jwks.json":
		s.handleJWKS(w, r)
	case "/protected":
		s.handleProtectedResource(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (s *IntegratedAuthServer) handleOAuth2Token(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	r.ParseForm()
	clientID := r.FormValue("client_id")
	clientSecret := r.FormValue("client_secret")
	grantType := r.FormValue("grant_type")

	// Rate limiting
	s.rateLimitMutex.Lock()
	count := s.rateLimit[clientID]
	if count >= 100 {
		s.rateLimitMutex.Unlock()
		http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
		return
	}
	s.rateLimit[clientID] = count + 1
	s.rateLimitMutex.Unlock()

	// Validate
	if grantType != "client_credentials" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "unsupported_grant_type"})
		return
	}

	expectedSecret, ok := s.oauth2Clients[clientID]
	if !ok || expectedSecret != clientSecret {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid_client"})
		return
	}

	// Generate token using primary signing key
	s.keyRotationMux.RLock()
	primaryKey := s.signingKeys[s.primaryKeyID]
	s.keyRotationMux.RUnlock()

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"iss":       "integrated-auth-server",
		"sub":       clientID,
		"aud":       "api",
		"exp":       time.Now().Add(1 * time.Hour).Unix(),
		"iat":       time.Now().Unix(),
		"client_id": clientID,
		"auth_type": "oauth2",
	})
	token.Header["kid"] = primaryKey.ID

	tokenString, err := token.SignedString(primaryKey.PrivateKey)
	if err != nil {
		http.Error(w, "Failed to sign token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"access_token": tokenString,
		"token_type":   "Bearer",
		"expires_in":   3600,
	})
}

func (s *IntegratedAuthServer) handleAPIKeyGenerate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Name      string   `json:"name"`
		ExpiresIn *int     `json:"expires_in"`
		Scopes    []string `json:"scopes"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Generate API key
	keyBytes := make([]byte, 32)
	rand.Read(keyBytes)
	keyString := base64.RawURLEncoding.EncodeToString(keyBytes)
	fullKey := "ak_" + keyString

	// Hash the key
	keyHash, err := bcrypt.GenerateFromPassword([]byte(fullKey), bcrypt.MinCost)
	if err != nil {
		http.Error(w, "Failed to hash key", http.StatusInternalServerError)
		return
	}

	// Generate ID
	idBytes := make([]byte, 16)
	rand.Read(idBytes)
	id := base64.RawURLEncoding.EncodeToString(idBytes)

	var expiresAt *time.Time
	if req.ExpiresIn != nil {
		exp := time.Now().Add(time.Duration(*req.ExpiresIn) * time.Second)
		expiresAt = &exp
	}

	apiKey := &APIKeyData{
		ID:        id,
		KeyHash:   string(keyHash),
		Name:      req.Name,
		ExpiresAt: expiresAt,
		IsRevoked: false,
		Scopes:    req.Scopes,
	}

	s.apiKeysMutex.Lock()
	s.apiKeys[string(keyHash)] = apiKey
	s.apiKeysMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"api_key": fullKey,
		"id":      id,
		"name":    req.Name,
	})
}

func (s *IntegratedAuthServer) handleAPIKeyValidate(w http.ResponseWriter, r *http.Request) {
	apiKey := r.Header.Get("X-API-Key")
	if apiKey == "" {
		http.Error(w, "API key required", http.StatusUnauthorized)
		return
	}

	s.apiKeysMutex.RLock()
	defer s.apiKeysMutex.RUnlock()

	// Find matching key
	var matchedKey *APIKeyData
	for hash, keyData := range s.apiKeys {
		err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(apiKey))
		if err == nil {
			matchedKey = keyData
			break
		}
	}

	if matchedKey == nil {
		http.Error(w, "Invalid API key", http.StatusUnauthorized)
		return
	}

	if matchedKey.IsRevoked {
		http.Error(w, "API key revoked", http.StatusUnauthorized)
		return
	}

	if matchedKey.ExpiresAt != nil && time.Now().After(*matchedKey.ExpiresAt) {
		http.Error(w, "API key expired", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"valid":  true,
		"name":   matchedKey.Name,
		"scopes": matchedKey.Scopes,
	})
}

func (s *IntegratedAuthServer) handleKeyRotate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		GracePeriod int `json:"grace_period"` // seconds
	}
	json.NewDecoder(r.Body).Decode(&req)

	// Generate new signing key
	newPrivateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		http.Error(w, "Failed to generate key", http.StatusInternalServerError)
		return
	}

	newKeyID := fmt.Sprintf("key-%d", time.Now().Unix())
	newKey := &SigningKey{
		ID:         newKeyID,
		PrivateKey: newPrivateKey,
		PublicKey:  &newPrivateKey.PublicKey,
		CreatedAt:  time.Now(),
		IsActive:   true,
	}

	s.keyRotationMux.Lock()

	// Set expiration on old primary key
	if req.GracePeriod > 0 {
		oldKey := s.signingKeys[s.primaryKeyID]
		expiry := time.Now().Add(time.Duration(req.GracePeriod) * time.Second)
		oldKey.ExpiresAt = &expiry
	}

	// Add new key and set as primary
	s.signingKeys[newKeyID] = newKey
	s.primaryKeyID = newKeyID

	s.keyRotationMux.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"key_id":     newKeyID,
		"rotated_at": newKey.CreatedAt,
	})
}

func (s *IntegratedAuthServer) handleJWKS(w http.ResponseWriter, r *http.Request) {
	s.keyRotationMux.RLock()
	defer s.keyRotationMux.RUnlock()

	keys := make([]map[string]interface{}, 0)

	for _, key := range s.signingKeys {
		if !key.IsActive {
			continue
		}

		if key.ExpiresAt != nil && time.Now().After(*key.ExpiresAt) {
			continue
		}

		n := base64.RawURLEncoding.EncodeToString(key.PublicKey.N.Bytes())
		e := base64.RawURLEncoding.EncodeToString([]byte{1, 0, 1})

		keys = append(keys, map[string]interface{}{
			"kid": key.ID,
			"kty": "RSA",
			"use": "sig",
			"alg": "RS256",
			"n":   n,
			"e":   e,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"keys": keys,
	})
}

func (s *IntegratedAuthServer) handleProtectedResource(w http.ResponseWriter, r *http.Request) {
	// Check for OAuth2 token
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		tokenString := strings.TrimPrefix(authHeader, "Bearer ")

		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			kid, ok := token.Header["kid"].(string)
			if !ok {
				return nil, fmt.Errorf("no kid in token")
			}

			s.keyRotationMux.RLock()
			defer s.keyRotationMux.RUnlock()

			key, exists := s.signingKeys[kid]
			if !exists || !key.IsActive {
				return nil, fmt.Errorf("invalid key")
			}

			return key.PublicKey, nil
		})

		if err == nil && token.Valid {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"message":   "Access granted via OAuth2",
				"auth_type": "oauth2",
			})
			return
		}
	}

	// Check for API key
	apiKey := r.Header.Get("X-API-Key")
	if apiKey != "" {
		s.apiKeysMutex.RLock()
		var valid bool
		for hash, keyData := range s.apiKeys {
			err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(apiKey))
			if err == nil && !keyData.IsRevoked {
				if keyData.ExpiresAt == nil || time.Now().Before(*keyData.ExpiresAt) {
					valid = true
					break
				}
			}
		}
		s.apiKeysMutex.RUnlock()

		if valid {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"message":   "Access granted via API key",
				"auth_type": "apikey",
			})
			return
		}
	}

	http.Error(w, "Unauthorized", http.StatusUnauthorized)
}

// Integration Test 1: OAuth2 complete flow
func TestIntegration_OAuth2CompleteFlow(t *testing.T) {
	server := NewIntegratedAuthServer(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	// Get OAuth2 token
	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "oauth-client")
	data.Set("client_secret", "oauth-secret")

	resp, err := http.Post(ts.URL+"/oauth2/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var tokenResp map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&tokenResp)
	require.NoError(t, err)

	accessToken := tokenResp["access_token"].(string)

	// Access protected resource with OAuth2 token
	req, _ := http.NewRequest("GET", ts.URL+"/protected", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err = http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var protectedResp map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&protectedResp)
	assert.Equal(t, "oauth2", protectedResp["auth_type"])
}

// Integration Test 2: API key complete flow
func TestIntegration_APIKeyCompleteFlow(t *testing.T) {
	server := NewIntegratedAuthServer(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	// Generate API key
	reqBody := map[string]interface{}{
		"name":   "test-key",
		"scopes": []string{"read", "write"},
	}
	jsonData, _ := json.Marshal(reqBody)

	resp, err := http.Post(ts.URL+"/apikey/generate", "application/json", strings.NewReader(string(jsonData)))
	require.NoError(t, err)
	defer resp.Body.Close()

	var keyResp map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&keyResp)
	apiKey := keyResp["api_key"].(string)

	// Access protected resource with API key
	req, _ := http.NewRequest("GET", ts.URL+"/protected", nil)
	req.Header.Set("X-API-Key", apiKey)

	resp, err = http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var protectedResp map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&protectedResp)
	assert.Equal(t, "apikey", protectedResp["auth_type"])
}

// Integration Test 3: Key rotation with active tokens
func TestIntegration_KeyRotationWithActiveTokens(t *testing.T) {
	server := NewIntegratedAuthServer(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	// Get token with original key
	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "oauth-client")
	data.Set("client_secret", "oauth-secret")

	resp, err := http.Post(ts.URL+"/oauth2/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
	require.NoError(t, err)
	defer resp.Body.Close()

	var tokenResp map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&tokenResp)
	originalToken := tokenResp["access_token"].(string)

	// Rotate keys with grace period
	rotateReq := map[string]interface{}{
		"grace_period": 3600, // 1 hour
	}
	jsonData, _ := json.Marshal(rotateReq)

	resp, err = http.Post(ts.URL+"/keys/rotate", "application/json", strings.NewReader(string(jsonData)))
	require.NoError(t, err)
	resp.Body.Close()

	// Original token should still work during grace period
	req, _ := http.NewRequest("GET", ts.URL+"/protected", nil)
	req.Header.Set("Authorization", "Bearer "+originalToken)

	resp, err = http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	// Get new token with rotated key
	resp, err = http.Post(ts.URL+"/oauth2/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
	require.NoError(t, err)
	defer resp.Body.Close()

	json.NewDecoder(resp.Body).Decode(&tokenResp)
	newToken := tokenResp["access_token"].(string)

	// New token should also work
	req, _ = http.NewRequest("GET", ts.URL+"/protected", nil)
	req.Header.Set("Authorization", "Bearer "+newToken)

	resp, err = http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)
}

// Integration Test 4: Multi-key JWKS
func TestIntegration_MultiKeyJWKS(t *testing.T) {
	server := NewIntegratedAuthServer(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	// Rotate multiple times
	for i := 0; i < 3; i++ {
		rotateReq := map[string]interface{}{
			"grace_period": 3600,
		}
		jsonData, _ := json.Marshal(rotateReq)

		resp, err := http.Post(ts.URL+"/keys/rotate", "application/json", strings.NewReader(string(jsonData)))
		require.NoError(t, err)
		resp.Body.Close()
	}

	// Get JWKS
	resp, err := http.Get(ts.URL + "/.well-known/jwks.json")
	require.NoError(t, err)
	defer resp.Body.Close()

	var jwks map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&jwks)

	keys := jwks["keys"].([]interface{})
	assert.Len(t, keys, 4) // Original + 3 rotations
}

// Integration Test 5: Concurrent auth methods
func TestIntegration_ConcurrentAuthMethods(t *testing.T) {
	server := NewIntegratedAuthServer(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	var wg sync.WaitGroup
	results := make(chan bool, 100)

	// 50 OAuth2 requests
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			data := url.Values{}
			data.Set("grant_type", "client_credentials")
			data.Set("client_id", "oauth-client")
			data.Set("client_secret", "oauth-secret")

			resp, err := http.Post(ts.URL+"/oauth2/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
			if err != nil {
				results <- false
				return
			}
			defer resp.Body.Close()

			results <- resp.StatusCode == http.StatusOK
		}()
	}

	// 50 API key requests
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			reqBody := map[string]interface{}{
				"name": "concurrent-key",
			}
			jsonData, _ := json.Marshal(reqBody)

			resp, err := http.Post(ts.URL+"/apikey/generate", "application/json", strings.NewReader(string(jsonData)))
			if err != nil {
				results <- false
				return
			}
			defer resp.Body.Close()

			results <- resp.StatusCode == http.StatusOK
		}()
	}

	wg.Wait()
	close(results)

	successCount := 0
	for success := range results {
		if success {
			successCount++
		}
	}

	assert.Equal(t, 100, successCount)
}

// Performance Test: P99 latency for full auth flow
func TestIntegration_P99LatencyFullAuthFlow(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping performance test in short mode")
	}

	server := NewIntegratedAuthServer(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	numRequests := 1000
	latencies := make([]time.Duration, numRequests)

	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "oauth-client")
	data.Set("client_secret", "oauth-secret")

	for i := 0; i < numRequests; i++ {
		start := time.Now()

		// Get token
		resp, err := http.Post(ts.URL+"/oauth2/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
		require.NoError(t, err)

		var tokenResp map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&tokenResp)
		resp.Body.Close()

		// Access protected resource
		token := tokenResp["access_token"].(string)
		req, _ := http.NewRequest("GET", ts.URL+"/protected", nil)
		req.Header.Set("Authorization", "Bearer "+token)

		resp, err = http.DefaultClient.Do(req)
		require.NoError(t, err)
		resp.Body.Close()

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

	t.Logf("P99 Latency (Full Auth Flow): %v", p99Latency)
	assert.Less(t, p99Latency, 50*time.Millisecond, "P99 latency for full flow should be under 50ms")
}

// Benchmark: Full authentication flow
func BenchmarkFullAuthenticationFlow(b *testing.B) {
	server := NewIntegratedAuthServer(&testing.T{})
	ts := httptest.NewServer(server)
	defer ts.Close()

	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "oauth-client")
	data.Set("client_secret", "oauth-secret")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		resp, _ := http.Post(ts.URL+"/oauth2/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
		resp.Body.Close()
	}
}
