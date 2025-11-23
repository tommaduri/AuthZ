/**
 * Swarm Coordinator - Main orchestrator for swarm operations
 *
 * Ties together:
 * - Topology management
 * - Load balancing
 * - Agent pool management
 * - Task dispatching
 */

import { EventEmitter } from 'eventemitter3';
import { TopologyManager } from '../topology/TopologyManager.js';
import { LoadBalancer } from '../load-balancer/LoadBalancer.js';
import { AgentPool, DefaultAgentFactory } from '../agent-pool/AgentPool.js';
import type {
  TopologyConfig,
  SwarmAgent,
  TopologyType,
  TopologyMetrics,
} from '../topology/types.js';
import type {
  LoadBalancerConfig,
  Task,
  LoadBalancerMetrics,
  BalancingStrategy,
} from '../load-balancer/types.js';
import type {
  AgentPoolConfig,
  AgentPoolMetrics,
  SpawnRequest,
  AgentFactory,
} from '../agent-pool/types.js';

/**
 * Swarm configuration
 */
export interface SwarmConfig {
  /** Swarm identifier */
  id?: string;
  /** Topology configuration */
  topology: TopologyConfig;
  /** Load balancer configuration */
  loadBalancer: LoadBalancerConfig;
  /** Agent pool configuration */
  agentPool: AgentPoolConfig;
  /** Enable auto-optimization */
  autoOptimize?: boolean;
  /** Optimization interval in ms */
  optimizationIntervalMs?: number;
}

/**
 * Swarm instance state
 */
export interface SwarmInstance {
  /** Swarm ID */
  id: string;
  /** Current topology type */
  topology: TopologyType;
  /** Active agents */
  agents: Map<string, SwarmAgent>;
  /** Combined metrics */
  metrics: SwarmMetrics;
  /** Created timestamp */
  createdAt: Date;
  /** Last activity */
  lastActivity: Date;
}

/**
 * Combined swarm metrics
 */
export interface SwarmMetrics {
  topology: TopologyMetrics;
  loadBalancer: LoadBalancerMetrics;
  agentPool: AgentPoolMetrics;
  /** Tasks dispatched */
  tasksDispatched: number;
  /** Tasks completed */
  tasksCompleted: number;
  /** Tasks failed */
  tasksFailed: number;
  /** Average task latency */
  avgTaskLatencyMs: number;
  /** Swarm uptime */
  uptimeMs: number;
  /** Last updated */
  updatedAt: Date;
}

/**
 * Swarm event types
 */
export type SwarmEventType =
  | 'initialized'
  | 'shutdown'
  | 'task_dispatched'
  | 'task_completed'
  | 'task_failed'
  | 'agent_added'
  | 'agent_removed'
  | 'topology_changed'
  | 'optimized';

/**
 * Swarm event payload
 */
export interface SwarmEvent {
  type: SwarmEventType;
  timestamp: Date;
  swarmId: string;
  data: Record<string, unknown>;
}

/**
 * Task execution result
 */
export interface TaskResult<T = unknown> {
  /** Task ID */
  taskId: string;
  /** Whether task succeeded */
  success: boolean;
  /** Result data (if success) */
  data?: T;
  /** Error message (if failed) */
  error?: string;
  /** Agent that executed the task */
  agentId: string;
  /** Execution duration in ms */
  durationMs: number;
}

/**
 * Task executor function type
 */
export type TaskExecutor<T = unknown> = (
  agent: SwarmAgent,
  task: Task
) => Promise<T>;

/**
 * Swarm Coordinator - Main orchestration class
 */
export class SwarmCoordinator extends EventEmitter {
  private id: string;
  private config: SwarmConfig;
  private topologyManager: TopologyManager;
  private loadBalancer: LoadBalancer;
  private agentPool: AgentPool;
  private isInitialized = false;
  private startTime: Date = new Date();
  private taskMetrics = {
    dispatched: 0,
    completed: 0,
    failed: 0,
    totalLatencyMs: 0,
  };
  private optimizationInterval?: ReturnType<typeof setInterval>;
  private taskExecutors: Map<string, TaskExecutor> = new Map();
  private pendingTasks: Map<string, { task: Task; startTime: number }> = new Map();

