//! Prometheus metrics for consensus

use prometheus::{
    core::{AtomicU64, GenericCounter, GenericGauge},
    Histogram, HistogramOpts, IntCounter, IntGauge, Opts, Registry,
};
use std::sync::Arc;

/// Consensus metrics exposed to Prometheus
pub struct ConsensusMetrics {
    /// Total vertices proposed
    pub proposals_sent: IntCounter,

    /// Total vertices finalized
    pub vertices_finalized: IntCounter,

    /// Total prepare messages sent
    pub prepares_sent: IntCounter,

    /// Total prepare messages received
    pub prepares_received: IntCounter,

    /// Total commit messages sent
    pub commits_sent: IntCounter,

    /// Total commit messages received
    pub commits_received: IntCounter,

    /// Current view number
    pub current_view: IntGauge,

    /// Current sequence number
    pub current_sequence: IntGauge,

    /// Pending finalizations
    pub pending_finalizations: IntGauge,

    /// Finality time in milliseconds (histogram)
    pub finality_time: Histogram,

    /// Byzantine violations detected
    pub byzantine_violations: IntCounter,

    /// Banned nodes count
    pub banned_nodes: IntGauge,

    /// View changes count
    pub view_changes: IntCounter,

    /// Consensus errors
    pub errors: IntCounter,

    /// Message log size
    pub message_log_size: IntGauge,

    /// Prometheus registry
    registry: Arc<Registry>,
}

impl ConsensusMetrics {
    /// Create new consensus metrics
    pub fn new() -> Self {
        let registry = Registry::new();

        let proposals_sent = IntCounter::with_opts(
            Opts::new("consensus_proposals_sent_total", "Total vertices proposed")
                .namespace("cretoai"),
        )
        .unwrap();
        registry.register(Box::new(proposals_sent.clone())).unwrap();

        let vertices_finalized = IntCounter::with_opts(
            Opts::new(
                "consensus_vertices_finalized_total",
                "Total vertices finalized",
            )
            .namespace("cretoai"),
        )
        .unwrap();
        registry
            .register(Box::new(vertices_finalized.clone()))
            .unwrap();

        let prepares_sent = IntCounter::with_opts(
            Opts::new("consensus_prepares_sent_total", "Total prepare messages sent")
                .namespace("cretoai"),
        )
        .unwrap();
        registry.register(Box::new(prepares_sent.clone())).unwrap();

        let prepares_received = IntCounter::with_opts(
            Opts::new(
                "consensus_prepares_received_total",
                "Total prepare messages received",
            )
            .namespace("cretoai"),
        )
        .unwrap();
        registry
            .register(Box::new(prepares_received.clone()))
            .unwrap();

        let commits_sent = IntCounter::with_opts(
            Opts::new("consensus_commits_sent_total", "Total commit messages sent")
                .namespace("cretoai"),
        )
        .unwrap();
        registry.register(Box::new(commits_sent.clone())).unwrap();

        let commits_received = IntCounter::with_opts(
            Opts::new(
                "consensus_commits_received_total",
                "Total commit messages received",
            )
            .namespace("cretoai"),
        )
        .unwrap();
        registry
            .register(Box::new(commits_received.clone()))
            .unwrap();

        let current_view = IntGauge::with_opts(
            Opts::new("consensus_current_view", "Current consensus view number")
                .namespace("cretoai"),
        )
        .unwrap();
        registry.register(Box::new(current_view.clone())).unwrap();

        let current_sequence = IntGauge::with_opts(
            Opts::new(
                "consensus_current_sequence",
                "Current consensus sequence number",
            )
            .namespace("cretoai"),
        )
        .unwrap();
        registry
            .register(Box::new(current_sequence.clone()))
            .unwrap();

        let pending_finalizations = IntGauge::with_opts(
            Opts::new(
                "consensus_pending_finalizations",
                "Number of pending finalizations",
            )
            .namespace("cretoai"),
        )
        .unwrap();
        registry
            .register(Box::new(pending_finalizations.clone()))
            .unwrap();

        let finality_time = Histogram::with_opts(
            HistogramOpts::new("consensus_finality_time_ms", "Vertex finality time in milliseconds")
                .namespace("cretoai")
                .buckets(vec![
                    10.0, 50.0, 100.0, 200.0, 300.0, 400.0, 500.0, 750.0, 1000.0, 2000.0, 5000.0,
                ]),
        )
        .unwrap();
        registry.register(Box::new(finality_time.clone())).unwrap();

        let byzantine_violations = IntCounter::with_opts(
            Opts::new(
                "consensus_byzantine_violations_total",
                "Total Byzantine violations detected",
            )
            .namespace("cretoai"),
        )
        .unwrap();
        registry
            .register(Box::new(byzantine_violations.clone()))
            .unwrap();

        let banned_nodes = IntGauge::with_opts(
            Opts::new("consensus_banned_nodes", "Number of banned nodes")
                .namespace("cretoai"),
        )
        .unwrap();
        registry.register(Box::new(banned_nodes.clone())).unwrap();

        let view_changes = IntCounter::with_opts(
            Opts::new("consensus_view_changes_total", "Total view changes")
                .namespace("cretoai"),
        )
        .unwrap();
        registry.register(Box::new(view_changes.clone())).unwrap();

        let errors = IntCounter::with_opts(
            Opts::new("consensus_errors_total", "Total consensus errors")
                .namespace("cretoai"),
        )
        .unwrap();
        registry.register(Box::new(errors.clone())).unwrap();

        let message_log_size = IntGauge::with_opts(
            Opts::new("consensus_message_log_size", "Message log size")
                .namespace("cretoai"),
        )
        .unwrap();
        registry
            .register(Box::new(message_log_size.clone()))
            .unwrap();

        Self {
            proposals_sent,
            vertices_finalized,
            prepares_sent,
            prepares_received,
            commits_sent,
            commits_received,
            current_view,
            current_sequence,
            pending_finalizations,
            finality_time,
            byzantine_violations,
            banned_nodes,
            view_changes,
            errors,
            message_log_size,
            registry: Arc::new(registry),
        }
    }

    /// Get Prometheus registry
    pub fn registry(&self) -> Arc<Registry> {
        self.registry.clone()
    }

    /// Export metrics in Prometheus text format
    pub fn export(&self) -> String {
        use prometheus::Encoder;
        let encoder = prometheus::TextEncoder::new();
        let metric_families = self.registry.gather();
        let mut buffer = Vec::new();
        encoder.encode(&metric_families, &mut buffer).unwrap();
        String::from_utf8(buffer).unwrap()
    }
}

impl Default for ConsensusMetrics {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metrics_creation() {
        let metrics = ConsensusMetrics::new();

        // Initial values
        assert_eq!(metrics.proposals_sent.get(), 0);
        assert_eq!(metrics.vertices_finalized.get(), 0);

        // Increment
        metrics.proposals_sent.inc();
        assert_eq!(metrics.proposals_sent.get(), 1);
    }

    #[test]
    fn test_metrics_export() {
        let metrics = ConsensusMetrics::new();
        metrics.proposals_sent.inc();

        let exported = metrics.export();
        assert!(exported.contains("cretoai_consensus_proposals_sent_total"));
    }
}
