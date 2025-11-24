# AuthZ Engine Operations Guide

This document describes the operational setup and monitoring for the AuthZ Engine, including health checks, metrics, and graceful shutdown.

## Architecture Overview

The AuthZ Engine runs two servers concurrently:

1. **gRPC Server** (port 50051): Handles authorization check requests
2. **HTTP Server** (port 8080): Serves health checks and Prometheus metrics

## Health Checks

The HTTP server provides three health check endpoints for Kubernetes and container orchestration:

### 1. Basic Health Check
**Endpoint:** `GET /health`

Simple liveness check that returns immediately.

**Response (200 OK):**
```json
{
  "status": "UP",
  "timestamp": "2024-11-23T12:34:56Z",
  "description": "Authorization server is running"
}
```

### 2. Readiness Probe
**Endpoint:** `GET /health/ready`

Checks if the service is ready to accept traffic. Verifies:
- Engine is initialized
- Cache (if enabled) is ready
- All dependencies are available

**Response (200 OK - Ready):**
```json
{
  "status": "UP",
  "timestamp": "2024-11-23T12:34:56Z",
  "description": "Ready to accept traffic",
  "checks": {
    "engine": "ready",
    "cache": "ready"
  }
}
```

**Response (503 Service Unavailable - Not Ready):**
```json
{
  "status": "DOWN",
  "timestamp": "2024-11-23T12:34:56Z",
  "description": "Not all dependencies are ready",
  "checks": {
    "engine": "ready",
    "cache": "not_ready"
  }
}
```

### 3. Kubernetes Liveness Probe
**Endpoint:** `GET /health/live`

Minimal check to verify the process is alive and responding.

**Response (200 OK):**
```json
{
  "status": "ALIVE",
  "timestamp": "2024-11-23T12:34:56Z",
  "description": "Process is alive and responding"
}
```

### 4. Kubernetes Startup Probe
**Endpoint:** `GET /health/startup`

Checks if the application has finished startup and is ready to handle traffic.

**Response (200 OK - Started):**
```json
{
  "status": "STARTED",
  "timestamp": "2024-11-23T12:34:56Z",
  "checks": {
    "engine": "initialized"
  }
}
```

## Kubernetes Configuration Example

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: authz-engine
spec:
  containers:
  - name: authz-engine
    image: authz-engine:latest
    ports:
    - name: grpc
      containerPort: 50051
    - name: http
      containerPort: 8080

    # Startup probe: give app 60 seconds to start
    startupProbe:
      httpGet:
        path: /health/startup
        port: 8080
      initialDelaySeconds: 0
      periodSeconds: 10
      timeoutSeconds: 3
      failureThreshold: 30

    # Liveness probe: ensure process is alive
    livenessProbe:
      httpGet:
        path: /health/live
        port: 8080
      initialDelaySeconds: 10
      periodSeconds: 15
      timeoutSeconds: 3
      failureThreshold: 3

    # Readiness probe: ensure ready for traffic
    readinessProbe:
      httpGet:
        path: /health/ready
        port: 8080
      initialDelaySeconds: 10
      periodSeconds: 5
      timeoutSeconds: 3
      failureThreshold: 1
```

## Metrics

The AuthZ Engine exposes Prometheus metrics on the HTTP server.

### Metrics Endpoint
**Endpoint:** `GET /metrics`

Returns metrics in Prometheus text format (OpenMetrics 0.0.4).

### Available Metrics

#### Counters

- **authz_requests_total** - Total number of authorization requests
- **authz_requests_success** - Total successful authorization requests
- **authz_requests_failed** - Total failed authorization requests
- **authz_cache_hits_total** - Total cache hits
- **authz_cache_misses_total** - Total cache misses

#### Gauges

- **authz_policies_loaded** - Number of policies currently loaded
- **authz_cache_hit_ratio** - Cache hit ratio (0.0 to 1.0)
- **process_uptime_seconds** - Process uptime in seconds

#### Histograms

- **authz_request_duration_seconds** - Authorization request latency histogram with buckets:
  - le="0.001" (1ms)
  - le="0.005" (5ms)
  - le="0.01" (10ms)
  - le="0.05" (50ms)
  - le="0.1" (100ms)
  - le="0.5" (500ms)
  - le="1" (1s)
  - le="5" (5s)
  - le="+Inf"

### Example Prometheus Configuration

See `prometheus.yml` for the complete configuration. Key settings:

```yaml
scrape_configs:
  - job_name: 'authz-server'
    static_configs:
      - targets: ['localhost:8080']
    metrics_path: '/metrics'
    scrape_interval: 15s
    scrape_timeout: 10s
```

### JSON Metrics Endpoint
**Endpoint:** `GET /metrics/json`

Returns metrics in JSON format for easier consumption by non-Prometheus tools.

**Response:**
```json
{
  "timestamp": "2024-11-23T12:34:56Z",
  "uptime_seconds": 3600,
  "counters": {
    "requests_total": 10000,
    "requests_success": 9950,
    "requests_failed": 50,
    "cache_hits_total": 7500,
    "cache_misses_total": 2500
  },
  "gauges": {
    "policies_loaded": 42,
    "cache_hit_ratio": 0.75
  },
  "histograms": {
    "request_duration_avg_ms": 2.5
  }
}
```

## Server Startup

### Basic Startup

```bash
./authz-server
```

Defaults:
- gRPC port: 50051
- HTTP port: 8080
- Cache: enabled
- Workers: 16
- Log level: info
- Log format: json

### Custom Configuration

```bash
./authz-server \
  --grpc-port 50051 \
  --http-port 8080 \
  --cache true \
  --cache-size 100000 \
  --cache-ttl 5m \
  --workers 16 \
  --log-level info \
  --log-format json \
  --policy-dir ./policies \
  --reflection true \
  --shutdown-timeout 30s
