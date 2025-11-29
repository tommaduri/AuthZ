package auth

import (
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

// JWKS represents a JSON Web Key Set
type JWKS struct {
	Keys []JWK `json:"keys"`
}

// JWK represents a JSON Web Key
type JWK struct {
	Kid string   `json:"kid"` // Key ID
	Kty string   `json:"kty"` // Key Type (RSA, EC, etc.)
	Use string   `json:"use"` // Usage (sig, enc)
	Alg string   `json:"alg"` // Algorithm (RS256, etc.)
	N   string   `json:"n"`   // RSA modulus
	E   string   `json:"e"`   // RSA exponent
	X5c []string `json:"x5c"` // X.509 Certificate Chain
}

// JWKSProvider fetches and caches JWKS keys for JWT validation
type JWKSProvider struct {
	url      string
	cacheTTL time.Duration
	client   *http.Client

	mu         sync.RWMutex
	keys       map[string]*rsa.PublicKey // kid -> public key
	lastUpdate time.Time
	stopCh     chan struct{}
}

// NewJWKSProvider creates a new JWKS provider with automatic refresh
func NewJWKSProvider(url string, cacheTTL time.Duration) (*JWKSProvider, error) {
	if url == "" {
		return nil, fmt.Errorf("JWKS URL is required")
	}

	if cacheTTL == 0 {
		cacheTTL = 1 * time.Hour
	}

	provider := &JWKSProvider{
		url:      url,
		cacheTTL: cacheTTL,
		client: &http.Client{
			Timeout: 30 * time.Second, // 30-second timeout for external OAuth2 providers
		},
		keys:   make(map[string]*rsa.PublicKey),
		stopCh: make(chan struct{}),
	}

	// Initial fetch
	if err := provider.refresh(); err != nil {
		return nil, fmt.Errorf("initial JWKS fetch failed: %w", err)
	}

	// Start background refresh
	go provider.refreshLoop()

	return provider, nil
}

// GetKey retrieves a public key by key ID (kid)
func (p *JWKSProvider) GetKey(kid string) (*rsa.PublicKey, error) {
	p.mu.RLock()
	key, ok := p.keys[kid]
	needsRefresh := time.Since(p.lastUpdate) > p.cacheTTL
	p.mu.RUnlock()

	if ok && !needsRefresh {
		return key, nil
	}

	// Key not found or cache expired, try refreshing
	if err := p.refresh(); err != nil {
		// If refresh fails but we have a cached key, use it
		if ok {
			return key, nil
		}
		return nil, fmt.Errorf("key not found and refresh failed: %w", err)
	}

	// Try again after refresh
	p.mu.RLock()
	key, ok = p.keys[kid]
	p.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("key %s not found in JWKS", kid)
	}

	return key, nil
}

// refresh fetches the latest JWKS from the URL
func (p *JWKSProvider) refresh() error {
	// Fetch JWKS
	resp, err := p.client.Get(p.url)
	if err != nil {
		return fmt.Errorf("fetch JWKS: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("JWKS server returned %d", resp.StatusCode)
	}

	// Read and parse response
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read JWKS response: %w", err)
	}

	var jwks JWKS
	if err := json.Unmarshal(body, &jwks); err != nil {
		return fmt.Errorf("parse JWKS: %w", err)
	}

	// Convert JWKs to RSA public keys
	newKeys := make(map[string]*rsa.PublicKey)
	for _, jwk := range jwks.Keys {
		// Only support RSA keys for now
		if jwk.Kty != "RSA" {
			continue
		}

		// Only support signing keys
		if jwk.Use != "" && jwk.Use != "sig" {
			continue
		}

		// Parse RSA public key from JWK
		key, err := jwk.ToRSAPublicKey()
		if err != nil {
			// Log error but continue with other keys
			continue
		}

		newKeys[jwk.Kid] = key
	}

	if len(newKeys) == 0 {
		return fmt.Errorf("no valid RSA signing keys found in JWKS")
	}

	// Update cache
	p.mu.Lock()
	p.keys = newKeys
	p.lastUpdate = time.Now()
	p.mu.Unlock()

	return nil
}

// refreshLoop periodically refreshes the JWKS cache
func (p *JWKSProvider) refreshLoop() {
	ticker := time.NewTicker(p.cacheTTL / 2) // Refresh at half TTL
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			// Ignore errors in background refresh
			// The GetKey method will handle expired cache
			_ = p.refresh()
		case <-p.stopCh:
			return
		}
	}
}

// Close stops the background refresh and releases resources
func (p *JWKSProvider) Close() error {
	close(p.stopCh)
	return nil
}

// ToRSAPublicKey converts a JWK to an RSA public key
// Implements RFC 7517 (JSON Web Key) Section 6.3.1 for RSA keys
func (jwk *JWK) ToRSAPublicKey() (*rsa.PublicKey, error) {
	if jwk.Kty != "RSA" {
		return nil, fmt.Errorf("unsupported key type: %s (expected RSA)", jwk.Kty)
	}

	if jwk.N == "" || jwk.E == "" {
		return nil, fmt.Errorf("JWK missing required RSA parameters (n or e)")
	}

	// Decode base64url-encoded modulus (n)
	nBytes, err := decodeBase64URL(jwk.N)
	if err != nil {
		return nil, fmt.Errorf("decode modulus (n): %w", err)
	}

	// Decode base64url-encoded exponent (e)
	eBytes, err := decodeBase64URL(jwk.E)
	if err != nil {
		return nil, fmt.Errorf("decode exponent (e): %w", err)
	}

	// Convert bytes to big.Int
	n := new(big.Int).SetBytes(nBytes)
	e := new(big.Int).SetBytes(eBytes)

	// RSA exponent must fit in an int
	if !e.IsInt64() {
		return nil, fmt.Errorf("exponent too large")
	}

	return &rsa.PublicKey{
		N: n,
		E: int(e.Int64()),
	}, nil
}

// decodeBase64URL decodes a base64url-encoded string (RFC 4648)
func decodeBase64URL(s string) ([]byte, error) {
	// base64url uses - and _ instead of + and /
	// and omits padding (=)
	s = strings.ReplaceAll(s, "-", "+")
	s = strings.ReplaceAll(s, "_", "/")

	// Add padding if needed
	switch len(s) % 4 {
	case 2:
		s += "=="
	case 3:
		s += "="
	}

	return base64.StdEncoding.DecodeString(s)
}
