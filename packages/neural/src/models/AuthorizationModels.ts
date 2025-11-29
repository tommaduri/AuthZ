/**
 * AuthorizationModels - Pre-built models for authorization pattern detection
 *
 * Provides factory functions and pre-configured models for common
 * authorization use cases like anomaly detection, risk scoring, and
 * privilege escalation detection.
 */

import type { Model, ModelArchitecture } from '../training/types.js';
import type { PatternType, NormalizationParams } from '../patterns/types.js';

/**
 * Configuration for creating authorization models
 */
export interface AuthorizationModelConfig {
  /** Input feature dimension */
  inputDimension: number;
  /** Hidden layer size (default: 2x input) */
  hiddenSize?: number;
  /** Bottleneck size for autoencoder (default: input/4) */
  bottleneckSize?: number;
  /** Number of risk classes (for classifier) */
  numClasses?: number;
  /** Dropout rate for regularization */
  dropoutRate?: number;
}

/**
 * Pre-built model types for authorization
 */
export type AuthorizationModelType =
  | 'anomaly_detector'
  | 'risk_classifier'
  | 'temporal_analyzer'
  | 'behavioral_profiler'
  | 'privilege_escalation_detector';

/**
 * Factory for creating authorization-optimized neural models
 */
export class AuthorizationModelFactory {
  /**
   * Create an anomaly detection model (autoencoder)
   */
  static createAnomalyDetector(config: AuthorizationModelConfig): Model {
    const inputDim = config.inputDimension;
    const hiddenSize = config.hiddenSize ?? inputDim * 2;
    const bottleneckSize = config.bottleneckSize ?? Math.floor(inputDim / 4);

    const architecture: ModelArchitecture = {
      type: 'autoencoder',
      inputDimension: inputDim,
      outputDimension: inputDim,
      layers: [
        // Encoder
        { type: 'dense', units: hiddenSize, activation: 'relu' },
        ...(config.dropoutRate ? [{ type: 'dropout' as const, dropoutRate: config.dropoutRate }] : []),
        { type: 'dense', units: bottleneckSize, activation: 'relu' },
        // Decoder
        { type: 'dense', units: hiddenSize, activation: 'relu' },
        ...(config.dropoutRate ? [{ type: 'dropout' as const, dropoutRate: config.dropoutRate }] : []),
        { type: 'dense', units: inputDim, activation: 'sigmoid' },
      ],
    };

    return AuthorizationModelFactory.createModel(
      'anomaly-detector',
      'anomaly',
      architecture
    );
  }

  /**
   * Create a risk classification model
   */
  static createRiskClassifier(config: AuthorizationModelConfig): Model {
    const inputDim = config.inputDimension;
    const hiddenSize = config.hiddenSize ?? inputDim * 2;
    const numClasses = config.numClasses ?? 4; // low, medium, high, critical

    const architecture: ModelArchitecture = {
      type: 'classifier',
      inputDimension: inputDim,
      outputDimension: numClasses,
      layers: [
        { type: 'dense', units: hiddenSize, activation: 'relu' },
        { type: 'dropout', dropoutRate: config.dropoutRate ?? 0.3 },
        { type: 'dense', units: Math.floor(hiddenSize / 2), activation: 'relu' },
        { type: 'dropout', dropoutRate: config.dropoutRate ?? 0.2 },
        { type: 'dense', units: numClasses, activation: 'softmax' },
      ],
    };

    return AuthorizationModelFactory.createModel(
      'risk-classifier',
      'behavioral',
      architecture
    );
  }

  /**
   * Create a temporal pattern analyzer
   */
  static createTemporalAnalyzer(config: AuthorizationModelConfig): Model {
    const inputDim = config.inputDimension;
    const hiddenSize = config.hiddenSize ?? 64;

    const architecture: ModelArchitecture = {
      type: 'feedforward',
      inputDimension: inputDim,
      outputDimension: 2, // [normal_probability, anomaly_probability]
      layers: [
        { type: 'dense', units: hiddenSize, activation: 'relu' },
        { type: 'dense', units: Math.floor(hiddenSize / 2), activation: 'relu' },
        { type: 'dense', units: 2, activation: 'softmax' },
      ],
    };

    return AuthorizationModelFactory.createModel(
      'temporal-analyzer',
      'temporal',
      architecture
    );
  }

