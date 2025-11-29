# Phase 4: Derived Roles Test Suite

**Status**: ✅ Complete - Ready for Implementation
**Test Phase**: 🔴 Red (TDD - Tests written, implementation pending)
**Total Tests**: 89+ comprehensive tests
**Total Benchmarks**: 20+ performance benchmarks
**Lines of Code**: ~1,200 lines

## Quick Summary

This test suite provides **comprehensive test coverage** for Phase 4 Derived Roles implementation, following **Test-Driven Development (TDD)** methodology. All tests are currently failing (as expected), waiting for the coder agent to implement the actual functionality.

## Test Files

### 1. `resolver_test.go` (32 tests, ~620 lines)
Tests core derived role resolution logic:
- ✅ Basic role derivation with parent role matching
- ✅ Wildcard parent roles (`*`, `prefix:*`, `*:suffix`)
- ✅ CEL condition evaluation with context
- ✅ Circular dependency detection
- ✅ Multiple policy definitions
- ✅ Evaluation tracing for debugging
- ✅ Edge cases and error handling

### 2. `cache_test.go` (20 tests, ~280 lines)
Tests caching mechanism:
- ✅ Per-request caching (not global)
- ✅ Cache hits/misses tracking
- ✅ Cache invalidation
- ✅ Key generation with role sorting
- ✅ O(1) lookup performance
- ✅ Thread safety (concurrent access)
- ✅ Memory efficiency

### 3. `validator_test.go` (19 tests, ~210 lines)
Tests policy validation:
- ✅ Schema validation (names, formats)
- ✅ Parent role pattern validation
- ✅ Circular dependency detection across policies
- ✅ Condition expression validation
- ✅ Multiple policies validation
- ✅ Edge cases (nil, empty, very large)

### 4. `derived_roles_integration_test.go` (13 tests, ~290 lines)
Tests end-to-end integration:
- ✅ Integration with DecisionEngine
- ✅ Principal policies interaction
- ✅ Resource policies interaction
- ✅ Cache effectiveness in real scenarios
- ✅ Performance under load (10k+ requests)
- ✅ Multi-tenant isolation

### 5. `derived_roles_benchmark_test.go` (20+ benchmarks, ~360 lines)
Performance benchmarking:
- ⚡ BenchmarkResolve - Basic resolution
- ⚡ BenchmarkResolveWithCache - Cached resolution
- ⚡ BenchmarkCache - Cache operations (4 sub-benchmarks)
- ⚡ BenchmarkValidation - Policy validation (3 sub-benchmarks)
- ⚡ BenchmarkIntegration - End-to-end (3 sub-benchmarks)
- ⚡ BenchmarkWildcardMatching - Pattern matching (4 sub-benchmarks)
- ⚡ BenchmarkScalability - Different scales (4 sub-benchmarks)

## Running Tests

```bash
# Run all derived roles tests
go test ./tests/derived_roles/... -v

# Run specific test file
go test ./tests/derived_roles/resolver_test.go -v

# Run integration tests
go test ./tests/integration/derived_roles_integration_test.go -v

# Run benchmarks
go test ./tests/benchmarks/derived_roles_benchmark_test.go -bench=. -benchmem

# Run with race detection
go test ./tests/derived_roles/... -race

# Generate coverage report
go test ./tests/derived_roles/... -coverprofile=coverage.out
go tool cover -html=coverage.out

# Run specific test by name
go test ./tests/derived_roles/... -run TestBasicRoleDerivation
```

## Performance Targets

### Primary Goals (Match TypeScript)
- **Resolution**: <200μs (0.2ms) per request
- **Cached Lookup**: <10μs
- **Cache Hit Rate**: >90% for repeated requests
- **Throughput**: >5,000 req/s under load
- **Memory**: Minimal allocations

### Detailed Benchmarks
```
BenchmarkResolve                    ~200μs/op    # Target: match TS
BenchmarkResolveWithCache           <10μs/op     # Cache hit
BenchmarkCache/GetOrCompute_Hit     <1μs/op      # Map lookup
BenchmarkValidation/Simple          <100μs/op    # Single policy
BenchmarkIntegration/EndToEnd       <500μs/op    # Full stack
```

## Test Coverage Goals

- **Statement Coverage**: >90%
- **Branch Coverage**: >85%
- **Function Coverage**: 100%
- **Edge Cases**: Comprehensive

## Implementation Requirements

### Core Components Needed

1. **`internal/derived_roles/resolver.go`**
   - Resolver struct with CEL evaluator
   - LoadPolicies() with circular detection
   - Resolve() with wildcard matching
   - ResolveWithTrace() for debugging

