# Week 1: Critical Fixes & Quick Wins - Specification-Driven Development (SDD)

**Status**: Ready for Implementation
**Date**: 2025-11-26
**Goal**: 80% → 85% Production Ready
**Timeline**: 5-7 days
**Estimated Effort**: 44 story points

---

## Executive Summary

Week 1 focuses on **quick wins** that address critical P0 blockers without major architectural changes. These fixes will:
- Resolve Redis cache test failures (reliability)
- Add basic authentication (security)
- Create production Helm chart (deployment)
- Implement structured audit logging (compliance)

**Impact**: Increases production readiness from 80% to 85% with minimal disruption.

---

## 1. Feature 1: Redis Cache Tests Fix

### 1.1 Current State Analysis

**Issue**: Redis cache tests failing in `internal/cache/redis_test.go`

**Symptoms**:
- Test failures on CI/CD
- Intermittent failures locally
- Possible connection issues or test isolation problems

**Hypothesis**:
1. Redis connection not properly cleaned up between tests
2. Test data not isolated (key collisions)
3. Redis not available in test environment
4. Race conditions in concurrent tests

### 1.2 Technical Specification

**Investigation Steps**:
```bash
# 1. Run tests with verbose output
go test -v ./internal/cache/redis_test.go

# 2. Check for race conditions
go test -race ./internal/cache/redis_test.go

# 3. Run with Redis debug logging
REDIS_DEBUG=1 go test -v ./internal/cache/redis_test.go
```

**Expected Fixes**:
- Add test cleanup (FLUSHDB after each test)
- Use unique key prefixes per test
- Add test timeouts
- Mock Redis for unit tests (use miniredis)

### 1.3 Implementation Plan

**File**: `internal/cache/redis_test.go`

**Changes Required**:
```go
// Add setup/teardown helpers
func setupRedisTest(t *testing.T) *RedisCache {
    t.Helper()

    // Use miniredis for unit tests
    s, err := miniredis.Run()
    require.NoError(t, err)

    t.Cleanup(func() {
        s.Close()
    })

    cache, err := NewRedisCache(RedisConfig{
        Addr: s.Addr(),
        // ... config
    })
    require.NoError(t, err)

    return cache
}

// Add key isolation
func testKey(t *testing.T, key string) string {
    return fmt.Sprintf("test:%s:%s", t.Name(), key)
}
```

### 1.4 Success Criteria

- [ ] All Redis tests passing (100%)
- [ ] No test flakiness (run 10 times successfully)
- [ ] No race conditions detected
- [ ] Test coverage maintained or improved
- [ ] Documentation updated (if needed)

### 1.5 Risk Assessment

**Risk**: Medium
- Potential for deeper architectural issues
- May require Redis version upgrade

**Mitigation**:
- Allocate 2 days (not 1)
- Use miniredis for isolation
- Add comprehensive logging
- Pair programming if complex

### 1.6 Test Plan (TDD)

**RED Phase** (Already Done):
- Tests already failing, no new tests needed

**GREEN Phase** (Implementation):
```bash
# 1. Add miniredis dependency
go get github.com/alicebob/miniredis/v2

# 2. Fix tests one by one
# 3. Verify each fix
go test -v -run TestRedis_Specific ./internal/cache/

# 4. Run all tests
go test -v ./internal/cache/redis_test.go

# 5. Check for races
go test -race ./internal/cache/redis_test.go
```

**REFACTOR Phase**:
- Extract common test helpers
- Add test documentation
- Update CI/CD if needed

**Estimated Effort**: 5 story points (1-2 days)

---

## 2. Feature 2: JWT Authentication Middleware

### 2.1 Requirements

**Functional Requirements**:
- FR1: Validate JWT tokens from Authorization header
- FR2: Support RS256 (public key) and HS256 (shared secret)
- FR3: Validate standard claims (exp, iat, iss, sub)
- FR4: Skip authentication for health/metrics endpoints
- FR5: Extract user/agent identity from claims
- FR6: Return 401 Unauthorized for invalid tokens

**Non-Functional Requirements**:
- NFR1: < 100µs overhead per request
- NFR2: Support key rotation without restart
- NFR3: Thread-safe concurrent access
- NFR4: Detailed error logging
- NFR5: Configurable via environment variables

### 2.2 Architecture Design

```
┌─────────────────────────────────────────────────────────────┐
│                    gRPC/HTTP Request                        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ Auth Middleware      │
              │                      │
              │ 1. Extract Token     │────── Authorization: Bearer <token>
              │ 2. Validate Token    │────── Check signature
              │ 3. Validate Claims   │────── exp, iat, iss, sub
              │ 4. Inject Identity   │────── context.WithValue()
              └──────────┬───────────┘
                         │
                    [Valid?]
                    │        │
                  Yes       No
                    │        │
                    ▼        ▼
           ┌────────────┐  ┌──────────────┐
           │   Allow    │  │ 401          │
           │   Continue │  │ Unauthorized │
           └─────┬──────┘  └──────────────┘
                 │
                 ▼
        ┌──────────────────┐
        │ Authorization     │
        │ Handler           │
        │ (Engine.Check)    │
        └───────────────────┘
```

### 2.3 API Specification

**File Structure**:
```
internal/server/middleware/
├── auth.go                 # Middleware implementation
├── auth_test.go           # Unit tests
└── auth_integration_test.go # Integration tests

internal/auth/
├── jwt.go                 # JWT validator
├── jwt_test.go           # Unit tests
├── claims.go             # Claims types
└── provider.go           # Key provider interface
```

**Core Interface**:
```go
package middleware

import (
    "context"
    "net/http"

    "google.golang.org/grpc"
)

// Authenticator validates tokens and extracts identity
type Authenticator interface {
    // Authenticate validates token and returns claims
    Authenticate(ctx context.Context, token string) (*auth.Claims, error)

    // GRPCUnaryInterceptor for gRPC
    GRPCUnaryInterceptor() grpc.UnaryServerInterceptor

    // HTTPMiddleware for HTTP
    HTTPMiddleware(next http.Handler) http.Handler
}

// Config for authentication middleware
type AuthConfig struct {
    // JWT configuration
    JWTSecret     string // HS256 shared secret
    JWTPublicKey  string // RS256 public key (file path or PEM)
    JWTIssuer     string // Expected issuer
    JWTAudience   string // Expected audience

    // Skip authentication for these paths
    SkipPaths []string // Default: ["/health", "/metrics"]

    // Key rotation support
    JWKSUrl       string // JWKS endpoint for key rotation
    JWKSCacheTTL  time.Duration
}

// NewAuthenticator creates new authenticator
func NewAuthenticator(cfg AuthConfig) (Authenticator, error)
```

