# AuthZ Engine - Metrics Example

Complete HTTP server example with Prometheus metrics and Grafana dashboards for monitoring the AuthZ Engine.

## Overview

This example demonstrates:

- **HTTP Server** with `/metrics`, `/health`, and `/v1/check` endpoints
- **Prometheus** metrics collection and scraping
- **Grafana** dashboards for visualization
- **Docker Compose** orchestration for the complete stack
- **Production-ready** configuration with graceful shutdown

## Architecture

```
┌─────────────────┐
│  AuthZ Server   │
│   (port 8080)   │
│                 │
│  /metrics ──────┼───> Prometheus (9090)
│  /health        │           │
│  /v1/check      │           │
└─────────────────┘           ▼
                         Grafana (3000)
                         (Dashboards)
```

## Quick Start

### 1. Start the Stack

```bash
cd go-core/examples/metrics
docker-compose up -d
```

This will start:
- **AuthZ Server** on http://localhost:8080
- **Prometheus** on http://localhost:9090
- **Grafana** on http://localhost:3000

### 2. Wait for Services to Start

```bash
# Check service health
docker-compose ps

# Follow logs
docker-compose logs -f
```

Wait for "✓ Authorization engine initialized" in the logs.

### 3. Access Services

| Service | URL | Credentials |
|---------|-----|-------------|
| AuthZ Server | http://localhost:8080 | N/A |
| Prometheus | http://localhost:9090 | N/A |
| Grafana | http://localhost:3000 | admin/admin |

## Using the API

### Health Check

```bash
curl http://localhost:8080/health
# Expected: OK
```

### Authorization Check

```bash
curl -X POST http://localhost:8080/v1/check \
  -H "Content-Type: application/json" \
  -d '{
    "principal": {
      "id": "user:alice",
      "roles": ["viewer"]
    },
    "resource": {
      "kind": "document",
      "id": "doc-123"
    },
    "actions": ["read"]
  }'
```

**Expected Response:**
```json
{
  "results": {
    "read": {
      "effect": "EFFECT_ALLOW",
      "policy": "document-viewer-policy",
      "rule": "allow-read",
      "matched": true
    }
  },
  "metadata": {
    "evaluationDurationUs": 1234.56,
    "policiesEvaluated": 1,
    "cacheHit": false
  }
}
```

### View Metrics

```bash
curl http://localhost:8080/metrics
```

## Sample Policies

The server includes three example policies:

### 1. Document Viewer Policy
- **Roles**: viewer, editor, admin
- **Actions**: read
- **Effect**: ALLOW

### 2. Document Editor Policy
- **Roles**: editor, admin
- **Actions**: write, update
- **Effect**: ALLOW

### 3. Document Admin Policy
- **Roles**: admin
- **Actions**: * (all)
- **Effect**: ALLOW

## Testing Different Scenarios

### Test 1: Viewer Reading (ALLOW)

```bash
curl -X POST http://localhost:8080/v1/check \
  -H "Content-Type: application/json" \
  -d '{
    "principal": {"id": "user:bob", "roles": ["viewer"]},
    "resource": {"kind": "document", "id": "doc-456"},
    "actions": ["read"]
  }'
```

### Test 2: Viewer Writing (DENY)

```bash
curl -X POST http://localhost:8080/v1/check \
  -H "Content-Type: application/json" \
  -d '{
    "principal": {"id": "user:bob", "roles": ["viewer"]},
    "resource": {"kind": "document", "id": "doc-456"},
    "actions": ["write"]
  }'
```

### Test 3: Editor Writing (ALLOW)

```bash
curl -X POST http://localhost:8080/v1/check \
  -H "Content-Type: application/json" \
  -d '{
    "principal": {"id": "user:carol", "roles": ["editor"]},
    "resource": {"kind": "document", "id": "doc-789"},
    "actions": ["write"]
  }'
```

### Test 4: Admin Delete (ALLOW)

```bash
curl -X POST http://localhost:8080/v1/check \
  -H "Content-Type: application/json" \
  -d '{
    "principal": {"id": "user:admin", "roles": ["admin"]},
    "resource": {"kind": "document", "id": "doc-999"},
    "actions": ["delete"]
  }'
```

## Generate Load for Testing

```bash
# Install Apache Bench (if not installed)
# macOS: brew install httpd
# Ubuntu: sudo apt-get install apache2-utils

# Generate 1000 requests with 10 concurrent connections
ab -n 1000 -c 10 -p request.json -T application/json http://localhost:8080/v1/check
```

**request.json:**
```json
{
  "principal": {"id": "user:test", "roles": ["viewer"]},
  "resource": {"kind": "document", "id": "doc-test"},
  "actions": ["read"]
}
```

## Grafana Dashboards

### Accessing Dashboards

1. Open http://localhost:3000
2. Login with `admin`/`admin`
3. Navigate to **Dashboards** → **Browse** → **AuthZ Engine**

### Available Dashboards

The following dashboards are auto-loaded (from `go-core/deploy/grafana/dashboards/`):

1. **AuthZ Overview** - Authorization performance, latency, cache hit rate
2. **Embedding Pipeline** - Embedding job metrics, queue depth, worker utilization
3. **Vector Store** - Vector operations, search latency, index size

**Note**: Dashboards must exist in `go-core/deploy/grafana/dashboards/` to be loaded.

## Prometheus Queries

Access Prometheus at http://localhost:9090 and try these queries:

### Authorization Metrics

