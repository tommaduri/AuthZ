# Technical Specification: OAuth2 Client Credentials Flow (FR-2, P0)

## 1. Overview

### 1.1 Purpose
Implement RFC 6749 compliant OAuth2 Client Credentials grant type for machine-to-machine authentication.

### 1.2 Scope
- `/oauth/token` endpoint implementation
- Client authentication with bcrypt-hashed secrets
- JWT access token issuance
- Database schema for OAuth2 clients
- Integration with existing JWT infrastructure

### 1.3 Success Criteria
- ✅ OAuth2 RFC 6749 Section 4.4 compliance
- ✅ Sub-50ms token issuance (p99)
- ✅ Secure client secret storage (bcrypt cost 12)
- ✅ 100% test coverage for security-critical paths

---

## 2. Database Schema

### 2.1 OAuth2 Clients Table

```sql
-- Migration: 003_create_oauth2_clients.up.sql
CREATE TABLE IF NOT EXISTS oauth2_clients (
    -- Primary Key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Client Credentials
    client_id VARCHAR(255) NOT NULL UNIQUE,
    client_secret_hash CHAR(60) NOT NULL, -- bcrypt output is always 60 chars

    -- Metadata
    name VARCHAR(255) NOT NULL,
    description TEXT,
    client_type VARCHAR(50) NOT NULL DEFAULT 'confidential', -- confidential, public

    -- Token Configuration
    default_scopes TEXT[], -- Array of default scope strings
    allowed_scopes TEXT[], -- Array of allowed scope strings
    access_token_lifetime_seconds INTEGER NOT NULL DEFAULT 3600, -- 1 hour

    -- Rate Limiting
    token_request_rate_limit INTEGER DEFAULT 100, -- requests per minute

    -- Status
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,

    -- Audit Fields
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by VARCHAR(255),
    last_token_issued_at TIMESTAMP WITH TIME ZONE,

    -- Constraints
    CONSTRAINT chk_client_type CHECK (client_type IN ('confidential', 'public')),
    CONSTRAINT chk_token_lifetime CHECK (access_token_lifetime_seconds > 0 AND access_token_lifetime_seconds <= 86400),
    CONSTRAINT chk_rate_limit CHECK (token_request_rate_limit > 0)
);

-- Indexes for performance
CREATE INDEX idx_oauth2_clients_client_id ON oauth2_clients(client_id) WHERE is_deleted = FALSE;
CREATE INDEX idx_oauth2_clients_active ON oauth2_clients(is_active) WHERE is_deleted = FALSE;
CREATE INDEX idx_oauth2_clients_created_at ON oauth2_clients(created_at);

-- Update trigger
CREATE TRIGGER update_oauth2_clients_updated_at
    BEFORE UPDATE ON oauth2_clients
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

### 2.2 OAuth2 Token Audit Log

```sql
-- Migration: 003_create_oauth2_token_audit.up.sql
CREATE TABLE IF NOT EXISTS oauth2_token_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Client Reference
    client_id UUID NOT NULL REFERENCES oauth2_clients(id) ON DELETE CASCADE,
    client_identifier VARCHAR(255) NOT NULL, -- Denormalized for reporting

    -- Token Details
    token_jti VARCHAR(255) NOT NULL, -- JWT ID for correlation
    grant_type VARCHAR(50) NOT NULL DEFAULT 'client_credentials',
    scopes TEXT[],

    -- Request Context
    request_ip INET,
    request_user_agent TEXT,
    request_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Response
    response_status VARCHAR(20) NOT NULL, -- success, invalid_client, invalid_request
    error_code VARCHAR(100),
    error_description TEXT,

    -- Performance
    processing_duration_ms INTEGER,

    -- Partitioning key
    audit_date DATE NOT NULL DEFAULT CURRENT_DATE,

    CONSTRAINT chk_response_status CHECK (response_status IN ('success', 'invalid_client', 'invalid_request', 'server_error'))
) PARTITION BY RANGE (audit_date);

-- Create partitions for next 12 months (run monthly)
CREATE TABLE oauth2_token_audit_2025_01 PARTITION OF oauth2_token_audit
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

