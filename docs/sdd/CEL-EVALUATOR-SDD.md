# CEL Evaluator - System Design Document

**Module**: `@authz-engine/core/cel`
**Version**: 0.1.0
**Last Updated**: 2024-11-23
**Author**: Aegis Authorization Engine Team

---

## 1. Overview

### 1.1 Purpose
The CEL (Common Expression Language) Evaluator is the expression evaluation engine for the Aegis Authorization Engine. It parses and evaluates CEL expressions used in policy conditions, enabling dynamic authorization decisions based on principal attributes, resource properties, and contextual data.

### 1.2 Scope
This document covers:
- CEL expression parsing and evaluation
- Cerbos-compatible context structure
- Expression caching and performance optimization
- Custom CEL functions
- Error handling and security considerations

### 1.3 Dependencies
| Dependency | Version | Purpose |
|------------|---------|---------|
| `cel-js` | ^0.4.0 | CEL parsing and evaluation engine |
| TypeScript | ^5.3.0 | Type-safe implementation |

---

## 2. Architecture

### 2.1 Component Diagram
```
┌─────────────────────────────────────────────────────────────────┐
│                        CelEvaluator                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │   Parser     │  │   Cache      │  │   Custom Functions    │ │
│  │  (cel-js)    │  │  (LRU+TTL)   │  │  (timestamp, size,    │ │
│  │              │  │              │  │   matches, etc.)      │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘ │
│         │                 │                      │              │
│         └─────────────────┼──────────────────────┘              │
│                           │                                     │
│                    ┌──────▼───────┐                            │
│                    │  Evaluator   │                            │
│                    │   Engine     │                            │
│                    └──────┬───────┘                            │
│                           │                                     │
├───────────────────────────┼─────────────────────────────────────┤
│                    ┌──────▼───────┐                            │
│                    │  Context     │                            │
│                    │  Builder     │                            │
│                    │ (Cerbos-     │                            │
│                    │ compatible)  │                            │
│                    └──────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Class Diagram
```typescript
class CelEvaluator {
  // Configuration
  - expressionCache: Map<string, CachedExpression>
  - maxCacheSize: number
  - cacheTtlMs: number
  - customFunctions: CelFunctions

  // Metrics
  - cacheHits: number
  - cacheMisses: number

  // Public Methods
  + evaluate(expression: string, context: EvaluationContext): EvaluationResult
  + evaluateBoolean(expression: string, context: EvaluationContext): boolean
  + validateExpression(expression: string): ValidationResult
  + compileExpression(expression: string): void
  + clearCache(): void
  + getCacheStats(): CacheStats

  // Private Methods
  - getOrParseExpression(expression: string): ParsedCst
  - cacheExpression(expression: string, cst: ParsedCst, now: number): void
  - evictOldestEntries(count: number): void
  - buildEvalContext(context: EvaluationContext): Record<string, unknown>
  - buildCustomFunctions(): CelFunctions
  - handleEvaluationError(error: unknown): EvaluationResult
}
```

---

## 3. Data Structures

### 3.1 EvaluationContext
The input context for CEL expression evaluation, following Cerbos-compatible structure.

```typescript
interface EvaluationContext {
  /** The principal (user/service) making the request */
  readonly principal: Principal;
  /** The resource being accessed */
  readonly resource: Resource;
  /** Additional auxiliary data for complex conditions */
  readonly auxData?: Readonly<Record<string, unknown>>;
  /** Current timestamp for time-based conditions */
  readonly now?: Date;
}
```

### 3.2 Principal
```typescript
interface Principal {
  /** Unique identifier */
  id: string;
  /** Assigned roles */
  roles: string[];
  /** Custom attributes */
  attributes: Record<string, unknown>;
}
```

### 3.3 Resource
```typescript
interface Resource {
  /** Resource type (e.g., 'avatar', 'subscription') */
  kind: string;
  /** Unique identifier */
  id: string;
  /** Custom attributes */
  attributes: Record<string, unknown>;
}
```

### 3.4 EvaluationResult
```typescript
interface EvaluationResult {
  /** Whether evaluation completed successfully */
  readonly success: boolean;
  /** Result value (typically boolean for policy conditions) */
  readonly value?: unknown;
  /** Error message if evaluation failed */
  readonly error?: string;
  /** Error type for categorization */
  readonly errorType?: 'parse' | 'evaluation' | 'type' | 'unknown';
}
```

### 3.5 CacheStats
```typescript
interface CacheStats {
  /** Number of cached expressions */
  readonly size: number;
  /** Cache hit count */
  readonly hits: number;
  /** Cache miss count */
  readonly misses: number;
  /** Hit rate percentage */
  readonly hitRate: number;
}
```

---

## 4. Context Structure

### 4.1 Cerbos-Compatible Context
The evaluator builds a context structure compatible with Cerbos policies:

```typescript
{
  // Full Cerbos-style access
  request: {
    principal: {
      id: string,
      roles: string[],
      attr: Record<string, unknown>
    },
    resource: {
      kind: string,
      id: string,
      attr: Record<string, unknown>
    },
    auxData: Record<string, unknown>
  },

  // Shorthand access (attributes spread at top level)
  principal: {
    id: string,
    roles: string[],
    ...attributes
  },
  resource: {
    kind: string,
    id: string,
    ...attributes
  },

  // Auxiliary data
  variables: Record<string, unknown>,

  // Time values
  now: Date,
  nowTimestamp: number
}
```

### 4.2 Expression Examples
```cel
// Ownership check
resource.ownerId == principal.id

