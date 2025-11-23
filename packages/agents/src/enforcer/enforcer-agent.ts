/**
 * ENFORCER Agent - Autonomous Action Execution
 *
 * Responsibilities:
 * - Execute protective actions based on anomaly detection
 * - Rate limit suspicious principals
 * - Temporarily block high-risk sessions
 * - Escalate to human review
 * - Maintain audit trail of all actions
 * - Support rollback of actions
 *
 * Enhanced Features:
 * - Decision caching with TTL
 * - Rate limiting per principal/resource
 * - Circuit breaker for downstream services
 * - Graceful degradation modes
 * - Comprehensive enforcement audit trail
 */

import { BaseAgent } from '../core/base-agent.js';
import type { DecisionStore } from '../core/decision-store.js';
import type { EventBus } from '../core/event-bus.js';
import type {
  AgentConfig,
  EnforcerAction,
  EnforcerActionType,
  EnforcerActionResult,
  Priority,
  Anomaly,
  AgentEvent,
} from '../types/agent.types.js';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface EnforcerConfig {
  autoEnforceEnabled: boolean;
  requireApprovalForSeverity: Priority;
  maxActionsPerHour: number;
  rollbackWindowMinutes: number;
  webhookUrl?: string;
  alertEmail?: string;
  // Enhanced configuration
  cache?: CacheConfig;
  rateLimiting?: RateLimitingConfig;
  circuitBreaker?: CircuitBreakerConfig;
  degradation?: DegradationConfig;
  audit?: AuditConfig;
}

export interface CacheConfig {
  enabled: boolean;
  defaultTtlMs: number;
  maxEntries: number;
  cleanupIntervalMs: number;
}

export interface RateLimitingConfig {
  enabled: boolean;
  defaultWindowMs: number;
  defaultMaxRequests: number;
  perResourceLimits?: Record<string, { windowMs: number; maxRequests: number }>;
}

export interface CircuitBreakerConfig {
  enabled: boolean;
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxCalls: number;
  monitoredServices: string[];
}

export interface DegradationConfig {
  enabled: boolean;
  fallbackMode: DegradationMode;
  healthCheckIntervalMs: number;
}

export type DegradationMode = 'allow_all' | 'deny_all' | 'cached_only' | 'rate_limited';

export interface AuditConfig {
  enabled: boolean;
  retentionDays: number;
  includeMetadata: boolean;
  asyncWrite: boolean;
}

interface RateLimitEntry {
  principalId: string;
  limitUntil: Date;
  reason: string;
  actionId: string;
}

interface BlockEntry {
  principalId: string;
  blockedUntil: Date;
  reason: string;
  actionId: string;
}

// Enhanced interfaces for new features

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
  hits: number;
}

interface PrincipalResourceKey {
  principalId: string;
  resourceKind?: string;
  resourceId?: string;
}

interface RateLimitState {
  requestCount: number;
  windowStartMs: number;
  lastRequestMs: number;
}

type CircuitState = 'closed' | 'open' | 'half_open';

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number;
  lastStateChange: number;
  halfOpenCallCount: number;
}

export type AuditEventType =
  | 'decision_cached'
  | 'decision_cache_hit'
  | 'decision_cache_miss'
  | 'rate_limit_applied'
  | 'rate_limit_exceeded'
  | 'block_applied'
  | 'block_lifted'
  | 'circuit_opened'
  | 'circuit_closed'
  | 'circuit_half_open'
  | 'degradation_activated'
  | 'degradation_deactivated'
  | 'action_executed'
  | 'action_failed'
  | 'action_rolled_back'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_rejected';

export interface AuditEntry {
  id: string;
  timestamp: Date;
  eventType: AuditEventType;
  principalId?: string;
  resourceId?: string;
  actionType?: EnforcerActionType;
  details: Record<string, unknown>;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Decision Cache Implementation
// ============================================================================

class DecisionCache {
  private cache: Map<string, CacheEntry<{ allowed: boolean; reason?: string }>> = new Map();
  private config: CacheConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private stats = { hits: 0, misses: 0, evictions: 0 };

  constructor(config: CacheConfig) {
    this.config = config;
  }

  start(): void {
    if (this.config.enabled && this.config.cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupIntervalMs);
    }
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private generateKey(key: PrincipalResourceKey): string {
    return `${key.principalId}:${key.resourceKind || '*'}:${key.resourceId || '*'}`;
  }

  get(key: PrincipalResourceKey): { allowed: boolean; reason?: string } | null {
    if (!this.config.enabled) return null;

    const cacheKey = this.generateKey(key);
    const entry = this.cache.get(cacheKey);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(cacheKey);
      this.stats.misses++;
      return null;
    }

    entry.hits++;
    this.stats.hits++;
    return entry.value;
  }

  set(
    key: PrincipalResourceKey,
    value: { allowed: boolean; reason?: string },
    ttlMs?: number
  ): void {
    if (!this.config.enabled) return;

    // Evict oldest entries if at capacity
    if (this.cache.size >= this.config.maxEntries) {
      this.evictOldest();
    }

    const cacheKey = this.generateKey(key);
    const now = Date.now();

    this.cache.set(cacheKey, {
      value,
      expiresAt: now + (ttlMs ?? this.config.defaultTtlMs),
      createdAt: now,
      hits: 0,
    });
  }

  invalidate(key: PrincipalResourceKey): boolean {
    const cacheKey = this.generateKey(key);
    return this.cache.delete(cacheKey);
  }

  invalidateByPrincipal(principalId: string): number {
    let count = 0;
    for (const [key] of this.cache) {
      if (key.startsWith(`${principalId}:`)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): { hits: number; misses: number; evictions: number; size: number; hitRate: number } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }
  }
}

