//! Comprehensive TDD tests for CryptoError types
//!
//! Following London School TDD (mock-driven):
//! - Test all error variants
//! - Test error messages and formatting
//! - Test error conversions and propagation

use cretoai_crypto::error::{CryptoError, Result};

#[cfg(test)]
mod error_construction_tests {
    use super::*;

    #[test]
    fn test_key_generation_error() {
        let error = CryptoError::KeyGeneration("insufficient entropy".to_string());
        assert_eq!(
            error.to_string(),
            "Key generation failed: insufficient entropy"
        );
    }

    #[test]
    fn test_signature_generation_error() {
        let error = CryptoError::SignatureGeneration("invalid key".to_string());
        assert_eq!(
            error.to_string(),
            "Signature generation failed: invalid key"
        );
    }

    #[test]
    fn test_signature_verification_error_with_message() {
        let error = CryptoError::SignatureVerification("tampered data".to_string());
        assert_eq!(
            error.to_string(),
            "Signature verification failed: tampered data"
        );
    }

    #[test]
    fn test_signature_verification_failed_no_details() {
        let error = CryptoError::SignatureVerificationFailed;
        assert_eq!(error.to_string(), "Signature verification failed");
    }

    #[test]
    fn test_encryption_error() {
        let error = CryptoError::Encryption("key size mismatch".to_string());
        assert_eq!(error.to_string(), "Encryption failed: key size mismatch");
    }

    #[test]
    fn test_decryption_error() {
        let error = CryptoError::Decryption("corrupted ciphertext".to_string());
        assert_eq!(
            error.to_string(),
            "Decryption failed: corrupted ciphertext"
        );
    }

    #[test]
    fn test_hashing_error() {
        let error = CryptoError::Hashing("invalid input length".to_string());
        assert_eq!(
            error.to_string(),
            "Hash computation failed: invalid input length"
        );
    }

    #[test]
    fn test_invalid_key_error() {
        let error = CryptoError::InvalidKey("malformed key data".to_string());
        assert_eq!(error.to_string(), "Invalid key format: malformed key data");
    }

    #[test]
    fn test_invalid_public_key_error() {
        let error = CryptoError::InvalidPublicKey;
        assert_eq!(error.to_string(), "Invalid public key");
    }

    #[test]
    fn test_invalid_secret_key_error() {
        let error = CryptoError::InvalidSecretKey;
        assert_eq!(error.to_string(), "Invalid secret key");
    }

    #[test]
    fn test_invalid_signature_error() {
        let error = CryptoError::InvalidSignature("wrong length".to_string());
        assert_eq!(error.to_string(), "Invalid signature format: wrong length");
    }

    #[test]
    fn test_invalid_ciphertext_error() {
        let error = CryptoError::InvalidCiphertext;
        assert_eq!(error.to_string(), "Invalid ciphertext");
    }

    #[test]
    fn test_key_storage_error() {
        let error = CryptoError::KeyStorageError;
        assert_eq!(error.to_string(), "Key storage error");
    }

    #[test]
    fn test_key_retrieval_error() {
        let error = CryptoError::KeyRetrievalError;
        assert_eq!(error.to_string(), "Key retrieval error");
    }

    #[test]
    fn test_key_not_found_error() {
        let error = CryptoError::KeyNotFound;
        assert_eq!(error.to_string(), "Key not found");
    }

    #[test]
    fn test_deserialization_error() {
        let error = CryptoError::Deserialization("invalid JSON".to_string());
        assert_eq!(
            error.to_string(),
            "Key deserialization failed: invalid JSON"
        );
    }

    #[test]
    fn test_serialization_error() {
        let error = CryptoError::Serialization("buffer overflow".to_string());
        assert_eq!(
            error.to_string(),
            "Key serialization failed: buffer overflow"
        );
    }

    #[test]
    fn test_random_generation_error() {
        let error = CryptoError::RandomGeneration("RNG failure".to_string());
        assert_eq!(
            error.to_string(),
            "Random number generation failed: RNG failure"
        );
    }

    #[test]
    fn test_generic_crypto_error() {
        let error = CryptoError::Generic("unknown error".to_string());
        assert_eq!(error.to_string(), "Cryptographic error: unknown error");
    }
}

#[cfg(test)]
mod error_result_tests {
    use super::*;

    fn returns_key_generation_error() -> Result<()> {
        Err(CryptoError::KeyGeneration("test error".to_string()))
    }

    fn returns_signature_verification_error() -> Result<bool> {
        Err(CryptoError::SignatureVerificationFailed)
    }

    fn returns_ok_result() -> Result<Vec<u8>> {
        Ok(vec![1, 2, 3, 4])
    }

    #[test]
    fn test_result_type_error_propagation() {
        let result = returns_key_generation_error();
        assert!(result.is_err());

        if let Err(e) = result {
            match e {
                CryptoError::KeyGeneration(msg) => {
                    assert_eq!(msg, "test error");
                }
                _ => panic!("Expected KeyGeneration error"),
            }
        }
    }

    #[test]
    fn test_result_type_ok_value() {
        let result = returns_ok_result();
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), vec![1, 2, 3, 4]);
    }

    #[test]
    fn test_result_type_verification_error() {
        let result = returns_signature_verification_error();
        assert!(result.is_err());
    }

    #[test]
    fn test_error_chain_propagation() {
        fn inner_function() -> Result<()> {
            Err(CryptoError::KeyNotFound)
        }

        fn outer_function() -> Result<()> {
            inner_function()?;
            Ok(())
        }

        let result = outer_function();
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), CryptoError::KeyNotFound));
    }
}

#[cfg(test)]
mod error_debug_tests {
    use super::*;

    #[test]
    fn test_error_debug_formatting() {
        let error = CryptoError::Encryption("test".to_string());
        let debug_str = format!("{:?}", error);
        assert!(debug_str.contains("Encryption"));
    }

    #[test]
    fn test_error_is_send_sync() {
        fn assert_send<T: Send>() {}
        fn assert_sync<T: Sync>() {}

        assert_send::<CryptoError>();
        assert_sync::<CryptoError>();
    }

    #[test]
    fn test_error_is_std_error() {
        use std::error::Error;

        let error = CryptoError::Generic("test".to_string());
        let _: &dyn Error = &error;
    }
}

#[cfg(test)]
mod error_matching_tests {
    use super::*;

    #[test]
    fn test_pattern_matching_specific_errors() {
        let errors = vec![
            CryptoError::KeyNotFound,
            CryptoError::InvalidPublicKey,
            CryptoError::KeyStorageError,
            CryptoError::SignatureVerificationFailed,
        ];

        for error in errors {
            match error {
                CryptoError::KeyNotFound => assert!(true),
                CryptoError::InvalidPublicKey => assert!(true),
                CryptoError::KeyStorageError => assert!(true),
                CryptoError::SignatureVerificationFailed => assert!(true),
                _ => panic!("Unexpected error variant"),
            }
        }
    }

    #[test]
    fn test_error_categorization() {
        fn is_key_error(error: &CryptoError) -> bool {
            matches!(
                error,
                CryptoError::InvalidKey(_)
                    | CryptoError::InvalidPublicKey
                    | CryptoError::InvalidSecretKey
                    | CryptoError::KeyNotFound
                    | CryptoError::KeyStorageError
                    | CryptoError::KeyRetrievalError
                    | CryptoError::KeyGeneration(_)
            )
        }

        assert!(is_key_error(&CryptoError::InvalidPublicKey));
        assert!(is_key_error(&CryptoError::KeyNotFound));
        assert!(!is_key_error(&CryptoError::SignatureVerificationFailed));
    }
}
