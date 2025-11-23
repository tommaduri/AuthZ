# Derived Roles - Software Design Document

**Module**: `@authz-engine/core`
**Version**: 1.0.0
**Status**: Specification
**Author**: AuthZ Engine Team
**Created**: 2024-11-23
**Last Updated**: 2024-11-23
**Reviewers**: TBD

---

## 1. Overview

### 1.1 Purpose

Derived roles are dynamic roles computed at evaluation time based on context (principal attributes, resource attributes, auxiliary data). They enable relationship-based access control (ReBAC) patterns without requiring static role assignments.

This feature is critical for:
- **Ownership-based access**: User owns the resource
- **Relationship-based access**: User is a collaborator, manager, or team member
- **Contextual access**: User belongs to same department, organization, or project
- **Dynamic permissions**: Roles that depend on runtime conditions

### 1.2 Scope

**In Scope:**
- Derived role schema and validation
- Derived role computation pipeline
- Integration with decision engine
- Caching and memoization strategies
- Circular dependency detection
- Variables support in derived role conditions
- ReBAC pattern support

**Out of Scope:**
- External relationship graph databases (covered in separate SDD)
- Real-time relationship updates (event-driven)
- Hierarchical role inheritance (separate feature)

### 1.3 Context

Derived roles bridge the gap between static RBAC and dynamic ABAC/ReBAC:

```
                         Authorization Request
                               |
                               v
+------------------------------------------------------------------+
|                       Decision Engine                             |
|                                                                   |
|  +------------------+     +----------------------+                |
|  | Base Roles       |     | Derived Roles Engine |                |
|  | [user, admin]    |---->| Evaluate conditions  |                |
|  +------------------+     | against context      |                |
|                           +----------+-----------+                |
|                                      |                            |
|                                      v                            |
|                           +----------------------+                |
|                           | Effective Roles      |                |
|                           | Base + Derived       |                |
|                           | [user, owner,        |                |
|                           |  collaborator]       |                |
|                           +----------+-----------+                |
|                                      |                            |
|                                      v                            |
|                           +----------------------+                |
|                           | Policy Evaluation    |                |
|                           | Match rules against  |                |
|                           | effective roles      |                |
|                           +----------------------+                |
+------------------------------------------------------------------+
```

### 1.4 Key Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Eager evaluation per request | Simpler implementation, predictable performance | Lazy evaluation on rule match |
| Cache resolved roles per request | Avoid redundant computation for multiple actions | No caching, global cache |
| Topological sort for dependencies | Detect cycles, ensure correct evaluation order | Runtime cycle detection |
| Variables support | Reusable expressions, DRY principle | Inline expressions only |

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-DR-001 | Parse and validate DerivedRoles YAML/JSON | Must Have | Pending |
| FR-DR-002 | Evaluate derived role conditions with CEL | Must Have | Pending |
| FR-DR-003 | Support parent role prerequisites | Must Have | Pending |
| FR-DR-004 | Import derived roles into resource policies | Must Have | Pending |
| FR-DR-005 | Detect circular dependencies at load time | Must Have | Pending |
| FR-DR-006 | Support variables in derived role conditions | Should Have | Pending |
| FR-DR-007 | Provide evaluation trace for debugging | Should Have | Pending |
| FR-DR-008 | Cache computed roles per request | Should Have | Pending |
| FR-DR-009 | Support multiple derived role definitions | Must Have | Pending |
| FR-DR-010 | Integrate with resource and principal policies | Must Have | Pending |

### 2.2 Non-Functional Requirements

| ID | Category | Requirement | Target |
|----|----------|-------------|--------|
| NFR-DR-001 | Performance | Derived role computation | < 2ms per request |
| NFR-DR-002 | Performance | Condition evaluation | < 0.5ms per condition |
| NFR-DR-003 | Scalability | Max derived role definitions | > 100 per policy |
| NFR-DR-004 | Reliability | Cycle detection accuracy | 100% |
| NFR-DR-005 | Security | Fail-closed on errors | 100% |

---

## 3. Architecture

### 3.1 Component Diagram

