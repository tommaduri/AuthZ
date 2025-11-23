# Go Core Software Design Document

**Version**: 1.0.0
**Date**: 2024-11-23
**Status**: DRAFT
**Related ADR**: ADR-008 (Hybrid Go/TypeScript Architecture)

---

## 1. Overview

### 1.1 Purpose

The Go Core provides a high-performance authorization engine that handles the critical path of policy evaluation. It serves as the backend for the TypeScript agentic layer via gRPC.

### 1.2 Goals

- **Performance**: <1ms P99 latency for policy evaluation
- **Throughput**: 100,000+ authorization checks per second per instance
- **Correctness**: Native CEL implementation (google/cel-go)
- **Scalability**: Horizontal scaling with distributed consensus
- **Reliability**: Zero-downtime policy reloads

### 1.3 Non-Goals

- UI/Admin dashboard (handled by TypeScript layer)
- ML/Neural pattern detection (handled by TypeScript layer)
- Complex agent orchestration (handled by TypeScript layer)

---

## 2. Architecture

### 2.1 Package Structure

```
go-core/
├── cmd/
│   ├── authz-server/          # Main gRPC server binary
│   │   └── main.go
│   └── authz-cli/             # CLI tool for testing/admin
│       └── main.go
├── internal/
│   ├── cel/                   # CEL engine wrapper
│   │   ├── engine.go          # CEL compilation and evaluation
│   │   ├── functions.go       # Custom CEL functions
│   │   ├── types.go           # CEL type adapters
│   │   └── engine_test.go
│   ├── engine/                # Decision engine
│   │   ├── engine.go          # Core decision logic
│   │   ├── parallel.go        # Parallel policy evaluation
│   │   ├── result.go          # Decision results
│   │   └── engine_test.go
│   ├── policy/                # Policy management
│   │   ├── store.go           # Policy storage interface
│   │   ├── memory.go          # In-memory store
│   │   ├── file.go            # File-based store
│   │   ├── loader.go          # Policy loader/parser
│   │   ├── index.go           # Policy indexing for fast lookup
│   │   └── store_test.go
│   ├── cache/                 # Caching layer
│   │   ├── cache.go           # Cache interface
│   │   ├── lru.go             # LRU cache implementation
│   │   ├── arc.go             # ARC cache implementation
│   │   └── cache_test.go
│   ├── consensus/             # Distributed consensus
│   │   ├── consensus.go       # Consensus interface
│   │   ├── raft.go            # Raft implementation
│   │   ├── pbft.go            # PBFT implementation
│   │   └── consensus_test.go
│   └── server/                # gRPC server
│       ├── server.go          # gRPC server implementation
│       ├── interceptors.go    # Logging, metrics, auth interceptors
│       ├── health.go          # Health check service
│       └── server_test.go
├── pkg/                       # Public packages (for embedding)
│   ├── authz/                 # Main authorization API
│   │   ├── authz.go           # Public API
│   │   ├── options.go         # Configuration options
│   │   └── authz_test.go
│   └── types/                 # Shared types
│       ├── principal.go
│       ├── resource.go
│       ├── policy.go
│       └── decision.go
├── api/                       # API definitions
│   └── proto/
│       ├── authz/v1/
│       │   ├── authz.proto    # Main authorization service
│       │   ├── policy.proto   # Policy management service
│       │   └── health.proto   # Health check service
│       └── buf.yaml           # Buf configuration
├── configs/                   # Configuration files
│   ├── config.yaml            # Default configuration
│   └── config.example.yaml    # Example configuration
├── scripts/                   # Build and deployment scripts
│   ├── build.sh
│   ├── test.sh
│   └── proto-gen.sh
├── go.mod
├── go.sum
├── Makefile
└── README.md
```

