# Aegis Authorization Engine - Types Reference SDD

**Module**: `@authz-engine/core/types`
**Version**: 0.1.0
**Last Updated**: 2024-11-23

---

## 1. Overview

This document provides a comprehensive reference for all TypeScript types used throughout the Aegis Authorization Engine. All types follow TypeScript strict mode and use `readonly` modifiers where appropriate for immutability.

---

## 2. Core Domain Types

### 2.1 Principal

Represents a user, service, or entity making authorization requests.

```typescript
/**
 * Principal - The entity requesting access
 * @example
 * const principal: Principal = {
 *   id: 'user-123',
 *   roles: ['user', 'editor'],
 *   attributes: {
 *     department: 'engineering',
 *     level: 5,
 *     teams: ['platform', 'security']
 *   }
 * };
 */
interface Principal {
  /** Unique identifier for the principal */
  id: string;

  /** Roles assigned to this principal */
  roles: string[];

  /** Custom attributes for policy conditions */
  attributes: Record<string, unknown>;
}
```

**Usage Notes:**
- `id` should be globally unique (UUID, email, service name)
- `roles` are matched against policy rules
- `attributes` are accessible in CEL as `principal.{key}` or `request.principal.attr.{key}`

---

### 2.2 Resource

Represents the entity being accessed or acted upon.

```typescript
/**
 * Resource - The entity being accessed
 * @example
 * const resource: Resource = {
 *   kind: 'avatar',
 *   id: 'avatar-456',
 *   attributes: {
 *     ownerId: 'user-123',
 *     visibility: 'public',
 *     status: 'active',
 *     tags: ['featured', 'verified']
 *   }
 * };
 */
interface Resource {
  /** Resource type (matches policy spec.resource) */
  kind: string;

  /** Unique identifier for this resource */
  id: string;

  /** Custom attributes for policy conditions */
  attributes: Record<string, unknown>;
}
```

**Usage Notes:**
- `kind` must match `spec.resource` in ResourcePolicy
- `attributes` are accessible in CEL as `resource.{key}` or `request.resource.attr.{key}`

---

### 2.3 Effect

The result of an authorization decision.

```typescript
/**
 * Effect - Authorization decision outcome
 */
type Effect = 'EFFECT_ALLOW' | 'EFFECT_DENY';
```

**Design Note:** Uses Cerbos-compatible string literals rather than enums for JSON serialization compatibility.

---

## 3. Request/Response Types

### 3.1 CheckRequest

Input for authorization checks.

```typescript
/**
 * CheckRequest - Authorization check input
 * @example
 * const request: CheckRequest = {
 *   requestId: 'req-uuid-123',
 *   principal: { id: 'user-123', roles: ['user'], attributes: {} },
 *   resource: { kind: 'document', id: 'doc-456', attributes: { ownerId: 'user-123' } },
 *   actions: ['read', 'write', 'delete'],
 *   auxData: {
 *     jwt: { sub: 'user-123', iss: 'auth.example.com' }
 *   }
 * };
 */
interface CheckRequest {
  /** Unique request ID for tracing/correlation */
  requestId: string;

  /** The principal making the request */
  principal: Principal;

  /** The resource being accessed */
  resource: Resource;

  /** Actions to check authorization for */
  actions: string[];

  /** Optional auxiliary data (JWT claims, etc.) */
  auxData?: Record<string, unknown>;
}
```

---

### 3.2 CheckResponse

Output from authorization checks.

```typescript
/**
 * CheckResponse - Authorization check result
 */
interface CheckResponse {
  /** Request ID for correlation */
  requestId: string;

  /** Resource identifier */
  resourceId: string;

  /** Result for each requested action */
  actions: Record<string, ActionResult>;

  /** Derived roles computed for this request */
  effectiveDerivedRoles: string[];

  /** Evaluation metadata */
  meta: {
    /** Time taken to evaluate (milliseconds) */
    evaluationDurationMs: number;
    /** Policies that were evaluated */
    policiesEvaluated: string[];
  };
}
```

---

### 3.3 ActionResult

Result for a single action.

```typescript
/**
 * ActionResult - Single action authorization result
 */
interface ActionResult {
  /** ALLOW or DENY */
  effect: Effect;

  /** Policy that produced this decision */
  policy: string;

  /** Specific rule within the policy (optional) */
  rule?: string;
}
```

---

## 4. Policy Types

### 4.1 Policy Union Type

```typescript
/**
 * Policy - Union of all policy types
 */
type Policy = ResourcePolicy | DerivedRolesPolicy | PrincipalPolicy;
```

---

### 4.2 ResourcePolicy

Defines access rules for a resource type.

