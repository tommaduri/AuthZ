# Vector Store Alert Runbook

This runbook provides diagnosis and resolution steps for vector store performance alerts.

---

## SlowVectorSearch

### Summary
Vector search p99 latency exceeds 100ms, indicating performance degradation in semantic policy search.

### Severity
**WARNING**

### Impact
- Increased authorization latency (if vector search is in critical path)
- Degraded semantic search quality
- Reduced system throughput
- Potential timeout errors
- Increased resource consumption

### Diagnosis

1. **Check current search latency in Grafana**
   - Navigate to Vector Store Dashboard → Search Latency panel
   - Review latency distribution (p50, p90, p99)

2. **Query Prometheus for search metrics**
   ```promql
   # Current p99 search latency
   histogram_quantile(0.99,
     rate(authz_vector_search_duration_milliseconds_bucket[5m])
   )

   # Compare to baseline
   histogram_quantile(0.99,
     rate(authz_vector_search_duration_milliseconds_bucket[5m])
   ) /
   histogram_quantile(0.99,
     rate(authz_vector_search_duration_milliseconds_bucket[5m] offset 1h)
   )

   # Search latency by query type
   histogram_quantile(0.99,
     rate(authz_vector_search_duration_milliseconds_bucket[5m])
   ) by (query_type)
   ```

3. **Check vector index size and health**
   ```bash
   # Get vector store statistics
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store stats
   ```

   ```promql
   # Vector index size
   authz_vector_index_size_bytes

   # Number of vectors
   authz_vector_count

   # Index fragmentation
   authz_vector_index_fragmentation_ratio
   ```

4. **Analyze search patterns**
   ```bash
   # Check for expensive queries
   kubectl logs -n authz-system deployment/authz-engine --tail=200 | \
     grep "vector_search_slow" | jq '{query: .query, duration_ms: .duration_ms}'
   ```

5. **Verify system resources**
   ```promql
   # CPU usage
   rate(process_cpu_seconds_total{job="authz-engine"}[5m])

   # Memory usage
   process_resident_memory_bytes{job="authz-engine"}

   # Disk I/O (if using disk-based vector store)
   rate(node_disk_io_time_seconds_total[5m])
   ```

### Resolution

#### Immediate Mitigation

1. **Check for resource exhaustion**
   ```bash
   # Check pod resources
   kubectl top pod -n authz-system -l app=authz-engine
   ```
   - If CPU > 80%: Scale horizontally
   - If memory > 85%: Increase limits or optimize index

2. **Scale horizontally** (if load-related)
   ```bash
   kubectl scale deployment/authz-engine -n authz-system --replicas=5
   ```

3. **Rebuild vector index** (if fragmented)
   ```bash
   # Rebuild index to improve performance
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store index rebuild
   ```

4. **Tune search parameters** (temporary optimization)
   ```bash
   # Reduce search accuracy for speed
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store config --search-k=50 --ef-search=100
   ```

#### Root Cause Investigation

1. **Identify latency source**
   - Is latency in search algorithm itself?
   - Is latency in I/O (disk reads)?
   - Is latency in result post-processing?

2. **Analyze index characteristics**
   ```promql
   # Index size trend
   authz_vector_index_size_bytes [6h:]

   # Vector count trend
   authz_vector_count [6h:]

   # Index quality metrics
   authz_vector_index_fragmentation_ratio
   ```

3. **Check for index degradation**
   ```bash
   # Get index health report
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store index health
   ```

4. **Review recent changes**
   - Index algorithm changes
   - Search parameter tuning
   - Vector dimension changes
   - Large batch insertions

#### Long-term Fixes

1. **Optimize index configuration**
   ```yaml
   # Example: HNSW index tuning
   vector_store:
     index:
       type: hnsw
       parameters:
         m: 16              # Number of connections (higher = better search, more memory)
         ef_construction: 200  # Construction quality (higher = better index, slower build)
         ef_search: 100     # Search quality (higher = better results, slower search)
   ```

2. **Implement index partitioning**
   ```yaml
   # Example: Partition index by policy type
   vector_store:
     partitioning:
       enabled: true
       strategy: policy_type
       partitions:
         - name: resource_policies
           filter: policy_type == "resource"
         - name: role_policies
           filter: policy_type == "role"
   ```

