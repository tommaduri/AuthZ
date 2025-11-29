# OIDC/OAuth Integration - Software Design Document

**Module**: `@authz-engine/core/identity`
**Version**: 1.0.0
**Status**: Draft
**Author**: AuthZ Engine Team
**Created**: 2024-11-23
**Last Updated**: 2024-11-23
**Reviewers**: Security Team, Platform Team, Identity Team

---

## 1. Overview

### 1.1 Purpose

The OIDC/OAuth Integration module provides comprehensive identity provider integration for the AuthZ Engine. It enables seamless authentication context extraction from various identity providers, allowing authorization decisions to leverage verified identity information, claims, roles, and group memberships from external authentication systems.

### 1.2 Scope

**In Scope:**
- OpenID Connect (OIDC) token validation and claim extraction
- OAuth 2.0 token introspection for opaque tokens
- Multi-provider support (Okta, Auth0, Azure AD, Google, AWS Cognito, Keycloak)
- JWKS fetching with intelligent caching and rotation handling
- Claim-to-principal attribute mapping
- Role extraction from various claim formats
- Multi-tenant identity extraction from tokens
- Provider-specific customization and extension points

**Out of Scope:**
- OAuth/OIDC flow implementation (login, consent, redirect)
- Token issuance/generation
- Session management and cookie handling
- User provisioning/SCIM
- Identity federation protocols (SAML 2.0)

### 1.3 Context

This module builds upon the JWT AuxData system to provide identity provider-specific integrations. It extracts and normalizes identity information from various providers into a consistent format for CEL expressions, enabling authorization policies to reference user roles, groups, permissions, and custom claims regardless of the identity provider source.

### 1.4 Key Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Provider-specific adapters | Different IdPs have unique claim structures | Generic mapping (inflexible) |
| Support both JWT and opaque tokens | Enterprises use both patterns | JWT-only (limited coverage) |
| JWKS caching with rotation detection | Balance security with performance | Always fetch (slow), long cache (insecure) |
| Fail-closed on validation errors | Security-critical system | Fail-open (insecure), soft-fail (inconsistent) |
| Standard claim mapping with overrides | Consistency with customization | Fully custom (complex), rigid mapping (inflexible) |

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-001 | Validate OIDC ID tokens from supported providers | Must Have | Pending |
| FR-002 | Validate OAuth 2.0 access tokens (JWT format) | Must Have | Pending |
| FR-003 | Support token introspection for opaque tokens | Must Have | Pending |
| FR-004 | Extract standard OIDC claims (sub, email, name, etc.) | Must Have | Pending |
| FR-005 | Extract custom claims from provider-specific namespaces | Must Have | Pending |
| FR-006 | Map claims to principal attributes | Must Have | Pending |
| FR-007 | Extract roles from various claim formats | Must Have | Pending |
| FR-008 | Support group membership extraction | Must Have | Pending |
| FR-009 | Handle multi-tenant identity tokens | Should Have | Pending |
| FR-010 | Support provider auto-discovery via OIDC metadata | Should Have | Pending |
| FR-011 | Provide CEL functions for identity operations | Should Have | Pending |
| FR-012 | Support webhook-based claim enrichment | Nice to Have | Pending |

### 2.2 Non-Functional Requirements

| ID | Category | Requirement | Target |
|----|----------|-------------|--------|
| NFR-001 | Performance | Token validation latency (cached) | < 1ms |
| NFR-002 | Performance | Token validation latency (JWKS fetch) | < 100ms |
| NFR-003 | Performance | JWKS cache hit rate | > 99% |
| NFR-004 | Reliability | Graceful degradation on IdP unavailability | Use cached keys |
| NFR-005 | Security | Zero trust on unvalidated tokens | Fail-closed |
| NFR-006 | Security | Algorithm restriction enforcement | Configurable allowlist |
| NFR-007 | Scalability | Concurrent token validations | 10,000+ RPS |
| NFR-008 | Availability | Key rotation handling | Zero-downtime |

---

## 3. Architecture

### 3.1 Component Diagram

```
+---------------------------------------------------------------------------------+
|                          OIDC/OAuth Integration Module                           |
+---------------------------------------------------------------------------------+
|                                                                                  |
|  +------------------+     +---------------------+     +---------------------+    |
|  | Token Receiver   |---->| Provider Resolver   |---->| Token Validator     |    |
|  | (HTTP/gRPC)      |     | (Auto-discovery)    |     | (Per-Provider)      |    |
|  +------------------+     +---------------------+     +----------+----------+    |
|                                                                  |               |
|                                                                  v               |
|  +-----------------------------------------------------------------------+      |
|  |                      Identity Provider Adapters                        |      |
|  |  +----------+  +----------+  +----------+  +----------+  +----------+ |      |
|  |  |  Okta/   |  | Azure AD |  |  Google  |  |   AWS    |  | Keycloak | |      |
|  |  |  Auth0   |  | Entra ID |  | Workspace|  | Cognito  |  |          | |      |
|  |  +----------+  +----------+  +----------+  +----------+  +----------+ |      |
|  |                                                                        |      |
|  |  +------------------------------------------------------------------+ |      |
|  |  |                    Generic OIDC Adapter                          | |      |
|  |  +------------------------------------------------------------------+ |      |
|  +-----------------------------------------------------------------------+      |
|                                    |                                             |
|         +----------------+---------+---------+----------------+                  |
|         |                |                   |                |                  |
|  +------v------+  +------v------+  +--------v--------+  +----v-----+            |
|  |    JWKS     |  |   Token     |  |     Claim       |  |   Role   |            |
|  |   Manager   |  | Introspector|  |    Mapper       |  | Extractor|            |
|  +------+------+  +------+------+  +--------+--------+  +----+-----+            |
|         |                |                   |                |                  |
|         v                v                   v                v                  |
|  +------+------+  +------+------+  +--------+--------+  +----+-----+            |
|  |    Key      |  | Introspection|  |   Principal    |  |  Roles   |            |
|  |   Cache     |  |    Cache     |  |   Attributes   |  |  Array   |            |
|  +-------------+  +--------------+  +-----------------+  +----------+            |
|                                                                                  |
|  +-----------------------------------------------------------------------+      |
|  |                         CEL Integration Layer                          |      |
|  |  +-------------------+  +-------------------+  +-------------------+   |      |
|  |  | identity.provider |  | identity.claims   |  | identity.hasRole  |   |      |
|  |  +-------------------+  +-------------------+  +-------------------+   |      |
|  +-----------------------------------------------------------------------+      |
|                                                                                  |
+---------------------------------------------------------------------------------+
```

### 3.2 Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| Token Receiver | Extracts tokens from HTTP headers, gRPC metadata, or request body |
| Provider Resolver | Identifies IdP from token issuer or configuration |
| Token Validator | Orchestrates validation pipeline per provider |
| IdP Adapters | Provider-specific claim extraction and normalization |
| JWKS Manager | Fetches, caches, and manages signing keys |
| Token Introspector | Handles opaque token validation via introspection endpoint |
| Claim Mapper | Maps provider claims to principal attributes |
| Role Extractor | Extracts roles from various claim formats |
| CEL Integration | Exposes identity functions for policy conditions |

### 3.3 Data Flow

```
[HTTP Request with Authorization Header]
                |
                v
+---------------+---------------+
| Extract Token (Bearer/Custom) |
+---------------+---------------+
                |
                v
+---------------+---------------+
|     Decode Token Header       |
|   (Check if JWT or Opaque)    |
+---------------+---------------+
        |               |
        v               v
[JWT Token]       [Opaque Token]
        |               |
        v               v
+-------+-------+ +----+----------+
| Resolve IdP   | | Introspection |
| from Issuer   | |   Endpoint    |
+-------+-------+ +----+----------+
        |               |
        v               v
+-------+-------+ +----+----------+
| Fetch JWKS    | | Validate      |
| (if needed)   | |   Response    |
+-------+-------+ +----+----------+
        |               |
        v               |
+-------+-------+       |
| Verify Sig    |       |
| & Claims      |       |
+-------+-------+       |
        |               |
        +-------+-------+
                |
                v
+---------------+---------------+
|    Provider-Specific Adapter  |
|    (Normalize Claims)         |
+---------------+---------------+
                |
                v
+---------------+---------------+
|      Map to Principal         |
|      Attributes & Roles       |
+---------------+---------------+
                |
                v
[Return Enriched Identity Context to CEL]
```

### 3.4 Integration Points

| Integration | Protocol | Direction | Purpose |
|-------------|----------|-----------|---------|
| Identity Providers | HTTPS | Out | JWKS, introspection, discovery |
| CEL Evaluator | Internal | In | Identity context for conditions |
| Decision Engine | Internal | Both | Identity-enriched requests |
| Audit Logger | Internal | Out | Identity validation events |
| Metrics | Internal | Out | Validation performance metrics |

