/**
 * Agent Pool Types
 *
 * Defines interfaces for agent lifecycle management, scaling, and health checks
 */

import type { SwarmAgent, SwarmAgentType, AgentStatus } from '../topology/types.js';

/**
 * Configuration for agent pool
 */
export interface AgentPoolConfig {
  /** Minimum number of agents to maintain */
  minAgents: number;
  /** Maximum number of agents allowed */
  maxAgents: number;
  /** Default agent type for new spawns */
  defaultAgentType: SwarmAgentType;
  /** Health check interval in milliseconds */
  healthCheckIntervalMs: number;
  /** Timeout for health checks */
  healthCheckTimeoutMs: number;
  /** Time before unhealthy agent is removed */
  unhealthyThresholdMs: number;
  /** Auto-scaling configuration */
  scaling?: ScalingConfig;
  /** Default capabilities for new agents */
  defaultCapabilities?: string[];
}

/**
 * Auto-scaling configuration
 */
export interface ScalingConfig {
  /** Enable auto-scaling */
  enabled: boolean;
  /** Target utilization (0-1) */
  targetUtilization: number;
  /** Scale up threshold */
  scaleUpThreshold: number;
  /** Scale down threshold */
  scaleDownThreshold: number;
  /** Cooldown period between scaling actions (ms) */
  cooldownMs: number;
  /** Maximum scale up per action */
  maxScaleUp: number;
  /** Maximum scale down per action */
  maxScaleDown: number;
}

/**
 * Agent spawn request
 */
export interface SpawnRequest {
  /** Requested agent type */
  type: SwarmAgentType;
  /** Requested capabilities */
  capabilities?: string[];
  /** Priority level */
  priority?: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
  /** Tags for the agent */
  tags?: string[];
}

/**
 * Agent spawn result
 */
export interface SpawnResult {
  /** Spawned agent */
  agent: SwarmAgent;
  /** Time to spawn in ms */
  spawnTimeMs: number;
  /** Whether spawn was from pool or new */
  fromPool: boolean;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  /** Agent ID */
  agentId: string;
  /** Whether agent is healthy */
  healthy: boolean;
  /** Latency of health check */
  latencyMs: number;
  /** Timestamp of check */
  checkedAt: Date;
  /** Error message if unhealthy */
  error?: string;
  /** Detailed health info */
  details?: {
    memoryUsage?: number;
    cpuUsage?: number;
    activeConnections?: number;
    uptime?: number;
  };
}

/**
 * Agent pool metrics
 */
export interface AgentPoolMetrics {
  /** Total agents in pool */
  totalAgents: number;
  /** Agents by status */
  byStatus: Record<AgentStatus, number>;
  /** Agents by type */
  byType: Record<string, number>;
  /** Agents spawned */
  spawned: number;
  /** Agents recycled */
  recycled: number;
  /** Agents failed health check */
  healthCheckFailures: number;
  /** Average spawn time */
  avgSpawnTimeMs: number;
  /** Average health check latency */
  avgHealthCheckLatencyMs: number;
  /** Last scaling action */
  lastScalingAction?: {
    type: 'up' | 'down';
    count: number;
    timestamp: Date;
  };
  /** Updated timestamp */
  updatedAt: Date;
}

/**
 * Event types emitted by agent pool
 */
export type AgentPoolEventType =
  | 'agent_spawned'
  | 'agent_recycled'
  | 'agent_health_check'
  | 'agent_unhealthy'
  | 'agent_recovered'
  | 'scale_up'
  | 'scale_down'
  | 'pool_exhausted';

/**
 * Agent pool event payload
 */
export interface AgentPoolEvent {
  type: AgentPoolEventType;
  timestamp: Date;
  agentId?: string;
  data: Record<string, unknown>;
}

/**
 * Agent factory interface
 */
export interface AgentFactory {
  /**
   * Create a new agent
   */
  create(request: SpawnRequest): Promise<SwarmAgent>;

  /**
   * Destroy an agent
   */
  destroy(agentId: string): Promise<void>;

  /**
   * Check agent health
   */
  healthCheck(agentId: string): Promise<HealthCheckResult>;
}

/**
 * Agent lifecycle state
 */
export type AgentLifecycleState =
  | 'initializing'
  | 'ready'
  | 'warming_up'
  | 'active'
  | 'cooling_down'
  | 'draining'
  | 'terminated';

/**
 * Agent lifecycle event
 */
export interface AgentLifecycleEvent {
  agentId: string;
  previousState: AgentLifecycleState;
  newState: AgentLifecycleState;
  timestamp: Date;
  reason?: string;
}

/**
 * Agent type-specific configuration
 */
export interface AgentTypeConfig {
  /** Default capabilities for this agent type */
  capabilities: string[];
  /** Priority weight for load balancing */
  priorityWeight: number;
  /** Maximum concurrent tasks */
  maxConcurrentTasks: number;
  /** Warmup time in ms */
  warmupTimeMs: number;
  /** Cooldown time before recycling in ms */
  cooldownTimeMs: number;
  /** Task types this agent can handle */
  supportedTaskTypes: string[];
}

/**
 * Dynamic scaling rule
 */
export interface ScalingRule {
  /** Agent type this rule applies to */
  agentType: SwarmAgentType;
  /** Minimum instances of this type */
  minInstances: number;
  /** Maximum instances of this type */
  maxInstances: number;
  /** Load threshold to trigger scale up */
  scaleUpLoadThreshold: number;
  /** Load threshold to trigger scale down */
  scaleDownLoadThreshold: number;
  /** Queue depth to trigger scale up */
  scaleUpQueueDepth: number;
}

/**
 * Work stealing configuration
 */
export interface WorkStealingConfig {
  /** Enable work stealing */
  enabled: boolean;
  /** Load threshold below which agent can steal work */
  stealThreshold: number;
  /** Maximum tasks to steal at once */
  maxStealCount: number;
  /** Interval to check for stealing opportunities */
  checkIntervalMs: number;
}

/**
 * Sticky session configuration
 */
export interface StickySessionConfig {
  /** Enable sticky sessions */
  enabled: boolean;
  /** Session affinity key extractor */
  affinityKey: 'user' | 'resource' | 'tenant' | 'custom';
  /** TTL for session affinity in ms */
  affinityTtlMs: number;
  /** Maximum sessions per agent */
  maxSessionsPerAgent: number;
}
