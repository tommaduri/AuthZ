use std::collections::{VecDeque, HashMap};
use std::sync::Arc;
use std::time::{Duration, Instant};
use parking_lot::RwLock;
use tokio::sync::Semaphore;
use tracing::{debug, warn, info};

use crate::circuit_breaker::{CircuitBreaker, CircuitState};
use crate::error::ConsensusError;

/// Request that's queued for retry when circuit is open
#[derive(Debug, Clone)]
pub struct PendingRequest {
    pub id: String,
    pub peer_id: String,
    pub payload: Vec<u8>,
    pub queued_at: Instant,
    pub retry_count: usize,
    pub priority: RequestPriority,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum RequestPriority {
    Low = 0,
    Medium = 1,
    High = 2,
    Critical = 3,
}

/// Configuration for fallback behavior
#[derive(Debug, Clone)]
pub struct FallbackConfig {
    /// Maximum size of the retry queue
    pub max_queue_size: usize,
    /// Maximum time a request can stay in queue
    pub max_queue_time: Duration,
    /// Maximum retry attempts per request
    pub max_retries: usize,
    /// Whether to enable automatic peer failover
    pub enable_peer_failover: bool,
    /// Number of alternative peers to try
    pub failover_peer_count: usize,
}

impl Default for FallbackConfig {
    fn default() -> Self {
        Self {
            max_queue_size: 1000,
            max_queue_time: Duration::from_secs(300), // 5 minutes
            max_retries: 3,
            enable_peer_failover: true,
            failover_peer_count: 3,
        }
    }
}

/// Response from fallback handling
#[derive(Debug)]
pub enum FallbackResponse {
    /// Request was queued for later retry
    Queued { request_id: String, position: usize },
    /// Request was forwarded to alternative peer
    Forwarded { alternative_peer: String },
    /// Degraded mode response (partial success)
    Degraded { data: Vec<u8>, warnings: Vec<String> },
    /// Request rejected (queue full, too many retries, etc.)
    Rejected { reason: String },
}

/// Fallback strategy handler for when circuit breakers are open
#[derive(Clone)]
pub struct FallbackStrategy {
    config: FallbackConfig,
    queue: Arc<RwLock<VecDeque<PendingRequest>>>,
    peer_health: Arc<RwLock<HashMap<String, PeerHealthInfo>>>,
    retry_semaphore: Arc<Semaphore>,
}

#[derive(Debug, Clone)]
struct PeerHealthInfo {
    success_count: usize,
    failure_count: usize,
    last_success: Option<Instant>,
    last_failure: Option<Instant>,
    avg_latency_ms: f64,
}

impl PeerHealthInfo {
    fn new() -> Self {
        Self {
            success_count: 0,
            failure_count: 0,
            last_success: None,
            last_failure: None,
            avg_latency_ms: 0.0,
        }
    }

    fn health_score(&self) -> f64 {
        let total = self.success_count + self.failure_count;
        if total == 0 {
            return 0.5; // Unknown health
        }

        let success_rate = self.success_count as f64 / total as f64;

        // Factor in recency
        let recency_bonus = match (&self.last_success, &self.last_failure) {
            (Some(success), Some(failure)) => {
                if success > failure { 0.1 } else { -0.1 }
            }
            (Some(_), None) => 0.1,
            (None, Some(_)) => -0.1,
            _ => 0.0,
        };

        // Factor in latency (prefer lower latency)
        let latency_factor = if self.avg_latency_ms > 0.0 {
            1.0 / (1.0 + (self.avg_latency_ms / 1000.0))
        } else {
            1.0
        };

        (success_rate + recency_bonus) * latency_factor
    }
}

impl FallbackStrategy {
    pub fn new(config: FallbackConfig) -> Self {
        let max_concurrent_retries = config.max_queue_size / 10;

        Self {
            config,
            queue: Arc::new(RwLock::new(VecDeque::new())),
            peer_health: Arc::new(RwLock::new(HashMap::new())),
            retry_semaphore: Arc::new(Semaphore::new(max_concurrent_retries)),
        }
    }

