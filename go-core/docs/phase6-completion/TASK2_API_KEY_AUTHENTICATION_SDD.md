# Technical Specification: API Key Authentication (FR-3, P0)

## 1. Overview

### 1.1 Purpose
Implement secure API key authentication with SHA-256 hashing, per-key rate limiting, and middleware-based validation.

### 1.2 Scope
- API key validation middleware
- X-API-Key header extraction
- SHA-256 salted hashing for API keys
- Database schema for API keys
- Per-key rate limiting integration
- Key lifecycle management

### 1.3 Success Criteria
- ✅ Sub-10ms key validation (p99)
- ✅ SHA-256 with unique salt per key
- ✅ Per-key rate limiting (independent of OAuth2)
- ✅ Comprehensive audit logging
- ✅ 100% test coverage for security paths

---

## 2. Database Schema

### 2.1 API Keys Table

```sql
-- Migration: 004_create_api_keys.up.sql
CREATE TABLE IF NOT EXISTS api_keys (
    -- Primary Key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Key Identification
    key_prefix VARCHAR(20) NOT NULL UNIQUE, -- First 8 chars for identification (e.g., "REDACTED_API_KEY")
    key_hash VARCHAR(64) NOT NULL UNIQUE,   -- SHA-256 hash (64 hex chars)
    key_salt VARCHAR(32) NOT NULL,          -- 128-bit salt (32 hex chars)

    -- Ownership
    owner_id UUID,                          -- Reference to user/service
    owner_type VARCHAR(50) NOT NULL,        -- user, service, application

    -- Metadata
    name VARCHAR(255) NOT NULL,
    description TEXT,
    environment VARCHAR(50) NOT NULL DEFAULT 'production', -- production, staging, development

    -- Permissions
    scopes TEXT[],                          -- Array of allowed scopes
    allowed_ips INET[],                     -- IP whitelist (empty = all IPs allowed)
    allowed_origins TEXT[],                 -- CORS origins whitelist

    -- Rate Limiting
    rate_limit_per_minute INTEGER NOT NULL DEFAULT 1000,
    rate_limit_per_hour INTEGER NOT NULL DEFAULT 10000,
    rate_limit_per_day INTEGER NOT NULL DEFAULT 100000,

    -- Expiration
    expires_at TIMESTAMP WITH TIME ZONE,    -- NULL = never expires

    -- Status
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    revoked_reason TEXT,

    -- Audit Fields
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE,
    usage_count BIGINT NOT NULL DEFAULT 0,

    -- Constraints
    CONSTRAINT chk_owner_type CHECK (owner_type IN ('user', 'service', 'application')),
    CONSTRAINT chk_environment CHECK (environment IN ('production', 'staging', 'development')),
    CONSTRAINT chk_rate_limits CHECK (
        rate_limit_per_minute > 0 AND
        rate_limit_per_hour > 0 AND
        rate_limit_per_day > 0 AND
        rate_limit_per_hour >= rate_limit_per_minute AND
        rate_limit_per_day >= rate_limit_per_hour
    )
);

-- Indexes for performance
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix) WHERE is_revoked = FALSE;
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash) WHERE is_revoked = FALSE;
CREATE INDEX idx_api_keys_owner ON api_keys(owner_id, owner_type) WHERE is_revoked = FALSE;
CREATE INDEX idx_api_keys_active ON api_keys(is_active) WHERE is_revoked = FALSE;
CREATE INDEX idx_api_keys_expires ON api_keys(expires_at) WHERE expires_at IS NOT NULL;

-- Update trigger
CREATE TRIGGER update_api_keys_updated_at
    BEFORE UPDATE ON api_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

### 2.2 API Key Usage Audit Log

```sql
-- Migration: 004_create_api_key_audit.up.sql
CREATE TABLE IF NOT EXISTS api_key_usage_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Key Reference
    api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    key_prefix VARCHAR(20) NOT NULL, -- Denormalized for fast queries

    -- Request Details
    request_method VARCHAR(10) NOT NULL,
    request_path TEXT NOT NULL,
    request_query_params TEXT,
    request_ip INET NOT NULL,
    request_user_agent TEXT,
    request_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Response Details
    response_status INTEGER NOT NULL,
    response_duration_ms INTEGER NOT NULL,

    -- Authorization
    authorized_scopes TEXT[],
    required_scope VARCHAR(255),
    authorization_result VARCHAR(50) NOT NULL, -- allowed, denied, rate_limited, expired, revoked

    -- Rate Limiting
    rate_limit_hit BOOLEAN NOT NULL DEFAULT FALSE,
    rate_limit_type VARCHAR(20), -- minute, hour, day

    -- Partitioning
    audit_date DATE NOT NULL DEFAULT CURRENT_DATE,

    CONSTRAINT chk_authorization_result CHECK (
        authorization_result IN ('allowed', 'denied', 'rate_limited', 'expired', 'revoked', 'invalid_key')
    )
) PARTITION BY RANGE (audit_date);

