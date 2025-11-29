package auth_test

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
)

// Mock OAuth2 server for testing
type mockOAuth2Server struct {
	privateKey     *rsa.PrivateKey
	publicKey      *rsa.PublicKey
	clients        map[string]string // clientID -> clientSecret
	tokens         map[string]tokenData
	rateLimit      map[string]int
	rateLimitMutex sync.RWMutex
	tokensMutex    sync.RWMutex
}

type tokenData struct {
	token     string
	expiresAt time.Time
	scope     string
	clientID  string
}

func newMockOAuth2Server(t *testing.T) *mockOAuth2Server {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	return &mockOAuth2Server{
		privateKey: privateKey,
		publicKey:  &privateKey.PublicKey,
		clients: map[string]string{
			"valid-client":      "valid-secret",
			"test-client":       "test-secret",
			"rate-limit-client": "secret",
		},
		tokens:      make(map[string]tokenData),
		rateLimit:   make(map[string]int),
	}
}

func (s *mockOAuth2Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/token" {
		s.handleToken(w, r)
	} else if r.URL.Path == "/.well-known/jwks.json" {
		s.handleJWKS(w, r)
	} else {
		http.NotFound(w, r)
	}
}

func (s *mockOAuth2Server) handleToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse form data
	if err := r.ParseForm(); err != nil {
		http.Error(w, "Invalid form data", http.StatusBadRequest)
		return
	}

	grantType := r.FormValue("grant_type")
	clientID := r.FormValue("client_id")
	clientSecret := r.FormValue("client_secret")
	scope := r.FormValue("scope")

	// Check rate limiting
	s.rateLimitMutex.Lock()
	count := s.rateLimit[clientID]
	if count >= 100 {
		s.rateLimitMutex.Unlock()
		w.Header().Set("Retry-After", "60")
		http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
		return
	}
	s.rateLimit[clientID] = count + 1
	s.rateLimitMutex.Unlock()

	// Validate grant type
	if grantType != "client_credentials" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{
			"error":             "unsupported_grant_type",
			"error_description": "Only client_credentials grant type is supported",
		})
		return
	}

	// Validate client credentials
	expectedSecret, ok := s.clients[clientID]
	if !ok || expectedSecret != clientSecret {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{
			"error":             "invalid_client",
			"error_description": "Invalid client credentials",
		})
		return
	}

	// Generate token
	expiresAt := time.Now().Add(1 * time.Hour)
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"iss":       "mock-oauth2-server",
		"sub":       clientID,
		"aud":       "api",
		"exp":       expiresAt.Unix(),
		"iat":       time.Now().Unix(),
		"client_id": clientID,
		"scope":     scope,
	})

	tokenString, err := token.SignedString(s.privateKey)
	if err != nil {
		http.Error(w, "Failed to sign token", http.StatusInternalServerError)
		return
	}

	// Store token
	s.tokensMutex.Lock()
	s.tokens[tokenString] = tokenData{
		token:     tokenString,
		expiresAt: expiresAt,
		scope:     scope,
		clientID:  clientID,
	}
	s.tokensMutex.Unlock()

	// Return token response
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"access_token": tokenString,
		"token_type":   "Bearer",
		"expires_in":   3600,
		"scope":        scope,
	})
}

