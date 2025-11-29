//! Unit tests for cryptographic operations
//! Tests key generation, signing, verification, encryption, and decryption

use proptest::prelude::*;

#[cfg(test)]
mod key_generation {
    use super::*;

    #[test]
    fn test_generate_keypair() {
        // Test basic keypair generation
        let keypair = crypto::generate_keypair();
        assert!(keypair.public_key.len() == 32);
        assert!(keypair.secret_key.len() == 64);
    }

    #[test]
    fn test_keypair_uniqueness() {
        // Ensure each keypair is unique
        let keypair1 = crypto::generate_keypair();
        let keypair2 = crypto::generate_keypair();
        assert_ne!(keypair1.public_key, keypair2.public_key);
        assert_ne!(keypair1.secret_key, keypair2.secret_key);
    }

    #[test]
    fn test_keypair_from_seed() {
        // Test deterministic key generation from seed
        let seed = [42u8; 32];
        let keypair1 = crypto::keypair_from_seed(&seed);
        let keypair2 = crypto::keypair_from_seed(&seed);
        assert_eq!(keypair1.public_key, keypair2.public_key);
        assert_eq!(keypair1.secret_key, keypair2.secret_key);
    }

    proptest! {
        #[test]
        fn test_keypair_generation_never_fails(seed in any::<[u8; 32]>()) {
            let result = std::panic::catch_unwind(|| {
                crypto::keypair_from_seed(&seed)
            });
            assert!(result.is_ok());
        }
    }
}

#[cfg(test)]
mod signing {
    use super::*;

    #[test]
    fn test_sign_message() {
        let keypair = crypto::generate_keypair();
        let message = b"Hello, Vigilia AI!";
        let signature = crypto::sign(message, &keypair.secret_key);
        assert_eq!(signature.len(), 64);
    }

    #[test]
    fn test_sign_empty_message() {
        let keypair = crypto::generate_keypair();
        let message = b"";
        let signature = crypto::sign(message, &keypair.secret_key);
        assert_eq!(signature.len(), 64);
    }

    #[test]
    fn test_sign_large_message() {
        let keypair = crypto::generate_keypair();
        let message = vec![0u8; 1_000_000]; // 1MB message
        let signature = crypto::sign(&message, &keypair.secret_key);
        assert_eq!(signature.len(), 64);
    }

    #[test]
    fn test_signature_determinism() {
        let keypair = crypto::generate_keypair();
        let message = b"Deterministic test";
        let sig1 = crypto::sign(message, &keypair.secret_key);
        let sig2 = crypto::sign(message, &keypair.secret_key);
        assert_eq!(sig1, sig2);
    }

    proptest! {
        #[test]
        fn test_signing_arbitrary_messages(message in prop::collection::vec(any::<u8>(), 0..10000)) {
            let keypair = crypto::generate_keypair();
            let signature = crypto::sign(&message, &keypair.secret_key);
            assert_eq!(signature.len(), 64);
        }
    }
}

#[cfg(test)]
mod verification {
    use super::*;

    #[test]
    fn test_verify_valid_signature() {
        let keypair = crypto::generate_keypair();
        let message = b"Verify me!";
        let signature = crypto::sign(message, &keypair.secret_key);
        assert!(crypto::verify(message, &signature, &keypair.public_key));
    }

    #[test]
    fn test_verify_invalid_signature() {
        let keypair = crypto::generate_keypair();
        let message = b"Original message";
        let signature = crypto::sign(message, &keypair.secret_key);

        let tampered_message = b"Tampered message";
        assert!(!crypto::verify(tampered_message, &signature, &keypair.public_key));
    }

    #[test]
    fn test_verify_wrong_public_key() {
        let keypair1 = crypto::generate_keypair();
        let keypair2 = crypto::generate_keypair();
        let message = b"Test message";
        let signature = crypto::sign(message, &keypair1.secret_key);

        assert!(!crypto::verify(message, &signature, &keypair2.public_key));
    }

    #[test]
    fn test_verify_corrupted_signature() {
        let keypair = crypto::generate_keypair();
        let message = b"Test message";
        let mut signature = crypto::sign(message, &keypair.secret_key);
        signature[0] ^= 0xFF; // Corrupt first byte

        assert!(!crypto::verify(message, &signature, &keypair.public_key));
    }

    proptest! {
        #[test]
        fn test_signature_roundtrip(message in prop::collection::vec(any::<u8>(), 0..1000)) {
            let keypair = crypto::generate_keypair();
            let signature = crypto::sign(&message, &keypair.secret_key);
            prop_assert!(crypto::verify(&message, &signature, &keypair.public_key));
        }
    }
}

#[cfg(test)]
mod encryption {
    use super::*;

    #[test]
    fn test_encrypt_message() {
        let keypair = crypto::generate_keypair();
        let plaintext = b"Secret message";
        let ciphertext = crypto::encrypt(plaintext, &keypair.public_key);
        assert_ne!(plaintext.as_slice(), ciphertext.as_slice());
        assert!(ciphertext.len() > plaintext.len()); // Includes nonce and tag
    }

    #[test]
    fn test_encrypt_empty_message() {
        let keypair = crypto::generate_keypair();
        let plaintext = b"";
        let ciphertext = crypto::encrypt(plaintext, &keypair.public_key);
        assert!(ciphertext.len() > 0); // Should still have overhead
    }