**Claims Structure**:
```go
package auth

import (
    "time"

    "github.com/golang-jwt/jwt/v5"
)

// Claims represents JWT claims
type Claims struct {
    jwt.RegisteredClaims

    // Custom claims
    AgentID   string   `json:"agent_id,omitempty"`
    Roles     []string `json:"roles,omitempty"`
    Scopes    []string `json:"scopes,omitempty"`
    Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// Valid validates claims
func (c *Claims) Valid() error {
    // Validate expiration
    if c.ExpiresAt != nil && c.ExpiresAt.Time.Before(time.Now()) {
        return jwt.ErrTokenExpired
    }

    // Validate issued at
    if c.IssuedAt != nil && c.IssuedAt.Time.After(time.Now()) {
        return jwt.ErrTokenNotValidYet
    }

    // Custom validation
    // ... validate issuer, audience, etc.

    return nil
}
```

### 2.4 Configuration

**Environment Variables**:
```bash
# HS256 (shared secret)
AUTHZ_JWT_SECRET="your-256-bit-secret"
AUTHZ_JWT_ISSUER="authz-engine"
AUTHZ_JWT_AUDIENCE="authz-api"

# RS256 (public key)
AUTHZ_JWT_PUBLIC_KEY_FILE="/etc/authz/jwt-public.pem"
# Or
AUTHZ_JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n..."

# JWKS (key rotation)
AUTHZ_JWKS_URL="https://auth.example.com/.well-known/jwks.json"
AUTHZ_JWKS_CACHE_TTL="1h"

# Skip paths
AUTHZ_AUTH_SKIP_PATHS="/health,/metrics,/ready"
```

**Config File** (optional):
```yaml
# config/auth.yaml
jwt:
  secret: ""  # HS256
  public_key_file: ""  # RS256
  issuer: "authz-engine"
  audience: "authz-api"
  jwks:
    url: ""
    cache_ttl: 1h

skip_paths:
  - /health
  - /metrics
  - /ready
```

### 2.5 Security Considerations

**Token Validation**:
1. **Signature verification** - Always verify signature
2. **Expiration** - Reject expired tokens (exp claim)
3. **Not before** - Respect nbf claim
4. **Issuer** - Validate iss claim
5. **Audience** - Validate aud claim
6. **Algorithm** - Only allow RS256/HS256 (no "none")

**Key Management**:
- Store secrets in Kubernetes Secrets
- Never log tokens or secrets
- Support key rotation (JWKS)
- Use strong secrets (>256 bits for HS256)

**Error Handling**:
```go
// Don't leak information
if err := auth.Validate(token); err != nil {
    // Bad: return fmt.Errorf("invalid token: %v", err)
    // Good: return errors.New("invalid token")

    // Log details internally
    log.Warn("token validation failed",
        "error", err,
        "token_prefix", token[:10], // Don't log full token
    )
}
```

### 2.6 Implementation Steps

**Step 1: Create JWT validator** (internal/auth/jwt.go, ~200 LOC)
```go
package auth

import (
    "crypto/rsa"
    "fmt"

    "github.com/golang-jwt/jwt/v5"
)

type JWTValidator struct {
    // HS256
    secret []byte

    // RS256
    publicKey *rsa.PublicKey

    // JWKS
    jwks *JWKSProvider

    // Config
    issuer   string
    audience string
}

func NewJWTValidator(cfg JWTConfig) (*JWTValidator, error) {
    validator := &JWTValidator{
        issuer:   cfg.Issuer,
        audience: cfg.Audience,
    }

    // Load HS256 secret
    if cfg.Secret != "" {
        validator.secret = []byte(cfg.Secret)
    }

    // Load RS256 public key
    if cfg.PublicKey != "" {
        key, err := jwt.ParseRSAPublicKeyFromPEM([]byte(cfg.PublicKey))
        if err != nil {
            return nil, fmt.Errorf("parse public key: %w", err)
        }
        validator.publicKey = key
    }

    // Setup JWKS
    if cfg.JWKSUrl != "" {
        validator.jwks = NewJWKSProvider(cfg.JWKSUrl, cfg.JWKSCacheTTL)
    }

    return validator, nil
}

func (v *JWTValidator) Validate(tokenString string) (*Claims, error) {
    token, err := jwt.ParseWithClaims(tokenString, &Claims{}, v.keyFunc)
    if err != nil {
        return nil, err
    }

    if !token.Valid {
        return nil, jwt.ErrSignatureInvalid
    }

    claims, ok := token.Claims.(*Claims)
    if !ok {
        return nil, fmt.Errorf("invalid claims type")
    }

    // Validate custom claims
    if err := v.validateClaims(claims); err != nil {
        return nil, err
    }

    return claims, nil
}

func (v *JWTValidator) keyFunc(token *jwt.Token) (interface{}, error) {
    // Validate algorithm
    switch token.Method.Alg() {
    case "HS256":
        if v.secret == nil {
            return nil, fmt.Errorf("HS256 not configured")
        }
        return v.secret, nil
    case "RS256":
        if v.publicKey == nil && v.jwks == nil {
            return nil, fmt.Errorf("RS256 not configured")
        }
        if v.jwks != nil {
            // Get key from JWKS
            return v.jwks.GetKey(token.Header["kid"].(string))
        }
        return v.publicKey, nil
    default:
        return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
    }
}

func (v *JWTValidator) validateClaims(claims *Claims) error {
    // Validate issuer
    if v.issuer != "" && claims.Issuer != v.issuer {
        return fmt.Errorf("invalid issuer")
    }

    // Validate audience
    if v.audience != "" {
        found := false
        for _, aud := range claims.Audience {
            if aud == v.audience {
                found = true
                break
            }
        }
        if !found {
            return fmt.Errorf("invalid audience")
        }
    }

    return nil
}
```

