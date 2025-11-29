/**
 * Quota Manager for AuthZ Engine
 *
 * Manages usage quotas for principals accessing resources.
 */

import type {
  QuotaManagerConfig,
  QuotaPolicy,
  QuotaUsage,
  QuotaStatus,
  QuotaCheckContext,
  QuotaCheckResult,
  QuotaConsumeResult,
  QuotaThresholdEvent,
  QuotaResetEvent,
  QuotaConsumeEvent,
  StoredQuotaUsage,
  QuotaPeriod as QuotaPeriodEnum,
} from './types';
import { QuotaPeriod } from './types';

// Re-export types
export * from './types';

// =============================================================================
// In-Memory Quota Storage
// =============================================================================

class InMemoryQuotaStorage {
  private store: Map<string, StoredQuotaUsage> = new Map();

  async getUsage(key: string): Promise<StoredQuotaUsage | null> {
    return this.store.get(key) || null;
  }

  async setUsage(key: string, usage: StoredQuotaUsage): Promise<void> {
    this.store.set(key, usage);
  }

  async incrementUsage(key: string, amount: number): Promise<number> {
    const usage = this.store.get(key);
    if (usage) {
      usage.used += amount;
      usage.lastUpdated = Date.now();
      return usage.used;
    }
    return amount;
  }

  async deleteUsage(key: string): Promise<void> {
    this.store.delete(key);
  }

  async getUsageByPrincipal(principalId: string): Promise<StoredQuotaUsage[]> {
    const results: StoredQuotaUsage[] = [];
    for (const [key, usage] of this.store.entries()) {
      if (key.startsWith(`quota:${principalId}:`)) {
        results.push(usage);
      }
    }
    return results;
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, usage] of this.store.entries()) {
      if (usage.periodEnd < now) {
        this.store.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }

  clear(): void {
    this.store.clear();
  }
}

// =============================================================================
// Event Handlers
// =============================================================================

export type QuotaEventHandler<T> = (event: T) => void;

// =============================================================================
// Quota Manager Implementation
// =============================================================================

/**
 * Quota Manager class for tracking and enforcing usage quotas
 */
export class QuotaManager {
  private config: QuotaManagerConfig;
  private storage: InMemoryQuotaStorage;
  private policies: Map<string, QuotaPolicy>;
  private sortedPolicies: QuotaPolicy[];

  private onThreshold?: QuotaEventHandler<QuotaThresholdEvent>;
  private onReset?: QuotaEventHandler<QuotaResetEvent>;
  private onConsume?: QuotaEventHandler<QuotaConsumeEvent>;

  constructor(config: Partial<QuotaManagerConfig> = {}) {
    this.config = {
      enabled: true,
      policies: [],
      defaultPeriod: QuotaPeriod.DAILY,
      defaultEnforcement: 'hard',
      globalNotifyThreshold: 80,
      trackHistory: false,
      maxHistoryEntries: 100,
      ...config,
    };

    this.storage = new InMemoryQuotaStorage();
    this.policies = new Map();
    this.sortedPolicies = [];

    // Initialize policies
    for (const policy of this.config.policies) {
      this.addPolicy(policy);
    }
  }

  // =============================================================================
  // Event Registration
  // =============================================================================

  onQuotaThreshold(handler: QuotaEventHandler<QuotaThresholdEvent>): void {
    this.onThreshold = handler;
  }

  onQuotaReset(handler: QuotaEventHandler<QuotaResetEvent>): void {
    this.onReset = handler;
  }

  onQuotaConsume(handler: QuotaEventHandler<QuotaConsumeEvent>): void {
    this.onConsume = handler;
  }

  // =============================================================================
  // Policy Management
  // =============================================================================

  /**
   * Add a quota policy
   */
  addPolicy(policy: QuotaPolicy): void {
    this.policies.set(policy.id, policy);
    this.sortedPolicies = Array.from(this.policies.values()).sort(
      (a, b) => (b.priority || 0) - (a.priority || 0)
    );
  }

  /**
   * Remove a quota policy
   */
  removePolicy(policyId: string): boolean {
    const removed = this.policies.delete(policyId);
    if (removed) {
      this.sortedPolicies = Array.from(this.policies.values()).sort(
        (a, b) => (b.priority || 0) - (a.priority || 0)
      );
    }
    return removed;
  }

  /**
   * Get a policy by ID
   */
  getPolicy(policyId: string): QuotaPolicy | undefined {
    return this.policies.get(policyId);
  }

  /**
   * Get all policies
   */
  getAllPolicies(): QuotaPolicy[] {
    return [...this.sortedPolicies];
  }

  // =============================================================================
  // Quota Operations
  // =============================================================================

