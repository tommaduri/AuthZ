import { z } from 'zod';

/**
 * Zod schemas for policy validation
 * These schemas validate the structure of policy YAML/JSON files
 */

// =============================================================================
// Base Schemas
// =============================================================================

const EffectSchema = z.enum(['allow', 'deny']);

const PolicyConditionSchema = z.object({
  expression: z.string().min(1, 'Expression cannot be empty'),
});

const PolicyMetadataSchema = z.object({
  name: z.string().min(1, 'Policy name is required'),
  description: z.string().optional(),
  version: z.string().optional(),
  labels: z.record(z.string()).optional(),
  /** Hierarchical scope using dot notation (e.g., "acme.corp.engineering") */
  scope: z.string().optional(),
});

// =============================================================================
// Resource Policy Schema
// =============================================================================

const PolicyRuleSchema = z.object({
  actions: z.array(z.string()).min(1, 'At least one action is required'),
  effect: EffectSchema,
  roles: z.array(z.string()).optional(),
  derivedRoles: z.array(z.string()).optional(),
  condition: PolicyConditionSchema.optional(),
  name: z.string().optional(),
});

export const ResourcePolicySchema = z.object({
  apiVersion: z.literal('authz.engine/v1'),
  kind: z.literal('ResourcePolicy'),
  metadata: PolicyMetadataSchema,
  spec: z.object({
    resource: z.string().min(1, 'Resource type is required'),
    rules: z.array(PolicyRuleSchema).min(1, 'At least one rule is required'),
    schemas: z.object({
      principalSchema: z.record(z.unknown()).optional(),
      resourceSchema: z.record(z.unknown()).optional(),
    }).optional(),
  }),
});

// =============================================================================
// Derived Roles Schema
// =============================================================================

const DerivedRoleDefinitionSchema = z.object({
  name: z.string().min(1, 'Derived role name is required'),
  parentRoles: z.array(z.string()),
  condition: PolicyConditionSchema,
});

export const DerivedRolesPolicySchema = z.object({
  apiVersion: z.literal('authz.engine/v1'),
  kind: z.literal('DerivedRoles'),
  metadata: PolicyMetadataSchema,
  spec: z.object({
    definitions: z.array(DerivedRoleDefinitionSchema).min(1, 'At least one definition is required'),
  }),
});

// =============================================================================
// Principal Policy Schema
// =============================================================================

/**
 * Output expression configuration for rules.
 * Allows defining expressions to evaluate when rules are activated or conditions aren't met.
 */
const OutputExpressionSchema = z.object({
  /** Expression to evaluate when rule is activated */
  whenRuleActivated: z.string().optional(),
  /** Expression to evaluate when condition is not met */
  whenConditionNotMet: z.string().optional(),
});

/**
 * Enhanced action rule with name and output support.
 */
const PrincipalRuleActionSchema = z.object({
  /** Action this rule applies to (supports wildcards: *, action:*, etc.) */
  action: z.string(),
  /** Effect of the rule */
  effect: EffectSchema,
  /** Optional name for the rule (for debugging/auditing) */
  name: z.string().optional(),
  /** Optional condition expression */
  condition: PolicyConditionSchema.optional(),
  /** Optional output expressions */
  output: OutputExpressionSchema.optional(),
});

/**
 * Policy variable definition.
 */
const PolicyVariableSchema = z.object({
  /** Variable name */
  name: z.string().min(1, 'Variable name is required'),
  /** CEL expression for the variable value */
  expression: z.string().min(1, 'Variable expression is required'),
});

/**
 * Variables configuration for policies.
 */
const PolicyVariablesSchema = z.object({
  /** Imported variable sets (referenced by name) */
  import: z.array(z.string()).optional(),
  /** Local variable definitions */
  local: z.array(PolicyVariableSchema).optional(),
});

const PrincipalRuleSchema = z.object({
  /** Resource this rule applies to (supports wildcards) */
  resource: z.string(),
  /** Actions for this resource */
  actions: z.array(PrincipalRuleActionSchema),
});

export const PrincipalPolicySchema = z.object({
  apiVersion: z.literal('authz.engine/v1'),
  kind: z.literal('PrincipalPolicy'),
  metadata: PolicyMetadataSchema,
  spec: z.object({
    /** Principal pattern (exact ID or wildcard: *, service-*, *@domain.com) */
    principal: z.string().min(1, 'Principal is required'),
    /** Policy version for tracking changes */
    version: z.string(),
    /** Optional variables (imported and local) */
    variables: PolicyVariablesSchema.optional(),
    /** Resource-specific rules */
    rules: z.array(PrincipalRuleSchema),
  }),
});

// =============================================================================
// Union Schema
// =============================================================================

export const PolicySchema = z.discriminatedUnion('kind', [
  ResourcePolicySchema,
  DerivedRolesPolicySchema,
  PrincipalPolicySchema,
]);

// =============================================================================
// Request Schemas
// =============================================================================

export const PrincipalSchema = z.object({
  id: z.string().min(1, 'Principal ID is required'),
  roles: z.array(z.string()),
  attributes: z.record(z.unknown()),
});

export const ResourceSchema = z.object({
  kind: z.string().min(1, 'Resource kind is required'),
  id: z.string().min(1, 'Resource ID is required'),
  attributes: z.record(z.unknown()),
});

export const CheckRequestSchema = z.object({
  requestId: z.string().optional(),
  principal: PrincipalSchema,
  resource: ResourceSchema,
  actions: z.array(z.string()).min(1, 'At least one action is required'),
  auxData: z.record(z.unknown()).optional(),
});

export const BatchCheckRequestSchema = z.object({
  requestId: z.string().optional(),
  principal: PrincipalSchema,
  resources: z.array(z.object({
    resource: ResourceSchema,
    actions: z.array(z.string()),
  })),
});

// =============================================================================
// Type Inference
// =============================================================================

export type ValidatedResourcePolicy = z.infer<typeof ResourcePolicySchema>;
export type ValidatedDerivedRolesPolicy = z.infer<typeof DerivedRolesPolicySchema>;
export type ValidatedPrincipalPolicy = z.infer<typeof PrincipalPolicySchema>;
export type ValidatedPolicy = z.infer<typeof PolicySchema>;
export type ValidatedCheckRequest = z.infer<typeof CheckRequestSchema>;
export type ValidatedBatchCheckRequest = z.infer<typeof BatchCheckRequestSchema>;
