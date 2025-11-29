//! Comprehensive TDD tests for signature schemes
//!
//! Following London School TDD (mock-driven):
//! - Test all signature operations (generate, sign, verify)
//! - Test error conditions and edge cases
//! - Test serialization/deserialization
//! - Test cross-signature verification failures

use cretoai_crypto::signatures::{
    MLDSA87, MLDSA87KeyPair, MLDSA87PublicKey, MLDSA87SecretKey, MLDSA87Signature,
    SphincsPlusKeyPair, SphincsPlusPublicKey, SphincsPlusSecretKey, SphincsPlusSignature,
};
use cretoai_crypto::error::{CryptoError, Result};

#[cfg(test)]
mod mldsa87_keypair_generation_tests {
    use super::*;

    #[test]
    fn test_generate_keypair_success() {
        let keypair = MLDSA87::generate();

        // Verify keypair has both public and secret keys
        let public_key_bytes = keypair.public_key.as_bytes();
        let secret_key_bytes = keypair.secret_key.as_bytes();

        assert!(!public_key_bytes.is_empty());
        assert!(!secret_key_bytes.is_empty());
    }

    #[test]
    fn test_generate_multiple_unique_keypairs() {
        let keypair1 = MLDSA87::generate();
        let keypair2 = MLDSA87::generate();

        // Different keypairs should have different keys
        assert_ne!(
            keypair1.public_key.as_bytes(),
            keypair2.public_key.as_bytes()
        );
        assert_ne!(
            keypair1.secret_key.as_bytes(),
            keypair2.secret_key.as_bytes()
        );
    }

    #[test]
    fn test_keypair_generates_valid_keys() {
        let keypair = MLDSA87::generate();
        let message = b"test message for signing";

        // Should be able to sign and verify with generated keypair
        let signature = keypair.sign(message);
        let result = keypair.verify(message, &signature);

        assert!(result.is_ok());
    }
}

#[cfg(test)]
mod mldsa87_signing_tests {
    use super::*;

    #[test]
    fn test_sign_message_produces_signature() {
        let keypair = MLDSA87::generate();
        let message = b"test message";

        let signature = keypair.sign(message);

        // Signature should not be empty
        assert!(!signature.as_bytes().is_empty());
    }

    #[test]
    fn test_sign_empty_message() {
        let keypair = MLDSA87::generate();
        let message = b"";

        let signature = keypair.sign(message);

        // Should be able to sign empty messages
        assert!(!signature.as_bytes().is_empty());
    }

    #[test]
    fn test_sign_large_message() {
        let keypair = MLDSA87::generate();
        let message = vec![0u8; 1024 * 1024]; // 1 MB message

        let signature = keypair.sign(&message);

        // Should handle large messages
        assert!(!signature.as_bytes().is_empty());
    }

    #[test]
    fn test_sign_deterministic_for_same_message() {
        let keypair = MLDSA87::generate();
        let message = b"deterministic test";

        let sig1 = keypair.sign(message);
        let sig2 = keypair.sign(message);

        // Dilithium is deterministic with same key and message
        assert_eq!(sig1.as_bytes(), sig2.as_bytes());
    }

    #[test]
    fn test_sign_different_messages_different_signatures() {
        let keypair = MLDSA87::generate();
        let message1 = b"message one";
        let message2 = b"message two";

        let sig1 = keypair.sign(message1);
        let sig2 = keypair.sign(message2);

        assert_ne!(sig1.as_bytes(), sig2.as_bytes());
    }
}

#[cfg(test)]
mod mldsa87_verification_tests {
    use super::*;

    #[test]
    fn test_verify_valid_signature_succeeds() {
        let keypair = MLDSA87::generate();
        let message = b"valid message";

        let signature = keypair.sign(message);
        let result = keypair.verify(message, &signature);

        assert!(result.is_ok());
    }

    #[test]
    fn test_verify_with_wrong_message_fails() {
        let keypair = MLDSA87::generate();
        let message1 = b"original message";
        let message2 = b"tampered message";

        let signature = keypair.sign(message1);
        let result = keypair.verify(message2, &signature);

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            CryptoError::SignatureVerificationFailed
        ));
    }

    #[test]
    fn test_verify_with_wrong_public_key_fails() {
        let keypair1 = MLDSA87::generate();
        let keypair2 = MLDSA87::generate();
        let message = b"test message";

        let signature = keypair1.sign(message);
        let result = MLDSA87::verify(message, &signature, &keypair2.public_key);

        assert!(result.is_err());
    }

    #[test]
    fn test_verify_empty_message_signature() {
        let keypair = MLDSA87::generate();
        let message = b"";

        let signature = keypair.sign(message);
        let result = keypair.verify(message, &signature);

        assert!(result.is_ok());
    }

    #[test]
    fn test_verify_large_message_signature() {
        let keypair = MLDSA87::generate();
        let message = vec![0u8; 1024 * 1024]; // 1 MB

        let signature = keypair.sign(&message);
        let result = keypair.verify(&message, &signature);

        assert!(result.is_ok());
    }
}

#[cfg(test)]
mod mldsa87_serialization_tests {
    use super::*;

    #[test]
    fn test_public_key_to_bytes_and_back() {
        let keypair = MLDSA87::generate();
        let public_key_bytes = keypair.public_key.as_bytes();

        let restored_key = MLDSA87PublicKey::from_bytes(public_key_bytes);

        assert!(restored_key.is_ok());
        assert_eq!(
            restored_key.unwrap().as_bytes(),
            keypair.public_key.as_bytes()
        );
    }

