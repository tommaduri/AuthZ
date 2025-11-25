# Go Vector Store - Development Plan

**Created**: 2024-11-25
**Last Updated**: 2025-11-25
**Status**: Implementation Ready (Accelerated Timeline)
**Estimated Duration**: 3-6 weeks (leveraging fogfish/hnsw library)
**Team**: 2-3 engineers

---

## 1. Overview

This document provides a detailed development plan for implementing the Go vector store, broken down into phases with concrete tasks, milestones, and success criteria.

### 1.1 Reference Documents

- [GO-VECTOR-STORE-SDD.md](./sdd/GO-VECTOR-STORE-SDD.md) - Complete technical specification
- [GO-VECTOR-STORE-ARCHITECTURE.md](./GO-VECTOR-STORE-ARCHITECTURE.md) - Integration architecture
- [fogfish/hnsw](https://github.com/fogfish/hnsw) - Production HNSW library
- [ADR-010](./adr/ADR-010-VECTOR-STORE-PRODUCTION-STRATEGY.md) - Strategic context

### 1.2 High-Level Timeline (Accelerated)

```
Week 1:    Phase 1a - fogfish/hnsw Integration + Decision Embedding
Week 2:    Phase 1b - In-Memory Store + Async Worker
Week 3:    Phase 1c - Engine Integration + Testing
Week 4-5:  Phase 2  - PostgreSQL + pgvector Backend (OPTIONAL)
Week 6:    Phase 3  - Final Testing + Documentation + Benchmarks
```

**Key Acceleration**: Using the battle-tested fogfish/hnsw library eliminates ~2 weeks of custom HNSW implementation (~2,000 lines of complex graph code), allowing us to focus on integration and business logic.

---

## 2. Phase 1: In-Memory Vector Store with fogfish/hnsw (Weeks 1-3)

### 2.1 Goal

Implement production-ready in-memory vector store leveraging fogfish/hnsw library for HNSW indexing. This accelerated approach eliminates custom HNSW implementation, reducing complexity and time-to-production.

### 2.2 Week 1: fogfish/hnsw Integration + Decision Embedding

#### Day 1-2: Project Setup & fogfish/hnsw Integration
**Tasks**:
- [ ] Create `go-core/internal/vector/` package
- [ ] Add fogfish/hnsw dependency: `go get github.com/fogfish/hnsw`
- [ ] Study fogfish/hnsw API (1-2 hour learning curve)
- [ ] Define `VectorStore` interface (store.go)
- [ ] Define configuration types (config.go)
- [ ] Define result types (SearchResult, VectorEntry, StoreStats)
- [ ] Set up test framework (vector_test.go)
- [ ] Add additional dependencies (testify, prometheus)

**Deliverables**:
- `store.go` (~100 lines) - VectorStore interface
- `config.go` (~150 lines) - Configuration types
- `vector_test.go` (skeleton)
- fogfish/hnsw dependency configured

**Success Criteria**:
- All dependencies installed successfully
- Interfaces compile
- Basic test structure in place
- All types documented with godoc comments
- Team understands fogfish/hnsw API

**Effort Saved**: ~2,000 lines of custom HNSW implementation eliminated!

#### Day 3-5: Decision Embedding + Distance Metrics
**Tasks**:
- [ ] Implement `DecisionEmbedding` struct (embeddings.go)
- [ ] Implement feature hashing for principal, resource, actions
- [ ] Implement decision feature extraction (effect, duration, policies)
- [ ] Implement vector normalization
- [ ] Add deterministic embedding tests
- [ ] Add collision rate analysis
- [ ] Implement distance metrics wrapper (Euclidean, Cosine) for fogfish/hnsw
- [ ] Test integration with fogfish/hnsw distance functions

**Deliverables**:
- `embeddings.go` (~400 lines) - Embedding generation
- `distance.go` (~100 lines) - Distance metrics wrapper
- Comprehensive unit tests

**Success Criteria**:
- Same input produces same embedding (deterministic)
- All embeddings are unit vectors (cosine similarity compatible)
- Feature hash collision rate <1%
- Embedding generation <50µs
- Distance metrics compatible with fogfish/hnsw API

### 2.3 Week 2: In-Memory Store + Async Worker

#### Day 1-3: MemoryStore with fogfish/hnsw
**Tasks**:
- [ ] Implement `MemoryStore` struct (memory_store.go)
- [ ] Wrap fogfish/hnsw index with `VectorStore` interface
- [ ] Implement `Insert()` using fogfish/hnsw.Add()
- [ ] Implement `Search()` using fogfish/hnsw.Search()
- [ ] Implement `Delete()` (if supported by fogfish/hnsw, else mark as deleted)
- [ ] Implement `BatchInsert()` with optimized batch operations
- [ ] Implement `Stats()` method
- [ ] Add concurrent access safety (RWMutex)
- [ ] Add metrics collection (Prometheus)
- [ ] Configure fogfish/hnsw parameters (M, efConstruction, efSearch)

**Deliverables**:
- `memory_store.go` (~300-400 lines) - Wrapper around fogfish/hnsw
- Unit tests for all methods
- Configuration tuning guide

**Success Criteria**:
- All VectorStore interface methods implemented
- fogfish/hnsw index operations work correctly
- Concurrent insert/search tests pass (race detector enabled)
- Memory usage tracking works
- Metrics exposed correctly
- Insert 10K vectors <1 second

**Integration Notes**:
- fogfish/hnsw handles all graph management, layer selection, and neighbor connections
- Focus on interface implementation and thread safety
- Estimated effort: ~50% reduction vs custom HNSW

#### Day 4-5: Async Embedding Worker
**Tasks**:
- [ ] Implement `EmbeddingWorker` (worker.go)
- [ ] Add worker queue with channel-based architecture
- [ ] Implement graceful shutdown
- [ ] Add error handling and retry logic
- [ ] Add worker pool for concurrent embedding generation
- [ ] Implement backpressure handling
- [ ] Add worker metrics (queue depth, processing rate)

**Deliverables**:
- `worker.go` (~250 lines)
- Worker pool tests
- Performance benchmarks

**Success Criteria**:
- Worker queue handles 1000 decisions/sec
- No goroutine leaks
- Graceful shutdown works correctly
- Backpressure prevents memory exhaustion

### 2.4 Week 3: Engine Integration + Comprehensive Testing

#### Day 1-2: Engine Integration
**Tasks**:
- [ ] Modify `internal/engine/engine.go` to add vectorStore field
- [ ] Implement `EmbeddingWorker` (worker.go)
- [ ] Add async embedding call in `Check()` method
- [ ] Update `engine.Config` with vector store options
- [ ] Update `New()` constructor to initialize vector store

**Deliverables**:
- Modified `engine.go` (~30 lines added)
- `worker.go` (~250 lines)
- Updated config types

**Success Criteria**:
- Authorization latency unchanged (<10µs p99)
- Embeddings generated asynchronously
- Worker queue handles 1000 decisions/sec
- No goroutine leaks

#### Day 3-4: Comprehensive Testing + Benchmarking
**Tasks**:
- [ ] Write integration tests (vector_integration_test.go)
- [ ] Write performance benchmarks (vector_bench_test.go)
- [ ] Test authorization with vector store enabled
- [ ] Benchmark insert latency (1K, 10K, 100K, 1M vectors)
- [ ] Benchmark search latency at different scales
- [ ] Benchmark memory footprint
- [ ] Test concurrent access (race detector)
- [ ] Test fogfish/hnsw index accuracy (recall@10, recall@100)
- [ ] Compare performance: fogfish/hnsw vs theoretical HNSW
- [ ] Test parameter tuning (M, efConstruction, efSearch)

**Deliverables**:
- `vector_integration_test.go` (~300 lines)
- `vector_bench_test.go` (~200 lines)
- Performance comparison report (fogfish/hnsw vs expectations)
- Parameter tuning guide

**Success Criteria**:
- All tests pass
- Search latency <0.5ms p50, <2ms p99 (100K vectors)
- Insert latency <0.1ms p99
- Memory <800MB per 1M vectors (same as custom HNSW target)
- No race conditions detected
- Test coverage >90%
- fogfish/hnsw recall@10 >95% vs brute force

#### Day 5: Documentation + Phase 1 Completion
**Tasks**:
- [ ] Write package documentation (README in vector/)
- [ ] Update go-core README with vector store section
- [ ] Create runbook for development usage
- [ ] Document configuration options
- [ ] Create example code snippets
- [ ] Tag Phase 1 release (v1.1.0-phase1)

**Deliverables**:
- Package documentation
- Examples
- Phase 1 completion report

**Success Criteria**:
- All Phase 1 deliverables complete
- Documentation reviewed and approved
- Ready for Phase 2

---

## 3. Phase 2: PostgreSQL + pgvector Backend (Weeks 4-5, OPTIONAL)

### 3.1 Goal

**OPTIONAL**: Implement durable vector storage using PostgreSQL + pgvector extension for production deployments requiring persistence. The in-memory store (Phase 1) is production-ready for most use cases.

### 3.2 Week 4: PostgreSQL Backend

#### Day 1-2: Database Schema + Setup
**Tasks**:
- [ ] Create PostgreSQL migration scripts (schema.sql)
- [ ] Design `decision_vectors` table schema
- [ ] Create pgvector HNSW index
- [ ] Create metadata GIN index
- [ ] Write migration tool (migrate.go)
- [ ] Document PostgreSQL setup instructions

**Deliverables**:
- `schema.sql` (~100 lines)
- `migrate.go` (~200 lines)
- Setup documentation

**Schema**:
```sql
CREATE EXTENSION vector;
CREATE TABLE decision_vectors (
    id TEXT PRIMARY KEY,
    embedding vector(384) NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX decision_vectors_embedding_idx
ON decision_vectors USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

**Success Criteria**:
- Schema creation successful
- HNSW index created without errors
- Migration tool validates schema

#### Day 3-5: PostgresStore Implementation
**Tasks**:
- [ ] Implement `PostgresStore` struct (pg_store.go)
- [ ] Implement connection pooling (pgx)
- [ ] Implement `Insert()` with prepared statements
- [ ] Implement `Search()` with pgvector queries
- [ ] Implement `Delete()` method
- [ ] Implement `BatchInsert()` with COPY protocol
- [ ] Add error handling and retries

**Deliverables**:
- `pg_store.go` (~600 lines)
- Unit tests with testcontainers

**Success Criteria**:
- All VectorStore interface methods implemented
- Connection pool handles 100 concurrent connections
- Prepared statements prevent SQL injection
- COPY protocol achieves >1000 inserts/sec

### 3.3 Week 5: Optimization + Testing

#### Day 1-2: Batch Operations
**Tasks**:
- [ ] Optimize batch insert using COPY protocol
- [ ] Implement connection pooling tuning
- [ ] Add retry logic with exponential backoff
- [ ] Implement bulk delete operations
- [ ] Add transaction support

**Deliverables**:
- Optimized batch operations
- Retry/failover logic

**Success Criteria**:
- Batch insert <50ms for 1000 vectors
- Connection failures handled gracefully
- Transactions provide ACID guarantees

#### Day 3-5: Integration Testing
**Tasks**:
- [ ] Write integration tests with real PostgreSQL (pg_integration_test.go)
- [ ] Test insert/search/delete with pgvector
- [ ] Test concurrent access from multiple goroutines
- [ ] Test connection failure recovery
- [ ] Benchmark performance vs in-memory backend
- [ ] Test with 1M vector dataset

**Deliverables**:
- `pg_integration_test.go` (~400 lines)
- Performance comparison report

**Success Criteria**:
- All PostgreSQL tests pass
- Search latency <1ms p50, <5ms p99 (1M vectors)
- Batch insert throughput >5000 vectors/sec
- Connection pool stable under load
- HNSW index recall >95%

### 3.4 PostgreSQL Integration Completion (End of Week 5)

#### Day 1-2: VectorStore Factory
**Tasks**:
- [ ] Implement `NewVectorStore()` factory function
- [ ] Add backend detection (memory vs postgres)
- [ ] Add configuration validation
- [ ] Add health checks
- [ ] Update engine integration to use factory

**Deliverables**:
- Updated `store.go` with factory
- Configuration validation

**Success Criteria**:
- Factory correctly selects backend
- Invalid configs return clear errors
- Health checks detect PostgreSQL issues

#### Day 3-4: Documentation + Examples
**Tasks**:
- [ ] Write PostgreSQL setup guide
- [ ] Document connection string format
- [ ] Create Docker Compose example
- [ ] Write operational runbook
- [ ] Document migration from memory to postgres
- [ ] Create troubleshooting guide

**Deliverables**:
- PostgreSQL documentation
- Docker Compose file
- Runbook

**Success Criteria**:
- Complete setup instructions
- Working Docker Compose environment
- Migration guide validated

**Success Criteria**:
- All Phase 2 deliverables complete (if implemented)
- Production-ready PostgreSQL backend (optional)
- Ready for Phase 3 (final testing and documentation)

---

## 4. Phase 3: Final Testing + Documentation + Benchmarks (Week 6)

### 4.1 Goal

Complete comprehensive testing, documentation, and benchmarking for production release.

### 4.2 Week 6: Production Readiness

#### Day 1-2: Integration Testing + Load Testing
**Tasks**:
- [ ] Write end-to-end integration tests
- [ ] Test authorization engine with vector store at scale
- [ ] Load test with realistic workloads (10K-100K decisions)
- [ ] Stress test concurrent access (100+ goroutines)
- [ ] Test memory stability over extended periods
- [ ] Validate fogfish/hnsw behavior under load
- [ ] Test error handling and recovery scenarios

**Deliverables**:
- `e2e_test.go` (~200 lines)
- Load test results
- Stability test report

**Success Criteria**:
- All integration tests pass
- Load tests show stable performance
- No memory leaks detected
- Authorization latency unchanged (<10µs p99)
- Vector store operations meet SLA targets

#### Day 3-4: Benchmarking + Performance Tuning
**Tasks**:
- [ ] Run comprehensive benchmarks (1K, 10K, 100K, 1M vectors)
- [ ] Tune fogfish/hnsw parameters (M, efConstruction, efSearch)
- [ ] Optimize memory allocations
- [ ] Profile CPU usage
- [ ] Compare performance against theoretical targets
- [ ] Document optimal configuration for different scales
- [ ] Create performance tuning guide

**Deliverables**:
- Comprehensive benchmark report
- Performance tuning guide
- Recommended configurations for different scales

**Success Criteria**:
- Search latency <0.5ms p50, <2ms p99 (100K vectors)
- Insert latency <0.1ms p99
- Memory <800MB per 1M vectors
- Throughput >50K QPS (in-memory)
- All performance targets met

#### Day 5: Final Documentation + Release
**Tasks**:
- [ ] Write comprehensive package documentation
- [ ] Update go-core README with vector store section
- [ ] Create deployment runbook
- [ ] Document configuration options and tuning
- [ ] Create troubleshooting guide
- [ ] Document fogfish/hnsw integration details
- [ ] Create migration guide (future PostgreSQL)
- [ ] Write release notes
- [ ] Tag production release (v1.1.0)

**Deliverables**:
- Complete documentation
- Deployment runbook
- Configuration guide
- Release notes

**Success Criteria**:
- All documentation reviewed and approved
- Runbook validated
- Production-ready release
- Team trained on deployment and operations

---

## 5. Future Enhancements (Post-3-6 Week Timeline)

### 5.1 Deferred to Future Releases

The following features are deferred to future releases after the initial 3-6 week implementation:

#### Product Quantization (Future: v1.2.0)
- Memory-efficient vector compression (4x-32x memory reduction)
- 4-bit, 8-bit, 16-bit codebook generation
- Quantized distance computation
- Estimated effort: 1-2 weeks

#### Advanced Features (Future: v1.3.0)
- Filtered search with metadata predicates
- Bulk import/export tools
- Index optimization and rebalancing
- Estimated effort: 1 week

#### Advanced Observability (Future: v1.4.0)
- Prometheus metrics (histograms, gauges)
- Grafana dashboards
- OpenTelemetry tracing
- Health check endpoints
- Estimated effort: 1 week

#### Production Hardening (Future: v1.5.0)
- Anomaly detection service
- Multi-tenancy support with tenant isolation
- Advanced security features
- Estimated effort: 1-2 weeks

**Total Future Enhancements**: 4-6 additional weeks (as needed based on production requirements)

---

## 6. Success Metrics (Accelerated Timeline)

### 6.1 Performance Targets

| Metric | Target | Phase 1a (Week 1) | Phase 1b (Week 2) | Phase 1c (Week 3) | Phase 2 (Week 4-5, Optional) | Phase 3 (Week 6) |
|--------|--------|-------------------|-------------------|-------------------|------------------------------|------------------|
| **Search Latency (p50)** | <0.5ms | N/A | ✅ | ✅ | <1ms | ✅ |
| **Search Latency (p99)** | <2ms | N/A | ✅ | ✅ | <5ms | ✅ |
| **Insert Latency** | <0.1ms | N/A | ✅ | ✅ | <10ms | ✅ |
| **Throughput** | 50K+ QPS | N/A | ✅ | ✅ | 10K+ | ✅ |
| **Memory (1M vectors)** | <800MB | N/A | ✅ | ✅ | N/A | ✅ |
| **Accuracy (Recall@10)** | 95%+ | N/A | ✅ | ✅ | ✅ | ✅ |
| **Test Coverage** | 90%+ | Basic | ✅ | ✅ | ✅ | ✅ |

### 6.2 Deliverables Checklist (Accelerated)

**Phase 1a - Week 1** (fogfish/hnsw Integration):
- [ ] VectorStore interface
- [ ] Configuration types
- [ ] fogfish/hnsw dependency integration
- [ ] Decision embedding implementation
- [ ] Distance metrics wrapper
- [ ] Basic unit tests

**Phase 1b - Week 2** (In-Memory Store):
- [ ] MemoryStore with fogfish/hnsw backend
- [ ] Async embedding worker
- [ ] Batch operations
- [ ] Concurrent access safety
- [ ] Prometheus metrics
- [ ] Comprehensive unit tests

**Phase 1c - Week 3** (Engine Integration):
- [ ] Engine integration
- [ ] Integration tests
- [ ] Performance benchmarks
- [ ] Authorization latency validation
- [ ] Documentation (initial)

**Phase 2 - Week 4-5** (PostgreSQL, OPTIONAL):
- [ ] PostgreSQL schema
- [ ] pgvector integration
- [ ] Batch operations
- [ ] Connection pooling
- [ ] Integration tests
- [ ] Migration tools
- [ ] Docker Compose
- [ ] PostgreSQL documentation

**Phase 3 - Week 6** (Production Ready):
- [ ] End-to-end integration tests
- [ ] Load testing and benchmarking
- [ ] Performance tuning
- [ ] Comprehensive documentation
- [ ] Deployment runbook
- [ ] Configuration guide
- [ ] Production release (v1.1.0)

**Future Enhancements** (Deferred):
- [ ] Product Quantization (v1.2.0)
- [ ] Advanced features (v1.3.0)
- [ ] Observability (v1.4.0)
- [ ] Production hardening (v1.5.0)

---

## 7. Resource Requirements

### 7.1 Team

**Recommended Team Composition**:
- 1 Senior Go Engineer (HNSW algorithm, performance optimization)
- 1 Mid-Level Go Engineer (PostgreSQL integration, testing)
- 1 DevOps Engineer (part-time, for deployment and monitoring setup)

**Optional**:
- 1 ML Engineer (for embedding optimization and anomaly detection tuning)

### 7.2 Infrastructure

**Development**:
- Local Go 1.21+ environment
- Docker Desktop (for PostgreSQL testcontainers)
- 16GB RAM (for testing with 1M vectors)

**CI/CD**:
- GitHub Actions runner with 8GB RAM
- PostgreSQL 14+ container for integration tests
- Artifact storage for benchmark results

**Staging/Production**:
- PostgreSQL 14+ with pgvector extension
- 8GB+ RAM per instance
- SSD storage
- Prometheus + Grafana for monitoring

---

## 8. Risk Management

### 8.1 Potential Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **HNSW accuracy lower than expected** | Medium | High | Implement exhaustive search fallback, tune M and ef parameters |
| **PostgreSQL performance bottleneck** | Low | High | Use connection pooling, batch inserts, read replicas |
| **Authorization latency regression** | Low | Critical | Async embedding, comprehensive benchmarks, feature flag |
| **Memory usage exceeds expectations** | Medium | Medium | Implement quantization, monitor closely |
| **pgvector extension unavailable** | Low | Medium | Provide fallback to in-memory store |
| **Schedule delays** | Medium | Low | Prioritize Phase 1-2, defer Phase 4 if needed |

### 8.2 Mitigation Strategies

1. **Weekly checkpoints**: Review progress and adjust timeline
2. **Early benchmarking**: Validate performance assumptions in Week 1
3. **Feature flags**: Enable/disable vector store without code changes
4. **Incremental rollout**: Test in dev → staging → 10% prod → 100% prod
5. **Rollback plan**: Disable vector store immediately if issues arise

---

## 9. Communication Plan

### 9.1 Weekly Updates

**Format**: Email + Slack summary
**Frequency**: Every Friday EOD
**Content**:
- Phase progress (% complete)
- Key accomplishments
- Blockers/risks
- Next week's priorities
- Performance metrics

### 9.2 Phase Completion Reviews

**Format**: Technical presentation + demo
**Frequency**: End of each phase
**Attendees**: Engineering team + stakeholders
**Content**:
- Phase deliverables review
- Performance validation
- Test coverage report
- Next phase kickoff

---

## 10. Next Steps

### 10.1 Pre-Phase 1 Setup (Week 0)

**Tasks** (before Week 1 Day 1):
- [ ] Finalize team assignments
- [ ] Set up development environments (Go 1.21+, Docker)
- [ ] Create project board (GitHub Projects or Jira)
- [ ] Schedule weekly sync meetings
- [ ] Review and approve this development plan
- [ ] Create git branch: `feature/vector-store-phase1`

**Kickoff Meeting** (1 hour):
- Review development plan
- Clarify questions
- Assign initial tasks
- Set up communication channels

### 10.2 Phase 1a Kickoff (Week 1 Day 1)

**Morning** (10am):
- Team standup
- Review fogfish/hnsw library documentation
- Study fogfish/hnsw API (1-2 hours)
- Create GitHub issues for all Week 1 tasks
- Begin implementation: VectorStore interface + config types

**Afternoon**:
- Install fogfish/hnsw dependency: `go get github.com/fogfish/hnsw`
- Pair programming session: Define interfaces
- Experiment with fogfish/hnsw example code
- Code review: Interface design
- End-of-day standup: Progress check

**Key Success Factor**: Understanding fogfish/hnsw API is critical for efficient integration

---

## 11. Conclusion

This **accelerated development plan** provides a structured roadmap for implementing the Go vector store in **3-6 weeks** by leveraging the battle-tested **fogfish/hnsw library**. This approach eliminates ~2 weeks of custom HNSW implementation (~2,000 lines of complex graph code) while delivering the same production-ready functionality.

**Key Acceleration Factors**:
- ✅ **fogfish/hnsw library**: Eliminates custom HNSW implementation (~2 weeks saved)
- ✅ **Focus on integration**: Spend time on business logic, not algorithms
- ✅ **Battle-tested implementation**: fogfish/hnsw is production-proven
- ✅ **Simplified testing**: Test integration, not HNSW internals
- ✅ **Faster iteration**: Focus on features, not low-level graph operations

**Key Principles** (Unchanged):
- ✅ Phase-based delivery (ship incrementally)
- ✅ Performance-first (benchmark continuously)
- ✅ Test-driven development (90%+ coverage)
- ✅ Zero impact on authorization (async embedding)
- ✅ Production-ready (observability, docs, runbooks)

**Accelerated Timeline Summary**:
- **Week 1**: Phase 1a (fogfish/hnsw Integration + Embedding) → Library integrated
- **Week 2**: Phase 1b (In-Memory Store + Worker) → Development-ready
- **Week 3**: Phase 1c (Engine Integration + Testing) → Production-ready (in-memory)
- **Week 4-5**: Phase 2 (PostgreSQL, OPTIONAL) → Durable storage
- **Week 6**: Phase 3 (Final Testing + Documentation) → Production release

**Comparison to Original Plan**:
| Aspect | Original (8-10 weeks) | Accelerated (3-6 weeks) | Savings |
|--------|----------------------|-------------------------|---------|
| Custom HNSW | 2 weeks (~2,000 lines) | 2-3 days (integration) | ~10 days |
| In-Memory Store | Week 1-3 | Week 1-3 | Same |
| PostgreSQL | Week 4-6 | Week 4-5 (optional) | 1 week |
| Quantization | Week 7 | Deferred to v1.2.0 | 1 week |
| Advanced Features | Week 8-10 | Deferred to v1.3-1.5 | 3 weeks |
| **Total** | **8-10 weeks** | **3-6 weeks** | **~5 weeks** |

**Risk Mitigation**:
- fogfish/hnsw is a mature, production-tested library
- Learning curve is minimal (1-2 days)
- API is well-documented
- Fallback: Can still implement custom HNSW if needed (but unlikely)

---

**Document Version**: 2.0.0 (Accelerated Timeline)
**Last Updated**: 2025-11-25
**Status**: Approved and Ready for Accelerated Implementation
**Next Update**: After Phase 1 completion (Week 3)
