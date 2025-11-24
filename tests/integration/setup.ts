/**
 * Integration Test Setup for AuthZ Engine
 *
 * Provides test server bootstrap, mock services, and cleanup utilities
 * for comprehensive end-to-end testing of the authorization engine.
 *
 * This standalone setup uses minimal dependencies for testing.
 */

import { vi } from 'vitest';
import http from 'http';

// Type definitions (standalone to avoid package dependencies)
export interface Principal {
  id: string;
  roles: string[];
  attributes: Record<string, unknown>;
}

export interface Resource {
  kind: string;
  id: string;
  attributes: Record<string, unknown>;
}

export interface CheckRequest {
  requestId?: string;
  principal: Principal;
  resource: Resource;
  actions: string[];
  auxData?: Record<string, unknown>;
}

export interface CheckResponse {
  requestId: string;
  results: Record<string, { effect: 'allow' | 'deny'; policy: string; meta?: Record<string, unknown> }>;
  meta?: {
    evaluationDurationMs?: number;
    policiesEvaluated?: string[];
  };
}

export interface ResourcePolicy {
  apiVersion: string;
  kind: 'ResourcePolicy';
  metadata: {
    name: string;
    description?: string;
    version?: string;
  };
  spec: {
    resource: string;
    rules: Array<{
      name: string;
      actions: string[];
      effect: 'allow' | 'deny';
      roles?: string[];
      derivedRoles?: string[];
      condition?: {
        expression: string;
      };
    }>;
  };
}

export interface DerivedRolesPolicy {
  apiVersion: string;
  kind: 'DerivedRoles';
  metadata: {
    name: string;
    description?: string;
    version?: string;
  };
  spec: {
    definitions: Array<{
      name: string;
      parentRoles: string[];
      condition?: {
        expression: string;
      };
    }>;
  };
}

export interface AgentConfig {
  type?: string;
  name?: string;
  enabled?: boolean;
}

export interface Anomaly {
  id: string;
  detectedAt: Date;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  principalId: string;
  resourceKind?: string;
  action?: string;
  description: string;
  score: number;
  evidence: {
    recentRequests: number;
    baselineRequests: number;
    deviation: number;
    relatedDecisions: string[];
  };
  baseline: {
    period: string;
    avgRequestsPerHour: number;
    uniqueResources: number;
    commonActions: string[];
    commonTimeRanges: string[];
  };
  observed: {
    requestsInWindow: number;
    uniqueResourcesAccessed: number;
    actionsPerformed: string[];
    timeOfAccess: string;
  };
  status: 'open' | 'resolved' | 'false_positive';
  resolvedAt?: Date;
  resolution?: string;
}

export interface LearnedPattern {
  id: string;
  discoveredAt: Date;
  lastUpdated: Date;
  type: string;
  confidence: number;
  sampleSize: number;
  description: string;
  conditions: unknown[];
  isApproved: boolean;
  validatedAt?: Date;
  validatedBy?: string;
  suggestedPolicyRule?: string;
  suggestedOptimization?: string;
}

export interface EnforcerAction {
  id: string;
  triggeredAt: Date;
  type: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  triggeredBy: {
    agentType: string;
    reason: string;
    relatedIds: string[];
  };
  status: 'pending' | 'executed' | 'rejected' | 'failed';
  canRollback: boolean;
  executedAt?: Date;
  result?: unknown;
}

export interface DecisionRecord {
  id: string;
  requestId: string;
  timestamp: Date;
  principal: Principal;
  resource: Resource;
  actions: string[];
  results: Record<string, unknown>;
  derivedRoles: string[];
  matchedPolicies: string[];
}

// =============================================================================
// Configuration
// =============================================================================

export interface TestServerConfig {
  restPort: number;
  enableAgentic: boolean;
  policies?: ResourcePolicy[];
  derivedRoles?: DerivedRolesPolicy[];
  agentConfig?: Partial<AgentConfig>;
}

