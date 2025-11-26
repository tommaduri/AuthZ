package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/metrics"
	"github.com/authz-engine/go-core/internal/policy/memory"
	"github.com/authz-engine/go-core/pkg/types"
)

func main() {
	// 1. Configuration via environment variables
	port := getEnv("PORT", "8080")
	cacheSize := getEnvInt("CACHE_SIZE", 100000)
	workers := getEnvInt("WORKERS", 16)

	// 2. Create Prometheus metrics instance
	metricsCollector := metrics.NewPrometheusMetrics("authz")
	log.Println("✓ Prometheus metrics initialized")

	// 3. Create policy store and seed with sample policies
	store := memory.NewMemoryStore()
	seedSamplePolicies(store)
	log.Println("✓ Policy store initialized with sample policies")

	// 4. Create DecisionEngine with metrics
	cfg := engine.Config{
		CacheEnabled:    true,
		CacheSize:       cacheSize,
		CacheTTL:        5 * time.Minute,
		ParallelWorkers: workers,
		Metrics:         metricsCollector, // Inject Prometheus metrics
		DefaultEffect:   types.EffectDeny,
	}

	eng, err := engine.New(cfg, store)
	if err != nil {
		log.Fatalf("Failed to create engine: %v", err)
	}
	log.Printf("✓ Authorization engine initialized (cache: %d, workers: %d)", cacheSize, workers)

	// 5. Setup HTTP routes
	mux := http.NewServeMux()

	// Metrics endpoint (for Prometheus scraping)
	mux.Handle("/metrics", metricsCollector.HTTPHandler())

	// Health check endpoint
	mux.HandleFunc("/health", healthHandler)

	// Authorization check endpoint
	mux.HandleFunc("/v1/check", checkHandler(eng, metricsCollector))

	// Root endpoint with API documentation
	mux.HandleFunc("/", rootHandler)

	// 6. Create HTTP server
	server := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  30 * time.Second,
	}

	// 7. Graceful shutdown
	go func() {
		sigint := make(chan os.Signal, 1)
		signal.Notify(sigint, os.Interrupt, syscall.SIGTERM)
		<-sigint

		log.Println("⚠ Shutdown signal received, gracefully stopping...")

		// Create shutdown context with timeout
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		// Shutdown HTTP server
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("❌ HTTP server shutdown error: %v", err)
		}

		// Shutdown engine (closes background workers, vector store, etc.)
		if err := eng.Shutdown(shutdownCtx); err != nil {
			log.Printf("❌ Engine shutdown error: %v", err)
		}

		log.Println("✓ Server stopped gracefully")
	}()

	// 8. Start HTTP server
	log.Printf("🚀 AuthZ Engine HTTP Server started")
	log.Printf("   Metrics:        http://localhost:%s/metrics", port)
	log.Printf("   Health:         http://localhost:%s/health", port)
	log.Printf("   Authorization:  http://localhost:%s/v1/check", port)
	log.Printf("   Documentation:  http://localhost:%s/", port)

	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("❌ HTTP server error: %v", err)
	}
}

// healthHandler returns a simple health check response
func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, "OK\n")
}

// checkHandler handles authorization check requests
func checkHandler(eng *engine.Engine, m metrics.Metrics) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Only accept POST requests
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Record active request
		m.IncActiveRequests()
		defer m.DecActiveRequests()

		start := time.Now()

		// Parse request body
		var req types.CheckRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			m.RecordAuthError("parse_error")
			http.Error(w, fmt.Sprintf("Invalid request: %v", err), http.StatusBadRequest)
			return
		}

		// Perform authorization check
		resp, err := eng.Check(context.Background(), &req)
		duration := time.Since(start)

		if err != nil {
			m.RecordAuthError("check_error")
			http.Error(w, fmt.Sprintf("Authorization check failed: %v", err), http.StatusInternalServerError)
			return
		}

		// Metrics are automatically recorded by engine
		// (RecordCheck, RecordCacheHit/Miss)

		// Return JSON response
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)

		// Add duration to metadata
		if resp.Metadata == nil {
			resp.Metadata = &types.ResponseMetadata{}
		}
		resp.Metadata.EvaluationDurationUs = float64(duration.Microseconds())

		if err := json.NewEncoder(w).Encode(resp); err != nil {
			log.Printf("Failed to encode response: %v", err)
		}
	}
}