-- Create partitions for next 12 months
CREATE TABLE api_key_usage_audit_2025_01 PARTITION OF api_key_usage_audit
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

-- Indexes
CREATE INDEX idx_api_key_audit_key_id ON api_key_usage_audit(api_key_id, audit_date);
CREATE INDEX idx_api_key_audit_prefix ON api_key_usage_audit(key_prefix, audit_date);
CREATE INDEX idx_api_key_audit_timestamp ON api_key_usage_audit(request_timestamp);
CREATE INDEX idx_api_key_audit_result ON api_key_usage_audit(authorization_result, audit_date);
CREATE INDEX idx_api_key_audit_ip ON api_key_usage_audit(request_ip, audit_date);
```

### 2.3 Rate Limit Tracking (Redis Schema)

```
# Redis Keys for Rate Limiting
rate_limit:api_key:{key_id}:minute:{minute_bucket}  -> counter (TTL: 120 seconds)
rate_limit:api_key:{key_id}:hour:{hour_bucket}      -> counter (TTL: 7200 seconds)
rate_limit:api_key:{key_id}:day:{day_bucket}        -> counter (TTL: 172800 seconds)

# Example:
rate_limit:api_key:550e8400-e29b-41d4-a716-446655440000:minute:202501271145 -> 42
rate_limit:api_key:550e8400-e29b-41d4-a716-446655440000:hour:2025012711 -> 1523
rate_limit:api_key:550e8400-e29b-41d4-a716-446655440000:day:20250127 -> 45678
```

### 2.4 Down Migration

```sql
-- Migration: 004_create_api_keys.down.sql
DROP TABLE IF EXISTS api_key_usage_audit;
DROP TABLE IF EXISTS api_keys CASCADE;
```

---

## 3. API Key Format & Generation

### 3.1 Key Format

```
API Key Format: {prefix}_{environment}_{random}
Example:        REDACTED_API_KEY

Components:
- prefix:      "sk" (secret key)
- environment: "live" (production), "test" (staging/dev)
- random:      32-character base62 string (192 bits entropy)
```

### 3.2 Key Generation Algorithm

```go
// internal/apikey/generator.go
package apikey

import (
    "crypto/rand"
    "crypto/sha256"
    "encoding/hex"
    "fmt"
    "math/big"
)

const (
    KeyPrefixSecret = "sk"
    EnvProduction   = "live"
    EnvStaging      = "test"
    RandomLength    = 32
    Base62Charset   = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
)

type KeyGenerator struct{}

// GenerateAPIKey creates a new API key with format: sk_{env}_{random}
func (g *KeyGenerator) GenerateAPIKey(environment string) (string, error) {
    random, err := g.generateRandomString(RandomLength)
    if err != nil {
        return "", err
    }

    env := EnvProduction
    if environment == "staging" || environment == "development" {
        env = EnvStaging
    }

    apiKey := fmt.Sprintf("%s_%s_%s", KeyPrefixSecret, env, random)
    return apiKey, nil
}

