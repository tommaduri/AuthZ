/**
 * Standard span definitions for authorization operations
 *
 * This module defines reusable span creation functions for common
 * authorization operations to ensure consistency across the codebase.
 */

import type { Span } from '@opentelemetry/api';
import { createSpan, createDecisionSpan, createEvaluationSpan, withSpan, withSpanSync } from './index.js';
import type { CheckRequest, CheckResponse } from '../types/index.js';

/**
 * Create span for authorization check operation
 *
 * Span name: authz.check
 * Attributes:
 * - authz.request_id: Request ID
 * - authz.principal_id: Principal ID
 * - authz.principal_roles: Principal roles (comma-separated)
 * - authz.resource_kind: Resource kind
 * - authz.resource_id: Resource ID
 * - authz.actions: Actions (comma-separated)
 */
export function createAuthzCheckSpan(request: CheckRequest, parentSpan?: Span): Span {
  const span = createDecisionSpan(
    'authz.check',
    request.requestId || 'unknown',
    request.principal.id,
    request.resource.kind,
    parentSpan,
  );

  span.setAttributes({
    'authz.principal_roles': request.principal.roles.join(','),
    'authz.resource_id': request.resource.id,
    'authz.actions': request.actions.join(','),
    'authz.num_actions': request.actions.length,
  });

  return span;
}

/**
 * Create span for CEL expression evaluation
 *
 * Span name: authz.cel_evaluate
 * Attributes:
 * - authz.expression_type: Type of CEL expression
 * - authz.expression_length: Length of expression
 */
export function createCelEvaluateSpan(
  expression: string,
  expressionType: string,
  parentSpan?: Span,
): Span {
  const span = createEvaluationSpan('authz.cel_evaluate', expression, expressionType, parentSpan);

  span.setAttributes({
    'authz.expression_type': expressionType,
  });

  return span;
}

/**
 * Create span for policy matching operation
 *
 * Span name: authz.policy_match
 * Attributes:
 * - authz.policy_name: Policy name
 * - authz.rule_name: Rule name (if matched)
 * - authz.num_rules_evaluated: Number of rules evaluated
 */
export function createPolicyMatchSpan(
  policyName: string,
  parentSpan?: Span,
): Span {
  return createSpan(
    'authz.policy_match',
    {
      'authz.policy_name': policyName,
      'span.kind': 'internal',
    },
    parentSpan,
  );
}

/**
 * Create span for derived roles computation
 *
 * Span name: authz.derived_roles
 * Attributes:
 * - authz.num_definitions: Number of role definitions
 * - authz.derived_roles: Discovered roles (comma-separated)
 */
export function createDerivedRolesSpan(parentSpan?: Span): Span {
  return createSpan(
    'authz.derived_roles',
    {
      'span.kind': 'internal',
    },
    parentSpan,
  );
}

/**
 * Execute an authorization check within a span
 */
export async function checkWithSpan<T>(
  request: CheckRequest,
  fn: (span: Span) => Promise<T>,
  parentSpan?: Span,
): Promise<T> {
  const span = createAuthzCheckSpan(request, parentSpan);

  return withSpan(
    'authz.check',
    async () => {
      try {
        const result = await fn(span);
        span.addEvent('check_completed', { 'authz.success': true });
        return result;
      } catch (error) {
        span.addEvent('check_failed', {
          'authz.error': error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    undefined,
    span,
  );
}

/**
 * Execute CEL evaluation within a span
 */
export function evaluateCelWithSpan<T>(
  expression: string,
  fn: (span: Span) => T,
  expressionType: string = 'condition',
  parentSpan?: Span,
): T {
  const span = createCelEvaluateSpan(expression, expressionType, parentSpan);

  return withSpanSync(
    'authz.cel_evaluate',
    () => {
      try {
        const result = fn(span);
        span.addEvent('evaluation_completed', { 'authz.success': true });
        return result;
      } catch (error) {
        span.addEvent('evaluation_failed', {
          'authz.error': error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    undefined,
    span,
  );
}

/**
 * Execute policy matching within a span
 */
export function matchPolicyWithSpan<T>(
  policyName: string,
  fn: (span: Span) => T,
  parentSpan?: Span,
): T {
  const span = createPolicyMatchSpan(policyName, parentSpan);

  return withSpanSync(
    'authz.policy_match',
    () => {
      try {
        const result = fn(span);
        span.addEvent('match_completed', { 'authz.success': true });
        return result;
      } catch (error) {
        span.addEvent('match_failed', {
          'authz.error': error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    undefined,
    span,
  );
}

/**
 * Record decision outcome in span
 */
export function recordDecisionOutcome(
  span: Span,
  response: CheckResponse,
): void {
  const allowedActions = Object.entries(response.results)
    .filter(([, result]) => result.effect === 'allow')
    .map(([action]) => action);

  const deniedActions = Object.entries(response.results)
    .filter(([, result]) => result.effect === 'deny')
    .map(([action]) => action);

  span.setAttributes({
    'authz.allowed_actions': allowedActions.join(','),
    'authz.denied_actions': deniedActions.join(','),
    'authz.num_allowed': allowedActions.length,
    'authz.num_denied': deniedActions.length,
    'authz.evaluation_duration_ms': response.meta?.evaluationDurationMs || 0,
  });
}

/**
 * Record policy match in span
 */
export function recordPolicyMatch(
  span: Span,
  policyName: string,
  ruleName?: string,
  matched: boolean = true,
): void {
  if (matched) {
    span.addEvent('policy_matched', {
      'authz.policy_name': policyName,
      'authz.rule_name': ruleName || 'unknown',
    });

    span.setAttributes({
      'authz.matched_policy': policyName,
      'authz.matched_rule': ruleName || 'unknown',
    });
  } else {
    span.addEvent('policy_not_matched', {
      'authz.policy_name': policyName,
    });
  }
}

/**
 * Record derived roles discovered in span
 */
export function recordDerivedRoles(span: Span, roles: string[]): void {
  span.setAttributes({
    'authz.discovered_roles': roles.join(','),
    'authz.num_derived_roles': roles.length,
  });
}

/**
 * Record CEL evaluation metrics
 */
export function recordCelEvaluationMetrics(
  span: Span,
  durationMs: number,
  result: unknown,
  success: boolean = true,
): void {
  span.setAttributes({
    'authz.evaluation_duration_ms': durationMs,
    'authz.evaluation_success': success,
    'authz.evaluation_result_type': typeof result,
  });
}