  /**
   * Create a behavioral profiler model
   */
  static createBehavioralProfiler(config: AuthorizationModelConfig): Model {
    const inputDim = config.inputDimension;
    const hiddenSize = config.hiddenSize ?? inputDim;
    const bottleneckSize = config.bottleneckSize ?? Math.floor(inputDim / 2);

    const architecture: ModelArchitecture = {
      type: 'autoencoder',
      inputDimension: inputDim,
      outputDimension: inputDim,
      layers: [
        { type: 'dense', units: hiddenSize, activation: 'relu' },
        { type: 'dense', units: bottleneckSize, activation: 'relu' },
        { type: 'dense', units: hiddenSize, activation: 'relu' },
        { type: 'dense', units: inputDim, activation: 'sigmoid' },
      ],
    };

    return AuthorizationModelFactory.createModel(
      'behavioral-profiler',
      'behavioral',
      architecture
    );
  }

  /**
   * Create a privilege escalation detector
   */
  static createPrivilegeEscalationDetector(config: AuthorizationModelConfig): Model {
    const inputDim = config.inputDimension;
    const hiddenSize = config.hiddenSize ?? 32;

    const architecture: ModelArchitecture = {
      type: 'classifier',
      inputDimension: inputDim,
      outputDimension: 2, // [normal, escalation_attempt]
      layers: [
        { type: 'dense', units: hiddenSize, activation: 'relu' },
        { type: 'dense', units: Math.floor(hiddenSize / 2), activation: 'relu' },
        { type: 'dense', units: 2, activation: 'softmax' },
      ],
    };

    return AuthorizationModelFactory.createModel(
      'privilege-escalation-detector',
      'privilege_escalation',
      architecture
    );
  }

  /**
   * Create a model by type
   */
  static create(type: AuthorizationModelType, config: AuthorizationModelConfig): Model {
    switch (type) {
      case 'anomaly_detector':
        return this.createAnomalyDetector(config);
      case 'risk_classifier':
        return this.createRiskClassifier(config);
      case 'temporal_analyzer':
        return this.createTemporalAnalyzer(config);
      case 'behavioral_profiler':
        return this.createBehavioralProfiler(config);
      case 'privilege_escalation_detector':
        return this.createPrivilegeEscalationDetector(config);
      default:
        throw new Error(`Unknown model type: ${type}`);
    }
  }

  /**
   * Get default feature dimension for authorization
   */
  static getDefaultFeatureDimension(): number {
    // Standard authorization feature vector:
    // - 4 temporal features (hour, day, is_weekend, is_business_hours)
    // - 2 role features (role_count, has_admin)
    // - 3 action features (action_count, has_write, has_delete)
    // - 3 resource features (resource_hash, is_sensitive, resource_tier)
    // - 3 velocity features (requests_hour, requests_day, burst_score)
    // - 5 behavioral features (deviation_score, pattern_match, etc.)
    return 20;
  }

