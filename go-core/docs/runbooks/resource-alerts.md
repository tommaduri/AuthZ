# Resource Utilization Alert Runbook

This runbook provides diagnosis and resolution steps for resource utilization and error monitoring alerts.

---

## HighActiveRequests

### Summary
The number of concurrent authorization requests exceeds 100, indicating high system load.

### Severity
**INFO**

### Impact
- System under heavy load
- Potential resource exhaustion
- Increased latency risk
- Reduced throughput capacity
- May trigger other alerts (latency, errors)

### Diagnosis

1. **Check current active requests in Grafana**
   - Navigate to Authorization Service Dashboard → Active Requests panel
   - Review request rate and concurrency trends

2. **Query Prometheus for request metrics**
   ```promql
   # Current active requests
   authz_active_requests

   # Request rate (requests per second)
   rate(authz_checks_total[5m])

   # Average request duration
   rate(authz_check_duration_microseconds_sum[5m]) /
   rate(authz_checks_total[5m])

   # Request concurrency trend
   authz_active_requests [1h:]
   ```

3. **Analyze request distribution**
   ```bash
   # Check request patterns from logs
   kubectl logs -n authz-system deployment/authz-engine --tail=500 | \
     grep "authz_check" | jq '{resource: .resource, action: .action}'
   ```

4. **Verify system resources**
   ```bash
   # Check pod resources
   kubectl top pod -n authz-system -l app=authz-engine

   # Check CPU and memory usage
   kubectl describe pod -n authz-system -l app=authz-engine | grep -A 5 "Limits\|Requests"
   ```

5. **Check for traffic sources**
   ```promql
   # Request rate by service
   rate(authz_checks_total[5m]) by (service)

   # Request rate by client
   rate(authz_checks_total[5m]) by (client_id)
   ```

### Resolution

#### Immediate Mitigation

1. **Verify system is healthy**
   ```promql
   # Check error rate (should be low)
   (rate(authz_errors_total[5m]) / rate(authz_checks_total[5m])) * 100

   # Check latency (should be acceptable)
   histogram_quantile(0.99,
     rate(authz_check_duration_microseconds_bucket[5m])
   )
   ```

2. **Scale horizontally** (if resources allow)
   ```bash
   # Add more replicas to handle load
   kubectl scale deployment/authz-engine -n authz-system --replicas=8

   # Monitor scaling effect
   watch kubectl get pods -n authz-system -l app=authz-engine
   ```

3. **Check for traffic spikes**
   ```promql
   # Compare current rate to baseline
   rate(authz_checks_total[5m]) /
   rate(authz_checks_total[5m] offset 1h)
   ```

4. **Identify top requesters**
   ```bash
   # Find clients with highest request rates
   kubectl logs -n authz-system deployment/authz-engine --tail=1000 | \
     grep "authz_check" | jq -r '.client_id' | sort | uniq -c | sort -rn | head -10
   ```

5. **Enable rate limiting** (if abuse detected)
   ```bash
   # Implement rate limiting
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli config set-rate-limit --per-client=100/second
   ```

#### Root Cause Investigation

1. **Determine if load is organic**
   - Is this expected traffic growth?
   - Is this a scheduled event (e.g., batch job)?
   - Is this abnormal/malicious traffic?

2. **Analyze traffic patterns**
   ```promql
   # Request rate by hour of day
   rate(authz_checks_total[5m]) by (hour)

   # Request rate by resource type
   rate(authz_checks_total[5m]) by (resource_type)
   ```

3. **Check for inefficiencies**
   - Are clients making excessive authorization checks?
   - Are there redundant checks that could be cached?
   - Could batch authorization reduce load?

4. **Review recent changes**
   - New service deployments
   - Configuration changes
   - Client application updates

#### Long-term Fixes

