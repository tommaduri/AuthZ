# Exported Variables and Constants - Software Design Document

**Module**: `@authz-engine/core`
**Version**: 1.0.0
**Status**: Draft
**Author**: AuthZ Engine Team
**Created**: 2024-11-23
**Last Updated**: 2024-11-23
**Reviewers**: TBD

---

## 1. Overview

### 1.1 Purpose

Exported Variables and Constants provide a mechanism for sharing common CEL expressions and static values across multiple policies. This feature reduces duplication, ensures consistency, and simplifies policy maintenance by centralizing frequently used logic and values.

Key benefits:
- **DRY Principle**: Define once, use everywhere
- **Consistency**: Ensure identical logic across policies
- **Maintainability**: Update expressions in one place
- **Readability**: Use meaningful names instead of complex expressions
- **Performance**: Pre-compile and cache shared expressions

### 1.2 Scope

**In Scope:**
- ExportVariables resource definition and schema
- ExportConstants resource definition and schema
- Import resolution and variable binding
- Circular dependency detection
- Compilation and caching of expressions
- Scope and visibility rules
- Integration with ResourcePolicy and PrincipalPolicy

**Out of Scope:**
- Dynamic variable computation at runtime
- Variable inheritance across scopes (handled by Scoped Policies)
- External variable providers (future enhancement)
- Variable versioning (use policy versioning instead)

### 1.3 Context

Exported Variables and Constants integrate with the policy system by providing a centralized repository of reusable expressions. When policies import these exports, the resolution happens at policy load time, allowing for pre-compilation and optimization.

### 1.4 Key Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Load-time resolution | Enables pre-compilation and validation | Runtime resolution (slower) |
| Separate kinds for variables/constants | Clear distinction between expressions and values | Single unified export type |
| Named imports only | Explicit dependencies, no namespace pollution | Wildcard imports |
| Topological sort for dependencies | Deterministic resolution order | On-demand lazy resolution |

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-EV-001 | Define ExportVariables with CEL expressions | Must Have | Pending |
| FR-EV-002 | Define ExportConstants with static values | Must Have | Pending |
| FR-EV-003 | Import exports by name into policies | Must Have | Pending |
| FR-EV-004 | Detect circular dependencies at load time | Must Have | Pending |
| FR-EV-005 | Pre-compile imported expressions | Must Have | Pending |
| FR-EV-006 | Support local variables that override imports | Should Have | Pending |
| FR-EV-007 | Validate expression types at compile time | Should Have | Pending |
| FR-EV-008 | Cache compiled expressions for reuse | Should Have | Pending |

### 2.2 Non-Functional Requirements

| ID | Category | Requirement | Target |
|----|----------|-------------|--------|
| NFR-EV-001 | Performance | Variable resolution time | < 1ms |
| NFR-EV-002 | Performance | Compiled expression cache hit rate | > 99% |
| NFR-EV-003 | Scalability | Max exported definitions per file | 100 |
| NFR-EV-004 | Reliability | Fail-fast on circular dependencies | 100% |
| NFR-EV-005 | Security | No arbitrary code execution in expressions | 100% |

---

## 3. Architecture

### 3.1 Component Diagram

```
+---------------------------------------------------------------------------+
|                          @authz-engine/core                                |
+---------------------------------------------------------------------------+
|                                                                            |
|  +--------------------+     +------------------------+                     |
|  | ExportVariables    |     |   ExportConstants      |                     |
|  | (YAML/JSON)        |     |   (YAML/JSON)          |                     |
|  +--------+-----------+     +-----------+------------+                     |
|           |                             |                                  |
|           +-------------+---------------+                                  |
|                         |                                                  |
|                         v                                                  |
|  +--------------------+     +------------------------+                     |
|  | Export Loader      |---->|   Export Registry      |                     |
|  | - Parse exports    |     |   - Store by name      |                     |
|  | - Validate schema  |     |   - Dependency graph   |                     |
|  +--------------------+     +------------+-----------+                     |
|                                          |                                 |
|                                          v                                 |
|  +--------------------+     +------------------------+                     |
|  | ResourcePolicy     |---->| Variable Resolver      |                     |
|  | - imports: [name]  |     | - Resolve imports      |                     |
|  | - local: {...}     |     | - Merge with locals    |                     |
|  +--------------------+     | - Compile expressions  |                     |
|                             +------------+-----------+                     |
|                                          |                                 |
|                                          v                                 |
|                             +------------------------+                     |
|                             | Compiled Variables     |                     |
|                             | - CEL expressions      |                     |
|                             | - Constant values      |                     |
|                             +------------------------+                     |
|                                                                            |
+---------------------------------------------------------------------------+
```

