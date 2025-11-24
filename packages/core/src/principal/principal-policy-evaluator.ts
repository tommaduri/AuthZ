/**
 * Principal Policy Evaluator
 *
 * Evaluates principal-specific authorization policies against requests.
 * Supports pattern matching, conditions, and multiple resource rules.
 */

import type { CelEvaluator, EvaluationContext } from '../cel/evaluator';
import type { CheckRequest } from '../types';
import type { ValidatedPrincipalPolicy } from '../policy/schema';
import type {
  PrincipalPolicyResult,
  PrincipalPolicyStats,
  PrincipalPolicyEvaluatorConfig,
} from './types';
import { PrincipalMatcher } from './principal-matcher';
import { matchesActionPattern } from '../utils/pattern-matching';

/**
 * Principal Policy Evaluator
 *
 * Evaluates authorization requests against principal-specific policies.
 * Principal policies define permissions for specific users or user patterns.
 *
 * Features:
 * - Exact principal ID matching
 * - Wildcard pattern matching (*, prefix-*, *@domain)
 * - CEL condition evaluation
 * - Multiple resource rules per policy
 * - Deny-override combining algorithm
 *
 * @example
 * ```typescript
 * const evaluator = new PrincipalPolicyEvaluator({ celEvaluator });
 *
 * evaluator.loadPolicies([{
 *   apiVersion: 'authz.engine/v1',
 *   kind: 'PrincipalPolicy',
 *   metadata: { name: 'john-policy' },
 *   spec: {
 *     principal: 'john@example.com',
 *     version: '1.0',
 *     rules: [{
 *       resource: 'expense',
 *       actions: [{ action: 'view', effect: 'allow' }]
 *     }]
 *   }
 * }]);
 *
 * const result = evaluator.evaluate(request);
 * ```
 */
export class PrincipalPolicyEvaluator {
  private readonly celEvaluator: CelEvaluator;
  private readonly principalMatcher: PrincipalMatcher;
  private policies: ValidatedPrincipalPolicy[] = [];
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(config: { celEvaluator: CelEvaluator } & PrincipalPolicyEvaluatorConfig) {
    this.celEvaluator = config.celEvaluator;
    this.principalMatcher = new PrincipalMatcher({
      maxCacheSize: config.cacheConfig?.maxSize ?? 1000,
    });
  }

  /**
   * Load principal policies into the evaluator.
   *
   * @param policies - Array of validated principal policies to load
   */
  loadPolicies(policies: ValidatedPrincipalPolicy[]): void {
    this.policies.push(...policies);
  }

  /**
   * Clear all loaded policies.
   */
  clearPolicies(): void {
    this.policies = [];
    this.principalMatcher.clearCache();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Find all policies that match a principal ID.
   *
   * @param principalId - The principal ID to match
   * @param version - Optional version filter
   * @returns Array of matching policies
   */
  findPolicies(principalId: string, version?: string): ValidatedPrincipalPolicy[] {
    return this.policies.filter((policy) => {
      // Check principal pattern match
      const principalMatches = this.principalMatcher.matchPattern(
        policy.spec.principal,
        principalId
      );

      if (!principalMatches) {
        return false;
      }

      // Check version if specified
      if (version && policy.spec.version !== version) {
        return false;
      }

      return true;
    });
  }

  /**
   * Evaluate a request against loaded principal policies.
   *
   * Returns the first matching rule result, applying deny-override combining.
   * If multiple policies match:
   * - ANY deny -> result is deny
   * - ALL allow -> result is allow
   * - No match -> returns null
   *
   * @param request - The authorization check request
   * @returns Evaluation result or null if no policy matches
   */
  evaluate(request: CheckRequest): PrincipalPolicyResult | null {
    const principalId = request.principal.id;
    const resourceKind = request.resource.kind;
    const action = request.actions[0]; // Evaluate first action

    // Find matching policies
    const matchingPolicies = this.findPolicies(principalId);

    if (matchingPolicies.length === 0) {
      return null;
    }

    let allowResult: PrincipalPolicyResult | null = null;

    // Evaluate each matching policy
    for (const policy of matchingPolicies) {
      const result = this.evaluatePolicy(policy, request, resourceKind, action);

      if (result) {
        // Deny-override: any deny takes precedence
        if (result.effect === 'deny') {
          return result;
        }

        // Record allow result (may be overridden by later deny)
        if (result.effect === 'allow' && !allowResult) {
          allowResult = result;
        }
      }
    }

    return allowResult;
  }

  /**
   * Evaluate a single policy against a request.
   *
   * @param policy - The policy to evaluate
   * @param request - The authorization request
   * @param resourceKind - The resource kind being accessed
   * @param action - The action being performed
   * @returns Evaluation result or null if no rule matches
   */
  private evaluatePolicy(
    policy: ValidatedPrincipalPolicy,
    request: CheckRequest,
    resourceKind: string,
    action: string
  ): PrincipalPolicyResult | null {
    // Find matching resource rules
    for (const rule of policy.spec.rules) {
      // Check resource match (support wildcards)
      if (!this.matchResource(rule.resource, resourceKind)) {
        continue;
      }

      // Find matching action rule
      for (const actionRule of rule.actions) {
        // Check action match (support wildcards)
        if (!matchesActionPattern(actionRule.action, action)) {
          continue;
        }

        // Evaluate condition if present
        if (actionRule.condition) {
          const context: EvaluationContext = {
            principal: request.principal,
            resource: request.resource,
            auxData: request.auxData,
          };

          const conditionMet = this.celEvaluator.evaluateBoolean(
            actionRule.condition.expression,
            context
          );

          if (!conditionMet) {
            continue;
          }
        }

        // Rule matched!
        return {
          effect: actionRule.effect,
          policy: policy.metadata.name,
          rule: actionRule.name,
          matchedPattern: policy.spec.principal,
          resource: rule.resource,
          action: actionRule.action,
        };
      }
    }

    return null;
  }

  /**
   * Match a resource kind against a pattern.
   *
   * @param pattern - Resource pattern (may include wildcards)
   * @param resourceKind - The resource kind to match
   * @returns true if the resource matches the pattern
   */
  private matchResource(pattern: string, resourceKind: string): boolean {
    // Universal wildcard
    if (pattern === '*') {
      return true;
    }

    // Use principal matcher for pattern matching
    return this.principalMatcher.matchPattern(pattern, resourceKind);
  }

  /**
   * Get statistics about the evaluator state.
   *
   * @returns Evaluator statistics
   */
  getStats(): PrincipalPolicyStats {
    const uniquePrincipals = new Set(this.policies.map((p) => p.spec.principal)).size;
    const total = this.cacheHits + this.cacheMisses;

    return {
      totalPolicies: this.policies.length,
      uniquePrincipals,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRate: total > 0 ? (this.cacheHits / total) * 100 : 0,
    };
  }
}
