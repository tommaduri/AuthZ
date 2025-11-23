/**
 * InferenceEngine - Real-time prediction and anomaly detection
 *
 * Provides caching, ensemble prediction, and risk assessment for authorization requests.
 */

import type {
  InferenceRequest,
  InferenceResponse,
  BatchInferenceResponse,
  CacheStats,
  InferenceEngineConfig,
  ModelLoader,
  FeatureImportance,
  EnsembleResult,
  IndividualPrediction,
  AnomalyDetectionResult,
} from './types.js';
import type { Model } from '../training/types.js';
import type { Pattern, PredictionResult, RiskAssessment, RiskFactor } from '../patterns/types.js';

interface CacheEntry {
  response: InferenceResponse;
  expiresAt: number;
}

export class InferenceEngine {
  private config: InferenceEngineConfig;
  private modelLoader: ModelLoader;
  private loadedModels: Map<string, Model> = new Map();
  private cache: Map<string, CacheEntry> = new Map();
  private cacheStats = { hits: 0, misses: 0 };

  constructor(config: InferenceEngineConfig) {
    this.config = config;
    this.modelLoader = config.modelLoader;
  }

  /**
   * Make a prediction for a single input
   */
  async predict(input: number[], modelId?: string): Promise<InferenceResponse> {
    const effectiveModelId = modelId ?? this.config.defaultModelId;
    if (!effectiveModelId) {
      throw new Error('No model ID specified and no default model set');
    }

    return this.predictWithOptions({
      requestId: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      modelId: effectiveModelId,
      input,
    });
  }

  /**
   * Make a prediction with full options
   */
  async predictWithOptions(request: InferenceRequest): Promise<InferenceResponse> {
    const startTime = Date.now();

    // Check cache
    const cacheKey = this.computeCacheKey(request.modelId, request.input);
    if (
      this.config.inference.enableCache &&
      !request.options?.bypassCache
    ) {
      const cached = this.getCachedResult(cacheKey);
      if (cached) {
        this.cacheStats.hits++;
        return {
          ...cached,
          requestId: request.requestId,
          cached: true,
        };
      }
      this.cacheStats.misses++;
    }

    // Load model
    const model = await this.getModel(request.modelId);

    // Run inference
    const output = this.runInference(request.input, model);

    // Compute confidence
    const confidence = this.computeConfidence(output, model);

    // Build response
    const response: InferenceResponse = {
      requestId: request.requestId,
      modelId: request.modelId,
      output,
      confidence,
      latencyMs: Date.now() - startTime,
      cached: false,
    };

    // Add optional fields
    if (request.options?.includeFeatureImportance) {
      response.featureImportance = this.computeFeatureImportance(
        request.input,
        model
      );
    }

    if (request.options?.includeExplanation) {
      response.explanation = this.generateExplanation(request.input, output, model);
    }

    // Cache result
    if (this.config.inference.enableCache && !request.options?.bypassCache) {
      this.setCachedResult(cacheKey, response);
    }

    return response;
  }

  /**
   * Make predictions for a batch of inputs
   */
  async predictBatch(
    inputs: number[][],
    modelId?: string
  ): Promise<BatchInferenceResponse> {
    const startTime = Date.now();
    const effectiveModelId = modelId ?? this.config.defaultModelId ?? 'default';

    if (inputs.length === 0) {
      return {
        requestId: `batch-${Date.now()}`,
        modelId: effectiveModelId,
        outputs: [],
        confidences: [],
        totalLatencyMs: 0,
        avgLatencyMs: 0,
      };
    }

    const model = await this.getModel(effectiveModelId);

    const outputs: number[][] = [];
    const confidences: number[] = [];

    for (const input of inputs) {
      const output = this.runInference(input, model);
      outputs.push(output);
      confidences.push(this.computeConfidence(output, model));
    }

    const totalLatencyMs = Date.now() - startTime;

    return {
      requestId: `batch-${Date.now()}`,
      modelId: effectiveModelId,
      outputs,
      confidences,
      totalLatencyMs,
      avgLatencyMs: totalLatencyMs / inputs.length,
    };
  }

