import { describe, it, expect, beforeEach } from 'vitest';
import { PrincipalMatcher } from '../../../src/principal/principal-matcher';

describe('PrincipalMatcher', () => {
  let matcher: PrincipalMatcher;

  beforeEach(() => {
    matcher = new PrincipalMatcher();
  });

  describe('matchExact', () => {
    it('should match exact principal ID', () => {
      expect(matcher.matchExact('john@example.com', 'john@example.com')).toBe(true);
    });

    it('should not match different principal IDs', () => {
      expect(matcher.matchExact('john@example.com', 'jane@example.com')).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(matcher.matchExact('John@example.com', 'john@example.com')).toBe(false);
    });

    it('should handle empty strings', () => {
      expect(matcher.matchExact('', '')).toBe(true);
      expect(matcher.matchExact('', 'test')).toBe(false);
    });
  });

  describe('matchPattern - universal wildcard', () => {
    it('should match any principal with * pattern', () => {
      expect(matcher.matchPattern('*', 'john@example.com')).toBe(true);
      expect(matcher.matchPattern('*', 'service-backup')).toBe(true);
      expect(matcher.matchPattern('*', 'admin')).toBe(true);
    });

    it('should match empty string with * pattern', () => {
      expect(matcher.matchPattern('*', '')).toBe(true);
    });
  });

  describe('matchPattern - prefix wildcard', () => {
    it('should match principals starting with prefix', () => {
      expect(matcher.matchPattern('service-*', 'service-backup')).toBe(true);
      expect(matcher.matchPattern('service-*', 'service-monitor')).toBe(true);
      expect(matcher.matchPattern('service-*', 'service-')).toBe(true);
    });

    it('should not match principals not starting with prefix', () => {
      expect(matcher.matchPattern('service-*', 'admin')).toBe(false);
      expect(matcher.matchPattern('service-*', 'user-service')).toBe(false);
    });

    it('should handle complex prefixes', () => {
      expect(matcher.matchPattern('prod-service-*', 'prod-service-api')).toBe(true);
      expect(matcher.matchPattern('prod-service-*', 'staging-service-api')).toBe(false);
    });
  });

  describe('matchPattern - suffix wildcard', () => {
    it('should match principals ending with suffix', () => {
      expect(matcher.matchPattern('*@example.com', 'john@example.com')).toBe(true);
      expect(matcher.matchPattern('*@example.com', 'jane@example.com')).toBe(true);
      expect(matcher.matchPattern('*@example.com', '@example.com')).toBe(true);
    });

    it('should not match principals not ending with suffix', () => {
      expect(matcher.matchPattern('*@example.com', 'john@other.com')).toBe(false);
      expect(matcher.matchPattern('*@example.com', 'john@example.org')).toBe(false);
    });

    it('should handle domain patterns', () => {
      expect(matcher.matchPattern('*@engineering.corp', 'alice@engineering.corp')).toBe(true);
      expect(matcher.matchPattern('*@engineering.corp', 'bob@sales.corp')).toBe(false);
    });
  });

  describe('matchPattern - middle wildcard', () => {
    it('should match principals with middle wildcard', () => {
      expect(matcher.matchPattern('user-*-admin', 'user-john-admin')).toBe(true);
      expect(matcher.matchPattern('user-*-admin', 'user-jane-admin')).toBe(true);
    });

    it('should not match if prefix or suffix does not match', () => {
      expect(matcher.matchPattern('user-*-admin', 'user-john-viewer')).toBe(false);
      expect(matcher.matchPattern('user-*-admin', 'admin-john-admin')).toBe(false);
    });

    it('should handle multiple wildcards', () => {
      expect(matcher.matchPattern('*-*-*', 'a-b-c')).toBe(true);
      expect(matcher.matchPattern('*-*-*', 'user-role-tenant')).toBe(true);
    });
  });

  describe('matchPattern - group patterns', () => {
    it('should match group patterns with group: prefix', () => {
      expect(matcher.matchPattern('group:finance-team', 'group:finance-team')).toBe(true);
    });

    it('should not match non-group principals against group pattern', () => {
      expect(matcher.matchPattern('group:finance-team', 'finance-team')).toBe(false);
    });

    it('should support wildcards in group patterns', () => {
      expect(matcher.matchPattern('group:*-team', 'group:finance-team')).toBe(true);
      expect(matcher.matchPattern('group:*-team', 'group:engineering-team')).toBe(true);
      expect(matcher.matchPattern('group:*-team', 'group:marketing-dept')).toBe(false);
    });
  });

  describe('matchPattern - exact match fallback', () => {
    it('should do exact match when no wildcards present', () => {
      expect(matcher.matchPattern('john@example.com', 'john@example.com')).toBe(true);
      expect(matcher.matchPattern('john@example.com', 'jane@example.com')).toBe(false);
    });
  });

  describe('compilePattern', () => {
    it('should compile pattern to RegExp', () => {
      const regex = matcher.compilePattern('service-*');
      expect(regex).toBeInstanceOf(RegExp);
      expect(regex.test('service-backup')).toBe(true);
      expect(regex.test('admin')).toBe(false);
    });

    it('should escape special regex characters', () => {
      const regex = matcher.compilePattern('user.*@example.com');
      expect(regex.test('user.*@example.com')).toBe(true);
      expect(regex.test('user123@example.com')).toBe(false);
    });

    it('should cache compiled patterns', () => {
      const regex1 = matcher.compilePattern('service-*');
      const regex2 = matcher.compilePattern('service-*');
      expect(regex1).toBe(regex2);
    });
  });

  describe('matchAny', () => {
    it('should return true if any pattern matches', () => {
      const patterns = ['admin', 'service-*', '*@example.com'];
      expect(matcher.matchAny(patterns, 'admin')).toBe(true);
      expect(matcher.matchAny(patterns, 'service-backup')).toBe(true);
      expect(matcher.matchAny(patterns, 'john@example.com')).toBe(true);
    });

    it('should return false if no patterns match', () => {
      const patterns = ['admin', 'service-*'];
      expect(matcher.matchAny(patterns, 'john@example.com')).toBe(false);
    });

    it('should return false for empty patterns array', () => {
      expect(matcher.matchAny([], 'john@example.com')).toBe(false);
    });

    it('should short-circuit on first match', () => {
      const patterns = ['admin', 'service-*', '*@example.com'];
      // Should match first pattern
      expect(matcher.matchAny(patterns, 'admin')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle patterns with only wildcard character', () => {
      expect(matcher.matchPattern('*', 'anything')).toBe(true);
    });

    it('should handle unicode characters', () => {
      expect(matcher.matchPattern('user-*', 'user-')).toBe(true);
      expect(matcher.matchExact('user-name', 'user-name')).toBe(true);
    });

    it('should handle special characters in patterns', () => {
      const regex = matcher.compilePattern('user+test@example.com');
      expect(regex.test('user+test@example.com')).toBe(true);
    });

    it('should handle patterns with consecutive wildcards', () => {
      // ** should be treated as a single *
      expect(matcher.matchPattern('**', 'test')).toBe(true);
    });
  });
});
