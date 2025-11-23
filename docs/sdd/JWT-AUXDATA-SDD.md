# JWT and Auxiliary Data - Software Design Document

**Module**: `@authz-engine/core/auxdata`
**Version**: 1.0.0
**Status**: Draft
**Author**: AuthZ Engine Team
**Created**: 2024-11-23
**Last Updated**: 2024-11-23
**Reviewers**: Security Team, Platform Team

---

## 1. Overview

### 1.1 Purpose
Auxiliary data (auxData) provides a mechanism for passing additional context to policy evaluation beyond principal and resource attributes. The primary use case is JWT token validation, enabling CEL expressions to access verified token claims for fine-grained authorization decisions.

### 1.2 Scope

**In Scope:**
- JWT token validation and claim extraction
- JWKS (JSON Web Key Set) integration for key management
- Token caching and refresh strategies
- CEL integration for claim-based conditions
- Multiple key set support (remote and local)

**Out of Scope:**
- JWT token generation/issuance
- OAuth/OIDC flow implementation
- Session management
- User authentication

### 1.3 Context
The JWT auxiliary data system integrates with the CEL Evaluator and Decision Engine, allowing policies to reference validated JWT claims in conditions. This enables scenarios such as verifying token scopes, checking custom claims, and validating issuer/audience pairs.

### 1.4 Key Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Support multiple key sets | Different issuers use different keys | Single key set (limited) |
| Cache validated tokens | Performance optimization | No caching (slower) |
| Fail-closed on validation error | Security best practice | Fail-open (insecure) |
| Support RS256, ES256, HS256 | Industry standard algorithms | Limited algorithms |

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-001 | Validate JWT signatures using configured key sets | Must Have | Pending |
| FR-002 | Support remote JWKS endpoints with automatic refresh | Must Have | Pending |
| FR-003 | Support local/static key configuration | Must Have | Pending |
| FR-004 | Expose validated claims in CEL evaluation context | Must Have | Pending |
| FR-005 | Cache validated tokens to reduce overhead | Should Have | Pending |
| FR-006 | Handle key rotation gracefully | Must Have | Pending |
| FR-007 | Validate token expiration with configurable skew | Must Have | Pending |
| FR-008 | Support issuer and audience validation | Must Have | Pending |

### 2.2 Non-Functional Requirements

| ID | Category | Requirement | Target |
|----|----------|-------------|--------|
| NFR-001 | Performance | JWT validation latency | < 2ms (cached), < 10ms (uncached) |
| NFR-002 | Performance | JWKS fetch timeout | < 5 seconds |
| NFR-003 | Reliability | JWKS refresh resilience | Retry with exponential backoff |
| NFR-004 | Security | Algorithm restriction | Configurable allowlist |
| NFR-005 | Security | Key rotation | Zero-downtime support |

---

## 3. Architecture

### 3.1 Component Diagram

```
+-------------------------------------------------------------------------+
|                          AuthZ Engine Core                               |
+-------------------------------------------------------------------------+
|                                                                          |
|  +------------------+     +------------------+     +------------------+  |
|  |  Check Request   |---->|  AuxData Handler |---->| Decision Engine  |  |
|  |  (with JWT)      |     |                  |     |                  |  |
|  +------------------+     +--------+---------+     +------------------+  |
|                                    |                                     |
|                           +--------v---------+                           |
|                           |  JWT Validator   |                           |
|                           +--------+---------+                           |
|                                    |                                     |
|         +----------------+---------+---------+----------------+          |
|         |                |                   |                |          |
|  +------v------+  +------v------+  +--------v--------+  +----v-----+    |
|  | Signature   |  | Expiration  |  | Issuer/Audience |  | Claims   |    |
|  | Verifier    |  | Checker     |  | Validator       |  | Extractor|    |
|  +------+------+  +-------------+  +-----------------+  +----+-----+    |
|         |                                                    |           |
|  +------v------+                                      +------v------+   |
|  | JWKS Manager|                                      | Token Cache |   |
|  +------+------+                                      +-------------+   |
|         |                                                                |
|  +------v------------------------+                                      |
|  |        Key Set Storage        |                                      |
|  |  +----------+  +----------+   |                                      |
|  |  |  Remote  |  |  Local   |   |                                      |
|  |  |  (JWKS)  |  |  (JWK)   |   |                                      |
|  |  +----------+  +----------+   |                                      |
|  +-------------------------------+                                      |
|                                                                          |
+-------------------------------------------------------------------------+
```

