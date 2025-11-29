#!/bin/bash
# CretoAI Kubernetes Deployment Script
# One-command deployment to production Kubernetes cluster

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="cretoai"
RELEASE_NAME="cretoai"
CHART_PATH="./charts/cretoai"
MANIFEST_PATH="./k8s"
DEPLOY_METHOD="${1:-helm}"  # helm or kubectl

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl not found. Please install kubectl."
        exit 1
    fi

    # Check Kubernetes connection
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster. Check your kubeconfig."
        exit 1
    fi

    # Check helm if using helm deployment
    if [[ "$DEPLOY_METHOD" == "helm" ]]; then
        if ! command -v helm &> /dev/null; then
            log_error "helm not found. Please install Helm 3+."
            exit 1
        fi
    fi

    log_success "Prerequisites check passed"
}

check_cluster_resources() {
    log_info "Checking cluster resources..."

    # Check available nodes
    NODE_COUNT=$(kubectl get nodes --no-headers | wc -l)
    if [[ $NODE_COUNT -lt 3 ]]; then
        log_warning "Cluster has only $NODE_COUNT nodes. Recommended: 3+ nodes for high availability."
    fi

    # Check storage class
    if ! kubectl get storageclass standard &> /dev/null; then
        log_warning "Storage class 'standard' not found. You may need to specify a different storage class."
    fi

    log_success "Cluster resources check completed"
}

create_namespace() {
    log_info "Creating namespace: $NAMESPACE"

    if kubectl get namespace "$NAMESPACE" &> /dev/null; then
        log_warning "Namespace $NAMESPACE already exists"
    else
        kubectl create namespace "$NAMESPACE"
        kubectl label namespace "$NAMESPACE" name=cretoai app.kubernetes.io/name=cretoai
        log_success "Namespace created"
    fi
}

deploy_with_kubectl() {
    log_info "Deploying with kubectl..."

    # Deploy all-in-one manifest
    if [[ -f "$MANIFEST_PATH/cretoai-cluster.yaml" ]]; then
        log_info "Deploying combined manifest..."
        kubectl apply -f "$MANIFEST_PATH/cretoai-cluster.yaml"
    else
        # Deploy individual manifests
        log_info "Deploying individual manifests..."
        kubectl apply -f "$MANIFEST_PATH/namespace.yaml"
        kubectl apply -f "$MANIFEST_PATH/configmap.yaml"
        kubectl apply -f "$MANIFEST_PATH/service.yaml"
        kubectl apply -f "$MANIFEST_PATH/statefulset.yaml"
        kubectl apply -f "$MANIFEST_PATH/api-deployment.yaml"
        kubectl apply -f "$MANIFEST_PATH/api-service.yaml"

        # Deploy ingress if exists
        if [[ -f "$MANIFEST_PATH/ingress.yaml" ]]; then
            log_info "Deploying ingress..."
            kubectl apply -f "$MANIFEST_PATH/ingress.yaml"
        fi
    fi

    log_success "Resources deployed with kubectl"
}

deploy_with_helm() {
    log_info "Deploying with Helm..."

    # Check if chart exists
    if [[ ! -d "$CHART_PATH" ]]; then
        log_error "Helm chart not found at $CHART_PATH"
        exit 1
    fi

    # Check if release exists
    if helm list -n "$NAMESPACE" | grep -q "$RELEASE_NAME"; then
        log_info "Upgrading existing Helm release..."
        helm upgrade "$RELEASE_NAME" "$CHART_PATH" \
            --namespace "$NAMESPACE" \
            --wait \
            --timeout 10m \
            --reuse-values
    else
        log_info "Installing new Helm release..."
        helm install "$RELEASE_NAME" "$CHART_PATH" \
            --namespace "$NAMESPACE" \
            --create-namespace \
            --wait \
            --timeout 10m
    fi

    log_success "Deployed with Helm"
}

