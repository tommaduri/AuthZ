/**
 * TrainingPipeline - Neural network training for authorization patterns
 *
 * Supports batch training, incremental updates, and multiple architectures
 * including autoencoders for anomaly detection and classifiers for risk scoring.
 */

import type {
  TrainingData,
  TrainingResult,
  PipelineConfig,
  ModelArchitecture,
  Model,
  EpochResult,
  IncrementalUpdateConfig,
  IncrementalUpdateResult,
} from './types.js';
import type { NormalizationParams } from '../patterns/types.js';
import type { PatternType } from '../patterns/types.js';

export class TrainingPipeline {
  private config: PipelineConfig;
  private models: Map<string, Model> = new Map();
  private normalizationParams: NormalizationParams | null = null;
  private modelCounter = 0;

  constructor(config: PipelineConfig) {
    this.validateConfig(config);
    this.config = { ...config };
  }

  /**
   * Get normalization parameters (for use in inference)
   */
  getNormalizationParams(): NormalizationParams | null {
    return this.normalizationParams;
  }

  /**
   * Preprocess training data (normalization, missing value handling)
   */
  preprocess(data: TrainingData): TrainingData {
    let processed = { ...data, inputs: [...data.inputs], outputs: [...data.outputs] };

    // Handle missing values
    if (this.config.preprocessing.handleMissing !== 'drop') {
      processed = this.handleMissingValues(processed);
    }

    // Normalize if enabled
    if (this.config.preprocessing.normalize) {
      processed = this.normalizeData(processed);
    }

    return processed;
  }

  /**
   * Split data into training and validation sets
   */
  splitData(
    data: TrainingData,
    validationSplit: number
  ): { train: TrainingData; validation: TrainingData } {
    const splitIndex = Math.floor(data.inputs.length * (1 - validationSplit));

    // Shuffle data first
    const indices = data.inputs.map((_, i) => i);
    this.shuffleArray(indices);

    const trainInputs: number[][] = [];
    const trainOutputs: number[][] = [];
    const valInputs: number[][] = [];
    const valOutputs: number[][] = [];

    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      if (i < splitIndex) {
        trainInputs.push(data.inputs[idx]);
        trainOutputs.push(data.outputs[idx]);
      } else {
        valInputs.push(data.inputs[idx]);
        valOutputs.push(data.outputs[idx]);
      }
    }

