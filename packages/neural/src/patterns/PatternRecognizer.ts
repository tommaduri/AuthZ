/**
 * PatternRecognizer - Anomaly detection and behavioral analysis for authorization
 *
 * Detects anomalous access patterns, temporal violations, behavioral deviations,
 * and privilege escalation attempts.
 */

import type {
  PatternRecognizerConfig,
  BehaviorProfile,
  FeatureInput,
  FeatureVector,
  DecisionRecord,
  AnomalyResult,
  AnomalyFactor,
  AnomalyCategory,
  TemporalPattern,
  PrivilegeEscalationPattern,
  ResourceFrequency,
  ActionFrequency,
  VelocityProfile,
  PatternDetector,
} from './types.js';

export class PatternRecognizer {
  private config: PatternRecognizerConfig;
  private _customDetectors: PatternDetector[];

  constructor(config: PatternRecognizerConfig) {
    this.config = { ...config };
    this._customDetectors = config.customDetectors ?? [];
  }

  /**
   * Get custom pattern detectors
   */
  getCustomDetectors(): PatternDetector[] {
    return this._customDetectors;
  }

  /**
   * Get current configuration
   */
  getConfig(): PatternRecognizerConfig {
    return { ...this.config };
  }

  /**
   * Extract features from an authorization request
   */
  extractFeatures(input: FeatureInput): FeatureVector {
    const features: number[] = [];
    const names: string[] = [];

    // Temporal features
    const hour = input.timestamp.getHours();
    const dayOfWeek = input.timestamp.getDay();

    features.push(hour);
    names.push('hour_of_day');

    features.push(dayOfWeek);
    names.push('day_of_week');

    // Is weekend
    features.push(dayOfWeek === 0 || dayOfWeek === 6 ? 1 : 0);
    names.push('is_weekend');

    // Is business hours (9-17)
    features.push(hour >= 9 && hour <= 17 ? 1 : 0);
    names.push('is_business_hours');

    // Role features
    const roleCount = input.principal.roles.length;
    features.push(roleCount);
    names.push('role_count');

    // Has admin role
    const hasAdmin = input.principal.roles.some(
      (r) => r.toLowerCase().includes('admin') || r.toLowerCase().includes('super')
    );
    features.push(hasAdmin ? 1 : 0);
    names.push('has_admin_role');

    // Action features
    const actionCount = input.actions.length;
    features.push(actionCount);
    names.push('action_count');

    // Has write action
    const hasWrite = input.actions.some((a) =>
      ['write', 'update', 'create', 'delete', 'modify'].includes(a.toLowerCase())
    );
    features.push(hasWrite ? 1 : 0);
    names.push('has_write_action');

    // Has delete action
    const hasDelete = input.actions.some((a) =>
      ['delete', 'remove', 'destroy'].includes(a.toLowerCase())
    );
    features.push(hasDelete ? 1 : 0);
    names.push('has_delete_action');

    // Resource features
    const resourceKindHash = this.hashString(input.resource.kind) % 100;
    features.push(resourceKindHash);
    names.push('resource_kind_hash');

    // Is sensitive resource
    const sensitiveKeywords = ['admin', 'secret', 'credential', 'password', 'key', 'token'];
    const isSensitive = sensitiveKeywords.some(
      (k) =>
        input.resource.kind.toLowerCase().includes(k) ||
        input.resource.id.toLowerCase().includes(k)
    );
    features.push(isSensitive ? 1 : 0);
    names.push('is_sensitive_resource');

    // Velocity features (if history available)
    if (input.history && input.history.length > 0) {
      const oneHourAgo = new Date(input.timestamp.getTime() - 3600000);
      const recentRequests = input.history.filter(
        (h) => new Date(h.timestamp) >= oneHourAgo
      ).length;
      features.push(recentRequests);
      names.push('requests_last_hour');
    } else {
      features.push(0);
      names.push('requests_last_hour');
    }

    return { values: features, names };
  }

