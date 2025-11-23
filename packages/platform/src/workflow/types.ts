/**
 * Workflow Engine Types
 *
 * Defines workflow definitions and execution types for complex
 * authorization workflows involving multiple agents and decision steps.
 */

import type { AgentType, Priority } from '@authz-engine/agents';
import type { CheckRequest, CheckResponse } from '@authz-engine/core';

// =============================================================================
// Workflow Definition Types
// =============================================================================

export type WorkflowStepType =
  | 'agent_task'      // Execute a task on a specific agent
  | 'parallel_tasks'  // Execute multiple tasks in parallel
  | 'conditional'     // Conditional branching
  | 'consensus'       // Require consensus from multiple agents
  | 'transform'       // Transform data between steps
  | 'wait'            // Wait for external event or timeout
  | 'retry'           // Retry logic wrapper
  | 'notify';         // Send notification/event

export type WorkflowStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export type WorkflowConditionOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'not_in'
  | 'contains'
  | 'matches'
  | 'exists';

// =============================================================================
// Workflow Condition
// =============================================================================

export interface WorkflowCondition {
  /** Field path to evaluate (dot notation, e.g., 'result.anomalyScore') */
  field: string;

  /** Comparison operator */
  operator: WorkflowConditionOperator;

  /** Value to compare against */
  value: unknown;

  /** Optional: AND conditions */
  and?: WorkflowCondition[];

  /** Optional: OR conditions */
  or?: WorkflowCondition[];
}

// =============================================================================
// Workflow Step Definition
// =============================================================================

export interface WorkflowStepBase {
  /** Unique step identifier */
  id: string;

  /** Step type */
  type: WorkflowStepType;

  /** Human-readable name */
  name: string;

  /** Optional description */
  description?: string;

  /** Conditions that must be met to execute this step */
  conditions?: WorkflowCondition[];

  /** Next step ID (null for terminal steps) */
  next: string | null;

  /** Alternative next step on failure */
  onFailure?: string | null;

  /** Timeout for this step in milliseconds */
  timeoutMs?: number;

  /** Retry configuration */
  retry?: {
    maxAttempts: number;
    backoffMs: number;
    backoffMultiplier?: number;
  };
}

export interface AgentTaskStep extends WorkflowStepBase {
  type: 'agent_task';
  agent: AgentType;
  action: string;
  input: unknown;
  outputMapping?: Record<string, string>;  // Map output fields to context
}

export interface ParallelTasksStep extends WorkflowStepBase {
  type: 'parallel_tasks';
  tasks: Array<{
    agent: AgentType;
    action: string;
    input: unknown;
  }>;
  aggregation: 'all' | 'any' | 'majority';
}

export interface ConditionalStep extends WorkflowStepBase {
  type: 'conditional';
  condition: WorkflowCondition;
  onTrue: string;   // Step ID if condition is true
  onFalse: string;  // Step ID if condition is false
}

export interface ConsensusStep extends WorkflowStepBase {
  type: 'consensus';
  agents: AgentType[];
  proposal: unknown;
  threshold: number;  // 0-1, percentage of agents that must agree
  protocol: 'pbft' | 'raft' | 'simple_majority';
}

export interface TransformStep extends WorkflowStepBase {
  type: 'transform';
  transformations: Array<{
    source: string;      // Source field path
    target: string;      // Target field path
    transform?: string;  // Optional: transformation expression
  }>;
}

export interface WaitStep extends WorkflowStepBase {
  type: 'wait';
  waitFor: 'timeout' | 'event' | 'condition';
  timeoutMs?: number;
  eventType?: string;
  condition?: WorkflowCondition;
}

export interface RetryStep extends WorkflowStepBase {
  type: 'retry';
  stepToRetry: string;
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier?: number;
}

export interface NotifyStep extends WorkflowStepBase {
  type: 'notify';
  channel: 'event' | 'webhook' | 'log';
  payload: unknown;
  target?: string;  // webhook URL or event topic
}

export type WorkflowStep =
  | AgentTaskStep
  | ParallelTasksStep
  | ConditionalStep
  | ConsensusStep
  | TransformStep
  | WaitStep
  | RetryStep
  | NotifyStep;

