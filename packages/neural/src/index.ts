/**
 * @authz-engine/neural
 *
 * Neural pattern engine for authorization anomaly detection and behavioral analysis.
 *
 * This package provides:
 * - Pattern recognition for access anomalies, temporal violations, and behavioral deviations
 * - Training pipelines for authorization-specific neural models
 * - Real-time inference with caching and ensemble predictions
 * - Pre-built models for common authorization use cases
 *
 * @example
 * ```typescript
 * import {
 *   PatternRecognizer,
 *   TrainingPipeline,
 *   InferenceEngine,
 *   AuthorizationModelFactory,
 * } from '@authz-engine/neural';
 *
 * // Create pattern recognizer
 * const recognizer = new PatternRecognizer({
 *   anomalyThreshold: 0.7,
 *   minObservations: 10,
 *   temporalWindowHours: 24,
 *   enableBehavioralProfiling: true,
 *   enablePrivilegeEscalation: true,
 * });
 *
 * // Build behavior profile from historical data
 * const profile = await recognizer.buildProfile(decisionRecords);
 *
 * // Detect anomalies
 * const result = await recognizer.detectAnomaly(request, profile);
 * if (result.isAnomaly) {
 *   console.log('Anomaly detected:', result.category, result.score);
 * }
 * ```
 */

// =============================================================================
// Pattern Recognition
// =============================================================================

export { PatternRecognizer } from './patterns/PatternRecognizer.js';

export type {
  // Core pattern types
  PatternType,
  AnomalyCategory,
  Pattern,
  AccessPattern,
  TemporalPattern,
  BehavioralPattern,
  PrivilegeEscalationPattern,

  // Anomaly detection
  AnomalyResult,
  AnomalyFactor,

  // Behavioral profiling
  BehaviorProfile,
  TimeDistribution,
  TimeWindow,
  ResourceFrequency,
  ActionFrequency,
  VelocityProfile,

  // Feature engineering
  FeatureVector,
  NormalizationParams,
  FeatureExtractorConfig,
  FeatureExtractor,
  FeatureInput,

  // Decision records
  DecisionRecord,

  // Configuration
  PatternRecognizerConfig,
  PatternDetector,

  // Predictions
  PredictionResult,
  RiskAssessment,
  RiskFactor,
} from './patterns/types.js';

// =============================================================================
// Training Pipeline
// =============================================================================

export { TrainingPipeline } from './training/TrainingPipeline.js';
export { Dataset } from './training/Dataset.js';

export type {
  // Training configuration
  TrainingConfig,
  TrainingData,
  TrainingResult,
  TrainingMetrics,
  EpochResult,
  PipelineConfig,
  PreprocessingConfig,
  TrainingCallbacks,

  // Model architecture
  ModelArchitecture,
  LayerConfig,
  Model,
  ModelMetadata,

  // Dataset
  DatasetStatistics,
  FeatureStatistics,

  // Incremental training
  IncrementalUpdateConfig,
  IncrementalUpdateResult,

  // Online learning
  OnlineLearningConfig,
  OnlineSample,
} from './training/types.js';

// =============================================================================
// Inference Engine
// =============================================================================

export { InferenceEngine } from './inference/InferenceEngine.js';

export type {
  // Configuration
  InferenceConfig,
  InferenceEngineConfig,
  EnsembleStrategy,

  // Request/Response
  InferenceRequest,
  InferenceResponse,
  InferenceOptions,
  BatchInferenceRequest,
  BatchInferenceResponse,
  FeatureImportance,

  // Streaming
  StreamingInferenceConfig,

  // Cache
  InferenceCache,
  CacheStats,

  // Ensemble
  EnsembleConfig,
  EnsembleResult,
  IndividualPrediction,
  AggregationOptions,

  // Real-time detection
  RealTimeDetectorConfig,
  AnomalyDetectionResult,

  // Model loading
  ModelLoader,
} from './inference/types.js';

// =============================================================================
// Pre-built Models
// =============================================================================

export {
  AuthorizationModelFactory,
  DEFAULT_AUTHORIZATION_NORMALIZATION,
  AUTHORIZATION_FEATURE_NAMES,
} from './models/AuthorizationModels.js';

export type {
  AuthorizationModelConfig,
  AuthorizationModelType,
} from './models/AuthorizationModels.js';