### 3.2 Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| Export Loader | Parse ExportVariables/ExportConstants YAML files |
| Export Registry | Store exports by name, manage dependency graph |
| Variable Resolver | Resolve imports, merge with local variables |
| Expression Compiler | Pre-compile CEL expressions, cache results |
| Dependency Analyzer | Detect circular dependencies, topological sort |

### 3.3 Data Flow

```
1. Export Loading Phase
   ---------------------
   ExportVariables.yaml --> Loader --> Validator --> Registry
                                                        |
                                                        v
   ExportConstants.yaml --> Loader --> Validator --> Registry
                                                        |
                                                        v
                                              Build Dependency Graph

2. Policy Import Resolution
   -------------------------
   ResourcePolicy { variables.import: ["common"] }
                         |
                         v
   +-----------------------------------------+
   | Variable Resolver                       |
   |                                         |
   | 1. Look up "common" in Export Registry  |
   | 2. Get all definitions from "common"    |
   | 3. Check for circular dependencies      |
   | 4. Compile CEL expressions              |
   | 5. Merge with policy.variables.local    |
   | 6. Return resolved variable context     |
   +-----------------------------------------+
                         |
                         v
   CompiledVariableContext {
     is_owner: CompiledCEL,
     is_business_hours: CompiledCEL,
     max_file_size: 104857600,
     ...
   }

3. Policy Evaluation Phase
   ------------------------
   CheckRequest + CompiledVariableContext
                         |
                         v
   CEL Evaluation with variables.* namespace
```

### 3.4 Integration Points

| Integration | Protocol | Direction | Description |
|-------------|----------|-----------|-------------|
| PolicyLoader | Internal | In | Import exports during policy load |
| CelEvaluator | Internal | Out | Pass compiled variables for evaluation |
| DecisionEngine | Internal | Both | Access resolved variables during checks |
| FileWatcher | Internal | In | Reload exports on file changes |

---

## 4. Component Design

### 4.1 ExportVariables Schema

ExportVariables define reusable CEL expressions that are evaluated at runtime:

```yaml
apiVersion: authz.engine/v1
kind: ExportVariables
metadata:
  name: common-variables
spec:
  name: common
  definitions:
    # Time-based conditions
    is_business_hours: >
      now().getHours() >= 9 && now().getHours() < 17
    is_weekend: >
      now().getDayOfWeek() == 0 || now().getDayOfWeek() == 6

    # Ownership checks
    is_owner: >
      request.principal.id == request.resource.attr.owner
    is_creator: >
      request.principal.id == request.resource.attr.createdBy

    # Department checks
    same_department: >
      request.principal.attr.department == request.resource.attr.department

    # Geographic checks
    is_eu_user: >
      request.principal.attr.region in ["eu-west-1", "eu-central-1"]
```

### 4.2 ExportConstants Schema

ExportConstants define static values that are inlined at compile time:

```yaml
apiVersion: authz.engine/v1
kind: ExportConstants
metadata:
  name: common-constants
spec:
  name: constants
  definitions:
    # Numeric limits
    max_file_size: 104857600       # 100MB in bytes
    max_collaborators: 50

    # Status values
    draft_status: "draft"
    published_status: "published"
    archived_status: "archived"

    # Allowed regions
    eu_regions: ["eu-west-1", "eu-central-1", "eu-north-1"]
    us_regions: ["us-east-1", "us-west-2"]

    # Sensitive departments
    restricted_departments: ["finance", "hr", "legal"]
```

### 4.3 Importing in Policies

Policies import exports using the `variables.import` field:

```yaml
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
spec:
  resource: document
  variables:
    import:
      - common      # Import all variables from 'common'
    local:
      is_large_file: >
        request.resource.attr.size > constants.max_file_size
  rules:
    - actions: [edit]
      effect: allow
      roles: [user]
      condition:
        match:
          expr: variables.is_owner && variables.is_business_hours

    - actions: [view]
      effect: deny
      condition:
        match:
          all:
            of:
              - expr: variables.is_eu_user
              - expr: request.resource.attr.restricted == true
```

### 4.4 Resolution Order

Variables are resolved in the following precedence order (highest to lowest):

