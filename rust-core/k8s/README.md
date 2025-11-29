# CretoAI Kubernetes Manifests

This directory contains production-ready Kubernetes manifests for deploying the CretoAI distributed consensus cluster.

## 📁 Directory Structure

```
k8s/
├── namespace.yaml              # Dedicated namespace for CretoAI
├── configmap.yaml             # Node configuration (node.toml)
├── statefulset.yaml           # 3 consensus nodes with persistent volumes
├── service.yaml               # Headless service + metrics service
├── api-deployment.yaml        # REST API deployment (3 replicas)
├── api-service.yaml          # API services (ClusterIP + LoadBalancer)
├── ingress.yaml              # HTTPS ingress with cert-manager
├── cretoai-cluster.yaml      # All-in-one combined manifest
└── monitoring/
    ├── servicemonitor.yaml    # Prometheus scraping
    ├── prometheusrule.yaml    # Alert rules
    └── grafana-dashboard.json # Pre-configured dashboard
```

## 🚀 Quick Deploy

### Option 1: All-in-One Manifest

```bash
kubectl apply -f cretoai-cluster.yaml
```

### Option 2: Individual Manifests

```bash
kubectl apply -f namespace.yaml
kubectl apply -f configmap.yaml
kubectl apply -f service.yaml
kubectl apply -f statefulset.yaml
kubectl apply -f api-deployment.yaml
kubectl apply -f api-service.yaml
```

### Option 3: Automated Script

```bash
# From repo root
./scripts/k8s-deploy.sh kubectl
```

## 📊 Components

### Consensus Nodes (StatefulSet)

- **Replicas**: 3 (can scale to 5, 7, etc. - always odd number)
- **Resources**: 1-2 CPU, 2-4Gi RAM per node
- **Storage**: 100Gi persistent volume per node
- **Ports**:
  - 9000: P2P communication
  - 9001: QUIC transport (UDP)
  - 9090: Prometheus metrics
  - 9091: Liveness probe
  - 9092: Readiness probe

### REST API (Deployment)

- **Replicas**: 3 (horizontally scalable)
- **Resources**: 500m-1 CPU, 1-2Gi RAM per pod
- **Ports**:
  - 8080: HTTP REST API

### Services

1. **cretoai-nodes** (Headless)
   - For StatefulSet pod discovery
   - DNS: `cretoai-node-{0,1,2}.cretoai-nodes.cretoai.svc.cluster.local`

2. **cretoai-api** (ClusterIP)
   - Internal API access

3. **cretoai-api-lb** (LoadBalancer)
   - External API access via cloud load balancer

## ⚙️ Configuration

### Node Configuration

Edit `configmap.yaml` to modify consensus parameters:

```yaml
[consensus]
quorum_threshold = 0.67      # 2/3 majority
finality_timeout_ms = 500    # Max finality time

[storage]
cache_size_mb = 512          # RocksDB cache
write_buffer_mb = 128        # Write buffer size
```

Apply changes:

```bash
kubectl apply -f configmap.yaml
kubectl rollout restart statefulset/cretoai-node -n cretoai
```

### Resource Limits

Adjust in `statefulset.yaml`:

```yaml
resources:
  requests:
    cpu: "2"
    memory: "4Gi"
    storage: "200Gi"
  limits:
    cpu: "4"
    memory: "8Gi"
```

## 📈 Monitoring

### Deploy Monitoring Stack

```bash
# Install Prometheus Operator (if not already installed)
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace

# Deploy CretoAI monitoring
kubectl apply -f monitoring/servicemonitor.yaml
kubectl apply -f monitoring/prometheusrule.yaml
```

### Access Grafana

```bash
# Port-forward to Grafana
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80

# Open http://localhost:3000
# Import dashboard: monitoring/grafana-dashboard.json
```

### Key Metrics

- `cretoai_vertices_finalized_total` - Vertices finalized
- `cretoai_finality_time_seconds` - Finality latency
- `cretoai_connected_peers` - Peer connections
- `cretoai_byzantine_violations_total` - Byzantine violations

### Alerts

Critical alerts configured in `prometheusrule.yaml`:

- **ConsensusStalled** - No vertices finalized for 2 minutes
- **QuorumLoss** - Less than 2 nodes available
- **ByzantineNodeDetected** - Malicious behavior detected
- **HighFinalityLatency** - P99 > 1 second

## 🔐 Ingress & TLS

### Prerequisites

```bash
# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
```

### Deploy Ingress

1. Edit `ingress.yaml` to set your domain:

```yaml
hosts:
  - host: api.yourcompany.com
```

2. Update DNS to point to LoadBalancer IP:

```bash
EXTERNAL_IP=$(kubectl get svc cretoai-api-lb -n cretoai -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
echo "Add DNS: api.yourcompany.com -> $EXTERNAL_IP"
```

3. Deploy ingress:

```bash
kubectl apply -f ingress.yaml
```

## 📏 Scaling

