# AuthZ Engine Kubernetes Deployment Guide

## Overview

This directory contains production-ready Kubernetes manifests for deploying the AuthZ Engine. The deployment includes:

- Multi-replica gRPC and HTTP servers
- Kubernetes native features (HPA, PDB, NetworkPolicies)
- High availability configuration with anti-affinity rules
- Comprehensive monitoring and observability
- Environment-specific overlays (dev, staging, prod)

## Directory Structure

```
deploy/kubernetes/
├── namespace.yaml              # Namespace, resource quotas, network policies
├── deployment.yaml             # Go server deployment with 3 replicas
├── service.yaml                # gRPC, HTTP, and headless services
├── configmap.yaml              # Server and policy configuration
├── hpa.yaml                    # Horizontal Pod Autoscaler (3-10 replicas)
├── pdb.yaml                    # Pod Disruption Budget (min 2 available)
├── ingress.yaml                # Ingress with TLS and rate limiting
├── kustomization.yaml          # Base kustomization file
├── base/                       # Base kustomization directory
│   └── kustomization.yaml
├── overlays/                   # Environment-specific overlays
│   ├── dev/
│   │   └── kustomization.yaml
│   ├── staging/
│   │   └── kustomization.yaml
│   └── prod/
│       └── kustomization.yaml
├── config/                     # Configuration files
│   ├── server.yaml
│   └── policies.yaml
└── DEPLOYMENT_GUIDE.md         # This file
```

## Prerequisites

1. **Kubernetes Cluster**: 1.21+ with:
   - Metrics Server (for HPA)
   - NGINX Ingress Controller (recommended)
   - Cert-Manager (for TLS certificates)

2. **Dependencies**:
   - PostgreSQL 12+ (for policy and decision storage)
   - Redis 6+ (for caching and event bus)

3. **Tools**:
   - kubectl 1.21+
   - kustomize 3.8+ (or built-in `kubectl apply -k`)

## Quick Start

### 1. Deploy to Development

```bash
cd /Users/tommaduri/Documents/GitHub/authz-engine/deploy/kubernetes

# Create dev namespace and resources
kubectl apply -k overlays/dev/

# Verify deployment
kubectl get pods -n authz-dev
kubectl logs -n authz-dev -l app=authz-engine -f
```

### 2. Deploy to Staging

```bash
# Create staging namespace and resources
kubectl apply -k overlays/staging/

# Verify deployment
kubectl get pods -n authz-staging
kubectl describe deployment -n authz-staging authz-engine
```

### 3. Deploy to Production

```bash
# Create production namespace and resources
kubectl apply -k overlays/prod/

# Verify deployment
kubectl get pods -n authz-system
kubectl get hpa -n authz-system
kubectl get pdb -n authz-system
```

## Configuration

### Updating Configuration

Edit the ConfigMap directly:

```bash
kubectl edit configmap authz-config -n authz-system
```

Or apply changes via kustomize:

1. Edit `config/server.yaml`
2. Update the configMapGenerator in `kustomization.yaml`
3. Apply: `kubectl apply -k`

### Secret Management

Replace database credentials:

```bash
kubectl create secret generic authz-secrets \
  --from-literal=postgres-user=authz \
  --from-literal=postgres-password=YOUR_PASSWORD \
  -n authz-system \
  --dry-run=client -o yaml | kubectl apply -f -
```

## Monitoring and Observability

### Health Checks

The deployment includes three health check endpoints:

- **Liveness**: `GET /health` - Checks if the server is running
- **Readiness**: `GET /ready` - Checks if the server is ready to serve requests
- **Startup**: `GET /health` - Checks if startup is complete

```bash
# Manual health check
kubectl exec -n authz-system deployment/authz-engine \
  -- wget --no-verbose --spider http://localhost:8080/health
```

### Metrics

Metrics are exposed on the HTTP port (8080) at `/metrics`:

```bash
# Port forward to access metrics
kubectl port-forward -n authz-system svc/authz-http 8080:8080

# In another terminal
curl http://localhost:8080/metrics
```

### Logs

View logs from all pods:

```bash
# Real-time logs
kubectl logs -n authz-system -l app=authz-engine -f

# Specific pod
kubectl logs -n authz-system authz-engine-xyz123 -c authz-engine

# Previous log (if pod crashed)
kubectl logs -n authz-system authz-engine-xyz123 --previous
```

## Scaling

### Manual Scaling

```bash
# Scale to 5 replicas
kubectl scale deployment/authz-engine -n authz-system --replicas=5

# View current replicas
kubectl get deployment/authz-engine -n authz-system
```

### Autoscaling

The HPA automatically scales based on CPU and memory:

```bash
# View HPA status
kubectl get hpa -n authz-system -w

# Describe HPA for detailed info
kubectl describe hpa authz-engine-hpa -n authz-system

# View HPA metrics
kubectl top pods -n authz-system
```

## Resource Management

### CPU and Memory Limits

The deployment defines:

```
Requests:
  CPU: 250m (0.25 cores)
  Memory: 256Mi

Limits:
  CPU: 1000m (1 core)
  Memory: 1Gi
```

Adjust in `deployment.yaml` if needed:

```yaml
resources:
  requests:
    cpu: 250m
    memory: 256Mi
  limits:
    cpu: 1000m
    memory: 1Gi
```

