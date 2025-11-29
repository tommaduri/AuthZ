package security_test

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// SecurityTestSuite runs comprehensive security validation
type SecurityTestSuite struct {
	results        map[string]*TestResult
	score          int
	maxScore       int
	startTime      time.Time
	performanceReq PerformanceRequirements
}

// TestResult contains results for a test category
type TestResult struct {
	Category      string
	TestsRun      int
	TestsPassed   int
	TestsFailed   int
	Vulnerabilities []Vulnerability
	Performance   *PerformanceStats
	Duration      time.Duration
}

// Vulnerability represents a security issue found
type Vulnerability struct {
	Severity    string // P0, P1, P2, P3
	Category    string
	Description string
	Remediation string
}

// PerformanceRequirements defines performance goals
type PerformanceRequirements struct {
	SecurityCheckOverhead  time.Duration // <10ms
	RateLimitingCheck      time.Duration // <5ms
	BruteForceDetection    time.Duration // <10ms
	AuditLogging           time.Duration // <1ms
}

// NewSecurityTestSuite creates comprehensive security test suite
func NewSecurityTestSuite() *SecurityTestSuite {
	return &SecurityTestSuite{
		results:   make(map[string]*TestResult),
		maxScore:  100,
		startTime: time.Now(),
		performanceReq: PerformanceRequirements{
			SecurityCheckOverhead:  10 * time.Millisecond,
			RateLimitingCheck:      5 * time.Millisecond,
			BruteForceDetection:    10 * time.Millisecond,
			AuditLogging:           1 * time.Millisecond,
		},
	}
}

// TestComprehensiveSecuritySuite runs all security tests
func TestComprehensiveSecuritySuite(t *testing.T) {
	suite := NewSecurityTestSuite()

	t.Run("Token Security", func(t *testing.T) {
		suite.runTokenSecurityTests(t)
	})

	t.Run("API Key Security", func(t *testing.T) {
		suite.runAPIKeySecurityTests(t)
	})

	t.Run("Brute Force Protection", func(t *testing.T) {
		suite.runBruteForceTests(t)
	})

	t.Run("Audit Log Integrity", func(t *testing.T) {
		suite.runAuditLogTests(t)
	})

	t.Run("Multi-Tenant Isolation", func(t *testing.T) {
		suite.runTenantIsolationTests(t)
	})

	t.Run("Penetration Tests", func(t *testing.T) {
		suite.runPenetrationTests(t)
	})

	t.Run("Performance Validation", func(t *testing.T) {
		suite.runPerformanceTests(t)
	})

	// Generate final report
	suite.generateReport(t)
}

func (s *SecurityTestSuite) runTokenSecurityTests(t *testing.T) {
	start := time.Now()
	result := &TestResult{
		Category:        "Token Security",
		Vulnerabilities: []Vulnerability{},
	}

	tokenSuite := setupTokenTests(t)

	tests := []struct {
		name string
		test func(*testing.T)
	}{
		{"Expired Token Rejection", TestExpiredTokenRejection},
		{"Tampered Token Detection", TestTamperedTokenDetection},
		{"Algorithm Confusion Attack", TestAlgorithmConfusionAttack},
		{"Missing Claims Rejection", TestMissingClaimsRejection},
		{"Issuer Validation", TestIssuerValidation},
		{"Audience Validation", TestAudienceValidation},
		{"Token Revocation", TestTokenRevocation},
		{"Not Before Validation", TestNotBeforeValidation},
	}

	for _, tt := range tests {
		result.TestsRun++
		t.Run(tt.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					result.TestsFailed++
					result.Vulnerabilities = append(result.Vulnerabilities, Vulnerability{
						Severity:    "P0",
						Category:    "Token Security",
						Description: fmt.Sprintf("Test %s panicked: %v", tt.name, r),
						Remediation: "Fix token validation logic to prevent crashes",
					})
				} else {
					result.TestsPassed++
				}
			}()
			tt.test(t)
		})
	}

	result.Duration = time.Since(start)
	s.results["token_security"] = result
	s.updateScore(result)
}

