/**
 * Principal Policy Module
 *
 * Exports principal policy evaluation components including:
 * - PrincipalMatcher: Pattern matching for principal identifiers
 * - PrincipalPolicyEvaluator: Evaluates principal-specific policies
 * - Types: TypeScript interfaces for principal policies
 */

// Main classes
export { PrincipalMatcher } from './principal-matcher';
export { PrincipalPolicyEvaluator } from './principal-policy-evaluator';

// Types
export type {
  IPrincipalMatcher,
  PrincipalMatchResult,
  PrincipalPolicyResult,
  PrincipalPolicyStats,
  PrincipalPolicyEvaluatorConfig,
  OutputExpression,
  EnhancedPrincipalActionRule,
  EnhancedPrincipalRule,
  PolicyVariable,
  PolicyVariables,
} from './types';
