# Agent Orchestrator Advanced Features Enhancement

## Overview

The Agent Orchestrator has been enhanced with comprehensive advanced features for production-grade agent coordination. All features are fully implemented, tested, and documented.

## Features Enhanced

### 1. Pipeline Configuration

**Files:**
- `/packages/agents/src/orchestrator/pipeline/pipeline-config.ts`
- `/packages/agents/src/orchestrator/agent-orchestrator.ts` (lines 465-494)

**Capabilities:**
- **Custom Pipeline Registration**: Register custom execution pipelines with flexible agent ordering
- **Pipeline Modes**: Support for sequential, parallel, and adaptive execution modes
- **Conditional Execution**: Execute agents based on request context using expressions:
  - Logical operators: `and`, `or`, `not`
  - Comparison operators: `eq`, `ne`, `gt`, `lt`, `gte`, `lte`, `in`, `contains`, `matches`
  - Field path evaluation (e.g., `request.principal.roles`)

**Key Methods:**
```typescript
registerPipeline(pipeline: PipelineConfig): void
getPipeline(id: string): PipelineConfig | undefined
getAllPipelines(): Map<string, PipelineConfig>
setDefaultPipeline(id: string): void
```

**Example Usage:**
```typescript
const customPipeline: PipelineConfig = {
  id: 'admin-pipeline',
  name: 'Admin Request Pipeline',
  mode: 'parallel',
  steps: [
    {
      agent: 'guardian',
      required: true,
      timeoutMs: 5000,
      conditions: {
        type: 'and',
        conditions: [
          { field: 'request.principal.roles', operator: 'contains', value: 'admin' }
        ]
      }
    },
    {
      agent: 'enforcer',
      required: true,
      dependsOn: ['guardian']
    }
  ]
};

orchestrator.registerPipeline(customPipeline);
```

### 2. Circuit Breaker Pattern

**Files:**
- `/packages/agents/src/orchestrator/circuit-breaker/circuit-breaker.ts`
- `/packages/agents/src/orchestrator/agent-orchestrator.ts` (lines 500-533)

**Capabilities:**
- **Per-Agent Circuit Breakers**: Independent circuit breaker for each agent type
- **Three States**: CLOSED (normal), OPEN (failing), HALF_OPEN (testing recovery)
- **Fallback Strategies**: Multiple fallback options when circuit opens:
  - `default-value`: Return a predefined default value
  - `cached-value`: Use previously cached responses
  - `alternative-agent`: Route to alternative agent
  - `graceful-degradation`: Degrade service gracefully
  - `retry-queue`: Queue failed requests for retry
  - `custom`: Custom fallback handler function

**Configuration:**
```typescript
interface CircuitBreakerConfig {
  failureThreshold: number;        // Failures before opening
  failureWindowMs: number;         // Time window for counting failures
  resetTimeoutMs: number;          // Time before trying half-open
  successThreshold: number;        // Successes needed to close from half-open
  halfOpenMaxRequests: number;     // Max concurrent requests in half-open
  requestTimeoutMs: number;        // Individual request timeout
  enabled: boolean;
}
```

**Key Methods:**
```typescript
getCircuitBreaker(agentType: AgentType): CircuitBreaker
tripCircuitBreaker(agentType: AgentType, reason: string): void
resetCircuitBreaker(agentType: AgentType, reason?: string): void
resetAllCircuitBreakers(reason?: string): void
onCircuitStateChange(handler: (change: CircuitStateChange) => void): () => void
```

**State Change Event:**
```typescript
interface CircuitStateChange {
  agentType: AgentType;
  previousState: CircuitState;
  newState: CircuitState;
  timestamp: Date;
  reason: string;
  metrics: CircuitBreakerMetrics;
}
```

### 3. Metrics and Tracing

**Files:**
- `/packages/agents/src/orchestrator/metrics/metrics-collector.ts`
- `/packages/agents/src/orchestrator/agent-orchestrator.ts` (lines 539-572)

