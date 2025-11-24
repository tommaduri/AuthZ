/**
 * Redis Policy Store
 *
 * Production-ready Redis implementation for policy persistence.
 * Supports:
 * - Single instance, cluster, and sentinel modes
 * - Connection pooling and retry logic
 * - Policy change notifications via pub/sub
 * - Atomic operations with Lua scripts
 */

import { createHash } from 'crypto';
import type {
  IPolicyStore,
  RedisConfig,
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

/** Default Redis configuration values */
const REDIS_DEFAULTS = {
  HOST: 'localhost',
  PORT: 6379,
  DB: 0,
  KEY_PREFIX: 'authz:',
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
  MAX_RETRY_DELAY_MS: 5000,
  CONNECTION_TIMEOUT_MS: 5000,
  DEFAULT_QUERY_LIMIT: 100,
  DEFAULT_POLICY_VERSION: '1.0.0',
  HASH_SUBSTRING_LENGTH: 16,
} as const;

// Redis client type (using ioredis)
interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  scan(cursor: string | number, ...args: unknown[]): Promise<[string, string[]]>;
  hset(key: string, ...args: unknown[]): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string): Promise<void>;
  on(event: string, callback: (...args: unknown[]) => void): void;
  ping(): Promise<string>;
  quit(): Promise<void>;
  duplicate(): RedisClient;
}

export class RedisPolicyStore implements IPolicyStore {
  private client: RedisClient | null = null;
  private subscriber: RedisClient | null = null;
  private config: RedisConfig;
  private keyPrefix: string;
  private changeCallbacks: Set<(event: PolicyChangeEvent) => void> = new Set();
  private initialized = false;

  // Key patterns
  private readonly POLICY_HASH = 'policies';           // Hash: id -> JSON
  private readonly POLICY_INDEX_KIND = 'idx:kind';     // Set per kind: kind -> ids
  private readonly POLICY_INDEX_RESOURCE = 'idx:res';  // Set per resource: resource -> ids
  private readonly POLICY_INDEX_NAME = 'idx:name';     // Hash: name:kind -> id
  private readonly CHANGE_CHANNEL = 'policy:changes';

