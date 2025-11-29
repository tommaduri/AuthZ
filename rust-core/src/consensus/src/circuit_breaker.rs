use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use parking_lot::RwLock;
use tokio::time::timeout;
use prometheus::{Counter, Gauge, GaugeVec, CounterVec, HistogramVec, Registry};
use tracing::{debug, warn, info};

use crate::error::ConsensusError;

/// Circuit breaker states following the classic pattern
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitState {
    /// Normal operation - all requests pass through
    Closed,
    /// Failing state - reject all requests immediately
    Open,
    /// Testing recovery - allow limited requests to test
    HalfOpen,
}

impl CircuitState {
    pub fn as_metric_value(&self) -> f64 {
        match self {
            CircuitState::Closed => 0.0,
            CircuitState::Open => 1.0,
            CircuitState::HalfOpen => 2.0,
        }
    }
}

/// Configuration for circuit breaker behavior
#[derive(Debug, Clone)]
pub struct CircuitConfig {
    /// Number of consecutive failures before opening circuit
    pub failure_threshold: usize,
    /// Duration to wait before transitioning from Open to HalfOpen
    pub timeout: Duration,
    /// Maximum number of requests allowed in HalfOpen state
    pub half_open_max_calls: usize,
    /// Number of consecutive successes needed to close from HalfOpen
    pub success_threshold: usize,
    /// Request timeout duration
    pub request_timeout: Duration,
}

impl Default for CircuitConfig {
    fn default() -> Self {
        Self {
            failure_threshold: 5,
            timeout: Duration::from_secs(30),
            half_open_max_calls: 3,
            success_threshold: 2,
            request_timeout: Duration::from_secs(10),
        }
    }
}

/// Metrics tracking for circuit breaker
#[derive(Debug)]
pub struct CircuitMetrics {
    pub state_gauge: Gauge,
    pub trip_counter: Counter,
    pub success_counter: Counter,
    pub failure_counter: Counter,
    pub rejected_counter: Counter,
    pub latency_histogram: HistogramVec,
}

impl CircuitMetrics {
    pub fn new(peer_id: &str, registry: &Registry) -> Result<Self, prometheus::Error> {
        // Sanitize peer_id for Prometheus (replace invalid chars with underscore)
        let sanitized_id = peer_id.replace('-', "_").replace('.', "_");

        let state_gauge = Gauge::new(
            format!("circuit_breaker_state_{}", sanitized_id),
            "Circuit breaker state (0=closed, 1=open, 2=half-open)",
        )?;
        registry.register(Box::new(state_gauge.clone()))?;

        let trip_counter = Counter::new(
            format!("circuit_breaker_trips_total_{}", sanitized_id),
            "Total number of circuit breaker trips",
        )?;
        registry.register(Box::new(trip_counter.clone()))?;

        let success_counter = Counter::new(
            format!("circuit_breaker_success_total_{}", sanitized_id),
            "Total successful requests",
        )?;
        registry.register(Box::new(success_counter.clone()))?;

        let failure_counter = Counter::new(
            format!("circuit_breaker_failure_total_{}", sanitized_id),
            "Total failed requests",
        )?;
        registry.register(Box::new(failure_counter.clone()))?;

        let rejected_counter = Counter::new(
            format!("circuit_breaker_rejected_total_{}", sanitized_id),
            "Total rejected requests",
        )?;
        registry.register(Box::new(rejected_counter.clone()))?;

        let latency_histogram = HistogramVec::new(
            prometheus::HistogramOpts::new(
                format!("circuit_breaker_latency_{}", sanitized_id),
                "Request latency distribution",
            ),
            &["status"],
        )?;
        registry.register(Box::new(latency_histogram.clone()))?;

        Ok(Self {
            state_gauge,
            trip_counter,
            success_counter,
            failure_counter,
            rejected_counter,
            latency_histogram,
        })
    }

    pub fn new_without_registry(peer_id: &str) -> Self {
        // Sanitize peer_id for Prometheus (replace invalid chars with underscore)
        let sanitized_id = peer_id.replace('-', "_").replace('.', "_");

        Self {
            state_gauge: Gauge::new(
                format!("circuit_breaker_state_{}", sanitized_id),
                "Circuit breaker state",
            ).unwrap(),
            trip_counter: Counter::new(
                format!("circuit_breaker_trips_total_{}", sanitized_id),
                "Total trips",
            ).unwrap(),
            success_counter: Counter::new(
                format!("circuit_breaker_success_total_{}", sanitized_id),
                "Total success",
            ).unwrap(),
            failure_counter: Counter::new(
                format!("circuit_breaker_failure_total_{}", sanitized_id),
                "Total failures",
            ).unwrap(),
            rejected_counter: Counter::new(
                format!("circuit_breaker_rejected_total_{}", sanitized_id),
                "Total rejected",
            ).unwrap(),
            latency_histogram: HistogramVec::new(
                prometheus::HistogramOpts::new(
                    format!("circuit_breaker_latency_{}", sanitized_id),
                    "Latency",
                ),
                &["status"],
            ).unwrap(),
        }
    }
}