1. **Implement horizontal autoscaling**
   ```yaml
   # Example: HPA based on active requests
   apiVersion: autoscaling/v2
   kind: HorizontalPodAutoscaler
   metadata:
     name: authz-engine-hpa
     namespace: authz-system
   spec:
     scaleTargetRef:
       apiVersion: apps/v1
       kind: Deployment
       name: authz-engine
     minReplicas: 3
     maxReplicas: 20
     metrics:
     - type: Pods
       pods:
         metric:
           name: authz_active_requests
         target:
           type: AverageValue
           averageValue: 50
     behavior:
       scaleUp:
         stabilizationWindowSeconds: 60
         policies:
         - type: Percent
           value: 50
           periodSeconds: 60
       scaleDown:
         stabilizationWindowSeconds: 300
         policies:
         - type: Pods
           value: 2
           periodSeconds: 60
   ```

2. **Optimize caching**
   - Increase cache size for frequently checked resources
   - Implement client-side caching with TTLs
   - Add cache warming for hot resources

3. **Implement batch authorization**
   ```go
   // Example: Batch authorization API
   type BatchCheckRequest struct {
       Checks []AuthorizationCheck `json:"checks"`
   }

   type BatchCheckResponse struct {
       Results []AuthorizationResult `json:"results"`
   }

   func (s *AuthzService) CheckBatch(ctx context.Context, req *BatchCheckRequest) (*BatchCheckResponse, error) {
       results := make([]AuthorizationResult, len(req.Checks))

       // Process checks in parallel
       var wg sync.WaitGroup
       for i, check := range req.Checks {
           wg.Add(1)
           go func(idx int, c AuthorizationCheck) {
               defer wg.Done()
               results[idx] = s.Check(ctx, &c)
           }(i, check)
       }
       wg.Wait()

       return &BatchCheckResponse{Results: results}, nil
   }
   ```

4. **Add rate limiting**
   ```yaml
   # Example: Rate limiting configuration
   rate_limiting:
     enabled: true
     global_limit: 10000/second
     per_client_limit: 100/second
     per_resource_limit: 500/second
     burst: 200
   ```

5. **Implement request prioritization**
   ```yaml
   # Example: Priority-based request handling
   request_prioritization:
     enabled: true
     queues:
       critical:
         weight: 0.5
         max_latency_ms: 5
       normal:
         weight: 0.4
         max_latency_ms: 10
       background:
         weight: 0.1
         max_latency_ms: 50
   ```

### Related Alerts
- **HighAuthorizationLatency**: High load can increase latency
- **HighErrorRate**: Resource exhaustion can cause errors
- **LowCacheHitRate**: High load may indicate cache inefficiency

### Inhibition Relationships
- None (this is an informational alert)

### Example PromQL Queries

```promql
# Current active requests
authz_active_requests

# Active requests trend over 6 hours
authz_active_requests [6h:]

# Request rate (requests per second)
rate(authz_checks_total[5m])

# Request concurrency ratio (active / rate)
authz_active_requests /
rate(authz_checks_total[5m])

# Peak active requests in last hour
max_over_time(authz_active_requests[1h])

# Average request duration
rate(authz_check_duration_microseconds_sum[5m]) /
rate(authz_checks_total[5m])

# Requests by service
rate(authz_checks_total[5m]) by (service)

# Top 10 requesters
topk(10, rate(authz_checks_total[5m]) by (client_id))
```

### Escalation
- **Self-serve**: This is informational; monitor and scale as needed
- **Escalate to on-call**: If active requests > 200 and system is degrading
- **Notify platform team**: For capacity planning if sustained high load

---

## AuthorizationDecisionImbalance

### Summary
More than 90% of authorization decisions are denials, indicating potential policy misconfiguration or unusual access patterns.

### Severity
**INFO**

### Impact
- Potential policy misconfiguration
- Users blocked from legitimate access
- Security concerns (excessive access attempts)
- User experience degradation
- Increased support tickets

### Diagnosis

1. **Check current decision distribution in Grafana**
   - Navigate to Authorization Service Dashboard → Decision Distribution panel
   - Review allow/deny ratio over time

2. **Query Prometheus for decision metrics**
   ```promql
   # Current deny rate (percentage)
   (rate(authz_checks_total{effect="deny"}[10m]) /
    rate(authz_checks_total[10m])) * 100

   # Deny rate trend
   (rate(authz_checks_total{effect="deny"}[10m]) /
    rate(authz_checks_total[10m])) * 100 [6h:]

   # Decisions by effect
   rate(authz_checks_total[10m]) by (effect)

   # Allow vs deny rate
   rate(authz_checks_total{effect="allow"}[10m]) /
   rate(authz_checks_total{effect="deny"}[10m])
   ```

