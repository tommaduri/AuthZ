# Phase 2 Validation Guide

This guide provides step-by-step instructions for validating the Phase 2 (Scoped Policies) implementation.

## Prerequisites

Ensure you have the following installed:
- Go 1.21+ (`go version`)
- Protocol Buffers Compiler (`protoc --version`)
- Go protobuf plugins:
  ```bash
  go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
  go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
  ```

## Step 1: Regenerate Protobuf Code

```bash
cd /Users/tommaduri/Documents/GitHub/authz-engine/go-core

# Regenerate Go protobuf code from updated schema
protoc --go_out=. --go_opt=paths=source_relative \
  --go-grpc_out=. --go-grpc_opt=paths=source_relative \
  api/proto/authz/v1/authz.proto
```

**Expected Output:**
- Updated `api/proto/authz/v1/authz.pb.go`
- Updated `api/proto/authz/v1/authz_grpc.pb.go`

**Verify Changes:**
```bash
grep -A 5 "type Principal struct" api/proto/authz/v1/authz.pb.go
# Should show "Scope string" field
```

## Step 2: Build and Verify

```bash
# Build the entire project
go build ./...

# Expected: No compilation errors
```

**Common Issues:**
- **Import errors:** Run `go mod tidy`
- **Missing protobuf deps:** Run `go get google.golang.org/protobuf@latest`

## Step 3: Run Unit Tests

### 3.1 Scope Resolver Tests (40 tests)

```bash
go test -v ./internal/scope/

# Expected output:
# === RUN   TestBuildScopeChain
# === RUN   TestBuildScopeChain/empty_scope
# === RUN   TestBuildScopeChain/single_segment
# ... (40 tests)
# PASS
# ok      github.com/authz-engine/go-core/internal/scope  0.XXXs
```

**Success Criteria:**
- All 40 tests pass
- No panics or race conditions
- Benchmark tests complete

### 3.2 Policy Store Tests (20 tests)

```bash
go test -v ./tests/policy/

# Expected output:
# === RUN   TestFindPoliciesForScope
# === RUN   TestScopeIndexing
# ... (20 tests)
# PASS
# ok      github.com/authz-engine/go-core/tests/policy    0.XXXs
```

**Success Criteria:**
- All 20 tests pass
- Scope indexing works correctly
- Concurrent access is thread-safe

### 3.3 Engine Tests (30 tests)

```bash
go test -v ./tests/engine/

# Expected output:
# === RUN   TestCheckWithScope
# === RUN   TestScopeInheritance
# ... (30 tests)
# PASS
# ok      github.com/authz-engine/go-core/tests/engine    0.XXXs
```

**Success Criteria:**
- All 30 tests pass
- Scope resolution works correctly
- Inheritance chain is correct

### 3.4 Integration Tests (25 tests)

```bash
go test -v ./tests/integration/

# Expected output:
# === RUN   TestEndToEndScopedEvaluation
# === RUN   TestMultiTenantScenario
# ... (25 tests)
# PASS
# ok      github.com/authz-engine/go-core/tests/integration       0.XXXs
```

**Success Criteria:**
- All 25 tests pass
- Multi-tenant isolation works
- Performance targets met

## Step 4: Run All Tests Together

```bash
# Run all tests with coverage
go test -v -cover ./...

# Expected:
# ok      github.com/authz-engine/go-core/internal/scope          0.XXXs  coverage: XX.X% of statements
# ok      github.com/authz-engine/go-core/internal/policy         0.XXXs  coverage: XX.X% of statements
# ok      github.com/authz-engine/go-core/internal/engine         0.XXXs  coverage: XX.X% of statements
# ok      github.com/authz-engine/go-core/tests/policy            0.XXXs
# ok      github.com/authz-engine/go-core/tests/engine            0.XXXs
# ok      github.com/authz-engine/go-core/tests/integration       0.XXXs
```

**Success Criteria:**
- All 115+ tests pass
- Coverage > 80% for scope resolver
- Coverage > 70% for policy store
- Coverage > 75% for engine

## Step 5: Run Performance Benchmarks

### 5.1 Scope Resolver Benchmarks

```bash
go test -bench=. -benchmem ./internal/scope/

# Expected output:
# BenchmarkBuildScopeChain-8                      XXXXXXX          XXXX ns/op
# BenchmarkBuildScopeChainCached-8                XXXXXXX           XXX ns/op
# BenchmarkMatchScopeExact-8                      XXXXXXX          XXXX ns/op
# BenchmarkMatchScopeWildcard-8                   XXXXXXX          XXXX ns/op
# BenchmarkValidateScope-8                        XXXXXXX          XXXX ns/op
# BenchmarkConcurrentBuildScopeChain-8            XXXXXXX          XXXX ns/op
```