export const DEFAULT_TEST_CONFIG: TestServerConfig = {
  restPort: 0, // Random available port
  enableAgentic: true,
};

// =============================================================================
// Test Server Manager (using native http module)
// =============================================================================

export class TestServerManager {
  private httpServer: http.Server | null = null;
  private engine: MockDecisionEngine | null = null;
  private orchestrator: MockOrchestrator | null = null;
  private config: TestServerConfig;

  public restUrl: string = '';
  public actualRestPort: number = 0;
  public grpcAddress: string = ''; // For gRPC test compatibility (uses REST under the hood)

  constructor(config: Partial<TestServerConfig> = {}) {
    this.config = { ...DEFAULT_TEST_CONFIG, ...config };
  }

  async start(): Promise<void> {
    // Initialize mock engine
    this.engine = new MockDecisionEngine();
    if (this.config.policies) {
      this.config.policies.forEach(p => this.engine!.loadPolicy(p));
    }
    if (this.config.derivedRoles) {
      this.config.derivedRoles.forEach(dr => this.engine!.loadDerivedRoles(dr));
    }

    // Initialize mock orchestrator if agentic is enabled
    if (this.config.enableAgentic) {
      this.orchestrator = new MockOrchestrator(this.config.agentConfig);
      await this.orchestrator.initialize();
    }

    // Start REST server
    await this.startRestServer();
  }

