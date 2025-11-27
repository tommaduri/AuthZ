# Phase 6 Week 1-2: Authentication System SDD

**Document Version**: 1.0
**Date**: 2025-11-26
**Status**: APPROVED
**Owner**: Security Team
**Priority**: P0 (Blocking Production)

---

## 1. Executive Summary

### 1.1 Purpose
Add production-grade JWT/OAuth authentication to the AuthZ Engine APIs to secure all endpoints and enable multi-tenant access control. This authentication layer will support API keys, JWT tokens, and OAuth2 flows while maintaining <10ms authentication overhead.

### 1.2 Scope
- **In Scope**: JWT token authentication (HS256, RS256), OAuth2 client credentials flow, API key management, token refresh/revocation, rate limiting per authentication method
- **Out of Scope**: OAuth2 authorization code flow (Phase 6 Week 3), SAML/SSO integration, user password management (delegated to external IdP)
- **Success Criteria**:
  - <10ms p99 authentication latency
  - Support 10,000+ concurrent authenticated requests
  - Zero-downtime key rotation
  - SOC2/GDPR compliant audit logging

### 1.3 Dependencies
| Dependency | Type | Status | Notes |
|------------|------|--------|-------|
| Agent identity system | Existing | ✅ Complete | Phase 5 implementation |
| PostgreSQL | New | ⚠️ Required | Credential storage |
| Redis | New | ⚠️ Required | Token blacklist, rate limiting |
| golang-jwt/jwt/v5 | Library | ⚠️ Required | JWT signing/validation |

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-1 | Support JWT token authentication (HS256, RS256) | P0 | Validate Bearer tokens in Authorization header |
| FR-2 | Support OAuth2 client credentials flow | P0 | Issue access tokens for service-to-service auth |
| FR-3 | Support API key authentication | P0 | Validate X-API-Key header, hash-based storage |
| FR-4 | Token refresh mechanism | P0 | Refresh tokens with 7-day TTL |
| FR-5 | Multi-tenant token isolation | P0 | `tenant_id` claim enforced in policies |
| FR-6 | Token revocation (blacklist) | P0 | Redis-backed blacklist with TTL |
| FR-7 | Rate limiting per authentication method | P1 | 100 req/sec per API key, 1000 req/sec per OAuth client |
| FR-8 | Key rotation | P1 | Zero-downtime RSA key rotation |
| FR-9 | Credential lifecycle management | P1 | Expiration, revocation, renewal |

### 2.2 Non-Functional Requirements

| ID | Requirement | Target | Measurement Method |
|----|-------------|--------|-------------------|
| NFR-1 | Authentication latency | <10ms p99 | Middleware timing |
| NFR-2 | Concurrent authenticated requests | 10,000+ req/sec | Load testing |
| NFR-3 | Key rotation downtime | 0 seconds | Blue-green key deployment |
| NFR-4 | Audit logging | 100% coverage | All auth events logged |
| NFR-5 | Secret storage security | Encrypted at rest | AWS Secrets Manager/Vault |
| NFR-6 | JWT token expiry | 1 hour (configurable) | Token claims validation |
| NFR-7 | API key hash algorithm | SHA-256 | Bcrypt for password hashing |
| NFR-8 | Token size | <2KB | JWT header + payload size |

### 2.3 Security Requirements

| ID | Requirement | Implementation |
|----|-------------|----------------|
| SEC-1 | Private keys stored encrypted | AWS Secrets Manager / HashiCorp Vault |
| SEC-2 | API keys hashed (never plaintext) | SHA-256 with salt |
| SEC-3 | Brute-force protection | 5 failed attempts → 15-min lockout |
| SEC-4 | Token tampering detection | Signature validation on every request |
| SEC-5 | Secure random generation | crypto/rand for all tokens |
| SEC-6 | TLS 1.3 for all endpoints | gRPC/HTTP TLS configuration |
| SEC-7 | SOC2/GDPR compliance | Audit logs with PII redaction |

---

## 3. Architecture

### 3.1 High-Level Component Design

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       Authentication Architecture                        │
└─────────────────────────────────────────────────────────────────────────┘

                              API Request
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │  Authentication         │
                    │  Middleware (Gin)       │
                    └─────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
         ┌──────────▼──────────┐    ┌──────────▼──────────┐
         │ JWT Validator       │    │ API Key Validator   │
         │ - HS256/RS256       │    │ - SHA-256 lookup    │
         │ - Expiration check  │    │ - Rate limit check  │
         │ - Revocation check  │    │ - Expiration check  │
         │ (Redis)             │    │ (PostgreSQL)        │
         └──────────┬──────────┘    └──────────┬──────────┘
                    │                           │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │  Principal Extractor      │
                    │  - Map to Agent ID        │
                    │  - Extract roles/scopes   │
                    │  - Set tenant context     │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │  Authorization Engine     │
                    │  DecisionEngine.Check()   │
                    └─────────────┬─────────────┘
                                  │
                              Response


┌─────────────────────────────────────────────────────────────────────────┐
│                          Data Flow Diagram                               │
└─────────────────────────────────────────────────────────────────────────┘

1. JWT Token Issuance:
   POST /v1/auth/token
   ──────────────────────────────────────────────────────
   Client → AuthHandler → CredentialStore (PostgreSQL)
                       → JWT Signer (RS256 private key)
                       → Response (access_token, refresh_token)

2. JWT Token Validation:
   GET /v1/resources (with Bearer token)
   ──────────────────────────────────────────────────────
   Client → AuthMiddleware → JWT Validator
                           → Check signature (RS256 public key)
                           → Check expiration (exp claim)
                           → Check revocation (Redis blacklist)
                           → Extract Principal (sub, roles, tenant_id)
                           → Continue to handler

