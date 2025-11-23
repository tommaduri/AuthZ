/**
 * PBFT (Practical Byzantine Fault Tolerance) Consensus Implementation
 * Implements three-phase protocol: Pre-prepare, Prepare, Commit
 * Tolerates f < n/3 Byzantine faults
 */

import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  ConsensusState,
  type ConsensusNode,
  type ConsensusProtocol,
  type ConsensusResult,
  type Vote,
} from '../types.js';
import {
  PBFTPhase,
  type PBFTConfig,
  type PBFTState,
  type PBFTLogEntry,
  type PrePrepareMessage,
} from './types.js';

export class PBFTConsensus extends EventEmitter implements ConsensusProtocol {
  private config: PBFTConfig;
  private nodes: Map<string, ConsensusNode>;
  private state: PBFTState;
  private consensusState: ConsensusState = ConsensusState.IDLE;
  private log: Map<number, PBFTLogEntry> = new Map();
  private proposals: Map<string, { value: unknown; sequenceNumber: number }> = new Map();
  private votes: Map<string, Map<string, Vote>> = new Map();
  private suspectedByzantine: Set<string> = new Set();
  private viewChangeTimer: NodeJS.Timeout | null = null;

  constructor(config: PBFTConfig) {
    super();
    this.config = config;
    this.nodes = new Map(config.nodes.map(n => [n.id, n]));

    this.state = {
      viewNumber: 0,
      sequenceNumber: 0,
      phase: PBFTPhase.IDLE,
      primaryId: this.calculatePrimary(0),
      lastExecuted: 0,
      lowWatermark: 0,
      highWatermark: config.watermarkWindow,
    };
  }

  // ============================================================================
  // ConsensusProtocol Interface
  // ============================================================================

  async propose(value: unknown): Promise<ConsensusResult> {
    if (!this.isPrimary()) {
      throw new Error('Only primary can propose');
    }

    const proposalId = await this.createProposal(value);
    this.consensusState = ConsensusState.PROPOSING;
    this.state.phase = PBFTPhase.PRE_PREPARE;

    // Create and broadcast pre-prepare
    const prePrepare = this.createPrePrepareMessage(proposalId, value);
    this.emit('pre_prepare_created', prePrepare);

    // Wait for consensus
    return this.waitForConsensus(proposalId);
  }

