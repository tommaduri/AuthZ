# Agentic Authorization API Patterns - Research Analysis

**Research Date**: 2025-11-23
**Agent**: RESEARCHER (Hive Mind Swarm)
**Swarm ID**: swarm-1763909726416-qv7yehunp

## Executive Summary

This research analyzes the current AuthZ Engine implementation against industry best practices from Cerbos, OPA (Open Policy Agent), and emerging agentic authorization patterns. The implementation is solid with 4 well-structured agents (Guardian, Analyst, Advisor, Enforcer), but there are opportunities to enhance API coverage and NestJS integration.

---

## 1. Current Implementation Analysis

### 1.1 Agent Architecture (Excellent)

The current implementation at `/packages/agents/src` follows a clean, modular architecture:

| Agent | Purpose | Status |
|-------|---------|--------|
| **Guardian** | Anomaly detection, velocity tracking, baseline comparison | Complete |
| **Analyst** | Pattern learning, correlation analysis, policy suggestions | Complete |
| **Advisor** | LLM-powered explanations, natural language Q&A | Complete |
| **Enforcer** | Rate limiting, blocking, MFA triggers, action rollback | Complete |

**Strengths**:
- Clear separation of concerns
- Event-driven coordination via EventBus
- Comprehensive type definitions
- Good test coverage structure

**Key Files**:
- `/packages/agents/src/orchestrator/agent-orchestrator.ts` - Central coordination
- `/packages/agents/src/types/agent.types.ts` - Well-defined contracts

### 1.2 Current REST API Coverage

The REST server at `/packages/server/src/rest/server.ts` already implements:

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/v1/check/agentic` | POST | Full agent pipeline check | Implemented |
| `/v1/agents/health` | GET | Agent health status | Implemented |
| `/v1/agents/patterns` | GET | Discovered patterns | Implemented |
| `/v1/agents/patterns/discover` | POST | Trigger discovery | Implemented |
| `/v1/agents/anomalies/:principalId` | GET | Principal anomalies | Implemented |
| `/v1/agents/actions/pending` | GET | Pending enforcer actions | Implemented |
| `/v1/agents/actions/:id/approve` | POST | Approve action | Implemented |
| `/v1/agents/ask` | POST | Natural language Q&A | Implemented |
| `/v1/agents/debug` | POST | Policy debugging | Implemented |
| `/v1/agents/enforce` | POST | Manual enforcement | Implemented |

### 1.3 NestJS Integration (Good Foundation)

The NestJS package at `/packages/nestjs/src` provides:

**Decorators** (well-implemented):
- `@Authorize()` - Standard authorization
- `@AuthorizeWithExplanation()` - With LLM explanation
- `@AnomalyProtected()` - Anomaly threshold blocking
- `@AuditAction()` - Audit logging
- `@AuthzExplanation` - Parameter decorator
- `@AnomalyScore` - Parameter decorator

**Guard** (`authz.guard.ts`):
- Full support for HTTP, WebSocket, and GraphQL contexts
- Agentic feature integration
- Anomaly threshold enforcement

---

## 2. Gap Analysis & Recommendations

### 2.1 Missing REST API Endpoints

Based on Cerbos and OPA patterns, the following endpoints would enhance the API:

#### Priority 1 (Critical)

```
GET  /v1/agents/explain/:requestId    - Retrieve explanation for past decision
POST /v1/agents/anomalies/report      - Bulk anomaly report generation
GET  /v1/agents/metrics               - Agent performance metrics (Prometheus-compatible)
```

#### Priority 2 (High)

```
GET  /v1/agents/patterns/:patternId              - Get specific pattern
POST /v1/agents/patterns/:patternId/validate     - Validate/approve a pattern
DELETE /v1/agents/patterns/:patternId            - Delete/reject pattern

POST /v1/agents/anomalies/:anomalyId/resolve     - Resolve an anomaly
GET  /v1/agents/enforcer/rate-limits             - View active rate limits
GET  /v1/agents/enforcer/blocks                  - View active blocks
DELETE /v1/agents/enforcer/rate-limits/:id       - Remove rate limit

