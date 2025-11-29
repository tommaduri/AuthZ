package security_test

import (
	"strings"
	"testing"
	"testing/quick"
	"unicode/utf8"
)

// TestFuzzTokenValidation fuzzes JWT token validation
func TestFuzzTokenValidation(t *testing.T) {
	suite := setupTokenTests(t)

	fuzzFunc := func(input string) bool {
		// Should never panic on any input
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("Token validation panicked on input: %q", input)
			}
		}()

		// Validate (may fail, but should not crash)
		suite.validateToken(input)
		return true
	}

	config := &quick.Config{MaxCount: 1000}
	if err := quick.Check(fuzzFunc, config); err != nil {
		t.Error("Fuzzing found issues:", err)
	}
}

// TestFuzzAPIKeyValidation fuzzes API key validation
func TestFuzzAPIKeyValidation(t *testing.T) {
	store := NewAPIKeyStore()

	fuzzFunc := func(key, tenant string) bool {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("API key validation panicked: key=%q tenant=%q", key, tenant)
			}
		}()

		store.ValidateKey(key, tenant)
		return true
	}

	config := &quick.Config{MaxCount: 1000}
	if err := quick.Check(fuzzFunc, config); err != nil {
		t.Error("Fuzzing found issues:", err)
	}
}

// TestFuzzSQLInjection fuzzes SQL injection detection
func TestFuzzSQLInjection(t *testing.T) {
	fuzzFunc := func(input string) bool {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("SQL validation panicked on: %q", input)
			}
		}()

		// Should handle any input without crashing
		validateInputForSQL(input)
		return true
	}

	config := &quick.Config{MaxCount: 10000}
	if err := quick.Check(fuzzFunc, config); err != nil {
		t.Error("Fuzzing found issues:", err)
	}
}

// TestFuzzXSSSanitization fuzzes XSS sanitization
func TestFuzzXSSSanitization(t *testing.T) {
	fuzzFunc := func(input string) bool {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("XSS sanitization panicked on: %q", input)
			}
		}()

		sanitized := sanitizeForHTML(input)

		// Verify no dangerous patterns in output
		dangerous := []string{"<script", "javascript:", "onerror=", "onload="}
		lower := strings.ToLower(sanitized)

		for _, pattern := range dangerous {
			if strings.Contains(lower, pattern) {
				t.Errorf("Dangerous pattern %q found in sanitized output: %q", pattern, sanitized)
				return false
			}
		}

		return true
	}

	config := &quick.Config{MaxCount: 10000}
	if err := quick.Check(fuzzFunc, config); err != nil {
		t.Error("Fuzzing found issues:", err)
	}
}

// TestFuzzBruteForceProtection fuzzes brute force protection
func TestFuzzBruteForceProtection(t *testing.T) {
	protector := NewBruteForceProtector(5, 5*time.Minute)

	fuzzFunc := func(userID, ip string) bool {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("Brute force check panicked: user=%q ip=%q", userID, ip)
			}
		}()

		allowed, _ := protector.AllowLogin(userID, ip)
		if allowed {
			protector.RecordFailedLogin(userID, ip)
		}
		return true
	}

	config := &quick.Config{MaxCount: 5000}
	if err := quick.Check(fuzzFunc, config); err != nil {
		t.Error("Fuzzing found issues:", err)
	}
}

// TestFuzzPathTraversal fuzzes path traversal detection
func TestFuzzPathTraversal(t *testing.T) {
	fuzzFunc := func(path string) bool {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("Path validation panicked on: %q", path)
			}
		}()

		safe := validatePath(path)

		// If marked as safe, verify no traversal patterns
		if safe {
			dangerous := []string{"..", "~", "/etc", "/var", "\\windows"}
			lower := strings.ToLower(path)

			for _, pattern := range dangerous {
				if strings.Contains(lower, pattern) {
					t.Errorf("Path marked safe but contains %q: %q", pattern, path)
					return false
				}
			}
		}

		return true
	}

	config := &quick.Config{MaxCount: 10000}
	if err := quick.Check(fuzzFunc, config); err != nil {
		t.Error("Fuzzing found issues:", err)
	}
}

// TestFuzzMalformedInputs tests handling of malformed inputs
func TestFuzzMalformedInputs(t *testing.T) {
	generator := &MalformedInputGenerator{}
	malformed := generator.GenerateMalformedInputs()

	tests := []struct {
		name      string
		validator func(string) bool
	}{
		{"SQL Injection", validateInputForSQL},
		{"XSS", func(s string) bool { sanitizeForHTML(s); return true }},
		{"Path Traversal", validatePath},
		{"Command Injection", validateCommandInput},
		{"LDAP Injection", validateLDAPInput},
		{"XML Injection", validateXMLInput},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for _, input := range malformed {
				func() {
					defer func() {
						if r := recover(); r != nil {
							t.Errorf("%s panicked on malformed input: %q, panic: %v",
								tt.name, input, r)
						}
					}()

					tt.validator(input)
				}()
			}
		})
	}
}

