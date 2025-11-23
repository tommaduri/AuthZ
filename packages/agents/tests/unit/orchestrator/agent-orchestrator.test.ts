import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AgentOrchestrator } from '../../../src/orchestrator/agent-orchestrator.js';
import type { OrchestratorConfig } from '../../../src/orchestrator/agent-orchestrator.js';
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

describe('AgentOrchestrator', () => {
  let orchestrator: AgentOrchestrator;
  let config: OrchestratorConfig;

  beforeEach(() => {
    config = {
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
          enableNaturalLanguage: false, // Disable LLM in tests
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

    orchestrator = new AgentOrchestrator(config);
  });

  afterEach(async () => {
    try {
      await orchestrator.shutdown();
    } catch {
      // Ignore shutdown errors in tests
    }
  });

  describe('initialization', () => {
    it('should initialize all agents', async () => {
      await orchestrator.initialize();

      const health = await orchestrator.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.agents.guardian.state).toBe('ready');
      expect(health.agents.analyst.state).toBe('ready');
      expect(health.agents.advisor.state).toBe('ready');
      expect(health.agents.enforcer.state).toBe('ready');
    });
  });

  describe('processRequest', () => {
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
        view: { effect: allowed ? 'allow' : 'deny', policy: 'test-policy', meta: { matchedRule: 'test-rule' } },
      },
      meta: {
        evaluationDurationMs: 5,
        policiesEvaluated: ['test-policy'],
      },
    });

    it('should process request through agent pipeline', async () => {
      await orchestrator.initialize();

      const request = createRequest();
      const response = createResponse(true);

      const result = await orchestrator.processRequest(request, response);

      expect(result.response).toBe(response);
      expect(result.anomalyScore).toBeDefined();
      expect(result.enforcement?.allowed).toBe(true);
      expect(result.agentsInvolved).toContain('guardian');
      expect(result.agentsInvolved).toContain('enforcer');
    });

    it('should include explanation when requested', async () => {
      await orchestrator.initialize();

      const request = createRequest();
      const response = createResponse(true);

      const result = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
      });

      expect(result.explanation).toBeDefined();
      expect(result.agentsInvolved).toContain('advisor');
    });

    it('should block rate-limited principals', async () => {
      await orchestrator.initialize();

      // Trigger enforcement
      await orchestrator.triggerEnforcement('rate_limit', 'user-blocked', 'Test');

      const request: CheckRequest = {
        ...createRequest(),
        principal: { id: 'user-blocked', roles: ['user'], attributes: {} },
      };
      const response = createResponse(true);

      const result = await orchestrator.processRequest(request, response);

      expect(result.enforcement?.allowed).toBe(false);
    });
  });

  describe('pattern discovery', () => {
    it('should trigger pattern discovery', async () => {
      await orchestrator.initialize();

      const patterns = await orchestrator.discoverPatterns();

      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should return discovered patterns', async () => {
      await orchestrator.initialize();

      const patterns = orchestrator.getPatterns();

      expect(Array.isArray(patterns)).toBe(true);
    });
  });

  describe('enforcement actions', () => {
    it('should get pending actions', async () => {
      await orchestrator.initialize();

      const pending = orchestrator.getPendingActions();

      expect(Array.isArray(pending)).toBe(true);
    });

    it('should trigger manual enforcement', async () => {
      await orchestrator.initialize();

      const action = await orchestrator.triggerEnforcement(
        'rate_limit',
        'user-manual',
        'Manual enforcement test'
      );

      expect(action.type).toBe('rate_limit');
      expect(action.status).toBe('completed');
    });
  });

  describe('anomalies', () => {
    it('should get anomalies for principal', async () => {
      await orchestrator.initialize();

      const anomalies = orchestrator.getAnomalies('user-123');

      expect(Array.isArray(anomalies)).toBe(true);
    });
  });

  describe('natural language queries', () => {
    it('should answer policy questions', async () => {
      await orchestrator.initialize();

      const answer = await orchestrator.askQuestion('Why was access denied?');

      // Without LLM configured, returns error message
      expect(typeof answer).toBe('string');
    });

    it('should debug policies', async () => {
      await orchestrator.initialize();

      const diagnosis = await orchestrator.debugPolicy(
        'Users cannot access premium content',
        'apiVersion: v1\nkind: ResourcePolicy'
      );

      expect(typeof diagnosis).toBe('string');
    });
  });

  describe('health monitoring', () => {
    it('should return comprehensive health status', async () => {
      await orchestrator.initialize();

      const health = await orchestrator.getHealth();

      expect(health.status).toBeDefined();
      expect(health.agents).toBeDefined();
      expect(health.infrastructure).toBeDefined();
      expect(health.infrastructure.store).toBe('connected');
      expect(health.infrastructure.eventBus).toBe('connected');
    });

    it('should report healthy when all agents are ready', async () => {
      await orchestrator.initialize();

      const health = await orchestrator.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.agents.guardian.state).toBe('ready');
      expect(health.agents.analyst.state).toBe('ready');
      expect(health.agents.advisor.state).toBe('ready');
      expect(health.agents.enforcer.state).toBe('ready');
    });

    it('should include agent metrics in health check', async () => {
      await orchestrator.initialize();

      const health = await orchestrator.getHealth();

      expect(health.agents.guardian.metrics).toBeDefined();
      expect(health.agents.analyst.metrics).toBeDefined();
      expect(health.agents.advisor.metrics).toBeDefined();
      expect(health.agents.enforcer.metrics).toBeDefined();
    });

    it('should include agent IDs in health check', async () => {
      await orchestrator.initialize();

      const health = await orchestrator.getHealth();

      expect(health.agents.guardian.agentId).toBeDefined();
      expect(health.agents.analyst.agentId).toBeDefined();
      expect(health.agents.advisor.agentId).toBeDefined();
      expect(health.agents.enforcer.agentId).toBeDefined();
    });
  });

  describe('processRequest pipeline', () => {
    const createRequest = (overrides: Partial<CheckRequest> = {}): CheckRequest => ({
      requestId: 'pipeline-test-req',
      principal: {
        id: 'user-pipeline',
        roles: ['user'],
        attributes: {},
      },
      resource: {
        kind: 'document',
        id: 'doc-pipeline',
        attributes: {},
      },
      actions: ['view'],
      ...overrides,
    });

    const createResponse = (allowed: boolean): CheckResponse => ({
      requestId: 'pipeline-test-req',
      results: {
        view: { allowed, matchedRule: 'pipeline-test-rule' },
      },
      meta: {
        evaluationTime: 5,
        policyCount: 1,
      },
    });

    it('should process request in correct order: enforcer check, guardian analysis, recording', async () => {
      await orchestrator.initialize();

      const request = createRequest();
      const response = createResponse(true);

      const result = await orchestrator.processRequest(request, response);

      // Should have enforcer and guardian in agents involved
      expect(result.agentsInvolved).toContain('enforcer');
      expect(result.agentsInvolved).toContain('guardian');
      // Enforcer should be first (checked before processing)
      expect(result.agentsInvolved.indexOf('enforcer')).toBeLessThan(
        result.agentsInvolved.indexOf('guardian'),
      );
    });

    it('should return processing time', async () => {
      await orchestrator.initialize();

      const request = createRequest();
      const response = createResponse(true);

      const result = await orchestrator.processRequest(request, response);

      expect(result.processingTimeMs).toBeDefined();
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should include anomaly score from guardian', async () => {
      await orchestrator.initialize();

      const request = createRequest();
      const response = createResponse(true);

      const result = await orchestrator.processRequest(request, response);

      expect(typeof result.anomalyScore).toBe('number');
      expect(result.anomalyScore).toBeGreaterThanOrEqual(0);
      expect(result.anomalyScore).toBeLessThanOrEqual(1);
    });

    it('should pass policy context to advisor when including explanation', async () => {
      await orchestrator.initialize();

      const request = createRequest();
      const response = createResponse(true);
      const policyContext = {
        matchedRules: ['allow-users-view'],
        derivedRoles: ['document_viewer'],
      };

      const result = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
        policyContext,
      });

      expect(result.explanation).toBeDefined();
      // The explanation should include derived role information
      const hasDerivedRoleFactor = result.explanation!.factors.some(
        (f) => f.type === 'derived_role',
      );
      expect(hasDerivedRoleFactor).toBe(true);
    });

    it('should handle requests with multiple actions', async () => {
      await orchestrator.initialize();

      const request = createRequest({
        actions: ['view', 'edit', 'delete'],
      });
      const response: CheckResponse = {
        requestId: 'multi-action-req',
        results: {
          view: { allowed: true, matchedRule: 'allow-view' },
          edit: { allowed: true, matchedRule: 'allow-edit' },
          delete: { allowed: false, matchedRule: 'deny-delete' },
        },
        meta: { evaluationTime: 10, policyCount: 3 },
      };

      const result = await orchestrator.processRequest(request, response);

      expect(result.response.results.view.allowed).toBe(true);
      expect(result.response.results.edit.allowed).toBe(true);
      expect(result.response.results.delete.allowed).toBe(false);
    });

    it('should short-circuit when principal is blocked', async () => {
      await orchestrator.initialize();

      // Block the principal first
      await orchestrator.triggerEnforcement('temporary_block', 'blocked-user', 'Test block');

      const request = createRequest({
        principal: { id: 'blocked-user', roles: ['user'], attributes: {} },
      });
      const response = createResponse(true);

      const result = await orchestrator.processRequest(request, response);

      // Should return denied response without processing through other agents
      expect(result.enforcement?.allowed).toBe(false);
      expect(result.agentsInvolved).toContain('enforcer');
      // Guardian should not be invoked for blocked users
      expect(result.agentsInvolved).not.toContain('guardian');
    });

    it('should create denied response with enforcer reason', async () => {
      await orchestrator.initialize();

      await orchestrator.triggerEnforcement('rate_limit', 'rate-limited-user', 'Too many requests');

      const request = createRequest({
        principal: { id: 'rate-limited-user', roles: ['user'], attributes: {} },
        actions: ['view', 'edit'],
      });
      const response = createResponse(true);

      const result = await orchestrator.processRequest(request, response);

      expect(result.enforcement?.allowed).toBe(false);
      expect(result.response.results.view.effect).toBe('deny');
      expect(result.response.results.edit.effect).toBe('deny');
      expect(result.response.results.view.meta?.matchedRule).toContain('enforcer');
    });
  });

  describe('pattern discovery extended', () => {
    it('should return empty array when no patterns discovered', async () => {
      await orchestrator.initialize();

      const patterns = orchestrator.getPatterns();

      expect(patterns).toEqual([]);
    });

    it('should trigger discovery without errors on empty dataset', async () => {
      await orchestrator.initialize();

      const patterns = await orchestrator.discoverPatterns();

      expect(Array.isArray(patterns)).toBe(true);
    });
  });

  describe('enforcement action approval workflow', () => {
    it('should approve pending action by ID', async () => {
      await orchestrator.initialize();

      // Create multiple pending actions
      await orchestrator.triggerEnforcement('rate_limit', 'user-1', 'Test 1');
      await orchestrator.triggerEnforcement('rate_limit', 'user-2', 'Test 2');

      const pending = orchestrator.getPendingActions();

      if (pending.length > 0) {
        const approved = await orchestrator.approveAction(pending[0].id, 'admin@test.com');
        expect(approved).toBeDefined();
        if (approved) {
          expect(approved.status).toBe('completed');
        }
      }
    });

    it('should return null when approving non-existent action', async () => {
      await orchestrator.initialize();

      const result = await orchestrator.approveAction('non-existent-id', 'admin@test.com');

      expect(result).toBeNull();
    });

    it('should support different enforcement action types', async () => {
      await orchestrator.initialize();

      const rateLimit = await orchestrator.triggerEnforcement('rate_limit', 'user-1', 'Rate limit test');
      const block = await orchestrator.triggerEnforcement('temporary_block', 'user-2', 'Block test');
      const alert = await orchestrator.triggerEnforcement('alert_admin', 'user-3', 'Alert test');

      expect(rateLimit.type).toBe('rate_limit');
      expect(block.type).toBe('temporary_block');
      expect(alert.type).toBe('alert_admin');
    });
  });

  describe('anomaly retrieval', () => {
    it('should return empty array when no anomalies for principal', async () => {
      await orchestrator.initialize();

      const anomalies = orchestrator.getAnomalies('unknown-user');

      expect(anomalies).toEqual([]);
    });

    it('should return anomalies for specific principal only', async () => {
      await orchestrator.initialize();

      const anomaliesUser1 = orchestrator.getAnomalies('user-123');
      const anomaliesUser2 = orchestrator.getAnomalies('user-456');

      expect(Array.isArray(anomaliesUser1)).toBe(true);
      expect(Array.isArray(anomaliesUser2)).toBe(true);
    });
  });

  describe('shutdown behavior', () => {
    it('should be able to initialize again after shutdown', async () => {
      await orchestrator.initialize();
      await orchestrator.shutdown();

      // Create new orchestrator and initialize
      const newOrchestrator = new AgentOrchestrator(config);
      await newOrchestrator.initialize();

      const health = await newOrchestrator.getHealth();
      expect(health.status).toBe('healthy');

      await newOrchestrator.shutdown();
    });

    it('should not error on double shutdown', async () => {
      await orchestrator.initialize();
      await orchestrator.shutdown();

      // Second shutdown should not throw
      await expect(orchestrator.shutdown()).resolves.not.toThrow();
    });
  });

  describe('idempotent initialization', () => {
    it('should not reinitialize if already initialized', async () => {
      await orchestrator.initialize();
      const health1 = await orchestrator.getHealth();

      await orchestrator.initialize(); // Second call
      const health2 = await orchestrator.getHealth();

      expect(health1.status).toBe('healthy');
      expect(health2.status).toBe('healthy');
    });
  });
});
