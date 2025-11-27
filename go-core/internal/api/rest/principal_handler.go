// Package rest provides principal management endpoint handlers
package rest

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	"go.uber.org/zap"
)

// Note: Principal management is a placeholder implementation
// In production, this would integrate with an identity provider or user management system

// principalStorage is a simple in-memory storage for principals (for demonstration)
// In production, this would be a persistent store (database, directory service, etc.)
var principalStorage = make(map[string]*PrincipalResponse)

// getPrincipalHandler handles GET /v1/principals/{id}
func (s *Server) getPrincipalHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	principalID := vars["id"]

	if principalID == "" {
		WriteError(w, http.StatusBadRequest, "principal ID is required", nil)
		return
	}

	// Get principal from storage
	principal, exists := principalStorage[principalID]
	if !exists {
		WriteError(w, http.StatusNotFound, "Principal not found", map[string]interface{}{
			"principal_id": principalID,
		})
		return
	}

	WriteJSON(w, http.StatusOK, principal)
}

// createPrincipalHandler handles POST /v1/principals
func (s *Server) createPrincipalHandler(w http.ResponseWriter, r *http.Request) {
	var req PrincipalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.logger.Error("Failed to decode principal request",
			zap.Error(err),
		)
		WriteError(w, http.StatusBadRequest, "Invalid request body", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	// Validate request
	if req.ID == "" {
		WriteError(w, http.StatusBadRequest, "principal ID is required", nil)
		return
	}

	// Check if principal already exists
	if _, exists := principalStorage[req.ID]; exists {
		WriteError(w, http.StatusConflict, "Principal already exists", map[string]interface{}{
			"principal_id": req.ID,
		})
		return
	}

	// Create principal response
	now := time.Now()
	principal := &PrincipalResponse{
		ID:         req.ID,
		Roles:      req.Roles,
		Attributes: req.Attributes,
		Scope:      req.Scope,
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	// Store principal
	principalStorage[req.ID] = principal

	s.logger.Info("Principal created",
		zap.String("principal_id", req.ID),
		zap.Strings("roles", req.Roles),
	)

	WriteJSON(w, http.StatusCreated, principal)
}

// updatePrincipalHandler handles PUT /v1/principals/{id}
func (s *Server) updatePrincipalHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	principalID := vars["id"]

	if principalID == "" {
		WriteError(w, http.StatusBadRequest, "principal ID is required", nil)
		return
	}

	var req PrincipalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.logger.Error("Failed to decode principal request",
			zap.Error(err),
		)
		WriteError(w, http.StatusBadRequest, "Invalid request body", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	// Ensure ID matches
	if req.ID != principalID {
		req.ID = principalID
	}

	// Check if principal exists
	existing, exists := principalStorage[principalID]
	if !exists {
		WriteError(w, http.StatusNotFound, "Principal not found", map[string]interface{}{
			"principal_id": principalID,
		})
		return
	}

	// Update principal
	existing.Roles = req.Roles
	existing.Attributes = req.Attributes
	existing.Scope = req.Scope
	existing.UpdatedAt = time.Now()

	principalStorage[principalID] = existing

	s.logger.Info("Principal updated",
		zap.String("principal_id", principalID),
		zap.Strings("roles", req.Roles),
	)

	WriteJSON(w, http.StatusOK, existing)
}
