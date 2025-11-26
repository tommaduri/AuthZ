# AuthZ Engine Helm Chart

Production-ready Helm chart for deploying AuthZ Engine authorization service to Kubernetes.

## Features

- ✅ High availability with pod anti-affinity
- ✅ Horizontal Pod Autoscaling (HPA)
- ✅ Pod Disruption Budget (PDB)
- ✅ Security hardening (non-root, read-only filesystem, dropped capabilities)
- ✅ JWT authentication support (HS256/RS256)
- ✅ Redis integration for distributed caching
- ✅ Prometheus metrics and ServiceMonitor
- ✅ Configurable health probes
- ✅ Persistent volume support for policies
- ✅ Ingress with TLS support

## Prerequisites

- Kubernetes 1.20+
- Helm 3.0+
- PV provisioner support in the underlying infrastructure (if persistence is enabled)
- Prometheus Operator (if ServiceMonitor is enabled)

## Installing the Chart

### Quick Start

```bash
# Create namespace
kubectl create namespace authz

# Install with default values
helm install authz-engine ./deploy/kubernetes/helm/authz-engine \
  --namespace authz \
  --create-namespace

# Verify installation
kubectl get pods -n authz
kubectl get svc -n authz
```

### Production Installation

```bash
# Install with production values
helm install authz-engine ./deploy/kubernetes/helm/authz-engine \
  --namespace authz \
  --values ./deploy/kubernetes/helm/authz-engine/values-production.yaml \
  --set secrets.jwtSecret="$(openssl rand -base64 32)"

# Verify deployment
kubectl rollout status deployment/authz-engine -n authz
```

### Custom Values

```bash
# Install with custom values
helm install authz-engine ./deploy/kubernetes/helm/authz-engine \
  --namespace authz \
  --set replicaCount=5 \
  --set resources.limits.cpu=4000m \
  --set resources.limits.memory=4Gi
```

## Configuration

### Core Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `replicaCount` | Number of replicas | `3` |
| `image.repository` | Image repository | `authz-engine/go-core` |
| `image.tag` | Image tag (defaults to chart appVersion) | `""` |
| `image.pullPolicy` | Image pull policy | `IfNotPresent` |

### Service Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `service.type` | Service type | `ClusterIP` |
| `service.ports.grpc` | gRPC port | `8080` |
| `service.ports.http` | HTTP port | `8081` |
| `service.ports.metrics` | Metrics port | `9090` |

### Resource Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `resources.limits.cpu` | CPU limit | `2000m` |
| `resources.limits.memory` | Memory limit | `2Gi` |
| `resources.requests.cpu` | CPU request | `1000m` |
| `resources.requests.memory` | Memory request | `1Gi` |

### Autoscaling Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `autoscaling.enabled` | Enable HPA | `true` |
| `autoscaling.minReplicas` | Minimum replicas | `2` |
| `autoscaling.maxReplicas` | Maximum replicas | `10` |
| `autoscaling.targetCPUUtilizationPercentage` | Target CPU % | `70` |
| `autoscaling.targetMemoryUtilizationPercentage` | Target Memory % | `80` |

### Security Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `podSecurityContext.runAsNonRoot` | Run as non-root | `true` |
| `podSecurityContext.runAsUser` | User ID | `1000` |
| `securityContext.readOnlyRootFilesystem` | Read-only root FS | `true` |
| `securityContext.allowPrivilegeEscalation` | Allow privilege escalation | `false` |

### JWT Authentication

| Parameter | Description | Default |
|-----------|-------------|---------|
| `config.jwt.enabled` | Enable JWT auth | `true` |
| `config.jwt.issuer` | JWT issuer | `authz-engine` |
| `config.jwt.audience` | JWT audience | `authz-api` |
| `secrets.jwtSecret` | JWT secret (HS256) | `""` (auto-generated) |
| `secrets.jwtPublicKey` | JWT public key (RS256) | `""` |

### Redis Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `config.redis.enabled` | Enable Redis | `false` |
| `config.redis.addr` | Redis address | `redis:6379` |
| `config.redis.db` | Redis database | `0` |
| `secrets.redisPassword` | Redis password | `""` |

### Persistence

| Parameter | Description | Default |
|-----------|-------------|---------|
| `persistence.enabled` | Enable persistence | `true` |
| `persistence.storageClass` | Storage class | `""` |
| `persistence.accessMode` | Access mode | `ReadWriteOnce` |
| `persistence.size` | Volume size | `10Gi` |

### Monitoring

