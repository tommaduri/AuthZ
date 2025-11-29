# CretoAI Kubernetes Quick Start

Get CretoAI running on Kubernetes in 5 minutes!

## Prerequisites

- Kubernetes cluster (1.19+)
- `kubectl` configured
- (Optional) Helm 3+
- (Optional) 3+ nodes for HA

## 🚀 Deploy in 1 Command

### Option 1: All-in-One Manifest (Fastest)

```bash
kubectl apply -f k8s/cretoai-cluster.yaml
```

### Option 2: Automated Script (Recommended)

```bash
# Deploy with kubectl
./scripts/k8s-deploy.sh kubectl

# Or deploy with Helm
./scripts/k8s-deploy.sh helm
```

### Option 3: Helm Chart (Most Flexible)

```bash
helm install cretoai ./charts/cretoai \
  --namespace cretoai \
  --create-namespace
```

## ✅ Verify Deployment

```bash
# Check pods
kubectl get pods -n cretoai

# Expected output:
# NAME               READY   STATUS    RESTARTS   AGE
# cretoai-node-0     1/1     Running   0          2m
# cretoai-node-1     1/1     Running   0          2m
# cretoai-node-2     1/1     Running   0          2m
# cretoai-api-xxx    1/1     Running   0          2m
# cretoai-api-yyy    1/1     Running   0          2m
# cretoai-api-zzz    1/1     Running   0          2m
```

## 🌐 Access API

### Port-Forward (Quick Test)

```bash
kubectl port-forward -n cretoai svc/cretoai-api 8080:8080

# Open in browser: http://localhost:8080
# Swagger UI: http://localhost:8080/swagger-ui/
```

### LoadBalancer (Production)

```bash
# Get external IP
export API_URL=$(kubectl get svc cretoai-api-lb -n cretoai -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

# Test API
curl http://$API_URL/health

# Open Swagger UI
echo "API available at: http://$API_URL"
echo "Swagger UI: http://$API_URL/swagger-ui/"
```

## 📊 View Metrics

```bash
# Port-forward to metrics
kubectl port-forward -n cretoai svc/cretoai-metrics 9090:9090

# Open: http://localhost:9090
```

## 📈 Monitor with Prometheus

### Install Prometheus Operator

```bash
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace
```

### Deploy CretoAI Monitoring

```bash
kubectl apply -f k8s/monitoring/servicemonitor.yaml
kubectl apply -f k8s/monitoring/prometheusrule.yaml
```

### Access Grafana

```bash
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80

# Open: http://localhost:3000
# Username: admin
# Password: prom-operator

# Import dashboard: k8s/monitoring/grafana-dashboard.json
```

## 📝 View Logs

```bash
# Consensus nodes
kubectl logs -n cretoai -l app=cretoai-node -f

# API
kubectl logs -n cretoai -l app=cretoai-api -f
```

## 🔄 Upgrade

```bash
# Zero-downtime upgrade
./scripts/k8s-upgrade.sh v1.1.0 kubectl

# Or with Helm
./scripts/k8s-upgrade.sh v1.1.0 helm
```

## 📏 Scale

### Scale Consensus Nodes

⚠️ **Always use odd number (3, 5, 7) for BFT**

```bash
# Scale to 5 nodes
kubectl scale statefulset cretoai-node --replicas=5 -n cretoai
```

### Scale API

```bash
# Scale to 10 replicas
kubectl scale deployment cretoai-api --replicas=10 -n cretoai
```

## 🧹 Clean Up

```bash
# Delete all resources
kubectl delete namespace cretoai

# Or with Helm
helm uninstall cretoai -n cretoai
kubectl delete namespace cretoai
```

## 🔧 Customize Deployment

### Edit Configuration

```bash
# Edit node configuration
kubectl edit configmap cretoai-config -n cretoai

# Restart nodes to apply changes
kubectl rollout restart statefulset/cretoai-node -n cretoai
```

### Adjust Resources

```bash
# Helm
helm upgrade cretoai ./charts/cretoai \
  --set node.resources.requests.cpu=2 \
  --set node.resources.requests.memory=4Gi \
  --reuse-values \
  --namespace cretoai
```

### Enable Ingress

```bash
# Edit ingress.yaml to set your domain
vim k8s/ingress.yaml

# Apply ingress
kubectl apply -f k8s/ingress.yaml
```

## 🆘 Troubleshooting

### Pods Pending

```bash
# Check PVCs
kubectl get pvc -n cretoai

# Check events
kubectl get events -n cretoai --sort-by='.lastTimestamp'
```

### Consensus Not Working

```bash
# Check peer connections
kubectl exec cretoai-node-0 -n cretoai -- \
  curl -s http://localhost:9090/metrics | grep connected_peers

# Should show 2 connected peers
```

### API Not Accessible

```bash
# Check service
kubectl get svc -n cretoai

# Check endpoints
kubectl get endpoints -n cretoai

# Check logs
kubectl logs -n cretoai -l app=cretoai-api --tail=50
```

## 📚 Next Steps

1. **Configure DNS**: Point your domain to LoadBalancer IP
2. **Enable TLS**: Deploy ingress with cert-manager
3. **Set up Backups**: Configure Velero for automated backups
4. **Monitor Alerts**: Configure alert routing in Prometheus
5. **Review Documentation**: See `/docs/deployment/KUBERNETES_DEPLOYMENT.md`

## 🎯 Common Commands

```bash
# Check status
kubectl get all -n cretoai

# Describe pod
kubectl describe pod cretoai-node-0 -n cretoai

# Exec into pod
kubectl exec -it cretoai-node-0 -n cretoai -- /bin/sh

# Check storage
kubectl exec cretoai-node-0 -n cretoai -- df -h /data

# View metrics
kubectl port-forward -n cretoai svc/cretoai-metrics 9090:9090

# Test API
kubectl run -it --rm test --image=curlimages/curl:latest -- \
  curl http://cretoai-api.cretoai.svc.cluster.local:8080/health
```

## 📖 Full Documentation

- **Complete Guide**: `/docs/deployment/KUBERNETES_DEPLOYMENT.md`
- **Manifests**: `/k8s/README.md`
- **Helm Chart**: `/charts/cretoai/README.md`
- **Phase 6 Plan**: `/docs/architecture/PHASE_6_PLAN.md`

## 🆘 Support

- **Issues**: https://github.com/cretoai/cretoai/issues
- **Docs**: https://docs.cretoai.io
- **Slack**: https://cretoai.slack.com

---

**That's it!** You now have a production-ready CretoAI distributed consensus cluster running on Kubernetes! 🎉