3. **Add result caching**
   ```yaml
   # Example: Cache search results
   vector_store:
     search_cache:
       enabled: true
       size_mb: 256
       ttl: 300s
   ```

4. **Optimize vector dimensions**
   - Use dimension reduction (e.g., PCA) if acceptable
   - Consider quantization for faster search
   - Evaluate smaller embedding models

5. **Implement tiered storage**
   ```yaml
   # Example: Hot/cold storage strategy
   vector_store:
     tiered_storage:
       hot_tier:
         size_gb: 10
         medium: memory
         criteria: accessed_in_last_7d
       cold_tier:
         size_gb: 100
         medium: ssd
         criteria: accessed_more_than_7d_ago
   ```

### Related Alerts
- **VectorIndexTooBig**: Large index contributes to slow search
- **VectorSearchTimeoutErrors**: Slow searches eventually time out
- **HighAuthorizationLatency**: Vector search slowness impacts overall latency

### Inhibition Relationships
- None (this alert does not inhibit others)

### Example PromQL Queries

```promql
# Current p99 search latency
histogram_quantile(0.99,
  rate(authz_vector_search_duration_milliseconds_bucket[5m])
)

# Latency trend over 6 hours
histogram_quantile(0.99,
  rate(authz_vector_search_duration_milliseconds_bucket[5m])
) [6h:]

# Latency distribution (p50, p90, p99)
histogram_quantile(0.50,
  rate(authz_vector_search_duration_milliseconds_bucket[5m])
)
histogram_quantile(0.90,
  rate(authz_vector_search_duration_milliseconds_bucket[5m])
)
histogram_quantile(0.99,
  rate(authz_vector_search_duration_milliseconds_bucket[5m])
)

# Tail latency ratio (p99 / p50)
histogram_quantile(0.99,
  rate(authz_vector_search_duration_milliseconds_bucket[5m])
) /
histogram_quantile(0.50,
  rate(authz_vector_search_duration_milliseconds_bucket[5m])
)

# Search throughput (queries per second)
rate(authz_vector_operations_total{op="search"}[5m])

# Correlation with index size
authz_vector_index_size_bytes
```

### Escalation
- **Self-serve**: If latency < 200ms and stable
- **Escalate to on-call**: If latency > 200ms or increasing rapidly
- **Engage ML/infrastructure team**: For index architecture changes

---

## HighVectorErrorRate

### Summary
Vector search error rate exceeds 5%, indicating failures in vector store operations.

### Severity
**WARNING**

### Impact
- Failed policy lookups via semantic search
- Degraded authorization accuracy
- Potential fallback to less efficient search methods
- User-facing errors if search is in critical path
- Reduced system reliability

### Diagnosis

1. **Check current error rate in Grafana**
   - Navigate to Vector Store Dashboard → Error Rate panel
   - Identify error types and distribution

2. **Query Prometheus for error metrics**
   ```promql
   # Current error rate (percentage)
   (rate(authz_vector_search_errors_total[5m]) /
    rate(authz_vector_operations_total{op="search"}[5m])) * 100

   # Errors by type
   rate(authz_vector_search_errors_total[5m]) by (error_type)

   # Top error types
   topk(5, sum by (error_type) (rate(authz_vector_search_errors_total[5m])))
   ```

3. **Analyze error types**
   ```bash
   # Get recent error logs
   kubectl logs -n authz-system deployment/authz-engine --tail=200 | \
     grep "vector_search_error"

   # Group errors by type
   kubectl logs -n authz-system deployment/authz-engine --tail=1000 | \
     grep "vector_error_type" | awk -F'type=' '{print $2}' | sort | uniq -c | sort -rn
   ```

4. **Check vector store health**
   ```bash
   # Verify vector store connectivity
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store health
   ```

   ```promql
   # Vector store uptime
   up{job="vector-store"}

   # Vector store operations success rate
   rate(authz_vector_operations_total{op="search",status="success"}[5m]) /
   rate(authz_vector_operations_total{op="search"}[5m])
   ```

5. **Verify index integrity**
   ```bash
   # Check for index corruption
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store index validate
   ```

### Resolution

#### Immediate Mitigation

1. **Identify dominant error type**

2. **For timeout errors** (`timeout`):
   ```bash
   # Increase timeout threshold
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store config --search-timeout=5s
   ```