3. API Key Validation:
   GET /v1/resources (with X-API-Key header)
   ──────────────────────────────────────────────────────
   Client → AuthMiddleware → API Key Validator
                           → Hash API key (SHA-256)
                           → Lookup in PostgreSQL
                           → Check expiration
                           → Rate limit check (Redis)
                           → Extract Principal
                           → Continue to handler

4. Token Revocation:
   POST /v1/auth/revoke
   ──────────────────────────────────────────────────────
   Client → AuthHandler → Add to Redis blacklist
                        → Set TTL = token expiry
                        → Audit log entry
```

### 3.2 Component Details

#### 3.2.1 Authentication Middleware (`internal/auth/middleware.go`)
**Responsibilities**:
- Intercept all HTTP/gRPC requests
- Extract authentication credentials (Bearer token, API key)
- Route to appropriate validator
- Set Principal in request context
- Log authentication events

**Key Methods**:
```go
type AuthMiddleware struct {
    jwtValidator    *JWTValidator
    apiKeyValidator *APIKeyValidator
    auditLogger     *AuditLogger
    rateLimiter     *RateLimiter
}

func (m *AuthMiddleware) Authenticate() gin.HandlerFunc
func (m *AuthMiddleware) extractAuthType(c *gin.Context) AuthType
func (m *AuthMiddleware) setPrincipal(c *gin.Context, principal *types.Principal)
```

#### 3.2.2 JWT Validator (`internal/auth/jwt_validator.go`)
**Responsibilities**:
- Validate JWT signature (RS256/HS256)
- Check token expiration
- Check revocation status (Redis)
- Extract claims (sub, roles, tenant_id, scopes)

**Key Methods**:
```go
type JWTValidator struct {
    publicKey      *rsa.PublicKey
    privateKey     *rsa.PrivateKey
    blacklist      *RedisBlacklist
    issuer         string
    audience       string
}

func (v *JWTValidator) Validate(token string) (*Claims, error)
func (v *JWTValidator) IsRevoked(jti string) bool
func (v *JWTValidator) ExtractPrincipal(claims *Claims) *types.Principal
```

**JWT Claims Structure**:
```json
{
  "sub": "agent:service-123",        // Agent ID
  "iss": "authz-engine",              // Issuer
  "aud": "authz-api",                 // Audience
  "exp": 1735257600,                  // Expiration (1 hour from iat)
  "iat": 1735171200,                  // Issued at
  "jti": "token-uuid-123",            // JWT ID (for revocation)
  "roles": ["admin", "policy:write"], // Principal roles
  "tenant_id": "tenant-abc",          // Multi-tenancy
  "scopes": ["read:*", "write:policies"] // OAuth2 scopes
}
```

#### 3.2.3 API Key Validator (`internal/auth/apikey_validator.go`)
**Responsibilities**:
- Hash incoming API key (SHA-256)
- Lookup in PostgreSQL by hash
- Check expiration and revocation
- Rate limit check (per-key)
- Update last_used_at timestamp

**Key Methods**:
```go
type APIKeyValidator struct {
    store       *APIKeyStore
    rateLimiter *RateLimiter
}

func (v *APIKeyValidator) Validate(apiKey string) (*APIKeyRecord, error)
func (v *APIKeyValidator) hashKey(apiKey string) string
func (v *APIKeyValidator) checkRateLimit(keyID string) error
func (v *APIKeyValidator) updateLastUsed(keyID string)
```

**API Key Schema** (PostgreSQL):
```sql
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256 hash
    name VARCHAR(255),                      -- Human-readable name
    agent_id VARCHAR(255) NOT NULL,         -- Owner agent ID
    scopes TEXT[],                          -- Allowed scopes
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP,                   -- NULL = never expires
    last_used_at TIMESTAMP,
    revoked_at TIMESTAMP,
    rate_limit_rps INTEGER DEFAULT 100,     -- Requests per second
    metadata JSONB,                         -- Extra key-value pairs
    INDEX idx_key_hash (key_hash),
    INDEX idx_agent_id (agent_id),
    INDEX idx_active (revoked_at) WHERE revoked_at IS NULL
);
```

#### 3.2.4 Token Issuer (`internal/auth/token_issuer.go`)
**Responsibilities**:
- Generate JWT access tokens
- Generate refresh tokens
- Sign tokens with RSA private key
- Store refresh tokens in PostgreSQL

**Key Methods**:
```go
type TokenIssuer struct {
    privateKey    *rsa.PrivateKey
    issuer        string
    audience      string
    accessTTL     time.Duration  // Default: 1 hour
    refreshTTL    time.Duration  // Default: 7 days
    refreshStore  *RefreshTokenStore
}

func (t *TokenIssuer) IssueToken(agentID string, roles []string, tenantID string) (*TokenPair, error)
func (t *TokenIssuer) RefreshToken(refreshToken string) (*TokenPair, error)
func (t *TokenIssuer) RevokeToken(jti string) error
```

**Token Pair Structure**:
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "refresh_abc123...",
  "scope": "read:* write:policies"
}
```

#### 3.2.5 Rate Limiter (`internal/auth/rate_limiter.go`)
**Responsibilities**:
- Token bucket algorithm per API key
- Redis-backed counters
- Per-tenant rate limiting
- Burst allowance

**Key Methods**:
```go
type RateLimiter struct {
    redis       *redis.Client
    defaultRPS  int  // Default: 100 req/sec
}

func (r *RateLimiter) Allow(key string, limit int) (bool, error)
func (r *RateLimiter) GetLimit(keyID string) int
func (r *RateLimiter) IncrementCounter(key string) error
```

---

## 4. Data Models

### 4.1 Database Schema

