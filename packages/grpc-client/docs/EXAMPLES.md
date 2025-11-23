# gRPC Client Streaming - Code Examples

Practical examples for using the enhanced streaming capabilities.

## Basic Streaming Example

```typescript
import { createClient } from '@authz-engine/grpc-client';

async function basicStreaming() {
  const client = createClient({
    address: 'localhost:50051',
    timeout: 5000
  });

  try {
    await client.connect();

    const stream = client.createBidirectionalStream({
      onResponse: (response) => {
        console.log('Authorization result:', {
          requestId: response.requestId,
          allowed: Array.from(response.results.values())
            .filter(r => r.effect === 1)
            .length > 0
        });
      },
      onError: (error) => {
        console.error('Stream error:', error.message);
      },
      onEnd: () => {
        console.log('Stream closed');
      }
    });

    // Send requests
    stream.send({
      requestId: 'req-1',
      principal: { id: 'user-123', roles: ['viewer'] },
      resource: { kind: 'document', id: 'doc-456' },
      actions: ['read']
    });

    // Close after 5 seconds
    setTimeout(() => stream.end(), 5000);
  } finally {
    client.disconnect();
  }
}

basicStreaming().catch(console.error);
```

## High-Throughput Streaming with Pooling

```typescript
import { createPooledClient } from '@authz-engine/grpc-client';

async function highThroughputStreaming() {
  const client = createPooledClient(
    ['localhost:50051', 'localhost:50052'],
    {
      connectionPool: {
        maxConnections: 20,
        loadBalancingStrategy: 'least_connections'
      },
      healthCheck: { enabled: true }
    }
  );

  try {
    await client.connect();

    // Configure stream pool for high throughput
    client.configureStreamPool({
      maxConcurrentStreams: 8,
      streamIdleTimeout: 120000
    });

    // Create stream pool
    const streams = client.createStreamPool(4, {
      onResponse: (response) => {
        console.log(`[${Date.now()}] Response: ${response.requestId}`);
      },
      onError: (error) => {
        console.error('Stream error:', error);
      },
      onEnd: () => {}
    });

    // Send requests in parallel across streams
    const requests = generateRequests(1000);
    let streamIndex = 0;

    for (const request of requests) {
      const stream = streams[streamIndex % streams.length];

      if (stream.isWritable()) {
        stream.send(request);
        streamIndex++;
      } else {
        // If backpressured, wait a bit
        await new Promise(resolve => setTimeout(resolve, 10));
        streamIndex--;
      }
    }

    // Monitor metrics
    setInterval(() => {
      const metrics = client.getStreamMonitoringMetrics();
      console.log('Stream Metrics:', {
        activeStreams: metrics.activeStreams,
        messagesSent: metrics.totalMessagesSent,
        avgLatency: metrics.avgLatencyMs,
        backpressureEvents: metrics.backpressureEvents
      });
    }, 5000);

    // Wait for completion
    await new Promise(resolve => setTimeout(resolve, 30000));
  } finally {
    client.closeAllStreams();
    client.disconnect();
  }
}

function generateRequests(count: number) {
  const requests = [];
  for (let i = 0; i < count; i++) {
    requests.push({
      requestId: `req-${i}`,
      principal: { id: `user-${i % 100}`, roles: ['member'] },
      resource: { kind: 'resource', id: `res-${i % 50}` },
      actions: ['read', 'write']
    });
  }
  return requests;
}

highThroughputStreaming().catch(console.error);
```

## Health Monitoring with Automatic Failover

