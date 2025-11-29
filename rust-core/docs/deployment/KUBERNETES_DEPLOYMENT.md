# Kubernetes Deployment Guide

## Quick Start

### One-Command Deployment

```bash
# Deploy with Helm (recommended)
./scripts/k8s-deploy.sh helm

# Or deploy with kubectl
./scripts/k8s-deploy.sh kubectl
```

### Rolling Upgrade

```bash
# Upgrade to new version with zero downtime
./scripts/k8s-upgrade.sh v1.1.0 helm
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│              Kubernetes Cluster                      │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────────────────────────────────────┐  │
│  │  Namespace: cretoai                          │  │
│  │                                               │  │
│  │  ┌────────────────────────────────────────┐  │  │
│  │  │  StatefulSet: cretoai-node (3 pods)   │  │  │
│  │  │  - cretoai-node-0 (Leader)            │  │  │
│  │  │  - cretoai-node-1 (Follower)          │  │  │
│  │  │  - cretoai-node-2 (Follower)          │  │  │
│  │  │  Each with 100Gi PV                   │  │  │
│  │  └────────────────────────────────────────┘  │  │
│  │              ▲                                │  │
│  │              │ (QUIC P2P)                     │  │
│  │              ▼                                │  │
│  │  ┌────────────────────────────────────────┐  │  │
│  │  │  Deployment: cretoai-api (3 pods)     │  │  │
│  │  │  - Stateless REST API                 │  │  │
│  │  │  - Connects to consensus nodes        │  │  │
│  │  └────────────────────────────────────────┘  │  │
│  │              ▲                                │  │
│  │              │                                │  │
│  │  ┌────────────────────────────────────────┐  │  │
│  │  │  LoadBalancer: cretoai-api-lb         │  │  │
│  │  │  - External IP: X.X.X.X               │  │  │
│  │  └────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## Deployment Options

### Option 1: Helm Chart (Recommended)

**Advantages:**
- Easy configuration with `values.yaml`
- Templated manifests
- Built-in upgrade/rollback
- Version management

**Install:**

```bash
# Add Helm repository (if published)
helm repo add cretoai https://charts.cretoai.io
helm repo update

# Install with default values
helm install cretoai cretoai/cretoai --namespace cretoai --create-namespace

# Or install from local chart
helm install cretoai ./charts/cretoai --namespace cretoai --create-namespace
```

**Custom Configuration:**

```bash
# Create custom values file
cat > my-values.yaml <<EOF
node:
  replicaCount: 5
  resources:
    requests:
      cpu: 2
      memory: 4Gi
  persistence:
    size: 200Gi

api:
  replicaCount: 5
  ingress:
    enabled: true
    hosts:
      - host: api.mycompany.com
EOF

# Install with custom values
helm install cretoai ./charts/cretoai \
  --namespace cretoai \
  --create-namespace \
  --values my-values.yaml
```

### Option 2: kubectl Manifests

**Advantages:**
- Full control over manifests
- No Helm dependency
- Simpler for basic deployments

**Deploy:**

```bash
# All-in-one manifest
kubectl apply -f k8s/cretoai-cluster.yaml

# Or individual manifests
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/statefulset.yaml
kubectl apply -f k8s/api-deployment.yaml
kubectl apply -f k8s/api-service.yaml
```

---

## Configuration

### Node Configuration (`node.toml`)

```toml
[consensus]
quorum_threshold = 0.67  # 2/3 majority
finality_timeout_ms = 500

[storage]
cache_size_mb = 512
write_buffer_mb = 128

[network]
max_connections = 100
```

**Update via ConfigMap:**

```bash
kubectl edit configmap cretoai-config -n cretoai
# Restart pods to apply changes
kubectl rollout restart statefulset/cretoai-node -n cretoai
```

### Resource Limits

**Default per node:**
- CPU: 1-2 cores
- Memory: 2-4Gi
- Storage: 100Gi persistent volume

**Adjust via Helm:**

```yaml
node:
  resources:
    requests:
      cpu: 2
      memory: 4Gi
      storage: 200Gi
    limits:
      cpu: 4
      memory: 8Gi
```

---

## Scaling

### Scale Consensus Nodes

⚠️ **Always use odd number of nodes (3, 5, 7) for Byzantine fault tolerance**

```bash
# Helm
helm upgrade cretoai ./charts/cretoai \
  --set node.replicaCount=5 \
  --reuse-values \
  --namespace cretoai

# kubectl
kubectl scale statefulset cretoai-node --replicas=5 -n cretoai
```

### Scale API

```bash
# Helm
helm upgrade cretoai ./charts/cretoai \
  --set api.replicaCount=10 \
  --reuse-values \
  --namespace cretoai

