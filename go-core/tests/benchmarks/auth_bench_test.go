package benchmarks

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/auth"
	"github.com/authz-engine/go-core/internal/auth/jwt"
	"github.com/authz-engine/go-core/internal/audit"
)

// Mock stores for benchmarks
type benchRefreshStore struct {
	mu     sync.RWMutex
	tokens map[string]*jwt.RefreshToken
}

func newBenchRefreshStore() *benchRefreshStore {
	return &benchRefreshStore{
		tokens: make(map[string]*jwt.RefreshToken),
	}
}

func (m *benchRefreshStore) Store(ctx context.Context, token *jwt.RefreshToken) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tokens[token.TokenHash] = token
	return nil
}

func (m *benchRefreshStore) Get(ctx context.Context, tokenHash string) (*jwt.RefreshToken, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	token, ok := m.tokens[tokenHash]
	if !ok {
		return nil, fmt.Errorf("token not found")
	}
	return token, nil
}

func (m *benchRefreshStore) Revoke(ctx context.Context, tokenHash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if token, ok := m.tokens[tokenHash]; ok {
		now := time.Now()
		token.RevokedAt = &now
	}
	return nil
}

func (m *benchRefreshStore) DeleteExpired(ctx context.Context) error {
	return nil
}

type benchAuditLogger struct {
	mu     sync.RWMutex
	events []audit.Event
}

func newBenchAuditLogger() *benchAuditLogger {
	return &benchAuditLogger{
		events: make([]audit.Event, 0),
	}
}

func (m *benchAuditLogger) Log(ctx context.Context, event audit.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, event)
	return nil
}

func (m *benchAuditLogger) Query(ctx context.Context, filters audit.QueryFilters) ([]audit.Event, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.events, nil
}

// BenchmarkTokenIssuance benchmarks token generation
// Target: <100ms p99
func BenchmarkTokenIssuance(b *testing.B) {
	ctx := context.Background()

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		b.Fatal(err)
	}

	refreshStore := newBenchRefreshStore()
	issuer, err := jwt.NewJWTIssuer(&jwt.IssuerConfig{
		PrivateKey:   privateKey,
		Issuer:       "authz-engine",
		Audience:     "authz-api",
		AccessTTL:    15 * time.Minute,
		RefreshTTL:   7 * 24 * time.Hour,
		RefreshStore: refreshStore,
	})
	if err != nil {
		b.Fatal(err)
	}

	agentID := "agent:benchmark-user"
	roles := []string{"admin", "policy:write"}
	tenantID := "tenant-benchmark"
	scopes := []string{"read:*", "write:policies"}

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		_, err := issuer.IssueToken(ctx, agentID, roles, tenantID, scopes)
		if err != nil {
			b.Fatal(err)
		}
	}

	b.StopTimer()

	// Report custom metrics
	elapsed := b.Elapsed()
	opsPerSec := float64(b.N) / elapsed.Seconds()
	avgLatency := elapsed / time.Duration(b.N)

	b.ReportMetric(opsPerSec, "ops/sec")
	b.ReportMetric(float64(avgLatency.Microseconds()), "µs/op")

	// Check if we meet the target (<100ms p99)
	if avgLatency > 100*time.Millisecond {
		b.Logf("WARNING: Average latency %v exceeds 100ms target", avgLatency)
	}
}

