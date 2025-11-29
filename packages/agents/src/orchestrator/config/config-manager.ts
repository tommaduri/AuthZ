/**
 * Configuration Manager - Hot-reload and feature flags
 *
 * Provides:
 * - Dynamic agent configuration
 * - Feature flags per agent
 * - A/B testing support
 */

import { EventEmitter } from 'eventemitter3';
import type { AgentType, AgentConfig } from '../../types/agent.types.js';
import type { PipelineConfig } from '../pipeline/pipeline-config.js';
import type { CircuitBreakerConfig } from '../circuit-breaker/circuit-breaker.js';

/**
 * Feature flag definition
 */
export interface FeatureFlag {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description?: string;
  /** Whether enabled by default */
  defaultValue: boolean;
  /** Per-agent overrides */
  agentOverrides?: Partial<Record<AgentType, boolean>>;
  /** Percentage of traffic (for gradual rollout) */
  rolloutPercentage?: number;
  /** A/B test variant associations */
  variants?: string[];
  /** Conditions for enabling */
  conditions?: FeatureFlagCondition[];
  /** Expiry date for temporary flags */
  expiresAt?: Date;
  /** Tags for categorization */
  tags?: string[];
}

/**
 * Feature flag condition
 */
export interface FeatureFlagCondition {
  /** Field to check */
  field: string;
  /** Operator */
  operator: 'eq' | 'ne' | 'in' | 'contains' | 'gt' | 'lt';
  /** Value to compare */
  value: unknown;
}

/**
 * A/B test configuration
 */
export interface ABTestConfig {
  /** Test identifier */
  id: string;
  /** Test name */
  name: string;
  /** Test description */
  description?: string;
  /** Available variants */
  variants: ABTestVariant[];
  /** Traffic allocation strategy */
  allocationStrategy: 'random' | 'user-hash' | 'session-hash';
  /** Whether test is active */
  active: boolean;
  /** Start date */
  startDate?: Date;
  /** End date */
  endDate?: Date;
  /** Associated feature flags */
  featureFlags: string[];
}

/**
 * A/B test variant
 */
export interface ABTestVariant {
  /** Variant identifier */
  id: string;
  /** Variant name */
  name: string;
  /** Traffic weight (0-100) */
  weight: number;
  /** Configuration overrides for this variant */
  configOverrides?: Partial<DynamicConfig>;
}

/**
 * Dynamic configuration that can be hot-reloaded
 */
export interface DynamicConfig {
  /** Agent configurations */
  agents: AgentConfig;
  /** Pipeline configuration */
  pipeline?: PipelineConfig;
  /** Circuit breaker configurations */
  circuitBreakers?: Partial<Record<AgentType, CircuitBreakerConfig>>;
  /** Feature flags */
  featureFlags: Record<string, FeatureFlag>;
  /** A/B tests */
  abTests: Record<string, ABTestConfig>;
  /** Global settings */
  global: {
    /** Default timeout for all operations (ms) */
    defaultTimeoutMs: number;
    /** Maximum concurrent requests */
    maxConcurrentRequests: number;
    /** Request rate limit per second */
    rateLimitPerSecond: number;
    /** Enable detailed logging */
    verboseLogging: boolean;
    /** Enable metrics collection */
    metricsEnabled: boolean;
  };
  /** Version for tracking changes */
  version: string;
  /** Last updated timestamp */
  lastUpdated: Date;
}

/**
 * Configuration change event
 */
export interface ConfigChangeEvent {
  timestamp: Date;
  previousVersion: string;
  newVersion: string;
  changedPaths: string[];
  source: 'hot-reload' | 'api' | 'file-watch' | 'manual';
  triggeredBy?: string;
}

/**
 * Configuration validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * Validation error
 */
export interface ValidationError {
  path: string;
  message: string;
  value?: unknown;
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  path: string;
  message: string;
  suggestion?: string;
}

/**
 * Configuration source
 */
