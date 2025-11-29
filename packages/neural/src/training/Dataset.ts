/**
 * Dataset - Training data management for neural models
 *
 * Handles data loading, splitting, shuffling, batching, and statistics.
 */

import type {
  TrainingData,
  DatasetStatistics,
  FeatureStatistics,
} from './types.js';

export interface DatasetSplitConfig {
  train: number;
  validation?: number;
  test?: number;
}

export interface BatchOptions {
  shuffle?: boolean;
}

export class Dataset {
  private id: string;
  private name: string;
  private inputs: number[][] = [];
  private outputs: number[][] = [];
  private featureNames: string[] = [];
  private labelNames: string[] = [];

  // Split data
  private trainIndices: number[] = [];
  private validationIndices: number[] = [];
  private testIndices: number[] = [];

  private isSplit = false;

  constructor(id: string, name?: string) {
    this.id = id;
    this.name = name ?? id;
  }

  /**
   * Get dataset ID
   */
  getId(): string {
    return this.id;
  }

  /**
   * Get dataset name
   */
  getName(): string {
    return this.name;
  }

  /**
   * Get total number of samples
   */
  size(): number {
    return this.inputs.length;
  }

  /**
   * Add a single sample
   */
  addSample(input: number[], output: number[]): void {
    this.inputs.push([...input]);
    this.outputs.push([...output]);

    // Reset split if data changes
    if (this.isSplit) {
      this.resetSplit();
    }
  }

  /**
   * Add batch of samples
   */
  addBatch(inputs: number[][], outputs: number[][]): void {
    if (inputs.length !== outputs.length) {
      throw new Error('Inputs and outputs must have same length');
    }

    for (let i = 0; i < inputs.length; i++) {
      this.addSample(inputs[i], outputs[i]);
    }
  }

  /**
   * Set feature names for interpretability
   */
  setFeatureNames(names: string[]): void {
    this.featureNames = [...names];
  }

  /**
   * Set label names (for classification)
   */
  setLabelNames(names: string[]): void {
    this.labelNames = [...names];
  }

  /**
   * Get training data
   */
  getTrainingData(): TrainingData {
    if (!this.isSplit) {
      return {
        inputs: this.inputs.map((i) => [...i]),
        outputs: this.outputs.map((o) => [...o]),
      };
    }

    return {
      inputs: this.trainIndices.map((i) => [...this.inputs[i]]),
      outputs: this.trainIndices.map((i) => [...this.outputs[i]]),
    };
  }

  /**
   * Get validation data (if split)
   */
  getValidationData(): TrainingData | undefined {
    if (!this.isSplit || this.validationIndices.length === 0) {
      return undefined;
    }

    return {
      inputs: this.validationIndices.map((i) => [...this.inputs[i]]),
      outputs: this.validationIndices.map((i) => [...this.outputs[i]]),
    };
  }

  /**
   * Get test data (if split)
   */
  getTestData(): TrainingData | undefined {
    if (!this.isSplit || this.testIndices.length === 0) {
      return undefined;
    }

    return {
      inputs: this.testIndices.map((i) => [...this.inputs[i]]),
      outputs: this.testIndices.map((i) => [...this.outputs[i]]),
    };
  }

  /**
   * Split dataset into train/validation/test sets
   */
  split(config: DatasetSplitConfig): void {
    const total = config.train + (config.validation ?? 0) + (config.test ?? 0);
    if (Math.abs(total - 1) > 0.001) {
      throw new Error('Split ratios must sum to 1');
    }

    // Create shuffled indices
    const indices = this.inputs.map((_, i) => i);
    this.shuffleArray(indices);

    const n = this.inputs.length;
    const trainEnd = Math.floor(n * config.train);
    const valEnd = trainEnd + Math.floor(n * (config.validation ?? 0));

    this.trainIndices = indices.slice(0, trainEnd);
    this.validationIndices = config.validation ? indices.slice(trainEnd, valEnd) : [];
    this.testIndices = config.test ? indices.slice(valEnd) : [];

    this.isSplit = true;
  }

  /**
   * Shuffle the dataset
   */
  shuffle(): void {
    const indices = this.inputs.map((_, i) => i);
    this.shuffleArray(indices);

    const newInputs = indices.map((i) => this.inputs[i]);
    const newOutputs = indices.map((i) => this.outputs[i]);

    this.inputs = newInputs;
    this.outputs = newOutputs;

    // Reset split
    if (this.isSplit) {
      this.resetSplit();
    }
  }

