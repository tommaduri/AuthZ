# Authorization Service Alert Runbook

This runbook provides diagnosis and resolution steps for authorization service SLO violations.

---

## HighAuthorizationLatency

### Summary
Authorization p99 latency exceeds the 10µs SLO target, indicating performance degradation in authorization checks.

### Severity
**CRITICAL**

### Impact
- User-facing latency increases
- Potential request timeouts
- Degraded application performance
- Possible cascading failures in dependent services
- Risk of triggering circuit breakers

### Diagnosis

1. **Check current latency in Grafana**
   - Navigate to Authorization Service Dashboard → Latency panel
   - Verify p99 latency metric
   - Compare with p50 and p95 to identify distribution

2. **Query Prometheus for current value**
   ```promql
   # Current p99 latency
   histogram_quantile(0.99,
     rate(authz_check_duration_microseconds_bucket[2m])
   )

   # Compare with historical baseline
   histogram_quantile(0.99,
     rate(authz_check_duration_microseconds_bucket[2m])
   ) /
   histogram_quantile(0.99,
     rate(authz_check_duration_microseconds_bucket[2m] offset 1h)
   )

   # Latency by operation type
   histogram_quantile(0.99,
     rate(authz_check_duration_microseconds_bucket[2m])
   ) by (operation)
   ```

3. **Check cache hit rate**
   ```promql
   # Cache hit rate (may correlate with latency)
   rate(authz_cache_hits_total[5m]) /
   (rate(authz_cache_hits_total[5m]) + rate(authz_cache_misses_total[5m]))
   ```

4. **Review service logs**
   ```bash
   # Check for errors or slow operations
   kubectl logs -n authz-system deployment/authz-engine --tail=100 | grep -i "slow\|timeout\|error"

   # Look for specific slow requests
   kubectl logs -n authz-system deployment/authz-engine --tail=500 | grep "duration_us" | sort -t: -k2 -n | tail -20
   ```

5. **Verify system resources**
   ```promql
   # CPU usage
   rate(process_cpu_seconds_total{job="authz-engine"}[5m])

   # Memory usage
   process_resident_memory_bytes{job="authz-engine"}

   # Active requests
   authz_active_requests
   ```

### Resolution

#### Immediate Mitigation

1. **Check for resource exhaustion**
   - If CPU > 80%: Scale horizontally (add more pods)
   - If memory > 85%: Investigate memory leaks or increase limits

2. **Verify cache configuration**
   ```bash
   # Check cache size and eviction rate
   kubectl exec -n authz-system deployment/authz-engine -- /app/authz-cli cache stats
   ```
   - If cache hit rate < 70%, consider increasing cache size

3. **Review recent deployments**
   - Rollback if latency spike correlates with recent deployment
   ```bash
   kubectl rollout history deployment/authz-engine -n authz-system
   kubectl rollout undo deployment/authz-engine -n authz-system
   ```

#### Root Cause Investigation

1. **Analyze slow requests**
   - Enable detailed tracing (if not already enabled)
   - Identify specific policy types or operations causing slowdowns

2. **Check for N+1 queries or inefficient policy evaluation**
   - Review CEL expressions for complexity
   - Look for policies with excessive attribute lookups

3. **Database query performance** (if using external policy store)
   ```promql
   # Check database query latency
   histogram_quantile(0.99,
     rate(authz_db_query_duration_seconds_bucket[5m])
   )
   ```

#### Long-term Fixes

1. **Optimize policy evaluation**
   - Refactor complex CEL expressions
   - Add indexes to policy store
   - Consider policy compilation/caching strategies

2. **Tune cache settings**
   - Increase cache TTL for stable policies
   - Implement hierarchical caching (L1/L2)
   - Add cache warming for frequently accessed policies

3. **Horizontal scaling**
   - Configure HPA (Horizontal Pod Autoscaler) if not present
   ```yaml
   # Example HPA configuration
   apiVersion: autoscaling/v2
   kind: HorizontalPodAutoscaler
   metadata:
     name: authz-engine-hpa
   spec:
     scaleTargetRef:
       apiVersion: apps/v1
       kind: Deployment
       name: authz-engine
     minReplicas: 3
     maxReplicas: 10
     metrics:
     - type: Pods
       pods:
         metric:
           name: authz_check_duration_microseconds
         target:
           type: AverageValue
           averageValue: 8
   ```