// HashAPIKey creates SHA-256 hash with unique salt
func (g *KeyGenerator) HashAPIKey(apiKey string) (hash string, salt string, err error) {
    // Generate 128-bit (16-byte) salt
    saltBytes := make([]byte, 16)
    if _, err := rand.Read(saltBytes); err != nil {
        return "", "", err
    }
    salt = hex.EncodeToString(saltBytes) // 32 hex characters

    // SHA-256 hash of (apiKey + salt)
    hasher := sha256.New()
    hasher.Write([]byte(apiKey + salt))
    hashBytes := hasher.Sum(nil)
    hash = hex.EncodeToString(hashBytes) // 64 hex characters

    return hash, salt, nil
}

// VerifyAPIKey checks if plaintext key matches stored hash+salt
func (g *KeyGenerator) VerifyAPIKey(plaintext, hash, salt string) bool {
    hasher := sha256.New()
    hasher.Write([]byte(plaintext + salt))
    computedHash := hex.EncodeToString(hasher.Sum(nil))

    // Constant-time comparison to prevent timing attacks
    return subtle.ConstantTimeCompare([]byte(computedHash), []byte(hash)) == 1
}

// ExtractPrefix returns the first 8 characters for indexing
func (g *KeyGenerator) ExtractPrefix(apiKey string) string {
    if len(apiKey) < 8 {
        return apiKey
    }
    return apiKey[:8] // e.g., "REDACTED_API_KEY"
}

func (g *KeyGenerator) generateRandomString(length int) (string, error) {
    result := make([]byte, length)
    charsetLen := big.NewInt(int64(len(Base62Charset)))

    for i := 0; i < length; i++ {
        num, err := rand.Int(rand.Reader, charsetLen)
        if err != nil {
            return "", err
        }
        result[i] = Base62Charset[num.Int64()]
    }

    return string(result), nil
}
```

---

## 4. Middleware Implementation

### 4.1 API Key Validation Middleware

```go
// internal/middleware/apikey_auth.go
package middleware

import (
    "context"
    "net/http"
    "strings"
    "time"

    "github.com/authz-engine/go-core/internal/apikey"
)

const (
    APIKeyHeader = "X-API-Key"
    ContextKeyAPIKey = "api_key_id"
    ContextKeyScopes = "api_key_scopes"
)

type APIKeyMiddleware struct {
    keyService   *apikey.Service
    rateLimiter  *apikey.RateLimiter
    auditRepo    *apikey.AuditRepository
    logger       Logger
    metrics      MetricsCollector
}

