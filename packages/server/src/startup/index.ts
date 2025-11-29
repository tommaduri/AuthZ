/**
 * Server Startup Integration
 *
 * Provides unified startup logic that integrates:
 * - Policy storage backends (Redis, PostgreSQL, Memory)
 * - Hot-reload from storage
 * - Health checks for all dependencies
 * - Graceful shutdown coordination
 */

import type { DecisionEngine, Policy, DerivedRolesPolicy, ValidatedResourcePolicy, ValidatedDerivedRolesPolicy } from '@authz-engine/core';
import type { Logger } from '../utils/logger';
import { PolicyHotReloadManager, type HotReloadConfig } from '../policy/hot-reload';
import {
  HealthCheckSystem,
  type DependencyCheck,
  CircuitBreaker,
  type CircuitBreakerConfig,
} from '../middleware/production';

// =============================================================================
// Storage Adapter Types (compatible with core storage interfaces)
// =============================================================================

/**
 * Policy change event from storage
 */
export interface PolicyChangeEvent {
  type: 'created' | 'updated' | 'deleted' | 'disabled' | 'enabled';
  policyId: string;
  policyName: string;
  policyKind: string;
  timestamp: Date;
  previousHash?: string;
  newHash?: string;
}

/**
 * Stored policy representation
 */
export interface StoredPolicy {
  id: string;
  kind: string;
  name: string;
  version: string;
  policy: Policy | DerivedRolesPolicy;
  hash: string;
  disabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  source?: string;
  labels?: Record<string, string>;
}

/**
 * Policy query result
 */
export interface PolicyQueryResult {
  policies: StoredPolicy[];
  total: number;
  hasMore: boolean;
}

/**
 * Policy store interface (simplified from core)
 */
export interface IPolicyStore {
  initialize(): Promise<void>;
  close(): Promise<void>;
  health(): Promise<{ healthy: boolean; latencyMs: number; details?: Record<string, unknown> }>;
  query(query: { kind?: string; includeDisabled?: boolean }): Promise<PolicyQueryResult>;
  watch(callback: (event: PolicyChangeEvent) => void): () => void;
  getDerivedRoles(): Promise<StoredPolicy[]>;
  getPoliciesForResource(resourceType: string): Promise<StoredPolicy[]>;
}

// =============================================================================
// Server Startup Configuration
// =============================================================================

export interface ServerStartupConfig {
  /** Enable storage integration */
  storageEnabled: boolean;

  /** Policy store instance (from core) */
  store?: IPolicyStore;

  /** Hot reload configuration */
  hotReload?: HotReloadConfig;

  /** Circuit breaker for storage calls */
  circuitBreaker?: CircuitBreakerConfig;

  /** Logger instance */
  logger: Logger;

  /** Health check system */
  healthSystem?: HealthCheckSystem;

  /** Retry configuration for startup */
  startupRetry?: {
    maxAttempts: number;
    delayMs: number;
    backoffMultiplier: number;
  };
}

// =============================================================================
// Storage Integration Manager
// =============================================================================

export class StorageIntegrationManager {
  private engine: DecisionEngine;
  private config: ServerStartupConfig;
  private hotReloadManager?: PolicyHotReloadManager;
  private circuitBreaker?: CircuitBreaker;
  private logger: Logger;
  private isInitialized = false;

  constructor(engine: DecisionEngine, config: ServerStartupConfig) {
    this.engine = engine;
    this.config = config;
    this.logger = config.logger.child({ component: 'storage-integration' });

    // Initialize circuit breaker if configured
    if (config.circuitBreaker) {
      this.circuitBreaker = new CircuitBreaker(config.circuitBreaker);
    }
  }