  /**
   * Get dataset statistics
   */
  getStatistics(): DatasetStatistics {
    if (this.inputs.length === 0) {
      return {
        sampleCount: 0,
        featureDimension: 0,
        outputDimension: 0,
        featureStats: [],
      };
    }

    const featureDim = this.inputs[0].length;
    const outputDim = this.outputs[0].length;

    // Compute feature statistics
    const featureStats: FeatureStatistics[] = [];

    for (let j = 0; j < featureDim; j++) {
      const values = this.inputs.map((row) => row[j]);
      const validValues = values.filter((v) => !Number.isNaN(v));

      if (validValues.length === 0) {
        featureStats.push({
          name: this.featureNames[j] ?? `feature_${j}`,
          mean: 0,
          stdDev: 0,
          min: 0,
          max: 0,
          missingCount: values.length,
        });
        continue;
      }

      const mean = validValues.reduce((a, b) => a + b, 0) / validValues.length;
      const variance =
        validValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / validValues.length;
      const stdDev = Math.sqrt(variance);
      const min = Math.min(...validValues);
      const max = Math.max(...validValues);
      const missingCount = values.length - validValues.length;

      featureStats.push({
        name: this.featureNames[j] ?? `feature_${j}`,
        mean,
        stdDev,
        min,
        max,
        missingCount,
      });
    }

    // Compute class distribution (if labels are set)
    let classDistribution: Record<string, number> | undefined;

    if (this.labelNames.length > 0) {
      classDistribution = {};
      for (const labelName of this.labelNames) {
        classDistribution[labelName] = 0;
      }

      for (const output of this.outputs) {
        const classIdx = output.indexOf(Math.max(...output));
        if (classIdx >= 0 && classIdx < this.labelNames.length) {
          classDistribution[this.labelNames[classIdx]]++;
        }
      }
    }

    return {
      sampleCount: this.inputs.length,
      featureDimension: featureDim,
      outputDimension: outputDim,
      featureStats,
      classDistribution,
    };
  }

  /**
   * Iterate over dataset in batches
   */
  *batches(batchSize: number, options?: BatchOptions): Generator<TrainingData> {
    const data = this.getTrainingData();
    let { inputs, outputs } = data;

    if (options?.shuffle) {
      const indices = inputs.map((_, i) => i);
      this.shuffleArray(indices);
      inputs = indices.map((i) => data.inputs[i]);
      outputs = indices.map((i) => data.outputs[i]);
    }

    for (let i = 0; i < inputs.length; i += batchSize) {
      const batchEnd = Math.min(i + batchSize, inputs.length);
      yield {
        inputs: inputs.slice(i, batchEnd),
        outputs: outputs.slice(i, batchEnd),
      };
    }
  }

  /**
   * Create a copy of this dataset
   */
  clone(): Dataset {
    const copy = new Dataset(`${this.id}-copy`, `${this.name} (copy)`);
    copy.inputs = this.inputs.map((i) => [...i]);
    copy.outputs = this.outputs.map((o) => [...o]);
    copy.featureNames = [...this.featureNames];
    copy.labelNames = [...this.labelNames];
    return copy;
  }

  /**
   * Filter samples based on predicate
   */
  filter(predicate: (input: number[], output: number[], index: number) => boolean): Dataset {
    const filtered = new Dataset(`${this.id}-filtered`, `${this.name} (filtered)`);

    for (let i = 0; i < this.inputs.length; i++) {
      if (predicate(this.inputs[i], this.outputs[i], i)) {
        filtered.addSample(this.inputs[i], this.outputs[i]);
      }
    }

    filtered.setFeatureNames(this.featureNames);
    filtered.setLabelNames(this.labelNames);

    return filtered;
  }

  /**
   * Map samples to new values
   */
  map(
    transform: (input: number[], output: number[], index: number) => { input: number[]; output: number[] }
  ): Dataset {
    const mapped = new Dataset(`${this.id}-mapped`, `${this.name} (mapped)`);

    for (let i = 0; i < this.inputs.length; i++) {
      const result = transform(this.inputs[i], this.outputs[i], i);
      mapped.addSample(result.input, result.output);
    }

    return mapped;
  }

  /**
   * Merge with another dataset
   */
  merge(other: Dataset): Dataset {
    const merged = new Dataset(`${this.id}-merged`, `${this.name} (merged)`);

    merged.inputs = [...this.inputs, ...other.inputs];
    merged.outputs = [...this.outputs, ...other.outputs];

    return merged;
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  private resetSplit(): void {
    this.trainIndices = [];
    this.validationIndices = [];
    this.testIndices = [];
    this.isSplit = false;
  }

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }
}