```
+-------------------------------------------------------------------------+
|                      Derived Roles System                                |
+-------------------------------------------------------------------------+
|                                                                          |
|  +------------------+    +--------------------+    +------------------+  |
|  | Policy Loader    |--->| DerivedRoles       |--->| DerivedRoles     |  |
|  | (YAML/JSON)      |    | Validator          |    | Index            |  |
|  +------------------+    +--------------------+    +--------+---------+  |
|                                                             |            |
|                                                             v            |
|  +------------------+    +--------------------+    +------------------+  |
|  | Check Request    |--->| DerivedRoles       |--->| DerivedRoles     |  |
|  |                  |    | Resolver           |    | Evaluator        |  |
|  +------------------+    +--------------------+    +--------+---------+  |
|                                                             |            |
|                                                             v            |
|                                                    +------------------+  |
|                                                    | CEL Evaluator    |  |
|                                                    | (Conditions)     |  |
|                                                    +------------------+  |
|                                                                          |
+-------------------------------------------------------------------------+
```

### 3.2 Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| Policy Loader | Load derived roles definitions from storage |
| DerivedRoles Validator | Validate schema, detect cycles, compile conditions |
| DerivedRoles Index | Efficient lookup by name for imports |
| DerivedRoles Resolver | Resolve all derived roles for a request |
| DerivedRoles Evaluator | Evaluate individual derived role conditions |
| CEL Evaluator | Execute CEL expressions for conditions |

### 3.3 Derived Role Computation Pipeline

```
1. Policy Import Phase
   ─────────────────────
   ResourcePolicy.spec.importDerivedRoles: ["document_roles"]
                              │
                              v
                    ┌─────────────────────┐
                    │ Load DerivedRoles   │
                    │ by name             │
                    └──────────┬──────────┘
                              │
                              v
                    ┌─────────────────────┐
                    │ Topological Sort    │
                    │ (dependency order)  │
                    └──────────┬──────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ Validate No Cycles  │
                    └─────────────────────┘

2. Request Evaluation Phase
   ─────────────────────────
   CheckRequest
        │
        v
   ┌─────────────────────────────────────────────┐
   │ For each derived role definition (sorted):  │
   │                                             │
   │  1. Check parent roles match principal      │
   │     └─▶ Skip if no parent role match        │
   │                                             │
   │  2. Build evaluation context                │
   │     └─▶ {P, R, V, request, now}             │
   │                                             │
   │  3. Evaluate condition via CEL              │
   │     └─▶ true: Grant derived role            │
   │     └─▶ false: Skip this derived role       │
   │     └─▶ error: Log and skip (fail-safe)     │
   │                                             │
   │  4. Add granted role to effective roles     │
   └──────────────────────┬──────────────────────┘
                          │
                          v
   ┌─────────────────────────────────────────────┐
   │ DerivedRoleResolutionResult                 │
   │ {                                           │
   │   effectiveRoles: [base + derived],         │
   │   derivedRoles: [computed roles],           │
   │   baseRoles: [original roles],              │
   │   evaluationTrace: [...]                    │
   │ }                                           │
   └─────────────────────────────────────────────┘
```

### 3.4 Circular Dependency Detection

Derived roles can reference other derived roles. The system must detect cycles:

```typescript
// Example cycle:
// role_a requires role_b
// role_b requires role_c
// role_c requires role_a  <-- CYCLE!

function detectCycles(definitions: DerivedRoleDefinition[]): string[] | null {
  const graph = buildDependencyGraph(definitions);
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const cycles: string[] = [];

  for (const role of definitions) {
    if (hasCycle(role.name, graph, visited, recursionStack, cycles)) {
      return cycles;
    }
  }

  return null; // No cycles found
}
```

---

## 4. Component Design

### 4.1 Derived Roles Schema

```yaml
apiVersion: authz.engine/v1
kind: DerivedRoles
metadata:
  name: document-roles
spec:
  name: document_roles
  definitions:
    # Owner role - user owns the document
    - name: owner
      parentRoles: [user]
      condition:
        match:
          expr: request.resource.attr.owner == request.principal.id

    # Collaborator role - user is in collaborators list
    - name: collaborator
      parentRoles: [user]
      condition:
        match:
          expr: request.principal.id in request.resource.attr.collaborators

    # Department member - same department
    - name: department_member
      parentRoles: [user]
      condition:
        match:
          expr: >
            request.principal.attr.department == request.resource.attr.department

    # Manager - manages the owner
    - name: manager
      parentRoles: [user]
      condition:
        match:
          expr: >
            request.principal.id in request.resource.attr.ownerManagers
```

