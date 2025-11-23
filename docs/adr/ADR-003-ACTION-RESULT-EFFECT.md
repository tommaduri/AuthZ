# ADR-003: ActionResult uses `effect` not `allowed`

**Status**: Accepted
**Date**: 2024-11-23
**Deciders**: AuthZ Engine Team
**Technical Story**: Type alignment between core and agents packages

---

## Context

When designing the authorization response type, we had two options:

**Option A: Boolean `allowed`**
```typescript
interface ActionResult {
  allowed: boolean;
  policy: string;
}
```

**Option B: String `effect`**
```typescript
interface ActionResult {
  effect: 'allow' | 'deny';
  policy: string;
}
```

The initial agents package used `allowed: boolean` while the core package used `effect: 'allow' | 'deny'`. This caused TypeScript errors and confusion.

## Decision

We standardized on **`effect: 'allow' | 'deny'`** as the canonical representation.

### Type Definition (core/types.ts)
```typescript
export interface ActionResult {
  /** The effect of the policy evaluation */
  effect: 'allow' | 'deny';

  /** The policy that produced this result */
  policy: string;

  /** Additional metadata */
  meta?: {
    matchedRule?: string;
    evaluatedConditions?: string[];
    derivedRoles?: string[];
  };
}
```

### Usage Pattern
```typescript
// Checking the result
if (result.effect === 'allow') {
  // Permitted
}

// Helper function (for convenience)
function isAllowed(result: ActionResult): boolean {
  return result.effect === 'allow';
}
```

## Consequences

### Positive
- **Cerbos Compatibility**: Cerbos uses `effect` in its API
- **Explicit Semantics**: `'allow' | 'deny'` is self-documenting
- **Extensibility**: Can add future effects like `'conditional'` or `'default_deny'`
- **Type Safety**: String literal union prevents invalid values
- **Debugging**: Log output shows `effect: "deny"` not `allowed: false`

### Negative
- **Verbose Checks**: `result.effect === 'allow'` instead of `result.allowed`
- **Refactoring Cost**: Had to update agents package to use new pattern
- **Helper Needed**: Added `isAllowed()` helper for boolean contexts

### Neutral
- Both representations carry the same information
- JSON serialization is similar in size

## Alternatives Considered

| Alternative | Pros | Cons | Why Not Chosen |
|-------------|------|------|----------------|
| **Boolean `allowed`** | Simpler checks | Not Cerbos compatible, less explicit | Breaks API compatibility |
| **Numeric (0/1)** | Compact | Not semantic, error-prone | Poor developer experience |
| **Enum** | Type-safe | Enums have quirks in TS | String literal union is cleaner |

## Migration Guide

### Before (agents package)
```typescript
// Old pattern
interface OldActionResult {
  allowed: boolean;
  policy: string;
}

// Old usage
if (result.allowed) { ... }
```

### After (aligned with core)
```typescript
// New pattern
interface ActionResult {
  effect: 'allow' | 'deny';
  policy: string;
}

// New usage
if (result.effect === 'allow') { ... }

// Or with helper
function isAllowed(result: ActionResult): boolean {
  return result.effect === 'allow';
}
```

### Files Changed
- `packages/agents/src/types/agent.types.ts` - Imported core ActionResult
- `packages/agents/src/advisor/advisor-agent.ts` - Added isAllowed helper
- `packages/agents/src/enforcer/enforcer-agent.ts` - Created EnforcerActionResult
- `packages/agents/src/core/decision-store.ts` - Updated type imports

## Related ADRs
- ADR-006: Cerbos API Compatibility (effect is part of Cerbos format)

## References
- [Cerbos API Response Format](https://docs.cerbos.dev/cerbos/latest/api/index.html)