/// Internal state tracking
#[derive(Debug)]
struct StateData {
    state: CircuitState,
    failure_count: usize,
    success_count: usize,
    half_open_calls: usize,
    last_failure_time: Option<Instant>,
    last_state_change: Instant,
}

impl Default for StateData {
    fn default() -> Self {
        Self {
            state: CircuitState::Closed,
            failure_count: 0,
            success_count: 0,
            half_open_calls: 0,
            last_failure_time: None,
            last_state_change: Instant::now(),
        }
    }
}

/// Circuit breaker implementation with automatic state transitions
pub struct CircuitBreaker {
    peer_id: String,
    config: CircuitConfig,
    state_data: Arc<RwLock<StateData>>,
    metrics: Arc<CircuitMetrics>,
}

impl CircuitBreaker {
    /// Create a new circuit breaker for a specific peer
    pub fn new(peer_id: String, config: CircuitConfig) -> Self {
        let metrics = Arc::new(CircuitMetrics::new_without_registry(&peer_id));
        metrics.state_gauge.set(CircuitState::Closed.as_metric_value());

        Self {
            peer_id,
            config,
            state_data: Arc::new(RwLock::new(StateData::default())),
            metrics,
        }
    }

    /// Create with custom metrics registry
    pub fn new_with_registry(
        peer_id: String,
        config: CircuitConfig,
        registry: &Registry,
    ) -> Result<Self, prometheus::Error> {
        let metrics = Arc::new(CircuitMetrics::new(&peer_id, registry)?);
        metrics.state_gauge.set(CircuitState::Closed.as_metric_value());

        Ok(Self {
            peer_id,
            config,
            state_data: Arc::new(RwLock::new(StateData::default())),
            metrics,
        })
    }

    /// Execute a function with circuit breaker protection
    pub async fn call<F, T, Fut>(&self, f: F) -> Result<T, ConsensusError>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<T, ConsensusError>>,
    {
        // Check if we can proceed with the call
        if !self.can_proceed() {
            self.metrics.rejected_counter.inc();
            return Err(ConsensusError::CircuitOpen(self.peer_id.clone()));
        }

        let start = Instant::now();

        // Execute with timeout
        let result = timeout(self.config.request_timeout, f()).await;

        let elapsed = start.elapsed();

        match result {
            Ok(Ok(value)) => {
                self.record_success();
                self.metrics.latency_histogram
                    .with_label_values(&["success"])
                    .observe(elapsed.as_secs_f64());
                Ok(value)
            }
            Ok(Err(e)) => {
                self.record_failure();
                self.metrics.latency_histogram
                    .with_label_values(&["failure"])
                    .observe(elapsed.as_secs_f64());
                Err(e)
            }
            Err(_) => {
                // Timeout
                self.record_failure();
                self.metrics.latency_histogram
                    .with_label_values(&["timeout"])
                    .observe(elapsed.as_secs_f64());
                Err(ConsensusError::Timeout(format!(
                    "Request to {} timed out after {:?}",
                    self.peer_id, self.config.request_timeout
                )))
            }
        }
    }

    /// Check if a request can proceed based on current state
    fn can_proceed(&self) -> bool {
        let mut state = self.state_data.write();

        // Check for automatic state transitions
        match state.state {
            CircuitState::Open => {
                if let Some(last_failure) = state.last_failure_time {
                    if last_failure.elapsed() >= self.config.timeout {
                        // Transition to HalfOpen
                        self.transition_to_half_open(&mut state);
                        return true;
                    }
                }
                false
            }
            CircuitState::HalfOpen => {
                // Only allow limited calls in half-open state
                if state.half_open_calls < self.config.half_open_max_calls {
                    state.half_open_calls += 1;
                    true
                } else {
                    false
                }
            }
            CircuitState::Closed => true,
        }
    }

    /// Record a successful request
    pub fn record_success(&self) {
        let mut state = self.state_data.write();
        self.metrics.success_counter.inc();

        match state.state {
            CircuitState::Closed => {
                // Reset failure count on success
                state.failure_count = 0;
            }
            CircuitState::HalfOpen => {
                state.success_count += 1;
                state.failure_count = 0;

                if state.success_count >= self.config.success_threshold {
                    // Enough successes to close the circuit
                    self.transition_to_closed(&mut state);
                }
            }
            CircuitState::Open => {
                // Shouldn't happen, but reset if it does
                warn!("Success recorded in Open state for peer {}", self.peer_id);
            }
        }
    }

