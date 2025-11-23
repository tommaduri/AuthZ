/**
 * Policy Types for AuthZ Engine
 *
 * These types define the structure of authorization policies,
 * similar to Cerbos but simplified for initial implementation.
 */

// =============================================================================
// Core Types
// =============================================================================

export type Effect = 'allow' | 'deny';

export interface Principal {
  /** Unique identifier for the principal (user, service, etc.) */
  id: string;
  /** Roles assigned to this principal */
  roles: string[];
  /** Additional attributes for policy evaluation */
  attributes: Record<string, unknown>;
}

export interface Resource {
  /** Type/kind of resource (e.g., 'subscription', 'avatar', 'chat') */
  kind: string;
  /** Unique identifier for this specific resource instance */
  id: string;
  /** Additional attributes for policy evaluation */
  attributes: Record<string, unknown>;
}

// =============================================================================
// Policy Definition Types
// =============================================================================

export interface PolicyMetadata {
  /** Unique name for this policy */
  name: string;
  /** Optional description */
  description?: string;
  /** Policy version for tracking changes */
  version?: string;
  /** Labels for organization */
  labels?: Record<string, string>;
}

export interface PolicyCondition {
  /** CEL expression to evaluate */
  expression: string;
}

export interface PolicyRule {
  /** Actions this rule applies to (e.g., ['create', 'read', 'update', 'delete']) */
  actions: string[];
  /** Effect when rule matches */
  effect: Effect;
  /** Roles this rule applies to (if empty, applies to all) */
  roles?: string[];
  /** Derived roles this rule applies to */
  derivedRoles?: string[];
  /** Optional condition (CEL expression) */
  condition?: PolicyCondition;
  /** Rule name for debugging/auditing */
  name?: string;
}

export interface ResourcePolicy {
  apiVersion: 'authz.engine/v1';
  kind: 'ResourcePolicy';
  metadata: PolicyMetadata;
  spec: {
    /** Resource type this policy applies to */
    resource: string;
    /** Policy rules */
    rules: PolicyRule[];
    /** Schemas for validation (optional) */
    schemas?: {
      principalSchema?: Record<string, unknown>;
      resourceSchema?: Record<string, unknown>;
    };
  };
}

// =============================================================================
// Derived Roles Types
// =============================================================================

export interface DerivedRoleDefinition {
  /** Name of the derived role */
  name: string;
  /** Parent roles required */
  parentRoles: string[];
  /** Condition to compute this role (CEL expression) */
  condition: PolicyCondition;
}

export interface DerivedRolesPolicy {
  apiVersion: 'authz.engine/v1';
  kind: 'DerivedRoles';
  metadata: PolicyMetadata;
  spec: {
    /** Derived role definitions */
    definitions: DerivedRoleDefinition[];
  };
}

// =============================================================================
// Principal Policy Types (for principal-specific rules)
// =============================================================================

export interface PrincipalPolicy {
  apiVersion: 'authz.engine/v1';
  kind: 'PrincipalPolicy';
  metadata: PolicyMetadata;
  spec: {
    /** Principal this policy applies to */
    principal: string;
    /** Version of this principal policy */
    version: string;
    /** Resource-specific rules */
    rules: Array<{
      resource: string;
      actions: Array<{
        action: string;
        effect: Effect;
        condition?: PolicyCondition;
      }>;
    }>;
  };
}

// =============================================================================
// Union Types
// =============================================================================

export type Policy = ResourcePolicy | DerivedRolesPolicy | PrincipalPolicy;

// =============================================================================
// Request/Response Types
// =============================================================================

export interface CheckRequest {
  /** Unique request ID for tracing */
  requestId?: string;
  /** Principal making the request */
  principal: Principal;
  /** Resource being accessed */
  resource: Resource;
  /** Actions to check */
  actions: string[];
  /** Additional context for evaluation */
  auxData?: Record<string, unknown>;
}

export interface ActionResult {
  /** Effect of the action */
  effect: Effect;
  /** Policy that matched */
  policy: string;
  /** Additional metadata */
  meta?: {
    /** Which rule matched */
    matchedRule?: string;
    /** Derived roles that were computed */
    effectiveDerivedRoles?: string[];
    /** Evaluation duration in ms */
    evaluationDurationMs?: number;
  };
}

export interface CheckResponse {
  /** Request ID from the request */
  requestId: string;
  /** Results for each action */
  results: Record<string, ActionResult>;
  /** Metadata about the check */
  meta?: {
    /** Total evaluation time */
    evaluationDurationMs: number;
    /** Policies that were evaluated */
    policiesEvaluated: string[];
  };
}

// =============================================================================
// Batch Request Types
// =============================================================================

export interface BatchCheckRequest {
  /** Unique request ID */
  requestId?: string;
  /** Principal making all requests */
  principal: Principal;
  /** Resources to check */
  resources: Array<{
    resource: Resource;
    actions: string[];
  }>;
}

export interface BatchCheckResponse {
  /** Request ID */
  requestId: string;
  /** Results indexed by resource kind:id */
  results: Record<string, Record<string, ActionResult>>;
}

// =============================================================================
// Plan Resources Types (for query filtering)
// =============================================================================

export interface PlanResourcesRequest {
  /** Principal making the request */
  principal: Principal;
  /** Resource kind to plan for */
  resourceKind: string;
  /** Action to plan for */
  action: string;
}

export interface PlanResourcesResponse {
  /** Request ID */
  requestId: string;
  /** Filter to apply to resource queries */
  filter: {
    /** Kind of filter */
    kind: 'always_allow' | 'always_deny' | 'conditional';
    /** Condition expression (if conditional) */
    condition?: string;
  };
}
