#!/bin/bash
# CretoAI Kubernetes Rolling Upgrade Script
# Zero-downtime upgrade for consensus nodes and API

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
NAMESPACE="cretoai"
RELEASE_NAME="cretoai"
NEW_VERSION="${1:-latest}"
UPGRADE_METHOD="${2:-helm}"  # helm or kubectl
CHART_PATH="./charts/cretoai"
MANIFEST_PATH="./k8s"

# Functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

check_prerequisites() {
    log_info "Checking prerequisites..."

    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster"
        exit 1
    fi

    if [[ "$UPGRADE_METHOD" == "helm" ]] && ! command -v helm &> /dev/null; then
        log_error "Helm not found"
        exit 1
    fi

    log_success "Prerequisites check passed"
}

verify_cluster_health() {
    log_info "Verifying cluster health before upgrade..."

    # Check quorum
    READY_NODES=$(kubectl get pods -n "$NAMESPACE" -l app=cretoai-node -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | wc -w)
    TOTAL_NODES=$(kubectl get pods -n "$NAMESPACE" -l app=cretoai-node --no-headers | wc -l)

    log_info "Ready consensus nodes: $READY_NODES/$TOTAL_NODES"

    if [[ $READY_NODES -lt 2 ]]; then
        log_error "Insufficient consensus nodes for quorum. Need at least 2 nodes."
        exit 1
    fi

    # Check API health
    API_READY=$(kubectl get pods -n "$NAMESPACE" -l app=cretoai-api -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | wc -w)
    log_info "Ready API pods: $API_READY"

    if [[ $API_READY -lt 1 ]]; then
        log_error "No API pods available"
        exit 1
    fi

    log_success "Cluster health check passed"
}

create_backup() {
    log_info "Creating backup before upgrade..."

    BACKUP_DIR="./backups/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"

    # Backup current manifests
    if [[ "$UPGRADE_METHOD" == "helm" ]]; then
        log_info "Backing up Helm values..."
        helm get values "$RELEASE_NAME" -n "$NAMESPACE" > "$BACKUP_DIR/values.yaml"
        helm get manifest "$RELEASE_NAME" -n "$NAMESPACE" > "$BACKUP_DIR/manifest.yaml"
    else
        log_info "Backing up kubectl manifests..."
        kubectl get statefulset cretoai-node -n "$NAMESPACE" -o yaml > "$BACKUP_DIR/statefulset.yaml"
        kubectl get deployment cretoai-api -n "$NAMESPACE" -o yaml > "$BACKUP_DIR/api-deployment.yaml"
    fi

    # Backup ConfigMap
    kubectl get configmap cretoai-config -n "$NAMESPACE" -o yaml > "$BACKUP_DIR/configmap.yaml"

    log_success "Backup created at: $BACKUP_DIR"
}

upgrade_consensus_nodes() {
    log_info "Upgrading consensus nodes (StatefulSet)..."

    if [[ "$UPGRADE_METHOD" == "helm" ]]; then
        helm upgrade "$RELEASE_NAME" "$CHART_PATH" \
            --namespace "$NAMESPACE" \
            --set node.image.tag="$NEW_VERSION" \
            --reuse-values \
            --wait \
            --timeout 15m
    else
        # Update image in StatefulSet
        kubectl set image statefulset/cretoai-node \
            node=cretoai/node:"$NEW_VERSION" \
            -n "$NAMESPACE"

        # Wait for rollout
        kubectl rollout status statefulset/cretoai-node -n "$NAMESPACE" --timeout=15m
    fi

    log_success "Consensus nodes upgraded"
}

upgrade_api() {
    log_info "Upgrading API (Deployment)..."

    if [[ "$UPGRADE_METHOD" == "helm" ]]; then
        helm upgrade "$RELEASE_NAME" "$CHART_PATH" \
            --namespace "$NAMESPACE" \
            --set api.image.tag="$NEW_VERSION" \
            --reuse-values \
            --wait \
            --timeout 10m
    else
        # Update image in Deployment
        kubectl set image deployment/cretoai-api \
            api=cretoai/api:"$NEW_VERSION" \
            -n "$NAMESPACE"

        # Wait for rollout
        kubectl rollout status deployment/cretoai-api -n "$NAMESPACE" --timeout=10m
    fi

    log_success "API upgraded"
}