3. **Analyze denial patterns**
   ```bash
   # Get recent denials
   kubectl logs -n authz-system deployment/authz-engine --tail=200 | \
     grep 'effect="deny"' | jq '{resource: .resource, action: .action, principal: .principal}'

   # Group denials by resource type
   kubectl logs -n authz-system deployment/authz-engine --tail=1000 | \
     grep 'effect="deny"' | jq -r '.resource_type' | sort | uniq -c | sort -rn

   # Group denials by action
   kubectl logs -n authz-system deployment/authz-engine --tail=1000 | \
     grep 'effect="deny"' | jq -r '.action' | sort | uniq -c | sort -rn
   ```

4. **Check for recent policy changes**
   ```bash
   # Review policy deployment logs
   kubectl logs -n authz-system deployment/authz-engine | \
     grep "policy_deployed\|policy_updated" | tail -50
   ```

5. **Identify affected users/services**
   ```bash
   # Find principals with high denial rates
   kubectl logs -n authz-system deployment/authz-engine --tail=1000 | \
     grep 'effect="deny"' | jq -r '.principal' | sort | uniq -c | sort -rn | head -20
   ```

### Resolution

#### Immediate Mitigation

1. **Determine if denials are expected**
   - Is this a security incident (attack, unauthorized access attempts)?
   - Is this a policy misconfiguration?
   - Is this a deployment/migration issue?

2. **For policy misconfiguration**:
   ```bash
   # Review recently deployed policies
   kubectl logs -n authz-system deployment/authz-engine | \
     grep "policy_deployed" | tail -20

   # Validate policy logic
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli policy validate --all
   ```

3. **For suspected security incident**:
   ```bash
   # Identify suspicious patterns
   kubectl logs -n authz-system deployment/authz-engine --tail=1000 | \
     grep 'effect="deny"' | jq '{principal: .principal, resource: .resource, count: 1}' | \
     jq -s 'group_by(.principal) | map({principal: .[0].principal, count: length})'

   # Block malicious actors if identified
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli blocklist add --principal="malicious-user"
   ```

4. **For migration/deployment issues**:
   ```bash
   # Check if specific services are affected
   kubectl logs -n authz-system deployment/authz-engine | \
     grep 'effect="deny"' | jq -r '.service' | sort | uniq -c | sort -rn

   # Rollback recent policy changes if needed
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli policy rollback --version=previous
   ```

#### Root Cause Investigation

1. **Analyze denial reasons**
   ```bash
   # Get denial reasons
   kubectl logs -n authz-system deployment/authz-engine --tail=1000 | \
     grep 'effect="deny"' | jq -r '.reason' | sort | uniq -c | sort -rn

   # Common reasons:
   # - "no matching policy"
   # - "explicit deny"
   # - "missing required attributes"
   # - "policy evaluation error"
   ```

2. **Check policy coverage**
   ```bash
   # Identify resources without policies
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli policy coverage --resource-type=all
   ```

3. **Review audit logs**
   ```bash
   # Get comprehensive audit trail
   kubectl logs -n authz-system deployment/authz-engine | \
     grep "audit_log" | jq 'select(.effect == "deny")' | tail -100
   ```

4. **Compare with historical baseline**
   ```promql
   # Compare current deny rate to baseline
   (rate(authz_checks_total{effect="deny"}[10m]) /
    rate(authz_checks_total[10m])) /
   (rate(authz_checks_total{effect="deny"}[10m] offset 24h) /
    rate(authz_checks_total[10m] offset 24h))
   ```

#### Long-term Fixes

1. **Improve policy coverage**
   ```bash
   # Generate coverage report
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli policy coverage --report=detailed

   # Add missing policies for uncovered resources
   ```

2. **Implement policy testing**
   ```yaml
   # Example: Policy test suite
   policy_tests:
     - name: "admin_can_access_all"
       principal:
         type: user
         role: admin
       resource:
         type: "*"
       action: "*"
       expected_effect: allow

     - name: "guest_cannot_delete"
       principal:
         type: user
         role: guest
       resource:
         type: "*"
       action: delete
       expected_effect: deny
   ```

