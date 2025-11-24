import { CelEvaluator, EvaluationContext } from '../cel/evaluator';
import type {
  CheckRequest,
  CheckResponse,
  ActionResult,
  Principal,
  Resource,
  Effect,
  ScopedCheckRequest,
  ScopedCheckResponse,
  ScopeResolutionInfo,
} from '../types';
import type { ValidatedResourcePolicy, ValidatedDerivedRolesPolicy, ValidatedPrincipalPolicy } from '../policy/schema';
import { ScopeResolver } from '../scope';
import { PrincipalPolicyEvaluator } from '../principal/principal-policy-evaluator';
import { matchesActionPattern } from '../utils/pattern-matching';
import { DerivedRolesResolver } from '../derived-roles'; // Removed DerivedRolesCache - unused (TypeScript error TS6133)
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

// Re-export matchesActionPattern for backwards compatibility
export { matchesActionPattern } from '../utils/pattern-matching';

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
  private derivedRolesResolver: DerivedRolesResolver;
  private auditLogger?: AuditLogger;
  private auditEnabled: boolean;
  private scopedResourcePolicies: Map<string, ValidatedResourcePolicy[]>;
  private scopeResolver: ScopeResolver;
  private principalPolicyEvaluator: PrincipalPolicyEvaluator;

  constructor(config: DecisionEngineConfig = {}) {
    this.celEvaluator = new CelEvaluator();
    this.resourcePolicies = new Map();
    this.derivedRolesPolicies = [];
    this.derivedRolesResolver = new DerivedRolesResolver({
      celEvaluator: this.celEvaluator,
    });
    this.auditLogger = config.auditLogger;
    this.auditEnabled = config.auditEnabled ?? (config.auditLogger !== undefined);
    this.scopedResourcePolicies = new Map();
    this.scopeResolver = new ScopeResolver();
    this.principalPolicyEvaluator = new PrincipalPolicyEvaluator({
      celEvaluator: this.celEvaluator,
    });
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
    this.derivedRolesResolver.loadPolicies(policies);
  }

  /**
   * Load principal policies
   */
  loadPrincipalPolicies(policies: ValidatedPrincipalPolicy[]): void {
    this.principalPolicyEvaluator.loadPolicies(policies);
  }

  /**
   * Clear all loaded policies
   */
  clearPolicies(): void {
    this.resourcePolicies.clear();
    this.derivedRolesPolicies = [];
    this.derivedRolesResolver.clear();
    this.scopedResourcePolicies.clear();
    this.principalPolicyEvaluator.clearPolicies();
  }

  /**
   * Load scoped resource policies
   * Policies with metadata.scope are stored separately from global policies
   */
  loadScopedResourcePolicies(policies: ValidatedResourcePolicy[]): void {
    for (const policy of policies) {
      const scope = policy.metadata.scope || '(global)';
      const resourceKind = policy.spec.resource;
      const key = `${scope}:${resourceKind}`;

      const existing = this.scopedResourcePolicies.get(key) || [];
      existing.push(policy);
      this.scopedResourcePolicies.set(key, existing);
    }
  }

  /**
   * Check authorization with scope context
   * Uses ScopeResolver to find matching policies with inheritance support
   */
  checkWithScope(request: ScopedCheckRequest, parentSpan?: Span): ScopedCheckResponse {
    const startTime = Date.now();
    const requestId = request.requestId || `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Compute effective scope (empty string means global)
    const computedScope = this.scopeResolver.computeEffectiveScope(
      request.scope?.principal,
      request.scope?.resource,
    );
    const effectiveScope = computedScope || '(global)';

    // Build inheritance chain (including global at the end for fallback)
    const baseChain = this.scopeResolver.buildInheritanceChain(
      effectiveScope === '(global)' ? undefined : effectiveScope,
    );
    const inheritanceChain = [...baseChain, '(global)'];

    // Find matching scoped policy
    const scopeResolution = this.scopeResolver.findMatchingPolicy(
      this.scopedResourcePolicies,
      request.resource.kind,
      effectiveScope,
    );

    // Get policies to evaluate
    let policies: ValidatedResourcePolicy[];
    let scopedPolicyMatched = false;

    if (scopeResolution.effectivePolicy) {
      // Use the scoped policy
      const key = scopeResolution.matchedScope === '(global)'
        ? `(global):${request.resource.kind}`
        : `${scopeResolution.matchedScope}:${request.resource.kind}`;
      policies = this.scopedResourcePolicies.get(key) || [];
      scopedPolicyMatched = scopeResolution.matchedScope !== '(global)';
    } else {
      // Fall back to global resource policies (loaded via loadResourcePolicies)
      policies = this.resourcePolicies.get(request.resource.kind) || [];
    }

    // Create span for this check
    const span = createAuthzCheckSpan({ ...request, requestId }, parentSpan);

    try {
      const results: Record<string, ActionResult> = {};
      const policiesEvaluated: string[] = [];

      // Compute derived roles
      const derivedRolesSpan = createDerivedRolesSpan(span);
      const derivedRoles = this.computeDerivedRoles(request.principal, request.resource, request.auxData);
      recordDerivedRoles(derivedRolesSpan, derivedRoles);
      derivedRolesSpan.end();

      addSpanAttributes(span, {
        'authz.num_policies': policies.length,
        'authz.effective_scope': effectiveScope,
        'authz.scoped_policy_matched': scopedPolicyMatched,
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

      const scopeResolutionInfo: ScopeResolutionInfo = {
        effectiveScope,
        inheritanceChain,
        scopedPolicyMatched,
      };

      const response: ScopedCheckResponse = {
        requestId,
        results,
        meta: {
          evaluationDurationMs: Date.now() - startTime,
          policiesEvaluated,
        },
        scopeResolution: scopeResolutionInfo,
      };

      recordDecisionOutcome(span, response);
      span.end();

      // Log decision
      this.logDecision(request, response, requestId);

      return response;
    } catch (error) {
      setSpanError(span, error instanceof Error ? error : new Error(String(error)));
      span.end();
      throw error;
    }
  }

  /**
   * Get policies for a specific scope
   * If resourceKind is not specified, returns all policies for that scope
   */
  getPoliciesForScope(scope: string, resourceKind?: string): ValidatedResourcePolicy[] {
    if (resourceKind) {
      const key = `${scope}:${resourceKind}`;
      return this.scopedResourcePolicies.get(key) || [];
    }

    // Return all policies for the scope (any resource kind)
    const policies: ValidatedResourcePolicy[] = [];
    for (const [key, policyList] of this.scopedResourcePolicies.entries()) {
      if (key.startsWith(`${scope}:`)) {
        policies.push(...policyList);
      }
    }
    return policies;
  }

  /**
   * Get all registered scopes
   */
  getRegisteredScopes(): string[] {
    return this.scopeResolver.extractScopes(this.scopedResourcePolicies);
  }

  /**
   * Check authorization for a request
   *
   * Evaluation order:
   * 1. Evaluate principal policies first
   * 2. Evaluate resource policies
   * 3. Apply deny-override combining (ANY deny = deny)
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

      // Get resource policies for this resource
      const resourcePolicies = this.resourcePolicies.get(request.resource.kind) || [];
      addSpanAttributes(span, {
        'authz.num_resource_policies': resourcePolicies.length,
        'authz.num_principal_policies': this.principalPolicyEvaluator.getStats().totalPolicies,
      });

      // Evaluate each action
      for (const action of request.actions) {
        // Step 1: Evaluate principal policies first
        const singleActionRequest: CheckRequest = {
          ...request,
          actions: [action],
        };
        const principalResult = this.principalPolicyEvaluator.evaluate(singleActionRequest);

        // Step 2: Evaluate resource policies
        const resourceResult = this.evaluateAction(
          action,
          request.principal,
          request.resource,
          derivedRoles,
          resourcePolicies,
          request.auxData,
          span,
        );

        // Step 3: Apply deny-override combining
        // Explicit deny from ANY policy type = deny
        // Allow from ANY policy type = allow (unless explicitly denied)
        // Default: deny
        let finalResult: ActionResult;

        // Check if either policy explicitly denies
        const principalExplicitlyDenies = principalResult?.effect === 'deny';
        const resourceExplicitlyDenies =
          resourceResult.effect === 'deny' && resourceResult.policy !== 'default-deny';

        // Check if either policy allows
        const principalAllows = principalResult?.effect === 'allow';
        const resourceAllows = resourceResult.effect === 'allow';

        if (principalExplicitlyDenies) {
          // Principal policy explicitly denies
          finalResult = {
            effect: 'deny',
            policy: principalResult.policy,
            meta: {
              matchedRule: principalResult.rule,
              effectiveDerivedRoles: derivedRoles,
            },
          };
        } else if (resourceExplicitlyDenies) {
          // Resource policy explicitly denies
          finalResult = resourceResult;
        } else if (principalAllows) {
          // Principal policy allows (and no explicit deny)
          finalResult = {
            effect: 'allow',
            policy: principalResult.policy,
            meta: {
              matchedRule: principalResult.rule,
              effectiveDerivedRoles: derivedRoles,
            },
          };
        } else if (resourceAllows) {
          // Resource policy allows (and no explicit deny)
          finalResult = resourceResult;
        } else {
          // Default deny
          finalResult = resourceResult;
        }

        results[action] = finalResult;

        if (finalResult.policy && !policiesEvaluated.includes(finalResult.policy)) {
          policiesEvaluated.push(finalResult.policy);
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
    // Use the enhanced DerivedRolesResolver with support for:
    // - Wildcard parent roles (*, prefix:*, *:suffix)
    // - Circular dependency detection
    // - Per-request caching (cache parameter optional)
    // - Evaluation tracing (via resolveWithTrace)
    return this.derivedRolesResolver.resolve(principal, resource, auxData);
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
    principalPolicies: number;
    resources: string[];
  } {
    return {
      resourcePolicies: Array.from(this.resourcePolicies.values()).flat().length,
      derivedRolesPolicies: this.derivedRolesPolicies.length,
      principalPolicies: this.principalPolicyEvaluator.getStats().totalPolicies,
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
