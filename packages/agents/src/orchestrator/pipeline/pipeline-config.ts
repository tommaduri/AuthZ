/**
 * Pipeline Configuration - Defines agent execution order and modes
 *
 * Supports:
 * - Custom agent execution order
 * - Conditional agent execution
 * - Parallel vs sequential modes
 */

import type { AgentType, Priority } from '../../types/agent.types.js';

/**
 * Execution mode for the pipeline
 */
export type PipelineExecutionMode = 'sequential' | 'parallel' | 'adaptive';

/**
 * Condition types for conditional execution
 */
export type ConditionOperator = 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'contains' | 'matches';

/**
 * Condition for agent execution
 */
export interface AgentCondition {
  /** Field path in the context to evaluate (e.g., 'request.principal.roles') */
  field: string;
  /** Comparison operator */
  operator: ConditionOperator;
  /** Value to compare against */
  value: unknown;
  /** Negate the condition */
  negate?: boolean;
}

/**
 * Combined condition with logical operators
 */
export interface ConditionalExpression {
  /** Logical operator for combining conditions */
  type: 'and' | 'or' | 'not';
  /** Child conditions */
  conditions: Array<AgentCondition | ConditionalExpression>;
}

/**
 * Pipeline step configuration
 */
export interface PipelineStep {
  /** Agent type to execute */
  agent: AgentType;
  /** Custom name for this step */
  name?: string;
  /** Whether this step is required or optional */
  required: boolean;
  /** Execution timeout in milliseconds */
  timeoutMs?: number;
  /** Conditions that must be met for this step to execute */
  conditions?: AgentCondition | ConditionalExpression;
  /** Steps that must complete before this one (for parallel mode) */
  dependsOn?: string[];
  /** Priority for this step (affects ordering in adaptive mode) */
  priority?: Priority;
  /** Whether to continue pipeline if this step fails */
  continueOnError?: boolean;
  /** Custom configuration overrides for this agent */
  configOverrides?: Record<string, unknown>;
}

/**
 * Pipeline configuration
 */
export interface PipelineConfig {
  /** Unique identifier for this pipeline */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this pipeline does */
  description?: string;
  /** Execution mode */
  mode: PipelineExecutionMode;
  /** Ordered list of pipeline steps */
  steps: PipelineStep[];
  /** Default timeout for all steps (can be overridden per step) */
  defaultTimeoutMs?: number;
  /** Whether to fail fast on first error */
  failFast?: boolean;
  /** Maximum retries for failed steps */
  maxRetries?: number;
  /** Delay between retries in milliseconds */
  retryDelayMs?: number;
  /** Version for tracking changes */
  version?: string;
  /** Tags for categorization */
  tags?: string[];
}

/**
 * Context passed through the pipeline
 */
export interface PipelineContext {
  /** Request ID for correlation */
  requestId: string;
  /** Start time of pipeline execution */
  startTime: number;
  /** Accumulated results from each step */
  stepResults: Map<string, StepResult>;
  /** Original request data */
  request: unknown;
  /** Original response data */
  response: unknown;
  /** Additional context data */
  metadata: Record<string, unknown>;
  /** Feature flags for this execution */
  featureFlags: Record<string, boolean>;
  /** A/B test variant if applicable */
  abTestVariant?: string;
}

/**
 * Result from a single pipeline step
 */
export interface StepResult {
  /** Step name */
  stepName: string;
  /** Agent type that executed */
  agentType: AgentType;
  /** Whether step completed successfully */
  success: boolean;
  /** Duration in milliseconds */
  durationMs: number;
  /** Result data from the step */
  data?: unknown;
  /** Error if step failed */
  error?: Error;
  /** Whether step was skipped due to conditions */
  skipped?: boolean;
  /** Reason for skipping */
  skipReason?: string;
  /** Retry count if step was retried */
  retryCount?: number;
}

/**
 * Pipeline execution result
 */
export interface PipelineResult {
  /** Pipeline ID */
  pipelineId: string;
  /** Request ID */
  requestId: string;
  /** Overall success status */
  success: boolean;
  /** Total execution time in milliseconds */
  totalDurationMs: number;
  /** Individual step results */
  steps: StepResult[];
  /** Final aggregated result */
  result?: unknown;
  /** Error if pipeline failed */
  error?: Error;
  /** Execution metadata */
  metadata: {
    mode: PipelineExecutionMode;
    stepsExecuted: number;
    stepsSkipped: number;
    stepsFailed: number;
    totalRetries: number;
  };
}

/**
 * Pre-defined pipeline configurations
 */