func (s *SecurityTestSuite) runAPIKeySecurityTests(t *testing.T) {
	start := time.Now()
	result := &TestResult{
		Category:        "API Key Security",
		Vulnerabilities: []Vulnerability{},
	}

	tests := []struct {
		name string
		test func(*testing.T)
	}{
		{"Hashed Storage", TestHashedAPIKeyStorage},
		{"Constant-Time Comparison", TestConstantTimeComparison},
		{"Rate Limiting", TestRateLimitingEnforcement},
		{"Revoked Key Rejection", TestRevokedKeyRejection},
		{"Expired Key Rejection", TestExpiredKeyRejection},
		{"Cross-Tenant Prevention", TestCrossTenantAccessPrevention},
		{"Concurrent Validation", TestConcurrentKeyValidation},
		{"Key Rotation", TestAPIKeyRotation},
	}

	for _, tt := range tests {
		result.TestsRun++
		t.Run(tt.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					result.TestsFailed++
					result.Vulnerabilities = append(result.Vulnerabilities, Vulnerability{
						Severity:    "P0",
						Category:    "API Key Security",
						Description: fmt.Sprintf("Test %s panicked: %v", tt.name, r),
						Remediation: "Fix API key validation to prevent crashes",
					})
				} else {
					result.TestsPassed++
				}
			}()
			tt.test(t)
		})
	}

	result.Duration = time.Since(start)
	s.results["apikey_security"] = result
	s.updateScore(result)
}

func (s *SecurityTestSuite) runBruteForceTests(t *testing.T) {
	start := time.Now()
	result := &TestResult{
		Category:        "Brute Force Protection",
		Vulnerabilities: []Vulnerability{},
	}

	tests := []struct {
		name string
		test func(*testing.T)
	}{
		{"Account Lockout", TestAccountLockoutAfterFailedAttempts},
		{"Lockout Duration", TestLockoutDurationEnforcement},
		{"IP Rate Limiting", TestIPBasedRateLimiting},
		{"Distributed Attack Detection", TestDistributedBruteForceDetection},
		{"Account Unlock", TestAccountUnlockMechanism},
		{"Success Reset", TestSuccessfulLoginResetsCounter},
		{"Concurrent Attempts", TestConcurrentBruteForceAttempts},
		{"IP Blocklist", TestIPBlocklist},
	}

	for _, tt := range tests {
		result.TestsRun++
		t.Run(tt.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					result.TestsFailed++
					result.Vulnerabilities = append(result.Vulnerabilities, Vulnerability{
						Severity:    "P0",
						Category:    "Brute Force",
						Description: fmt.Sprintf("Test %s panicked: %v", tt.name, r),
						Remediation: "Fix brute force protection to prevent crashes",
					})
				} else {
					result.TestsPassed++
				}
			}()
			tt.test(t)
		})
	}

	result.Duration = time.Since(start)
	s.results["brute_force"] = result
	s.updateScore(result)
}

func (s *SecurityTestSuite) runAuditLogTests(t *testing.T) {
	start := time.Now()
	result := &TestResult{
		Category:        "Audit Log Integrity",
		Vulnerabilities: []Vulnerability{},
	}

	tests := []struct {
		name string
		test func(*testing.T)
	}{
		{"Hash Chain Validation", TestHashChainValidation},
		{"Tamper Detection", TestTamperDetection},
		{"Immutability Enforcement", TestImmutabilityEnforcement},
		{"No Deletion", TestNoDeletionOfAuditEvents},
		{"Chain Recovery", TestChainRecoveryDetection},
		{"Concurrent Append", TestConcurrentAuditAppend},
		{"Event Signature", TestAuditEventSignature},
		{"Performance", TestAuditLogPerformance},
	}

	for _, tt := range tests {
		result.TestsRun++
		t.Run(tt.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					result.TestsFailed++
					result.Vulnerabilities = append(result.Vulnerabilities, Vulnerability{
						Severity:    "P0",
						Category:    "Audit Log",
						Description: fmt.Sprintf("Test %s panicked: %v", tt.name, r),
						Remediation: "Fix audit log to prevent crashes",
					})
				} else {
					result.TestsPassed++
				}
			}()
			tt.test(t)
		})
	}

	result.Duration = time.Since(start)
	s.results["audit_log"] = result
	s.updateScore(result)
}

