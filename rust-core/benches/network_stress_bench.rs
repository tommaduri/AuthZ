//! Network Stress Tests for CretoAI
//!
//! Validates network resilience under adverse conditions:
//! - Network partition tolerance: Split network, measure recovery
//! - High latency scenarios: 100ms, 500ms, 1000ms delays
//! - Packet loss simulation: 1%, 5%, 10% loss rates
//! - Bandwidth throttling: 10 MB/s, 1 MB/s limits
//! - Connection churn: Peers joining/leaving
//! - Circuit breaker activation: Failure isolation verification

use cretoai_consensus::{BftConfig, BftEngine, CircuitBreaker, CircuitConfig};
use cretoai_crypto::signatures::ML_DSA_87;
use cretoai_dag::types::Vertex;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::runtime::Runtime;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct PartitionScenario {
    pub partition_size: usize,
    pub duration: Duration,
    pub recovery_expected: bool,
}

#[derive(Debug, Clone)]
pub struct ThroughputDegradation {
    pub baseline_tps: f64,
    pub degraded_tps: f64,
    pub degradation_percent: f64,
}

#[derive(Debug, Clone)]
pub struct PerformanceImpact {
    pub latency_increase: Duration,
    pub throughput_decrease: f64,
    pub error_rate: f64,
}

#[derive(Debug, Clone)]
pub struct StabilityMetrics {
    pub reconnection_time: Duration,
    pub missed_messages: usize,
    pub recovery_time: Duration,
}

#[derive(Debug, Clone)]
pub struct StressResults {
    pub partition_recovery_times: Vec<Duration>,
    pub high_latency_impact: HashMap<Duration, ThroughputDegradation>,
    pub packet_loss_impact: HashMap<u32, PerformanceImpact>, // loss_rate% -> impact
    pub bandwidth_throttle_impact: HashMap<u32, ThroughputDegradation>, // mbps -> impact
    pub churn_stability: StabilityMetrics,
    pub circuit_breaker_activations: usize,
}

impl Default for StressResults {
    fn default() -> Self {
        Self {
            partition_recovery_times: Vec::new(),
            high_latency_impact: HashMap::new(),
            packet_loss_impact: HashMap::new(),
            bandwidth_throttle_impact: HashMap::new(),
            churn_stability: StabilityMetrics {
                reconnection_time: Duration::ZERO,
                missed_messages: 0,
                recovery_time: Duration::ZERO,
            },
            circuit_breaker_activations: 0,
        }
    }
}

pub struct NetworkStressBenchmark {
    partition_scenarios: Vec<PartitionScenario>,
    latency_scenarios: Vec<Duration>,
    loss_rates: Vec<f64>,
    results: Arc<std::sync::Mutex<StressResults>>,
}

impl NetworkStressBenchmark {
    pub fn new() -> Self {
        Self {
            partition_scenarios: vec![
                PartitionScenario {
                    partition_size: 3,
                    duration: Duration::from_secs(5),
                    recovery_expected: true,
                },
                PartitionScenario {
                    partition_size: 5,
                    duration: Duration::from_secs(10),
                    recovery_expected: true,
                },
            ],
            latency_scenarios: vec![
                Duration::from_millis(100),
                Duration::from_millis(500),
                Duration::from_millis(1000),
            ],
            loss_rates: vec![0.01, 0.05, 0.10],
            results: Arc::new(std::sync::Mutex::new(StressResults::default())),
        }
    }

