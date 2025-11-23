# ADR-006: Cerbos API Compatibility

**Status**: Accepted
**Date**: 2024-11-23
**Deciders**: AuthZ Engine Team
**Technical Story**: API design for Cerbos migration compatibility

---

## Context

Many organizations have existing integrations with Cerbos, an open-source authorization engine. To enable easy migration and interoperability, we needed to decide how compatible our API should be with the Cerbos API.

Key considerations:
1. **Migration Path**: Organizations should be able to migrate from Cerbos with minimal changes
2. **Policy Compatibility**: Existing Cerbos policies should work with minimal modifications
3. **SDK Compatibility**: Existing Cerbos SDK code should be easily adaptable
4. **Innovation Freedom**: We shouldn't be constrained from adding new features

## Decision

We adopted **Wire-Level Compatibility** with Cerbos's core API while extending it for agentic features:

### Compatible Elements

| Element | Compatibility | Notes |
|---------|---------------|-------|
| `/v1/check` endpoint | Full | Same request/response structure |
| `/v1/check/resources` endpoint | Full | Batch checking supported |
| Policy YAML format | Full | Same `apiVersion`, `kind`, `spec` |
| CEL expressions | Full | Same expression syntax |
| Principal/Resource structure | Full | Same fields and semantics |
| gRPC service | Full | Compatible protobuf definitions |

### Extensions (AuthZ Engine Specific)

| Endpoint | Purpose | Notes |
|----------|---------|-------|
| `/v1/explain` | Decision explanations | Agentic ADVISOR integration |
| `/agents/*` | Agent management | Health, anomalies, patterns |
| `/admin/*` | Administration | Policy reload, metrics |

### Request/Response Format

```typescript
// Cerbos-compatible CheckRequest
interface CheckRequest {
  requestId?: string;
  principal: {
    id: string;
    roles: string[];
    attr?: Record<string, unknown>;
  };
  resource: {
    kind: string;
    id: string;
    attr?: Record<string, unknown>;
  };
  actions: string[];
  auxData?: {
    jwt?: { token: string };
  };
}

// Cerbos-compatible CheckResponse
interface CheckResponse {
  requestId: string;
  results: Record<string, {
    effect: 'EFFECT_ALLOW' | 'EFFECT_DENY';
    policy: string;
    meta?: {
      matchedRule?: string;
      effectiveDerivedRoles?: string[];
    };
  }>;
  meta?: {
    evaluationDurationMs: number;
    policiesEvaluated: string[];
  };
}
```

### Policy Format

```yaml
# Fully compatible with Cerbos policy format
apiVersion: api.cerbos.dev/v1
resourcePolicy:
  version: default
  resource: document
  rules:
    - actions: ["view", "edit"]
      effect: EFFECT_ALLOW
      roles: ["editor"]
      condition:
        match:
          expr: resource.attr.ownerId == principal.id
```

## Consequences

### Positive

- **Easy Migration**: Drop-in replacement for Cerbos in many cases
- **Ecosystem Leverage**: Existing Cerbos SDKs, tools, and documentation apply
- **Reduced Learning Curve**: Teams familiar with Cerbos can onboard quickly
- **Interoperability**: Can run alongside Cerbos during migration
- **Policy Reuse**: Existing Cerbos policies work without modification

### Negative

- **Constrained Innovation**: Some API decisions follow Cerbos conventions
- **Dual Documentation**: Need to document both Cerbos compatibility and extensions
- **Version Tracking**: Must track Cerbos API changes for compatibility

### Neutral

- Effect enum uses `EFFECT_ALLOW`/`EFFECT_DENY` (Cerbos style) externally
- Internal types use `allow`/`deny` for brevity (see ADR-003)

## Migration Guide

### From Cerbos to AuthZ Engine

1. **Policies**: Copy YAML files directly (no changes needed)
2. **Server**: Replace Cerbos server with AuthZ Engine server
3. **SDK**: Update import paths, API is the same
4. **Configuration**: Map Cerbos env vars to AuthZ Engine config

### SDK Adaptation Example

```typescript
// Before (Cerbos SDK)
import { GRPC as CerbosClient } from '@cerbos/grpc';
const client = new CerbosClient('cerbos:3593');

// After (AuthZ Engine SDK)
import { AuthzClient } from '@authz-engine/sdk-typescript';
const client = new AuthzClient({ serverUrl: 'http://authz:3592' });

// API calls are identical
const result = await client.check({
  principal: { id: 'user1', roles: ['editor'] },
  resource: { kind: 'document', id: 'doc1' },
  actions: ['view'],
});
```

## Alternatives Considered

| Alternative | Pros | Cons | Why Not Chosen |
|-------------|------|------|----------------|
| **Full Cerbos clone** | 100% compatible | No differentiation | Limited value |
| **Completely new API** | Full freedom | Migration barrier | Loses ecosystem |
| **GraphQL API** | Modern, flexible | Not Cerbos compatible | Different paradigm |
| **OPA-compatible** | Alternative ecosystem | Less familiar to target users | Different use case |

## Testing Strategy

- Integration tests verify Cerbos policy files work unchanged
- API tests compare responses with Cerbos reference server
- SDK tests ensure same code works with both engines

## Related ADRs

- [ADR-001](./ADR-001-CEL-EXPRESSION-LANGUAGE.md): CEL compatibility for expressions
- [ADR-003](./ADR-003-ACTION-RESULT-EFFECT.md): Internal effect type representation
- [ADR-005](./ADR-005-AGENTIC-AUTHORIZATION.md): Agentic extensions beyond Cerbos

## References

- [Cerbos API Documentation](https://docs.cerbos.dev/cerbos/latest/api/)
- [Cerbos Policy Format](https://docs.cerbos.dev/cerbos/latest/policies/)
- [Cerbos SDK](https://github.com/cerbos/cerbos-sdk-javascript)
