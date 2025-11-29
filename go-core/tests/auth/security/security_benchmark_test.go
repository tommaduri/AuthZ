package security_test

import (
	"crypto/rand"
	"crypto/rsa"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// BenchmarkTokenValidation benchmarks JWT token validation performance
func BenchmarkTokenValidation(b *testing.B) {
	suite := setupTokenTests(&testing.T{})

	token := suite.createToken(&testing.T{}, map[string]interface{}{
		"sub":       "user-123",
		"exp":       time.Now().Add(1 * time.Hour).Unix(),
		"iss":       testIssuer,
		"aud":       testAudience,
		"tenant_id": testTenantID,
	})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		suite.validateToken(token)
	}
}

// BenchmarkTokenCreation benchmarks JWT token creation performance
func BenchmarkTokenCreation(b *testing.B) {
	privateKey, _ := rsa.GenerateKey(rand.Reader, 2048)

	claims := jwt.MapClaims{
		"sub":       "user-123",
		"exp":       time.Now().Add(1 * time.Hour).Unix(),
		"iss":       testIssuer,
		"aud":       testAudience,
		"tenant_id": testTenantID,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
		token.SignedString(privateKey)
	}
}

// BenchmarkAPIKeyValidation benchmarks API key validation performance
func BenchmarkAPIKeyValidation(b *testing.B) {
	store := NewAPIKeyStore()

	rawKey := generateAPIKey(&testing.T{})
	hashedKey := hashAPIKey(rawKey)

	apiKey := &APIKey{
		ID:        "key-123",
		HashedKey: hashedKey,
		TenantID:  "tenant-123",
		CreatedAt: time.Now(),
	}
	store.Store(apiKey)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		store.ValidateKey(rawKey, "tenant-123")
	}
}

// BenchmarkAPIKeyHashing benchmarks API key hashing performance
func BenchmarkAPIKeyHashing(b *testing.B) {
	rawKey := generateAPIKey(&testing.T{})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		hashAPIKey(rawKey)
	}
}

// BenchmarkBruteForceCheck benchmarks brute force protection check
func BenchmarkBruteForceCheck(b *testing.B) {
	protector := NewBruteForceProtector(5, 5*time.Minute)
	userID := "user-123"
	ip := "192.168.1.100"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		protector.AllowLogin(userID, ip)
	}
}

// BenchmarkBruteForceRecordFailure benchmarks failure recording
func BenchmarkBruteForceRecordFailure(b *testing.B) {
	protector := NewBruteForceProtector(5, 5*time.Minute)
	userID := "user-123"
	ip := "192.168.1.100"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		protector.RecordFailedLogin(userID, ip)
	}
}

// BenchmarkRateLimiting benchmarks rate limiting check performance
func BenchmarkRateLimiting(b *testing.B) {
	limiter := NewRateLimiter(1000, time.Minute)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		limiter.Allow()
	}
}

// BenchmarkAuditLogAppend benchmarks audit log append performance
func BenchmarkAuditLogAppend(b *testing.B) {
	log := NewAuditLog()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		event := &AuditEvent{
			ID:        "event-" + string(rune(i)),
			TenantID:  "tenant-123",
			Timestamp: time.Now(),
			EventType: "auth",
			UserID:    "user-123",
			Action:    "test",
			Status:    "success",
		}
		log.Append(event)
	}
}

// BenchmarkAuditLogValidation benchmarks hash chain validation
func BenchmarkAuditLogValidation(b *testing.B) {
	log := NewAuditLog()

	// Create chain of 1000 events
	for i := 0; i < 1000; i++ {
		event := &AuditEvent{
			ID:        "event-" + string(rune(i)),
			TenantID:  "tenant-123",
			Timestamp: time.Now(),
			EventType: "auth",
			UserID:    "user-123",
			Action:    "test",
			Status:    "success",
		}
		log.Append(event)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		log.ValidateChain()
	}
}

// BenchmarkHashComputation benchmarks event hash computation
func BenchmarkHashComputation(b *testing.B) {
	event := &AuditEvent{
		ID:           "event-123",
		TenantID:     "tenant-123",
		Timestamp:    time.Now(),
		EventType:    "auth",
		UserID:       "user-123",
		Action:       "test",
		Status:       "success",
		PreviousHash: "prev-hash",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		computeEventHash(event)
	}
}

// BenchmarkSQLInjectionValidation benchmarks SQL injection detection
func BenchmarkSQLInjectionValidation(b *testing.B) {
	inputs := []string{
		"normal_input",
		"' OR '1'='1",
		"admin'--",
		"user@example.com",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		validateInputForSQL(inputs[i%len(inputs)])
	}
}