-- Indexes
CREATE INDEX idx_oauth2_token_audit_client_id ON oauth2_token_audit(client_id, audit_date);
CREATE INDEX idx_oauth2_token_audit_jti ON oauth2_token_audit(token_jti);
CREATE INDEX idx_oauth2_token_audit_timestamp ON oauth2_token_audit(request_timestamp);
CREATE INDEX idx_oauth2_token_audit_status ON oauth2_token_audit(response_status, audit_date);
```

### 2.3 Down Migration

```sql
-- Migration: 003_create_oauth2_clients.down.sql
DROP TABLE IF EXISTS oauth2_token_audit;
DROP TABLE IF EXISTS oauth2_clients CASCADE;
```

---

## 3. API Specification

### 3.1 Endpoint: POST /oauth/token

#### 3.1.1 Request Specification

**URL:** `POST /oauth/token`

**Headers:**
```
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <base64(client_id:client_secret)>  [OPTIONAL - Alternative to body params]
```

**Body Parameters:**
```
grant_type=client_credentials                          [REQUIRED]
client_id=<client_identifier>                          [REQUIRED if not in Auth header]
client_secret=<client_secret>                          [REQUIRED if not in Auth header]
scope=<space-separated-scopes>                         [OPTIONAL]
```

**Example Request:**
```bash
curl -X POST https://api.example.com/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=app_7x8y9z" \
  -d "client_secret=secret_abc123xyz" \
  -d "scope=read:users write:data"
```

**Example Request (Basic Auth):**
```bash
curl -X POST https://api.example.com/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic $(echo -n 'app_7x8y9z:secret_abc123xyz' | base64)" \
  -d "grant_type=client_credentials" \
  -d "scope=read:users write:data"
```

#### 3.1.2 Response Specification

**Success Response (200 OK):**
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImtleS0xMjM0In0...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "read:users write:data"
}
```

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| access_token | string | JWT access token (RS256 signed) |
| token_type | string | Always "Bearer" |
| expires_in | integer | Token lifetime in seconds |
| scope | string | Space-separated granted scopes (may differ from requested) |

#### 3.1.3 Error Responses

**400 Bad Request - Invalid Grant Type:**
```json
{
  "error": "unsupported_grant_type",
  "error_description": "The grant_type must be 'client_credentials'"
}
```

**400 Bad Request - Missing Parameters:**
```json
{
  "error": "invalid_request",
  "error_description": "Missing required parameter: client_id"
}
```

**401 Unauthorized - Invalid Client:**
```json
{
  "error": "invalid_client",
  "error_description": "Client authentication failed"
}
```

**403 Forbidden - Inactive Client:**
```json
{
  "error": "access_denied",
  "error_description": "Client is inactive or deleted"
}
```

**429 Too Many Requests:**
```json
{
  "error": "rate_limit_exceeded",
  "error_description": "Token request rate limit exceeded. Retry after 60 seconds",
  "retry_after": 60
}
```

**500 Internal Server Error:**
```json
{
  "error": "server_error",
  "error_description": "An internal error occurred"
}
```

---

## 4. Implementation Design

### 4.1 Go Package Structure

```
internal/
├── oauth2/
│   ├── handler.go           // HTTP handler for /oauth/token
│   ├── service.go           // Business logic for token issuance
│   ├── client_repo.go       // Database repository for OAuth2 clients
│   ├── audit_repo.go        // Database repository for audit logs
│   ├── models.go            // Domain models
│   ├── errors.go            // OAuth2-specific errors
│   └── validator.go         // Request validation
├── crypto/
│   └── bcrypt.go            // Bcrypt hashing utilities
└── middleware/
    └── rate_limit_oauth.go  // OAuth2-specific rate limiting
```

### 4.2 Core Components

#### 4.2.1 OAuth2 Handler

