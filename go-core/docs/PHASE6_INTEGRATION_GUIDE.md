# Phase 6: OAuth2 & API Key Integration Guide

**Date**: 2025-11-27
**Status**: OAuth2 100% complete, Integration pending
**Related**: PHASE6_OAUTH2_IMPLEMENTATION_STATUS.md

---

## Overview

This guide provides step-by-step instructions for integrating OAuth2 and API key authentication into the authz-server production environment.

---

## Prerequisites

### 1. Database Requirements

The current server (cmd/authz-server/main.go) uses in-memory storage. For Phase 6 authentication, you need PostgreSQL:

```bash
# Install PostgreSQL
brew install postgresql@15  # macOS
# or
apt-get install postgresql-15  # Ubuntu

# Start PostgreSQL
brew services start postgresql@15  # macOS
# or
systemctl start postgresql  # Ubuntu

# Create database
createdb authz_engine

# Set environment variables
export DATABASE_URL="postgresql://localhost:5432/authz_engine?sslmode=disable"
```

### 2. Redis Requirements (Optional - for rate limiting)

```bash
# Install Redis
brew install redis  # macOS
# or
apt-get install redis-server  # Ubuntu

# Start Redis
brew services start redis  # macOS
# or
systemctl start redis  # Ubuntu

# Set environment variable
export REDIS_URL="redis://localhost:6379"
```

---

## Step 1: Apply Database Migrations

### 1.1 Install golang-migrate

```bash
brew install golang-migrate  # macOS
# or
go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest
```

### 1.2 Run Migrations

```bash
# Navigate to project root
cd /Users/tommaduri/Documents/GitHub/authz-engine/go-core

# Apply OAuth2 migration
migrate -database "${DATABASE_URL}" -path migrations up

# Verify migration
psql ${DATABASE_URL} -c "\d oauth2_clients"
```

**Expected Output**:
```sql
                                        Table "public.oauth2_clients"
      Column       |           Type           |                         Modifiers
-------------------+--------------------------+-----------------------------------------------------------
 client_id         | uuid                     | not null default gen_random_uuid()
 client_secret_hash| character varying(60)    | not null
 name              | character varying(255)   | not null
 tenant_id         | character varying(255)   | not null
 scopes            | text[]                   | default '{}'::text[]
 grant_types       | text[]                   | default '{client_credentials}'::text[]
 ...
```

---

## Step 2: Update Server Configuration

### 2.1 Add Database Configuration

Create `internal/config/database.go`:

```go
package config

import (
	"database/sql"
	"fmt"
	"os"
	"time"

	_ "github.com/lib/pq"
)

type DatabaseConfig struct {
	URL             string
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
}

func LoadDatabaseConfig() DatabaseConfig {
	return DatabaseConfig{
		URL:             getEnv("DATABASE_URL", "postgresql://localhost:5432/authz_engine?sslmode=disable"),
		MaxOpenConns:    getEnvInt("DB_MAX_OPEN_CONNS", 25),
		MaxIdleConns:    getEnvInt("DB_MAX_IDLE_CONNS", 5),
		ConnMaxLifetime: getEnvDuration("DB_CONN_MAX_LIFETIME", 5*time.Minute),
	}
}

func (cfg DatabaseConfig) Connect() (*sql.DB, error) {
	db, err := sql.Open("postgres", cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	db.SetMaxOpenConns(cfg.MaxOpenConns)
	db.SetMaxIdleConns(cfg.MaxIdleConns)
	db.SetConnMaxLifetime(cfg.ConnMaxLifetime)

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return db, nil
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	// Implementation...
}

func getEnvDuration(key string, defaultValue time.Duration) time.Duration {
	// Implementation...
}
```

### 2.2 Update main.go

Modify `cmd/authz-server/main.go`:

```go
// Add imports
import (
	"database/sql"
	_ "github.com/lib/pq"

	"github.com/authz-engine/go-core/internal/auth"
	"github.com/authz-engine/go-core/internal/config"
)

func main() {
	// ... existing flag parsing ...

	// Database flag
	enableDB := flag.Bool("enable-db", false, "Enable PostgreSQL database")
	flag.Parse()

	// Initialize database if enabled
	var db *sql.DB
	var oauth2Store auth.OAuth2ClientStore

	if *enableDB {
		dbConfig := config.LoadDatabaseConfig()
		var err error
		db, err = dbConfig.Connect()
		if err != nil {
			logger.Fatal("Failed to connect to database", zap.Error(err))
		}
		defer db.Close()

		logger.Info("Database connected",
			zap.Int("max_open_conns", dbConfig.MaxOpenConns),
			zap.Int("max_idle_conns", dbConfig.MaxIdleConns),
		)

		// Initialize PostgreSQL OAuth2 store
		oauth2Store = auth.NewPostgresOAuth2Store(db)
	} else {
		// Use in-memory store for development
		oauth2Store = auth.NewInMemoryOAuth2Store()
		logger.Warn("Using in-memory OAuth2 store (not suitable for production)")
	}

	// ... rest of main ...
}
```