```promql
# Total checks per second
rate(authz_checks_total[1m])

# Authorization latency p99 (microseconds)
histogram_quantile(0.99, rate(authz_check_duration_microseconds_bucket[1m]))

# Cache hit rate
rate(authz_cache_hits_total[5m]) /
  (rate(authz_cache_hits_total[5m]) + rate(authz_cache_misses_total[5m]))

# Error rate
rate(authz_errors_total[1m])

# Active requests
authz_active_requests
```

### Embedding Metrics

```promql
# Job success rate
rate(authz_embedding_jobs_total{status="success"}[5m]) /
  rate(authz_embedding_jobs_total[5m])

# Queue depth
authz_embedding_queue_depth

# Job latency p99 (milliseconds)
histogram_quantile(0.99, rate(authz_embedding_job_duration_milliseconds_bucket[5m]))
```

### Vector Store Metrics

```promql
# Vector operations per second
rate(authz_vector_operations_total[1m])

# Search latency p99 (milliseconds)
histogram_quantile(0.99, rate(authz_vector_search_duration_milliseconds_bucket[1m]))

# Vector store size
authz_vector_store_size
```

## Environment Variables

Configure the AuthZ server with environment variables:

```yaml
# docker-compose.yml
environment:
  - PORT=8080           # HTTP server port (default: 8080)
  - CACHE_SIZE=100000   # Cache size (default: 100000)
  - WORKERS=16          # Parallel workers (default: 16)
```

## Stopping the Stack

```bash
# Stop services
docker-compose down

# Stop and remove volumes (clears Prometheus/Grafana data)
docker-compose down -v
```

## Troubleshooting

### Service Won't Start

```bash
# Check logs
docker-compose logs authz-server
docker-compose logs prometheus
docker-compose logs grafana

# Restart a specific service
docker-compose restart authz-server
```

### Metrics Not Appearing in Prometheus

1. Check Prometheus targets: http://localhost:9090/targets
2. Verify `authz-engine` target is **UP**
3. Check scrape errors in target details

### Dashboards Not Loading in Grafana

1. Verify dashboard files exist in `go-core/deploy/grafana/dashboards/`
2. Check Grafana provisioning logs:
   ```bash
   docker-compose logs grafana | grep provisioning
   ```
3. Manually import dashboards:
   - Go to **Dashboards** → **Import**
   - Upload JSON file from `go-core/deploy/grafana/dashboards/`

### Connection Refused Errors

```bash
# Verify services are running
docker-compose ps

# Check network connectivity
docker-compose exec authz-server ping prometheus
docker-compose exec grafana ping prometheus
```

### High Memory Usage

If Prometheus memory usage is high:

1. Reduce retention time in `docker-compose.yml`:
   ```yaml
   command:
     - '--storage.tsdb.retention.time=7d'  # Default is 30d
   ```

2. Increase scrape interval in `prometheus.yml`:
   ```yaml
   scrape_interval: 30s  # Default is 15s
   ```

## Production Deployment

For production use:

### 1. Security

- **Disable anonymous Grafana access**:
  ```yaml
  environment:
    - GF_AUTH_ANONYMOUS_ENABLED=false
  ```

- **Use strong passwords**:
  ```yaml
  environment:
    - GF_SECURITY_ADMIN_PASSWORD=<strong-password>
  ```

- **Enable TLS** for all HTTP endpoints

### 2. Persistence

The Docker Compose setup includes persistent volumes:
- `prometheus-data` - Prometheus metrics storage
- `grafana-data` - Grafana dashboards and settings

Data persists across container restarts.

### 3. Alerting

Enable Alertmanager for production alerts:

1. Add Alertmanager to `docker-compose.yml`
2. Configure alert rules in `prometheus.yml`
3. Use alerting rules from `go-core/deploy/prometheus/alerts/authz-alerts.yml`

### 4. Scaling

For high-load scenarios:

- **Increase workers**: `WORKERS=32`
- **Increase cache size**: `CACHE_SIZE=1000000`
- **Run multiple instances** with load balancer
- **Use external Prometheus** for centralized metrics

## File Structure

```
go-core/examples/metrics/
├── main.go                          # HTTP server implementation
├── Dockerfile                       # Multi-stage Docker build
├── docker-compose.yml               # Orchestration configuration
├── prometheus.yml                   # Prometheus scrape config
├── grafana/
│   ├── datasources/
│   │   └── prometheus.yml           # Datasource provisioning
│   └── dashboards/
│       └── dashboards.yml           # Dashboard provisioning
└── README.md                        # This file

go-core/deploy/
├── prometheus/
│   └── alerts/
│       └── authz-alerts.yml         # Alert rules (Phase 4.5.3)
└── grafana/
    └── dashboards/
        ├── authz-overview.json      # Overview dashboard (Phase 4.5.2)
        ├── embedding-pipeline.json  # Embedding dashboard
        └── vector-store.json        # Vector store dashboard
```

## Next Steps

1. **Implement Grafana Dashboards** (Phase 4.5.2)
   - Create `authz-overview.json`
   - Create `embedding-pipeline.json`
   - Create `vector-store.json`

2. **Add Prometheus Alerts** (Phase 4.5.3)
   - Create `authz-alerts.yml` with SLO violations
   - Test alert conditions

3. **Run E2E Tests** (Phase 4.5.1)
   - Test metrics accuracy under load
   - Validate cache hit rates
   - Check error handling

## References

- [Phase 4.5 Specification](../../docs/PHASE4.5_SPECIFICATION.md)
- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
