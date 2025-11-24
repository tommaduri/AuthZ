# Software Design Document: @authz-engine/agents

**Version**: 2.0.0
**Package**: `packages/agents`
**Status**: ✅ Fully Documented
**Last Updated**: 2024-11-24

---

## 1. Overview

### 1.1 Purpose

The `@authz-engine/agents` package provides intelligent, autonomous capabilities for the authorization system. It implements a 4-agent architecture with advanced orchestration, pipeline execution, circuit breakers, and real-time metrics.

### 1.2 Scope

This package includes:
- **4 Specialized Agents**: GUARDIAN, ANALYST, ADVISOR, ENFORCER
- **AgentOrchestrator**: Advanced coordination with pipeline system (~1,269 lines)
- **Pipeline System**: Sequential, parallel, and adaptive execution modes
- **Circuit Breakers**: Per-agent fault tolerance with fallback strategies
- **Metrics Collector**: Real-time performance tracking
- **Event Manager**: Inter-agent communication with typed events
- **Config Manager**: Dynamic hot-reload configuration
- **DecisionStore**: Persistent storage for decisions and patterns
- **EventBus**: Pub/sub communication layer

### 1.3 Package Structure

```
packages/agents/
├── src/
│   ├── index.ts                           # Package exports
│   ├── types/
│   │   ├── index.ts                      # Type exports
│   │   └── agent.types.ts                # All agent type definitions
│   ├── core/
│   │   ├── index.ts                      # Core exports
│   │   ├── base-agent.ts                 # Abstract base class
│   │   ├── decision-store.ts             # Storage layer
│   │   └── event-bus.ts                  # Event system
│   ├── guardian/
│   │   ├── index.ts                      # Guardian exports
│   │   └── guardian-agent.ts             # GUARDIAN implementation (~1,607 lines)
│   ├── analyst/
│   │   ├── index.ts                      # Analyst exports
│   │   └── analyst-agent.ts              # ANALYST implementation (~600 lines)
│   ├── advisor/
│   │   ├── index.ts                      # Advisor exports
│   │   └── advisor-agent.ts              # ADVISOR implementation (~400 lines)
│   ├── enforcer/
│   │   ├── index.ts                      # Enforcer exports
│   │   └── enforcer-agent.ts             # ENFORCER implementation (~350 lines)
│   └── orchestrator/
│       ├── index.ts                      # Orchestrator exports
│       ├── agent-orchestrator.ts         # AgentOrchestrator (~1,269 lines)
│       ├── pipeline/
│       │   ├── index.ts                  # Pipeline exports
│       │   ├── pipeline-config.ts        # Pipeline types + defaults
│       │   └── pipeline-executor.ts      # Execution engine
│       ├── resilience/
│       │   ├── circuit-breaker.ts        # Circuit breaker implementation
│       │   └── fallback-strategies.ts    # Fallback handling
│       ├── metrics/
│       │   └── metrics-collector.ts      # Performance tracking
│       ├── events/
│       │   └── event-manager.ts          # Event coordination
│       └── config/
│           └── config-manager.ts         # Hot-reload config
├── tests/
└── package.json
```

---

## 2. Architecture

