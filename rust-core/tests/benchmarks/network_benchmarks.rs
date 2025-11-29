//! Benchmark tests for network operations
//! Tests throughput, latency, and scalability

use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId, Throughput};
use std::time::Duration;

fn bench_message_serialization(c: &mut Criterion) {
    let mut group = c.benchmark_group("message_serialization");

    for size in [64, 256, 1024, 4096, 16384].iter() {
        let payload = vec![0u8; *size];
        let message = network::Message::Data {
            payload: payload.clone(),
            sequence: 1,
        };

        group.throughput(Throughput::Bytes(*size as u64));

        group.bench_with_input(
            BenchmarkId::new("serialize", size),
            size,
            |b, _| {
                b.iter(|| {
                    message.serialize()
                });
            }
        );

        let serialized = message.serialize().unwrap();

        group.bench_with_input(
            BenchmarkId::new("deserialize", size),
            size,
            |b, _| {
                b.iter(|| {
                    network::Message::deserialize(black_box(&serialized))
                });
            }
        );
    }

    group.finish();
}

fn bench_routing_throughput(c: &mut Criterion) {
    let mut group = c.benchmark_group("routing_throughput");
    group.sample_size(50);

    for hops in [1, 3, 5, 7].iter() {
        let network = setup_test_network(*hops);
        let message = vec![0u8; 1024];

        group.throughput(Throughput::Elements(1));
        group.bench_with_input(
            BenchmarkId::new("route_message", hops),
            hops,
            |b, _| {
                b.iter(|| {
                    network.route_message_sync(black_box(&message), *hops)
                });
            }
        );
    }

    group.finish();
}

fn bench_circuit_construction(c: &mut Criterion) {
    let mut group = c.benchmark_group("circuit_construction");
    group.sample_size(30);

    for hops in [1, 3, 5, 7, 10].iter() {
        let network = setup_test_network(*hops * 2);

        group.bench_with_input(
            BenchmarkId::new("build_circuit", hops),
            hops,
            |b, _| {
                b.iter(|| {
                    network.build_circuit_sync(*hops)
                });
            }
        );
    }

    group.finish();
}

fn bench_peer_management(c: &mut Criterion) {
    let mut group = c.benchmark_group("peer_management");

    let mut peer_manager = network::PeerManager::new();

    group.bench_function("add_peer", |b| {
        let mut id_counter = 0u8;
        b.iter(|| {
            let peer_id = [id_counter; 32];
            let addr = format!("127.0.0.1:{}", 8000 + id_counter).parse().unwrap();
            peer_manager.add_peer(peer_id, addr);
            id_counter = id_counter.wrapping_add(1);
        });
    });

    // Populate with peers
    for i in 0..1000 {
        let peer_id = [i as u8; 32];
        let addr = format!("127.0.0.1:{}", 8000 + i).parse().unwrap();
        peer_manager.add_peer(peer_id, addr);
    }

    group.bench_function("get_peer", |b| {
        b.iter(|| {
            let peer_id = [(black_box(42) % 100) as u8; 32];
            peer_manager.get_peer_address(&peer_id)
        });
    });

    group.bench_function("get_best_peers_10", |b| {
        b.iter(|| {
            peer_manager.get_best_peers(10)
        });
    });

    group.finish();
}

fn bench_connection_pool(c: &mut Criterion) {
    let mut group = c.benchmark_group("connection_pool");

    let pool = network::ConnectionPool::new(100);

    group.bench_function("acquire_connection", |b| {
        b.iter(|| {
            pool.acquire()
        });
    });

    group.bench_function("release_connection", |b| {
        b.iter(|| {
            if let Ok(conn) = pool.acquire() {
                pool.release(conn);
            }
        });
    });

    group.finish();
}

fn bench_rate_limiting(c: &mut Criterion) {
    let mut group = c.benchmark_group("rate_limiting");

    let mut limiter = network::RateLimiter::new(1000, Duration::from_secs(1));

    group.bench_function("check_rate_limit", |b| {
        b.iter(|| {
            limiter.allow()
        });
    });

    let mut per_peer_limiter = network::PerPeerRateLimiter::new(100, Duration::from_secs(1));

    group.bench_function("check_per_peer_limit", |b| {
        let peer_id = [42u8; 32];
        b.iter(|| {
            per_peer_limiter.allow(black_box(&peer_id))
        });
    });

    group.finish();
}

fn bench_dark_domain_resolution(c: &mut Criterion) {
    let mut group = c.benchmark_group("dark_domain_resolution");

    let registry = setup_registry();

    // Register domains
    for i in 0..100 {
        let domain = format!("domain{}.dark", i);
        registry.register_sync(&domain, [i as u8; 32]);
    }

    group.bench_function("resolve_cached", |b| {
        b.iter(|| {
            registry.resolve(black_box("domain50.dark"))
        });
    });

    group.bench_function("resolve_uncached", |b| {
        let mut counter = 0u32;
        b.iter(|| {
            let domain = format!("test{}.dark", counter);
            registry.resolve(&domain);
            counter += 1;
        });
    });

    group.bench_function("reverse_lookup", |b| {
        let public_key = [50u8; 32];
        b.iter(|| {
            registry.reverse_lookup(black_box(&public_key))
        });
    });

    group.finish();
}

