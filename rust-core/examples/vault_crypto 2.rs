//! Vault ↔ Crypto Integration Example
//!
//! Demonstrates quantum-resistant encryption in the Vigilia AI Vault using ML-KEM-768.
//!
//! This example showcases:
//! 1. Quantum-resistant encryption with ML-KEM-768 + BLAKE3
//! 2. BLAKE3 keyed encryption (lighter alternative)
//! 3. Key management and rotation
//! 4. Serialization and deserialization of encrypted data
//! 5. Comparison of different encryption algorithms
//!
//! ## Quantum-Resistant Security
//!
//! ```text
//! ┌──────────────────────────────────────────────┐
//! │    Plaintext: "Secret vault data"            │
//! └──────────────────┬───────────────────────────┘
//!                    │
//!                    ▼
//!          ┌─────────────────────┐
//!          │   ML-KEM-768 KEM    │
//!          │ Encapsulate(PubKey) │
//!          └─────────┬───────────┘
//!                    │
//!         ┌──────────┴──────────┐
//!         │                     │
//!         ▼                     ▼
//!   [Shared Secret]    [Encapsulated Key]
//!         │                     │
//!         │                     │
//!         ▼                     │
//!    BLAKE3 Keyed Hash          │
//!    (Key Derivation)           │
//!         │                     │
//!         ▼                     │
//!    [Encryption Key]           │
//!         │                     │
//!         ▼                     │
//!    BLAKE3 Keystream           │
//!         │                     │
//!         ▼                     │
//!    XOR with Plaintext         │
//!         │                     │
//!         └──────────┬──────────┘
//!                    │
//!                    ▼
//!           [Encrypted Output]
//!      {ciphertext, encapsulated_key}
//! ```
//!
//! Run with:
//! ```bash
//! cargo run --example vault_crypto
//! ```