---

## 4. Supported Identity Providers

### 4.1 Okta / Auth0

```typescript
/**
 * Okta/Auth0 adapter configuration
 */
interface OktaAuth0Config {
  /** Provider type */
  type: 'okta' | 'auth0';
  /** Okta/Auth0 domain (e.g., 'example.okta.com' or 'example.auth0.com') */
  domain: string;
  /** Custom authorization server ID (Okta only) */
  authorizationServerId?: string;
  /** Expected audience */
  audience: string | string[];
  /** Client ID for introspection (optional) */
  clientId?: string;
  /** Client secret for introspection (optional) */
  clientSecret?: string;
  /** Custom claim namespace (Auth0) */
  customClaimNamespace?: string;
  /** Roles claim path */
  rolesClaimPath?: string;
  /** Groups claim path */
  groupsClaimPath?: string;
}

/**
 * Okta/Auth0 claim structure
 */
interface OktaAuth0Claims {
  // Standard OIDC claims
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;

  // Okta-specific
  uid?: string;
  cid?: string;
  scp?: string[];

  // Auth0-specific
  azp?: string;
  gty?: string;
  permissions?: string[];

  // Custom namespace claims (Auth0)
  [namespace: string]: unknown;
}
```

**JWKS Endpoints:**
- Okta: `https://{domain}/oauth2/{authServerId}/v1/keys`
- Okta (default): `https://{domain}/oauth2/default/v1/keys`
- Auth0: `https://{domain}/.well-known/jwks.json`

**Role Extraction Paths:**
```yaml
# Okta
rolesClaimPath: groups  # Default Okta groups
# or custom claim
rolesClaimPath: customClaims.roles

# Auth0
rolesClaimPath: https://example.com/roles  # Namespaced claim
# or RBAC permissions
rolesClaimPath: permissions
```

### 4.2 Azure AD / Entra ID

```typescript
/**
 * Azure AD/Entra ID adapter configuration
 */
interface AzureADConfig {
  type: 'azure-ad' | 'entra-id';
  /** Azure AD tenant ID or 'common' or 'organizations' */
  tenantId: string;
  /** Application (client) ID */
  clientId: string;
  /** Expected audience (usually client ID or API URI) */
  audience: string | string[];
  /** Client secret for introspection */
  clientSecret?: string;
  /** Allow multi-tenant tokens */
  allowMultiTenant?: boolean;
  /** Include Azure AD groups in claims */
  includeGroups?: boolean;
  /** App roles configuration */
  appRoles?: boolean;
}

/**
 * Azure AD claim structure
 */
interface AzureADClaims {
  // Standard claims
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  nbf: number;

  // Azure AD specific
  tid: string;  // Tenant ID
  oid: string;  // Object ID (immutable user identifier)
  azp?: string; // Authorized party
  ver: string;  // Token version (1.0 or 2.0)

  // Identity claims
  preferred_username?: string;
  name?: string;
  email?: string;
  upn?: string;  // User Principal Name

  // Roles and groups
  roles?: string[];      // Application roles
  groups?: string[];     // Azure AD group Object IDs
  wids?: string[];       // Directory roles

  // Application permissions
  scp?: string;          // Delegated permissions (space-separated)

  // Multi-tenant
  idp?: string;          // Identity provider for guests
  acct?: number;         // Account type (0=consumer, 1=organization)
}
```

**JWKS Endpoints:**
- v1.0: `https://login.microsoftonline.com/{tenantId}/discovery/keys`
- v2.0: `https://login.microsoftonline.com/{tenantId}/discovery/v2.0/keys`
- Common: `https://login.microsoftonline.com/common/discovery/v2.0/keys`

**Role Extraction:**
```yaml
# App Roles (assigned in Azure AD App Registration)
rolesClaimPath: roles

# Azure AD Groups (Object IDs)
groupsClaimPath: groups

# Built-in directory roles
directoryRolesClaimPath: wids
```

### 4.3 Google Workspace

```typescript
/**
 * Google Workspace adapter configuration
 */
interface GoogleWorkspaceConfig {
  type: 'google' | 'google-workspace';
  /** Google Cloud project ID */
  projectId?: string;
  /** Expected audience (client ID) */
  clientId: string;
  /** Hosted domain restriction */
  hostedDomain?: string;
  /** Enable Workspace group membership */
  enableGroups?: boolean;
  /** Admin SDK service account for group lookups */
  serviceAccount?: {
    email: string;
    privateKey: string;
    adminEmail: string;  // Workspace admin for impersonation
  };
}

/**
 * Google ID token claims
 */
interface GoogleClaims {
  // Standard OIDC
  iss: string;  // 'https://accounts.google.com' or 'accounts.google.com'
  sub: string;
  aud: string;
  exp: number;
  iat: number;

  // Google-specific
  azp?: string;           // Authorized party (client ID)
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  locale?: string;

  // Workspace
  hd?: string;            // Hosted domain
}
```

**JWKS Endpoint:**
- `https://www.googleapis.com/oauth2/v3/certs`

**Note:** Google Workspace groups require Admin SDK API calls and are not included in ID tokens. Use `enableGroups` with service account configuration for group membership.

### 4.4 AWS Cognito

```typescript
/**
 * AWS Cognito adapter configuration
 */
interface CognitoConfig {
  type: 'cognito';
  /** AWS region */
  region: string;
  /** User Pool ID */
  userPoolId: string;
  /** App client ID(s) */
  clientId: string | string[];
  /** Custom attribute prefix (default: 'custom:') */
  customAttributePrefix?: string;
  /** Cognito groups claim name */
  groupsClaimName?: string;
}

/**
 * Cognito ID token claims
 */
interface CognitoClaims {
  // Standard OIDC
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  auth_time: number;

  // Cognito-specific
  token_use: 'id' | 'access';
  'cognito:username': string;
  'cognito:groups'?: string[];

  // Standard profile claims
  email?: string;
  email_verified?: boolean;
  phone_number?: string;
  phone_number_verified?: boolean;
  name?: string;

  // Custom attributes (prefixed)
  [key: `custom:${string}`]: string;
}

/**
 * Cognito access token claims
 */
interface CognitoAccessClaims {
  iss: string;
  sub: string;
  client_id: string;
  token_use: 'access';
  scope: string;
  exp: number;
  iat: number;
  jti: string;
  username: string;
  'cognito:groups'?: string[];
}
```

**JWKS Endpoint:**
- `https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/jwks.json`

**Role Extraction:**
```yaml
# Cognito groups
groupsClaimPath: cognito:groups

# Custom roles attribute
rolesClaimPath: custom:roles
```

### 4.5 Keycloak

```typescript
/**
 * Keycloak adapter configuration
 */
interface KeycloakConfig {
  type: 'keycloak';
  /** Keycloak server URL */
  serverUrl: string;
  /** Realm name */
  realm: string;
  /** Client ID */
  clientId: string;
  /** Client secret (for confidential clients) */
  clientSecret?: string;
  /** Include realm roles */
  includeRealmRoles?: boolean;
  /** Include client roles */
  includeClientRoles?: boolean;
  /** Resource access claim for client roles */
  resourceAccessClient?: string;
}

/**
 * Keycloak token claims
 */
interface KeycloakClaims {
  // Standard OIDC
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  auth_time?: number;
  nonce?: string;

  // Keycloak-specific
  azp: string;
  typ: string;  // 'Bearer', 'ID'
  session_state?: string;
  acr?: string;  // Authentication Context Class Reference

  // Identity
  preferred_username?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;

  // Roles
  realm_access?: {
    roles: string[];
  };
  resource_access?: {
    [clientId: string]: {
      roles: string[];
    };
  };

  // Groups
  groups?: string[];

  // Custom claims
  [key: string]: unknown;
}
```

**JWKS Endpoint:**
- `{serverUrl}/realms/{realm}/protocol/openid-connect/certs`

**Role Extraction:**
```yaml
# Realm roles
realmRolesPath: realm_access.roles

# Client-specific roles
clientRolesPath: resource_access.{clientId}.roles

# Groups
groupsClaimPath: groups
```

### 4.6 Generic OIDC Provider

```typescript
/**
 * Generic OIDC provider configuration
 */
interface GenericOIDCConfig {
  type: 'oidc';
  /** Provider identifier */
  id: string;
  /** OIDC issuer URL (enables auto-discovery) */
  issuer: string;
  /** Override JWKS URI (optional, uses discovery) */
  jwksUri?: string;
  /** Override introspection endpoint */
  introspectionEndpoint?: string;
  /** Expected audience */
  audience: string | string[];
  /** Client credentials for introspection */
  clientId?: string;
  clientSecret?: string;
  /** Claim mapping configuration */
  claimMapping?: ClaimMappingConfig;
  /** Roles extraction configuration */
  rolesConfig?: RolesConfig;
}

/**
 * Claim mapping configuration
 */
interface ClaimMappingConfig {
  /** Map to principal.id */
  subjectClaim?: string;
  /** Map to principal email */
  emailClaim?: string;
  /** Map to principal name */
  nameClaim?: string;
  /** Custom attribute mappings */
  attributeMappings?: Record<string, string>;
}

/**
 * Roles extraction configuration
 */
interface RolesConfig {
  /** Claim path for roles (dot notation) */
  claimPath?: string;
  /** Prefix to strip from roles */
  stripPrefix?: string;
  /** Transform function name */
  transform?: 'lowercase' | 'uppercase' | 'none';
  /** Delimiter for string roles */
  delimiter?: string;
}
```

