# Phase 6 Authentication Implementation Architecture

**Document Version**: 1.0
**Date**: 2025-11-26
**Status**: READY FOR IMPLEMENTATION
**Based on**: PHASE6_WEEK1-2_AUTHENTICATION_SDD.md
**Target**: 2 weeks (9.5-12 days)

---

## Executive Summary

This document provides the detailed implementation architecture for Phase 6 authentication system, breaking down the SDD into actionable development tasks with clear acceptance criteria, dependency management, and risk mitigation strategies.

### Key Findings from Analysis

**Existing Infrastructure (Phase 5 ✅)**:
- Agent identity system (`pkg/types/agent.go`)
- Basic JWT generation in handlers (`internal/api/handlers/agent_handler.go`)
- JWT validation foundation (`internal/auth/jwt.go`, `jwks.go`, `claims.go`)
- Agent-to-Principal mapping (`Agent.ToPrincipal()`)

**Gap Analysis**:
- ❌ No middleware layer for authentication
- ❌ No API key management system
- ❌ No token revocation/blacklist (Redis)
- ❌ No refresh token mechanism
- ❌ No rate limiting infrastructure
- ❌ No PostgreSQL schema for credentials
- ❌ No OAuth2 client credentials flow
- ❌ JWT issuer incomplete (only HS256 in handlers)

---

## Table of Contents