  /**
   * Initialize storage integration
   */
  async initialize(): Promise<void> {
    if (!this.config.storageEnabled || !this.config.store) {
      this.logger.info('Storage integration disabled');
      return;
    }

    const store = this.config.store;

    // Initialize store with retry
    const startupRetry = this.config.startupRetry || {
      maxAttempts: 3,
      delayMs: 1000,
      backoffMultiplier: 2,
    };

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= startupRetry.maxAttempts; attempt++) {
      try {
        this.logger.info(`Initializing storage (attempt ${attempt}/${startupRetry.maxAttempts})`);

        if (this.circuitBreaker) {
          await this.circuitBreaker.execute(() => store.initialize());
        } else {
          await store.initialize();
        }

        this.logger.info('Storage initialized successfully');
        break;
      } catch (error) {
        lastError = error as Error;
        this.logger.error(`Storage initialization failed: ${lastError.message}`);

        if (attempt < startupRetry.maxAttempts) {
          const delay = startupRetry.delayMs * Math.pow(startupRetry.backoffMultiplier, attempt - 1);
          this.logger.info(`Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    if (lastError && !this.config.store) {
      throw new Error(`Failed to initialize storage after ${startupRetry.maxAttempts} attempts: ${lastError.message}`);
    }

    // Load policies from store
    await this.loadPoliciesFromStore(store);

    // Setup health check
    if (this.config.healthSystem) {
      this.registerHealthCheck(store);
    }

    // Setup hot reload if enabled
    if (this.config.hotReload?.enabled) {
      await this.setupHotReload(store);
    }

    this.isInitialized = true;
    this.logger.info('Storage integration initialized');
  }

  /**
   * Load all policies from store into engine
   */
  private async loadPoliciesFromStore(store: IPolicyStore): Promise<void> {
    this.logger.info('Loading policies from storage...');

    try {
      // Load resource policies
      const resourcePolicies: ValidatedResourcePolicy[] = [];
      const resourceKinds = ['ResourcePolicy'];

      for (const kind of resourceKinds) {
        const result = await store.query({ kind, includeDisabled: false });
        for (const stored of result.policies) {
          resourcePolicies.push(stored.policy as ValidatedResourcePolicy);
        }
      }

      // Load derived roles
      const derivedRolesResult = await store.getDerivedRoles();
      const derivedRoles: ValidatedDerivedRolesPolicy[] = derivedRolesResult.map(
        (stored) => stored.policy as ValidatedDerivedRolesPolicy
      );

      // Clear existing and load new
      this.engine.clearPolicies();

      if (resourcePolicies.length > 0) {
        this.engine.loadResourcePolicies(resourcePolicies);
      }

      if (derivedRoles.length > 0) {
        this.engine.loadDerivedRolesPolicies(derivedRoles);
      }

      this.logger.info(
        `Loaded ${resourcePolicies.length} resource policies, ${derivedRoles.length} derived roles from storage`
      );
    } catch (error) {
      this.logger.error('Failed to load policies from storage', error);
      throw error;
    }
  }

  /**
   * Register storage health check
   */
  private registerHealthCheck(store: IPolicyStore): void {
    const healthCheck: DependencyCheck = {
      name: 'policy-store',
      critical: true,
      check: async () => {
        const result = await store.health();
        return {
          healthy: result.healthy,
          latencyMs: result.latencyMs,
          details: result.details,
        };
      },
    };

    this.config.healthSystem!.register(healthCheck);
    this.logger.debug('Registered storage health check');
  }

  /**
   * Setup hot reload from storage
   */
  private async setupHotReload(store: IPolicyStore): Promise<void> {
    // Create adapter for hot reload manager
    const storeAdapter = {
      query: async (query: { kind?: string; includeDisabled?: boolean }) => {
        const result = await store.query(query);
        return {
          policies: result.policies.map((p) => ({
            id: p.id,
            policy: p.policy,
            kind: p.kind,
            name: p.name,
            version: p.version,
            enabled: !p.disabled,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          })),
          total: result.total,
          offset: 0,
          limit: result.total,
        };
      },
      watch: (handler: (event: PolicyChangeEvent) => void) => store.watch(handler),
    };

    this.hotReloadManager = new PolicyHotReloadManager(
      this.engine,
      storeAdapter,
      this.config.hotReload
    );

    // Subscribe to reload events
    this.hotReloadManager.onReloadEvent((event) => {
      switch (event.type) {
        case 'reload_started':
          this.logger.info('Policy hot-reload started');
          break;
        case 'reload_completed':
          this.logger.info(`Policy hot-reload completed: ${event.policiesLoaded} policies in ${event.duration}ms`);
          break;
        case 'reload_failed':
          this.logger.error(`Policy hot-reload failed: ${event.error}`);
          break;
        case 'policy_changed':
          this.logger.debug(`Policy changed: ${event.trigger?.type} - ${event.trigger?.policyName}`);
          break;
      }
    });

    await this.hotReloadManager.start();
    this.logger.info('Hot-reload enabled for storage changes');
  }

  /**
   * Shutdown storage integration
   */
  async shutdown(): Promise<void> {
    if (this.hotReloadManager) {
      this.hotReloadManager.stop();
      this.logger.info('Hot-reload stopped');
    }

    if (this.config.store) {
      try {
        await this.config.store.close();
        this.logger.info('Storage connection closed');
      } catch (error) {
        this.logger.error('Error closing storage connection', error);
      }
    }

    this.isInitialized = false;
  }

  /**
   * Get hot reload statistics
   */
  getHotReloadStats(): {
    enabled: boolean;
    lastReload: Date | null;
    reloadCount: number;
    pendingChanges: number;
    isReloading: boolean;
  } | null {
    return this.hotReloadManager?.getStats() ?? null;
  }

  /**
   * Check if storage integration is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Get circuit breaker state
   */
  getCircuitBreakerState(): {
    state: 'closed' | 'open' | 'half-open';
    failureCount: number;
  } | null {
    if (!this.circuitBreaker) return null;
    return {
      state: this.circuitBreaker.getState(),
      failureCount: this.circuitBreaker.getFailureCount(),
    };
  }

  /**
   * Force reload policies from storage
   */
  async forceReload(): Promise<void> {
    if (!this.config.store) {
      throw new Error('Storage not configured');
    }
    await this.loadPoliciesFromStore(this.config.store);
  }
}

// =============================================================================
// Quick Start Helper
// =============================================================================

/**
 * Create a fully configured storage integration from environment
 */
export async function createStorageIntegration(
  engine: DecisionEngine,
  logger: Logger,
  options: {
    healthSystem?: HealthCheckSystem;
    hotReloadEnabled?: boolean;
    circuitBreakerEnabled?: boolean;
  } = {}
): Promise<StorageIntegrationManager | null> {
  const storageType = process.env.AUTHZ_STORAGE_TYPE;

  if (!storageType || storageType === 'none') {
    logger.info('Storage integration disabled (AUTHZ_STORAGE_TYPE not set)');
    return null;
  }

  // Dynamic import to avoid requiring storage dependencies when not used
  let store: IPolicyStore;
  try {
    const coreModule = await import('@authz-engine/core');
    // Handle both named export and default export patterns
    type CoreModule = { createPolicyStoreFromEnv?: () => Promise<IPolicyStore>; default?: { createPolicyStoreFromEnv?: () => Promise<IPolicyStore> } };
    const typedModule = coreModule as CoreModule;
    const createFn = typedModule.createPolicyStoreFromEnv
      || typedModule.default?.createPolicyStoreFromEnv;

    if (!createFn) {
      throw new Error('createPolicyStoreFromEnv not found in @authz-engine/core');
    }

    store = await createFn();
  } catch (error) {
    logger.error('Failed to create policy store from environment', error);
    throw error;
  }

  const manager = new StorageIntegrationManager(engine, {
    storageEnabled: true,
    store,
    logger,
    healthSystem: options.healthSystem,
    hotReload: options.hotReloadEnabled !== false
      ? {
          enabled: true,
          debounceMs: 500,
          maxDebounceMs: 5000,
          validateBeforeLoad: true,
          rollbackOnFailure: true,
          logLevel: 'info',
        }
      : undefined,
    circuitBreaker: options.circuitBreakerEnabled !== false
      ? {
          failureThreshold: 5,
          failureWindow: 60000,
          resetTimeout: 30000,
          requestTimeout: 10000,
        }
      : undefined,
  });

  await manager.initialize();
  return manager;
}

// =============================================================================
// Exports
// =============================================================================

export {
  PolicyHotReloadManager,
  type HotReloadConfig,
  type ReloadEvent,
  type ReloadEventHandler,
} from '../policy/hot-reload';

export {
  HealthCheckSystem,
  type HealthCheckResult,
  type DependencyCheck,
  CircuitBreaker,
  type CircuitBreakerConfig,
  type CircuitState,
} from '../middleware/production';