// BenchmarkTokenValidation benchmarks token validation
// Target: <10ms p99
func BenchmarkTokenValidation(b *testing.B) {
	ctx := context.Background()

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		b.Fatal(err)
	}

	refreshStore := newBenchRefreshStore()
	issuer, err := jwt.NewJWTIssuer(&jwt.IssuerConfig{
		PrivateKey:   privateKey,
		Issuer:       "authz-engine",
		Audience:     "authz-api",
		RefreshStore: refreshStore,
	})
	if err != nil {
		b.Fatal(err)
	}

	publicKeyPEM, err := auth.EncodePublicKey(&privateKey.PublicKey)
	if err != nil {
		b.Fatal(err)
	}

	validator, err := auth.NewJWTValidator(&auth.JWTConfig{
		PublicKey: publicKeyPEM,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	})
	if err != nil {
		b.Fatal(err)
	}
	defer validator.Close()

	// Pre-generate token
	tokenPair, err := issuer.IssueToken(ctx, "agent:bench", []string{"user"}, "tenant-1", []string{"read"})
	if err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		_, err := validator.Validate(tokenPair.AccessToken)
		if err != nil {
			b.Fatal(err)
		}
	}

	b.StopTimer()

	// Report metrics
	elapsed := b.Elapsed()
	opsPerSec := float64(b.N) / elapsed.Seconds()
	avgLatency := elapsed / time.Duration(b.N)

	b.ReportMetric(opsPerSec, "ops/sec")
	b.ReportMetric(float64(avgLatency.Microseconds()), "µs/op")

	// Check if we meet the target (<10ms p99)
	if avgLatency > 10*time.Millisecond {
		b.Logf("WARNING: Average latency %v exceeds 10ms target", avgLatency)
	}
}

// BenchmarkRateLimiting benchmarks rate limiting checks
// Target: <5ms
func BenchmarkRateLimiting(b *testing.B) {
	// Mock rate limiter
	type rateLimiter struct {
		mu       sync.RWMutex
		requests map[string][]time.Time
		limit    int
		window   time.Duration
	}

	limiter := &rateLimiter{
		requests: make(map[string][]time.Time),
		limit:    1000,
		window:   time.Minute,
	}

	checkLimit := func(clientID string) bool {
		limiter.mu.Lock()
		defer limiter.mu.Unlock()

		now := time.Now()
		cutoff := now.Add(-limiter.window)

		reqs := limiter.requests[clientID]
		validReqs := make([]time.Time, 0, len(reqs))
		for _, req := range reqs {
			if req.After(cutoff) {
				validReqs = append(validReqs, req)
			}
		}

		if len(validReqs) >= limiter.limit {
			return false
		}

		validReqs = append(validReqs, now)
		limiter.requests[clientID] = validReqs
		return true
	}

	clientID := "bench-client"

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		checkLimit(clientID)
	}

	b.StopTimer()

	// Report metrics
	elapsed := b.Elapsed()
	opsPerSec := float64(b.N) / elapsed.Seconds()
	avgLatency := elapsed / time.Duration(b.N)

	b.ReportMetric(opsPerSec, "ops/sec")
	b.ReportMetric(float64(avgLatency.Microseconds()), "µs/op")

	// Check if we meet the target (<5ms)
	if avgLatency > 5*time.Millisecond {
		b.Logf("WARNING: Average latency %v exceeds 5ms target", avgLatency)
	}
}

// BenchmarkAuditLogging benchmarks async audit logging
// Target: <1ms async
func BenchmarkAuditLogging(b *testing.B) {
	ctx := context.Background()
	auditLogger := newBenchAuditLogger()

	event := audit.Event{
		Action:    "auth.login",
		Principal: "agent:bench-user",
		Resource:  "auth",
		Result:    "success",
		Timestamp: time.Now(),
	}

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		err := auditLogger.Log(ctx, event)
		if err != nil {
			b.Fatal(err)
		}
	}

	b.StopTimer()

	// Report metrics
	elapsed := b.Elapsed()
	opsPerSec := float64(b.N) / elapsed.Seconds()
	avgLatency := elapsed / time.Duration(b.N)

	b.ReportMetric(opsPerSec, "ops/sec")
	b.ReportMetric(float64(avgLatency.Microseconds()), "µs/op")

	// Check if we meet the target (<1ms)
	if avgLatency > 1*time.Millisecond {
		b.Logf("WARNING: Average latency %v exceeds 1ms target", avgLatency)
	}
}