### 3.2 Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| AuxData Handler | Extracts and routes auxiliary data from requests |
| JWT Validator | Orchestrates token validation pipeline |
| Signature Verifier | Validates JWT signatures using JWKS/JWK keys |
| Expiration Checker | Validates token exp/iat claims with skew tolerance |
| Issuer/Audience Validator | Validates iss and aud claims against config |
| Claims Extractor | Extracts and normalizes claims for CEL context |
| JWKS Manager | Fetches, caches, and refreshes remote key sets |
| Token Cache | Caches validated token results |

### 3.3 Data Flow

```
[Request with JWT]
       |
       v
+------+------+
| Parse Token | (Extract header, payload, signature)
+------+------+
       |
       v
+------+------+
| Check Cache | --> [HIT] --> Return cached result
+------+------+
       | [MISS]
       v
+------+------+
| Get Key Set | (Select by keySetId or kid)
+------+------+
       |
       v
+------+------+
| Verify Sig  | --> [INVALID] --> Return error
+------+------+
       | [VALID]
       v
+------+------+
| Check Exp   | --> [EXPIRED] --> Return error
+------+------+
       | [VALID]
       v
+------+------+
| Validate    | --> [MISMATCH] --> Return error
| Iss/Aud     |
+------+------+
       | [VALID]
       v
+------+------+
| Cache Result|
+------+------+
       |
       v
[Return Claims to CEL Context]
```

---

## 4. Data Models

### 4.1 TypeScript Interfaces

