# Embedding Pipeline Alert Runbook

This runbook provides diagnosis and resolution steps for embedding pipeline health alerts.

---

## EmbeddingQueueSaturated

### Summary
The embedding job queue depth exceeds 80% capacity (>800 jobs out of 1000), indicating insufficient worker capacity or processing bottlenecks.

### Severity
**WARNING**

### Impact
- Increased latency for policy embedding updates
- Delayed vector index updates
- Potential queue overflow if load continues
- Degraded semantic search accuracy (stale embeddings)
- Risk of policy changes not being reflected in search results

### Diagnosis

1. **Check current queue depth in Grafana**
   - Navigate to Embedding Pipeline Dashboard → Queue Depth panel
   - Review queue growth rate over time

2. **Query Prometheus for queue metrics**
   ```promql
   # Current queue depth
   authz_embedding_queue_depth

   # Queue saturation percentage
   (authz_embedding_queue_depth / 1000) * 100

   # Queue growth rate
   rate(authz_embedding_queue_depth[5m])

   # Jobs entering queue (enqueue rate)
   rate(authz_embedding_jobs_enqueued_total[5m])

   # Jobs leaving queue (dequeue rate)
   rate(authz_embedding_jobs_dequeued_total[5m])
   ```

3. **Check worker status**
   ```bash
   # Get embedding worker statistics
   kubectl exec -n authz-system deployment/authz-engine -- /app/authz-cli embedding workers status
   ```

   ```promql
   # Active workers
   authz_embedding_workers_active

   # Worker utilization
   (authz_embedding_workers_active / authz_embedding_workers_total) * 100
   ```

4. **Analyze job throughput**
   ```promql
   # Job completion rate
   rate(authz_embedding_jobs_total{status="completed"}[5m])

   # Job failure rate
   rate(authz_embedding_jobs_total{status="failed"}[5m])

   # Average job duration
   rate(authz_embedding_job_duration_milliseconds_sum[5m]) /
   rate(authz_embedding_jobs_total{status="completed"}[5m])
   ```

5. **Check for backpressure**
   ```bash
   # Review job submission patterns
   kubectl logs -n authz-system deployment/authz-engine --tail=200 | grep "embedding_job_enqueued"
   ```

### Resolution

#### Immediate Mitigation

1. **Scale up workers** (if CPU/memory available)
   ```bash
   # Increase worker pool size
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli embedding workers scale --count=10
   ```

2. **Verify workers are healthy**
   ```bash
   # Check for stuck workers
   kubectl logs -n authz-system deployment/authz-engine | grep "worker_error\|worker_timeout"
   ```
   - If workers are stuck, restart service:
   ```bash
   kubectl rollout restart deployment/authz-engine -n authz-system
   ```

3. **Reduce job submission rate** (temporary)
   ```bash
   # Enable rate limiting for embedding job submissions
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli embedding config --rate-limit=10/second
   ```

4. **Prioritize critical jobs**
   ```bash
   # Pause low-priority embedding jobs
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli embedding jobs pause --priority=low
   ```

#### Root Cause Investigation

1. **Identify queue growth pattern**
   - Is queue growing linearly (sustained high load)?
   - Is queue growth bursty (periodic spikes)?
   - Did queue depth spike after a specific event?

2. **Check for processing bottlenecks**
   ```promql
   # Job latency p99
   histogram_quantile(0.99,
     rate(authz_embedding_job_duration_milliseconds_bucket[5m])
   )

   # Compare job latency to baseline
   histogram_quantile(0.99,
     rate(authz_embedding_job_duration_milliseconds_bucket[5m])
   ) /
   histogram_quantile(0.99,
     rate(authz_embedding_job_duration_milliseconds_bucket[5m] offset 1h)
   )
   ```

3. **Check embedding service health**
   ```bash
   # Test embedding API directly
   kubectl exec -n authz-system deployment/authz-engine -- \
     curl -X POST http://embedding-service:8080/embed \
       -H "Content-Type: application/json" \
       -d '{"text": "test policy"}' \
       -w "\nTime: %{time_total}s\n"
   ```