    return {
      train: { inputs: trainInputs, outputs: trainOutputs },
      validation: { inputs: valInputs, outputs: valOutputs },
    };
  }

  /**
   * Train a model on the provided data
   */
  async train(rawData: TrainingData): Promise<TrainingResult> {
    const startTime = Date.now();

    // Call training start callback
    this.config.callbacks?.onTrainingStart?.();

    // Preprocess data
    const data = this.preprocess(rawData);

    // Split into train/validation
    const { train, validation } = this.splitData(data, this.config.training.validationSplit);

    // Initialize model weights
    const weights = this.initializeWeights(this.config.architecture);
    const biases = this.initializeBiases(this.config.architecture);

    let bestLoss = Infinity;
    let epochsWithoutImprovement = 0;
    let epochsCompleted = 0;
    let currentLr = this.config.training.learningRate;

    // Training loop
    for (let epoch = 0; epoch < this.config.training.epochs; epoch++) {
      const epochStart = Date.now();

      // Shuffle training data
      const shuffledIndices = train.inputs.map((_, i) => i);
      this.shuffleArray(shuffledIndices);

      // Mini-batch training
      const batchSize = this.config.training.batchSize;
      let epochLoss = 0;
      let batchCount = 0;

      for (let i = 0; i < train.inputs.length; i += batchSize) {
        const batchEnd = Math.min(i + batchSize, train.inputs.length);
        const batchInputs: number[][] = [];
        const batchOutputs: number[][] = [];

        for (let j = i; j < batchEnd; j++) {
          const idx = shuffledIndices[j];
          batchInputs.push(train.inputs[idx]);
          batchOutputs.push(train.outputs[idx]);
        }

        // Forward pass and compute loss
        const { loss: batchLoss, gradients } = this.computeGradients(
          batchInputs,
          batchOutputs,
          weights,
          biases,
          this.config.architecture
        );

        epochLoss += batchLoss;
        batchCount++;

        // Update weights (SGD)
        this.updateWeights(weights, biases, gradients, currentLr);
      }

      // Average loss
      epochLoss /= batchCount;

      // Validation loss
      const valResults = this.evaluate(validation.inputs, validation.outputs, weights, biases);
      const valLoss = valResults.loss;

      epochsCompleted = epoch + 1;

      // Call epoch callback
      const epochResult: EpochResult = {
        epoch: epoch + 1,
        loss: epochLoss,
        validationLoss: valLoss,
        learningRate: currentLr,
        epochTimeMs: Date.now() - epochStart,
      };
      this.config.callbacks?.onEpochEnd?.(epochResult);

      // Early stopping check
      if (valLoss < bestLoss) {
        bestLoss = valLoss;
        epochsWithoutImprovement = 0;
        this.config.callbacks?.onValidationImprove?.(valLoss);
      } else {
        epochsWithoutImprovement++;
      }

      if (
        this.config.training.earlyStoppingPatience &&
        epochsWithoutImprovement >= this.config.training.earlyStoppingPatience
      ) {
        break;
      }
    }

    // Create model
    const modelId = `model-${++this.modelCounter}-${Date.now()}`;
    const model: Model = {
      id: modelId,
      version: 1,
      patternType: this.inferPatternType(this.config.architecture),
      architecture: this.config.architecture,
      weights: new Float32Array(weights),
      biases: new Float32Array(biases),
      metrics: {
        loss: bestLoss,
        validationLoss: bestLoss,
        accuracy: this.computeAccuracy(validation, weights, biases),
      },
      normalization: this.normalizationParams ?? undefined,
      createdAt: new Date(),
    };

    this.models.set(modelId, model);

    const result: TrainingResult = {
      modelId,
      metrics: model.metrics,
      trainingTimeMs: Date.now() - startTime,
      epochsCompleted,
      converged: epochsWithoutImprovement < (this.config.training.earlyStoppingPatience ?? this.config.training.epochs),
      bestValidationLoss: bestLoss,
    };

    this.config.callbacks?.onTrainingEnd?.(result);

    return result;
  }

  /**
   * Incrementally update an existing model with new data
   */
  async incrementalUpdate(config: IncrementalUpdateConfig): Promise<IncrementalUpdateResult> {
    const startTime = Date.now();

    const baseModel = this.models.get(config.baseModelId);
    if (!baseModel) {
      throw new Error(`Model not found: ${config.baseModelId}`);
    }

    // Preprocess new data with existing normalization
    const data = this.preprocess(config.newData);

    // Use base model weights
    const weights = Array.from(baseModel.weights);
    const biases = Array.from(baseModel.biases);

    // Fine-tune with lower learning rate
    const { train, validation } = this.splitData(data, 0.2);

    let bestLoss = baseModel.metrics.validationLoss;
    let finalLoss = bestLoss;

    for (let epoch = 0; epoch < config.epochs; epoch++) {
      const batchSize = this.config.training.batchSize;

      for (let i = 0; i < train.inputs.length; i += batchSize) {
        const batchEnd = Math.min(i + batchSize, train.inputs.length);
        const batchInputs = train.inputs.slice(i, batchEnd);
        const batchOutputs = train.outputs.slice(i, batchEnd);

        const { gradients } = this.computeGradients(
          batchInputs,
          batchOutputs,
          weights,
          biases,
          this.config.architecture
        );

        this.updateWeights(weights, biases, gradients, config.learningRate);
      }

      const valResults = this.evaluate(validation.inputs, validation.outputs, weights, biases);
      finalLoss = valResults.loss;

      if (finalLoss < bestLoss) {
        bestLoss = finalLoss;
      }
    }

    // Create new model version
    const newModelId = `${config.baseModelId}-v${baseModel.version + 1}`;
    const updatedModel: Model = {
      ...baseModel,
      id: newModelId,
      version: baseModel.version + 1,
      weights: new Float32Array(weights),
      biases: new Float32Array(biases),
      metrics: {
        ...baseModel.metrics,
        loss: finalLoss,
        validationLoss: finalLoss,
      },
      createdAt: new Date(),
    };

    this.models.set(newModelId, updatedModel);

    return {
      modelId: newModelId,
      version: updatedModel.version,
      improvement: {
        lossReduction: baseModel.metrics.validationLoss - finalLoss,
        accuracyGain: 0, // Could compute if classification
      },
      updateTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Get a trained model by ID
   */
  async getModel(modelId: string): Promise<Model> {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }
    return model;
  }

  /**
   * Export model to serialized format
   */
  async exportModel(modelId: string, format: 'json' | 'binary'): Promise<string> {
    const model = await this.getModel(modelId);

    if (format === 'json') {
      return JSON.stringify({
        id: model.id,
        version: model.version,
        patternType: model.patternType,
        architecture: model.architecture,
        weights: Array.from(model.weights),
        biases: Array.from(model.biases),
        metrics: model.metrics,
        normalization: model.normalization,
        createdAt: model.createdAt.toISOString(),
      });
    }

    throw new Error(`Unsupported format: ${format}`);
  }

  /**
   * Import model from serialized format
   */
  async importModel(serialized: string, format: 'json' | 'binary'): Promise<string> {
    if (format === 'json') {
      const data = JSON.parse(serialized);
      const model: Model = {
        id: data.id,
        version: data.version,
        patternType: data.patternType,
        architecture: data.architecture,
        weights: new Float32Array(data.weights),
        biases: new Float32Array(data.biases),
        metrics: data.metrics,
        normalization: data.normalization,
        createdAt: new Date(data.createdAt),
      };

      this.models.set(model.id, model);
      return model.id;
    }

    throw new Error(`Unsupported format: ${format}`);
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  private validateConfig(config: PipelineConfig): void {
    if (config.training.batchSize <= 0) {
      throw new Error('Batch size must be positive');
    }

    if (config.training.learningRate <= 0 || config.training.learningRate > 1) {
      throw new Error('Learning rate must be between 0 and 1');
    }

    // Validate output dimension matches last layer
    const layers = config.architecture.layers;
    if (layers.length > 0) {
      const lastLayer = layers[layers.length - 1];
      if (lastLayer.units && lastLayer.units !== config.architecture.outputDimension) {
        throw new Error('Output dimension mismatch with last layer units');
      }
    }
  }

  private handleMissingValues(data: TrainingData): TrainingData {
    const method = this.config.preprocessing.handleMissing;
    const inputs = data.inputs.map((row) => [...row]);

    // Calculate column means for 'mean' method
    const colSums = new Array(inputs[0]?.length || 0).fill(0);
    const colCounts = new Array(inputs[0]?.length || 0).fill(0);

    for (const row of inputs) {
      for (let j = 0; j < row.length; j++) {
        if (!Number.isNaN(row[j])) {
          colSums[j] += row[j];
          colCounts[j]++;
        }
      }
    }

    const colMeans = colSums.map((sum, i) => (colCounts[i] > 0 ? sum / colCounts[i] : 0));

    // Replace NaN values
    for (const row of inputs) {
      for (let j = 0; j < row.length; j++) {
        if (Number.isNaN(row[j])) {
          switch (method) {
            case 'mean':
              row[j] = colMeans[j];
              break;
            case 'median':
              row[j] = colMeans[j]; // Simplified: use mean instead of median
              break;
            case 'zero':
              row[j] = 0;
              break;
          }
        }
      }
    }

    return { inputs, outputs: data.outputs };
  }

  private normalizeData(data: TrainingData): TrainingData {
    if (data.inputs.length === 0) return data;

    const dim = data.inputs[0].length;
    const means = new Array(dim).fill(0);
    const stdDevs = new Array(dim).fill(0);

    // Calculate means
    for (const row of data.inputs) {
      for (let j = 0; j < dim; j++) {
        means[j] += row[j];
      }
    }
    for (let j = 0; j < dim; j++) {
      means[j] /= data.inputs.length;
    }

    // Calculate standard deviations
    for (const row of data.inputs) {
      for (let j = 0; j < dim; j++) {
        stdDevs[j] += Math.pow(row[j] - means[j], 2);
      }
    }
    for (let j = 0; j < dim; j++) {
      stdDevs[j] = Math.sqrt(stdDevs[j] / data.inputs.length) || 1; // Avoid division by zero
    }

    // Store normalization parameters
    this.normalizationParams = { means, stdDevs };

    // Normalize inputs
    const normalizedInputs = data.inputs.map((row) =>
      row.map((val, j) => (val - means[j]) / stdDevs[j])
    );

    return { inputs: normalizedInputs, outputs: data.outputs };
  }

  private initializeWeights(architecture: ModelArchitecture): number[] {
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

  private initializeBiases(architecture: ModelArchitecture): number[] {
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

  private computeGradients(
    inputs: number[][],
    targets: number[][],
    weights: number[],
    biases: number[],
    architecture: ModelArchitecture
  ): { loss: number; gradients: { weights: number[]; biases: number[] } } {
    const batchSize = inputs.length;
    const weightGradients = new Array(weights.length).fill(0);
    const biasGradients = new Array(biases.length).fill(0);
    let totalLoss = 0;

    for (let b = 0; b < batchSize; b++) {
      // Forward pass with activation storage
      const { output, activations } = this.forwardPass(
        inputs[b],
        weights,
        biases,
        architecture
      );

      // Compute loss (MSE)
      const loss = this.computeMSE(output, targets[b]);
      totalLoss += loss;

      // Backward pass
      const { wGrads, bGrads } = this.backwardPass(
        inputs[b],
        targets[b],
        activations,
        weights,
        biases,
        architecture
      );

      // Accumulate gradients
      for (let i = 0; i < wGrads.length; i++) {
        weightGradients[i] += wGrads[i];
      }
      for (let i = 0; i < bGrads.length; i++) {
        biasGradients[i] += bGrads[i];
      }
    }

    // Average gradients
    for (let i = 0; i < weightGradients.length; i++) {
      weightGradients[i] /= batchSize;
    }
    for (let i = 0; i < biasGradients.length; i++) {
      biasGradients[i] /= batchSize;
    }

    return {
      loss: totalLoss / batchSize,
      gradients: { weights: weightGradients, biases: biasGradients },
    };
  }

  private forwardPass(
    input: number[],
    weights: number[],
    biases: number[],
    architecture: ModelArchitecture
  ): { output: number[]; activations: number[][] } {
    const activations: number[][] = [input];
    let current = input;
    let weightOffset = 0;
    let biasOffset = 0;

    for (const layer of architecture.layers) {
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
        const activated = this.applyActivation(output, layer.activation);
        activations.push(activated);
        current = activated;

        weightOffset += inputSize * outputSize;
        biasOffset += outputSize;
      } else if (layer.type === 'dropout') {
        // Skip dropout in forward (training handles it differently)
        activations.push([...current]);
      }
    }

    return { output: current, activations };
  }

  private backwardPass(
    _input: number[],
    target: number[],
    activations: number[][],
    weights: number[],
    biases: number[],
    architecture: ModelArchitecture
  ): { wGrads: number[]; bGrads: number[] } {
    const wGrads = new Array(weights.length).fill(0);
    const bGrads = new Array(biases.length).fill(0);

    // Output error
    const output = activations[activations.length - 1];
    let delta = output.map((o, i) => o - target[i]);

    // Backpropagate through layers
    let weightOffset = weights.length;
    let biasOffset = biases.length;

    for (let l = architecture.layers.length - 1; l >= 0; l--) {
      const layer = architecture.layers[l];

      if (layer.type === 'dense' && layer.units) {
        const inputSize = activations[l].length;
        const outputSize = layer.units;

        weightOffset -= inputSize * outputSize;
        biasOffset -= outputSize;

        // Apply activation derivative
        const layerOutput = activations[l + 1];
        const activationDeriv = this.activationDerivative(layerOutput, layer.activation);
        delta = delta.map((d, i) => d * activationDeriv[i]);

        // Compute gradients
        for (let j = 0; j < outputSize; j++) {
          for (let i = 0; i < inputSize; i++) {
            wGrads[weightOffset + i * outputSize + j] = activations[l][i] * delta[j];
          }
          bGrads[biasOffset + j] = delta[j];
        }

        // Propagate error to previous layer
        if (l > 0) {
          const newDelta = new Array(inputSize).fill(0);
          for (let i = 0; i < inputSize; i++) {
            for (let j = 0; j < outputSize; j++) {
              newDelta[i] += weights[weightOffset + i * outputSize + j] * delta[j];
            }
          }
          delta = newDelta;
        }
      }
    }

    return { wGrads, bGrads };
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
      case 'linear':
      default:
        return [...values];
    }
  }

  private activationDerivative(values: number[], activation?: string): number[] {
    switch (activation) {
      case 'relu':
        return values.map((v) => (v > 0 ? 1 : 0));
      case 'sigmoid':
        return values.map((v) => v * (1 - v));
      case 'tanh':
        return values.map((v) => 1 - v * v);
      case 'softmax':
        // Simplified: use 1 for softmax derivative
        return values.map(() => 1);
      case 'linear':
      default:
        return values.map(() => 1);
    }
  }

  private computeMSE(output: number[], target: number[]): number {
    let sum = 0;
    for (let i = 0; i < output.length; i++) {
      sum += Math.pow(output[i] - target[i], 2);
    }
    return sum / output.length;
  }

  private updateWeights(
    weights: number[],
    biases: number[],
    gradients: { weights: number[]; biases: number[] },
    learningRate: number
  ): void {
    for (let i = 0; i < weights.length; i++) {
      weights[i] -= learningRate * gradients.weights[i];
    }
    for (let i = 0; i < biases.length; i++) {
      biases[i] -= learningRate * gradients.biases[i];
    }
  }

  private evaluate(
    inputs: number[][],
    outputs: number[][],
    weights: number[],
    biases: number[]
  ): { loss: number; accuracy?: number } {
    let totalLoss = 0;
    let correct = 0;

    for (let i = 0; i < inputs.length; i++) {
      const { output } = this.forwardPass(inputs[i], weights, biases, this.config.architecture);
      totalLoss += this.computeMSE(output, outputs[i]);

      // For classification, check if argmax matches
      if (this.config.architecture.type === 'classifier') {
        const predClass = output.indexOf(Math.max(...output));
        const trueClass = outputs[i].indexOf(Math.max(...outputs[i]));
        if (predClass === trueClass) correct++;
      }
    }

    return {
      loss: totalLoss / inputs.length,
      accuracy: this.config.architecture.type === 'classifier' ? correct / inputs.length : undefined,
    };
  }

  private computeAccuracy(
    data: TrainingData,
    weights: number[],
    biases: number[]
  ): number | undefined {
    if (this.config.architecture.type !== 'classifier') return undefined;

    let correct = 0;
    for (let i = 0; i < data.inputs.length; i++) {
      const { output } = this.forwardPass(data.inputs[i], weights, biases, this.config.architecture);
      const predClass = output.indexOf(Math.max(...output));
      const trueClass = data.outputs[i].indexOf(Math.max(...data.outputs[i]));
      if (predClass === trueClass) correct++;
    }

    return correct / data.inputs.length;
  }

  private inferPatternType(architecture: ModelArchitecture): PatternType {
    switch (architecture.type) {
      case 'autoencoder':
        return 'anomaly';
      case 'classifier':
        return 'behavioral';
      default:
        return 'access';
    }
  }

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }
}
