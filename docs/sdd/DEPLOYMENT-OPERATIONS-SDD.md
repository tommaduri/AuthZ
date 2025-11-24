# Software Design Document: Deployment & Operations

**Version**: 1.0.0
**Package**: `@authz-engine/infrastructure`
**Status**: Specification
**Last Updated**: 2025-11-23

---

## 1. Overview

### 1.1 Purpose

This document defines the deployment architecture, containerization strategy, Kubernetes configurations, and operational procedures for the AuthZ Engine in production environments.

### 1.2 Scope

**In Scope:**
- Docker multi-stage builds and image optimization
- Kubernetes deployments, services, and ingress
- Helm chart structure and configuration
- Auto-scaling (HPA, VPA, KEDA)
- Deployment strategies (rolling, blue-green, canary)
- Service mesh integration (Istio, Linkerd)
- Operational runbooks

**Out of Scope:**
- Application code changes
- Policy authoring (see POLICY-MANAGEMENT-UI-SDD)

### 1.3 Design Goals

| Goal | Target | Rationale |
|------|--------|-----------|
| Zero-downtime deployments | 100% | Business continuity |
| Deployment time | <30 seconds | Fast iteration |
| Rollback time | <60 seconds | Quick recovery |
| Container startup | <5 seconds | Fast scaling |
| Availability | 99.99% | Enterprise SLA |

---

## 2. Container Architecture

### 2.1 Docker Images

```
┌─────────────────────────────────────────────────────────────┐
│                    AuthZ Engine Images                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │  authz-server    │  │  authz-agents    │                 │
│  │  (REST + gRPC)   │  │  (AI/ML agents)  │                 │
│  │  ~50MB           │  │  ~80MB           │                 │
│  └──────────────────┘  └──────────────────┘                 │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │  authz-sidecar   │  │  authz-cli       │                 │
│  │  (Envoy ext_authz)│ │  (Admin tools)   │                 │
│  │  ~30MB           │  │  ~20MB           │                 │
│  └──────────────────┘  └──────────────────┘                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Multi-Stage Dockerfile

```dockerfile
# ============================================
# AuthZ Engine Server - Production Dockerfile
# ============================================

# Stage 1: Build TypeScript
FROM node:20-alpine AS ts-builder
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm run build

# Stage 2: Build Go Core
FROM golang:1.21-alpine AS go-builder
WORKDIR /build
COPY go/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o authz-core ./cmd/server

# Stage 3: Production Runtime
FROM gcr.io/distroless/nodejs20-debian12:nonroot
WORKDIR /app

# Copy TypeScript build
COPY --from=ts-builder /build/packages/server/dist ./dist
COPY --from=ts-builder /build/node_modules ./node_modules

# Copy Go binary
COPY --from=go-builder /build/authz-core ./bin/authz-core

# Copy default policies
COPY policies/ ./policies/

# Security: Non-root user
USER nonroot:nonroot

# Health check
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "require('http').get('http://localhost:3592/health/live')"]

# Expose ports
EXPOSE 3592 3593 9090

# Entry point
ENTRYPOINT ["/nodejs/bin/node", "dist/index.js"]
```

### 2.3 Image Security

```yaml
# Trivy scan configuration
trivy:
  severity: "CRITICAL,HIGH"
  ignore-unfixed: true
  exit-code: 1
  format: "sarif"

security:
  # No root user
  runAsNonRoot: true
  runAsUser: 65532
  runAsGroup: 65532

  # Read-only filesystem
  readOnlyRootFilesystem: true

  # No privilege escalation
  allowPrivilegeEscalation: false

  # Drop all capabilities
  capabilities:
    drop: ["ALL"]