4. **Review job distribution**
   ```promql
   # Jobs by type
   rate(authz_embedding_jobs_total[5m]) by (job_type)

   # Jobs by priority
   rate(authz_embedding_jobs_total[5m]) by (priority)
   ```

#### Long-term Fixes

1. **Scale worker pool automatically**
   ```yaml
   # Example: Configure auto-scaling for workers
   embedding:
     workers:
       min: 5
       max: 20
       target_queue_depth: 500
       scale_up_threshold: 700
       scale_down_threshold: 300
   ```

2. **Optimize job processing**
   - Implement batch processing for similar embeddings
   - Enable embedding caching to avoid recomputation
   - Optimize embedding model (smaller/faster model if acceptable)

3. **Implement queue prioritization**
   ```yaml
   # Example: Priority-based queue configuration
   embedding:
     queue:
       size: 1000
       priorities:
         critical: 0.5  # 50% of queue capacity
         high: 0.3      # 30% of queue capacity
         normal: 0.15   # 15% of queue capacity
         low: 0.05      # 5% of queue capacity
   ```

4. **Add backpressure mechanisms**
   - Implement rate limiting on job submission
   - Return 429 (Too Many Requests) when queue is saturated
   - Add circuit breaker to prevent queue overflow

5. **Improve monitoring**
   ```promql
   # Set up predictive alerting
   predict_linear(authz_embedding_queue_depth[30m], 3600) > 950
   ```

### Related Alerts
- **EmbeddingJobLatencyHigh**: Slow jobs contribute to queue saturation
- **HighEmbeddingFailureRate**: Failed jobs may be retried, adding to queue
- **EmbeddingWorkersIdle**: Workers not processing while queue is saturated
- **VectorInsertLatencyHigh**: Slow vector inserts slow down job completion

### Inhibition Relationships
- None (this alert does not inhibit others)

### Example PromQL Queries

```promql
# Current queue depth
authz_embedding_queue_depth

# Queue saturation percentage
(authz_embedding_queue_depth / 1000) * 100

# Queue growth rate (jobs per second)
rate(authz_embedding_queue_depth[5m])

# Time to queue overflow at current rate
(1000 - authz_embedding_queue_depth) / rate(authz_embedding_queue_depth[10m])

# Job throughput (completed jobs per second)
rate(authz_embedding_jobs_total{status="completed"}[5m])

# Queue processing efficiency
rate(authz_embedding_jobs_total{status="completed"}[5m]) /
rate(authz_embedding_jobs_enqueued_total[5m])

# Average queue wait time
rate(authz_embedding_queue_wait_time_milliseconds_sum[5m]) /
rate(authz_embedding_jobs_total[5m])
```

### Escalation
- **Self-serve**: If queue depth < 900 and workers are healthy
- **Escalate to on-call**: If queue depth > 950 or growing rapidly
- **Page platform team**: If queue overflow is imminent or workers cannot scale

---

## HighEmbeddingFailureRate

### Summary
More than 10% of embedding jobs are failing, indicating issues with the embedding service, API, or job processing logic.

### Severity
**WARNING**

### Impact
- Incomplete or stale vector embeddings
- Degraded semantic search quality
- Policy changes not reflected in search results
- Increased retry load on system
- Potential for cascading failures

### Diagnosis

1. **Check current failure rate in Grafana**
   - Navigate to Embedding Pipeline Dashboard → Failure Rate panel
   - Identify failure patterns over time

2. **Query Prometheus for failure metrics**
   ```promql
   # Current failure rate (percentage)
   (rate(authz_embedding_jobs_total{status="failed"}[5m]) /
    rate(authz_embedding_jobs_total[5m])) * 100

   # Failed jobs per second
   rate(authz_embedding_jobs_total{status="failed"}[5m])

   # Failure rate by job type
   (rate(authz_embedding_jobs_total{status="failed"}[5m]) by (job_type) /
    rate(authz_embedding_jobs_total[5m]) by (job_type)) * 100
   ```

3. **Analyze failure types**
   ```bash
   # Get recent failure logs
   kubectl logs -n authz-system deployment/authz-engine --tail=200 | grep "embedding_job_failed"

   # Group failures by error type
   kubectl logs -n authz-system deployment/authz-engine --tail=1000 | \
     grep "embedding_error" | awk -F'error=' '{print $2}' | sort | uniq -c | sort -rn
   ```