### Related Alerts
- **LowCacheHitRate**: Often fires together; low cache hits cause higher latency
- **HighActiveRequests**: High load can contribute to latency
- **HighErrorRate**: Errors in policy evaluation can increase latency
- **VectorSearchTimeoutErrors**: If using vector search, timeouts impact latency

### Inhibition Relationships
- This alert inhibits lower-severity performance alerts when firing

### Example PromQL Queries

```promql
# Current p99 latency
histogram_quantile(0.99, rate(authz_check_duration_microseconds_bucket[2m]))

# Latency trend over 1 hour
histogram_quantile(0.99, rate(authz_check_duration_microseconds_bucket[2m])) [1h:]

# Compare with SLO target
(histogram_quantile(0.99, rate(authz_check_duration_microseconds_bucket[2m])) / 10) - 1

# Latency by service instance
histogram_quantile(0.99, rate(authz_check_duration_microseconds_bucket[2m])) by (instance)

# Correlation with cache miss rate
(1 - rate(authz_cache_hits_total[5m]) /
     (rate(authz_cache_hits_total[5m]) + rate(authz_cache_misses_total[5m])))
* 100
```

### Escalation
- **Self-serve**: If latency < 15µs and stable, follow mitigation steps
- **Escalate to on-call**: If latency > 20µs, trending upward, or accompanied by errors
- **Page SRE**: If latency > 50µs or service is degraded for > 10 minutes

---

## HighErrorRate

### Summary
Authorization error rate exceeds 5%, indicating systemic failures in authorization checks.

### Severity
**CRITICAL**

### Impact
- Users experiencing authorization failures
- Blocked access to protected resources
- Potential security incidents (fail-open scenarios)
- Application functionality degraded or broken
- Customer complaints and support tickets

### Diagnosis

1. **Check current error rate in Grafana**
   - Navigate to Authorization Service Dashboard → Error Rate panel
   - Identify error types and distribution

2. **Query Prometheus for error rate**
   ```promql
   # Current error rate
   (rate(authz_errors_total[5m]) / rate(authz_checks_total[5m])) * 100

   # Error rate by type
   rate(authz_errors_total[5m]) by (type)

   # Top error types
   topk(5, sum by (type) (rate(authz_errors_total[5m])))
   ```

3. **Analyze error types**
   ```promql
   # CEL evaluation errors
   rate(authz_errors_total{type="cel_eval"}[5m])

   # Policy not found errors
   rate(authz_errors_total{type="policy_not_found"}[5m])

   # Timeout errors
   rate(authz_errors_total{type="timeout"}[5m])

   # Internal errors
   rate(authz_errors_total{type="internal"}[5m])
   ```

4. **Review error logs**
   ```bash
   # Get recent error logs
   kubectl logs -n authz-system deployment/authz-engine --tail=200 | grep -i "error\|failed"

   # Group errors by type
   kubectl logs -n authz-system deployment/authz-engine --tail=1000 | \
     grep "error_type" | awk '{print $NF}' | sort | uniq -c | sort -rn
   ```

5. **Check service health**
   ```promql
   # Service uptime
   up{job="authz-engine"}

   # Request success rate
   rate(authz_checks_total[5m]) - rate(authz_errors_total[5m])
   ```

### Resolution

#### Immediate Mitigation

1. **Identify dominant error type** from diagnosis queries

2. **For CEL evaluation errors** (`cel_eval`):
   ```bash
   # Check recent policy changes
   kubectl logs -n authz-system deployment/authz-engine | grep "policy_deployed"

   # Validate CEL syntax in recent policies
   kubectl exec -n authz-system deployment/authz-engine -- /app/authz-cli policy validate
   ```
   - Rollback problematic policy if identified

3. **For policy not found errors** (`policy_not_found`):
   - Verify policy deployment completed
   - Check policy synchronization status
   ```bash
   kubectl exec -n authz-system deployment/authz-engine -- /app/authz-cli policy list
   ```

4. **For timeout errors**:
   - Check downstream service health (vector store, policy DB)
   - Temporarily increase timeout thresholds