```go
// internal/oauth2/handler.go
package oauth2

import (
    "net/http"
    "time"
)

type Handler struct {
    service      *Service
    validator    *Validator
    rateLimiter  RateLimiter
    logger       Logger
    metrics      MetricsCollector
}

func (h *Handler) HandleTokenRequest(w http.ResponseWriter, r *http.Request) {
    startTime := time.Now()

    // 1. Parse request (form-urlencoded + optional Basic Auth)
    req, err := h.parseTokenRequest(r)
    if err != nil {
        h.writeErrorResponse(w, err)
        h.recordMetrics("token_request", "invalid_request", startTime)
        return
    }

    // 2. Validate grant_type
    if req.GrantType != "client_credentials" {
        h.writeErrorResponse(w, ErrUnsupportedGrantType)
        h.recordMetrics("token_request", "unsupported_grant_type", startTime)
        return
    }

    // 3. Check rate limit
    if err := h.rateLimiter.Allow(r.Context(), req.ClientID); err != nil {
        h.writeErrorResponse(w, ErrRateLimitExceeded)
        h.recordMetrics("token_request", "rate_limited", startTime)
        return
    }

    // 4. Issue token via service
    resp, err := h.service.IssueToken(r.Context(), req)
    if err != nil {
        h.writeErrorResponse(w, err)
        h.recordMetrics("token_request", "failed", startTime)
        return
    }

    // 5. Write success response
    w.Header().Set("Content-Type", "application/json")
    w.Header().Set("Cache-Control", "no-store")
    w.Header().Set("Pragma", "no-cache")
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(resp)

    h.recordMetrics("token_request", "success", startTime)
}

func (h *Handler) parseTokenRequest(r *http.Request) (*TokenRequest, error) {
    if err := r.ParseForm(); err != nil {
        return nil, ErrInvalidRequest.WithDescription("Failed to parse form data")
    }

    req := &TokenRequest{
        GrantType: r.FormValue("grant_type"),
        ClientID:  r.FormValue("client_id"),
        ClientSecret: r.FormValue("client_secret"),
        Scope:     r.FormValue("scope"),
    }

    // Check for Basic Authentication
    if username, password, ok := r.BasicAuth(); ok {
        if req.ClientID == "" {
            req.ClientID = username
        }
        if req.ClientSecret == "" {
            req.ClientSecret = password
        }
    }

    // Validate required fields
    if req.ClientID == "" || req.ClientSecret == "" {
        return nil, ErrInvalidRequest.WithDescription("client_id and client_secret are required")
    }

    return req, nil
}
```

#### 4.2.2 OAuth2 Service