1. [Component Architecture](#1-component-architecture)
2. [File Structure](#2-file-structure)
3. [Interface Definitions](#3-interface-definitions)
4. [Dependency Injection Strategy](#4-dependency-injection-strategy)
5. [Integration Points](#5-integration-points)
6. [Task Breakdown](#6-task-breakdown)
7. [Critical Path Analysis](#7-critical-path-analysis)
8. [Risk Assessment](#8-risk-assessment)
9. [Testing Strategy](#9-testing-strategy)
10. [Deployment Plan](#10-deployment-plan)

---

## 1. Component Architecture

### 1.1 High-Level Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                    AUTHENTICATION LAYER (Phase 6)                  │
└────────────────────────────────────────────────────────────────────┘

                           HTTP Request
                                 │
                                 ▼
              ┌─────────────────────────────────────┐
              │   AuthMiddleware (Gin)              │
              │   - ExtractCredentials()            │
              │   - RouteToValidator()              │
              │   - SetPrincipalContext()           │
              └─────────────────┬───────────────────┘
                                │
                 ┌──────────────┴──────────────┐
                 │                             │
      ┌──────────▼─────────┐       ┌──────────▼──────────┐
      │  JWTValidator      │       │  APIKeyValidator    │
      │  ─────────────     │       │  ───────────────    │
      │  • Validate()      │       │  • Validate()       │
      │  • IsRevoked()     │       │  • HashKey()        │
      │  • ExtractClaims() │       │  • CheckRateLimit() │
      └──────────┬─────────┘       └──────────┬──────────┘
                 │                             │
                 │    ┌──────────────────┐     │
                 └────▶  Redis Blacklist ◀─────┘
                      │  Rate Limiter    │
                      └──────────────────┘
                                │
              ┌─────────────────▼─────────────────┐
              │   PrincipalExtractor              │
              │   - MapToAgentID()                │
              │   - ExtractRoles()                │
              │   - SetTenantContext()            │
              └─────────────────┬─────────────────┘
                                │
              ┌─────────────────▼─────────────────┐
              │   EXISTING: Agent Store (Phase 5) │
              │   pkg/types/agent.go              │
              │   Agent.ToPrincipal()             │
              └─────────────────┬─────────────────┘
                                │
              ┌─────────────────▼─────────────────┐
              │   EXISTING: DecisionEngine        │
              │   internal/engine/engine.go       │
              │   Check(CheckRequest)             │
              └───────────────────────────────────┘


┌────────────────────────────────────────────────────────────────────┐
│                      DATA LAYER (New Components)                   │
└────────────────────────────────────────────────────────────────────┘

     ┌─────────────────┐       ┌──────────────────┐
     │  PostgreSQL     │       │  Redis           │
     │  ─────────────  │       │  ───────────     │
     │  • api_keys     │       │  • blacklist:*   │
     │  • refresh_tokens│      │  • ratelimit:*   │
     │  • agents       │       │  • tokeninfo:*   │
     └─────────────────┘       └──────────────────┘


┌────────────────────────────────────────────────────────────────────┐
│                    TOKEN ISSUANCE FLOW                             │
└────────────────────────────────────────────────────────────────────┘

   Client Request                    POST /v1/auth/token
        │                            (client_id, client_secret)
        │
        ▼
   ┌────────────────────┐
   │  AuthHandler       │
   │  ──────────────    │
   │  • TokenEndpoint() │──────┐
   └────────────────────┘      │
                                │
                                ▼
                    ┌───────────────────────┐
                    │  CredentialValidator  │
                    │  (bcrypt password)    │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   TokenIssuer         │
                    │   ────────────        │
                    │   • IssueToken()      │
                    │   • SignJWT(RS256)    │
                    │   • GenerateRefresh() │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │  RefreshTokenStore    │
                    │  (PostgreSQL)         │
                    └───────────────────────┘
```

### 1.2 Component Breakdown

#### 1.2.1 Authentication Middleware (`internal/auth/middleware.go`)
**Purpose**: Intercept all HTTP/gRPC requests and enforce authentication

**Responsibilities**:
- Extract credentials from headers (Bearer token, X-API-Key)
- Route to appropriate validator
- Handle authentication failures (401 responses)
- Set authenticated Principal in request context
- Emit authentication metrics (latency, success/failure)

**Dependencies**:
- `JWTValidator`
- `APIKeyValidator`
- `AuditLogger` (existing)
- `Metrics` (Prometheus)

**Interfaces**:
```go
type Authenticator interface {
    Authenticate(ctx context.Context, credentials string) (*types.Principal, error)
}

type Middleware interface {
    HTTPMiddleware() gin.HandlerFunc
    GRPCInterceptor() grpc.UnaryServerInterceptor
}
```

---

#### 1.2.2 JWT Validator (`internal/auth/jwt_validator.go`)
**Purpose**: Validate JWT tokens (RS256/HS256)

**Status**: ✅ **Partially Implemented** (`internal/auth/jwt.go`)

**Enhancements Needed**:
- ✅ Already has: Signature validation, expiration check, JWKS support
- ❌ Missing: Redis blacklist integration
- ❌ Missing: Principal extraction from custom claims (`tenant_id`, `scopes`)
- ❌ Missing: Integration with Agent system

**Dependencies**:
- `golang-jwt/jwt/v5` (✅ already imported)
- `RedisBlacklist` (new)
- `Agent Store` (existing)

---

#### 1.2.3 Token Issuer (`internal/auth/token_issuer.go`)
**Purpose**: Generate and sign JWT access/refresh tokens

**Status**: ❌ **Not Implemented** (basic JWT in handler, needs extraction)

**Responsibilities**:
- Sign JWT with RSA private key (RS256)
- Generate refresh tokens (256-bit random)
- Store refresh tokens in PostgreSQL
- Set appropriate claims (sub, roles, tenant_id, scopes, exp)

**Dependencies**:
- RSA key loader (Vault/Secrets Manager)
- `RefreshTokenStore` (PostgreSQL)
- `crypto/rand` for secure random generation

---

#### 1.2.4 API Key Validator (`internal/auth/apikey_validator.go`)
**Purpose**: Validate API keys and enforce rate limits

**Status**: ❌ **Not Implemented**

**Responsibilities**:
- Hash incoming API key (SHA-256)
- Lookup in PostgreSQL
- Check expiration and revocation
- Enforce per-key rate limits
- Update `last_used_at` timestamp

**Dependencies**:
- `APIKeyStore` (PostgreSQL)
- `RateLimiter` (Redis)

---

#### 1.2.5 Rate Limiter (`internal/auth/rate_limiter.go`)
**Purpose**: Token bucket rate limiting per API key/IP

**Status**: ❌ **Not Implemented**

**Algorithm**: Token Bucket
- Per-key rate limiting (configurable RPS)
- Redis-backed counters
- Sliding window implementation
- Burst allowance support

**Dependencies**:
- `go-redis/redis/v9` (✅ already in go.mod)

---

#### 1.2.6 Redis Blacklist (`internal/auth/blacklist.go`)
**Purpose**: Token revocation tracking

**Status**: ❌ **Not Implemented**

**Schema**:
```
Key: blacklist:jwt:{jti}
Value: "revoked"
TTL: Token expiry time (hours)
```

**Operations**:
- `Add(jti, ttl)` - Revoke token
- `IsRevoked(jti) bool` - Check revocation
- `Remove(jti)` - Manual removal (admin)

---

#### 1.2.7 Principal Extractor (`internal/auth/principal.go`)
**Purpose**: Map authenticated credentials to Principal object

**Status**: ✅ **Partially Exists** (`types.Agent.ToPrincipal()`)

**Enhancements Needed**:
- Extract from JWT claims (sub, roles, tenant_id, scopes)
- Extract from API key metadata
- Handle multi-tenancy context
- Merge with existing Agent.ToPrincipal()

---

#### 1.2.8 Credential Store (`internal/auth/credential_store.go`)
**Purpose**: Manage agent credentials (password hashes, API keys)

**Status**: ❌ **Not Implemented**

**Responsibilities**:
- Store/retrieve bcrypt password hashes
- Validate credentials during token issuance
- Track failed login attempts
- Implement account lockout (5 attempts → 15 min)

---

## 2. File Structure

### 2.1 New Files (Phase 6)

```
internal/auth/
├── .claude-flow/          # Existing (swarm coordination)
├── claims.go              # ✅ Existing (needs enhancement for tenant_id, scopes)
├── config.go              # ✅ Existing (JWT config)
├── jwt.go                 # ✅ Existing (JWT validator foundation)
├── jwks.go                # ✅ Existing (JWKS provider)
├── jwt_test.go            # ✅ Existing (tests)
│
├── middleware.go          # ❌ NEW: HTTP/gRPC authentication middleware
├── middleware_test.go     # ❌ NEW: Middleware tests
│
├── token_issuer.go        # ❌ NEW: JWT/refresh token issuance
├── token_issuer_test.go   # ❌ NEW: Issuer tests
│
├── apikey_validator.go    # ❌ NEW: API key validation
├── apikey_validator_test.go # ❌ NEW: API key tests
│
├── apikey_store.go        # ❌ NEW: PostgreSQL API key CRUD
├── apikey_store_test.go   # ❌ NEW: Store tests
│
├── rate_limiter.go        # ❌ NEW: Token bucket rate limiting
├── rate_limiter_test.go   # ❌ NEW: Rate limiter tests
│
├── blacklist.go           # ❌ NEW: Redis token blacklist
├── blacklist_test.go      # ❌ NEW: Blacklist tests
│
├── principal.go           # ❌ NEW: Principal extraction from credentials
├── principal_test.go      # ❌ NEW: Principal tests
│
├── credential_store.go    # ❌ NEW: Agent credential storage (PostgreSQL)
├── credential_store_test.go # ❌ NEW: Credential tests
│
├── refresh_store.go       # ❌ NEW: Refresh token storage (PostgreSQL)
├── refresh_store_test.go  # ❌ NEW: Refresh token tests
│
└── keys.go                # ❌ NEW: RSA key loading from Vault/Secrets Manager
    └── keys_test.go       # ❌ NEW: Key loading tests

internal/api/handlers/
├── agent_handler.go       # ✅ Existing (needs OAuth2 endpoints)
├── auth_handler.go        # ❌ NEW: Token/API key management endpoints
└── auth_handler_test.go   # ❌ NEW: Auth handler tests

migrations/
├── 006_create_api_keys.up.sql      # ❌ NEW: API keys table
├── 006_create_api_keys.down.sql    # ❌ NEW: Rollback script
├── 007_create_refresh_tokens.up.sql # ❌ NEW: Refresh tokens table
├── 007_create_refresh_tokens.down.sql # ❌ NEW: Rollback script
├── 008_alter_agents_credentials.up.sql # ❌ NEW: Add password fields to agents
└── 008_alter_agents_credentials.down.sql # ❌ NEW: Rollback script

tests/integration/
├── auth_flow_test.go      # ❌ NEW: End-to-end auth flows
├── jwt_auth_test.go       # ❌ NEW: JWT authentication E2E
├── apikey_auth_test.go    # ❌ NEW: API key authentication E2E
└── rate_limiting_test.go  # ❌ NEW: Rate limiting integration

tests/security/
├── token_tampering_test.go # ❌ NEW: Security tests
├── brute_force_test.go    # ❌ NEW: Brute-force protection
└── secret_exposure_test.go # ❌ NEW: Secret redaction tests

tests/performance/
├── auth_bench_test.go     # ❌ NEW: Authentication benchmarks
└── load_test.js           # ❌ NEW: k6 load testing script
```

### 2.2 File Size Estimates

| File | LOC | Complexity | Test Coverage Target |
|------|-----|------------|---------------------|
| `middleware.go` | 200 | Medium | 100% |
| `token_issuer.go` | 250 | High | 100% |
| `apikey_validator.go` | 150 | Medium | 100% |
| `apikey_store.go` | 200 | Medium | 100% |
| `rate_limiter.go` | 150 | High | 100% |
| `blacklist.go` | 100 | Low | 100% |
| `principal.go` | 100 | Low | 100% |
| `credential_store.go` | 200 | Medium | 100% |
| `refresh_store.go` | 150 | Medium | 100% |
| `keys.go` | 150 | High | 90% (external deps) |
| `auth_handler.go` | 400 | High | 100% |
| **Total New Code** | **~2,050 LOC** | | **100% avg** |

---

## 3. Interface Definitions

### 3.1 Core Interfaces

```go
// Package auth provides authentication interfaces and implementations
package auth

import (
	"context"
	"time"

	"github.com/authz-engine/go-core/pkg/types"
)

// ============================================================================
// AUTHENTICATOR INTERFACES
// ============================================================================

// Authenticator validates credentials and returns a Principal
type Authenticator interface {
	// Authenticate validates credentials and returns a Principal
	// Returns error if authentication fails
	Authenticate(ctx context.Context, credentials string) (*types.Principal, error)
}

// TokenValidator validates bearer tokens (JWT)
type TokenValidator interface {
	Authenticator

	// Validate validates a JWT token string and returns claims
	Validate(tokenString string) (*Claims, error)

	// IsRevoked checks if a token JTI is revoked
	IsRevoked(jti string) (bool, error)

	// ExtractPrincipal converts JWT claims to a Principal
	ExtractPrincipal(claims *Claims) (*types.Principal, error)
}

// APIKeyValidator validates API keys
type APIKeyValidator interface {
	Authenticator

	// Validate validates an API key and returns the associated record
	Validate(ctx context.Context, apiKey string) (*APIKeyRecord, error)

	// CheckRateLimit checks if the API key has exceeded rate limits
	CheckRateLimit(ctx context.Context, keyID string) error

	// UpdateLastUsed updates the last_used_at timestamp
	UpdateLastUsed(ctx context.Context, keyID string) error
}

// ============================================================================
// TOKEN ISSUANCE
// ============================================================================

// TokenIssuer generates and signs JWT tokens
type TokenIssuer interface {
	// IssueToken generates an access and refresh token for an agent
	IssueToken(ctx context.Context, agentID string, req *TokenRequest) (*TokenPair, error)

	// RefreshToken generates a new access token from a refresh token
	RefreshToken(ctx context.Context, refreshToken string) (*TokenPair, error)

	// RevokeToken revokes an access token by adding it to the blacklist
	RevokeToken(ctx context.Context, jti string, ttl time.Duration) error

	// RevokeRefreshToken revokes a refresh token
	RevokeRefreshToken(ctx context.Context, refreshToken string) error
}

// TokenRequest contains parameters for token issuance
type TokenRequest struct {
	Roles      []string               // Principal roles
	TenantID   string                 // Multi-tenancy identifier
	Scopes     []string               // OAuth2 scopes
	Metadata   map[string]interface{} // Additional metadata
	AccessTTL  time.Duration          // Access token TTL (default: 1 hour)
	RefreshTTL time.Duration          // Refresh token TTL (default: 7 days)
}

// TokenPair contains access and refresh tokens
type TokenPair struct {
	AccessToken  string    `json:"access_token"`
	TokenType    string    `json:"token_type"`    // "Bearer"
	ExpiresIn    int       `json:"expires_in"`    // Seconds
	RefreshToken string    `json:"refresh_token"`
	Scope        string    `json:"scope"`         // Space-separated scopes
	IssuedAt     time.Time `json:"issued_at"`
}

// ============================================================================
// STORAGE INTERFACES
// ============================================================================

// APIKeyStore manages API key persistence
type APIKeyStore interface {
	// Create generates and stores a new API key
	Create(ctx context.Context, req *CreateAPIKeyRequest) (*APIKey, error)

	// Get retrieves an API key by ID
	Get(ctx context.Context, id string) (*APIKeyRecord, error)

	// GetByHash retrieves an API key by its hash
	GetByHash(ctx context.Context, hash string) (*APIKeyRecord, error)

	// List retrieves all API keys for an agent
	List(ctx context.Context, agentID string) ([]*APIKeyRecord, error)

	// Revoke revokes an API key
	Revoke(ctx context.Context, id string) error

	// Delete permanently deletes an API key
	Delete(ctx context.Context, id string) error
}

// CreateAPIKeyRequest contains parameters for API key creation
type CreateAPIKeyRequest struct {
	Name         string    `json:"name"`
	AgentID      string    `json:"agent_id"`
	Scopes       []string  `json:"scopes"`
	ExpiresAt    time.Time `json:"expires_at,omitempty"`
	RateLimitRPS int       `json:"rate_limit_rps"` // Default: 100
}

// APIKey contains the plaintext API key (ONLY returned on creation)
type APIKey struct {
	ID        string    `json:"id"`
	Key       string    `json:"key"`        // Plaintext (only on creation!)
	Name      string    `json:"name"`
	AgentID   string    `json:"agent_id"`
	Scopes    []string  `json:"scopes"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at,omitempty"`
}

// APIKeyRecord represents a stored API key (with hashed value)
type APIKeyRecord struct {
	ID           string                 `json:"id"`
	KeyHash      string                 `json:"key_hash"`      // SHA-256 hash
	Name         string                 `json:"name"`
	AgentID      string                 `json:"agent_id"`
	Scopes       []string               `json:"scopes"`
	CreatedAt    time.Time              `json:"created_at"`
	ExpiresAt    *time.Time             `json:"expires_at,omitempty"`
	LastUsedAt   *time.Time             `json:"last_used_at,omitempty"`
	RevokedAt    *time.Time             `json:"revoked_at,omitempty"`
	RateLimitRPS int                    `json:"rate_limit_rps"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"`
}

// RefreshTokenStore manages refresh token persistence
type RefreshTokenStore interface {
	// Store stores a refresh token
	Store(ctx context.Context, token *RefreshToken) error

	// Get retrieves a refresh token by its hash
	Get(ctx context.Context, tokenHash string) (*RefreshToken, error)

	// Revoke revokes a refresh token
	Revoke(ctx context.Context, tokenHash string) error

	// DeleteExpired deletes expired refresh tokens
	DeleteExpired(ctx context.Context) error
}

// RefreshToken represents a stored refresh token
type RefreshToken struct {
	ID             string    `json:"id"`
	TokenHash      string    `json:"token_hash"`       // SHA-256 hash
	AgentID        string    `json:"agent_id"`
	AccessTokenJTI string    `json:"access_token_jti"` // Linked access token
	CreatedAt      time.Time `json:"created_at"`
	ExpiresAt      time.Time `json:"expires_at"`
	RevokedAt      *time.Time `json:"revoked_at,omitempty"`
	LastUsedAt     *time.Time `json:"last_used_at,omitempty"`
}

// ============================================================================
// RATE LIMITING
// ============================================================================

// RateLimiter enforces rate limits
type RateLimiter interface {
	// Allow checks if a request is allowed within the rate limit
	// Returns true if allowed, false if rate limited
	Allow(ctx context.Context, key string, limit int) (bool, error)

	// GetLimit retrieves the rate limit for a key
	GetLimit(ctx context.Context, key string) (int, error)

	// IncrementCounter increments the counter for a key
	IncrementCounter(ctx context.Context, key string) error
}

// ============================================================================
// REVOCATION
// ============================================================================

// Blacklist manages token revocation
type Blacklist interface {
	// Add adds a token to the blacklist
	Add(ctx context.Context, jti string, ttl time.Duration) error

	// IsBlacklisted checks if a token is blacklisted
	IsBlacklisted(ctx context.Context, jti string) (bool, error)

	// Remove removes a token from the blacklist (admin)
	Remove(ctx context.Context, jti string) error
}

// ============================================================================
// PRINCIPAL EXTRACTION
// ============================================================================

// PrincipalExtractor extracts Principal from authentication credentials
type PrincipalExtractor interface {
	// FromJWT extracts Principal from JWT claims
	FromJWT(ctx context.Context, claims *Claims) (*types.Principal, error)

	// FromAPIKey extracts Principal from API key record
	FromAPIKey(ctx context.Context, record *APIKeyRecord) (*types.Principal, error)
}
```

### 3.2 Enhanced Claims Structure

```go
// Claims represents JWT claims with Phase 6 enhancements
type Claims struct {
	jwt.RegisteredClaims // iss, sub, aud, exp, iat, jti

	// Phase 6 custom claims (align with SDD)
	Roles    []string `json:"roles,omitempty"`     // Principal roles
	TenantID string   `json:"tenant_id,omitempty"` // Multi-tenancy
	Scopes   []string `json:"scopes,omitempty"`    // OAuth2 scopes

	// Legacy claims (backward compatibility)
	UserID   string `json:"user_id,omitempty"`
	Username string `json:"username,omitempty"`
	Email    string `json:"email,omitempty"`
	Scope    string `json:"scope,omitempty"` // Deprecated: use Scopes
}
```

---

## 4. Dependency Injection Strategy

### 4.1 Service Container

```go
// Package server provides the HTTP/gRPC server setup
package server

import (
	"github.com/authz-engine/go-core/internal/auth"
	"github.com/authz-engine/go-core/internal/engine"
	"github.com/redis/go-redis/v9"
	"database/sql"
)

// AuthServices contains all authentication-related services
type AuthServices struct {
	// Validators
	JWTValidator    auth.TokenValidator
	APIKeyValidator auth.APIKeyValidator

	// Issuance
	TokenIssuer auth.TokenIssuer

	// Storage
	APIKeyStore       auth.APIKeyStore
	RefreshTokenStore auth.RefreshTokenStore

	// Infrastructure
	RateLimiter auth.RateLimiter
	Blacklist   auth.Blacklist

	// Extraction
	PrincipalExtractor auth.PrincipalExtractor

	// Middleware
	AuthMiddleware *auth.Middleware
}

// NewAuthServices initializes all authentication services
func NewAuthServices(
	db *sql.DB,
	redisClient *redis.Client,
	jwtConfig *auth.JWTConfig,
	decisionEngine *engine.Engine,
) (*AuthServices, error) {
	// Create stores
	apiKeyStore := auth.NewPostgresAPIKeyStore(db)
	refreshStore := auth.NewPostgresRefreshTokenStore(db)

	// Create infrastructure
	rateLimiter := auth.NewRedisRateLimiter(redisClient)
	blacklist := auth.NewRedisBlacklist(redisClient)

	// Create validators
	jwtValidator, err := auth.NewJWTValidator(jwtConfig)
	if err != nil {
		return nil, err
	}
	jwtValidator.SetBlacklist(blacklist)

	apiKeyValidator := auth.NewAPIKeyValidator(apiKeyStore, rateLimiter)

	// Create token issuer
	tokenIssuer, err := auth.NewTokenIssuer(
		jwtConfig,
		refreshStore,
		blacklist,
	)
	if err != nil {
		return nil, err
	}

	// Create principal extractor
	principalExtractor := auth.NewPrincipalExtractor(decisionEngine.AgentStore)

	// Create middleware
	authMiddleware := auth.NewMiddleware(
		jwtValidator,
		apiKeyValidator,
		principalExtractor,
	)

	return &AuthServices{
		JWTValidator:       jwtValidator,
		APIKeyValidator:    apiKeyValidator,
		TokenIssuer:        tokenIssuer,
		APIKeyStore:        apiKeyStore,
		RefreshTokenStore:  refreshStore,
		RateLimiter:        rateLimiter,
		Blacklist:          blacklist,
		PrincipalExtractor: principalExtractor,
		AuthMiddleware:     authMiddleware,
	}, nil
}
```

### 4.2 Configuration Management

```go
// Config contains all authentication configuration
type AuthConfig struct {
	JWT struct {
		Issuer        string        `yaml:"issuer"`
		Audience      string        `yaml:"audience"`
		PublicKeyFile string        `yaml:"public_key_file"`
		PrivateKeyFile string       `yaml:"private_key_file"`
		JWKSUrl       string        `yaml:"jwks_url"`
		AccessTTL     time.Duration `yaml:"access_ttl"`
		RefreshTTL    time.Duration `yaml:"refresh_ttl"`
	} `yaml:"jwt"`

	APIKeys struct {
		DefaultRateLimitRPS int `yaml:"default_rate_limit_rps"`
		MaxExpiryDays       int `yaml:"max_expiry_days"`
	} `yaml:"api_keys"`

	RateLimiting struct {
		Enabled       bool `yaml:"enabled"`
		DefaultRPS    int  `yaml:"default_rps"`
		BurstMultiplier float64 `yaml:"burst_multiplier"`
	} `yaml:"rate_limiting"`

	Redis struct {
		Addr     string `yaml:"addr"`
		Password string `yaml:"password"`
		DB       int    `yaml:"db"`
	} `yaml:"redis"`

	Database struct {
		DSN string `yaml:"dsn"`
	} `yaml:"database"`
}
```

---

## 5. Integration Points

### 5.1 Existing Agent System Integration

**File**: `pkg/types/agent.go`

**Integration Strategy**:
1. **Extend** `Agent.ToPrincipal()` to include JWT claims mapping
2. **Add** credential validation in `internal/auth/credential_store.go`
3. **Reuse** Agent Store for Principal lookup

```go
// Enhanced ToPrincipal with JWT claim integration
func (a *Agent) ToPrincipalWithClaims(claims *auth.Claims) *Principal {
	principal := a.ToPrincipal() // Use existing logic

	// Merge JWT roles
	if len(claims.Roles) > 0 {
		principal.Roles = append(principal.Roles, claims.Roles...)
	}

	// Add tenant context
	if claims.TenantID != "" {
		principal.Attributes["tenant_id"] = claims.TenantID
	}

	// Add OAuth2 scopes
	if len(claims.Scopes) > 0 {
		principal.Attributes["scopes"] = claims.Scopes
	}

	return principal
}
```

### 5.2 Middleware Integration

**Gin HTTP Server** (`internal/server/http.go`):

```go
func SetupRoutes(router *gin.Engine, services *AuthServices) {
	// Public routes (no auth)
	router.GET("/health", healthHandler)

	// Protected routes (require authentication)
	v1 := router.Group("/v1")
	v1.Use(services.AuthMiddleware.HTTPMiddleware())
	{
		v1.POST("/check", checkHandler)
		v1.GET("/policies", listPoliciesHandler)
		v1.POST("/policies", createPolicyHandler)
	}

	// Admin routes (require admin role)
	admin := router.Group("/v1/admin")
	admin.Use(services.AuthMiddleware.HTTPMiddleware())
	admin.Use(services.AuthMiddleware.RequireRole("admin"))
	{
		admin.GET("/agents", listAgentsHandler)
		admin.POST("/agents", createAgentHandler)
	}

	// Authentication endpoints (public, but rate limited)
	auth := router.Group("/v1/auth")
	auth.Use(services.RateLimiter.Middleware(100)) // 100 req/sec
	{
		auth.POST("/token", services.TokenHandler.TokenEndpoint)
		auth.POST("/refresh", services.TokenHandler.RefreshEndpoint)
		auth.POST("/revoke", services.TokenHandler.RevokeEndpoint)

		// API key management (requires authentication)
		keys := auth.Group("/keys")
		keys.Use(services.AuthMiddleware.HTTPMiddleware())
		{
			keys.POST("", services.APIKeyHandler.CreateKey)
			keys.GET("", services.APIKeyHandler.ListKeys)
			keys.DELETE("/:id", services.APIKeyHandler.RevokeKey)
		}
	}
}
```

**gRPC Server** (`internal/server/grpc.go`):

```go
func NewGRPCServer(services *AuthServices) *grpc.Server {
	server := grpc.NewServer(
		grpc.UnaryInterceptor(services.AuthMiddleware.GRPCInterceptor()),
		grpc.StreamInterceptor(services.AuthMiddleware.GRPCStreamInterceptor()),
	)

	// Register services
	authzpb.RegisterAuthzServiceServer(server, &authzServiceImpl{})

	return server
}
```

### 5.3 Database Migration Integration

**Migration Tool**: `golang-migrate/migrate`

**Execution**:
```bash
# Apply migrations
migrate -path migrations -database "postgres://..." up

# Rollback
migrate -path migrations -database "postgres://..." down 1
```

**CI/CD Integration**:
- Run migrations automatically in staging
- Require manual approval for production
- Always test rollback scripts

---

## 6. Task Breakdown

### 6.1 Week 1: JWT Authentication Foundation (5 days)

#### Day 1: RSA Key Management & Enhanced JWT Claims (8 hours)

**Tasks**:
1. ✅ **SKIP**: JWT library already installed (`golang-jwt/jwt/v5`)
2. Create `internal/auth/keys.go` for RSA key loading
   - Support AWS Secrets Manager
   - Support local file loading (for dev/test)
   - Implement key rotation (dual-key validation)
3. Enhance `internal/auth/claims.go`
   - Add `TenantID` field
   - Add `Scopes` field (OAuth2)
   - Update `ExtractPrincipal()` method
4. Write unit tests for key loading (`keys_test.go`)

**Files Created**:
- `internal/auth/keys.go` (150 LOC)
- `internal/auth/keys_test.go` (100 LOC)

**Acceptance Criteria**:
- ✅ RSA key loaded from environment variable
- ✅ RSA key loaded from file path
- ✅ Dual-key validation working (old + new keys)
- ✅ 100% test coverage for key loading
- ✅ Enhanced Claims structure supports tenant_id and scopes

**Dependencies**: None

**Estimated Time**: 8 hours

---

#### Day 2: Token Issuer & OAuth2 Endpoint (8 hours)

**Tasks**:
1. Create `internal/auth/token_issuer.go`
   - Implement `TokenIssuer` interface
   - Sign JWT with RS256
   - Generate refresh tokens (crypto/rand)
   - Set appropriate claims (exp, jti, roles, tenant_id)
2. Create `internal/api/handlers/auth_handler.go`
   - Implement `POST /v1/auth/token` (OAuth2 client credentials)
   - Validate client_id/client_secret
   - Return access_token + refresh_token
3. Integrate with existing Agent system
   - Validate agent credentials
   - Call `Agent.ToPrincipal()` for role extraction
4. Write integration tests (`tests/integration/jwt_auth_test.go`)

**Files Created**:
- `internal/auth/token_issuer.go` (250 LOC)
- `internal/auth/token_issuer_test.go` (200 LOC)
- `internal/api/handlers/auth_handler.go` (400 LOC)
- `internal/api/handlers/auth_handler_test.go` (250 LOC)
- `tests/integration/jwt_auth_test.go` (200 LOC)

**Acceptance Criteria**:
- ✅ POST /v1/auth/token returns valid JWT
- ✅ JWT signed with RS256
- ✅ Refresh token generated and returned
- ✅ OAuth2 compliance (grant_type: client_credentials)
- ✅ Integration test: full token issuance flow

**Dependencies**: Day 1 complete

**Estimated Time**: 8 hours

---

#### Day 3: JWT Validation Middleware & Redis Blacklist (8 hours)

**Tasks**:
1. Create `internal/auth/blacklist.go`
   - Implement `Blacklist` interface
   - Redis-backed storage
   - TTL = token expiry time
2. Enhance `internal/auth/jwt.go` (existing)
   - Add `IsRevoked(jti)` method
   - Integrate with Redis blacklist
3. Create `internal/auth/middleware.go`
   - Implement `HTTPMiddleware()` (Gin)
   - Implement `GRPCInterceptor()` (gRPC)
   - Extract Bearer token from header
   - Call `JWTValidator.Validate()`
   - Set Principal in context
4. Write middleware tests

**Files Created**:
- `internal/auth/blacklist.go` (100 LOC)
- `internal/auth/blacklist_test.go` (80 LOC)
- `internal/auth/middleware.go` (200 LOC)
- `internal/auth/middleware_test.go` (250 LOC)

**Acceptance Criteria**:
- ✅ Redis blacklist stores revoked tokens
- ✅ JWT validation checks blacklist
- ✅ Middleware extracts and validates Bearer tokens
- ✅ gRPC interceptor works with metadata
- ✅ 401 returned for invalid/expired/revoked tokens
- ✅ Principal set in context for valid tokens

**Dependencies**: Day 2 complete, Redis running

**Estimated Time**: 8 hours

---

#### Day 4: Principal Extraction & Integration Testing (6 hours)

**Tasks**:
1. Create `internal/auth/principal.go`
   - Implement `PrincipalExtractor` interface
   - Map JWT claims → Principal
   - Map `sub` → Agent ID
   - Extract roles, tenant_id, scopes
2. Update `pkg/types/agent.go`
   - Add `ToPrincipalWithClaims(claims)` method
3. End-to-end integration testing
   - Test: Register agent → Issue token → Authenticate request
   - Test: Multi-tenant isolation (tenant_id claim)
   - Test: Role-based access control

**Files Created**:
- `internal/auth/principal.go` (100 LOC)
- `internal/auth/principal_test.go` (120 LOC)
- `tests/integration/auth_flow_test.go` (250 LOC)

**Acceptance Criteria**:
- ✅ JWT claims correctly mapped to Principal
- ✅ Agent.ToPrincipalWithClaims() merges JWT + Agent data
- ✅ Multi-tenancy enforced (tenant_id in context)
- ✅ End-to-end test: registration → token → authenticated request

**Dependencies**: Day 3 complete

**Estimated Time**: 6 hours

---

#### Day 5: Testing, Documentation & Performance Tuning (8 hours)

**Tasks**:
1. Unit tests for all JWT components
   - Token generation, validation, expiration
   - Blacklist operations
2. Performance benchmarks
   - JWT validation latency (<10ms p99)
   - Redis blacklist lookup (<2ms p99)
3. API documentation (OpenAPI spec)
   - Document `/v1/auth/token` endpoint
   - Add request/response examples
4. Update deployment guide
   - Redis setup instructions
   - Environment variables reference

**Files Created**:
- `tests/performance/auth_bench_test.go` (150 LOC)
- `docs/API_AUTHENTICATION.md` (OpenAPI spec)
- `docs/DEPLOYMENT_AUTHENTICATION.md` (deployment guide)

**Acceptance Criteria**:
- ✅ 100% test coverage for JWT authentication
- ✅ p99 JWT validation latency <10ms
- ✅ API documentation complete
- ✅ Deployment guide reviewed

**Dependencies**: Days 1-4 complete

**Estimated Time**: 8 hours

---

### 6.2 Week 2: API Keys, OAuth2 & Security Hardening (5 days)

#### Day 6: PostgreSQL Schema & API Key Store (8 hours)

**Tasks**:
1. Create database migrations
   - `migrations/006_create_api_keys.up.sql`
   - `migrations/007_create_refresh_tokens.up.sql`
   - `migrations/008_alter_agents_credentials.up.sql`
   - Corresponding `.down.sql` rollback scripts
2. Create `internal/auth/apikey_store.go`
   - Implement `APIKeyStore` interface
   - CRUD operations (Create, Get, List, Revoke, Delete)
   - Database indexes for performance
3. Create `internal/auth/refresh_store.go`
   - Implement `RefreshTokenStore` interface
   - Store refresh token hashes (SHA-256)
4. Write store tests

**Files Created**:
- `migrations/006_create_api_keys.up.sql` (50 LOC)
- `migrations/006_create_api_keys.down.sql` (10 LOC)
- `migrations/007_create_refresh_tokens.up.sql` (40 LOC)
- `migrations/007_create_refresh_tokens.down.sql` (10 LOC)
- `migrations/008_alter_agents_credentials.up.sql` (30 LOC)
- `migrations/008_alter_agents_credentials.down.sql` (10 LOC)
- `internal/auth/apikey_store.go` (200 LOC)
- `internal/auth/apikey_store_test.go` (180 LOC)
- `internal/auth/refresh_store.go` (150 LOC)
- `internal/auth/refresh_store_test.go` (120 LOC)

**Acceptance Criteria**:
- ✅ Database migrations run successfully
- ✅ Rollback scripts tested
- ✅ API key store CRUD operations working
- ✅ Refresh token store CRUD operations working
- ✅ Database indexes created for performance

**Dependencies**: PostgreSQL running

**Estimated Time**: 8 hours

---

#### Day 7: API Key Generation & Validation (8 hours)

**Tasks**:
1. Enhance `internal/auth/apikey_store.go`
   - Implement secure random key generation (`crypto/rand`)
   - SHA-256 hashing
   - Key format: `ak_live_{base64url(32 bytes)}`
2. Create `internal/auth/apikey_validator.go`
   - Implement `APIKeyValidator` interface
   - Hash incoming key and lookup by hash
   - Check expiration and revocation
3. Create `internal/auth/rate_limiter.go`
   - Token bucket algorithm
   - Redis-backed counters
   - Per-key rate limiting
4. Write validation tests

**Files Created**:
- `internal/auth/apikey_validator.go` (150 LOC)
- `internal/auth/apikey_validator_test.go` (180 LOC)
- `internal/auth/rate_limiter.go` (150 LOC)
- `internal/auth/rate_limiter_test.go` (130 LOC)

**Acceptance Criteria**:
- ✅ API key generation uses crypto/rand
- ✅ Keys formatted as `ak_live_...`
- ✅ Hash-based validation working
- ✅ Rate limiting enforced (100 req/sec default)
- ✅ Burst allowance working

**Dependencies**: Day 6 complete

**Estimated Time**: 8 hours

---

#### Day 8: API Key Management Endpoints (6 hours)

**Tasks**:
1. Enhance `internal/api/handlers/auth_handler.go`
   - `POST /v1/auth/keys` (create API key)
   - `GET /v1/auth/keys` (list keys for agent)
   - `DELETE /v1/auth/keys/{id}` (revoke key)
2. Implement last_used_at timestamp updates
3. Add expiration checks in middleware
4. Write API tests

**Files Created**:
- Updates to `internal/api/handlers/auth_handler.go` (+200 LOC)
- `tests/integration/apikey_auth_test.go` (200 LOC)

**Acceptance Criteria**:
- ✅ POST /v1/auth/keys creates and returns plaintext key (once!)
- ✅ GET /v1/auth/keys lists keys (redacted values)
- ✅ DELETE /v1/auth/keys/{id} revokes key
- ✅ Expired keys rejected automatically
- ✅ last_used_at updated on every request

**Dependencies**: Day 7 complete

**Estimated Time**: 6 hours

---

#### Day 9: Token Revocation & Refresh Flow (8 hours)

**Tasks**:
1. Enhance `internal/api/handlers/auth_handler.go`
   - `POST /v1/auth/revoke` (revoke access/refresh token)
   - `POST /v1/auth/refresh` (refresh access token)
2. Implement refresh token rotation
   - Invalidate old refresh token on use
   - Generate new refresh token
3. Add revocation checks to middleware
4. Write revocation tests

**Files Created**:
- Updates to `internal/api/handlers/auth_handler.go` (+150 LOC)
- Updates to `internal/auth/token_issuer.go` (+100 LOC)
- `tests/integration/token_revocation_test.go` (150 LOC)

**Acceptance Criteria**:
- ✅ POST /v1/auth/revoke adds token to blacklist
- ✅ POST /v1/auth/refresh generates new tokens
- ✅ Refresh token rotation working (old token invalidated)
- ✅ Revoked tokens rejected by middleware
- ✅ Redis blacklist TTL = token expiry

**Dependencies**: Day 8 complete

**Estimated Time**: 8 hours

---

#### Day 10: Security Hardening & Audit Logging (8 hours)

**Tasks**:
1. Create `internal/auth/credential_store.go`
   - Bcrypt password hashing
   - Failed login attempt tracking
   - Account lockout (5 attempts → 15 min)
2. Implement brute-force protection
   - Exponential backoff (1min, 5min, 15min, 1hr)
3. Add comprehensive audit logging
   - All auth events (success/failure)
   - Token issuance, revocation
   - API key usage
4. Security testing
   - Token tampering detection
   - Replay attack prevention
   - Secret exposure tests

**Files Created**:
- `internal/auth/credential_store.go` (200 LOC)
- `internal/auth/credential_store_test.go` (150 LOC)
- `tests/security/token_tampering_test.go` (120 LOC)
- `tests/security/brute_force_test.go` (150 LOC)
- `tests/security/secret_exposure_test.go` (100 LOC)
- `docs/SECURITY_AUTHENTICATION.md` (security guide)

**Acceptance Criteria**:
- ✅ Bcrypt password hashing working
- ✅ Account lockout after 5 failed attempts
- ✅ Audit logging for all auth events
- ✅ Security tests passing (tampering, replay, secrets)
- ✅ Security documentation complete

**Dependencies**: Day 9 complete

**Estimated Time**: 8 hours

---

### 6.3 Summary: Effort by Week

| Week | Days | Tasks | LOC | Key Deliverables |
|------|------|-------|-----|------------------|
| **Week 1** | 5 | JWT Foundation | ~1,200 | JWT auth working, middleware, blacklist |
| **Week 2** | 5 | API Keys & Security | ~1,350 | API keys, rate limiting, security hardening |
| **Total** | **10** | **20 tasks** | **~2,550** | **Production-ready authentication** |

**Contingency**: +2 days buffer (15-20%)
**Total Estimated Delivery**: **11-12 days (2.5 weeks)**

---

## 7. Critical Path Analysis

### 7.1 Critical Path (No Slack)

```
Day 1 (RSA Keys & Claims)
   ↓
Day 2 (Token Issuer & OAuth2)
   ↓
Day 3 (Middleware & Blacklist) ← **CRITICAL**: Blocks all auth flow testing
   ↓
Day 4 (Principal Extraction)
   ↓
Day 6 (Database Schema) ← **CRITICAL**: Blocks all API key work
   ↓
Day 7 (API Key Validation)
   ↓
Day 8 (API Key Endpoints)
   ↓
Day 9 (Token Revocation)
   ↓
Day 10 (Security Hardening)
```

**Critical Path Tasks** (must complete on time):
1. Day 3: Middleware & Blacklist (blocks integration testing)
2. Day 6: Database Schema (blocks all API key features)

**Parallel Opportunities**:
- Day 5 (Testing/Docs) can overlap with Day 6 (DB Schema)
- Day 7-8 can be parallelized (2 developers)

### 7.2 Dependencies Graph

```
┌─────────────┐
│   Day 1     │  RSA Keys & Claims
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Day 2     │  Token Issuer & OAuth2
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌─────────────┐
│   Day 3     │────▶│   Day 5     │  Testing & Docs (parallel)
│  Middleware │     │  (Optional) │
└──────┬──────┘     └─────────────┘
       │
       ▼
┌─────────────┐
│   Day 4     │  Principal Extraction
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Day 6     │  Database Schema
└──────┬──────┘
       │
       ├──────────────────────┐
       │                      │
       ▼                      ▼
┌─────────────┐     ┌─────────────┐
│   Day 7     │     │   Day 9     │  (Can start after Day 6)
│  API Key    │     │  Revocation │
│  Validation │     │             │
└──────┬──────┘     └─────────────┘
       │
       ▼
┌─────────────┐
│   Day 8     │  API Key Endpoints
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Day 10     │  Security Hardening
└─────────────┘
```

---

## 8. Risk Assessment

### 8.1 Technical Risks

| Risk | Impact | Probability | Mitigation | Owner |
|------|--------|-------------|------------|-------|
| **RSA key loading from Vault fails** | High | Medium | Fallback to local file loading for dev/test; document Vault setup clearly | Backend Lead |
| **Redis outage breaks authentication** | Critical | Low | Implement circuit breaker: allow-by-default with warning logs if Redis unavailable | DevOps Lead |
| **JWT library CVE discovered** | High | Low | Pin `golang-jwt/jwt/v5` version; monitor GitHub security advisories; automated dependency scanning | Security Lead |
| **Performance regression (<10ms target)** | High | Medium | Continuous benchmarking in CI/CD; Redis caching for public keys; optimize DB queries | Backend Lead |
| **Database migration failure in production** | Critical | Low | Test migrations in staging; rollback scripts; backup before migration; manual approval gate | DevOps Lead |
| **Rate limiter Redis connection pool exhaustion** | Medium | Medium | Connection pooling (max 100); circuit breaker; monitor Redis metrics | Backend Lead |
| **JWKS endpoint unavailable (external IdP)** | Medium | Low | Cache JWKS keys for 1 hour; retry with exponential backoff; fallback to static keys | Backend Lead |

### 8.2 Security Risks

| Risk | Impact | Probability | Mitigation | Owner |
|------|--------|-------------|------------|-------|
| **Private key leak** | Critical | Very Low | Store in Vault/Secrets Manager; rotate every 90 days; audit access logs; never commit to Git | Security Lead |
| **Token theft (XSS/MITM)** | High | Medium | Short TTL (1 hour); refresh token rotation; monitor unusual IP changes; HTTPS-only | Security Lead |
| **Brute-force password guessing** | Medium | High | Rate limiting (100 req/sec); account lockout (5 attempts → 15 min); Cloudflare WAF | Security Lead |
| **SQL injection in API key lookup** | Critical | Low | Parameterized queries (sqlx); input validation; automated SQL injection tests in CI/CD | Backend Lead |
| **Timing attacks on password comparison** | Low | Medium | Constant-time comparison (bcrypt); rate limiting; no error details to client | Security Lead |
| **API key exposure in logs** | High | Medium | Redact keys in logs; hash-based storage; automated secret scanning (truffleHog) | DevOps Lead |

### 8.3 Operational Risks

| Risk | Impact | Probability | Mitigation | Owner |
|------|--------|-------------|------------|-------|
| **Zero-downtime key rotation fails** | Medium | Low | Blue-green key deployment (dual-key validation for 1 hour); automated testing; runbook | DevOps Lead |
| **Migration rollback needed** | Medium | Low | Test `.down.sql` in staging; backup before migration; manual approval for production | DevOps Lead |
| **Monitoring blind spots** | Medium | Medium | Comprehensive metrics (Prometheus); alerting (PagerDuty); runbook documentation | DevOps Lead |
| **Insufficient load testing** | High | Medium | k6 load tests in staging (10,000 req/sec); gradual rollout with feature flags | QA Lead |
| **Breaking changes for existing clients** | High | Low | Versioned API (`/v2/*` for new auth); backward compatibility for `/v1/*`; deprecation notice (30 days) | Product Owner |

### 8.4 Risk Mitigation Timeline

**Week 1**:
- ✅ Day 1: Set up Vault/Secrets Manager for RSA keys
- ✅ Day 3: Implement Redis circuit breaker
- ✅ Day 5: Run initial performance benchmarks

**Week 2**:
- ✅ Day 6: Test database migrations in staging
- ✅ Day 8: Automated secret scanning in CI/CD
- ✅ Day 10: Security audit and penetration testing

**Post-Launch**:
- Monitor authentication latency (p99 <10ms)
- Track rate limit violations (alert >10/min)
- Review audit logs weekly for anomalies

---

## 9. Testing Strategy

### 9.1 Testing Pyramid

```
                  ┌─────────────────┐
                  │  Manual Testing │  (5%)
                  │  Exploratory    │
                  └─────────────────┘
              ┌───────────────────────┐
              │  End-to-End Tests     │  (15%)
              │  Integration Tests    │
              └───────────────────────┘
          ┌───────────────────────────────┐
          │  Unit Tests                   │  (80%)
          │  Component Tests              │
          └───────────────────────────────┘
```

### 9.2 Unit Tests (Target: 100% coverage)

**Test Files**:
- `internal/auth/*_test.go` (all components)
- Test coverage target: 100% for business logic
- Use `go test -cover` in CI/CD

**Key Test Cases**:
```go
// JWT Validation Tests
func TestJWTValidation_ValidToken(t *testing.T)
func TestJWTValidation_ExpiredToken(t *testing.T)
func TestJWTValidation_InvalidSignature(t *testing.T)
func TestJWTValidation_TamperedToken(t *testing.T)
func TestJWTValidation_RevokedToken(t *testing.T)
func TestJWTValidation_MissingClaims(t *testing.T)

// API Key Tests
func TestAPIKeyValidation_ValidKey(t *testing.T)
func TestAPIKeyValidation_InvalidHash(t *testing.T)
func TestAPIKeyValidation_ExpiredKey(t *testing.T)
func TestAPIKeyValidation_RevokedKey(t *testing.T)
func TestAPIKeyValidation_RateLimited(t *testing.T)

// Rate Limiter Tests
func TestRateLimiter_AllowUnderLimit(t *testing.T)
func TestRateLimiter_RejectOverLimit(t *testing.T)
func TestRateLimiter_WindowReset(t *testing.T)
func TestRateLimiter_PerKeyIsolation(t *testing.T)
```

### 9.3 Integration Tests (Target: 95% coverage)

**Test Files**:
- `tests/integration/auth_flow_test.go`
- `tests/integration/jwt_auth_test.go`
- `tests/integration/apikey_auth_test.go`
- `tests/integration/rate_limiting_test.go`

**Key Scenarios**:
```go
// End-to-End JWT Flow
func TestJWTAuthenticationFlow(t *testing.T) {
    // 1. Register agent
    // 2. Request token (POST /v1/auth/token)
    // 3. Receive access_token + refresh_token
    // 4. Make authenticated request (Bearer token)
    // 5. Verify Principal extracted correctly
    // 6. Refresh token before expiration
    // 7. Revoke token
    // 8. Verify revoked token rejected
}

// End-to-End API Key Flow
func TestAPIKeyAuthenticationFlow(t *testing.T) {
    // 1. Create API key (POST /v1/auth/keys)
    // 2. Make request with X-API-Key header
    // 3. Verify authentication succeeds
    // 4. Hit rate limit
    // 5. Verify 429 Too Many Requests
    // 6. Revoke API key
    // 7. Verify revoked key rejected
}

// Multi-Tenant Isolation
func TestMultiTenantIsolation(t *testing.T) {
    // 1. Create tokens for tenant A and B
    // 2. Verify tenant A cannot access tenant B resources
    // 3. Verify tenant_id claim enforced in policies
}
```

### 9.4 Security Tests

**Test Files**:
- `tests/security/token_tampering_test.go`
- `tests/security/brute_force_test.go`
- `tests/security/secret_exposure_test.go`

**Key Scenarios**:
```go
// Token Tampering Detection
func TestTokenTampering_ModifiedPayload(t *testing.T) {
    // 1. Issue valid token
    // 2. Modify JWT payload (e.g., change roles)
    // 3. Verify signature validation fails
    // 4. Ensure tampered token rejected
}

// Replay Attack Prevention
func TestTokenReplay_RevokedToken(t *testing.T) {
    // 1. Issue and revoke token
    // 2. Attempt to reuse revoked token
    // 3. Verify blacklist prevents replay
}

// Brute-Force Protection
func TestBruteForceProtection_AccountLockout(t *testing.T) {
    // 1. Attempt 5 failed logins
    // 2. Verify account locked for 15 minutes
    // 3. Verify valid credentials rejected during lockout
    // 4. Verify lockout expires correctly
}

// Secret Exposure
func TestSecretRedaction_APIKeyListing(t *testing.T) {
    // 1. Create API key
    // 2. List API keys (GET /v1/auth/keys)
    // 3. Verify plain key not in response
    // 4. Verify only hash stored in database
}
```

### 9.5 Performance Tests

**Benchmarks** (`tests/performance/auth_bench_test.go`):
```go
func BenchmarkJWTValidation(b *testing.B) {
    // Target: <5ms p99 (signature verification + Redis lookup)
}

func BenchmarkAPIKeyValidation(b *testing.B) {
    // Target: <2ms p99 (database lookup + hash computation)
}

func BenchmarkConcurrentAuth(b *testing.B) {
    // Target: 10,000+ concurrent requests
}
```

**Load Testing** (`tests/performance/load_test.js`):
```javascript
// k6 load testing script
import http from 'k6/http';
import { check } from 'k6';

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

### 9.6 Test Coverage Targets

| Component | Unit Tests | Integration Tests | Security Tests | Performance Tests |
|-----------|------------|-------------------|----------------|-------------------|
| JWT Validator | 100% | 100% | 100% | Yes |
| API Key Validator | 100% | 100% | 90% | Yes |
| Token Issuer | 100% | 100% | 100% | Yes |
| Middleware | 100% | 100% | 90% | Yes |
| Rate Limiter | 100% | 90% | - | Yes |
| Blacklist | 100% | 90% | 100% | - |
| Principal Extractor | 100% | 100% | - | - |
| **Overall** | **100%** | **95%+** | **95%+** | **<10ms p99** |

---

## 10. Deployment Plan

### 10.1 Phased Rollout

**Phase 1: Staging Deployment (Week 1, Day 5)**
- Deploy JWT authentication to staging environment
- Enable JWT validation on `/v2/*` endpoints (new versioned API)
- Keep `/v1/*` endpoints unauthenticated (backward compatibility)
- Run load tests (10,000 concurrent requests)
- Monitor latency and error rates for 24 hours

**Phase 2: API Keys + OAuth2 (Week 2, Day 8)**
- Enable API key authentication in staging
- Add OAuth2 client credentials flow
- Migrate internal services to use API keys
- Document migration guide for external clients
- Monitor rate limiting and revocation

**Phase 3: Production Rollout (Week 2, Day 10)**
- Deploy to production with feature flags
- Enable authentication on `/v2/*` endpoints
- Monitor error rates and latency (Grafana dashboards)
- Deprecation notice for `/v1/*`: 30-day sunset period
- Rate limit unauthenticated endpoints (100 req/day)

**Phase 4: Enforcement (Week 4)**
- Require authentication on all endpoints (`/v1/*` and `/v2/*`)
- Revoke access for non-compliant clients
- Monitor client adoption (track migration progress)

### 10.2 Feature Flags

```yaml
# Feature flags (managed via environment variables)
FEATURE_AUTH_JWT_ENABLED=true
FEATURE_AUTH_APIKEY_ENABLED=true
FEATURE_AUTH_OAUTH2_ENABLED=false  # Enable in Phase 2
FEATURE_AUTH_ENFORCE_V1=false      # Enable in Phase 4
FEATURE_RATE_LIMITING_ENABLED=true
FEATURE_REVOCATION_ENABLED=true
FEATURE_REDIS_BLACKLIST_ENABLED=true
```

**Rollback Procedure**:
1. Set `FEATURE_AUTH_JWT_ENABLED=false`
2. Restart service (graceful shutdown, no downtime)
3. Monitor for 5 minutes
4. Verify unauthenticated access works
5. Investigate root cause in staging

### 10.3 Database Migrations

**Migration Strategy**:
- Use `golang-migrate/migrate` library
- Migrations in `migrations/` directory
- Version-controlled SQL files
- Automated in CI/CD pipeline (staging only)
- Manual approval required for production

**Execution**:
```bash
# Apply migrations (staging)
migrate -path migrations -database "$DATABASE_URL" up

# Rollback (if needed)
migrate -path migrations -database "$DATABASE_URL" down 1

# Verify migration status
migrate -path migrations -database "$DATABASE_URL" version
```

**CI/CD Integration**:
```yaml
# .github/workflows/deploy.yml
- name: Run Database Migrations
  run: |
    if [ "$ENVIRONMENT" == "staging" ]; then
      migrate -path migrations -database "$DATABASE_URL" up
    else
      echo "Production migrations require manual approval"
    fi
```

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
authz_redis_connection_pool_size
```

**Alerts** (PagerDuty / Opsgenie):
```yaml
alerts:
  - name: HighAuthFailureRate
    condition: authz_auth_attempts_total{status="failure"} / authz_auth_attempts_total > 0.1
    severity: P1
    message: "Auth failure rate >10%"
    runbook: docs/RUNBOOK_AUTHENTICATION.md#high-failure-rate

  - name: AuthLatencyHigh
    condition: authz_auth_latency_seconds{quantile="0.99"} > 0.01
    severity: P1
    message: "p99 auth latency >10ms"
    runbook: docs/RUNBOOK_AUTHENTICATION.md#high-latency

  - name: RedisBlacklistUnavailable
    condition: up{job="redis-blacklist"} == 0
    severity: P0
    message: "Redis blacklist down - token revocation broken"
    runbook: docs/RUNBOOK_AUTHENTICATION.md#redis-outage

  - name: BruteForceDetected
    condition: rate(authz_brute_force_attempts_total[5m]) > 10
    severity: P2
    message: "Brute-force attack detected (>10 attempts/5min)"
    runbook: docs/RUNBOOK_AUTHENTICATION.md#brute-force-attack
```

**Dashboards** (Grafana):
- Authentication success/failure rates (pie chart)
- Auth latency percentiles (line graph)
- Token issuance rate (counter)
- API key usage by key_id (bar chart)
- Redis blacklist size (gauge)
- Rate limit violations (heatmap)

### 10.5 Runbook & Documentation

**Deliverables**:
1. **API Documentation** (`docs/API_AUTHENTICATION.md`)
   - All authentication endpoints (request/response examples)
   - Error codes and troubleshooting
   - Authentication flow diagrams

2. **Deployment Guide** (`docs/DEPLOYMENT_AUTHENTICATION.md`)
   - Database migration steps
   - Redis setup instructions
   - Environment variables reference
   - Key rotation procedures

3. **Runbook** (`docs/RUNBOOK_AUTHENTICATION.md`)
   - Common issues and resolutions
   - Rollback procedures
   - Key rotation steps
   - Monitoring and alerting guide
   - Incident response procedures

4. **Security Guide** (`docs/SECURITY_AUTHENTICATION.md`)
   - Threat model
   - Attack mitigation strategies
   - Compliance checklist (SOC2, GDPR)
   - Incident response procedures

---

## Summary: Implementation Readiness

### Components Identified: **12**
1. Authentication Middleware
2. JWT Validator (enhanced)
3. Token Issuer
4. API Key Validator
5. API Key Store
6. Rate Limiter
7. Redis Blacklist
8. Principal Extractor
9. Credential Store
10. Refresh Token Store
11. RSA Key Loader
12. Auth Handler (endpoints)

### Critical Path Tasks: **3**
1. Day 3: Middleware & Blacklist (blocks integration testing)
2. Day 6: Database Schema (blocks API key features)
3. Day 9: Token Revocation (blocks production readiness)

### Total Implementation Time: **9.5 days** (core) + **2 days** (buffer) = **11-12 days**

### Key Risks:
1. **High Impact**: Redis outage, private key leak, database migration failure
2. **Mitigation**: Circuit breakers, Vault storage, rollback scripts, staging tests

### Next Steps:
1. ✅ **Review this document** with team (Backend, DevOps, Security leads)
2. ✅ **Set up infrastructure**: Redis cluster, PostgreSQL, Vault/Secrets Manager
3. ✅ **Begin Day 1**: RSA key management & enhanced JWT claims
4. ✅ **Track progress**: Daily standups, update task status in Jira/Linear

---

**Document Prepared By**: System Architecture Designer
**Review Required**: Backend Lead, Security Lead, DevOps Lead, Product Owner
**Implementation Start Date**: TBD
**Target Completion**: 2 weeks from start date

---

**END OF DOCUMENT**