  private async startRestServer(): Promise<void> {
    this.httpServer = http.createServer(async (req, res) => {
      // Set CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Content-Type', 'application/json');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      try {
        const url = req.url || '/';
        const method = req.method || 'GET';

        // Parse body for POST requests
        let body: any = {};
        if (method === 'POST') {
          body = await this.parseBody(req);
        }

        // Route handling
        if (method === 'GET' && url === '/health') {
          res.writeHead(200);
          res.end(JSON.stringify({
            status: 'healthy',
            version: '0.1.0-test',
            policies_loaded: this.engine?.getPolicyCount() || 0,
          }));
          return;
        }

        if (method === 'GET' && url === '/ready') {
          res.writeHead(200);
          res.end(JSON.stringify({
            ready: true,
            policies_loaded: this.engine?.getPolicyCount() || 0,
          }));
          return;
        }

        if (method === 'POST' && url === '/api/check') {
          if (!body.principal || !body.resource) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Missing principal or resource' }));
            return;
          }
          const response = this.engine!.check({
            requestId: body.requestId || `test-${Date.now()}`,
            principal: {
              id: body.principal.id,
              roles: body.principal.roles || [],
              attributes: body.principal.attr || body.principal.attributes || {},
            },
            resource: {
              kind: body.resource.kind,
              id: body.resource.id,
              attributes: body.resource.attr || body.resource.attributes || {},
            },
            actions: body.actions || [],
          });
          res.writeHead(200);
          res.end(JSON.stringify({
            requestId: response.requestId,
            results: response.results,
            meta: response.meta,
          }));
          return;
        }

        if (method === 'POST' && url === '/api/check/batch') {
          const principal: Principal = {
            id: body.principal.id,
            roles: body.principal.roles || [],
            attributes: body.principal.attr || {},
          };

          const results: Record<string, Record<string, unknown>> = {};

          for (const item of body.resources || []) {
            const resource: Resource = {
              kind: item.resource.kind,
              id: item.resource.id,
              attributes: item.resource.attr || {},
            };
            const response = this.engine!.check({
              requestId: body.requestId,
              principal,
              resource,
              actions: item.actions,
            });
            results[`${resource.kind}:${resource.id}`] = response.results;
          }

          res.writeHead(200);
          res.end(JSON.stringify({
            requestId: body.requestId || `batch-${Date.now()}`,
            results,
          }));
          return;
        }

        // Agentic endpoints
        if (this.config.enableAgentic && this.orchestrator) {
          if (method === 'POST' && url === '/v1/check/agentic') {
            const checkRequest: CheckRequest = {
              requestId: body.requestId || `agentic-${Date.now()}`,
              principal: {
                id: body.principal.id,
                roles: body.principal.roles || [],
                attributes: body.principal.attr || body.principal.attributes || {},
              },
              resource: {
                kind: body.resource.kind,
                id: body.resource.id,
                attributes: body.resource.attr || body.resource.attributes || {},
              },
              actions: body.actions,
            };

            const response = this.engine!.check(checkRequest);
            const agenticResult = await this.orchestrator!.processRequest(checkRequest, response);

            res.writeHead(200);
            res.end(JSON.stringify({
              requestId: response.requestId,
              results: response.results,
              meta: response.meta,
              agentic: agenticResult,
            }));
            return;
          }

          if (method === 'GET' && url === '/v1/agents/health') {
            const health = await this.orchestrator!.getHealth();
            res.writeHead(200);
            res.end(JSON.stringify({
              status: health.status,
              agents: health.agents,
              infrastructure: health.infrastructure,
            }));
            return;
          }

          if (method === 'GET' && url === '/v1/agents/patterns') {
            const patterns = this.orchestrator!.getPatterns();
            res.writeHead(200);
            res.end(JSON.stringify({ count: patterns.length, patterns }));
            return;
          }

          if (method === 'GET' && (url === '/v1/agents/anomalies' || url?.startsWith('/v1/agents/anomalies?'))) {
            const anomalies = this.orchestrator!.getAnomalies();
            res.writeHead(200);
            res.end(JSON.stringify({ count: anomalies.length, anomalies }));
            return;
          }

          if (method === 'GET' && url === '/v1/agents/enforcements') {
            const actions = this.orchestrator!.getPendingActions();
            res.writeHead(200);
            res.end(JSON.stringify({ count: actions.length, enforcements: actions }));
            return;
          }

          if (method === 'GET' && url === '/api/v1/agentic/health') {
            const health = await this.orchestrator!.getHealth();
            res.writeHead(200);
            res.end(JSON.stringify({
              status: health.status,
              timestamp: new Date().toISOString(),
              agents: Object.entries(health.agents).map(([name, agentHealth]) => ({
                name,
                type: agentHealth.type,
                state: agentHealth.state,
                healthy: agentHealth.state === 'ready',
                metrics: agentHealth.metrics,
              })),
            }));
            return;
          }
        }

        // 404 for unmatched routes
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }));
      }
    });

    // Start server on random port
    return new Promise((resolve, reject) => {
      this.httpServer!.listen(this.config.restPort, '127.0.0.1', () => {
        const address = this.httpServer!.address();
        if (address && typeof address === 'object') {
          this.actualRestPort = address.port;
          this.restUrl = `http://127.0.0.1:${address.port}`;
          this.grpcAddress = `127.0.0.1:${address.port}`; // Use same port for gRPC test compatibility
        }
        resolve();
      });
      this.httpServer!.on('error', reject);
    });
  }

  private parseBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.httpServer = null;
    }

    if (this.orchestrator) {
      await this.orchestrator.shutdown();
      this.orchestrator = null;
    }

    this.engine = null;
  }

  getEngine(): MockDecisionEngine | null {
    return this.engine;
  }

  getOrchestrator(): MockOrchestrator | null {
    return this.orchestrator;
  }

  loadPolicy(policy: ResourcePolicy): void {
    this.engine?.loadPolicy(policy);
  }

  loadDerivedRoles(derivedRoles: DerivedRolesPolicy): void {
    this.engine?.loadDerivedRoles(derivedRoles);
  }
}

// =============================================================================
// Mock Decision Engine
// =============================================================================

export class MockDecisionEngine {
  private policies: Map<string, ResourcePolicy> = new Map();
  private derivedRoles: Map<string, DerivedRolesPolicy> = new Map();
  private checkCount: number = 0;
  private totalCheckTimeMs: number = 0;

  loadPolicy(policy: ResourcePolicy): void {
    this.policies.set(policy.metadata.name, policy);
  }

