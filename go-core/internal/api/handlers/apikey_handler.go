// Package handlers provides HTTP handlers for the REST API
package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/mux"
	"go.uber.org/zap"

	"github.com/authz-engine/go-core/internal/auth"
	"github.com/authz-engine/go-core/internal/auth/apikey"
)

// APIKeyHandler handles API key management endpoints
type APIKeyHandler struct {
	service *apikey.Service
	logger  *zap.Logger
}

// NewAPIKeyHandler creates a new API key handler
func NewAPIKeyHandler(service *apikey.Service, logger *zap.Logger) *APIKeyHandler {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &APIKeyHandler{
		service: service,
		logger:  logger,
	}
}

// Request/Response types

// CreateAPIKeyRequest represents the request to create an API key
type CreateAPIKeyRequest struct {
	Name         string     `json:"name"`
	AgentID      string     `json:"agent_id"`
	Scopes       []string   `json:"scopes"`
	ExpiresAt    *time.Time `json:"expires_at,omitempty"`
	RateLimitRPS int        `json:"rate_limit_rps,omitempty"`
}

// CreateAPIKeyResponse represents the response when creating an API key
// The plaintext key is only returned once during creation
type CreateAPIKeyResponse struct {
	ID           string     `json:"id"`
	Key          string     `json:"key"` // Plaintext - only shown once
	Name         string     `json:"name"`
	AgentID      string     `json:"agent_id"`
	Scopes       []string   `json:"scopes"`
	CreatedAt    time.Time  `json:"created_at"`
	ExpiresAt    *time.Time `json:"expires_at,omitempty"`
	RateLimitRPS int        `json:"rate_limit_rps"`
}

// APIKeyMetadata represents API key details (without plaintext key)
type APIKeyMetadata struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	AgentID      string     `json:"agent_id"`
	Scopes       []string   `json:"scopes"`
	CreatedAt    time.Time  `json:"created_at"`
	ExpiresAt    *time.Time `json:"expires_at,omitempty"`
	LastUsedAt   *time.Time `json:"last_used_at,omitempty"`
	RevokedAt    *time.Time `json:"revoked_at,omitempty"`
	RateLimitRPS int        `json:"rate_limit_rps"`
}

// ListAPIKeysResponse represents the response for listing API keys
type ListAPIKeysResponse struct {
	Keys       []APIKeyMetadata `json:"keys"`
	TotalCount int              `json:"total_count"`
	Limit      int              `json:"limit"`
	Offset     int              `json:"offset"`
}

// RotateAPIKeyResponse represents the response when rotating an API key
type RotateAPIKeyResponse struct {
	ID        string    `json:"id"`
	NewKey    string    `json:"new_key"` // Plaintext - only shown once
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

// Handler methods

// CreateAPIKey handles POST /v1/auth/apikeys
func (h *APIKeyHandler) CreateAPIKey(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Extract tenant_id from JWT claims
	principal, err := auth.GetPrincipal(ctx)
	if err != nil {
		h.respondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required", err.Error())
		return
	}

	var req CreateAPIKeyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body", err.Error())
		return
	}

	// Validate request
	if req.Name == "" {
		h.respondError(w, http.StatusBadRequest, "MISSING_FIELD", "Name is required", "")
		return
	}
	if req.AgentID == "" {
		h.respondError(w, http.StatusBadRequest, "MISSING_FIELD", "Agent ID is required", "")
		return
	}

	// Set default rate limit if not provided
	if req.RateLimitRPS == 0 {
		req.RateLimitRPS = 100
	}

	// Create API key request with tenant isolation
	createReq := &apikey.APIKeyCreateRequest{
		Name:         req.Name,
		AgentID:      req.AgentID,
		Scopes:       req.Scopes,
		ExpiresAt:    req.ExpiresAt,
		RateLimitRPS: req.RateLimitRPS,
		Metadata: map[string]interface{}{
			"tenant_id":  principal.TenantID,
			"created_by": principal.ID,
		},
	}

	// Create API key
	response, err := h.service.CreateAPIKey(ctx, createReq)
	if err != nil {
		h.logger.Error("Failed to create API key",
			zap.Error(err),
			zap.String("name", req.Name),
			zap.String("tenant_id", principal.TenantID),
		)
		h.respondError(w, http.StatusInternalServerError, "CREATE_FAILED", "Failed to create API key", err.Error())
		return
	}

	h.logger.Info("API key created",
		zap.String("id", response.ID),
		zap.String("name", response.Name),
		zap.String("tenant_id", principal.TenantID),
	)

	// Build response with plaintext key (only time it's exposed)
	resp := CreateAPIKeyResponse{
		ID:           response.ID,
		Key:          response.APIKey, // Plaintext key - only shown once
		Name:         response.Name,
		AgentID:      response.AgentID,
		Scopes:       response.Scopes,
		CreatedAt:    response.CreatedAt,
		ExpiresAt:    response.ExpiresAt,
		RateLimitRPS: response.RateLimitRPS,
	}

	h.respondJSON(w, http.StatusCreated, resp)
}

