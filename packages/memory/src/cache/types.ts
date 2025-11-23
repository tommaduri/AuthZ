/**
 * Cache Types for LRU caching of hot decisions
 */

export interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  createdAt: Date;
  accessedAt: Date;
  accessCount: number;
  ttl?: number;
  expiresAt?: Date;
}

export interface CacheConfig {
  maxSize: number;
  defaultTtl?: number;
  onEvict?: (key: string, value: unknown) => void;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  hitRate: number;
  evictions: number;
}

export interface Cache<T = unknown> {
  /**
   * Get a value from the cache
   */
  get(key: string): T | undefined;

  /**
   * Set a value in the cache with optional TTL
   */
  set(key: string, value: T, ttl?: number): void;

  /**
   * Check if key exists in cache
   */
  has(key: string): boolean;

  /**
   * Delete a key from the cache
   */
  delete(key: string): boolean;

  /**
   * Clear all entries
   */
  clear(): void;

  /**
   * Get current size
   */
  size(): number;

  /**
   * Get cache statistics
   */
  stats(): CacheStats;

  /**
   * Get all keys
   */
  keys(): string[];
}

/**
 * LRU-specific cache interface
 */
export interface LRUCache<T = unknown> extends Cache<T> {
  /**
   * Peek at a value without updating recency
   */
  peek(key: string): T | undefined;

  /**
   * Get the least recently used key
   */
  getLRU(): string | undefined;

  /**
   * Get the most recently used key
   */
  getMRU(): string | undefined;
}
