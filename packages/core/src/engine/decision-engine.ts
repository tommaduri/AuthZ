import { CelEvaluator, EvaluationContext } from '../cel/evaluator';
import type {
  CheckRequest,
  CheckResponse,
  ActionResult,
  Principal,
  Resource,
  Effect,
} from '../types';
import type { ValidatedResourcePolicy, ValidatedDerivedRolesPolicy } from '../policy/schema';
import {
  createAuthzCheckSpan,
  createCelEvaluateSpan,
  createDerivedRolesSpan,
  createPolicyMatchSpan,
  recordDecisionOutcome,
  recordPolicyMatch,
  recordDerivedRoles,
  recordCelEvaluationMetrics,
} from '../telemetry/spans';
import type { Span } from '@opentelemetry/api';
import { addSpanAttributes, setSpanError } from '../telemetry/index';
import type { AuditLogger, DecisionEvent } from '../audit';

/**
 * Matches an action against a pattern with wildcard support.
 *
 * Wildcard Specification:
 * - Action patterns use `:` as delimiter
 * - `prefix:*` matches any action starting with `prefix:` (greedy - matches all remaining segments)
 * - `*:suffix` matches any action ending with `:suffix`
 * - `prefix:*:suffix` matches actions with prefix and suffix (middle * matches single segment)
 * - `*` alone matches any single action
 * - `*:*` matches any action with exactly two segments
 *
 * @param pattern - The pattern to match against (may contain wildcards)
 * @param action - The action to check
 * @returns true if the action matches the pattern
 */
export function matchesActionPattern(pattern: string, action: string): boolean {
  // Handle exact match
  if (pattern === action) return true;

  // Handle universal wildcard
  if (pattern === '*') return true;

  // Split by ':' delimiter
  const patternParts = pattern.split(':');
  const actionParts = action.split(':');

  // Check if pattern ends with a trailing wildcard (greedy matching)
  const lastPatternPart = patternParts[patternParts.length - 1];
  const hasTrailingWildcard = lastPatternPart === '*';

  // If pattern ends with *, it can match multiple remaining segments (greedy)
  if (hasTrailingWildcard && patternParts.length <= actionParts.length) {
    // Match all segments before the trailing wildcard exactly
    for (let i = 0; i < patternParts.length - 1; i++) {
      const patternPart = patternParts[i];
      const actionPart = actionParts[i];

      if (patternPart === '*') {
        // Middle wildcard matches single non-empty segment
        if (actionPart === '') {
          return false;
        }
        continue;
      }

      if (patternPart !== actionPart) {
        return false;
      }
    }

    // Trailing wildcard matches remaining segments (must have at least one non-empty)
    // For "prefix:*" matching "prefix:", we need at least one char after prefix:
    const remainingParts = actionParts.slice(patternParts.length - 1);
    // Check that there's something to match (at least one non-empty remaining part)
    return remainingParts.length > 0 && remainingParts.some(part => part !== '');
  }

  // Different segment counts - no match when no trailing wildcard
  if (patternParts.length !== actionParts.length) {
    return false;
  }

  // Match segment by segment
  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    const actionPart = actionParts[i];

    // Wildcard matches any non-empty segment
    if (patternPart === '*') {
      // Empty segment should not match wildcard (e.g., "prefix:" with empty after colon)
      if (actionPart === '') {
        return false;
      }
      continue;
    }

    // Exact segment match required
    if (patternPart !== actionPart) {
      return false;
    }
  }

  return true;
}

/**
 * Decision Engine
 *
 * The core authorization decision engine that evaluates policies
 * against requests and produces authorization decisions.
 */
export interface DecisionEngineConfig {
  /** Optional audit logger for recording decisions */
  auditLogger?: AuditLogger;
  /** Enable audit logging (default: true if auditLogger is provided) */
  auditEnabled?: boolean;
}

export class DecisionEngine {
  private celEvaluator: CelEvaluator;
  private resourcePolicies: Map<string, ValidatedResourcePolicy[]>;
  private derivedRolesPolicies: ValidatedDerivedRolesPolicy[];
  private auditLogger?: AuditLogger;
  private auditEnabled: boolean;