// Role-based access
"admin" in principal.roles

// Attribute comparison
request.resource.attr.status == "active"

// Complex conditions
resource.ownerId == principal.id && resource.status != "deleted"

// Time-based conditions
nowTimestamp > resource.expiresAt

// JWT claim validation
request.auxData.jwt.sub == principal.id
```

---

## 5. Custom Functions

### 5.1 String Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `startsWith` | `(str, prefix) -> bool` | Check if string starts with prefix |
| `endsWith` | `(str, suffix) -> bool` | Check if string ends with suffix |
| `contains` | `(str, substr) -> bool` | Check if string contains substring |
| `matches` | `(str, pattern) -> bool` | Check if string matches regex pattern |

### 5.2 Collection Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `size` | `(value) -> int` | Get size of array, string, or object |
| `exists` | `(list, predicate) -> bool` | Check if any element matches predicate |
| `all` | `(list, predicate) -> bool` | Check if all elements match predicate |

### 5.3 Type Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `type` | `(value) -> string` | Get type of value ('string', 'number', 'list', etc.) |
| `timestamp` | `(value) -> Date` | Convert string/number to timestamp |
| `duration` | `(value) -> number` | Parse duration string to milliseconds |

### 5.4 Network Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `inIPRange` | `(ip, cidr) -> bool` | Check if IP is within CIDR range |

### 5.5 Duration Format
```
Examples:
- "30s"  -> 30000ms (30 seconds)
- "5m"   -> 300000ms (5 minutes)
- "2h"   -> 7200000ms (2 hours)
- "1d"   -> 86400000ms (1 day)
```

---

## 6. Caching Strategy

### 6.1 Cache Configuration
| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxCacheSize` | 1000 | Maximum cached expressions |
| `cacheTtlMs` | 3600000 | Cache TTL (1 hour) |

### 6.2 Cache Behavior
1. **Cache Hit**: Return cached CST, increment hit counter
2. **Cache Miss**: Parse expression, cache CST, increment miss counter
3. **TTL Expiry**: Re-parse on next access if TTL exceeded
4. **Eviction**: LRU eviction of oldest 10% when capacity reached

### 6.3 Cache Flow
```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Expression │────▶│ Cache Lookup │────▶│   Hit?      │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                │
                           ┌────────────────────┼────────────────────┐
                           │ Yes                │                    │ No
                           ▼                    │                    ▼
                    ┌──────────────┐            │           ┌──────────────┐
                    │ Return CST   │            │           │ Parse Expr   │
                    │ (Cache Hit)  │            │           └──────┬───────┘
                    └──────────────┘            │                  │
                                                │                  ▼
                                                │           ┌──────────────┐
                                                │           │ Cache CST    │
                                                │           └──────┬───────┘
                                                │                  │
                                                │                  ▼
                                                │           ┌──────────────┐
                                                └──────────▶│  Evaluate    │
                                                            └──────────────┘
```

---

## 7. Error Handling

### 7.1 Error Categories

| Type | Cause | Example |
|------|-------|---------|
| `parse` | Invalid CEL syntax | `"invalid {{ syntax"` |
| `evaluation` | Runtime evaluation failure | Division by zero |
| `type` | Type mismatch | `"string" + 5` |
| `unknown` | Unexpected errors | Internal errors |

### 7.2 Fail-Closed Security
The `evaluateBoolean` method implements fail-closed security:

```typescript
evaluateBoolean(expression: string, context: EvaluationContext): boolean {
  const result = this.evaluate(expression, context);

  if (!result.success) {
    // Fail-closed: deny on error for security
    return false;
  }

  // Strict boolean check - must be exactly true
  return result.value === true;
}
```

**Rationale**: In authorization, errors should result in denial rather than accidental permission grants.

---

## 8. Security Considerations

### 8.1 CEL Sandboxing
- CEL is a sandboxed expression language (no I/O, no side effects)
- Only registered functions and context variables are accessible
- No arbitrary code execution possible

### 8.2 Input Validation
- Expressions are validated before evaluation
- Context values are immutable (readonly interfaces)
- No prototype pollution possible through CEL

### 8.3 Denial of Service Protection
- Expression caching limits repeated parsing overhead
- Cache size limits prevent memory exhaustion
- TTL prevents stale cache entries

### 8.4 Audit Trail
- All evaluation results include success/error status
- Error categorization enables security monitoring
- Cache statistics support performance monitoring

---

