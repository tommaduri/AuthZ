// Package rest provides the REST API server implementation
package rest

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	"go.uber.org/zap"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/internal/server/middleware"
)

// Server is the REST API server
type Server struct {
	engine        *engine.Engine
	policyStore   policy.Store
	router        *mux.Router
	httpServer    *http.Server
	logger        *zap.Logger
	config        Config
	startTime     time.Time
	authenticator *middleware.Authenticator
}

// Config configures the REST API server
type Config struct {
	Port            int
	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
	IdleTimeout     time.Duration
	EnableCORS      bool
	CORSOrigins     []string
	EnableAuth      bool
	Authenticator   *middleware.Authenticator
	Version         string
}

// DefaultConfig returns default REST server configuration
func DefaultConfig() Config {
	return Config{
		Port:         8080,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
		EnableCORS:   true,
		CORSOrigins:  []string{"*"},
		EnableAuth:   false,
		Version:      "1.0.0",
	}
}

// New creates a new REST API server
func New(cfg Config, eng *engine.Engine, policyStore policy.Store, logger *zap.Logger) (*Server, error) {
	if eng == nil {
		return nil, fmt.Errorf("engine is required")
	}
	if policyStore == nil {
		return nil, fmt.Errorf("policy store is required")
	}
	if logger == nil {
		logger = zap.NewNop()
	}

	s := &Server{
		engine:      eng,
		policyStore: policyStore,
		router:      mux.NewRouter(),
		logger:      logger,
		config:      cfg,
		startTime:   time.Now(),
	}

	if cfg.Authenticator != nil {
		s.authenticator = cfg.Authenticator
	}

	// Register routes
	s.registerRoutes()

	// Create HTTP server
	s.httpServer = &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      s.router,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
	}

	return s, nil
}

// registerRoutes registers all REST API routes
func (s *Server) registerRoutes() {
	// Apply global middleware
	s.router.Use(s.loggingMiddleware)
	s.router.Use(s.recoveryMiddleware)

	if s.config.EnableCORS {
		s.router.Use(s.corsMiddleware)
	}

	// Health and status endpoints (no auth required)
	s.router.HandleFunc("/health", s.healthCheckHandler).Methods("GET")
	s.router.HandleFunc("/v1/status", s.statusHandler).Methods("GET")

	// API v1 routes
	v1 := s.router.PathPrefix("/v1").Subrouter()

	// Apply authentication middleware to API routes if enabled
	if s.config.EnableAuth && s.authenticator != nil {
		v1.Use(func(next http.Handler) http.Handler {
			return s.authenticator.HTTPMiddleware(next)
		})
	}

	// Authorization endpoints
	authz := v1.PathPrefix("/authorization").Subrouter()
	authz.HandleFunc("/check", s.authorizationCheckHandler).Methods("POST")
	authz.HandleFunc("/check-resources", s.batchCheckResourcesHandler).Methods("POST")
	authz.HandleFunc("/allowed-actions", s.allowedActionsHandler).Methods("GET")

	// Policy management endpoints
	policies := v1.PathPrefix("/policies").Subrouter()
	policies.HandleFunc("", s.listPoliciesHandler).Methods("GET")
	policies.HandleFunc("", s.createPolicyHandler).Methods("POST")
	policies.HandleFunc("/{id}", s.getPolicyHandler).Methods("GET")
	policies.HandleFunc("/{id}", s.updatePolicyHandler).Methods("PUT")
	policies.HandleFunc("/{id}", s.deletePolicyHandler).Methods("DELETE")

	// Policy export/import endpoints
	policies.HandleFunc("/export", s.exportPoliciesHandler).Methods("POST")
	policies.HandleFunc("/import", s.importPoliciesHandler).Methods("POST")
	policies.HandleFunc("/validate", s.validatePoliciesHandler).Methods("POST")

	// Backup/restore endpoints
	policies.HandleFunc("/backup", s.backupPoliciesHandler).Methods("POST")
	policies.HandleFunc("/restore", s.restorePoliciesHandler).Methods("POST")
	policies.HandleFunc("/backups", s.listBackupsHandler).Methods("GET")

	// Principal management endpoints
	principals := v1.PathPrefix("/principals").Subrouter()
	principals.HandleFunc("/{id}", s.getPrincipalHandler).Methods("GET")
	principals.HandleFunc("", s.createPrincipalHandler).Methods("POST")
	principals.HandleFunc("/{id}", s.updatePrincipalHandler).Methods("PUT")
}

// Start starts the REST API server
func (s *Server) Start() error {
	s.logger.Info("Starting REST API server",
		zap.Int("port", s.config.Port),
		zap.Bool("auth_enabled", s.config.EnableAuth),
		zap.Bool("cors_enabled", s.config.EnableCORS),
	)

	return s.httpServer.ListenAndServe()
}

// Shutdown gracefully shuts down the REST API server
func (s *Server) Shutdown(ctx context.Context) error {
	s.logger.Info("Shutting down REST API server")
	return s.httpServer.Shutdown(ctx)
}

// ServeHTTP implements http.Handler interface for testing
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.router.ServeHTTP(w, r)
}

// loggingMiddleware logs HTTP requests
func (s *Server) loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Wrap response writer to capture status code
		wrappedWriter := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

		next.ServeHTTP(wrappedWriter, r)

		duration := time.Since(start)
		s.logger.Info("HTTP request",
			zap.String("method", r.Method),
			zap.String("path", r.URL.Path),
			zap.Int("status", wrappedWriter.statusCode),
			zap.Duration("duration", duration),
			zap.String("remote_addr", r.RemoteAddr),
		)
	})
}

// recoveryMiddleware recovers from panics
func (s *Server) recoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				s.logger.Error("Panic recovered",
					zap.Any("error", err),
					zap.String("method", r.Method),
					zap.String("path", r.URL.Path),
				)
				WriteError(w, http.StatusInternalServerError, "Internal server error", nil)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// corsMiddleware adds CORS headers
func (s *Server) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Set CORS headers
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = "*"
		}

		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Max-Age", "3600")

		// Handle preflight requests
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// healthCheckHandler handles health check requests
func (s *Server) healthCheckHandler(w http.ResponseWriter, r *http.Request) {
	checks := make(map[string]interface{})
	checks["engine"] = "ok"
	checks["policy_store"] = "ok"

	// Check cache if enabled
	if s.engine.GetCacheStats() != nil {
		checks["cache"] = "ok"
	}

	response := HealthResponse{
		Status:    "healthy",
		Timestamp: time.Now(),
		Checks:    checks,
	}

	WriteJSON(w, http.StatusOK, response)
}

// statusHandler handles service status requests
func (s *Server) statusHandler(w http.ResponseWriter, r *http.Request) {
	uptime := time.Since(s.startTime)

	response := StatusResponse{
		Version:      s.config.Version,
		Uptime:       uptime.String(),
		CacheEnabled: s.engine.GetCacheStats() != nil,
		Timestamp:    time.Now(),
	}

	// Add cache stats if available
	if stats := s.engine.GetCacheStats(); stats != nil {
		response.CacheStats = map[string]interface{}{
			"hits":      stats.Hits,
			"misses":    stats.Misses,
			"evictions": stats.Evictions,
			"size":      stats.Size,
		}
	}

	WriteJSON(w, http.StatusOK, response)
}

// responseWriter wraps http.ResponseWriter to capture status code
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}