// rootHandler provides API documentation
func rootHandler(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	fmt.Fprintf(w, `AuthZ Engine HTTP Server
========================

Available Endpoints:
  GET  /          - This documentation
  GET  /health    - Health check (returns 200 OK)
  GET  /metrics   - Prometheus metrics (for scraping)
  POST /v1/check  - Authorization check

Authorization Check API:
  POST /v1/check
  Content-Type: application/json

  Request Body:
  {
    "principal": {
      "id": "user:alice",
      "roles": ["viewer"]
    },
    "resource": {
      "kind": "document",
      "id": "doc-123"
    },
    "actions": ["read"]
  }

  Response:
  {
    "results": {
      "read": {
        "effect": "EFFECT_ALLOW",
        "policy": "document-viewer-policy",
        "matched": true
      }
    },
    "metadata": {
      "evaluationDurationUs": 1234.56,
      "policiesEvaluated": 3,
      "cacheHit": false
    }
  }

Example curl commands:
  # Health check
  curl http://localhost:8080/health

  # Authorization check
  curl -X POST http://localhost:8080/v1/check \
    -H "Content-Type: application/json" \
    -d '{
      "principal": {"id": "user:alice", "roles": ["viewer"]},
      "resource": {"kind": "document", "id": "doc-123"},
      "actions": ["read"]
    }'

  # View metrics
  curl http://localhost:8080/metrics

Prometheus Metrics:
  - authz_checks_total{effect="EFFECT_ALLOW|EFFECT_DENY"}
  - authz_check_duration_microseconds
  - authz_cache_hits_total
  - authz_cache_misses_total
  - authz_errors_total{type="..."}
  - authz_active_requests
`)
}

// seedSamplePolicies adds example policies for testing
func seedSamplePolicies(store *memory.MemoryStore) {
	// Document viewer policy
	viewerPolicy := &types.Policy{
		Name:        "document-viewer-policy",
		Version:     "1.0",
		Description: "Allows viewers to read documents",
		Rules: []types.PolicyRule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
				Roles:   []string{"viewer", "editor", "admin"},
			},
		},
		Metadata: map[string]string{
			"category": "example",
		},
	}

	// Document editor policy
	editorPolicy := &types.Policy{
		Name:        "document-editor-policy",
		Version:     "1.0",
		Description: "Allows editors to modify documents",
		Rules: []types.PolicyRule{
			{
				Name:    "allow-write",
				Actions: []string{"write", "update"},
				Effect:  types.EffectAllow,
				Roles:   []string{"editor", "admin"},
			},
		},
		Metadata: map[string]string{
			"category": "example",
		},
	}

	// Document admin policy
	adminPolicy := &types.Policy{
		Name:        "document-admin-policy",
		Version:     "1.0",
		Description: "Allows admins full control over documents",
		Rules: []types.PolicyRule{
			{
				Name:    "allow-all",
				Actions: []string{"*"},
				Effect:  types.EffectAllow,
				Roles:   []string{"admin"},
			},
		},
		Metadata: map[string]string{
			"category": "example",
		},
	}

	// Add policies to store
	store.Set(viewerPolicy)
	store.Set(editorPolicy)
	store.Set(adminPolicy)
}

// getEnv retrieves environment variable or returns default
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// getEnvInt retrieves integer environment variable or returns default
func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		var intValue int
		if _, err := fmt.Sscanf(value, "%d", &intValue); err == nil {
			return intValue
		}
	}
	return defaultValue
}
