# Docker Quick Start Guide

Run the AuthZ Engine locally with Docker Compose in just a few minutes.

## Prerequisites

- Docker Desktop or Docker Engine (20.10+)
- Docker Compose (v2.0+)
- At least 2GB of available RAM

## Quick Start (5 minutes)

### 1. Generate JWT Keys

```bash
cd /Users/tommaduri/Documents/GitHub/authz-engine/go-core

# Create keys directory
mkdir -p keys

# Generate RSA 2048-bit key pair
openssl genrsa -out keys/private.pem 2048
openssl rsa -in keys/private.pem -pubout -out keys/public.pem

# Verify keys
ls -lh keys/
```

### 2. Start All Services

```bash
# Start PostgreSQL, Redis, and AuthZ Server
docker-compose up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f authz-server
```

### 3. Verify Services are Running

```bash
# Check health endpoint
curl http://localhost:8080/health

# Expected response:
# {"status":"healthy","timestamp":"2025-11-27T..."}

# Check PostgreSQL
docker-compose exec postgres psql -U authz_user -d authz_engine -c "SELECT version();"

# Check Redis
docker-compose exec redis redis-cli ping
# Expected: PONG
```

### 4. Run Database Migrations

```bash
# Install migrate tool (if not already installed)
make migrate-install

# Run migrations
docker-compose exec authz-server migrate -database "postgres://authz_user:authz_password@postgres:5432/authz_engine?sslmode=disable" -path /app/migrations up

# Or from host machine
DB_HOST=localhost DB_PORT=5432 DB_USER=authz_user DB_PASSWORD=authz_password DB_NAME=authz_engine make migrate-up
```

## Service Endpoints

Once running, you'll have access to:

| Service | URL | Description |
|---------|-----|-------------|
| **REST API** | http://localhost:8080 | Phase 6 REST endpoints |
| **gRPC** | localhost:50051 | gRPC authorization service |
| **Health Check** | http://localhost:8080/health | Health status |
| **PostgreSQL** | localhost:5432 | Database (authz_engine) |
| **Redis** | localhost:6379 | Cache & token revocation |

### Optional Monitoring Stack

```bash
# Start with Prometheus & Grafana
docker-compose --profile monitoring up -d

# Access monitoring
# Prometheus: http://localhost:9090
# Grafana: http://localhost:3000 (admin/admin)
```

## Usage Examples

### REST API - Authorization Check

```bash
# First, create a test JWT token (using jq for JSON parsing)
TOKEN=$(curl -X POST http://localhost:8080/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{
    "principal": {
      "id": "user:alice",
      "roles": ["viewer"]
    },
    "tenant_id": "acme-corp"
  }' | jq -r '.access_token')

# Make an authorization check
curl -X POST http://localhost:8080/v1/authorization/check \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "principal": {
      "id": "user:alice",
      "roles": ["viewer"]
    },
    "resource": {
      "kind": "document",
      "id": "doc123"
    },
    "action": "read"
  }'
```

### Create API Key

```bash
# Create an API key
curl -X POST http://localhost:8080/v1/auth/apikeys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test API Key",
    "scopes": ["read:policies", "write:policies"],
    "rate_limit_rps": 100
  }'

# Response includes the plaintext key (shown only once!)
# {
#   "id": "key_abc123...",
#   "key": "ak_live_xyz789...",  // Save this!
#   "name": "Test API Key",
#   ...
# }
```

### Using API Key Authentication

```bash
# Use API key instead of JWT
curl -X GET http://localhost:8080/v1/policies \
  -H "X-API-Key: ak_live_xyz789..."
```

### Export Policies

```bash
# Export all policies to YAML
curl -X POST http://localhost:8080/v1/policies/export \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "yaml",
    "filters": {}
  }' > policies.yaml

# Export to JSON bundle (tar.gz)
curl -X POST http://localhost:8080/v1/policies/export \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "bundle",
    "include_metadata": true
  }' > policies.tar.gz
```

### Import Policies

```bash
# Import policies from file (with validation)
curl -X POST http://localhost:8080/v1/policies/import \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "json",
    "data": "'$(cat policies.json | base64)'",
    "mode": "create_only",
    "validate": true,
    "dry_run": false
  }'
```

## gRPC API

```bash
# Install grpcurl
brew install grpcurl  # macOS
# or
go install github.com/fullstorydev/grpcurl/cmd/grpcurl@latest

# List available services
grpcurl -plaintext localhost:50051 list

# Check authorization via gRPC
grpcurl -plaintext -d '{
  "principal": {
    "id": "user:alice",
    "roles": ["viewer"]
  },
  "resource": {
    "kind": "document",
    "id": "doc123"
  },
  "action": "read"
}' localhost:50051 authz.v1.AuthzService/CheckAuthorization
```

## Database Access

### PostgreSQL Shell

