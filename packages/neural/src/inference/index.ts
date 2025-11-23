/**
 * Inference module exports
 */

export { InferenceEngine } from './InferenceEngine.js';

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

  // Anomaly detection
  RealTimeDetectorConfig,
  AnomalyDetectionResult,

  // Model loading
  ModelLoader,
  InferenceEngine as InferenceEngineInterface,
} from './types.js';