// ============================================================================
// Rate Limiter Implementation
// ============================================================================

class RateLimiter {
  private limits: Map<string, RateLimitState> = new Map();
  private config: RateLimitingConfig;

  constructor(config: RateLimitingConfig) {
    this.config = config;
  }

  private generateKey(key: PrincipalResourceKey): string {
    return `${key.principalId}:${key.resourceKind || '*'}:${key.resourceId || '*'}`;
  }

  private getConfigForResource(resourceKind?: string): { windowMs: number; maxRequests: number } {
    if (resourceKind && this.config.perResourceLimits?.[resourceKind]) {
      return this.config.perResourceLimits[resourceKind];
    }
    return {
      windowMs: this.config.defaultWindowMs,
      maxRequests: this.config.defaultMaxRequests,
    };
  }

  check(key: PrincipalResourceKey): { allowed: boolean; remaining: number; resetAt: Date } {
    if (!this.config.enabled) {
      return { allowed: true, remaining: Infinity, resetAt: new Date() };
    }

    const limitKey = this.generateKey(key);
    const now = Date.now();
    const limits = this.getConfigForResource(key.resourceKind);

    let state = this.limits.get(limitKey);

    // Initialize or reset window
    if (!state || now - state.windowStartMs >= limits.windowMs) {
      state = {
        requestCount: 0,
        windowStartMs: now,
        lastRequestMs: now,
      };
      this.limits.set(limitKey, state);
    }

    const remaining = Math.max(0, limits.maxRequests - state.requestCount);
    const resetAt = new Date(state.windowStartMs + limits.windowMs);

    return {
      allowed: state.requestCount < limits.maxRequests,
      remaining,
      resetAt,
    };
  }

  increment(key: PrincipalResourceKey): void {
    if (!this.config.enabled) return;

    const limitKey = this.generateKey(key);
    const state = this.limits.get(limitKey);

    if (state) {
      state.requestCount++;
      state.lastRequestMs = Date.now();
    }
  }

  reset(key: PrincipalResourceKey): void {
    const limitKey = this.generateKey(key);
    this.limits.delete(limitKey);
  }

  resetByPrincipal(principalId: string): number {
    let count = 0;
    for (const [key] of this.limits) {
      if (key.startsWith(`${principalId}:`)) {
        this.limits.delete(key);
        count++;
      }
    }
    return count;
  }

  getState(key: PrincipalResourceKey): RateLimitState | undefined {
    return this.limits.get(this.generateKey(key));
  }
}

// ============================================================================
// Circuit Breaker Implementation
// ============================================================================

class CircuitBreaker {
  private circuits: Map<string, CircuitBreakerState> = new Map();
  private config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;

    // Initialize circuits for monitored services
    for (const service of config.monitoredServices) {
      this.circuits.set(service, this.createInitialState());
    }
  }

  private createInitialState(): CircuitBreakerState {
    return {
      state: 'closed',
      failures: 0,
      successes: 0,
      lastFailureTime: 0,
      lastStateChange: Date.now(),
      halfOpenCallCount: 0,
    };
  }

  canExecute(service: string): boolean {
    if (!this.config.enabled) return true;

    const circuit = this.getOrCreateCircuit(service);
    const now = Date.now();

    switch (circuit.state) {
      case 'closed':
        return true;

      case 'open':
        // Check if reset timeout has passed
        if (now - circuit.lastStateChange >= this.config.resetTimeoutMs) {
          this.transitionTo(service, 'half_open');
          return true;
        }
        return false;

      case 'half_open':
        // Allow limited calls in half-open state
        return circuit.halfOpenCallCount < this.config.halfOpenMaxCalls;

      default:
        return true;
    }
  }

  recordSuccess(service: string): void {
    if (!this.config.enabled) return;

    const circuit = this.getOrCreateCircuit(service);

    circuit.successes++;

    if (circuit.state === 'half_open') {
      circuit.halfOpenCallCount++;
      // Transition to closed after successful calls in half-open
      if (circuit.successes >= this.config.halfOpenMaxCalls) {
        this.transitionTo(service, 'closed');
      }
    } else if (circuit.state === 'closed') {
      // Reset failure count on success
      circuit.failures = 0;
    }
  }

  recordFailure(service: string): void {
    if (!this.config.enabled) return;

    const circuit = this.getOrCreateCircuit(service);

    circuit.failures++;
    circuit.lastFailureTime = Date.now();

    if (circuit.state === 'half_open') {
      // Any failure in half-open goes back to open
      this.transitionTo(service, 'open');
    } else if (circuit.state === 'closed') {
      // Check if threshold exceeded
      if (circuit.failures >= this.config.failureThreshold) {
        this.transitionTo(service, 'open');
      }
    }
  }

  getState(service: string): CircuitBreakerState | undefined {
    return this.circuits.get(service);
  }

  getAllStates(): Map<string, CircuitBreakerState> {
    return new Map(this.circuits);
  }

  forceOpen(service: string): void {
    this.transitionTo(service, 'open');
  }

  forceClose(service: string): void {
    this.transitionTo(service, 'closed');
  }

  private getOrCreateCircuit(service: string): CircuitBreakerState {
    let circuit = this.circuits.get(service);
    if (!circuit) {
      circuit = this.createInitialState();
      this.circuits.set(service, circuit);
    }
    return circuit;
  }

  private transitionTo(service: string, newState: CircuitState): void {
    const circuit = this.getOrCreateCircuit(service);
    circuit.state = newState;
    circuit.lastStateChange = Date.now();

    if (newState === 'closed') {
      circuit.failures = 0;
      circuit.successes = 0;
      circuit.halfOpenCallCount = 0;
    } else if (newState === 'half_open') {
      circuit.halfOpenCallCount = 0;
      circuit.successes = 0;
    }
  }
}