1. **Local variables** (defined in policy `variables.local`)
2. **Imported variables** (in declaration order)
3. **Built-in variables** (R, P, now(), request, etc.)

```typescript
function resolveVariables(
  policy: ResourcePolicy,
  registry: ExportRegistry
): ResolvedVariables {
  const resolved: ResolvedVariables = {};

  // 1. Start with built-in variables
  resolved['R'] = 'request.resource';
  resolved['P'] = 'request.principal';

  // 2. Add imported variables (in order)
  for (const importName of policy.spec.variables?.import ?? []) {
    const exportDef = registry.get(importName);
    if (!exportDef) {
      throw new UnknownExportError(importName, policy.metadata.name);
    }

    for (const [name, expr] of Object.entries(exportDef.definitions)) {
      resolved[name] = expr;
    }
  }

  // 3. Override with local variables
  for (const [name, expr] of Object.entries(policy.spec.variables?.local ?? {})) {
    resolved[name] = expr;
  }

  return resolved;
}
```

### 4.5 Circular Dependency Detection

The system detects circular dependencies at load time using topological sort:

```typescript
function detectCircularDependencies(
  exports: Map<string, ExportDefinition>
): void {
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function visit(name: string, path: string[]): void {
    if (inStack.has(name)) {
      throw new CircularDependencyError([...path, name]);
    }

    if (visited.has(name)) return;

    inStack.add(name);

    const exportDef = exports.get(name);
    if (exportDef) {
      for (const dep of extractDependencies(exportDef)) {
        visit(dep, [...path, name]);
      }
    }

    inStack.delete(name);
    visited.add(name);
  }

  for (const name of exports.keys()) {
    visit(name, []);
  }
}
```

---

## 5. Interfaces

### 5.1 Type Definitions

```typescript
/**
 * ExportVariables - defines reusable CEL expressions
 */
interface ExportVariables {
  apiVersion: 'authz.engine/v1';
  kind: 'ExportVariables';
  metadata: {
    /** Unique name for this export resource */
    name: string;
  };
  spec: {
    /** Export name used in imports */
    name: string;
    /** Variable name to CEL expression mapping */
    definitions: Record<string, string>;
  };
}

/**
 * ExportConstants - defines static constant values
 */
interface ExportConstants {
  apiVersion: 'authz.engine/v1';
  kind: 'ExportConstants';
  metadata: {
    /** Unique name for this export resource */
    name: string;
  };
  spec: {
    /** Export name used in imports */
    name: string;
    /** Constant name to value mapping */
    definitions: Record<string, unknown>;
  };
}

/**
 * Result of resolving an exported variable
 */
interface VariableResolution {
  /** Name of the export this variable came from */
  exportName: string;
  /** Name of the variable */
  variableName: string;
  /** Original CEL expression */
  expression: string;
  /** Pre-compiled CEL expression */
  compiledExpression: CompiledCEL;
  /** Other variables this expression depends on */
  dependencies: string[];
}

/**
 * Compiled variable context for policy evaluation
 */
interface CompiledVariableContext {
  /** Variables from exports and local definitions */
  variables: Map<string, CompiledCEL>;
  /** Constants from exports */
  constants: Map<string, unknown>;
  /** Resolution metadata for debugging */
  resolutionInfo: VariableResolutionInfo;
}

/**
 * Metadata about variable resolution
 */
interface VariableResolutionInfo {
  /** Exports that were imported */
  imports: string[];
  /** Local variables defined */
  localVariables: string[];
  /** Variables that were overridden by locals */
  overrides: string[];
  /** Total variables available */
  totalCount: number;
}

/**
 * Policy variables section
 */
interface PolicyVariables {
  /** Names of exports to import */
  import?: string[];
  /** Local variable definitions (name -> CEL expression) */
  local?: Record<string, string>;
}
```

### 5.2 Public API

