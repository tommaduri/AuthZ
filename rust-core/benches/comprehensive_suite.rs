//! Comprehensive Benchmark Suite for CretoAI Phase 7 Validation
//!
//! This master benchmark suite orchestrates all performance validation tests:
//! - Throughput: 10,000+ TPS (target: 3.6M TPS)
//! - Latency: <500ms finality (P99)
//! - Byzantine tolerance: f nodes out of 3f+1
//! - Network stress: partition, latency, packet loss
//!
//! Run with: cargo bench --bench comprehensive_suite

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use std::time::Duration;

mod throughput_bench;
mod latency_bench;
mod byzantine_bench;
mod network_stress_bench;
mod validation_report;

use throughput_bench::ThroughputBenchmark;
use latency_bench::LatencyBenchmark;
use byzantine_bench::ByzantineBenchmark;
use network_stress_bench::NetworkStressBenchmark;
use validation_report::{ValidationReport, BenchmarkConfig};

/// Master configuration for all benchmarks
pub struct ComprehensiveBenchmarkConfig {
    pub duration: Duration,
    pub warmup_duration: Duration,
    pub num_iterations: usize,
    pub confidence_level: f64,
    pub max_variance: f64,
    pub enable_throughput: bool,
    pub enable_latency: bool,
    pub enable_byzantine: bool,
    pub enable_stress: bool,
}

impl Default for ComprehensiveBenchmarkConfig {
    fn default() -> Self {
        Self {
            duration: Duration::from_secs(60),
            warmup_duration: Duration::from_secs(10),
            num_iterations: 10,
            confidence_level: 0.95,
            max_variance: 0.1, // 10%
            enable_throughput: true,
            enable_latency: true,
            enable_byzantine: true,
            enable_stress: true,
        }
    }
}

/// Master benchmark orchestrator
pub struct ComprehensiveBenchmarkSuite {
    config: ComprehensiveBenchmarkConfig,
    throughput: ThroughputBenchmark,
    latency: LatencyBenchmark,
    byzantine: ByzantineBenchmark,
    stress: NetworkStressBenchmark,
}

impl ComprehensiveBenchmarkSuite {
    pub fn new(config: ComprehensiveBenchmarkConfig) -> Self {
        Self {
            throughput: ThroughputBenchmark::new(),
            latency: LatencyBenchmark::new(),
            byzantine: ByzantineBenchmark::new(),
            stress: NetworkStressBenchmark::new(),
            config,
        }
    }

    /// Run all benchmark categories
    pub fn run_all(&self, c: &mut Criterion) {
        println!("\n╔══════════════════════════════════════════════════════════════╗");
        println!("║  CretoAI Phase 7 Comprehensive Benchmark Suite              ║");
        println!("║  Validating: 10K+ TPS, <500ms finality, Byzantine tolerance ║");
        println!("╚══════════════════════════════════════════════════════════════╝\n");

        if self.config.enable_throughput {
            self.run_throughput_benchmarks(c);
        }

        if self.config.enable_latency {
            self.run_latency_benchmarks(c);
        }

        if self.config.enable_byzantine {
            self.run_byzantine_benchmarks(c);
        }

        if self.config.enable_stress {
            self.run_stress_benchmarks(c);
        }

        self.generate_report();
    }

    /// Throughput benchmarks: 10K+ TPS validation
    fn run_throughput_benchmarks(&self, c: &mut Criterion) {
        println!("\n📊 Running Throughput Benchmarks...\n");

        let mut group = c.benchmark_group("throughput");
        group.measurement_time(self.config.duration);
        group.warm_up_time(self.config.warmup_duration);

        // Single-threaded baseline
        group.bench_function("baseline_single_thread", |b| {
            b.iter(|| self.throughput.run_baseline())
        });

        // Multi-threaded parallel validation
        for threads in &[2, 4, 8, 16] {
            group.bench_with_input(
                BenchmarkId::new("parallel", threads),
                threads,
                |b, &threads| {
                    b.iter(|| self.throughput.run_parallel(threads))
                },
            );
        }

        // SIMD-accelerated
        group.bench_function("simd_accelerated", |b| {
            b.iter(|| self.throughput.run_simd())
        });

        // Full stack end-to-end TPS
        for num_vertices in &[100, 1000, 10000] {
            group.throughput(Throughput::Elements(*num_vertices as u64));
            group.bench_with_input(
                BenchmarkId::new("full_stack", num_vertices),
                num_vertices,
                |b, &vertices| {
                    b.iter(|| self.throughput.run_full_stack(vertices))
                },
            );
        }

        group.finish();
    }