export interface ConfigSource {
  /** Source type */
  type: 'file' | 'environment' | 'remote' | 'memory';
  /** Source location (file path or URL) */
  location?: string;
  /** Polling interval for remote sources (ms) */
  pollIntervalMs?: number;
  /** Priority (higher = takes precedence) */
  priority: number;
}

/**
 * Default dynamic configuration
 */
export const DEFAULT_DYNAMIC_CONFIG: DynamicConfig = {
  agents: {
    enabled: true,
    logLevel: 'info',
    guardian: {
      anomalyThreshold: 0.7,
      baselinePeriodDays: 30,
      velocityWindowMinutes: 5,
      enableRealTimeDetection: true,
    },
    analyst: {
      minSampleSize: 50,
      confidenceThreshold: 0.8,
      learningEnabled: true,
      patternDiscoveryInterval: '0 * * * *', // Every hour
    },
    advisor: {
      llmProvider: 'openai',
      llmModel: 'gpt-4',
      enableNaturalLanguage: true,
      maxExplanationLength: 1000,
    },
    enforcer: {
      autoEnforceEnabled: true,
      requireApprovalForSeverity: 'high',
      maxActionsPerHour: 100,
      rollbackWindowMinutes: 60,
    },
  },
  featureFlags: {},
  abTests: {},
  global: {
    defaultTimeoutMs: 5000,
    maxConcurrentRequests: 100,
    rateLimitPerSecond: 1000,
    verboseLogging: false,
    metricsEnabled: true,
  },
  version: '1.0.0',
  lastUpdated: new Date(),
};

/**
 * Configuration manager for dynamic configuration and feature flags
 */
export class ConfigManager extends EventEmitter {
  private config: DynamicConfig;
  private configSources: ConfigSource[] = [];
  private changeHistory: ConfigChangeEvent[] = [];
  private fileWatchers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private userVariantAssignments: Map<string, Map<string, string>> = new Map();

  constructor(initialConfig: Partial<DynamicConfig> = {}) {
    super();
    this.config = this.mergeConfig(DEFAULT_DYNAMIC_CONFIG, initialConfig);
  }

  /**
   * Get the current configuration
   */
  getConfig(): Readonly<DynamicConfig> {
    return this.config;
  }

  /**
   * Get configuration for a specific agent
   */
  getAgentConfig<T extends keyof AgentConfig>(agentType: T): AgentConfig[T] {
    return this.config.agents[agentType];
  }

  /**
   * Get a feature flag value
   */
  getFeatureFlag(flagId: string, context?: { agentType?: AgentType; userId?: string }): boolean {
    const flag = this.config.featureFlags[flagId];
    if (!flag) return false;

    // Check expiry
    if (flag.expiresAt && new Date() > flag.expiresAt) {
      return false;
    }

    // Check agent override
    if (context?.agentType && flag.agentOverrides?.[context.agentType] !== undefined) {
      return flag.agentOverrides[context.agentType]!;
    }

    // Check conditions
    if (flag.conditions && flag.conditions.length > 0) {
      const conditionsMet = flag.conditions.every(condition =>
        this.evaluateCondition(condition, context ?? {})
      );
      if (!conditionsMet) return false;
    }

    // Check rollout percentage
    if (flag.rolloutPercentage !== undefined && flag.rolloutPercentage < 100) {
      const hash = context?.userId
        ? this.hashString(context.userId + flagId)
        : Math.random() * 100;
      if (hash > flag.rolloutPercentage) {
        return false;
      }
    }

    return flag.defaultValue;
  }

  /**
   * Get all feature flags
   */
  getAllFeatureFlags(): Record<string, FeatureFlag> {
    return { ...this.config.featureFlags };
  }

  /**
   * Set a feature flag value
   */
  setFeatureFlag(flagId: string, flag: FeatureFlag): void {
    const previousFlags = { ...this.config.featureFlags };
    this.config.featureFlags[flagId] = flag;
    this.recordChange(['featureFlags', flagId], 'api');
    this.emit('featureFlagChanged', { flagId, flag, previousFlags });
  }

