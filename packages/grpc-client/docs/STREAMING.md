# Bidirectional Streaming Guide

This document provides a comprehensive guide to using the enhanced bidirectional streaming capabilities of the AuthZ Engine gRPC client.

## Overview

The gRPC client supports three types of streaming operations:

1. **Bidirectional Streaming** - Real-time authorization checks with backpressure management
2. **Health Monitoring Streams** - Continuous health checks with automatic failover
3. **Stream Pooling** - Multiple concurrent streams for high-throughput scenarios

## Bidirectional Streaming

### Basic Usage

Create a bidirectional stream for real-time authorization checks:

```typescript
import { createClient } from '@authz-engine/grpc-client';

const client = createClient({
  address: 'localhost:50051'
});

await client.connect();

// Create a bidirectional stream
const handle = client.createBidirectionalStream({
  onResponse: (response) => {
    console.log('Authorization result:', response);
  },
  onError: (error) => {
    console.error('Stream error:', error);
  },
  onEnd: () => {
    console.log('Stream ended');
  },
  onBackpressure: (paused) => {
    console.log('Backpressure:', paused ? 'paused' : 'resumed');
  },
  onReconnect: (attempt) => {
    console.log(`Reconnecting (attempt ${attempt})`);
  }
});

// Send authorization checks
const request = {
  requestId: 'check-1',
  principal: { id: 'user-123', roles: ['admin'] },
  resource: { kind: 'document', id: 'doc-456' },
  actions: ['read', 'write']
};

handle.send(request);

// Check if stream can accept more data
if (handle.isWritable()) {
  handle.send(anotherRequest);
}

// Get stream statistics
const stats = handle.getStats();
console.log(`Messages sent: ${stats.messagesSent}`);
console.log(`Messages received: ${stats.messagesReceived}`);
console.log(`Average latency: ${stats.avgLatencyMs}ms`);

// Pause receiving messages
handle.pause();

// Resume receiving messages
handle.resume();

// End the stream
handle.end();
```

### Advanced Features

#### Backpressure Management

The client automatically handles backpressure to prevent overwhelming the server or buffering too much data:

```typescript
// Configure backpressure behavior
const handle = client.createBidirectionalStream(
  {
    onResponse: (response) => { /* ... */ },
    onError: (error) => { /* ... */ },
    onEnd: () => { /* ... */ },
    onBackpressure: (paused) => {
      if (paused) {
        console.log('Queue is full, pausing sends');
      } else {
        console.log('Queue has capacity, resuming sends');
      }
    }
  },
  {
    highWaterMark: 100,  // Pause when queue reaches 100 messages
    lowWaterMark: 50,    // Resume when queue drops below 50 messages
    maxBufferSize: 1000  // Drop messages if queue exceeds 1000
  }
);

// Check if it's safe to send
if (handle.isWritable()) {
  handle.send(request);
} else {
  console.log('Stream is backpressured, message not sent');
}
```

**Backpressure Parameters:**
- `highWaterMark` (default: 100): Queue size threshold above which sending pauses
- `lowWaterMark` (default: 50): Queue size threshold below which sending resumes
- `maxBufferSize` (default: 1000): Maximum queue size before dropping messages

#### Stream Lifecycle Control

Manage stream pause/resume behavior:

```typescript
// Pause the stream temporarily (useful for rate limiting)
handle.pause();

// Perform some operation
await performLongRunningTask();

// Resume the stream
handle.resume();

// Check stream status
const stats = handle.getStats();
const streamId = handle.getId();

console.log(`Stream ${streamId} uptime: ${stats.uptimeMs}ms`);
```

## Stream Pooling

For high-throughput scenarios, create multiple concurrent streams:

```typescript
// Configure stream pool
client.configureStreamPool({
  maxConcurrentStreams: 10,
  streamIdleTimeout: 300000,      // 5 minutes
  enableStreamReuse: true,
  streamReuseTimeout: 60000       // 1 minute
});

// Create a pool of streams
const handles = client.createStreamPool(5, {
  onResponse: (response) => {
    console.log('Got response:', response.requestId);
  },
  onError: (error) => {
    console.error('Stream error:', error);
  },
  onEnd: () => {
    console.log('Stream ended');
  }
});

// Distribute requests across streams
let currentStreamIndex = 0;
for (const request of requests) {
  const handle = handles[currentStreamIndex];
  if (handle.isWritable()) {
    handle.send(request);
    currentStreamIndex = (currentStreamIndex + 1) % handles.length;
  }
}

// Monitor pool health
const metrics = client.getStreamMonitoringMetrics();
console.log(`Active streams: ${metrics.activeStreams}`);
console.log(`Total messages sent: ${metrics.totalMessagesSent}`);
console.log(`Total messages received: ${metrics.totalMessagesReceived}`);
console.log(`Average latency: ${metrics.avgLatencyMs}ms`);
```

