// Package handlers provides HTTP handlers for the REST API
package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/mux"
	"go.uber.org/zap"

	"github.com/authz-engine/go-core/internal/agent"
	"github.com/authz-engine/go-core/internal/delegation"
	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/pkg/types"
)

// AgentHandler handles agent-related API requests
type AgentHandler struct {
	agentStore      agent.Store
	delegationStore delegation.Store
	engine          *engine.Engine
	jwtSecret       []byte
	logger          *zap.Logger
	auditLog        []AuditLogEntry
}

// NewAgentHandler creates a new agent handler
func NewAgentHandler(
	agentStore agent.Store,
	delegationStore delegation.Store,
	engine *engine.Engine,
	jwtSecret []byte,
	logger *zap.Logger,
) *AgentHandler {
	if logger == nil {
		logger = zap.NewNop()
	}

	return &AgentHandler{
		agentStore:      agentStore,
		delegationStore: delegationStore,
		engine:          engine,
		jwtSecret:       jwtSecret,
		logger:          logger,
		auditLog:        []AuditLogEntry{},
	}
}

// Request/Response types

// RegisterAgentRequest is the request body for agent registration
type RegisterAgentRequest struct {
	ID          string              `json:"id"`
	Type        string              `json:"type"`
	DisplayName string              `json:"display_name"`
	Credentials []types.Credential  `json:"credentials"`
}

// RegisterAgentResponse is the response for agent registration
type RegisterAgentResponse struct {
	Agent *types.Agent `json:"agent"`
	Token string       `json:"token"`
}

// CreateDelegationRequest is the request body for creating a delegation
type CreateDelegationRequest struct {
	FromAgentID string    `json:"from_agent_id"`
	ToAgentID   string    `json:"to_agent_id"`
	Scopes      []string  `json:"scopes"`
	MaxHops     int       `json:"max_hops"`
	ExpiresAt   time.Time `json:"expires_at"`
}

// CreateDelegationResponse is the response for delegation creation
type CreateDelegationResponse struct {
	Delegation *types.Delegation `json:"delegation"`
}

// AgentCheckRequest is the request body for authorization check
type AgentCheckRequest struct {
	AgentID         string         `json:"agent_id"`
	DelegationChain []string       `json:"delegation_chain"`
	Action          string         `json:"action"`
	Resource        *types.Resource `json:"resource"`
}

// AgentCheckResponse is the response for authorization check
type AgentCheckResponse struct {
	Effect         string   `json:"effect"`
	ValidatedChain []string `json:"validated_chain"`
}

// GetAgentResponse is the response for getting agent details
type GetAgentResponse struct {
	Agent *types.Agent `json:"agent"`
}

// RevokeAgentResponse is the response for revoking an agent
type RevokeAgentResponse struct {
	Message string `json:"message"`
}

// AuditLogEntry represents an audit log entry
type AuditLogEntry struct {
	Timestamp  time.Time `json:"timestamp"`
	AgentID    string    `json:"agent_id"`
	Action     string    `json:"action"`
	Resource   string    `json:"resource"`
	Effect     string    `json:"effect"`
	LatencyMS  int64     `json:"latency_ms"`
}

// Handler methods

