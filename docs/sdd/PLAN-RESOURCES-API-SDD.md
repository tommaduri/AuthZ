# Software Design Document: PlanResources API

**Version**: 1.0.0
**Package**: `@authz-engine/server`, `@authz-engine/core`
**Status**: Specification (Not Yet Implemented)
**Last Updated**: 2024-11-23

---

## 1. Overview

### 1.1 Purpose

The PlanResources API generates query plans that identify which resources a principal can access for specific actions. Instead of checking individual resources, it produces a filterable condition that can be applied to database queries.

### 1.2 Use Cases

1. **List Views**: "Show me all documents I can edit"
2. **Search Filters**: "Filter search results to items I can view"
3. **Bulk Operations**: "Select all resources I can delete"
4. **UI Optimization**: Pre-filter options before rendering

### 1.3 Cerbos Compatibility

This API implements Cerbos's `/api/plan/resources` endpoint with full wire compatibility.

---

## 2. Architecture

### 2.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         PlanResources Flow                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Request ───► Planner ───► Condition ───► AST ───► Response    │
│                   │           Analyzer       Builder              │
│                   │              │              │                 │
│                   ▼              ▼              ▼                 │
│             ┌─────────┐   ┌──────────┐   ┌─────────────┐        │
│             │ Policy  │   │ Variable │   │  Operator   │        │
│             │ Matcher │   │ Resolver │   │  Converter  │        │
│             └─────────┘   └──────────┘   └─────────────┘        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

```
1. Receive PlanResourcesRequest
        │
        ▼
2. Resolve derived roles for principal
        │
        ▼
3. Find matching policies for resource.kind
        │
        ▼
4. For each matching rule:
   - If unconditional ALLOW → KIND_ALWAYS_ALLOWED
   - If unconditional DENY → KIND_ALWAYS_DENIED
   - If conditional → Extract condition
        │
        ▼
5. Combine conditions using deny-overrides
        │
        ▼
6. Convert CEL to AST representation
        │
        ▼
7. Return PlanResourcesResponse
```

---

## 3. API Specification

### 3.1 Request Format

```typescript
interface PlanResourcesRequest {
  /** Application-provided request ID for tracing */
  requestId?: string;

  /** Action to plan for */
  action: string;

  /** Principal making the request */
  principal: {
    id: string;
    roles: string[];
    attr?: Record<string, unknown>;
    policyVersion?: string;
    scope?: string;
  };

  /** Resource type to plan for (no specific instance) */
  resource: {
    kind: string;
    attr?: Record<string, unknown>;
    policyVersion?: string;
    scope?: string;
  };

  /** Optional auxiliary data */
  auxData?: {
    jwt?: {
      token: string;
      keySetId?: string;
    };
  };

  /** Include metadata in response */
  includeMeta?: boolean;
}
```

### 3.2 Response Format

```typescript
interface PlanResourcesResponse {
  /** Echoed request ID */
  requestId: string;

  /** Action that was planned */
  action: string;

  /** Resource kind */
  resourceKind: string;

  /** Policy version used */
  policyVersion: string;

  /** The computed filter */
  filter: PlanResourcesFilter;

  /** Optional metadata */
  meta?: {
    /** Debug string of the filter */
    filterDebug?: string;
    /** Matched scope */
    matchedScope?: string;
  };

  /** Schema validation errors */
  validationErrors?: ValidationError[];

  /** Unique call ID for audit */
  cerbosCallId: string;
}

interface PlanResourcesFilter {
  /** Filter kind */
  kind: PlanResourcesFilterKind;

  /** Condition AST (only for CONDITIONAL) */
  condition?: PlanResourcesCondition;
}

type PlanResourcesFilterKind =
  | 'KIND_ALWAYS_ALLOWED'  // Unconditional access
  | 'KIND_ALWAYS_DENIED'   // Unconditional denial
  | 'KIND_CONDITIONAL';    // Access depends on condition

interface PlanResourcesCondition {
  expression: ConditionExpression;
}
```

### 3.3 Condition AST Format