    /// Record a failed request
    pub fn record_failure(&self) {
        let mut state = self.state_data.write();
        self.metrics.failure_counter.inc();
        state.last_failure_time = Some(Instant::now());

        match state.state {
            CircuitState::Closed => {
                state.failure_count += 1;

                if state.failure_count >= self.config.failure_threshold {
                    // Too many failures, open the circuit
                    self.transition_to_open(&mut state);
                }
            }
            CircuitState::HalfOpen => {
                // Any failure in half-open means we're not ready, go back to open
                self.transition_to_open(&mut state);
            }
            CircuitState::Open => {
                // Already open, just increment
                state.failure_count += 1;
            }
        }
    }

    /// Get current circuit state
    pub fn get_state(&self) -> CircuitState {
        self.state_data.read().state
    }

    /// Get peer ID
    pub fn peer_id(&self) -> &str {
        &self.peer_id
    }

    /// Force circuit to open state (for manual control)
    pub fn force_open(&self) {
        let mut state = self.state_data.write();
        if state.state != CircuitState::Open {
            self.transition_to_open(&mut state);
            info!("Circuit breaker for {} manually opened", self.peer_id);
        }
    }

    /// Force circuit to closed state (for manual control)
    pub fn force_close(&self) {
        let mut state = self.state_data.write();
        if state.state != CircuitState::Closed {
            self.transition_to_closed(&mut state);
            info!("Circuit breaker for {} manually closed", self.peer_id);
        }
    }

    /// Reset circuit breaker to initial state
    pub fn reset(&self) {
        let mut state = self.state_data.write();
        *state = StateData::default();
        self.metrics.state_gauge.set(CircuitState::Closed.as_metric_value());
        info!("Circuit breaker for {} reset", self.peer_id);
    }

    /// Get statistics about the circuit breaker
    pub fn get_stats(&self) -> CircuitStats {
        let state = self.state_data.read();
        CircuitStats {
            state: state.state,
            failure_count: state.failure_count,
            success_count: state.success_count,
            half_open_calls: state.half_open_calls,
            time_in_current_state: state.last_state_change.elapsed(),
            total_successes: self.metrics.success_counter.get() as usize,
            total_failures: self.metrics.failure_counter.get() as usize,
            total_trips: self.metrics.trip_counter.get() as usize,
            total_rejected: self.metrics.rejected_counter.get() as usize,
        }
    }

    // State transition helpers
    fn transition_to_open(&self, state: &mut StateData) {
        debug!("Circuit breaker for {} transitioning to Open", self.peer_id);
        state.state = CircuitState::Open;
        state.success_count = 0;
        state.half_open_calls = 0;
        state.last_state_change = Instant::now();
        self.metrics.state_gauge.set(CircuitState::Open.as_metric_value());
        self.metrics.trip_counter.inc();
    }

    fn transition_to_half_open(&self, state: &mut StateData) {
        debug!("Circuit breaker for {} transitioning to HalfOpen", self.peer_id);
        state.state = CircuitState::HalfOpen;
        state.success_count = 0;
        state.failure_count = 0;
        state.half_open_calls = 0;
        state.last_state_change = Instant::now();
        self.metrics.state_gauge.set(CircuitState::HalfOpen.as_metric_value());
    }

    fn transition_to_closed(&self, state: &mut StateData) {
        debug!("Circuit breaker for {} transitioning to Closed", self.peer_id);
        state.state = CircuitState::Closed;
        state.failure_count = 0;
        state.success_count = 0;
        state.half_open_calls = 0;
        state.last_state_change = Instant::now();
        self.metrics.state_gauge.set(CircuitState::Closed.as_metric_value());
    }
}

/// Statistics snapshot for circuit breaker
#[derive(Debug, Clone)]
pub struct CircuitStats {
    pub state: CircuitState,
    pub failure_count: usize,
    pub success_count: usize,
    pub half_open_calls: usize,
    pub time_in_current_state: Duration,
    pub total_successes: usize,
    pub total_failures: usize,
    pub total_trips: usize,
    pub total_rejected: usize,
}

impl CircuitStats {
    pub fn success_rate(&self) -> f64 {
        let total = self.total_successes + self.total_failures;
        if total == 0 {
            1.0
        } else {
            self.total_successes as f64 / total as f64
        }
    }