  /**
   * Remove a feature flag
   */
  removeFeatureFlag(flagId: string): boolean {
    if (this.config.featureFlags[flagId]) {
      delete this.config.featureFlags[flagId];
      this.recordChange(['featureFlags', flagId], 'api');
      return true;
    }
    return false;
  }

  /**
   * Get A/B test variant for a user/session
   */
  getABTestVariant(testId: string, userId?: string, sessionId?: string): ABTestVariant | null {
    const test = this.config.abTests[testId];
    if (!test || !test.active) return null;

    // Check date bounds
    const now = new Date();
    if (test.startDate && now < test.startDate) return null;
    if (test.endDate && now > test.endDate) return null;

    // Get or assign variant
    const key = userId ?? sessionId ?? 'anonymous';
    const assignmentKey = `${testId}:${key}`;

    let userAssignments = this.userVariantAssignments.get(key);
    if (!userAssignments) {
      userAssignments = new Map();
      this.userVariantAssignments.set(key, userAssignments);
    }

    let variantId = userAssignments.get(testId);
    if (!variantId) {
      variantId = this.selectVariant(test, key);
      userAssignments.set(testId, variantId);
    }

    return test.variants.find(v => v.id === variantId) ?? null;
  }

  /**
   * Get effective configuration with A/B test overrides
   */
  getEffectiveConfig(context?: { userId?: string; sessionId?: string }): DynamicConfig {
    let effectiveConfig = { ...this.config };

    // Apply A/B test overrides
    for (const [testId, test] of Object.entries(this.config.abTests)) {
      if (test.active) {
        const variant = this.getABTestVariant(testId, context?.userId, context?.sessionId);
        if (variant?.configOverrides) {
          effectiveConfig = this.mergeConfig(effectiveConfig, variant.configOverrides);
        }
      }
    }

    return effectiveConfig;
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<DynamicConfig>, source: ConfigChangeEvent['source'] = 'api'): ValidationResult {
    const validation = this.validateConfig(updates);
    if (!validation.valid) {
      return validation;
    }

    const previousVersion = this.config.version;
    const changedPaths = this.getChangedPaths(this.config, updates);

    this.config = this.mergeConfig(this.config, {
      ...updates,
      version: this.incrementVersion(this.config.version),
      lastUpdated: new Date(),
    });

    this.recordChange(changedPaths, source);
    this.emit('configUpdated', { config: this.config, changedPaths });

    return validation;
  }

  /**
   * Hot-reload configuration from sources
   */
  async reload(): Promise<ValidationResult> {
    const loadedConfigs: Array<{ config: Partial<DynamicConfig>; priority: number }> = [];

    // Load from each source in priority order
    for (const source of this.configSources.sort((a, b) => a.priority - b.priority)) {
      try {
        const config = await this.loadFromSource(source);
        if (config) {
          loadedConfigs.push({ config, priority: source.priority });
        }
      } catch (error) {
        console.error(`Failed to load config from source:`, source, error);
      }
    }

    // Merge configurations
    let merged: Partial<DynamicConfig> = {};
    for (const { config } of loadedConfigs) {
      merged = this.mergeConfig(merged as DynamicConfig, config);
    }

    return this.updateConfig(merged, 'hot-reload');
  }

  /**
   * Add a configuration source
   */
  addConfigSource(source: ConfigSource): void {
    this.configSources.push(source);

    // Set up file watching if applicable
    if (source.type === 'file' && source.location && source.pollIntervalMs) {
      const watcher = setInterval(() => {
        this.reload().catch(console.error);
      }, source.pollIntervalMs);
      this.fileWatchers.set(source.location, watcher);
    }
  }

  /**
   * Remove a configuration source
   */
  removeConfigSource(location: string): boolean {
    const index = this.configSources.findIndex(s => s.location === location);
    if (index > -1) {
      this.configSources.splice(index, 1);

      // Stop file watcher if exists
      const watcher = this.fileWatchers.get(location);
      if (watcher) {
        clearInterval(watcher);
        this.fileWatchers.delete(location);
      }

      return true;
    }
    return false;
  }