// ============================================================================
// Audit Trail Implementation
// ============================================================================

class AuditTrail {
  private entries: AuditEntry[] = [];
  private config: AuditConfig;
  private maxEntriesInMemory = 10000;

  constructor(config: AuditConfig) {
    this.config = config;
  }

  record(
    eventType: AuditEventType,
    details: Record<string, unknown>,
    options?: {
      principalId?: string;
      resourceId?: string;
      actionType?: EnforcerActionType;
      correlationId?: string;
      metadata?: Record<string, unknown>;
    }
  ): AuditEntry {
    const entry: AuditEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date(),
      eventType,
      details,
      principalId: options?.principalId,
      resourceId: options?.resourceId,
      actionType: options?.actionType,
      correlationId: options?.correlationId,
      metadata: this.config.includeMetadata ? options?.metadata : undefined,
    };

    if (this.config.enabled) {
      this.entries.push(entry);

      // Trim old entries if over capacity
      if (this.entries.length > this.maxEntriesInMemory) {
        this.entries = this.entries.slice(-this.maxEntriesInMemory);
      }
    }

    return entry;
  }

  query(options: {
    eventType?: AuditEventType;
    principalId?: string;
    resourceId?: string;
    actionType?: EnforcerActionType;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
  }): AuditEntry[] {
    let results = [...this.entries];

    if (options.eventType) {
      results = results.filter(e => e.eventType === options.eventType);
    }
    if (options.principalId) {
      results = results.filter(e => e.principalId === options.principalId);
    }
    if (options.resourceId) {
      results = results.filter(e => e.resourceId === options.resourceId);
    }
    if (options.actionType) {
      results = results.filter(e => e.actionType === options.actionType);
    }
    if (options.fromDate) {
      results = results.filter(e => e.timestamp >= options.fromDate!);
    }
    if (options.toDate) {
      results = results.filter(e => e.timestamp <= options.toDate!);
    }

    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  getRecentEntries(count: number = 100): AuditEntry[] {
    return this.entries.slice(-count).reverse();
  }

  getEntriesForPrincipal(principalId: string, limit: number = 50): AuditEntry[] {
    return this.query({ principalId, limit });
  }

  getStats(): {
    totalEntries: number;
    byEventType: Record<string, number>;
    byActionType: Record<string, number>;
  } {
    const byEventType: Record<string, number> = {};
    const byActionType: Record<string, number> = {};

    for (const entry of this.entries) {
      byEventType[entry.eventType] = (byEventType[entry.eventType] || 0) + 1;
      if (entry.actionType) {
        byActionType[entry.actionType] = (byActionType[entry.actionType] || 0) + 1;
      }
    }

    return {
      totalEntries: this.entries.length,
      byEventType,
      byActionType,
    };
  }

  clear(): void {
    this.entries = [];
  }

  exportEntries(): AuditEntry[] {
    return [...this.entries];
  }
}

// ============================================================================
// Main EnforcerAgent Class
// ============================================================================

export class EnforcerAgent extends BaseAgent {
  private store: DecisionStore;
  private eventBus: EventBus;
  private enforcerConfig: EnforcerConfig;

  // In-memory enforcement state
  private rateLimits: Map<string, RateLimitEntry> = new Map();
  private blocks: Map<string, BlockEntry> = new Map();
  private pendingActions: Map<string, EnforcerAction> = new Map();
  private actionsThisHour: number = 0;
  private lastHourReset: Date = new Date();

  // Enhanced features
  private decisionCache: DecisionCache;
  private rateLimiter: RateLimiter;
  private circuitBreaker: CircuitBreaker;
  private auditTrail: AuditTrail;

  // Degradation state
  private degradationMode: DegradationMode | null = null;
  private isHealthy: boolean = true;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  /** Get last hour reset time for testing */
  getLastHourReset(): Date {
    return this.lastHourReset;
  }

  constructor(
    config: AgentConfig,
    store: DecisionStore,
    eventBus: EventBus,
  ) {
    super('enforcer', 'ENFORCER - Action Execution', config);
    this.store = store;
    this.eventBus = eventBus;

    // Initialize base config
    this.enforcerConfig = {
      autoEnforceEnabled: config.enforcer?.autoEnforceEnabled ?? false,
      requireApprovalForSeverity: config.enforcer?.requireApprovalForSeverity ?? 'high',
      maxActionsPerHour: config.enforcer?.maxActionsPerHour ?? 100,
      rollbackWindowMinutes: config.enforcer?.rollbackWindowMinutes ?? 60,
      // Enhanced defaults
      cache: {
        enabled: true,
        defaultTtlMs: 60000, // 1 minute
        maxEntries: 10000,
        cleanupIntervalMs: 30000, // 30 seconds
        ...(config.enforcer as EnforcerConfig | undefined)?.cache,
      },
      rateLimiting: {
        enabled: true,
        defaultWindowMs: 60000, // 1 minute window
        defaultMaxRequests: 100,
        ...(config.enforcer as EnforcerConfig | undefined)?.rateLimiting,
      },
      circuitBreaker: {
        enabled: true,
        failureThreshold: 5,
        resetTimeoutMs: 30000, // 30 seconds
        halfOpenMaxCalls: 3,
        monitoredServices: ['webhook', 'mfa', 'session', 'quarantine'],
        ...(config.enforcer as EnforcerConfig | undefined)?.circuitBreaker,
      },
      degradation: {
        enabled: true,
        fallbackMode: 'cached_only',
        healthCheckIntervalMs: 10000, // 10 seconds
        ...(config.enforcer as EnforcerConfig | undefined)?.degradation,
      },
      audit: {
        enabled: true,
        retentionDays: 30,
        includeMetadata: true,
        asyncWrite: true,
        ...(config.enforcer as EnforcerConfig | undefined)?.audit,
      },
    };

    // Initialize enhanced features
    this.decisionCache = new DecisionCache(this.enforcerConfig.cache!);
    this.rateLimiter = new RateLimiter(this.enforcerConfig.rateLimiting!);
    this.circuitBreaker = new CircuitBreaker(this.enforcerConfig.circuitBreaker!);
    this.auditTrail = new AuditTrail(this.enforcerConfig.audit!);
  }

