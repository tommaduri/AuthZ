package rest

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/authz-engine/go-core/internal/auth"
)

// APIKeyHandler handles API key management endpoints
type APIKeyHandler struct {
	store     auth.APIKeyStore
	validator *auth.APIKeyValidator
}

// NewAPIKeyHandler creates a new API key handler
func NewAPIKeyHandler(store auth.APIKeyStore) *APIKeyHandler {
	return &APIKeyHandler{
		store:     store,
		validator: auth.NewAPIKeyValidator(store),
	}
}

// RegisterRoutes registers the API key routes
func (h *APIKeyHandler) RegisterRoutes(r *mux.Router) {
	r.HandleFunc("/v1/auth/keys", h.CreateAPIKey).Methods(http.MethodPost)
	r.HandleFunc("/v1/auth/keys", h.ListAPIKeys).Methods(http.MethodGet)
	r.HandleFunc("/v1/auth/keys/{key_id}", h.GetAPIKey).Methods(http.MethodGet)
	r.HandleFunc("/v1/auth/keys/{key_id}", h.RevokeAPIKey).Methods(http.MethodDelete)
	r.HandleFunc("/v1/auth/keys/{key_id}/revoke", h.RevokeAPIKey).Methods(http.MethodPost)
}

// CreateAPIKey creates a new API key
// POST /v1/auth/keys
func (h *APIKeyHandler) CreateAPIKey(w http.ResponseWriter, r *http.Request) {
	var req auth.APIKeyCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body", err)
		return
	}

	// Validate required fields
	if req.AgentID == "" || req.TenantID == "" {
		respondError(w, http.StatusBadRequest, "agent_id and tenant_id are required", nil)
		return
	}

	// Set defaults
	if req.RateLimitPerSec == 0 {
		req.RateLimitPerSec = 100 // Default 100 req/sec
	}

	// Generate API key
	apiKey, err := auth.GenerateAPIKey()
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to generate API key", err)
		return
	}

	// Create key metadata
	key := &auth.APIKey{
		KeyID:           uuid.New(),
		KeyHash:         auth.HashAPIKey(apiKey),
		KeyPrefix:       auth.ExtractKeyPrefix(apiKey),
		AgentID:         req.AgentID,
		TenantID:        req.TenantID,
		Name:            req.Name,
		Scopes:          req.Scopes,
		RateLimitPerSec: req.RateLimitPerSec,
		CreatedAt:       time.Now(),
		ExpiresAt:       req.ExpiresAt,
	}

	// Store in database
	if err := h.store.CreateAPIKey(r.Context(), key); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to create API key", err)
		return
	}

	// Return response with the actual key (only time it's ever shown)
	response := auth.APIKeyResponse{
		Key:    apiKey,
		APIKey: *key,
	}

	respondJSON(w, http.StatusCreated, response)
}

// ListAPIKeys lists all API keys for an agent
// GET /v1/auth/keys?agent_id=xxx&tenant_id=xxx&include_revoked=false
func (h *APIKeyHandler) ListAPIKeys(w http.ResponseWriter, r *http.Request) {
	agentID := r.URL.Query().Get("agent_id")
	tenantID := r.URL.Query().Get("tenant_id")
	includeRevoked := r.URL.Query().Get("include_revoked") == "true"

	if agentID == "" || tenantID == "" {
		respondError(w, http.StatusBadRequest, "agent_id and tenant_id are required", nil)
		return
	}

	keys, err := h.store.ListAPIKeysByAgent(r.Context(), agentID, tenantID, includeRevoked)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to list API keys", err)
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"keys": keys,
		"count": len(keys),
	})
}

// GetAPIKey retrieves a specific API key by ID
// GET /v1/auth/keys/{key_id}
func (h *APIKeyHandler) GetAPIKey(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	keyIDStr := vars["key_id"]

	keyID, err := uuid.Parse(keyIDStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "Invalid key_id format", err)
		return
	}

	key, err := h.store.GetAPIKeyByID(r.Context(), keyID)
	if err != nil {
		if err == auth.ErrAPIKeyNotFound {
			respondError(w, http.StatusNotFound, "API key not found", err)
			return
		}
		respondError(w, http.StatusInternalServerError, "Failed to get API key", err)
		return
	}

	respondJSON(w, http.StatusOK, key)
}

// RevokeAPIKey revokes an API key
// DELETE /v1/auth/keys/{key_id}
// POST /v1/auth/keys/{key_id}/revoke
func (h *APIKeyHandler) RevokeAPIKey(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	keyIDStr := vars["key_id"]

	keyID, err := uuid.Parse(keyIDStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "Invalid key_id format", err)
		return
	}

	if err := h.store.RevokeAPIKey(r.Context(), keyID); err != nil {
		if err == auth.ErrAPIKeyNotFound {
			respondError(w, http.StatusNotFound, "API key not found", err)
			return
		}
		respondError(w, http.StatusInternalServerError, "Failed to revoke API key", err)
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{
		"message": "API key revoked successfully",
		"key_id":  keyID.String(),
	})
}

// Helper functions for JSON responses
func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, status int, message string, err error) {
	response := map[string]interface{}{
		"error":   message,
		"status":  status,
	}

	if err != nil {
		response["details"] = err.Error()
	}

	respondJSON(w, status, response)
}