4. **Check embedding service health**
   ```bash
   # Test embedding service connectivity
   kubectl exec -n authz-system deployment/authz-engine -- \
     curl -v http://embedding-service:8080/health

   # Check embedding service logs
   kubectl logs -n authz-system deployment/embedding-service --tail=100
   ```

5. **Verify API rate limits**
   ```promql
   # Rate limit errors
   rate(authz_embedding_errors_total{type="rate_limit"}[5m])

   # API timeout errors
   rate(authz_embedding_errors_total{type="timeout"}[5m])
   ```

### Resolution

#### Immediate Mitigation

1. **Identify dominant failure type**
   - API timeouts → Increase timeout threshold or check network
   - Rate limits → Reduce submission rate or increase API quota
   - Invalid input → Fix job validation or input sanitization
   - Service unavailable → Check embedding service health

2. **For API timeout failures**:
   ```bash
   # Increase timeout configuration
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli embedding config --api-timeout=30s
   ```

3. **For rate limit failures**:
   ```bash
   # Reduce job submission rate
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli embedding config --rate-limit=5/second

   # Or scale up embedding service
   kubectl scale deployment/embedding-service -n authz-system --replicas=3
   ```

4. **For service unavailability**:
   ```bash
   # Check embedding service status
   kubectl get pods -n authz-system -l app=embedding-service

   # Restart if unhealthy
   kubectl rollout restart deployment/embedding-service -n authz-system
   ```

5. **Enable retry with backoff** (if not already enabled)
   ```bash
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli embedding config --retry-enabled=true --max-retries=3
   ```

#### Root Cause Investigation

1. **Correlate failures with events**
   - Did failures start after a deployment?
   - Are failures correlated with high load periods?
   - Are failures specific to certain job types or input patterns?

2. **Analyze failure patterns**
   ```promql
   # Failure rate over time
   (rate(authz_embedding_jobs_total{status="failed"}[5m]) /
    rate(authz_embedding_jobs_total[5m])) * 100 [6h:]

   # Failures by worker
   rate(authz_embedding_jobs_total{status="failed"}[5m]) by (worker_id)
   ```

3. **Check embedding service capacity**
   ```promql
   # Embedding service CPU
   rate(process_cpu_seconds_total{job="embedding-service"}[5m])

   # Embedding service memory
   process_resident_memory_bytes{job="embedding-service"}

   # Embedding service request rate
   rate(embedding_requests_total[5m])
   ```

4. **Review input validation**
   ```bash
   # Check for malformed inputs
   kubectl logs -n authz-system deployment/authz-engine | \
     grep "invalid_input" | head -20
   ```

#### Long-term Fixes

1. **Improve error handling**
   ```go
   // Example: Enhanced error handling with exponential backoff
   type EmbeddingJobProcessor struct {
       maxRetries    int
       backoffFactor float64
   }

   func (p *EmbeddingJobProcessor) ProcessWithRetry(job *EmbeddingJob) error {
       var lastErr error
       for attempt := 0; attempt <= p.maxRetries; attempt++ {
           if err := p.process(job); err == nil {
               return nil
           } else {
               lastErr = err
               if !isRetryable(err) {
                   return fmt.Errorf("non-retryable error: %w", err)
               }
               backoff := time.Duration(math.Pow(p.backoffFactor, float64(attempt))) * time.Second
               time.Sleep(backoff)
           }
       }
       return fmt.Errorf("max retries exceeded: %w", lastErr)
   }
   ```

2. **Implement circuit breaker** for embedding service
   ```yaml
   # Example: Circuit breaker configuration
   embedding:
     circuit_breaker:
       enabled: true
       failure_threshold: 10
       timeout: 30s
       reset_timeout: 60s
   ```

3. **Add input validation and sanitization**
   - Validate text length (reject oversized inputs)
   - Sanitize special characters
   - Implement pre-flight validation before queuing

