package jwt

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// TokenRevoker handles JWT token revocation using Redis blacklist
type TokenRevoker struct {
	client *redis.Client
}

// NewTokenRevoker creates a new TokenRevoker instance
func NewTokenRevoker(client *redis.Client) *TokenRevoker {
	return &TokenRevoker{
		client: client,
	}
}

// RevokeToken adds a token to the blacklist with TTL matching token expiration
// Key format: revoked:jwt:{jti}
// Value: token expiration timestamp (Unix seconds)
func (r *TokenRevoker) RevokeToken(ctx context.Context, jti string, expiresAt time.Time) error {
	// Calculate TTL from expiration time
	ttl := time.Until(expiresAt)

	// If token is already expired, no need to store in Redis
	if ttl <= 0 {
		return nil
	}

	key := fmt.Sprintf("revoked:jwt:%s", jti)
	value := expiresAt.Unix()

	// Set with expiration matching token TTL
	err := r.client.Set(ctx, key, value, ttl).Err()
	if err != nil {
		return fmt.Errorf("failed to revoke token: %w", err)
	}

	return nil
}

// IsRevoked checks if a token is in the blacklist
// Returns true if revoked, false if valid
// Performance target: <5ms
func (r *TokenRevoker) IsRevoked(ctx context.Context, jti string) (bool, error) {
	key := fmt.Sprintf("revoked:jwt:%s", jti)

	// Use EXISTS for O(1) performance
	result, err := r.client.Exists(ctx, key).Result()
	if err != nil {
		return false, fmt.Errorf("failed to check revocation status: %w", err)
	}

	return result > 0, nil
}

// RevokeTokenBatch revokes multiple tokens in a single operation
// Uses Redis pipeline for efficiency
func (r *TokenRevoker) RevokeTokenBatch(ctx context.Context, tokens map[string]time.Time) error {
	if len(tokens) == 0 {
		return nil
	}

	pipe := r.client.Pipeline()

	for jti, expiresAt := range tokens {
		ttl := time.Until(expiresAt)
		if ttl <= 0 {
			continue
		}

		key := fmt.Sprintf("revoked:jwt:%s", jti)
		value := expiresAt.Unix()
		pipe.Set(ctx, key, value, ttl)
	}

	_, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to revoke token batch: %w", err)
	}

	return nil
}

// IsRevokedBatch checks multiple tokens in a single operation
// Returns map of jti -> revoked status
func (r *TokenRevoker) IsRevokedBatch(ctx context.Context, jtis []string) (map[string]bool, error) {
	if len(jtis) == 0 {
		return make(map[string]bool), nil
	}

	pipe := r.client.Pipeline()
	results := make(map[string]*redis.IntCmd)

	for _, jti := range jtis {
		key := fmt.Sprintf("revoked:jwt:%s", jti)
		results[jti] = pipe.Exists(ctx, key)
	}

	_, err := pipe.Exec(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to check revocation batch: %w", err)
	}

	status := make(map[string]bool)
	for jti, cmd := range results {
		val, err := cmd.Result()
		if err != nil {
			return nil, fmt.Errorf("failed to get result for %s: %w", jti, err)
		}
		status[jti] = val > 0
	}

	return status, nil
}

// ClearExpired manually removes expired tokens from blacklist
// Note: This is generally not needed as Redis TTL handles cleanup
// Useful for maintenance or testing
func (r *TokenRevoker) ClearExpired(ctx context.Context) (int64, error) {
	var cursor uint64
	var deleted int64
	now := time.Now().Unix()

	for {
		keys, nextCursor, err := r.client.Scan(ctx, cursor, "revoked:jwt:*", 100).Result()
		if err != nil {
			return deleted, fmt.Errorf("failed to scan keys: %w", err)
		}

		for _, key := range keys {
			val, err := r.client.Get(ctx, key).Int64()
			if err == redis.Nil {
				continue // Key already expired
			}
			if err != nil {
				continue // Skip on error
			}

			// If expiration timestamp is in the past, delete
			if val < now {
				count, err := r.client.Del(ctx, key).Result()
				if err == nil {
					deleted += count
				}
			}
		}

		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}

	return deleted, nil
}

// GetBlacklistSize returns the approximate number of revoked tokens
func (r *TokenRevoker) GetBlacklistSize(ctx context.Context) (int64, error) {
	var cursor uint64
	var count int64

	for {
		keys, nextCursor, err := r.client.Scan(ctx, cursor, "revoked:jwt:*", 100).Result()
		if err != nil {
			return 0, fmt.Errorf("failed to scan keys: %w", err)
		}

		count += int64(len(keys))
		cursor = nextCursor

		if cursor == 0 {
			break
		}
	}

	return count, nil
}
