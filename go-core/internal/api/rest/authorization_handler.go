// Package rest provides authorization endpoint handlers
package rest

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/authz-engine/go-core/pkg/types"
)

// authorizationCheckHandler handles POST /v1/authorization/check
func (s *Server) authorizationCheckHandler(w http.ResponseWriter, r *http.Request) {
	var req AuthorizationCheckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.logger.Error("Failed to decode authorization check request",
			zap.Error(err),
		)
		WriteError(w, http.StatusBadRequest, "Invalid request body", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	// Validate request
	if req.Principal.ID == "" {
		WriteError(w, http.StatusBadRequest, "principal.id is required", nil)
		return
	}
	if req.Resource.Kind == "" {
		WriteError(w, http.StatusBadRequest, "resource.kind is required", nil)
		return
	}
	if req.Resource.ID == "" {
		WriteError(w, http.StatusBadRequest, "resource.id is required", nil)
		return
	}
	if req.Action == "" {
		WriteError(w, http.StatusBadRequest, "action is required", nil)
		return
	}

	// Convert to internal types
	internalReq := &types.CheckRequest{
		RequestID: uuid.New().String(),
		Principal: req.Principal.ToInternalPrincipal(),
		Resource:  req.Resource.ToInternalResource(),
		Actions:   []string{req.Action},
		Context:   req.Context,
	}

	// Execute authorization check
	start := time.Now()
	resp, err := s.engine.Check(r.Context(), internalReq)
	if err != nil {
		s.logger.Error("Authorization check failed",
			zap.String("request_id", internalReq.RequestID),
			zap.Error(err),
		)
		WriteError(w, http.StatusInternalServerError, "Authorization check failed", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	// Convert response
	result, ok := resp.Results[req.Action]
	if !ok {
		s.logger.Error("Action result not found in response",
			zap.String("action", req.Action),
		)
		WriteError(w, http.StatusInternalServerError, "Action result not found", nil)
		return
	}

	response := AuthorizationCheckResponse{
		Allowed: result.Effect == types.EffectAllow,
		Effect:  string(result.Effect),
		Policy:  result.Policy,
		Rule:    result.Rule,
	}

	// Add metadata if available
	if resp.Metadata != nil {
		response.Metadata = &ResponseMetadata{
			EvaluationDurationMs: float64(time.Since(start).Microseconds()) / 1000.0,
			PoliciesEvaluated:    resp.Metadata.PoliciesEvaluated,
			CacheHit:             resp.Metadata.CacheHit,
			Timestamp:            time.Now(),
			RequestID:            internalReq.RequestID,
			ScopeResolution:      resp.Metadata.ScopeResolution,
			PolicyResolution:     resp.Metadata.PolicyResolution,
			DerivedRoles:         resp.Metadata.DerivedRoles,
		}
	}

	WriteJSON(w, http.StatusOK, response)
}

// batchCheckResourcesHandler handles POST /v1/authorization/check-resources
func (s *Server) batchCheckResourcesHandler(w http.ResponseWriter, r *http.Request) {
	var req BatchCheckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.logger.Error("Failed to decode batch check request",
			zap.Error(err),
		)
		WriteError(w, http.StatusBadRequest, "Invalid request body", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	// Validate request
	if req.Principal.ID == "" {
		WriteError(w, http.StatusBadRequest, "principal.id is required", nil)
		return
	}
	if len(req.Resources) == 0 {
		WriteError(w, http.StatusBadRequest, "resources array cannot be empty", nil)
		return
	}

	// Validate each resource
	for i, res := range req.Resources {
		if res.Resource.Kind == "" {
			WriteError(w, http.StatusBadRequest, fmt.Sprintf("resources[%d].resource.kind is required", i), nil)
			return
		}
		if res.Resource.ID == "" {
			WriteError(w, http.StatusBadRequest, fmt.Sprintf("resources[%d].resource.id is required", i), nil)
			return
		}
		if res.Action == "" {
			WriteError(w, http.StatusBadRequest, fmt.Sprintf("resources[%d].action is required", i), nil)
			return
		}
	}

	// Convert to internal types and execute checks
	start := time.Now()
	results := make([]AuthorizationCheckResponse, len(req.Resources))

	for i, res := range req.Resources {
		internalReq := &types.CheckRequest{
			RequestID: uuid.New().String(),
			Principal: req.Principal.ToInternalPrincipal(),
			Resource:  res.Resource.ToInternalResource(),
			Actions:   []string{res.Action},
			Context:   req.Context,
		}

		resp, err := s.engine.Check(r.Context(), internalReq)
		if err != nil {
			s.logger.Error("Authorization check failed in batch",
				zap.Int("index", i),
				zap.String("request_id", internalReq.RequestID),
				zap.Error(err),
			)
			results[i] = AuthorizationCheckResponse{
				Allowed: false,
				Effect:  string(types.EffectDeny),
				Context: map[string]interface{}{
					"error": err.Error(),
				},
			}
			continue
		}

		// Convert result
		actionResult, ok := resp.Results[res.Action]
		if !ok {
			results[i] = AuthorizationCheckResponse{
				Allowed: false,
				Effect:  string(types.EffectDeny),
			}
			continue
		}

		results[i] = AuthorizationCheckResponse{
			Allowed: actionResult.Effect == types.EffectAllow,
			Effect:  string(actionResult.Effect),
			Policy:  actionResult.Policy,
			Rule:    actionResult.Rule,
		}

		// Add metadata
		if resp.Metadata != nil {
			results[i].Metadata = &ResponseMetadata{
				EvaluationDurationMs: resp.Metadata.EvaluationDurationUs / 1000.0,
				PoliciesEvaluated:    resp.Metadata.PoliciesEvaluated,
				CacheHit:             resp.Metadata.CacheHit,
				RequestID:            internalReq.RequestID,
			}
		}
	}

	response := BatchCheckResponse{
		Results: results,
		Metadata: &ResponseMetadata{
			EvaluationDurationMs: float64(time.Since(start).Microseconds()) / 1000.0,
			PoliciesEvaluated:    len(req.Resources),
			Timestamp:            time.Now(),
		},
	}

	WriteJSON(w, http.StatusOK, response)
}

// allowedActionsHandler handles GET /v1/authorization/allowed-actions
func (s *Server) allowedActionsHandler(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()

	// Parse query parameters
	principalID := query.Get("principal.id")
	if principalID == "" {
		WriteError(w, http.StatusBadRequest, "principal.id query parameter is required", nil)
		return
	}

	resourceKind := query.Get("resource.kind")
	if resourceKind == "" {
		WriteError(w, http.StatusBadRequest, "resource.kind query parameter is required", nil)
		return
	}

	resourceID := query.Get("resource.id")
	if resourceID == "" {
		WriteError(w, http.StatusBadRequest, "resource.id query parameter is required", nil)
		return
	}

	// Parse roles (comma-separated)
	var roles []string
	if rolesStr := query.Get("principal.roles"); rolesStr != "" {
		roles = strings.Split(rolesStr, ",")
	}

	// Build principal and resource
	principal := &types.Principal{
		ID:         principalID,
		Roles:      roles,
		Attributes: make(map[string]interface{}),
	}

	resource := &types.Resource{
		Kind:       resourceKind,
		ID:         resourceID,
		Attributes: make(map[string]interface{}),
	}

	// Parse optional attributes (would need to be JSON encoded in query param in real implementation)
	// For simplicity, we'll use basic key-value pairs
	for key, values := range query {
		if strings.HasPrefix(key, "principal.attr.") {
			attrKey := strings.TrimPrefix(key, "principal.attr.")
			principal.Attributes[attrKey] = values[0]
		}
		if strings.HasPrefix(key, "resource.attr.") {
			attrKey := strings.TrimPrefix(key, "resource.attr.")
			resource.Attributes[attrKey] = values[0]
		}
	}

	// Get common actions to test
	commonActions := []string{"read", "write", "delete", "update", "create", "view", "edit"}

	// Check each action
	allowedActions := make([]string, 0)
	start := time.Now()

	for _, action := range commonActions {
		internalReq := &types.CheckRequest{
			RequestID: uuid.New().String(),
			Principal: principal,
			Resource:  resource,
			Actions:   []string{action},
		}

		resp, err := s.engine.Check(r.Context(), internalReq)
		if err != nil {
			continue
		}

		result, ok := resp.Results[action]
		if ok && result.Effect == types.EffectAllow {
			allowedActions = append(allowedActions, action)
		}
	}

	response := AllowedActionsResponse{
		Actions: allowedActions,
		Metadata: &ResponseMetadata{
			EvaluationDurationMs: float64(time.Since(start).Microseconds()) / 1000.0,
			PoliciesEvaluated:    len(commonActions),
			Timestamp:            time.Now(),
		},
	}

	WriteJSON(w, http.StatusOK, response)
}

// Helper function to parse int query parameter
func parseIntQueryParam(query map[string][]string, key string, defaultValue int) int {
	if values, ok := query[key]; ok && len(values) > 0 {
		if val, err := strconv.Atoi(values[0]); err == nil {
			return val
		}
	}
	return defaultValue
}