  async initialize(): Promise<void> {
    this.state = 'initializing';
    this.log('info', 'Initializing ENFORCER agent with enhanced features');

    // Subscribe to anomaly events from GUARDIAN
    this.eventBus.subscribe('anomaly_detected', async (event) => {
      await this.handleAnomalyDetected(event);
    });

    // Start cleanup job
    this.startCleanupJob();

    // Start hourly rate reset
    this.startHourlyReset();

    // Start cache cleanup
    this.decisionCache.start();

    // Start health check if degradation is enabled
    if (this.enforcerConfig.degradation?.enabled) {
      this.startHealthCheck();
    }

    this.auditTrail.record('action_executed', {
      action: 'agent_initialized',
      features: {
        cache: this.enforcerConfig.cache?.enabled,
        rateLimiting: this.enforcerConfig.rateLimiting?.enabled,
        circuitBreaker: this.enforcerConfig.circuitBreaker?.enabled,
        degradation: this.enforcerConfig.degradation?.enabled,
        audit: this.enforcerConfig.audit?.enabled,
      },
    });

    this.state = 'ready';
    this.log('info', 'ENFORCER agent ready with enhanced features');
  }

  async shutdown(): Promise<void> {
    this.state = 'shutdown';
    this.log('info', 'ENFORCER agent shutting down');

    // Stop timers
    this.decisionCache.stop();
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    this.auditTrail.record('action_executed', { action: 'agent_shutdown' });
  }

  // ==========================================================================
  // Enhanced isAllowed with caching and rate limiting
  // ==========================================================================

  /**
   * Check if a principal is allowed to proceed
   * Returns false if rate limited or blocked
   * Enhanced with caching and per-resource rate limiting
   */
  isAllowed(
    principalId: string,
    options?: { resourceKind?: string; resourceId?: string; skipCache?: boolean }
  ): { allowed: boolean; reason?: string; cached?: boolean } {
    const key: PrincipalResourceKey = {
      principalId,
      resourceKind: options?.resourceKind,
      resourceId: options?.resourceId,
    };

    // Check degradation mode first
    if (this.degradationMode) {
      return this.handleDegradedCheck(key);
    }

    // Check cache first (unless skipCache is true)
    if (!options?.skipCache) {
      const cached = this.decisionCache.get(key);
      if (cached) {
        this.auditTrail.record('decision_cache_hit', { principalId, ...options });
        return { ...cached, cached: true };
      }
      this.auditTrail.record('decision_cache_miss', { principalId, ...options });
    }

    // Check blocks
    const block = this.blocks.get(principalId);
    if (block && block.blockedUntil > new Date()) {
      const result = { allowed: false, reason: `Blocked: ${block.reason}` };
      this.decisionCache.set(key, result, this.getBlockTtl(block.blockedUntil));
      return result;
    }

    // Check rate limits (legacy enforcer rate limits)
    const rateLimit = this.rateLimits.get(principalId);
    if (rateLimit && rateLimit.limitUntil > new Date()) {
      const result = { allowed: false, reason: `Rate limited: ${rateLimit.reason}` };
      this.decisionCache.set(key, result, this.getBlockTtl(rateLimit.limitUntil));
      return result;
    }

    // Check per-resource rate limiting
    const rateLimitCheck = this.rateLimiter.check(key);
    if (!rateLimitCheck.allowed) {
      this.auditTrail.record('rate_limit_exceeded', {
        principalId,
        resourceKind: options?.resourceKind,
        resourceId: options?.resourceId,
        resetAt: rateLimitCheck.resetAt,
      }, { principalId });

      const result = {
        allowed: false,
        reason: `Rate limit exceeded. Resets at ${rateLimitCheck.resetAt.toISOString()}`,
      };
      this.decisionCache.set(key, result, rateLimitCheck.resetAt.getTime() - Date.now());
      return result;
    }

    // Allowed - increment rate limiter and cache result
    this.rateLimiter.increment(key);
    const result = { allowed: true };
    this.decisionCache.set(key, result);

    this.auditTrail.record('decision_cached', {
      principalId,
      allowed: true,
      ...options,
    }, { principalId });

    return result;
  }

  /**
   * Check with a specific action/resource context
   */
  isActionAllowed(
    principalId: string,
    resourceKind: string,
    resourceId: string,
    action: string
  ): { allowed: boolean; reason?: string; cached?: boolean } {
    return this.isAllowed(principalId, { resourceKind, resourceId: `${resourceId}:${action}` });
  }

