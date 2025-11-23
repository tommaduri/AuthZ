/**
 * GUARDIAN Agent - Anomaly Detection & Real-time Protection
 *
 * Responsibilities:
 * - Detect unusual access patterns
 * - Identify permission escalation attempts
 * - Monitor velocity (request rate) anomalies
 * - Calculate risk scores for decisions
 * - Trigger alerts and protective actions
 * - Policy validation and enforcement
 * - Real-time threat scoring
 * - Security boundary protection
 * - Threat detection and blocking
 */

import type { CheckRequest, DerivedRoleDefinition, ResourcePolicy } from '@authz-engine/core';
import { CelEvaluator, type EvaluationContext } from '@authz-engine/core';
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
  /** Enable policy violation detection */
  enablePolicyValidation: boolean;
  /** Enable real-time threat scoring */
  enableThreatScoring: boolean;
  /** Threat score threshold for blocking (0-1) */
  threatBlockThreshold: number;
  /** Enable audit logging for all decisions */
  enableAuditLogging: boolean;
  /** Sensitive resources that require extra scrutiny */
  sensitiveResources: string[];
  /** High-risk actions that increase threat score */
  highRiskActions: string[];
}

/**
 * Threat assessment result from real-time threat scoring
 */
export interface ThreatAssessment {
  /** Overall threat score (0-1) */
  threatScore: number;
  /** Threat level classification */
  threatLevel: 'low' | 'medium' | 'high' | 'critical';
  /** Whether the request should be blocked */
  shouldBlock: boolean;
  /** Individual threat indicators */
  indicators: ThreatIndicator[];
  /** Recommended actions */
  recommendations: string[];
  /** Timestamp of assessment */
  assessedAt: Date;
}

/**
 * Individual threat indicator
 */
export interface ThreatIndicator {
  type: ThreatIndicatorType;
  score: number;
  description: string;
  evidence: Record<string, unknown>;
  confidence: number;
}

export type ThreatIndicatorType =
  | 'velocity_anomaly'
  | 'pattern_deviation'
  | 'privilege_escalation'
  | 'resource_boundary_violation'
  | 'suspicious_action'
  | 'derived_role_abuse'
  | 'condition_manipulation'
  | 'time_based_anomaly'
  | 'geographic_anomaly'
  | 'session_anomaly';

/**
 * Policy violation detected during validation
 */
export interface PolicyViolation {
  id: string;
  detectedAt: Date;
  request: CheckRequest;
  violationType: PolicyViolationType;
  severity: Priority;
  description: string;
  explanation: PolicyViolationExplanation;
  affectedPolicies: string[];
  derivedRolesInvolved: string[];
  recommendedAction: string;
}

export type PolicyViolationType =
  | 'unauthorized_access'
  | 'role_mismatch'
  | 'condition_failure'
  | 'derived_role_violation'
  | 'resource_boundary_breach'
  | 'action_not_permitted'
  | 'explicit_deny_match';

/**
 * Detailed explanation of why a policy violation occurred
 */
export interface PolicyViolationExplanation {
  summary: string;
  factors: ExplanationFactor[];
  pathToResolution?: PathToResolution;
}

interface ExplanationFactor {
  factor: string;
  impact: 'blocking' | 'contributing' | 'neutral';
  details: string;
}

interface PathToResolution {
  requiredRoles?: string[];
  requiredAttributes?: { key: string; value: unknown }[];
  requiredConditions?: string[];
  suggestedPolicyChanges?: string[];
}

/**
 * Audit log entry for Guardian decisions
 */