    /// Handle a request when the circuit is open
    pub async fn handle_open_circuit(
        &self,
        request: PendingRequest,
        alternative_peers: &[String],
    ) -> Result<FallbackResponse, ConsensusError> {
        // Check if we should try an alternative peer
        if self.config.enable_peer_failover && !alternative_peers.is_empty() {
            if let Some(alternative) = self.select_best_peer(alternative_peers) {
                info!(
                    "Forwarding request {} to alternative peer {}",
                    request.id, alternative
                );
                return Ok(FallbackResponse::Forwarded {
                    alternative_peer: alternative,
                });
            }
        }

        // Try to queue the request
        self.queue_request(request)
    }

    /// Queue a request for later retry
    fn queue_request(&self, request: PendingRequest) -> Result<FallbackResponse, ConsensusError> {
        let mut queue = self.queue.write();

        // Check queue size
        if queue.len() >= self.config.max_queue_size {
            // Try to evict old or low-priority requests
            self.evict_old_requests(&mut queue);

            if queue.len() >= self.config.max_queue_size {
                return Ok(FallbackResponse::Rejected {
                    reason: "Queue full".to_string(),
                });
            }
        }

        // Check retry limit
        if request.retry_count >= self.config.max_retries {
            return Ok(FallbackResponse::Rejected {
                reason: format!(
                    "Max retries ({}) exceeded",
                    self.config.max_retries
                ),
            });
        }

        // Insert in priority order
        let position = self.insert_by_priority(&mut queue, request.clone());

        debug!(
            "Queued request {} at position {} (priority: {:?})",
            request.id, position, request.priority
        );

        Ok(FallbackResponse::Queued {
            request_id: request.id,
            position,
        })
    }

    /// Retry queued requests when circuit recovers
    pub async fn retry_queued(
        &self,
        circuit: &CircuitBreaker,
    ) -> Vec<Result<(), ConsensusError>> {
        // Only retry if circuit is closed or half-open
        match circuit.get_state() {
            CircuitState::Open => return vec![],
            _ => {}
        }

        let mut results = Vec::new();
        let max_batch = 10; // Process in batches to avoid overwhelming

        for _ in 0..max_batch {
            let request = {
                let mut queue = self.queue.write();
                queue.pop_front()
            };

            if let Some(mut req) = request {
                // Check if request is too old
                if req.queued_at.elapsed() > self.config.max_queue_time {
                    warn!("Dropping expired request {}", req.id);
                    results.push(Err(ConsensusError::Timeout(
                        "Request expired in queue".to_string()
                    )));
                    continue;
                }

                // Acquire semaphore to limit concurrent retries
                if let Ok(_permit) = self.retry_semaphore.try_acquire() {
                    req.retry_count += 1;
                    info!(
                        "Retrying request {} (attempt {})",
                        req.id, req.retry_count
                    );

                    // The actual retry logic would be handled by the caller
                    // Here we just return the request needs retry
                    results.push(Ok(()));
                } else {
                    // Put back in queue if we can't retry now
                    let mut queue = self.queue.write();
                    queue.push_front(req);
                    break;
                }
            } else {
                break;
            }
        }

        results
    }

    /// Select the best alternative peer based on health scores
    pub fn select_best_peer(&self, candidates: &[String]) -> Option<String> {
        if candidates.is_empty() {
            return None;
        }

        let health = self.peer_health.read();

        let mut best_peer: Option<(String, f64)> = None;

        for peer_id in candidates {
            let score = health
                .get(peer_id)
                .map(|h| h.health_score())
                .unwrap_or(0.5); // Unknown peers get neutral score

            match &best_peer {
                None => best_peer = Some((peer_id.clone(), score)),
                Some((_, best_score)) => {
                    if score > *best_score {
                        best_peer = Some((peer_id.clone(), score));
                    }
                }
            }
        }

        best_peer.map(|(peer, _)| peer)
    }

