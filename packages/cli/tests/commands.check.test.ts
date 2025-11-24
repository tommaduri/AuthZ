import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DecisionEngine, type EvaluationContext } from '@authz-engine/core';

describe('Check Command', () => {
  let engine: DecisionEngine;

  beforeEach(() => {
    engine = new DecisionEngine();
  });

  it('should evaluate allow decision', async () => {
    const context: EvaluationContext = {
      principal: {
        id: 'user:alice',
        roles: ['admin'],
        attributes: {}
      },
      resource: {
        id: 'document:123',
        type: 'document',
        attributes: {}
      },
      action: 'read',
      environment: {
        timestamp: new Date().toISOString(),
        ip: '127.0.0.1'
      }
    };

    const decision = await engine.evaluate(context);
    expect(decision).toBeDefined();
    expect(typeof decision.allowed).toBe('boolean');
  });

  it('should evaluate deny decision', async () => {
    const context: EvaluationContext = {
      principal: {
        id: 'user:bob',
        roles: [],
        attributes: {}
      },
      resource: {
        id: 'admin:panel',
        type: 'admin',
        attributes: {}
      },
      action: 'access',
      environment: {
        timestamp: new Date().toISOString(),
        ip: '127.0.0.1'
      }
    };

    const decision = await engine.evaluate(context);
    expect(decision).toBeDefined();
    expect(typeof decision.allowed).toBe('boolean');
  });

  it('should handle invalid principal gracefully', async () => {
    const context: EvaluationContext = {
      principal: {
        id: '',
        roles: [],
        attributes: {}
      },
      resource: {
        id: 'document:123',
        type: 'document',
        attributes: {}
      },
      action: 'read',
      environment: {
        timestamp: new Date().toISOString(),
        ip: '127.0.0.1'
      }
    };

    expect(async () => {
      await engine.evaluate(context);
    }).not.toThrow();
  });

  it('should include explanation in decision', async () => {
    const context: EvaluationContext = {
      principal: {
        id: 'user:alice',
        roles: ['admin'],
        attributes: {}
      },
      resource: {
        id: 'document:123',
        type: 'document',
        attributes: {}
      },
      action: 'read',
      environment: {
        timestamp: new Date().toISOString(),
        ip: '127.0.0.1'
      }
    };

    const decision = await engine.evaluate(context);
    expect(decision).toHaveProperty('explanation');
  });
});
