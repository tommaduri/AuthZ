/**
 * Hot-Reload Manager Tests
 *
 * Tests for policy hot-reload functionality.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PolicyHotReloadManager } from '../hot-reload';
import type { ReloadEvent } from '../hot-reload';
import type { DecisionEngine, Policy, DerivedRolesPolicy } from '@authz-engine/core';

// Define local test types that match storage layer
interface PolicyChangeEvent {
  type: 'created' | 'updated' | 'deleted';
  policyId: string;
  policyName: string;
  policyKind: string;
  timestamp: Date;
}

interface PolicyQueryResult {
  policies: StoredPolicy[];
  total: number;
  hasMore: boolean;
  offset: number;
  limit: number;
}

interface StoredPolicy {
  id: string;
  name: string;
  kind: string;
  version: string;
  hash: string;
  policy: Policy | DerivedRolesPolicy;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface IPolicyStore {
  name: string;
  initialize: () => Promise<void>;
  close: () => Promise<void>;
  put: (policy: any) => Promise<void>;
  get: (id: string) => Promise<StoredPolicy | null>;
  delete: (id: string) => Promise<boolean>;
  query: (filter: any) => Promise<PolicyQueryResult>;
  watch: (callback: (event: PolicyChangeEvent) => void) => () => void;
}

// Mock DecisionEngine
const createMockEngine = (): DecisionEngine => ({
  clearPolicies: vi.fn(),
  loadResourcePolicies: vi.fn(),
  loadDerivedRolesPolicies: vi.fn(),
  getStats: vi.fn().mockReturnValue({
    resourcePolicies: 1,
    derivedRolesPolicies: 1,
    resources: ['document'],
  }),
  check: vi.fn(),
} as unknown as DecisionEngine);

// Mock Policy Store
const createMockStore = (): IPolicyStore => {
  const changeCallbacks: Array<(event: PolicyChangeEvent) => void> = [];

  return {
    name: 'mock-store',
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(true),
    query: vi.fn().mockResolvedValue({
      policies: [],
      total: 0,
      hasMore: false,
      offset: 0,
      limit: 100,
    } as PolicyQueryResult),
    watch: vi.fn((callback) => {
      changeCallbacks.push(callback);
      return () => {
        const index = changeCallbacks.indexOf(callback);
        if (index > -1) changeCallbacks.splice(index, 1);
      };
    }),
    // Helper to trigger changes in tests
    _triggerChange: (event: PolicyChangeEvent) => {
      changeCallbacks.forEach(cb => cb(event));
    },
  } as IPolicyStore & { _triggerChange: (event: PolicyChangeEvent) => void };
};

// Sample policies for testing
const sampleResourcePolicy: StoredPolicy = {
  id: 'policy-1',
  name: 'document-access',
  kind: 'ResourcePolicy',
  version: '1.0.0',
  hash: 'abc123',
  policy: {
    kind: 'ResourcePolicy',
    apiVersion: 'authz.engine/v1',
    metadata: { name: 'document-access', version: '1.0.0' },
    spec: {
      resource: 'document',
      rules: [
        { actions: ['read'], effect: 'allow', roles: ['viewer'] },
      ],
    },
  } as Policy,
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const sampleDerivedRoles: StoredPolicy = {
  id: 'roles-1',
  name: 'common-roles',
  kind: 'DerivedRoles',
  version: '1.0.0',
  hash: 'def456',
  policy: {
    kind: 'DerivedRoles',
    apiVersion: 'authz.engine/v1',
    metadata: { name: 'common-roles', version: '1.0.0' },
    spec: {
      definitions: [
        {
          name: 'owner',
          parentRoles: ['user'],
          condition: { expression: 'true' },
        },
      ],
    },
  } as DerivedRolesPolicy,
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('PolicyHotReloadManager', () => {
  let manager: PolicyHotReloadManager;
  let engine: DecisionEngine;
  let store: IPolicyStore & { _triggerChange: (event: PolicyChangeEvent) => void };

  beforeEach(() => {
    vi.useFakeTimers();
    engine = createMockEngine();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store = createMockStore() as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    manager = new PolicyHotReloadManager(engine, store as any, {
      debounceMs: 100,
      maxDebounceMs: 500,
      validateBeforeLoad: true,
      rollbackOnFailure: true,
      logLevel: 'error', // Reduce test noise
    });
  });

  afterEach(() => {
    manager.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should start watching for changes', async () => {
      await manager.start();
      expect(store.watch).toHaveBeenCalled();
    });

    it('should not start when disabled', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const disabledManager = new PolicyHotReloadManager(engine, store as any, {
        enabled: false,
      });

      await disabledManager.start();
      expect(store.watch).not.toHaveBeenCalled();
    });

    it('should capture initial state on start', async () => {
      await manager.start();
      expect(engine.getStats).toHaveBeenCalled();
    });
  });

  describe('change detection', () => {
    it('should detect policy changes', async () => {
      const events: ReloadEvent[] = [];
      manager.onReloadEvent((event) => events.push(event));

      await manager.start();

      store._triggerChange({
        type: 'created',
        policyId: 'policy-1',
        policyName: 'test-policy',
        policyKind: 'ResourcePolicy',
        timestamp: new Date(),
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('policy_changed');
    });

    it('should accumulate pending changes', async () => {
      await manager.start();

      store._triggerChange({
        type: 'created',
        policyId: 'policy-1',
        policyName: 'test-policy-1',
        policyKind: 'ResourcePolicy',
        timestamp: new Date(),
      });

      store._triggerChange({
        type: 'updated',
        policyId: 'policy-2',
        policyName: 'test-policy-2',
        policyKind: 'ResourcePolicy',
        timestamp: new Date(),
      });

      const stats = manager.getStats();
      expect(stats.pendingChanges).toBe(2);
    });
  });

  describe('debouncing', () => {
    it('should debounce rapid changes', async () => {
      (store.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ policies: [sampleResourcePolicy], total: 1, hasMore: false })
        .mockResolvedValueOnce({ policies: [sampleDerivedRoles], total: 1, hasMore: false });

      await manager.start();

      // Trigger multiple rapid changes
      for (let i = 0; i < 5; i++) {
        store._triggerChange({
          type: 'updated',
          policyId: `policy-${i}`,
          policyName: `test-policy-${i}`,
          policyKind: 'ResourcePolicy',
          timestamp: new Date(),
        });
      }

      // Engine should not have reloaded yet
      expect(engine.loadResourcePolicies).not.toHaveBeenCalled();

      // Advance past debounce time
      await vi.advanceTimersByTimeAsync(150);

      // Now should have reloaded
      expect(engine.loadResourcePolicies).toHaveBeenCalledTimes(1);
    });

    it('should force reload at max debounce time', async () => {
      (store.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ policies: [sampleResourcePolicy], total: 1, hasMore: false })
        .mockResolvedValueOnce({ policies: [sampleDerivedRoles], total: 1, hasMore: false });

      await manager.start();

      // Continuously trigger changes within debounce window
      for (let i = 0; i < 10; i++) {
        store._triggerChange({
          type: 'updated',
          policyId: `policy-${i}`,
          policyName: `test-policy-${i}`,
          policyKind: 'ResourcePolicy',
          timestamp: new Date(),
        });
        await vi.advanceTimersByTimeAsync(80); // Less than debounce
      }

      // Should have force reloaded by max debounce time
      expect(engine.loadResourcePolicies).toHaveBeenCalled();
    });
  });

  describe('reload execution', () => {
    it('should fetch and load policies on reload', async () => {
      (store.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ policies: [sampleResourcePolicy], total: 1, hasMore: false })
        .mockResolvedValueOnce({ policies: [sampleDerivedRoles], total: 1, hasMore: false });

      const events: ReloadEvent[] = [];
      manager.onReloadEvent((event) => events.push(event));

      await manager.start();
      await manager.reload();

      expect(engine.clearPolicies).toHaveBeenCalled();
      expect(engine.loadResourcePolicies).toHaveBeenCalledWith([sampleResourcePolicy.policy]);
      expect(engine.loadDerivedRolesPolicies).toHaveBeenCalledWith([sampleDerivedRoles.policy]);

      const completedEvent = events.find(e => e.type === 'reload_completed');
      expect(completedEvent).toBeDefined();
      expect(completedEvent?.policiesLoaded).toBe(2);
    });

    it('should emit reload_started event', async () => {
      (store.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ policies: [], total: 0, hasMore: false })
        .mockResolvedValueOnce({ policies: [], total: 0, hasMore: false });

      const events: ReloadEvent[] = [];
      manager.onReloadEvent((event) => events.push(event));

      await manager.start();
      await manager.reload();

      expect(events.find(e => e.type === 'reload_started')).toBeDefined();
    });

    it('should update stats after successful reload', async () => {
      (store.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ policies: [sampleResourcePolicy], total: 1, hasMore: false })
        .mockResolvedValueOnce({ policies: [sampleDerivedRoles], total: 1, hasMore: false });

      await manager.start();
      await manager.reload();

      const stats = manager.getStats();
      expect(stats.lastReload).toBeDefined();
      expect(stats.reloadCount).toBe(1);
    });

    it('should prevent concurrent reloads', async () => {
      let resolveFirst: () => void;
      const firstQueryPromise = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });

      (store.query as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(async () => {
          await firstQueryPromise;
          return { policies: [], total: 0, hasMore: false };
        })
        .mockResolvedValue({ policies: [], total: 0, hasMore: false });

      await manager.start();

      // Start first reload
      const reload1 = manager.reload();

      // Try to start second reload (should be skipped)
      const reload2 = manager.reload();

      expect(manager.getStats().isReloading).toBe(true);

      // Complete first reload
      resolveFirst!();
      await reload1;
      await reload2;

      // Only one reload should have happened
      expect(store.query).toHaveBeenCalledTimes(2); // One for resource, one for derived
    });
  });

  describe('validation', () => {
    it('should validate policy kind', async () => {
      const invalidPolicy: StoredPolicy = {
        ...sampleResourcePolicy,
        policy: {
          ...sampleResourcePolicy.policy,
          kind: 'InvalidKind' as any,
        } as Policy,
      };

      (store.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ policies: [invalidPolicy], total: 1, hasMore: false })
        .mockResolvedValueOnce({ policies: [], total: 0, hasMore: false });

      const events: ReloadEvent[] = [];
      manager.onReloadEvent((event) => events.push(event));

      await manager.start();
      await manager.reload();

      const failedEvent = events.find(e => e.type === 'reload_failed');
      expect(failedEvent).toBeDefined();
      expect(failedEvent?.error).toContain('Invalid policy kind');
    });

    it('should validate policy has metadata.name', async () => {
      const invalidPolicy: StoredPolicy = {
        ...sampleResourcePolicy,
        policy: {
          ...sampleResourcePolicy.policy,
          metadata: {} as any,
        } as Policy,
      };

      (store.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ policies: [invalidPolicy], total: 1, hasMore: false })
        .mockResolvedValueOnce({ policies: [], total: 0, hasMore: false });

      const events: ReloadEvent[] = [];
      manager.onReloadEvent((event) => events.push(event));

      await manager.start();
      await manager.reload();

      const failedEvent = events.find(e => e.type === 'reload_failed');
      expect(failedEvent).toBeDefined();
      expect(failedEvent?.error).toContain('missing metadata.name');
    });

    it('should skip validation when disabled', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const noValidateManager = new PolicyHotReloadManager(engine, store as any, {
        validateBeforeLoad: false,
        logLevel: 'error',
      });

      const invalidPolicy: StoredPolicy = {
        ...sampleResourcePolicy,
        policy: {
          ...sampleResourcePolicy.policy,
          kind: 'InvalidKind' as any,
        } as Policy,
      };

      (store.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ policies: [invalidPolicy], total: 1, hasMore: false })
        .mockResolvedValueOnce({ policies: [], total: 0, hasMore: false });

      await noValidateManager.start();
      await noValidateManager.reload();

      // Should have attempted to load despite invalid kind
      expect(engine.loadResourcePolicies).toHaveBeenCalled();

      noValidateManager.stop();
    });
  });

  describe('rollback', () => {
    it('should rollback on reload failure when enabled', async () => {
      // First successful reload
      (store.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ policies: [sampleResourcePolicy], total: 1, hasMore: false })
        .mockResolvedValueOnce({ policies: [sampleDerivedRoles], total: 1, hasMore: false });

      await manager.start();
      await manager.reload();

      // Second reload with invalid policy
      const invalidPolicy: StoredPolicy = {
        ...sampleResourcePolicy,
        policy: {
          ...sampleResourcePolicy.policy,
          metadata: {} as any,
        } as Policy,
      };

      (store.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ policies: [invalidPolicy], total: 1, hasMore: false })
        .mockResolvedValueOnce({ policies: [], total: 0, hasMore: false });

      await manager.reload();

      // Should have called loadResourcePolicies twice: once for initial, once for rollback
      expect(engine.loadResourcePolicies).toHaveBeenCalledTimes(2);
    });

    it('should not rollback when disabled', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const noRollbackManager = new PolicyHotReloadManager(engine, store as any, {
        rollbackOnFailure: false,
        logLevel: 'error',
      });

      // Setup first successful reload
      (store.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ policies: [sampleResourcePolicy], total: 1, hasMore: false })
        .mockResolvedValueOnce({ policies: [sampleDerivedRoles], total: 1, hasMore: false });

      await noRollbackManager.start();
      await noRollbackManager.reload();

      // Reset mock
      (engine.loadResourcePolicies as ReturnType<typeof vi.fn>).mockClear();

      // Second reload fails
      const invalidPolicy: StoredPolicy = {
        ...sampleResourcePolicy,
        policy: {
          ...sampleResourcePolicy.policy,
          metadata: {} as any,
        } as Policy,
      };

      (store.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ policies: [invalidPolicy], total: 1, hasMore: false })
        .mockResolvedValueOnce({ policies: [], total: 0, hasMore: false });

      await noRollbackManager.reload();

      // Should not have called loadResourcePolicies (no rollback)
      expect(engine.loadResourcePolicies).not.toHaveBeenCalled();

      noRollbackManager.stop();
    });
  });

  describe('cleanup', () => {
    it('should stop watching on stop()', async () => {
      await manager.start();
      manager.stop();

      const stats = manager.getStats();
      expect(stats.pendingChanges).toBe(0);
    });

    it('should clear pending changes on stop()', async () => {
      await manager.start();

      store._triggerChange({
        type: 'created',
        policyId: 'policy-1',
        policyName: 'test-policy',
        policyKind: 'ResourcePolicy',
        timestamp: new Date(),
      });

      expect(manager.getStats().pendingChanges).toBe(1);

      manager.stop();

      expect(manager.getStats().pendingChanges).toBe(0);
    });
  });

  describe('event handlers', () => {
    it('should allow subscribing to reload events', async () => {
      const handler = vi.fn();
      const unsubscribe = manager.onReloadEvent(handler);

      await manager.start();

      store._triggerChange({
        type: 'created',
        policyId: 'policy-1',
        policyName: 'test-policy',
        policyKind: 'ResourcePolicy',
        timestamp: new Date(),
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'policy_changed' })
      );

      unsubscribe();
    });

    it('should allow unsubscribing from events', async () => {
      const handler = vi.fn();
      const unsubscribe = manager.onReloadEvent(handler);

      await manager.start();
      unsubscribe();

      store._triggerChange({
        type: 'created',
        policyId: 'policy-1',
        policyName: 'test-policy',
        policyKind: 'ResourcePolicy',
        timestamp: new Date(),
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should continue on handler errors', async () => {
      const badHandler = vi.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      const goodHandler = vi.fn();

      manager.onReloadEvent(badHandler);
      manager.onReloadEvent(goodHandler);

      await manager.start();

      store._triggerChange({
        type: 'created',
        policyId: 'policy-1',
        policyName: 'test-policy',
        policyKind: 'ResourcePolicy',
        timestamp: new Date(),
      });

      expect(badHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalled();
    });
  });
});
