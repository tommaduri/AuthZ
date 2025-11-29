//! NAT traversal implementation with STUN/TURN support

use crate::{
    error::{NetworkError, Result},
    TurnConfig,
};
use bytecodec::{DecodeExt, EncodeExt};
use std::net::SocketAddr;
use stun_codec::{
    rfc5389::{attributes::*, methods::BINDING, Attribute},
    MessageClass, MessageDecoder, MessageEncoder, Method, TransactionId,
};
use tokio::net::UdpSocket;
use tracing::{debug, error, info};

/// NAT traversal manager
pub struct NatTraversal {
    stun_servers: Vec<SocketAddr>,
    turn_servers: Vec<TurnConfig>,
}

impl NatTraversal {
    /// Create a new NAT traversal manager
    pub fn new(stun_servers: Vec<String>, turn_servers: Vec<TurnConfig>) -> Result<Self> {
        let stun_addrs: Vec<SocketAddr> = stun_servers
            .iter()
            .filter_map(|s| s.parse().ok())
            .collect();

        if stun_addrs.is_empty() {
            return Err(NetworkError::Stun("No valid STUN servers".to_string()));
        }

        Ok(Self {
            stun_servers: stun_addrs,
            turn_servers,
        })
    }

    /// Get external address using STUN
    pub async fn get_external_address(&self) -> Result<SocketAddr> {
        for server in &self.stun_servers {
            match self.stun_request(*server).await {
                Ok(addr) => {
                    info!("Discovered external address: {}", addr);
                    return Ok(addr);
                }
                Err(e) => {
                    error!("STUN request to {} failed: {}", server, e);
                    continue;
                }
            }
        }

        Err(NetworkError::Stun("All STUN servers failed".to_string()))
    }

    /// Perform STUN binding request
    async fn stun_request(&self, server: SocketAddr) -> Result<SocketAddr> {
        debug!("Sending STUN binding request to {}", server);

        // Create UDP socket
        let socket = UdpSocket::bind("0.0.0.0:0").await?;
        socket.connect(server).await?;

        // Build STUN binding request
        let transaction_id = TransactionId::new(rand::random());

        let message = stun_codec::Message::<Attribute>::new(
            MessageClass::Request,
            BINDING,
            transaction_id,
        );

        // Encode message
        let mut encoder = MessageEncoder::new();
        let bytes = encoder.encode_into_bytes(message.clone())
            .map_err(|e| NetworkError::Stun(format!("Encode error: {}", e)))?;

        // Send request
        socket.send(&bytes).await?;

        // Receive response
        let mut buf = [0u8; 1024];
        let (len, _) = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            socket.recv_from(&mut buf),
        )
        .await
        .map_err(|_| NetworkError::ConnectionTimeout)??;

        // Decode response
        let mut decoder = MessageDecoder::<Attribute>::new();
        let decoded = decoder.decode_from_bytes(&buf[..len].to_vec())
            .map_err(|e| NetworkError::Stun(format!("Decode error: {}", e)))?;
        let response = decoded
            .map_err(|e| NetworkError::Stun(format!("Decode error: {:?}", e)))?;

        // Extract mapped address
        for attr in response.attributes() {
            if let Attribute::XorMappedAddress(addr) = attr {
                return Ok(addr.address());
            }
            if let Attribute::MappedAddress(addr) = attr {
                return Ok(addr.address());
            }
        }

        Err(NetworkError::Stun("No mapped address in response".to_string()))
    }

    /// Establish TURN relay connection (placeholder - would need full TURN implementation)
    pub async fn relay_connection(&self, _peer: SocketAddr) -> Result<SocketAddr> {
        if self.turn_servers.is_empty() {
            return Err(NetworkError::Turn("No TURN servers configured".to_string()));
        }

        // This would implement full TURN protocol
        // For now, return error as placeholder
        Err(NetworkError::Turn("TURN not yet implemented".to_string()))
    }

    /// Perform UDP hole punching
    pub async fn punch_hole(&self, local_socket: &UdpSocket, peer: SocketAddr) -> Result<()> {
        debug!("Attempting hole punch to {}", peer);

        // Send multiple packets to punch through NAT
        for _ in 0..5 {
            local_socket.send_to(b"punch", peer).await?;
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }

        info!("Hole punching completed for {}", peer);

        Ok(())
    }

    /// Detect NAT type (cone, symmetric, etc.)
    pub async fn detect_nat_type(&self) -> Result<NatType> {
        // Get external address from first STUN server
        let server1 = self.stun_servers[0];
        let addr1 = self.stun_request(server1).await?;

        // If we have multiple STUN servers, check if external address changes
        if self.stun_servers.len() > 1 {
            let server2 = self.stun_servers[1];
            let addr2 = self.stun_request(server2).await?;

            if addr1 == addr2 {
                Ok(NatType::Cone)
            } else {
                Ok(NatType::Symmetric)
            }
        } else {
            Ok(NatType::Unknown)
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NatType {
    None,
    Cone,
    Symmetric,
    Unknown,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore] // Requires actual STUN server
    async fn test_stun_discovery() {
        let nat = NatTraversal::new(
            vec!["stun.l.google.com:19302".to_string()],
            vec![],
        ).unwrap();

        let addr = nat.get_external_address().await;
        assert!(addr.is_ok());

        if let Ok(addr) = addr {
            println!("External address: {}", addr);
        }
    }
}
