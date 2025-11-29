/**
 * Vector Store Types for similarity search and pattern storage
 */

export interface VectorEntry {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
  namespace?: string;
  createdAt: Date;
}

export interface SearchResult {
  id: string;
  score: number;
  vector: number[];
  metadata: Record<string, unknown>;
}

export interface VectorStoreConfig {
  dimension: number;
  maxEntries?: number;
  similarityMetric?: SimilarityMetric;
  namespace?: string;
}

export type SimilarityMetric = 'cosine' | 'euclidean' | 'dot';

export interface VectorStore {
  /**
   * Insert a vector with metadata
   */
  insert(id: string, vector: number[], metadata: Record<string, unknown>): Promise<void>;

  /**
   * Search for k nearest neighbors
   */
  search(query: number[], k: number): Promise<SearchResult[]>;

  /**
   * Delete a vector by ID
   */
  delete(id: string): Promise<void>;

  /**
   * Get a vector by ID
   */
  get(id: string): Promise<VectorEntry | null>;

  /**
   * Get all vectors in the store
   */
  size(): number;

  /**
   * Clear all vectors
   */
  clear(): Promise<void>;
}

/**
 * Utility type for vector operations
 */
export interface VectorMath {
  cosineSimilarity(a: number[], b: number[]): number;
  euclideanDistance(a: number[], b: number[]): number;
  dotProduct(a: number[], b: number[]): number;
  normalize(vector: number[]): number[];
  magnitude(vector: number[]): number;
}