GET  /v1/agents/decisions                        - Query decision history
POST /v1/agents/decisions/feedback               - Submit decision feedback
```

#### Priority 3 (Nice to Have)

```
GET  /v1/agents/config                - Current agent configuration
PUT  /v1/agents/config                - Update agent configuration
POST /v1/agents/export                - Export patterns/anomalies
POST /v1/agents/import                - Import patterns/config
```

### 2.2 Missing NestJS Features

#### 2.2.1 New Decorator: `@AgenticAuthorize`

A unified decorator that combines all agentic features:

```typescript
@AgenticAuthorize({
  resource: 'payment',
  action: 'create',
  anomalyThreshold: 0.7,
  requireExplanation: true,
  auditLevel: 'detailed',
  onHighRisk: 'require_mfa',  // New: trigger enforcement
  context: { transactionType: 'withdrawal' }
})
```

#### 2.2.2 Missing Decorators

```typescript
// Risk-based step-up authentication
@RiskBasedAuth({
  lowRisk: 'allow',           // < 0.3 score
  mediumRisk: 'verify_email', // 0.3-0.7
  highRisk: 'require_mfa'     // > 0.7
})

// Conditional audit based on outcome
@AuditOnDeny()
@AuditOnAllow()
@AuditSensitive()  // Always audit, regardless of outcome

// Rate limiting at decorator level
@RateLimited({
  maxRequests: 10,
  windowMs: 60000,
  useAgentEnforcement: true
})

