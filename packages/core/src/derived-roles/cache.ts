/**
 * Per-request cache for derived roles computation
 */

/**
 * Cache for memoizing derived role computations within a single request
 */
export class DerivedRolesCache {
  private cache: Map<string, string[]> = new Map();
  private hits = 0;
  private misses = 0;

  /**
   * Get or compute derived roles
   */
  getOrCompute(key: string, compute: () => string[]): string[] {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.hits++;
      return cached;
    }

    this.misses++;
    const result = compute();
    this.cache.set(key, result);
    return result;
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Generate cache key for a request
   */
  static generateKey(
    principalId: string,
    principalRoles: string[],
    resourceKind: string,
    resourceId: string,
  ): string {
    return `${principalId}:${principalRoles.sort().join(',')}:${resourceKind}:${resourceId}`;
  }
}