**Performance Targets:**
- `BuildScopeChain`: < 10,000 ns/op (10μs) uncached
- `BuildScopeChainCached`: < 1,000 ns/op (1μs) cached
- `MatchScopeExact`: < 100 ns/op
- `ValidateScope`: < 5,000 ns/op

### 5.2 Engine Benchmarks

```bash
go test -bench=. -benchmem ./tests/engine/

# Expected output:
# BenchmarkCheckWithScope-8                       XXXXXXX          XXXX ns/op
# BenchmarkCheckGlobal-8                          XXXXXXX          XXXX ns/op
# BenchmarkCheckWithScopeInheritance-8            XXXXXXX          XXXX ns/op
```

**Performance Targets:**
- `CheckWithScope`: < 3,000 ns/op (3μs) avg
- Should be comparable to `CheckGlobal` (< 5% overhead)
- Deep inheritance: < 5,000 ns/op (5μs)

### 5.3 Integration Benchmarks

```bash
go test -bench=. -benchmem ./tests/integration/

# Expected output:
# BenchmarkIntegrationScopedCheck-8               XXXXXXX          XXXX ns/op
# BenchmarkIntegrationScopedCheckCached-8         XXXXXXX           XXX ns/op
```

**Performance Targets:**
- Uncached: < 5,000 ns/op (5μs)
- Cached: < 500 ns/op (0.5μs)
- Throughput: > 100,000 checks/sec (uncached)
- Throughput: > 1,000,000 checks/sec (cached)

## Step 6: Validate Functional Requirements

### FR-001: Hierarchical Scope Definition

```bash
# Run specific test
go test -v -run TestBuildScopeChain ./internal/scope/

# Verify:
# ✅ Single segment: "acme"
# ✅ Multiple segments: "acme.corp.engineering"
# ✅ Max depth validation (10 levels)
# ✅ Invalid characters rejected
```

### FR-002: Scope Resolution (Most to Least Specific)

```bash
go test -v -run TestScopeInheritance ./tests/engine/

# Verify:
# ✅ Tries most specific first: "acme.corp.engineering"
# ✅ Falls back to parent: "acme.corp"
# ✅ Falls back to root: "acme"
# ✅ Returns inheritance chain in metadata
```

### FR-003: Global Policy Fallback

```bash
go test -v -run TestGlobalFallback ./tests/engine/

# Verify:
# ✅ Global policies used when no scoped policy found
# ✅ Metadata indicates "(global)" scope
# ✅ ScopedPolicyMatched = false
```

### FR-004: Wildcard Support

```bash
go test -v -run TestMatchScope ./internal/scope/

# Verify:
# ✅ Single wildcard: "acme.*" matches "acme.corp"
# ✅ Double wildcard: "acme.**" matches "acme.corp.eng"
# ✅ Can be disabled via config
```

### FR-005: Inheritance Chain in Response

```bash
go test -v -run TestScopeResolutionMetadata ./tests/engine/

# Verify:
# ✅ InheritanceChain populated
# ✅ MatchedScope indicates which scope matched
# ✅ ScopedPolicyMatched boolean correct
```

### FR-006: Scope Validation

```bash
go test -v -run TestValidateScope ./internal/scope/

# Verify:
# ✅ Empty segments rejected: "acme..corp"
# ✅ Invalid characters rejected: "acme@corp"
# ✅ Max depth enforced: > 10 levels rejected
```

### FR-007: Principal and Resource Scopes

```bash
go test -v -run TestPrincipalScope ./tests/engine/
go test -v -run TestResourceScopeTakesPrecedence ./tests/engine/

# Verify:
# ✅ Resource scope used when present
# ✅ Principal scope used as fallback
# ✅ Resource scope overrides principal scope
```

### FR-008: Scope Resolution Caching

```bash
go test -v -run TestCacheHitRate ./internal/scope/
go test -v -run TestScopeResolutionCaching ./tests/integration/

# Verify:
# ✅ Cache hit rate > 90% after warmup
# ✅ Cache hits < 1μs
# ✅ TTL expiration works
```

## Step 7: Validate Non-Functional Requirements

### NFR-001: Latency < 1ms

```bash
go test -bench=BenchmarkCheckWithScope -benchtime=10s ./tests/engine/

# Expected:
# Average latency < 3,000 ns (3μs)
# P99 latency < 10,000 ns (10μs)
```