    #[test]
    fn test_encryption_randomness() {
        let keypair = crypto::generate_keypair();
        let plaintext = b"Same message";
        let ciphertext1 = crypto::encrypt(plaintext, &keypair.public_key);
        let ciphertext2 = crypto::encrypt(plaintext, &keypair.public_key);
        assert_ne!(ciphertext1, ciphertext2); // Should use random nonces
    }

    #[test]
    fn test_encrypt_large_payload() {
        let keypair = crypto::generate_keypair();
        let plaintext = vec![0x42u8; 1_000_000]; // 1MB
        let ciphertext = crypto::encrypt(&plaintext, &keypair.public_key);
        assert!(ciphertext.len() >= plaintext.len());
    }

    proptest! {
        #[test]
        fn test_encryption_never_returns_plaintext(
            plaintext in prop::collection::vec(any::<u8>(), 1..1000)
        ) {
            let keypair = crypto::generate_keypair();
            let ciphertext = crypto::encrypt(&plaintext, &keypair.public_key);
            // Ciphertext should not contain plaintext as substring
            prop_assert!(!ciphertext.windows(plaintext.len()).any(|w| w == plaintext.as_slice()));
        }
    }
}

#[cfg(test)]
mod decryption {
    use super::*;

    #[test]
    fn test_decrypt_message() {
        let keypair = crypto::generate_keypair();
        let plaintext = b"Secret message";
        let ciphertext = crypto::encrypt(plaintext, &keypair.public_key);
        let decrypted = crypto::decrypt(&ciphertext, &keypair.secret_key).unwrap();
        assert_eq!(plaintext.as_slice(), decrypted.as_slice());
    }

    #[test]
    fn test_decrypt_empty_message() {
        let keypair = crypto::generate_keypair();
        let plaintext = b"";
        let ciphertext = crypto::encrypt(plaintext, &keypair.public_key);
        let decrypted = crypto::decrypt(&ciphertext, &keypair.secret_key).unwrap();
        assert_eq!(plaintext.as_slice(), decrypted.as_slice());
    }

    #[test]
    fn test_decrypt_with_wrong_key() {
        let keypair1 = crypto::generate_keypair();
        let keypair2 = crypto::generate_keypair();
        let plaintext = b"Secret";
        let ciphertext = crypto::encrypt(plaintext, &keypair1.public_key);
        let result = crypto::decrypt(&ciphertext, &keypair2.secret_key);
        assert!(result.is_err());
    }

    #[test]
    fn test_decrypt_corrupted_ciphertext() {
        let keypair = crypto::generate_keypair();
        let plaintext = b"Secret";
        let mut ciphertext = crypto::encrypt(plaintext, &keypair.public_key);
        ciphertext[0] ^= 0xFF; // Corrupt first byte
        let result = crypto::decrypt(&ciphertext, &keypair.secret_key);
        assert!(result.is_err());
    }

    proptest! {
        #[test]
        fn test_encryption_decryption_roundtrip(
            plaintext in prop::collection::vec(any::<u8>(), 0..10000)
        ) {
            let keypair = crypto::generate_keypair();
            let ciphertext = crypto::encrypt(&plaintext, &keypair.public_key);
            let decrypted = crypto::decrypt(&ciphertext, &keypair.secret_key).unwrap();
            prop_assert_eq!(plaintext, decrypted);
        }
    }
}

#[cfg(test)]
mod quantum_resistance {
    use super::*;

    #[test]
    fn test_post_quantum_keypair() {
        let keypair = crypto::generate_pq_keypair();
        assert!(keypair.public_key.len() > 32); // PQ keys are larger
        assert!(keypair.secret_key.len() > 64);
    }

    #[test]
    fn test_hybrid_encryption() {
        let classical_keypair = crypto::generate_keypair();
        let pq_keypair = crypto::generate_pq_keypair();
        let plaintext = b"Quantum-safe message";

        let ciphertext = crypto::hybrid_encrypt(
            plaintext,
            &classical_keypair.public_key,
            &pq_keypair.public_key
        );

        let decrypted = crypto::hybrid_decrypt(
            &ciphertext,
            &classical_keypair.secret_key,
            &pq_keypair.secret_key
        ).unwrap();

        assert_eq!(plaintext.as_slice(), decrypted.as_slice());
    }

    #[test]
    fn test_dilithium_signature() {
        let keypair = crypto::generate_pq_keypair();
        let message = b"Post-quantum signature";
        let signature = crypto::pq_sign(message, &keypair.secret_key);
        assert!(crypto::pq_verify(message, &signature, &keypair.public_key));
    }
}

#[cfg(test)]
mod key_derivation {
    use super::*;

    #[test]
    fn test_derive_shared_secret() {
        let alice = crypto::generate_keypair();
        let bob = crypto::generate_keypair();

        let shared1 = crypto::derive_shared_secret(&alice.secret_key, &bob.public_key);
        let shared2 = crypto::derive_shared_secret(&bob.secret_key, &alice.public_key);

        assert_eq!(shared1, shared2);
    }

    #[test]
    fn test_kdf_determinism() {
        let input = b"input key material";
        let salt = b"unique salt";

        let derived1 = crypto::kdf(input, salt, 32);
        let derived2 = crypto::kdf(input, salt, 32);

        assert_eq!(derived1, derived2);
    }

    #[test]
    fn test_kdf_different_salts() {
        let input = b"input key material";
        let salt1 = b"salt 1";
        let salt2 = b"salt 2";

        let derived1 = crypto::kdf(input, salt1, 32);
        let derived2 = crypto::kdf(input, salt2, 32);

        assert_ne!(derived1, derived2);
    }
}
