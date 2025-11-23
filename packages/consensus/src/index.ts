/**
 * @authz-engine/consensus
 * Distributed consensus protocols for the AuthZ Engine Native Agentic Framework
 *
 * Provides three consensus protocols:
 * - PBFT: Practical Byzantine Fault Tolerance for high-stakes decisions
 * - Raft: Leader election and log replication for general use
 * - Gossip: Eventual consistency for large-scale deployments
 */

// Core types
export {
  ConsensusState,
  type ConsensusProtocolType,
  type VoteType,
  type ConsensusConfig,
  type ConsensusNode,
  type Vote,
  type ConsensusResult,
  type ConsensusProtocol,
  type Proposal,
  type ProposalContext,
  type SignedMessage,
  type MessageAuthenticator,
  type ConsensusEventType,
  type ConsensusEvent,
  type ProtocolSelectionCriteria,
  type ProtocolRecommendation,
} from './types.js';

// PBFT (Practical Byzantine Fault Tolerance)
export { PBFTConsensus } from './pbft/PBFTConsensus.js';
export {
  PBFTPhase,
  type PBFTConfig,
  type PBFTState,
  type PrePrepareMessage,
  type PrepareMessage,
  type CommitMessage,
  type ViewChangeMessage,
  type NewViewMessage,
  type PBFTMessage,
  type CheckpointProof,
  type PreparedProof,
  type PBFTLogEntry,
  type PBFTRequest,
  type PBFTReply,
  type PBFTEventType,
  type PBFTEvent,
} from './pbft/types.js';

// Raft Consensus
export { RaftConsensus } from './raft/RaftConsensus.js';
export {
  RaftRole,
  type RaftConfig,
  type RaftState,
  type LeaderState,
  type RaftLogEntry,
  type RaftLog,
  type RequestVoteRequest,
  type RequestVoteResponse,
  type AppendEntriesRequest,
  type AppendEntriesResponse,
  type InstallSnapshotRequest,
  type InstallSnapshotResponse,
  type RaftMessage,
  type RaftSnapshot,
  type RaftEventType,
  type RaftEvent,
  type RaftTimers,
  type RaftClusterStatus,
} from './raft/types.js';

// Gossip Protocol
export { GossipProtocol } from './gossip/GossipProtocol.js';
export {
  type GossipConfig,
  type GossipState,
  type PeerState,
  type GossipMessage,
  type GossipUpdate,
  type GossipAck,
  type AntiEntropyRequest,
  type AntiEntropyResponse,
  type GossipProtocolMessage,
  type MembershipUpdate,
  type SwimMessage,
  type ConflictResolutionStrategy,
  type ConflictResolver,
  type ConflictMetadata,
  type GossipEventType,
  type GossipEvent,
  type GossipMetrics,
  type ConvergenceStatus,
} from './gossip/types.js';

// Consensus Manager
export {
  ConsensusManager,
  type ConsensusManagerConfig,
  type HealthStatus,
  type ConsensusMetrics,
} from './ConsensusManager.js';