4. **Scale embedding service**
   ```yaml
   # Example: Auto-scaling for embedding service
   apiVersion: autoscaling/v2
   kind: HorizontalPodAutoscaler
   metadata:
     name: embedding-service-hpa
   spec:
     scaleTargetRef:
       apiVersion: apps/v1
       kind: Deployment
       name: embedding-service
     minReplicas: 2
     maxReplicas: 10
     metrics:
     - type: Pods
       pods:
         metric:
           name: embedding_requests_per_second
         target:
           type: AverageValue
           averageValue: 50
   ```

5. **Implement fallback strategies**
   - Use cached embeddings for failed jobs
   - Implement degraded mode (skip embeddings temporarily)
   - Queue failed jobs for manual review

### Related Alerts
- **EmbeddingQueueSaturated**: Failed jobs may be retried, increasing queue depth
- **EmbeddingJobLatencyHigh**: Slow jobs may eventually fail
- **EmbeddingCacheHitRateLow**: Failures reduce cache effectiveness

### Inhibition Relationships
- None (this alert does not inhibit others)

### Example PromQL Queries

```promql
# Current failure rate (percentage)
(rate(authz_embedding_jobs_total{status="failed"}[5m]) /
 rate(authz_embedding_jobs_total[5m])) * 100

# Failure rate trend over 6 hours
(rate(authz_embedding_jobs_total{status="failed"}[5m]) /
 rate(authz_embedding_jobs_total[5m])) * 100 [6h:]

# Failures by error type
rate(authz_embedding_jobs_total{status="failed"}[5m]) by (error_type)

# Compare failure rate to baseline
(rate(authz_embedding_jobs_total{status="failed"}[5m]) /
 rate(authz_embedding_jobs_total[5m])) /
(rate(authz_embedding_jobs_total{status="failed"}[5m] offset 24h) /
 rate(authz_embedding_jobs_total[5m] offset 24h))

# Success vs failure rate
rate(authz_embedding_jobs_total[5m]) by (status)
```

### Escalation
- **Self-serve**: If failure rate < 20% and cause is identified
- **Escalate to on-call**: If failure rate > 25% or cause is unclear
- **Engage ML team**: If failures are related to embedding model or service

---

## EmbeddingJobLatencyHigh

### Summary
The p99 latency for embedding job completion exceeds 1000ms, indicating performance issues in the embedding pipeline.

### Severity
**WARNING**

### Impact
- Delayed policy updates in vector search
- Increased queue depth
- Degraded overall system performance
- Stale search results
- Increased worker resource consumption

### Diagnosis

1. **Check current latency in Grafana**
   - Navigate to Embedding Pipeline Dashboard → Job Latency panel
   - Review latency distribution (p50, p90, p99)

2. **Query Prometheus for latency metrics**
   ```promql
   # Current p99 latency
   histogram_quantile(0.99,
     rate(authz_embedding_job_duration_milliseconds_bucket[5m])
   )

   # Compare p99 to p50 (identify tail latency)
   histogram_quantile(0.99,
     rate(authz_embedding_job_duration_milliseconds_bucket[5m])
   ) /
   histogram_quantile(0.50,
     rate(authz_embedding_job_duration_milliseconds_bucket[5m])
   )

   # Latency by job type
   histogram_quantile(0.99,
     rate(authz_embedding_job_duration_milliseconds_bucket[5m])
   ) by (job_type)
   ```

3. **Analyze latency components**
   ```bash
   # Get detailed job timing
   kubectl logs -n authz-system deployment/authz-engine --tail=100 | \
     grep "embedding_job_timing" | jq '.breakdown'
   ```

4. **Check embedding service performance**
   ```promql
   # Embedding API latency
   histogram_quantile(0.99,
     rate(embedding_api_duration_milliseconds_bucket[5m])
   )

   # Embedding service CPU/memory
   rate(process_cpu_seconds_total{job="embedding-service"}[5m])
   process_resident_memory_bytes{job="embedding-service"}
   ```

5. **Verify network latency**
   ```bash
   # Test network latency to embedding service
   kubectl exec -n authz-system deployment/authz-engine -- \
     time curl -X POST http://embedding-service:8080/embed \
       -H "Content-Type: application/json" \
       -d '{"text": "test policy"}'
   ```

### Resolution

#### Immediate Mitigation