```

---

## 3. Kubernetes Architecture

### 3.1 Resource Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Kubernetes Cluster                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Namespace: authz-engine                                             │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                                                              │    │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │    │
│  │  │ Deployment  │    │ Deployment  │    │ StatefulSet │     │    │
│  │  │ authz-server│    │authz-agents │    │   redis     │     │    │
│  │  │ replicas: 3 │    │ replicas: 2 │    │ replicas: 3 │     │    │
│  │  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘     │    │
│  │         │                  │                  │             │    │
│  │  ┌──────┴──────┐    ┌──────┴──────┐    ┌──────┴──────┐     │    │
│  │  │   Service   │    │   Service   │    │   Service   │     │    │
│  │  │  ClusterIP  │    │  ClusterIP  │    │  Headless   │     │    │
│  │  └──────┬──────┘    └─────────────┘    └─────────────┘     │    │
│  │         │                                                   │    │
│  │  ┌──────┴──────┐                                           │    │
│  │  │   Ingress   │                                           │    │
│  │  │ authz.example.com                                       │    │
│  │  └─────────────┘                                           │    │
│  │                                                              │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  Supporting Resources:                                               │
│  ├── ConfigMap: authz-config                                        │
│  ├── Secret: authz-secrets                                          │
│  ├── HorizontalPodAutoscaler: authz-server-hpa                      │
│  ├── PodDisruptionBudget: authz-server-pdb                          │
│  ├── NetworkPolicy: authz-network-policy                            │
│  └── ServiceMonitor: authz-metrics                                  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Deployment Manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: authz-server
  namespace: authz-engine
  labels:
    app.kubernetes.io/name: authz-server
    app.kubernetes.io/component: server
    app.kubernetes.io/version: "1.0.0"
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app.kubernetes.io/name: authz-server
  template:
    metadata:
      labels:
        app.kubernetes.io/name: authz-server
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
        prometheus.io/path: "/metrics"
    spec:
      serviceAccountName: authz-server
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        fsGroup: 65532
        seccompProfile:
          type: RuntimeDefault

      # Anti-affinity for HA
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchLabels:
                    app.kubernetes.io/name: authz-server
                topologyKey: kubernetes.io/hostname

      # Topology spread
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: authz-server

      containers:
        - name: authz-server
          image: ghcr.io/authz-engine/server:1.0.0
          imagePullPolicy: IfNotPresent

          ports:
            - name: http
              containerPort: 3592
              protocol: TCP
            - name: grpc
              containerPort: 3593
              protocol: TCP
            - name: metrics
              containerPort: 9090
              protocol: TCP

          env:
            - name: NODE_ENV
              value: "production"
            - name: LOG_LEVEL
              value: "info"
            - name: POLICY_DIR
              value: "/policies"
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: authz-secrets
                  key: redis-url

          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "2000m"
              memory: "2Gi"

          livenessProbe:
            httpGet:
              path: /health/live
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3

          readinessProbe:
            httpGet:
              path: /health/ready
              port: http
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3

          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]

          volumeMounts:
            - name: policies
              mountPath: /policies
              readOnly: true
            - name: tmp
              mountPath: /tmp

      volumes:
        - name: policies
          configMap:
            name: authz-policies
        - name: tmp
          emptyDir: {}
```

### 3.3 Service Configuration

```yaml
apiVersion: v1
kind: Service
metadata:
  name: authz-server
  namespace: authz-engine
  labels:
    app.kubernetes.io/name: authz-server
spec:
  type: ClusterIP
  ports:
    - name: http
      port: 80
      targetPort: http
      protocol: TCP
    - name: grpc
      port: 443
      targetPort: grpc
      protocol: TCP
  selector:
    app.kubernetes.io/name: authz-server
---
apiVersion: v1
kind: Service
metadata:
  name: authz-server-headless
  namespace: authz-engine
spec:
  type: ClusterIP
  clusterIP: None
  ports:
    - name: grpc
      port: 3593
      targetPort: grpc
  selector:
    app.kubernetes.io/name: authz-server
```