```typescript
type ConditionExpression =
  | ConditionValue
  | ConditionVariable
  | ConditionOperator;

interface ConditionValue {
  value: unknown; // Literal value
}

interface ConditionVariable {
  variable: string; // e.g., "request.resource.attr.owner"
}

interface ConditionOperator {
  operator: OperatorType;
  operands: ConditionExpression[];
}

type OperatorType =
  // Comparison
  | 'eq'      // ==
  | 'ne'      // !=
  | 'lt'      // <
  | 'le'      // <=
  | 'gt'      // >
  | 'ge'      // >=
  // Logical
  | 'and'     // &&
  | 'or'      // ||
  | 'not'     // !
  // Arithmetic
  | 'add'     // +
  | 'sub'     // -
  | 'mult'    // *
  | 'div'     // /
  | 'mod'     // %
  // Collection
  | 'in'      // in
  | 'index'   // []
  | 'list'    // [...]
  // Function
  | 'lambda'; // Comprehension
```

---

## 4. Component Design

### 4.1 ResourcePlanner Class

```typescript
interface ResourcePlannerConfig {
  decisionEngine: DecisionEngine;
  celEvaluator: CelEvaluator;
}

class ResourcePlanner {
  constructor(config: ResourcePlannerConfig);

  /**
   * Generate a query plan for resource access
   */
  plan(request: PlanResourcesRequest): PlanResourcesResponse;

  /**
   * Convert CEL expression to AST
   */
  private celToAst(expression: string): ConditionExpression;

  /**
   * Simplify condition AST
   */
  private simplifyAst(ast: ConditionExpression): ConditionExpression;

  /**
   * Combine multiple conditions with deny-overrides
   */
  private combineConditions(
    conditions: ConditionExpression[],
    denyConditions: ConditionExpression[]
  ): PlanResourcesFilter;
}
```

### 4.2 CEL to AST Converter

```typescript
class CelAstConverter {
  /**
   * Parse CEL expression and convert to plan AST
   */
  convert(celExpression: string): ConditionExpression {
    // 1. Parse CEL to internal AST
    // 2. Walk AST and convert operators
    // 3. Resolve variable references
    // 4. Return plan-compatible AST
  }

  /**
   * Map CEL operators to AST operators
   */
  private mapOperator(celOp: string): OperatorType {
    const mapping: Record<string, OperatorType> = {
      '_==_': 'eq',
      '_!=_': 'ne',
      '_<_': 'lt',
      '_<=_': 'le',
      '_>_': 'gt',
      '_>=_': 'ge',
      '_&&_': 'and',
      '_||_': 'or',
      '!_': 'not',
      '_+_': 'add',
      '_-_': 'sub',
      '_*_': 'mult',
      '_/_': 'div',
      '_%_': 'mod',
      '@in': 'in',
      '_[_]': 'index',
    };
    return mapping[celOp] ?? 'lambda';
  }

  /**
   * Resolve variable paths to canonical form
   */
  private resolveVariable(path: string): string {
    // request.resource.attr.x → request.resource.attr.x
    // R.attr.x → request.resource.attr.x
    // P.id → request.principal.id
    const aliases: Record<string, string> = {
      'R.': 'request.resource.',
      'P.': 'request.principal.',
      'V.': 'variables.',
    };
    for (const [alias, full] of Object.entries(aliases)) {
      if (path.startsWith(alias)) {
        return path.replace(alias, full);
      }
    }
    return path;
  }
}
```

### 4.3 Filter Kind Determination