**Step 2: Create gRPC interceptor** (internal/server/middleware/auth.go, ~150 LOC)
```go
package middleware

import (
    "context"
    "strings"

    "google.golang.org/grpc"
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/metadata"
    "google.golang.org/grpc/status"
)

func (a *authenticator) GRPCUnaryInterceptor() grpc.UnaryServerInterceptor {
    return func(
        ctx context.Context,
        req interface{},
        info *grpc.UnaryServerInfo,
        handler grpc.UnaryHandler,
    ) (interface{}, error) {
        // Skip authentication for certain methods
        if a.shouldSkip(info.FullMethod) {
            return handler(ctx, req)
        }

        // Extract token from metadata
        token, err := a.extractTokenFromGRPC(ctx)
        if err != nil {
            return nil, status.Error(codes.Unauthenticated, "missing or invalid token")
        }

        // Validate token
        claims, err := a.validator.Validate(token)
        if err != nil {
            return nil, status.Error(codes.Unauthenticated, "invalid token")
        }

        // Inject claims into context
        ctx = withClaims(ctx, claims)

        // Continue
        return handler(ctx, req)
    }
}

func (a *authenticator) extractTokenFromGRPC(ctx context.Context) (string, error) {
    md, ok := metadata.FromIncomingContext(ctx)
    if !ok {
        return "", fmt.Errorf("missing metadata")
    }

    values := md.Get("authorization")
    if len(values) == 0 {
        return "", fmt.Errorf("missing authorization header")
    }

    // Format: "Bearer <token>"
    parts := strings.SplitN(values[0], " ", 2)
    if len(parts) != 2 || parts[0] != "Bearer" {
        return "", fmt.Errorf("invalid authorization format")
    }

    return parts[1], nil
}
```

**Step 3: Create HTTP middleware** (~100 LOC)
**Step 4: Add tests** (~300 LOC)
**Step 5: Update server initialization** (~50 LOC)
**Step 6: Documentation** (~100 LOC README)

### 2.7 Test Plan (TDD)

**Unit Tests** (RED phase):
```go
func TestJWTValidator_ValidateHS256(t *testing.T) {
    validator := NewJWTValidator(JWTConfig{
        Secret: "your-256-bit-secret",
        Issuer: "authz-engine",
    })

    tests := []struct {
        name    string
        token   string
        wantErr bool
    }{
        {
            name: "valid token",
            token: generateTestTokenHS256(t, &Claims{
                RegisteredClaims: jwt.RegisteredClaims{
                    Issuer: "authz-engine",
                    ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
                },
            }),
            wantErr: false,
        },
        {
            name: "expired token",
            token: generateTestTokenHS256(t, &Claims{
                RegisteredClaims: jwt.RegisteredClaims{
                    Issuer: "authz-engine",
                    ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Hour)),
                },
            }),
            wantErr: true,
        },
        // ... more test cases
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            claims, err := validator.Validate(tt.token)
            if (err != nil) != tt.wantErr {
                t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
            }
            if !tt.wantErr && claims == nil {
                t.Error("expected claims, got nil")
            }
        })
    }
}
```

**Integration Tests**:
- Full gRPC request with auth
- HTTP request with auth
- Skip paths validation
- Key rotation test (JWKS)

**Estimated Effort**: 13 story points (3-5 days)

---

## 3. Feature 3: Production Helm Chart

### 3.1 Chart Structure

```
deploy/kubernetes/helm/authz-engine/
├── Chart.yaml                  # Chart metadata
├── values.yaml                 # Default values
├── values-production.yaml      # Production overrides
├── templates/
│   ├── _helpers.tpl           # Template helpers
│   ├── deployment.yaml        # Deployment spec
│   ├── service.yaml           # Service spec
│   ├── configmap.yaml         # Configuration
│   ├── secret.yaml            # Secrets
│   ├── serviceaccount.yaml    # RBAC
│   ├── hpa.yaml               # HorizontalPodAutoscaler
│   ├── pdb.yaml               # PodDisruptionBudget
│   ├── ingress.yaml           # Ingress (optional)
│   ├── servicemonitor.yaml    # Prometheus ServiceMonitor
│   └── NOTES.txt              # Post-install notes
├── tests/
│   └── test-connection.yaml   # Helm test
└── README.md                   # Usage documentation
```

### 3.2 Values Configuration

**values.yaml** (complete default configuration):
```yaml
# Replica configuration
replicaCount: 3

# Image configuration
image:
  repository: authz-engine/go-core
  pullPolicy: IfNotPresent
  tag: "" # Defaults to chart appVersion

imagePullSecrets: []

# Service account
serviceAccount:
  create: true
  annotations: {}
  name: ""

# Pod annotations
podAnnotations:
  prometheus.io/scrape: "true"
  prometheus.io/port: "9090"
  prometheus.io/path: "/metrics"

# Pod security context
podSecurityContext:
  runAsNonRoot: true
  runAsUser: 1000
  fsGroup: 1000

# Container security context
securityContext:
  allowPrivilegeEscalation: false
  capabilities:
    drop:
    - ALL
  readOnlyRootFilesystem: true

# Service configuration
service:
  type: ClusterIP
  ports:
    grpc: 8080
    http: 8081
    metrics: 9090
  annotations: {}

# Resource limits
resources:
  limits:
    cpu: 2000m
    memory: 2Gi
  requests:
    cpu: 1000m
    memory: 1Gi

# Autoscaling
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70
  targetMemoryUtilizationPercentage: 80

# Health probes
livenessProbe:
  httpGet:
    path: /health/live
    port: http
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health/ready
    port: http
  initialDelaySeconds: 10
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 3

startupProbe:
  httpGet:
    path: /health/startup
    port: http
  initialDelaySeconds: 0
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 30

# Node selection
nodeSelector: {}
tolerations: []
affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
    - weight: 100
      podAffinityTerm:
        labelSelector:
          matchExpressions:
          - key: app.kubernetes.io/name
            operator: In
            values:
            - authz-engine
        topologyKey: kubernetes.io/hostname

# Pod Disruption Budget
podDisruptionBudget:
  enabled: true
  minAvailable: 1

# Ingress
ingress:
  enabled: false
  className: "nginx"
  annotations: {}
  hosts:
    - host: authz.example.com
      paths:
        - path: /
          pathType: Prefix
  tls: []

# Configuration
config:
  logLevel: info
  logFormat: json

  # Cache configuration
  cache:
    enabled: true
    size: 100000
    ttl: 300s

  # Metrics
  metrics:
    enabled: true
    port: 9090

  # JWT Authentication
  jwt:
    enabled: true
    issuer: "authz-engine"
    audience: "authz-api"
    # Secret reference
    secretName: authz-jwt-secret
    secretKey: jwt-secret

  # Redis (optional)
  redis:
    enabled: false
    addr: "redis:6379"
    password: ""
    db: 0

# Secrets (should be set via values-production.yaml or --set)
secrets:
  jwtSecret: ""  # HS256 secret
  jwtPublicKey: ""  # RS256 public key (PEM format)
  redisPassword: ""

# Persistence (for policies)
persistence:
  enabled: true
  storageClass: ""
  accessMode: ReadWriteOnce
  size: 10Gi
  mountPath: /policies

# ServiceMonitor for Prometheus Operator
serviceMonitor:
  enabled: false
  interval: 30s
  scrapeTimeout: 10s
```