  private handleDegradedCheck(key: PrincipalResourceKey): { allowed: boolean; reason?: string; cached?: boolean } {
    switch (this.degradationMode) {
      case 'allow_all':
        return { allowed: true, reason: 'Degraded mode: allowing all' };
      case 'deny_all':
        return { allowed: false, reason: 'Degraded mode: denying all' };
      case 'cached_only':
        const cached = this.decisionCache.get(key);
        if (cached) {
          return { ...cached, cached: true };
        }
        return { allowed: false, reason: 'Degraded mode: no cached decision available' };
      case 'rate_limited':
        const rateLimitCheck = this.rateLimiter.check(key);
        if (!rateLimitCheck.allowed) {
          return { allowed: false, reason: 'Degraded mode: rate limit exceeded' };
        }
        this.rateLimiter.increment(key);
        return { allowed: true };
      default:
        return { allowed: true };
    }
  }

  private getBlockTtl(blockedUntil: Date): number {
    return Math.max(0, blockedUntil.getTime() - Date.now());
  }

  // ==========================================================================
  // Circuit Breaker Methods
  // ==========================================================================

  /**
   * Check if a downstream service call can be made
   */
  canCallService(service: string): boolean {
    return this.circuitBreaker.canExecute(service);
  }

  /**
   * Record successful service call
   */
  recordServiceSuccess(service: string): void {
    const previousState = this.circuitBreaker.getState(service)?.state;
    this.circuitBreaker.recordSuccess(service);
    const newState = this.circuitBreaker.getState(service)?.state;

    if (previousState !== newState) {
      this.auditTrail.record(
        newState === 'closed' ? 'circuit_closed' : 'circuit_half_open',
        { service, previousState, newState }
      );
    }
  }

  /**
   * Record failed service call
   */
  recordServiceFailure(service: string): void {
    const previousState = this.circuitBreaker.getState(service)?.state;
    this.circuitBreaker.recordFailure(service);
    const newState = this.circuitBreaker.getState(service)?.state;

    if (previousState !== newState && newState === 'open') {
      this.auditTrail.record('circuit_opened', {
        service,
        previousState,
        failureThreshold: this.enforcerConfig.circuitBreaker?.failureThreshold,
      });

      this.emitAgentEvent('action_failed', {
        type: 'circuit_breaker_opened',
        service,
        message: `Circuit breaker opened for service: ${service}`,
      });
    }
  }

  /**
   * Get circuit breaker status for all services
   */
  getCircuitBreakerStatus(): Record<string, { state: CircuitState; failures: number }> {
    const result: Record<string, { state: CircuitState; failures: number }> = {};
    for (const [service, state] of this.circuitBreaker.getAllStates()) {
      result[service] = { state: state.state, failures: state.failures };
    }
    return result;
  }

  // ==========================================================================
  // Degradation Mode Methods
  // ==========================================================================

  /**
   * Activate degradation mode
   */
  activateDegradation(mode: DegradationMode, reason: string): void {
    this.degradationMode = mode;
    this.isHealthy = false;

    this.auditTrail.record('degradation_activated', {
      mode,
      reason,
      timestamp: new Date(),
    });

    this.emitAgentEvent('action_triggered', {
      type: 'degradation_activated',
      mode,
      reason,
    });

    this.log('warn', `Degradation mode activated: ${mode}. Reason: ${reason}`);
  }

  /**
   * Deactivate degradation mode
   */
  deactivateDegradation(): void {
    const previousMode = this.degradationMode;
    this.degradationMode = null;
    this.isHealthy = true;

    this.auditTrail.record('degradation_deactivated', {
      previousMode,
      timestamp: new Date(),
    });

    this.log('info', 'Degradation mode deactivated');
  }

  /**
   * Get current degradation status
   */
  getDegradationStatus(): { active: boolean; mode: DegradationMode | null; healthy: boolean } {
    return {
      active: this.degradationMode !== null,
      mode: this.degradationMode,
      healthy: this.isHealthy,
    };
  }

  // ==========================================================================
  // Audit Trail Methods
  // ==========================================================================

  /**
   * Get audit trail entries
   */
  getAuditTrail(options?: {
    eventType?: AuditEventType;
    principalId?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
  }): AuditEntry[] {
    return this.auditTrail.query(options || {});
  }

  /**
   * Get audit statistics
   */
  getAuditStats(): ReturnType<AuditTrail['getStats']> {
    return this.auditTrail.getStats();
  }

  /**
   * Export full audit trail
   */
  exportAuditTrail(): AuditEntry[] {
    return this.auditTrail.exportEntries();
  }

  // ==========================================================================
  // Cache Management Methods
  // ==========================================================================

  /**
   * Get cache statistics
   */
  getCacheStats(): ReturnType<DecisionCache['getStats']> {
    return this.decisionCache.getStats();
  }

  /**
   * Invalidate cache for a principal
   */
  invalidateCacheForPrincipal(principalId: string): number {
    const count = this.decisionCache.invalidateByPrincipal(principalId);
    this.auditTrail.record('decision_cache_miss', {
      action: 'cache_invalidated',
      principalId,
      entriesRemoved: count,
    });
    return count;
  }

  /**
   * Clear entire cache
   */
  clearCache(): void {
    this.decisionCache.clear();
    this.auditTrail.record('decision_cache_miss', {
      action: 'cache_cleared',
    });
  }

  // ==========================================================================
  // Rate Limiter Management Methods
  // ==========================================================================

  /**
   * Get rate limit status for a principal/resource
   */
  getRateLimitStatus(
    principalId: string,
    resourceKind?: string
  ): { allowed: boolean; remaining: number; resetAt: Date } {
    return this.rateLimiter.check({ principalId, resourceKind });
  }

  /**
   * Reset rate limit for a principal
   */
  resetRateLimitForPrincipal(principalId: string): number {
    const count = this.rateLimiter.resetByPrincipal(principalId);
    this.auditTrail.record('rate_limit_applied', {
      action: 'rate_limit_reset',
      principalId,
      limitsReset: count,
    });
    return count;
  }

