# Software Design Document: @authz-engine/core

**Version**: 1.0.0
**Package**: `packages/core`
**Status**: Implemented
**Last Updated**: 2024-11-23

---

## 1. Overview

### 1.1 Purpose

The `@authz-engine/core` package provides the foundational policy evaluation engine for the AuthZ authorization system. It handles policy parsing, CEL expression evaluation, and authorization decision-making.

### 1.2 Scope

This package includes:
- Type definitions for policies, principals, resources, and requests
- CEL (Common Expression Language) expression evaluator
- Decision engine for policy evaluation
- Policy schema validation

### 1.3 Package Structure

```
packages/core/
├── src/
│   ├── index.ts                    # Package exports
│   ├── types/
│   │   ├── index.ts               # Type exports
│   │   └── policy.types.ts        # All type definitions
│   ├── cel/
│   │   ├── index.ts               # CEL exports
│   │   └── evaluator.ts           # CelEvaluator class
│   ├── engine/
│   │   ├── index.ts               # Engine exports
│   │   └── decision-engine.ts     # DecisionEngine class
│   └── policy/
│       ├── index.ts               # Policy exports
│       ├── parser.ts              # Policy parser
│       └── schema.ts              # JSON Schema validation
├── tests/
└── package.json
```

---

## 2. Architecture

### 2.1 Component Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                     @authz-engine/core                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐    ┌────────────────┐    ┌──────────────┐  │
│  │   Types     │    │  CEL Evaluator │    │   Decision   │  │
│  │             │◄───┤                │◄───┤   Engine     │  │
│  │ policy.types│    │  evaluator.ts  │    │              │  │
│  └─────────────┘    └────────────────┘    └──────────────┘  │
│         │                   │                    │          │
│         │                   │                    │          │
│         ▼                   ▼                    ▼          │
│  ┌─────────────┐    ┌────────────────┐    ┌──────────────┐  │
│  │   Schema    │    │   cel-js       │    │  Validated   │  │
│  │ Validation  │    │   library      │    │  Policies    │  │
│  └─────────────┘    └────────────────┘    └──────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

```
CheckRequest
     │
     ▼
┌──────────────────┐
│  DecisionEngine  │
│                  │
│  1. Get policies │──────────► ResourcePolicies[]
│     for resource │
│                  │
│  2. Compute      │──────────► DerivedRoles[]
│     derived roles│◄────────── CelEvaluator
│                  │
│  3. Evaluate     │
│     each action  │
│         │        │
│         ▼        │
│     For each     │
│     policy rule: │
│     - Match action
│     - Match roles │──────────► CelEvaluator
│     - Eval condition          (evaluateBoolean)
│         │        │
│         ▼        │
│     Apply deny-  │
│     overrides    │
│                  │
└────────┬─────────┘
         │
         ▼
   CheckResponse
```

---

## 3. Component Design

### 3.1 Types Module (`types/policy.types.ts`)

#### 3.1.1 Core Types

```typescript
// Effect of authorization decision
type Effect = 'allow' | 'deny';

// Entity making the request
interface Principal {
  id: string;
  roles: string[];
  attributes: Record<string, unknown>;
}

// Resource being accessed
interface Resource {
  kind: string;
  id: string;
  attributes: Record<string, unknown>;
}
```

#### 3.1.2 Policy Types

| Type | Description | Key Fields |
|------|-------------|------------|
| `ResourcePolicy` | Policy for a resource type | `spec.resource`, `spec.rules[]` |
| `DerivedRolesPolicy` | Dynamic role definitions | `spec.definitions[]` |
| `PrincipalPolicy` | User-specific overrides | `spec.principal`, `spec.rules[]` |
| `PolicyRule` | Single rule within a policy | `actions[]`, `effect`, `roles?`, `condition?` |
| `PolicyCondition` | CEL condition | `expression: string` |

#### 3.1.3 Request/Response Types

```typescript
interface CheckRequest {
  requestId?: string;
  principal: Principal;
  resource: Resource;
  actions: string[];
  auxData?: Record<string, unknown>;
}

interface CheckResponse {
  requestId: string;
  results: Record<string, ActionResult>;
  meta?: {
    evaluationDurationMs: number;
    policiesEvaluated: string[];
  };
}

interface ActionResult {
  effect: Effect;
  policy: string;
  meta?: {
    matchedRule?: string;
    effectiveDerivedRoles?: string[];
    evaluationDurationMs?: number;
  };
}
```

### 3.2 CEL Evaluator (`cel/evaluator.ts`)

#### 3.2.1 Class: `CelEvaluator`

**Purpose**: Production-grade CEL expression evaluation with caching and Cerbos-compatible context.

