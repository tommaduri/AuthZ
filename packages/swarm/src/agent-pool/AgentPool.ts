/**
 * Agent Pool - Manages agent lifecycle, health, and scaling
 *
 * Responsibilities:
 * - Spawning and recycling agents
 * - Health monitoring
 * - Auto-scaling based on load
 * - Agent affinity and capability matching
 * - Authorization agent coordination
 */

import { EventEmitter } from 'eventemitter3';
import type { SwarmAgent, SwarmAgentType, AgentStatus } from '../topology/types.js';
import { AGENT_CAPABILITIES, AGENT_PRIORITY_WEIGHTS } from '../topology/types.js';
import type {
  AgentPoolConfig,
  SpawnRequest,
  SpawnResult,
  HealthCheckResult,
  AgentPoolMetrics,
  AgentPoolEvent,
  AgentPoolEventType,
  AgentFactory,
  AgentLifecycleState,
  AgentLifecycleEvent,
  AgentTypeConfig,
  ScalingRule,
} from './types.js';

/**
 * Authorization Agent Type enumeration
 *
 * Defines the four core authorization agent types for distributed
 * policy enforcement and consensus-based authorization decisions
 */
export enum AuthzAgentType {
  GUARDIAN = 'GUARDIAN',
  ANALYST = 'ANALYST',
  ADVISOR = 'ADVISOR',
  ENFORCER = 'ENFORCER',
}

/**
 * Default configurations for each agent type
 */
export const DEFAULT_AGENT_TYPE_CONFIGS: Record<SwarmAgentType, AgentTypeConfig> = {
  GUARDIAN: {
    capabilities: AGENT_CAPABILITIES.GUARDIAN,
    priorityWeight: AGENT_PRIORITY_WEIGHTS.GUARDIAN,
    maxConcurrentTasks: 10,
    warmupTimeMs: 500,
    cooldownTimeMs: 1000,
    supportedTaskTypes: ['authorization', 'threat-detection', 'policy-check'],
  },
  ANALYST: {
    capabilities: AGENT_CAPABILITIES.ANALYST,
    priorityWeight: AGENT_PRIORITY_WEIGHTS.ANALYST,
    maxConcurrentTasks: 5,
    warmupTimeMs: 1000,
    cooldownTimeMs: 500,
    supportedTaskTypes: ['analysis', 'risk-assessment', 'pattern-detection'],
  },
  ADVISOR: {
    capabilities: AGENT_CAPABILITIES.ADVISOR,
    priorityWeight: AGENT_PRIORITY_WEIGHTS.ADVISOR,
    maxConcurrentTasks: 8,
    warmupTimeMs: 200,
    cooldownTimeMs: 300,
    supportedTaskTypes: ['recommendation', 'optimization', 'compliance'],
  },
  ENFORCER: {
    capabilities: AGENT_CAPABILITIES.ENFORCER,
    priorityWeight: AGENT_PRIORITY_WEIGHTS.ENFORCER,
    maxConcurrentTasks: 15,
    warmupTimeMs: 100,
    cooldownTimeMs: 500,
    supportedTaskTypes: ['enforcement', 'rate-limit', 'block', 'allow'],
  },
  COORDINATOR: {
    capabilities: AGENT_CAPABILITIES.COORDINATOR,
    priorityWeight: AGENT_PRIORITY_WEIGHTS.COORDINATOR,
    maxConcurrentTasks: 20,
    warmupTimeMs: 1000,
    cooldownTimeMs: 2000,
    supportedTaskTypes: ['orchestration', 'consensus', 'failover'],
  },
};

/**
 * Default agent factory that creates in-memory agents
 */
export class DefaultAgentFactory implements AgentFactory {
  private agentCounter = 0;

  async create(request: SpawnRequest): Promise<SwarmAgent> {
    const id = `agent-${request.type.toLowerCase()}-${++this.agentCounter}-${Date.now()}`;

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

  async destroy(_agentId: string): Promise<void> {
    // In default implementation, nothing to clean up
  }

  async healthCheck(agentId: string): Promise<HealthCheckResult> {
    return {
      agentId,
      healthy: true,
      latencyMs: Math.random() * 10,
      checkedAt: new Date(),
    };
  }
}

/**
 * Agent Pool implementation
 */
export class AgentPool extends EventEmitter {
  private agents: Map<string, SwarmAgent> = new Map();
  private healthStatus: Map<string, HealthCheckResult> = new Map();
  private lifecycleStates: Map<string, AgentLifecycleState> = new Map();
  private agentTaskCounts: Map<string, number> = new Map();
  private scalingRules: Map<SwarmAgentType, ScalingRule> = new Map();
  private config: AgentPoolConfig;
  private factory: AgentFactory;
  private metrics: AgentPoolMetrics;
  private healthCheckInterval?: ReturnType<typeof setInterval>;
  private lastScalingTime: Date = new Date(0);
  private isRunning = false;