func (s *mockOAuth2Server) handleJWKS(w http.ResponseWriter, r *http.Request) {
	// Export public key as JWK
	n := base64.RawURLEncoding.EncodeToString(s.publicKey.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString([]byte{1, 0, 1})

	jwks := map[string]interface{}{
		"keys": []map[string]interface{}{
			{
				"kty": "RSA",
				"use": "sig",
				"kid": "oauth2-key-1",
				"alg": "RS256",
				"n":   n,
				"e":   e,
			},
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(jwks)
}

// Test 1: Valid OAuth2 client credentials flow
func TestOAuth2_ValidClientCredentials(t *testing.T) {
	server := newMockOAuth2Server(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "valid-client")
	data.Set("client_secret", "valid-secret")
	data.Set("scope", "read write")

	resp, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var tokenResp map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&tokenResp)
	require.NoError(t, err)

	assert.Equal(t, "Bearer", tokenResp["token_type"])
	assert.Equal(t, float64(3600), tokenResp["expires_in"])
	assert.NotEmpty(t, tokenResp["access_token"])
}

// Test 2: Invalid client ID
func TestOAuth2_InvalidClientID(t *testing.T) {
	server := newMockOAuth2Server(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "invalid-client")
	data.Set("client_secret", "any-secret")

	resp, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)

	var errorResp map[string]string
	err = json.NewDecoder(resp.Body).Decode(&errorResp)
	require.NoError(t, err)

	assert.Equal(t, "invalid_client", errorResp["error"])
}

// Test 3: Invalid client secret
func TestOAuth2_InvalidClientSecret(t *testing.T) {
	server := newMockOAuth2Server(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "valid-client")
	data.Set("client_secret", "wrong-secret")

	resp, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
}

// Test 4: Unsupported grant type
func TestOAuth2_UnsupportedGrantType(t *testing.T) {
	server := newMockOAuth2Server(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	data := url.Values{}
	data.Set("grant_type", "authorization_code")
	data.Set("client_id", "valid-client")
	data.Set("client_secret", "valid-secret")

	resp, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)

	var errorResp map[string]string
	err = json.NewDecoder(resp.Body).Decode(&errorResp)
	require.NoError(t, err)

	assert.Equal(t, "unsupported_grant_type", errorResp["error"])
}

// Test 5: Missing grant type
func TestOAuth2_MissingGrantType(t *testing.T) {
	server := newMockOAuth2Server(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	data := url.Values{}
	data.Set("client_id", "valid-client")
	data.Set("client_secret", "valid-secret")

	resp, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
}

// Test 6: Token validation
func TestOAuth2_TokenValidation(t *testing.T) {
	server := newMockOAuth2Server(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	// Get token
	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "valid-client")
	data.Set("client_secret", "valid-secret")

	resp, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
	require.NoError(t, err)
	defer resp.Body.Close()

	var tokenResp map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&tokenResp)
	require.NoError(t, err)

	tokenString := tokenResp["access_token"].(string)

	// Parse and validate token
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return server.publicKey, nil
	})
	require.NoError(t, err)
	assert.True(t, token.Valid)

	claims := token.Claims.(jwt.MapClaims)
	assert.Equal(t, "valid-client", claims["client_id"])
}

// Test 7: Token expiration
func TestOAuth2_TokenExpiration(t *testing.T) {
	server := newMockOAuth2Server(t)

	// Create expired token
	expiresAt := time.Now().Add(-1 * time.Hour)
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"iss":       "mock-oauth2-server",
		"sub":       "test-client",
		"exp":       expiresAt.Unix(),
		"iat":       time.Now().Add(-2 * time.Hour).Unix(),
		"client_id": "test-client",
	})

	tokenString, err := token.SignedString(server.privateKey)
	require.NoError(t, err)

	// Validate token
	_, err = jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return server.publicKey, nil
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "expired")
}

// Test 8: Multiple scopes
func TestOAuth2_MultipleScopes(t *testing.T) {
	server := newMockOAuth2Server(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "valid-client")
	data.Set("client_secret", "valid-secret")
	data.Set("scope", "read write admin")

	resp, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
	require.NoError(t, err)
	defer resp.Body.Close()

	var tokenResp map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&tokenResp)
	require.NoError(t, err)

	assert.Equal(t, "read write admin", tokenResp["scope"])
}

// Test 9: Rate limiting
func TestOAuth2_RateLimiting(t *testing.T) {
	server := newMockOAuth2Server(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "rate-limit-client")
	data.Set("client_secret", "secret")

	// Make 100 requests (should succeed)
	for i := 0; i < 100; i++ {
		resp, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
		require.NoError(t, err)
		resp.Body.Close()
		assert.Equal(t, http.StatusOK, resp.StatusCode)
	}

	// 101st request should be rate limited
	resp, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusTooManyRequests, resp.StatusCode)
	assert.NotEmpty(t, resp.Header.Get("Retry-After"))
}

// Test 10: JWKS endpoint
func TestOAuth2_JWKSEndpoint(t *testing.T) {
	server := newMockOAuth2Server(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/.well-known/jwks.json")
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, "application/json", resp.Header.Get("Content-Type"))

	var jwks map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&jwks)
	require.NoError(t, err)

	keys := jwks["keys"].([]interface{})
	assert.Len(t, keys, 1)

	key := keys[0].(map[string]interface{})
	assert.Equal(t, "RSA", key["kty"])
	assert.Equal(t, "sig", key["use"])
	assert.Equal(t, "RS256", key["alg"])
}

