# AuthZ Engine Kubernetes Deployment Checklist

## Pre-Deployment Phase

### Infrastructure Preparation
- [ ] Kubernetes cluster version 1.21+ is available
- [ ] Cluster has minimum 3 worker nodes
- [ ] Each node has at least 2GB memory and 2 CPU cores
- [ ] kubectl is installed and configured
- [ ] kustomize is installed (v3.8+)
- [ ] Metrics server is installed in cluster
- [ ] NGINX Ingress Controller is installed
- [ ] Cert-Manager is installed

### Dependency Setup
- [ ] PostgreSQL 12+ is deployed and running
- [ ] PostgreSQL database `authz_engine` is created
- [ ] PostgreSQL user `authz` is created with proper permissions
- [ ] Redis 6+ is deployed and running
- [ ] Redis is accessible from Kubernetes pods
- [ ] Network connectivity verified between pods and databases

### Registry and Image Setup
- [ ] Docker image `authz-engine:latest` is available
- [ ] Image is pushed to container registry
- [ ] Image pull secrets are configured (if using private registry)
- [ ] Container image is tested locally

### Secrets and Configuration
- [ ] Database passwords are securely generated
- [ ] API keys and tokens are generated
- [ ] JWT secret is generated
- [ ] TLS certificates are obtained/generated
- [ ] All secrets are stored in a secrets management system
- [ ] Secrets are NOT committed to git

## Configuration Phase

### Kubernetes Resources
- [ ] Review and customize `namespace.yaml`
  - [ ] Namespace name is correct
  - [ ] Resource quotas are appropriate for environment
  - [ ] Network policies align with security requirements

- [ ] Review and customize `deployment.yaml`
  - [ ] Replica count is appropriate
  - [ ] Resource requests/limits are suitable
  - [ ] Image name and tag are correct
  - [ ] Health check endpoints are verified
  - [ ] Environment variables are configured

- [ ] Review and customize `service.yaml`
  - [ ] Service names are appropriate
  - [ ] Port numbers are correct
  - [ ] Service types are appropriate

- [ ] Review and customize `configmap.yaml`
  - [ ] Server configuration is complete
  - [ ] Policy configuration is complete
  - [ ] Feature flags are set correctly
  - [ ] Logging configuration is appropriate

- [ ] Review and customize `ingress.yaml`
  - [ ] Ingress hostnames match your domain
  - [ ] TLS certificate references are correct
  - [ ] Rate limiting is appropriate
  - [ ] CORS policies are correct
  - [ ] Cert-manager issuer is configured

- [ ] Review and customize `hpa.yaml`
  - [ ] Min/max replicas are appropriate
  - [ ] CPU threshold is suitable
  - [ ] Memory threshold is suitable
  - [ ] Metrics are available in cluster

- [ ] Review `pdb.yaml`
  - [ ] minAvailable is set correctly
  - [ ] Graceful shutdown period is appropriate

### Environment-Specific Configuration
- [ ] Development overlay is configured
- [ ] Staging overlay is configured
- [ ] Production overlay is configured
- [ ] Each environment has correct replica counts
- [ ] Each environment has correct resource limits
- [ ] Each environment has correct image tags

## Pre-Deployment Testing

### Local Testing
- [ ] Docker image builds successfully
- [ ] Docker image runs locally with proper configuration
- [ ] Health check endpoints respond correctly
- [ ] gRPC server starts and listens on correct port
- [ ] HTTP server starts and listens on correct port

### Manifest Validation
- [ ] Run `kubectl apply -f --dry-run=client` for all manifests
- [ ] Run `kustomize build` for each overlay without errors
- [ ] Lint YAML files for syntax errors
- [ ] Validate resource constraints with kubectlert

### Network Testing
- [ ] Test connectivity to PostgreSQL
- [ ] Test connectivity to Redis
- [ ] Test DNS resolution within cluster
- [ ] Test external HTTPS connectivity

## Deployment Phase

### Development Deployment
- [ ] Create development namespace: `kubectl apply -k overlays/dev/`
- [ ] Verify namespace creation: `kubectl get namespace authz-dev`
- [ ] Verify deployment: `kubectl get deployment -n authz-dev`
- [ ] Wait for pods to be ready: `kubectl get pods -n authz-dev -w`
- [ ] Check pod logs for startup: `kubectl logs -n authz-dev -l app=authz-engine`
- [ ] Verify liveness/readiness probes
- [ ] Test gRPC connectivity
- [ ] Test HTTP health endpoint

