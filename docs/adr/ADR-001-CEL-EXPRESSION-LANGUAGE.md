# ADR-001: CEL as Expression Language

**Status**: Accepted
**Date**: 2024-11-23
**Deciders**: AuthZ Engine Team
**Technical Story**: Core policy evaluation requirement

---

## Context

The AuthZ Engine needs an expression language for evaluating policy conditions. Policy rules need to express complex logic like:
- `resource.ownerId == principal.id`
- `"admin" in principal.roles`
- `request.timestamp.getHours() >= 9 && request.timestamp.getHours() <= 17`

We needed a language that is:
1. Safe to execute (no arbitrary code execution)
2. Fast to evaluate
3. Expressive enough for authorization logic
4. Well-documented with good tooling
5. Compatible with Cerbos policy format

## Decision

We chose **CEL (Common Expression Language)** using the `cel-js` library as our expression evaluation engine.

### Implementation Details

```typescript
// packages/core/src/cel/evaluator.ts
import { parse, evaluate } from 'cel-js';

export class CELEvaluator {
  evaluate(expression: string, context: EvaluationContext): unknown {
    const ast = parse(expression);
    return evaluate(ast, this.buildContext(context));
  }
}
```

### Context Structure
```typescript
interface EvaluationContext {
  principal: Principal;   // P - who is making the request
  resource: Resource;     // R - what they're accessing
  request: Request;       // Request metadata (timestamp, IP, etc.)
  variables: Variables;   // V - user-defined variables
}
```

## Consequences

### Positive
- **Industry Standard**: CEL is used by Google, Kubernetes, Firebase, and Cerbos
- **Sandboxed Execution**: No filesystem, network, or system access
- **Type Safety**: Strong typing catches errors at parse time
- **Performance**: Compiled expressions can be cached and reused
- **Cerbos Compatibility**: Same expression language as Cerbos policies

### Negative
- **Learning Curve**: Developers need to learn CEL syntax
- **Limited Standard Library**: Fewer built-in functions than JavaScript
- **cel-js Limitations**: Some CEL features may not be fully supported

### Neutral
- CEL syntax is similar to C/Java expressions, familiar to most developers
- Error messages from cel-js are reasonably clear

## Alternatives Considered

| Alternative | Pros | Cons | Why Not Chosen |
|-------------|------|------|----------------|
| **JavaScript eval()** | Full JS features, familiar | Security nightmare, slow | Unsafe for policy evaluation |
| **JSONLogic** | JSON-based, simple | Limited expressiveness, verbose | Too limited for complex policies |
| **Rego (OPA)** | Powerful, industry standard | Different paradigm, heavier runtime | Not compatible with Cerbos format |
| **Custom DSL** | Full control | Development overhead, no ecosystem | Build vs buy - CEL is proven |

## Implementation Notes

### CEL Features Used
- Arithmetic: `+`, `-`, `*`, `/`, `%`
- Comparison: `==`, `!=`, `<`, `<=`, `>`, `>=`
- Logical: `&&`, `||`, `!`
- Membership: `in` operator for lists/maps
- String functions: `contains()`, `startsWith()`, `endsWith()`
- Time functions: `getHours()`, `getDayOfWeek()`

### Custom Extensions
We added these custom functions to the CEL context:
- `now()` - Current timestamp
- `hierarchy(resource)` - Resource hierarchy check
- `hasPermission(principal, permission)` - Permission check

### Performance Targets
- Expression parsing: < 1ms
- Expression evaluation: < 0.5ms
- Cache hit ratio: > 95% for repeated expressions

## Related ADRs
- ADR-006: Cerbos API Compatibility (uses CEL for conditions)

## References
- [CEL Specification](https://github.com/google/cel-spec)
- [cel-js Library](https://github.com/nicktomlin/cel-js)
- [Cerbos CEL Documentation](https://docs.cerbos.dev/cerbos/latest/policies/conditions)
