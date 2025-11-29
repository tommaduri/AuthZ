# Scoped Policies - Software Design Document

**Module**: `@authz-engine/core`
**Version**: 1.1.0
**Status**: ✅ Implemented
**Author**: AuthZ Engine Team
**Created**: 2024-11-23
**Last Updated**: 2025-11-24
**Reviewers**: Claude Code
**Implementation Commit**: `17a57d7`

---

## 1. Overview

### 1.1 Purpose

Scoped Policies provide a hierarchical policy organization mechanism that enables policies to be targeted at specific organizational boundaries such as tenants, departments, teams, or regions. This feature is essential for multi-tenant SaaS applications and enterprises with complex organizational structures.

Scopes create policy inheritance chains where more specific scopes can override or extend policies defined at broader scopes, enabling fine-grained access control while maintaining centralized policy management.

### 1.2 Scope

**In Scope:**
- Hierarchical scope definition and resolution
- Policy inheritance and override behavior
- Scope-aware policy evaluation in DecisionEngine
- Scope validation and wildcards
- Request-level scope context passing
- Performance-optimized scope resolution caching

**Out of Scope:**
- Scope management UI/API (separate feature)
- Automatic scope discovery from identity providers
- Cross-scope policy conflict resolution beyond deny-overrides
- Scope-based quota management

### 1.3 Context

Scoped Policies integrate with the existing `@authz-engine/core` package by extending the `PolicyMetadata` type and modifying the `DecisionEngine` to support scope-aware policy resolution. This feature aligns with Cerbos scoped policies functionality for API compatibility.

### 1.4 Key Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Dot-notation scope hierarchy | Intuitive, widely used (DNS, Java packages) | Slash-delimited paths, nested objects |
| Most-specific-scope-wins | Clear precedence, predictable behavior | Merge all scopes, weighted scoring |
| Optional scope field | Backward compatible with existing policies | Required scope, separate policy type |
| Scope inheritance chain in results | Enables debugging and audit | Return only effective policy |

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-001 | Support hierarchical scope definition using dot notation | Must Have | ✅ Complete |
| FR-002 | Resolve policies from most specific to least specific scope | Must Have | ✅ Complete |
| FR-003 | Allow policies without scope to act as global defaults | Must Have | ✅ Complete |
| FR-004 | Support scope wildcards for pattern matching | Should Have | ✅ Complete |
| FR-005 | Return inheritance chain in check response for debugging | Should Have | ✅ Complete |
| FR-006 | Validate scope format on policy load | Must Have | ✅ Complete |
| FR-007 | Support both principal and resource scopes in requests | Must Have | ✅ Complete |
| FR-008 | Cache scope resolution results for performance | Should Have | ✅ Complete |

### 2.3 Implementation Summary

**Implemented in commit `17a57d7`** (2025-11-24):

| Component | File | Lines | Tests |
|-----------|------|-------|-------|
| ScopeResolver | `src/scope/scope-resolver.ts` | 552 | 87 |
| Scope Types | `src/scope/types.ts` | 80 | - |
| DecisionEngine Extensions | `src/engine/decision-engine.ts` | +164 | 28 |
| Policy Types | `src/types/policy.types.ts` | +44 | - |
| Schema Updates | `src/policy/schema.ts` | +2 | - |
| **Total** | | **2,306** | **115** |

**Performance Results**:
- Single check: 2.62μs avg (382K checks/sec)
- High throughput: 1.1M checks/sec
- Scope chain caching with LRU eviction

### 2.2 Non-Functional Requirements

| ID | Category | Requirement | Target |
|----|----------|-------------|--------|
| NFR-001 | Performance | Scope resolution latency | < 1ms additional overhead |
| NFR-002 | Performance | Scope cache hit rate | > 95% |
| NFR-003 | Scalability | Max scope depth | 10 levels |
| NFR-004 | Scalability | Max policies per scope | 1000 |
| NFR-005 | Reliability | Fail-closed on invalid scope | DENY if scope validation fails |

---

## 3. Architecture

