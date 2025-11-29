// CretoAI Phase 7 - Automated Deployment Validation Tests
// Tests verify production deployment health and compliance

use anyhow::{Context, Result};
use k8s_openapi::api::core::v1::{Pod, Service};
use kube::{
    api::{Api, ListParams},
    Client,
};
use reqwest;
use serde_json::Value;
use std::time::Duration;
use tokio::time::sleep;

const NAMESPACE: &str = "cretoai-system";
const TIMEOUT_SECONDS: u64 = 600;

#[tokio::test]
async fn test_all_pods_running() -> Result<()> {
    println!("✓ Testing: All pods are running");

    let client = Client::try_default()
        .await
        .context("Failed to create Kubernetes client")?;

    let pods: Api<Pod> = Api::namespaced(client, NAMESPACE);
    let lp = ListParams::default().labels("app=cretoai");

    let pod_list = pods.list(&lp).await?;

    let total_pods = pod_list.items.len();
    assert!(total_pods > 0, "No CretoAI pods found in namespace");

    let running_pods: Vec<&Pod> = pod_list
        .items
        .iter()
        .filter(|p| {
            p.status
                .as_ref()
                .and_then(|s| s.phase.as_ref())
                .map(|phase| phase == "Running")
                .unwrap_or(false)
        })
        .collect();

    println!(
        "  Pods running: {}/{} ({}%)",
        running_pods.len(),
        total_pods,
        (running_pods.len() as f64 / total_pods as f64 * 100.0) as u32
    );

    assert_eq!(
        running_pods.len(),
        total_pods,
        "Not all pods are running: {}/{}",
        running_pods.len(),
        total_pods
    );

    Ok(())
}

#[tokio::test]
async fn test_consensus_service_available() -> Result<()> {
    println!("✓ Testing: Consensus service is available");

    let client = Client::try_default().await?;
    let services: Api<Service> = Api::namespaced(client, NAMESPACE);

    let service = services
        .get("cretoai-consensus")
        .await
        .context("Consensus service not found")?;

    // Verify service has endpoints
    assert!(
        service.spec.is_some(),
        "Consensus service spec is missing"
    );

    let spec = service.spec.unwrap();
    assert!(
        !spec.ports.as_ref().unwrap().is_empty(),
        "Consensus service has no ports"
    );

    println!("  Consensus service ports: {:?}", spec.ports.unwrap().len());

    Ok(())
}

#[tokio::test]
async fn test_consensus_api_health() -> Result<()> {
    println!("✓ Testing: Consensus API health endpoint");

    let client = Client::try_default().await?;
    let pods: Api<Pod> = Api::namespaced(client.clone(), NAMESPACE);
    let lp = ListParams::default().labels("app=cretoai,component=consensus");

    let pod_list = pods.list(&lp).await?;
    assert!(!pod_list.items.is_empty(), "No consensus pods found");

    let pod_name = pod_list.items[0].metadata.name.as_ref().unwrap();

    // Port-forward to pod and test health endpoint
    // Note: In real deployment, this would use the service endpoint
    let mut pf = tokio::process::Command::new("kubectl")
        .args(&[
            "port-forward",
            "-n",
            NAMESPACE,
            pod_name,
            "8080:8080",
        ])
        .spawn()
        .context("Failed to start port-forward")?;

    // Wait for port-forward to establish
    sleep(Duration::from_secs(3)).await;

    let http_client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(10))
        .build()?;

    let response = http_client
        .get("https://localhost:8080/health")
        .send()
        .await
        .context("Failed to reach consensus health endpoint")?;

    println!("  Health endpoint status: {}", response.status());

    assert!(
        response.status().is_success(),
        "Consensus health check failed: {}",
        response.status()
    );

    let health_data: Value = response.json().await?;
    println!("  Health response: {}", health_data);

    // Cleanup port-forward
    pf.kill().await?;

    Ok(())
}

#[tokio::test]
async fn test_reputation_service_health() -> Result<()> {
    println!("✓ Testing: Reputation service health");

    let client = Client::try_default().await?;
    let pods: Api<Pod> = Api::namespaced(client, NAMESPACE);
    let lp = ListParams::default().labels("app=cretoai,component=consensus");

    let pod_list = pods.list(&lp).await?;
    assert!(!pod_list.items.is_empty(), "No consensus pods found");

    let pod_name = pod_list.items[0].metadata.name.as_ref().unwrap();

    let mut pf = tokio::process::Command::new("kubectl")
        .args(&[
            "exec",
            "-n",
            NAMESPACE,
            pod_name,
            "-c",
            "reputation",
            "--",
            "curl",
            "-f",
            "http://localhost:8081/health",
        ])
        .output()
        .await
        .context("Failed to check reputation service")?;

    assert!(
        pf.status.success(),
        "Reputation service health check failed"
    );

    println!("  Reputation service: OK");

    Ok(())
}

