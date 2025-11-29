/**
 * In-Memory Vector Store Implementation
 * Provides similarity search for authorization patterns
 */

import type {
  VectorStore,
  VectorEntry,
  SearchResult,
  VectorStoreConfig,
  SimilarityMetric,
  VectorMath,
} from './types.js';

/**
 * Vector math utilities for similarity calculations
 */
export const vectorMath: VectorMath = {
  /**
   * Calculate cosine similarity between two vectors
   * Returns value between -1 and 1, where 1 is most similar
   */
  cosineSimilarity(a: number[], b: number[]): number {
    const dot = this.dotProduct(a, b);
    const magA = this.magnitude(a);
    const magB = this.magnitude(b);

    if (magA === 0 || magB === 0) return 0;
    return dot / (magA * magB);
  },

  /**
   * Calculate Euclidean distance between two vectors
   * Lower values indicate more similarity
   */
  euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = (a[i] ?? 0) - (b[i] ?? 0);
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  },

  /**
   * Calculate dot product of two vectors
   */
  dotProduct(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += (a[i] ?? 0) * (b[i] ?? 0);
    }
    return sum;
  },

  /**
   * Normalize a vector to unit length
   */
  normalize(vector: number[]): number[] {
    const mag = this.magnitude(vector);
    if (mag === 0) return vector.map(() => 0);
    return vector.map((v) => v / mag);
  },

  /**
   * Calculate magnitude (L2 norm) of a vector
   */
  magnitude(vector: number[]): number {
    let sum = 0;
    for (const v of vector) {
      sum += v * v;
    }
    return Math.sqrt(sum);
  },
};

/**
 * In-memory vector store with configurable similarity metrics
 */
export class InMemoryVectorStore implements VectorStore {
  private vectors: Map<string, VectorEntry> = new Map();
  private dimension: number;
  private maxEntries: number;
  private similarityMetric: SimilarityMetric;

  constructor(config: VectorStoreConfig) {
    this.dimension = config.dimension;
    this.maxEntries = config.maxEntries ?? 10000;
    this.similarityMetric = config.similarityMetric ?? 'cosine';
  }

  /**
   * Insert a vector with metadata
   */
  async insert(
    id: string,
    vector: number[],
    metadata: Record<string, unknown>
  ): Promise<void> {
    if (vector.length !== this.dimension) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.dimension}, got ${vector.length}`
      );
    }

    const entry: VectorEntry = {
      id,
      vector: [...vector], // Clone to prevent external mutation
      metadata,
      createdAt: new Date(),
    };

    this.vectors.set(id, entry);

    // Enforce max entries by removing oldest
    if (this.vectors.size > this.maxEntries) {
      const oldest = this.findOldestEntry();
      if (oldest && oldest !== id) {
        this.vectors.delete(oldest);
      }
    }
  }

  /**
   * Search for k nearest neighbors
   */
  async search(query: number[], k: number): Promise<SearchResult[]> {
    if (query.length !== this.dimension) {
      throw new Error(
        `Query dimension mismatch: expected ${this.dimension}, got ${query.length}`
      );
    }

    const results: SearchResult[] = [];

    for (const entry of this.vectors.values()) {
      const score = this.calculateSimilarity(query, entry.vector);
      results.push({
        id: entry.id,
        score,
        vector: [...entry.vector],
        metadata: entry.metadata,
      });
    }

    // Sort by score (higher is better for cosine/dot, lower for euclidean)
    results.sort((a, b) => {
      if (this.similarityMetric === 'euclidean') {
        return a.score - b.score; // Lower distance is better
      }
      return b.score - a.score; // Higher similarity is better
    });

    return results.slice(0, k);
  }

  /**
   * Delete a vector by ID
   */
  async delete(id: string): Promise<void> {
    this.vectors.delete(id);
  }

  /**
   * Get a vector by ID
   */
  async get(id: string): Promise<VectorEntry | null> {
    const entry = this.vectors.get(id);
    return entry ?? null;
  }

  /**
   * Get current store size
   */
  size(): number {
    return this.vectors.size;
  }

  /**
   * Clear all vectors
   */
  async clear(): Promise<void> {
    this.vectors.clear();
  }

  /**
   * Calculate similarity based on configured metric
   */
  private calculateSimilarity(a: number[], b: number[]): number {
    switch (this.similarityMetric) {
      case 'cosine':
        return vectorMath.cosineSimilarity(a, b);
      case 'euclidean':
        return vectorMath.euclideanDistance(a, b);
      case 'dot':
        return vectorMath.dotProduct(a, b);
      default:
        return vectorMath.cosineSimilarity(a, b);
    }
  }

  /**
   * Find the oldest entry by creation time
   */
  private findOldestEntry(): string | undefined {
    let oldest: string | undefined;
    let oldestTime = Infinity;

    for (const [id, entry] of this.vectors) {
      const time = entry.createdAt.getTime();
      if (time < oldestTime) {
        oldestTime = time;
        oldest = id;
      }
    }

    return oldest;
  }
}

/**
 * Export vector store index for namespace organization
 */
export { vectorMath as VectorMathUtils };