```typescript
/**
 * Auxiliary data passed with authorization requests
 */
interface AuxData {
  /** JWT token data */
  jwt?: JWTAuxData;
  /** Additional custom context */
  [key: string]: unknown;
}

/**
 * JWT-specific auxiliary data
 */
interface JWTAuxData {
  /** The raw JWT token string */
  token: string;
  /** Key set identifier for signature verification */
  keySetId?: string;
}

/**
 * JWT validation and key management configuration
 */
interface JWTConfig {
  /** Configured key sets for signature verification */
  keySets: KeySetConfig[];
  /** Acceptable clock skew in seconds (default: 5) */
  acceptableTimeSkew?: number;
  /** Token cache configuration */
  cacheConfig?: TokenCacheConfig;
  /** Required token issuer (optional global setting) */
  requiredIssuer?: string;
  /** Required token audience (optional global setting) */
  requiredAudience?: string | string[];
  /** Allowed signature algorithms (default: RS256, ES256) */
  allowedAlgorithms?: Algorithm[];
}

/**
 * Key set configuration (remote JWKS or local keys)
 */
interface KeySetConfig {
  /** Unique identifier for this key set */
  id: string;
  /** Remote JWKS endpoint configuration */
  remote?: RemoteKeySetConfig;
  /** Local/static key configuration */
  local?: LocalKeySetConfig;
  /** Expected issuer for tokens using this key set */
  issuer?: string;
  /** Expected audience for tokens using this key set */
  audience?: string | string[];
}

/**
 * Remote JWKS endpoint configuration
 */
interface RemoteKeySetConfig {
  /** JWKS endpoint URL */
  url: string;
  /** Key refresh interval in seconds (default: 3600) */
  refreshInterval?: number;
  /** Request timeout in milliseconds (default: 5000) */
  timeout?: number;
  /** Custom headers for JWKS requests */
  headers?: Record<string, string>;
}

/**
 * Local/static key configuration
 */
interface LocalKeySetConfig {
  /** Array of JWK (JSON Web Key) objects */
  keys: JWK[];
}

/**
 * Token cache configuration
 */
interface TokenCacheConfig {
  /** Maximum number of cached tokens (default: 1000) */
  maxSize: number;
  /** Cache TTL in seconds (default: 300) */
  ttl: number;
  /** Whether to cache validation failures (default: false) */
  cacheFailures?: boolean;
}

/**
 * Decoded and validated JWT structure
 */
interface DecodedJWT {
  /** Token issuer */
  iss: string;
  /** Token subject (typically user ID) */
  sub: string;
  /** Token audience */
  aud: string | string[];
  /** Expiration timestamp (Unix seconds) */
  exp: number;
  /** Issued-at timestamp (Unix seconds) */
  iat: number;
  /** Not-before timestamp (Unix seconds) */
  nbf?: number;
  /** JWT ID */
  jti?: string;
  /** Custom claims */
  [key: string]: unknown;
}

/**
 * JWT validation result
 */
interface JWTValidationResult {
  /** Whether validation succeeded */
  valid: boolean;
  /** Decoded claims (if valid) */
  claims?: DecodedJWT;
  /** Error details (if invalid) */
  error?: JWTValidationError;
}

/**
 * JWT validation error details
 */
interface JWTValidationError {
  /** Error code */
  code: JWTErrorCode;
  /** Human-readable message */
  message: string;
  /** Additional context */
  details?: Record<string, unknown>;
}

type JWTErrorCode =
  | 'INVALID_TOKEN_FORMAT'
  | 'INVALID_SIGNATURE'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_NOT_YET_VALID'
  | 'INVALID_ISSUER'
  | 'INVALID_AUDIENCE'
  | 'KEY_NOT_FOUND'
  | 'UNSUPPORTED_ALGORITHM'
  | 'JWKS_FETCH_ERROR';

type Algorithm = 'RS256' | 'RS384' | 'RS512' | 'ES256' | 'ES384' | 'ES512' | 'HS256' | 'HS384' | 'HS512';
```

### 4.2 JWK (JSON Web Key) Structure

```typescript
/**
 * JSON Web Key structure
 */
interface JWK {
  /** Key type (RSA, EC, oct) */
  kty: 'RSA' | 'EC' | 'oct';
  /** Public key use (sig for signature) */
  use?: 'sig' | 'enc';
  /** Key ID */
  kid?: string;
  /** Algorithm */
  alg?: Algorithm;

  // RSA-specific fields
  n?: string;  // Modulus
  e?: string;  // Exponent

  // EC-specific fields
  crv?: string;  // Curve (P-256, P-384, P-521)
  x?: string;    // X coordinate
  y?: string;    // Y coordinate

  // Symmetric key
  k?: string;  // Key value (base64url)
}
```

---

## 5. JWT Validation

### 5.1 Validation Pipeline

```typescript
class JWTValidator {
  constructor(private config: JWTConfig) {}

  async validate(token: string, keySetId?: string): Promise<JWTValidationResult> {
    // Step 1: Parse token structure
    const parsed = this.parseToken(token);
    if (!parsed.success) {
      return { valid: false, error: parsed.error };
    }

    // Step 2: Check cache
    const cached = this.cache.get(token);
    if (cached) {
      return cached;
    }

    // Step 3: Get signing key
    const key = await this.getSigningKey(parsed.header, keySetId);
    if (!key) {
      return { valid: false, error: { code: 'KEY_NOT_FOUND', message: 'No matching key found' }};
    }

    // Step 4: Verify signature
    const signatureValid = await this.verifySignature(token, key);
    if (!signatureValid) {
      return { valid: false, error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' }};
    }

    // Step 5: Validate claims
    const claimsResult = this.validateClaims(parsed.payload, keySetId);
    if (!claimsResult.valid) {
      return claimsResult;
    }

    // Step 6: Cache and return
    const result = { valid: true, claims: parsed.payload };
    this.cache.set(token, result);
    return result;
  }
}
```

