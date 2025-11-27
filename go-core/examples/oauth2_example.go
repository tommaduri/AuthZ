package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"authz-engine/internal/api/rest"
	"authz-engine/internal/auth"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

func main() {
	// Example demonstrates complete OAuth2 client credentials flow

	// 1. Setup database connection
	db, err := sql.Open("postgres", "postgres://user:password@localhost:5432/authz?sslmode=disable")
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}
	defer db.Close()

	// 2. Initialize OAuth2 store and handler
	store := auth.NewPostgresOAuth2Store(db)
	jwtIssuer, err := auth.NewJWTIssuer("authz-engine", []byte("your-secret-key-at-least-32-bytes-long"))
	if err != nil {
		log.Fatal("Failed to create JWT issuer:", err)
	}

	oauth2Handler := auth.NewOAuth2Handler(store, jwtIssuer)

	// Optional: Set custom token expiry (default is 1 hour)
	oauth2Handler.SetTokenExpiry(2 * time.Hour)

	// 3. Create a new OAuth2 client
	expiresAt := time.Now().Add(365 * 24 * time.Hour) // Valid for 1 year
	client, err := oauth2Handler.CreateClient(
		context.Background(),
		"Example API Client",           // Client name
		"tenant-demo",                   // Tenant ID
		[]string{"read", "write", "admin"}, // Allowed scopes
		"my-super-secret-password-123",  // Client secret (will be hashed)
		&expiresAt,                      // Expiration date
	)

	if err != nil {
		log.Fatal("Failed to create client:", err)
	}

	fmt.Printf("✅ OAuth2 Client Created:\n")
	fmt.Printf("   Client ID: %s\n", client.ClientID)
	fmt.Printf("   Name: %s\n", client.Name)
	fmt.Printf("   Tenant: %s\n", client.TenantID)
	fmt.Printf("   Scopes: %v\n", client.Scopes)
	fmt.Printf("   Expires: %s\n\n", client.ExpiresAt.Format(time.RFC3339))

	// 4. Setup HTTP server with OAuth2 endpoint
	httpHandler := rest.NewOAuth2HTTPHandler(oauth2Handler, &rest.OAuth2Config{
		RateLimitPerClient: 100,         // 100 requests
		RateLimitWindow:    time.Minute,  // per minute
	})

	// Register the token endpoint
	http.HandleFunc("/oauth/token", httpHandler.HandleTokenRequest)

	// Start server in background
	go func() {
		fmt.Println("🚀 OAuth2 server listening on :8080")
		if err := http.ListenAndServe(":8080", nil); err != nil {
			log.Fatal("Server failed:", err)
		}
	}()

	// Wait for server to start
	time.Sleep(1 * time.Second)

	// 5. Demonstrate token request (simulating a client)
	demonstrateTokenRequest(client.ClientID.String(), "my-super-secret-password-123")

	// 6. Demonstrate various error scenarios
	demonstrateErrorScenarios(client.ClientID.String())

	// 7. Demonstrate client revocation
	demonstrateClientRevocation(oauth2Handler, client.ClientID)

	fmt.Println("\n✅ OAuth2 demonstration complete!")
}

func demonstrateTokenRequest(clientID, clientSecret string) {
	fmt.Println("📝 Demonstrating successful token request...")

	// Prepare token request
	tokenReq := map[string]string{
		"grant_type":    "client_credentials",
		"client_id":     clientID,
		"client_secret": clientSecret,
		"scope":         "read write",
	}

	reqBody, _ := json.Marshal(tokenReq)

	// Make HTTP request
	resp, err := http.Post(
		"http://localhost:8080/oauth/token",
		"application/json",
		bytes.NewReader(reqBody),
	)

	if err != nil {
		log.Fatal("Token request failed:", err)
	}
	defer resp.Body.Close()

	// Parse response
	var tokenResp auth.TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		log.Fatal("Failed to parse response:", err)
	}

	fmt.Printf("✅ Token Response:\n")
	fmt.Printf("   Access Token: %s...\n", tokenResp.AccessToken[:50])
	fmt.Printf("   Token Type: %s\n", tokenResp.TokenType)
	fmt.Printf("   Expires In: %d seconds\n", tokenResp.ExpiresIn)
	fmt.Printf("   Scope: %s\n\n", tokenResp.Scope)
}

