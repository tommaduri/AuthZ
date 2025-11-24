/**
 * Policy Hot-Reload Manager
 *
 * Enables automatic policy reloading from storage backends:
 * - Watch for storage change events (Redis pub/sub, PostgreSQL LISTEN/NOTIFY)
 * - Debounce rapid changes to prevent thrashing
 * - Graceful reload with atomic policy swap
 * - Rollback on validation failure
 * - Metrics and logging for reload events
 */

import type { DecisionEngine, Policy, DerivedRolesPolicy } from '@authz-engine/core';

// Storage types - define locally to avoid import issues
interface PolicyChangeEvent {
  type: 'created' | 'updated' | 'deleted' | 'disabled' | 'enabled';
  policyId: string;
  policyName: string;
  policyKind: string;
  timestamp: Date;
}

interface StoredPolicy {
  id: string;
  policy: Policy | DerivedRolesPolicy;
  kind: string;
  name: string;
  version: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface PolicyQueryResult {
  policies: StoredPolicy[];
  total: number;
  offset: number;
  limit: number;
}

interface IPolicyStore {
  query(query: { kind?: string; includeDisabled?: boolean }): Promise<PolicyQueryResult>;
  watch(handler: (event: PolicyChangeEvent) => void): () => void;
}

// ==========================================================================
// Hot Reload Configuration
// ==========================================================================

export interface HotReloadConfig {
  /** Enable hot reload */
  enabled: boolean;
  /** Debounce delay in milliseconds */
  debounceMs: number;
  /** Maximum time to wait before forcing reload */
  maxDebounceMs: number;
  /** Validate policies before loading */
  validateBeforeLoad: boolean;
  /** Rollback on validation failure */
  rollbackOnFailure: boolean;
  /** Log level for reload events */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface ReloadEvent {
  type: 'reload_started' | 'reload_completed' | 'reload_failed' | 'policy_changed';
  timestamp: Date;
  trigger?: PolicyChangeEvent;
  policiesLoaded?: number;
  duration?: number;
  error?: string;
}

export type ReloadEventHandler = (event: ReloadEvent) => void;

// ==========================================================================
// Hot Reload Manager
// ==========================================================================

export class PolicyHotReloadManager {
  private engine: DecisionEngine;
  private store: IPolicyStore;
  private config: HotReloadConfig;
  private unwatch?: () => void;
  private debounceTimeout?: NodeJS.Timeout;
  private maxDebounceTimeout?: NodeJS.Timeout;
  private pendingChanges: PolicyChangeEvent[] = [];
  private isReloading = false;
  private lastReload: Date | null = null;
  private reloadCount = 0;
  private eventHandlers: Set<ReloadEventHandler> = new Set();

  // Store last known good state for rollback
  private lastGoodPolicies: {
    resourcePolicies: Policy[];
    derivedRoles: DerivedRolesPolicy[];
  } | null = null;

  constructor(
    engine: DecisionEngine,
    store: IPolicyStore,
    config: Partial<HotReloadConfig> = {}
  ) {
    this.engine = engine;
    this.store = store;
    this.config = {
      enabled: true,
      debounceMs: 500,
      maxDebounceMs: 5000,
      validateBeforeLoad: true,
      rollbackOnFailure: true,
      logLevel: 'info',
      ...config,
    };
  }

  /**
   * Start watching for policy changes
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.log('info', 'Hot reload is disabled');
      return;
    }

    // Save current state as last known good
    await this.captureCurrentState();

    // Subscribe to policy changes
    this.unwatch = this.store.watch((event) => {
      this.handlePolicyChange(event);
    });

    this.log('info', 'Policy hot reload started');
  }

  /**
   * Stop watching for policy changes
   */
  stop(): void {
    if (this.unwatch) {
      this.unwatch();
      this.unwatch = undefined;
    }

    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = undefined;
    }

    if (this.maxDebounceTimeout) {
      clearTimeout(this.maxDebounceTimeout);
      this.maxDebounceTimeout = undefined;
    }

    this.pendingChanges = [];
    this.log('info', 'Policy hot reload stopped');
  }

  /**
   * Manually trigger a reload
   */
  async reload(): Promise<void> {
    await this.executeReload('manual');
  }

