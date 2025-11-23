# ADR-008: Hybrid Go/TypeScript Architecture

**Status**: ACCEPTED
**Date**: 2024-11-23
**Deciders**: Architecture Team
**Supersedes**: None
**Related**: ADR-007 (Native Agentic Framework)

---

## Context

The AuthZ Engine requires both **high-performance policy evaluation** (sub-millisecond latency, 100K+ req/sec) and **sophisticated agentic capabilities** (neural patterns, swarm orchestration, ML-based anomaly detection).

Analysis of production authorization systems shows:
- **Cerbos**: Go core, multi-language SDKs
- **OPA (Open Policy Agent)**: Go core, Rego engine
- **SpiceDB/Zanzibar**: Go core, gRPC API
- **Casbin**: Go core, adapters for 15+ languages

All high-performance authorization engines use **Go** for the critical path.

Our current TypeScript implementation provides excellent developer experience and agentic capabilities, but faces inherent limitations for production authorization workloads.

## Decision

**We will implement a hybrid architecture with a Go core for high-performance authorization and TypeScript for agentic orchestration and integration.**

```
┌─────────────────────────────────────────────────────────────────────┐
│                     AUTHZ ENGINE - HYBRID ARCHITECTURE              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    GO CORE (High Performance)                 │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐  │  │
│  │  │ CEL Engine  │ │   Policy    │ │     Decision Engine     │  │  │
│  │  │ (cel-go)    │ │   Store     │ │  (parallel evaluation)  │  │  │
│  │  └─────────────┘ └─────────────┘ └─────────────────────────┘  │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐  │  │
│  │  │  Consensus  │ │   Cache     │ │      gRPC Server        │  │  │
│  │  │ (Raft/PBFT) │ │  (LRU/ARC)  │ │   (high-throughput)     │  │  │
│  │  └─────────────┘ └─────────────┘ └─────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │ gRPC                                 │
│                              ▼                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │               TYPESCRIPT LAYER (Agentic + Integration)        │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐  │  │
│  │  │   Neural    │ │    Swarm    │ │    Agent Orchestrator   │  │  │
│  │  │   Engine    │ │ Coordinator │ │ (Guardian/Analyst/etc)  │  │  │
│  │  └─────────────┘ └─────────────┘ └─────────────────────────┘  │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐  │  │
│  │  │  NestJS     │ │ TypeScript  │ │      REST API           │  │  │
│  │  │  Module     │ │    SDK      │ │   (management/admin)    │  │  │
│  │  └─────────────┘ └─────────────┘ └─────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Options Considered

### Option A: Full TypeScript (Current State)

**Pros:**
- Already implemented
- Single language stack
- Fast iteration

**Cons:**
- 10-100x slower than Go for CEL evaluation
- Single-threaded limitations
- cel-js is a port, not reference implementation
- Not suitable for sidecar deployment
- GC pauses affect tail latency

**Verdict**: ❌ Rejected for production authorization

### Option B: Full Go Rewrite

**Pros:**
- Maximum performance
- Single language stack
- Proven in industry (Cerbos, OPA)

**Cons:**
- Loss of agentic TypeScript packages (neural, swarm)
- Slower ML/AI development in Go
- Reduced integration with Node.js ecosystem
- Significant rewrite effort

**Verdict**: ❌ Rejected - loses agentic capabilities

### Option C: Hybrid Go/TypeScript (Selected)

**Pros:**
- Best-of-both-worlds performance
- Native CEL (cel-go) for correctness
- Goroutines for concurrent evaluation
- Keep TypeScript agentic layer
- Industry-standard architecture
- Incremental migration path

**Cons:**
- Two language stacks to maintain
- gRPC overhead between layers
- Increased operational complexity

**Verdict**: ✅ Selected

## Architecture Details

### Go Core Components (`/go-core/`)

| Component | Purpose | Performance Target |
|-----------|---------|-------------------|
| `cel/` | CEL expression evaluation using google/cel-go | <100μs per expression |
| `engine/` | Decision engine with parallel policy evaluation | <1ms for complex policies |
| `policy/` | Policy storage, indexing, hot-reload | <10ms reload |
| `cache/` | LRU/ARC cache for decisions | 1M+ entries, <1μs lookup |
| `consensus/` | Raft/PBFT for distributed decisions | <10ms consensus |
| `server/` | gRPC server with streaming | 100K+ req/sec |

### TypeScript Layer Components (`/packages/`)

| Package | Purpose | Interaction with Go Core |
|---------|---------|-------------------------|
| `@authz-engine/agents` | 4-agent orchestration | Calls Go core for decisions |
| `@authz-engine/neural` | ML pattern detection | Enriches requests before Go core |
| `@authz-engine/swarm` | Multi-agent coordination | Manages agent topology |
| `@authz-engine/platform` | Master orchestrator | Coordinates both layers |
| `@authz-engine/sdk-typescript` | Client SDK | gRPC client to Go core |
| `@authz-engine/nestjs` | NestJS integration | Uses SDK internally |

### Communication Protocol

```protobuf
// authz.proto - Go Core API

