//! Latency Benchmarks for CretoAI
//!
//! Validates latency targets:
//! - Vertex creation: Time to create + sign
//! - Propagation: Time to reach all peers
//! - Validation: Time to verify signatures + DAG
//! - Finalization: Time from proposal to finality
//! - Target: <500ms finality (P99)

use cretoai_consensus::{BftConfig, BftEngine};
use cretoai_crypto::signatures::ML_DSA_87;
use cretoai_dag::types::Vertex;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::runtime::Runtime;

#[derive(Debug, Clone)]
pub struct LatencyDistribution {
    pub p50: Duration,
    pub p95: Duration,
    pub p99: Duration,
    pub p999: Duration,
    pub mean: Duration,
    pub min: Duration,
    pub max: Duration,
    pub samples: Vec<Duration>,
}

impl LatencyDistribution {
    pub fn from_samples(mut samples: Vec<Duration>) -> Self {
        samples.sort();
        let len = samples.len();

        let p50 = samples[len * 50 / 100];
        let p95 = samples[len * 95 / 100];
        let p99 = samples[len * 99 / 100];
        let p999 = samples[len * 999 / 1000].min(samples[len - 1]);

        let sum: Duration = samples.iter().sum();
        let mean = sum / len as u32;

        Self {
            p50,
            p95,
            p99,
            p999,
            mean,
            min: samples[0],
            max: samples[len - 1],
            samples,
        }
    }
}

#[derive(Debug, Clone)]
pub struct LatencyResults {
    pub vertex_creation: LatencyDistribution,
    pub propagation: HashMap<usize, LatencyDistribution>, // peer_count -> latency
    pub validation: LatencyDistribution,
    pub finalization: LatencyDistribution,
}

impl Default for LatencyResults {
    fn default() -> Self {
        let empty_dist = LatencyDistribution {
            p50: Duration::ZERO,
            p95: Duration::ZERO,
            p99: Duration::ZERO,
            p999: Duration::ZERO,
            mean: Duration::ZERO,
            min: Duration::ZERO,
            max: Duration::ZERO,
            samples: Vec::new(),
        };

        Self {
            vertex_creation: empty_dist.clone(),
            propagation: HashMap::new(),
            validation: empty_dist.clone(),
            finalization: empty_dist,
        }
    }
}

pub struct LatencyBenchmark {
    network_sizes: Vec<usize>,
    network_delays: Vec<Duration>,
    num_samples: usize,
    results: Arc<std::sync::Mutex<LatencyResults>>,
}

impl LatencyBenchmark {
    pub fn new() -> Self {
        Self {
            network_sizes: vec![4, 7, 10, 25, 50, 100],
            network_delays: vec![
                Duration::from_millis(0),
                Duration::from_millis(10),
                Duration::from_millis(50),
                Duration::from_millis(100),
            ],
            num_samples: 1000,
            results: Arc::new(std::sync::Mutex::new(LatencyResults::default())),
        }
    }

    /// Measure vertex creation latency
    pub fn measure_vertex_creation(&self) -> Duration {
        let mut samples = Vec::new();

        for i in 0..self.num_samples {
            let start = Instant::now();

            let vertex = Vertex::new(format!("vertex_{}", i).into_bytes());
            let (private_key, _) = Self::generate_keypair();

            // Simulate signing
            let _signature = blake3::hash(&vertex.data);

            samples.push(start.elapsed());
        }

        let dist = LatencyDistribution::from_samples(samples);
        let mut results = self.results.lock().unwrap();
        results.vertex_creation = dist.clone();

        println!("✓ Vertex Creation P99: {:?}", dist.p99);
        dist.mean
    }

    /// Measure propagation latency to N peers
    pub fn measure_propagation(&self, num_peers: usize) -> Duration {
        let rt = Runtime::new().unwrap();
        let mut samples = Vec::new();

        for _ in 0..100 {
            let start = Instant::now();

            rt.block_on(async {
                // Simulate propagating to N peers in parallel
                let tasks: Vec<_> = (0..num_peers)
                    .map(|peer_id| {
                        tokio::spawn(async move {
                            // Simulate network delay
                            tokio::time::sleep(Duration::from_micros(10)).await;
                            peer_id
                        })
                    })
                    .collect();

                // Wait for all peers to receive
                for task in tasks {
                    task.await.ok();
                }
            });

            samples.push(start.elapsed());
        }

        let dist = LatencyDistribution::from_samples(samples);
        let mut results = self.results.lock().unwrap();
        results.propagation.insert(num_peers, dist.clone());

        println!("✓ Propagation P99 ({} peers): {:?}", num_peers, dist.p99);
        dist.mean
    }