  /**
   * Check if a request is allowed under quota limits
   */
  async checkQuota(context: QuotaCheckContext): Promise<QuotaCheckResult> {
    if (!this.config.enabled) {
      return {
        allowed: true,
        quotas: [],
        hasWarnings: false,
        warnings: [],
      };
    }

    const applicablePolicies = this.findApplicablePolicies(context);
    const quotas: QuotaUsage[] = [];
    const warnings: string[] = [];
    let allowed = true;
    let denyingPolicy: string | undefined;
    let reason: string | undefined;
    let resetInMs: number | undefined;

    for (const policy of applicablePolicies) {
      const usage = await this.getOrCreateUsage(policy, context);
      quotas.push(usage);

      // Check threshold warnings
      const notifyThreshold = policy.notifyThresholdPercent ?? this.config.globalNotifyThreshold ?? 80;
      if (usage.percentUsed >= notifyThreshold && !usage.exceeded) {
        warnings.push(
          `Quota "${policy.name}" at ${usage.percentUsed.toFixed(1)}% (${usage.used}/${usage.limit})`
        );
      }

      // Check if would exceed
      const cost = context.cost || 1;
      const wouldExceed = usage.used + cost > usage.limit;

      if (wouldExceed) {
        const gracePeriod = policy.gracePeriodPercent || 0;
        const graceLimit = usage.limit * (1 + gracePeriod / 100);
        const withinGrace = usage.used + cost <= graceLimit;

        if (withinGrace && policy.enforcement !== 'hard') {
          // Allow but mark as in grace period
          usage.inGracePeriod = true;
          this.emitThresholdEvent('grace', context.principalId, policy, usage);
        } else if (policy.enforcement === 'hard') {
          allowed = false;
          denyingPolicy = policy.id;
          reason = `Quota exceeded for policy "${policy.name}": ${usage.used}/${usage.limit}`;
          resetInMs = usage.periodEnd - Date.now();
          this.emitThresholdEvent('exceeded', context.principalId, policy, usage);
        } else if (policy.enforcement === 'notify') {
          warnings.push(`Quota "${policy.name}" exceeded (enforcement: notify)`);
          this.emitThresholdEvent('exceeded', context.principalId, policy, usage);
        }
      }
    }

    return {
      allowed,
      reason,
      denyingPolicy,
      quotas,
      hasWarnings: warnings.length > 0,
      warnings,
      resetInMs,
    };
  }

  /**
   * Consume quota for a request
   */
  async consumeQuota(context: QuotaCheckContext): Promise<QuotaConsumeResult> {
    const checkResult = await this.checkQuota(context);

    if (!checkResult.allowed) {
      return {
        success: false,
        consumed: 0,
        remaining: 0,
        usage: checkResult.quotas[0] || this.createEmptyUsage(context),
        error: checkResult.reason,
      };
    }

    const cost = context.cost || 1;
    const applicablePolicies = this.findApplicablePolicies(context);

    let lastUsage: QuotaUsage | undefined;

    for (const policy of applicablePolicies) {
      const key = this.generateKey(policy, context);
      const stored = await this.storage.getUsage(key);

      if (stored) {
        const previousUsage = stored.used;
        stored.used += cost;
        stored.lastUpdated = Date.now();

        // Add to history if enabled
        if (this.config.trackHistory && stored.history) {
          stored.history.push({
            timestamp: Date.now(),
            amount: cost,
            action: context.action,
          });
          // Trim history if needed
          if (stored.history.length > (this.config.maxHistoryEntries || 100)) {
            stored.history = stored.history.slice(-this.config.maxHistoryEntries!);
          }
        }

        await this.storage.setUsage(key, stored);

        lastUsage = this.storedToUsage(stored, policy);

        // Emit consume event
        if (this.onConsume) {
          this.onConsume({
            timestamp: Date.now(),
            principalId: context.principalId,
            policyId: policy.id,
            resourceKind: context.resourceKind,
            action: context.action,
            cost,
            previousUsage,
            newUsage: stored.used,
            remaining: policy.limits.find(l => l.resourceKind === context.resourceKind)?.limit || 0 - stored.used,
          });
        }
      }
    }

    return {
      success: true,
      consumed: cost,
      remaining: lastUsage?.remaining || 0,
      usage: lastUsage || this.createEmptyUsage(context),
    };
  }

  /**
   * Get quota status for a principal
   */
  async getQuotaStatus(principalId: string): Promise<QuotaStatus> {
    const stored = await this.storage.getUsageByPrincipal(principalId);
    const quotas: QuotaUsage[] = [];
    const warnings: string[] = [];
    let status: 'ok' | 'warning' | 'exceeded' = 'ok';

    for (const usage of stored) {
      const policy = this.policies.get(usage.policyId);
      if (!policy) continue;

      const quotaUsage = this.storedToUsage(usage, policy);
      quotas.push(quotaUsage);

      if (quotaUsage.exceeded) {
        status = 'exceeded';
        warnings.push(`Quota "${policy.name}" exceeded`);
      } else if (quotaUsage.percentUsed >= 80 && status !== 'exceeded') {
        status = 'warning';
        warnings.push(`Quota "${policy.name}" at ${quotaUsage.percentUsed.toFixed(1)}%`);
      }
    }

    return {
      principalId,
      quotas,
      status,
      warnings,
      timestamp: Date.now(),
    };
  }