### Pod Disruption Budget

Ensures at least 2 pods are always available:

```bash
# View PDB status
kubectl get pdb -n authz-system
kubectl describe pdb authz-engine-pdb -n authz-system
```

## Networking

### Service Access

```bash
# Access gRPC service from within cluster
grpcurl -plaintext authz-grpc:50051 list

# Access HTTP service
curl http://authz-http:8080/health

# Access via Ingress (external)
curl https://api.authz.example.com/health
```

### Network Policies

The deployment restricts traffic:

- Only ingress-nginx controller can access port 8080/50051
- Only Prometheus can access metrics
- Only internal pods can access gRPC
- Egress: DNS, PostgreSQL, Redis, external HTTPS only

## Database Setup

### PostgreSQL

Create the database:

```sql
CREATE DATABASE authz_engine;
CREATE USER authz WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE authz_engine TO authz;

-- Create tables (run migrations)
-- psql -U authz -d authz_engine < migrations.sql
```

Update the connection string in `configmap.yaml`:

```yaml
postgres-host: "your-postgres-host"
postgres-user: "authz"
postgres-password: "secure_password"
```

### Redis

Ensure Redis is accessible:

```bash
# Test connection
redis-cli -h authz-redis -p 6379 ping

# Or use auth if password is set
redis-cli -h authz-redis -p 6379 -a password ping
```

## Troubleshooting

### Pod Not Starting

```bash
# Check pod status
kubectl describe pod -n authz-system authz-engine-xyz123

# Check logs
kubectl logs -n authz-system authz-engine-xyz123

# Check events
kubectl get events -n authz-system --sort-by='.lastTimestamp'
```

### CrashLoopBackOff

```bash
# Check previous logs
kubectl logs -n authz-system authz-engine-xyz123 --previous

# Check resource limits
kubectl describe nodes
kubectl top nodes
```

### High Memory Usage

```bash
# Check memory limits
kubectl top pods -n authz-system

# Adjust cache size in configmap
kubectl edit configmap authz-config -n authz-system
# Change cache-size: "50000" (lower value)
```

### Database Connection Issues

```bash
# Test PostgreSQL connectivity
kubectl exec -it -n authz-system authz-engine-xyz123 \
  -- psql -h authz-postgres -U authz -d authz_engine -c "SELECT 1;"

# Check connection string in configmap
kubectl get configmap authz-config -n authz-system -o yaml | grep postgres
```

## Updating the Deployment

### Rolling Update

The deployment uses a RollingUpdate strategy:

```bash
# Update image
kubectl set image deployment/authz-engine \
  authz-engine=authz-engine:v1.1.0 \
  -n authz-system

# Watch rollout
kubectl rollout status deployment/authz-engine -n authz-system

# Rollback if needed
kubectl rollout undo deployment/authz-engine -n authz-system
```

### Updating Configuration

```bash
# Edit config
kubectl edit configmap authz-config -n authz-system

# Restart pods to pick up changes
kubectl rollout restart deployment/authz-engine -n authz-system
```

## Production Checklist

- [ ] Set strong database passwords
- [ ] Configure TLS certificates (update `authz.example.com` in ingress.yaml)
- [ ] Set appropriate resource limits based on load testing
- [ ] Enable audit logging in configmap
- [ ] Configure monitoring and alerting
- [ ] Set up backup strategy for PostgreSQL
- [ ] Document runbooks for on-call team
- [ ] Test disaster recovery procedures
- [ ] Enable pod security policies
- [ ] Configure network policies for your environment
- [ ] Set resource quotas per namespace
- [ ] Enable RBAC for fine-grained access control

## Clean Up

### Remove Deployment

```bash
# Remove production deployment
kubectl delete -k overlays/prod/

# Remove specific environment
kubectl delete namespace authz-system
kubectl delete namespace authz-staging
kubectl delete namespace authz-dev
```

## Advanced Topics

### Custom Resource Limits

Edit `deployment.yaml` section:

```yaml
resources:
  requests:
    cpu: 500m
    memory: 512Mi
  limits:
    cpu: 2000m
    memory: 2Gi
```

### Node Affinity

Edit `deployment.yaml` to target specific nodes:

```yaml
nodeAffinity:
  requiredDuringSchedulingIgnoredDuringExecution:
    nodeSelectorTerms:
    - matchExpressions:
      - key: disktype
        operator: In
        values:
        - ssd
```

### Multi-Cluster Deployment

Use kustomize with different bases for each cluster:

```bash
kubectl apply -k overlays/prod-us-east/
kubectl apply -k overlays/prod-us-west/
kubectl apply -k overlays/prod-eu-west/
```

## Support and Issues

For issues or questions:

1. Check logs: `kubectl logs -n authz-system -l app=authz-engine`
2. Check events: `kubectl get events -n authz-system`
3. Verify configuration: `kubectl get configmap authz-config -n authz-system -o yaml`
4. Check dependencies (PostgreSQL, Redis)
5. Review the troubleshooting section above

## References

- [Kubernetes Documentation](https://kubernetes.io/docs)
- [Kustomize Documentation](https://kustomize.io/)
- [gRPC in Kubernetes](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
- [Kubernetes Best Practices](https://kubernetes.io/docs/concepts/configuration/overview/)
