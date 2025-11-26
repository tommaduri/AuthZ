// Package embedding provides background policy embedding generation
package embedding

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/authz-engine/go-core/internal/metrics"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/authz-engine/go-core/pkg/vector"
)

// EmbeddingWorker generates embeddings for policies in the background
type EmbeddingWorker struct {
	store        policy.Store
	vectorStore  vector.VectorStore
	embedFunc    EmbeddingFunction
	cache        *EmbeddingCache // Optional caching layer
	ModelVersion string          // Embedding model version for tracking
	metrics      metrics.Metrics // Phase 4.4: Prometheus metrics

	jobs    chan EmbeddingJob
	workers []*worker

	shutdown chan struct{}
	wg       sync.WaitGroup

	stats Stats
	mu    sync.RWMutex
}

// EmbeddingFunction generates a vector embedding from text
type EmbeddingFunction func(text string) ([]float32, error)

// EmbeddingJob represents a policy embedding task
type EmbeddingJob struct {
	PolicyID   string
	PolicyText string
	Priority   int // 0=low, 1=normal, 2=high
	Timestamp  time.Time
}

// worker is a goroutine that processes embedding jobs
type worker struct {
	id     int
	jobs   <-chan EmbeddingJob
	worker *EmbeddingWorker
	ctx    context.Context
	cancel context.CancelFunc
}

// Stats tracks embedding worker statistics
type Stats struct {
	JobsProcessed     int64
	JobsFailed        int64
	TotalDurationMs   int64
	AverageDurationMs float64
	QueueDepth        int
	WorkersActive     int
	CacheHits         int64 // Cache hits (embeddings reused)
	CacheMisses       int64 // Cache misses (embeddings generated)
	CacheHitRate      float64 // Hit rate percentage
}

// Config configures the embedding worker
type Config struct {
	NumWorkers     int    // Number of concurrent workers (default: 4)
	QueueSize      int    // Job queue buffer size (default: 1000)
	BatchSize      int    // Policies to batch together (default: 10)
	Dimension      int    // Embedding dimension (default: 384)
	ModelVersion   string // Embedding model version (default: "v1")
	EmbeddingFunc  EmbeddingFunction // Custom embedding function
	CacheConfig    *CacheConfig // Optional caching configuration (nil = no cache)
	Metrics        metrics.Metrics // Phase 4.4: Optional metrics (nil defaults to NoOp)
}

// DefaultConfig returns a default worker configuration
func DefaultConfig() Config {
	return Config{
		NumWorkers:    4,
		QueueSize:     1000,
		BatchSize:     10,
		Dimension:     384,
		ModelVersion:  "v1", // Default version
		EmbeddingFunc: DefaultEmbeddingFunction,
	}
}

// NewEmbeddingWorker creates a new background embedding worker
func NewEmbeddingWorker(cfg Config, policyStore policy.Store, vectorStore vector.VectorStore) (*EmbeddingWorker, error) {
	if policyStore == nil {
		return nil, fmt.Errorf("policy store cannot be nil")
	}
	if vectorStore == nil {
		return nil, fmt.Errorf("vector store cannot be nil")
	}

	// Apply defaults
	if cfg.NumWorkers <= 0 {
		cfg.NumWorkers = 4
	}
	if cfg.QueueSize <= 0 {
		cfg.QueueSize = 1000
	}
	if cfg.EmbeddingFunc == nil {
		cfg.EmbeddingFunc = DefaultEmbeddingFunction
	}
	if cfg.ModelVersion == "" {
		cfg.ModelVersion = "v1" // Default version for backward compatibility
	}

	// Validate model version after applying defaults
	if len(cfg.ModelVersion) > 200 {
		return nil, fmt.Errorf("version too long (max 200 characters)")
	}
	// Basic validation: alphanumeric, dots, dashes, underscores only
	for _, ch := range cfg.ModelVersion {
		if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
			(ch >= '0' && ch <= '9') || ch == '.' || ch == '-' || ch == '_') {
			return nil, fmt.Errorf("invalid version format: only alphanumeric, dots, dashes, and underscores allowed")
		}
	}

	// Phase 4.4: Initialize metrics (default to NoOp if not provided)
	m := cfg.Metrics
	if m == nil {
		m = metrics.NewNoOpMetrics()
	}

	w := &EmbeddingWorker{
		store:        policyStore,
		vectorStore:  vectorStore,
		embedFunc:    cfg.EmbeddingFunc,
		ModelVersion: cfg.ModelVersion,
		metrics:      m,
		jobs:         make(chan EmbeddingJob, cfg.QueueSize),
		workers:      make([]*worker, 0, cfg.NumWorkers),
		shutdown:     make(chan struct{}),
		stats: Stats{
			WorkersActive: cfg.NumWorkers,
		},
	}

	// Initialize cache if configured
	if cfg.CacheConfig != nil {
		w.cache = NewEmbeddingCache(*cfg.CacheConfig)
	}

	// Phase 4.4: Update metrics with initial worker count
	m.UpdateActiveWorkers(cfg.NumWorkers)

	// Start workers
	for i := 0; i < cfg.NumWorkers; i++ {
		worker := w.startWorker(i)
		w.workers = append(w.workers, worker)
	}

	return w, nil
}