### 2.2 Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           GO CORE                                       │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      gRPC Server                                 │   │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌─────────────┐   │   │
│  │  │  Check    │  │  Batch    │  │  Stream   │  │   Policy    │   │   │
│  │  │  Handler  │  │  Handler  │  │  Handler  │  │   Handler   │   │   │
│  │  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └──────┬──────┘   │   │
│  └────────┼──────────────┼──────────────┼───────────────┼──────────┘   │
│           │              │              │               │               │
│           ▼              ▼              ▼               ▼               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     Decision Engine                              │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │   │
│  │  │   Policy    │  │   Cache     │  │    Parallel Evaluator   │  │   │
│  │  │   Matcher   │  │   Lookup    │  │    (goroutine pool)     │  │   │
│  │  └──────┬──────┘  └──────┬──────┘  └────────────┬────────────┘  │   │
│  └─────────┼────────────────┼──────────────────────┼───────────────┘   │
│            │                │                      │                    │
│            ▼                ▼                      ▼                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐     │
│  │  Policy Store   │  │     Cache       │  │     CEL Engine      │     │
│  │  ┌───────────┐  │  │  ┌───────────┐  │  │  ┌───────────────┐  │     │
│  │  │  Index    │  │  │  │  LRU/ARC  │  │  │  │  Compiled     │  │     │
│  │  │  (hash)   │  │  │  │  (1M+)    │  │  │  │  Programs     │  │     │
│  │  └───────────┘  │  │  └───────────┘  │  │  └───────────────┘  │     │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     Consensus Layer (Optional)                   │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │   │
│  │  │    Raft     │  │    PBFT     │  │      Gossip             │  │   │
│  │  │  (leader)   │  │ (byzantine) │  │   (propagation)         │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Components

### 3.1 CEL Engine (`internal/cel/`)

The CEL engine wraps google/cel-go for policy condition evaluation.

```go
// internal/cel/engine.go

package cel

import (
    "github.com/google/cel-go/cel"
    "github.com/google/cel-go/checker/decls"
)

// Engine provides CEL expression compilation and evaluation
type Engine struct {
    env      *cel.Env
    programs sync.Map // map[string]cel.Program - compiled program cache
}

// NewEngine creates a new CEL engine with authorization-specific functions
func NewEngine() (*Engine, error) {
    env, err := cel.NewEnv(
        cel.Declarations(
            // Principal declarations
            decls.NewVar("principal", decls.NewMapType(decls.String, decls.Dyn)),
            decls.NewVar("P", decls.NewMapType(decls.String, decls.Dyn)), // alias

            // Resource declarations
            decls.NewVar("resource", decls.NewMapType(decls.String, decls.Dyn)),
            decls.NewVar("R", decls.NewMapType(decls.String, decls.Dyn)), // alias

            // Request context
            decls.NewVar("request", decls.NewMapType(decls.String, decls.Dyn)),
            decls.NewVar("context", decls.NewMapType(decls.String, decls.Dyn)),
        ),
        // Custom functions
        cel.Lib(authzLibrary{}),
    )
    if err != nil {
        return nil, err
    }

    return &Engine{env: env}, nil
}

// Compile compiles a CEL expression and caches it
func (e *Engine) Compile(expr string) (cel.Program, error) {
    if prog, ok := e.programs.Load(expr); ok {
        return prog.(cel.Program), nil
    }

    ast, issues := e.env.Compile(expr)
    if issues != nil && issues.Err() != nil {
        return nil, issues.Err()
    }

    prog, err := e.env.Program(ast)
    if err != nil {
        return nil, err
    }

    e.programs.Store(expr, prog)
    return prog, nil
}

// Evaluate evaluates a compiled program with the given context
func (e *Engine) Evaluate(prog cel.Program, ctx *EvalContext) (bool, error) {
    vars := map[string]interface{}{
        "principal": ctx.Principal,
        "P":         ctx.Principal,
        "resource":  ctx.Resource,
        "R":         ctx.Resource,
        "request":   ctx.Request,
        "context":   ctx.Context,
    }

    result, _, err := prog.Eval(vars)
    if err != nil {
        return false, err
    }

    return result.Value().(bool), nil
}

// EvalContext contains all variables available during CEL evaluation
type EvalContext struct {
    Principal map[string]interface{}
    Resource  map[string]interface{}
    Request   map[string]interface{}
    Context   map[string]interface{}
}
```

