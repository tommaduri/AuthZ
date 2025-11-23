# gRPC Client Streaming - Complete Guide Index

## Quick Navigation

Welcome to the enhanced AuthZ Engine gRPC client streaming documentation. Use this index to quickly find what you need.

## Getting Started

### New to Streaming?
1. Start with **[ENHANCEMENT_SUMMARY.md](./ENHANCEMENT_SUMMARY.md)** - High-level overview of all enhancements
2. Read **[docs/STREAMING.md](./docs/STREAMING.md#overview)** - Core concepts and basic usage
3. Try **[docs/EXAMPLES.md - Basic Streaming Example](./docs/EXAMPLES.md#basic-streaming-example)** - Simple working example

### Want to Get Started Quickly?
1. **[docs/EXAMPLES.md - Basic Streaming](./docs/EXAMPLES.md#basic-streaming-example)** - 30-line example
2. **[docs/STREAMING.md - Basic Usage](./docs/STREAMING.md#basic-usage)** - Copy-paste ready code

## Feature Guides

### Bidirectional Streaming
- **Overview**: [ENHANCEMENT_SUMMARY.md - Bidirectional Streaming](./ENHANCEMENT_SUMMARY.md#1-bidirectional-streaming-with-backpressure-management)
- **Tutorial**: [docs/STREAMING.md - Bidirectional Streaming](./docs/STREAMING.md#bidirectional-streaming)
- **Example**: [docs/EXAMPLES.md - Basic Streaming](./docs/EXAMPLES.md#basic-streaming-example)
- **Advanced**: [docs/STREAMING.md - Advanced Features](./docs/STREAMING.md#advanced-features)

### Connection Pooling
- **Overview**: [ENHANCEMENT_SUMMARY.md - Connection Pooling](./ENHANCEMENT_SUMMARY.md#2-connection-pooling-with-load-balancing)
- **Tutorial**: [docs/STREAMING.md - Stream Pooling](./docs/STREAMING.md#stream-pooling)
- **Example**: [docs/EXAMPLES.md - High-Throughput](./docs/EXAMPLES.md#high-throughput-streaming-with-pooling)
- **Configuration**: [docs/ENHANCEMENTS.md - Configuration Examples](./docs/ENHANCEMENTS.md#configuration-examples)

### Health Monitoring
- **Overview**: [ENHANCEMENT_SUMMARY.md - Health Monitoring](./ENHANCEMENT_SUMMARY.md#3-health-monitoring--automatic-failover)
- **Tutorial**: [docs/STREAMING.md - Health Monitoring](./docs/STREAMING.md#health-monitoring-streams)
- **Example**: [docs/EXAMPLES.md - Health Monitoring](./docs/EXAMPLES.md#health-monitoring-with-automatic-failover)
- **API**: [docs/ENHANCEMENTS.md - Health Monitoring Methods](./docs/ENHANCEMENTS.md#key-methods)

### Backpressure Handling
- **Overview**: [docs/STREAMING.md - Backpressure Management](./docs/STREAMING.md#backpressure-management)
- **Advanced**: [docs/STREAMING.md - Advanced Features](./docs/STREAMING.md#backpressure-management)
- **Example**: [docs/EXAMPLES.md - Backpressure Handling](./docs/EXAMPLES.md#backpressure-handling)
- **Tests**: [src/__tests__/streaming-integration.test.ts - Backpressure Tests](./src/__tests__/streaming-integration.test.ts)

### Request Deduplication
- **Overview**: [docs/STREAMING.md - Request Deduplication](./docs/STREAMING.md#request-deduplication)
- **Example**: [docs/EXAMPLES.md - Deduplication](./docs/EXAMPLES.md#request-deduplication)
- **API**: [docs/ENHANCEMENTS.md - Deduplication Methods](./docs/ENHANCEMENTS.md#deduplication)

### Stream Management
- **Tutorial**: [docs/STREAMING.md - Stream Management](./docs/STREAMING.md#stream-management)
- **Monitoring**: [docs/STREAMING.md - Monitoring Streams](./docs/STREAMING.md#monitoring-streams)
- **Example**: [docs/EXAMPLES.md - Stream Lifecycle](./docs/EXAMPLES.md#stream-lifecycle-management)
- **Closing**: [docs/STREAMING.md - Closing Streams](./docs/STREAMING.md#closing-streams)

## Configuration & Tuning

### Configuration
- **Stream Pool**: [docs/ENHANCEMENTS.md - Stream Pool Config](./docs/ENHANCEMENTS.md#configuration-examples)
- **Advanced Options**: [docs/STREAMING.md - Advanced Stream Configuration](./docs/STREAMING.md#configuring-advanced-options)
- **Custom Pool**: [docs/STREAMING.md - Custom Stream Pool Configuration](./docs/STREAMING.md#custom-stream-pool-configuration)

### Performance Tuning
- **High Throughput**: [docs/STREAMING.md - Optimizing for Throughput](./docs/STREAMING.md#optimizing-for-throughput)
- **Low Latency**: [docs/STREAMING.md - Optimizing for Latency](./docs/STREAMING.md#optimizing-for-latency)
- **Configuration Examples**: [docs/ENHANCEMENTS.md - Configuration Examples](./docs/ENHANCEMENTS.md#configuration-examples)

### Metrics & Monitoring
- **Performance Monitoring**: [docs/EXAMPLES.md - Performance Monitoring](./docs/EXAMPLES.md#performance-monitoring)
- **Stream Diagnostics**: [docs/STREAMING.md - Monitoring Streams](./docs/STREAMING.md#monitoring-streams)

## API Reference

### Client Methods
- **Stream Creation**: [docs/ENHANCEMENTS.md - New Client Methods](./docs/ENHANCEMENTS.md#new-client-methods)
- **All APIs**: [ENHANCEMENT_SUMMARY.md - API Reference](./ENHANCEMENT_SUMMARY.md#api-reference)

### Type Definitions
- **Types Overview**: [docs/ENHANCEMENTS.md - Type Additions](./docs/ENHANCEMENTS.md#type-additions)
- **Stream Handle**: [docs/ENHANCEMENTS.md - BidirectionalStreamHandle](./docs/ENHANCEMENTS.md#bidirectional-stream-handle)
- **Full Types**: [src/types.ts](./src/types.ts)

### Events
- **Event System**: [docs/STREAMING.md - Event Handling](./docs/STREAMING.md#event-handling)
- **Event List**: [docs/ENHANCEMENTS.md - Event System](./docs/ENHANCEMENTS.md#event-system)

## Code Examples

### By Feature
1. **[Basic Streaming](./docs/EXAMPLES.md#basic-streaming-example)** - Simple example
2. **[High Throughput](./docs/EXAMPLES.md#high-throughput-streaming-with-pooling)** - Stream pooling
3. **[Health Monitoring](./docs/EXAMPLES.md#health-monitoring-with-automatic-failover)** - Failover
4. **[Backpressure](./docs/EXAMPLES.md#backpressure-handling)** - Flow control
5. **[Deduplication](./docs/EXAMPLES.md#request-deduplication)** - Cache requests
6. **[Stream Lifecycle](./docs/EXAMPLES.md#stream-lifecycle-management)** - Stream control
7. **[Performance](./docs/EXAMPLES.md#performance-monitoring)** - Metrics collection
8. **[Error Recovery](./docs/EXAMPLES.md#error-recovery-pattern)** - Resilience
9. **[All Examples](./docs/EXAMPLES.md)** - Complete examples file

### By Use Case
- **Real-time Authorization**: Basic Streaming or High Throughput examples
- **Multi-server Setup**: Health Monitoring example
- **Rate Control**: Backpressure Handling example
- **Cache Results**: Deduplication example
- **Monitor System**: Performance Monitoring example
- **Handle Failures**: Error Recovery example

## Best Practices

### Key Principles
1. **Always check `isWritable()` before sending**
2. **Monitor backpressure events**
3. **Cleanup streams properly**
4. **Use stream pooling for high throughput**
5. **Enable deduplication for idempotent operations**
6. **Monitor health continuously**

See **[docs/STREAMING.md - Best Practices](./docs/STREAMING.md#best-practices)** for detailed guidance.

## Troubleshooting

### Issues & Solutions
- **High Latency**: [docs/STREAMING.md - Troubleshooting](./docs/STREAMING.md#troubleshooting)
- **Backpressure Events**: [docs/STREAMING.md - Troubleshooting](./docs/STREAMING.md#backpressure-events)
- **Stream Disconnections**: [docs/STREAMING.md - Troubleshooting](./docs/STREAMING.md#stream-disconnections)
- **Memory Growth**: [docs/STREAMING.md - Troubleshooting](./docs/STREAMING.md#memory-growth)

## Testing

### Test Files
- **Unit Tests**: [src/__tests__/client.test.ts](./src/__tests__/client.test.ts) - Client feature tests
- **Integration Tests**: [src/__tests__/streaming-integration.test.ts](./src/__tests__/streaming-integration.test.ts) - Streaming tests
- **Running Tests**: `npm test` in the grpc-client package

### Test Coverage
- 50+ test cases covering all features
- Streaming, pooling, health monitoring tests
- Error recovery and performance tests

## Migration Guide

### From Basic to Advanced
- **Current Setup**: Review **[docs/ENHANCEMENTS.md - Migration Guide](./docs/ENHANCEMENTS.md#migration-guide)**
- **Step-by-Step**: Follow the before/after examples
- **API Changes**: All backward compatible, no breaking changes

## Technical Details

### Architecture
- **Overview**: [ENHANCEMENT_SUMMARY.md - Implementation Overview](./ENHANCEMENT_SUMMARY.md#key-achievements)
- **Backpressure**: [docs/STREAMING.md - Backpressure Management](./docs/STREAMING.md#backpressure-handling)
- **Pooling**: [docs/ENHANCEMENTS.md - Connection Pooling](./docs/ENHANCEMENTS.md)
- **Health**: [docs/ENHANCEMENTS.md - Health Monitoring](./docs/ENHANCEMENTS.md)

### Performance
- **Characteristics**: [ENHANCEMENT_SUMMARY.md - Performance Characteristics](./ENHANCEMENT_SUMMARY.md#performance-characteristics)
- **Benchmarks**: [docs/STREAMING.md - Performance Tuning](./docs/STREAMING.md#performance-tuning)

### Backward Compatibility
- **Status**: [ENHANCEMENT_SUMMARY.md - Backward Compatibility](./ENHANCEMENT_SUMMARY.md#backward-compatibility)
- **Details**: [docs/ENHANCEMENTS.md - Backward Compatibility](./docs/ENHANCEMENTS.md#backward-compatibility)

## File Structure

```
packages/grpc-client/
├── src/
│   ├── client.ts                              # Enhanced with stream methods
│   ├── types.ts                               # New type definitions
│   ├── streaming.ts                           # Streaming implementation
│   ├── connection-pool.ts                     # Connection pool
│   ├── health-monitor.ts                      # Health monitoring
│   └── __tests__/
│       ├── client.test.ts                     # Enhanced tests
│       └── streaming-integration.test.ts      # New integration tests
├── docs/
│   ├── STREAMING.md                           # Complete streaming guide
│   ├── ENHANCEMENTS.md                        # Technical documentation
│   └── EXAMPLES.md                            # Code examples
├── ENHANCEMENT_SUMMARY.md                     # This summary
└── STREAMING_GUIDE_INDEX.md                   # This index
```

## FAQ

### Common Questions
See **[docs/STREAMING.md - Troubleshooting](./docs/STREAMING.md#troubleshooting)** for common issues and solutions.

### Performance Questions
- Throughput: [ENHANCEMENT_SUMMARY.md - Performance](./ENHANCEMENT_SUMMARY.md#performance-characteristics)
- Latency: [docs/STREAMING.md - Performance Tuning](./docs/STREAMING.md#performance-tuning)

### Configuration Questions
- Options: [docs/ENHANCEMENTS.md - Configuration](./docs/ENHANCEMENTS.md#configuration-examples)
- Tuning: [docs/STREAMING.md - Configuration](./docs/STREAMING.md#advanced-stream-configuration)

## Quick Reference Card

### Create Stream
```typescript
const handle = client.createBidirectionalStream({ onResponse, onError, onEnd });
```

### Create Pool
```typescript
const handles = client.createStreamPool(4, { onResponse, onError, onEnd });
```

### Send Request
```typescript
if (handle.isWritable()) {
  handle.send(request);
}
```

### Monitor Health
```typescript
const health = await client.checkHealth();
```

### Get Metrics
```typescript
const metrics = client.getStreamMonitoringMetrics();
```

### Enable Deduplication
```typescript
client.enableDeduplication(500);
```

## Support & Questions

1. **Check Documentation**: Start with the relevant guide above
2. **Review Examples**: Find similar code in [docs/EXAMPLES.md](./docs/EXAMPLES.md)
3. **Check Tests**: See [src/__tests__/](./src/__tests__/) for test patterns
4. **Review API**: Check [ENHANCEMENT_SUMMARY.md - API Reference](./ENHANCEMENT_SUMMARY.md#api-reference)

## Further Reading

- **Complete Streaming Guide**: [docs/STREAMING.md](./docs/STREAMING.md)
- **Technical Documentation**: [docs/ENHANCEMENTS.md](./docs/ENHANCEMENTS.md)
- **Code Examples**: [docs/EXAMPLES.md](./docs/EXAMPLES.md)
- **Summary**: [ENHANCEMENT_SUMMARY.md](./ENHANCEMENT_SUMMARY.md)
- **Source Code**: Check implementation in [src/](./src/) directory

---

Last Updated: 2024
For latest information, refer to the main documentation files.