```typescript
import { createPooledClient } from '@authz-engine/grpc-client';

async function healthMonitoringExample() {
  const client = createPooledClient(
    [
      'primary-server:50051',
      'backup-server-1:50051',
      'backup-server-2:50051'
    ],
    {
      healthCheck: {
        enabled: true,
        interval: 5000,
        timeout: 2000,
        unhealthyThreshold: 3,
        healthyThreshold: 2
      },
      failover: {
        enabled: true,
        failoverThreshold: 3,
        failbackDelay: 60000
      }
    }
  );

  try {
    await client.connect();

    // Subscribe to health updates
    const unsubscribe = client.subscribeToHealthStream({
      onStatusChange: (status, previous) => {
        console.log(`Health status changed: ${previous} -> ${status}`);
      },
      onHealthCheck: (result) => {
        console.log(`Health check completed in ${result.latencyMs}ms: ${result.status}`);
      },
      onError: (error) => {
        console.error('Health check error:', error);
      }
    });

    // Create health monitoring stream
    const monitor = client.createHealthMonitoringStream(10000);

    // Listen for events
    client.on('health_stream_check', (result) => {
      console.log(`[${new Date().toISOString()}] Health: ${result.status}`);
    });

    client.on('failover_started', (info) => {
      console.log(`Failover started: ${info.from} -> ${info.to}`);
    });

    client.on('failover_completed', (info) => {
      console.log(`Failover completed to ${info.address}`);
    });

    client.on('failback_completed', (info) => {
      console.log(`Failback completed to ${info.address}`);
    });

    // Keep running
    await new Promise(resolve => setTimeout(resolve, 300000));

    monitor.unsubscribe();
    unsubscribe();
  } finally {
    client.disconnect();
  }
}

healthMonitoringExample().catch(console.error);
```

## Backpressure Handling

```typescript
import { createClient } from '@authz-engine/grpc-client';

async function backpressureHandling() {
  const client = createClient({
    address: 'localhost:50051'
  });

  try {
    await client.connect();

    let totalSent = 0;
    let totalDropped = 0;
    let isPaused = false;

    const stream = client.createBidirectionalStream(
      {
        onResponse: (response) => {
          console.log(`Response: ${response.requestId}`);
        },
        onError: (error) => {
          console.error('Error:', error);
        },
        onEnd: () => {
          console.log(`Stream ended. Sent: ${totalSent}, Dropped: ${totalDropped}`);
        },
        onBackpressure: (paused) => {
          isPaused = paused;
          if (paused) {
            console.log('Backpressure: Paused - queue is full');
          } else {
            console.log('Backpressure: Resumed - queue has capacity');
          }
        }
      },
      {
        highWaterMark: 100,   // Pause when 100 messages queued
        lowWaterMark: 50,     // Resume when below 50
        maxBufferSize: 500    // Drop if exceeds 500
      }
    );

    // Simulate high-rate sending
    const sendRequests = setInterval(() => {
      // Try to send 10 requests per interval
      for (let i = 0; i < 10; i++) {
        if (stream.isWritable()) {
          stream.send({
            requestId: `req-${totalSent}`,
            principal: { id: 'user', roles: [] },
            resource: { kind: 'doc', id: 'doc' },
            actions: ['read']
          });
          totalSent++;
        } else {
          totalDropped++;
        }
      }

      // Log stats every 5 sends
      if (totalSent % 50 === 0) {
        const stats = stream.getStats();
        console.log('Stream Stats:', {
          sent: stats.messagesSent,
          received: stats.messagesReceived,
          bufferSize: stats.bufferSize,
          avgLatency: stats.avgLatencyMs,
          isPaused
        });
      }
    }, 100);

    // Stop after 10 seconds
    setTimeout(() => {
      clearInterval(sendRequests);
      stream.end();
    }, 10000);
  } finally {
    client.disconnect();
  }
}

backpressureHandling().catch(console.error);
```

## Request Deduplication

