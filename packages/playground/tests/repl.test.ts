/**
 * REPL Tests
 *
 * Note: REPL is primarily an interactive component, so these tests
 * focus on the PolicyRepl class instantiation and basic functionality.
 */

import { describe, it, expect } from 'vitest';
import { PolicyRepl } from '../src/repl.js';

describe('PolicyRepl', () => {
  describe('constructor', () => {
    it('should create instance with default config', () => {
      const repl = new PolicyRepl();
      expect(repl).toBeInstanceOf(PolicyRepl);
    });

    it('should create instance with custom config', () => {
      const repl = new PolicyRepl({
        prompt: 'custom> ',
        colors: false,
        welcome: 'Custom welcome',
      });
      expect(repl).toBeInstanceOf(PolicyRepl);
    });
  });

  describe('stop', () => {
    it('should stop without error when not started', () => {
      const repl = new PolicyRepl();
      expect(() => repl.stop()).not.toThrow();
    });
  });
});
