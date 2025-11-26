// Package api provides the REST API server for admin dashboard
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	"go.uber.org/zap"

	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

// Server is the REST API server
type Server struct {
	router          *mux.Router
	httpServer      *http.Server
	logger          *zap.Logger
	policyStore     policy.Store
	validator       *policy.EnhancedValidator
	rollbackManager *policy.RollbackManager
	config          Config
}

// Config configures the REST API server
type Config struct {
	Port              int
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	EnableCORS        bool
	AllowedOrigins    []string
	EnableAuth        bool
	JWTSecret         string
	MaxBodySize       int64
}

// DefaultConfig returns default API server configuration
func DefaultConfig() Config {
	return Config{
		Port:           8080,
		ReadTimeout:    15 * time.Second,
		WriteTimeout:   15 * time.Second,
		IdleTimeout:    60 * time.Second,
		EnableCORS:     true,
		AllowedOrigins: []string{"*"},
		EnableAuth:     false,
		MaxBodySize:    1 * 1024 * 1024, // 1MB
	}
}

// New creates a new REST API server
func New(cfg Config, store policy.Store, validator *policy.EnhancedValidator, rm *policy.RollbackManager, logger *zap.Logger) (*Server, error) {
	if store == nil {
		return nil, fmt.Errorf("policy store is required")
	}
	if validator == nil {
		return nil, fmt.Errorf("validator is required")
	}
	if rm == nil {
		return nil, fmt.Errorf("rollback manager is required")
	}
	if logger == nil {
		logger = zap.NewNop()
	}

	s := &Server{
		router:          mux.NewRouter(),
		logger:          logger,
		policyStore:     store,
		validator:       validator,
		rollbackManager: rm,
		config:          cfg,
	}

	// Setup routes
	s.setupRoutes()

	// Create HTTP server
	s.httpServer = &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      s.router,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
		MaxHeaderBytes: 1 << 20, // 1MB
	}

	return s, nil
}

// setupRoutes configures all API routes
func (s *Server) setupRoutes() {
	// Apply middleware
	s.router.Use(s.loggingMiddleware)
	s.router.Use(s.recoveryMiddleware)
	if s.config.EnableCORS {
		s.router.Use(s.corsMiddleware)
	}
	s.router.Use(s.maxBodySizeMiddleware)

	// API v1 routes
	api := s.router.PathPrefix("/api/v1").Subrouter()

	// Policy CRUD endpoints
	api.HandleFunc("/policies", s.listPolicies).Methods("GET")
	api.HandleFunc("/policies", s.createPolicy).Methods("POST")
	api.HandleFunc("/policies/{name}", s.getPolicy).Methods("GET")
	api.HandleFunc("/policies/{name}", s.updatePolicy).Methods("PUT")
	api.HandleFunc("/policies/{name}", s.deletePolicy).Methods("DELETE")

	// Batch operations
	api.HandleFunc("/policies/batch", s.batchCreatePolicies).Methods("POST")
	api.HandleFunc("/policies/batch/validate", s.batchValidatePolicies).Methods("POST")

	// Validation endpoints
	api.HandleFunc("/policies/{name}/validate", s.validatePolicy).Methods("POST")
	api.HandleFunc("/policies/validate", s.validatePolicyPayload).Methods("POST")

	// Version management
	api.HandleFunc("/versions", s.listVersions).Methods("GET")
	api.HandleFunc("/versions/{version}", s.getVersion).Methods("GET")
	api.HandleFunc("/versions/{version}/rollback", s.rollbackToVersion).Methods("POST")
	api.HandleFunc("/versions/current", s.getCurrentVersion).Methods("GET")
	api.HandleFunc("/versions/previous/rollback", s.rollbackToPrevious).Methods("POST")

	// Statistics
	api.HandleFunc("/stats", s.getStats).Methods("GET")

	// Health check
	api.HandleFunc("/health", s.healthCheck).Methods("GET")
}

// Start starts the HTTP server
func (s *Server) Start() error {
	s.logger.Info("Starting REST API server", zap.Int("port", s.config.Port))
	return s.httpServer.ListenAndServe()
}

// Stop gracefully stops the HTTP server
func (s *Server) Stop(ctx context.Context) error {
	s.logger.Info("Stopping REST API server")
	return s.httpServer.Shutdown(ctx)
}

// Router returns the underlying router for testing
func (s *Server) Router() *mux.Router {
	return s.router
}

// Response helpers
type apiResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   *apiError   `json:"error,omitempty"`
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details string `json:"details,omitempty"`
}

func (s *Server) respondJSON(w http.ResponseWriter, statusCode int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)

	response := apiResponse{
		Success: statusCode >= 200 && statusCode < 300,
		Data:    data,
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		s.logger.Error("Failed to encode response", zap.Error(err))
	}
}

func (s *Server) respondError(w http.ResponseWriter, statusCode int, code, message, details string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)

	response := apiResponse{
		Success: false,
		Error: &apiError{
			Code:    code,
			Message: message,
			Details: details,
		},
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		s.logger.Error("Failed to encode error response", zap.Error(err))
	}
}