3. **Add decision monitoring**
   ```yaml
   # Example: Decision ratio alerts
   alerting:
     decision_imbalance:
       deny_rate_threshold: 0.90
       duration: 10m
       notification_channels:
         - security-team
         - policy-admin
   ```

4. **Implement progressive policy rollout**
   ```yaml
   # Example: Canary deployment for policies
   policy_deployment:
     strategy: canary
     canary_percentage: 10
     monitoring_duration: 1h
     rollback_on_error_rate: 0.20
   ```

5. **Add policy simulation/dry-run**
   ```bash
   # Test policy changes before deployment
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli policy simulate --policy-file=new-policy.yaml --dry-run
   ```

### Related Alerts
- **HighErrorRate**: Policy errors may cause denials
- **PolicyNotFoundErrors**: Missing policies result in denials

### Inhibition Relationships
- None (this is an informational alert)

### Example PromQL Queries

```promql
# Current deny rate (percentage)
(rate(authz_checks_total{effect="deny"}[10m]) /
 rate(authz_checks_total[10m])) * 100

# Deny rate trend over 24 hours
(rate(authz_checks_total{effect="deny"}[10m]) /
 rate(authz_checks_total[10m])) * 100 [24h:]

# Allow vs deny counts
rate(authz_checks_total[10m]) by (effect)

# Deny rate by resource type
(rate(authz_checks_total{effect="deny"}[10m]) by (resource_type) /
 rate(authz_checks_total[10m]) by (resource_type)) * 100

# Deny rate by action
(rate(authz_checks_total{effect="deny"}[10m]) by (action) /
 rate(authz_checks_total[10m]) by (action)) * 100

# Compare to baseline (24h ago)
(rate(authz_checks_total{effect="deny"}[10m]) /
 rate(authz_checks_total[10m])) /
(rate(authz_checks_total{effect="deny"}[10m] offset 24h) /
 rate(authz_checks_total[10m] offset 24h))

# Total denials per second
rate(authz_checks_total{effect="deny"}[5m])
```

### Escalation
- **Self-serve**: If imbalance is explainable and expected
- **Escalate to security team**: If suspected security incident
- **Escalate to policy admin**: If policy misconfiguration is suspected

---

## CELEvaluationErrorsSpike

### Summary
CEL (Common Expression Language) evaluation errors are occurring at >10 errors/second, indicating policy syntax errors or runtime issues.

### Severity
**WARNING**

### Impact
- Authorization failures for affected policies
- Users denied access due to policy errors
- Potential security risks (fail-closed scenarios)
- Degraded system reliability
- Need for immediate policy review

### Diagnosis

1. **Check current error rate in Grafana**
   - Navigate to Authorization Service Dashboard → Error Types panel
   - Review CEL error trend

2. **Query Prometheus for CEL error metrics**
   ```promql
   # Current CEL error rate (per second)
   rate(authz_errors_total{type="cel_eval"}[5m])

   # CEL error percentage of total errors
   (rate(authz_errors_total{type="cel_eval"}[5m]) /
    rate(authz_errors_total[5m])) * 100

   # CEL errors trend
   rate(authz_errors_total{type="cel_eval"}[5m]) [6h:]
   ```

3. **Analyze CEL error logs**
   ```bash
   # Get recent CEL errors
   kubectl logs -n authz-system deployment/authz-engine --tail=200 | \
     grep "cel_eval_error" | jq '{policy: .policy_id, error: .error_message}'

   # Group errors by policy
   kubectl logs -n authz-system deployment/authz-engine --tail=1000 | \
     grep "cel_eval_error" | jq -r '.policy_id' | sort | uniq -c | sort -rn

   # Group errors by error type
   kubectl logs -n authz-system deployment/authz-engine --tail=1000 | \
     grep "cel_eval_error" | jq -r '.error_type' | sort | uniq -c | sort -rn
   ```

4. **Identify problematic policies**
   ```bash
   # Find policies with high error rates
   kubectl logs -n authz-system deployment/authz-engine --tail=1000 | \
     grep "cel_eval_error" | jq -r '.policy_id' | sort | uniq -c | sort -rn | head -10
   ```

