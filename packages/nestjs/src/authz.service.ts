import { Injectable, Inject, Logger } from '@nestjs/common';
import type { AuthzClient, Principal, Resource, CheckResult } from '@authz-engine/sdk';
import { AUTHZ_CLIENT, AUTHZ_OPTIONS } from './authz.module';
import type { AuthzModuleOptions } from './authz.module';

// Constants for magic numbers
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_CONFIDENCE_SCORE = 0.9;
const DEFAULT_PATTERN_MIN_CONFIDENCE = 0.7;
const DEFAULT_TIME_RANGE_HOURS = 24;

/**
 * Agentic check options
 */
export interface AgenticCheckOptions {
  /** Include explanation in response */
  includeExplanation?: boolean;
  /** Include anomaly score check */
  checkAnomalies?: boolean;
  /** Log action for analyst learning */
  auditAction?: boolean;
  /** Additional context for agents */
  context?: Record<string, unknown>;
}

/**
 * Agentic check result with explanation
 */
export interface AgenticCheckResult extends CheckResult {
  /** Human-readable explanation of the decision */
  explanation?: string;
  /** Confidence score (0-1) */
  confidence?: number;
  /** Anomaly score if checked (0-1, higher = more anomalous) */
  anomalyScore?: number;
  /** Contributing factors to the decision */
  factors?: Array<{
    factor: string;
    impact: 'positive' | 'negative' | 'neutral';
    weight: number;
  }>;
  /** Agent that processed the request */
  processedBy?: string;
}

/**
 * Agent health status
 */
export interface AgentHealth {
  /** Overall agent system health */
  healthy: boolean;
  /** Individual agent statuses */
  agents: {
    analyst: { status: 'online' | 'offline' | 'degraded'; lastActive: string };
    guardian: { status: 'online' | 'offline' | 'degraded'; anomaliesDetected: number };
    enforcer: { status: 'online' | 'offline' | 'degraded'; pendingActions: number };
    auditor: { status: 'online' | 'offline' | 'degraded'; logsProcessed: number };
  };
  /** System metrics */
  metrics: {
    averageLatencyMs: number;
    requestsPerSecond: number;
    cacheHitRate: number;
  };
}

/**
 * Anomaly information
 */
export interface Anomaly {
  id: string;
  principalId: string;
  type: 'unusual_access' | 'time_anomaly' | 'location_anomaly' | 'pattern_break' | 'privilege_escalation';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  detectedAt: string;
  metadata: Record<string, unknown>;
}

/**
 * Pattern discovery result
 */
export interface PatternDiscoveryResult {
  patterns: Array<{
    id: string;
    name: string;
    description: string;
    occurrences: number;
    confidence: number;
    suggestedPolicy?: string;
  }>;
  discoveredAt: string;
  processingTimeMs: number;
}

/**
 * Pending enforcement action
 */
export interface EnforcementAction {
  id: string;
  type: 'block' | 'require_mfa' | 'notify_admin' | 'revoke_session' | 'quarantine';
  reason: string;
  targetPrincipalId: string;
  targetResource?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  suggestedBy: string;
  createdAt: string;
  expiresAt?: string;
  metadata: Record<string, unknown>;
}

/**
 * Natural language question result
 */
export interface QuestionResult {
  answer: string;
  confidence: number;
  relatedPolicies: string[];
  suggestedActions?: string[];
}

/**
 * AuthZ Service
 *
 * Injectable service for authorization checks in NestJS applications.
 * Supports both standard checks and agentic authorization features.
 */
@Injectable()
export class AuthzService {
  private readonly logger = new Logger(AuthzService.name);

  constructor(
    @Inject(AUTHZ_CLIENT) private readonly client: AuthzClient,
    @Inject(AUTHZ_OPTIONS) private readonly options: AuthzModuleOptions,
  ) {}

  /**
   * Check if a principal is allowed to perform actions on a resource
   */
  async check(
    principal: Principal,
    resource: Resource,
    actions: string[],
  ): Promise<CheckResult> {
    return this.client.check(principal, resource, actions);
  }

