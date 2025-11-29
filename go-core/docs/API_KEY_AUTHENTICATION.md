# API Key Authentication

This document describes the API key authentication system for the AuthZ Engine.

## Overview

The API key authentication system provides a secure, scalable way to authenticate agents and services using cryptographic keys. It supports:

- **Secure key generation**: `authz_` prefix + 32 bytes of cryptographic randomness
- **SHA-256 hashing**: Keys are never stored in plaintext
- **Per-key rate limiting**: Default 100 requests/second, configurable per key
- **Key rotation**: Multiple active keys per agent
- **Expiration support**: Optional time-based expiration
- **Revocation**: Instant key revocation
- **Audit logging**: All key operations are logged

## Key Format

API keys follow this format:
```
authz_<base64url-encoded-32-bytes>
```

Example:
```
authz_dGVzdGtleTEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMw
```

## Database Schema

```sql
CREATE TABLE api_keys (
  key_id UUID PRIMARY KEY,
  key_hash VARCHAR(64) NOT NULL UNIQUE,     -- SHA-256 hash
  key_prefix VARCHAR(10) NOT NULL,           -- First 8 chars for identification
  agent_id VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  scopes TEXT[],
  rate_limit_per_sec INT DEFAULT 100,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
```

## API Endpoints

### Create API Key

**POST** `/v1/auth/keys`

Request:
```json
{
  "agent_id": "shopping-bot",
  "tenant_id": "acme-corp",
  "name": "Production API Key",
  "scopes": ["read", "write"],
  "rate_limit_per_sec": 200,
  "expires_at": "2025-12-31T23:59:59Z"
}
```

Response:
```json
{
  "key": "authz_dGVzdGtleTEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMw",
  "metadata": {
    "key_id": "550e8400-e29b-41d4-a716-446655440000",
    "key_prefix": "authz_dG",
    "agent_id": "shopping-bot",
    "tenant_id": "acme-corp",
    "name": "Production API Key",
    "scopes": ["read", "write"],
    "rate_limit_per_sec": 200,
    "created_at": "2025-11-27T10:00:00Z",
    "expires_at": "2025-12-31T23:59:59Z"
  }
}
```

**Important**: The `key` field is only returned once during creation. Store it securely.

### List API Keys

**GET** `/v1/auth/keys?agent_id=shopping-bot&tenant_id=acme-corp&include_revoked=false`

Response:
```json
{
  "keys": [
    {
      "key_id": "550e8400-e29b-41d4-a716-446655440000",
      "key_prefix": "authz_dG",
      "agent_id": "shopping-bot",
      "tenant_id": "acme-corp",
      "name": "Production API Key",
      "scopes": ["read", "write"],
      "rate_limit_per_sec": 200,
      "created_at": "2025-11-27T10:00:00Z",
      "last_used_at": "2025-11-27T11:30:00Z",
      "expires_at": "2025-12-31T23:59:59Z"
    }
  ],
  "count": 1
}
```

### Get API Key

**GET** `/v1/auth/keys/{key_id}`

Response:
```json
{
  "key_id": "550e8400-e29b-41d4-a716-446655440000",
  "key_prefix": "authz_dG",
  "agent_id": "shopping-bot",
  "tenant_id": "acme-corp",
  "name": "Production API Key",
  "scopes": ["read", "write"],
  "rate_limit_per_sec": 200,
  "created_at": "2025-11-27T10:00:00Z",
  "last_used_at": "2025-11-27T11:30:00Z"
}
```

### Revoke API Key

**DELETE** `/v1/auth/keys/{key_id}`

or

**POST** `/v1/auth/keys/{key_id}/revoke`

Response:
```json
{
  "message": "API key revoked successfully",
  "key_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Using API Keys

### HTTP Header Authentication

Include the API key in the `X-API-Key` header:

```bash
curl -H "X-API-Key: authz_dGVzdGtleTEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMw" \
  https://api.example.com/v1/authz/check
```

### Authentication Priority

The middleware checks authentication in this order:

1. **X-API-Key header** (checked first)
2. **Authorization: Bearer <token>** (JWT fallback)

If an X-API-Key header is present, it takes priority over Bearer tokens.

## Rate Limiting

Each API key has its own rate limiter based on the `rate_limit_per_sec` value:

- Default: 100 requests/second
- Burst size: Equal to rate limit
- Algorithm: Token bucket

Rate limit exceeded response:
```json
HTTP/1.1 429 Too Many Requests
{
  "error": "Rate limit exceeded",
  "status": 429
}
```

## Scopes

Scopes control what actions an API key can perform:

- **Empty array**: All scopes allowed (wildcard)
- **Specific scopes**: `["read", "write", "admin"]`
- **Wildcard**: `["*"]` - explicitly allow all

Use the `RequireScope` middleware to enforce scope requirements:

```go
router.Handle("/admin",
  authMiddleware.RequireScope("admin")(adminHandler))
```

## Key Rotation

Best practices for key rotation:

1. Create a new API key
2. Update your application to use the new key
3. Monitor usage of the old key
4. Revoke the old key once traffic has migrated

Example:
```bash
# Create new key
curl -X POST /v1/auth/keys -d '{
  "agent_id": "my-agent",
  "tenant_id": "my-tenant",
  "name": "Rotation Key 2025-11"
}'

# Update application configuration
# Monitor old key usage in last_used_at field

# Revoke old key
curl -X DELETE /v1/auth/keys/{old_key_id}
```

## Security Considerations

### Storage
- **Never log API keys**: Use `MaskKey()` for logging
- **Never store plaintext keys**: Only store SHA-256 hashes
- **Secure transmission**: Always use HTTPS
- **Secret management**: Use environment variables or secret managers

### Validation
- All keys are validated on every request
- Expired keys are rejected immediately
- Revoked keys are rejected immediately
- Invalid format keys are rejected before database lookup

### Monitoring
- Track `last_used_at` for unusual activity
- Monitor rate limit violations
- Alert on revoked key usage attempts

## Error Responses

| Status Code | Error | Description |
|-------------|-------|-------------|
| 401 | Unauthorized | No authentication provided |
| 401 | Invalid API key | Key format is invalid |
| 401 | API key has expired | Key has passed expiration date |
| 401 | API key has been revoked | Key was revoked |
| 403 | Insufficient scope | Key lacks required scope |
| 429 | Rate limit exceeded | Too many requests |

## Code Examples

### Go Client

```go
import "net/http"

client := &http.Client{}
req, _ := http.NewRequest("GET", "https://api.example.com/v1/authz/check", nil)
req.Header.Set("X-API-Key", "authz_your_key_here")
resp, _ := client.Do(req)
```

### Python Client

```python
import requests

headers = {
    'X-API-Key': 'authz_your_key_here'
}

response = requests.get('https://api.example.com/v1/authz/check', headers=headers)
```

### JavaScript/Node.js Client

```javascript
const fetch = require('node-fetch');

fetch('https://api.example.com/v1/authz/check', {
  headers: {
    'X-API-Key': 'authz_your_key_here'
  }
})
.then(res => res.json())
.then(data => console.log(data));
```

## Maintenance

### Cleanup Expired Keys

Run periodic cleanup to remove old expired keys:

```go
ctx := context.Background()
count, err := store.CleanupExpiredKeys(ctx, 30*24*time.Hour) // 30 days
fmt.Printf("Cleaned up %d expired keys\n", count)
```

### Monitor Rate Limiters

Rate limiters are cleaned up automatically every hour by default. Adjust the interval:

```go
middleware.CleanupRateLimiters(30 * time.Minute)
```
