package rest

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/authz-engine/go-core/internal/auth"
)

// KeysHandler handles key rotation endpoints
type KeysHandler struct {
	rotationMgr *auth.KeyRotationManager
	jwksMgr     *auth.JWKSManager
}

// NewKeysHandler creates a new keys handler
func NewKeysHandler(rotationMgr *auth.KeyRotationManager, jwksMgr *auth.JWKSManager) *KeysHandler {
	return &KeysHandler{
		rotationMgr: rotationMgr,
		jwksMgr:     jwksMgr,
	}
}

// RotateKeysRequest represents a key rotation request
type RotateKeysRequest struct {
	// Optional: can add parameters like immediate expiration, custom grace period, etc.
}

// RotateKeysResponse represents a key rotation response
type RotateKeysResponse struct {
	Success      bool      `json:"success"`
	NewKeyID     string    `json:"new_key_id"`
	ActivatedAt  time.Time `json:"activated_at"`
	Message      string    `json:"message"`
	ActiveKeys   int       `json:"active_keys_count"`
}

// Note: Using ErrorResponse from types.go

// HandleRotateKeys handles POST /v1/auth/keys/rotate
func (h *KeysHandler) HandleRotateKeys(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.sendError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()

	// Perform key rotation
	newKey, err := h.rotationMgr.RotateKeys(ctx)
	if err != nil {
		h.sendError(w, "Failed to rotate keys: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Get count of active keys
	activeKeys, err := h.rotationMgr.GetAllActiveKeys(ctx)
	if err != nil {
		// Log error but continue - we successfully rotated
		activeKeys = []*auth.SigningKey{newKey}
	}

	response := RotateKeysResponse{
		Success:     true,
		NewKeyID:    newKey.KID,
		ActivatedAt: *newKey.ActivatedAt,
		Message:     "Key rotation successful. Old keys will remain valid for 30 days.",
		ActiveKeys:  len(activeKeys),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

// HandleGetJWKS handles GET /v1/auth/.well-known/jwks.json
func (h *KeysHandler) HandleGetJWKS(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.sendError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()

	// Get JWKS with all active keys
	jwksJSON, err := h.jwksMgr.GetJWKSJSON(ctx)
	if err != nil {
		h.sendError(w, "Failed to get JWKS: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600") // Cache for 1 hour
	w.WriteHeader(http.StatusOK)
	w.Write(jwksJSON)
}

// HandleListKeys handles GET /v1/auth/keys
func (h *KeysHandler) HandleListKeys(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.sendError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()

	keys, err := h.rotationMgr.GetAllActiveKeys(ctx)
	if err != nil {
		h.sendError(w, "Failed to list keys: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Convert to response format (without private keys)
	type KeyInfo struct {
		KID         string     `json:"kid"`
		Algorithm   string     `json:"algorithm"`
		Status      string     `json:"status"`
		CreatedAt   time.Time  `json:"created_at"`
		ActivatedAt *time.Time `json:"activated_at,omitempty"`
		ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	}

	response := struct {
		Keys []KeyInfo `json:"keys"`
	}{
		Keys: make([]KeyInfo, 0, len(keys)),
	}

	for _, key := range keys {
		response.Keys = append(response.Keys, KeyInfo{
			KID:         key.KID,
			Algorithm:   key.Algorithm,
			Status:      key.Status,
			CreatedAt:   key.CreatedAt,
			ActivatedAt: key.ActivatedAt,
			ExpiresAt:   key.ExpiresAt,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

// HandleExpireKeys handles POST /v1/auth/keys/expire
func (h *KeysHandler) HandleExpireKeys(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.sendError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()

	count, err := h.rotationMgr.ExpireOldKeys(ctx)
	if err != nil {
		h.sendError(w, "Failed to expire keys: "+err.Error(), http.StatusInternalServerError)
		return
	}

	response := struct {
		Success      bool   `json:"success"`
		ExpiredCount int    `json:"expired_count"`
		Message      string `json:"message"`
	}{
		Success:      true,
		ExpiredCount: count,
		Message:      "Successfully expired old keys",
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

// sendError sends an error response
func (h *KeysHandler) sendError(w http.ResponseWriter, message string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(ErrorResponse{
		Error:   http.StatusText(code),
		Message: message,
		Code:    http.StatusText(code), // Convert int status code to string text
	})
}

// RegisterRoutes registers all key management routes
func (h *KeysHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/v1/auth/keys/rotate", h.HandleRotateKeys)
	mux.HandleFunc("/v1/auth/keys/expire", h.HandleExpireKeys)
	mux.HandleFunc("/v1/auth/keys", h.HandleListKeys)
	mux.HandleFunc("/v1/auth/.well-known/jwks.json", h.HandleGetJWKS)
}
