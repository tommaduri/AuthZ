/**
 * PBFT (Practical Byzantine Fault Tolerance) Consensus Tests
 * TDD: Tests written first to define expected behavior
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PBFTConsensus } from '../src/pbft/PBFTConsensus.js';
import { PBFTPhase } from '../src/pbft/types.js';
import { ConsensusState } from '../src/types.js';
import type { ConsensusNode, ConsensusResult } from '../src/types.js';
import type { PBFTConfig } from '../src/pbft/types.js';

describe('PBFTConsensus', () => {
  let pbft: PBFTConsensus;
  let nodes: ConsensusNode[];
  let config: PBFTConfig;

  beforeEach(() => {
    // Setup 4 nodes (can tolerate 1 Byzantine fault: f < n/3)
    nodes = [
      { id: 'node-0', address: 'localhost:8000', isActive: true, lastSeen: Date.now() },
      { id: 'node-1', address: 'localhost:8001', isActive: true, lastSeen: Date.now() },
      { id: 'node-2', address: 'localhost:8002', isActive: true, lastSeen: Date.now() },
      { id: 'node-3', address: 'localhost:8003', isActive: true, lastSeen: Date.now() },
    ];

    config = {
      nodeId: 'node-0',
      nodes,
      viewChangeTimeoutMs: 5000,
      requestTimeoutMs: 2000,
      checkpointInterval: 100,
      watermarkWindow: 200,
    };

    pbft = new PBFTConsensus(config);
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('initialization', () => {
    it('should initialize with correct state', () => {
      expect(pbft.getState()).toBe(ConsensusState.IDLE);
      expect(pbft.getNodeId()).toBe('node-0');
      expect(pbft.getNodes()).toHaveLength(4);
    });

    it('should set first node as primary by default', () => {
      expect(pbft.getPrimaryId()).toBe('node-0');
      expect(pbft.isPrimary()).toBe(true);
    });

    it('should start with view number 0', () => {
      expect(pbft.getViewNumber()).toBe(0);
    });

    it('should start with sequence number 0', () => {
      expect(pbft.getSequenceNumber()).toBe(0);
    });
  });

  describe('Byzantine fault tolerance calculation', () => {
    it('should calculate correct fault tolerance for 4 nodes (f=1)', () => {
      // n = 3f + 1, so f = (n-1)/3 = 1
      expect(pbft.getMaxFaults()).toBe(1);
    });

    it('should calculate quorum as 2f+1', () => {
      // Quorum = 2f + 1 = 3 for 4 nodes
      expect(pbft.getQuorumSize()).toBe(3);
    });

    it('should calculate correct fault tolerance for 7 nodes (f=2)', () => {
      const sevenNodes = Array.from({ length: 7 }, (_, i) => ({
        id: `node-${i}`,
        address: `localhost:${8000 + i}`,
        isActive: true,
        lastSeen: Date.now(),
      }));

      const pbft7 = new PBFTConsensus({
        ...config,
        nodes: sevenNodes,
      });

      expect(pbft7.getMaxFaults()).toBe(2);
      expect(pbft7.getQuorumSize()).toBe(5);
    });
  });

  describe('proposal (primary node)', () => {
    it('should create pre-prepare message when proposing', async () => {
      const proposal = { action: 'transfer', amount: 1000 };
      const result = await pbft.propose(proposal);

      expect(result.proposalId).toBeDefined();
      expect(result.value).toEqual(proposal);
    });

    it('should increment sequence number after proposal', async () => {
      const initialSeq = pbft.getSequenceNumber();
      await pbft.propose({ data: 'test' });
      expect(pbft.getSequenceNumber()).toBe(initialSeq + 1);
    });

    it('should transition to PROPOSING state during proposal', async () => {
      // Create a proposal (which sets the state)
      await pbft.createProposal({ data: 'test' });
      // State should be PROPOSING after creating proposal
      expect(pbft.getState()).toBe(ConsensusState.PROPOSING);
    });

    it('should reject proposal from non-primary node', async () => {
      const nonPrimaryPbft = new PBFTConsensus({
        ...config,
        nodeId: 'node-1', // Not the primary
      });

      await expect(nonPrimaryPbft.propose({ data: 'test' })).rejects.toThrow(
        'Only primary can propose'
      );
    });
  });

  describe('voting', () => {
    it('should accept vote for valid proposal', async () => {
      const proposalId = await pbft.createProposal({ data: 'test' });
      await expect(pbft.vote(proposalId, true)).resolves.not.toThrow();
    });

    it('should reject vote for unknown proposal', async () => {
      await expect(pbft.vote('unknown-id', true)).rejects.toThrow(
        'Proposal not found'
      );
    });

    it('should track votes from different nodes', async () => {
      const proposalId = await pbft.createProposal({ data: 'test' });

      await pbft.receiveVote({
        proposalId,
        nodeId: 'node-1',
        vote: true,
        timestamp: Date.now(),
      });

      await pbft.receiveVote({
        proposalId,
        nodeId: 'node-2',
        vote: true,
        timestamp: Date.now(),
      });

      expect(pbft.getVoteCount(proposalId)).toBe(2);
    });

    it('should ignore duplicate votes from same node', async () => {
      const proposalId = await pbft.createProposal({ data: 'test' });

      await pbft.receiveVote({
        proposalId,
        nodeId: 'node-1',
        vote: true,
        timestamp: Date.now(),
      });

      await pbft.receiveVote({
        proposalId,
        nodeId: 'node-1',
        vote: true,
        timestamp: Date.now() + 1000,
      });

      expect(pbft.getVoteCount(proposalId)).toBe(1);
    });
  });

  describe('quorum and commit', () => {
    it('should detect quorum when enough votes received', async () => {
      const proposalId = await pbft.createProposal({ data: 'test' });

      // Need 2f+1 = 3 votes for quorum (including self)
      await pbft.receiveVote({ proposalId, nodeId: 'node-0', vote: true, timestamp: Date.now() });
      await pbft.receiveVote({ proposalId, nodeId: 'node-1', vote: true, timestamp: Date.now() });
      await pbft.receiveVote({ proposalId, nodeId: 'node-2', vote: true, timestamp: Date.now() });

      expect(pbft.hasQuorum(proposalId)).toBe(true);
    });

    it('should not have quorum with insufficient votes', async () => {
      const proposalId = await pbft.createProposal({ data: 'test' });

      await pbft.receiveVote({ proposalId, nodeId: 'node-0', vote: true, timestamp: Date.now() });
      await pbft.receiveVote({ proposalId, nodeId: 'node-1', vote: true, timestamp: Date.now() });

      expect(pbft.hasQuorum(proposalId)).toBe(false);
    });

    it('should commit proposal when quorum is reached', async () => {
      const proposalId = await pbft.createProposal({ data: 'test' });

      // Simulate prepare phase votes
      await pbft.receiveVote({ proposalId, nodeId: 'node-0', vote: true, timestamp: Date.now() });
      await pbft.receiveVote({ proposalId, nodeId: 'node-1', vote: true, timestamp: Date.now() });
      await pbft.receiveVote({ proposalId, nodeId: 'node-2', vote: true, timestamp: Date.now() });

      await pbft.commit(proposalId);

      expect(pbft.getState()).toBe(ConsensusState.COMMITTED);
    });

    it('should reject commit without quorum', async () => {
      const proposalId = await pbft.createProposal({ data: 'test' });

      await pbft.receiveVote({ proposalId, nodeId: 'node-0', vote: true, timestamp: Date.now() });

      await expect(pbft.commit(proposalId)).rejects.toThrow('Quorum not reached');
    });
  });

  describe('Byzantine fault handling', () => {
    it('should reach consensus with one Byzantine node (f=1)', async () => {
      const proposalId = await pbft.createProposal({ action: 'critical-op' });

      // 3 honest nodes vote approve, 1 Byzantine votes reject
      await pbft.receiveVote({ proposalId, nodeId: 'node-0', vote: true, timestamp: Date.now() });
      await pbft.receiveVote({ proposalId, nodeId: 'node-1', vote: true, timestamp: Date.now() });
      await pbft.receiveVote({ proposalId, nodeId: 'node-2', vote: true, timestamp: Date.now() });
      await pbft.receiveVote({ proposalId, nodeId: 'node-3', vote: false, timestamp: Date.now() }); // Byzantine

      expect(pbft.hasQuorum(proposalId)).toBe(true);

      const result = await pbft.getConsensusResult(proposalId);
      expect(result.accepted).toBe(true);
      expect(result.quorumReached).toBe(true);
    });

    it('should detect conflicting messages from same node', async () => {
      const proposalId = await pbft.createProposal({ data: 'test' });

      await pbft.receiveVote({ proposalId, nodeId: 'node-1', vote: true, timestamp: Date.now() });

      // Same node sends conflicting vote
      const detectConflict = () =>
        pbft.receiveVote({
          proposalId,
          nodeId: 'node-1',
          vote: false,
          timestamp: Date.now() + 1000,
        });

      await expect(detectConflict()).rejects.toThrow('Conflicting vote detected');
    });

    it('should mark node as potentially Byzantine on conflict', async () => {
      const proposalId = await pbft.createProposal({ data: 'test' });

      await pbft.receiveVote({ proposalId, nodeId: 'node-1', vote: true, timestamp: Date.now() });

      try {
        await pbft.receiveVote({
          proposalId,
          nodeId: 'node-1',
          vote: false,
          timestamp: Date.now() + 1000,
        });
      } catch {
        // Expected
      }

      expect(pbft.isSuspectedByzantine('node-1')).toBe(true);
    });
  });

  describe('view change', () => {
    it('should trigger view change on primary timeout', async () => {
      vi.useFakeTimers();

      pbft.startViewChangeTimer();
      vi.advanceTimersByTime(config.viewChangeTimeoutMs + 100);

      expect(pbft.getPhase()).toBe(PBFTPhase.VIEW_CHANGE);

      vi.useRealTimers();
    });

    it('should increment view number during view change', async () => {
      const initialView = pbft.getViewNumber();
      await pbft.initiateViewChange();

      expect(pbft.getViewNumber()).toBe(initialView + 1);
    });

    it('should select new primary after view change', async () => {
      // Initial primary is node-0
      expect(pbft.getPrimaryId()).toBe('node-0');

      await pbft.initiateViewChange();

      // New primary should be node-1 (view % n)
      expect(pbft.getPrimaryId()).toBe('node-1');
    });
  });

  describe('message digest verification', () => {
    it('should compute deterministic digest for same data', () => {
      const data = { action: 'transfer', amount: 1000 };

      const digest1 = pbft.computeDigest(data);
      const digest2 = pbft.computeDigest(data);

      expect(digest1).toBe(digest2);
    });

    it('should compute different digests for different data', () => {
      const data1 = { action: 'transfer', amount: 1000 };
      const data2 = { action: 'transfer', amount: 2000 };

      const digest1 = pbft.computeDigest(data1);
      const digest2 = pbft.computeDigest(data2);

      expect(digest1).not.toBe(digest2);
    });

    it('should verify message digest', () => {
      const data = { action: 'transfer', amount: 1000 };
      const digest = pbft.computeDigest(data);

      expect(pbft.verifyDigest(data, digest)).toBe(true);
      expect(pbft.verifyDigest({ ...data, amount: 2000 }, digest)).toBe(false);
    });
  });

  describe('node management', () => {
    it('should add new node', () => {
      const newNode: ConsensusNode = {
        id: 'node-4',
        address: 'localhost:8004',
        isActive: true,
        lastSeen: Date.now(),
      };

      pbft.addNode(newNode);

      expect(pbft.getNodes()).toHaveLength(5);
    });

    it('should remove node', () => {
      pbft.removeNode('node-3');

      expect(pbft.getNodes()).toHaveLength(3);
      expect(pbft.getNodes().find(n => n.id === 'node-3')).toBeUndefined();
    });

    it('should not remove primary node without view change', () => {
      expect(() => pbft.removeNode('node-0')).toThrow('Cannot remove primary');
    });
  });

  describe('PBFT three-phase protocol', () => {
    it('should progress through pre-prepare, prepare, commit phases', async () => {
      const proposal = { action: 'critical-decision' };

      // Phase 1: Pre-prepare (primary broadcasts)
      const proposalId = await pbft.createProposal(proposal);
      expect(pbft.getPhase()).toBe(PBFTPhase.PRE_PREPARE);

      // Phase 2: Prepare (nodes acknowledge pre-prepare)
      await pbft.receivePrePrepare(proposalId);
      expect(pbft.getPhase()).toBe(PBFTPhase.PREPARE);

      // Collect prepare messages
      await pbft.receiveVote({ proposalId, nodeId: 'node-1', vote: true, timestamp: Date.now() });
      await pbft.receiveVote({ proposalId, nodeId: 'node-2', vote: true, timestamp: Date.now() });
      await pbft.receiveVote({ proposalId, nodeId: 'node-3', vote: true, timestamp: Date.now() });

      // Should transition to commit phase after quorum prepare
      expect(pbft.getPhase()).toBe(PBFTPhase.COMMIT);

      // Phase 3: Commit
      await pbft.commit(proposalId);
      expect(pbft.getPhase()).toBe(PBFTPhase.REPLY);
    });
  });
});