  /**
   * Check a single action
   */
  async isAllowed(
    principal: Principal,
    resource: Resource,
    action: string,
  ): Promise<boolean> {
    return this.client.isAllowed(principal, resource, action);
  }

  /**
   * Check multiple resources in batch
   */
  async batchCheck(
    principal: Principal,
    checks: Array<{ resource: Resource; actions: string[] }>,
  ): Promise<Record<string, CheckResult>> {
    return this.client.batchCheck(principal, checks);
  }

  /**
   * Create principal from user object
   *
   * Helper to transform common user object shapes into Principal
   */
  createPrincipal(user: {
    id: string;
    roles?: string[];
    userType?: string;
    [key: string]: unknown;
  }): Principal {
    const { id, roles = [], userType, ...attributes } = user;

    // Include userType in roles if present
    const allRoles = userType ? [...roles, userType.toLowerCase()] : roles;

    return {
      id,
      roles: allRoles,
      attributes,
    };
  }

  /**
   * Create resource from entity
   *
   * Helper to transform entities into Resource
   */
  createResource(
    kind: string,
    entity: { id: string; [key: string]: unknown },
  ): Resource {
    const { id, ...attributes } = entity;
    return {
      kind,
      id,
      attributes,
    };
  }

  /**
   * Check server health
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    policiesLoaded: number;
    version: string;
  }> {
    return this.client.healthCheck() as Promise<{
      healthy: boolean;
      policiesLoaded: number;
      version: string;
    }>;
  }

  // ============================================
  // AGENTIC AUTHORIZATION FEATURES
  // ============================================

  /**
   * Full agentic authorization check with explanation
   *
   * Uses AI agents to provide detailed explanation of authorization decisions,
   * anomaly detection, and confidence scoring.
   *
   * @param principal - The principal making the request
   * @param resource - The resource being accessed
   * @param action - The action being performed
   * @param options - Agentic check options
   */
  async checkWithAgents(
    principal: Principal,
    resource: Resource,
    action: string,
    options: AgenticCheckOptions = {},
  ): Promise<AgenticCheckResult> {
    const {
      includeExplanation = true,
      checkAnomalies = true,
      auditAction = false,
      context = {},
    } = options;

    this.logger.debug(`Agentic check: ${principal.id} -> ${resource.kind}:${resource.id} [${action}]`);

    // Perform standard check first
    const baseResult = await this.client.check(principal, resource, [action]);

    // Build agentic result
    const agenticResult: AgenticCheckResult = {
      ...baseResult,
    };

    // Get explanation from analyst agent
    if (includeExplanation) {
      try {
        const explanationResponse = await this.sendAgenticRequest<{
          explanation: string;
          confidence: number;
          factors: Array<{
            factor: string;
            impact: 'positive' | 'negative' | 'neutral';
            weight: number;
          }>;
          processedBy: string;
        }>('/api/agentic/explain', {
          principal,
          resource,
          action,
          decision: baseResult.allowed ? 'allow' : 'deny',
          context,
        });

        agenticResult.explanation = explanationResponse.explanation;
        agenticResult.confidence = explanationResponse.confidence;
        agenticResult.factors = explanationResponse.factors;
        agenticResult.processedBy = explanationResponse.processedBy;
      } catch (error) {
        this.logger.warn('Failed to get explanation from analyst agent', error);
        agenticResult.explanation = baseResult.allowed
          ? `Access allowed based on policy matching ${resource.kind}`
          : `Access denied: no matching allow policy for ${action} on ${resource.kind}`;
        agenticResult.confidence = DEFAULT_CONFIDENCE_SCORE;
      }
    }

    // Check for anomalies via guardian agent
    if (checkAnomalies) {
      try {
        const anomalyResponse = await this.sendAgenticRequest<{
          anomalyScore: number;
          isAnomalous: boolean;
        }>('/api/agentic/anomaly-score', {
          principalId: principal.id,
          resource,
          action,
          context,
        });

        agenticResult.anomalyScore = anomalyResponse.anomalyScore;
      } catch (error) {
        this.logger.warn('Failed to get anomaly score from guardian agent', error);
      }
    }

    // Log action for learning if requested
    if (auditAction) {
      this.logActionForLearning(principal, resource, action, agenticResult).catch((err) => {
        this.logger.warn('Failed to log action for learning', err);
      });
    }

    return agenticResult;
  }

