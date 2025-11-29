# RSA Key Rotation Guide

## Overview

The authorization engine implements zero-downtime RSA key rotation with a blue-green deployment strategy. Multiple keys can be active simultaneously during a grace period, ensuring seamless token validation during rotation.

## Architecture

### Components

1. **KeyRotationManager** (`internal/auth/keyrotation.go`)
   - Generates new RSA key pairs
   - Manages key lifecycle (pending → active → expired)
   - Implements blue-green rotation

2. **JWKSManager** (`internal/auth/jwks_manager.go`)
   - Exposes JWKS endpoint with all active keys
   - Converts RSA keys to JWK format
   - Validates JWKS structure

3. **JWTIssuer** (`internal/auth/jwt_issuer_integration.go`)
   - Issues tokens using the active key
   - Verifies tokens against any active key (by KID)
   - Supports token refresh

4. **KeysHandler** (`internal/api/rest/keys_handler.go`)
   - REST API for key management
   - Rotation endpoint
   - Key listing and expiration

### Database Schema

```sql
CREATE TABLE signing_keys (
  kid VARCHAR(36) PRIMARY KEY,
  private_key_encrypted TEXT NOT NULL,
  public_key TEXT NOT NULL,
  algorithm VARCHAR(10) DEFAULT 'RS256',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'pending'
);
```

## Key Rotation Process

### Blue-Green Rotation Flow

```
┌─────────────────────────────────────────────────────────┐
│ Step 1: Initial State                                  │
│ Active Key: key-1 (no expiration)                      │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ Step 2: Rotation Triggered (POST /v1/auth/keys/rotate) │
│ - Generate new key-2 (status: pending)                 │
│ - Activate key-2 (status: active, activated_at: now)   │
│ - Set key-1 expiration (expires_at: now + 30 days)     │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ Step 3: Grace Period (0-30 days)                       │
│ Active Keys: key-1 (expires in 30 days), key-2         │
│ - New tokens signed with key-2                         │
│ - Old tokens (key-1) still valid                       │
│ - JWKS returns both keys                               │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ Step 4: After 30 Days                                  │
│ - key-1 automatically expires                          │
│ - Only key-2 active                                    │
│ - JWKS returns only key-2                              │
└─────────────────────────────────────────────────────────┘
```

### API Endpoints

#### 1. Rotate Keys

**POST /v1/auth/keys/rotate**

Generates a new key and activates it, setting expiration on the previous key.

**Request:**
```bash
curl -X POST http://localhost:8080/v1/auth/keys/rotate
```

**Response:**
```json
{
  "success": true,
  "new_key_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "activated_at": "2025-11-27T10:00:00Z",
  "message": "Key rotation successful. Old keys will remain valid for 30 days.",
  "active_keys_count": 2
}
```

#### 2. Get JWKS

**GET /v1/auth/.well-known/jwks.json**

Returns all active keys in JWKS format.

**Response:**
```json
{
  "keys": [
    {
      "kid": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "kty": "RSA",
      "alg": "RS256",
      "use": "sig",
      "n": "xGOr-H7A...",
      "e": "AQAB",
      "x5t": "NzbLsXh8uD..."
    },
    {
      "kid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "kty": "RSA",
      "alg": "RS256",
      "use": "sig",
      "n": "yHPs-I8B...",
      "e": "AQAB",
      "x5t": "MzaKrYi9vE..."
    }
  ]
}
```

#### 3. List Keys

**GET /v1/auth/keys**

Returns metadata for all active keys.

**Response:**
```json
{
  "keys": [
    {
      "kid": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "algorithm": "RS256",
      "status": "active",
      "created_at": "2025-11-27T10:00:00Z",
      "activated_at": "2025-11-27T10:00:00Z",
      "expires_at": null
    },
    {
      "kid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "algorithm": "RS256",
      "status": "active",
      "created_at": "2025-10-28T09:00:00Z",
      "activated_at": "2025-10-28T09:00:00Z",
      "expires_at": "2025-11-27T09:00:00Z"
    }
  ]
}
```

#### 4. Expire Old Keys

**POST /v1/auth/keys/expire**

Manually expires keys that have passed their grace period.

**Response:**
```json
{
  "success": true,
  "expired_count": 1,
  "message": "Successfully expired old keys"
}
```

## Token Verification Flow