monitor_upgrade() {
    log_info "Monitoring upgrade progress..."

    # Monitor StatefulSet rollout
    log_info "Consensus nodes rollout:"
    for i in {0..2}; do
        POD_NAME="cretoai-node-$i"
        log_info "Waiting for pod $POD_NAME..."
        kubectl wait pod/"$POD_NAME" -n "$NAMESPACE" \
            --for=condition=Ready \
            --timeout=5m || log_warning "Pod $POD_NAME not ready yet"
    done

    # Check consensus
    log_info "Verifying consensus after upgrade..."
    sleep 10

    READY_NODES=$(kubectl get pods -n "$NAMESPACE" -l app=cretoai-node -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | wc -w)
    if [[ $READY_NODES -lt 2 ]]; then
        log_error "Consensus lost during upgrade!"
        return 1
    fi

    log_success "Upgrade monitoring completed"
}

verify_upgrade() {
    log_info "Verifying upgrade..."

    # Check pod versions
    log_info "Consensus node versions:"
    kubectl get pods -n "$NAMESPACE" -l app=cretoai-node \
        -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[0].image}{"\n"}{end}'

    log_info "API versions:"
    kubectl get pods -n "$NAMESPACE" -l app=cretoai-api \
        -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[0].image}{"\n"}{end}'

    # Check health
    log_info "Pod status:"
    kubectl get pods -n "$NAMESPACE" -o wide

    # Test API
    log_info "Testing API health..."
    if kubectl run -it --rm --restart=Never test-api \
        --image=curlimages/curl:latest \
        --namespace="$NAMESPACE" \
        -- curl -s http://cretoai-api:8080/health > /dev/null 2>&1; then
        log_success "API health check passed"
    else
        log_warning "API health check failed (may be temporary)"
    fi

    log_success "Upgrade verification complete"
}

rollback_if_needed() {
    log_error "Upgrade failed! Initiating rollback..."

    if [[ "$UPGRADE_METHOD" == "helm" ]]; then
        log_info "Rolling back with Helm..."
        helm rollback "$RELEASE_NAME" -n "$NAMESPACE" --wait --timeout=10m
    else
        log_info "Rolling back StatefulSet..."
        kubectl rollout undo statefulset/cretoai-node -n "$NAMESPACE"
        kubectl rollout status statefulset/cretoai-node -n "$NAMESPACE" --timeout=10m

        log_info "Rolling back Deployment..."
        kubectl rollout undo deployment/cretoai-api -n "$NAMESPACE"
        kubectl rollout status deployment/cretoai-api -n "$NAMESPACE" --timeout=10m
    fi

    log_success "Rollback completed"
}

print_upgrade_summary() {
    echo ""
    log_success "=================================="
    log_success "Upgrade Complete!"
    log_success "=================================="
    echo ""
    log_info "New version: $NEW_VERSION"
    log_info "Namespace: $NAMESPACE"
    echo ""
    log_info "📊 Check status:"
    echo "  kubectl get pods -n $NAMESPACE"
    echo ""
    log_info "📝 View upgrade history:"
    if [[ "$UPGRADE_METHOD" == "helm" ]]; then
        echo "  helm history $RELEASE_NAME -n $NAMESPACE"
    else
        echo "  kubectl rollout history statefulset/cretoai-node -n $NAMESPACE"
        echo "  kubectl rollout history deployment/cretoai-api -n $NAMESPACE"
    fi
    echo ""
    log_info "↩️  Rollback if needed:"
    if [[ "$UPGRADE_METHOD" == "helm" ]]; then
        echo "  helm rollback $RELEASE_NAME -n $NAMESPACE"
    else
        echo "  kubectl rollout undo statefulset/cretoai-node -n $NAMESPACE"
        echo "  kubectl rollout undo deployment/cretoai-api -n $NAMESPACE"
    fi
    echo ""
}

# Main execution
main() {
    log_info "Starting CretoAI Kubernetes upgrade..."
    log_info "New version: $NEW_VERSION"
    log_info "Upgrade method: $UPGRADE_METHOD"
    echo ""

    check_prerequisites
    verify_cluster_health
    create_backup

    # Upgrade with error handling
    if ! upgrade_consensus_nodes; then
        rollback_if_needed
        exit 1
    fi

    if ! upgrade_api; then
        rollback_if_needed
        exit 1
    fi

    if ! monitor_upgrade; then
        rollback_if_needed
        exit 1
    fi

    verify_upgrade
    print_upgrade_summary

    log_success "Upgrade script completed successfully!"
}

# Handle errors
trap 'log_error "Upgrade failed at line $LINENO. Check logs above."; rollback_if_needed; exit 1' ERR

# Run main
main