---

## 5. Token Processing

### 5.1 JWT Validation Pipeline

```typescript
/**
 * JWT validation with provider-specific handling
 */
class OIDCTokenValidator {
  private providers: Map<string, IdentityProviderAdapter>;
  private jwksManager: JWKSManager;
  private introspector: TokenIntrospector;
  private config: OIDCConfig;

  async validateToken(
    token: string,
    options?: ValidationOptions
  ): Promise<ValidatedIdentity> {
    // Step 1: Decode without verification to inspect
    const decoded = this.decodeToken(token);

    if (!decoded.isJWT) {
      // Opaque token - use introspection
      return this.introspector.introspect(token, options);
    }

    // Step 2: Resolve provider from issuer
    const provider = await this.resolveProvider(decoded.payload.iss);
    if (!provider) {
      throw new UnknownIssuerError(decoded.payload.iss);
    }

    // Step 3: Get signing key
    const key = await this.jwksManager.getKey(
      provider.config.jwksUri,
      decoded.header.kid,
      decoded.header.alg
    );

    // Step 4: Verify signature
    await this.verifySignature(token, key, decoded.header.alg);

    // Step 5: Validate standard claims
    this.validateStandardClaims(decoded.payload, provider.config);

    // Step 6: Provider-specific validation
    await provider.validateClaims(decoded.payload);

    // Step 7: Extract and normalize identity
    return provider.extractIdentity(decoded.payload);
  }

  private validateStandardClaims(
    claims: JWTPayload,
    config: ProviderConfig
  ): void {
    const now = Math.floor(Date.now() / 1000);
    const clockSkew = this.config.clockSkewSeconds || 60;

    // Expiration
    if (!claims.exp || claims.exp + clockSkew < now) {
      throw new TokenExpiredError(claims.exp);
    }

    // Not before
    if (claims.nbf && claims.nbf - clockSkew > now) {
      throw new TokenNotYetValidError(claims.nbf);
    }

    // Issuer
    if (!this.validateIssuer(claims.iss, config.issuer)) {
      throw new InvalidIssuerError(claims.iss, config.issuer);
    }

    // Audience
    if (!this.validateAudience(claims.aud, config.audience)) {
      throw new InvalidAudienceError(claims.aud, config.audience);
    }
  }

  private validateAudience(
    tokenAud: string | string[],
    expectedAud: string | string[]
  ): boolean {
    const tokenAudiences = Array.isArray(tokenAud) ? tokenAud : [tokenAud];
    const expectedAudiences = Array.isArray(expectedAud)
      ? expectedAud
      : [expectedAud];

    return tokenAudiences.some(aud => expectedAudiences.includes(aud));
  }
}
```

### 5.2 JWKS Fetching and Caching

```typescript
/**
 * JWKS manager with intelligent caching
 */
class JWKSManager {
  private cache: Map<string, CachedJWKS> = new Map();
  private pendingFetches: Map<string, Promise<JWKS>> = new Map();
  private config: JWKSConfig;

  constructor(config: JWKSConfig) {
    this.config = {
      cacheMaxAge: 3600000,         // 1 hour default
      cacheMinAge: 60000,           // 1 minute minimum
      refreshThreshold: 300000,      // Refresh 5 minutes before expiry
      fetchTimeout: 5000,            // 5 second timeout
      maxRetries: 3,
      retryBackoff: 1000,
      ...config
    };
  }

  async getKey(
    jwksUri: string,
    kid: string,
    alg: string
  ): Promise<JWK> {
    let jwks = await this.getJWKS(jwksUri);
    let key = this.findKey(jwks, kid, alg);

    // Key not found - might be rotation, force refresh
    if (!key) {
      jwks = await this.refreshJWKS(jwksUri, true);
      key = this.findKey(jwks, kid, alg);
    }

    if (!key) {
      throw new KeyNotFoundError(kid, alg, jwksUri);
    }

    return key;
  }

  private async getJWKS(uri: string): Promise<JWKS> {
    const cached = this.cache.get(uri);

    if (cached) {
      const now = Date.now();

      // Still valid
      if (now < cached.expiresAt) {
        // Background refresh if approaching expiry
        if (now > cached.expiresAt - this.config.refreshThreshold) {
          this.backgroundRefresh(uri);
        }
        return cached.jwks;
      }
    }

    return this.refreshJWKS(uri);
  }

  private async refreshJWKS(uri: string, force = false): Promise<JWKS> {
    // Deduplicate concurrent fetches
    const pending = this.pendingFetches.get(uri);
    if (pending && !force) {
      return pending;
    }

    const fetchPromise = this.fetchJWKS(uri);
    this.pendingFetches.set(uri, fetchPromise);

    try {
      const jwks = await fetchPromise;

      // Determine cache duration from headers or config
      const maxAge = this.determineCacheAge(jwks);

      this.cache.set(uri, {
        jwks,
        fetchedAt: Date.now(),
        expiresAt: Date.now() + maxAge
      });

      return jwks;
    } finally {
      this.pendingFetches.delete(uri);
    }
  }

  private async fetchJWKS(uri: string): Promise<JWKS> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const response = await fetch(uri, {
          signal: AbortSignal.timeout(this.config.fetchTimeout),
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'AuthZ-Engine/1.0'
          }
        });

        if (!response.ok) {
          throw new JWKSFetchError(
            `HTTP ${response.status}: ${response.statusText}`,
            uri
          );
        }

        const jwks = await response.json();

        // Validate JWKS structure
        if (!jwks.keys || !Array.isArray(jwks.keys)) {
          throw new InvalidJWKSError('Missing or invalid keys array', uri);
        }

        return jwks as JWKS;
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.config.maxRetries - 1) {
          await this.delay(this.config.retryBackoff * Math.pow(2, attempt));
        }
      }
    }

    // All retries failed - try to use stale cache
    const stale = this.cache.get(uri);
    if (stale) {
      console.warn(`JWKS fetch failed, using stale cache: ${uri}`);
      return stale.jwks;
    }

    throw new JWKSFetchError(
      `Failed after ${this.config.maxRetries} attempts: ${lastError?.message}`,
      uri
    );
  }

  private findKey(jwks: JWKS, kid: string, alg: string): JWK | undefined {
    return jwks.keys.find(key => {
      // Match by kid if provided
      if (kid && key.kid !== kid) return false;

      // Match by algorithm if specified
      if (key.alg && key.alg !== alg) return false;

      // Must be a signing key
      if (key.use && key.use !== 'sig') return false;

      return true;
    });
  }

  private backgroundRefresh(uri: string): void {
    // Non-blocking refresh
    this.refreshJWKS(uri).catch(error => {
      console.warn(`Background JWKS refresh failed: ${error.message}`);
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

interface CachedJWKS {
  jwks: JWKS;
  fetchedAt: number;
  expiresAt: number;
}

interface JWKS {
  keys: JWK[];
}
```

### 5.3 Token Introspection for Opaque Tokens

```typescript
/**
 * OAuth 2.0 token introspection for opaque tokens
 * RFC 7662: https://datatracker.ietf.org/doc/html/rfc7662
 */
class TokenIntrospector {
  private cache: Map<string, CachedIntrospection> = new Map();
  private config: IntrospectionConfig;

  async introspect(
    token: string,
    options?: IntrospectionOptions
  ): Promise<ValidatedIdentity> {
    // Check cache first (short TTL for security)
    const cacheKey = this.hashToken(token);
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() < cached.expiresAt) {
      return cached.identity;
    }

    // Determine provider from config or options
    const provider = options?.provider || this.config.defaultProvider;
    const endpoint = this.getIntrospectionEndpoint(provider);
    const credentials = this.getCredentials(provider);

    // Make introspection request
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(
          `${credentials.clientId}:${credentials.clientSecret}`
        ).toString('base64')}`
      },
      body: new URLSearchParams({
        token,
        token_type_hint: options?.tokenTypeHint || 'access_token'
      })
    });

    if (!response.ok) {
      throw new IntrospectionError(
        `HTTP ${response.status}`,
        provider
      );
    }

    const result = await response.json() as IntrospectionResponse;

    // RFC 7662: 'active' is the only required field
    if (!result.active) {
      throw new InactiveTokenError();
    }

    // Extract identity from introspection response
    const identity = this.extractIdentity(result, provider);

    // Cache with short TTL (default 30 seconds)
    const cacheTtl = Math.min(
      this.config.cacheTtlMs || 30000,
      (result.exp ? (result.exp * 1000 - Date.now()) : 30000)
    );

    this.cache.set(cacheKey, {
      identity,
      expiresAt: Date.now() + cacheTtl
    });

    return identity;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