### 3.2 Decision Engine (`internal/engine/`)

```go
// internal/engine/engine.go

package engine

import (
    "context"
    "sync"

    "authz-engine/internal/cel"
    "authz-engine/internal/cache"
    "authz-engine/internal/policy"
    "authz-engine/pkg/types"
)

// Engine is the core decision engine
type Engine struct {
    cel        *cel.Engine
    store      policy.Store
    cache      cache.Cache
    workerPool *WorkerPool

    config EngineConfig
}

// EngineConfig configures the decision engine
type EngineConfig struct {
    CacheEnabled     bool
    CacheSize        int
    CacheTTL         time.Duration
    ParallelWorkers  int
    DefaultEffect    types.Effect
}

// NewEngine creates a new decision engine
func NewEngine(cfg EngineConfig, store policy.Store) (*Engine, error) {
    celEngine, err := cel.NewEngine()
    if err != nil {
        return nil, err
    }

    var c cache.Cache
    if cfg.CacheEnabled {
        c = cache.NewLRU(cfg.CacheSize, cfg.CacheTTL)
    }

    return &Engine{
        cel:        celEngine,
        store:      store,
        cache:      c,
        workerPool: NewWorkerPool(cfg.ParallelWorkers),
        config:     cfg,
    }, nil
}

// Check evaluates an authorization request
func (e *Engine) Check(ctx context.Context, req *types.CheckRequest) (*types.CheckResponse, error) {
    start := time.Now()

    // Check cache first
    if e.cache != nil {
        if cached, ok := e.cache.Get(req.CacheKey()); ok {
            return cached.(*types.CheckResponse), nil
        }
    }

    // Find matching policies
    policies := e.store.FindPolicies(req.Resource.Kind, req.Actions)
    if len(policies) == 0 {
        return e.defaultResponse(req), nil
    }

    // Evaluate policies in parallel
    results := e.evaluateParallel(ctx, req, policies)

    // Build response
    response := &types.CheckResponse{
        RequestID: req.RequestID,
        Results:   results,
        Metadata: types.ResponseMetadata{
            EvaluationDurationMs: float64(time.Since(start).Microseconds()) / 1000,
            PoliciesEvaluated:    len(policies),
        },
    }

    // Cache result
    if e.cache != nil {
        e.cache.Set(req.CacheKey(), response)
    }

    return response, nil
}

// evaluateParallel evaluates multiple policies concurrently
func (e *Engine) evaluateParallel(ctx context.Context, req *types.CheckRequest, policies []*types.Policy) map[string]types.ActionResult {
    results := make(map[string]types.ActionResult)
    var mu sync.Mutex
    var wg sync.WaitGroup

    for _, action := range req.Actions {
        for _, pol := range policies {
            wg.Add(1)
            e.workerPool.Submit(func() {
                defer wg.Done()

                result := e.evaluatePolicy(ctx, req, pol, action)

                mu.Lock()
                if existing, ok := results[action]; !ok || result.Effect == types.EffectDeny {
                    results[action] = result // Deny takes precedence
                }
                mu.Unlock()
            })
        }
    }

    wg.Wait()
    return results
}

// evaluatePolicy evaluates a single policy
func (e *Engine) evaluatePolicy(ctx context.Context, req *types.CheckRequest, pol *types.Policy, action string) types.ActionResult {
    // Find matching rule
    for _, rule := range pol.Rules {
        if !rule.MatchesAction(action) {
            continue
        }

        // Evaluate condition
        if rule.Condition != "" {
            evalCtx := &cel.EvalContext{
                Principal: req.Principal.ToMap(),
                Resource:  req.Resource.ToMap(),
                Request:   req.Context,
                Context:   req.Context,
            }

            prog, err := e.cel.Compile(rule.Condition)
            if err != nil {
                continue // Skip invalid conditions
            }

            match, err := e.cel.Evaluate(prog, evalCtx)
            if err != nil || !match {
                continue
            }
        }

        return types.ActionResult{
            Effect:  rule.Effect,
            Policy:  pol.Name,
            Rule:    rule.Name,
            Matched: true,
        }
    }

    return types.ActionResult{
        Effect:  e.config.DefaultEffect,
        Matched: false,
    }
}
```