// =============================================================================
// Workflow Definition
// =============================================================================

export interface WorkflowDefinition {
  /** Unique workflow identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Version for tracking changes */
  version: string;

  /** Description */
  description?: string;

  /** Workflow steps */
  steps: WorkflowStep[];

  /** Entry step ID */
  entryStep: string;

  /** Input schema (for validation) */
  inputSchema?: Record<string, unknown>;

  /** Output schema */
  outputSchema?: Record<string, unknown>;

  /** Global timeout for entire workflow */
  timeoutMs?: number;

  /** Priority level */
  priority?: Priority;

  /** Metadata */
  metadata?: Record<string, unknown>;

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;
}

// =============================================================================
// Workflow Execution Types
// =============================================================================

export interface WorkflowStepResult {
  stepId: string;
  status: 'completed' | 'failed' | 'skipped' | 'timeout';
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  output?: unknown;
  error?: string;
  retryCount?: number;
}

export interface WorkflowExecution {
  /** Unique execution ID */
  executionId: string;

  /** Workflow definition ID */
  workflowId: string;

  /** Current status */
  status: WorkflowStatus;

  /** Current step being executed */
  currentStepId: string | null;

  /** Input provided to workflow */
  input: unknown;

  /** Current context (accumulated data) */
  context: Record<string, unknown>;

  /** Results from each step */
  stepResults: WorkflowStepResult[];

  /** Final output (when completed) */
  output?: unknown;

  /** Error information (if failed) */
  error?: {
    stepId: string;
    message: string;
    code?: string;
    details?: unknown;
  };

  /** Execution timing */
  startedAt: Date;
  completedAt?: Date;
  totalDurationMs?: number;

  /** Correlation ID for tracing */
  correlationId?: string;
}

// =============================================================================
// Authorization Workflow Types
// =============================================================================

export interface AuthorizationWorkflowInput {
  request: CheckRequest;
  includeExplanation?: boolean;
  requireConsensus?: boolean;
  priority?: Priority;
}

export interface AuthorizationWorkflowOutput {
  response: CheckResponse;
  anomalyScore: number;
  riskLevel: Priority;
  consensusReached?: boolean;
  explanation?: string;
  agentsInvolved: AgentType[];
  processingTimeMs: number;
}

// =============================================================================
// Workflow Engine Interface
// =============================================================================

export interface IWorkflowEngine {
  /** Register a workflow definition */
  registerWorkflow(definition: WorkflowDefinition): Promise<void>;

  /** Get a registered workflow */
  getWorkflow(workflowId: string): WorkflowDefinition | undefined;

  /** List all registered workflows */
  listWorkflows(): WorkflowDefinition[];

  /** Execute a workflow */
  executeWorkflow(
    workflowId: string,
    input: unknown,
    options?: {
      correlationId?: string;
      priority?: Priority;
      timeoutMs?: number;
    }
  ): Promise<WorkflowExecution>;

  /** Get execution status */
  getExecution(executionId: string): WorkflowExecution | undefined;

  /** Pause a running execution */
  pauseExecution(executionId: string): Promise<void>;

  /** Resume a paused execution */
  resumeExecution(executionId: string): Promise<void>;

  /** Cancel an execution */
  cancelExecution(executionId: string): Promise<void>;

  /** List executions with optional filters */
  listExecutions(filters?: {
    workflowId?: string;
    status?: WorkflowStatus;
    limit?: number;
    offset?: number;
  }): WorkflowExecution[];
}

// =============================================================================
// Built-in Workflow Templates
// =============================================================================

export const WORKFLOW_TEMPLATES = {
  /** Standard authorization check workflow */
  STANDARD_CHECK: 'standard-authorization-check',

  /** High-risk authorization with consensus */
  HIGH_RISK_CHECK: 'high-risk-authorization-check',

  /** Batch authorization workflow */
  BATCH_CHECK: 'batch-authorization-check',

  /** Anomaly investigation workflow */
  ANOMALY_INVESTIGATION: 'anomaly-investigation',

  /** Policy audit workflow */
  POLICY_AUDIT: 'policy-audit',
} as const;

export type WorkflowTemplate = typeof WORKFLOW_TEMPLATES[keyof typeof WORKFLOW_TEMPLATES];