### 3.4 Ingress Configuration

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: authz-server
  namespace: authz-engine
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/backend-protocol: "HTTP"
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "30"
spec:
  tls:
    - hosts:
        - authz.example.com
      secretName: authz-tls
  rules:
    - host: authz.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: authz-server
                port:
                  name: http
```

---

## 4. Auto-Scaling

### 4.1 Horizontal Pod Autoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: authz-server-hpa
  namespace: authz-engine
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: authz-server
  minReplicas: 3
  maxReplicas: 50
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 15
        - type: Pods
          value: 4
          periodSeconds: 15
      selectPolicy: Max
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
    - type: Pods
      pods:
        metric:
          name: authz_check_rate
        target:
          type: AverageValue
          averageValue: "10000"
```

### 4.2 KEDA ScaledObject

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: authz-server-keda
  namespace: authz-engine
spec:
  scaleTargetRef:
    name: authz-server
  minReplicaCount: 3
  maxReplicaCount: 100
  pollingInterval: 15
  cooldownPeriod: 300
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus:9090
        metricName: authz_check_rate
        query: sum(rate(authz_check_total[1m]))
        threshold: "50000"
    - type: prometheus
      metadata:
        serverAddress: http://prometheus:9090
        metricName: authz_latency_p99
        query: histogram_quantile(0.99, rate(authz_check_duration_seconds_bucket[1m]))
        threshold: "0.01"
```

### 4.3 Pod Disruption Budget

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: authz-server-pdb
  namespace: authz-engine
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: authz-server
```

---

## 5. Helm Chart

### 5.1 Chart Structure

```
charts/authz-engine/
├── Chart.yaml
├── values.yaml
├── values-production.yaml
├── values-staging.yaml
├── templates/
│   ├── _helpers.tpl
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── hpa.yaml
│   ├── pdb.yaml
│   ├── configmap.yaml
│   ├── secret.yaml
│   ├── serviceaccount.yaml
│   ├── servicemonitor.yaml
│   └── networkpolicy.yaml
└── charts/
    └── redis/
```

### 5.2 values.yaml

```yaml
# AuthZ Engine Helm Values
# =========================

# Global settings
global:
  imageRegistry: ghcr.io
  imagePullSecrets: []
  storageClass: ""

# Server configuration
server:
  enabled: true
  replicaCount: 3

  image:
    repository: authz-engine/server
    tag: "1.0.0"
    pullPolicy: IfNotPresent

  # Resource limits
  resources:
    requests:
      cpu: 500m
      memory: 512Mi
    limits:
      cpu: 2000m
      memory: 2Gi

  # Auto-scaling
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 50
    targetCPUUtilizationPercentage: 70
    targetMemoryUtilizationPercentage: 80

  # Pod disruption budget
  pdb:
    enabled: true
    minAvailable: 2

  # Service configuration
  service:
    type: ClusterIP
    httpPort: 80
    grpcPort: 443
    metricsPort: 9090

  # Ingress configuration
  ingress:
    enabled: true
    className: nginx
    annotations:
      cert-manager.io/cluster-issuer: letsencrypt-prod
    hosts:
      - host: authz.example.com
        paths:
          - path: /
            pathType: Prefix
    tls:
      - secretName: authz-tls
        hosts:
          - authz.example.com

  # Security context
  securityContext:
    runAsNonRoot: true
    runAsUser: 65532
    fsGroup: 65532

  # Probes
  livenessProbe:
    enabled: true
    initialDelaySeconds: 5
    periodSeconds: 10

  readinessProbe:
    enabled: true
    initialDelaySeconds: 5
    periodSeconds: 5

# Agents configuration
agents:
  enabled: true
  replicaCount: 2

  image:
    repository: authz-engine/agents
    tag: "1.0.0"

  resources:
    requests:
      cpu: 1000m
      memory: 1Gi
    limits:
      cpu: 4000m
      memory: 4Gi

# Redis configuration
redis:
  enabled: true
  architecture: replication
  auth:
    enabled: true
    existingSecret: authz-redis-secret
  replica:
    replicaCount: 3
  sentinel:
    enabled: true

# Observability
metrics:
  enabled: true
  serviceMonitor:
    enabled: true
    interval: 15s
    scrapeTimeout: 10s

# Network policies
networkPolicy:
  enabled: true
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              name: authz-engine

# Configuration
config:
  logLevel: info
  policyDir: /policies
  cacheEnabled: true
  cacheTTL: 300
```

