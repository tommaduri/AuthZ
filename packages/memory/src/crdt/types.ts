/**
 * CRDT Types - Conflict-free Replicated Data Types for distributed state
 */

/**
 * Base CRDT interface
 */
export interface CRDT<T> {
  /**
   * Get the current value
   */
  value(): T;

  /**
   * Merge with another CRDT instance
   */
  merge(other: CRDT<T>): void;

  /**
   * Serialize to bytes
   */
  serialize(): Uint8Array;

  /**
   * Clone this CRDT
   */
  clone(): CRDT<T>;

  /**
   * Get the node ID
   */
  nodeId(): string;
}

/**
 * G-Counter: Grow-only counter
 * Each node maintains its own count, total is sum of all
 */
export interface GCounter extends CRDT<number> {
  /**
   * Increment the counter
   */
  increment(amount?: number): void;

  /**
   * Get the count for a specific node
   */
  getNodeCount(nodeId: string): number;

  /**
   * Get all node counts
   */
  getAllCounts(): Map<string, number>;
}

/**
 * PN-Counter: Positive-Negative counter
 * Supports both increment and decrement using two G-Counters
 */
export interface PNCounter extends CRDT<number> {
  /**
   * Increment the counter
   */
  increment(amount?: number): void;

  /**
   * Decrement the counter
   */
  decrement(amount?: number): void;

  /**
   * Get the positive count
   */
  positiveCount(): number;

  /**
   * Get the negative count
   */
  negativeCount(): number;
}

/**
 * LWW-Register: Last-Writer-Wins Register
 * Stores a single value with timestamp-based conflict resolution
 */
export interface LWWRegister<T> extends CRDT<T | null> {
  /**
   * Set the value with optional timestamp
   */
  set(value: T, timestamp?: number): void;

  /**
   * Get the timestamp of the current value
   */
  timestamp(): number;

  /**
   * Check if the register has a value
   */
  hasValue(): boolean;
}

/**
 * OR-Set: Observed-Remove Set
 * Set that supports add and remove operations
 */
export interface ORSet<T> extends CRDT<Set<T>> {
  /**
   * Add an element
   */
  add(element: T): void;

  /**
   * Remove an element
   */
  remove(element: T): void;

  /**
   * Check if element exists
   */
  has(element: T): boolean;

  /**
   * Get all elements as array
   */
  elements(): T[];

  /**
   * Get set size
   */
  size(): number;
}

/**
 * Vector Clock for causal ordering
 */
export interface VectorClock {
  /**
   * Increment the clock for a node
   */
  increment(nodeId: string): void;

  /**
   * Get the clock value for a node
   */
  get(nodeId: string): number;

  /**
   * Merge with another vector clock
   */
  merge(other: VectorClock): void;

  /**
   * Compare with another clock
   */
  compare(other: VectorClock): 'before' | 'after' | 'concurrent' | 'equal';

  /**
   * Clone the clock
   */
  clone(): VectorClock;

  /**
   * Serialize the clock
   */
  toJSON(): Record<string, number>;
}

/**
 * CRDT Sync State for replication
 */
export interface CRDTState {
  lwwRegister: Record<string, { value: unknown; timestamp: number }>;
  gCounter: Record<string, Record<string, number>>;
  pnCounter: Record<string, { positive: Record<string, number>; negative: Record<string, number> }>;
  orSet: Record<string, { elements: Map<unknown, Set<string>>; tombstones: Set<string> }>;
}

/**
 * CRDT Factory for creating instances
 */
export interface CRDTFactory {
  createGCounter(nodeId: string): GCounter;
  createPNCounter(nodeId: string): PNCounter;
  createLWWRegister<T>(nodeId: string, initialValue?: T): LWWRegister<T>;
  createORSet<T>(nodeId: string): ORSet<T>;
}

/**
 * Serialization helpers
 */
export interface CRDTSerializer {
  serializeGCounter(counter: GCounter): Uint8Array;
  deserializeGCounter(data: Uint8Array, nodeId: string): GCounter;

  serializePNCounter(counter: PNCounter): Uint8Array;
  deserializePNCounter(data: Uint8Array, nodeId: string): PNCounter;

  serializeLWWRegister<T>(register: LWWRegister<T>): Uint8Array;
  deserializeLWWRegister<T>(data: Uint8Array, nodeId: string): LWWRegister<T>;

  serializeORSet<T>(set: ORSet<T>): Uint8Array;
  deserializeORSet<T>(data: Uint8Array, nodeId: string): ORSet<T>;
}
