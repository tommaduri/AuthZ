package tests

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/authz-engine/go-core/internal/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestJWKSManager_GetJWKS(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	encryptor := &mockEncryptor{}
	krm := auth.NewKeyRotationManager(db, encryptor)
	jwksMgr := auth.NewJWKSManager(krm)

	ctx := context.Background()

	// Create active keys
	key1, err := krm.RotateKeys(ctx)
	require.NoError(t, err)
	key2, err := krm.RotateKeys(ctx)
	require.NoError(t, err)

	// Get JWKS
	jwks, err := jwksMgr.GetJWKS(ctx)
	require.NoError(t, err)
	assert.NotNil(t, jwks)
	assert.Len(t, jwks.Keys, 2)

	// Verify key IDs are present
	kids := make(map[string]bool)
	for _, jwk := range jwks.Keys {
		kids[jwk.KID] = true
		assert.Equal(t, "RSA", jwk.Kty)
		assert.Equal(t, "sig", jwk.Use)
		assert.Equal(t, auth.DefaultAlgorithm, jwk.Alg)
		assert.NotEmpty(t, jwk.N)
		assert.NotEmpty(t, jwk.E)
	}

	assert.True(t, kids[key1.KID])
	assert.True(t, kids[key2.KID])
}

func TestJWKSManager_GetJWKSJSON(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	encryptor := &mockEncryptor{}
	krm := auth.NewKeyRotationManager(db, encryptor)
	jwksMgr := auth.NewJWKSManager(krm)

	ctx := context.Background()

	// Create active key
	_, err := krm.RotateKeys(ctx)
	require.NoError(t, err)

	// Get JWKS JSON
	jwksJSON, err := jwksMgr.GetJWKSJSON(ctx)
	require.NoError(t, err)
	assert.NotEmpty(t, jwksJSON)

	// Verify it's valid JSON
	var jwks auth.JWKS
	err = json.Unmarshal(jwksJSON, &jwks)
	require.NoError(t, err)
	assert.Len(t, jwks.Keys, 1)
}

func TestJWKSManager_GetKeyByKID(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	encryptor := &mockEncryptor{}
	krm := auth.NewKeyRotationManager(db, encryptor)
	jwksMgr := auth.NewJWKSManager(krm)

	ctx := context.Background()

	// Create active keys
	key1, err := krm.RotateKeys(ctx)
	require.NoError(t, err)

	// Get key by KID
	retrievedKey, err := jwksMgr.GetKeyByKID(ctx, key1.KID)
	require.NoError(t, err)
	assert.Equal(t, key1.KID, retrievedKey.KID)

	// Try to get non-existent key
	_, err = jwksMgr.GetKeyByKID(ctx, "non-existent-kid")
	assert.Error(t, err)
}

func TestJWKSManager_ValidateJWKS(t *testing.T) {
	jwksMgr := auth.NewJWKSManager(nil)

	tests := []struct {
		name    string
		jwks    *auth.JWKS
		wantErr bool
		errMsg  string
	}{
		{
			name:    "nil JWKS",
			jwks:    nil,
			wantErr: true,
			errMsg:  "JWKS is nil",
		},
		{
			name:    "empty keys",
			jwks:    &auth.JWKS{Keys: []auth.JWK{}},
			wantErr: true,
			errMsg:  "no keys",
		},
		{
			name: "valid JWKS",
			jwks: &auth.JWKS{
				Keys: []auth.JWK{
					{
						KID: "key-1",
						Kty: "RSA",
						Alg: "RS256",
						Use: "sig",
						N:   "modulus",
						E:   "exponent",
					},
				},
			},
			wantErr: false,
		},
		{
			name: "missing KID",
			jwks: &auth.JWKS{
				Keys: []auth.JWK{
					{
						Kty: "RSA",
						Alg: "RS256",
						Use: "sig",
						N:   "modulus",
						E:   "exponent",
					},
				},
			},
			wantErr: true,
			errMsg:  "empty KID",
		},
		{
			name: "invalid kty",
			jwks: &auth.JWKS{
				Keys: []auth.JWK{
					{
						KID: "key-1",
						Kty: "EC",
						Alg: "RS256",
						Use: "sig",
						N:   "modulus",
						E:   "exponent",
					},
				},
			},
			wantErr: true,
			errMsg:  "invalid kty",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := jwksMgr.ValidateJWKS(tt.jwks)
			if tt.wantErr {
				assert.Error(t, err)
				assert.Contains(t, err.Error(), tt.errMsg)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestJWKSManager_MultiKeyScenario(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	encryptor := &mockEncryptor{}
	krm := auth.NewKeyRotationManager(db, encryptor)
	jwksMgr := auth.NewJWKSManager(krm)

	ctx := context.Background()

	// Simulate real-world scenario: 3 rotations
	keys := make([]*auth.SigningKey, 3)
	for i := 0; i < 3; i++ {
		key, err := krm.RotateKeys(ctx)
		require.NoError(t, err)
		keys[i] = key
	}

	// Get JWKS - should contain all 3 keys (within grace period)
	jwks, err := jwksMgr.GetJWKS(ctx)
	require.NoError(t, err)
	assert.Len(t, jwks.Keys, 3)

	// Validate JWKS structure
	err = jwksMgr.ValidateJWKS(jwks)
	assert.NoError(t, err)

	// Verify all keys have unique KIDs
	kids := make(map[string]bool)
	for _, jwk := range jwks.Keys {
		assert.False(t, kids[jwk.KID], "Duplicate KID found: "+jwk.KID)
		kids[jwk.KID] = true
	}
}