1. **Check for resource constraints**
   ```bash
   # Check embedding service resources
   kubectl top pod -n authz-system -l app=embedding-service
   ```
   - If CPU > 80%, scale horizontally
   - If memory > 85%, increase limits or optimize model

2. **Scale embedding service**
   ```bash
   # Add more replicas
   kubectl scale deployment/embedding-service -n authz-system --replicas=5
   ```

3. **Enable aggressive caching**
   ```bash
   # Increase embedding cache TTL
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli embedding cache --ttl=3600s
   ```

4. **Reduce job parallelism** (if workers are overloaded)
   ```bash
   # Reduce worker count to decrease contention
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli embedding workers scale --count=5
   ```

#### Root Cause Investigation

1. **Identify latency source**
   - Is latency in API call to embedding service?
   - Is latency in vector insertion?
   - Is latency in job queuing/dequeuing?

2. **Analyze latency breakdown**
   ```promql
   # API call latency
   histogram_quantile(0.99,
     rate(authz_embedding_api_call_duration_milliseconds_bucket[5m])
   )

   # Vector insert latency
   histogram_quantile(0.99,
     rate(authz_vector_insert_duration_milliseconds_bucket[5m])
   )

   # Queue wait time
   histogram_quantile(0.99,
     rate(authz_embedding_queue_wait_milliseconds_bucket[5m])
   )
   ```

3. **Check for external dependencies**
   - Database latency (if policies are fetched)
   - Network latency
   - Disk I/O latency (if vector store is disk-based)

4. **Review recent changes**
   - Embedding model changes
   - Worker pool configuration changes
   - Resource limit adjustments

#### Long-term Fixes

1. **Optimize embedding pipeline**
   ```go
   // Example: Batch processing for embeddings
   type BatchEmbeddingProcessor struct {
       batchSize int
       timeout   time.Duration
   }

   func (p *BatchEmbeddingProcessor) ProcessBatch(jobs []*EmbeddingJob) error {
       texts := make([]string, len(jobs))
       for i, job := range jobs {
           texts[i] = job.Text
       }

       // Single API call for batch
       embeddings, err := p.embeddingService.EmbedBatch(texts)
       if err != nil {
           return err
       }

       // Process results
       for i, embedding := range embeddings {
           jobs[i].Embedding = embedding
       }
       return nil
   }
   ```

2. **Implement caching strategies**
   - Cache embeddings at multiple levels
   - Pre-compute embeddings for common policies
   - Implement embedding similarity checks (avoid recomputing similar texts)

3. **Optimize embedding model**
   - Use smaller/faster embedding model if acceptable
   - Implement model quantization
   - Use GPU acceleration if available

4. **Tune worker configuration**
   ```yaml
   # Example: Optimized worker configuration
   embedding:
     workers:
       count: 10
       max_concurrent_jobs: 2  # Per worker
       batch_size: 10
       timeout: 30s
   ```

5. **Add latency budgeting**
   ```yaml
   # Example: Latency targets per component
   embedding:
     latency_budgets:
       api_call: 500ms     # 50% of budget
       vector_insert: 300ms # 30% of budget
       overhead: 200ms     # 20% of budget
   ```

### Related Alerts
- **EmbeddingQueueSaturated**: Slow jobs contribute to queue saturation
- **VectorInsertLatencyHigh**: Slow inserts contribute to overall latency
- **HighEmbeddingFailureRate**: Slow jobs may eventually time out and fail

### Inhibition Relationships
- None (this alert does not inhibit others)

### Example PromQL Queries

```promql
# Current p99 latency
histogram_quantile(0.99,
  rate(authz_embedding_job_duration_milliseconds_bucket[5m])
)

# Latency trend over 6 hours
histogram_quantile(0.99,
  rate(authz_embedding_job_duration_milliseconds_bucket[5m])
) [6h:]

# Latency distribution (p50, p90, p99)
histogram_quantile(0.50,
  rate(authz_embedding_job_duration_milliseconds_bucket[5m])
)
histogram_quantile(0.90,
  rate(authz_embedding_job_duration_milliseconds_bucket[5m])
)
histogram_quantile(0.99,
  rate(authz_embedding_job_duration_milliseconds_bucket[5m])
)

# Tail latency ratio (p99 / p50)
histogram_quantile(0.99,
  rate(authz_embedding_job_duration_milliseconds_bucket[5m])
) /
histogram_quantile(0.50,
  rate(authz_embedding_job_duration_milliseconds_bucket[5m])
)

# Latency by job type
histogram_quantile(0.99,
  rate(authz_embedding_job_duration_milliseconds_bucket[5m])
) by (job_type)
```