/**
 * RFC 7662 Introspection Response
 */
interface IntrospectionResponse {
  active: boolean;
  scope?: string;
  client_id?: string;
  username?: string;
  token_type?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
  sub?: string;
  aud?: string | string[];
  iss?: string;
  jti?: string;
  // Provider-specific extensions
  [key: string]: unknown;
}
```

---

## 6. Claim Mapping

### 6.1 Principal Attribute Mapping

```typescript
/**
 * Maps identity provider claims to AuthZ Engine principal attributes
 */
interface ClaimToPrincipalMapping {
  /** Standard mappings */
  standard: {
    /** Claim for principal.id (default: 'sub') */
    id: string;
    /** Claim for principal display name */
    name?: string;
    /** Claim for principal email */
    email?: string;
  };
  /** Custom attribute mappings */
  attributes: Record<string, ClaimMapping>;
}

interface ClaimMapping {
  /** Source claim path (dot notation) */
  claim: string;
  /** Target attribute name */
  attribute: string;
  /** Transformation to apply */
  transform?: 'string' | 'number' | 'boolean' | 'array' | 'lowercase' | 'uppercase';
  /** Default value if claim missing */
  default?: unknown;
  /** Required - fail if missing */
  required?: boolean;
}

/**
 * Claim mapper implementation
 */
class ClaimMapper {
  private mappings: Map<string, ClaimToPrincipalMapping>;

  mapToPrincipal(
    claims: Record<string, unknown>,
    provider: string
  ): Principal {
    const mapping = this.mappings.get(provider) || this.getDefaultMapping();

    // Extract standard fields
    const principal: Principal = {
      id: this.extractValue(claims, mapping.standard.id) as string,
      roles: [], // Populated by role extractor
      attr: {}
    };

    // Map custom attributes
    for (const [key, config] of Object.entries(mapping.attributes)) {
      const value = this.extractAndTransform(claims, config);

      if (value !== undefined) {
        principal.attr![key] = value;
      } else if (config.required) {
        throw new RequiredClaimMissingError(config.claim, provider);
      }
    }

    // Always include provider source
    principal.attr!._provider = provider;
    principal.attr!._tokenSubject = claims.sub;

    return principal;
  }

  private extractValue(
    claims: Record<string, unknown>,
    path: string
  ): unknown {
    const parts = path.split('.');
    let value: unknown = claims;

    for (const part of parts) {
      if (value === null || value === undefined) return undefined;
      value = (value as Record<string, unknown>)[part];
    }

    return value;
  }

  private extractAndTransform(
    claims: Record<string, unknown>,
    config: ClaimMapping
  ): unknown {
    let value = this.extractValue(claims, config.claim);

    if (value === undefined) {
      return config.default;
    }

    switch (config.transform) {
      case 'string':
        return String(value);
      case 'number':
        return Number(value);
      case 'boolean':
        return Boolean(value);
      case 'array':
        return Array.isArray(value) ? value : [value];
      case 'lowercase':
        return String(value).toLowerCase();
      case 'uppercase':
        return String(value).toUpperCase();
      default:
        return value;
    }
  }
}
```

### 6.2 Default Mappings by Provider

```yaml
# Default claim mappings per provider
claimMappings:
  okta:
    standard:
      id: sub
      name: name
      email: email
    attributes:
      department:
        claim: department
        attribute: department
      employeeId:
        claim: employee_id
        attribute: employeeId

  auth0:
    standard:
      id: sub
      name: name
      email: email
    attributes:
      # Auth0 uses namespaced claims
      organization:
        claim: https://example.com/org
        attribute: organization
      tenant:
        claim: https://example.com/tenant_id
        attribute: tenantId

  azure-ad:
    standard:
      id: oid  # Use immutable Object ID
      name: name
      email: preferred_username
    attributes:
      tenantId:
        claim: tid
        attribute: tenantId
      department:
        claim: extension_department
        attribute: department
      jobTitle:
        claim: jobTitle
        attribute: jobTitle

  google:
    standard:
      id: sub
      name: name
      email: email
    attributes:
      domain:
        claim: hd
        attribute: domain
      emailVerified:
        claim: email_verified
        attribute: emailVerified
        transform: boolean

  cognito:
    standard:
      id: sub
      name: name
      email: email
    attributes:
      # Custom attributes use 'custom:' prefix
      department:
        claim: custom:department
        attribute: department
      level:
        claim: custom:level
        attribute: level

  keycloak:
    standard:
      id: sub
      name: name
      email: email
    attributes:
      locale:
        claim: locale
        attribute: locale
```

---

## 7. Role Extraction

### 7.1 Role Extractor Interface

```typescript
/**
 * Extracts roles from various claim formats
 */
interface RoleExtractor {
  /**
   * Extract roles from token claims
   */
  extractRoles(claims: Record<string, unknown>, config: RoleConfig): string[];

  /**
   * Extract groups (may need external lookup)
   */
  extractGroups(claims: Record<string, unknown>, config: GroupConfig): Promise<string[]>;
}

/**
 * Role extraction configuration
 */
interface RoleConfig {
  /** Claim path(s) containing roles */
  claimPaths: string[];
  /** Delimiter for string-based roles */
  delimiter?: string;
  /** Prefix to strip from roles */
  stripPrefix?: string;
  /** Prefix to add to roles */
  addPrefix?: string;
  /** Only include roles matching pattern */
  includePattern?: RegExp;
  /** Exclude roles matching pattern */
  excludePattern?: RegExp;
  /** Case transformation */
  caseTransform?: 'none' | 'lowercase' | 'uppercase';
  /** Merge with static roles */
  staticRoles?: string[];
}

/**
 * Role extractor implementation
 */
class StandardRoleExtractor implements RoleExtractor {
  extractRoles(
    claims: Record<string, unknown>,
    config: RoleConfig
  ): string[] {
    const roles = new Set<string>();

    // Add static roles
    if (config.staticRoles) {
      config.staticRoles.forEach(r => roles.add(r));
    }

    // Extract from claim paths
    for (const path of config.claimPaths) {
      const value = this.getNestedValue(claims, path);

      if (value === undefined || value === null) continue;

      // Handle different formats
      if (Array.isArray(value)) {
        value.forEach(v => this.processRole(String(v), config, roles));
      } else if (typeof value === 'string') {
        // Might be space or comma delimited
        const delimiter = config.delimiter || ' ';
        value.split(delimiter).forEach(v =>
          this.processRole(v.trim(), config, roles)
        );
      } else if (typeof value === 'object') {
        // Keycloak-style nested object
        this.extractFromObject(value as Record<string, unknown>, config, roles);
      }
    }

    return Array.from(roles);
  }

  private processRole(
    role: string,
    config: RoleConfig,
    roles: Set<string>
  ): void {
    if (!role) return;

    // Strip prefix
    if (config.stripPrefix && role.startsWith(config.stripPrefix)) {
      role = role.substring(config.stripPrefix.length);
    }

    // Include/exclude patterns
    if (config.includePattern && !config.includePattern.test(role)) {
      return;
    }
    if (config.excludePattern && config.excludePattern.test(role)) {
      return;
    }

    // Case transformation
    switch (config.caseTransform) {
      case 'lowercase':
        role = role.toLowerCase();
        break;
      case 'uppercase':
        role = role.toUpperCase();
        break;
    }

    // Add prefix
    if (config.addPrefix) {
      role = config.addPrefix + role;
    }

    roles.add(role);
  }

  private extractFromObject(
    obj: Record<string, unknown>,
    config: RoleConfig,
    roles: Set<string>
  ): void {
    // Handle Keycloak resource_access format
    if ('roles' in obj && Array.isArray(obj.roles)) {
      (obj.roles as string[]).forEach(r =>
        this.processRole(r, config, roles)
      );
    }

    // Recurse into nested objects
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.extractFromObject(value as Record<string, unknown>, config, roles);
      }
    }
  }
}
```

### 7.2 Provider-Specific Role Extraction

```typescript
/**
 * Provider-specific role extraction configurations
 */