### 2.1 Agent Hierarchy

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          AgentOrchestrator (~1,269 lines)                     │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                         Pipeline System                                  │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐ │ │
│  │  │Sequential│  │ Parallel │  │ Adaptive │  │ Conditional Execution   │ │ │
│  │  │  Mode    │  │   Mode   │  │   Mode   │  │ (CEL-like conditions)   │ │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                        Resilience Layer                                  │ │
│  │  ┌────────────────────┐  ┌────────────────────┐  ┌──────────────────┐  │ │
│  │  │  Circuit Breakers  │  │ Fallback Strategies │  │ Retry Logic      │  │ │
│  │  │  (per-agent)       │  │ (skip, default, ...)│  │ (configurable)   │  │ │
│  │  └────────────────────┘  └────────────────────┘  └──────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌───────────┬───────────┬───────────┬───────────┬───────────────────────┐  │
│  │ GUARDIAN  │  ANALYST  │  ADVISOR  │ ENFORCER  │    Shared Infra       │  │
│  │ (~1,607L) │  (~600L)  │  (~400L)  │  (~350L)  │                       │  │
│  │           │           │           │           │  ┌─────────────────┐  │  │
│  │ Anomaly   │ Pattern   │ LLM-      │ Rate      │  │ Metrics         │  │  │
│  │ Detection │ Learning  │ powered   │ Limiting  │  │ Collector       │  │  │
│  │           │           │ Explain   │ Blocking  │  └─────────────────┘  │  │
│  │ Threat    │ Behavior  │           │           │  ┌─────────────────┐  │  │
│  │ Scoring   │ Analysis  │ Q&A       │ Actions   │  │ Event Manager   │  │  │
│  │           │           │           │           │  └─────────────────┘  │  │
│  │ Compliance│ Recommend │ Debug     │ Rollback  │  ┌─────────────────┐  │  │
│  │ Mapping   │ ations    │           │           │  │ Config Manager  │  │  │
│  └───────────┴───────────┴───────────┴───────────┴──└─────────────────┘──┘  │
│                                      │                                       │
│                     ┌────────────────┴────────────────┐                     │
│                     ▼                                 ▼                     │
│               DecisionStore                      EventBus                   │
│            (PostgreSQL/Memory)               (Redis/Memory/Kafka)           │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Request Processing Flow

```
Request → DecisionEngine → Response
                 │
                 ▼
         AgentOrchestrator.processRequest()
                 │
                 ▼
         ┌───────────────┐
         │ Pipeline      │
         │ Executor      │
         │               │
         │ 1. Load config│
         │ 2. Get steps  │
         │ 3. Check deps │
         └───────┬───────┘
                 │
    ┌────────────┼────────────┬────────────┐
    ▼            ▼            ▼            ▼
┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
│ENFORCER│  │GUARDIAN│  │ANALYST │  │ADVISOR │
│(pre)   │  │(analyze│  │(record)│  │(explain│
│        │  │)       │  │        │  │if asked│
│Circuit │  │Circuit │  │Circuit │  │Circuit │
│Breaker │  │Breaker │  │Breaker │  │Breaker │
└────┬───┘  └────┬───┘  └────┬───┘  └────┬───┘
     │           │           │           │
     └───────────┴───────────┴───────────┘
                 │
                 ▼
    ProcessingResult {
      response,
      anomalyScore,
      anomaly?,
      explanation?,
      enforcement,
      processingTimeMs,
      agentsInvolved,
      pipelineResult?,
      traceId?,
      spanId?
    }
```

---

## 3. Component Design

### 3.1 Types Module (`types/agent.types.ts`)

#### 3.1.1 Agent Types

```typescript
type AgentType = 'guardian' | 'analyst' | 'advisor' | 'enforcer';
type AgentState = 'initializing' | 'ready' | 'processing' | 'error' | 'shutdown';
type Priority = 'low' | 'medium' | 'high' | 'critical';

interface Agent {
  readonly id: string;
  readonly type: AgentType;
  readonly name: string;
  state: AgentState;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  healthCheck(): Promise<AgentHealth>;
}
```

#### 3.1.2 Key Data Types

| Type | Description | Used By |
|------|-------------|---------|
| `DecisionRecord` | Stored authorization decision | DecisionStore |
| `Anomaly` | Detected suspicious pattern | GUARDIAN |
| `LearnedPattern` | Discovered access pattern | ANALYST |
| `DecisionExplanation` | Human-readable explanation | ADVISOR |
| `EnforcerAction` | Protective action taken | ENFORCER |

#### 3.1.3 Anomaly Types

```typescript
type AnomalyType =
  | 'unusual_access_time'
  | 'unusual_resource_access'
  | 'permission_escalation'
  | 'velocity_spike'
  | 'geographic_anomaly'
  | 'pattern_deviation'
  | 'new_resource_type'
  | 'bulk_operation';
```

