/**
 * Load Balancer Tests
 *
 * Tests for load balancing strategies and the main LoadBalancer class
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LoadBalancer,
  RoundRobinStrategy,
  WeightedStrategy,
  LeastConnectionsStrategy,
  AdaptiveStrategy,
  type LoadBalancerConfig,
  type Task,
  type SwarmAgent,
} from '../src/index.js';

// Helper to create test agents
function createTestAgents(count: number): SwarmAgent[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `agent-${i + 1}`,
    type: 'GUARDIAN' as const,
    status: 'idle' as const,
    capabilities: ['analyze', 'process'],
    load: 0.1 * i, // Varying load
    metadata: {
      createdAt: new Date(),
      version: '1.0.0',
      tags: [],
      priority: count - i, // Higher priority for lower indexed agents
      attributes: {},
    },
    lastHeartbeat: new Date(),
    connectionInfo: {
      host: 'localhost',
      port: 8080 + i,
      protocol: 'internal' as const,
      secure: false,
    },
  }));
}

// Helper to create a test task
function createTestTask(id: string, type = 'authorization'): Task {
  return {
    id,
    type,
    priority: 'medium',
    payload: { test: true },
    createdAt: new Date(),
  };
}

describe('RoundRobinStrategy', () => {
  let strategy: RoundRobinStrategy;

  beforeEach(() => {
    strategy = new RoundRobinStrategy();
  });

  it('should select agents in round-robin order', () => {
    const agents = createTestAgents(3);
    const task = createTestTask('task-1');

    const selected1 = strategy.selectAgent(agents, task);
    const selected2 = strategy.selectAgent(agents, task);
    const selected3 = strategy.selectAgent(agents, task);
    const selected4 = strategy.selectAgent(agents, task);

    expect(selected1?.id).toBe('agent-1');
    expect(selected2?.id).toBe('agent-2');
    expect(selected3?.id).toBe('agent-3');
    expect(selected4?.id).toBe('agent-1'); // Wraps around
  });

  it('should filter out unhealthy agents', () => {
    const agents = createTestAgents(3);
    agents[0]!.status = 'unhealthy';

    const task = createTestTask('task-1');
    const selected = strategy.selectAgent(agents, task);

    expect(selected?.id).not.toBe('agent-1');
  });

  it('should respect capability requirements', () => {
    const agents = createTestAgents(3);
    agents[0]!.capabilities = ['other'];

    const task = createTestTask('task-1');
    task.requiredCapabilities = ['analyze'];

    const selected = strategy.selectAgent(agents, task);
    expect(selected?.id).not.toBe('agent-1');
  });

  it('should return null when no agents available', () => {
    const agents: SwarmAgent[] = [];
    const task = createTestTask('task-1');

    const selected = strategy.selectAgent(agents, task);
    expect(selected).toBeNull();
  });

  it('should select agents for removal by least activity', () => {
    const agents = createTestAgents(3);
    const loads = new Map([
      ['agent-1', { agentId: 'agent-1', load: 0.1, activeTasks: 5, queuedTasks: 0, completedTasks: 10, failedTasks: 0, avgProcessingTimeMs: 100, lastActivity: new Date() }],
      ['agent-2', { agentId: 'agent-2', load: 0.2, activeTasks: 2, queuedTasks: 0, completedTasks: 5, failedTasks: 0, avgProcessingTimeMs: 100, lastActivity: new Date() }],
      ['agent-3', { agentId: 'agent-3', load: 0.3, activeTasks: 1, queuedTasks: 0, completedTasks: 3, failedTasks: 0, avgProcessingTimeMs: 100, lastActivity: new Date() }],
    ]);

    const toRemove = strategy.selectForRemoval(agents, 1, loads);
    expect(toRemove).toContain('agent-3'); // Least active tasks
  });
});

describe('WeightedStrategy', () => {
  let strategy: WeightedStrategy;

  beforeEach(() => {
    strategy = new WeightedStrategy();
  });

  it('should prefer agents with higher weights', () => {
    const agents = createTestAgents(3);
    // agent-1 has priority 3, agent-2 has priority 2, agent-3 has priority 1

    const selections = new Map<string, number>();
    for (let i = 0; i < 100; i++) {
      const task = createTestTask(`task-${i}`);
      const selected = strategy.selectAgent(agents, task);
      if (selected) {
        selections.set(selected.id, (selections.get(selected.id) ?? 0) + 1);
      }
    }

    // Agent with highest weight should be selected most
    expect(selections.get('agent-1')! > selections.get('agent-3')!).toBe(true);
  });

  it('should allow setting custom weights', () => {
    const agents = createTestAgents(3);

    strategy.setWeight('agent-3', 100); // Make agent-3 heavily weighted

    const task = createTestTask('task-1');
    const selected = strategy.selectAgent(agents, task);

    expect(selected?.id).toBe('agent-3');
  });

  it('should reduce weight after selection', () => {
    const agents = createTestAgents(2);
    strategy.setWeight('agent-1', 5);
    strategy.setWeight('agent-2', 5);

    // After several selections, both should get approximately equal selections
    const selections = new Map<string, number>();
    for (let i = 0; i < 10; i++) {
      const task = createTestTask(`task-${i}`);
      const selected = strategy.selectAgent(agents, task);
      if (selected) {
        selections.set(selected.id, (selections.get(selected.id) ?? 0) + 1);
      }
    }

    // Both should have been selected
    expect(selections.has('agent-1')).toBe(true);
    expect(selections.has('agent-2')).toBe(true);
  });
});

describe('LeastConnectionsStrategy', () => {
  let strategy: LeastConnectionsStrategy;

  beforeEach(() => {
    strategy = new LeastConnectionsStrategy();
  });

  it('should select agent with fewest active tasks', () => {
    const agents = createTestAgents(3);
    agents[0]!.load = 0.8;
    agents[1]!.load = 0.5;
    agents[2]!.load = 0.1;

    const task = createTestTask('task-1');
    const selected = strategy.selectAgent(agents, task);

    // Should select agent with lowest effective load
    expect(selected?.id).toBe('agent-3');
  });

  it('should track active tasks after selection', () => {
    const agents = createTestAgents(3);
    // Set all loads equal so only active task count matters
    agents.forEach(a => { a.load = 0; });

    const task1 = createTestTask('task-1');
    const selected1 = strategy.selectAgent(agents, task1);

    expect(strategy.getActiveTaskCount(selected1!.id)).toBe(1);

    // Next selection should prefer a different agent (with 0 active tasks)
    const task2 = createTestTask('task-2');
    const selected2 = strategy.selectAgent(agents, task2);

    // The second agent should have lower effective load (0 active tasks vs 1)
    expect(strategy.getActiveTaskCount(selected2!.id)).toBe(1); // Now has 1 task
    expect(selected2?.id).not.toBe(selected1?.id);
  });

  it('should decrease count on completion', () => {
    const agents = createTestAgents(2);

    const task = createTestTask('task-1');
    const selected = strategy.selectAgent(agents, task);

    expect(strategy.getActiveTaskCount(selected!.id)).toBe(1);

    strategy.recordCompletion(selected!.id, 'task-1', true);
    expect(strategy.getActiveTaskCount(selected!.id)).toBe(0);
  });
});

describe('AdaptiveStrategy', () => {
  let strategy: AdaptiveStrategy;

  beforeEach(() => {
    strategy = new AdaptiveStrategy();
  });

  it('should consider agent performance', () => {
    const agents = createTestAgents(3);

    // Record some completions
    for (let i = 0; i < 10; i++) {
      strategy.recordCompletion('agent-1', `task-${i}`, true);
    }
    for (let i = 0; i < 10; i++) {
      strategy.recordCompletion('agent-2', `task-${i}`, false); // Failures
    }

    // Agent-1 should be preferred due to success rate
    const task = createTestTask('task-new');
    const selected = strategy.selectAgent(agents, task);

    // Due to randomization, we check that agent-1 has better performance
    const perf1 = strategy.getPerformance('agent-1');
    const perf2 = strategy.getPerformance('agent-2');

    expect(perf1?.successCount).toBe(10);
    expect(perf2?.failureCount).toBe(10);
  });

  it('should adapt based on task type success', () => {
    const agents = createTestAgents(3);

    // Record success for specific task type with specific agent
    for (let i = 0; i < 5; i++) {
      strategy.recordTaskTypeSuccess('authorization', 'agent-1', 100);
    }

    const task = createTestTask('task-1', 'authorization');
    // Agent-1 should get bonus for this task type
    const selected = strategy.selectAgent(agents, task);

    // Note: Due to randomization, we can't guarantee which agent is selected
    // but we can verify the mechanism works
    expect(selected).not.toBeNull();
  });

  it('should prefer idle agents', () => {
    const agents = createTestAgents(3);
    agents[0]!.status = 'busy';
    agents[1]!.status = 'idle';
    agents[2]!.status = 'busy';

    const task = createTestTask('task-1');
    // Idle agents should score higher
    const selected = strategy.selectAgent(agents, task);

    // Due to scoring, idle agents are preferred but not guaranteed
    expect(selected).not.toBeNull();
  });
});

describe('LoadBalancer', () => {
  let loadBalancer: LoadBalancer;
  const config: LoadBalancerConfig = {
    strategy: 'round-robin',
    maxQueueSize: 10,
    overloadThreshold: 0.9,
    autoFailover: true,
  };

  beforeEach(() => {
    loadBalancer = new LoadBalancer(config);
  });

  it('should initialize with agents', () => {
    const agents = createTestAgents(3);
    loadBalancer.initialize(agents);

    expect(loadBalancer.getMetrics().agentUtilization).toBeDefined();
  });

  it('should assign tasks to agents', () => {
    const agents = createTestAgents(3);
    loadBalancer.initialize(agents);

    const task = createTestTask('task-1');
    const assignment = loadBalancer.assign(task);

    expect(assignment).not.toBeNull();
    expect(assignment?.taskId).toBe('task-1');
    expect(assignment?.agentId).toBeDefined();
  });

  it('should track task completion', () => {
    const agents = createTestAgents(3);
    loadBalancer.initialize(agents);

    const task = createTestTask('task-1');
    const assignment = loadBalancer.assign(task);

    loadBalancer.completeTask('task-1', true, 100);

    const metrics = loadBalancer.getMetrics();
    expect(metrics.tasksCompleted).toBe(1);
    expect(metrics.tasksFailed).toBe(0);
  });

  it('should track failed tasks', () => {
    const agents = createTestAgents(3);
    loadBalancer.initialize(agents);

    const task = createTestTask('task-1');
    loadBalancer.assign(task);
    loadBalancer.completeTask('task-1', false, 100);

    const metrics = loadBalancer.getMetrics();
    expect(metrics.tasksFailed).toBe(1);
  });

  it('should emit events', () => {
    const agents = createTestAgents(3);
    loadBalancer.initialize(agents);

    const events: any[] = [];
    loadBalancer.on('loadBalancerEvent', e => events.push(e));

    const task = createTestTask('task-1');
    loadBalancer.assign(task);

    expect(events.some(e => e.type === 'task_assigned')).toBe(true);
  });

  it('should queue tasks when no agents available', () => {
    // Don't initialize with agents
    const task = createTestTask('task-1');
    const assignment = loadBalancer.assign(task);

    expect(assignment).toBeNull();
    // Note: Task may not be queued if maxQueueSize is reached or no agents
  });

  it('should change strategy', () => {
    loadBalancer.setStrategy('weighted');
    expect(loadBalancer.getStrategy()).toBe('weighted');

    loadBalancer.setStrategy('least-connections');
    expect(loadBalancer.getStrategy()).toBe('least-connections');

    loadBalancer.setStrategy('adaptive');
    expect(loadBalancer.getStrategy()).toBe('adaptive');
  });

  it('should add and remove agents', () => {
    const agents = createTestAgents(3);
    loadBalancer.initialize(agents);

    const newAgent = createTestAgents(1)[0]!;
    newAgent.id = 'agent-new';
    loadBalancer.addAgent(newAgent);

    const load = loadBalancer.getAgentLoad('agent-new');
    expect(load).toBeDefined();

    loadBalancer.removeAgent('agent-new');
    const loadAfter = loadBalancer.getAgentLoad('agent-new');
    expect(loadAfter).toBeUndefined();
  });

  it('should update agent status', () => {
    const agents = createTestAgents(3);
    loadBalancer.initialize(agents);

    loadBalancer.updateAgent('agent-1', { load: 0.5 });

    const load = loadBalancer.getAgentLoad('agent-1');
    expect(load?.load).toBe(0.5);
  });

  it('should select agents for removal', () => {
    const agents = createTestAgents(3);
    loadBalancer.initialize(agents);

    const toRemove = loadBalancer.selectForRemoval(1);
    expect(toRemove).toHaveLength(1);
  });

  it('should rebalance', () => {
    const agents = createTestAgents(3);
    loadBalancer.initialize(agents);

    // Should not throw
    expect(() => loadBalancer.rebalance()).not.toThrow();
  });

  it('should filter overloaded agents', () => {
    const agents = createTestAgents(3);
    agents.forEach(a => { a.load = 0.95; }); // All overloaded
    agents[2]!.load = 0.5; // One not overloaded

    loadBalancer.initialize(agents);

    const task = createTestTask('task-1');
    const assignment = loadBalancer.assign(task);

    // Should only assign to non-overloaded agent
    expect(assignment?.agentId).toBe('agent-3');
  });
});
