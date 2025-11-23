/**
 * Gossip Protocol Tests
 * TDD: Tests written first to define expected behavior
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GossipProtocol } from '../src/gossip/GossipProtocol.js';
import { ConsensusState } from '../src/types.js';
import type { ConsensusNode } from '../src/types.js';
import type { GossipConfig, GossipUpdate, GossipMessage } from '../src/gossip/types.js';

describe('GossipProtocol', () => {
  let gossip: GossipProtocol;
  let nodes: ConsensusNode[];
  let config: GossipConfig;

  beforeEach(() => {
    nodes = [
      { id: 'node-0', address: 'localhost:7000', isActive: true, lastSeen: Date.now() },
      { id: 'node-1', address: 'localhost:7001', isActive: true, lastSeen: Date.now() },
      { id: 'node-2', address: 'localhost:7002', isActive: true, lastSeen: Date.now() },
      { id: 'node-3', address: 'localhost:7003', isActive: true, lastSeen: Date.now() },
      { id: 'node-4', address: 'localhost:7004', isActive: true, lastSeen: Date.now() },
    ];

    config = {
      nodeId: 'node-0',
      nodes,
      fanout: 2,
      gossipIntervalMs: 100,
      maxRoundsToKeep: 10,
      antiEntropyIntervalMs: 1000,
      maxMessageAge: 60000,
      maxPendingMessages: 1000,
    };

    gossip = new GossipProtocol(config);
  });

  afterEach(() => {
    vi.clearAllTimers();
    gossip.stop();
  });

  describe('initialization', () => {
    it('should initialize with correct node id', () => {
      expect(gossip.getNodeId()).toBe('node-0');
    });

    it('should initialize with empty state', () => {
      expect(gossip.getState()).toBe(ConsensusState.IDLE);
    });

    it('should initialize vector clock with 0 for all nodes', () => {
      const clock = gossip.getVectorClock();
      expect(clock.get('node-0')).toBe(0);
    });

    it('should track all known peers', () => {
      expect(gossip.getNodes()).toHaveLength(5);
    });
  });

  describe('vector clock', () => {
    it('should increment local clock on update', async () => {
      await gossip.propose({ key: 'test', value: 'data' });

      const clock = gossip.getVectorClock();
      expect(clock.get('node-0')).toBe(1);
    });

    it('should merge vector clocks correctly', () => {
      const remoteClock = new Map<string, number>([
        ['node-0', 0],
        ['node-1', 5],
        ['node-2', 3],
      ]);

      gossip.mergeVectorClock(remoteClock);

      const clock = gossip.getVectorClock();
      expect(clock.get('node-1')).toBe(5);
      expect(clock.get('node-2')).toBe(3);
    });

    it('should detect concurrent updates', () => {
      gossip.incrementClock();
      gossip.incrementClock();

      const remoteClock = new Map<string, number>([
        ['node-0', 1],
        ['node-1', 2],
      ]);

      expect(gossip.isConcurrent(remoteClock)).toBe(true);
    });

    it('should detect happens-before relationship', () => {
      gossip.incrementClock();
      gossip.incrementClock();

      const olderClock = new Map<string, number>([
        ['node-0', 1],
        ['node-1', 0],
      ]);

      expect(gossip.happensBefore(olderClock)).toBe(true);
    });
  });

  describe('gossip dissemination', () => {
    it('should select random peers for gossip (fanout)', () => {
      const selectedPeers = gossip.selectGossipTargets();

      expect(selectedPeers.length).toBe(config.fanout);
      expect(selectedPeers.every(p => p !== 'node-0')).toBe(true);
    });

    it('should create gossip message with updates', async () => {
      await gossip.propose({ key: 'config', value: { setting: true } });

      const message = gossip.createGossipMessage();

      expect(message.type).toBe('push');
      expect(message.senderId).toBe('node-0');
      expect(message.updates.length).toBeGreaterThan(0);
    });

    it('should propagate updates to selected peers', async () => {
      const sendSpy = vi.spyOn(gossip, 'sendGossipMessage');

      await gossip.propose({ key: 'test', value: 'data' });
      await gossip.gossipRound();

      expect(sendSpy).toHaveBeenCalledTimes(config.fanout);
    });

    it('should include update in gossip after propose', async () => {
      const result = await gossip.propose({ key: 'mykey', value: 'myvalue' });

      const message = gossip.createGossipMessage();
      const hasUpdate = message.updates.some(u => u.key === 'mykey');

      expect(hasUpdate).toBe(true);
    });
  });

  describe('update handling', () => {
    it('should store received update', async () => {
      const update: GossipUpdate = {
        key: 'remote-key',
        value: 'remote-value',
        version: 1,
        timestamp: Date.now(),
        originNodeId: 'node-1',
        ttl: 10,
      };

      await gossip.handleUpdate(update);

      expect(gossip.getValue('remote-key')).toBe('remote-value');
    });

    it('should reject older updates (last-write-wins)', async () => {
      const oldUpdate: GossipUpdate = {
        key: 'key1',
        value: 'old-value',
        version: 1,
        timestamp: Date.now() - 1000,
        originNodeId: 'node-1',
        ttl: 10,
      };

      const newUpdate: GossipUpdate = {
        key: 'key1',
        value: 'new-value',
        version: 2,
        timestamp: Date.now(),
        originNodeId: 'node-1',
        ttl: 10,
      };

      // Apply new first, then old
      await gossip.handleUpdate(newUpdate);
      await gossip.handleUpdate(oldUpdate);

      expect(gossip.getValue('key1')).toBe('new-value');
    });

    it('should accept newer updates', async () => {
      const oldUpdate: GossipUpdate = {
        key: 'key1',
        value: 'old-value',
        version: 1,
        timestamp: Date.now() - 1000,
        originNodeId: 'node-1',
        ttl: 10,
      };

      const newUpdate: GossipUpdate = {
        key: 'key1',
        value: 'new-value',
        version: 2,
        timestamp: Date.now(),
        originNodeId: 'node-1',
        ttl: 10,
      };

      // Apply old first, then new
      await gossip.handleUpdate(oldUpdate);
      await gossip.handleUpdate(newUpdate);

      expect(gossip.getValue('key1')).toBe('new-value');
    });

    it('should decrement TTL on propagation', async () => {
      const update: GossipUpdate = {
        key: 'key1',
        value: 'value',
        version: 1,
        timestamp: Date.now(),
        originNodeId: 'node-1',
        ttl: 5,
      };

      await gossip.handleUpdate(update);

      const storedUpdate = gossip.getUpdate('key1');
      expect(storedUpdate?.ttl).toBe(4);
    });

    it('should not propagate updates with TTL 0', async () => {
      const update: GossipUpdate = {
        key: 'key1',
        value: 'value',
        version: 1,
        timestamp: Date.now(),
        originNodeId: 'node-1',
        ttl: 0,
      };

      await gossip.handleUpdate(update);

      const message = gossip.createGossipMessage();
      const hasUpdate = message.updates.some(u => u.key === 'key1');

      expect(hasUpdate).toBe(false);
    });
  });

  describe('message handling', () => {
    it('should handle push message', async () => {
      const message: GossipMessage = {
        type: 'push',
        senderId: 'node-1',
        vectorClock: new Map([['node-1', 1]]),
        updates: [
          {
            key: 'pushed-key',
            value: 'pushed-value',
            version: 1,
            timestamp: Date.now(),
            originNodeId: 'node-1',
            ttl: 5,
          },
        ],
        timestamp: Date.now(),
        roundNumber: 1,
      };

      await gossip.handleGossipMessage(message);

      expect(gossip.getValue('pushed-key')).toBe('pushed-value');
    });

    it('should respond to pull message with updates', async () => {
      await gossip.propose({ key: 'local-key', value: 'local-value' });

      const pullMessage: GossipMessage = {
        type: 'pull',
        senderId: 'node-1',
        vectorClock: new Map([['node-0', 0]]), // Stale clock
        updates: [],
        timestamp: Date.now(),
        roundNumber: 1,
      };

      const response = await gossip.handleGossipMessage(pullMessage);

      expect(response?.updates.some(u => u.key === 'local-key')).toBe(true);
    });

    it('should handle push-pull message', async () => {
      await gossip.propose({ key: 'local-key', value: 'local-value' });

      const message: GossipMessage = {
        type: 'push-pull',
        senderId: 'node-1',
        vectorClock: new Map([['node-1', 1]]),
        updates: [
          {
            key: 'remote-key',
            value: 'remote-value',
            version: 1,
            timestamp: Date.now(),
            originNodeId: 'node-1',
            ttl: 5,
          },
        ],
        timestamp: Date.now(),
        roundNumber: 1,
      };

      const response = await gossip.handleGossipMessage(message);

      // Should receive remote update
      expect(gossip.getValue('remote-key')).toBe('remote-value');

      // Should respond with local updates
      expect(response?.updates.some(u => u.key === 'local-key')).toBe(true);
    });
  });

  describe('anti-entropy', () => {
    it('should trigger anti-entropy sync periodically', async () => {
      vi.useFakeTimers();
      const antiEntropySpy = vi.spyOn(gossip, 'runAntiEntropy');

      gossip.start();
      vi.advanceTimersByTime(config.antiEntropyIntervalMs + 50);

      expect(antiEntropySpy).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should request missing updates during anti-entropy', async () => {
      const sendSpy = vi.spyOn(gossip, 'sendAntiEntropyRequest');

      // Set local clock behind
      gossip.mergeVectorClock(new Map([['node-1', 5]]));

      // Now our local node-1 entries might be stale
      await gossip.runAntiEntropy();

      expect(sendSpy).toHaveBeenCalled();
    });
  });

  describe('membership and peer detection', () => {
    it('should mark peer as alive on message received', async () => {
      const message: GossipMessage = {
        type: 'push',
        senderId: 'node-1',
        vectorClock: new Map(),
        updates: [],
        timestamp: Date.now(),
        roundNumber: 1,
      };

      await gossip.handleGossipMessage(message);

      expect(gossip.isPeerAlive('node-1')).toBe(true);
    });

    it('should suspect peer after timeout', async () => {
      vi.useFakeTimers();

      gossip.start();

      // Advance time past timeout without hearing from node-1
      vi.advanceTimersByTime(config.antiEntropyIntervalMs * 3);

      // Check if peer is suspected (implementation may vary)
      const peerState = gossip.getPeerState('node-1');
      expect(peerState?.suspicionLevel).toBeGreaterThan(0);

      vi.useRealTimers();
    });

    it('should add new peer dynamically', () => {
      const newNode: ConsensusNode = {
        id: 'node-5',
        address: 'localhost:7005',
        isActive: true,
        lastSeen: Date.now(),
      };

      gossip.addNode(newNode);

      expect(gossip.getNodes()).toHaveLength(6);
    });

    it('should remove peer', () => {
      gossip.removeNode('node-4');

      expect(gossip.getNodes()).toHaveLength(4);
    });
  });

  describe('conflict resolution', () => {
    it('should use last-write-wins by default', async () => {
      const update1: GossipUpdate = {
        key: 'conflict-key',
        value: 'value-1',
        version: 1,
        timestamp: Date.now() - 100,
        originNodeId: 'node-1',
        ttl: 5,
      };

      const update2: GossipUpdate = {
        key: 'conflict-key',
        value: 'value-2',
        version: 1,
        timestamp: Date.now(),
        originNodeId: 'node-2',
        ttl: 5,
      };

      await gossip.handleUpdate(update1);
      await gossip.handleUpdate(update2);

      expect(gossip.getValue('conflict-key')).toBe('value-2');
    });

    it('should support custom conflict resolver', async () => {
      const customResolver = {
        resolve: (existing: any, incoming: any) => ({
          ...existing,
          ...incoming,
          merged: true,
        }),
      };

      gossip.setConflictResolver(customResolver);

      await gossip.handleUpdate({
        key: 'merge-key',
        value: { a: 1 },
        version: 1,
        timestamp: Date.now() - 100,
        originNodeId: 'node-1',
        ttl: 5,
      });

      await gossip.handleUpdate({
        key: 'merge-key',
        value: { b: 2 },
        version: 1,
        timestamp: Date.now(),
        originNodeId: 'node-2',
        ttl: 5,
      });

      const value = gossip.getValue('merge-key') as any;
      expect(value.merged).toBe(true);
    });
  });

  describe('convergence detection', () => {
    it('should detect convergence when all updates propagated', async () => {
      await gossip.propose({ key: 'test', value: 'data' });

      // Simulate acknowledgments from all peers
      for (const node of nodes) {
        if (node.id !== 'node-0') {
          gossip.handleAck({
            type: 'ack',
            senderId: node.id,
            receivedUpdates: ['test'],
            timestamp: Date.now(),
          });
        }
      }

      const status = gossip.getConvergenceStatus();
      expect(status.isConverged).toBe(true);
    });

    it('should report convergence percentage', async () => {
      await gossip.propose({ key: 'test', value: 'data' });

      // Simulate 2 out of 4 peers acknowledging
      gossip.handleAck({
        type: 'ack',
        senderId: 'node-1',
        receivedUpdates: ['test'],
        timestamp: Date.now(),
      });

      gossip.handleAck({
        type: 'ack',
        senderId: 'node-2',
        receivedUpdates: ['test'],
        timestamp: Date.now(),
      });

      const status = gossip.getConvergenceStatus();
      expect(status.convergencePercentage).toBe(50); // 2/4 peers
    });
  });

  describe('ConsensusProtocol interface', () => {
    it('should implement propose method', async () => {
      const result = await gossip.propose({ data: 'test' });

      expect(result).toHaveProperty('proposalId');
      expect(result).toHaveProperty('accepted');
      expect(result).toHaveProperty('value');
      expect(result).toHaveProperty('timestamp');
    });

    it('should implement vote method (no-op for gossip)', async () => {
      // Gossip doesn't require explicit voting
      await expect(gossip.vote('any-id', true)).resolves.not.toThrow();
    });

    it('should implement commit method (no-op for gossip)', async () => {
      // Gossip achieves eventual consistency, no explicit commit
      await expect(gossip.commit('any-id')).resolves.not.toThrow();
    });
  });

  describe('metrics', () => {
    it('should track messages sent', async () => {
      await gossip.gossipRound();

      const metrics = gossip.getMetrics();
      expect(metrics.messagesSent).toBeGreaterThan(0);
    });

    it('should track updates proposed', async () => {
      await gossip.propose({ key: 'test', value: 'data' });

      const metrics = gossip.getMetrics();
      expect(metrics.updatesProposed).toBe(1);
    });

    it('should track active peers', () => {
      const metrics = gossip.getMetrics();
      expect(metrics.peersKnown).toBe(5);
    });
  });
});
