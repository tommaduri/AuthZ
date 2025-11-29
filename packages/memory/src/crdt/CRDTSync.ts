/**
 * CRDT Implementations - Conflict-free Replicated Data Types
 * For distributed authorization state synchronization
 */

import type {
  CRDT,
  GCounter,
  PNCounter,
  LWWRegister,
  ORSet,
  VectorClock,
} from './types.js';

// Text encoder/decoder for serialization
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * G-Counter: Grow-only counter implementation
 */
export class GCounterImpl implements GCounter {
  private counts: Map<string, number> = new Map();
  private _nodeId: string;

  constructor(nodeId: string) {
    this._nodeId = nodeId;
    this.counts.set(nodeId, 0);
  }

  nodeId(): string {
    return this._nodeId;
  }

  value(): number {
    let total = 0;
    for (const count of this.counts.values()) {
      total += count;
    }
    return total;
  }

  increment(amount = 1): void {
    if (amount < 0) {
      throw new Error('GCounter only supports positive increments');
    }
    const current = this.counts.get(this._nodeId) ?? 0;
    this.counts.set(this._nodeId, current + amount);
  }

  getNodeCount(nodeId: string): number {
    return this.counts.get(nodeId) ?? 0;
  }

  getAllCounts(): Map<string, number> {
    return new Map(this.counts);
  }

  merge(other: CRDT<number>): void {
    if (!(other instanceof GCounterImpl)) {
      throw new Error('Can only merge with another GCounter');
    }

    for (const [nodeId, count] of other.counts) {
      const current = this.counts.get(nodeId) ?? 0;
      this.counts.set(nodeId, Math.max(current, count));
    }
  }

  serialize(): Uint8Array {
    const data = Object.fromEntries(this.counts);
    return textEncoder.encode(JSON.stringify(data));
  }

  clone(): CRDT<number> {
    const cloned = new GCounterImpl(this._nodeId);
    cloned.counts = new Map(this.counts);
    return cloned;
  }

  static deserialize(data: Uint8Array, nodeId: string): GCounterImpl {
    const json = textDecoder.decode(data);
    const counts = JSON.parse(json) as Record<string, number>;
    const counter = new GCounterImpl(nodeId);
    counter.counts = new Map(Object.entries(counts));
    return counter;
  }
}

/**
 * PN-Counter: Positive-Negative counter implementation
 */
export class PNCounterImpl implements PNCounter {
  private positive: GCounterImpl;
  private negative: GCounterImpl;
  private _nodeId: string;

  constructor(nodeId: string) {
    this._nodeId = nodeId;
    this.positive = new GCounterImpl(nodeId);
    this.negative = new GCounterImpl(nodeId);
  }

  nodeId(): string {
    return this._nodeId;
  }

  value(): number {
    return this.positive.value() - this.negative.value();
  }

  increment(amount = 1): void {
    this.positive.increment(amount);
  }

  decrement(amount = 1): void {
    this.negative.increment(amount);
  }

  positiveCount(): number {
    return this.positive.value();
  }

  negativeCount(): number {
    return this.negative.value();
  }

  merge(other: CRDT<number>): void {
    if (!(other instanceof PNCounterImpl)) {
      throw new Error('Can only merge with another PNCounter');
    }

    this.positive.merge(other.positive);
    this.negative.merge(other.negative);
  }

  serialize(): Uint8Array {
    const data = {
      positive: Object.fromEntries((this.positive as GCounterImpl).getAllCounts()),
      negative: Object.fromEntries((this.negative as GCounterImpl).getAllCounts()),
    };
    return textEncoder.encode(JSON.stringify(data));
  }

  clone(): CRDT<number> {
    const cloned = new PNCounterImpl(this._nodeId);
    cloned.positive = this.positive.clone() as GCounterImpl;
    cloned.negative = this.negative.clone() as GCounterImpl;
    return cloned;
  }

  static deserialize(data: Uint8Array, nodeId: string): PNCounterImpl {
    const json = textDecoder.decode(data);
    const parsed = JSON.parse(json) as {
      positive: Record<string, number>;
      negative: Record<string, number>;
    };

    const counter = new PNCounterImpl(nodeId);
    (counter.positive as GCounterImpl).merge(
      Object.assign(new GCounterImpl(nodeId), {
        counts: new Map(Object.entries(parsed.positive)),
      }) as GCounterImpl
    );
    (counter.negative as GCounterImpl).merge(
      Object.assign(new GCounterImpl(nodeId), {
        counts: new Map(Object.entries(parsed.negative)),
      }) as GCounterImpl
    );

    return counter;
  }
}

