/**
 * Gossip Protocol Implementation
 * Epidemic-style information dissemination for eventual consistency
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
  ConsensusState,
  type ConsensusNode,
  type ConsensusProtocol,
  type ConsensusResult,
} from '../types.js';
import type {
  GossipConfig,
  GossipState,
  GossipUpdate,
  GossipMessage,
  GossipAck,
  PeerState,
  ConflictResolver,
  GossipMetrics,
  ConvergenceStatus,
} from './types.js';

export class GossipProtocol extends EventEmitter implements ConsensusProtocol {
  private config: GossipConfig;
  private nodes: Map<string, ConsensusNode>;
  private state: GossipState;
  private updates: Map<string, GossipUpdate> = new Map();
  private conflictResolver: ConflictResolver | null = null;
  private gossipTimer: NodeJS.Timeout | null = null;
  private antiEntropyTimer: NodeJS.Timeout | null = null;
  private metrics: GossipMetrics;
  private acknowledgments: Map<string, Set<string>> = new Map();

  constructor(config: GossipConfig) {
    super();
    this.config = config;
    this.nodes = new Map(config.nodes.map(n => [n.id, n]));

    const vectorClock = new Map<string, number>();
    const knownPeers = new Map<string, PeerState>();

    for (const node of config.nodes) {
      vectorClock.set(node.id, 0);
      knownPeers.set(node.id, {
        nodeId: node.id,
        lastSeen: Date.now(),
        isAlive: true,
        suspicionLevel: 0,
        heartbeatCounter: 0,
        metadata: {},
      });
    }

    this.state = {
      vectorClock,
      knownPeers,
      pendingUpdates: new Map(),
      lastGossipRound: 0,
    };

    this.metrics = {
      messagesSent: 0,
      messagesReceived: 0,
      updatesProposed: 0,
      updatesPropagated: 0,
      conflictsDetected: 0,
      conflictsResolved: 0,
      peersKnown: config.nodes.length,
      peersActive: config.nodes.length,
      averageConvergenceTimeMs: 0,
      lastGossipRound: 0,
    };
  }

  // ============================================================================
  // ConsensusProtocol Interface
  // ============================================================================

  async propose(value: unknown): Promise<ConsensusResult> {
    const proposalId = uuidv4();
    this.incrementClock();
    this.metrics.updatesProposed++;

    const update: GossipUpdate = {
      key: (value as any).key || proposalId,
      value: (value as any).value || value,
      version: this.state.vectorClock.get(this.config.nodeId) || 1,
      timestamp: Date.now(),
      originNodeId: this.config.nodeId,
      ttl: this.config.maxRoundsToKeep,
    };

    this.updates.set(update.key, update);
    this.acknowledgments.set(update.key, new Set([this.config.nodeId]));

    this.emit('update_proposed', { proposalId, update });

    // Gossip achieves eventual consistency - immediately return success
    return {
      proposalId,
      accepted: true,
      value,
      votes: [],
      timestamp: Date.now(),
      consensusTimeMs: 0,
      quorumReached: true,
    };
  }

  async vote(_proposalId: string, _vote: boolean): Promise<void> {
    // Gossip doesn't use explicit voting
  }

  async commit(_proposalId: string): Promise<void> {
    // Gossip achieves eventual consistency, no explicit commit needed
  }

  getState(): ConsensusState {
    return ConsensusState.IDLE;
  }

  getNodeId(): string {
    return this.config.nodeId;
  }

  addNode(node: ConsensusNode): void {
    this.nodes.set(node.id, node);
    this.state.vectorClock.set(node.id, 0);
    this.state.knownPeers.set(node.id, {
      nodeId: node.id,
      lastSeen: Date.now(),
      isAlive: true,
      suspicionLevel: 0,
      heartbeatCounter: 0,
      metadata: {},
    });
    this.metrics.peersKnown++;
    this.metrics.peersActive++;
  }

  removeNode(nodeId: string): void {
    this.nodes.delete(nodeId);
    this.state.vectorClock.delete(nodeId);
    this.state.knownPeers.delete(nodeId);
    this.metrics.peersKnown--;
    this.metrics.peersActive--;
  }

  getNodes(): ConsensusNode[] {
    return Array.from(this.nodes.values());
  }

  // ============================================================================
  // Vector Clock Operations
  // ============================================================================

  getVectorClock(): Map<string, number> {
    return new Map(this.state.vectorClock);
  }

  incrementClock(): void {
    const current = this.state.vectorClock.get(this.config.nodeId) || 0;
    this.state.vectorClock.set(this.config.nodeId, current + 1);
  }

  mergeVectorClock(remote: Map<string, number>): void {
    for (const [nodeId, timestamp] of remote) {
      const local = this.state.vectorClock.get(nodeId) || 0;
      this.state.vectorClock.set(nodeId, Math.max(local, timestamp));
    }
  }

  isConcurrent(remote: Map<string, number>): boolean {
    const local = this.state.vectorClock;
    let localAhead = false;
    let remoteAhead = false;

    for (const nodeId of new Set([...local.keys(), ...remote.keys()])) {
      const localVal = local.get(nodeId) || 0;
      const remoteVal = remote.get(nodeId) || 0;

      if (localVal > remoteVal) localAhead = true;
      if (remoteVal > localVal) remoteAhead = true;
    }

    return localAhead && remoteAhead;
  }

  happensBefore(remote: Map<string, number>): boolean {
    const local = this.state.vectorClock;

    for (const [nodeId, localVal] of local) {
      const remoteVal = remote.get(nodeId) || 0;
      if (localVal < remoteVal) return false;
    }

    // Check if at least one is strictly greater
    for (const [nodeId, localVal] of local) {
      const remoteVal = remote.get(nodeId) || 0;
      if (localVal > remoteVal) return true;
    }

    return false;
  }

  // ============================================================================
  // Gossip Dissemination
  // ============================================================================

  start(): void {
    this.startGossipTimer();
    this.startAntiEntropyTimer();
  }

  stop(): void {
    if (this.gossipTimer) {
      clearInterval(this.gossipTimer);
      this.gossipTimer = null;
    }
    if (this.antiEntropyTimer) {
      clearInterval(this.antiEntropyTimer);
      this.antiEntropyTimer = null;
    }
  }

  private startGossipTimer(): void {
    this.gossipTimer = setInterval(() => {
      this.gossipRound();
    }, this.config.gossipIntervalMs);
  }

  private startAntiEntropyTimer(): void {
    this.antiEntropyTimer = setInterval(() => {
      this.runAntiEntropy();
      this.updatePeerSuspicion();
    }, this.config.antiEntropyIntervalMs);
  }

  selectGossipTargets(): string[] {
    const candidates = Array.from(this.nodes.keys()).filter(
      id => id !== this.config.nodeId
    );

    // Fisher-Yates shuffle and take fanout
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    return candidates.slice(0, this.config.fanout);
  }

  createGossipMessage(): GossipMessage {
    this.state.lastGossipRound++;

    const updatesToSend = Array.from(this.updates.values()).filter(
      u => u.ttl > 0
    );

    return {
      type: 'push',
      senderId: this.config.nodeId,
      vectorClock: new Map(this.state.vectorClock),
      updates: updatesToSend,
      timestamp: Date.now(),
      roundNumber: this.state.lastGossipRound,
    };
  }

  async gossipRound(): Promise<void> {
    const targets = this.selectGossipTargets();
    const message = this.createGossipMessage();

    for (const target of targets) {
      this.sendGossipMessage(target, message);
    }

    this.metrics.lastGossipRound = this.state.lastGossipRound;
  }

  sendGossipMessage(targetId: string, message: GossipMessage): void {
    this.metrics.messagesSent++;
    this.emit('gossip_sent', { targetId, message });
  }

  // ============================================================================
  // Update Handling
  // ============================================================================

  async handleUpdate(update: GossipUpdate): Promise<void> {
    const existing = this.updates.get(update.key);

    if (existing) {
      // Conflict detection
      if (this.conflictResolver) {
        const resolved = this.conflictResolver.resolve(existing.value, update.value, {
          existingTimestamp: existing.timestamp,
          incomingTimestamp: update.timestamp,
          existingOrigin: existing.originNodeId,
          incomingOrigin: update.originNodeId,
          existingVersion: existing.version,
          incomingVersion: update.version,
        });
        this.updates.set(update.key, { ...update, value: resolved });
        this.metrics.conflictsDetected++;
        this.metrics.conflictsResolved++;
      } else {
        // Last-write-wins
        if (update.timestamp > existing.timestamp) {
          this.updates.set(update.key, { ...update, ttl: update.ttl - 1 });
        }
      }
    } else {
      this.updates.set(update.key, { ...update, ttl: update.ttl - 1 });
    }

    this.emit('update_received', { key: update.key, value: update.value });
  }

  getValue(key: string): unknown | undefined {
    return this.updates.get(key)?.value;
  }

  getUpdate(key: string): GossipUpdate | undefined {
    return this.updates.get(key);
  }

  // ============================================================================
  // Message Handling
  // ============================================================================

  async handleGossipMessage(message: GossipMessage): Promise<GossipMessage | null> {
    this.metrics.messagesReceived++;

    // Update peer state
    const peerState = this.state.knownPeers.get(message.senderId);
    if (peerState) {
      peerState.lastSeen = Date.now();
      peerState.isAlive = true;
      peerState.suspicionLevel = 0;
    }

    // Merge vector clock
    this.mergeVectorClock(message.vectorClock);

    // Process updates
    for (const update of message.updates) {
      await this.handleUpdate(update);
    }

    // Respond based on message type
    if (message.type === 'pull' || message.type === 'push-pull') {
      // Send our updates that might be missing
      const ourUpdates = this.getUpdatesMissing(message.vectorClock);

      return {
        type: 'push',
        senderId: this.config.nodeId,
        vectorClock: new Map(this.state.vectorClock),
        updates: ourUpdates,
        timestamp: Date.now(),
        roundNumber: this.state.lastGossipRound,
      };
    }

    return null;
  }

  private getUpdatesMissing(remoteClock: Map<string, number>): GossipUpdate[] {
    const missing: GossipUpdate[] = [];

    for (const [_key, update] of this.updates) {
      const remoteVersion = remoteClock.get(update.originNodeId) || 0;
      if (update.version > remoteVersion && update.ttl > 0) {
        missing.push(update);
      }
    }

    return missing;
  }

  handleAck(ack: GossipAck): void {
    for (const key of ack.receivedUpdates) {
      const acks = this.acknowledgments.get(key);
      if (acks) {
        acks.add(ack.senderId);
      }
    }
  }

  // ============================================================================
  // Anti-Entropy
  // ============================================================================

  async runAntiEntropy(): Promise<void> {
    // Select a random peer for anti-entropy sync
    const peers = Array.from(this.nodes.keys()).filter(
      id => id !== this.config.nodeId
    );

    if (peers.length === 0) return;

    const target = peers[Math.floor(Math.random() * peers.length)];
    this.sendAntiEntropyRequest(target);
  }

  sendAntiEntropyRequest(targetId: string): void {
    this.emit('anti_entropy_request', {
      targetId,
      vectorClock: new Map(this.state.vectorClock),
    });
  }

  // ============================================================================
  // Peer Management
  // ============================================================================

  isPeerAlive(nodeId: string): boolean {
    return this.state.knownPeers.get(nodeId)?.isAlive ?? false;
  }

  getPeerState(nodeId: string): PeerState | undefined {
    return this.state.knownPeers.get(nodeId);
  }

  private updatePeerSuspicion(): void {
    const now = Date.now();
    const suspicionThreshold = this.config.antiEntropyIntervalMs * 2;

    for (const [nodeId, peer] of this.state.knownPeers) {
      if (nodeId === this.config.nodeId) continue;

      const timeSinceLastSeen = now - peer.lastSeen;
      if (timeSinceLastSeen > suspicionThreshold) {
        peer.suspicionLevel++;
        this.emit('peer_suspected', { nodeId, level: peer.suspicionLevel });
      }
    }
  }

  // ============================================================================
  // Conflict Resolution
  // ============================================================================

  setConflictResolver(resolver: ConflictResolver): void {
    this.conflictResolver = resolver;
  }

  // ============================================================================
  // Convergence Detection
  // ============================================================================

  getConvergenceStatus(): ConvergenceStatus {
    const totalPeers = this.nodes.size - 1; // Exclude self
    let convergedCount = 0;

    for (const [updateKey] of this.updates) {
      const acks = this.acknowledgments.get(updateKey);
      if (acks && acks.size >= totalPeers) {
        convergedCount++;
      }
    }

    const pendingUpdates = this.updates.size - convergedCount;

    // Check if all updates have been acknowledged by all peers
    let allAcknowledged = true;
    for (const [checkKey] of this.updates) {
      const acks = this.acknowledgments.get(checkKey);
      if (!acks || acks.size < totalPeers) {
        allAcknowledged = false;
        break;
      }
    }

    return {
      isConverged: allAcknowledged,
      convergencePercentage: Math.round(
        (Array.from(this.acknowledgments.values())
          .reduce((sum, acks) => sum + acks.size - 1, 0) /
          (this.updates.size * totalPeers || 1)) *
          100
      ),
      pendingUpdates,
      lastCheckTimestamp: Date.now(),
      estimatedTimeToConvergenceMs: pendingUpdates * this.config.gossipIntervalMs * 2,
    };
  }

  // ============================================================================
  // Metrics
  // ============================================================================

  getMetrics(): GossipMetrics {
    return { ...this.metrics };
  }
}