```typescript
/**
 * Export Registry - manages exported variables and constants
 */
interface ExportRegistry {
  /**
   * Register an ExportVariables definition
   * @param exportVars - The export definition
   * @throws DuplicateExportError if name already exists
   */
  registerVariables(exportVars: ExportVariables): void;

  /**
   * Register an ExportConstants definition
   * @param exportConsts - The export definition
   * @throws DuplicateExportError if name already exists
   */
  registerConstants(exportConsts: ExportConstants): void;

  /**
   * Get an export by name
   * @param name - Export name
   * @returns The export definition or undefined
   */
  get(name: string): ExportVariables | ExportConstants | undefined;

  /**
   * Check if an export exists
   * @param name - Export name
   */
  has(name: string): boolean;

  /**
   * Get all registered export names
   */
  getNames(): string[];

  /**
   * Clear all registered exports
   */
  clear(): void;
}

/**
 * Variable Resolver - resolves imports for policies
 */
interface VariableResolver {
  /**
   * Resolve all variables for a policy
   * @param policy - The policy with import declarations
   * @returns Compiled variable context
   * @throws UnknownExportError if import not found
   * @throws CircularDependencyError if cycle detected
   */
  resolve(policy: ResourcePolicy | PrincipalPolicy): CompiledVariableContext;

  /**
   * Validate imports without full resolution
   * @param imports - List of import names
   * @returns Validation result
   */
  validateImports(imports: string[]): ImportValidationResult;

  /**
   * Get cache statistics
   */
  getCacheStats(): { hits: number; misses: number; size: number };

  /**
   * Clear compilation cache
   */
  clearCache(): void;
}

/**
 * Import validation result
 */
interface ImportValidationResult {
  valid: boolean;
  errors: ImportValidationError[];
  warnings: ImportValidationWarning[];
}

interface ImportValidationError {
  importName: string;
  message: string;
  code: string;
}

interface ImportValidationWarning {
  importName: string;
  message: string;
}
```

---

## 6. Data Models

### 6.1 Internal Storage Model

```typescript
// Internal representation of registered exports
interface StoredExport {
  type: 'variables' | 'constants';
  name: string;
  definitions: Map<string, StoredDefinition>;
  rawResource: ExportVariables | ExportConstants;
  loadedAt: Date;
  source?: string; // File path if loaded from file
}

interface StoredDefinition {
  name: string;
  value: string | unknown; // Expression for variables, value for constants
  compiled?: CompiledCEL; // Pre-compiled for variables
  dependencies: string[];
  type: 'variable' | 'constant';
}

// Dependency graph for cycle detection
interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: Map<string, Set<string>>; // from -> to
}

interface DependencyNode {
  name: string;
  type: 'export' | 'variable';
  exportName?: string;
}
```

### 6.2 Zod Validation Schema

```typescript
import { z } from 'zod';

const ExportVariablesSchema = z.object({
  apiVersion: z.literal('authz.engine/v1'),
  kind: z.literal('ExportVariables'),
  metadata: z.object({
    name: z.string().min(1).max(100),
  }),
  spec: z.object({
    name: z.string().min(1).max(50).regex(/^[a-z][a-z0-9_-]*$/i),
    definitions: z.record(
      z.string().regex(/^[a-z][a-z0-9_]*$/i), // Variable name
      z.string().min(1).max(2048) // CEL expression
    ),
  }),
});

const ExportConstantsSchema = z.object({
  apiVersion: z.literal('authz.engine/v1'),
  kind: z.literal('ExportConstants'),
  metadata: z.object({
    name: z.string().min(1).max(100),
  }),
  spec: z.object({
    name: z.string().min(1).max(50).regex(/^[a-z][a-z0-9_-]*$/i),
    definitions: z.record(
      z.string().regex(/^[a-z][a-z0-9_]*$/i), // Constant name
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.array(z.union([z.string(), z.number()])),
        z.record(z.string(), z.unknown()),
      ])
    ),
  }),
});
```

---

## 7. Error Handling

### 7.1 Error Types

| Error Code | Name | Description | Recovery |
|------------|------|-------------|----------|
| EV_001 | UnknownExportError | Import references non-existent export | Add missing export or fix import name |
| EV_002 | CircularDependencyError | Variable definitions form a cycle | Refactor to eliminate cycle |
| EV_003 | InvalidExpressionError | CEL expression syntax error | Fix expression syntax |
| EV_004 | DuplicateExportError | Export name already registered | Use unique export names |
| EV_005 | InvalidVariableNameError | Variable name contains invalid characters | Use valid identifier |
| EV_006 | TypeMismatchError | Expression returns unexpected type | Fix expression or update type |

### 7.2 Error Hierarchy

