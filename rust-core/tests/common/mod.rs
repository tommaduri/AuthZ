//! Common test utilities and mock infrastructure
//! Shared across unit, integration, and benchmark tests

pub mod mocks;
pub mod fixtures;
pub mod helpers;

/// Test configuration constants
pub mod config {
    use std::time::Duration;

    pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(5);
    pub const TEST_NETWORK_SIZE: usize = 5;
    pub const TEST_PORT_BASE: u16 = 8000;
    pub const MAX_TEST_VERTICES: usize = 10000;
    pub const BENCHMARK_ITERATIONS: usize = 100;
}

/// Common test result type
pub type TestResult<T = ()> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

/// Test error types
#[derive(Debug)]
pub enum TestError {
    NetworkError(String),
    ConsensusError(String),
    TimeoutError,
    ValidationError(String),
}

impl std::fmt::Display for TestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TestError::NetworkError(msg) => write!(f, "Network error: {}", msg),
            TestError::ConsensusError(msg) => write!(f, "Consensus error: {}", msg),
            TestError::TimeoutError => write!(f, "Operation timed out"),
            TestError::ValidationError(msg) => write!(f, "Validation error: {}", msg),
        }
    }
}

impl std::error::Error for TestError {}

/// Macro for creating test vertices quickly
#[macro_export]
macro_rules! test_vertex {
    ($data:expr) => {
        dag::Vertex::new($data, vec![], [0u8; 32])
    };
    ($data:expr, $parents:expr) => {
        dag::Vertex::new($data, $parents, [0u8; 32])
    };
    ($data:expr, $parents:expr, $creator:expr) => {
        dag::Vertex::new($data, $parents, $creator)
    };
}

/// Macro for asserting consensus within timeout
#[macro_export]
macro_rules! assert_consensus {
    ($network:expr, $vertex:expr, $timeout:expr) => {{
        let start = std::time::Instant::now();
        loop {
            if $network.check_consensus(&$vertex).await.is_ok() {
                break Ok(());
            }
            if start.elapsed() > $timeout {
                break Err(TestError::TimeoutError);
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
        }
    }};
}

/// Macro for timing operations
#[macro_export]
macro_rules! time_operation {
    ($operation:expr) => {{
        let start = std::time::Instant::now();
        let result = $operation;
        let duration = start.elapsed();
        (result, duration)
    }};
}

/// Test data generators
pub mod generators {
    use rand::Rng;

    pub fn random_bytes(len: usize) -> Vec<u8> {
        let mut rng = rand::thread_rng();
        (0..len).map(|_| rng.gen()).collect()
    }

    pub fn random_hash() -> [u8; 32] {
        let mut hash = [0u8; 32];
        rand::thread_rng().fill(&mut hash);
        hash
    }

    pub fn random_keypair() -> ([u8; 32], [u8; 64]) {
        // Placeholder - should use actual crypto
        (random_hash(), [0u8; 64])
    }

    pub fn sequential_hashes(count: usize) -> Vec<[u8; 32]> {
        (0..count).map(|i| {
            let mut hash = [0u8; 32];
            hash[0] = i as u8;
            hash
        }).collect()
    }
}

/// Test assertions
pub mod assertions {
    use super::*;

    pub fn assert_vertex_valid(vertex: &dag::Vertex) -> TestResult {
        if vertex.data().is_empty() {
            return Err(Box::new(TestError::ValidationError(
                "Vertex has empty data".to_string()
            )));
        }
        Ok(())
    }

    pub fn assert_dag_acyclic(dag: &dag::DAG) -> TestResult {
        if !dag.is_acyclic() {
            return Err(Box::new(TestError::ValidationError(
                "DAG contains cycles".to_string()
            )));
        }
        Ok(())
    }

    pub fn assert_consensus_reached(
        network: &ConsensusNetwork,
        threshold: f64,
    ) -> TestResult {
        let agreement = network.agreement_percentage();
        if agreement < threshold {
            return Err(Box::new(TestError::ConsensusError(
                format!("Consensus not reached: {:.2}% < {:.2}%", agreement * 100.0, threshold * 100.0)
            )));
        }
        Ok(())
    }
}

/// Performance monitoring
pub mod perf {
    use std::time::{Duration, Instant};

    pub struct PerfMonitor {
        start: Instant,
        checkpoints: Vec<(String, Duration)>,
    }

    impl PerfMonitor {
        pub fn new() -> Self {
            Self {
                start: Instant::now(),
                checkpoints: Vec::new(),
            }
        }

        pub fn checkpoint(&mut self, label: impl Into<String>) {
            let elapsed = self.start.elapsed();
            self.checkpoints.push((label.into(), elapsed));
        }

        pub fn report(&self) -> String {
            let mut report = String::from("Performance Report:\n");
            let mut last_duration = Duration::from_secs(0);

            for (label, duration) in &self.checkpoints {
                let delta = *duration - last_duration;
                report.push_str(&format!(
                    "  {} +{:?} (total: {:?})\n",
                    label, delta, duration
                ));
                last_duration = *duration;
            }

            report
        }

        pub fn total_duration(&self) -> Duration {
            self.start.elapsed()
        }
    }

    impl Default for PerfMonitor {
        fn default() -> Self {
            Self::new()
        }
    }
}

/// Memory tracking
pub mod memory {
    pub fn current_memory_usage() -> usize {
        // Platform-specific implementation needed
        0
    }

    pub fn memory_delta<F>(f: F) -> (usize, usize)
    where
        F: FnOnce(),
    {
        let before = current_memory_usage();
        f();
        let after = current_memory_usage();
        (before, after.saturating_sub(before))
    }
}

/// Logging utilities for tests
pub mod logging {
    pub fn init_test_logger() {
        let _ = env_logger::builder()
            .is_test(true)
            .filter_level(log::LevelFilter::Debug)
            .try_init();
    }

    pub fn test_log(level: &str, message: &str) {
        println!("[{}] {}", level, message);
    }
}

/// Async test utilities
#[cfg(feature = "async-tests")]
pub mod async_utils {
    use super::*;
    use tokio::time::timeout;

    pub async fn with_timeout<F, T>(
        duration: Duration,
        future: F,
    ) -> TestResult<T>
    where
        F: std::future::Future<Output = T>,
    {
        timeout(duration, future)
            .await
            .map_err(|_| Box::new(TestError::TimeoutError) as Box<dyn std::error::Error + Send + Sync>)
    }

    pub async fn retry<F, T, E>(
        max_attempts: usize,
        delay: Duration,
        mut f: F,
    ) -> Result<T, E>
    where
        F: FnMut() -> std::future::Future<Output = Result<T, E>>,
    {
        let mut last_error = None;

        for _ in 0..max_attempts {
            match f().await {
                Ok(result) => return Ok(result),
                Err(e) => {
                    last_error = Some(e);
                    tokio::time::sleep(delay).await;
                }
            }
        }

        Err(last_error.unwrap())
    }
}