  /**
   * Validate configuration
   */
  validateConfig(config: Partial<DynamicConfig>): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Validate agents config
    if (config.agents) {
      if (config.agents.guardian?.anomalyThreshold !== undefined) {
        if (config.agents.guardian.anomalyThreshold < 0 || config.agents.guardian.anomalyThreshold > 1) {
          errors.push({
            path: 'agents.guardian.anomalyThreshold',
            message: 'Anomaly threshold must be between 0 and 1',
            value: config.agents.guardian.anomalyThreshold,
          });
        }
      }

      if (config.agents.analyst?.confidenceThreshold !== undefined) {
        if (config.agents.analyst.confidenceThreshold < 0 || config.agents.analyst.confidenceThreshold > 1) {
          errors.push({
            path: 'agents.analyst.confidenceThreshold',
            message: 'Confidence threshold must be between 0 and 1',
            value: config.agents.analyst.confidenceThreshold,
          });
        }
      }
    }

    // Validate global settings
    if (config.global) {
      if (config.global.defaultTimeoutMs !== undefined && config.global.defaultTimeoutMs < 100) {
        warnings.push({
          path: 'global.defaultTimeoutMs',
          message: 'Timeout less than 100ms may cause frequent timeouts',
          suggestion: 'Consider setting timeout to at least 1000ms',
        });
      }

      if (config.global.maxConcurrentRequests !== undefined && config.global.maxConcurrentRequests > 1000) {
        warnings.push({
          path: 'global.maxConcurrentRequests',
          message: 'High concurrent request limit may cause resource exhaustion',
          suggestion: 'Consider limiting to 100-500 concurrent requests',
        });
      }
    }

    // Validate feature flags
    if (config.featureFlags) {
      for (const [flagId, flag] of Object.entries(config.featureFlags)) {
        if (flag.rolloutPercentage !== undefined) {
          if (flag.rolloutPercentage < 0 || flag.rolloutPercentage > 100) {
            errors.push({
              path: `featureFlags.${flagId}.rolloutPercentage`,
              message: 'Rollout percentage must be between 0 and 100',
              value: flag.rolloutPercentage,
            });
          }
        }

        if (flag.expiresAt && new Date() > flag.expiresAt) {
          warnings.push({
            path: `featureFlags.${flagId}.expiresAt`,
            message: 'Feature flag has expired',
            suggestion: 'Consider removing expired feature flags',
          });
        }
      }
    }