---

## Step 3: Wire OAuth2 Handler to REST Server

### 3.1 Fix Import Path in oauth2_handler.go

Update `internal/api/rest/oauth2_handler.go:9`:

```go
// BEFORE:
import (
	"authz-engine/internal/auth"  // ❌ WRONG
)

// AFTER:
import (
	"github.com/authz-engine/go-core/internal/auth"  // ✅ CORRECT
)
```

### 3.2 Register OAuth2 Route

Modify `internal/api/rest/server.go` - add to New() function:

```go
// New creates a new REST API server
func New(cfg Config, eng *engine.Engine, policyStore policy.Store, logger *zap.Logger, oauth2Handler *OAuth2HTTPHandler) (*Server, error) {
	// ... existing code ...

	s := &Server{
		engine:        eng,
		policyStore:   policyStore,
		router:        mux.NewRouter(),
		logger:        logger,
		config:        cfg,
		startTime:     time.Now(),
		oauth2Handler: oauth2Handler,  // Add this field
	}

	// ... rest of function ...
}
```

Add field to Server struct:

```go
type Server struct {
	engine        *engine.Engine
	policyStore   policy.Store
	router        *mux.Router
	httpServer    *http.Server
	logger        *zap.Logger
	config        Config
	startTime     time.Time
	authenticator *middleware.Authenticator
	oauth2Handler *OAuth2HTTPHandler  // Add this
}
```

Update `registerRoutes()` method:

```go
func (s *Server) registerRoutes() {
	// ... existing middleware ...

	// OAuth2 endpoints (NO AUTH REQUIRED - self-authenticating)
	if s.oauth2Handler != nil {
		oauth2Routes := s.router.PathPrefix("/oauth").Subrouter()
		oauth2Routes.HandleFunc("/token", s.oauth2Handler.HandleTokenRequest).Methods("POST")

		s.logger.Info("OAuth2 endpoints registered at /oauth/token")
	}

	// ... existing routes ...
}
```

### 3.3 Update main.go to Pass OAuth2 Handler

```go
// Initialize OAuth2 handler
var oauth2HTTPHandler *rest.OAuth2HTTPHandler
if oauth2Store != nil {
	// Mock JWT issuer for now (replace with real implementation)
	mockIssuer := &mockOAuth2JWTIssuer{}
	oauth2Handler := auth.NewOAuth2Handler(oauth2Store, mockIssuer)
	oauth2HTTPHandler = rest.NewOAuth2HTTPHandler(oauth2Handler, nil)

	logger.Info("OAuth2 handler initialized")
}

// Update REST server initialization
if *enableREST {
	// ... existing config ...

	var err error
	restSrv, err = rest.New(restConfig, eng, store, logger, oauth2HTTPHandler)
	if err != nil {
		logger.Fatal("Failed to create REST API server", zap.Error(err))
	}
}
```

---

## Step 4: Create JWT Issuer Adapter

### 4.1 Implement OAuth2JWTIssuer Adapter

Create `internal/auth/oauth2_jwt_adapter.go`:

```go
package auth

import (
	"context"
	"time"
)

// OAuth2JWTAdapter adapts JWTIssuer to OAuth2JWTIssuer interface
type OAuth2JWTAdapter struct {
	issuer *JWTIssuer
}

// NewOAuth2JWTAdapter creates a new adapter
func NewOAuth2JWTAdapter(issuer *JWTIssuer) *OAuth2JWTAdapter {
	return &OAuth2JWTAdapter{issuer: issuer}
}

// IssueTokenWithClaims issues a token with OAuth2-specific claims
func (a *OAuth2JWTAdapter) IssueTokenWithClaims(
	ctx context.Context,
	subject, tenantID string,
	scopes []string,
	extra map[string]interface{},
) (string, error) {
	// Convert scopes array to space-delimited string
	scopeString := strings.Join(scopes, " ")

	// Extract permissions from extra if present
	var permissions []string
	if perms, ok := extra["permissions"].([]string); ok {
		permissions = perms
	}

	// Use JWTIssuer's IssueToken method
	expiresIn := time.Hour // Default 1 hour
	if expiry, ok := extra["expires_in"].(time.Duration); ok {
		expiresIn = expiry
	}

	return a.issuer.IssueToken(ctx, subject, expiresIn, scopeString, permissions)
}
```

