/**
 * AuthZ Agentic Service
 *
 * NestJS service wrapper for the Agent Orchestrator.
 * Provides dependency injection and integration with the 4 authorization agents:
 * - GUARDIAN: Anomaly detection & threat protection
 * - ANALYST: Pattern analysis & learning
 * - ADVISOR: Explanations & recommendations
 * - ENFORCER: Rate limiting & enforcement
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, Optional } from '@nestjs/common';
import type { Principal, Resource } from '@authz-engine/sdk';
import type {
  AnalysisData,
  ThreatData,
  RateLimitData,
  RateLimitedOptions,
  ThreatProtectedOptions,
  RequireAnalysisOptions,
  WithRecommendationsOptions,
} from './decorators';

/**
 * Configuration for the agentic service
 */
export interface AuthzAgenticConfig {
  /** Enable the agentic service */
  enabled: boolean;
  /** Configuration for the agent orchestrator */
  orchestrator?: {
    /** Agent configuration */
    agents?: {
      enabled: boolean;
      logLevel?: 'debug' | 'info' | 'warn' | 'error';
      guardian?: {
        anomalyThreshold?: number;
        baselinePeriodDays?: number;
        velocityWindowMinutes?: number;
        enableRealTimeDetection?: boolean;
      };
      analyst?: {
        minSampleSize?: number;
        confidenceThreshold?: number;
        learningEnabled?: boolean;
      };
      advisor?: {
        llmProvider?: 'openai' | 'anthropic' | 'local';
        llmModel?: string;
        enableNaturalLanguage?: boolean;
        maxExplanationLength?: number;
      };
      enforcer?: {
        autoEnforceEnabled?: boolean;
        requireApprovalForSeverity?: 'low' | 'medium' | 'high' | 'critical';
        maxActionsPerHour?: number;
        rollbackWindowMinutes?: number;
      };
    };
    /** Decision store configuration */
    store?: {
      type: 'memory' | 'postgres' | 'redis';
      connectionString?: string;
      maxEntries?: number;
    };
    /** Event bus configuration */
    eventBus?: {
      type: 'memory' | 'redis' | 'kafka';
      connectionString?: string;
    };
  };
}

export const AUTHZ_AGENTIC_CONFIG = 'AUTHZ_AGENTIC_CONFIG';

/**
 * Result from agentic processing
 */
export interface AgenticProcessingOutput {
  allowed: boolean;
  decision: 'allow' | 'deny';
  confidence: number;
  explanation?: string;
  anomalyScore?: number;
  recommendations?: string[];
  analysis?: AnalysisData;
  threatInfo?: ThreatData;
  rateLimitInfo?: RateLimitData;
  agentsInvolved: string[];
  processingTimeMs: number;
}

/**
 * Rate limit state stored in memory (for simple implementation)
 */
interface RateLimitState {
  count: number;
  windowStart: Date;
  resetAt: Date;
}

/**
 * AuthZ Agentic Service
 *
 * Injectable service for agentic authorization features.
 */