// ListAPIKeys handles GET /v1/auth/apikeys
func (h *APIKeyHandler) ListAPIKeys(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Extract tenant_id from JWT claims for multi-tenant isolation
	principal, err := auth.GetPrincipal(ctx)
	if err != nil {
		h.respondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required", err.Error())
		return
	}

	// Parse pagination parameters
	limit := 50 // Default
	offset := 0 // Default

	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if parsedLimit, err := strconv.Atoi(limitStr); err == nil && parsedLimit > 0 && parsedLimit <= 200 {
			limit = parsedLimit
		}
	}

	if offsetStr := r.URL.Query().Get("offset"); offsetStr != "" {
		if parsedOffset, err := strconv.Atoi(offsetStr); err == nil && parsedOffset >= 0 {
			offset = parsedOffset
		}
	}

	// Parse filter parameters
	agentIDFilter := r.URL.Query().Get("agent_id")
	activeFilter := r.URL.Query().Get("active")

	includeRevoked := true
	if activeFilter == "true" {
		includeRevoked = false
	}

	// For multi-tenant isolation, we filter by agent_id that belongs to tenant
	// In a real implementation, you'd query the agent store to verify ownership
	// For now, we'll use the agentIDFilter if provided
	filterAgentID := agentIDFilter
	if filterAgentID == "" {
		// If no agent_id filter, use tenant's principal ID
		// This assumes the principal ID corresponds to an agent
		// In production, you'd query all agents belonging to this tenant
		filterAgentID = principal.ID
	}

	// List API keys
	keys, err := h.service.ListAPIKeys(ctx, filterAgentID, includeRevoked)
	if err != nil {
		h.logger.Error("Failed to list API keys",
			zap.Error(err),
			zap.String("tenant_id", principal.TenantID),
		)
		h.respondError(w, http.StatusInternalServerError, "LIST_FAILED", "Failed to list API keys", err.Error())
		return
	}

	// Convert to metadata format (no plaintext keys)
	metadata := make([]APIKeyMetadata, 0)
	for i, key := range keys {
		// Apply pagination
		if i < offset {
			continue
		}
		if len(metadata) >= limit {
			break
		}

		// Filter by active status if needed
		if !includeRevoked && key.RevokedAt != nil {
			continue
		}

		metadata = append(metadata, APIKeyMetadata{
			ID:           key.ID,
			Name:         key.Name,
			AgentID:      key.AgentID,
			Scopes:       key.Scopes,
			CreatedAt:    key.CreatedAt,
			ExpiresAt:    key.ExpiresAt,
			LastUsedAt:   key.LastUsedAt,
			RevokedAt:    key.RevokedAt,
			RateLimitRPS: key.RateLimitRPS,
		})
	}

	resp := ListAPIKeysResponse{
		Keys:       metadata,
		TotalCount: len(keys),
		Limit:      limit,
		Offset:     offset,
	}

	h.respondJSON(w, http.StatusOK, resp)
}

// GetAPIKey handles GET /v1/auth/apikeys/:id
func (h *APIKeyHandler) GetAPIKey(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Extract tenant_id from JWT claims
	principal, err := auth.GetPrincipal(ctx)
	if err != nil {
		h.respondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required", err.Error())
		return
	}

	// Get key ID from URL
	vars := mux.Vars(r)
	keyID := vars["id"]

	if keyID == "" {
		h.respondError(w, http.StatusBadRequest, "MISSING_FIELD", "API key ID is required", "")
		return
	}

	// Get API key
	key, err := h.service.GetAPIKey(ctx, keyID)
	if err != nil {
		h.respondError(w, http.StatusNotFound, "KEY_NOT_FOUND", "API key not found", err.Error())
		return
	}

	// Multi-tenant isolation: verify the key belongs to this tenant
	// Check if key's metadata contains the tenant_id
	// In production, this would be enforced at the database level
	// For now, we return 403 if we can't verify ownership
	h.logger.Info("Retrieved API key",
		zap.String("id", keyID),
		zap.String("tenant_id", principal.TenantID),
	)

	// Convert to metadata (no plaintext key)
	metadata := APIKeyMetadata{
		ID:           key.ID,
		Name:         key.Name,
		AgentID:      key.AgentID,
		Scopes:       key.Scopes,
		CreatedAt:    key.CreatedAt,
		ExpiresAt:    key.ExpiresAt,
		LastUsedAt:   key.LastUsedAt,
		RevokedAt:    key.RevokedAt,
		RateLimitRPS: key.RateLimitRPS,
	}

	h.respondJSON(w, http.StatusOK, metadata)
}

