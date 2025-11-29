# OAuth2 Client Credentials Flow Implementation

## Overview

This implementation follows **RFC 6749 Section 4.4** (OAuth2 Client Credentials Grant) for machine-to-machine authentication.

## Architecture

### Components

1. **oauth2.go** - Core OAuth2 handler and business logic
2. **oauth2_store.go** - Storage interface definition
3. **oauth2_postgres.go** - PostgreSQL implementation
4. **oauth2_handler.go** - HTTP REST endpoint handler
5. **Migration 000008** - Database schema

### File Locations

```
/Users/tommaduri/Documents/GitHub/authz-engine/go-core/
├── internal/
│   ├── auth/
│   │   ├── oauth2.go                 # Core OAuth2 handler
│   │   ├── oauth2_store.go           # Storage interface
│   │   ├── oauth2_postgres.go        # PostgreSQL implementation
│   │   └── tests/
│   │       └── oauth2_test.go        # Unit tests
│   └── api/rest/
│       ├── oauth2_handler.go         # HTTP handler
│       └── tests/
│           └── oauth2_handler_test.go # HTTP tests
└── migrations/
    ├── 000008_create_oauth2_clients.up.sql
    └── 000008_create_oauth2_clients.down.sql
```

## Database Schema

```sql
CREATE TABLE oauth2_clients (
    client_id UUID PRIMARY KEY,
    client_secret_hash VARCHAR(60) NOT NULL,
    name VARCHAR(255) NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,
    scopes TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);
```

### Indexes

- `idx_oauth2_clients_tenant_id` - For tenant-based queries
- `idx_oauth2_clients_active` - For active client lookups

## Features

### ✅ Security Features

- **Bcrypt Password Hashing** (cost 12)
- **UUID Client IDs** for uniqueness
- **Constant-time comparison** via bcrypt
- **Scope enforcement** per client
- **Client revocation** support
- **Expiration timestamps**
- **Rate limiting** per client_id

### ✅ RFC 6749 Compliance

- Grant type validation (only `client_credentials`)
- OAuth2-compliant JSON responses
- Proper HTTP status codes
- Error response format (Section 5.2)
- Token response format (Section 5.1)

### ✅ Integration

- Uses existing JWT issuer
- Supports both JSON and form-encoded requests
- No-cache headers for security
- Comprehensive error handling

## API Usage

### POST /oauth/token

**Request (JSON):**
```json
{
  "grant_type": "client_credentials",
  "client_id": "550e8400-e29b-41d4-a716-446655440000",
  "client_secret": "your-secret-here",
  "scope": "read write"
}
```

**Request (Form-Encoded):**
```
grant_type=client_credentials&client_id=550e8400-e29b-41d4-a716-446655440000&client_secret=your-secret-here&scope=read%20write
```

**Success Response (200 OK):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "read write"
}
```

**Error Response (401 Unauthorized):**
```json
{
  "error": "invalid_client",
  "error_description": "Invalid client credentials"
}
```

### Error Codes

| Error Code | HTTP Status | Description |
|------------|-------------|-------------|
| `unsupported_grant_type` | 400 | Only `client_credentials` is supported |
| `invalid_client` | 401 | Invalid credentials or revoked client |
| `invalid_scope` | 400 | Requested scope not allowed |
| `invalid_request` | 400 | Missing or malformed parameters |
| `server_error` | 500 | Internal server error |

## Code Examples

### Creating an OAuth2 Client

```go
package main

import (
    "context"
    "database/sql"
    "time"

    "authz-engine/internal/auth"
)

func main() {
    // Setup database connection
    db, _ := sql.Open("postgres", "postgres://...")
    store := auth.NewPostgresOAuth2Store(db)

    // Create JWT issuer
    jwtIssuer, _ := auth.NewJWTIssuer("my-issuer", []byte("secret-key"))

    // Create OAuth2 handler
    handler := auth.NewOAuth2Handler(store, jwtIssuer)

    // Create a new client
    expiresAt := time.Now().Add(365 * 24 * time.Hour) // 1 year
    client, err := handler.CreateClient(
        context.Background(),
        "My API Client",           // name
        "tenant-123",              // tenant_id
        []string{"read", "write"}, // scopes
        "super-secret-password",   // client_secret
        &expiresAt,                // expires_at
    )

    if err != nil {
        panic(err)
    }

    fmt.Printf("Client ID: %s\n", client.ClientID)
}
```

### Setting Up HTTP Handler

```go
package main

