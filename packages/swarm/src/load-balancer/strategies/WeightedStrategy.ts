/**
 * Weighted Load Balancing Strategy
 *
 * Distributes tasks based on agent weights/priorities.
 * Agents with higher weights receive proportionally more tasks.
 */

import type { SwarmAgent } from '../../topology/types.js';
import type {
  LoadBalancerStrategy,
  Task,
  SelectionCriteria,
  AgentLoad,
  BalancingStrategy,
} from '../types.js';

export class WeightedStrategy implements LoadBalancerStrategy {
  readonly name: BalancingStrategy = 'weighted';

  private weights: Map<string, number> = new Map();
  private currentWeights: Map<string, number> = new Map();

  constructor(initialWeights?: Record<string, number>) {
    if (initialWeights) {
      for (const [id, weight] of Object.entries(initialWeights)) {
        this.weights.set(id, weight);
        this.currentWeights.set(id, weight);
      }
    }
  }

  selectAgent(
    agents: SwarmAgent[],
    task: Task,
    criteria?: SelectionCriteria
  ): SwarmAgent | null {
    const eligible = this.filterEligibleAgents(agents, task, criteria);

    if (eligible.length === 0) {
      return null;
    }

    // Initialize weights for new agents
    for (const agent of eligible) {
      if (!this.weights.has(agent.id)) {
        // Default weight based on priority
        const weight = agent.metadata.priority || 1;
        this.weights.set(agent.id, weight);
        this.currentWeights.set(agent.id, weight);
      }
    }

    // Select agent with highest current weight
    let selectedAgent: SwarmAgent | null = null;
    let maxWeight = -1;

    for (const agent of eligible) {
      const currentWeight = this.currentWeights.get(agent.id) ?? 0;
      if (currentWeight > maxWeight) {
        maxWeight = currentWeight;
        selectedAgent = agent;
      }
    }

    if (selectedAgent) {
      // Decrement selected agent's current weight
      const baseWeight = this.weights.get(selectedAgent.id) ?? 1;
      const currentWeight = this.currentWeights.get(selectedAgent.id) ?? baseWeight;
      this.currentWeights.set(selectedAgent.id, currentWeight - 1);

      // Check if all current weights are <= 0, reset if so
      const allZero = [...this.currentWeights.values()].every(w => w <= 0);
      if (allZero) {
        this.resetCurrentWeights(eligible);
      }
    }

    return selectedAgent;
  }

  rebalance(agents: SwarmAgent[], loads: Map<string, AgentLoad>): void {
    // Adjust weights based on performance
    for (const agent of agents) {
      const load = loads.get(agent.id);
      if (load) {
        // Reduce weight for agents with high failure rates
        const successRate = load.completedTasks > 0
          ? (load.completedTasks - load.failedTasks) / load.completedTasks
          : 1;

        const baseWeight = agent.metadata.priority || 1;
        const adjustedWeight = Math.max(1, Math.round(baseWeight * successRate));

        this.weights.set(agent.id, adjustedWeight);
      }
    }

    this.resetCurrentWeights(agents);
  }

  selectForRemoval(
    agents: SwarmAgent[],
    count: number,
    loads: Map<string, AgentLoad>
  ): string[] {
    // Remove agents with lowest weights and lowest activity
    const sorted = [...agents].sort((a, b) => {
      const weightA = this.weights.get(a.id) ?? 1;
      const weightB = this.weights.get(b.id) ?? 1;
      const loadA = loads.get(a.id)?.activeTasks ?? 0;
      const loadB = loads.get(b.id)?.activeTasks ?? 0;

      // Primary sort by weight (ascending), secondary by load
      if (weightA !== weightB) return weightA - weightB;
      return loadA - loadB;
    });

    return sorted.slice(0, count).map(a => a.id);
  }

  recordCompletion(agentId: string, _taskId: string, success: boolean): void {
    if (!success) {
      // Temporarily reduce weight on failure
      const currentWeight = this.currentWeights.get(agentId);
      if (currentWeight !== undefined) {
        this.currentWeights.set(agentId, Math.max(0, currentWeight - 1));
      }
    }
  }

  /**
   * Set weight for a specific agent
   */
  setWeight(agentId: string, weight: number): void {
    this.weights.set(agentId, Math.max(1, weight));
    this.currentWeights.set(agentId, Math.max(1, weight));
  }

  /**
   * Get weight for a specific agent
   */
  getWeight(agentId: string): number {
    return this.weights.get(agentId) ?? 1;
  }

  private filterEligibleAgents(
    agents: SwarmAgent[],
    task: Task,
    criteria?: SelectionCriteria
  ): SwarmAgent[] {
    return agents.filter(agent => {
      if (agent.status !== 'idle' && agent.status !== 'busy') {
        return false;
      }

      if (criteria?.maxLoad !== undefined && agent.load > criteria.maxLoad) {
        return false;
      }

      if (criteria?.excludeAgents?.includes(agent.id)) {
        return false;
      }

      if (task.requiredCapabilities && task.requiredCapabilities.length > 0) {
        const hasAll = task.requiredCapabilities.every(cap =>
          agent.capabilities.includes(cap)
        );
        if (!hasAll) return false;
      }

      if (criteria?.agentTypes && criteria.agentTypes.length > 0) {
        if (!criteria.agentTypes.includes(agent.type)) {
          return false;
        }
      }

      return true;
    });
  }

  private resetCurrentWeights(agents: SwarmAgent[]): void {
    for (const agent of agents) {
      const baseWeight = this.weights.get(agent.id) ?? agent.metadata.priority ?? 1;
      this.currentWeights.set(agent.id, baseWeight);
    }
  }
}