### Escalation
- **Self-serve**: If latency < 2000ms and trending stable
- **Escalate to on-call**: If latency > 2000ms or increasing rapidly
- **Engage ML team**: If latency is in embedding model/service

---

## EmbeddingWorkersIdle

### Summary
No embedding workers are actively processing jobs while the queue has pending jobs, indicating a worker pool failure or deadlock.

### Severity
**WARNING**

### Impact
- Embedding jobs not being processed
- Growing queue depth
- Stale vector embeddings
- Policy changes not reflected in search
- Potential for queue overflow

### Diagnosis

1. **Check worker status in Grafana**
   - Navigate to Embedding Pipeline Dashboard → Worker Status panel
   - Verify active worker count is zero

2. **Query Prometheus for worker metrics**
   ```promql
   # Active workers (should be > 0)
   authz_embedding_workers_active

   # Total workers configured
   authz_embedding_workers_total

   # Queue depth (should be > 0 for this alert)
   authz_embedding_queue_depth

   # Worker idle time
   time() - max(authz_embedding_worker_last_active_timestamp)
   ```

3. **Check worker logs**
   ```bash
   # Get worker error logs
   kubectl logs -n authz-system deployment/authz-engine --tail=200 | \
     grep -i "worker\|embedding_processor"

   # Look for panics, deadlocks, or fatal errors
   kubectl logs -n authz-system deployment/authz-engine | grep -i "panic\|fatal\|deadlock"
   ```

4. **Verify worker pool configuration**
   ```bash
   # Get current worker pool settings
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli embedding workers status
   ```

5. **Check for resource constraints**
   ```bash
   # Check pod resource usage
   kubectl top pod -n authz-system -l app=authz-engine

   # Check for OOMKills
   kubectl describe pod -n authz-system -l app=authz-engine | grep -i "oom\|killed"
   ```

### Resolution

#### Immediate Mitigation

1. **Restart embedding workers**
   ```bash
   # Restart worker pool without full service restart
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli embedding workers restart
   ```

2. **If graceful restart fails, restart service**
   ```bash
   kubectl rollout restart deployment/authz-engine -n authz-system

   # Monitor rollout
   kubectl rollout status deployment/authz-engine -n authz-system
   ```

3. **Verify workers are processing after restart**
   ```promql
   # Check active workers
   authz_embedding_workers_active

   # Check job throughput
   rate(authz_embedding_jobs_total{status="completed"}[2m])
   ```

4. **Drain and repopulate queue** (if workers still idle)
   ```bash
   # Export queued jobs
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli embedding queue export > /tmp/embedding-jobs.json

   # Clear queue
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli embedding queue clear

   # Restart workers
   kubectl rollout restart deployment/authz-engine -n authz-system

   # Re-enqueue jobs
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli embedding queue import < /tmp/embedding-jobs.json
   ```

#### Root Cause Investigation

1. **Analyze worker lifecycle**
   ```bash
   # Get worker start/stop events
   kubectl logs -n authz-system deployment/authz-engine | \
     grep "worker_started\|worker_stopped\|worker_error"
   ```

2. **Check for deadlocks**
   ```bash
   # Look for goroutine dumps or deadlock indicators
   kubectl logs -n authz-system deployment/authz-engine | grep -i "deadlock"

   # Get goroutine dump (if enabled)
   kubectl exec -n authz-system deployment/authz-engine -- \
     curl http://localhost:6060/debug/pprof/goroutine?debug=2
   ```

3. **Check for panic recovery failures**
   ```bash
   # Look for unrecovered panics
   kubectl logs -n authz-system deployment/authz-engine | grep -A 10 "panic:"
   ```

4. **Review recent configuration changes**
   - Worker pool size changes
   - Timeout configuration changes
   - Resource limit adjustments