deploy_monitoring() {
    log_info "Deploying monitoring stack..."

    if [[ -d "$MANIFEST_PATH/monitoring" ]]; then
        # Check if Prometheus Operator is installed
        if kubectl get crd servicemonitors.monitoring.coreos.com &> /dev/null; then
            log_info "Deploying ServiceMonitor and PrometheusRule..."
            kubectl apply -f "$MANIFEST_PATH/monitoring/servicemonitor.yaml"
            kubectl apply -f "$MANIFEST_PATH/monitoring/prometheusrule.yaml"
            log_success "Monitoring resources deployed"
        else
            log_warning "Prometheus Operator not found. Skipping ServiceMonitor deployment."
            log_warning "Install with: helm install prometheus prometheus-community/kube-prometheus-stack"
        fi
    else
        log_warning "Monitoring manifests not found"
    fi
}

wait_for_pods() {
    log_info "Waiting for pods to be ready..."

    # Wait for StatefulSet
    kubectl rollout status statefulset/cretoai-node -n "$NAMESPACE" --timeout=10m

    # Wait for Deployment
    kubectl rollout status deployment/cretoai-api -n "$NAMESPACE" --timeout=5m

    log_success "All pods are ready"
}

verify_deployment() {
    log_info "Verifying deployment..."

    # Check consensus nodes
    NODE_READY=$(kubectl get pods -n "$NAMESPACE" -l app=cretoai-node --no-headers | grep -c "Running" || true)
    log_info "Consensus nodes running: $NODE_READY/3"

    # Check API pods
    API_READY=$(kubectl get pods -n "$NAMESPACE" -l app=cretoai-api --no-headers | grep -c "Running" || true)
    log_info "API pods running: $API_READY/3"

    # Check services
    log_info "Services:"
    kubectl get svc -n "$NAMESPACE"

    # Get external IP for LoadBalancer
    if kubectl get svc cretoai-api-lb -n "$NAMESPACE" &> /dev/null; then
        log_info "Waiting for LoadBalancer external IP..."
        EXTERNAL_IP=""
        for i in {1..30}; do
            EXTERNAL_IP=$(kubectl get svc cretoai-api-lb -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
            if [[ -n "$EXTERNAL_IP" ]]; then
                break
            fi
            sleep 2
        done

        if [[ -n "$EXTERNAL_IP" ]]; then
            log_success "API accessible at: http://$EXTERNAL_IP"
        else
            log_warning "LoadBalancer external IP not yet assigned"
        fi
    fi

    log_success "Deployment verification complete"
}

print_access_info() {
    echo ""
    log_success "=================================="
    log_success "CretoAI Deployment Complete!"
    log_success "=================================="
    echo ""
    log_info "📊 View cluster status:"
    echo "  kubectl get pods -n $NAMESPACE"
    echo ""
    log_info "📝 View logs:"
    echo "  kubectl logs -n $NAMESPACE -l app=cretoai-node -f"
    echo "  kubectl logs -n $NAMESPACE -l app=cretoai-api -f"
    echo ""
    log_info "📈 Access metrics:"
    echo "  kubectl port-forward -n $NAMESPACE svc/cretoai-metrics 9090:9090"
    echo ""
    log_info "🌐 Access API (port-forward):"
    echo "  kubectl port-forward -n $NAMESPACE svc/cretoai-api 8080:8080"
    echo "  Open: http://localhost:8080"
    echo ""
    log_info "🔧 Upgrade deployment:"
    if [[ "$DEPLOY_METHOD" == "helm" ]]; then
        echo "  helm upgrade $RELEASE_NAME $CHART_PATH -n $NAMESPACE"
    else
        echo "  kubectl apply -f $MANIFEST_PATH/cretoai-cluster.yaml"
    fi
    echo ""
}

# Main execution
main() {
    log_info "Starting CretoAI Kubernetes deployment..."
    log_info "Deploy method: $DEPLOY_METHOD"
    echo ""

    check_prerequisites
    check_cluster_resources
    create_namespace

    if [[ "$DEPLOY_METHOD" == "helm" ]]; then
        deploy_with_helm
    else
        deploy_with_kubectl
    fi

    deploy_monitoring
    wait_for_pods
    verify_deployment
    print_access_info

    log_success "Deployment script completed successfully!"
}

# Run main
main