## Stream Management

### Monitoring Streams

Get detailed metrics about stream performance:

```typescript
// Get detailed diagnostics
const diagnostics = client.getStreamDiagnostics();

console.log('Stream Metrics:', diagnostics.metrics);
console.log('Pool Configuration:', diagnostics.poolConfig);
console.log('Advanced Options:', diagnostics.advancedOptions);
console.log('Deduplication Stats:', diagnostics.deduplicationStats);
console.log('Active Stream IDs:', diagnostics.activeStreamIds);

// Get specific stream
const streamId = diagnostics.activeStreamIds[0];
const stream = client.getStream(streamId);
if (stream) {
  const stats = stream.getStats();
  console.log(`Stream ${streamId} stats:`, stats);
}

// Check active stream count
const count = client.getActiveStreamCount();
console.log(`Currently ${count} active streams`);
```

### Closing Streams

```typescript
// Close a specific stream
client.closeStream(streamId);

// Close all streams
client.closeAllStreams();

// List active stream IDs
const activeIds = client.listActiveStreamIds();
console.log(`Active streams: ${activeIds.join(', ')}`);
```

## Request Deduplication

Prevent duplicate processing using the built-in deduplication cache:

```typescript
// Enable deduplication with cache size of 500
client.enableDeduplication(500);

// Check if request is in cache
if (client.isDeduplicated('request-123')) {
  const cachedResponse = client.getDedupedResponse('request-123');
  console.log('Using cached response:', cachedResponse);
} else {
  // Send the request through the stream
  handle.send(request);
}

// Get deduplication stats
const stats = client.getDeduplicationCacheStats();
console.log(`Cache size: ${stats.size}/${stats.capacity}`);

// Clear cache if needed
client.clearDeduplicationCache();

// Disable deduplication
client.disableDeduplication();
```

## Health Monitoring Streams

Monitor server health with automatic failover:

```typescript
// Create a health monitoring stream
const healthMonitor = client.createHealthMonitoringStream(5000);

// Listen for health checks via events
client.on('health_stream_check', (result) => {
  console.log(`Health check: ${result.status}`);
  console.log(`Latency: ${result.latencyMs}ms`);
});

client.on('health_stream_error', (error) => {
  console.error('Health check error:', error);
});

// Unsubscribe when done
healthMonitor.unsubscribe();

// Manual health check
const health = await client.checkHealth();
console.log('Current health:', health.status);
console.log('Connection state:', health.connectionState);
console.log('Consecutive failures:', health.consecutiveFailures);
```

## Advanced Stream Configuration

### Configuring Advanced Options

```typescript
// Enable advanced stream features
client.configureAdvancedStreamOptions({
  multiplexing: true,              // Use stream multiplexing
  maxRequestsPerStream: 1000,      // Rotate stream after 1000 requests
  deduplication: true,             // Enable request deduplication
  deduplicationCacheSize: 200,     // Cache size for deduplication
  ensureOrdering: true             // Maintain response ordering
});
```

### Custom Stream Pool Configuration

```typescript
// Customize stream pool behavior
client.configureStreamPool({
  maxConcurrentStreams: 20,        // Allow up to 20 concurrent streams
  streamIdleTimeout: 600000,       // Clean up idle streams after 10 minutes
  enableStreamReuse: true,         // Reuse idle streams
  streamReuseTimeout: 120000       // Reuse timeout of 2 minutes
});
```

## Event Handling

Subscribe to stream events:

```typescript
// Backpressure events
client.on('backpressure_start', () => {
  console.log('Backpressure activated');
});

client.on('backpressure_end', () => {
  console.log('Backpressure resolved');
});

// Reconnection events
client.on('stream_reconnecting', (info) => {
  console.log(`Reconnecting stream (attempt ${info.attempt})`);
});

client.on('stream_reconnected', (info) => {
  console.log('Stream reconnected successfully');
});

// Stream pool events
client.on('stream_pool_creation_error', (info) => {
  console.error(`Failed to create stream at index ${info.index}:`, info.error);
});

// Health check events
client.on('health_stream_check', (result) => {
  console.log(`Health: ${result.status}, Latency: ${result.latencyMs}ms`);
});

client.on('health_stream_error', (error) => {
  console.error('Health check error:', error);
});
```

## Performance Tuning

### Optimizing for Throughput

```typescript
// For maximum throughput:
client.configureStreamPool({
  maxConcurrentStreams: 16,
  streamIdleTimeout: 120000,
  enableStreamReuse: true,
  streamReuseTimeout: 30000
});

client.configureAdvancedStreamOptions({
  multiplexing: true,
  maxRequestsPerStream: 500,
  ensureOrdering: false  // Disable ordering for better throughput
});

// Create more streams
const handles = client.createStreamPool(8, callbacks);
```