#### 3.1.4 Pattern Types

```typescript
type PatternType =
  | 'access_correlation'
  | 'temporal_pattern'
  | 'role_cluster'
  | 'resource_group'
  | 'denial_pattern'
  | 'approval_pattern';
```

#### 3.1.5 Enforcer Action Types

```typescript
type EnforcerActionType =
  | 'rate_limit'
  | 'temporary_block'
  | 'require_mfa'
  | 'alert_admin'
  | 'revoke_session'
  | 'quarantine_resource'
  | 'escalate_review';
```

### 3.2 AgentOrchestrator (`orchestrator/agent-orchestrator.ts`)

#### 3.2.1 Purpose

Advanced coordination layer managing all four agents with pipeline execution, circuit breakers, metrics, and event handling.

**Implementation**: ~1,269 lines.

#### 3.2.2 Configuration

```typescript
interface OrchestratorConfig {
  agents: AgentConfig;
  store: DecisionStoreConfig;
  eventBus: EventBusConfig;

  // Pipeline configuration
  pipeline?: PipelineConfig;

  // Circuit breaker per agent
  circuitBreakers?: Partial<Record<AgentType, CircuitBreakerConfig>>;

  // Fallback strategies per agent
  fallbackStrategies?: Partial<Record<AgentType, FallbackStrategy>>;

  // Metrics configuration
  metrics?: Partial<MetricsConfig>;

  // Advanced features
  advanced?: {
    circuitBreakersEnabled?: boolean;    // Default: true
    metricsEnabled?: boolean;            // Default: true
    eventsEnabled?: boolean;             // Default: true
    hotReloadEnabled?: boolean;          // Default: false
  };
}
```

#### 3.2.3 Key Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `initialize` | `() => Promise<void>` | Start all agents + infrastructure |
| `shutdown` | `() => Promise<void>` | Graceful shutdown |
| `processRequest` | `(request, response, options?) => Promise<ProcessingResult>` | Process through pipeline |
| `getHealth` | `() => Promise<HealthStatus>` | Health of all components |
| `getPatterns` | `() => LearnedPattern[]` | Get from ANALYST |
| `getAnomalies` | `(principalId?) => Promise<Anomaly[]>` | Get from GUARDIAN |
| `validatePattern` | `(id, approved, validatedBy) => Promise<void>` | Validate ANALYST pattern |
| `resolveAnomaly` | `(id, status, notes?) => Promise<void>` | Resolve GUARDIAN anomaly |
| `askQuestion` | `(question) => Promise<string>` | Ask ADVISOR |
| `debugPolicy` | `(issue, policyYaml) => Promise<string>` | Debug via ADVISOR |
| `triggerEnforcement` | `(type, principalId, reason) => Promise<EnforcerAction>` | Via ENFORCER |
| `getPendingActions` | `() => EnforcerAction[]` | Pending ENFORCER actions |
| `approveAction` | `(id, approvedBy) => Promise<EnforcerAction \| null>` | Approve action |
| `rejectAction` | `(id, rejectedBy, reason?) => boolean` | Reject action |
| `explainDecision` | `(request, response) => Promise<DecisionExplanation>` | Explain via ADVISOR |
| `getMetrics` | `() => MetricsSummary` | Get performance metrics |

#### 3.2.4 Processing Result

```typescript
interface ProcessingResult {
  /** Original response (pass-through) */
  response: CheckResponse;

  /** Anomaly score from GUARDIAN (0-1) */
  anomalyScore: number;

  /** Detected anomaly details (if score > threshold) */
  anomaly?: Anomaly;

  /** Explanation (if includeExplanation=true) */
  explanation?: DecisionExplanation;

  /** Enforcement result */
  enforcement?: {
    allowed: boolean;
    reason?: string;
    action?: EnforcerAction;
  };

  /** Total processing time */
  processingTimeMs: number;

  /** List of agents that participated */
  agentsInvolved: string[];

  /** Detailed pipeline execution result */
  pipelineResult?: PipelineResult;

  /** OpenTelemetry trace ID */
  traceId?: string;

  /** OpenTelemetry span ID */
  spanId?: string;
}
```

