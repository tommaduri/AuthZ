#!/bin/bash
# CretoAI Phase 7 - Azure Government Deployment Script
# Deploys CretoAI consensus system to Azure Government Cloud

set -e
set -o pipefail

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
AZURE_REGION="${AZURE_REGION:-usgovvirginia}"
RESOURCE_GROUP="${RESOURCE_GROUP:-cretoai-phase7-rg}"
CLUSTER_NAME="${CLUSTER_NAME:-cretoai-phase7-aks}"
NODE_COUNT="${NODE_COUNT:-9}"
NODE_VM_SIZE="${NODE_VM_SIZE:-Standard_D8s_v3}"
K8S_VERSION="${K8S_VERSION:-1.28}"
NAMESPACE="${NAMESPACE:-cretoai-system}"
HELM_RELEASE="${HELM_RELEASE:-cretoai-phase7}"

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
    exit 1
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

check_prerequisites() {
    log "Checking prerequisites..."

    # Check Azure CLI
    if ! command -v az &> /dev/null; then
        error "Azure CLI is not installed. Please install it first."
    fi

    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        error "kubectl is not installed. Please install it first."
    fi

    # Check helm
    if ! command -v helm &> /dev/null; then
        error "helm is not installed. Please install it first."
    fi

    # Verify Azure login
    if ! az account show &> /dev/null; then
        error "Not logged into Azure. Please run 'az login --use-device-code'"
    fi

    # Set Azure Government cloud
    az cloud set --name AzureUSGovernment

    log "All prerequisites satisfied"
}

create_resource_group() {
    log "Creating resource group..."

    az group create \
        --name "$RESOURCE_GROUP" \
        --location "$AZURE_REGION" \
        --tags "Environment=production" "Compliance=CMMC-L2,FedRAMP-Moderate"

    log "Resource group created: $RESOURCE_GROUP"
}

create_key_vault() {
    log "Creating Azure Key Vault..."

    KEY_VAULT_NAME="cretoai-kv-$(date +%s)"

    az keyvault create \
        --name "$KEY_VAULT_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --location "$AZURE_REGION" \
        --enable-rbac-authorization true \
        --enable-purge-protection true \
        --retention-days 90

    # Create encryption key
    az keyvault key create \
        --vault-name "$KEY_VAULT_NAME" \
        --name "cretoai-disk-encryption-key" \
        --protection software \
        --ops encrypt decrypt

    log "Key Vault created: $KEY_VAULT_NAME"
    echo "$KEY_VAULT_NAME" > key-vault-name.txt
}

create_aks_cluster() {
    log "Creating AKS cluster in Azure Government..."

    # Create AKS cluster
    az aks create \
        --resource-group "$RESOURCE_GROUP" \
        --name "$CLUSTER_NAME" \
        --location "$AZURE_REGION" \
        --kubernetes-version "$K8S_VERSION" \
        --node-count "$NODE_COUNT" \
        --node-vm-size "$NODE_VM_SIZE" \
        --node-osdisk-size 500 \
        --enable-managed-identity \
        --enable-cluster-autoscaler \
        --min-count "$NODE_COUNT" \
        --max-count $((NODE_COUNT * 2)) \
        --enable-addons monitoring \
        --enable-azure-rbac \
        --enable-defender \
        --network-plugin azure \
        --network-policy azure \
        --enable-encryption-at-host \
        --zones 1 2 3 \
        --tags "Environment=production" "Compliance=CMMC-L2,FedRAMP-Moderate"

    # Get credentials
    az aks get-credentials \
        --resource-group "$RESOURCE_GROUP" \
        --name "$CLUSTER_NAME" \
        --overwrite-existing

    log "AKS cluster created successfully"
}

configure_azure_monitor() {
    log "Configuring Azure Monitor..."

    # Create Log Analytics workspace
    WORKSPACE_NAME="cretoai-logs-$(date +%s)"

    az monitor log-analytics workspace create \
        --resource-group "$RESOURCE_GROUP" \
        --workspace-name "$WORKSPACE_NAME" \
        --location "$AZURE_REGION" \
        --retention-time 2555

    # Enable Container Insights
    WORKSPACE_ID=$(az monitor log-analytics workspace show \
        --resource-group "$RESOURCE_GROUP" \
        --workspace-name "$WORKSPACE_NAME" \
        --query id \
        --output tsv)

    az aks enable-addons \
        --resource-group "$RESOURCE_GROUP" \
        --name "$CLUSTER_NAME" \
        --addons monitoring \
        --workspace-resource-id "$WORKSPACE_ID"

    log "Azure Monitor configured"
}

configure_network_security() {
    log "Configuring network security groups..."

    # Get AKS node resource group
    NODE_RG=$(az aks show \
        --resource-group "$RESOURCE_GROUP" \
        --name "$CLUSTER_NAME" \
        --query nodeResourceGroup \
        --output tsv)

    # Create NSG for consensus nodes
    NSG_NAME="cretoai-consensus-nsg"

    az network nsg create \
        --resource-group "$NODE_RG" \
        --name "$NSG_NAME" \
        --location "$AZURE_REGION"

    # Allow consensus gossip traffic
    az network nsg rule create \
        --resource-group "$NODE_RG" \
        --nsg-name "$NSG_NAME" \
        --name "allow-gossip" \
        --priority 100 \
        --source-address-prefixes VirtualNetwork \
        --destination-port-ranges 7946 \
        --access Allow \
        --protocol Tcp

    # Allow API traffic
    az network nsg rule create \
        --resource-group "$NODE_RG" \
        --nsg-name "$NSG_NAME" \
        --name "allow-api" \
        --priority 110 \
        --source-address-prefixes VirtualNetwork \
        --destination-port-ranges 8080 \
        --access Allow \
        --protocol Tcp

    log "Network security configured"
}

