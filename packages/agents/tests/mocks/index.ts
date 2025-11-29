/**
 * Reusable Mocks for Agentic Authorization Tests
 *
 * Provides mock implementations for external dependencies
 * to enable isolated testing of agent functionality.
 */

import { vi } from 'vitest';
import type {
  AgentConfig,
  DecisionRecord,
  Anomaly,
  LearnedPattern,
  EnforcerAction,
} from '../../src/types/agent.types.js';
import type { OrchestratorConfig } from '../../src/orchestrator/agent-orchestrator.js';

// =============================================================================
// Decision Store Mocks
// =============================================================================

export function createMockDecisionStore() {
  const decisions: DecisionRecord[] = [];
  const anomalies: Anomaly[] = [];
  const patterns: LearnedPattern[] = [];
  const actions: EnforcerAction[] = [];

  return {
    // Core methods
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),

    // Decision operations
    storeDecision: vi.fn().mockImplementation((record: DecisionRecord) => {
      decisions.push(record);
      return Promise.resolve();
    }),
    queryDecisions: vi.fn().mockResolvedValue(decisions),
    getDecision: vi.fn().mockImplementation((id: string) => {
      return Promise.resolve(decisions.find(d => d.id === id));
    }),

    // Principal stats
    getPrincipalStats: vi.fn().mockResolvedValue({
      totalRequests: 100,
      uniqueResources: 10,
      denialRate: 0.05,
      avgAnomalyScore: 0.2,
      commonActions: ['view', 'list'],
    }),

    // Anomaly operations
    storeAnomaly: vi.fn().mockImplementation((anomaly: Anomaly) => {
      anomalies.push(anomaly);
      return Promise.resolve();
    }),
    updateAnomalyStatus: vi.fn().mockResolvedValue(undefined),
    getAnomalies: vi.fn().mockResolvedValue(anomalies),

    // Pattern operations
    storePattern: vi.fn().mockImplementation((pattern: LearnedPattern) => {
      patterns.push(pattern);
      return Promise.resolve();
    }),
    getPatterns: vi.fn().mockResolvedValue(patterns),

    // Action operations
    storeAction: vi.fn().mockImplementation((action: EnforcerAction) => {
      actions.push(action);
      return Promise.resolve();
    }),
    getActions: vi.fn().mockResolvedValue(actions),

    // Test helpers
    _getStoredDecisions: () => decisions,
    _getStoredAnomalies: () => anomalies,
    _getStoredPatterns: () => patterns,
    _getStoredActions: () => actions,
    _clearAll: () => {
      decisions.length = 0;
      anomalies.length = 0;
      patterns.length = 0;
      actions.length = 0;
    },
  };
}

// =============================================================================
// Event Bus Mocks
// =============================================================================

export function createMockEventBus() {
  const subscribers: Map<string, Array<(event: unknown) => void>> = new Map();
  const publishedEvents: Array<{ type: string; payload: unknown }> = [];

  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),

    publish: vi.fn().mockImplementation((type: string, payload: unknown) => {
      publishedEvents.push({ type, payload });
      const handlers = subscribers.get(type) || [];
      handlers.forEach(handler => handler({ type, payload, timestamp: new Date() }));
      return Promise.resolve();
    }),

    subscribe: vi.fn().mockImplementation((type: string, handler: (event: unknown) => void) => {
      if (!subscribers.has(type)) {
        subscribers.set(type, []);
      }
      subscribers.get(type)!.push(handler);
      return {
        unsubscribe: vi.fn().mockImplementation(() => {
          const handlers = subscribers.get(type);
          if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) handlers.splice(index, 1);
          }
        }),
      };
    }),

    // Test helpers
    _getPublishedEvents: () => publishedEvents,
    _getSubscribers: () => subscribers,
    _triggerEvent: (type: string, payload: unknown) => {
      const handlers = subscribers.get(type) || [];
      handlers.forEach(handler => handler({ type, payload, timestamp: new Date() }));
    },
    _clearAll: () => {
      publishedEvents.length = 0;
      subscribers.clear();
    },
  };
}

// =============================================================================
// External Service Mocks
// =============================================================================

/**
 * Mock PostgreSQL Pool for database operations
 */
export function createMockPool() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
  };
}

/**
 * Mock Redis client for caching/pub-sub
 */
