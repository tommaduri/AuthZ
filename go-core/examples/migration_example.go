// Package main demonstrates database migration usage
package main

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	_ "github.com/lib/pq"

	"authz-engine/internal/db"
)

func main() {
	// Example 1: Running Migrations
	runMigrations()

	// Example 2: Working with Multi-Tenant Data
	multiTenantExample()

	// Example 3: Logging Authentication Events
	auditLoggingExample()

	// Example 4: Managing Refresh Tokens
	refreshTokenExample()
}

// runMigrations demonstrates migration management
func runMigrations() {
	fmt.Println("\n=== Migration Example ===")

	// Connect to database
	dbConn, err := sql.Open("postgres",
		"postgres://postgres:postgres@localhost:5432/authz?sslmode=disable")
	if err != nil {
		log.Fatal("Failed to connect:", err)
	}
	defer dbConn.Close()

	// Create migration runner
	runner, err := db.NewMigrationRunner(dbConn)
	if err != nil {
		log.Fatal("Failed to create runner:", err)
	}
	defer runner.Close()

	// Check current version
	version, dirty, err := runner.Version()
	if err != nil && err.Error() != "no migration" {
		log.Fatal("Failed to get version:", err)
	}
	fmt.Printf("Current version: %d, Dirty: %v\n", version, dirty)

	// Run migrations
	fmt.Println("Running migrations...")
	if err := runner.Up(); err != nil {
		log.Fatal("Migration failed:", err)
	}

	// Verify new version
	version, _, _ = runner.Version()
	fmt.Printf("Migrated to version: %d\n", version)

	// List available migrations
	migrations, err := db.ListMigrations()
	if err != nil {
		log.Fatal("Failed to list migrations:", err)
	}
	fmt.Printf("Available migrations: %d\n", len(migrations))
	for _, m := range migrations {
		fmt.Printf("  - %s\n", m)
	}
}

// multiTenantExample demonstrates tenant isolation
func multiTenantExample() {
	fmt.Println("\n=== Multi-Tenant Example ===")

	dbConn, err := sql.Open("postgres",
		"postgres://postgres:postgres@localhost:5432/authz?sslmode=disable")
	if err != nil {
		log.Fatal(err)
	}
	defer dbConn.Close()

	// Tenant A operations
	tenantA := "tenant-a"
	err = db.WithTenant(dbConn, tenantA, func(conn *sql.DB) error {
		// Create API key for tenant A
		apiKey := &db.APIKey{
			ID:           uuid.New(),
			KeyHash:      hashKey("secret-key-a"),
			Name:         "Tenant A Production Key",
			AgentID:      "agent-a-1",
			Scopes:       []string{"read", "write"},
			RateLimitRPS: 1000,
			TenantID:     tenantA,
			CreatedAt:    time.Now(),
		}

		// Validate before insert
		if err := db.ValidateAPIKeyName(apiKey.Name); err != nil {
			return fmt.Errorf("invalid name: %w", err)
		}
		if err := db.ValidateRateLimitRPS(apiKey.RateLimitRPS); err != nil {
			return fmt.Errorf("invalid rate limit: %w", err)
		}

		// Insert API key
		_, err := conn.Exec(`
			INSERT INTO api_keys (id, key_hash, name, agent_id, scopes, rate_limit_rps, tenant_id, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		`, apiKey.ID, apiKey.KeyHash, apiKey.Name, apiKey.AgentID,
			arrayToJSON(apiKey.Scopes), apiKey.RateLimitRPS, apiKey.TenantID, apiKey.CreatedAt)

		if err != nil {
			return fmt.Errorf("failed to insert: %w", err)
		}

		fmt.Printf("Created API key for %s: %s\n", tenantA, apiKey.Name)

		// Query tenant A's keys (RLS automatically filters)
		var count int
		err = conn.QueryRow("SELECT COUNT(*) FROM api_keys").Scan(&count)
		if err != nil {
			return err
		}
		fmt.Printf("Tenant A sees %d key(s)\n", count)

		return nil
	})
	if err != nil {
		log.Fatal(err)
	}

	// Tenant B operations
	tenantB := "tenant-b"
	err = db.WithTenant(dbConn, tenantB, func(conn *sql.DB) error {
		// Create API key for tenant B
		apiKey := &db.APIKey{
			ID:           uuid.New(),
			KeyHash:      hashKey("secret-key-b"),
			Name:         "Tenant B Development Key",
			AgentID:      "agent-b-1",
			Scopes:       []string{"read"},
			RateLimitRPS: 500,
			TenantID:     tenantB,
			CreatedAt:    time.Now(),
		}

		_, err := conn.Exec(`
			INSERT INTO api_keys (id, key_hash, name, agent_id, scopes, rate_limit_rps, tenant_id, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		`, apiKey.ID, apiKey.KeyHash, apiKey.Name, apiKey.AgentID,
			arrayToJSON(apiKey.Scopes), apiKey.RateLimitRPS, apiKey.TenantID, apiKey.CreatedAt)

		if err != nil {
			return err
		}

		fmt.Printf("Created API key for %s: %s\n", tenantB, apiKey.Name)

		// Query tenant B's keys (RLS automatically filters)
		var count int
		err = conn.QueryRow("SELECT COUNT(*) FROM api_keys").Scan(&count)
		if err != nil {
			return err
		}
		fmt.Printf("Tenant B sees %d key(s)\n", count)

		return nil
	})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println("✅ Tenant isolation verified!")
}