```typescript
import { createClient } from '@authz-engine/grpc-client';

async function deduplicationExample() {
  const client = createClient({
    address: 'localhost:50051'
  });

  try {
    await client.connect();

    // Enable deduplication with 1000-entry cache
    client.enableDeduplication(1000);

    const stream = client.createBidirectionalStream({
      onResponse: (response) => {
        console.log(`Response for ${response.requestId}`);
      },
      onError: (error) => {
        console.error('Error:', error);
      },
      onEnd: () => {}
    });

    // Send requests with some duplicates
    const uniqueIds = ['user-1', 'user-2', 'user-3'];
    let requestsSent = 0;
    let requestsDeduped = 0;

    for (let i = 0; i < 100; i++) {
      const userId = uniqueIds[i % uniqueIds.length];
      const requestId = `check-${userId}-${Math.floor(i / 10)}`;

      if (client.isDeduplicated(requestId)) {
        // Use cached response
        const cachedResponse = client.getDedupedResponse(requestId);
        console.log(`Using cached response for ${requestId}`);
        requestsDeduped++;
      } else {
        // Send new request
        stream.send({
          requestId,
          principal: { id: userId, roles: ['user'] },
          resource: { kind: 'document', id: 'doc-1' },
          actions: ['read']
        });
        requestsSent++;
      }
    }

    console.log(`Requests sent: ${requestsSent}, Deduped: ${requestsDeduped}`);

    // Monitor cache
    setInterval(() => {
      const cacheStats = client.getDeduplicationCacheStats();
      console.log(`Cache: ${cacheStats.size}/${cacheStats.capacity}`);
    }, 5000);

    setTimeout(() => stream.end(), 10000);
  } finally {
    client.disconnect();
  }
}

deduplicationExample().catch(console.error);
```

## Stream Lifecycle Management

```typescript
import { createClient } from '@authz-engine/grpc-client';

async function streamLifecycleExample() {
  const client = createClient({
    address: 'localhost:50051'
  });

  try {
    await client.connect();

    // Create multiple streams for testing
    const callbacks = {
      onResponse: (response) => {
        console.log(`Stream response: ${response.requestId}`);
      },
      onError: (error) => {
        console.error('Stream error:', error);
      },
      onEnd: () => {},
      onBackpressure: () => {},
      onReconnect: () => {}
    };

    const stream1 = client.createBidirectionalStream(callbacks);
    const stream2 = client.createBidirectionalStream(callbacks);
    const stream3 = client.createBidirectionalStream(callbacks);

    console.log(`Created 3 streams`);
    console.log(`Active streams: ${client.getActiveStreamCount()}`);
    console.log(`Stream IDs: ${client.listActiveStreamIds().join(', ')}`);

    // Send on each stream
    stream1.send({
      requestId: 'req-1',
      principal: { id: 'user-1', roles: [] },
      resource: { kind: 'doc', id: 'doc-1' },
      actions: ['read']
    });

    stream2.send({
      requestId: 'req-2',
      principal: { id: 'user-2', roles: [] },
      resource: { kind: 'doc', id: 'doc-2' },
      actions: ['read']
    });

    // Pause stream 1
    stream1.pause();
    console.log('Stream 1 paused');

    // Resume stream 1
    setTimeout(() => {
      stream1.resume();
      console.log('Stream 1 resumed');
    }, 2000);

    // Close stream 2
    setTimeout(() => {
      const streamId = client.listActiveStreamIds()[1];
      if (streamId) {
        client.closeStream(streamId);
        console.log(`Closed stream ${streamId}`);
      }
    }, 4000);

    // Get diagnostics
    setTimeout(() => {
      const diagnostics = client.getStreamDiagnostics();
      console.log('Stream Diagnostics:', {
        activeStreams: diagnostics.metrics.activeStreams,
        streamIds: diagnostics.activeStreamIds,
        config: diagnostics.poolConfig
      });
    }, 6000);

    // Close all streams
    setTimeout(() => {
      client.closeAllStreams();
      console.log('All streams closed');
    }, 8000);
  } finally {
    client.disconnect();
  }
}

streamLifecycleExample().catch(console.error);
```

## Performance Monitoring