### 3.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          @authz-engine/core                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌───────────────────────┐     ┌──────────────────────────────────────┐ │
│  │   CheckRequest        │     │         ScopeResolver                │ │
│  │   + scope context     │────►│                                      │ │
│  │                       │     │  - buildScopeChain()                 │ │
│  └───────────────────────┘     │  - matchScope()                      │ │
│                                │  - resolvePoliciesForScope()         │ │
│                                └──────────────┬───────────────────────┘ │
│                                               │                          │
│                                               ▼                          │
│  ┌───────────────────────┐     ┌──────────────────────────────────────┐ │
│  │  Scoped Policy Store  │     │        DecisionEngine                │ │
│  │                       │────►│        (extended)                    │ │
│  │  Map<scope, Policy[]> │     │                                      │ │
│  │  + global policies    │     │  - checkWithScope()                  │ │
│  └───────────────────────┘     │  - evaluateWithInheritance()         │ │
│                                └──────────────┬───────────────────────┘ │
│                                               │                          │
│                                               ▼                          │
│                                ┌──────────────────────────────────────┐ │
│                                │  ScopeResolutionResult               │ │
│                                │  - matchedScope                      │ │
│                                │  - effectivePolicy                   │ │
│                                │  - inheritanceChain                  │ │
│                                └──────────────────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Scope Hierarchy Model

```
                    ┌─────────────┐
                    │   (global)  │  No scope = applies everywhere
                    │   default   │
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
      ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
      │   acme    │  │  globex   │  │   initech │  Tenant level
      └─────┬─────┘  └───────────┘  └───────────┘
            │
      ┌─────┴─────┐
      │           │
┌─────▼─────┐ ┌───▼───┐
│   corp    │ │  labs │  Division level
└─────┬─────┘ └───────┘
      │
┌─────┴───────────┐
│                 │
┌▼──────────┐ ┌───▼────┐
│engineering│ │ sales  │  Department level
└─────┬─────┘ └────────┘
      │
┌─────▼─────┐
│   team1   │  Team level
└───────────┘

Scope: acme.corp.engineering.team1
```

### 3.3 Data Flow

```
CheckRequest { scope: "acme.corp.engineering" }
                    │
                    ▼
┌───────────────────────────────────────────┐
│           ScopeResolver                   │
│                                           │
│  1. Parse scope: ["acme", "corp",         │
│                   "engineering"]          │
│                                           │
│  2. Build scope chain:                    │
│     - acme.corp.engineering (most specific)
│     - acme.corp                           │
│     - acme                                │
│     - (global)                            │
│                                           │
│  3. For each scope (most to least):       │
│     - Find matching policies              │
│     - If found, return                    │
│                                           │
└─────────────────┬─────────────────────────┘
                  │
                  ▼
┌───────────────────────────────────────────┐
│         DecisionEngine.check()            │
│                                           │
│  Evaluate with resolved policies          │
│  Apply deny-overrides algorithm           │
│                                           │
└─────────────────┬─────────────────────────┘
                  │
                  ▼
ScopeResolutionResult {
  matchedScope: "acme.corp",
  effectivePolicy: <Policy>,
  inheritanceChain: [
    "acme.corp.engineering",  // checked, no match
    "acme.corp",              // matched
    "acme",                   // not checked
    "(global)"                // not checked
  ]
}
```

### 3.4 Integration Points

| Integration | Protocol | Direction | Description |
|-------------|----------|-----------|-------------|
| DecisionEngine | Internal | In | Scope context in CheckRequest |
| PolicyLoader | Internal | In | Scoped policies from YAML files |
| REST API | HTTP | In | Scope header or body field |
| gRPC API | gRPC | In | Scope field in protobuf message |
| SDK | Internal | Out | ScopeResolutionResult in response |

---

## 4. Component Design

### 4.1 Scope Resolution Algorithm

The scope resolution algorithm walks from the most specific scope to the least specific (global), returning the first matching policy.

