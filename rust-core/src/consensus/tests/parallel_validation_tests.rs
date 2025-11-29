//! Integration tests for parallel vertex validation
//!
//! Validates correctness, race conditions, and performance targets

use cretoai_consensus::{BftConfig, BftEngine, ParallelConfig};
use cretoai_crypto::signatures::ML_DSA_87;
use cretoai_dag::types::Vertex;

fn generate_keypair() -> (Vec<u8>, Vec<u8>) {
    let scheme = ML_DSA_87::new();
    scheme.generate_keypair().unwrap()
}

fn create_test_vertices(count: usize) -> Vec<Vertex> {
    (0..count)
        .map(|i| {
            let id = format!("vertex-{}", i);
            let payload = format!("test-payload-{}", i).into_bytes();
            Vertex::new(id, vec![], payload, "test".to_string())
        })
        .collect()
}

#[test]
fn test_parallel_validation_correctness() {
    let config = BftConfig::default();
    let (private_key, public_key) = generate_keypair();
    let engine = BftEngine::new(config, private_key, public_key).unwrap();

    let vertices = create_test_vertices(100);

    // Validate in parallel
    let parallel_results = engine.validate_vertices_parallel(vertices.clone());

    // Validate serially
    let serial_results: Vec<_> = vertices
        .iter()
        .map(|v| engine.validate_vertex(v).unwrap())
        .collect();

    // Results should match
    assert_eq!(parallel_results.len(), serial_results.len());

    for (parallel, serial) in parallel_results.iter().zip(serial_results.iter()) {
        assert_eq!(parallel.valid, serial.valid);
        assert_eq!(parallel.vertex_id, serial.vertex_id);
    }
}

#[test]
fn test_parallel_validation_all_valid() {
    let config = BftConfig::default();
    let (private_key, public_key) = generate_keypair();
    let engine = BftEngine::new(config, private_key, public_key).unwrap();

    let vertices = create_test_vertices(1000);
    let results = engine.validate_vertices_parallel(vertices);

    // All vertices should be valid
    assert_eq!(results.len(), 1000);
    assert!(results.iter().all(|r| r.valid));
}

#[test]
fn test_parallel_validation_invalid_hash() {
    let config = BftConfig::default();
    let (private_key, public_key) = generate_keypair();
    let engine = BftEngine::new(config, private_key, public_key).unwrap();

    let mut vertices = create_test_vertices(10);

    // Corrupt the hash of one vertex
    vertices[5].hash = [0u8; 32];

    let results = engine.validate_vertices_parallel(vertices);

    assert_eq!(results.len(), 10);
    assert_eq!(results.iter().filter(|r| r.valid).count(), 9);
    assert_eq!(results.iter().filter(|r| !r.valid).count(), 1);
    assert!(!results[5].valid);
    assert_eq!(results[5].error, Some("Hash mismatch".to_string()));
}

#[test]
fn test_parallel_validation_oversized_payload() {
    let config = BftConfig::default();
    let (private_key, public_key) = generate_keypair();
    let engine = BftEngine::new(config, private_key, public_key).unwrap();

    let mut vertices = create_test_vertices(10);

    // Create oversized payload (> 1MB)
    vertices[3].payload = vec![0u8; 2 * 1024 * 1024];

    let results = engine.validate_vertices_parallel(vertices);

    assert_eq!(results.len(), 10);
    assert!(!results[3].valid);
    assert_eq!(results[3].error, Some("Payload too large".to_string()));
}

#[test]
fn test_batch_size_configurations() {
    let (private_key, public_key) = generate_keypair();
    let vertices = create_test_vertices(1000);

    // Test different batch sizes
    for batch_size in [10, 100, 1000] {
        let mut config = BftConfig::default();
        config.parallel_config.batch_size = batch_size;

        let engine = BftEngine::new(config, private_key.clone(), public_key.clone()).unwrap();
        let results = engine.validate_vertices_parallel(vertices.clone());

        assert_eq!(results.len(), 1000);
        assert!(results.iter().all(|r| r.valid));
    }
}

#[test]
fn test_thread_count_configurations() {
    let (private_key, public_key) = generate_keypair();
    let vertices = create_test_vertices(1000);

    // Test different thread counts
    for thread_count in [1, 2, 4, 8] {
        let mut config = BftConfig::default();
        config.parallel_config.worker_threads = Some(thread_count);

        let engine = BftEngine::new(config, private_key.clone(), public_key.clone()).unwrap();
        let results = engine.validate_vertices_parallel(vertices.clone());

        assert_eq!(results.len(), 1000);
        assert!(results.iter().all(|r| r.valid));
    }
}