# kubectl
kubectl scale deployment cretoai-api --replicas=10 -n cretoai
```

### Horizontal Pod Autoscaler (HPA)

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

---

## Monitoring

### Prometheus Metrics

**Install Prometheus Operator:**

```bash
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace
```

**Deploy ServiceMonitor:**

```bash
kubectl apply -f k8s/monitoring/servicemonitor.yaml
```

**Key Metrics:**
- `cretoai_vertices_finalized_total` - Total vertices finalized
- `cretoai_finality_time_seconds` - Finality latency histogram
- `cretoai_connected_peers` - Active peer connections
- `cretoai_storage_write_seconds` - RocksDB write latency

### Grafana Dashboard

**Import dashboard:**

```bash
# Port-forward to Grafana
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80

# Open: http://localhost:3000
# Import: k8s/monitoring/grafana-dashboard.json
```

### Alerts

**Deploy PrometheusRule:**

```bash
kubectl apply -f k8s/monitoring/prometheusrule.yaml
```

**Critical Alerts:**
- `ConsensusStalled` - No vertices finalized for 2 minutes
- `QuorumLoss` - Less than 2 nodes available
- `ByzantineNodeDetected` - Malicious behavior detected

---

## Ingress & TLS

### cert-manager Setup

```bash
# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Deploy ClusterIssuer
kubectl apply -f k8s/ingress.yaml
```

### Configure DNS

```bash
# Get LoadBalancer IP
EXTERNAL_IP=$(kubectl get svc cretoai-api-lb -n cretoai -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

# Add DNS record
# api.mycompany.com -> $EXTERNAL_IP
```

### Enable Ingress

```yaml
# values.yaml
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: api.mycompany.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: cretoai-api-tls
      hosts:
        - api.mycompany.com
```

---

## Backup & Restore

### Automatic Backups with Velero

**Install Velero:**

```bash
velero install \
  --provider aws \
  --bucket cretoai-backups \
  --secret-file ./credentials-velero
```

**Schedule Backups:**

```bash
# Daily backups
velero schedule create cretoai-daily \
  --schedule="@daily" \
  --include-namespaces cretoai
```

### Manual Backup

```bash
# Backup entire namespace
velero backup create cretoai-backup-$(date +%Y%m%d) \
  --include-namespaces cretoai
```

### Restore

```bash
# List backups
velero backup get

# Restore from backup
velero restore create --from-backup cretoai-backup-20250127
```

---

## Troubleshooting

### Check Pod Status

```bash
kubectl get pods -n cretoai -o wide
```

### View Logs

```bash
# Consensus node logs
kubectl logs -n cretoai cretoai-node-0 -f

# API logs
kubectl logs -n cretoai -l app=cretoai-api -f --tail=100
```

### Debug Pod

```bash
# Exec into pod
kubectl exec -it cretoai-node-0 -n cretoai -- /bin/sh

# Check storage
df -h /data

# Check network
nc -zv cretoai-node-1.cretoai-nodes 9001
```

### Common Issues

**Quorum Loss:**
```bash
# Check node connectivity
kubectl exec cretoai-node-0 -n cretoai -- \
  curl -s http://cretoai-node-1.cretoai-nodes:9090/metrics | grep connected_peers
```

**High Storage Usage:**
```bash
# Check disk usage
kubectl exec cretoai-node-0 -n cretoai -- du -sh /data/db
```

**Slow Finality:**
```bash
# Check metrics
kubectl port-forward -n cretoai svc/cretoai-metrics 9090:9090
# Open: http://localhost:9090
# Query: histogram_quantile(0.99, rate(cretoai_finality_time_seconds_bucket[5m]))
```

---

## Security Best Practices

### Network Policies

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: cretoai-node-policy
  namespace: cretoai
spec:
  podSelector:
    matchLabels:
      app: cretoai-node
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: cretoai-node
      ports:
        - protocol: TCP
          port: 9000
        - protocol: UDP
          port: 9001
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: cretoai-node
```

### Pod Security Standards

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: cretoai
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

### RBAC

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: cretoai-operator
  namespace: cretoai
rules:
  - apiGroups: [""]
    resources: ["pods", "services"]
    verbs: ["get", "list", "watch"]
```

---

## Production Checklist

- [ ] Deploy 3+ consensus nodes (odd number)
- [ ] Configure persistent volumes with sufficient size
- [ ] Set appropriate resource requests/limits
- [ ] Enable monitoring (Prometheus + Grafana)
- [ ] Configure alerting (critical alerts)
- [ ] Set up automated backups (Velero)
- [ ] Configure ingress with TLS
- [ ] Enable network policies
- [ ] Test disaster recovery procedures
- [ ] Document runbooks for common issues
- [ ] Set up log aggregation (ELK/Loki)
- [ ] Configure horizontal pod autoscaling (API)
- [ ] Test rolling upgrades in staging

---

## Support

- **Documentation**: https://docs.cretoai.io
- **Issues**: https://github.com/cretoai/cretoai/issues
- **Slack**: https://cretoai.slack.com
