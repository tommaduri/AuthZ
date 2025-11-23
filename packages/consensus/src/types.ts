/**
 * Core types for distributed consensus protocols
 * Supporting PBFT, Raft, and Gossip protocols
 */

// ============================================================================
// Base Consensus Types
// ============================================================================

export enum ConsensusState {
  IDLE = 'idle',
  PROPOSING = 'proposing',
  VOTING = 'voting',
  COMMITTING = 'committing',
  COMMITTED = 'committed',
  FAILED = 'failed'
}

export type ConsensusProtocolType = 'pbft' | 'raft' | 'gossip';
export type VoteType = 'approve' | 'reject' | 'abstain';

export interface ConsensusConfig {
  protocol: ConsensusProtocolType;
  quorumThreshold: number;
  timeoutMs: number;
  maxRetries: number;
  nodeId: string;
}

export interface ConsensusNode {
  id: string;
  address: string;
  publicKey?: string;
  weight?: number;
  isActive: boolean;
  lastSeen: number;
}

export interface Vote {
  proposalId: string;
  nodeId: string;
  vote: boolean;
  signature?: string;
  timestamp: number;
}

export interface ConsensusResult {
  proposalId: string;
  accepted: boolean;
  value: unknown;
  votes: Vote[];
  timestamp: number;
  consensusTimeMs: number;
  quorumReached: boolean;
}

export interface ConsensusProtocol {
  propose(value: unknown): Promise<ConsensusResult>;
  vote(proposalId: string, vote: boolean): Promise<void>;
  commit(proposalId: string): Promise<void>;
  getState(): ConsensusState;
  getNodeId(): string;
  addNode(node: ConsensusNode): void;
  removeNode(nodeId: string): void;
  getNodes(): ConsensusNode[];
}

// ============================================================================
// Proposal Types
// ============================================================================

export interface Proposal<T = unknown> {
  id: string;
  type: string;
  data: T;
  proposerId: string;
  timestamp: number;
  expiresAt: number;
  sequenceNumber: number;
}

export interface ProposalContext {
  transactionValue?: number;
  isAdminAction?: boolean;
  resourceType?: string;
  urgency?: 'low' | 'medium' | 'high' | 'critical';
}

// ============================================================================
// Message Authentication
// ============================================================================

export interface SignedMessage<T = unknown> {
  payload: T;
  signature: string;
  senderId: string;
  timestamp: number;
  messageId: string;
}

export interface MessageAuthenticator {
  sign(message: unknown, privateKey: string): string;
  verify(message: unknown, signature: string, publicKey: string): boolean;
}

// ============================================================================
// Event Types
// ============================================================================

export type ConsensusEventType =
  | 'proposal_created'
  | 'vote_received'
  | 'quorum_reached'
  | 'consensus_achieved'
  | 'consensus_failed'
  | 'view_change'
  | 'leader_elected'
  | 'state_synced';

export interface ConsensusEvent {
  type: ConsensusEventType;
  proposalId?: string;
  data: unknown;
  timestamp: number;
  nodeId: string;
}

// ============================================================================
// Protocol Selection Criteria
// ============================================================================

export interface ProtocolSelectionCriteria {
  transactionValue?: number;
  isHighStakes: boolean;
  requiresStrongConsistency: boolean;
  nodeCount: number;
  latencyRequirement: 'low' | 'medium' | 'high';
}

export interface ProtocolRecommendation {
  protocol: ConsensusProtocolType;
  reason: string;
  confidence: number;
}