// Test 11: Invalid HTTP method
func TestOAuth2_InvalidHTTPMethod(t *testing.T) {
	server := newMockOAuth2Server(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/token")
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusMethodNotAllowed, resp.StatusCode)
}

// Test 12: SQL injection attempt
func TestOAuth2_SQLInjectionAttempt(t *testing.T) {
	server := newMockOAuth2Server(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "' OR '1'='1")
	data.Set("client_secret", "' OR '1'='1")

	resp, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
}

// Test 13: XSS attempt in scope
func TestOAuth2_XSSAttemptInScope(t *testing.T) {
	server := newMockOAuth2Server(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "valid-client")
	data.Set("client_secret", "valid-secret")
	data.Set("scope", "<script>alert('xss')</script>")

	resp, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var tokenResp map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&tokenResp)
	require.NoError(t, err)

	// Scope should be returned as-is (validation should happen at usage)
	scope := tokenResp["scope"].(string)
	assert.Contains(t, scope, "script")
}

// Test 14: Concurrent token requests
func TestOAuth2_ConcurrentTokenRequests(t *testing.T) {
	server := newMockOAuth2Server(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	numRequests := 50
	var wg sync.WaitGroup
	results := make(chan int, numRequests)

	for i := 0; i < numRequests; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			data := url.Values{}
			data.Set("grant_type", "client_credentials")
			data.Set("client_id", "test-client")
			data.Set("client_secret", "test-secret")

			resp, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
			if err != nil {
				results <- 0
				return
			}
			defer resp.Body.Close()

			results <- resp.StatusCode
		}()
	}

	wg.Wait()
	close(results)

	successCount := 0
	for status := range results {
		if status == http.StatusOK {
			successCount++
		}
	}

	assert.Equal(t, numRequests, successCount)
}

// Test 15: Empty credentials
func TestOAuth2_EmptyCredentials(t *testing.T) {
	server := newMockOAuth2Server(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "")
	data.Set("client_secret", "")

	resp, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
}

// Test 16: Token signature verification
func TestOAuth2_TokenSignatureVerification(t *testing.T) {
	server := newMockOAuth2Server(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	// Get valid token
	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "valid-client")
	data.Set("client_secret", "valid-secret")

	resp, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
	require.NoError(t, err)
	defer resp.Body.Close()

	var tokenResp map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&tokenResp)
	require.NoError(t, err)

	tokenString := tokenResp["access_token"].(string)

	// Verify with correct key
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return server.publicKey, nil
	})
	require.NoError(t, err)
	assert.True(t, token.Valid)

	// Verify with wrong key fails
	wrongKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	_, err = jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return &wrongKey.PublicKey, nil
	})
	assert.Error(t, err)
}

// Test 17: Token claims validation
func TestOAuth2_TokenClaimsValidation(t *testing.T) {
	server := newMockOAuth2Server(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "valid-client")
	data.Set("client_secret", "valid-secret")
	data.Set("scope", "read")

	resp, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
	require.NoError(t, err)
	defer resp.Body.Close()

	var tokenResp map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&tokenResp)
	require.NoError(t, err)

	tokenString := tokenResp["access_token"].(string)

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return server.publicKey, nil
	})
	require.NoError(t, err)

	claims := token.Claims.(jwt.MapClaims)
	assert.Equal(t, "mock-oauth2-server", claims["iss"])
	assert.Equal(t, "valid-client", claims["sub"])
	assert.Equal(t, "valid-client", claims["client_id"])
	assert.Equal(t, "read", claims["scope"])
	assert.NotNil(t, claims["exp"])
	assert.NotNil(t, claims["iat"])
}

// Test 18: Malformed form data
func TestOAuth2_MalformedFormData(t *testing.T) {
	server := newMockOAuth2Server(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	resp, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader("invalid%form%data"))
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
}