### 3.3 Policy Store (`internal/policy/`)

```go
// internal/policy/store.go

package policy

import (
    "authz-engine/pkg/types"
)

// Store defines the policy storage interface
type Store interface {
    // Get retrieves a policy by name
    Get(name string) (*types.Policy, error)

    // FindPolicies finds policies matching resource kind and actions
    FindPolicies(resourceKind string, actions []string) []*types.Policy

    // Load loads policies from a source
    Load(source string) error

    // Reload reloads all policies
    Reload() error

    // Watch watches for policy changes
    Watch(handler func(event PolicyEvent)) error
}

// PolicyEvent represents a policy change event
type PolicyEvent struct {
    Type   EventType
    Policy *types.Policy
}

type EventType int

const (
    EventAdded EventType = iota
    EventModified
    EventDeleted
)
```

```go
// internal/policy/index.go

package policy

import (
    "sync"
    "authz-engine/pkg/types"
)

// Index provides fast policy lookup
type Index struct {
    byResource map[string][]*types.Policy  // resourceKind -> policies
    byName     map[string]*types.Policy    // policyName -> policy
    mu         sync.RWMutex
}

// NewIndex creates a new policy index
func NewIndex() *Index {
    return &Index{
        byResource: make(map[string][]*types.Policy),
        byName:     make(map[string]*types.Policy),
    }
}

// Add adds a policy to the index
func (i *Index) Add(policy *types.Policy) {
    i.mu.Lock()
    defer i.mu.Unlock()

    i.byName[policy.Name] = policy
    i.byResource[policy.ResourceKind] = append(i.byResource[policy.ResourceKind], policy)
}

// FindByResource finds policies for a resource kind
func (i *Index) FindByResource(kind string) []*types.Policy {
    i.mu.RLock()
    defer i.mu.RUnlock()

    return i.byResource[kind]
}
```

### 3.4 Cache (`internal/cache/`)

```go
// internal/cache/lru.go

package cache

import (
    "container/list"
    "sync"
    "time"
)

// LRU implements an LRU cache with TTL
type LRU struct {
    capacity int
    ttl      time.Duration

    items map[string]*list.Element
    order *list.List
    mu    sync.RWMutex

    hits   uint64
    misses uint64
}

type cacheEntry struct {
    key       string
    value     interface{}
    expiresAt time.Time
}

// NewLRU creates a new LRU cache
func NewLRU(capacity int, ttl time.Duration) *LRU {
    return &LRU{
        capacity: capacity,
        ttl:      ttl,
        items:    make(map[string]*list.Element),
        order:    list.New(),
    }
}

// Get retrieves a value from the cache
func (c *LRU) Get(key string) (interface{}, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()

    if elem, ok := c.items[key]; ok {
        entry := elem.Value.(*cacheEntry)

        // Check expiration
        if time.Now().After(entry.expiresAt) {
            c.removeElement(elem)
            c.misses++
            return nil, false
        }

        // Move to front (most recently used)
        c.order.MoveToFront(elem)
        c.hits++
        return entry.value, true
    }

    c.misses++
    return nil, false
}

// Set adds a value to the cache
func (c *LRU) Set(key string, value interface{}) {
    c.mu.Lock()
    defer c.mu.Unlock()

    // Update existing
    if elem, ok := c.items[key]; ok {
        entry := elem.Value.(*cacheEntry)
        entry.value = value
        entry.expiresAt = time.Now().Add(c.ttl)
        c.order.MoveToFront(elem)
        return
    }

    // Evict if at capacity
    if c.order.Len() >= c.capacity {
        c.evictOldest()
    }

    // Add new entry
    entry := &cacheEntry{
        key:       key,
        value:     value,
        expiresAt: time.Now().Add(c.ttl),
    }
    elem := c.order.PushFront(entry)
    c.items[key] = elem
}

// Stats returns cache statistics
func (c *LRU) Stats() CacheStats {
    c.mu.RLock()
    defer c.mu.RUnlock()

    total := c.hits + c.misses
    hitRate := float64(0)
    if total > 0 {
        hitRate = float64(c.hits) / float64(total)
    }

    return CacheStats{
        Size:    c.order.Len(),
        Hits:    c.hits,
        Misses:  c.misses,
        HitRate: hitRate,
    }
}
```

