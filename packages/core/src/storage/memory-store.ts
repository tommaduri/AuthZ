/**
 * In-Memory Policy Store
 *
 * Fast in-memory implementation for development, testing, and single-node deployments.
 * Features:
 * - O(1) lookups by ID
 * - Indexed queries by kind, resource type
 * - Change notification support
 * - Optional TTL for cached entries
 */

import { createHash } from 'crypto';
import type {
  IPolicyStore,
  StoredPolicy,
  PolicyQuery,
  PolicyQueryResult,
  AnyPolicy,
  PolicyChangeEvent,
  PolicyChangeEventType,
} from './types.js';

// =============================================================================
// Constants
// =============================================================================

/** Default memory store configuration values */
const MEMORY_STORE_DEFAULTS = {
  MAX_POLICIES: 10000,
  DEFAULT_QUERY_LIMIT: 100,
  DEFAULT_POLICY_VERSION: '1.0.0',
  HASH_SUBSTRING_LENGTH: 16,
} as const;

export interface MemoryStoreConfig {
  /** Maximum number of policies to store */
  maxPolicies?: number;
  /** Enable change tracking */
  trackChanges?: boolean;
}

export class MemoryPolicyStore implements IPolicyStore {
  private policies: Map<string, StoredPolicy> = new Map();
  private kindIndex: Map<string, Set<string>> = new Map();
  private resourceIndex: Map<string, Set<string>> = new Map();
  private nameIndex: Map<string, string> = new Map(); // name:kind -> id
  private changeCallbacks: Set<(event: PolicyChangeEvent) => void> = new Set();
  private config: MemoryStoreConfig;
  private initialized = false;

  constructor(config: MemoryStoreConfig = {}) {
    this.config = {
      maxPolicies: MEMORY_STORE_DEFAULTS.MAX_POLICIES,
      trackChanges: true,
      ...config,
    };
  }

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async close(): Promise<void> {
    this.policies.clear();
    this.kindIndex.clear();
    this.resourceIndex.clear();
    this.nameIndex.clear();
    this.changeCallbacks.clear();
    this.initialized = false;
  }

  async health(): Promise<{ healthy: boolean; latencyMs: number; details?: Record<string, unknown> }> {
    const start = Date.now();
    return {
      healthy: this.initialized,
      latencyMs: Date.now() - start,
      details: {
        type: 'memory',
        policyCount: this.policies.size,
        maxPolicies: this.config.maxPolicies,
      },
    };
  }

  async put(
    policy: AnyPolicy,
    options?: { source?: string; labels?: Record<string, string> }
  ): Promise<StoredPolicy> {
    this.ensureInitialized();

    // Check capacity
    if (this.policies.size >= (this.config.maxPolicies ?? MEMORY_STORE_DEFAULTS.MAX_POLICIES)) {
      throw new Error(`Policy store capacity exceeded (max: ${this.config.maxPolicies})`);
    }

    const id = this.generatePolicyId(policy);
    const existing = this.policies.get(id);
    const hash = this.hashPolicy(policy);
    const now = new Date();

    const stored: StoredPolicy = {
      id,
      kind: policy.kind,
      name: policy.metadata.name,
      version: policy.metadata.version ?? MEMORY_STORE_DEFAULTS.DEFAULT_POLICY_VERSION,
      policy,
      hash,
      disabled: false,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      source: options?.source,
      labels: options?.labels || policy.metadata.labels,
    };

    // Store policy
    this.policies.set(id, stored);

    // Update indexes
    this.updateIndexes(stored);

    // Emit change event
    const eventType: PolicyChangeEventType = existing ? 'updated' : 'created';
    this.emitChange({
      type: eventType,
      policyId: id,
      policyName: stored.name,
      policyKind: stored.kind,
      timestamp: now,
      previousHash: existing?.hash,
      newHash: hash,
    });

    return stored;
  }