export const DEFAULT_PIPELINES: Record<string, PipelineConfig> = {
  standard: {
    id: 'standard',
    name: 'Standard Authorization Pipeline',
    description: 'Default sequential pipeline: Enforcer -> Guardian -> Analyst (record) -> Advisor (optional)',
    mode: 'sequential',
    steps: [
      { agent: 'enforcer', name: 'enforcement-check', required: true, timeoutMs: 100 },
      { agent: 'guardian', name: 'anomaly-analysis', required: true, timeoutMs: 500 },
      { agent: 'analyst', name: 'decision-recording', required: false, continueOnError: true, timeoutMs: 1000 },
      {
        agent: 'advisor',
        name: 'explanation-generation',
        required: false,
        conditions: { field: 'options.includeExplanation', operator: 'eq', value: true },
        timeoutMs: 2000
      },
    ],
    defaultTimeoutMs: 5000,
    failFast: true,
  },

  highSecurity: {
    id: 'high-security',
    name: 'High Security Pipeline',
    description: 'Enhanced pipeline with all agents mandatory',
    mode: 'sequential',
    steps: [
      { agent: 'enforcer', name: 'enforcement-check', required: true, timeoutMs: 100 },
      { agent: 'guardian', name: 'anomaly-analysis', required: true, timeoutMs: 1000, priority: 'critical' },
      { agent: 'analyst', name: 'pattern-analysis', required: true, timeoutMs: 2000 },
      { agent: 'advisor', name: 'explanation-generation', required: true, timeoutMs: 3000 },
    ],
    defaultTimeoutMs: 10000,
    failFast: true,
    maxRetries: 2,
    retryDelayMs: 100,
  },

  performance: {
    id: 'performance',
    name: 'Performance-Optimized Pipeline',
    description: 'Parallel execution for low-latency scenarios',
    mode: 'parallel',
    steps: [
      { agent: 'enforcer', name: 'enforcement-check', required: true, timeoutMs: 50 },
      { agent: 'guardian', name: 'anomaly-analysis', required: true, timeoutMs: 200, dependsOn: ['enforcement-check'] },
      { agent: 'analyst', name: 'async-recording', required: false, continueOnError: true, dependsOn: ['enforcement-check'] },
    ],
    defaultTimeoutMs: 500,
    failFast: false,
  },

  adaptive: {
    id: 'adaptive',
    name: 'Adaptive Pipeline',
    description: 'Adjusts execution based on request characteristics',
    mode: 'adaptive',
    steps: [
      { agent: 'enforcer', name: 'enforcement-check', required: true, priority: 'critical' },
      { agent: 'guardian', name: 'anomaly-analysis', required: true, priority: 'high' },
      {
        agent: 'analyst',
        name: 'deep-analysis',
        required: false,
        priority: 'medium',
        conditions: {
          type: 'or',
          conditions: [
            { field: 'anomalyScore', operator: 'gt', value: 0.5 },
            { field: 'request.principal.roles', operator: 'contains', value: 'admin' },
          ],
        },
      },
      { agent: 'advisor', name: 'explanation', required: false, priority: 'low' },
    ],
    defaultTimeoutMs: 5000,
    failFast: false,
  },
};

/**
 * Evaluate a condition against a context
 */
export function evaluateCondition(
  condition: AgentCondition | ConditionalExpression,
  context: Record<string, unknown>
): boolean {
  if ('type' in condition) {
    // This is a ConditionalExpression
    const results = condition.conditions.map(c => evaluateCondition(c, context));

    switch (condition.type) {
      case 'and':
        return results.every(r => r);
      case 'or':
        return results.some(r => r);
      case 'not':
        return !results[0];
      default:
        return false;
    }
  }

  // This is an AgentCondition
  const value = getNestedValue(context, condition.field);
  let result = false;

  switch (condition.operator) {
    case 'eq':
      result = value === condition.value;
      break;
    case 'ne':
      result = value !== condition.value;
      break;
    case 'gt':
      result = typeof value === 'number' && typeof condition.value === 'number' && value > condition.value;
      break;
    case 'lt':
      result = typeof value === 'number' && typeof condition.value === 'number' && value < condition.value;
      break;
    case 'gte':
      result = typeof value === 'number' && typeof condition.value === 'number' && value >= condition.value;
      break;
    case 'lte':
      result = typeof value === 'number' && typeof condition.value === 'number' && value <= condition.value;
      break;
    case 'in':
      result = Array.isArray(condition.value) && condition.value.includes(value);
      break;
    case 'contains':
      result = Array.isArray(value) && value.includes(condition.value);
      break;
    case 'matches':
      result = typeof value === 'string' && typeof condition.value === 'string' && new RegExp(condition.value).test(value);
      break;
  }

  return condition.negate ? !result : result;
}

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((current: unknown, key) => {
    if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}
