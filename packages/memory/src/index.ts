/**
 * @authz-engine/memory
 * Distributed memory system for AuthZ Engine
 *
 * Components:
 * - VectorStore: Similarity search for authorization patterns
 * - LRUCache: Caching for hot decisions
 * - EventStore: Event sourcing for audit trail
 * - CRDT: Conflict-free replicated data types for distributed state
 * - MemoryManager: Unified interface
 */

// Vector Store
export {
  InMemoryVectorStore,
  vectorMath,
  VectorMathUtils,
} from './vector-store/VectorStore.js';

export type {
  VectorStore,
  VectorEntry,
  SearchResult,
  VectorStoreConfig,
  SimilarityMetric,
  VectorMath,
} from './vector-store/types.js';

// Cache
export { LRUCacheImpl } from './cache/LRUCache.js';

export type {
  Cache,
  LRUCache,
  CacheEntry,
  CacheConfig,
  CacheStats,
} from './cache/types.js';

// Event Store
export { InMemoryEventStore, replayEvents } from './event-store/EventStore.js';

export type {
  EventStore,
  DomainEvent,
  EventMetadata,
  EventStoreConfig,
  Snapshot,
  EventQuery,
  EventHandler,
  UnsubscribeFn,
  AuthorizationEvent,
  PolicyChangeEvent,
} from './event-store/types.js';

// CRDT
export {
  GCounterImpl,
  PNCounterImpl,
  LWWRegisterImpl,
  ORSetImpl,
  VectorClockImpl,
  CRDTFactory,
} from './crdt/CRDTSync.js';

export type {
  CRDT,
  GCounter,
  PNCounter,
  LWWRegister,
  ORSet,
  VectorClock,
  CRDTState,
  CRDTFactory as CRDTFactoryType,
  CRDTSerializer,
} from './crdt/types.js';

// Memory Manager
export {
  MemoryManager,
  createMemoryManager,
} from './MemoryManager.js';

export type { MemoryManagerConfig } from './MemoryManager.js';
