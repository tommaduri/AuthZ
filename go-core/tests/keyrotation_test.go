package tests

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/auth"
	_ "github.com/lib/pq"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockEncryptor is a simple mock for testing
type mockEncryptor struct{}

func (m *mockEncryptor) Encrypt(plaintext []byte) (string, error) {
	// Simple base64 encoding for testing (NOT secure, only for tests)
	return string(plaintext), nil
}

func (m *mockEncryptor) Decrypt(ciphertext string) ([]byte, error) {
	return []byte(ciphertext), nil
}

func setupTestDB(t *testing.T) *sql.DB {
	// This would connect to a test database
	// For now, using in-memory SQLite or similar
	db, err := sql.Open("postgres", "postgres://test:test@localhost:5432/authz_test?sslmode=disable")
	require.NoError(t, err)
	return db
}

func TestKeyRotationManager_GenerateNewKey(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	encryptor := &mockEncryptor{}
	krm := auth.NewKeyRotationManager(db, encryptor)

	ctx := context.Background()

	key, err := krm.GenerateNewKey(ctx)
	require.NoError(t, err)
	assert.NotEmpty(t, key.KID)
	assert.NotEmpty(t, key.PrivateKeyEncrypted)
	assert.NotEmpty(t, key.PublicKey)
	assert.Equal(t, auth.DefaultAlgorithm, key.Algorithm)
	assert.Equal(t, auth.KeyStatusPending, key.Status)
	assert.NotNil(t, key.GetPrivateKey())
}

func TestKeyRotationManager_RotateKeys(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	encryptor := &mockEncryptor{}
	krm := auth.NewKeyRotationManager(db, encryptor)

	ctx := context.Background()

	// First rotation - no existing keys
	key1, err := krm.RotateKeys(ctx)
	require.NoError(t, err)
	assert.Equal(t, auth.KeyStatusActive, key1.Status)
	assert.NotNil(t, key1.ActivatedAt)

	// Second rotation - should set expiration on key1
	time.Sleep(100 * time.Millisecond) // Ensure different timestamps
	key2, err := krm.RotateKeys(ctx)
	require.NoError(t, err)
	assert.Equal(t, auth.KeyStatusActive, key2.Status)
	assert.NotEqual(t, key1.KID, key2.KID)

	// Verify both keys are active
	activeKeys, err := krm.GetAllActiveKeys(ctx)
	require.NoError(t, err)
	assert.Len(t, activeKeys, 2)

	// Verify key1 has expiration set
	found := false
	for _, k := range activeKeys {
		if k.KID == key1.KID {
			found = true
			assert.NotNil(t, k.ExpiresAt)
		}
	}
	assert.True(t, found)
}

func TestKeyRotationManager_GetActiveKey(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	encryptor := &mockEncryptor{}
	krm := auth.NewKeyRotationManager(db, encryptor)

	ctx := context.Background()

	// Rotate to create an active key
	rotatedKey, err := krm.RotateKeys(ctx)
	require.NoError(t, err)

	// Get active key
	activeKey, err := krm.GetActiveKey(ctx)
	require.NoError(t, err)
	assert.Equal(t, rotatedKey.KID, activeKey.KID)
	assert.NotNil(t, activeKey.GetPrivateKey())
}

func TestKeyRotationManager_ExpireOldKeys(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	encryptor := &mockEncryptor{}
	krm := auth.NewKeyRotationManager(db, encryptor)

	ctx := context.Background()

	// Create and rotate keys
	key1, err := krm.RotateKeys(ctx)
	require.NoError(t, err)

	// Manually set expiration to past
	_, err = db.ExecContext(ctx,
		"UPDATE signing_keys SET expires_at = $1 WHERE kid = $2",
		time.Now().Add(-1*time.Hour), key1.KID)
	require.NoError(t, err)

	// Expire old keys
	count, err := krm.ExpireOldKeys(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	// Verify key is expired
	var status string
	err = db.QueryRowContext(ctx,
		"SELECT status FROM signing_keys WHERE kid = $1", key1.KID).Scan(&status)
	require.NoError(t, err)
	assert.Equal(t, auth.KeyStatusExpired, status)
}

func TestKeyRotationManager_MultipleRotations(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	encryptor := &mockEncryptor{}
	krm := auth.NewKeyRotationManager(db, encryptor)

	ctx := context.Background()

	// Perform multiple rotations
	keys := make([]*auth.SigningKey, 3)
	for i := 0; i < 3; i++ {
		key, err := krm.RotateKeys(ctx)
		require.NoError(t, err)
		keys[i] = key
		time.Sleep(100 * time.Millisecond)
	}

	// All keys should be different
	assert.NotEqual(t, keys[0].KID, keys[1].KID)
	assert.NotEqual(t, keys[1].KID, keys[2].KID)
	assert.NotEqual(t, keys[0].KID, keys[2].KID)

	// All keys should still be active (within grace period)
	activeKeys, err := krm.GetAllActiveKeys(ctx)
	require.NoError(t, err)
	assert.Len(t, activeKeys, 3)

	// Latest key should be the active one
	activeKey, err := krm.GetActiveKey(ctx)
	require.NoError(t, err)
	assert.Equal(t, keys[2].KID, activeKey.KID)
}

func TestAESKeyEncryptor(t *testing.T) {
	key, err := auth.GenerateAESKey()
	require.NoError(t, err)
	assert.Len(t, key, 32)

	encryptor, err := auth.NewAESKeyEncryptor(key)
	require.NoError(t, err)

	plaintext := []byte("test private key data")

	// Test encryption
	encrypted, err := encryptor.Encrypt(plaintext)
	require.NoError(t, err)
	assert.NotEmpty(t, encrypted)

	// Test decryption
	decrypted, err := encryptor.Decrypt(encrypted)
	require.NoError(t, err)
	assert.Equal(t, plaintext, decrypted)
}

func TestAESKeyEncryptor_InvalidKey(t *testing.T) {
	_, err := auth.NewAESKeyEncryptor([]byte("too-short"))
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "32 bytes")
}