func (m *APIKeyMiddleware) Authenticate(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        startTime := time.Now()

        // 1. Extract API key from X-API-Key header
        apiKey := r.Header.Get(APIKeyHeader)
        if apiKey == "" {
            m.respondUnauthorized(w, r, "missing_api_key", "X-API-Key header is required", startTime)
            return
        }

        // 2. Validate API key format
        if !m.isValidFormat(apiKey) {
            m.respondUnauthorized(w, r, "invalid_api_key_format", "API key format is invalid", startTime)
            return
        }

        // 3. Lookup and verify API key
        keyData, err := m.keyService.VerifyKey(r.Context(), apiKey)
        if err != nil {
            if err == apikey.ErrKeyNotFound {
                m.respondUnauthorized(w, r, "invalid_api_key", "API key is invalid", startTime)
            } else {
                m.respondError(w, r, "internal_error", "Authentication failed", startTime)
            }
            return
        }

        // 4. Check key status
        if err := m.checkKeyStatus(keyData); err != nil {
            m.respondUnauthorized(w, r, err.Code, err.Message, startTime)
            m.auditDenied(r, keyData, err.Code, startTime)
            return
        }

        // 5. Check IP whitelist
        if !m.checkIPWhitelist(r, keyData) {
            m.respondUnauthorized(w, r, "ip_not_allowed", "Request IP is not whitelisted", startTime)
            m.auditDenied(r, keyData, "ip_not_allowed", startTime)
            return
        }

        // 6. Check rate limits
        if exceeded, limitType := m.rateLimiter.CheckLimits(r.Context(), keyData); exceeded {
            m.respondRateLimited(w, r, limitType, startTime)
            m.auditRateLimited(r, keyData, limitType, startTime)
            return
        }

        // 7. Add key context to request
        ctx := context.WithValue(r.Context(), ContextKeyAPIKey, keyData.ID)
        ctx = context.WithValue(ctx, ContextKeyScopes, keyData.Scopes)

        // 8. Update usage metrics (async)
        go m.keyService.RecordUsage(context.Background(), keyData.ID)

        // 9. Audit successful authentication (async)
        go m.auditAllowed(r, keyData, startTime)

        // 10. Record metrics
        m.metrics.RecordAPIKeyAuth("success", keyData.Environment, time.Since(startTime))

        // Continue to next handler
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

func (m *APIKeyMiddleware) isValidFormat(apiKey string) bool {
    // Must start with "sk_"
    if !strings.HasPrefix(apiKey, "sk_") {
        return false
    }

    // Must have environment segment
    parts := strings.Split(apiKey, "_")
    if len(parts) != 3 {
        return false
    }

    env := parts[1]
    if env != "live" && env != "test" {
        return false
    }

    // Random part must be 32 characters
    random := parts[2]
    return len(random) == 32
}

func (m *APIKeyMiddleware) checkKeyStatus(key *apikey.Key) *AuthError {
    // Check if revoked
    if key.IsRevoked {
        return &AuthError{Code: "key_revoked", Message: "API key has been revoked"}
    }

    // Check if active
    if !key.IsActive {
        return &AuthError{Code: "key_inactive", Message: "API key is inactive"}
    }

    // Check if expired
    if key.ExpiresAt != nil && time.Now().After(*key.ExpiresAt) {
        return &AuthError{Code: "key_expired", Message: "API key has expired"}
    }

    return nil
}

func (m *APIKeyMiddleware) checkIPWhitelist(r *http.Request, key *apikey.Key) bool {
    // If no IP whitelist, allow all IPs
    if len(key.AllowedIPs) == 0 {
        return true
    }

    clientIP := extractClientIP(r)

    // Check if client IP is in whitelist
    for _, allowedIP := range key.AllowedIPs {
        if clientIP == allowedIP.String() {
            return true
        }
    }

    return false
}

func (m *APIKeyMiddleware) respondUnauthorized(w http.ResponseWriter, r *http.Request, code, message string, startTime time.Time) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusUnauthorized)
    json.NewEncoder(w).Encode(map[string]string{
        "error": code,
        "error_description": message,
    })

    m.metrics.RecordAPIKeyAuth("unauthorized", code, time.Since(startTime))
}

func (m *APIKeyMiddleware) respondRateLimited(w http.ResponseWriter, r *http.Request, limitType string, startTime time.Time) {
    retryAfter := m.calculateRetryAfter(limitType)

    w.Header().Set("Content-Type", "application/json")
    w.Header().Set("Retry-After", fmt.Sprintf("%d", retryAfter))
    w.Header().Set("X-RateLimit-Limit", m.getRateLimitHeader(limitType))
    w.Header().Set("X-RateLimit-Reset", m.getResetTimeHeader(limitType))
    w.WriteHeader(http.StatusTooManyRequests)

    json.NewEncoder(w).Encode(map[string]interface{}{
        "error": "rate_limit_exceeded",
        "error_description": fmt.Sprintf("Rate limit exceeded for %s window", limitType),
        "retry_after": retryAfter,
    })

    m.metrics.RecordAPIKeyAuth("rate_limited", limitType, time.Since(startTime))
}
```

### 4.2 Scope Authorization Middleware

```go
// internal/middleware/apikey_scope.go
package middleware