  // ==========================================================================
  // Original Action Methods (Enhanced)
  // ==========================================================================

  /**
   * Manually trigger an enforcement action
   */
  async triggerAction(
    actionType: EnforcerActionType,
    principalId: string,
    reason: string,
    metadata?: Record<string, unknown>,
  ): Promise<EnforcerAction> {
    const action = this.createAction(actionType, principalId, reason, metadata);

    this.auditTrail.record('action_executed', {
      actionType,
      principalId,
      reason,
      actionId: action.id,
    }, {
      principalId,
      actionType,
      correlationId: action.id,
    });

    return this.executeAction(action);
  }

  /**
   * Approve a pending action
   */
  async approveAction(actionId: string, approvedBy: string): Promise<EnforcerAction | null> {
    const action = this.pendingActions.get(actionId);
    if (!action) return null;

    this.log('info', `Action ${actionId} approved by ${approvedBy}`);
    this.pendingActions.delete(actionId);

    this.auditTrail.record('approval_granted', {
      actionId,
      approvedBy,
      actionType: action.type,
    }, {
      actionType: action.type,
      correlationId: actionId,
    });

    return this.executeAction(action);
  }

  /**
   * Reject a pending action
   */
  rejectAction(actionId: string, rejectedBy: string, reason?: string): boolean {
    const action = this.pendingActions.get(actionId);
    if (!action) return false;

    action.status = 'cancelled';
    this.pendingActions.delete(actionId);

    this.log('info', `Action ${actionId} rejected by ${rejectedBy}: ${reason}`);

    this.auditTrail.record('approval_rejected', {
      actionId,
      rejectedBy,
      reason,
      actionType: action.type,
    }, {
      actionType: action.type,
      correlationId: actionId,
    });

    return true;
  }

  /**
   * Rollback an action
   */
  async rollbackAction(actionId: string): Promise<boolean> {
    // Find the action in our records
    const action = Array.from(this.pendingActions.values()).find(a => a.id === actionId);

    if (!action || !action.canRollback) {
      return false;
    }

    const principalId = (action.triggeredBy.relatedIds[0] || '').split(':')[1];
    if (!principalId) return false;

    // Remove rate limits and blocks
    this.rateLimits.delete(principalId);
    this.blocks.delete(principalId);

    // Invalidate cache for this principal
    this.decisionCache.invalidateByPrincipal(principalId);

    // Reset per-resource rate limits
    this.rateLimiter.resetByPrincipal(principalId);

    action.rolledBackAt = new Date();

    this.auditTrail.record('action_rolled_back', {
      actionId,
      principalId,
      actionType: action.type,
    }, {
      principalId,
      actionType: action.type,
      correlationId: actionId,
    });

    this.emitAgentEvent('action_rolled_back', { actionId, principalId });

    this.log('info', `Action ${actionId} rolled back`);
    return true;
  }

  /**
   * Get all pending actions
   */
  getPendingActions(): EnforcerAction[] {
    return Array.from(this.pendingActions.values());
  }

  /**
   * Get current rate limits
   */
  getRateLimits(): RateLimitEntry[] {
    return Array.from(this.rateLimits.values());
  }

