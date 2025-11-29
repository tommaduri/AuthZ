#!/bin/bash
# CretoAI Phase 7 - AWS GovCloud Deployment Script
# Deploys CretoAI consensus system to AWS GovCloud with CMMC/FedRAMP compliance

set -e
set -o pipefail

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
AWS_REGION="${AWS_REGION:-us-gov-west-1}"
CLUSTER_NAME="${CLUSTER_NAME:-cretoai-phase7}"
NODE_TYPE="${NODE_TYPE:-m5.2xlarge}"
NODE_COUNT="${NODE_COUNT:-9}"
EKS_VERSION="${EKS_VERSION:-1.28}"
VPC_CIDR="${VPC_CIDR:-10.0.0.0/16}"
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

    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        error "AWS CLI is not installed. Please install it first."
    fi

    # Check eksctl
    if ! command -v eksctl &> /dev/null; then
        error "eksctl is not installed. Please install it first."
    fi

    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        error "kubectl is not installed. Please install it first."
    fi

    # Check helm
    if ! command -v helm &> /dev/null; then
        error "helm is not installed. Please install it first."
    fi

    # Verify AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        error "AWS credentials are not configured or invalid."
    fi

    log "All prerequisites satisfied"
}

create_kms_key() {
    log "Creating KMS key for encryption..."

    KMS_KEY_ID=$(aws kms create-key \
        --region "$AWS_REGION" \
        --description "CretoAI Phase 7 encryption key" \
        --key-policy file://<(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Enable IAM User Permissions",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws-us-gov:iam::$(aws sts get-caller-identity --query Account --output text):root"
      },
      "Action": "kms:*",
      "Resource": "*"
    },
    {
      "Sid": "Allow EKS to use the key",
      "Effect": "Allow",
      "Principal": {
        "Service": "eks.amazonaws.com"
      },
      "Action": [
        "kms:Decrypt",
        "kms:DescribeKey",
        "kms:CreateGrant"
      ],
      "Resource": "*"
    }
  ]
}
EOF
) \
        --query 'KeyMetadata.KeyId' \
        --output text)

    aws kms create-alias \
        --region "$AWS_REGION" \
        --alias-name "alias/cretoai-phase7" \
        --target-key-id "$KMS_KEY_ID"

    log "KMS key created: $KMS_KEY_ID"
    echo "$KMS_KEY_ID" > kms-key-id.txt
}

create_eks_cluster() {
    log "Creating EKS cluster in AWS GovCloud..."

    # Create cluster configuration
    cat > cluster-config.yaml <<EOF
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig

metadata:
  name: ${CLUSTER_NAME}
  region: ${AWS_REGION}
  version: "${EKS_VERSION}"

vpc:
  cidr: ${VPC_CIDR}
  clusterEndpoints:
    privateAccess: true
    publicAccess: false

secretsEncryption:
  keyARN: arn:aws-us-gov:kms:${AWS_REGION}:$(aws sts get-caller-identity --query Account --output text):key/${KMS_KEY_ID}

managedNodeGroups:
  - name: consensus-nodes
    instanceType: ${NODE_TYPE}
    desiredCapacity: ${NODE_COUNT}
    minSize: ${NODE_COUNT}
    maxSize: $((NODE_COUNT * 2))
    volumeSize: 500
    volumeType: gp3
    volumeEncrypted: true
    volumeKmsKeyID: ${KMS_KEY_ID}
    privateNetworking: true
    iam:
      withAddonPolicies:
        ebs: true
        efs: true
        cloudWatch: true
        xRay: true
    labels:
      role: consensus
      phase: "7"
    tags:
      Environment: production
      Compliance: "CMMC-L2,FedRAMP-Moderate"
    securityGroups:
      withShared: true
      withLocal: true

cloudWatch:
  clusterLogging:
    enableTypes: ["api", "audit", "authenticator", "controllerManager", "scheduler"]
    logRetentionInDays: 2555

addons:
  - name: vpc-cni
    version: latest
  - name: coredns
    version: latest
  - name: kube-proxy
    version: latest
  - name: aws-ebs-csi-driver
    version: latest
EOF

    eksctl create cluster -f cluster-config.yaml

    log "EKS cluster created successfully"
}

configure_cloudtrail() {
    log "Configuring CloudTrail for audit logging..."

    # Create S3 bucket for CloudTrail logs
    TRAIL_BUCKET="cretoai-cloudtrail-${AWS_REGION}"

    aws s3api create-bucket \
        --bucket "$TRAIL_BUCKET" \
        --region "$AWS_REGION" \
        --create-bucket-configuration LocationConstraint="$AWS_REGION" \
        --object-ownership BucketOwnerEnforced

    # Enable encryption
    aws s3api put-bucket-encryption \
        --bucket "$TRAIL_BUCKET" \
        --server-side-encryption-configuration '{
            "Rules": [{
                "ApplyServerSideEncryptionByDefault": {
                    "SSEAlgorithm": "aws:kms",
                    "KMSMasterKeyID": "'"$KMS_KEY_ID"'"
                }
            }]
        }'

    # Configure bucket policy
    aws s3api put-bucket-policy \
        --bucket "$TRAIL_BUCKET" \
        --policy file://<(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AWSCloudTrailAclCheck",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudtrail.amazonaws.com"
      },
      "Action": "s3:GetBucketAcl",
      "Resource": "arn:aws-us-gov:s3:::${TRAIL_BUCKET}"
    },
    {
      "Sid": "AWSCloudTrailWrite",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudtrail.amazonaws.com"
      },
      "Action": "s3:PutObject",
      "Resource": "arn:aws-us-gov:s3:::${TRAIL_BUCKET}/*",
      "Condition": {
        "StringEquals": {
          "s3:x-amz-acl": "bucket-owner-full-control"
        }
      }
    }
  ]
}
EOF
)

    # Create CloudTrail
    aws cloudtrail create-trail \
        --name "cretoai-phase7-trail" \
        --s3-bucket-name "$TRAIL_BUCKET" \
        --is-multi-region-trail \
        --enable-log-file-validation \
        --kms-key-id "$KMS_KEY_ID"

    aws cloudtrail start-logging \
        --name "cretoai-phase7-trail"

    log "CloudTrail configured successfully"
}