```typescript
/**
 * ResourcePolicy - Access rules for a resource type
 * @example
 * const policy: ResourcePolicy = {
 *   apiVersion: 'api.cerbos.dev/v1',
 *   kind: 'ResourcePolicy',
 *   metadata: { name: 'avatar-policy' },
 *   spec: {
 *     resource: 'avatar',
 *     version: '1.0',
 *     importDerivedRoles: ['common-roles'],
 *     rules: [
 *       {
 *         actions: ['view'],
 *         effect: 'ALLOW',
 *         roles: ['*'],
 *         condition: { match: { expr: 'resource.visibility == "public"' } }
 *       }
 *     ]
 *   }
 * };
 */
interface ResourcePolicy {
  /** API version (always 'api.cerbos.dev/v1') */
  apiVersion: 'api.cerbos.dev/v1';

  /** Policy kind */
  kind: 'ResourcePolicy';

  /** Policy metadata */
  metadata: {
    /** Unique policy name */
    name: string;
    /** Optional version tag */
    version?: string;
  };

  /** Policy specification */
  spec: {
    /** Resource type this policy applies to */
    resource: string;
    /** Policy version */
    version: string;
    /** Derived roles to import */
    importDerivedRoles?: string[];
    /** Access rules */
    rules: PolicyRule[];
  };
}
```

---

### 4.3 PolicyRule

Individual rule within a ResourcePolicy.

```typescript
/**
 * PolicyRule - Single access rule
 */
interface PolicyRule {
  /** Actions this rule applies to (or '*' for all) */
  actions: string[];

  /** Effect when rule matches */
  effect: 'ALLOW' | 'DENY';

  /** Base roles this rule applies to */
  roles?: string[];

  /** Derived roles this rule applies to */
  derivedRoles?: string[];

  /** Optional condition that must be true */
  condition?: PolicyCondition;

  /** Rule name for audit/debugging */
  name?: string;
}
```

---

### 4.4 PolicyCondition

CEL expression condition.

```typescript
/**
 * PolicyCondition - CEL condition wrapper
 */
interface PolicyCondition {
  match: {
    /** CEL expression that must evaluate to true */
    expr: string;
  };
}
```

---

### 4.5 DerivedRolesPolicy

Defines computed roles based on conditions.

```typescript
/**
 * DerivedRolesPolicy - Dynamic role definitions
 * @example
 * const derivedRoles: DerivedRolesPolicy = {
 *   apiVersion: 'api.cerbos.dev/v1',
 *   kind: 'DerivedRoles',
 *   metadata: { name: 'common-roles' },
 *   spec: {
 *     name: 'common-roles',
 *     definitions: [
 *       {
 *         name: 'owner',
 *         parentRoles: ['user'],
 *         condition: { match: { expr: 'resource.ownerId == principal.id' } }
 *       }
 *     ]
 *   }
 * };
 */
interface DerivedRolesPolicy {
  apiVersion: 'api.cerbos.dev/v1';
  kind: 'DerivedRoles';
  metadata: {
    name: string;
  };
  spec: {
    /** Name for importing */
    name: string;
    /** Role definitions */
    definitions: DerivedRoleDefinition[];
  };
}

/**
 * DerivedRoleDefinition - Single derived role
 */
interface DerivedRoleDefinition {
  /** Name of the derived role */
  name: string;
  /** Parent roles required */
  parentRoles: string[];
  /** Condition that grants this role */
  condition?: PolicyCondition;
}
```

---

### 4.6 PrincipalPolicy

Override rules for specific principals.

```typescript
/**
 * PrincipalPolicy - Principal-specific rules
 */
interface PrincipalPolicy {
  apiVersion: 'api.cerbos.dev/v1';
  kind: 'PrincipalPolicy';
  metadata: {
    name: string;
  };
  spec: {
    /** Principal ID this applies to */
    principal: string;
    /** Policy version */
    version: string;
    /** Override rules */
    rules: PrincipalRule[];
  };
}

/**
 * PrincipalRule - Rule in principal policy
 */
interface PrincipalRule {
  /** Resource type */
  resource: string;
  /** Action-specific rules */
  actions: Array<{
    action: string;
    effect: 'ALLOW' | 'DENY';
    condition?: PolicyCondition;
  }>;
}
```

---

## 5. CEL Evaluator Types

### 5.1 EvaluationContext

Context passed to CEL evaluation.

```typescript
/**
 * EvaluationContext - Input for CEL evaluation
 */
interface EvaluationContext {
  /** Principal making the request */
  readonly principal: Principal;

  /** Resource being accessed */
  readonly resource: Resource;

  /** Auxiliary data (JWT, etc.) */
  readonly auxData?: Readonly<Record<string, unknown>>;

  /** Current timestamp for time-based conditions */
  readonly now?: Date;
}
```

---

