// Package cache provides caching implementations for authorization decisions
package cache

import "fmt"

// CacheError represents an error in cache operations
type CacheError struct {
	Code    string
	Message string
	Err     error
}

func (e *CacheError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("cache error [%s]: %s: %v", e.Code, e.Message, e.Err)
	}
	return fmt.Sprintf("cache error [%s]: %s", e.Code, e.Message)
}

// Error constructors
func ErrInvalidConfig(msg string) *CacheError {
	return &CacheError{
		Code:    "INVALID_CONFIG",
		Message: msg,
	}
}

func ErrConnectionFailed(err error) *CacheError {
	return &CacheError{
		Code:    "CONNECTION_FAILED",
		Message: "failed to connect to cache server",
		Err:     err,
	}
}

func ErrSerializationFailed(err error) *CacheError {
	return &CacheError{
		Code:    "SERIALIZATION_FAILED",
		Message: "failed to serialize value",
		Err:     err,
	}
}

func ErrDeserializationFailed(err error) *CacheError {
	return &CacheError{
		Code:    "DESERIALIZATION_FAILED",
		Message: "failed to deserialize value",
		Err:     err,
	}
}

func ErrOperationFailed(op string, err error) *CacheError {
	return &CacheError{
		Code:    "OPERATION_FAILED",
		Message: fmt.Sprintf("cache operation failed: %s", op),
		Err:     err,
	}
}
