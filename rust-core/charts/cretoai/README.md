# CretoAI Helm Chart

Helm chart for deploying CretoAI distributed consensus cluster to Kubernetes.

## Prerequisites

- Kubernetes 1.19+
- Helm 3+
- Persistent Volume provisioner support
- (Optional) Prometheus Operator for monitoring

## Installing the Chart

### Quick Start

```bash
# Add Helm repository (if published)
helm repo add cretoai https://charts.cretoai.io
helm repo update

# Install with default values
helm install cretoai cretoai/cretoai --namespace cretoai --create-namespace
```

### From Local Chart

```bash
# Install from local directory
helm install cretoai ./charts/cretoai --namespace cretoai --create-namespace

# Install with custom values
helm install cretoai ./charts/cretoai \
  --namespace cretoai \
  --create-namespace \
  --values my-values.yaml
```

## Configuration

### Common Configurations

**Small Cluster (Development/Testing)**

```yaml
node:
  replicaCount: 3
  resources:
    requests:
      cpu: 500m
      memory: 1Gi
      storage: 50Gi
    limits:
      cpu: 1
      memory: 2Gi

api:
  replicaCount: 2
  autoscaling:
    enabled: false
```

**Medium Cluster (Staging)**

```yaml
node:
  replicaCount: 3
  resources:
    requests:
      cpu: 1
      memory: 2Gi
      storage: 100Gi
    limits:
      cpu: 2
      memory: 4Gi

api:
  replicaCount: 3
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 10
```

**Large Cluster (Production)**

```yaml
node:
  replicaCount: 5
  resources:
    requests:
      cpu: 2
      memory: 4Gi
      storage: 200Gi
    limits:
      cpu: 4
      memory: 8Gi

api:
  replicaCount: 5
  autoscaling:
    enabled: true
    minReplicas: 5
    maxReplicas: 20

monitoring:
  enabled: true

ingress:
  enabled: true
  hosts:
    - host: api.mycompany.com
```

### Values

See [values.yaml](values.yaml) for full configuration options.

Key parameters:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `node.replicaCount` | Number of consensus nodes | `3` |
| `node.image.repository` | Node image repository | `cretoai/node` |
| `node.image.tag` | Node image tag | `latest` |
| `node.resources.requests.cpu` | CPU request per node | `1` |
| `node.resources.requests.memory` | Memory request per node | `2Gi` |
| `node.persistence.size` | Persistent volume size | `100Gi` |
| `api.replicaCount` | Number of API replicas | `3` |
| `api.autoscaling.enabled` | Enable HPA for API | `false` |
| `monitoring.enabled` | Enable Prometheus monitoring | `true` |
| `ingress.enabled` | Enable ingress | `false` |

## Upgrading

### Upgrade Chart

```bash
# Upgrade to new version
helm upgrade cretoai ./charts/cretoai \
  --namespace cretoai \
  --reuse-values

# Upgrade with new image tag
helm upgrade cretoai ./charts/cretoai \
  --namespace cretoai \
  --set node.image.tag=v1.1.0 \
  --set api.image.tag=v1.1.0 \
  --reuse-values
```

### Rollback

```bash
# View history
helm history cretoai -n cretoai

# Rollback to previous version
helm rollback cretoai -n cretoai

# Rollback to specific revision
helm rollback cretoai 2 -n cretoai
```

## Uninstalling

```bash
# Uninstall chart
helm uninstall cretoai -n cretoai

# Remove namespace
kubectl delete namespace cretoai
```

⚠️ **Warning**: This will delete all persistent volumes and data!

## Monitoring

### Enable Monitoring

```yaml
monitoring:
  enabled: true
  serviceMonitor:
    enabled: true
  prometheusRule:
    enabled: true
  grafanaDashboard:
    enabled: true
```

### Install Prometheus Operator

```bash
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace
```

### Access Grafana

```bash
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80
# Default credentials: admin/prom-operator
```

## Scaling

### Scale Consensus Nodes

⚠️ **Always use odd number (3, 5, 7) for Byzantine fault tolerance**

```bash
helm upgrade cretoai ./charts/cretoai \
  --set node.replicaCount=5 \
  --reuse-values \
  --namespace cretoai
```

### Scale API

```bash
helm upgrade cretoai ./charts/cretoai \
  --set api.replicaCount=10 \
  --reuse-values \
  --namespace cretoai
```

## Troubleshooting

### Check Status

```bash
# Helm release status
helm status cretoai -n cretoai

# Get values
helm get values cretoai -n cretoai

# Get manifests
helm get manifest cretoai -n cretoai
```

### Debug Installation

```bash
# Dry run to see rendered templates
helm install cretoai ./charts/cretoai \
  --namespace cretoai \
  --dry-run \
  --debug

# Template only (no installation)
helm template cretoai ./charts/cretoai \
  --namespace cretoai
```

### Common Issues

**Pending PVCs:**
```bash
kubectl get pvc -n cretoai
# Check if storage class exists
kubectl get storageclass
```

**Pod Crashes:**
```bash
# Check logs
kubectl logs -n cretoai -l app=cretoai-node --tail=100

# Describe pod
kubectl describe pod -n cretoai cretoai-node-0
```

## Development

### Lint Chart

```bash
helm lint ./charts/cretoai
```

### Package Chart

```bash
helm package ./charts/cretoai
```

### Publish Chart

```bash
# Package chart
helm package ./charts/cretoai

# Create index
helm repo index .

# Upload to repository
```

## Support

- **Documentation**: https://docs.cretoai.io
- **Issues**: https://github.com/cretoai/cretoai/issues
- **Slack**: https://cretoai.slack.com