const providerRoleConfigs: Record<string, RoleConfig> = {
  okta: {
    claimPaths: ['groups', 'scp'],
    caseTransform: 'lowercase'
  },

  auth0: {
    claimPaths: [
      'permissions',                      // RBAC permissions
      'https://example.com/roles',        // Custom namespace
      'https://example.com/permissions'
    ],
    caseTransform: 'lowercase'
  },

  'azure-ad': {
    claimPaths: [
      'roles',           // App roles
      'wids',            // Directory roles
      'groups'           // Group Object IDs (requires group mapping)
    ],
    caseTransform: 'lowercase'
  },

  google: {
    claimPaths: [],  // Groups require Admin SDK
    staticRoles: ['user']  // All authenticated users get 'user' role
  },

  cognito: {
    claimPaths: ['cognito:groups', 'custom:roles'],
    caseTransform: 'lowercase'
  },

  keycloak: {
    claimPaths: [
      'realm_access.roles',
      'resource_access'  // Client-specific roles
    ],
    caseTransform: 'lowercase'
  }
};

/**
 * Azure AD group-to-role mapping (group Object IDs to role names)
 */
interface AzureADGroupMapping {
  /** Azure AD Group Object ID -> Role name */
  groupMappings: Record<string, string>;
  /** Include unmapped groups with prefix */
  includeUnmapped?: boolean;
  unmappedPrefix?: string;
}

// Example Azure AD group mapping
const azureGroupMapping: AzureADGroupMapping = {
  groupMappings: {
    '12345678-1234-1234-1234-123456789abc': 'admin',
    '87654321-4321-4321-4321-cba987654321': 'editor',
    'abcdef12-3456-7890-abcd-ef1234567890': 'viewer'
  },
  includeUnmapped: false
};
```

---

## 8. Multi-Tenant Identity

### 8.1 Tenant Extraction Strategies

```typescript
/**
 * Strategies for extracting tenant from identity tokens
 */
type TenantExtractionStrategy =
  | 'claim'           // Extract from token claim
  | 'issuer'          // Derive from issuer URL
  | 'audience'        // Derive from audience
  | 'domain'          // Extract from email domain or hd claim
  | 'custom';         // Custom extraction function

interface TenantExtractionConfig {
  strategy: TenantExtractionStrategy;
  /** For 'claim' strategy: claim path */
  claimPath?: string;
  /** For 'issuer' strategy: regex to extract tenant */
  issuerPattern?: RegExp;
  /** For 'domain' strategy: domain-to-tenant mapping */
  domainMapping?: Record<string, string>;
  /** For 'custom' strategy: function name */
  customExtractor?: string;
  /** Default tenant if extraction fails */
  defaultTenant?: string;
  /** Require tenant (fail if not found) */
  required?: boolean;
}

/**
 * Tenant extractor implementation
 */
class TenantExtractor {
  private configs: Map<string, TenantExtractionConfig>;
  private customExtractors: Map<string, TenantExtractorFn>;

  extractTenant(
    claims: Record<string, unknown>,
    provider: string
  ): string | undefined {
    const config = this.configs.get(provider);
    if (!config) return undefined;

    let tenant: string | undefined;

    switch (config.strategy) {
      case 'claim':
        tenant = this.extractFromClaim(claims, config.claimPath!);
        break;
      case 'issuer':
        tenant = this.extractFromIssuer(claims.iss as string, config.issuerPattern!);
        break;
      case 'audience':
        tenant = this.extractFromAudience(claims.aud);
        break;
      case 'domain':
        tenant = this.extractFromDomain(claims, config.domainMapping!);
        break;
      case 'custom':
        tenant = this.customExtractors.get(config.customExtractor!)?.call(null, claims);
        break;
    }

    if (!tenant && config.defaultTenant) {
      tenant = config.defaultTenant;
    }

    if (!tenant && config.required) {
      throw new TenantExtractionError(provider, config.strategy);
    }

    return tenant;
  }

  private extractFromClaim(
    claims: Record<string, unknown>,
    path: string
  ): string | undefined {
    const value = this.getNestedValue(claims, path);
    return value ? String(value) : undefined;
  }

  private extractFromIssuer(
    issuer: string,
    pattern: RegExp
  ): string | undefined {
    const match = pattern.exec(issuer);
    return match?.[1];
  }

  private extractFromDomain(
    claims: Record<string, unknown>,
    mapping: Record<string, string>
  ): string | undefined {
    // Try hosted domain (Google)
    const hd = claims.hd as string;
    if (hd && mapping[hd]) {
      return mapping[hd];
    }

    // Try email domain
    const email = claims.email as string;
    if (email) {
      const domain = email.split('@')[1];
      if (domain && mapping[domain]) {
        return mapping[domain];
      }
    }

    return undefined;
  }
}

type TenantExtractorFn = (claims: Record<string, unknown>) => string | undefined;
```

### 8.2 Provider-Specific Tenant Extraction

```yaml
# Tenant extraction configurations per provider
tenantExtraction:
  azure-ad:
    strategy: claim
    claimPath: tid
    required: true

  auth0:
    strategy: claim
    claimPath: https://example.com/tenant_id
    defaultTenant: default

  okta:
    strategy: issuer
    # Extract from https://{tenant}.okta.com
    issuerPattern: "https://([^.]+)\\.okta\\.com"
    required: true

  google:
    strategy: domain
    domainMapping:
      acme.com: acme-corp
      widgets.io: widgets-inc
    defaultTenant: public

  cognito:
    strategy: claim
    claimPath: custom:tenant_id
    required: true

  keycloak:
    strategy: issuer
    # Extract from https://auth.example.com/realms/{tenant}
    issuerPattern: "/realms/([^/]+)"
    required: true
```

---

## 9. Security Considerations

### 9.1 Token Replay Prevention

```typescript
/**
 * Token replay prevention using nonce and jti tracking
 */
interface ReplayPreventionConfig {
  /** Enable replay prevention */
  enabled: boolean;
  /** Token tracking method */
  method: 'jti' | 'hash' | 'both';
  /** Store backend */
  store: 'memory' | 'redis' | 'custom';
  /** How long to track tokens (should exceed max token lifetime) */
  trackingWindowMs: number;
  /** Custom store implementation */
  customStore?: TokenTrackingStore;
}

interface TokenTrackingStore {
  /** Check if token has been seen */
  hasBeenUsed(identifier: string): Promise<boolean>;
  /** Mark token as used */
  markUsed(identifier: string, expiresAt: number): Promise<void>;
  /** Clean up expired entries */
  cleanup(): Promise<void>;
}

class ReplayPreventionGuard {
  private store: TokenTrackingStore;
  private config: ReplayPreventionConfig;

  async checkAndMark(claims: Record<string, unknown>): Promise<void> {
    if (!this.config.enabled) return;

    const identifier = this.getIdentifier(claims);

    // Check if already used
    if (await this.store.hasBeenUsed(identifier)) {
      throw new TokenReplayError(identifier);
    }

    // Mark as used
    const expiresAt = (claims.exp as number) * 1000;
    await this.store.markUsed(identifier, expiresAt);
  }

  private getIdentifier(claims: Record<string, unknown>): string {
    switch (this.config.method) {
      case 'jti':
        if (!claims.jti) {
          throw new MissingJTIError();
        }
        return claims.jti as string;

      case 'hash':
        return this.hashClaims(claims);

      case 'both':
        return claims.jti
          ? (claims.jti as string)
          : this.hashClaims(claims);
    }
  }

  private hashClaims(claims: Record<string, unknown>): string {
    const relevant = {
      iss: claims.iss,
      sub: claims.sub,
      aud: claims.aud,
      iat: claims.iat,
      exp: claims.exp
    };
    return createHash('sha256')
      .update(JSON.stringify(relevant))
      .digest('hex');
  }
}
```

### 9.2 Key Rotation Handling

```typescript
/**
 * Graceful key rotation handling strategies
 */
interface KeyRotationConfig {
  /** How to handle key not found */
  onKeyNotFound: 'refresh-once' | 'refresh-always' | 'fail';
  /** Maximum age for cached JWKS before forced refresh */
  maxCacheAgeMs: number;
  /** Minimum interval between forced refreshes */
  minRefreshIntervalMs: number;
  /** Alert threshold for key rotation detection */
  rotationAlertThreshold: number;
}

class KeyRotationHandler {
  private lastRefreshTimes: Map<string, number> = new Map();
  private rotationCounts: Map<string, number> = new Map();
  private config: KeyRotationConfig;

  async handleKeyNotFound(
    jwksUri: string,
    kid: string,
    jwksManager: JWKSManager
  ): Promise<JWK | null> {
    const now = Date.now();
    const lastRefresh = this.lastRefreshTimes.get(jwksUri) || 0;

    // Prevent refresh storms
    if (now - lastRefresh < this.config.minRefreshIntervalMs) {
      console.warn(`Key not found but refresh too recent: ${kid}`);
      return null;
    }

    switch (this.config.onKeyNotFound) {
      case 'refresh-once':
        // Single refresh attempt
        this.lastRefreshTimes.set(jwksUri, now);
        await jwksManager.forceRefresh(jwksUri);
        this.trackRotation(jwksUri);
        return jwksManager.findKey(jwksUri, kid);

      case 'refresh-always':
        // Always refresh (use with caution)
        await jwksManager.forceRefresh(jwksUri);
        return jwksManager.findKey(jwksUri, kid);

      case 'fail':
        // Fail immediately
        return null;
    }
  }

