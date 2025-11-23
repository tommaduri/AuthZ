/**
 * Platform Configuration
 *
 * Configuration management for the platform, including validation
 * and default value generation.
 */

import type { PlatformConfig } from '../orchestrator/types.js';

/**
 * Validation result for platform configuration
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Create default platform configuration
 */
export function createDefaultConfig(): PlatformConfig {
  return {
    instanceId: undefined,
    swarm: {
      topology: {
        type: 'mesh',
        maxConnections: 50,
        failoverEnabled: true,
      },
      loadBalancing: {
        strategy: 'round-robin',
        healthCheckIntervalMs: 10000,
        failoverThreshold: 3,
      },
      scaling: {
        minAgents: 2,
        maxAgents: 10,
        scaleUpThreshold: 0.8,
        scaleDownThreshold: 0.2,
        cooldownPeriodMs: 60000,
      },
    },
    neural: {
      patterns: [
        { type: 'anomaly', enabled: true, threshold: 0.7 },
        { type: 'behavioral', enabled: true, threshold: 0.6 },
        { type: 'temporal', enabled: false },
        { type: 'risk', enabled: true, threshold: 0.8 },
        { type: 'correlation', enabled: false },
      ],
      training: {
        batchSize: 32,
        epochs: 10,
        learningRate: 0.001,
        validationSplit: 0.2,
        useWasmAcceleration: false,
        autoTrainIntervalMs: 86400000, // 24 hours
      },
      inferenceCache: {
        enabled: true,
        maxSize: 10000,
        ttlMs: 300000, // 5 minutes
      },
    },
    consensus: {
      default: 'pbft',
      thresholds: {
        quorum: 0.67,
        timeoutMs: 10000,
        maxRetries: 3,
      },
      enableForHighRisk: true,
      highRiskThreshold: 0.8,
    },
    memory: {
      vectorStore: {
        enabled: false,
        dimension: 384,
        indexType: 'ivfflat',
        distanceMetric: 'cosine',
      },
      cache: {
        enabled: true,
        maxSize: 100000,
        ttlMs: 3600000, // 1 hour
        namespaces: ['decisions', 'patterns', 'context', 'embeddings'],
      },
      eventStore: {
        enabled: true,
        retentionDays: 90,
        compactionIntervalMs: 86400000, // 24 hours
      },
    },
    logging: {
      level: 'info',
      format: 'json',
    },
    metrics: {
      enabled: true,
      collectIntervalMs: 30000, // 30 seconds
      retentionDays: 30,
    },
  };
}

/**
 * Validate platform configuration
 */