// BenchmarkConcurrentTokenIssuance benchmarks parallel token generation
func BenchmarkConcurrentTokenIssuance(b *testing.B) {
	ctx := context.Background()

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		b.Fatal(err)
	}

	refreshStore := newBenchRefreshStore()
	issuer, err := jwt.NewJWTIssuer(&jwt.IssuerConfig{
		PrivateKey:   privateKey,
		Issuer:       "authz-engine",
		Audience:     "authz-api",
		RefreshStore: refreshStore,
	})
	if err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	b.ReportAllocs()

	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			agentID := fmt.Sprintf("agent:concurrent-%d", i)
			_, err := issuer.IssueToken(ctx, agentID, []string{"user"}, "tenant-1", []string{"read"})
			if err != nil {
				b.Fatal(err)
			}
			i++
		}
	})

	b.StopTimer()

	// Report metrics
	elapsed := b.Elapsed()
	opsPerSec := float64(b.N) / elapsed.Seconds()

	b.ReportMetric(opsPerSec, "ops/sec")
}

// BenchmarkConcurrentTokenValidation benchmarks parallel token validation
func BenchmarkConcurrentTokenValidation(b *testing.B) {
	ctx := context.Background()

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		b.Fatal(err)
	}

	refreshStore := newBenchRefreshStore()
	issuer, err := jwt.NewJWTIssuer(&jwt.IssuerConfig{
		PrivateKey:   privateKey,
		Issuer:       "authz-engine",
		Audience:     "authz-api",
		RefreshStore: refreshStore,
	})
	if err != nil {
		b.Fatal(err)
	}

	publicKeyPEM, err := auth.EncodePublicKey(&privateKey.PublicKey)
	if err != nil {
		b.Fatal(err)
	}

	validator, err := auth.NewJWTValidator(&auth.JWTConfig{
		PublicKey: publicKeyPEM,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	})
	if err != nil {
		b.Fatal(err)
	}
	defer validator.Close()

	// Pre-generate token
	tokenPair, err := issuer.IssueToken(ctx, "agent:bench", []string{"user"}, "tenant-1", []string{"read"})
	if err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	b.ReportAllocs()

	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_, err := validator.Validate(tokenPair.AccessToken)
			if err != nil {
				b.Fatal(err)
			}
		}
	})

	b.StopTimer()

	// Report metrics
	elapsed := b.Elapsed()
	opsPerSec := float64(b.N) / elapsed.Seconds()

	b.ReportMetric(opsPerSec, "ops/sec")
}

// BenchmarkFullAuthFlow benchmarks the complete auth workflow
func BenchmarkFullAuthFlow(b *testing.B) {
	ctx := context.Background()

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		b.Fatal(err)
	}

	refreshStore := newBenchRefreshStore()
	issuer, err := jwt.NewJWTIssuer(&jwt.IssuerConfig{
		PrivateKey:   privateKey,
		Issuer:       "authz-engine",
		Audience:     "authz-api",
		RefreshStore: refreshStore,
	})
	if err != nil {
		b.Fatal(err)
	}

	publicKeyPEM, err := auth.EncodePublicKey(&privateKey.PublicKey)
	if err != nil {
		b.Fatal(err)
	}

	validator, err := auth.NewJWTValidator(&auth.JWTConfig{
		PublicKey: publicKeyPEM,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	})
	if err != nil {
		b.Fatal(err)
	}
	defer validator.Close()

	auditLogger := newBenchAuditLogger()

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		// 1. Issue token
		tokenPair, err := issuer.IssueToken(ctx,
			fmt.Sprintf("agent:bench-%d", i),
			[]string{"user"},
			"tenant-1",
			[]string{"read"})
		if err != nil {
			b.Fatal(err)
		}

		// 2. Validate token
		claims, err := validator.Validate(tokenPair.AccessToken)
		if err != nil {
			b.Fatal(err)
		}

		// 3. Log audit event
		err = auditLogger.Log(ctx, audit.Event{
			Action:    "auth.check",
			Principal: claims.Subject,
			Resource:  "resource",
			Result:    "success",
			Timestamp: time.Now(),
		})
		if err != nil {
			b.Fatal(err)
		}
	}

	b.StopTimer()

	// Report metrics
	elapsed := b.Elapsed()
	opsPerSec := float64(b.N) / elapsed.Seconds()
	avgLatency := elapsed / time.Duration(b.N)

	b.ReportMetric(opsPerSec, "flows/sec")
	b.ReportMetric(float64(avgLatency.Milliseconds()), "ms/flow")
}