// startWorker launches a background worker goroutine
func (w *EmbeddingWorker) startWorker(id int) *worker {
	ctx, cancel := context.WithCancel(context.Background())

	worker := &worker{
		id:     id,
		jobs:   w.jobs,
		worker: w,
		ctx:    ctx,
		cancel: cancel,
	}

	w.wg.Add(1)
	go worker.run()

	return worker
}

// run processes embedding jobs
func (wk *worker) run() {
	defer wk.worker.wg.Done()

	for {
		select {
		case <-wk.ctx.Done():
			return

		case <-wk.worker.shutdown:
			return

		case job := <-wk.jobs:
			start := time.Now()

			err := wk.processJob(job)
			duration := time.Since(start)

			if err != nil {
				log.Printf("[EmbeddingWorker-%d] Failed to process job for policy %s: %v", wk.id, job.PolicyID, err)
				wk.worker.incrementFailed()
				// Phase 4.4: Record failed job
				wk.worker.metrics.RecordEmbeddingJob("failed", duration)
			} else {
				wk.worker.incrementProcessed(duration)
				// Phase 4.4: Record successful job
				wk.worker.metrics.RecordEmbeddingJob("success", duration)
			}
		}
	}
}

// processJob generates and stores an embedding
func (wk *worker) processJob(job EmbeddingJob) error {
	ctx := wk.ctx

	// Compute policy hash for cache key
	policyHash := ComputePolicyHash(job.PolicyText)

	// Check cache first (if enabled)
	var embedding []float32
	if wk.worker.cache != nil {
		embedding = wk.worker.cache.GetWithVersion(job.PolicyID, policyHash, wk.worker.ModelVersion)
		if embedding != nil {
			// Cache hit - no need to generate or store
			wk.worker.incrementCacheHit()
			// Phase 4.4: Record cache hit
			wk.worker.metrics.RecordCacheOperation("hit")
			return nil
		}
		wk.worker.incrementCacheMiss()
		// Phase 4.4: Record cache miss
		wk.worker.metrics.RecordCacheOperation("miss")
	}

	// Cache miss or no cache - generate embedding
	var err error
	embedding, err = wk.worker.embedFunc(job.PolicyText)
	if err != nil {
		return fmt.Errorf("embedding generation failed: %w", err)
	}

	// Store in cache (if enabled)
	if wk.worker.cache != nil {
		if err := wk.worker.cache.PutWithVersion(job.PolicyID, policyHash, embedding, wk.worker.ModelVersion); err != nil {
			// Log but don't fail the job
			log.Printf("[EmbeddingWorker-%d] Cache put failed for policy %s: %v", wk.id, job.PolicyID, err)
		}
	}

	// Store in vector database with version metadata
	metadata := map[string]interface{}{
		"policy_id":     job.PolicyID,
		"embedded_at":   time.Now().Unix(),
		"text_length":   len(job.PolicyText),
		"policy_hash":   policyHash,
		"model_version": wk.worker.ModelVersion, // Track embedding model version
	}

	if err := wk.worker.vectorStore.Insert(ctx, job.PolicyID, embedding, metadata); err != nil {
		return fmt.Errorf("vector store insert failed: %w", err)
	}

	return nil
}

