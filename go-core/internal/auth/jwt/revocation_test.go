package jwt

import (
	"context"
	"testing"
	"time"

	"github.com/go-redis/redismock/v9"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewTokenRevoker(t *testing.T) {
	client := redis.NewClient(&redis.Options{})
	revoker := NewTokenRevoker(client)

	assert.NotNil(t, revoker)
	assert.Equal(t, client, revoker.client)
}

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
				mock.ExpectSet("revoked:jwt:token-123", mock.AnyArg(), 1*time.Hour).SetVal("OK")
			},
			expectError: false,
		},
		{
			name:      "successful revocation with near-expiration",
			jti:       "token-456",
			expiresAt: time.Now().Add(30 * time.Second),
			setupMock: func(mock redismock.ClientMock) {
				mock.ExpectSet("revoked:jwt:token-456", mock.AnyArg(), 30*time.Second).SetVal("OK")
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
				mock.ExpectSet("revoked:jwt:token-error", mock.AnyArg(), 1*time.Hour).
					SetErr(redis.TxFailedErr)
			},
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, mock := redismock.NewClientMock()
			tt.setupMock(mock)

			revoker := NewTokenRevoker(client)
			err := revoker.RevokeToken(context.Background(), tt.jti, tt.expiresAt)

			if tt.expectError {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}

			assert.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

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
				mock.ExpectExists("revoked:jwt:revoked-token").SetVal(1)
			},
			expectRev:   true,
			expectError: false,
		},
		{
			name: "token is not revoked",
			jti:  "valid-token",
			setupMock: func(mock redismock.ClientMock) {
				mock.ExpectExists("revoked:jwt:valid-token").SetVal(0)
			},
			expectRev:   false,
			expectError: false,
		},
		{
			name: "redis error during check",
			jti:  "error-token",
			setupMock: func(mock redismock.ClientMock) {
				mock.ExpectExists("revoked:jwt:error-token").SetErr(redis.TxFailedErr)
			},
			expectRev:   false,
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, mock := redismock.NewClientMock()
			tt.setupMock(mock)

			revoker := NewTokenRevoker(client)
			isRev, err := revoker.IsRevoked(context.Background(), tt.jti)

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

func TestRevokeTokenConcurrency(t *testing.T) {
	client := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
	})

	// Skip if Redis is not available
	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		t.Skip("Redis not available")
	}
	defer client.Close()

	revoker := NewTokenRevoker(client)
	expiresAt := time.Now().Add(10 * time.Second)

	// Concurrently revoke the same token multiple times
	done := make(chan bool)
	for i := 0; i < 10; i++ {
		go func(id int) {
			err := revoker.RevokeToken(ctx, "concurrent-token", expiresAt)
			assert.NoError(t, err)
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// Verify token is revoked
	isRev, err := revoker.IsRevoked(ctx, "concurrent-token")
	assert.NoError(t, err)
	assert.True(t, isRev)

	// Cleanup
	client.Del(ctx, "revoked:jwt:concurrent-token")
}

func TestRevocationTTL(t *testing.T) {
	client := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
	})

	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		t.Skip("Redis not available")
	}
	defer client.Close()

	revoker := NewTokenRevoker(client)

	// Set a short TTL
	expiresAt := time.Now().Add(2 * time.Second)
	err := revoker.RevokeToken(ctx, "ttl-token", expiresAt)
	require.NoError(t, err)

	// Verify token is revoked
	isRev, err := revoker.IsRevoked(ctx, "ttl-token")
	require.NoError(t, err)
	assert.True(t, isRev)

	// Wait for TTL to expire
	time.Sleep(3 * time.Second)

	// Verify token is no longer in blacklist
	isRev, err = revoker.IsRevoked(ctx, "ttl-token")
	require.NoError(t, err)
	assert.False(t, isRev)
}

func BenchmarkIsRevoked(b *testing.B) {
	client, mock := redismock.NewClientMock()
	revoker := NewTokenRevoker(client)

	// Setup mock to always return not revoked
	for i := 0; i < b.N; i++ {
		mock.ExpectExists("revoked:jwt:benchmark-token").SetVal(0)
	}

	ctx := context.Background()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, err := revoker.IsRevoked(ctx, "benchmark-token")
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkIsRevokedWithRedis(b *testing.B) {
	client := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
	})

	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		b.Skip("Redis not available")
	}
	defer client.Close()

	revoker := NewTokenRevoker(client)

	// Pre-populate some revoked tokens
	for i := 0; i < 100; i++ {
		client.Set(ctx, "revoked:jwt:bench-"+string(rune(i)), time.Now().Unix(), 1*time.Hour)
	}

	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, err := revoker.IsRevoked(ctx, "bench-50")
		if err != nil {
			b.Fatal(err)
		}
	}

	b.StopTimer()
	// Cleanup
	for i := 0; i < 100; i++ {
		client.Del(ctx, "revoked:jwt:bench-"+string(rune(i)))
	}
}
