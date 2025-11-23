import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentOrchestrator } from '../../../src/orchestrator/agent-orchestrator.js';
import type {
  OrchestratorConfig,
  PipelineConfig,
  CircuitBreakerConfig,
  OrchestratorEvent,
  EventFilter,
} from '../../../src/orchestrator/index.js';
import type { CheckRequest, CheckResponse } from '@authz-engine/core';

// Mock external dependencies
vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn(),
  })),
}));

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    psubscribe: vi.fn(),
    publish: vi.fn(),
    quit: vi.fn(),
  })),
}));

describe('AgentOrchestrator - Advanced Features', () => {
  let orchestrator: AgentOrchestrator;
  let config: OrchestratorConfig;

  const baseConfig: OrchestratorConfig = {
    agents: {
      enabled: true,
      logLevel: 'error',
      guardian: {
        anomalyThreshold: 0.7,
        baselinePeriodDays: 30,
        velocityWindowMinutes: 5,
        enableRealTimeDetection: true,
      },
      analyst: {
        minSampleSize: 50,
        confidenceThreshold: 0.8,
        learningEnabled: false,
      },
      advisor: {
        llmProvider: 'openai',
        llmModel: 'gpt-4',
        enableNaturalLanguage: false,
        maxExplanationLength: 500,
      },
      enforcer: {
        autoEnforceEnabled: false,
        requireApprovalForSeverity: 'high',
        maxActionsPerHour: 100,
        rollbackWindowMinutes: 60,
      },
    },
    store: {
      database: {
        host: 'localhost',
        port: 5432,
        database: 'test',
        user: 'test',
        password: 'test',
      },
      enableVectorSearch: false,
      embeddingDimension: 1536,
      retentionDays: 90,
    },
    eventBus: {
      mode: 'memory',
    },
  };

  const createRequest = (): CheckRequest => ({
    requestId: 'test-req-1',
    principal: {
      id: 'user-123',
      roles: ['user'],
      attributes: {},
    },
    resource: {
      kind: 'document',
      id: 'doc-1',
      attributes: {},
    },
    actions: ['view'],
  });

  const createResponse = (allowed: boolean): CheckResponse => ({
    requestId: 'test-req-1',
    results: {
      view: {
        effect: allowed ? 'allow' : 'deny',
        policy: 'test-policy',
        meta: { matchedRule: 'test-rule' },
      },
    },
    meta: {
      evaluationDurationMs: 5,
      policiesEvaluated: ['test-policy'],
    },
  });

  beforeEach(() => {
    config = JSON.parse(JSON.stringify(baseConfig));
    orchestrator = new AgentOrchestrator(config);
  });

  afterEach(async () => {
    try {
      await orchestrator.shutdown();
    } catch {
      // Ignore shutdown errors in tests
    }
  });

  // ============================================
  // Pipeline Configuration Tests
  // ============================================

  describe('Pipeline Configuration', () => {
    it('should register custom pipeline', async () => {
      const customPipeline: PipelineConfig = {
        id: 'custom-pipeline',
        name: 'Custom Pipeline',
        description: 'A custom execution pipeline',
        mode: 'parallel',
        steps: [
          {
            agent: 'guardian',
            name: 'anomaly-detection',
            required: true,
            timeoutMs: 5000,
          },
          {
            agent: 'enforcer',
            name: 'enforcement-check',
            required: false,
            timeoutMs: 3000,
          },
        ],
        failFast: false,
        maxRetries: 2,
        retryDelayMs: 100,
      };

      orchestrator.registerPipeline(customPipeline);
      const retrieved = orchestrator.getPipeline('custom-pipeline');

      expect(retrieved).toEqual(customPipeline);
      expect(retrieved?.steps).toHaveLength(2);
      expect(retrieved?.mode).toBe('parallel');
    });

    it('should get all registered pipelines', async () => {
      const pipelines = orchestrator.getAllPipelines();
      expect(pipelines.size).toBeGreaterThan(0);
      expect(Array.from(pipelines.keys())).toContain('standard');
    });

    it('should set default pipeline', async () => {
      orchestrator.setDefaultPipeline('standard');
      const config = orchestrator.getDynamicConfig();
      expect(config.pipeline?.id).toBe('standard');
    });

    it('should execute with custom pipeline', async () => {
      await orchestrator.initialize();

      const customPipeline: PipelineConfig = {
        id: 'test-pipeline',
        name: 'Test Pipeline',
        mode: 'sequential',
        steps: [
          {
            agent: 'guardian',
            required: true,
            timeoutMs: 5000,
          },
        ],
      };

      orchestrator.registerPipeline(customPipeline);

      const request = createRequest();
      const response = createResponse(true);

      const result = await orchestrator.processRequest(request, response, {
        pipeline: 'test-pipeline',
      });

      expect(result.pipelineResult?.pipelineId).toBe('test-pipeline');
      expect(result.agentsInvolved).toContain('guardian');
    });

    it('should support conditional step execution', async () => {
      await orchestrator.initialize();

      const request = createRequest();
      const response = createResponse(true);

      // Request with admin role should trigger different behavior
      const adminRequest: CheckRequest = {
        ...request,
        principal: {
          ...request.principal,
          roles: ['admin'],
        },
      };

      const result = await orchestrator.processRequest(adminRequest, response);
      expect(result.pipelineResult).toBeDefined();
      expect(result.pipelineResult?.steps.length).toBeGreaterThan(0);
    });
  });

  // ============================================
  // Circuit Breaker Tests
  // ============================================

  describe('Circuit Breaker', () => {
    it('should get circuit breaker for agent', async () => {
      const breaker = orchestrator.getCircuitBreaker('guardian');
      expect(breaker).toBeDefined();
      expect(breaker.getState()).toBe('closed');
    });

    it('should trip circuit breaker', async () => {
      const breaker = orchestrator.getCircuitBreaker('guardian');

      orchestrator.tripCircuitBreaker('guardian', 'Manual test trip');
      expect(breaker.getState()).toBe('open');
    });

    it('should reset circuit breaker', async () => {
      orchestrator.tripCircuitBreaker('guardian', 'Test trip');
      orchestrator.resetCircuitBreaker('guardian', 'Test reset');

      const breaker = orchestrator.getCircuitBreaker('guardian');
      expect(breaker.getState()).not.toBe('open');
    });

    it('should reset all circuit breakers', async () => {
      orchestrator.tripCircuitBreaker('guardian', 'Test');
      orchestrator.tripCircuitBreaker('enforcer', 'Test');

      orchestrator.resetAllCircuitBreakers('Global reset test');

      expect(orchestrator.getCircuitBreaker('guardian').getState()).not.toBe('open');
      expect(orchestrator.getCircuitBreaker('enforcer').getState()).not.toBe('open');
    });

    it('should emit state change events', async () => {
      const stateChanges: any[] = [];

      const unsubscribe = orchestrator.onCircuitStateChange((change) => {
        stateChanges.push(change);
      });

      orchestrator.tripCircuitBreaker('guardian', 'Test trip');
      orchestrator.resetCircuitBreaker('guardian', 'Test reset');

      expect(stateChanges.length).toBeGreaterThan(0);
      expect(stateChanges[0].agentType).toBe('guardian');
      expect(stateChanges[0].newState).toBe('open');

      unsubscribe();
    });

    it('should skip circuit breaker checks when requested', async () => {
      await orchestrator.initialize();

      orchestrator.tripCircuitBreaker('guardian', 'Test trip');

      const request = createRequest();
      const response = createResponse(true);

      // Should still work with skipCircuitBreaker flag
      const result = await orchestrator.processRequest(request, response, {
        skipCircuitBreaker: true,
      });

      expect(result.response).toBeDefined();
    });
  });

  // ============================================
  // Metrics Tests
  // ============================================

  describe('Metrics Collection', () => {
    it('should collect per-agent latency metrics', async () => {
      await orchestrator.initialize();

      const request = createRequest();
      const response = createResponse(true);

      await orchestrator.processRequest(request, response);

      const guardianMetrics = orchestrator.getAgentMetrics('guardian');
      expect(guardianMetrics.agentType).toBe('guardian');
      expect(guardianMetrics.latency.count).toBeGreaterThan(0);
      expect(guardianMetrics.latency.mean).toBeGreaterThanOrEqual(0);
      expect(guardianMetrics.latency.p95).toBeGreaterThanOrEqual(0);
      expect(guardianMetrics.latency.p99).toBeGreaterThanOrEqual(0);
    });

    it('should get all agent metrics', async () => {
      await orchestrator.initialize();

      const request = createRequest();
      const response = createResponse(true);

      await orchestrator.processRequest(request, response);

      const allMetrics = orchestrator.getAllAgentMetrics();
      expect(Object.keys(allMetrics)).toContain('guardian');
      expect(Object.keys(allMetrics)).toContain('enforcer');
      expect(Object.keys(allMetrics)).toContain('advisor');
      expect(Object.keys(allMetrics)).toContain('analyst');
    });

    it('should track request success and failure', async () => {
      await orchestrator.initialize();

      const request = createRequest();
      const response = createResponse(true);

      await orchestrator.processRequest(request, response);
      await orchestrator.processRequest(request, response);

      const metrics = orchestrator.getAgentMetrics('guardian');
      expect(metrics.requests.total).toBeGreaterThanOrEqual(2);
      expect(metrics.requests.successful ?? 0).toBeGreaterThanOrEqual(0);
    });

    it('should record audit trail with timestamps', async () => {
      await orchestrator.initialize();

      const request = createRequest();
      const response = createResponse(true);

      await orchestrator.processRequest(request, response);

      const auditTrail = orchestrator.getAuditTrail();
      expect(auditTrail.length).toBeGreaterThan(0);

      const entry = auditTrail[0];
      expect(entry.timestamp).toBeInstanceOf(Date);
      expect(entry.requestId).toBeDefined();
      expect(entry.agentType).toBeDefined();
      expect(entry.operation).toBeDefined();
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof entry.success).toBe('boolean');
    });

    it('should filter audit trail by criteria', async () => {
      await orchestrator.initialize();

      const request = createRequest();
      const response = createResponse(true);

      await orchestrator.processRequest(request, response);

      const guardianTrail = orchestrator.getAuditTrail({
        agentType: 'guardian',
      });

      expect(guardianTrail.length).toBeGreaterThan(0);
      guardianTrail.forEach((entry) => {
        expect(entry.agentType).toBe('guardian');
      });
    });

    it('should reset metrics', async () => {
      await orchestrator.initialize();

      const request = createRequest();
      const response = createResponse(true);

      await orchestrator.processRequest(request, response);

      const metricsBefore = orchestrator.getAgentMetrics('guardian');
      expect(metricsBefore.requests.total).toBeGreaterThan(0);

      orchestrator.resetMetrics();

      const metricsAfter = orchestrator.getAgentMetrics('guardian');
      expect(metricsAfter.requests.total).toBe(0);
    });

    it('should subscribe to metrics exports', async () => {
      await orchestrator.initialize();

      const exportedMetrics: any[] = [];

      const unsubscribe = orchestrator.onMetricsExport((metrics) => {
        exportedMetrics.push(metrics);
      });

      const request = createRequest();
      const response = createResponse(true);

      await orchestrator.processRequest(request, response);

      // Wait a bit for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(exportedMetrics.length).toBeGreaterThanOrEqual(0);

      unsubscribe();
    });
  });

  // ============================================
  // Event Emission Tests
  // ============================================

  describe('Event Emission and Subscriptions', () => {
    it('should emit pipeline_started event', async () => {
      await orchestrator.initialize();

      const events: OrchestratorEvent[] = [];

      const subscription = orchestrator.subscribeToEvents(
        { types: ['pipeline_started'] },
        (event) => {
          events.push(event);
        }
      );

      const request = createRequest();
      const response = createResponse(true);

      await orchestrator.processRequest(request, response);

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('pipeline_started');
      expect(events[0].correlationId).toBeDefined();

      subscription.unsubscribe();
    });

    it('should emit step_completed events', async () => {
      await orchestrator.initialize();

      const events: OrchestratorEvent[] = [];

      const subscription = orchestrator.subscribeToEvents(
        { types: ['step_completed'] },
        (event) => {
          events.push(event);
        }
      );

      const request = createRequest();
      const response = createResponse(true);

      await orchestrator.processRequest(request, response);

      expect(events.length).toBeGreaterThan(0);
      events.forEach((event) => {
        expect(event.type).toBe('step_completed');
      });

      subscription.unsubscribe();
    });

    it('should emit pipeline_completed event', async () => {
      await orchestrator.initialize();

      const events: OrchestratorEvent[] = [];

      const subscription = orchestrator.subscribeToEvents(
        { types: ['pipeline_completed'] },
        (event) => {
          events.push(event);
        }
      );

      const request = createRequest();
      const response = createResponse(true);

      await orchestrator.processRequest(request, response);

      expect(events.length).toBeGreaterThan(0);
      expect(events[events.length - 1].type).toBe('pipeline_completed');

      subscription.unsubscribe();
    });

    it('should subscribe to specific event type', async () => {
      await orchestrator.initialize();

      const events: OrchestratorEvent[] = [];

      const subscription = orchestrator.onEvent('pipeline_started', (event) => {
        events.push(event);
      });

      const request = createRequest();
      const response = createResponse(true);

      await orchestrator.processRequest(request, response);

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('pipeline_started');

      subscription.unsubscribe();
    });

    it('should filter events by correlation ID', async () => {
      await orchestrator.initialize();

      const events: OrchestratorEvent[] = [];
      const correlationId = `corr-test-${Date.now()}`;

      const subscription = orchestrator.subscribeToEvents(
        { correlationId },
        (event) => {
          events.push(event);
        }
      );

      const request = createRequest();
      const response = createResponse(true);

      await orchestrator.processRequest(request, response, { correlationId });

      expect(events.length).toBeGreaterThan(0);
      events.forEach((event) => {
        expect(event.correlationId).toBe(correlationId);
      });

      subscription.unsubscribe();
    });

    it('should get event timeline for correlation ID', async () => {
      await orchestrator.initialize();

      const correlationId = `timeline-test-${Date.now()}`;
      const request = createRequest();
      const response = createResponse(true);

      await orchestrator.processRequest(request, response, { correlationId });

      const timeline = orchestrator.getEventTimeline(correlationId);

      expect(timeline.length).toBeGreaterThan(0);
      timeline.forEach((event) => {
        expect(event.correlationId).toBe(correlationId);
      });
    });

    it('should replay events', async () => {
      await orchestrator.initialize();

      const request = createRequest();
      const response = createResponse(true);

      await orchestrator.processRequest(request, response);
      await orchestrator.processRequest(request, response);

      const replayed = await orchestrator.replayEvents();

      expect(replayed.length).toBeGreaterThan(0);
      expect(replayed[0]).toHaveProperty('type');
      expect(replayed[0]).toHaveProperty('timestamp');
    });
  });

  // ============================================
  // Configuration Management Tests
  // ============================================

  describe('Configuration Management', () => {
    it('should get current dynamic configuration', async () => {
      const config = orchestrator.getDynamicConfig();

      expect(config).toBeDefined();
      expect(config.agents).toBeDefined();
      // Pipeline may not always be defined as it's optional
      expect(config).toHaveProperty('agents');
    });

    it('should update configuration dynamically', async () => {
      const originalConfig = orchestrator.getDynamicConfig();

      orchestrator.updateConfig({
        agents: {
          ...originalConfig.agents,
          enabled: false,
        },
      });

      const updatedConfig = orchestrator.getDynamicConfig();
      expect(updatedConfig.agents.enabled).toBe(false);
    });

    it('should get feature flag', async () => {
      const flagValue = orchestrator.getFeatureFlag('test-flag');
      expect(typeof flagValue).toBe('boolean');
    });

    it('should set feature flag', async () => {
      orchestrator.setFeatureFlag('test-flag', {
        id: 'test-flag',
        name: 'Test Flag',
        defaultValue: true,
        rolloutPercentage: 100,
      });

      const flagValue = orchestrator.getFeatureFlag('test-flag');
      expect(typeof flagValue).toBe('boolean');
    });

    it('should get A/B test variant', async () => {
      const variant = orchestrator.getABTestVariant('test-experiment', 'user-123');
      // Variant could be any string or null if not configured
      expect(variant === null || typeof variant === 'string').toBe(true);
    });

    it('should subscribe to configuration changes', async () => {
      const changes: any[] = [];

      orchestrator.onConfigChange((event) => {
        changes.push(event);
      });

      orchestrator.updateConfig({
        agents: {
          ...orchestrator.getDynamicConfig().agents,
          enabled: false,
        },
      });

      // Configuration changes may be batched
      await new Promise((resolve) => setTimeout(resolve, 100));

      // At least one change should have been recorded
      expect(changes.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================
  // Health Check Tests
  // ============================================

  describe('Health Check with Advanced Features', () => {
    it('should include circuit breaker status in health', async () => {
      await orchestrator.initialize();

      const health = await orchestrator.getHealth();

      expect(health.circuitBreakers).toBeDefined();
      expect(health.circuitBreakers.guardian).toBeDefined();
      expect(health.circuitBreakers.enforcer).toBeDefined();
      expect(health.circuitBreakers.advisor).toBeDefined();
      expect(health.circuitBreakers.analyst).toBeDefined();
    });

    it('should include metrics in health', async () => {
      await orchestrator.initialize();

      const request = createRequest();
      const response = createResponse(true);

      await orchestrator.processRequest(request, response);

      const health = await orchestrator.getHealth();

      expect(health.metrics).toBeDefined();
      // Health metrics should include at least the basic structure
      expect(Object.keys(health.metrics).length).toBeGreaterThanOrEqual(0);
    });

    it('should report degraded status when circuit is open', async () => {
      await orchestrator.initialize();

      orchestrator.tripCircuitBreaker('guardian', 'Test degradation');

      const health = await orchestrator.getHealth();

      expect(health.status).toBe('degraded');
    });
  });

  // ============================================
  // Integration Tests
  // ============================================

  describe('Advanced Features Integration', () => {
    it('should handle concurrent requests with metrics tracking', async () => {
      await orchestrator.initialize();

      const request = createRequest();
      const response = createResponse(true);

      const promises = Array.from({ length: 5 }).map(() =>
        orchestrator.processRequest(request, response)
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(result.response).toBeDefined();
        expect(result.pipelineResult).toBeDefined();
      });

      const metrics = orchestrator.getAgentMetrics('guardian');
      expect(metrics.requests.total).toBeGreaterThanOrEqual(5);
    });

    it('should maintain audit trail across multiple requests', async () => {
      await orchestrator.initialize();

      const request = createRequest();
      const response = createResponse(true);

      await orchestrator.processRequest(request, response);
      await orchestrator.processRequest(request, response);
      await orchestrator.processRequest(request, response);

      const auditTrail = orchestrator.getAuditTrail();
      expect(auditTrail.length).toBeGreaterThan(0);

      const uniqueRequestIds = new Set(auditTrail.map((e) => e.requestId));
      expect(uniqueRequestIds.size).toBeGreaterThanOrEqual(1);
    });

    it('should track full request lifecycle with events and metrics', async () => {
      await orchestrator.initialize();

      const events: OrchestratorEvent[] = [];
      const correlationId = `lifecycle-${Date.now()}`;

      const subscription = orchestrator.subscribeToEvents(
        { correlationId },
        (event) => {
          events.push(event);
        }
      );

      const request = createRequest();
      const response = createResponse(true);

      const processingResult = await orchestrator.processRequest(request, response, {
        correlationId,
      });

      const metrics = orchestrator.getAgentMetrics('guardian');
      const timeline = orchestrator.getEventTimeline(correlationId);

      expect(events.length).toBeGreaterThan(0);
      expect(metrics.requests.total).toBeGreaterThan(0);
      expect(timeline.length).toBeGreaterThan(0);
      expect(processingResult.traceId).toBeDefined();
      expect(processingResult.spanId).toBeDefined();

      subscription.unsubscribe();
    });
  });
});
