/**
 * Raft Consensus Protocol Tests
 * TDD: Tests written first to define expected behavior
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RaftConsensus } from '../src/raft/RaftConsensus.js';
import { RaftRole } from '../src/raft/types.js';
import { ConsensusState } from '../src/types.js';
import type { ConsensusNode } from '../src/types.js';
import type { RaftConfig, RaftLogEntry } from '../src/raft/types.js';

describe('RaftConsensus', () => {
  let raft: RaftConsensus;
  let nodes: ConsensusNode[];
  let config: RaftConfig;

  beforeEach(() => {
    nodes = [
      { id: 'node-0', address: 'localhost:9000', isActive: true, lastSeen: Date.now() },
      { id: 'node-1', address: 'localhost:9001', isActive: true, lastSeen: Date.now() },
      { id: 'node-2', address: 'localhost:9002', isActive: true, lastSeen: Date.now() },
    ];

    config = {
      nodeId: 'node-0',
      nodes,
      electionTimeoutMinMs: 150,
      electionTimeoutMaxMs: 300,
      heartbeatIntervalMs: 50,
      maxLogEntriesPerRequest: 100,
      snapshotThreshold: 1000,
    };

    raft = new RaftConsensus(config);
  });

  afterEach(() => {
    vi.clearAllTimers();
    raft.stop();
  });

  describe('initialization', () => {
    it('should initialize as follower', () => {
      expect(raft.getRole()).toBe(RaftRole.FOLLOWER);
    });

    it('should start with term 0', () => {
      expect(raft.getCurrentTerm()).toBe(0);
    });

    it('should have no vote initially', () => {
      expect(raft.getVotedFor()).toBeNull();
    });

    it('should have no leader initially', () => {
      expect(raft.getLeaderId()).toBeNull();
    });

    it('should have empty log initially', () => {
      expect(raft.getLogLength()).toBe(0);
    });

    it('should return correct node id', () => {
      expect(raft.getNodeId()).toBe('node-0');
    });
  });

  describe('leader election', () => {
    it('should start election on timeout', async () => {
      vi.useFakeTimers();

      raft.start();
      vi.advanceTimersByTime(config.electionTimeoutMaxMs + 50);

      expect(raft.getRole()).toBe(RaftRole.CANDIDATE);
      expect(raft.getCurrentTerm()).toBe(1);

      vi.useRealTimers();
    });

    it('should vote for self when becoming candidate', async () => {
      await raft.startElection();

      expect(raft.getVotedFor()).toBe('node-0');
    });

    it('should request votes from all nodes', async () => {
      const requestVoteSpy = vi.spyOn(raft, 'sendRequestVote');

      await raft.startElection();

      // Should request votes from other nodes (not self)
      expect(requestVoteSpy).toHaveBeenCalledTimes(2);
    });

    it('should become leader with majority votes', async () => {
      await raft.startElection();

      // Simulate receiving votes from majority
      await raft.receiveVoteResponse({
        type: 'request-vote-response',
        term: 1,
        voteGranted: true,
        voterId: 'node-1',
      });

      // With self vote + node-1, we have majority (2/3)
      expect(raft.getRole()).toBe(RaftRole.LEADER);
    });

    it('should not become leader without majority', async () => {
      await raft.startElection();

      // Only receive rejection
      await raft.receiveVoteResponse({
        type: 'request-vote-response',
        term: 1,
        voteGranted: false,
        voterId: 'node-1',
      });

      await raft.receiveVoteResponse({
        type: 'request-vote-response',
        term: 1,
        voteGranted: false,
        voterId: 'node-2',
      });

      expect(raft.getRole()).not.toBe(RaftRole.LEADER);
    });

    it('should revert to follower if higher term discovered', async () => {
      await raft.startElection();

      await raft.receiveVoteResponse({
        type: 'request-vote-response',
        term: 2, // Higher term
        voteGranted: false,
        voterId: 'node-1',
      });

      expect(raft.getRole()).toBe(RaftRole.FOLLOWER);
      expect(raft.getCurrentTerm()).toBe(2);
    });
  });

  describe('vote granting', () => {
    it('should grant vote to candidate with up-to-date log', async () => {
      const response = await raft.handleRequestVote({
        type: 'request-vote',
        term: 1,
        candidateId: 'node-1',
        lastLogIndex: 0,
        lastLogTerm: 0,
      });

      expect(response.voteGranted).toBe(true);
      expect(raft.getVotedFor()).toBe('node-1');
    });

    it('should not grant vote to candidate with older term', async () => {
      raft.setTerm(2);

      const response = await raft.handleRequestVote({
        type: 'request-vote',
        term: 1,
        candidateId: 'node-1',
        lastLogIndex: 0,
        lastLogTerm: 0,
      });

      expect(response.voteGranted).toBe(false);
    });

    it('should not grant vote if already voted in this term', async () => {
      raft.setTerm(1);
      raft.setVotedFor('node-2');

      const response = await raft.handleRequestVote({
        type: 'request-vote',
        term: 1,
        candidateId: 'node-1',
        lastLogIndex: 0,
        lastLogTerm: 0,
      });

      expect(response.voteGranted).toBe(false);
    });

    it('should not grant vote to candidate with stale log', async () => {
      // Add entry to our log
      await raft.appendToLog({ command: 'test', term: 1 });

      const response = await raft.handleRequestVote({
        type: 'request-vote',
        term: 2,
        candidateId: 'node-1',
        lastLogIndex: 0,
        lastLogTerm: 0,
      });

      expect(response.voteGranted).toBe(false);
    });
  });

  describe('log replication (leader)', () => {
    beforeEach(async () => {
      await raft.becomeLeader();
    });

    it('should append entry to leader log', async () => {
      // Simulate immediate replication success
      const proposalPromise = raft.propose({ action: 'create', data: 'test' });

      // Simulate replication response
      await raft.receiveAppendEntriesResponse({
        type: 'append-entries-response',
        term: raft.getCurrentTerm(),
        success: true,
        matchIndex: 1,
        nodeId: 'node-1',
      });

      const result = await proposalPromise;

      expect(result.accepted).toBe(true);
      expect(raft.getLogLength()).toBe(1);
    });

    it('should replicate entries to followers', async () => {
      const sendAppendEntriesSpy = vi.spyOn(raft, 'sendAppendEntries');

      const proposalPromise = raft.propose({ action: 'create', data: 'test' });

      // Simulate replication response
      await raft.receiveAppendEntriesResponse({
        type: 'append-entries-response',
        term: raft.getCurrentTerm(),
        success: true,
        matchIndex: 1,
        nodeId: 'node-1',
      });

      await proposalPromise;

      expect(sendAppendEntriesSpy).toHaveBeenCalledTimes(2); // To 2 followers
    });

    it('should commit entry when replicated to majority', async () => {
      const proposalPromise = raft.propose({ action: 'create', data: 'test' });

      // Simulate successful replication to one follower
      await raft.receiveAppendEntriesResponse({
        type: 'append-entries-response',
        term: raft.getCurrentTerm(),
        success: true,
        matchIndex: 1,
        nodeId: 'node-1',
      });

      const result = await proposalPromise;

      expect(result.accepted).toBe(true);
      expect(raft.getCommitIndex()).toBe(1);
    });

    it('should track nextIndex for each follower', async () => {
      expect(raft.getNextIndex('node-1')).toBe(1);
      expect(raft.getNextIndex('node-2')).toBe(1);
    });

    it('should track matchIndex for each follower', async () => {
      expect(raft.getMatchIndex('node-1')).toBe(0);
      expect(raft.getMatchIndex('node-2')).toBe(0);
    });
  });

  describe('log replication (follower)', () => {
    it('should accept append entries from leader', async () => {
      const response = await raft.handleAppendEntries({
        type: 'append-entries',
        term: 1,
        leaderId: 'node-1',
        prevLogIndex: 0,
        prevLogTerm: 0,
        entries: [{ term: 1, index: 1, command: { data: 'test' }, timestamp: Date.now() }],
        leaderCommit: 0,
      });

      expect(response.success).toBe(true);
      expect(raft.getLogLength()).toBe(1);
    });

    it('should reject append entries with wrong prevLogTerm', async () => {
      // Add an entry first
      await raft.handleAppendEntries({
        type: 'append-entries',
        term: 1,
        leaderId: 'node-1',
        prevLogIndex: 0,
        prevLogTerm: 0,
        entries: [{ term: 1, index: 1, command: { data: 'test1' }, timestamp: Date.now() }],
        leaderCommit: 0,
      });

      // Try to append with wrong prevLogTerm
      const response = await raft.handleAppendEntries({
        type: 'append-entries',
        term: 1,
        leaderId: 'node-1',
        prevLogIndex: 1,
        prevLogTerm: 2, // Wrong term
        entries: [{ term: 1, index: 2, command: { data: 'test2' }, timestamp: Date.now() }],
        leaderCommit: 0,
      });

      expect(response.success).toBe(false);
    });

    it('should update commit index from leader', async () => {
      await raft.handleAppendEntries({
        type: 'append-entries',
        term: 1,
        leaderId: 'node-1',
        prevLogIndex: 0,
        prevLogTerm: 0,
        entries: [{ term: 1, index: 1, command: { data: 'test' }, timestamp: Date.now() }],
        leaderCommit: 1,
      });

      expect(raft.getCommitIndex()).toBe(1);
    });

    it('should recognize leader from append entries', async () => {
      await raft.handleAppendEntries({
        type: 'append-entries',
        term: 1,
        leaderId: 'node-1',
        prevLogIndex: 0,
        prevLogTerm: 0,
        entries: [],
        leaderCommit: 0,
      });

      expect(raft.getLeaderId()).toBe('node-1');
    });

    it('should reset election timer on heartbeat', async () => {
      vi.useFakeTimers();

      raft.start();

      // Receive heartbeat before timeout
      vi.advanceTimersByTime(100);
      await raft.handleAppendEntries({
        type: 'append-entries',
        term: 1,
        leaderId: 'node-1',
        prevLogIndex: 0,
        prevLogTerm: 0,
        entries: [],
        leaderCommit: 0,
      });

      // Advance more time (should not trigger election due to reset)
      vi.advanceTimersByTime(100);

      expect(raft.getRole()).toBe(RaftRole.FOLLOWER);

      vi.useRealTimers();
    });
  });

  describe('heartbeats (leader)', () => {
    beforeEach(async () => {
      await raft.becomeLeader();
    });

    it('should send heartbeats periodically', async () => {
      vi.useFakeTimers();
      const sendAppendEntriesSpy = vi.spyOn(raft, 'sendAppendEntries');

      raft.startHeartbeat();
      vi.advanceTimersByTime(config.heartbeatIntervalMs * 3);

      expect(sendAppendEntriesSpy.mock.calls.length).toBeGreaterThanOrEqual(4);

      vi.useRealTimers();
    });

    it('should send empty append entries as heartbeat', async () => {
      const sendAppendEntriesSpy = vi.spyOn(raft, 'sendAppendEntries');

      await raft.sendHeartbeat();

      expect(sendAppendEntriesSpy).toHaveBeenCalled();
      const call = sendAppendEntriesSpy.mock.calls[0];
      expect(call[1].entries).toHaveLength(0);
    });
  });

  describe('state machine application', () => {
    it('should apply committed entries', async () => {
      const applySpy = vi.fn();
      raft.onApply(applySpy);

      await raft.becomeLeader();
      const proposalPromise = raft.propose({ action: 'create', data: 'test' });

      // Simulate replication
      await raft.receiveAppendEntriesResponse({
        type: 'append-entries-response',
        term: raft.getCurrentTerm(),
        success: true,
        matchIndex: 1,
        nodeId: 'node-1',
      });

      await proposalPromise;

      expect(applySpy).toHaveBeenCalledWith(
        expect.objectContaining({ command: { action: 'create', data: 'test' } })
      );
    });

    it('should apply entries in order', async () => {
      const applied: unknown[] = [];
      raft.onApply(entry => applied.push(entry.command));

      await raft.becomeLeader();

      // Propose and replicate each entry sequentially
      const p1 = raft.propose({ order: 1 });
      await raft.receiveAppendEntriesResponse({
        type: 'append-entries-response',
        term: raft.getCurrentTerm(),
        success: true,
        matchIndex: 1,
        nodeId: 'node-1',
      });
      await p1;

      const p2 = raft.propose({ order: 2 });
      await raft.receiveAppendEntriesResponse({
        type: 'append-entries-response',
        term: raft.getCurrentTerm(),
        success: true,
        matchIndex: 2,
        nodeId: 'node-1',
      });
      await p2;

      const p3 = raft.propose({ order: 3 });
      await raft.receiveAppendEntriesResponse({
        type: 'append-entries-response',
        term: raft.getCurrentTerm(),
        success: true,
        matchIndex: 3,
        nodeId: 'node-1',
      });
      await p3;

      expect(applied.map((e: any) => e.order)).toEqual([1, 2, 3]);
    });
  });

  describe('node management', () => {
    it('should add new node', () => {
      const newNode: ConsensusNode = {
        id: 'node-3',
        address: 'localhost:9003',
        isActive: true,
        lastSeen: Date.now(),
      };

      raft.addNode(newNode);

      expect(raft.getNodes()).toHaveLength(4);
    });

    it('should remove node', () => {
      raft.removeNode('node-2');

      expect(raft.getNodes()).toHaveLength(2);
    });

    it('should calculate correct majority', () => {
      expect(raft.getMajority()).toBe(2); // 3 nodes, need 2
    });

    it('should update majority after adding node', () => {
      raft.addNode({
        id: 'node-3',
        address: 'localhost:9003',
        isActive: true,
        lastSeen: Date.now(),
      });

      raft.addNode({
        id: 'node-4',
        address: 'localhost:9004',
        isActive: true,
        lastSeen: Date.now(),
      });

      expect(raft.getMajority()).toBe(3); // 5 nodes, need 3
    });
  });

  describe('ConsensusProtocol interface', () => {
    it('should implement propose method', async () => {
      await raft.becomeLeader();
      const proposalPromise = raft.propose({ data: 'test' });

      // Simulate replication
      await raft.receiveAppendEntriesResponse({
        type: 'append-entries-response',
        term: raft.getCurrentTerm(),
        success: true,
        matchIndex: 1,
        nodeId: 'node-1',
      });

      const result = await proposalPromise;

      expect(result).toHaveProperty('proposalId');
      expect(result).toHaveProperty('accepted');
      expect(result).toHaveProperty('value');
      expect(result).toHaveProperty('votes');
      expect(result).toHaveProperty('timestamp');
    });

    it('should implement getState method', () => {
      expect(raft.getState()).toBe(ConsensusState.IDLE);
    });

    it('should return PROPOSING state when leader is replicating', async () => {
      await raft.becomeLeader();
      // Start a proposal without completing replication
      raft.propose({ data: 'test' }); // Don't await

      expect(raft.getState()).toBe(ConsensusState.PROPOSING);
    });
  });
});
