/**
 * Load Balancer Types for Swarm Orchestration
 *
 * Defines interfaces for task distribution across agents
 */

import type { SwarmAgent } from '../topology/types.js';

/**
 * Supported load balancing strategies
 */
export type BalancingStrategy = 'round-robin' | 'weighted' | 'least-connections' | 'adaptive';

/**
 * Task priority levels
 */
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Task status
 */
export type TaskStatus = 'pending' | 'assigned' | 'running' | 'completed' | 'failed' | 'timeout';

/**
 * Task to be executed by an agent
 */
export interface Task {
  /** Unique task identifier */
  id: string;
  /** Type of task (determines which agent types can handle it) */
  type: string;
  /** Task priority */
  priority: TaskPriority;
  /** Task payload */
  payload: unknown;
  /** Required agent capabilities */
  requiredCapabilities?: string[];
  /** Preferred agent types */
  preferredAgentTypes?: string[];
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Retry count */
  retries?: number;
  /** Maximum retries allowed */
  maxRetries?: number;
  /** Created timestamp */
  createdAt: Date;
  /** Deadline (if any) */
  deadline?: Date;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of task assignment
 */
export interface TaskAssignment {
  /** Task ID */
  taskId: string;
  /** Assigned agent ID */
  agentId: string;
  /** Assignment timestamp */
  assignedAt: Date;
  /** Estimated completion time */
  estimatedCompletionMs?: number;
}

/**
 * Load balancer configuration
 */
export interface LoadBalancerConfig {
  /** Strategy to use */
  strategy: BalancingStrategy;
  /** Enable sticky sessions (prefer same agent for related tasks) */
  stickySession?: boolean;
  /** Maximum queue size per agent */
  maxQueueSize?: number;
  /** Health check interval in ms */
  healthCheckIntervalMs?: number;
  /** Threshold to consider agent overloaded (0-1) */
  overloadThreshold?: number;
  /** Enable automatic failover */
  autoFailover?: boolean;
  /** Weights for weighted strategy */
  weights?: Record<string, number>;
}

/**
 * Agent selection criteria
 */
export interface SelectionCriteria {
  /** Required agent types */
  agentTypes?: string[];
  /** Required capabilities */
  capabilities?: string[];
  /** Minimum health score */
  minHealthScore?: number;
  /** Maximum load */
  maxLoad?: number;
  /** Exclude agent IDs */
  excludeAgents?: string[];
  /** Prefer agents with specific tags */
  preferredTags?: string[];
}

/**
 * Load balancer metrics
 */
export interface LoadBalancerMetrics {
  /** Total tasks assigned */
  tasksAssigned: number;
  /** Tasks currently queued */
  tasksQueued: number;
  /** Tasks completed */
  tasksCompleted: number;
  /** Tasks failed */
  tasksFailed: number;
  /** Average assignment latency */
  avgAssignmentLatencyMs: number;
  /** Average task completion time */
  avgCompletionTimeMs: number;
  /** Agent utilization (0-1) */
  agentUtilization: number;
  /** Last updated */
  updatedAt: Date;
}

/**
 * Agent load information
 */
export interface AgentLoad {
  /** Agent ID */
  agentId: string;
  /** Current load (0-1) */
  load: number;
  /** Active task count */
  activeTasks: number;
  /** Queued task count */
  queuedTasks: number;
  /** Completed task count */
  completedTasks: number;
  /** Failed task count */
  failedTasks: number;
  /** Average processing time */
  avgProcessingTimeMs: number;
  /** Last activity timestamp */
  lastActivity: Date;
}

/**
 * Interface for load balancer strategy implementations
 */
export interface LoadBalancerStrategy {
  /** Strategy name */
  readonly name: BalancingStrategy;

  /**
   * Select an agent for a task
   * @param agents - Available agents
   * @param task - Task to assign
   * @param criteria - Optional selection criteria
   * @returns Selected agent or null if none available
   */
  selectAgent(
    agents: SwarmAgent[],
    task: Task,
    criteria?: SelectionCriteria
  ): SwarmAgent | null;

  /**
   * Rebalance load across agents
   * @param agents - All agents
   * @param loads - Current load information
   */
  rebalance(agents: SwarmAgent[], loads: Map<string, AgentLoad>): void;

  /**
   * Select agents for removal during scale-down
   * @param agents - All agents
   * @param count - Number to remove
   * @param loads - Current load information
   * @returns Agent IDs to remove
   */
  selectForRemoval(
    agents: SwarmAgent[],
    count: number,
    loads: Map<string, AgentLoad>
  ): string[];

  /**
   * Update strategy state after task completion
   * @param agentId - Agent that completed the task
   * @param taskId - Completed task ID
   * @param success - Whether task succeeded
   */
  recordCompletion(agentId: string, taskId: string, success: boolean): void;
}