**Capabilities:**
- **Per-Agent Latency Tracking**:
  - Min, max, mean latencies
  - Percentile tracking (p50, p90, p95, p99)
  - Histogram buckets for distribution analysis

- **Request Metrics**:
  - Total requests, successful, failed, timeout
  - Per-agent request counts

- **Decision Audit Trail**:
  - Every decision is recorded with full context
  - Includes timestamps, duration, success/failure
  - Optional input/output capture
  - Span IDs and trace IDs for correlation

- **OpenTelemetry Integration**:
  - Distributed tracing with spans
  - Parent-child span relationships
  - Span events and attributes
  - Link support for correlation

**Key Methods:**
```typescript
getAgentMetrics(agentType: AgentType): AgentMetricsSnapshot
getAllAgentMetrics(): Record<AgentType, AgentMetricsSnapshot>
getAuditTrail(filters?: AuditTrailFilters): AuditTrailEntry[]
onMetricsExport(handler: (metrics: Record<AgentType, AgentMetricsSnapshot>) => void): () => void
resetMetrics(): void
```

**Metrics Snapshot:**
```typescript
interface AgentMetricsSnapshot {
  agentType: AgentType;
  timestamp: Date;
  latency: LatencyStats;
  requests: {
    total: number;
    successful: number;
    failed: number;
    timeout: number;
  };
  circuitBreaker?: {
    state: string;
    failures: number;
    rejections: number;
  };
}
```

**Audit Trail Entry:**
```typescript
interface AuditTrailEntry {
  id: string;
  timestamp: Date;
  requestId: string;
  correlationId?: string;
  agentType: AgentType;
  operation: string;
  durationMs: number;
  success: boolean;
  input?: unknown;
  output?: unknown;
  error?: string;
  metadata: Record<string, unknown>;
  spanId?: string;
  traceId?: string;
  parentSpanId?: string;
}
```

### 4. Event-Driven Architecture

**Files:**
- `/packages/agents/src/orchestrator/events/event-manager.ts`
- `/packages/agents/src/orchestrator/agent-orchestrator.ts` (lines 578-611)

**Capabilities:**
- **Rich Event Types**:
  - Pipeline events: started, completed, failed
  - Step events: started, completed, skipped, failed
  - Circuit breaker state changes
  - Configuration changes
  - Feature flag changes
  - Health check completions

- **Flexible Event Subscriptions**:
  - Filter by event type
  - Filter by source agent
  - Filter by correlation ID
  - Filter by request ID
  - Custom metadata filtering

- **Event Replay**:
  - Replay events for debugging
  - Time-based replay windows
  - Playback speed control
  - Optional event emission during replay

- **Event Timeline**:
  - Get all events for a specific correlation ID
  - Complete request lifecycle visibility

**Key Methods:**
```typescript
subscribeToEvents(
  filter: EventFilter,
  handler: (event: OrchestratorEvent) => void | Promise<void>,
  priority?: number
): EventSubscription

onEvent(
  type: OrchestratorEventType,
  handler: (event: OrchestratorEvent) => void | Promise<void>
): EventSubscription

replayEvents(options?: ReplayOptions): Promise<OrchestratorEvent[]>
getEventTimeline(correlationId: string): OrchestratorEvent[]
```

**Event Subscription:**
```typescript
interface EventSubscription {
  id: string;
  filter: EventFilter;
  handler: (event: OrchestratorEvent) => void | Promise<void>;
  priority: number;
  unsubscribe: () => void;
}
```

### 5. Dynamic Configuration Management

**Files:**
- `/packages/agents/src/orchestrator/config/config-manager.ts`
- `/packages/agents/src/orchestrator/agent-orchestrator.ts` (lines 620-665)