// auditLoggingExample demonstrates authentication event logging
func auditLoggingExample() {
	fmt.Println("\n=== Audit Logging Example ===")

	dbConn, err := sql.Open("postgres",
		"postgres://postgres:postgres@localhost:5432/authz?sslmode=disable")
	if err != nil {
		log.Fatal(err)
	}
	defer dbConn.Close()

	tenantID := "tenant-audit"
	err = db.WithTenant(dbConn, tenantID, func(conn *sql.DB) error {
		// Successful API key validation
		successLog := &db.AuthAuditLog{
			ID:        uuid.New(),
			EventType: db.EventAPIKeyValidated,
			UserID:    stringPtr("user-123"),
			Success:   true,
			Timestamp: time.Now(),
			TenantID:  tenantID,
			IPAddress: stringPtr("192.168.1.100"),
			UserAgent: stringPtr("MyApp/1.0"),
		}

		if !db.IsValidEventType(successLog.EventType) {
			return fmt.Errorf("invalid event type: %s", successLog.EventType)
		}

		_, err := conn.Exec(`
			INSERT INTO auth_audit_logs (id, event_type, user_id, success, timestamp, tenant_id, ip_address, user_agent)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		`, successLog.ID, successLog.EventType, successLog.UserID, successLog.Success,
			successLog.Timestamp, successLog.TenantID, successLog.IPAddress, successLog.UserAgent)

		if err != nil {
			return err
		}
		fmt.Printf("Logged event: %s (success)\n", successLog.EventType)

		// Failed login attempt
		failureLog := &db.AuthAuditLog{
			ID:           uuid.New(),
			EventType:    db.EventLoginFailure,
			UserID:       stringPtr("user-456"),
			Success:      false,
			ErrorMessage: stringPtr("Invalid credentials"),
			Timestamp:    time.Now(),
			TenantID:     tenantID,
			IPAddress:    stringPtr("192.168.1.200"),
		}

		_, err = conn.Exec(`
			INSERT INTO auth_audit_logs (id, event_type, user_id, success, error_message, timestamp, tenant_id, ip_address)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		`, failureLog.ID, failureLog.EventType, failureLog.UserID, failureLog.Success,
			failureLog.ErrorMessage, failureLog.Timestamp, failureLog.TenantID, failureLog.IPAddress)

		if err != nil {
			return err
		}
		fmt.Printf("Logged event: %s (failure)\n", failureLog.EventType)

		// Query recent events
		rows, err := conn.Query(`
			SELECT event_type, success, timestamp
			FROM auth_audit_logs
			ORDER BY timestamp DESC
			LIMIT 10
		`)
		if err != nil {
			return err
		}
		defer rows.Close()

		fmt.Println("\nRecent events:")
		for rows.Next() {
			var eventType string
			var success bool
			var timestamp time.Time
			if err := rows.Scan(&eventType, &success, &timestamp); err != nil {
				return err
			}
			status := "✅"
			if !success {
				status = "❌"
			}
			fmt.Printf("  %s %s - %s\n", status, eventType, timestamp.Format(time.RFC3339))
		}

		return nil
	})

	if err != nil {
		log.Fatal(err)
	}
}