```typescript
function determineFilterKind(
  allowRules: PolicyRule[],
  denyRules: PolicyRule[],
  effectiveDerivedRoles: string[]
): { kind: PlanResourcesFilterKind; condition?: ConditionExpression } {
  // 1. If any unconditional DENY matches → ALWAYS_DENIED
  for (const rule of denyRules) {
    if (!rule.condition && rolesMatch(rule, effectiveDerivedRoles)) {
      return { kind: 'KIND_ALWAYS_DENIED' };
    }
  }

  // 2. If any unconditional ALLOW matches → ALWAYS_ALLOWED
  for (const rule of allowRules) {
    if (!rule.condition && rolesMatch(rule, effectiveDerivedRoles)) {
      return { kind: 'KIND_ALWAYS_ALLOWED' };
    }
  }

  // 3. If no rules match → ALWAYS_DENIED
  const matchingAllowRules = allowRules.filter(r => rolesMatch(r, effectiveDerivedRoles));
  const matchingDenyRules = denyRules.filter(r => rolesMatch(r, effectiveDerivedRoles));

  if (matchingAllowRules.length === 0 && matchingDenyRules.length === 0) {
    return { kind: 'KIND_ALWAYS_DENIED' };
  }

  // 4. Otherwise → CONDITIONAL with combined AST
  const allowConditions = matchingAllowRules
    .filter(r => r.condition)
    .map(r => celToAst(r.condition!.expression));

  const denyConditions = matchingDenyRules
    .filter(r => r.condition)
    .map(r => celToAst(r.condition!.expression));

  // Combine: (allow1 || allow2) && !(deny1 || deny2)
  const condition = combineWithDenyOverrides(allowConditions, denyConditions);

  return { kind: 'KIND_CONDITIONAL', condition };
}
```

---

## 5. Response Examples

### 5.1 Always Allowed

```json
{
  "requestId": "req-123",
  "action": "view",
  "resourceKind": "document",
  "policyVersion": "default",
  "filter": {
    "kind": "KIND_ALWAYS_ALLOWED"
  },
  "cerbosCallId": "01HXXXXXX"
}
```

### 5.2 Always Denied

```json
{
  "requestId": "req-456",
  "action": "delete",
  "resourceKind": "document",
  "policyVersion": "default",
  "filter": {
    "kind": "KIND_ALWAYS_DENIED"
  },
  "cerbosCallId": "01HYYYYYY"
}
```

### 5.3 Conditional Access

```json
{
  "requestId": "req-789",
  "action": "edit",
  "resourceKind": "document",
  "policyVersion": "default",
  "filter": {
    "kind": "KIND_CONDITIONAL",
    "condition": {
      "expression": {
        "operator": "or",
        "operands": [
          {
            "operator": "eq",
            "operands": [
              { "variable": "request.resource.attr.owner" },
              { "value": "user-123" }
            ]
          },
          {
            "operator": "in",
            "operands": [
              { "value": "user-123" },
              { "variable": "request.resource.attr.collaborators" }
            ]
          }
        ]
      }
    }
  },
  "meta": {
    "filterDebug": "(request.resource.attr.owner == \"user-123\") || (\"user-123\" in request.resource.attr.collaborators)"
  },
  "cerbosCallId": "01HZZZZZZ"
}
```

---

## 6. SDK Integration

### 6.1 Client Method

```typescript
class AuthzClient {
  /**
   * Plan which resources a principal can access
   */
  async planResources(
    principal: Principal,
    resourceKind: string,
    action: string,
    options?: PlanOptions
  ): Promise<PlanResourcesResult> {
    const request: PlanResourcesRequest = {
      principal,
      resource: { kind: resourceKind, attr: options?.resourceAttr },
      action,
      includeMeta: options?.includeMeta,
    };

    const response = await this.sendRequest<PlanResourcesResponse>(
      '/api/plan/resources',
      request
    );

    return {
      kind: response.filter.kind,
      condition: response.filter.condition,
      toSQL: () => this.conditionToSQL(response.filter.condition),
      toMongo: () => this.conditionToMongo(response.filter.condition),
      toPrisma: () => this.conditionToPrisma(response.filter.condition),
    };
  }

  /**
   * Convert condition AST to SQL WHERE clause
   */
  private conditionToSQL(condition?: PlanResourcesCondition): string | null {
    if (!condition) return null;
    return this.astToSQL(condition.expression);
  }
}
```

### 6.2 Query Builder Helpers