    // Validate A/B tests
    if (config.abTests) {
      for (const [testId, test] of Object.entries(config.abTests)) {
        const totalWeight = test.variants.reduce((sum, v) => sum + v.weight, 0);
        if (Math.abs(totalWeight - 100) > 0.01) {
          errors.push({
            path: `abTests.${testId}.variants`,
            message: 'Variant weights must sum to 100',
            value: totalWeight,
          });
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Get configuration change history
   */
  getChangeHistory(limit?: number): ConfigChangeEvent[] {
    return limit ? this.changeHistory.slice(-limit) : [...this.changeHistory];
  }

  /**
   * Rollback to a previous configuration version
   */
  rollbackToVersion(version: string): boolean {
    // This would need to be implemented with actual version storage
    // For now, just emit an event
    this.emit('rollbackRequested', { targetVersion: version });
    return false;
  }

  /**
   * Stop all file watchers and cleanup
   */
  stop(): void {
    for (const watcher of this.fileWatchers.values()) {
      clearInterval(watcher);
    }
    this.fileWatchers.clear();
    this.removeAllListeners();
  }

  private mergeConfig(base: DynamicConfig, updates: Partial<DynamicConfig>): DynamicConfig {
    return {
      ...base,
      ...updates,
      agents: updates.agents ? { ...base.agents, ...updates.agents } : base.agents,
      featureFlags: updates.featureFlags
        ? { ...base.featureFlags, ...updates.featureFlags }
        : base.featureFlags,
      abTests: updates.abTests
        ? { ...base.abTests, ...updates.abTests }
        : base.abTests,
      global: updates.global ? { ...base.global, ...updates.global } : base.global,
    };
  }

  private recordChange(changedPaths: string[], source: ConfigChangeEvent['source']): void {
    const event: ConfigChangeEvent = {
      timestamp: new Date(),
      previousVersion: this.changeHistory.length > 0
        ? this.changeHistory[this.changeHistory.length - 1].newVersion
        : '0.0.0',
      newVersion: this.config.version,
      changedPaths: changedPaths,
      source,
    };

    this.changeHistory.push(event);

    // Keep only last 1000 changes
    if (this.changeHistory.length > 1000) {
      this.changeHistory.splice(0, this.changeHistory.length - 1000);
    }

    this.emit('configChanged', event);
  }

  private getChangedPaths(current: DynamicConfig, updates: Partial<DynamicConfig>): string[] {
    const paths: string[] = [];

    const compare = (obj1: unknown, obj2: unknown, path: string): void => {
      if (obj2 === undefined) return;

      if (typeof obj1 !== typeof obj2 || obj1 !== obj2) {
        paths.push(path);
        return;
      }

      if (typeof obj1 === 'object' && obj1 !== null && obj2 !== null) {
        for (const key of Object.keys(obj2 as object)) {
          compare(
            (obj1 as Record<string, unknown>)[key],
            (obj2 as Record<string, unknown>)[key],
            path ? `${path}.${key}` : key
          );
        }
      }
    };

    compare(current, updates, '');
    return paths;
  }

  private incrementVersion(version: string): string {
    const parts = version.split('.').map(Number);
    parts[2] = (parts[2] ?? 0) + 1;
    return parts.join('.');
  }

  private async loadFromSource(source: ConfigSource): Promise<Partial<DynamicConfig> | null> {
    switch (source.type) {
      case 'file':
        // In Node.js environment, would use fs.readFile
        // For now, return null
        return null;

      case 'environment':
        return this.loadFromEnvironment();

      case 'remote':
        if (source.location) {
          const response = await fetch(source.location);
          return await response.json() as Partial<DynamicConfig>;
        }
        return null;

      case 'memory':
        return null;

      default:
        return null;
    }
  }

  private loadFromEnvironment(): Partial<DynamicConfig> {
    const config: Partial<DynamicConfig> = {};

    // Example environment variable mappings
    if (process.env.AUTHZ_AGENTS_ENABLED) {
      config.agents = {
        ...config.agents,
        enabled: process.env.AUTHZ_AGENTS_ENABLED === 'true',
      } as AgentConfig;
    }

    if (process.env.AUTHZ_LOG_LEVEL) {
      config.agents = {
        ...config.agents,
        logLevel: process.env.AUTHZ_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error',
      } as AgentConfig;
    }

    return config;
  }

  private selectVariant(test: ABTestConfig, key: string): string {
    let selection: number;

    switch (test.allocationStrategy) {
      case 'user-hash':
      case 'session-hash':
        selection = this.hashString(key + test.id);
        break;
      case 'random':
      default:
        selection = Math.random() * 100;
    }

    let cumulative = 0;
    for (const variant of test.variants) {
      cumulative += variant.weight;
      if (selection < cumulative) {
        return variant.id;
      }
    }

    return test.variants[test.variants.length - 1].id;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash) % 100;
  }

  private evaluateCondition(condition: FeatureFlagCondition, context: Record<string, unknown>): boolean {
    const value = this.getNestedValue(context, condition.field);

    switch (condition.operator) {
      case 'eq':
        return value === condition.value;
      case 'ne':
        return value !== condition.value;
      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(value);
      case 'contains':
        return Array.isArray(value) && value.includes(condition.value);
      case 'gt':
        return typeof value === 'number' && typeof condition.value === 'number' && value > condition.value;
      case 'lt':
        return typeof value === 'number' && typeof condition.value === 'number' && value < condition.value;
      default:
        return false;
    }
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce((current: unknown, key) => {
      if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
  }
}
