/**
 * @authz-engine/swarm
 *
 * Swarm Orchestration Layer for AuthZ Engine
 *
 * Provides:
 * - Topology management (mesh, hierarchical, ring, star, adaptive)
 * - Load balancing (round-robin, weighted, least-connections, adaptive)
 * - Agent pool management with health checks and auto-scaling
 * - Swarm coordination and task dispatching
 */

// Topology exports
export {
  // Types
  type TopologyType,
  type SwarmAgentType,
  type AgentStatus,
  type TopologyConfig,
  type SwarmAgent,
  type AgentMetadata,
  type ConnectionInfo,
  type AgentConnection,
  type TopologyRoute,
  type TopologyMetrics,
  type TopologyEventType,
  type TopologyEvent,
  type Topology,
  type TopologyFactory,
  // Classes
  TopologyManager,
  MeshTopology,
  HierarchicalTopology,
  RingTopology,
  StarTopology,
  AdaptiveTopology,
} from './topology/index.js';

// Load Balancer exports
export {
  // Types
  type BalancingStrategy,
  type TaskPriority,
  type TaskStatus,
  type Task,
  type TaskAssignment,
  type LoadBalancerConfig,
  type SelectionCriteria,
  type LoadBalancerMetrics,
  type AgentLoad,
  type LoadBalancerStrategy,
  // Classes
  LoadBalancer,
  RoundRobinStrategy,
  WeightedStrategy,
  LeastConnectionsStrategy,
  AdaptiveStrategy,
} from './load-balancer/index.js';

// Agent Pool exports
export {
  // Types
  type AgentPoolConfig,
  type ScalingConfig,
  type SpawnRequest,
  type SpawnResult,
  type HealthCheckResult,
  type AgentPoolMetrics,
  type AgentPoolEventType,
  type AgentPoolEvent,
  type AgentFactory,
  // Classes
  AgentPool,
  DefaultAgentFactory,
} from './agent-pool/index.js';

// Coordinator exports
export {
  SwarmCoordinator,
  createSwarm,
  type SwarmConfig,
  type SwarmInstance,
  type SwarmMetrics,
  type SwarmEventType,
  type SwarmEvent,
  type TaskResult,
  type TaskExecutor,
} from './coordinator/index.js';