5. **For internal errors**:
   - Check for panic/crashes in logs
   - Verify service dependencies are healthy
   - Consider rolling restart if errors are persistent

#### Root Cause Investigation

1. **Correlate with deployments**
   ```bash
   # Check deployment history
   kubectl rollout history deployment/authz-engine -n authz-system

   # Compare error rate before/after deployment
   ```

2. **Analyze error patterns**
   - Are errors specific to certain resources, actions, or principals?
   - Are errors transient or persistent?
   - Do errors correlate with load spikes?

3. **Review policy changes**
   ```bash
   # Audit policy change log
   kubectl logs -n authz-system deployment/authz-engine | grep "policy_change"
   ```

#### Long-term Fixes

1. **Implement policy validation in CI/CD**
   - Add pre-deployment CEL syntax validation
   - Test policies against known scenarios
   - Implement canary deployments for policy changes

2. **Improve error handling**
   - Add retry logic for transient failures
   - Implement circuit breakers for failing dependencies
   - Add fallback policies for critical paths

3. **Monitoring improvements**
   - Add alerting for specific error types
   - Create error rate SLI/SLO dashboards per service
   - Implement error budgets

4. **Policy governance**
   - Establish policy review process
   - Add automated policy testing
   - Document common error scenarios

### Related Alerts
- **CELEvaluationErrorsSpike**: Specific to CEL errors
- **PolicyNotFoundErrors**: Specific to missing policies
- **HighAuthorizationLatency**: Errors can increase latency
- **VectorSearchTimeoutErrors**: Timeouts contribute to error rate

### Inhibition Relationships
- This alert inhibits specific error-type alerts (CELEvaluationErrorsSpike, PolicyNotFoundErrors)

### Example PromQL Queries

```promql
# Total error rate
(rate(authz_errors_total[5m]) / rate(authz_checks_total[5m])) * 100

# Error rate trend over 1 hour
(rate(authz_errors_total[5m]) / rate(authz_checks_total[5m])) * 100 [1h:]

# Error breakdown by type (percentage)
(rate(authz_errors_total[5m]) by (type) /
 on() group_left sum(rate(authz_errors_total[5m]))) * 100

# Compare current vs baseline error rate
(rate(authz_errors_total[5m]) / rate(authz_checks_total[5m])) /
(rate(authz_errors_total[5m] offset 1h) / rate(authz_checks_total[5m] offset 1h))

# Errors per second by service instance
rate(authz_errors_total[5m]) by (instance)
```

### Escalation
- **Self-serve**: If error rate < 10% and error type is known (e.g., policy syntax)
- **Escalate to on-call**: If error rate > 10% or cause is unclear
- **Page SRE + Security**: If errors indicate potential security misconfiguration

---

## LowCacheHitRate

### Summary
Cache hit rate has fallen below 70%, causing increased latency and load on the policy engine.

### Severity
**WARNING**

### Impact
- Increased authorization latency
- Higher CPU utilization for policy evaluation
- Increased load on policy storage backend
- Reduced throughput capacity
- Higher costs for policy lookups

### Diagnosis

1. **Check current cache hit rate in Grafana**
   - Navigate to Authorization Service Dashboard → Cache Performance panel
   - Review hit/miss ratio over time

2. **Query Prometheus for cache metrics**
   ```promql
   # Current cache hit rate
   (rate(authz_cache_hits_total[10m]) /
    (rate(authz_cache_hits_total[10m]) + rate(authz_cache_misses_total[10m]))) * 100

   # Cache hit rate trend
   (rate(authz_cache_hits_total[10m]) /
    (rate(authz_cache_hits_total[10m]) + rate(authz_cache_misses_total[10m]))) * 100 [6h:]

   # Cache miss rate
   rate(authz_cache_misses_total[10m])

   # Cache eviction rate
   rate(authz_cache_evictions_total[10m])
   ```

3. **Analyze cache statistics**
   ```bash
   # Get cache stats from service
   kubectl exec -n authz-system deployment/authz-engine -- /app/authz-cli cache stats

   # Output includes:
   # - Cache size (current/max)
   # - Hit rate
   # - Eviction rate
   # - Average entry age
   ```