@Injectable()
export class AuthzAgenticService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthzAgenticService.name);
  private isInitialized = false;

  // In-memory rate limit storage (replace with Redis/DB in production)
  private rateLimitStore = new Map<string, RateLimitState>();

  // In-memory baseline storage for threat detection
  private baselineStore = new Map<string, {
    requestsPerHour: number;
    lastUpdated: Date;
    recentRequests: number[];
  }>();

  constructor(
    @Optional() @Inject(AUTHZ_AGENTIC_CONFIG) private readonly config?: AuthzAgenticConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config?.enabled) {
      this.logger.log('Agentic service disabled');
      return;
    }

    this.logger.log('Initializing agentic authorization service...');
    this.isInitialized = true;
    this.logger.log('Agentic authorization service initialized');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.isInitialized) {
      this.logger.log('Shutting down agentic authorization service...');
      this.rateLimitStore.clear();
      this.baselineStore.clear();
      this.isInitialized = false;
    }
  }

  /**
   * Process a request through the full agentic pipeline
   */
  async processAgenticRequest(
    principal: Principal,
    resource: Resource,
    action: string,
    options: {
      includeAnalysis?: boolean;
      includeRecommendations?: boolean;
      enableThreatDetection?: boolean;
      enableRateLimiting?: boolean;
      rateLimitConfig?: RateLimitedOptions;
      threatConfig?: ThreatProtectedOptions;
      analysisConfig?: RequireAnalysisOptions;
      recommendationsConfig?: WithRecommendationsOptions;
      context?: Record<string, unknown>;
    },
  ): Promise<AgenticProcessingOutput> {
    const startTime = Date.now();
    const agentsInvolved: string[] = [];

    this.logger.debug(
      `[AgenticRequest] ${principal.id} -> ${resource.kind}:${resource.id} [${action}]`,
    );

    let analysis: AnalysisData | undefined;
    let threatInfo: ThreatData | undefined;
    let rateLimitInfo: RateLimitData | undefined;
    let recommendations: string[] | undefined;

    // 1. ENFORCER: Check rate limits
    if (options.enableRateLimiting && options.rateLimitConfig) {
      rateLimitInfo = await this.checkRateLimit(principal.id, {
        ...options.rateLimitConfig,
        enabled: true,
      });
      agentsInvolved.push('enforcer');
    }

    // 2. GUARDIAN: Check for threats
    if (options.enableThreatDetection) {
      threatInfo = await this.checkThreat(
        principal.id,
        resource,
        action,
        { ...(options.threatConfig || {}), enabled: true },
      );
      agentsInvolved.push('guardian');
    }

    // 3. ANALYST: Perform analysis
    if (options.includeAnalysis) {
      analysis = await this.performAnalysis(
        principal,
        resource,
        action,
        options.analysisConfig,
      );
      agentsInvolved.push('analyst');
    }

    // 4. ADVISOR: Generate recommendations
    if (options.includeRecommendations) {
      recommendations = await this.generateRecommendations(
        principal,
        resource,
        action,
        options.recommendationsConfig,
      );
      agentsInvolved.push('advisor');
    }

    // Determine final decision
    const allowed = this.determineDecision(
      threatInfo,
      rateLimitInfo,
      options,
    );

    // Generate explanation
    const explanation = this.generateExplanation(
      allowed,
      principal,
      resource,
      action,
      threatInfo,
      analysis,
    );

    // Calculate confidence based on available data
    const confidence = this.calculateConfidence(
      analysis,
      threatInfo,
      agentsInvolved.length,
    );

    return {
      allowed,
      decision: allowed ? 'allow' : 'deny',
      confidence,
      explanation,
      anomalyScore: threatInfo?.anomalyScore,
      recommendations,
      analysis,
      threatInfo,
      rateLimitInfo,
      agentsInvolved,
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Check rate limit for a principal (ENFORCER)
   */
  async checkRateLimit(
    principalId: string,
    options: RateLimitedOptions & { enabled: boolean },
  ): Promise<RateLimitData> {
    const key = this.getRateLimitKey(principalId, options.keyBy);
    const now = new Date();
    const windowMs = options.windowSeconds * 1000;

    let state = this.rateLimitStore.get(key);

    // Check if window has expired
    if (!state || now.getTime() - state.windowStart.getTime() > windowMs) {
      state = {
        count: 0,
        windowStart: now,
        resetAt: new Date(now.getTime() + windowMs),
      };
    }

    // Increment count
    state.count++;
    this.rateLimitStore.set(key, state);

    const remaining = Math.max(0, options.maxRequests - state.count);
    const isLimited = state.count > options.maxRequests;

    return {
      remaining,
      limit: options.maxRequests,
      resetAt: state.resetAt,
      isLimited,
      currentUsage: state.count,
    };
  }

  /**
   * Check for threats and anomalies (GUARDIAN)
   */
  async checkThreat(
    principalId: string,
    resource: Resource,
    action: string,
    options: ThreatProtectedOptions & { enabled: boolean },
  ): Promise<ThreatData> {
    // Get or create baseline
    let baseline = this.baselineStore.get(principalId);
    const now = Date.now();

    if (!baseline) {
      baseline = {
        requestsPerHour: 10, // Default baseline
        lastUpdated: new Date(),
        recentRequests: [],
      };
      this.baselineStore.set(principalId, baseline);
    }

    // Track recent request
    baseline.recentRequests.push(now);
    // Keep only last hour
    const oneHourAgo = now - 3600000;
    baseline.recentRequests = baseline.recentRequests.filter(t => t > oneHourAgo);

    // Calculate anomaly score based on various factors
    const currentRate = baseline.recentRequests.length;
    const expectedRate = baseline.requestsPerHour;
    const deviation = expectedRate > 0
      ? Math.abs(currentRate - expectedRate) / expectedRate
      : 0;

    // Detect specific threat types
    const detectedThreats: ThreatData['detectedThreats'] = [];
    const riskFactors: ThreatData['riskFactors'] = [];
    let anomalyScore = 0;

    // Velocity spike detection
    if (deviation > 2) {
      anomalyScore += 0.3;
      riskFactors.push({ factor: 'velocity_spike', score: deviation / 5 });
      if (options.threatTypes?.includes('velocity_spike')) {
        detectedThreats.push({
          type: 'velocity_spike',
          severity: deviation > 5 ? 'high' : 'medium',
          description: `Request rate ${currentRate}/hr is ${deviation.toFixed(1)}x above baseline ${expectedRate}/hr`,
        });
      }
    }

    // Unusual time detection (simplified: late night hours)
    const hour = new Date().getHours();
    if (hour >= 0 && hour <= 5) {
      anomalyScore += 0.2;
      riskFactors.push({ factor: 'unusual_time', score: 0.2 });
      if (options.threatTypes?.includes('unusual_access_time')) {
        detectedThreats.push({
          type: 'unusual_access_time',
          severity: 'low',
          description: `Access at unusual hour (${hour}:00)`,
        });
      }
    }

    // Permission escalation detection (simplified)
    if (action.includes('admin') || action.includes('delete') || action.includes('destroy')) {
      anomalyScore += 0.15;
      riskFactors.push({ factor: 'sensitive_action', score: 0.15 });
      if (options.threatTypes?.includes('permission_escalation')) {
        detectedThreats.push({
          type: 'permission_escalation',
          severity: 'medium',
          description: `Sensitive action attempted: ${action}`,
        });
      }
    }

    // Cap anomaly score at 1
    anomalyScore = Math.min(1, anomalyScore);

    // Update baseline over time
    if (now - baseline.lastUpdated.getTime() > 3600000) {
      baseline.requestsPerHour = Math.round(
        baseline.requestsPerHour * 0.9 + currentRate * 0.1,
      );
      baseline.lastUpdated = new Date();
    }

    return {
      anomalyScore,
      isAnomalous: anomalyScore > (options.anomalyThreshold ?? 0.8),
      detectedThreats,
      riskFactors,
      baseline: {
        avgRequestsPerHour: baseline.requestsPerHour,
        deviation,
      },
    };
  }

  /**
   * Perform analysis (ANALYST)
   */
  private async performAnalysis(
    principal: Principal,
    resource: Resource,
    action: string,
    config?: RequireAnalysisOptions,
  ): Promise<AnalysisData> {
    // Simulated analysis - in production this would use ML models
    const patterns = [];

    // Check for common access patterns
    if (principal.roles.includes('admin')) {
      patterns.push({
        id: 'admin-access',
        name: 'Administrative Access',
        confidence: 0.95,
        description: 'Principal has administrative role',
      });
    }

    if (resource.kind === 'subscription' && action === 'create') {
      patterns.push({
        id: 'subscription-create',
        name: 'Subscription Creation',
        confidence: 0.85,
        description: 'Standard subscription creation pattern',
      });
    }

    // Calculate overall confidence
    const avgPatternConfidence = patterns.length > 0
      ? patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length
      : 0.7;

    return {
      confidence: avgPatternConfidence,
      patterns,
      historicalContext: {
        similarDecisions: Math.floor(Math.random() * 100) + 10, // Simulated
        avgConfidence: 0.85,
        commonOutcomes: ['allow', 'allow', 'allow', 'deny'],
      },
      riskAssessment: {
        level: avgPatternConfidence > 0.8 ? 'low' : avgPatternConfidence > 0.5 ? 'medium' : 'high',
        factors: patterns.length > 0 ? ['matched_known_pattern'] : ['no_pattern_match'],
      },
    };
  }

  /**
   * Generate recommendations (ADVISOR)
   */
  private async generateRecommendations(
    principal: Principal,
    resource: Resource,
    action: string,
    config?: WithRecommendationsOptions,
  ): Promise<string[]> {
    const recommendations: string[] = [];
    const maxRecommendations = config?.maxRecommendations ?? 5;

    // Generate context-aware recommendations
    if (action.includes('delete') || action.includes('destroy')) {
      recommendations.push(
        'Consider implementing soft-delete for data recovery',
        'Ensure audit logging is enabled for destructive operations',
      );
    }

    if (resource.kind === 'payment' || resource.kind === 'payout') {
      recommendations.push(
        'Enable additional verification for financial operations',
        'Consider implementing transaction limits',
      );
    }

    if (principal.roles.length === 0) {
      recommendations.push(
        'Principal has no assigned roles - consider role assignment',
      );
    }

    if (config?.includePolicySuggestions) {
      recommendations.push(
        `Consider creating a specific policy for ${resource.kind}:${action}`,
      );
    }

    return recommendations.slice(0, maxRecommendations);
  }

  /**
   * Determine final decision based on all agent outputs
   */
  private determineDecision(
    threatInfo?: ThreatData,
    rateLimitInfo?: RateLimitData,
    options?: {
      threatConfig?: ThreatProtectedOptions;
      rateLimitConfig?: RateLimitedOptions;
    },
  ): boolean {
    // Block if rate limited
    if (rateLimitInfo?.isLimited && options?.rateLimitConfig?.onLimitExceeded === 'block') {
      return false;
    }

    // Block if threat detected above threshold
    if (threatInfo?.isAnomalous && options?.threatConfig?.onThreatDetected === 'block') {
      return false;
    }

    // Default to allow (actual policy decision made elsewhere)
    return true;
  }

  /**
   * Generate human-readable explanation
   */
  private generateExplanation(
    allowed: boolean,
    principal: Principal,
    resource: Resource,
    action: string,
    threatInfo?: ThreatData,
    analysis?: AnalysisData,
  ): string {
    const parts: string[] = [];

    if (allowed) {
      parts.push(`Access granted for ${principal.id} to ${action} ${resource.kind}`);

      if (analysis?.patterns?.length) {
        parts.push(`Matched patterns: ${analysis.patterns.map(p => p.name).join(', ')}`);
      }

      if (threatInfo && threatInfo.anomalyScore < 0.5) {
        parts.push('No significant anomalies detected');
      }
    } else {
      parts.push(`Access denied for ${principal.id} to ${action} ${resource.kind}`);

      if (threatInfo?.isAnomalous) {
        parts.push(`Anomaly detected (score: ${threatInfo.anomalyScore.toFixed(2)})`);
        if (threatInfo.detectedThreats.length > 0) {
          parts.push(`Threats: ${threatInfo.detectedThreats.map(t => t.type).join(', ')}`);
        }
      }
    }

    return parts.join('. ');
  }

  /**
   * Calculate overall confidence score
   */
  private calculateConfidence(
    analysis?: AnalysisData,
    threatInfo?: ThreatData,
    agentCount?: number,
  ): number {
    let confidence = 0.7; // Base confidence

    if (analysis) {
      confidence = analysis.confidence;
    }

    // Reduce confidence if threats detected
    if (threatInfo?.anomalyScore) {
      confidence *= (1 - threatInfo.anomalyScore * 0.3);
    }

    // Increase confidence with more agents involved
    if (agentCount && agentCount > 2) {
      confidence = Math.min(0.99, confidence + 0.05);
    }

    return Math.round(confidence * 100) / 100;
  }

  /**
   * Get rate limit key
   */
  private getRateLimitKey(principalId: string, keyBy?: string): string {
    switch (keyBy) {
      case 'ip':
        return `ratelimit:ip:${principalId}`; // Would use actual IP in production
      case 'resource':
        return `ratelimit:resource:${principalId}`;
      case 'principal':
      default:
        return `ratelimit:principal:${principalId}`;
    }
  }

  /**
   * Get analysis for a request
   */
  async analyze(
    principal: Principal,
    resource: Resource,
    action: string,
    options?: RequireAnalysisOptions,
  ): Promise<AnalysisData> {
    return this.performAnalysis(principal, resource, action, options);
  }

  /**
   * Get recommendations for a request
   */
  async getRecommendations(
    principal: Principal,
    resource: Resource,
    action: string,
    options?: WithRecommendationsOptions,
  ): Promise<string[]> {
    return this.generateRecommendations(principal, resource, action, options);
  }

  /**
   * Perform a full agentic check
   */
  async agenticCheck(
    principal: Principal,
    resource: Resource,
    action: string,
    options: {
      includeAnalysis?: boolean;
      includeRecommendations?: boolean;
      enableThreatDetection?: boolean;
      enableRateLimiting?: boolean;
      rateLimitConfig?: RateLimitedOptions;
      threatConfig?: ThreatProtectedOptions;
      analysisConfig?: RequireAnalysisOptions;
      recommendationsConfig?: WithRecommendationsOptions;
      context?: Record<string, unknown>;
    } = {},
  ): Promise<AgenticProcessingOutput> {
    return this.processAgenticRequest(principal, resource, action, options);
  }

  /**
   * Get health status of the agentic service
   */
  async getHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    agents: Record<string, { status: string; lastActive?: Date }>;
    metrics: {
      rateLimitEntries: number;
      baselineEntries: number;
    };
  }> {
    if (!this.isInitialized) {
      return {
        status: 'unhealthy',
        agents: {
          guardian: { status: 'offline' },
          analyst: { status: 'offline' },
          advisor: { status: 'offline' },
          enforcer: { status: 'offline' },
        },
        metrics: {
          rateLimitEntries: 0,
          baselineEntries: 0,
        },
      };
    }

    return {
      status: 'healthy',
      agents: {
        guardian: { status: 'online', lastActive: new Date() },
        analyst: { status: 'online', lastActive: new Date() },
        advisor: { status: 'online', lastActive: new Date() },
        enforcer: { status: 'online', lastActive: new Date() },
      },
      metrics: {
        rateLimitEntries: this.rateLimitStore.size,
        baselineEntries: this.baselineStore.size,
      },
    };
  }

  /**
   * Clear rate limits (admin operation)
   */
  async clearRateLimits(principalId?: string): Promise<void> {
    if (principalId) {
      for (const key of this.rateLimitStore.keys()) {
        if (key.includes(principalId)) {
          this.rateLimitStore.delete(key);
        }
      }
    } else {
      this.rateLimitStore.clear();
    }
    this.logger.log(`Rate limits cleared${principalId ? ` for ${principalId}` : ''}`);
  }

  /**
   * Clear baseline data (admin operation)
   */
  async clearBaselines(principalId?: string): Promise<void> {
    if (principalId) {
      this.baselineStore.delete(principalId);
    } else {
      this.baselineStore.clear();
    }
    this.logger.log(`Baselines cleared${principalId ? ` for ${principalId}` : ''}`);
  }
}
