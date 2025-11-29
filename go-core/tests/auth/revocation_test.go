package auth_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/auth"
	"github.com/go-redis/redismock/v9"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestNewRedisRevocationStore tests creating a new revocation store
func TestNewRedisRevocationStore(t *testing.T) {
	client := redis.NewClient(&redis.Options{})
	store := auth.NewRedisRevocationStore(client)
	assert.NotNil(t, store)
}

// TestRevokeToken tests token revocation
func TestRevokeToken(t *testing.T) {
	tests := []struct {
		name        string
		jti         string
		expiresAt   time.Time
		setupMock   func(mock redismock.ClientMock)
		expectError bool
	}{
		{
			name:      "successful revocation with future expiration",
			jti:       "token-123",
			expiresAt: time.Now().Add(1 * time.Hour),
			setupMock: func(mock redismock.ClientMock) {
				mock.MatchExpectationsInOrder(false)
				mock.Regexp().ExpectSet(`blacklist:jwt:token-123`, `.*`, `.*`).SetVal("OK")
			},
			expectError: false,
		},
		{
			name:      "successful revocation with near-expiration",
			jti:       "token-456",
			expiresAt: time.Now().Add(30 * time.Second),
			setupMock: func(mock redismock.ClientMock) {
				mock.MatchExpectationsInOrder(false)
				mock.Regexp().ExpectSet(`blacklist:jwt:token-456`, `.*`, `.*`).SetVal("OK")
			},
			expectError: false,
		},
		{
			name:      "revocation of already expired token",
			jti:       "token-789",
			expiresAt: time.Now().Add(-1 * time.Hour),
			setupMock: func(mock redismock.ClientMock) {
				// No Redis call expected for expired tokens
			},
			expectError: false,
		},
		{
			name:      "redis error during revocation",
			jti:       "token-error",
			expiresAt: time.Now().Add(1 * time.Hour),
			setupMock: func(mock redismock.ClientMock) {
				mock.MatchExpectationsInOrder(false)
				mock.Regexp().ExpectSet(`blacklist:jwt:token-error`, `.*`, `.*`).
					SetErr(redis.TxFailedErr)
			},
			expectError: true,
		},
		{
			name:        "empty jti",
			jti:         "",
			expiresAt:   time.Now().Add(1 * time.Hour),
			setupMock:   func(mock redismock.ClientMock) {},
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, mock := redismock.NewClientMock()
			tt.setupMock(mock)

			store := auth.NewRedisRevocationStore(client)
			err := store.RevokeToken(context.Background(), tt.jti, tt.expiresAt)

			if tt.expectError {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}

			assert.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// TestIsRevoked tests checking if a token is revoked
func TestIsRevoked(t *testing.T) {
	tests := []struct {
		name        string
		jti         string
		setupMock   func(mock redismock.ClientMock)
		expectRev   bool
		expectError bool
	}{
		{
			name: "token is revoked",
			jti:  "revoked-token",
			setupMock: func(mock redismock.ClientMock) {
				mock.ExpectExists("blacklist:jwt:revoked-token").SetVal(1)
			},
			expectRev:   true,
			expectError: false,
		},
		{
			name: "token is not revoked",
			jti:  "valid-token",
			setupMock: func(mock redismock.ClientMock) {
				mock.ExpectExists("blacklist:jwt:valid-token").SetVal(0)
			},
			expectRev:   false,
			expectError: false,
		},
		{
			name: "redis error during check",
			jti:  "error-token",
			setupMock: func(mock redismock.ClientMock) {
				mock.ExpectExists("blacklist:jwt:error-token").SetErr(redis.TxFailedErr)
			},
			expectRev:   false,
			expectError: true,
		},
		{
			name:        "empty jti",
			jti:         "",
			setupMock:   func(mock redismock.ClientMock) {},
			expectRev:   false,
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, mock := redismock.NewClientMock()
			tt.setupMock(mock)

			store := auth.NewRedisRevocationStore(client)
			isRev, err := store.IsRevoked(context.Background(), tt.jti)

			if tt.expectError {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
				assert.Equal(t, tt.expectRev, isRev)
			}

			assert.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// TestRevokeTokenBatch tests batch token revocation
func TestRevokeTokenBatch(t *testing.T) {
	t.Run("successful batch revocation", func(t *testing.T) {
		client, mock := redismock.NewClientMock()
		expiresAt := time.Now().Add(1 * time.Hour)

		tokens := map[string]time.Time{
			"token-1": expiresAt,
			"token-2": expiresAt,
			"token-3": expiresAt,
		}

		// Expect pipeline operations (order doesn't matter for maps)
		mock.MatchExpectationsInOrder(false)
		for range tokens {
			mock.Regexp().ExpectSet(`blacklist:jwt:token-[123]`, `.*`, `.*`).SetVal("OK")
		}

		store := auth.NewRedisRevocationStore(client)
		err := store.RevokeTokenBatch(context.Background(), tokens)

		assert.NoError(t, err)
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("empty batch", func(t *testing.T) {
		client, _ := redismock.NewClientMock()
		store := auth.NewRedisRevocationStore(client)

		err := store.RevokeTokenBatch(context.Background(), map[string]time.Time{})
		assert.NoError(t, err)
	})

	t.Run("skip expired tokens in batch", func(t *testing.T) {
		client, mock := redismock.NewClientMock()

		validExpiry := time.Now().Add(1 * time.Hour)
		tokens := map[string]time.Time{
			"token-1": validExpiry,                    // Valid
			"token-2": time.Now().Add(-1 * time.Hour), // Expired - should be skipped
		}

		// Only expect one SET operation for the valid token
		mock.MatchExpectationsInOrder(false)
		mock.Regexp().ExpectSet(`blacklist:jwt:token-1`, `.*`, `.*`).SetVal("OK")

		store := auth.NewRedisRevocationStore(client)
		err := store.RevokeTokenBatch(context.Background(), tokens)

		assert.NoError(t, err)
		assert.NoError(t, mock.ExpectationsWereMet())
	})
}

// TestIsRevokedBatch tests batch revocation checking
func TestIsRevokedBatch(t *testing.T) {
	t.Run("successful batch check", func(t *testing.T) {
		client, mock := redismock.NewClientMock()

		jtis := []string{"token-1", "token-2", "token-3"}

		// token-1 and token-3 are revoked, token-2 is not
		mock.ExpectExists("blacklist:jwt:token-1").SetVal(1)
		mock.ExpectExists("blacklist:jwt:token-2").SetVal(0)
		mock.ExpectExists("blacklist:jwt:token-3").SetVal(1)

		store := auth.NewRedisRevocationStore(client)
		status, err := store.IsRevokedBatch(context.Background(), jtis)

		require.NoError(t, err)
		assert.True(t, status["token-1"])
		assert.False(t, status["token-2"])
		assert.True(t, status["token-3"])
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("empty batch", func(t *testing.T) {
		client, _ := redismock.NewClientMock()
		store := auth.NewRedisRevocationStore(client)

		status, err := store.IsRevokedBatch(context.Background(), []string{})
		require.NoError(t, err)
		assert.Empty(t, status)
	})
}

// TestRevocationIntegration tests the full revocation flow
func TestRevocationIntegration(t *testing.T) {
	client := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
	})

	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		t.Skip("Redis not available for integration tests")
	}
	defer client.Close()

	store := auth.NewRedisRevocationStore(client)

	t.Run("revoke and check token", func(t *testing.T) {
		jti := "integration-token-1"
		expiresAt := time.Now().Add(10 * time.Second)

		// Revoke token
		err := store.RevokeToken(ctx, jti, expiresAt)
		require.NoError(t, err)

		// Check it's revoked
		isRevoked, err := store.IsRevoked(ctx, jti)
		require.NoError(t, err)
		assert.True(t, isRevoked)

		// Cleanup
		client.Del(ctx, fmt.Sprintf("blacklist:jwt:%s", jti))
	})

	t.Run("TTL expiration", func(t *testing.T) {
		jti := "ttl-token"
		expiresAt := time.Now().Add(2 * time.Second)

		// Revoke token
		err := store.RevokeToken(ctx, jti, expiresAt)
		require.NoError(t, err)

		// Should be revoked immediately
		isRevoked, err := store.IsRevoked(ctx, jti)
		require.NoError(t, err)
		assert.True(t, isRevoked)

		// Wait for TTL expiration
		time.Sleep(3 * time.Second)

		// Should no longer be revoked
		isRevoked, err = store.IsRevoked(ctx, jti)
		require.NoError(t, err)
		assert.False(t, isRevoked)
	})
}

// BenchmarkIsRevoked benchmarks revocation checking
func BenchmarkIsRevoked(b *testing.B) {
	client, mock := redismock.NewClientMock()
	store := auth.NewRedisRevocationStore(client)

	// Setup mock to always return not revoked
	for i := 0; i < b.N; i++ {
		mock.ExpectExists("blacklist:jwt:benchmark-token").SetVal(0)
	}

	ctx := context.Background()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, err := store.IsRevoked(ctx, "benchmark-token")
		if err != nil {
			b.Fatal(err)
		}
	}
}