---

## 6. Deployment Strategies

### 6.1 Rolling Update (Default)

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%
      maxUnavailable: 0
```

### 6.2 Blue-Green Deployment

```yaml
# Blue deployment (current)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: authz-server-blue
  labels:
    app: authz-server
    version: blue
---
# Green deployment (new)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: authz-server-green
  labels:
    app: authz-server
    version: green
---
# Service selector switch
apiVersion: v1
kind: Service
metadata:
  name: authz-server
spec:
  selector:
    app: authz-server
    version: blue  # Switch to 'green' for cutover
```

### 6.3 Canary Deployment (Istio)

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: authz-server
spec:
  hosts:
    - authz-server
  http:
    - match:
        - headers:
            x-canary:
              exact: "true"
      route:
        - destination:
            host: authz-server
            subset: canary
    - route:
        - destination:
            host: authz-server
            subset: stable
          weight: 95
        - destination:
            host: authz-server
            subset: canary
          weight: 5
---
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: authz-server
spec:
  host: authz-server
  subsets:
    - name: stable
      labels:
        version: stable
    - name: canary
      labels:
        version: canary
```

---

## 7. Service Mesh Integration

### 7.1 Istio Configuration

```yaml
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: authz-mtls
  namespace: authz-engine
spec:
  mtls:
    mode: STRICT
---
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: authz-server-policy
  namespace: authz-engine
spec:
  selector:
    matchLabels:
      app: authz-server
  rules:
    - from:
        - source:
            principals:
              - "cluster.local/ns/*/sa/*"
      to:
        - operation:
            methods: ["POST"]
            paths: ["/v1/check*", "/v1/explain"]
```

---

## 8. Network Policies

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: authz-server-policy
  namespace: authz-engine
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: authz-server
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # Allow from ingress controller
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
      ports:
        - protocol: TCP
          port: 3592
    # Allow from other services
    - from:
        - podSelector: {}
      ports:
        - protocol: TCP
          port: 3592
        - protocol: TCP
          port: 3593
    # Allow Prometheus scraping
    - from:
        - namespaceSelector:
            matchLabels:
              name: monitoring
      ports:
        - protocol: TCP
          port: 9090
  egress:
    # Allow DNS
    - to:
        - namespaceSelector: {}
      ports:
        - protocol: UDP
          port: 53
    # Allow Redis
    - to:
        - podSelector:
            matchLabels:
              app: redis
      ports:
        - protocol: TCP
          port: 6379
```

---

## 9. Operational Runbooks

### 9.1 Deployment Procedure

```bash
#!/bin/bash
# deploy.sh - Production deployment script

set -euo pipefail

VERSION=${1:?Version required}
NAMESPACE="authz-engine"

echo "=== Deploying AuthZ Engine v${VERSION} ==="

# 1. Pre-deployment checks
echo "Running pre-deployment checks..."
kubectl get pods -n $NAMESPACE -l app=authz-server --no-headers | wc -l
helm diff upgrade authz-engine ./charts/authz-engine \
  --namespace $NAMESPACE \
  --set server.image.tag=$VERSION

# 2. Create deployment snapshot
echo "Creating deployment snapshot..."
kubectl get deployment authz-server -n $NAMESPACE -o yaml > /tmp/authz-server-backup.yaml

# 3. Deploy
echo "Deploying..."
helm upgrade --install authz-engine ./charts/authz-engine \
  --namespace $NAMESPACE \
  --set server.image.tag=$VERSION \
  --wait \
  --timeout 5m