### 3.3 Pipeline System (`orchestrator/pipeline/`)

#### 3.3.1 Pipeline Execution Modes

```typescript
type PipelineExecutionMode = 'sequential' | 'parallel' | 'adaptive';
```

| Mode | Description | Use Case |
|------|-------------|----------|
| `sequential` | Execute steps one after another | Standard flow |
| `parallel` | Execute independent steps concurrently | High throughput |
| `adaptive` | Dynamically choose based on conditions | Mixed workloads |

#### 3.3.2 Pipeline Configuration

```typescript
interface PipelineConfig {
  id: string;
  name: string;
  description?: string;
  mode: PipelineExecutionMode;
  steps: PipelineStep[];
  defaultTimeoutMs?: number;
  failFast?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
  version?: string;
  tags?: string[];
}

interface PipelineStep {
  agent: AgentType;
  name?: string;
  required: boolean;
  timeoutMs?: number;
  conditions?: AgentCondition | ConditionalExpression;
  dependsOn?: string[];        // For parallel mode
  priority?: Priority;         // For adaptive mode
  continueOnError?: boolean;
  configOverrides?: Record<string, unknown>;
}
```

#### 3.3.3 Conditional Execution

```typescript
type ConditionOperator = 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'contains' | 'matches';

interface AgentCondition {
  field: string;           // e.g., 'request.principal.roles'
  operator: ConditionOperator;
  value: unknown;
  negate?: boolean;
}

interface ConditionalExpression {
  type: 'and' | 'or' | 'not';
  conditions: Array<AgentCondition | ConditionalExpression>;
}
```

#### 3.3.4 Pre-defined Pipelines

```typescript
const DEFAULT_PIPELINES: Record<string, PipelineConfig> = {
  standard: {
    id: 'standard',
    name: 'Standard Authorization Pipeline',
    mode: 'sequential',
    steps: [
      { agent: 'enforcer', name: 'enforcement-check', required: true, timeoutMs: 100 },
      { agent: 'guardian', name: 'anomaly-analysis', required: true, timeoutMs: 500 },
      { agent: 'analyst', name: 'decision-recording', required: false, continueOnError: true, timeoutMs: 1000 },
      {
        agent: 'advisor',
        name: 'explanation-generation',
        required: false,
        conditions: { field: 'options.includeExplanation', operator: 'eq', value: true },
        timeoutMs: 2000
      },
    ],
    defaultTimeoutMs: 5000,
    failFast: true,
  },

  highSecurity: {
    id: 'high-security',
    name: 'High Security Pipeline',
    mode: 'sequential',
    steps: [
      { agent: 'enforcer', name: 'enforcement-check', required: true },
      { agent: 'guardian', name: 'anomaly-analysis', required: true, priority: 'critical' },
      { agent: 'analyst', name: 'pattern-analysis', required: true },
      { agent: 'advisor', name: 'explanation-generation', required: true },
    ],
    defaultTimeoutMs: 10000,
    maxRetries: 2,
    retryDelayMs: 100,
  },

  performance: {
    id: 'performance',
    name: 'Performance-Optimized Pipeline',
    mode: 'parallel',
    steps: [
      { agent: 'enforcer', name: 'enforcement-check', required: true, timeoutMs: 50 },
      { agent: 'guardian', name: 'anomaly-analysis', required: true, dependsOn: ['enforcement-check'] },
      { agent: 'analyst', name: 'async-recording', required: false, continueOnError: true },
    ],
    defaultTimeoutMs: 500,
    failFast: false,
  },

  adaptive: {
    id: 'adaptive',
    name: 'Adaptive Pipeline',
    mode: 'adaptive',
    steps: [
      { agent: 'enforcer', required: true, priority: 'critical' },
      { agent: 'guardian', required: true, priority: 'high' },
      {
        agent: 'analyst',
        required: false,
        priority: 'medium',
        conditions: {
          type: 'or',
          conditions: [
            { field: 'anomalyScore', operator: 'gt', value: 0.5 },
            { field: 'request.principal.roles', operator: 'contains', value: 'admin' },
          ],
        },
      },
      { agent: 'advisor', required: false, priority: 'low' },
    ],
    defaultTimeoutMs: 5000,
    failFast: false,
  },
};
```

