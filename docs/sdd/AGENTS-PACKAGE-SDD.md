# Software Design Document: @authz-engine/agents

**Version**: 1.0.0
**Package**: `packages/agents`
**Status**: Implemented
**Last Updated**: 2024-11-23

---

## 1. Overview

### 1.1 Purpose

The `@authz-engine/agents` package provides intelligent, autonomous capabilities for the authorization system. It implements a 4-agent architecture for anomaly detection, pattern learning, decision explanation, and automated enforcement.

### 1.2 Scope

This package includes:
- **GUARDIAN Agent**: Security monitoring and anomaly detection
- **ANALYST Agent**: Pattern learning and policy optimization
- **ADVISOR Agent**: Decision explanations and natural language queries
- **ENFORCER Agent**: Automated protective actions
- **AgentOrchestrator**: Coordination layer for all agents
- **DecisionStore**: Persistent storage for decisions and patterns
- **EventBus**: Inter-agent communication

### 1.3 Package Structure

```
packages/agents/
├── src/
│   ├── index.ts                      # Package exports
│   ├── types/
│   │   ├── index.ts                 # Type exports
│   │   └── agent.types.ts           # All agent type definitions
│   ├── core/
│   │   ├── index.ts                 # Core exports
│   │   ├── base-agent.ts            # Abstract base class
│   │   ├── decision-store.ts        # Storage layer
│   │   └── event-bus.ts             # Event system
│   ├── guardian/
│   │   ├── index.ts                 # Guardian exports
│   │   └── guardian-agent.ts        # GUARDIAN implementation
│   ├── analyst/
│   │   ├── index.ts                 # Analyst exports
│   │   └── analyst-agent.ts         # ANALYST implementation
│   ├── advisor/
│   │   ├── index.ts                 # Advisor exports
│   │   └── advisor-agent.ts         # ADVISOR implementation
│   ├── enforcer/
│   │   ├── index.ts                 # Enforcer exports
│   │   └── enforcer-agent.ts        # ENFORCER implementation
│   └── orchestrator/
│       ├── index.ts                 # Orchestrator exports
│       └── agent-orchestrator.ts    # AgentOrchestrator class
├── tests/
└── package.json
```

---

## 2. Architecture

### 2.1 Agent Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                    AgentOrchestrator                        │
│  - Coordinates all agents                                   │
│  - Provides unified API                                     │
│  - Manages agent lifecycle                                  │
└─────────────┬───────────────────────────────────────────────┘
              │
    ┌─────────┼─────────┬─────────┬─────────┐
    ▼         ▼         ▼         ▼         ▼
┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐
│GUARDIAN│ │ANALYST│ │ADVISOR│ │ENFORCER│ │Shared │
│ Agent │ │ Agent │ │ Agent │ │ Agent  │ │Infra  │
└───────┘ └───────┘ └───────┘ └───────┘ └───────┘
    │         │         │         │         │
    └─────────┴─────────┴─────────┴─────────┘
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
         DecisionStore        EventBus
         (PostgreSQL/Mem)   (Redis/Memory)
```

### 2.2 Request Processing Flow

```
Request → DecisionEngine → Response
                 │
                 ▼
         AgentOrchestrator.processRequest()
                 │
    ┌────────────┼────────────┐
    ▼            ▼            ▼