// TestFuzzUTF8Handling tests UTF-8 edge cases
func TestFuzzUTF8Handling(t *testing.T) {
	invalidUTF8Sequences := []string{
		"\xFF\xFE\xFD",                    // Invalid UTF-8
		string([]byte{0xC0, 0x80}),        // Overlong encoding
		string([]byte{0xED, 0xA0, 0x80}),  // UTF-16 surrogate
		string([]byte{0xF4, 0x90, 0x80, 0x80}), // Above Unicode range
	}

	for i, seq := range invalidUTF8Sequences {
		t.Run(t.Name(), func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("Panicked on UTF-8 sequence %d: %v", i, r)
				}
			}()

			// Should handle invalid UTF-8 gracefully
			if utf8.ValidString(seq) {
				t.Logf("Sequence %d is valid UTF-8", i)
			}

			// Try sanitization
			sanitizeForHTML(seq)
			validateInputForSQL(seq)
		})
	}
}

// TestFuzzNullBytes tests null byte handling
func TestFuzzNullBytes(t *testing.T) {
	nullByteInputs := []string{
		"\x00",
		"admin\x00.txt",
		"user\x00' OR '1'='1",
		"<script>\x00alert('XSS')</script>",
		"/etc/passwd\x00.jpg",
	}

	validators := map[string]func(string) bool{
		"SQL":     validateInputForSQL,
		"Path":    validatePath,
		"Command": validateCommandInput,
		"LDAP":    validateLDAPInput,
	}

	for name, validator := range validators {
		t.Run(name, func(t *testing.T) {
			for _, input := range nullByteInputs {
				defer func() {
					if r := recover(); r != nil {
						t.Errorf("%s panicked on null byte input: %q", name, input)
					}
				}()

				// Should reject or safely handle null bytes
				result := validator(input)
				t.Logf("%s(%q) = %v", name, input, result)
			}
		})
	}
}

// TestFuzzLargeInputs tests handling of very large inputs
func TestFuzzLargeInputs(t *testing.T) {
	sizes := []int{1000, 10000, 100000, 1000000}

	for _, size := range sizes {
		t.Run(t.Name(), func(t *testing.T) {
			largeInput := strings.Repeat("A", size)

			defer func() {
				if r := recover(); r != nil {
					t.Errorf("Panicked on input size %d: %v", size, r)
				}
			}()

			// Should handle large inputs without excessive memory or time
			validateInputForSQL(largeInput)
			sanitizeForHTML(largeInput)
			validatePath(largeInput)
		})
	}
}

// TestFuzzSpecialCharacters tests special character handling
func TestFuzzSpecialCharacters(t *testing.T) {
	specialChars := []string{
		"'\"\\`",
		"<>&;|",
		"\r\n\t",
		"\x00\x01\x02",
		"!@#$%^&*()",
		"{}[]()<>",
		"../\\\\",
		"%00%20%0a",
	}

	for i, chars := range specialChars {
		t.Run(t.Name(), func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("Panicked on special chars %d: %q, panic: %v", i, chars, r)
				}
			}()

			validateInputForSQL(chars)
			sanitizeForHTML(chars)
			validatePath(chars)
			validateCommandInput(chars)
		})
	}
}

// TestFuzzUnicodeEdgeCases tests Unicode edge cases
func TestFuzzUnicodeEdgeCases(t *testing.T) {
	unicodeEdgeCases := []string{
		"\u0000",                    // Null
		"\uFEFF",                    // BOM
		"\u200B",                    // Zero-width space
		"\u202E",                    // Right-to-left override
		"\uFFFD",                    // Replacement character
		"＜script＞",                   // Fullwidth script tags
		"\u0027 OR \u00271\u0027=\u00271", // Unicode SQL injection
	}

	for i, input := range unicodeEdgeCases {
		t.Run(t.Name(), func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("Panicked on Unicode case %d: %q", i, input)
				}
			}()

			validateInputForSQL(input)
			sanitizeForHTML(input)
		})
	}
}

// TestFuzzConcurrentValidation tests concurrent validation safety
func TestFuzzConcurrentValidation(t *testing.T) {
	fuzzFunc := func(input string) bool {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("Concurrent validation panicked: %v", r)
			}
		}()

		// Run validations concurrently
		done := make(chan bool, 4)

		go func() {
			validateInputForSQL(input)
			done <- true
		}()

		go func() {
			sanitizeForHTML(input)
			done <- true
		}()

		go func() {
			validatePath(input)
			done <- true
		}()

		go func() {
			validateCommandInput(input)
			done <- true
		}()

		// Wait for all to complete
		for i := 0; i < 4; i++ {
			<-done
		}

		return true
	}

	config := &quick.Config{MaxCount: 1000}
	if err := quick.Check(fuzzFunc, config); err != nil {
		t.Error("Concurrent fuzzing found issues:", err)
	}
}
