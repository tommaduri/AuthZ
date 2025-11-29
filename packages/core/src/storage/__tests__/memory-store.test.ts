/**
 * Memory Policy Store Tests
 *
 * Comprehensive test suite for the in-memory policy store implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryPolicyStore } from '../memory-store.js';
import type { AnyPolicy, PolicyChangeEvent } from '../types.js';

describe('MemoryPolicyStore', () => {
  let store: MemoryPolicyStore;

  beforeEach(async () => {
    store = new MemoryPolicyStore();
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  // ==========================================================================
  // Policy Fixtures
  // ==========================================================================

  const createResourcePolicy = (name: string, resource: string): AnyPolicy => ({
    kind: 'ResourcePolicy',
    apiVersion: 'authz.engine/v1',
    metadata: {
      name,
      version: '1.0.0',
      labels: { env: 'test' },
    },
    spec: {
      resource,
      version: '1.0.0',
      rules: [
        {
          actions: ['read'],
          effect: 'ALLOW',
          roles: ['viewer'],
        },
      ],
    },
  } as unknown as AnyPolicy);

  const createDerivedRoles = (name: string): AnyPolicy => ({
    kind: 'DerivedRoles',
    apiVersion: 'authz.engine/v1',
    metadata: { name, version: '1.0.0' },
    spec: {
      definitions: [
        {
          name: 'owner',
          parentRoles: ['user'],
          condition: { expression: 'R.attr.ownerId == P.id' },
        },
      ],
    },
  } as unknown as AnyPolicy);

  const createPrincipalPolicy = (principalId: string): AnyPolicy => ({
    kind: 'PrincipalPolicy',
    apiVersion: 'authz.engine/v1',
    metadata: { name: principalId, version: '1.0.0' },
    spec: {
      principal: principalId,
      version: '1.0.0',
      rules: [
        {
          resource: '*',
          actions: [{ action: 'admin:*', effect: 'ALLOW' }],
        },
      ],
    },
  } as unknown as AnyPolicy);

  // ==========================================================================
  // Initialization Tests
  // ==========================================================================

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      const newStore = new MemoryPolicyStore();
      await newStore.initialize();
      const health = await newStore.health();
      expect(health.healthy).toBe(true);
      expect(health.details?.type).toBe('memory');
      await newStore.close();
    });

    it('should report unhealthy when not initialized', async () => {
      const newStore = new MemoryPolicyStore();
      const health = await newStore.health();
      expect(health.healthy).toBe(false);
    });

    it('should throw on operations before initialization', async () => {
      const newStore = new MemoryPolicyStore();
      await expect(newStore.get('test')).rejects.toThrow('not initialized');
    });
  });

  // ==========================================================================
  // Put/Get Tests
  // ==========================================================================

  describe('put and get', () => {
    it('should store and retrieve a policy', async () => {
      const policy = createResourcePolicy('document-access', 'document');
      const stored = await store.put(policy);

      expect(stored.id).toBe('ResourcePolicy:document-access');
      expect(stored.name).toBe('document-access');
      expect(stored.kind).toBe('ResourcePolicy');
      expect(stored.hash).toHaveLength(16);
      expect(stored.disabled).toBe(false);
      expect(stored.createdAt).toBeInstanceOf(Date);
      expect(stored.updatedAt).toBeInstanceOf(Date);

      const retrieved = await store.get(stored.id);
      expect(retrieved).toEqual(stored);
    });

    it('should update existing policy', async () => {
      const policy = createResourcePolicy('document-access', 'document');
      const stored1 = await store.put(policy);
      const createdAt = stored1.createdAt;

      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      const updated = await store.put({
        ...policy,
        spec: { ...policy.spec as Record<string, unknown>, version: '2' },
      } as AnyPolicy);

      expect(updated.id).toBe(stored1.id);
      expect(updated.createdAt).toEqual(createdAt);
      expect(updated.updatedAt.getTime()).toBeGreaterThan(createdAt.getTime());
    });

    it('should return null for non-existent policy', async () => {
      const result = await store.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should store with labels and source', async () => {
      const policy = createResourcePolicy('doc', 'document');
      const stored = await store.put(policy, {
        source: 'api',
        labels: { team: 'platform' },
      });

      expect(stored.source).toBe('api');
      expect(stored.labels).toEqual({ team: 'platform' });
    });
  });

  // ==========================================================================
  // getByName Tests
  // ==========================================================================

  describe('getByName', () => {
    it('should retrieve policy by name and kind', async () => {
      const policy = createResourcePolicy('my-policy', 'resource');
      await store.put(policy);

      const retrieved = await store.getByName('my-policy', 'ResourcePolicy');
      expect(retrieved?.name).toBe('my-policy');
    });

    it('should return null for wrong kind', async () => {
      const policy = createResourcePolicy('my-policy', 'resource');
      await store.put(policy);

      const retrieved = await store.getByName('my-policy', 'DerivedRoles');
      expect(retrieved).toBeNull();
    });
  });

  // ==========================================================================
  // Query Tests
  // ==========================================================================

  describe('query', () => {
    beforeEach(async () => {
      // Add test policies
      await store.put(createResourcePolicy('doc-policy', 'document'));
      await store.put(createResourcePolicy('user-policy', 'user'));
      await store.put(createResourcePolicy('post-policy', 'post'));
      await store.put(createDerivedRoles('common-roles'));
      await store.put(createPrincipalPolicy('admin-user'));
    });

    it('should query by kind', async () => {
      const result = await store.query({ kind: 'ResourcePolicy' });
      expect(result.policies).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it('should query by multiple kinds', async () => {
      const result = await store.query({ kind: ['ResourcePolicy', 'DerivedRoles'] });
      expect(result.policies).toHaveLength(4);
    });

    it('should query by resource type', async () => {
      const result = await store.query({ resourceType: 'document' });
      expect(result.policies).toHaveLength(1);
      expect(result.policies[0].name).toBe('doc-policy');
    });

    it('should query by name pattern', async () => {
      const result = await store.query({ namePattern: '*-policy' });
      expect(result.policies).toHaveLength(3);
    });

    it('should query by labels', async () => {
      const result = await store.query({ labels: { env: 'test' } });
      expect(result.policies).toHaveLength(3);
    });

    it('should paginate results', async () => {
      const page1 = await store.query({ limit: 2, offset: 0 });
      const page2 = await store.query({ limit: 2, offset: 2 });

      expect(page1.policies).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      expect(page2.policies).toHaveLength(2);
    });

    it('should sort by name ascending (default)', async () => {
      const result = await store.query({ kind: 'ResourcePolicy' });
      const names = result.policies.map(p => p.name);
      expect(names).toEqual([...names].sort());
    });

    it('should sort by name descending', async () => {
      const result = await store.query({
        kind: 'ResourcePolicy',
        sortOrder: 'desc',
      });
      const names = result.policies.map(p => p.name);
      expect(names).toEqual([...names].sort().reverse());
    });

    it('should exclude disabled policies by default', async () => {
      await store.disable('ResourcePolicy:doc-policy');
      const result = await store.query({ kind: 'ResourcePolicy' });
      expect(result.policies).toHaveLength(2);
    });

    it('should include disabled policies when requested', async () => {
      await store.disable('ResourcePolicy:doc-policy');
      const result = await store.query({
        kind: 'ResourcePolicy',
        includeDisabled: true,
      });
      expect(result.policies).toHaveLength(3);
    });
  });

  // ==========================================================================
  // Delete Tests
  // ==========================================================================

  describe('delete', () => {
    it('should delete a policy', async () => {
      const policy = createResourcePolicy('to-delete', 'resource');
      const stored = await store.put(policy);

      const deleted = await store.delete(stored.id);
      expect(deleted).toBe(true);

      const retrieved = await store.get(stored.id);
      expect(retrieved).toBeNull();
    });

    it('should return false for non-existent policy', async () => {
      const deleted = await store.delete('nonexistent');
      expect(deleted).toBe(false);
    });

    it('should remove from indexes', async () => {
      const policy = createResourcePolicy('indexed', 'resource');
      await store.put(policy);
      await store.delete('ResourcePolicy:indexed');

      const result = await store.query({ kind: 'ResourcePolicy' });
      expect(result.policies.find(p => p.name === 'indexed')).toBeUndefined();
    });
  });

  // ==========================================================================
  // Disable/Enable Tests
  // ==========================================================================

  describe('disable and enable', () => {
    it('should disable a policy', async () => {
      const policy = createResourcePolicy('to-disable', 'resource');
      const stored = await store.put(policy);

      const result = await store.disable(stored.id);
      expect(result).toBe(true);

      const retrieved = await store.get(stored.id);
      expect(retrieved?.disabled).toBe(true);
    });

    it('should enable a disabled policy', async () => {
      const policy = createResourcePolicy('to-enable', 'resource');
      const stored = await store.put(policy);
      await store.disable(stored.id);

      const result = await store.enable(stored.id);
      expect(result).toBe(true);

      const retrieved = await store.get(stored.id);
      expect(retrieved?.disabled).toBe(false);
    });

    it('should return false when already in target state', async () => {
      const policy = createResourcePolicy('already-enabled', 'resource');
      const stored = await store.put(policy);

      const result = await store.enable(stored.id);
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // Specialized Retrieval Tests
  // ==========================================================================

  describe('specialized retrieval', () => {
    it('should get policies for resource', async () => {
      await store.put(createResourcePolicy('doc1', 'document'));
      await store.put(createResourcePolicy('doc2', 'document'));
      await store.put(createResourcePolicy('user1', 'user'));

      const policies = await store.getPoliciesForResource('document');
      expect(policies).toHaveLength(2);
    });

    it('should get derived roles', async () => {
      await store.put(createDerivedRoles('roles1'));
      await store.put(createDerivedRoles('roles2'));
      await store.put(createResourcePolicy('policy', 'resource'));

      const roles = await store.getDerivedRoles();
      expect(roles).toHaveLength(2);
    });

    it('should get principal policy', async () => {
      await store.put(createPrincipalPolicy('user-123'));

      const policy = await store.getPrincipalPolicy('user-123');
      expect(policy?.name).toBe('user-123');
    });
  });

  // ==========================================================================
  // Bulk Operations Tests
  // ==========================================================================

  describe('bulkPut', () => {
    it('should import multiple policies', async () => {
      const policies = [
        createResourcePolicy('p1', 'r1'),
        createResourcePolicy('p2', 'r2'),
        createResourcePolicy('p3', 'r3'),
      ];

      const result = await store.bulkPut(policies, { source: 'bulk' });

      expect(result.imported).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(store.size).toBe(3);
    });

    it('should handle failures in bulk import', async () => {
      // Fill store to capacity
      const smallStore = new MemoryPolicyStore({ maxPolicies: 2 });
      await smallStore.initialize();

      const policies = [
        createResourcePolicy('p1', 'r1'),
        createResourcePolicy('p2', 'r2'),
        createResourcePolicy('p3', 'r3'),
      ];

      const result = await smallStore.bulkPut(policies);

      expect(result.imported).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);

      await smallStore.close();
    });
  });

  // ==========================================================================
  // Watch Tests
  // ==========================================================================

  describe('watch', () => {
    it('should notify on policy creation', async () => {
      const events: PolicyChangeEvent[] = [];
      const unwatch = store.watch(event => events.push(event));

      await store.put(createResourcePolicy('new-policy', 'resource'));

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('created');
      expect(events[0].policyName).toBe('new-policy');

      unwatch();
    });

    it('should notify on policy update', async () => {
      const policy = createResourcePolicy('existing', 'resource');
      await store.put(policy);

      const events: PolicyChangeEvent[] = [];
      const unwatch = store.watch(event => events.push(event));

      await store.put({ ...policy, metadata: { ...policy.metadata, version: '2.0.0' } } as AnyPolicy);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('updated');
      expect(events[0].previousHash).toBeDefined();
      expect(events[0].newHash).toBeDefined();

      unwatch();
    });

    it('should notify on policy deletion', async () => {
      const policy = createResourcePolicy('to-delete', 'resource');
      const stored = await store.put(policy);

      const events: PolicyChangeEvent[] = [];
      const unwatch = store.watch(event => events.push(event));

      await store.delete(stored.id);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('deleted');

      unwatch();
    });

    it('should notify on disable/enable', async () => {
      const policy = createResourcePolicy('toggle', 'resource');
      const stored = await store.put(policy);

      const events: PolicyChangeEvent[] = [];
      const unwatch = store.watch(event => events.push(event));

      await store.disable(stored.id);
      await store.enable(stored.id);

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('disabled');
      expect(events[1].type).toBe('enabled');

      unwatch();
    });

    it('should stop notifying after unwatch', async () => {
      const events: PolicyChangeEvent[] = [];
      const unwatch = store.watch(event => events.push(event));

      await store.put(createResourcePolicy('p1', 'r1'));
      unwatch();
      await store.put(createResourcePolicy('p2', 'r2'));

      expect(events).toHaveLength(1);
    });

    it('should handle callback errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      store.watch(() => {
        throw new Error('Callback error');
      });

      await store.put(createResourcePolicy('trigger', 'resource'));

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  // ==========================================================================
  // Memory-Specific Methods Tests
  // ==========================================================================

  describe('memory-specific methods', () => {
    it('should clear all policies', async () => {
      await store.put(createResourcePolicy('p1', 'r1'));
      await store.put(createResourcePolicy('p2', 'r2'));
      expect(store.size).toBe(2);

      await store.clear();
      expect(store.size).toBe(0);
    });

    it('should get all policies', async () => {
      await store.put(createResourcePolicy('p1', 'r1'));
      await store.put(createResourcePolicy('p2', 'r2'));

      const all = await store.getAll();
      expect(all).toHaveLength(2);
    });

    it('should export policies', async () => {
      await store.put(createResourcePolicy('p1', 'r1'));
      await store.put(createDerivedRoles('roles'));

      const exported = await store.export();
      expect(exported).toHaveLength(2);
      expect(exported.every(p => 'kind' in p && 'metadata' in p)).toBe(true);
    });

    it('should report size', async () => {
      expect(store.size).toBe(0);
      await store.put(createResourcePolicy('p1', 'r1'));
      expect(store.size).toBe(1);
    });
  });

  // ==========================================================================
  // Capacity Tests
  // ==========================================================================

  describe('capacity', () => {
    it('should enforce max policies limit', async () => {
      const limitedStore = new MemoryPolicyStore({ maxPolicies: 2 });
      await limitedStore.initialize();

      await limitedStore.put(createResourcePolicy('p1', 'r1'));
      await limitedStore.put(createResourcePolicy('p2', 'r2'));

      await expect(
        limitedStore.put(createResourcePolicy('p3', 'r3'))
      ).rejects.toThrow('capacity exceeded');

      await limitedStore.close();
    });
  });
});