3. **For index corruption errors** (`index_corrupt`):
   ```bash
   # Rebuild index
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store index rebuild --force
   ```

4. **For connection errors** (`connection_failed`):
   ```bash
   # Check vector store service status
   kubectl get pods -n authz-system -l app=vector-store

   # Restart if unhealthy
   kubectl rollout restart deployment/vector-store -n authz-system
   ```

5. **For out-of-memory errors** (`oom`):
   ```bash
   # Increase memory limits
   kubectl set resources deployment/authz-engine -n authz-system \
     --limits=memory=4Gi
   ```

#### Root Cause Investigation

1. **Correlate errors with events**
   - Did errors start after a deployment?
   - Are errors correlated with high load?
   - Are errors specific to certain query patterns?

2. **Analyze error patterns**
   ```promql
   # Error rate over time
   (rate(authz_vector_search_errors_total[5m]) /
    rate(authz_vector_operations_total{op="search"}[5m])) * 100 [6h:]

   # Errors by operation type
   rate(authz_vector_search_errors_total[5m]) by (operation)
   ```

3. **Check for resource constraints**
   ```promql
   # Vector store CPU usage
   rate(process_cpu_seconds_total{job="vector-store"}[5m])

   # Vector store memory usage
   process_resident_memory_bytes{job="vector-store"}
   ```

4. **Review query complexity**
   ```bash
   # Analyze failed queries
   kubectl logs -n authz-system deployment/authz-engine | \
     grep "vector_search_error" | jq '{query: .query, error: .error}'
   ```

#### Long-term Fixes

1. **Improve error handling**
   ```go
   // Example: Retry logic with exponential backoff
   func (vs *VectorStore) SearchWithRetry(ctx context.Context, query []float64, k int) ([]Result, error) {
       var lastErr error
       maxRetries := 3

       for attempt := 0; attempt <= maxRetries; attempt++ {
           results, err := vs.search(ctx, query, k)
           if err == nil {
               return results, nil
           }

           lastErr = err
           if !isRetryable(err) {
               return nil, fmt.Errorf("non-retryable error: %w", err)
           }

           backoff := time.Duration(math.Pow(2, float64(attempt))) * time.Second
           time.Sleep(backoff)
       }

       return nil, fmt.Errorf("max retries exceeded: %w", lastErr)
   }
   ```

2. **Implement circuit breaker**
   ```yaml
   # Example: Circuit breaker configuration
   vector_store:
     circuit_breaker:
       enabled: true
       failure_threshold: 10
       success_threshold: 2
       timeout: 30s
       reset_timeout: 60s
   ```

3. **Add index validation**
   - Periodic index integrity checks
   - Automatic index repair
   - Index versioning and rollback

4. **Optimize query validation**
   ```go
   // Example: Query validation before execution
   func (vs *VectorStore) ValidateQuery(query []float64) error {
       if len(query) != vs.dimensions {
           return fmt.Errorf("invalid query dimension: got %d, expected %d",
               len(query), vs.dimensions)
       }

       for i, v := range query {
           if math.IsNaN(v) || math.IsInf(v, 0) {
               return fmt.Errorf("invalid value at position %d: %f", i, v)
           }
       }

       return nil
   }
   ```

5. **Implement fallback strategies**
   - Use approximate search if exact search fails
   - Fall back to non-vector search methods
   - Implement graceful degradation

### Related Alerts
- **SlowVectorSearch**: Slow searches may eventually time out and error
- **VectorIndexTooBig**: Large index may cause memory errors
- **VectorSearchTimeoutErrors**: Specific to timeout error type

### Inhibition Relationships
- This alert inhibits VectorSearchTimeoutErrors when firing

### Example PromQL Queries

```promql
# Total error rate (percentage)
(rate(authz_vector_search_errors_total[5m]) /
 rate(authz_vector_operations_total{op="search"}[5m])) * 100

# Error rate trend over 6 hours
(rate(authz_vector_search_errors_total[5m]) /
 rate(authz_vector_operations_total{op="search"}[5m])) * 100 [6h:]

# Error breakdown by type (percentage)
(rate(authz_vector_search_errors_total[5m]) by (error_type) /
 on() group_left sum(rate(authz_vector_search_errors_total[5m]))) * 100

# Compare current vs baseline error rate
(rate(authz_vector_search_errors_total[5m]) /
 rate(authz_vector_operations_total{op="search"}[5m])) /
(rate(authz_vector_search_errors_total[5m] offset 1h) /
 rate(authz_vector_operations_total{op="search"}[5m] offset 1h))

# Errors per second
rate(authz_vector_search_errors_total[5m])
```