  /**
   * Reset quota for a principal
   */
  async resetQuota(
    principalId: string,
    policyId?: string,
    resourceKind?: string
  ): Promise<void> {
    if (policyId) {
      const policy = this.policies.get(policyId);
      if (policy) {
        const key = this.generateKeyDirect(policyId, principalId, resourceKind);
        const stored = await this.storage.getUsage(key);
        const previousUsage = stored?.used || 0;

        await this.storage.deleteUsage(key);

        // Emit reset event
        if (this.onReset && stored) {
          const { start, end } = this.calculatePeriodBounds(policy.period, policy.rollingWindowMs);
          this.onReset({
            timestamp: Date.now(),
            principalId,
            policyId,
            previousUsage,
            newPeriodStart: start,
            newPeriodEnd: end,
          });
        }
      }
    } else {
      // Reset all quotas for principal
      const stored = await this.storage.getUsageByPrincipal(principalId);
      for (const usage of stored) {
        const key = this.generateKeyDirect(usage.policyId, principalId, usage.resourceKind);
        await this.storage.deleteUsage(key);
      }
    }
  }

  /**
   * Get usage for a specific quota
   */
  async getUsage(
    principalId: string,
    policyId: string,
    resourceKind?: string
  ): Promise<QuotaUsage | null> {
    const policy = this.policies.get(policyId);
    if (!policy) return null;

    const key = this.generateKeyDirect(policyId, principalId, resourceKind);
    const stored = await this.storage.getUsage(key);

    if (!stored) return null;

    return this.storedToUsage(stored, policy);
  }

  /**
   * Manually set usage for a quota (for migration/sync purposes)
   */
  async setUsage(
    principalId: string,
    policyId: string,
    used: number,
    resourceKind?: string
  ): Promise<void> {
    const policy = this.policies.get(policyId);
    if (!policy) {
      throw new Error(`Policy not found: ${policyId}`);
    }

    const key = this.generateKeyDirect(policyId, principalId, resourceKind);
    const { start, end } = this.calculatePeriodBounds(policy.period, policy.rollingWindowMs);

    await this.storage.setUsage(key, {
      policyId,
      principalId,
      resourceKind,
      used,
      periodStart: start,
      periodEnd: end,
      lastUpdated: Date.now(),
      history: this.config.trackHistory ? [] : undefined,
    });
  }

  /**
   * Clean up expired quota records
   */
  async cleanup(): Promise<number> {
    return this.storage.cleanup();
  }

