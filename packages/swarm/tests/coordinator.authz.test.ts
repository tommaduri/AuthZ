/**
 * Tests for SwarmCoordinator authorization agent coordination
 *
 * Covers:
 * - Authorization agent registration
 * - Multi-stage authorization pipeline
 * - Distributed consensus mechanisms
 * - Agent type dispatching
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SwarmCoordinator } from '../src/coordinator/SwarmCoordinator.js';
import type { SwarmConfig, AuthorizationPipelineRequest } from '../src/coordinator/SwarmCoordinator.js';
import type { TopologyConfig } from '../src/topology/types.js';
import type { LoadBalancerConfig } from '../src/load-balancer/types.js';
import type { AgentPoolConfig } from '../src/agent-pool/types.js';

describe('SwarmCoordinator Authorization Features', () => {
  let coordinator: SwarmCoordinator;

  const createTestConfig = (): SwarmConfig => ({
    id: 'test-swarm',
    topology: {
      type: 'mesh',
      maxDistance: 3,
    } as TopologyConfig,
    loadBalancer: {
      strategy: 'adaptive',
      stickySession: true,
      overloadThreshold: 0.9,
    } as LoadBalancerConfig,
    agentPool: {
      minAgents: 2,
      maxAgents: 10,
      defaultAgentType: 'COORDINATOR',
      healthCheckIntervalMs: 5000,
      healthCheckTimeoutMs: 3000,
      unhealthyThresholdMs: 30000,
    } as AgentPoolConfig,
    autoOptimize: false,
    consensus: {
      enabled: true,
      quorumSize: 3,
      timeoutMs: 5000,
      approvalThreshold: 0.6,
      minConfidence: 0.5,
    },
  });

  beforeEach(async () => {
    coordinator = new SwarmCoordinator(createTestConfig());
    await coordinator.initialize();
  });

  afterEach(async () => {
    await coordinator.shutdown();
  });

  describe('registerAuthzAgents', () => {
    it('should register all four authorization agent types', async () => {
      const agents = await coordinator.registerAuthzAgents(2, 1, 2, 2);

      expect(agents).toHaveLength(7);
      expect(agents.filter(a => a.type === 'GUARDIAN')).toHaveLength(2);
      expect(agents.filter(a => a.type === 'ANALYST')).toHaveLength(1);
      expect(agents.filter(a => a.type === 'ADVISOR')).toHaveLength(2);
      expect(agents.filter(a => a.type === 'ENFORCER')).toHaveLength(2);
    });

    it('should warm up agents after registration', async () => {
      const agents = await coordinator.registerAuthzAgents(1, 1, 1, 1);

      for (const agent of agents) {
        expect(agent.status).toBe('idle');
      }
    });

    it('should throw when registering agents before initialization', async () => {
      const newCoordinator = new SwarmCoordinator(createTestConfig());

      await expect(
        newCoordinator.registerAuthzAgents(2, 1, 2, 2)
      ).rejects.toThrow('Swarm must be initialized');
    });

    it('should emit authz_agents_registered event', async () => {
      let eventFired = false;
      coordinator.on('swarmEvent', (event: any) => {
        if (event.type === 'authz_agents_registered') {
          eventFired = true;
          expect(event.data.count).toBe(4);
        }
      });

      await coordinator.registerAuthzAgents(1, 1, 1, 1);
      expect(eventFired).toBe(true);
    });
  });

  describe('coordinateAuthzPipeline', () => {
    beforeEach(async () => {
      await coordinator.registerAuthzAgents(2, 1, 2, 2);
    });

    it('should execute complete authorization pipeline', async () => {
      const request: AuthorizationPipelineRequest = {
        requestId: 'test-req-1',
        subject: {
          id: 'user-123',
          type: 'user',
          attributes: { role: 'admin' },
        },
        resource: {
          id: 'resource-456',
          type: 'document',
          attributes: { classification: 'public' },
        },
        action: 'read',
      };

      const result = await coordinator.coordinateAuthzPipeline(request);

      expect(result.requestId).toBe('test-req-1');
      expect(['allow', 'deny', 'indeterminate']).toContain(result.decision);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.agentDecisions.length).toBeGreaterThan(0);
    });

    it('should collect decisions from all agent types', async () => {
      const request: AuthorizationPipelineRequest = {
        requestId: 'test-req-2',
        subject: { id: 'user-456', type: 'user' },
        resource: { id: 'resource-789', type: 'api' },
        action: 'write',
        requireConsensus: false,
      };

      const result = await coordinator.coordinateAuthzPipeline(request);

      const agentTypes = result.agentDecisions.map(d => d.agentType);
      expect(agentTypes).toContain('GUARDIAN');
      expect(agentTypes).toContain('ANALYST');
      expect(agentTypes).toContain('ENFORCER');
    });

    it('should measure pipeline processing time', async () => {
      const request: AuthorizationPipelineRequest = {
        requestId: 'test-req-3',
        subject: { id: 'user-789', type: 'user' },
        resource: { id: 'resource-101', type: 'file' },
        action: 'delete',
      };

      const result = await coordinator.coordinateAuthzPipeline(request);

      expect(result.processingTimeMs).toBeGreaterThan(0);
    });
  });

  describe('runDistributedConsensus', () => {
    beforeEach(async () => {
      await coordinator.registerAuthzAgents(2, 1, 3, 2);
    });

    it('should run consensus across advisor agents', async () => {
      const result = await coordinator.runDistributedConsensus(
        'proposal-1',
        [true, true, false]
      );

      expect(result.proposalId).toBe('proposal-1');
      expect(typeof result.reached).toBe('boolean');
      expect(typeof result.decision).toBe('boolean');
      expect(result.totalVotes).toBeGreaterThan(0);
      expect(result.approvals + result.rejections).toBe(result.totalVotes);
    });

    it('should require quorum for consensus', async () => {
      const result = await coordinator.runDistributedConsensus(
        'proposal-2',
        [true, false, true, false]
      );

      if (result.totalVotes > 0) {
        expect(result.totalVotes).toBeGreaterThanOrEqual(3);
      }
    });

    it('should calculate confidence from vote agreement', async () => {
      const result = await coordinator.runDistributedConsensus(
        'proposal-3',
        [true, true, true]
      );

      expect(result.avgConfidence).toBeGreaterThan(0);
      expect(result.avgConfidence).toBeLessThanOrEqual(1);
    });

    it('should return consensus with participant list', async () => {
      const result = await coordinator.runDistributedConsensus(
        'proposal-4',
        [true, false, true]
      );

      expect(Array.isArray(result.participants)).toBe(true);
    });

    it('should measure consensus duration', async () => {
      const result = await coordinator.runDistributedConsensus(
        'proposal-5',
        [true, true, false]
      );

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Agent type dispatching', () => {
    beforeEach(async () => {
      await coordinator.registerAuthzAgents(1, 1, 1, 1);
    });

    it('should dispatch to GUARDIAN agents', async () => {
      const agents = coordinator.getAgentsByType('GUARDIAN');
      expect(agents.length).toBeGreaterThan(0);
    });

    it('should dispatch to ANALYST agents', async () => {
      const agents = coordinator.getAgentsByType('ANALYST');
      expect(agents.length).toBeGreaterThan(0);
    });

    it('should dispatch to ADVISOR agents', async () => {
      const agents = coordinator.getAgentsByType('ADVISOR');
      expect(agents.length).toBeGreaterThan(0);
    });

    it('should dispatch to ENFORCER agents', async () => {
      const agents = coordinator.getAgentsByType('ENFORCER');
      expect(agents.length).toBeGreaterThan(0);
    });
  });

  describe('Event handling', () => {
    it('should emit events for authorization pipeline', async () => {
      const events: any[] = [];
      coordinator.on('swarmEvent', (event: any) => {
        if (event.type === 'task_dispatched' || event.type === 'task_completed') {
          events.push(event);
        }
      });

      await coordinator.registerAuthzAgents(1, 1, 1, 1);

      const request: AuthorizationPipelineRequest = {
        requestId: 'test-event-req',
        subject: { id: 'user-123', type: 'user' },
        resource: { id: 'res-123', type: 'data' },
        action: 'read',
      };

      await coordinator.coordinateAuthzPipeline(request);

      expect(events.length).toBeGreaterThan(0);
    });
  });
});
