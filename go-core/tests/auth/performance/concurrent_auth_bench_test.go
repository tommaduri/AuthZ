package performance

import (
	"sync"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/auth"
	auth_test "github.com/authz-engine/go-core/tests/auth"
	"github.com/stretchr/testify/require"
)

// BenchmarkConcurrent_1000_Validations benchmarks 1000 concurrent validations
func BenchmarkConcurrent_1000_Validations(b *testing.B) {
	keyPair := auth_test.GenerateTestKeyPair(&testing.T{})
	config := &auth.JWTConfig{
		PublicKey: keyPair.PublicKeyPEM,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	}

	validator, err := auth.NewJWTValidator(config)
	require.NoError(b, err)
	defer validator.Close()

	claims := auth_test.DefaultTestClaims()
	tokenString := auth_test.GenerateTestToken(&testing.T{}, keyPair, claims)

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		var wg sync.WaitGroup
		wg.Add(1000)

		for j := 0; j < 1000; j++ {
			go func() {
				defer wg.Done()
				_, err := validator.Validate(tokenString)
				if err != nil {
					b.Error(err)
				}
			}()
		}

		wg.Wait()
	}
}

// TestConcurrentValidation_Throughput measures authentication throughput
func TestConcurrentValidation_Throughput(t *testing.T) {
	keyPair := auth_test.GenerateTestKeyPair(t)
	config := &auth.JWTConfig{
		PublicKey: keyPair.PublicKeyPEM,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	}

	validator, err := auth.NewJWTValidator(config)
	require.NoError(t, err)
	defer validator.Close()

	claims := auth_test.DefaultTestClaims()
	tokenString := auth_test.GenerateTestToken(t, keyPair, claims)

	// Run for 5 seconds and count successful validations
	duration := 5 * time.Second
	deadline := time.Now().Add(duration)

	var (
		successCount int64
		errorCount   int64
		mu           sync.Mutex
		wg           sync.WaitGroup
	)

	// Spawn 100 workers
	workers := 100
	wg.Add(workers)

	for i := 0; i < workers; i++ {
		go func() {
			defer wg.Done()
			for time.Now().Before(deadline) {
				_, err := validator.Validate(tokenString)
				mu.Lock()
				if err == nil {
					successCount++
				} else {
					errorCount++
				}
				mu.Unlock()
			}
		}()
	}

	wg.Wait()

	// Calculate throughput
	throughput := float64(successCount) / duration.Seconds()

	t.Logf("Throughput: %.2f validations/second", throughput)
	t.Logf("Successful: %d, Errors: %d", successCount, errorCount)

	// Target: >10,000 validations/second
	require.Greater(t, throughput, 10000.0, "Throughput should exceed 10,000 req/sec")
	require.Equal(t, int64(0), errorCount, "Should have zero errors")
}

// BenchmarkMemoryAllocation measures memory allocation per validation
func BenchmarkMemoryAllocation(b *testing.B) {
	keyPair := auth_test.GenerateTestKeyPair(&testing.T{})
	config := &auth.JWTConfig{
		PublicKey: keyPair.PublicKeyPEM,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	}

	validator, err := auth.NewJWTValidator(config)
	require.NoError(b, err)
	defer validator.Close()

	claims := auth_test.DefaultTestClaims()
	tokenString := auth_test.GenerateTestToken(&testing.T{}, keyPair, claims)

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		_, err := validator.Validate(tokenString)
		if err != nil {
			b.Fatal(err)
		}
	}

	// Target: <1KB memory per validation
}

// BenchmarkValidatorCreation benchmarks validator initialization
func BenchmarkValidatorCreation(b *testing.B) {
	keyPair := auth_test.GenerateTestKeyPair(&testing.T{})
	config := &auth.JWTConfig{
		PublicKey: keyPair.PublicKeyPEM,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	}

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		validator, err := auth.NewJWTValidator(config)
		if err != nil {
			b.Fatal(err)
		}
		validator.Close()
	}
}