### 4.2 Usage in Resource Policies

```yaml
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
spec:
  resource: document
  version: "1.0"
  importDerivedRoles:
    - document_roles
  rules:
    - actions: [edit, delete]
      effect: ALLOW
      derivedRoles: [owner]

    - actions: [view, comment]
      effect: ALLOW
      derivedRoles: [owner, collaborator, department_member]

    - actions: [approve]
      effect: ALLOW
      derivedRoles: [manager]

    - actions: [view]
      effect: ALLOW
      roles: ["*"]
      condition:
        match:
          expr: R.attr.visibility == "public"
```

### 4.3 Variables in Derived Roles

```yaml
apiVersion: authz.engine/v1
kind: DerivedRoles
metadata:
  name: contextual-roles
spec:
  name: contextual_roles
  variables:
    local:
      is_business_hours: >
        now().getHours() >= 9 && now().getHours() < 17
      is_owner_department: >
        P.attr.department == R.attr.department
      is_senior: >
        P.attr.level >= 5
  definitions:
    - name: business_hours_editor
      parentRoles: [editor]
      condition:
        match:
          expr: V.is_business_hours && V.is_owner_department

    - name: senior_reviewer
      parentRoles: [reviewer]
      condition:
        match:
          expr: V.is_senior && V.is_owner_department

    - name: emergency_admin
      parentRoles: [admin]
      condition:
        match:
          all:
            of:
              - expr: "!V.is_business_hours"
              - expr: request.auxData.emergency == true
```

### 4.4 Derived Role Evaluation Logic

```typescript
async function resolveDerivedRoles(
  request: CheckRequest,
  derivedRolesDefs: DerivedRoleDefinition[],
  variables?: PolicyVariables
): Promise<DerivedRoleResolutionResult> {
  const baseRoles = new Set(request.principal.roles);
  const derivedRoles = new Set<string>();
  const evaluationTrace: DerivedRoleEvaluation[] = [];

  // Resolve variables first
  const resolvedVariables = await resolveVariables(variables, request);

  // Build evaluation context
  const context = buildEvaluationContext(request, resolvedVariables);

  // Evaluate each derived role definition
  for (const definition of derivedRolesDefs) {
    const trace: DerivedRoleEvaluation = {
      roleName: definition.name,
      matched: false,
      condition: definition.condition?.match?.expr || 'none',
      parentRolesMatched: false,
    };

    // Check parent roles
    const hasParentRole = definition.parentRoles.some(
      parent => baseRoles.has(parent) || parent === '*'
    );

    if (!hasParentRole) {
      trace.parentRolesMatched = false;
      evaluationTrace.push(trace);
      continue;
    }

    trace.parentRolesMatched = true;

    // Evaluate condition
    if (!definition.condition) {
      // No condition means automatic grant if parent roles match
      derivedRoles.add(definition.name);
      trace.matched = true;
    } else {
      try {
        const result = await celEvaluator.evaluate(
          definition.condition.match.expr,
          context
        );

        if (result.success && result.value === true) {
          derivedRoles.add(definition.name);
          trace.matched = true;
        }
      } catch (error) {
        // Fail-safe: log error but don't grant role
        logger.warn('Derived role condition evaluation failed', {
          role: definition.name,
          error: error.message,
        });
      }
    }

    evaluationTrace.push(trace);
  }

  return {
    effectiveRoles: [...baseRoles, ...derivedRoles],
    derivedRoles: [...derivedRoles],
    baseRoles: [...baseRoles],
    evaluationTrace,
  };
}
```

---

## 5. Interfaces

### 5.1 Type Definitions

