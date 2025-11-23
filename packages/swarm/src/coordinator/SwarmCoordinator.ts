/**
 * Swarm Coordinator - Main orchestrator for swarm operations
 *
 * Ties together:
 * - Topology management
 * - Load balancing
 * - Agent pool management
 * - Task dispatching
 */

import { EventEmitter } from 'eventemitter3';
import { TopologyManager } from '../topology/TopologyManager.js';
import { LoadBalancer } from '../load-balancer/LoadBalancer.js';
import { AgentPool, DefaultAgentFactory, DEFAULT_AGENT_TYPE_CONFIGS } from '../agent-pool/AgentPool.js';
import type {
  TopologyConfig,
  SwarmAgent,
  TopologyType,
  TopologyMetrics,
  SwarmAgentType,
  ConsensusVote,
  ConsensusResult,
} from '../topology/types.js';
import type {
  LoadBalancerConfig,
  Task,
  LoadBalancerMetrics,
  BalancingStrategy,
} from '../load-balancer/types.js';
import type {
  AgentPoolConfig,
  AgentPoolMetrics,
  SpawnRequest,
  AgentFactory,
  WorkStealingConfig,
} from '../agent-pool/types.js';

/**
 * Swarm configuration
 */
export interface SwarmConfig {
  /** Swarm identifier */
  id?: string;
  /** Topology configuration */
  topology: TopologyConfig;
  /** Load balancer configuration */
  loadBalancer: LoadBalancerConfig;
  /** Agent pool configuration */
  agentPool: AgentPoolConfig;
  /** Enable auto-optimization */
  autoOptimize?: boolean;
  /** Optimization interval in ms */
  optimizationIntervalMs?: number;
  /** Work stealing configuration */
  workStealing?: WorkStealingConfig;
  /** Consensus configuration */
  consensus?: ConsensusConfig;
}

/**
 * Consensus configuration
 */
export interface ConsensusConfig {
  /** Enable consensus for distributed decisions */
  enabled: boolean;
  /** Minimum votes required for consensus */
  quorumSize: number;
  /** Timeout for collecting votes in ms */
  timeoutMs: number;
  /** Required approval ratio (0-1) */
  approvalThreshold: number;
  /** Require confidence threshold */
  minConfidence: number;
}

/**
 * Authorization pipeline request
 */
export interface AuthorizationPipelineRequest {
  /** Request ID */
  requestId: string;
  /** Subject (who is requesting) */
  subject: { id: string; type: string; attributes?: Record<string, unknown> };
  /** Resource being accessed */
  resource: { id: string; type: string; attributes?: Record<string, unknown> };
  /** Action being performed */
  action: string;
  /** Context information */
  context?: Record<string, unknown>;
  /** Whether to require consensus */
  requireConsensus?: boolean;
}

/**
 * Authorization pipeline result
 */
export interface AuthorizationPipelineResult {
  /** Request ID */
  requestId: string;
  /** Final decision */
  decision: 'allow' | 'deny' | 'indeterminate';
  /** Confidence level (0-1) */
  confidence: number;
  /** Consensus result if applicable */
  consensus?: ConsensusResult;
  /** Contributing agent decisions */
  agentDecisions: Array<{
    agentId: string;
    agentType: SwarmAgentType;
    decision: 'allow' | 'deny' | 'indeterminate';
    confidence: number;
    reason?: string;
  }>;
  /** Total processing time in ms */
  processingTimeMs: number;
}

/**
 * Swarm instance state
 */
export interface SwarmInstance {
  /** Swarm ID */
  id: string;
  /** Current topology type */
  topology: TopologyType;
  /** Active agents */
  agents: Map<string, SwarmAgent>;
  /** Combined metrics */
  metrics: SwarmMetrics;
  /** Created timestamp */
  createdAt: Date;
  /** Last activity */
  lastActivity: Date;
}

/**
 * Combined swarm metrics
 */
export interface SwarmMetrics {
  topology: TopologyMetrics;
  loadBalancer: LoadBalancerMetrics;
  agentPool: AgentPoolMetrics;
  /** Tasks dispatched */
  tasksDispatched: number;
  /** Tasks completed */
  tasksCompleted: number;
  /** Tasks failed */
  tasksFailed: number;
  /** Average task latency */
  avgTaskLatencyMs: number;
  /** Swarm uptime */
  uptimeMs: number;
  /** Last updated */
  updatedAt: Date;
}