import (
    "database/sql"
    "net/http"
    "time"

    "authz-engine/internal/api/rest"
    "authz-engine/internal/auth"
)

func main() {
    // Setup OAuth2 handler
    db, _ := sql.Open("postgres", "postgres://...")
    store := auth.NewPostgresOAuth2Store(db)
    jwtIssuer, _ := auth.NewJWTIssuer("issuer", []byte("key"))
    oauth2Handler := auth.NewOAuth2Handler(store, jwtIssuer)

    // Configure HTTP handler with rate limiting
    config := &rest.OAuth2Config{
        RateLimitPerClient: 60,         // 60 requests
        RateLimitWindow:    time.Minute, // per minute
    }
    httpHandler := rest.NewOAuth2HTTPHandler(oauth2Handler, config)

    // Register endpoint
    http.HandleFunc("/oauth/token", httpHandler.HandleTokenRequest)

    // Start server
    http.ListenAndServe(":8080", nil)
}
```

### Client Usage Example

```bash
# Get access token
curl -X POST http://localhost:8080/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "550e8400-e29b-41d4-a716-446655440000",
    "client_secret": "your-secret",
    "scope": "read write"
  }'

# Use token in API calls
curl http://localhost:8080/api/resource \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

## Rate Limiting

The implementation includes built-in rate limiting:

- **Per-client tracking** using client_id
- **Token bucket algorithm**
- **Configurable limits** (default: 60 req/min)
- **Automatic cleanup** of old entries
- **429 Too Many Requests** response when exceeded

## Testing

### Run Unit Tests

```bash
cd /Users/tommaduri/Documents/GitHub/authz-engine/go-core
go test ./internal/auth/tests -v
go test ./internal/api/rest/tests -v
```

### Test Coverage

- ✅ Successful token issuance
- ✅ Invalid grant type rejection
- ✅ Invalid credentials rejection
- ✅ Scope validation
- ✅ Revoked client handling
- ✅ Expired client handling
- ✅ Rate limiting enforcement
- ✅ JSON and form-encoded requests
- ✅ Error response formatting

## Security Considerations

1. **Secret Storage**: Client secrets are hashed with bcrypt (cost 12)
2. **No Plaintext**: Secrets never stored in plaintext
3. **Constant-time Comparison**: Uses bcrypt to prevent timing attacks
4. **Rate Limiting**: Prevents brute force attacks
5. **Token Expiration**: Access tokens expire (default: 1 hour)
6. **Scope Enforcement**: Clients limited to assigned scopes
7. **Revocation Support**: Clients can be revoked instantly

## Performance

- **Bcrypt Cost 12**: ~200-300ms per authentication (intentional slow-down)
- **Rate Limiting**: O(1) lookup per request
- **Database Indexes**: Optimized for tenant and active client queries
- **In-memory Cache**: Rate limiter uses in-memory tracking

## Migration

Run the migration to create the database schema:

```bash
migrate -path /Users/tommaduri/Documents/GitHub/authz-engine/go-core/migrations \
        -database "postgres://..." \
        up
```

## RFC 6749 References

- **Section 4.4**: Client Credentials Grant
- **Section 4.4.2**: Access Token Request
- **Section 5.1**: Successful Response
- **Section 5.2**: Error Response

## Integration with Existing Components

### JWT Integration

The OAuth2 handler uses the existing `JWTIssuer` to create access tokens:

```go
token, err := h.jwtIssuer.IssueToken(&TokenClaims{
    Subject:   client.ClientID.String(),
    TenantID:  client.TenantID,
    Scopes:    requestedScopes,
    IssuedAt:  now,
    ExpiresAt: expiresAt,
    TokenType: "access_token",
})
```

### Multi-tenancy

Each client belongs to a tenant, enabling:
- Tenant isolation
- Per-tenant client management
- Tenant-scoped access tokens

## Future Enhancements

- [ ] Token introspection endpoint (RFC 7662)
- [ ] Token revocation endpoint (RFC 7009)
- [ ] Refresh tokens support
- [ ] Dynamic client registration (RFC 7591)
- [ ] Client authentication methods (RFC 8705)
- [ ] PKCE support (RFC 7636)

## Memory Keys

Implementation stored in swarm memory:
- `swarm/phase6-completion/oauth2/core` - Core OAuth2 handler
- `swarm/phase6-completion/oauth2/handler` - HTTP handler implementation