**Capabilities:**
- **Hot-Reload Configuration**: Update configuration without restarting
- **Feature Flags**:
  - Per-agent flag overrides
  - Gradual rollout support (0-100%)
  - Conditional flag evaluation
  - Expiry dates for temporary flags
  - Tag-based categorization

- **A/B Testing**:
  - Multiple test variants
  - Traffic allocation strategies (random, user-hash, session-hash)
  - Active/inactive state management
  - Time-based test windows
  - Associated feature flags

- **Dynamic Updates**: Real-time configuration changes with event notifications

**Key Methods:**
```typescript
getDynamicConfig(): Readonly<DynamicConfig>
updateConfig(updates: Partial<DynamicConfig>): void
reloadConfig(): Promise<void>
getFeatureFlag(flagId: string, context?: FeatureFlagContext): boolean
setFeatureFlag(flagId: string, flag: FeatureFlag): void
getABTestVariant(testId: string, userId?: string, sessionId?: string): string | null
onConfigChange(handler: (event: ConfigChangeEvent) => void): void
```

**Feature Flag:**
```typescript
interface FeatureFlag {
  id: string;
  name: string;
  description?: string;
  defaultValue: boolean;
  agentOverrides?: Partial<Record<AgentType, boolean>>;
  rolloutPercentage?: number;
  variants?: string[];
  conditions?: FeatureFlagCondition[];
  expiresAt?: Date;
  tags?: string[];
}
```

## Module Exports

The main index file now properly exports all advanced features:

**`/packages/agents/src/orchestrator/index.ts`:**
```typescript
export { AgentOrchestrator };
export type { OrchestratorConfig, ProcessingResult, ProcessingOptions };

// Pipeline exports
export * from './pipeline/index.js';

// Circuit breaker exports
export * from './circuit-breaker/index.js';

// Metrics exports
export * from './metrics/index.js';

// Event manager exports
export * from './events/index.js';

// Config manager exports
export * from './config/index.js';
```

## Test Coverage

Comprehensive test suite created: `/packages/agents/tests/unit/orchestrator/advanced-features.test.ts`

**Test Categories:**
- Pipeline Configuration (5 tests)
  - Pipeline registration and retrieval
  - Pipeline switching
  - Conditional step execution

- Circuit Breaker (6 tests)
  - State management
  - State change events
  - Circuit breaker bypass

- Metrics Collection (7 tests)
  - Per-agent latency tracking
  - Request success/failure metrics
  - Audit trail recording and filtering
  - Metrics reset and export

- Event Emission (8 tests)
  - Pipeline event emission
  - Step-level events
  - Event filtering
  - Event timeline retrieval
  - Event replay

- Configuration Management (5 tests)
  - Dynamic configuration updates
  - Feature flag management
  - A/B test variant selection
  - Configuration change subscriptions

- Health Checks (3 tests)
  - Circuit breaker status integration
  - Metrics in health responses
  - Degraded status reporting

- Integration Tests (3 tests)
  - Concurrent request handling
  - Multi-request audit trails
  - Full request lifecycle tracking

**Total: 37 tests, all passing (382 total tests in agents package)**

## Usage Examples

### Example 1: Custom Pipeline with Conditional Steps

```typescript
const pipeline: PipelineConfig = {
  id: 'high-security-pipeline',
  name: 'High Security Pipeline',
  mode: 'sequential',
  steps: [
    {
      agent: 'guardian',
      required: true,
      timeoutMs: 10000,
      conditions: {
        type: 'or',
        conditions: [
          { field: 'request.resource.kind', operator: 'eq', value: 'secret' },
          { field: 'request.principal.roles', operator: 'contains', value: 'sensitive_ops' }
        ]
      }
    },
    {
      agent: 'enforcer',
      required: true,
      dependsOn: ['guardian']
    },
    {
      agent: 'advisor',
      required: false,
      continueOnError: true
    }
  ],
  failFast: false,
  maxRetries: 2
};

orchestrator.registerPipeline(pipeline);
const result = await orchestrator.processRequest(request, response, {
  pipeline: 'high-security-pipeline'
});
```

