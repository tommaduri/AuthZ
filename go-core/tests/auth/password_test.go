package auth_test

import (
	"testing"

	"github.com/authz-engine/go-core/internal/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestValidatePassword tests password validation requirements
func TestValidatePassword(t *testing.T) {
	tests := []struct {
		name        string
		password    string
		expectError bool
		errorMsg    string
	}{
		{
			name:        "valid password",
			password:    "ValidPass123!",
			expectError: false,
		},
		{
			name:        "too short",
			password:    "Val1!",
			expectError: true,
			errorMsg:    "at least 8 characters",
		},
		{
			name:        "missing uppercase",
			password:    "validpass123!",
			expectError: true,
			errorMsg:    "uppercase letter",
		},
		{
			name:        "missing lowercase",
			password:    "VALIDPASS123!",
			expectError: true,
			errorMsg:    "lowercase letter",
		},
		{
			name:        "missing number",
			password:    "ValidPass!",
			expectError: true,
			errorMsg:    "number",
		},
		{
			name:        "missing special character",
			password:    "ValidPass123",
			expectError: true,
			errorMsg:    "special character",
		},
		{
			name:        "all requirements met with different special chars",
			password:    "MyP@ssw0rd!",
			expectError: false,
		},
		{
			name:        "long password with all requirements",
			password:    "ThisIsAVeryL0ngP@sswordWith$pecialChars",
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := auth.ValidatePassword(tt.password)
			if tt.expectError {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errorMsg)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

// TestHashPassword tests password hashing functionality
func TestHashPassword(t *testing.T) {
	t.Run("valid password", func(t *testing.T) {
		password := "ValidPass123!"
		hash, err := auth.HashPassword(password)
		require.NoError(t, err)
		assert.NotEmpty(t, hash)
		assert.NotEqual(t, password, hash)
		assert.Contains(t, hash, "$2a$12$") // bcrypt identifier with cost 12
	})

	t.Run("empty password", func(t *testing.T) {
		_, err := auth.HashPassword("")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "empty")
	})

	t.Run("invalid password", func(t *testing.T) {
		_, err := auth.HashPassword("weak")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "invalid password")
	})

	t.Run("different hashes for same password", func(t *testing.T) {
		password := "ValidPass123!"
		hash1, err1 := auth.HashPassword(password)
		hash2, err2 := auth.HashPassword(password)

		require.NoError(t, err1)
		require.NoError(t, err2)
		assert.NotEqual(t, hash1, hash2, "bcrypt should generate different salts")
	})
}

// TestVerifyPassword tests password verification
func TestVerifyPassword(t *testing.T) {
	password := "ValidPass123!"
	hash, err := auth.HashPassword(password)
	require.NoError(t, err)

	tests := []struct {
		name     string
		password string
		hash     string
		expected bool
	}{
		{
			name:     "correct password",
			password: password,
			hash:     hash,
			expected: true,
		},
		{
			name:     "wrong password",
			password: "WrongPass456!",
			hash:     hash,
			expected: false,
		},
		{
			name:     "empty password",
			password: "",
			hash:     hash,
			expected: false,
		},
		{
			name:     "empty hash",
			password: password,
			hash:     "",
			expected: false,
		},
		{
			name:     "both empty",
			password: "",
			hash:     "",
			expected: false,
		},
		{
			name:     "invalid hash format",
			password: password,
			hash:     "not-a-valid-bcrypt-hash",
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := auth.VerifyPassword(tt.password, tt.hash)
			assert.Equal(t, tt.expected, result)
		})
	}
}

// TestPasswordHashingCost tests that bcrypt cost is correct
func TestPasswordHashingCost(t *testing.T) {
	password := "ValidPass123!"
	hash, err := auth.HashPassword(password)
	require.NoError(t, err)

	// Verify cost is 12
	assert.Contains(t, hash, "$2a$12$", "bcrypt cost should be 12")
}

// BenchmarkHashPassword benchmarks password hashing performance
func BenchmarkHashPassword(b *testing.B) {
	password := "ValidPass123!"
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := auth.HashPassword(password)
		if err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkVerifyPassword benchmarks password verification performance
func BenchmarkVerifyPassword(b *testing.B) {
	password := "ValidPass123!"
	hash, err := auth.HashPassword(password)
	if err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		auth.VerifyPassword(password, hash)
	}
}
