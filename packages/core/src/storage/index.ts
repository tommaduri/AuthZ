/**
 * Storage Layer
 *
 * Provides policy persistence with multiple backends:
 * - Memory: Fast, for development and testing
 * - Redis: Distributed caching with pub/sub
 * - PostgreSQL: Durable relational storage
 *
 * Usage:
 * ```typescript
 * import { createPolicyStore, MemoryPolicyStore } from '@authz-engine/core/storage';
 *
 * // Quick memory store
 * const store = new MemoryPolicyStore();
 * await store.initialize();
 *
 * // Or use factory for config-driven setup
 * const store = await createPolicyStore({ type: 'redis', host: 'localhost' });
 * ```
 */

// Types - excluding PolicyChangeEvent and CacheStats to avoid conflicts with audit and cel modules
export type {
  StorageConfig,
  RedisConfig,
  PostgresConfig,
  StoredPolicy,
  PolicyQuery,
  PolicyQueryResult,
  AnyPolicy,
  IPolicyStore,
  CacheConfig,
  ICache,
  // Use explicit aliases for conflicting names
  StoragePolicyChangeEvent,
  StoragePolicyChangeEventType,
  StorageCacheStats,
} from './types.js';

// Implementations
export { MemoryPolicyStore, type MemoryStoreConfig } from './memory-store.js';
export { RedisPolicyStore } from './redis-store.js';
export { PostgresPolicyStore } from './postgres-store.js';

// Factory
import type { StorageConfig, RedisConfig, PostgresConfig, IPolicyStore } from './types.js';
import { MemoryPolicyStore } from './memory-store.js';
import { RedisPolicyStore } from './redis-store.js';
import { PostgresPolicyStore } from './postgres-store.js';

/**
 * Factory function to create a policy store based on configuration.
 *
 * @param config - Storage configuration
 * @returns Initialized policy store
 *
 * @example
 * ```typescript
 * // Memory store (default)
 * const store = await createPolicyStore({ type: 'memory' });
 *
 * // Redis store
 * const store = await createPolicyStore({
 *   type: 'redis',
 *   host: 'localhost',
 *   port: 6379,
 *   password: process.env.REDIS_PASSWORD,
 * });
 *
 * // PostgreSQL store
 * const store = await createPolicyStore({
 *   type: 'postgresql',
 *   connectionString: process.env.DATABASE_URL,
 *   autoMigrate: true,
 * });
 * ```
 */
export async function createPolicyStore(config: StorageConfig): Promise<IPolicyStore> {
  let store: IPolicyStore;

  switch (config.type) {
    case 'memory':
      store = new MemoryPolicyStore();
      break;

    case 'redis':
      store = new RedisPolicyStore(config as RedisConfig);
      break;

    case 'postgresql':
      store = new PostgresPolicyStore(config as PostgresConfig);
      break;

    case 'file':
      // File-based store not yet implemented
      throw new Error('File-based storage not yet implemented. Use memory, redis, or postgresql.');

    default:
      throw new Error(`Unknown storage type: ${(config as StorageConfig).type}`);
  }

  await store.initialize();
  return store;
}

/**
 * Create a policy store from environment variables.
 *
 * Environment variables:
 * - AUTHZ_STORAGE_TYPE: 'memory' | 'redis' | 'postgresql'
 * - AUTHZ_REDIS_HOST, AUTHZ_REDIS_PORT, AUTHZ_REDIS_PASSWORD
 * - AUTHZ_DATABASE_URL, AUTHZ_DATABASE_HOST, etc.
 */
export async function createPolicyStoreFromEnv(): Promise<IPolicyStore> {
  const type = process.env.AUTHZ_STORAGE_TYPE || 'memory';

  switch (type) {
    case 'memory':
      return createPolicyStore({ type: 'memory' });

    case 'redis':
      return createPolicyStore({
        type: 'redis',
        host: process.env.AUTHZ_REDIS_HOST || 'localhost',
        port: parseInt(process.env.AUTHZ_REDIS_PORT || '6379', 10),
        password: process.env.AUTHZ_REDIS_PASSWORD,
        db: parseInt(process.env.AUTHZ_REDIS_DB || '0', 10),
        keyPrefix: process.env.AUTHZ_REDIS_PREFIX || 'authz:',
        ssl: process.env.AUTHZ_REDIS_SSL === 'true',
      } as RedisConfig);

    case 'postgresql':
      return createPolicyStore({
        type: 'postgresql',
        connectionString: process.env.AUTHZ_DATABASE_URL,
        host: process.env.AUTHZ_DATABASE_HOST || 'localhost',
        port: parseInt(process.env.AUTHZ_DATABASE_PORT || '5432', 10),
        database: process.env.AUTHZ_DATABASE_NAME || 'authz',
        user: process.env.AUTHZ_DATABASE_USER || 'postgres',
        password: process.env.AUTHZ_DATABASE_PASSWORD,
        schema: process.env.AUTHZ_DATABASE_SCHEMA || 'authz',
        autoMigrate: process.env.AUTHZ_DATABASE_MIGRATE !== 'false',
        ssl: process.env.AUTHZ_DATABASE_SSL === 'true',
        poolSize: parseInt(process.env.AUTHZ_DATABASE_POOL_SIZE || '10', 10),
      } as PostgresConfig);

    default:
      throw new Error(`Unknown storage type from environment: ${type}`);
  }
}