### 3.3 Template Specifications

**templates/deployment.yaml** (key sections):
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "authz-engine.fullname" . }}
  labels:
    {{- include "authz-engine.labels" . | nindent 4 }}
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "authz-engine.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      annotations:
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
        checksum/secret: {{ include (print $.Template.BasePath "/secret.yaml") . | sha256sum }}
        {{- with .Values.podAnnotations }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
      labels:
        {{- include "authz-engine.selectorLabels" . | nindent 8 }}
    spec:
      {{- with .Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      serviceAccountName: {{ include "authz-engine.serviceAccountName" . }}
      securityContext:
        {{- toYaml .Values.podSecurityContext | nindent 8 }}
      containers:
      - name: {{ .Chart.Name }}
        securityContext:
          {{- toYaml .Values.securityContext | nindent 12 }}
        image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
        imagePullPolicy: {{ .Values.image.pullPolicy }}
        ports:
        - name: grpc
          containerPort: {{ .Values.service.ports.grpc }}
          protocol: TCP
        - name: http
          containerPort: {{ .Values.service.ports.http }}
          protocol: TCP
        - name: metrics
          containerPort: {{ .Values.service.ports.metrics }}
          protocol: TCP
        livenessProbe:
          {{- toYaml .Values.livenessProbe | nindent 12 }}
        readinessProbe:
          {{- toYaml .Values.readinessProbe | nindent 12 }}
        startupProbe:
          {{- toYaml .Values.startupProbe | nindent 12 }}
        resources:
          {{- toYaml .Values.resources | nindent 12 }}
        env:
        - name: LOG_LEVEL
          value: {{ .Values.config.logLevel }}
        - name: LOG_FORMAT
          value: {{ .Values.config.logFormat }}
        - name: AUTHZ_JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: {{ include "authz-engine.fullname" . }}-secret
              key: jwt-secret
        volumeMounts:
        - name: policies
          mountPath: {{ .Values.persistence.mountPath }}
        - name: tmp
          mountPath: /tmp
      volumes:
      - name: policies
        {{- if .Values.persistence.enabled }}
        persistentVolumeClaim:
          claimName: {{ include "authz-engine.fullname" . }}-policies
        {{- else }}
        emptyDir: {}
        {{- end }}
      - name: tmp
        emptyDir: {}
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
```

### 3.4 Best Practices

**Security Hardening**:
- Run as non-root user (UID 1000)
- Drop all capabilities
- Read-only root filesystem
- No privilege escalation
- Network policies (optional)

**Resource Management**:
- Set requests = limits for predictable performance
- Configure HPA for auto-scaling
- Set PDB to maintain availability during updates
- Use pod anti-affinity to spread pods

**HA Configuration**:
- Minimum 2 replicas (3 for production)
- Pod anti-affinity across nodes
- PodDisruptionBudget (minAvailable: 1)
- Rolling update strategy (maxUnavailable: 1)

**Monitoring Integration**:
- Prometheus annotations on pods
- ServiceMonitor for Prometheus Operator
- Health check endpoints
- Metrics endpoint exposed

### 3.5 Installation Guide

**Install from local chart**:
```bash
# Create namespace
kubectl create namespace authz

# Install with default values
helm install authz-engine ./deploy/kubernetes/helm/authz-engine \
  --namespace authz \
  --create-namespace

# Install with production values
helm install authz-engine ./deploy/kubernetes/helm/authz-engine \
  --namespace authz \
  --values ./deploy/kubernetes/helm/authz-engine/values-production.yaml \
  --set secrets.jwtSecret="your-secret-here"

# Verify installation
kubectl get pods -n authz
kubectl get svc -n authz

# Check logs
kubectl logs -n authz -l app.kubernetes.io/name=authz-engine

# Test connectivity
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- \
  curl http://authz-engine.authz.svc.cluster.local:8081/health
```

**Upgrade**:
```bash
# Upgrade to new version
helm upgrade authz-engine ./deploy/kubernetes/helm/authz-engine \
  --namespace authz \
  --reuse-values \
  --set image.tag=v1.2.0

# Rollback if needed
helm rollback authz-engine --namespace authz
```

**Uninstall**:
```bash
helm uninstall authz-engine --namespace authz
```

### 3.6 Test Plan

**Helm Lint**:
```bash
helm lint ./deploy/kubernetes/helm/authz-engine
```

**Helm Test** (templates/tests/test-connection.yaml):
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: "{{ include "authz-engine.fullname" . }}-test-connection"
  labels:
    {{- include "authz-engine.labels" . | nindent 4 }}
  annotations:
    "helm.sh/hook": test
spec:
  containers:
  - name: wget
    image: busybox
    command: ['wget']
    args: ['{{ include "authz-engine.fullname" . }}:{{ .Values.service.ports.http }}/health']
  restartPolicy: Never
```

**Run tests**:
```bash
helm test authz-engine --namespace authz
```

**Integration Tests**:
1. Deploy to test cluster
2. Verify all pods running
3. Test health endpoints
4. Test authorization API
5. Test metrics endpoint
6. Test autoscaling (load test)
7. Test pod disruption (kill pod, verify recovery)
8. Test rolling update

**Estimated Effort**: 8 story points (2-3 days)

---

## 4. Feature 4: Structured Audit Logging

### 4.1 Requirements

**Functional Requirements**:
- FR1: Log all authorization decisions (allow/deny)
- FR2: Log policy changes (create/update/delete)
- FR3: Log agent operations (register/revoke)
- FR4: JSON structured format
- FR5: Searchable fields (principal, resource, action, decision)
- FR6: Trace ID for request correlation

**Non-Functional Requirements**:
- NFR1: < 100µs overhead per log
- NFR2: Async logging (non-blocking)
- NFR3: Configurable log levels
- NFR4: Support stdout, file, syslog
- NFR5: Log rotation for file output
- NFR6: SOC2/GDPR/HIPAA compliant

**Compliance Requirements**:
- **SOC2**: Immutable audit trail, access logs
- **GDPR**: Data subject identification, consent tracking
- **HIPAA**: Access logs, audit trail, encryption

### 4.2 Log Schema

**Authorization Check Event**:
```json
{
  "timestamp": "2025-11-26T10:30:45.123Z",
  "event_type": "authz_check",
  "event_id": "evt-abc123",
  "request_id": "req-xyz789",
  "trace_id": "trace-001",
  "span_id": "span-001",

  "principal": {
    "id": "user:alice",
    "roles": ["viewer", "editor"],
    "attributes": {
      "department": "engineering"
    }
  },

  "resource": {
    "kind": "document",
    "id": "doc-123",
    "attributes": {
      "owner": "user:bob"
    }
  },

  "action": "view",

  "decision": "allow",

  "policies": [
    {
      "id": "policy-viewer-doc",
      "version": "v1",
      "matched": true
    }
  ],

  "performance": {
    "duration_us": 1750,
    "cache_hit": true
  },

  "metadata": {
    "source_ip": "10.0.1.45",
    "user_agent": "curl/7.68.0",
    "api_version": "v1"
  }
}
```

**Policy Change Event**:
```json
{
  "timestamp": "2025-11-26T10:31:00.456Z",
  "event_type": "policy_change",
  "event_id": "evt-def456",
  "request_id": "req-aaa111",

  "operation": "update",
  "policy_id": "policy-viewer-doc",
  "policy_version": "v2",

  "actor": {
    "id": "user:admin",
    "roles": ["admin"]
  },

  "changes": {
    "before": {"version": "v1", "...": "..."},
    "after": {"version": "v2", "...": "..."}
  },

  "metadata": {
    "source_ip": "10.0.1.50",
    "user_agent": "kubectl/v1.25"
  }
}
```

**Agent Action Event**:
```json
{
  "timestamp": "2025-11-26T10:32:00.789Z",
  "event_type": "agent_action",
  "event_id": "evt-ghi789",
  "request_id": "req-bbb222",

  "operation": "register",
  "agent_id": "agent-avatar-001",
  "agent_type": "service",

  "actor": {
    "id": "user:admin",
    "roles": ["admin"]
  },

  "metadata": {
    "source_ip": "10.0.1.60",
    "user_agent": "authz-cli/v1.0"
  }
}
```

### 4.3 Architecture

```
┌────────────────────────────────────────────────────────────┐
│                    Application Layer                        │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ Engine.Check │  │ PolicyStore  │  │ AgentService    │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬────────┘  │
│         │                  │                    │           │
└─────────┼──────────────────┼────────────────────┼───────────┘
          │                  │                    │
          ▼                  ▼                    ▼
     ┌────────────────────────────────────────────────┐
     │           Audit Logger Interface               │
     │                                                 │
     │  LogCheck(req, resp, duration)                │
     │  LogPolicyChange(change)                      │
     │  LogAgentAction(action)                       │
     └────────────┬───────────────────────────────────┘
                  │
                  ▼
     ┌────────────────────────────────┐
     │     Async Logger               │
     │                                 │
     │  Buffer: ring buffer (1000)    │
     │  Goroutine: background writer  │
     │  Overflow: drop oldest         │
     └────────────┬────────────────────┘
                  │
          ┌───────┴───────┬────────────┐
          ▼               ▼            ▼
    ┌─────────┐    ┌──────────┐  ┌─────────┐
    │ Stdout  │    │   File   │  │ Syslog  │
    │ (JSON)  │    │ (Rotate) │  │ (RFC5424│
    └─────────┘    └──────────┘  └─────────┘
```

### 4.4 Performance Considerations

**Async Logging**:
- Ring buffer (1000 entries)
- Background goroutine for writes
- Non-blocking writes (drop on overflow)
- Batch writes (every 100ms or 100 entries)

**Performance Target**: < 100µs overhead
```
Without audit: 1.7µs authorization
With audit:    < 1.8µs authorization (< 100ns overhead)
```

**Benchmarking**:
```bash
# Measure overhead
go test -bench=BenchmarkCheck_WithAudit -benchmem
go test -bench=BenchmarkCheck_WithoutAudit -benchmem

# Compare
benchstat without.txt with.txt
```

### 4.5 Implementation

**File Structure**:
```
internal/audit/
├── logger.go              # Interface + factory
├── async_logger.go        # Async implementation
├── stdout_writer.go       # Stdout writer
├── file_writer.go         # File writer with rotation
├── syslog_writer.go       # Syslog writer
├── event.go               # Event types
└── logger_test.go         # Tests
```

**Interface**:
```go
package audit

import (
    "context"
    "time"

    "github.com/authz-engine/go-core/pkg/types"
)

// Logger logs audit events
type Logger interface {
    // LogCheck logs authorization check
    LogCheck(ctx context.Context, req *types.CheckRequest, resp *types.CheckResponse, duration time.Duration)

    // LogPolicyChange logs policy changes
    LogPolicyChange(ctx context.Context, change *PolicyChange)

    // LogAgentAction logs agent operations
    LogAgentAction(ctx context.Context, action *AgentAction)

    // Flush flushes pending logs
    Flush() error

    // Close closes logger
    Close() error
}

// Config for audit logger
type Config struct {
    // Output type: stdout, file, syslog
    Type string

    // For file output
    FilePath       string
    FileMaxSize    int // MB
    FileMaxAge     int // Days
    FileMaxBackups int

    // For syslog
    SyslogAddr     string
    SyslogProtocol string // tcp, udp, unix

    // Performance
    BufferSize int // Ring buffer size (default: 1000)
    FlushInterval time.Duration // Batch interval (default: 100ms)
}

// PolicyChange represents policy change event
type PolicyChange struct {
    Operation    string // create, update, delete
    PolicyID     string
    PolicyVersion string
    ActorID      string
    Changes      interface{} // Before/after
}

// AgentAction represents agent operation event
type AgentAction struct {
    Operation string // register, revoke, update
    AgentID   string
    AgentType string
    ActorID   string
}

// NewLogger creates new audit logger
func NewLogger(cfg Config) (Logger, error)
```

**Async Implementation**:
```go
package audit

import (
    "context"
    "encoding/json"
    "sync"
    "time"
)

type asyncLogger struct {
    writer Writer

    // Ring buffer
    buffer   []Event
    size     int
    head     int
    tail     int
    mu       sync.Mutex

    // Background writer
    flushCh  chan struct{}
    doneCh   chan struct{}
    interval time.Duration
}

func newAsyncLogger(writer Writer, cfg Config) *asyncLogger {
    l := &asyncLogger{
        writer:   writer,
        buffer:   make([]Event, cfg.BufferSize),
        size:     cfg.BufferSize,
        flushCh:  make(chan struct{}, 1),
        doneCh:   make(chan struct{}),
        interval: cfg.FlushInterval,
    }

    // Start background writer
    go l.run()

    return l
}

func (l *asyncLogger) LogCheck(ctx context.Context, req *types.CheckRequest, resp *types.CheckResponse, duration time.Duration) {
    event := Event{
        Timestamp:  time.Now(),
        EventType:  "authz_check",
        EventID:    generateEventID(),
        RequestID:  getRequestID(ctx),
        TraceID:    getTraceID(ctx),
        Principal:  req.Principal,
        Resource:   req.Resource,
        Action:     req.Actions[0], // First action
        Decision:   resp.Decision.String(),
        Duration:   duration,
        // ... more fields
    }

    l.enqueue(event)
}

func (l *asyncLogger) enqueue(event Event) {
    l.mu.Lock()
    defer l.mu.Unlock()

    // Add to ring buffer
    l.buffer[l.tail] = event
    l.tail = (l.tail + 1) % l.size

    // Drop oldest if buffer full
    if l.tail == l.head {
        l.head = (l.head + 1) % l.size
    }

    // Trigger flush
    select {
    case l.flushCh <- struct{}{}:
    default:
    }
}

func (l *asyncLogger) run() {
    ticker := time.NewTicker(l.interval)
    defer ticker.Stop()

    for {
        select {
        case <-ticker.C:
            l.flush()
        case <-l.flushCh:
            l.flush()
        case <-l.doneCh:
            l.flush() // Final flush
            return
        }
    }
}

func (l *asyncLogger) flush() error {
    l.mu.Lock()
    // Copy events from ring buffer
    events := l.copyEvents()
    l.mu.Unlock()

    if len(events) == 0 {
        return nil
    }

    // Write events
    for _, event := range events {
        if err := l.writer.Write(event); err != nil {
            // Log error but don't fail
            // TODO: metrics for failed writes
        }
    }

    return nil
}

func (l *asyncLogger) copyEvents() []Event {
    if l.head == l.tail {
        return nil
    }

    var events []Event
    i := l.head
    for i != l.tail {
        events = append(events, l.buffer[i])
        i = (i + 1) % l.size
    }

    // Clear buffer
    l.head = l.tail

    return events
}

func (l *asyncLogger) Close() error {
    close(l.doneCh)
    return l.writer.Close()
}
```

### 4.6 Test Plan

**Unit Tests**:
- Event serialization (JSON)
- Ring buffer overflow handling
- Async flush timing
- Writer implementations

**Performance Tests**:
```go
func BenchmarkAuditLogger_LogCheck(b *testing.B) {
    logger := newAsyncLogger(newStdoutWriter(), Config{
        BufferSize: 1000,
        FlushInterval: 100 * time.Millisecond,
    })
    defer logger.Close()

    req := &types.CheckRequest{
        Principal: types.Principal{ID: "user:alice"},
        Resource: types.Resource{Kind: "document", ID: "doc-123"},
        Actions: []string{"view"},
    }
    resp := &types.CheckResponse{
        Decision: types.EFFECT_ALLOW,
    }

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        logger.LogCheck(context.Background(), req, resp, 1750*time.Microsecond)
    }
}

// Target: < 100ns per operation (non-blocking enqueue)
```

**Integration Tests**:
- Full authorization with audit logging
- Policy change logging
- Agent action logging
- Log rotation (file writer)
- Syslog connectivity

**Compliance Tests**:
- Verify all required fields present
- Verify immutability (no log modification)
- Verify retention (file rotation settings)

**Estimated Effort**: 13 story points (3-5 days)

---

## 5. Integration & Deployment

### 5.1 Integration Testing

**End-to-End Scenarios**:

1. **Authenticated Authorization Check with Audit**:
```bash
# Generate JWT token
TOKEN=$(generate-test-token.sh)

# Make authorization check
grpcurl -H "Authorization: Bearer $TOKEN" \
  localhost:8080 authz.v1.AuthzService/Check \
  -d '{
    "principal": {"id": "user:alice", "roles": ["viewer"]},
    "resource": {"kind": "document", "id": "doc-123"},
    "actions": ["view"]
  }'

# Verify audit log
kubectl logs -n authz -l app=authz-engine | \
  jq 'select(.event_type == "authz_check")'
```

2. **Helm Deployment with Monitoring**:
```bash
# Install with all features enabled
helm install authz-engine ./deploy/kubernetes/helm/authz-engine \
  --namespace authz \
  --set jwt.enabled=true \
  --set audit.enabled=true \
  --set metrics.enabled=true

# Verify pods running
kubectl get pods -n authz

# Test health
kubectl run -it --rm test --image=curlimages/curl --restart=Never -- \
  curl http://authz-engine:8081/health

# Test metrics
kubectl port-forward -n authz svc/authz-engine 9090:9090
curl localhost:9090/metrics
```

3. **Redis Cache Integration**:
```bash
# Deploy Redis
helm install redis bitnami/redis --namespace authz

# Configure authz-engine to use Redis
helm upgrade authz-engine ./deploy/kubernetes/helm/authz-engine \
  --namespace authz \
  --set redis.enabled=true \
  --set redis.addr=redis-master:6379

# Verify cache working
# (check metrics: authz_cache_hits_total)
```

### 5.2 Deployment Plan

**Week 1 Rollout**:

**Day 1-2: Redis Fix**
- Fix tests locally
- Run full test suite
- Merge PR

**Day 2-4: JWT Middleware**
- Implement JWT validator
- Add gRPC/HTTP interceptors
- Write tests
- Code review
- Merge PR

**Day 3-5: Helm Chart**
- Create chart structure
- Write templates
- Test installation
- Documentation
- Merge PR

**Day 4-6: Audit Logging**
- Implement async logger
- Add integration points
- Performance testing
- Merge PR

**Day 5-7: Integration & Testing**
- E2E testing
- Staging deployment
- Performance validation
- Documentation update

### 5.3 Monitoring

**Key Metrics to Watch**:

1. **Authentication**:
   - `authz_auth_requests_total{result="success|failure"}`
   - `authz_auth_duration_ms`
   - `authz_auth_errors_total{type="..."}`

2. **Audit Logging**:
   - `authz_audit_events_total{type="..."}`
   - `authz_audit_buffer_utilization`
   - `authz_audit_drops_total`
   - `authz_audit_flush_duration_ms`

3. **Application**:
   - Authorization latency (should remain < 10µs)
   - Error rate (should remain < 1%)
   - Cache hit rate (should remain > 80%)

4. **Kubernetes**:
   - Pod restarts
   - Memory usage
   - CPU usage
   - Ready replicas

**Alerts**:
- High authentication failure rate (> 5%)
- Audit buffer overflow (> 80%)
- Authorization latency spike (> 10ms p99)
- Pod not ready for > 5 minutes

**Dashboards**:
- Update Grafana dashboards with new metrics
- Add authentication panel
- Add audit logging panel

---

## 6. Timeline & Effort

### 6.1 Detailed Timeline

| Day | Task | Story Points | Assignee | Status |
|-----|------|--------------|----------|--------|
| **1** | Redis cache fix | 5 SP | TBD | 🔴 Not Started |
| **2** | JWT validator implementation | 5 SP | TBD | 🔴 Not Started |
| **2-3** | Helm chart structure | 3 SP | TBD | 🔴 Not Started |
| **3** | JWT middleware (gRPC/HTTP) | 4 SP | TBD | 🔴 Not Started |
| **3-4** | Audit logger core | 5 SP | TBD | 🔴 Not Started |
| **4** | JWT tests | 4 SP | TBD | 🔴 Not Started |
| **4-5** | Helm templates | 5 SP | TBD | 🔴 Not Started |
| **5** | Audit integration | 4 SP | TBD | 🔴 Not Started |
| **5-6** | Audit tests | 4 SP | TBD | 🔴 Not Started |
| **6-7** | Integration testing | 5 SP | TBD | 🔴 Not Started |
| **7** | Documentation | - | TBD | 🔴 Not Started |

### 6.2 Story Points Summary

| Feature | Story Points | % of Total |
|---------|-------------|------------|
| Redis Cache Fix | 5 SP | 11% |
| JWT Authentication | 13 SP | 30% |
| Helm Chart | 8 SP | 18% |
| Audit Logging | 13 SP | 30% |
| Integration | 5 SP | 11% |
| **Total** | **44 SP** | **100%** |

### 6.3 Critical Path

```
Day 1: Redis Fix (blocker for all)
         ↓
Day 2-4: [JWT Middleware] [Helm Chart] (parallel)
         ↓                 ↓
Day 4-6: [Audit Logging]  [Helm Testing]
         ↓                 ↓
Day 5-7: Integration Testing & Documentation
         ↓
       Done ✅
```

**Parallelization Opportunities**:
- JWT middleware + Helm chart (Days 2-4)
- JWT tests + Helm templates (Day 4)
- Audit integration + Helm testing (Day 5)

**With 2 Engineers**: 5-6 days
**With 1 Engineer**: 7-8 days

---

## 7. Success Criteria

### 7.1 Week 1 Complete When:

**Technical**:
- [ ] All Redis cache tests passing (100%)
- [ ] JWT authentication middleware operational
  - [ ] RS256 and HS256 supported
  - [ ] gRPC interceptor working
  - [ ] HTTP middleware working
  - [ ] Tests passing (unit + integration)
- [ ] Helm chart functional
  - [ ] `helm install` successful
  - [ ] All pods healthy
  - [ ] Service accessible
  - [ ] `helm test` passing
- [ ] Structured audit logging implemented
  - [ ] Authorization checks logged
  - [ ] JSON format valid
  - [ ] Async logging working
  - [ ] < 100µs overhead

**Quality**:
- [ ] All tests passing (unit + integration + E2E)
- [ ] Code reviewed and merged
- [ ] Documentation updated
- [ ] No regressions in existing features

**Production Readiness**:
- [ ] 85% production ready (up from 80%)
- [ ] Authorization latency < 10µs (maintained)
- [ ] Cache hit rate > 80% (maintained)
- [ ] No security vulnerabilities

### 7.2 Acceptance Criteria

**Redis Cache**:
```bash
✅ go test -v ./internal/cache/redis_test.go
✅ go test -race ./internal/cache/redis_test.go
✅ Run 10 times: for i in {1..10}; do go test ./internal/cache/redis_test.go || exit 1; done
```

**JWT Authentication**:
```bash
✅ Valid RS256 token → 200 OK
✅ Valid HS256 token → 200 OK
✅ Expired token → 401 Unauthorized
✅ Invalid signature → 401 Unauthorized
✅ /health endpoint → 200 OK (no auth)
✅ /metrics endpoint → 200 OK (no auth)
```

**Helm Chart**:
```bash
✅ helm lint ./deploy/kubernetes/helm/authz-engine
✅ helm install test ./deploy/kubernetes/helm/authz-engine --dry-run
✅ helm install test ./deploy/kubernetes/helm/authz-engine
✅ kubectl get pods -n test → All Running
✅ helm test test
✅ helm uninstall test
```

**Audit Logging**:
```bash
✅ Authorization check → Audit log entry
✅ JSON format valid: cat audit.log | jq .
✅ All required fields present
✅ Performance < 100µs overhead
```

---

## 8. Risk Assessment

### 8.1 Risks & Mitigation

| Risk | Probability | Impact | Severity | Mitigation |
|------|-------------|--------|----------|------------|
| **Redis fix more complex than expected** | Low | Medium | **Medium** | - Allocate 2 days instead of 1<br>- Use miniredis for isolation<br>- Pair programming |
| **JWT implementation has security flaw** | Medium | High | **High** | - Use battle-tested library (golang-jwt)<br>- Security code review<br>- Follow OWASP guidelines<br>- Pen testing |
| **Helm chart bugs in production** | Low | Medium | **Medium** | - Extensive testing (lint, dry-run, test)<br>- Staging deployment first<br>- Rollback plan |
| **Audit log overhead impacts performance** | Medium | Medium | **Medium** | - Async logging with ring buffer<br>- Performance benchmarks<br>- Load testing |
| **Integration issues between components** | Medium | Medium | **Medium** | - E2E testing<br>- Staging environment<br>- Incremental rollout |
| **Timeline slippage** | Medium | Low | **Low** | - Buffer in estimates (44 SP for 5-7 days)<br>- Parallelization<br>- Daily standups |

### 8.2 Contingency Plans

**If Redis fix takes > 2 days**:
- Continue with other features (JWT, Helm)
- Consider Redis integration optional for Week 1
- Move to Week 2 if needed

**If JWT has security issues**:
- Bring in security expert for review
- Consider using existing auth gateway (Istio, Envoy)
- Add rate limiting as additional protection

**If Helm chart has issues**:
- Use simple Kubernetes manifests as fallback
- Deploy to staging first
- Iterate on Helm chart in Week 2

**If audit logging has performance issues**:
- Increase buffer size
- Reduce flush frequency
- Consider sampling (log 1% of checks)

---

## 9. Dependencies

### 9.1 Technical Dependencies

**Go Libraries**:
```go
// JWT
github.com/golang-jwt/jwt/v5 v5.2.0

// Audit logging
go.uber.org/zap v1.26.0
github.com/natefinch/lumberjack v2.2.1 // Log rotation

// Redis testing
github.com/alicebob/miniredis/v2 v2.31.0

// Tracing (optional)
go.opentelemetry.io/otel v1.21.0
```

**Infrastructure**:
- Redis 7.0+ (for cache tests)
- Kubernetes 1.25+ (for Helm)
- Prometheus (for metrics)
- Log aggregator (for audit logs)

### 9.2 Team Dependencies

**Required Skills**:
- Go programming (intermediate)
- JWT/OAuth knowledge (basic)
- Kubernetes/Helm (intermediate)
- Security best practices (basic)

**Optional Skills**:
- Cryptography (RSA, ECDSA)
- Compliance (SOC2, GDPR)
- Observability (Prometheus, Grafana)

---

## 10. References

### 10.1 Standards & Specifications

- **JWT**: RFC 7519 (JSON Web Token)
- **JWS**: RFC 7515 (JSON Web Signature)
- **JWK**: RFC 7517 (JSON Web Key)
- **OAuth 2.0**: RFC 6749
- **Syslog**: RFC 5424
- **OWASP**: Authentication Cheat Sheet

### 10.2 Libraries & Tools

- **golang-jwt**: https://github.com/golang-jwt/jwt
- **zap**: https://github.com/uber-go/zap
- **lumberjack**: https://github.com/natefinch/lumberjack
- **miniredis**: https://github.com/alicebob/miniredis
- **Helm**: https://helm.sh/docs/

### 10.3 Best Practices

- **Kubernetes Best Practices**: https://kubernetes.io/docs/concepts/configuration/overview/
- **Helm Chart Best Practices**: https://helm.sh/docs/chart_best_practices/
- **12-Factor App**: https://12factor.net/
- **OWASP Top 10**: https://owasp.org/www-project-top-ten/

---

## 11. Appendix

### 11.1 Example Commands

**Generate Test JWT Token** (for testing):
```bash
#!/bin/bash
# generate-test-token.sh

SECRET="your-256-bit-secret"

# HS256 token
TOKEN=$(curl -s -X POST http://localhost:8080/auth/token \
  -H "Content-Type: application/json" \
  -d '{
    "sub": "user:alice",
    "iss": "authz-engine",
    "aud": "authz-api",
    "exp": '$(date -d "+1 hour" +%s)',
    "iat": '$(date +%s)'
  }' | jq -r '.token')

echo $TOKEN
```

**Test Authorization with JWT**:
```bash
TOKEN=$(./generate-test-token.sh)

grpcurl -H "Authorization: Bearer $TOKEN" \
  localhost:8080 authz.v1.AuthzService/Check \
  -d '{
    "principal": {"id": "user:alice", "roles": ["viewer"]},
    "resource": {"kind": "document", "id": "doc-123"},
    "actions": ["view"]
  }'
```

### 11.2 Troubleshooting

**JWT Authentication Failures**:
```bash
# Check token is valid
echo $TOKEN | cut -d'.' -f2 | base64 -d | jq .

# Check server logs
kubectl logs -n authz -l app=authz-engine | grep "auth"

# Test with curl (HTTP)
curl -v -H "Authorization: Bearer $TOKEN" \
  http://localhost:8081/v1/check \
  -d '{"principal":{"id":"user:alice"},...}'
```

**Helm Installation Issues**:
```bash
# Debug rendering
helm template authz-engine ./deploy/kubernetes/helm/authz-engine \
  --debug > rendered.yaml

# Check events
kubectl get events -n authz --sort-by='.lastTimestamp'

# Check pod logs
kubectl logs -n authz <pod-name>
```

**Audit Logging Issues**:
```bash
# Check logs are being generated
kubectl exec -it -n authz <pod-name> -- \
  tail -f /var/log/audit.log

# Verify JSON format
kubectl exec -it -n authz <pod-name> -- \
  tail -1 /var/log/audit.log | jq .

# Check buffer utilization
curl localhost:9090/metrics | grep authz_audit_buffer
```

---

**Document Version**: 1.0
**Last Updated**: 2025-11-26
**Status**: Ready for Implementation
**Next Steps**: Start implementation with Redis cache fix (Day 1)