    /// Latency benchmarks: <500ms finality validation
    fn run_latency_benchmarks(&self, c: &mut Criterion) {
        println!("\n⏱️  Running Latency Benchmarks...\n");

        let mut group = c.benchmark_group("latency");
        group.measurement_time(self.config.duration);
        group.warm_up_time(self.config.warmup_duration);

        // Vertex creation latency
        group.bench_function("vertex_creation", |b| {
            b.iter(|| self.latency.measure_vertex_creation())
        });

        // Propagation latency
        for num_peers in &[4, 7, 10, 25, 50] {
            group.bench_with_input(
                BenchmarkId::new("propagation", num_peers),
                num_peers,
                |b, &peers| {
                    b.iter(|| self.latency.measure_propagation(peers))
                },
            );
        }

        // Finalization latency (P99)
        group.bench_function("finalization", |b| {
            b.iter(|| self.latency.measure_finalization())
        });

        group.finish();
    }

    /// Byzantine tolerance tests: f nodes validation
    fn run_byzantine_benchmarks(&self, c: &mut Criterion) {
        println!("\n🛡️  Running Byzantine Tolerance Tests...\n");

        let mut group = c.benchmark_group("byzantine");
        group.measurement_time(self.config.duration);
        group.warm_up_time(self.config.warmup_duration);

        // Equivocation detection
        group.bench_function("equivocation_detection", |b| {
            b.iter(|| self.byzantine.test_equivocation_detection())
        });

        // Byzantine node isolation
        for byzantine_count in &[1, 2, 3] {
            group.bench_with_input(
                BenchmarkId::new("isolation", byzantine_count),
                byzantine_count,
                |b, &count| {
                    b.iter(|| self.byzantine.test_byzantine_isolation(count))
                },
            );
        }

        // Fork resolution
        group.bench_function("fork_resolution", |b| {
            b.iter(|| self.byzantine.test_fork_resolution())
        });

        group.finish();
    }

    /// Network stress tests: partition, latency, packet loss
    fn run_stress_benchmarks(&self, c: &mut Criterion) {
        println!("\n🌐 Running Network Stress Tests...\n");

        let mut group = c.benchmark_group("network_stress");
        group.measurement_time(self.config.duration);
        group.warm_up_time(self.config.warmup_duration);

        // Network partition recovery
        group.bench_function("partition_recovery", |b| {
            b.iter(|| self.stress.test_partition_recovery())
        });

        // High latency scenarios
        for delay_ms in &[100, 500, 1000] {
            group.bench_with_input(
                BenchmarkId::new("high_latency", delay_ms),
                delay_ms,
                |b, &delay| {
                    b.iter(|| self.stress.test_high_latency(Duration::from_millis(delay)))
                },
            );
        }

        // Packet loss simulation
        for loss_rate in &[0.01, 0.05, 0.10] {
            group.bench_with_input(
                BenchmarkId::new("packet_loss", (loss_rate * 100.0) as u32),
                loss_rate,
                |b, &rate| {
                    b.iter(|| self.stress.test_packet_loss(rate))
                },
            );
        }

        group.finish();
    }

    /// Generate comprehensive validation report
    fn generate_report(&self) {
        println!("\n📋 Generating Validation Report...\n");

        let report = ValidationReport::new(
            self.throughput.get_results(),
            self.latency.get_results(),
            self.byzantine.get_results(),
            self.stress.get_results(),
        );

        let markdown = report.generate_markdown();
        std::fs::write("target/benchmark_validation_report.md", markdown)
            .expect("Failed to write validation report");

        println!("✅ Validation report written to target/benchmark_validation_report.md");

        let target_validation = report.check_targets();
        println!("\n{}", target_validation);
    }
}

fn comprehensive_benchmarks(c: &mut Criterion) {
    let config = ComprehensiveBenchmarkConfig::default();
    let suite = ComprehensiveBenchmarkSuite::new(config);
    suite.run_all(c);
}

criterion_group! {
    name = benches;
    config = Criterion::default()
        .sample_size(100)
        .measurement_time(Duration::from_secs(60))
        .warm_up_time(Duration::from_secs(10));
    targets = comprehensive_benchmarks
}

criterion_main!(benches);