// Pattern-aware authorization
@PatternAware({
  checkDenialPatterns: true,
  suggestAlternatives: true
})
```

#### 2.2.3 Module Configuration Enhancements

```typescript
AuthzModule.forRoot({
  serverUrl: 'http://authz-engine:3592',
  agentic: {
    enabled: true,
    defaultAnomalyThreshold: 0.7,
    defaultExplanation: false,
    defaultAudit: true,
    enforcementWebhook: 'https://...',
    llmProvider: 'anthropic',
  },
  caching: {
    enabled: true,
    ttlMs: 60000,
    maxSize: 1000,
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    resetTimeout: 30000,
  },
})
```

### 2.3 Industry Best Practices Comparison

#### Cerbos Patterns Applied

| Cerbos Feature | Current Status | Recommendation |
|----------------|----------------|----------------|
| PlanResources API | Not implemented | Add `/v1/plan` for query planning |
| Audit Sink | Partial | Add structured audit log export |
| Schema Validation | Basic | Add JSON Schema validation endpoints |
| Playground | Not implemented | Add `/v1/playground/*` routes |

#### OPA Patterns Applied

| OPA Feature | Current Status | Recommendation |
|-------------|----------------|----------------|
| Partial Evaluation | Not implemented | Consider for complex policies |
| Decision Logging | Via agents | Already good with Analyst agent |
| Bundle API | Not implemented | Add policy bundle management |
| Status API | Basic | Enhance `/v1/agents/health` |

---

## 3. Recommended API Structure

### 3.1 Complete REST API Reference

```yaml
# Core Authorization
POST /api/check                     # Standard check (Cerbos-compatible)
POST /api/check/batch               # Batch check
POST /v1/check/agentic              # Agentic check with full pipeline

# Agent Management
GET  /v1/agents/health              # Health status
GET  /v1/agents/metrics             # Prometheus metrics
GET  /v1/agents/config              # Current configuration

# Anomaly Detection (Guardian)
GET  /v1/agents/anomalies                       # List all anomalies
GET  /v1/agents/anomalies/:principalId          # Anomalies for principal
GET  /v1/agents/anomalies/:anomalyId/detail     # Anomaly details
POST /v1/agents/anomalies/:anomalyId/resolve    # Resolve anomaly
POST /v1/agents/anomalies/report                # Generate report

# Pattern Learning (Analyst)
GET  /v1/agents/patterns                        # List patterns
GET  /v1/agents/patterns/:patternId             # Pattern detail
POST /v1/agents/patterns/discover               # Trigger discovery
POST /v1/agents/patterns/:patternId/validate    # Validate pattern
DELETE /v1/agents/patterns/:patternId           # Delete pattern

# Explanations (Advisor)
POST /v1/agents/explain             # Explain a decision
GET  /v1/agents/explain/:requestId  # Get cached explanation
POST /v1/agents/ask                 # Natural language Q&A
POST /v1/agents/debug               # Debug policy

# Enforcement (Enforcer)
POST /v1/agents/enforce             # Trigger enforcement
GET  /v1/agents/actions/pending     # Pending actions
POST /v1/agents/actions/:id/approve # Approve action
POST /v1/agents/actions/:id/reject  # Reject action
POST /v1/agents/actions/:id/rollback # Rollback action
GET  /v1/agents/enforcer/rate-limits # Active rate limits
GET  /v1/agents/enforcer/blocks      # Active blocks
DELETE /v1/agents/enforcer/rate-limits/:principalId # Remove rate limit
DELETE /v1/agents/enforcer/blocks/:principalId     # Remove block

# Decision History
GET  /v1/agents/decisions           # Query decisions
POST /v1/agents/decisions/feedback  # Submit feedback
```

### 3.2 NestJS Decorator Recommendations

```typescript
// Complete decorator suite
export {
  // Core
  Authorize,
  AuthorizeResource,
  RequireRole,
  Public,

  // Agentic
  AgenticAuthorize,        // NEW: Unified agentic decorator
  AuthorizeWithExplanation,
  AnomalyProtected,
  AuditAction,
  RiskBasedAuth,           // NEW: Step-up auth
  PatternAware,            // NEW: Pattern checking

  // Parameter decorators
  AuthzExplanation,
  AnomalyScore,
  AuthzFactors,
  AuthzConfidence,
  RiskLevel,               // NEW: Get risk level
  PatternMatches,          // NEW: Get matched patterns

  // Rate limiting
  RateLimited,             // NEW: Agent-backed rate limiting

  // Pre-built resource decorators
  AuthorizeAvatar,
  AuthorizeSubscription,
  AuthorizeChat,
  AuthorizePayout,
  AuthorizeNotification,
};
```

---

## 4. Implementation Priority for Coder Agent

### Phase 1: API Completion (High Priority)

1. **Add missing explanation endpoint**:
   - `GET /v1/agents/explain/:requestId`
   - Store explanations with TTL in decision store

2. **Add anomaly resolution endpoint**:
   - `POST /v1/agents/anomalies/:anomalyId/resolve`
   - Connect to GuardianAgent.resolveAnomaly()

3. **Add Prometheus metrics endpoint**:
   - `GET /v1/agents/metrics`
   - Expose agent metrics in Prometheus format

4. **Add enforcer management endpoints**:
   - `GET /v1/agents/enforcer/rate-limits`
   - `GET /v1/agents/enforcer/blocks`
   - `DELETE /v1/agents/enforcer/rate-limits/:principalId`
   - `DELETE /v1/agents/enforcer/blocks/:principalId`

### Phase 2: NestJS Enhancement (Medium Priority)

1. **Create `@AgenticAuthorize` decorator**:
   - Unifies all agentic features
   - Single decorator for most use cases

2. **Add `@RiskBasedAuth` decorator**:
   - Step-up authentication based on anomaly score
   - Configurable thresholds and actions

3. **Add new parameter decorators**:
   - `@RiskLevel()` - Get computed risk level
   - `@PatternMatches()` - Get matched patterns

4. **Enhance module configuration**:
   - Add agentic defaults
   - Add circuit breaker support
   - Add caching configuration

### Phase 3: Advanced Features (Lower Priority)

1. **Pattern management API**
2. **Decision history query API**
3. **Bulk operations**
4. **Export/Import APIs**

---

## 5. Code Snippets for Coder Agent

### 5.1 New Endpoint Implementation Pattern

```typescript
// Example: Prometheus metrics endpoint
this.server.get('/v1/agents/metrics', async (request, reply) => {
  if (!this.orchestrator) {
    reply.status(503).send({ error: 'Agentic features not available' });
    return;
  }

  try {
    const health = await this.orchestrator.getHealth();
    const metrics = this.formatPrometheusMetrics(health);

    reply.header('Content-Type', 'text/plain; charset=utf-8');
    return metrics;
  } catch (error) {
    this.logger.error('Metrics collection failed', error);
    reply.status(500).send('# Error collecting metrics');
  }
});

private formatPrometheusMetrics(health: any): string {
  const lines: string[] = [];

  // Agent status
  for (const [agent, status] of Object.entries(health.agents)) {
    const s = status as any;
    lines.push(`authz_agent_state{agent="${agent}"} ${s.state === 'ready' ? 1 : 0}`);
    lines.push(`authz_agent_processed_total{agent="${agent}"} ${s.metrics.processedCount}`);
    lines.push(`authz_agent_errors_total{agent="${agent}"} ${s.metrics.errorCount}`);
    lines.push(`authz_agent_processing_time_ms{agent="${agent}"} ${s.metrics.avgProcessingTimeMs}`);
  }

  return lines.join('\n');
}
```

### 5.2 AgenticAuthorize Decorator Pattern

```typescript
// packages/nestjs/src/decorators.ts

export interface AgenticAuthzOptions {
  resource: string;
  action: string;
  anomalyThreshold?: number;      // Default: 0.8
  requireExplanation?: boolean;   // Default: false
  auditLevel?: 'none' | 'basic' | 'detailed'; // Default: 'basic'
  onHighRisk?: 'block' | 'warn' | 'require_mfa';
  context?: Record<string, unknown>;
}

export function AgenticAuthorize(options: AgenticAuthzOptions) {
  const {
    anomalyThreshold = 0.8,
    requireExplanation = false,
    auditLevel = 'basic',
    onHighRisk = 'block',
  } = options;

  return applyDecorators(
    SetMetadata(AUTHZ_METADATA_KEY, {
      resource: options.resource,
      action: options.action,
      includeExplanation: requireExplanation,
      checkAnomalies: true,
      auditAction: auditLevel !== 'none',
      context: options.context,
    }),
    SetMetadata(ANOMALY_PROTECTED_KEY, {
      enabled: true,
      maxAnomalyScore: anomalyThreshold,
      logHighAnomaly: true,
      onAnomaly: onHighRisk,
    }),
    SetMetadata(AUDIT_ACTION_KEY, {
      enabled: auditLevel !== 'none',
      includeBody: auditLevel === 'detailed',
      includeResponse: auditLevel === 'detailed',
    }),
    UseGuards(AuthzGuard),
  );
}
```

### 5.3 Enforcer Endpoints Pattern

```typescript
// GET /v1/agents/enforcer/rate-limits
this.server.get('/v1/agents/enforcer/rate-limits', async (request, reply) => {
  if (!this.orchestrator) {
    reply.status(503).send({ error: 'Agentic features not available' });
    return;
  }

  try {
    // Access enforcer directly (need to expose via orchestrator)
    const rateLimits = this.orchestrator.getEnforcerRateLimits();
    return {
      count: rateLimits.length,
      rateLimits: rateLimits.map(rl => ({
        principalId: rl.principalId,
        limitUntil: rl.limitUntil,
        reason: rl.reason,
        actionId: rl.actionId,
        remainingMs: Math.max(0, new Date(rl.limitUntil).getTime() - Date.now()),
      })),
    };
  } catch (error) {
    this.logger.error('Get rate limits failed', error);
    reply.status(500).send({
      error: error instanceof Error ? error.message : 'Failed to get rate limits',
    });
  }
});

// DELETE /v1/agents/enforcer/rate-limits/:principalId
this.server.delete<{ Params: { principalId: string } }>(
  '/v1/agents/enforcer/rate-limits/:principalId',
  async (request, reply) => {
    if (!this.orchestrator) {
      reply.status(503).send({ error: 'Agentic features not available' });
      return;
    }

    try {
      const { principalId } = request.params;
      const removed = await this.orchestrator.removeRateLimit(principalId);

      if (!removed) {
        reply.status(404).send({ error: 'Rate limit not found' });
        return;
      }

      return { message: 'Rate limit removed', principalId };
    } catch (error) {
      this.logger.error('Remove rate limit failed', error);
      reply.status(500).send({
        error: error instanceof Error ? error.message : 'Failed to remove rate limit',
      });
    }
  }
);
```

---

## 6. Orchestrator Enhancements Needed

The `AgentOrchestrator` class needs additional methods to support new endpoints:

```typescript
// Add to orchestrator/agent-orchestrator.ts

/**
 * Get active rate limits from enforcer
 */