setup_application_gateway() {
    log "Setting up Application Gateway..."

    # Install Application Gateway Ingress Controller
    helm repo add application-gateway-kubernetes-ingress https://appgwingress.blob.core.windows.net/ingress-azure-helm-package/
    helm repo update

    # Get AKS details
    AKS_ID=$(az aks show \
        --resource-group "$RESOURCE_GROUP" \
        --name "$CLUSTER_NAME" \
        --query id \
        --output tsv)

    # Note: Application Gateway setup requires additional Azure resources
    # This is a simplified version - full implementation would require VNet integration

    log "Application Gateway configuration initiated"
}

configure_managed_identity() {
    log "Configuring managed identities..."

    # Create user-assigned managed identity
    IDENTITY_NAME="cretoai-phase7-identity"

    az identity create \
        --resource-group "$RESOURCE_GROUP" \
        --name "$IDENTITY_NAME"

    IDENTITY_ID=$(az identity show \
        --resource-group "$RESOURCE_GROUP" \
        --name "$IDENTITY_NAME" \
        --query id \
        --output tsv)

    IDENTITY_CLIENT_ID=$(az identity show \
        --resource-group "$RESOURCE_GROUP" \
        --name "$IDENTITY_NAME" \
        --query clientId \
        --output tsv)

    # Grant Key Vault access to managed identity
    az keyvault set-policy \
        --name "$KEY_VAULT_NAME" \
        --object-id "$(az identity show --resource-group $RESOURCE_GROUP --name $IDENTITY_NAME --query principalId --output tsv)" \
        --secret-permissions get list \
        --key-permissions get list decrypt encrypt

    log "Managed identity configured"
}

create_storage_account() {
    log "Creating Azure Blob Storage for multi-cloud replication..."

    STORAGE_ACCOUNT_NAME="cretoaiphase7$(date +%s | cut -c 6-10)"

    az storage account create \
        --name "$STORAGE_ACCOUNT_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --location "$AZURE_REGION" \
        --sku Standard_ZRS \
        --kind StorageV2 \
        --https-only true \
        --min-tls-version TLS1_2 \
        --allow-blob-public-access false \
        --encryption-services blob

    # Create container
    az storage container create \
        --name "cretoai-consensus-prod" \
        --account-name "$STORAGE_ACCOUNT_NAME" \
        --auth-mode login

    # Get connection string
    STORAGE_CONNECTION_STRING=$(az storage account show-connection-string \
        --name "$STORAGE_ACCOUNT_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --output tsv)

    log "Storage account created: $STORAGE_ACCOUNT_NAME"
    echo "$STORAGE_CONNECTION_STRING" > azure-storage-connection.txt
}

deploy_cretoai() {
    log "Deploying CretoAI Phase 7..."

    # Create namespace
    kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

    # Create secrets for Azure storage
    kubectl create secret generic azure-blob-credentials \
        --namespace "$NAMESPACE" \
        --from-literal=connection-string="$STORAGE_CONNECTION_STRING" \
        --dry-run=client -o yaml | kubectl apply -f -

    # Deploy using Helm
    helm upgrade --install "$HELM_RELEASE" ./charts/cretoai \
        --namespace "$NAMESPACE" \
        --values ./charts/cretoai/values-phase7.yaml \
        --set storage.multiCloud.secondary.storageAccount="$STORAGE_ACCOUNT_NAME" \
        --set storage.multiCloud.secondary.endpoint="https://${STORAGE_ACCOUNT_NAME}.blob.core.usgovcloudapi.net" \
        --wait \
        --timeout 15m

    log "CretoAI Phase 7 deployed successfully"
}

configure_monitoring() {
    log "Configuring Prometheus and Grafana..."

    # Install Prometheus
    helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
    helm repo update

    helm install prometheus prometheus-community/kube-prometheus-stack \
        --namespace monitoring \
        --create-namespace \
        --set prometheus.prometheusSpec.retention=30d \
        --set prometheus.prometheusSpec.storageSpec.volumeClaimTemplate.spec.resources.requests.storage=100Gi

    log "Monitoring configured"
}

validate_deployment() {
    log "Validating deployment..."

    # Check all pods are running
    kubectl wait --for=condition=Ready pods --all -n "$NAMESPACE" --timeout=600s

    # Run validation script
    if [ -f "./scripts/validate-deployment.sh" ]; then
        bash ./scripts/validate-deployment.sh
    fi

    log "Deployment validation completed"
}

print_summary() {
    log "Deployment Summary:"
    echo "===================="
    echo "Resource Group: $RESOURCE_GROUP"
    echo "Cluster Name: $CLUSTER_NAME"
    echo "Region: $AZURE_REGION"
    echo "Key Vault: $KEY_VAULT_NAME"
    echo "Storage Account: $STORAGE_ACCOUNT_NAME"
    echo "Namespace: $NAMESPACE"
    echo ""
    echo "Access the cluster:"
    echo "  az aks get-credentials --resource-group $RESOURCE_GROUP --name $CLUSTER_NAME"
    echo ""
    echo "View services:"
    echo "  kubectl get svc -n $NAMESPACE"
    echo ""
    echo "View pods:"
    echo "  kubectl get pods -n $NAMESPACE"
}

main() {
    log "Starting Azure Government deployment for CretoAI Phase 7"

    check_prerequisites
    create_resource_group
    create_key_vault
    create_aks_cluster
    configure_azure_monitor
    configure_network_security
    configure_managed_identity
    create_storage_account
    deploy_cretoai
    configure_monitoring
    validate_deployment
    print_summary

    log "Deployment completed successfully!"
}

main "$@"