### Escalation
- **Self-serve**: If error rate < 10% and error type is known
- **Escalate to on-call**: If error rate > 10% or cause is unclear
- **Engage infrastructure team**: For vector store infrastructure issues

---

## VectorIndexTooBig

### Summary
Vector index size exceeds 10GB, indicating potential performance degradation and resource constraints.

### Severity
**INFO**

### Impact
- Increased memory consumption
- Slower search performance
- Higher I/O load (if disk-based)
- Potential out-of-memory errors
- Increased costs (memory/storage)

### Diagnosis

1. **Check current index size in Grafana**
   - Navigate to Vector Store Dashboard → Index Size panel
   - Review size growth trend

2. **Query Prometheus for size metrics**
   ```promql
   # Current index size (bytes)
   authz_vector_index_size_bytes

   # Index size in GB
   authz_vector_index_size_bytes / 1024 / 1024 / 1024

   # Index growth rate (bytes per hour)
   rate(authz_vector_index_size_bytes[1h]) * 3600

   # Number of vectors
   authz_vector_count

   # Average vector size
   authz_vector_index_size_bytes / authz_vector_count
   ```

3. **Analyze index composition**
   ```bash
   # Get detailed index statistics
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store index stats --detailed
   ```

4. **Check for stale vectors**
   ```bash
   # Identify old/unused vectors
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store index analyze --show-stale
   ```

5. **Review vector distribution**
   ```bash
   # Get vector count by policy type
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store stats --by-policy-type
   ```

### Resolution

#### Immediate Mitigation

1. **Assess urgency**
   - Is system experiencing memory pressure?
   - Is search performance degraded?
   - Is index approaching hard limits?

2. **Remove stale vectors** (if safe)
   ```bash
   # Delete vectors for deleted policies
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store prune --dry-run

   # Apply pruning
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store prune --apply
   ```

3. **Archive old vectors** (if retention policy allows)
   ```bash
   # Archive vectors older than 90 days
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store archive --older-than=90d
   ```

4. **Increase memory limits** (if needed)
   ```bash
   kubectl set resources deployment/authz-engine -n authz-system \
     --limits=memory=8Gi
   ```

#### Root Cause Investigation

1. **Identify growth sources**
   - Are new policies being added rapidly?
   - Are vectors being updated frequently?
   - Are there duplicate or redundant vectors?

2. **Analyze vector lifecycle**
   ```promql
   # Vector insertion rate
   rate(authz_vector_operations_total{op="insert"}[1h])

   # Vector deletion rate
   rate(authz_vector_operations_total{op="delete"}[1h])

   # Net growth rate
   rate(authz_vector_operations_total{op="insert"}[1h]) -
   rate(authz_vector_operations_total{op="delete"}[1h])
   ```

3. **Check for vector duplication**
   ```bash
   # Identify duplicate vectors
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store index deduplicate --dry-run
   ```

4. **Review retention policies**
   - Are vectors being retained longer than necessary?
   - Is there a deletion policy for inactive resources?

#### Long-term Fixes

1. **Implement vector lifecycle management**
   ```yaml
   # Example: Vector retention policy
   vector_store:
     retention:
       enabled: true
       policies:
         - name: active_policies
           condition: policy.status == "active"
           retention_days: 365
         - name: deleted_policies
           condition: policy.status == "deleted"
           retention_days: 30
         - name: inactive_policies
           condition: last_accessed > 180d
           retention_days: 90
   ```

2. **Optimize vector storage**
   ```yaml
   # Example: Vector compression and quantization
   vector_store:
     optimization:
       quantization:
         enabled: true
         method: product_quantization
         m: 8  # Number of subquantizers
       compression:
         enabled: true
         algorithm: zstd
         level: 3
   ```

