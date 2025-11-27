# Database Package

Database schema management, migrations, and utilities for the authentication system.

## Files

- **schema.go** - Database schema constants, models, and validation
- **migrations.go** - Migration runner and management utilities

## Usage

### Running Migrations

```go
package main

import (
    "database/sql"
    "log"

    _ "github.com/lib/pq"
    "authz-engine/internal/db"
)

func main() {
    // Connect to database
    dbConn, err := sql.Open("postgres",
        "postgres://user:pass@localhost:5432/authz?sslmode=disable")
    if err != nil {
        log.Fatal(err)
    }
    defer dbConn.Close()

    // Create migration runner
    runner, err := db.NewMigrationRunner(dbConn)
    if err != nil {
        log.Fatal(err)
    }
    defer runner.Close()

    // Run all pending migrations
    if err := runner.Up(); err != nil {
        log.Fatal(err)
    }

    log.Println("Migrations completed successfully")
}
```

### Working with Multi-Tenant Data

```go
// Set tenant context for RLS
err := db.WithTenant(dbConn, "tenant-123", func(conn *sql.DB) error {
    // All queries here automatically filtered by tenant_id
    rows, err := conn.Query("SELECT * FROM api_keys")
    // ... process rows
    return err
})
```

### Using Schema Models

```go
import "authz-engine/internal/db"

// Create API key
apiKey := &db.APIKey{
    ID:           uuid.New(),
    KeyHash:      hashAPIKey(rawKey),
    Name:         "Production API Key",
    AgentID:      "agent-123",
    Scopes:       []string{"read", "write"},
    RateLimitRPS: 1000,
    TenantID:     "tenant-123",
}

// Validate before insert
if err := db.ValidateAPIKeyName(apiKey.Name); err != nil {
    return err
}
if err := db.ValidateRateLimitRPS(apiKey.RateLimitRPS); err != nil {
    return err
}

// Check if active
if apiKey.IsActive() {
    // Use the key
}
```

### Event Logging

```go
// Log authentication event
auditLog := &db.AuthAuditLog{
    EventType: db.EventAPIKeyValidated,
    UserID:    &userID,
    Success:   true,
    Timestamp: time.Now(),
    TenantID:  "tenant-123",
}

// Validate event type
if !db.IsValidEventType(auditLog.EventType) {
    return errors.New("invalid event type")
}
```

## Schema Constants

### Table Names

```go
db.TableAPIKeys        // "api_keys"
db.TableRefreshTokens  // "refresh_tokens"
db.TableAuthAuditLogs  // "auth_audit_logs"
db.TableRateLimitState // "rate_limit_state"
```

### Column Names

```go
// Common
db.ColID         // "id"
db.ColTenantID   // "tenant_id"
db.ColCreatedAt  // "created_at"

// API Keys
db.ColKeyHash      // "key_hash"
db.ColRateLimitRPS // "rate_limit_rps"
db.ColScopes       // "scopes"

// Audit Logs
db.ColEventType    // "event_type"
db.ColSuccess      // "success"
db.ColTimestamp    // "timestamp"
```

### Event Types

```go
db.EventAPIKeyCreated     // "api_key_created"
db.EventAPIKeyValidated   // "api_key_validated"
db.EventTokenIssued       // "token_issued"
db.EventLoginSuccess      // "login_success"
db.EventRateLimitExceeded // "rate_limit_exceeded"
// ... and more
```

## Models

### APIKey

```go
type APIKey struct {
    ID           uuid.UUID
    KeyHash      string    // SHA-256 hash
    Name         string
    AgentID      string
    Scopes       []string
    RateLimitRPS int
    TenantID     string
    // ... timestamps
}

// Check if key is active
func (k *APIKey) IsActive() bool
```

### RefreshToken

```go
type RefreshToken struct {
    ID            uuid.UUID
    TokenHash     string  // SHA-256 hash
    UserID        string
    ExpiresAt     time.Time
    TenantID      string
    ParentTokenID *uuid.UUID  // For rotation chain
    // ... timestamps
}

// Check if token is valid
func (t *RefreshToken) IsValid() bool
```

