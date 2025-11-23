/**
 * PBFT (Practical Byzantine Fault Tolerance) specific types
 * Implements three-phase protocol: Pre-prepare, Prepare, Commit
 */

import type { ConsensusNode, SignedMessage } from '../types.js';

// ============================================================================
// PBFT Configuration
// ============================================================================

export interface PBFTConfig {
  nodeId: string;
  nodes: ConsensusNode[];
  viewChangeTimeoutMs: number;
  requestTimeoutMs: number;
  checkpointInterval: number;
  watermarkWindow: number;
}

// ============================================================================
// PBFT States
// ============================================================================

export enum PBFTPhase {
  IDLE = 'idle',
  PRE_PREPARE = 'pre-prepare',
  PREPARE = 'prepare',
  COMMIT = 'commit',
  REPLY = 'reply',
  VIEW_CHANGE = 'view-change'
}

export interface PBFTState {
  viewNumber: number;
  sequenceNumber: number;
  phase: PBFTPhase;
  primaryId: string;
  lastExecuted: number;
  lowWatermark: number;
  highWatermark: number;
}

// ============================================================================
// PBFT Messages
// ============================================================================

export interface PrePrepareMessage {
  type: 'pre-prepare';
  viewNumber: number;
  sequenceNumber: number;
  digest: string;
  request: unknown;
  primaryId: string;
  timestamp: number;
}

export interface PrepareMessage {
  type: 'prepare';
  viewNumber: number;
  sequenceNumber: number;
  digest: string;
  nodeId: string;
  timestamp: number;
}

export interface CommitMessage {
  type: 'commit';
  viewNumber: number;
  sequenceNumber: number;
  digest: string;
  nodeId: string;
  timestamp: number;
}

export interface ViewChangeMessage {
  type: 'view-change';
  newViewNumber: number;
  lastStableCheckpoint: number;
  checkpointProof: CheckpointProof[];
  preparedProofs: PreparedProof[];
  nodeId: string;
  timestamp: number;
}

export interface NewViewMessage {
  type: 'new-view';
  viewNumber: number;
  viewChanges: SignedMessage<ViewChangeMessage>[];
  prePrepares: SignedMessage<PrePrepareMessage>[];
  primaryId: string;
  timestamp: number;
}

export type PBFTMessage =
  | PrePrepareMessage
  | PrepareMessage
  | CommitMessage
  | ViewChangeMessage
  | NewViewMessage;

// ============================================================================
// PBFT Proofs
// ============================================================================

export interface CheckpointProof {
  sequenceNumber: number;
  digest: string;
  signatures: Map<string, string>;
}

export interface PreparedProof {
  sequenceNumber: number;
  viewNumber: number;
  digest: string;
  prePrepare: SignedMessage<PrePrepareMessage>;
  prepares: SignedMessage<PrepareMessage>[];
}

// ============================================================================
// PBFT Log Entries
// ============================================================================

export interface PBFTLogEntry {
  sequenceNumber: number;
  viewNumber: number;
  digest: string;
  request: unknown;
  prePrepare: SignedMessage<PrePrepareMessage> | null;
  prepares: Map<string, SignedMessage<PrepareMessage>>;
  commits: Map<string, SignedMessage<CommitMessage>>;
  isPrepared: boolean;
  isCommitted: boolean;
  isExecuted: boolean;
  result?: unknown;
}

// ============================================================================
// PBFT Request/Reply
// ============================================================================

export interface PBFTRequest<T = unknown> {
  operation: T;
  timestamp: number;
  clientId: string;
  requestId: string;
}

export interface PBFTReply<T = unknown> {
  viewNumber: number;
  timestamp: number;
  clientId: string;
  nodeId: string;
  result: T;
  requestId: string;
}

// ============================================================================
// PBFT Events
// ============================================================================

export type PBFTEventType =
  | 'pre_prepare_received'
  | 'prepare_received'
  | 'commit_received'
  | 'prepared'
  | 'committed'
  | 'executed'
  | 'view_change_started'
  | 'view_change_completed'
  | 'checkpoint_created'
  | 'byzantine_detected';

export interface PBFTEvent {
  type: PBFTEventType;
  sequenceNumber: number;
  viewNumber: number;
  data: unknown;
  timestamp: number;
}
