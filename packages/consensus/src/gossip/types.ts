/**
 * Gossip protocol types for eventual consistency
 * Epidemic-style information dissemination
 */

import type { ConsensusNode } from '../types.js';

// ============================================================================
// Gossip Configuration
// ============================================================================

export interface GossipConfig {
  nodeId: string;
  nodes: ConsensusNode[];
  fanout: number;
  gossipIntervalMs: number;
  maxRoundsToKeep: number;
  antiEntropyIntervalMs: number;
  maxMessageAge: number;
  maxPendingMessages: number;
}

// ============================================================================
// Gossip State
// ============================================================================

export interface GossipState {
  vectorClock: Map<string, number>;
  knownPeers: Map<string, PeerState>;
  pendingUpdates: Map<string, GossipUpdate>;
  lastGossipRound: number;
}

export interface PeerState {
  nodeId: string;
  lastSeen: number;
  isAlive: boolean;
  suspicionLevel: number;
  heartbeatCounter: number;
  metadata: Record<string, unknown>;
}

// ============================================================================
// Gossip Messages
// ============================================================================

export interface GossipMessage {
  type: 'push' | 'pull' | 'push-pull';
  senderId: string;
  vectorClock: Map<string, number>;
  updates: GossipUpdate[];
  timestamp: number;
  roundNumber: number;
}

export interface GossipUpdate<T = unknown> {
  key: string;
  value: T;
  version: number;
  timestamp: number;
  originNodeId: string;
  ttl: number;
}

export interface GossipAck {
  type: 'ack';
  senderId: string;
  receivedUpdates: string[];
  timestamp: number;
}

export interface AntiEntropyRequest {
  type: 'anti-entropy-request';
  senderId: string;
  vectorClock: Map<string, number>;
  timestamp: number;
}

export interface AntiEntropyResponse {
  type: 'anti-entropy-response';
  senderId: string;
  missingUpdates: GossipUpdate[];
  timestamp: number;
}

export type GossipProtocolMessage =
  | GossipMessage
  | GossipAck
  | AntiEntropyRequest
  | AntiEntropyResponse;

// ============================================================================
// Membership
// ============================================================================

export interface MembershipUpdate {
  type: 'join' | 'leave' | 'suspect' | 'alive';
  nodeId: string;
  timestamp: number;
  incarnation: number;
  metadata?: Record<string, unknown>;
}

export interface SwimMessage {
  type: 'ping' | 'ping-req' | 'ack' | 'nack';
  senderId: string;
  targetId: string;
  incarnation: number;
  timestamp: number;
}

// ============================================================================
// Conflict Resolution
// ============================================================================

export type ConflictResolutionStrategy =
  | 'last-write-wins'
  | 'first-write-wins'
  | 'merge'
  | 'custom';

export interface ConflictResolver<T = unknown> {
  resolve(existing: T, incoming: T, metadata: ConflictMetadata): T;
}

export interface ConflictMetadata {
  existingTimestamp: number;
  incomingTimestamp: number;
  existingOrigin: string;
  incomingOrigin: string;
  existingVersion: number;
  incomingVersion: number;
}

// ============================================================================
// Gossip Events
// ============================================================================

export type GossipEventType =
  | 'update_received'
  | 'update_propagated'
  | 'conflict_detected'
  | 'conflict_resolved'
  | 'peer_joined'
  | 'peer_left'
  | 'peer_suspected'
  | 'peer_confirmed'
  | 'anti_entropy_sync'
  | 'convergence_detected';

export interface GossipEvent {
  type: GossipEventType;
  data: unknown;
  timestamp: number;
  nodeId: string;
}

// ============================================================================
// Gossip Metrics
// ============================================================================

export interface GossipMetrics {
  messagesSent: number;
  messagesReceived: number;
  updatesProposed: number;
  updatesPropagated: number;
  conflictsDetected: number;
  conflictsResolved: number;
  peersKnown: number;
  peersActive: number;
  averageConvergenceTimeMs: number;
  lastGossipRound: number;
}

// ============================================================================
// Convergence Detection
// ============================================================================

export interface ConvergenceStatus {
  isConverged: boolean;
  convergencePercentage: number;
  pendingUpdates: number;
  lastCheckTimestamp: number;
  estimatedTimeToConvergenceMs: number;
}