### 3.5 gRPC Server (`internal/server/`)

```go
// internal/server/server.go

package server

import (
    "context"
    "net"

    "google.golang.org/grpc"
    "google.golang.org/grpc/health"
    healthpb "google.golang.org/grpc/health/grpc_health_v1"

    pb "authz-engine/api/proto/authz/v1"
    "authz-engine/internal/engine"
)

// Server is the gRPC authorization server
type Server struct {
    pb.UnimplementedAuthzServiceServer

    engine *engine.Engine
    server *grpc.Server
    health *health.Server
}

// NewServer creates a new gRPC server
func NewServer(eng *engine.Engine) *Server {
    s := &Server{
        engine: eng,
        health: health.NewServer(),
    }

    // Create gRPC server with interceptors
    s.server = grpc.NewServer(
        grpc.ChainUnaryInterceptor(
            LoggingInterceptor(),
            MetricsInterceptor(),
            RecoveryInterceptor(),
        ),
        grpc.ChainStreamInterceptor(
            StreamLoggingInterceptor(),
            StreamMetricsInterceptor(),
        ),
    )

    // Register services
    pb.RegisterAuthzServiceServer(s.server, s)
    healthpb.RegisterHealthServer(s.server, s.health)

    return s
}

// Serve starts the gRPC server
func (s *Server) Serve(addr string) error {
    lis, err := net.Listen("tcp", addr)
    if err != nil {
        return err
    }

    s.health.SetServingStatus("authz", healthpb.HealthCheckResponse_SERVING)

    return s.server.Serve(lis)
}

// Check handles authorization check requests
func (s *Server) Check(ctx context.Context, req *pb.CheckRequest) (*pb.CheckResponse, error) {
    // Convert protobuf to internal types
    internalReq := convertRequest(req)

    // Evaluate
    result, err := s.engine.Check(ctx, internalReq)
    if err != nil {
        return nil, err
    }

    // Convert back to protobuf
    return convertResponse(result), nil
}

// CheckBatch handles batch authorization requests
func (s *Server) CheckBatch(ctx context.Context, req *pb.CheckBatchRequest) (*pb.CheckBatchResponse, error) {
    responses := make([]*pb.CheckResponse, len(req.Requests))

    // Process in parallel
    var wg sync.WaitGroup
    for i, r := range req.Requests {
        i, r := i, r
        wg.Add(1)
        go func() {
            defer wg.Done()
            resp, _ := s.Check(ctx, r)
            responses[i] = resp
        }()
    }
    wg.Wait()

    return &pb.CheckBatchResponse{Responses: responses}, nil
}

// CheckStream handles streaming authorization requests
func (s *Server) CheckStream(stream pb.AuthzService_CheckStreamServer) error {
    for {
        req, err := stream.Recv()
        if err == io.EOF {
            return nil
        }
        if err != nil {
            return err
        }

        resp, err := s.Check(stream.Context(), req)
        if err != nil {
            return err
        }

        if err := stream.Send(resp); err != nil {
            return err
        }
    }
}
```

