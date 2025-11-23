/**
 * Agent Orchestrator - Coordinates all four agents
 *
 * Provides unified API for:
 * - Starting/stopping all agents
 * - Processing authorization requests through the agent pipeline
 * - Health monitoring
 * - Configuration management
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
} from '../types/agent.types.js';

export interface OrchestratorConfig {
  agents: AgentConfig;
  store: DecisionStoreConfig;
  eventBus: EventBusConfig;
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
}

export class AgentOrchestrator {
  private readonly config: OrchestratorConfig;
  private store: DecisionStore;

  /** Get orchestrator config for testing */
  getConfig(): OrchestratorConfig { return this.config; }
  private eventBus: EventBus;

  private guardian: GuardianAgent;
  private analyst: AnalystAgent;
  private advisor: AdvisorAgent;
  private enforcer: EnforcerAgent;

  private isInitialized = false;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.store = new DecisionStore(config.store);
    this.eventBus = new EventBus(config.eventBus);

    // Initialize agents
    this.guardian = new GuardianAgent(config.agents, this.store, this.eventBus);
    this.analyst = new AnalystAgent(config.agents, this.store, this.eventBus);
    this.advisor = new AdvisorAgent(config.agents, this.store, this.eventBus);
    this.enforcer = new EnforcerAgent(config.agents, this.store, this.eventBus);
  }

  /**
   * Initialize all agents and infrastructure
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log('[Orchestrator] Initializing agentic authorization system...');

    // Initialize infrastructure
    await this.store.initialize();
    await this.eventBus.initialize();

    // Initialize agents in parallel
    await Promise.all([
      this.guardian.initialize(),
      this.analyst.initialize(),
      this.advisor.initialize(),
      this.enforcer.initialize(),
    ]);

    this.isInitialized = true;
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
    options?: {
      includeExplanation?: boolean;
      policyContext?: { matchedRules: string[]; derivedRoles: string[] };
    },
  ): Promise<ProcessingResult> {
    const startTime = Date.now();
    const agentsInvolved: string[] = [];

    // 1. Check ENFORCER first (rate limits, blocks)
    const enforcementCheck = this.enforcer.isAllowed(request.principal.id);
    if (!enforcementCheck.allowed) {
      return {
        response: this.createDeniedResponse(request, enforcementCheck.reason || 'Enforcement block'),
        anomalyScore: 0,
        enforcement: {
          allowed: false,
          reason: enforcementCheck.reason,
        },
        processingTimeMs: Date.now() - startTime,
        agentsInvolved: ['enforcer'],
      };
    }
    agentsInvolved.push('enforcer');

    // 2. GUARDIAN anomaly analysis
    const guardianResult = await this.guardian.analyzeRequest(request);
    agentsInvolved.push('guardian');

    // 3. Record decision for ANALYST learning
    await this.recordDecision(
      request,
      response,
      guardianResult.anomalyScore,
      guardianResult.riskFactors,
      options?.policyContext,
    );

    // 4. Generate explanation if requested
    let explanation: DecisionExplanation | undefined;
    if (options?.includeExplanation) {
      explanation = await this.advisor.explainDecision(
        request,
        response,
        options.policyContext,
      );
      agentsInvolved.push('advisor');
    }

    // 5. Check if anomaly triggered enforcement action
    let enforcementAction: EnforcerAction | undefined;
    if (guardianResult.anomaly) {
      // The enforcer will be notified via event bus and may take action
      // For now, just note that an anomaly was detected
    }

    return {
      response,
      anomalyScore: guardianResult.anomalyScore,
      anomaly: guardianResult.anomaly,
      explanation,
      enforcement: {
        allowed: true,
        action: enforcementAction,
      },
      processingTimeMs: Date.now() - startTime,
      agentsInvolved,
    };
  }

  /**
   * Get health status of all agents
   */
  async getHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    agents: Record<string, AgentHealth>;
    infrastructure: {
      store: 'connected' | 'disconnected';
      eventBus: 'connected' | 'disconnected';
    };
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

    const allReady = Object.values(agents).every(h => h.state === 'ready');
    const anyError = Object.values(agents).some(h => h.state === 'error');

    return {
      status: anyError ? 'unhealthy' : allReady ? 'healthy' : 'degraded',
      agents,
      infrastructure: {
        store: 'connected', // Would do actual check
        eventBus: 'connected',
      },
    };
  }

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
    notes?: string,
  ): Promise<void> {
    return this.guardian.resolveAnomaly(anomalyId, resolution, notes);
  }

  /**
   * Validate a discovered pattern (approve or reject)
   */
  async validatePattern(
    patternId: string,
    isApproved: boolean,
    validatedBy: string,
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
    policyContext?: { matchedRules: string[]; derivedRoles: string[] },
  ): Promise<DecisionExplanation> {
    return this.advisor.explainDecision(request, response, policyContext);
  }

  /**
   * Manually trigger enforcement
   */
  async triggerEnforcement(
    actionType: EnforcerAction['type'],
    principalId: string,
    reason: string,
  ): Promise<EnforcerAction> {
    return this.enforcer.triggerAction(actionType, principalId, reason);
  }

  private async recordDecision(
    request: CheckRequest,
    response: CheckResponse,
    anomalyScore: number,
    riskFactors: DecisionRecord['riskFactors'],
    policyContext?: { matchedRules: string[]; derivedRoles: string[] },
  ): Promise<DecisionRecord> {
    const record: DecisionRecord = {
      id: `decision-${Date.now()}-${Math.random().toString(36).substring(2)}`,
      requestId: request.requestId || `req-${Date.now()}`,
      timestamp: new Date(),
      principal: request.principal,
      resource: request.resource,
      actions: request.actions,
      results: response.results,
      derivedRoles: policyContext?.derivedRoles || [],
      matchedPolicies: policyContext?.matchedRules || [],
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
      requestId: request.requestId || `req-${Date.now()}`,
      results,
      meta: {
        evaluationDurationMs: 0,
        policiesEvaluated: [],
      },
    };
  }
}