```

### Flags

- `--grpc-port` (default: 50051) - gRPC server port
- `--http-port` (default: 8080) - HTTP server port for health/metrics
- `--cache` (default: true) - Enable decision cache
- `--cache-size` (default: 100000) - Maximum cache entries
- `--cache-ttl` (default: 5m) - Cache TTL (time-to-live)
- `--workers` (default: 16) - Number of parallel workers
- `--log-level` (default: info) - Log level (debug, info, warn, error)
- `--log-format` (default: json) - Log format (json, console)
- `--policy-dir` - Directory to load policies from
- `--reflection` (default: true) - Enable gRPC reflection
- `--shutdown-timeout` (default: 30s) - Graceful shutdown timeout
- `--version` - Show version and exit

## Graceful Shutdown

The server handles SIGTERM and SIGINT signals gracefully:

1. Server marks itself as not ready (readiness probe fails)
2. Waits 5 seconds for in-flight requests to complete
3. Stops accepting new gRPC requests
4. Closes HTTP server

### Shutdown Sequence

```
SIGTERM received
    ↓
Set readiness to false
    ↓
Wait 5 seconds (drain in-flight requests)
    ↓
Stop gRPC server
    ↓
Stop HTTP server (with timeout)
    ↓
Exit
```

### Controlling Shutdown Timeout

Use `--shutdown-timeout` to adjust how long the server waits for graceful shutdown:

```bash
./authz-server --shutdown-timeout 60s
```

## Monitoring Best Practices

### 1. Set Up Prometheus Scraping

Update Prometheus configuration to scrape metrics every 15 seconds:

```yaml
- job_name: 'authz-server'
  static_configs:
    - targets: ['authz-engine:8080']
  metrics_path: '/metrics'
  scrape_interval: 15s
```

### 2. Configure Alerting Rules

Create alerts for:
- High request failure rate (>1%)
- High request latency (p95 > 100ms)
- Low cache hit ratio (<50%)
- All health checks failing

Example alert rule:
```yaml
groups:
  - name: authz_alerts
    rules:
      - alert: AuthzHighFailureRate
        expr: |
          (authz_requests_failed / authz_requests_total) > 0.01
        for: 5m
        annotations:
          summary: "High authorization failure rate"
```

### 3. Set Up Dashboards

Create Grafana dashboards showing:
- Request rate (requests/sec)
- Request latency (p50, p95, p99)
- Cache hit ratio
- Error rate
- Uptime

### 4. Log Aggregation

Configure log aggregation (ELK, Splunk, etc.) to collect:
- Server startup logs
- Request errors
- Graceful shutdown sequence

Example log entry:
```json
{
  "level": "info",
  "timestamp": "2024-11-23T12:34:56Z",
  "message": "Starting authorization server",
  "version": "v1.0.0",
  "grpc_port": 50051,
  "http_port": 8080
}
```

## Troubleshooting

### Health Check Endpoints Return 503

**Cause:** Server dependencies not ready

**Solution:** Check logs for initialization errors. Wait for server startup (usually <5 seconds).

### High Request Latency

**Cause:** Too many concurrent requests or small cache size

**Solution:**
- Increase `--workers` (use 1x number of CPU cores)
- Increase `--cache-size` if cache hit ratio is low
- Check policy count with `/health/ready` endpoint

### Cache Hit Ratio Too Low

**Cause:** Cache size too small or policies frequently changing

**Solution:**
- Increase `--cache-size`
- Check if policies are being reloaded frequently
- Review cache TTL with `--cache-ttl`

### Metrics Not Appearing in Prometheus

**Cause:** Prometheus not configured correctly or HTTP server not accessible

**Solution:**
- Verify Prometheus configuration targets correct host/port
- Check firewall rules allow port 8080
- Verify `/metrics` endpoint returns data: `curl http://localhost:8080/metrics`

### Server Hanging on Shutdown

**Cause:** In-flight requests taking longer than shutdown timeout

**Solution:**
- Increase `--shutdown-timeout`
- Check for slow authorization checks in logs
- Ensure policies are optimized

## Performance Tuning

### For High Throughput

```bash
./authz-server \
  --workers 32 \
  --cache-size 500000 \
  --cache-ttl 10m
```

### For Low Latency

```bash
./authz-server \
  --workers 16 \
  --cache-size 100000 \
  --cache-ttl 5m
```

### For Resource Constrained Environments

```bash
./authz-server \
  --workers 4 \
  --cache-size 10000 \
  --cache-ttl 1m
```

## Related Documentation

- [Policy Format](./POLICIES.md)
- [gRPC API Reference](./GRPC_API.md)
- [Deployment Guide](./DEPLOYMENT.md)
