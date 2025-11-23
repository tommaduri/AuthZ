import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryEventStore } from '../src/event-store/EventStore.js';
import type { DomainEvent, EventStoreConfig, AuthorizationEvent } from '../src/event-store/types.js';

describe('InMemoryEventStore', () => {
  let store: InMemoryEventStore;
  const config: EventStoreConfig = {
    maxEventsPerAggregate: 1000,
  };

  beforeEach(() => {
    store = new InMemoryEventStore(config);
  });

  describe('append', () => {
    it('should append an event and return it with generated fields', async () => {
      const event = await store.append({
        type: 'UserCreated',
        aggregateId: 'user-1',
        aggregateType: 'User',
        data: { name: 'John' },
        metadata: {},
        version: 1,
      });

      expect(event.id).toBeDefined();
      expect(event.sequence).toBe(1);
      expect(event.timestamp).toBeInstanceOf(Date);
    });

    it('should increment sequence for each event', async () => {
      const event1 = await store.append({
        type: 'Event1',
        aggregateId: 'agg-1',
        aggregateType: 'Test',
        data: {},
        metadata: {},
        version: 1,
      });

      const event2 = await store.append({
        type: 'Event2',
        aggregateId: 'agg-1',
        aggregateType: 'Test',
        data: {},
        metadata: {},
        version: 2,
      });

      expect(event1.sequence).toBe(1);
      expect(event2.sequence).toBe(2);
    });
  });

  describe('getEvents', () => {
    it('should return events for an aggregate', async () => {
      await store.append({
        type: 'Event1',
        aggregateId: 'agg-1',
        aggregateType: 'Test',
        data: { value: 1 },
        metadata: {},
        version: 1,
      });

      await store.append({
        type: 'Event2',
        aggregateId: 'agg-1',
        aggregateType: 'Test',
        data: { value: 2 },
        metadata: {},
        version: 2,
      });

      await store.append({
        type: 'Event3',
        aggregateId: 'agg-2', // Different aggregate
        aggregateType: 'Test',
        data: { value: 3 },
        metadata: {},
        version: 1,
      });

      const events = await store.getEvents('agg-1');

      expect(events).toHaveLength(2);
      expect(events[0]?.data).toEqual({ value: 1 });
      expect(events[1]?.data).toEqual({ value: 2 });
    });

    it('should return events from a specific version', async () => {
      await store.append({
        type: 'Event1',
        aggregateId: 'agg-1',
        aggregateType: 'Test',
        data: {},
        metadata: {},
        version: 1,
      });

      await store.append({
        type: 'Event2',
        aggregateId: 'agg-1',
        aggregateType: 'Test',
        data: {},
        metadata: {},
        version: 2,
      });

      await store.append({
        type: 'Event3',
        aggregateId: 'agg-1',
        aggregateType: 'Test',
        data: {},
        metadata: {},
        version: 3,
      });

      const events = await store.getEvents('agg-1', 2);

      expect(events).toHaveLength(2);
      expect(events[0]?.version).toBe(2);
      expect(events[1]?.version).toBe(3);
    });

    it('should return empty array for non-existent aggregate', async () => {
      const events = await store.getEvents('non-existent');
      expect(events).toHaveLength(0);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      await store.append({
        type: 'UserCreated',
        aggregateId: 'user-1',
        aggregateType: 'User',
        data: {},
        metadata: {},
        version: 1,
      });

      await store.append({
        type: 'UserUpdated',
        aggregateId: 'user-1',
        aggregateType: 'User',
        data: {},
        metadata: {},
        version: 2,
      });

      await store.append({
        type: 'OrderCreated',
        aggregateId: 'order-1',
        aggregateType: 'Order',
        data: {},
        metadata: {},
        version: 1,
      });
    });

    it('should query by aggregateType', async () => {
      const events = await store.query({ aggregateType: 'User' });
      expect(events).toHaveLength(2);
    });

    it('should query by eventTypes', async () => {
      const events = await store.query({ eventTypes: ['UserCreated', 'OrderCreated'] });
      expect(events).toHaveLength(2);
    });

    it('should query with limit', async () => {
      const events = await store.query({ limit: 2 });
      expect(events).toHaveLength(2);
    });

    it('should query with offset', async () => {
      const events = await store.query({ offset: 1, limit: 10 });
      expect(events).toHaveLength(2);
    });

    it('should combine multiple query parameters', async () => {
      const events = await store.query({
        aggregateType: 'User',
        eventTypes: ['UserCreated'],
      });
      expect(events).toHaveLength(1);
    });
  });

  describe('subscribe', () => {
    it('should call handler for new events', async () => {
      const handler = vi.fn();
      const unsubscribe = store.subscribe(handler);

      await store.append({
        type: 'TestEvent',
        aggregateId: 'agg-1',
        aggregateType: 'Test',
        data: { value: 'test' },
        metadata: {},
        version: 1,
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TestEvent',
          data: { value: 'test' },
        })
      );

      unsubscribe();
    });

    it('should filter by event types', async () => {
      const handler = vi.fn();
      const unsubscribe = store.subscribe(handler, ['TargetEvent']);

      await store.append({
        type: 'OtherEvent',
        aggregateId: 'agg-1',
        aggregateType: 'Test',
        data: {},
        metadata: {},
        version: 1,
      });

      await store.append({
        type: 'TargetEvent',
        aggregateId: 'agg-1',
        aggregateType: 'Test',
        data: {},
        metadata: {},
        version: 2,
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'TargetEvent' })
      );

      unsubscribe();
    });

    it('should unsubscribe correctly', async () => {
      const handler = vi.fn();
      const unsubscribe = store.subscribe(handler);

      await store.append({
        type: 'Event1',
        aggregateId: 'agg-1',
        aggregateType: 'Test',
        data: {},
        metadata: {},
        version: 1,
      });

      unsubscribe();

      await store.append({
        type: 'Event2',
        aggregateId: 'agg-1',
        aggregateType: 'Test',
        data: {},
        metadata: {},
        version: 2,
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should support multiple subscribers', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      store.subscribe(handler1);
      store.subscribe(handler2);

      await store.append({
        type: 'TestEvent',
        aggregateId: 'agg-1',
        aggregateType: 'Test',
        data: {},
        metadata: {},
        version: 1,
      });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSequence', () => {
    it('should return current sequence number', async () => {
      expect(store.getSequence()).toBe(0);

      await store.append({
        type: 'Event1',
        aggregateId: 'agg-1',
        aggregateType: 'Test',
        data: {},
        metadata: {},
        version: 1,
      });

      expect(store.getSequence()).toBe(1);
    });
  });

  describe('count', () => {
    it('should return total event count', async () => {
      expect(store.count()).toBe(0);

      await store.append({
        type: 'Event1',
        aggregateId: 'agg-1',
        aggregateType: 'Test',
        data: {},
        metadata: {},
        version: 1,
      });

      await store.append({
        type: 'Event2',
        aggregateId: 'agg-2',
        aggregateType: 'Test',
        data: {},
        metadata: {},
        version: 1,
      });

      expect(store.count()).toBe(2);
    });
  });

  describe('snapshots', () => {
    it('should save and retrieve snapshots', async () => {
      await store.saveSnapshot({
        aggregateId: 'agg-1',
        aggregateType: 'Test',
        state: { count: 10, name: 'test' },
        version: 5,
      });

      const snapshot = await store.getSnapshot('agg-1');

      expect(snapshot).toBeDefined();
      expect(snapshot?.state).toEqual({ count: 10, name: 'test' });
      expect(snapshot?.version).toBe(5);
    });

    it('should return latest snapshot', async () => {
      await store.saveSnapshot({
        aggregateId: 'agg-1',
        aggregateType: 'Test',
        state: { version: 1 },
        version: 5,
      });

      await store.saveSnapshot({
        aggregateId: 'agg-1',
        aggregateType: 'Test',
        state: { version: 2 },
        version: 10,
      });

      const snapshot = await store.getSnapshot('agg-1');
      expect(snapshot?.state).toEqual({ version: 2 });
    });

    it('should return null for non-existent snapshot', async () => {
      const snapshot = await store.getSnapshot('non-existent');
      expect(snapshot).toBeNull();
    });
  });

  describe('clear', () => {
    it('should remove all events', async () => {
      await store.append({
        type: 'Event1',
        aggregateId: 'agg-1',
        aggregateType: 'Test',
        data: {},
        metadata: {},
        version: 1,
      });

      await store.clear();

      expect(store.count()).toBe(0);
      expect(store.getSequence()).toBe(0);
    });
  });

  describe('authorization audit trail', () => {
    it('should store and query authorization events', async () => {
      const authzEvent: AuthorizationEvent = {
        requestId: 'req-1',
        principal: {
          id: 'user-123',
          type: 'user',
          roles: ['admin'],
        },
        resource: {
          id: 'doc-456',
          kind: 'document',
        },
        action: 'read',
        decision: 'allow',
        reason: 'Admin role granted access',
        policies: ['admin-access-policy'],
        latencyMs: 5,
      };

      await store.append({
        type: 'AuthorizationDecision',
        aggregateId: 'user-123',
        aggregateType: 'User',
        data: authzEvent,
        metadata: {
          correlationId: 'corr-123',
          source: 'api-gateway',
        },
        version: 1,
      });

      const events = await store.query({
        eventTypes: ['AuthorizationDecision'],
        aggregateId: 'user-123',
      });

      expect(events).toHaveLength(1);
      const event = events[0] as DomainEvent<AuthorizationEvent>;
      expect(event.data.decision).toBe('allow');
      expect(event.data.principal.roles).toContain('admin');
    });

    it('should support audit trail reconstruction', async () => {
      // Simulate multiple authorization decisions over time
      for (let i = 0; i < 5; i++) {
        await store.append({
          type: 'AuthorizationDecision',
          aggregateId: 'user-123',
          aggregateType: 'User',
          data: {
            requestId: `req-${i}`,
            decision: i % 2 === 0 ? 'allow' : 'deny',
            action: 'read',
          },
          metadata: {},
          version: i + 1,
        });
      }

      // Reconstruct audit trail
      const auditTrail = await store.getEvents('user-123');

      expect(auditTrail).toHaveLength(5);

      // Verify ordering
      for (let i = 1; i < auditTrail.length; i++) {
        const prev = auditTrail[i - 1];
        const curr = auditTrail[i];
        expect(prev?.sequence).toBeLessThan(curr?.sequence ?? 0);
      }
    });
  });
});