### 3.4 Circuit Breakers (`orchestrator/resilience/`)

#### 3.4.1 Circuit Breaker States

```
       ┌─────────────────────────────────────────┐
       │                                         │
       ▼                                         │
   ┌────────┐  failure threshold   ┌──────┐     │
   │ CLOSED │──────────────────────│ OPEN │     │
   │        │                      │      │     │
   └────┬───┘                      └──┬───┘     │
        │                             │         │
        │ success                     │ timeout │
        │                             │         │
        │                      ┌──────▼──────┐  │
        │                      │ HALF_OPEN   │  │
        │                      │             │──┘
        └──────────────────────┤  test call  │ success
                               └─────────────┘
```

#### 3.4.2 Circuit Breaker Configuration

```typescript
interface CircuitBreakerConfig {
  failureThreshold: number;      // Failures before opening (default: 5)
  successThreshold: number;      // Successes to close (default: 2)
  timeout: number;               // Time before half-open (ms, default: 30000)
  volumeThreshold?: number;      // Min requests before tracking (default: 10)
}
```

#### 3.4.3 Fallback Strategies

```typescript
type FallbackStrategy =
  | 'skip'           // Skip the agent, continue pipeline
  | 'default'        // Return default value
  | 'cached'         // Use cached result
  | 'degraded'       // Use degraded mode
  | 'fail';          // Fail the pipeline

// Per-agent fallback configuration
const defaultFallbacks: Record<AgentType, FallbackStrategy> = {
  guardian: 'default',    // Return anomalyScore: 0
  analyst: 'skip',        // Skip recording
  advisor: 'skip',        // Skip explanation
  enforcer: 'fail',       // Critical - must work
};
```

### 3.5 Metrics Collector (`orchestrator/metrics/`)

#### 3.5.1 Metrics Types

```typescript
interface MetricsSummary {
  // Request metrics
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgProcessingTimeMs: number;
  p95ProcessingTimeMs: number;
  p99ProcessingTimeMs: number;

  // Agent metrics
  agentMetrics: Record<AgentType, AgentMetrics>;

  // Pipeline metrics
  pipelineMetrics: {
    totalExecutions: number;
    avgStepsExecuted: number;
    avgStepsSkipped: number;
    avgStepsFailed: number;
  };

  // Circuit breaker metrics
  circuitBreakerMetrics: Record<AgentType, CircuitBreakerMetrics>;
}

interface AgentMetrics {
  invocations: number;
  successes: number;
  failures: number;
  avgDurationMs: number;
  lastInvocation?: Date;
}

interface CircuitBreakerMetrics {
  state: 'closed' | 'open' | 'half_open';
  failures: number;
  successes: number;
  lastFailure?: Date;
  lastStateChange?: Date;
}
```

### 3.6 Event Manager (`orchestrator/events/`)

#### 3.6.1 Event Types

```typescript
type AgentEventType =
  // Orchestrator events
  | 'request_started'
  | 'request_completed'
  | 'request_failed'

  // GUARDIAN events
  | 'anomaly_detected'
  | 'anomaly_resolved'
  | 'baseline_updated'
  | 'threat_assessed'

  // ANALYST events
  | 'pattern_discovered'
  | 'pattern_validated'
  | 'optimization_suggested'
  | 'behavior_analyzed'

  // ADVISOR events
  | 'explanation_generated'
  | 'recommendation_created'
  | 'question_answered'

  // ENFORCER events
  | 'action_triggered'
  | 'action_completed'
  | 'action_failed'
  | 'action_approved'
  | 'action_rejected'
  | 'action_rolled_back'

  // Pipeline events
  | 'pipeline_started'
  | 'pipeline_completed'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'step_skipped'

  // Circuit breaker events
  | 'circuit_opened'
  | 'circuit_closed'
  | 'circuit_half_open';
```