#### Refresh Tokens Table:
```sql
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256 of refresh token
    agent_id VARCHAR(255) NOT NULL,
    access_token_jti VARCHAR(255),           -- Linked access token
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,
    last_used_at TIMESTAMP,
    INDEX idx_agent_id (agent_id),
    INDEX idx_active (revoked_at) WHERE revoked_at IS NULL
);
```

#### Credentials Table (extends existing Agent schema):
```sql
-- Stored in existing agents table, add columns:
ALTER TABLE agents ADD COLUMN password_hash VARCHAR(255);  -- bcrypt hash
ALTER TABLE agents ADD COLUMN password_updated_at TIMESTAMP;
ALTER TABLE agents ADD COLUMN failed_login_attempts INTEGER DEFAULT 0;
ALTER TABLE agents ADD COLUMN locked_until TIMESTAMP;
```

### 4.2 Redis Data Structures

#### Token Blacklist:
```
Key: blacklist:jwt:{jti}
Value: "revoked"
TTL: Token expiry time (hours)
```

#### Rate Limiting:
```
Key: ratelimit:{key_type}:{key_id}:{window}
Value: Counter (integer)
TTL: 60 seconds (sliding window)
```

#### Token Metadata Cache:
```
Key: tokeninfo:{jti}
Value: JSON { "agent_id": "...", "roles": [...], "exp": ... }
TTL: Token expiry time
```

---

## 5. API Specification

### 5.1 Authentication Endpoints

#### POST /v1/auth/token (JWT Issuance)
**Description**: Issue JWT access and refresh tokens (OAuth2 client credentials flow)

**Request**:
```json
{
  "grant_type": "client_credentials",
  "client_id": "agent:service-123",
  "client_secret": "secret_abc...",
  "scope": "read:* write:policies"
}
```

**Response (200 OK)**:
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "refresh_xyz...",
  "scope": "read:* write:policies"
}
```

**Error Codes**:
- `400 INVALID_REQUEST` - Missing fields
- `401 INVALID_CREDENTIALS` - Invalid client_id/secret
- `403 ACCOUNT_LOCKED` - Too many failed attempts
- `500 SERVER_ERROR` - Internal error

---

#### POST /v1/auth/refresh (Token Refresh)
**Description**: Refresh an access token using a refresh token

**Request**:
```json
{
  "grant_type": "refresh_token",
  "refresh_token": "refresh_xyz..."
}
```

**Response (200 OK)**:
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**Error Codes**:
- `400 INVALID_REQUEST` - Missing refresh_token
- `401 INVALID_TOKEN` - Token expired or revoked
- `500 SERVER_ERROR` - Internal error

---

#### POST /v1/auth/revoke (Token Revocation)
**Description**: Revoke an access or refresh token

**Request**:
```json
{
  "token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type_hint": "access_token"  // or "refresh_token"
}
```

**Response (200 OK)**:
```json
{
  "message": "Token revoked successfully"
}
```

---

#### POST /v1/auth/keys (Create API Key)
**Description**: Generate a new API key for an agent

**Request**:
```json
{
  "name": "Production API Key",
  "agent_id": "agent:service-123",
  "scopes": ["read:*", "write:policies"],
  "expires_at": "2026-12-31T23:59:59Z",
  "rate_limit_rps": 200
}
```

**Response (201 Created)**:
```json
{
  "api_key": "ak_live_abc123xyz...",  // Plain key (only shown once!)
  "id": "uuid-123",
  "name": "Production API Key",
  "created_at": "2025-11-26T12:00:00Z",
  "expires_at": "2026-12-31T23:59:59Z"
}
```

**Security Note**: The plain API key is ONLY returned in the creation response. It must be stored securely by the client.

---

#### GET /v1/auth/keys (List API Keys)
**Description**: List all API keys for the authenticated agent

**Response (200 OK)**:
```json
{
  "keys": [
    {
      "id": "uuid-123",
      "name": "Production API Key",
      "scopes": ["read:*", "write:policies"],
      "created_at": "2025-11-26T12:00:00Z",
      "expires_at": "2026-12-31T23:59:59Z",
      "last_used_at": "2025-11-26T14:30:00Z",
      "rate_limit_rps": 200
    }
  ]
}
```

---

#### DELETE /v1/auth/keys/{id} (Revoke API Key)
**Description**: Revoke an API key

**Response (200 OK)**:
```json
{
  "message": "API key revoked successfully"
}
```

---

### 5.2 Middleware Integration

#### Gin Middleware Example:
```go
// Apply authentication middleware to protected routes
router := gin.Default()

// Public routes (no auth)
router.GET("/health", healthHandler)

// Protected routes (require authentication)
protected := router.Group("/v1")
protected.Use(authMiddleware.Authenticate())
{
    protected.POST("/check", checkHandler)
    protected.GET("/policies", listPoliciesHandler)
    protected.POST("/policies", createPolicyHandler)
}

// Admin routes (require admin role)
admin := router.Group("/v1/admin")
admin.Use(authMiddleware.Authenticate())
admin.Use(authMiddleware.RequireRole("admin"))
{
    admin.GET("/agents", listAgentsHandler)
    admin.POST("/agents", createAgentHandler)
}
```

#### gRPC Interceptor:
```go
// gRPC server with auth interceptor
server := grpc.NewServer(
    grpc.UnaryInterceptor(authInterceptor.Unary()),
    grpc.StreamInterceptor(authInterceptor.Stream()),
)