## 9. Performance Characteristics

### 9.1 Benchmarks (Expected)
| Operation | Target | Notes |
|-----------|--------|-------|
| Cache hit evaluation | < 0.1ms | Pre-parsed CST |
| Cache miss evaluation | < 5ms | Includes parsing |
| Simple expression | < 0.05ms | Basic comparisons |
| Complex expression | < 1ms | Multiple conditions |

### 9.2 Memory Usage
| Component | Size | Notes |
|-----------|------|-------|
| CelEvaluator instance | ~1KB | Base overhead |
| Cached expression | ~2-10KB | Depends on complexity |
| Max cache footprint | ~10MB | 1000 expressions |

---

## 10. Usage Examples

### 10.1 Basic Evaluation
```typescript
import { CelEvaluator, EvaluationContext } from '@authz-engine/core';

const evaluator = new CelEvaluator();

const context: EvaluationContext = {
  principal: {
    id: 'user-123',
    roles: ['editor'],
    attributes: { department: 'engineering' }
  },
  resource: {
    kind: 'document',
    id: 'doc-456',
    attributes: { ownerId: 'user-123', status: 'draft' }
  }
};

// Boolean evaluation (fail-closed)
const allowed = evaluator.evaluateBoolean(
  'resource.ownerId == principal.id && resource.status == "draft"',
  context
);
// Result: true

// Full result with error info
const result = evaluator.evaluate('resource.ownerId == principal.id', context);
// Result: { success: true, value: true }
```

### 10.2 Expression Validation
```typescript
const validation = evaluator.validateExpression('principal.id == "test"');
// Result: { valid: true }

const invalid = evaluator.validateExpression('invalid {{ syntax');
// Result: { valid: false, errors: ['...'] }
```

### 10.3 Pre-compilation
```typescript
// Pre-compile frequently used expressions at startup
evaluator.compileExpression('resource.ownerId == principal.id');
evaluator.compileExpression('"admin" in principal.roles');

// Later evaluations will use cached CST
const result = evaluator.evaluateBoolean('resource.ownerId == principal.id', context);
```

### 10.4 Cache Monitoring
```typescript
const stats = evaluator.getCacheStats();
console.log(`Cache size: ${stats.size}`);
console.log(`Hit rate: ${stats.hitRate.toFixed(2)}%`);

// Clear cache if needed
evaluator.clearCache();
```

---

## 11. Testing Strategy

### 11.1 Test Categories
| Category | Count | Coverage |
|----------|-------|----------|
| Expression evaluation | 9 | Basic operators, comparisons |
| Validation | 4 | Syntax validation, error detection |
| Caching | 2 | Cache hits, misses, stats |
| Custom functions | 9 | All custom functions |
| Cerbos context | 6 | Context access patterns |
| Error handling | 2 | Error categorization |
| Compilation | 2 | Pre-compilation, invalid syntax |

### 11.2 Test File Location
```
packages/core/tests/unit/cel/evaluator.test.ts
```

### 11.3 Running Tests
```bash
# Run CEL evaluator tests
npx vitest run packages/core/tests/unit/cel/evaluator.test.ts

# Run with verbose output
npx vitest run packages/core/tests/unit/cel/evaluator.test.ts --reporter=verbose
```

---

## 12. Configuration

### 12.1 Constructor Options
```typescript
const evaluator = new CelEvaluator({
  maxCacheSize: 2000,      // Increase cache capacity
  cacheTtlMs: 30 * 60000   // 30 minutes TTL
});
```

### 12.2 Default Instance
```typescript
import { celEvaluator } from '@authz-engine/core';

// Use default instance (maxCacheSize: 1000, TTL: 1 hour)
const result = celEvaluator.evaluateBoolean('principal.id == "admin"', context);
```

---

## 13. Migration Notes

### 13.1 From Previous Implementation
The previous implementation used `new Function()` for expression evaluation, which had security concerns:

```typescript
// OLD (insecure)
new Function('principal', 'resource', `return ${expression}`);

// NEW (secure)
import { parse, evaluate } from 'cel-js';
const cst = parse(expression);
const result = evaluate(cst, context, customFunctions);
```

### 13.2 Breaking Changes
- Expression syntax must now be valid CEL
- Custom function calls use `function(arg)` syntax, not method syntax

---

## 14. Future Enhancements

### 14.1 Planned
- [ ] Expression macro support
- [ ] Custom function registration API
- [ ] Expression optimization/simplification
- [ ] Streaming evaluation for large datasets

### 14.2 Under Consideration
- [ ] Expression versioning
- [ ] Distributed cache support
- [ ] Expression telemetry/tracing
- [ ] WASM-based evaluation for performance

---

## 15. References

- [CEL Specification](https://github.com/google/cel-spec)
- [cel-js Library](https://github.com/nicktomlin/cel-js)
- [Cerbos Policy Language](https://docs.cerbos.dev/cerbos/latest/policies)
- [Google CEL-Go](https://github.com/google/cel-go)
