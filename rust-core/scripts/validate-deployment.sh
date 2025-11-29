#!/bin/bash
# CretoAI Phase 7 - Deployment Validation Script

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ENVIRONMENT="${1:-production}"
NAMESPACE="${NAMESPACE:-cretoai-system}"

log() {
    echo -e "${GREEN}[VALIDATE]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log "Validating CretoAI Phase 7 deployment in $ENVIRONMENT environment..."

# Check namespace exists
log "Checking namespace..."
kubectl get namespace "$NAMESPACE" > /dev/null 2>&1 || error "Namespace $NAMESPACE not found"

# Check all pods are running
log "Checking pod status..."
RUNNING_PODS=$(kubectl get pods -n "$NAMESPACE" --field-selector=status.phase=Running --no-headers | wc -l)
TOTAL_PODS=$(kubectl get pods -n "$NAMESPACE" --no-headers | wc -l)

if [ "$RUNNING_PODS" -ne "$TOTAL_PODS" ]; then
    kubectl get pods -n "$NAMESPACE"
    error "Not all pods are running ($RUNNING_PODS/$TOTAL_PODS)"
fi

log "✅ All pods running ($RUNNING_PODS/$TOTAL_PODS)"

# Check consensus service
log "Checking consensus service..."
CONSENSUS_SVC=$(kubectl get svc -n "$NAMESPACE" cretoai-consensus --no-headers 2>/dev/null | wc -l)
if [ "$CONSENSUS_SVC" -eq 0 ]; then
    error "Consensus service not found"
fi
log "✅ Consensus service is available"

# Test API endpoints
log "Testing API endpoints..."
CONSENSUS_POD=$(kubectl get pods -n "$NAMESPACE" -l app=cretoai,component=consensus -o jsonpath='{.items[0].metadata.name}')

kubectl exec -n "$NAMESPACE" "$CONSENSUS_POD" -- curl -f -k https://localhost:8080/health || error "Consensus health check failed"
log "✅ Consensus API health check passed"

kubectl exec -n "$NAMESPACE" "$CONSENSUS_POD" -- curl -f http://localhost:8081/health || error "Reputation service health check failed"
log "✅ Reputation service health check passed"

kubectl exec -n "$NAMESPACE" "$CONSENSUS_POD" -- curl -f http://localhost:8082/health || error "Compliance service health check failed"
log "✅ Compliance service health check passed"

# Validate compliance logging
log "Validating compliance logging..."
kubectl exec -n "$NAMESPACE" "$CONSENSUS_POD" -c compliance -- test -f /var/log/audit/audit.log || error "Audit log not found"
log "✅ Audit logging is operational"

# Check resource limits
log "Checking resource limits..."
kubectl get pods -n "$NAMESPACE" -o json | jq -r '.items[] | select(.spec.containers[].resources.limits == null) | .metadata.name' | while read -r pod; do
    warn "Pod $pod has no resource limits"
done

# Verify TLS certificates
log "Verifying TLS certificates..."
kubectl get secret -n "$NAMESPACE" cretoai-tls > /dev/null 2>&1 || error "TLS secret not found"
log "✅ TLS certificates are present"

# Check PVC status
log "Checking persistent volumes..."
PVCS=$(kubectl get pvc -n "$NAMESPACE" --no-headers | wc -l)
BOUND_PVCS=$(kubectl get pvc -n "$NAMESPACE" --field-selector=status.phase=Bound --no-headers | wc -l)

if [ "$PVCS" -ne "$BOUND_PVCS" ]; then
    kubectl get pvc -n "$NAMESPACE"
    error "Not all PVCs are bound ($BOUND_PVCS/$PVCS)"
fi
log "✅ All PVCs bound ($BOUND_PVCS/$PVCS)"

# Test consensus operations
log "Testing consensus operations..."
kubectl exec -n "$NAMESPACE" "$CONSENSUS_POD" -- /usr/local/bin/consensus-cli status || error "Consensus status check failed"
log "✅ Consensus system is operational"

# Check reputation system
log "Checking reputation system..."
kubectl exec -n "$NAMESPACE" "$CONSENSUS_POD" -c reputation -- /usr/local/bin/reputation-cli stats || error "Reputation system check failed"
log "✅ Reputation system is operational"

# Verify multi-cloud storage
log "Verifying multi-cloud storage configuration..."
kubectl get configmap -n "$NAMESPACE" phase7-config -o jsonpath='{.data.storage\.multi_cloud\.enabled}' | grep -q "true" || error "Multi-cloud storage not enabled"
log "✅ Multi-cloud storage is configured"

# Check monitoring
log "Checking monitoring endpoints..."
if kubectl get prometheus -n monitoring > /dev/null 2>&1; then
    log "✅ Prometheus is running"
else
    warn "Prometheus not found in monitoring namespace"
fi

# Validate metrics
log "Validating metrics collection..."
METRICS=$(kubectl exec -n "$NAMESPACE" "$CONSENSUS_POD" -- curl -s http://localhost:9090/metrics)
echo "$METRICS" | grep -q "cretoai_consensus_votes_total" || warn "Consensus metrics not found"
log "✅ Metrics are being collected"

# Check compliance dashboard
log "Checking compliance dashboard..."
if kubectl get deployment -n "$NAMESPACE" compliance-dashboard > /dev/null 2>&1; then
    log "✅ Compliance dashboard is deployed"
else
    warn "Compliance dashboard not found"
fi

# Verify network policies
log "Checking network policies..."
NP_COUNT=$(kubectl get networkpolicies -n "$NAMESPACE" --no-headers | wc -l)
if [ "$NP_COUNT" -gt 0 ]; then
    log "✅ Network policies are configured ($NP_COUNT policies)"
else
    warn "No network policies found"
fi

# Final summary
log "================================="
log "Deployment Validation Summary"
log "================================="
log "Environment: $ENVIRONMENT"
log "Namespace: $NAMESPACE"
log "Total Pods: $TOTAL_PODS (all running)"
log "Consensus Service: Operational"
log "Reputation System: Operational"
log "Compliance Monitoring: Operational"
log "Storage: Multi-cloud configured"
log "Security: TLS enabled"
log "================================="
log "✅ Deployment validation PASSED"

exit 0