getEnforcerRateLimits(): RateLimitEntry[] {
  return this.enforcer.getRateLimits();
}

/**
 * Get active blocks from enforcer
 */
getEnforcerBlocks(): BlockEntry[] {
  return this.enforcer.getBlocks();
}

/**
 * Remove rate limit for principal
 */
async removeRateLimit(principalId: string): Promise<boolean> {
  return this.enforcer.removeRateLimit(principalId);
}

/**
 * Remove block for principal
 */
async removeBlock(principalId: string): Promise<boolean> {
  return this.enforcer.removeBlock(principalId);
}

/**
 * Resolve an anomaly
 */
async resolveAnomaly(
  anomalyId: string,
  resolution: 'resolved' | 'false_positive',
  notes?: string
): Promise<void> {
  return this.guardian.resolveAnomaly(anomalyId, resolution, notes);
}

/**
 * Validate a learned pattern
 */
async validatePattern(
  patternId: string,
  isApproved: boolean,
  validatedBy: string
): Promise<void> {
  return this.analyst.validatePattern(patternId, isApproved, validatedBy);
}
```

---

## 7. Conclusion

The AuthZ Engine has a strong agentic foundation. The recommended enhancements focus on:

1. **API Completeness**: Adding management endpoints for rate limits, blocks, and anomaly resolution
2. **NestJS DX**: Creating the unified `@AgenticAuthorize` decorator for better developer experience
3. **Observability**: Adding Prometheus metrics and enhanced health checks
4. **Operational Control**: Endpoints for managing enforcer state and pattern validation

These enhancements will make the system production-ready and align with industry best practices from Cerbos, OPA, and modern authorization platforms.

---

**Research completed by**: RESEARCHER Agent
**For implementation by**: CODER Agent
**Coordination method**: Hive Mind Byzantine Consensus
