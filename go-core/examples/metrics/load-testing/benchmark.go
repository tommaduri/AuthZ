package main

import (
	"context"
	"fmt"
	"math/rand"
	"sync"
	"testing"
	"time"
)

// Mock authorization checker for benchmarking
type AuthorizationChecker struct {
	cache    map[string]bool
	cacheMu  sync.RWMutex
	hitCount int64
}

func NewAuthorizationChecker() *AuthorizationChecker {
	return &AuthorizationChecker{
		cache: make(map[string]bool),
	}
}

// AuthRequest represents an authorization check request
type AuthRequest struct {
	Subject  string
	Action   string
	Resource string
	Context  map[string]interface{}
}

// AuthResponse represents an authorization check response
type AuthResponse struct {
	Allowed bool
	Cached  bool
	Latency time.Duration
}

// Check performs an authorization check
func (ac *AuthorizationChecker) Check(ctx context.Context, req AuthRequest) (*AuthResponse, error) {
	start := time.Now()

	// Generate cache key
	cacheKey := fmt.Sprintf("%s:%s:%s", req.Subject, req.Action, req.Resource)

	// Check cache first
	ac.cacheMu.RLock()
	if allowed, found := ac.cache[cacheKey]; found {
		ac.cacheMu.RUnlock()
		latency := time.Since(start)
		return &AuthResponse{
			Allowed: allowed,
			Cached:  true,
			Latency: latency,
		}, nil
	}
	ac.cacheMu.RUnlock()

	// Simulate policy evaluation (in real implementation, this would call the engine)
	allowed := evaluatePolicy(req)

	// Store in cache
	ac.cacheMu.Lock()
	ac.cache[cacheKey] = allowed
	ac.cacheMu.Unlock()

	latency := time.Since(start)
	return &AuthResponse{
		Allowed: allowed,
		Cached:  false,
		Latency: latency,
	}, nil
}

// CheckWithoutCache performs authorization check without caching
func (ac *AuthorizationChecker) CheckWithoutCache(ctx context.Context, req AuthRequest) (*AuthResponse, error) {
	start := time.Now()

	allowed := evaluatePolicy(req)

	latency := time.Since(start)
	return &AuthResponse{
		Allowed: allowed,
		Cached:  false,
		Latency: latency,
	}, nil
}

// ClearCache clears the authorization cache
func (ac *AuthorizationChecker) ClearCache() {
	ac.cacheMu.Lock()
	ac.cache = make(map[string]bool)
	ac.cacheMu.Unlock()
}

// evaluatePolicy simulates policy evaluation logic
func evaluatePolicy(req AuthRequest) bool {
	// Simulate some computation time
	time.Sleep(time.Microsecond * time.Duration(rand.Intn(5)+1))

	// Simple policy: viewers can read, editors can write, admins can do anything
	policy, ok := req.Context["policy"].(string)
	if !ok {
		return false
	}

	switch policy {
	case "viewer":
		return req.Action == "read"
	case "editor":
		return req.Action == "read" || req.Action == "write"
	case "admin":
		return true
	default:
		return false
	}
}

// generateRandomRequest generates a random authorization request
func generateRandomRequest() AuthRequest {
	subjects := []string{"user:alice@example.com", "user:bob@example.com", "user:charlie@example.com"}
	actions := []string{"read", "write", "delete", "admin"}
	resources := []string{"document:123", "document:456", "folder:789", "project:abc"}
	policies := []string{"viewer", "editor", "admin"}

	return AuthRequest{
		Subject:  subjects[rand.Intn(len(subjects))],
		Action:   actions[rand.Intn(len(actions))],
		Resource: resources[rand.Intn(len(resources))],
		Context: map[string]interface{}{
			"policy":     policies[rand.Intn(len(policies))],
			"ip_address": fmt.Sprintf("192.168.1.%d", rand.Intn(255)),
			"timestamp":  time.Now().UTC().Format(time.RFC3339),
		},
	}
}

// Benchmark: Single authorization check
func BenchmarkAuthorizationCheck(b *testing.B) {
	checker := NewAuthorizationChecker()
	ctx := context.Background()

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		req := generateRandomRequest()
		_, err := checker.Check(ctx, req)
		if err != nil {
			b.Fatalf("Authorization check failed: %v", err)
		}
	}
}

// Benchmark: Authorization check with cache
func BenchmarkAuthorizationCheckCached(b *testing.B) {
	checker := NewAuthorizationChecker()
	ctx := context.Background()

	// Pre-populate cache with a single request
	fixedReq := AuthRequest{
		Subject:  "user:cached@example.com",
		Action:   "read",
		Resource: "document:cached",
		Context: map[string]interface{}{
			"policy": "viewer",
		},
	}

	// Warm up cache
	checker.Check(ctx, fixedReq)

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		_, err := checker.Check(ctx, fixedReq)
		if err != nil {
			b.Fatalf("Cached authorization check failed: %v", err)
		}
	}
}

// Benchmark: Authorization check without cache
func BenchmarkAuthorizationCheckNoCacheExplicit(b *testing.B) {
	checker := NewAuthorizationChecker()
	ctx := context.Background()

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		req := generateRandomRequest()
		_, err := checker.CheckWithoutCache(ctx, req)
		if err != nil {
			b.Fatalf("Authorization check without cache failed: %v", err)
		}
	}
}

// Benchmark: Concurrent authorization checks
func BenchmarkAuthorizationCheckConcurrent(b *testing.B) {
	checker := NewAuthorizationChecker()
	ctx := context.Background()

	concurrency := 100

	b.ResetTimer()
	b.ReportAllocs()

	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			req := generateRandomRequest()
			_, err := checker.Check(ctx, req)
			if err != nil {
				b.Fatalf("Concurrent authorization check failed: %v", err)
			}
		}
	})
}