4. **Check for cache churn**
   ```promql
   # Cache churn rate (evictions per second)
   rate(authz_cache_evictions_total[5m])

   # Cache size utilization
   authz_cache_size_bytes / authz_cache_max_size_bytes
   ```

5. **Review access patterns**
   ```bash
   # Check for policy access pattern changes
   kubectl logs -n authz-system deployment/authz-engine --tail=1000 | \
     grep "cache_miss" | awk '{print $NF}' | sort | uniq -c | sort -rn | head -20
   ```

### Resolution

#### Immediate Mitigation

1. **Verify cache configuration**
   ```bash
   # Check current cache size
   kubectl get configmap authz-config -n authz-system -o yaml | grep cache
   ```

2. **Increase cache size** (if safe to do so)
   ```yaml
   # Example: Update ConfigMap
   apiVersion: v1
   kind: ConfigMap
   metadata:
     name: authz-config
     namespace: authz-system
   data:
     cache_max_size_mb: "512"  # Increase from 256MB
     cache_ttl_seconds: "300"
   ```

3. **Restart service to apply changes**
   ```bash
   kubectl rollout restart deployment/authz-engine -n authz-system
   ```

#### Root Cause Investigation

1. **Identify cache miss patterns**
   - Are misses evenly distributed or concentrated on specific policies?
   - Has the working set size increased?
   - Are there new access patterns?

2. **Check for policy churn**
   ```bash
   # Review recent policy updates
   kubectl logs -n authz-system deployment/authz-engine | grep "policy_update" | tail -50
   ```
   - Frequent policy updates invalidate cache entries

3. **Analyze request distribution**
   ```promql
   # Request rate by policy
   rate(authz_checks_total[10m]) by (policy_id)

   # Long tail of infrequently accessed policies
   count(rate(authz_checks_total[10m]) by (policy_id) < 0.1)
   ```

4. **Check for cache poisoning or abuse**
   - Look for unusual access patterns
   - Check for requests with varying context that defeat caching

#### Long-term Fixes

1. **Optimize cache configuration**
   - **Increase cache size**: Allocate more memory if available
   - **Tune TTL**: Longer TTL for stable policies, shorter for dynamic policies
   - **Implement cache tiers**: L1 (hot) + L2 (warm) caching strategy

2. **Improve cache efficiency**
   ```yaml
   # Example: Differentiated caching by policy type
   cache:
     static_policies:
       ttl: 3600s  # 1 hour for rarely-changing policies
     dynamic_policies:
       ttl: 60s    # 1 minute for frequently-changing policies
     default_ttl: 300s
   ```

3. **Implement cache warming**
   - Pre-populate cache with frequently accessed policies on startup
   - Proactive cache refresh before expiration

4. **Policy optimization**
   - Reduce policy proliferation (consolidate similar policies)
   - Implement policy hierarchies to reduce unique cache keys
   - Use policy templates for similar resources

5. **Monitor and adjust**
   - Set up alerting for cache hit rate degradation
   - Regularly review cache statistics
   - Implement A/B testing for cache configuration changes

### Related Alerts
- **HighAuthorizationLatency**: Low cache hit rate causes higher latency
- **HighActiveRequests**: Cache misses increase request duration
- **EmbeddingCacheHitRateLow**: Similar cache issues in embedding pipeline

### Inhibition Relationships
- None (this alert does not inhibit others)

### Example PromQL Queries

```promql
# Current cache hit rate (percentage)
(rate(authz_cache_hits_total[10m]) /
 (rate(authz_cache_hits_total[10m]) + rate(authz_cache_misses_total[10m]))) * 100

# Cache hit rate by service instance
(rate(authz_cache_hits_total[10m]) by (instance) /
 (rate(authz_cache_hits_total[10m]) by (instance) +
  rate(authz_cache_misses_total[10m]) by (instance))) * 100

# Cache efficiency trend (6 hour window)
(rate(authz_cache_hits_total[10m]) /
 (rate(authz_cache_hits_total[10m]) + rate(authz_cache_misses_total[10m]))) * 100 [6h:]

# Cache miss rate (per second)
rate(authz_cache_misses_total[5m])

# Cache eviction rate
rate(authz_cache_evictions_total[5m])

# Cache pressure (evictions / inserts ratio)
rate(authz_cache_evictions_total[5m]) / rate(authz_cache_inserts_total[5m])

# Compare hit rate to baseline
(rate(authz_cache_hits_total[10m]) /
 (rate(authz_cache_hits_total[10m]) + rate(authz_cache_misses_total[10m]))) /
(rate(authz_cache_hits_total[10m] offset 24h) /
 (rate(authz_cache_hits_total[10m] offset 24h) + rate(authz_cache_misses_total[10m] offset 24h)))
```

