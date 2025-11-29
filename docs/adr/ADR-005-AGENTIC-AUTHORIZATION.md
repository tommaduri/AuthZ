# ADR-005: Agentic Authorization Architecture

**Status**: Accepted
**Date**: 2024-11-23
**Deciders**: AuthZ Engine Team
**Technical Story**: Adding intelligent, autonomous capabilities to authorization

---

## Context

Traditional authorization systems are stateless and reactive - they evaluate each request independently without learning or adaptation. We wanted to add intelligent capabilities:

1. **Anomaly Detection**: Identify suspicious access patterns
2. **Pattern Learning**: Discover correlations and suggest policy improvements
3. **Natural Language**: Explain decisions and answer policy questions
4. **Autonomous Enforcement**: Take protective actions automatically

The challenge was designing these "agentic" features to work harmoniously without introducing complexity or performance overhead.

## Decision

We designed a **4-agent architecture** with specialized roles:

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
         (PostgreSQL)     (Redis/Memory)
```

### Agent Responsibilities

| Agent | Role | Input | Output |
|-------|------|-------|--------|
| **GUARDIAN** | Security & Anomaly | Authorization decisions | Risk scores, anomalies |
| **ANALYST** | Learning & Patterns | Decision history | Patterns, optimizations |
| **ADVISOR** | Explanations & NL | Decisions + context | Explanations, answers |
| **ENFORCER** | Actions & Protection | Anomalies, commands | Enforcement actions |

### Processing Flow
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

## Consequences

### Positive
- **Separation of Concerns**: Each agent has clear responsibility
- **Composable**: Agents can be enabled/disabled independently
- **Testable**: Each agent can be tested in isolation
- **Extensible**: New agents can be added without modifying others
- **Non-blocking**: Agents process asynchronously, don't block decisions

### Negative
- **Complexity**: More moving parts than simple stateless checks
- **Storage Requirements**: Need database for decision history
- **LLM Dependency**: ADVISOR requires external LLM API
- **Latency**: Agent processing adds ~10-50ms overhead

### Neutral
- Agents are opt-in; server works without them
- Processing happens post-decision, doesn't affect core authorization

## Agent Design Details

### GUARDIAN Agent
```typescript
interface GuardianConfig {
  anomalyThreshold: number;      // Default: 0.7
  baselinePeriodDays: number;    // Default: 7
  velocityWindowMinutes: number; // Default: 5
  enableRealTimeDetection: boolean;
}

// Anomaly Types
type AnomalyType =
  | 'velocity_spike'        // Too many requests
  | 'permission_escalation' // New elevated actions
  | 'pattern_deviation'     // Different from baseline
  | 'unusual_access_time';  // Outside normal hours
```

### ANALYST Agent
```typescript
interface AnalystConfig {
  minSampleSize: number;         // Default: 100
  confidenceThreshold: number;   // Default: 0.8
  learningEnabled: boolean;
  patternDiscoveryInterval: string; // Cron: '0 */6 * * *'
}

// Pattern Types
type PatternType =
  | 'access_correlation'  // Related resources accessed together
  | 'temporal_pattern'    // Time-based access patterns
  | 'role_cluster'        // Roles with similar permissions
  | 'denial_pattern';     // Common denial reasons
```

### ADVISOR Agent
```typescript
interface AdvisorConfig {
  llmProvider: 'openai' | 'anthropic' | 'local';
  llmModel: string;              // Default: 'gpt-4'
  enableNaturalLanguage: boolean;
  maxExplanationLength: number;  // Default: 500
}

// Explanation Structure
interface DecisionExplanation {
  summary: string;
  factors: Array<{
    description: string;
    impact: 'positive' | 'negative' | 'neutral';
  }>;
  naturalLanguage: string;
  recommendations: string[];
  pathToAllow?: string;
}
```

### ENFORCER Agent
```typescript
interface EnforcerConfig {
  autoEnforceEnabled: boolean;
  requireApprovalForSeverity: 'low' | 'medium' | 'high' | 'critical';
  maxActionsPerHour: number;     // Default: 100
  rollbackWindowMinutes: number; // Default: 60
}

// Action Types
type ActionType =
  | 'rate_limit'       // Slow down requests
  | 'temporary_block'  // Block for duration
  | 'require_mfa'      // Force re-authentication
  | 'alert_admin'      // Notify security team
  | 'revoke_session';  // End user session
```

## Alternatives Considered

| Alternative | Pros | Cons | Why Not Chosen |
|-------------|------|------|----------------|
| **Single monolithic agent** | Simpler | Hard to maintain, test | Violates SRP |
| **External agent service** | Decoupled | Network latency, complexity | Over-engineering |
| **Rule-based only** | Predictable | Can't learn, limited | No intelligence |
| **Full ML pipeline** | Powerful | Heavy infrastructure | Overkill for MVP |

## Inter-Agent Communication

Agents communicate via EventBus:

```typescript
// GUARDIAN publishes anomaly
await eventBus.publish({
  eventType: 'anomaly_detected',
  agentType: 'guardian',
  payload: { anomaly, decision }
});

// ENFORCER subscribes and acts
eventBus.subscribe('anomaly_detected', async (event) => {
  if (event.payload.anomaly.severity === 'critical') {
    await this.triggerAction('temporary_block', ...);
  }
});
```

## Performance Considerations

- Agents process after response is sent to client
- Heavy operations (pattern discovery) run on schedule
- LLM calls are cached by request signature
- DecisionStore uses connection pooling

## Related ADRs
- ADR-001: CEL Expression Language (used in policy conditions)
- ADR-004: Memory-first Development (agents use memory store in dev)

## References
- [AGENTIC_AUTHZ_VISION.md](../AGENTIC_AUTHZ_VISION.md) - Full vision document
- [OpenAI API](https://platform.openai.com/docs/api-reference)
- [Anthropic Claude API](https://docs.anthropic.com/en/api)
