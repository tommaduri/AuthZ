/**
 * Agent Pool Tests
 *
 * Tests for AgentPool class including lifecycle management,
 * health checks, and scaling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AgentPool,
  DefaultAgentFactory,
  type AgentPoolConfig,
  type SpawnRequest,
  type AgentFactory,
  type HealthCheckResult,
  type SwarmAgent,
} from '../src/index.js';

// Mock agent factory for testing
class MockAgentFactory implements AgentFactory {
  private counter = 0;
  healthCheckResponses: Map<string, HealthCheckResult> = new Map();
  destroyedAgents: string[] = [];

  async create(request: SpawnRequest): Promise<SwarmAgent> {
    const id = `mock-agent-${++this.counter}`;
    return {
      id,
      type: request.type,
      status: 'idle',
      capabilities: request.capabilities ?? [],
      load: 0,
      metadata: {
        createdAt: new Date(),
        version: '1.0.0',
        tags: request.tags ?? [],
        priority: request.priority ?? 1,
        attributes: request.metadata ?? {},
      },
      lastHeartbeat: new Date(),
      connectionInfo: {
        host: 'localhost',
        port: 0,
        protocol: 'internal',
        secure: false,
      },
    };
  }

  async destroy(agentId: string): Promise<void> {
    this.destroyedAgents.push(agentId);
  }

  async healthCheck(agentId: string): Promise<HealthCheckResult> {
    return this.healthCheckResponses.get(agentId) ?? {
      agentId,
      healthy: true,
      latencyMs: 5,
      checkedAt: new Date(),
    };
  }

  setHealthy(agentId: string, healthy: boolean, error?: string): void {
    this.healthCheckResponses.set(agentId, {
      agentId,
      healthy,
      latencyMs: healthy ? 5 : 100,
      checkedAt: new Date(),
      error,
    });
  }
}

describe('DefaultAgentFactory', () => {
  it('should create agents with unique IDs', async () => {
    const factory = new DefaultAgentFactory();

    const agent1 = await factory.create({ type: 'GUARDIAN' });
    const agent2 = await factory.create({ type: 'GUARDIAN' });

    expect(agent1.id).not.toBe(agent2.id);
  });

  it('should create agents with correct type', async () => {
    const factory = new DefaultAgentFactory();

    const guardian = await factory.create({ type: 'GUARDIAN' });
    const analyst = await factory.create({ type: 'ANALYST' });

    expect(guardian.type).toBe('GUARDIAN');
    expect(analyst.type).toBe('ANALYST');
  });

  it('should create agents with capabilities', async () => {
    const factory = new DefaultAgentFactory();

    const agent = await factory.create({
      type: 'GUARDIAN',
      capabilities: ['detect', 'alert'],
    });

    expect(agent.capabilities).toContain('detect');
    expect(agent.capabilities).toContain('alert');
  });

  it('should return healthy for health checks', async () => {
    const factory = new DefaultAgentFactory();

    const result = await factory.healthCheck('any-id');

    expect(result.healthy).toBe(true);
  });
});

describe('AgentPool', () => {
  let pool: AgentPool;
  let factory: MockAgentFactory;
  const config: AgentPoolConfig = {
    minAgents: 2,
    maxAgents: 10,
    defaultAgentType: 'GUARDIAN',
    healthCheckIntervalMs: 100,
    healthCheckTimeoutMs: 50,
    unhealthyThresholdMs: 200,
    defaultCapabilities: ['analyze'],
  };

  beforeEach(() => {
    factory = new MockAgentFactory();
    pool = new AgentPool(config, factory);
  });

  afterEach(async () => {
    await pool.shutdown();
  });

  describe('initialization', () => {
    it('should initialize with minimum agents', async () => {
      const agents = await pool.initialize();

      expect(agents).toHaveLength(config.minAgents);
      expect(pool.size).toBe(config.minAgents);
    });

    it('should create agents with default type', async () => {
      const agents = await pool.initialize();

      expect(agents.every(a => a.type === 'GUARDIAN')).toBe(true);
    });

    it('should create agents with default capabilities', async () => {
      const agents = await pool.initialize();

      expect(agents.every(a => a.capabilities.includes('analyze'))).toBe(true);
    });
  });

  describe('spawning', () => {
    it('should spawn new agents', async () => {
      await pool.initialize();
      const initialSize = pool.size;

      const result = await pool.spawn({ type: 'ANALYST' });

      expect(result.agent).toBeDefined();
      expect(result.agent.type).toBe('ANALYST');
      expect(pool.size).toBe(initialSize + 1);
    });

    it('should spawn multiple agents', async () => {
      await pool.initialize();
      const initialSize = pool.size;

      const results = await pool.spawnMultiple(3, { type: 'ADVISOR' });

      expect(results).toHaveLength(3);
      expect(pool.size).toBe(initialSize + 3);
    });

    it('should throw when at max capacity', async () => {
      const smallConfig = { ...config, minAgents: 1, maxAgents: 2 };
      const smallPool = new AgentPool(smallConfig, factory);

      await smallPool.initialize();
      await smallPool.spawn({ type: 'ANALYST' });

      await expect(smallPool.spawn({ type: 'ENFORCER' })).rejects.toThrow(
        'Pool at maximum capacity'
      );

      await smallPool.shutdown();
    });

    it('should track spawn metrics', async () => {
      await pool.initialize();
      await pool.spawn({ type: 'ANALYST' });

      const metrics = pool.getMetrics();
      expect(metrics.spawned).toBe(3); // 2 from init + 1 manual
    });
  });

  describe('recycling', () => {
    it('should recycle agents', async () => {
      const agents = await pool.initialize();
      const agentId = agents[0]!.id;

      await pool.recycle(agentId);

      expect(pool.getAgent(agentId)).toBeUndefined();
      expect(factory.destroyedAgents).toContain(agentId);
    });

    it('should drain multiple agents', async () => {
      const agents = await pool.initialize();
      await pool.spawnMultiple(2, { type: 'ANALYST' });

      const ids = agents.map(a => a.id);
      await pool.drain(ids);

      expect(pool.size).toBe(2); // Only the 2 spawned after init
    });

    it('should track recycled count', async () => {
      const agents = await pool.initialize();
      await pool.recycle(agents[0]!.id);

      const metrics = pool.getMetrics();
      expect(metrics.recycled).toBe(1);
    });
  });

  describe('agent queries', () => {
    it('should get agent by ID', async () => {
      const agents = await pool.initialize();
      const agent = pool.getAgent(agents[0]!.id);

      expect(agent).toBeDefined();
      expect(agent?.id).toBe(agents[0]!.id);
    });

    it('should get all agents', async () => {
      await pool.initialize();

      const allAgents = pool.getAllAgents();
      expect(allAgents).toHaveLength(config.minAgents);
    });

    it('should filter by type', async () => {
      await pool.initialize();
      await pool.spawn({ type: 'ANALYST' });

      const guardians = pool.getAgentsByType('GUARDIAN');
      const analysts = pool.getAgentsByType('ANALYST');

      expect(guardians).toHaveLength(config.minAgents);
      expect(analysts).toHaveLength(1);
    });

    it('should filter by status', async () => {
      await pool.initialize();
      const agents = pool.getAllAgents();
      pool.updateAgentStatus(agents[0]!.id, 'busy');

      const idle = pool.getAgentsByStatus('idle');
      const busy = pool.getAgentsByStatus('busy');

      expect(idle).toHaveLength(config.minAgents - 1);
      expect(busy).toHaveLength(1);
    });

    it('should filter by capability', async () => {
      await pool.initialize();
      await pool.spawn({ type: 'ANALYST', capabilities: ['special'] });

      const withAnalyze = pool.getAgentsByCapability('analyze');
      const withSpecial = pool.getAgentsByCapability('special');

      expect(withAnalyze).toHaveLength(config.minAgents);
      expect(withSpecial).toHaveLength(1);
    });

    it('should get available agents by load', async () => {
      await pool.initialize();
      const agents = pool.getAllAgents();
      pool.updateAgentLoad(agents[0]!.id, 0.9);

      const available = pool.getAvailableAgents(0.8);

      expect(available).toHaveLength(config.minAgents - 1);
    });
  });

  describe('status and load updates', () => {
    it('should update agent status', async () => {
      const agents = await pool.initialize();
      const agentId = agents[0]!.id;

      pool.updateAgentStatus(agentId, 'busy');

      expect(pool.getAgent(agentId)?.status).toBe('busy');
    });

    it('should update agent load', async () => {
      const agents = await pool.initialize();
      const agentId = agents[0]!.id;

      pool.updateAgentLoad(agentId, 0.75);

      expect(pool.getAgent(agentId)?.load).toBe(0.75);
    });

    it('should clamp load to valid range', async () => {
      const agents = await pool.initialize();
      const agentId = agents[0]!.id;

      pool.updateAgentLoad(agentId, 1.5);
      expect(pool.getAgent(agentId)?.load).toBe(1);

      pool.updateAgentLoad(agentId, -0.5);
      expect(pool.getAgent(agentId)?.load).toBe(0);
    });

    it('should record heartbeat', async () => {
      const agents = await pool.initialize();
      const agentId = agents[0]!.id;
      const beforeHeartbeat = pool.getAgent(agentId)?.lastHeartbeat;

      // Wait a bit
      await new Promise(r => setTimeout(r, 10));

      pool.recordHeartbeat(agentId);
      const afterHeartbeat = pool.getAgent(agentId)?.lastHeartbeat;

      expect(afterHeartbeat!.getTime()).toBeGreaterThan(beforeHeartbeat!.getTime());
    });
  });

  describe('health checks', () => {
    it('should mark unhealthy agents', async () => {
      const agents = await pool.initialize();
      const agentId = agents[0]!.id;

      factory.setHealthy(agentId, false, 'Connection refused');

      // Wait for health check to run
      await new Promise(r => setTimeout(r, 150));

      expect(pool.getAgent(agentId)?.status).toBe('unhealthy');
    });

    it('should recover healthy agents', async () => {
      const agents = await pool.initialize();
      const agentId = agents[0]!.id;

      // Make unhealthy
      factory.setHealthy(agentId, false);
      await new Promise(r => setTimeout(r, 150));

      // Make healthy again
      factory.setHealthy(agentId, true);
      pool.recordHeartbeat(agentId);

      expect(pool.getAgent(agentId)?.status).toBe('idle');
    });

    it('should emit health check events', async () => {
      const agents = await pool.initialize();

      const events: any[] = [];
      pool.on('poolEvent', e => events.push(e));

      // Wait for health check
      await new Promise(r => setTimeout(r, 150));

      expect(events.some(e => e.type === 'agent_health_check')).toBe(true);
    });
  });

  describe('scaling', () => {
    it('should scale up', async () => {
      await pool.initialize();
      const initialSize = pool.size;

      await pool.scale(initialSize + 2);

      expect(pool.size).toBe(initialSize + 2);
    });

    it('should scale down', async () => {
      await pool.initialize();
      await pool.spawnMultiple(3, { type: 'ANALYST' });

      await pool.scale(config.minAgents);

      expect(pool.size).toBe(config.minAgents);
    });

    it('should respect minimum agents', async () => {
      await pool.initialize();

      await pool.scale(0);

      expect(pool.size).toBe(config.minAgents);
    });

    it('should respect maximum agents', async () => {
      await pool.initialize();

      await pool.scale(100);

      expect(pool.size).toBe(config.maxAgents);
    });
  });

  describe('auto-scaling', () => {
    it('should scale up when utilization exceeds threshold', async () => {
      const autoScaleConfig: AgentPoolConfig = {
        ...config,
        scaling: {
          enabled: true,
          targetUtilization: 0.5,
          scaleUpThreshold: 0.7,
          scaleDownThreshold: 0.3,
          cooldownMs: 0,
          maxScaleUp: 2,
          maxScaleDown: 1,
        },
      };
      const autoPool = new AgentPool(autoScaleConfig, factory);

      await autoPool.initialize();
      const agents = autoPool.getAllAgents();

      // Set high load
      agents.forEach(a => autoPool.updateAgentLoad(a.id, 0.9));

      await autoPool.checkAutoScaling();

      expect(autoPool.size).toBeGreaterThan(config.minAgents);

      await autoPool.shutdown();
    });

    it('should not scale during cooldown', async () => {
      const autoScaleConfig: AgentPoolConfig = {
        ...config,
        scaling: {
          enabled: true,
          targetUtilization: 0.5,
          scaleUpThreshold: 0.7,
          scaleDownThreshold: 0.3,
          cooldownMs: 10000, // Long cooldown
          maxScaleUp: 2,
          maxScaleDown: 1,
        },
      };
      const autoPool = new AgentPool(autoScaleConfig, factory);

      await autoPool.initialize();
      const initialSize = autoPool.size;
      const agents = autoPool.getAllAgents();

      // Trigger scaling
      agents.forEach(a => autoPool.updateAgentLoad(a.id, 0.9));
      await autoPool.checkAutoScaling();

      const afterFirstScale = autoPool.size;
      expect(afterFirstScale).toBeGreaterThan(initialSize);

      // Try scaling again (should be blocked by cooldown)
      await autoPool.checkAutoScaling();

      // Should not have scaled further
      expect(autoPool.size).toBe(afterFirstScale);

      await autoPool.shutdown();
    });
  });

  describe('metrics', () => {
    it('should track agent counts by status', async () => {
      await pool.initialize();
      const agents = pool.getAllAgents();
      pool.updateAgentStatus(agents[0]!.id, 'busy');

      const metrics = pool.getMetrics();

      expect(metrics.byStatus.idle).toBe(config.minAgents - 1);
      expect(metrics.byStatus.busy).toBe(1);
    });

    it('should track agent counts by type', async () => {
      await pool.initialize();
      await pool.spawn({ type: 'ANALYST' });

      const metrics = pool.getMetrics();

      expect(metrics.byType.GUARDIAN).toBe(config.minAgents);
      expect(metrics.byType.ANALYST).toBe(1);
    });

    it('should track total agents', async () => {
      await pool.initialize();

      const metrics = pool.getMetrics();

      expect(metrics.totalAgents).toBe(config.minAgents);
    });
  });

  describe('events', () => {
    it('should emit spawn events', async () => {
      await pool.initialize();

      const events: any[] = [];
      pool.on('poolEvent', e => events.push(e));

      await pool.spawn({ type: 'ANALYST' });

      expect(events.some(e => e.type === 'agent_spawned')).toBe(true);
    });

    it('should emit recycle events', async () => {
      const agents = await pool.initialize();

      const events: any[] = [];
      pool.on('poolEvent', e => events.push(e));

      await pool.recycle(agents[0]!.id);

      expect(events.some(e => e.type === 'agent_recycled')).toBe(true);
    });

    it('should emit scale events', async () => {
      const autoScaleConfig: AgentPoolConfig = {
        ...config,
        scaling: {
          enabled: true,
          targetUtilization: 0.5,
          scaleUpThreshold: 0.7,
          scaleDownThreshold: 0.3,
          cooldownMs: 0,
          maxScaleUp: 2,
          maxScaleDown: 1,
        },
      };
      const autoPool = new AgentPool(autoScaleConfig, factory);

      await autoPool.initialize();
      const agents = autoPool.getAllAgents();

      const events: any[] = [];
      autoPool.on('poolEvent', e => events.push(e));

      agents.forEach(a => autoPool.updateAgentLoad(a.id, 0.9));
      await autoPool.checkAutoScaling();

      expect(events.some(e => e.type === 'scale_up')).toBe(true);

      await autoPool.shutdown();
    });
  });

  describe('shutdown', () => {
    it('should recycle all agents on shutdown', async () => {
      await pool.initialize();
      const agents = pool.getAllAgents();
      const ids = agents.map(a => a.id);

      await pool.shutdown();

      ids.forEach(id => {
        expect(factory.destroyedAgents).toContain(id);
      });
    });

    it('should have zero agents after shutdown', async () => {
      await pool.initialize();
      await pool.shutdown();

      expect(pool.size).toBe(0);
    });
  });
});