5. **Check for recent policy changes**
   ```bash
   # Review recent policy deployments
   kubectl logs -n authz-system deployment/authz-engine | \
     grep "policy_deployed\|policy_updated" | tail -50
   ```

### Resolution

#### Immediate Mitigation

1. **Identify problematic policy**
   ```bash
   # Get most frequently failing policy
   kubectl logs -n authz-system deployment/authz-engine --tail=1000 | \
     grep "cel_eval_error" | jq -r '.policy_id' | sort | uniq -c | sort -rn | head -1
   ```

2. **Review policy definition**
   ```bash
   # Get policy details
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli policy get --id=<policy-id> --format=yaml
   ```

3. **Validate policy CEL expressions**
   ```bash
   # Validate specific policy
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli policy validate --id=<policy-id>
   ```

4. **Disable problematic policy** (if causing widespread failures)
   ```bash
   # Temporarily disable policy
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli policy disable --id=<policy-id>
   ```

5. **Rollback recent policy changes**
   ```bash
   # Rollback to previous version
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli policy rollback --id=<policy-id> --version=previous
   ```

#### Root Cause Investigation

1. **Analyze error types**
   Common CEL errors:
   - **Undefined attribute**: `no such key: 'user.department'`
   - **Type mismatch**: `type mismatch: expected string, got int`
   - **Syntax error**: `syntax error at line 3: unexpected token`
   - **Runtime error**: `division by zero`

2. **Check policy syntax**
   ```bash
   # Validate all policies
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli policy validate --all
   ```

3. **Review attribute availability**
   ```bash
   # Check if required attributes are provided
   kubectl logs -n authz-system deployment/authz-engine | \
     grep "cel_eval_error" | jq 'select(.error_type == "no_such_key")'
   ```

4. **Test policy with sample data**
   ```bash
   # Test policy evaluation
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli policy test --id=<policy-id> --input=test-context.json
   ```

#### Long-term Fixes

1. **Implement policy validation in CI/CD**
   ```yaml
   # Example: CI/CD validation step
   policy_validation:
     steps:
       - name: validate_syntax
         command: authz-cli policy validate --file=${POLICY_FILE}
       - name: test_policy
         command: authz-cli policy test --file=${POLICY_FILE} --test-suite=tests/
       - name: lint_cel
         command: cel-linter ${POLICY_FILE}
   ```

2. **Add comprehensive policy tests**
   ```yaml
   # Example: Policy test cases
   policy_tests:
     - name: "valid_user_attributes"
       context:
         principal:
           type: user
           id: "user123"
           attributes:
             department: "engineering"
             role: "developer"
       expected: no_error

     - name: "missing_attribute_handled"
       context:
         principal:
           type: user
           id: "user456"
           attributes:
             role: "developer"
             # department is missing
       expected: no_error  # Should handle gracefully
   ```

3. **Improve CEL expression safety**
   ```cel
   // Bad: Assumes attribute exists
   user.department == "engineering"

   // Good: Check existence first
   has(user.department) && user.department == "engineering"

   // Good: Use default value
   (has(user.department) ? user.department : "unknown") == "engineering"
   ```

4. **Add CEL expression linting**
   - Check for common anti-patterns
   - Enforce safe attribute access
   - Validate type compatibility

5. **Implement policy monitoring**
   ```yaml
   # Example: Policy health monitoring
   policy_monitoring:
     enabled: true
     metrics:
       - cel_evaluation_errors
       - policy_execution_time
       - policy_cache_hit_rate
     alerts:
       - condition: cel_errors > 10/minute
         action: notify_policy_admin
   ```

### Related Alerts
- **HighErrorRate**: CEL errors contribute to overall error rate
- **PolicyNotFoundErrors**: May occur alongside CEL errors

### Inhibition Relationships
- None (this alert provides specific error context)

### Example PromQL Queries

