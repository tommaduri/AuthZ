//! Bandwidth throttling and rate limiting

use parking_lot::Mutex;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::time::sleep;
use tracing::debug;

/// Bandwidth limiter using token bucket algorithm
pub struct BandwidthLimiter {
    /// Maximum bytes per second
    max_bps: u64,

    /// Current tokens (bytes available)
    tokens: Arc<Mutex<f64>>,

    /// Last refill time
    last_refill: Arc<Mutex<Instant>>,
}

impl BandwidthLimiter {
    /// Create a new bandwidth limiter
    pub fn new(max_bps: u64) -> Self {
        Self {
            max_bps,
            tokens: Arc::new(Mutex::new(max_bps as f64)),
            last_refill: Arc::new(Mutex::new(Instant::now())),
        }
    }

    /// Wait until sufficient bandwidth is available
    pub async fn wait_for_bandwidth(&self, bytes: usize) {
        loop {
            self.refill_tokens();

            let mut tokens = self.tokens.lock();

            if *tokens >= bytes as f64 {
                *tokens -= bytes as f64;
                debug!("Consumed {} bytes, {} tokens remaining", bytes, tokens);
                break;
            }

            // Calculate wait time
            let deficit = bytes as f64 - *tokens;
            let wait_ms = (deficit / self.max_bps as f64 * 1000.0) as u64;

            drop(tokens);

            debug!("Bandwidth limit reached, waiting {}ms", wait_ms);
            sleep(Duration::from_millis(wait_ms.max(1))).await;
        }
    }

    /// Check if bandwidth is available without waiting
    pub fn try_consume(&self, bytes: usize) -> bool {
        self.refill_tokens();

        let mut tokens = self.tokens.lock();

        if *tokens >= bytes as f64 {
            *tokens -= bytes as f64;
            true
        } else {
            false
        }
    }

    /// Refill token bucket based on elapsed time
    fn refill_tokens(&self) {
        let mut last_refill = self.last_refill.lock();
        let now = Instant::now();
        let elapsed = now.duration_since(*last_refill);

        if elapsed.as_millis() > 0 {
            let new_tokens = (elapsed.as_secs_f64() * self.max_bps as f64).min(self.max_bps as f64);

            let mut tokens = self.tokens.lock();
            *tokens = (*tokens + new_tokens).min(self.max_bps as f64);

            *last_refill = now;
        }
    }

    /// Get current bandwidth usage as percentage
    pub fn get_usage(&self) -> f64 {
        self.refill_tokens();
        let tokens = self.tokens.lock();
        ((self.max_bps as f64 - *tokens) / self.max_bps as f64 * 100.0).max(0.0)
    }

    /// Reset limiter
    pub fn reset(&self) {
        *self.tokens.lock() = self.max_bps as f64;
        *self.last_refill.lock() = Instant::now();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_bandwidth_limiting() {
        let limiter = BandwidthLimiter::new(1000); // 1KB/s

        // Should consume immediately
        assert!(limiter.try_consume(500));

        // Should consume remaining
        assert!(limiter.try_consume(500));

        // Should fail (no tokens left)
        assert!(!limiter.try_consume(100));

        // Wait for refill
        tokio::time::sleep(Duration::from_secs(1)).await;

        // Should succeed after refill
        assert!(limiter.try_consume(1000));
    }

    #[tokio::test]
    async fn test_async_bandwidth_wait() {
        let limiter = BandwidthLimiter::new(1000); // 1KB/s

        let start = Instant::now();

        // Consume 3KB (should take ~2 seconds)
        limiter.wait_for_bandwidth(1000).await;
        limiter.wait_for_bandwidth(1000).await;
        limiter.wait_for_bandwidth(1000).await;

        let elapsed = start.elapsed();
        assert!(elapsed.as_secs() >= 2);
    }
}