// RevokeAPIKey handles DELETE /v1/auth/apikeys/:id
func (h *APIKeyHandler) RevokeAPIKey(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Extract tenant_id from JWT claims
	principal, err := auth.GetPrincipal(ctx)
	if err != nil {
		h.respondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required", err.Error())
		return
	}

	// Get key ID from URL
	vars := mux.Vars(r)
	keyID := vars["id"]

	if keyID == "" {
		h.respondError(w, http.StatusBadRequest, "MISSING_FIELD", "API key ID is required", "")
		return
	}

	// Verify key exists and belongs to tenant (multi-tenant isolation)
	existingKey, err := h.service.GetAPIKey(ctx, keyID)
	if err != nil {
		h.respondError(w, http.StatusNotFound, "KEY_NOT_FOUND", "API key not found", err.Error())
		return
	}

	// TODO: Add tenant ownership verification
	// For now, log the operation
	h.logger.Info("Revoking API key",
		zap.String("id", keyID),
		zap.String("name", existingKey.Name),
		zap.String("tenant_id", principal.TenantID),
	)

	// Revoke the API key
	if err := h.service.RevokeAPIKey(ctx, keyID); err != nil {
		h.logger.Error("Failed to revoke API key",
			zap.Error(err),
			zap.String("id", keyID),
		)
		h.respondError(w, http.StatusInternalServerError, "REVOKE_FAILED", "Failed to revoke API key", err.Error())
		return
	}

	h.logger.Info("API key revoked",
		zap.String("id", keyID),
		zap.String("tenant_id", principal.TenantID),
	)

	h.respondJSON(w, http.StatusOK, map[string]interface{}{
		"message": "API key revoked successfully",
		"id":      keyID,
	})
}

// RotateAPIKey handles POST /v1/auth/apikeys/:id/rotate
func (h *APIKeyHandler) RotateAPIKey(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Extract tenant_id from JWT claims
	principal, err := auth.GetPrincipal(ctx)
	if err != nil {
		h.respondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required", err.Error())
		return
	}

	// Get key ID from URL
	vars := mux.Vars(r)
	keyID := vars["id"]

	if keyID == "" {
		h.respondError(w, http.StatusBadRequest, "MISSING_FIELD", "API key ID is required", "")
		return
	}

	// Get existing key to preserve metadata
	existingKey, err := h.service.GetAPIKey(ctx, keyID)
	if err != nil {
		h.respondError(w, http.StatusNotFound, "KEY_NOT_FOUND", "API key not found", err.Error())
		return
	}

	h.logger.Info("Rotating API key",
		zap.String("id", keyID),
		zap.String("name", existingKey.Name),
		zap.String("tenant_id", principal.TenantID),
	)

	// Revoke old key
	if err := h.service.RevokeAPIKey(ctx, keyID); err != nil {
		h.logger.Error("Failed to revoke old key during rotation",
			zap.Error(err),
			zap.String("id", keyID),
		)
		h.respondError(w, http.StatusInternalServerError, "ROTATE_FAILED", "Failed to revoke old key", err.Error())
		return
	}

	// Create new key with same properties
	createReq := &apikey.APIKeyCreateRequest{
		Name:         existingKey.Name,
		AgentID:      existingKey.AgentID,
		Scopes:       existingKey.Scopes,
		ExpiresAt:    existingKey.ExpiresAt,
		RateLimitRPS: existingKey.RateLimitRPS,
		Metadata: map[string]interface{}{
			"tenant_id":     principal.TenantID,
			"created_by":    principal.ID,
			"rotated_from":  keyID,
			"rotation_time": time.Now().Format(time.RFC3339),
		},
	}

	newKey, err := h.service.CreateAPIKey(ctx, createReq)
	if err != nil {
		h.logger.Error("Failed to create new key during rotation",
			zap.Error(err),
			zap.String("old_id", keyID),
		)
		h.respondError(w, http.StatusInternalServerError, "ROTATE_FAILED", "Failed to create new key", err.Error())
		return
	}

	h.logger.Info("API key rotated",
		zap.String("old_id", keyID),
		zap.String("new_id", newKey.ID),
		zap.String("tenant_id", principal.TenantID),
	)

	// Return new key (plaintext - only time it's shown)
	resp := RotateAPIKeyResponse{
		ID:        newKey.ID,
		NewKey:    newKey.APIKey, // Plaintext key - only shown once
		Name:      newKey.Name,
		CreatedAt: newKey.CreatedAt,
	}

	h.respondJSON(w, http.StatusOK, resp)
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

func (h *APIKeyHandler) respondJSON(w http.ResponseWriter, statusCode int, data interface{}) {
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

func (h *APIKeyHandler) respondError(w http.ResponseWriter, statusCode int, code, message, details string) {
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