| Parameter | Description | Default |
|-----------|-------------|---------|
| `serviceMonitor.enabled` | Enable ServiceMonitor | `false` |
| `serviceMonitor.interval` | Scrape interval | `30s` |
| `serviceMonitor.scrapeTimeout` | Scrape timeout | `10s` |

## Upgrading

```bash
# Upgrade to new version
helm upgrade authz-engine ./deploy/kubernetes/helm/authz-engine \
  --namespace authz \
  --reuse-values \
  --set image.tag=v1.1.0

# Check rollout status
kubectl rollout status deployment/authz-engine -n authz
```

## Rolling Back

```bash
# List releases
helm history authz-engine -n authz

# Rollback to previous version
helm rollback authz-engine -n authz

# Rollback to specific revision
helm rollback authz-engine 3 -n authz
```

## Uninstalling

```bash
# Uninstall the chart
helm uninstall authz-engine --namespace authz

# Delete namespace (optional)
kubectl delete namespace authz
```

## Testing

### Helm Lint

```bash
helm lint ./deploy/kubernetes/helm/authz-engine
```

### Helm Template

```bash
# Render templates locally
helm template authz-engine ./deploy/kubernetes/helm/authz-engine \
  --namespace authz \
  --debug

# Output to file
helm template authz-engine ./deploy/kubernetes/helm/authz-engine \
  --namespace authz \
  > rendered-manifests.yaml
```

### Helm Test

```bash
# Run built-in tests
helm test authz-engine --namespace authz
```

### Integration Tests

```bash
# Test health endpoint
kubectl run curl-test --rm -it --restart=Never --image=curlimages/curl -- \
  curl http://authz-engine.authz.svc.cluster.local:8081/health

# Test authorization API (requires JWT token)
kubectl run grpcurl-test --rm -it --restart=Never --image=fullstorydev/grpcurl -- \
  -d '{"principal": "user:alice", "resource": "document:123", "action": "read"}' \
  -H "Authorization: Bearer $JWT_TOKEN" \
  authz-engine.authz.svc.cluster.local:8080 \
  authz.v1.AuthzService/Check
```

## Monitoring

### View Metrics

```bash
# Port forward to metrics endpoint
kubectl port-forward -n authz svc/authz-engine 9090:9090

# Access metrics at http://localhost:9090/metrics
```

### View Logs

```bash
# Follow logs
kubectl logs -n authz -l app.kubernetes.io/name=authz-engine -f

# View logs from specific pod
kubectl logs -n authz authz-engine-xxxxx-yyyyy
```

### Check Autoscaling

```bash
# Watch HPA
kubectl get hpa -n authz authz-engine -w

# Describe HPA
kubectl describe hpa -n authz authz-engine
```

## Troubleshooting

### Pods Not Starting

```bash
# Check pod status
kubectl get pods -n authz

# Describe pod
kubectl describe pod -n authz authz-engine-xxxxx-yyyyy

# Check events
kubectl get events -n authz --sort-by='.lastTimestamp'
```

### Health Checks Failing

```bash
# Check health endpoints
kubectl exec -n authz authz-engine-xxxxx-yyyyy -- wget -O- http://localhost:8081/health/live
kubectl exec -n authz authz-engine-xxxxx-yyyyy -- wget -O- http://localhost:8081/health/ready
```

### JWT Authentication Issues

```bash
# Check secrets
kubectl get secret -n authz authz-engine-secret -o yaml

# Verify JWT configuration
kubectl get configmap -n authz authz-engine -o yaml
```

## Production Best Practices

1. **High Availability**
   - Set `replicaCount >= 3`
   - Enable `podDisruptionBudget`
   - Use hard anti-affinity in production

2. **Resource Management**
   - Set `resources.requests = resources.limits` for guaranteed QoS
   - Enable HPA with appropriate thresholds
   - Monitor resource usage and adjust

3. **Security**
   - Set strong JWT secrets via `--set secrets.jwtSecret`
   - Never commit secrets to Git
   - Use external secret management (e.g., Sealed Secrets, Vault)
   - Enable Pod Security Standards

4. **Persistence**
   - Use fast storage class for policy storage
   - Configure appropriate volume size
   - Set up backup/restore procedures

5. **Monitoring**
   - Enable ServiceMonitor for Prometheus
   - Set up alerts for critical metrics
   - Monitor authorization latency and errors

6. **Networking**
   - Enable ingress with TLS termination
   - Use NetworkPolicies for traffic control
   - Configure proper RBAC

## Support

- Documentation: https://github.com/authz-engine/go-core
- Issues: https://github.com/authz-engine/go-core/issues
- Discussions: https://github.com/authz-engine/go-core/discussions