import (
    "context"
    "net/http"
)

func (m *APIKeyMiddleware) RequireScope(scope string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            // Get scopes from context (set by Authenticate middleware)
            scopes, ok := r.Context().Value(ContextKeyScopes).([]string)
            if !ok {
                m.respondForbidden(w, "missing_scopes", "No scopes found in context")
                return
            }

            // Check if required scope is present
            if !contains(scopes, scope) {
                m.respondForbidden(w, "insufficient_scope",
                    fmt.Sprintf("Required scope '%s' is not granted", scope))
                return
            }

            next.ServeHTTP(w, r)
        })
    }
}

func (m *APIKeyMiddleware) RequireAnyScope(scopes ...string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            keyScopes, ok := r.Context().Value(ContextKeyScopes).([]string)
            if !ok {
                m.respondForbidden(w, "missing_scopes", "No scopes found in context")
                return
            }

            // Check if ANY required scope is present
            for _, required := range scopes {
                if contains(keyScopes, required) {
                    next.ServeHTTP(w, r)
                    return
                }
            }

            m.respondForbidden(w, "insufficient_scope",
                fmt.Sprintf("One of %v scopes is required", scopes))
        })
    }
}

func (m *APIKeyMiddleware) respondForbidden(w http.ResponseWriter, code, message string) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusForbidden)
    json.NewEncoder(w).Encode(map[string]string{
        "error": code,
        "error_description": message,
    })
}
```

---

## 5. Rate Limiting Implementation

### 5.1 Rate Limiter Service

```go
// internal/apikey/rate_limiter.go
package apikey

import (
    "context"
    "fmt"
    "time"

    "github.com/go-redis/redis/v8"
)

type RateLimiter struct {
    redis *redis.Client
}

type RateLimitResult struct {
    Exceeded  bool
    LimitType string // "minute", "hour", "day"
    Remaining int
    ResetAt   time.Time
}

func (rl *RateLimiter) CheckLimits(ctx context.Context, key *Key) (exceeded bool, limitType string) {
    now := time.Now()

    // Check minute limit
    if exceeded, _ := rl.checkLimit(ctx, key.ID, "minute", key.RateLimitPerMinute, now); exceeded {
        return true, "minute"
    }

    // Check hour limit
    if exceeded, _ := rl.checkLimit(ctx, key.ID, "hour", key.RateLimitPerHour, now); exceeded {
        return true, "hour"
    }

    // Check day limit
    if exceeded, _ := rl.checkLimit(ctx, key.ID, "day", key.RateLimitPerDay, now); exceeded {
        return true, "day"
    }

    // Increment all counters
    rl.incrementCounters(ctx, key.ID, now)

    return false, ""
}

func (rl *RateLimiter) checkLimit(ctx context.Context, keyID, limitType string, limit int, now time.Time) (bool, int) {
    redisKey := rl.buildRedisKey(keyID, limitType, now)

    // Get current count
    count, err := rl.redis.Get(ctx, redisKey).Int()
    if err != nil && err != redis.Nil {
        // On Redis error, allow request (fail open)
        return false, 0
    }

    // Check if limit exceeded
    if count >= limit {
        return true, 0
    }

    remaining := limit - count
    return false, remaining
}

func (rl *RateLimiter) incrementCounters(ctx context.Context, keyID string, now time.Time) {
    // Increment minute counter
    minuteKey := rl.buildRedisKey(keyID, "minute", now)
    rl.redis.Incr(ctx, minuteKey)
    rl.redis.Expire(ctx, minuteKey, 2*time.Minute)

    // Increment hour counter
    hourKey := rl.buildRedisKey(keyID, "hour", now)
    rl.redis.Incr(ctx, hourKey)
    rl.redis.Expire(ctx, hourKey, 2*time.Hour)

    // Increment day counter
    dayKey := rl.buildRedisKey(keyID, "day", now)
    rl.redis.Incr(ctx, dayKey)
    rl.redis.Expire(ctx, dayKey, 48*time.Hour)
}