### Example 2: Monitoring Circuit Breaker State Changes

```typescript
orchestrator.onCircuitStateChange((change) => {
  console.log(`Circuit breaker ${change.agentType}:`);
  console.log(`  ${change.previousState} -> ${change.newState}`);
  console.log(`  Reason: ${change.reason}`);
  console.log(`  Failures: ${change.metrics.failures}`);
});
```

### Example 3: Tracking Metrics and Performance

```typescript
// Get agent metrics
const guardianMetrics = orchestrator.getAgentMetrics('guardian');
console.log(`Guardian - Mean latency: ${guardianMetrics.latency.mean}ms`);
console.log(`Guardian - p99 latency: ${guardianMetrics.latency.p99}ms`);
console.log(`Guardian - Success rate: ${guardianMetrics.requests.successful}/${guardianMetrics.requests.total}`);

// Get audit trail
const trail = orchestrator.getAuditTrail({ agentType: 'guardian', success: true });
console.log(`Successful operations: ${trail.length}`);
```

### Example 4: Event-Driven Monitoring

```typescript
// Monitor all pipeline events
orchestrator.subscribeToEvents(
  { types: ['pipeline_completed', 'pipeline_failed'] },
  async (event) => {
    console.log(`Pipeline event: ${event.type}`);
    console.log(`Duration: ${event.metadata.durationMs}ms`);

    if (event.type === 'pipeline_failed') {
      // Handle failure
      await alertOps(event);
    }
  }
);

// Monitor specific agent
orchestrator.subscribeToEvents(
  { sources: ['guardian'] },
  (event) => {
    console.log(`Guardian: ${event.type}`);
  }
);
```

### Example 5: Feature Flags and A/B Testing

```typescript
// Set feature flag
orchestrator.setFeatureFlag('new-algorithm', {
  id: 'new-algorithm',
  name: 'New Anomaly Detection Algorithm',
  defaultValue: true,
  rolloutPercentage: 50,
  tags: ['experimental']
});

// Check feature flag
if (orchestrator.getFeatureFlag('new-algorithm', { agentType: 'guardian' })) {
  // Use new algorithm
}

// A/B testing
const variant = orchestrator.getABTestVariant('ml-experiment', userId);
if (variant === 'treatment') {
  // Use new ML model
} else {
  // Use baseline
}
```

## Architecture Highlights

1. **Separation of Concerns**: Each feature (pipeline, circuit breaker, metrics, events, config) is in its own module
2. **Non-Intrusive**: Advanced features are optional and don't affect core agent execution
3. **Observable**: Every operation is traceable through events, metrics, and audit trails
4. **Resilient**: Circuit breakers and fallback strategies handle failures gracefully
5. **Flexible**: Pipelines, feature flags, and A/B tests allow dynamic behavior control
6. **Performant**: Metrics collection is efficient with bounded memory usage
7. **Debuggable**: Event replay and audit trails enable comprehensive debugging

## Performance Impact

- **Minimal Overhead**: Core agent execution path unchanged
- **Bounded Memory**: Audit trail size capped at 10,000 entries
- **Efficient Metrics**: Latency histograms use fixed-size buckets
- **Optional Features**: Can disable metrics/events in lightweight deployments

## Migration Guide

Existing code using `AgentOrchestrator` is fully backward compatible. New features are accessed through new methods:

```typescript
// Old code - still works
const result = await orchestrator.processRequest(request, response);

// New features - opt-in
orchestrator.registerPipeline(customPipeline);
const metrics = orchestrator.getAgentMetrics('guardian');
orchestrator.onCircuitStateChange(handler);
```

## Conclusion

The Agent Orchestrator now provides enterprise-grade features for production authorization systems including advanced pipeline orchestration, resilience patterns, comprehensive observability, and dynamic configuration management.