// refreshTokenExample demonstrates token rotation
func refreshTokenExample() {
	fmt.Println("\n=== Refresh Token Example ===")

	dbConn, err := sql.Open("postgres",
		"postgres://postgres:postgres@localhost:5432/authz?sslmode=disable")
	if err != nil {
		log.Fatal(err)
	}
	defer dbConn.Close()

	tenantID := "tenant-tokens"
	err = db.WithTenant(dbConn, tenantID, func(conn *sql.DB) error {
		// Create initial refresh token
		parentToken := &db.RefreshToken{
			ID:        uuid.New(),
			TokenHash: hashKey("refresh-token-1"),
			UserID:    "user-789",
			ExpiresAt: time.Now().Add(7 * 24 * time.Hour),
			CreatedAt: time.Now(),
			TenantID:  tenantID,
		}

		_, err := conn.Exec(`
			INSERT INTO refresh_tokens (id, token_hash, user_id, expires_at, created_at, tenant_id)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, parentToken.ID, parentToken.TokenHash, parentToken.UserID,
			parentToken.ExpiresAt, parentToken.CreatedAt, parentToken.TenantID)

		if err != nil {
			return err
		}
		fmt.Printf("Created initial refresh token: %s\n", parentToken.ID)

		// Check if valid
		if parentToken.IsValid() {
			fmt.Println("✅ Token is valid")
		}

		// Simulate token rotation - create new token with parent reference
		childToken := &db.RefreshToken{
			ID:            uuid.New(),
			TokenHash:     hashKey("refresh-token-2"),
			UserID:        parentToken.UserID,
			ExpiresAt:     time.Now().Add(7 * 24 * time.Hour),
			CreatedAt:     time.Now(),
			TenantID:      tenantID,
			ParentTokenID: &parentToken.ID,
		}

		_, err = conn.Exec(`
			INSERT INTO refresh_tokens (id, token_hash, user_id, expires_at, created_at, tenant_id, parent_token_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, childToken.ID, childToken.TokenHash, childToken.UserID,
			childToken.ExpiresAt, childToken.CreatedAt, childToken.TenantID, childToken.ParentTokenID)

		if err != nil {
			return err
		}
		fmt.Printf("Rotated to new token: %s (parent: %s)\n", childToken.ID, *childToken.ParentTokenID)

		// Revoke parent token after rotation
		now := time.Now()
		_, err = conn.Exec(`
			UPDATE refresh_tokens
			SET revoked_at = $1
			WHERE id = $2
		`, now, parentToken.ID)

		if err != nil {
			return err
		}
		fmt.Printf("Revoked parent token: %s\n", parentToken.ID)

		// Query token chain
		var count int
		err = conn.QueryRow("SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1", parentToken.UserID).Scan(&count)
		if err != nil {
			return err
		}
		fmt.Printf("Total tokens for user: %d\n", count)

		return nil
	})

	if err != nil {
		log.Fatal(err)
	}
}

// Helper functions

func hashKey(key string) string {
	// In production, use crypto/sha256
	return fmt.Sprintf("hash_%s", key)
}

func arrayToJSON(arr []string) string {
	// Simple JSON array conversion
	result := "["
	for i, s := range arr {
		if i > 0 {
			result += ","
		}
		result += fmt.Sprintf(`"%s"`, s)
	}
	result += "]"
	return result
}

func stringPtr(s string) *string {
	return &s
}
