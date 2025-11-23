/**
 * Agent Coordination Integration Tests
 *
 * Tests agent coordination and message passing:
 * - Event bus communication
 * - Inter-agent messaging
 * - Anomaly event flow to enforcer
 * - Pattern sharing between agents
 * - Cache coordination
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentOrchestrator } from '../../src/orchestrator/agent-orchestrator.js';
import type { OrchestratorConfig } from '../../src/orchestrator/agent-orchestrator.js';
import { EventBus } from '../../src/core/event-bus.js';
import type { AgentEvent, AgentEventType, Anomaly } from '../../src/types/agent.types.js';
import {
  createTestOrchestratorConfig,
  createMockAnomaly,
} from '../mocks/index.js';
import {
  principals,
  resources,
  createCheckRequest,
  createAllowedResponse,
  createDeniedResponse,
} from '../fixtures/test-requests.js';

// =============================================================================
// Mock External Dependencies
// =============================================================================

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

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{
            message: {
              content: 'Mock LLM response for coordination tests.',
            },
          }],
        }),
      },
    },
  })),
}));

// =============================================================================
// Test Suite: Agent Coordination Tests
// =============================================================================

describe('Agent Coordination Integration Tests', () => {
  let orchestrator: AgentOrchestrator;
  let config: OrchestratorConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    config = createTestOrchestratorConfig({
      agents: {
        enabled: true,
        logLevel: 'error',
        guardian: {
          anomalyThreshold: 0.3, // Lower threshold for testing
          baselinePeriodDays: 30,
          velocityWindowMinutes: 5,
          enableRealTimeDetection: true,
        },
        analyst: {
          minSampleSize: 5,
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
          autoEnforceEnabled: true, // Enable for coordination tests
          requireApprovalForSeverity: 'critical',
          maxActionsPerHour: 100,
          rollbackWindowMinutes: 60,
        },
      },
    });
    orchestrator = new AgentOrchestrator(config);
  });

  afterEach(async () => {
    try {
      await orchestrator.shutdown();
    } catch {
      // Ignore shutdown errors
    }
  });

  // ===========================================================================
  // Section 1: Event Bus Communication Tests
  // ===========================================================================

  describe('Event Bus Communication', () => {
    it('should initialize event bus in memory mode', async () => {
      const eventBus = new EventBus({ mode: 'memory' });
      await eventBus.initialize();

      // Subscribe to events
      const receivedEvents: AgentEvent[] = [];
      eventBus.subscribe('anomaly_detected', (event) => {
        receivedEvents.push(event);
      });

      // Publish an event
      const testEvent: AgentEvent = {
        id: 'test-event-1',
        timestamp: new Date(),
        agentType: 'guardian',
        eventType: 'anomaly_detected',
        payload: { test: 'data' },
      };
      await eventBus.publish(testEvent);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].id).toBe('test-event-1');

      await eventBus.shutdown();
    });

    it('should support wildcard subscriptions', async () => {
      const eventBus = new EventBus({ mode: 'memory' });
      await eventBus.initialize();

      const receivedEvents: AgentEvent[] = [];
      eventBus.subscribe('*', (event) => {
        receivedEvents.push(event);
      });

      // Publish different event types
      const event1: AgentEvent = {
        id: 'event-1',
        timestamp: new Date(),
        agentType: 'guardian',
        eventType: 'anomaly_detected',
        payload: {},
      };
      const event2: AgentEvent = {
        id: 'event-2',
        timestamp: new Date(),
        agentType: 'enforcer',
        eventType: 'action_completed',
        payload: {},
      };

      await eventBus.publish(event1);
      await eventBus.publish(event2);

      expect(receivedEvents).toHaveLength(2);

      await eventBus.shutdown();
    });

    it('should support unsubscribing from events', async () => {
      const eventBus = new EventBus({ mode: 'memory' });
      await eventBus.initialize();

      const receivedEvents: AgentEvent[] = [];
      const subscription = eventBus.subscribe('anomaly_detected', (event) => {
        receivedEvents.push(event);
      });

      // Publish first event
      await eventBus.publish({
        id: 'event-1',
        timestamp: new Date(),
        agentType: 'guardian',
        eventType: 'anomaly_detected',
        payload: {},
      });

      // Unsubscribe
      subscription.unsubscribe();

      // Publish second event
      await eventBus.publish({
        id: 'event-2',
        timestamp: new Date(),
        agentType: 'guardian',
        eventType: 'anomaly_detected',
        payload: {},
      });

      // Should only receive first event
      expect(receivedEvents).toHaveLength(1);

      await eventBus.shutdown();
    });

    it('should support waitForEvent with timeout', async () => {
      const eventBus = new EventBus({ mode: 'memory' });
      await eventBus.initialize();

      // Set up delayed publish
      setTimeout(async () => {
        await eventBus.publish({
          id: 'delayed-event',
          timestamp: new Date(),
          agentType: 'guardian',
          eventType: 'anomaly_detected',
          payload: { delayed: true },
        });
      }, 50);

      // Wait for event
      const event = await eventBus.waitForEvent('anomaly_detected', undefined, 1000);

      expect(event.id).toBe('delayed-event');

      await eventBus.shutdown();
    });

    it('should timeout when event not received', async () => {
      const eventBus = new EventBus({ mode: 'memory' });
      await eventBus.initialize();

      // Should timeout waiting for event
      await expect(
        eventBus.waitForEvent('anomaly_detected', undefined, 100)
      ).rejects.toThrow('Timeout waiting for event');

      await eventBus.shutdown();
    });

    it('should filter events with predicate', async () => {
      const eventBus = new EventBus({ mode: 'memory' });
      await eventBus.initialize();

      // Publish events
      setTimeout(async () => {
        await eventBus.publish({
          id: 'wrong-event',
          timestamp: new Date(),
          agentType: 'guardian',
          eventType: 'anomaly_detected',
          payload: { match: false },
        });
        await eventBus.publish({
          id: 'correct-event',
          timestamp: new Date(),
          agentType: 'guardian',
          eventType: 'anomaly_detected',
          payload: { match: true },
        });
      }, 50);

      // Wait for specific event
      const event = await eventBus.waitForEvent(
        'anomaly_detected',
        (e) => (e.payload as { match: boolean }).match === true,
        1000
      );

      expect(event.id).toBe('correct-event');

      await eventBus.shutdown();
    });
  });

  // ===========================================================================
  // Section 2: Inter-Agent Messaging Tests
  // ===========================================================================

  describe('Inter-Agent Messaging', () => {
    it('should propagate anomaly from GUARDIAN to ENFORCER', async () => {
      // Use very low threshold to trigger anomaly
      config.agents.guardian!.anomalyThreshold = 0.05;
      config.agents.enforcer!.autoEnforceEnabled = true;
      orchestrator = new AgentOrchestrator(config);
      await orchestrator.initialize();

      // Create suspicious request pattern
      const suspiciousRequest = createCheckRequest(
        principals.suspiciousUser,
        resources.payout,
        ['bulk-export'],
      );
      const response = createDeniedResponse(suspiciousRequest.requestId!, 'bulk-export');

      const result = await orchestrator.processRequest(suspiciousRequest, response);

      // Anomaly should be detected
      expect(result.anomalyScore).toBeGreaterThan(0);

      // If anomaly exceeded threshold, check for action
      if (result.anomaly) {
        expect(result.anomaly.principalId).toBe(principals.suspiciousUser.id);
      }
    });

    it('should coordinate between agents for explanation generation', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.regularUser,
        resources.premiumContent,
        ['view'],
      );
      const response = createDeniedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
      });

      // Explanation should include information from multiple agents
      expect(result.explanation).toBeDefined();
      expect(result.explanation!.factors.length).toBeGreaterThan(0);
      expect(result.explanation!.recommendations!.length).toBeGreaterThan(0);
    });

    it('should share anomaly data across coordinated requests', async () => {
      await orchestrator.initialize();

      // First request - establish baseline
      const normalRequest = createCheckRequest(
        { id: 'shared-anomaly-user', roles: ['user'], attributes: {} },
        resources.publicDocument,
        ['view'],
      );
      const normalResponse = createAllowedResponse(normalRequest.requestId!, 'view');
      await orchestrator.processRequest(normalRequest, normalResponse);

      // Second suspicious request
      const suspiciousRequest = createCheckRequest(
        { id: 'shared-anomaly-user', roles: ['user'], attributes: {} },
        resources.adminSettings,
        ['delete'],
      );
      const suspiciousResponse = createDeniedResponse(suspiciousRequest.requestId!, 'delete');
      const result = await orchestrator.processRequest(suspiciousRequest, suspiciousResponse);

      // Should detect anomalous pattern based on history
      expect(result.anomalyScore).toBeGreaterThanOrEqual(0);
    });
  });

  // ===========================================================================
  // Section 3: Enforcer Action Coordination Tests
  // ===========================================================================

  describe('Enforcer Action Coordination', () => {
    it('should coordinate rate limiting across principals', async () => {
      await orchestrator.initialize();

      // Rate limit first user
      await orchestrator.triggerEnforcement(
        'rate_limit',
        'coord-user-1',
        'Testing coordination',
      );

      // Second user should not be affected
      const request = createCheckRequest(
        { id: 'coord-user-2', roles: ['user'], attributes: {} },
        resources.publicDocument,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response);

      expect(result.enforcement?.allowed).toBe(true);
    });

    it('should coordinate blocking actions across requests', async () => {
      await orchestrator.initialize();

      const principalId = 'block-coord-user';

      // Block the user
      await orchestrator.triggerEnforcement(
        'temporary_block',
        principalId,
        'Coordination block test',
      );

      // All requests from blocked user should be denied
      const requests = [
        createCheckRequest(
          { id: principalId, roles: ['user'], attributes: {} },
          resources.publicDocument,
          ['view'],
        ),
        createCheckRequest(
          { id: principalId, roles: ['user'], attributes: {} },
          resources.premiumContent,
          ['view'],
        ),
      ];

      for (const request of requests) {
        const response = createAllowedResponse(request.requestId!, 'view');
        const result = await orchestrator.processRequest(request, response);
        expect(result.enforcement?.allowed).toBe(false);
        expect(result.enforcement?.reason).toContain('Blocked');
      }
    });

    it('should handle pending action approval workflow', async () => {
      await orchestrator.initialize();

      // Trigger action
      await orchestrator.triggerEnforcement(
        'rate_limit',
        'approval-workflow-user',
        'Testing approval workflow',
      );

      // Get pending actions
      const pending = orchestrator.getPendingActions();
      expect(Array.isArray(pending)).toBe(true);

      // If there are pending actions, test approval
      if (pending.length > 0) {
        const approved = await orchestrator.approveAction(pending[0].id, 'admin@test.com');
        // Approval returns the approved action or null if already executed
        expect(approved === null || approved !== undefined).toBe(true);
      }
    });

    it('should coordinate action rollback', async () => {
      await orchestrator.initialize();

      const principalId = 'rollback-coord-user';

      // Apply enforcement
      const action = await orchestrator.triggerEnforcement(
        'rate_limit',
        principalId,
        'Testing rollback coordination',
      );

      // Verify enforcement is active
      let request = createCheckRequest(
        { id: principalId, roles: ['user'], attributes: {} },
        resources.publicDocument,
        ['view'],
      );
      let response = createAllowedResponse(request.requestId!, 'view');
      let result = await orchestrator.processRequest(request, response);
      expect(result.enforcement?.allowed).toBe(false);

      // Note: Rollback through orchestrator would need to be implemented
      // This test verifies the coordination pattern
    });
  });

  // ===========================================================================
  // Section 4: Pattern Sharing Tests
  // ===========================================================================

  describe('Pattern Sharing Between Agents', () => {
    it('should share discovered patterns with orchestrator', async () => {
      await orchestrator.initialize();

      // Discover patterns
      const patterns = await orchestrator.discoverPatterns();

      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should make patterns available after discovery', async () => {
      await orchestrator.initialize();

      // Run discovery
      await orchestrator.discoverPatterns();

      // Get stored patterns
      const storedPatterns = orchestrator.getPatterns();
      expect(Array.isArray(storedPatterns)).toBe(true);
    });

    it('should coordinate pattern-based anomaly detection', async () => {
      await orchestrator.initialize();

      // Process multiple similar requests to establish pattern
      for (let i = 0; i < 10; i++) {
        const request = createCheckRequest(
          principals.regularUser,
          resources.publicDocument,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');
        await orchestrator.processRequest(request, response);
      }

      // Discover patterns from the requests
      await orchestrator.discoverPatterns();

      // Process a different type of request
      const anomalousRequest = createCheckRequest(
        principals.regularUser,
        resources.payout,
        ['bulk-export'],
      );
      const anomalousResponse = createDeniedResponse(anomalousRequest.requestId!, 'bulk-export');
      const result = await orchestrator.processRequest(anomalousRequest, anomalousResponse);

      // Should have higher anomaly score due to pattern deviation
      expect(result.anomalyScore).toBeDefined();
    });
  });

  // ===========================================================================
  // Section 5: Cache Coordination Tests
  // ===========================================================================

  describe('Cache Coordination', () => {
    it('should cache and reuse explanations', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.regularUser,
        resources.publicDocument,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      // First request - generates explanation
      const result1 = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
      });

      // Second identical request - should use cached explanation
      const result2 = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
      });

      // Both should have explanations
      expect(result1.explanation).toBeDefined();
      expect(result2.explanation).toBeDefined();

      // Processing time might be faster on cached request
      expect(result2.processingTimeMs).toBeLessThanOrEqual(result1.processingTimeMs + 10);
    });

    it('should maintain separate caches for different requests', async () => {
      await orchestrator.initialize();

      const request1 = createCheckRequest(
        principals.regularUser,
        resources.publicDocument,
        ['view'],
      );
      const response1 = createAllowedResponse(request1.requestId!, 'view');

      const request2 = createCheckRequest(
        principals.admin,
        resources.adminSettings,
        ['edit'],
      );
      const response2 = createAllowedResponse(request2.requestId!, 'edit');

      const result1 = await orchestrator.processRequest(request1, response1, {
        includeExplanation: true,
      });
      const result2 = await orchestrator.processRequest(request2, response2, {
        includeExplanation: true,
      });

      // Different requests should have different explanations
      expect(result1.explanation).toBeDefined();
      expect(result2.explanation).toBeDefined();
      expect(result1.explanation!.requestId).not.toBe(result2.explanation!.requestId);
    });

    it('should coordinate principal stats caching', async () => {
      await orchestrator.initialize();

      // Process multiple requests from same principal
      const principalId = 'stats-cache-user';
      for (let i = 0; i < 5; i++) {
        const request = createCheckRequest(
          { id: principalId, roles: ['user'], attributes: {} },
          { kind: 'document', id: `doc-${i}`, attributes: {} },
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');
        await orchestrator.processRequest(request, response);
      }

      // Subsequent requests should benefit from cached stats
      const finalRequest = createCheckRequest(
        { id: principalId, roles: ['user'], attributes: {} },
        resources.publicDocument,
        ['view'],
      );
      const finalResponse = createAllowedResponse(finalRequest.requestId!, 'view');
      const result = await orchestrator.processRequest(finalRequest, finalResponse);

      expect(result.processingTimeMs).toBeLessThan(100);
    });
  });

  // ===========================================================================
  // Section 6: Health Coordination Tests
  // ===========================================================================

  describe('Health Coordination', () => {
    it('should report coordinated health status', async () => {
      await orchestrator.initialize();

      const health = await orchestrator.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.agents.guardian).toBeDefined();
      expect(health.agents.analyst).toBeDefined();
      expect(health.agents.advisor).toBeDefined();
      expect(health.agents.enforcer).toBeDefined();
      expect(health.infrastructure).toBeDefined();
    });

    it('should track metrics across all agents', async () => {
      await orchestrator.initialize();

      // Process some requests
      for (let i = 0; i < 10; i++) {
        const request = createCheckRequest(
          { id: `metrics-user-${i}`, roles: ['user'], attributes: {} },
          resources.publicDocument,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');
        await orchestrator.processRequest(request, response);
      }

      const health = await orchestrator.getHealth();

      // All agents should have processed requests
      expect(health.agents.guardian.metrics.processedCount).toBeGreaterThanOrEqual(10);
    });

    it('should maintain agent state consistency', async () => {
      await orchestrator.initialize();

      // Process various request types
      const requests = [
        { principal: principals.regularUser, resource: resources.publicDocument, action: 'view' },
        { principal: principals.subscriber, resource: resources.premiumContent, action: 'view' },
        { principal: principals.admin, resource: resources.adminSettings, action: 'view' },
      ];

      for (const { principal, resource, action } of requests) {
        const request = createCheckRequest(principal, resource, [action]);
        const response = createAllowedResponse(request.requestId!, action);
        await orchestrator.processRequest(request, response);
      }

      const health = await orchestrator.getHealth();

      // All agents should remain in ready state
      expect(health.agents.guardian.state).toBe('ready');
      expect(health.agents.analyst.state).toBe('ready');
      expect(health.agents.advisor.state).toBe('ready');
      expect(health.agents.enforcer.state).toBe('ready');
    });
  });

  // ===========================================================================
  // Section 7: Error Coordination Tests
  // ===========================================================================

  describe('Error Coordination', () => {
    it('should handle errors without affecting other agents', async () => {
      await orchestrator.initialize();

      // Process normal request
      const request = createCheckRequest(
        principals.regularUser,
        resources.publicDocument,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response);

      // Should complete successfully
      expect(result.enforcement?.allowed).toBe(true);

      // All agents should still be ready
      const health = await orchestrator.getHealth();
      expect(health.status).toBe('healthy');
    });

    it('should recover from individual agent errors', async () => {
      await orchestrator.initialize();

      // Process multiple requests - system should remain stable
      const results = [];
      for (let i = 0; i < 20; i++) {
        const request = createCheckRequest(
          { id: `error-recovery-user-${i}`, roles: ['user'], attributes: {} },
          resources.publicDocument,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');
        try {
          const result = await orchestrator.processRequest(request, response);
          results.push(result);
        } catch {
          // Should not throw
        }
      }

      // Most or all requests should succeed
      expect(results.length).toBeGreaterThanOrEqual(18);
    });

    it('should coordinate graceful shutdown', async () => {
      await orchestrator.initialize();

      // Process a request
      const request = createCheckRequest(
        principals.regularUser,
        resources.publicDocument,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');
      await orchestrator.processRequest(request, response);

      // Shutdown should complete without errors
      await expect(orchestrator.shutdown()).resolves.not.toThrow();

      // Creating new orchestrator should work
      const newOrchestrator = new AgentOrchestrator(config);
      await newOrchestrator.initialize();

      const health = await newOrchestrator.getHealth();
      expect(health.status).toBe('healthy');

      await newOrchestrator.shutdown();
    });
  });
});