### 3.7 GUARDIAN Agent (`guardian/guardian-agent.ts`)

#### 3.7.1 Purpose

Security monitoring agent that detects anomalies in authorization patterns.

**Implementation**: ~1,607 lines with comprehensive threat detection.

#### 3.7.2 Configuration

```typescript
interface GuardianConfig {
  anomalyThreshold: number;           // Default: 0.7
  baselinePeriodDays: number;         // Default: 7
  velocityWindowMinutes: number;      // Default: 5
  enableRealTimeDetection: boolean;   // Default: true
  threatIndicators?: ThreatIndicatorConfig[];
  complianceMapping?: ComplianceConfig;
}
```

#### 3.7.3 Threat Indicator Types (10 types)

```typescript
type ThreatIndicatorType =
  | 'velocity_anomaly'         // Request rate spike
  | 'time_anomaly'             // Unusual access time
  | 'resource_anomaly'         // Unusual resource access
  | 'pattern_deviation'        // Deviation from baseline
  | 'privilege_escalation'     // Sudden role changes
  | 'geographic_anomaly'       // Location-based anomaly
  | 'bulk_operation'           // Mass operations
  | 'policy_violation'         // Direct policy violations
  | 'session_anomaly'          // Session-based anomalies
  | 'behavior_anomaly';        // Overall behavior deviation
```

#### 3.7.4 Key Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `analyzeRequest` | `(request: CheckRequest) => Promise<AnalysisResult>` | Analyze request for anomalies |
| `getRecentAnomalies` | `(principalId: string) => Anomaly[]` | Get anomalies for a principal |
| `getAllAnomalies` | `(filters?) => Promise<Anomaly[]>` | Get all anomalies with filters |
| `resolveAnomaly` | `(id, status, notes?) => Promise<void>` | Mark anomaly as resolved |
| `computeBaseline` | `(principalId) => Promise<BaselineStats>` | Compute behavior baseline |
| `assessThreat` | `(request, indicators) => ThreatAssessment` | Assess threat level |

#### 3.7.5 Analysis Result

```typescript
interface AnalysisResult {
  anomalyScore: number;           // 0-1, higher = more suspicious
  riskFactors: RiskFactor[];
  anomaly?: Anomaly;              // Set if score > threshold
  threatAssessment?: ThreatAssessment;
  complianceFlags?: string[];     // Compliance framework flags
}

interface ThreatAssessment {
  level: 'none' | 'low' | 'medium' | 'high' | 'critical';
  score: number;
  indicators: ThreatIndicator[];
  recommendations: string[];
}
```

### 3.8 ANALYST Agent (`analyst/analyst-agent.ts`)

#### 3.8.1 Purpose

Learning agent that discovers patterns in authorization decisions.

**Implementation**: ~600 lines.

#### 3.8.2 Configuration

```typescript
interface AnalystConfig {
  minSampleSize: number;              // Default: 100
  confidenceThreshold: number;        // Default: 0.8
  learningEnabled: boolean;
  patternDiscoveryInterval: string;   // Cron: '0 */6 * * *'
  timeSeriesAnalysis?: boolean;       // Enable temporal analysis
}
```

#### 3.8.3 Key Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `discoverPatterns` | `() => Promise<LearnedPattern[]>` | Run pattern discovery |
| `getPatterns` | `() => LearnedPattern[]` | Get discovered patterns |
| `validatePattern` | `(id, approved, validatedBy) => Promise<void>` | Approve/reject pattern |
| `analyzeBehavior` | `(principalId) => Promise<BehaviorProfile>` | Analyze principal behavior |
| `generateRecommendations` | `() => Promise<PolicyRecommendation[]>` | Generate policy recommendations |

