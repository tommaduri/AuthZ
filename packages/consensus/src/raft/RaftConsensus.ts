/**
 * Raft Consensus Protocol Implementation
 * Leader election and log replication
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
  ConsensusState,
  type ConsensusNode,
  type ConsensusProtocol,
  type ConsensusResult,
} from '../types.js';
import {
  RaftRole,
  type RaftConfig,
  type RaftState,
  type RaftLogEntry,
  type RequestVoteRequest,
  type RequestVoteResponse,
  type AppendEntriesRequest,
  type AppendEntriesResponse,
  type LeaderState,
} from './types.js';

export class RaftConsensus extends EventEmitter implements ConsensusProtocol {
  private config: RaftConfig;
  private nodes: Map<string, ConsensusNode>;
  private state: RaftState;
  private leaderState: LeaderState | null = null;
  private log: RaftLogEntry[] = [];
  private electionTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private votesReceived: Set<string> = new Set();
  private pendingProposals: Map<string, { resolve: (result: ConsensusResult) => void; entry: RaftLogEntry }> = new Map();
  private applyCallback: ((entry: RaftLogEntry) => void) | null = null;

  constructor(config: RaftConfig) {
    super();
    this.config = config;
    this.nodes = new Map(config.nodes.map(n => [n.id, n]));

    this.state = {
      role: RaftRole.FOLLOWER,
      currentTerm: 0,
      votedFor: null,
      leaderId: null,
      commitIndex: 0,
      lastApplied: 0,
    };
  }

  // ============================================================================
  // ConsensusProtocol Interface
  // ============================================================================

  async propose(value: unknown): Promise<ConsensusResult> {
    if (this.state.role !== RaftRole.LEADER) {
      throw new Error('Not the leader');
    }

    const proposalId = uuidv4();
    const entry: RaftLogEntry = {
      term: this.state.currentTerm,
      index: this.log.length + 1,
      command: value,
      timestamp: Date.now(),
    };

    this.log.push(entry);

    // Check if we already have majority (single node cluster or small cluster)
    const otherNodes = this.nodes.size - 1;
    if (otherNodes === 0) {
      this.state.commitIndex = entry.index;
      this.applyCommittedEntries();
      return this.createConsensusResult(proposalId, entry, true);
    }

    // Replicate to followers
    this.sendAppendEntriesToAll();

    return new Promise((resolve) => {
      this.pendingProposals.set(proposalId, { resolve, entry });

      // Set a timeout to prevent hanging
      setTimeout(() => {
        if (this.pendingProposals.has(proposalId)) {
          const pending = this.pendingProposals.get(proposalId);
          if (pending) {
            // Check if we've reached majority
            if (this.state.commitIndex >= entry.index) {
              pending.resolve(this.createConsensusResult(proposalId, entry, true));
            } else {
              pending.resolve(this.createConsensusResult(proposalId, entry, false));
            }
            this.pendingProposals.delete(proposalId);
          }
        }
      }, 100);
    });
  }

  async vote(_proposalId: string, _vote: boolean): Promise<void> {
    // Raft doesn't use explicit voting on proposals
    // Voting is only for leader election
  }

  async commit(_proposalId: string): Promise<void> {
    // Commitment happens automatically when majority replicates
  }

  getState(): ConsensusState {
    if (this.state.role === RaftRole.LEADER && this.pendingProposals.size > 0) {
      return ConsensusState.PROPOSING;
    }
    return ConsensusState.IDLE;
  }

  getNodeId(): string {
    return this.config.nodeId;
  }

  addNode(node: ConsensusNode): void {
    this.nodes.set(node.id, node);
    if (this.state.role === RaftRole.LEADER && this.leaderState) {
      this.leaderState.nextIndex.set(node.id, this.log.length + 1);
      this.leaderState.matchIndex.set(node.id, 0);
    }
  }

  removeNode(nodeId: string): void {
    this.nodes.delete(nodeId);
    if (this.leaderState) {
      this.leaderState.nextIndex.delete(nodeId);
      this.leaderState.matchIndex.delete(nodeId);
    }
  }

  getNodes(): ConsensusNode[] {
    return Array.from(this.nodes.values());
  }

  // ============================================================================
  // Raft-Specific Getters
  // ============================================================================

  getRole(): RaftRole {
    return this.state.role;
  }

  getCurrentTerm(): number {
    return this.state.currentTerm;
  }

  getVotedFor(): string | null {
    return this.state.votedFor;
  }

  getLeaderId(): string | null {
    return this.state.leaderId;
  }

  getLogLength(): number {
    return this.log.length;
  }

  getCommitIndex(): number {
    return this.state.commitIndex;
  }

  getMajority(): number {
    return Math.floor(this.nodes.size / 2) + 1;
  }

  getNextIndex(nodeId: string): number {
    return this.leaderState?.nextIndex.get(nodeId) ?? this.log.length + 1;
  }

  getMatchIndex(nodeId: string): number {
    return this.leaderState?.matchIndex.get(nodeId) ?? 0;
  }

  // ============================================================================
  // State Setters (for testing)
  // ============================================================================

  setTerm(term: number): void {
    this.state.currentTerm = term;
  }

  setVotedFor(nodeId: string | null): void {
    this.state.votedFor = nodeId;
  }

  // ============================================================================
  // Leader Election
  // ============================================================================

  start(): void {
    this.resetElectionTimer();
  }

  stop(): void {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async startElection(): Promise<void> {
    this.state.role = RaftRole.CANDIDATE;
    this.state.currentTerm++;
    this.state.votedFor = this.config.nodeId;
    this.votesReceived = new Set([this.config.nodeId]);

    this.emit('election_started', { term: this.state.currentTerm });

    // Request votes from all other nodes
    const votePromises: Promise<void>[] = [];
    for (const [nodeId] of this.nodes) {
      if (nodeId !== this.config.nodeId) {
        votePromises.push(this.sendRequestVote(nodeId));
      }
    }

    // In a real implementation, we'd wait for responses
  }

  async sendRequestVote(nodeId: string): Promise<void> {
    const lastLogIndex = this.log.length;
    const lastLogTerm = lastLogIndex > 0 ? this.log[lastLogIndex - 1].term : 0;

    const request: RequestVoteRequest = {
      type: 'request-vote',
      term: this.state.currentTerm,
      candidateId: this.config.nodeId,
      lastLogIndex,
      lastLogTerm,
    };

    this.emit('request_vote_sent', { nodeId, request });
  }

  async receiveVoteResponse(response: RequestVoteResponse): Promise<void> {
    if (response.term > this.state.currentTerm) {
      this.state.currentTerm = response.term;
      this.state.role = RaftRole.FOLLOWER;
      this.state.votedFor = null;
      return;
    }

    if (this.state.role !== RaftRole.CANDIDATE) {
      return;
    }

    if (response.voteGranted) {
      this.votesReceived.add(response.voterId);

      if (this.votesReceived.size >= this.getMajority()) {
        await this.becomeLeader();
      }
    }
  }

  async handleRequestVote(request: RequestVoteRequest): Promise<RequestVoteResponse> {
    // Update term if we see a higher one
    if (request.term > this.state.currentTerm) {
      this.state.currentTerm = request.term;
      this.state.role = RaftRole.FOLLOWER;
      this.state.votedFor = null;
    }

    const response: RequestVoteResponse = {
      type: 'request-vote-response',
      term: this.state.currentTerm,
      voteGranted: false,
      voterId: this.config.nodeId,
    };

    // Reject if candidate's term is stale
    if (request.term < this.state.currentTerm) {
      return response;
    }

    // Reject if we already voted for someone else in this term
    if (this.state.votedFor !== null && this.state.votedFor !== request.candidateId) {
      return response;
    }

    // Check if candidate's log is at least as up-to-date as ours
    const lastLogIndex = this.log.length;
    const lastLogTerm = lastLogIndex > 0 ? this.log[lastLogIndex - 1].term : 0;

    const isLogUpToDate =
      request.lastLogTerm > lastLogTerm ||
      (request.lastLogTerm === lastLogTerm && request.lastLogIndex >= lastLogIndex);

    if (!isLogUpToDate) {
      return response;
    }

    // Grant vote
    this.state.votedFor = request.candidateId;
    response.voteGranted = true;

    return response;
  }

  async becomeLeader(): Promise<void> {
    this.state.role = RaftRole.LEADER;
    this.state.leaderId = this.config.nodeId;

    // Initialize leader state
    this.leaderState = {
      nextIndex: new Map(),
      matchIndex: new Map(),
    };

    for (const [nodeId] of this.nodes) {
      if (nodeId !== this.config.nodeId) {
        this.leaderState.nextIndex.set(nodeId, this.log.length + 1);
        this.leaderState.matchIndex.set(nodeId, 0);
      }
    }

    this.emit('leader_elected', { term: this.state.currentTerm, leaderId: this.config.nodeId });

    // Start sending heartbeats
    this.startHeartbeat();
  }

  // ============================================================================
  // Log Replication
  // ============================================================================

  async appendToLog(entry: { command: unknown; term: number }): Promise<void> {
    this.log.push({
      term: entry.term,
      index: this.log.length + 1,
      command: entry.command,
      timestamp: Date.now(),
    });
  }

  sendAppendEntries(nodeId: string, request: AppendEntriesRequest): void {
    this.emit('append_entries_sent', { nodeId, request });
  }

  private sendAppendEntriesToAll(): void {
    for (const [nodeId] of this.nodes) {
      if (nodeId !== this.config.nodeId) {
        const nextIndex = this.leaderState?.nextIndex.get(nodeId) ?? this.log.length + 1;
        const prevLogIndex = nextIndex - 1;
        const prevLogTerm = prevLogIndex > 0 ? this.log[prevLogIndex - 1].term : 0;

        const entries = this.log.slice(nextIndex - 1);

        const request: AppendEntriesRequest = {
          type: 'append-entries',
          term: this.state.currentTerm,
          leaderId: this.config.nodeId,
          prevLogIndex,
          prevLogTerm,
          entries,
          leaderCommit: this.state.commitIndex,
        };

        this.sendAppendEntries(nodeId, request);
      }
    }
  }

  async handleAppendEntries(request: AppendEntriesRequest): Promise<AppendEntriesResponse> {
    const response: AppendEntriesResponse = {
      type: 'append-entries-response',
      term: this.state.currentTerm,
      success: false,
      matchIndex: 0,
      nodeId: this.config.nodeId,
    };

    // Reject if term is stale
    if (request.term < this.state.currentTerm) {
      return response;
    }

    // Update term and recognize leader
    if (request.term > this.state.currentTerm) {
      this.state.currentTerm = request.term;
      this.state.role = RaftRole.FOLLOWER;
      this.state.votedFor = null;
    }

    this.state.leaderId = request.leaderId;
    this.resetElectionTimer();

    // Check log consistency
    if (request.prevLogIndex > 0) {
      if (this.log.length < request.prevLogIndex) {
        return response;
      }

      const prevEntry = this.log[request.prevLogIndex - 1];
      if (prevEntry.term !== request.prevLogTerm) {
        return response;
      }
    }

    // Append new entries
    for (const entry of request.entries) {
      if (entry.index <= this.log.length) {
        // Check for conflicts
        if (this.log[entry.index - 1].term !== entry.term) {
          // Delete conflicting entries
          this.log = this.log.slice(0, entry.index - 1);
        } else {
          continue;
        }
      }
      this.log.push(entry);
    }

    // Update commit index
    if (request.leaderCommit > this.state.commitIndex) {
      this.state.commitIndex = Math.min(request.leaderCommit, this.log.length);
      this.applyCommittedEntries();
    }

    response.success = true;
    response.matchIndex = this.log.length;

    return response;
  }

  async receiveAppendEntriesResponse(response: AppendEntriesResponse): Promise<void> {
    if (response.term > this.state.currentTerm) {
      this.state.currentTerm = response.term;
      this.state.role = RaftRole.FOLLOWER;
      this.state.votedFor = null;
      return;
    }

    if (this.state.role !== RaftRole.LEADER || !this.leaderState) {
      return;
    }

    if (response.success) {
      this.leaderState.matchIndex.set(response.nodeId, response.matchIndex);
      this.leaderState.nextIndex.set(response.nodeId, response.matchIndex + 1);

      // Check if we can advance commit index
      this.updateCommitIndex();
    } else {
      // Decrement nextIndex and retry
      const currentNext = this.leaderState.nextIndex.get(response.nodeId) ?? 1;
      this.leaderState.nextIndex.set(response.nodeId, Math.max(1, currentNext - 1));
    }
  }

  private updateCommitIndex(): void {
    if (!this.leaderState) return;

    // Find the highest index replicated on majority
    for (let n = this.log.length; n > this.state.commitIndex; n--) {
      if (this.log[n - 1].term !== this.state.currentTerm) continue;

      let replicationCount = 1; // Count self
      for (const [, matchIndex] of this.leaderState.matchIndex) {
        if (matchIndex >= n) {
          replicationCount++;
        }
      }

      if (replicationCount >= this.getMajority()) {
        this.state.commitIndex = n;
        this.applyCommittedEntries();

        // Resolve pending proposals
        for (const [proposalId, pending] of this.pendingProposals) {
          if (pending.entry.index <= this.state.commitIndex) {
            pending.resolve(this.createConsensusResult(proposalId, pending.entry, true));
            this.pendingProposals.delete(proposalId);
          }
        }
        break;
      }
    }
  }

  // ============================================================================
  // State Machine Application
  // ============================================================================

  onApply(callback: (entry: RaftLogEntry) => void): void {
    this.applyCallback = callback;
  }

  private applyCommittedEntries(): void {
    while (this.state.lastApplied < this.state.commitIndex) {
      this.state.lastApplied++;
      const entry = this.log[this.state.lastApplied - 1];

      if (this.applyCallback) {
        this.applyCallback(entry);
      }

      this.emit('entry_applied', entry);
    }
  }

  // ============================================================================
  // Heartbeat
  // ============================================================================

  startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      if (this.state.role === RaftRole.LEADER) {
        this.sendHeartbeat();
      }
    }, this.config.heartbeatIntervalMs);
  }

  async sendHeartbeat(): Promise<void> {
    for (const [nodeId] of this.nodes) {
      if (nodeId !== this.config.nodeId) {
        const nextIndex = this.leaderState?.nextIndex.get(nodeId) ?? this.log.length + 1;
        const prevLogIndex = nextIndex - 1;
        const prevLogTerm = prevLogIndex > 0 ? this.log[prevLogIndex - 1].term : 0;

        const request: AppendEntriesRequest = {
          type: 'append-entries',
          term: this.state.currentTerm,
          leaderId: this.config.nodeId,
          prevLogIndex,
          prevLogTerm,
          entries: [], // Empty for heartbeat
          leaderCommit: this.state.commitIndex,
        };

        this.sendAppendEntries(nodeId, request);
      }
    }
  }

  // ============================================================================
  // Election Timer
  // ============================================================================

  private resetElectionTimer(): void {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
    }

    const timeout = this.getRandomElectionTimeout();
    this.electionTimer = setTimeout(() => {
      if (this.state.role !== RaftRole.LEADER) {
        this.startElection();
      }
    }, timeout);
  }

  private getRandomElectionTimeout(): number {
    const { electionTimeoutMinMs, electionTimeoutMaxMs } = this.config;
    return electionTimeoutMinMs + Math.random() * (electionTimeoutMaxMs - electionTimeoutMinMs);
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private createConsensusResult(
    proposalId: string,
    entry: RaftLogEntry,
    accepted: boolean
  ): ConsensusResult {
    return {
      proposalId,
      accepted,
      value: entry.command,
      votes: [],
      timestamp: Date.now(),
      consensusTimeMs: Date.now() - entry.timestamp,
      quorumReached: accepted,
    };
  }
}
