# ADR-007: Native Agentic Framework

**Status**: ACCEPTED
**Date**: 2024-11-23
**Deciders**: Architecture Team

---

## Context

The AuthZ Engine currently has a working 4-agent architecture (GUARDIAN, ANALYST, ADVISOR, ENFORCER) with basic orchestration. To achieve next-generation agentic authorization capabilities comparable to or exceeding Claude Flow, we needed to decide how to add:

1. **Swarm Orchestration**: Dynamic multi-agent topologies and scaling
2. **Neural Pattern Engine**: ML-based anomaly detection and prediction
3. **Consensus Protocols**: Distributed agreement for high-stakes decisions
4. **Distributed Memory**: Cross-region state synchronization

## Decision

**We will build a fully native agentic framework from scratch**, replicating Claude Flow's architecture patterns directly within the AuthZ Engine monorepo rather than integrating it as an external dependency.

## Options Considered

### Option A: Integrate Claude Flow (Rejected)

```
AuthZ Engine → Claude Flow MCP → External Service
```

**Pros:**
- Faster initial implementation
- Leverage existing tested code

**Cons:**
- External runtime dependency
- Network latency overhead
- Limited customization for authorization use cases
- Licensing and ownership concerns
- Constrained by external roadmap

### Option B: Native Framework (Selected)

```
AuthZ Engine → packages/swarm, packages/neural, packages/consensus, packages/memory
```

**Pros:**
- Zero external dependencies
- Full control and customization
- Authorization-optimized from ground up
- Complete audit trail
- Independent evolution
- No network latency
- Full IP ownership

**Cons:**
- More development effort
- Need to implement and maintain ourselves

## Architecture

### New Packages

| Package | Purpose |
|---------|---------|
| `packages/swarm` | Swarm orchestration, topologies, load balancing |
| `packages/neural` | Pattern recognition, training, inference |
| `packages/consensus` | Byzantine, Raft, Gossip protocols |
| `packages/memory` | Vector store, cache, event store, CRDT sync |
| `packages/platform` | Unified platform orchestrator |

### Key Components Replicated from Claude Flow

1. **Topology Manager**: Mesh, Hierarchical, Ring, Star, Adaptive
2. **Neural Engine**: WASM SIMD accelerated inference
3. **Consensus Protocols**: PBFT, Raft, Gossip
4. **Memory System**: pgvector, LRU cache, event sourcing, CRDT

## Consequences

### Positive
- AuthZ Engine becomes a self-contained, world-class agentic authorization platform
- No vendor lock-in or external dependencies
- Authorization-specific optimizations possible
- Full control over security and compliance

### Negative
- Significant development investment (~12 weeks)
- Need to maintain additional infrastructure code
- Requires expertise in distributed systems and ML

### Risks
- Complexity increase may impact maintainability
- Performance tuning required for production
- Need robust testing for consensus protocols

## Implementation Plan

See [NATIVE-AGENTIC-FRAMEWORK-SDD](../sdd/NATIVE-AGENTIC-FRAMEWORK-SDD.md) for full specification.

**Timeline:**
- Phase 1 (Weeks 1-3): Swarm + Memory foundation
- Phase 2 (Weeks 4-6): Neural engine
- Phase 3 (Weeks 7-8): Consensus protocols
- Phase 4 (Weeks 9-10): Platform integration
- Phase 5 (Weeks 11-12): Production hardening

## References

- [Claude Flow Architecture](https://github.com/ruvnet/claude-flow)
- [NATIVE-AGENTIC-FRAMEWORK-SDD](../sdd/NATIVE-AGENTIC-FRAMEWORK-SDD.md)
- [AGENTS-PACKAGE-SDD](../sdd/AGENTS-PACKAGE-SDD.md)
- [ADR-005: Agentic Authorization](./ADR-005-AGENTIC-AUTHORIZATION.md)