### Escalation
- **Self-serve**: If hit rate > 60% and stable, apply configuration tuning
- **Escalate to on-call**: If hit rate < 50% or trending down rapidly
- **Consult platform team**: For architectural changes (e.g., distributed caching)

---

## AuthorizationServiceDown

### Summary
The authorization service is unreachable or not responding to health checks.

### Severity
**CRITICAL**

### Impact
- **COMPLETE SERVICE OUTAGE**: All authorization checks fail
- Applications unable to verify permissions
- Users blocked from accessing protected resources
- Potential security incidents if fail-open fallbacks are triggered
- Business operations halted

### Diagnosis

1. **Verify service status**
   ```bash
   # Check pod status
   kubectl get pods -n authz-system -l app=authz-engine

   # Check deployment status
   kubectl get deployment authz-engine -n authz-system

   # Check service endpoints
   kubectl get endpoints authz-engine -n authz-system
   ```

2. **Query Prometheus for uptime**
   ```promql
   # Service up/down status
   up{job="authz-engine"}

   # Time since last successful scrape
   time() - process_start_time_seconds{job="authz-engine"}

   # Number of healthy instances
   count(up{job="authz-engine"} == 1)
   ```

3. **Check pod logs**
   ```bash
   # Recent logs from all pods
   kubectl logs -n authz-system -l app=authz-engine --tail=100

   # Check for crash loops
   kubectl describe pod -n authz-system -l app=authz-engine | grep -i "restart\|error"
   ```

4. **Verify resource constraints**
   ```bash
   # Check if pods are OOMKilled or CPU throttled
   kubectl describe pod -n authz-system -l app=authz-engine | grep -A 5 "State:"

   # Check node resources
   kubectl top nodes
   kubectl top pods -n authz-system
   ```

5. **Check network connectivity**
   ```bash
   # Test service endpoint from another pod
   kubectl run test-pod --image=curlimages/curl -i --rm --restart=Never -- \
     curl -v http://authz-engine.authz-system.svc.cluster.local:8080/health
   ```

### Resolution

#### Immediate Mitigation

1. **Check pod health**
   ```bash
   # Get pod status
   kubectl get pods -n authz-system -l app=authz-engine
   ```

   - **If pods are CrashLoopBackOff**:
     ```bash
     # Check logs for crash reason
     kubectl logs -n authz-system -l app=authz-engine --previous

     # Common issues:
     # - Configuration errors
     # - Missing dependencies (DB, vector store)
     # - Resource limits too low
     ```

   - **If pods are Pending**:
     ```bash
     # Check why pods aren't scheduled
     kubectl describe pod -n authz-system -l app=authz-engine

     # Common issues:
     # - Insufficient cluster resources
     # - Node selector/affinity issues
     # - PersistentVolume claims not bound
     ```

   - **If pods are OOMKilled**:
     ```bash
     # Increase memory limits
     kubectl set resources deployment/authz-engine -n authz-system --limits=memory=2Gi
     ```

2. **Restart deployment** (if pods are in bad state)
   ```bash
   kubectl rollout restart deployment/authz-engine -n authz-system

   # Monitor rollout
   kubectl rollout status deployment/authz-engine -n authz-system
   ```

3. **Scale up replicas** (if some pods are healthy)
   ```bash
   # Increase replica count temporarily
   kubectl scale deployment/authz-engine -n authz-system --replicas=5
   ```

4. **Check for recent changes**
   ```bash
   # Review recent deployments
   kubectl rollout history deployment/authz-engine -n authz-system

   # Rollback if necessary
   kubectl rollout undo deployment/authz-engine -n authz-system
   ```

#### Root Cause Investigation

