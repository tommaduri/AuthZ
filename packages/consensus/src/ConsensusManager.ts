/**
 * ConsensusManager - Protocol Selection and Management
 * Selects appropriate consensus protocol based on scenario
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
  ConsensusState,
  type ConsensusNode,
  type ConsensusProtocol,
  type ConsensusResult,
  type ConsensusProtocolType,
  type ProtocolSelectionCriteria,
  type ProtocolRecommendation,
} from './types.js';
import { PBFTConsensus } from './pbft/PBFTConsensus.js';
import { RaftConsensus } from './raft/RaftConsensus.js';
import { GossipProtocol } from './gossip/GossipProtocol.js';
import type { PBFTConfig } from './pbft/types.js';
import type { RaftConfig } from './raft/types.js';
import type { GossipConfig } from './gossip/types.js';

export interface ConsensusManagerConfig {
  nodeId: string;
  nodes: ConsensusNode[];
  defaultProtocol: ConsensusProtocolType;
  pbftConfig: Omit<PBFTConfig, 'nodeId' | 'nodes'>;
  raftConfig: Omit<RaftConfig, 'nodeId' | 'nodes'>;
  gossipConfig: Omit<GossipConfig, 'nodeId' | 'nodes'>;
}

export interface HealthStatus {
  isHealthy: boolean;
  currentProtocol: ConsensusProtocolType;
  activeNodes: number;
  lastActivity: number;
}

export interface ConsensusMetrics {
  averageConsensusTimeMs: number;
  totalProposals: number;
  successfulProposals: number;
  failedProposals: number;
  protocolUsage: Record<ConsensusProtocolType, number>;
}

const HIGH_VALUE_THRESHOLD = 1000;
const LARGE_SCALE_NODE_THRESHOLD = 20;

export class ConsensusManager extends EventEmitter implements ConsensusProtocol {
  private config: ConsensusManagerConfig;
  private nodes: Map<string, ConsensusNode>;
  private protocols: Map<ConsensusProtocolType, ConsensusProtocol>;
  private currentProtocol: ConsensusProtocolType;
  private proposals: Map<string, { protocol: ConsensusProtocolType; startTime: number }> = new Map();
  private metrics: ConsensusMetrics;
  private lastActivity: number = Date.now();

  constructor(config: ConsensusManagerConfig) {
    super();
    this.config = config;
    this.nodes = new Map(config.nodes.map(n => [n.id, n]));
    this.currentProtocol = config.defaultProtocol;

    this.metrics = {
      averageConsensusTimeMs: 0,
      totalProposals: 0,
      successfulProposals: 0,
      failedProposals: 0,
      protocolUsage: {
        pbft: 0,
        raft: 0,
        gossip: 0,
      },
    };

    // Initialize all protocol implementations
    this.protocols = new Map();
    this.initializeProtocols();
  }

  private initializeProtocols(): void {
    const { nodeId, nodes, pbftConfig, raftConfig, gossipConfig } = this.config;

    this.protocols.set(
      'pbft',
      new PBFTConsensus({
        nodeId,
        nodes,
        ...pbftConfig,
      })
    );

    this.protocols.set(
      'raft',
      new RaftConsensus({
        nodeId,
        nodes,
        ...raftConfig,
      })
    );

    this.protocols.set(
      'gossip',
      new GossipProtocol({
        nodeId,
        nodes,
        ...gossipConfig,
      })
    );
  }

  // ============================================================================
  // ConsensusProtocol Interface
  // ============================================================================

  async propose(value: unknown): Promise<ConsensusResult> {
    const protocol = this.protocols.get(this.currentProtocol);
    if (!protocol) {
      throw new Error(`Protocol ${this.currentProtocol} not initialized`);
    }

    const proposalId = uuidv4();
    const startTime = Date.now();
    this.proposals.set(proposalId, { protocol: this.currentProtocol, startTime });

    this.metrics.totalProposals++;
    this.metrics.protocolUsage[this.currentProtocol]++;
    this.lastActivity = Date.now();

    try {
      const result = await Promise.race([
        protocol.propose(value),
        this.createTimeout(10000, proposalId),
      ]);

      if (result.accepted) {
        this.metrics.successfulProposals++;
        this.updateAverageConsensusTime(Date.now() - startTime);
        this.emit('consensus_achieved', { proposalId, result });
      } else {
        this.metrics.failedProposals++;
      }

      return result;
    } catch (error) {
      this.metrics.failedProposals++;
      return {
        proposalId,
        accepted: false,
        value,
        votes: [],
        timestamp: Date.now(),
        consensusTimeMs: Date.now() - startTime,
        quorumReached: false,
      };
    }
  }

  async vote(proposalId: string, vote: boolean): Promise<void> {
    const protocol = this.protocols.get(this.currentProtocol);
    if (!protocol) {
      throw new Error(`Protocol ${this.currentProtocol} not initialized`);
    }

    await protocol.vote(proposalId, vote);
  }

  async commit(proposalId: string): Promise<void> {
    const protocol = this.protocols.get(this.currentProtocol);
    if (!protocol) {
      throw new Error(`Protocol ${this.currentProtocol} not initialized`);
    }

    await protocol.commit(proposalId);
  }

  getState(): ConsensusState {
    const protocol = this.protocols.get(this.currentProtocol);
    return protocol?.getState() ?? ConsensusState.IDLE;
  }

  getNodeId(): string {
    return this.config.nodeId;
  }

  addNode(node: ConsensusNode): void {
    this.nodes.set(node.id, node);

    // Propagate to all protocols
    for (const protocol of this.protocols.values()) {
      protocol.addNode(node);
    }
  }

  removeNode(nodeId: string): void {
    this.nodes.delete(nodeId);

    // Propagate to all protocols
    for (const protocol of this.protocols.values()) {
      protocol.removeNode(nodeId);
    }
  }

  getNodes(): ConsensusNode[] {
    return Array.from(this.nodes.values());
  }

  // ============================================================================
  // Protocol Selection
  // ============================================================================

  selectProtocol(criteria: ProtocolSelectionCriteria): ProtocolRecommendation {
    const { transactionValue, isHighStakes, requiresStrongConsistency, nodeCount, latencyRequirement } = criteria;

    // PBFT for high-stakes decisions
    if (
      isHighStakes ||
      (transactionValue !== undefined && transactionValue > HIGH_VALUE_THRESHOLD)
    ) {
      return {
        protocol: 'pbft',
        reason: 'High-stakes transaction requiring Byzantine fault tolerance',
        confidence: 0.95,
      };
    }

    // Gossip for large-scale or eventual consistency
    if (
      !requiresStrongConsistency &&
      (nodeCount > LARGE_SCALE_NODE_THRESHOLD || latencyRequirement === 'high')
    ) {
      return {
        protocol: 'gossip',
        reason: 'Large-scale deployment or eventual consistency acceptable',
        confidence: 0.85,
      };
    }

    // Raft for leader-based coordination with strong consistency
    if (requiresStrongConsistency && latencyRequirement === 'low') {
      return {
        protocol: 'raft',
        reason: 'Strong consistency with low latency requirement',
        confidence: 0.9,
      };
    }

    // Default to Raft for moderate scenarios
    return {
      protocol: 'raft',
      reason: 'General-purpose consensus with strong consistency',
      confidence: 0.8,
    };
  }

  getCurrentProtocol(): ConsensusProtocolType {
    return this.currentProtocol;
  }

  async switchProtocol(protocol: ConsensusProtocolType): Promise<void> {
    if (!this.protocols.has(protocol)) {
      throw new Error(`Unknown protocol: ${protocol}`);
    }

    const previousProtocol = this.currentProtocol;
    this.currentProtocol = protocol;

    this.emit('protocol_switched', { from: previousProtocol, to: protocol });
  }

  hasProtocol(protocol: ConsensusProtocolType): boolean {
    return this.protocols.has(protocol);
  }

  getProtocolInstance(protocol: ConsensusProtocolType): ConsensusProtocol | undefined {
    return this.protocols.get(protocol);
  }

  // ============================================================================
  // Context-Aware Proposals
  // ============================================================================

  async proposeWithContext(
    value: unknown,
    context: Partial<ProtocolSelectionCriteria>
  ): Promise<ConsensusResult> {
    const criteria: ProtocolSelectionCriteria = {
      transactionValue: context.transactionValue,
      isHighStakes: context.isHighStakes ?? false,
      requiresStrongConsistency: context.requiresStrongConsistency ?? true,
      nodeCount: this.nodes.size,
      latencyRequirement: context.latencyRequirement ?? 'medium',
    };

    const recommendation = this.selectProtocol(criteria);

    if (recommendation.protocol !== this.currentProtocol) {
      await this.switchProtocol(recommendation.protocol);
    }

    return this.propose(value);
  }

  async createProposal(value: unknown): Promise<string> {
    const pbft = this.protocols.get('pbft') as PBFTConsensus;
    if (pbft && 'createProposal' in pbft) {
      return pbft.createProposal(value);
    }

    // Generate a proposal ID for other protocols
    return uuidv4();
  }

  async simulateVotes(proposalId: string, count: number): Promise<void> {
    const pbft = this.protocols.get('pbft') as PBFTConsensus;
    if (pbft && 'receiveVote' in pbft) {
      const nodes = this.getNodes();
      for (let i = 0; i < count && i < nodes.length; i++) {
        await pbft.receiveVote({
          proposalId,
          nodeId: nodes[i].id,
          vote: true,
          timestamp: Date.now(),
        });
      }
    }
  }

  // ============================================================================
  // Health Monitoring
  // ============================================================================

  getHealth(): HealthStatus {
    const activeNodes = Array.from(this.nodes.values()).filter(n => n.isActive).length;
    const totalNodes = this.nodes.size;
    const majorityThreshold = Math.floor(totalNodes / 2) + 1;

    return {
      isHealthy: activeNodes >= majorityThreshold,
      currentProtocol: this.currentProtocol,
      activeNodes,
      lastActivity: this.lastActivity,
    };
  }

  markNodeInactive(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.isActive = false;
    }
  }

  // ============================================================================
  // Metrics
  // ============================================================================

  getMetrics(): ConsensusMetrics {
    return { ...this.metrics };
  }

  private updateAverageConsensusTime(timeMs: number): void {
    const { averageConsensusTimeMs, successfulProposals } = this.metrics;
    this.metrics.averageConsensusTimeMs =
      (averageConsensusTimeMs * (successfulProposals - 1) + timeMs) / successfulProposals;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private createTimeout(ms: number, proposalId: string): Promise<ConsensusResult> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          proposalId,
          accepted: false,
          value: null,
          votes: [],
          timestamp: Date.now(),
          consensusTimeMs: ms,
          quorumReached: false,
        });
      }, ms);
    });
  }
}
