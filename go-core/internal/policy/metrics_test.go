package policy

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNewMetrics(t *testing.T) {
	m := NewMetrics()
	assert.NotNil(t, m)
	assert.NotNil(t, m.reloadAttempts)
	assert.NotNil(t, m.reloadSuccess)
	assert.NotNil(t, m.reloadFailures)
	assert.NotNil(t, m.reloadDuration)
	assert.NotNil(t, m.currentVersion)
	assert.NotNil(t, m.policyCount)
	assert.NotNil(t, m.rollbackAttempts)
	assert.NotNil(t, m.rollbackSuccess)
	assert.NotNil(t, m.rollbackFailures)
	assert.NotNil(t, m.rollbackDuration)
	assert.NotNil(t, m.validationAttempts)
	assert.NotNil(t, m.validationSuccess)
	assert.NotNil(t, m.validationFailures)
}

func TestMetrics_RecordReload(t *testing.T) {
	m := NewMetrics()

	// Test reload attempt
	m.RecordReloadAttempt()

	// Test reload success
	m.RecordReloadSuccess(0.5)

	// Test reload failure
	m.RecordReloadFailure(0.3)

	// No assertions - just verify no panics
	// Prometheus metrics are registered globally
}

func TestMetrics_SetGauges(t *testing.T) {
	m := NewMetrics()

	// Test setting current version
	m.SetCurrentVersion(5)

	// Test setting policy count
	m.SetPolicyCount(10)

	// No assertions - just verify no panics
}

func TestMetrics_RecordRollback(t *testing.T) {
	m := NewMetrics()

	// Test rollback attempt
	m.RecordRollbackAttempt()

	// Test rollback success
	m.RecordRollbackSuccess(0.2)

	// Test rollback failure
	m.RecordRollbackFailure(0.1)

	// No assertions - just verify no panics
}

func TestMetrics_RecordValidation(t *testing.T) {
	m := NewMetrics()

	// Test validation attempt
	m.RecordValidationAttempt()

	// Test validation success
	m.RecordValidationSuccess()

	// Test validation failure
	m.RecordValidationFailure()

	// No assertions - just verify no panics
}
