/**
 * ANALYST Agent - Pattern Learning & Policy Optimization
 *
 * Responsibilities:
 * - Learn access patterns from decision history
 * - Discover correlations (users who access X often access Y)
 * - Identify frequently denied requests (policy gaps)
 * - Suggest new policies based on patterns
 * - Recommend policy optimizations
 * - Time-series analysis of access patterns
 * - Statistical anomaly detection
 * - User behavior profiling
 * - Resource access frequency tracking
 * - Risk score calculation based on multiple factors
 */

import { BaseAgent } from '../core/base-agent.js';
import type { DecisionStore } from '../core/decision-store.js';
import type { EventBus } from '../core/event-bus.js';
import type {
  AgentConfig,
  LearnedPattern,
  PatternType,
  PatternCondition,
  DecisionRecord,
  Priority,
  RiskFactor,
} from '../types/agent.types.js';

export interface AnalystConfig {
  minSampleSize: number;
  confidenceThreshold: number;
  learningEnabled: boolean;
  patternDiscoveryIntervalMs: number;
  maxPatternsPerType: number;
  // Enhanced configuration
  timeSeriesWindowHours: number;
  anomalyZScoreThreshold: number;
  behaviorProfileRetentionDays: number;
  riskWeights: RiskWeights;
}

/**
 * Configuration for risk score calculation weights
 */
export interface RiskWeights {
  anomalyScore: number;
  velocityDeviation: number;
  unusualTimeAccess: number;
  newResourceType: number;
  denialRate: number;
  privilegeEscalation: number;
}

interface PatternCandidate {
  type: PatternType;
  conditions: PatternCondition[];
  supportCount: number;
  confidence: number;
  examples: string[];
}

/**
 * Time-series data point for access analysis
 */
export interface TimeSeriesPoint {
  timestamp: Date;
  requestCount: number;
  denialCount: number;
  uniqueResources: number;
  uniqueActions: string[];
}

/**
 * User behavior profile for pattern analysis
 */
export interface UserBehaviorProfile {
  principalId: string;
  createdAt: Date;
  lastUpdated: Date;
  // Access timing patterns
  typicalAccessHours: number[];
  typicalAccessDays: number[];
  // Resource patterns
  commonResources: Map<string, number>;
  commonActions: Map<string, number>;
  // Statistical baselines
  avgRequestsPerHour: number;
  stdDevRequestsPerHour: number;
  avgUniqueResourcesPerDay: number;
  // Risk indicators
  historicalDenialRate: number;
  privilegeEscalationAttempts: number;
  // Behavior fingerprint
  behaviorHash: string;
}

/**
 * Resource access frequency tracking
 */
export interface ResourceAccessStats {
  resourceKind: string;
  totalAccesses: number;
  uniquePrincipals: number;
  accessByHour: Map<number, number>;
  accessByDayOfWeek: Map<number, number>;
  denialRate: number;
  avgAccessesPerPrincipal: number;
}

/**
 * Risk assessment result
 */
export interface RiskAssessment {
  requestId: string;
  principalId: string;
  resourceKind: string;
  action: string;
  timestamp: Date;
  // Overall risk score (0-1)
  riskScore: number;
  // Component scores
  components: {
    anomalyScore: number;
    velocityScore: number;
    temporalScore: number;
    resourceScore: number;
    behaviorScore: number;
  };
  // Risk factors identified
  riskFactors: RiskFactor[];
  // Risk level classification
  riskLevel: Priority;
  // Recommendations
  recommendations: string[];
}

export class AnalystAgent extends BaseAgent {
  private store: DecisionStore;
  private readonly eventBus: EventBus;

  /** Get event bus for testing */
  getEventBus(): EventBus { return this.eventBus; }
  private analystConfig: AnalystConfig;

  /** Get a dummy pattern candidate for type reference (unused, for future use) */
  static getPatternCandidateType(): PatternCandidate | null { return null; }

  // Learned patterns cache
  private patterns: Map<string, LearnedPattern> = new Map();
  private discoveryInterval: ReturnType<typeof setInterval> | null = null;

  // Enhanced analytics state
  private userProfiles: Map<string, UserBehaviorProfile> = new Map();
  private resourceStats: Map<string, ResourceAccessStats> = new Map();
  private timeSeriesCache: Map<string, TimeSeriesPoint[]> = new Map();

  // Default risk weights
  private static readonly DEFAULT_RISK_WEIGHTS: RiskWeights = {
    anomalyScore: 0.25,
    velocityDeviation: 0.20,
    unusualTimeAccess: 0.15,
    newResourceType: 0.15,
    denialRate: 0.15,
    privilegeEscalation: 0.10,
  };

  constructor(
    config: AgentConfig,
    store: DecisionStore,
    eventBus: EventBus,
  ) {
    super('analyst', 'ANALYST - Pattern Learning', config);
    this.store = store;
    this.eventBus = eventBus;
    this.analystConfig = {
      minSampleSize: config.analyst?.minSampleSize ?? 50,
      confidenceThreshold: config.analyst?.confidenceThreshold ?? 0.8,
      learningEnabled: config.analyst?.learningEnabled ?? true,
      patternDiscoveryIntervalMs: 60 * 60 * 1000, // 1 hour default
      maxPatternsPerType: 20,
      // Enhanced defaults
      timeSeriesWindowHours: 24,
      anomalyZScoreThreshold: 2.5,
      behaviorProfileRetentionDays: 90,
      riskWeights: AnalystAgent.DEFAULT_RISK_WEIGHTS,
    };
  }

  async initialize(): Promise<void> {
    this.state = 'initializing';
    this.log('info', 'Initializing ANALYST agent');

    // Load existing patterns
    // await this.loadPatterns();

    // Start pattern discovery if enabled
    if (this.analystConfig.learningEnabled) {
      this.startPatternDiscovery();
    }

    this.state = 'ready';
    this.log('info', 'ANALYST agent ready');
  }