5. **Check embedding service availability**
   ```bash
   # Verify embedding service is reachable
   kubectl exec -n authz-system deployment/authz-engine -- \
     curl -v http://embedding-service:8080/health
   ```

#### Long-term Fixes

1. **Implement worker health checks**
   ```go
   // Example: Worker health monitoring
   type WorkerPool struct {
       workers      []*Worker
       healthTicker *time.Ticker
   }

   func (p *WorkerPool) MonitorHealth(ctx context.Context) {
       p.healthTicker = time.NewTicker(30 * time.Second)
       defer p.healthTicker.Stop()

       for {
           select {
           case <-ctx.Done():
               return
           case <-p.healthTicker.C:
               for _, worker := range p.workers {
                   if !worker.IsHealthy() {
                       log.Warn("Unhealthy worker detected, restarting",
                           "worker_id", worker.ID)
                       worker.Restart()
                   }
               }
           }
       }
   }
   ```

2. **Add worker deadlock detection**
   ```go
   // Example: Deadlock detection
   type Worker struct {
       lastHeartbeat time.Time
       mu            sync.Mutex
   }

   func (w *Worker) IsDeadlocked() bool {
       w.mu.Lock()
       defer w.mu.Unlock()
       return time.Since(w.lastHeartbeat) > 2*time.Minute
   }
   ```

3. **Implement panic recovery**
   ```go
   // Example: Robust panic recovery
   func (w *Worker) ProcessJob(job *EmbeddingJob) (err error) {
       defer func() {
           if r := recover(); r != nil {
               err = fmt.Errorf("worker panic: %v\nstack: %s", r, debug.Stack())
               log.Error("Worker panic recovered", "error", err)
               // Restart worker after panic
               go w.Restart()
           }
       }()

       return w.process(job)
   }
   ```

4. **Add worker pool auto-recovery**
   ```yaml
   # Example: Auto-recovery configuration
   embedding:
     workers:
       auto_recovery:
         enabled: true
         health_check_interval: 30s
         max_idle_time: 2m
         restart_on_idle: true
   ```

5. **Improve observability**
   - Add detailed worker metrics (heartbeats, job counts, error counts)
   - Implement distributed tracing for job processing
   - Add worker-level logging with correlation IDs

### Related Alerts
- **EmbeddingQueueSaturated**: Queue grows while workers are idle
- **HighEmbeddingFailureRate**: Worker failures may cause idle state
- **EmbeddingJobLatencyHigh**: Idle workers cause infinite latency

### Inhibition Relationships
- This alert should inhibit EmbeddingQueueSaturated (root cause is worker failure, not capacity)

### Example PromQL Queries

```promql
# Active workers
authz_embedding_workers_active

# Workers idle while queue has jobs
authz_embedding_workers_active == 0 and authz_embedding_queue_depth > 0

# Time since last worker activity
time() - max(authz_embedding_worker_last_active_timestamp)

# Worker utilization (should be > 0)
(authz_embedding_workers_active / authz_embedding_workers_total) * 100

# Queue depth while workers idle
authz_embedding_queue_depth and authz_embedding_workers_active == 0

# Job completion rate (should drop to 0)
rate(authz_embedding_jobs_total{status="completed"}[2m])
```

### Escalation
- **Escalate immediately**: This is an abnormal state indicating a bug
- **Page on-call**: If restart does not resolve issue within 5 minutes
- **Engage development team**: To investigate root cause (deadlock, panic, bug)

---

## EmbeddingCacheHitRateLow

### Summary
Embedding cache hit rate has fallen below 70%, causing increased embedding API calls and higher latency.

### Severity
**INFO**

### Impact
- Increased embedding API calls (higher cost)
- Higher embedding job latency
- Increased load on embedding service
- Degraded throughput for embedding pipeline
- Potential rate limit exhaustion

### Diagnosis

1. **Check current cache hit rate in Grafana**
   - Navigate to Embedding Pipeline Dashboard → Cache Performance panel
   - Review hit/miss ratio over time