---

## 4. API Definition

### 4.1 Protobuf Schema

```protobuf
// api/proto/authz/v1/authz.proto

syntax = "proto3";

package authz.v1;

option go_package = "authz-engine/api/proto/authz/v1;authzv1";

import "google/protobuf/struct.proto";
import "google/protobuf/timestamp.proto";

// AuthzService provides authorization checking
service AuthzService {
  // Check performs a single authorization check
  rpc Check(CheckRequest) returns (CheckResponse);

  // CheckBatch performs multiple authorization checks
  rpc CheckBatch(CheckBatchRequest) returns (CheckBatchResponse);

  // CheckStream provides bidirectional streaming for high-throughput scenarios
  rpc CheckStream(stream CheckRequest) returns (stream CheckResponse);
}

// CheckRequest represents an authorization check request
message CheckRequest {
  string request_id = 1;
  Principal principal = 2;
  Resource resource = 3;
  repeated string actions = 4;
  google.protobuf.Struct context = 5;

  // Optional: Include explanation in response
  bool include_metadata = 6;
}

// Principal represents the entity requesting access
message Principal {
  string id = 1;
  repeated string roles = 2;
  google.protobuf.Struct attributes = 3;
}

// Resource represents the resource being accessed
message Resource {
  string kind = 1;
  string id = 2;
  google.protobuf.Struct attributes = 3;
}

// CheckResponse contains the authorization decision
message CheckResponse {
  string request_id = 1;
  map<string, ActionResult> results = 2;
  ResponseMetadata metadata = 3;
}

// ActionResult contains the decision for a single action
message ActionResult {
  Effect effect = 1;
  string policy = 2;
  string rule = 3;
  bool matched = 4;
}

// Effect represents the authorization decision
enum Effect {
  EFFECT_UNSPECIFIED = 0;
  EFFECT_ALLOW = 1;
  EFFECT_DENY = 2;
}

// ResponseMetadata contains evaluation metadata
message ResponseMetadata {
  double evaluation_duration_ms = 1;
  int32 policies_evaluated = 2;
  repeated string matched_policies = 3;
}

// CheckBatchRequest contains multiple check requests
message CheckBatchRequest {
  repeated CheckRequest requests = 1;
}

// CheckBatchResponse contains multiple check responses
message CheckBatchResponse {
  repeated CheckResponse responses = 1;
}
```

---

## 5. Configuration

```yaml
# configs/config.yaml

server:
  grpc:
    address: ":9090"
    max_concurrent_streams: 1000
    keepalive:
      time: 30s
      timeout: 10s
  http:
    address: ":8080"  # Health/metrics endpoint

engine:
  default_effect: deny
  parallel_workers: 16

cache:
  enabled: true
  type: lru  # lru, arc
  size: 100000
  ttl: 5m

policy:
  store:
    type: file  # file, memory, etcd
    path: ./policies
    watch: true
    reload_interval: 30s

consensus:
  enabled: false
  protocol: raft  # raft, pbft
  peers: []

observability:
  logging:
    level: info
    format: json
  metrics:
    enabled: true
    endpoint: /metrics
  tracing:
    enabled: true
    endpoint: localhost:4317
```

---

## 6. Build & Deployment

### 6.1 Makefile

