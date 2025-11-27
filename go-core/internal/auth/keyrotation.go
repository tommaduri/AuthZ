package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"database/sql"
	"encoding/pem"
	"fmt"
	"time"

	"github.com/google/uuid"
)

const (
	// KeyStatusPending indicates a key has been generated but not activated
	KeyStatusPending = "pending"
	// KeyStatusActive indicates a key is currently in use for signing
	KeyStatusActive = "active"
	// KeyStatusExpired indicates a key has passed its grace period
	KeyStatusExpired = "expired"

	// DefaultKeySize is the RSA key size in bits
	DefaultKeySize = 2048
	// DefaultGracePeriod is the time old keys remain valid after rotation
	DefaultGracePeriod = 30 * 24 * time.Hour // 30 days
	// DefaultAlgorithm is the signing algorithm
	DefaultAlgorithm = "RS256"
)

// SigningKey represents an RSA key pair for JWT signing
type SigningKey struct {
	KID                  string
	PrivateKeyEncrypted  string
	PublicKey            string
	Algorithm            string
	CreatedAt            time.Time
	ActivatedAt          *time.Time
	ExpiresAt            *time.Time
	Status               string
	privateKey           *rsa.PrivateKey // cached decrypted key
}

// KeyRotationManager handles RSA key rotation
type KeyRotationManager struct {
	db            *sql.DB
	encryptor     KeyEncryptor
	gracePeriod   time.Duration
}

// KeyEncryptor defines the interface for key encryption/decryption
type KeyEncryptor interface {
	Encrypt(plaintext []byte) (string, error)
	Decrypt(ciphertext string) ([]byte, error)
}

// NewKeyRotationManager creates a new key rotation manager
func NewKeyRotationManager(db *sql.DB, encryptor KeyEncryptor) *KeyRotationManager {
	return &KeyRotationManager{
		db:          db,
		encryptor:   encryptor,
		gracePeriod: DefaultGracePeriod,
	}
}

// GenerateNewKey generates a new RSA key pair
func (krm *KeyRotationManager) GenerateNewKey(ctx context.Context) (*SigningKey, error) {
	// Generate RSA key pair
	privateKey, err := rsa.GenerateKey(rand.Reader, DefaultKeySize)
	if err != nil {
		return nil, fmt.Errorf("failed to generate RSA key: %w", err)
	}

	// Convert private key to PEM format
	privateKeyBytes := x509.MarshalPKCS1PrivateKey(privateKey)
	privateKeyPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: privateKeyBytes,
	})

	// Encrypt private key
	encryptedPrivateKey, err := krm.encryptor.Encrypt(privateKeyPEM)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt private key: %w", err)
	}

	// Convert public key to PEM format
	publicKeyBytes, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal public key: %w", err)
	}
	publicKeyPEM := string(pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: publicKeyBytes,
	}))

	// Generate unique key ID
	kid := uuid.New().String()

	key := &SigningKey{
		KID:                 kid,
		PrivateKeyEncrypted: encryptedPrivateKey,
		PublicKey:           publicKeyPEM,
		Algorithm:           DefaultAlgorithm,
		CreatedAt:           time.Now(),
		Status:              KeyStatusPending,
		privateKey:          privateKey,
	}

	// Store in database
	query := `
		INSERT INTO signing_keys (kid, private_key_encrypted, public_key, algorithm, created_at, status)
		VALUES ($1, $2, $3, $4, $5, $6)
	`
	_, err = krm.db.ExecContext(ctx, query, key.KID, key.PrivateKeyEncrypted, key.PublicKey,
		key.Algorithm, key.CreatedAt, key.Status)
	if err != nil {
		return nil, fmt.Errorf("failed to store signing key: %w", err)
	}

	return key, nil
}

