/**
 * @authz-engine/platform
 *
 * Master Platform Orchestrator for the AuthZ Engine
 *
 * This package provides the unified orchestration layer that coordinates:
 * - Swarm orchestration (agent pool management)
 * - Neural pattern detection and learning
 * - Consensus protocols for high-risk decisions
 * - Distributed memory management
 * - Authorization agents (GUARDIAN, ANALYST, ADVISOR, ENFORCER)
 */

// =============================================================================
// Orchestrator Types
// =============================================================================

export type {
  // Configuration types
  PlatformConfig,
  TopologyConfig,
  LoadBalancerConfig,
  ScalingConfig,
  SwarmConfig,
  PatternConfig,
  TrainingConfig,
  NeuralConfig,
  ConsensusThresholds,
  ConsensusConfig,
  VectorStoreConfig,
  CacheConfig,
  EventStoreConfig,
  MemoryConfig,

  // Topology and balancing types
  TopologyType,
  BalancingStrategy,
  PatternType,
  ConsensusProtocol,

  // Health types
  SubsystemHealth,
  PlatformHealth,
  PlatformMetrics,

  // Request/Response types
  AuthorizationRequest,
  AuthorizationResult,
  NeuralAnalysis,
  ConsensusResult,

  // Interface types
  IPlatformOrchestrator,

  // Agent types
  SwarmAgent,
  AgentConnection,
  SwarmInstance,

  // Event types
  PlatformEventType,
  PlatformEvent,
} from './orchestrator/types.js';

// =============================================================================
// Workflow Types
// =============================================================================

export type {
  // Workflow definition types
  WorkflowDefinition,
  WorkflowStep,
  WorkflowStepBase,
  AgentTaskStep,
  ParallelTasksStep,
  ConditionalStep,
  ConsensusStep,
  TransformStep,
  WaitStep,
  RetryStep,
  NotifyStep,

  // Workflow execution types
  WorkflowExecution,
  WorkflowStepResult,
  WorkflowStatus,
  WorkflowStepType,

  // Condition types
  WorkflowCondition,
  WorkflowConditionOperator,

  // Authorization workflow types
  AuthorizationWorkflowInput,
  AuthorizationWorkflowOutput,

  // Interface
  IWorkflowEngine,

  // Templates
  WorkflowTemplate,
} from './workflow/types.js';

export { WORKFLOW_TEMPLATES } from './workflow/types.js';

// =============================================================================
// Core Components
// =============================================================================

export { PlatformOrchestrator } from './orchestrator/PlatformOrchestrator.js';
export { WorkflowEngine } from './workflow/WorkflowEngine.js';
export { HealthMonitor } from './health/HealthMonitor.js';

// =============================================================================
// Configuration
// =============================================================================

export {
  createDefaultConfig,
  validatePlatformConfig,
  mergeWithDefaults,
  CONFIG_PRESETS,
} from './config/PlatformConfig.js';

export type {
  ConfigValidationResult,
  ConfigPreset,
} from './config/PlatformConfig.js';