  constructor(config: DecisionEngineConfig = {}) {
    this.celEvaluator = new CelEvaluator();
    this.resourcePolicies = new Map();
    this.derivedRolesPolicies = [];
    this.auditLogger = config.auditLogger;
    this.auditEnabled = config.auditEnabled ?? (config.auditLogger !== undefined);
  }

  /**
   * Set the audit logger for this engine
   */
  setAuditLogger(logger: AuditLogger | undefined): void {
    this.auditLogger = logger;
    this.auditEnabled = logger !== undefined;
  }

  /**
   * Enable or disable audit logging
   */
  setAuditEnabled(enabled: boolean): void {
    this.auditEnabled = enabled;
  }

  /**
   * Load resource policies
   */
  loadResourcePolicies(policies: ValidatedResourcePolicy[]): void {
    for (const policy of policies) {
      const resource = policy.spec.resource;
      const existing = this.resourcePolicies.get(resource) || [];
      existing.push(policy);
      this.resourcePolicies.set(resource, existing);
    }
  }

  /**
   * Load derived roles policies
   */
  loadDerivedRolesPolicies(policies: ValidatedDerivedRolesPolicy[]): void {
    this.derivedRolesPolicies.push(...policies);
  }

  /**
   * Clear all loaded policies
   */
  clearPolicies(): void {
    this.resourcePolicies.clear();
    this.derivedRolesPolicies = [];
  }