2. **Query Prometheus for cache metrics**
   ```promql
   # Current cache hit rate
   (rate(authz_embedding_cache_hits_total[10m]) /
    (rate(authz_embedding_cache_hits_total[10m]) +
     rate(authz_embedding_cache_misses_total[10m]))) * 100

   # Cache miss rate
   rate(authz_embedding_cache_misses_total[10m])

   # Cache eviction rate
   rate(authz_embedding_cache_evictions_total[10m])
   ```

3. **Analyze cache statistics**
   ```bash
   # Get embedding cache stats
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli embedding cache stats
   ```

4. **Check for cache churn**
   ```promql
   # Cache churn (evictions per second)
   rate(authz_embedding_cache_evictions_total[5m])

   # Cache utilization
   authz_embedding_cache_size_bytes / authz_embedding_cache_max_size_bytes
   ```

5. **Review access patterns**
   ```bash
   # Check for cache miss patterns
   kubectl logs -n authz-system deployment/authz-engine --tail=500 | \
     grep "embedding_cache_miss" | awk '{print $NF}' | sort | uniq -c | sort -rn | head -20
   ```

### Resolution

#### Immediate Mitigation

1. **Increase cache size**
   ```bash
   # Update cache configuration
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli embedding cache resize --size=512MB
   ```

2. **Increase cache TTL** (if embeddings are relatively stable)
   ```bash
   # Extend TTL
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli embedding cache config --ttl=3600s
   ```

3. **Pre-warm cache** with frequently accessed embeddings
   ```bash
   # Warm cache for common policies
   kubectl exec -n authz-system deployment/authz-engine -- \
     /app/authz-cli embedding cache warm --top=1000
   ```

#### Root Cause Investigation

1. **Identify cache miss patterns**
   - Are misses evenly distributed or concentrated?
   - Has the working set size increased?
   - Are there new policy types being embedded?

2. **Check for policy churn**
   ```bash
   # Review embedding job submissions
   kubectl logs -n authz-system deployment/authz-engine | \
     grep "embedding_job_created" | tail -100
   ```

3. **Analyze embedding diversity**
   - High diversity → larger cache needed
   - Low diversity with misses → caching strategy issue

#### Long-term Fixes

1. **Optimize cache configuration**
   ```yaml
   # Example: Tiered caching strategy
   embedding:
     cache:
       l1_cache:
         size: 256MB
         ttl: 3600s
         type: lru
       l2_cache:
         size: 1GB
         ttl: 86400s
         type: lfu
   ```

2. **Implement intelligent caching**
   - Cache based on embedding similarity (deduplicate similar texts)
   - Implement frequency-based caching (cache popular embeddings longer)
   - Use bloom filters to reduce cache pollution

3. **Optimize embedding generation**
   - Normalize/canonicalize text before embedding (improve cache hits)
   - Hash-based caching for exact matches
   - Similarity-based cache lookups (fuzzy matching)

4. **Monitor and adjust**
   - Set up alerting for cache performance degradation
   - Regularly review cache effectiveness
   - Implement adaptive cache sizing

### Related Alerts
- **EmbeddingJobLatencyHigh**: Cache misses increase latency
- **HighEmbeddingFailureRate**: Increased API calls may hit rate limits

### Inhibition Relationships
- None (this is an informational alert)

### Example PromQL Queries

```promql
# Current cache hit rate (percentage)
(rate(authz_embedding_cache_hits_total[10m]) /
 (rate(authz_embedding_cache_hits_total[10m]) +
  rate(authz_embedding_cache_misses_total[10m]))) * 100

# Cache miss rate (per second)
rate(authz_embedding_cache_misses_total[5m])

# Cache efficiency trend (6 hour window)
(rate(authz_embedding_cache_hits_total[10m]) /
 (rate(authz_embedding_cache_hits_total[10m]) +
  rate(authz_embedding_cache_misses_total[10m]))) * 100 [6h:]

# Cache eviction rate
rate(authz_embedding_cache_evictions_total[5m])

# Cache pressure (evictions / inserts ratio)
rate(authz_embedding_cache_evictions_total[5m]) /
rate(authz_embedding_cache_inserts_total[5m])
```

### Escalation
- **Self-serve**: This is informational; apply optimizations as needed
- **No escalation required**: Unless cache hit rate drops below 50%