    pub fn failure_rate(&self) -> f64 {
        1.0 - self.success_rate()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_circuit_breaker_closed_to_open() {
        let config = CircuitConfig {
            failure_threshold: 3,
            timeout: Duration::from_secs(1),
            ..Default::default()
        };
        let cb = CircuitBreaker::new("test-peer".to_string(), config);

        assert_eq!(cb.get_state(), CircuitState::Closed);

        // Record failures to trip the circuit
        cb.record_failure();
        assert_eq!(cb.get_state(), CircuitState::Closed);
        cb.record_failure();
        assert_eq!(cb.get_state(), CircuitState::Closed);
        cb.record_failure();
        assert_eq!(cb.get_state(), CircuitState::Open);
    }

    #[tokio::test]
    async fn test_circuit_breaker_open_to_half_open() {
        let config = CircuitConfig {
            failure_threshold: 2,
            timeout: Duration::from_millis(100),
            ..Default::default()
        };
        let cb = CircuitBreaker::new("test-peer".to_string(), config);

        // Trip the circuit
        cb.record_failure();
        cb.record_failure();
        assert_eq!(cb.get_state(), CircuitState::Open);

        // Wait for timeout
        tokio::time::sleep(Duration::from_millis(150)).await;

        // Next call should transition to HalfOpen
        let result = cb.call(|| async { Ok::<_, ConsensusError>(()) }).await;
        assert!(result.is_ok());
        assert_eq!(cb.get_state(), CircuitState::HalfOpen);
    }

    #[tokio::test]
    async fn test_circuit_breaker_half_open_to_closed() {
        let config = CircuitConfig {
            failure_threshold: 2,
            timeout: Duration::from_millis(100),
            success_threshold: 2,
            ..Default::default()
        };
        let cb = CircuitBreaker::new("test-peer".to_string(), config);

        // Trip and wait
        cb.record_failure();
        cb.record_failure();
        tokio::time::sleep(Duration::from_millis(150)).await;

        // Transition to HalfOpen
        let _ = cb.call(|| async { Ok::<_, ConsensusError>(()) }).await;
        assert_eq!(cb.get_state(), CircuitState::HalfOpen);

        // Record successes to close
        cb.record_success();
        assert_eq!(cb.get_state(), CircuitState::HalfOpen);
        cb.record_success();
        assert_eq!(cb.get_state(), CircuitState::Closed);
    }

    #[tokio::test]
    async fn test_circuit_breaker_half_open_to_open() {
        let config = CircuitConfig {
            failure_threshold: 2,
            timeout: Duration::from_millis(100),
            ..Default::default()
        };
        let cb = CircuitBreaker::new("test-peer".to_string(), config);

        // Trip and transition to HalfOpen
        cb.record_failure();
        cb.record_failure();
        tokio::time::sleep(Duration::from_millis(150)).await;
        let _ = cb.call(|| async { Ok::<_, ConsensusError>(()) }).await;

        assert_eq!(cb.get_state(), CircuitState::HalfOpen);

        // Failure in HalfOpen goes back to Open
        cb.record_failure();
        assert_eq!(cb.get_state(), CircuitState::Open);
    }

    #[tokio::test]
    async fn test_circuit_breaker_rejects_when_open() {
        let config = CircuitConfig {
            failure_threshold: 2,
            timeout: Duration::from_secs(10),
            ..Default::default()
        };
        let cb = CircuitBreaker::new("test-peer".to_string(), config);

        // Trip the circuit
        cb.record_failure();
        cb.record_failure();
        assert_eq!(cb.get_state(), CircuitState::Open);

        // Calls should be rejected
        let result = cb.call(|| async { Ok::<_, ConsensusError>(()) }).await;
        assert!(matches!(result, Err(ConsensusError::CircuitOpen(_))));
    }

    #[tokio::test]
    async fn test_circuit_breaker_success_resets_failures() {
        let config = CircuitConfig {
            failure_threshold: 3,
            ..Default::default()
        };
        let cb = CircuitBreaker::new("test-peer".to_string(), config);

        cb.record_failure();
        cb.record_failure();
        assert_eq!(cb.get_state(), CircuitState::Closed);

        // Success should reset count
        cb.record_success();

        // Should need 3 more failures to open
        cb.record_failure();
        cb.record_failure();
        assert_eq!(cb.get_state(), CircuitState::Closed);
        cb.record_failure();
        assert_eq!(cb.get_state(), CircuitState::Open);
    }

    #[tokio::test]
    async fn test_force_open_close() {
        let cb = CircuitBreaker::new("test-peer".to_string(), CircuitConfig::default());

        assert_eq!(cb.get_state(), CircuitState::Closed);

        cb.force_open();
        assert_eq!(cb.get_state(), CircuitState::Open);

        cb.force_close();
        assert_eq!(cb.get_state(), CircuitState::Closed);
    }

    #[tokio::test]
    async fn test_circuit_breaker_stats() {
        let cb = CircuitBreaker::new("test-peer".to_string(), CircuitConfig::default());

        cb.record_success();
        cb.record_success();
        cb.record_failure();

        let stats = cb.get_stats();
        assert_eq!(stats.total_successes, 2);
        assert_eq!(stats.total_failures, 1);
        assert_eq!(stats.success_rate(), 2.0 / 3.0);
    }
}