1. **Analyze service logs**
   ```bash
   # Get comprehensive logs
   kubectl logs -n authz-system deployment/authz-engine --all-containers --tail=500

   # Look for startup errors
   kubectl logs -n authz-system deployment/authz-engine | grep -i "fatal\|panic\|error" | head -50
   ```

2. **Check dependencies**
   ```bash
   # Verify database connectivity
   kubectl exec -n authz-system deployment/authz-engine -- /app/authz-cli db ping

   # Verify vector store connectivity
   kubectl exec -n authz-system deployment/authz-engine -- /app/authz-cli vector-store health
   ```

3. **Review configuration**
   ```bash
   # Check ConfigMap
   kubectl get configmap authz-config -n authz-system -o yaml

   # Check Secrets
   kubectl get secret authz-secrets -n authz-system -o yaml
   ```

4. **Check for resource exhaustion**
   ```promql
   # CPU usage before crash
   rate(process_cpu_seconds_total{job="authz-engine"}[5m] offset 5m)

   # Memory usage before crash
   process_resident_memory_bytes{job="authz-engine"} offset 5m
   ```

#### Long-term Fixes

1. **Improve service resilience**
   ```yaml
   # Example: Enhanced deployment configuration
   apiVersion: apps/v1
   kind: Deployment
   metadata:
     name: authz-engine
   spec:
     replicas: 3  # Minimum 3 for HA
     strategy:
       type: RollingUpdate
       rollingUpdate:
         maxUnavailable: 1
         maxSurge: 1
     template:
       spec:
         containers:
         - name: authz-engine
           resources:
             requests:
               memory: "512Mi"
               cpu: "500m"
             limits:
               memory: "2Gi"
               cpu: "2000m"
           livenessProbe:
             httpGet:
               path: /health
               port: 8080
             initialDelaySeconds: 30
             periodSeconds: 10
             timeoutSeconds: 5
             failureThreshold: 3
           readinessProbe:
             httpGet:
               path: /ready
               port: 8080
             initialDelaySeconds: 10
             periodSeconds: 5
             timeoutSeconds: 3
             failureThreshold: 2
   ```

2. **Implement circuit breakers** for dependencies
   - Add timeout and retry logic for database calls
   - Implement graceful degradation for vector store failures

3. **Add PodDisruptionBudget**
   ```yaml
   apiVersion: policy/v1
   kind: PodDisruptionBudget
   metadata:
     name: authz-engine-pdb
     namespace: authz-system
   spec:
     minAvailable: 2
     selector:
       matchLabels:
         app: authz-engine
   ```

4. **Improve monitoring**
   - Add synthetic checks for service availability
   - Implement more granular health checks
   - Set up multi-region failover (if applicable)

5. **Implement chaos engineering**
   - Regular failure injection testing
   - Validate failover procedures
   - Test recovery procedures

### Related Alerts
- **HighErrorRate**: May fire if service is partially down
- **HighAuthorizationLatency**: May fire before complete outage
- All other alerts may fire simultaneously during outage

### Inhibition Relationships
- This alert inhibits all other authorization service alerts when firing

### Example PromQL Queries

```promql
# Service up/down status
up{job="authz-engine"}

# Number of healthy instances
count(up{job="authz-engine"} == 1)

# Service availability percentage (5m window)
avg_over_time(up{job="authz-engine"}[5m]) * 100

# Time since service was last up
time() - max(process_start_time_seconds{job="authz-engine"})

# Restart count (last hour)
increase(kube_pod_container_status_restarts_total{pod=~"authz-engine.*"}[1h])

# Pod phase (1 = Running, 0 = not Running)
kube_pod_status_phase{pod=~"authz-engine.*", phase="Running"}
```

### Escalation
- **IMMEDIATE PAGE**: This is a critical outage
- **Page on-call engineer**: Immediately upon alert firing
- **Notify incident commander**: If not resolved within 5 minutes
- **Escalate to platform team**: If issue is infrastructure-related (node failure, cluster issues)
- **Notify security team**: If service down due to security incident or attack

### Post-Incident Actions
1. Conduct blameless post-mortem
2. Document root cause and resolution steps
3. Update runbook with lessons learned
4. Implement additional safeguards to prevent recurrence
5. Review and update SLO/SLA commitments if necessary