func (rl *RateLimiter) buildRedisKey(keyID, limitType string, now time.Time) string {
    var bucket string

    switch limitType {
    case "minute":
        bucket = now.Format("200601021504") // YYYYMMDDHHmm
    case "hour":
        bucket = now.Format("2006010215")   // YYYYMMDDHH
    case "day":
        bucket = now.Format("20060102")     // YYYYMMDD
    }

    return fmt.Sprintf("rate_limit:api_key:%s:%s:%s", keyID, limitType, bucket)
}

func (rl *RateLimiter) GetRemainingQuota(ctx context.Context, keyID string, limitType string, limit int) (int, time.Time) {
    now := time.Now()
    redisKey := rl.buildRedisKey(keyID, limitType, now)

    count, err := rl.redis.Get(ctx, redisKey).Int()
    if err != nil {
        return limit, now
    }

    remaining := limit - count
    if remaining < 0 {
        remaining = 0
    }

    resetAt := rl.calculateResetTime(limitType, now)
    return remaining, resetAt
}

func (rl *RateLimiter) calculateResetTime(limitType string, now time.Time) time.Time {
    switch limitType {
    case "minute":
        return now.Truncate(time.Minute).Add(time.Minute)
    case "hour":
        return now.Truncate(time.Hour).Add(time.Hour)
    case "day":
        tomorrow := now.AddDate(0, 0, 1)
        return time.Date(tomorrow.Year(), tomorrow.Month(), tomorrow.Day(), 0, 0, 0, 0, now.Location())
    default:
        return now
    }
}
```

---

## 6. Security Considerations

### 6.1 Key Storage Security

**SHA-256 vs Bcrypt:**
- API keys are high-entropy random strings (192 bits)
- SHA-256 with salt is sufficient (no brute-force risk)
- Faster than bcrypt (<1ms vs 30ms)
- Unique salt per key prevents rainbow tables

**Storage Rules:**
- ✅ NEVER store plaintext API keys
- ✅ ALWAYS use unique salt per key
- ✅ NEVER log API keys (only prefix)
- ✅ MUST transmit over TLS only

### 6.2 Timing Attack Prevention

```go
// Use constant-time comparison
import "crypto/subtle"

func (g *KeyGenerator) VerifyAPIKey(plaintext, hash, salt string) bool {
    hasher := sha256.New()
    hasher.Write([]byte(plaintext + salt))
    computedHash := hex.EncodeToString(hasher.Sum(nil))

    // Prevents timing attacks
    return subtle.ConstantTimeCompare([]byte(computedHash), []byte(hash)) == 1
}
```

### 6.3 IP Whitelisting

**Configuration:**
```sql
-- Example: Restrict key to specific IPs
UPDATE api_keys
SET allowed_ips = ARRAY['192.168.1.100', '10.0.0.50']::INET[]
WHERE id = '...';