// RotateKeys performs blue-green key rotation
func (krm *KeyRotationManager) RotateKeys(ctx context.Context) (*SigningKey, error) {
	// Start transaction
	tx, err := krm.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to start transaction: %w", err)
	}
	defer tx.Rollback()

	// Generate new key
	newKey, err := krm.GenerateNewKey(ctx)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	expiresAt := now.Add(krm.gracePeriod)

	// Activate new key
	activateQuery := `
		UPDATE signing_keys
		SET status = $1, activated_at = $2
		WHERE kid = $3
	`
	_, err = tx.ExecContext(ctx, activateQuery, KeyStatusActive, now, newKey.KID)
	if err != nil {
		return nil, fmt.Errorf("failed to activate new key: %w", err)
	}

	// Set expiration on old active keys (keep them valid for grace period)
	expireQuery := `
		UPDATE signing_keys
		SET expires_at = $1
		WHERE status = $2 AND kid != $3 AND expires_at IS NULL
	`
	_, err = tx.ExecContext(ctx, expireQuery, expiresAt, KeyStatusActive, newKey.KID)
	if err != nil {
		return nil, fmt.Errorf("failed to set expiration on old keys: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	newKey.Status = KeyStatusActive
	newKey.ActivatedAt = &now

	return newKey, nil
}

// GetActiveKey returns the currently active signing key
func (krm *KeyRotationManager) GetActiveKey(ctx context.Context) (*SigningKey, error) {
	query := `
		SELECT kid, private_key_encrypted, public_key, algorithm, created_at,
		       activated_at, expires_at, status
		FROM signing_keys
		WHERE status = $1 AND (expires_at IS NULL OR expires_at > NOW())
		ORDER BY activated_at DESC
		LIMIT 1
	`

	var key SigningKey
	err := krm.db.QueryRowContext(ctx, query, KeyStatusActive).Scan(
		&key.KID, &key.PrivateKeyEncrypted, &key.PublicKey, &key.Algorithm,
		&key.CreatedAt, &key.ActivatedAt, &key.ExpiresAt, &key.Status,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("no active signing key found")
		}
		return nil, fmt.Errorf("failed to get active key: %w", err)
	}

	// Decrypt private key
	if err := krm.decryptPrivateKey(&key); err != nil {
		return nil, err
	}

	return &key, nil
}

// GetAllActiveKeys returns all keys that are still valid (active or in grace period)
func (krm *KeyRotationManager) GetAllActiveKeys(ctx context.Context) ([]*SigningKey, error) {
	query := `
		SELECT kid, private_key_encrypted, public_key, algorithm, created_at,
		       activated_at, expires_at, status
		FROM signing_keys
		WHERE status = $1 AND (expires_at IS NULL OR expires_at > NOW())
		ORDER BY activated_at DESC
	`

	rows, err := krm.db.QueryContext(ctx, query, KeyStatusActive)
	if err != nil {
		return nil, fmt.Errorf("failed to query active keys: %w", err)
	}
	defer rows.Close()

	var keys []*SigningKey
	for rows.Next() {
		var key SigningKey
		err := rows.Scan(
			&key.KID, &key.PrivateKeyEncrypted, &key.PublicKey, &key.Algorithm,
			&key.CreatedAt, &key.ActivatedAt, &key.ExpiresAt, &key.Status,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan key: %w", err)
		}
		keys = append(keys, &key)
	}

	return keys, nil
}

// ExpireOldKeys marks keys past their grace period as expired
func (krm *KeyRotationManager) ExpireOldKeys(ctx context.Context) (int, error) {
	query := `
		UPDATE signing_keys
		SET status = $1
		WHERE status = $2 AND expires_at IS NOT NULL AND expires_at <= NOW()
	`

	result, err := krm.db.ExecContext(ctx, query, KeyStatusExpired, KeyStatusActive)
	if err != nil {
		return 0, fmt.Errorf("failed to expire old keys: %w", err)
	}

	count, _ := result.RowsAffected()
	return int(count), nil
}

// decryptPrivateKey decrypts and parses the private key
func (krm *KeyRotationManager) decryptPrivateKey(key *SigningKey) error {
	// Decrypt
	privateKeyPEM, err := krm.encryptor.Decrypt(key.PrivateKeyEncrypted)
	if err != nil {
		return fmt.Errorf("failed to decrypt private key: %w", err)
	}

	// Parse PEM
	block, _ := pem.Decode(privateKeyPEM)
	if block == nil {
		return fmt.Errorf("failed to decode PEM block")
	}

	// Parse RSA key
	privateKey, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		return fmt.Errorf("failed to parse private key: %w", err)
	}

	key.privateKey = privateKey
	return nil
}

// GetPrivateKey returns the decrypted private key
func (sk *SigningKey) GetPrivateKey() *rsa.PrivateKey {
	return sk.privateKey
}
