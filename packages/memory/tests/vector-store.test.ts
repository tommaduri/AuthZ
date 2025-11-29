import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryVectorStore } from '../src/vector-store/VectorStore.js';
import type { SearchResult, VectorStoreConfig } from '../src/vector-store/types.js';

describe('InMemoryVectorStore', () => {
  let store: InMemoryVectorStore;
  const config: VectorStoreConfig = {
    dimension: 3,
    maxEntries: 1000,
    similarityMetric: 'cosine',
  };

  beforeEach(() => {
    store = new InMemoryVectorStore(config);
  });

  describe('insert', () => {
    it('should insert a vector with metadata', async () => {
      const id = 'vec-1';
      const vector = [1, 0, 0];
      const metadata = { label: 'test' };

      await store.insert(id, vector, metadata);

      expect(store.size()).toBe(1);
      const entry = await store.get(id);
      expect(entry).toBeDefined();
      expect(entry?.vector).toEqual(vector);
      expect(entry?.metadata).toEqual(metadata);
    });

    it('should throw error for wrong dimension', async () => {
      const id = 'vec-1';
      const vector = [1, 0]; // Wrong dimension

      await expect(store.insert(id, vector, {})).rejects.toThrow('dimension');
    });

    it('should update existing vector with same ID', async () => {
      const id = 'vec-1';
      await store.insert(id, [1, 0, 0], { label: 'first' });
      await store.insert(id, [0, 1, 0], { label: 'second' });

      expect(store.size()).toBe(1);
      const entry = await store.get(id);
      expect(entry?.vector).toEqual([0, 1, 0]);
      expect(entry?.metadata.label).toBe('second');
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      // Insert test vectors
      await store.insert('vec-1', [1, 0, 0], { label: 'x-axis' });
      await store.insert('vec-2', [0, 1, 0], { label: 'y-axis' });
      await store.insert('vec-3', [0, 0, 1], { label: 'z-axis' });
      await store.insert('vec-4', [1, 1, 0], { label: 'xy-diagonal' });
      await store.insert('vec-5', [1, 1, 1], { label: 'xyz-diagonal' });
    });

    it('should find k nearest neighbors', async () => {
      const query = [1, 0, 0];
      const results = await store.search(query, 3);

      expect(results).toHaveLength(3);
      expect(results[0]?.id).toBe('vec-1'); // Exact match
      expect(results[0]?.score).toBeCloseTo(1, 5); // Perfect similarity
    });

    it('should return results sorted by similarity (descending)', async () => {
      const query = [1, 0.5, 0];
      const results = await store.search(query, 5);

      // Results should be sorted by score descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]?.score).toBeGreaterThanOrEqual(results[i]?.score ?? 0);
      }
    });

    it('should include metadata in results', async () => {
      const query = [1, 0, 0];
      const results = await store.search(query, 1);

      expect(results[0]?.metadata).toEqual({ label: 'x-axis' });
    });

    it('should handle empty store', async () => {
      const emptyStore = new InMemoryVectorStore(config);
      const results = await emptyStore.search([1, 0, 0], 5);

      expect(results).toHaveLength(0);
    });

    it('should return fewer results if k > size', async () => {
      const results = await store.search([1, 0, 0], 100);

      expect(results).toHaveLength(5); // Only 5 vectors in store
    });
  });

  describe('delete', () => {
    it('should delete a vector by ID', async () => {
      await store.insert('vec-1', [1, 0, 0], {});
      await store.delete('vec-1');

      expect(store.size()).toBe(0);
      expect(await store.get('vec-1')).toBeNull();
    });

    it('should not throw when deleting non-existent ID', async () => {
      await expect(store.delete('non-existent')).resolves.not.toThrow();
    });
  });

  describe('get', () => {
    it('should get a vector by ID', async () => {
      await store.insert('vec-1', [1, 0, 0], { label: 'test' });
      const entry = await store.get('vec-1');

      expect(entry).toBeDefined();
      expect(entry?.id).toBe('vec-1');
      expect(entry?.vector).toEqual([1, 0, 0]);
    });

    it('should return null for non-existent ID', async () => {
      const entry = await store.get('non-existent');
      expect(entry).toBeNull();
    });
  });

  describe('clear', () => {
    it('should remove all vectors', async () => {
      await store.insert('vec-1', [1, 0, 0], {});
      await store.insert('vec-2', [0, 1, 0], {});
      await store.clear();

      expect(store.size()).toBe(0);
    });
  });

  describe('similarity metrics', () => {
    it('should support cosine similarity', async () => {
      const cosineStore = new InMemoryVectorStore({
        ...config,
        similarityMetric: 'cosine',
      });

      await cosineStore.insert('vec-1', [1, 0, 0], {});
      await cosineStore.insert('vec-2', [2, 0, 0], {}); // Same direction, different magnitude

      const results = await cosineStore.search([3, 0, 0], 2);

      // Both should have same cosine similarity (direction matters, not magnitude)
      expect(results[0]?.score).toBeCloseTo(results[1]?.score ?? 0, 5);
    });

    it('should support euclidean distance', async () => {
      const euclideanStore = new InMemoryVectorStore({
        ...config,
        similarityMetric: 'euclidean',
      });

      await euclideanStore.insert('vec-1', [1, 0, 0], {});
      await euclideanStore.insert('vec-2', [0.1, 0, 0], {});

      const results = await euclideanStore.search([0, 0, 0], 2);

      // vec-2 is closer to query (distance 0.1 vs 1.0)
      expect(results[0]?.id).toBe('vec-2');
    });

    it('should support dot product', async () => {
      const dotStore = new InMemoryVectorStore({
        ...config,
        similarityMetric: 'dot',
      });

      await dotStore.insert('vec-1', [1, 0, 0], {});
      await dotStore.insert('vec-2', [2, 0, 0], {});

      const results = await dotStore.search([1, 0, 0], 2);

      // vec-2 has higher dot product
      expect(results[0]?.id).toBe('vec-2');
    });
  });

  describe('authorization pattern storage', () => {
    it('should store and search authorization decision patterns', async () => {
      // Simulate storing authorization decision embeddings
      const patternStore = new InMemoryVectorStore({
        dimension: 5, // Small dimension for test
        similarityMetric: 'cosine',
      });

      // Store patterns for different decision types
      await patternStore.insert('pattern-admin-allow', [0.9, 0.1, 0.8, 0.2, 0.7], {
        decision: 'allow',
        role: 'admin',
        resource: 'sensitive',
      });

      await patternStore.insert('pattern-user-deny', [0.1, 0.9, 0.2, 0.8, 0.3], {
        decision: 'deny',
        role: 'user',
        resource: 'sensitive',
      });

      await patternStore.insert('pattern-user-allow', [0.5, 0.5, 0.5, 0.5, 0.5], {
        decision: 'allow',
        role: 'user',
        resource: 'public',
      });

      // Search for similar patterns to a new request
      const newRequestVector = [0.85, 0.15, 0.75, 0.25, 0.65];
      const results = await patternStore.search(newRequestVector, 2);

      // Should find admin-allow pattern as most similar
      expect(results[0]?.metadata.role).toBe('admin');
      expect(results[0]?.metadata.decision).toBe('allow');
    });
  });
});