  /**
   * Get recommended training config for authorization models
   */
  static getRecommendedTrainingConfig(modelType: AuthorizationModelType): {
    batchSize: number;
    learningRate: number;
    epochs: number;
    validationSplit: number;
    earlyStoppingPatience: number;
  } {
    const baseConfig = {
      batchSize: 32,
      learningRate: 0.001,
      epochs: 100,
      validationSplit: 0.2,
      earlyStoppingPatience: 10,
    };

    switch (modelType) {
      case 'anomaly_detector':
        return {
          ...baseConfig,
          learningRate: 0.0001, // Lower for autoencoder
          epochs: 150,
        };
      case 'risk_classifier':
        return {
          ...baseConfig,
          batchSize: 64,
          epochs: 50,
        };
      case 'temporal_analyzer':
        return {
          ...baseConfig,
          batchSize: 16,
          epochs: 80,
        };
      default:
        return baseConfig;
    }
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  private static createModel(
    id: string,
    patternType: PatternType,
    architecture: ModelArchitecture
  ): Model {
    // Initialize weights using Xavier initialization
    const weights = AuthorizationModelFactory.initializeWeights(architecture);
    const biases = AuthorizationModelFactory.initializeBiases(architecture);

    return {
      id: `${id}-${Date.now()}`,
      version: 1,
      patternType,
      architecture,
      weights: new Float32Array(weights),
      biases: new Float32Array(biases),
      metrics: {
        loss: 0,
        validationLoss: 0,
      },
      createdAt: new Date(),
    };
  }

  private static initializeWeights(architecture: ModelArchitecture): number[] {
    const weights: number[] = [];
    let prevUnits = architecture.inputDimension;

    for (const layer of architecture.layers) {
      if (layer.type === 'dense' && layer.units) {
        // Xavier initialization
        const scale = Math.sqrt(2 / (prevUnits + layer.units));
        for (let i = 0; i < prevUnits * layer.units; i++) {
          weights.push((Math.random() - 0.5) * 2 * scale);
        }
        prevUnits = layer.units;
      }
    }

    return weights;
  }

  private static initializeBiases(architecture: ModelArchitecture): number[] {
    const biases: number[] = [];

    for (const layer of architecture.layers) {
      if (layer.type === 'dense' && layer.units) {
        for (let i = 0; i < layer.units; i++) {
          biases.push(0);
        }
      }
    }

    return biases;
  }
}

/**
 * Standard normalization parameters for authorization features
 */
export const DEFAULT_AUTHORIZATION_NORMALIZATION: NormalizationParams = {
  means: [
    12, // hour_of_day (0-23, mean ~12)
    3, // day_of_week (0-6, mean ~3)
    0.29, // is_weekend (0-1, ~2/7)
    0.33, // is_business_hours (0-1, ~8/24)
    2, // role_count (typically 1-5)
    0.1, // has_admin_role (0-1, ~10% users)
    1.5, // action_count (typically 1-3)
    0.4, // has_write_action (0-1)
    0.1, // has_delete_action (0-1)
    50, // resource_kind_hash (0-100)
    0.1, // is_sensitive_resource (0-1)
    5, // requests_last_hour (typically 0-20)
    0.5, // deviation_score (0-1)
    0.7, // baseline_match (0-1)
    0.3, // velocity_ratio (0-1)
    0.5, // time_factor (0-1)
    0.4, // resource_familiarity (0-1)
    0.6, // action_typicality (0-1)
    0.2, // role_elevation (0-1)
    0.1, // burst_indicator (0-1)
  ],
  stdDevs: [
    7, // hour_of_day
    2, // day_of_week
    0.45, // is_weekend
    0.47, // is_business_hours
    1.5, // role_count
    0.3, // has_admin_role
    1, // action_count
    0.49, // has_write_action
    0.3, // has_delete_action
    30, // resource_kind_hash
    0.3, // is_sensitive_resource
    8, // requests_last_hour
    0.3, // deviation_score
    0.2, // baseline_match
    0.25, // velocity_ratio
    0.3, // time_factor
    0.3, // resource_familiarity
    0.25, // action_typicality
    0.25, // role_elevation
    0.2, // burst_indicator
  ],
};

/**
 * Feature names for standard authorization vector
 */
export const AUTHORIZATION_FEATURE_NAMES = [
  'hour_of_day',
  'day_of_week',
  'is_weekend',
  'is_business_hours',
  'role_count',
  'has_admin_role',
  'action_count',
  'has_write_action',
  'has_delete_action',
  'resource_kind_hash',
  'is_sensitive_resource',
  'requests_last_hour',
  'deviation_score',
  'baseline_match',
  'velocity_ratio',
  'time_factor',
  'resource_familiarity',
  'action_typicality',
  'role_elevation',
  'burst_indicator',
];