    /// Select multiple alternative peers in priority order
    pub fn select_alternative_peers(
        &self,
        failed_peer: &str,
        all_peers: &[String],
    ) -> Vec<String> {
        let mut candidates: Vec<_> = all_peers
            .iter()
            .filter(|p| p.as_str() != failed_peer)
            .cloned()
            .collect();

        let health = self.peer_health.read();

        // Sort by health score
        candidates.sort_by(|a, b| {
            let score_a = health.get(a).map(|h| h.health_score()).unwrap_or(0.5);
            let score_b = health.get(b).map(|h| h.health_score()).unwrap_or(0.5);
            score_b.partial_cmp(&score_a).unwrap_or(std::cmp::Ordering::Equal)
        });

        // Return top N
        candidates
            .into_iter()
            .take(self.config.failover_peer_count)
            .collect()
    }

    /// Update peer health information
    pub fn record_peer_success(&self, peer_id: &str, latency: Duration) {
        let mut health = self.peer_health.write();
        let info = health.entry(peer_id.to_string()).or_insert_with(PeerHealthInfo::new);

        info.success_count += 1;
        info.last_success = Some(Instant::now());

        // Update rolling average latency
        let latency_ms = latency.as_millis() as f64;
        if info.avg_latency_ms == 0.0 {
            info.avg_latency_ms = latency_ms;
        } else {
            // Exponential moving average
            info.avg_latency_ms = info.avg_latency_ms * 0.9 + latency_ms * 0.1;
        }
    }

    pub fn record_peer_failure(&self, peer_id: &str) {
        let mut health = self.peer_health.write();
        let info = health.entry(peer_id.to_string()).or_insert_with(PeerHealthInfo::new);

        info.failure_count += 1;
        info.last_failure = Some(Instant::now());
    }

    /// Get current queue size
    pub fn queue_size(&self) -> usize {
        self.queue.read().len()
    }

    /// Get queue statistics
    pub fn get_queue_stats(&self) -> QueueStats {
        let queue = self.queue.read();

        let mut priority_counts = HashMap::new();
        let mut oldest_age = Duration::from_secs(0);
        let now = Instant::now();

        for req in queue.iter() {
            *priority_counts.entry(req.priority).or_insert(0) += 1;
            let age = now.duration_since(req.queued_at);
            if age > oldest_age {
                oldest_age = age;
            }
        }

        QueueStats {
            total_size: queue.len(),
            priority_counts,
            oldest_request_age: oldest_age,
        }
    }

    /// Clear the queue
    pub fn clear_queue(&self) -> usize {
        let mut queue = self.queue.write();
        let count = queue.len();
        queue.clear();
        count
    }

    // Helper functions
    fn insert_by_priority(&self, queue: &mut VecDeque<PendingRequest>, request: PendingRequest) -> usize {
        // Find insertion point based on priority (higher priority first)
        let pos = queue
            .iter()
            .position(|r| r.priority < request.priority)
            .unwrap_or(queue.len());

        queue.insert(pos, request);
        pos
    }

    fn evict_old_requests(&self, queue: &mut VecDeque<PendingRequest>) {
        let now = Instant::now();
        queue.retain(|req| {
            let age = now.duration_since(req.queued_at);
            age < self.config.max_queue_time
        });
    }
}

#[derive(Debug, Clone)]
pub struct QueueStats {
    pub total_size: usize,
    pub priority_counts: HashMap<RequestPriority, usize>,
    pub oldest_request_age: Duration,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_peer_health_score() {
        let mut info = PeerHealthInfo::new();

        // No data
        assert_eq!(info.health_score(), 0.5);

        // All successes
        info.success_count = 10;
        assert!(info.health_score() > 0.5);

        // Mixed results
        info.failure_count = 5;
        let score = info.health_score();
        assert!(score > 0.0 && score < 1.0);
    }