// Auth interceptor
func (i *AuthInterceptor) Unary() grpc.UnaryServerInterceptor {
    return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
        // Extract metadata (Authorization header)
        md, ok := metadata.FromIncomingContext(ctx)
        if !ok {
            return nil, status.Error(codes.Unauthenticated, "missing metadata")
        }

        authHeaders := md.Get("authorization")
        if len(authHeaders) == 0 {
            return nil, status.Error(codes.Unauthenticated, "missing authorization header")
        }

        // Validate token
        token := strings.TrimPrefix(authHeaders[0], "Bearer ")
        principal, err := i.jwtValidator.Validate(token)
        if err != nil {
            return nil, status.Error(codes.Unauthenticated, err.Error())
        }

        // Set principal in context
        ctx = context.WithValue(ctx, "principal", principal)

        // Continue to handler
        return handler(ctx, req)
    }
}
```

---

## 6. Implementation Plan

### 6.1 Week 1: JWT Authentication Foundation

#### Day 1: JWT Library Setup & Key Generation (8 hours)
**Tasks**:
1. Install `golang-jwt/jwt/v5` library
2. Generate RSA 2048-bit key pair for signing
3. Implement key loader from AWS Secrets Manager/Vault
4. Create JWT claims structure
5. Write unit tests for key loading

**Files**:
- `internal/auth/jwt.go` (200 LOC)
- `internal/auth/jwt_test.go` (150 LOC)
- `internal/auth/keys.go` (100 LOC)

**Deliverables**:
- ✅ RSA key pair generation script
- ✅ JWT library integration
- ✅ Key rotation support (dual-key validation)

---

#### Day 2: JWT Token Issuance (8 hours)
**Tasks**:
1. Implement `TokenIssuer` struct
2. Create `POST /v1/auth/token` endpoint
3. Add username/password validation (bcrypt)
4. Implement OAuth2 client credentials flow
5. Add refresh token generation
6. Write integration tests

**Files**:
- `internal/auth/token_issuer.go` (250 LOC)
- `internal/api/handlers/auth_handler.go` (300 LOC)
- `tests/integration/auth_test.go` (200 LOC)

**Deliverables**:
- ✅ Token issuance API working
- ✅ Refresh token support
- ✅ OAuth2 compliance

---

#### Day 3: JWT Validation Middleware (8 hours)
**Tasks**:
1. Implement `JWTValidator` struct
2. Add signature validation (RS256)
3. Check expiration and audience
4. Implement Redis blacklist lookup
5. Create Gin middleware
6. Create gRPC interceptor
7. Write middleware tests

**Files**:
- `internal/auth/jwt_validator.go` (200 LOC)
- `internal/auth/middleware.go` (150 LOC)
- `internal/server/interceptors/auth.go` (100 LOC)

**Deliverables**:
- ✅ JWT validation middleware
- ✅ gRPC auth interceptor
- ✅ Redis blacklist integration

---

#### Day 4: Principal Extraction & Integration (6 hours)
**Tasks**:
1. Extract Principal from JWT claims
2. Map `sub` claim to Agent ID
3. Extract roles and tenant_id
4. Integrate with existing Agent system
5. Update CheckRequest context
6. End-to-end integration testing

**Files**:
- `internal/auth/principal.go` (100 LOC)
- Updates to `internal/engine/engine.go`

**Deliverables**:
- ✅ JWT → Principal mapping
- ✅ Multi-tenant support
- ✅ Integration with authorization engine

---

#### Day 5: Testing & Documentation (8 hours)
**Tasks**:
1. Unit tests (token generation, validation)
2. Integration tests (end-to-end auth flow)
3. Performance benchmarks (<10ms target)
4. API documentation (OpenAPI spec)
5. Deployment guide

**Deliverables**:
- ✅ 100% test coverage for JWT auth
- ✅ API documentation
- ✅ Performance benchmarks

---

### 6.2 Week 2: API Keys & OAuth2

#### Day 1: PostgreSQL Schema & API Key Store (8 hours)
**Tasks**:
1. Create `api_keys` table migration
2. Create `refresh_tokens` table migration
3. Implement `APIKeyStore` (CRUD operations)
4. Add database indexes
5. Write store tests

**Files**:
- `migrations/006_create_api_keys.sql`
- `migrations/007_create_refresh_tokens.sql`
- `internal/auth/apikey_store.go` (200 LOC)

**Deliverables**:
- ✅ Database schema
- ✅ API key CRUD operations
- ✅ Migration scripts

---

#### Day 2: API Key Generation & Validation (8 hours)
**Tasks**:
1. Implement secure random key generation (crypto/rand)
2. Add SHA-256 hashing
3. Create `POST /v1/auth/keys` endpoint
4. Implement `APIKeyValidator`
5. Add rate limiting per key
6. Write validation tests

**Files**:
- `internal/auth/apikey_validator.go` (150 LOC)
- `internal/api/handlers/apikey_handler.go` (200 LOC)

**Deliverables**:
- ✅ API key generation
- ✅ Hash-based validation
- ✅ Rate limiting

---

#### Day 3: API Key Management APIs (6 hours)
**Tasks**:
1. `GET /v1/auth/keys` (list keys)
2. `DELETE /v1/auth/keys/{id}` (revoke key)
3. Update last_used_at timestamp
4. Add expiration checks
5. Write API tests

**Files**:
- Updates to `internal/api/handlers/apikey_handler.go`

**Deliverables**:
- ✅ Full API key lifecycle management
- ✅ Expiration handling
- ✅ Revocation support

---

#### Day 4: Token Revocation & Redis Integration (8 hours)
**Tasks**:
1. Implement `POST /v1/auth/revoke` endpoint
2. Add JWT to Redis blacklist
3. Set TTL = token expiry
4. Implement refresh token revocation
5. Add revocation checks to validator
6. Write revocation tests

**Files**:
- `internal/auth/blacklist.go` (100 LOC)
- Updates to `internal/api/handlers/auth_handler.go`

**Deliverables**:
- ✅ Token revocation working
- ✅ Redis blacklist integration
- ✅ Refresh token revocation

---

#### Day 5: Security Hardening & Audit (8 hours)
**Tasks**:
1. Add brute-force protection (5 attempts → lockout)
2. Implement account lockout (15 minutes)
3. Add audit logging for all auth events
4. Security testing (token tampering, replay attacks)
5. Key rotation procedures
6. Documentation updates

**Files**:
- `internal/auth/security.go` (150 LOC)
- `docs/AUTHENTICATION.md`

**Deliverables**:
- ✅ Brute-force protection
- ✅ Audit logging
- ✅ Security documentation

---

### 6.3 Effort Estimates

| Task Category | Effort (days) | Priority | Dependencies |
|---------------|---------------|----------|--------------|
| **Week 1: JWT Authentication** | | | |
| JWT library setup & key generation | 1 | P0 | None |
| Token issuance API | 1 | P0 | Day 1 complete |
| JWT validation middleware | 1 | P0 | Day 2 complete |
| Principal extraction & integration | 0.75 | P0 | Day 3 complete |
| Testing & documentation | 1 | P0 | Days 1-4 complete |
| **Week 1 Total** | **4.75 days** | | |
| **Week 2: API Keys & OAuth2** | | | |
| PostgreSQL schema & API key store | 1 | P0 | None |
| API key generation & validation | 1 | P0 | Day 1 complete |
| API key management APIs | 0.75 | P0 | Day 2 complete |
| Token revocation & Redis | 1 | P0 | Week 1 complete |
| Security hardening & audit | 1 | P0 | All prior tasks |
| **Week 2 Total** | **4.75 days** | | |
| **GRAND TOTAL** | **9.5 days** (~2 weeks) | | |

**Contingency**: +2 days buffer for unexpected issues (15-20% buffer)
**Total Estimated Delivery**: **11-12 days (2.5 weeks)**

---

## 7. Testing Strategy

### 7.1 Unit Tests

**JWT Token Generation** (`internal/auth/jwt_test.go`):
```go
func TestGenerateToken(t *testing.T) {
    // Test cases:
    // - Valid token generation with all claims
    // - Token signing with RS256
    // - Expiration time calculation
    // - JTI uniqueness
}