```makefile
# Makefile

.PHONY: all build test lint proto clean docker

BINARY_NAME=authz-server
VERSION=$(shell git describe --tags --always --dirty)
BUILD_TIME=$(shell date -u +"%Y-%m-%dT%H:%M:%SZ")

LDFLAGS=-ldflags "-X main.Version=$(VERSION) -X main.BuildTime=$(BUILD_TIME)"

all: proto build test

build:
	CGO_ENABLED=0 go build $(LDFLAGS) -o bin/$(BINARY_NAME) ./cmd/authz-server

test:
	go test -v -race -cover ./...

bench:
	go test -bench=. -benchmem ./...

lint:
	golangci-lint run ./...

proto:
	buf generate

clean:
	rm -rf bin/ dist/

docker:
	docker build -t authz-engine:$(VERSION) .

# Development
dev:
	go run ./cmd/authz-server -config configs/config.yaml

# Release
release:
	goreleaser release --clean
```

### 6.2 Dockerfile

```dockerfile
# Dockerfile

FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /authz-server ./cmd/authz-server

FROM scratch
COPY --from=builder /authz-server /authz-server
COPY --from=builder /app/configs/config.yaml /config.yaml

EXPOSE 9090 8080

ENTRYPOINT ["/authz-server"]
CMD ["-config", "/config.yaml"]
```

---

## 7. Performance Benchmarks (Targets)

| Operation | Target | Notes |
|-----------|--------|-------|
| CEL Compile | <1ms | Cached after first compile |
| CEL Evaluate | <100μs | Per expression |
| Policy Lookup | <10μs | Indexed by resource kind |
| Cache Hit | <1μs | LRU O(1) |
| Full Check (cached) | <100μs | Cache hit path |
| Full Check (uncached) | <1ms | 10 policies evaluated |
| Batch (100 requests) | <10ms | Parallel evaluation |
| Throughput | 100K+ req/sec | Single instance |

---

## 8. Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Set up Go module and project structure
- [ ] Implement CEL engine wrapper
- [ ] Create basic types (Principal, Resource, Policy)
- [ ] Write unit tests for CEL engine

### Phase 2: Decision Engine (Week 3-4)
- [ ] Implement decision engine
- [ ] Add parallel policy evaluation
- [ ] Implement LRU cache
- [ ] Create policy store (in-memory)
- [ ] Write integration tests

### Phase 3: gRPC Server (Week 5-6)
- [ ] Define protobuf schemas
- [ ] Implement gRPC server
- [ ] Add interceptors (logging, metrics, recovery)
- [ ] Create health check service
- [ ] Write end-to-end tests

### Phase 4: Advanced Features (Week 7-8)
- [ ] Implement file-based policy store
- [ ] Add hot-reload capability
- [ ] Implement ARC cache
- [ ] Add policy indexing
- [ ] Performance benchmarking

### Phase 5: Distributed Features (Week 9-10)
- [ ] Implement Raft consensus
- [ ] Implement PBFT consensus
- [ ] Add distributed cache invalidation
- [ ] Multi-node testing

### Phase 6: Integration (Week 11-12)
- [ ] Create TypeScript gRPC client
- [ ] Update @authz-engine/sdk-typescript
- [ ] Integrate with agentic layer
- [ ] End-to-end integration tests
- [ ] Documentation

---

## 9. Dependencies

```go
// go.mod

module authz-engine/go-core

go 1.22

require (
    github.com/google/cel-go v0.20.0
    google.golang.org/grpc v1.62.0
    google.golang.org/protobuf v1.33.0
    github.com/hashicorp/raft v1.6.0
    go.uber.org/zap v1.27.0
    github.com/prometheus/client_golang v1.19.0
    go.opentelemetry.io/otel v1.24.0
    gopkg.in/yaml.v3 v3.0.1
)
```

---

## 10. References

- [google/cel-go](https://github.com/google/cel-go)
- [Cerbos](https://github.com/cerbos/cerbos)
- [OPA](https://github.com/open-policy-agent/opa)
- [gRPC Performance Best Practices](https://grpc.io/docs/guides/performance/)
- [ADR-008: Hybrid Architecture](../adr/ADR-008-HYBRID-GO-TYPESCRIPT-ARCHITECTURE.md)