```typescript
class ExportError extends AuthzError {
  constructor(
    message: string,
    public code: string,
    public exportName?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ExportError';
  }
}

class UnknownExportError extends ExportError {
  constructor(exportName: string, policyName: string) {
    super(
      `Unknown export "${exportName}" referenced in policy "${policyName}"`,
      'EV_001',
      exportName,
      { policyName }
    );
  }
}

class CircularDependencyError extends ExportError {
  constructor(cycle: string[]) {
    super(
      `Circular dependency detected: ${cycle.join(' -> ')}`,
      'EV_002',
      undefined,
      { cycle }
    );
  }
}

class InvalidExpressionError extends ExportError {
  constructor(variableName: string, expression: string, cause?: Error) {
    super(
      `Invalid CEL expression in variable "${variableName}": ${cause?.message}`,
      'EV_003',
      undefined,
      { variableName, expression }
    );
  }
}
```

### 7.3 Error Handling Behavior

| Scenario | Behavior | Rationale |
|----------|----------|-----------|
| Unknown export in import | Fail policy load | Prevent runtime errors |
| Circular dependency | Fail policy load | Cannot resolve variables |
| Invalid CEL syntax | Fail policy load | Expression would fail at runtime |
| Duplicate export name | Fail export registration | Ambiguous references |

---

## 8. Security Considerations

### 8.1 Security Principles

| Principle | Implementation |
|-----------|----------------|
| No code injection | CEL sandboxing, no eval() |
| Input validation | Schema validation for all exports |
| Fail-closed | Invalid exports prevent policy loading |
| Audit trail | Log all export resolutions |

### 8.2 Threat Mitigations

| Threat | Mitigation |
|--------|------------|
| Malicious CEL expressions | CEL sandbox, function allowlist |
| Resource exhaustion via complex expressions | Expression complexity limits |
| Information leakage via error messages | Minimal error details in production |
| Unauthorized export modification | File permission controls |

### 8.3 CEL Expression Constraints

```typescript
const expressionConstraints = {
  maxLength: 2048,
  maxDepth: 10,
  timeoutMs: 50,
  allowedFunctions: [
    'startsWith', 'endsWith', 'contains', 'matches', 'size',
    'in', 'exists', 'all', 'filter', 'map',
    'timestamp', 'duration', 'now',
    'getHours', 'getMinutes', 'getDayOfWeek', 'getDayOfMonth',
  ],
};
```

---

## 9. Performance Requirements

### 9.1 Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Export load time | < 10ms per file | Cold load |
| Variable resolution | < 1ms per policy | With caching |
| Expression compilation | < 5ms per expression | One-time cost |
| Cache hit rate | > 99% | Compiled expressions |

### 9.2 Optimization Strategies

1. **Pre-compilation**: Compile CEL expressions at load time
2. **Caching**: Cache compiled expressions by hash
3. **Lazy loading**: Only compile expressions when used
4. **Inlining**: Inline constant values at compile time
5. **Dead code elimination**: Skip unused variables

```typescript
class ExpressionCache {
  private cache: Map<string, CompiledCEL>;
  private maxSize: number;

  constructor(maxSize = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  getOrCompile(expression: string): CompiledCEL {
    const hash = this.hash(expression);

    let compiled = this.cache.get(hash);
    if (compiled) {
      return compiled;
    }

    compiled = compileCEL(expression);

    if (this.cache.size >= this.maxSize) {
      // LRU eviction
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(hash, compiled);
    return compiled;
  }

  private hash(expression: string): string {
    return createHash('sha256').update(expression).digest('hex').slice(0, 16);
  }
}
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

| Component | Coverage Target | Test File |
|-----------|-----------------|-----------|
| ExportVariables schema | 95% | `tests/unit/exports/variables-schema.test.ts` |
| ExportConstants schema | 95% | `tests/unit/exports/constants-schema.test.ts` |
| Variable resolution | 95% | `tests/unit/exports/resolution.test.ts` |
| Circular dependency detection | 95% | `tests/unit/exports/circular-deps.test.ts` |

### 10.2 Integration Tests

| Scenario | Components Involved | Test File |
|----------|---------------------|-----------|
| Policy with imports | Loader, Registry, Resolver | `tests/integration/policy-imports.test.ts` |
| Hot reload of exports | FileWatcher, Registry | `tests/integration/export-reload.test.ts` |
| CEL evaluation with variables | CelEvaluator, Variables | `tests/integration/cel-variables.test.ts` |

### 10.3 Test Cases

```yaml
name: Variable Tests
tests:
  - name: Business hours variable works during work hours
    input:
      principal:
        id: user1
        roles: [user]
        attributes: {}
      resource:
        kind: document
        id: doc1
        attributes:
          owner: user1
      action: edit
    options:
      now: "2024-01-15T10:00:00Z"  # Monday 10 AM UTC
    expected:
      variables:
        is_business_hours: true
        is_weekend: false

  - name: Weekend variable works on Saturday
    input:
      principal:
        id: user1
        roles: [user]
        attributes: {}
      resource:
        kind: document
        id: doc1
        attributes: {}
      action: view
    options:
      now: "2024-01-20T10:00:00Z"  # Saturday
    expected:
      variables:
        is_business_hours: true
        is_weekend: true

  - name: Ownership variable matches owner
    input:
      principal:
        id: user123
        roles: [user]
        attributes: {}
      resource:
        kind: document
        id: doc1
        attributes:
          owner: user123
      action: edit
    expected:
      variables:
        is_owner: true

  - name: Local variable overrides imported
    input:
      principal:
        id: user1
        roles: [admin]
        attributes: {}
      resource:
        kind: document
        id: doc1
        attributes:
          owner: other-user
      action: delete
    policy:
      variables:
        import: [common]
        local:
          is_owner: "true"  # Override to always true
    expected:
      variables:
        is_owner: true  # Local override wins