### 5.2 Signature Verification

| Algorithm | Key Type | Description |
|-----------|----------|-------------|
| RS256 | RSA | RSASSA-PKCS1-v1_5 using SHA-256 |
| RS384 | RSA | RSASSA-PKCS1-v1_5 using SHA-384 |
| RS512 | RSA | RSASSA-PKCS1-v1_5 using SHA-512 |
| ES256 | EC | ECDSA using P-256 and SHA-256 |
| ES384 | EC | ECDSA using P-384 and SHA-384 |
| ES512 | EC | ECDSA using P-521 and SHA-512 |
| HS256 | Symmetric | HMAC using SHA-256 |
| HS384 | Symmetric | HMAC using SHA-384 |
| HS512 | Symmetric | HMAC using SHA-512 |

### 5.3 Expiration Checking

```typescript
validateExpiration(claims: DecodedJWT): JWTValidationResult {
  const now = Math.floor(Date.now() / 1000);
  const skew = this.config.acceptableTimeSkew ?? 5;

  // Check exp (expiration)
  if (claims.exp && claims.exp + skew < now) {
    return {
      valid: false,
      error: {
        code: 'TOKEN_EXPIRED',
        message: `Token expired at ${new Date(claims.exp * 1000).toISOString()}`,
        details: { exp: claims.exp, now, skew }
      }
    };
  }

  // Check nbf (not before)
  if (claims.nbf && claims.nbf - skew > now) {
    return {
      valid: false,
      error: {
        code: 'TOKEN_NOT_YET_VALID',
        message: `Token not valid until ${new Date(claims.nbf * 1000).toISOString()}`,
        details: { nbf: claims.nbf, now, skew }
      }
    };
  }

  return { valid: true, claims };
}
```

---

## 6. CEL Integration

### 6.1 Context Structure

Validated JWT claims are exposed in the CEL evaluation context:

```typescript
// CEL context structure when JWT is present
{
  request: {
    principal: { /* ... */ },
    resource: { /* ... */ },
    auxData: {
      jwt: {
        // Standard claims
        iss: "https://auth.example.com",
        sub: "user-123",
        aud: "api.example.com",
        exp: 1700000000,
        iat: 1699996400,

        // Custom claims (flattened)
        claims: {
          role: "admin",
          permissions: ["documents:read", "documents:write"],
          department: "engineering",
          tenant_id: "acme-corp"
        }
      }
    }
  }
}
```

### 6.2 CEL Expression Examples

```yaml
# Check JWT role claim
condition:
  match:
    expr: request.auxData.jwt.claims.role == "admin"

# Verify token issuer
condition:
  match:
    expr: request.auxData.jwt.iss == "https://auth.example.com"

# Check array permissions
condition:
  match:
    expr: '"documents:write" in request.auxData.jwt.claims.permissions'

# Combine JWT and resource attributes
condition:
  match:
    all:
      of:
        - expr: request.auxData.jwt.claims.tenant_id == resource.attr.tenantId
        - expr: '"editor" in request.auxData.jwt.claims.roles'

# Time-based condition with JWT expiration
condition:
  match:
    expr: request.auxData.jwt.exp > now

# Subject validation (user owns resource)
condition:
  match:
    expr: request.auxData.jwt.sub == resource.attr.ownerId

# Multiple audience validation
condition:
  match:
    expr: '"api.example.com" in request.auxData.jwt.aud'
```

### 6.3 Shorthand Access

For convenience, JWT claims can also be accessed via shorthand:

```yaml
# Full path
condition:
  match:
    expr: request.auxData.jwt.claims.role == "admin"

# Shorthand (when jwt is the only auxData)
condition:
  match:
    expr: jwt.role == "admin"
```

