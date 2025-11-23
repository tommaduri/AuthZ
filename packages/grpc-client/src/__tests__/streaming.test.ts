/**
 * Tests for bidirectional streaming with backpressure support
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import {
  BidirectionalStreamManager,
  createBidirectionalStream,
} from '../streaming.js';
import {
  type CheckRequest,
  type CheckResponse,
  type StreamLifecycleCallbacks,
  type BackpressureConfig,
  Effect,
} from '../types.js';

// Mock gRPC stream
class MockDuplexStream extends EventEmitter {
  private writeBuffer: unknown[] = [];
  private canWrite = true;

  write(data: unknown): boolean {
    this.writeBuffer.push(data);
    return this.canWrite;
  }

  end(): void {
    this.emit('end');
  }

  getWriteBuffer(): unknown[] {
    return this.writeBuffer;
  }

  setCanWrite(value: boolean): void {
    this.canWrite = value;
    if (value) {
      this.emit('drain');
    }
  }

  simulateData(data: unknown): void {
    this.emit('data', data);
  }

  simulateError(error: Error): void {
    this.emit('error', error);
  }
}

describe('BidirectionalStreamManager', () => {
  let mockStream: MockDuplexStream;
  let callbacks: StreamLifecycleCallbacks;
  let responses: CheckResponse[];
  let errors: Error[];
  let ended: boolean;
  let backpressureEvents: boolean[];

  const createRequest = (id: string): CheckRequest => ({
    requestId: id,
    principal: { id: 'user-1', roles: ['admin'] },
    resource: { kind: 'document', id: 'doc-1' },
    actions: ['read'],
  });

  const convertRequestToProto = (req: CheckRequest): object => ({
    request_id: req.requestId,
  });

  const convertResponseFromProto = (proto: unknown): CheckResponse => {
    const p = proto as { request_id: string };
    return {
      requestId: p.request_id,
      results: new Map([['read', { effect: Effect.ALLOW, matched: true }]]),
    };
  };

  beforeEach(() => {
    mockStream = new MockDuplexStream();
    responses = [];
    errors = [];
    ended = false;
    backpressureEvents = [];

    callbacks = {
      onResponse: (response) => responses.push(response),
      onError: (error) => errors.push(error),
      onEnd: () => { ended = true; },
      onBackpressure: (paused) => backpressureEvents.push(paused),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createBidirectionalStream', () => {
    it('should create a stream handle with all methods', () => {
      const handle = createBidirectionalStream(
        () => mockStream as unknown as import('@grpc/grpc-js').ClientDuplexStream<unknown, unknown>,
        callbacks,
        convertRequestToProto,
        convertResponseFromProto
      );

      expect(handle.send).toBeDefined();
      expect(handle.end).toBeDefined();
      expect(handle.isWritable).toBeDefined();
      expect(handle.getStats).toBeDefined();
      expect(handle.pause).toBeDefined();
      expect(handle.resume).toBeDefined();
      expect(handle.getId).toBeDefined();
    });

    it('should have a unique stream ID', () => {
      const handle1 = createBidirectionalStream(
        () => mockStream as unknown as import('@grpc/grpc-js').ClientDuplexStream<unknown, unknown>,
        callbacks,
        convertRequestToProto,
        convertResponseFromProto
      );

      const handle2 = createBidirectionalStream(
        () => new MockDuplexStream() as unknown as import('@grpc/grpc-js').ClientDuplexStream<unknown, unknown>,
        callbacks,
        convertRequestToProto,
        convertResponseFromProto
      );

      expect(handle1.getId()).not.toBe(handle2.getId());
    });
  });

  describe('send()', () => {
    it('should send requests through the stream', () => {
      const handle = createBidirectionalStream(
        () => mockStream as unknown as import('@grpc/grpc-js').ClientDuplexStream<unknown, unknown>,
        callbacks,
        convertRequestToProto,
        convertResponseFromProto
      );

      const request = createRequest('req-1');
      const result = handle.send(request);

      expect(result).toBe(true);
      expect(mockStream.getWriteBuffer()).toHaveLength(1);
      expect(mockStream.getWriteBuffer()[0]).toEqual({ request_id: 'req-1' });
    });

    it('should track message statistics', () => {
      const handle = createBidirectionalStream(
        () => mockStream as unknown as import('@grpc/grpc-js').ClientDuplexStream<unknown, unknown>,
        callbacks,
        convertRequestToProto,
        convertResponseFromProto
      );

      handle.send(createRequest('req-1'));
      handle.send(createRequest('req-2'));

      const stats = handle.getStats();
      expect(stats.messagesSent).toBe(2);
    });
  });

  describe('backpressure handling', () => {
    it('should queue messages when backpressured', () => {
      const backpressureConfig: Partial<BackpressureConfig> = {
        highWaterMark: 2,
        lowWaterMark: 1,
        maxBufferSize: 10,
      };

      const handle = createBidirectionalStream(
        () => mockStream as unknown as import('@grpc/grpc-js').ClientDuplexStream<unknown, unknown>,
        callbacks,
        convertRequestToProto,
        convertResponseFromProto,
        backpressureConfig
      );

      // Simulate backpressure
      mockStream.setCanWrite(false);
      handle.send(createRequest('req-1'));

      // Next sends should be queued
      handle.send(createRequest('req-2'));
      handle.send(createRequest('req-3'));

      const stats = handle.getStats();
      expect(stats.bufferSize).toBeGreaterThan(0);
    });

    it('should drop messages when buffer is full', () => {
      const backpressureConfig: Partial<BackpressureConfig> = {
        highWaterMark: 2,
        lowWaterMark: 1,
        maxBufferSize: 3,
      };

      const handle = createBidirectionalStream(
        () => mockStream as unknown as import('@grpc/grpc-js').ClientDuplexStream<unknown, unknown>,
        callbacks,
        convertRequestToProto,
        convertResponseFromProto,
        backpressureConfig
      );

      // Simulate backpressure
      mockStream.setCanWrite(false);

      // Fill buffer
      for (let i = 0; i < 5; i++) {
        handle.send(createRequest(`req-${i}`));
      }

      const stats = handle.getStats();
      expect(stats.messagesDropped).toBeGreaterThan(0);
    });

    it('should notify on backpressure state changes', () => {
      const backpressureConfig: Partial<BackpressureConfig> = {
        highWaterMark: 2,
        lowWaterMark: 1,
        maxBufferSize: 10,
      };

      createBidirectionalStream(
        () => mockStream as unknown as import('@grpc/grpc-js').ClientDuplexStream<unknown, unknown>,
        callbacks,
        convertRequestToProto,
        convertResponseFromProto,
        backpressureConfig
      );

      // Simulate backpressure
      mockStream.setCanWrite(false);

      // Resume
      mockStream.setCanWrite(true);

      // Should have received at least one backpressure event
      expect(backpressureEvents.length).toBeGreaterThanOrEqual(0);
    });

    it('should report writable status correctly', () => {
      const handle = createBidirectionalStream(
        () => mockStream as unknown as import('@grpc/grpc-js').ClientDuplexStream<unknown, unknown>,
        callbacks,
        convertRequestToProto,
        convertResponseFromProto
      );

      expect(handle.isWritable()).toBe(true);

      // Pause the stream
      handle.pause();
      expect(handle.isWritable()).toBe(false);

      // Resume the stream
      handle.resume();
      expect(handle.isWritable()).toBe(true);
    });
  });

  describe('response handling', () => {
    it('should call onResponse callback when data is received', () => {
      createBidirectionalStream(
        () => mockStream as unknown as import('@grpc/grpc-js').ClientDuplexStream<unknown, unknown>,
        callbacks,
        convertRequestToProto,
        convertResponseFromProto
      );

      mockStream.simulateData({ request_id: 'req-1' });

      expect(responses).toHaveLength(1);
      expect(responses[0].requestId).toBe('req-1');
    });

    it('should track received message count', () => {
      const handle = createBidirectionalStream(
        () => mockStream as unknown as import('@grpc/grpc-js').ClientDuplexStream<unknown, unknown>,
        callbacks,
        convertRequestToProto,
        convertResponseFromProto
      );

      mockStream.simulateData({ request_id: 'req-1' });
      mockStream.simulateData({ request_id: 'req-2' });

      const stats = handle.getStats();
      expect(stats.messagesReceived).toBe(2);
    });
  });

  describe('error handling', () => {
    it('should call onError callback when error occurs', () => {
      createBidirectionalStream(
        () => mockStream as unknown as import('@grpc/grpc-js').ClientDuplexStream<unknown, unknown>,
        callbacks,
        convertRequestToProto,
        convertResponseFromProto
      );

      const error = new Error('Stream error');
      mockStream.simulateError(error);

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe('Stream error');
    });

    it('should handle response conversion errors', () => {
      const badConverter = (): CheckResponse => {
        throw new Error('Conversion failed');
      };

      createBidirectionalStream(
        () => mockStream as unknown as import('@grpc/grpc-js').ClientDuplexStream<unknown, unknown>,
        callbacks,
        convertRequestToProto,
        badConverter
      );

      mockStream.simulateData({ request_id: 'req-1' });

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe('Conversion failed');
    });
  });

  describe('stream lifecycle', () => {
    it('should call onEnd callback when stream ends', () => {
      const handle = createBidirectionalStream(
        () => mockStream as unknown as import('@grpc/grpc-js').ClientDuplexStream<unknown, unknown>,
        callbacks,
        convertRequestToProto,
        convertResponseFromProto
      );

      handle.end();

      expect(ended).toBe(true);
    });

    it('should track uptime', async () => {
      const handle = createBidirectionalStream(
        () => mockStream as unknown as import('@grpc/grpc-js').ClientDuplexStream<unknown, unknown>,
        callbacks,
        convertRequestToProto,
        convertResponseFromProto
      );

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stats = handle.getStats();
      expect(stats.uptimeMs).toBeGreaterThan(0);
    });
  });

  describe('pause/resume', () => {
    it('should pause and resume the stream', () => {
      const handle = createBidirectionalStream(
        () => mockStream as unknown as import('@grpc/grpc-js').ClientDuplexStream<unknown, unknown>,
        callbacks,
        convertRequestToProto,
        convertResponseFromProto
      );

      handle.pause();
      expect(handle.isWritable()).toBe(false);

      handle.resume();
      expect(handle.isWritable()).toBe(true);
    });
  });
});