```bash
# Connect to database
docker-compose exec postgres psql -U authz_user -d authz_engine

# List tables
\dt

# Query API keys
SELECT id, name, agent_id, created_at FROM api_keys LIMIT 10;

# Query audit logs
SELECT event_type, actor_id, created_at FROM auth_audit_logs ORDER BY created_at DESC LIMIT 10;

# Exit
\q
```

### Redis CLI

```bash
# Connect to Redis
docker-compose exec redis redis-cli

# Check revoked tokens
KEYS revoked:jwt:*

# Check rate limit state
KEYS rate_limit:*

# Exit
exit
```

## Viewing Logs

```bash
# Follow all logs
docker-compose logs -f

# Follow specific service
docker-compose logs -f authz-server
docker-compose logs -f postgres
docker-compose logs -f redis

# Last 100 lines
docker-compose logs --tail=100 authz-server

# Since 10 minutes ago
docker-compose logs --since 10m authz-server
```

## Stopping Services

```bash
# Stop all services (preserves data)
docker-compose stop

# Start stopped services
docker-compose start

# Stop and remove containers (preserves volumes)
docker-compose down

# Remove everything including volumes (⚠️ deletes all data)
docker-compose down -v
```

## Troubleshooting

### Service Won't Start

```bash
# Check container status
docker-compose ps

# Check logs for errors
docker-compose logs authz-server

# Restart specific service
docker-compose restart authz-server
```

### Database Connection Issues

```bash
# Verify PostgreSQL is healthy
docker-compose exec postgres pg_isready -U authz_user

# Check database exists
docker-compose exec postgres psql -U authz_user -l

# Recreate database (⚠️ deletes data)
docker-compose exec postgres psql -U postgres -c "DROP DATABASE IF EXISTS authz_engine;"
docker-compose exec postgres psql -U postgres -c "CREATE DATABASE authz_engine OWNER authz_user;"
```

### Redis Connection Issues

```bash
# Check Redis is running
docker-compose exec redis redis-cli ping

# Check memory usage
docker-compose exec redis redis-cli INFO memory

# Flush all Redis data (⚠️ clears cache)
docker-compose exec redis redis-cli FLUSHALL
```

### Port Already in Use

```bash
# Find process using port 8080
lsof -i :8080

# Kill process (replace PID)
kill -9 <PID>

# Or change port in docker-compose.yml
# ports:
#   - "8081:8080"  # Changed from 8080:8080
```

### Out of Memory

```bash
# Check Docker resource usage
docker stats

# Increase Docker Desktop memory limit:
# Docker Desktop → Settings → Resources → Memory → 4GB+
```

## Production Deployment

For production deployment, consider:

1. **Use Docker Secrets** for sensitive data:
   ```yaml
   secrets:
     db_password:
       external: true
   ```

2. **Enable TLS/SSL**:
   - PostgreSQL: `DB_SSL_MODE=require`
   - Redis: `REDIS_TLS=true`
   - AuthZ Server: Configure TLS certificates

3. **Configure Resource Limits**:
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '4'
         memory: 2G
   ```

4. **Use External Services**:
   - Managed PostgreSQL (AWS RDS, Google Cloud SQL)
   - Managed Redis (AWS ElastiCache, Redis Cloud)
   - Load balancer (nginx, HAProxy, cloud LB)

5. **Enable Monitoring**:
   ```bash
   docker-compose --profile monitoring up -d
   ```

## Environment Variables

All environment variables can be customized in `docker-compose.yml`:

### Database
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- `DB_SSL_MODE` (disable, require, verify-ca, verify-full)
- `DB_MAX_CONNECTIONS`, `DB_MAX_IDLE_CONNECTIONS`

### JWT
- `JWT_ISSUER`, `JWT_AUDIENCE`
- `JWT_ACCESS_TTL` (e.g., "15m", "1h")
- `JWT_REFRESH_TTL` (e.g., "720h", "30d")

### Redis
- `AUTHZ_REDIS_HOST`, `AUTHZ_REDIS_PORT`
- `AUTHZ_REDIS_PASSWORD`
- `AUTHZ_REDIS_DB` (0-15)

### Rate Limiting
- `RATE_LIMIT_DEFAULT_RPS` (requests per second)
- `RATE_LIMIT_BURST` (burst capacity)

### Audit Logging
- `AUDIT_BUFFER_SIZE` (events before flush)
- `AUDIT_ASYNC` (true/false)

## Next Steps

1. **OpenAPI Documentation**: http://localhost:8080/swagger-ui.html
2. **REST API Guide**: See `docs/REST_API_GUIDE.md`
3. **Policy Export/Import**: See `docs/POLICY_EXPORT_IMPORT.md`
4. **Authentication**: See `docs/PHASE6_WEEK1-2_COMPLETION_SUMMARY.md`

## Support

- Documentation: `/docs` directory
- Issues: GitHub Issues
- Health Check: http://localhost:8080/health

---

**Generated**: November 27, 2025
**Version**: Phase 6 Complete - Full Production Readiness