```typescript
interface PlanResourcesResult {
  kind: PlanResourcesFilterKind;
  condition?: PlanResourcesCondition;

  /** Convert to SQL WHERE clause */
  toSQL(): string | null;

  /** Convert to MongoDB query */
  toMongo(): object | null;

  /** Convert to Prisma where clause */
  toPrisma(): object | null;
}

// Usage example
const plan = await client.planResources(
  { id: 'user-123', roles: ['user'], attributes: {} },
  'document',
  'edit'
);

if (plan.kind === 'KIND_ALWAYS_DENIED') {
  return []; // No documents accessible
}

if (plan.kind === 'KIND_ALWAYS_ALLOWED') {
  return db.documents.findMany(); // All documents accessible
}

// Conditional - apply filter
const sqlWhere = plan.toSQL();
return db.query(`SELECT * FROM documents WHERE ${sqlWhere}`);
```

---

## 7. NestJS Integration

### 7.1 Decorator for Plan-Based Queries

```typescript
@Injectable()
export class DocumentService {
  constructor(private authzClient: AuthzClient) {}

  @PlanResources({ resource: 'document', action: 'view' })
  async findAccessible(@AuthzPlan() plan: PlanResourcesResult) {
    if (plan.kind === 'KIND_ALWAYS_DENIED') {
      return [];
    }

    if (plan.kind === 'KIND_ALWAYS_ALLOWED') {
      return this.documentRepo.find();
    }

    const where = plan.toPrisma();
    return this.documentRepo.find({ where });
  }
}
```

---

## 8. Error Handling

### 8.1 Error Cases

| Scenario | Response |
|----------|----------|
| Invalid resource kind | `KIND_ALWAYS_DENIED` |
| No policies found | `KIND_ALWAYS_DENIED` |
| CEL parse error | Error response with details |
| Schema validation failure | Include `validationErrors` |

### 8.2 Error Response

```typescript
interface PlanResourcesError {
  code: 'INVALID_REQUEST' | 'POLICY_ERROR' | 'INTERNAL_ERROR';
  message: string;
  details?: unknown;
}
```

---

## 9. Performance Considerations

### 9.1 Targets

| Metric | Target |
|--------|--------|
| Plan generation | < 10ms p99 |
| AST complexity | < 100 nodes |
| Cache hit rate | > 80% |

### 9.2 Caching Strategy

```typescript
interface PlanCache {
  /** Cache key: hash of (principal.roles, resource.kind, action, policyVersion) */
  key: string;

  /** Cached filter (principal-independent parts) */
  templateFilter: PlanResourcesFilter;

  /** Variables that need runtime substitution */
  runtimeVariables: string[];

  /** TTL in milliseconds */
  ttl: number;
}
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

- Filter kind determination
- CEL to AST conversion
- AST simplification
- Condition combination

### 10.2 Integration Tests

- Full request/response flow
- Cerbos response comparison
- Query builder output

### 10.3 Test Cases

```typescript
describe('PlanResources', () => {
  it('returns ALWAYS_ALLOWED for admin', async () => {
    const result = await planner.plan({
      principal: { id: 'admin', roles: ['admin'], attr: {} },
      resource: { kind: 'document' },
      action: 'delete',
    });
    expect(result.filter.kind).toBe('KIND_ALWAYS_ALLOWED');
  });

  it('returns CONDITIONAL for owner check', async () => {
    const result = await planner.plan({
      principal: { id: 'user-1', roles: ['user'], attr: {} },
      resource: { kind: 'document' },
      action: 'edit',
    });
    expect(result.filter.kind).toBe('KIND_CONDITIONAL');
    expect(result.filter.condition).toBeDefined();
  });

  it('converts condition to valid SQL', async () => {
    const result = await planner.plan({...});
    const sql = result.toSQL();
    expect(sql).toBe('(owner = $1 OR $1 = ANY(collaborators))');
  });
});
```

---

## 11. Related Documents

- [CERBOS-FEATURE-PARITY-SDD.md](./CERBOS-FEATURE-PARITY-SDD.md)
- [SERVER-PACKAGE-SDD.md](./SERVER-PACKAGE-SDD.md)
- [SDK-PACKAGE-SDD.md](./SDK-PACKAGE-SDD.md)

---

## 12. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-11-23 | Initial specification |