// RegisterAgent handles agent registration
func (h *AgentHandler) RegisterAgent(w http.ResponseWriter, r *http.Request) {
	var req RegisterAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body", err.Error())
		return
	}

	// Validate request
	if req.ID == "" {
		h.respondError(w, http.StatusBadRequest, "MISSING_FIELD", "Agent ID is required", "")
		return
	}
	if req.Type == "" {
		h.respondError(w, http.StatusBadRequest, "MISSING_FIELD", "Agent type is required", "")
		return
	}

	// Check if agent already exists
	existingAgent, err := h.agentStore.Get(req.ID)
	if err == nil && existingAgent != nil {
		h.respondError(w, http.StatusConflict, "AGENT_EXISTS", "Agent already exists", "")
		return
	}

	// Create agent
	newAgent := &types.Agent{
		ID:          req.ID,
		Type:        req.Type,
		DisplayName: req.DisplayName,
		Credentials: req.Credentials,
		CreatedAt:   time.Now(),
		Status:      "active",
	}

	if err := h.agentStore.Add(newAgent); err != nil {
		h.respondError(w, http.StatusInternalServerError, "STORE_ERROR", "Failed to store agent", err.Error())
		return
	}

	// Generate JWT token
	token, err := h.generateJWT(req.ID)
	if err != nil {
		h.respondError(w, http.StatusInternalServerError, "TOKEN_ERROR", "Failed to generate token", err.Error())
		return
	}

	// Redact credentials in response
	responseAgent := *newAgent
	redactedCreds := make([]types.Credential, len(responseAgent.Credentials))
	for i, cred := range responseAgent.Credentials {
		redactedCred := cred
		redactedCred.Value = "***REDACTED***"
		redactedCreds[i] = redactedCred
	}
	responseAgent.Credentials = redactedCreds

	h.respondJSON(w, http.StatusCreated, RegisterAgentResponse{
		Agent: &responseAgent,
		Token: token,
	})
}

// CreateDelegation handles delegation creation
func (h *AgentHandler) CreateDelegation(w http.ResponseWriter, r *http.Request) {
	var req CreateDelegationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body", err.Error())
		return
	}

	// Validate request
	if req.FromAgentID == "" || req.ToAgentID == "" {
		h.respondError(w, http.StatusBadRequest, "MISSING_FIELD", "From and To agent IDs are required", "")
		return
	}
	if len(req.Scopes) == 0 {
		h.respondError(w, http.StatusBadRequest, "MISSING_FIELD", "At least one scope is required", "")
		return
	}

	// Verify both agents exist and are active
	fromAgent, err := h.agentStore.Get(req.FromAgentID)
	if err != nil || fromAgent == nil {
		h.respondError(w, http.StatusNotFound, "AGENT_NOT_FOUND", fmt.Sprintf("Agent '%s' not found", req.FromAgentID), "")
		return
	}
	if fromAgent.Status != "active" {
		h.respondError(w, http.StatusBadRequest, "AGENT_INACTIVE", fmt.Sprintf("Agent '%s' is not active", req.FromAgentID), "")
		return
	}

	toAgent, err := h.agentStore.Get(req.ToAgentID)
	if err != nil || toAgent == nil {
		h.respondError(w, http.StatusNotFound, "AGENT_NOT_FOUND", fmt.Sprintf("Agent '%s' not found", req.ToAgentID), "")
		return
	}
	if toAgent.Status != "active" {
		h.respondError(w, http.StatusBadRequest, "AGENT_INACTIVE", fmt.Sprintf("Agent '%s' is not active", req.ToAgentID), "")
		return
	}

	// Validate max hops
	if req.MaxHops > 5 {
		h.respondError(w, http.StatusBadRequest, "INVALID_MAX_HOPS", "Max hops cannot exceed 5", "")
		return
	}

	// Create delegation
	del := &types.Delegation{
		ID:          fmt.Sprintf("del-%d", time.Now().UnixNano()),
		FromAgentID: req.FromAgentID,
		ToAgentID:   req.ToAgentID,
		Scopes:      req.Scopes,
		MaxHops:     req.MaxHops,
		CreatedAt:   time.Now(),
		ExpiresAt:   req.ExpiresAt,
		Active:      true,
	}

	if err := h.delegationStore.Add(del); err != nil {
		h.respondError(w, http.StatusInternalServerError, "STORE_ERROR", "Failed to store delegation", err.Error())
		return
	}

	h.respondJSON(w, http.StatusCreated, CreateDelegationResponse{
		Delegation: del,
	})
}

