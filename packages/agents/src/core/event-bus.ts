/**
 * Event Bus - Agent coordination via events
 *
 * Supports:
 * - In-memory events for single-process
 * - Redis pub/sub for multi-process
 * - Kafka for distributed deployment
 */

import { EventEmitter } from 'eventemitter3';
import type { AgentEvent, AgentEventType, AgentType } from '../types/agent.types.js';

export interface EventBusConfig {
  /** Alias for mode (for consistency with other configs) */
  type?: 'memory' | 'redis' | 'kafka';
  /** Event bus mode */
  mode?: 'memory' | 'redis' | 'kafka';
  /** Max queue size for memory mode */
  maxQueueSize?: number;
  /** Redis configuration */
  redis?: {
    host: string;
    port: number;
    password?: string;
  };
  /** Kafka configuration */
  kafka?: {
    brokers: string[];
    clientId: string;
    groupId: string;
  };
}

export type EventHandler = (event: AgentEvent) => void | Promise<void>;

export interface EventSubscription {
  id: string;
  unsubscribe: () => void;
}

export class EventBus {
  private config: EventBusConfig;
  private emitter: EventEmitter;
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private redisClient: unknown = null;
  private kafkaConsumer: unknown = null;
  private kafkaProducer: unknown = null;

  constructor(config: EventBusConfig) {
    // Normalize config - 'type' is an alias for 'mode'
    this.config = {
      ...config,
      mode: config.mode || config.type || 'memory',
    };
    this.emitter = new EventEmitter();
  }

  /** Get the effective mode */
  private getMode(): 'memory' | 'redis' | 'kafka' {
    return this.config.mode || this.config.type || 'memory';
  }

  /**
   * Initialize the event bus
   */
  async initialize(): Promise<void> {
    const mode = this.getMode();
    if (mode === 'redis' && this.config.redis) {
      await this.initializeRedis();
    } else if (mode === 'kafka' && this.config.kafka) {
      await this.initializeKafka();
    }
    // Memory mode needs no initialization
  }

  /**
   * Shutdown the event bus
   */
  async shutdown(): Promise<void> {
    const mode = this.getMode();
    if (mode === 'redis' && this.redisClient) {
      // @ts-expect-error Dynamic import type
      await this.redisClient.quit();
    } else if (mode === 'kafka') {
      if (this.kafkaConsumer) {
        // @ts-expect-error Dynamic import type
        await this.kafkaConsumer.disconnect();
      }
      if (this.kafkaProducer) {
        // @ts-expect-error Dynamic import type
        await this.kafkaProducer.disconnect();
      }
    }
  }

  /**
   * Publish an event
   */
  async publish(event: AgentEvent): Promise<void> {
    const channel = this.getChannel(event.eventType);
    const mode = this.getMode();

    if (mode === 'memory') {
      this.emitter.emit(channel, event);
      this.emitter.emit('*', event); // Wildcard listeners
    } else if (mode === 'redis' && this.redisClient) {
      // @ts-expect-error Dynamic import type
      await this.redisClient.publish(channel, JSON.stringify(event));
    } else if (mode === 'kafka' && this.kafkaProducer) {
      // @ts-expect-error Dynamic import type
      await this.kafkaProducer.send({
        topic: `authz-events-${event.agentType}`,
        messages: [{ key: event.id, value: JSON.stringify(event) }],
      });
    }
  }

  /**
   * Subscribe to events by type
   */
  subscribe(eventType: AgentEventType | '*', handler: EventHandler): EventSubscription {
    const channel = eventType === '*' ? '*' : this.getChannel(eventType);
    const subscriptionId = `${channel}-${Date.now()}-${Math.random().toString(36).substring(2)}`;

    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
    }
    this.handlers.get(channel)!.add(handler);

    const mode = this.getMode();
    if (mode === 'memory') {
      this.emitter.on(channel, handler);
    }
    // Redis and Kafka subscriptions are handled at initialization