  /**
   * Check authorization for a request
   */
  check(request: CheckRequest, parentSpan?: Span): CheckResponse {
    const startTime = Date.now();
    const requestId = request.requestId || `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Create root span for this check
    const span = createAuthzCheckSpan({ ...request, requestId }, parentSpan);

    try {
      const results: Record<string, ActionResult> = {};
      const policiesEvaluated: string[] = [];

      // Compute derived roles for this principal
      const derivedRolesSpan = createDerivedRolesSpan(span);
      const derivedRoles = this.computeDerivedRoles(request.principal, request.resource, request.auxData);
      recordDerivedRoles(derivedRolesSpan, derivedRoles);
      derivedRolesSpan.end();

      // Get policies for this resource
      const policies = this.resourcePolicies.get(request.resource.kind) || [];
      addSpanAttributes(span, {
        'authz.num_policies': policies.length,
      });

      // Evaluate each action
      for (const action of request.actions) {
        const result = this.evaluateAction(
          action,
          request.principal,
          request.resource,
          derivedRoles,
          policies,
          request.auxData,
          span,
        );

        results[action] = result;

        if (result.policy && !policiesEvaluated.includes(result.policy)) {
          policiesEvaluated.push(result.policy);
        }
      }

      const response: CheckResponse = {
        requestId,
        results,
        meta: {
          evaluationDurationMs: Date.now() - startTime,
          policiesEvaluated,
        },
      };

      // Record decision outcome in span
      recordDecisionOutcome(span, response);
      span.end();

      // Log decision to audit logger
      this.logDecision(request, response, requestId);

      return response;
    } catch (error) {
      setSpanError(span, error instanceof Error ? error : new Error(String(error)));
      span.end();
      throw error;
    }
  }

  /**
   * Compute derived roles for a principal
   */
  private computeDerivedRoles(
    principal: Principal,
    resource: Resource,
    auxData?: Record<string, unknown>,
  ): string[] {
    const derivedRoles: string[] = [];

    for (const policy of this.derivedRolesPolicies) {
      for (const definition of policy.spec.definitions) {
        // Check if principal has required parent roles
        const hasParentRole = definition.parentRoles.length === 0 ||
          definition.parentRoles.some(role => principal.roles.includes(role));

        if (!hasParentRole) {
          continue;
        }

        // Evaluate condition
        const context: EvaluationContext = {
          principal,
          resource,
          auxData,
        };

        const matches = this.celEvaluator.evaluateBoolean(
          definition.condition.expression,
          context,
        );

        if (matches) {
          derivedRoles.push(definition.name);
        }
      }
    }

    return derivedRoles;
  }

  /**
   * Evaluate a single action against policies
   */
  private evaluateAction(
    action: string,
    principal: Principal,
    resource: Resource,
    derivedRoles: string[],
    policies: ValidatedResourcePolicy[],
    auxData?: Record<string, unknown>,
    parentSpan?: Span,
  ): ActionResult {
    const allRoles = [...principal.roles, ...derivedRoles];

    // Default deny if no policies match
    let finalEffect: Effect = 'deny';
    let matchedPolicy = 'default-deny';
    let matchedRule: string | undefined;

    for (const policy of policies) {
      const policySpan = createPolicyMatchSpan(policy.metadata.name, parentSpan);

      for (const rule of policy.spec.rules) {
        // Check if action matches using wildcard pattern matching
        const actionMatches = rule.actions.some(pattern => matchesActionPattern(pattern, action));
        if (!actionMatches) {
          continue;
        }

        // Check if roles match (if specified)
        if (rule.roles && rule.roles.length > 0) {
          const hasRole = rule.roles.some(role => allRoles.includes(role));
          if (!hasRole) {
            continue;
          }
        }

        // Check if derived roles match (if specified)
        if (rule.derivedRoles && rule.derivedRoles.length > 0) {
          const hasDerivedRole = rule.derivedRoles.some(role => derivedRoles.includes(role));
          if (!hasDerivedRole) {
            continue;
          }
        }

        // Evaluate condition (if present)
        if (rule.condition) {
          const context: EvaluationContext = {
            principal,
            resource,
            auxData,
          };

          const celSpan = createCelEvaluateSpan(rule.condition.expression, 'rule_condition', policySpan);
          const startTime = Date.now();

          try {
            const conditionMet = this.celEvaluator.evaluateBoolean(
              rule.condition.expression,
              context,
            );

            recordCelEvaluationMetrics(celSpan, Date.now() - startTime, conditionMet, true);
            celSpan.end();

            if (!conditionMet) {
              continue;
            }
          } catch (error) {
            setSpanError(celSpan, error instanceof Error ? error : new Error(String(error)));
            celSpan.end();
            continue;
          }
        }

        // Rule matched!
        recordPolicyMatch(policySpan, policy.metadata.name, rule.name, true);
        policySpan.end();

        // Apply effect based on rule order and effect type
        // DENY takes precedence over ALLOW (deny-overrides combining algorithm)
        if (rule.effect === 'deny') {
          return {
            effect: 'deny',
            policy: policy.metadata.name,
            meta: {
              matchedRule: rule.name,
              effectiveDerivedRoles: derivedRoles,
            },
          };
        }

        // Record ALLOW but continue checking for DENY rules
        if (rule.effect === 'allow') {
          finalEffect = 'allow';
          matchedPolicy = policy.metadata.name;
          matchedRule = rule.name;
        }
      }

      recordPolicyMatch(policySpan, policy.metadata.name, undefined, false);
      policySpan.end();
    }

    return {
      effect: finalEffect,
      policy: matchedPolicy,
      meta: {
        matchedRule,
        effectiveDerivedRoles: derivedRoles,
      },
    };
  }

  /**
   * Get statistics about loaded policies
   */
  getStats(): {
    resourcePolicies: number;
    derivedRolesPolicies: number;
    resources: string[];
  } {
    return {
      resourcePolicies: Array.from(this.resourcePolicies.values()).flat().length,
      derivedRolesPolicies: this.derivedRolesPolicies.length,
      resources: Array.from(this.resourcePolicies.keys()),
    };
  }

  /**
   * Log authorization decision to audit logger
   */
  private logDecision(request: CheckRequest, response: CheckResponse, requestId: string): void {
    if (!this.auditEnabled || !this.auditLogger) {
      return;
    }

    const decisionEvent: DecisionEvent = {
      request: {
        requestId,
        principal: {
          id: request.principal.id,
          roles: request.principal.roles,
        },
        resource: {
          kind: request.resource.kind,
          id: request.resource.id,
        },
        actions: request.actions,
      },
      response: {
        results: Object.fromEntries(
          Object.entries(response.results).map(([action, result]) => [
            action,
            {
              effect: result.effect,
              policy: result.policy,
              rule: result.meta?.matchedRule,
            },
          ])
        ),
        durationMs: response.meta?.evaluationDurationMs ?? 0,
        policiesEvaluated: response.meta?.policiesEvaluated ?? [],
      },
    };

    this.auditLogger.logDecision(decisionEvent, requestId);
  }
}

// Default engine instance
export const decisionEngine = new DecisionEngine();
