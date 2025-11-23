/**
 * Tests for AgentPool authorization agent management
 *
 * Covers:
 * - AuthzAgentType enumeration
 * - Type-based agent retrieval
 * - Health checking by agent type
 * - Healthy agent counting
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentPool, AuthzAgentType } from '../src/agent-pool/AgentPool.js';
import type { AgentPoolConfig } from '../src/agent-pool/types.js';

describe('AgentPool Authorization Features', () => {
  let pool: AgentPool;

  const createTestConfig = (): AgentPoolConfig => ({
    minAgents: 0,
    maxAgents: 20,
    defaultAgentType: 'COORDINATOR',
    healthCheckIntervalMs: 1000,
    healthCheckTimeoutMs: 2000,
    unhealthyThresholdMs: 30000,
  });

  beforeEach(async () => {
    pool = new AgentPool(createTestConfig());
  });

  afterEach(async () => {
    await pool.shutdown();
  });

  describe('AuthzAgentType enum', () => {
    it('should have GUARDIAN agent type', () => {
      expect(AuthzAgentType.GUARDIAN).toBe('GUARDIAN');
    });

    it('should have ANALYST agent type', () => {
      expect(AuthzAgentType.ANALYST).toBe('ANALYST');
    });

    it('should have ADVISOR agent type', () => {
      expect(AuthzAgentType.ADVISOR).toBe('ADVISOR');
    });

    it('should have ENFORCER agent type', () => {
      expect(AuthzAgentType.ENFORCER).toBe('ENFORCER');
    });
  });

  describe('getAgentByType', () => {
    beforeEach(async () => {
      // Spawn multiple agents of each type
      for (let i = 0; i < 2; i++) {
        await pool.spawn({
          type: 'GUARDIAN',
          capabilities: ['threat-detection'],
        });
        await pool.spawn({
          type: 'ANALYST',
          capabilities: ['risk-assessment'],
        });
        await pool.spawn({
          type: 'ADVISOR',
          capabilities: ['recommendations'],
        });
        await pool.spawn({
          type: 'ENFORCER',
          capabilities: ['enforcement'],
        });
      }
    });

    it('should return a GUARDIAN agent by type', () => {
      const agent = pool.getAgentByType('GUARDIAN');
      expect(agent).toBeDefined();
      expect(agent?.type).toBe('GUARDIAN');
    });

    it('should return an ANALYST agent by type', () => {
      const agent = pool.getAgentByType('ANALYST');
      expect(agent).toBeDefined();
      expect(agent?.type).toBe('ANALYST');
    });

    it('should return an ADVISOR agent by type', () => {
      const agent = pool.getAgentByType('ADVISOR');
      expect(agent).toBeDefined();
      expect(agent?.type).toBe('ADVISOR');
    });

    it('should return an ENFORCER agent by type', () => {
      const agent = pool.getAgentByType('ENFORCER');
      expect(agent).toBeDefined();
      expect(agent?.type).toBe('ENFORCER');
    });

    it('should return undefined for non-existent agent type', () => {
      const agent = pool.getAgentByType('NONEXISTENT' as any);
      expect(agent).toBeUndefined();
    });

    it('should prefer healthy agents', () => {
      const agent = pool.getAgentByType('GUARDIAN');
      expect(agent).toBeDefined();
      expect(agent?.status).not.toBe('dead');
      expect(agent?.status).not.toBe('draining');
    });

    it('should prefer idle agents over busy', async () => {
      const guardians = pool.getAgentsByType('GUARDIAN');
      if (guardians.length > 1) {
        const busyAgent = guardians[0];
        pool.updateAgentStatus(busyAgent.id, 'busy');
        pool.updateAgentLoad(busyAgent.id, 0.8);

        const selected = pool.getAgentByType('GUARDIAN');
        expect(selected?.status).toBe('idle');
      }
    });

    it('should prefer lower load agents', async () => {
      const guardians = pool.getAgentsByType('GUARDIAN');
      if (guardians.length > 1) {
        pool.updateAgentLoad(guardians[0].id, 0.9);
        pool.updateAgentLoad(guardians[1].id, 0.1);

        const selected = pool.getAgentByType('GUARDIAN');
        expect(selected?.id).toBe(guardians[1].id);
      }
    });
  });

  describe('getHealthStatusByType', () => {
    beforeEach(async () => {
      for (let i = 0; i < 3; i++) {
        await pool.spawn({
          type: 'GUARDIAN',
          capabilities: ['threat-detection'],
        });
      }

      // Wait for initial health checks
      await new Promise(resolve => setTimeout(resolve, 1500));
    });

    it('should return health status for agent type', () => {
      const healthStatuses = pool.getHealthStatusByType('GUARDIAN');
      expect(Array.isArray(healthStatuses)).toBe(true);
    });

    it('should return health status for multiple agents', () => {
      const healthStatuses = pool.getHealthStatusByType('GUARDIAN');
      expect(healthStatuses.length).toBeGreaterThan(0);
    });

    it('should include healthy flag in status', () => {
      const healthStatuses = pool.getHealthStatusByType('GUARDIAN');
      for (const status of healthStatuses) {
        expect(typeof status.healthy).toBe('boolean');
      }
    });

    it('should include latency metrics', () => {
      const healthStatuses = pool.getHealthStatusByType('GUARDIAN');
      for (const status of healthStatuses) {
        expect(typeof status.latencyMs).toBe('number');
        expect(status.latencyMs).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('getHealthyAgentCountByType', () => {
    beforeEach(async () => {
      for (let i = 0; i < 2; i++) {
        await pool.spawn({
          type: 'ENFORCER',
          capabilities: ['enforcement'],
        });
      }
    });

    it('should return count of healthy agents', () => {
      const count = pool.getHealthyAgentCountByType('ENFORCER');
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should not count dead agents', async () => {
      const agents = pool.getAgentsByType('ENFORCER');
      if (agents.length > 0) {
        pool.updateAgentStatus(agents[0].id, 'dead');
        const count = pool.getHealthyAgentCountByType('ENFORCER');
        expect(count).toBeLessThan(agents.length);
      }
    });

    it('should not count draining agents', async () => {
      const agents = pool.getAgentsByType('ENFORCER');
      if (agents.length > 0) {
        pool.updateAgentStatus(agents[0].id, 'draining');
        const count = pool.getHealthyAgentCountByType('ENFORCER');
        expect(count).toBeLessThan(agents.length);
      }
    });

    it('should return 0 for agent type with no healthy agents', () => {
      const count = pool.getHealthyAgentCountByType('ANALYST');
      expect(count).toBe(0);
    });
  });

  describe('Agent type distribution', () => {
    it('should spawn multiple agent types with distribution', async () => {
      const results = await pool.spawnByTypeDistribution({
        GUARDIAN: 2,
        ANALYST: 1,
        ADVISOR: 2,
        ENFORCER: 1,
      });

      expect(results).toHaveLength(6);
      expect(
        results.filter(r => r.agent.type === 'GUARDIAN')
      ).toHaveLength(2);
      expect(
        results.filter(r => r.agent.type === 'ANALYST')
      ).toHaveLength(1);
      expect(
        results.filter(r => r.agent.type === 'ADVISOR')
      ).toHaveLength(2);
      expect(
        results.filter(r => r.agent.type === 'ENFORCER')
      ).toHaveLength(1);
    });

    it('should get capacity by type', async () => {
      await pool.spawnByTypeDistribution({
        GUARDIAN: 1,
        ANALYST: 1,
        ADVISOR: 1,
        ENFORCER: 1,
      });

      const capacity = pool.getCapacityByType();

      expect(capacity.GUARDIAN.current).toBeGreaterThan(0);
      expect(capacity.ANALYST.current).toBeGreaterThan(0);
      expect(capacity.ADVISOR.current).toBeGreaterThan(0);
      expect(capacity.ENFORCER.current).toBeGreaterThan(0);
    });
  });

  describe('Agent type scaling rules', () => {
    it('should initialize default scaling rules for all types', () => {
      const guardianRule = pool.getScalingRule('GUARDIAN');
      expect(guardianRule).toBeDefined();
      expect(guardianRule?.agentType).toBe('GUARDIAN');
      expect(guardianRule?.minInstances).toBeGreaterThan(0);
      expect(guardianRule?.maxInstances).toBeGreaterThan(0);
    });

    it('should set custom scaling rule for agent type', () => {
      pool.setScalingRule({
        agentType: 'ENFORCER',
        minInstances: 2,
        maxInstances: 8,
        scaleUpLoadThreshold: 0.85,
        scaleDownLoadThreshold: 0.25,
        scaleUpQueueDepth: 5,
      });

      const rule = pool.getScalingRule('ENFORCER');
      expect(rule?.minInstances).toBe(2);
      expect(rule?.maxInstances).toBe(8);
    });
  });
});