  /**
   * Get agent health status
   *
   * Returns the health status of all authorization agents.
   */
  async getAgentHealth(): Promise<AgentHealth> {
    try {
      return await this.sendAgenticRequest<AgentHealth>('/api/agentic/health', null, 'GET');
    } catch (error) {
      this.logger.error('Failed to get agent health', error);
      // Return degraded status on error
      return {
        healthy: false,
        agents: {
          analyst: { status: 'offline', lastActive: new Date().toISOString() },
          guardian: { status: 'offline', anomaliesDetected: 0 },
          enforcer: { status: 'offline', pendingActions: 0 },
          auditor: { status: 'offline', logsProcessed: 0 },
        },
        metrics: {
          averageLatencyMs: 0,
          requestsPerSecond: 0,
          cacheHitRate: 0,
        },
      };
    }
  }

  /**
   * Ask a natural language question about policies
   *
   * Uses the analyst agent to answer questions about authorization policies
   * in natural language.
   *
   * @param question - Natural language question about policies
   */
  async askQuestion(question: string): Promise<QuestionResult> {
    if (!question || question.trim().length === 0) {
      throw new Error('Question cannot be empty');
    }

    this.logger.debug(`Policy question: ${question}`);

    try {
      return await this.sendAgenticRequest<QuestionResult>('/api/agentic/ask', {
        question: question.trim(),
      });
    } catch (error) {
      this.logger.error('Failed to process question', error);
      throw new Error('Unable to process question. Please try again later.');
    }
  }

  /**
   * Get anomalies for a principal
   *
   * Retrieves anomalies detected by the guardian agent for a specific principal.
   *
   * @param principalId - The principal ID to check for anomalies
   * @param options - Optional filters
   */
  async getAnomalies(
    principalId: string,
    options: {
      severity?: 'low' | 'medium' | 'high' | 'critical';
      type?: Anomaly['type'];
      limit?: number;
      since?: Date;
    } = {},
  ): Promise<Anomaly[]> {
    const params = new URLSearchParams();
    params.set('principalId', principalId);
    if (options.severity) params.set('severity', options.severity);
    if (options.type) params.set('type', options.type);
    if (options.limit) params.set('limit', options.limit.toString());
    if (options.since) params.set('since', options.since.toISOString());

    try {
      const response = await this.sendAgenticRequest<{ anomalies: Anomaly[] }>(
        `/api/agentic/anomalies?${params.toString()}`,
        null,
        'GET',
      );
      return response.anomalies;
    } catch (error) {
      this.logger.error(`Failed to get anomalies for principal ${principalId}`, error);
      return [];
    }
  }

  /**
   * Trigger pattern discovery
   *
   * Triggers the analyst agent to discover new patterns in authorization data.
   * This is typically a background operation.
   *
   * @param options - Discovery options
   */
  async discoverPatterns(
    options: {
      resource?: string;
      timeRangeHours?: number;
      minConfidence?: number;
    } = {},
  ): Promise<PatternDiscoveryResult> {
    this.logger.log('Triggering pattern discovery');

    try {
      return await this.sendAgenticRequest<PatternDiscoveryResult>('/api/agentic/patterns/discover', {
        resource: options.resource,
        timeRangeHours: options.timeRangeHours || DEFAULT_TIME_RANGE_HOURS,
        minConfidence: options.minConfidence || DEFAULT_PATTERN_MIN_CONFIDENCE,
      });
    } catch (error) {
      this.logger.error('Failed to trigger pattern discovery', error);
      throw new Error('Pattern discovery failed. Please try again later.');
    }
  }