3. **Implement tiered storage**
   ```yaml
   # Example: Hot/warm/cold tiering
   vector_store:
     tiered_storage:
       hot_tier:
         size_gb: 5
         medium: memory
         criteria: accessed_in_last_7d
       warm_tier:
         size_gb: 20
         medium: ssd
         criteria: accessed_in_last_30d
       cold_tier:
         size_gb: unlimited
         medium: s3
         criteria: accessed_more_than_30d_ago
   ```

4. **Add automated pruning**
   ```yaml
   # Example: Scheduled pruning
   vector_store:
     automated_maintenance:
       pruning:
         enabled: true
         schedule: "0 2 * * *"  # Daily at 2 AM
         max_index_size_gb: 8
         retention_days: 90
   ```

5. **Monitor and alert on growth**
   ```promql
   # Predict when index will reach 15GB
   predict_linear(authz_vector_index_size_bytes[7d], 86400*7) > 15*1024*1024*1024
   ```

### Related Alerts
- **SlowVectorSearch**: Large index contributes to slow search
- **VectorInsertLatencyHigh**: Large index slows insertions
- **VectorStoreGrowthHigh**: Rapid growth leads to large index

### Inhibition Relationships
- None (this is an informational alert)

### Example PromQL Queries

```promql
# Current index size (GB)
authz_vector_index_size_bytes / 1024 / 1024 / 1024

# Index size trend over 7 days
authz_vector_index_size_bytes [7d:]

# Index growth rate (GB per day)
rate(authz_vector_index_size_bytes[1d]) / 1024 / 1024 / 1024

# Estimated days until 15GB threshold
(15*1024*1024*1024 - authz_vector_index_size_bytes) /
(rate(authz_vector_index_size_bytes[7d]) * 86400)

# Vector count
authz_vector_count

# Average vector size (bytes)
authz_vector_index_size_bytes / authz_vector_count
```

### Escalation
- **Self-serve**: This is informational; apply optimizations as needed
- **Escalate to on-call**: If index exceeds 15GB or memory pressure is observed
- **Engage infrastructure team**: For storage architecture changes

---

## VectorInsertLatencyHigh

### Summary
Vector insert p99 latency exceeds 50ms, indicating performance degradation in vector index updates.

### Severity
**INFO**

### Impact
- Delayed policy updates in vector index
- Slower embedding pipeline
- Increased queue depth for embeddings
- Degraded overall system performance
- Stale search results

### Diagnosis

1. **Check current insert latency in Grafana**
   - Navigate to Vector Store Dashboard → Insert Latency panel
   - Review latency distribution

2. **Query Prometheus for insert metrics**
   ```promql
   # Current p99 insert latency
   histogram_quantile(0.99,
     rate(authz_vector_insert_duration_milliseconds_bucket[5m])
   )

   # Compare to baseline
   histogram_quantile(0.99,
     rate(authz_vector_insert_duration_milliseconds_bucket[5m])
   ) /
   histogram_quantile(0.99,
     rate(authz_vector_insert_duration_milliseconds_bucket[5m] offset 1h)
   )

   # Insert throughput
   rate(authz_vector_operations_total{op="insert"}[5m])
   ```

3. **Check index characteristics**
   ```promql
   # Index size
   authz_vector_index_size_bytes

   # Vector count
   authz_vector_count

   # Index fragmentation
   authz_vector_index_fragmentation_ratio
   ```

4. **Analyze insert patterns**
   ```bash
   # Check for batch insert operations
   kubectl logs -n authz-system deployment/authz-engine --tail=200 | \
     grep "vector_insert" | jq '{count: .batch_size, duration_ms: .duration_ms}'
   ```

5. **Verify system resources**
   ```bash
   # Check pod resources
   kubectl top pod -n authz-system -l app=authz-engine
   ```

### Resolution

#### Immediate Mitigation

1. **Check for resource constraints**
   - If CPU > 80%: Scale horizontally
   - If memory > 85%: Increase limits
   - If disk I/O high: Consider SSD or optimize I/O

2. **Reduce insert rate** (temporary)
   ```bash
   # Throttle embedding job submissions
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli embedding config --rate-limit=5/second
   ```

3. **Enable batch insertions** (if not already)
   ```bash
   # Configure batch inserts
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store config --batch-size=100 --batch-timeout=1s
   ```