func (s *SecurityTestSuite) runTenantIsolationTests(t *testing.T) {
	start := time.Now()
	result := &TestResult{
		Category:        "Multi-Tenant Isolation",
		Vulnerabilities: []Vulnerability{},
	}

	tests := []struct {
		name string
		test func(*testing.T)
	}{
		{"Cross-Tenant Token Blocked", TestCrossTenantTokenAccessBlocked},
		{"Cross-Tenant API Key Blocked", TestCrossTenantAPIKeyAccessBlocked},
		{"Cross-Tenant Audit Blocked", TestCrossTenantAuditLogAccessBlocked},
		{"RLS Policy Enforcement", TestRLSPolicyEnforcement},
		{"Concurrent Multi-Tenant", TestConcurrentMultiTenantAccess},
		{"Data Leakage Prevention", TestTenantDataLeakagePrevention},
		{"Context Validation", TestTenantContextValidation},
	}

	for _, tt := range tests {
		result.TestsRun++
		t.Run(tt.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					result.TestsFailed++
					result.Vulnerabilities = append(result.Vulnerabilities, Vulnerability{
						Severity:    "P0",
						Category:    "Tenant Isolation",
						Description: fmt.Sprintf("Test %s panicked: %v", tt.name, r),
						Remediation: "Fix tenant isolation to prevent crashes",
					})
				} else {
					result.TestsPassed++
				}
			}()
			tt.test(t)
		})
	}

	result.Duration = time.Since(start)
	s.results["tenant_isolation"] = result
	s.updateScore(result)
}

func (s *SecurityTestSuite) runPenetrationTests(t *testing.T) {
	start := time.Now()
	result := &TestResult{
		Category:        "Penetration Testing",
		Vulnerabilities: []Vulnerability{},
	}

	tests := []struct {
		name string
		test func(*testing.T)
	}{
		{"SQL Injection", TestSQLInjectionAttempts},
		{"XSS Prevention", TestXSSPreventionInAuditLogs},
		{"CSRF Validation", TestCSRFTokenValidation},
		{"Session Fixation", TestSessionFixationAttack},
		{"Replay Attack", TestReplayAttackPrevention},
		{"Path Traversal", TestPathTraversalAttack},
		{"Command Injection", TestCommandInjectionPrevention},
		{"Header Injection", TestHeaderInjectionAttack},
		{"LDAP Injection", TestLDAPInjectionPrevention},
		{"XXE Attack", TestXMLExternalEntityAttack},
		{"Insecure Deserialization", TestInsecureDeserialization},
	}

	for _, tt := range tests {
		result.TestsRun++
		t.Run(tt.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					result.TestsFailed++
					result.Vulnerabilities = append(result.Vulnerabilities, Vulnerability{
						Severity:    "P0",
						Category:    "Penetration Test",
						Description: fmt.Sprintf("Test %s panicked: %v", tt.name, r),
						Remediation: "Fix input validation to prevent crashes",
					})
				} else {
					result.TestsPassed++
				}
			}()
			tt.test(t)
		})
	}

	result.Duration = time.Since(start)
	s.results["penetration"] = result
	s.updateScore(result)
}

