/**
 * Storage Layer Types
 *
 * Defines interfaces for policy persistence backends.
 * Implementations: Redis, PostgreSQL, In-Memory, File-based
 */

import type { Policy, DerivedRolesPolicy, PrincipalPolicy } from '../types/policy.types.js';

// =============================================================================
// Storage Configuration
// =============================================================================

export interface StorageConfig {
  /** Storage backend type */
  type: 'memory' | 'redis' | 'postgresql' | 'file';

  /** Connection string or path */
  connectionString?: string;

  /** Connection pool size */
  poolSize?: number;

  /** Connection timeout in ms */
  connectionTimeoutMs?: number;

  /** Query timeout in ms */
  queryTimeoutMs?: number;

  /** Enable connection retry */
  retryEnabled?: boolean;

  /** Max retry attempts */
  maxRetries?: number;

  /** Retry delay in ms */
  retryDelayMs?: number;

  /** Enable SSL/TLS */
  ssl?: boolean | {
    rejectUnauthorized?: boolean;
    ca?: string;
    cert?: string;
    key?: string;
  };
}

export interface RedisConfig extends StorageConfig {
  type: 'redis';
  /** Redis host */
  host?: string;
  /** Redis port */
  port?: number;
  /** Redis password */
  password?: string;
  /** Redis database number */
  db?: number;
  /** Key prefix for namespacing */
  keyPrefix?: string;
  /** Enable cluster mode */
  cluster?: boolean;
  /** Cluster nodes */
  clusterNodes?: Array<{ host: string; port: number }>;
  /** Sentinel configuration */
  sentinel?: {
    masterName: string;
    sentinels: Array<{ host: string; port: number }>;
  };
}

export interface PostgresConfig extends StorageConfig {
  type: 'postgresql';
  /** Database host */
  host?: string;
  /** Database port */
  port?: number;
  /** Database name */
  database?: string;
  /** Database user */
  user?: string;
  /** Database password */
  password?: string;
  /** Schema name */
  schema?: string;
  /** Run migrations on connect */
  autoMigrate?: boolean;
}

// =============================================================================
// Policy Storage Types
// =============================================================================

export type AnyPolicy = Policy | DerivedRolesPolicy | PrincipalPolicy;

export interface StoredPolicy {
  /** Unique policy identifier */
  id: string;

  /** Policy kind (ResourcePolicy, DerivedRoles, PrincipalPolicy) */
  kind: string;

  /** Policy name from metadata */
  name: string;

  /** Policy version */
  version: string;

  /** Full policy content */
  policy: AnyPolicy;

  /** Policy hash for change detection */
  hash: string;

  /** Whether policy is disabled */
  disabled: boolean;

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;

  /** Policy source (file path, API, etc.) */
  source?: string;

  /** Policy labels/tags */
  labels?: Record<string, string>;
}

export interface PolicyQuery {
  /** Filter by policy kind */
  kind?: string | string[];

  /** Filter by policy name pattern (supports wildcards) */
  namePattern?: string;

  /** Filter by resource type */
  resourceType?: string;

  /** Filter by labels */
  labels?: Record<string, string>;

  /** Include disabled policies */
  includeDisabled?: boolean;

  /** Pagination offset */
  offset?: number;

  /** Pagination limit */
  limit?: number;

  /** Sort field */
  sortBy?: 'name' | 'createdAt' | 'updatedAt';

  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
}

export interface PolicyQueryResult {
  /** Matching policies */
  policies: StoredPolicy[];

  /** Total count (for pagination) */
  total: number;

  /** Whether more results exist */
  hasMore: boolean;
}

// =============================================================================
// Storage Interface
// =============================================================================

export interface IPolicyStore {
  /**
   * Initialize the storage backend
   */
  initialize(): Promise<void>;

  /**
   * Close connections and cleanup
   */
  close(): Promise<void>;

  /**
   * Check if storage is healthy
   */
  health(): Promise<{ healthy: boolean; latencyMs: number; details?: Record<string, unknown> }>;

  /**
   * Store a policy
   */
  put(policy: AnyPolicy, options?: { source?: string; labels?: Record<string, string> }): Promise<StoredPolicy>;

  /**
   * Get a policy by ID
   */
  get(id: string): Promise<StoredPolicy | null>;

  /**
   * Get a policy by name and kind
   */
  getByName(name: string, kind: string): Promise<StoredPolicy | null>;

  /**
   * Query policies
   */
  query(query: PolicyQuery): Promise<PolicyQueryResult>;

  /**
   * Delete a policy
   */
  delete(id: string): Promise<boolean>;

  /**
   * Disable a policy (soft delete)
   */
  disable(id: string): Promise<boolean>;

  /**
   * Enable a disabled policy
   */
  enable(id: string): Promise<boolean>;

  /**
   * Get all policies for a resource type
   */
  getPoliciesForResource(resourceType: string): Promise<StoredPolicy[]>;

  /**
   * Get all derived roles
   */
  getDerivedRoles(): Promise<StoredPolicy[]>;

  /**
   * Get principal policy by principal ID
   */
  getPrincipalPolicy(principalId: string): Promise<StoredPolicy | null>;

  /**
   * Bulk import policies
   */
  bulkPut(policies: AnyPolicy[], options?: { source?: string }): Promise<{ imported: number; failed: number; errors: string[] }>;

  /**
   * Watch for policy changes (for hot reload)
   */
  watch(callback: (event: PolicyChangeEvent) => void): () => void;
}

// =============================================================================
// Change Events
// =============================================================================

export type PolicyChangeEventType = 'created' | 'updated' | 'deleted' | 'disabled' | 'enabled';

export interface PolicyChangeEvent {
  type: PolicyChangeEventType;
  policyId: string;
  policyName: string;
  policyKind: string;
  timestamp: Date;
  previousHash?: string;
  newHash?: string;
}

// Aliased exports for explicit import from storage module
export type { PolicyChangeEvent as StoragePolicyChangeEvent };
export type { PolicyChangeEventType as StoragePolicyChangeEventType };

// =============================================================================
// Cache Types
// =============================================================================

export interface CacheConfig {
  /** Cache backend type */
  type: 'memory' | 'redis';

  /** Maximum cache entries */
  maxSize?: number;

  /** Default TTL in ms */
  defaultTtlMs?: number;

  /** Enable statistics tracking */
  enableStats?: boolean;

  /** Redis-specific config */
  redis?: RedisConfig;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  evictions: number;
}

// Aliased export for explicit import from storage module
export type { CacheStats as StorageCacheStats };

export interface ICache<T> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
  has(key: string): Promise<boolean>;
  stats(): CacheStats;
}