### Optimizing for Latency

```typescript
// For minimum latency:
client.configureStreamPool({
  maxConcurrentStreams: 4,
  streamIdleTimeout: 60000,
  enableStreamReuse: true
});

client.configureAdvancedStreamOptions({
  multiplexing: false,
  deduplication: false,
  ensureOrdering: true
});
```

## Error Handling and Recovery

```typescript
const handle = client.createBidirectionalStream({
  onResponse: (response) => {
    // Process response
  },
  onError: (error) => {
    console.error('Stream error:', error.message);
    // Error handling logic
  },
  onEnd: () => {
    console.log('Stream ended');
  },
  onReconnect: (attempt) => {
    console.log(`Reconnection attempt ${attempt}`);
    // Implement backoff or alerting
    if (attempt > 10) {
      console.error('Max reconnection attempts exceeded');
      // Notify monitoring system
    }
  }
});
```

## Best Practices

1. **Always check `isWritable()` before sending**
   ```typescript
   if (handle.isWritable()) {
     handle.send(request);
   }
   ```

2. **Monitor backpressure events**
   ```typescript
   onBackpressure: (paused) => {
     if (paused) {
       // Reduce request rate
     }
   }
   ```

3. **Cleanup streams properly**
   ```typescript
   client.closeAllStreams();
   await client.disconnect();
   ```

4. **Use stream pooling for high throughput**
   - Distribute requests across multiple streams
   - Use round-robin or load-balanced selection

5. **Enable deduplication for idempotent operations**
   ```typescript
   client.enableDeduplication(500);
   ```

6. **Monitor health continuously**
   ```typescript
   const healthMonitor = client.createHealthMonitoringStream(5000);
   ```

7. **Configure appropriate timeouts**
   - Match backpressure marks to your use case
   - Adjust pool idle timeouts based on load patterns

## Common Patterns

### Request/Response Pattern

```typescript
const handleRequest = async (request: CheckRequest) => {
  return new Promise((resolve, reject) => {
    const responsesMap = new Map<string, CheckResponse>();

    const handle = client.createBidirectionalStream({
      onResponse: (response) => {
        if (response.requestId === request.requestId) {
          resolve(response);
        }
      },
      onError: reject,
      onEnd: () => {
        if (!responsesMap.has(request.requestId)) {
          reject(new Error('Stream ended without response'));
        }
      }
    });

    handle.send(request);
  });
};
```

### Batch Processing Pattern

```typescript
const processBatch = async (requests: CheckRequest[]) => {
  const handles = client.createStreamPool(4, {
    onResponse: (response) => {
      console.log('Processed:', response.requestId);
    },
    onError: (error) => {
      console.error('Batch error:', error);
    },
    onEnd: () => {}
  });

  let index = 0;
  for (const request of requests) {
    const handle = handles[index % handles.length];
    if (handle.isWritable()) {
      handle.send(request);
      index++;
    }
  }
};
```

### Continuous Monitoring Pattern

```typescript
const monitorAuthorizations = () => {
  const handle = client.createBidirectionalStream({
    onResponse: (response) => {
      // Log and analyze authorization decisions
      console.log(`Decision: ${response.requestId} => ${response.results.get('action')?.effect}`);
    },
    onError: (error) => {
      console.error('Monitoring error:', error);
    },
    onEnd: () => {
      console.log('Monitoring stopped');
    }
  });

  // Periodically send health checks
  const checkInterval = setInterval(() => {
    if (!handle.isWritable()) {
      clearInterval(checkInterval);
      handle.end();
      return;
    }

    const healthCheck: CheckRequest = {
      requestId: `health-${Date.now()}`,
      principal: { id: 'monitor', roles: [] },
      resource: { kind: 'health', id: 'check' },
      actions: ['ping']
    };

    handle.send(healthCheck);
  }, 10000);

  return () => {
    clearInterval(checkInterval);
    handle.end();
  };
};
```

## Troubleshooting

### High Latency
- Check `avgLatencyMs` in stream stats
- Verify network connectivity
- Reduce stream pool size to reduce contention
- Check server load

### Backpressure Events
- Indicates client is sending faster than server can process
- Reduce send rate
- Increase `lowWaterMark` threshold
- Check server capacity

### Stream Disconnections
- Monitor reconnection attempts in logs
- Check network stability
- Verify server availability
- Review health monitoring metrics

### Memory Growth
- Monitor `peakBufferSize` metric
- Tune backpressure watermarks
- Enable stream idle cleanup
- Review deduplication cache size
