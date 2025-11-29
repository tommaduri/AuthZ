//! Parallel Vertex Validation Demo
//!
//! Demonstrates the parallel vertex validation system achieving 10,000+ TPS

use cretoai_consensus::{BftConfig, BftEngine, ParallelConfig};
use cretoai_crypto::signatures::ML_DSA_87;
use cretoai_dag::types::Vertex;

fn main() {
    println!("=== Parallel Vertex Validation Demo ===\n");

    // Initialize tracing
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    // Generate keypair
    let scheme = ML_DSA_87::new();
    let (private_key, public_key) = scheme.generate_keypair().unwrap();

    println!("1. Creating BFT Engine with default parallel configuration...");
    let config = BftConfig::default();
    println!("   - Batch size: {}", config.parallel_config.batch_size);
    println!("   - Max parallel validations: {}", config.parallel_config.max_parallel_validations);
    println!("   - Work-stealing enabled: {}\n", config.parallel_config.enable_work_stealing);

    let engine = BftEngine::new(config, private_key, public_key).unwrap();

    // Test 1: Small batch (100 vertices)
    println!("2. Testing small batch (100 vertices)...");
    let small_batch = create_test_vertices(100);
    let results = engine.validate_vertices_parallel(small_batch);
    println!("   ✅ Validated {} vertices", results.len());
    println!("   ✅ All valid: {}\n", results.iter().all(|r| r.valid));

    // Test 2: Medium batch (1,000 vertices)
    println!("3. Testing medium batch (1,000 vertices)...");
    let medium_batch = create_test_vertices(1000);
    let start = std::time::Instant::now();
    let results = engine.validate_vertices_parallel(medium_batch);
    let elapsed = start.elapsed();
    let tps = (1000 as f64 / elapsed.as_secs_f64()) as u64;
    println!("   ✅ Validated {} vertices in {}ms", results.len(), elapsed.as_millis());
    println!("   ✅ TPS: {}\n", tps);

    // Test 3: Large batch (10,000 vertices) - TARGET TEST
    println!("4. Testing large batch (10,000 vertices) - TARGET TEST...");
    let benchmark = engine.benchmark_parallel_validation(10000);

    println!("\n=== Benchmark Results ===");
    println!("Vertices: {}", benchmark.vertex_count);
    println!("Single-threaded:");
    println!("  - TPS: {}", benchmark.single_threaded_tps);
    println!("  - Time: {}ms", benchmark.single_time_ms);
    println!("Parallel:");
    println!("  - TPS: {}", benchmark.parallel_tps);
    println!("  - Time: {}ms", benchmark.parallel_time_ms);
    println!("Performance:");
    println!("  - Speedup: {:.2}x", benchmark.speedup);

    // Evaluate against targets
    println!("\n=== Target Evaluation ===");

    if benchmark.parallel_tps >= 200 {
        println!("✅ Minimum target achieved: {} TPS >= 200 TPS", benchmark.parallel_tps);
    } else {
        println!("❌ Minimum target failed: {} TPS < 200 TPS", benchmark.parallel_tps);
    }

    if benchmark.parallel_tps >= 10000 {
        println!("✅ STRETCH GOAL ACHIEVED: {} TPS >= 10,000 TPS! 🎉", benchmark.parallel_tps);
    } else {
        println!("⚠️  Stretch goal not reached: {} TPS < 10,000 TPS", benchmark.parallel_tps);
    }

    if benchmark.speedup >= 10.0 {
        println!("✅ Target speedup achieved: {:.2}x >= 10x", benchmark.speedup);
    } else {
        println!("⚠️  Target speedup not fully reached: {:.2}x < 10x", benchmark.speedup);
    }

    // Test 4: Adaptive batching
    println!("\n5. Testing adaptive batching...");
    for size in [50, 500, 5000] {
        let vertices = create_test_vertices(size);
        let start = std::time::Instant::now();
        let results = engine.validate_vertices_adaptive(vertices);
        let elapsed = start.elapsed();
        let tps = (size as f64 / elapsed.as_secs_f64()) as u64;
        println!("   - {} vertices: {}ms, {} TPS", size, elapsed.as_millis(), tps);
    }

    // Test 5: Custom configuration
    println!("\n6. Testing custom parallel configuration...");
    let mut custom_config = BftConfig::default();
    custom_config.parallel_config = ParallelConfig {
        max_parallel_validations: 32,
        batch_size: 500,
        enable_work_stealing: true,
        worker_threads: Some(8),
    };

    let scheme = ML_DSA_87::new();
    let (private_key, public_key) = scheme.generate_keypair().unwrap();
    let custom_engine = BftEngine::new(custom_config, private_key, public_key).unwrap();

    let vertices = create_test_vertices(10000);
    let start = std::time::Instant::now();
    let results = custom_engine.validate_vertices_parallel(vertices);
    let elapsed = start.elapsed();
    let tps = (10000 as f64 / elapsed.as_secs_f64()) as u64;

    println!("   Custom config (8 threads, batch=500):");
    println!("   - Time: {}ms", elapsed.as_millis());
    println!("   - TPS: {}", tps);
    println!("   - All valid: {}", results.iter().all(|r| r.valid));

    println!("\n=== Demo Complete ===");
}

fn create_test_vertices(count: usize) -> Vec<Vertex> {
    (0..count)
        .map(|i| {
            let id = format!("vertex-{}", i);
            let payload = format!("demo-payload-{}", i).into_bytes();
            Vertex::new(id, vec![], payload, "demo".to_string())
        })
        .collect()
}