ENFORCER     GUARDIAN      (Store)
(pre-check)  (analyze)    (record)
    │            │            │
    └────────────┴────────────┘
                 │
                 ▼
    ProcessingResult {
      response,
      anomalyScore,
      anomaly?,
      explanation?,
      enforcement
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

### 3.2 GUARDIAN Agent (`guardian/guardian-agent.ts`)

#### 3.2.1 Purpose

Security monitoring agent that detects anomalies in authorization patterns.

#### 3.2.2 Configuration

```typescript
interface GuardianConfig {
  anomalyThreshold: number;        // Default: 0.7
  baselinePeriodDays: number;      // Default: 7
  velocityWindowMinutes: number;   // Default: 5
  enableRealTimeDetection: boolean;
}
```

#### 3.2.3 Key Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `analyzeRequest` | `(request: CheckRequest) => Promise<AnalysisResult>` | Analyze request for anomalies |
| `getRecentAnomalies` | `(principalId: string) => Anomaly[]` | Get anomalies for a principal |
| `getAllAnomalies` | `(filters?) => Promise<Anomaly[]>` | Get all anomalies with filters |
| `resolveAnomaly` | `(id, status, notes?) => Promise<void>` | Mark anomaly as resolved |

#### 3.2.4 Analysis Result

```typescript
interface AnalysisResult {
  anomalyScore: number;       // 0-1, higher = more suspicious
  riskFactors: RiskFactor[];
  anomaly?: Anomaly;          // Set if score > threshold
}
```

#### 3.2.5 Detection Algorithms

1. **Velocity Detection**: Track requests/minute per principal
2. **Time-based Anomaly**: Compare access time to historical patterns
3. **Resource Anomaly**: Detect access to unusual resource types
4. **Permission Escalation**: Detect sudden role changes

### 3.3 ANALYST Agent (`analyst/analyst-agent.ts`)

#### 3.3.1 Purpose

Learning agent that discovers patterns in authorization decisions.

#### 3.3.2 Configuration

```typescript
interface AnalystConfig {
  minSampleSize: number;           // Default: 100
  confidenceThreshold: number;     // Default: 0.8
  learningEnabled: boolean;
  patternDiscoveryInterval: string; // Cron: '0 */6 * * *'
}
```

#### 3.3.3 Key Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `discoverPatterns` | `() => Promise<LearnedPattern[]>` | Run pattern discovery |
| `getPatterns` | `() => LearnedPattern[]` | Get discovered patterns |
| `validatePattern` | `(id, approved, validatedBy) => Promise<void>` | Approve/reject pattern |

#### 3.3.4 Pattern Discovery

```
1. Query historical decisions from DecisionStore
2. Group by principal, resource, action combinations
3. Identify correlations:
   - Resources accessed together
   - Time-based patterns
   - Role clusters
4. Filter by confidence threshold
5. Generate suggested policy rules
```

### 3.4 ADVISOR Agent (`advisor/advisor-agent.ts`)

#### 3.4.1 Purpose

Explanation agent that provides human-readable decision explanations and answers policy questions.

#### 3.4.2 Configuration

```typescript
interface AdvisorConfig {
  llmProvider: 'openai' | 'anthropic' | 'local';
  llmModel: string;              // Default: 'gpt-4'
  enableNaturalLanguage: boolean;
  maxExplanationLength: number;  // Default: 500
}
```

#### 3.4.3 Key Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `explainDecision` | `(request, response, context?) => Promise<DecisionExplanation>` | Explain a decision |
| `answerPolicyQuestion` | `(question: string) => Promise<string>` | Answer policy question |
| `debugPolicy` | `(issue: string, policyYaml: string) => Promise<string>` | Help debug policy |

#### 3.4.4 Explanation Structure

```typescript
interface DecisionExplanation {
  requestId: string;
  generatedAt: Date;
  summary: string;                      // One-line summary
  factors: ExplanationFactor[];         // Detailed breakdown
  naturalLanguage?: string;             // LLM-generated prose
  recommendations?: string[];           // Improvement suggestions
  pathToAllow?: PathToAllow;           // How to get access
}

interface ExplanationFactor {
  type: 'role' | 'condition' | 'derived_role' | 'explicit_deny' | 'no_match';
  description: string;
  impact: 'allowed' | 'denied' | 'neutral';
  details: Record<string, unknown>;
}
```

### 3.5 ENFORCER Agent (`enforcer/enforcer-agent.ts`)

#### 3.5.1 Purpose

Action agent that takes protective measures in response to security events.

#### 3.5.2 Configuration

```typescript
interface EnforcerConfig {
  autoEnforceEnabled: boolean;
  requireApprovalForSeverity: Priority;  // 'critical' requires approval
  maxActionsPerHour: number;             // Default: 100
  rollbackWindowMinutes: number;         // Default: 60
}
```

#### 3.5.3 Key Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `isAllowed` | `(principalId: string) => { allowed, reason? }` | Pre-flight check |
| `triggerAction` | `(type, principalId, reason) => Promise<EnforcerAction>` | Execute action |
| `getPendingActions` | `() => EnforcerAction[]` | Get actions awaiting approval |
| `approveAction` | `(id, approvedBy) => Promise<EnforcerAction | null>` | Approve pending action |
| `rejectAction` | `(id, rejectedBy, reason?) => boolean` | Reject pending action |

#### 3.5.4 Action Lifecycle

```
triggered → pending → [approved] → executing → completed
              │                        │
              └─────[rejected]─────────┴──[failed]
```

### 3.6 AgentOrchestrator (`orchestrator/agent-orchestrator.ts`)

#### 3.6.1 Purpose

Unified coordination layer that manages all four agents.

#### 3.6.2 Configuration

```typescript
interface OrchestratorConfig {
  agents: AgentConfig;
  store: DecisionStoreConfig;
  eventBus: EventBusConfig;
}
```

#### 3.6.3 Key Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `initialize` | `() => Promise<void>` | Start all agents |
| `shutdown` | `() => Promise<void>` | Stop all agents |
| `processRequest` | `(request, response, options?) => Promise<ProcessingResult>` | Process through pipeline |
| `getHealth` | `() => Promise<HealthStatus>` | Check all agents |
| `getPatterns` | `() => LearnedPattern[]` | Get from ANALYST |
| `getAnomalies` | `(principalId) => Anomaly[]` | Get from GUARDIAN |
| `askQuestion` | `(question) => Promise<string>` | Ask ADVISOR |
| `triggerEnforcement` | `(type, principalId, reason) => Promise<EnforcerAction>` | Via ENFORCER |

#### 3.6.4 Processing Result

```typescript
interface ProcessingResult {
  response: CheckResponse;        // Original response (pass-through)
  anomalyScore: number;          // From GUARDIAN
  anomaly?: Anomaly;             // If detected
  explanation?: DecisionExplanation;  // If requested
  enforcement?: {
    allowed: boolean;
    reason?: string;
    action?: EnforcerAction;
  };
  processingTimeMs: number;
  agentsInvolved: string[];
}
```

### 3.7 DecisionStore (`core/decision-store.ts`)

#### 3.7.1 Purpose

Persistent storage for decisions, anomalies, patterns, and actions.

#### 3.7.2 Configuration

```typescript
interface DecisionStoreConfig {
  type?: 'memory' | 'postgres';
  database?: PoolConfig;           // PostgreSQL connection
  enableVectorSearch?: boolean;    // For semantic queries
  embeddingDimension?: number;     // Default: 1536
  retentionDays: number;
}
```

#### 3.7.3 Storage Modes

| Mode | Use Case | Persistence |
|------|----------|-------------|
| `memory` | Development, testing | None (lost on restart) |
| `postgres` | Production | Full persistence |

#### 3.7.4 Key Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `initialize` | `() => Promise<void>` | Connect/create tables |
| `close` | `() => Promise<void>` | Close connections |
| `storeDecision` | `(record: DecisionRecord) => Promise<void>` | Store decision |
| `queryDecisions` | `(filters) => Promise<DecisionRecord[]>` | Query decisions |
| `storeAnomaly` | `(anomaly: Anomaly) => Promise<void>` | Store anomaly |
| `storePattern` | `(pattern: LearnedPattern) => Promise<void>` | Store pattern |
| `storeAction` | `(action: EnforcerAction) => Promise<void>` | Store action |

### 3.8 EventBus (`core/event-bus.ts`)

#### 3.8.1 Purpose

Inter-agent communication via publish/subscribe.

#### 3.8.2 Configuration

```typescript
interface EventBusConfig {
  type?: 'memory' | 'redis' | 'kafka';
  mode?: 'memory' | 'redis' | 'kafka';  // Alias
  maxQueueSize?: number;
  redis?: { host, port, password? };
  kafka?: { brokers[], clientId, groupId };
}
```

#### 3.8.3 Key Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `initialize` | `() => Promise<void>` | Connect to backend |
| `shutdown` | `() => Promise<void>` | Disconnect |
| `publish` | `(event: AgentEvent) => Promise<void>` | Publish event |
| `subscribe` | `(eventType, handler) => () => void` | Subscribe, returns unsubscribe |

#### 3.8.4 Event Types

```typescript
type AgentEventType =
  // GUARDIAN events
  | 'anomaly_detected'
  | 'anomaly_resolved'
  | 'baseline_updated'
  // ANALYST events
  | 'pattern_discovered'
  | 'pattern_validated'
  | 'optimization_suggested'
  // ADVISOR events
  | 'explanation_generated'
  | 'recommendation_created'
  // ENFORCER events
  | 'action_triggered'
  | 'action_completed'
  | 'action_failed'
  | 'action_rolled_back';
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

  // Infrastructure
  DecisionStore,
  DecisionStoreConfig,
  EventBus,
  EventBusConfig,
};
```

---

## 5. Data Models

### 5.1 DecisionRecord Schema

```typescript
interface DecisionRecord {
  id: string;
  requestId: string;
  timestamp: Date;
  principal: Principal;
  resource: Resource;
  actions: string[];
  results: Record<string, ActionResult>;
  derivedRoles: string[];
  matchedPolicies: string[];
  enrichmentData?: Record<string, unknown>;
  anomalyScore?: number;
  riskFactors?: RiskFactor[];
  outcome?: DecisionOutcome;
  feedback?: DecisionFeedback;
  embedding?: number[];
}
```

### 5.2 Anomaly Schema

```typescript
interface Anomaly {
  id: string;
  detectedAt: Date;
  type: AnomalyType;
  severity: Priority;
  principalId: string;
  resourceKind?: string;
  action?: string;
  description: string;
  score: number;
  evidence: AnomalyEvidence;
  baseline: BaselineStats;
  observed: ObservedStats;
  status: 'open' | 'investigating' | 'resolved' | 'false_positive';
  resolvedAt?: Date;
  resolution?: string;
}
```

### 5.3 PostgreSQL Tables

```sql
-- Decision records
CREATE TABLE decisions (
  id UUID PRIMARY KEY,
  request_id TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  principal JSONB NOT NULL,
  resource JSONB NOT NULL,
  actions TEXT[] NOT NULL,
  results JSONB NOT NULL,
  anomaly_score FLOAT,
  embedding vector(1536)  -- pgvector extension
);

-- Anomalies
CREATE TABLE anomalies (
  id UUID PRIMARY KEY,
  detected_at TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  data JSONB NOT NULL,
  status TEXT NOT NULL
);

-- Patterns
CREATE TABLE patterns (
  id UUID PRIMARY KEY,
  discovered_at TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL,
  confidence FLOAT NOT NULL,
  data JSONB NOT NULL,
  is_approved BOOLEAN DEFAULT FALSE
);

-- Actions
CREATE TABLE enforcer_actions (
  id UUID PRIMARY KEY,
  triggered_at TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  data JSONB NOT NULL
);
```

---

## 6. Error Handling

### 6.1 Agent Errors

| Scenario | Behavior |
|----------|----------|
| Agent initialization fails | State → 'error', log error |
| Analysis throws | Return neutral score (0.0) |
| LLM call fails | Return cached/template explanation |
| Store connection lost | Buffer in memory, retry |
| EventBus disconnected | Queue locally, reconnect |

### 6.2 Graceful Degradation

```
GUARDIAN fails → Continue with anomalyScore = 0
ANALYST fails → Skip pattern discovery
ADVISOR fails → Return minimal explanation
ENFORCER fails → Default allow (fail-open for availability)
```

---

## 7. Security Considerations

1. **LLM API Keys**: Never logged, stored in environment
2. **Decision Data**: Contains sensitive access patterns
3. **Anomaly Data**: May reveal user behavior
4. **Enforcement**: Rate limits to prevent abuse
5. **Rollback**: All enforcer actions are reversible

---

## 8. Performance

### 8.1 Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Agent processing overhead | < 50ms | Per request |
| Pattern discovery | < 30s | Scheduled batch |
| LLM explanation | < 3s | With caching |
| Event propagation | < 10ms | Memory mode |

### 8.2 Optimization Strategies

1. **Async Processing**: Agents run after response sent
2. **Caching**: LLM responses cached by signature
3. **Batching**: Decisions batched for storage
4. **Sampling**: GUARDIAN can sample under load
5. **Scheduled Jobs**: ANALYST runs on cron schedule

---

## 9. Testing Strategy

### 9.1 Unit Tests

- Each agent tested in isolation
- Mock DecisionStore and EventBus
- Test all public methods

### 9.2 Integration Tests

- Full pipeline with memory stores
- Agent coordination via events
- End-to-end request processing

### 9.3 Test Coverage

| Module | Target Coverage |
|--------|----------------|
| guardian | 90% |
| analyst | 85% |
| advisor | 85% |
| enforcer | 90% |
| orchestrator | 85% |
| core | 95% |

---

## 10. Dependencies

### 10.1 Runtime Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `@authz-engine/core` | workspace:* | Core types |
| `pg` | ^8.11.0 | PostgreSQL (postgres mode) |
| `ioredis` | ^5.3.0 | Redis (redis mode) |
| `eventemitter3` | ^5.0.0 | Memory event bus |
| `openai` | ^4.0.0 | LLM (optional) |

### 10.2 Development Dependencies

| Dependency | Purpose |
|------------|---------|
| `typescript` | Type checking |
| `vitest` | Testing |
| `tsup` | Bundling |

---

## 11. Related Documents

- [ADR-004: Memory-first Development](../adr/ADR-004-MEMORY-FIRST-DEVELOPMENT.md)
- [ADR-005: Agentic Authorization Architecture](../adr/ADR-005-AGENTIC-AUTHORIZATION.md)
- [AGENTIC_AUTHZ_VISION.md](../AGENTIC_AUTHZ_VISION.md)

---

## 12. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-11-23 | Initial release with 4-agent architecture |
