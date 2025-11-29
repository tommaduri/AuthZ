/**
 * Agent Pipeline Performance Benchmarks
 *
 * Comprehensive benchmarks for the agentic authorization pipeline measuring:
 * - Full pipeline latency
 * - Agent coordination overhead
 * - Concurrent request handling
 * - Individual agent performance
 *
 * Target metrics:
 * - Full pipeline latency: <10ms P99
 * - Agent coordination overhead: <2ms
 * - Concurrent handling: Linear scaling up to 100 requests
 */

import { describe, bench, beforeAll, afterAll, beforeEach } from 'vitest';
import type { CheckRequest, CheckResponse, Principal, Resource } from '@authz-engine/core';

// =============================================================================
// Mock Implementations for Benchmarking
// =============================================================================

/**
 * Mock Decision Store for benchmarking without database overhead
 */
class MockDecisionStore {
  private decisions: Map<string, unknown> = new Map();

  async initialize(): Promise<void> {}
  async close(): Promise<void> {}

  async storeDecision(record: unknown): Promise<void> {
    const id = `decision-${Date.now()}-${Math.random()}`;
    this.decisions.set(id, record);
  }

  async getDecisions(limit: number = 100): Promise<unknown[]> {
    return Array.from(this.decisions.values()).slice(0, limit);
  }
}

/**
 * Mock Event Bus for benchmarking without message queue overhead
 */
class MockEventBus {
  private handlers: Map<string, Array<(data: unknown) => void>> = new Map();

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  subscribe(event: string, handler: (data: unknown) => void): void {
    const handlers = this.handlers.get(event) || [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
  }

  emit(event: string, data: unknown): void {
    const handlers = this.handlers.get(event) || [];
    handlers.forEach(h => h(data));
  }
}

/**
 * Simplified agent implementations for pure computation benchmarking
 */
class MockGuardianAgent {
  private anomalyThreshold = 0.7;
  private requestCounts: Map<string, number> = new Map();

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  analyzeRequest(request: CheckRequest): {
    anomalyScore: number;
    riskFactors: string[];
    anomaly?: { id: string; severity: string };
  } {
    const principalId = request.principal.id;
    const count = (this.requestCounts.get(principalId) || 0) + 1;
    this.requestCounts.set(principalId, count);

    // Compute anomaly score based on various factors
    let score = 0;
    const riskFactors: string[] = [];

    // High request rate
    if (count > 100) {
      score += 0.3;
      riskFactors.push('high_request_rate');
    }

    // Sensitive actions
    const sensitiveActions = ['delete', 'bulk-delete', 'bulk-export', 'admin'];
    if (request.actions.some(a => sensitiveActions.includes(a))) {
      score += 0.2;
      riskFactors.push('sensitive_action');
    }

    // Time-based anomaly (simplified)
    const hour = new Date().getHours();
    if (hour < 6 || hour > 22) {
      score += 0.1;
      riskFactors.push('unusual_time');
    }

    const anomaly = score >= this.anomalyThreshold ? {
      id: `anomaly-${Date.now()}`,
      severity: score > 0.9 ? 'critical' : 'warning',
    } : undefined;

    return { anomalyScore: Math.min(score, 1), riskFactors, anomaly };
  }

  async healthCheck(): Promise<{ state: string; uptime: number }> {
    return { state: 'ready', uptime: Date.now() };
  }
}

class MockEnforcerAgent {
  private blockedPrincipals: Set<string> = new Set();
  private rateLimits: Map<string, { count: number; resetAt: number }> = new Map();
  private rateLimit = 1000;

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  isAllowed(principalId: string): { allowed: boolean; reason?: string } {
    // Check if blocked
    if (this.blockedPrincipals.has(principalId)) {
      return { allowed: false, reason: 'principal_blocked' };
    }

    // Check rate limit
    const now = Date.now();
    const limit = this.rateLimits.get(principalId);

    if (limit && now < limit.resetAt) {
      if (limit.count >= this.rateLimit) {
        return { allowed: false, reason: 'rate_limit_exceeded' };
      }
      limit.count++;
    } else {
      this.rateLimits.set(principalId, { count: 1, resetAt: now + 60000 });
    }

    return { allowed: true };
  }