  /**
   * Get pending enforcement actions
   *
   * Retrieves pending actions suggested by the enforcer agent that require approval.
   *
   * @param options - Filter options
   */
  async getPendingActions(
    options: {
      severity?: EnforcementAction['severity'];
      type?: EnforcementAction['type'];
      limit?: number;
    } = {},
  ): Promise<EnforcementAction[]> {
    const params = new URLSearchParams();
    if (options.severity) params.set('severity', options.severity);
    if (options.type) params.set('type', options.type);
    if (options.limit) params.set('limit', options.limit.toString());

    try {
      const response = await this.sendAgenticRequest<{ actions: EnforcementAction[] }>(
        `/api/agentic/enforcement/pending?${params.toString()}`,
        null,
        'GET',
      );
      return response.actions;
    } catch (error) {
      this.logger.error('Failed to get pending enforcement actions', error);
      return [];
    }
  }

  /**
   * Approve an enforcement action
   *
   * Approves a pending enforcement action for execution.
   *
   * @param actionId - The action ID to approve
   * @param approverPrincipalId - The principal ID of the approver
   * @param comment - Optional approval comment
   */
  async approveAction(
    actionId: string,
    approverPrincipalId: string,
    comment?: string,
  ): Promise<{ success: boolean; executedAt?: string; error?: string }> {
    if (!actionId || !approverPrincipalId) {
      throw new Error('Action ID and approver principal ID are required');
    }

    this.logger.log(`Approving enforcement action: ${actionId} by ${approverPrincipalId}`);

    try {
      return await this.sendAgenticRequest<{ success: boolean; executedAt?: string; error?: string }>(
        '/api/agentic/enforcement/approve',
        {
          actionId,
          approverPrincipalId,
          comment,
          approvedAt: new Date().toISOString(),
        },
      );
    } catch (error) {
      this.logger.error(`Failed to approve action ${actionId}`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Reject an enforcement action
   *
   * Rejects a pending enforcement action.
   *
   * @param actionId - The action ID to reject
   * @param rejecterPrincipalId - The principal ID of the rejecter
   * @param reason - Reason for rejection
   */
  async rejectAction(
    actionId: string,
    rejecterPrincipalId: string,
    reason: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (!actionId || !rejecterPrincipalId || !reason) {
      throw new Error('Action ID, rejecter principal ID, and reason are required');
    }

    this.logger.log(`Rejecting enforcement action: ${actionId} by ${rejecterPrincipalId}`);

    try {
      return await this.sendAgenticRequest<{ success: boolean; error?: string }>(
        '/api/agentic/enforcement/reject',
        {
          actionId,
          rejecterPrincipalId,
          reason,
          rejectedAt: new Date().toISOString(),
        },
      );
    } catch (error) {
      this.logger.error(`Failed to reject action ${actionId}`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ============================================
  // PRIVATE HELPER METHODS
  // ============================================

  /**
   * Log action for analyst learning
   */
  private async logActionForLearning(
    principal: Principal,
    resource: Resource,
    action: string,
    result: AgenticCheckResult,
  ): Promise<void> {
    await this.sendAgenticRequest('/api/agentic/learn/log', {
      principal,
      resource,
      action,
      decision: result.allowed ? 'allow' : 'deny',
      confidence: result.confidence,
      anomalyScore: result.anomalyScore,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send request to agentic API endpoints
   */
  private async sendAgenticRequest<T>(
    path: string,
    body: unknown,
    method: 'GET' | 'POST' = 'POST',
  ): Promise<T> {
    const serverUrl = this.options.serverUrl.replace(/\/$/, '');
    const url = `${serverUrl}${path}`;
    const timeout = this.options.timeout || DEFAULT_TIMEOUT_MS;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(this.options.headers || {}),
        },
        body: method === 'POST' && body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Agentic request failed: ${response.status} ${response.statusText} - ${errorBody}`);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
}