```typescript
/**
 * DerivedRoles policy - defines dynamic roles computed at evaluation time
 */
interface DerivedRoles {
  /** API version identifier */
  apiVersion: 'authz.engine/v1';

  /** Policy kind discriminator */
  kind: 'DerivedRoles';

  /** Policy metadata */
  metadata: {
    /** Unique policy name */
    name: string;
  };

  /** Policy specification */
  spec: DerivedRolesSpec;
}

interface DerivedRolesSpec {
  /** Name for importing into resource policies */
  name: string;

  /** Derived role definitions */
  definitions: DerivedRoleDefinition[];

  /** Optional variables for use in conditions */
  variables?: Variables;
}

/**
 * Single derived role definition
 */
interface DerivedRoleDefinition {
  /** Name of the derived role */
  name: string;

  /** Parent roles required (at least one must match) */
  parentRoles: string[];

  /** Condition that must be true to grant this role */
  condition?: Condition;
}

/**
 * Condition specification supporting nested operators
 */
interface Condition {
  match: ConditionMatch;
}

type ConditionMatch =
  | { expr: string }
  | { all: { of: ConditionMatch[] } }
  | { any: { of: ConditionMatch[] } }
  | { none: { of: ConditionMatch[] } };

/**
 * Variables for reusable expressions
 */
interface Variables {
  /** Import exported variable sets */
  import?: string[];

  /** Local variable definitions (name -> CEL expression) */
  local?: Record<string, string>;
}

/**
 * Result from derived role resolution
 */
interface DerivedRoleResolutionResult {
  /** All roles (base + derived) */
  effectiveRoles: string[];

  /** Only the computed derived roles */
  derivedRoles: string[];

  /** Original base roles */
  baseRoles: string[];

  /** Optional evaluation trace for debugging */
  evaluationTrace?: DerivedRoleEvaluation[];
}

/**
 * Evaluation trace for a single derived role
 */
interface DerivedRoleEvaluation {
  /** Name of the derived role */
  roleName: string;

  /** Whether the role was granted */
  matched: boolean;

  /** The condition expression (or 'none') */
  condition: string;

  /** Whether parent roles requirement was satisfied */
  parentRolesMatched: boolean;

  /** Error message if evaluation failed */
  error?: string;
}
```

### 5.2 Public API

```typescript
/**
 * Derived Roles Service - manages derived role computation
 */
interface DerivedRolesService {
  /**
   * Load and validate a derived roles policy
   * @param policy - Raw policy object or YAML string
   * @returns Validated DerivedRoles policy
   * @throws PolicyValidationError if policy is invalid
   * @throws CircularDependencyError if cycles detected
   */
  loadPolicy(policy: unknown | string): DerivedRoles;

  /**
   * Get derived roles definitions by name
   * @param name - The spec.name of the derived roles policy
   * @returns Array of definitions or empty array if not found
   */
  getDefinitions(name: string): DerivedRoleDefinition[];

  /**
   * Resolve all derived roles for a request
   * @param request - Authorization check request
   * @param imports - Names of derived roles policies to import
   * @returns Resolution result with effective roles
   */
  resolve(
    request: CheckRequest,
    imports: string[]
  ): Promise<DerivedRoleResolutionResult>;

  /**
   * Validate derived roles for circular dependencies
   * @param definitions - Role definitions to check
   * @returns null if valid, or array of cycle descriptions
   */
  detectCycles(definitions: DerivedRoleDefinition[]): string[] | null;
}
```

### 5.3 Integration with Decision Engine

```typescript
/**
 * Extended DecisionEngine interface with derived roles support
 */
interface DecisionEngine {
  /**
   * Check authorization with derived role computation
   */
  check(request: CheckRequest): Promise<CheckResponse>;

  /**
   * Register a derived roles policy
   */
  addDerivedRoles(policy: DerivedRoles): void;

  /**
   * Remove a derived roles policy by name
   */
  removeDerivedRoles(name: string): void;

  /**
   * Get derived roles definitions by import name
   */
  getDerivedRoles(importName: string): DerivedRoleDefinition[];
}
```

---

## 6. Data Models

### 6.1 Policy Storage Schema

