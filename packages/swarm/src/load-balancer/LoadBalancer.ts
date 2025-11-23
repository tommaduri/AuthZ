/**
 * Load Balancer - Distributes tasks across swarm agents
 *
 * Supports multiple strategies:
 * - Round-robin: Fair distribution
 * - Weighted: Priority-based distribution
 * - Least-connections: Distribute to least loaded
 * - Adaptive: Dynamic strategy based on patterns
 */

import { EventEmitter } from 'eventemitter3';
import type { SwarmAgent } from '../topology/types.js';
import type {
  LoadBalancerConfig,
  LoadBalancerStrategy,
  LoadBalancerMetrics,
  Task,
  TaskAssignment,
  SelectionCriteria,
  AgentLoad,
  BalancingStrategy,
} from './types.js';
import {
  RoundRobinStrategy,
  WeightedStrategy,
  LeastConnectionsStrategy,
  AdaptiveStrategy,
} from './strategies/index.js';

/**
 * Events emitted by the load balancer
 */
export type LoadBalancerEventType =
  | 'task_assigned'
  | 'task_completed'
  | 'task_failed'
  | 'no_agents_available'
  | 'agent_overloaded'
  | 'rebalance_triggered';

export interface LoadBalancerEvent {
  type: LoadBalancerEventType;
  timestamp: Date;
  taskId?: string;
  agentId?: string;
  data?: Record<string, unknown>;
}

/**
 * Load Balancer implementation
 */
export class LoadBalancer extends EventEmitter {
  private strategy: LoadBalancerStrategy;
  private config: LoadBalancerConfig;
  private agents: Map<string, SwarmAgent> = new Map();
  private agentLoads: Map<string, AgentLoad> = new Map();
  private taskAssignments: Map<string, TaskAssignment> = new Map();
  private taskQueue: Task[] = [];
  private metrics: LoadBalancerMetrics;

  constructor(config: LoadBalancerConfig) {
    super();
    this.config = config;
    this.strategy = this.createStrategy(config.strategy);
    this.metrics = {
      tasksAssigned: 0,
      tasksQueued: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      avgAssignmentLatencyMs: 0,
      avgCompletionTimeMs: 0,
      agentUtilization: 0,
      updatedAt: new Date(),
    };
  }

  private createStrategy(strategyType: BalancingStrategy): LoadBalancerStrategy {
    switch (strategyType) {
      case 'round-robin':
        return new RoundRobinStrategy();
      case 'weighted':
        return new WeightedStrategy(this.config.weights);
      case 'least-connections':
        return new LeastConnectionsStrategy();
      case 'adaptive':
        return new AdaptiveStrategy();
      default:
        throw new Error(`Unknown strategy: ${strategyType}`);
    }
  }

  /**
   * Initialize agents for load balancing
   */
  initialize(agents: SwarmAgent[]): void {
    for (const agent of agents) {
      this.addAgent(agent);
    }
  }

  /**
   * Add an agent to the pool
   */
  addAgent(agent: SwarmAgent): void {
    this.agents.set(agent.id, agent);
    this.agentLoads.set(agent.id, {
      agentId: agent.id,
      load: agent.load,
      activeTasks: 0,
      queuedTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      avgProcessingTimeMs: 0,
      lastActivity: new Date(),
    });

    // Process any queued tasks
    this.processQueue();
  }

  /**
   * Add multiple agents
   */
  addAgents(agents: SwarmAgent[]): void {
    for (const agent of agents) {
      this.addAgent(agent);
    }
  }

  /**
   * Remove an agent from the pool
   */
  removeAgent(agentId: string): void {
    this.agents.delete(agentId);
    this.agentLoads.delete(agentId);

    // Reassign any tasks from this agent
    for (const [taskId, assignment] of this.taskAssignments) {
      if (assignment.agentId === agentId) {
        this.taskAssignments.delete(taskId);
        // Task will need to be resubmitted by the coordinator
      }
    }
  }

  /**
   * Update agent status
   */
  updateAgent(agentId: string, updates: Partial<SwarmAgent>): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      Object.assign(agent, updates);

