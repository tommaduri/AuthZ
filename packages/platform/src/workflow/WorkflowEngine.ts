/**
 * Workflow Engine
 *
 * Executes complex multi-step authorization workflows involving
 * multiple agents, conditional logic, and parallel execution.
 */

import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowExecution,
  WorkflowStepResult,
  WorkflowStatus,
  WorkflowCondition,
  IWorkflowEngine,
  AgentTaskStep,
  ConditionalStep,
  ParallelTasksStep,
} from './types.js';
import type { Priority } from '@authz-engine/agents';

/**
 * Workflow Engine for executing authorization workflows
 */
export class WorkflowEngine implements IWorkflowEngine {
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private executions: Map<string, WorkflowExecution> = new Map();

  /**
   * Register a workflow definition
   */
  async registerWorkflow(definition: WorkflowDefinition): Promise<void> {
    // Validate the workflow
    this.validateWorkflow(definition);

    // Store it
    this.workflows.set(definition.id, {
      ...definition,
      updatedAt: new Date(),
    });
  }

  /**
   * Get a registered workflow
   */
  getWorkflow(workflowId: string): WorkflowDefinition | undefined {
    return this.workflows.get(workflowId);
  }

  /**
   * List all registered workflows
   */
  listWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(
    workflowId: string,
    input: unknown,
    options?: {
      correlationId?: string;
      priority?: Priority;
      timeoutMs?: number;
    }
  ): Promise<WorkflowExecution> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const executionId = this.generateExecutionId();
    const execution: WorkflowExecution = {
      executionId,
      workflowId,
      status: 'running',
      currentStepId: workflow.entryStep,
      input,
      context: {},
      stepResults: [],
      startedAt: new Date(),
      correlationId: options?.correlationId,
    };

    this.executions.set(executionId, execution);

    try {
      // Execute the workflow
      await this.executeSteps(execution, workflow, options?.timeoutMs || workflow.timeoutMs);

      execution.status = 'completed';
      execution.completedAt = new Date();
      execution.totalDurationMs = execution.completedAt.getTime() - execution.startedAt.getTime();
    } catch (error) {
      execution.status = 'failed';
      execution.completedAt = new Date();
      execution.totalDurationMs = execution.completedAt.getTime() - execution.startedAt.getTime();
      execution.error = {
        stepId: execution.currentStepId || 'unknown',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    // Update stored execution
    this.executions.set(executionId, execution);

    return execution;
  }

  /**
   * Get execution by ID
   */
  getExecution(executionId: string): WorkflowExecution | undefined {
    return this.executions.get(executionId);
  }

  /**
   * Pause a running execution
   */
  async pauseExecution(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }
    if (execution.status === 'running') {
      execution.status = 'paused';
    }
  }