  /**
   * Enable/disable quota enforcement
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Check if quota enforcement is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Clear all quota data
   */
  clear(): void {
    this.storage.clear();
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  /**
   * Find all policies applicable to a context
   */
  private findApplicablePolicies(context: QuotaCheckContext): QuotaPolicy[] {
    return this.sortedPolicies.filter(policy => {
      if (!policy.enabled) return false;

      // Check principal match
      if (policy.principals && policy.principals.length > 0) {
        if (!policy.principals.includes(context.principalId)) {
          return false;
        }
      }

      // Check role match
      if (policy.roles && policy.roles.length > 0 && context.roles) {
        if (!policy.roles.some(role => context.roles!.includes(role))) {
          return false;
        }
      }

      // Check if policy has limits for this resource
      const hasResourceLimit = policy.limits.some(
        limit =>
          limit.resourceKind === context.resourceKind ||
          limit.resourceKind === '*'
      );

      return hasResourceLimit || policy.globalLimit !== undefined;
    });
  }

  /**
   * Get or create usage record
   */
  private async getOrCreateUsage(
    policy: QuotaPolicy,
    context: QuotaCheckContext
  ): Promise<QuotaUsage> {
    const key = this.generateKey(policy, context);
    let stored = await this.storage.getUsage(key);
    const now = Date.now();

    // Check if we need to reset for new period
    if (stored && stored.periodEnd < now) {
      // Emit reset event
      if (this.onReset) {
        this.onReset({
          timestamp: now,
          principalId: context.principalId,
          policyId: policy.id,
          previousUsage: stored.used,
          newPeriodStart: stored.periodEnd,
          newPeriodEnd: stored.periodEnd + (stored.periodEnd - stored.periodStart),
        });
      }
      stored = null;
    }

    if (!stored) {
      const { start, end } = this.calculatePeriodBounds(policy.period, policy.rollingWindowMs);
      stored = {
        policyId: policy.id,
        principalId: context.principalId,
        resourceKind: context.resourceKind,
        used: 0,
        periodStart: start,
        periodEnd: end,
        lastUpdated: now,
        history: this.config.trackHistory ? [] : undefined,
      };
      await this.storage.setUsage(key, stored);
    }

    return this.storedToUsage(stored, policy);
  }

  /**
   * Convert stored usage to QuotaUsage
   */
  private storedToUsage(stored: StoredQuotaUsage, policy: QuotaPolicy): QuotaUsage {
    const limit = this.getLimitForResource(policy, stored.resourceKind);

    return {
      policyId: stored.policyId,
      principalId: stored.principalId,
      resourceKind: stored.resourceKind,
      used: stored.used,
      limit,
      remaining: Math.max(0, limit - stored.used),
      percentUsed: limit > 0 ? (stored.used / limit) * 100 : 0,
      periodStart: stored.periodStart,
      periodEnd: stored.periodEnd,
      exceeded: stored.used > limit,
      inGracePeriod: false,
      lastUpdated: stored.lastUpdated,
    };
  }

  /**
   * Get limit for a specific resource kind
   */
  private getLimitForResource(policy: QuotaPolicy, resourceKind?: string): number {
    if (resourceKind) {
      const resourceLimit = policy.limits.find(
        l => l.resourceKind === resourceKind || l.resourceKind === '*'
      );
      if (resourceLimit) {
        return resourceLimit.limit;
      }
    }
    return policy.globalLimit || 0;
  }

  /**
   * Generate storage key
   */
  private generateKey(policy: QuotaPolicy, context: QuotaCheckContext): string {
    return `quota:${context.principalId}:${policy.id}:${context.resourceKind || 'global'}`;
  }

  /**
   * Generate storage key directly
   */
  private generateKeyDirect(
    policyId: string,
    principalId: string,
    resourceKind?: string
  ): string {
    return `quota:${principalId}:${policyId}:${resourceKind || 'global'}`;
  }

  /**
   * Calculate period start and end bounds
   */
  private calculatePeriodBounds(
    period: QuotaPeriodEnum,
    rollingWindowMs?: number
  ): { start: number; end: number } {
    const now = new Date();
    let start: Date;
    let end: Date;

    switch (period) {
      case QuotaPeriod.HOURLY:
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
        end = new Date(start.getTime() + 60 * 60 * 1000);
        break;

      case QuotaPeriod.DAILY:
        start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
        break;

      case QuotaPeriod.WEEKLY:
        const dayOfWeek = now.getUTCDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset));
        end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
        break;

      case QuotaPeriod.MONTHLY:
        start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
        break;

      case QuotaPeriod.ROLLING:
        start = new Date(now.getTime() - (rollingWindowMs || 24 * 60 * 60 * 1000));
        end = new Date(now.getTime() + (rollingWindowMs || 24 * 60 * 60 * 1000));
        break;

      default:
        start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    }

    return { start: start.getTime(), end: end.getTime() };
  }

  /**
   * Emit threshold event
   */
  private emitThresholdEvent(
    type: 'warning' | 'exceeded' | 'grace',
    principalId: string,
    policy: QuotaPolicy,
    usage: QuotaUsage
  ): void {
    if (this.onThreshold) {
      this.onThreshold({
        type,
        timestamp: Date.now(),
        principalId,
        policyId: policy.id,
        resourceKind: usage.resourceKind,
        currentUsage: usage.used,
        limit: usage.limit,
        percentUsed: usage.percentUsed,
        periodEnd: usage.periodEnd,
      });
    }
  }

  /**
   * Create empty usage for error cases
   */
  private createEmptyUsage(context: QuotaCheckContext): QuotaUsage {
    return {
      policyId: 'unknown',
      principalId: context.principalId,
      resourceKind: context.resourceKind,
      used: 0,
      limit: 0,
      remaining: 0,
      percentUsed: 0,
      periodStart: Date.now(),
      periodEnd: Date.now(),
      exceeded: false,
      inGracePeriod: false,
      lastUpdated: Date.now(),
    };
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a quota manager with default configuration
 */
export function createQuotaManager(config?: Partial<QuotaManagerConfig>): QuotaManager {
  return new QuotaManager(config);
}

/**
 * Create a simple quota policy
 */
export function createQuotaPolicy(options: {
  id: string;
  name: string;
  resourceKind: string;
  limit: number;
  period?: QuotaPeriodEnum;
  enforcement?: 'hard' | 'soft' | 'notify';
}): QuotaPolicy {
  return {
    id: options.id,
    name: options.name,
    period: options.period || QuotaPeriod.DAILY,
    limits: [
      {
        resourceKind: options.resourceKind,
        limit: options.limit,
      },
    ],
    enforcement: options.enforcement || 'hard',
    enabled: true,
  };
}