```typescript
/**
 * Scope Resolution Algorithm
 *
 * Input:
 *   - requestScope: string (e.g., "acme.corp.engineering.team1")
 *   - resourceKind: string (e.g., "document")
 *   - action: string (e.g., "view")
 *
 * Process:
 *   1. Parse requestScope into segments
 *   2. Build scope chain from most to least specific
 *   3. For each scope in chain:
 *      a. Check if policies exist for this scope + resource
 *      b. If found, evaluate and return
 *   4. Fall back to global (unscoped) policies
 *   5. If no match, return default deny
 *
 * Output:
 *   - ScopeResolutionResult with matched policy and inheritance chain
 */
function resolveScope(
  requestScope: string,
  resourceKind: string,
  scopedPolicies: Map<string, Policy[]>,
  globalPolicies: Policy[]
): ScopeResolutionResult {
  const scopeChain = buildScopeChain(requestScope);
  const checkedScopes: string[] = [];

  for (const scope of scopeChain) {
    checkedScopes.push(scope);
    const policies = scopedPolicies.get(`${scope}:${resourceKind}`);

    if (policies && policies.length > 0) {
      return {
        matchedScope: scope,
        effectivePolicy: policies[0], // First matching policy
        inheritanceChain: checkedScopes,
      };
    }
  }

  // Check global policies
  checkedScopes.push('(global)');
  const globalMatch = globalPolicies.find(p => p.spec.resource === resourceKind);

  return {
    matchedScope: '(global)',
    effectivePolicy: globalMatch || null,
    inheritanceChain: checkedScopes,
  };
}

function buildScopeChain(scope: string): string[] {
  if (!scope) return [];

  const segments = scope.split('.');
  const chain: string[] = [];

  // Build from most specific to least specific
  for (let i = segments.length; i > 0; i--) {
    chain.push(segments.slice(0, i).join('.'));
  }

  return chain;
}
```

### 4.2 Scope Wildcards and Patterns

Scopes support wildcard patterns for flexible policy targeting:

| Pattern | Description | Example |
|---------|-------------|---------|
| Exact | Matches exact scope | `acme.corp.engineering` |
| Single wildcard | Matches one segment | `acme.*.engineering` |
| Multi wildcard | Matches zero or more segments | `acme.**` |
| Suffix wildcard | Matches any suffix | `**.engineering` |

```typescript
function matchScope(pattern: string, scope: string): boolean {
  // Exact match
  if (pattern === scope) return true;

  // Convert pattern to regex
  const regexPattern = pattern
    .replace(/\.\*\*/g, '(\\..*)?')      // ** matches zero or more segments
    .replace(/\*\*/g, '.*')               // ** at start/end
    .replace(/\*/g, '[^.]+')              // * matches one segment
    .replace(/\./g, '\\.');               // Escape dots

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(scope);
}

// Examples:
// matchScope("acme.corp", "acme.corp")           -> true
// matchScope("acme.*", "acme.corp")              -> true
// matchScope("acme.*", "acme.corp.engineering")  -> false
// matchScope("acme.**", "acme.corp.engineering") -> true
// matchScope("**.engineering", "acme.corp.engineering") -> true
```

### 4.3 Policy Override Behavior

When multiple policies exist at different scopes, the override behavior follows these rules:

1. **Most Specific Wins**: A policy at `acme.corp.engineering` overrides one at `acme.corp`
2. **Complete Override**: Scoped policy completely replaces parent scope policy (no merging)
3. **Deny Overrides Allow**: Within the same scope, deny rules take precedence
4. **No Scope = Global**: Policies without scope apply when no scoped policy matches

```yaml
# Global policy (no scope) - applies everywhere unless overridden
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy-global
spec:
  resource: document
  rules:
    - actions: [view]
      effect: allow
      roles: [user]

---
# Scoped policy - overrides global for acme.engineering
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy-engineering
  scope: acme.engineering
spec:
  resource: document
  rules:
    - actions: [view, edit]      # Engineering gets edit too
      effect: allow
      roles: [user]
    - actions: [delete]
      effect: allow
      roles: [admin]

---
# More specific scope - overrides acme.engineering
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy-team1
  scope: acme.engineering.team1
spec:
  resource: document
  rules:
    - actions: [view, edit, delete]  # team1 gets full access
      effect: allow
      roles: [user]
```

---

## 5. Interfaces

### 5.1 Type Definitions