func (s *SecurityTestSuite) runPerformanceTests(t *testing.T) {
	monitor := NewPerformanceMonitor()

	// Test various security operations
	operations := map[string]func(){
		"Token Validation": func() {
			suite := setupTokenTests(t)
			token := suite.createToken(t, map[string]interface{}{
				"sub": "user-123", "exp": time.Now().Add(1 * time.Hour).Unix(),
				"iss": testIssuer, "aud": testAudience, "tenant_id": testTenantID,
			})
			suite.validateToken(token)
		},
		"API Key Check": func() {
			store := NewAPIKeyStore()
			rawKey := generateAPIKey(t)
			hashedKey := hashAPIKey(rawKey)
			apiKey := &APIKey{ID: "key-123", HashedKey: hashedKey, TenantID: "tenant-123", CreatedAt: time.Now()}
			store.Store(apiKey)
			store.ValidateKey(rawKey, "tenant-123")
		},
		"Brute Force Check": func() {
			protector := NewBruteForceProtector(5, 5*time.Minute)
			protector.AllowLogin("user-123", "192.168.1.100")
		},
		"Audit Log Append": func() {
			log := NewAuditLog()
			event := &AuditEvent{
				ID: "event-123", TenantID: "tenant-123", Timestamp: time.Now(),
				EventType: "auth", UserID: "user-123", Action: "test", Status: "success",
			}
			log.Append(event)
		},
	}

	for op, fn := range operations {
		for i := 0; i < 100; i++ {
			monitor.Track(op, fn)
		}

		stats := monitor.GetStats(op)
		t.Logf("%s: avg=%v, min=%v, max=%v, p95=%v, meets_goal=%v",
			op, stats.Average, stats.Min, stats.Max, stats.P95, stats.MeetsGoal)

		if !stats.MeetsGoal {
			t.Errorf("%s exceeds performance goal: %v > 10ms", op, stats.Average)
		}
	}
}

func (s *SecurityTestSuite) updateScore(result *TestResult) {
	if result.TestsRun == 0 {
		return
	}

	categoryScore := (result.TestsPassed * 100) / result.TestsRun

	// Deduct points for vulnerabilities
	for _, vuln := range result.Vulnerabilities {
		switch vuln.Severity {
		case "P0":
			categoryScore -= 20
		case "P1":
			categoryScore -= 10
		case "P2":
			categoryScore -= 5
		}
	}

	if categoryScore < 0 {
		categoryScore = 0
	}

	s.score += categoryScore
}

func (s *SecurityTestSuite) generateReport(t *testing.T) {
	duration := time.Since(s.startTime)

	t.Log("\n" + strings.Repeat("=", 80))
	t.Log("SECURITY TEST SUITE - FINAL REPORT")
	t.Log(strings.Repeat("=", 80))

	totalTests := 0
	totalPassed := 0
	totalFailed := 0
	allVulnerabilities := []Vulnerability{}

	for category, result := range s.results {
		t.Logf("\n%s:", result.Category)
		t.Logf("  Tests Run: %d", result.TestsRun)
		t.Logf("  Passed: %d", result.TestsPassed)
		t.Logf("  Failed: %d", result.TestsFailed)
		t.Logf("  Duration: %v", result.Duration)

		if len(result.Vulnerabilities) > 0 {
			t.Logf("  Vulnerabilities Found: %d", len(result.Vulnerabilities))
			for _, vuln := range result.Vulnerabilities {
				t.Logf("    [%s] %s: %s", vuln.Severity, vuln.Category, vuln.Description)
				allVulnerabilities = append(allVulnerabilities, vuln)
			}
		}

		totalTests += result.TestsRun
		totalPassed += result.TestsPassed
		totalFailed += result.TestsFailed
	}

	finalScore := (s.score * 100) / (s.maxScore * len(s.results))

	t.Log("\n" + strings.Repeat("-", 80))
	t.Log("SUMMARY:")
	t.Logf("  Total Tests: %d", totalTests)
	t.Logf("  Passed: %d (%.1f%%)", totalPassed, float64(totalPassed)*100/float64(totalTests))
	t.Logf("  Failed: %d (%.1f%%)", totalFailed, float64(totalFailed)*100/float64(totalTests))
	t.Logf("  Total Vulnerabilities: %d", len(allVulnerabilities))
	t.Logf("  Security Score: %d/100", finalScore)
	t.Logf("  Total Duration: %v", duration)
	t.Log(strings.Repeat("=", 80))

	// Assert final requirements
	if len(allVulnerabilities) > 0 {
		t.Errorf("Found %d security vulnerabilities", len(allVulnerabilities))
	}

	if finalScore < 90 {
		t.Errorf("Security score %d is below required 90/100", finalScore)
	}

	t.Logf("\n✅ Security validation complete. Score: %d/100", finalScore)
}