// Benchmark: Different policy types
func BenchmarkAuthorizationCheckByPolicy(b *testing.B) {
	checker := NewAuthorizationChecker()
	ctx := context.Background()
	policies := []string{"viewer", "editor", "admin"}

	for _, policy := range policies {
		b.Run(policy, func(b *testing.B) {
			b.ReportAllocs()

			for i := 0; i < b.N; i++ {
				req := AuthRequest{
					Subject:  "user:test@example.com",
					Action:   "read",
					Resource: "document:123",
					Context: map[string]interface{}{
						"policy": policy,
					},
				}

				_, err := checker.Check(ctx, req)
				if err != nil {
					b.Fatalf("Policy-specific check failed: %v", err)
				}
			}
		})
	}
}

// Benchmark: Cache performance with different hit rates
func BenchmarkAuthorizationCheckCacheHitRates(b *testing.B) {
	checker := NewAuthorizationChecker()
	ctx := context.Background()

	hitRates := []float64{0.0, 0.25, 0.50, 0.75, 0.90, 0.99}

	for _, hitRate := range hitRates {
		b.Run(fmt.Sprintf("HitRate_%.0f", hitRate*100), func(b *testing.B) {
			checker.ClearCache()

			// Pre-populate cache
			fixedReq := AuthRequest{
				Subject:  "user:cached@example.com",
				Action:   "read",
				Resource: "document:cached",
				Context: map[string]interface{}{
					"policy": "viewer",
				},
			}
			checker.Check(ctx, fixedReq)

			b.ResetTimer()
			b.ReportAllocs()

			for i := 0; i < b.N; i++ {
				var req AuthRequest
				if rand.Float64() < hitRate {
					// Use cached request
					req = fixedReq
				} else {
					// Generate new request
					req = generateRandomRequest()
				}

				_, err := checker.Check(ctx, req)
				if err != nil {
					b.Fatalf("Cache hit rate check failed: %v", err)
				}
			}
		})
	}
}

// Benchmark: Batch authorization checks
func BenchmarkAuthorizationCheckBatch(b *testing.B) {
	checker := NewAuthorizationChecker()
	ctx := context.Background()

	batchSizes := []int{1, 10, 50, 100, 500}

	for _, size := range batchSizes {
		b.Run(fmt.Sprintf("BatchSize_%d", size), func(b *testing.B) {
			b.ReportAllocs()

			for i := 0; i < b.N; i++ {
				var wg sync.WaitGroup
				wg.Add(size)

				for j := 0; j < size; j++ {
					go func() {
						defer wg.Done()
						req := generateRandomRequest()
						_, err := checker.Check(ctx, req)
						if err != nil {
							b.Errorf("Batch check failed: %v", err)
						}
					}()
				}

				wg.Wait()
			}
		})
	}
}

// Benchmark: Memory allocation patterns
func BenchmarkAuthorizationCheckAllocations(b *testing.B) {
	checker := NewAuthorizationChecker()
	ctx := context.Background()

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		req := AuthRequest{
			Subject:  "user:test@example.com",
			Action:   "read",
			Resource: "document:123",
			Context: map[string]interface{}{
				"policy":     "viewer",
				"ip_address": "192.168.1.1",
				"timestamp":  time.Now().UTC().Format(time.RFC3339),
			},
		}

		_, err := checker.Check(ctx, req)
		if err != nil {
			b.Fatalf("Allocation benchmark failed: %v", err)
		}
	}
}

// Benchmark: Latency distribution analysis
func BenchmarkAuthorizationCheckLatencyDistribution(b *testing.B) {
	checker := NewAuthorizationChecker()
	ctx := context.Background()

	latencies := make([]time.Duration, 0, b.N)

	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		req := generateRandomRequest()
		start := time.Now()
		_, err := checker.Check(ctx, req)
		latency := time.Since(start)

		if err != nil {
			b.Fatalf("Latency benchmark failed: %v", err)
		}

		latencies = append(latencies, latency)
	}

	// Calculate percentiles
	if len(latencies) > 0 {
		// Sort latencies for percentile calculation
		// Note: This is simplified; production code should use proper sorting
		var total time.Duration
		for _, lat := range latencies {
			total += lat
		}

		avg := total / time.Duration(len(latencies))
		b.Logf("Average latency: %v", avg)
		b.Logf("Target SLO: p99 < 10µs")
	}
}

// Main function for running benchmarks standalone
func main() {
	fmt.Println("Authorization Engine - Benchmark Suite")
	fmt.Println("========================================")
	fmt.Println()
	fmt.Println("Run benchmarks with:")
	fmt.Println("  go test -bench=. -benchmem -benchtime=10s")
	fmt.Println()
	fmt.Println("Available benchmarks:")
	fmt.Println("  - BenchmarkAuthorizationCheck")
	fmt.Println("  - BenchmarkAuthorizationCheckCached")
	fmt.Println("  - BenchmarkAuthorizationCheckNoCacheExplicit")
	fmt.Println("  - BenchmarkAuthorizationCheckConcurrent")
	fmt.Println("  - BenchmarkAuthorizationCheckByPolicy")
	fmt.Println("  - BenchmarkAuthorizationCheckCacheHitRates")
	fmt.Println("  - BenchmarkAuthorizationCheckBatch")
	fmt.Println("  - BenchmarkAuthorizationCheckAllocations")
	fmt.Println("  - BenchmarkAuthorizationCheckLatencyDistribution")
	fmt.Println()
	fmt.Println("Detailed results:")
	fmt.Println("  go test -bench=. -benchmem -cpuprofile=cpu.prof -memprofile=mem.prof")
	fmt.Println("  go tool pprof cpu.prof")
	fmt.Println("  go tool pprof mem.prof")
}
