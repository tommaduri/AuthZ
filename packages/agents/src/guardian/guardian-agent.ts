/**
 * GUARDIAN Agent - Anomaly Detection & Real-time Protection
 *
 * Responsibilities:
 * - Detect unusual access patterns
 * - Identify permission escalation attempts
 * - Monitor velocity (request rate) anomalies
 * - Calculate risk scores for decisions
 * - Trigger alerts and protective actions
 */

import type { CheckRequest } from '@authz-engine/core';
import { BaseAgent } from '../core/base-agent.js';
import type { DecisionStore } from '../core/decision-store.js';
import type { EventBus } from '../core/event-bus.js';
import type {
  AgentConfig,
  Anomaly,
  AnomalyType,
  BaselineStats,
  RiskFactor,
  Priority,
} from '../types/agent.types.js';

export interface GuardianConfig {
  anomalyThreshold: number; // 0-1, above this triggers alert
  baselinePeriodDays: number;
  velocityWindowMinutes: number;
  enableRealTimeDetection: boolean;
  maxRequestsPerMinute: number;
  suspiciousPatterns: string[];
}

interface PrincipalBaseline {
  principalId: string;
  computedAt: Date;
  stats: BaselineStats;
}

interface VelocityTracker {
  principalId: string;
  requests: { timestamp: Date; resourceKind: string; action: string }[];
}

export class GuardianAgent extends BaseAgent {
  private store: DecisionStore;
  private readonly eventBus: EventBus;
  private guardianConfig: GuardianConfig;

  /** Get event bus for testing */
  getEventBus(): EventBus { return this.eventBus; }

  // In-memory caches
  private baselines: Map<string, PrincipalBaseline> = new Map();
  private velocityTrackers: Map<string, VelocityTracker> = new Map();
  private recentAnomalies: Map<string, Anomaly[]> = new Map();

  constructor(
    config: AgentConfig,
    store: DecisionStore,
    eventBus: EventBus,
  ) {
    super('guardian', 'GUARDIAN - Anomaly Detection', config);
    this.store = store;
    this.eventBus = eventBus;
    this.guardianConfig = {
      anomalyThreshold: config.guardian?.anomalyThreshold ?? 0.7,
      baselinePeriodDays: config.guardian?.baselinePeriodDays ?? 30,
      velocityWindowMinutes: config.guardian?.velocityWindowMinutes ?? 5,
      enableRealTimeDetection: config.guardian?.enableRealTimeDetection ?? true,
      maxRequestsPerMinute: 100,
      suspiciousPatterns: [
        'admin',
        'delete',
        'export',
        'bulk',
        'payout',
        'withdraw',
      ],
    };
  }

  async initialize(): Promise<void> {
    this.state = 'initializing';
    this.log('info', 'Initializing GUARDIAN agent');

    // Start baseline computation job
    this.startBaselineRefresh();

    // Start velocity cleanup job
    this.startVelocityCleanup();

    this.state = 'ready';
    this.log('info', 'GUARDIAN agent ready');
  }

  async shutdown(): Promise<void> {
    this.state = 'shutdown';
    this.log('info', 'GUARDIAN agent shutting down');
  }