# 4. Verify deployment
echo "Verifying deployment..."
kubectl rollout status deployment/authz-server -n $NAMESPACE --timeout=300s

# 5. Health check
echo "Running health checks..."
kubectl exec -n $NAMESPACE deployment/authz-server -- curl -s http://localhost:3592/health/ready

echo "=== Deployment complete ==="
```

### 9.2 Rollback Procedure

```bash
#!/bin/bash
# rollback.sh - Emergency rollback script

set -euo pipefail

NAMESPACE="authz-engine"

echo "=== Rolling back AuthZ Engine ==="

# Option 1: Helm rollback
helm rollback authz-engine -n $NAMESPACE

# Option 2: Kubernetes rollback
# kubectl rollout undo deployment/authz-server -n $NAMESPACE

# Verify rollback
kubectl rollout status deployment/authz-server -n $NAMESPACE --timeout=300s

echo "=== Rollback complete ==="
```

### 9.3 Scaling Procedure

```bash
#!/bin/bash
# scale.sh - Manual scaling script

REPLICAS=${1:?Replica count required}
NAMESPACE="authz-engine"

echo "=== Scaling AuthZ Engine to ${REPLICAS} replicas ==="

kubectl scale deployment/authz-server -n $NAMESPACE --replicas=$REPLICAS

kubectl rollout status deployment/authz-server -n $NAMESPACE --timeout=300s

echo "=== Scaling complete ==="
```

---

## 10. Monitoring Integration

### 10.1 ServiceMonitor

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: authz-server
  namespace: authz-engine
  labels:
    release: prometheus
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: authz-server
  endpoints:
    - port: metrics
      interval: 15s
      scrapeTimeout: 10s
      path: /metrics
```

### 10.2 PrometheusRule

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: authz-server-alerts
  namespace: authz-engine
spec:
  groups:
    - name: authz-server
      rules:
        - alert: AuthzServerHighLatency
          expr: histogram_quantile(0.99, rate(authz_check_duration_seconds_bucket[5m])) > 0.1
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "AuthZ Server high latency"
            description: "P99 latency is {{ $value }}s"

        - alert: AuthzServerHighErrorRate
          expr: rate(authz_check_errors_total[5m]) / rate(authz_check_total[5m]) > 0.01
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "AuthZ Server high error rate"
            description: "Error rate is {{ $value | humanizePercentage }}"

        - alert: AuthzServerDown
          expr: up{job="authz-server"} == 0
          for: 1m
          labels:
            severity: critical
          annotations:
            summary: "AuthZ Server is down"
```

---

## 11. Testing Strategy

### 11.1 Deployment Tests

| Test | Description | Validation |
|------|-------------|------------|
| Image build | Docker build succeeds | Exit code 0 |
| Security scan | No critical CVEs | Trivy exit 0 |
| Helm lint | Chart is valid | helm lint passes |
| Dry run | K8s manifests valid | kubectl apply --dry-run |
| Smoke test | Service responds | HTTP 200 on /health |
| Load test | Handles expected load | P99 < 10ms |

### 11.2 Chaos Testing

```yaml
# Chaos Mesh - Pod failure
apiVersion: chaos-mesh.org/v1alpha1
kind: PodChaos
metadata:
  name: authz-pod-failure
spec:
  action: pod-failure
  mode: one
  selector:
    namespaces:
      - authz-engine
    labelSelectors:
      app.kubernetes.io/name: authz-server
  duration: "30s"
```

---

## 12. Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| Kubernetes | 1.28+ | Container orchestration |
| Helm | 3.12+ | Package management |
| Istio | 1.20+ | Service mesh (optional) |
| cert-manager | 1.13+ | TLS certificates |
| Prometheus | 2.47+ | Metrics collection |
| Redis | 7.2+ | Caching layer |

---

*Last Updated: 2025-11-23*
