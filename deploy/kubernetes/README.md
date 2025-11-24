# AuthZ Engine Kubernetes Deployment Manifests

Production-ready Kubernetes manifests for deploying the AuthZ Engine gRPC authorization server.

## Overview

This deployment provides:

- **High Availability**: 3 replicas with pod anti-affinity rules
- **Auto-scaling**: Horizontal Pod Autoscaler (3-10 replicas based on CPU/memory)
- **Reliability**: Pod Disruption Budget ensuring minimum 2 pods available
- **Observability**: Built-in health checks, metrics, and logging
- **Security**: Network policies, RBAC, pod security contexts
- **Networking**: gRPC (50051), REST API (8080), and headless services
- **TLS/Ingress**: HTTPS termination with rate limiting
- **Configuration**: Environment-specific overlays (dev, staging, prod)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Kubernetes Cluster                     │
├─────────────────────────────────────────────────────────┤
│                   authz-system Namespace                  │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │           NGINX Ingress Controller                │   │
│  │  Rate Limit: 1000 RPS | TLS: Let's Encrypt      │   │
│  └──────────────────────────────────────────────────┘   │
│         ↓          ↓          ↓                           │
│  ┌────────────┬────────────┬────────────┐               │
│  │   Pod 1    │   Pod 2    │   Pod 3    │               │
│  │ (gRPC +    │ (gRPC +    │ (gRPC +    │               │
│  │  HTTP)     │  HTTP)     │  HTTP)     │               │
│  └──┬───────┬──┴──┬───────┬──┴──┬───────┴──┐            │
│     │       │     │       │     │          │            │
│     └───────┼─────┴───────┴─────┤          │            │
│             │                   │          │            │
│  ┌──────────▼──────────┐  ┌─────▼────────▼──┐          │
│  │   PostgreSQL        │  │      Redis       │          │
│  │  (Policy/Decision   │  │    (Caching/     │          │
│  │   Storage)          │  │    Event Bus)    │          │
│  └─────────────────────┘  └──────────────────┘          │
│                                                           │
│  HPA: Scales 3-10 replicas based on:                    │
│   • CPU utilization > 70%                               │
│   • Memory utilization > 80%                            │
│                                                           │
│  PDB: Maintains minimum 2 available pods during:        │
│   • Node maintenance                                     │
│   • Cluster upgrades                                     │
│   • Voluntary evictions                                  │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

```bash
# Required
- Kubernetes 1.21+
- kubectl configured
- PostgreSQL 12+
- Redis 6+

# Optional but recommended
- Metrics Server (for HPA)
- NGINX Ingress Controller
- Cert-Manager (for TLS)
- Prometheus (for monitoring)
```

### Deployment

**Development:**
```bash
kubectl apply -k overlays/dev/
```

**Staging:**
```bash
kubectl apply -k overlays/staging/
```

**Production:**
```bash
kubectl apply -k overlays/prod/
```

## File Structure

```
deploy/kubernetes/
│
├── Base Manifests (all environments)
│   ├── namespace.yaml           - Namespace with quotas, limits, network policies
│   ├── deployment.yaml          - Deployment with health checks, resource limits
│   ├── service.yaml             - gRPC, HTTP, API, headless services
│   ├── configmap.yaml           - Configuration and secrets
│   ├── hpa.yaml                 - Horizontal Pod Autoscaler (3-10 replicas)
│   ├── pdb.yaml                 - Pod Disruption Budget (min 2 pods)
│   ├── ingress.yaml             - Ingress with TLS and rate limiting
│   └── kustomization.yaml       - Root kustomization
│
├── Kustomization Base
│   └── base/kustomization.yaml  - Base layer configuration
│
├── Environment Overlays
│   ├── overlays/dev/            - 1 replica, debug logging
│   ├── overlays/staging/        - 2 replicas, info logging
│   └── overlays/prod/           - 3+ replicas, warn logging
│
├── Configuration
│   ├── config/server.yaml       - Server configuration
│   ├── config/policies.yaml     - Policy configuration
│
└── Documentation
    ├── README.md                - This file
    ├── DEPLOYMENT_GUIDE.md      - Detailed setup guide
    ├── DEPLOYMENT_CHECKLIST.md  - Pre/post deployment checklist
    └── QUICK_REFERENCE.md       - Quick command reference
```

## Manifest Details

### namespace.yaml
- Namespace: `authz-system`
- Resource Quota: 100 CPU, 200Gi memory
- Network Policies: Restricts traffic to required services
- Pod Security Policy: Non-root execution, no privilege escalation

### deployment.yaml
- **Replicas**: 3 (configurable)
- **Strategy**: RollingUpdate (maxSurge: 1, maxUnavailable: 1)
- **Resources**:
  - Requests: 250m CPU, 256Mi memory
  - Limits: 1000m CPU, 1Gi memory