```
┌─────────────────────────────────────────────────────────┐
│ Client sends JWT with header:                          │
│ {                                                       │
│   "alg": "RS256",                                       │
│   "kid": "f47ac10b-58cc-4372-a567-0e02b2c3d479"        │
│ }                                                       │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ Server extracts KID from header                         │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ Fetch all active keys (status=active, not expired)     │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ Find key matching KID                                   │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ Verify signature with public key                       │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ Validate claims (exp, iss, aud)                         │
└─────────────────────────────────────────────────────────┘
```

## Usage Examples

### Initializing the System

```go
import (
    "database/sql"
    "github.com/authz-engine/go-core/internal/auth"
)

// Generate encryption key (store securely, e.g., in environment variable)
encryptionKey, err := auth.GenerateAESKey()
if err != nil {
    log.Fatal(err)
}

// Initialize components
encryptor, err := auth.NewAESKeyEncryptor(encryptionKey)
if err != nil {
    log.Fatal(err)
}

db, err := sql.Open("postgres", connString)
if err != nil {
    log.Fatal(err)
}

rotationMgr := auth.NewKeyRotationManager(db, encryptor)
jwksMgr := auth.NewJWKSManager(rotationMgr)
jwtIssuer := auth.NewJWTIssuer(rotationMgr, "https://auth.example.com", "https://api.example.com")
```

### Issuing a Token

```go
ctx := context.Background()

token, err := jwtIssuer.IssueToken(
    ctx,
    "user@example.com",           // subject
    24 * time.Hour,                // expires in
    "read write",                  // scope
    []string{"users:read", "posts:write"}, // permissions
)
if err != nil {
    log.Fatal(err)
}

fmt.Println("Token:", token)
```

### Verifying a Token

```go
claims, err := jwtIssuer.VerifyToken(ctx, token)
if err != nil {
    log.Fatal(err)
}

fmt.Printf("Subject: %s\n", claims.Subject)
fmt.Printf("Permissions: %v\n", claims.Permissions)
```

### Rotating Keys

```go
newKey, err := rotationMgr.RotateKeys(ctx)
if err != nil {
    log.Fatal(err)
}

fmt.Printf("New key activated: %s\n", newKey.KID)
```

## Security Considerations

### Encryption

- Private keys are encrypted using AES-256-GCM before storage
- Encryption key must be stored securely (environment variable, secrets manager)
- Never commit encryption keys to version control

### Key Management

- Default grace period: 30 days
- Minimum recommended rotation frequency: Every 90 days
- Maximum recommended rotation frequency: Every 7 days

### Best Practices

1. **Automate Rotation**: Set up cron job or scheduled task
   ```bash
   # Rotate keys monthly
   0 0 1 * * curl -X POST http://localhost:8080/v1/auth/keys/rotate
   ```

2. **Monitor Expiration**: Alert when keys are about to expire
   ```sql
   SELECT kid, expires_at
   FROM signing_keys
   WHERE status = 'active'
     AND expires_at < NOW() + INTERVAL '7 days';
   ```

3. **Audit Logging**: Log all rotation events
   ```go
   log.Printf("Key rotated: old=%s, new=%s", oldKID, newKID)
   ```

4. **Backup Keys**: Export and securely store keys
   ```bash
   # Export to encrypted backup
   pg_dump -t signing_keys authz_db | gpg -e > keys_backup.sql.gpg
   ```

## Troubleshooting

### Token Verification Fails

**Problem**: Tokens fail verification after rotation

**Solution**: Check JWKS endpoint returns all active keys
```bash
curl http://localhost:8080/v1/auth/.well-known/jwks.json | jq '.keys | length'
```

### Old Keys Not Expiring

**Problem**: Keys remain active past grace period

**Solution**: Manually trigger expiration
```bash
curl -X POST http://localhost:8080/v1/auth/keys/expire
```

### Cannot Decrypt Private Key

**Problem**: Decryption fails

**Causes**:
- Encryption key changed
- Database corruption
- Wrong encryption algorithm

**Solution**: Restore from backup or regenerate keys

## Maintenance

### Cleanup Expired Keys

Run periodically to remove old expired keys:

```sql
DELETE FROM signing_keys
WHERE status = 'expired'
  AND expires_at < NOW() - INTERVAL '90 days';
```

### Key Statistics

Monitor key usage:

```sql
SELECT
  status,
  COUNT(*) as count,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM signing_keys
GROUP BY status;
```

## References

- [RFC 7517: JSON Web Key (JWK)](https://tools.ietf.org/html/rfc7517)
- [RFC 7519: JSON Web Token (JWT)](https://tools.ietf.org/html/rfc7519)
- [NIST SP 800-57: Key Management](https://csrc.nist.gov/publications/detail/sp/800-57-part-1/rev-5/final)