-- Example: Allow all IPs (empty array)
UPDATE api_keys
SET allowed_ips = ARRAY[]::INET[]
WHERE id = '...';
```

### 6.4 Scope-Based Access Control

**Best Practices:**
- Define granular scopes (e.g., `read:users`, `write:orders`)
- Use least-privilege principle
- Document scope requirements per endpoint
- Audit scope usage regularly

---

## 7. Performance Targets

### 7.1 Latency Targets

| Operation | Target | Monitoring |
|-----------|--------|------------|
| Key validation (p50) | < 5ms | Prometheus histogram |
| Key validation (p95) | < 8ms | Prometheus histogram |
| Key validation (p99) | < 10ms | Prometheus histogram |
| Redis lookup | < 2ms | Redis monitoring |
| Database lookup | < 3ms | SQL query logging |

### 7.2 Throughput Targets

| Metric | Target |
|--------|--------|
| Requests per second (per instance) | 5000+ |
| Concurrent API key validations | 10000+ |
| Redis connection pool | 50-100 connections |

### 7.3 Resource Limits

| Resource | Limit |
|----------|-------|
| Memory per validation | < 100KB |
| CPU per validation | < 2ms |
| Redis memory per key | < 1KB |

---

## 8. Testing Requirements

### 8.1 Unit Tests

**Key Generation:**
- ✅ Generate valid API key format
- ✅ Hash with unique salt
- ✅ Verify correct key
- ✅ Reject incorrect key
- ✅ Extract prefix correctly

**Middleware:**
- ✅ Valid API key → authenticated
- ✅ Missing X-API-Key header → 401
- ✅ Invalid key format → 401
- ✅ Invalid key → 401
- ✅ Revoked key → 401
- ✅ Expired key → 401
- ✅ Inactive key → 401
- ✅ IP not whitelisted → 401
- ✅ Rate limit exceeded → 429

**Rate Limiting:**
- ✅ Minute limit enforced
- ✅ Hour limit enforced
- ✅ Day limit enforced
- ✅ Counters increment correctly
- ✅ Counters reset after window
- ✅ Redis failure fails open

### 8.2 Integration Tests

```go
func TestAPIKeyAuthentication_Integration(t *testing.T) {
    // Setup
    db := setupTestDB(t)
    redis := setupTestRedis(t)

    // Generate API key
    gen := apikey.NewGenerator()
    plainKey, _ := gen.GenerateAPIKey("production")
    hash, salt, _ := gen.HashAPIKey(plainKey)
    prefix := gen.ExtractPrefix(plainKey)

    // Insert into database
    keyID := insertAPIKey(db, prefix, hash, salt, []string{"read:users"}, 1000, 10000, 100000)

    // Create test request
    req := httptest.NewRequest("GET", "/api/users", nil)
    req.Header.Set("X-API-Key", plainKey)

    // Test authentication
    rr := httptest.NewRecorder()
    middleware.Authenticate(testHandler).ServeHTTP(rr, req)

    // Assertions
    assert.Equal(t, 200, rr.Code)
    assert.NotEmpty(t, req.Context().Value(middleware.ContextKeyAPIKey))

    // Verify usage recorded
    key := getAPIKey(db, keyID)
    assert.Equal(t, int64(1), key.UsageCount)
    assert.NotNil(t, key.LastUsedAt)

    // Verify audit log
    audit := getAuditLog(db, keyID)
    assert.Equal(t, "allowed", audit.AuthorizationResult)
}
```

### 8.3 Load Tests

```yaml
scenarios:
  - name: api_key_validation
    executor: constant-arrival-rate
    rate: 5000 # 5000 RPS
    duration: 60s
    preAllocatedVUs: 200
    maxVUs: 1000

thresholds:
  http_req_duration:
    - p(50)<5    # 50th percentile under 5ms
    - p(95)<8    # 95th percentile under 8ms
    - p(99)<10   # 99th percentile under 10ms
  http_req_failed:
    - rate<0.001 # Error rate under 0.1%
```

---

## 9. Monitoring & Observability

### 9.1 Metrics

```go
var (
    apiKeyValidationsTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "api_key_validations_total",
            Help: "Total number of API key validations",
        },
        []string{"result", "environment"},
    )

    apiKeyValidationDuration = prometheus.NewHistogram(
        prometheus.HistogramOpts{
            Name:    "api_key_validation_duration_seconds",
            Help:    "Duration of API key validation",
            Buckets: []float64{0.001, 0.002, 0.005, 0.008, 0.010, 0.020},
        },
    )

    activeAPIKeysGauge = prometheus.NewGaugeVec(
        prometheus.GaugeOpts{
            Name: "api_keys_active_total",
            Help: "Number of active API keys",
        },
        []string{"environment", "owner_type"},
    )

    rateLimitHitsTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "api_key_rate_limit_hits_total",
            Help: "Total number of rate limit hits",
        },
        []string{"limit_type", "environment"},
    )
)
```

### 9.2 Logging

```go
logger.Info("API key authenticated",
    zap.String("key_prefix", keyPrefix),
    zap.String("environment", environment),
    zap.Strings("scopes", scopes),
    zap.Duration("duration", duration),
)