  constructor(config: SwarmConfig, agentFactory?: AgentFactory) {
    super();
    this.id = config.id ?? `swarm-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.config = config;

    this.topologyManager = new TopologyManager(config.topology);
    this.loadBalancer = new LoadBalancer(config.loadBalancer);
    this.agentPool = new AgentPool(
      config.agentPool,
      agentFactory ?? new DefaultAgentFactory()
    );

    this.setupEventForwarding();
  }

  /**
   * Initialize the swarm
   */
  async initialize(): Promise<SwarmInstance> {
    if (this.isInitialized) {
      throw new Error('Swarm already initialized');
    }

    this.startTime = new Date();

    // Initialize agent pool
    const agents = await this.agentPool.initialize();

    // Setup topology
    this.topologyManager.connect(agents);

    // Initialize load balancer
    this.loadBalancer.initialize(agents);

    this.isInitialized = true;

    // Start optimization if enabled
    if (this.config.autoOptimize) {
      this.startOptimization();
    }

    this.emitEvent('initialized', { agentCount: agents.length });

    return this.getInstance();
  }

  /**
   * Shutdown the swarm
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    // Stop optimization
    if (this.optimizationInterval) {
      clearInterval(this.optimizationInterval);
      this.optimizationInterval = undefined;
    }

    // Shutdown agent pool
    await this.agentPool.shutdown();

    this.isInitialized = false;
    this.emitEvent('shutdown', {});
  }

  /**
   * Dispatch a task to the swarm
   */
  async dispatch<T>(task: Task): Promise<TaskResult<T>> {
    if (!this.isInitialized) {
      throw new Error('Swarm not initialized');
    }

    const startTime = Date.now();
    this.taskMetrics.dispatched++;

    // Assign task to an agent
    const assignment = this.loadBalancer.assign(task);

    if (!assignment) {
      // Try to scale up
      if (this.agentPool.size < this.config.agentPool.maxAgents) {
        await this.agentPool.scale(this.agentPool.size + 1);
        return this.dispatch(task);
      }

      this.taskMetrics.failed++;
      this.emitEvent('task_failed', { taskId: task.id, reason: 'No agents available' });

      return {
        taskId: task.id,
        success: false,
        error: 'No agents available',
        agentId: '',
        durationMs: Date.now() - startTime,
      };
    }

    this.pendingTasks.set(task.id, { task, startTime });
    this.emitEvent('task_dispatched', { taskId: task.id, agentId: assignment.agentId });

    // Execute task
    const agent = this.agentPool.getAgent(assignment.agentId);
    if (!agent) {
      this.taskMetrics.failed++;
      this.pendingTasks.delete(task.id);

      return {
        taskId: task.id,
        success: false,
        error: 'Agent not found',
        agentId: assignment.agentId,
        durationMs: Date.now() - startTime,
      };
    }

    // Update agent status
    this.agentPool.updateAgentStatus(agent.id, 'busy');

    try {
      // Execute with timeout
      const executor = this.taskExecutors.get(task.type);
      let result: T;

      if (executor) {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error('Task timeout')),
            task.timeoutMs ?? 30000
          );
        });

        result = await Promise.race([
          executor(agent, task) as Promise<T>,
          timeoutPromise,
        ]);
      } else {
        // Default execution - just return the payload
        result = task.payload as T;
      }

      const durationMs = Date.now() - startTime;
      this.recordTaskCompletion(task.id, agent.id, true, durationMs);

      return {
        taskId: task.id,
        success: true,
        data: result,
        agentId: agent.id,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.recordTaskCompletion(task.id, agent.id, false, durationMs);

      // Handle retries
      if ((task.retries ?? 0) < (task.maxRetries ?? 3)) {
        task.retries = (task.retries ?? 0) + 1;
        return this.dispatch(task);
      }

      return {
        taskId: task.id,
        success: false,
        error: errorMessage,
        agentId: agent.id,
        durationMs,
      };
    }
  }

  /**
   * Register a task executor
   */
  registerExecutor<T>(taskType: string, executor: TaskExecutor<T>): void {
    this.taskExecutors.set(taskType, executor as TaskExecutor);
  }

  /**
   * Scale the swarm
   */
  async scale(targetAgents: number): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Swarm not initialized');
    }

    const current = this.agentPool.size;
    await this.agentPool.scale(targetAgents);

    // Update topology and load balancer
    const agents = this.agentPool.getAllAgents();

    if (targetAgents > current) {
      const newAgents = agents.slice(current);
      this.topologyManager.addAgents(newAgents);
      this.loadBalancer.addAgents(newAgents);
    } else {
      const removedIds = this.loadBalancer.selectForRemoval(current - targetAgents);
      this.topologyManager.removeAgents(removedIds);
      for (const id of removedIds) {
        this.loadBalancer.removeAgent(id);
      }
    }
  }

  /**
   * Add an agent to the swarm
   */
  async addAgent(request: SpawnRequest): Promise<SwarmAgent> {
    if (!this.isInitialized) {
      throw new Error('Swarm not initialized');
    }

    const result = await this.agentPool.spawn(request);
    this.topologyManager.addAgents([result.agent]);
    this.loadBalancer.addAgent(result.agent);

    this.emitEvent('agent_added', { agentId: result.agent.id });

    return result.agent;
  }

  /**
   * Remove an agent from the swarm
   */
  async removeAgent(agentId: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Swarm not initialized');
    }

    await this.agentPool.recycle(agentId);
    this.topologyManager.removeAgents([agentId]);
    this.loadBalancer.removeAgent(agentId);

    this.emitEvent('agent_removed', { agentId });
  }

  /**
   * Get swarm instance
   */
  getInstance(): SwarmInstance {
    return {
      id: this.id,
      topology: this.topologyManager.getType(),
      agents: new Map(
        this.agentPool.getAllAgents().map(a => [a.id, a])
      ),
      metrics: this.getMetrics(),
      createdAt: this.startTime,
      lastActivity: new Date(),
    };
  }

  /**
   * Get combined metrics
   */
  getMetrics(): SwarmMetrics {
    const avgLatency = this.taskMetrics.completed > 0
      ? this.taskMetrics.totalLatencyMs / this.taskMetrics.completed
      : 0;

    return {
      topology: this.topologyManager.getMetrics(),
      loadBalancer: this.loadBalancer.getMetrics(),
      agentPool: this.agentPool.getMetrics(),
      tasksDispatched: this.taskMetrics.dispatched,
      tasksCompleted: this.taskMetrics.completed,
      tasksFailed: this.taskMetrics.failed,
      avgTaskLatencyMs: avgLatency,
      uptimeMs: Date.now() - this.startTime.getTime(),
      updatedAt: new Date(),
    };
  }

  /**
   * Get agent count
   */
  getAgentCount(): number {
    return this.agentPool.size;
  }

  /**
   * Get all agents
   */
  getAgents(): SwarmAgent[] {
    return this.agentPool.getAllAgents();
  }

  /**
   * Get topology type
   */
  getTopologyType(): TopologyType {
    return this.topologyManager.getType();
  }

  /**
   * Get load balancing strategy
   */
  getStrategy(): BalancingStrategy {
    return this.loadBalancer.getStrategy();
  }

  /**
   * Set load balancing strategy
   */
  setStrategy(strategy: BalancingStrategy): void {
    this.loadBalancer.setStrategy(strategy);
  }

  /**
   * Rebalance the swarm
   */
  rebalance(): void {
    this.topologyManager.rebalance();
    this.loadBalancer.rebalance();
  }

  /**
   * Optimize swarm configuration
   */
  optimize(): void {
    // Rebalance topology
    this.topologyManager.rebalance();

    // Rebalance load
    this.loadBalancer.rebalance();

    this.emitEvent('optimized', {});
  }

  private recordTaskCompletion(
    taskId: string,
    agentId: string,
    success: boolean,
    durationMs: number
  ): void {
    this.pendingTasks.delete(taskId);
    this.loadBalancer.completeTask(taskId, success, durationMs);

    // Update agent status
    this.agentPool.updateAgentStatus(agentId, 'idle');
    this.agentPool.recordHeartbeat(agentId);

    if (success) {
      this.taskMetrics.completed++;
      this.taskMetrics.totalLatencyMs += durationMs;
      this.emitEvent('task_completed', { taskId, agentId, durationMs });
    } else {
      this.taskMetrics.failed++;
      this.emitEvent('task_failed', { taskId, agentId, durationMs });
    }
  }

  private startOptimization(): void {
    const interval = this.config.optimizationIntervalMs ?? 60000;
    this.optimizationInterval = setInterval(() => {
      this.optimize();
    }, interval);
  }

  private setupEventForwarding(): void {
    // Forward events from sub-components
    this.topologyManager.on('topologyEvent', event => {
      this.emit('topologyEvent', event);
    });

    this.loadBalancer.on('loadBalancerEvent', event => {
      this.emit('loadBalancerEvent', event);
    });

    this.agentPool.on('poolEvent', event => {
      this.emit('poolEvent', event);
    });
  }

  private emitEvent(type: SwarmEventType, data: Record<string, unknown>): void {
    const event: SwarmEvent = {
      type,
      timestamp: new Date(),
      swarmId: this.id,
      data,
    };
    this.emit('swarmEvent', event);
  }
}

// Export factory function
export function createSwarm(config: SwarmConfig, agentFactory?: AgentFactory): SwarmCoordinator {
  return new SwarmCoordinator(config, agentFactory);
}
