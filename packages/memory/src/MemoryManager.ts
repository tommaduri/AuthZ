/**
 * MemoryManager - Unified interface for distributed memory system
 * Coordinates vector store, cache, event store, and CRDT sync
 */

import type { VectorStore, VectorStoreConfig, SearchResult } from './vector-store/types.js';
import type { LRUCache, CacheConfig, CacheStats } from './cache/types.js';
import type {
  EventStore,
  EventStoreConfig,
  DomainEvent,
  EventQuery,
  EventHandler,
  UnsubscribeFn,
} from './event-store/types.js';

import { InMemoryVectorStore } from './vector-store/VectorStore.js';
import { LRUCacheImpl } from './cache/LRUCache.js';
import { InMemoryEventStore } from './event-store/EventStore.js';
import { CRDTFactory } from './crdt/CRDTSync.js';

/**
 * Memory Manager configuration
 */
export interface MemoryManagerConfig {
  nodeId: string;
  vector?: VectorStoreConfig;
  cache?: CacheConfig;
  events?: EventStoreConfig;
}

/**
 * Default configurations
 */
const defaultVectorConfig: VectorStoreConfig = {
  dimension: 128,
  maxEntries: 10000,
  similarityMetric: 'cosine',
};

const defaultCacheConfig: CacheConfig = {
  maxSize: 10000,
  defaultTtl: 300000, // 5 minutes
};

const defaultEventConfig: EventStoreConfig = {
  maxEventsPerAggregate: 10000,
};

/**
 * Unified memory interface for authorization system
 */
export class MemoryManager {
  private _nodeId: string;
  private _vectorStore: VectorStore;
  private _cache: LRUCache<unknown>;
  private _eventStore: EventStore;

  constructor(config: MemoryManagerConfig) {
    this._nodeId = config.nodeId;

    // Initialize components
    this._vectorStore = new InMemoryVectorStore(config.vector ?? defaultVectorConfig);
    this._cache = new LRUCacheImpl(config.cache ?? defaultCacheConfig);
    this._eventStore = new InMemoryEventStore(config.events ?? defaultEventConfig);
  }

  /**
   * Get the node ID for this memory manager
   */
  get nodeId(): string {
    return this._nodeId;
  }

  // ============================================
  // Vector Store Operations
  // ============================================

  /**
   * Store a vector embedding for pattern matching
   */
  async storeVector(
    id: string,
    vector: number[],
    metadata: Record<string, unknown>
  ): Promise<void> {
    return this._vectorStore.insert(id, vector, metadata);
  }

  /**
   * Search for similar vectors (authorization patterns)
   */
  async searchSimilar(query: number[], k: number): Promise<SearchResult[]> {
    return this._vectorStore.search(query, k);
  }

  /**
   * Delete a vector by ID
   */
  async deleteVector(id: string): Promise<void> {
    return this._vectorStore.delete(id);
  }

  /**
   * Get vector store size
   */
  vectorCount(): number {
    return this._vectorStore.size();
  }

  // ============================================
  // Cache Operations
  // ============================================

  /**
   * Cache an authorization decision
   */
  cacheDecision<T>(key: string, decision: T, ttl?: number): void {
    this._cache.set(key, decision, ttl);
  }

  /**
   * Get cached authorization decision
   */
  getCachedDecision<T>(key: string): T | undefined {
    return this._cache.get(key) as T | undefined;
  }

  /**
   * Check if decision is cached
   */
  isDecisionCached(key: string): boolean {
    return this._cache.has(key);
  }

  /**
   * Invalidate cached decision
   */
  invalidateDecision(key: string): boolean {
    return this._cache.delete(key);
  }

  /**
   * Get cache statistics
   */
  cacheStats(): CacheStats {
    return this._cache.stats();
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this._cache.clear();
  }

  // ============================================
  // Event Store Operations (Audit Trail)
  // ============================================

  /**
   * Record an authorization event
   */
  async recordEvent<T>(
    event: Omit<DomainEvent<T>, 'id' | 'sequence' | 'timestamp'>
  ): Promise<DomainEvent<T>> {
    return this._eventStore.append(event);
  }

  /**
   * Get events for a principal (audit trail)
   */
  async getAuditTrail(principalId: string, fromVersion?: number): Promise<DomainEvent[]> {
    return this._eventStore.getEvents(principalId, fromVersion);
  }

  /**
   * Query events with filters
   */
  async queryEvents(query: EventQuery): Promise<DomainEvent[]> {
    return this._eventStore.query(query);
  }

  /**
   * Subscribe to authorization events
   */
  subscribeToEvents<T>(handler: EventHandler<T>, eventTypes?: string[]): UnsubscribeFn {
    return this._eventStore.subscribe(handler, eventTypes);
  }

  /**
   * Get event count
   */
  eventCount(): number {
    return this._eventStore.count();
  }

  // ============================================
  // CRDT Factory Methods
  // ============================================

  /**
   * Create a grow-only counter (e.g., for access counts)
   */
  createGCounter() {
    return CRDTFactory.createGCounter(this._nodeId);
  }

  /**
   * Create a positive-negative counter (e.g., for rate limiting)
   */
  createPNCounter() {
    return CRDTFactory.createPNCounter(this._nodeId);
  }

  /**
   * Create a last-writer-wins register (e.g., for policy versions)
   */
  createLWWRegister<T>(initialValue?: T) {
    return CRDTFactory.createLWWRegister<T>(this._nodeId, initialValue);
  }

  /**
   * Create an observed-remove set (e.g., for permission sets)
   */
  createORSet<T>() {
    return CRDTFactory.createORSet<T>(this._nodeId);
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Generate a cache key for an authorization request
   */
  static generateCacheKey(
    principalId: string,
    resourceId: string,
    action: string
  ): string {
    return `authz:${principalId}:${resourceId}:${action}`;
  }

  /**
   * Get raw access to components (for advanced use cases)
   */
  get components() {
    return {
      vectorStore: this._vectorStore,
      cache: this._cache,
      eventStore: this._eventStore,
    };
  }

  /**
   * Clear all data (for testing)
   */
  async clear(): Promise<void> {
    await this._vectorStore.clear();
    this._cache.clear();
    await this._eventStore.clear();
  }
}

/**
 * Create a memory manager with sensible defaults
 */
export function createMemoryManager(
  nodeId: string,
  overrides?: Partial<MemoryManagerConfig>
): MemoryManager {
  return new MemoryManager({
    nodeId,
    ...overrides,
  });
}