### AuthAuditLog

```go
type AuthAuditLog struct {
    EventType    string
    UserID       *string
    Success      bool
    Timestamp    time.Time
    TenantID     string
    IPAddress    *string
    ErrorMessage *string
    // ... more fields
}
```

### RateLimitState

```go
type RateLimitState struct {
    Key        string
    Tokens     float64    // Available tokens
    LastRefill time.Time
    TenantID   string
}
```

## Validation

### API Key Name

```go
err := db.ValidateAPIKeyName("My API Key")
// Checks: not empty, max 255 chars
```

### Rate Limit RPS

```go
err := db.ValidateRateLimitRPS(1000)
// Checks: 1 <= rps <= 10000
```

### Event Type

```go
valid := db.IsValidEventType("api_key_validated")
// Returns true if event type is in allowed list
```

## Migration Management

### Common Operations

```go
// Run all pending migrations
runner.Up()

// Rollback one migration
runner.Down()

// Rollback N migrations
runner.Steps(-3)

// Apply N migrations forward
runner.Steps(2)

// Check current version
version, dirty, err := runner.Version()

// Force version (recovery only)
runner.Force(1)

// Drop all tables (dev only!)
runner.Drop()
```

### List Available Migrations

```go
migrations, err := db.ListMigrations()
for _, m := range migrations {
    log.Println(m)
}
```

## Testing

```bash
# Run all tests
go test ./internal/db/... -v

# Run with coverage
go test ./internal/db/... -cover

# Run integration tests (requires PostgreSQL)
go test ./tests/db/... -v

# Skip performance tests
go test ./tests/db/... -short
```

## Best Practices

1. **Always use WithTenant** for multi-tenant queries
2. **Never store plaintext keys** - use KeyHash only
3. **Validate before insert** - use validation helpers
4. **Log all auth events** - use AuthAuditLog
5. **Check IsActive/IsValid** before using keys/tokens
6. **Use constants** instead of string literals
7. **Test migrations** with up/down cycles

## Security Notes

⚠️ **Critical Security Requirements**:

- API keys must be hashed (SHA-256) before storing
- Refresh tokens must be hashed before storing
- Set tenant context for all queries
- Never expose KeyHash or TokenHash in API responses
- Log all authentication attempts
- Validate all inputs before database operations

## Performance

### Expected Query Times

- Single key lookup: < 5ms
- Tenant-scoped list: < 10ms
- Audit log queries: < 50ms (with proper indexing)

### Index Usage

```sql
-- Uses idx_api_keys_key_hash (B-tree)
SELECT * FROM api_keys WHERE key_hash = 'hash'

-- Uses idx_api_keys_scopes (GIN)
SELECT * FROM api_keys WHERE scopes @> '["admin"]'

-- Uses idx_api_keys_active (Partial)
SELECT * FROM api_keys
WHERE tenant_id = 'x' AND revoked_at IS NULL
```

## Troubleshooting

### Migration Fails

```go
// Check if database is dirty
version, dirty, err := runner.Version()
if dirty {
    log.Printf("Database dirty at version %d", version)
    // Review last migration, fix issues, then:
    runner.Force(correctVersion)
}
```

### RLS Not Working

```go
// Ensure tenant is set
err := db.SetTenant(dbConn, "tenant-123")
if err != nil {
    log.Fatal("Failed to set tenant:", err)
}

// Always reset after
defer db.ResetTenant(dbConn)
```

### Poor Performance

1. Check indexes exist: `\di` in psql
2. Analyze tables: `ANALYZE api_keys;`
3. Check query plans: `EXPLAIN ANALYZE SELECT ...`
4. Verify partial indexes are used for filtered queries

## Dependencies

```go
import (
    "github.com/google/uuid"           // UUID generation
    "github.com/lib/pq"                // PostgreSQL driver
    "github.com/golang-migrate/migrate/v4"  // Migrations
)
```
