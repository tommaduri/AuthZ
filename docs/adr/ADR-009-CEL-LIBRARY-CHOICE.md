# ADR-009: CEL Expression Library Choice

**Status**: Accepted
**Date**: 2024-11-23
**Decision Makers**: Aegis Authorization Engine Team

---

## Context

The Aegis Authorization Engine requires a CEL (Common Expression Language) evaluator to process policy conditions. CEL is the standard expression language used by Cerbos, Google Cloud IAM, and other authorization systems.

### Requirements
1. **Cerbos Compatibility**: Must support Cerbos-style expressions
2. **Type Safety**: TypeScript support with proper type definitions
3. **Security**: Sandboxed execution, no arbitrary code execution
4. **Performance**: Sub-millisecond evaluation for simple expressions
5. **Zero Cerbos Dependencies**: Cannot use Cerbos libraries directly
6. **MIT/Apache License**: Must be permissively licensed

### Options Considered

#### Option 1: cel-js (Selected)
- **Repo**: https://github.com/nicktomlin/cel-js
- **License**: MIT
- **Stars**: ~100
- **Size**: ~50KB

**Pros:**
- Pure JavaScript/TypeScript implementation
- MIT licensed (permissive)
- Proper CEL grammar parser (Chevrotain-based)
- Custom function support
- Good TypeScript types
- Active maintenance

**Cons:**
- Smaller community than alternatives
- Missing some advanced CEL features (macros)
- No WASM acceleration

#### Option 2: cel-go (WASM compiled)
- **Repo**: https://github.com/google/cel-go
- **License**: Apache 2.0

**Pros:**
- Google's reference implementation
- Complete CEL specification support
- Battle-tested at scale

**Cons:**
- Requires WASM compilation
- Larger bundle size (~2MB)
- Complex build process
- Potential WASM runtime issues in some environments

#### Option 3: Custom Implementation
**Pros:**
- Full control
- Minimal dependencies
- Optimized for our use case

**Cons:**
- Significant development effort (4-8 weeks)
- High risk of bugs in parser/evaluator
- Ongoing maintenance burden
- Would delay project significantly

#### Option 4: expr-eval
- **Repo**: https://github.com/silentmatt/expr-eval
- **License**: MIT

**Pros:**
- Simple, lightweight
- Good performance

**Cons:**
- Not CEL-compatible syntax
- Would require expression translation layer
- Missing CEL-specific features

---

## Decision

**Selected: cel-js**

We chose cel-js because it provides the best balance of:
1. **Correct CEL semantics** with proper grammar parsing
2. **Zero runtime dependencies** on external services
3. **TypeScript-first** design with excellent types
4. **Permissive MIT license** compatible with our project
5. **Reasonable performance** for our scale requirements

---

## Consequences

### Positive
- Immediate CEL expression support
- Clean TypeScript integration
- Easy custom function registration
- No complex build requirements

### Negative
- Missing some advanced CEL features (macros like `has()`)
- May need to contribute upstream for missing features
- Smaller community means less external support

### Mitigations
1. **Missing Features**: Implement as custom functions where possible
2. **Community Size**: Maintain fork if upstream becomes inactive
3. **Performance**: Expression caching compensates for any parsing overhead

---

## Implementation Notes

### Integration Pattern
```typescript
import { parse, evaluate, CelParseError } from 'cel-js';

// Parse once, evaluate many times
const cst = parse('resource.ownerId == principal.id');
const result = evaluate(cst, context, customFunctions);
```

### Custom Functions Added
- `size()` - Collection/string length
- `startsWith()`, `endsWith()`, `contains()` - String operations
- `matches()` - Regex matching
- `timestamp()`, `duration()` - Time operations
- `inIPRange()` - Network CIDR matching

### Caching Strategy
- LRU cache for parsed expressions
- 1000 entry default capacity
- 1 hour TTL
- 10% eviction on capacity

---

## Alternatives for Future Consideration

If cel-js proves insufficient, we could:
1. **Contribute to cel-js**: Add missing features upstream
2. **Fork cel-js**: Maintain our own enhanced version
3. **WASM cel-go**: Accept larger bundle for full CEL compliance
4. **Hybrid approach**: Use cel-js for common cases, cel-go WASM for complex

---

## Review Schedule

- **6 months**: Review performance and feature gaps
- **12 months**: Re-evaluate alternatives if issues arise

---

## References

- [CEL Specification](https://github.com/google/cel-spec)
- [cel-js Repository](https://github.com/nicktomlin/cel-js)
- [cel-go Repository](https://github.com/google/cel-go)
- [Cerbos Conditions](https://docs.cerbos.dev/cerbos/latest/policies/conditions)