```typescript
// Internal storage representation
interface StoredDerivedRoles {
  id: string;                          // Generated unique ID
  name: string;                        // metadata.name
  specName: string;                    // spec.name (for imports)
  definitions: CompiledDerivedRole[];
  variables: CompiledVariables;
  rawPolicy: DerivedRoles;             // Original policy
  dependencyOrder: string[];           // Topologically sorted
  createdAt: Date;
  updatedAt: Date;
}

interface CompiledDerivedRole {
  name: string;
  parentRoles: string[];
  parentRolesSet: Set<string>;         // For O(1) lookup
  condition?: CompiledCondition;
}

interface CompiledCondition {
  expression: string;
  compiled: CompiledCelExpression;     // Pre-compiled CEL
}

interface CompiledVariables {
  local: Map<string, CompiledCelExpression>;
  imported: Map<string, CompiledVariables>;
}
```

### 6.2 Index Structure

```typescript
// Derived roles index for efficient lookup
interface DerivedRolesIndex {
  // Name -> StoredDerivedRoles mapping
  byName: Map<string, StoredDerivedRoles>;

  // spec.name -> StoredDerivedRoles mapping (for imports)
  bySpecName: Map<string, StoredDerivedRoles>;

  // Role name -> definitions that produce it
  byRoleName: Map<string, DerivedRoleDefinition[]>;
}
```

---

## 7. Relationship-Based Access Control (ReBAC)

### 7.1 User-Resource Relationships

```yaml
# User owns the resource
- name: owner
  parentRoles: [user]
  condition:
    match:
      expr: R.attr.ownerId == P.id

# User is in the resource's allowed list
- name: viewer
  parentRoles: [user]
  condition:
    match:
      expr: P.id in R.attr.viewers

# User is in the resource's editor list
- name: editor
  parentRoles: [user]
  condition:
    match:
      expr: P.id in R.attr.editors
```

### 7.2 User-User Relationships (Manager/Report)

```yaml
# User manages the resource owner
- name: manager_of_owner
  parentRoles: [manager]
  condition:
    match:
      expr: R.attr.ownerId in P.attr.directReports

# User is managed by the resource owner
- name: report_of_owner
  parentRoles: [user]
  condition:
    match:
      expr: P.attr.managerId == R.attr.ownerId
```

### 7.3 Resource-Resource Relationships (Parent/Child)

```yaml
# User can access child if they have parent access
- name: parent_accessor
  parentRoles: [user]
  condition:
    match:
      expr: >
        R.attr.parentId in P.attr.accessibleResources

# User is admin of the parent organization
- name: org_admin
  parentRoles: [admin]
  condition:
    match:
      expr: >
        R.attr.organizationId == P.attr.adminOrganizationId
```

### 7.4 External Relationship Data Sources

Relationships can be loaded from auxiliary data:

```yaml
# Check relationship service response
- name: team_member
  parentRoles: [user]
  condition:
    match:
      expr: >
        request.auxData.relationships.teams.exists(
          t, t.id == R.attr.teamId && t.role in ["member", "lead"]
        )

# Check graph database response
- name: connected_user
  parentRoles: [user]
  condition:
    match:
      expr: >
        R.attr.ownerId in request.auxData.socialGraph.connections
```

---

## 8. Error Handling

### 8.1 Error Types

| Error Code | Name | Description | Recovery |
|------------|------|-------------|----------|
| DR_001 | InvalidSchema | DerivedRoles schema validation failed | Fix policy YAML/JSON |
| DR_002 | CircularDependency | Cycle detected in role definitions | Remove circular references |
| DR_003 | ConditionError | CEL condition evaluation failed | Fix CEL expression |
| DR_004 | ImportNotFound | Referenced derived roles not found | Add missing import |
| DR_005 | DuplicateRoleName | Multiple definitions for same role name | Use unique names |
| DR_006 | InvalidParentRole | Parent role pattern is malformed | Fix parent role |

### 8.2 Error Hierarchy

```typescript
class DerivedRolesError extends AuthzError {
  constructor(
    message: string,
    public code: string,
    public policyName?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'DerivedRolesError';
  }
}

class CircularDependencyError extends DerivedRolesError {
  constructor(
    public cycles: string[],
    policyName?: string
  ) {
    super(
      `Circular dependency detected: ${cycles.join(' -> ')}`,
      'DR_002',
      policyName
    );
    this.name = 'CircularDependencyError';
  }
}

class DerivedRoleConditionError extends DerivedRolesError {
  constructor(
    message: string,
    public roleName: string,
    public expression: string,
    public cause?: Error
  ) {
    super(message, 'DR_003');
    this.name = 'DerivedRoleConditionError';
  }
}
```

