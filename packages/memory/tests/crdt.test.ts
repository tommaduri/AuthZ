import { describe, it, expect, beforeEach } from 'vitest';
import {
  GCounterImpl,
  PNCounterImpl,
  LWWRegisterImpl,
  ORSetImpl,
  VectorClockImpl,
  CRDTFactory,
} from '../src/crdt/CRDTSync.js';

describe('CRDT Implementations', () => {
  describe('GCounter (Grow-only Counter)', () => {
    let counter1: GCounterImpl;
    let counter2: GCounterImpl;

    beforeEach(() => {
      counter1 = new GCounterImpl('node-1');
      counter2 = new GCounterImpl('node-2');
    });

    it('should start with value 0', () => {
      expect(counter1.value()).toBe(0);
    });

    it('should increment locally', () => {
      counter1.increment();
      expect(counter1.value()).toBe(1);

      counter1.increment(5);
      expect(counter1.value()).toBe(6);
    });

    it('should track counts per node', () => {
      counter1.increment(3);
      expect(counter1.getNodeCount('node-1')).toBe(3);
      expect(counter1.getNodeCount('node-2')).toBe(0);
    });

    it('should merge counters correctly', () => {
      counter1.increment(5);
      counter2.increment(3);

      counter1.merge(counter2);
      expect(counter1.value()).toBe(8);

      // Idempotent merge
      counter1.merge(counter2);
      expect(counter1.value()).toBe(8);
    });

    it('should handle concurrent increments', () => {
      counter1.increment(5);
      counter2.increment(3);

      // Both sides merge
      const merged1 = counter1.clone() as GCounterImpl;
      const merged2 = counter2.clone() as GCounterImpl;

      merged1.merge(counter2);
      merged2.merge(counter1);

      // Both should converge to same value
      expect(merged1.value()).toBe(8);
      expect(merged2.value()).toBe(8);
    });

    it('should serialize and deserialize', () => {
      counter1.increment(10);

      const serialized = counter1.serialize();
      const deserialized = GCounterImpl.deserialize(serialized, 'node-1');

      expect(deserialized.value()).toBe(10);
    });

    it('should clone correctly', () => {
      counter1.increment(5);
      const cloned = counter1.clone() as GCounterImpl;

      counter1.increment(3);

      expect(cloned.value()).toBe(5);
      expect(counter1.value()).toBe(8);
    });
  });

  describe('PNCounter (Positive-Negative Counter)', () => {
    let counter1: PNCounterImpl;
    let counter2: PNCounterImpl;

    beforeEach(() => {
      counter1 = new PNCounterImpl('node-1');
      counter2 = new PNCounterImpl('node-2');
    });

    it('should start with value 0', () => {
      expect(counter1.value()).toBe(0);
    });

    it('should increment and decrement', () => {
      counter1.increment(10);
      expect(counter1.value()).toBe(10);

      counter1.decrement(3);
      expect(counter1.value()).toBe(7);
    });

    it('should allow negative values', () => {
      counter1.decrement(5);
      expect(counter1.value()).toBe(-5);
    });

    it('should merge correctly', () => {
      counter1.increment(10);
      counter1.decrement(3);

      counter2.increment(5);
      counter2.decrement(2);

      counter1.merge(counter2);

      // (10 + 5) - (3 + 2) = 10
      expect(counter1.value()).toBe(10);
    });

    it('should handle concurrent operations', () => {
      counter1.increment(10);
      counter2.decrement(3);

      counter1.merge(counter2);
      counter2.merge(counter1);

      expect(counter1.value()).toBe(counter2.value());
      expect(counter1.value()).toBe(7);
    });

    it('should track positive and negative counts separately', () => {
      counter1.increment(10);
      counter1.decrement(3);

      expect(counter1.positiveCount()).toBe(10);
      expect(counter1.negativeCount()).toBe(3);
    });

    it('should serialize and deserialize', () => {
      counter1.increment(10);
      counter1.decrement(3);

      const serialized = counter1.serialize();
      const deserialized = PNCounterImpl.deserialize(serialized, 'node-1');

      expect(deserialized.value()).toBe(7);
    });
  });

  describe('LWWRegister (Last-Writer-Wins Register)', () => {
    let register1: LWWRegisterImpl<string>;
    let register2: LWWRegisterImpl<string>;

    beforeEach(() => {
      register1 = new LWWRegisterImpl<string>('node-1');
      register2 = new LWWRegisterImpl<string>('node-2');
    });

    it('should start with null value', () => {
      expect(register1.value()).toBeNull();
      expect(register1.hasValue()).toBe(false);
    });

    it('should set and get value', () => {
      register1.set('hello');
      expect(register1.value()).toBe('hello');
      expect(register1.hasValue()).toBe(true);
    });

    it('should track timestamp', () => {
      const before = Date.now();
      register1.set('test');
      const after = Date.now();

      expect(register1.timestamp()).toBeGreaterThanOrEqual(before);
      expect(register1.timestamp()).toBeLessThanOrEqual(after);
    });

    it('should merge with last-writer-wins semantics', () => {
      register1.set('first', 100);
      register2.set('second', 200);

      register1.merge(register2);

      expect(register1.value()).toBe('second');
    });

    it('should handle concurrent writes with same timestamp using node ID', () => {
      register1.set('from-node-1', 100);
      register2.set('from-node-2', 100);

      register1.merge(register2);

      // node-2 > node-1 lexicographically, so node-2 wins
      expect(register1.value()).toBe('from-node-2');
    });

    it('should not overwrite with older timestamp', () => {
      register1.set('newer', 200);
      register2.set('older', 100);

      register1.merge(register2);

      expect(register1.value()).toBe('newer');
    });

    it('should serialize and deserialize', () => {
      register1.set('test-value', 12345);

      const serialized = register1.serialize();
      const deserialized = LWWRegisterImpl.deserialize<string>(serialized, 'node-1');

      expect(deserialized.value()).toBe('test-value');
      expect(deserialized.timestamp()).toBe(12345);
    });

    it('should handle complex objects', () => {
      interface AuthzDecision {
        allowed: boolean;
        reason: string;
      }

      const decisionRegister = new LWWRegisterImpl<AuthzDecision>('node-1');
      decisionRegister.set({ allowed: true, reason: 'Admin access' });

      expect(decisionRegister.value()).toEqual({
        allowed: true,
        reason: 'Admin access',
      });
    });
  });

  describe('ORSet (Observed-Remove Set)', () => {
    let set1: ORSetImpl<string>;
    let set2: ORSetImpl<string>;

    beforeEach(() => {
      set1 = new ORSetImpl<string>('node-1');
      set2 = new ORSetImpl<string>('node-2');
    });

    it('should start empty', () => {
      expect(set1.size()).toBe(0);
      expect(set1.value().size).toBe(0);
    });

    it('should add elements', () => {
      set1.add('apple');
      set1.add('banana');

      expect(set1.has('apple')).toBe(true);
      expect(set1.has('banana')).toBe(true);
      expect(set1.size()).toBe(2);
    });

    it('should remove elements', () => {
      set1.add('apple');
      set1.remove('apple');

      expect(set1.has('apple')).toBe(false);
      expect(set1.size()).toBe(0);
    });

    it('should handle add after remove (add-wins)', () => {
      set1.add('apple');
      set1.remove('apple');
      set1.add('apple'); // Re-add

      expect(set1.has('apple')).toBe(true);
    });

    it('should merge sets correctly', () => {
      set1.add('apple');
      set1.add('banana');

      set2.add('cherry');
      set2.add('date');

      set1.merge(set2);

      expect(set1.elements()).toContain('apple');
      expect(set1.elements()).toContain('banana');
      expect(set1.elements()).toContain('cherry');
      expect(set1.elements()).toContain('date');
    });

    it('should handle concurrent add-remove', () => {
      // Initial state: both have 'apple'
      set1.add('apple');
      set2.add('apple');
      set1.merge(set2);
      set2.merge(set1);

      // Concurrent operations
      set1.remove('apple'); // node-1 removes
      set2.add('apple');    // node-2 adds (creates new tag)

      // Merge
      set1.merge(set2);
      set2.merge(set1);

      // Add should win (observed-remove semantics)
      expect(set1.has('apple')).toBe(true);
      expect(set2.has('apple')).toBe(true);
    });

    it('should return elements as array', () => {
      set1.add('apple');
      set1.add('banana');
      set1.add('cherry');

      const elements = set1.elements();
      expect(elements).toHaveLength(3);
      expect(elements).toContain('apple');
      expect(elements).toContain('banana');
      expect(elements).toContain('cherry');
    });

    it('should serialize and deserialize', () => {
      set1.add('apple');
      set1.add('banana');

      const serialized = set1.serialize();
      const deserialized = ORSetImpl.deserialize<string>(serialized, 'node-1');

      expect(deserialized.has('apple')).toBe(true);
      expect(deserialized.has('banana')).toBe(true);
      expect(deserialized.size()).toBe(2);
    });

    it('should handle duplicate adds', () => {
      set1.add('apple');
      set1.add('apple');
      set1.add('apple');

      expect(set1.size()).toBe(1);
    });
  });

  describe('VectorClock', () => {
    let clock1: VectorClockImpl;
    let clock2: VectorClockImpl;

    beforeEach(() => {
      clock1 = new VectorClockImpl();
      clock2 = new VectorClockImpl();
    });

    it('should start with zero values', () => {
      expect(clock1.get('node-1')).toBe(0);
    });

    it('should increment for a node', () => {
      clock1.increment('node-1');
      expect(clock1.get('node-1')).toBe(1);

      clock1.increment('node-1');
      expect(clock1.get('node-1')).toBe(2);
    });

    it('should merge taking maximum', () => {
      clock1.increment('node-1');
      clock1.increment('node-1');

      clock2.increment('node-2');
      clock2.increment('node-2');
      clock2.increment('node-2');

      clock1.merge(clock2);

      expect(clock1.get('node-1')).toBe(2);
      expect(clock1.get('node-2')).toBe(3);
    });

    it('should compare clocks correctly', () => {
      clock1.increment('node-1');

      expect(clock1.compare(clock2)).toBe('after');
      expect(clock2.compare(clock1)).toBe('before');
    });

    it('should detect concurrent clocks', () => {
      clock1.increment('node-1');
      clock2.increment('node-2');

      expect(clock1.compare(clock2)).toBe('concurrent');
      expect(clock2.compare(clock1)).toBe('concurrent');
    });

    it('should detect equal clocks', () => {
      clock1.increment('node-1');
      clock2.increment('node-1');

      expect(clock1.compare(clock2)).toBe('equal');
    });

    it('should clone correctly', () => {
      clock1.increment('node-1');
      clock1.increment('node-2');

      const cloned = clock1.clone();
      clock1.increment('node-1');

      expect(cloned.get('node-1')).toBe(1);
      expect(clock1.get('node-1')).toBe(2);
    });

    it('should serialize to JSON', () => {
      clock1.increment('node-1');
      clock1.increment('node-2');
      clock1.increment('node-2');

      const json = clock1.toJSON();
      expect(json).toEqual({ 'node-1': 1, 'node-2': 2 });
    });
  });

  describe('CRDTFactory', () => {
    const factory = CRDTFactory;

    it('should create GCounter', () => {
      const counter = factory.createGCounter('node-1');
      expect(counter.value()).toBe(0);
      expect(counter.nodeId()).toBe('node-1');
    });

    it('should create PNCounter', () => {
      const counter = factory.createPNCounter('node-1');
      expect(counter.value()).toBe(0);
      expect(counter.nodeId()).toBe('node-1');
    });

    it('should create LWWRegister', () => {
      const register = factory.createLWWRegister<string>('node-1');
      expect(register.value()).toBeNull();
      expect(register.nodeId()).toBe('node-1');
    });

    it('should create LWWRegister with initial value', () => {
      const register = factory.createLWWRegister<string>('node-1', 'initial');
      expect(register.value()).toBe('initial');
    });

    it('should create ORSet', () => {
      const set = factory.createORSet<string>('node-1');
      expect(set.size()).toBe(0);
      expect(set.nodeId()).toBe('node-1');
    });
  });

  describe('Authorization use cases', () => {
    it('should track permission grants across nodes', () => {
      // Simulate distributed permission tracking using ORSet
      const permissions1 = new ORSetImpl<string>('auth-node-1');
      const permissions2 = new ORSetImpl<string>('auth-node-2');

      // Node 1 grants permissions
      permissions1.add('user:123:read:document:*');
      permissions1.add('user:123:write:document:owned');

      // Node 2 grants different permissions
      permissions2.add('user:123:admin:dashboard:view');

      // Merge permissions
      permissions1.merge(permissions2);
      permissions2.merge(permissions1);

      // Both nodes should have all permissions
      expect(permissions1.size()).toBe(3);
      expect(permissions2.size()).toBe(3);
      expect(permissions1.has('user:123:admin:dashboard:view')).toBe(true);
    });

    it('should track access counts across distributed system', () => {
      // Track total access attempts using GCounter
      const accessCount1 = new GCounterImpl('gateway-1');
      const accessCount2 = new GCounterImpl('gateway-2');
      const accessCount3 = new GCounterImpl('gateway-3');

      // Simulate access from different gateways
      accessCount1.increment(100);
      accessCount2.increment(150);
      accessCount3.increment(75);

      // Merge all counts
      accessCount1.merge(accessCount2);
      accessCount1.merge(accessCount3);

      expect(accessCount1.value()).toBe(325);
    });

    it('should handle rate limiting with PNCounter', () => {
      // Track rate limit tokens
      const tokens1 = new PNCounterImpl('limiter-1');
      const tokens2 = new PNCounterImpl('limiter-2');

      // Add tokens (grant)
      tokens1.increment(100);
      tokens2.increment(100);

      // Consume tokens (usage)
      tokens1.decrement(30);
      tokens2.decrement(45);

      // Merge
      tokens1.merge(tokens2);

      // Should have 200 - 75 = 125 tokens remaining
      expect(tokens1.value()).toBe(125);
    });

    it('should store latest policy version with LWWRegister', () => {
      interface PolicyVersion {
        version: number;
        hash: string;
        updatedAt: number;
      }

      const policy1 = new LWWRegisterImpl<PolicyVersion>('policy-server-1');
      const policy2 = new LWWRegisterImpl<PolicyVersion>('policy-server-2');

      // Server 1 updates at t=100
      policy1.set({ version: 1, hash: 'abc123', updatedAt: 100 }, 100);

      // Server 2 updates at t=150
      policy2.set({ version: 2, hash: 'def456', updatedAt: 150 }, 150);

      // Merge - latest version wins
      policy1.merge(policy2);

      expect(policy1.value()?.version).toBe(2);
      expect(policy1.value()?.hash).toBe('def456');
    });
  });
});