  /**
   * Detect anomalies in an authorization request
   */
  async detectAnomaly(
    input: FeatureInput,
    profile: BehaviorProfile
  ): Promise<AnomalyResult> {
    const factors: AnomalyFactor[] = [];
    let totalScore = 0;
    let factorCount = 0;

    // Check temporal anomaly
    const temporalAnomaly = await this.detectTemporalAnomaly(input, profile);
    if (temporalAnomaly) {
      const temporalScore = Math.min(temporalAnomaly.confidence, 1);
      factors.push({
        name: 'time_violation',
        contribution: temporalScore,
        description: `Access at unusual time: ${input.timestamp.getHours()}:00`,
        expected: profile.accessTimes.peakHours,
        observed: input.timestamp.getHours(),
      });
      totalScore += temporalScore;
      factorCount++;
    }

    // Check resource anomaly
    const resourceAnomaly = this.checkResourceAnomaly(input, profile);
    if (resourceAnomaly.isAnomaly) {
      factors.push({
        name: 'resource_anomaly',
        contribution: resourceAnomaly.score,
        description: `Access to unfamiliar resource type: ${input.resource.kind}`,
        expected: profile.frequentResources.map((r) => r.resourceKind),
        observed: input.resource.kind,
      });
      totalScore += resourceAnomaly.score;
      factorCount++;
    }

    // Check action anomaly
    const actionAnomaly = this.checkActionAnomaly(input, profile);
    if (actionAnomaly.isAnomaly) {
      factors.push({
        name: 'unusual_action',
        contribution: actionAnomaly.score,
        description: `Unusual action(s): ${input.actions.join(', ')}`,
        expected: profile.typicalActions.map((a) => a.action),
        observed: input.actions,
      });
      totalScore += actionAnomaly.score;
      factorCount++;
    }

    // Check velocity anomaly
    if (input.history) {
      const velocityAnomaly = this.checkVelocityAnomaly(input, profile);
      if (velocityAnomaly.isAnomaly) {
        factors.push({
          name: 'rate_anomaly',
          contribution: velocityAnomaly.score,
          description: `Unusual request velocity: ${velocityAnomaly.observedVelocity} req/hr`,
          expected: profile.accessVelocity.averagePerHour,
          observed: velocityAnomaly.observedVelocity,
        });
        totalScore += velocityAnomaly.score;
        factorCount++;
      }
    }

    // Calculate final score (average of factors)
    const finalScore = factorCount > 0 ? totalScore / factorCount : 0;
    const isAnomaly = finalScore >= this.config.anomalyThreshold;

    // Determine primary category
    let category: AnomalyCategory = 'behavioral_deviation';
    if (factors.length > 0) {
      const topFactor = factors.sort((a, b) => b.contribution - a.contribution)[0];
      if (topFactor.name === 'time_violation') category = 'time_violation';
      else if (topFactor.name === 'resource_anomaly') category = 'resource_anomaly';
      else if (topFactor.name === 'rate_anomaly') category = 'rate_anomaly';
    }

    // Generate recommendations
    const recommendations = this.generateRecommendations(factors, finalScore);

    return {
      score: finalScore,
      isAnomaly,
      confidence: Math.min(profile.observationCount / this.config.minObservations, 1),
      category,
      factors,
      recommendations,
    };
  }