---

## 9. Performance Considerations

### 9.1 Eager vs Lazy Evaluation

| Strategy | Pros | Cons | Recommendation |
|----------|------|------|----------------|
| **Eager** | Predictable latency, simple caching | May compute unused roles | Default for < 50 definitions |
| **Lazy** | Only compute needed roles | Complex, potential cache misses | For large role sets (> 50) |

**Implementation**: Default to eager evaluation with request-scoped caching.

### 9.2 Caching Strategy

```typescript
interface DerivedRolesCacheConfig {
  // Per-request cache (always enabled)
  requestCache: {
    enabled: true;
    // Automatically invalidated after request
  };

  // Definition cache (compiled conditions)
  definitionCache: {
    enabled: true;
    maxSize: 1000;         // Max compiled definitions
    ttlSeconds: 3600;      // 1 hour
  };

  // Variable resolution cache
  variableCache: {
    enabled: true;
    maxSize: 500;
    ttlSeconds: 300;       // 5 minutes
  };
}
```

### 9.3 Index-Based Parent Role Lookup

```typescript
// O(1) parent role matching using Set
function matchesParentRole(
  definition: CompiledDerivedRole,
  principalRoles: Set<string>
): boolean {
  // Check for wildcard
  if (definition.parentRolesSet.has('*')) {
    return true;
  }

  // Check intersection
  for (const role of principalRoles) {
    if (definition.parentRolesSet.has(role)) {
      return true;
    }
  }

  return false;
}
```

### 9.4 Latency Targets

| Operation | Target | Notes |
|-----------|--------|-------|
| Definition lookup | < 0.1ms | Hash-based index |
| Single condition evaluation | < 0.5ms | Pre-compiled CEL |
| Full resolution (10 roles) | < 2ms | Parallel evaluation |
| Full resolution (50 roles) | < 5ms | With caching |

---

## 10. Testing Strategy

### 10.1 Unit Tests

| Component | Coverage Target | Test File |
|-----------|-----------------|-----------|
| Schema Validation | 95% | `derived-roles.schema.test.ts` |
| Cycle Detection | 100% | `cycle-detection.test.ts` |
| Role Resolution | 95% | `derived-roles-resolver.test.ts` |
| Condition Evaluation | 90% | `condition-evaluator.test.ts` |

### 10.2 Integration Tests

| Scenario | Components Involved | Test File |
|----------|---------------------|-----------|
| Resource Policy + Derived Roles | DecisionEngine, Resolver | `combined-evaluation.test.ts` |
| ReBAC Patterns | All components | `rebac-patterns.test.ts` |
| Variable Resolution | Resolver, CEL | `variables.test.ts` |

### 10.3 Test Data (YAML Format)

```yaml
# derived_roles_test.yaml
name: Document Derived Roles Tests
derivedRoles:
  document_roles:
    definitions:
      - name: owner
        parentRoles: [user]
        condition:
          match:
            expr: R.attr.owner == P.id
      - name: collaborator
        parentRoles: [user]
        condition:
          match:
            expr: P.id in R.attr.collaborators

principals:
  owner_user:
    id: user-1
    roles: [user]
    attributes: {}
  collab_user:
    id: user-2
    roles: [user]
    attributes: {}
  other_user:
    id: user-3
    roles: [user]
    attributes: {}

resources:
  owned_doc:
    kind: document
    id: doc-1
    attributes:
      owner: user-1
      collaborators: [user-2]
  public_doc:
    kind: document
    id: doc-2
    attributes:
      owner: user-3
      collaborators: []

tests:
  - name: User gets owner derived role for owned document
    input:
      principal: owner_user
      resource: owned_doc
      action: view
    expectedDerivedRoles: [owner]
    expectedEffectiveRoles: [user, owner]

  - name: Collaborator gets collaborator derived role
    input:
      principal: collab_user
      resource: owned_doc
      action: view
    expectedDerivedRoles: [collaborator]
    expectedEffectiveRoles: [user, collaborator]

  - name: Other user gets no derived roles
    input:
      principal: other_user
      resource: owned_doc
      action: view
    expectedDerivedRoles: []
    expectedEffectiveRoles: [user]
```

