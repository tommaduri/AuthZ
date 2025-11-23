/**
 * Training module exports
 */

export { TrainingPipeline } from './TrainingPipeline.js';
export { Dataset } from './Dataset.js';

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

  // Dataset types
  DatasetStatistics,
  FeatureStatistics,

  // Incremental training
  IncrementalUpdateConfig,
  IncrementalUpdateResult,

  // Online learning
  OnlineLearningConfig,
  OnlineSample,
} from './types.js';