  /**
   * Detect temporal anomalies (access outside normal hours)
   */
  async detectTemporalAnomaly(
    input: FeatureInput,
    profile: BehaviorProfile
  ): Promise<TemporalPattern | null> {
    const hour = input.timestamp.getHours();
    const dayOfWeek = input.timestamp.getDay();

    // Check hourly distribution
    const hourlyProb = profile.accessTimes.hourlyDistribution[hour] || 0;
    const dailyProb = profile.accessTimes.dailyDistribution[dayOfWeek] || 0;

    // Low probability = anomalous
    const isOffPeak = profile.accessTimes.offPeakHours.includes(hour);
    const isUnusualDay = dailyProb < 0.05;

    if (hourlyProb < 0.02 || isOffPeak || isUnusualDay) {
      // Calculate deviation from expected window
      const peakHours = profile.accessTimes.peakHours;
      let minDeviation = 24;
      for (const peakHour of peakHours) {
        const deviation = Math.min(
          Math.abs(hour - peakHour),
          24 - Math.abs(hour - peakHour)
        );
        minDeviation = Math.min(minDeviation, deviation);
      }

      const confidence = Math.min(1 - hourlyProb - dailyProb + 0.2, 1);

      return {
        id: `temporal-${Date.now()}`,
        type: 'temporal',
        confidence,
        features: [hour, dayOfWeek, hourlyProb, dailyProb],
        metadata: { isOffPeak, isUnusualDay },
        detectedAt: new Date(),
        accessTime: input.timestamp,
        expectedWindow: {
          startHour: Math.min(...peakHours),
          endHour: Math.max(...peakHours),
          daysOfWeek: profile.accessTimes.dailyDistribution
            .map((p, i) => (p > 0.1 ? i : -1))
            .filter((i) => i >= 0),
        },
        deviation: minDeviation,
        dayOfWeek,
      };
    }

    return null;
  }

  /**
   * Detect privilege escalation attempts
   */
  async detectPrivilegeEscalation(
    input: FeatureInput,
    profile: BehaviorProfile
  ): Promise<PrivilegeEscalationPattern | null> {
    if (!this.config.enablePrivilegeEscalation) return null;

    // Check if accessing sensitive resource without proper history
    const sensitiveKeywords = ['admin', 'settings', 'config', 'secret', 'credential'];
    const isSensitiveResource = sensitiveKeywords.some(
      (k) =>
        input.resource.kind.toLowerCase().includes(k) ||
        input.resource.id.toLowerCase().includes(k)
    );

    if (!isSensitiveResource) return null;

    // Check if user has accessed this type before
    const hasAccessedSimilar = profile.frequentResources.some(
      (r) => r.resourceKind === input.resource.kind ||
             sensitiveKeywords.some((k) => r.resourceKind.toLowerCase().includes(k))
    );

    // Check if user has admin roles
    const hasAdminRole = input.principal.roles.some(
      (r) => r.toLowerCase().includes('admin') || r.toLowerCase().includes('super')
    );

    if (!hasAccessedSimilar && !hasAdminRole) {
      // Potential privilege escalation
      const riskScore = 0.85; // High risk for sensitive resource without history

      return {
        id: `priv-esc-${Date.now()}`,
        type: 'privilege_escalation',
        confidence: 0.9,
        features: [hasAccessedSimilar ? 1 : 0, hasAdminRole ? 1 : 0],
        metadata: { sensitiveResource: input.resource.kind },
        detectedAt: new Date(),
        originalRoles: input.principal.roles,
        attemptedRoles: input.resource.attributes['requiredRole']
          ? [String(input.resource.attributes['requiredRole'])]
          : ['admin'],
        sensitiveResources: [input.resource.kind],
        riskScore,
      };
    }

    return null;
  }