  private trackRotation(jwksUri: string): void {
    const count = (this.rotationCounts.get(jwksUri) || 0) + 1;
    this.rotationCounts.set(jwksUri, count);

    if (count >= this.config.rotationAlertThreshold) {
      console.warn(
        `High key rotation frequency detected for ${jwksUri}: ${count} rotations`
      );
      // Could emit metric or alert here
    }
  }
}
```

### 9.3 Algorithm Security

```typescript
/**
 * Algorithm security configuration and enforcement
 */
interface AlgorithmSecurityConfig {
  /** Allowed signing algorithms */
  allowedAlgorithms: string[];
  /** Explicitly blocked algorithms */
  blockedAlgorithms: string[];
  /** Require specific key types for algorithms */
  keyTypeRequirements: Record<string, string>;
  /** Minimum key sizes */
  minimumKeySizes: Record<string, number>;
}

// Recommended secure defaults
const secureAlgorithmConfig: AlgorithmSecurityConfig = {
  allowedAlgorithms: [
    'RS256', 'RS384', 'RS512',  // RSA
    'ES256', 'ES384', 'ES512',  // ECDSA
    'PS256', 'PS384', 'PS512'   // RSA-PSS
  ],

  // Always block these
  blockedAlgorithms: [
    'none',          // No signature (CVE-2015-9235)
    'HS256', 'HS384', 'HS512'  // Symmetric - use only if required
  ],

  keyTypeRequirements: {
    'RS256': 'RSA', 'RS384': 'RSA', 'RS512': 'RSA',
    'ES256': 'EC',  'ES384': 'EC',  'ES512': 'EC',
    'PS256': 'RSA', 'PS384': 'RSA', 'PS512': 'RSA'
  },

  minimumKeySizes: {
    'RSA': 2048,
    'EC': 256  // P-256 curve
  }
};

class AlgorithmValidator {
  constructor(private config: AlgorithmSecurityConfig) {}

  validateAlgorithm(alg: string, key: JWK): void {
    // Check explicit block list
    if (this.config.blockedAlgorithms.includes(alg)) {
      throw new BlockedAlgorithmError(alg);
    }

    // Check allow list
    if (!this.config.allowedAlgorithms.includes(alg)) {
      throw new DisallowedAlgorithmError(alg, this.config.allowedAlgorithms);
    }

    // Validate key type matches algorithm
    const requiredKeyType = this.config.keyTypeRequirements[alg];
    if (requiredKeyType && key.kty !== requiredKeyType) {
      throw new KeyTypeMismatchError(alg, requiredKeyType, key.kty);
    }

    // Validate key size
    this.validateKeySize(key);
  }

  private validateKeySize(key: JWK): void {
    const minSize = this.config.minimumKeySizes[key.kty];
    if (!minSize) return;

    let actualSize: number;

    if (key.kty === 'RSA' && key.n) {
      // RSA key size from modulus
      actualSize = Buffer.from(key.n, 'base64url').length * 8;
    } else if (key.kty === 'EC' && key.crv) {
      // EC key size from curve
      const curveSizes: Record<string, number> = {
        'P-256': 256, 'P-384': 384, 'P-521': 521
      };
      actualSize = curveSizes[key.crv] || 0;
    } else {
      return; // Can't determine size
    }

    if (actualSize < minSize) {
      throw new InsufficientKeySizeError(key.kty, minSize, actualSize);
    }
  }
}
```

### 9.4 Security Best Practices

| Practice | Implementation | Rationale |
|----------|----------------|-----------|
| Validate `iss` claim | Strict issuer matching | Prevent token confusion |
| Validate `aud` claim | Audience must include our client ID | Prevent token misuse |
| Check `exp` with small skew | Max 60 seconds clock skew | Balance usability and security |
| Enforce algorithm allowlist | Block `none`, optionally block HMAC | Prevent algorithm attacks |
| Verify key type matches algorithm | RSA keys for RS*, EC for ES* | Prevent key confusion |
| Implement token replay prevention | Track `jti` or token hash | Prevent replay attacks |
| Use HTTPS for JWKS | Never fetch over HTTP | Protect key integrity |
| Limit JWKS cache duration | Max 24 hours, refresh before expiry | Handle key rotation |
| Log validation failures | Include claim details (not token) | Security monitoring |

---

## 10. Configuration

### 10.1 Complete Configuration Schema

```typescript
/**
 * Complete OIDC/OAuth integration configuration
 */
interface OIDCIntegrationConfig {
  /** Global settings */
  global: GlobalOIDCConfig;
  /** Provider configurations */
  providers: ProviderConfig[];
  /** Default provider (if not determinable from token) */
  defaultProvider?: string;
  /** Claim mapping overrides */
  claimMappings?: Record<string, ClaimToPrincipalMapping>;
  /** Role extraction overrides */
  roleConfigs?: Record<string, RoleConfig>;
  /** Tenant extraction configuration */
  tenantExtraction?: Record<string, TenantExtractionConfig>;
  /** Security settings */
  security: SecurityConfig;
}

interface GlobalOIDCConfig {
  /** Enable OIDC integration */
  enabled: boolean;
  /** Clock skew tolerance in seconds */
  clockSkewSeconds: number;
  /** Default token location */
  tokenLocation: 'header' | 'query' | 'body';
  /** Token header name */
  tokenHeader: string;
  /** Token prefix (e.g., 'Bearer ') */
  tokenPrefix: string;
  /** Enable auto-discovery */
  autoDiscovery: boolean;
}

interface SecurityConfig {
  /** Algorithm configuration */
  algorithms: AlgorithmSecurityConfig;
  /** Key rotation handling */
  keyRotation: KeyRotationConfig;
  /** Replay prevention */
  replayPrevention: ReplayPreventionConfig;
  /** JWKS fetch security */
  jwks: {
    /** Require HTTPS */
    requireHttps: boolean;
    /** Allowed hosts (if restricted) */
    allowedHosts?: string[];
    /** Request timeout */
    timeoutMs: number;
  };
}
```

### 10.2 Configuration Examples by Provider

#### Okta Configuration

```yaml
oidc:
  global:
    enabled: true
    clockSkewSeconds: 60
    tokenLocation: header
    tokenHeader: Authorization
    tokenPrefix: "Bearer "
    autoDiscovery: true

  providers:
    - type: okta
      id: okta-production
      domain: acme.okta.com
      authorizationServerId: default
      audience: api://authz-engine

      # Optional: Enable introspection for opaque tokens
      introspection:
        enabled: true
        clientId: ${OKTA_CLIENT_ID}
        clientSecret: ${OKTA_CLIENT_SECRET}

  claimMappings:
    okta-production:
      standard:
        id: sub
        name: name
        email: email
      attributes:
        department:
          claim: department
          attribute: department
        employeeType:
          claim: employee_type
          attribute: employeeType
        manager:
          claim: manager
          attribute: managerId

  roleConfigs:
    okta-production:
      claimPaths:
        - groups
      stripPrefix: "authz-"
      caseTransform: lowercase
      excludePattern: "^Everyone$"

  security:
    algorithms:
      allowedAlgorithms: [RS256, RS384, RS512]
    replayPrevention:
      enabled: true
      method: jti
      store: redis
      trackingWindowMs: 86400000  # 24 hours
```

#### Auth0 Configuration

```yaml
oidc:
  providers:
    - type: auth0
      id: auth0-production
      domain: acme.auth0.com
      audience: https://api.acme.com

      # Custom claim namespace
      customClaimNamespace: https://acme.com/

  claimMappings:
    auth0-production:
      standard:
        id: sub
        name: name
        email: email
      attributes:
        organization:
          claim: https://acme.com/org_id
          attribute: organizationId
        tenant:
          claim: https://acme.com/tenant
          attribute: tenantId
        permissions:
          claim: permissions
          attribute: permissions
          transform: array

  roleConfigs:
    auth0-production:
      claimPaths:
        - permissions
        - https://acme.com/roles
      caseTransform: lowercase

  tenantExtraction:
    auth0-production:
      strategy: claim
      claimPath: https://acme.com/tenant
      required: true