```promql
# Current CEL error rate (per second)
rate(authz_errors_total{type="cel_eval"}[5m])

# CEL error trend over 6 hours
rate(authz_errors_total{type="cel_eval"}[5m]) [6h:]

# CEL errors by policy
rate(authz_errors_total{type="cel_eval"}[5m]) by (policy_id)

# Top 10 policies with CEL errors
topk(10, rate(authz_errors_total{type="cel_eval"}[5m]) by (policy_id))

# CEL error percentage of total errors
(rate(authz_errors_total{type="cel_eval"}[5m]) /
 rate(authz_errors_total[5m])) * 100

# Compare to baseline
rate(authz_errors_total{type="cel_eval"}[5m]) /
rate(authz_errors_total{type="cel_eval"}[5m] offset 1h)
```

### Escalation
- **Escalate immediately**: To policy admin/author
- **Page on-call**: If error rate > 50/second or affecting critical policies
- **Notify security team**: If errors could impact authorization decisions

---

## PolicyNotFoundErrors

### Summary
Policy lookup errors are occurring at >5 errors/second, indicating missing policies or synchronization issues.

### Severity
**WARNING**

### Impact
- Authorization failures for affected resources
- Users denied access to resources
- Potential service degradation
- Incomplete policy coverage
- Security concerns (default deny behavior)

### Diagnosis

1. **Check current error rate in Grafana**
   - Navigate to Authorization Service Dashboard → Error Types panel
   - Review policy not found error trend

2. **Query Prometheus for policy error metrics**
   ```promql
   # Current policy not found error rate (per second)
   rate(authz_errors_total{type="policy_not_found"}[5m])

   # Policy error percentage
   (rate(authz_errors_total{type="policy_not_found"}[5m]) /
    rate(authz_errors_total[5m])) * 100

   # Error trend
   rate(authz_errors_total{type="policy_not_found"}[5m]) [6h:]
   ```

3. **Analyze policy lookup failures**
   ```bash
   # Get recent policy not found errors
   kubectl logs -n authz-system deployment/authz-engine --tail=200 | \
     grep "policy_not_found" | jq '{resource: .resource, action: .action, policy_id: .policy_id}'

   # Group errors by resource type
   kubectl logs -n authz-system deployment/authz-engine --tail=1000 | \
     grep "policy_not_found" | jq -r '.resource_type' | sort | uniq -c | sort -rn

   # Group errors by policy ID pattern
   kubectl logs -n authz-system deployment/authz-engine --tail=1000 | \
     grep "policy_not_found" | jq -r '.policy_id' | sort | uniq -c | sort -rn
   ```

4. **Check policy inventory**
   ```bash
   # List all active policies
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli policy list --status=active

   # Check policy count
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli policy list --count
   ```

5. **Verify policy synchronization**
   ```bash
   # Check policy sync status
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli policy sync-status
   ```

### Resolution

#### Immediate Mitigation

1. **Identify missing policies**
   ```bash
   # Get list of requested but missing policies
   kubectl logs -n authz-system deployment/authz-engine --tail=1000 | \
     grep "policy_not_found" | jq -r '.policy_id' | sort -u
   ```

2. **Check if policies were deleted**
   ```bash
   # Review policy deletion audit log
   kubectl logs -n authz-system deployment/authz-engine | \
     grep "policy_deleted" | tail -50
   ```

3. **Verify policy deployment**
   ```bash
   # Check recent policy deployments
   kubectl logs -n authz-system deployment/authz-engine | \
     grep "policy_deployed" | tail -50

   # Manually trigger policy sync
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli policy sync --force
   ```

4. **Check policy storage backend**
   ```bash
   # Verify database connectivity
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli db ping

   # Check policy storage health
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli policy storage-health
   ```

5. **Redeploy missing policies** (if identified)
   ```bash
   # Deploy missing policies
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli policy apply --file=missing-policies.yaml
   ```

#### Root Cause Investigation

1. **Analyze policy lifecycle**
   - Were policies deleted accidentally?
   - Did policy migration fail?
   - Is there a policy naming mismatch?

2. **Check for synchronization issues**
   ```bash
   # Compare policy count across instances
   kubectl exec -n authz-system deployment/authz-engine-0 -- \
     /app/authz-cli policy list --count

   kubectl exec -n authz-system deployment/authz-engine-1 -- \
     /app/authz-cli policy list --count
   ```

3. **Review policy deployment process**
   - Was there a failed deployment?
   - Are policies being deployed to correct namespace?
   - Is policy versioning working correctly?

