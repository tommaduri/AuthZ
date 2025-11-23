/**
 * ANALYST Agent - Pattern Learning & Policy Optimization
 *
 * Responsibilities:
 * - Learn access patterns from decision history
 * - Discover correlations (users who access X often access Y)
 * - Identify frequently denied requests (policy gaps)
 * - Suggest new policies based on patterns
 * - Recommend policy optimizations
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
} from '../types/agent.types.js';

export interface AnalystConfig {
  minSampleSize: number;
  confidenceThreshold: number;
  learningEnabled: boolean;
  patternDiscoveryIntervalMs: number;
  maxPatternsPerType: number;
}

interface PatternCandidate {
  type: PatternType;
  conditions: PatternCondition[];
  supportCount: number;
  confidence: number;
  examples: string[];
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
}