// Submit queues a policy for embedding (non-blocking if queue full)
func (w *EmbeddingWorker) Submit(policyID string, policyText string, priority int) bool {
	job := EmbeddingJob{
		PolicyID:   policyID,
		PolicyText: policyText,
		Priority:   priority,
		Timestamp:  time.Now(),
	}

	select {
	case w.jobs <- job:
		// Phase 4.4: Update queue depth
		w.metrics.UpdateQueueDepth(len(w.jobs))
		return true
	default:
		// Queue full, drop job (graceful degradation)
		return false
	}
}

// SubmitPolicy queues a policy for embedding with automatic text serialization
func (w *EmbeddingWorker) SubmitPolicy(pol *types.Policy, priority int) bool {
	text := SerializePolicyToText(pol)
	return w.Submit(pol.Name, text, priority)
}

// SubmitBatch queues multiple policies for embedding
func (w *EmbeddingWorker) SubmitBatch(policies []*types.Policy, priority int) int {
	submitted := 0
	for _, pol := range policies {
		if w.SubmitPolicy(pol, priority) {
			submitted++
		}
	}
	return submitted
}

// Embed generates an embedding synchronously (for query embedding)
func (w *EmbeddingWorker) Embed(text string) ([]float32, error) {
	return w.embedFunc(text)
}

// Stats returns current worker statistics
func (w *EmbeddingWorker) Stats() Stats {
	w.mu.RLock()
	defer w.mu.RUnlock()

	stats := w.stats
	stats.QueueDepth = len(w.jobs)
	return stats
}

// Shutdown gracefully stops all workers
func (w *EmbeddingWorker) Shutdown(ctx context.Context) error {
	close(w.shutdown)

	// Wait for workers with timeout
	done := make(chan struct{})
	go func() {
		w.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		return nil
	case <-ctx.Done():
		// Force cancel workers
		for _, worker := range w.workers {
			worker.cancel()
		}
		return fmt.Errorf("shutdown timeout: %w", ctx.Err())
	}
}

// incrementProcessed updates success statistics
func (w *EmbeddingWorker) incrementProcessed(duration time.Duration) {
	w.mu.Lock()
	defer w.mu.Unlock()

	w.stats.JobsProcessed++
	w.stats.TotalDurationMs += duration.Milliseconds()
	if w.stats.JobsProcessed > 0 {
		w.stats.AverageDurationMs = float64(w.stats.TotalDurationMs) / float64(w.stats.JobsProcessed)
	}
}

// incrementFailed updates failure statistics
func (w *EmbeddingWorker) incrementFailed() {
	w.mu.Lock()
	defer w.mu.Unlock()

	w.stats.JobsFailed++
}

// incrementCacheHit updates cache hit statistics
func (w *EmbeddingWorker) incrementCacheHit() {
	w.mu.Lock()
	defer w.mu.Unlock()

	w.stats.CacheHits++
	// Update hit rate
	total := w.stats.CacheHits + w.stats.CacheMisses
	if total > 0 {
		w.stats.CacheHitRate = float64(w.stats.CacheHits) / float64(total)
	}
}

// incrementCacheMiss updates cache miss statistics
func (w *EmbeddingWorker) incrementCacheMiss() {
	w.mu.Lock()
	defer w.mu.Unlock()

	w.stats.CacheMisses++
	// Update hit rate
	total := w.stats.CacheHits + w.stats.CacheMisses
	if total > 0 {
		w.stats.CacheHitRate = float64(w.stats.CacheHits) / float64(total)
	}
}

