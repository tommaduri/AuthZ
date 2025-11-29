# AuthZ Engine Kubernetes Deployment - Quick Reference

## File Structure Overview

```
deploy/kubernetes/
├── Core Manifests (base configuration)
│   ├── namespace.yaml              - AuthZ namespace with resource quotas & network policies
│   ├── deployment.yaml             - Go server deployment (3 replicas, 250m CPU/256Mi memory)
│   ├── service.yaml                - gRPC (50051), HTTP (8080), and headless services
│   ├── configmap.yaml              - Server config, policies, and secrets
│   ├── hpa.yaml                    - Auto-scaling (3-10 replicas, 70% CPU threshold)
│   ├── pdb.yaml                    - Pod disruption budget (min 2 available)
│   └── ingress.yaml                - TLS ingress with rate limiting (1000 RPS)
│
├── Kustomization Files
│   ├── kustomization.yaml          - Root kustomization
│   └── base/                       - Base directory
│       └── kustomization.yaml      - Base configuration
│
├── Environment Overlays
│   └── overlays/
│       ├── dev/                    - 1 replica, debug logging
│       │   └── kustomization.yaml
│       ├── staging/                - 2 replicas, info logging
│       │   └── kustomization.yaml
│       └── prod/                   - 3+ replicas, warn logging
│           └── kustomization.yaml
│
├── Configuration Files
│   └── config/
│       ├── server.yaml             - Server configuration (ports, timeouts, caching)
│       └── policies.yaml           - Policy configuration (loading, validation, caching)
│
└── Documentation
    ├── DEPLOYMENT_GUIDE.md         - Complete deployment guide
    ├── DEPLOYMENT_CHECKLIST.md     - Pre/post deployment checklist
    └── QUICK_REFERENCE.md          - This file
```

## Key Features by File

### namespace.yaml
- **Namespace**: `authz-system`
- **Resource Quota**: 100 CPU, 200Gi memory
- **Network Policies**: Restricts ingress/egress to required services
- **Pod Security Policy**: Non-root execution, no privilege escalation
- **Limit Ranges**: Per-pod and per-container limits

### deployment.yaml
- **Replicas**: 3 (configurable via overlay)
- **Strategy**: RollingUpdate (maxSurge: 1, maxUnavailable: 1)
- **Resource Requests**:
  - CPU: 250m
  - Memory: 256Mi
- **Resource Limits**:
  - CPU: 1000m
  - Memory: 1Gi
- **Health Checks**:
  - Liveness: `/health` (15s initial, 10s period)
  - Readiness: `/ready` (10s initial, 5s period)
  - Startup: `/health` (5s initial, 2s period)
- **Affinity**:
  - Pod anti-affinity (spread across nodes/zones)
  - Node affinity (Linux worker nodes)
  - Topology spread constraints
- **Ports**: gRPC 50051, HTTP 8080
- **Volumes**: Policies (RO), Config (RO), Cache (emptyDir)

### service.yaml
- **authz-grpc**: ClusterIP on port 50051 (gRPC)
- **authz-http**: ClusterIP on port 8080 (Health/Metrics)
- **authz-api**: ClusterIP on port 3592 (REST API)
- **authz-headless**: Headless service for inter-pod communication
- **Endpoints**: Defines external PostgreSQL and Redis endpoints

### configmap.yaml
- **Server Config**:
  - Log level: info (debug, info, warn, error)
  - Log format: json
  - Ports: gRPC 50051, HTTP 8080
- **Cache Config**:
  - Enabled: true
  - Size: 100,000 entries
  - TTL: 5 minutes
- **Database Config**:
  - Host: authz-postgres
  - Port: 5432
  - Database: authz_engine
- **Redis Config**:
  - Host: authz-redis
  - Port: 6379
  - Pool size: 10
- **Feature Flags**:
  - Async decisions, Policy validation, Audit logging, Metrics export
- **Secrets**: Database user/password, API keys (marked for replacement)

