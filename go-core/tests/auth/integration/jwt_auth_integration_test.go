package integration

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/authz-engine/go-core/internal/auth"
	"github.com/authz-engine/go-core/internal/server/middleware"
	auth_test "github.com/authz-engine/go-core/tests/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// TestJWTAuthenticationFlow tests the complete JWT authentication workflow
func TestJWTAuthenticationFlow_EndToEnd(t *testing.T) {
	// Step 1: Generate RSA keys
	keyPair := auth_test.GenerateTestKeyPair(t)

	// Step 2: Create JWT validator
	config := &auth.JWTConfig{
		PublicKey: keyPair.PublicKeyPEM,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	}
	validator, err := auth.NewJWTValidator(config)
	require.NoError(t, err)
	defer validator.Close()

	// Step 3: Generate JWT token
	claims := auth_test.DefaultTestClaims()
	tokenString := auth_test.GenerateTestToken(t, keyPair, claims)

	// Step 4: Validate token
	validatedClaims, err := validator.Validate(tokenString)
	require.NoError(t, err)
	assert.Equal(t, claims.Subject, validatedClaims.Subject)
	assert.Equal(t, claims.Username, validatedClaims.Username)

	// Step 5: Verify role-based access
	assert.True(t, validatedClaims.HasRole("admin"))
	assert.True(t, validatedClaims.HasAllRoles("user", "admin"))
}

// TestHTTPMiddlewareIntegration tests HTTP middleware authentication
func TestHTTPMiddlewareIntegration(t *testing.T) {
	// Setup
	keyPair := auth_test.GenerateTestKeyPair(t)
	config := &auth.JWTConfig{
		PublicKey: keyPair.PublicKeyPEM,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	}
	validator, err := auth.NewJWTValidator(config)
	require.NoError(t, err)
	defer validator.Close()

	authenticator := middleware.NewAuthenticator(validator, nil)

	// Create test handler
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := middleware.ClaimsFromContext(r.Context())
		if !ok {
			http.Error(w, "No claims in context", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(claims.Username))
	})

	// Wrap with auth middleware
	authHandler := authenticator.HTTPMiddleware(handler)

	t.Run("ValidToken_Success", func(t *testing.T) {
		// Generate valid token
		claims := auth_test.DefaultTestClaims()
		tokenString := auth_test.GenerateTestToken(t, keyPair, claims)

		// Create request
		req := httptest.NewRequest(http.MethodGet, "/api/resource", nil)
		req.Header.Set("Authorization", "Bearer "+tokenString)
		rec := httptest.NewRecorder()

		// Execute
		authHandler.ServeHTTP(rec, req)

		// Assert
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "testuser", rec.Body.String())
	})

	t.Run("MissingToken_Unauthorized", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/resource", nil)
		rec := httptest.NewRecorder()

		authHandler.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("InvalidToken_Unauthorized", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/resource", nil)
		req.Header.Set("Authorization", "Bearer invalid.token.here")
		rec := httptest.NewRecorder()

		authHandler.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("ExpiredToken_Unauthorized", func(t *testing.T) {
		expiredClaims := auth_test.ExpiredTestClaims()
		tokenString := auth_test.GenerateTestToken(t, keyPair, expiredClaims)

		req := httptest.NewRequest(http.MethodGet, "/api/resource", nil)
		req.Header.Set("Authorization", "Bearer "+tokenString)
		rec := httptest.NewRecorder()

		authHandler.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})
}

// TestGRPCInterceptorIntegration tests gRPC interceptor authentication
func TestGRPCInterceptorIntegration(t *testing.T) {
	// Setup
	keyPair := auth_test.GenerateTestKeyPair(t)
	config := &auth.JWTConfig{
		PublicKey: keyPair.PublicKeyPEM,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	}
	validator, err := auth.NewJWTValidator(config)
	require.NoError(t, err)
	defer validator.Close()

	authenticator := middleware.NewAuthenticator(validator, nil)
	interceptor := authenticator.GRPCUnaryInterceptor()

	// Mock handler
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		claims, ok := middleware.ClaimsFromContext(ctx)
		if !ok {
			return nil, status.Error(codes.Internal, "no claims in context")
		}
		return claims.Username, nil
	}

	t.Run("ValidToken_Success", func(t *testing.T) {
		// Generate valid token
		claims := auth_test.DefaultTestClaims()
		tokenString := auth_test.GenerateTestToken(t, keyPair, claims)

		// Create context with metadata
		md := metadata.New(map[string]string{
			"authorization": "Bearer " + tokenString,
		})
		ctx := metadata.NewIncomingContext(context.Background(), md)

		// Execute
		resp, err := interceptor(ctx, nil, &grpc.UnaryServerInfo{FullMethod: "/test.Service/Method"}, handler)

		// Assert
		require.NoError(t, err)
		assert.Equal(t, "testuser", resp)
	})

	t.Run("MissingToken_Unauthenticated", func(t *testing.T) {
		ctx := context.Background()

		_, err := interceptor(ctx, nil, &grpc.UnaryServerInfo{FullMethod: "/test.Service/Method"}, handler)

		assert.Error(t, err)
		assert.Equal(t, codes.Unauthenticated, status.Code(err))
	})

	t.Run("InvalidToken_Unauthenticated", func(t *testing.T) {
		md := metadata.New(map[string]string{
			"authorization": "Bearer invalid.token",
		})
		ctx := metadata.NewIncomingContext(context.Background(), md)

		_, err := interceptor(ctx, nil, &grpc.UnaryServerInfo{FullMethod: "/test.Service/Method"}, handler)

		assert.Error(t, err)
		assert.Equal(t, codes.Unauthenticated, status.Code(err))
	})
}