configure_vpc_security() {
    log "Configuring VPC security groups..."

    VPC_ID=$(aws eks describe-cluster \
        --name "$CLUSTER_NAME" \
        --region "$AWS_REGION" \
        --query 'cluster.resourcesVpcConfig.vpcId' \
        --output text)

    # Create security group for consensus nodes
    CONSENSUS_SG=$(aws ec2 create-security-group \
        --group-name "cretoai-consensus-sg" \
        --description "Security group for CretoAI consensus nodes" \
        --vpc-id "$VPC_ID" \
        --region "$AWS_REGION" \
        --query 'GroupId' \
        --output text)

    # Allow consensus gossip traffic
    aws ec2 authorize-security-group-ingress \
        --group-id "$CONSENSUS_SG" \
        --protocol tcp \
        --port 7946 \
        --source-group "$CONSENSUS_SG" \
        --region "$AWS_REGION"

    # Allow API traffic
    aws ec2 authorize-security-group-ingress \
        --group-id "$CONSENSUS_SG" \
        --protocol tcp \
        --port 8080 \
        --cidr "$VPC_CIDR" \
        --region "$AWS_REGION"

    log "VPC security groups configured"
}

setup_load_balancer() {
    log "Setting up Network Load Balancer..."

    # Install AWS Load Balancer Controller
    kubectl apply -k "github.com/aws/eks-charts/stable/aws-load-balancer-controller//crds?ref=master"

    helm repo add eks https://aws.github.io/eks-charts
    helm repo update

    helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
        --namespace kube-system \
        --set clusterName="$CLUSTER_NAME" \
        --set serviceAccount.create=true \
        --set region="$AWS_REGION" \
        --set vpcId="$VPC_ID"

    log "Load Balancer Controller installed"
}

configure_tls() {
    log "Configuring TLS certificates..."

    # Install cert-manager
    kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

    # Wait for cert-manager to be ready
    kubectl wait --for=condition=Available --timeout=300s deployment/cert-manager -n cert-manager
    kubectl wait --for=condition=Available --timeout=300s deployment/cert-manager-webhook -n cert-manager
    kubectl wait --for=condition=Available --timeout=300s deployment/cert-manager-cainjector -n cert-manager

    # Create ClusterIssuer for Let's Encrypt
    kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@cretoai.io
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
EOF

    log "TLS configuration completed"
}

deploy_cretoai() {
    log "Deploying CretoAI Phase 7..."

    # Create namespace
    kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

    # Create secrets
    kubectl create secret generic cretoai-secrets \
        --namespace "$NAMESPACE" \
        --from-literal=kms-key-id="$KMS_KEY_ID" \
        --dry-run=client -o yaml | kubectl apply -f -

    # Deploy using Helm
    helm upgrade --install "$HELM_RELEASE" ./charts/cretoai \
        --namespace "$NAMESPACE" \
        --values ./charts/cretoai/values-phase7.yaml \
        --set storage.multiCloud.primary.kmsKeyId="arn:aws-us-gov:kms:${AWS_REGION}:$(aws sts get-caller-identity --query Account --output text):key/${KMS_KEY_ID}" \
        --set storage.multiCloud.primary.region="$AWS_REGION" \
        --wait \
        --timeout 15m

    log "CretoAI Phase 7 deployed successfully"
}

configure_monitoring() {
    log "Configuring monitoring and observability..."

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
    echo "Cluster Name: $CLUSTER_NAME"
    echo "Region: $AWS_REGION"
    echo "KMS Key ID: $KMS_KEY_ID"
    echo "Namespace: $NAMESPACE"
    echo "Helm Release: $HELM_RELEASE"
    echo ""
    echo "Access the cluster:"
    echo "  aws eks update-kubeconfig --name $CLUSTER_NAME --region $AWS_REGION"
    echo ""
    echo "View services:"
    echo "  kubectl get svc -n $NAMESPACE"
    echo ""
    echo "View pods:"
    echo "  kubectl get pods -n $NAMESPACE"
    echo ""
    echo "Access compliance dashboard:"
    echo "  kubectl port-forward -n $NAMESPACE svc/compliance-dashboard 3000:3000"
}

main() {
    log "Starting AWS GovCloud deployment for CretoAI Phase 7"

    check_prerequisites
    create_kms_key
    create_eks_cluster
    configure_cloudtrail
    configure_vpc_security
    setup_load_balancer
    configure_tls
    deploy_cretoai
    configure_monitoring
    validate_deployment
    print_summary

    log "Deployment completed successfully!"
}

main "$@"