### 5.2 EvaluationResult

Result from CEL evaluation.

```typescript
/**
 * EvaluationResult - CEL evaluation output
 */
interface EvaluationResult {
  /** Whether evaluation succeeded */
  readonly success: boolean;

  /** Result value (usually boolean) */
  readonly value?: unknown;

  /** Error message if failed */
  readonly error?: string;

  /** Error category */
  readonly errorType?: 'parse' | 'evaluation' | 'type' | 'unknown';
}
```

---

### 5.3 ValidationResult

Result from expression validation.

```typescript
/**
 * ValidationResult - Expression syntax validation
 */
interface ValidationResult {
  /** Whether expression is syntactically valid */
  readonly valid: boolean;

  /** Parse errors if invalid */
  readonly errors?: readonly string[];
}
```

---

### 5.4 CacheStats

CEL expression cache statistics.

```typescript
/**
 * CacheStats - Expression cache metrics
 */
interface CacheStats {
  /** Number of cached expressions */
  readonly size: number;

  /** Total cache hits */
  readonly hits: number;

  /** Total cache misses */
  readonly misses: number;

  /** Hit rate percentage (0-100) */
  readonly hitRate: number;
}
```

---

## 6. Validated Policy Types

Types returned after schema validation (Zod parsed).

```typescript
/**
 * ValidatedPolicy - Union of validated policy types
 */
type ValidatedPolicy =
  | ValidatedResourcePolicy
  | ValidatedDerivedRolesPolicy
  | ValidatedPrincipalPolicy;

/**
 * ValidatedResourcePolicy - Schema-validated resource policy
 */
interface ValidatedResourcePolicy extends ResourcePolicy {
  // Same structure, but guaranteed to pass schema validation
}

/**
 * ValidatedDerivedRolesPolicy - Schema-validated derived roles
 */
interface ValidatedDerivedRolesPolicy extends DerivedRolesPolicy {
  // Same structure, but guaranteed to pass schema validation
}

/**
 * ValidatedPrincipalPolicy - Schema-validated principal policy
 */
interface ValidatedPrincipalPolicy extends PrincipalPolicy {
  // Same structure, but guaranteed to pass schema validation
}
```

---

## 7. Error Types

### 7.1 PolicyParseError

```typescript
/**
 * PolicyParseError - Policy parsing failure
 */
class PolicyParseError extends Error {
  constructor(
    message: string,
    /** Validation errors with paths */
    public readonly errors: Array<{ path: string; message: string }>,
    /** Original source (YAML/JSON string) */
    public readonly source?: string,
  );
}
```

---

### 7.2 CelExpressionTypeError

```typescript
/**
 * CelExpressionTypeError - CEL type mismatch
 */
class CelExpressionTypeError extends Error {
  constructor(message: string);
}
```

---

## 8. Type Guards

Utility functions for type narrowing.

```typescript
/**
 * Type guard for ResourcePolicy
 */
function isResourcePolicy(policy: Policy): policy is ResourcePolicy {
  return policy.kind === 'ResourcePolicy';
}

/**
 * Type guard for DerivedRolesPolicy
 */
function isDerivedRolesPolicy(policy: Policy): policy is DerivedRolesPolicy {
  return policy.kind === 'DerivedRoles';
}

/**
 * Type guard for PrincipalPolicy
 */
function isPrincipalPolicy(policy: Policy): policy is PrincipalPolicy {
  return policy.kind === 'PrincipalPolicy';
}
```

---

## 9. Utility Types

### 9.1 DeepReadonly

Makes all properties recursively readonly.

```typescript
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object
    ? DeepReadonly<T[P]>
    : T[P];
};
```

### 9.2 PartialDeep

Makes all properties recursively optional.

```typescript
type PartialDeep<T> = {
  [P in keyof T]?: T[P] extends object
    ? PartialDeep<T[P]>
    : T[P];
};
```

---

## 10. Import Paths

```typescript
// Core types
import type {
  Principal,
  Resource,
  Effect,
  CheckRequest,
  CheckResponse,
  ActionResult
} from '@authz-engine/core';

// Policy types
import type {
  Policy,
  ResourcePolicy,
  DerivedRolesPolicy,
  PrincipalPolicy,
  PolicyRule,
  PolicyCondition
} from '@authz-engine/core';

// CEL types
import type {
  EvaluationContext,
  EvaluationResult,
  ValidationResult,
  CacheStats
} from '@authz-engine/core/cel';

// Validated types
import type {
  ValidatedPolicy,
  ValidatedResourcePolicy,
  ValidatedDerivedRolesPolicy,
  ValidatedPrincipalPolicy
} from '@authz-engine/core/policy';
```

---

## 11. Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2024-11-23 | Initial type definitions |
