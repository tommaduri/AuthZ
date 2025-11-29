/**
 * Rate Limiting Storage Backends
 *
 * Provides storage interfaces and implementations for rate limit state persistence.
 */

import type { RateLimitState } from './types';

// =============================================================================
// Storage Interface
// =============================================================================

/**
 * Abstract storage interface for rate limit state
 */
export interface RateLimitStorage {
  /**
   * Get the current state for a key
   * @param key - The rate limit key
   * @returns The current state or null if not found
   */
  get<T extends RateLimitState>(key: string): Promise<T | null>;

  /**
   * Set the state for a key
   * @param key - The rate limit key
   * @param state - The state to store
   * @param ttlMs - Optional TTL in milliseconds
   */
  set<T extends RateLimitState>(key: string, state: T, ttlMs?: number): Promise<void>;

  /**
   * Delete a key
   * @param key - The rate limit key
   */
  delete(key: string): Promise<void>;

  /**
   * Clear all keys matching a pattern
   * @param pattern - Key pattern to match (e.g., "rate:*")
   */
  clear(pattern?: string): Promise<void>;

  /**
   * Check if storage is connected/ready
   */
  isReady(): boolean;

  /**
   * Close/cleanup storage connections
   */
  close(): Promise<void>;

  /**
   * Get storage statistics
   */
  getStats(): StorageStats;
}

/**
 * Storage statistics
 */
export interface StorageStats {
  type: string;
  keys: number;
  memoryUsage?: number;
  hitRate?: number;
  missRate?: number;
}

// =============================================================================
// In-Memory Storage Implementation
// =============================================================================

interface MemoryEntry<T> {
  value: T;
  expiresAt?: number;
}

/**
 * In-memory storage implementation for rate limiting
 * Suitable for single-instance deployments
 */
export class InMemoryStorage implements RateLimitStorage {
  private store: Map<string, MemoryEntry<RateLimitState>>;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private hits = 0;
  private misses = 0;

  constructor(cleanupIntervalMs: number = 60000) {
    this.store = new Map();

    // Periodic cleanup of expired entries
    if (cleanupIntervalMs > 0) {
      this.cleanupInterval = setInterval(() => {
        this.cleanup();
      }, cleanupIntervalMs);
    }
  }

  async get<T extends RateLimitState>(key: string): Promise<T | null> {
    const entry = this.store.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check expiration
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.value as T;
  }

  async set<T extends RateLimitState>(key: string, state: T, ttlMs?: number): Promise<void> {
    const entry: MemoryEntry<T> = {
      value: state,
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
    };
    this.store.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(pattern?: string): Promise<void> {
    if (!pattern || pattern === '*') {
      this.store.clear();
      return;
    }

    // Convert glob pattern to regex
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        this.store.delete(key);
      }
    }
  }

  isReady(): boolean {
    return true;
  }

  async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }

  getStats(): StorageStats {
    const total = this.hits + this.misses;
    return {
      type: 'memory',
      keys: this.store.size,
      hitRate: total > 0 ? this.hits / total : 0,
      missRate: total > 0 ? this.misses / total : 0,
    };
  }

  /**
   * Remove expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.store.delete(key);
      }
    }
  }
}

// =============================================================================
// Redis Storage Implementation
// =============================================================================

/**
 * Redis storage configuration
 */
export interface RedisStorageConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  connectTimeout?: number;
  commandTimeout?: number;
}

/**
 * Redis client interface (compatible with ioredis/node-redis)
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, duration?: number): Promise<unknown>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  del(key: string | string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  scan(cursor: number, match: string, count: number): Promise<[string, string[]]>;
  quit(): Promise<unknown>;
  ping(): Promise<string>;
  dbsize(): Promise<number>;
}

/**
 * Redis storage adapter for rate limiting
 * Suitable for distributed deployments
 */
export class RedisStorage implements RateLimitStorage {
  private client: RedisClient;
  private keyPrefix: string;
  private ready: boolean = false;
  private hits = 0;
  private misses = 0;

  constructor(client: RedisClient, config: Partial<RedisStorageConfig> = {}) {
    this.client = client;
    this.keyPrefix = config.keyPrefix || 'ratelimit:';
    this.ready = true;
  }

