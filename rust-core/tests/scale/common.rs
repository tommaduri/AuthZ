// Common utilities and fixtures for scale testing
// This file provides shared test infrastructure

use std::time::Duration;

/// Network profile for simulating different network conditions
#[derive(Debug, Clone, PartialEq)]
pub enum NetworkProfile {
    Local,      // < 1ms latency
    LAN,        // 1-10ms latency, 0.01% packet loss
    WAN,        // 50-200ms latency, 0.1% packet loss
    Degraded,   // 200-500ms latency, 1% packet loss
}

/// Workload pattern for load testing
#[derive(Debug, Clone)]
pub enum WorkloadPattern {
    ConstantRate { tps: usize },
    Ramp { start_tps: usize, end_tps: usize, duration: Duration },
    Burst { burst_tps: usize, burst_duration: Duration },
    Chaos { random_tps_range: (usize, usize) },
}

/// Byzantine attack patterns
#[derive(Debug, Clone, PartialEq)]
pub enum ByzantineAttackPattern {
    RandomVoting,           // 50/50 yes/no
    AlwaysReject,          // Always vote no
    AlwaysAccept,          // Always vote yes
    CoordinatedCollusion,  // Clusters of Byzantine nodes
    SybilAttack,           // Multiple identities
}

/// Test cluster configuration
#[derive(Debug, Clone)]
pub struct TestClusterConfig {
    pub node_count: usize,
    pub byzantine_percentage: f64,
    pub byzantine_pattern: Option<ByzantineAttackPattern>,
    pub network_profile: NetworkProfile,
    pub test_duration: Duration,
    pub workload: WorkloadPattern,
}

impl TestClusterConfig {
    pub fn new(node_count: usize) -> Self {
        Self {
            node_count,
            byzantine_percentage: 0.0,
            byzantine_pattern: None,
            network_profile: NetworkProfile::Local,
            test_duration: Duration::from_secs(60),
            workload: WorkloadPattern::ConstantRate { tps: 100 },
        }
    }

    pub fn with_byzantine(mut self, percentage: f64, pattern: ByzantineAttackPattern) -> Self {
        self.byzantine_percentage = percentage;
        self.byzantine_pattern = Some(pattern);
        self
    }

    pub fn with_network(mut self, profile: NetworkProfile) -> Self {
        self.network_profile = profile;
        self
    }

    pub fn with_workload(mut self, workload: WorkloadPattern) -> Self {
        self.workload = workload;
        self
    }

    pub fn with_duration(mut self, duration: Duration) -> Self {
        self.test_duration = duration;
        self
    }
}

/// Performance metrics snapshot
#[derive(Debug, Clone)]
pub struct PerformanceMetrics {
    pub avg_tps: f64,
    pub peak_tps: f64,
    pub total_vertices: usize,
    pub latency_p50: Duration,
    pub latency_p95: Duration,
    pub latency_p99: Duration,
    pub avg_cpu_percent: f64,
    pub peak_cpu_percent: f64,
    pub avg_memory_mb: f64,
    pub peak_memory_mb: f64,
    pub avg_network_mbps: f64,
    pub avg_rounds_to_finalize: f64,
    pub confidence_at_finalization: f64,
    pub byzantine_detected: usize,
    pub false_positives: usize,
}

/// Test result status
#[derive(Debug, Clone, PartialEq)]
pub enum TestStatus {
    Passed,
    Failed(String),
    Skipped(String),
}

/// Complete test results
#[derive(Debug, Clone)]
pub struct TestResults {
    pub test_name: String,
    pub config: TestClusterConfig,
    pub metrics: PerformanceMetrics,
    pub status: TestStatus,
    pub anomalies: Vec<String>,
    pub duration: Duration,
}

impl TestResults {
    pub fn assert_passed(&self) {
        match &self.status {
            TestStatus::Passed => {},
            TestStatus::Failed(reason) => panic!("Test failed: {}", reason),
            TestStatus::Skipped(reason) => panic!("Test was skipped: {}", reason),
        }
    }
}
