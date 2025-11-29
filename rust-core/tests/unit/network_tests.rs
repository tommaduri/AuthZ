//! Unit tests for network utilities
//! Tests address parsing, peer management, and network protocols

use proptest::prelude::*;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

#[cfg(test)]
mod address_parsing {
    use super::*;

    #[test]
    fn test_parse_ipv4_address() {
        let addr = network::parse_address("192.168.1.1:8080").unwrap();
        assert_eq!(addr.port(), 8080);
        assert!(addr.is_ipv4());
    }

    #[test]
    fn test_parse_ipv6_address() {
        let addr = network::parse_address("[::1]:8080").unwrap();
        assert_eq!(addr.port(), 8080);
        assert!(addr.is_ipv6());
    }

    #[test]
    fn test_parse_dark_domain() {
        let domain = "example.dark:8080";
        let parsed = network::parse_dark_domain(domain).unwrap();
        assert_eq!(parsed.domain, "example.dark");
        assert_eq!(parsed.port, 8080);
    }

    #[test]
    fn test_parse_onion_address() {
        let onion = "abcdefghijklmnop.onion:9050";
        let parsed = network::parse_onion_address(onion).unwrap();
        assert_eq!(parsed.len(), 16); // 16 char onion v2
    }

    #[test]
    fn test_parse_invalid_address() {
        let result = network::parse_address("not-an-address");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_address_with_invalid_port() {
        let result = network::parse_address("192.168.1.1:99999");
        assert!(result.is_err());
    }

    proptest! {
        #[test]
        fn test_parse_valid_ipv4_addresses(
            a in 0u8..=255,
            b in 0u8..=255,
            c in 0u8..=255,
            d in 0u8..=255,
            port in 1u16..=65535
        ) {
            let addr_str = format!("{}.{}.{}.{}:{}", a, b, c, d, port);
            let result = network::parse_address(&addr_str);
            prop_assert!(result.is_ok());
            if let Ok(addr) = result {
                prop_assert_eq!(addr.port(), port);
            }
        }
    }
}

#[cfg(test)]
mod peer_management {
    use super::*;

    #[test]
    fn test_add_peer() {
        let mut peer_manager = network::PeerManager::new();
        let peer_id = [1u8; 32];
        let addr = "127.0.0.1:8080".parse().unwrap();

        peer_manager.add_peer(peer_id, addr);
        assert_eq!(peer_manager.peer_count(), 1);
    }

    #[test]
    fn test_remove_peer() {
        let mut peer_manager = network::PeerManager::new();
        let peer_id = [1u8; 32];
        let addr = "127.0.0.1:8080".parse().unwrap();

        peer_manager.add_peer(peer_id, addr);
        peer_manager.remove_peer(&peer_id);
        assert_eq!(peer_manager.peer_count(), 0);
    }

    #[test]
    fn test_get_peer_address() {
        let mut peer_manager = network::PeerManager::new();
        let peer_id = [1u8; 32];
        let addr = "127.0.0.1:8080".parse().unwrap();

        peer_manager.add_peer(peer_id, addr);
        let retrieved = peer_manager.get_peer_address(&peer_id).unwrap();
        assert_eq!(retrieved, addr);
    }

    #[test]
    fn test_peer_reputation() {
        let mut peer_manager = network::PeerManager::new();
        let peer_id = [1u8; 32];

        peer_manager.increase_reputation(&peer_id, 10);
        assert_eq!(peer_manager.get_reputation(&peer_id), 10);

        peer_manager.decrease_reputation(&peer_id, 3);
        assert_eq!(peer_manager.get_reputation(&peer_id), 7);
    }

    #[test]
    fn test_ban_peer() {
        let mut peer_manager = network::PeerManager::new();
        let peer_id = [1u8; 32];

        peer_manager.ban_peer(&peer_id, Duration::from_secs(3600));
        assert!(peer_manager.is_banned(&peer_id));
    }

    #[test]
    fn test_max_peers_limit() {
        let mut peer_manager = network::PeerManager::with_max_peers(10);

        for i in 0..15 {
            let peer_id = [i as u8; 32];
            let addr = format!("127.0.0.1:{}", 8000 + i).parse().unwrap();
            peer_manager.add_peer(peer_id, addr);
        }

        assert_eq!(peer_manager.peer_count(), 10);
    }

    #[test]
    fn test_get_best_peers() {
        let mut peer_manager = network::PeerManager::new();

        for i in 0..10 {
            let peer_id = [i as u8; 32];
            let addr = format!("127.0.0.1:{}", 8000 + i).parse().unwrap();
            peer_manager.add_peer(peer_id, addr);
            peer_manager.increase_reputation(&peer_id, i as i32 * 10);
        }

        let best = peer_manager.get_best_peers(3);
        assert_eq!(best.len(), 3);
        // Verify they're sorted by reputation
        assert!(best[0].reputation >= best[1].reputation);
        assert!(best[1].reputation >= best[2].reputation);
    }
}

#[cfg(test)]
mod onion_routing {
    use super::*;

    #[test]
    fn test_create_circuit() {
        let circuit = network::Circuit::new(3); // 3-hop circuit
        assert_eq!(circuit.hop_count(), 3);
        assert!(circuit.is_valid());
    }

