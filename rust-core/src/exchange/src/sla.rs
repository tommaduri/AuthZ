//! SLA (Service Level Agreement) Monitoring and Enforcement
//!
//! Provides:
//! - Uptime tracking
//! - Performance monitoring
//! - Compliance verification
//! - Penalty calculation

use crate::error::{ExchangeError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// SLA metric
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlaMetric {
    /// Metric name
    pub name: String,
    /// Target value
    pub target: f64,
    /// Current value
    pub current: f64,
    /// Unit of measurement
    pub unit: String,
}

/// SLA agreement
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlaAgreement {
    /// Agreement ID
    pub id: String,
    /// Provider agent ID
    pub provider_id: String,
    /// Consumer agent ID
    pub consumer_id: String,
    /// Uptime guarantee (percentage)
    pub uptime_guarantee: f64,
    /// Response time target (milliseconds)
    pub response_time_ms: u64,
    /// Throughput target (operations/second)
    pub throughput_target: u64,
    /// Monitoring period (seconds)
    pub monitoring_period: i64,
    /// Penalty per violation
    pub penalty_per_violation: u64,
    /// Creation timestamp
    pub created_at: i64,
    /// Expiration timestamp
    pub expires_at: i64,
}

impl SlaAgreement {
    /// Create a new SLA agreement
    pub fn new(
        provider_id: String,
        consumer_id: String,
        uptime_guarantee: f64,
        response_time_ms: u64,
        duration: i64,
    ) -> Self {
        let now = chrono::Utc::now().timestamp();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            provider_id,
            consumer_id,
            uptime_guarantee,
            response_time_ms,
            throughput_target: 100,
            monitoring_period: 3600,
            penalty_per_violation: 100,
            created_at: now,
            expires_at: now + duration,
        }
    }

    /// Check if agreement is expired
    pub fn is_expired(&self) -> bool {
        chrono::Utc::now().timestamp() > self.expires_at
    }
}

/// SLA violation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlaViolation {
    /// Violation ID
    pub id: String,
    /// SLA agreement ID
    pub sla_id: String,
    /// Violation type
    pub violation_type: String,
    /// Expected value
    pub expected: f64,
    /// Actual value
    pub actual: f64,
    /// Penalty amount
    pub penalty: u64,
    /// Timestamp
    pub timestamp: i64,
}

/// SLA monitor
pub struct SlaMonitor {
    agreements: Arc<RwLock<HashMap<String, SlaAgreement>>>,
    violations: Arc<RwLock<HashMap<String, Vec<SlaViolation>>>>,
    metrics: Arc<RwLock<HashMap<String, Vec<SlaMetric>>>>,
}