  /**
   * Build a behavior profile from decision records
   */
  async buildProfile(records: DecisionRecord[]): Promise<BehaviorProfile> {
    if (records.length === 0) {
      throw new Error('Cannot build profile from empty records');
    }

    const principalId = records[0].principal.id;

    // Calculate time distribution
    const hourlyDistribution = new Array(24).fill(0);
    const dailyDistribution = new Array(7).fill(0);

    for (const record of records) {
      const date = new Date(record.timestamp);
      hourlyDistribution[date.getHours()]++;
      dailyDistribution[date.getDay()]++;
    }

    // Normalize distributions
    const totalHourly = hourlyDistribution.reduce((a, b) => a + b, 0);
    const totalDaily = dailyDistribution.reduce((a, b) => a + b, 0);
    const normalizedHourly = hourlyDistribution.map((h) => h / totalHourly);
    const normalizedDaily = dailyDistribution.map((d) => d / totalDaily);

    // Identify peak and off-peak hours
    const avgHourly = 1 / 24;
    const peakHours = normalizedHourly
      .map((p, i) => (p > avgHourly * 1.5 ? i : -1))
      .filter((i) => i >= 0);
    const offPeakHours = normalizedHourly
      .map((p, i) => (p < avgHourly * 0.5 ? i : -1))
      .filter((i) => i >= 0);

    // Calculate resource frequency
    const resourceCounts = new Map<string, number>();
    for (const record of records) {
      const kind = record.resource.kind;
      resourceCounts.set(kind, (resourceCounts.get(kind) || 0) + 1);
    }
    const frequentResources: ResourceFrequency[] = Array.from(resourceCounts.entries())
      .map(([resourceKind, count]) => ({
        resourceKind,
        count,
        percentage: count / records.length,
      }))
      .sort((a, b) => b.count - a.count);

    // Calculate action frequency
    const actionCounts = new Map<string, number>();
    let totalActions = 0;
    for (const record of records) {
      for (const action of record.actions) {
        actionCounts.set(action, (actionCounts.get(action) || 0) + 1);
        totalActions++;
      }
    }
    const typicalActions: ActionFrequency[] = Array.from(actionCounts.entries())
      .map(([action, count]) => ({
        action,
        count,
        percentage: count / totalActions,
      }))
      .sort((a, b) => b.count - a.count);

    // Calculate velocity profile
    const velocities: number[] = [];
    const sortedRecords = [...records].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Calculate hourly request counts
    const hourlyBuckets = new Map<string, number>();
    for (const record of sortedRecords) {
      const date = new Date(record.timestamp);
      const hourKey = `${date.toDateString()}-${date.getHours()}`;
      hourlyBuckets.set(hourKey, (hourlyBuckets.get(hourKey) || 0) + 1);
    }

    for (const count of hourlyBuckets.values()) {
      velocities.push(count);
    }

    const avgVelocity = velocities.length > 0
      ? velocities.reduce((a, b) => a + b, 0) / velocities.length
      : 0;
    const maxVelocity = velocities.length > 0 ? Math.max(...velocities) : 0;

    // Calculate standard deviation
    const variance = velocities.length > 0
      ? velocities.reduce((sum, v) => sum + Math.pow(v - avgVelocity, 2), 0) / velocities.length
      : 0;
    const stdDev = Math.sqrt(variance);

    // Calculate p95
    const sortedVelocities = [...velocities].sort((a, b) => a - b);
    const p95Index = Math.floor(sortedVelocities.length * 0.95);
    const p95 = sortedVelocities[p95Index] || maxVelocity;

    return {
      principalId,
      accessTimes: {
        hourlyDistribution: normalizedHourly,
        dailyDistribution: normalizedDaily,
        peakHours,
        offPeakHours,
      },
      frequentResources,
      typicalActions,
      accessVelocity: {
        averagePerHour: avgVelocity,
        maxPerHour: maxVelocity,
        stdDev,
        p95,
      },
      lastUpdated: new Date(),
      observationCount: records.length,
    };
  }