---

## 7. JWKS Management

### 7.1 Remote JWKS Configuration

```yaml
auxData:
  jwt:
    keySets:
      - id: auth0
        remote:
          url: https://example.auth0.com/.well-known/jwks.json
          refreshInterval: 3600  # 1 hour
          timeout: 5000          # 5 seconds
        issuer: https://example.auth0.com/
        audience: https://api.example.com

      - id: okta
        remote:
          url: https://example.okta.com/oauth2/v1/keys
          refreshInterval: 7200  # 2 hours
          headers:
            Authorization: "Bearer ${OKTA_API_TOKEN}"
        issuer: https://example.okta.com
```

### 7.2 Key Rotation Handling

```typescript
class JWKSManager {
  private keySets: Map<string, CachedKeySet> = new Map();

  async getKey(keySetId: string, kid: string): Promise<JWK | null> {
    let keySet = this.keySets.get(keySetId);

    // Check if refresh needed
    if (!keySet || this.isStale(keySet)) {
      keySet = await this.refreshKeySet(keySetId);
    }

    // Find key by kid
    let key = keySet.keys.find(k => k.kid === kid);

    // Key not found - force refresh once (handle rotation)
    if (!key && !keySet.justRefreshed) {
      keySet = await this.refreshKeySet(keySetId, true);
      key = keySet.keys.find(k => k.kid === kid);
    }

    return key ?? null;
  }

  private async refreshKeySet(id: string, force = false): Promise<CachedKeySet> {
    const config = this.getConfig(id);

    try {
      const response = await fetch(config.remote.url, {
        timeout: config.remote.timeout ?? 5000,
        headers: config.remote.headers
      });

      const jwks = await response.json();
      const cached: CachedKeySet = {
        keys: jwks.keys,
        fetchedAt: Date.now(),
        justRefreshed: force
      };

      this.keySets.set(id, cached);
      return cached;
    } catch (error) {
      // Return stale keys if available, otherwise throw
      const existing = this.keySets.get(id);
      if (existing) {
        return existing;
      }
      throw new JWKSFetchError(`Failed to fetch JWKS: ${error.message}`);
    }
  }
}
```

### 7.3 Fallback Behavior

| Scenario | Behavior |
|----------|----------|
| JWKS fetch fails, cached keys exist | Use cached keys, log warning |
| JWKS fetch fails, no cached keys | Fail validation with JWKS_FETCH_ERROR |
| Key not found after refresh | Fail validation with KEY_NOT_FOUND |
| JWKS returns empty keys array | Fail validation with KEY_NOT_FOUND |

---

## 8. Error Handling

### 8.1 Error Types

| Error Code | Description | Recovery |
|------------|-------------|----------|
| INVALID_TOKEN_FORMAT | Token is not valid JWT format | Client must provide valid JWT |
| INVALID_SIGNATURE | Signature verification failed | Check key configuration |
| TOKEN_EXPIRED | Token exp claim is in the past | Client must refresh token |
| TOKEN_NOT_YET_VALID | Token nbf claim is in the future | Wait or check clock sync |
| INVALID_ISSUER | Token iss doesn't match config | Check token source |
| INVALID_AUDIENCE | Token aud doesn't match config | Check token audience |
| KEY_NOT_FOUND | No key found for token's kid | Check JWKS configuration |
| UNSUPPORTED_ALGORITHM | Token uses disallowed algorithm | Configure allowed algorithms |
| JWKS_FETCH_ERROR | Failed to fetch remote JWKS | Check network/endpoint |

### 8.2 Error Response Structure

```typescript
// Authorization response with JWT error
{
  requestId: "req-123",
  resourceId: "doc-456",
  actions: {
    "read": {
      effect: "EFFECT_DENY",
      policy: "jwt-validation",
      meta: {
        error: {
          code: "TOKEN_EXPIRED",
          message: "JWT token has expired"
        }
      }
    }
  }
}
```

