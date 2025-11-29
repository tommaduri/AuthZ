/**
 * Training Pipeline Tests
 *
 * TDD tests for the TrainingPipeline class.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TrainingPipeline } from '../src/training/TrainingPipeline.js';
import { Dataset } from '../src/training/Dataset.js';
import type {
  TrainingConfig,
  TrainingData,
  TrainingResult,
  PipelineConfig,
  ModelArchitecture,
  Model,
  EpochResult,
  IncrementalUpdateConfig,
} from '../src/training/types.js';

describe('TrainingPipeline', () => {
  let pipeline: TrainingPipeline;
  let defaultConfig: PipelineConfig;

  beforeEach(() => {
    defaultConfig = {
      training: {
        batchSize: 32,
        learningRate: 0.001,
        epochs: 10,
        validationSplit: 0.2,
        earlyStoppingPatience: 3,
      },
      architecture: {
        type: 'autoencoder',
        inputDimension: 20,
        outputDimension: 20,
        layers: [
          { type: 'dense', units: 64, activation: 'relu' },
          { type: 'dense', units: 32, activation: 'relu' },
          { type: 'dense', units: 64, activation: 'relu' },
          { type: 'dense', units: 20, activation: 'sigmoid' },
        ],
      },
      preprocessing: {
        normalize: true,
        normalizationMethod: 'standard',
        handleMissing: 'mean',
        removeOutliers: false,
      },
    };
    pipeline = new TrainingPipeline(defaultConfig);
  });

  describe('initialization', () => {
    it('should create a TrainingPipeline with config', () => {
      expect(pipeline).toBeInstanceOf(TrainingPipeline);
    });

    it('should validate configuration on creation', () => {
      const invalidConfig: PipelineConfig = {
        ...defaultConfig,
        training: {
          ...defaultConfig.training,
          batchSize: 0, // Invalid
        },
      };

      expect(() => new TrainingPipeline(invalidConfig)).toThrow(
        /batch.*size.*positive/i
      );
    });

    it('should validate architecture dimensions match', () => {
      const invalidConfig: PipelineConfig = {
        ...defaultConfig,
        architecture: {
          ...defaultConfig.architecture,
          inputDimension: 20,
          layers: [
            { type: 'dense', units: 10, activation: 'relu' },
          ],
          outputDimension: 20, // Mismatch with last layer
        },
      };

      expect(() => new TrainingPipeline(invalidConfig)).toThrow(
        /output.*dimension.*mismatch/i
      );
    });
  });

  describe('data preprocessing', () => {
    it('should normalize training data with standard scaling', () => {
      const rawData: TrainingData = {
        inputs: [
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9],
        ],
        outputs: [
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9],
        ],
      };

      const processed = pipeline.preprocess(rawData);

      // Check that data is normalized (mean ~0, std ~1)
      const means = computeMeans(processed.inputs);
      const stds = computeStds(processed.inputs, means);

      means.forEach((mean) => expect(Math.abs(mean)).toBeLessThan(0.1));
      stds.forEach((std) => expect(Math.abs(std - 1)).toBeLessThan(0.2));
    });

    it('should handle missing values by replacing with mean', () => {
      const rawData: TrainingData = {
        inputs: [
          [1, NaN, 3],
          [4, 5, 6],
          [7, 8, NaN],
        ],
        outputs: [[1], [2], [3]],
      };

      const processed = pipeline.preprocess(rawData);

      // No NaN values should remain
      processed.inputs.forEach((row) => {
        row.forEach((val) => expect(Number.isNaN(val)).toBe(false));
      });
    });

    it('should split data into training and validation sets', () => {
      const data: TrainingData = {
        inputs: Array(100).fill([1, 2, 3]),
        outputs: Array(100).fill([1]),
      };

      const { train, validation } = pipeline.splitData(data, 0.2);

      expect(train.inputs.length).toBe(80);
      expect(validation.inputs.length).toBe(20);
    });

    it('should preserve normalization parameters for inference', () => {
      const rawData: TrainingData = {
        inputs: [
          [10, 20, 30],
          [40, 50, 60],
          [70, 80, 90],
        ],
        outputs: [[1], [2], [3]],
      };

      pipeline.preprocess(rawData);
      const params = pipeline.getNormalizationParams();

      expect(params).toBeDefined();
      expect(params?.means).toHaveLength(3);
      expect(params?.stdDevs).toHaveLength(3);
    });
  });

  describe('model training', () => {
    it('should train a model and return training result', async () => {
      const trainingData = generateSyntheticData(100, 20);

      const result = await pipeline.train(trainingData);

      expect(result.modelId).toBeDefined();
      expect(result.metrics.loss).toBeDefined();
      expect(result.metrics.validationLoss).toBeDefined();
      expect(result.trainingTimeMs).toBeGreaterThan(0);
      expect(result.epochsCompleted).toBeGreaterThanOrEqual(1);
    });

    it('should reduce loss over epochs', async () => {
      const trainingData = generateSyntheticData(200, 20);
      const epochLosses: number[] = [];

      const configWithCallbacks: PipelineConfig = {
        ...defaultConfig,
        callbacks: {
          onEpochEnd: (result: EpochResult) => {
            epochLosses.push(result.loss);
          },
        },
      };

      const pipelineWithCallbacks = new TrainingPipeline(configWithCallbacks);
      await pipelineWithCallbacks.train(trainingData);

      // Loss should generally decrease (allowing for some fluctuation)
      if (epochLosses.length >= 3) {
        const firstLoss = epochLosses[0];
        const lastLoss = epochLosses[epochLosses.length - 1];
        expect(lastLoss).toBeLessThan(firstLoss);
      }
    });

    it('should apply early stopping when validation loss stops improving', async () => {
      const configWithEarlyStopping: PipelineConfig = {
        ...defaultConfig,
        training: {
          ...defaultConfig.training,
          epochs: 100, // High epoch count
          earlyStoppingPatience: 3,
        },
      };

      const pipelineWithES = new TrainingPipeline(configWithEarlyStopping);
      const trainingData = generateSyntheticData(50, 20);

      const result = await pipelineWithES.train(trainingData);

      // Should stop before max epochs due to early stopping
      expect(result.epochsCompleted).toBeLessThan(100);
    });

    it('should call training callbacks', async () => {
      const onTrainingStart = vi.fn();
      const onEpochEnd = vi.fn();
      const onTrainingEnd = vi.fn();

      const configWithCallbacks: PipelineConfig = {
        ...defaultConfig,
        training: { ...defaultConfig.training, epochs: 3 },
        callbacks: {
          onTrainingStart,
          onEpochEnd,
          onTrainingEnd,
        },
      };

      const pipelineWithCallbacks = new TrainingPipeline(configWithCallbacks);
      await pipelineWithCallbacks.train(generateSyntheticData(50, 20));

      expect(onTrainingStart).toHaveBeenCalledTimes(1);
      expect(onEpochEnd).toHaveBeenCalledTimes(3);
      expect(onTrainingEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe('model architectures', () => {
    it('should train an autoencoder model', async () => {
      const autoencoderConfig: PipelineConfig = {
        ...defaultConfig,
        architecture: {
          type: 'autoencoder',
          inputDimension: 10,
          outputDimension: 10,
          layers: [
            { type: 'dense', units: 8, activation: 'relu' },
            { type: 'dense', units: 4, activation: 'relu' }, // Bottleneck
            { type: 'dense', units: 8, activation: 'relu' },
            { type: 'dense', units: 10, activation: 'sigmoid' },
          ],
        },
      };

      const autoencoder = new TrainingPipeline(autoencoderConfig);
      const data = generateAutoencoderData(100, 10);

      const result = await autoencoder.train(data);

      expect(result.modelId).toBeDefined();
      expect(result.metrics.loss).toBeDefined();
    });

    it('should train a classifier model', async () => {
      const classifierConfig: PipelineConfig = {
        ...defaultConfig,
        architecture: {
          type: 'classifier',
          inputDimension: 10,
          outputDimension: 3, // 3 classes
          layers: [
            { type: 'dense', units: 16, activation: 'relu' },
            { type: 'dense', units: 8, activation: 'relu' },
            { type: 'dense', units: 3, activation: 'softmax' },
          ],
        },
      };

      const classifier = new TrainingPipeline(classifierConfig);
      const data = generateClassificationData(100, 10, 3);

      const result = await classifier.train(data);

      expect(result.modelId).toBeDefined();
      expect(result.metrics.accuracy).toBeDefined();
    });

    it('should support dropout layers', async () => {
      const configWithDropout: PipelineConfig = {
        ...defaultConfig,
        architecture: {
          type: 'classifier',
          inputDimension: 10,
          outputDimension: 2,
          layers: [
            { type: 'dense', units: 16, activation: 'relu' },
            { type: 'dropout', dropoutRate: 0.5 },
            { type: 'dense', units: 8, activation: 'relu' },
            { type: 'dropout', dropoutRate: 0.3 },
            { type: 'dense', units: 2, activation: 'softmax' },
          ],
        },
      };

      const pipelineWithDropout = new TrainingPipeline(configWithDropout);
      const data = generateClassificationData(100, 10, 2);

      const result = await pipelineWithDropout.train(data);
      expect(result.modelId).toBeDefined();
    });
  });

  describe('incremental training', () => {
    it('should update existing model with new data', async () => {
      // First, train initial model
      const initialData = generateSyntheticData(100, 20);
      const initialResult = await pipeline.train(initialData);

      // Then, update with new data
      const newData = generateSyntheticData(50, 20);
      const updateConfig: IncrementalUpdateConfig = {
        baseModelId: initialResult.modelId,
        newData,
        learningRate: 0.0001, // Lower learning rate
        epochs: 5,
      };

      const updateResult = await pipeline.incrementalUpdate(updateConfig);

      expect(updateResult.modelId).toBeDefined();
      expect(updateResult.version).toBeGreaterThan(1);
    });

    it('should preserve model performance after incremental update', async () => {
      const initialData = generateSyntheticData(100, 20);
      const initialResult = await pipeline.train(initialData);
      const initialLoss = initialResult.metrics.validationLoss;

      const newData = generateSyntheticData(50, 20);
      const updateResult = await pipeline.incrementalUpdate({
        baseModelId: initialResult.modelId,
        newData,
        learningRate: 0.0001,
        epochs: 5,
      });

      // Updated model should not be significantly worse
      expect(updateResult.improvement.lossReduction).toBeGreaterThanOrEqual(-0.1);
    });
  });

  describe('model export and loading', () => {
    it('should export trained model', async () => {
      const data = generateSyntheticData(50, 20);
      const result = await pipeline.train(data);

      const model = await pipeline.getModel(result.modelId);

      expect(model).toBeDefined();
      expect(model.id).toBe(result.modelId);
      expect(model.weights).toBeInstanceOf(Float32Array);
      expect(model.architecture).toEqual(defaultConfig.architecture);
    });

    it('should serialize model to JSON', async () => {
      const data = generateSyntheticData(50, 20);
      const result = await pipeline.train(data);

      const serialized = await pipeline.exportModel(result.modelId, 'json');

      expect(typeof serialized).toBe('string');
      const parsed = JSON.parse(serialized);
      expect(parsed.id).toBe(result.modelId);
      expect(parsed.architecture).toBeDefined();
    });

    it('should load model from serialized format', async () => {
      const data = generateSyntheticData(50, 20);
      const result = await pipeline.train(data);
      const serialized = await pipeline.exportModel(result.modelId, 'json');

      // Create new pipeline and import
      const newPipeline = new TrainingPipeline(defaultConfig);
      const importedId = await newPipeline.importModel(serialized, 'json');

      const importedModel = await newPipeline.getModel(importedId);
      expect(importedModel.architecture).toEqual(defaultConfig.architecture);
    });
  });
});

describe('Dataset', () => {
  let dataset: Dataset;

  beforeEach(() => {
    dataset = new Dataset('test-dataset');
  });

  describe('creation', () => {
    it('should create a dataset with ID and name', () => {
      expect(dataset.getId()).toBe('test-dataset');
      expect(dataset.getName()).toBeDefined();
    });

    it('should add samples to dataset', () => {
      dataset.addSample([1, 2, 3], [1, 0]);
      dataset.addSample([4, 5, 6], [0, 1]);

      expect(dataset.size()).toBe(2);
    });

    it('should add batch of samples', () => {
      const inputs = [[1, 2], [3, 4], [5, 6]];
      const outputs = [[1], [0], [1]];

      dataset.addBatch(inputs, outputs);

      expect(dataset.size()).toBe(3);
    });
  });

  describe('data access', () => {
    beforeEach(() => {
      // Add 100 samples
      for (let i = 0; i < 100; i++) {
        dataset.addSample([i, i * 2, i * 3], [i % 2]);
      }
    });

    it('should get training data', () => {
      const data = dataset.getTrainingData();

      expect(data.inputs).toHaveLength(100);
      expect(data.outputs).toHaveLength(100);
    });

    it('should split into train/validation/test', () => {
      dataset.split({ train: 0.7, validation: 0.15, test: 0.15 });

      expect(dataset.getTrainingData().inputs.length).toBeCloseTo(70, -1);
      expect(dataset.getValidationData()?.inputs.length).toBeCloseTo(15, -1);
      expect(dataset.getTestData()?.inputs.length).toBeCloseTo(15, -1);
    });

    it('should shuffle data', () => {
      const beforeShuffle = [...dataset.getTrainingData().inputs];
      dataset.shuffle();
      const afterShuffle = dataset.getTrainingData().inputs;

      // Should have same data but different order
      expect(afterShuffle).toHaveLength(beforeShuffle.length);
      // Order should be different (with high probability)
      let differences = 0;
      for (let i = 0; i < beforeShuffle.length; i++) {
        if (beforeShuffle[i][0] !== afterShuffle[i][0]) differences++;
      }
      expect(differences).toBeGreaterThan(0);
    });
  });

  describe('statistics', () => {
    beforeEach(() => {
      for (let i = 0; i < 100; i++) {
        dataset.addSample([i, i * 2, Math.random() * 100], [i % 3]);
      }
    });

    it('should compute dataset statistics', () => {
      const stats = dataset.getStatistics();

      expect(stats.sampleCount).toBe(100);
      expect(stats.featureDimension).toBe(3);
      expect(stats.featureStats).toHaveLength(3);
    });

    it('should compute feature statistics correctly', () => {
      const stats = dataset.getStatistics();
      const firstFeature = stats.featureStats[0];

      expect(firstFeature.mean).toBeCloseTo(49.5, 0);
      expect(firstFeature.min).toBe(0);
      expect(firstFeature.max).toBe(99);
    });

    it('should track class distribution', () => {
      // Create a new dataset with one-hot encoded outputs for proper class distribution
      const classDataset = new Dataset('class-test', 'Class Distribution Test');
      for (let i = 0; i < 100; i++) {
        const classIdx = i % 3;
        const oneHot = [0, 0, 0];
        oneHot[classIdx] = 1;
        classDataset.addSample([i, i * 2, Math.random() * 100], oneHot);
      }
      classDataset.setLabelNames(['class_0', 'class_1', 'class_2']);
      const stats = classDataset.getStatistics();

      expect(stats.classDistribution).toBeDefined();
      expect(stats.classDistribution?.['class_0']).toBeCloseTo(34, -1);
      expect(stats.classDistribution?.['class_1']).toBeCloseTo(33, -1);
      expect(stats.classDistribution?.['class_2']).toBeCloseTo(33, -1);
    });
  });

  describe('batch iteration', () => {
    beforeEach(() => {
      for (let i = 0; i < 100; i++) {
        dataset.addSample([i], [i]);
      }
    });

    it('should iterate in batches', () => {
      const batches: TrainingData[] = [];

      for (const batch of dataset.batches(32)) {
        batches.push(batch);
      }

      expect(batches.length).toBe(4); // 100 / 32 = 3.125, rounded up
      expect(batches[0].inputs).toHaveLength(32);
      expect(batches[3].inputs).toHaveLength(4); // Remainder
    });

    it('should support early termination during iteration', () => {
      let batchCount = 0;
      const maxBatches = 2; // Stop early, before exhausting all batches

      for (const batch of dataset.batches(32, { shuffle: true })) {
        batchCount++;
        if (batchCount >= maxBatches) break;
      }

      // Should stop at maxBatches since we break early
      expect(batchCount).toBe(maxBatches);
    });
  });
});

// =============================================================================
// Test Helpers
// =============================================================================

function generateSyntheticData(count: number, dimension: number): TrainingData {
  const inputs: number[][] = [];
  const outputs: number[][] = [];

  for (let i = 0; i < count; i++) {
    const input = Array(dimension)
      .fill(0)
      .map(() => Math.random());
    inputs.push(input);
    outputs.push([...input]); // Autoencoder: output = input
  }

  return { inputs, outputs };
}

function generateAutoencoderData(count: number, dimension: number): TrainingData {
  return generateSyntheticData(count, dimension);
}

function generateClassificationData(
  count: number,
  dimension: number,
  numClasses: number
): TrainingData {
  const inputs: number[][] = [];
  const outputs: number[][] = [];

  for (let i = 0; i < count; i++) {
    const input = Array(dimension)
      .fill(0)
      .map(() => Math.random());
    inputs.push(input);

    // One-hot encoded output
    const output = Array(numClasses).fill(0);
    output[i % numClasses] = 1;
    outputs.push(output);
  }

  return { inputs, outputs };
}

function computeMeans(data: number[][]): number[] {
  if (data.length === 0) return [];
  const dim = data[0].length;
  const means = new Array(dim).fill(0);

  for (const row of data) {
    for (let j = 0; j < dim; j++) {
      means[j] += row[j];
    }
  }

  return means.map((m) => m / data.length);
}

function computeStds(data: number[][], means: number[]): number[] {
  if (data.length === 0) return [];
  const dim = data[0].length;
  const variances = new Array(dim).fill(0);

  for (const row of data) {
    for (let j = 0; j < dim; j++) {
      variances[j] += Math.pow(row[j] - means[j], 2);
    }
  }

  return variances.map((v) => Math.sqrt(v / data.length));
}