logger.Warn("API key validation failed",
    zap.String("key_prefix", keyPrefix),
    zap.String("reason", "expired"),
    zap.String("ip", clientIP),
)
```

### 9.3 Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| High validation failure rate | Error rate > 10% for 5m | Warning |
| Rate limit abuse | Single key 100+ 429s in 1m | Warning |
| Unusual IP activity | 10+ different IPs for single key in 5m | Warning |
| High latency | p99 > 20ms for 10m | Warning |

---

## 10. API Key Management APIs

### 10.1 Create API Key

```
POST /api/v1/keys
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "name": "Production API Key",
  "description": "Main API key for production services",
  "environment": "production",
  "scopes": ["read:users", "write:data"],
  "allowed_ips": ["192.168.1.100"],
  "rate_limit_per_minute": 1000,
  "rate_limit_per_hour": 10000,
  "rate_limit_per_day": 100000,
  "expires_at": "2026-01-01T00:00:00Z"
}

Response (201 Created):
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "api_key": "REDACTED_API_KEY",
  "key_prefix": "REDACTED_API_KEY",
  "name": "Production API Key",
  "environment": "production",
  "created_at": "2025-01-27T12:00:00Z"
}
```

**⚠️ CRITICAL: The `api_key` field is ONLY returned once during creation. Store it securely.**

### 10.2 List API Keys

```
GET /api/v1/keys
Authorization: Bearer <admin_token>

Response (200 OK):
{
  "keys": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "key_prefix": "REDACTED_API_KEY",
      "name": "Production API Key",
      "environment": "production",
      "scopes": ["read:users", "write:data"],
      "is_active": true,
      "usage_count": 45678,
      "last_used_at": "2025-01-27T11:45:00Z",
      "created_at": "2025-01-01T00:00:00Z"
    }
  ],
  "total": 1
}
```

### 10.3 Revoke API Key

```
POST /api/v1/keys/{key_id}/revoke
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "reason": "Key compromised"
}

Response (200 OK):
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "is_revoked": true,
  "revoked_at": "2025-01-27T12:00:00Z",
  "revoked_reason": "Key compromised"
}
```

---

## 11. Migration Guide

### 11.1 Creating First API Key

```sql
-- Step 1: Generate API key (use application code)
-- Example key: REDACTED_API_KEY

-- Step 2: Hash with SHA-256 + salt
-- Hash: a1b2c3d4e5f6...
-- Salt: 1234567890abcdef...

-- Step 3: Insert into database
INSERT INTO api_keys (
    key_prefix,
    key_hash,
    key_salt,
    owner_type,
    name,
    environment,
    scopes,
    rate_limit_per_minute,
    rate_limit_per_hour,
    rate_limit_per_day,
    is_active
) VALUES (
    'REDACTED_API_KEY',
    'a1b2c3d4e5f6...',
    '1234567890abcdef...',
    'service',
    'Production Service Key',
    'production',
    ARRAY['read:users', 'write:data'],
    1000,
    10000,
    100000,
    TRUE
);
```

---

## 12. Future Enhancements

### 12.1 Short-term
- [ ] API key rotation automation
- [ ] Usage analytics dashboard
- [ ] Scope hierarchy (e.g., `write:*` implies `read:*`)
- [ ] Webhook notifications for key events

### 12.2 Long-term
- [ ] Multi-region rate limiting
- [ ] Dynamic rate limit adjustment
- [ ] Machine learning for anomaly detection
- [ ] API key sharing (teams/organizations)

---

## 13. References

- OWASP API Security Top 10
- NIST SP 800-63B Digital Identity Guidelines
- RFC 6750: Bearer Token Usage
- SHA-256 Cryptographic Hash Standard