  /**
   * Resume a paused execution
   */
  async resumeExecution(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }
    if (execution.status === 'paused') {
      execution.status = 'running';
      // Continue execution from current step
    }
  }

  /**
   * Cancel an execution
   */
  async cancelExecution(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }
    if (execution.status === 'running' || execution.status === 'paused') {
      execution.status = 'cancelled';
      execution.completedAt = new Date();
      execution.totalDurationMs = execution.completedAt.getTime() - execution.startedAt.getTime();
    }
  }

  /**
   * List executions with optional filters
   */
  listExecutions(filters?: {
    workflowId?: string;
    status?: WorkflowStatus;
    limit?: number;
    offset?: number;
  }): WorkflowExecution[] {
    let executions = Array.from(this.executions.values());

    // Apply filters
    if (filters?.workflowId) {
      executions = executions.filter(e => e.workflowId === filters.workflowId);
    }
    if (filters?.status) {
      executions = executions.filter(e => e.status === filters.status);
    }

    // Apply pagination
    const offset = filters?.offset || 0;
    const limit = filters?.limit || 100;
    return executions.slice(offset, offset + limit);
  }

  // ===========================================================================
  // Private Methods - Validation
  // ===========================================================================

  private validateWorkflow(definition: WorkflowDefinition): void {
    // Check entry step exists
    const stepIds = new Set(definition.steps.map(s => s.id));
    if (!stepIds.has(definition.entryStep)) {
      throw new Error(`Entry step '${definition.entryStep}' not found in workflow steps`);
    }

    // Check for circular dependencies
    if (this.hasCircularDependency(definition)) {
      throw new Error('Workflow contains circular dependencies');
    }

    // Validate step references
    for (const step of definition.steps) {
      if (step.next && !stepIds.has(step.next)) {
        throw new Error(`Step '${step.id}' references non-existent next step '${step.next}'`);
      }
      if (step.onFailure && !stepIds.has(step.onFailure)) {
        throw new Error(`Step '${step.id}' references non-existent failure step '${step.onFailure}'`);
      }

      // Validate conditional steps
      if (step.type === 'conditional') {
        const condStep = step as ConditionalStep;
        if (!stepIds.has(condStep.onTrue)) {
          throw new Error(`Conditional step '${step.id}' references non-existent onTrue step`);
        }
        if (!stepIds.has(condStep.onFalse)) {
          throw new Error(`Conditional step '${step.id}' references non-existent onFalse step`);
        }
      }
    }
  }

  private hasCircularDependency(definition: WorkflowDefinition): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const stepMap = new Map(definition.steps.map(s => [s.id, s]));

    const dfs = (stepId: string): boolean => {
      visited.add(stepId);
      recursionStack.add(stepId);

      const step = stepMap.get(stepId);
      if (!step) return false;

      const nextSteps: string[] = [];
      if (step.next) nextSteps.push(step.next);
      if (step.onFailure) nextSteps.push(step.onFailure);
      if (step.type === 'conditional') {
        const condStep = step as ConditionalStep;
        nextSteps.push(condStep.onTrue, condStep.onFalse);
      }

      for (const nextId of nextSteps) {
        if (!visited.has(nextId)) {
          if (dfs(nextId)) return true;
        } else if (recursionStack.has(nextId)) {
          return true;
        }
      }

      recursionStack.delete(stepId);
      return false;
    };

    return dfs(definition.entryStep);
  }

  // ===========================================================================
  // Private Methods - Execution
  // ===========================================================================

  private async executeSteps(
    execution: WorkflowExecution,
    workflow: WorkflowDefinition,
    timeoutMs?: number
  ): Promise<void> {
    const stepMap = new Map(workflow.steps.map(s => [s.id, s]));
    let currentStepId: string | null = workflow.entryStep;
    const startTime = Date.now();

    while (currentStepId) {
      // Check timeout
      if (timeoutMs && Date.now() - startTime > timeoutMs) {
        execution.status = 'timeout';
        return;
      }

      // Check if paused or cancelled
      if (execution.status === 'paused' || execution.status === 'cancelled') {
        return;
      }

      const step = stepMap.get(currentStepId);
      if (!step) {
        throw new Error(`Step not found: ${currentStepId}`);
      }

      execution.currentStepId = currentStepId;

      // Execute the step
      const result = await this.executeStep(step, execution, workflow);
      execution.stepResults.push(result);

      // Determine next step
      if (result.status === 'failed' && step.onFailure) {
        currentStepId = step.onFailure;
      } else if (step.type === 'conditional') {
        currentStepId = result.output as string; // Next step determined by condition
      } else {
        currentStepId = step.next;
      }
    }

    execution.currentStepId = null;
  }

  private async executeStep(
    step: WorkflowStep,
    execution: WorkflowExecution,
    workflow: WorkflowDefinition
  ): Promise<WorkflowStepResult> {
    const startedAt = new Date();

    try {
      // Check step conditions
      if (step.conditions && !this.evaluateConditions(step.conditions, execution.context)) {
        return {
          stepId: step.id,
          status: 'skipped',
          startedAt,
          completedAt: new Date(),
          durationMs: 0,
        };
      }

      // Execute based on step type
      let output: unknown;

      switch (step.type) {
        case 'agent_task':
          output = await this.executeAgentTask(step as AgentTaskStep, execution);
          break;
        case 'parallel_tasks':
          output = await this.executeParallelTasks(step as ParallelTasksStep, execution);
          break;
        case 'conditional':
          output = this.evaluateConditional(step as ConditionalStep, execution);
          break;
        case 'consensus':
          output = await this.executeConsensus(step, execution);
          break;
        case 'transform':
          output = this.executeTransform(step, execution);
          break;
        case 'wait':
          output = await this.executeWait(step, execution);
          break;
        case 'notify':
          output = await this.executeNotify(step, execution);
          break;
        default:
          output = null;
      }

      const completedAt = new Date();
      return {
        stepId: step.id,
        status: 'completed',
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        output,
      };
    } catch (error) {
      // Handle retry logic
      if (step.retry && step.retry.maxAttempts > 0) {
        return this.executeWithRetry(step, execution, workflow);
      }

      const completedAt = new Date();
      return {
        stepId: step.id,
        status: 'failed',
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async executeAgentTask(
    step: AgentTaskStep,
    workflowExecution: WorkflowExecution
  ): Promise<unknown> {
    // TODO: Integrate with actual agent orchestrator
    // For now, simulate agent task execution

    // Simulate processing time
    await this.delay(10);

    // Simulate output based on agent type
    const output: Record<string, unknown> = {
      agent: step.agent,
      action: step.action,
      success: true,
      anomalyScore: step.agent === 'guardian' ? 0.3 : undefined,
    };

    // Apply output mapping to context
    if (step.outputMapping) {
      for (const [source, target] of Object.entries(step.outputMapping)) {
        const value = this.getNestedValue(output, source);
        this.setNestedValue(workflowExecution.context, target, value);
      }
    }

    return output;
  }

  private async executeParallelTasks(
    step: ParallelTasksStep,
    execution: WorkflowExecution
  ): Promise<unknown[]> {
    // Execute all tasks in parallel
    const results = await Promise.all(
      step.tasks.map(async task => {
        // Simulate task execution
        await this.delay(10);
        return {
          agent: task.agent,
          action: task.action,
          success: true,
        };
      })
    );

    // Aggregate based on strategy
    switch (step.aggregation) {
      case 'all':
        // All must succeed
        if (!results.every(r => r.success)) {
          throw new Error('Not all parallel tasks succeeded');
        }
        break;
      case 'any':
        // At least one must succeed
        if (!results.some(r => r.success)) {
          throw new Error('No parallel tasks succeeded');
        }
        break;
      case 'majority':
        // More than half must succeed
        const successCount = results.filter(r => r.success).length;
        if (successCount <= results.length / 2) {
          throw new Error('Majority of parallel tasks did not succeed');
        }
        break;
    }

    return results;
  }

  private evaluateConditional(
    step: ConditionalStep,
    execution: WorkflowExecution
  ): string {
    const conditionMet = this.evaluateCondition(step.condition, execution.context);
    return conditionMet ? step.onTrue : step.onFalse;
  }

  private async executeConsensus(
    _step: WorkflowStep,
    _workflowExecution: WorkflowExecution
  ): Promise<unknown> {
    // TODO: Integrate with actual consensus manager
    await this.delay(10);
    return { consensusReached: true };
  }

  private executeTransform(
    _step: WorkflowStep,
    _workflowExecution: WorkflowExecution
  ): unknown {
    // Apply transformations to context
    return { transformed: true };
  }

  private async executeWait(
    _step: WorkflowStep,
    _workflowExecution: WorkflowExecution
  ): Promise<unknown> {
    // Simulate wait
    await this.delay(10);
    return { waited: true };
  }

  private async executeNotify(
    _step: WorkflowStep,
    _workflowExecution: WorkflowExecution
  ): Promise<unknown> {
    // Simulate notification
    return { notified: true };
  }

  private async executeWithRetry(
    step: WorkflowStep,
    execution: WorkflowExecution,
    workflow: WorkflowDefinition
  ): Promise<WorkflowStepResult> {
    const startedAt = new Date();
    const retry = step.retry!;
    let lastError: string = '';
    let attempts = 0;

    for (let i = 0; i < retry.maxAttempts; i++) {
      attempts++;
      try {
        const result = await this.executeStep(
          { ...step, retry: undefined }, // Remove retry to avoid infinite loop
          execution,
          workflow
        );
        if (result.status === 'completed') {
          return { ...result, retryCount: attempts };
        }
        lastError = result.error || 'Unknown error';
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
      }

      // Wait before retry with backoff
      const delay = retry.backoffMs * Math.pow(retry.backoffMultiplier || 1, i);
      await this.delay(delay);
    }

    const completedAt = new Date();
    return {
      stepId: step.id,
      status: 'failed',
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      error: `Failed after ${attempts} attempts: ${lastError}`,
      retryCount: attempts,
    };
  }

  // ===========================================================================
  // Private Methods - Condition Evaluation
  // ===========================================================================

  private evaluateConditions(conditions: WorkflowCondition[], context: Record<string, unknown>): boolean {
    return conditions.every(c => this.evaluateCondition(c, context));
  }

  private evaluateCondition(condition: WorkflowCondition, context: Record<string, unknown>): boolean {
    const fieldValue = this.getNestedValue(context, condition.field);

    let result: boolean;

    switch (condition.operator) {
      case 'eq':
        result = fieldValue === condition.value;
        break;
      case 'neq':
        result = fieldValue !== condition.value;
        break;
      case 'gt':
        result = Number(fieldValue) > Number(condition.value);
        break;
      case 'gte':
        result = Number(fieldValue) >= Number(condition.value);
        break;
      case 'lt':
        result = Number(fieldValue) < Number(condition.value);
        break;
      case 'lte':
        result = Number(fieldValue) <= Number(condition.value);
        break;
      case 'in':
        result = Array.isArray(condition.value) && condition.value.includes(fieldValue);
        break;
      case 'not_in':
        result = Array.isArray(condition.value) && !condition.value.includes(fieldValue);
        break;
      case 'contains':
        result = String(fieldValue).includes(String(condition.value));
        break;
      case 'matches':
        result = new RegExp(String(condition.value)).test(String(fieldValue));
        break;
      case 'exists':
        result = fieldValue !== undefined;
        break;
      default:
        result = false;
    }

    // Handle AND conditions
    if (condition.and && condition.and.length > 0) {
      result = result && condition.and.every(c => this.evaluateCondition(c, context));
    }

    // Handle OR conditions
    if (condition.or && condition.or.length > 0) {
      result = result || condition.or.some(c => this.evaluateCondition(c, context));
    }

    return result;
  }

  // ===========================================================================
  // Private Methods - Utilities
  // ===========================================================================

  private generateExecutionId(): string {
    return `exec-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }
}