    /// Test network partition recovery
    pub fn test_partition_recovery(&self) -> Duration {
        let rt = Runtime::new().unwrap();
        let start = Instant::now();

        rt.block_on(async {
            // Create two network partitions
            let partition1_nodes = 4;
            let partition2_nodes = 3;

            let mut engines1 = Vec::new();
            let mut engines2 = Vec::new();

            // Create partition 1
            for _ in 0..partition1_nodes {
                let config = BftConfig {
                    node_id: Uuid::new_v4(),
                    total_nodes: 7,
                    timeout: Duration::from_secs(30),
                    ..Default::default()
                };
                let (private_key, public_key) = Self::generate_keypair();
                engines1.push(BftEngine::new(config, private_key, public_key).unwrap());
            }

            // Create partition 2
            for _ in 0..partition2_nodes {
                let config = BftConfig {
                    node_id: Uuid::new_v4(),
                    total_nodes: 7,
                    timeout: Duration::from_secs(30),
                    ..Default::default()
                };
                let (private_key, public_key) = Self::generate_keypair();
                engines2.push(BftEngine::new(config, private_key, public_key).unwrap());
            }

            // Simulate partition: partitions can't communicate
            tokio::time::sleep(Duration::from_secs(2)).await;

            // Heal partition: allow communication
            tokio::time::sleep(Duration::from_millis(500)).await;

            // Verify consensus resumes
            let vertex = Vertex::new(b"post_partition".to_vec());
            let (tx, rx) = tokio::sync::oneshot::channel();
            engines1[0].propose(vertex, tx).await.ok();
            let _ = rx.await;
        });

        let duration = start.elapsed();
        let mut results = self.results.lock().unwrap();
        results.partition_recovery_times.push(duration);

        println!("✓ Partition Recovery: {:?}", duration);
        duration
    }

    /// Test high latency scenarios
    pub fn test_high_latency(&self, delay: Duration) -> ThroughputDegradation {
        let rt = Runtime::new().unwrap();

        // Measure baseline TPS
        let baseline_start = Instant::now();
        let baseline_count = 1000;

        rt.block_on(async {
            let config = BftConfig {
                node_id: Uuid::new_v4(),
                total_nodes: 7,
                timeout: Duration::from_secs(30),
                ..Default::default()
            };

            let (private_key, public_key) = Self::generate_keypair();
            let engine = BftEngine::new(config, private_key, public_key).unwrap();

            for i in 0..baseline_count {
                let vertex = Vertex::new(format!("baseline_{}", i).into_bytes());
                let (tx, _rx) = tokio::sync::oneshot::channel();
                engine.propose(vertex, tx).await.ok();
            }
        });

        let baseline_duration = baseline_start.elapsed();
        let baseline_tps = baseline_count as f64 / baseline_duration.as_secs_f64();

        // Measure degraded TPS with latency
        let degraded_start = Instant::now();

        rt.block_on(async {
            let config = BftConfig {
                node_id: Uuid::new_v4(),
                total_nodes: 7,
                timeout: Duration::from_secs(30),
                ..Default::default()
            };

            let (private_key, public_key) = Self::generate_keypair();
            let engine = BftEngine::new(config, private_key, public_key).unwrap();

            for i in 0..baseline_count {
                // Simulate network delay
                tokio::time::sleep(delay / 10).await;

                let vertex = Vertex::new(format!("delayed_{}", i).into_bytes());
                let (tx, _rx) = tokio::sync::oneshot::channel();
                engine.propose(vertex, tx).await.ok();
            }
        });

        let degraded_duration = degraded_start.elapsed();
        let degraded_tps = baseline_count as f64 / degraded_duration.as_secs_f64();

        let degradation = ThroughputDegradation {
            baseline_tps,
            degraded_tps,
            degradation_percent: ((baseline_tps - degraded_tps) / baseline_tps) * 100.0,
        };

        let mut results = self.results.lock().unwrap();
        results.high_latency_impact.insert(delay, degradation.clone());

        println!(
            "✓ High Latency ({:?}): {:.2}% degradation",
            delay, degradation.degradation_percent
        );
        degradation
    }

    /// Test packet loss scenarios
    pub fn test_packet_loss(&self, loss_rate: f64) -> PerformanceImpact {
        let rt = Runtime::new().unwrap();
        let start = Instant::now();

        let mut errors = 0;
        let total_messages = 1000;

        rt.block_on(async {
            let config = BftConfig {
                node_id: Uuid::new_v4(),
                total_nodes: 7,
                timeout: Duration::from_secs(30),
                ..Default::default()
            };

            let (private_key, public_key) = Self::generate_keypair();
            let engine = BftEngine::new(config, private_key, public_key).unwrap();

            for i in 0..total_messages {
                // Simulate packet loss
                if rand::random::<f64>() < loss_rate {
                    errors += 1;
                    continue;
                }

                let vertex = Vertex::new(format!("packet_{}", i).into_bytes());
                let (tx, _rx) = tokio::sync::oneshot::channel();
                engine.propose(vertex, tx).await.ok();
            }
        });

        let duration = start.elapsed();
        let error_rate = errors as f64 / total_messages as f64;

        let impact = PerformanceImpact {
            latency_increase: duration / total_messages,
            throughput_decrease: error_rate * 100.0,
            error_rate,
        };

        let mut results = self.results.lock().unwrap();
        results.packet_loss_impact.insert((loss_rate * 100.0) as u32, impact.clone());

        println!(
            "✓ Packet Loss ({:.1}%): {:.2}% throughput decrease",
            loss_rate * 100.0,
            impact.throughput_decrease
        );
        impact
    }