4. **Rebuild index** (if fragmented)
   ```bash
   # Rebuild to improve insert performance
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store index rebuild
   ```

#### Root Cause Investigation

1. **Identify latency source**
   - Is latency in index update algorithm?
   - Is latency in disk writes?
   - Is latency in network (if distributed)?

2. **Analyze index growth**
   ```promql
   # Index size trend
   authz_vector_index_size_bytes [6h:]

   # Vector insertion rate
   rate(authz_vector_operations_total{op="insert"}[1h])
   ```

3. **Check for index capacity**
   - Is index approaching size limits?
   - Is fragmentation increasing?
   - Are there too many vectors?

#### Long-term Fixes

1. **Optimize index configuration**
   ```yaml
   # Example: Tuning for insert performance
   vector_store:
     index:
       type: hnsw
       parameters:
         m: 16
         ef_construction: 100  # Lower value = faster inserts
   ```

2. **Implement batch processing**
   ```go
   // Example: Batch insert optimization
   func (vs *VectorStore) InsertBatch(vectors []Vector) error {
       const maxBatchSize = 1000

       for i := 0; i < len(vectors); i += maxBatchSize {
           end := i + maxBatchSize
           if end > len(vectors) {
               end = len(vectors)
           }

           batch := vectors[i:end]
           if err := vs.insertBatchInternal(batch); err != nil {
               return fmt.Errorf("batch insert failed at offset %d: %w", i, err)
           }
       }

       return nil
   }
   ```

3. **Optimize storage backend**
   - Use SSD for faster writes
   - Enable write buffering
   - Tune filesystem parameters

4. **Implement async inserts**
   ```yaml
   # Example: Async insert configuration
   vector_store:
     async_inserts:
       enabled: true
       queue_size: 10000
       batch_size: 100
       flush_interval: 1s
   ```

5. **Add write-ahead logging**
   - Improve crash recovery
   - Reduce insert latency with async writes
   - Buffer writes for batch processing

### Related Alerts
- **VectorIndexTooBig**: Large index slows inserts
- **EmbeddingJobLatencyHigh**: Slow inserts contribute to job latency

### Inhibition Relationships
- None (this is an informational alert)

### Example PromQL Queries

```promql
# Current p99 insert latency
histogram_quantile(0.99,
  rate(authz_vector_insert_duration_milliseconds_bucket[5m])
)

# Latency trend over 6 hours
histogram_quantile(0.99,
  rate(authz_vector_insert_duration_milliseconds_bucket[5m])
) [6h:]

# Insert throughput (vectors per second)
rate(authz_vector_operations_total{op="insert"}[5m])

# Latency vs index size correlation
histogram_quantile(0.99,
  rate(authz_vector_insert_duration_milliseconds_bucket[5m])
)
and on() authz_vector_index_size_bytes
```

### Escalation
- **Self-serve**: If latency < 100ms and stable
- **No escalation required**: This is informational

---

## VectorStoreGrowthHigh

### Summary
Vector store is growing at >10% per hour, indicating rapid data ingestion that may impact capacity planning.

### Severity
**INFO**

### Impact
- Potential capacity exhaustion
- Need for storage scaling
- Increased memory consumption
- Potential performance degradation
- Higher operational costs

### Diagnosis

1. **Check current growth rate in Grafana**
   - Navigate to Vector Store Dashboard → Growth Rate panel
   - Review growth trend over time

2. **Query Prometheus for growth metrics**
   ```promql
   # Current growth rate (percentage per hour)
   (rate(authz_vector_store_size[1h]) / authz_vector_store_size) * 100

   # Absolute growth (bytes per hour)
   rate(authz_vector_store_size[1h]) * 3600

   # Vector insertion rate
   rate(authz_vector_operations_total{op="insert"}[1h])

   # Estimated time to 15GB threshold
   (15*1024*1024*1024 - authz_vector_store_size) /
   rate(authz_vector_store_size[1h])
   ```

3. **Analyze growth sources**
   ```bash
   # Check embedding job submission rate
   kubectl logs -n authz-system deployment/authz-engine --tail=500 | \
     grep "embedding_job_created" | wc -l

   # Check new policy creation rate
   kubectl logs -n authz-system deployment/authz-engine | \
     grep "policy_created" | tail -100
   ```

