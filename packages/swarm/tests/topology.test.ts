/**
 * Topology Tests
 *
 * Tests for all topology implementations:
 * - MeshTopology
 * - HierarchicalTopology
 * - RingTopology
 * - StarTopology
 * - AdaptiveTopology
 * - TopologyManager
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TopologyManager,
  MeshTopology,
  HierarchicalTopology,
  RingTopology,
  StarTopology,
  AdaptiveTopology,
  type TopologyConfig,
  type SwarmAgent,
} from '../src/topology/index.js';

// Helper to create test agents
function createTestAgents(count: number, type: 'GUARDIAN' | 'ANALYST' | 'ADVISOR' | 'ENFORCER' | 'COORDINATOR' = 'GUARDIAN'): SwarmAgent[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `agent-${i + 1}`,
    type: i === 0 && type === 'COORDINATOR' ? 'COORDINATOR' : type,
    status: 'idle' as const,
    capabilities: ['analyze', 'process'],
    load: 0,
    metadata: {
      createdAt: new Date(),
      version: '1.0.0',
      tags: [],
      priority: i + 1,
      attributes: {},
    },
    lastHeartbeat: new Date(),
    connectionInfo: {
      host: 'localhost',
      port: 8080 + i,
      protocol: 'internal' as const,
      secure: false,
    },
  }));
}

describe('MeshTopology', () => {
  let topology: MeshTopology;

  beforeEach(() => {
    topology = new MeshTopology();
  });

  it('should have correct type', () => {
    expect(topology.type).toBe('mesh');
  });

  it('should create full mesh connections', () => {
    const agents = createTestAgents(4);
    const connections = topology.connect(agents);

    // Full mesh with n agents has n*(n-1) bidirectional connections
    // For 4 agents: 4*3 = 12 connections
    expect(connections.length).toBe(12);
  });

  it('should create direct routes between any two agents', () => {
    const agents = createTestAgents(4);
    topology.connect(agents);

    const route = topology.route('agent-1', 'agent-4');
    expect(route).not.toBeNull();
    expect(route?.path).toEqual(['agent-1', 'agent-4']);
    expect(route?.hops).toBe(1);
  });

  it('should add new agents with connections to all existing', () => {
    const agents = createTestAgents(3);
    topology.connect(agents);

    const newAgents = createTestAgents(1);
    newAgents[0]!.id = 'agent-4';
    const newConnections = topology.addAgents(newAgents);

    // New agent connects to 3 existing agents (bidirectional) = 6 connections
    expect(newConnections.length).toBe(6);
  });

  it('should remove agents and their connections', () => {
    const agents = createTestAgents(4);
    topology.connect(agents);

    topology.removeAgents(['agent-2']);
    const connections = topology.getConnections();

    // No connections should involve agent-2
    const hasRemovedAgent = connections.some(
      c => c.from === 'agent-2' || c.to === 'agent-2'
    );
    expect(hasRemovedAgent).toBe(false);
  });

  it('should return all neighbors', () => {
    const agents = createTestAgents(4);
    topology.connect(agents);

    const neighbors = topology.getNeighbors('agent-1');
    expect(neighbors).toHaveLength(3);
    expect(neighbors).toContain('agent-2');
    expect(neighbors).toContain('agent-3');
    expect(neighbors).toContain('agent-4');
  });

  it('should return null route for non-existent agents', () => {
    const agents = createTestAgents(3);
    topology.connect(agents);

    const route = topology.route('agent-1', 'non-existent');
    expect(route).toBeNull();
  });
});

describe('HierarchicalTopology', () => {
  let topology: HierarchicalTopology;

  beforeEach(() => {
    topology = new HierarchicalTopology();
  });

  it('should have correct type', () => {
    expect(topology.type).toBe('hierarchical');
  });

  it('should establish coordinator as first agent', () => {
    const agents = createTestAgents(4, 'COORDINATOR');
    topology.connect(agents);

    const coordinator = topology.getCoordinator();
    expect(coordinator).not.toBeNull();
    expect(coordinator?.type).toBe('COORDINATOR');
  });

  it('should create star-like connections through coordinator', () => {
    const agents = createTestAgents(4);
    const connections = topology.connect(agents);

    // Each non-coordinator agent has 2 connections (to and from coordinator)
    // 3 workers * 2 = 6 connections
    expect(connections.length).toBe(6);
  });

  it('should route through coordinator', () => {
    const agents = createTestAgents(4);
    topology.connect(agents);

    const route = topology.route('agent-2', 'agent-4');
    expect(route).not.toBeNull();
    expect(route?.path).toEqual(['agent-2', 'agent-1', 'agent-4']);
    expect(route?.hops).toBe(2);
  });

  it('should have direct route to/from coordinator', () => {
    const agents = createTestAgents(4);
    topology.connect(agents);

    const route = topology.route('agent-1', 'agent-3');
    expect(route).not.toBeNull();
    expect(route?.path).toEqual(['agent-1', 'agent-3']);
    expect(route?.hops).toBe(1);
  });

  it('should elect new coordinator if needed', () => {
    const agents = createTestAgents(4);
    topology.connect(agents);

    const newCoordinator = topology.electNewCoordinator();
    expect(newCoordinator).not.toBeNull();
  });
});

describe('RingTopology', () => {
  let topology: RingTopology;

  beforeEach(() => {
    topology = new RingTopology();
  });

  it('should have correct type', () => {
    expect(topology.type).toBe('ring');
  });

  it('should create circular connections', () => {
    const agents = createTestAgents(4);
    const connections = topology.connect(agents);

    // Ring has n*2 connections (bidirectional)
    expect(connections.length).toBe(8);
  });

  it('should route through shortest path in ring', () => {
    const agents = createTestAgents(6);
    topology.connect(agents);

    // Route from agent-1 to agent-3 (should go agent-1 -> agent-2 -> agent-3)
    const route = topology.route('agent-1', 'agent-3');
    expect(route).not.toBeNull();
    expect(route?.hops).toBe(2);
  });

  it('should return neighbors (adjacent in ring)', () => {
    const agents = createTestAgents(4);
    topology.connect(agents);

    const neighbors = topology.getNeighbors('agent-2');
    expect(neighbors).toHaveLength(2);
    expect(neighbors).toContain('agent-1');
    expect(neighbors).toContain('agent-3');
  });

  it('should wrap around the ring', () => {
    const agents = createTestAgents(4);
    topology.connect(agents);

    // Agent-4 should be connected to agent-1 (wrap around)
    const neighbors = topology.getNeighbors('agent-4');
    expect(neighbors).toContain('agent-1');
  });
});

describe('StarTopology', () => {
  let topology: StarTopology;

  beforeEach(() => {
    topology = new StarTopology();
  });

  it('should have correct type', () => {
    expect(topology.type).toBe('star');
  });

  it('should establish hub as first agent', () => {
    const agents = createTestAgents(4);
    topology.connect(agents);

    const hub = topology.getHub();
    expect(hub).not.toBeNull();
    expect(hub?.id).toBe('agent-1');
  });

  it('should create connections only through hub', () => {
    const agents = createTestAgents(4);
    const connections = topology.connect(agents);

    // Each non-hub agent connects to hub (bidirectional) = (n-1)*2
    expect(connections.length).toBe(6);

    // All connections should involve the hub
    const allThroughHub = connections.every(
      c => c.from === 'agent-1' || c.to === 'agent-1'
    );
    expect(allThroughHub).toBe(true);
  });

  it('should route through hub', () => {
    const agents = createTestAgents(4);
    topology.connect(agents);

    const route = topology.route('agent-2', 'agent-4');
    expect(route).not.toBeNull();
    expect(route?.path).toEqual(['agent-2', 'agent-1', 'agent-4']);
    expect(route?.hops).toBe(2);
  });

  it('should have direct route to/from hub', () => {
    const agents = createTestAgents(4);
    topology.connect(agents);

    const route = topology.route('agent-1', 'agent-3');
    expect(route).not.toBeNull();
    expect(route?.hops).toBe(1);
  });

  it('should only return hub as neighbor for non-hub agents', () => {
    const agents = createTestAgents(4);
    topology.connect(agents);

    const neighbors = topology.getNeighbors('agent-2');
    expect(neighbors).toHaveLength(1);
    expect(neighbors).toContain('agent-1');
  });
});

describe('AdaptiveTopology', () => {
  it('should have correct type', () => {
    const config: TopologyConfig = {
      type: 'adaptive',
      maxNodes: 100,
      replicationFactor: 2,
    };
    const topology = new AdaptiveTopology(config);
    expect(topology.type).toBe('adaptive');
  });

  it('should use mesh for small swarms', () => {
    const config: TopologyConfig = {
      type: 'adaptive',
      maxNodes: 100,
      replicationFactor: 2,
    };
    const topology = new AdaptiveTopology(config);
    const agents = createTestAgents(3);
    topology.connect(agents);

    expect(topology.getCurrentStrategy()).toBe('mesh');
  });

  it('should switch strategy based on agent count', () => {
    const config: TopologyConfig = {
      type: 'adaptive',
      maxNodes: 100,
      replicationFactor: 2,
    };
    const topology = new AdaptiveTopology(config);

    // Start with small swarm (mesh)
    const agents = createTestAgents(3);
    topology.connect(agents);
    expect(topology.getCurrentStrategy()).toBe('mesh');

    // Add more agents to trigger switch to hierarchical
    const moreAgents = createTestAgents(10);
    moreAgents.forEach((a, i) => { a.id = `agent-${i + 10}`; });
    topology.addAgents(moreAgents);

    // After rebalance, should switch to hierarchical
    topology.rebalance();
    expect(topology.getCurrentStrategy()).toBe('hierarchical');
  });
});

describe('TopologyManager', () => {
  it('should create topology based on config', () => {
    const config: TopologyConfig = {
      type: 'mesh',
      maxNodes: 10,
      replicationFactor: 2,
    };
    const manager = new TopologyManager(config);

    expect(manager.getType()).toBe('mesh');
  });

  it('should connect agents and emit events', () => {
    const config: TopologyConfig = {
      type: 'mesh',
      maxNodes: 10,
      replicationFactor: 2,
    };
    const manager = new TopologyManager(config);

    const events: any[] = [];
    manager.on('topologyEvent', e => events.push(e));

    const agents = createTestAgents(3);
    manager.connect(agents);

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe('topology_rebalanced');
  });

  it('should add agents and emit events', () => {
    const config: TopologyConfig = {
      type: 'mesh',
      maxNodes: 10,
      replicationFactor: 2,
    };
    const manager = new TopologyManager(config);

    const agents = createTestAgents(3);
    manager.connect(agents);

    const events: any[] = [];
    manager.on('topologyEvent', e => events.push(e));

    const newAgent = createTestAgents(1);
    newAgent[0]!.id = 'agent-new';
    manager.addAgents(newAgent);

    expect(events.some(e => e.type === 'agent_added')).toBe(true);
  });

  it('should remove agents and emit events', () => {
    const config: TopologyConfig = {
      type: 'mesh',
      maxNodes: 10,
      replicationFactor: 2,
    };
    const manager = new TopologyManager(config);

    const agents = createTestAgents(3);
    manager.connect(agents);

    const events: any[] = [];
    manager.on('topologyEvent', e => events.push(e));

    manager.removeAgents(['agent-2']);

    expect(events.some(e => e.type === 'agent_removed')).toBe(true);
  });

  it('should provide metrics', () => {
    const config: TopologyConfig = {
      type: 'mesh',
      maxNodes: 10,
      replicationFactor: 2,
    };
    const manager = new TopologyManager(config);

    const agents = createTestAgents(4);
    manager.connect(agents);

    const metrics = manager.getMetrics();
    expect(metrics.activeAgents).toBe(4);
    expect(metrics.totalConnections).toBe(12); // 4 agents mesh
    expect(metrics.healthScore).toBe(1);
  });

  it('should throw for unknown topology type', () => {
    expect(() => {
      new TopologyManager({
        type: 'unknown' as any,
        maxNodes: 10,
        replicationFactor: 2,
      });
    }).toThrow('Unknown topology type');
  });
});
