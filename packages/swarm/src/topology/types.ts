/**
 * Topology Types for Swarm Orchestration
 *
 * Defines the interfaces and types for managing agent topologies
 * including mesh, hierarchical, ring, star, and adaptive configurations.
 */

/**
 * Supported topology types
 */
export type TopologyType = 'mesh' | 'hierarchical' | 'ring' | 'star' | 'adaptive';

/**
 * Agent types in the authorization swarm
 */
export type SwarmAgentType = 'GUARDIAN' | 'ANALYST' | 'ADVISOR' | 'ENFORCER' | 'COORDINATOR';

/**
 * Agent operational states
 */
export type AgentStatus = 'idle' | 'busy' | 'unhealthy' | 'draining' | 'dead';

/**
 * Configuration for topology setup
 */
export interface TopologyConfig {
  /** Type of topology to create */
  type: TopologyType;
  /** Maximum number of nodes in the topology */
  maxNodes: number;
  /** Replication factor for fault tolerance */
  replicationFactor: number;
  /** Enable automatic topology optimization */
  autoOptimize?: boolean;
  /** Timeout for node health checks in ms */
  healthCheckTimeoutMs?: number;
  /** Interval between topology rebalancing in ms */
  rebalanceIntervalMs?: number;
}

/**
 * Represents an agent in the swarm
 */
export interface SwarmAgent {
  /** Unique identifier for the agent */
  id: string;
  /** Type of agent (GUARDIAN, ANALYST, etc.) */
  type: SwarmAgentType;
  /** Current operational status */
  status: AgentStatus;
  /** Capabilities this agent provides */
  capabilities: string[];
  /** Current load (0-1, percentage) */
  load: number;
  /** Agent metadata */
  metadata: AgentMetadata;
  /** Last heartbeat timestamp */
  lastHeartbeat: Date;
  /** Connection info for communication */
  connectionInfo: ConnectionInfo;
}

/**
 * Agent metadata for tracking and routing
 */
export interface AgentMetadata {
  /** When the agent was spawned */
  createdAt: Date;
  /** Version of the agent */
  version: string;
  /** Tags for filtering/routing */
  tags: string[];
  /** Priority level (higher = prefer this agent) */
  priority: number;
  /** Custom attributes */
  attributes: Record<string, unknown>;
}

/**
 * Connection information for agent communication
 */
export interface ConnectionInfo {
  /** Host address */
  host: string;
  /** Port number */
  port: number;
  /** Protocol (tcp, http, grpc) */
  protocol: 'tcp' | 'http' | 'grpc' | 'internal';
  /** TLS enabled */
  secure: boolean;
}

/**
 * Connection between two agents in the topology
 */
export interface AgentConnection {
  /** Source agent ID */
  from: string;
  /** Target agent ID */
  to: string;
  /** Measured latency in milliseconds */
  latencyMs: number;
  /** Available bandwidth */
  bandwidth: number;
  /** Connection weight for routing decisions */
  weight: number;
  /** Whether this is an active connection */
  active: boolean;
  /** Last health check timestamp */
  lastCheck: Date;
}

/**
 * Route through the topology
 */
export interface TopologyRoute {
  /** Ordered list of agent IDs in the path */
  path: string[];
  /** Total latency of the route */
  totalLatencyMs: number;
  /** Number of hops */
  hops: number;
}

/**
 * Metrics for a topology instance
 */
export interface TopologyMetrics {
  /** Number of active agents */
  activeAgents: number;
  /** Number of connections */
  totalConnections: number;
  /** Average latency across connections */
  avgLatencyMs: number;
  /** Topology health score (0-1) */
  healthScore: number;
  /** Messages routed */
  messagesRouted: number;
  /** Failed routes */
  failedRoutes: number;
  /** Last updated timestamp */
  updatedAt: Date;
}

/**
 * Event types emitted by topology manager
 */
export type TopologyEventType =
  | 'agent_added'
  | 'agent_removed'
  | 'agent_status_changed'
  | 'connection_established'
  | 'connection_lost'
  | 'topology_rebalanced'
  | 'leader_elected'
  | 'split_brain_detected';

/**
 * Topology event payload
 */
export interface TopologyEvent {
  /** Event type */
  type: TopologyEventType;
  /** Timestamp */
  timestamp: Date;
  /** Agent involved (if applicable) */
  agentId?: string;
  /** Additional event data */
  data: Record<string, unknown>;
}

/**
 * Interface for topology implementations
 */
export interface Topology {
  /** Get the topology type */
  readonly type: TopologyType;

  /**
   * Connect agents according to topology rules
   * @param agents - Agents to connect
   * @returns Created connections
   */
  connect(agents: SwarmAgent[]): AgentConnection[];

  /**
   * Add agents to existing topology
   * @param agents - New agents to add
   */
  addAgents(agents: SwarmAgent[]): AgentConnection[];

  /**
   * Remove agents from topology
   * @param agentIds - IDs of agents to remove
   */
  removeAgents(agentIds: string[]): void;

  /**
   * Find optimal route between agents
   * @param from - Source agent ID
   * @param to - Target agent ID
   * @returns Route or null if unreachable
   */
  route(from: string, to: string): TopologyRoute | null;

  /**
   * Get all connections
   */
  getConnections(): AgentConnection[];

  /**
   * Get neighbors of an agent
   * @param agentId - Agent to get neighbors for
   */
  getNeighbors(agentId: string): string[];

  /**
   * Rebalance the topology
   */
  rebalance(): void;

  /**
   * Get topology metrics
   */
  getMetrics(): TopologyMetrics;
}

/**
 * Factory function type for creating topologies
 */
export type TopologyFactory = (config: TopologyConfig) => Topology;