4. **Review vector distribution**
   ```bash
   # Get vector count by type
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli vector-store stats --by-type
   ```

5. **Check for unusual activity**
   ```bash
   # Look for bulk operations
   kubectl logs -n authz-system deployment/authz-engine | \
     grep "bulk_insert\|batch_import" | tail -50
   ```

### Resolution

#### Immediate Mitigation

1. **Assess if growth is expected**
   - Is this part of planned data migration?
   - Is this due to normal business growth?
   - Is this unusual/unexpected activity?

2. **Monitor capacity headroom**
   ```promql
   # Percentage of capacity used
   (authz_vector_store_size / authz_vector_store_max_size) * 100

   # Time until capacity exhaustion (hours)
   (authz_vector_store_max_size - authz_vector_store_size) /
   rate(authz_vector_store_size[1h])
   ```

3. **Temporarily throttle ingestion** (if needed)
   ```bash
   # Reduce embedding job submission rate
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli embedding config --rate-limit=10/second
   ```

4. **Scale storage** (if approaching limits)
   ```bash
   # Increase storage limits
   kubectl set resources deployment/authz-engine -n authz-system \
     --limits=memory=8Gi
   ```

#### Root Cause Investigation

1. **Identify growth drivers**
   - New policy deployments
   - Bulk data imports
   - Increased system usage
   - Data retention policy changes

2. **Analyze growth pattern**
   ```promql
   # Growth rate over 24 hours
   (rate(authz_vector_store_size[1h]) / authz_vector_store_size) * 100 [24h:]

   # Is growth accelerating?
   deriv(rate(authz_vector_store_size[1h])[1h:])
   ```

3. **Check for anomalies**
   - Unusual spike in policy creation
   - Bulk import operations
   - Duplicate data ingestion

4. **Review capacity planning**
   - Is current capacity sufficient for expected growth?
   - What is the growth projection for next 30/60/90 days?

#### Long-term Fixes

1. **Implement capacity planning**
   ```yaml
   # Example: Capacity alerts and planning
   vector_store:
     capacity:
       current_gb: 10
       target_gb: 100
       alert_thresholds:
         warning: 70  # 70% capacity
         critical: 85 # 85% capacity
   ```

2. **Optimize storage efficiency**
   - Enable compression
   - Implement deduplication
   - Use quantization for vectors

3. **Add automated scaling**
   ```yaml
   # Example: Auto-scaling configuration
   vector_store:
     auto_scaling:
       enabled: true
       min_size_gb: 10
       max_size_gb: 100
       scale_trigger: 80  # Scale when 80% full
       scale_increment_gb: 10
   ```

4. **Implement data lifecycle management**
   ```yaml
   # Example: Lifecycle policies
   vector_store:
     lifecycle:
       policies:
         - name: archive_old_vectors
           age_days: 90
           action: archive
         - name: delete_inactive_vectors
           age_days: 180
           last_accessed_days: 90
           action: delete
   ```

5. **Monitor and forecast**
   ```promql
   # Forecast storage needs for next 30 days
   predict_linear(authz_vector_store_size[7d], 86400*30)
   ```

### Related Alerts
- **VectorIndexTooBig**: Growth leads to large index
- **VectorInsertLatencyHigh**: High growth rate may slow inserts

### Inhibition Relationships
- None (this is an informational alert)

### Example PromQL Queries

```promql
# Current growth rate (percentage per hour)
(rate(authz_vector_store_size[1h]) / authz_vector_store_size) * 100

# Absolute growth (MB per hour)
rate(authz_vector_store_size[1h]) * 3600 / 1024 / 1024

# Growth trend over 24 hours
(rate(authz_vector_store_size[1h]) / authz_vector_store_size) * 100 [24h:]

# Forecast size in 7 days
predict_linear(authz_vector_store_size[7d], 86400*7)

# Time until 15GB threshold (hours)
(15*1024*1024*1024 - authz_vector_store_size) /
rate(authz_vector_store_size[1h])

# Growth acceleration (is growth rate increasing?)
deriv(rate(authz_vector_store_size[1h])[1h:])
```

### Escalation
- **Self-serve**: This is informational for capacity planning
- **Notify infrastructure team**: If growth will exceed capacity within 7 days
- **Escalate to platform team**: For capacity expansion planning
