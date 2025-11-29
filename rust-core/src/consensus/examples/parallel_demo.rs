//! Simple demo of parallel vertex validation

use cretoai_consensus::{BftConfig, BftEngine};
use cretoai_crypto::signatures::{ML_DSA_87, SignatureScheme};

fn main() {
    println!("=== Parallel Vertex Validation Demo ===\n");

    // Generate keypair
    let scheme = ML_DSA_87::new();
    let (private_key, public_key) = scheme.generate_keypair();

    println!("1. Creating BFT Engine with default parallel configuration...");
    let config = BftConfig::default();
    println!("   - Batch size: {}", config.parallel_config.batch_size);
    println!("   - Max parallel validations: {}", config.parallel_config.max_parallel_validations);

    let engine = BftEngine::new(config, private_key, public_key).unwrap();

    // Run benchmark
    println!("\n2. Running performance benchmark (10,000 vertices)...\n");
    let result = engine.benchmark_parallel_validation(10000);

    println!("=== Results ===");
    println!("Vertices: {}", result.vertex_count);
    println!("\nSingle-threaded:");
    println!("  TPS: {}", result.single_threaded_tps);
    println!("  Time: {}ms", result.single_time_ms);
    println!("\nParallel:");
    println!("  TPS: {}", result.parallel_tps);
    println!("  Time: {}ms", result.parallel_time_ms);
    println!("\nPerformance:");
    println!("  Speedup: {:.2}x", result.speedup);

    println!("\n=== Target Evaluation ===");
    if result.parallel_tps >= 200 {
        println!("✅ Minimum target achieved: {} TPS >= 200 TPS", result.parallel_tps);
    } else {
        println!("❌ Minimum target failed: {} TPS < 200 TPS", result.parallel_tps);
    }

    if result.parallel_tps >= 10000 {
        println!("✅ STRETCH GOAL ACHIEVED: {} TPS >= 10,000 TPS! 🎉", result.parallel_tps);
    } else {
        println!("⚠️  Stretch goal not reached: {} TPS < 10,000 TPS", result.parallel_tps);
    }

    if result.speedup >= 10.0 {
        println!("✅ Target speedup achieved: {:.2}x >= 10x", result.speedup);
    } else {
        println!("⚠️  Speedup: {:.2}x (target was 10x)", result.speedup);
    }
}