4. **Check for resource-policy mapping issues**
   ```bash
   # Verify resource-to-policy mappings
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli policy mappings --resource-type=all
   ```

#### Long-term Fixes

1. **Implement policy coverage monitoring**
   ```yaml
   # Example: Policy coverage tracking
   policy_monitoring:
     coverage:
       enabled: true
       required_coverage: 95  # Percentage
       alert_on_missing: true
       report_frequency: daily
   ```

2. **Add policy deployment validation**
   ```yaml
   # Example: Deployment validation
   policy_deployment:
     validation:
       - check: policy_syntax
       - check: policy_coverage
       - check: policy_conflicts
       - check: backward_compatibility
     rollback_on_failure: true
   ```

3. **Implement policy synchronization**
   ```yaml
   # Example: Automatic policy sync
   policy_sync:
     enabled: true
     interval: 60s
     source: policy_store
     on_sync_failure:
       action: alert
       retry_interval: 30s
       max_retries: 5
   ```

4. **Add default/fallback policies**
   ```yaml
   # Example: Default policy for uncovered resources
   default_policy:
     enabled: true
     effect: deny  # Fail-closed by default
     log_level: warn
     notification:
       enabled: true
       message: "No policy found for resource, using default deny"
   ```

5. **Implement policy versioning**
   ```yaml
   # Example: Policy version control
   policy_versioning:
     enabled: true
     retain_versions: 10
     auto_rollback:
       enabled: true
       on_error_rate: 0.20
   ```

### Related Alerts
- **HighErrorRate**: Policy not found errors contribute to overall error rate
- **CELEvaluationErrorsSpike**: May occur alongside policy errors

### Inhibition Relationships
- None (this alert provides specific error context)

### Example PromQL Queries

```promql
# Current policy not found error rate (per second)
rate(authz_errors_total{type="policy_not_found"}[5m])

# Error trend over 6 hours
rate(authz_errors_total{type="policy_not_found"}[5m]) [6h:]

# Errors by resource type
rate(authz_errors_total{type="policy_not_found"}[5m]) by (resource_type)

# Compare to baseline
rate(authz_errors_total{type="policy_not_found"}[5m]) /
rate(authz_errors_total{type="policy_not_found"}[5m] offset 1h)

# Policy not found percentage of total errors
(rate(authz_errors_total{type="policy_not_found"}[5m]) /
 rate(authz_errors_total[5m])) * 100
```

### Escalation
- **Escalate immediately**: To policy admin
- **Page on-call**: If error rate > 20/second or affecting critical resources
- **Notify security team**: If missing policies could impact security posture

---

## VectorSearchTimeoutErrors

### Summary
Vector search timeout errors are occurring at >1 error/second, indicating performance issues in the vector store or semantic search.

### Severity
**WARNING**

### Impact
- Failed semantic policy searches
- Degraded authorization accuracy
- Fallback to non-semantic search methods
- Increased latency for affected requests
- Reduced search quality

### Diagnosis

1. **Check current timeout error rate in Grafana**
   - Navigate to Vector Store Dashboard → Error Types panel
   - Review timeout error trend

2. **Query Prometheus for timeout metrics**
   ```promql
   # Current timeout error rate (per second)
   rate(authz_vector_search_errors_total{type="timeout"}[5m])

   # Timeout percentage of vector errors
   (rate(authz_vector_search_errors_total{type="timeout"}[5m]) /
    rate(authz_vector_search_errors_total[5m])) * 100

   # Timeout trend
   rate(authz_vector_search_errors_total{type="timeout"}[5m]) [6h:]
   ```

3. **Check vector search latency**
   ```promql
   # Current p99 search latency
   histogram_quantile(0.99,
     rate(authz_vector_search_duration_milliseconds_bucket[5m])
   )

   # Searches exceeding timeout threshold
   sum(rate(authz_vector_search_duration_milliseconds_bucket{le="5000"}[5m]))
   ```

4. **Analyze timeout patterns**
   ```bash
   # Get recent timeout errors
   kubectl logs -n authz-system deployment/authz-engine --tail=200 | \
     grep "vector_search_timeout"

   # Check query complexity
   kubectl logs -n authz-system deployment/authz-engine | \
     grep "vector_search_timeout" | jq '{query_size: .query_vector_size, k: .k}'
   ```