```go
// internal/oauth2/service.go
package oauth2

import (
    "context"
    "strings"
    "time"

    "github.com/authz-engine/go-core/internal/crypto"
    "github.com/authz-engine/go-core/internal/jwt"
)

type Service struct {
    clientRepo   *ClientRepository
    auditRepo    *AuditRepository
    jwtIssuer    *jwt.Issuer
    bcryptHelper *crypto.BcryptHelper
    logger       Logger
}

func (s *Service) IssueToken(ctx context.Context, req *TokenRequest) (*TokenResponse, error) {
    startTime := time.Now()

    // 1. Fetch client from database
    client, err := s.clientRepo.GetByClientID(ctx, req.ClientID)
    if err != nil {
        s.auditFailure(ctx, req, "invalid_client", "Client not found")
        return nil, ErrInvalidClient
    }

    // 2. Verify client is active
    if !client.IsActive || client.IsDeleted {
        s.auditFailure(ctx, req, "access_denied", "Client is inactive")
        return nil, ErrAccessDenied.WithDescription("Client is inactive or deleted")
    }

    // 3. Verify client secret with bcrypt
    if err := s.bcryptHelper.Compare(client.ClientSecretHash, req.ClientSecret); err != nil {
        s.auditFailure(ctx, req, "invalid_client", "Invalid client secret")
        return nil, ErrInvalidClient
    }

    // 4. Validate and resolve scopes
    grantedScopes := s.resolveScopes(client, req.Scope)

    // 5. Generate JWT token
    claims := jwt.Claims{
        Subject:   client.ClientID,
        Issuer:    "authz-engine",
        Audience:  []string{"api"},
        ExpiresAt: time.Now().Add(time.Duration(client.AccessTokenLifetimeSeconds) * time.Second),
        IssuedAt:  time.Now(),
        NotBefore: time.Now(),
        JTI:       generateJTI(), // Unique token ID
        Scopes:    grantedScopes,
        ClientID:  client.ClientID,
        TokenType: "access_token",
    }

    accessToken, err := s.jwtIssuer.IssueToken(ctx, claims)
    if err != nil {
        s.auditFailure(ctx, req, "server_error", "Failed to issue token")
        return nil, ErrServerError
    }

    // 6. Audit successful token issuance
    s.auditSuccess(ctx, client, claims.JTI, grantedScopes, startTime)

    // 7. Update last_token_issued_at
    s.clientRepo.UpdateLastTokenIssued(ctx, client.ID)

    return &TokenResponse{
        AccessToken: accessToken,
        TokenType:   "Bearer",
        ExpiresIn:   client.AccessTokenLifetimeSeconds,
        Scope:       strings.Join(grantedScopes, " "),
    }, nil
}

func (s *Service) resolveScopes(client *OAuth2Client, requestedScope string) []string {
    // If no scope requested, return default scopes
    if requestedScope == "" {
        return client.DefaultScopes
    }

    requested := strings.Fields(requestedScope)
    granted := []string{}

    // Only grant scopes that are in allowed list
    for _, scope := range requested {
        if contains(client.AllowedScopes, scope) {
            granted = append(granted, scope)
        }
    }

    // If no requested scopes were allowed, fall back to defaults
    if len(granted) == 0 {
        return client.DefaultScopes
    }

    return granted
}

func (s *Service) auditSuccess(ctx context.Context, client *OAuth2Client, jti string, scopes []string, startTime time.Time) {
    audit := &TokenAudit{
        ClientID:          client.ID,
        ClientIdentifier:  client.ClientID,
        TokenJTI:          jti,
        GrantType:         "client_credentials",
        Scopes:            scopes,
        ResponseStatus:    "success",
        ProcessingDurationMS: int(time.Since(startTime).Milliseconds()),
    }

    // Non-blocking audit (fire and forget)
    go s.auditRepo.Create(ctx, audit)
}
```

#### 4.2.3 Client Repository

```go
// internal/oauth2/client_repo.go
package oauth2

import (
    "context"
    "database/sql"
    "errors"

    "github.com/lib/pq"
)

type ClientRepository struct {
    db *sql.DB
}

func (r *ClientRepository) GetByClientID(ctx context.Context, clientID string) (*OAuth2Client, error) {
    query := `
        SELECT
            id, client_id, client_secret_hash, name, description,
            client_type, default_scopes, allowed_scopes,
            access_token_lifetime_seconds, token_request_rate_limit,
            is_active, is_deleted, created_at, updated_at
        FROM oauth2_clients
        WHERE client_id = $1 AND is_deleted = FALSE
    `

    var client OAuth2Client
    err := r.db.QueryRowContext(ctx, query, clientID).Scan(
        &client.ID,
        &client.ClientID,
        &client.ClientSecretHash,
        &client.Name,
        &client.Description,
        &client.ClientType,
        pq.Array(&client.DefaultScopes),
        pq.Array(&client.AllowedScopes),
        &client.AccessTokenLifetimeSeconds,
        &client.TokenRequestRateLimit,
        &client.IsActive,
        &client.IsDeleted,
        &client.CreatedAt,
        &client.UpdatedAt,
    )

    if err != nil {
        if errors.Is(err, sql.ErrNoRows) {
            return nil, ErrClientNotFound
        }
        return nil, err
    }

    return &client, nil
}

func (r *ClientRepository) UpdateLastTokenIssued(ctx context.Context, clientID string) error {
    query := `
        UPDATE oauth2_clients
        SET last_token_issued_at = NOW()
        WHERE id = $1
    `
    _, err := r.db.ExecContext(ctx, query, clientID)
    return err
}
```

#### 4.2.4 Bcrypt Helper