```

#### Azure AD / Entra ID Configuration

```yaml
oidc:
  providers:
    - type: azure-ad
      id: azure-production
      tenantId: 12345678-1234-1234-1234-123456789abc
      clientId: abcdef12-3456-7890-abcd-ef1234567890
      audience: api://authz-engine

      # Include groups in tokens
      includeGroups: true

      # Enable app roles
      appRoles: true

  claimMappings:
    azure-production:
      standard:
        id: oid  # Use immutable Object ID
        name: name
        email: preferred_username
      attributes:
        tenantId:
          claim: tid
          attribute: tenantId
        userPrincipalName:
          claim: upn
          attribute: upn
        objectId:
          claim: oid
          attribute: azureObjectId

  roleConfigs:
    azure-production:
      claimPaths:
        - roles      # App roles
        - wids       # Directory roles
      caseTransform: lowercase

  # Group to role mapping (Azure AD groups are GUIDs)
  groupMappings:
    azure-production:
      12345678-aaaa-bbbb-cccc-123456789abc: admin
      12345678-dddd-eeee-ffff-123456789abc: editor
      12345678-1111-2222-3333-123456789abc: viewer

  tenantExtraction:
    azure-production:
      strategy: claim
      claimPath: tid
      required: true
```

#### Google Workspace Configuration

```yaml
oidc:
  providers:
    - type: google
      id: google-workspace
      clientId: 123456789-abcdefghijklmnop.apps.googleusercontent.com

      # Restrict to organization domain
      hostedDomain: acme.com

      # Enable group membership (requires Admin SDK)
      enableGroups: true
      serviceAccount:
        email: authz-service@acme-project.iam.gserviceaccount.com
        privateKey: ${GOOGLE_SERVICE_ACCOUNT_KEY}
        adminEmail: admin@acme.com

  claimMappings:
    google-workspace:
      standard:
        id: sub
        name: name
        email: email
      attributes:
        domain:
          claim: hd
          attribute: domain
        emailVerified:
          claim: email_verified
          attribute: emailVerified
          transform: boolean

  tenantExtraction:
    google-workspace:
      strategy: domain
      domainMapping:
        acme.com: acme-corp
        subsidiary.acme.com: acme-subsidiary
      defaultTenant: external
```

#### AWS Cognito Configuration

```yaml
oidc:
  providers:
    - type: cognito
      id: cognito-production
      region: us-east-1
      userPoolId: us-east-1_AbCdEfGhI
      clientId:
        - 1234567890abcdefghijklmnop  # Web client
        - 0987654321zyxwvutsrqponmlk  # Mobile client

      # Custom attributes use this prefix
      customAttributePrefix: "custom:"

  claimMappings:
    cognito-production:
      standard:
        id: sub
        name: name
        email: email
      attributes:
        username:
          claim: cognito:username
          attribute: username
        tenantId:
          claim: custom:tenant_id
          attribute: tenantId
        department:
          claim: custom:department
          attribute: department
        accessLevel:
          claim: custom:access_level
          attribute: accessLevel

  roleConfigs:
    cognito-production:
      claimPaths:
        - cognito:groups
        - custom:roles
      caseTransform: lowercase

  tenantExtraction:
    cognito-production:
      strategy: claim
      claimPath: custom:tenant_id
      required: true
```

#### Keycloak Configuration

```yaml
oidc:
  providers:
    - type: keycloak
      id: keycloak-production
      serverUrl: https://auth.acme.com
      realm: acme-production
      clientId: authz-engine
      clientSecret: ${KEYCLOAK_CLIENT_SECRET}

      # Include realm and client roles
      includeRealmRoles: true
      includeClientRoles: true
      resourceAccessClient: authz-engine

  claimMappings:
    keycloak-production:
      standard:
        id: sub
        name: name
        email: email
      attributes:
        username:
          claim: preferred_username
          attribute: username
        locale:
          claim: locale
          attribute: locale

  roleConfigs:
    keycloak-production:
      claimPaths:
        - realm_access.roles
        - resource_access.authz-engine.roles
        - groups
      caseTransform: lowercase

  tenantExtraction:
    keycloak-production:
      strategy: issuer
      issuerPattern: "/realms/([^/]+)$"
      required: true
```

#### Generic OIDC Configuration

```yaml
oidc:
  providers:
    - type: oidc
      id: custom-idp
      issuer: https://auth.example.com

      # Auto-discovery from .well-known/openid-configuration
      # Or explicit endpoints:
      jwksUri: https://auth.example.com/.well-known/jwks.json
      introspectionEndpoint: https://auth.example.com/oauth/introspect

      audience: authz-engine
      clientId: ${CUSTOM_IDP_CLIENT_ID}
      clientSecret: ${CUSTOM_IDP_CLIENT_SECRET}

      claimMapping:
        subjectClaim: sub
        emailClaim: email
        nameClaim: display_name
        attributeMappings:
          department: org_department
          team: org_team

      rolesConfig:
        claimPath: permissions
        delimiter: ","
        stripPrefix: "role:"
```

---

## 11. Testing Strategy

### 11.1 Unit Tests

| Component | Coverage Target | Test File |
|-----------|-----------------|-----------|
| Token Validator | 95% | `tests/unit/oidc/token-validator.test.ts` |
| JWKS Manager | 90% | `tests/unit/oidc/jwks-manager.test.ts` |
| Claim Mapper | 95% | `tests/unit/oidc/claim-mapper.test.ts` |
| Role Extractor | 95% | `tests/unit/oidc/role-extractor.test.ts` |
| Tenant Extractor | 90% | `tests/unit/oidc/tenant-extractor.test.ts` |
| Provider Adapters | 90% | `tests/unit/oidc/adapters/*.test.ts` |

### 11.2 Mock Identity Provider

```typescript
/**
 * Mock IdP for testing OIDC integration
 */
class MockIdentityProvider {
  private keyPair: KeyPair;
  private config: MockIdPConfig;
  private tokens: Map<string, MockTokenConfig> = new Map();

  constructor(config: MockIdPConfig) {
    this.config = config;
    this.keyPair = this.generateKeyPair();
  }

  /**
   * Generate a test JWT token
   */
  generateToken(config: MockTokenConfig): string {
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      iss: this.config.issuer,
      sub: config.subject,
      aud: config.audience || this.config.defaultAudience,
      exp: now + (config.expiresInSeconds || 3600),
      iat: now,
      nbf: now,
      jti: randomUUID(),
      ...config.customClaims
    };

    return this.signToken(payload, config.algorithm || 'RS256');
  }

  /**
   * Generate expired token for testing
   */
  generateExpiredToken(config: MockTokenConfig): string {
    return this.generateToken({
      ...config,
      expiresInSeconds: -3600  // Expired 1 hour ago
    });
  }

  /**
   * Generate token with invalid signature
   */
  generateInvalidSignatureToken(config: MockTokenConfig): string {
    const token = this.generateToken(config);
    // Tamper with signature
    const parts = token.split('.');
    parts[2] = 'invalid_signature_' + parts[2].substring(20);
    return parts.join('.');
  }

  /**
   * Get JWKS for mock provider
   */
  getJWKS(): JWKS {
    return {
      keys: [this.getPublicJWK()]
    };
  }

  /**
   * Start mock JWKS endpoint server
   */
  async startServer(port: number): Promise<void> {
    const app = express();

    // JWKS endpoint
    app.get('/.well-known/jwks.json', (req, res) => {
      res.json(this.getJWKS());
    });

    // OIDC discovery endpoint
    app.get('/.well-known/openid-configuration', (req, res) => {
      res.json({
        issuer: this.config.issuer,
        jwks_uri: `${this.config.issuer}/.well-known/jwks.json`,
        token_endpoint: `${this.config.issuer}/oauth/token`,
        introspection_endpoint: `${this.config.issuer}/oauth/introspect`
      });
    });

    // Introspection endpoint
    app.post('/oauth/introspect', express.urlencoded(), (req, res) => {
      const token = req.body.token;
      const mockConfig = this.tokens.get(token);

      if (mockConfig) {
        res.json({
          active: true,
          sub: mockConfig.subject,
          ...mockConfig.customClaims
        });
      } else {
        res.json({ active: false });
      }
    });

    await new Promise<void>((resolve) => {
      app.listen(port, resolve);
    });
  }
}

interface MockIdPConfig {
  issuer: string;
  defaultAudience: string;
  keyId?: string;
}

