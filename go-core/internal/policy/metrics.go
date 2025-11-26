package policy

import (
	"sync"

	"github.com/prometheus/client_golang/prometheus"
)

var (
	metricsOnce sync.Once
	metrics     *Metrics
)

// Metrics tracks policy-related operations
type Metrics struct {
	// Policy reload metrics
	reloadAttempts prometheus.Counter
	reloadSuccess  prometheus.Counter
	reloadFailures prometheus.Counter
	reloadDuration prometheus.Histogram

	// Policy version metrics
	currentVersion prometheus.Gauge
	policyCount    prometheus.Gauge

	// Rollback metrics
	rollbackAttempts prometheus.Counter
	rollbackSuccess  prometheus.Counter
	rollbackFailures prometheus.Counter
	rollbackDuration prometheus.Histogram

	// Validation metrics
	validationAttempts prometheus.Counter
	validationSuccess  prometheus.Counter
	validationFailures prometheus.Counter

	registry *prometheus.Registry
}

// NewMetrics creates a new metrics instance with Prometheus collectors (singleton)
func NewMetrics() *Metrics {
	metricsOnce.Do(func() {
		registry := prometheus.NewRegistry()

		metrics = &Metrics{
			registry: registry,

			// Policy reload metrics
			reloadAttempts: prometheus.NewCounter(prometheus.CounterOpts{
				Name: "authz_policy_reload_attempts_total",
				Help: "Total number of policy reload attempts",
			}),
			reloadSuccess: prometheus.NewCounter(prometheus.CounterOpts{
				Name: "authz_policy_reload_success_total",
				Help: "Total number of successful policy reloads",
			}),
			reloadFailures: prometheus.NewCounter(prometheus.CounterOpts{
				Name: "authz_policy_reload_failures_total",
				Help: "Total number of failed policy reloads",
			}),
			reloadDuration: prometheus.NewHistogram(prometheus.HistogramOpts{
				Name:    "authz_policy_reload_duration_seconds",
				Help:    "Duration of policy reload operations in seconds",
				Buckets: prometheus.DefBuckets,
			}),

			// Policy version metrics
			currentVersion: prometheus.NewGauge(prometheus.GaugeOpts{
				Name: "authz_policy_current_version",
				Help: "Current policy version number",
			}),
			policyCount: prometheus.NewGauge(prometheus.GaugeOpts{
				Name: "authz_policy_count",
				Help: "Current number of active policies",
			}),

			// Rollback metrics
			rollbackAttempts: prometheus.NewCounter(prometheus.CounterOpts{
				Name: "authz_policy_rollback_attempts_total",
				Help: "Total number of policy rollback attempts",
			}),
			rollbackSuccess: prometheus.NewCounter(prometheus.CounterOpts{
				Name: "authz_policy_rollback_success_total",
				Help: "Total number of successful policy rollbacks",
			}),
			rollbackFailures: prometheus.NewCounter(prometheus.CounterOpts{
				Name: "authz_policy_rollback_failures_total",
				Help: "Total number of failed policy rollbacks",
			}),
			rollbackDuration: prometheus.NewHistogram(prometheus.HistogramOpts{
				Name:    "authz_policy_rollback_duration_seconds",
				Help:    "Duration of policy rollback operations in seconds",
				Buckets: prometheus.DefBuckets,
			}),

			// Validation metrics
			validationAttempts: prometheus.NewCounter(prometheus.CounterOpts{
				Name: "authz_policy_validation_attempts_total",
				Help: "Total number of policy validation attempts",
			}),
			validationSuccess: prometheus.NewCounter(prometheus.CounterOpts{
				Name: "authz_policy_validation_success_total",
				Help: "Total number of successful policy validations",
			}),
			validationFailures: prometheus.NewCounter(prometheus.CounterOpts{
				Name: "authz_policy_validation_failures_total",
				Help: "Total number of failed policy validations",
			}),
		}

		// Register all metrics
		registry.MustRegister(
			metrics.reloadAttempts,
			metrics.reloadSuccess,
			metrics.reloadFailures,
			metrics.reloadDuration,
			metrics.currentVersion,
			metrics.policyCount,
			metrics.rollbackAttempts,
			metrics.rollbackSuccess,
			metrics.rollbackFailures,
			metrics.rollbackDuration,
			metrics.validationAttempts,
			metrics.validationSuccess,
			metrics.validationFailures,
		)
	})

	return metrics
}

// RecordReloadAttempt increments the reload attempts counter
func (m *Metrics) RecordReloadAttempt() {
	m.reloadAttempts.Inc()
}

// RecordReloadSuccess increments the reload success counter
func (m *Metrics) RecordReloadSuccess(duration float64) {
	m.reloadSuccess.Inc()
	m.reloadDuration.Observe(duration)
}

// RecordReloadFailure increments the reload failure counter
func (m *Metrics) RecordReloadFailure(duration float64) {
	m.reloadFailures.Inc()
	m.reloadDuration.Observe(duration)
}

// SetCurrentVersion sets the current policy version gauge
func (m *Metrics) SetCurrentVersion(version int64) {
	m.currentVersion.Set(float64(version))
}

// SetPolicyCount sets the policy count gauge
func (m *Metrics) SetPolicyCount(count int) {
	m.policyCount.Set(float64(count))
}

// RecordRollbackAttempt increments the rollback attempts counter
func (m *Metrics) RecordRollbackAttempt() {
	m.rollbackAttempts.Inc()
}

// RecordRollbackSuccess increments the rollback success counter
func (m *Metrics) RecordRollbackSuccess(duration float64) {
	m.rollbackSuccess.Inc()
	m.rollbackDuration.Observe(duration)
}

// RecordRollbackFailure increments the rollback failure counter
func (m *Metrics) RecordRollbackFailure(duration float64) {
	m.rollbackFailures.Inc()
	m.rollbackDuration.Observe(duration)
}

// RecordValidationAttempt increments the validation attempts counter
func (m *Metrics) RecordValidationAttempt() {
	m.validationAttempts.Inc()
}

// RecordValidationSuccess increments the validation success counter
func (m *Metrics) RecordValidationSuccess() {
	m.validationSuccess.Inc()
}

// RecordValidationFailure increments the validation failure counter
func (m *Metrics) RecordValidationFailure() {
	m.validationFailures.Inc()
}