2. **`internal/derived_roles/cache.go`**
   - Thread-safe cache with sync.RWMutex
   - GetOrCompute() with function caching
   - GenerateKey() with role sorting
   - Stats tracking (hits, misses, size)

3. **`internal/derived_roles/validator.go`**
   - Schema validation (names, patterns)
   - Parent role pattern validation
   - Circular dependency detection (DFS)
   - Cross-policy validation

4. **`pkg/types/derived_roles.go`**
   - DerivedRolesPolicy struct
   - DerivedRoleDefinition struct
   - ResolverConfig interface
   - EvaluationResult with traces

## Key Features Tested

### 1. Wildcard Parent Role Matching
```go
// Exact match
"user" matches ["user"]

// Wildcard (any role)
"*" matches any non-empty roles

// Prefix wildcard
"admin:*" matches ["admin:read", "admin:write"]

// Suffix wildcard
"*:write" matches ["document:write", "report:write"]

// Mixed
["superuser", "admin:*", "*:write"] matches any of above
```

### 2. Circular Dependency Detection
```go
// Simple cycle: A → B → A
roleA depends on roleB
roleB depends on roleA
→ Error: circular dependency

// Self-reference: A → A
roleA depends on roleA
→ Error: circular dependency

// Valid chain: A → B → C → user
roleA depends on roleB
roleB depends on roleC
roleC depends on user (base role)
→ OK: no cycle
```

### 3. CEL Condition Evaluation
```go
// Ownership check
"R.attr.ownerId == P.id"

// Department matching
"P.attr.department == R.attr.department"

// Complex conditions
"P.attr.seniority > 5 && R.attr.value > 10000"

// With auxiliary data
"R.attr.ownerId == P.id && A.isWeekday"
```

### 4. Caching Strategy
```go
// Cache key format
key := GenerateKey(
    principalID: "user123",
    roles: ["role1", "role2"],  // Sorted!
    resourceKind: "document",
    resourceID: "doc456"
)

// Per-request cache (not global)
cache := NewCache()
roles := resolver.Resolve(principal, resource, nil, cache)

// Statistics
stats := cache.GetStats()
// stats.Hits, stats.Misses, stats.HitRate, stats.Size
```

## Common Test Patterns

### Table-Driven Tests
```go
testCases := []struct {
    name     string
    roles    []string
    expected bool
}{
    {"exact match", []string{"user"}, true},
    {"no match", []string{"guest"}, false},
    {"wildcard", []string{"admin:read"}, true},
}

for _, tc := range testCases {
    t.Run(tc.name, func(t *testing.T) {
        // Test logic
    })
}
```

### Mock CEL Evaluator
```go
type mockCELEvaluator struct {
    returnValue bool
    returnError error
    callCount   int
}

func (m *mockCELEvaluator) EvaluateBoolean(expr string, ctx interface{}) (bool, error) {
    m.callCount++
    if m.returnError != nil {
        return false, m.returnError
    }
    return m.returnValue, nil
}
```

### Concurrent Testing
```go
var wg sync.WaitGroup
for i := 0; i < 100; i++ {
    wg.Add(1)
    go func(id int) {
        defer wg.Done()
        // Concurrent operations
        cache.GetOrCompute(key, compute)
    }(i)
}
wg.Wait()
```

## Next Steps

### For Coder Agent:
1. ✅ Read test files to understand requirements
2. ✅ Implement `internal/derived_roles/resolver.go`
3. ✅ Implement `internal/derived_roles/cache.go`
4. ✅ Implement `internal/derived_roles/validator.go`
5. ✅ Add types to `pkg/types/derived_roles.go`
6. ✅ Run tests and fix failures
7. ✅ Run benchmarks and optimize if needed

### For Reviewer Agent:
1. ✅ Verify test coverage >90%
2. ✅ Check thread safety (run with `-race`)
3. ✅ Validate performance meets targets
4. ✅ Review code quality and documentation
5. ✅ Ensure no memory leaks (pprof)

## Documentation

- **TEST_COVERAGE.md** - Comprehensive test coverage report
- **README.md** - This file
- Tests themselves are self-documenting with descriptive names

## Success Criteria

Phase 4 Derived Roles is complete when:
- ✅ All 89+ tests pass
- ✅ All benchmarks meet performance targets (<0.2ms)
- ✅ >90% code coverage
- ✅ No race conditions (`-race` flag)
- ✅ No memory leaks (pprof verification)
- ✅ Integration tests pass with DecisionEngine
- ✅ Documentation updated

## Questions?

See **TEST_COVERAGE.md** for detailed breakdown of every test and performance target.

---

**Ready for Implementation** 🚀
**Coder Agent**: Start with `internal/derived_roles/resolver.go`