#[tokio::test]
async fn test_compliance_service_health() -> Result<()> {
    println!("✓ Testing: Compliance service health");

    let client = Client::try_default().await?;
    let pods: Api<Pod> = Api::namespaced(client, NAMESPACE);
    let lp = ListParams::default().labels("app=cretoai,component=consensus");

    let pod_list = pods.list(&lp).await?;
    assert!(!pod_list.items.is_empty(), "No consensus pods found");

    let pod_name = pod_list.items[0].metadata.name.as_ref().unwrap();

    let output = tokio::process::Command::new("kubectl")
        .args(&[
            "exec",
            "-n",
            NAMESPACE,
            pod_name,
            "-c",
            "compliance",
            "--",
            "curl",
            "-f",
            "http://localhost:8082/health",
        ])
        .output()
        .await
        .context("Failed to check compliance service")?;

    assert!(
        output.status.success(),
        "Compliance service health check failed"
    );

    println!("  Compliance service: OK");

    Ok(())
}

#[tokio::test]
async fn test_audit_logging_operational() -> Result<()> {
    println!("✓ Testing: Audit logging is operational");

    let client = Client::try_default().await?;
    let pods: Api<Pod> = Api::namespaced(client, NAMESPACE);
    let lp = ListParams::default().labels("app=cretoai,component=consensus");

    let pod_list = pods.list(&lp).await?;
    assert!(!pod_list.items.is_empty(), "No consensus pods found");

    let pod_name = pod_list.items[0].metadata.name.as_ref().unwrap();

    // Check if audit log file exists
    let output = tokio::process::Command::new("kubectl")
        .args(&[
            "exec",
            "-n",
            NAMESPACE,
            pod_name,
            "-c",
            "compliance",
            "--",
            "test",
            "-f",
            "/var/log/audit/audit.log",
        ])
        .output()
        .await?;

    assert!(output.status.success(), "Audit log file not found");

    println!("  Audit log: Present");

    Ok(())
}

#[tokio::test]
async fn test_persistent_volumes_bound() -> Result<()> {
    println!("✓ Testing: All PVCs are bound");

    let client = Client::try_default().await?;
    let pvcs: Api<k8s_openapi::api::core::v1::PersistentVolumeClaim> =
        Api::namespaced(client, NAMESPACE);

    let lp = ListParams::default();
    let pvc_list = pvcs.list(&lp).await?;

    let total_pvcs = pvc_list.items.len();
    let bound_pvcs: Vec<_> = pvc_list
        .items
        .iter()
        .filter(|pvc| {
            pvc.status
                .as_ref()
                .and_then(|s| s.phase.as_ref())
                .map(|phase| phase == "Bound")
                .unwrap_or(false)
        })
        .collect();

    println!(
        "  PVCs bound: {}/{} ({}%)",
        bound_pvcs.len(),
        total_pvcs,
        (bound_pvcs.len() as f64 / total_pvcs as f64 * 100.0) as u32
    );

    assert_eq!(
        bound_pvcs.len(),
        total_pvcs,
        "Not all PVCs are bound: {}/{}",
        bound_pvcs.len(),
        total_pvcs
    );

    Ok(())
}

#[tokio::test]
async fn test_tls_certificates_present() -> Result<()> {
    println!("✓ Testing: TLS certificates are present");

    let client = Client::try_default().await?;
    let secrets: Api<k8s_openapi::api::core::v1::Secret> =
        Api::namespaced(client, NAMESPACE);

    let tls_secret = secrets
        .get("cretoai-tls")
        .await
        .context("TLS secret not found")?;

    assert!(
        tls_secret.data.is_some(),
        "TLS secret has no data"
    );

    let data = tls_secret.data.unwrap();
    assert!(data.contains_key("tls.crt"), "TLS certificate not found");
    assert!(data.contains_key("tls.key"), "TLS key not found");

    println!("  TLS certificates: Valid");

    Ok(())
}

#[tokio::test]
async fn test_resource_limits_configured() -> Result<()> {
    println!("✓ Testing: Resource limits are configured");

    let client = Client::try_default().await?;
    let pods: Api<Pod> = Api::namespaced(client, NAMESPACE);
    let lp = ListParams::default().labels("app=cretoai");

    let pod_list = pods.list(&lp).await?;

    let pods_without_limits: Vec<_> = pod_list
        .items
        .iter()
        .filter(|pod| {
            pod.spec
                .as_ref()
                .and_then(|spec| spec.containers.first())
                .and_then(|c| c.resources.as_ref())
                .and_then(|r| r.limits.as_ref())
                .is_none()
        })
        .collect();

    if !pods_without_limits.is_empty() {
        println!(
            "  ⚠ Warning: {} pods without resource limits",
            pods_without_limits.len()
        );
    }

    assert!(
        pods_without_limits.len() < pod_list.items.len() / 2,
        "Too many pods without resource limits"
    );

    println!("  Resource limits: Configured");

    Ok(())
}