  /**
   * Create a Redis storage instance from configuration
   * Note: Requires external Redis client library (ioredis recommended)
   */
  static async create(_config: RedisStorageConfig): Promise<RedisStorage> {
    // This is a placeholder - actual implementation would use ioredis
    throw new Error(
      'Redis storage requires external Redis client. ' +
        'Install ioredis and pass client instance to constructor.'
    );
  }

  private prefixKey(key: string): string {
    return this.keyPrefix + key;
  }

  async get<T extends RateLimitState>(key: string): Promise<T | null> {
    try {
      const data = await this.client.get(this.prefixKey(key));
      if (!data) {
        this.misses++;
        return null;
      }
      this.hits++;
      return JSON.parse(data) as T;
    } catch {
      this.misses++;
      return null;
    }
  }

  async set<T extends RateLimitState>(key: string, state: T, ttlMs?: number): Promise<void> {
    const prefixedKey = this.prefixKey(key);
    const value = JSON.stringify(state);

    if (ttlMs) {
      const ttlSeconds = Math.ceil(ttlMs / 1000);
      await this.client.setex(prefixedKey, ttlSeconds, value);
    } else {
      await this.client.set(prefixedKey, value);
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.del(this.prefixKey(key));
  }

  async clear(pattern?: string): Promise<void> {
    const searchPattern = this.prefixKey(pattern || '*');

    // Use SCAN for large datasets to avoid blocking
    let cursor = 0;
    do {
      const [nextCursor, keys] = await this.client.scan(cursor, searchPattern, 100);
      cursor = parseInt(nextCursor, 10);

      if (keys.length > 0) {
        await this.client.del(keys);
      }
    } while (cursor !== 0);
  }

  isReady(): boolean {
    return this.ready;
  }

  async close(): Promise<void> {
    this.ready = false;
    await this.client.quit();
  }

  getStats(): StorageStats {
    const total = this.hits + this.misses;
    return {
      type: 'redis',
      keys: -1, // Would require dbsize call
      hitRate: total > 0 ? this.hits / total : 0,
      missRate: total > 0 ? this.misses / total : 0,
    };
  }

  /**
   * Execute a Lua script for atomic operations
   * Useful for sliding window implementation
   */
  async executeScript(_script: string, _keys: string[], _args: string[]): Promise<unknown> {
    // Note: Requires eval support from Redis client
    throw new Error('Lua script execution not implemented');
  }
}

// =============================================================================
// Storage Factory
// =============================================================================

/**
 * Create a storage instance based on configuration
 */
export function createStorage(
  config?: { type: 'memory' | 'redis'; redis?: RedisStorageConfig },
  redisClient?: RedisClient
): RateLimitStorage {
  if (!config || config.type === 'memory') {
    return new InMemoryStorage();
  }

  if (config.type === 'redis') {
    if (!redisClient) {
      throw new Error('Redis client required for redis storage type');
    }
    return new RedisStorage(redisClient, config.redis);
  }

  throw new Error(`Unknown storage type: ${config.type}`);
}

// =============================================================================
// Lua Scripts for Atomic Redis Operations
// =============================================================================

/**
 * Lua script for atomic sliding window rate limiting
 */
export const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

-- Remove expired entries
local cutoff = now - window
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)

-- Count current entries
local count = redis.call('ZCARD', key)

if count < limit then
  -- Add new entry
  redis.call('ZADD', key, now, now .. '-' .. math.random())
  redis.call('PEXPIRE', key, window)
  return {1, limit - count - 1, now + window}
else
  -- Get oldest entry to calculate reset time
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetAt = oldest[2] and (tonumber(oldest[2]) + window) or (now + window)
  return {0, 0, resetAt}
end
`;

/**
 * Lua script for atomic token bucket rate limiting
 */
export const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refillRate = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'lastRefill')
local tokens = tonumber(bucket[1]) or capacity
local lastRefill = tonumber(bucket[2]) or now

-- Calculate token refill
local elapsed = (now - lastRefill) / 1000
local refill = elapsed * refillRate
tokens = math.min(capacity, tokens + refill)

if tokens >= cost then
  -- Consume tokens
  tokens = tokens - cost
  redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', now)
  redis.call('PEXPIRE', key, math.ceil(capacity / refillRate * 1000))
  return {1, tokens, 0}
else
  -- Calculate wait time
  local waitTime = math.ceil((cost - tokens) / refillRate * 1000)
  return {0, tokens, waitTime}
end
`;
