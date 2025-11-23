/**
 * Bidirectional Streaming Support for AuthZ Engine gRPC Client
 */

import * as grpc from '@grpc/grpc-js';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
  type CheckRequest,
  type CheckResponse,
  type BackpressureConfig,
  type StreamStats,
  type BidirectionalStreamHandle,
  type StreamLifecycleCallbacks,
  type ReconnectConfig,
  DEFAULT_BACKPRESSURE_CONFIG,
  DEFAULT_RECONNECT_CONFIG,
} from './types.js';

/**
 * Internal message queue entry
 */
interface QueuedMessage {
  request: CheckRequest;
  timestamp: number;
}

/**
 * Bidirectional stream manager with backpressure support
 */
export class BidirectionalStreamManager extends EventEmitter {
  private readonly id: string;
  private readonly backpressureConfig: BackpressureConfig;
  private readonly reconnectConfig: ReconnectConfig;
  private readonly callbacks: StreamLifecycleCallbacks;
  private readonly convertRequestToProto: (req: CheckRequest) => object;
  private readonly convertResponseFromProto: (proto: unknown) => CheckResponse;

  private stream: grpc.ClientDuplexStream<unknown, unknown> | null = null;
  private messageQueue: QueuedMessage[] = [];
  private isPaused = false;
  private isBackpressured = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private startTime: number;

  private stats: StreamStats = {
    messagesSent: 0,
    messagesReceived: 0,
    messagesDropped: 0,
    bufferSize: 0,
    uptimeMs: 0,
    avgLatencyMs: 0,
  };

  private totalLatency = 0;
  private pendingRequests = new Map<string, number>();

  constructor(
    createStreamFn: () => grpc.ClientDuplexStream<unknown, unknown>,
    callbacks: StreamLifecycleCallbacks,
    convertRequestToProto: (req: CheckRequest) => object,
    convertResponseFromProto: (proto: unknown) => CheckResponse,
    backpressureConfig?: Partial<BackpressureConfig>,
    reconnectConfig?: Partial<ReconnectConfig>
  ) {
    super();
    this.id = randomUUID();
    this.callbacks = callbacks;
    this.convertRequestToProto = convertRequestToProto;
    this.convertResponseFromProto = convertResponseFromProto;
    this.backpressureConfig = {
      ...DEFAULT_BACKPRESSURE_CONFIG,
      ...backpressureConfig,
    };
    this.reconnectConfig = {
      ...DEFAULT_RECONNECT_CONFIG,
      ...reconnectConfig,
    };
    this.startTime = Date.now();

    this.initializeStream(createStreamFn);
  }

  /**
   * Initialize the stream with event handlers
   */
  private initializeStream(
    createStreamFn: () => grpc.ClientDuplexStream<unknown, unknown>
  ): void {
    try {
      this.stream = createStreamFn();
      this.setupStreamHandlers();
      this.reconnectAttempts = 0;
      this.emit('connected');
    } catch (error) {
      this.handleReconnect(createStreamFn, error as Error);
    }
  }

  /**
   * Setup stream event handlers
   */
  private setupStreamHandlers(): void {
    if (!this.stream) return;

    this.stream.on('data', (data: unknown) => {
      this.handleData(data);
    });

    this.stream.on('error', (error: Error) => {
      this.callbacks.onError(error);
      this.emit('error', error);
    });

    this.stream.on('end', () => {
      this.callbacks.onEnd();
      this.emit('end');
    });

    // Handle drain event for backpressure
    this.stream.on('drain', () => {
      this.handleDrain();
    });
  }

  /**
   * Handle incoming data
   */
  private handleData(data: unknown): void {
    try {
      this.stats.messagesReceived++;
      const response = this.convertResponseFromProto(data);

      // Calculate latency if we have a pending request
      const sendTime = this.pendingRequests.get(response.requestId);
      if (sendTime) {
        const latency = Date.now() - sendTime;
        this.totalLatency += latency;
        this.stats.avgLatencyMs = this.totalLatency / this.stats.messagesReceived;
        this.pendingRequests.delete(response.requestId);
      }

      this.callbacks.onResponse(response);
    } catch (error) {
      this.callbacks.onError(error as Error);
    }
  }

  /**
   * Handle drain event - resume sending queued messages
   */
  private handleDrain(): void {
    if (this.isBackpressured) {
      this.isBackpressured = false;
      this.callbacks.onBackpressure?.(false);
      this.emit('backpressure', false);
      this.flushQueue();
    }
  }