// Test 19: Very long client ID
func TestOAuth2_VeryLongClientID(t *testing.T) {
	server := newMockOAuth2Server(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	longClientID := strings.Repeat("a", 10000)
	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", longClientID)
	data.Set("client_secret", "secret")

	resp, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
}

// Test 20: Token reuse
func TestOAuth2_TokenReuse(t *testing.T) {
	server := newMockOAuth2Server(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "valid-client")
	data.Set("client_secret", "valid-secret")

	// Get first token
	resp1, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
	require.NoError(t, err)
	defer resp1.Body.Close()

	var tokenResp1 map[string]interface{}
	err = json.NewDecoder(resp1.Body).Decode(&tokenResp1)
	require.NoError(t, err)

	token1 := tokenResp1["access_token"].(string)

	// Get second token
	resp2, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
	require.NoError(t, err)
	defer resp2.Body.Close()

	var tokenResp2 map[string]interface{}
	err = json.NewDecoder(resp2.Body).Decode(&tokenResp2)
	require.NoError(t, err)

	token2 := tokenResp2["access_token"].(string)

	// Tokens should be different (new token on each request)
	assert.NotEqual(t, token1, token2)

	// Both tokens should be valid
	_, err = jwt.Parse(token1, func(token *jwt.Token) (interface{}, error) {
		return server.publicKey, nil
	})
	assert.NoError(t, err)

	_, err = jwt.Parse(token2, func(token *jwt.Token) (interface{}, error) {
		return server.publicKey, nil
	})
	assert.NoError(t, err)
}

// Test 21: Case sensitivity in grant type
func TestOAuth2_GrantTypeCaseSensitivity(t *testing.T) {
	server := newMockOAuth2Server(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	testCases := []struct {
		grantType      string
		expectedStatus int
	}{
		{"client_credentials", http.StatusOK},
		{"CLIENT_CREDENTIALS", http.StatusBadRequest},
		{"Client_Credentials", http.StatusBadRequest},
	}

	for _, tc := range testCases {
		t.Run(tc.grantType, func(t *testing.T) {
			data := url.Values{}
			data.Set("grant_type", tc.grantType)
			data.Set("client_id", "valid-client")
			data.Set("client_secret", "valid-secret")

			resp, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
			require.NoError(t, err)
			defer resp.Body.Close()

			assert.Equal(t, tc.expectedStatus, resp.StatusCode)
		})
	}
}

// Benchmark: OAuth2 token issuance
func BenchmarkOAuth2TokenIssuance(b *testing.B) {
	server := newMockOAuth2Server(&testing.T{})
	ts := httptest.NewServer(server)
	defer ts.Close()

	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "valid-client")
	data.Set("client_secret", "valid-secret")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		resp, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
		if err != nil {
			b.Fatal(err)
		}
		resp.Body.Close()
	}
}

// Benchmark: Token validation
func BenchmarkOAuth2TokenValidation(b *testing.B) {
	server := newMockOAuth2Server(&testing.T{})

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"iss":       "mock-oauth2-server",
		"sub":       "test-client",
		"exp":       time.Now().Add(1 * time.Hour).Unix(),
		"iat":       time.Now().Unix(),
		"client_id": "test-client",
	})

	tokenString, _ := token.SignedString(server.privateKey)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			return server.publicKey, nil
		})
		if err != nil {
			b.Fatal(err)
		}
	}
}

// Benchmark: Concurrent token requests
func BenchmarkOAuth2ConcurrentRequests(b *testing.B) {
	server := newMockOAuth2Server(&testing.T{})
	ts := httptest.NewServer(server)
	defer ts.Close()

	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "valid-client")
	data.Set("client_secret", "valid-secret")

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			resp, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
			if err != nil {
				b.Fatal(err)
			}
			resp.Body.Close()
		}
	})
}

// Performance test: P99 latency < 10ms
func TestOAuth2_P99LatencyUnder10ms(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping performance test in short mode")
	}

	server := newMockOAuth2Server(t)
	ts := httptest.NewServer(server)
	defer ts.Close()

	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", "valid-client")
	data.Set("client_secret", "valid-secret")

	numRequests := 1000
	latencies := make([]time.Duration, numRequests)

	for i := 0; i < numRequests; i++ {
		start := time.Now()
		resp, err := http.Post(ts.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
		latency := time.Since(start)
		require.NoError(t, err)
		resp.Body.Close()

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