export function validatePlatformConfig(config: PlatformConfig): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate swarm configuration
  if (config.swarm) {
    const { scaling } = config.swarm;

    if (scaling.minAgents > scaling.maxAgents) {
      errors.push('swarm.scaling.minAgents cannot be greater than maxAgents');
    }

    if (scaling.minAgents < 1) {
      errors.push('swarm.scaling.minAgents must be at least 1');
    }

    if (scaling.maxAgents > 100) {
      warnings.push('swarm.scaling.maxAgents > 100 may impact performance');
    }

    if (scaling.scaleUpThreshold <= scaling.scaleDownThreshold) {
      errors.push('swarm.scaling.scaleUpThreshold must be greater than scaleDownThreshold');
    }

    if (scaling.cooldownPeriodMs < 10000) {
      warnings.push('swarm.scaling.cooldownPeriodMs < 10s may cause scaling thrashing');
    }

    // Validate topology
    const validTopologies = ['mesh', 'hierarchical', 'ring', 'star', 'adaptive'];
    if (!validTopologies.includes(config.swarm.topology.type)) {
      errors.push(`Invalid swarm topology: ${config.swarm.topology.type}`);
    }

    // Validate load balancing strategy
    const validStrategies = ['round-robin', 'weighted', 'least-connections', 'adaptive'];
    if (!validStrategies.includes(config.swarm.loadBalancing.strategy)) {
      errors.push(`Invalid load balancing strategy: ${config.swarm.loadBalancing.strategy}`);
    }
  }

  // Validate neural configuration
  if (config.neural) {
    const { training, inferenceCache } = config.neural;

    if (training.batchSize < 1) {
      errors.push('neural.training.batchSize must be at least 1');
    }

    if (training.epochs < 1) {
      errors.push('neural.training.epochs must be at least 1');
    }

    if (training.learningRate <= 0 || training.learningRate > 1) {
      errors.push('neural.training.learningRate must be between 0 and 1');
    }

    if (training.validationSplit < 0 || training.validationSplit > 1) {
      errors.push('neural.training.validationSplit must be between 0 and 1');
    }

    if (inferenceCache.enabled && inferenceCache.maxSize < 100) {
      warnings.push('neural.inferenceCache.maxSize < 100 may reduce cache effectiveness');
    }

    // Validate pattern types
    const validPatternTypes = ['anomaly', 'temporal', 'behavioral', 'risk', 'correlation'];
    for (const pattern of config.neural.patterns) {
      if (!validPatternTypes.includes(pattern.type)) {
        errors.push(`Invalid pattern type: ${pattern.type}`);
      }
      if (pattern.threshold !== undefined && (pattern.threshold < 0 || pattern.threshold > 1)) {
        errors.push(`Pattern threshold must be between 0 and 1: ${pattern.type}`);
      }
    }
  }

  // Validate consensus configuration
  if (config.consensus) {
    const { thresholds } = config.consensus;

    if (thresholds.quorum < 0.5 || thresholds.quorum > 1) {
      errors.push('consensus.thresholds.quorum must be between 0.5 and 1');
    }

    if (thresholds.timeoutMs < 1000) {
      warnings.push('consensus.thresholds.timeoutMs < 1s may cause premature timeouts');
    }

    if (config.consensus.highRiskThreshold < 0 || config.consensus.highRiskThreshold > 1) {
      errors.push('consensus.highRiskThreshold must be between 0 and 1');
    }

    // Validate protocol
    const validProtocols = ['pbft', 'raft', 'gossip'];
    if (!validProtocols.includes(config.consensus.default)) {
      errors.push(`Invalid consensus protocol: ${config.consensus.default}`);
    }
  }

  // Validate memory configuration
  if (config.memory) {
    const { vectorStore, cache, eventStore } = config.memory;

    if (vectorStore.enabled) {
      if (vectorStore.dimension < 1) {
        errors.push('memory.vectorStore.dimension must be at least 1');
      }

      const validIndexTypes = ['ivfflat', 'hnsw'];
      if (!validIndexTypes.includes(vectorStore.indexType)) {
        errors.push(`Invalid vector index type: ${vectorStore.indexType}`);
      }

      const validMetrics = ['cosine', 'euclidean', 'inner_product'];
      if (!validMetrics.includes(vectorStore.distanceMetric)) {
        errors.push(`Invalid distance metric: ${vectorStore.distanceMetric}`);
      }
    }

    if (cache.enabled && cache.maxSize < 1000) {
      warnings.push('memory.cache.maxSize < 1000 may reduce cache effectiveness');
    }

    if (eventStore.enabled && eventStore.retentionDays < 7) {
      warnings.push('memory.eventStore.retentionDays < 7 may limit audit capabilities');
    }
  }

  // Validate logging configuration
  if (config.logging) {
    const validLevels = ['debug', 'info', 'warn', 'error'];
    if (!validLevels.includes(config.logging.level)) {
      errors.push(`Invalid log level: ${config.logging.level}`);
    }

    const validFormats = ['json', 'pretty'];
    if (!validFormats.includes(config.logging.format)) {
      errors.push(`Invalid log format: ${config.logging.format}`);
    }
  }

  // Validate metrics configuration
  if (config.metrics) {
    if (config.metrics.collectIntervalMs < 1000) {
      warnings.push('metrics.collectIntervalMs < 1s may impact performance');
    }

    if (config.metrics.retentionDays < 1) {
      errors.push('metrics.retentionDays must be at least 1');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Merge partial configuration with defaults
 */
export function mergeWithDefaults(partial: Partial<PlatformConfig>): PlatformConfig {
  const defaults = createDefaultConfig();

  return {
    instanceId: partial.instanceId ?? defaults.instanceId,
    swarm: {
      topology: { ...defaults.swarm.topology, ...partial.swarm?.topology },
      loadBalancing: { ...defaults.swarm.loadBalancing, ...partial.swarm?.loadBalancing },
      scaling: { ...defaults.swarm.scaling, ...partial.swarm?.scaling },
    },
    neural: {
      patterns: partial.neural?.patterns ?? defaults.neural.patterns,
      training: { ...defaults.neural.training, ...partial.neural?.training },
      inferenceCache: { ...defaults.neural.inferenceCache, ...partial.neural?.inferenceCache },
    },
    consensus: {
      ...defaults.consensus,
      ...partial.consensus,
      thresholds: { ...defaults.consensus.thresholds, ...partial.consensus?.thresholds },
    },
    memory: {
      vectorStore: { ...defaults.memory.vectorStore, ...partial.memory?.vectorStore },
      cache: { ...defaults.memory.cache, ...partial.memory?.cache },
      eventStore: { ...defaults.memory.eventStore, ...partial.memory?.eventStore },
    },
    logging: { ...defaults.logging, ...partial.logging },
    metrics: { ...defaults.metrics, ...partial.metrics },
  };
}

/**
 * Configuration presets for common deployment scenarios
 */
export const CONFIG_PRESETS = {
  /**
   * Development preset - minimal resources, verbose logging
   */
  development: (): Partial<PlatformConfig> => ({
    swarm: {
      topology: { type: 'star' },
      loadBalancing: { strategy: 'round-robin' },
      scaling: { minAgents: 1, maxAgents: 4, scaleUpThreshold: 0.9, scaleDownThreshold: 0.1, cooldownPeriodMs: 30000 },
    },
    neural: {
      patterns: [{ type: 'anomaly', enabled: true, threshold: 0.5 }],
      training: { batchSize: 16, epochs: 5, learningRate: 0.01, validationSplit: 0.2, useWasmAcceleration: false },
      inferenceCache: { enabled: true, maxSize: 1000, ttlMs: 60000 },
    },
    consensus: {
      default: 'raft',
      thresholds: { quorum: 0.5, timeoutMs: 5000, maxRetries: 2 },
      enableForHighRisk: false,
      highRiskThreshold: 0.9,
    },
    logging: { level: 'debug', format: 'pretty' },
    metrics: { enabled: true, collectIntervalMs: 5000, retentionDays: 1 },
  }),

  /**
   * Production preset - high availability, optimized performance
   */
  production: (): Partial<PlatformConfig> => ({
    swarm: {
      topology: { type: 'mesh', maxConnections: 100, failoverEnabled: true },
      loadBalancing: { strategy: 'adaptive', healthCheckIntervalMs: 5000, failoverThreshold: 2 },
      scaling: { minAgents: 4, maxAgents: 20, scaleUpThreshold: 0.7, scaleDownThreshold: 0.3, cooldownPeriodMs: 120000 },
    },
    neural: {
      patterns: [
        { type: 'anomaly', enabled: true, threshold: 0.7 },
        { type: 'behavioral', enabled: true, threshold: 0.6 },
        { type: 'temporal', enabled: true, threshold: 0.65 },
        { type: 'risk', enabled: true, threshold: 0.75 },
      ],
      training: { batchSize: 64, epochs: 20, learningRate: 0.001, validationSplit: 0.2, useWasmAcceleration: true },
      inferenceCache: { enabled: true, maxSize: 100000, ttlMs: 600000 },
    },
    consensus: {
      default: 'pbft',
      thresholds: { quorum: 0.67, timeoutMs: 15000, maxRetries: 5 },
      enableForHighRisk: true,
      highRiskThreshold: 0.75,
    },
    logging: { level: 'info', format: 'json' },
    metrics: { enabled: true, collectIntervalMs: 60000, retentionDays: 90 },
  }),

  /**
   * High-security preset - maximum verification, strict consensus
   */
  highSecurity: (): Partial<PlatformConfig> => ({
    swarm: {
      topology: { type: 'hierarchical', maxConnections: 50, failoverEnabled: true },
      loadBalancing: { strategy: 'weighted', healthCheckIntervalMs: 3000, failoverThreshold: 1 },
      scaling: { minAgents: 6, maxAgents: 30, scaleUpThreshold: 0.6, scaleDownThreshold: 0.4, cooldownPeriodMs: 180000 },
    },
    neural: {
      patterns: [
        { type: 'anomaly', enabled: true, threshold: 0.5 },
        { type: 'behavioral', enabled: true, threshold: 0.4 },
        { type: 'temporal', enabled: true, threshold: 0.5 },
        { type: 'risk', enabled: true, threshold: 0.5 },
        { type: 'correlation', enabled: true, threshold: 0.6 },
      ],
      training: { batchSize: 32, epochs: 50, learningRate: 0.0001, validationSplit: 0.3, useWasmAcceleration: true },
      inferenceCache: { enabled: true, maxSize: 50000, ttlMs: 120000 },
    },
    consensus: {
      default: 'pbft',
      thresholds: { quorum: 0.8, timeoutMs: 30000, maxRetries: 5 },
      enableForHighRisk: true,
      highRiskThreshold: 0.5, // Lower threshold = more consensus
    },
    memory: {
      vectorStore: { enabled: true, dimension: 768, indexType: 'hnsw', distanceMetric: 'cosine' },
      cache: { enabled: true, maxSize: 50000, ttlMs: 1800000, namespaces: ['decisions', 'patterns', 'context', 'embeddings', 'audit'] },
      eventStore: { enabled: true, retentionDays: 365, compactionIntervalMs: 43200000 },
    },
    logging: { level: 'debug', format: 'json' },
    metrics: { enabled: true, collectIntervalMs: 10000, retentionDays: 365 },
  }),
} as const;

export type ConfigPreset = keyof typeof CONFIG_PRESETS;