- **Health Checks**:
  - Liveness: `/health` endpoint
  - Readiness: `/ready` endpoint
  - Startup: `/health` with extended timeout
- **Affinity**:
  - Pod anti-affinity (spread across nodes/zones)
  - Node affinity (Linux worker nodes)
- **Ports**: gRPC 50051, HTTP 8080
- **Security**: Non-root user (1000), read-only root filesystem (configurable)

### service.yaml
- **authz-grpc**: ClusterIP service for gRPC (port 50051)
- **authz-http**: ClusterIP service for HTTP (port 8080)
- **authz-api**: ClusterIP service for REST API (port 3592)
- **authz-headless**: Headless service for DNS-based discovery

### configmap.yaml
- Server configuration (ports, timeouts, logging)
- Cache configuration (type, size, TTL)
- Database configuration (PostgreSQL connection)
- Redis configuration (connection pool)
- Feature flags (async decisions, audit logging, etc.)

### hpa.yaml
- **Min Replicas**: 3
- **Max Replicas**: 10
- **Metrics**:
  - CPU: 70% utilization threshold
  - Memory: 80% utilization threshold
- **Scaling Behavior**:
  - Scale up: 100% increase per 30 seconds
  - Scale down: 50% decrease per 60 seconds with 5-minute stabilization

### pdb.yaml
- **Min Available**: 2 pods
- **Protects**: Against voluntary disruptions (maintenance, upgrades)
- **NOT Protected**: Against pod deletion or node failure