/**
 * Swarm event types
 */
export type SwarmEventType =
  | 'initialized'
  | 'shutdown'
  | 'task_dispatched'
  | 'task_completed'
  | 'task_failed'
  | 'agent_added'
  | 'agent_removed'
  | 'topology_changed'
  | 'optimized';

/**
 * Swarm event payload
 */
export interface SwarmEvent {
  type: SwarmEventType;
  timestamp: Date;
  swarmId: string;
  data: Record<string, unknown>;
}

/**
 * Task execution result
 */
export interface TaskResult<T = unknown> {
  /** Task ID */
  taskId: string;
  /** Whether task succeeded */
  success: boolean;
  /** Result data (if success) */
  data?: T;
  /** Error message (if failed) */
  error?: string;
  /** Agent that executed the task */
  agentId: string;
  /** Execution duration in ms */
  durationMs: number;
}

/**
 * Task executor function type
 */
export type TaskExecutor<T = unknown> = (
  agent: SwarmAgent,
  task: Task
) => Promise<T>;

/**
 * Swarm Coordinator - Main orchestration class
 */
export class SwarmCoordinator extends EventEmitter {
  private id: string;
  private config: SwarmConfig;
  private topologyManager: TopologyManager;
  private loadBalancer: LoadBalancer;
  private agentPool: AgentPool;
  private isInitialized = false;
  private startTime: Date = new Date();
  private taskMetrics = {
    dispatched: 0,
    completed: 0,
    failed: 0,
    totalLatencyMs: 0,
  };
  private optimizationInterval?: ReturnType<typeof setInterval>;
  private taskExecutors: Map<string, TaskExecutor> = new Map();
  private pendingTasks: Map<string, { task: Task; startTime: number }> = new Map();

