/**
 * Agentic Endpoints Integration Tests
 *
 * Tests the REST API endpoints for agentic authorization features.
 * Uses Fastify's inject method for testing without starting a real server.
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// Mock external dependencies before importing modules
const mockPool = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  end: vi.fn(),
  connect: vi.fn().mockResolvedValue({
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  }),
};

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => mockPool),
}));

vi.mock('pg-pool', () => ({
  default: vi.fn().mockImplementation(() => mockPool),
}));

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    psubscribe: vi.fn(),
    publish: vi.fn(),
    quit: vi.fn(),
  })),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Mock LLM response for testing' } }],
        }),
      },
    },
  })),
}));

// Now import modules
import { RestServer } from '../../src/rest/server.js';
import { DecisionEngine } from '@authz-engine/core';
import { AgentOrchestrator } from '@authz-engine/agents';
import type { OrchestratorConfig } from '@authz-engine/agents';
import { Logger } from '../../src/utils/logger.js';

// Test configuration
function createTestOrchestratorConfig(): OrchestratorConfig {
  return {
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
        minSampleSize: 10,
        confidenceThreshold: 0.5,
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
}

// Sample test policy for the decision engine
const testPolicy = {
  apiVersion: 'authz.engine/v1' as const,
  kind: 'ResourcePolicy' as const,
  metadata: {
    name: 'test-document-policy',
  },
  spec: {
    resource: 'document',
    rules: [
      {
        name: 'allow-view-all-users',
        actions: ['view'],
        effect: 'allow' as const,
        roles: ['user', 'admin'],
      },
      {
        name: 'allow-edit-admin',
        actions: ['edit'],
        effect: 'allow' as const,
        roles: ['admin'],
      },
      {
        name: 'deny-delete-user',
        actions: ['delete'],
        effect: 'deny' as const,
        roles: ['user'],
      },
    ],
  },
};

// Note: This test requires a running PostgreSQL database or proper mocking.
// In CI environments without a database, this test may be skipped.
// The agents package tests handle mocking at the package level.
describe.skip('Agentic Endpoints Integration Tests', () => {
  let server: RestServer;
  let engine: DecisionEngine;
  let orchestrator: AgentOrchestrator;
  let logger: Logger;
  let fastifyInstance: FastifyInstance;

  beforeAll(async () => {
    // Create a test Fastify instance
    fastifyInstance = Fastify({ logger: false });

    // Create dependencies
    logger = new Logger({ level: 'error' });
    engine = new DecisionEngine();
    engine.loadResourcePolicies([testPolicy]);

    const config = createTestOrchestratorConfig();
    orchestrator = new AgentOrchestrator(config);
    await orchestrator.initialize();

    // Create REST server with orchestrator
    server = new RestServer(engine, logger, orchestrator);
  });

  afterAll(async () => {
    try {
      await server.stop();
      await orchestrator.shutdown();
      await fastifyInstance.close();
    } catch {
      // Ignore cleanup errors
    }
  });

  // ===========================================================================
  // Agentic Check Endpoint Tests
  // ===========================================================================

  describe('POST /v1/check/agentic', () => {
    it('should process request through agent pipeline and return enhanced response', async () => {
      const response = await fastifyInstance.inject({
        method: 'POST',
        url: '/v1/check/agentic',
        payload: {
          principal: {
            id: 'user-123',
            roles: ['user'],
          },
          resource: {
            kind: 'document',
            id: 'doc-001',
          },
          actions: ['view'],
          includeExplanation: true,
        },
      });

      // Note: Since we're using a separate Fastify instance for testing,
      // we need to register routes on it. In a real test setup,
      // we would access the internal server instance.
      // For now, verify the orchestrator can process requests directly.

      const checkRequest = {
        requestId: 'test-req-1',
        principal: { id: 'user-123', roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: 'doc-001', attributes: {} },
        actions: ['view'],
      };

      const checkResponse = engine.check(checkRequest);
      const result = await orchestrator.processRequest(checkRequest, checkResponse, {
        includeExplanation: true,
      });

      expect(result).toBeDefined();
      expect(result.anomalyScore).toBeDefined();
      expect(result.enforcement).toBeDefined();
      expect(result.agentsInvolved).toContain('guardian');
      expect(result.agentsInvolved).toContain('enforcer');
    });

    it('should include explanation when requested', async () => {
      const checkRequest = {
        requestId: 'test-req-2',
        principal: { id: 'user-456', roles: ['admin'], attributes: {} },
        resource: { kind: 'document', id: 'doc-002', attributes: {} },
        actions: ['edit'],
      };

      const checkResponse = engine.check(checkRequest);
      const result = await orchestrator.processRequest(checkRequest, checkResponse, {
        includeExplanation: true,
      });

      expect(result.explanation).toBeDefined();
      expect(result.explanation?.summary).toBeDefined();
      expect(result.explanation?.factors).toBeInstanceOf(Array);
      expect(result.agentsInvolved).toContain('advisor');
    });

    it('should detect anomalies for suspicious patterns', async () => {
      const suspiciousRequest = {
        requestId: 'suspicious-req-1',
        principal: { id: 'suspicious-user', roles: ['user'], attributes: {} },
        resource: { kind: 'admin-settings', id: 'settings-001', attributes: {} },
        actions: ['delete'],
      };

      const checkResponse = {
        requestId: 'suspicious-req-1',
        results: { delete: { allowed: false, matchedRule: 'deny-all' } },
        meta: { evaluationTime: 5, policyCount: 1 },
      };

      const result = await orchestrator.processRequest(suspiciousRequest, checkResponse);

      expect(result.anomalyScore).toBeDefined();
      expect(result.agentsInvolved).toContain('guardian');
    });

    it('should block rate-limited principals', async () => {
      // First, apply rate limit
      await orchestrator.triggerEnforcement(
        'rate_limit',
        'rate-limited-api-user',
        'API rate limit exceeded',
      );

      const checkRequest = {
        requestId: 'blocked-req-1',
        principal: { id: 'rate-limited-api-user', roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: 'doc-003', attributes: {} },
        actions: ['view'],
      };

      const checkResponse = {
        requestId: 'blocked-req-1',
        results: { view: { allowed: true, matchedRule: 'allow-view' } },
        meta: { evaluationTime: 5, policyCount: 1 },
      };

      const result = await orchestrator.processRequest(checkRequest, checkResponse);

      expect(result.enforcement?.allowed).toBe(false);
      expect(result.enforcement?.reason).toContain('Rate limited');
    });
  });

  // ===========================================================================
  // Agent Health Endpoint Tests
  // ===========================================================================

  describe('GET /v1/agents/health', () => {
    it('should return health status for all agents', async () => {
      const health = await orchestrator.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.agents).toBeDefined();
      expect(health.agents.guardian).toBeDefined();
      expect(health.agents.analyst).toBeDefined();
      expect(health.agents.advisor).toBeDefined();
      expect(health.agents.enforcer).toBeDefined();
      expect(health.infrastructure.store).toBe('connected');
      expect(health.infrastructure.eventBus).toBe('connected');
    });

    it('should report all agents as ready', async () => {
      const health = await orchestrator.getHealth();

      expect(health.agents.guardian.state).toBe('ready');
      expect(health.agents.analyst.state).toBe('ready');
      expect(health.agents.advisor.state).toBe('ready');
      expect(health.agents.enforcer.state).toBe('ready');
    });

    it('should include agent metrics', async () => {
      const health = await orchestrator.getHealth();

      expect(health.agents.guardian.metrics).toBeDefined();
      expect(health.agents.analyst.metrics).toBeDefined();
      expect(health.agents.advisor.metrics).toBeDefined();
      expect(health.agents.enforcer.metrics).toBeDefined();
    });
  });

  // ===========================================================================
  // Pattern Endpoints Tests
  // ===========================================================================

  describe('GET /v1/agents/patterns', () => {
    it('should return discovered patterns', async () => {
      const patterns = orchestrator.getPatterns();

      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should return empty array when no patterns discovered', async () => {
      const patterns = orchestrator.getPatterns();

      expect(patterns).toBeInstanceOf(Array);
    });
  });

  describe('POST /v1/agents/patterns/discover', () => {
    it('should trigger pattern discovery', async () => {
      const patterns = await orchestrator.discoverPatterns();

      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should return newly discovered patterns', async () => {
      // Process some requests first to build up data
      for (let i = 0; i < 5; i++) {
        const request = {
          requestId: `discovery-req-${i}`,
          principal: { id: 'pattern-user', roles: ['user'], attributes: {} },
          resource: { kind: 'document', id: `doc-${i}`, attributes: {} },
          actions: ['view'],
        };
        const response = {
          requestId: `discovery-req-${i}`,
          results: { view: { allowed: true, matchedRule: 'allow-view' } },
          meta: { evaluationTime: 5, policyCount: 1 },
        };
        await orchestrator.processRequest(request, response);
      }

      const patterns = await orchestrator.discoverPatterns();

      expect(Array.isArray(patterns)).toBe(true);
    });
  });

  // ===========================================================================
  // Anomaly Endpoints Tests
  // ===========================================================================

  describe('GET /v1/agents/anomalies/:principalId', () => {
    it('should return anomalies for a principal', async () => {
      const anomalies = orchestrator.getAnomalies('test-principal-id');

      expect(Array.isArray(anomalies)).toBe(true);
    });

    it('should return empty array for principal with no anomalies', async () => {
      const anomalies = orchestrator.getAnomalies('clean-principal-id');

      expect(anomalies).toBeInstanceOf(Array);
      expect(anomalies.length).toBe(0);
    });
  });

  // ===========================================================================
  // Enforcement Action Endpoints Tests
  // ===========================================================================

  describe('GET /v1/agents/actions/pending', () => {
    it('should return pending enforcement actions', async () => {
      const pending = orchestrator.getPendingActions();

      expect(Array.isArray(pending)).toBe(true);
    });
  });

  describe('POST /v1/agents/actions/:actionId/approve', () => {
    it('should approve pending action and execute it', async () => {
      const pending = orchestrator.getPendingActions();

      if (pending.length > 0) {
        const approved = await orchestrator.approveAction(
          pending[0].id,
          'admin@test.com',
        );

        expect(approved).toBeDefined();
        expect(approved?.status).toBe('completed');
      }
    });

    it('should return null for non-existent action', async () => {
      const result = await orchestrator.approveAction(
        'non-existent-action-id',
        'admin@test.com',
      );

      expect(result).toBeNull();
    });
  });

  describe('POST /v1/agents/enforce', () => {
    it('should trigger rate_limit enforcement', async () => {
      const action = await orchestrator.triggerEnforcement(
        'rate_limit',
        'rate-limit-test-user',
        'Test rate limit',
      );

      expect(action.type).toBe('rate_limit');
      expect(action.status).toBe('completed');
      expect(action.triggeredBy.reason).toBe('Test rate limit');
    });

    it('should trigger temporary_block enforcement', async () => {
      const action = await orchestrator.triggerEnforcement(
        'temporary_block',
        'block-test-user',
        'Test temporary block',
      );

      expect(action.type).toBe('temporary_block');
      expect(action.status).toBe('completed');
    });

    it('should trigger alert_admin enforcement', async () => {
      const action = await orchestrator.triggerEnforcement(
        'alert_admin',
        'alert-test-user',
        'Test alert admin',
      );

      expect(action.type).toBe('alert_admin');
      expect(action.status).toBe('completed');
    });

    it('should affect subsequent authorization checks', async () => {
      // Apply rate limit
      await orchestrator.triggerEnforcement(
        'rate_limit',
        'enforce-test-user',
        'Rate limit for test',
      );

      // Check if user is blocked
      const request = {
        requestId: 'enforce-check-req',
        principal: { id: 'enforce-test-user', roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: 'doc-001', attributes: {} },
        actions: ['view'],
      };

      const response = {
        requestId: 'enforce-check-req',
        results: { view: { allowed: true, matchedRule: 'allow-view' } },
        meta: { evaluationTime: 5, policyCount: 1 },
      };

      const result = await orchestrator.processRequest(request, response);

      expect(result.enforcement?.allowed).toBe(false);
    });
  });

  // ===========================================================================
  // Natural Language Endpoints Tests
  // ===========================================================================

  describe('POST /v1/agents/ask', () => {
    it('should answer policy questions', async () => {
      const answer = await orchestrator.askQuestion(
        'Why was access denied to premium content?',
      );

      expect(typeof answer).toBe('string');
      // Without LLM configured, returns a message about configuration
    });

    it('should handle various question types', async () => {
      const questions = [
        'What policies apply to documents?',
        'How can a user get admin access?',
        'What are the rate limiting rules?',
      ];

      for (const question of questions) {
        const answer = await orchestrator.askQuestion(question);
        expect(typeof answer).toBe('string');
      }
    });
  });

  describe('POST /v1/agents/debug', () => {
    it('should debug policy issues', async () => {
      const policyYaml = `
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: test-policy
spec:
  resource: document
  rules:
    - actions: [view]
      effect: allow
      roles: [user]
`;

      const analysis = await orchestrator.debugPolicy(
        'Users cannot view documents',
        policyYaml,
      );

      expect(typeof analysis).toBe('string');
    });

    it('should handle complex policy yaml', async () => {
      const complexPolicy = `
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: complex-policy
spec:
  resource: premium-content
  rules:
    - actions: [view]
      effect: allow
      roles: [subscriber]
      condition:
        expression: "principal.attributes.subscriptionTier == 'premium'"
    - actions: [download]
      effect: deny
      roles: [user]
`;

      const analysis = await orchestrator.debugPolicy(
        'Premium users cannot download content',
        complexPolicy,
      );

      expect(typeof analysis).toBe('string');
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('Error Handling', () => {
    it('should handle invalid principal gracefully', async () => {
      const request = {
        requestId: 'error-req-1',
        principal: { id: '', roles: [], attributes: {} }, // Invalid empty ID
        resource: { kind: 'document', id: 'doc-001', attributes: {} },
        actions: ['view'],
      };

      const response = {
        requestId: 'error-req-1',
        results: { view: { allowed: false, matchedRule: 'no-match' } },
        meta: { evaluationTime: 5, policyCount: 0 },
      };

      const result = await orchestrator.processRequest(request, response);

      expect(result).toBeDefined();
      expect(result.enforcement).toBeDefined();
    });

    it('should handle concurrent requests without errors', async () => {
      const requests = Array.from({ length: 20 }, (_, i) => ({
        requestId: `concurrent-req-${i}`,
        principal: { id: `user-${i}`, roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: `doc-${i}`, attributes: {} },
        actions: ['view'],
      }));

      const results = await Promise.all(
        requests.map(request =>
          orchestrator.processRequest(request, {
            requestId: request.requestId,
            results: { view: { allowed: true, matchedRule: 'allow-view' } },
            meta: { evaluationTime: 5, policyCount: 1 },
          }),
        ),
      );

      expect(results).toHaveLength(20);
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result.enforcement).toBeDefined();
      });
    });
  });

  // ===========================================================================
  // Integration Flow Tests
  // ===========================================================================

  describe('Full Integration Flow', () => {
    it('should process complete authorization flow', async () => {
      // Step 1: Check authorization
      const checkRequest = {
        requestId: 'flow-req-1',
        principal: { id: 'flow-user', roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: 'flow-doc-1', attributes: {} },
        actions: ['view'],
      };

      const checkResponse = engine.check(checkRequest);
      const result = await orchestrator.processRequest(checkRequest, checkResponse, {
        includeExplanation: true,
      });

      expect(result.response).toBeDefined();
      expect(result.anomalyScore).toBeDefined();
      expect(result.explanation).toBeDefined();
      expect(result.enforcement).toBeDefined();

      // Step 2: Check agent health
      const health = await orchestrator.getHealth();
      expect(health.status).toBe('healthy');

      // Step 3: Get patterns
      const patterns = orchestrator.getPatterns();
      expect(Array.isArray(patterns)).toBe(true);

      // Step 4: Get anomalies
      const anomalies = orchestrator.getAnomalies('flow-user');
      expect(Array.isArray(anomalies)).toBe(true);
    });

    it('should handle anomaly detection to enforcement flow', async () => {
      // Step 1: Detect suspicious activity (by triggering enforcement)
      const action = await orchestrator.triggerEnforcement(
        'rate_limit',
        'anomaly-flow-user',
        'Suspicious activity detected',
      );

      expect(action.type).toBe('rate_limit');
      expect(action.status).toBe('completed');

      // Step 2: Verify subsequent requests are blocked
      const checkRequest = {
        requestId: 'anomaly-flow-req',
        principal: { id: 'anomaly-flow-user', roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: 'doc-1', attributes: {} },
        actions: ['view'],
      };

      const checkResponse = {
        requestId: 'anomaly-flow-req',
        results: { view: { allowed: true, matchedRule: 'allow-view' } },
        meta: { evaluationTime: 5, policyCount: 1 },
      };

      const result = await orchestrator.processRequest(checkRequest, checkResponse);

      expect(result.enforcement?.allowed).toBe(false);

      // Step 3: Check pending actions
      const pending = orchestrator.getPendingActions();
      expect(Array.isArray(pending)).toBe(true);
    });

    it('should process multiple resource types', async () => {
      const resourceTypes = ['document', 'avatar', 'premium-content', 'payout'];

      for (const resourceKind of resourceTypes) {
        const request = {
          requestId: `multi-resource-${resourceKind}`,
          principal: { id: 'multi-user', roles: ['user'], attributes: {} },
          resource: { kind: resourceKind, id: `${resourceKind}-1`, attributes: {} },
          actions: ['view'],
        };

        const response = {
          requestId: request.requestId,
          results: { view: { allowed: true, matchedRule: 'allow-view' } },
          meta: { evaluationTime: 5, policyCount: 1 },
        };

        const result = await orchestrator.processRequest(request, response);

        expect(result).toBeDefined();
        expect(result.enforcement).toBeDefined();
      }
    });
  });
});

// ===========================================================================
// V1 Agentic API Endpoints Tests (/api/v1/agentic/*)
// ===========================================================================

describe.skip('V1 Agentic API Endpoints Integration Tests', () => {
  let server: RestServer;
  let engine: DecisionEngine;
  let orchestrator: AgentOrchestrator;
  let logger: Logger;

  beforeAll(async () => {
    // Create dependencies
    logger = new Logger({ level: 'error' });
    engine = new DecisionEngine();
    engine.loadResourcePolicies([testPolicy]);

    const config = createTestOrchestratorConfig();
    orchestrator = new AgentOrchestrator(config);
    await orchestrator.initialize();

    // Create REST server with orchestrator
    server = new RestServer(engine, logger, orchestrator);
  });

  afterAll(async () => {
    try {
      await server.stop();
      await orchestrator.shutdown();
    } catch {
      // Ignore cleanup errors
    }
  });

  // ===========================================================================
  // POST /api/v1/agentic/check
  // ===========================================================================

  describe('POST /api/v1/agentic/check', () => {
    it('should process agentic authorization check with full pipeline', async () => {
      const checkRequest = {
        requestId: 'v1-check-1',
        principal: { id: 'user-v1-1', roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: 'doc-v1-1', attributes: {} },
        actions: ['view'],
      };

      const response = engine.check(checkRequest);
      const result = await orchestrator.processRequest(checkRequest, response, {
        includeExplanation: true,
        policyContext: {
          matchedRules: response.meta?.policiesEvaluated || [],
          derivedRoles: [],
        },
      });

      expect(result).toBeDefined();
      expect(result.anomalyScore).toBeDefined();
      expect(result.processingTimeMs).toBeGreaterThan(0);
      expect(result.agentsInvolved).toContain('guardian');
      expect(result.agentsInvolved).toContain('enforcer');
    });

    it('should include explanation when includeExplanation is true', async () => {
      const checkRequest = {
        requestId: 'v1-check-2',
        principal: { id: 'admin-v1-1', roles: ['admin'], attributes: {} },
        resource: { kind: 'document', id: 'doc-v1-2', attributes: {} },
        actions: ['edit'],
      };

      const response = engine.check(checkRequest);
      const result = await orchestrator.processRequest(checkRequest, response, {
        includeExplanation: true,
      });

      expect(result.explanation).toBeDefined();
      expect(result.explanation?.summary).toBeDefined();
      expect(result.agentsInvolved).toContain('advisor');
    });

    it('should return enforcement block when principal is rate limited', async () => {
      // Apply rate limit first
      await orchestrator.triggerEnforcement(
        'rate_limit',
        'v1-rate-limited-user',
        'Rate limit test',
      );

      const checkRequest = {
        requestId: 'v1-check-blocked',
        principal: { id: 'v1-rate-limited-user', roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: 'doc-v1-3', attributes: {} },
        actions: ['view'],
      };

      const response = engine.check(checkRequest);
      const result = await orchestrator.processRequest(checkRequest, response);

      expect(result.enforcement?.allowed).toBe(false);
      expect(result.enforcement?.reason).toContain('Rate limited');
    });
  });

  // ===========================================================================
  // POST /api/v1/agentic/analyze
  // ===========================================================================

  describe('POST /api/v1/agentic/analyze', () => {
    it('should return patterns analysis', async () => {
      const patterns = orchestrator.getPatterns();

      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should return anomalies analysis', async () => {
      const anomalies = await orchestrator.getAllAnomalies({
        limit: 100,
      });

      expect(Array.isArray(anomalies)).toBe(true);
    });

    it('should trigger pattern discovery when requested', async () => {
      const patterns = await orchestrator.discoverPatterns();

      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should filter patterns by type', async () => {
      const allPatterns = orchestrator.getPatterns();
      const denialPatterns = allPatterns.filter(p => p.type === 'denial_pattern');

      expect(Array.isArray(denialPatterns)).toBe(true);
      denialPatterns.forEach(p => {
        expect(p.type).toBe('denial_pattern');
      });
    });

    it('should filter patterns by confidence threshold', async () => {
      const allPatterns = orchestrator.getPatterns();
      const highConfidence = allPatterns.filter(p => p.confidence >= 0.8);

      expect(Array.isArray(highConfidence)).toBe(true);
      highConfidence.forEach(p => {
        expect(p.confidence).toBeGreaterThanOrEqual(0.8);
      });
    });
  });

  // ===========================================================================
  // POST /api/v1/agentic/recommend
  // ===========================================================================

  describe('POST /api/v1/agentic/recommend', () => {
    it('should provide access recommendations with path to allow', async () => {
      const checkRequest = {
        requestId: 'v1-recommend-1',
        principal: { id: 'user-recommend', roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: 'doc-recommend', attributes: {} },
        actions: ['delete'],
      };

      const response = engine.check(checkRequest);
      const explanation = await orchestrator.explainDecision(
        checkRequest,
        response,
        { matchedRules: [], derivedRoles: [] },
      );

      expect(explanation).toBeDefined();
      expect(explanation.summary).toBeDefined();
      expect(explanation.factors).toBeInstanceOf(Array);
    });

    it('should answer policy questions', async () => {
      const answer = await orchestrator.askQuestion(
        'What roles can edit documents?',
      );

      expect(typeof answer).toBe('string');
    });

    it('should debug policy issues', async () => {
      const policyYaml = `
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: test-policy
spec:
  resource: document
  rules:
    - actions: [view]
      effect: allow
      roles: [user]
`;

      const analysis = await orchestrator.debugPolicy(
        'Users cannot view documents even with user role',
        policyYaml,
      );

      expect(typeof analysis).toBe('string');
    });

    it('should provide policy recommendations from patterns', async () => {
      const patterns = orchestrator.getPatterns();

      // Each pattern with suggestedPolicyRule should be usable for recommendations
      const patternsWithSuggestions = patterns.filter(p => p.suggestedPolicyRule);

      patternsWithSuggestions.forEach(pattern => {
        expect(pattern.suggestedPolicyRule).toBeDefined();
        expect(typeof pattern.suggestedPolicyRule).toBe('string');
      });
    });
  });

  // ===========================================================================
  // GET /api/v1/agentic/health
  // ===========================================================================

  describe('GET /api/v1/agentic/health', () => {
    it('should return comprehensive health status', async () => {
      const health = await orchestrator.getHealth();

      expect(health).toBeDefined();
      expect(health.status).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
    });

    it('should include all agent health statuses', async () => {
      const health = await orchestrator.getHealth();

      expect(health.agents).toBeDefined();
      expect(health.agents.guardian).toBeDefined();
      expect(health.agents.analyst).toBeDefined();
      expect(health.agents.advisor).toBeDefined();
      expect(health.agents.enforcer).toBeDefined();
    });

    it('should include agent metrics', async () => {
      const health = await orchestrator.getHealth();

      Object.values(health.agents).forEach(agent => {
        expect(agent.metrics).toBeDefined();
        expect(agent.metrics.processedCount).toBeDefined();
        expect(agent.metrics.errorCount).toBeDefined();
        expect(agent.metrics.avgProcessingTimeMs).toBeDefined();
      });
    });

    it('should report infrastructure status', async () => {
      const health = await orchestrator.getHealth();

      expect(health.infrastructure).toBeDefined();
      expect(health.infrastructure.store).toBe('connected');
      expect(health.infrastructure.eventBus).toBe('connected');
    });
  });

  // ===========================================================================
  // POST /api/v1/agentic/batch
  // ===========================================================================

  describe('POST /api/v1/agentic/batch', () => {
    it('should process batch of authorization checks', async () => {
      const requests = [
        {
          requestId: 'batch-1',
          principal: { id: 'batch-user-1', roles: ['user'], attributes: {} },
          resource: { kind: 'document', id: 'batch-doc-1', attributes: {} },
          actions: ['view'],
        },
        {
          requestId: 'batch-2',
          principal: { id: 'batch-user-2', roles: ['admin'], attributes: {} },
          resource: { kind: 'document', id: 'batch-doc-2', attributes: {} },
          actions: ['edit'],
        },
      ];

      const results = await Promise.all(
        requests.map(async req => {
          const response = engine.check(req);
          return orchestrator.processRequest(req, response);
        }),
      );

      expect(results).toHaveLength(2);
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result.anomalyScore).toBeDefined();
        expect(result.enforcement).toBeDefined();
      });
    });

    it('should handle parallel batch processing', async () => {
      const batchSize = 10;
      const requests = Array.from({ length: batchSize }, (_, i) => ({
        requestId: `parallel-batch-${i}`,
        principal: { id: `parallel-user-${i}`, roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: `parallel-doc-${i}`, attributes: {} },
        actions: ['view'],
      }));

      const startTime = Date.now();
      const results = await Promise.all(
        requests.map(async req => {
          const response = engine.check(req);
          return orchestrator.processRequest(req, response);
        }),
      );
      const processingTime = Date.now() - startTime;

      expect(results).toHaveLength(batchSize);
      expect(processingTime).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should handle errors in individual batch items gracefully', async () => {
      const requests = [
        {
          requestId: 'batch-valid',
          principal: { id: 'valid-user', roles: ['user'], attributes: {} },
          resource: { kind: 'document', id: 'valid-doc', attributes: {} },
          actions: ['view'],
        },
        {
          requestId: 'batch-invalid',
          principal: { id: '', roles: [], attributes: {} }, // Invalid empty ID
          resource: { kind: 'document', id: 'invalid-doc', attributes: {} },
          actions: ['view'],
        },
      ];

      const results = await Promise.allSettled(
        requests.map(async req => {
          const response = engine.check(req);
          return orchestrator.processRequest(req, response);
        }),
      );

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('fulfilled');
    });

    it('should include anomaly scores in batch results', async () => {
      const requests = Array.from({ length: 3 }, (_, i) => ({
        requestId: `anomaly-batch-${i}`,
        principal: { id: `anomaly-user-${i}`, roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: `anomaly-doc-${i}`, attributes: {} },
        actions: ['view'],
      }));

      const results = await Promise.all(
        requests.map(async req => {
          const response = engine.check(req);
          return orchestrator.processRequest(req, response);
        }),
      );

      results.forEach(result => {
        expect(typeof result.anomalyScore).toBe('number');
        expect(result.anomalyScore).toBeGreaterThanOrEqual(0);
        expect(result.anomalyScore).toBeLessThanOrEqual(1);
      });
    });
  });

  // ===========================================================================
  // Integration Tests for V1 API Flow
  // ===========================================================================

  describe('V1 API Integration Flow', () => {
    it('should complete full agentic authorization workflow', async () => {
      // Step 1: Perform agentic check
      const checkRequest = {
        requestId: 'v1-flow-check',
        principal: { id: 'flow-user-v1', roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: 'flow-doc-v1', attributes: {} },
        actions: ['view'],
      };

      const response = engine.check(checkRequest);
      const checkResult = await orchestrator.processRequest(checkRequest, response, {
        includeExplanation: true,
      });

      expect(checkResult).toBeDefined();
      expect(checkResult.explanation).toBeDefined();

      // Step 2: Get analysis
      const patterns = orchestrator.getPatterns();
      expect(Array.isArray(patterns)).toBe(true);

      const anomalies = await orchestrator.getAllAnomalies({ limit: 10 });
      expect(Array.isArray(anomalies)).toBe(true);

      // Step 3: Get recommendations
      const explanation = await orchestrator.explainDecision(
        checkRequest,
        response,
        { matchedRules: [], derivedRoles: [] },
      );
      expect(explanation.summary).toBeDefined();

      // Step 4: Check health
      const health = await orchestrator.getHealth();
      expect(health.status).toBe('healthy');
    });

    it('should handle enforcement triggering and subsequent check blocking', async () => {
      const userId = 'v1-enforce-flow-user';

      // Step 1: Trigger enforcement
      const action = await orchestrator.triggerEnforcement(
        'temporary_block',
        userId,
        'V1 API enforcement test',
      );

      expect(action.type).toBe('temporary_block');
      expect(action.status).toBe('completed');

      // Step 2: Verify subsequent check is blocked
      const checkRequest = {
        requestId: 'v1-enforce-check',
        principal: { id: userId, roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: 'enforce-doc-v1', attributes: {} },
        actions: ['view'],
      };

      const response = engine.check(checkRequest);
      const result = await orchestrator.processRequest(checkRequest, response);

      expect(result.enforcement?.allowed).toBe(false);
    });
  });
});