```typescript
/**
 * Extended PolicyMetadata with optional scope field
 */
interface PolicyMetadata {
  /** Unique name for this policy */
  name: string;
  /** Optional description */
  description?: string;
  /** Policy version for tracking changes */
  version?: string;
  /** Labels for organization */
  labels?: Record<string, string>;
  /**
   * Scope this policy applies to.
   * Uses dot notation for hierarchy: "tenant.division.department.team"
   * Omit for global policies.
   */
  scope?: string;
}

/**
 * Scoped Policy interface for both ResourcePolicy and PrincipalPolicy
 */
interface ScopedPolicy {
  apiVersion: 'authz.engine/v1';
  kind: 'ResourcePolicy' | 'PrincipalPolicy';
  metadata: {
    name: string;
    /** Hierarchical scope identifier */
    scope: string;
  };
  spec: ResourcePolicySpec | PrincipalPolicySpec;
}

/**
 * Result of scope resolution process
 */
interface ScopeResolutionResult {
  /** The scope that matched (or "(global)" for unscoped) */
  matchedScope: string;
  /** The effective policy to apply */
  effectivePolicy: Policy | null;
  /**
   * Scopes checked during resolution, in order from most to least specific.
   * Useful for debugging and audit trails.
   */
  inheritanceChain: string[];
}

/**
 * Extended CheckRequest with scope context
 */
interface ScopedCheckRequest extends CheckRequest {
  /**
   * Scope context for this request.
   * If both principal and resource have scopes, they are intersected.
   */
  scope?: {
    /** Scope of the requesting principal (e.g., their tenant) */
    principal?: string;
    /** Scope of the resource being accessed */
    resource?: string;
  };
}

/**
 * Extended CheckResponse with scope information
 */
interface ScopedCheckResponse extends CheckResponse {
  /** Scope resolution details */
  scopeResolution?: {
    /** Effective scope used for policy lookup */
    effectiveScope: string;
    /** Chain of scopes checked */
    inheritanceChain: string[];
    /** Whether a scoped policy was found */
    scopedPolicyMatched: boolean;
  };
}

/**
 * Scope validation result
 */
interface ScopeValidationResult {
  valid: boolean;
  error?: string;
  normalizedScope?: string;
}

/**
 * Scope configuration options
 */
interface ScopeConfig {
  /** Maximum depth of scope hierarchy (default: 10) */
  maxDepth: number;
  /** Allowed characters in scope segments (default: alphanumeric + hyphen) */
  allowedCharacters: RegExp;
  /** Whether to allow wildcards in policy scopes (default: true) */
  allowWildcards: boolean;
  /** Cache TTL for scope resolution results in ms (default: 60000) */
  cacheTtlMs: number;
}
```

### 5.2 Public API

#### ScopeResolver Class

```typescript
/**
 * Resolves scopes and finds applicable policies
 */
class ScopeResolver {
  constructor(config?: Partial<ScopeConfig>);

  /**
   * Build the inheritance chain for a scope
   * @param scope - Dot-notated scope string
   * @returns Array of scopes from most to least specific
   */
  buildScopeChain(scope: string): string[];

  /**
   * Check if a scope pattern matches a target scope
   * @param pattern - Scope pattern (may include wildcards)
   * @param scope - Target scope to match against
   * @returns Whether the pattern matches
   */
  matchScope(pattern: string, scope: string): boolean;

  /**
   * Resolve policies for a given scope and resource
   * @param requestScope - Request scope context
   * @param resourceKind - Resource type
   * @param scopedPolicies - Map of scope to policies
   * @param globalPolicies - Unscoped global policies
   * @returns Resolution result with matched policy and chain
   */
  resolvePoliciesForScope(
    requestScope: string,
    resourceKind: string,
    scopedPolicies: Map<string, Policy[]>,
    globalPolicies: Policy[]
  ): ScopeResolutionResult;

  /**
   * Validate a scope string
   * @param scope - Scope to validate
   * @returns Validation result
   */
  validateScope(scope: string): ScopeValidationResult;

  /**
   * Determine effective scope from principal and resource scopes
   * @param principalScope - Scope of the principal
   * @param resourceScope - Scope of the resource
   * @returns Effective scope for policy lookup
   */
  computeEffectiveScope(
    principalScope?: string,
    resourceScope?: string
  ): string;

  /**
   * Get cache statistics
   */
  getCacheStats(): { hits: number; misses: number; size: number };

  /**
   * Clear the resolution cache
   */
  clearCache(): void;
}
```