### 4.2 Initialize in main.go

```go
// Initialize key rotation manager (if not already done)
rotationMgr := auth.NewKeyRotationManager(db)  // or in-memory version

// Initialize JWT issuer
jwtIssuer := auth.NewJWTIssuer(rotationMgr, "authz-engine", "authz-engine")

// Create OAuth2 adapter
oauth2JWTIssuer := auth.NewOAuth2JWTAdapter(jwtIssuer)

// Initialize OAuth2 handler with real JWT issuer
oauth2Handler := auth.NewOAuth2Handler(oauth2Store, oauth2JWTIssuer)
```

---

## Step 5: Testing the OAuth2 Endpoint

### 5.1 Start the Server

```bash
# With database
go run cmd/authz-server/main.go \
	--enable-db=true \
	--enable-rest=true \
	--rest-port=8081

# Without database (in-memory)
go run cmd/authz-server/main.go \
	--enable-rest=true \
	--rest-port=8081
```

### 5.2 Create OAuth2 Client

Using PostgreSQL directly:

```sql
-- Insert test OAuth2 client
INSERT INTO oauth2_clients (
    client_id,
    client_secret_hash,
    name,
    tenant_id,
    scopes,
    created_at
) VALUES (
    '550e8400-e29b-41d4-a716-446655440000'::uuid,
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYIVKg6mKOu',  -- "test-secret"
    'Test Client',
    'tenant-1',
    ARRAY['read:policies', 'write:policies'],
    NOW()
);
```

### 5.3 Test OAuth2 Token Request

```bash
# Test token issuance
curl -X POST http://localhost:8081/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=550e8400-e29b-41d4-a716-446655440000" \
  -d "client_secret=test-secret" \
  -d "scope=read:policies"
```

**Expected Response**:
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "read:policies"
}
```

### 5.4 Verify Token

```bash
# Decode JWT (using jwt.io or jwt-cli)
jwt decode $ACCESS_TOKEN

# Expected claims:
{
  "iss": "authz-engine",
  "sub": "550e8400-e29b-41d4-a716-446655440000",
  "aud": ["authz-engine"],
  "exp": 1703721600,
  "iat": 1703718000,
  "scope": "read:policies",
  "client_name": "Test Client",
  "grant_type": "client_credentials"
}
```

---

## Step 6: API Key Authentication (FR-3, P0)

### 6.1 Database Migration

Create `migrations/000009_create_api_keys.up.sql`:

```sql
-- API Keys Table for X-API-Key authentication
CREATE TABLE IF NOT EXISTS api_keys (
    key_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash VARCHAR(64) NOT NULL,  -- SHA-256 hash
    key_prefix VARCHAR(8) NOT NULL,  -- First 8 chars for identification

    name VARCHAR(255) NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,
    scopes TEXT[] DEFAULT '{}',

    -- Rate limiting
    rate_limit_per_sec INT DEFAULT 100,

    -- Lifecycle
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,

    -- Metadata
    metadata JSONB DEFAULT '{}',

    CONSTRAINT api_keys_tenant_name_unique UNIQUE(tenant_id, name),
    CONSTRAINT api_keys_prefix_unique UNIQUE(key_prefix)
);

CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix) WHERE revoked_at IS NULL;
CREATE INDEX idx_api_keys_expires ON api_keys(expires_at) WHERE revoked_at IS NULL AND expires_at IS NOT NULL;

-- Updated timestamp trigger
CREATE OR REPLACE FUNCTION update_api_keys_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER api_keys_updated_at
    BEFORE UPDATE ON api_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_api_keys_updated_at();