export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  requestId: string;
  principalId: string;
  resourceKind: string;
  resourceId: string;
  actions: string[];
  decision: 'allowed' | 'denied' | 'blocked';
  threatAssessment?: ThreatAssessment;
  violations?: PolicyViolation[];
  derivedRoles: string[];
  processingTimeMs: number;
  metadata: Record<string, unknown>;
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
  private celEvaluator: CelEvaluator;

  /** Get event bus for testing */
  getEventBus(): EventBus { return this.eventBus; }

  // In-memory caches
  private baselines: Map<string, PrincipalBaseline> = new Map();
  private velocityTrackers: Map<string, VelocityTracker> = new Map();
  private recentAnomalies: Map<string, Anomaly[]> = new Map();

  // Policy and threat tracking
  private loadedPolicies: Map<string, ResourcePolicy> = new Map();
  private derivedRolesDefinitions: DerivedRoleDefinition[] = [];
  private auditLog: AuditLogEntry[] = [];
  private recentViolations: Map<string, PolicyViolation[]> = new Map();
  private threatHistory: Map<string, ThreatAssessment[]> = new Map();

  constructor(
    config: AgentConfig,
    store: DecisionStore,
    eventBus: EventBus,
  ) {
    super('guardian', 'GUARDIAN - Anomaly Detection', config);
    this.store = store;
    this.eventBus = eventBus;
    this.celEvaluator = new CelEvaluator();
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
      enablePolicyValidation: true,
      enableThreatScoring: true,
      threatBlockThreshold: 0.85,
      enableAuditLogging: true,
      sensitiveResources: [
        'admin',
        'user',
        'payment',
        'payout',
        'subscription',
        'credential',
        'secret',
        'config',
      ],
      highRiskActions: [
        'delete',
        'admin',
        'export',
        'bulk',
        'transfer',
        'withdraw',
        'modify-permissions',
        'change-role',
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

  // ============================================================================
  // REAL-TIME THREAT SCORING
  // ============================================================================

  /**
   * Perform comprehensive real-time threat assessment on a request
   */
  async assessThreat(request: CheckRequest): Promise<ThreatAssessment> {
    const startTime = Date.now();
    const indicators: ThreatIndicator[] = [];
    const principalId = request.principal.id;

    // 1. Velocity-based threat indicator
    const velocityIndicator = this.assessVelocityThreat(principalId, request);
    if (velocityIndicator) indicators.push(velocityIndicator);

    // 2. Pattern deviation indicator
    const patternIndicator = await this.assessPatternDeviation(principalId, request);
    if (patternIndicator) indicators.push(patternIndicator);

    // 3. Privilege escalation indicator
    const escalationIndicator = await this.assessPrivilegeEscalation(principalId, request);
    if (escalationIndicator) indicators.push(escalationIndicator);

    // 4. Resource boundary violation indicator
    const boundaryIndicator = this.assessResourceBoundary(request);
    if (boundaryIndicator) indicators.push(boundaryIndicator);

    // 5. Suspicious action indicator
    const actionIndicator = this.assessSuspiciousAction(request);
    if (actionIndicator) indicators.push(actionIndicator);

    // 6. Derived role abuse indicator
    const derivedRoleIndicator = await this.assessDerivedRoleAbuse(request);
    if (derivedRoleIndicator) indicators.push(derivedRoleIndicator);

    // 7. Time-based anomaly indicator
    const timeIndicator = this.assessTimeAnomaly(principalId);
    if (timeIndicator) indicators.push(timeIndicator);

    // Calculate overall threat score (weighted average with confidence)
    const threatScore = this.calculateThreatScore(indicators);
    const threatLevel = this.classifyThreatLevel(threatScore);
    const shouldBlock = threatScore >= this.guardianConfig.threatBlockThreshold;

    const assessment: ThreatAssessment = {
      threatScore,
      threatLevel,
      shouldBlock,
      indicators,
      recommendations: this.generateThreatRecommendations(indicators, threatLevel),
      assessedAt: new Date(),
    };

    // Track threat history for this principal
    this.trackThreatHistory(principalId, assessment);

    // Log audit entry if enabled
    if (this.guardianConfig.enableAuditLogging) {
      await this.logAuditEntry(request, assessment, [], Date.now() - startTime);
    }

    // Emit event for high-level threats
    if (threatLevel === 'high' || threatLevel === 'critical') {
      this.emitAgentEvent('anomaly_detected', {
        type: 'threat_assessment',
        assessment,
        request: {
          principalId: request.principal.id,
          resourceKind: request.resource.kind,
          actions: request.actions,
        },
      }, request.requestId);
    }

    this.incrementCustomMetric('threat_assessments');
    if (shouldBlock) {
      this.incrementCustomMetric('threats_blocked');
    }

    return assessment;
  }

  private assessVelocityThreat(principalId: string, request: CheckRequest): ThreatIndicator | null {
    const velocityResult = this.checkVelocity(principalId, request.resource.kind, request.actions[0]);

    if (!velocityResult.isAnomalous) return null;

    return {
      type: 'velocity_anomaly',
      score: velocityResult.score,
      description: `Request rate anomaly: ${velocityResult.requestsInWindow} requests in ${this.guardianConfig.velocityWindowMinutes} minutes`,
      evidence: {
        requestsInWindow: velocityResult.requestsInWindow,
        maxAllowed: this.guardianConfig.maxRequestsPerMinute * this.guardianConfig.velocityWindowMinutes,
        severity: velocityResult.severity,
      },
      confidence: 0.9,
    };
  }

  private async assessPatternDeviation(principalId: string, request: CheckRequest): Promise<ThreatIndicator | null> {
    const baseline = this.baselines.get(principalId);
    if (!baseline) return null;

    const unusualActions = request.actions.filter(
      action => !baseline.stats.commonActions.includes(action)
    );

    if (unusualActions.length === 0) return null;

    return {
      type: 'pattern_deviation',
      score: 0.4 + (unusualActions.length * 0.1),
      description: `Actions deviate from established patterns: ${unusualActions.join(', ')}`,
      evidence: {
        unusualActions,
        commonActions: baseline.stats.commonActions,
        baselinePeriod: baseline.stats.period,
      },
      confidence: Math.min(0.95, 0.6 + (baseline.stats.avgRequestsPerHour / 100) * 0.35),
    };
  }

  private async assessPrivilegeEscalation(principalId: string, request: CheckRequest): Promise<ThreatIndicator | null> {
    const recentDecisions = await this.store.queryDecisions(
      { principalId, fromDate: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      { limit: 100 },
    );

    const historicalResourceKinds = new Set(recentDecisions.map(d => d.resource.kind));
    const isSensitiveResource = this.guardianConfig.sensitiveResources.some(
      s => request.resource.kind.toLowerCase().includes(s)
    );

    if (!historicalResourceKinds.has(request.resource.kind) && isSensitiveResource) {
      return {
        type: 'privilege_escalation',
        score: 0.7,
        description: `First-time access to sensitive resource type: ${request.resource.kind}`,
        evidence: {
          newResourceKind: request.resource.kind,
          historicalResourceKinds: Array.from(historicalResourceKinds),
          isSensitive: true,
        },
        confidence: 0.85,
      };
    }

    return null;
  }

  private assessResourceBoundary(request: CheckRequest): ThreatIndicator | null {
    const resourceKind = request.resource.kind.toLowerCase();
    const isSensitive = this.guardianConfig.sensitiveResources.some(s => resourceKind.includes(s));
    const isHighRiskAction = request.actions.some(action =>
      this.guardianConfig.highRiskActions.some(hr => action.toLowerCase().includes(hr))
    );

    if (isSensitive && isHighRiskAction) {
      return {
        type: 'resource_boundary_violation',
        score: 0.6,
        description: `High-risk action on sensitive resource: ${request.actions.join(', ')} on ${request.resource.kind}`,
        evidence: {
          resourceKind: request.resource.kind,
          actions: request.actions,
          matchedSensitivePattern: this.guardianConfig.sensitiveResources.find(s => resourceKind.includes(s)),
          matchedHighRiskAction: this.guardianConfig.highRiskActions.find(hr =>
            request.actions.some(a => a.toLowerCase().includes(hr))
          ),
        },
        confidence: 0.95,
      };
    }

    return null;
  }

  private assessSuspiciousAction(request: CheckRequest): ThreatIndicator | null {
    const matchedPatterns = this.guardianConfig.suspiciousPatterns.filter(pattern => {
      const lower = pattern.toLowerCase();
      return request.actions.some(a => a.toLowerCase().includes(lower)) ||
             request.resource.kind.toLowerCase().includes(lower) ||
             request.resource.id.toLowerCase().includes(lower);
    });

    if (matchedPatterns.length === 0) return null;

    return {
      type: 'suspicious_action',
      score: Math.min(0.8, 0.3 + (matchedPatterns.length * 0.15)),
      description: `Request matches ${matchedPatterns.length} suspicious patterns: ${matchedPatterns.join(', ')}`,
      evidence: {
        matchedPatterns,
        action: request.actions,
        resourceKind: request.resource.kind,
      },
      confidence: 0.8,
    };
  }

  private async assessDerivedRoleAbuse(request: CheckRequest): Promise<ThreatIndicator | null> {
    if (this.derivedRolesDefinitions.length === 0) return null;

    // Compute which derived roles would apply
    const applicableDerivedRoles = this.computeDerivedRoles(request);

    // Check if any derived roles grant elevated privileges unexpectedly
    const sensitiveRoles = ['admin', 'owner', 'superuser', 'operator'];
    const elevatedRoles = applicableDerivedRoles.filter(role =>
      sensitiveRoles.some(sr => role.toLowerCase().includes(sr))
    );

    if (elevatedRoles.length === 0) return null;

    // Check if this is unusual for this principal
    const baseline = this.baselines.get(request.principal.id);
    if (baseline && baseline.stats.commonActions.length > 0) {
      // Principal has history, check if derived roles match pattern
      return {
        type: 'derived_role_abuse',
        score: 0.5,
        description: `Principal obtained elevated derived roles: ${elevatedRoles.join(', ')}`,
        evidence: {
          derivedRoles: applicableDerivedRoles,
          elevatedRoles,
          principalRoles: request.principal.roles,
        },
        confidence: 0.7,
      };
    }

    return null;
  }

  private assessTimeAnomaly(principalId: string): ThreatIndicator | null {
    const hour = new Date().getHours();
    const isOffHours = hour < 6 || hour > 22;

    if (!isOffHours) return null;

    const baseline = this.baselines.get(principalId);
    if (baseline) {
      // Check if off-hours access is normal for this user
      const hasOffHoursPattern = baseline.stats.commonTimeRanges.some(range => {
        const [start] = range.split('-').map(t => parseInt(t.split(':')[0], 10));
        return start < 6 || start > 22;
      });
      if (hasOffHoursPattern) return null;
    }

    return {
      type: 'time_based_anomaly',
      score: 0.25,
      description: `Access at unusual hour: ${hour}:00`,
      evidence: {
        currentHour: hour,
        officeHours: '06:00-22:00',
      },
      confidence: 0.6,
    };
  }

  private calculateThreatScore(indicators: ThreatIndicator[]): number {
    if (indicators.length === 0) return 0;

    // Weighted average based on confidence
    const totalWeight = indicators.reduce((sum, ind) => sum + ind.confidence, 0);
    const weightedSum = indicators.reduce((sum, ind) => sum + (ind.score * ind.confidence), 0);

    return Math.min(1, weightedSum / totalWeight);
  }

  private classifyThreatLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score >= 0.85) return 'critical';
    if (score >= 0.65) return 'high';
    if (score >= 0.4) return 'medium';
    return 'low';
  }

  private generateThreatRecommendations(indicators: ThreatIndicator[], level: ThreatAssessment['threatLevel']): string[] {
    const recommendations: string[] = [];

    if (level === 'critical') {
      recommendations.push('IMMEDIATE: Block request and alert security team');
      recommendations.push('Review principal account for potential compromise');
    } else if (level === 'high') {
      recommendations.push('Require additional authentication (MFA)');
      recommendations.push('Log all subsequent requests from this principal');
    }

    for (const indicator of indicators) {
      switch (indicator.type) {
        case 'velocity_anomaly':
          recommendations.push('Consider rate limiting this principal');
          break;
        case 'privilege_escalation':
          recommendations.push('Verify principal has legitimate need for resource access');
          break;
        case 'derived_role_abuse':
          recommendations.push('Review derived role conditions for potential exploitation');
          break;
        case 'resource_boundary_violation':
          recommendations.push('Confirm action is within principal authorization scope');
          break;
      }
    }

    return [...new Set(recommendations)]; // Remove duplicates
  }

  private trackThreatHistory(principalId: string, assessment: ThreatAssessment): void {
    const history = this.threatHistory.get(principalId) || [];
    history.push(assessment);
    // Keep last 100 assessments
    if (history.length > 100) history.shift();
    this.threatHistory.set(principalId, history);
  }

  // ============================================================================
  // POLICY VIOLATION DETECTION
  // ============================================================================

  /**
   * Load policies for validation
   */
  loadPolicies(policies: ResourcePolicy[]): void {
    for (const policy of policies) {
      this.loadedPolicies.set(policy.metadata.name, policy);
    }
    this.log('info', `Loaded ${policies.length} policies for validation`);
  }

  /**
   * Load derived role definitions for evaluation
   */
  loadDerivedRoles(definitions: DerivedRoleDefinition[]): void {
    this.derivedRolesDefinitions = definitions;
    this.log('info', `Loaded ${definitions.length} derived role definitions`);
  }

  /**
   * Validate a request against loaded policies and detect violations
   */
  async validateRequest(request: CheckRequest): Promise<{
    valid: boolean;
    violations: PolicyViolation[];
    derivedRoles: string[];
    matchedPolicies: string[];
  }> {
    const violations: PolicyViolation[] = [];
    const matchedPolicies: string[] = [];

    // Compute derived roles for this request
    const derivedRoles = this.computeDerivedRoles(request);
    const allRoles = [...request.principal.roles, ...derivedRoles];

    // Get applicable policies
    const applicablePolicies = Array.from(this.loadedPolicies.values())
      .filter(p => p.spec.resource === request.resource.kind);

    if (applicablePolicies.length === 0) {
      violations.push(this.createPolicyViolation(
        request,
        'resource_boundary_breach',
        'No policy defined for this resource type',
        {
          summary: `No authorization policy exists for resource type: ${request.resource.kind}`,
          factors: [{
            factor: 'missing_policy',
            impact: 'blocking',
            details: 'Resource type has no associated policy, defaulting to deny',
          }],
          pathToResolution: {
            suggestedPolicyChanges: [`Create a ResourcePolicy for resource type: ${request.resource.kind}`],
          },
        },
        [],
        derivedRoles,
      ));
      return { valid: false, violations, derivedRoles, matchedPolicies };
    }

    // Check each action against policies
    for (const action of request.actions) {
      const actionResult = this.evaluateActionAgainstPolicies(
        action,
        request,
        allRoles,
        derivedRoles,
        applicablePolicies,
      );

      if (!actionResult.allowed) {
        violations.push(actionResult.violation!);
      }

      if (actionResult.matchedPolicy) {
        matchedPolicies.push(actionResult.matchedPolicy);
      }
    }

    // Log audit entry
    if (this.guardianConfig.enableAuditLogging) {
      await this.logAuditEntry(
        request,
        undefined,
        violations,
        0,
        derivedRoles,
      );
    }

    return {
      valid: violations.length === 0,
      violations,
      derivedRoles,
      matchedPolicies: [...new Set(matchedPolicies)],
    };
  }

  /**
   * Compute derived roles for a request using CEL evaluator
   */
  computeDerivedRoles(request: CheckRequest): string[] {
    const derivedRoles: string[] = [];

    for (const definition of this.derivedRolesDefinitions) {
      // Check if principal has required parent roles
      const hasParentRole = definition.parentRoles.length === 0 ||
        definition.parentRoles.some(role => request.principal.roles.includes(role));

      if (!hasParentRole) continue;

      // Evaluate condition using CEL
      const context: EvaluationContext = {
        principal: request.principal,
        resource: request.resource,
        auxData: request.auxData,
      };

      try {
        const matches = this.celEvaluator.evaluateBoolean(
          definition.condition.expression,
          context,
        );

        if (matches) {
          derivedRoles.push(definition.name);
        }
      } catch (error) {
        this.log('warn', `Failed to evaluate derived role condition: ${definition.name}`, error);
      }
    }

    return derivedRoles;
  }

  private evaluateActionAgainstPolicies(
    action: string,
    request: CheckRequest,
    allRoles: string[],
    derivedRoles: string[],
    policies: ResourcePolicy[],
  ): { allowed: boolean; violation?: PolicyViolation; matchedPolicy?: string } {

    for (const policy of policies) {
      for (const rule of policy.spec.rules) {
        // Check if action matches
        if (!rule.actions.includes(action) && !rule.actions.includes('*')) {
          continue;
        }

        // Check role requirements
        if (rule.roles && rule.roles.length > 0) {
          const hasRole = rule.roles.some(role => allRoles.includes(role));
          if (!hasRole) {
            continue;
          }
        }

        // Check derived role requirements
        if (rule.derivedRoles && rule.derivedRoles.length > 0) {
          const hasDerivedRole = rule.derivedRoles.some(role => derivedRoles.includes(role));
          if (!hasDerivedRole) {
            continue;
          }
        }

        // Evaluate condition if present
        if (rule.condition) {
          const context: EvaluationContext = {
            principal: request.principal,
            resource: request.resource,
            auxData: request.auxData,
          };

          const conditionMet = this.celEvaluator.evaluateBoolean(
            rule.condition.expression,
            context,
          );

          if (!conditionMet) {
            // Condition failed - this is a potential violation if it's an allow rule
            if (rule.effect === 'allow') {
              return {
                allowed: false,
                violation: this.createPolicyViolation(
                  request,
                  'condition_failure',
                  `Condition not satisfied for action: ${action}`,
                  {
                    summary: `Access denied: CEL condition "${rule.condition.expression}" evaluated to false`,
                    factors: [{
                      factor: 'condition_not_met',
                      impact: 'blocking',
                      details: `The condition "${rule.condition.expression}" was not satisfied by the current context`,
                    }],
                    pathToResolution: {
                      requiredConditions: [rule.condition.expression],
                    },
                  },
                  [policy.metadata.name],
                  derivedRoles,
                ),
                matchedPolicy: policy.metadata.name,
              };
            }
            continue;
          }
        }

        // Rule matched
        if (rule.effect === 'deny') {
          return {
            allowed: false,
            violation: this.createPolicyViolation(
              request,
              'explicit_deny_match',
              `Action explicitly denied by policy: ${policy.metadata.name}`,
              {
                summary: `Action "${action}" is explicitly denied by rule "${rule.name || 'unnamed'}" in policy "${policy.metadata.name}"`,
                factors: [{
                  factor: 'explicit_deny',
                  impact: 'blocking',
                  details: 'An explicit deny rule matched this request',
                }],
              },
              [policy.metadata.name],
              derivedRoles,
            ),
            matchedPolicy: policy.metadata.name,
          };
        }

        // Allow rule matched
        return { allowed: true, matchedPolicy: policy.metadata.name };
      }
    }

    // No matching rule - default deny
    return {
      allowed: false,
      violation: this.createPolicyViolation(
        request,
        'unauthorized_access',
        `No matching allow rule for action: ${action}`,
        {
          summary: `Action "${action}" on resource "${request.resource.kind}" is not permitted for principal "${request.principal.id}"`,
          factors: [
            {
              factor: 'no_matching_rule',
              impact: 'blocking',
              details: `No policy rule grants "${action}" permission on "${request.resource.kind}"`,
            },
            {
              factor: 'principal_roles',
              impact: 'contributing',
              details: `Principal has roles: ${request.principal.roles.join(', ')}`,
            },
          ],
          pathToResolution: {
            requiredRoles: ['Add appropriate role that has access to this resource'],
            suggestedPolicyChanges: [
              `Add a rule to permit "${action}" on "${request.resource.kind}" for appropriate roles`,
            ],
          },
        },
        policies.map(p => p.metadata.name),
        derivedRoles,
      ),
    };
  }

  private createPolicyViolation(
    request: CheckRequest,
    type: PolicyViolationType,
    description: string,
    explanation: PolicyViolationExplanation,
    affectedPolicies: string[],
    derivedRoles: string[],
  ): PolicyViolation {
    const severity = this.determinePolicyViolationSeverity(type, request);

    const violation: PolicyViolation = {
      id: `violation-${Date.now()}-${Math.random().toString(36).substring(2)}`,
      detectedAt: new Date(),
      request,
      violationType: type,
      severity,
      description,
      explanation,
      affectedPolicies,
      derivedRolesInvolved: derivedRoles,
      recommendedAction: this.getRecommendedAction(type, severity),
    };

    // Track violation
    const principalId = request.principal.id;
    const violations = this.recentViolations.get(principalId) || [];
    violations.push(violation);
    if (violations.length > 50) violations.shift();
    this.recentViolations.set(principalId, violations);

    this.incrementCustomMetric('policy_violations');

    return violation;
  }

  private determinePolicyViolationSeverity(type: PolicyViolationType, request: CheckRequest): Priority {
    // Critical: explicit deny on sensitive resource
    if (type === 'explicit_deny_match') {
      const isSensitive = this.guardianConfig.sensitiveResources.some(s =>
        request.resource.kind.toLowerCase().includes(s)
      );
      return isSensitive ? 'critical' : 'high';
    }

    // High: privilege escalation or boundary breach
    if (type === 'resource_boundary_breach' || type === 'derived_role_violation') {
      return 'high';
    }

    // Medium: condition failures, role mismatches
    if (type === 'condition_failure' || type === 'role_mismatch') {
      return 'medium';
    }

    // Low: general unauthorized access
    return 'low';
  }

  private getRecommendedAction(type: PolicyViolationType, severity: Priority): string {
    if (severity === 'critical') {
      return 'Block request immediately and alert security team';
    }

    switch (type) {
      case 'explicit_deny_match':
        return 'Request is explicitly forbidden; review policy if access should be allowed';
      case 'role_mismatch':
        return 'Verify principal has correct role assignment';
      case 'condition_failure':
        return 'Check that request context satisfies policy conditions';
      case 'derived_role_violation':
        return 'Review derived role definitions and conditions';
      case 'resource_boundary_breach':
        return 'Verify resource access is within authorized scope';
      default:
        return 'Review request authorization and policy configuration';
    }
  }

  // ============================================================================
  // AUDIT LOGGING
  // ============================================================================

  /**
   * Log an audit entry for a Guardian decision
   */
  private async logAuditEntry(
    request: CheckRequest,
    threatAssessment?: ThreatAssessment,
    violations?: PolicyViolation[],
    processingTimeMs: number = 0,
    derivedRoles: string[] = [],
  ): Promise<void> {
    if (!this.guardianConfig.enableAuditLogging) return;

    const decision: AuditLogEntry['decision'] =
      threatAssessment?.shouldBlock ? 'blocked' :
      violations && violations.length > 0 ? 'denied' : 'allowed';

    const entry: AuditLogEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2)}`,
      timestamp: new Date(),
      requestId: request.requestId || 'unknown',
      principalId: request.principal.id,
      resourceKind: request.resource.kind,
      resourceId: request.resource.id,
      actions: request.actions,
      decision,
      threatAssessment,
      violations: violations && violations.length > 0 ? violations : undefined,
      derivedRoles,
      processingTimeMs,
      metadata: {
        principalRoles: request.principal.roles,
        principalAttributes: request.principal.attributes,
        resourceAttributes: request.resource.attributes,
        auxData: request.auxData,
      },
    };

    this.auditLog.push(entry);

    // Keep last 10000 entries in memory
    if (this.auditLog.length > 10000) {
      this.auditLog = this.auditLog.slice(-10000);
    }

    // Emit audit event for external logging
    this.emit('audit', entry);

    this.log('debug', `Audit: ${decision} for ${request.principal.id} on ${request.resource.kind}/${request.resource.id}`);
  }

  /**
   * Get audit log entries with optional filters
   */
  getAuditLog(filters?: {
    principalId?: string;
    resourceKind?: string;
    decision?: AuditLogEntry['decision'];
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
  }): AuditLogEntry[] {
    let entries = [...this.auditLog];

    if (filters?.principalId) {
      entries = entries.filter(e => e.principalId === filters.principalId);
    }
    if (filters?.resourceKind) {
      entries = entries.filter(e => e.resourceKind === filters.resourceKind);
    }
    if (filters?.decision) {
      entries = entries.filter(e => e.decision === filters.decision);
    }
    if (filters?.fromDate) {
      entries = entries.filter(e => e.timestamp >= filters.fromDate!);
    }
    if (filters?.toDate) {
      entries = entries.filter(e => e.timestamp <= filters.toDate!);
    }

    // Sort by timestamp descending
    entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (filters?.limit) {
      entries = entries.slice(0, filters.limit);
    }

    return entries;
  }

  /**
   * Get recent policy violations for a principal
   */
  getRecentViolations(principalId: string): PolicyViolation[] {
    return this.recentViolations.get(principalId) || [];
  }

  /**
   * Get threat history for a principal
   */
  getThreatHistory(principalId: string): ThreatAssessment[] {
    return this.threatHistory.get(principalId) || [];
  }

  /**
   * Clear audit log
   */
  clearAuditLog(): void {
    this.auditLog = [];
    this.log('info', 'Audit log cleared');
  }

  // ============================================================================
  // PRIVATE METHODS (EXISTING)
  // ============================================================================

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