#[test]
fn test_adaptive_validation() {
    let config = BftConfig::default();
    let (private_key, public_key) = generate_keypair();
    let engine = BftEngine::new(config, private_key, public_key).unwrap();

    // Test different workload sizes
    for size in [50, 500, 5000] {
        let vertices = create_test_vertices(size);
        let results = engine.validate_vertices_adaptive(vertices);

        assert_eq!(results.len(), size);
        assert!(results.iter().all(|r| r.valid));
    }
}

#[test]
fn test_benchmark_method() {
    let config = BftConfig::default();
    let (private_key, public_key) = generate_keypair();
    let engine = BftEngine::new(config, private_key, public_key).unwrap();

    let result = engine.benchmark_parallel_validation(1000);

    assert_eq!(result.vertex_count, 1000);
    assert!(result.single_threaded_tps > 0);
    assert!(result.parallel_tps > 0);
    assert!(result.speedup > 1.0, "Parallel should be faster than single-threaded");

    println!("Benchmark Results:");
    println!("  Vertex Count: {}", result.vertex_count);
    println!("  Single-threaded TPS: {}", result.single_threaded_tps);
    println!("  Parallel TPS: {}", result.parallel_tps);
    println!("  Speedup: {:.2}x", result.speedup);
}

#[test]
fn test_10k_tps_target() {
    let config = BftConfig::default();
    let (private_key, public_key) = generate_keypair();
    let engine = BftEngine::new(config, private_key, public_key).unwrap();

    let result = engine.benchmark_parallel_validation(10000);

    println!("\n=== 10K TPS Target Test ===");
    println!("Vertex Count: {}", result.vertex_count);
    println!("Single-threaded TPS: {}", result.single_threaded_tps);
    println!("Parallel TPS: {}", result.parallel_tps);
    println!("Speedup: {:.2}x", result.speedup);
    println!("Single-threaded time: {}ms", result.single_time_ms);
    println!("Parallel time: {}ms", result.parallel_time_ms);

    // Success criteria
    // Minimum: 200-500 TPS (10x improvement from 56 TPS baseline)
    assert!(result.parallel_tps >= 200,
        "Failed minimum TPS target: {} < 200", result.parallel_tps);

    // Stretch goal: 10,000 TPS
    if result.parallel_tps >= 10000 {
        println!("✅ Achieved stretch goal: 10,000+ TPS!");
    } else {
        println!("⚠️  Did not reach stretch goal of 10,000 TPS (got {})", result.parallel_tps);
    }

    // Speedup should be at least 3x
    assert!(result.speedup >= 3.0,
        "Failed speedup target: {:.2}x < 3.0x", result.speedup);
}

#[test]
fn test_concurrent_validation_no_race_conditions() {
    use std::sync::Arc;
    use std::thread;

    let config = BftConfig::default();
    let (private_key, public_key) = generate_keypair();
    let engine = Arc::new(BftEngine::new(config, private_key, public_key).unwrap());

    let vertices = create_test_vertices(1000);
    let vertices = Arc::new(vertices);

    // Run multiple validations concurrently
    let handles: Vec<_> = (0..4)
        .map(|_| {
            let engine = Arc::clone(&engine);
            let vertices = Arc::clone(&vertices);

            thread::spawn(move || {
                engine.validate_vertices_parallel((*vertices).clone())
            })
        })
        .collect();

    // All threads should complete successfully
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();

    for result in results {
        assert_eq!(result.len(), 1000);
        assert!(result.iter().all(|r| r.valid));
    }
}

#[test]
fn test_empty_vertex_list() {
    let config = BftConfig::default();
    let (private_key, public_key) = generate_keypair();
    let engine = BftEngine::new(config, private_key, public_key).unwrap();

    let vertices = vec![];
    let results = engine.validate_vertices_parallel(vertices);

    assert_eq!(results.len(), 0);
}

#[test]
fn test_large_batch_performance() {
    let config = BftConfig::default();
    let (private_key, public_key) = generate_keypair();
    let engine = BftEngine::new(config, private_key, public_key).unwrap();

    // Test with large batch (50k vertices)
    let vertices = create_test_vertices(50000);

    let start = std::time::Instant::now();
    let results = engine.validate_vertices_parallel(vertices);
    let elapsed = start.elapsed();

    let tps = (50000 as f64 / elapsed.as_secs_f64()) as u64;

    println!("\n=== Large Batch Performance ===");
    println!("Vertices: 50,000");
    println!("Time: {}ms", elapsed.as_millis());
    println!("TPS: {}", tps);

    assert_eq!(results.len(), 50000);
    assert!(results.iter().all(|r| r.valid));
}