// SerializePolicyToText converts a policy to embedding-friendly text
func SerializePolicyToText(pol *types.Policy) string {
	var parts []string

	// Policy name
	if pol.Name != "" {
		parts = append(parts, fmt.Sprintf("Policy: %s", pol.Name))
	}

	// Resource kind (using ResourceKind field name)
	if pol.ResourceKind != "" {
		parts = append(parts, fmt.Sprintf("Resource: %s", pol.ResourceKind))
	}

	// Scope
	if pol.Scope != "" {
		parts = append(parts, fmt.Sprintf("Scope: %s", pol.Scope))
	}

	// Rules (summarized)
	if len(pol.Rules) > 0 {
		var ruleTexts []string
		for _, rule := range pol.Rules {
			// Actions
			actions := strings.Join(rule.Actions, ", ")

			// Roles
			roles := "any role"
			if len(rule.Roles) > 0 {
				roles = strings.Join(rule.Roles, ", ")
			}

			// Effect
			effect := "allow"
			if rule.Effect == types.EffectDeny {
				effect = "deny"
			}

			ruleText := fmt.Sprintf("%s %s for %s", effect, actions, roles)

			// Condition (simplified)
			if rule.Condition != "" {
				// Extract key parts of CEL condition
				simplified := simplifyCELCondition(rule.Condition)
				ruleText += fmt.Sprintf(" when %s", simplified)
			}

			ruleTexts = append(ruleTexts, ruleText)
		}
		parts = append(parts, fmt.Sprintf("Rules: %s", strings.Join(ruleTexts, "; ")))
	}

	return strings.Join(parts, ". ")
}

// simplifyCELCondition extracts key phrases from CEL expressions
func simplifyCELCondition(condition string) string {
	// Replace common CEL operators with natural language
	simplified := condition
	simplified = strings.ReplaceAll(simplified, "==", "equals")
	simplified = strings.ReplaceAll(simplified, "!=", "not equals")
	simplified = strings.ReplaceAll(simplified, "&&", "and")
	simplified = strings.ReplaceAll(simplified, "||", "or")
	simplified = strings.ReplaceAll(simplified, "principal.id", "user")
	simplified = strings.ReplaceAll(simplified, "resource.ownerId", "owner")
	simplified = strings.ReplaceAll(simplified, "resource.", "")
	simplified = strings.ReplaceAll(simplified, "principal.", "user.")

	// Truncate if too long
	if len(simplified) > 100 {
		simplified = simplified[:97] + "..."
	}

	return simplified
}

// DefaultEmbeddingFunction is a placeholder that generates random embeddings
// In production, replace with actual embedding model (e.g., sentence-transformers)
func DefaultEmbeddingFunction(text string) ([]float32, error) {
	// This is a PLACEHOLDER implementation
	// Production should use actual embedding models like:
	// - sentence-transformers/all-MiniLM-L6-v2
	// - OpenAI text-embedding-ada-002
	// - Cohere embed-english-v3.0

	dimension := 384 // Standard dimension for MiniLM

	// Generate deterministic "embedding" based on text hash
	// (NOT a real embedding, just for testing)
	embedding := make([]float32, dimension)
	hash := simpleHash(text)

	for i := 0; i < dimension; i++ {
		// Pseudo-random but deterministic based on text
		embedding[i] = float32((hash*31+i)%200-100) / 100.0
	}

	// Normalize to unit length
	normalize(embedding)

	return embedding, nil
}

// simpleHash generates a simple hash for testing
func simpleHash(s string) int {
	hash := 0
	for _, ch := range s {
		hash = hash*31 + int(ch)
	}
	return hash
}

// normalize converts vector to unit length
func normalize(vec []float32) {
	var norm float32
	for _, v := range vec {
		norm += v * v
	}

	if norm > 0 {
		norm = float32(1.0 / (norm + 0.00001))
		for i := range vec {
			vec[i] *= norm
		}
	}
}

// DetectVersionMismatch checks if a vector's model_version differs from worker's version
func (w *EmbeddingWorker) DetectVersionMismatch(vec interface{}) bool {
	// Handle *vector.Vector type from vector package
	if v, ok := vec.(*vector.Vector); ok {
		if storedVersion, exists := v.Metadata["model_version"]; exists {
			if versionStr, ok := storedVersion.(string); ok {
				return versionStr != w.ModelVersion
			}
		}
	}

	// No version metadata means legacy embedding (not a mismatch per se)
	return false
}
