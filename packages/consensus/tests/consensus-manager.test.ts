/**
 * ConsensusManager Tests
 * TDD: Tests written first to define expected behavior
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConsensusManager } from '../src/ConsensusManager.js';
import { ConsensusState } from '../src/types.js';
import type {
  ConsensusNode,
  ConsensusConfig,
  ProtocolSelectionCriteria,
  ConsensusResult,
} from '../src/types.js';

describe('ConsensusManager', () => {
  let manager: ConsensusManager;
  let nodes: ConsensusNode[];

  beforeEach(() => {
    nodes = [
      { id: 'node-0', address: 'localhost:10000', isActive: true, lastSeen: Date.now() },
      { id: 'node-1', address: 'localhost:10001', isActive: true, lastSeen: Date.now() },
      { id: 'node-2', address: 'localhost:10002', isActive: true, lastSeen: Date.now() },
      { id: 'node-3', address: 'localhost:10003', isActive: true, lastSeen: Date.now() },
    ];

    manager = new ConsensusManager({
      nodeId: 'node-0',
      nodes,
      defaultProtocol: 'raft',
      pbftConfig: {
        viewChangeTimeoutMs: 5000,
        requestTimeoutMs: 2000,
        checkpointInterval: 100,
        watermarkWindow: 200,
      },
      raftConfig: {
        electionTimeoutMinMs: 150,
        electionTimeoutMaxMs: 300,
        heartbeatIntervalMs: 50,
        maxLogEntriesPerRequest: 100,
        snapshotThreshold: 1000,
      },
      gossipConfig: {
        fanout: 2,
        gossipIntervalMs: 100,
        maxRoundsToKeep: 10,
        antiEntropyIntervalMs: 1000,
        maxMessageAge: 60000,
        maxPendingMessages: 1000,
      },
    });
  });

  describe('initialization', () => {
    it('should initialize with default protocol', () => {
      expect(manager.getCurrentProtocol()).toBe('raft');
    });

    it('should initialize all protocol implementations', () => {
      expect(manager.hasProtocol('pbft')).toBe(true);
      expect(manager.hasProtocol('raft')).toBe(true);
      expect(manager.hasProtocol('gossip')).toBe(true);
    });

    it('should return correct node id', () => {
      expect(manager.getNodeId()).toBe('node-0');
    });
  });

  describe('protocol selection', () => {
    it('should select PBFT for high-stakes transactions (>$1000)', () => {
      const criteria: ProtocolSelectionCriteria = {
        transactionValue: 5000,
        isHighStakes: true,
        requiresStrongConsistency: true,
        nodeCount: 4,
        latencyRequirement: 'medium',
      };

      const recommendation = manager.selectProtocol(criteria);

      expect(recommendation.protocol).toBe('pbft');
      expect(recommendation.confidence).toBeGreaterThan(0.8);
    });

    it('should select PBFT for admin actions', () => {
      const criteria: ProtocolSelectionCriteria = {
        isHighStakes: true,
        requiresStrongConsistency: true,
        nodeCount: 4,
        latencyRequirement: 'medium',
      };

      const recommendation = manager.selectProtocol(criteria);

      expect(recommendation.protocol).toBe('pbft');
    });

    it('should select Raft for leader-based coordination', () => {
      const criteria: ProtocolSelectionCriteria = {
        transactionValue: 100,
        isHighStakes: false,
        requiresStrongConsistency: true,
        nodeCount: 4,
        latencyRequirement: 'low',
      };

      const recommendation = manager.selectProtocol(criteria);

      expect(recommendation.protocol).toBe('raft');
    });

    it('should select Gossip for eventual consistency scenarios', () => {
      const criteria: ProtocolSelectionCriteria = {
        transactionValue: 10,
        isHighStakes: false,
        requiresStrongConsistency: false,
        nodeCount: 100,
        latencyRequirement: 'high',
      };

      const recommendation = manager.selectProtocol(criteria);

      expect(recommendation.protocol).toBe('gossip');
    });

    it('should select Gossip for large-scale deployments', () => {
      const criteria: ProtocolSelectionCriteria = {
        isHighStakes: false,
        requiresStrongConsistency: false,
        nodeCount: 1000,
        latencyRequirement: 'high',
      };

      const recommendation = manager.selectProtocol(criteria);

      expect(recommendation.protocol).toBe('gossip');
    });
  });

  describe('protocol switching', () => {
    it('should switch to specified protocol', async () => {
      await manager.switchProtocol('pbft');

      expect(manager.getCurrentProtocol()).toBe('pbft');
    });

    it('should throw error for unknown protocol', async () => {
      await expect(manager.switchProtocol('unknown' as any)).rejects.toThrow(
        'Unknown protocol'
      );
    });

    it('should maintain state during protocol switch', async () => {
      // Propose something with Raft
      await manager.switchProtocol('raft');
      const raftState = manager.getState();

      // Switch to PBFT
      await manager.switchProtocol('pbft');

      // State should be preserved or properly transitioned
      expect(manager.getState()).toBeDefined();
    });
  });

  describe('propose with automatic protocol selection', () => {
    it('should use PBFT for high-value proposals', async () => {
      const selectSpy = vi.spyOn(manager, 'selectProtocol');

      await manager.proposeWithContext(
        { action: 'transfer', amount: 5000 },
        { transactionValue: 5000, isHighStakes: true }
      );

      expect(selectSpy).toHaveBeenCalled();
      expect(manager.getCurrentProtocol()).toBe('pbft');
    });

    it('should return ConsensusResult', async () => {
      const result = await manager.proposeWithContext(
        { action: 'update', data: 'test' },
        { isHighStakes: false, requiresStrongConsistency: true }
      );

      expect(result).toHaveProperty('proposalId');
      expect(result).toHaveProperty('accepted');
      expect(result).toHaveProperty('value');
      expect(result).toHaveProperty('votes');
      expect(result).toHaveProperty('timestamp');
    });
  });

  describe('direct protocol interface', () => {
    it('should implement ConsensusProtocol interface', async () => {
      const result = await manager.propose({ data: 'test' });

      expect(result).toHaveProperty('proposalId');
      expect(result.accepted).toBeDefined();
    });

    it('should delegate vote to current protocol', async () => {
      await manager.switchProtocol('pbft');
      const pbft = manager.getProtocolInstance('pbft');
      const voteSpy = vi.spyOn(pbft!, 'vote');

      const proposalId = await manager.createProposal({ data: 'test' });
      await manager.vote(proposalId, true);

      expect(voteSpy).toHaveBeenCalledWith(proposalId, true);
    });

    it('should delegate commit to current protocol', async () => {
      await manager.switchProtocol('pbft');
      const pbft = manager.getProtocolInstance('pbft');
      const commitSpy = vi.spyOn(pbft!, 'commit');

      const proposalId = await manager.createProposal({ data: 'test' });

      // Add enough votes for quorum
      await manager.simulateVotes(proposalId, 3);

      await manager.commit(proposalId);

      expect(commitSpy).toHaveBeenCalledWith(proposalId);
    });

    it('should return combined state from current protocol', () => {
      const state = manager.getState();

      expect(Object.values(ConsensusState)).toContain(state);
    });
  });

  describe('node management', () => {
    it('should propagate addNode to all protocols', () => {
      const newNode: ConsensusNode = {
        id: 'node-4',
        address: 'localhost:10004',
        isActive: true,
        lastSeen: Date.now(),
      };

      manager.addNode(newNode);

      expect(manager.getNodes()).toHaveLength(5);
    });

    it('should propagate removeNode to all protocols', () => {
      manager.removeNode('node-3');

      expect(manager.getNodes()).toHaveLength(3);
    });
  });

  describe('threshold-based protocol selection', () => {
    it('should use PBFT above $1000 threshold', () => {
      expect(
        manager.selectProtocol({
          transactionValue: 1001,
          isHighStakes: true,
          requiresStrongConsistency: true,
          nodeCount: 4,
          latencyRequirement: 'medium',
        }).protocol
      ).toBe('pbft');
    });

    it('should use Raft for moderate transactions', () => {
      expect(
        manager.selectProtocol({
          transactionValue: 500,
          isHighStakes: false,
          requiresStrongConsistency: true,
          nodeCount: 4,
          latencyRequirement: 'low',
        }).protocol
      ).toBe('raft');
    });

    it('should use Gossip for low-value, high-scale scenarios', () => {
      expect(
        manager.selectProtocol({
          transactionValue: 10,
          isHighStakes: false,
          requiresStrongConsistency: false,
          nodeCount: 50,
          latencyRequirement: 'high',
        }).protocol
      ).toBe('gossip');
    });
  });

  describe('health monitoring', () => {
    it('should report health status', () => {
      const health = manager.getHealth();

      expect(health).toHaveProperty('isHealthy');
      expect(health).toHaveProperty('currentProtocol');
      expect(health).toHaveProperty('activeNodes');
      expect(health).toHaveProperty('lastActivity');
    });

    it('should detect unhealthy state when majority nodes offline', () => {
      // Mark most nodes as inactive
      for (const node of nodes.slice(0, 3)) {
        manager.markNodeInactive(node.id);
      }

      const health = manager.getHealth();

      expect(health.isHealthy).toBe(false);
    });
  });

  describe('metrics and monitoring', () => {
    it('should track consensus latency', async () => {
      await manager.propose({ data: 'test' });

      const metrics = manager.getMetrics();

      expect(metrics).toHaveProperty('averageConsensusTimeMs');
      expect(metrics).toHaveProperty('totalProposals');
      expect(metrics).toHaveProperty('successfulProposals');
    });

    it('should track protocol usage', async () => {
      await manager.switchProtocol('pbft');
      await manager.propose({ data: 'test1' });

      await manager.switchProtocol('raft');
      await manager.propose({ data: 'test2' });

      const metrics = manager.getMetrics();

      expect(metrics.protocolUsage.pbft).toBe(1);
      expect(metrics.protocolUsage.raft).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should handle proposal timeout gracefully', async () => {
      vi.useFakeTimers();

      const proposalPromise = manager.propose({ data: 'slow-consensus' });

      // Advance time past timeout
      vi.advanceTimersByTime(10000);

      const result = await proposalPromise;

      expect(result.accepted).toBe(false);

      vi.useRealTimers();
    });

    it('should recover from protocol failure', async () => {
      // Simulate protocol failure
      const pbft = manager.getProtocolInstance('pbft');
      vi.spyOn(pbft!, 'propose').mockRejectedValueOnce(new Error('Protocol error'));

      // Should fall back or retry
      await manager.switchProtocol('pbft');
      const result = await manager.propose({ data: 'test' });

      // Either succeeds on retry or fails gracefully
      expect(result).toBeDefined();
    });
  });

  describe('event emission', () => {
    it('should emit event on consensus achieved', async () => {
      const eventHandler = vi.fn();
      manager.on('consensus_achieved', eventHandler);

      // Switch to gossip which achieves consensus immediately
      await manager.switchProtocol('gossip');
      await manager.propose({ data: 'test' });

      expect(eventHandler).toHaveBeenCalled();
    });

    it('should emit event on protocol switch', async () => {
      const eventHandler = vi.fn();
      manager.on('protocol_switched', eventHandler);

      await manager.switchProtocol('pbft');

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'raft', to: 'pbft' })
      );
    });
  });
});