```go
// internal/crypto/bcrypt.go
package crypto

import (
    "golang.org/x/crypto/bcrypt"
)

const (
    BcryptCost = 12 // Cost factor (2^12 = 4096 iterations)
)

type BcryptHelper struct{}

func (h *BcryptHelper) Hash(plaintext string) (string, error) {
    hash, err := bcrypt.GenerateFromPassword([]byte(plaintext), BcryptCost)
    if err != nil {
        return "", err
    }
    return string(hash), nil
}

func (h *BcryptHelper) Compare(hash, plaintext string) error {
    return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plaintext))
}
```

### 4.3 Models

```go
// internal/oauth2/models.go
package oauth2

import (
    "time"
)

type OAuth2Client struct {
    ID                         string    `db:"id"`
    ClientID                   string    `db:"client_id"`
    ClientSecretHash           string    `db:"client_secret_hash"`
    Name                       string    `db:"name"`
    Description                string    `db:"description"`
    ClientType                 string    `db:"client_type"`
    DefaultScopes              []string  `db:"default_scopes"`
    AllowedScopes              []string  `db:"allowed_scopes"`
    AccessTokenLifetimeSeconds int       `db:"access_token_lifetime_seconds"`
    TokenRequestRateLimit      int       `db:"token_request_rate_limit"`
    IsActive                   bool      `db:"is_active"`
    IsDeleted                  bool      `db:"is_deleted"`
    CreatedAt                  time.Time `db:"created_at"`
    UpdatedAt                  time.Time `db:"updated_at"`
    LastTokenIssuedAt          *time.Time `db:"last_token_issued_at"`
}

type TokenRequest struct {
    GrantType    string
    ClientID     string
    ClientSecret string
    Scope        string
}

type TokenResponse struct {
    AccessToken string `json:"access_token"`
    TokenType   string `json:"token_type"`
    ExpiresIn   int    `json:"expires_in"`
    Scope       string `json:"scope,omitempty"`
}

type TokenAudit struct {
    ID                   string
    ClientID             string
    ClientIdentifier     string
    TokenJTI             string
    GrantType            string
    Scopes               []string
    RequestIP            string
    RequestUserAgent     string
    ResponseStatus       string
    ErrorCode            string
    ErrorDescription     string
    ProcessingDurationMS int
}
```

---

## 5. Security Considerations

### 5.1 Client Secret Security

**Requirements:**
- ✅ MUST use bcrypt with cost factor 12 minimum
- ✅ MUST NEVER log client secrets
- ✅ MUST transmit secrets over TLS only
- ✅ SHOULD enforce minimum secret length (32 characters)
- ✅ SHOULD enforce secret complexity (alphanumeric + symbols)

**Secret Generation:**
```go
func GenerateClientSecret() string {
    // 32 bytes = 256 bits of entropy
    bytes := make([]byte, 32)
    rand.Read(bytes)
    return base64.URLEncoding.EncodeToString(bytes) // 43 characters
}
```

### 5.2 Rate Limiting

**Strategy:**
- Per-client rate limiting stored in database (`token_request_rate_limit`)
- Default: 100 requests per minute per client
- Implementation: Token bucket algorithm with Redis
- Response: 429 with `Retry-After` header

### 5.3 Scope Validation

**Rules:**
1. Requested scopes MUST be subset of `allowed_scopes`
2. If no scopes requested, use `default_scopes`
3. If requested scopes not allowed, fall back to `default_scopes`
4. Empty scope grants minimum privileges

### 5.4 Audit Logging

**Requirements:**
- ✅ Log all token requests (success and failure)
- ✅ Include client ID, timestamp, scopes, IP address
- ✅ Partition by date for performance
- ✅ Retain for 90 days minimum (compliance)

### 5.5 Token Security

**JWT Claims:**
```json
{
  "iss": "authz-engine",
  "sub": "app_7x8y9z",
  "aud": ["api"],
  "exp": 1735567200,
  "iat": 1735563600,
  "nbf": 1735563600,
  "jti": "550e8400-e29b-41d4-a716-446655440000",
  "scopes": ["read:users", "write:data"],
  "client_id": "app_7x8y9z",
  "token_type": "access_token"
}
```

---

## 6. Performance Targets

### 6.1 Latency Targets