  /**
   * Get current blocks
   */
  getBlocks(): BlockEntry[] {
    return Array.from(this.blocks.values());
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async handleAnomalyDetected(event: AgentEvent): Promise<void> {
    const anomaly = event.payload as Anomaly;

    // Determine appropriate action based on severity
    const actionType = this.determineActionType(anomaly);
    if (!actionType) return;

    const action = this.createAction(
      actionType,
      anomaly.principalId,
      anomaly.description,
      { anomalyId: anomaly.id, anomalyType: anomaly.type },
    );

    // Check if auto-enforce is enabled and severity allows it
    const severityLevels: Priority[] = ['low', 'medium', 'high', 'critical'];
    const anomalySeverityIndex = severityLevels.indexOf(anomaly.severity);
    const requireApprovalIndex = severityLevels.indexOf(this.enforcerConfig.requireApprovalForSeverity);

    if (this.enforcerConfig.autoEnforceEnabled && anomalySeverityIndex < requireApprovalIndex) {
      await this.executeAction(action);
    } else {
      // Queue for approval
      this.pendingActions.set(action.id, action);
      this.log('info', `Action ${action.id} queued for approval: ${actionType}`);

      this.auditTrail.record('approval_requested', {
        actionId: action.id,
        actionType,
        anomalyId: anomaly.id,
        severity: anomaly.severity,
      }, {
        principalId: anomaly.principalId,
        actionType,
        correlationId: action.id,
      });

      // Send alert
      await this.sendAlert(action, anomaly);
    }
  }

  private determineActionType(anomaly: Anomaly): EnforcerActionType | null {
    switch (anomaly.severity) {
      case 'critical':
        return 'temporary_block';
      case 'high':
        return anomaly.type === 'permission_escalation' ? 'require_mfa' : 'rate_limit';
      case 'medium':
        return 'rate_limit';
      case 'low':
        return 'alert_admin';
      default:
        return null;
    }
  }

  private createAction(
    type: EnforcerActionType,
    principalId: string,
    reason: string,
    metadata?: Record<string, unknown>,
  ): EnforcerAction {
    const action: EnforcerAction = {
      id: `action-${Date.now()}-${Math.random().toString(36).substring(2)}`,
      triggeredAt: new Date(),
      type,
      priority: this.getPriorityForActionType(type),
      triggeredBy: {
        agentType: 'enforcer',
        reason,
        relatedIds: [`principal:${principalId}`, ...(metadata?.anomalyId ? [`anomaly:${metadata.anomalyId}`] : [])],
      },
      status: 'pending',
      canRollback: type !== 'alert_admin' && type !== 'escalate_review',
    };

    return action;
  }

  private async executeAction(action: EnforcerAction): Promise<EnforcerAction> {
    const startTime = Date.now();
    this.state = 'processing';

    // Check rate limit for actions
    if (!this.canExecuteAction()) {
      action.status = 'failed';
      action.result = {
        success: false,
        message: 'Hourly action limit exceeded',
        affectedEntities: [],
      };

      this.auditTrail.record('action_failed', {
        actionId: action.id,
        reason: 'hourly_limit_exceeded',
      }, {
        actionType: action.type,
        correlationId: action.id,
      });

      return action;
    }

    try {
      const principalId = action.triggeredBy.relatedIds
        .find(id => id.startsWith('principal:'))
        ?.split(':')[1];

      if (!principalId) {
        throw new Error('No principal ID in action');
      }

      let result: EnforcerActionResult;

      // Check circuit breaker for service-dependent actions
      const serviceMap: Record<EnforcerActionType, string | null> = {
        rate_limit: null,
        temporary_block: null,
        require_mfa: 'mfa',
        alert_admin: 'webhook',
        revoke_session: 'session',
        quarantine_resource: 'quarantine',
        escalate_review: 'webhook',
      };

      const service = serviceMap[action.type];
      if (service && !this.canCallService(service)) {
        result = {
          success: false,
          message: `Circuit breaker open for service: ${service}`,
          affectedEntities: [principalId],
        };
        action.status = 'failed';
        action.result = result;

        this.auditTrail.record('action_failed', {
          actionId: action.id,
          reason: 'circuit_breaker_open',
          service,
        }, {
          principalId,
          actionType: action.type,
          correlationId: action.id,
        });

        return action;
      }

      switch (action.type) {
        case 'rate_limit':
          result = this.applyRateLimit(principalId, action);
          break;
        case 'temporary_block':
          result = this.applyBlock(principalId, action);
          break;
        case 'require_mfa':
          result = await this.requestMfa(principalId, action);
          break;
        case 'alert_admin':
          result = await this.alertAdmin(principalId, action);
          break;
        case 'revoke_session':
          result = await this.revokeSession(principalId, action);
          break;
        case 'quarantine_resource':
          result = await this.quarantineResource(principalId, action);
          break;
        case 'escalate_review':
          result = await this.escalateReview(principalId, action);
          break;
        default:
          result = { success: false, message: 'Unknown action type', affectedEntities: [] };
      }

      action.status = result.success ? 'completed' : 'failed';
      action.executedAt = new Date();
      action.result = result;

      // Store action
      await this.store.storeAction(action);

      // Emit event
      this.emitAgentEvent(
        result.success ? 'action_completed' : 'action_failed',
        action,
      );

      // Record service success/failure for circuit breaker
      if (service) {
        if (result.success) {
          this.recordServiceSuccess(service);
        } else {
          this.recordServiceFailure(service);
        }
      }

      this.actionsThisHour++;
      this.recordProcessing(Date.now() - startTime, result.success);
      this.incrementCustomMetric(`actions_${action.type}`);

      this.auditTrail.record(
        result.success ? 'action_executed' : 'action_failed',
        {
          actionId: action.id,
          actionType: action.type,
          principalId,
          result: result.message,
          duration: Date.now() - startTime,
        },
        {
          principalId,
          actionType: action.type,
          correlationId: action.id,
        }
      );

    } catch (error) {
      action.status = 'failed';
      action.result = {
        success: false,
        message: (error as Error).message,
        affectedEntities: [],
      };

      this.emitAgentEvent('action_failed', { action, error: (error as Error).message });
      this.recordProcessing(Date.now() - startTime, false);
      this.recordError(error as Error);

      this.auditTrail.record('action_failed', {
        actionId: action.id,
        actionType: action.type,
        error: (error as Error).message,
      }, {
        actionType: action.type,
        correlationId: action.id,
      });
    }

    this.state = 'ready';
    return action;
  }

  private applyRateLimit(principalId: string, action: EnforcerAction): EnforcerActionResult {
    const limitUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    this.rateLimits.set(principalId, {
      principalId,
      limitUntil,
      reason: action.triggeredBy.reason,
      actionId: action.id,
    });

    // Invalidate cache for this principal
    this.decisionCache.invalidateByPrincipal(principalId);

    this.log('info', `Rate limit applied to ${principalId} until ${limitUntil.toISOString()}`);

    this.auditTrail.record('rate_limit_applied', {
      principalId,
      limitUntil: limitUntil.toISOString(),
      reason: action.triggeredBy.reason,
    }, {
      principalId,
      actionType: 'rate_limit',
      correlationId: action.id,
    });

    return {
      success: true,
      message: `Rate limit applied until ${limitUntil.toISOString()}`,
      affectedEntities: [principalId],
      metadata: { limitUntil },
    };
  }

  private applyBlock(principalId: string, action: EnforcerAction): EnforcerActionResult {
    const blockedUntil = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    this.blocks.set(principalId, {
      principalId,
      blockedUntil,
      reason: action.triggeredBy.reason,
      actionId: action.id,
    });

    // Invalidate cache for this principal
    this.decisionCache.invalidateByPrincipal(principalId);

    this.log('warn', `Temporary block applied to ${principalId} until ${blockedUntil.toISOString()}`);

    this.auditTrail.record('block_applied', {
      principalId,
      blockedUntil: blockedUntil.toISOString(),
      reason: action.triggeredBy.reason,
    }, {
      principalId,
      actionType: 'temporary_block',
      correlationId: action.id,
    });

    return {
      success: true,
      message: `Temporarily blocked until ${blockedUntil.toISOString()}`,
      affectedEntities: [principalId],
      metadata: { blockedUntil },
    };
  }

  private async requestMfa(principalId: string, action: EnforcerAction): Promise<EnforcerActionResult> {
    // In real implementation, this would trigger MFA via the auth system
    this.log('info', `MFA requested for ${principalId}`);

    // For now, apply rate limit until MFA is completed
    this.rateLimits.set(principalId, {
      principalId,
      limitUntil: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
      reason: 'MFA required',
      actionId: action.id,
    });

    // Invalidate cache
    this.decisionCache.invalidateByPrincipal(principalId);

    return {
      success: true,
      message: 'MFA challenge triggered',
      affectedEntities: [principalId],
    };
  }

  private async alertAdmin(principalId: string, action: EnforcerAction): Promise<EnforcerActionResult> {
    // Send webhook notification
    if (this.enforcerConfig.webhookUrl) {
      try {
        await fetch(this.enforcerConfig.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'security_alert',
            principalId,
            reason: action.triggeredBy.reason,
            timestamp: new Date().toISOString(),
            actionId: action.id,
          }),
        });
      } catch (error) {
        this.log('error', 'Failed to send webhook alert', error);
        throw error; // Let circuit breaker handle this
      }
    }

    this.log('warn', `Admin alert sent for ${principalId}: ${action.triggeredBy.reason}`);

    return {
      success: true,
      message: 'Admin alert sent',
      affectedEntities: [principalId],
    };
  }

  private async revokeSession(principalId: string, _action: EnforcerAction): Promise<EnforcerActionResult> {
    // In real implementation, this would revoke sessions via the auth system
    this.log('warn', `Session revocation requested for ${principalId}`);

    // Invalidate cache
    this.decisionCache.invalidateByPrincipal(principalId);

    return {
      success: true,
      message: 'Session revocation request sent',
      affectedEntities: [principalId],
    };
  }

  private async quarantineResource(principalId: string, action: EnforcerAction): Promise<EnforcerActionResult> {
    // In real implementation, this would mark resources as quarantined
    const resourceId = action.triggeredBy.relatedIds.find(id => id.startsWith('resource:'));

    this.log('warn', `Resource quarantine requested: ${resourceId}`);

    return {
      success: true,
      message: 'Resource quarantine request sent',
      affectedEntities: [principalId, resourceId].filter(Boolean) as string[],
    };
  }

  private async escalateReview(principalId: string, _action: EnforcerAction): Promise<EnforcerActionResult> {
    // Create escalation ticket
    this.log('warn', `Escalating for human review: ${principalId}`);

    return {
      success: true,
      message: 'Escalated to human review',
      affectedEntities: [principalId],
    };
  }

  private async sendAlert(action: EnforcerAction, anomaly: Anomaly): Promise<void> {
    if (this.enforcerConfig.webhookUrl) {
      try {
        await fetch(this.enforcerConfig.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'action_pending_approval',
            action,
            anomaly,
            timestamp: new Date().toISOString(),
          }),
        });
      } catch (error) {
        this.log('error', 'Failed to send approval alert', error);
      }
    }
  }

  private canExecuteAction(): boolean {
    return this.actionsThisHour < this.enforcerConfig.maxActionsPerHour;
  }

  private getPriorityForActionType(type: EnforcerActionType): Priority {
    const priorities: Record<EnforcerActionType, Priority> = {
      rate_limit: 'medium',
      temporary_block: 'high',
      require_mfa: 'high',
      alert_admin: 'low',
      revoke_session: 'critical',
      quarantine_resource: 'critical',
      escalate_review: 'medium',
    };
    return priorities[type] || 'medium';
  }

  private startCleanupJob(): void {
    // Clean expired rate limits and blocks every minute
    setInterval(() => {
      const now = new Date();

      for (const [principalId, entry] of this.rateLimits) {
        if (entry.limitUntil <= now) {
          this.rateLimits.delete(principalId);
          this.log('debug', `Rate limit expired for ${principalId}`);

          this.auditTrail.record('block_lifted', {
            principalId,
            type: 'rate_limit',
          }, { principalId });
        }
      }

      for (const [principalId, entry] of this.blocks) {
        if (entry.blockedUntil <= now) {
          this.blocks.delete(principalId);
          this.log('debug', `Block expired for ${principalId}`);

          this.auditTrail.record('block_lifted', {
            principalId,
            type: 'block',
          }, { principalId });
        }
      }
    }, 60 * 1000);
  }

  private startHourlyReset(): void {
    setInterval(() => {
      this.actionsThisHour = 0;
      this.lastHourReset = new Date();
    }, 60 * 60 * 1000);
  }

  private startHealthCheck(): void {
    const config = this.enforcerConfig.degradation!;

    this.healthCheckTimer = setInterval(() => {
      // Check circuit breaker states
      const circuits = this.circuitBreaker.getAllStates();
      let openCircuits = 0;

      for (const [, state] of circuits) {
        if (state.state === 'open') {
          openCircuits++;
        }
      }

      // If more than half of circuits are open, activate degradation
      const totalCircuits = circuits.size || 1;
      if (openCircuits > totalCircuits / 2 && !this.degradationMode) {
        this.activateDegradation(config.fallbackMode, 'Multiple circuit breakers open');
      } else if (openCircuits === 0 && this.degradationMode) {
        this.deactivateDegradation();
      }
    }, config.healthCheckIntervalMs);
  }
}