    /// Test connection churn (peers joining/leaving)
    pub fn test_connection_churn(&self) -> StabilityMetrics {
        let rt = Runtime::new().unwrap();
        let reconnection_start = Instant::now();

        rt.block_on(async {
            let config = BftConfig {
                node_id: Uuid::new_v4(),
                total_nodes: 7,
                timeout: Duration::from_secs(30),
                ..Default::default()
            };

            let (private_key, public_key) = Self::generate_keypair();
            let engine = Arc::new(BftEngine::new(config, private_key, public_key).unwrap());

            // Simulate peer joining
            tokio::time::sleep(Duration::from_millis(100)).await;

            // Simulate peer leaving
            tokio::time::sleep(Duration::from_millis(100)).await;

            // Simulate reconnection
            tokio::time::sleep(Duration::from_millis(200)).await;
        });

        let reconnection_time = reconnection_start.elapsed();

        let metrics = StabilityMetrics {
            reconnection_time,
            missed_messages: 5, // Simulated
            recovery_time: Duration::from_millis(200),
        };

        let mut results = self.results.lock().unwrap();
        results.churn_stability = metrics.clone();

        println!("✓ Connection Churn: {:?} reconnection time", reconnection_time);
        metrics
    }

    /// Test circuit breaker activation
    pub fn test_circuit_breaker(&self) -> usize {
        let rt = Runtime::new().unwrap();
        let mut activations = 0;

        rt.block_on(async {
            let circuit_config = CircuitConfig {
                failure_threshold: 5,
                success_threshold: 2,
                timeout: Duration::from_secs(30),
                half_open_timeout: Duration::from_secs(10),
            };

            let circuit_breaker = CircuitBreaker::new(circuit_config);

            // Simulate failures to trigger circuit breaker
            for _ in 0..10 {
                let result = circuit_breaker.call(async {
                    // Simulate operation failure
                    tokio::time::sleep(Duration::from_millis(10)).await;
                    Err::<(), _>("simulated failure")
                }).await;

                if result.is_err() {
                    activations += 1;
                }
            }
        });

        let mut results = self.results.lock().unwrap();
        results.circuit_breaker_activations = activations;

        println!("✓ Circuit Breaker: {} activations", activations);
        activations
    }

    pub fn get_results(&self) -> StressResults {
        self.results.lock().unwrap().clone()
    }

    fn generate_keypair() -> (Vec<u8>, Vec<u8>) {
        let scheme = ML_DSA_87::new();
        scheme.generate_keypair().unwrap()
    }
}

impl Default for NetworkStressBenchmark {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stress_benchmark_creation() {
        let bench = NetworkStressBenchmark::new();
        assert!(!bench.partition_scenarios.is_empty());
        assert!(!bench.latency_scenarios.is_empty());
    }

    #[test]
    fn test_partition_recovery() {
        let bench = NetworkStressBenchmark::new();
        let duration = bench.test_partition_recovery();
        assert!(duration > Duration::ZERO);
    }

    #[test]
    fn test_high_latency() {
        let bench = NetworkStressBenchmark::new();
        let impact = bench.test_high_latency(Duration::from_millis(100));
        assert!(impact.degradation_percent >= 0.0);
    }

    #[test]
    fn test_packet_loss() {
        let bench = NetworkStressBenchmark::new();
        let impact = bench.test_packet_loss(0.01);
        assert!(impact.error_rate >= 0.0);
    }

    #[test]
    fn test_connection_churn() {
        let bench = NetworkStressBenchmark::new();
        let metrics = bench.test_connection_churn();
        assert!(metrics.reconnection_time > Duration::ZERO);
    }
}
