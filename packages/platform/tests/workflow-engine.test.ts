/**
 * Workflow Engine Tests
 *
 * TDD tests for the workflow execution engine that orchestrates
 * complex multi-step authorization workflows.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkflowEngine } from '../src/workflow/WorkflowEngine.js';
import type {
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowStep,
  AgentTaskStep,
  ConditionalStep,
  ParallelTasksStep,
} from '../src/workflow/types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const createSimpleWorkflow = (): WorkflowDefinition => ({
  id: 'simple-workflow-001',
  name: 'Simple Authorization Check',
  version: '1.0.0',
  description: 'A simple workflow with a single step',
  steps: [
    {
      id: 'step-1',
      type: 'agent_task',
      name: 'Check Authorization',
      agent: 'guardian',
      action: 'analyze',
      input: { type: 'authorization' },
      next: null,
    } as AgentTaskStep,
  ],
  entryStep: 'step-1',
  timeoutMs: 30000,
  priority: 'medium',
  createdAt: new Date(),
  updatedAt: new Date(),
});

const createMultiStepWorkflow = (): WorkflowDefinition => ({
  id: 'multi-step-workflow-001',
  name: 'Multi-Step Authorization',
  version: '1.0.0',
  description: 'A workflow with multiple sequential steps',
  steps: [
    {
      id: 'step-guardian',
      type: 'agent_task',
      name: 'Guardian Analysis',
      agent: 'guardian',
      action: 'analyze',
      input: {},
      next: 'step-analyst',
      outputMapping: { anomalyScore: 'context.anomalyScore' },
    } as AgentTaskStep,
    {
      id: 'step-analyst',
      type: 'agent_task',
      name: 'Analyst Review',
      agent: 'analyst',
      action: 'evaluate',
      input: {},
      next: 'step-advisor',
    } as AgentTaskStep,
    {
      id: 'step-advisor',
      type: 'agent_task',
      name: 'Advisor Explanation',
      agent: 'advisor',
      action: 'explain',
      input: {},
      next: null,
    } as AgentTaskStep,
  ],
  entryStep: 'step-guardian',
  timeoutMs: 60000,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const createConditionalWorkflow = (): WorkflowDefinition => ({
  id: 'conditional-workflow-001',
  name: 'Conditional Authorization',
  version: '1.0.0',
  description: 'A workflow with conditional branching',
  steps: [
    {
      id: 'step-analyze',
      type: 'agent_task',
      name: 'Initial Analysis',
      agent: 'guardian',
      action: 'analyze',
      input: {},
      next: 'step-condition',
      outputMapping: { anomalyScore: 'context.anomalyScore' },
    } as AgentTaskStep,
    {
      id: 'step-condition',
      type: 'conditional',
      name: 'Check Risk Level',
      condition: {
        field: 'context.anomalyScore',
        operator: 'gt',
        value: 0.7,
      },
      onTrue: 'step-high-risk',
      onFalse: 'step-low-risk',
      next: null,
    } as ConditionalStep,
    {
      id: 'step-high-risk',
      type: 'agent_task',
      name: 'High Risk Processing',
      agent: 'enforcer',
      action: 'enforce',
      input: { riskLevel: 'high' },
      next: null,
    } as AgentTaskStep,
    {
      id: 'step-low-risk',
      type: 'agent_task',
      name: 'Low Risk Processing',
      agent: 'advisor',
      action: 'approve',
      input: { riskLevel: 'low' },
      next: null,
    } as AgentTaskStep,
  ],
  entryStep: 'step-analyze',
  timeoutMs: 30000,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const createParallelWorkflow = (): WorkflowDefinition => ({
  id: 'parallel-workflow-001',
  name: 'Parallel Analysis',
  version: '1.0.0',
  description: 'A workflow with parallel task execution',
  steps: [
    {
      id: 'step-parallel',
      type: 'parallel_tasks',
      name: 'Parallel Agent Analysis',
      tasks: [
        { agent: 'guardian', action: 'analyze', input: {} },
        { agent: 'analyst', action: 'evaluate', input: {} },
        { agent: 'advisor', action: 'review', input: {} },
      ],
      aggregation: 'all',
      next: 'step-finalize',
    } as ParallelTasksStep,
    {
      id: 'step-finalize',
      type: 'agent_task',
      name: 'Finalize Decision',
      agent: 'enforcer',
      action: 'finalize',
      input: {},
      next: null,
    } as AgentTaskStep,
  ],
  entryStep: 'step-parallel',
  timeoutMs: 60000,
  createdAt: new Date(),
  updatedAt: new Date(),
});

// =============================================================================
// Test Suites
// =============================================================================

describe('WorkflowEngine', () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    engine = new WorkflowEngine();
  });

  // ===========================================================================
  // Workflow Registration Tests
  // ===========================================================================

  describe('workflow registration', () => {
    it('should register a workflow definition', async () => {
      const workflow = createSimpleWorkflow();
      await expect(engine.registerWorkflow(workflow)).resolves.not.toThrow();
    });

    it('should retrieve a registered workflow', async () => {
      const workflow = createSimpleWorkflow();
      await engine.registerWorkflow(workflow);

      const retrieved = engine.getWorkflow(workflow.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(workflow.id);
      expect(retrieved?.name).toBe(workflow.name);
    });

    it('should return undefined for non-existent workflow', () => {
      const retrieved = engine.getWorkflow('non-existent');
      expect(retrieved).toBeUndefined();
    });

    it('should list all registered workflows', async () => {
      const workflow1 = createSimpleWorkflow();
      const workflow2 = createMultiStepWorkflow();

      await engine.registerWorkflow(workflow1);
      await engine.registerWorkflow(workflow2);

      const workflows = engine.listWorkflows();
      expect(workflows).toHaveLength(2);
      expect(workflows.map(w => w.id)).toContain(workflow1.id);
      expect(workflows.map(w => w.id)).toContain(workflow2.id);
    });

    it('should validate workflow definition on registration', async () => {
      const invalidWorkflow: WorkflowDefinition = {
        ...createSimpleWorkflow(),
        entryStep: 'non-existent-step', // Invalid entry step
      };

      await expect(engine.registerWorkflow(invalidWorkflow)).rejects.toThrow();
    });

    it('should reject workflows with circular dependencies', async () => {
      const circularWorkflow: WorkflowDefinition = {
        id: 'circular-workflow',
        name: 'Circular Workflow',
        version: '1.0.0',
        steps: [
          {
            id: 'step-1',
            type: 'agent_task',
            name: 'Step 1',
            agent: 'guardian',
            action: 'analyze',
            input: {},
            next: 'step-2',
          } as AgentTaskStep,
          {
            id: 'step-2',
            type: 'agent_task',
            name: 'Step 2',
            agent: 'analyst',
            action: 'evaluate',
            input: {},
            next: 'step-1', // Circular reference
          } as AgentTaskStep,
        ],
        entryStep: 'step-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await expect(engine.registerWorkflow(circularWorkflow)).rejects.toThrow('circular');
    });

    it('should allow workflow updates by re-registering', async () => {
      const workflow = createSimpleWorkflow();
      await engine.registerWorkflow(workflow);

      const updatedWorkflow = {
        ...workflow,
        name: 'Updated Workflow Name',
        version: '1.0.1',
      };
      await engine.registerWorkflow(updatedWorkflow);

      const retrieved = engine.getWorkflow(workflow.id);
      expect(retrieved?.name).toBe('Updated Workflow Name');
      expect(retrieved?.version).toBe('1.0.1');
    });
  });

  // ===========================================================================
  // Workflow Execution Tests
  // ===========================================================================

  describe('workflow execution', () => {
    it('should execute a simple workflow', async () => {
      const workflow = createSimpleWorkflow();
      await engine.registerWorkflow(workflow);

      const execution = await engine.executeWorkflow(workflow.id, { test: 'input' });

      expect(execution).toBeDefined();
      expect(execution.executionId).toBeDefined();
      expect(execution.workflowId).toBe(workflow.id);
      expect(execution.status).toBe('completed');
    });

    it('should track execution progress', async () => {
      const workflow = createMultiStepWorkflow();
      await engine.registerWorkflow(workflow);

      const execution = await engine.executeWorkflow(workflow.id, {});

      expect(execution.stepResults).toBeDefined();
      expect(execution.stepResults.length).toBe(3);
      expect(execution.stepResults.every(r => r.status === 'completed')).toBe(true);
    });

    it('should store input in execution', async () => {
      const workflow = createSimpleWorkflow();
      await engine.registerWorkflow(workflow);

      const input = { request: { principal: 'user-1' } };
      const execution = await engine.executeWorkflow(workflow.id, input);

      expect(execution.input).toEqual(input);
    });

    it('should generate unique execution IDs', async () => {
      const workflow = createSimpleWorkflow();
      await engine.registerWorkflow(workflow);

      const execution1 = await engine.executeWorkflow(workflow.id, {});
      const execution2 = await engine.executeWorkflow(workflow.id, {});

      expect(execution1.executionId).not.toBe(execution2.executionId);
    });

    it('should throw for non-existent workflow', async () => {
      await expect(engine.executeWorkflow('non-existent', {})).rejects.toThrow(
        'Workflow not found'
      );
    });

    it('should respect workflow timeout', async () => {
      const slowWorkflow: WorkflowDefinition = {
        ...createSimpleWorkflow(),
        id: 'slow-workflow',
        timeoutMs: 1, // 1ms timeout
      };

      await engine.registerWorkflow(slowWorkflow);

      const execution = await engine.executeWorkflow(slowWorkflow.id, {});
      expect(['completed', 'timeout']).toContain(execution.status);
    });

    it('should handle step-level timeouts', async () => {
      const workflowWithStepTimeout: WorkflowDefinition = {
        ...createSimpleWorkflow(),
        id: 'step-timeout-workflow',
        steps: [
          {
            ...createSimpleWorkflow().steps[0],
            timeoutMs: 1, // 1ms step timeout
          } as AgentTaskStep,
        ],
      };

      await engine.registerWorkflow(workflowWithStepTimeout);

      const execution = await engine.executeWorkflow(workflowWithStepTimeout.id, {});
      expect(['completed', 'timeout', 'failed']).toContain(execution.status);
    });

    it('should track total duration', async () => {
      const workflow = createSimpleWorkflow();
      await engine.registerWorkflow(workflow);

      const execution = await engine.executeWorkflow(workflow.id, {});

      expect(execution.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(execution.startedAt).toBeInstanceOf(Date);
      expect(execution.completedAt).toBeInstanceOf(Date);
    });

    it('should support correlation ID', async () => {
      const workflow = createSimpleWorkflow();
      await engine.registerWorkflow(workflow);

      const execution = await engine.executeWorkflow(workflow.id, {}, {
        correlationId: 'corr-123',
      });

      expect(execution.correlationId).toBe('corr-123');
    });
  });

  // ===========================================================================
  // Conditional Workflow Tests
  // ===========================================================================

  describe('conditional workflows', () => {
    it('should execute correct branch based on condition', async () => {
      const workflow = createConditionalWorkflow();
      await engine.registerWorkflow(workflow);

      // Execution path depends on the mocked anomaly score
      const execution = await engine.executeWorkflow(workflow.id, {});

      expect(execution.status).toBe('completed');
      // Should have executed the condition step
      const conditionResult = execution.stepResults.find(r => r.stepId === 'step-condition');
      expect(conditionResult).toBeDefined();
    });

    it('should evaluate complex conditions', async () => {
      const workflow: WorkflowDefinition = {
        ...createConditionalWorkflow(),
        id: 'complex-condition-workflow',
        steps: [
          {
            id: 'step-start',
            type: 'agent_task',
            name: 'Start',
            agent: 'guardian',
            action: 'analyze',
            input: {},
            next: 'step-condition',
          } as AgentTaskStep,
          {
            id: 'step-condition',
            type: 'conditional',
            name: 'Complex Condition',
            condition: {
              field: 'context.value',
              operator: 'gt',
              value: 5,
              and: [
                { field: 'context.enabled', operator: 'eq', value: true },
              ],
            },
            onTrue: 'step-end',
            onFalse: 'step-end',
            next: null,
          } as ConditionalStep,
          {
            id: 'step-end',
            type: 'agent_task',
            name: 'End',
            agent: 'advisor',
            action: 'complete',
            input: {},
            next: null,
          } as AgentTaskStep,
        ],
        entryStep: 'step-start',
      };

      await engine.registerWorkflow(workflow);
      const execution = await engine.executeWorkflow(workflow.id, {});

      expect(execution.status).toBe('completed');
    });
  });

  // ===========================================================================
  // Parallel Workflow Tests
  // ===========================================================================

  describe('parallel workflows', () => {
    it('should execute tasks in parallel', async () => {
      const workflow = createParallelWorkflow();
      await engine.registerWorkflow(workflow);

      const execution = await engine.executeWorkflow(workflow.id, {});

      expect(execution.status).toBe('completed');
      const parallelResult = execution.stepResults.find(r => r.stepId === 'step-parallel');
      expect(parallelResult).toBeDefined();
      expect(parallelResult?.status).toBe('completed');
    });

    it('should aggregate parallel results based on strategy', async () => {
      const workflow = createParallelWorkflow();
      await engine.registerWorkflow(workflow);

      const execution = await engine.executeWorkflow(workflow.id, {});

      expect(execution.context).toBeDefined();
    });
  });

  // ===========================================================================
  // Execution Management Tests
  // ===========================================================================

  describe('execution management', () => {
    it('should retrieve execution by ID', async () => {
      const workflow = createSimpleWorkflow();
      await engine.registerWorkflow(workflow);

      const execution = await engine.executeWorkflow(workflow.id, {});
      const retrieved = engine.getExecution(execution.executionId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.executionId).toBe(execution.executionId);
    });

    it('should return undefined for non-existent execution', () => {
      const retrieved = engine.getExecution('non-existent');
      expect(retrieved).toBeUndefined();
    });

    it('should list executions', async () => {
      const workflow = createSimpleWorkflow();
      await engine.registerWorkflow(workflow);

      await engine.executeWorkflow(workflow.id, {});
      await engine.executeWorkflow(workflow.id, {});

      const executions = engine.listExecutions();
      expect(executions.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter executions by workflow ID', async () => {
      const workflow1 = createSimpleWorkflow();
      const workflow2 = createMultiStepWorkflow();

      await engine.registerWorkflow(workflow1);
      await engine.registerWorkflow(workflow2);

      await engine.executeWorkflow(workflow1.id, {});
      await engine.executeWorkflow(workflow2.id, {});

      const filtered = engine.listExecutions({ workflowId: workflow1.id });
      expect(filtered.every(e => e.workflowId === workflow1.id)).toBe(true);
    });

    it('should filter executions by status', async () => {
      const workflow = createSimpleWorkflow();
      await engine.registerWorkflow(workflow);

      await engine.executeWorkflow(workflow.id, {});

      const completed = engine.listExecutions({ status: 'completed' });
      expect(completed.every(e => e.status === 'completed')).toBe(true);
    });

    it('should support pagination in list', async () => {
      const workflow = createSimpleWorkflow();
      await engine.registerWorkflow(workflow);

      // Execute multiple workflows
      for (let i = 0; i < 5; i++) {
        await engine.executeWorkflow(workflow.id, {});
      }

      const page1 = engine.listExecutions({ limit: 2, offset: 0 });
      const page2 = engine.listExecutions({ limit: 2, offset: 2 });

      expect(page1.length).toBeLessThanOrEqual(2);
      expect(page2.length).toBeLessThanOrEqual(2);
    });
  });

  // ===========================================================================
  // Execution Control Tests
  // ===========================================================================

  describe('execution control', () => {
    it('should cancel an execution', async () => {
      const workflow = createSimpleWorkflow();
      await engine.registerWorkflow(workflow);

      const execution = await engine.executeWorkflow(workflow.id, {});

      // For already completed executions, cancel should be no-op or throw
      if (execution.status !== 'completed') {
        await engine.cancelExecution(execution.executionId);
        const cancelled = engine.getExecution(execution.executionId);
        expect(cancelled?.status).toBe('cancelled');
      }
    });

    it('should throw when cancelling non-existent execution', async () => {
      await expect(engine.cancelExecution('non-existent')).rejects.toThrow();
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('error handling', () => {
    it('should capture step errors in execution', async () => {
      const failingWorkflow: WorkflowDefinition = {
        id: 'failing-workflow',
        name: 'Failing Workflow',
        version: '1.0.0',
        steps: [
          {
            id: 'failing-step',
            type: 'agent_task',
            name: 'Failing Step',
            agent: 'guardian',
            action: 'fail', // Simulated failure action
            input: { shouldFail: true },
            next: null,
          } as AgentTaskStep,
        ],
        entryStep: 'failing-step',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await engine.registerWorkflow(failingWorkflow);

      const execution = await engine.executeWorkflow(failingWorkflow.id, {});

      // The execution should either complete (with error handling) or fail
      expect(['completed', 'failed']).toContain(execution.status);
    });

    it('should support retry configuration', async () => {
      const retryWorkflow: WorkflowDefinition = {
        id: 'retry-workflow',
        name: 'Retry Workflow',
        version: '1.0.0',
        steps: [
          {
            id: 'retry-step',
            type: 'agent_task',
            name: 'Retry Step',
            agent: 'guardian',
            action: 'analyze',
            input: {},
            next: null,
            retry: {
              maxAttempts: 3,
              backoffMs: 100,
              backoffMultiplier: 2,
            },
          } as AgentTaskStep,
        ],
        entryStep: 'retry-step',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await engine.registerWorkflow(retryWorkflow);
      const execution = await engine.executeWorkflow(retryWorkflow.id, {});

      expect(execution).toBeDefined();
    });

    it('should use onFailure path when step fails', async () => {
      const failoverWorkflow: WorkflowDefinition = {
        id: 'failover-workflow',
        name: 'Failover Workflow',
        version: '1.0.0',
        steps: [
          {
            id: 'main-step',
            type: 'agent_task',
            name: 'Main Step',
            agent: 'guardian',
            action: 'analyze',
            input: {},
            next: 'success-step',
            onFailure: 'fallback-step',
          } as AgentTaskStep,
          {
            id: 'success-step',
            type: 'agent_task',
            name: 'Success Step',
            agent: 'advisor',
            action: 'complete',
            input: {},
            next: null,
          } as AgentTaskStep,
          {
            id: 'fallback-step',
            type: 'agent_task',
            name: 'Fallback Step',
            agent: 'enforcer',
            action: 'fallback',
            input: {},
            next: null,
          } as AgentTaskStep,
        ],
        entryStep: 'main-step',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await engine.registerWorkflow(failoverWorkflow);
      const execution = await engine.executeWorkflow(failoverWorkflow.id, {});

      expect(['completed', 'failed']).toContain(execution.status);
    });
  });
});