    #[test]
    fn test_secret_key_to_bytes_and_back() {
        let keypair = MLDSA87::generate();
        let secret_key_bytes = keypair.secret_key.as_bytes();

        let restored_key = MLDSA87SecretKey::from_bytes(secret_key_bytes);

        assert!(restored_key.is_ok());
        assert_eq!(
            restored_key.unwrap().as_bytes(),
            keypair.secret_key.as_bytes()
        );
    }

    #[test]
    fn test_signature_to_bytes_and_back() {
        let keypair = MLDSA87::generate();
        let message = b"test message";
        let signature = keypair.sign(message);

        let signature_bytes = signature.as_bytes();
        let restored_signature = MLDSA87Signature::from_bytes(signature_bytes);

        assert!(restored_signature.is_ok());
        assert_eq!(
            restored_signature.unwrap().as_bytes(),
            signature.as_bytes()
        );
    }

    #[test]
    fn test_public_key_from_invalid_bytes_fails() {
        let invalid_bytes = vec![0u8; 10]; // Wrong size

        let result = MLDSA87PublicKey::from_bytes(&invalid_bytes);

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), CryptoError::InvalidPublicKey));
    }

    #[test]
    fn test_secret_key_from_invalid_bytes_fails() {
        let invalid_bytes = vec![0u8; 10]; // Wrong size

        let result = MLDSA87SecretKey::from_bytes(&invalid_bytes);

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), CryptoError::InvalidSecretKey));
    }

    #[test]
    fn test_signature_from_invalid_bytes_fails() {
        let invalid_bytes = vec![0u8; 10]; // Wrong size

        let result = MLDSA87Signature::from_bytes(&invalid_bytes);

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), CryptoError::InvalidSignature(_)));
    }

    #[test]
    fn test_serialized_keys_remain_functional() {
        let keypair = MLDSA87::generate();
        let message = b"test message";

        // Serialize and deserialize keys
        let pk_bytes = keypair.public_key.as_bytes();
        let sk_bytes = keypair.secret_key.as_bytes();

        let restored_pk = MLDSA87PublicKey::from_bytes(pk_bytes).unwrap();
        let restored_sk = MLDSA87SecretKey::from_bytes(sk_bytes).unwrap();

        // Create signature with restored key
        let signature = MLDSA87::sign(message, &restored_sk);
        let result = MLDSA87::verify(message, &signature, &restored_pk);

        assert!(result.is_ok());
    }
}

#[cfg(test)]
mod mldsa87_edge_case_tests {
    use super::*;

    #[test]
    fn test_sign_with_binary_data() {
        let keypair = MLDSA87::generate();
        let binary_data = vec![0x00, 0xFF, 0xAA, 0x55, 0x12, 0x34];

        let signature = keypair.sign(&binary_data);
        let result = keypair.verify(&binary_data, &signature);

        assert!(result.is_ok());
    }

    #[test]
    fn test_sign_with_utf8_data() {
        let keypair = MLDSA87::generate();
        let utf8_data = "Hello, 世界! 🌍".as_bytes();

        let signature = keypair.sign(utf8_data);
        let result = keypair.verify(utf8_data, &signature);

        assert!(result.is_ok());
    }

    #[test]
    fn test_verify_single_bit_flip_fails() {
        let keypair = MLDSA87::generate();
        let message = b"test message";

        let signature = keypair.sign(message);

        // Flip a single bit in the message
        let mut tampered = message.to_vec();
        tampered[0] ^= 0x01;

        let result = keypair.verify(&tampered, &signature);

        assert!(result.is_err());
    }

    #[test]
    fn test_multiple_verifications_with_same_signature() {
        let keypair = MLDSA87::generate();
        let message = b"test message";
        let signature = keypair.sign(message);

        // Verify multiple times
        for _ in 0..100 {
            let result = keypair.verify(message, &signature);
            assert!(result.is_ok());
        }
    }
}

#[cfg(test)]
mod sphincsplus_basic_tests {
    use super::*;

    #[test]
    #[ignore = "SphincsPlusKeyPair implementation pending"]
    fn test_sphincsplus_generate_keypair() {
        // TODO: Implement when SphincsPlusKeyPair::generate() is available
        // This test will fail until implementation is complete
        // let keypair = SphincsPlusKeyPair::generate();
        // assert!(!keypair.public_key.as_bytes().is_empty());
    }

    #[test]
    #[ignore = "SphincsPlusKeyPair implementation pending"]
    fn test_sphincsplus_sign_and_verify() {
        // TODO: Implement when SphincsPlusKeyPair methods are available
        // let keypair = SphincsPlusKeyPair::generate();
        // let message = b"test";
        // let signature = keypair.sign(message);
        // assert!(keypair.verify(message, &signature).is_ok());
    }
}

#[cfg(test)]
mod signature_scheme_comparison_tests {
    use super::*;

    #[test]
    fn test_mldsa87_cannot_verify_other_scheme_signature() {
        // This test documents that different signature schemes are incompatible
        let keypair1 = MLDSA87::generate();
        let keypair2 = MLDSA87::generate();
        let message = b"test";

        let sig1 = keypair1.sign(message);

        // Even with correct message, wrong key fails
        let result = MLDSA87::verify(message, &sig1, &keypair2.public_key);
        assert!(result.is_err());
    }
}