  loadDerivedRoles(derivedRoles: DerivedRolesPolicy): void {
    this.derivedRoles.set(derivedRoles.metadata.name, derivedRoles);
  }

  getPolicyCount(): number {
    return this.policies.size + this.derivedRoles.size;
  }

  check(request: CheckRequest): CheckResponse {
    const startTime = performance.now();
    this.checkCount++;

    const results: Record<string, { effect: 'allow' | 'deny'; policy: string; meta?: Record<string, unknown> }> = {};
    const policiesEvaluated: string[] = [];

    // Find matching policy
    const matchingPolicy = Array.from(this.policies.values()).find(
      p => p.spec.resource === request.resource.kind
    );

    if (matchingPolicy) {
      policiesEvaluated.push(matchingPolicy.metadata.name);

      for (const action of request.actions) {
        let effect: 'allow' | 'deny' = 'deny';
        let matchedRule: string | undefined;

        for (const rule of matchingPolicy.spec.rules) {
          if (rule.actions.includes(action) || rule.actions.includes('*')) {
            // Check role match
            const hasRole = !rule.roles || rule.roles.length === 0 ||
              rule.roles.some(r => request.principal.roles.includes(r));

            if (hasRole) {
              // Evaluate condition if present
              let conditionPassed = true;
              if (rule.condition?.expression) {
                conditionPassed = this.evaluateCondition(
                  rule.condition.expression,
                  request.principal,
                  request.resource
                );
              }

              if (conditionPassed) {
                effect = rule.effect;
                matchedRule = rule.name;
                break;
              }
            }
          }
        }

        results[action] = {
          effect,
          policy: matchingPolicy.metadata.name,
          meta: { matchedRule },
        };
      }
    } else {
      // Default deny for unknown resources
      for (const action of request.actions) {
        results[action] = {
          effect: 'deny',
          policy: 'default-deny',
          meta: { matchedRule: 'no-matching-policy' },
        };
      }
    }

    const duration = performance.now() - startTime;
    this.totalCheckTimeMs += duration;

    return {
      requestId: request.requestId || `check-${Date.now()}`,
      results,
      meta: {
        evaluationDurationMs: duration,
        policiesEvaluated,
      },
    };
  }

  private evaluateCondition(expression: string, principal: Principal, resource: Resource): boolean {
    // Simple condition evaluator for common patterns
    try {
      // Owner check: resource.ownerId == principal.id
      if (expression.includes('resource.ownerId') && expression.includes('principal.id')) {
        const ownerId = resource.attributes['ownerId'] as string;
        return ownerId === principal.id;
      }

      // Attribute checks
      if (expression.includes('==')) {
        const parts = expression.split('==').map(s => s.trim());
        const left = this.resolveValue(parts[0], principal, resource);
        const right = this.resolveValue(parts[1], principal, resource);
        return left === right;
      }

      return true; // Default to true for unknown expressions
    } catch {
      return false;
    }
  }

