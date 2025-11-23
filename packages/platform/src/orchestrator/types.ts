/**
 * Platform Orchestrator Types
 *
 * Defines configuration and interfaces for the master platform orchestrator
 * that coordinates all subsystems: swarm, neural, consensus, memory, and agents.
 */

import type { AgentType, AgentState, Priority } from '@authz-engine/agents';
import type { CheckRequest, CheckResponse } from '@authz-engine/core';

// =============================================================================
// Topology Configuration (for future @authz-engine/swarm package)
// =============================================================================

export type TopologyType = 'mesh' | 'hierarchical' | 'ring' | 'star' | 'adaptive';
export type BalancingStrategy = 'round-robin' | 'weighted' | 'least-connections' | 'adaptive';

export interface TopologyConfig {
  type: TopologyType;
  maxConnections?: number;
  failoverEnabled?: boolean;
}

export interface LoadBalancerConfig {
  strategy: BalancingStrategy;
  healthCheckIntervalMs?: number;
  failoverThreshold?: number;
}

export interface ScalingConfig {
  minAgents: number;
  maxAgents: number;
  scaleUpThreshold: number;  // CPU/load threshold to scale up
  scaleDownThreshold: number;
  cooldownPeriodMs: number;
}

export interface SwarmConfig {
  topology: TopologyConfig;
  loadBalancing: LoadBalancerConfig;
  scaling: ScalingConfig;
}

// =============================================================================
// Neural Configuration (for future @authz-engine/neural package)
// =============================================================================

export type PatternType = 'anomaly' | 'temporal' | 'behavioral' | 'risk' | 'correlation';

export interface PatternConfig {
  type: PatternType;
  enabled: boolean;
  modelPath?: string;
  threshold?: number;
}

export interface TrainingConfig {
  batchSize: number;
  epochs: number;
  learningRate: number;
  validationSplit: number;
  useWasmAcceleration: boolean;
  autoTrainIntervalMs?: number;
}

export interface NeuralConfig {
  patterns: PatternConfig[];
  training: TrainingConfig;
  inferenceCache: {
    enabled: boolean;
    maxSize: number;
    ttlMs: number;
  };
}

// =============================================================================
// Consensus Configuration (for future @authz-engine/consensus package)
// =============================================================================

export type ConsensusProtocol = 'pbft' | 'raft' | 'gossip';

export interface ConsensusThresholds {
  quorum: number;  // 0.67 for BFT
  timeoutMs: number;
  maxRetries: number;
}

export interface ConsensusConfig {
  default: ConsensusProtocol;
  thresholds: ConsensusThresholds;
  enableForHighRisk: boolean;
  highRiskThreshold: number;  // Anomaly score above this triggers consensus
}

// =============================================================================
// Memory Configuration (for future @authz-engine/memory package)
// =============================================================================

export interface VectorStoreConfig {
  enabled: boolean;
  dimension: number;
  indexType: 'ivfflat' | 'hnsw';
  distanceMetric: 'cosine' | 'euclidean' | 'inner_product';
}

export interface CacheConfig {
  enabled: boolean;
  maxSize: number;
  ttlMs: number;
  namespaces: string[];
}

export interface EventStoreConfig {
  enabled: boolean;
  retentionDays: number;
  compactionIntervalMs: number;
}

export interface MemoryConfig {
  vectorStore: VectorStoreConfig;
  cache: CacheConfig;
  eventStore: EventStoreConfig;
}

// =============================================================================
// Platform Configuration
// =============================================================================

export interface PlatformConfig {
  /** Platform instance identifier */
  instanceId?: string;

  /** Swarm orchestration configuration */
  swarm: SwarmConfig;

  /** Neural pattern engine configuration */
  neural: NeuralConfig;

  /** Consensus protocol configuration */
  consensus: ConsensusConfig;

  /** Memory management configuration */
  memory: MemoryConfig;

  /** Logging configuration */
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    format: 'json' | 'pretty';
  };

  /** Metrics collection */
  metrics: {
    enabled: boolean;
    collectIntervalMs: number;
    retentionDays: number;
  };
}

// =============================================================================
// Platform Health Types
// =============================================================================

