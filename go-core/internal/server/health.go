// Package server provides the gRPC server implementation
package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"go.uber.org/zap"
)

// HealthHandler handles health check endpoints
type HealthHandler struct {
	engine *Engine
	logger *zap.Logger
	mu     sync.RWMutex
	ready  bool
}

// HealthStatus represents the health status response
type HealthStatus struct {
	Status      string            `json:"status"`
	Timestamp   time.Time         `json:"timestamp"`
	Uptime      string            `json:"uptime,omitempty"`
	Version     string            `json:"version,omitempty"`
	Checks      map[string]string `json:"checks,omitempty"`
	Description string            `json:"description,omitempty"`
}

// NewHealthHandler creates a new health handler
func NewHealthHandler(engine *Engine, logger *zap.Logger) *HealthHandler {
	return &HealthHandler{
		engine: engine,
		logger: logger,
		ready:  true,
	}
}

// SetReady updates the readiness status
func (h *HealthHandler) SetReady(ready bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.ready = ready
}

// IsReady returns the current readiness status
func (h *HealthHandler) IsReady() bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.ready
}

// Health handles GET /health - Basic liveness check
func (h *HealthHandler) Health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	status := HealthStatus{
		Status:      "UP",
		Timestamp:   time.Now().UTC(),
		Description: "Authorization server is running",
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(status)

	h.logger.Debug("Health check completed",
		zap.String("status", status.Status),
	)
}

// Ready handles GET /health/ready - Readiness with dependency checks
func (h *HealthHandler) Ready(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	checks := make(map[string]string)
	allReady := h.IsReady()

	// Check engine
	if h.engine != nil {
		checks["engine"] = "ready"
	} else {
		checks["engine"] = "not_ready"
		allReady = false
	}

	// Check cache (if applicable)
	if h.engine != nil && h.engine.cacheEnabled {
		checks["cache"] = "ready"
	}

	statusCode := http.StatusOK
	statusStr := "UP"
	if !allReady {
		statusCode = http.StatusServiceUnavailable
		statusStr = "DOWN"
	}

	status := HealthStatus{
		Status:    statusStr,
		Timestamp: time.Now().UTC(),
		Checks:    checks,
	}

	if !allReady {
		status.Description = "Not all dependencies are ready"
	} else {
		status.Description = "Ready to accept traffic"
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(status)

	h.logger.Debug("Readiness check completed",
		zap.String("status", statusStr),
		zap.Bool("ready", allReady),
	)
}

// Live handles GET /health/live - Kubernetes liveness probe
func (h *HealthHandler) Live(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Liveness is a simple check - if we're running and can respond, we're alive
	status := HealthStatus{
		Status:      "ALIVE",
		Timestamp:   time.Now().UTC(),
		Description: "Process is alive and responding",
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(status)

	h.logger.Debug("Liveness check completed")
}

// Startup handles GET /health/startup - Kubernetes startup probe
func (h *HealthHandler) Startup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	checks := make(map[string]string)
	allReady := true

	// Check engine initialization
	if h.engine != nil {
		checks["engine"] = "initialized"
	} else {
		checks["engine"] = "not_initialized"
		allReady = false
	}

	statusCode := http.StatusOK
	statusStr := "STARTED"
	if !allReady {
		statusCode = http.StatusServiceUnavailable
		statusStr = "STARTING"
	}

	status := HealthStatus{
		Status:    statusStr,
		Timestamp: time.Now().UTC(),
		Checks:    checks,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(status)

	h.logger.Debug("Startup check completed",
		zap.String("status", statusStr),
	)
}

// Engine is a minimal engine interface for health checks
type Engine struct {
	cacheEnabled bool
}

// RegisterHealthHandlers registers all health check handlers with the HTTP mux
func RegisterHealthHandlers(mux *http.ServeMux, handler *HealthHandler) {
	mux.HandleFunc("/health", handler.Health)
	mux.HandleFunc("/health/ready", handler.Ready)
	mux.HandleFunc("/health/live", handler.Live)
	mux.HandleFunc("/health/startup", handler.Startup)
}
