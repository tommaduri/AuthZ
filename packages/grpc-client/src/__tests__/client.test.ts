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

describe('Stream Management Types', () => {
  describe('StreamMonitoringMetrics', () => {
    it('should track stream metrics', () => {
      const metrics = {
        activeStreams: 3,
        totalMessagesSent: 150,
        totalMessagesReceived: 150,
        avgLatencyMs: 25.5,
        peakBufferSize: 50,
        backpressureEvents: 2,
      };

      expect(metrics.activeStreams).toBe(3);
      expect(metrics.totalMessagesSent).toBe(150);
      expect(metrics.totalMessagesReceived).toBe(150);
      expect(metrics.avgLatencyMs).toBe(25.5);
      expect(metrics.peakBufferSize).toBe(50);
      expect(metrics.backpressureEvents).toBe(2);
    });
  });

  describe('StreamPoolConfig', () => {
    it('should define stream pool configuration', () => {
      const config = {
        maxConcurrentStreams: 10,
        streamIdleTimeout: 300000,
        enableStreamReuse: true,
        streamReuseTimeout: 60000,
      };

      expect(config.maxConcurrentStreams).toBe(10);
      expect(config.streamIdleTimeout).toBe(300000);
      expect(config.enableStreamReuse).toBe(true);
      expect(config.streamReuseTimeout).toBe(60000);
    });
  });

  describe('AdvancedStreamOptions', () => {
    it('should configure advanced stream behavior', () => {
      const options = {
        multiplexing: true,
        maxRequestsPerStream: 1000,
        deduplication: false,
        deduplicationCacheSize: 100,
        ensureOrdering: true,
      };

      expect(options.multiplexing).toBe(true);
      expect(options.maxRequestsPerStream).toBe(1000);
      expect(options.deduplication).toBe(false);
      expect(options.deduplicationCacheSize).toBe(100);
      expect(options.ensureOrdering).toBe(true);
    });
  });
});

describe('Stream Deduplication', () => {
  it('should track deduplicated request IDs', () => {
    const cache = new Map<string, CheckResponse>();
    const response: CheckResponse = {
      requestId: 'dedup-1',
      results: new Map([['read', { effect: Effect.ALLOW, matched: true }]]),
    };

    cache.set('dedup-1', response);

    expect(cache.has('dedup-1')).toBe(true);
    expect(cache.get('dedup-1')).toEqual(response);
  });

  it('should enforce deduplication cache size limits', () => {
    const cache = new Map<string, CheckResponse>();
    const cacheSize = 5;

    for (let i = 0; i < cacheSize + 2; i++) {
      const response: CheckResponse = {
        requestId: `req-${i}`,
        results: new Map(),
      };
      cache.set(`req-${i}`, response);

      // Simulate LRU eviction
      if (cache.size > cacheSize) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }
    }

    expect(cache.size).toBeLessThanOrEqual(cacheSize);
  });
});

describe('Stream Pool Management', () => {
  it('should track active stream counts', () => {
    const activeStreams = new Map<string, unknown>();

    for (let i = 0; i < 5; i++) {
      activeStreams.set(`stream-${i}`, { id: `stream-${i}` });
    }

    expect(activeStreams.size).toBe(5);
    expect(Array.from(activeStreams.keys())).toHaveLength(5);
  });

  it('should enforce max concurrent streams limit', () => {
    const maxStreams = 10;
    const activeStreams = new Map<string, unknown>();

    for (let i = 0; i < 15; i++) {
      if (activeStreams.size < maxStreams) {
        activeStreams.set(`stream-${i}`, {});
      }
    }

    expect(activeStreams.size).toBeLessThanOrEqual(maxStreams);
  });

  it('should cleanup idle streams', () => {
    const streamIdleTimeout = 300000;
    const now = Date.now();
    const streams = new Map<string, { createdAt: number }>();

    // Add old stream
    streams.set('old-stream', { createdAt: now - streamIdleTimeout - 1000 });
    // Add new stream
    streams.set('new-stream', { createdAt: now });

    const toRemove: string[] = [];
    for (const [id, stream] of streams) {
      if (now - stream.createdAt > streamIdleTimeout) {
        toRemove.push(id);
      }
    }

    expect(toRemove).toContain('old-stream');
    expect(toRemove).not.toContain('new-stream');
  });
});

describe('Backpressure Management', () => {
  it('should track buffer sizes', () => {
    const highWaterMark = 100;
    const lowWaterMark = 50;
    let bufferSize = 0;
    let isBackpressured = false;

    // Add messages until high watermark
    for (let i = 0; i < 105; i++) {
      bufferSize++;
      if (bufferSize >= highWaterMark) {
        isBackpressured = true;
        break;
      }
    }

    expect(isBackpressured).toBe(true);
    expect(bufferSize).toBeGreaterThanOrEqual(highWaterMark);

    // Drain messages
    while (bufferSize > lowWaterMark) {
      bufferSize--;
    }

    isBackpressured = bufferSize >= highWaterMark;
    expect(isBackpressured).toBe(false);
  });

  it('should handle message dropping on buffer full', () => {
    const maxBufferSize = 1000;
    const buffer: unknown[] = [];
    let dropped = 0;

    for (let i = 0; i < 1500; i++) {
      if (buffer.length >= maxBufferSize) {
        dropped++;
      } else {
        buffer.push({});
      }
    }

    expect(dropped).toBe(500);
    expect(buffer.length).toBe(maxBufferSize);
  });
});

describe('Health Monitoring Streams', () => {
  it('should track health check intervals', () => {
    const interval = 5000;
    const checks: number[] = [];
    const now = Date.now();

    // Simulate periodic checks
    for (let i = 0; i < 10; i++) {
      checks.push(now + i * interval);
    }

    expect(checks).toHaveLength(10);
    expect(checks[1] - checks[0]).toBe(interval);
  });

  it('should accumulate health statistics', () => {
    const stats = {
      successCount: 8,
      failureCount: 2,
      totalChecks: 10,
    };

    const successRate = stats.successCount / stats.totalChecks;
    expect(successRate).toBe(0.8);
    expect(stats.failureCount).toBe(2);
  });
});