export interface SubsystemHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  lastCheck: Date;
  latencyMs?: number;
  details?: Record<string, unknown>;
  errors?: string[];
}

export interface PlatformHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  uptime: number;  // milliseconds
  subsystems: {
    swarm: SubsystemHealth;
    neural: SubsystemHealth;
    consensus: SubsystemHealth;
    memory: SubsystemHealth;
    agents: SubsystemHealth;
  };
  metrics: PlatformMetrics;
}

export interface PlatformMetrics {
  requestsProcessed: number;
  requestsPerSecond: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  errorRate: number;
  activeAgents: number;
  consensusRounds: number;
  neuralPredictions: number;
  cacheHitRate: number;
}

// =============================================================================
// Authorization Request/Response Extensions
// =============================================================================

export interface AuthorizationRequest extends CheckRequest {
  /** Correlation ID for tracing across subsystems */
  correlationId?: string;

  /** Request priority */
  priority?: Priority;

  /** Force consensus for this request */
  requireConsensus?: boolean;

  /** Include detailed explanation */
  includeExplanation?: boolean;

  /** Include neural analysis */
  includeNeuralAnalysis?: boolean;
}

export interface NeuralAnalysis {
  anomalyScore: number;
  riskLevel: Priority;
  confidence: number;
  patterns: {
    type: PatternType;
    score: number;
    description: string;
  }[];
  predictedOutcome?: 'allow' | 'deny';
  factors?: string[];
}

export interface ConsensusResult {
  required: boolean;
  reached: boolean;
  protocol: ConsensusProtocol;
  participants: number;
  approvals: number;
  timeMs: number;
}

export interface AuthorizationResult extends CheckResponse {
  /** Platform-specific metadata */
  platform: {
    instanceId: string;
    processingTimeMs: number;
    processingMode: 'standard' | 'consensus' | 'cached';
    agentsInvolved: AgentType[];
    swarmNodesUsed: number;
  };

  /** Neural analysis results */
  neural?: NeuralAnalysis;

  /** Consensus results (if required) */
  consensus?: ConsensusResult;

  /** Explanation (if requested) */
  explanation?: {
    summary: string;
    factors: string[];
    recommendations?: string[];
  };
}

// =============================================================================
// Platform Orchestrator Interface
// =============================================================================

export interface IPlatformOrchestrator {
  /** Initialize all platform subsystems */
  initialize(config: PlatformConfig): Promise<void>;

  /** Process an authorization request through the platform */
  processRequest(request: AuthorizationRequest): Promise<AuthorizationResult>;

  /** Get current platform health status */
  getHealth(): Promise<PlatformHealth>;

  /** Shutdown all subsystems gracefully */
  shutdown(): Promise<void>;

  /** Get platform configuration */
  getConfig(): PlatformConfig;

  /** Update configuration at runtime */
  updateConfig(partial: Partial<PlatformConfig>): Promise<void>;

  /** Get platform metrics */
  getMetrics(): PlatformMetrics;
}

// =============================================================================
// Agent Pool Types (for swarm integration)
// =============================================================================

export interface SwarmAgent {
  id: string;
  type: AgentType;
  state: AgentState;
  capabilities: string[];
  metrics: {
    processedCount: number;
    errorCount: number;
    avgProcessingTimeMs: number;
    lastProcessedAt?: Date;
  };
  lastHeartbeat: Date;
}

export interface AgentConnection {
  from: string;
  to: string;
  latencyMs: number;
  bandwidth: number;
}

export interface SwarmInstance {
  id: string;
  topology: TopologyType;
  agents: Map<string, SwarmAgent>;
  connections: AgentConnection[];
  createdAt: Date;
}

// =============================================================================
// Event Types
// =============================================================================

export type PlatformEventType =
  | 'platform_initialized'
  | 'platform_shutdown'
  | 'request_processed'
  | 'consensus_started'
  | 'consensus_completed'
  | 'neural_prediction'
  | 'agent_spawned'
  | 'agent_terminated'
  | 'health_check'
  | 'config_updated'
  | 'error_occurred';

export interface PlatformEvent {
  id: string;
  type: PlatformEventType;
  timestamp: Date;
  correlationId?: string;
  payload: unknown;
  source: string;
}
