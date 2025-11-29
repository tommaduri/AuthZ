/**
 * Topology Manager - Manages swarm agent topologies
 *
 * Supports multiple topology types:
 * - Mesh: Full connectivity, O(n^2) connections
 * - Hierarchical: Tree structure with coordinator
 * - Ring: Circular topology, O(n) connections
 * - Star: Central hub, all connect to center
 * - Adaptive: Dynamically adjusts based on load
 */

import { EventEmitter } from 'eventemitter3';
import type {
  Topology,
  TopologyConfig,
  TopologyType,
  SwarmAgent,
  AgentConnection,
  TopologyRoute,
  TopologyMetrics,
  TopologyEvent,
  TopologyEventType,
} from './types.js';

/**
 * Base topology implementation with common functionality
 */
abstract class BaseTopology implements Topology {
  abstract readonly type: TopologyType;

  protected agents: Map<string, SwarmAgent> = new Map();
  protected connections: Map<string, AgentConnection> = new Map();
  protected metrics: TopologyMetrics;

  constructor() {
    this.metrics = {
      activeAgents: 0,
      totalConnections: 0,
      avgLatencyMs: 0,
      healthScore: 1,
      messagesRouted: 0,
      failedRoutes: 0,
      updatedAt: new Date(),
    };
  }

  abstract connect(agents: SwarmAgent[]): AgentConnection[];
  abstract addAgents(agents: SwarmAgent[]): AgentConnection[];
  abstract route(from: string, to: string): TopologyRoute | null;

  removeAgents(agentIds: string[]): void {
    for (const id of agentIds) {
      this.agents.delete(id);
      // Remove all connections involving this agent
      for (const [key, conn] of this.connections) {
        if (conn.from === id || conn.to === id) {
          this.connections.delete(key);
        }
      }
    }
    this.updateMetrics();
  }

  getConnections(): AgentConnection[] {
    return Array.from(this.connections.values());
  }

  getNeighbors(agentId: string): string[] {
    const neighbors: Set<string> = new Set();
    for (const conn of this.connections.values()) {
      if (conn.from === agentId) {
        neighbors.add(conn.to);
      } else if (conn.to === agentId) {
        neighbors.add(conn.from);
      }
    }
    return Array.from(neighbors);
  }

  rebalance(): void {
    // Default implementation - subclasses can override
    const agentList = Array.from(this.agents.values());
    this.connections.clear();
    this.connect(agentList);
  }

  getMetrics(): TopologyMetrics {
    this.updateMetrics();
    return { ...this.metrics };
  }

  protected createConnection(from: string, to: string): AgentConnection {
    return {
      from,
      to,
      latencyMs: 0,
      bandwidth: Infinity,
      weight: 1,
      active: true,
      lastCheck: new Date(),
    };
  }

  protected connectionKey(from: string, to: string): string {
    return `${from}->${to}`;
  }

  protected updateMetrics(): void {
    const connArray = Array.from(this.connections.values());
    const activeConns = connArray.filter(c => c.active);

    this.metrics.activeAgents = this.agents.size;
    this.metrics.totalConnections = activeConns.length;
    this.metrics.avgLatencyMs = activeConns.length > 0
      ? activeConns.reduce((sum, c) => sum + c.latencyMs, 0) / activeConns.length
      : 0;
    this.metrics.healthScore = this.calculateHealthScore();
    this.metrics.updatedAt = new Date();
  }

  protected calculateHealthScore(): number {
    if (this.agents.size === 0) return 1;

    const healthyAgents = Array.from(this.agents.values())
      .filter(a => a.status !== 'unhealthy' && a.status !== 'dead').length;

    return healthyAgents / this.agents.size;
  }
}

/**
 * Mesh Topology - Full connectivity between all agents
 */
export class MeshTopology extends BaseTopology {
  readonly type: TopologyType = 'mesh';

  connect(agents: SwarmAgent[]): AgentConnection[] {
    const newConnections: AgentConnection[] = [];

    // Store agents
    for (const agent of agents) {
      this.agents.set(agent.id, agent);
    }

    // Create full mesh - every agent connects to every other
    const agentList = Array.from(this.agents.values());
    for (let i = 0; i < agentList.length; i++) {
      for (let j = i + 1; j < agentList.length; j++) {
        const agent1 = agentList[i]!;
        const agent2 = agentList[j]!;

        // Bidirectional connections
        const conn1 = this.createConnection(agent1.id, agent2.id);
        const conn2 = this.createConnection(agent2.id, agent1.id);

        this.connections.set(this.connectionKey(agent1.id, agent2.id), conn1);
        this.connections.set(this.connectionKey(agent2.id, agent1.id), conn2);

        newConnections.push(conn1, conn2);
      }
    }

    this.updateMetrics();
    return newConnections;
  }