/**
 * LWW-Register: Last-Writer-Wins Register implementation
 */
export class LWWRegisterImpl<T> implements LWWRegister<T> {
  private _value: T | null = null;
  private _timestamp = 0;
  private _nodeId: string;

  constructor(nodeId: string, initialValue?: T) {
    this._nodeId = nodeId;
    if (initialValue !== undefined) {
      this._value = initialValue;
      this._timestamp = Date.now();
    }
  }

  nodeId(): string {
    return this._nodeId;
  }

  value(): T | null {
    return this._value;
  }

  timestamp(): number {
    return this._timestamp;
  }

  hasValue(): boolean {
    return this._value !== null;
  }

  set(value: T, timestamp?: number): void {
    const ts = timestamp ?? Date.now();
    if (ts > this._timestamp || (ts === this._timestamp && this._nodeId > this._nodeId)) {
      this._value = value;
      this._timestamp = ts;
    }
  }

  merge(other: CRDT<T | null>): void {
    if (!(other instanceof LWWRegisterImpl)) {
      throw new Error('Can only merge with another LWWRegister');
    }

    // Last writer wins based on timestamp, then node ID for tie-breaking
    if (
      other._timestamp > this._timestamp ||
      (other._timestamp === this._timestamp && other._nodeId > this._nodeId)
    ) {
      this._value = other._value;
      this._timestamp = other._timestamp;
    }
  }

  serialize(): Uint8Array {
    const data = {
      value: this._value,
      timestamp: this._timestamp,
      nodeId: this._nodeId,
    };
    return textEncoder.encode(JSON.stringify(data));
  }

  clone(): CRDT<T | null> {
    const cloned = new LWWRegisterImpl<T>(this._nodeId);
    cloned._value = this._value;
    cloned._timestamp = this._timestamp;
    return cloned;
  }

  static deserialize<T>(data: Uint8Array, nodeId: string): LWWRegisterImpl<T> {
    const json = textDecoder.decode(data);
    const parsed = JSON.parse(json) as {
      value: T | null;
      timestamp: number;
      nodeId: string;
    };

    const register = new LWWRegisterImpl<T>(nodeId);
    register._value = parsed.value;
    register._timestamp = parsed.timestamp;
    return register;
  }
}

/**
 * OR-Set: Observed-Remove Set implementation
 */
export class ORSetImpl<T> implements ORSet<T> {
  // Map from element to set of unique tags
  private _elements: Map<T, Set<string>> = new Map();
  // Set of removed tags (tombstones)
  private _tombstones: Set<string> = new Set();
  private _nodeId: string;
  private tagCounter = 0;

  constructor(nodeId: string) {
    this._nodeId = nodeId;
  }

  nodeId(): string {
    return this._nodeId;
  }

  private generateTag(): string {
    return `${this._nodeId}-${Date.now()}-${++this.tagCounter}`;
  }

  value(): Set<T> {
    const result = new Set<T>();

    for (const [element, tags] of this._elements) {
      // Element is present if it has at least one non-tombstoned tag
      for (const tag of tags) {
        if (!this._tombstones.has(tag)) {
          result.add(element);
          break;
        }
      }
    }

    return result;
  }

  add(element: T): void {
    const tag = this.generateTag();

    if (!this._elements.has(element)) {
      this._elements.set(element, new Set());
    }

    this._elements.get(element)!.add(tag);
  }

  remove(element: T): void {
    const tags = this._elements.get(element);
    if (!tags) return;

    // Add all current tags to tombstones
    for (const tag of tags) {
      this._tombstones.add(tag);
    }
  }

  has(element: T): boolean {
    const tags = this._elements.get(element);
    if (!tags) return false;

    // Element is present if any tag is not tombstoned
    for (const tag of tags) {
      if (!this._tombstones.has(tag)) {
        return true;
      }
    }

    return false;
  }

  elements(): T[] {
    return Array.from(this.value());
  }

  size(): number {
    return this.value().size;
  }