func TestValidateToken(t *testing.T) {
    // Test cases:
    // - Valid token passes validation
    // - Expired token rejected
    // - Invalid signature rejected
    // - Tampered token rejected
    // - Wrong audience rejected
}
```

**API Key Validation** (`internal/auth/apikey_validator_test.go`):
```go
func TestHashAPIKey(t *testing.T) {
    // Consistent hashing
    // SHA-256 output format
}

func TestValidateAPIKey(t *testing.T) {
    // Valid key accepted
    // Invalid hash rejected
    // Expired key rejected
    // Revoked key rejected
}
```

**Rate Limiting** (`internal/auth/rate_limiter_test.go`):
```go
func TestRateLimit(t *testing.T) {
    // Allow under limit
    // Reject over limit
    // Window reset
    // Per-key isolation
}
```

---

### 7.2 Integration Tests

**End-to-End Authentication Flow** (`tests/integration/auth_flow_test.go`):
```go
func TestJWTAuthenticationFlow(t *testing.T) {
    // 1. Request token with valid credentials
    // 2. Receive access_token and refresh_token
    // 3. Make authenticated request with Bearer token
    // 4. Verify Principal extracted correctly
    // 5. Refresh token before expiration
    // 6. Revoke token
    // 7. Verify revoked token rejected
}

func TestAPIKeyAuthenticationFlow(t *testing.T) {
    // 1. Create API key
    // 2. Make request with X-API-Key header
    // 3. Verify authentication succeeds
    // 4. Revoke API key
    // 5. Verify revoked key rejected
}

func TestMultiTenantIsolation(t *testing.T) {
    // 1. Create tokens for tenant A and B
    // 2. Verify tenant A cannot access tenant B resources
    // 3. Verify tenant_id claim enforced in policies
}
```

---

### 7.3 Security Tests

**Token Tampering Detection** (`tests/security/token_tampering_test.go`):
```go
func TestTokenTampering(t *testing.T) {
    // Modify JWT payload (e.g., change roles)
    // Verify signature validation fails
    // Ensure tampered token rejected
}

func TestTokenReplay(t *testing.T) {
    // Revoke token
    // Attempt to reuse revoked token
    // Verify blacklist prevents replay
}
```

**Brute-Force Protection** (`tests/security/brute_force_test.go`):
```go
func TestBruteForceProtection(t *testing.T) {
    // Attempt 5 failed logins
    // Verify account locked for 15 minutes
    // Verify valid credentials rejected during lockout
    // Verify lockout expires correctly
}
```

**Secret Exposure** (`tests/security/secret_exposure_test.go`):
```go
func TestSecretRedaction(t *testing.T) {
    // Create API key
    // List API keys
    // Verify plain key not in response
    // Verify only hash stored in database
}
```

---

### 7.4 Performance Tests

**Authentication Latency Benchmarks** (`tests/performance/auth_bench_test.go`):
```go
func BenchmarkJWTValidation(b *testing.B) {
    // Target: <5ms p99
    // Measure signature verification time
    // Measure Redis blacklist lookup time
}

func BenchmarkAPIKeyValidation(b *testing.B) {
    // Target: <2ms p99
    // Measure database lookup time
    // Measure hash computation time
}

func BenchmarkConcurrentAuth(b *testing.B) {
    // Target: 10,000+ concurrent requests
    // Simulate concurrent authentication
    // Measure throughput (req/sec)
}
```

**Load Testing** (using k6 or Locust):
```javascript
// k6 script: auth_load_test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  vus: 1000,              // 1000 virtual users
  duration: '5m',         // 5 minutes
  thresholds: {
    'http_req_duration': ['p(99)<10'], // 99% under 10ms
  },
};