### NFR-002: Cache Hit Rate > 95%

```bash
go test -v -run TestCacheHitRate ./internal/scope/

# Expected:
# After 10 requests: 90% hit rate
# After 100 requests: 95%+ hit rate
```

### NFR-003: Max Depth = 10

```bash
go test -v -run TestDeepScopeChain ./internal/scope/

# Expected:
# 10 levels: PASS
# 11 levels: ERROR
```

### NFR-004: Max Policies Per Scope

```bash
# Add policies to a single scope
go test -v -run TestMultiplePoliciesSameScope ./tests/policy/

# Verify:
# ✅ Multiple policies per scope supported
# ✅ O(1) lookup performance
```

### NFR-005: Fail-Closed on Invalid Scope

```bash
go test -v -run TestInvalidScopeFailsClosed ./tests/engine/

# Expected:
# Invalid scope: DENY (fail-closed)
# Metadata: matchedScope = "(invalid)"
```

## Step 8: Race Condition Testing

```bash
# Run tests with race detector
go test -race ./internal/scope/
go test -race ./internal/policy/
go test -race ./internal/engine/
go test -race ./tests/...

# Expected: No race conditions detected
```

**Common Race Conditions to Watch:**
- Scope cache concurrent access
- Policy store concurrent reads/writes
- Engine concurrent checks

## Step 9: Backwards Compatibility Testing

```bash
# Run existing Phase 1 tests
go test -v ./internal/engine/...

# Verify:
# ✅ All Phase 1 tests still pass
# ✅ No breaking changes to existing APIs
# ✅ Global policies work as before
```

## Step 10: Integration with TypeScript

### Protobuf Compatibility

```bash
# Generate TypeScript types from protobuf
cd /path/to/typescript-implementation
npm run generate-types

# Verify:
# ✅ Scope fields present in generated types
# ✅ ScopeResolution message compatible
```

### Cross-Language Testing

```bash
# Start Go gRPC server
go run cmd/server/main.go

# Run TypeScript client tests
cd /path/to/typescript-implementation
npm test -- --filter=scope

# Verify:
# ✅ Scope fields serialized correctly
# ✅ Metadata matches expected format
```

## Troubleshooting

### Issue: Tests Fail with Import Errors

```bash
# Solution: Update dependencies
go mod tidy
go get -u ./...
```

### Issue: Protobuf Generation Fails

```bash
# Solution: Install/update protoc plugins
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

# Add to PATH
export PATH="$PATH:$(go env GOPATH)/bin"
```

### Issue: Benchmarks Show Poor Performance

```bash
# Run with profiling
go test -bench=. -cpuprofile=cpu.prof ./internal/scope/
go tool pprof cpu.prof

# Analyze:
# top 10
# list BuildScopeChain
```

### Issue: Race Conditions Detected

```bash
# Run specific test with race detector
go test -race -run TestConcurrentAccess ./internal/scope/ -v

# Fix: Add proper mutex locks
```

## Success Criteria Summary

| Criterion | Target | Validation Method |
|-----------|--------|-------------------|
| All tests pass | 115/115 | `go test ./...` |
| Code coverage | > 75% | `go test -cover ./...` |
| Scope resolution | < 10μs | Benchmark uncached |
| Cache hit rate | > 95% | Test after warmup |
| Check latency | < 3μs | Benchmark scoped check |
| Throughput | > 100K/sec | Integration benchmark |
| No race conditions | 0 races | `go test -race ./...` |
| Backwards compat | All Phase 1 tests pass | `go test ./internal/engine/` |

## Final Validation Checklist

- [ ] Protobuf code regenerated successfully
- [ ] All 115+ tests pass
- [ ] No race conditions detected
- [ ] Performance benchmarks meet targets
- [ ] All 8 functional requirements validated
- [ ] All 5 non-functional requirements validated
- [ ] Backwards compatibility confirmed
- [ ] Code coverage > 75%
- [ ] Documentation complete
- [ ] Ready for code review
- [ ] Ready for integration testing

## Next Steps After Validation

1. **Code Review:** Submit PR with implementation summary
2. **Integration Testing:** Test with TypeScript implementation
3. **Performance Testing:** Run under production load
4. **Security Review:** Validate scope injection prevention
5. **Documentation:** Update API documentation
6. **Deployment:** Deploy to staging environment

---

**For Questions or Issues:**
- Review: `docs/PHASE2_IMPLEMENTATION_SUMMARY.md`
- Tests: All test files in `tests/` directory
- Code: `internal/scope/`, `internal/policy/`, `internal/engine/`