  /**
   * Analyze a decision request for anomalies
   */
  async analyzeRequest(request: CheckRequest): Promise<{
    anomalyScore: number;
    riskFactors: RiskFactor[];
    anomaly?: Anomaly;
  }> {
    const startTime = Date.now();
    this.state = 'processing';

    try {
      const principalId = request.principal.id;
      const riskFactors: RiskFactor[] = [];
      let anomalyScore = 0;

      // 1. Check velocity (rate limiting)
      const velocityResult = this.checkVelocity(principalId, request.resource.kind, request.actions[0]);
      if (velocityResult.isAnomalous) {
        anomalyScore += velocityResult.score * 0.3;
        riskFactors.push({
          type: 'velocity_spike',
          severity: velocityResult.severity,
          description: `Unusual request rate: ${velocityResult.requestsInWindow} requests in ${this.guardianConfig.velocityWindowMinutes} minutes`,
          evidence: { requestsInWindow: velocityResult.requestsInWindow },
        });
      }

      // 2. Check against baseline
      const baselineResult = await this.checkAgainstBaseline(principalId, request);
      if (baselineResult.isAnomalous) {
        anomalyScore += baselineResult.score * 0.4;
        riskFactors.push(...baselineResult.factors);
      }

      // 3. Check for suspicious patterns
      const patternResult = this.checkSuspiciousPatterns(request);
      if (patternResult.isAnomalous) {
        anomalyScore += patternResult.score * 0.2;
        riskFactors.push(...patternResult.factors);
      }

      // 4. Check permission escalation
      const escalationResult = await this.checkPermissionEscalation(principalId, request);
      if (escalationResult.isAnomalous) {
        anomalyScore += escalationResult.score * 0.3;
        riskFactors.push(...escalationResult.factors);
      }

      // Normalize score to 0-1
      anomalyScore = Math.min(1, anomalyScore);

      // Create anomaly if above threshold
      let anomaly: Anomaly | undefined;
      if (anomalyScore >= this.guardianConfig.anomalyThreshold) {
        anomaly = await this.createAnomaly(
          principalId,
          request,
          anomalyScore,
          riskFactors,
        );

        // Emit event
        this.emitAgentEvent('anomaly_detected', anomaly, request.requestId);
      }

      this.recordProcessing(Date.now() - startTime, true);
      this.state = 'ready';

      return { anomalyScore, riskFactors, anomaly };

    } catch (error) {
      this.recordProcessing(Date.now() - startTime, false);
      this.recordError(error as Error);
      this.state = 'error';
      throw error;
    }
  }

  /**
   * Get recent anomalies for a principal
   */
  getRecentAnomalies(principalId: string): Anomaly[] {
    return this.recentAnomalies.get(principalId) || [];
  }

  /**
   * Get all anomalies with optional filters
   */
  async getAllAnomalies(filters?: {
    principalId?: string;
    status?: Anomaly['status'];
    limit?: number;
  }): Promise<Anomaly[]> {
    // Aggregate all anomalies from in-memory cache
    let allAnomalies: Anomaly[] = [];

    if (filters?.principalId) {
      // Get anomalies for specific principal
      allAnomalies = this.recentAnomalies.get(filters.principalId) || [];
    } else {
      // Get all anomalies from all principals
      for (const anomalies of this.recentAnomalies.values()) {
        allAnomalies.push(...anomalies);
      }
    }

    // Apply status filter if provided
    if (filters?.status) {
      allAnomalies = allAnomalies.filter(a => a.status === filters.status);
    }

    // Sort by detected time (most recent first)
    allAnomalies.sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());

    // Apply limit if provided
    if (filters?.limit && filters.limit > 0) {
      allAnomalies = allAnomalies.slice(0, filters.limit);
    }