// BenchmarkXSSSanitization benchmarks XSS sanitization
func BenchmarkXSSSanitization(b *testing.B) {
	inputs := []string{
		"<script>alert('XSS')</script>",
		"<img src=x onerror=alert('XSS')>",
		"Normal text with <b>bold</b>",
		"Plain text",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		sanitizeForHTML(inputs[i%len(inputs)])
	}
}

// BenchmarkCSRFTokenGeneration benchmarks CSRF token generation
func BenchmarkCSRFTokenGeneration(b *testing.B) {
	suite := NewPenetrationTestSuite()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		suite.generateCSRFToken("session-123")
	}
}

// BenchmarkCSRFTokenValidation benchmarks CSRF token validation
func BenchmarkCSRFTokenValidation(b *testing.B) {
	suite := NewPenetrationTestSuite()
	sessionID := "session-123"
	token := suite.generateCSRFToken(sessionID)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		suite.validateCSRFToken(token, sessionID)
	}
}

// BenchmarkMultiTenantIsolationCheck benchmarks tenant isolation check
func BenchmarkMultiTenantIsolationCheck(b *testing.B) {
	manager := NewMultiTenantSecurityManager()

	token := "token-tenant1"
	manager.IssueToken("tenant-1", token)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		manager.ValidateToken(token, "tenant-1")
	}
}

// BenchmarkConcurrentTokenValidation benchmarks concurrent token validation
func BenchmarkConcurrentTokenValidation(b *testing.B) {
	suite := setupTokenTests(&testing.T{})

	token := suite.createToken(&testing.T{}, map[string]interface{}{
		"sub":       "user-123",
		"exp":       time.Now().Add(1 * time.Hour).Unix(),
		"iss":       testIssuer,
		"aud":       testAudience,
		"tenant_id": testTenantID,
	})

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			suite.validateToken(token)
		}
	})
}

// BenchmarkConcurrentBruteForceCheck benchmarks concurrent brute force checks
func BenchmarkConcurrentBruteForceCheck(b *testing.B) {
	protector := NewBruteForceProtector(100, 5*time.Minute)

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			userID := "user-" + string(rune(i%10))
			ip := "192.168.1." + string(rune(100+i%50))
			protector.AllowLogin(userID, ip)
			i++
		}
	})
}

// BenchmarkConcurrentAuditLogAppend benchmarks concurrent audit log writes
func BenchmarkConcurrentAuditLogAppend(b *testing.B) {
	log := NewAuditLog()

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			event := &AuditEvent{
				ID:        "event-" + string(rune(i)),
				TenantID:  "tenant-123",
				Timestamp: time.Now(),
				EventType: "auth",
				UserID:    "user-123",
				Action:    "test",
				Status:    "success",
			}
			log.Append(event)
			i++
		}
	})
}

// BenchmarkSecurityOperationOverhead measures security check overhead
func BenchmarkSecurityOperationOverhead(b *testing.B) {
	protector := NewBruteForceProtector(5, 5*time.Minute)
	store := NewAPIKeyStore()
	log := NewAuditLog()

	rawKey := generateAPIKey(&testing.T{})
	hashedKey := hashAPIKey(rawKey)
	apiKey := &APIKey{
		ID:        "key-123",
		HashedKey: hashedKey,
		TenantID:  "tenant-123",
		CreatedAt: time.Now(),
	}
	store.Store(apiKey)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Simulate full security check pipeline
		allowed, _ := protector.AllowLogin("user-123", "192.168.1.100")
		if allowed {
			store.ValidateKey(rawKey, "tenant-123")
			event := &AuditEvent{
				ID:        "event-" + string(rune(i)),
				TenantID:  "tenant-123",
				Timestamp: time.Now(),
				EventType: "auth",
				UserID:    "user-123",
				Action:    "login",
				Status:    "success",
			}
			log.Append(event)
		}
	}
}

// BenchmarkMemoryAllocation measures memory allocation for security operations
func BenchmarkMemoryAllocation(b *testing.B) {
	b.ReportAllocs()

	suite := setupTokenTests(&testing.T{})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		token := suite.createToken(&testing.T{}, map[string]interface{}{
			"sub":       "user-123",
			"exp":       time.Now().Add(1 * time.Hour).Unix(),
			"iss":       testIssuer,
			"aud":       testAudience,
			"tenant_id": testTenantID,
		})
		suite.validateToken(token)
	}
}