service AuthzEngine {
  // High-performance check (hot path)
  rpc Check(CheckRequest) returns (CheckResponse);
  rpc CheckBatch(CheckBatchRequest) returns (CheckBatchResponse);

  // Streaming for real-time decisions
  rpc CheckStream(stream CheckRequest) returns (stream CheckResponse);

  // Policy management
  rpc LoadPolicies(LoadPoliciesRequest) returns (LoadPoliciesResponse);
  rpc ReloadPolicies(ReloadPoliciesRequest) returns (ReloadPoliciesResponse);

  // Health and metrics
  rpc Health(HealthRequest) returns (HealthResponse);
  rpc Metrics(MetricsRequest) returns (MetricsResponse);
}

message CheckRequest {
  string request_id = 1;
  Principal principal = 2;
  Resource resource = 3;
  repeated string actions = 4;
  map<string, google.protobuf.Value> context = 5;
}

message CheckResponse {
  string request_id = 1;
  map<string, ActionResult> results = 2;
  ResponseMetadata metadata = 3;
}
```

### Request Flow

```
┌──────────┐     ┌──────────────────┐     ┌─────────────┐     ┌──────────┐
│  Client  │────▶│  TypeScript      │────▶│   Go Core   │────▶│  Policy  │
│          │     │  (Agentic Layer) │     │   (gRPC)    │     │  Store   │
└──────────┘     └──────────────────┘     └─────────────┘     └──────────┘
                         │                       │
                         │                       │
                    ┌────▼────┐            ┌─────▼─────┐
                    │ Neural  │            │    CEL    │
                    │ Engine  │            │  Engine   │
                    │(enrich) │            │ (cel-go)  │
                    └─────────┘            └───────────┘
```

**Standard Flow (Fast Path):**
1. Client → TypeScript SDK → Go Core (gRPC) → Response
2. Latency: ~1-5ms total

**Agentic Flow (Enhanced):**
1. Client → TypeScript SDK → Agentic Layer
2. Neural Engine enriches context (anomaly scores)
3. Agent Orchestrator coordinates decision
4. Go Core evaluates policies
5. Consensus (if high-stakes)
6. Response with explanations
7. Latency: ~10-50ms (acceptable for agentic features)

## Performance Targets

| Metric | TypeScript Only | Hybrid (Go Core) | Improvement |
|--------|-----------------|------------------|-------------|
| P50 Latency | 5-10ms | 0.5-1ms | 10x |
| P99 Latency | 50-100ms | 5-10ms | 10x |
| Throughput | 5K req/sec | 100K+ req/sec | 20x |
| Memory (per instance) | 500MB+ | 50-100MB | 5-10x |
| CEL Evaluation | 1-5ms | 50-100μs | 20-50x |
| Cold Start | 2-5s | 100-500ms | 10x |

## Migration Strategy

### Phase 1: Go Core Foundation (Weeks 1-4)
- Set up Go module structure
- Implement CEL engine wrapper
- Create basic decision engine
- Add gRPC server
- Benchmark against TypeScript

### Phase 2: Feature Parity (Weeks 5-8)
- Implement policy store
- Add caching layer
- Create consensus protocols
- Match TypeScript decision logic

### Phase 3: Integration (Weeks 9-10)
- Create gRPC client in TypeScript
- Update SDK to use Go core
- Integrate agentic layer with Go core
- End-to-end testing

### Phase 4: Production Hardening (Weeks 11-12)
- Performance tuning
- Observability (OpenTelemetry)
- Kubernetes deployment
- Documentation

## Consequences

### Positive
- 10-20x performance improvement on critical path
- Native CEL implementation (correctness guarantee)
- Industry-standard architecture
- Kubernetes-native deployment (sidecar pattern)
- Keep all agentic TypeScript capabilities
- Clear separation of concerns

### Negative
- Two language stacks to maintain
- Additional operational complexity
- Learning curve for Go (if team is TS-focused)
- gRPC overhead for cross-layer communication

### Risks
- Integration complexity between layers
- Potential feature drift between implementations
- Need Go expertise for core development

## References

- [google/cel-go](https://github.com/google/cel-go) - CEL reference implementation
- [Cerbos Architecture](https://docs.cerbos.dev/cerbos/latest/architecture)
- [OPA Performance](https://www.openpolicyagent.org/docs/latest/performance/)
- [ADR-007: Native Agentic Framework](./ADR-007-NATIVE-AGENTIC-FRAMEWORK.md)
- [gRPC Performance Best Practices](https://grpc.io/docs/guides/performance/)
