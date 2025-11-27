// Package rest provides policy management endpoint handlers
package rest

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/mux"
	"go.uber.org/zap"
)

// listPoliciesHandler handles GET /v1/policies
func (s *Server) listPoliciesHandler(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()

	// Parse pagination parameters
	limit := 50
	if limitStr := query.Get("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 1000 {
			limit = l
		}
	}

	offset := 0
	if offsetStr := query.Get("offset"); offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	}

	// Optional filters
	kind := query.Get("kind")
	scope := query.Get("scope")

	// Get all policies from store
	allPolicies := s.policyStore.GetAll()

	// Filter policies
	var filteredPolicies []*PolicyResponse
	for _, p := range allPolicies {
		// Apply kind filter
		if kind != "" && kind != "resource" && kind != "principal" {
			continue
		}
		if kind == "principal" && !p.PrincipalPolicy {
			continue
		}
		if kind == "resource" && p.PrincipalPolicy {
			continue
		}

		// Apply scope filter
		if scope != "" && p.Scope != scope {
			continue
		}

		filteredPolicies = append(filteredPolicies, FromInternalPolicy(p))
	}

	// Apply pagination
	total := len(filteredPolicies)
	start := offset
	end := offset + limit

	if start > total {
		start = total
	}
	if end > total {
		end = total
	}

	paginatedPolicies := filteredPolicies[start:end]

	// Calculate next offset
	var nextOffset *int
	if end < total {
		next := end
		nextOffset = &next
	}

	response := PolicyListResponse{
		Policies:   paginatedPolicies,
		Total:      total,
		Offset:     offset,
		Limit:      limit,
		NextOffset: nextOffset,
	}

	WriteJSON(w, http.StatusOK, response)
}

// getPolicyHandler handles GET /v1/policies/{id}
func (s *Server) getPolicyHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	policyID := vars["id"]

	if policyID == "" {
		WriteError(w, http.StatusBadRequest, "policy ID is required", nil)
		return
	}

	// Get policy from store
	policy, err := s.policyStore.Get(policyID)
	if err != nil {
		s.logger.Error("Failed to get policy",
			zap.String("policy_id", policyID),
			zap.Error(err),
		)
		WriteError(w, http.StatusNotFound, "Policy not found", map[string]interface{}{
			"policy_id": policyID,
		})
		return
	}

	response := FromInternalPolicy(policy)
	WriteJSON(w, http.StatusOK, response)
}

// createPolicyHandler handles POST /v1/policies
func (s *Server) createPolicyHandler(w http.ResponseWriter, r *http.Request) {
	var req PolicyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.logger.Error("Failed to decode policy request",
			zap.Error(err),
		)
		WriteError(w, http.StatusBadRequest, "Invalid request body", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	// Validate and convert to internal policy
	policy, err := req.ToInternalPolicy()
	if err != nil {
		s.logger.Error("Failed to convert policy request",
			zap.Error(err),
		)
		WriteError(w, http.StatusBadRequest, "Invalid policy", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	// Check if policy already exists
	if existing, _ := s.policyStore.Get(policy.Name); existing != nil {
		WriteError(w, http.StatusConflict, "Policy already exists", map[string]interface{}{
			"policy_id": policy.Name,
		})
		return
	}

	// Add policy to store
	if err := s.policyStore.Add(policy); err != nil {
		s.logger.Error("Failed to add policy",
			zap.String("policy_name", policy.Name),
			zap.Error(err),
		)
		WriteError(w, http.StatusInternalServerError, "Failed to create policy", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	s.logger.Info("Policy created",
		zap.String("policy_name", policy.Name),
		zap.String("resource_kind", policy.ResourceKind),
	)

	response := FromInternalPolicy(policy)
	WriteJSON(w, http.StatusCreated, response)
}

// updatePolicyHandler handles PUT /v1/policies/{id}
func (s *Server) updatePolicyHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	policyID := vars["id"]

	if policyID == "" {
		WriteError(w, http.StatusBadRequest, "policy ID is required", nil)
		return
	}

	var req PolicyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.logger.Error("Failed to decode policy request",
			zap.Error(err),
		)
		WriteError(w, http.StatusBadRequest, "Invalid request body", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	// Ensure name matches ID
	if req.Name != policyID {
		req.Name = policyID
	}

	// Validate and convert to internal policy
	policy, err := req.ToInternalPolicy()
	if err != nil {
		s.logger.Error("Failed to convert policy request",
			zap.Error(err),
		)
		WriteError(w, http.StatusBadRequest, "Invalid policy", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	// Check if policy exists
	if existing, _ := s.policyStore.Get(policyID); existing == nil {
		WriteError(w, http.StatusNotFound, "Policy not found", map[string]interface{}{
			"policy_id": policyID,
		})
		return
	}

	// Update policy (delete and add)
	if err := s.policyStore.Delete(policyID); err != nil {
		s.logger.Error("Failed to delete policy for update",
			zap.String("policy_id", policyID),
			zap.Error(err),
		)
		WriteError(w, http.StatusInternalServerError, "Failed to update policy", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	if err := s.policyStore.Add(policy); err != nil {
		s.logger.Error("Failed to add updated policy",
			zap.String("policy_name", policy.Name),
			zap.Error(err),
		)
		WriteError(w, http.StatusInternalServerError, "Failed to update policy", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	s.logger.Info("Policy updated",
		zap.String("policy_name", policy.Name),
	)

	response := FromInternalPolicy(policy)
	response.UpdatedAt = time.Now()
	WriteJSON(w, http.StatusOK, response)
}

// deletePolicyHandler handles DELETE /v1/policies/{id}
func (s *Server) deletePolicyHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	policyID := vars["id"]

	if policyID == "" {
		WriteError(w, http.StatusBadRequest, "policy ID is required", nil)
		return
	}

	// Check if policy exists
	if existing, _ := s.policyStore.Get(policyID); existing == nil {
		WriteError(w, http.StatusNotFound, "Policy not found", map[string]interface{}{
			"policy_id": policyID,
		})
		return
	}

	// Delete policy
	if err := s.policyStore.Delete(policyID); err != nil {
		s.logger.Error("Failed to delete policy",
			zap.String("policy_id", policyID),
			zap.Error(err),
		)
		WriteError(w, http.StatusInternalServerError, "Failed to delete policy", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	s.logger.Info("Policy deleted",
		zap.String("policy_id", policyID),
	)

	w.WriteHeader(http.StatusNoContent)
}