  /**
   * Get a full prediction result with context
   */
  async getPrediction(input: number[], modelId?: string): Promise<PredictionResult> {
    const startTime = Date.now();
    const response = await this.predict(input, modelId);

    // Detect anomaly using the model
    const anomalyResult = await this.detectAnomaly(input);
    const anomalyScore = anomalyResult.anomalyScore;

    // Determine risk level
    const riskLevel = this.determineRiskLevel(anomalyScore);

    // Generate recommendations
    const recommendations = this.generateRecommendations(anomalyScore, riskLevel);

    // Create pattern object
    const pattern: Pattern = {
      id: `pattern-${Date.now()}`,
      type: 'access',
      confidence: response.confidence,
      features: input,
      metadata: {
        modelId: response.modelId,
        inferenceLatency: response.latencyMs,
      },
      detectedAt: new Date(),
    };

    return {
      pattern,
      confidence: response.confidence,
      anomalyScore,
      riskLevel,
      recommendations,
      modelId: response.modelId,
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * Assess risk for an input
   */
  async assessRisk(input: number[], _modelId?: string): Promise<RiskAssessment> {
    const anomalyResult = await this.detectAnomaly(input);
    const overallRisk = anomalyResult.anomalyScore;
    const level = this.determineRiskLevel(overallRisk);

    // Identify risk factors
    const factors: RiskFactor[] = [];

    // Check for extreme values
    const extremeValues = input.filter((v) => v < 0.1 || v > 0.9);
    if (extremeValues.length > input.length * 0.3) {
      factors.push({
        name: 'extreme_values',
        contribution: 0.3,
        description: 'Input contains many extreme values',
      });
    }

    // Check for reconstruction error (if autoencoder)
    if (anomalyResult.reconstructionError && anomalyResult.reconstructionError > 0.1) {
      factors.push({
        name: 'reconstruction_error',
        contribution: Math.min(anomalyResult.reconstructionError, 0.5),
        description: 'High reconstruction error indicates unusual pattern',
      });
    }

    // Add more factors based on score
    if (overallRisk > 0.7) {
      factors.push({
        name: 'high_anomaly_score',
        contribution: overallRisk * 0.5,
        description: 'Overall pattern deviates significantly from normal',
      });
    }

    return {
      overallRisk,
      level,
      factors,
      requiresVerification: overallRisk > 0.8,
      shouldBlock: overallRisk > 0.95,
    };
  }

  /**
   * Detect anomaly using autoencoder reconstruction
   */
  async detectAnomaly(input: number[]): Promise<AnomalyDetectionResult> {
    const modelId = this.config.defaultModelId ?? 'default';
    const model = await this.getModel(modelId);

    // Run inference (reconstruction)
    const reconstruction = this.runInference(input, model);

    // Compute reconstruction error (MSE)
    let reconstructionError = 0;
    for (let i = 0; i < input.length; i++) {
      const target = i < reconstruction.length ? reconstruction[i] : 0;
      reconstructionError += Math.pow(input[i] - target, 2);
    }
    reconstructionError = reconstructionError / input.length;

    // Convert to anomaly score (0-1)
    // Higher reconstruction error = higher anomaly score
    const computedAnomalyScore = Math.min(reconstructionError * 5, 1);

    // Threshold for anomaly (configurable)
    const threshold = 0.5;
    const isAnomaly = computedAnomalyScore > threshold;

    return {
      requestId: `anomaly-${Date.now()}`,
      anomalyScore: computedAnomalyScore,
      isAnomaly,
      confidence: this.computeConfidence(reconstruction, model),
      detectedAt: new Date(),
      input,
      reconstruction,
      reconstructionError,
    };
  }

  /**
   * Make ensemble predictions using multiple models
   */
  async predictEnsemble(
    input: number[],
    modelIds: string[]
  ): Promise<EnsembleResult> {
    const predictions: IndividualPrediction[] = [];

    for (const modelId of modelIds) {
      const model = await this.getModel(modelId);
      const output = this.runInference(input, model);
      const confidence = this.computeConfidence(output, model);

      predictions.push({
        modelId,
        output,
        confidence,
        weight: 1 / modelIds.length, // Equal weights for now
      });
    }

    // Aggregate based on strategy
    const strategy = this.config.inference.ensembleStrategy ?? 'average';
    const aggregatedOutput = this.aggregatePredictions(predictions, strategy);

    // Compute agreement score
    const agreementScore = this.computeAgreement(predictions);

    // Aggregate confidence
    const aggregatedConfidence =
      predictions.reduce((sum, p) => sum + p.confidence * p.weight, 0);

    return {
      output: aggregatedOutput,
      confidence: aggregatedConfidence,
      individualPredictions: predictions,
      agreementScore,
    };
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    const total = this.cacheStats.hits + this.cacheStats.misses;
    return {
      hits: this.cacheStats.hits,
      misses: this.cacheStats.misses,
      hitRate: total > 0 ? this.cacheStats.hits / total : 0,
      entryCount: this.cache.size,
      memoryBytes: this.estimateCacheMemory(),
    };
  }

  /**
   * Clear the inference cache
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheStats = { hits: 0, misses: 0 };
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  private async getModel(modelId: string): Promise<Model> {
    // Check if already loaded
    if (this.loadedModels.has(modelId)) {
      return this.loadedModels.get(modelId)!;
    }

    // Load from model loader
    try {
      const model = await this.modelLoader.load(modelId);
      this.loadedModels.set(modelId, model);
      return model;
    } catch (error) {
      throw new Error(`Model not found: ${modelId}`);
    }
  }

  private runInference(input: number[], model: Model): number[] {
    // Normalize input if normalization params exist
    let normalizedInput = input;
    if (model.normalization) {
      normalizedInput = input.map((v, i) => {
        const mean = model.normalization!.means[i] ?? 0;
        const std = model.normalization!.stdDevs[i] ?? 1;
        return (v - mean) / std;
      });
    }

    // Forward pass through network
    return this.forwardPass(normalizedInput, model);
  }

  private forwardPass(input: number[], model: Model): number[] {
    let current = [...input];
    let weightOffset = 0;
    let biasOffset = 0;
    const weights = Array.from(model.weights);
    const biases = Array.from(model.biases);

    for (const layer of model.architecture.layers) {
      if (layer.type === 'dense' && layer.units) {
        const inputSize = current.length;
        const outputSize = layer.units;

        // Matrix multiplication
        const output: number[] = new Array(outputSize).fill(0);
        for (let j = 0; j < outputSize; j++) {
          for (let i = 0; i < inputSize; i++) {
            output[j] += current[i] * weights[weightOffset + i * outputSize + j];
          }
          output[j] += biases[biasOffset + j];
        }

        // Apply activation
        current = this.applyActivation(output, layer.activation);

        weightOffset += inputSize * outputSize;
        biasOffset += outputSize;
      }
    }

    return current;
  }

  private applyActivation(values: number[], activation?: string): number[] {
    switch (activation) {
      case 'relu':
        return values.map((v) => Math.max(0, v));
      case 'sigmoid':
        return values.map((v) => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, v)))));
      case 'tanh':
        return values.map((v) => Math.tanh(v));
      case 'softmax': {
        const maxVal = Math.max(...values);
        const exp = values.map((v) => Math.exp(v - maxVal));
        const sum = exp.reduce((a, b) => a + b, 0);
        return exp.map((e) => e / sum);
      }
      default:
        return [...values];
    }
  }

  private computeConfidence(output: number[], model: Model): number {
    // For autoencoder, confidence is based on output variance
    if (model.architecture.type === 'autoencoder') {
      const mean = output.reduce((a, b) => a + b, 0) / output.length;
      const variance = output.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / output.length;
      // Low variance = high confidence
      return Math.max(0, 1 - Math.sqrt(variance));
    }

    // For classifier, confidence is max softmax value
    if (model.architecture.type === 'classifier') {
      return Math.max(...output);
    }

    // Default: average of output values (assuming sigmoid outputs)
    return output.reduce((a, b) => a + b, 0) / output.length;
  }

  private computeFeatureImportance(input: number[], model: Model): FeatureImportance[] {
    // Simple gradient-based feature importance
    // Perturb each feature and measure output change
    const baseOutput = this.runInference(input, model);
    const baseSum = baseOutput.reduce((a, b) => a + Math.abs(b), 0);

    const importances: FeatureImportance[] = [];
    const epsilon = 0.01;

    for (let i = 0; i < input.length; i++) {
      const perturbedInput = [...input];
      perturbedInput[i] += epsilon;

      const perturbedOutput = this.runInference(perturbedInput, model);
      const perturbedSum = perturbedOutput.reduce((a, b) => a + Math.abs(b), 0);

      const change = Math.abs(perturbedSum - baseSum) / epsilon;

      importances.push({
        featureName: `feature_${i}`,
        featureIndex: i,
        importance: change,
        direction: perturbedSum > baseSum ? 'positive' : 'negative',
      });
    }

    // Normalize importances to sum to 1
    const totalImportance = importances.reduce((sum, f) => sum + f.importance, 0);
    if (totalImportance > 0) {
      for (const imp of importances) {
        imp.importance /= totalImportance;
      }
    }

    // Sort by importance
    return importances.sort((a, b) => b.importance - a.importance);
  }

  private generateExplanation(input: number[], output: number[], model: Model): string {
    const featureImportance = this.computeFeatureImportance(input, model);
    const topFeatures = featureImportance.slice(0, 3);

    let explanation = `Prediction based on ${model.architecture.type} model. `;
    explanation += `Output confidence: ${(this.computeConfidence(output, model) * 100).toFixed(1)}%. `;

    if (topFeatures.length > 0) {
      const featureDescriptions = topFeatures.map(
        (f) => `${f.featureName} (${(f.importance * 100).toFixed(1)}% importance)`
      );
      explanation += `Key factors: ${featureDescriptions.join(', ')}.`;
    }

    return explanation;
  }

  private determineRiskLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score < 0.25) return 'low';
    if (score < 0.5) return 'medium';
    if (score < 0.75) return 'high';
    return 'critical';
  }

  private generateRecommendations(
    _anomalyScore: number,
    riskLevel: 'low' | 'medium' | 'high' | 'critical'
  ): string[] {
    const recommendations: string[] = [];

    switch (riskLevel) {
      case 'critical':
        recommendations.push('Block access immediately');
        recommendations.push('Alert security team');
        recommendations.push('Require manual verification');
        break;
      case 'high':
        recommendations.push('Require additional authentication');
        recommendations.push('Log detailed audit trail');
        recommendations.push('Monitor subsequent actions closely');
        break;
      case 'medium':
        recommendations.push('Apply rate limiting');
        recommendations.push('Add to watchlist');
        break;
      case 'low':
        recommendations.push('Standard monitoring');
        break;
    }

    return recommendations;
  }

  private aggregatePredictions(
    predictions: IndividualPrediction[],
    strategy: string
  ): number[] {
    if (predictions.length === 0) return [];

    const outputLength = predictions[0].output.length;
    const aggregated = new Array(outputLength).fill(0);

    switch (strategy) {
      case 'weighted':
        for (const pred of predictions) {
          for (let i = 0; i < outputLength; i++) {
            aggregated[i] += pred.output[i] * pred.weight;
          }
        }
        break;

      case 'average':
      default:
        for (const pred of predictions) {
          for (let i = 0; i < outputLength; i++) {
            aggregated[i] += pred.output[i];
          }
        }
        for (let i = 0; i < outputLength; i++) {
          aggregated[i] /= predictions.length;
        }
        break;
    }

    return aggregated;
  }

  private computeAgreement(predictions: IndividualPrediction[]): number {
    if (predictions.length < 2) return 1;

    // Compute pairwise cosine similarity
    let totalSimilarity = 0;
    let pairs = 0;

    for (let i = 0; i < predictions.length; i++) {
      for (let j = i + 1; j < predictions.length; j++) {
        const similarity = this.cosineSimilarity(
          predictions[i].output,
          predictions[j].output
        );
        totalSimilarity += similarity;
        pairs++;
      }
    }

    return pairs > 0 ? totalSimilarity / pairs : 1;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator > 0 ? dotProduct / denominator : 0;
  }

  private computeCacheKey(modelId: string, input: number[]): string {
    return `${modelId}:${input.map((v) => v.toFixed(6)).join(',')}`;
  }

  private getCachedResult(key: string): InferenceResponse | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.response;
  }

  private setCachedResult(key: string, response: InferenceResponse): void {
    // Enforce max cache size
    if (this.cache.size >= this.config.inference.maxCacheEntries) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      response,
      expiresAt: Date.now() + this.config.inference.cacheTtlSeconds * 1000,
    });
  }

  private estimateCacheMemory(): number {
    // Rough estimate: each entry is approximately 200 bytes
    return this.cache.size * 200;
  }
}