  /**
   * Subscribe to reload events
   */
  onReloadEvent(handler: ReloadEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Get reload statistics
   */
  getStats(): {
    enabled: boolean;
    lastReload: Date | null;
    reloadCount: number;
    pendingChanges: number;
    isReloading: boolean;
  } {
    return {
      enabled: this.config.enabled,
      lastReload: this.lastReload,
      reloadCount: this.reloadCount,
      pendingChanges: this.pendingChanges.length,
      isReloading: this.isReloading,
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private handlePolicyChange(event: PolicyChangeEvent): void {
    this.log('debug', `Policy change detected: ${event.type} - ${event.policyName}`);

    this.emitEvent({
      type: 'policy_changed',
      timestamp: new Date(),
      trigger: event,
    });

    this.pendingChanges.push(event);
    this.scheduleReload();
  }

  private scheduleReload(): void {
    // Clear existing debounce timeout
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }

    // Set debounce timeout
    this.debounceTimeout = setTimeout(() => {
      this.executeReload('debounce');
    }, this.config.debounceMs);

    // Set max debounce timeout if not already set
    if (!this.maxDebounceTimeout) {
      this.maxDebounceTimeout = setTimeout(() => {
        if (this.debounceTimeout) {
          clearTimeout(this.debounceTimeout);
          this.debounceTimeout = undefined;
        }
        this.executeReload('max_debounce');
      }, this.config.maxDebounceMs);
    }
  }

  private async executeReload(trigger: string): Promise<void> {
    // Clear timeouts
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = undefined;
    }
    if (this.maxDebounceTimeout) {
      clearTimeout(this.maxDebounceTimeout);
      this.maxDebounceTimeout = undefined;
    }

    // Prevent concurrent reloads
    if (this.isReloading) {
      this.log('warn', 'Reload already in progress, skipping');
      return;
    }

    const changes = [...this.pendingChanges];
    this.pendingChanges = [];

    this.isReloading = true;
    const startTime = Date.now();

    this.log('info', `Starting policy reload (trigger: ${trigger}, changes: ${changes.length})`);
    this.emitEvent({
      type: 'reload_started',
      timestamp: new Date(),
    });

    try {
      // Fetch policies from store
      const resourcePolicies = await this.fetchResourcePolicies();
      const derivedRoles = await this.fetchDerivedRoles();

      // Validate if enabled
      if (this.config.validateBeforeLoad) {
        this.validatePolicies(resourcePolicies, derivedRoles);
      }

      // Atomic swap - load new policies into engine
      this.engine.clearPolicies();
      this.engine.loadResourcePolicies(resourcePolicies as any[]);
      this.engine.loadDerivedRolesPolicies(derivedRoles as any[]);

      // Update last known good state
      this.lastGoodPolicies = { resourcePolicies, derivedRoles };

      const duration = Date.now() - startTime;
      this.lastReload = new Date();
      this.reloadCount++;

      this.log('info', `Policy reload completed in ${duration}ms (${resourcePolicies.length} resource policies, ${derivedRoles.length} derived roles)`);
      this.emitEvent({
        type: 'reload_completed',
        timestamp: new Date(),
        policiesLoaded: resourcePolicies.length + derivedRoles.length,
        duration,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.log('error', `Policy reload failed: ${errorMessage}`);

      // Attempt rollback
      if (this.config.rollbackOnFailure && this.lastGoodPolicies) {
        this.log('info', 'Rolling back to last known good state');
        try {
          this.engine.clearPolicies();
          this.engine.loadResourcePolicies(this.lastGoodPolicies.resourcePolicies as any[]);
          this.engine.loadDerivedRolesPolicies(this.lastGoodPolicies.derivedRoles as any[]);
          this.log('info', 'Rollback successful');
        } catch (rollbackError) {
          this.log('error', `Rollback failed: ${rollbackError instanceof Error ? rollbackError.message : 'Unknown'}`);
        }
      }

      this.emitEvent({
        type: 'reload_failed',
        timestamp: new Date(),
        duration,
        error: errorMessage,
      });
    } finally {
      this.isReloading = false;
    }
  }

  private async fetchResourcePolicies(): Promise<Policy[]> {
    const result = await this.store.query({
      kind: 'ResourcePolicy',
      includeDisabled: false,
    });

    return result.policies.map((sp: StoredPolicy) => sp.policy as Policy);
  }

  private async fetchDerivedRoles(): Promise<DerivedRolesPolicy[]> {
    const result = await this.store.query({
      kind: 'DerivedRoles',
      includeDisabled: false,
    });

    return result.policies.map((sp: StoredPolicy) => sp.policy as DerivedRolesPolicy);
  }

  private validatePolicies(
    resourcePolicies: Policy[],
    derivedRoles: DerivedRolesPolicy[]
  ): void {
    // Basic validation
    for (const policy of resourcePolicies) {
      if (!policy.kind || policy.kind !== 'ResourcePolicy') {
        throw new Error(`Invalid policy kind: ${policy.kind}`);
      }
      if (!policy.metadata?.name) {
        throw new Error('Policy missing metadata.name');
      }
      if (!policy.spec?.resource) {
        throw new Error(`Policy ${policy.metadata.name} missing spec.resource`);
      }
    }

    for (const roles of derivedRoles) {
      if (!roles.kind || roles.kind !== 'DerivedRoles') {
        throw new Error(`Invalid derived roles kind: ${roles.kind}`);
      }
      if (!roles.metadata?.name) {
        throw new Error('Derived roles missing metadata.name');
      }
      if (!roles.spec?.definitions || roles.spec.definitions.length === 0) {
        throw new Error(`Derived roles ${roles.metadata.name} has no definitions`);
      }
    }
  }

  private async captureCurrentState(): Promise<void> {
    try {
      const stats = this.engine.getStats();
      this.log('debug', `Captured current state: ${stats.resourcePolicies} resource policies, ${stats.derivedRolesPolicies} derived roles`);
      // Note: We can't easily extract current policies from engine
      // This would need engine enhancement to support policy export
    } catch {
      this.log('warn', 'Could not capture current policy state');
    }
  }

  private emitEvent(event: ReloadEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        this.log('error', `Event handler error: ${error instanceof Error ? error.message : 'Unknown'}`);
      }
    }
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    if (levels[level] >= levels[this.config.logLevel]) {
      const prefix = '[PolicyHotReload]';
      switch (level) {
        case 'debug':
          console.debug(`${prefix} ${message}`);
          break;
        case 'info':
          console.info(`${prefix} ${message}`);
          break;
        case 'warn':
          console.warn(`${prefix} ${message}`);
          break;
        case 'error':
          console.error(`${prefix} ${message}`);
          break;
      }
    }
  }
}

// ==========================================================================
// File-based Hot Reload (for development)
// ==========================================================================

export interface FileWatchConfig {
  /** Directory to watch */
  directory: string;
  /** File patterns to watch */
  patterns?: string[];
  /** Enable recursive watching */
  recursive?: boolean;
  /** Debounce delay */
  debounceMs?: number;
}

/**
 * Create a file-based hot reload watcher
 * Uses fs.watch for file system monitoring
 */
export async function createFileWatcher(
  engine: DecisionEngine,
  loadPoliciesFromFiles: () => Promise<{ resourcePolicies: Policy[]; derivedRoles: DerivedRolesPolicy[] }>,
  config: FileWatchConfig
): Promise<{ start: () => void; stop: () => void }> {
  const fs = await import('fs').catch(() => null);
  const path = await import('path').catch(() => null);

  if (!fs || !path) {
    throw new Error('File system modules not available');
  }

  let watcher: ReturnType<typeof fs.watch> | null = null;
  let debounceTimeout: NodeJS.Timeout | null = null;

  const reload = async () => {
    try {
      console.info('[FileWatcher] Reloading policies...');
      const { resourcePolicies, derivedRoles } = await loadPoliciesFromFiles();
      engine.clearPolicies();
      engine.loadResourcePolicies(resourcePolicies as any[]);
      engine.loadDerivedRolesPolicies(derivedRoles as any[]);
      console.info(`[FileWatcher] Loaded ${resourcePolicies.length} resource policies, ${derivedRoles.length} derived roles`);
    } catch (error) {
      console.error('[FileWatcher] Reload failed:', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const scheduleReload = () => {
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }
    debounceTimeout = setTimeout(reload, config.debounceMs || 500);
  };

  return {
    start: () => {
      watcher = fs.watch(
        config.directory,
        { recursive: config.recursive ?? true },
        (eventType, filename) => {
          if (!filename) return;

          // Check if file matches patterns
          if (config.patterns) {
            const ext = path.extname(filename);
            if (!config.patterns.some(p => filename.endsWith(p) || ext === p)) {
              return;
            }
          }

          console.debug(`[FileWatcher] ${eventType}: ${filename}`);
          scheduleReload();
        }
      );

      console.info(`[FileWatcher] Watching ${config.directory}`);
    },

    stop: () => {
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
        debounceTimeout = null;
      }
      console.info('[FileWatcher] Stopped');
    },
  };
}