**Constructor Options**:
```typescript
interface CelEvaluatorOptions {
  maxCacheSize?: number;   // Default: 1000
  cacheTtlMs?: number;     // Default: 3600000 (1 hour)
}
```

**Key Methods**:

| Method | Signature | Description |
|--------|-----------|-------------|
| `evaluate` | `(expr: string, ctx: EvaluationContext) => EvaluationResult` | Evaluate expression, return value or error |
| `evaluateBoolean` | `(expr: string, ctx: EvaluationContext) => boolean` | Evaluate expecting boolean, fail-closed |
| `validateExpression` | `(expr: string) => ValidationResult` | Check syntax without evaluation |
| `compileExpression` | `(expr: string) => void` | Pre-compile for cache |
| `getCacheStats` | `() => CacheStats` | Cache performance metrics |

#### 3.2.2 Evaluation Context

The evaluator builds a Cerbos-compatible context:

```typescript
interface EvaluationContext {
  principal: Principal;
  resource: Resource;
  auxData?: Record<string, unknown>;
  now?: Date;
}

// Becomes available in CEL as:
{
  request: { principal, resource, auxData },
  principal: { id, roles, ...attributes },
  resource: { kind, id, ...attributes },
  variables: auxData,
  now: Date,
  nowTimestamp: number
}
```

#### 3.2.3 Custom Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `timestamp` | `(value) => Date` | Convert string/number to Date |
| `duration` | `(str) => number` | Parse duration (e.g., "5m") to ms |
| `size` | `(collection) => number` | Get length of array/string/object |
| `type` | `(value) => string` | Get type name |
| `startsWith` | `(str, prefix) => boolean` | String prefix check |
| `endsWith` | `(str, suffix) => boolean` | String suffix check |
| `contains` | `(str, substr) => boolean` | Substring check |
| `matches` | `(str, pattern) => boolean` | Regex match |
| `inIPRange` | `(ip, cidr) => boolean` | IP range check |

#### 3.2.4 Error Handling

```typescript
interface EvaluationResult {
  success: boolean;
  value?: unknown;
  error?: string;
  errorType?: 'parse' | 'evaluation' | 'type' | 'unknown';
}
```

**Fail-Closed Behavior**: `evaluateBoolean()` returns `false` on any error for security.

### 3.3 Decision Engine (`engine/decision-engine.ts`)

#### 3.3.1 Class: `DecisionEngine`

**Purpose**: Core authorization logic implementing deny-overrides combining algorithm.

**Key Methods**:

| Method | Signature | Description |
|--------|-----------|-------------|
| `loadResourcePolicies` | `(policies: ValidatedResourcePolicy[]) => void` | Load policies |
| `loadDerivedRolesPolicies` | `(policies: ValidatedDerivedRolesPolicy[]) => void` | Load derived roles |
| `clearPolicies` | `() => void` | Clear all policies |
| `check` | `(request: CheckRequest) => CheckResponse` | Evaluate request |
| `getStats` | `() => PolicyStats` | Get loaded policy counts |

#### 3.3.2 Evaluation Algorithm

```
1. Generate unique request ID if not provided
2. Compute derived roles:
   - For each DerivedRolesPolicy definition:
     - Check principal has required parent roles
     - Evaluate CEL condition
     - If true, add derived role to list
3. Get ResourcePolicies for resource.kind
4. For each action:
   a. For each policy, for each rule:
      - Check action matches (or "*")
      - Check roles match (if specified)
      - Check derivedRoles match (if specified)
      - Evaluate condition (if present)
   b. Apply deny-overrides:
      - DENY takes precedence, return immediately
      - Record ALLOW but continue checking
   c. Default: DENY if no rules match
5. Return CheckResponse with all results
```

#### 3.3.3 Internal State

```typescript
class DecisionEngine {
  private celEvaluator: CelEvaluator;
  private resourcePolicies: Map<string, ValidatedResourcePolicy[]>;
  private derivedRolesPolicies: ValidatedDerivedRolesPolicy[];
}
```

### 3.4 Policy Schema (`policy/schema.ts`)

**Purpose**: Zod-based schema validation for policy YAML/JSON.

**Validated Types**:
- `ValidatedResourcePolicy`
- `ValidatedDerivedRolesPolicy`
- `ValidatedPrincipalPolicy`

---

## 4. Interfaces

### 4.1 Public API

