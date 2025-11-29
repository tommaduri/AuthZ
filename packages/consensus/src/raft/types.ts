/**
 * Raft consensus protocol types
 * Leader election and log replication
 */

import type { ConsensusNode } from '../types.js';

// ============================================================================
// Raft Configuration
// ============================================================================

export interface RaftConfig {
  nodeId: string;
  nodes: ConsensusNode[];
  electionTimeoutMinMs: number;
  electionTimeoutMaxMs: number;
  heartbeatIntervalMs: number;
  maxLogEntriesPerRequest: number;
  snapshotThreshold: number;
}

// ============================================================================
// Raft Node States
// ============================================================================

export enum RaftRole {
  FOLLOWER = 'follower',
  CANDIDATE = 'candidate',
  LEADER = 'leader'
}

export interface RaftState {
  role: RaftRole;
  currentTerm: number;
  votedFor: string | null;
  leaderId: string | null;
  commitIndex: number;
  lastApplied: number;
}

export interface LeaderState {
  nextIndex: Map<string, number>;
  matchIndex: Map<string, number>;
}

// ============================================================================
// Raft Log Types
// ============================================================================

export interface RaftLogEntry<T = unknown> {
  term: number;
  index: number;
  command: T;
  timestamp: number;
}

export interface RaftLog<T = unknown> {
  entries: RaftLogEntry<T>[];
  commitIndex: number;
  lastApplied: number;
}

// ============================================================================
// Raft RPC Messages
// ============================================================================

export interface RequestVoteRequest {
  type: 'request-vote';
  term: number;
  candidateId: string;
  lastLogIndex: number;
  lastLogTerm: number;
}

export interface RequestVoteResponse {
  type: 'request-vote-response';
  term: number;
  voteGranted: boolean;
  voterId: string;
}

export interface AppendEntriesRequest<T = unknown> {
  type: 'append-entries';
  term: number;
  leaderId: string;
  prevLogIndex: number;
  prevLogTerm: number;
  entries: RaftLogEntry<T>[];
  leaderCommit: number;
}

export interface AppendEntriesResponse {
  type: 'append-entries-response';
  term: number;
  success: boolean;
  matchIndex: number;
  nodeId: string;
}

export interface InstallSnapshotRequest {
  type: 'install-snapshot';
  term: number;
  leaderId: string;
  lastIncludedIndex: number;
  lastIncludedTerm: number;
  offset: number;
  data: Uint8Array;
  done: boolean;
}

export interface InstallSnapshotResponse {
  type: 'install-snapshot-response';
  term: number;
  nodeId: string;
}

export type RaftMessage<T = unknown> =
  | RequestVoteRequest
  | RequestVoteResponse
  | AppendEntriesRequest<T>
  | AppendEntriesResponse
  | InstallSnapshotRequest
  | InstallSnapshotResponse;

// ============================================================================
// Raft Snapshot
// ============================================================================

export interface RaftSnapshot<T = unknown> {
  lastIncludedIndex: number;
  lastIncludedTerm: number;
  state: T;
  createdAt: number;
}

// ============================================================================
// Raft Events
// ============================================================================

export type RaftEventType =
  | 'state_changed'
  | 'leader_elected'
  | 'term_changed'
  | 'entry_appended'
  | 'entry_committed'
  | 'entry_applied'
  | 'snapshot_created'
  | 'snapshot_installed'
  | 'election_started'
  | 'election_won'
  | 'election_lost'
  | 'heartbeat_sent'
  | 'heartbeat_received';

export interface RaftEvent {
  type: RaftEventType;
  term: number;
  data: unknown;
  timestamp: number;
  nodeId: string;
}

// ============================================================================
// Raft Timers
// ============================================================================

export interface RaftTimers {
  electionTimer: NodeJS.Timeout | null;
  heartbeatTimer: NodeJS.Timeout | null;
}

// ============================================================================
// Raft Cluster Status
// ============================================================================

export interface RaftClusterStatus {
  leaderId: string | null;
  term: number;
  nodeCount: number;
  healthyNodes: number;
  commitIndex: number;
  lastLogIndex: number;
  lastLogTerm: number;
}