  /**
   * Handle reconnection with exponential backoff
   */
  private handleReconnect(
    createStreamFn: () => grpc.ClientDuplexStream<unknown, unknown>,
    error: Error
  ): void {
    if (this.reconnectAttempts >= this.reconnectConfig.maxAttempts) {
      this.callbacks.onError(
        new Error(`Max reconnection attempts (${this.reconnectConfig.maxAttempts}) exceeded: ${error.message}`)
      );
      return;
    }

    this.reconnectAttempts++;
    this.callbacks.onReconnect?.(this.reconnectAttempts);

    const delay = this.calculateBackoffDelay();
    this.reconnectTimer = setTimeout(() => {
      this.initializeStream(createStreamFn);
    }, delay);
  }

  /**
   * Calculate exponential backoff delay with optional jitter
   */
  private calculateBackoffDelay(): number {
    let delay = Math.min(
      this.reconnectConfig.initialDelay *
        Math.pow(this.reconnectConfig.multiplier, this.reconnectAttempts - 1),
      this.reconnectConfig.maxDelay
    );

    if (this.reconnectConfig.jitter) {
      // Add up to 30% jitter
      delay = delay * (1 + Math.random() * 0.3);
    }

    return Math.floor(delay);
  }

  /**
   * Flush queued messages
   */
  private flushQueue(): void {
    while (this.messageQueue.length > 0 && !this.isBackpressured && this.stream) {
      const message = this.messageQueue.shift();
      if (message) {
        this.writeToStream(message.request);
      }
    }
    this.stats.bufferSize = this.messageQueue.length;
  }

  /**
   * Write a message to the stream
   */
  private writeToStream(request: CheckRequest): boolean {
    if (!this.stream) return false;

    const proto = this.convertRequestToProto(request);
    this.pendingRequests.set(request.requestId, Date.now());

    const canContinue = this.stream.write(proto);
    this.stats.messagesSent++;

    if (!canContinue) {
      this.isBackpressured = true;
      this.callbacks.onBackpressure?.(true);
      this.emit('backpressure', true);
    }

    return canContinue;
  }

  /**
   * Send a request through the stream
   */
  send(request: CheckRequest): boolean {
    // Check if buffer is full
    if (this.messageQueue.length >= this.backpressureConfig.maxBufferSize) {
      this.stats.messagesDropped++;
      return false;
    }

    // If backpressured or paused, queue the message
    if (this.isBackpressured || this.isPaused || !this.stream) {
      this.messageQueue.push({
        request,
        timestamp: Date.now(),
      });
      this.stats.bufferSize = this.messageQueue.length;

      // Check high watermark
      if (this.messageQueue.length >= this.backpressureConfig.highWaterMark) {
        this.isBackpressured = true;
        this.callbacks.onBackpressure?.(true);
        this.emit('backpressure', true);
      }

      return true;
    }

    return this.writeToStream(request);
  }

  /**
   * End the stream gracefully
   */
  end(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Flush remaining queue
    this.flushQueue();

    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }

  /**
   * Check if stream is writable
   */
  isWritable(): boolean {
    return (
      !this.isBackpressured &&
      !this.isPaused &&
      this.stream !== null &&
      this.messageQueue.length < this.backpressureConfig.highWaterMark
    );
  }

  /**
   * Get stream statistics
   */
  getStats(): StreamStats {
    return {
      ...this.stats,
      uptimeMs: Date.now() - this.startTime,
    };
  }

  /**
   * Pause receiving messages
   */
  pause(): void {
    this.isPaused = true;
    if (this.stream && typeof (this.stream as { pause?: () => void }).pause === 'function') {
      (this.stream as { pause: () => void }).pause();
    }
  }

  /**
   * Resume receiving messages
   */
  resume(): void {
    this.isPaused = false;
    if (this.stream && typeof (this.stream as { resume?: () => void }).resume === 'function') {
      (this.stream as { resume: () => void }).resume();
    }
    this.flushQueue();
  }

  /**
   * Get stream ID
   */
  getId(): string {
    return this.id;
  }

  /**
   * Get the stream handle interface
   */
  getHandle(): BidirectionalStreamHandle {
    return {
      send: this.send.bind(this),
      end: this.end.bind(this),
      isWritable: this.isWritable.bind(this),
      getStats: this.getStats.bind(this),
      pause: this.pause.bind(this),
      resume: this.resume.bind(this),
      getId: this.getId.bind(this),
    };
  }
}

/**
 * Create a bidirectional stream with backpressure support
 */
export function createBidirectionalStream(
  createStreamFn: () => grpc.ClientDuplexStream<unknown, unknown>,
  callbacks: StreamLifecycleCallbacks,
  convertRequestToProto: (req: CheckRequest) => object,
  convertResponseFromProto: (proto: unknown) => CheckResponse,
  backpressureConfig?: Partial<BackpressureConfig>,
  reconnectConfig?: Partial<ReconnectConfig>
): BidirectionalStreamHandle {
  const manager = new BidirectionalStreamManager(
    createStreamFn,
    callbacks,
    convertRequestToProto,
    convertResponseFromProto,
    backpressureConfig,
    reconnectConfig
  );

  return manager.getHandle();
}