  private resolveValue(path: string, principal: Principal, resource: Resource): unknown {
    const cleanPath = path.replace(/['"]/g, '');

    if (cleanPath.startsWith('principal.')) {
      const key = cleanPath.replace('principal.', '');
      if (key === 'id') return principal.id;
      return principal.attributes[key];
    }

    if (cleanPath.startsWith('resource.')) {
      const key = cleanPath.replace('resource.', '');
      if (key === 'id') return resource.id;
      if (key === 'kind') return resource.kind;
      return resource.attributes[key];
    }

    return cleanPath;
  }

  getStats(): { checkCount: number; avgCheckTimeMs: number } {
    return {
      checkCount: this.checkCount,
      avgCheckTimeMs: this.checkCount > 0 ? this.totalCheckTimeMs / this.checkCount : 0,
    };
  }

  reset(): void {
    this.policies.clear();
    this.derivedRoles.clear();
    this.checkCount = 0;
    this.totalCheckTimeMs = 0;
  }
}

// =============================================================================
// Mock Orchestrator
// =============================================================================

export class MockOrchestrator {
  private config: Partial<AgentConfig>;
  private initialized: boolean = false;
  private decisions: DecisionRecord[] = [];
  private anomalies: Anomaly[] = [];
  private patterns: LearnedPattern[] = [];
  private pendingActions: EnforcerAction[] = [];
  private processCount: number = 0;

  constructor(config?: Partial<AgentConfig>) {
    this.config = config || {};
  }

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  async processRequest(
    request: CheckRequest,
    response: CheckResponse,
    _options?: { includeExplanation?: boolean }
  ): Promise<{
    anomalyScore: number;
    anomaly: Anomaly | null;
    explanation: { summary: string; factors: any[]; naturalLanguage?: string } | null;
    enforcement: { allowed: boolean; reason: string; action: EnforcerAction | null };
    processingTimeMs: number;
    agentsInvolved: string[];
  }> {
    const startTime = performance.now();
    this.processCount++;

    // Store decision
    const decision: DecisionRecord = {
      id: `decision-${Date.now()}-${this.processCount}`,
      requestId: request.requestId || 'unknown',
      timestamp: new Date(),
      principal: request.principal,
      resource: request.resource,
      actions: request.actions,
      results: response.results as any,
      derivedRoles: [],
      matchedPolicies: response.meta?.policiesEvaluated || [],
    };
    this.decisions.push(decision);

    // Simulate anomaly detection
    const anomalyScore = Math.random() * 0.3; // Low anomaly for most requests
    let anomaly: Anomaly | null = null;

    if (anomalyScore > 0.7) {
      anomaly = {
        id: `anomaly-${Date.now()}`,
        detectedAt: new Date(),
        type: 'velocity_spike',
        severity: 'medium',
        principalId: request.principal.id,
        description: 'Unusual access pattern detected',
        score: anomalyScore,
        evidence: {
          recentRequests: 100,
          baselineRequests: 10,
          deviation: 3,
          relatedDecisions: [decision.id],
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
          actionsPerformed: request.actions,
          timeOfAccess: new Date().toISOString(),
        },
        status: 'open',
      };
      this.anomalies.push(anomaly);
    }

    const processingTimeMs = performance.now() - startTime;

    return {
      anomalyScore,
      anomaly,
      explanation: {
        summary: `Access ${Object.values(response.results).some(r => r.effect === 'allow') ? 'allowed' : 'denied'} based on policy evaluation`,
        factors: [
          {
            type: 'role',
            description: `Principal has roles: ${request.principal.roles.join(', ')}`,
            impact: 'neutral',
            details: {},
          },
        ],
        naturalLanguage: 'This request was processed through the authorization pipeline.',
      },
      enforcement: {
        allowed: true,
        reason: 'No enforcement action required',
        action: null,
      },
      processingTimeMs,
      agentsInvolved: ['guardian', 'analyst', 'advisor', 'enforcer'],
    };
  }

  async getHealth(): Promise<{
    status: string;
    agents: Record<string, { type: string; state: string; metrics: any }>;
    infrastructure: { store: string; eventBus: string };
  }> {
    return {
      status: this.initialized ? 'healthy' : 'unhealthy',
      agents: {
        guardian: { type: 'guardian', state: 'ready', metrics: { processedCount: this.processCount } },
        analyst: { type: 'analyst', state: 'ready', metrics: { patternsDiscovered: this.patterns.length } },
        advisor: { type: 'advisor', state: 'ready', metrics: { explanationsGenerated: this.processCount } },
        enforcer: { type: 'enforcer', state: 'ready', metrics: { actionsTriggered: this.pendingActions.length } },
      },
      infrastructure: {
        store: 'memory',
        eventBus: 'memory',
      },
    };
  }

  getPatterns(): LearnedPattern[] {
    return this.patterns;
  }

  getAnomalies(principalId?: string): Anomaly[] {
    if (principalId) {
      return this.anomalies.filter(a => a.principalId === principalId);
    }
    return this.anomalies;
  }

  getPendingActions(): EnforcerAction[] {
    return this.pendingActions.filter(a => a.status === 'pending');
  }

  // Test helpers
  addPattern(pattern: LearnedPattern): void {
    this.patterns.push(pattern);
  }

  addAnomaly(anomaly: Anomaly): void {
    this.anomalies.push(anomaly);
  }

  addPendingAction(action: EnforcerAction): void {
    this.pendingActions.push(action);
  }

  reset(): void {
    this.decisions = [];
    this.anomalies = [];
    this.patterns = [];
    this.pendingActions = [];
    this.processCount = 0;
  }
}

// =============================================================================
// Mock Cache
// =============================================================================

export class MockCache {
  private data: Map<string, { value: unknown; expiry: number }> = new Map();
  private hits: number = 0;
  private misses: number = 0;

  async get<T>(key: string): Promise<T | null> {
    const entry = this.data.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (entry.expiry && entry.expiry < Date.now()) {
      this.data.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    return entry.value as T;
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    this.data.set(key, {
      value,
      expiry: ttlMs ? Date.now() + ttlMs : 0,
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async clear(): Promise<void> {
    this.data.clear();
  }

  getStats(): { hits: number; misses: number; hitRate: number; size: number } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      size: this.data.size,
    };
  }

  reset(): void {
    this.data.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

// =============================================================================
// Request Body Types
// =============================================================================

interface CheckRequestBody {
  requestId?: string;
  principal: {
    id: string;
    roles?: string[];
    attr?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
  };
  resource: {
    kind: string;
    id: string;
    attr?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
  };
  actions: string[];
}

interface BatchCheckRequestBody {
  requestId?: string;
  principal: {
    id: string;
    roles?: string[];
    attr?: Record<string, unknown>;
  };
  resources: Array<{
    resource: {
      kind: string;
      id: string;
      attr?: Record<string, unknown>;
    };
    actions: string[];
  }>;
}

interface AgenticCheckRequestBody extends CheckRequestBody {
  includeExplanation?: boolean;
}

// =============================================================================
// Test Utilities
// =============================================================================

export function createTestPrincipal(overrides?: Partial<Principal>): Principal {
  return {
    id: `user-${Date.now()}`,
    roles: ['user'],
    attributes: {},
    ...overrides,
  };
}

export function createTestResource(overrides?: Partial<Resource>): Resource {
  return {
    kind: 'document',
    id: `doc-${Date.now()}`,
    attributes: {},
    ...overrides,
  };
}

export function createTestCheckRequest(overrides?: Partial<CheckRequest>): CheckRequest {
  return {
    requestId: `req-${Date.now()}`,
    principal: createTestPrincipal(),
    resource: createTestResource(),
    actions: ['view'],
    ...overrides,
  };
}

export async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function generateRandomId(): string {
  return Math.random().toString(36).substring(2, 15);
}

// =============================================================================
// Cleanup Utilities
// =============================================================================

let globalTestServer: TestServerManager | null = null;

export async function setupTestServer(config?: Partial<TestServerConfig>): Promise<TestServerManager> {
  if (globalTestServer) {
    await globalTestServer.stop();
  }
  globalTestServer = new TestServerManager(config);
  await globalTestServer.start();
  return globalTestServer;
}

export async function teardownTestServer(): Promise<void> {
  if (globalTestServer) {
    await globalTestServer.stop();
    globalTestServer = null;
  }
}

export function getTestServer(): TestServerManager {
  if (!globalTestServer) {
    throw new Error('Test server not initialized. Call setupTestServer() first.');
  }
  return globalTestServer;
}

// =============================================================================
// Exports
// =============================================================================

export default {
  TestServerManager,
  MockDecisionEngine,
  MockOrchestrator,
  MockCache,
  setupTestServer,
  teardownTestServer,
  getTestServer,
  createTestPrincipal,
  createTestResource,
  createTestCheckRequest,
  wait,
  generateRandomId,
  DEFAULT_TEST_CONFIG,
};