// CheckAuthorization handles authorization checks with delegation
func (h *AgentHandler) CheckAuthorization(w http.ResponseWriter, r *http.Request) {
	startTime := time.Now()

	var req AgentCheckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body", err.Error())
		return
	}

	// Validate request
	if req.AgentID == "" {
		h.respondError(w, http.StatusBadRequest, "MISSING_FIELD", "Agent ID is required", "")
		return
	}
	if req.Action == "" {
		h.respondError(w, http.StatusBadRequest, "MISSING_FIELD", "Action is required", "")
		return
	}
	if req.Resource == nil {
		h.respondError(w, http.StatusBadRequest, "MISSING_FIELD", "Resource is required", "")
		return
	}

	// Verify agent exists
	agent, err := h.agentStore.Get(req.AgentID)
	if err != nil || agent == nil {
		h.respondError(w, http.StatusNotFound, "AGENT_NOT_FOUND", fmt.Sprintf("Agent '%s' not found", req.AgentID), "")
		return
	}

	// If delegation chain provided, validate it
	effect := "deny"
	validatedChain := []string{}

	if len(req.DelegationChain) > 0 {
		// Validate delegation chain
		valid, err := h.validateDelegationChain(req.DelegationChain, req.Action)
		if err != nil || !valid {
			// Return 403 Forbidden with deny effect for invalid delegation chains
			// This treats delegation validation failures as authorization denials
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)

			response := apiResponse{
				Success: true, // Still a successful API call, just denied authorization
				Data: AgentCheckResponse{
					Effect:         "deny",
					ValidatedChain: []string{},
				},
			}

			if err := json.NewEncoder(w).Encode(response); err != nil {
				h.logger.Error("Failed to encode response", zap.Error(err))
			}
			return
		}

		// Delegation chain is valid
		validatedChain = req.DelegationChain

		// Check authorization for the original principal in the chain
		principal := &types.Principal{
			ID:    req.DelegationChain[0],
			Roles: []string{req.DelegationChain[0]}, // Add principal ID as role for policy matching
		}

		checkReq := &types.CheckRequest{
			Principal: principal,
			Resource:  req.Resource,
			Actions:   []string{req.Action},
		}

		resp, err := h.engine.Check(r.Context(), checkReq)
		if err == nil && resp != nil {
			if result, ok := resp.Results[req.Action]; ok && result.Effect == "allow" {
				effect = "allow"
			}
		}
	} else {
		// Direct authorization check without delegation
		principal := &types.Principal{
			ID:    req.AgentID,
			Roles: []string{req.AgentID}, // Add principal ID as role for policy matching
		}

		checkReq := &types.CheckRequest{
			Principal: principal,
			Resource:  req.Resource,
			Actions:   []string{req.Action},
		}

		resp, err := h.engine.Check(r.Context(), checkReq)
		if err == nil && resp != nil {
			if result, ok := resp.Results[req.Action]; ok && result.Effect == "allow" {
				effect = "allow"
			}
		}
	}

	// Log to audit
	latency := time.Since(startTime).Milliseconds()
	h.auditLog = append(h.auditLog, AuditLogEntry{
		Timestamp:  time.Now(),
		AgentID:    req.AgentID,
		Action:     req.Action,
		Resource:   fmt.Sprintf("%s:%s", req.Resource.Kind, req.Resource.ID),
		Effect:     effect,
		LatencyMS:  latency,
	})

	h.respondJSON(w, http.StatusOK, AgentCheckResponse{
		Effect:         effect,
		ValidatedChain: validatedChain,
	})
}

// GetAgent retrieves agent details
func (h *AgentHandler) GetAgent(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	agentID := vars["id"]

	if agentID == "" {
		h.respondError(w, http.StatusBadRequest, "MISSING_FIELD", "Agent ID is required", "")
		return
	}

	agent, err := h.agentStore.Get(agentID)
	if err != nil || agent == nil {
		h.respondError(w, http.StatusNotFound, "AGENT_NOT_FOUND", fmt.Sprintf("Agent '%s' not found", agentID), "")
		return
	}

	// Redact credentials
	responseAgent := *agent
	redactedCreds := make([]types.Credential, len(responseAgent.Credentials))
	for i, cred := range responseAgent.Credentials {
		redactedCred := cred
		redactedCred.Value = "***REDACTED***"
		redactedCreds[i] = redactedCred
	}
	responseAgent.Credentials = redactedCreds

	h.respondJSON(w, http.StatusOK, GetAgentResponse{
		Agent: &responseAgent,
	})
}