```

### 10.4 Performance Tests

| Test | Target | Scenario |
|------|--------|----------|
| Load 100 exports | < 100ms | Cold start |
| Resolve 1000 policies | < 1s | Batch resolution |
| Cache hit lookup | < 0.1ms | Warm cache |
| Compile complex expression | < 10ms | Worst case |

---

## 11. Dependencies

### 11.1 Internal Dependencies

| Package | Usage |
|---------|-------|
| `@authz-engine/core/cel` | CEL expression compilation and evaluation |
| `@authz-engine/core/policy` | Policy schema and validation |
| `@authz-engine/core/types` | Shared type definitions |

### 11.2 External Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `zod` | ^3.x | Schema validation |
| `yaml` | ^2.x | YAML parsing |
| `cel-js` | ^0.x | CEL compilation |

---

## 12. Use Cases

### 12.1 Centralized Time-Based Access Control

```yaml
# exports/time-variables.yaml
apiVersion: authz.engine/v1
kind: ExportVariables
metadata:
  name: time-exports
spec:
  name: time
  definitions:
    is_business_hours: >
      now().getHours() >= 9 && now().getHours() < 17 &&
      now().getDayOfWeek() >= 1 && now().getDayOfWeek() <= 5
    is_after_hours: >
      now().getHours() < 9 || now().getHours() >= 17
    is_maintenance_window: >
      now().getHours() >= 2 && now().getHours() < 4

# policies/document-policy.yaml
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
spec:
  resource: document
  variables:
    import: [time]
  rules:
    - actions: [edit]
      effect: allow
      roles: [user]
      condition:
        match:
          expr: variables.is_business_hours
```

### 12.2 Compliance Constants

```yaml
# exports/compliance-constants.yaml
apiVersion: authz.engine/v1
kind: ExportConstants
metadata:
  name: compliance-exports
spec:
  name: compliance
  definitions:
    gdpr_regions: ["eu-west-1", "eu-central-1", "eu-north-1"]
    pci_environments: ["prod", "staging"]
    data_retention_days: 90
    audit_required_actions: ["delete", "export", "share"]

# policies/user-data-policy.yaml
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: user-data-policy
spec:
  resource: user_data
  variables:
    import: [compliance]
    local:
      is_gdpr_region: >
        request.principal.attr.region in compliance.gdpr_regions
  rules:
    - actions: [export]
      effect: allow
      roles: [admin]
      condition:
        match:
          all:
            of:
              - expr: "!variables.is_gdpr_region"
              - expr: request.principal.attr.dpo_approved == true
```

---

## 13. Related Documents

- [CORE-PACKAGE-SDD.md](./CORE-PACKAGE-SDD.md) - Core engine architecture
- [CEL-EVALUATOR-SDD.md](./CEL-EVALUATOR-SDD.md) - Expression evaluation
- [PRINCIPAL-POLICIES-SDD.md](./PRINCIPAL-POLICIES-SDD.md) - Principal policy variables
- [CERBOS-FEATURE-PARITY-SDD.md](./CERBOS-FEATURE-PARITY-SDD.md) - Feature compatibility

---

## 14. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-11-23 | Initial draft - export/import system, compilation, caching |

---

*This document specifies the Exported Variables and Constants feature for the AuthZ Engine, enabling DRY policy definitions through shared expressions and values.*