  constructor(config: AgentPoolConfig, factory?: AgentFactory) {
    super();
    this.config = config;
    this.factory = factory ?? new DefaultAgentFactory();
    this.metrics = this.initializeMetrics();
    this.initializeDefaultScalingRules();
  }

  /**
   * Initialize default scaling rules for each agent type
   */
  private initializeDefaultScalingRules(): void {
    const types: SwarmAgentType[] = ['GUARDIAN', 'ANALYST', 'ADVISOR', 'ENFORCER', 'COORDINATOR'];
    for (const type of types) {
      this.scalingRules.set(type, {
        agentType: type,
        minInstances: 1,
        maxInstances: Math.ceil(this.config.maxAgents / types.length),
        scaleUpLoadThreshold: 0.8,
        scaleDownLoadThreshold: 0.2,
        scaleUpQueueDepth: 10,
      });
    }
  }

  /**
   * Set scaling rule for a specific agent type
   */
  setScalingRule(rule: ScalingRule): void {
    this.scalingRules.set(rule.agentType, rule);
  }

  /**
   * Get scaling rule for an agent type
   */
  getScalingRule(type: SwarmAgentType): ScalingRule | undefined {
    return this.scalingRules.get(type);
  }

  private initializeMetrics(): AgentPoolMetrics {
    return {
      totalAgents: 0,
      byStatus: {
        idle: 0,
        busy: 0,
        unhealthy: 0,
        draining: 0,
        dead: 0,
      },
      byType: {},
      spawned: 0,
      recycled: 0,
      healthCheckFailures: 0,
      avgSpawnTimeMs: 0,
      avgHealthCheckLatencyMs: 0,
      updatedAt: new Date(),
    };
  }

  /**
   * Initialize the pool with minimum agents
   */
  async initialize(): Promise<SwarmAgent[]> {
    this.isRunning = true;
    const agents: SwarmAgent[] = [];

    // Spawn minimum required agents
    for (let i = 0; i < this.config.minAgents; i++) {
      const result = await this.spawn({
        type: this.config.defaultAgentType,
        capabilities: this.config.defaultCapabilities,
      });
      agents.push(result.agent);
    }

    // Start health check loop
    this.startHealthChecks();

    return agents;
  }

  /**
   * Shutdown the pool
   */
  async shutdown(): Promise<void> {
    this.isRunning = false;

    // Stop health checks
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    // Recycle all agents
    const agentIds = Array.from(this.agents.keys());
    await Promise.all(agentIds.map(id => this.recycle(id)));
  }

  /**
   * Spawn a new agent
   */
  async spawn(request: SpawnRequest): Promise<SpawnResult> {
    if (this.agents.size >= this.config.maxAgents) {
      throw new Error(`Pool at maximum capacity: ${this.config.maxAgents}`);
    }

    const startTime = Date.now();

    const agent = await this.factory.create(request);
    this.agents.set(agent.id, agent);

    const spawnTime = Date.now() - startTime;
    this.updateSpawnMetrics(agent, spawnTime);

    this.emitEvent('agent_spawned', { agentId: agent.id, type: agent.type, spawnTimeMs: spawnTime });

    return {
      agent,
      spawnTimeMs: spawnTime,
      fromPool: false,
    };
  }

  /**
   * Spawn multiple agents
   */
  async spawnMultiple(count: number, request: SpawnRequest): Promise<SpawnResult[]> {
    const results: SpawnResult[] = [];

    for (let i = 0; i < count; i++) {
      if (this.agents.size >= this.config.maxAgents) {
        break;
      }
      const result = await this.spawn(request);
      results.push(result);
    }

    return results;
  }

  /**
   * Recycle (remove) an agent
   */
  async recycle(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    // Mark as draining
    agent.status = 'draining';

    // Destroy via factory
    await this.factory.destroy(agentId);

    // Remove from pool
    this.agents.delete(agentId);
    this.healthStatus.delete(agentId);

    this.metrics.recycled++;
    this.updateStatusMetrics();

    this.emitEvent('agent_recycled', { agentId, type: agent.type });
  }

