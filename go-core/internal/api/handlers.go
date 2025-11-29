package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gorilla/mux"
	"go.uber.org/zap"

	"github.com/authz-engine/go-core/pkg/types"
)

// Batch operations

// batchCreatePolicies creates multiple policies at once
func (s *Server) batchCreatePolicies(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Policies map[string]*types.Policy `json:"policies"`
		Comment  string                   `json:"comment"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		s.respondError(w, http.StatusBadRequest, "INVALID_JSON",
			"Invalid JSON payload", err.Error())
		return
	}

	if len(request.Policies) == 0 {
		s.respondError(w, http.StatusBadRequest, "EMPTY_BATCH",
			"No policies provided", "")
		return
	}

	// Use rollback manager for atomic update
	ctx := context.Background()
	version, err := s.rollbackManager.UpdateWithRollback(ctx, request.Policies, request.Comment)
	if err != nil {
		s.respondError(w, http.StatusBadRequest, "BATCH_CREATE_FAILED",
			"Failed to create policies", err.Error())
		return
	}

	s.logger.Info("Batch policies created",
		zap.Int("count", len(request.Policies)),
		zap.Int64("version", version.Version))

	s.respondJSON(w, http.StatusCreated, map[string]interface{}{
		"message":  fmt.Sprintf("Successfully created %d policies", len(request.Policies)),
		"count":    len(request.Policies),
		"version":  version.Version,
		"policies": request.Policies,
	})
}

// batchValidatePolicies validates multiple policies without creating them
func (s *Server) batchValidatePolicies(w http.ResponseWriter, r *http.Request) {
	var policies map[string]*types.Policy
	if err := json.NewDecoder(r.Body).Decode(&policies); err != nil {
		s.respondError(w, http.StatusBadRequest, "INVALID_JSON",
			"Invalid JSON payload", err.Error())
		return
	}

	if len(policies) == 0 {
		s.respondError(w, http.StatusBadRequest, "EMPTY_BATCH",
			"No policies provided", "")
		return
	}

	// Validate all policies
	result := s.validator.ValidatePolicies(policies)

	response := map[string]interface{}{
		"valid":         result.Valid,
		"policies_count": len(policies),
	}

	if len(result.Errors) > 0 {
		response["errors"] = result.Errors
	}

	if len(result.Warnings) > 0 {
		response["warnings"] = result.Warnings
	}

	statusCode := http.StatusOK
	if !result.Valid {
		statusCode = http.StatusBadRequest
	}

	s.respondJSON(w, statusCode, response)
}

// Validation endpoints

// validatePolicy validates a specific existing policy
func (s *Server) validatePolicy(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	name := vars["name"]

	policy, err := s.policyStore.Get(name)
	if err != nil {
		s.respondError(w, http.StatusNotFound, "POLICY_NOT_FOUND",
			fmt.Sprintf("Policy '%s' not found", name), err.Error())
		return
	}

	result := s.validator.ValidatePolicyEnhanced(policy)

	response := map[string]interface{}{
		"valid":  result.Valid,
		"policy": name,
	}

	if len(result.Errors) > 0 {
		response["errors"] = result.Errors
	}

	if len(result.Warnings) > 0 {
		response["warnings"] = result.Warnings
	}

	s.respondJSON(w, http.StatusOK, response)
}

// validatePolicyPayload validates a policy payload without storing it
func (s *Server) validatePolicyPayload(w http.ResponseWriter, r *http.Request) {
	var policy types.Policy
	if err := json.NewDecoder(r.Body).Decode(&policy); err != nil {
		s.respondError(w, http.StatusBadRequest, "INVALID_JSON",
			"Invalid JSON payload", err.Error())
		return
	}

	result := s.validator.ValidatePolicyEnhanced(&policy)

	response := map[string]interface{}{
		"valid": result.Valid,
	}

	if len(result.Errors) > 0 {
		response["errors"] = result.Errors
	}

	if len(result.Warnings) > 0 {
		response["warnings"] = result.Warnings
	}

	s.respondJSON(w, http.StatusOK, response)
}

// Version management endpoints

// listVersions returns all policy versions
func (s *Server) listVersions(w http.ResponseWriter, r *http.Request) {
	versions := s.rollbackManager.ListVersions()

	// Convert to summary format
	summaries := make([]map[string]interface{}, len(versions))
	for i, v := range versions {
		summaries[i] = map[string]interface{}{
			"version":       v.Version,
			"timestamp":     v.Timestamp,
			"comment":       v.Comment,
			"policies_count": len(v.Policies),
			"checksum":      v.Checksum,
		}
	}

	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"versions": summaries,
		"count":    len(versions),
	})
}

// getVersion returns a specific policy version
func (s *Server) getVersion(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	versionStr := vars["version"]

	version, err := strconv.ParseInt(versionStr, 10, 64)
	if err != nil {
		s.respondError(w, http.StatusBadRequest, "INVALID_VERSION",
			"Invalid version number", err.Error())
		return
	}

	policyVersion, err := s.rollbackManager.GetVersion(version)
	if err != nil {
		s.respondError(w, http.StatusNotFound, "VERSION_NOT_FOUND",
			fmt.Sprintf("Version %d not found", version), err.Error())
		return
	}

	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"version":        policyVersion.Version,
		"timestamp":      policyVersion.Timestamp,
		"comment":        policyVersion.Comment,
		"policies_count": len(policyVersion.Policies),
		"checksum":       policyVersion.Checksum,
		"policies":       policyVersion.Policies,
	})
}

// getCurrentVersion returns the current policy version
func (s *Server) getCurrentVersion(w http.ResponseWriter, r *http.Request) {
	version, err := s.rollbackManager.GetCurrentVersion()
	if err != nil {
		s.respondError(w, http.StatusNotFound, "NO_VERSION",
			"No policy versions available", err.Error())
		return
	}

	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"version":        version.Version,
		"timestamp":      version.Timestamp,
		"comment":        version.Comment,
		"policies_count": len(version.Policies),
		"checksum":       version.Checksum,
		"policies":       version.Policies,
	})
}

// rollbackToVersion rolls back to a specific version
func (s *Server) rollbackToVersion(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	versionStr := vars["version"]

	version, err := strconv.ParseInt(versionStr, 10, 64)
	if err != nil {
		s.respondError(w, http.StatusBadRequest, "INVALID_VERSION",
			"Invalid version number", err.Error())
		return
	}

	ctx := context.Background()
	if err := s.rollbackManager.Rollback(ctx, version); err != nil {
		s.respondError(w, http.StatusInternalServerError, "ROLLBACK_FAILED",
			fmt.Sprintf("Failed to rollback to version %d", version), err.Error())
		return
	}

	s.logger.Info("Rolled back to version", zap.Int64("version", version))

	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"message": fmt.Sprintf("Successfully rolled back to version %d", version),
		"version": version,
	})
}

// rollbackToPrevious rolls back to the previous version
func (s *Server) rollbackToPrevious(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()
	if err := s.rollbackManager.RollbackToPrevious(ctx); err != nil {
		s.respondError(w, http.StatusInternalServerError, "ROLLBACK_FAILED",
			"Failed to rollback to previous version", err.Error())
		return
	}

	currentVersion, err := s.rollbackManager.GetCurrentVersion()
	if err != nil {
		s.respondError(w, http.StatusInternalServerError, "GET_VERSION_FAILED",
			"Rollback succeeded but failed to get current version", err.Error())
		return
	}

	s.logger.Info("Rolled back to previous version", zap.Int64("version", currentVersion.Version))

	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"message": "Successfully rolled back to previous version",
		"version": currentVersion.Version,
	})
}

// Statistics endpoint

// getStats returns system statistics
func (s *Server) getStats(w http.ResponseWriter, r *http.Request) {
	stats := s.rollbackManager.GetStats()
	policies := s.policyStore.GetAll()

	// Calculate policy statistics
	totalRules := 0
	resourceKinds := make(map[string]int)
	for _, p := range policies {
		totalRules += len(p.Rules)
		resourceKinds[p.ResourceKind]++
	}

	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"policies": map[string]interface{}{
			"total":          len(policies),
			"total_rules":    totalRules,
			"resource_kinds": resourceKinds,
		},
		"versions": map[string]interface{}{
			"current":        stats.CurrentVersion,
			"total_versions": stats.TotalVersions,
			"max_versions":   stats.MaxVersions,
		},
	})
}

// Health check endpoint

// healthCheck returns server health status
func (s *Server) healthCheck(w http.ResponseWriter, r *http.Request) {
	// Check if we can access the policy store
	healthy := true
	var checks = make(map[string]interface{})

	// Check policy store
	_, err := s.policyStore.Get("_health_check_non_existent_")
	checks["policy_store"] = map[string]interface{}{
		"status": "ok",
		"error":  nil,
	}
	if err != nil && err.Error() != "policy not found: _health_check_non_existent_" {
		healthy = false
		checks["policy_store"] = map[string]interface{}{
			"status": "error",
			"error":  err.Error(),
		}
	}

	// Check validator
	checks["validator"] = map[string]interface{}{
		"status": "ok",
	}

	status := "healthy"
	statusCode := http.StatusOK
	if !healthy {
		status = "unhealthy"
		statusCode = http.StatusServiceUnavailable
	}

	s.respondJSON(w, statusCode, map[string]interface{}{
		"status": status,
		"checks": checks,
	})
}