| Metric | Target | Monitoring |
|--------|--------|------------|
| p50 token issuance | < 20ms | Prometheus histogram |
| p95 token issuance | < 40ms | Prometheus histogram |
| p99 token issuance | < 50ms | Prometheus histogram |
| Database query | < 5ms | SQL query logging |
| Bcrypt comparison | < 30ms | Code instrumentation |

### 6.2 Throughput Targets

| Metric | Target |
|--------|--------|
| Requests per second (per instance) | 1000+ |
| Concurrent connections | 5000+ |
| Database connection pool | 25-50 connections |

### 6.3 Resource Limits

| Resource | Limit |
|----------|-------|
| Memory per request | < 1MB |
| CPU per request | < 10ms |
| Database connections | Max 50 per instance |

---

## 7. Testing Requirements

### 7.1 Unit Tests (100% coverage)

**Service Tests:**
- ✅ Valid client credentials → token issued
- ✅ Invalid client_id → 401 error
- ✅ Invalid client_secret → 401 error
- ✅ Inactive client → 403 error
- ✅ Deleted client → 403 error
- ✅ Valid scopes → granted
- ✅ Invalid scopes → default scopes granted
- ✅ No scopes → default scopes granted
- ✅ JWT generation success
- ✅ JWT generation failure → 500 error

**Handler Tests:**
- ✅ Valid form-urlencoded request
- ✅ Valid Basic Authentication request
- ✅ Missing grant_type → 400 error
- ✅ Unsupported grant_type → 400 error
- ✅ Missing client_id → 400 error
- ✅ Missing client_secret → 400 error
- ✅ Rate limit exceeded → 429 error
- ✅ Response headers correct (Cache-Control, Pragma)

**Repository Tests:**
- ✅ Client lookup by client_id (found)
- ✅ Client lookup by client_id (not found)
- ✅ Client lookup excludes deleted clients
- ✅ Update last_token_issued_at

### 7.2 Integration Tests

**Database Integration:**
```go
func TestOAuth2TokenFlow_Integration(t *testing.T) {
    // Setup test database
    db := setupTestDB(t)
    defer db.Close()

    // Insert test client
    clientID := "test_client_123"
    clientSecret := "test_secret_xyz"
    secretHash, _ := bcrypt.GenerateFromPassword([]byte(clientSecret), 12)

    insertClient(db, clientID, string(secretHash), []string{"read:users"})

    // Make token request
    resp := makeTokenRequest(t, clientID, clientSecret, "read:users")

    // Assertions
    assert.Equal(t, 200, resp.StatusCode)
    assert.NotEmpty(t, resp.AccessToken)
    assert.Equal(t, "Bearer", resp.TokenType)
    assert.Equal(t, 3600, resp.ExpiresIn)

    // Verify JWT is valid
    claims := verifyJWT(t, resp.AccessToken)
    assert.Equal(t, clientID, claims.Subject)
    assert.Contains(t, claims.Scopes, "read:users")

    // Verify audit log created
    audit := getAuditLog(db, clientID)
    assert.Equal(t, "success", audit.ResponseStatus)
}
```

### 7.3 Performance Tests

**Load Test Scenario:**
```yaml
scenarios:
  - name: oauth2_token_issuance
    executor: constant-arrival-rate
    rate: 1000 # 1000 RPS
    duration: 60s
    preAllocatedVUs: 100
    maxVUs: 500

thresholds:
  http_req_duration:
    - p(50)<20   # 50th percentile under 20ms
    - p(95)<40   # 95th percentile under 40ms
    - p(99)<50   # 99th percentile under 50ms
  http_req_failed:
    - rate<0.01  # Error rate under 1%
```

### 7.4 Security Tests

- ✅ SQL injection attempts in client_id
- ✅ Timing attack resistance (bcrypt constant-time)
- ✅ Brute force protection (rate limiting)
- ✅ Scope escalation attempts
- ✅ Token reuse/replay (unique JTI validation)

---

## 8. Monitoring & Observability

### 8.1 Metrics (Prometheus)