### hpa.yaml
- **Target**: authz-engine Deployment
- **Min Replicas**: 3
- **Max Replicas**: 10
- **Metrics**:
  - CPU: 70% threshold
  - Memory: 80% threshold
  - Custom metrics (optional)
- **Behavior**:
  - Scale Up: 100% increase per 30s
  - Scale Down: 50% decrease per 60s with 5min stabilization

### pdb.yaml
- **Min Available**: 2 pods
- **Allows**: Evictions only if at least 2 pods remain
- **Protects**: Node maintenance, cluster upgrades, scaling operations

### ingress.yaml
- **Class**: nginx
- **TLS**: Let's Encrypt (cert-manager)
- **Hostnames**:
  - authz.example.com
  - api.authz.example.com
  - grpc.authz.example.com
- **Rate Limiting**: 1000 RPS, 50 concurrent connections
- **Security Headers**: HSTS, CSP, X-Frame-Options, etc.
- **CORS**: Enabled, all origins
- **Timeouts**: 30s proxy connect/send/read
- **Buffering**: 128k buffer size, 4x256k buffers

## Deployment Commands

### Development
```bash
# Deploy to dev
kubectl apply -k overlays/dev/

# View status
kubectl get all -n authz-dev
kubectl logs -n authz-dev -l app=authz-engine -f

# Clean up
kubectl delete -k overlays/dev/
```

### Staging
```bash
# Deploy to staging
kubectl apply -k overlays/staging/

# View status
kubectl get all -n authz-staging
kubectl describe deployment authz-engine -n authz-staging

# Scale manually
kubectl scale deployment authz-engine -n authz-staging --replicas=3

# Clean up
kubectl delete -k overlays/staging/
```

### Production
```bash
# Deploy to production
kubectl apply -k overlays/prod/

# View status
kubectl get all -n authz-system
kubectl get hpa -n authz-system -w  # Watch autoscaling

# Rolling restart
kubectl rollout restart deployment/authz-engine -n authz-system

# Rollback if needed
kubectl rollout undo deployment/authz-engine -n authz-system

# Clean up (NOT recommended in production!)
# kubectl delete -k overlays/prod/
```

## Customization Examples

### Change Log Level
```bash
kubectl set env deployment/authz-engine \
  LOG_LEVEL=debug \
  -n authz-system

# Or edit ConfigMap
kubectl edit configmap authz-config -n authz-system
# Change: log-level: "debug"
# Then: kubectl rollout restart deployment/authz-engine -n authz-system
```

### Scale to Specific Replicas
```bash
# Manual scale (overrides HPA min)
kubectl scale deployment authz-engine --replicas=5 -n authz-system

# Reset to let HPA manage
# Delete manual scale and let HPA take over
```

### Update Database Credentials
```bash
kubectl create secret generic authz-secrets \
  --from-literal=postgres-user=authz \
  --from-literal=postgres-password=new_password \
  -n authz-system \
  --dry-run=client -o yaml | kubectl apply -f -

# Restart pods to use new credentials
kubectl rollout restart deployment/authz-engine -n authz-system
```

### Check Resource Usage
```bash
# Pods
kubectl top pods -n authz-system

# Nodes
kubectl top nodes

# Describe deployment for resource requests/limits
kubectl describe deployment authz-engine -n authz-system
```

## Monitoring Commands

### Health and Status
```bash
# Pod status
kubectl get pods -n authz-system

# Deployment status
kubectl get deployment authz-engine -n authz-system

# HPA status
kubectl get hpa -n authz-system

# Watch rollout
kubectl rollout status deployment/authz-engine -n authz-system
```

### Logs
```bash
# All pods
kubectl logs -n authz-system -l app=authz-engine -f

# Specific pod
kubectl logs -n authz-system authz-engine-xyz -c authz-engine

# Previous log (if crashed)
kubectl logs -n authz-system authz-engine-xyz --previous

# Last 100 lines
kubectl logs -n authz-system -l app=authz-engine --tail=100
```

### Events
```bash
# Namespace events
kubectl get events -n authz-system -w

# Pod events
kubectl describe pod authz-engine-xyz -n authz-system
```

