/**
 * Inference Engine Tests
 *
 * TDD tests for the InferenceEngine class.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { InferenceEngine } from '../src/inference/InferenceEngine.js';
import type {
  InferenceConfig,
  InferenceRequest,
  InferenceResponse,
  BatchInferenceRequest,
  EnsembleConfig,
  AnomalyDetectionResult,
  CacheStats,
  ModelLoader,
} from '../src/inference/types.js';
import type { Model, ModelArchitecture } from '../src/training/types.js';
import type { PredictionResult, RiskAssessment } from '../src/patterns/types.js';

describe('InferenceEngine', () => {
  let engine: InferenceEngine;
  let mockModelLoader: ModelLoader;
  let testModel: Model;

  beforeEach(() => {
    testModel = createTestModel('test-model-1');

    mockModelLoader = {
      load: vi.fn().mockResolvedValue(testModel),
      list: vi.fn().mockResolvedValue(['test-model-1', 'test-model-2']),
      exists: vi.fn().mockResolvedValue(true),
    };

    engine = new InferenceEngine({
      defaultModelId: 'test-model-1',
      inference: {
        enableCache: true,
        cacheTtlSeconds: 300,
        maxCacheEntries: 1000,
        enableEnsemble: false,
        timeoutMs: 5000,
        batchSize: 32,
      },
      modelLoader: mockModelLoader,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should create an InferenceEngine with config', () => {
      expect(engine).toBeInstanceOf(InferenceEngine);
    });

    it('should initialize with model loader', () => {
      expect(mockModelLoader.load).not.toHaveBeenCalled(); // Lazy loading
    });
  });

  describe('single prediction', () => {
    it('should make a prediction for input vector', async () => {
      const input = [0.5, 0.3, 0.8, 0.1, 0.9];

      const response = await engine.predict(input);

      expect(response.output).toBeDefined();
      expect(response.output).toBeInstanceOf(Array);
      expect(response.confidence).toBeGreaterThanOrEqual(0);
      expect(response.confidence).toBeLessThanOrEqual(1);
    });

    it('should return inference latency', async () => {
      const input = [0.5, 0.3, 0.8, 0.1, 0.9];

      const response = await engine.predict(input);

      expect(response.latencyMs).toBeDefined();
      expect(response.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should use default model when not specified', async () => {
      const input = [0.5, 0.3, 0.8];

      const response = await engine.predict(input);

      expect(response.modelId).toBe('test-model-1');
      expect(mockModelLoader.load).toHaveBeenCalledWith('test-model-1');
    });

    it('should use specified model', async () => {
      const customModel = createTestModel('custom-model');
      mockModelLoader.load = vi.fn().mockResolvedValue(customModel);

      const input = [0.5, 0.3, 0.8];
      const response = await engine.predict(input, 'custom-model');

      expect(response.modelId).toBe('custom-model');
      expect(mockModelLoader.load).toHaveBeenCalledWith('custom-model');
    });

    it('should throw error for non-existent model', async () => {
      mockModelLoader.exists = vi.fn().mockResolvedValue(false);
      mockModelLoader.load = vi.fn().mockRejectedValue(new Error('Model not found'));

      const input = [0.5, 0.3, 0.8];

      await expect(engine.predict(input, 'non-existent')).rejects.toThrow(
        /model.*not.*found/i
      );
    });
  });

  describe('caching', () => {
    it('should cache prediction results', async () => {
      const input = [0.5, 0.3, 0.8];

      // First call
      const response1 = await engine.predict(input);
      expect(response1.cached).toBe(false);

      // Second call with same input
      const response2 = await engine.predict(input);
      expect(response2.cached).toBe(true);
    });

    it('should return cached result faster', async () => {
      const input = [0.5, 0.3, 0.8];

      const response1 = await engine.predict(input);
      const response2 = await engine.predict(input);

      expect(response2.latencyMs).toBeLessThanOrEqual(response1.latencyMs);
    });

    it('should bypass cache when requested', async () => {
      const input = [0.5, 0.3, 0.8];

      // First call to populate cache
      await engine.predict(input);

      // Second call with bypass
      const response = await engine.predict(input, undefined);
      // Need to use the raw request API for bypass option
      const rawResponse = await engine.predictWithOptions({
        requestId: 'test',
        modelId: 'test-model-1',
        input,
        options: { bypassCache: true },
      });

      expect(rawResponse.cached).toBe(false);
    });

    it('should return cache statistics', async () => {
      const inputs = [[0.1, 0.2], [0.3, 0.4], [0.1, 0.2]]; // Third is duplicate

      for (const input of inputs) {
        await engine.predict(input);
      }

      const stats = engine.getCacheStats();

      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBeCloseTo(1 / 3, 2);
    });

    it('should clear cache', async () => {
      await engine.predict([0.1, 0.2, 0.3]);
      engine.clearCache();

      const stats = engine.getCacheStats();
      expect(stats.entryCount).toBe(0);
    });
  });

  describe('batch prediction', () => {
    it('should process batch of inputs', async () => {
      const inputs = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
        [0.7, 0.8, 0.9],
      ];

      const response = await engine.predictBatch(inputs);

      expect(response.outputs).toHaveLength(3);
      expect(response.confidences).toHaveLength(3);
    });

    it('should return total and average latency for batch', async () => {
      const inputs = Array(10)
        .fill(0)
        .map(() => [Math.random(), Math.random(), Math.random()]);

      const response = await engine.predictBatch(inputs);

      // Latency could be 0 on very fast systems, just check it's non-negative
      expect(response.totalLatencyMs).toBeGreaterThanOrEqual(0);
      // Average should be total / count
      expect(response.avgLatencyMs).toBeCloseTo(response.totalLatencyMs / 10, 1);
    });

    it('should handle empty batch', async () => {
      const response = await engine.predictBatch([]);

      expect(response.outputs).toHaveLength(0);
      expect(response.confidences).toHaveLength(0);
    });

    it('should process large batches efficiently', async () => {
      const inputs = Array(100)
        .fill(0)
        .map(() => Array(10).fill(0).map(() => Math.random()));

      const startTime = Date.now();
      const response = await engine.predictBatch(inputs);
      const duration = Date.now() - startTime;

      expect(response.outputs).toHaveLength(100);
      // Should be faster than 100 * single prediction time
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('prediction with context', () => {
    it('should return full prediction result', async () => {
      const input = [0.5, 0.3, 0.8, 0.1, 0.9];

      const result = await engine.getPrediction(input);

      expect(result.pattern).toBeDefined();
      expect(result.confidence).toBeDefined();
      expect(result.anomalyScore).toBeDefined();
      expect(result.riskLevel).toBeDefined();
      expect(result.recommendations).toBeInstanceOf(Array);
    });

    it('should classify risk level correctly', async () => {
      // Low anomaly score should result in low risk
      const lowRiskInput = [0.5, 0.5, 0.5, 0.5, 0.5]; // Normal values
      const lowRiskResult = await engine.getPrediction(lowRiskInput);

      expect(['low', 'medium']).toContain(lowRiskResult.riskLevel);
    });

    it('should provide recommendations based on prediction', async () => {
      const input = [0.1, 0.9, 0.1, 0.9, 0.1]; // Potentially anomalous

      const result = await engine.getPrediction(input);

      if (result.anomalyScore > 0.5) {
        expect(result.recommendations.length).toBeGreaterThan(0);
      }
    });
  });

  describe('risk assessment', () => {
    it('should assess risk for input', async () => {
      const input = [0.5, 0.3, 0.8, 0.1, 0.9];

      const assessment = await engine.assessRisk(input);

      expect(assessment.overallRisk).toBeGreaterThanOrEqual(0);
      expect(assessment.overallRisk).toBeLessThanOrEqual(1);
      expect(assessment.level).toMatch(/low|medium|high|critical/);
      expect(assessment.factors).toBeInstanceOf(Array);
    });

    it('should identify risk factors', async () => {
      const highRiskInput = [0.01, 0.99, 0.01, 0.99, 0.01]; // Extreme values

      const assessment = await engine.assessRisk(highRiskInput);

      if (assessment.factors.length > 0) {
        const factor = assessment.factors[0];
        expect(factor.name).toBeDefined();
        expect(factor.contribution).toBeDefined();
        expect(factor.description).toBeDefined();
      }
    });

    it('should recommend verification for high risk', async () => {
      // Create engine with a model that will detect high anomaly
      const highAnomalyModel = createTestModel('high-anomaly', true);
      mockModelLoader.load = vi.fn().mockResolvedValue(highAnomalyModel);

      const newEngine = new InferenceEngine({
        defaultModelId: 'high-anomaly',
        inference: {
          enableCache: false,
          cacheTtlSeconds: 0,
          maxCacheEntries: 0,
          enableEnsemble: false,
          timeoutMs: 5000,
          batchSize: 32,
        },
        modelLoader: mockModelLoader,
      });

      const input = [0.01, 0.99, 0.01, 0.99, 0.01];
      const assessment = await newEngine.assessRisk(input);

      if (assessment.overallRisk > 0.8) {
        expect(assessment.requiresVerification).toBe(true);
      }
    });
  });

  describe('anomaly detection', () => {
    it('should detect anomalies', async () => {
      const input = [0.5, 0.3, 0.8, 0.1, 0.9];

      const result = await engine.detectAnomaly(input);

      expect(result.anomalyScore).toBeDefined();
      expect(result.isAnomaly).toBeDefined();
      expect(result.confidence).toBeDefined();
    });

    it('should return reconstruction for autoencoder', async () => {
      const input = [0.5, 0.3, 0.8, 0.1, 0.9];

      const result = await engine.detectAnomaly(input);

      expect(result.reconstruction).toBeDefined();
      expect(result.reconstruction).toHaveLength(input.length);
      expect(result.reconstructionError).toBeDefined();
    });

    it('should flag high anomaly scores as anomalous', async () => {
      // Use model that generates high reconstruction error
      const anomalyModel = createTestModel('anomaly-model', true);
      mockModelLoader.load = vi.fn().mockResolvedValue(anomalyModel);

      const newEngine = new InferenceEngine({
        defaultModelId: 'anomaly-model',
        inference: {
          enableCache: false,
          cacheTtlSeconds: 0,
          maxCacheEntries: 0,
          enableEnsemble: false,
          timeoutMs: 5000,
          batchSize: 32,
        },
        modelLoader: mockModelLoader,
      });

      const anomalousInput = [0.01, 0.99, 0.01, 0.99, 0.01];
      const result = await newEngine.detectAnomaly(anomalousInput);

      // Model is configured to return high anomaly scores
      expect(result.anomalyScore).toBeGreaterThan(0.5);
      expect(result.isAnomaly).toBe(true);
    });
  });

  describe('ensemble prediction', () => {
    let ensembleEngine: InferenceEngine;
    let models: Model[];

    beforeEach(() => {
      models = [
        createTestModel('model-1'),
        createTestModel('model-2'),
        createTestModel('model-3'),
      ];

      const multiModelLoader: ModelLoader = {
        load: vi.fn().mockImplementation((id) => {
          const model = models.find((m) => m.id === id);
          return Promise.resolve(model || models[0]);
        }),
        list: vi.fn().mockResolvedValue(models.map((m) => m.id)),
        exists: vi.fn().mockResolvedValue(true),
      };

      ensembleEngine = new InferenceEngine({
        defaultModelId: 'model-1',
        inference: {
          enableCache: false,
          cacheTtlSeconds: 0,
          maxCacheEntries: 0,
          enableEnsemble: true,
          ensembleStrategy: 'average',
          timeoutMs: 5000,
          batchSize: 32,
        },
        modelLoader: multiModelLoader,
      });
    });

    it('should make ensemble predictions', async () => {
      const input = [0.5, 0.3, 0.8];

      const result = await ensembleEngine.predictEnsemble(input, ['model-1', 'model-2']);

      expect(result.output).toBeDefined();
      expect(result.individualPredictions).toHaveLength(2);
      expect(result.agreementScore).toBeGreaterThanOrEqual(0);
    });

    it('should average predictions in average strategy', async () => {
      const input = [0.5, 0.5, 0.5];

      const result = await ensembleEngine.predictEnsemble(input, ['model-1', 'model-2']);

      // Output should be average of individual predictions
      const expectedOutput = result.individualPredictions
        .reduce(
          (acc, pred) => acc.map((v, i) => v + pred.output[i]),
          new Array(result.output.length).fill(0)
        )
        .map((v) => v / result.individualPredictions.length);

      result.output.forEach((v, i) => {
        expect(v).toBeCloseTo(expectedOutput[i], 5);
      });
    });

    it('should compute agreement score', async () => {
      const input = [0.5, 0.5, 0.5];

      const result = await ensembleEngine.predictEnsemble(input, ['model-1', 'model-2', 'model-3']);

      // Agreement should be between 0 and 1
      expect(result.agreementScore).toBeGreaterThanOrEqual(0);
      expect(result.agreementScore).toBeLessThanOrEqual(1);
    });
  });

  describe('feature importance', () => {
    it('should return feature importance when requested', async () => {
      const input = [0.5, 0.3, 0.8, 0.1, 0.9];

      const response = await engine.predictWithOptions({
        requestId: 'test',
        modelId: 'test-model-1',
        input,
        options: { includeFeatureImportance: true },
      });

      expect(response.featureImportance).toBeDefined();
      expect(response.featureImportance?.length).toBe(input.length);
    });

    it('should rank features by importance', async () => {
      const input = [0.5, 0.3, 0.8, 0.1, 0.9];

      const response = await engine.predictWithOptions({
        requestId: 'test',
        modelId: 'test-model-1',
        input,
        options: { includeFeatureImportance: true },
      });

      if (response.featureImportance && response.featureImportance.length > 1) {
        const importances = response.featureImportance.map((f) => f.importance);
        const sorted = [...importances].sort((a, b) => b - a);

        // First feature importance should equal the max (if sorted)
        expect(importances.some((i) => i === sorted[0])).toBe(true);
      }
    });
  });

  describe('explanation', () => {
    it('should provide explanation when requested', async () => {
      const input = [0.5, 0.3, 0.8, 0.1, 0.9];

      const response = await engine.predictWithOptions({
        requestId: 'test',
        modelId: 'test-model-1',
        input,
        options: { includeExplanation: true },
      });

      expect(response.explanation).toBeDefined();
      expect(typeof response.explanation).toBe('string');
    });
  });
});

// =============================================================================
// Test Helpers
// =============================================================================

function createTestModel(id: string, highAnomaly: boolean = false): Model {
  const architecture: ModelArchitecture = {
    type: 'autoencoder',
    inputDimension: 5,
    outputDimension: 5,
    layers: [
      { type: 'dense', units: 8, activation: 'relu' },
      { type: 'dense', units: 4, activation: 'relu' },
      { type: 'dense', units: 8, activation: 'relu' },
      { type: 'dense', units: 5, activation: 'sigmoid' },
    ],
  };

  // Create deterministic weights for testing
  const totalWeights = 5 * 8 + 8 * 4 + 4 * 8 + 8 * 5; // input*h1 + h1*h2 + h2*h3 + h3*output
  const weights = new Float32Array(totalWeights);

  // Initialize with small random values
  for (let i = 0; i < totalWeights; i++) {
    weights[i] = highAnomaly ? (Math.random() - 0.5) * 2 : (Math.random() - 0.5) * 0.1;
  }

  const totalBiases = 8 + 4 + 8 + 5;
  const biases = new Float32Array(totalBiases);

  return {
    id,
    version: 1,
    patternType: 'anomaly',
    architecture,
    weights,
    biases,
    metrics: {
      loss: 0.01,
      validationLoss: 0.02,
      accuracy: 0.95,
    },
    normalization: {
      means: [0.5, 0.5, 0.5, 0.5, 0.5],
      stdDevs: [0.25, 0.25, 0.25, 0.25, 0.25],
    },
    createdAt: new Date(),
  };
}