// TestSkipPathsIntegration tests authentication bypass for public endpoints
func TestSkipPathsIntegration(t *testing.T) {
	keyPair := auth_test.GenerateTestKeyPair(t)
	config := &auth.JWTConfig{
		PublicKey: keyPair.PublicKeyPEM,
	}
	validator, err := auth.NewJWTValidator(config)
	require.NoError(t, err)
	defer validator.Close()

	// Create authenticator with skip paths
	skipPaths := []string{"/health", "/metrics"}
	authenticator := middleware.NewAuthenticator(validator, skipPaths)

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	authHandler := authenticator.HTTPMiddleware(handler)

	t.Run("SkipPath_NoAuthRequired", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		rec := httptest.NewRecorder()

		authHandler.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "OK", rec.Body.String())
	})

	t.Run("ProtectedPath_AuthRequired", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/resource", nil)
		rec := httptest.NewRecorder()

		authHandler.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})
}

// TestMultiTenantIsolation tests tenant isolation via JWT claims
func TestMultiTenantIsolation(t *testing.T) {
	keyPair := auth_test.GenerateTestKeyPair(t)
	config := &auth.JWTConfig{
		PublicKey: keyPair.PublicKeyPEM,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	}
	validator, err := auth.NewJWTValidator(config)
	require.NoError(t, err)
	defer validator.Close()

	// Tenant A token
	claimsTenantA := auth_test.MultiTenantClaims("tenant-a")
	tokenA := auth_test.GenerateTestToken(t, keyPair, claimsTenantA)

	// Tenant B token
	claimsTenantB := auth_test.MultiTenantClaims("tenant-b")
	tokenB := auth_test.GenerateTestToken(t, keyPair, claimsTenantB)

	// Validate both tokens
	validatedA, err := validator.Validate(tokenA)
	require.NoError(t, err)

	validatedB, err := validator.Validate(tokenB)
	require.NoError(t, err)

	// Assert tenant isolation
	assert.Equal(t, "agent:tenant-tenant-a", validatedA.Subject)
	assert.Equal(t, "agent:tenant-tenant-b", validatedB.Subject)
	assert.NotEqual(t, validatedA.Subject, validatedB.Subject)
}