// RevokeAgent revokes an agent
func (h *AgentHandler) RevokeAgent(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	agentID := vars["id"]

	if agentID == "" {
		h.respondError(w, http.StatusBadRequest, "MISSING_FIELD", "Agent ID is required", "")
		return
	}

	agent, err := h.agentStore.Get(agentID)
	if err != nil || agent == nil {
		h.respondError(w, http.StatusNotFound, "AGENT_NOT_FOUND", fmt.Sprintf("Agent '%s' not found", agentID), "")
		return
	}

	// Update agent status
	agent.Status = "revoked"
	if err := h.agentStore.Update(agent); err != nil {
		h.respondError(w, http.StatusInternalServerError, "UPDATE_ERROR", "Failed to revoke agent", err.Error())
		return
	}

	h.respondJSON(w, http.StatusOK, RevokeAgentResponse{
		Message: fmt.Sprintf("Agent '%s' revoked successfully", agentID),
	})
}

// Helper methods

// generateJWT generates a JWT token for an agent
func (h *AgentHandler) generateJWT(agentID string) (string, error) {
	claims := jwt.MapClaims{
		"agent_id": agentID,
		"exp":      time.Now().Add(24 * time.Hour).Unix(),
		"iat":      time.Now().Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(h.jwtSecret)
}

// validateDelegationChain validates a delegation chain
func (h *AgentHandler) validateDelegationChain(chain []string, action string) (bool, error) {
	if len(chain) < 2 {
		return false, fmt.Errorf("delegation chain must have at least 2 agents")
	}

	// Validate each hop in the chain
	for i := 0; i < len(chain)-1; i++ {
		fromAgentID := chain[i]
		toAgentID := chain[i+1]

		// Find delegation
		delegations, err := h.delegationStore.GetByFromAgent(fromAgentID)
		if err != nil {
			return false, fmt.Errorf("failed to get delegations for %s: %w", fromAgentID, err)
		}

		found := false
		for _, del := range delegations {
			if del.ToAgentID == toAgentID && del.Active && time.Now().Before(del.ExpiresAt) {
				// Check if action matches any scope
				for _, scope := range del.Scopes {
					if h.matchesScope(action, scope) {
						found = true
						break
					}
				}
				if found {
					break
				}
			}
		}

		if !found {
			return false, fmt.Errorf("no valid delegation from %s to %s for action %s", fromAgentID, toAgentID, action)
		}
	}

	return true, nil
}

// matchesScope checks if an action matches a scope pattern
func (h *AgentHandler) matchesScope(action, scope string) bool {
	if scope == "*" {
		return true
	}
	if scope == action {
		return true
	}
	// Handle wildcard patterns like "read:*" or "deploy:*"
	if len(scope) > 0 && scope[len(scope)-1] == '*' {
		prefix := scope[:len(scope)-1]
		// Match if action equals the base (e.g., "deploy" matches "deploy:*")
		// OR if action starts with the prefix (e.g., "deploy:service" matches "deploy:*")
		if action+":"  == prefix {
			return true  // "deploy" matches "deploy:*"
		}
		return len(action) >= len(prefix) && action[:len(prefix)] == prefix
	}
	return false
}

// GetAuditLog returns the audit log (for testing)
func (h *AgentHandler) GetAuditLog() []AuditLogEntry {
	return h.auditLog
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

func (h *AgentHandler) respondJSON(w http.ResponseWriter, statusCode int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)

	response := apiResponse{
		Success: statusCode >= 200 && statusCode < 300,
		Data:    data,
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		h.logger.Error("Failed to encode response", zap.Error(err))
	}
}

func (h *AgentHandler) respondError(w http.ResponseWriter, statusCode int, code, message, details string) {
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
		h.logger.Error("Failed to encode error response", zap.Error(err))
	}
}
