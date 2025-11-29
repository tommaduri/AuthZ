/**
 * Training Types for Neural Engine
 *
 * Defines interfaces for training pipelines, datasets, and model management.
 */

import type { PatternType, NormalizationParams } from '../patterns/types.js';

// =============================================================================
// Training Configuration Types
// =============================================================================

export interface TrainingConfig {
  /** Batch size for training */
  batchSize: number;
  /** Learning rate */
  learningRate: number;
  /** Number of epochs */
  epochs: number;
  /** Validation split ratio (0-1) */
  validationSplit: number;
  /** Early stopping patience */
  earlyStoppingPatience?: number;
  /** Regularization strength */
  regularization?: number;
  /** Use WASM acceleration if available */
  useWasmAcceleration?: boolean;
}

export interface TrainingData {
  /** Input feature vectors */
  inputs: number[][];
  /** Output labels/targets */
  outputs: number[][];
  /** Optional metadata for each sample */
  metadata?: Record<string, unknown>[];
}

export interface TrainingResult {
  /** Trained model ID */
  modelId: string;
  /** Final training metrics */
  metrics: TrainingMetrics;
  /** Training duration in ms */
  trainingTimeMs: number;
  /** Epochs completed */
  epochsCompleted: number;
  /** Whether training converged */
  converged: boolean;
  /** Best validation loss achieved */
  bestValidationLoss: number;
}

export interface TrainingMetrics {
  /** Training loss */
  loss: number;
  /** Validation loss */
  validationLoss: number;
  /** Accuracy (if applicable) */
  accuracy?: number;
  /** Validation accuracy */
  validationAccuracy?: number;
  /** Precision for anomaly detection */
  precision?: number;
  /** Recall for anomaly detection */
  recall?: number;
  /** F1 score */
  f1Score?: number;
  /** Area under ROC curve */
  auc?: number;
}

export interface EpochResult {
  /** Epoch number */
  epoch: number;
  /** Training loss */
  loss: number;
  /** Validation loss */
  validationLoss: number;
  /** Learning rate used */
  learningRate: number;
  /** Time for this epoch in ms */
  epochTimeMs: number;
}

// =============================================================================
// Model Architecture Types
// =============================================================================

export interface ModelArchitecture {
  /** Architecture type */
  type: 'autoencoder' | 'classifier' | 'feedforward' | 'lstm';
  /** Layer definitions */
  layers: LayerConfig[];
  /** Input dimension */
  inputDimension: number;
  /** Output dimension */
  outputDimension: number;
}

export interface LayerConfig {
  /** Layer type */
  type: 'dense' | 'dropout' | 'batchnorm' | 'lstm' | 'embedding';
  /** Number of units (for dense/lstm) */
  units?: number;
  /** Activation function */
  activation?: 'relu' | 'sigmoid' | 'tanh' | 'softmax' | 'linear';
  /** Dropout rate (for dropout layers) */
  dropoutRate?: number;
  /** Return sequences (for lstm) */
  returnSequences?: boolean;
}

// =============================================================================
// Model Types
// =============================================================================

export interface Model {
  /** Unique model identifier */
  id: string;
  /** Model version */
  version: number;
  /** Pattern type this model is for */
  patternType: PatternType;
  /** Model architecture */
  architecture: ModelArchitecture;
  /** Model weights (flattened) */
  weights: Float32Array;
  /** Bias values */
  biases: Float32Array;
  /** Training metrics */
  metrics: TrainingMetrics;
  /** Normalization parameters */
  normalization?: NormalizationParams;
  /** Creation timestamp */
  createdAt: Date;
  /** Last used timestamp */
  lastUsedAt?: Date;
}

export interface ModelMetadata {
  /** Model ID */
  id: string;
  /** Version */
  version: number;
  /** Pattern type */
  patternType: PatternType;
  /** Training metrics */
  metrics: TrainingMetrics;
  /** Created at */
  createdAt: Date;
  /** Size in bytes */
  sizeBytes: number;
  /** Number of parameters */
  parameterCount: number;
}

// =============================================================================
// Dataset Types
// =============================================================================

export interface Dataset {
  /** Dataset ID */
  id: string;
  /** Dataset name */
  name: string;
  /** Training data */
  training: TrainingData;
  /** Validation data */
  validation?: TrainingData;
  /** Test data */
  test?: TrainingData;
  /** Feature names */
  featureNames: string[];
  /** Label names (if classification) */
  labelNames?: string[];
  /** Dataset statistics */
  statistics: DatasetStatistics;
  /** Creation timestamp */
  createdAt: Date;
}

export interface DatasetStatistics {
  /** Number of samples */
  sampleCount: number;
  /** Feature dimension */
  featureDimension: number;
  /** Output dimension */
  outputDimension: number;
  /** Class distribution (if classification) */
  classDistribution?: Record<string, number>;
  /** Feature statistics */
  featureStats: FeatureStatistics[];
}

export interface FeatureStatistics {
  /** Feature name */
  name: string;
  /** Mean value */
  mean: number;
  /** Standard deviation */
  stdDev: number;
  /** Min value */
  min: number;
  /** Max value */
  max: number;
  /** Missing count */
  missingCount: number;
}

// =============================================================================
// Training Pipeline Types
// =============================================================================

export interface PipelineConfig {
  /** Training configuration */
  training: TrainingConfig;
  /** Model architecture */
  architecture: ModelArchitecture;
  /** Preprocessing options */
  preprocessing: PreprocessingConfig;
  /** Callbacks for training events */
  callbacks?: TrainingCallbacks;
}

export interface PreprocessingConfig {
  /** Normalize features */
  normalize: boolean;
  /** Normalization method */
  normalizationMethod: 'standard' | 'minmax' | 'robust';
  /** Handle missing values */
  handleMissing: 'drop' | 'mean' | 'median' | 'zero';
  /** Remove outliers */
  removeOutliers: boolean;
  /** Outlier threshold (standard deviations) */
  outlierThreshold?: number;
}

export interface TrainingCallbacks {
  /** Called at start of training */
  onTrainingStart?: () => void;
  /** Called at end of each epoch */
  onEpochEnd?: (result: EpochResult) => void;
  /** Called when validation improves */
  onValidationImprove?: (loss: number) => void;
  /** Called at end of training */
  onTrainingEnd?: (result: TrainingResult) => void;
}

// =============================================================================
// Incremental Training Types
// =============================================================================

export interface IncrementalUpdateConfig {
  /** Base model ID to update */
  baseModelId: string;
  /** New training data */
  newData: TrainingData;
  /** Learning rate for update (usually lower than initial) */
  learningRate: number;
  /** Number of update epochs */
  epochs: number;
  /** Maximum model versions to keep */
  maxVersions?: number;
}

export interface IncrementalUpdateResult {
  /** Updated model ID */
  modelId: string;
  /** New version number */
  version: number;
  /** Improvement over base model */
  improvement: {
    lossReduction: number;
    accuracyGain?: number;
  };
  /** Update duration in ms */
  updateTimeMs: number;
}

// =============================================================================
// Online Learning Types
// =============================================================================

export interface OnlineLearningConfig {
  /** Model ID for online updates */
  modelId: string;
  /** Buffer size for batching */
  bufferSize: number;
  /** Update frequency (samples) */
  updateFrequency: number;
  /** Learning rate */
  learningRate: number;
  /** Decay rate for old samples */
  decayRate?: number;
}

export interface OnlineSample {
  /** Input features */
  input: number[];
  /** Expected output */
  output: number[];
  /** Sample weight */
  weight?: number;
  /** Timestamp */
  timestamp: Date;
}