    return allAnomalies;
  }

  /**
   * Get a specific anomaly by ID
   */
  async getAnomalyById(anomalyId: string): Promise<Anomaly | null> {
    // Search through all cached anomalies
    for (const anomalies of this.recentAnomalies.values()) {
      const found = anomalies.find(a => a.id === anomalyId);
      if (found) {
        return found;
      }
    }
    return null;
  }

  /**
   * Resolve an anomaly
   */
  async resolveAnomaly(
    anomalyId: string,
    resolution: 'resolved' | 'false_positive',
    notes?: string,
  ): Promise<void> {
    // Update in-memory cache
    for (const [_principalId, anomalies] of this.recentAnomalies) {
      const anomaly = anomalies.find(a => a.id === anomalyId);
      if (anomaly) {
        anomaly.status = resolution;
        anomaly.resolvedAt = new Date();
        anomaly.resolution = notes;
        break;
      }
    }

    // Update in persistent store
    await this.store.updateAnomalyStatus(anomalyId, resolution, notes);
    this.emitAgentEvent('anomaly_resolved', { anomalyId, resolution, notes });
  }

  private checkVelocity(
    principalId: string,
    resourceKind: string,
    action: string,
  ): {
    isAnomalous: boolean;
    score: number;
    severity: Priority;
    requestsInWindow: number;
  } {
    // Get or create tracker
    let tracker = this.velocityTrackers.get(principalId);
    if (!tracker) {
      tracker = { principalId, requests: [] };
      this.velocityTrackers.set(principalId, tracker);
    }

    // Add current request
    tracker.requests.push({
      timestamp: new Date(),
      resourceKind,
      action,
    });

    // Count requests in window
    const windowStart = new Date(Date.now() - this.guardianConfig.velocityWindowMinutes * 60 * 1000);
    const recentRequests = tracker.requests.filter(r => r.timestamp >= windowStart);
    const requestsInWindow = recentRequests.length;

    // Calculate expected rate
    const maxInWindow = this.guardianConfig.maxRequestsPerMinute * this.guardianConfig.velocityWindowMinutes;

    if (requestsInWindow <= maxInWindow * 0.5) {
      return { isAnomalous: false, score: 0, severity: 'low', requestsInWindow };
    }

    const ratio = requestsInWindow / maxInWindow;
    let severity: Priority = 'low';
    let score = 0;

    if (ratio >= 2) {
      severity = 'critical';
      score = 1;
    } else if (ratio >= 1.5) {
      severity = 'high';
      score = 0.8;
    } else if (ratio >= 1) {
      severity = 'medium';
      score = 0.5;
    } else if (ratio >= 0.7) {
      severity = 'low';
      score = 0.2;
    }

    return {
      isAnomalous: score > 0.2,
      score,
      severity,
      requestsInWindow,
    };
  }

  private async checkAgainstBaseline(
    principalId: string,
    request: CheckRequest,
  ): Promise<{
    isAnomalous: boolean;
    score: number;
    factors: RiskFactor[];
  }> {
    const factors: RiskFactor[] = [];
    let score = 0;

    // Get baseline
    let baseline: PrincipalBaseline | undefined = this.baselines.get(principalId);
    if (!baseline) {
      // Compute baseline on-demand
      const computed = await this.computeBaseline(principalId);
      if (computed) {
        baseline = computed;
        this.baselines.set(principalId, computed);
      }
    }

    if (!baseline) {
      // New user, no baseline - slightly suspicious
      factors.push({
        type: 'new_principal',
        severity: 'low',
        description: 'No historical baseline for this principal',
        evidence: { principalId },
      });
      return { isAnomalous: true, score: 0.2, factors };
    }

    // Check if action is common for this user
    if (!baseline.stats.commonActions.includes(request.actions[0])) {
      factors.push({
        type: 'unusual_action',
        severity: 'medium',
        description: `Action "${request.actions[0]}" not in user's typical patterns`,
        evidence: {
          requestedAction: request.actions[0],
          commonActions: baseline.stats.commonActions,
        },
      });
      score += 0.3;
    }

    // Check if resource type is new
    // This would require tracking resource types in baseline
    // Simplified check here

    // Check time of access (would need timezone info)
    const hour = new Date().getHours();
    const isUnusualTime = hour < 6 || hour > 22;
    if (isUnusualTime) {
      factors.push({
        type: 'unusual_time',
        severity: 'low',
        description: `Access at unusual hour (${hour}:00)`,
        evidence: { hour, commonTimeRanges: baseline.stats.commonTimeRanges },
      });
      score += 0.15;
    }

    return {
      isAnomalous: score > 0.2,
      score,
      factors,
    };
  }

  private checkSuspiciousPatterns(request: CheckRequest): {
    isAnomalous: boolean;
    score: number;
    factors: RiskFactor[];
  } {
    const factors: RiskFactor[] = [];
    let score = 0;

    const resourceKind = request.resource.kind.toLowerCase();
    const action = request.actions[0]?.toLowerCase() || '';
    const resourceId = request.resource.id.toLowerCase();

    for (const pattern of this.guardianConfig.suspiciousPatterns) {
      if (
        resourceKind.includes(pattern) ||
        action.includes(pattern) ||
        resourceId.includes(pattern)
      ) {
        factors.push({
          type: 'suspicious_pattern',
          severity: pattern === 'admin' || pattern === 'payout' ? 'high' : 'medium',
          description: `Request matches suspicious pattern: "${pattern}"`,
          evidence: { pattern, resourceKind, action },
        });
        score += 0.25;
      }
    }

    // Check for bulk operations
    if (action.includes('bulk') || action.includes('batch') || action.includes('all')) {
      factors.push({
        type: 'bulk_operation',
        severity: 'medium',
        description: 'Bulk operation detected',
        evidence: { action },
      });
      score += 0.3;
    }

    return {
      isAnomalous: score > 0,
      score: Math.min(1, score),
      factors,
    };
  }

  private async checkPermissionEscalation(
    principalId: string,
    request: CheckRequest,
  ): Promise<{
    isAnomalous: boolean;
    score: number;
    factors: RiskFactor[];
  }> {
    const factors: RiskFactor[] = [];
    let score = 0;

    // Check if user is accessing resources outside their normal scope
    const recentDecisions = await this.store.queryDecisions(
      { principalId, fromDate: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      { limit: 50 },
    );

    // Get unique resource kinds from recent history
    const historicalResourceKinds = new Set(
      recentDecisions.map(d => d.resource.kind)
    );

    // If this is a new resource kind and it's a sensitive one
    if (!historicalResourceKinds.has(request.resource.kind)) {
      const sensitiveResources = ['admin', 'payout', 'user', 'subscription', 'payment'];
      if (sensitiveResources.some(s => request.resource.kind.toLowerCase().includes(s))) {
        factors.push({
          type: 'permission_escalation',
          severity: 'high',
          description: `First access to sensitive resource type: ${request.resource.kind}`,
          evidence: {
            newResourceKind: request.resource.kind,
            historicalResourceKinds: Array.from(historicalResourceKinds),
          },
        });
        score += 0.5;
      }
    }

    // Check for role-based escalation (would need role history)

    return {
      isAnomalous: score > 0,
      score,
      factors,
    };
  }

  private async createAnomaly(
    principalId: string,
    request: CheckRequest,
    score: number,
    factors: RiskFactor[],
  ): Promise<Anomaly> {
    // Determine primary anomaly type from factors
    const primaryType = this.determinePrimaryAnomalyType(factors);
    const severity = this.determineSeverity(score, factors);

    // Get baseline for context
    const baseline = this.baselines.get(principalId);
    const tracker = this.velocityTrackers.get(principalId);

    const anomaly: Anomaly = {
      id: `anomaly-${Date.now()}-${Math.random().toString(36).substring(2)}`,
      detectedAt: new Date(),
      type: primaryType,
      severity,
      principalId,
      resourceKind: request.resource.kind,
      action: request.actions[0],
      description: this.generateDescription(primaryType, factors),
      score,
      evidence: {
        recentRequests: tracker?.requests.length ?? 0,
        baselineRequests: baseline?.stats.avgRequestsPerHour ?? 0,
        deviation: score,
        relatedDecisions: [],
        additionalContext: { factors },
      },
      baseline: baseline?.stats ?? {
        period: 'N/A',
        avgRequestsPerHour: 0,
        uniqueResources: 0,
        commonActions: [],
        commonTimeRanges: [],
      },
      observed: {
        requestsInWindow: tracker?.requests.length ?? 1,
        uniqueResourcesAccessed: 1,
        actionsPerformed: request.actions,
        timeOfAccess: new Date().toISOString(),
      },
      status: 'open',
    };

    // Store anomaly
    await this.store.storeAnomaly(anomaly);

    // Track in memory
    const existing = this.recentAnomalies.get(principalId) || [];
    existing.push(anomaly);
    if (existing.length > 10) existing.shift();
    this.recentAnomalies.set(principalId, existing);

    this.incrementCustomMetric('anomalies_detected');

    return anomaly;
  }

  private determinePrimaryAnomalyType(factors: RiskFactor[]): AnomalyType {
    // Priority order for anomaly types
    const typeMap: Record<string, AnomalyType> = {
      velocity_spike: 'velocity_spike',
      permission_escalation: 'permission_escalation',
      unusual_action: 'pattern_deviation',
      unusual_time: 'unusual_access_time',
      suspicious_pattern: 'unusual_resource_access',
      bulk_operation: 'bulk_operation',
      new_principal: 'pattern_deviation',
    };

    for (const factor of factors) {
      if (typeMap[factor.type]) {
        return typeMap[factor.type];
      }
    }

    return 'pattern_deviation';
  }

  private determineSeverity(score: number, factors: RiskFactor[]): Priority {
    // Check if any factor is critical/high
    const hasCritical = factors.some(f => f.severity === 'critical');
    const hasHigh = factors.some(f => f.severity === 'high');

    if (hasCritical || score >= 0.9) return 'critical';
    if (hasHigh || score >= 0.7) return 'high';
    if (score >= 0.5) return 'medium';
    return 'low';
  }

  private generateDescription(type: AnomalyType, factors: RiskFactor[]): string {
    const descriptions: Record<AnomalyType, string> = {
      velocity_spike: 'Unusual spike in request rate detected',
      permission_escalation: 'Potential permission escalation attempt',
      unusual_access_time: 'Access at unusual time of day',
      unusual_resource_access: 'Access to unusual resource type',
      pattern_deviation: 'Behavior deviates from established patterns',
      geographic_anomaly: 'Access from unusual geographic location',
      new_resource_type: 'First access to this resource type',
      bulk_operation: 'Bulk operation that may indicate data exfiltration',
    };

    let desc = descriptions[type] || 'Anomalous behavior detected';

    if (factors.length > 1) {
      desc += ` (${factors.length} risk factors)`;
    }

    return desc;
  }

  private async computeBaseline(principalId: string): Promise<PrincipalBaseline | null> {
    try {
      const stats = await this.store.getPrincipalStats(
        principalId,
        this.guardianConfig.baselinePeriodDays,
      );

      if (stats.totalRequests < 10) {
        // Not enough data for meaningful baseline
        return null;
      }

      return {
        principalId,
        computedAt: new Date(),
        stats: {
          period: `${this.guardianConfig.baselinePeriodDays}d`,
          avgRequestsPerHour: stats.totalRequests / (this.guardianConfig.baselinePeriodDays * 24),
          uniqueResources: stats.uniqueResources,
          commonActions: stats.commonActions,
          commonTimeRanges: ['09:00-18:00'], // Simplified; would compute from actual data
        },
      };
    } catch {
      return null;
    }
  }

  private startBaselineRefresh(): void {
    // Refresh baselines every hour
    setInterval(() => {
      this.log('debug', 'Refreshing baselines');
      this.baselines.clear();
      this.emitAgentEvent('baseline_updated', { clearedAt: new Date() });
    }, 60 * 60 * 1000);
  }

  private startVelocityCleanup(): void {
    // Clean old velocity data every minute
    setInterval(() => {
      const windowStart = new Date(
        Date.now() - this.guardianConfig.velocityWindowMinutes * 60 * 1000
      );

      for (const [principalId, tracker] of this.velocityTrackers) {
        tracker.requests = tracker.requests.filter(r => r.timestamp >= windowStart);
        if (tracker.requests.length === 0) {
          this.velocityTrackers.delete(principalId);
        }
      }
    }, 60 * 1000);
  }
}