// Policy CRUD handlers

// listPolicies returns all policies
func (s *Server) listPolicies(w http.ResponseWriter, r *http.Request) {
	policies := s.policyStore.GetAll()

	// Convert to map for JSON response
	policyMap := make(map[string]*types.Policy)
	for _, p := range policies {
		policyMap[p.Name] = p
	}

	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"policies": policyMap,
		"count":    len(policies),
	})
}

// getPolicy returns a specific policy
func (s *Server) getPolicy(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	name := vars["name"]

	policy, err := s.policyStore.Get(name)
	if err != nil {
		s.respondError(w, http.StatusNotFound, "POLICY_NOT_FOUND",
			fmt.Sprintf("Policy '%s' not found", name), err.Error())
		return
	}

	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"policy": policy,
	})
}

// createPolicy creates a new policy
func (s *Server) createPolicy(w http.ResponseWriter, r *http.Request) {
	var policy types.Policy
	if err := json.NewDecoder(r.Body).Decode(&policy); err != nil {
		s.respondError(w, http.StatusBadRequest, "INVALID_JSON",
			"Invalid JSON payload", err.Error())
		return
	}

	// Validate policy
	result := s.validator.ValidatePolicyEnhanced(&policy)
	if !result.Valid {
		s.respondError(w, http.StatusBadRequest, "VALIDATION_FAILED",
			"Policy validation failed", formatValidationErrors(result.Errors))
		return
	}

	// Check if policy already exists
	if _, err := s.policyStore.Get(policy.Name); err == nil {
		s.respondError(w, http.StatusConflict, "POLICY_EXISTS",
			fmt.Sprintf("Policy '%s' already exists", policy.Name), "")
		return
	}

	// Add policy
	if err := s.policyStore.Add(&policy); err != nil {
		s.respondError(w, http.StatusInternalServerError, "CREATE_FAILED",
			"Failed to create policy", err.Error())
		return
	}

	s.logger.Info("Policy created", zap.String("name", policy.Name))
	s.respondJSON(w, http.StatusCreated, map[string]interface{}{
		"policy": &policy,
	})
}

// updatePolicy updates an existing policy
func (s *Server) updatePolicy(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	name := vars["name"]

	var policy types.Policy
	if err := json.NewDecoder(r.Body).Decode(&policy); err != nil {
		s.respondError(w, http.StatusBadRequest, "INVALID_JSON",
			"Invalid JSON payload", err.Error())
		return
	}

	// Ensure policy name matches URL
	if policy.Name != name {
		s.respondError(w, http.StatusBadRequest, "NAME_MISMATCH",
			"Policy name in payload must match URL", "")
		return
	}

	// Check if policy exists
	if _, err := s.policyStore.Get(name); err != nil {
		s.respondError(w, http.StatusNotFound, "POLICY_NOT_FOUND",
			fmt.Sprintf("Policy '%s' not found", name), err.Error())
		return
	}

	// Validate policy
	result := s.validator.ValidatePolicyEnhanced(&policy)
	if !result.Valid {
		s.respondError(w, http.StatusBadRequest, "VALIDATION_FAILED",
			"Policy validation failed", formatValidationErrors(result.Errors))
		return
	}

	// Update policy (remove old, add new)
	if err := s.policyStore.Remove(name); err != nil {
		s.respondError(w, http.StatusInternalServerError, "UPDATE_FAILED",
			"Failed to remove old policy", err.Error())
		return
	}

	if err := s.policyStore.Add(&policy); err != nil {
		s.respondError(w, http.StatusInternalServerError, "UPDATE_FAILED",
			"Failed to add updated policy", err.Error())
		return
	}

	s.logger.Info("Policy updated", zap.String("name", policy.Name))
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"policy": &policy,
	})
}

// deletePolicy deletes a policy
func (s *Server) deletePolicy(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	name := vars["name"]

	// Check if policy exists
	if _, err := s.policyStore.Get(name); err != nil {
		s.respondError(w, http.StatusNotFound, "POLICY_NOT_FOUND",
			fmt.Sprintf("Policy '%s' not found", name), err.Error())
		return
	}

	// Delete policy
	if err := s.policyStore.Remove(name); err != nil {
		s.respondError(w, http.StatusInternalServerError, "DELETE_FAILED",
			"Failed to delete policy", err.Error())
		return
	}

	s.logger.Info("Policy deleted", zap.String("name", name))
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"message": fmt.Sprintf("Policy '%s' deleted successfully", name),
	})
}

// Helper functions
func formatValidationErrors(errors []policy.ValidationError) string {
	if len(errors) == 0 {
		return ""
	}

	result := fmt.Sprintf("%d validation error(s): ", len(errors))
	for i, err := range errors {
		if i > 0 {
			result += "; "
		}
		result += fmt.Sprintf("[%s] %s at %s", err.Type, err.Message, err.Path)
	}
	return result
}