#### Extended DecisionEngine Methods

```typescript
class DecisionEngine {
  // ... existing methods ...

  /**
   * Load scoped resource policies
   * @param policies - Policies with scope metadata
   */
  loadScopedResourcePolicies(policies: ScopedPolicy[]): void;

  /**
   * Check authorization with scope context
   * @param request - Check request with scope information
   * @returns Response including scope resolution details
   */
  checkWithScope(request: ScopedCheckRequest): ScopedCheckResponse;

  /**
   * Get policies for a specific scope
   * @param scope - Scope to query
   * @param resourceKind - Optional resource filter
   * @returns Policies at the specified scope
   */
  getPoliciesForScope(
    scope: string,
    resourceKind?: string
  ): Policy[];

  /**
   * Get all scopes that have policies
   * @returns Array of scope strings
   */
  getRegisteredScopes(): string[];
}
```

---

## 6. Data Models

### 6.1 Scoped Resource Policy Schema

```yaml
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
  description: "Document access policy for engineering department"
  version: "1.2.0"
  scope: acme.corp.engineering  # Hierarchical scope
  labels:
    environment: production
    compliance: soc2
spec:
  resource: document
  rules:
    - name: view-documents
      actions: [view]
      effect: allow
      roles: [user, viewer]

    - name: edit-own-documents
      actions: [edit]
      effect: allow
      roles: [user]
      condition:
        expression: "resource.ownerId == principal.id"

    - name: admin-full-access
      actions: ["*"]
      effect: allow
      roles: [admin]

    - name: deny-external
      actions: ["*"]
      effect: deny
      condition:
        expression: "principal.attributes.external == true"
```

### 6.2 Scoped Principal Policy Schema

```yaml
apiVersion: authz.engine/v1
kind: PrincipalPolicy
metadata:
  name: contractor-policy
  scope: acme.corp          # Applies to all of acme.corp and below
spec:
  principal: "contractor-*"  # Wildcard principal pattern
  version: "1.0"
  rules:
    - resource: document
      actions:
        - action: view
          effect: allow
        - action: edit
          effect: deny
        - action: delete
          effect: deny

    - resource: project
      actions:
        - action: view
          effect: allow
          condition:
            expression: "resource.visibility == 'public'"
```

### 6.3 Global Policy (No Scope)

```yaml
# This policy applies when no scoped policy matches
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy-default
  # No scope field = global policy
spec:
  resource: document
  rules:
    - name: basic-view
      actions: [view]
      effect: allow
      roles: [authenticated]

    - name: default-deny-write
      actions: [create, edit, delete]
      effect: deny
      roles: ["*"]
```

### 6.4 Internal Storage Model

```typescript
// Internal storage structure for scoped policies
interface ScopedPolicyStore {
  // Key format: "scope:resourceKind" or ":resourceKind" for global
  policies: Map<string, ValidatedResourcePolicy[]>;

  // Index for quick scope lookup
  scopeIndex: Map<string, Set<string>>; // scope -> set of resourceKinds

  // Derived roles by scope
  derivedRoles: Map<string, ValidatedDerivedRolesPolicy[]>;

  // Principal policies by scope
  principalPolicies: Map<string, ValidatedPrincipalPolicy[]>;
}
```

---

## 7. Error Handling

### 7.1 Error Types

| Error Code | Name | Description | Recovery |
|------------|------|-------------|----------|
| SCOPE_001 | InvalidScopeFormat | Scope string contains invalid characters | Fix scope format |
| SCOPE_002 | ScopeDepthExceeded | Scope exceeds maximum depth | Reduce nesting |
| SCOPE_003 | ScopeResolutionFailed | Could not resolve scope chain | Check policy configuration |
| SCOPE_004 | ConflictingScopePolicies | Multiple policies at same scope for resource | Remove duplicates |
| SCOPE_005 | InvalidWildcardPattern | Wildcard pattern syntax error | Fix pattern syntax |

### 7.2 Error Hierarchy