  constructor(config: SwarmConfig, agentFactory?: AgentFactory) {
    super();
    this.id = config.id ?? `swarm-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.config = config;

    this.topologyManager = new TopologyManager(config.topology);
    this.loadBalancer = new LoadBalancer(config.loadBalancer);
    this.agentPool = new AgentPool(
      config.agentPool,
      agentFactory ?? new DefaultAgentFactory()
    );

    this.setupEventForwarding();
  }

  /**
   * Initialize the swarm
   */
  async initialize(): Promise<SwarmInstance> {
    if (this.isInitialized) {
      throw new Error('Swarm already initialized');
    }

    this.startTime = new Date();

    // Initialize agent pool
    const agents = await this.agentPool.initialize();

    // Setup topology
    this.topologyManager.connect(agents);

    // Initialize load balancer
    this.loadBalancer.initialize(agents);

    this.isInitialized = true;

    // Start optimization if enabled
    if (this.config.autoOptimize) {
      this.startOptimization();
    }

    this.emitEvent('initialized', { agentCount: agents.length });

    return this.getInstance();
  }

  /**
   * Shutdown the swarm
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    // Stop optimization
    if (this.optimizationInterval) {
      clearInterval(this.optimizationInterval);
      this.optimizationInterval = undefined;
    }

    // Stop work stealing
    if (this.workStealingInterval) {
      clearInterval(this.workStealingInterval);
      this.workStealingInterval = undefined;
    }

    // Shutdown agent pool
    await this.agentPool.shutdown();

    this.isInitialized = false;
    this.emitEvent('shutdown', {});
  }

  /**
   * Dispatch a task to the swarm
   */
  async dispatch<T>(task: Task): Promise<TaskResult<T>> {
    if (!this.isInitialized) {
      throw new Error('Swarm not initialized');
    }

    const startTime = Date.now();
    this.taskMetrics.dispatched++;

    // Assign task to an agent
    const assignment = this.loadBalancer.assign(task);

    if (!assignment) {
      // Try to scale up
      if (this.agentPool.size < this.config.agentPool.maxAgents) {
        await this.agentPool.scale(this.agentPool.size + 1);
        return this.dispatch(task);
      }

      this.taskMetrics.failed++;
      this.emitEvent('task_failed', { taskId: task.id, reason: 'No agents available' });

      return {
        taskId: task.id,
        success: false,
        error: 'No agents available',
        agentId: '',
        durationMs: Date.now() - startTime,
      };
    }

    this.pendingTasks.set(task.id, { task, startTime });
    this.emitEvent('task_dispatched', { taskId: task.id, agentId: assignment.agentId });

    // Execute task
    const agent = this.agentPool.getAgent(assignment.agentId);
    if (!agent) {
      this.taskMetrics.failed++;
      this.pendingTasks.delete(task.id);

      return {
        taskId: task.id,
        success: false,
        error: 'Agent not found',
        agentId: assignment.agentId,
        durationMs: Date.now() - startTime,
      };
    }

    // Update agent status
    this.agentPool.updateAgentStatus(agent.id, 'busy');

    try {
      // Execute with timeout
      const executor = this.taskExecutors.get(task.type);
      let result: T;

      if (executor) {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error('Task timeout')),
            task.timeoutMs ?? 30000
          );
        });

        result = await Promise.race([
          executor(agent, task) as Promise<T>,
          timeoutPromise,
        ]);
      } else {
        // Default execution - just return the payload
        result = task.payload as T;
      }

      const durationMs = Date.now() - startTime;
      this.recordTaskCompletion(task.id, agent.id, true, durationMs);

      return {
        taskId: task.id,
        success: true,
        data: result,
        agentId: agent.id,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.recordTaskCompletion(task.id, agent.id, false, durationMs);

      // Handle retries
      if ((task.retries ?? 0) < (task.maxRetries ?? 3)) {
        task.retries = (task.retries ?? 0) + 1;
        return this.dispatch(task);
      }

      return {
        taskId: task.id,
        success: false,
        error: errorMessage,
        agentId: agent.id,
        durationMs,
      };
    }
  }

  /**
   * Register a task executor
   */
  registerExecutor<T>(taskType: string, executor: TaskExecutor<T>): void {
    this.taskExecutors.set(taskType, executor as TaskExecutor);
  }

  /**
   * Scale the swarm
   */
  async scale(targetAgents: number): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Swarm not initialized');
    }

    const current = this.agentPool.size;
    await this.agentPool.scale(targetAgents);

    // Update topology and load balancer
    const agents = this.agentPool.getAllAgents();

    if (targetAgents > current) {
      const newAgents = agents.slice(current);
      this.topologyManager.addAgents(newAgents);
      this.loadBalancer.addAgents(newAgents);
    } else {
      const removedIds = this.loadBalancer.selectForRemoval(current - targetAgents);
      this.topologyManager.removeAgents(removedIds);
      for (const id of removedIds) {
        this.loadBalancer.removeAgent(id);
      }
    }
  }

  /**
   * Add an agent to the swarm
   */
  async addAgent(request: SpawnRequest): Promise<SwarmAgent> {
    if (!this.isInitialized) {
      throw new Error('Swarm not initialized');
    }

    const result = await this.agentPool.spawn(request);
    this.topologyManager.addAgents([result.agent]);
    this.loadBalancer.addAgent(result.agent);

    this.emitEvent('agent_added', { agentId: result.agent.id });

    return result.agent;
  }

  /**
   * Remove an agent from the swarm
   */
  async removeAgent(agentId: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Swarm not initialized');
    }

    await this.agentPool.recycle(agentId);
    this.topologyManager.removeAgents([agentId]);
    this.loadBalancer.removeAgent(agentId);

    this.emitEvent('agent_removed', { agentId });
  }

  /**
   * Get swarm instance
   */
  getInstance(): SwarmInstance {
    return {
      id: this.id,
      topology: this.topologyManager.getType(),
      agents: new Map(
        this.agentPool.getAllAgents().map(a => [a.id, a])
      ),
      metrics: this.getMetrics(),
      createdAt: this.startTime,
      lastActivity: new Date(),
    };
  }

  /**
   * Get combined metrics
   */
  getMetrics(): SwarmMetrics {
    const avgLatency = this.taskMetrics.completed > 0
      ? this.taskMetrics.totalLatencyMs / this.taskMetrics.completed
      : 0;

    return {
      topology: this.topologyManager.getMetrics(),
      loadBalancer: this.loadBalancer.getMetrics(),
      agentPool: this.agentPool.getMetrics(),
      tasksDispatched: this.taskMetrics.dispatched,
      tasksCompleted: this.taskMetrics.completed,
      tasksFailed: this.taskMetrics.failed,
      avgTaskLatencyMs: avgLatency,
      uptimeMs: Date.now() - this.startTime.getTime(),
      updatedAt: new Date(),
    };
  }

  /**
   * Get agent count
   */
  getAgentCount(): number {
    return this.agentPool.size;
  }

  /**
   * Get all agents
   */
  getAgents(): SwarmAgent[] {
    return this.agentPool.getAllAgents();
  }

  /**
   * Get topology type
   */
  getTopologyType(): TopologyType {
    return this.topologyManager.getType();
  }

  /**
   * Get load balancing strategy
   */
  getStrategy(): BalancingStrategy {
    return this.loadBalancer.getStrategy();
  }

  /**
   * Set load balancing strategy
   */
  setStrategy(strategy: BalancingStrategy): void {
    this.loadBalancer.setStrategy(strategy);
  }

  /**
   * Rebalance the swarm
   */
  rebalance(): void {
    this.topologyManager.rebalance();
    this.loadBalancer.rebalance();
  }

  /**
   * Optimize swarm configuration
   */
  optimize(): void {
    // Rebalance topology
    this.topologyManager.rebalance();

    // Rebalance load
    this.loadBalancer.rebalance();

    this.emitEvent('optimized', {});
  }

  /**
   * Execute authorization pipeline across multiple agent types
   */
  async executeAuthorizationPipeline(
    request: AuthorizationPipelineRequest
  ): Promise<AuthorizationPipelineResult> {
    const startTime = Date.now();
    const agentDecisions: AuthorizationPipelineResult['agentDecisions'] = [];

    // Stage 1: Guardian agents perform initial threat detection
    const guardianResult = await this.dispatchToAgentType('GUARDIAN', {
      id: `${request.requestId}-guardian`,
      type: 'authorization',
      priority: 'high',
      payload: request,
      createdAt: new Date(),
    });

    if (guardianResult.success) {
      agentDecisions.push({
        agentId: guardianResult.agentId,
        agentType: 'GUARDIAN',
        decision: (guardianResult.data as any)?.decision ?? 'indeterminate',
        confidence: (guardianResult.data as any)?.confidence ?? 0.5,
        reason: (guardianResult.data as any)?.reason,
      });
    }

    // Stage 2: Analyst agents assess risk
    const analystResult = await this.dispatchToAgentType('ANALYST', {
      id: `${request.requestId}-analyst`,
      type: 'analysis',
      priority: 'medium',
      payload: { ...request, guardianResult: guardianResult.data },
      createdAt: new Date(),
    });

    if (analystResult.success) {
      agentDecisions.push({
        agentId: analystResult.agentId,
        agentType: 'ANALYST',
        decision: (analystResult.data as any)?.decision ?? 'indeterminate',
        confidence: (analystResult.data as any)?.confidence ?? 0.5,
        reason: (analystResult.data as any)?.reason,
      });
    }

    // Stage 3: If consensus required, gather votes from advisors
    let consensusResult: ConsensusResult | undefined;
    if (request.requireConsensus && this.config.consensus?.enabled) {
      consensusResult = await this.runConsensus(
        request.requestId,
        agentDecisions.map(d => d.decision === 'allow')
      );
    }

    // Stage 4: Enforcer makes final decision
    const enforcerResult = await this.dispatchToAgentType('ENFORCER', {
      id: `${request.requestId}-enforcer`,
      type: 'enforcement',
      priority: 'critical',
      payload: {
        ...request,
        agentDecisions,
        consensus: consensusResult,
      },
      createdAt: new Date(),
    });

    if (enforcerResult.success) {
      agentDecisions.push({
        agentId: enforcerResult.agentId,
        agentType: 'ENFORCER',
        decision: (enforcerResult.data as any)?.decision ?? 'indeterminate',
        confidence: (enforcerResult.data as any)?.confidence ?? 0.5,
        reason: (enforcerResult.data as any)?.reason,
      });
    }

    // Calculate final decision based on all inputs
    const finalDecision = this.calculateFinalDecision(agentDecisions, consensusResult);

    return {
      requestId: request.requestId,
      decision: finalDecision.decision,
      confidence: finalDecision.confidence,
      consensus: consensusResult,
      agentDecisions,
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Dispatch task to a specific agent type
   */
  async dispatchToAgentType<T>(
    agentType: SwarmAgentType,
    task: Task
  ): Promise<TaskResult<T>> {
    const agents = this.agentPool.getAgentsByType(agentType);
    const availableAgents = agents.filter(a =>
      a.status === 'idle' || (a.status === 'busy' && a.load < 0.8)
    );

    if (availableAgents.length === 0) {
      // Try to spawn a new agent of this type
      if (this.agentPool.size < this.config.agentPool.maxAgents) {
        const newAgent = await this.addAgent({
          type: agentType,
          capabilities: DEFAULT_AGENT_TYPE_CONFIGS[agentType].capabilities,
        });
        availableAgents.push(newAgent);
      }
    }

    if (availableAgents.length === 0) {
      return {
        taskId: task.id,
        success: false,
        error: `No ${agentType} agents available`,
        agentId: '',
        durationMs: 0,
      };
    }

    // Select best agent (least loaded)
    const selectedAgent = availableAgents.sort((a, b) => a.load - b.load)[0]!;

    // Update task with preferred agent
    task.preferredAgentTypes = [agentType];

    return this.dispatch({ ...task, metadata: { ...task.metadata, targetAgent: selectedAgent.id } });
  }

  /**
   * Run consensus across advisor agents
   */
  async runConsensus(
    proposalId: string,
    initialVotes: boolean[]
  ): Promise<ConsensusResult> {
    const startTime = Date.now();
    const advisors = this.agentPool.getAgentsByType('ADVISOR');
    const config = this.config.consensus ?? {
      enabled: true,
      quorumSize: 3,
      timeoutMs: 5000,
      approvalThreshold: 0.6,
      minConfidence: 0.5,
    };

    const votes: ConsensusVote[] = [];

    // Collect votes from advisors with timeout
    const votePromises = advisors.slice(0, config.quorumSize).map(async (advisor, index) => {
      const task: Task = {
        id: `consensus-${proposalId}-${advisor.id}`,
        type: 'recommendation',
        priority: 'high',
        payload: { proposalId, initialVotes },
        createdAt: new Date(),
        timeoutMs: config.timeoutMs,
      };

      const result = await this.dispatch(task);
      if (result.success) {
        return {
          agentId: advisor.id,
          vote: (result.data as any)?.approve ?? initialVotes[index % initialVotes.length] ?? true,
          confidence: (result.data as any)?.confidence ?? 0.5,
          timestamp: new Date(),
          reason: (result.data as any)?.reason,
        };
      }
      return null;
    });

    const voteResults = await Promise.all(
      votePromises.map(p =>
        Promise.race([
          p,
          new Promise<null>(resolve => setTimeout(() => resolve(null), config.timeoutMs)),
        ])
      )
    );

    for (const vote of voteResults) {
      if (vote) votes.push(vote);
    }

    const approvals = votes.filter(v => v.vote).length;
    const rejections = votes.filter(v => !v.vote).length;
    const avgConfidence = votes.length > 0
      ? votes.reduce((sum, v) => sum + v.confidence, 0) / votes.length
      : 0;

    const reached = votes.length >= config.quorumSize && avgConfidence >= config.minConfidence;
    const decision = approvals / votes.length >= config.approvalThreshold;

    return {
      proposalId,
      reached,
      decision,
      totalVotes: votes.length,
      approvals,
      rejections,
      avgConfidence,
      participants: votes.map(v => v.agentId),
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Calculate final authorization decision
   */
  private calculateFinalDecision(
    agentDecisions: AuthorizationPipelineResult['agentDecisions'],
    consensus?: ConsensusResult
  ): { decision: 'allow' | 'deny' | 'indeterminate'; confidence: number } {
    if (agentDecisions.length === 0) {
      return { decision: 'indeterminate', confidence: 0 };
    }

    // Weight decisions by agent type priority
    let totalWeight = 0;
    let weightedAllow = 0;
    let weightedDeny = 0;

    for (const d of agentDecisions) {
      const weight = DEFAULT_AGENT_TYPE_CONFIGS[d.agentType].priorityWeight * d.confidence;
      totalWeight += weight;

      if (d.decision === 'allow') {
        weightedAllow += weight;
      } else if (d.decision === 'deny') {
        weightedDeny += weight;
      }
    }

    // Factor in consensus if available
    if (consensus?.reached) {
      const consensusWeight = 5 * consensus.avgConfidence;
      totalWeight += consensusWeight;
      if (consensus.decision) {
        weightedAllow += consensusWeight;
      } else {
        weightedDeny += consensusWeight;
      }
    }

    const allowRatio = totalWeight > 0 ? weightedAllow / totalWeight : 0;
    const denyRatio = totalWeight > 0 ? weightedDeny / totalWeight : 0;

    if (allowRatio > 0.6) {
      return { decision: 'allow', confidence: allowRatio };
    } else if (denyRatio > 0.4) {
      return { decision: 'deny', confidence: denyRatio };
    } else {
      return { decision: 'indeterminate', confidence: Math.max(allowRatio, denyRatio) };
    }
  }

  /**
   * Work stealing - redistribute tasks from overloaded agents
   */
  async performWorkStealing(): Promise<number> {
    if (!this.config.workStealing?.enabled) {
      return 0;
    }

    const config = this.config.workStealing;
    let stolenTasks = 0;

    // Find overloaded agents (high load)
    const overloadedAgents = this.agentPool.getAllAgents()
      .filter(a => a.load > 0.8 && a.status === 'busy');

    // Find idle agents that can steal work
    const idleAgents = this.agentPool.getAllAgents()
      .filter(a => a.load < config.stealThreshold && a.status === 'idle');

    for (const overloaded of overloadedAgents) {
      for (const idle of idleAgents) {
        if (stolenTasks >= config.maxStealCount) break;

        // Check if idle agent can handle tasks from overloaded agent
        const overloadedConfig = DEFAULT_AGENT_TYPE_CONFIGS[overloaded.type];
        const idleConfig = DEFAULT_AGENT_TYPE_CONFIGS[idle.type];

        // Can steal if they support overlapping task types
        const canSteal = overloadedConfig.supportedTaskTypes.some(
          t => idleConfig.supportedTaskTypes.includes(t)
        );

        if (canSteal) {
          // In a real implementation, this would transfer actual pending tasks
          // For now, we simulate by adjusting loads
          const transferAmount = Math.min(0.2, overloaded.load - 0.5);
          this.agentPool.updateAgentLoad(overloaded.id, overloaded.load - transferAmount);
          this.agentPool.updateAgentLoad(idle.id, idle.load + transferAmount);
          stolenTasks++;

          this.emitEvent('work_stolen' as SwarmEventType, {
            from: overloaded.id,
            to: idle.id,
            amount: transferAmount,
          });
        }
      }
    }

    return stolenTasks;
  }

  /**
   * Get agents by type
   */
  getAgentsByType(type: SwarmAgentType): SwarmAgent[] {
    return this.agentPool.getAgentsByType(type);
  }

  /**
   * Register authorization agents for distributed policy enforcement
   *
   * Sets up all four authorization agent types:
   * - GUARDIAN: Threat detection and security checks
   * - ANALYST: Risk assessment and pattern analysis
   * - ADVISOR: Recommendations and compliance verification
   * - ENFORCER: Final decision execution and rate limiting
   */
  async registerAuthzAgents(
    guardianCount: number = 2,
    analystCount: number = 1,
    advisorCount: number = 2,
    enforcerCount: number = 2
  ): Promise<SwarmAgent[]> {
    if (!this.isInitialized) {
      throw new Error('Swarm must be initialized before registering agents');
    }

    const distribution: Partial<Record<SwarmAgentType, number>> = {
      GUARDIAN: guardianCount,
      ANALYST: analystCount,
      ADVISOR: advisorCount,
      ENFORCER: enforcerCount,
    };

    // Spawn agents by type distribution
    const results = await this.agentPool.spawnByTypeDistribution(distribution);
    const agents = results.map(r => r.agent);

    // Add to topology
    this.topologyManager.addAgents(agents);

    // Add to load balancer
    this.loadBalancer.addAgents(agents);

    // Warm up agents
    for (const result of results) {
      await this.agentPool.warmupAgent(result.agent.id);
    }

    this.emitEvent('authz_agents_registered' as SwarmEventType, {
      count: agents.length,
      distribution,
    });

    return agents;
  }

  /**
   * Coordinate authorization pipeline across distributed agents
   *
   * Orchestrates multi-stage authorization decisions:
   * 1. Guardian performs threat detection
   * 2. Analyst assesses risk
   * 3. Advisor provides recommendations
   * 4. Enforcer makes final decision
   *
   * @param request Authorization request with subject, resource, and action
   * @returns Distributed decision with consensus results
   */
  async coordinateAuthzPipeline(
    request: AuthorizationPipelineRequest
  ): Promise<AuthorizationPipelineResult> {
    return this.executeAuthorizationPipeline(request);
  }

  /**
   * Run distributed consensus across advisor agents
   *
   * Uses Byzantine fault-tolerant voting:
   * - Collects votes from multiple advisors
   * - Enforces quorum requirements
   * - Calculates confidence levels
   * - Handles timeout scenarios
   *
   * @param proposalId Unique proposal identifier
   * @param initialVotes Starting votes to aggregate
   * @param _quorumSize Number of votes required (optional, uses config default)
   * @returns Consensus result with decision and confidence
   */
  async runDistributedConsensus(
    proposalId: string,
    initialVotes: boolean[],
    _quorumSize?: number
  ): Promise<ConsensusResult> {
    if (!this.isInitialized) {
      throw new Error('Swarm not initialized');
    }

    return this.runConsensus(proposalId, initialVotes);
  }

  /**
   * Initialize with authorization agent distribution
   */
  async initializeWithAuthorizationAgents(
    distribution: Partial<Record<SwarmAgentType, number>> = {
      GUARDIAN: 2,
      ANALYST: 1,
      ADVISOR: 2,
      ENFORCER: 2,
      COORDINATOR: 1,
    }
  ): Promise<SwarmInstance> {
    if (this.isInitialized) {
      throw new Error('Swarm already initialized');
    }

    this.startTime = new Date();

    // Spawn agents by type distribution
    const results = await this.agentPool.spawnByTypeDistribution(distribution);
    const agents = results.map(r => r.agent);

    // Setup topology
    this.topologyManager.connect(agents);

    // Initialize load balancer
    this.loadBalancer.initialize(agents);

    this.isInitialized = true;

    // Start optimization and work stealing if enabled
    if (this.config.autoOptimize) {
      this.startOptimization();
    }

    if (this.config.workStealing?.enabled) {
      this.startWorkStealingLoop();
    }

    this.emitEvent('initialized', {
      agentCount: agents.length,
      distribution,
    });

    return this.getInstance();
  }

  private workStealingInterval?: ReturnType<typeof setInterval>;

  private startWorkStealingLoop(): void {
    const interval = this.config.workStealing?.checkIntervalMs ?? 5000;
    this.workStealingInterval = setInterval(() => {
      this.performWorkStealing().catch(() => {});
    }, interval);
  }

  private recordTaskCompletion(
    taskId: string,
    agentId: string,
    success: boolean,
    durationMs: number
  ): void {
    this.pendingTasks.delete(taskId);
    this.loadBalancer.completeTask(taskId, success, durationMs);

    // Update agent status
    this.agentPool.updateAgentStatus(agentId, 'idle');
    this.agentPool.recordHeartbeat(agentId);

    if (success) {
      this.taskMetrics.completed++;
      this.taskMetrics.totalLatencyMs += durationMs;
      this.emitEvent('task_completed', { taskId, agentId, durationMs });
    } else {
      this.taskMetrics.failed++;
      this.emitEvent('task_failed', { taskId, agentId, durationMs });
    }
  }

  private startOptimization(): void {
    const interval = this.config.optimizationIntervalMs ?? 60000;
    this.optimizationInterval = setInterval(() => {
      this.optimize();
    }, interval);
  }

  private setupEventForwarding(): void {
    // Forward events from sub-components
    this.topologyManager.on('topologyEvent', event => {
      this.emit('topologyEvent', event);
    });

    this.loadBalancer.on('loadBalancerEvent', event => {
      this.emit('loadBalancerEvent', event);
    });

    this.agentPool.on('poolEvent', event => {
      this.emit('poolEvent', event);
    });
  }

  private emitEvent(type: SwarmEventType, data: Record<string, unknown>): void {
    const event: SwarmEvent = {
      type,
      timestamp: new Date(),
      swarmId: this.id,
      data,
    };
    this.emit('swarmEvent', event);
  }
}

// Export factory function
export function createSwarm(config: SwarmConfig, agentFactory?: AgentFactory): SwarmCoordinator {
  return new SwarmCoordinator(config, agentFactory);
}