    #[tokio::test]
    async fn test_queue_request() {
        let strategy = FallbackStrategy::new(FallbackConfig::default());

        let request = PendingRequest {
            id: "req1".to_string(),
            peer_id: "peer1".to_string(),
            payload: vec![1, 2, 3],
            queued_at: Instant::now(),
            retry_count: 0,
            priority: RequestPriority::High,
        };

        let response = strategy.queue_request(request).unwrap();

        match response {
            FallbackResponse::Queued { position, .. } => {
                assert_eq!(position, 0);
                assert_eq!(strategy.queue_size(), 1);
            }
            _ => panic!("Expected Queued response"),
        }
    }

    #[tokio::test]
    async fn test_priority_ordering() {
        let strategy = FallbackStrategy::new(FallbackConfig::default());

        // Add requests in different priority order
        let req_low = PendingRequest {
            id: "req1".to_string(),
            peer_id: "peer1".to_string(),
            payload: vec![],
            queued_at: Instant::now(),
            retry_count: 0,
            priority: RequestPriority::Low,
        };

        let req_high = PendingRequest {
            id: "req2".to_string(),
            peer_id: "peer1".to_string(),
            payload: vec![],
            queued_at: Instant::now(),
            retry_count: 0,
            priority: RequestPriority::High,
        };

        strategy.queue_request(req_low).unwrap();
        strategy.queue_request(req_high).unwrap();

        // High priority should be first
        let queue = strategy.queue.read();
        assert_eq!(queue[0].id, "req2");
        assert_eq!(queue[1].id, "req1");
    }

    #[test]
    fn test_select_best_peer() {
        let strategy = FallbackStrategy::new(FallbackConfig::default());

        // Record some health data
        strategy.record_peer_success("peer1", Duration::from_millis(10));
        strategy.record_peer_success("peer1", Duration::from_millis(12));

        strategy.record_peer_success("peer2", Duration::from_millis(50));
        strategy.record_peer_failure("peer2");
        strategy.record_peer_failure("peer2");

        let candidates = vec!["peer1".to_string(), "peer2".to_string()];
        let best = strategy.select_best_peer(&candidates);

        assert_eq!(best, Some("peer1".to_string()));
    }

    #[tokio::test]
    async fn test_queue_size_limit() {
        let config = FallbackConfig {
            max_queue_size: 5,
            ..Default::default()
        };
        let strategy = FallbackStrategy::new(config);

        // Fill queue
        for i in 0..5 {
            let request = PendingRequest {
                id: format!("req{}", i),
                peer_id: "peer1".to_string(),
                payload: vec![],
                queued_at: Instant::now(),
                retry_count: 0,
                priority: RequestPriority::Medium,
            };
            strategy.queue_request(request).unwrap();
        }

        // Next request should be rejected
        let request = PendingRequest {
            id: "req6".to_string(),
            peer_id: "peer1".to_string(),
            payload: vec![],
            queued_at: Instant::now(),
            retry_count: 0,
            priority: RequestPriority::Medium,
        };

        let response = strategy.queue_request(request).unwrap();
        assert!(matches!(response, FallbackResponse::Rejected { .. }));
    }

    #[tokio::test]
    async fn test_max_retries() {
        let config = FallbackConfig {
            max_retries: 2,
            ..Default::default()
        };
        let strategy = FallbackStrategy::new(config);

        let request = PendingRequest {
            id: "req1".to_string(),
            peer_id: "peer1".to_string(),
            payload: vec![],
            queued_at: Instant::now(),
            retry_count: 2, // Already at max
            priority: RequestPriority::Medium,
        };

        let response = strategy.queue_request(request).unwrap();
        assert!(matches!(response, FallbackResponse::Rejected { .. }));
    }
}