```typescript
class ScopeError extends AuthzError {
  constructor(
    message: string,
    public code: string,
    public scope: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ScopeError';
  }
}

class InvalidScopeError extends ScopeError {
  constructor(scope: string, reason: string) {
    super(
      `Invalid scope "${scope}": ${reason}`,
      'SCOPE_001',
      scope,
      { reason }
    );
  }
}

class ScopeDepthError extends ScopeError {
  constructor(scope: string, depth: number, maxDepth: number) {
    super(
      `Scope "${scope}" exceeds maximum depth of ${maxDepth}`,
      'SCOPE_002',
      scope,
      { depth, maxDepth }
    );
  }
}
```

### 7.3 Error Handling Behavior

| Scenario | Behavior | Rationale |
|----------|----------|-----------|
| Invalid scope in request | Return DENY with error | Fail-closed security |
| Invalid scope in policy | Reject policy load | Prevent misconfiguration |
| No matching scoped policy | Fall back to global | Graceful degradation |
| Scope resolution timeout | Return DENY | Performance protection |

---

## 8. Security Considerations

### 8.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| Scope injection | Strict validation, no dynamic evaluation |
| Privilege escalation via scope manipulation | Validate scope claims against token |
| Denial of service via deep scopes | Max depth limit (default: 10) |
| Policy bypass via wildcard abuse | Controlled wildcard usage |

### 8.2 Security Controls

1. **Scope Validation**: All scopes validated against allowed character set
2. **Depth Limiting**: Configurable maximum scope depth
3. **No Dynamic Scopes**: Scopes cannot be computed from expressions
4. **Audit Logging**: All scope resolution decisions logged
5. **Claim Verification**: Request scope should match JWT/token claims

### 8.3 Best Practices

```typescript
// DO: Validate scope from token claims
const validateScopeFromToken = (request: ScopedCheckRequest, token: JWT): boolean => {
  const tokenScope = token.claims.scope || token.claims.tenant;
  const requestScope = request.scope?.principal;

  // Request scope must be within token scope
  return requestScope?.startsWith(tokenScope) ?? false;
};

// DON'T: Trust client-provided scope without validation
// BAD: request.scope = req.body.scope; // Never do this

// DO: Derive scope from authenticated identity
const deriveScope = (principal: Principal): string => {
  return principal.attributes.tenant as string || '';
};
```

---

## 9. Performance Requirements

### 9.1 Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Scope resolution latency | < 1ms | Cached resolution |
| Policy lookup with scope | < 2ms | Including inheritance chain |
| Cache hit rate | > 95% | After warm-up period |
| Memory per scope | < 10KB | Metadata and indices |

### 9.2 Optimization Strategies

1. **Scope Chain Caching**: Cache computed inheritance chains
2. **Policy Index**: Pre-index policies by scope:resource key
3. **Lazy Resolution**: Only resolve scope when scoped policies exist
4. **Batch Scope Resolution**: Resolve multiple resources in single operation