  merge(other: CRDT<Set<T>>): void {
    if (!(other instanceof ORSetImpl)) {
      throw new Error('Can only merge with another ORSet');
    }

    // Merge elements and their tags
    for (const [element, otherTags] of other._elements) {
      if (!this._elements.has(element)) {
        this._elements.set(element, new Set());
      }

      const currentTags = this._elements.get(element)!;
      for (const tag of otherTags) {
        currentTags.add(tag);
      }
    }

    // Merge tombstones
    for (const tombstone of other._tombstones) {
      this._tombstones.add(tombstone);
    }
  }

  serialize(): Uint8Array {
    const elementsArray: Array<[string, string[]]> = [];

    for (const [element, tags] of this._elements) {
      elementsArray.push([JSON.stringify(element), Array.from(tags)]);
    }

    const data = {
      elements: elementsArray,
      tombstones: Array.from(this._tombstones),
      nodeId: this._nodeId,
      tagCounter: this.tagCounter,
    };

    return textEncoder.encode(JSON.stringify(data));
  }

  clone(): CRDT<Set<T>> {
    const cloned = new ORSetImpl<T>(this._nodeId);

    for (const [element, tags] of this._elements) {
      cloned._elements.set(element, new Set(tags));
    }

    cloned._tombstones = new Set(this._tombstones);
    cloned.tagCounter = this.tagCounter;

    return cloned;
  }

  static deserialize<T>(data: Uint8Array, nodeId: string): ORSetImpl<T> {
    const json = textDecoder.decode(data);
    const parsed = JSON.parse(json) as {
      elements: Array<[string, string[]]>;
      tombstones: string[];
      nodeId: string;
      tagCounter: number;
    };

    const set = new ORSetImpl<T>(nodeId);

    for (const [elementJson, tags] of parsed.elements) {
      const element = JSON.parse(elementJson) as T;
      set._elements.set(element, new Set(tags));
    }

    set._tombstones = new Set(parsed.tombstones);
    set.tagCounter = parsed.tagCounter;

    return set;
  }
}

/**
 * Vector Clock implementation for causal ordering
 */
export class VectorClockImpl implements VectorClock {
  private clock: Map<string, number> = new Map();

  increment(nodeId: string): void {
    const current = this.clock.get(nodeId) ?? 0;
    this.clock.set(nodeId, current + 1);
  }

  get(nodeId: string): number {
    return this.clock.get(nodeId) ?? 0;
  }

  merge(other: VectorClock): void {
    if (!(other instanceof VectorClockImpl)) {
      throw new Error('Can only merge with another VectorClock');
    }

    for (const [nodeId, count] of other.clock) {
      const current = this.clock.get(nodeId) ?? 0;
      this.clock.set(nodeId, Math.max(current, count));
    }
  }

  compare(other: VectorClock): 'before' | 'after' | 'concurrent' | 'equal' {
    if (!(other instanceof VectorClockImpl)) {
      throw new Error('Can only compare with another VectorClock');
    }

    let less = false;
    let greater = false;

    // Get all nodes from both clocks
    const allNodes = new Set([...this.clock.keys(), ...other.clock.keys()]);

    for (const nodeId of allNodes) {
      const thisValue = this.clock.get(nodeId) ?? 0;
      const otherValue = other.clock.get(nodeId) ?? 0;

      if (thisValue < otherValue) {
        less = true;
      } else if (thisValue > otherValue) {
        greater = true;
      }
    }

    if (less && greater) return 'concurrent';
    if (less) return 'before';
    if (greater) return 'after';
    return 'equal';
  }

  clone(): VectorClock {
    const cloned = new VectorClockImpl();
    cloned.clock = new Map(this.clock);
    return cloned;
  }

  toJSON(): Record<string, number> {
    return Object.fromEntries(this.clock);
  }
}

/**
 * CRDT Factory for creating instances
 */
export const CRDTFactory = {
  createGCounter(nodeId: string): GCounter {
    return new GCounterImpl(nodeId);
  },

  createPNCounter(nodeId: string): PNCounter {
    return new PNCounterImpl(nodeId);
  },

  createLWWRegister<T>(nodeId: string, initialValue?: T): LWWRegister<T> {
    return new LWWRegisterImpl<T>(nodeId, initialValue);
  },

  createORSet<T>(nodeId: string): ORSet<T> {
    return new ORSetImpl<T>(nodeId);
  },
};