  async vote(proposalId: string, vote: boolean): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error('Proposal not found');
    }

    await this.receiveVote({
      proposalId,
      nodeId: this.config.nodeId,
      vote,
      timestamp: Date.now(),
    });
  }

  async commit(proposalId: string): Promise<void> {
    if (!this.hasQuorum(proposalId)) {
      throw new Error('Quorum not reached');
    }

    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error('Proposal not found');
    }

    const entry = this.log.get(proposal.sequenceNumber);
    if (entry) {
      entry.isCommitted = true;
      this.consensusState = ConsensusState.COMMITTED;
      this.state.phase = PBFTPhase.REPLY;
      this.emit('committed', { proposalId, sequenceNumber: proposal.sequenceNumber });
    }
  }

  getState(): ConsensusState {
    return this.consensusState;
  }

  getNodeId(): string {
    return this.config.nodeId;
  }

  addNode(node: ConsensusNode): void {
    this.nodes.set(node.id, node);
  }

  removeNode(nodeId: string): void {
    if (nodeId === this.state.primaryId) {
      throw new Error('Cannot remove primary');
    }
    this.nodes.delete(nodeId);
  }

  getNodes(): ConsensusNode[] {
    return Array.from(this.nodes.values());
  }

  // ============================================================================
  // PBFT-Specific Methods
  // ============================================================================

  getViewNumber(): number {
    return this.state.viewNumber;
  }

  getSequenceNumber(): number {
    return this.state.sequenceNumber;
  }

  getPhase(): PBFTPhase {
    return this.state.phase;
  }

  getPrimaryId(): string {
    return this.state.primaryId;
  }

  isPrimary(): boolean {
    return this.config.nodeId === this.state.primaryId;
  }

  getMaxFaults(): number {
    // f < n/3, so f = floor((n-1)/3)
    return Math.floor((this.nodes.size - 1) / 3);
  }

  getQuorumSize(): number {
    // Quorum = 2f + 1
    return 2 * this.getMaxFaults() + 1;
  }

  async createProposal(value: unknown): Promise<string> {
    const proposalId = uuidv4();
    this.state.sequenceNumber++;
    this.state.phase = PBFTPhase.PRE_PREPARE;
    this.consensusState = ConsensusState.PROPOSING;

    const entry: PBFTLogEntry = {
      sequenceNumber: this.state.sequenceNumber,
      viewNumber: this.state.viewNumber,
      digest: this.computeDigest(value),
      request: value,
      prePrepare: null,
      prepares: new Map(),
      commits: new Map(),
      isPrepared: false,
      isCommitted: false,
      isExecuted: false,
    };

    this.log.set(this.state.sequenceNumber, entry);
    this.proposals.set(proposalId, { value, sequenceNumber: this.state.sequenceNumber });
    this.votes.set(proposalId, new Map());

    return proposalId;
  }

  async receiveVote(vote: Vote): Promise<void> {
    const proposalVotes = this.votes.get(vote.proposalId);
    if (!proposalVotes) {
      throw new Error('Proposal not found');
    }

    const existingVote = proposalVotes.get(vote.nodeId);
    if (existingVote) {
      // Check for conflicting vote (Byzantine behavior)
      if (existingVote.vote !== vote.vote) {
        this.suspectedByzantine.add(vote.nodeId);
        throw new Error('Conflicting vote detected');
      }
      // Duplicate vote, ignore
      return;
    }

    proposalVotes.set(vote.nodeId, vote);

    // Check if we've reached quorum for prepare phase
    if (this.hasQuorum(vote.proposalId) && this.state.phase === PBFTPhase.PREPARE) {
      this.state.phase = PBFTPhase.COMMIT;
      this.emit('prepared', { proposalId: vote.proposalId });
    }
  }

  getVoteCount(proposalId: string): number {
    const proposalVotes = this.votes.get(proposalId);
    if (!proposalVotes) return 0;
    return Array.from(proposalVotes.values()).filter(v => v.vote).length;
  }

  hasQuorum(proposalId: string): boolean {
    return this.getVoteCount(proposalId) >= this.getQuorumSize();
  }

  async getConsensusResult(proposalId: string): Promise<ConsensusResult> {
    const proposal = this.proposals.get(proposalId);
    const votes = this.votes.get(proposalId);

    if (!proposal || !votes) {
      throw new Error('Proposal not found');
    }

    const voteArray = Array.from(votes.values());
    const approveCount = voteArray.filter(v => v.vote).length;
    const accepted = approveCount >= this.getQuorumSize();

    return {
      proposalId,
      accepted,
      value: proposal.value,
      votes: voteArray,
      timestamp: Date.now(),
      consensusTimeMs: 0,
      quorumReached: accepted,
    };
  }

  isSuspectedByzantine(nodeId: string): boolean {
    return this.suspectedByzantine.has(nodeId);
  }

  // ============================================================================
  // View Change
  // ============================================================================

  startViewChangeTimer(): void {
    if (this.viewChangeTimer) {
      clearTimeout(this.viewChangeTimer);
    }

    this.viewChangeTimer = setTimeout(() => {
      this.state.phase = PBFTPhase.VIEW_CHANGE;
      this.emit('view_change_timeout');
    }, this.config.viewChangeTimeoutMs);
  }

  async initiateViewChange(): Promise<void> {
    this.state.viewNumber++;
    this.state.primaryId = this.calculatePrimary(this.state.viewNumber);
    this.state.phase = PBFTPhase.VIEW_CHANGE;

    this.emit('view_change', {
      newViewNumber: this.state.viewNumber,
      newPrimaryId: this.state.primaryId,
    });
  }

  // ============================================================================
  // Message Handling
  // ============================================================================

  async receivePrePrepare(_proposalId: string): Promise<void> {
    this.state.phase = PBFTPhase.PREPARE;
    this.emit('pre_prepare_received', { _proposalId });
  }

  private createPrePrepareMessage(_proposalId: string, value: unknown): PrePrepareMessage {
    return {
      type: 'pre-prepare',
      viewNumber: this.state.viewNumber,
      sequenceNumber: this.state.sequenceNumber,
      digest: this.computeDigest(value),
      request: value,
      primaryId: this.config.nodeId,
      timestamp: Date.now(),
    };
  }

  // ============================================================================
  // Digest and Verification
  // ============================================================================

  computeDigest(data: unknown): string {
    const serialized = JSON.stringify(data, Object.keys(data as object).sort());
    return createHash('sha256').update(serialized).digest('hex');
  }

  verifyDigest(data: unknown, digest: string): boolean {
    return this.computeDigest(data) === digest;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private calculatePrimary(viewNumber: number): string {
    const nodeIds = Array.from(this.nodes.keys()).sort();
    return nodeIds[viewNumber % nodeIds.length];
  }

  private async waitForConsensus(proposalId: string): Promise<ConsensusResult> {
    const startTime = Date.now();

    // Simulate consensus process
    // In a real implementation, this would wait for network messages
    return new Promise((resolve) => {
      const checkConsensus = () => {
        if (this.hasQuorum(proposalId) || Date.now() - startTime > this.config.requestTimeoutMs) {
          resolve(this.getConsensusResult(proposalId));
        } else {
          setTimeout(checkConsensus, 50);
        }
      };
      checkConsensus();
    });
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  stop(): void {
    if (this.viewChangeTimer) {
      clearTimeout(this.viewChangeTimer);
      this.viewChangeTimer = null;
    }
  }
}