export default function () {
  const token = __ENV.ACCESS_TOKEN;
  const res = http.get('https://authz-engine/v1/check', {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  check(res, { 'status is 200': (r) => r.status === 200 });
}
```

---

### 7.5 Test Coverage Targets

| Component | Unit Test Coverage | Integration Test Coverage |
|-----------|-------------------|---------------------------|
| JWT Token Issuance | 100% | 100% (end-to-end flow) |
| JWT Validation | 100% | 100% (middleware integration) |
| API Key Management | 100% | 100% (CRUD operations) |
| Rate Limiting | 100% | 90% (Redis integration) |
| Token Revocation | 100% | 100% (blacklist lookup) |
| Principal Extraction | 100% | 100% (context propagation) |
| **Overall Target** | **100%** | **95%+** |

---

## 8. Performance Targets

### 8.1 Latency Targets

| Operation | p50 | p95 | p99 | Measurement Method |
|-----------|-----|-----|-----|-------------------|
| JWT validation (signature + expiration) | <2ms | <5ms | <10ms | Middleware timing |
| Redis blacklist lookup | <0.5ms | <1ms | <2ms | Redis client metrics |
| API key hash + DB lookup | <1ms | <2ms | <5ms | Database query time |
| Token generation (signing) | <5ms | <8ms | <10ms | Cryptographic operation time |
| End-to-end auth request | <5ms | <8ms | <15ms | Total middleware latency |

### 8.2 Throughput Targets

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Concurrent authenticated requests | >10,000 req/sec | Load testing (k6) |
| Token issuance rate | >500 tokens/sec | Benchmark tests |
| API key validation rate | >5,000 validations/sec | Benchmark tests |
| Redis operations (blacklist) | >100,000 ops/sec | Redis INFO stats |
| PostgreSQL lookups | >10,000 queries/sec | Database metrics |

### 8.3 Resource Utilization

| Resource | Target | Acceptable Range |
|----------|--------|------------------|
| CPU usage (per request) | <1ms | 0.5-2ms |
| Memory per request | <1KB | 500B-2KB |
| Database connections | <100 | 50-200 |
| Redis connections | <50 | 20-100 |
| JWT token size | <2KB | 1-3KB |

---

## 9. Security Considerations

### 9.1 Secret Management

**RSA Private Keys**:
- **Storage**: AWS Secrets Manager / HashiCorp Vault
- **Rotation**: Every 90 days (automated)
- **Access Control**: Only auth service has read access
- **Backup**: Encrypted backups in S3 with versioning

**API Key Generation**:
- **Algorithm**: crypto/rand (256-bit entropy)
- **Format**: `ak_live_{base64url(32 bytes)}` (prefix for identification)
- **Storage**: SHA-256 hash only (NEVER plaintext)
- **Salt**: Per-key unique salt stored alongside hash

**Refresh Tokens**:
- **Generation**: crypto/rand (256-bit)
- **Storage**: SHA-256 hash in PostgreSQL
- **Single-use**: Invalidate on refresh (prevent replay)
- **Family tracking**: Detect token theft (revoke entire family)

---

### 9.2 Attack Mitigation

**Token Tampering**:
- **Protection**: RS256 signature validation on every request
- **Detection**: Invalid signature → immediate rejection
- **Audit**: Log all failed signature validations

**Token Replay**:
- **Protection**: Redis blacklist with TTL
- **Detection**: Check blacklist before validation
- **Mitigation**: Revoke tokens on suspicious activity

**Brute-Force Attacks**:
- **Rate Limiting**: 100 req/sec per IP (Cloudflare/nginx)
- **Account Lockout**: 5 failed attempts → 15-minute lockout
- **Exponential Backoff**: 1min, 5min, 15min, 1hr, 24hr
- **Alerting**: Notify security team on 10+ failed attempts

**Token Theft**:
- **Detection**: Multiple concurrent sessions from different IPs
- **Mitigation**: Refresh token family revocation
- **Monitoring**: Track unusual access patterns (ML-based)

**SQL Injection**:
- **Protection**: Parameterized queries (sqlx library)
- **Validation**: Input sanitization on all user-provided data
- **Testing**: Automated SQL injection tests in CI/CD

---

### 9.3 Compliance Requirements

**SOC2**:
- **Access Logging**: All authentication events logged with timestamp, IP, user agent
- **Encryption**: TLS 1.3 in transit, AES-256-GCM at rest
- **Key Rotation**: Automated every 90 days
- **Audit Trail**: Immutable logs (append-only)

**GDPR**:
- **Data Minimization**: Only store necessary fields (no PII in JWT)
- **Right to Deletion**: Purge user data on request
- **Encryption**: Personal data encrypted at rest
- **Consent**: Explicit consent for token issuance

**PCI-DSS** (if handling payments):
- **No Card Data in Tokens**: Never store credit card info in JWT
- **Secure Transmission**: TLS 1.3 only
- **Key Management**: PCI-compliant key storage

---

## 10. Deployment Strategy

### 10.1 Rollout Plan

**Phase 1: JWT-Only (Week 1)**
- Deploy authentication middleware to staging
- Enable JWT validation on `/v2/*` endpoints (new versioned API)
- Keep `/v1/*` endpoints unauthenticated (backward compatibility)
- Monitor latency and error rates
- No breaking changes for existing clients

**Phase 2: API Keys + OAuth2 (Week 2)**
- Enable API key authentication
- Add OAuth2 client credentials flow
- Migrate internal services to use API keys
- Document migration guide for clients

**Phase 3: Enforce Authentication (Week 3)**
- Require authentication on `/v1/*` endpoints
- Deprecation notice: 30-day sunset for unauthenticated access
- Rate limit unauthenticated endpoints (100 req/day)
- Monitor client adoption

---

### 10.2 Feature Flags

```yaml
# Feature flags (managed by LaunchDarkly / environment variables)
features:
  authentication:
    jwt_enabled: true
    api_key_enabled: true
    oauth2_enabled: false  # Enable in Phase 2
    enforce_on_v1: false   # Enable in Phase 3
  rate_limiting:
    enabled: true
    per_key_limits: true
  revocation:
    enabled: true
    redis_blacklist: true
```

**Rollback Procedure**:
1. Set `authentication.jwt_enabled = false`
2. Restart service (no downtime, graceful shutdown)
3. Monitor for 5 minutes
4. Verify unauthenticated access works
5. Investigate root cause

---

### 10.3 Database Migrations

**Migration Strategy**:
- Use `golang-migrate` library
- Migrations in `migrations/` directory
- Version-controlled SQL files
- Automated in CI/CD pipeline

**Migration 006: API Keys**:
```sql
-- migrations/006_create_api_keys.up.sql
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255),
    agent_id VARCHAR(255) NOT NULL,
    scopes TEXT[],
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP,
    last_used_at TIMESTAMP,
    revoked_at TIMESTAMP,
    rate_limit_rps INTEGER DEFAULT 100,
    metadata JSONB
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_agent ON api_keys(agent_id);
CREATE INDEX idx_api_keys_active ON api_keys(revoked_at) WHERE revoked_at IS NULL;

-- migrations/006_create_api_keys.down.sql
DROP TABLE IF EXISTS api_keys;
```

**Rollback Testing**:
- Test both `.up.sql` and `.down.sql` migrations in staging
- Verify data integrity after rollback
- Document rollback procedure in runbook

---

### 10.4 Monitoring & Alerts

**Metrics** (Prometheus):
```yaml
# Authentication metrics
authz_auth_attempts_total{method="jwt|apikey|oauth", status="success|failure"}
authz_auth_latency_seconds{method="jwt|apikey|oauth", quantile="0.5|0.95|0.99"}
authz_token_validations_total{result="valid|expired|revoked|invalid"}
authz_api_key_usage_total{key_id="...", status="success|rate_limited"}
authz_token_revocations_total{type="access|refresh"}
authz_rate_limit_exceeded_total{key_type="apikey|ip"}
authz_brute_force_attempts_total{agent_id="..."}

# Redis metrics
authz_redis_blacklist_size
authz_redis_latency_seconds{operation="get|set|del"}
```

**Alerts** (PagerDuty / Opsgenie):
```yaml
alerts:
  - name: HighAuthFailureRate
    condition: authz_auth_attempts_total{status="failure"} / authz_auth_attempts_total > 0.1
    severity: P1
    message: "Auth failure rate >10%"

  - name: AuthLatencyHigh
    condition: authz_auth_latency_seconds{quantile="0.99"} > 0.1
    severity: P1
    message: "p99 auth latency >100ms"

  - name: RedisBlacklistUnavailable
    condition: up{job="redis-blacklist"} == 0
    severity: P0
    message: "Redis blacklist down - token revocation broken"

  - name: BruteForceDetected
    condition: rate(authz_brute_force_attempts_total[5m]) > 10
    severity: P2
    message: "Brute-force attack detected"
```

**Dashboards** (Grafana):
- Authentication success/failure rates (pie chart)
- Auth latency percentiles (line graph)
- Token issuance rate (counter)
- API key usage by key_id (bar chart)
- Redis blacklist size (gauge)
- Rate limit violations (heatmap)

---

## 11. Dependencies & Prerequisites

### 11.1 Required Dependencies

| Dependency | Version | Purpose | Installation |
|------------|---------|---------|--------------|
| `golang-jwt/jwt/v5` | v5.0.0+ | JWT signing/validation | `go get github.com/golang-jwt/jwt/v5` |
| `go-redis/redis/v9` | v9.0.0+ | Redis client (blacklist, rate limiting) | `go get github.com/redis/go-redis/v9` |
| `lib/pq` | v1.10.0+ | PostgreSQL driver | `go get github.com/lib/pq` |
| `golang-migrate/migrate` | v4.15.0+ | Database migrations | `go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest` |
| `crypto/rand` | stdlib | Secure random generation | (included in Go) |
| `crypto/sha256` | stdlib | API key hashing | (included in Go) |

### 11.2 Infrastructure Requirements

**PostgreSQL**:
- **Version**: 14.0+
- **Configuration**:
  - `max_connections = 200`
  - `shared_buffers = 256MB`
- **Backup**: Daily automated backups (AWS RDS snapshots)
- **Replication**: Multi-AZ for high availability

**Redis**:
- **Version**: 7.0+
- **Mode**: Cluster mode (3 nodes minimum)
- **Configuration**:
  - `maxmemory-policy = allkeys-lru`
  - `maxmemory = 2GB`
- **Persistence**: RDB snapshots every 5 minutes
- **Replication**: 2 replicas for read scaling

**AWS Secrets Manager** (or HashiCorp Vault):
- **Purpose**: Store RSA private keys
- **Rotation**: Automated every 90 days
- **Access**: IAM role for auth service only

---

### 11.3 External Services (Optional)

**OAuth2 Provider** (for Week 3+):
- Auth0, Okta, or Google OAuth
- OIDC discovery endpoint
- Client credentials flow support

**Rate Limiting Service**:
- Cloudflare (Layer 7 DDoS protection)
- AWS WAF (IP-based rate limiting)

---

## 12. Risks & Mitigations

### 12.1 Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **JWT library vulnerability** | High | Low | Pin version, monitor CVEs, automated dependency scanning |
| **Private key leak** | Critical | Very Low | Vault storage, rotation every 90 days, audit access logs |
| **Performance regression** | Medium | Medium | Load testing, gradual rollout, feature flags for rollback |
| **Redis outage** | High | Low | Fallback to allow-by-default (log warnings), Redis clustering |
| **Database connection pool exhaustion** | Medium | Medium | Connection pooling (max 100), circuit breaker, auto-scaling |

---

### 12.2 Security Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Token theft** | High | Medium | Short TTL (1 hour), refresh token rotation, monitor IP changes |
| **Brute-force attacks** | Medium | High | Rate limiting, account lockout, Cloudflare WAF |
| **SQL injection** | Critical | Low | Parameterized queries, input validation, automated testing |
| **Timing attacks** | Low | Medium | Constant-time comparison (bcrypt), rate limiting |

---

### 12.3 Operational Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Key rotation downtime** | Medium | Low | Blue-green key deployment (dual-key validation), automation |
| **Migration failure** | High | Low | Test migrations in staging, rollback scripts, backup before migration |
| **Monitoring blind spots** | Medium | Medium | Comprehensive metrics, alerting, runbook documentation |

---

## 13. Acceptance Criteria

### 13.1 Functional Acceptance

- [ ] JWT authentication working (RS256 signature validation)
- [ ] API key management APIs complete (create, list, revoke)
- [ ] OAuth2 client credentials flow working
- [ ] Token refresh flow working
- [ ] Token revocation functional (Redis blacklist)
- [ ] Multi-tenant isolation enforced (tenant_id claim)
- [ ] Rate limiting per API key working
- [ ] Brute-force protection active (5 attempts → lockout)

### 13.2 Performance Acceptance

- [ ] JWT validation latency <10ms p99
- [ ] API key lookup latency <5ms p99
- [ ] Token generation latency <10ms p99
- [ ] Support 10,000+ concurrent authenticated requests
- [ ] Redis blacklist lookup <2ms p99

### 13.3 Security Acceptance

- [ ] 100% test coverage for auth logic
- [ ] Security audit passed (no P0/P1 vulnerabilities)
- [ ] Private keys stored encrypted (Vault/Secrets Manager)
- [ ] API keys hashed with SHA-256 (never plaintext)
- [ ] Audit logging for all auth events (success/failure)
- [ ] SOC2/GDPR compliance verified

### 13.4 Operational Acceptance

- [ ] Documentation complete (API docs, deployment guide, runbook)
- [ ] Metrics and alerts configured (Prometheus + PagerDuty)
- [ ] Database migrations tested (up and down)
- [ ] Rollback procedure documented and tested
- [ ] Production deployment successful (zero downtime)
- [ ] Key rotation procedure tested

---

## 14. Documentation Deliverables

### 14.1 Technical Documentation

1. **API Documentation** (`docs/API_AUTHENTICATION.md`)
   - All authentication endpoints (request/response examples)
   - Error codes and troubleshooting
   - Authentication flow diagrams

2. **Deployment Guide** (`docs/DEPLOYMENT_AUTHENTICATION.md`)
   - Database migration steps
   - Redis setup instructions
   - AWS Secrets Manager configuration
   - Environment variables reference

3. **Runbook** (`docs/RUNBOOK_AUTHENTICATION.md`)
   - Common issues and resolutions
   - Rollback procedures
   - Key rotation steps
   - Monitoring and alerting guide

4. **Security Guide** (`docs/SECURITY_AUTHENTICATION.md`)
   - Threat model
   - Attack mitigation strategies
   - Compliance checklist (SOC2, GDPR)
   - Incident response procedures

---

## 15. Appendices

### Appendix A: JWT Claims Reference

```json
{
  "sub": "agent:service-123",         // Subject (Agent ID)
  "iss": "authz-engine",               // Issuer
  "aud": "authz-api",                  // Audience
  "exp": 1735257600,                   // Expiration (Unix timestamp)
  "iat": 1735171200,                   // Issued At (Unix timestamp)
  "jti": "token-uuid-123",             // JWT ID (for revocation)
  "roles": ["admin", "policy:write"],  // Principal roles
  "tenant_id": "tenant-abc",           // Multi-tenancy
  "scopes": ["read:*", "write:policies"] // OAuth2 scopes
}
```

### Appendix B: API Key Format

```
ak_live_abcdefghijklmnopqrstuvwxyz123456
│   │    │
│   │    └─ Base64URL-encoded 32 random bytes (256-bit)
│   └────── Environment (live, test)
└────────── Prefix (api key)
```

### Appendix C: Rate Limiting Algorithm

**Token Bucket Algorithm**:
```
Bucket capacity: rate_limit_rps (e.g., 100)
Refill rate: 1 token per 1/rate_limit_rps seconds
Redis key: ratelimit:apikey:{key_id}:{window}
TTL: 60 seconds (sliding window)

Algorithm:
1. Get current token count from Redis
2. Calculate tokens to add based on elapsed time
3. Add tokens up to capacity
4. If tokens available, decrement and allow request
5. Else, reject with 429 Too Many Requests
```

### Appendix D: Key Rotation Procedure

**Blue-Green Key Rotation**:
```
Step 1: Generate new RSA key pair (green key)
Step 2: Upload green private key to Vault
Step 3: Deploy green public key to validators
Step 4: Start issuing tokens with green key
Step 5: Wait 1 hour (old tokens expire)
Step 6: Remove blue public key from validators
Step 7: Archive blue private key (compliance)
```

---

## Document Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Security Lead | TBD | | |
| Backend Lead | TBD | | |
| DevOps Lead | TBD | | |
| Product Owner | TBD | | |

---

**Change Log**:

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-26 | System Architect | Initial version |

---

**Related Documents**:
- `/Users/tommaduri/Documents/GitHub/authz-engine/go-core/docs/PHASE5-10-PRODUCTION-ROADMAP.md`
- `/Users/tommaduri/Documents/GitHub/authz-engine/go-core/docs/IMPLEMENTATION_VALIDATION_REPORT.md`
- `/Users/tommaduri/Documents/GitHub/authz-engine/go-core/internal/api/handlers/agent_handler.go`

---

**END OF DOCUMENT**