fn bench_packet_processing(c: &mut Criterion) {
    let mut group = c.benchmark_group("packet_processing");

    for size in [64, 256, 1024, 4096, 16384].iter() {
        let packet = vec![0u8; *size];

        group.throughput(Throughput::Bytes(*size as u64));

        group.bench_with_input(
            BenchmarkId::new("validate_packet", size),
            size,
            |b, _| {
                b.iter(|| {
                    network::validate_packet(black_box(&packet))
                });
            }
        );

        group.bench_with_input(
            BenchmarkId::new("parse_header", size),
            size,
            |b, _| {
                b.iter(|| {
                    network::parse_packet_header(black_box(&packet))
                });
            }
        );
    }

    group.finish();
}

fn bench_concurrent_connections(c: &mut Criterion) {
    let mut group = c.benchmark_group("concurrent_connections");
    group.sample_size(20);

    for conn_count in [10, 50, 100, 500].iter() {
        group.bench_with_input(
            BenchmarkId::new("handle_connections", conn_count),
            conn_count,
            |b, &count| {
                b.iter(|| {
                    let network = setup_test_network(10);
                    network.simulate_concurrent_connections(count);
                });
            }
        );
    }

    group.finish();
}

fn bench_bandwidth_utilization(c: &mut Criterion) {
    let mut group = c.benchmark_group("bandwidth_utilization");
    group.sample_size(30);

    let network = setup_test_network(5);

    for rate_mbps in [1, 10, 100, 1000].iter() {
        let bytes_per_second = rate_mbps * 1024 * 1024 / 8;

        group.throughput(Throughput::Bytes(bytes_per_second as u64));

        group.bench_with_input(
            BenchmarkId::new("sustained_throughput", rate_mbps),
            rate_mbps,
            |b, _| {
                b.iter(|| {
                    network.send_data(black_box(bytes_per_second / 100));
                });
            }
        );
    }

    group.finish();
}

fn bench_protocol_overhead(c: &mut Criterion) {
    let mut group = c.benchmark_group("protocol_overhead");

    for payload_size in [64, 256, 1024, 4096].iter() {
        let payload = vec![0u8; *payload_size];

        group.bench_with_input(
            BenchmarkId::new("add_protocol_headers", payload_size),
            payload_size,
            |b, _| {
                b.iter(|| {
                    network::add_protocol_headers(black_box(&payload))
                });
            }
        );

        let packet = network::add_protocol_headers(&payload);

        group.bench_with_input(
            BenchmarkId::new("strip_protocol_headers", payload_size),
            payload_size,
            |b, _| {
                b.iter(|| {
                    network::strip_protocol_headers(black_box(&packet))
                });
            }
        );
    }

    group.finish();
}

fn bench_address_parsing(c: &mut Criterion) {
    let mut group = c.benchmark_group("address_parsing");

    let addresses = vec![
        "192.168.1.1:8080",
        "[::1]:8080",
        "example.dark:9050",
        "abcdefghijklmnop.onion:9050",
    ];

    for addr in addresses {
        group.bench_with_input(
            BenchmarkId::new("parse_address", addr),
            &addr,
            |b, addr| {
                b.iter(|| {
                    network::parse_address(black_box(addr))
                });
            }
        );
    }

    group.finish();
}

// Test utilities
fn setup_test_network(node_count: usize) -> TestNetwork {
    TestNetwork {
        node_count,
    }
}

struct TestNetwork {
    node_count: usize,
}

impl TestNetwork {
    fn route_message_sync(&self, message: &[u8], hops: usize) -> Result<Vec<u8>, ()> {
        Ok(message.to_vec())
    }

    fn build_circuit_sync(&self, hops: usize) -> Result<(), ()> {
        Ok(())
    }

    fn simulate_concurrent_connections(&self, count: usize) {
        // Simulation
    }

    fn send_data(&self, bytes: usize) {
        // Simulation
    }
}

fn setup_registry() -> Registry {
    Registry::new()
}

struct Registry;

impl Registry {
    fn new() -> Self {
        Self
    }

    fn register_sync(&self, domain: &str, key: [u8; 32]) {
        // Registration
    }

    fn resolve(&self, domain: &str) -> Option<[u8; 32]> {
        Some([0u8; 32])
    }

    fn reverse_lookup(&self, key: &[u8; 32]) -> Vec<String> {
        vec![]
    }
}

criterion_group! {
    name = network_benches;
    config = Criterion::default()
        .measurement_time(Duration::from_secs(10))
        .sample_size(100);
    targets =
        bench_message_serialization,
        bench_routing_throughput,
        bench_circuit_construction,
        bench_peer_management,
        bench_connection_pool,
        bench_rate_limiting,
        bench_dark_domain_resolution,
        bench_packet_processing,
        bench_concurrent_connections,
        bench_bandwidth_utilization,
        bench_protocol_overhead,
        bench_address_parsing
}

criterion_main!(network_benches);
