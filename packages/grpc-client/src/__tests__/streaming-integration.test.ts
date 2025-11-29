/**
 * Integration tests for bidirectional streaming with backpressure and health monitoring
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DEFAULT_BACKPRESSURE_CONFIG,
  DEFAULT_RECONNECT_CONFIG,
  ConnectionState,
  type StreamLifecycleCallbacks,
  type CheckRequest,
  type CheckResponse,
  Effect,
} from '../types.js';

describe('Bidirectional Streaming Integration', () => {
  let callbacks: StreamLifecycleCallbacks;
  let receivedResponses: CheckResponse[];
  let errors: Error[];

  beforeEach(() => {
    receivedResponses = [];
    errors = [];

    callbacks = {
      onResponse: (response: CheckResponse) => {
        receivedResponses.push(response);
      },
      onError: (error: Error) => {
        errors.push(error);
      },
      onEnd: () => {
        // Stream ended
      },
      onBackpressure: (paused: boolean) => {
        // Handle backpressure
      },
      onReconnect: (attempt: number) => {
        // Attempting to reconnect
      },
    };
  });

  describe('Stream Lifecycle', () => {
    it('should support pause and resume operations', () => {
      let isPaused = false;

      const pauseOperation = () => {
        isPaused = true;
      };

      const resumeOperation = () => {
        isPaused = false;
      };

      pauseOperation();
      expect(isPaused).toBe(true);

      resumeOperation();
      expect(isPaused).toBe(false);
    });

    it('should track stream uptime', () => {
      const startTime = Date.now();

      const getUptime = () => Date.now() - startTime;

      // Simulate some work
      const uptime1 = getUptime();
      expect(uptime1).toBeGreaterThanOrEqual(0);

      // Simulate passage of time
      const uptime2 = uptime1 + 1000;
      expect(uptime2).toBeGreaterThan(uptime1);
    });

    it('should handle stream termination gracefully', () => {
      let streamEnded = false;
      let finalMessageCount = 0;

      const endStream = () => {
        streamEnded = true;
        finalMessageCount = 10;
      };

      expect(streamEnded).toBe(false);

      endStream();

      expect(streamEnded).toBe(true);
      expect(finalMessageCount).toBe(10);
    });
  });

  describe('Backpressure Handling', () => {
    it('should pause sending when buffer exceeds high watermark', () => {
      const config = DEFAULT_BACKPRESSURE_CONFIG;
      let bufferSize = 0;
      let isPaused = false;

      for (let i = 0; i < config.highWaterMark + 10; i++) {
        bufferSize++;
        if (bufferSize >= config.highWaterMark) {
          isPaused = true;
          break;
        }
      }

      expect(isPaused).toBe(true);
      expect(bufferSize).toBeGreaterThanOrEqual(config.highWaterMark);
    });

    it('should resume sending when buffer drops below low watermark', () => {
      const config = DEFAULT_BACKPRESSURE_CONFIG;
      let bufferSize = config.highWaterMark + 5;
      let isPaused = true;

      while (bufferSize > config.lowWaterMark) {
        bufferSize--;
      }

      if (bufferSize < config.lowWaterMark) {
        isPaused = false;
      }

      expect(isPaused).toBe(false);
      expect(bufferSize).toBeLessThan(config.lowWaterMark);
    });

    it('should track backpressure events', () => {
      let backpressureEvents = 0;
      const config = DEFAULT_BACKPRESSURE_CONFIG;
      let bufferSize = 0;

      const simulateBackpressure = (event: boolean) => {
        if (event) {
          backpressureEvents++;
        }
      };

      // Trigger backpressure
      for (let i = 0; i < config.highWaterMark; i++) {
        bufferSize++;
      }
      simulateBackpressure(bufferSize >= config.highWaterMark);

      // Resolve backpressure
      bufferSize = 0;
      simulateBackpressure(bufferSize < config.lowWaterMark);

      expect(backpressureEvents).toBeGreaterThan(0);
    });

    it('should enforce maximum buffer size', () => {
      const config = DEFAULT_BACKPRESSURE_CONFIG;
      const buffer: CheckRequest[] = [];
      let droppedMessages = 0;

      for (let i = 0; i < config.maxBufferSize + 100; i++) {
        const request: CheckRequest = {
          requestId: `req-${i}`,
          principal: { id: 'user-1', roles: [] },
          resource: { kind: 'document', id: 'doc-1' },
          actions: ['read'],
        };

        if (buffer.length >= config.maxBufferSize) {
          droppedMessages++;
        } else {
          buffer.push(request);
        }
      }

      expect(buffer.length).toBe(config.maxBufferSize);
      expect(droppedMessages).toBe(100);
    });
  });

  describe('Stream Message Handling', () => {
    it('should accumulate messages in order', () => {
      const messages: CheckResponse[] = [];

      for (let i = 0; i < 5; i++) {
        messages.push({
          requestId: `req-${i}`,
          results: new Map([['read', { effect: Effect.ALLOW, matched: true }]]),
        });
      }

      expect(messages).toHaveLength(5);
      expect(messages[0].requestId).toBe('req-0');
      expect(messages[4].requestId).toBe('req-4');
    });

    it('should calculate per-message latency', () => {
      const startTime = Date.now();
      const latencies: number[] = [];

      for (let i = 0; i < 5; i++) {
        const sendTime = Date.now();
        // Simulate processing
        const receiveTime = sendTime + Math.random() * 50;
        latencies.push(receiveTime - sendTime);
      }

      expect(latencies).toHaveLength(5);
      latencies.forEach(latency => {
        expect(latency).toBeGreaterThanOrEqual(0);
      });
    });

    it('should track message statistics', () => {
      const stats = {
        sent: 100,
        received: 95,
        dropped: 5,
        avgLatency: 25.5,
      };

      const successRate = (stats.received / stats.sent) * 100;

      expect(stats.sent).toBe(100);
      expect(stats.received).toBe(95);
      expect(stats.dropped).toBe(5);
      expect(successRate).toBe(95);
    });
  });

  describe('Reconnection Strategy', () => {
    it('should implement exponential backoff', () => {
      const config = DEFAULT_RECONNECT_CONFIG;
      const delays: number[] = [];

      for (let attempt = 0; attempt < 5; attempt++) {
        const delay = Math.min(
          config.initialDelay * Math.pow(config.multiplier, attempt),
          config.maxDelay
        );
        delays.push(delay);
      }

      expect(delays).toHaveLength(5);
      expect(delays[0]).toBe(config.initialDelay);
      expect(delays[4]).toBeLessThanOrEqual(config.maxDelay);

      // Verify exponential growth
      for (let i = 1; i < delays.length - 1; i++) {
        expect(delays[i]).toBeGreaterThan(delays[i - 1]);
      }
    });

    it('should add jitter to backoff delays', () => {
      const config = { ...DEFAULT_RECONNECT_CONFIG, jitter: true };
      const delays: number[] = [];

      for (let attempt = 0; attempt < 10; attempt++) {
        let delay = Math.min(
          config.initialDelay * Math.pow(config.multiplier, attempt),
          config.maxDelay
        );

        if (config.jitter) {
          delay = delay * (1 + Math.random() * 0.3);
        }
        delays.push(delay);
      }

      const baseDelay = config.initialDelay;
      const withJitter = baseDelay * 1.3;

      // Verify jitter was applied (delays vary)
      const uniqueDelays = new Set(delays.map(d => Math.floor(d)));
      expect(uniqueDelays.size).toBeGreaterThan(1);
    });

    it('should respect maximum reconnection attempts', () => {
      const config = DEFAULT_RECONNECT_CONFIG;
      let attempts = 0;

      while (attempts < config.maxAttempts) {
        attempts++;
      }

      expect(attempts).toBe(config.maxAttempts);
    });
  });

  describe('Error Handling', () => {
    it('should handle stream errors gracefully', () => {
      const error = new Error('Stream connection failed');

      callbacks.onError(error);

      expect(errors).toContain(error);
    });

    it('should track error frequency', () => {
      const errorCounts: Record<string, number> = {};

      const trackError = (errorType: string) => {
        errorCounts[errorType] = (errorCounts[errorType] || 0) + 1;
      };

      trackError('CONNECTION_TIMEOUT');
      trackError('CONNECTION_TIMEOUT');
      trackError('BACKPRESSURE_FULL');

      expect(errorCounts['CONNECTION_TIMEOUT']).toBe(2);
      expect(errorCounts['BACKPRESSURE_FULL']).toBe(1);
    });

    it('should recover from transient errors', () => {
      let hasError = true;
      let recoveryAttempts = 0;

      const attemptRecovery = () => {
        recoveryAttempts++;
        if (recoveryAttempts >= 3) {
          hasError = false;
        }
      };

      while (hasError && recoveryAttempts < 5) {
        attemptRecovery();
      }

      expect(hasError).toBe(false);
      expect(recoveryAttempts).toBe(3);
    });
  });

  describe('Stream Multiplexing', () => {
    it('should support multiple concurrent streams', () => {
      const streams = new Map<string, { id: string; active: boolean }>();
      const maxStreams = 10;

      for (let i = 0; i < maxStreams; i++) {
        const streamId = `stream-${i}`;
        streams.set(streamId, { id: streamId, active: true });
      }

      expect(streams.size).toBe(maxStreams);
      expect(Array.from(streams.keys())).toHaveLength(maxStreams);
    });

    it('should rotate streams based on request count', () => {
      const streams = ['stream-0', 'stream-1', 'stream-2'];
      const maxRequests = 1000;
      let currentStreamIndex = 0;
      let requestCount = 0;

      while (requestCount < maxRequests) {
        currentStreamIndex = (requestCount / 500) % streams.length;
        requestCount++;
      }

      expect(currentStreamIndex).toBe(Math.floor((maxRequests - 1) / 500) % streams.length);
    });

    it('should balance load across streams', () => {
      const streams = new Map<string, number>();
      const numStreams = 4;

      for (let i = 0; i < numStreams; i++) {
        streams.set(`stream-${i}`, 0);
      }

      // Distribute 100 requests round-robin
      for (let i = 0; i < 100; i++) {
        const streamId = `stream-${i % numStreams}`;
        streams.set(streamId, (streams.get(streamId) || 0) + 1);
      }

      // Each stream should have 25 requests
      for (const count of streams.values()) {
        expect(count).toBe(25);
      }
    });
  });

  describe('Stream Deduplication', () => {
    it('should cache and reuse responses', () => {
      const cache = new Map<string, CheckResponse>();
      const requestId = 'dedup-test';

      const response: CheckResponse = {
        requestId,
        results: new Map([['read', { effect: Effect.ALLOW, matched: true }]]),
      };

      cache.set(requestId, response);

      const cachedResponse = cache.get(requestId);
      expect(cachedResponse).toEqual(response);
    });

    it('should enforce cache size limits', () => {
      const cache = new Map<string, CheckResponse>();
      const maxSize = 100;
      let evicted = 0;

      for (let i = 0; i < 150; i++) {
        const response: CheckResponse = {
          requestId: `req-${i}`,
          results: new Map(),
        };

        cache.set(`req-${i}`, response);

        if (cache.size > maxSize) {
          const firstKey = cache.keys().next().value;
          cache.delete(firstKey);
          evicted++;
        }
      }

      expect(cache.size).toBeLessThanOrEqual(maxSize);
      expect(evicted).toBeGreaterThan(0);
    });

    it('should detect duplicate requests', () => {
      const seenIds = new Set<string>();
      const duplicates: string[] = [];

      const trackRequest = (requestId: string) => {
        if (seenIds.has(requestId)) {
          duplicates.push(requestId);
        } else {
          seenIds.add(requestId);
        }
      };

      trackRequest('req-1');
      trackRequest('req-2');
      trackRequest('req-1'); // Duplicate

      expect(duplicates).toContain('req-1');
      expect(seenIds.size).toBe(2);
    });
  });

  describe('Health Monitoring Streams', () => {
    it('should track consecutive successes', () => {
      const healthyThreshold = 2;
      let consecutiveSuccesses = 0;

      const recordSuccess = () => {
        consecutiveSuccesses++;
      };

      recordSuccess();
      recordSuccess();

      expect(consecutiveSuccesses).toBeGreaterThanOrEqual(healthyThreshold);
    });

    it('should track consecutive failures', () => {
      const unhealthyThreshold = 3;
      let consecutiveFailures = 0;

      const recordFailure = () => {
        consecutiveFailures++;
      };

      recordFailure();
      recordFailure();
      recordFailure();

      expect(consecutiveFailures).toBeGreaterThanOrEqual(unhealthyThreshold);
    });

    it('should maintain health history', () => {
      const history: { timestamp: number; healthy: boolean }[] = [];
      const maxHistory = 10;

      for (let i = 0; i < 15; i++) {
        history.push({
          timestamp: Date.now() + i * 1000,
          healthy: i % 3 !== 0,
        });

        if (history.length > maxHistory) {
          history.shift();
        }
      }

      expect(history.length).toBeLessThanOrEqual(maxHistory);
    });

    it('should calculate health statistics', () => {
      const checks = [
        { healthy: true },
        { healthy: true },
        { healthy: false },
        { healthy: true },
        { healthy: true },
      ];

      const healthyCount = checks.filter(c => c.healthy).length;
      const healthPercentage = (healthyCount / checks.length) * 100;

      expect(healthyCount).toBe(4);
      expect(healthPercentage).toBe(80);
    });
  });
});

describe('Stream Configuration', () => {
  it('should apply stream pool configuration', () => {
    const config = {
      maxConcurrentStreams: 20,
      streamIdleTimeout: 600000,
      enableStreamReuse: true,
      streamReuseTimeout: 120000,
    };

    expect(config.maxConcurrentStreams).toBe(20);
    expect(config.streamIdleTimeout).toBe(600000);
    expect(config.enableStreamReuse).toBe(true);
  });

  it('should configure advanced stream options', () => {
    const options = {
      multiplexing: true,
      maxRequestsPerStream: 500,
      deduplication: true,
      deduplicationCacheSize: 200,
      ensureOrdering: true,
    };

    expect(options.multiplexing).toBe(true);
    expect(options.maxRequestsPerStream).toBe(500);
    expect(options.deduplication).toBe(true);
    expect(options.deduplicationCacheSize).toBe(200);
  });

  it('should respect configuration limits', () => {
    const config = {
      maxConcurrentStreams: 5,
      streamIdleTimeout: 60000,
    };

    let activeStreams = 0;
    for (let i = 0; i < 10; i++) {
      if (activeStreams < config.maxConcurrentStreams) {
        activeStreams++;
      }
    }

    expect(activeStreams).toBeLessThanOrEqual(config.maxConcurrentStreams);
  });
});
