/**
 * Agent Orchestrator - Coordinates all four agents with advanced features
 *
 * Provides unified API for:
 * - Starting/stopping all agents
 * - Processing authorization requests through the agent pipeline
 * - Health monitoring with circuit breakers
 * - Configuration management with hot-reload
 * - Event-driven architecture
 * - Metrics and tracing
 */

import type { CheckRequest, CheckResponse, ActionResult } from '@authz-engine/core';
import { GuardianAgent } from '../guardian/guardian-agent.js';
import { AnalystAgent } from '../analyst/analyst-agent.js';
import { AdvisorAgent } from '../advisor/advisor-agent.js';
import { EnforcerAgent } from '../enforcer/enforcer-agent.js';
import { DecisionStore, type DecisionStoreConfig } from '../core/decision-store.js';
import { EventBus, type EventBusConfig } from '../core/event-bus.js';
import type {
  AgentConfig,
  AgentHealth,
  DecisionRecord,
  DecisionExplanation,
  Anomaly,
  LearnedPattern,
  EnforcerAction,
  AgentType,
} from '../types/agent.types.js';

// Advanced feature imports
import {
  type PipelineConfig,
  type PipelineContext,
  type PipelineResult,
  type PipelineStep,
  type StepResult,
  DEFAULT_PIPELINES,
  evaluateCondition,
} from './pipeline/pipeline-config.js';
import {
  CircuitBreaker,
  CircuitBreakerManager,
  type CircuitBreakerConfig,
  type CircuitStateChange,
  type FallbackStrategy,
} from './circuit-breaker/circuit-breaker.js';
import {
  MetricsCollector,
  type MetricsConfig,
  type AgentMetricsSnapshot,
  type AuditTrailEntry,
  type SpanData,
} from './metrics/metrics-collector.js';
import {
  EventManager,
  type OrchestratorEvent,
  type EventFilter,
  type EventSubscription,
  type ReplayOptions,
} from './events/event-manager.js';
import {
  ConfigManager,
  type DynamicConfig,
  type FeatureFlag,
  type ABTestConfig,
  type ConfigChangeEvent,
} from './config/config-manager.js';

export interface OrchestratorConfig {
  agents: AgentConfig;
  store: DecisionStoreConfig;
  eventBus: EventBusConfig;
  /** Pipeline configuration */
  pipeline?: PipelineConfig;
  /** Circuit breaker configurations per agent */
  circuitBreakers?: Partial<Record<AgentType, CircuitBreakerConfig>>;
  /** Fallback strategies per agent */
  fallbackStrategies?: Partial<Record<AgentType, FallbackStrategy>>;
  /** Metrics configuration */
  metrics?: Partial<MetricsConfig>;
  /** Enable advanced features */
  advanced?: {
    /** Enable circuit breakers (default: true) */
    circuitBreakersEnabled?: boolean;
    /** Enable metrics collection (default: true) */
    metricsEnabled?: boolean;
    /** Enable event-driven architecture (default: true) */
    eventsEnabled?: boolean;
    /** Enable configuration hot-reload (default: false) */
    hotReloadEnabled?: boolean;
  };
}

export interface ProcessingResult {
  // From decision engine (passed through)
  response: CheckResponse;

  // From GUARDIAN
  anomalyScore: number;
  anomaly?: Anomaly;

  // From ADVISOR
  explanation?: DecisionExplanation;

  // From ENFORCER
  enforcement?: {
    allowed: boolean;
    reason?: string;
    action?: EnforcerAction;
  };

  // Metadata
  processingTimeMs: number;
  agentsInvolved: string[];

  // Advanced metadata
  pipelineResult?: PipelineResult;
  traceId?: string;
  spanId?: string;
}

export interface ProcessingOptions {
  includeExplanation?: boolean;
  policyContext?: { matchedRules: string[]; derivedRoles: string[] };
  /** Override pipeline for this request */
  pipeline?: string | PipelineConfig;
  /** User ID for A/B testing */
  userId?: string;
  /** Session ID for A/B testing */
  sessionId?: string;
  /** Correlation ID for tracing */
  correlationId?: string;
  /** Skip circuit breaker checks */
  skipCircuitBreaker?: boolean;
}

export class AgentOrchestrator {
  private readonly config: OrchestratorConfig;
  private store: DecisionStore;