    return {
      id: subscriptionId,
      unsubscribe: () => {
        this.handlers.get(channel)?.delete(handler);
        if (this.getMode() === 'memory') {
          this.emitter.off(channel, handler);
        }
      },
    };
  }

  /**
   * Subscribe to events from a specific agent type
   */
  subscribeToAgent(agentType: AgentType, handler: EventHandler): EventSubscription {
    const wrappedHandler: EventHandler = (event) => {
      if (event.agentType === agentType) {
        handler(event);
      }
    };

    return this.subscribe('*', wrappedHandler);
  }

  /**
   * Wait for a specific event (useful for coordination)
   */
  async waitForEvent(
    eventType: AgentEventType,
    predicate?: (event: AgentEvent) => boolean,
    timeoutMs = 30000,
  ): Promise<AgentEvent> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        subscription.unsubscribe();
        reject(new Error(`Timeout waiting for event: ${eventType}`));
      }, timeoutMs);

      const subscription = this.subscribe(eventType, (event) => {
        if (!predicate || predicate(event)) {
          clearTimeout(timeout);
          subscription.unsubscribe();
          resolve(event);
        }
      });
    });
  }

  private getChannel(eventType: AgentEventType): string {
    return `authz:events:${eventType}`;
  }

  private async initializeRedis(): Promise<void> {
    const { default: Redis } = await import('ioredis');

    // Publisher client
    this.redisClient = new Redis({
      host: this.config.redis!.host,
      port: this.config.redis!.port,
      password: this.config.redis!.password,
    });

    // Subscriber client (separate connection required)
    const subscriber = new Redis({
      host: this.config.redis!.host,
      port: this.config.redis!.port,
      password: this.config.redis!.password,
    });

    // Subscribe to pattern for all authz events
    await subscriber.psubscribe('authz:events:*');

    subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
      try {
        const event = JSON.parse(message) as AgentEvent;
        const handlers = this.handlers.get(channel);
        if (handlers) {
          handlers.forEach(handler => handler(event));
        }
        // Also notify wildcard handlers
        const wildcardHandlers = this.handlers.get('*');
        if (wildcardHandlers) {
          wildcardHandlers.forEach(handler => handler(event));
        }
      } catch (error) {
        console.error('Failed to process Redis event:', error);
      }
    });
  }

  private async initializeKafka(): Promise<void> {
    // Dynamic import - kafkajs is an optional dependency
    const { Kafka } = await import('kafkajs' as string) as { Kafka: new (config: { clientId: string; brokers: string[] }) => { producer: () => unknown; consumer: (config: { groupId: string }) => unknown } };

    const kafka = new Kafka({
      clientId: this.config.kafka!.clientId,
      brokers: this.config.kafka!.brokers,
    });

    // Producer
    this.kafkaProducer = kafka.producer();
    await (this.kafkaProducer as { connect: () => Promise<void> }).connect();

    // Consumer
    this.kafkaConsumer = kafka.consumer({ groupId: this.config.kafka!.groupId });
    await (this.kafkaConsumer as { connect: () => Promise<void> }).connect();

    // Subscribe to all agent event topics
    const topics = ['guardian', 'analyst', 'advisor', 'enforcer'].map(
      t => `authz-events-${t}`
    );

    for (const topic of topics) {
      await (this.kafkaConsumer as { subscribe: (opts: { topic: string; fromBeginning: boolean }) => Promise<void> })
        .subscribe({ topic, fromBeginning: false });
    }

    // Process messages
    await (this.kafkaConsumer as {
      run: (opts: { eachMessage: (payload: { message: { value: Buffer | null } }) => Promise<void> }) => Promise<void>
    }).run({
      eachMessage: async ({ message }) => {
        if (message.value) {
          try {
            const event = JSON.parse(message.value.toString()) as AgentEvent;
            const channel = this.getChannel(event.eventType);

            const handlers = this.handlers.get(channel);
            if (handlers) {
              for (const handler of handlers) {
                await handler(event);
              }
            }

            // Wildcard handlers
            const wildcardHandlers = this.handlers.get('*');
            if (wildcardHandlers) {
              for (const handler of wildcardHandlers) {
                await handler(event);
              }
            }
          } catch (error) {
            console.error('Failed to process Kafka event:', error);
          }
        }
      },
    });
  }
}
