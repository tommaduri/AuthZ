//! Debug utility to inspect certificate extensions

use cretoai_crypto::keys::AgentIdentity;
use cretoai_network::libp2p::quic::CertificateManager;
use std::sync::Arc;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Generate test identity
    let identity = Arc::new(AgentIdentity::generate("debug-test".to_string())?);

    // Generate certificate
    let cert_manager = CertificateManager::new(identity);
    let peer_cert = cert_manager.generate_self_signed()?;

    // Get DER bytes
    let der_bytes = peer_cert.serialize_der()?;

    println!("Certificate DER size: {} bytes", der_bytes.len());
    println!("\nSearching for 1184-byte sequences in certificate...\n");

    // Search for 1184-byte sequences
    for i in 0usize..der_bytes.len().saturating_sub(1184) {
        // Check if this could be the start of our ML-KEM key
        // Look for OCTET STRING tag (0x04) followed by length
        if der_bytes[i] == 0x04 {
            // Check various length encodings
            if i + 2 + 1184 <= der_bytes.len() {
                // Short form: 0x04 <len>
                if der_bytes[i + 1] == 0x82 && i + 4 + 1184 <= der_bytes.len() {
                    let len = ((der_bytes[i + 2] as usize) << 8) | (der_bytes[i + 3] as usize);
                    if len == 1184 {
                        println!("✅ Found ML-KEM key at offset {}", i);
                        println!("   Encoding: 0x04 0x82 {:02x} {:02x} (OCTET STRING, long form length, 1184 bytes)",
                                der_bytes[i + 2], der_bytes[i + 3]);
                        println!("   Key starts at offset: {}", i + 4);
                        println!("   First 16 bytes: {:02x?}", &der_bytes[i+4..i+20]);
                    }
                }
            }
        }

        // Also check for raw 1184-byte extension value
        if i + 1184 <= der_bytes.len() {
            // See if the bytes at this offset could be a valid ML-KEM key
            // (This is a heuristic - we're looking for the pattern)
            if i > 10 && der_bytes[i-10..i].contains(&0x04) {
                println!("Potential 1184-byte sequence at offset {}", i);
                println!("   Context (10 bytes before): {:02x?}", &der_bytes[i.saturating_sub(10)..i]);
            }
        }
    }

    println!("\n✅ Certificate generated successfully");
    if let Some(pubkey) = peer_cert.ml_kem_pubkey() {
        println!("✅ ML-KEM public key present: {} bytes", pubkey.as_bytes().len());
    } else {
        println!("❌ ML-KEM public key NOT present");
    }

    Ok(())
}