  addAgents(agents: SwarmAgent[]): AgentConnection[] {
    const newConnections: AgentConnection[] = [];
    const existingAgents = Array.from(this.agents.values());

    for (const newAgent of agents) {
      this.agents.set(newAgent.id, newAgent);

      // Connect to all existing agents
      for (const existing of existingAgents) {
        const conn1 = this.createConnection(newAgent.id, existing.id);
        const conn2 = this.createConnection(existing.id, newAgent.id);

        this.connections.set(this.connectionKey(newAgent.id, existing.id), conn1);
        this.connections.set(this.connectionKey(existing.id, newAgent.id), conn2);

        newConnections.push(conn1, conn2);
      }

      existingAgents.push(newAgent);
    }

    this.updateMetrics();
    return newConnections;
  }

  route(from: string, to: string): TopologyRoute | null {
    if (!this.agents.has(from) || !this.agents.has(to)) {
      return null;
    }

    // Direct route in mesh topology
    const connection = this.connections.get(this.connectionKey(from, to));
    return {
      path: [from, to],
      totalLatencyMs: connection?.latencyMs ?? 0,
      hops: 1,
    };
  }
}

/**
 * Hierarchical Topology - Tree structure with coordinator at root
 */
export class HierarchicalTopology extends BaseTopology {
  readonly type: TopologyType = 'hierarchical';

  private coordinator: SwarmAgent | null = null;
  private levels: Map<string, number> = new Map(); // agentId -> level in hierarchy

  connect(agents: SwarmAgent[]): AgentConnection[] {
    if (agents.length === 0) {
      return [];
    }

    const newConnections: AgentConnection[] = [];

    // First agent or COORDINATOR type becomes coordinator
    this.coordinator = agents.find(a => a.type === 'COORDINATOR') ?? agents[0]!;
    this.agents.set(this.coordinator.id, this.coordinator);
    this.levels.set(this.coordinator.id, 0);

    // All other agents connect to coordinator (level 1)
    for (const agent of agents) {
      if (agent.id === this.coordinator.id) continue;

      this.agents.set(agent.id, agent);
      this.levels.set(agent.id, 1);

      const conn1 = this.createConnection(this.coordinator.id, agent.id);
      const conn2 = this.createConnection(agent.id, this.coordinator.id);

      this.connections.set(this.connectionKey(this.coordinator.id, agent.id), conn1);
      this.connections.set(this.connectionKey(agent.id, this.coordinator.id), conn2);

      newConnections.push(conn1, conn2);
    }

    this.updateMetrics();
    return newConnections;
  }

  addAgents(agents: SwarmAgent[]): AgentConnection[] {
    if (!this.coordinator) {
      return this.connect(agents);
    }

    const newConnections: AgentConnection[] = [];

    for (const agent of agents) {
      this.agents.set(agent.id, agent);
      this.levels.set(agent.id, 1);

      const conn1 = this.createConnection(this.coordinator.id, agent.id);
      const conn2 = this.createConnection(agent.id, this.coordinator.id);

      this.connections.set(this.connectionKey(this.coordinator.id, agent.id), conn1);
      this.connections.set(this.connectionKey(agent.id, this.coordinator.id), conn2);

      newConnections.push(conn1, conn2);
    }

    this.updateMetrics();
    return newConnections;
  }

  route(from: string, to: string): TopologyRoute | null {
    if (!this.agents.has(from) || !this.agents.has(to) || !this.coordinator) {
      return null;
    }

    // All routes go through coordinator
    if (from === this.coordinator.id || to === this.coordinator.id) {
      const conn = this.connections.get(this.connectionKey(from, to));
      return {
        path: [from, to],
        totalLatencyMs: conn?.latencyMs ?? 0,
        hops: 1,
      };
    }

    // Route through coordinator
    const conn1 = this.connections.get(this.connectionKey(from, this.coordinator.id));
    const conn2 = this.connections.get(this.connectionKey(this.coordinator.id, to));

    return {
      path: [from, this.coordinator.id, to],
      totalLatencyMs: (conn1?.latencyMs ?? 0) + (conn2?.latencyMs ?? 0),
      hops: 2,
    };
  }