### 8.3 Logging

```typescript
// Error logging levels
| Severity | Condition |
|----------|-----------|
| ERROR    | JWKS fetch failure (no fallback) |
| WARN     | JWKS fetch failure (using cache) |
| WARN     | Token validation failure |
| INFO     | JWKS refresh completed |
| DEBUG    | Token validation success |
```

---

## 9. Security Considerations

### 9.1 Token Validation Best Practices

- **Always verify signatures**: Never trust unsigned tokens
- **Validate all standard claims**: iss, aud, exp, nbf
- **Restrict algorithms**: Only allow configured algorithms
- **Use HTTPS for JWKS**: Never fetch keys over HTTP
- **Implement key pinning**: For high-security environments

### 9.2 Claim Sanitization

```typescript
function sanitizeClaims(claims: DecodedJWT): Record<string, unknown> {
  // Remove sensitive fields from CEL context
  const {
    // Remove signature-related data
    _signature,
    // Remove internal fields
    _raw,
    ...safeClaims
  } = claims;

  // Ensure arrays are actually arrays
  if (safeClaims.aud && !Array.isArray(safeClaims.aud)) {
    safeClaims.aud = [safeClaims.aud];
  }

  return safeClaims;
}
```

### 9.3 Preventing Token Confusion Attacks

| Attack | Mitigation |
|--------|------------|
| Algorithm confusion (none) | Reject 'none' algorithm |
| Key confusion (RSA/HMAC) | Validate key type matches algorithm |
| Issuer spoofing | Strict issuer validation per key set |
| Audience confusion | Validate audience for each key set |
| Token replay | Use jti claim and maintain deny list |

### 9.4 Security Configuration

```yaml
auxData:
  jwt:
    # Only allow asymmetric algorithms (more secure)
    allowedAlgorithms:
      - RS256
      - ES256

    # Strict time validation
    acceptableTimeSkew: 5  # seconds

    # Cache configuration
    cacheConfig:
      maxSize: 1000
      ttl: 300
      cacheFailures: false  # Don't cache failures
```

---

## 10. Configuration Examples

### 10.1 Complete Configuration

```yaml
auxData:
  jwt:
    keySets:
      # Auth0 (primary IdP)
      - id: auth0
        remote:
          url: https://example.auth0.com/.well-known/jwks.json
          refreshInterval: 3600
          timeout: 5000
        issuer: https://example.auth0.com/
        audience: https://api.example.com

      # Internal service tokens
      - id: internal
        local:
          keys:
            - kty: RSA
              use: sig
              kid: internal-2024
              alg: RS256
              n: "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM..."
              e: "AQAB"
        issuer: https://internal.example.com
        audience: internal-services

      # Partner integration
      - id: partner-acme
        remote:
          url: https://auth.acme.com/.well-known/jwks.json
          refreshInterval: 7200
          headers:
            X-Partner-ID: "example-corp"
        issuer: https://auth.acme.com
        audience: partner-api

    # Global settings
    acceptableTimeSkew: 5
    allowedAlgorithms:
      - RS256
      - ES256

    cacheConfig:
      maxSize: 5000
      ttl: 300
```

### 10.2 Request with JWT

```json
{
  "requestId": "req-123",
  "principal": {
    "id": "user-456",
    "roles": ["user"]
  },
  "resource": {
    "kind": "document",
    "id": "doc-789",
    "attributes": {
      "ownerId": "user-456",
      "tenantId": "acme-corp"
    }
  },
  "actions": ["read", "write"],
  "auxData": {
    "jwt": {
      "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImF1dGgwLTIwMjQifQ...",
      "keySetId": "auth0"
    }
  }
}
```

---

## 11. Testing Strategy

### 11.1 Unit Tests

