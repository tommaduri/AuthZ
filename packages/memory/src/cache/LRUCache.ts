/**
 * LRU Cache Implementation
 * Provides efficient caching for hot authorization decisions
 */

import type { LRUCache, CacheConfig, CacheStats } from './types.js';

/**
 * Doubly-linked list node for O(1) LRU operations
 */
interface CacheNode<T> {
  key: string;
  value: T;
  createdAt: Date;
  accessedAt: Date;
  accessCount: number;
  expiresAt?: Date;
  prev: CacheNode<T> | null;
  next: CacheNode<T> | null;
}

/**
 * LRU Cache with TTL support and statistics tracking
 */
export class LRUCacheImpl<T> implements LRUCache<T> {
  private cache: Map<string, CacheNode<T>> = new Map();
  private head: CacheNode<T> | null = null; // Most recently used
  private tail: CacheNode<T> | null = null; // Least recently used
  private maxSize: number;
  private defaultTtl?: number;
  private onEvict?: (key: string, value: T) => void;

  // Statistics
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(config: CacheConfig) {
    this.maxSize = config.maxSize;
    this.defaultTtl = config.defaultTtl;
    this.onEvict = config.onEvict as ((key: string, value: T) => void) | undefined;
  }

  /**
   * Get a value from the cache, updating recency
   */
  get(key: string): T | undefined {
    const node = this.cache.get(key);

    if (!node) {
      this.misses++;
      return undefined;
    }

    // Check TTL expiration
    if (this.isExpired(node)) {
      this.removeNode(node);
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    // Update access info
    node.accessedAt = new Date();
    node.accessCount++;

    // Move to front (most recently used)
    this.moveToFront(node);

    this.hits++;
    return node.value;
  }

  /**
   * Set a value in the cache with optional TTL
   */
  set(key: string, value: T, ttl?: number): void {
    const existingNode = this.cache.get(key);

    if (existingNode) {
      // Update existing entry
      existingNode.value = value;
      existingNode.accessedAt = new Date();
      existingNode.accessCount++;
      existingNode.expiresAt = this.calculateExpiry(ttl);
      this.moveToFront(existingNode);
      return;
    }

    // Create new entry
    const node: CacheNode<T> = {
      key,
      value,
      createdAt: new Date(),
      accessedAt: new Date(),
      accessCount: 1,
      expiresAt: this.calculateExpiry(ttl),
      prev: null,
      next: null,
    };

    // Evict if at capacity
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    // Add to cache and list
    this.cache.set(key, node);
    this.addToFront(node);
  }

  /**
   * Check if key exists (without updating recency)
   */
  has(key: string): boolean {
    const node = this.cache.get(key);
    if (!node) return false;

    // Check TTL
    if (this.isExpired(node)) {
      this.removeNode(node);
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a key from the cache
   */
  delete(key: string): boolean {
    const node = this.cache.get(key);
    if (!node) return false;

    this.removeNode(node);
    this.cache.delete(key);
    return true;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
  }

  /**
   * Get current cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   */
  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      evictions: this.evictions,
    };
  }

  /**
   * Get all keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Peek at a value without updating recency
   */
  peek(key: string): T | undefined {
    const node = this.cache.get(key);

    if (!node) return undefined;

    // Check TTL expiration
    if (this.isExpired(node)) {
      this.removeNode(node);
      this.cache.delete(key);
      return undefined;
    }

    return node.value;
  }

  /**
   * Get the least recently used key
   */
  getLRU(): string | undefined {
    return this.tail?.key;
  }

  /**
   * Get the most recently used key
   */
  getMRU(): string | undefined {
    return this.head?.key;
  }

  // Private helper methods

  private calculateExpiry(ttl?: number): Date | undefined {
    const effectiveTtl = ttl ?? this.defaultTtl;
    if (!effectiveTtl) return undefined;
    return new Date(Date.now() + effectiveTtl);
  }

  private isExpired(node: CacheNode<T>): boolean {
    if (!node.expiresAt) return false;
    return Date.now() > node.expiresAt.getTime();
  }

  private addToFront(node: CacheNode<T>): void {
    node.next = this.head;
    node.prev = null;

    if (this.head) {
      this.head.prev = node;
    }

    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: CacheNode<T>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }

    node.prev = null;
    node.next = null;
  }

  private moveToFront(node: CacheNode<T>): void {
    if (node === this.head) return;
    this.removeNode(node);
    this.addToFront(node);
  }

  private evictLRU(): void {
    if (!this.tail) return;

    const evicted = this.tail;
    this.removeNode(evicted);
    this.cache.delete(evicted.key);
    this.evictions++;

    if (this.onEvict) {
      this.onEvict(evicted.key, evicted.value);
    }
  }
}