  /**
   * Update an existing profile with new records
   */
  async updateProfile(
    existing: BehaviorProfile,
    newRecords: DecisionRecord[]
  ): Promise<BehaviorProfile> {
    // Build profile from new records
    const newProfile = await this.buildProfile(newRecords);

    // Merge with exponential moving average (weight recent data more)
    const alpha = 0.3; // Weight for new data

    // Merge hourly distribution
    const mergedHourly = existing.accessTimes.hourlyDistribution.map(
      (oldVal, i) => oldVal * (1 - alpha) + newProfile.accessTimes.hourlyDistribution[i] * alpha
    );

    // Merge daily distribution
    const mergedDaily = existing.accessTimes.dailyDistribution.map(
      (oldVal, i) => oldVal * (1 - alpha) + newProfile.accessTimes.dailyDistribution[i] * alpha
    );

    // Merge resource frequencies
    const allResources = new Set([
      ...existing.frequentResources.map((r) => r.resourceKind),
      ...newProfile.frequentResources.map((r) => r.resourceKind),
    ]);

    const mergedResources: ResourceFrequency[] = [];
    for (const kind of allResources) {
      const oldRes = existing.frequentResources.find((r) => r.resourceKind === kind);
      const newRes = newProfile.frequentResources.find((r) => r.resourceKind === kind);

      const oldPerc = oldRes?.percentage || 0;
      const newPerc = newRes?.percentage || 0;
      const mergedPerc = oldPerc * (1 - alpha) + newPerc * alpha;

      mergedResources.push({
        resourceKind: kind,
        count: (oldRes?.count || 0) + (newRes?.count || 0),
        percentage: mergedPerc,
      });
    }

    // Merge action frequencies
    const allActions = new Set([
      ...existing.typicalActions.map((a) => a.action),
      ...newProfile.typicalActions.map((a) => a.action),
    ]);

    const mergedActions: ActionFrequency[] = [];
    for (const action of allActions) {
      const oldAct = existing.typicalActions.find((a) => a.action === action);
      const newAct = newProfile.typicalActions.find((a) => a.action === action);

      const oldPerc = oldAct?.percentage || 0;
      const newPerc = newAct?.percentage || 0;
      const mergedPerc = oldPerc * (1 - alpha) + newPerc * alpha;

      mergedActions.push({
        action,
        count: (oldAct?.count || 0) + (newAct?.count || 0),
        percentage: mergedPerc,
      });
    }

    // Merge velocity
    const mergedVelocity: VelocityProfile = {
      averagePerHour:
        existing.accessVelocity.averagePerHour * (1 - alpha) +
        newProfile.accessVelocity.averagePerHour * alpha,
      maxPerHour: Math.max(
        existing.accessVelocity.maxPerHour,
        newProfile.accessVelocity.maxPerHour
      ),
      stdDev:
        existing.accessVelocity.stdDev * (1 - alpha) +
        newProfile.accessVelocity.stdDev * alpha,
      p95: Math.max(existing.accessVelocity.p95, newProfile.accessVelocity.p95),
    };

    // Recalculate peak/off-peak hours
    const avgHourly = 1 / 24;
    const peakHours = mergedHourly
      .map((p, i) => (p > avgHourly * 1.5 ? i : -1))
      .filter((i) => i >= 0);
    const offPeakHours = mergedHourly
      .map((p, i) => (p < avgHourly * 0.5 ? i : -1))
      .filter((i) => i >= 0);

    return {
      principalId: existing.principalId,
      accessTimes: {
        hourlyDistribution: mergedHourly,
        dailyDistribution: mergedDaily,
        peakHours,
        offPeakHours,
      },
      frequentResources: mergedResources.sort((a, b) => b.percentage - a.percentage),
      typicalActions: mergedActions.sort((a, b) => b.percentage - a.percentage),
      accessVelocity: mergedVelocity,
      lastUpdated: new Date(),
      observationCount: existing.observationCount + newRecords.length,
    };
  }