  getCoordinator(): SwarmAgent | null {
    return this.coordinator;
  }

  electNewCoordinator(): SwarmAgent | null {
    if (this.agents.size === 0) return null;

    // Elect agent with highest priority that's healthy
    const candidates = Array.from(this.agents.values())
      .filter(a => a.status === 'idle' || a.status === 'busy')
      .sort((a, b) => b.metadata.priority - a.metadata.priority);

    if (candidates.length > 0) {
      this.coordinator = candidates[0]!;
      this.rebalance();
    }

    return this.coordinator;
  }
}

/**
 * Ring Topology - Circular connectivity
 */
export class RingTopology extends BaseTopology {
  readonly type: TopologyType = 'ring';

  private ring: string[] = []; // Ordered agent IDs in the ring

  connect(agents: SwarmAgent[]): AgentConnection[] {
    if (agents.length === 0) {
      return [];
    }

    const newConnections: AgentConnection[] = [];

    // Store agents and build ring order
    this.ring = [];
    for (const agent of agents) {
      this.agents.set(agent.id, agent);
      this.ring.push(agent.id);
    }

    // Connect each agent to next in ring (and vice versa for bidirectional)
    for (let i = 0; i < this.ring.length; i++) {
      const current = this.ring[i]!;
      const next = this.ring[(i + 1) % this.ring.length]!;

      const conn1 = this.createConnection(current, next);
      const conn2 = this.createConnection(next, current);

      this.connections.set(this.connectionKey(current, next), conn1);
      this.connections.set(this.connectionKey(next, current), conn2);

      newConnections.push(conn1, conn2);
    }

    this.updateMetrics();
    return newConnections;
  }

  addAgents(agents: SwarmAgent[]): AgentConnection[] {
    if (this.ring.length === 0) {
      return this.connect(agents);
    }

    const newConnections: AgentConnection[] = [];

    for (const agent of agents) {
      this.agents.set(agent.id, agent);

      // Insert into ring
      const insertIndex = this.ring.length;
      const prevAgent = this.ring[insertIndex - 1]!;
      const firstAgent = this.ring[0]!;

      // Remove old connection between prev and first
      this.connections.delete(this.connectionKey(prevAgent, firstAgent));
      this.connections.delete(this.connectionKey(firstAgent, prevAgent));

      // Add new agent to ring
      this.ring.push(agent.id);

      // Connect prev -> new -> first
      const conn1 = this.createConnection(prevAgent, agent.id);
      const conn2 = this.createConnection(agent.id, prevAgent);
      const conn3 = this.createConnection(agent.id, firstAgent);
      const conn4 = this.createConnection(firstAgent, agent.id);

      this.connections.set(this.connectionKey(prevAgent, agent.id), conn1);
      this.connections.set(this.connectionKey(agent.id, prevAgent), conn2);
      this.connections.set(this.connectionKey(agent.id, firstAgent), conn3);
      this.connections.set(this.connectionKey(firstAgent, agent.id), conn4);

      newConnections.push(conn1, conn2, conn3, conn4);
    }

    this.updateMetrics();
    return newConnections;
  }

  route(from: string, to: string): TopologyRoute | null {
    if (!this.agents.has(from) || !this.agents.has(to)) {
      return null;
    }

    const fromIndex = this.ring.indexOf(from);
    const toIndex = this.ring.indexOf(to);

    if (fromIndex === -1 || toIndex === -1) {
      return null;
    }

    // Calculate both directions and pick shorter
    const clockwiseDistance = (toIndex - fromIndex + this.ring.length) % this.ring.length;
    const counterDistance = (fromIndex - toIndex + this.ring.length) % this.ring.length;

    const path: string[] = [from];
    let totalLatency = 0;

    if (clockwiseDistance <= counterDistance) {
      // Go clockwise
      for (let i = 1; i <= clockwiseDistance; i++) {
        const idx = (fromIndex + i) % this.ring.length;
        const prevIdx = (fromIndex + i - 1) % this.ring.length;
        const conn = this.connections.get(
          this.connectionKey(this.ring[prevIdx]!, this.ring[idx]!)
        );
        totalLatency += conn?.latencyMs ?? 0;
        path.push(this.ring[idx]!);
      }
    } else {
      // Go counter-clockwise
      for (let i = 1; i <= counterDistance; i++) {
        const idx = (fromIndex - i + this.ring.length) % this.ring.length;
        const prevIdx = (fromIndex - i + 1 + this.ring.length) % this.ring.length;
        const conn = this.connections.get(
          this.connectionKey(this.ring[prevIdx]!, this.ring[idx]!)
        );
        totalLatency += conn?.latencyMs ?? 0;
        path.push(this.ring[idx]!);
      }
    }

    return {
      path,
      totalLatencyMs: totalLatency,
      hops: path.length - 1,
    };
  }
}