export function createMockRedis() {
  const data: Map<string, string> = new Map();

  return {
    on: vi.fn(),
    psubscribe: vi.fn(),
    publish: vi.fn(),
    quit: vi.fn(),
    get: vi.fn().mockImplementation((key: string) => Promise.resolve(data.get(key))),
    set: vi.fn().mockImplementation((key: string, value: string) => {
      data.set(key, value);
      return Promise.resolve('OK');
    }),
    del: vi.fn().mockImplementation((key: string) => {
      data.delete(key);
      return Promise.resolve(1);
    }),
    _getData: () => data,
    _clearAll: () => data.clear(),
  };
}

// =============================================================================
// Configuration Factories
// =============================================================================

/**
 * Create a test agent configuration
 */
export function createTestAgentConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    enabled: true,
    logLevel: 'error', // Suppress logs in tests
    guardian: {
      anomalyThreshold: 0.7,
      baselinePeriodDays: 30,
      velocityWindowMinutes: 5,
      enableRealTimeDetection: true,
    },
    analyst: {
      minSampleSize: 10, // Lower for testing
      confidenceThreshold: 0.5,
      learningEnabled: false, // Disable auto-discovery in tests
      patternDiscoveryInterval: '0 */6 * * *', // Every 6 hours
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
    ...overrides,
  };
}

/**
 * Create a test orchestrator configuration
 */
export function createTestOrchestratorConfig(
  overrides?: Partial<OrchestratorConfig>,
): OrchestratorConfig {
  return {
    agents: createTestAgentConfig(overrides?.agents),
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
    ...overrides,
  };
}

// =============================================================================
// Decision Record Factories
// =============================================================================

/**
 * Create a mock decision record
 */
export function createMockDecisionRecord(
  overrides?: Partial<DecisionRecord>,
): DecisionRecord {
  const id = `decision-${Math.random().toString(36).substring(2, 10)}`;

  return {
    id,
    requestId: `req-${Math.random().toString(36).substring(2, 10)}`,
    timestamp: new Date(),
    principal: { id: 'user-1', roles: ['user'], attributes: {} },
    resource: { kind: 'document', id: 'doc-1', attributes: {} },
    actions: ['view'],
    results: { view: { allowed: true } },
    derivedRoles: [],
    matchedPolicies: [],
    ...overrides,
  };
}

/**
 * Create a batch of mock decision records with patterns
 */
export function createDecisionBatch(
  count: number,
  template?: Partial<DecisionRecord>,
): DecisionRecord[] {
  return Array.from({ length: count }, (_, index) =>
    createMockDecisionRecord({
      ...template,
      id: `decision-${index}`,
      requestId: `req-${index}`,
      timestamp: new Date(Date.now() - index * 60000), // 1 minute apart
    }),
  );
}

// =============================================================================
// Anomaly Factories
// =============================================================================

/**
 * Create a mock anomaly
 */
export function createMockAnomaly(overrides?: Partial<Anomaly>): Anomaly {
  return {
    id: `anomaly-${Math.random().toString(36).substring(2, 10)}`,
    detectedAt: new Date(),
    type: 'velocity_spike',
    severity: 'medium',
    principalId: 'user-123',
    description: 'Unusual access pattern detected',
    score: 0.75,
    evidence: {
      recentRequests: 100,
      baselineRequests: 10,
      deviation: 3,
      relatedDecisions: [],
    },
    baseline: {
      period: '7d',
      avgRequestsPerHour: 5,
      uniqueResources: 3,
      commonActions: ['view'],
      commonTimeRanges: [],
    },
    observed: {
      requestsInWindow: 100,
      uniqueResourcesAccessed: 50,
      actionsPerformed: ['view', 'edit'],
      timeOfAccess: new Date().toISOString(),
    },
    status: 'open',
    ...overrides,
  };
}

// =============================================================================
// Setup/Teardown Helpers
// =============================================================================

/**
 * Setup global mocks for external dependencies
 */
export function setupGlobalMocks() {
  // Mock pg
  vi.mock('pg', () => ({
    Pool: vi.fn().mockImplementation(() => createMockPool()),
  }));

  // Mock ioredis
  vi.mock('ioredis', () => ({
    default: vi.fn().mockImplementation(() => createMockRedis()),
  }));

  // Mock OpenAI
  vi.mock('openai', () => ({
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'Mock LLM response' } }],
          }),
        },
      },
    })),
  }));
}

/**
 * Clear all mocks between tests
 */
export function clearAllMocks() {
  vi.clearAllMocks();
}

export default {
  createMockDecisionStore,
  createMockEventBus,
  createMockPool,
  createMockRedis,
  createTestAgentConfig,
  createTestOrchestratorConfig,
  createMockDecisionRecord,
  createDecisionBatch,
  createMockAnomaly,
  setupGlobalMocks,
  clearAllMocks,
};