  async get(id: string): Promise<StoredPolicy | null> {
    this.ensureInitialized();
    return this.policies.get(id) || null;
  }

  async getByName(name: string, kind: string): Promise<StoredPolicy | null> {
    this.ensureInitialized();
    const id = this.nameIndex.get(`${name}:${kind}`);
    if (!id) return null;
    return this.get(id);
  }

  async query(query: PolicyQuery): Promise<PolicyQueryResult> {
    this.ensureInitialized();

    let candidates: Set<string> | null = null;

    // Filter by kind
    if (query.kind) {
      const kinds = Array.isArray(query.kind) ? query.kind : [query.kind];
      candidates = new Set<string>();

      for (const kind of kinds) {
        const kindSet = this.kindIndex.get(kind);
        if (kindSet) {
          kindSet.forEach(id => candidates!.add(id));
        }
      }
    }

    // Filter by resource type
    if (query.resourceType) {
      const resourceSet = this.resourceIndex.get(query.resourceType);
      if (resourceSet) {
        if (candidates) {
          candidates = new Set([...candidates].filter(id => resourceSet.has(id)));
        } else {
          candidates = new Set(resourceSet);
        }
      } else {
        candidates = new Set();
      }
    }

    // If no index filters, use all policies
    if (!candidates) {
      candidates = new Set(this.policies.keys());
    }

    // Fetch and filter policies
    const policies: StoredPolicy[] = [];

    for (const id of candidates) {
      const policy = this.policies.get(id);
      if (!policy) continue;

      // Apply additional filters
      if (!query.includeDisabled && policy.disabled) continue;

      if (query.namePattern) {
        const pattern = query.namePattern.replace(/\*/g, '.*');
        if (!new RegExp(`^${pattern}$`).test(policy.name)) continue;
      }

      if (query.labels) {
        const matches = Object.entries(query.labels).every(
          ([key, value]) => policy.labels?.[key] === value
        );
        if (!matches) continue;
      }

      policies.push(policy);
    }

    // Sort
    const sortBy = query.sortBy || 'name';
    const sortOrder = query.sortOrder || 'asc';

    policies.sort((a, b) => {
      let aVal: string | Date;
      let bVal: string | Date;

      switch (sortBy) {
        case 'createdAt':
          aVal = a.createdAt;
          bVal = b.createdAt;
          break;
        case 'updatedAt':
          aVal = a.updatedAt;
          bVal = b.updatedAt;
          break;
        default:
          aVal = a.name;
          bVal = b.name;
      }

      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    // Paginate
    const total = policies.length;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? MEMORY_STORE_DEFAULTS.DEFAULT_QUERY_LIMIT;
    const paginated = policies.slice(offset, offset + limit);

    return {
      policies: paginated,
      total,
      hasMore: offset + paginated.length < total,
    };
  }

  async delete(id: string): Promise<boolean> {
    this.ensureInitialized();

    const existing = this.policies.get(id);
    if (!existing) return false;

    // Remove from main store
    this.policies.delete(id);

    // Remove from indexes
    this.removeFromIndexes(existing);

    // Emit change event
    this.emitChange({
      type: 'deleted',
      policyId: id,
      policyName: existing.name,
      policyKind: existing.kind,
      timestamp: new Date(),
    });

    return true;
  }

  async disable(id: string): Promise<boolean> {
    return this.setDisabled(id, true);
  }

  async enable(id: string): Promise<boolean> {
    return this.setDisabled(id, false);
  }

  private setDisabled(id: string, disabled: boolean): boolean {
    this.ensureInitialized();

    const existing = this.policies.get(id);
    if (!existing || existing.disabled === disabled) return false;

    existing.disabled = disabled;
    existing.updatedAt = new Date();

    this.emitChange({
      type: disabled ? 'disabled' : 'enabled',
      policyId: id,
      policyName: existing.name,
      policyKind: existing.kind,
      timestamp: new Date(),
    });

    return true;
  }

  async getPoliciesForResource(resourceType: string): Promise<StoredPolicy[]> {
    const result = await this.query({
      resourceType,
      kind: 'ResourcePolicy',
      includeDisabled: false,
    });
    return result.policies;
  }

  async getDerivedRoles(): Promise<StoredPolicy[]> {
    const result = await this.query({
      kind: 'DerivedRoles',
      includeDisabled: false,
    });
    return result.policies;
  }

  async getPrincipalPolicy(principalId: string): Promise<StoredPolicy | null> {
    return this.getByName(principalId, 'PrincipalPolicy');
  }

  async bulkPut(
    policies: AnyPolicy[],
    options?: { source?: string }
  ): Promise<{ imported: number; failed: number; errors: string[] }> {
    let imported = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const policy of policies) {
      try {
        await this.put(policy, options);
        imported++;
      } catch (error) {
        failed++;
        errors.push(`${policy.metadata.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return { imported, failed, errors };
  }

  watch(callback: (event: PolicyChangeEvent) => void): () => void {
    this.changeCallbacks.add(callback);

    return () => {
      this.changeCallbacks.delete(callback);
    };
  }

  // ==========================================================================
  // Additional Memory-Store Specific Methods
  // ==========================================================================

  /** Clear all policies (useful for testing) */
  async clear(): Promise<void> {
    this.policies.clear();
    this.kindIndex.clear();
    this.resourceIndex.clear();
    this.nameIndex.clear();
  }

  /** Get all policies (no pagination) */
  async getAll(): Promise<StoredPolicy[]> {
    return Array.from(this.policies.values());
  }

  /** Get policy count */
  get size(): number {
    return this.policies.size;
  }

  /** Export all policies for backup/migration */
  async export(): Promise<AnyPolicy[]> {
    return Array.from(this.policies.values()).map(sp => sp.policy);
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('MemoryPolicyStore not initialized. Call initialize() first.');
    }
  }

  private generatePolicyId(policy: AnyPolicy): string {
    return `${policy.kind}:${policy.metadata.name}`;
  }

  private hashPolicy(policy: AnyPolicy): string {
    return createHash('sha256')
      .update(JSON.stringify(policy))
      .digest('hex')
      .substring(0, MEMORY_STORE_DEFAULTS.HASH_SUBSTRING_LENGTH);
  }

  private updateIndexes(stored: StoredPolicy): void {
    // Index by kind
    if (!this.kindIndex.has(stored.kind)) {
      this.kindIndex.set(stored.kind, new Set());
    }
    this.kindIndex.get(stored.kind)!.add(stored.id);

    // Index by name
    this.nameIndex.set(`${stored.name}:${stored.kind}`, stored.id);

    // Index by resource type (for ResourcePolicy)
    if (stored.kind === 'ResourcePolicy' && 'spec' in stored.policy) {
      const resourceType = (stored.policy as { spec: { resource: string } }).spec.resource;
      if (!this.resourceIndex.has(resourceType)) {
        this.resourceIndex.set(resourceType, new Set());
      }
      this.resourceIndex.get(resourceType)!.add(stored.id);
    }
  }

  private removeFromIndexes(stored: StoredPolicy): void {
    // Remove from kind index
    this.kindIndex.get(stored.kind)?.delete(stored.id);

    // Remove from name index
    this.nameIndex.delete(`${stored.name}:${stored.kind}`);

    // Remove from resource index
    if (stored.kind === 'ResourcePolicy' && 'spec' in stored.policy) {
      const resourceType = (stored.policy as { spec: { resource: string } }).spec.resource;
      this.resourceIndex.get(resourceType)?.delete(stored.id);
    }
  }

  private emitChange(event: PolicyChangeEvent): void {
    if (!this.config.trackChanges) return;

    for (const callback of this.changeCallbacks) {
      try {
        callback(event);
      } catch (_error) {
        // Silently ignore callback errors to prevent cascading failures
        // In production, this should use a proper logger
      }
    }
  }
}