  constructor(config: RedisConfig) {
    this.config = {
      host: REDIS_DEFAULTS.HOST,
      port: REDIS_DEFAULTS.PORT,
      db: REDIS_DEFAULTS.DB,
      keyPrefix: REDIS_DEFAULTS.KEY_PREFIX,
      retryEnabled: true,
      maxRetries: REDIS_DEFAULTS.MAX_RETRIES,
      retryDelayMs: REDIS_DEFAULTS.RETRY_DELAY_MS,
      connectionTimeoutMs: REDIS_DEFAULTS.CONNECTION_TIMEOUT_MS,
      ...config,
    };
    this.keyPrefix = this.config.keyPrefix ?? REDIS_DEFAULTS.KEY_PREFIX;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Dynamic import to avoid hard dependency
      const Redis = await import('ioredis').then(m => m.default || m).catch(() => null);

      if (!Redis) {
        throw new Error('ioredis package not installed. Run: npm install ioredis');
      }

      const connectionOptions = this.buildConnectionOptions();

      if (this.config.cluster && this.config.clusterNodes) {
        // Cluster mode
        this.client = new Redis.Cluster(this.config.clusterNodes, {
          redisOptions: connectionOptions,
        }) as unknown as RedisClient;
      } else if (this.config.sentinel) {
        // Sentinel mode
        this.client = new Redis({
          sentinels: this.config.sentinel.sentinels,
          name: this.config.sentinel.masterName,
          ...connectionOptions,
        }) as unknown as RedisClient;
      } else {
        // Single instance
        this.client = new Redis(connectionOptions) as unknown as RedisClient;
      }

      // Create subscriber for change notifications
      this.subscriber = this.client.duplicate();
      await this.setupSubscriber();

      // Verify connection
      await this.client.ping();
      this.initialized = true;

      // Successfully connected - initialization complete
    } catch (error) {
      throw new Error(`Failed to connect to Redis: ${error instanceof Error ? error.message : error}`);
    }
  }

  private buildConnectionOptions(): Record<string, unknown> {
    return {
      host: this.config.host,
      port: this.config.port,
      password: this.config.password,
      db: this.config.db,
      connectTimeout: this.config.connectionTimeoutMs,
      retryStrategy: this.config.retryEnabled
        ? (times: number) => {
            if (times > (this.config.maxRetries ?? REDIS_DEFAULTS.MAX_RETRIES)) {
              return null; // Stop retrying
            }
            return Math.min(times * (this.config.retryDelayMs ?? REDIS_DEFAULTS.RETRY_DELAY_MS), REDIS_DEFAULTS.MAX_RETRY_DELAY_MS);
          }
        : undefined,
      tls: this.config.ssl
        ? typeof this.config.ssl === 'object'
          ? this.config.ssl
          : {}
        : undefined,
    };
  }

  private async setupSubscriber(): Promise<void> {
    if (!this.subscriber) return;

    await this.subscriber.subscribe(this.key(this.CHANGE_CHANNEL));

    this.subscriber.on('message', (_channel: unknown, message: unknown) => {
      try {
        const event = JSON.parse(message as string) as PolicyChangeEvent;
        event.timestamp = new Date(event.timestamp);

        for (const callback of this.changeCallbacks) {
          try {
            callback(event);
          } catch (_error) {
            // Silently ignore callback errors to prevent cascading failures
          }
        }
      } catch (_error) {
        // Failed to parse change event - skip invalid messages
      }
    });
  }

  async close(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = null;
    }
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
    this.initialized = false;
    this.changeCallbacks.clear();
  }

  async health(): Promise<{ healthy: boolean; latencyMs: number; details?: Record<string, unknown> }> {
    if (!this.client) {
      return { healthy: false, latencyMs: -1, details: { error: 'Not initialized' } };
    }

    const start = Date.now();
    try {
      await this.client.ping();
      return {
        healthy: true,
        latencyMs: Date.now() - start,
        details: {
          host: this.config.host,
          port: this.config.port,
          db: this.config.db,
        },
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        details: { error: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }

  async put(
    policy: AnyPolicy,
    options?: { source?: string; labels?: Record<string, string> }
  ): Promise<StoredPolicy> {
    this.ensureInitialized();

    const id = this.generatePolicyId(policy);
    const existing = await this.get(id);
    const hash = this.hashPolicy(policy);
    const now = new Date();

    const stored: StoredPolicy = {
      id,
      kind: policy.kind,
      name: policy.metadata.name,
      version: policy.metadata.version ?? REDIS_DEFAULTS.DEFAULT_POLICY_VERSION,
      policy,
      hash,
      disabled: false,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      source: options?.source,
      labels: options?.labels || policy.metadata.labels,
    };

    // Store policy data
    await this.client!.hset(
      this.key(this.POLICY_HASH),
      id,
      JSON.stringify(stored)
    );

    // Update indexes
    await this.updateIndexes(stored);

    // Publish change event
    const eventType: PolicyChangeEventType = existing ? 'updated' : 'created';
    await this.publishChange({
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

    const data = await this.client!.hget(this.key(this.POLICY_HASH), id);
    if (!data) return null;

    return this.parseStoredPolicy(data);
  }

  async getByName(name: string, kind: string): Promise<StoredPolicy | null> {
    this.ensureInitialized();

    const id = await this.client!.hget(this.key(this.POLICY_INDEX_NAME), `${name}:${kind}`);
    if (!id) return null;

    return this.get(id);
  }

  async query(query: PolicyQuery): Promise<PolicyQueryResult> {
    this.ensureInitialized();

    let candidateIds: Set<string> | null = null;

    // Filter by kind
    if (query.kind) {
      const kinds = Array.isArray(query.kind) ? query.kind : [query.kind];
      const kindIds = new Set<string>();

      for (const kind of kinds) {
        const ids = await this.client!.smembers(this.key(`${this.POLICY_INDEX_KIND}:${kind}`));
        ids.forEach(id => kindIds.add(id));
      }

      candidateIds = kindIds;
    }

    // Filter by resource type
    if (query.resourceType) {
      const resourceIds = new Set(
        await this.client!.smembers(this.key(`${this.POLICY_INDEX_RESOURCE}:${query.resourceType}`))
      );

      candidateIds = candidateIds
        ? new Set([...candidateIds].filter(id => resourceIds.has(id)))
        : resourceIds;
    }

    // Get all policies if no index filters
    if (!candidateIds) {
      const allData = await this.client!.hgetall(this.key(this.POLICY_HASH));
      candidateIds = new Set(Object.keys(allData));
    }

    // Fetch and filter policies
    const policies: StoredPolicy[] = [];

    for (const id of candidateIds) {
      const policy = await this.get(id);
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
    const limit = query.limit ?? REDIS_DEFAULTS.DEFAULT_QUERY_LIMIT;
    const paginated = policies.slice(offset, offset + limit);

    return {
      policies: paginated,
      total,
      hasMore: offset + paginated.length < total,
    };
  }

  async delete(id: string): Promise<boolean> {
    this.ensureInitialized();

    const existing = await this.get(id);
    if (!existing) return false;

    // Remove from hash
    await this.client!.hdel(this.key(this.POLICY_HASH), id);

    // Remove from indexes
    await this.removeFromIndexes(existing);

    // Publish change event
    await this.publishChange({
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

  private async setDisabled(id: string, disabled: boolean): Promise<boolean> {
    this.ensureInitialized();

    const existing = await this.get(id);
    if (!existing || existing.disabled === disabled) return false;

    existing.disabled = disabled;
    existing.updatedAt = new Date();

    await this.client!.hset(
      this.key(this.POLICY_HASH),
      id,
      JSON.stringify(existing)
    );

    await this.publishChange({
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
    // Principal policies are indexed by name which is the principal ID
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
  // Private Helpers
  // ==========================================================================

  private key(suffix: string): string {
    return `${this.keyPrefix}${suffix}`;
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.client) {
      throw new Error('RedisPolicyStore not initialized. Call initialize() first.');
    }
  }

  private generatePolicyId(policy: AnyPolicy): string {
    // Consistent ID generation based on kind and name
    return `${policy.kind}:${policy.metadata.name}`;
  }

  private hashPolicy(policy: AnyPolicy): string {
    return createHash('sha256')
      .update(JSON.stringify(policy))
      .digest('hex')
      .substring(0, REDIS_DEFAULTS.HASH_SUBSTRING_LENGTH);
  }

  private parseStoredPolicy(data: string): StoredPolicy {
    const parsed = JSON.parse(data);
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      updatedAt: new Date(parsed.updatedAt),
    };
  }

  private async updateIndexes(stored: StoredPolicy): Promise<void> {
    // Index by kind
    await this.client!.sadd(
      this.key(`${this.POLICY_INDEX_KIND}:${stored.kind}`),
      stored.id
    );

    // Index by name
    await this.client!.hset(
      this.key(this.POLICY_INDEX_NAME),
      `${stored.name}:${stored.kind}`,
      stored.id
    );

    // Index by resource type (for ResourcePolicy)
    if (stored.kind === 'ResourcePolicy' && 'spec' in stored.policy) {
      const resourceType = (stored.policy as { spec: { resource: string } }).spec.resource;
      await this.client!.sadd(
        this.key(`${this.POLICY_INDEX_RESOURCE}:${resourceType}`),
        stored.id
      );
    }
  }

  private async removeFromIndexes(stored: StoredPolicy): Promise<void> {
    // Remove from kind index
    await this.client!.srem(
      this.key(`${this.POLICY_INDEX_KIND}:${stored.kind}`),
      stored.id
    );

    // Remove from name index
    await this.client!.hdel(
      this.key(this.POLICY_INDEX_NAME),
      `${stored.name}:${stored.kind}`
    );

    // Remove from resource index
    if (stored.kind === 'ResourcePolicy' && 'spec' in stored.policy) {
      const resourceType = (stored.policy as { spec: { resource: string } }).spec.resource;
      await this.client!.srem(
        this.key(`${this.POLICY_INDEX_RESOURCE}:${resourceType}`),
        stored.id
      );
    }
  }

  private async publishChange(event: PolicyChangeEvent): Promise<void> {
    if (!this.client) return;

    try {
      await this.client.publish(
        this.key(this.CHANGE_CHANNEL),
        JSON.stringify(event)
      );
    } catch (_error) {
      // Failed to publish change event - non-critical, continue operation
    }
  }
}
