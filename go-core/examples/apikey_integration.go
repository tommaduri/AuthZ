// Package examples provides integration examples for the API key authentication system
package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	_ "github.com/lib/pq"
	"github.com/yourusername/authz-engine/internal/api/rest"
	"github.com/yourusername/authz-engine/internal/auth"
)

// Example showing how to integrate API key authentication into your application
func main() {
	// 1. Connect to PostgreSQL
	db, err := sql.Open("postgres", "postgres://user:pass@localhost/authz?sslmode=disable")
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}
	defer db.Close()

	// 2. Create API key store
	apiKeyStore := auth.NewPostgresAPIKeyStore(db)

	// 3. Create API key validator
	validator := auth.NewAPIKeyValidator(apiKeyStore)

	// 4. Create authentication middleware (no JWT validator for this example)
	authMiddleware := auth.NewAuthMiddleware(validator, nil)

	// 5. Start rate limiter cleanup (every hour)
	authMiddleware.CleanupRateLimiters(1 * time.Hour)

	// 6. Create API key handler
	apiKeyHandler := rest.NewAPIKeyHandler(apiKeyStore)

	// 7. Setup router
	router := mux.NewRouter()

	// 8. Register API key management routes
	apiKeyHandler.RegisterRoutes(router)

	// 9. Add protected routes with authentication
	protectedRouter := router.PathPrefix("/api/v1").Subrouter()
	protectedRouter.Use(authMiddleware.Authenticate)

	// 10. Add scope-protected routes
	adminRouter := router.PathPrefix("/api/v1/admin").Subrouter()
	adminRouter.Use(authMiddleware.Authenticate)
	adminRouter.Use(authMiddleware.RequireScope("admin"))

	// Example protected endpoints
	protectedRouter.HandleFunc("/check", handleAuthzCheck).Methods(http.MethodPost)
	adminRouter.HandleFunc("/policies", handleAdminPolicies).Methods(http.MethodGet)

	// 11. Start server
	server := &http.Server{
		Addr:         ":8080",
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Println("Server starting on :8080")
	log.Println("API Key management available at:")
	log.Println("  POST   /v1/auth/keys")
	log.Println("  GET    /v1/auth/keys")
	log.Println("  GET    /v1/auth/keys/{key_id}")
	log.Println("  DELETE /v1/auth/keys/{key_id}")
	log.Println("")
	log.Println("Protected endpoints:")
	log.Println("  POST   /api/v1/check")
	log.Println("  GET    /api/v1/admin/policies (requires admin scope)")

	if err := server.ListenAndServe(); err != nil {
		log.Fatal("Server failed:", err)
	}
}

func handleAuthzCheck(w http.ResponseWriter, r *http.Request) {
	// Get agent ID from context (set by middleware)
	agentID, ok := auth.GetAgentIDFromContext(r.Context())
	if !ok {
		http.Error(w, "Agent ID not found", http.StatusUnauthorized)
		return
	}

	// Get API key metadata if authenticated via API key
	if apiKey, ok := auth.GetAPIKeyFromContext(r.Context()); ok {
		fmt.Fprintf(w, "Authenticated via API key: %s (rate limit: %d req/s)\n",
			apiKey.KeyPrefix, apiKey.RateLimitPerSec)
	}

	fmt.Fprintf(w, "Agent ID: %s\n", agentID)
	fmt.Fprintln(w, "Authorization check logic goes here")
}

func handleAdminPolicies(w http.ResponseWriter, r *http.Request) {
	// This endpoint requires "admin" scope
	fmt.Fprintln(w, "Admin policies endpoint")
	fmt.Fprintln(w, "Only accessible with admin scope")
}

