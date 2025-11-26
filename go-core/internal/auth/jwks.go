package auth

import (
	"crypto/rsa"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
			Timeout: 10 * time.Second,
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
func (jwk *JWK) ToRSAPublicKey() (*rsa.PublicKey, error) {
	// For now, we'll use the jwt library's built-in JWK support
	// This is a simplified implementation
	// In production, use a proper JWK library like github.com/lestrrat-go/jwx

	if jwk.N == "" || jwk.E == "" {
		return nil, fmt.Errorf("JWK missing n or e parameters")
	}

	// Use jwt library's JWK parsing
	// Note: This is a placeholder - in production use proper JWK parsing
	return nil, fmt.Errorf("JWK parsing not implemented - use github.com/lestrrat-go/jwx in production")
}