use std::time::Duration;
use cretoai_crypto::hash::BLAKE3Hash;
use cretoai_vault::{
    crypto_integration::{EncryptedData, QuantumResistantEncryption},
    keys::{EncryptionAlgorithm, EncryptionKey},
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🔐 Vigilia AI - Vault ↔ Crypto Integration Demo\n");

    // ========================================
    // Part 1: Quantum-Resistant Encryption
    // ========================================
    println!("📦 Part 1: ML-KEM-768 + BLAKE3 Quantum-Resistant Encryption\n");

    // Create quantum-resistant encryption instance
    let qr_crypto = QuantumResistantEncryption::new()?;
    println!("✓ Created ML-KEM-768 keypair for quantum-resistant encryption");
    println!("  - Public key size: {} bytes", qr_crypto.public_key().len());
    println!("  - Security level: NIST Level 3 (equivalent to AES-192)");
    println!("  - Quantum resistance: Yes (NIST FIPS 203 ML-KEM-768)\n");

    // Encrypt sensitive data
    let secret_data = b"Classified: AI agent credentials for production deployment";
    println!("📝 Original secret data:");
    println!("   \"{}\"", String::from_utf8_lossy(secret_data));
    println!("   Length: {} bytes\n", secret_data.len());

    let encrypted = qr_crypto.encrypt(secret_data)?;
    println!("🔒 Encrypted with ML-KEM-768:");
    println!("   - Ciphertext length: {} bytes", encrypted.ciphertext.len());
    println!(
        "   - Encapsulated key size: {} bytes (ML-KEM-768 ciphertext)",
        encrypted.encapsulated_key.len()
    );
    println!("   - Total encrypted size: {} bytes",
        encrypted.ciphertext.len() + encrypted.encapsulated_key.len());

    // Show that ciphertext is different
    println!("\n   First 32 bytes of ciphertext (hex):");
    print!("   ");
    for byte in &encrypted.ciphertext[..32.min(encrypted.ciphertext.len())] {
        print!("{:02x}", byte);
    }
    println!("\n");

    // Decrypt
    let decrypted = qr_crypto.decrypt(&encrypted)?;
    println!("🔓 Decrypted successfully:");
    println!("   \"{}\"", String::from_utf8_lossy(&decrypted));
    println!("   ✅ Data matches original: {}\n", decrypted == secret_data);

    // ========================================
    // Part 2: Serialization Test
    // ========================================
    println!("═══════════════════════════════════════════════════════════\n");
    println!("📦 Part 2: Serialization and Deserialization\n");

    // Serialize to JSON
    let json = serde_json::to_string_pretty(&encrypted)?;
    println!("📄 Encrypted data serialized to JSON:");
    println!("{}\n", json);

    // Deserialize back
    let deserialized: EncryptedData = serde_json::from_str(&json)?;
    let decrypted_from_json = qr_crypto.decrypt(&deserialized)?;
    println!("✅ Deserialized and decrypted successfully");
    println!("   Matches original: {}\n", decrypted_from_json == secret_data);

    // ========================================
    // Part 3: Multiple Encryptions
    // ========================================
    println!("═══════════════════════════════════════════════════════════\n");
    println!("📦 Part 3: Randomized Encryption (Same Input → Different Outputs)\n");

    let test_message = b"Test message for randomization";
    let encrypted1 = qr_crypto.encrypt(test_message)?;
    let encrypted2 = qr_crypto.encrypt(test_message)?;
    let encrypted3 = qr_crypto.encrypt(test_message)?;

    println!("Encrypted same message 3 times:");
    println!("  Encryption 1 - Encapsulated key (first 16 bytes): {:02x?}", &encrypted1.encapsulated_key[..16]);
    println!("  Encryption 2 - Encapsulated key (first 16 bytes): {:02x?}", &encrypted2.encapsulated_key[..16]);
    println!("  Encryption 3 - Encapsulated key (first 16 bytes): {:02x?}", &encrypted3.encapsulated_key[..16]);

    println!("\n✅ Each encryption produces unique encapsulated key (randomized KEM)");
    println!("   Encryption 1 ≠ Encryption 2: {}", encrypted1.encapsulated_key != encrypted2.encapsulated_key);
    println!("   Encryption 2 ≠ Encryption 3: {}", encrypted2.encapsulated_key != encrypted3.encapsulated_key);

    // Verify all decrypt to same plaintext
    let decrypt1 = qr_crypto.decrypt(&encrypted1)?;
    let decrypt2 = qr_crypto.decrypt(&encrypted2)?;
    let decrypt3 = qr_crypto.decrypt(&encrypted3)?;

    println!("\n✅ All decryptions produce original plaintext");
    println!("   All match: {}", decrypt1 == test_message && decrypt2 == test_message && decrypt3 == test_message);

    // ========================================
    // Part 4: BLAKE3 Keyed Encryption
    // ========================================
    println!("\n═══════════════════════════════════════════════════════════\n");
    println!("📦 Part 4: BLAKE3 Keyed Encryption (Lighter Alternative)\n");

    // Create BLAKE3 encryption key
    let blake3_key = EncryptionKey::new(
        "blake3-test-key".to_string(),
        EncryptionAlgorithm::Blake3Keyed,
        "BLAKE3 vault encryption".to_string(),
    )?;

    println!("✓ Created BLAKE3 encryption key");
    println!("  - Algorithm: {:?}", blake3_key.metadata.algorithm);
    println!("  - Purpose: {}", blake3_key.metadata.purpose);
    println!("  - Key ID: {}\n", blake3_key.metadata.id);

    // Encrypt with BLAKE3
    let blake3_plaintext = b"Data encrypted with BLAKE3 keyed mode for faster symmetric encryption";
    println!("📝 Original data: \"{}\"", String::from_utf8_lossy(blake3_plaintext));

    let blake3_ciphertext = blake3_key.encrypt(blake3_plaintext)?;
    println!("\n🔒 BLAKE3 encrypted:");
    println!("   - Ciphertext length: {} bytes", blake3_ciphertext.len());
    println!("   - First 32 bytes (hex): ", );
    for byte in &blake3_ciphertext[..32] {
        print!("{:02x}", byte);
    }
    println!("\n");

    // Decrypt with BLAKE3
    let blake3_decrypted = blake3_key.decrypt(&blake3_ciphertext)?;
    println!("🔓 BLAKE3 decrypted:");
    println!("   \"{}\"", String::from_utf8_lossy(&blake3_decrypted));
    println!("   ✅ Matches original: {}\n", blake3_decrypted == blake3_plaintext);

    // ========================================
    // Part 5: Large Data Test
    // ========================================
    println!("═══════════════════════════════════════════════════════════\n");
    println!("📦 Part 5: Large Data Encryption (Performance Test)\n");

    // Test with 100 KB of data
    let large_data = vec![0xABu8; 100 * 1024];
    println!("Testing with {} KB of data", large_data.len() / 1024);

    // ML-KEM-768 encryption
    let start = std::time::Instant::now();
    let large_encrypted = qr_crypto.encrypt(&large_data)?;
    let mlkem_encrypt_time = start.elapsed();

    let start = std::time::Instant::now();
    let large_decrypted = qr_crypto.decrypt(&large_encrypted)?;
    let mlkem_decrypt_time = start.elapsed();

    println!("\n🔒 ML-KEM-768 Performance:");
    println!("   - Encryption time: {:?}", mlkem_encrypt_time);
    println!("   - Decryption time: {:?}", mlkem_decrypt_time);
    println!("   - Encrypted size: {} KB", (large_encrypted.ciphertext.len() + large_encrypted.encapsulated_key.len()) / 1024);
    println!("   - ✅ Data integrity: {}", large_decrypted == large_data);

    // BLAKE3 encryption for comparison
    let start = std::time::Instant::now();
    let blake3_large_encrypted = blake3_key.encrypt(&large_data)?;
    let blake3_encrypt_time = start.elapsed();

    let start = std::time::Instant::now();
    let blake3_large_decrypted = blake3_key.decrypt(&blake3_large_encrypted)?;
    let blake3_decrypt_time = start.elapsed();

    println!("\n🔒 BLAKE3 Performance:");
    println!("   - Encryption time: {:?}", blake3_encrypt_time);
    println!("   - Decryption time: {:?}", blake3_decrypt_time);
    println!("   - Encrypted size: {} KB", blake3_large_encrypted.len() / 1024);
    println!("   - ✅ Data integrity: {}", blake3_large_decrypted == large_data);

    // ========================================
    // Part 6: Key Recommendations
    // ========================================
    println!("\n═══════════════════════════════════════════════════════════\n");
    println!("📚 Key Recommendations:\n");

    println!("🔐 ML-KEM-768 + BLAKE3 (Quantum-Resistant):");
    println!("   ✅ Use for: Long-term secret storage, high-security credentials");
    println!("   ✅ Benefits: Post-quantum security, NIST standardized");
    println!("   ⚠️  Trade-offs: Larger ciphertext size, slightly slower\n");

    println!("⚡ BLAKE3 Keyed Mode:");
    println!("   ✅ Use for: High-performance symmetric encryption, session data");
    println!("   ✅ Benefits: Fast, compact ciphertext, quantum-resistant hashing");
    println!("   ⚠️  Trade-offs: Requires secure key distribution\n");

    println!("🎯 Classical (AES-256-GCM, ChaCha20-Poly1305):");
    println!("   ✅ Use for: Legacy compatibility, short-term data");
    println!("   ✅ Benefits: Widely supported, battle-tested");
    println!("   ⚠️  Trade-offs: Vulnerable to future quantum attacks\n");

    println!("═══════════════════════════════════════════════════════════\n");
    println!("✅ Vault ↔ Crypto integration demo completed successfully!\n");
    println!("Key Features Demonstrated:");
    println!("  • ML-KEM-768 quantum-resistant encryption");
    println!("  • BLAKE3 keyed encryption");
    println!("  • Serialization/deserialization");
    println!("  • Large data handling");
    println!("  • Performance comparison");
    println!("  • Security recommendations\n");

    Ok(())
}
