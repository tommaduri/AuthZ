/**
 * Least Connections Load Balancing Strategy
 *
 * Assigns tasks to the agent with the fewest active connections/tasks.
 * Good for varying task durations.
 */

import type { SwarmAgent } from '../../topology/types.js';
import type {
  LoadBalancerStrategy,
  Task,
  SelectionCriteria,
  AgentLoad,
  BalancingStrategy,
} from '../types.js';

export class LeastConnectionsStrategy implements LoadBalancerStrategy {
  readonly name: BalancingStrategy = 'least-connections';

  private activeTasks: Map<string, Set<string>> = new Map();

  selectAgent(
    agents: SwarmAgent[],
    task: Task,
    criteria?: SelectionCriteria
  ): SwarmAgent | null {
    const eligible = this.filterEligibleAgents(agents, task, criteria);

    if (eligible.length === 0) {
      return null;
    }

    // Select agent with fewest active tasks
    let selectedAgent: SwarmAgent | null = null;
    let minTasks = Infinity;

    for (const agent of eligible) {
      const taskCount = this.getActiveTaskCount(agent.id);

      // Account for agent load as well
      const effectiveLoad = taskCount + (agent.load * 10); // Scale load to task count

      if (effectiveLoad < minTasks) {
        minTasks = effectiveLoad;
        selectedAgent = agent;
      }
    }

    if (selectedAgent) {
      // Track the assignment
      this.addTask(selectedAgent.id, task.id);
    }

    return selectedAgent;
  }

  rebalance(agents: SwarmAgent[], loads: Map<string, AgentLoad>): void {
    // Sync our tracking with actual loads
    for (const agent of agents) {
      const load = loads.get(agent.id);
      if (load) {
        // If our count doesn't match, reset
        const ourCount = this.getActiveTaskCount(agent.id);
        if (Math.abs(ourCount - load.activeTasks) > 2) {
          // Clear and reset
          this.activeTasks.delete(agent.id);
        }
      }
    }

    // Remove entries for agents no longer in the pool
    const agentIds = new Set(agents.map(a => a.id));
    for (const id of this.activeTasks.keys()) {
      if (!agentIds.has(id)) {
        this.activeTasks.delete(id);
      }
    }
  }

  selectForRemoval(
    agents: SwarmAgent[],
    count: number,
    loads: Map<string, AgentLoad>
  ): string[] {
    // Remove agents with fewest active tasks (least disruption)
    const sorted = [...agents].sort((a, b) => {
      const loadA = loads.get(a.id)?.activeTasks ?? this.getActiveTaskCount(a.id);
      const loadB = loads.get(b.id)?.activeTasks ?? this.getActiveTaskCount(b.id);
      return loadA - loadB;
    });

    return sorted.slice(0, count).map(a => a.id);
  }

  recordCompletion(agentId: string, taskId: string, _success: boolean): void {
    this.removeTask(agentId, taskId);
  }

  /**
   * Get active task count for an agent
   */
  getActiveTaskCount(agentId: string): number {
    return this.activeTasks.get(agentId)?.size ?? 0;
  }

  /**
   * Add a task to an agent's tracking
   */
  private addTask(agentId: string, taskId: string): void {
    if (!this.activeTasks.has(agentId)) {
      this.activeTasks.set(agentId, new Set());
    }
    this.activeTasks.get(agentId)!.add(taskId);
  }

  /**
   * Remove a task from an agent's tracking
   */
  private removeTask(agentId: string, taskId: string): void {
    this.activeTasks.get(agentId)?.delete(taskId);
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
}