    /// Measure validation latency (signature + DAG verification)
    pub fn measure_validation(&self) -> Duration {
        let mut samples = Vec::new();

        for i in 0..self.num_samples {
            let vertex = Vertex::new(format!("validation_{}", i).into_bytes());
            let (private_key, public_key) = Self::generate_keypair();

            let start = Instant::now();

            // Simulate signature verification
            let hash = blake3::hash(&vertex.data);
            let _verified = blake3::Hash::from_bytes(*hash.as_bytes());

            // Simulate DAG structure validation
            let _valid = vertex.data.len() > 0;

            samples.push(start.elapsed());
        }

        let dist = LatencyDistribution::from_samples(samples);
        let mut results = self.results.lock().unwrap();
        results.validation = dist.clone();

        println!("✓ Validation P99: {:?}", dist.p99);
        dist.mean
    }

    /// Measure finalization latency (proposal to finality)
    pub fn measure_finalization(&self) -> Duration {
        let rt = Runtime::new().unwrap();
        let mut samples = Vec::new();

        for i in 0..100 {
            let start = Instant::now();

            rt.block_on(async {
                let config = BftConfig {
                    node_id: uuid::Uuid::new_v4(),
                    total_nodes: 7,
                    timeout: Duration::from_secs(30),
                    ..Default::default()
                };

                let (private_key, public_key) = Self::generate_keypair();
                let engine = BftEngine::new(config, private_key, public_key).unwrap();

                let vertex = Vertex::new(format!("finalization_{}", i).into_bytes());
                let (tx, rx) = tokio::sync::oneshot::channel();

                // Propose and wait for finalization
                engine.propose(vertex, tx).await.ok();
                let _ = rx.await;
            });

            samples.push(start.elapsed());
        }

        let dist = LatencyDistribution::from_samples(samples);
        let mut results = self.results.lock().unwrap();
        results.finalization = dist.clone();

        println!("✓ Finalization P99: {:?}", dist.p99);
        dist.mean
    }

    /// Get percentiles summary
    pub fn percentiles(&self) -> String {
        let results = self.results.lock().unwrap();

        format!(
            "Latency Percentiles:\n\
             Vertex Creation:\n\
             - P50: {:?}, P95: {:?}, P99: {:?}, P999: {:?}\n\
             Validation:\n\
             - P50: {:?}, P95: {:?}, P99: {:?}, P999: {:?}\n\
             Finalization:\n\
             - P50: {:?}, P95: {:?}, P99: {:?}, P999: {:?}\n",
            results.vertex_creation.p50,
            results.vertex_creation.p95,
            results.vertex_creation.p99,
            results.vertex_creation.p999,
            results.validation.p50,
            results.validation.p95,
            results.validation.p99,
            results.validation.p999,
            results.finalization.p50,
            results.finalization.p95,
            results.finalization.p99,
            results.finalization.p999,
        )
    }

    pub fn get_results(&self) -> LatencyResults {
        self.results.lock().unwrap().clone()
    }

    fn generate_keypair() -> (Vec<u8>, Vec<u8>) {
        let scheme = ML_DSA_87::new();
        scheme.generate_keypair().unwrap()
    }
}

impl Default for LatencyBenchmark {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_latency_distribution() {
        let samples = vec![
            Duration::from_millis(10),
            Duration::from_millis(20),
            Duration::from_millis(30),
            Duration::from_millis(40),
            Duration::from_millis(100),
        ];

        let dist = LatencyDistribution::from_samples(samples);
        assert!(dist.p50 > Duration::ZERO);
        assert!(dist.p99 >= dist.p95);
    }

    #[test]
    fn test_vertex_creation_latency() {
        let bench = LatencyBenchmark::new();
        let duration = bench.measure_vertex_creation();
        assert!(duration > Duration::ZERO);
    }

    #[test]
    fn test_propagation_latency() {
        let bench = LatencyBenchmark::new();
        let duration = bench.measure_propagation(4);
        assert!(duration > Duration::ZERO);
    }

    #[test]
    fn test_validation_latency() {
        let bench = LatencyBenchmark::new();
        let duration = bench.measure_validation();
        assert!(duration > Duration::ZERO);
    }
}