    #[test]
    fn test_circuit_extend() {
        let mut circuit = network::Circuit::new(2);
        let new_hop = network::CircuitHop::new([1u8; 32]);

        circuit.extend(new_hop);
        assert_eq!(circuit.hop_count(), 3);
    }

    #[test]
    fn test_onion_encrypt() {
        let circuit = network::Circuit::new(3);
        let message = b"Secret message";

        let onion = circuit.encrypt_onion(message);
        assert_ne!(onion.as_slice(), message);
        assert!(onion.len() > message.len());
    }

    #[test]
    fn test_onion_decrypt() {
        let circuit = network::Circuit::new(3);
        let message = b"Secret message";

        let onion = circuit.encrypt_onion(message);
        let decrypted = circuit.decrypt_onion(&onion).unwrap();
        assert_eq!(decrypted.as_slice(), message);
    }

    #[test]
    fn test_circuit_teardown() {
        let mut circuit = network::Circuit::new(3);
        circuit.teardown();
        assert!(!circuit.is_valid());
    }

    #[test]
    fn test_layer_peeling() {
        let circuit = network::Circuit::new(3);
        let message = b"Test";
        let mut onion = circuit.encrypt_onion(message);

        // Simulate each hop peeling a layer
        for hop in circuit.hops() {
            onion = hop.peel_layer(&onion).unwrap();
        }

        assert_eq!(onion.as_slice(), message);
    }
}

#[cfg(test)]
mod protocol_messages {
    use super::*;

    #[test]
    fn test_handshake_message() {
        let msg = network::Message::Handshake {
            version: 1,
            public_key: [0u8; 32],
            timestamp: 12345,
        };

        let serialized = msg.serialize().unwrap();
        let deserialized = network::Message::deserialize(&serialized).unwrap();

        assert_eq!(msg, deserialized);
    }

    #[test]
    fn test_ping_pong() {
        let ping = network::Message::Ping { nonce: 12345 };
        let pong = network::Message::Pong { nonce: 12345 };

        assert_eq!(ping.get_nonce(), pong.get_nonce());
    }

    #[test]
    fn test_data_message() {
        let data = vec![1, 2, 3, 4, 5];
        let msg = network::Message::Data {
            payload: data.clone(),
            sequence: 1,
        };

        let serialized = msg.serialize().unwrap();
        assert!(serialized.len() >= data.len());
    }

    #[test]
    fn test_message_authentication() {
        let keypair = crypto::generate_keypair();
        let msg = network::Message::Data {
            payload: vec![1, 2, 3],
            sequence: 1,
        };

        let authenticated = msg.authenticate(&keypair.secret_key);
        assert!(authenticated.verify(&keypair.public_key));
    }

    proptest! {
        #[test]
        fn test_message_serialization_roundtrip(
            payload in prop::collection::vec(any::<u8>(), 0..1000),
            sequence in any::<u64>()
        ) {
            let msg = network::Message::Data { payload, sequence };
            let serialized = msg.serialize().unwrap();
            let deserialized = network::Message::deserialize(&serialized).unwrap();
            prop_assert_eq!(msg, deserialized);
        }
    }
}

#[cfg(test)]
mod connection_management {
    use super::*;

    #[test]
    fn test_connection_pool() {
        let pool = network::ConnectionPool::new(10);
        assert_eq!(pool.capacity(), 10);
        assert_eq!(pool.active_count(), 0);
    }

    #[test]
    fn test_connection_timeout() {
        let mut conn = network::Connection::new("127.0.0.1:8080".parse().unwrap());
        conn.set_timeout(Duration::from_secs(5));
        assert_eq!(conn.timeout(), Duration::from_secs(5));
    }

    #[test]
    fn test_connection_keepalive() {
        let mut conn = network::Connection::new("127.0.0.1:8080".parse().unwrap());
        conn.enable_keepalive(Duration::from_secs(30));
        assert!(conn.keepalive_enabled());
    }

    #[test]
    fn test_connection_metrics() {
        let conn = network::Connection::new("127.0.0.1:8080".parse().unwrap());
        let metrics = conn.metrics();

        assert_eq!(metrics.bytes_sent, 0);
        assert_eq!(metrics.bytes_received, 0);
        assert_eq!(metrics.messages_sent, 0);
        assert_eq!(metrics.messages_received, 0);
    }
}

#[cfg(test)]
mod rate_limiting {
    use super::*;

    #[test]
    fn test_rate_limiter() {
        let mut limiter = network::RateLimiter::new(10, Duration::from_secs(1));

        for _ in 0..10 {
            assert!(limiter.allow());
        }
        assert!(!limiter.allow()); // 11th request should be denied
    }

    #[test]
    fn test_rate_limiter_reset() {
        let mut limiter = network::RateLimiter::new(5, Duration::from_millis(100));

        for _ in 0..5 {
            assert!(limiter.allow());
        }

        std::thread::sleep(Duration::from_millis(150));
        assert!(limiter.allow()); // Should allow after reset
    }

    #[test]
    fn test_per_peer_rate_limiting() {
        let mut limiter = network::PerPeerRateLimiter::new(10, Duration::from_secs(1));
        let peer_id = [1u8; 32];

        for _ in 0..10 {
            assert!(limiter.allow(&peer_id));
        }
        assert!(!limiter.allow(&peer_id));
    }
}