```typescript
import { createClient } from '@authz-engine/grpc-client';

async function performanceMonitoring() {
  const client = createClient({
    address: 'localhost:50051'
  });

  try {
    await client.connect();

    const stream = client.createBidirectionalStream({
      onResponse: (response) => {},
      onError: (error) => {
        console.error('Error:', error);
      },
      onEnd: () => {}
    });

    // Monitor performance metrics
    const monitoringInterval = setInterval(() => {
      const streamMetrics = client.getStreamMonitoringMetrics();
      const clientStats = client.getStats();

      console.log('=== Performance Metrics ===');
      console.log('Stream Metrics:', {
        activeStreams: streamMetrics.activeStreams,
        totalSent: streamMetrics.totalMessagesSent,
        totalReceived: streamMetrics.totalMessagesReceived,
        avgLatency: streamMetrics.avgLatencyMs.toFixed(2),
        peakBuffer: streamMetrics.peakBufferSize,
        backpressureEvents: streamMetrics.backpressureEvents
      });

      console.log('Client Stats:', {
        totalRequests: clientStats.totalRequests,
        successful: clientStats.successfulRequests,
        failed: clientStats.failedRequests,
        avgLatency: clientStats.avgLatencyMs.toFixed(2),
        cacheHitRate: (clientStats.cacheHitRate * 100).toFixed(1) + '%'
      });

      const health = client.getHealth();
      console.log('Health Status:', {
        status: health.status,
        state: health.connectionState,
        consecutiveFailures: health.consecutiveFailures,
        consecutiveSuccesses: health.consecutiveSuccesses
      });
    }, 5000);

    // Send test requests
    let count = 0;
    const sendInterval = setInterval(() => {
      if (stream.isWritable() && count < 1000) {
        stream.send({
          requestId: `perf-test-${count}`,
          principal: { id: 'perf-user', roles: [] },
          resource: { kind: 'metric', id: 'metric-test' },
          actions: ['measure']
        });
        count++;
      }
    }, 10);

    // Stop monitoring after 30 seconds
    setTimeout(() => {
      clearInterval(sendInterval);
      clearInterval(monitoringInterval);
      stream.end();
    }, 30000);
  } finally {
    client.disconnect();
  }
}

performanceMonitoring().catch(console.error);
```

## Error Recovery Pattern

```typescript
import { createClient } from '@authz-engine/grpc-client';

async function errorRecoveryPattern() {
  const client = createClient({
    address: 'localhost:50051',
    maxRetries: 3,
    retryDelay: 1000
  });

  try {
    await client.connect();

    let reconnectAttempts = 0;
    const maxReconnects = 5;

    const stream = client.createBidirectionalStream({
      onResponse: (response) => {
        // Reset reconnect counter on successful response
        reconnectAttempts = 0;
        console.log(`Success: ${response.requestId}`);
      },
      onError: (error) => {
        console.error(`Error (attempt ${reconnectAttempts + 1}):`, error.message);

        if (reconnectAttempts >= maxReconnects) {
          console.error('Max reconnection attempts exceeded');
          // Notify monitoring system
          process.exit(1);
        }
      },
      onEnd: () => {
        console.log('Stream ended');
      },
      onReconnect: (attempt) => {
        reconnectAttempts = attempt;
        console.log(`Reconnection attempt ${attempt}`);

        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
        console.log(`Will retry in ${delay}ms`);
      }
    });

    // Send test requests
    for (let i = 0; i < 100; i++) {
      if (stream.isWritable()) {
        stream.send({
          requestId: `recovery-${i}`,
          principal: { id: 'user', roles: [] },
          resource: { kind: 'test', id: 'test' },
          actions: ['test']
        });
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    setTimeout(() => stream.end(), 20000);
  } finally {
    client.disconnect();
  }
}

errorRecoveryPattern().catch(console.error);
```

These examples demonstrate various streaming patterns and best practices for the AuthZ Engine gRPC client.