impl SlaMonitor {
    /// Create a new SLA monitor
    pub fn new() -> Self {
        Self {
            agreements: Arc::new(RwLock::new(HashMap::new())),
            violations: Arc::new(RwLock::new(HashMap::new())),
            metrics: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create and store an SLA agreement
    pub fn create_agreement(&self, agreement: SlaAgreement) -> Result<String> {
        let sla_id = agreement.id.clone();
        self.agreements
            .write()
            .unwrap()
            .insert(sla_id.clone(), agreement);
        Ok(sla_id)
    }

    /// Get an SLA agreement
    pub fn get_agreement(&self, sla_id: &str) -> Result<SlaAgreement> {
        self.agreements
            .read()
            .unwrap()
            .get(sla_id)
            .cloned()
            .ok_or_else(|| ExchangeError::Sla("SLA agreement not found".to_string()))
    }

    /// Record a metric measurement
    pub fn record_metric(&self, sla_id: &str, metric: SlaMetric) -> Result<()> {
        if !self.agreements.read().unwrap().contains_key(sla_id) {
            return Err(ExchangeError::Sla("SLA agreement not found".to_string()));
        }

        self.metrics
            .write()
            .unwrap()
            .entry(sla_id.to_string())
            .or_insert_with(Vec::new)
            .push(metric);

        Ok(())
    }

    /// Check uptime compliance
    pub fn check_uptime(&self, sla_id: &str, actual_uptime: f64) -> Result<bool> {
        let agreement = self.get_agreement(sla_id)?;

        if actual_uptime < agreement.uptime_guarantee {
            let violation = SlaViolation {
                id: uuid::Uuid::new_v4().to_string(),
                sla_id: sla_id.to_string(),
                violation_type: "uptime".to_string(),
                expected: agreement.uptime_guarantee,
                actual: actual_uptime,
                penalty: agreement.penalty_per_violation,
                timestamp: chrono::Utc::now().timestamp(),
            };

            self.violations
                .write()
                .unwrap()
                .entry(sla_id.to_string())
                .or_insert_with(Vec::new)
                .push(violation);

            return Ok(false);
        }

        Ok(true)
    }

    /// Check response time compliance
    pub fn check_response_time(&self, sla_id: &str, actual_response_ms: u64) -> Result<bool> {
        let agreement = self.get_agreement(sla_id)?;

        if actual_response_ms > agreement.response_time_ms {
            let violation = SlaViolation {
                id: uuid::Uuid::new_v4().to_string(),
                sla_id: sla_id.to_string(),
                violation_type: "response_time".to_string(),
                expected: agreement.response_time_ms as f64,
                actual: actual_response_ms as f64,
                penalty: agreement.penalty_per_violation,
                timestamp: chrono::Utc::now().timestamp(),
            };

            self.violations
                .write()
                .unwrap()
                .entry(sla_id.to_string())
                .or_insert_with(Vec::new)
                .push(violation);

            return Ok(false);
        }

        Ok(true)
    }

    /// Get all violations for an SLA
    pub fn get_violations(&self, sla_id: &str) -> Vec<SlaViolation> {
        self.violations
            .read()
            .unwrap()
            .get(sla_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Get metrics history for an SLA
    pub fn get_metrics(&self, sla_id: &str) -> Vec<SlaMetric> {
        self.metrics
            .read()
            .unwrap()
            .get(sla_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Calculate total penalties for an SLA
    pub fn calculate_penalties(&self, sla_id: &str) -> u64 {
        self.violations
            .read()
            .unwrap()
            .get(sla_id)
            .map(|violations| violations.iter().map(|v| v.penalty).sum())
            .unwrap_or(0)
    }

    /// Get SLA compliance report
    pub fn get_compliance_report(&self, sla_id: &str) -> Result<ComplianceReport> {
        let agreement = self.get_agreement(sla_id)?;
        let violations = self.get_violations(sla_id);
        let total_penalties = self.calculate_penalties(sla_id);

        let violation_count = violations.len();
        let uptime_violations = violations
            .iter()
            .filter(|v| v.violation_type == "uptime")
            .count();
        let response_time_violations = violations
            .iter()
            .filter(|v| v.violation_type == "response_time")
            .count();

        Ok(ComplianceReport {
            sla_id: sla_id.to_string(),
            provider_id: agreement.provider_id,
            consumer_id: agreement.consumer_id,
            total_violations: violation_count,
            uptime_violations,
            response_time_violations,
            total_penalties,
            compliance_rate: if violation_count == 0 {
                100.0
            } else {
                ((1.0 - (violation_count as f64 / 100.0)) * 100.0).max(0.0)
            },
        })
    }

    /// Get SLA statistics
    pub fn get_stats(&self) -> SlaStats {
        let agreements = self.agreements.read().unwrap();
        let violations = self.violations.read().unwrap();

        let total_agreements = agreements.len();
        let active_agreements = agreements
            .values()
            .filter(|a| !a.is_expired())
            .count();
        let total_violations: usize = violations.values().map(|v| v.len()).sum();

        SlaStats {
            total_agreements,
            active_agreements,
            total_violations,
        }
    }
}

impl Default for SlaMonitor {
    fn default() -> Self {
        Self::new()
    }
}

/// Compliance report
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComplianceReport {
    pub sla_id: String,
    pub provider_id: String,
    pub consumer_id: String,
    pub total_violations: usize,
    pub uptime_violations: usize,
    pub response_time_violations: usize,
    pub total_penalties: u64,
    pub compliance_rate: f64,
}

/// SLA statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlaStats {
    pub total_agreements: usize,
    pub active_agreements: usize,
    pub total_violations: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sla_creation() {
        let sla = SlaAgreement::new(
            "provider-001".to_string(),
            "consumer-001".to_string(),
            99.9,
            100,
            86400,
        );

        assert_eq!(sla.provider_id, "provider-001");
        assert_eq!(sla.uptime_guarantee, 99.9);
        assert_eq!(sla.response_time_ms, 100);
    }

    #[test]
    fn test_sla_monitor() {
        let monitor = SlaMonitor::new();

        let sla = SlaAgreement::new(
            "provider-001".to_string(),
            "consumer-001".to_string(),
            99.9,
            100,
            86400,
        );

        let sla_id = monitor.create_agreement(sla).unwrap();
        let retrieved = monitor.get_agreement(&sla_id).unwrap();

        assert_eq!(retrieved.provider_id, "provider-001");
    }

    #[test]
    fn test_uptime_compliance_pass() {
        let monitor = SlaMonitor::new();

        let sla = SlaAgreement::new(
            "provider-001".to_string(),
            "consumer-001".to_string(),
            99.9,
            100,
            86400,
        );

        let sla_id = monitor.create_agreement(sla).unwrap();
        let compliant = monitor.check_uptime(&sla_id, 99.95).unwrap();

        assert!(compliant);
    }

    #[test]
    fn test_uptime_violation() {
        let monitor = SlaMonitor::new();

        let sla = SlaAgreement::new(
            "provider-001".to_string(),
            "consumer-001".to_string(),
            99.9,
            100,
            86400,
        );

        let sla_id = monitor.create_agreement(sla).unwrap();
        let compliant = monitor.check_uptime(&sla_id, 98.0).unwrap();

        assert!(!compliant);

        let violations = monitor.get_violations(&sla_id);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].violation_type, "uptime");
    }

    #[test]
    fn test_response_time_compliance() {
        let monitor = SlaMonitor::new();

        let sla = SlaAgreement::new(
            "provider-001".to_string(),
            "consumer-001".to_string(),
            99.9,
            100,
            86400,
        );

        let sla_id = monitor.create_agreement(sla).unwrap();
        let compliant = monitor.check_response_time(&sla_id, 50).unwrap();

        assert!(compliant);
    }

    #[test]
    fn test_response_time_violation() {
        let monitor = SlaMonitor::new();

        let sla = SlaAgreement::new(
            "provider-001".to_string(),
            "consumer-001".to_string(),
            99.9,
            100,
            86400,
        );

        let sla_id = monitor.create_agreement(sla).unwrap();
        let compliant = monitor.check_response_time(&sla_id, 200).unwrap();

        assert!(!compliant);

        let violations = monitor.get_violations(&sla_id);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].violation_type, "response_time");
    }

    #[test]
    fn test_penalty_calculation() {
        let monitor = SlaMonitor::new();

        let sla = SlaAgreement::new(
            "provider-001".to_string(),
            "consumer-001".to_string(),
            99.9,
            100,
            86400,
        );

        let sla_id = monitor.create_agreement(sla).unwrap();
        monitor.check_uptime(&sla_id, 98.0).unwrap();
        monitor.check_response_time(&sla_id, 200).unwrap();

        let total_penalties = monitor.calculate_penalties(&sla_id);
        assert_eq!(total_penalties, 200); // 2 violations * 100 penalty each
    }

    #[test]
    fn test_compliance_report() {
        let monitor = SlaMonitor::new();

        let sla = SlaAgreement::new(
            "provider-001".to_string(),
            "consumer-001".to_string(),
            99.9,
            100,
            86400,
        );

        let sla_id = monitor.create_agreement(sla).unwrap();
        monitor.check_uptime(&sla_id, 98.0).unwrap();

        let report = monitor.get_compliance_report(&sla_id).unwrap();
        assert_eq!(report.total_violations, 1);
        assert_eq!(report.uptime_violations, 1);
        assert_eq!(report.total_penalties, 100);
    }

    #[test]
    fn test_metric_recording() {
        let monitor = SlaMonitor::new();

        let sla = SlaAgreement::new(
            "provider-001".to_string(),
            "consumer-001".to_string(),
            99.9,
            100,
            86400,
        );

        let sla_id = monitor.create_agreement(sla).unwrap();

        let metric = SlaMetric {
            name: "cpu_usage".to_string(),
            target: 80.0,
            current: 65.0,
            unit: "percent".to_string(),
        };

        monitor.record_metric(&sla_id, metric).unwrap();

        let metrics = monitor.get_metrics(&sla_id);
        assert_eq!(metrics.len(), 1);
        assert_eq!(metrics[0].name, "cpu_usage");
    }

    #[test]
    fn test_sla_stats() {
        let monitor = SlaMonitor::new();

        monitor
            .create_agreement(SlaAgreement::new(
                "provider-001".to_string(),
                "consumer-001".to_string(),
                99.9,
                100,
                86400,
            ))
            .unwrap();
        monitor
            .create_agreement(SlaAgreement::new(
                "provider-002".to_string(),
                "consumer-002".to_string(),
                99.5,
                200,
                86400,
            ))
            .unwrap();

        let stats = monitor.get_stats();
        assert_eq!(stats.total_agreements, 2);
        assert_eq!(stats.active_agreements, 2);
    }
}