  async healthCheck(): Promise<{ state: string; uptime: number }> {
    return { state: 'ready', uptime: Date.now() };
  }
}

class MockAdvisorAgent {
  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  explainDecision(
    request: CheckRequest,
    response: CheckResponse,
  ): { summary: string; details: string[] } {
    const results = Object.entries(response.results);
    const allowed = results.filter(([, r]) => r.effect === 'allow').length;
    const denied = results.length - allowed;

    return {
      summary: `${allowed} actions allowed, ${denied} denied`,
      details: results.map(([action, result]) =>
        `${action}: ${result.effect} (${result.policy})`
      ),
    };
  }

  async healthCheck(): Promise<{ state: string; uptime: number }> {
    return { state: 'ready', uptime: Date.now() };
  }
}

class MockAnalystAgent {
  private patterns: Array<{ id: string; type: string; confidence: number }> = [];

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  recordDecision(request: CheckRequest, response: CheckResponse): void {
    // Simplified pattern learning
    const pattern = {
      id: `pattern-${Date.now()}`,
      type: request.resource.kind,
      confidence: Math.random() * 0.3 + 0.7,
    };

    if (this.patterns.length < 100) {
      this.patterns.push(pattern);
    }
  }

  getPatterns(): typeof this.patterns {
    return this.patterns;
  }

  async healthCheck(): Promise<{ state: string; uptime: number }> {
    return { state: 'ready', uptime: Date.now() };
  }
}

/**
 * Mock Orchestrator for benchmarking
 */
class MockAgentOrchestrator {
  private guardian = new MockGuardianAgent();
  private enforcer = new MockEnforcerAgent();
  private advisor = new MockAdvisorAgent();
  private analyst = new MockAnalystAgent();
  private store = new MockDecisionStore();
  private eventBus = new MockEventBus();

  async initialize(): Promise<void> {
    await Promise.all([
      this.store.initialize(),
      this.eventBus.initialize(),
      this.guardian.initialize(),
      this.enforcer.initialize(),
      this.advisor.initialize(),
      this.analyst.initialize(),
    ]);
  }

  async shutdown(): Promise<void> {
    await Promise.all([
      this.guardian.shutdown(),
      this.enforcer.shutdown(),
      this.advisor.shutdown(),
      this.analyst.shutdown(),
    ]);
    await this.eventBus.shutdown();
    await this.store.close();
  }

  async processRequest(
    request: CheckRequest,
    response: CheckResponse,
    options?: { includeExplanation?: boolean },
  ): Promise<{
    response: CheckResponse;
    anomalyScore: number;
    processingTimeMs: number;
    agentsInvolved: string[];
  }> {
    const startTime = performance.now();
    const agentsInvolved: string[] = [];

    // 1. Enforcer check
    const enforcement = this.enforcer.isAllowed(request.principal.id);
    agentsInvolved.push('enforcer');

    if (!enforcement.allowed) {
      return {
        response: this.createDeniedResponse(request, enforcement.reason || 'blocked'),
        anomalyScore: 0,
        processingTimeMs: performance.now() - startTime,
        agentsInvolved,
      };
    }

    // 2. Guardian analysis
    const guardianResult = this.guardian.analyzeRequest(request);
    agentsInvolved.push('guardian');

    // 3. Record for analyst
    this.analyst.recordDecision(request, response);
    agentsInvolved.push('analyst');

    // 4. Generate explanation if requested
    if (options?.includeExplanation) {
      this.advisor.explainDecision(request, response);
      agentsInvolved.push('advisor');
    }

    // 5. Store decision
    await this.store.storeDecision({
      request,
      response,
      anomalyScore: guardianResult.anomalyScore,
    });

    return {
      response,
      anomalyScore: guardianResult.anomalyScore,
      processingTimeMs: performance.now() - startTime,
      agentsInvolved,
    };
  }