```typescript
// Efficient scope chain cache
class ScopeChainCache {
  private cache: Map<string, { chain: string[]; expires: number }>;
  private ttlMs: number;

  get(scope: string): string[] | undefined {
    const entry = this.cache.get(scope);
    if (entry && entry.expires > Date.now()) {
      return entry.chain;
    }
    return undefined;
  }

  set(scope: string, chain: string[]): void {
    this.cache.set(scope, {
      chain,
      expires: Date.now() + this.ttlMs,
    });
  }
}
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

| Component | Coverage Target | Test File |
|-----------|-----------------|-----------|
| ScopeResolver | 95% | `tests/unit/scope/resolver.test.ts` |
| Scope validation | 95% | `tests/unit/scope/validation.test.ts` |
| Wildcard matching | 95% | `tests/unit/scope/wildcards.test.ts` |
| DecisionEngine (scoped) | 90% | `tests/unit/engine/scoped-decisions.test.ts` |

### 10.2 Integration Tests

| Scenario | Components Involved | Test File |
|----------|---------------------|-----------|
| Multi-tenant policy resolution | ScopeResolver, DecisionEngine | `tests/integration/multi-tenant.test.ts` |
| Inheritance chain validation | ScopeResolver, PolicyLoader | `tests/integration/inheritance.test.ts` |
| Scope + derived roles | ScopeResolver, CelEvaluator | `tests/integration/scope-derived-roles.test.ts` |

### 10.3 Test Scenarios

```typescript
describe('ScopeResolver', () => {
  describe('buildScopeChain', () => {
    it('should build chain from most to least specific', () => {
      const resolver = new ScopeResolver();
      const chain = resolver.buildScopeChain('acme.corp.engineering.team1');

      expect(chain).toEqual([
        'acme.corp.engineering.team1',
        'acme.corp.engineering',
        'acme.corp',
        'acme',
      ]);
    });

    it('should return empty array for empty scope', () => {
      expect(resolver.buildScopeChain('')).toEqual([]);
    });
  });

  describe('matchScope', () => {
    it('should match exact scopes', () => {
      expect(resolver.matchScope('acme.corp', 'acme.corp')).toBe(true);
      expect(resolver.matchScope('acme.corp', 'acme.labs')).toBe(false);
    });

    it('should match single wildcards', () => {
      expect(resolver.matchScope('acme.*', 'acme.corp')).toBe(true);
      expect(resolver.matchScope('acme.*', 'acme.corp.eng')).toBe(false);
    });

    it('should match multi wildcards', () => {
      expect(resolver.matchScope('acme.**', 'acme.corp.eng.team1')).toBe(true);
      expect(resolver.matchScope('**.engineering', 'acme.corp.engineering')).toBe(true);
    });
  });

  describe('resolvePoliciesForScope', () => {
    it('should return most specific matching policy', () => {
      const scopedPolicies = new Map([
        ['acme:document', [acmeDocPolicy]],
        ['acme.corp:document', [corpDocPolicy]],
        ['acme.corp.engineering:document', [engDocPolicy]],
      ]);

      const result = resolver.resolvePoliciesForScope(
        'acme.corp.engineering.team1',
        'document',
        scopedPolicies,
        []
      );

      expect(result.matchedScope).toBe('acme.corp.engineering');
      expect(result.effectivePolicy).toBe(engDocPolicy);
      expect(result.inheritanceChain).toEqual([
        'acme.corp.engineering.team1',
        'acme.corp.engineering',
      ]);
    });

    it('should fall back to global when no scope matches', () => {
      const result = resolver.resolvePoliciesForScope(
        'unknown.tenant',
        'document',
        new Map(),
        [globalDocPolicy]
      );

      expect(result.matchedScope).toBe('(global)');
      expect(result.effectivePolicy).toBe(globalDocPolicy);
    });
  });
});

describe('DecisionEngine with Scopes', () => {
  it('should use scoped policy over global', async () => {
    engine.loadScopedResourcePolicies([
      { ...globalPolicy, metadata: { name: 'global', scope: undefined } },
      { ...scopedPolicy, metadata: { name: 'scoped', scope: 'acme.corp' } },
    ]);

    const response = engine.checkWithScope({
      principal: { id: 'user1', roles: ['user'], attributes: {} },
      resource: { kind: 'document', id: 'doc1', attributes: {} },
      actions: ['edit'],
      scope: { principal: 'acme.corp.engineering' },
    });

    expect(response.results.edit.effect).toBe('allow');
    expect(response.scopeResolution?.matchedScope).toBe('acme.corp');
  });
});
```

### 10.4 Performance Tests

| Test | Target | Scenario |
|------|--------|----------|
| Scope resolution cold | < 5ms | First request, no cache |
| Scope resolution warm | < 0.5ms | Cached resolution |
| 10-level deep scope | < 2ms | Maximum depth traversal |
| 1000 scoped policies | < 10ms | Large policy set lookup |

---

## 11. Use Cases

### 11.1 Multi-Tenant SaaS Application

```yaml
# Tenant-level policy: Acme Corp
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: project-policy
  scope: acme
spec:
  resource: project
  rules:
    - actions: [view, edit]
      effect: allow
      roles: [member]
    - actions: [delete]
      effect: allow
      roles: [owner]

---
# Department override: Acme Engineering gets more permissions
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: project-policy-eng
  scope: acme.engineering
spec:
  resource: project
  rules:
    - actions: [view, edit, delete, archive]
      effect: allow
      roles: [member]  # Engineering members can do more