### Staging Deployment
- [ ] Create staging namespace: `kubectl apply -k overlays/staging/`
- [ ] Verify all resources are created
- [ ] Wait for all pods to be ready
- [ ] Verify HPA is scaling correctly
- [ ] Verify PDB is in place
- [ ] Load test the deployment
- [ ] Verify metrics are being collected
- [ ] Verify logs are being generated

### Production Deployment
- [ ] Schedule maintenance window
- [ ] Notify all stakeholders
- [ ] Create production namespace: `kubectl apply -k overlays/prod/`
- [ ] Monitor pod startup closely
- [ ] Verify all 3 replicas are ready
- [ ] Test gRPC endpoints with production client
- [ ] Test HTTP endpoints via ingress
- [ ] Verify TLS certificates are working
- [ ] Verify rate limiting is enforced
- [ ] Monitor CPU and memory usage
- [ ] Monitor network traffic
- [ ] Verify audit logs are being generated
- [ ] Verify monitoring/alerting is active

## Post-Deployment Verification

### Functionality Testing
- [ ] All endpoints are responding
- [ ] gRPC calls are successful
- [ ] REST API calls are successful
- [ ] Health check endpoints return 200 OK
- [ ] Metrics are being exported
- [ ] Logs are being generated correctly

### Performance Verification
- [ ] Pod startup time is acceptable
- [ ] Response latency is within SLA
- [ ] CPU usage is within limits
- [ ] Memory usage is within limits
- [ ] No OOMKilled pods
- [ ] No restart loops

### High Availability Testing
- [ ] Delete one pod and verify replacement
- [ ] Verify HPA scales up under load
- [ ] Verify HPA scales down when load reduces
- [ ] Verify PDB prevents simultaneous pod eviction
- [ ] Verify inter-pod communication works

### Monitoring and Alerting
- [ ] Prometheus is scraping metrics
- [ ] Grafana dashboard is working
- [ ] Alerts are being generated
- [ ] Logs are being aggregated
- [ ] Distributed tracing is working (if enabled)

## Documentation Phase

- [ ] Update internal documentation with deployment details
- [ ] Create runbooks for common operations
- [ ] Document scaling procedures
- [ ] Document backup/restore procedures
- [ ] Document disaster recovery procedures
- [ ] Document troubleshooting guides
- [ ] Share documentation with on-call team

## Rollout Phase

### Staged Rollout (for production)
- [ ] Deploy to 1 replica for canary testing
- [ ] Monitor canary for 1 hour
- [ ] Scale to 50% of production replicas
- [ ] Monitor for 2 hours
- [ ] Scale to 100% of production replicas
- [ ] Monitor for critical issues

### Post-Rollout
- [ ] Verify all pods are healthy
- [ ] Verify no error spikes in logs
- [ ] Verify no metric anomalies
- [ ] Verify no increase in latency
- [ ] Verify no increase in error rate
- [ ] Declare deployment successful

## Rollback Procedures (if needed)

- [ ] Identify issue
- [ ] Document issue
- [ ] Execute rollback: `kubectl rollout undo deployment/authz-engine -n authz-system`
- [ ] Monitor rollback progress
- [ ] Verify previous version is working
- [ ] Notify stakeholders
- [ ] Post-mortem analysis

## Ongoing Maintenance

### Daily Tasks
- [ ] Monitor pod health
- [ ] Monitor resource usage
- [ ] Check for restart loops
- [ ] Review recent logs for errors
- [ ] Monitor alert thresholds

### Weekly Tasks
- [ ] Review capacity metrics
- [ ] Review performance metrics
- [ ] Check for pending updates
- [ ] Review security advisories
- [ ] Test backup procedures

### Monthly Tasks
- [ ] Capacity planning review
- [ ] Security audit
- [ ] Disaster recovery drill
- [ ] Documentation update
- [ ] Performance optimization review

### Quarterly Tasks
- [ ] Major version updates
- [ ] Infrastructure audit
- [ ] Cost analysis
- [ ] Security assessment
- [ ] Compliance review

## Notes and Additional Considerations

- All database passwords and API keys should be managed via Kubernetes Secrets
- Use separate namespaces for different environments
- Implement proper RBAC policies
- Enable Pod Security Policies
- Monitor and alert on key metrics
- Keep cluster and applications up-to-date
- Maintain disaster recovery and backup procedures
- Regular security scanning and vulnerability assessment
- Load testing before production deployment
- Capacity planning based on growth projections
