//! API configuration

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct ApiConfig {
    /// Server bind address
    pub host: String,

    /// Server port
    pub port: u16,

    /// Log level (trace, debug, info, warn, error)
    pub log_level: String,
}

impl Default for ApiConfig {
    fn default() -> Self {
        Self {
            host: "0.0.0.0".to_string(),
            port: 8080,
            log_level: "info".to_string(),
        }
    }
}

impl ApiConfig {
    pub fn bind_address(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}