5. **Verify vector store health**
   ```bash
   # Check vector store status
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store health
   ```

### Resolution

#### Immediate Mitigation

1. **Increase timeout threshold** (temporary)
   ```bash
   # Increase search timeout
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store config --search-timeout=10s
   ```

2. **Reduce search complexity** (if applicable)
   ```bash
   # Reduce number of results (k parameter)
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store config --default-k=50
   ```

3. **Scale vector store** (if resource-constrained)
   ```bash
   # Add more replicas
   kubectl scale deployment/vector-store -n authz-system --replicas=5
   ```

4. **Rebuild vector index** (if degraded)
   ```bash
   # Rebuild index for better performance
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store index rebuild
   ```

#### Root Cause Investigation

1. **Identify timeout causes**
   - Is vector index too large?
   - Is search algorithm inefficient?
   - Are there resource constraints?
   - Is network latency high?

2. **Check for related alerts**
   ```promql
   # Check if SlowVectorSearch is also firing
   histogram_quantile(0.99,
     rate(authz_vector_search_duration_milliseconds_bucket[5m])
   ) > 100
   ```

3. **Analyze index health**
   ```bash
   # Get index statistics
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store index stats
   ```

4. **Review recent changes**
   - Index configuration changes
   - Vector dimension changes
   - Search algorithm updates

#### Long-term Fixes

1. **Optimize search configuration**
   ```yaml
   # Example: Search optimization
   vector_store:
     search:
       timeout: 5s
       default_k: 100
       max_k: 500
       use_approximate: true
       approximate_threshold: 0.95
   ```

2. **Implement timeout handling**
   ```go
   // Example: Graceful timeout handling
   func (vs *VectorStore) SearchWithTimeout(ctx context.Context, query []float64, k int) ([]Result, error) {
       ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
       defer cancel()

       resultCh := make(chan searchResult)
       go func() {
           results, err := vs.search(ctx, query, k)
           resultCh <- searchResult{results: results, err: err}
       }()

       select {
       case res := <-resultCh:
           return res.results, res.err
       case <-ctx.Done():
           // Fallback to approximate search or cached results
           return vs.approximateSearch(query, k)
       }
   }
   ```

3. **Add progressive timeout**
   ```yaml
   # Example: Progressive search strategy
   vector_store:
     progressive_search:
       enabled: true
       stages:
         - timeout: 1s
           method: cache_lookup
         - timeout: 3s
           method: approximate_search
         - timeout: 5s
           method: exact_search
   ```

4. **Implement query optimization**
   - Pre-filter results before vector search
   - Use index partitioning
   - Implement query result caching

5. **Monitor and tune**
   ```promql
   # Set up predictive alerting
   predict_linear(rate(authz_vector_search_errors_total{type="timeout"}[30m]), 3600) > 5
   ```

### Related Alerts
- **SlowVectorSearch**: Slow searches lead to timeouts
- **HighVectorErrorRate**: Timeouts contribute to overall error rate
- **VectorIndexTooBig**: Large index contributes to slow search

### Inhibition Relationships
- SlowVectorSearch should inhibit this alert (slow search is root cause)

### Example PromQL Queries

```promql
# Current timeout error rate (per second)
rate(authz_vector_search_errors_total{type="timeout"}[5m])

# Timeout trend over 6 hours
rate(authz_vector_search_errors_total{type="timeout"}[5m]) [6h:]

# Timeout percentage of vector errors
(rate(authz_vector_search_errors_total{type="timeout"}[5m]) /
 rate(authz_vector_search_errors_total[5m])) * 100

# Correlation with search latency
histogram_quantile(0.99,
  rate(authz_vector_search_duration_milliseconds_bucket[5m])
)

# Compare to baseline
rate(authz_vector_search_errors_total{type="timeout"}[5m]) /
rate(authz_vector_search_errors_total{type="timeout"}[5m] offset 1h)
```

### Escalation
- **Self-serve**: If timeout rate < 5/second and improving
- **Escalate to on-call**: If timeout rate > 5/second or increasing
- **Engage infrastructure team**: For vector store infrastructure optimization