COMMENT ON TABLE api_keys IS 'API keys for X-API-Key authentication';
COMMENT ON COLUMN api_keys.key_hash IS 'SHA-256 hash of API key';
COMMENT ON COLUMN api_keys.key_prefix IS 'First 8 characters for fast lookup';
```

### 6.2 Implementation Files

Files to create:
1. `internal/auth/apikey.go` - Core API key service
2. `internal/auth/apikey_store.go` - Storage interface
3. `internal/auth/apikey_postgres.go` - PostgreSQL implementation
4. `internal/auth/apikey_store_memory.go` - In-memory test store
5. `internal/api/rest/apikey_handler.go` - REST API handler
6. `tests/auth/apikey_handler_test.go` - Comprehensive tests

---

## Step 7: Production Deployment Checklist

### 7.1 Pre-Deployment

- [ ] PostgreSQL 15+ installed and running
- [ ] Redis installed and running (optional, for distributed rate limiting)
- [ ] Database migrations applied successfully
- [ ] OAuth2 clients created for all service accounts
- [ ] API keys generated for all applications
- [ ] TLS certificates configured for HTTPS
- [ ] Monitoring and alerting set up

### 7.2 Environment Variables

```bash
# Required
export DATABASE_URL="postgresql://user:pass@host:5432/authz_engine?sslmode=require"
export JWT_ISSUER="authz-engine-prod"
export JWT_AUDIENCE="authz-engine-prod"

# Optional
export REDIS_URL="redis://host:6379"
export KEY_ROTATION_INTERVAL="7d"
export TOKEN_EXPIRATION="1h"
export LOG_LEVEL="info"
export ENABLE_METRICS="true"
```

### 7.3 Security Hardening

- [ ] Enable TLS for all endpoints
- [ ] Configure proper CORS origins (not "*")
- [ ] Enable authentication middleware
- [ ] Set up rate limiting per tenant
- [ ] Configure audit logging
- [ ] Implement key rotation schedule
- [ ] Set up secret management (AWS Secrets Manager, HashiCorp Vault, etc.)
- [ ] Enable security headers (HSTS, CSP, etc.)

---

## Step 8: Monitoring and Observability

### 8.1 Metrics to Track

```go
// Prometheus metrics
var (
	oauth2TokenIssuanceTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "oauth2_token_issuance_total",
			Help: "Total number of OAuth2 tokens issued",
		},
		[]string{"tenant_id", "client_id"},
	)

	oauth2TokenIssuanceDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "oauth2_token_issuance_duration_seconds",
			Help: "Duration of OAuth2 token issuance",
		},
		[]string{"tenant_id"},
	)

	oauth2AuthenticationFailures = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "oauth2_authentication_failures_total",
			Help: "Total number of OAuth2 authentication failures",
		},
		[]string{"tenant_id", "reason"},
	)
)
```

### 8.2 Health Checks

Add to `internal/api/rest/server.go`:

```go
func (s *Server) healthCheckHandler(w http.ResponseWriter, r *http.Request) {
	checks := make(map[string]interface{})

	// Check database connection
	if s.db != nil {
		if err := s.db.Ping(); err != nil {
			checks["database"] = "unhealthy"
		} else {
			checks["database"] = "ok"
		}
	}

	// Check Redis connection
	if s.redis != nil {
		if _, err := s.redis.Ping(r.Context()).Result(); err != nil {
			checks["redis"] = "unhealthy"
		} else {
			checks["redis"] = "ok"
		}
	}

	// ... rest of health checks ...
}
```

---

## Troubleshooting

### Issue 1: Database Connection Failures

**Error**: `pq: SSL is not enabled on the server`

**Solution**: Update connection string:
```bash
export DATABASE_URL="postgresql://...?sslmode=disable"
```

### Issue 2: OAuth2 Token Issuance Slow

**Symptom**: Token issuance takes >300ms

**Cause**: bcrypt verification (cost 12) is intentionally slow

**Solutions**:
1. Implement Redis caching for successful authentications
2. Use connection pooling (already configured)
3. Consider JTI-based session tokens for subsequent requests

### Issue 3: Rate Limiting Not Working

**Cause**: Missing Redis configuration

**Solution**: Either configure Redis or use in-memory rate limiter:
```go
rateLimiter := rest.NewInMemoryRateLimiter(100, time.Minute)
```

---

## Next Steps

1. **Immediate** (this session):
   - Fix import path in oauth2_handler.go
   - Create OAuth2 JWT adapter
   - Document API key implementation plan

2. **Short-term** (next 1-2 weeks):
   - Implement API key authentication (FR-3, P0)
   - Create integration tests with real PostgreSQL
   - Wire all endpoints to main server

3. **Medium-term** (next 1 month):
   - Implement key rotation automation
   - Add comprehensive monitoring
   - Production deployment and testing

---

**Document Version**: 1.0
**Last Updated**: 2025-11-27
**Next Review**: After API key implementation