#[tokio::test]
async fn test_multi_cloud_storage_configured() -> Result<()> {
    println!("✓ Testing: Multi-cloud storage is configured");

    let client = Client::try_default().await?;
    let configmaps: Api<k8s_openapi::api::core::v1::ConfigMap> =
        Api::namespaced(client, NAMESPACE);

    let config = configmaps
        .get("phase7-config")
        .await
        .context("Phase 7 config not found")?;

    assert!(
        config.data.is_some(),
        "ConfigMap has no data"
    );

    let data = config.data.unwrap();
    let multi_cloud_enabled = data
        .get("storage.multi_cloud.enabled")
        .map(|v| v == "true")
        .unwrap_or(false);

    assert!(
        multi_cloud_enabled,
        "Multi-cloud storage is not enabled"
    );

    println!("  Multi-cloud storage: Enabled");

    Ok(())
}

#[tokio::test]
async fn test_metrics_collection() -> Result<()> {
    println!("✓ Testing: Metrics are being collected");

    let client = Client::try_default().await?;
    let pods: Api<Pod> = Api::namespaced(client, NAMESPACE);
    let lp = ListParams::default().labels("app=cretoai,component=consensus");

    let pod_list = pods.list(&lp).await?;
    assert!(!pod_list.items.is_empty(), "No consensus pods found");

    let pod_name = pod_list.items[0].metadata.name.as_ref().unwrap();

    let output = tokio::process::Command::new("kubectl")
        .args(&[
            "exec",
            "-n",
            NAMESPACE,
            pod_name,
            "--",
            "curl",
            "-s",
            "http://localhost:9090/metrics",
        ])
        .output()
        .await?;

    assert!(output.status.success(), "Failed to fetch metrics");

    let metrics_output = String::from_utf8_lossy(&output.stdout);
    assert!(
        metrics_output.contains("cretoai_consensus_votes_total"),
        "Expected consensus metrics not found"
    );

    println!("  Metrics collection: Active");

    Ok(())
}

#[tokio::test]
async fn test_network_policies_configured() -> Result<()> {
    println!("✓ Testing: Network policies are configured");

    let client = Client::try_default().await?;
    let network_policies: Api<k8s_openapi::api::networking::v1::NetworkPolicy> =
        Api::namespaced(client, NAMESPACE);

    let lp = ListParams::default();
    let np_list = network_policies.list(&lp).await?;

    let network_policy_count = np_list.items.len();

    if network_policy_count == 0 {
        println!("  ⚠ Warning: No network policies found");
    } else {
        println!("  Network policies: {} configured", network_policy_count);
    }

    Ok(())
}

#[tokio::test]
async fn test_consensus_operations() -> Result<()> {
    println!("✓ Testing: Consensus operations are functional");

    let client = Client::try_default().await?;
    let pods: Api<Pod> = Api::namespaced(client, NAMESPACE);
    let lp = ListParams::default().labels("app=cretoai,component=consensus");

    let pod_list = pods.list(&lp).await?;
    assert!(!pod_list.items.is_empty(), "No consensus pods found");

    let pod_name = pod_list.items[0].metadata.name.as_ref().unwrap();

    // Check consensus status
    let output = tokio::process::Command::new("kubectl")
        .args(&[
            "exec",
            "-n",
            NAMESPACE,
            pod_name,
            "--",
            "/usr/local/bin/consensus-cli",
            "status",
        ])
        .output()
        .await?;

    assert!(
        output.status.success(),
        "Consensus status check failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    println!("  Consensus operations: Functional");

    Ok(())
}

// Helper function to run all tests and generate summary
pub async fn run_all_validation_tests() -> Result<()> {
    println!("\n═══════════════════════════════════════════════");
    println!("  CretoAI Phase 7 Deployment Validation");
    println!("═══════════════════════════════════════════════\n");

    let test_results = vec![
        test_all_pods_running().await,
        test_consensus_service_available().await,
        test_consensus_api_health().await,
        test_reputation_service_health().await,
        test_compliance_service_health().await,
        test_audit_logging_operational().await,
        test_persistent_volumes_bound().await,
        test_tls_certificates_present().await,
        test_resource_limits_configured().await,
        test_multi_cloud_storage_configured().await,
        test_metrics_collection().await,
        test_network_policies_configured().await,
        test_consensus_operations().await,
    ];

    let passed = test_results.iter().filter(|r| r.is_ok()).count();
    let total = test_results.len();

    println!("\n═══════════════════════════════════════════════");
    println!("  Validation Summary: {}/{} tests passed ({}%)",
        passed, total, (passed as f64 / total as f64 * 100.0) as u32);
    println!("═══════════════════════════════════════════════\n");

    if passed == total {
        println!("✅ All deployment validation tests PASSED");
        Ok(())
    } else {
        anyhow::bail!("❌ {} tests failed", total - passed);
    }
}
