/**
 * Adaptive Load Balancing Strategy
 *
 * Dynamically adjusts selection criteria based on:
 * - Agent performance history
 * - Current load patterns
 * - Task characteristics
 * - Success/failure rates
 */

import type { SwarmAgent } from '../../topology/types.js';
import type {
  LoadBalancerStrategy,
  Task,
  SelectionCriteria,
  AgentLoad,
  BalancingStrategy,
} from '../types.js';

interface AgentPerformance {
  agentId: string;
  successCount: number;
  failureCount: number;
  totalProcessingTimeMs: number;
  taskCount: number;
  lastUpdated: Date;
}

interface TaskTypeStats {
  taskType: string;
  preferredAgents: Map<string, number>; // agentId -> success count
  avgDurationMs: number;
  totalCount: number;
}

export class AdaptiveStrategy implements LoadBalancerStrategy {
  readonly name: BalancingStrategy = 'adaptive';

  private performance: Map<string, AgentPerformance> = new Map();
  private taskTypeStats: Map<string, TaskTypeStats> = new Map();
  private recentAssignments: Array<{ agentId: string; timestamp: Date }> = [];
  private maxRecentAssignments = 100;

  selectAgent(
    agents: SwarmAgent[],
    task: Task,
    criteria?: SelectionCriteria
  ): SwarmAgent | null {
    const eligible = this.filterEligibleAgents(agents, task, criteria);

    if (eligible.length === 0) {
      return null;
    }

    // Score each agent
    const scores = eligible.map(agent => ({
      agent,
      score: this.calculateAgentScore(agent, task),
    }));

    // Sort by score (higher is better)
    scores.sort((a, b) => b.score - a.score);

    // Add some randomness to avoid always picking the same agent
    // Pick from top 3 with weighted probability
    const topAgents = scores.slice(0, Math.min(3, scores.length));
    const totalScore = topAgents.reduce((sum, s) => sum + s.score, 0);

    if (totalScore === 0) {
      return topAgents[0]?.agent ?? null;
    }

    // Weighted random selection
    const random = Math.random() * totalScore;
    let cumulative = 0;

    for (const { agent, score } of topAgents) {
      cumulative += score;
      if (random <= cumulative) {
        this.recordAssignment(agent.id);
        return agent;
      }
    }

    const selected = topAgents[0]?.agent ?? null;
    if (selected) {
      this.recordAssignment(selected.id);
    }
    return selected;
  }

  rebalance(agents: SwarmAgent[], loads: Map<string, AgentLoad>): void {
    // Update performance metrics from actual loads
    for (const agent of agents) {
      const load = loads.get(agent.id);
      if (load) {
        const perf = this.getOrCreatePerformance(agent.id);
        perf.successCount = load.completedTasks - load.failedTasks;
        perf.failureCount = load.failedTasks;
        perf.totalProcessingTimeMs = load.avgProcessingTimeMs * load.completedTasks;
        perf.taskCount = load.completedTasks;
        perf.lastUpdated = new Date();
      }
    }

    // Prune old data
    this.pruneOldData(agents);
  }

  selectForRemoval(
    agents: SwarmAgent[],
    count: number,
    loads: Map<string, AgentLoad>
  ): string[] {
    // Calculate removal score (lower = remove first)
    const scores = agents.map(agent => {
      const perf = this.performance.get(agent.id);
      const load = loads.get(agent.id);

      let score = 0;

      // Penalize agents with high failure rates
      if (perf && perf.taskCount > 0) {
        const successRate = perf.successCount / perf.taskCount;
        score += successRate * 50;
      }

      // Penalize removing agents with active tasks
      if (load) {
        score += load.activeTasks * 10;
      }

      // Consider agent priority
      score += agent.metadata.priority * 5;

      return { agent, score };
    });

    // Sort by score (ascending - lowest scores removed first)
    scores.sort((a, b) => a.score - b.score);

    return scores.slice(0, count).map(s => s.agent.id);
  }