func demonstrateErrorScenarios(clientID string) {
	fmt.Println("❌ Demonstrating error scenarios...")

	// Test 1: Invalid grant type
	testInvalidGrantType()

	// Test 2: Invalid credentials
	testInvalidCredentials(clientID)

	// Test 3: Invalid scope
	testInvalidScope(clientID)

	fmt.Println()
}

func testInvalidGrantType() {
	tokenReq := map[string]string{
		"grant_type":    "authorization_code",
		"client_id":     "some-client-id",
		"client_secret": "some-secret",
	}

	reqBody, _ := json.Marshal(tokenReq)
	resp, _ := http.Post(
		"http://localhost:8080/oauth/token",
		"application/json",
		bytes.NewReader(reqBody),
	)
	defer resp.Body.Close()

	var errResp auth.ErrorResponse
	json.NewDecoder(resp.Body).Decode(&errResp)

	fmt.Printf("   ❌ Invalid grant type: %s (Status: %d)\n", errResp.Error, resp.StatusCode)
}

func testInvalidCredentials(clientID string) {
	tokenReq := map[string]string{
		"grant_type":    "client_credentials",
		"client_id":     clientID,
		"client_secret": "wrong-password",
	}

	reqBody, _ := json.Marshal(tokenReq)
	resp, _ := http.Post(
		"http://localhost:8080/oauth/token",
		"application/json",
		bytes.NewReader(reqBody),
	)
	defer resp.Body.Close()

	var errResp auth.ErrorResponse
	json.NewDecoder(resp.Body).Decode(&errResp)

	fmt.Printf("   ❌ Invalid credentials: %s (Status: %d)\n", errResp.Error, resp.StatusCode)
}

func testInvalidScope(clientID string) {
	tokenReq := map[string]string{
		"grant_type":    "client_credentials",
		"client_id":     clientID,
		"client_secret": "my-super-secret-password-123",
		"scope":         "delete superuser", // Not allowed
	}

	reqBody, _ := json.Marshal(tokenReq)
	resp, _ := http.Post(
		"http://localhost:8080/oauth/token",
		"application/json",
		bytes.NewReader(reqBody),
	)
	defer resp.Body.Close()

	var errResp auth.ErrorResponse
	json.NewDecoder(resp.Body).Decode(&errResp)

	fmt.Printf("   ❌ Invalid scope: %s (Status: %d)\n", errResp.Error, resp.StatusCode)
}

func demonstrateClientRevocation(handler *auth.OAuth2Handler, clientID uuid.UUID) {
	fmt.Println("🔒 Demonstrating client revocation...")

	// Revoke the client
	err := handler.RevokeClient(context.Background(), clientID)
	if err != nil {
		log.Printf("Failed to revoke client: %v", err)
		return
	}

	fmt.Printf("✅ Client %s has been revoked\n", clientID)

	// Try to get a token with revoked client
	tokenReq := map[string]string{
		"grant_type":    "client_credentials",
		"client_id":     clientID.String(),
		"client_secret": "my-super-secret-password-123",
	}

	reqBody, _ := json.Marshal(tokenReq)
	resp, _ := http.Post(
		"http://localhost:8080/oauth/token",
		"application/json",
		bytes.NewReader(reqBody),
	)
	defer resp.Body.Close()

	var errResp auth.ErrorResponse
	json.NewDecoder(resp.Body).Decode(&errResp)

	fmt.Printf("   ❌ Revoked client rejected: %s (Status: %d)\n", errResp.Error, resp.StatusCode)
}

// Helper function to demonstrate client listing
func listClientsByTenant(store auth.OAuth2ClientStore, tenantID string) {
	clients, err := store.ListClientsByTenant(context.Background(), tenantID)
	if err != nil {
		log.Printf("Failed to list clients: %v", err)
		return
	}

	fmt.Printf("\n📋 Clients for tenant %s:\n", tenantID)
	for _, client := range clients {
		status := "active"
		if client.RevokedAt != nil {
			status = "revoked"
		} else if client.ExpiresAt != nil && client.ExpiresAt.Before(time.Now()) {
			status = "expired"
		}

		fmt.Printf("   - %s (%s) - %s\n", client.Name, client.ClientID, status)
	}
}