### Metrics
```bash
# Port forward to metrics
kubectl port-forward -n authz-system svc/authz-http 8080:8080

# Curl metrics
curl http://localhost:8080/metrics

# Health check
curl http://localhost:8080/health

# Readiness check
curl http://localhost:8080/ready
```

## Troubleshooting Quick Commands

```bash
# Pod won't start
kubectl describe pod authz-engine-xyz -n authz-system
kubectl logs authz-engine-xyz -n authz-system --previous

# High memory usage
kubectl top pods -n authz-system
kubectl get configmap authz-config -n authz-system -o yaml | grep cache

# Database connection issues
kubectl exec -it authz-engine-xyz -n authz-system -- \
  psql -h authz-postgres -U authz -d authz_engine -c "SELECT 1;"

# Check endpoints
kubectl get endpoints -n authz-system
kubectl get svc -n authz-system

# View HPA decisions
kubectl describe hpa authz-engine-hpa -n authz-system
```

## Important URLs and Ports

| Service | Internal URL | External URL | Port |
|---------|--------------|--------------|------|
| gRPC | authz-grpc:50051 | grpc.authz.example.com:443 | 50051 |
| HTTP/Health | authz-http:8080 | api.authz.example.com/health | 8080 |
| REST API | authz-api:3592 | api.authz.example.com | 3592/8080 |
| Metrics | authz-http:8080/metrics | api.authz.example.com/metrics | 8080 |

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| LOG_LEVEL | info | Logging level (debug, info, warn, error) |
| CACHE_ENABLED | true | Enable decision cache |
| CACHE_SIZE | 100000 | Maximum cache entries |
| CACHE_TTL | 5m | Cache time-to-live |
| WORKERS | 16 | Number of parallel workers |
| GRPC_PORT | 50051 | gRPC server port |
| HTTP_PORT | 8080 | HTTP server port |
| POSTGRES_HOST | authz-postgres | Database host |
| POSTGRES_PORT | 5432 | Database port |
| REDIS_HOST | authz-redis | Redis host |
| REDIS_PORT | 6379 | Redis port |

## Common Issues and Solutions

### Pods CrashLoopBackOff
1. Check logs: `kubectl logs <pod> -n authz-system --previous`
2. Check events: `kubectl describe pod <pod> -n authz-system`
3. Verify ConfigMap: `kubectl get configmap authz-config -n authz-system -o yaml`
4. Verify Secrets: `kubectl get secret authz-secrets -n authz-system`

### High Memory Usage
1. Check current usage: `kubectl top pods -n authz-system`
2. Lower cache size: Edit ConfigMap, change `cache-size: "50000"`
3. Restart pods: `kubectl rollout restart deployment/authz-engine -n authz-system`

### Service Not Accessible
1. Check service: `kubectl get svc -n authz-system`
2. Check endpoints: `kubectl get endpoints -n authz-system`
3. Check network policies: `kubectl get networkpolicies -n authz-system`
4. Check ingress: `kubectl get ingress -n authz-system`

### Database Connection Failed
1. Verify endpoint: `kubectl get endpoints authz-postgres -n authz-system`
2. Test connectivity: `kubectl exec <pod> -- nc -zv authz-postgres 5432`
3. Check secrets: `kubectl get secret authz-secrets -n authz-system`
4. Verify ConfigMap: `kubectl get configmap authz-config -n authz-system`

## Next Steps

1. Review DEPLOYMENT_GUIDE.md for detailed setup instructions
2. Review DEPLOYMENT_CHECKLIST.md before production deployment
3. Customize overlays for your environment
4. Set up monitoring and alerting
5. Configure database backups
6. Plan disaster recovery procedures
7. Document team runbooks

## Support Resources

- Complete Guide: `/deploy/kubernetes/DEPLOYMENT_GUIDE.md`
- Checklist: `/deploy/kubernetes/DEPLOYMENT_CHECKLIST.md`
- Kubernetes Docs: https://kubernetes.io/docs/
- gRPC Docs: https://grpc.io/docs/
- Kustomize: https://kustomize.io/