### 3.9 ADVISOR Agent (`advisor/advisor-agent.ts`)

#### 3.9.1 Purpose

Explanation agent that provides human-readable decision explanations and answers policy questions.

**Implementation**: ~400 lines.

#### 3.9.2 Configuration

```typescript
interface AdvisorConfig {
  llmProvider: 'openai' | 'anthropic' | 'local' | 'none';
  llmModel: string;                   // Default: 'gpt-4'
  enableNaturalLanguage: boolean;
  maxExplanationLength: number;       // Default: 500
  cacheExplanations?: boolean;
  apiKey?: string;                    // From environment
}
```

#### 3.9.3 Key Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `explainDecision` | `(request, response, context?) => Promise<DecisionExplanation>` | Explain a decision |
| `answerPolicyQuestion` | `(question: string) => Promise<string>` | Answer policy question |
| `debugPolicy` | `(issue: string, policyYaml: string) => Promise<string>` | Help debug policy |

#### 3.9.4 Explanation Structure

```typescript
interface DecisionExplanation {
  requestId: string;
  generatedAt: Date;
  summary: string;                         // One-line summary
  factors: ExplanationFactor[];            // Detailed breakdown
  naturalLanguage?: string;                // LLM-generated prose
  recommendations?: string[];              // Improvement suggestions
  pathToAllow?: PathToAllow;              // How to get access
}

interface ExplanationFactor {
  type: 'role' | 'condition' | 'derived_role' | 'explicit_deny' | 'no_match';
  description: string;
  impact: 'allowed' | 'denied' | 'neutral';
  details: Record<string, unknown>;
}
```

### 3.10 ENFORCER Agent (`enforcer/enforcer-agent.ts`)

#### 3.10.1 Purpose

Action agent that takes protective measures in response to security events.

**Implementation**: ~350 lines.

#### 3.10.2 Configuration

```typescript
interface EnforcerConfig {
  autoEnforceEnabled: boolean;
  requireApprovalForSeverity: Priority;   // 'critical' requires approval
  maxActionsPerHour: number;              // Default: 100
  rollbackWindowMinutes: number;          // Default: 60
  blockedPrincipals?: Set<string>;        // Pre-blocked list
}
```

#### 3.10.3 Key Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `isAllowed` | `(principalId: string) => { allowed, reason? }` | Pre-flight check |
| `triggerAction` | `(type, principalId, reason) => Promise<EnforcerAction>` | Execute action |
| `getPendingActions` | `() => EnforcerAction[]` | Get actions awaiting approval |
| `approveAction` | `(id, approvedBy) => Promise<EnforcerAction \| null>` | Approve pending action |
| `rejectAction` | `(id, rejectedBy, reason?) => boolean` | Reject pending action |
| `rollbackAction` | `(id) => Promise<boolean>` | Rollback executed action |

#### 3.10.4 Action Lifecycle

```
triggered → pending → [approved] → executing → completed
              │                        │
              └─────[rejected]─────────┴──[failed]
                                       │
                                       └──[rolled_back]
```

---

## 4. Interfaces

### 4.1 Public API

```typescript
// From index.ts
export {
  // Types
  AgentType,
  AgentState,
  Priority,
  Agent,
  AgentHealth,
  AgentMetrics,
  AgentConfig,
  AgentEvent,
  AgentEventType,
  DecisionRecord,
  Anomaly,
  AnomalyType,
  LearnedPattern,
  PatternType,
  DecisionExplanation,
  EnforcerAction,
  EnforcerActionType,

  // Agents
  GuardianAgent,
  AnalystAgent,
  AdvisorAgent,
  EnforcerAgent,

  // Orchestrator
  AgentOrchestrator,
  OrchestratorConfig,
  ProcessingResult,

  // Pipeline
  PipelineConfig,
  PipelineStep,
  PipelineExecutionMode,
  PipelineResult,
  DEFAULT_PIPELINES,

  // Resilience
  CircuitBreakerConfig,
  FallbackStrategy,

  // Metrics
  MetricsSummary,
  MetricsConfig,

  // Infrastructure
  DecisionStore,
  DecisionStoreConfig,
  EventBus,
  EventBusConfig,
};
```