### 10.4 Performance Tests

| Test | Target | Current |
|------|--------|---------|
| Resolution (10 definitions) | < 2ms | TBD |
| Resolution (50 definitions) | < 5ms | TBD |
| Concurrent resolutions (1000/sec) | < 3ms p99 | TBD |
| Cycle detection (100 roles) | < 10ms | TBD |

---

## 11. Security Considerations

### 11.1 Security Principles

| Principle | Implementation |
|-----------|----------------|
| Fail-closed | Condition errors result in role not granted |
| Least privilege | Derived roles only add permissions, never override denies |
| Defense in depth | CEL sandboxing + input validation + schema validation |
| Audit trail | All derived role computations logged |

### 11.2 Threat Mitigations

| Threat | Mitigation |
|--------|------------|
| Role escalation | Parent role requirement prevents arbitrary role grants |
| Condition injection | Strict schema validation, CEL sandboxing |
| DoS via complex conditions | CEL timeout, expression complexity limits |
| Information disclosure | Minimal error messages, no condition details in responses |

---

## 12. Dependencies

### 12.1 External Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `zod` | ^3.x | Schema validation |
| `yaml` | ^2.x | YAML parsing |
| `cel-js` | ^0.x | CEL expression evaluation |
| `lru-cache` | ^10.x | Definition and variable caching |

### 12.2 Internal Dependencies

| Package | Purpose |
|---------|---------|
| `@authz-engine/core/cel` | CEL evaluator integration |
| `@authz-engine/core/types` | Shared type definitions |
| `@authz-engine/core/engine` | Decision engine integration |

---

## 13. Use Cases

### 13.1 Document Collaboration

```yaml
# Derived roles for collaborative document editing
apiVersion: authz.engine/v1
kind: DerivedRoles
metadata:
  name: document-collaboration
spec:
  name: document_collab_roles
  definitions:
    - name: owner
      parentRoles: [user]
      condition:
        match:
          expr: R.attr.ownerId == P.id

    - name: editor
      parentRoles: [user]
      condition:
        match:
          expr: P.id in R.attr.editors

    - name: commenter
      parentRoles: [user]
      condition:
        match:
          expr: P.id in R.attr.commenters

    - name: viewer
      parentRoles: [user]
      condition:
        match:
          any:
            of:
              - expr: R.attr.visibility == "public"
              - expr: P.id in R.attr.viewers
              - expr: P.attr.organizationId == R.attr.organizationId
```

### 13.2 Hierarchical Organization Access

```yaml
# Derived roles for organizational hierarchy
apiVersion: authz.engine/v1
kind: DerivedRoles
metadata:
  name: org-hierarchy
spec:
  name: org_hierarchy_roles
  variables:
    local:
      same_org: P.attr.organizationId == R.attr.organizationId
      same_dept: P.attr.departmentId == R.attr.departmentId
  definitions:
    - name: org_member
      parentRoles: [user]
      condition:
        match:
          expr: V.same_org

    - name: dept_member
      parentRoles: [user]
      condition:
        match:
          all:
            of:
              - expr: V.same_org
              - expr: V.same_dept

    - name: dept_manager
      parentRoles: [manager]
      condition:
        match:
          all:
            of:
              - expr: V.same_org
              - expr: P.attr.managedDepartments.exists(d, d == R.attr.departmentId)
```

---

## 14. Related Documents

- [CORE-ARCHITECTURE-SDD.md](./CORE-ARCHITECTURE-SDD.md) - System architecture overview
- [CERBOS-FEATURE-PARITY-SDD.md](./CERBOS-FEATURE-PARITY-SDD.md) - Cerbos compatibility
- [CEL-EVALUATOR-SDD.md](./CEL-EVALUATOR-SDD.md) - CEL expression evaluation
- [TYPES-REFERENCE-SDD.md](./TYPES-REFERENCE-SDD.md) - Core type definitions
- [PRINCIPAL-POLICIES-SDD.md](./PRINCIPAL-POLICIES-SDD.md) - Principal policies

---

## 15. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-11-23 | Initial specification |

---

*This document specifies the Derived Roles feature for the AuthZ Engine, enabling relationship-based access control (ReBAC) patterns through dynamic role computation.*