### Scale Consensus Nodes

⚠️ **Always use odd number (3, 5, 7) for BFT consensus**

```bash
# Scale to 5 nodes
kubectl scale statefulset cretoai-node --replicas=5 -n cretoai

# Wait for rollout
kubectl rollout status statefulset/cretoai-node -n cretoai
```

### Scale API

```bash
# Scale to 10 replicas
kubectl scale deployment cretoai-api --replicas=10 -n cretoai
```

### Horizontal Pod Autoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: cretoai-api-hpa
  namespace: cretoai
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: cretoai-api
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 80
```

## 🔄 Rolling Updates

### Automated Script

```bash
# From repo root
./scripts/k8s-upgrade.sh v1.1.0 kubectl
```

### Manual Upgrade

```bash
# Update StatefulSet image
kubectl set image statefulset/cretoai-node \
  node=cretoai/node:v1.1.0 \
  -n cretoai

# Monitor rollout
kubectl rollout status statefulset/cretoai-node -n cretoai

# Update API
kubectl set image deployment/cretoai-api \
  api=cretoai/api:v1.1.0 \
  -n cretoai
```

### Rollback

```bash
# Rollback StatefulSet
kubectl rollout undo statefulset/cretoai-node -n cretoai

# Rollback API
kubectl rollout undo deployment/cretoai-api -n cretoai
```

## 💾 Backup & Restore

### Using Velero

```bash
# Install Velero
velero install --provider aws --bucket cretoai-backups

# Create backup
velero backup create cretoai-backup-$(date +%Y%m%d) \
  --include-namespaces cretoai

# Restore
velero restore create --from-backup cretoai-backup-20250127
```

### Manual Backup

```bash
# Backup persistent volumes (requires cloud provider snapshots)
kubectl get pvc -n cretoai

# Export manifests
kubectl get all -n cretoai -o yaml > cretoai-backup.yaml
```

## 🔍 Troubleshooting

### Check Status

```bash
# Pods
kubectl get pods -n cretoai -o wide

# Services
kubectl get svc -n cretoai

# StatefulSet
kubectl get statefulset -n cretoai

# Events
kubectl get events -n cretoai --sort-by='.lastTimestamp'
```

### View Logs

```bash
# Consensus node logs
kubectl logs -n cretoai cretoai-node-0 -f

# API logs
kubectl logs -n cretoai -l app=cretoai-api -f --tail=100

# All logs
kubectl logs -n cretoai --all-containers=true -f
```

### Debug Pod

```bash
# Exec into consensus node
kubectl exec -it cretoai-node-0 -n cretoai -- /bin/sh

# Check storage
df -h /data

# Check connectivity
nc -zv cretoai-node-1.cretoai-nodes 9001
```

### Common Issues

**Pod Stuck in Pending:**

```bash
# Check PV binding
kubectl get pvc -n cretoai

# Check events
kubectl describe pod cretoai-node-0 -n cretoai
```

**Consensus Not Finalizing:**

```bash
# Check peer connections
kubectl exec cretoai-node-0 -n cretoai -- \
  curl -s http://localhost:9090/metrics | grep connected_peers

# Check quorum
kubectl get pods -n cretoai -l app=cretoai-node
```

**High Latency:**

```bash
# Check metrics
kubectl port-forward -n cretoai svc/cretoai-metrics 9090:9090
# Query: histogram_quantile(0.99, rate(cretoai_finality_time_seconds_bucket[5m]))
```

## 🛡️ Security

### Network Policies

```bash
# Apply network policies (create network-policy.yaml)
kubectl apply -f network-policy.yaml
```

### Pod Security

Configured in manifests:
- Run as non-root (UID 1000)
- Read-only root filesystem (where possible)
- Drop all capabilities
- No privilege escalation

### RBAC

```bash
# Create service account with limited permissions
kubectl create serviceaccount cretoai-operator -n cretoai
```

## ✅ Production Checklist

- [ ] Deploy 3+ consensus nodes (odd number)
- [ ] Configure persistent volumes (100Gi+ per node)
- [ ] Set resource requests/limits
- [ ] Enable monitoring (Prometheus)
- [ ] Configure alerts (PrometheusRule)
- [ ] Set up automated backups
- [ ] Configure ingress with TLS
- [ ] Test disaster recovery
- [ ] Document runbooks
- [ ] Set up log aggregation
- [ ] Configure HPA for API
- [ ] Test rolling upgrades

## 📚 References

- [Kubernetes Deployment Guide](/docs/deployment/KUBERNETES_DEPLOYMENT.md)
- [Phase 6 Plan](/docs/architecture/PHASE_6_PLAN.md)
- [Helm Chart](/charts/cretoai/)
- [Deployment Scripts](/scripts/)

## 🆘 Support

- **Documentation**: https://docs.cretoai.io
- **Issues**: https://github.com/cretoai/cretoai/issues
- **Slack**: https://cretoai.slack.com