```go
var (
    tokenRequestsTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "oauth2_token_requests_total",
            Help: "Total number of OAuth2 token requests",
        },
        []string{"status", "client_id"},
    )

    tokenIssuanceDuration = prometheus.NewHistogram(
        prometheus.HistogramOpts{
            Name:    "oauth2_token_issuance_duration_seconds",
            Help:    "Duration of token issuance",
            Buckets: []float64{0.01, 0.02, 0.03, 0.04, 0.05, 0.1, 0.2},
        },
    )

    activeClientsGauge = prometheus.NewGauge(
        prometheus.GaugeOpts{
            Name: "oauth2_active_clients_total",
            Help: "Number of active OAuth2 clients",
        },
    )
)
```

### 8.2 Logging

```go
// Structured logging with zap
logger.Info("OAuth2 token issued",
    zap.String("client_id", clientID),
    zap.Strings("scopes", scopes),
    zap.Duration("duration", duration),
    zap.String("jti", jti),
)

logger.Warn("OAuth2 authentication failed",
    zap.String("client_id", clientID),
    zap.String("error", "invalid_client"),
    zap.String("ip", requestIP),
)
```

### 8.3 Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| High error rate | Error rate > 5% for 5m | Critical |
| High latency | p99 > 100ms for 10m | Warning |
| Rate limit abuse | Single client 50+ 429s in 1m | Warning |
| No token issued | Zero successful tokens in 5m | Critical |

---

## 9. Deployment Checklist

### 9.1 Pre-Deployment
- [ ] Run database migration `003_create_oauth2_clients.up.sql`
- [ ] Create initial OAuth2 client for testing
- [ ] Configure rate limiting in Redis
- [ ] Set up monitoring dashboards
- [ ] Configure alerts

### 9.2 Post-Deployment
- [ ] Verify `/oauth/token` endpoint responds
- [ ] Test token issuance with valid credentials
- [ ] Verify JWT signature validation
- [ ] Check audit logs are being created
- [ ] Monitor p99 latency < 50ms
- [ ] Verify rate limiting works

### 9.3 Rollback Plan
1. Revert HTTP handler registration
2. Run down migration if no data created
3. Restore previous version
4. Monitor for errors

---

## 10. Migration Guide

### 10.1 Creating First OAuth2 Client

```sql
-- Generate client secret (do this in application code)
-- Example: secret_abc123xyz456def789ghi

-- Hash the secret with bcrypt cost 12
-- Example hash: $2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYq3eJvZQKu

INSERT INTO oauth2_clients (
    client_id,
    client_secret_hash,
    name,
    description,
    client_type,
    default_scopes,
    allowed_scopes,
    access_token_lifetime_seconds,
    token_request_rate_limit,
    is_active
) VALUES (
    'app_production_api',
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYq3eJvZQKu',
    'Production API Client',
    'Main API client for production services',
    'confidential',
    ARRAY['read:users', 'read:data'],
    ARRAY['read:users', 'read:data', 'write:data', 'admin:system'],
    3600,
    100,
    TRUE
);
```

### 10.2 Client Secret Rotation

```sql
-- 1. Generate new secret and hash
-- 2. Update client record
UPDATE oauth2_clients
SET
    client_secret_hash = '$2a$12$NEW_HASH_HERE',
    updated_at = NOW()
WHERE client_id = 'app_production_api';

-- 3. Notify client owner of new secret
-- 4. Old tokens remain valid until expiry
```

---

## 11. Future Enhancements

### 11.1 Short-term (Next Sprint)
- [ ] Client secret rotation automation
- [ ] Client management API (CRUD for clients)
- [ ] Scope documentation generation
- [ ] Token introspection endpoint (RFC 7662)

### 11.2 Long-term (Future Phases)
- [ ] Authorization Code grant type
- [ ] Refresh tokens
- [ ] PKCE (RFC 7636)
- [ ] JWT-based client authentication (RFC 7523)
- [ ] Dynamic client registration (RFC 7591)

---

## 12. References

- RFC 6749: OAuth 2.0 Authorization Framework
- RFC 7519: JSON Web Token (JWT)
- RFC 7662: OAuth 2.0 Token Introspection
- OWASP OAuth 2.0 Security Cheat Sheet
- Bcrypt Cost Factor Analysis (OWASP)