  private createDeniedResponse(request: CheckRequest, reason: string): CheckResponse {
    const results: Record<string, { effect: 'deny'; policy: string; meta: { matchedRule: string } }> = {};
    for (const action of request.actions) {
      results[action] = {
        effect: 'deny',
        policy: `enforcer:${reason}`,
        meta: { matchedRule: `enforcer:${reason}` },
      };
    }
    return {
      requestId: request.requestId || `req-${Date.now()}`,
      results,
      meta: { evaluationDurationMs: 0, policiesEvaluated: [] },
    };
  }

  async getHealth(): Promise<{ status: string; agents: Record<string, unknown> }> {
    const [guardian, enforcer, advisor, analyst] = await Promise.all([
      this.guardian.healthCheck(),
      this.enforcer.healthCheck(),
      this.advisor.healthCheck(),
      this.analyst.healthCheck(),
    ]);

    return {
      status: 'healthy',
      agents: { guardian, enforcer, advisor, analyst },
    };
  }
}

// =============================================================================
// Test Data Generators
// =============================================================================

const createPrincipal = (id: string, roles: string[] = ['user']): Principal => ({
  id,
  roles,
  attributes: {
    email: `${id}@example.com`,
    department: 'engineering',
    level: 5,
    isActive: true,
  },
});

const createResource = (kind: string, id: string): Resource => ({
  kind,
  id,
  attributes: {
    ownerId: 'owner-1',
    visibility: 'private',
    department: 'engineering',
  },
});

const createCheckRequest = (
  principal: Principal,
  resource: Resource,
  actions: string[],
): CheckRequest => ({
  requestId: `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
  principal,
  resource,
  actions,
});

const createCheckResponse = (
  requestId: string,
  actions: string[],
  allowed: boolean = true,
): CheckResponse => ({
  requestId,
  results: Object.fromEntries(
    actions.map(action => [
      action,
      {
        effect: allowed ? 'allow' as const : 'deny' as const,
        policy: 'test-policy',
        meta: { matchedRule: 'test-rule' },
      },
    ])
  ),
  meta: {
    evaluationDurationMs: 1,
    policiesEvaluated: ['test-policy'],
  },
});

// =============================================================================
// Benchmark Suites
// =============================================================================

describe('Agent Pipeline Benchmarks', () => {
  let orchestrator: MockAgentOrchestrator;

  const standardPrincipal = createPrincipal('user-123', ['user']);
  const adminPrincipal = createPrincipal('admin-001', ['admin', 'user']);
  const standardResource = createResource('document', 'doc-001');

  beforeAll(async () => {
    orchestrator = new MockAgentOrchestrator();
    await orchestrator.initialize();
  });

  afterAll(async () => {
    await orchestrator.shutdown();
  });

  // ---------------------------------------------------------------------------
  // Full Pipeline Latency (Target: <10ms P99)
  // ---------------------------------------------------------------------------

  describe('Full Pipeline Latency', () => {
    bench('minimal pipeline (no explanation)', async () => {
      const request = createCheckRequest(standardPrincipal, standardResource, ['view']);
      const response = createCheckResponse(request.requestId!, ['view']);
      await orchestrator.processRequest(request, response);
    });

    bench('full pipeline (with explanation)', async () => {
      const request = createCheckRequest(standardPrincipal, standardResource, ['view']);
      const response = createCheckResponse(request.requestId!, ['view']);
      await orchestrator.processRequest(request, response, { includeExplanation: true });
    });

    bench('multi-action pipeline', async () => {
      const request = createCheckRequest(
        standardPrincipal,
        standardResource,
        ['view', 'edit', 'delete'],
      );
      const response = createCheckResponse(request.requestId!, ['view', 'edit', 'delete']);
      await orchestrator.processRequest(request, response);
    });

    bench('admin request pipeline', async () => {
      const request = createCheckRequest(adminPrincipal, standardResource, ['admin']);
      const response = createCheckResponse(request.requestId!, ['admin']);
      await orchestrator.processRequest(request, response);
    });

    bench('sensitive action pipeline', async () => {
      const request = createCheckRequest(standardPrincipal, standardResource, ['bulk-delete']);
      const response = createCheckResponse(request.requestId!, ['bulk-delete'], false);
      await orchestrator.processRequest(request, response);
    });
  });

  // ---------------------------------------------------------------------------
  // Agent Coordination Overhead
  // ---------------------------------------------------------------------------

  describe('Agent Coordination Overhead', () => {
    bench('enforcer check only', () => {
      const enforcer = new MockEnforcerAgent();
      enforcer.isAllowed('user-123');
    });

    bench('guardian analysis only', () => {
      const guardian = new MockGuardianAgent();
      const request = createCheckRequest(standardPrincipal, standardResource, ['view']);
      guardian.analyzeRequest(request);
    });

    bench('advisor explanation only', () => {
      const advisor = new MockAdvisorAgent();
      const request = createCheckRequest(standardPrincipal, standardResource, ['view']);
      const response = createCheckResponse(request.requestId!, ['view']);
      advisor.explainDecision(request, response);
    });

    bench('analyst recording only', () => {
      const analyst = new MockAnalystAgent();
      const request = createCheckRequest(standardPrincipal, standardResource, ['view']);
      const response = createCheckResponse(request.requestId!, ['view']);
      analyst.recordDecision(request, response);
    });

    bench('health check all agents', async () => {
      await orchestrator.getHealth();
    });
  });

  // ---------------------------------------------------------------------------
  // Concurrent Request Handling
  // ---------------------------------------------------------------------------

  describe('Concurrent Request Handling', () => {
    bench('10 concurrent requests', async () => {
      const requests = Array.from({ length: 10 }, (_, i) => {
        const request = createCheckRequest(
          createPrincipal(`user-${i}`),
          createResource('document', `doc-${i}`),
          ['view'],
        );
        const response = createCheckResponse(request.requestId!, ['view']);
        return orchestrator.processRequest(request, response);
      });
      await Promise.all(requests);
    });

    bench('50 concurrent requests', async () => {
      const requests = Array.from({ length: 50 }, (_, i) => {
        const request = createCheckRequest(
          createPrincipal(`user-${i % 10}`),
          createResource('document', `doc-${i}`),
          ['view'],
        );
        const response = createCheckResponse(request.requestId!, ['view']);
        return orchestrator.processRequest(request, response);
      });
      await Promise.all(requests);
    });

    bench('100 concurrent requests', async () => {
      const requests = Array.from({ length: 100 }, (_, i) => {
        const request = createCheckRequest(
          createPrincipal(`user-${i % 10}`),
          createResource('document', `doc-${i}`),
          ['view'],
        );
        const response = createCheckResponse(request.requestId!, ['view']);
        return orchestrator.processRequest(request, response);
      });
      await Promise.all(requests);
    });

    bench('mixed load (varied actions)', async () => {
      const actions = [['view'], ['edit'], ['delete'], ['view', 'edit']];
      const requests = Array.from({ length: 100 }, (_, i) => {
        const request = createCheckRequest(
          createPrincipal(`user-${i % 10}`),
          createResource('document', `doc-${i}`),
          actions[i % 4],
        );
        const response = createCheckResponse(request.requestId!, actions[i % 4]);
        return orchestrator.processRequest(request, response);
      });
      await Promise.all(requests);
    });
  });

  // ---------------------------------------------------------------------------
  // Sequential Batch Processing
  // ---------------------------------------------------------------------------

  describe('Sequential Batch Processing', () => {
    bench('100 sequential requests', async () => {
      for (let i = 0; i < 100; i++) {
        const request = createCheckRequest(
          createPrincipal(`user-${i % 10}`),
          createResource('document', `doc-${i}`),
          ['view'],
        );
        const response = createCheckResponse(request.requestId!, ['view']);
        await orchestrator.processRequest(request, response);
      }
    });

    bench('same user sequential requests', async () => {
      for (let i = 0; i < 100; i++) {
        const request = createCheckRequest(
          standardPrincipal,
          createResource('document', `doc-${i}`),
          ['view'],
        );
        const response = createCheckResponse(request.requestId!, ['view']);
        await orchestrator.processRequest(request, response);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Anomaly Detection Performance
  // ---------------------------------------------------------------------------

  describe('Anomaly Detection Performance', () => {
    bench('normal request (low anomaly score)', () => {
      const guardian = new MockGuardianAgent();
      const request = createCheckRequest(standardPrincipal, standardResource, ['view']);
      guardian.analyzeRequest(request);
    });

    bench('suspicious request (high anomaly score)', () => {
      const guardian = new MockGuardianAgent();
      const request = createCheckRequest(
        createPrincipal('suspicious-user'),
        standardResource,
        ['bulk-delete', 'admin'],
      );
      guardian.analyzeRequest(request);
    });

    bench('rapid fire from same user', () => {
      const guardian = new MockGuardianAgent();
      for (let i = 0; i < 150; i++) {
        const request = createCheckRequest(
          createPrincipal('rapid-user'),
          standardResource,
          ['view'],
        );
        guardian.analyzeRequest(request);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Rate Limiting Performance
  // ---------------------------------------------------------------------------

  describe('Rate Limiting Performance', () => {
    bench('rate limit check (under limit)', () => {
      const enforcer = new MockEnforcerAgent();
      for (let i = 0; i < 100; i++) {
        enforcer.isAllowed('user-123');
      }
    });

    bench('rate limit check (varied users)', () => {
      const enforcer = new MockEnforcerAgent();
      for (let i = 0; i < 100; i++) {
        enforcer.isAllowed(`user-${i}`);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Memory and Resource Usage
  // ---------------------------------------------------------------------------

  describe('Memory and Resource Usage', () => {
    bench('orchestrator initialization', async () => {
      const freshOrchestrator = new MockAgentOrchestrator();
      await freshOrchestrator.initialize();
      await freshOrchestrator.shutdown();
    });

    bench('large request payload', async () => {
      const largeResource: Resource = {
        kind: 'collection',
        id: 'col-001',
        attributes: {
          items: Array.from({ length: 100 }, (_, i) => ({ id: i, data: `item-${i}` })),
          metadata: { tags: Array.from({ length: 50 }, (_, i) => `tag-${i}`) },
        },
      };
      const request = createCheckRequest(standardPrincipal, largeResource, ['view']);
      const response = createCheckResponse(request.requestId!, ['view']);
      await orchestrator.processRequest(request, response);
    });

    bench('request with auxData', async () => {
      const request: CheckRequest = {
        ...createCheckRequest(standardPrincipal, standardResource, ['view']),
        auxData: {
          sourceIP: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          sessionId: 'sess-123',
          geoLocation: { country: 'US', region: 'CA' },
        },
      };
      const response = createCheckResponse(request.requestId!, ['view']);
      await orchestrator.processRequest(request, response);
    });
  });
});

// =============================================================================
// Baseline Expectations
// =============================================================================

/**
 * BASELINE PERFORMANCE EXPECTATIONS
 *
 * Full Pipeline Latency (Target: <10ms P99):
 * - Minimal pipeline (no explanation): <3ms
 * - Full pipeline (with explanation): <5ms
 * - Multi-action pipeline: <7ms
 *
 * Agent Coordination Overhead:
 * - Individual agent operation: <0.5ms
 * - Total coordination overhead: <2ms
 *
 * Concurrent Request Handling:
 * - 10 concurrent: <20ms total
 * - 50 concurrent: <80ms total
 * - 100 concurrent: <150ms total
 * - Linear scaling factor: ~1.5ms per request
 *
 * Anomaly Detection:
 * - Single analysis: <0.2ms
 * - Pattern recognition: <0.5ms
 *
 * Rate Limiting:
 * - Check latency: <0.1ms
 * - No memory leaks under sustained load
 *
 * Memory Usage:
 * - Per-request overhead: <2KB
 * - Orchestrator initialization: <10ms
 */