### ingress.yaml
- **TLS**: Automatic certificate generation (Let's Encrypt via cert-manager)
- **Hostnames**: authz.example.com, api.authz.example.com, grpc.authz.example.com
- **Rate Limiting**: 1000 RPS, 50 concurrent connections per IP
- **Security Headers**: HSTS, CSP, X-Frame-Options, X-XSS-Protection
- **CORS**: Enabled with configurable origins
- **Timeouts**: 30s proxy connect/send/read

## Environment Overlays

### Development (overlays/dev/)
```yaml
replicas: 1
log-level: debug
log-format: console
cache-enabled: false
workers: 4
hpa: disabled (fixed 1 replica)
```

### Staging (overlays/staging/)
```yaml
replicas: 2
log-level: info
log-format: json
cache-enabled: true
cache-size: 50000
workers: 8
hpa: min 2, max 5 replicas
```

### Production (overlays/prod/)
```yaml
replicas: 3
log-level: warn
log-format: json
cache-enabled: true
cache-size: 100000
workers: 16
hpa: min 3, max 10 replicas
ingress: enabled with TLS
```

## Deployment Guide

### Step 1: Prerequisites
- Install kubectl and configure cluster access
- Ensure PostgreSQL and Redis are accessible
- Update database credentials in secrets
- Update domain names in ingress.yaml

### Step 2: Development Deployment
```bash
# Apply development configuration
kubectl apply -k overlays/dev/

# Verify deployment
kubectl get pods -n authz-dev -w
kubectl logs -n authz-dev -l app=authz-engine -f

# Test connectivity
kubectl port-forward -n authz-dev svc/authz-http 8080:8080
curl http://localhost:8080/health
```

### Step 3: Staging Deployment
```bash
# Apply staging configuration
kubectl apply -k overlays/staging/

# Verify all resources
kubectl get all -n authz-staging
kubectl describe deployment authz-engine -n authz-staging

# Load test
kubectl exec -n authz-staging authz-engine-xxx -- \
  grpcurl -plaintext localhost:50051 list
```

### Step 4: Production Deployment
```bash
# Apply production configuration
kubectl apply -k overlays/prod/

# Monitor rollout
kubectl rollout status deployment/authz-engine -n authz-system

# Verify HPA
kubectl get hpa -n authz-system -w

# Verify PDB
kubectl get pdb -n authz-system
```

## Common Operations

### View Status
```bash
# All resources
kubectl get all -n authz-system

# Specific deployment
kubectl describe deployment authz-engine -n authz-system

# Pod logs
kubectl logs -n authz-system -l app=authz-engine -f
```

### Scale Deployment
```bash
# Manual scale
kubectl scale deployment authz-engine -n authz-system --replicas=5

# View HPA status
kubectl get hpa -n authz-system -w
```

### Update Configuration
```bash
# Edit ConfigMap
kubectl edit configmap authz-config -n authz-system

# Restart pods to apply changes
kubectl rollout restart deployment/authz-engine -n authz-system
```

### View Metrics
```bash
# Port forward
kubectl port-forward -n authz-system svc/authz-http 8080:8080

# Curl metrics
curl http://localhost:8080/metrics
```

### Rollback Deployment
```bash
# View rollout history
kubectl rollout history deployment/authz-engine -n authz-system

# Rollback to previous version
kubectl rollout undo deployment/authz-engine -n authz-system
```

## Health Checks

The deployment includes three health check endpoints on the HTTP server (port 8080):

### Liveness Probe
- **Endpoint**: `GET /health`
- **Purpose**: Indicates if the server is running
- **Initial Delay**: 15 seconds
- **Interval**: 10 seconds
- **Failure Threshold**: 3

### Readiness Probe
- **Endpoint**: `GET /ready`
- **Purpose**: Indicates if the server is ready to serve requests
- **Initial Delay**: 10 seconds
- **Interval**: 5 seconds
- **Failure Threshold**: 2

### Startup Probe
- **Endpoint**: `GET /health`
- **Purpose**: Indicates if startup is complete
- **Initial Delay**: 5 seconds
- **Interval**: 2 seconds
- **Failure Threshold**: 30

## Monitoring

### Metrics Endpoint
- **URL**: `http://authz-http:8080/metrics`
- **Format**: Prometheus metrics
- **Interval**: 15 seconds
- **Metrics Exported**:
  - gRPC server metrics (requests, latency, errors)
  - HTTP server metrics
  - Cache hit/miss rates
  - Database connection pool stats
  - Go runtime metrics

### Logging
- **Format**: JSON (production) or console (development)
- **Output**: stdout/stderr
- **Level**: Configurable (debug, info, warn, error)
- **Rotation**: Managed by container runtime

## Troubleshooting

### Pod Not Starting
```bash
# Check pod status
kubectl describe pod <pod-name> -n authz-system

# Check logs
kubectl logs <pod-name> -n authz-system

# Check previous logs if crashed
kubectl logs <pod-name> -n authz-system --previous
```

### High Resource Usage
```bash
# Check resource usage
kubectl top pods -n authz-system

# Check HPA status
kubectl describe hpa authz-engine-hpa -n authz-system

# Lower cache size if memory is high
kubectl edit configmap authz-config -n authz-system
```

### Database Connection Issues
```bash
# Test PostgreSQL connectivity
kubectl exec -it <pod-name> -n authz-system -- \
  psql -h authz-postgres -U authz -d authz_engine -c "SELECT 1;"

# Check connection string
kubectl get configmap authz-config -n authz-system -o yaml | grep postgres
```

## Security Considerations

1. **Network Policies**: Restrict traffic to required services only
2. **RBAC**: Service accounts with minimal required permissions
3. **Pod Security**: Non-root user, no privilege escalation
4. **Secrets**: Database credentials stored in Kubernetes Secrets
5. **TLS**: HTTPS termination at ingress layer
6. **Rate Limiting**: 1000 RPS per IP address
7. **Resource Quotas**: Namespace-level quotas prevent resource exhaustion

## Performance Tuning

### Cache Configuration
- Increase `cache-size` for higher hit rates
- Adjust `cache-ttl` based on policy update frequency
- Monitor cache metrics for optimization

### Worker Threads
- Increase `workers` for high concurrency workloads
- Default: 16 workers (suitable for most workloads)
- Monitor CPU usage and adjust accordingly

### Resource Limits
- Request: 250m CPU, 256Mi memory
- Limits: 1000m CPU, 1Gi memory
- Adjust based on load testing results

### Replica Count
- HPA automatically scales based on CPU/memory
- Manual scaling overrides automatic scaling
- Consider PDB constraints when scaling

## Production Checklist

- [ ] Update database credentials in secrets
- [ ] Configure TLS domain names in ingress.yaml
- [ ] Review and adjust resource limits
- [ ] Enable monitoring and alerting
- [ ] Configure PostgreSQL backups
- [ ] Test disaster recovery procedures
- [ ] Document runbooks for on-call team
- [ ] Enable audit logging
- [ ] Configure network policies for your environment
- [ ] Review RBAC policies

## Documentation

- **DEPLOYMENT_GUIDE.md**: Comprehensive deployment guide with detailed instructions
- **DEPLOYMENT_CHECKLIST.md**: Pre-deployment and post-deployment checklists
- **QUICK_REFERENCE.md**: Quick command reference for common operations

## Support

For issues or questions, refer to:

1. **DEPLOYMENT_GUIDE.md** for detailed setup instructions
2. **DEPLOYMENT_CHECKLIST.md** for validation steps
3. **QUICK_REFERENCE.md** for common commands
4. Check pod logs: `kubectl logs -n authz-system -l app=authz-engine`
5. Check events: `kubectl get events -n authz-system`

## License

These Kubernetes manifests are provided as part of the AuthZ Engine project.