  async shutdown(): Promise<void> {
    this.state = 'shutdown';
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
    }
    this.log('info', 'ANALYST agent shutting down');
  }

  /**
   * Run pattern discovery analysis
   */
  async discoverPatterns(): Promise<LearnedPattern[]> {
    const startTime = Date.now();
    this.state = 'processing';
    const discovered: LearnedPattern[] = [];

    try {
      this.log('info', 'Starting pattern discovery');

      // 1. Analyze denial patterns
      const denialPatterns = await this.analyzeDenialPatterns();
      discovered.push(...denialPatterns);

      // 2. Analyze access correlations
      const correlationPatterns = await this.analyzeAccessCorrelations();
      discovered.push(...correlationPatterns);

      // 3. Analyze temporal patterns
      const temporalPatterns = await this.analyzeTemporalPatterns();
      discovered.push(...temporalPatterns);

      // 4. Analyze role clusters
      const rolePatterns = await this.analyzeRoleClusters();
      discovered.push(...rolePatterns);

      // Store new patterns
      for (const pattern of discovered) {
        this.patterns.set(pattern.id, pattern);
        await this.store.storePattern(pattern);
        this.emitAgentEvent('pattern_discovered', pattern);
      }

      this.log('info', `Pattern discovery complete. Found ${discovered.length} patterns`);
      this.recordProcessing(Date.now() - startTime, true);
      this.incrementCustomMetric('patterns_discovered', discovered.length);

    } catch (error) {
      this.recordProcessing(Date.now() - startTime, false);
      this.recordError(error as Error);
    }

    this.state = 'ready';
    return discovered;
  }

  /**
   * Suggest policy based on learned patterns
   */
  async suggestPolicy(patternId: string): Promise<string | null> {
    const pattern = this.patterns.get(patternId);
    if (!pattern) return null;

    return this.generatePolicySuggestion(pattern);
  }

  /**
   * Get all discovered patterns
   */
  getPatterns(): LearnedPattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Validate a pattern manually
   */
  async validatePattern(
    patternId: string,
    isApproved: boolean,
    validatedBy: string,
  ): Promise<void> {
    const pattern = this.patterns.get(patternId);
    if (!pattern) return;

    pattern.validatedAt = new Date();
    pattern.validatedBy = validatedBy;
    pattern.isApproved = isApproved;

    await this.store.storePattern(pattern);
    this.emitAgentEvent('pattern_validated', { patternId, isApproved, validatedBy });
  }

  /**
   * Analyze patterns of frequently denied requests
   */
  private async analyzeDenialPatterns(): Promise<LearnedPattern[]> {
    const patterns: LearnedPattern[] = [];

    // Query recent denied decisions
    const deniedDecisions = await this.store.queryDecisions(
      {
        allowed: false,
        fromDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
      },
      { limit: 1000 },
    );

    if (deniedDecisions.length < this.analystConfig.minSampleSize) {
      return patterns;
    }

    // Group by resource+action
    const groups = this.groupDecisions(deniedDecisions, ['resource.kind', 'actions']);

    for (const [key, decisions] of groups) {
      if (decisions.length < this.analystConfig.minSampleSize * 0.1) continue;

      // Check if there's a common role across these denials
      const roleFrequency = this.countRoleFrequency(decisions);
      const dominantRole = this.findDominantValue(roleFrequency);

      if (dominantRole && dominantRole.frequency >= this.analystConfig.confidenceThreshold) {
        const [resourceKind, action] = key.split('|');
        patterns.push({
          id: `denial-${resourceKind}-${action}-${Date.now()}`,
          discoveredAt: new Date(),
          lastUpdated: new Date(),
          type: 'denial_pattern',
          confidence: dominantRole.frequency,
          sampleSize: decisions.length,
          description: `Users with role "${dominantRole.value}" are frequently denied "${action}" on "${resourceKind}"`,
          conditions: [
            { field: 'resource.kind', operator: 'eq', value: resourceKind },
            { field: 'action', operator: 'eq', value: action },
            { field: 'principal.roles', operator: 'contains', value: dominantRole.value },
          ],
          suggestedPolicyRule: this.generateDenialPolicyRule(resourceKind, action, dominantRole.value),
          isApproved: false,
        });
      }
    }

    return patterns;
  }

  /**
   * Analyze access correlations
   */
  private async analyzeAccessCorrelations(): Promise<LearnedPattern[]> {
    const patterns: LearnedPattern[] = [];

    // Query recent allowed decisions
    const decisions = await this.store.queryDecisions(
      {
        allowed: true,
        fromDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
      },
      { limit: 5000 },
    );

    if (decisions.length < this.analystConfig.minSampleSize) {
      return patterns;
    }

    // Group by principal
    const principalResources = new Map<string, Set<string>>();
    for (const decision of decisions) {
      const existing = principalResources.get(decision.principal.id) || new Set();
      existing.add(decision.resource.kind);
      principalResources.set(decision.principal.id, existing);
    }

    // Find co-occurrence patterns
    const coOccurrence = new Map<string, number>();
    const singleOccurrence = new Map<string, number>();

    for (const resources of principalResources.values()) {
      const resourceArray = Array.from(resources);

      for (const resource of resourceArray) {
        singleOccurrence.set(resource, (singleOccurrence.get(resource) || 0) + 1);
      }

      // Count pairs
      for (let i = 0; i < resourceArray.length; i++) {
        for (let j = i + 1; j < resourceArray.length; j++) {
          const pair = [resourceArray[i], resourceArray[j]].sort().join('|');
          coOccurrence.set(pair, (coOccurrence.get(pair) || 0) + 1);
        }
      }
    }

    // Find strong correlations
    for (const [pair, count] of coOccurrence) {
      const [resource1, resource2] = pair.split('|');
      const single1 = singleOccurrence.get(resource1) || 0;
      const single2 = singleOccurrence.get(resource2) || 0;

      // Calculate lift (how much more likely to occur together)
      const expectedCoOccurrence = (single1 * single2) / principalResources.size;
      const lift = count / expectedCoOccurrence;

      if (lift >= 2 && count >= this.analystConfig.minSampleSize * 0.2) {
        const confidence = count / Math.min(single1, single2);

        if (confidence >= this.analystConfig.confidenceThreshold) {
          patterns.push({
            id: `correlation-${resource1}-${resource2}-${Date.now()}`,
            discoveredAt: new Date(),
            lastUpdated: new Date(),
            type: 'access_correlation',
            confidence,
            sampleSize: count,
            description: `Users who access "${resource1}" often also access "${resource2}" (${Math.round(confidence * 100)}% correlation)`,
            conditions: [
              { field: 'resource.kind', operator: 'in', value: [resource1, resource2] },
            ],
            suggestedOptimization: `Consider caching authorization for both "${resource1}" and "${resource2}" together`,
            isApproved: false,
          });
        }
      }
    }

    return patterns;
  }

  /**
   * Analyze temporal access patterns
   */
  private async analyzeTemporalPatterns(): Promise<LearnedPattern[]> {
    const patterns: LearnedPattern[] = [];

    const decisions = await this.store.queryDecisions(
      { fromDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      { limit: 5000 },
    );

    if (decisions.length < this.analystConfig.minSampleSize) {
      return patterns;
    }

    // Group by hour of day
    const hourlyDistribution = new Map<number, number>();
    const weekdayDistribution = new Map<number, number>();

    for (const decision of decisions) {
      const hour = decision.timestamp.getHours();
      const day = decision.timestamp.getDay();

      hourlyDistribution.set(hour, (hourlyDistribution.get(hour) || 0) + 1);
      weekdayDistribution.set(day, (weekdayDistribution.get(day) || 0) + 1);
    }

    // Find peak hours
    const avgHourly = decisions.length / 24;
    const peakHours: number[] = [];

    for (const [hour, count] of hourlyDistribution) {
      if (count > avgHourly * 2) {
        peakHours.push(hour);
      }
    }

    if (peakHours.length > 0 && peakHours.length <= 8) {
      patterns.push({
        id: `temporal-peak-hours-${Date.now()}`,
        discoveredAt: new Date(),
        lastUpdated: new Date(),
        type: 'temporal_pattern',
        confidence: 0.9,
        sampleSize: decisions.length,
        description: `Peak authorization activity occurs during hours: ${peakHours.join(', ')}`,
        conditions: [
          { field: 'timestamp.hour', operator: 'in', value: peakHours },
        ],
        suggestedOptimization: 'Consider scaling authorization service during peak hours',
        isApproved: false,
      });
    }

    return patterns;
  }

  /**
   * Analyze role clusters
   */
  private async analyzeRoleClusters(): Promise<LearnedPattern[]> {
    const patterns: LearnedPattern[] = [];

    const decisions = await this.store.queryDecisions(
      {
        allowed: true,
        fromDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
      { limit: 5000 },
    );

    if (decisions.length < this.analystConfig.minSampleSize) {
      return patterns;
    }

    // Group by role → resources accessed
    const roleResources = new Map<string, Map<string, number>>();

    for (const decision of decisions) {
      for (const role of decision.principal.roles) {
        const resources = roleResources.get(role) || new Map();
        const current = resources.get(decision.resource.kind) || 0;
        resources.set(decision.resource.kind, current + 1);
        roleResources.set(role, resources);
      }
    }

    // Find role-specific resource concentrations
    for (const [role, resources] of roleResources) {
      const totalForRole = Array.from(resources.values()).reduce((a, b) => a + b, 0);

      if (totalForRole < this.analystConfig.minSampleSize) continue;

      // Find dominant resources for this role
      const dominant: { resource: string; percentage: number }[] = [];

      for (const [resource, count] of resources) {
        const percentage = count / totalForRole;
        if (percentage >= 0.3) {
          dominant.push({ resource, percentage });
        }
      }

      if (dominant.length > 0 && dominant.length <= 5) {
        patterns.push({
          id: `role-cluster-${role}-${Date.now()}`,
          discoveredAt: new Date(),
          lastUpdated: new Date(),
          type: 'role_cluster',
          confidence: Math.max(...dominant.map(d => d.percentage)),
          sampleSize: totalForRole,
          description: `Role "${role}" primarily accesses: ${dominant.map(d => `${d.resource} (${Math.round(d.percentage * 100)}%)`).join(', ')}`,
          conditions: [
            { field: 'principal.roles', operator: 'contains', value: role },
            { field: 'resource.kind', operator: 'in', value: dominant.map(d => d.resource) },
          ],
          suggestedPolicyRule: this.generateRoleClusterPolicy(role, dominant.map(d => d.resource)),
          isApproved: false,
        });
      }
    }

    return patterns;
  }

  private groupDecisions(
    decisions: DecisionRecord[],
    fields: string[],
  ): Map<string, DecisionRecord[]> {
    const groups = new Map<string, DecisionRecord[]>();

    for (const decision of decisions) {
      const keyParts: string[] = [];

      for (const field of fields) {
        const value = this.getFieldValue(decision, field);
        keyParts.push(String(value));
      }

      const key = keyParts.join('|');
      const existing = groups.get(key) || [];
      existing.push(decision);
      groups.set(key, existing);
    }

    return groups;
  }

  private getFieldValue(decision: DecisionRecord, field: string): unknown {
    const parts = field.split('.');
    let value: unknown = decision;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  private countRoleFrequency(decisions: DecisionRecord[]): Map<string, number> {
    const frequency = new Map<string, number>();

    for (const decision of decisions) {
      for (const role of decision.principal.roles) {
        frequency.set(role, (frequency.get(role) || 0) + 1);
      }
    }

    return frequency;
  }

  private findDominantValue(frequency: Map<string, number>): { value: string; frequency: number } | null {
    let dominant: { value: string; frequency: number } | null = null;
    const total = Array.from(frequency.values()).reduce((a, b) => a + b, 0);

    for (const [value, count] of frequency) {
      const freq = count / total;
      if (!dominant || freq > dominant.frequency) {
        dominant = { value, frequency: freq };
      }
    }

    return dominant;
  }

  private generateDenialPolicyRule(resourceKind: string, action: string, role: string): string {
    return `
# Suggested policy for frequently denied access
# Role "${role}" is often denied "${action}" on "${resourceKind}"
# Consider if this should be allowed with conditions

rules:
  - name: allow-${role}-${action}-${resourceKind}
    actions: [${action}]
    effect: allow
    roles: [${role}]
    # TODO: Add appropriate conditions
    # condition:
    #   expression: <add ownership or other check>
`.trim();
  }

  private generateRoleClusterPolicy(role: string, resources: string[]): string {
    return `
# Role "${role}" primarily accesses: ${resources.join(', ')}
# Consider creating a dedicated policy for this role

rules:
  - name: ${role}-standard-access
    actions: [view, list]
    effect: allow
    roles: [${role}]
    # This allows basic access to the role's typical resources
`.trim();
  }

  private generatePolicySuggestion(pattern: LearnedPattern): string {
    switch (pattern.type) {
      case 'denial_pattern':
        return pattern.suggestedPolicyRule || '# No policy suggestion available';
      case 'role_cluster':
        return pattern.suggestedPolicyRule || '# No policy suggestion available';
      default:
        return pattern.suggestedOptimization || '# No suggestion available';
    }
  }

  private startPatternDiscovery(): void {
    this.discoveryInterval = setInterval(() => {
      this.discoverPatterns().catch(error => {
        this.log('error', 'Pattern discovery failed', error);
      });
    }, this.analystConfig.patternDiscoveryIntervalMs);
  }

  // =============================================================================
  // TIME-SERIES ANALYSIS
  // =============================================================================

  /**
   * Analyze access patterns over time for a principal
   */
  async analyzeTimeSeries(
    principalId: string,
    windowHours: number = this.analystConfig.timeSeriesWindowHours,
  ): Promise<TimeSeriesPoint[]> {
    const startTime = Date.now();
    this.log('info', `Analyzing time series for principal ${principalId}`);

    try {
      const fromDate = new Date(Date.now() - windowHours * 60 * 60 * 1000);
      const decisions = await this.store.queryDecisions(
        { principalId, fromDate },
        { limit: 5000, orderBy: 'timestamp', orderDirection: 'asc' },
      );

      if (decisions.length === 0) {
        return [];
      }

      // Group decisions by hour
      const hourlyBuckets = new Map<string, DecisionRecord[]>();
      for (const decision of decisions) {
        const hourKey = this.getHourKey(decision.timestamp);
        const bucket = hourlyBuckets.get(hourKey) || [];
        bucket.push(decision);
        hourlyBuckets.set(hourKey, bucket);
      }

      // Convert to time series points
      const timeSeries: TimeSeriesPoint[] = [];
      for (const [hourKey, bucketDecisions] of hourlyBuckets) {
        const uniqueResources = new Set(bucketDecisions.map(d => d.resource.kind));
        const allActions = new Set<string>();
        let denialCount = 0;

        for (const d of bucketDecisions) {
          d.actions.forEach(a => allActions.add(a));
          const anyDenied = Object.values(d.results).some(r => !r.allowed);
          if (anyDenied) denialCount++;
        }

        timeSeries.push({
          timestamp: new Date(hourKey),
          requestCount: bucketDecisions.length,
          denialCount,
          uniqueResources: uniqueResources.size,
          uniqueActions: Array.from(allActions),
        });
      }

      // Sort by timestamp
      timeSeries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      // Cache the results
      this.timeSeriesCache.set(principalId, timeSeries);

      this.recordProcessing(Date.now() - startTime, true);
      this.incrementCustomMetric('time_series_analyses');

      return timeSeries;
    } catch (error) {
      this.recordProcessing(Date.now() - startTime, false);
      this.recordError(error as Error);
      throw error;
    }
  }

  /**
   * Detect anomalies in time series data using Z-score analysis
   */
  detectTimeSeriesAnomalies(
    timeSeries: TimeSeriesPoint[],
    threshold: number = this.analystConfig.anomalyZScoreThreshold,
  ): { point: TimeSeriesPoint; zScore: number; anomalyType: string }[] {
    if (timeSeries.length < 3) {
      return [];
    }

    const requestCounts = timeSeries.map(p => p.requestCount);
    const mean = this.calculateMean(requestCounts);
    const stdDev = this.calculateStdDev(requestCounts, mean);

    if (stdDev === 0) {
      return [];
    }

    const anomalies: { point: TimeSeriesPoint; zScore: number; anomalyType: string }[] = [];

    for (const point of timeSeries) {
      const zScore = Math.abs((point.requestCount - mean) / stdDev);

      if (zScore >= threshold) {
        const anomalyType = point.requestCount > mean ? 'velocity_spike' : 'activity_drop';
        anomalies.push({ point, zScore, anomalyType });
      }
    }

    return anomalies;
  }

  // =============================================================================
  // USER BEHAVIOR PROFILING
  // =============================================================================

  /**
   * Build or update a user behavior profile
   */
  async buildUserProfile(principalId: string): Promise<UserBehaviorProfile> {
    const startTime = Date.now();
    this.log('info', `Building behavior profile for principal ${principalId}`);

    try {
      const periodDays = this.analystConfig.behaviorProfileRetentionDays;
      const fromDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

      const decisions = await this.store.queryDecisions(
        { principalId, fromDate },
        { limit: 10000 },
      );

      if (decisions.length === 0) {
        const emptyProfile: UserBehaviorProfile = {
          principalId,
          createdAt: new Date(),
          lastUpdated: new Date(),
          typicalAccessHours: [],
          typicalAccessDays: [],
          commonResources: new Map(),
          commonActions: new Map(),
          avgRequestsPerHour: 0,
          stdDevRequestsPerHour: 0,
          avgUniqueResourcesPerDay: 0,
          historicalDenialRate: 0,
          privilegeEscalationAttempts: 0,
          behaviorHash: this.generateBehaviorHash([]),
        };
        return emptyProfile;
      }

      // Analyze access timing patterns
      const hourCounts = new Map<number, number>();
      const dayCounts = new Map<number, number>();
      const resourceCounts = new Map<string, number>();
      const actionCounts = new Map<string, number>();
      let totalDenials = 0;
      let privilegeEscalations = 0;

      // Group by hour for velocity analysis
      const hourlyRequestCounts: number[] = [];
      const hourBuckets = new Map<string, number>();

      for (const decision of decisions) {
        const hour = decision.timestamp.getHours();
        const day = decision.timestamp.getDay();
        const hourKey = this.getHourKey(decision.timestamp);

        // Count by hour and day
        hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
        dayCounts.set(day, (dayCounts.get(day) || 0) + 1);

        // Count resources and actions
        resourceCounts.set(
          decision.resource.kind,
          (resourceCounts.get(decision.resource.kind) || 0) + 1,
        );
        for (const action of decision.actions) {
          actionCounts.set(action, (actionCounts.get(action) || 0) + 1);
        }

        // Track denials
        const anyDenied = Object.values(decision.results).some(r => !r.allowed);
        if (anyDenied) {
          totalDenials++;
          // Check for privilege escalation patterns (admin/write denied)
          const sensitiveActions = ['admin', 'delete', 'write', 'execute'];
          if (decision.actions.some(a => sensitiveActions.includes(a))) {
            privilegeEscalations++;
          }
        }

        // Track hourly buckets
        hourBuckets.set(hourKey, (hourBuckets.get(hourKey) || 0) + 1);
      }

      // Calculate hourly statistics
      for (const count of hourBuckets.values()) {
        hourlyRequestCounts.push(count);
      }

      const avgRequestsPerHour = this.calculateMean(hourlyRequestCounts);
      const stdDevRequestsPerHour = this.calculateStdDev(hourlyRequestCounts, avgRequestsPerHour);

      // Find typical access hours (above average)
      const avgHourCount = decisions.length / 24;
      const typicalAccessHours: number[] = [];
      for (const [hour, count] of hourCounts) {
        if (count > avgHourCount * 0.5) {
          typicalAccessHours.push(hour);
        }
      }

      // Find typical access days
      const avgDayCount = decisions.length / 7;
      const typicalAccessDays: number[] = [];
      for (const [day, count] of dayCounts) {
        if (count > avgDayCount * 0.5) {
          typicalAccessDays.push(day);
        }
      }

      // Calculate average unique resources per day
      const uniqueResourcesByDay = new Map<string, Set<string>>();
      for (const decision of decisions) {
        const dayKey = decision.timestamp.toISOString().slice(0, 10);
        const resources = uniqueResourcesByDay.get(dayKey) || new Set();
        resources.add(decision.resource.kind);
        uniqueResourcesByDay.set(dayKey, resources);
      }
      const dailyResourceCounts = Array.from(uniqueResourcesByDay.values()).map(s => s.size);
      const avgUniqueResourcesPerDay = this.calculateMean(dailyResourceCounts);

      const profile: UserBehaviorProfile = {
        principalId,
        createdAt: this.userProfiles.get(principalId)?.createdAt || new Date(),
        lastUpdated: new Date(),
        typicalAccessHours: typicalAccessHours.sort((a, b) => a - b),
        typicalAccessDays: typicalAccessDays.sort((a, b) => a - b),
        commonResources: resourceCounts,
        commonActions: actionCounts,
        avgRequestsPerHour,
        stdDevRequestsPerHour,
        avgUniqueResourcesPerDay,
        historicalDenialRate: decisions.length > 0 ? totalDenials / decisions.length : 0,
        privilegeEscalationAttempts: privilegeEscalations,
        behaviorHash: this.generateBehaviorHash(Array.from(resourceCounts.keys())),
      };

      // Cache the profile
      this.userProfiles.set(principalId, profile);

      this.recordProcessing(Date.now() - startTime, true);
      this.incrementCustomMetric('profiles_built');
      this.emitAgentEvent('pattern_discovered', {
        type: 'user_profile',
        principalId,
        profile: this.serializeProfile(profile),
      });

      return profile;
    } catch (error) {
      this.recordProcessing(Date.now() - startTime, false);
      this.recordError(error as Error);
      throw error;
    }
  }

  /**
   * Get cached user profile or build new one
   */
  async getUserProfile(principalId: string): Promise<UserBehaviorProfile> {
    const cached = this.userProfiles.get(principalId);

    // Return cached if fresh (less than 1 hour old)
    if (cached && Date.now() - cached.lastUpdated.getTime() < 60 * 60 * 1000) {
      return cached;
    }

    return this.buildUserProfile(principalId);
  }

  // =============================================================================
  // RESOURCE ACCESS FREQUENCY TRACKING
  // =============================================================================

  /**
   * Track and analyze resource access patterns
   */
  async trackResourceAccess(resourceKind: string): Promise<ResourceAccessStats> {
    const startTime = Date.now();
    this.log('info', `Tracking resource access for ${resourceKind}`);

    try {
      const fromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Last 30 days

      const decisions = await this.store.queryDecisions(
        { resourceKind, fromDate },
        { limit: 10000 },
      );

      if (decisions.length === 0) {
        const emptyStats: ResourceAccessStats = {
          resourceKind,
          totalAccesses: 0,
          uniquePrincipals: 0,
          accessByHour: new Map(),
          accessByDayOfWeek: new Map(),
          denialRate: 0,
          avgAccessesPerPrincipal: 0,
        };
        return emptyStats;
      }

      const uniquePrincipals = new Set<string>();
      const accessByHour = new Map<number, number>();
      const accessByDayOfWeek = new Map<number, number>();
      let totalDenials = 0;

      for (const decision of decisions) {
        uniquePrincipals.add(decision.principal.id);

        const hour = decision.timestamp.getHours();
        const day = decision.timestamp.getDay();

        accessByHour.set(hour, (accessByHour.get(hour) || 0) + 1);
        accessByDayOfWeek.set(day, (accessByDayOfWeek.get(day) || 0) + 1);

        const anyDenied = Object.values(decision.results).some(r => !r.allowed);
        if (anyDenied) totalDenials++;
      }

      const stats: ResourceAccessStats = {
        resourceKind,
        totalAccesses: decisions.length,
        uniquePrincipals: uniquePrincipals.size,
        accessByHour,
        accessByDayOfWeek,
        denialRate: decisions.length > 0 ? totalDenials / decisions.length : 0,
        avgAccessesPerPrincipal: decisions.length / uniquePrincipals.size,
      };

      // Cache the stats
      this.resourceStats.set(resourceKind, stats);

      this.recordProcessing(Date.now() - startTime, true);
      this.incrementCustomMetric('resources_tracked');

      return stats;
    } catch (error) {
      this.recordProcessing(Date.now() - startTime, false);
      this.recordError(error as Error);
      throw error;
    }
  }

  /**
   * Get resource access statistics
   */
  getResourceStats(resourceKind: string): ResourceAccessStats | undefined {
    return this.resourceStats.get(resourceKind);
  }

  // =============================================================================
  // RISK SCORE CALCULATION
  // =============================================================================

  /**
   * Calculate comprehensive risk score for a decision
   */
  async calculateRiskScore(decision: DecisionRecord): Promise<RiskAssessment> {
    const startTime = Date.now();
    this.log('debug', `Calculating risk score for decision ${decision.id}`);

    try {
      const weights = this.analystConfig.riskWeights;
      const riskFactors: RiskFactor[] = [];
      const recommendations: string[] = [];

      // Get user profile for comparison
      const profile = await this.getUserProfile(decision.principal.id);

      // 1. Anomaly Score Component
      const anomalyScore = this.calculateAnomalyComponent(decision, profile);
      if (anomalyScore > 0.5) {
        riskFactors.push({
          type: 'behavioral_anomaly',
          severity: anomalyScore > 0.8 ? 'high' : 'medium',
          description: 'Request deviates from established behavioral patterns',
          evidence: { score: anomalyScore, baseline: profile.behaviorHash },
        });
      }

      // 2. Velocity Deviation Component
      const velocityScore = await this.calculateVelocityComponent(decision, profile);
      if (velocityScore > 0.5) {
        riskFactors.push({
          type: 'velocity_anomaly',
          severity: velocityScore > 0.8 ? 'critical' : 'high',
          description: 'Request rate exceeds normal baseline',
          evidence: {
            currentRate: velocityScore,
            avgRate: profile.avgRequestsPerHour,
            stdDev: profile.stdDevRequestsPerHour,
          },
        });
        recommendations.push('Consider implementing rate limiting for this principal');
      }

      // 3. Temporal Score Component
      const temporalScore = this.calculateTemporalComponent(decision, profile);
      if (temporalScore > 0.5) {
        riskFactors.push({
          type: 'unusual_time',
          severity: 'medium',
          description: 'Access occurring outside typical hours',
          evidence: {
            accessHour: decision.timestamp.getHours(),
            typicalHours: profile.typicalAccessHours,
          },
        });
      }

      // 4. Resource Score Component
      const resourceScore = this.calculateResourceComponent(decision, profile);
      if (resourceScore > 0.5) {
        riskFactors.push({
          type: 'new_resource',
          severity: resourceScore > 0.8 ? 'high' : 'medium',
          description: 'Accessing resource type not commonly used by this principal',
          evidence: {
            resourceKind: decision.resource.kind,
            commonResources: Array.from(profile.commonResources.keys()),
          },
        });
        recommendations.push('Verify principal requires access to this resource type');
      }

      // 5. Behavior Score Component
      const behaviorScore = this.calculateBehaviorComponent(decision, profile);
      if (behaviorScore > 0.5) {
        riskFactors.push({
          type: 'behavior_deviation',
          severity: behaviorScore > 0.8 ? 'high' : 'medium',
          description: 'Action pattern differs from historical behavior',
          evidence: {
            actions: decision.actions,
            commonActions: Array.from(profile.commonActions.keys()),
            denialRate: profile.historicalDenialRate,
          },
        });
      }

      // Calculate weighted overall risk score
      const riskScore = Math.min(1, Math.max(0,
        anomalyScore * weights.anomalyScore +
        velocityScore * weights.velocityDeviation +
        temporalScore * weights.unusualTimeAccess +
        resourceScore * weights.newResourceType +
        behaviorScore * (weights.denialRate + weights.privilegeEscalation),
      ));

      // Determine risk level
      let riskLevel: Priority;
      if (riskScore >= 0.8) {
        riskLevel = 'critical';
        recommendations.push('Recommend immediate review by security team');
      } else if (riskScore >= 0.6) {
        riskLevel = 'high';
        recommendations.push('Enhanced monitoring recommended');
      } else if (riskScore >= 0.4) {
        riskLevel = 'medium';
      } else {
        riskLevel = 'low';
      }

      const assessment: RiskAssessment = {
        requestId: decision.requestId,
        principalId: decision.principal.id,
        resourceKind: decision.resource.kind,
        action: decision.actions[0] || 'unknown',
        timestamp: decision.timestamp,
        riskScore,
        components: {
          anomalyScore,
          velocityScore,
          temporalScore,
          resourceScore,
          behaviorScore,
        },
        riskFactors,
        riskLevel,
        recommendations,
      };

      this.recordProcessing(Date.now() - startTime, true);
      this.incrementCustomMetric('risk_assessments');

      // Emit event for high-risk assessments
      if (riskLevel === 'critical' || riskLevel === 'high') {
        this.emitAgentEvent('pattern_discovered', {
          type: 'high_risk_assessment',
          assessment: {
            ...assessment,
            components: assessment.components,
          },
        });
      }

      return assessment;
    } catch (error) {
      this.recordProcessing(Date.now() - startTime, false);
      this.recordError(error as Error);
      throw error;
    }
  }

  /**
   * Calculate anomaly component score
   */
  private calculateAnomalyComponent(
    decision: DecisionRecord,
    profile: UserBehaviorProfile,
  ): number {
    if (!profile.commonResources.size) {
      return 0.5; // Unknown user, moderate risk
    }

    let anomalyPoints = 0;
    let totalChecks = 0;

    // Check if resource is unusual
    const resourceCount = profile.commonResources.get(decision.resource.kind) || 0;
    const totalResourceAccess = Array.from(profile.commonResources.values())
      .reduce((sum, c) => sum + c, 0);
    const resourceRatio = totalResourceAccess > 0 ? resourceCount / totalResourceAccess : 0;

    totalChecks++;
    if (resourceRatio < 0.05) {
      anomalyPoints++; // Rarely or never accessed this resource type
    }

    // Check if actions are unusual
    for (const action of decision.actions) {
      const actionCount = profile.commonActions.get(action) || 0;
      const totalActions = Array.from(profile.commonActions.values())
        .reduce((sum, c) => sum + c, 0);
      const actionRatio = totalActions > 0 ? actionCount / totalActions : 0;

      totalChecks++;
      if (actionRatio < 0.05) {
        anomalyPoints++; // Rarely or never performed this action
      }
    }

    return totalChecks > 0 ? anomalyPoints / totalChecks : 0;
  }

  /**
   * Calculate velocity deviation component
   */
  private async calculateVelocityComponent(
    decision: DecisionRecord,
    profile: UserBehaviorProfile,
  ): Promise<number> {
    if (profile.avgRequestsPerHour === 0 || profile.stdDevRequestsPerHour === 0) {
      return 0; // Not enough data
    }

    // Get recent request count for this hour
    const hourKey = this.getHourKey(decision.timestamp);
    const timeSeries = this.timeSeriesCache.get(decision.principal.id);

    if (!timeSeries) {
      return 0;
    }

    const currentHourPoint = timeSeries.find(
      p => this.getHourKey(p.timestamp) === hourKey,
    );

    if (!currentHourPoint) {
      return 0;
    }

    // Calculate Z-score
    const zScore = Math.abs(
      (currentHourPoint.requestCount - profile.avgRequestsPerHour) /
      profile.stdDevRequestsPerHour,
    );

    // Normalize to 0-1 range
    return Math.min(1, zScore / (this.analystConfig.anomalyZScoreThreshold * 2));
  }

  /**
   * Calculate temporal anomaly component
   */
  private calculateTemporalComponent(
    decision: DecisionRecord,
    profile: UserBehaviorProfile,
  ): number {
    if (profile.typicalAccessHours.length === 0) {
      return 0; // No baseline established
    }

    const accessHour = decision.timestamp.getHours();
    const accessDay = decision.timestamp.getDay();

    let temporalScore = 0;

    // Check hour anomaly
    if (!profile.typicalAccessHours.includes(accessHour)) {
      temporalScore += 0.5;
    }

    // Check day anomaly
    if (profile.typicalAccessDays.length > 0 &&
        !profile.typicalAccessDays.includes(accessDay)) {
      temporalScore += 0.5;
    }

    return Math.min(1, temporalScore);
  }

  /**
   * Calculate resource access component
   */
  private calculateResourceComponent(
    decision: DecisionRecord,
    profile: UserBehaviorProfile,
  ): number {
    if (!profile.commonResources.size) {
      return 0.3; // Unknown user, moderate baseline
    }

    const resourceKind = decision.resource.kind;
    const accessCount = profile.commonResources.get(resourceKind) || 0;

    if (accessCount === 0) {
      return 1; // Never accessed this resource type before
    }

    const totalAccess = Array.from(profile.commonResources.values())
      .reduce((sum, c) => sum + c, 0);
    const ratio = accessCount / totalAccess;

    // Lower ratio = higher risk score
    return Math.max(0, 1 - ratio * 10);
  }

  /**
   * Calculate behavior deviation component
   */
  private calculateBehaviorComponent(
    decision: DecisionRecord,
    profile: UserBehaviorProfile,
  ): number {
    let behaviorScore = 0;

    // Factor in historical denial rate
    if (profile.historicalDenialRate > 0.2) {
      behaviorScore += 0.3;
    } else if (profile.historicalDenialRate > 0.1) {
      behaviorScore += 0.15;
    }

    // Factor in privilege escalation attempts
    if (profile.privilegeEscalationAttempts > 10) {
      behaviorScore += 0.4;
    } else if (profile.privilegeEscalationAttempts > 5) {
      behaviorScore += 0.2;
    }

    // Check if current action is sensitive
    const sensitiveActions = ['admin', 'delete', 'write', 'execute', 'modify'];
    if (decision.actions.some(a => sensitiveActions.includes(a))) {
      behaviorScore += 0.3;
    }

    return Math.min(1, behaviorScore);
  }

  // =============================================================================
  // STATISTICAL ANOMALY DETECTION
  // =============================================================================

  /**
   * Perform statistical anomaly detection on decision patterns
   */
  async detectStatisticalAnomalies(
    principalId?: string,
    windowHours: number = 24,
  ): Promise<{
    anomalies: { type: string; score: number; evidence: Record<string, unknown> }[];
    summary: {
      totalDecisions: number;
      anomalyCount: number;
      avgAnomalyScore: number;
    };
  }> {
    const startTime = Date.now();
    this.log('info', 'Performing statistical anomaly detection');

    try {
      const fromDate = new Date(Date.now() - windowHours * 60 * 60 * 1000);
      const query = principalId ? { principalId, fromDate } : { fromDate };

      const decisions = await this.store.queryDecisions(query, { limit: 5000 });

      if (decisions.length === 0) {
        return {
          anomalies: [],
          summary: { totalDecisions: 0, anomalyCount: 0, avgAnomalyScore: 0 },
        };
      }

      const anomalies: { type: string; score: number; evidence: Record<string, unknown> }[] = [];

      // 1. Request volume anomaly detection
      const volumeAnomalies = this.detectVolumeAnomalies(decisions);
      anomalies.push(...volumeAnomalies);

      // 2. Denial pattern anomaly detection
      const denialAnomalies = this.detectDenialAnomalies(decisions);
      anomalies.push(...denialAnomalies);

      // 3. Resource diversity anomaly detection
      const resourceAnomalies = this.detectResourceDiversityAnomalies(decisions);
      anomalies.push(...resourceAnomalies);

      const avgAnomalyScore = anomalies.length > 0
        ? anomalies.reduce((sum, a) => sum + a.score, 0) / anomalies.length
        : 0;

      this.recordProcessing(Date.now() - startTime, true);
      this.incrementCustomMetric('anomaly_detections');

      return {
        anomalies,
        summary: {
          totalDecisions: decisions.length,
          anomalyCount: anomalies.length,
          avgAnomalyScore,
        },
      };
    } catch (error) {
      this.recordProcessing(Date.now() - startTime, false);
      this.recordError(error as Error);
      throw error;
    }
  }

  /**
   * Detect volume-based anomalies
   */
  private detectVolumeAnomalies(
    decisions: DecisionRecord[],
  ): { type: string; score: number; evidence: Record<string, unknown> }[] {
    const anomalies: { type: string; score: number; evidence: Record<string, unknown> }[] = [];

    // Group by principal
    const principalCounts = new Map<string, number>();
    for (const d of decisions) {
      principalCounts.set(d.principal.id, (principalCounts.get(d.principal.id) || 0) + 1);
    }

    const counts = Array.from(principalCounts.values());
    const mean = this.calculateMean(counts);
    const stdDev = this.calculateStdDev(counts, mean);

    if (stdDev === 0) return anomalies;

    for (const [principalId, count] of principalCounts) {
      const zScore = (count - mean) / stdDev;
      if (zScore > this.analystConfig.anomalyZScoreThreshold) {
        anomalies.push({
          type: 'volume_spike',
          score: Math.min(1, zScore / 5),
          evidence: {
            principalId,
            requestCount: count,
            mean,
            stdDev,
            zScore,
          },
        });
      }
    }

    return anomalies;
  }

  /**
   * Detect denial pattern anomalies
   */
  private detectDenialAnomalies(
    decisions: DecisionRecord[],
  ): { type: string; score: number; evidence: Record<string, unknown> }[] {
    const anomalies: { type: string; score: number; evidence: Record<string, unknown> }[] = [];

    // Group denials by principal
    const principalDenials = new Map<string, number>();
    const principalTotal = new Map<string, number>();

    for (const d of decisions) {
      principalTotal.set(d.principal.id, (principalTotal.get(d.principal.id) || 0) + 1);
      const anyDenied = Object.values(d.results).some(r => !r.allowed);
      if (anyDenied) {
        principalDenials.set(d.principal.id, (principalDenials.get(d.principal.id) || 0) + 1);
      }
    }

    for (const [principalId, denials] of principalDenials) {
      const total = principalTotal.get(principalId) || 1;
      const denialRate = denials / total;

      if (denialRate > 0.5 && denials > 5) {
        anomalies.push({
          type: 'high_denial_rate',
          score: Math.min(1, denialRate),
          evidence: {
            principalId,
            denials,
            total,
            denialRate,
          },
        });
      }
    }

    return anomalies;
  }

  /**
   * Detect resource diversity anomalies
   */
  private detectResourceDiversityAnomalies(
    decisions: DecisionRecord[],
  ): { type: string; score: number; evidence: Record<string, unknown> }[] {
    const anomalies: { type: string; score: number; evidence: Record<string, unknown> }[] = [];

    // Group unique resources by principal
    const principalResources = new Map<string, Set<string>>();
    for (const d of decisions) {
      const resources = principalResources.get(d.principal.id) || new Set();
      resources.add(d.resource.kind);
      principalResources.set(d.principal.id, resources);
    }

    const diversityCounts = Array.from(principalResources.values()).map(s => s.size);
    const mean = this.calculateMean(diversityCounts);
    const stdDev = this.calculateStdDev(diversityCounts, mean);

    if (stdDev === 0) return anomalies;

    for (const [principalId, resources] of principalResources) {
      const zScore = (resources.size - mean) / stdDev;
      if (zScore > this.analystConfig.anomalyZScoreThreshold) {
        anomalies.push({
          type: 'resource_diversity_spike',
          score: Math.min(1, zScore / 5),
          evidence: {
            principalId,
            uniqueResources: resources.size,
            resourceKinds: Array.from(resources),
            mean,
            stdDev,
            zScore,
          },
        });
      }
    }

    return anomalies;
  }

  // =============================================================================
  // HELPER METHODS
  // =============================================================================

  /**
   * Get hour key for time series bucketing
   */
  private getHourKey(date: Date): string {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
    ).toISOString();
  }

  /**
   * Calculate mean of an array
   */
  private calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  /**
   * Calculate standard deviation
   */
  private calculateStdDev(values: number[], mean?: number): number {
    if (values.length < 2) return 0;
    const m = mean ?? this.calculateMean(values);
    const squaredDiffs = values.map(v => Math.pow(v - m, 2));
    const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * Generate a behavior hash for fingerprinting
   */
  private generateBehaviorHash(resources: string[]): string {
    const sorted = resources.sort().join('|');
    let hash = 0;
    for (let i = 0; i < sorted.length; i++) {
      const char = sorted.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  /**
   * Serialize profile for event emission (convert Maps to objects)
   */
  private serializeProfile(
    profile: UserBehaviorProfile,
  ): Record<string, unknown> {
    return {
      ...profile,
      commonResources: Object.fromEntries(profile.commonResources),
      commonActions: Object.fromEntries(profile.commonActions),
    };
  }

  /**
   * Get all cached user profiles
   */
  getUserProfiles(): Map<string, UserBehaviorProfile> {
    return new Map(this.userProfiles);
  }

  /**
   * Get all cached resource statistics
   */
  getResourceStatistics(): Map<string, ResourceAccessStats> {
    return new Map(this.resourceStats);
  }

  /**
   * Clear analysis caches
   */
  clearCaches(): void {
    this.userProfiles.clear();
    this.resourceStats.clear();
    this.timeSeriesCache.clear();
    this.log('info', 'Analysis caches cleared');
  }
}
