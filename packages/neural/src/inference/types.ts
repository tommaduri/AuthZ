/**
 * Inference Types for Neural Engine
 *
 * Defines interfaces for real-time prediction and model inference.
 */

import type { Model } from '../training/types.js';
import type { PredictionResult, RiskAssessment } from '../patterns/types.js';

// =============================================================================
// Inference Configuration Types
// =============================================================================

export interface InferenceConfig {
  /** Enable result caching */
  enableCache: boolean;
  /** Cache TTL in seconds */
  cacheTtlSeconds: number;
  /** Maximum cache entries */
  maxCacheEntries: number;
  /** Enable ensemble prediction */
  enableEnsemble: boolean;
  /** Ensemble strategy */
  ensembleStrategy?: EnsembleStrategy;
  /** Timeout for inference in ms */
  timeoutMs: number;
  /** Batch inference size */
  batchSize: number;
}

export type EnsembleStrategy = 'average' | 'weighted' | 'voting' | 'stacking';

// =============================================================================
// Inference Request/Response Types
// =============================================================================

export interface InferenceRequest {
  /** Request ID for tracing */
  requestId: string;
  /** Model ID to use (or 'latest') */
  modelId: string;
  /** Input features */
  input: number[];
  /** Request options */
  options?: InferenceOptions;
}

export interface InferenceOptions {
  /** Return confidence intervals */
  includeConfidenceInterval?: boolean;
  /** Return feature importance */
  includeFeatureImportance?: boolean;
  /** Return explanation */
  includeExplanation?: boolean;
  /** Bypass cache */
  bypassCache?: boolean;
}

export interface InferenceResponse {
  /** Request ID */
  requestId: string;
  /** Model ID used */
  modelId: string;
  /** Prediction output */
  output: number[];
  /** Confidence score (0-1) */
  confidence: number;
  /** Inference latency in ms */
  latencyMs: number;
  /** Whether result was cached */
  cached: boolean;
  /** Feature importance (if requested) */
  featureImportance?: FeatureImportance[];
  /** Explanation (if requested) */
  explanation?: string;
}

export interface FeatureImportance {
  /** Feature name */
  featureName: string;
  /** Feature index */
  featureIndex: number;
  /** Importance score (0-1) */
  importance: number;
  /** Direction of impact */
  direction: 'positive' | 'negative';
}

// =============================================================================
// Batch Inference Types
// =============================================================================

export interface BatchInferenceRequest {
  /** Request ID */
  requestId: string;
  /** Model ID */
  modelId: string;
  /** Batch of inputs */
  inputs: number[][];
  /** Options */
  options?: InferenceOptions;
}

export interface BatchInferenceResponse {
  /** Request ID */
  requestId: string;
  /** Model ID used */
  modelId: string;
  /** Batch of outputs */
  outputs: number[][];
  /** Confidence scores */
  confidences: number[];
  /** Total latency */
  totalLatencyMs: number;
  /** Average latency per sample */
  avgLatencyMs: number;
}

// =============================================================================
// Streaming Inference Types
// =============================================================================

export interface StreamingInferenceConfig {
  /** Model ID */
  modelId: string;
  /** Buffer size for batching */
  bufferSize: number;
  /** Flush interval in ms */
  flushIntervalMs: number;
  /** Callback for results */
  onResult: (result: InferenceResponse) => void;
  /** Callback for errors */
  onError?: (error: Error) => void;
}

// =============================================================================
// Cache Types
// =============================================================================

export interface InferenceCache {
  /** Get cached result */
  get(key: string): InferenceResponse | undefined;
  /** Set cached result */
  set(key: string, value: InferenceResponse, ttlSeconds?: number): void;
  /** Clear cache */
  clear(): void;
  /** Get cache statistics */
  getStats(): CacheStats;
}

export interface CacheStats {
  /** Total cache hits */
  hits: number;
  /** Total cache misses */
  misses: number;
  /** Hit rate (0-1) */
  hitRate: number;
  /** Current entry count */
  entryCount: number;
  /** Memory usage estimate in bytes */
  memoryBytes: number;
}

// =============================================================================
// Ensemble Types
// =============================================================================

export interface EnsembleConfig {
  /** Models to include in ensemble */
  models: Model[];
  /** Ensemble strategy */
  strategy: EnsembleStrategy;
  /** Model weights (for weighted strategy) */
  weights?: number[];
  /** Aggregation options */
  aggregation?: AggregationOptions;
}

export interface AggregationOptions {
  /** Minimum agreement for voting */
  minAgreement?: number;
  /** Confidence threshold */
  confidenceThreshold?: number;
  /** Weight decay for older models */
  weightDecay?: number;
}

export interface EnsembleResult {
  /** Aggregated output */
  output: number[];
  /** Aggregated confidence */
  confidence: number;
  /** Individual model predictions */
  individualPredictions: IndividualPrediction[];
  /** Agreement score (0-1) */
  agreementScore: number;
}

export interface IndividualPrediction {
  /** Model ID */
  modelId: string;
  /** Model output */
  output: number[];
  /** Model confidence */
  confidence: number;
  /** Weight used in aggregation */
  weight: number;
}

// =============================================================================
// Real-time Anomaly Detection Types
// =============================================================================

export interface RealTimeDetectorConfig {
  /** Model for anomaly detection */
  model: Model;
  /** Anomaly threshold */
  threshold: number;
  /** Alert callback */
  onAnomaly: (result: AnomalyDetectionResult) => void;
  /** Sliding window size */
  windowSize: number;
  /** Minimum confidence for alert */
  minConfidence: number;
}

export interface AnomalyDetectionResult {
  /** Request ID */
  requestId: string;
  /** Anomaly score (0-1) */
  anomalyScore: number;
  /** Is anomalous */
  isAnomaly: boolean;
  /** Confidence */
  confidence: number;
  /** Detection timestamp */
  detectedAt: Date;
  /** Input that triggered detection */
  input: number[];
  /** Reconstruction (for autoencoder) */
  reconstruction?: number[];
  /** Reconstruction error */
  reconstructionError?: number;
}

// =============================================================================
// Inference Engine Types
// =============================================================================

export interface InferenceEngineConfig {
  /** Default model ID */
  defaultModelId?: string;
  /** Inference configuration */
  inference: InferenceConfig;
  /** Model storage/loading */
  modelLoader: ModelLoader;
}

export interface ModelLoader {
  /** Load model by ID */
  load(modelId: string): Promise<Model>;
  /** List available models */
  list(): Promise<string[]>;
  /** Check if model exists */
  exists(modelId: string): Promise<boolean>;
}

export interface InferenceEngine {
  /** Run inference on single input */
  predict(input: number[], modelId?: string): Promise<InferenceResponse>;
  /** Run batch inference */
  predictBatch(inputs: number[][], modelId?: string): Promise<BatchInferenceResponse>;
  /** Get prediction with full context */
  getPrediction(input: number[], modelId?: string): Promise<PredictionResult>;
  /** Assess risk for an input */
  assessRisk(input: number[], modelId?: string): Promise<RiskAssessment>;
  /** Detect anomaly */
  detectAnomaly(input: number[]): Promise<AnomalyDetectionResult>;
  /** Get cache statistics */
  getCacheStats(): CacheStats;
  /** Clear cache */
  clearCache(): void;
}
