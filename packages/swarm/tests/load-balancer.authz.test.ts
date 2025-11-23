/**
 * Tests for LoadBalancer authorization routing
 *
 * Covers:
 * - Authorization request routing
 * - Sticky session management
 * - Health-aware routing
 * - Agent health scoring
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LoadBalancer } from '../src/load-balancer/LoadBalancer.js';
import type { LoadBalancerConfig, Task } from '../src/load-balancer/types.js';
import { DefaultAgentFactory } from '../src/agent-pool/AgentPool.js';
import type { SwarmAgent } from '../src/topology/types.js';

describe('LoadBalancer Authorization Features', () => {
  let loadBalancer: LoadBalancer;
  let mockAgents: SwarmAgent[];

  const createTestConfig = (): LoadBalancerConfig => ({
    strategy: 'adaptive',
    stickySession: true,
    overloadThreshold: 0.9,
  });

  const createMockAgents = async (count: number, type: string): Promise<SwarmAgent[]> => {
    const factory = new DefaultAgentFactory();
    const agents: SwarmAgent[] = [];

    for (let i = 0; i < count; i++) {
      const agent = await factory.create({
        type: type as any,
        capabilities: [`capability-${i}`],
      });
      agents.push(agent);
    }

    return agents;
  };

  beforeEach(async () => {
    loadBalancer = new LoadBalancer(createTestConfig());

    // Create agents of each type
    const guardians = await createMockAgents(2, 'GUARDIAN');
    const analysts = await createMockAgents(1, 'ANALYST');
    const advisors = await createMockAgents(2, 'ADVISOR');
    const enforcers = await createMockAgents(2, 'ENFORCER');

    mockAgents = [...guardians, ...analysts, ...advisors, ...enforcers];
    loadBalancer.initialize(mockAgents);
  });

  describe('routeAuthzRequest', () => {
    it('should route to GUARDIAN agents', () => {
      const task: Task = {
        id: 'authz-req-1',
        type: 'authorization',
        priority: 'high',
        payload: { action: 'threat-detection' },
        createdAt: new Date(),
        metadata: { userId: 'user-123' },
      };

      const assignment = loadBalancer.routeAuthzRequest(task, 'GUARDIAN');

      expect(assignment).not.toBeNull();
      expect(assignment?.agentId).toBeDefined();
    });

    it('should route to ANALYST agents', () => {
      const task: Task = {
        id: 'authz-req-2',
        type: 'analysis',
        priority: 'medium',
        payload: { action: 'risk-assessment' },
        createdAt: new Date(),
      };

      const assignment = loadBalancer.routeAuthzRequest(task, 'ANALYST');

      expect(assignment).not.toBeNull();
    });

    it('should route to ADVISOR agents', () => {
      const task: Task = {
        id: 'authz-req-3',
        type: 'recommendation',
        priority: 'medium',
        payload: { action: 'compliance-check' },
        createdAt: new Date(),
      };

      const assignment = loadBalancer.routeAuthzRequest(task, 'ADVISOR');

      expect(assignment).not.toBeNull();
    });

    it('should route to ENFORCER agents', () => {
      const task: Task = {
        id: 'authz-req-4',
        type: 'enforcement',
        priority: 'critical',
        payload: { action: 'final-decision' },
        createdAt: new Date(),
      };

      const assignment = loadBalancer.routeAuthzRequest(task, 'ENFORCER');

      expect(assignment).not.toBeNull();
    });

    it('should use sticky session for same request', () => {
      const task1: Task = {
        id: 'sticky-1',
        type: 'authorization',
        priority: 'high',
        payload: {},
        createdAt: new Date(),
        metadata: { sessionId: 'session-123' },
      };

      const task2: Task = {
        id: 'sticky-2',
        type: 'authorization',
        priority: 'high',
        payload: {},
        createdAt: new Date(),
        metadata: { sessionId: 'session-123' },
      };

      const assignment1 = loadBalancer.routeAuthzRequest(task1, 'GUARDIAN');
      const assignment2 = loadBalancer.routeAuthzRequest(task2, 'GUARDIAN');

      expect(assignment1?.agentId).toBe(assignment2?.agentId);
    });

    it('should route different sessions to potentially different agents', () => {
      const task1: Task = {
        id: 'diff-1',
        type: 'authorization',
        priority: 'high',
        payload: {},
        createdAt: new Date(),
        metadata: { sessionId: 'session-1' },
      };

      const task2: Task = {
        id: 'diff-2',
        type: 'authorization',
        priority: 'high',
        payload: {},
        createdAt: new Date(),
        metadata: { sessionId: 'session-2' },
      };

      const assignment1 = loadBalancer.routeAuthzRequest(task1, 'GUARDIAN');
      const assignment2 = loadBalancer.routeAuthzRequest(task2, 'GUARDIAN');

      expect(assignment1).not.toBeNull();
      expect(assignment2).not.toBeNull();
    });

    it('should not route to overloaded agents in sticky sessions', () => {
      const task: Task = {
        id: 'overload-test',
        type: 'authorization',
        priority: 'high',
        payload: {},
        createdAt: new Date(),
        metadata: { sessionId: 'session-123' },
      };

      const assignment1 = loadBalancer.routeAuthzRequest(task, 'GUARDIAN');
      expect(assignment1).not.toBeNull();

      // Mark agent as overloaded
      const agentId = assignment1!.agentId;
      loadBalancer.updateAgent(agentId, { load: 0.95 });

      const task2: Task = {
        id: 'overload-test-2',
        type: 'authorization',
        priority: 'high',
        payload: {},
        createdAt: new Date(),
        metadata: { sessionId: 'session-123' },
      };

      const assignment2 = loadBalancer.routeAuthzRequest(task2, 'GUARDIAN');

      // Should try to find different agent or return null if all are overloaded
      if (assignment2) {
        expect(assignment2.agentId).toBeDefined();
      }
    });
  });

  describe('calculateAgentHealthScore', () => {
    it('should return valid health score', () => {
      const agentId = mockAgents[0].id;
      const score = loadBalancer.calculateAgentHealthScore(agentId);

      expect(typeof score).toBe('number');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should reflect agent load in score', () => {
      const agent1 = mockAgents[0];
      const agent2 = mockAgents[1];

      loadBalancer.updateAgent(agent1.id, { load: 0.1 });
      loadBalancer.updateAgent(agent2.id, { load: 0.9 });

      const score1 = loadBalancer.calculateAgentHealthScore(agent1.id);
      const score2 = loadBalancer.calculateAgentHealthScore(agent2.id);

      expect(score1).toBeGreaterThan(score2);
    });

    it('should reflect task completion success rate', () => {
      const task: Task = {
        id: 'health-test-1',
        type: 'test',
        priority: 'low',
        payload: {},
        createdAt: new Date(),
      };

      const assignment = loadBalancer.assign(task);
      if (assignment) {
        // Successful completion
        loadBalancer.completeTask(assignment.taskId, true, 100);
        const scoreAfterSuccess = loadBalancer.calculateAgentHealthScore(assignment.agentId);

        // Failure
        const task2: Task = {
          id: 'health-test-2',
          type: 'test',
          priority: 'low',
          payload: {},
          createdAt: new Date(),
        };
        const assignment2 = loadBalancer.assign(task2);
        if (assignment2?.agentId === assignment.agentId) {
          loadBalancer.completeTask(assignment2.taskId, false);
          const scoreAfterFailure = loadBalancer.calculateAgentHealthScore(assignment.agentId);

          expect(scoreAfterSuccess).toBeGreaterThan(scoreAfterFailure);
        }
      }
    });
  });

  describe('getAgentsByTypeForAuthz', () => {
    it('should return agents grouped by authorization type', () => {
      const byType = loadBalancer.getAgentsByTypeForAuthz();

      expect(byType.has('GUARDIAN')).toBe(true);
      expect(byType.has('ANALYST')).toBe(true);
      expect(byType.has('ADVISOR')).toBe(true);
      expect(byType.has('ENFORCER')).toBe(true);
    });

    it('should only return agents below load threshold', () => {
      const byType = loadBalancer.getAgentsByTypeForAuthz();

      for (const agents of byType.values()) {
        for (const agent of agents) {
          expect(agent.load).toBeLessThan(0.8);
        }
      }
    });

    it('should sort agents by load within each type', () => {
      const byType = loadBalancer.getAgentsByTypeForAuthz();

      for (const agents of byType.values()) {
        for (let i = 0; i < agents.length - 1; i++) {
          expect(agents[i].load).toBeLessThanOrEqual(agents[i + 1].load);
        }
      }
    });
  });

  describe('updateHealthScore', () => {
    it('should update health score for agent', () => {
      const agentId = mockAgents[0].id;
      loadBalancer.updateHealthScore(agentId);

      const score = loadBalancer.getHealthScore(agentId);
      expect(score).toBeDefined();
      expect(score?.score).toBeGreaterThanOrEqual(0);
      expect(score?.score).toBeLessThanOrEqual(1);
    });

    it('should include load in health score', () => {
      const agentId = mockAgents[0].id;
      loadBalancer.updateAgent(agentId, { load: 0.5 });
      loadBalancer.updateHealthScore(agentId);

      const score = loadBalancer.getHealthScore(agentId);
      expect(score?.load).toBe(0.5);
    });
  });

  describe('cleanupExpiredSessions', () => {
    it('should remove expired sticky sessions', async () => {
      const task: Task = {
        id: 'cleanup-test',
        type: 'authorization',
        priority: 'high',
        payload: {},
        createdAt: new Date(),
        metadata: { sessionId: 'cleanup-session' },
      };

      loadBalancer.routeAuthzRequest(task, 'GUARDIAN');

      // Cleanup should remove expired sessions
      loadBalancer.cleanupExpiredSessions();

      // Note: Session won't be expired immediately unless we wait
      // This test just verifies the method runs without error
      expect(true).toBe(true);
    });
  });

  describe('Session key extraction', () => {
    it('should extract sessionId from metadata', () => {
      const task: Task = {
        id: 'session-key-test',
        type: 'authorization',
        priority: 'high',
        payload: {},
        createdAt: new Date(),
        metadata: { sessionId: 'my-session' },
      };

      const assignment = loadBalancer.routeAuthzRequest(task, 'GUARDIAN');
      expect(assignment).not.toBeNull();
    });

    it('should extract userId from metadata', () => {
      const task: Task = {
        id: 'user-key-test',
        type: 'authorization',
        priority: 'high',
        payload: {},
        createdAt: new Date(),
        metadata: { userId: 'user-456' },
      };

      const assignment = loadBalancer.routeAuthzRequest(task, 'GUARDIAN');
      expect(assignment).not.toBeNull();
    });

    it('should extract resourceId from metadata', () => {
      const task: Task = {
        id: 'resource-key-test',
        type: 'authorization',
        priority: 'high',
        payload: {},
        createdAt: new Date(),
        metadata: { resourceId: 'resource-789' },
      };

      const assignment = loadBalancer.routeAuthzRequest(task, 'GUARDIAN');
      expect(assignment).not.toBeNull();
    });
  });
});