// Example: Creating an API key programmatically
func exampleCreateAPIKey(ctx context.Context, store auth.APIKeyStore) error {
	// Generate API key
	apiKey, err := auth.GenerateAPIKey()
	if err != nil {
		return fmt.Errorf("failed to generate key: %w", err)
	}

	// Create metadata
	key := &auth.APIKey{
		KeyID:           uuid.New(),
		KeyHash:         auth.HashAPIKey(apiKey),
		KeyPrefix:       auth.ExtractKeyPrefix(apiKey),
		AgentID:         "my-agent",
		TenantID:        "my-tenant",
		Name:            "Production Key",
		Scopes:          []string{"read", "write"},
		RateLimitPerSec: 200,
		CreatedAt:       time.Now(),
		ExpiresAt:       nil, // No expiration
	}

	// Store in database
	if err := store.CreateAPIKey(ctx, key); err != nil {
		return fmt.Errorf("failed to store key: %w", err)
	}

	// IMPORTANT: Print the key only once
	fmt.Printf("API Key created successfully!\n")
	fmt.Printf("Key: %s\n", apiKey)
	fmt.Printf("Key ID: %s\n", key.KeyID)
	fmt.Printf("Prefix: %s\n", key.KeyPrefix)
	fmt.Printf("\nIMPORTANT: Save this key securely. It will not be shown again.\n")

	return nil
}

// Example: Validating an API key
func exampleValidateAPIKey(ctx context.Context, validator *auth.APIKeyValidator, apiKey string) error {
	// Validate the key
	key, err := validator.ValidateAPIKey(ctx, apiKey)
	if err != nil {
		if err == auth.ErrAPIKeyNotFound {
			return fmt.Errorf("API key not found")
		}
		if err == auth.ErrAPIKeyExpired {
			return fmt.Errorf("API key has expired")
		}
		if err == auth.ErrAPIKeyRevoked {
			return fmt.Errorf("API key has been revoked")
		}
		return fmt.Errorf("validation failed: %w", err)
	}

	fmt.Printf("API Key validated successfully!\n")
	fmt.Printf("Agent ID: %s\n", key.AgentID)
	fmt.Printf("Tenant ID: %s\n", key.TenantID)
	fmt.Printf("Scopes: %v\n", key.Scopes)
	fmt.Printf("Rate Limit: %d req/s\n", key.RateLimitPerSec)

	return nil
}

// Example: Key rotation
func exampleKeyRotation(ctx context.Context, store auth.APIKeyStore, oldKeyID uuid.UUID) error {
	// 1. Create new API key
	newAPIKey, err := auth.GenerateAPIKey()
	if err != nil {
		return err
	}

	// 2. Get old key metadata
	oldKey, err := store.GetAPIKeyByID(ctx, oldKeyID)
	if err != nil {
		return err
	}

	// 3. Create new key with same metadata
	newKey := &auth.APIKey{
		KeyID:           uuid.New(),
		KeyHash:         auth.HashAPIKey(newAPIKey),
		KeyPrefix:       auth.ExtractKeyPrefix(newAPIKey),
		AgentID:         oldKey.AgentID,
		TenantID:        oldKey.TenantID,
		Name:            oldKey.Name + " (Rotated)",
		Scopes:          oldKey.Scopes,
		RateLimitPerSec: oldKey.RateLimitPerSec,
		CreatedAt:       time.Now(),
		ExpiresAt:       oldKey.ExpiresAt,
	}

	// 4. Store new key
	if err := store.CreateAPIKey(ctx, newKey); err != nil {
		return err
	}

	fmt.Printf("New API Key: %s\n", newAPIKey)
	fmt.Printf("New Key ID: %s\n", newKey.KeyID)

	// 5. Monitor old key usage (wait some time in production)
	fmt.Println("\nIMPORTANT: Update your application to use the new key before revoking the old one.")
	fmt.Printf("Old Key ID: %s\n", oldKeyID)

	// 6. Revoke old key (do this after migration)
	// if err := store.RevokeAPIKey(ctx, oldKeyID); err != nil {
	//     return err
	// }

	return nil
}

// Example: Cleanup expired keys
func exampleCleanupExpiredKeys(ctx context.Context, store auth.APIKeyStore) error {
	// Remove keys that expired more than 30 days ago
	count, err := store.CleanupExpiredKeys(ctx, 30*24*time.Hour)
	if err != nil {
		return fmt.Errorf("cleanup failed: %w", err)
	}

	fmt.Printf("Cleaned up %d expired API keys\n", count)
	return nil
}