  /**
   * Drain multiple agents
   */
  async drain(agentIds: string[]): Promise<void> {
    await Promise.all(agentIds.map(id => this.recycle(id)));
  }

  /**
   * Get an agent by ID
   */
  getAgent(agentId: string): SwarmAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all agents
   */
  getAllAgents(): SwarmAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents by type
   */
  getAgentsByType(type: SwarmAgentType): SwarmAgent[] {
    return this.getAllAgents().filter(a => a.type === type);
  }

  /**
   * Get a single healthy agent by type with round-robin selection
   *
   * Prioritizes:
   * 1. Healthy agents
   * 2. Idle over busy
   * 3. Lower load
   *
   * @param type Agent type to retrieve
   * @returns Single agent of requested type, or undefined if none available
   */
  getAgentByType(type: SwarmAgentType): SwarmAgent | undefined {
    const candidates = this.getAgentsByType(type)
      .filter(a => {
        const health = this.healthStatus.get(a.id);
        return a.status !== 'dead' && a.status !== 'draining' &&
               (!health || health.healthy);
      })
      .sort((a, b) => {
        // Prefer idle over busy
        if (a.status !== b.status) {
          return a.status === 'idle' ? -1 : 1;
        }
        // Then by load (ascending - prefer lower load)
        return a.load - b.load;
      });

    return candidates[0];
  }

  /**
   * Get health status for all agents of a specific type
   *
   * @param type Agent type to check
   * @returns Array of health check results for agents of this type
   */
  getHealthStatusByType(type: SwarmAgentType): HealthCheckResult[] {
    const agents = this.getAgentsByType(type);
    return agents
      .map(a => this.healthStatus.get(a.id))
      .filter((h): h is HealthCheckResult => h !== undefined);
  }

  /**
   * Get healthy agent count by type
   *
   * @param type Agent type to count
   * @returns Number of healthy agents of this type
   */
  getHealthyAgentCountByType(type: SwarmAgentType): number {
    return this.getAgentsByType(type).filter(a => {
      const health = this.healthStatus.get(a.id);
      return a.status !== 'dead' && a.status !== 'draining' &&
             (!health || health.healthy);
    }).length;
  }

  /**
   * Get agents by status
   */
  getAgentsByStatus(status: AgentStatus): SwarmAgent[] {
    return this.getAllAgents().filter(a => a.status === status);
  }

  /**
   * Get agents by capability
   */
  getAgentsByCapability(capability: string): SwarmAgent[] {
    return this.getAllAgents().filter(a => a.capabilities.includes(capability));
  }

  /**
   * Get available (idle or busy but not overloaded) agents
   */
  getAvailableAgents(maxLoad: number = 0.8): SwarmAgent[] {
    return this.getAllAgents().filter(
      a => (a.status === 'idle' || a.status === 'busy') && a.load < maxLoad
    );
  }