```typescript
// From index.ts
export {
  // Types
  Effect,
  Principal,
  Resource,
  PolicyMetadata,
  PolicyCondition,
  PolicyRule,
  ResourcePolicy,
  DerivedRolesPolicy,
  PrincipalPolicy,
  Policy,
  CheckRequest,
  CheckResponse,
  ActionResult,
  BatchCheckRequest,
  BatchCheckResponse,
  PlanResourcesRequest,
  PlanResourcesResponse,

  // CEL
  CelEvaluator,
  EvaluationContext,
  EvaluationResult,
  ValidationResult,
  CacheStats,
  celEvaluator,  // Default instance

  // Engine
  DecisionEngine,
  decisionEngine,  // Default instance

  // Schema
  ValidatedResourcePolicy,
  ValidatedDerivedRolesPolicy,
};
```

---

## 5. Data Models

### 5.1 Policy Schema (YAML)

```yaml
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: subscription-policy
  description: "Subscription access rules"
  version: "1.0"
spec:
  resource: subscription
  rules:
    - name: owner-full-access
      actions: ["*"]
      effect: allow
      roles: [owner]
    - name: admin-manage
      actions: [view, update]
      effect: allow
      roles: [admin]
    - name: user-view-own
      actions: [view]
      effect: allow
      roles: [user]
      condition:
        expression: "resource.ownerId == principal.id"
```

### 5.2 Derived Roles Schema

```yaml
apiVersion: authz.engine/v1
kind: DerivedRoles
metadata:
  name: ownership-roles
spec:
  definitions:
    - name: owner
      parentRoles: [user]
      condition:
        expression: "resource.ownerId == principal.id"
```

---

## 6. Error Handling

### 6.1 CEL Errors

| Error Type | Cause | Recovery |
|------------|-------|----------|
| `parse` | Invalid CEL syntax | Fix expression |
| `evaluation` | Runtime error (e.g., null access) | Check data |
| `type` | Type mismatch in function | Check types |
| `unknown` | Unexpected error | Log and investigate |

### 6.2 Engine Errors

| Scenario | Behavior |
|----------|----------|
| No policies for resource | Default DENY |
| CEL condition fails | Condition = false (fail-closed) |
| Invalid principal | DENY all actions |

---

## 7. Security Considerations

1. **Fail-Closed**: All errors result in DENY
2. **CEL Sandboxing**: cel-js runs in sandboxed environment
3. **No Eval**: CEL expressions cannot execute arbitrary code
4. **Input Validation**: All inputs validated via Zod schemas
5. **Cache Isolation**: Expression cache keyed by expression string

---

## 8. Performance

### 8.1 Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Single check latency | < 5ms p99 | Warm cache |
| Expression cache hit rate | > 90% | After warm-up |
| Memory per cached expr | ~1KB | Parsed CST |

### 8.2 Optimization Strategies

1. **Expression Caching**: Parsed CST cached with TTL
2. **Early Exit**: DENY rules short-circuit evaluation
3. **Map Lookup**: Policies indexed by resource.kind
4. **Lazy Evaluation**: Conditions only evaluated when roles match

---

## 9. Testing Strategy

### 9.1 Unit Tests

- `cel/evaluator.test.ts`: Expression parsing, evaluation, custom functions
- `engine/decision-engine.test.ts`: Policy loading, check logic, derived roles
- `policy/schema.test.ts`: Schema validation

### 9.2 Test Coverage

| Module | Target Coverage |
|--------|----------------|
| types | N/A (type definitions) |
| cel | 95% |
| engine | 95% |
| policy | 90% |

### 9.3 Test Cases

**CEL Evaluator**:
- Valid expressions return correct values
- Invalid syntax returns parse error
- Type mismatches handled gracefully
- Cache hit/miss tracking works
- Custom functions work correctly

**Decision Engine**:
- Basic allow/deny works
- Role matching works
- Derived roles computed correctly
- Conditions evaluated correctly
- Deny-overrides algorithm correct
- Default deny when no match

---

## 10. Dependencies

### 10.1 Runtime Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `cel-js` | ^0.3.0 | CEL expression parsing and evaluation |
| `zod` | ^3.22.0 | Runtime schema validation |

### 10.2 Development Dependencies

| Dependency | Purpose |
|------------|---------|
| `typescript` | Type checking |
| `vitest` | Testing |
| `tsup` | Bundling |

---

## 11. Related Documents

- [ADR-001: CEL Expression Language](../adr/ADR-001-CEL-EXPRESSION-LANGUAGE.md)
- [ADR-003: ActionResult Effect Type](../adr/ADR-003-ACTION-RESULT-EFFECT.md)
- [ADR-006: Cerbos API Compatibility](../adr/ADR-006-CERBOS-API-COMPATIBILITY.md)

---

## 12. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-11-23 | Initial release with CEL evaluator, decision engine |