  /**
   * Calculate deviation score between baseline and observed profiles
   */
  calculateDeviation(baseline: BehaviorProfile, observed: BehaviorProfile): number {
    let totalDeviation = 0;
    let factorCount = 0;

    // Time distribution deviation (KL divergence approximation)
    let timeDeviation = 0;
    for (let i = 0; i < 24; i++) {
      const baseProb = baseline.accessTimes.hourlyDistribution[i] || 0.001;
      const obsProb = observed.accessTimes.hourlyDistribution[i] || 0.001;
      timeDeviation += Math.abs(baseProb - obsProb);
    }
    totalDeviation += timeDeviation / 2; // Normalize to 0-1
    factorCount++;

    // Velocity deviation
    const velocityDeviation =
      Math.abs(
        baseline.accessVelocity.averagePerHour - observed.accessVelocity.averagePerHour
      ) / Math.max(baseline.accessVelocity.maxPerHour, 1);
    totalDeviation += Math.min(velocityDeviation, 1);
    factorCount++;

    // Resource deviation
    const baseResources = new Set(baseline.frequentResources.map((r) => r.resourceKind));
    const obsResources = new Set(observed.frequentResources.map((r) => r.resourceKind));
    const resourceIntersection = new Set(
      [...baseResources].filter((r) => obsResources.has(r))
    );
    const resourceUnion = new Set([...baseResources, ...obsResources]);
    const resourceJaccard = resourceUnion.size > 0
      ? 1 - resourceIntersection.size / resourceUnion.size
      : 0;
    totalDeviation += resourceJaccard;
    factorCount++;

    return Math.min(totalDeviation / factorCount, 1);
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  private checkResourceAnomaly(
    input: FeatureInput,
    profile: BehaviorProfile
  ): { isAnomaly: boolean; score: number } {
    const resourceKind = input.resource.kind;
    const knownResource = profile.frequentResources.find(
      (r) => r.resourceKind === resourceKind
    );

    if (!knownResource) {
      // Never accessed this type before
      return { isAnomaly: true, score: 0.9 };
    }

    // Low frequency access
    if (knownResource.percentage < 0.05) {
      return { isAnomaly: true, score: 0.6 };
    }

    return { isAnomaly: false, score: 0 };
  }

  private checkActionAnomaly(
    input: FeatureInput,
    profile: BehaviorProfile
  ): { isAnomaly: boolean; score: number } {
    let maxScore = 0;

    for (const action of input.actions) {
      const knownAction = profile.typicalActions.find((a) => a.action === action);

      if (!knownAction) {
        maxScore = Math.max(maxScore, 0.8);
      } else if (knownAction.percentage < 0.05) {
        maxScore = Math.max(maxScore, 0.5);
      }
    }

    return { isAnomaly: maxScore > 0.3, score: maxScore };
  }

  private checkVelocityAnomaly(
    input: FeatureInput,
    profile: BehaviorProfile
  ): { isAnomaly: boolean; score: number; observedVelocity: number } {
    if (!input.history || input.history.length === 0) {
      return { isAnomaly: false, score: 0, observedVelocity: 0 };
    }

    // Calculate requests in last hour
    const oneHourAgo = new Date(input.timestamp.getTime() - 3600000);
    const recentRequests = input.history.filter(
      (h) => new Date(h.timestamp) >= oneHourAgo
    ).length;

    const avgVelocity = profile.accessVelocity.averagePerHour;
    const stdDev = profile.accessVelocity.stdDev || 1;

    // Z-score for velocity
    const zScore = (recentRequests - avgVelocity) / stdDev;

    if (zScore > 2) {
      // More than 2 standard deviations above mean
      const score = Math.min(zScore / 4, 1); // Cap at 1
      return { isAnomaly: true, score, observedVelocity: recentRequests };
    }

    return { isAnomaly: false, score: 0, observedVelocity: recentRequests };
  }

  private generateRecommendations(factors: AnomalyFactor[], score: number): string[] {
    const recommendations: string[] = [];

    if (score >= 0.8) {
      recommendations.push('Block access and require additional verification');
      recommendations.push('Alert security team for immediate review');
    } else if (score >= 0.6) {
      recommendations.push('Require multi-factor authentication');
      recommendations.push('Log detailed audit trail');
    } else if (score >= 0.4) {
      recommendations.push('Add to watchlist for monitoring');
      recommendations.push('Review access in next security audit');
    }

    // Factor-specific recommendations
    for (const factor of factors) {
      switch (factor.name) {
        case 'time_violation':
          recommendations.push('Verify user identity for off-hours access');
          break;
        case 'resource_anomaly':
          recommendations.push('Confirm business justification for new resource access');
          break;
        case 'rate_anomaly':
          recommendations.push('Apply rate limiting to this principal');
          break;
        case 'unusual_action':
          recommendations.push('Audit recent actions for this user');
          break;
      }
    }

    // Remove duplicates and return
    return [...new Set(recommendations)];
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}
