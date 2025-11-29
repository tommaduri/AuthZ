/**
 * ScopeResolver Tests - London School TDD
 *
 * Comprehensive test suite for scope resolution with mock-driven design.
 * Tests cover: buildScopeChain, matchScope, validateScope, computeEffectiveScope
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScopeResolver } from '../../../src/scope/scope-resolver.js';
import type { ScopeResolverConfig, ScopeValidationResult } from '../../../src/scope/types.js';

describe('ScopeResolver', () => {
  let resolver: ScopeResolver;

  beforeEach(() => {
    resolver = new ScopeResolver();
  });

  afterEach(() => {
    resolver.clearCache();
  });

  // ==========================================================================
  // buildScopeChain Tests
  // ==========================================================================

  describe('buildScopeChain', () => {
    describe('basic chain building', () => {
      it('should build chain from most to least specific', () => {
        const chain = resolver.buildScopeChain('acme.corp.engineering.team1');

        expect(chain).toEqual([
          'acme.corp.engineering.team1',
          'acme.corp.engineering',
          'acme.corp',
          'acme',
        ]);
      });

      it('should return single element for single-segment scope', () => {
        const chain = resolver.buildScopeChain('acme');

        expect(chain).toEqual(['acme']);
      });

      it('should return empty array for empty scope', () => {
        const chain = resolver.buildScopeChain('');

        expect(chain).toEqual([]);
      });

      it('should return empty array for undefined scope', () => {
        const chain = resolver.buildScopeChain(undefined as unknown as string);

        expect(chain).toEqual([]);
      });

      it('should return empty array for null scope', () => {
        const chain = resolver.buildScopeChain(null as unknown as string);

        expect(chain).toEqual([]);
      });
    });

    describe('edge cases', () => {
      it('should handle two-segment scope', () => {
        const chain = resolver.buildScopeChain('acme.corp');

        expect(chain).toEqual(['acme.corp', 'acme']);
      });

      it('should handle deeply nested scope', () => {
        const chain = resolver.buildScopeChain('a.b.c.d.e.f.g.h');

        expect(chain).toEqual([
          'a.b.c.d.e.f.g.h',
          'a.b.c.d.e.f.g',
          'a.b.c.d.e.f',
          'a.b.c.d.e',
          'a.b.c.d',
          'a.b.c',
          'a.b',
          'a',
        ]);
      });

      it('should handle whitespace-only scope', () => {
        const chain = resolver.buildScopeChain('   ');

        expect(chain).toEqual([]);
      });

      it('should trim whitespace from scope', () => {
        const chain = resolver.buildScopeChain('  acme.corp  ');

        expect(chain).toEqual(['acme.corp', 'acme']);
      });

      it('should handle trailing separator', () => {
        const chain = resolver.buildScopeChain('acme.corp.');

        expect(chain).toEqual(['acme.corp', 'acme']);
      });

      it('should handle leading separator', () => {
        const chain = resolver.buildScopeChain('.acme.corp');

        expect(chain).toEqual(['acme.corp', 'acme']);
      });

      it('should handle consecutive separators', () => {
        const chain = resolver.buildScopeChain('acme..corp');

        expect(chain).toEqual(['acme.corp', 'acme']);
      });
    });

    describe('normalization', () => {
      it('should normalize scope to lowercase', () => {
        const chain = resolver.buildScopeChain('ACME.Corp.ENGINEERING');

        expect(chain).toEqual([
          'acme.corp.engineering',
          'acme.corp',
          'acme',
        ]);
      });
    });
  });

  // ==========================================================================
  // matchScope Tests
  // ==========================================================================

  describe('matchScope', () => {
    describe('exact matching', () => {
      it('should match identical scopes', () => {
        expect(resolver.matchScope('acme.corp', 'acme.corp')).toBe(true);
      });

      it('should not match different scopes', () => {
        expect(resolver.matchScope('acme.corp', 'acme.other')).toBe(false);
      });

      it('should not match partial scopes', () => {
        expect(resolver.matchScope('acme', 'acme.corp')).toBe(false);
      });

      it('should match case-insensitively', () => {
        expect(resolver.matchScope('ACME.Corp', 'acme.CORP')).toBe(true);
      });
    });

    describe('single wildcard (*) matching', () => {
      it('should match single segment with *', () => {
        expect(resolver.matchScope('acme.*', 'acme.corp')).toBe(true);
      });

      it('should NOT match multiple segments with single *', () => {
        expect(resolver.matchScope('acme.*', 'acme.corp.eng')).toBe(false);
      });

      it('should match * in middle position', () => {
        expect(resolver.matchScope('acme.*.team1', 'acme.corp.team1')).toBe(true);
      });

      it('should NOT match * in middle when multiple segments present', () => {
        expect(resolver.matchScope('acme.*.team1', 'acme.corp.eng.team1')).toBe(false);
      });

      it('should match multiple single wildcards', () => {
        expect(resolver.matchScope('acme.*.*', 'acme.corp.eng')).toBe(true);
      });

      it('should NOT match multiple wildcards with wrong segment count', () => {
        expect(resolver.matchScope('acme.*.*', 'acme.corp')).toBe(false);
      });

      it('should match leading wildcard', () => {
        expect(resolver.matchScope('*.corp', 'acme.corp')).toBe(true);
      });

      it('should NOT match leading wildcard with multiple segments', () => {
        expect(resolver.matchScope('*.corp', 'acme.other.corp')).toBe(false);
      });
    });

    describe('multi wildcard (**) matching', () => {
      it('should match zero segments with **', () => {
        expect(resolver.matchScope('acme.**', 'acme')).toBe(true);
      });

      it('should match one segment with **', () => {
        expect(resolver.matchScope('acme.**', 'acme.corp')).toBe(true);
      });

      it('should match multiple segments with **', () => {
        expect(resolver.matchScope('acme.**', 'acme.corp.eng.team1')).toBe(true);
      });

      it('should match ** in middle position', () => {
        expect(resolver.matchScope('acme.**.team1', 'acme.corp.eng.team1')).toBe(true);
      });

      it('should match ** with single middle segment', () => {
        expect(resolver.matchScope('acme.**.team1', 'acme.corp.team1')).toBe(true);
      });

      it('should match ** with zero middle segments', () => {
        expect(resolver.matchScope('acme.**.team1', 'acme.team1')).toBe(true);
      });

      it('should handle ** at start', () => {
        expect(resolver.matchScope('**.engineering', 'acme.corp.engineering')).toBe(true);
      });

      it('should handle ** at start with deep nesting', () => {
        expect(resolver.matchScope('**.team1', 'a.b.c.d.team1')).toBe(true);
      });

      it('should match ** alone (matches everything)', () => {
        expect(resolver.matchScope('**', 'acme.corp.eng')).toBe(true);
      });

      it('should match ** alone with single segment', () => {
        expect(resolver.matchScope('**', 'acme')).toBe(true);
      });
    });

    describe('suffix wildcard patterns', () => {
      it('should match suffix pattern **.engineering', () => {
        expect(resolver.matchScope('**.engineering', 'acme.corp.engineering')).toBe(true);
      });

      it('should NOT match suffix when suffix differs', () => {
        expect(resolver.matchScope('**.engineering', 'acme.corp.sales')).toBe(false);
      });

      it('should match suffix with single parent', () => {
        expect(resolver.matchScope('**.engineering', 'acme.engineering')).toBe(true);
      });

      it('should match suffix with no parent', () => {
        expect(resolver.matchScope('**.engineering', 'engineering')).toBe(true);
      });
    });

    describe('mixed wildcards', () => {
      it('should handle * followed by **', () => {
        expect(resolver.matchScope('acme.*.**.team', 'acme.corp.eng.qa.team')).toBe(true);
      });

      it('should handle ** followed by *', () => {
        expect(resolver.matchScope('acme.**.*.team', 'acme.corp.eng.team')).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should return false for empty pattern', () => {
        expect(resolver.matchScope('', 'acme.corp')).toBe(false);
      });

      it('should return false for empty scope', () => {
        expect(resolver.matchScope('acme.corp', '')).toBe(false);
      });

      it('should return true for empty pattern and empty scope', () => {
        expect(resolver.matchScope('', '')).toBe(true);
      });

      it('should handle pattern with only *', () => {
        expect(resolver.matchScope('*', 'acme')).toBe(true);
        expect(resolver.matchScope('*', 'acme.corp')).toBe(false);
      });

      it('should handle special characters in scope segments', () => {
        expect(resolver.matchScope('acme-corp.*', 'acme-corp.eng')).toBe(true);
        expect(resolver.matchScope('acme_corp.*', 'acme_corp.eng')).toBe(true);
      });
    });
  });

  // ==========================================================================
  // validateScope Tests
  // ==========================================================================

  describe('validateScope', () => {
    describe('valid scopes', () => {
      it('should validate simple scope', () => {
        const result = resolver.validateScope('acme');

        expect(result.valid).toBe(true);
        expect(result.normalizedScope).toBe('acme');
        expect(result.error).toBeUndefined();
      });

      it('should validate multi-segment scope', () => {
        const result = resolver.validateScope('acme.corp.engineering');

        expect(result.valid).toBe(true);
        expect(result.normalizedScope).toBe('acme.corp.engineering');
      });

      it('should allow hyphens in segments', () => {
        const result = resolver.validateScope('acme-corp.eng-team');

        expect(result.valid).toBe(true);
        expect(result.normalizedScope).toBe('acme-corp.eng-team');
      });

      it('should allow underscores in segments', () => {
        const result = resolver.validateScope('acme_corp.eng_team');

        expect(result.valid).toBe(true);
        expect(result.normalizedScope).toBe('acme_corp.eng_team');
      });

      it('should allow numbers in segments', () => {
        const result = resolver.validateScope('acme.team1.division2');

        expect(result.valid).toBe(true);
        expect(result.normalizedScope).toBe('acme.team1.division2');
      });

      it('should normalize to lowercase', () => {
        const result = resolver.validateScope('ACME.CORP.Engineering');

        expect(result.valid).toBe(true);
        expect(result.normalizedScope).toBe('acme.corp.engineering');
      });

      it('should trim whitespace', () => {
        const result = resolver.validateScope('  acme.corp  ');

        expect(result.valid).toBe(true);
        expect(result.normalizedScope).toBe('acme.corp');
      });

      it('should validate scope at max depth', () => {
        const scope = 'a.b.c.d.e.f.g.h.i.j';
        const result = resolver.validateScope(scope);

        expect(result.valid).toBe(true);
      });
    });

    describe('invalid scopes', () => {
      it('should reject empty scope', () => {
        const result = resolver.validateScope('');

        expect(result.valid).toBe(false);
        expect(result.error).toContain('empty');
      });

      it('should reject whitespace-only scope', () => {
        const result = resolver.validateScope('   ');

        expect(result.valid).toBe(false);
        expect(result.error).toContain('empty');
      });

      it('should reject scope exceeding max depth', () => {
        const scope = 'a.b.c.d.e.f.g.h.i.j.k';
        const result = resolver.validateScope(scope);

        expect(result.valid).toBe(false);
        expect(result.error).toContain('depth');
        expect(result.error).toContain('10');
      });

      it('should reject scope with invalid characters', () => {
        const result = resolver.validateScope('acme@corp');

        expect(result.valid).toBe(false);
        expect(result.error).toContain('character');
      });

      it('should reject scope with spaces in segments', () => {
        const result = resolver.validateScope('acme corp.eng');

        expect(result.valid).toBe(false);
        expect(result.error).toContain('character');
      });

      it('should reject scope with special characters', () => {
        const invalidScopes = [
          'acme!corp',
          'acme#corp',
          'acme$corp',
          'acme%corp',
          'acme^corp',
          'acme&corp',
          'acme*corp', // * without being wildcard pattern
          'acme+corp',
          'acme=corp',
          'acme/corp',
          'acme\\corp',
        ];

        for (const scope of invalidScopes) {
          const result = resolver.validateScope(scope);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
        }
      });

      it('should reject empty segments', () => {
        const result = resolver.validateScope('acme..corp');

        expect(result.valid).toBe(false);
        expect(result.error).toContain('empty segment');
      });

      it('should reject trailing separator', () => {
        const result = resolver.validateScope('acme.corp.');

        expect(result.valid).toBe(false);
        expect(result.error).toContain('empty segment');
      });

      it('should reject leading separator', () => {
        const result = resolver.validateScope('.acme.corp');

        expect(result.valid).toBe(false);
        expect(result.error).toContain('empty segment');
      });
    });

    describe('custom configuration', () => {
      it('should respect custom max depth', () => {
        const customResolver = new ScopeResolver({ maxDepth: 3 });

        const valid = customResolver.validateScope('a.b.c');
        expect(valid.valid).toBe(true);

        const invalid = customResolver.validateScope('a.b.c.d');
        expect(invalid.valid).toBe(false);
        expect(invalid.error).toContain('3');
      });
    });
  });

  // ==========================================================================
  // computeEffectiveScope Tests
  // ==========================================================================

  describe('computeEffectiveScope', () => {
    describe('single scope provided', () => {
      it('should return principal scope when only principal provided', () => {
        const result = resolver.computeEffectiveScope('acme.corp.eng', undefined);

        expect(result).toBe('acme.corp.eng');
      });

      it('should return resource scope when only resource provided', () => {
        const result = resolver.computeEffectiveScope(undefined, 'acme.corp.sales');

        expect(result).toBe('acme.corp.sales');
      });
    });

    describe('both scopes provided - intersection', () => {
      it('should return common ancestor when scopes diverge', () => {
        const result = resolver.computeEffectiveScope(
          'acme.corp.engineering',
          'acme.corp.sales'
        );

        expect(result).toBe('acme.corp');
      });

      it('should return the more specific scope when one contains the other', () => {
        const result = resolver.computeEffectiveScope(
          'acme.corp.engineering.team1',
          'acme.corp.engineering'
        );

        expect(result).toBe('acme.corp.engineering.team1');
      });

      it('should return the more specific scope (resource more specific)', () => {
        const result = resolver.computeEffectiveScope(
          'acme.corp',
          'acme.corp.engineering.team1'
        );

        expect(result).toBe('acme.corp.engineering.team1');
      });

      it('should return exact scope when identical', () => {
        const result = resolver.computeEffectiveScope(
          'acme.corp.eng',
          'acme.corp.eng'
        );

        expect(result).toBe('acme.corp.eng');
      });

      it('should return root when no common ancestor', () => {
        const result = resolver.computeEffectiveScope(
          'acme.corp',
          'other.org'
        );

        expect(result).toBe('');
      });

      it('should handle single segment scopes', () => {
        const result = resolver.computeEffectiveScope('acme', 'acme');

        expect(result).toBe('acme');
      });

      it('should find common ancestor at root level', () => {
        const result = resolver.computeEffectiveScope(
          'acme.engineering',
          'acme.sales'
        );

        expect(result).toBe('acme');
      });
    });

    describe('edge cases', () => {
      it('should return empty string when both undefined', () => {
        const result = resolver.computeEffectiveScope(undefined, undefined);

        expect(result).toBe('');
      });

      it('should return empty string when both empty', () => {
        const result = resolver.computeEffectiveScope('', '');

        expect(result).toBe('');
      });

      it('should handle case-insensitive comparison', () => {
        const result = resolver.computeEffectiveScope(
          'ACME.Corp.ENG',
          'acme.corp.sales'
        );

        expect(result).toBe('acme.corp');
      });

      it('should trim whitespace before comparison', () => {
        const result = resolver.computeEffectiveScope(
          '  acme.corp.eng  ',
          'acme.corp.sales'
        );

        expect(result).toBe('acme.corp');
      });
    });
  });

  // ==========================================================================
  // Caching Tests
  // ==========================================================================

  describe('caching', () => {
    describe('scope chain caching', () => {
      it('should cache scope chain results', () => {
        const scope = 'acme.corp.engineering.team1';

        // First call - cache miss
        const chain1 = resolver.buildScopeChain(scope);
        const stats1 = resolver.getStats();

        // Second call - cache hit
        const chain2 = resolver.buildScopeChain(scope);
        const stats2 = resolver.getStats();

        expect(chain1).toEqual(chain2);
        expect(stats2.cacheHits).toBe(stats1.cacheHits + 1);
      });

      it('should track cache misses', () => {
        const stats1 = resolver.getStats();

        resolver.buildScopeChain('acme.corp.one');
        resolver.buildScopeChain('acme.corp.two');

        const stats2 = resolver.getStats();

        expect(stats2.cacheMisses).toBe(stats1.cacheMisses + 2);
      });

      it('should clear cache', () => {
        resolver.buildScopeChain('acme.corp.engineering');

        const statsBeforeClear = resolver.getStats();
        expect(statsBeforeClear.cacheSize).toBeGreaterThan(0);

        resolver.clearCache();

        const statsAfterClear = resolver.getStats();
        expect(statsAfterClear.cacheSize).toBe(0);
      });
    });

    describe('cache disabled', () => {
      it('should work without caching', () => {
        const noCacheResolver = new ScopeResolver({ enableCaching: false });

        const chain1 = noCacheResolver.buildScopeChain('acme.corp');
        const chain2 = noCacheResolver.buildScopeChain('acme.corp');

        expect(chain1).toEqual(chain2);

        const stats = noCacheResolver.getStats();
        expect(stats.cacheSize).toBe(0);
        expect(stats.cacheHits).toBe(0);
      });
    });

    describe('cache eviction', () => {
      it('should evict oldest entries when cache is full', () => {
        const smallCacheResolver = new ScopeResolver({
          maxCacheSize: 3,
          enableCaching: true
        });

        // Fill cache
        smallCacheResolver.buildScopeChain('scope.one');
        smallCacheResolver.buildScopeChain('scope.two');
        smallCacheResolver.buildScopeChain('scope.three');

        const statsBeforeEviction = smallCacheResolver.getStats();
        expect(statsBeforeEviction.cacheSize).toBe(3);

        // This should trigger eviction
        smallCacheResolver.buildScopeChain('scope.four');

        const statsAfterEviction = smallCacheResolver.getStats();
        expect(statsAfterEviction.cacheSize).toBeLessThanOrEqual(3);
      });
    });

    describe('statistics tracking', () => {
      it('should track chain computations', () => {
        const stats1 = resolver.getStats();

        resolver.buildScopeChain('acme.corp');
        resolver.buildScopeChain('other.scope');

        const stats2 = resolver.getStats();

        expect(stats2.chainComputations).toBe(stats1.chainComputations + 2);
      });

      it('should track match operations', () => {
        const stats1 = resolver.getStats();

        resolver.matchScope('acme.*', 'acme.corp');
        resolver.matchScope('acme.**', 'acme.corp.eng');

        const stats2 = resolver.getStats();

        expect(stats2.matchOperations).toBe(stats1.matchOperations + 2);
      });

      it('should track validations', () => {
        const stats1 = resolver.getStats();

        resolver.validateScope('acme.corp');
        resolver.validateScope('invalid@scope');

        const stats2 = resolver.getStats();

        expect(stats2.validations).toBe(stats1.validations + 2);
      });
    });
  });

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  describe('integration scenarios', () => {
    it('should handle full authorization scope workflow', () => {
      // Validate principal scope
      const principalValidation = resolver.validateScope('acme.corp.engineering.team1');
      expect(principalValidation.valid).toBe(true);

      // Validate resource scope
      const resourceValidation = resolver.validateScope('acme.corp.engineering');
      expect(resourceValidation.valid).toBe(true);

      // Compute effective scope
      const effectiveScope = resolver.computeEffectiveScope(
        principalValidation.normalizedScope,
        resourceValidation.normalizedScope
      );
      expect(effectiveScope).toBe('acme.corp.engineering.team1');

      // Build scope chain for policy lookup
      const chain = resolver.buildScopeChain(effectiveScope);
      expect(chain).toEqual([
        'acme.corp.engineering.team1',
        'acme.corp.engineering',
        'acme.corp',
        'acme',
      ]);

      // Check policy scope patterns
      expect(resolver.matchScope('acme.corp.**', effectiveScope)).toBe(true);
      expect(resolver.matchScope('acme.corp.*.team1', effectiveScope)).toBe(true);
      expect(resolver.matchScope('other.**', effectiveScope)).toBe(false);
    });

    it('should handle org-wide policy scope matching', () => {
      const resourceScope = 'acme.corp.engineering.backend.api';

      // Org-wide policy should match
      expect(resolver.matchScope('acme.**', resourceScope)).toBe(true);

      // Corp-wide policy should match
      expect(resolver.matchScope('acme.corp.**', resourceScope)).toBe(true);

      // Department policy should match
      expect(resolver.matchScope('acme.corp.engineering.**', resourceScope)).toBe(true);

      // Team-specific pattern should match
      expect(resolver.matchScope('acme.corp.engineering.backend.*', resourceScope)).toBe(true);

      // Wrong department should NOT match
      expect(resolver.matchScope('acme.corp.sales.**', resourceScope)).toBe(false);
    });
  });
});