      // Update load tracking
      const load = this.agentLoads.get(agentId);
      if (load && updates.load !== undefined) {
        load.load = updates.load;
      }
    }
  }

  /**
   * Select an agent for a task
   */
  selectAgent(task: Task, criteria?: SelectionCriteria): SwarmAgent | null {
    const startTime = Date.now();
    const agentList = Array.from(this.agents.values());

    // Apply overload filter
    const availableAgents = agentList.filter(agent => {
      if (this.config.overloadThreshold) {
        return agent.load < this.config.overloadThreshold;
      }
      return true;
    });

    if (availableAgents.length === 0) {
      this.emitEvent('no_agents_available', { taskId: task.id });
      return null;
    }

    const selected = this.strategy.selectAgent(availableAgents, task, criteria);

    // Update metrics
    const latency = Date.now() - startTime;
    this.updateAssignmentLatency(latency);

    return selected;
  }

  /**
   * Assign a task to an agent
   */
  assign(task: Task, criteria?: SelectionCriteria): TaskAssignment | null {
    const agent = this.selectAgent(task, criteria);

    if (!agent) {
      // Queue the task if no agent available
      if (this.config.maxQueueSize && this.taskQueue.length < this.config.maxQueueSize) {
        this.taskQueue.push(task);
        this.metrics.tasksQueued++;
        return null;
      }
      return null;
    }

    const assignment: TaskAssignment = {
      taskId: task.id,
      agentId: agent.id,
      assignedAt: new Date(),
    };

    this.taskAssignments.set(task.id, assignment);

    // Update agent load
    const load = this.agentLoads.get(agent.id);
    if (load) {
      load.activeTasks++;
      load.lastActivity = new Date();
    }

    this.metrics.tasksAssigned++;
    this.emitEvent('task_assigned', { taskId: task.id, agentId: agent.id });

    return assignment;
  }

  /**
   * Record task completion
   */
  completeTask(taskId: string, success: boolean, durationMs?: number): void {
    const assignment = this.taskAssignments.get(taskId);

    if (assignment) {
      const load = this.agentLoads.get(assignment.agentId);
      if (load) {
        load.activeTasks = Math.max(0, load.activeTasks - 1);
        load.lastActivity = new Date();

        if (success) {
          load.completedTasks++;
          if (durationMs !== undefined) {
            // Update rolling average
            const total = load.avgProcessingTimeMs * (load.completedTasks - 1);
            load.avgProcessingTimeMs = (total + durationMs) / load.completedTasks;
          }
          this.metrics.tasksCompleted++;
        } else {
          load.failedTasks++;
          this.metrics.tasksFailed++;
        }
      }

      // Notify strategy
      this.strategy.recordCompletion(assignment.agentId, taskId, success);

      this.taskAssignments.delete(taskId);
      this.emitEvent(success ? 'task_completed' : 'task_failed', {
        taskId,
        agentId: assignment.agentId,
        durationMs,
      });
    }

    // Process queued tasks
    this.processQueue();
  }

  /**
   * Rebalance load across agents
   */
  rebalance(): void {
    const agentList = Array.from(this.agents.values());
    this.strategy.rebalance(agentList, this.agentLoads);
    this.updateMetrics();
    this.emitEvent('rebalance_triggered', {});
  }

  /**
   * Select agents for removal (scale down)
   */
  selectForRemoval(count: number): string[] {
    const agentList = Array.from(this.agents.values());
    return this.strategy.selectForRemoval(agentList, count, this.agentLoads);
  }

  /**
   * Get current metrics
   */
  getMetrics(): LoadBalancerMetrics {
    this.updateMetrics();
    return { ...this.metrics };
  }

  /**
   * Get agent load information
   */
  getAgentLoad(agentId: string): AgentLoad | undefined {
    return this.agentLoads.get(agentId);
  }

  /**
   * Get all agent loads
   */
  getAllAgentLoads(): Map<string, AgentLoad> {
    return new Map(this.agentLoads);
  }

  /**
   * Get task assignment
   */
  getTaskAssignment(taskId: string): TaskAssignment | undefined {
    return this.taskAssignments.get(taskId);
  }

  /**
   * Get queue size
   */
  getQueueSize(): number {
    return this.taskQueue.length;
  }

  /**
   * Change load balancing strategy
   */
  setStrategy(strategyType: BalancingStrategy): void {
    this.strategy = this.createStrategy(strategyType);
    this.config.strategy = strategyType;
  }

  /**
   * Get current strategy
   */
  getStrategy(): BalancingStrategy {
    return this.strategy.name;
  }

  private processQueue(): void {
    while (this.taskQueue.length > 0) {
      const task = this.taskQueue[0];
      if (!task) break;

      const assignment = this.assign(task);
      if (assignment) {
        this.taskQueue.shift();
        this.metrics.tasksQueued--;
      } else {
        // No agent available, stop processing
        break;
      }
    }
  }

  private updateAssignmentLatency(latencyMs: number): void {
    const totalLatency = this.metrics.avgAssignmentLatencyMs * this.metrics.tasksAssigned;
    this.metrics.avgAssignmentLatencyMs =
      (totalLatency + latencyMs) / (this.metrics.tasksAssigned + 1);
  }

  private updateMetrics(): void {
    // Calculate agent utilization
    let totalLoad = 0;
    let agentCount = 0;

    for (const load of this.agentLoads.values()) {
      totalLoad += load.load;
      agentCount++;
    }

    this.metrics.agentUtilization = agentCount > 0 ? totalLoad / agentCount : 0;
    this.metrics.tasksQueued = this.taskQueue.length;
    this.metrics.updatedAt = new Date();
  }

  private emitEvent(
    type: LoadBalancerEventType,
    data: Record<string, unknown>
  ): void {
    const event: LoadBalancerEvent = {
      type,
      timestamp: new Date(),
      ...data,
    };
    this.emit('loadBalancerEvent', event);
  }
}
