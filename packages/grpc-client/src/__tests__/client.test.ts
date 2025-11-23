/**
 * Tests for gRPC client
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  Effect,
  type CheckRequest,
  type CheckResponse,
  type ActionResult,
  DEFAULT_OPTIONS,
} from '../types.js';
import {
  isAllowed,
  isDenied,
  getAllowedActions,
  getDeniedActions,
} from '../index.js';

describe('Effect enum', () => {
  it('should have correct values', () => {
    expect(Effect.UNSPECIFIED).toBe(0);
    expect(Effect.ALLOW).toBe(1);
    expect(Effect.DENY).toBe(2);
  });
});

describe('DEFAULT_OPTIONS', () => {
  it('should have correct defaults', () => {
    expect(DEFAULT_OPTIONS.timeout).toBe(5000);
    expect(DEFAULT_OPTIONS.tls).toBe(false);
    expect(DEFAULT_OPTIONS.keepAliveInterval).toBe(30000);
    expect(DEFAULT_OPTIONS.maxRetries).toBe(3);
    expect(DEFAULT_OPTIONS.retryDelay).toBe(1000);
  });
});

describe('CheckRequest type', () => {
  it('should allow valid requests', () => {
    const request: CheckRequest = {
      requestId: 'test-1',
      principal: {
        id: 'user-123',
        roles: ['admin', 'user'],
        attributes: { department: 'engineering' },
      },
      resource: {
        kind: 'document',
        id: 'doc-456',
        attributes: { ownerId: 'user-123' },
      },
      actions: ['read', 'write'],
      context: { ip: '192.168.1.1' },
    };

    expect(request.requestId).toBe('test-1');
    expect(request.principal.id).toBe('user-123');
    expect(request.principal.roles).toContain('admin');
    expect(request.resource.kind).toBe('document');
    expect(request.actions).toHaveLength(2);
  });

  it('should allow minimal requests', () => {
    const request: CheckRequest = {
      requestId: 'test-2',
      principal: {
        id: 'user-1',
        roles: [],
      },
      resource: {
        kind: 'file',
        id: 'file-1',
      },
      actions: ['read'],
    };

    expect(request.principal.attributes).toBeUndefined();
    expect(request.resource.attributes).toBeUndefined();
    expect(request.context).toBeUndefined();
  });
});

describe('Helper functions', () => {
  const createResponse = (
    results: Array<[string, Effect]>
  ): CheckResponse => {
    const resultsMap = new Map<string, ActionResult>();
    for (const [action, effect] of results) {
      resultsMap.set(action, {
        effect,
        matched: effect !== Effect.UNSPECIFIED,
      });
    }
    return {
      requestId: 'test',
      results: resultsMap,
    };
  };

  describe('isAllowed', () => {
    it('should return true for allowed actions', () => {
      const response = createResponse([
        ['read', Effect.ALLOW],
        ['write', Effect.DENY],
      ]);

      expect(isAllowed(response, 'read')).toBe(true);
      expect(isAllowed(response, 'write')).toBe(false);
    });

    it('should return false for unknown actions', () => {
      const response = createResponse([['read', Effect.ALLOW]]);
      expect(isAllowed(response, 'delete')).toBe(false);
    });
  });

  describe('isDenied', () => {
    it('should return true for denied actions', () => {
      const response = createResponse([
        ['read', Effect.ALLOW],
        ['write', Effect.DENY],
      ]);

      expect(isDenied(response, 'read')).toBe(false);
      expect(isDenied(response, 'write')).toBe(true);
    });

    it('should return false for unknown actions', () => {
      const response = createResponse([['read', Effect.DENY]]);
      expect(isDenied(response, 'delete')).toBe(false);
    });
  });

  describe('getAllowedActions', () => {
    it('should return all allowed actions', () => {
      const response = createResponse([
        ['read', Effect.ALLOW],
        ['write', Effect.DENY],
        ['list', Effect.ALLOW],
        ['delete', Effect.DENY],
      ]);

      const allowed = getAllowedActions(response);
      expect(allowed).toContain('read');
      expect(allowed).toContain('list');
      expect(allowed).not.toContain('write');
      expect(allowed).not.toContain('delete');
      expect(allowed).toHaveLength(2);
    });

    it('should return empty array if no actions allowed', () => {
      const response = createResponse([
        ['read', Effect.DENY],
        ['write', Effect.DENY],
      ]);

      const allowed = getAllowedActions(response);
      expect(allowed).toHaveLength(0);
    });
  });

  describe('getDeniedActions', () => {
    it('should return all denied actions', () => {
      const response = createResponse([
        ['read', Effect.ALLOW],
        ['write', Effect.DENY],
        ['list', Effect.ALLOW],
        ['delete', Effect.DENY],
      ]);

      const denied = getDeniedActions(response);
      expect(denied).toContain('write');
      expect(denied).toContain('delete');
      expect(denied).not.toContain('read');
      expect(denied).not.toContain('list');
      expect(denied).toHaveLength(2);
    });

    it('should return empty array if no actions denied', () => {
      const response = createResponse([
        ['read', Effect.ALLOW],
        ['write', Effect.ALLOW],
      ]);

      const denied = getDeniedActions(response);
      expect(denied).toHaveLength(0);
    });
  });
});

describe('ResponseMetadata', () => {
  it('should capture evaluation metrics', () => {
    const response: CheckResponse = {
      requestId: 'test',
      results: new Map(),
      metadata: {
        evaluationDurationUs: 125.5,
        policiesEvaluated: 3,
        cacheHit: true,
      },
    };

    expect(response.metadata?.evaluationDurationUs).toBe(125.5);
    expect(response.metadata?.policiesEvaluated).toBe(3);
    expect(response.metadata?.cacheHit).toBe(true);
  });
});

describe('ActionResult', () => {
  it('should include policy and rule when matched', () => {
    const result: ActionResult = {
      effect: Effect.ALLOW,
      policy: 'admin-policy',
      rule: 'admin-all',
      matched: true,
    };

    expect(result.policy).toBe('admin-policy');
    expect(result.rule).toBe('admin-all');
    expect(result.matched).toBe(true);
  });

  it('should have no policy/rule when not matched', () => {
    const result: ActionResult = {
      effect: Effect.DENY,
      matched: false,
    };

    expect(result.policy).toBeUndefined();
    expect(result.rule).toBeUndefined();
    expect(result.matched).toBe(false);
  });
});