  recordCompletion(agentId: string, _taskId: string, success: boolean): void {
    const perf = this.getOrCreatePerformance(agentId);

    if (success) {
      perf.successCount++;
    } else {
      perf.failureCount++;
    }
    perf.taskCount++;
    perf.lastUpdated = new Date();

    // Update task type stats if we can extract type from taskId
    // (In real implementation, you'd store task type with assignment)
  }

  /**
   * Get performance stats for an agent
   */
  getPerformance(agentId: string): AgentPerformance | undefined {
    return this.performance.get(agentId);
  }

  /**
   * Record task type statistics
   */
  recordTaskTypeSuccess(taskType: string, agentId: string, durationMs: number): void {
    if (!this.taskTypeStats.has(taskType)) {
      this.taskTypeStats.set(taskType, {
        taskType,
        preferredAgents: new Map(),
        avgDurationMs: 0,
        totalCount: 0,
      });
    }

    const stats = this.taskTypeStats.get(taskType)!;
    stats.totalCount++;
    stats.avgDurationMs =
      (stats.avgDurationMs * (stats.totalCount - 1) + durationMs) / stats.totalCount;

    const agentSuccessCount = stats.preferredAgents.get(agentId) ?? 0;
    stats.preferredAgents.set(agentId, agentSuccessCount + 1);
  }

  private calculateAgentScore(agent: SwarmAgent, task: Task): number {
    let score = 0;

    // Base score from agent priority
    score += agent.metadata.priority * 10;

    // Penalize high load
    score -= agent.load * 30;

    // Performance history
    const perf = this.performance.get(agent.id);
    if (perf && perf.taskCount > 0) {
      const successRate = perf.successCount / perf.taskCount;
      score += successRate * 40;

      // Bonus for fast processing
      const avgTime = perf.taskCount > 0 ? perf.totalProcessingTimeMs / perf.taskCount : 0;
      if (avgTime > 0 && avgTime < 100) {
        score += 10;
      }
    } else {
      // New agents get a small bonus to try them out
      score += 5;
    }

    // Check task type affinity
    const taskStats = this.taskTypeStats.get(task.type);
    if (taskStats) {
      const agentSuccess = taskStats.preferredAgents.get(agent.id) ?? 0;
      score += Math.min(agentSuccess, 20); // Cap the bonus
    }

    // Preferred agent types
    if (task.preferredAgentTypes?.includes(agent.type)) {
      score += 15;
    }

    // Capability match bonus
    if (task.requiredCapabilities) {
      const matchCount = task.requiredCapabilities.filter(cap =>
        agent.capabilities.includes(cap)
      ).length;
      score += matchCount * 5;
    }

    // Avoid recently used agents (spread load)
    const recentUseCount = this.recentAssignments.filter(
      a => a.agentId === agent.id
    ).length;
    score -= recentUseCount * 2;

    // Status-based scoring
    if (agent.status === 'idle') {
      score += 20;
    } else if (agent.status === 'busy') {
      score += 5;
    }

    return Math.max(0, score);
  }

  private getOrCreatePerformance(agentId: string): AgentPerformance {
    if (!this.performance.has(agentId)) {
      this.performance.set(agentId, {
        agentId,
        successCount: 0,
        failureCount: 0,
        totalProcessingTimeMs: 0,
        taskCount: 0,
        lastUpdated: new Date(),
      });
    }
    return this.performance.get(agentId)!;
  }

  private recordAssignment(agentId: string): void {
    this.recentAssignments.push({ agentId, timestamp: new Date() });

    // Trim old assignments
    if (this.recentAssignments.length > this.maxRecentAssignments) {
      this.recentAssignments = this.recentAssignments.slice(-this.maxRecentAssignments);
    }
  }

  private pruneOldData(currentAgents: SwarmAgent[]): void {
    const agentIds = new Set(currentAgents.map(a => a.id));

    // Remove performance data for agents no longer in pool
    for (const id of this.performance.keys()) {
      if (!agentIds.has(id)) {
        this.performance.delete(id);
      }
    }

    // Clean up recent assignments
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    this.recentAssignments = this.recentAssignments.filter(
      a => a.timestamp > fiveMinutesAgo && agentIds.has(a.agentId)
    );
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