/**
 * Star Topology - All agents connect to a central hub
 */
export class StarTopology extends BaseTopology {
  readonly type: TopologyType = 'star';

  private hub: SwarmAgent | null = null;

  connect(agents: SwarmAgent[]): AgentConnection[] {
    if (agents.length === 0) {
      return [];
    }

    const newConnections: AgentConnection[] = [];

    // First agent becomes hub
    this.hub = agents[0]!;
    this.agents.set(this.hub.id, this.hub);

    // All other agents connect only to hub
    for (let i = 1; i < agents.length; i++) {
      const agent = agents[i]!;
      this.agents.set(agent.id, agent);

      const conn1 = this.createConnection(this.hub.id, agent.id);
      const conn2 = this.createConnection(agent.id, this.hub.id);

      this.connections.set(this.connectionKey(this.hub.id, agent.id), conn1);
      this.connections.set(this.connectionKey(agent.id, this.hub.id), conn2);

      newConnections.push(conn1, conn2);
    }

    this.updateMetrics();
    return newConnections;
  }

  addAgents(agents: SwarmAgent[]): AgentConnection[] {
    if (!this.hub) {
      return this.connect(agents);
    }

    const newConnections: AgentConnection[] = [];

    for (const agent of agents) {
      this.agents.set(agent.id, agent);

      const conn1 = this.createConnection(this.hub.id, agent.id);
      const conn2 = this.createConnection(agent.id, this.hub.id);

      this.connections.set(this.connectionKey(this.hub.id, agent.id), conn1);
      this.connections.set(this.connectionKey(agent.id, this.hub.id), conn2);

      newConnections.push(conn1, conn2);
    }

    this.updateMetrics();
    return newConnections;
  }

  route(from: string, to: string): TopologyRoute | null {
    if (!this.agents.has(from) || !this.agents.has(to) || !this.hub) {
      return null;
    }

    // All routes go through hub
    if (from === this.hub.id || to === this.hub.id) {
      const conn = this.connections.get(this.connectionKey(from, to));
      return {
        path: [from, to],
        totalLatencyMs: conn?.latencyMs ?? 0,
        hops: 1,
      };
    }

    const conn1 = this.connections.get(this.connectionKey(from, this.hub.id));
    const conn2 = this.connections.get(this.connectionKey(this.hub.id, to));

    return {
      path: [from, this.hub.id, to],
      totalLatencyMs: (conn1?.latencyMs ?? 0) + (conn2?.latencyMs ?? 0),
      hops: 2,
    };
  }

  getHub(): SwarmAgent | null {
    return this.hub;
  }
}

/**
 * Adaptive Topology - Dynamically adjusts based on load and patterns
 */
export class AdaptiveTopology extends BaseTopology {
  readonly type: TopologyType = 'adaptive';

  private currentStrategy: TopologyType = 'mesh';
  private innerTopology: Topology;
  private maxNodes: number;

  constructor(config: TopologyConfig) {
    super();
    this.maxNodes = config.maxNodes;
    // Start with mesh for small swarms
    this.innerTopology = new MeshTopology();
  }

  getMaxNodes(): number {
    return this.maxNodes;
  }

  connect(agents: SwarmAgent[]): AgentConnection[] {
    // Store agents
    for (const agent of agents) {
      this.agents.set(agent.id, agent);
    }

    // Choose optimal topology based on agent count
    this.selectOptimalTopology(agents.length);

    const connections = this.innerTopology.connect(agents);
    for (const conn of connections) {
      this.connections.set(this.connectionKey(conn.from, conn.to), conn);
    }

    this.updateMetrics();
    return connections;
  }

  addAgents(agents: SwarmAgent[]): AgentConnection[] {
    for (const agent of agents) {
      this.agents.set(agent.id, agent);
    }

    // Possibly switch topology if scale changes significantly
    this.selectOptimalTopology(this.agents.size);

    const connections = this.innerTopology.addAgents(agents);
    for (const conn of connections) {
      this.connections.set(this.connectionKey(conn.from, conn.to), conn);
    }

    this.updateMetrics();
    return connections;
  }