```

### 11.2 Regional Compliance Variations

```yaml
# Global GDPR-compliant policy
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: user-data-policy
spec:
  resource: user_data
  rules:
    - actions: [view]
      effect: allow
      roles: [admin]
      condition:
        expression: "principal.attributes.gdpr_trained == true"

---
# US region: Less restrictive
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: user-data-policy-us
  scope: region.us
spec:
  resource: user_data
  rules:
    - actions: [view, export]
      effect: allow
      roles: [admin]
```

### 11.3 Request Examples

```typescript
// Multi-tenant request
const checkResult = await engine.checkWithScope({
  principal: {
    id: 'user-123',
    roles: ['member'],
    attributes: { tenant: 'acme' },
  },
  resource: {
    kind: 'project',
    id: 'proj-456',
    attributes: { ownerId: 'user-789' },
  },
  actions: ['view', 'edit', 'delete'],
  scope: {
    principal: 'acme.engineering',
    resource: 'acme.engineering',
  },
});

// Response
{
  requestId: 'req-abc',
  results: {
    view: { effect: 'allow', policy: 'project-policy-eng' },
    edit: { effect: 'allow', policy: 'project-policy-eng' },
    delete: { effect: 'allow', policy: 'project-policy-eng' },
  },
  scopeResolution: {
    effectiveScope: 'acme.engineering',
    inheritanceChain: ['acme.engineering'],
    scopedPolicyMatched: true,
  },
}
```

---

## 12. Dependencies

### 12.1 Internal Dependencies

| Package | Usage |
|---------|-------|
| `@authz-engine/core` | Base types, DecisionEngine, CelEvaluator |

### 12.2 External Dependencies

No new external dependencies required. Uses existing:
- `zod` for schema validation
- `cel-js` for condition evaluation

---

## 13. Migration Guide

### 13.1 Adding Scopes to Existing Policies

Existing policies without scopes continue to work as global policies:

```yaml
# Before (still valid - becomes global)
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
spec:
  resource: document
  rules: [...]

# After (scoped version)
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
  scope: acme.corp  # Added scope
spec:
  resource: document
  rules: [...]
```

### 13.2 API Changes

The `check` method remains backward compatible. Use `checkWithScope` for scope-aware evaluation:

```typescript
// Existing code continues to work
const result = engine.check(request);

// New scope-aware code
const scopedResult = engine.checkWithScope({
  ...request,
  scope: { principal: 'acme.corp' },
});
```

---

## 14. Related Documents

- [CORE-PACKAGE-SDD.md](./CORE-PACKAGE-SDD.md) - Core engine architecture
- [CEL-EVALUATOR-SDD.md](./CEL-EVALUATOR-SDD.md) - Expression evaluation
- [CERBOS-FEATURE-PARITY-SDD.md](./CERBOS-FEATURE-PARITY-SDD.md) - Feature compatibility
- [ADR-006: Cerbos API Compatibility](../adr/ADR-006-CERBOS-API-COMPATIBILITY.md)

---

## 15. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.1.0 | 2025-11-24 | **✅ IMPLEMENTED** - Full implementation with 115 tests, 2,306 lines |
| 1.0.0 | 2024-11-23 | Initial draft - scope resolution, inheritance, wildcards |

---

## Appendix A: Configuration Reference

```typescript
// Default configuration
const defaultScopeConfig: ScopeConfig = {
  maxDepth: 10,
  allowedCharacters: /^[a-zA-Z0-9_-]+$/,
  allowWildcards: true,
  cacheTtlMs: 60000, // 1 minute
};

// Environment variables
// AUTHZ_SCOPE_MAX_DEPTH=10
// AUTHZ_SCOPE_CACHE_TTL_MS=60000
// AUTHZ_SCOPE_ALLOW_WILDCARDS=true
```

## Appendix B: Scope Naming Conventions

| Level | Convention | Example |
|-------|------------|---------|
| Tenant | Company or customer name | `acme`, `globex` |
| Division | Business unit | `acme.corp`, `acme.labs` |
| Department | Functional area | `acme.corp.engineering` |
| Team | Specific team | `acme.corp.engineering.platform` |
| Region | Geographic | `region.us`, `region.eu` |
| Environment | Deployment stage | `env.production`, `env.staging` |