---

## 5. Error Handling

### 5.1 Agent Errors

| Scenario | Behavior |
|----------|----------|
| Agent initialization fails | State → 'error', log error, use fallback |
| Analysis throws | Return neutral score (0.0), log warning |
| LLM call fails | Return cached/template explanation |
| Store connection lost | Buffer in memory, retry |
| EventBus disconnected | Queue locally, reconnect |

### 5.2 Graceful Degradation

```
GUARDIAN fails → Use circuit breaker, return anomalyScore: 0
ANALYST fails → Skip recording, continue pipeline
ADVISOR fails → Return minimal template explanation
ENFORCER fails → CRITICAL - circuit opens, fail pipeline if configured
```

---

## 6. Security Considerations

1. **LLM API Keys**: Never logged, stored in environment
2. **Decision Data**: Contains sensitive access patterns
3. **Anomaly Data**: May reveal user behavior
4. **Enforcement**: Rate limits to prevent abuse
5. **Rollback**: All enforcer actions are reversible
6. **Circuit Breakers**: Prevent cascade failures

---

## 7. Performance

### 7.1 Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Agent processing overhead | < 50ms | Per request, warm path |
| Pipeline execution | < 100ms | Sequential mode |
| Pattern discovery | < 30s | Scheduled batch |
| LLM explanation | < 3s | With caching |
| Event propagation | < 10ms | Memory mode |

### 7.2 Optimization Strategies

1. **Async Processing**: Non-critical agents run after response
2. **Caching**: LLM responses, baselines, patterns cached
3. **Batching**: Decisions batched for storage
4. **Sampling**: GUARDIAN can sample under load
5. **Parallel Execution**: Use parallel pipeline mode
6. **Circuit Breakers**: Prevent slow agents from blocking

---

## 8. Testing Strategy

### 8.1 Unit Tests

- Each agent tested in isolation
- Mock DecisionStore and EventBus
- Test all public methods
- Pipeline condition evaluation
- Circuit breaker state transitions

### 8.2 Integration Tests

- Full pipeline with memory stores
- Agent coordination via events
- End-to-end request processing
- Fallback behavior verification

### 8.3 Test Coverage

| Module | Target Coverage |
|--------|----------------|
| guardian | 90% |
| analyst | 85% |
| advisor | 85% |
| enforcer | 90% |
| orchestrator | 85% |
| pipeline | 90% |
| resilience | 90% |
| core | 95% |

---

## 9. Dependencies

### 9.1 Runtime Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `@authz-engine/core` | workspace:* | Core types |
| `pg` | ^8.11.0 | PostgreSQL (postgres mode) |
| `ioredis` | ^5.3.0 | Redis (redis mode) |
| `eventemitter3` | ^5.0.0 | Memory event bus |
| `openai` | ^4.0.0 | LLM (optional) |
| `kafkajs` | ^2.2.0 | Kafka (optional) |

### 9.2 Development Dependencies

| Dependency | Purpose |
|------------|---------|
| `typescript` | Type checking |
| `vitest` | Testing |
| `tsup` | Bundling |

---

## 10. Related Documents

- [ADR-004: Memory-first Development](../adr/ADR-004-MEMORY-FIRST-DEVELOPMENT.md)
- [ADR-005: Agentic Authorization Architecture](../adr/ADR-005-AGENTIC-AUTHORIZATION.md)
- [AGENTIC_AUTHZ_VISION.md](../AGENTIC_AUTHZ_VISION.md)

---

## 11. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 2.0.0 | 2024-11-24 | Full documentation of orchestrator, pipeline, circuit breakers, metrics, events |
| 1.0.0 | 2024-11-23 | Initial release with 4-agent architecture |
