package performance

import (
	"testing"

	"github.com/authz-engine/go-core/internal/auth"
	auth_test "github.com/authz-engine/go-core/tests/auth"
	"github.com/stretchr/testify/require"
)

// BenchmarkJWTValidation_RS256 benchmarks RS256 signature validation
func BenchmarkJWTValidation_RS256(b *testing.B) {
	// Setup
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

	// Benchmark
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		_, err := validator.Validate(tokenString)
		if err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkJWTValidation_HS256 benchmarks HS256 signature validation
func BenchmarkJWTValidation_HS256(b *testing.B) {
	// Setup
	secret := "test-secret-key-min-32-characters-long"
	config := &auth.JWTConfig{
		Secret:   secret,
		Issuer:   "authz-engine",
		Audience: "authz-api",
	}

	validator, err := auth.NewJWTValidator(config)
	require.NoError(b, err)
	defer validator.Close()

	claims := auth_test.DefaultTestClaims()
	tokenString := auth_test.GenerateTestTokenHS256(&testing.T{}, secret, claims)

	// Benchmark
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		_, err := validator.Validate(tokenString)
		if err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkJWTGeneration_RS256 benchmarks token generation with RS256
func BenchmarkJWTGeneration_RS256(b *testing.B) {
	keyPair := auth_test.GenerateTestKeyPair(&testing.T{})
	claims := auth_test.DefaultTestClaims()

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		_ = auth_test.GenerateTestToken(&testing.T{}, keyPair, claims)
	}
}

// BenchmarkJWTGeneration_HS256 benchmarks token generation with HS256
func BenchmarkJWTGeneration_HS256(b *testing.B) {
	secret := "test-secret-key-min-32-characters-long"
	claims := auth_test.DefaultTestClaims()

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		_ = auth_test.GenerateTestTokenHS256(&testing.T{}, secret, claims)
	}
}

// BenchmarkClaimsExtraction benchmarks extracting claims from validated token
func BenchmarkClaimsExtraction(b *testing.B) {
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
		extractedClaims, err := validator.Validate(tokenString)
		if err != nil {
			b.Fatal(err)
		}
		_ = extractedClaims.HasRole("admin")
	}
}

// BenchmarkConcurrentValidation benchmarks concurrent token validation
func BenchmarkConcurrentValidation(b *testing.B) {
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

	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_, err := validator.Validate(tokenString)
			if err != nil {
				b.Fatal(err)
			}
		}
	})
}

// BenchmarkMiddlewareOverhead benchmarks authentication middleware overhead
func BenchmarkMiddlewareOverhead(b *testing.B) {
	b.Skip("Requires full middleware setup with HTTP server")

	// This benchmark would:
	// 1. Setup HTTP server with auth middleware
	// 2. Measure end-to-end request latency
	// 3. Compare with/without authentication
	// 4. Target: <10ms p99 overhead
}