  /** Get orchestrator config for testing */
  getConfig(): OrchestratorConfig {
    return this.config;
  }
  private eventBus: EventBus;

  private guardian: GuardianAgent;
  private analyst: AnalystAgent;
  private advisor: AdvisorAgent;
  private enforcer: EnforcerAgent;

  private isInitialized = false;

  // Advanced feature components
  private circuitBreakerManager: CircuitBreakerManager;
  private metricsCollector: MetricsCollector;
  private eventManager: EventManager;
  private configManager: ConfigManager;
  private pipelines: Map<string, PipelineConfig> = new Map();

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.store = new DecisionStore(config.store);
    this.eventBus = new EventBus(config.eventBus);

    // Initialize agents
    this.guardian = new GuardianAgent(config.agents, this.store, this.eventBus);
    this.analyst = new AnalystAgent(config.agents, this.store, this.eventBus);
    this.advisor = new AdvisorAgent(config.agents, this.store, this.eventBus);
    this.enforcer = new EnforcerAgent(config.agents, this.store, this.eventBus);

    // Initialize advanced features
    this.circuitBreakerManager = new CircuitBreakerManager(
      config.circuitBreakers ?? {},
      config.fallbackStrategies ?? {}
    );

    this.metricsCollector = new MetricsCollector(config.metrics ?? {});
    this.eventManager = new EventManager();
    this.configManager = new ConfigManager({
      agents: config.agents,
      pipeline: config.pipeline,
    });

    // Initialize default pipelines
    for (const [id, pipeline] of Object.entries(DEFAULT_PIPELINES)) {
      this.pipelines.set(id, pipeline);
    }

    // Add custom pipeline if provided
    if (config.pipeline) {
      this.pipelines.set(config.pipeline.id, config.pipeline);
    }

    // Set up circuit breaker state change handling
    this.setupCircuitBreakerHandling();

