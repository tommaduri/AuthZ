/**
 * Round Robin Load Balancing Strategy
 *
 * Distributes tasks evenly across all available agents in circular order.
 * Simple and fair, but doesn't account for agent load or capabilities.
 */

import type { SwarmAgent } from '../../topology/types.js';
import type {
  LoadBalancerStrategy,
  Task,
  SelectionCriteria,
  AgentLoad,
  BalancingStrategy,
} from '../types.js';

export class RoundRobinStrategy implements LoadBalancerStrategy {
  readonly name: BalancingStrategy = 'round-robin';

  private currentIndex: number = 0;
  private agentOrder: string[] = [];

  selectAgent(
    agents: SwarmAgent[],
    task: Task,
    criteria?: SelectionCriteria
  ): SwarmAgent | null {
    // Filter eligible agents
    const eligible = this.filterEligibleAgents(agents, task, criteria);

    if (eligible.length === 0) {
      return null;
    }

    // Update agent order if changed
    this.updateAgentOrder(eligible);

    // Get next agent in round-robin order
    const agentId = this.agentOrder[this.currentIndex % this.agentOrder.length];
    this.currentIndex = (this.currentIndex + 1) % this.agentOrder.length;

    return eligible.find(a => a.id === agentId) ?? null;
  }

  rebalance(agents: SwarmAgent[], _loads: Map<string, AgentLoad>): void {
    // Round-robin doesn't need special rebalancing
    // Just update the agent order
    this.updateAgentOrder(agents);
  }

  selectForRemoval(
    agents: SwarmAgent[],
    count: number,
    loads: Map<string, AgentLoad>
  ): string[] {
    // Remove agents with lowest activity
    const sorted = [...agents].sort((a, b) => {
      const loadA = loads.get(a.id);
      const loadB = loads.get(b.id);
      const activityA = loadA?.activeTasks ?? 0;
      const activityB = loadB?.activeTasks ?? 0;
      return activityA - activityB;
    });

    return sorted.slice(0, count).map(a => a.id);
  }

  recordCompletion(_agentId: string, _taskId: string, _success: boolean): void {
    // Round-robin doesn't track individual completions
  }

  private filterEligibleAgents(
    agents: SwarmAgent[],
    task: Task,
    criteria?: SelectionCriteria
  ): SwarmAgent[] {
    return agents.filter(agent => {
      // Must be available
      if (agent.status !== 'idle' && agent.status !== 'busy') {
        return false;
      }

      // Check load threshold
      if (criteria?.maxLoad !== undefined && agent.load > criteria.maxLoad) {
        return false;
      }

      // Check excluded agents
      if (criteria?.excludeAgents?.includes(agent.id)) {
        return false;
      }

      // Check required capabilities
      if (task.requiredCapabilities && task.requiredCapabilities.length > 0) {
        const hasAll = task.requiredCapabilities.every(cap =>
          agent.capabilities.includes(cap)
        );
        if (!hasAll) return false;
      }

      // Check required agent types
      if (criteria?.agentTypes && criteria.agentTypes.length > 0) {
        if (!criteria.agentTypes.includes(agent.type)) {
          return false;
        }
      }

      // Check preferred agent types
      if (task.preferredAgentTypes && task.preferredAgentTypes.length > 0) {
        // Preferred is not required, so we allow any but will sort by preference
      }

      return true;
    });
  }

  private updateAgentOrder(agents: SwarmAgent[]): void {
    const currentIds = new Set(agents.map(a => a.id));
    const orderIds = new Set(this.agentOrder);

    // Check if order needs updating
    const needsUpdate =
      currentIds.size !== orderIds.size ||
      [...currentIds].some(id => !orderIds.has(id));

    if (needsUpdate) {
      this.agentOrder = agents.map(a => a.id);
      // Reset index if it's out of bounds
      if (this.currentIndex >= this.agentOrder.length) {
        this.currentIndex = 0;
      }
    }
  }
}