interface MockTokenConfig {
  subject: string;
  audience?: string;
  expiresInSeconds?: number;
  algorithm?: string;
  customClaims?: Record<string, unknown>;
}
```

### 11.3 Integration Test Scenarios

```typescript
describe('OIDC Integration', () => {
  let mockIdP: MockIdentityProvider;
  let validator: OIDCTokenValidator;

  beforeAll(async () => {
    mockIdP = new MockIdentityProvider({
      issuer: 'http://localhost:9999',
      defaultAudience: 'test-api'
    });
    await mockIdP.startServer(9999);

    validator = new OIDCTokenValidator({
      providers: [{
        type: 'oidc',
        id: 'mock',
        issuer: 'http://localhost:9999',
        audience: 'test-api'
      }]
    });
  });

  describe('Token Validation', () => {
    it('validates a correctly signed token', async () => {
      const token = mockIdP.generateToken({
        subject: 'user-123',
        customClaims: {
          email: 'user@example.com',
          roles: ['admin', 'editor']
        }
      });

      const identity = await validator.validateToken(token);

      expect(identity.subject).toBe('user-123');
      expect(identity.claims.email).toBe('user@example.com');
      expect(identity.roles).toContain('admin');
    });

    it('rejects an expired token', async () => {
      const token = mockIdP.generateExpiredToken({
        subject: 'user-123'
      });

      await expect(validator.validateToken(token))
        .rejects.toThrow(TokenExpiredError);
    });

    it('rejects a token with invalid signature', async () => {
      const token = mockIdP.generateInvalidSignatureToken({
        subject: 'user-123'
      });

      await expect(validator.validateToken(token))
        .rejects.toThrow(InvalidSignatureError);
    });

    it('rejects a token with wrong audience', async () => {
      const token = mockIdP.generateToken({
        subject: 'user-123',
        audience: 'wrong-api'
      });

      await expect(validator.validateToken(token))
        .rejects.toThrow(InvalidAudienceError);
    });
  });

  describe('Claim Mapping', () => {
    it('maps standard claims to principal', async () => {
      const token = mockIdP.generateToken({
        subject: 'user-123',
        customClaims: {
          email: 'user@example.com',
          name: 'Test User',
          department: 'Engineering'
        }
      });

      const identity = await validator.validateToken(token);
      const principal = identity.toPrincipal();

      expect(principal.id).toBe('user-123');
      expect(principal.attr?.email).toBe('user@example.com');
      expect(principal.attr?.department).toBe('Engineering');
    });
  });

  describe('Role Extraction', () => {
    it('extracts roles from array claim', async () => {
      const token = mockIdP.generateToken({
        subject: 'user-123',
        customClaims: {
          roles: ['admin', 'editor', 'viewer']
        }
      });

      const identity = await validator.validateToken(token);

      expect(identity.roles).toEqual(['admin', 'editor', 'viewer']);
    });

    it('extracts roles from nested claim', async () => {
      const token = mockIdP.generateToken({
        subject: 'user-123',
        customClaims: {
          realm_access: { roles: ['realm-admin'] },
          resource_access: {
            'my-app': { roles: ['app-editor'] }
          }
        }
      });

      // Configure for Keycloak-style extraction
      const identity = await validator.validateToken(token);

      expect(identity.roles).toContain('realm-admin');
      expect(identity.roles).toContain('app-editor');
    });
  });

  describe('Multi-tenant', () => {
    it('extracts tenant from claim', async () => {
      const token = mockIdP.generateToken({
        subject: 'user-123',
        customClaims: {
          'https://example.com/tenant': 'acme-corp'
        }
      });

      const identity = await validator.validateToken(token);

      expect(identity.tenantId).toBe('acme-corp');
    });

    it('extracts tenant from issuer', async () => {
      // Use tenant-specific issuer
      const tenantIdP = new MockIdentityProvider({
        issuer: 'http://localhost:9998/tenants/acme-corp',
        defaultAudience: 'test-api'
      });

      const token = tenantIdP.generateToken({
        subject: 'user-123'
      });

      // Configure for issuer-based extraction
      const identity = await validator.validateToken(token);

      expect(identity.tenantId).toBe('acme-corp');
    });
  });
});
```

### 11.4 Provider-Specific Test Fixtures

```yaml
# tests/fixtures/oidc/okta-tokens.yaml
tokens:
  - name: okta-valid-admin
    claims:
      iss: https://example.okta.com/oauth2/default
      sub: 00u123456789
      aud: api://authz-engine
      email: admin@example.com
      groups:
        - authz-admin
        - authz-users
      scp:
        - openid
        - profile
        - api:read
        - api:write
    expectedRoles:
      - admin
      - users

  - name: okta-expired
    claims:
      iss: https://example.okta.com/oauth2/default
      sub: 00u123456789
      exp: -3600  # Expired
    expectError: TOKEN_EXPIRED

# tests/fixtures/oidc/azure-tokens.yaml
tokens:
  - name: azure-valid-with-roles
    claims:
      iss: https://login.microsoftonline.com/tenant-id/v2.0
      sub: subject-id
      oid: object-id-123
      tid: tenant-id-456
      roles:
        - Task.Admin
        - Document.Read
      groups:
        - group-id-1
        - group-id-2
    expectedRoles:
      - task.admin
      - document.read
    expectedTenant: tenant-id-456
```

---

## 12. Related Documents

- [JWT-AUXDATA-SDD.md](./JWT-AUXDATA-SDD.md) - JWT validation and auxiliary data
- [MULTI-TENANCY-SDD.md](./MULTI-TENANCY-SDD.md) - Multi-tenant architecture
- [CORE-ARCHITECTURE-SDD.md](./CORE-ARCHITECTURE-SDD.md) - System architecture overview
- [CEL-EVALUATOR-SDD.md](./CEL-EVALUATOR-SDD.md) - CEL expression evaluation
- [COMPLIANCE-SECURITY-SDD.md](./COMPLIANCE-SECURITY-SDD.md) - Security and compliance
- [OBSERVABILITY-SDD.md](./OBSERVABILITY-SDD.md) - Monitoring and observability

---

## 13. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-11-23 | Initial specification |

---

## 14. Appendix

### A. OIDC Discovery Document Structure

```json
{
  "issuer": "https://auth.example.com",
  "authorization_endpoint": "https://auth.example.com/authorize",
  "token_endpoint": "https://auth.example.com/oauth/token",
  "userinfo_endpoint": "https://auth.example.com/userinfo",
  "jwks_uri": "https://auth.example.com/.well-known/jwks.json",
  "introspection_endpoint": "https://auth.example.com/oauth/introspect",
  "response_types_supported": ["code", "token", "id_token"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["RS256", "ES256"],
  "scopes_supported": ["openid", "profile", "email"],
  "claims_supported": ["sub", "iss", "aud", "exp", "iat", "email", "name"]
}
```

### B. Standard OIDC Claims Reference

| Claim | Type | Description |
|-------|------|-------------|
| `iss` | string | Issuer identifier |
| `sub` | string | Subject identifier |
| `aud` | string/array | Intended audience |
| `exp` | number | Expiration time (Unix timestamp) |
| `nbf` | number | Not before time (Unix timestamp) |
| `iat` | number | Issued at time (Unix timestamp) |
| `jti` | string | JWT ID (unique identifier) |
| `auth_time` | number | Authentication time |
| `nonce` | string | Value used to associate session with ID token |
| `acr` | string | Authentication Context Class Reference |
| `amr` | array | Authentication Methods References |
| `azp` | string | Authorized party |
| `name` | string | Full name |
| `given_name` | string | Given name(s) |
| `family_name` | string | Surname(s) |
| `middle_name` | string | Middle name(s) |
| `nickname` | string | Casual name |
| `preferred_username` | string | Shorthand name |
| `profile` | string | Profile page URL |
| `picture` | string | Profile picture URL |
| `website` | string | Web page URL |
| `email` | string | Email address |
| `email_verified` | boolean | Email verification status |
| `gender` | string | Gender |
| `birthdate` | string | Birthday (YYYY-MM-DD) |
| `zoneinfo` | string | Time zone |
| `locale` | string | Locale |
| `phone_number` | string | Phone number |
| `phone_number_verified` | boolean | Phone verification status |
| `address` | object | Physical address |
| `updated_at` | number | Last update time |

### C. CEL Functions for Identity

```typescript
/**
 * Custom CEL functions for identity operations
 */
const identityCelFunctions = {
  // Check if identity has a specific role
  'identity.hasRole': (role: string) => boolean,

  // Check if identity has any of the specified roles
  'identity.hasAnyRole': (roles: string[]) => boolean,

  // Check if identity has all of the specified roles
  'identity.hasAllRoles': (roles: string[]) => boolean,

  // Get identity provider name
  'identity.provider': () => string,

  // Check if identity is from specific provider
  'identity.isFromProvider': (provider: string) => boolean,

  // Get specific claim value
  'identity.claim': (path: string) => unknown,

  // Check if identity belongs to tenant
  'identity.belongsToTenant': (tenantId: string) => boolean,

  // Get identity email domain
  'identity.emailDomain': () => string,

  // Check if identity email is verified
  'identity.isEmailVerified': () => boolean
};

// Usage in CEL expressions
const celExpressionExamples = [
  // Role-based access
  'identity.hasRole("admin")',
  'identity.hasAnyRole(["admin", "editor"])',

  // Provider-specific
  'identity.isFromProvider("azure-ad") && identity.claim("tid") == resource.attr.tenantId',

  // Multi-tenant
  'identity.belongsToTenant(resource.attr.tenantId)',

  // Domain-based
  'identity.emailDomain() == "acme.com"',

  // Combined conditions
  'identity.hasRole("manager") && identity.claim("department") == resource.attr.department'
];
```