    // Set up config change handling
    this.setupConfigChangeHandling();
  }

  /**
   * Initialize all agents and infrastructure
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log('[Orchestrator] Initializing agentic authorization system...');

    // Emit initialization event
    await this.eventManager.emit({
      type: 'pipeline_started',
      source: 'orchestrator',
      payload: { phase: 'initialization' },
      metadata: {},
    });

    // Initialize infrastructure
    await this.store.initialize();
    await this.eventBus.initialize();

    // Start advanced components
    this.metricsCollector.start();
    this.eventManager.start();

    // Initialize agents in parallel
    await Promise.all([
      this.guardian.initialize(),
      this.analyst.initialize(),
      this.advisor.initialize(),
      this.enforcer.initialize(),
    ]);

    this.isInitialized = true;

    // Emit completion event
    await this.eventManager.emit({
      type: 'pipeline_completed',
      source: 'orchestrator',
      payload: { phase: 'initialization', success: true },
      metadata: {},
    });

    console.log('[Orchestrator] All agents initialized and ready');
  }

  /**
   * Shutdown all agents
   */
  async shutdown(): Promise<void> {
    console.log('[Orchestrator] Shutting down agents...');

    await Promise.all([
      this.guardian.shutdown(),
      this.analyst.shutdown(),
      this.advisor.shutdown(),
      this.enforcer.shutdown(),
    ]);

    // Stop advanced components
    this.metricsCollector.stop();
    this.eventManager.stop();
    this.configManager.stop();

    await this.eventBus.shutdown();
    await this.store.close();

    this.isInitialized = false;
    console.log('[Orchestrator] Shutdown complete');
  }

  /**
   * Process a request through the agentic pipeline
   *
   * This is called AFTER the core decision engine has made a decision.
   * The agents augment the decision with:
   * - Anomaly detection (GUARDIAN)
   * - Enforcement checks (ENFORCER)
   * - Explanations (ADVISOR)
   * - Recording for learning (stored for ANALYST)
   */
  async processRequest(
    request: CheckRequest,
    response: CheckResponse,
    options?: ProcessingOptions
  ): Promise<ProcessingResult> {
    const startTime = Date.now();
    const correlationId = options?.correlationId ?? `corr-${Date.now()}-${Math.random().toString(36).substring(2)}`;
    const requestId = request.requestId ?? `req-${Date.now()}`;

    // Start tracing span
    const rootSpan = this.metricsCollector.startSpan(
      'orchestrator.processRequest',
      'guardian',
      undefined,
      { 'request.id': requestId, 'correlation.id': correlationId }
    );

    // Emit pipeline start event
    await this.eventManager.emit({
      type: 'pipeline_started',
      source: 'orchestrator',
      correlationId,
      requestId,
      payload: { request, options },
      metadata: {},
    });

    try {
      // Get effective configuration with A/B test overrides
      const effectiveConfig = this.configManager.getEffectiveConfig({
        userId: options?.userId,
        sessionId: options?.sessionId,
      });

      // Determine which pipeline to use
      const pipeline = this.resolvePipeline(options?.pipeline);

      // Execute pipeline
      const pipelineResult = await this.executePipeline(
        pipeline,
        request,
        response,
        options ?? {},
        correlationId,
        rootSpan.spanId
      );

      const processingTimeMs = Date.now() - startTime;

      // Build result
      const result: ProcessingResult = {
        response: pipelineResult.result?.response ?? response,
        anomalyScore: pipelineResult.result?.anomalyScore ?? 0,
        anomaly: pipelineResult.result?.anomaly,
        explanation: pipelineResult.result?.explanation,
        enforcement: pipelineResult.result?.enforcement ?? { allowed: true },
        processingTimeMs,
        agentsInvolved: pipelineResult.steps
          .filter(s => !s.skipped && s.success)
          .map(s => s.agentType),
        pipelineResult,
        traceId: rootSpan.traceId,
        spanId: rootSpan.spanId,
      };

      // Record metrics
      this.metricsCollector.recordLatency('guardian', processingTimeMs, true);

      // Add audit entry
      this.metricsCollector.addAuditEntry({
        requestId,
        correlationId,
        agentType: 'guardian',
        operation: 'processRequest',
        durationMs: processingTimeMs,
        success: true,
        metadata: {
          pipelineId: pipeline.id,
          stepsExecuted: pipelineResult.metadata.stepsExecuted,
        },
      });

      // End span
      this.metricsCollector.endSpan(rootSpan.spanId, 'ok');

      // Emit completion event
      await this.eventManager.emit({
        type: 'pipeline_completed',
        source: 'orchestrator',
        correlationId,
        requestId,
        payload: { result, pipelineResult },
        metadata: { durationMs: processingTimeMs },
      });

      return result;
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;

      // End span with error
      this.metricsCollector.endSpan(rootSpan.spanId, 'error', error as Error);

      // Emit failure event
      await this.eventManager.emit({
        type: 'pipeline_failed',
        source: 'orchestrator',
        correlationId,
        requestId,
        payload: { error: (error as Error).message },
        metadata: { durationMs: processingTimeMs },
      });

      // Return fallback response
      return {
        response,
        anomalyScore: 0,
        enforcement: { allowed: true, reason: 'Pipeline failure fallback' },
        processingTimeMs,
        agentsInvolved: [],
      };
    }
  }

  /**
   * Get health status of all agents including circuit breaker status
   */
  async getHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    agents: Record<string, AgentHealth>;
    infrastructure: {
      store: 'connected' | 'disconnected';
      eventBus: 'connected' | 'disconnected';
    };
    circuitBreakers: ReturnType<CircuitBreakerManager['getHealthStatus']>;
    metrics: ReturnType<MetricsCollector['getSystemMetrics']>;
  }> {
    const [guardianHealth, analystHealth, advisorHealth, enforcerHealth] = await Promise.all([
      this.guardian.healthCheck(),
      this.analyst.healthCheck(),
      this.advisor.healthCheck(),
      this.enforcer.healthCheck(),
    ]);

    const agents = {
      guardian: guardianHealth,
      analyst: analystHealth,
      advisor: advisorHealth,
      enforcer: enforcerHealth,
    };

    const circuitBreakers = this.circuitBreakerManager.getHealthStatus();
    const allReady = Object.values(agents).every(h => h.state === 'ready');
    const anyError = Object.values(agents).some(h => h.state === 'error');
    const anyCircuitOpen = Object.values(circuitBreakers).some(cb => cb.state === 'open');

    // Emit health check event
    await this.eventManager.emit({
      type: 'health_check_completed',
      source: 'orchestrator',
      payload: { agents, circuitBreakers },
      metadata: {},
    });

    return {
      status: anyError ? 'unhealthy' : anyCircuitOpen ? 'degraded' : allReady ? 'healthy' : 'degraded',
      agents,
      infrastructure: {
        store: 'connected',
        eventBus: 'connected',
      },
      circuitBreakers,
      metrics: this.metricsCollector.getSystemMetrics(),
    };
  }

  // ============================================
  // Pipeline Configuration Methods
  // ============================================

  /**
   * Register a custom pipeline
   */
  registerPipeline(pipeline: PipelineConfig): void {
    this.pipelines.set(pipeline.id, pipeline);
  }

  /**
   * Get a pipeline by ID
   */
  getPipeline(id: string): PipelineConfig | undefined {
    return this.pipelines.get(id);
  }

  /**
   * Get all registered pipelines
   */
  getAllPipelines(): Map<string, PipelineConfig> {
    return new Map(this.pipelines);
  }

  /**
   * Set the default pipeline
   */
  setDefaultPipeline(id: string): void {
    if (!this.pipelines.has(id)) {
      throw new Error(`Pipeline not found: ${id}`);
    }
    // Update config
    this.configManager.updateConfig({
      pipeline: this.pipelines.get(id),
    });
  }

  // ============================================
  // Circuit Breaker Methods
  // ============================================

  /**
   * Get circuit breaker for an agent
   */
  getCircuitBreaker(agentType: AgentType): CircuitBreaker {
    return this.circuitBreakerManager.get(agentType);
  }

  /**
   * Force a circuit breaker open
   */
  tripCircuitBreaker(agentType: AgentType, reason: string): void {
    this.circuitBreakerManager.get(agentType).forceOpen(reason);
  }

  /**
   * Reset a circuit breaker
   */
  resetCircuitBreaker(agentType: AgentType, reason: string = 'Manual reset'): void {
    this.circuitBreakerManager.get(agentType).forceClose(reason);
  }

  /**
   * Reset all circuit breakers
   */
  resetAllCircuitBreakers(reason: string = 'Manual global reset'): void {
    this.circuitBreakerManager.resetAll(reason);
  }

  /**
   * Subscribe to circuit breaker state changes
   */
  onCircuitStateChange(handler: (change: CircuitStateChange) => void): () => void {
    return this.circuitBreakerManager.onStateChange(handler);
  }

  // ============================================
  // Metrics Methods
  // ============================================

  /**
   * Get metrics for a specific agent
   */
  getAgentMetrics(agentType: AgentType): AgentMetricsSnapshot {
    return this.metricsCollector.getAgentMetrics(agentType);
  }

  /**
   * Get metrics for all agents
   */
  getAllAgentMetrics(): Record<AgentType, AgentMetricsSnapshot> {
    return this.metricsCollector.getAllMetrics();
  }

  /**
   * Get audit trail
   */
  getAuditTrail(filters?: Parameters<MetricsCollector['getAuditTrail']>[0]): AuditTrailEntry[] {
    return this.metricsCollector.getAuditTrail(filters);
  }

  /**
   * Subscribe to metrics exports
   */
  onMetricsExport(handler: (metrics: Record<AgentType, AgentMetricsSnapshot>) => void): () => void {
    return this.metricsCollector.onExport(handler);
  }

  /**
   * Reset all metrics
   */
  resetMetrics(): void {
    this.metricsCollector.reset();
  }

  // ============================================
  // Event Methods
  // ============================================

  /**
   * Subscribe to orchestrator events
   */
  subscribeToEvents(
    filter: EventFilter,
    handler: (event: OrchestratorEvent) => void | Promise<void>,
    priority?: number
  ): EventSubscription {
    return this.eventManager.subscribe(filter, handler, priority);
  }

  /**
   * Subscribe to a specific event type
   */
  onEvent(
    type: OrchestratorEvent['type'],
    handler: (event: OrchestratorEvent) => void | Promise<void>
  ): EventSubscription {
    return this.eventManager.on(type, handler);
  }

  /**
   * Replay events for debugging
   */
  async replayEvents(options?: ReplayOptions): Promise<OrchestratorEvent[]> {
    return this.eventManager.replay(options);
  }

  /**
   * Get event timeline for a correlation ID
   */
  getEventTimeline(correlationId: string): OrchestratorEvent[] {
    return this.eventManager.getTimeline(correlationId);
  }

  // ============================================
  // Configuration Methods
  // ============================================

  /**
   * Get current dynamic configuration
   */
  getDynamicConfig(): Readonly<DynamicConfig> {
    return this.configManager.getConfig();
  }

  /**
   * Update configuration dynamically
   */
  updateConfig(updates: Partial<DynamicConfig>): void {
    this.configManager.updateConfig(updates);
  }

  /**
   * Hot-reload configuration from sources
   */
  async reloadConfig(): Promise<void> {
    await this.configManager.reload();
  }

  /**
   * Get a feature flag value
   */
  getFeatureFlag(flagId: string, context?: { agentType?: AgentType; userId?: string }): boolean {
    return this.configManager.getFeatureFlag(flagId, context);
  }

  /**
   * Set a feature flag
   */
  setFeatureFlag(flagId: string, flag: FeatureFlag): void {
    this.configManager.setFeatureFlag(flagId, flag);
  }

  /**
   * Get A/B test variant for a user
   */
  getABTestVariant(testId: string, userId?: string, sessionId?: string) {
    return this.configManager.getABTestVariant(testId, userId, sessionId);
  }

  /**
   * Subscribe to configuration changes
   */
  onConfigChange(handler: (event: ConfigChangeEvent) => void): void {
    this.configManager.on('configChanged', handler);
  }

  // ============================================
  // Existing Methods (preserved for backward compatibility)
  // ============================================

  /**
   * Get discovered patterns from ANALYST
   */
  getPatterns(): LearnedPattern[] {
    return this.analyst.getPatterns();
  }

  /**
   * Trigger pattern discovery manually
   */
  async discoverPatterns(): Promise<LearnedPattern[]> {
    return this.analyst.discoverPatterns();
  }

  /**
   * Get pending enforcement actions
   */
  getPendingActions(): EnforcerAction[] {
    return this.enforcer.getPendingActions();
  }

  /**
   * Approve a pending action
   */
  async approveAction(actionId: string, approvedBy: string): Promise<EnforcerAction | null> {
    return this.enforcer.approveAction(actionId, approvedBy);
  }

  /**
   * Ask a natural language question about policies
   */
  async askQuestion(question: string): Promise<string> {
    return this.advisor.answerPolicyQuestion(question);
  }

  /**
   * Debug a policy
   */
  async debugPolicy(issue: string, policyYaml: string): Promise<string> {
    return this.advisor.debugPolicy(issue, policyYaml);
  }

  /**
   * Get recent anomalies for a principal
   */
  getAnomalies(principalId: string): Anomaly[] {
    return this.guardian.getRecentAnomalies(principalId);
  }

  /**
   * Get all anomalies with optional filters
   */
  async getAllAnomalies(filters?: {
    principalId?: string;
    status?: Anomaly['status'];
    limit?: number;
  }): Promise<Anomaly[]> {
    return this.guardian.getAllAnomalies(filters);
  }

  /**
   * Get a specific anomaly by ID
   */
  async getAnomalyById(anomalyId: string): Promise<Anomaly | null> {
    return this.guardian.getAnomalyById(anomalyId);
  }

  /**
   * Resolve an anomaly
   */
  async resolveAnomaly(
    anomalyId: string,
    resolution: 'resolved' | 'false_positive',
    notes?: string
  ): Promise<void> {
    return this.guardian.resolveAnomaly(anomalyId, resolution, notes);
  }

  /**
   * Validate a discovered pattern (approve or reject)
   */
  async validatePattern(
    patternId: string,
    isApproved: boolean,
    validatedBy: string
  ): Promise<void> {
    return this.analyst.validatePattern(patternId, isApproved, validatedBy);
  }

  /**
   * Reject a pending enforcement action
   */
  rejectAction(actionId: string, rejectedBy: string, reason?: string): boolean {
    return this.enforcer.rejectAction(actionId, rejectedBy, reason);
  }

  /**
   * Get explanation for a decision from ADVISOR
   */
  async explainDecision(
    request: CheckRequest,
    response: CheckResponse,
    policyContext?: { matchedRules: string[]; derivedRoles: string[] }
  ): Promise<DecisionExplanation> {
    return this.advisor.explainDecision(request, response, policyContext);
  }

  /**
   * Manually trigger enforcement
   */
  async triggerEnforcement(
    actionType: EnforcerAction['type'],
    principalId: string,
    reason: string
  ): Promise<EnforcerAction> {
    return this.enforcer.triggerAction(actionType, principalId, reason);
  }

  // ============================================
  // Private Methods
  // ============================================

  private resolvePipeline(pipelineOption?: string | PipelineConfig): PipelineConfig {
    if (!pipelineOption) {
      return this.pipelines.get('standard') ?? DEFAULT_PIPELINES.standard;
    }

    if (typeof pipelineOption === 'string') {
      const pipeline = this.pipelines.get(pipelineOption);
      if (!pipeline) {
        throw new Error(`Pipeline not found: ${pipelineOption}`);
      }
      return pipeline;
    }

    return pipelineOption;
  }

  private async executePipeline(
    pipeline: PipelineConfig,
    request: CheckRequest,
    response: CheckResponse,
    options: ProcessingOptions,
    correlationId: string,
    parentSpanId?: string
  ): Promise<PipelineResult> {
    const context: PipelineContext = {
      requestId: request.requestId ?? `req-${Date.now()}`,
      startTime: Date.now(),
      stepResults: new Map(),
      request,
      response,
      metadata: {},
      featureFlags: {},
      abTestVariant: undefined,
    };

    const stepResults: StepResult[] = [];
    let totalRetries = 0;
    let accumulatedResult: Record<string, unknown> = {
      response,
      anomalyScore: 0,
      enforcement: { allowed: true },
    };

    // Execute steps based on pipeline mode
    if (pipeline.mode === 'parallel') {
      const results = await this.executeStepsParallel(pipeline.steps, context, options, correlationId, parentSpanId);
      stepResults.push(...results.stepResults);
      totalRetries += results.totalRetries;
      accumulatedResult = results.accumulatedResult;
    } else {
      const results = await this.executeStepsSequential(pipeline.steps, context, options, correlationId, parentSpanId, pipeline.failFast);
      stepResults.push(...results.stepResults);
      totalRetries += results.totalRetries;
      accumulatedResult = results.accumulatedResult;
    }

    const success = !stepResults.some(s => s.required && !s.success && !s.skipped);
    const stepsExecuted = stepResults.filter(s => !s.skipped).length;
    const stepsSkipped = stepResults.filter(s => s.skipped).length;
    const stepsFailed = stepResults.filter(s => !s.success && !s.skipped).length;

    return {
      pipelineId: pipeline.id,
      requestId: context.requestId,
      success,
      totalDurationMs: Date.now() - context.startTime,
      steps: stepResults,
      result: accumulatedResult,
      metadata: {
        mode: pipeline.mode,
        stepsExecuted,
        stepsSkipped,
        stepsFailed,
        totalRetries,
      },
    };
  }

  private async executeStepsSequential(
    steps: PipelineStep[],
    context: PipelineContext,
    options: ProcessingOptions,
    correlationId: string,
    parentSpanId?: string,
    failFast?: boolean
  ): Promise<{
    stepResults: StepResult[];
    totalRetries: number;
    accumulatedResult: Record<string, unknown>;
  }> {
    const stepResults: StepResult[] = [];
    let totalRetries = 0;
    let accumulatedResult: Record<string, unknown> = {
      response: context.response,
      anomalyScore: 0,
      enforcement: { allowed: true },
    };

    for (const step of steps) {
      const result = await this.executeStep(step, context, options, accumulatedResult, correlationId, parentSpanId);
      stepResults.push(result);
      totalRetries += result.retryCount ?? 0;

      if (result.data) {
        accumulatedResult = { ...accumulatedResult, ...result.data as Record<string, unknown> };
      }

      // Check for early termination
      if (result.data && (result.data as { enforcement?: { allowed: boolean } }).enforcement?.allowed === false) {
        break;
      }

      if (failFast && !result.success && !result.skipped && step.required) {
        break;
      }
    }

    return { stepResults, totalRetries, accumulatedResult };
  }

  private async executeStepsParallel(
    steps: PipelineStep[],
    context: PipelineContext,
    options: ProcessingOptions,
    correlationId: string,
    parentSpanId?: string
  ): Promise<{
    stepResults: StepResult[];
    totalRetries: number;
    accumulatedResult: Record<string, unknown>;
  }> {
    // Build dependency graph
    const stepsByName = new Map(steps.map(s => [s.name ?? s.agent, s]));
    const pendingSteps = new Set(steps.map(s => s.name ?? s.agent));
    const completedSteps = new Map<string, StepResult>();
    const stepResults: StepResult[] = [];
    let totalRetries = 0;
    let accumulatedResult: Record<string, unknown> = {
      response: context.response,
      anomalyScore: 0,
      enforcement: { allowed: true },
    };

    while (pendingSteps.size > 0) {
      // Find steps that can run (dependencies satisfied)
      const runnableSteps = Array.from(pendingSteps).filter(stepName => {
        const step = stepsByName.get(stepName)!;
        return !step.dependsOn || step.dependsOn.every(dep => completedSteps.has(dep));
      });

      if (runnableSteps.length === 0) {
        // Circular dependency or all steps complete
        break;
      }

      // Execute runnable steps in parallel
      const results = await Promise.all(
        runnableSteps.map(async stepName => {
          const step = stepsByName.get(stepName)!;
          const result = await this.executeStep(step, context, options, accumulatedResult, correlationId, parentSpanId);
          return { stepName, result };
        })
      );

      // Process results
      for (const { stepName, result } of results) {
        pendingSteps.delete(stepName);
        completedSteps.set(stepName, result);
        stepResults.push(result);
        totalRetries += result.retryCount ?? 0;

        if (result.data) {
          accumulatedResult = { ...accumulatedResult, ...result.data as Record<string, unknown> };
        }
      }
    }

    return { stepResults, totalRetries, accumulatedResult };
  }

  private async executeStep(
    step: PipelineStep,
    context: PipelineContext,
    options: ProcessingOptions,
    accumulatedResult: Record<string, unknown>,
    correlationId: string,
    parentSpanId?: string
  ): Promise<StepResult> {
    const stepName = step.name ?? step.agent;
    const startTime = Date.now();

    // Start span for this step
    const span = this.metricsCollector.startSpan(
      `step.${stepName}`,
      step.agent,
      parentSpanId,
      { 'step.name': stepName, 'step.required': step.required }
    );

    // Emit step started event
    await this.eventManager.emit({
      type: 'step_started',
      source: step.agent,
      correlationId,
      requestId: context.requestId,
      payload: { step: stepName, agent: step.agent },
      metadata: {},
    });

    // Check conditions
    if (step.conditions) {
      const conditionContext = {
        request: context.request,
        response: context.response,
        options,
        ...accumulatedResult,
      };

      if (!evaluateCondition(step.conditions, conditionContext)) {
        const result: StepResult = {
          stepName,
          agentType: step.agent,
          success: true,
          durationMs: Date.now() - startTime,
          skipped: true,
          skipReason: 'Conditions not met',
        };

        this.metricsCollector.endSpan(span.spanId, 'ok');

        await this.eventManager.emit({
          type: 'step_skipped',
          source: step.agent,
          correlationId,
          requestId: context.requestId,
          payload: { step: stepName, reason: result.skipReason },
          metadata: {},
        });

        return result;
      }
    }

    // Execute with circuit breaker protection
    try {
      const executeWithBreaker = options.skipCircuitBreaker
        ? () => this.executeAgentStep(step, context, options, accumulatedResult)
        : () => this.circuitBreakerManager.execute(
            step.agent,
            () => this.executeAgentStep(step, context, options, accumulatedResult),
            { step, context }
          );

      const data = await executeWithBreaker();
      const durationMs = Date.now() - startTime;

      // Record metrics
      this.metricsCollector.recordLatency(step.agent, durationMs, true);

      const result: StepResult = {
        stepName,
        agentType: step.agent,
        success: true,
        durationMs,
        data,
      };

      this.metricsCollector.endSpan(span.spanId, 'ok');

      await this.eventManager.emit({
        type: 'step_completed',
        source: step.agent,
        correlationId,
        requestId: context.requestId,
        payload: { step: stepName, durationMs, success: true },
        metadata: {},
      });

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;

      // Record failure
      this.metricsCollector.recordLatency(step.agent, durationMs, false);
      this.metricsCollector.endSpan(span.spanId, 'error', error as Error);

      const result: StepResult = {
        stepName,
        agentType: step.agent,
        success: false,
        durationMs,
        error: error as Error,
      };

      await this.eventManager.emit({
        type: 'step_failed',
        source: step.agent,
        correlationId,
        requestId: context.requestId,
        payload: { step: stepName, error: (error as Error).message },
        metadata: {},
      });

      return result;
    }
  }

  private async executeAgentStep(
    step: PipelineStep,
    context: PipelineContext,
    options: ProcessingOptions,
    accumulatedResult: Record<string, unknown>
  ): Promise<unknown> {
    switch (step.agent) {
      case 'enforcer': {
        const enforcementCheck = this.enforcer.isAllowed((context.request as CheckRequest).principal.id);
        if (!enforcementCheck.allowed) {
          return {
            enforcement: {
              allowed: false,
              reason: enforcementCheck.reason,
            },
            response: this.createDeniedResponse(
              context.request as CheckRequest,
              enforcementCheck.reason ?? 'Enforcement block'
            ),
          };
        }
        return { enforcement: { allowed: true } };
      }

      case 'guardian': {
        const guardianResult = await this.guardian.analyzeRequest(context.request as CheckRequest);
        return {
          anomalyScore: guardianResult.anomalyScore,
          anomaly: guardianResult.anomaly,
          riskFactors: guardianResult.riskFactors,
        };
      }

      case 'analyst': {
        await this.recordDecision(
          context.request as CheckRequest,
          context.response as CheckResponse,
          (accumulatedResult.anomalyScore as number) ?? 0,
          accumulatedResult.riskFactors as DecisionRecord['riskFactors'],
          options.policyContext
        );
        return {};
      }

      case 'advisor': {
        if (options.includeExplanation) {
          const explanation = await this.advisor.explainDecision(
            context.request as CheckRequest,
            context.response as CheckResponse,
            options.policyContext
          );
          return { explanation };
        }
        return {};
      }

      default:
        throw new Error(`Unknown agent type: ${step.agent}`);
    }
  }

  private async recordDecision(
    request: CheckRequest,
    response: CheckResponse,
    anomalyScore: number,
    riskFactors: DecisionRecord['riskFactors'],
    policyContext?: { matchedRules: string[]; derivedRoles: string[] }
  ): Promise<DecisionRecord> {
    const record: DecisionRecord = {
      id: `decision-${Date.now()}-${Math.random().toString(36).substring(2)}`,
      requestId: request.requestId ?? `req-${Date.now()}`,
      timestamp: new Date(),
      principal: request.principal,
      resource: request.resource,
      actions: request.actions,
      results: response.results,
      derivedRoles: policyContext?.derivedRoles ?? [],
      matchedPolicies: policyContext?.matchedRules ?? [],
      anomalyScore,
      riskFactors,
    };

    await this.store.storeDecision(record);
    return record;
  }

  private createDeniedResponse(request: CheckRequest, reason: string): CheckResponse {
    const results: Record<string, ActionResult> = {};
    for (const action of request.actions) {
      results[action] = {
        effect: 'deny',
        policy: `enforcer:${reason}`,
        meta: {
          matchedRule: `enforcer:${reason}`,
        },
      };
    }

    return {
      requestId: request.requestId ?? `req-${Date.now()}`,
      results,
      meta: {
        evaluationDurationMs: 0,
        policiesEvaluated: [],
      },
    };
  }

  private setupCircuitBreakerHandling(): void {
    this.circuitBreakerManager.onStateChange(async (change) => {
      console.log(`[Orchestrator] Circuit breaker state change: ${change.agentType} ${change.previousState} -> ${change.newState}`);

      await this.eventManager.emit({
        type: 'circuit_state_changed',
        source: 'orchestrator',
        payload: change,
        metadata: {},
      });
    });
  }

  private setupConfigChangeHandling(): void {
    this.configManager.on('configChanged', async (event: ConfigChangeEvent) => {
      console.log(`[Orchestrator] Configuration changed: ${event.changedPaths.join(', ')}`);

      await this.eventManager.emit({
        type: 'config_reloaded',
        source: 'orchestrator',
        payload: event,
        metadata: {},
      });
    });

    this.configManager.on('featureFlagChanged', async (event: { flagId: string; flag: FeatureFlag }) => {
      await this.eventManager.emit({
        type: 'feature_flag_changed',
        source: 'orchestrator',
        payload: event,
        metadata: {},
      });
    });
  }
}