  /**
   * Update agent status
   */
  updateAgentStatus(agentId: string, status: AgentStatus): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
      this.updateStatusMetrics();
    }
  }

  /**
   * Update agent load
   */
  updateAgentLoad(agentId: string, load: number): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.load = Math.max(0, Math.min(1, load));
    }
  }

  /**
   * Record heartbeat for an agent
   */
  recordHeartbeat(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.lastHeartbeat = new Date();

      // If agent was unhealthy, check if it should recover
      if (agent.status === 'unhealthy') {
        agent.status = 'idle';
        this.emitEvent('agent_recovered', { agentId });
      }
    }
  }

  /**
   * Get pool size
   */
  get size(): number {
    return this.agents.size;
  }

  /**
   * Get pool metrics
   */
  getMetrics(): AgentPoolMetrics {
    this.updateStatusMetrics();
    return { ...this.metrics };
  }

  /**
   * Get health status for an agent
   */
  getHealthStatus(agentId: string): HealthCheckResult | undefined {
    return this.healthStatus.get(agentId);
  }

  /**
   * Get lifecycle state for an agent
   */
  getLifecycleState(agentId: string): AgentLifecycleState | undefined {
    return this.lifecycleStates.get(agentId);
  }

  /**
   * Transition agent to a new lifecycle state
   */
  transitionLifecycle(agentId: string, newState: AgentLifecycleState, reason?: string): void {
    const previousState = this.lifecycleStates.get(agentId) ?? 'initializing';
    this.lifecycleStates.set(agentId, newState);

    const event: AgentLifecycleEvent = {
      agentId,
      previousState,
      newState,
      timestamp: new Date(),
      reason,
    };

    this.emit('lifecycleEvent', event);
    this.emitEvent('agent_lifecycle_changed' as AgentPoolEventType, {
      agentId,
      previousState,
      newState,
      reason,
    });
  }

  /**
   * Get agents by lifecycle state
   */
  getAgentsByLifecycle(state: AgentLifecycleState): SwarmAgent[] {
    return this.getAllAgents().filter(
      agent => this.lifecycleStates.get(agent.id) === state
    );
  }

  /**
   * Warm up an agent (prepare for active use)
   */
  async warmupAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    this.transitionLifecycle(agentId, 'warming_up', 'Starting warmup');

    const config = DEFAULT_AGENT_TYPE_CONFIGS[agent.type];
    await new Promise(resolve => setTimeout(resolve, config.warmupTimeMs));

    this.transitionLifecycle(agentId, 'ready', 'Warmup complete');
  }

  /**
   * Cool down an agent before recycling
   */
  async cooldownAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    this.transitionLifecycle(agentId, 'cooling_down', 'Starting cooldown');

    const config = DEFAULT_AGENT_TYPE_CONFIGS[agent.type];

    // Wait for active tasks to complete or timeout
    const taskCount = this.agentTaskCounts.get(agentId) ?? 0;
    if (taskCount > 0) {
      await new Promise(resolve => setTimeout(resolve, config.cooldownTimeMs));
    }

    this.transitionLifecycle(agentId, 'draining', 'Ready for recycling');
  }

  /**
   * Increment task count for an agent
   */
  incrementTaskCount(agentId: string): number {
    const current = this.agentTaskCounts.get(agentId) ?? 0;
    const newCount = current + 1;
    this.agentTaskCounts.set(agentId, newCount);

    // Update lifecycle to active if it was ready
    if (this.lifecycleStates.get(agentId) === 'ready') {
      this.transitionLifecycle(agentId, 'active', 'Task assigned');
    }

    return newCount;
  }

  /**
   * Decrement task count for an agent
   */
  decrementTaskCount(agentId: string): number {
    const current = this.agentTaskCounts.get(agentId) ?? 0;
    const newCount = Math.max(0, current - 1);
    this.agentTaskCounts.set(agentId, newCount);

    // Transition back to ready if no more tasks
    if (newCount === 0 && this.lifecycleStates.get(agentId) === 'active') {
      this.transitionLifecycle(agentId, 'ready', 'All tasks complete');
    }

    return newCount;
  }

  /**
   * Get task count for an agent
   */
  getTaskCount(agentId: string): number {
    return this.agentTaskCounts.get(agentId) ?? 0;
  }

  /**
   * Check if agent can accept more tasks
   */
  canAcceptTask(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    const lifecycle = this.lifecycleStates.get(agentId);
    if (lifecycle !== 'ready' && lifecycle !== 'active') return false;

    const config = DEFAULT_AGENT_TYPE_CONFIGS[agent.type];
    const currentTasks = this.agentTaskCounts.get(agentId) ?? 0;

    return currentTasks < config.maxConcurrentTasks;
  }

  /**
   * Spawn agents by type distribution
   */
  async spawnByTypeDistribution(
    distribution: Partial<Record<SwarmAgentType, number>>
  ): Promise<SpawnResult[]> {
    const results: SpawnResult[] = [];

    for (const [type, count] of Object.entries(distribution)) {
      const agentType = type as SwarmAgentType;
      const config = DEFAULT_AGENT_TYPE_CONFIGS[agentType];

      for (let i = 0; i < (count ?? 0); i++) {
        if (this.agents.size >= this.config.maxAgents) break;

        const result = await this.spawn({
          type: agentType,
          capabilities: config.capabilities,
          priority: config.priorityWeight,
        });

        // Warm up the agent
        await this.warmupAgent(result.agent.id);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Get available capacity by agent type
   */
  getCapacityByType(): Record<SwarmAgentType, { current: number; available: number; max: number }> {
    const capacity: Record<SwarmAgentType, { current: number; available: number; max: number }> = {
      GUARDIAN: { current: 0, available: 0, max: 0 },
      ANALYST: { current: 0, available: 0, max: 0 },
      ADVISOR: { current: 0, available: 0, max: 0 },
      ENFORCER: { current: 0, available: 0, max: 0 },
      COORDINATOR: { current: 0, available: 0, max: 0 },
    };

    for (const agent of this.agents.values()) {
      const config = DEFAULT_AGENT_TYPE_CONFIGS[agent.type];
      const taskCount = this.agentTaskCounts.get(agent.id) ?? 0;

      capacity[agent.type].current++;
      capacity[agent.type].max += config.maxConcurrentTasks;
      capacity[agent.type].available += config.maxConcurrentTasks - taskCount;
    }

    return capacity;
  }

  /**
   * Apply type-based auto-scaling
   */
  async checkTypeBasedScaling(): Promise<void> {
    const capacity = this.getCapacityByType();

    for (const [type, rule] of this.scalingRules) {
      const typeCapacity = capacity[type];
      const utilization = typeCapacity.max > 0
        ? 1 - (typeCapacity.available / typeCapacity.max)
        : 0;

      // Scale up if needed
      if (utilization > rule.scaleUpLoadThreshold && typeCapacity.current < rule.maxInstances) {
        await this.spawn({
          type,
          capabilities: DEFAULT_AGENT_TYPE_CONFIGS[type].capabilities,
        });
      }

      // Scale down if needed
      if (utilization < rule.scaleDownLoadThreshold && typeCapacity.current > rule.minInstances) {
        const candidates = this.getAgentsByType(type)
          .filter(a => this.canRecycle(a.id))
          .sort((a, b) => (this.agentTaskCounts.get(a.id) ?? 0) - (this.agentTaskCounts.get(b.id) ?? 0));

        if (candidates[0]) {
          await this.cooldownAgent(candidates[0].id);
          await this.recycle(candidates[0].id);
        }
      }
    }
  }

  /**
   * Check if agent can be recycled
   */
  private canRecycle(agentId: string): boolean {
    const lifecycle = this.lifecycleStates.get(agentId);
    const taskCount = this.agentTaskCounts.get(agentId) ?? 0;
    return taskCount === 0 && lifecycle !== 'draining' && lifecycle !== 'terminated';
  }

  /**
   * Manually trigger scaling
   */
  async scale(targetCount: number): Promise<void> {
    const current = this.agents.size;
    const target = Math.max(
      this.config.minAgents,
      Math.min(this.config.maxAgents, targetCount)
    );

    if (target > current) {
      await this.scaleUp(target - current);
    } else if (target < current) {
      await this.scaleDown(current - target);
    }
  }

  /**
   * Check if auto-scaling should trigger
   */
  async checkAutoScaling(): Promise<void> {
    if (!this.config.scaling?.enabled) {
      return;
    }

    const scaling = this.config.scaling;
    const now = new Date();

    // Check cooldown
    if (now.getTime() - this.lastScalingTime.getTime() < scaling.cooldownMs) {
      return;
    }

    // Calculate current utilization
    const agents = this.getAllAgents();
    const totalLoad = agents.reduce((sum, a) => sum + a.load, 0);
    const utilization = agents.length > 0 ? totalLoad / agents.length : 0;

    if (utilization > scaling.scaleUpThreshold && this.agents.size < this.config.maxAgents) {
      const scaleCount = Math.min(
        scaling.maxScaleUp,
        this.config.maxAgents - this.agents.size
      );
      await this.scaleUp(scaleCount);
      this.lastScalingTime = now;
    } else if (utilization < scaling.scaleDownThreshold && this.agents.size > this.config.minAgents) {
      const scaleCount = Math.min(
        scaling.maxScaleDown,
        this.agents.size - this.config.minAgents
      );
      await this.scaleDown(scaleCount);
      this.lastScalingTime = now;
    }
  }

  private async scaleUp(count: number): Promise<void> {
    const results = await this.spawnMultiple(count, {
      type: this.config.defaultAgentType,
      capabilities: this.config.defaultCapabilities,
    });

    this.metrics.lastScalingAction = {
      type: 'up',
      count: results.length,
      timestamp: new Date(),
    };

    this.emitEvent('scale_up', { count: results.length });
  }

  private async scaleDown(count: number): Promise<void> {
    // Select agents for removal (prefer idle, low priority)
    const candidates = this.getAllAgents()
      .filter(a => a.status === 'idle' || a.status === 'busy')
      .sort((a, b) => {
        // Prefer idle agents
        if (a.status !== b.status) {
          return a.status === 'idle' ? -1 : 1;
        }
        // Then by load (ascending)
        if (a.load !== b.load) {
          return a.load - b.load;
        }
        // Then by priority (ascending - remove low priority first)
        return a.metadata.priority - b.metadata.priority;
      });

    const toRemove = candidates.slice(0, count);
    await this.drain(toRemove.map(a => a.id));

    this.metrics.lastScalingAction = {
      type: 'down',
      count: toRemove.length,
      timestamp: new Date(),
    };

    this.emitEvent('scale_down', { count: toRemove.length });
  }

  private startHealthChecks(): void {
    if (this.healthCheckInterval) {
      return;
    }

    this.healthCheckInterval = setInterval(
      () => this.runHealthChecks(),
      this.config.healthCheckIntervalMs
    );
  }

  private async runHealthChecks(): Promise<void> {
    if (!this.isRunning) return;

    const agents = this.getAllAgents();
    const now = new Date();

    for (const agent of agents) {
      if (agent.status === 'dead' || agent.status === 'draining') {
        continue;
      }

      try {
        const result = await Promise.race([
          this.factory.healthCheck(agent.id),
          new Promise<HealthCheckResult>((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), this.config.healthCheckTimeoutMs)
          ),
        ]);

        this.healthStatus.set(agent.id, result);
        this.updateHealthMetrics(result);

        if (!result.healthy) {
          this.handleUnhealthyAgent(agent, result.error);
        } else if (agent.status === 'unhealthy') {
          agent.status = 'idle';
          this.emitEvent('agent_recovered', { agentId: agent.id });
        }

        this.emitEvent('agent_health_check', {
          agentId: agent.id,
          healthy: result.healthy,
          latencyMs: result.latencyMs,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.healthStatus.set(agent.id, {
          agentId: agent.id,
          healthy: false,
          latencyMs: this.config.healthCheckTimeoutMs,
          checkedAt: now,
          error: errorMessage,
        });

        this.handleUnhealthyAgent(agent, errorMessage);
      }
    }

    // Check auto-scaling after health checks
    await this.checkAutoScaling();
  }

  private handleUnhealthyAgent(agent: SwarmAgent, error?: string): void {
    const previousStatus = agent.status;
    agent.status = 'unhealthy';
    this.metrics.healthCheckFailures++;

    if (previousStatus !== 'unhealthy') {
      this.emitEvent('agent_unhealthy', { agentId: agent.id, error });
    }

    // Check if agent should be removed
    const healthResult = this.healthStatus.get(agent.id);
    if (healthResult) {
      const unhealthyDuration = Date.now() - healthResult.checkedAt.getTime();
      if (unhealthyDuration > this.config.unhealthyThresholdMs) {
        // Remove the agent
        agent.status = 'dead';
        this.recycle(agent.id).catch(() => {
          // Ignore errors during cleanup
        });
      }
    }
  }

  private updateSpawnMetrics(agent: SwarmAgent, spawnTimeMs: number): void {
    this.metrics.spawned++;
    this.metrics.totalAgents = this.agents.size;

    // Update average spawn time
    const total = this.metrics.avgSpawnTimeMs * (this.metrics.spawned - 1);
    this.metrics.avgSpawnTimeMs = (total + spawnTimeMs) / this.metrics.spawned;

    // Update by type
    this.metrics.byType[agent.type] = (this.metrics.byType[agent.type] ?? 0) + 1;

    this.updateStatusMetrics();
  }

  private updateStatusMetrics(): void {
    this.metrics.totalAgents = this.agents.size;
    this.metrics.byStatus = {
      idle: 0,
      busy: 0,
      unhealthy: 0,
      draining: 0,
      dead: 0,
    };

    for (const agent of this.agents.values()) {
      this.metrics.byStatus[agent.status]++;
    }

    this.metrics.updatedAt = new Date();
  }

  private updateHealthMetrics(_result: HealthCheckResult): void {
    // Rolling average of health check latency
    const checks = Array.from(this.healthStatus.values());
    const totalLatency = checks.reduce((sum, r) => sum + r.latencyMs, 0);
    this.metrics.avgHealthCheckLatencyMs = checks.length > 0 ? totalLatency / checks.length : 0;
  }

  private emitEvent(type: AgentPoolEventType, data: Record<string, unknown>): void {
    const event: AgentPoolEvent = {
      type,
      timestamp: new Date(),
      data,
    };
    this.emit('poolEvent', event);
  }
}