  route(from: string, to: string): TopologyRoute | null {
    return this.innerTopology.route(from, to);
  }

  rebalance(): void {
    const agentList = Array.from(this.agents.values());
    this.selectOptimalTopology(agentList.length);
    this.connections.clear();
    this.innerTopology.connect(agentList);
    this.updateMetrics();
  }

  getCurrentStrategy(): TopologyType {
    return this.currentStrategy;
  }

  private selectOptimalTopology(agentCount: number): void {
    let newStrategy: TopologyType;

    if (agentCount <= 5) {
      // Small swarm: full mesh for low latency
      newStrategy = 'mesh';
    } else if (agentCount <= 20) {
      // Medium swarm: hierarchical for coordination
      newStrategy = 'hierarchical';
    } else if (agentCount <= 50) {
      // Large swarm: star for simplicity
      newStrategy = 'star';
    } else {
      // Very large swarm: ring for scalability
      newStrategy = 'ring';
    }

    if (newStrategy !== this.currentStrategy) {
      this.currentStrategy = newStrategy;
      const agentList = Array.from(this.agents.values());

      switch (newStrategy) {
        case 'mesh':
          this.innerTopology = new MeshTopology();
          break;
        case 'hierarchical':
          this.innerTopology = new HierarchicalTopology();
          break;
        case 'star':
          this.innerTopology = new StarTopology();
          break;
        case 'ring':
          this.innerTopology = new RingTopology();
          break;
      }

      if (agentList.length > 0) {
        this.innerTopology.connect(agentList);
      }
    }
  }
}

/**
 * Topology Manager - Factory and management for topologies
 */
export class TopologyManager extends EventEmitter {
  private topology: Topology;
  private topologyType: TopologyType;

  constructor(config: TopologyConfig) {
    super();
    this.topologyType = config.type;
    this.topology = this.createTopology(config);
  }

  getConfiguredType(): TopologyType {
    return this.topologyType;
  }

  private createTopology(config: TopologyConfig): Topology {
    switch (config.type) {
      case 'mesh':
        return new MeshTopology();
      case 'hierarchical':
        return new HierarchicalTopology();
      case 'ring':
        return new RingTopology();
      case 'star':
        return new StarTopology();
      case 'adaptive':
        return new AdaptiveTopology(config);
      default:
        throw new Error(`Unknown topology type: ${config.type}`);
    }
  }

  /**
   * Initialize topology with agents
   */
  connect(agents: SwarmAgent[]): AgentConnection[] {
    const connections = this.topology.connect(agents);
    this.emitEvent('topology_rebalanced', { agentCount: agents.length });
    return connections;
  }

  /**
   * Add agents to topology
   */
  addAgents(agents: SwarmAgent[]): AgentConnection[] {
    const connections = this.topology.addAgents(agents);
    for (const agent of agents) {
      this.emitEvent('agent_added', { agentId: agent.id, agentType: agent.type });
    }
    return connections;
  }

  /**
   * Remove agents from topology
   */
  removeAgents(agentIds: string[]): void {
    this.topology.removeAgents(agentIds);
    for (const id of agentIds) {
      this.emitEvent('agent_removed', { agentId: id });
    }
  }

  /**
   * Find route between agents
   */
  route(from: string, to: string): TopologyRoute | null {
    return this.topology.route(from, to);
  }

  /**
   * Get all connections
   */
  getConnections(): AgentConnection[] {
    return this.topology.getConnections();
  }

  /**
   * Get neighbors of an agent
   */
  getNeighbors(agentId: string): string[] {
    return this.topology.getNeighbors(agentId);
  }

  /**
   * Rebalance topology
   */
  rebalance(): void {
    this.topology.rebalance();
    this.emitEvent('topology_rebalanced', {});
  }

  /**
   * Get topology metrics
   */
  getMetrics(): TopologyMetrics {
    return this.topology.getMetrics();
  }

  /**
   * Get topology type
   */
  getType(): TopologyType {
    return this.topology.type;
  }

  private emitEvent(type: TopologyEventType, data: Record<string, unknown>): void {
    const event: TopologyEvent = {
      type,
      timestamp: new Date(),
      data,
    };
    this.emit('topologyEvent', event);
  }
}

// Individual topologies are already exported via their class declarations