| Component | Coverage Target | Test File |
|-----------|-----------------|-----------|
| JWTValidator | 95% | `tests/unit/auxdata/jwt-validator.test.ts` |
| JWKSManager | 90% | `tests/unit/auxdata/jwks-manager.test.ts` |
| TokenCache | 90% | `tests/unit/auxdata/token-cache.test.ts` |
| ClaimsExtractor | 95% | `tests/unit/auxdata/claims-extractor.test.ts` |

### 11.2 Test Scenarios

```typescript
describe('JWTValidator', () => {
  describe('signature verification', () => {
    it('validates RS256 signed tokens');
    it('validates ES256 signed tokens');
    it('rejects invalid signatures');
    it('rejects unsupported algorithms');
    it('rejects tokens with "none" algorithm');
  });

  describe('expiration handling', () => {
    it('accepts valid tokens within expiration');
    it('rejects expired tokens');
    it('applies acceptable time skew');
    it('validates nbf (not before) claim');
  });

  describe('issuer/audience validation', () => {
    it('validates matching issuer');
    it('rejects mismatched issuer');
    it('validates audience as string');
    it('validates audience as array');
  });

  describe('JWKS integration', () => {
    it('fetches keys from remote endpoint');
    it('caches fetched keys');
    it('handles key rotation');
    it('falls back to cached keys on fetch failure');
  });
});
```

### 11.3 Integration Tests

| Scenario | Components Involved |
|----------|---------------------|
| Full JWT validation flow | JWTValidator, JWKSManager, CEL Evaluator |
| Policy with JWT conditions | Decision Engine, CEL Evaluator, AuxData Handler |
| Key rotation simulation | JWKSManager, Token Cache |

---

## 12. Performance Considerations

### 12.1 Performance Targets

| Operation | Target Latency |
|-----------|----------------|
| Cached token validation | < 0.5ms |
| Uncached validation (cached key) | < 2ms |
| Uncached validation (key fetch) | < 10ms |
| JWKS refresh | < 5s |

### 12.2 Optimization Strategies

- **Token caching**: Cache validation results by token hash
- **Key caching**: Cache JWKS responses with TTL
- **Lazy parsing**: Parse token only when needed
- **Connection pooling**: Reuse HTTP connections for JWKS

### 12.3 Memory Usage

| Component | Estimated Size |
|-----------|----------------|
| Cached token entry | ~1KB |
| Cached key set | ~5KB |
| Max cache footprint | ~10MB (default config) |

---

## 13. Dependencies

### 13.1 External Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `jose` | ^5.0.0 | JWT/JWS/JWK operations |
| `lru-cache` | ^10.0.0 | Token caching |

### 13.2 Internal Dependencies

| Package | Purpose |
|---------|---------|
| `@authz-engine/core/cel` | CEL expression evaluation |
| `@authz-engine/core/types` | Type definitions |

---

## 14. Future Enhancements

### 14.1 Planned

- [ ] Token introspection endpoint support
- [ ] JWE (encrypted JWT) support
- [ ] Custom claim validation rules
- [ ] Metrics and tracing integration

### 14.2 Under Consideration

- [ ] PASETO token support
- [ ] Hardware security module (HSM) integration
- [ ] Distributed token cache
- [ ] Token refresh proxy

---

## 15. References

- [RFC 7519 - JSON Web Token (JWT)](https://datatracker.ietf.org/doc/html/rfc7519)
- [RFC 7517 - JSON Web Key (JWK)](https://datatracker.ietf.org/doc/html/rfc7517)
- [RFC 7515 - JSON Web Signature (JWS)](https://datatracker.ietf.org/doc/html/rfc7515)
- [OpenID Connect Discovery](https://openid.net/specs/openid-connect-discovery-1_0.html)
- [Cerbos AuxData Documentation](https://docs.cerbos.dev/cerbos/latest/policies/auxiliary_data)
- [jose Library Documentation](https://github.com/panva/jose)
