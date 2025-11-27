package auth_test

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/authz-engine/go-core/internal/auth"
)

func TestGenerateAPIKey(t *testing.T) {
	key, err := auth.GenerateAPIKey()
	if err != nil {
		t.Fatalf("Failed to generate API key: %v", err)
	}

	// Check prefix
	if !strings.HasPrefix(key, auth.APIKeyPrefix) {
		t.Errorf("API key missing prefix. Got: %s", key)
	}

	// Check length (prefix + base64url encoded 32 bytes)
	if len(key) < 40 {
		t.Errorf("API key too short. Got length: %d", len(key))
	}
}

func TestHashAPIKey(t *testing.T) {
	key := "authz_testkey12345678901234567890123456"
	hash := auth.HashAPIKey(key)

	// SHA-256 hash should be 64 hex characters
	if len(hash) != 64 {
		t.Errorf("Hash length incorrect. Expected 64, got: %d", len(hash))
	}

	// Hash should be deterministic
	hash2 := auth.HashAPIKey(key)
	if hash != hash2 {
		t.Error("Hash is not deterministic")
	}
}

func TestValidateAPIKeyFormat(t *testing.T) {
	tests := []struct {
		name    string
		apiKey  string
		wantErr bool
	}{
		{
			name:    "valid key",
			apiKey:  "authz_dGVzdGtleTEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI",
			wantErr: false,
		},
		{
			name:    "missing prefix",
			apiKey:  "testkey1234567890123456789012",
			wantErr: true,
		},
		{
			name:    "too short",
			apiKey:  "authz_short",
			wantErr: true,
		},
		{
			name:    "invalid base64",
			apiKey:  "authz_!!!invalid!!!base64!!!characters!!!here",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := auth.ValidateAPIKeyFormat(tt.apiKey)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateAPIKeyFormat() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestAPIKeyIsExpired(t *testing.T) {
	now := time.Now()
	past := now.Add(-1 * time.Hour)
	future := now.Add(1 * time.Hour)

	tests := []struct {
		name      string
		expiresAt *time.Time
		want      bool
	}{
		{
			name:      "not expired - future",
			expiresAt: &future,
			want:      false,
		},
		{
			name:      "expired - past",
			expiresAt: &past,
			want:      true,
		},
		{
			name:      "no expiration",
			expiresAt: nil,
			want:      false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key := &auth.APIKey{
				ExpiresAt: tt.expiresAt,
			}
			if got := key.IsExpired(); got != tt.want {
				t.Errorf("IsExpired() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestAPIKeyIsRevoked(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name      string
		revokedAt *time.Time
		want      bool
	}{
		{
			name:      "revoked",
			revokedAt: &now,
			want:      true,
		},
		{
			name:      "not revoked",
			revokedAt: nil,
			want:      false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key := &auth.APIKey{
				RevokedAt: tt.revokedAt,
			}
			if got := key.IsRevoked(); got != tt.want {
				t.Errorf("IsRevoked() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestAPIKeyHasScope(t *testing.T) {
	tests := []struct {
		name       string
		scopes     []string
		checkScope string
		want       bool
	}{
		{
			name:       "has scope",
			scopes:     []string{"read", "write"},
			checkScope: "read",
			want:       true,
		},
		{
			name:       "missing scope",
			scopes:     []string{"read"},
			checkScope: "write",
			want:       false,
		},
		{
			name:       "wildcard scope",
			scopes:     []string{"*"},
			checkScope: "anything",
			want:       true,
		},
		{
			name:       "empty scopes means all allowed",
			scopes:     []string{},
			checkScope: "anything",
			want:       true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key := &auth.APIKey{
				Scopes: tt.scopes,
			}
			if got := key.HasScope(tt.checkScope); got != tt.want {
				t.Errorf("HasScope() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestMaskKey(t *testing.T) {
	tests := []struct {
		name   string
		apiKey string
		want   string
	}{
		{
			name:   "normal key",
			apiKey: "authz_dGVzdGtleTEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI",
			want:   "authz_dGVzdG...wMTI",
		},
		{
			name:   "short key",
			apiKey: "short",
			want:   "***",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := auth.MaskKey(tt.apiKey); got != tt.want {
				t.Errorf("MaskKey() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestExtractKeyPrefix(t *testing.T) {
	key := "authz_testkey1234567890"
	prefix := auth.ExtractKeyPrefix(key)

	if len(prefix) != auth.APIKeyPrefixDisplayLength {
		t.Errorf("Prefix length incorrect. Expected %d, got: %d", auth.APIKeyPrefixDisplayLength, len(prefix))
	}

	if prefix != "authz_te" {
		t.Errorf("Prefix incorrect. Expected 'authz_te', got: %s", prefix)
	}
}

func TestAPIKeyIsValid(t *testing.T) {
	now := time.Now()
	past := now.Add(-1 * time.Hour)
	future := now.Add(1 * time.Hour)

	tests := []struct {
		name      string
		key       *auth.APIKey
		want      bool
	}{
		{
			name: "valid key",
			key: &auth.APIKey{
				KeyID:     uuid.New(),
				ExpiresAt: &future,
				RevokedAt: nil,
			},
			want: true,
		},
		{
			name: "expired key",
			key: &auth.APIKey{
				KeyID:     uuid.New(),
				ExpiresAt: &past,
				RevokedAt: nil,
			},
			want: false,
		},
		{
			name: "revoked key",
			key: &auth.APIKey{
				KeyID:     uuid.New(),
				ExpiresAt: &future,
				RevokedAt: &now,
			},
			want: false,
		},
		{
			name: "no expiration",
			key: &auth.APIKey{
				KeyID:     uuid.New(),
				ExpiresAt: nil,
				RevokedAt: nil,
			},
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.key.IsValid(); got != tt.want {
				t.Errorf("IsValid() = %v, want %v", got, tt.want)
			}
		})
	}
}
