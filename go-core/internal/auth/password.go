// Package auth provides password authentication utilities
package auth

import (
	"fmt"
	"regexp"
	"unicode"

	"golang.org/x/crypto/bcrypt"
)

const (
	// BCryptCost is the cost parameter for bcrypt hashing (12 = ~250ms per hash)
	BCryptCost = 12

	// Password validation requirements
	minPasswordLength = 8
)

var (
	// Password validation rules
	uppercaseRegex = regexp.MustCompile(`[A-Z]`)
	lowercaseRegex = regexp.MustCompile(`[a-z]`)
	numberRegex    = regexp.MustCompile(`[0-9]`)
	specialRegex   = regexp.MustCompile(`[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]`)
)

// ValidatePassword validates a password against security requirements:
// - Minimum 8 characters
// - At least 1 uppercase letter
// - At least 1 lowercase letter
// - At least 1 number
// - At least 1 special character
func ValidatePassword(password string) error {
	if len(password) < minPasswordLength {
		return fmt.Errorf("password must be at least %d characters long", minPasswordLength)
	}

	if !uppercaseRegex.MatchString(password) {
		return fmt.Errorf("password must contain at least one uppercase letter")
	}

	if !lowercaseRegex.MatchString(password) {
		return fmt.Errorf("password must contain at least one lowercase letter")
	}

	if !numberRegex.MatchString(password) {
		return fmt.Errorf("password must contain at least one number")
	}

	if !specialRegex.MatchString(password) {
		return fmt.Errorf("password must contain at least one special character")
	}

	// Additional check: ensure password contains printable characters only
	for _, r := range password {
		if !unicode.IsPrint(r) {
			return fmt.Errorf("password contains invalid characters")
		}
	}

	return nil
}

// HashPassword hashes a password using bcrypt with cost 12
// Returns the bcrypt hash string or an error
func HashPassword(password string) (string, error) {
	if password == "" {
		return "", fmt.Errorf("password cannot be empty")
	}

	// Validate password before hashing
	if err := ValidatePassword(password); err != nil {
		return "", fmt.Errorf("invalid password: %w", err)
	}

	// Generate bcrypt hash with cost 12
	hash, err := bcrypt.GenerateFromPassword([]byte(password), BCryptCost)
	if err != nil {
		return "", fmt.Errorf("failed to hash password: %w", err)
	}

	return string(hash), nil
}

// VerifyPassword verifies a password against a bcrypt hash using constant-time comparison
// Returns true if the password matches the hash, false otherwise
func VerifyPassword(password, hash string) bool {
	if password == "" || hash == "" {
		return false
	}

	// bcrypt.CompareHashAndPassword uses constant-time comparison internally
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}
