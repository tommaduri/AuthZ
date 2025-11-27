// Package routes provides route registration for API endpoints
package routes

import (
	"github.com/gorilla/mux"

	"github.com/authz-engine/go-core/internal/api/handlers"
	authmw "github.com/authz-engine/go-core/internal/auth"
)

// RegisterAuthRoutes registers all authentication-related routes
// All routes require JWT authentication via middleware
func RegisterAuthRoutes(
	router *mux.Router,
	apikeyHandler *handlers.APIKeyHandler,
	authMiddleware *authmw.Middleware,
) {
	// API v1 authentication routes
	authAPI := router.PathPrefix("/v1/auth").Subrouter()

	// Apply JWT authentication middleware to all auth routes
	authAPI.Use(authMiddleware.Handler)

	// API Key management endpoints
	// POST /v1/auth/apikeys - Create new API key
	authAPI.HandleFunc("/apikeys", apikeyHandler.CreateAPIKey).Methods("POST")

	// GET /v1/auth/apikeys - List user's API keys (with pagination)
	authAPI.HandleFunc("/apikeys", apikeyHandler.ListAPIKeys).Methods("GET")

	// GET /v1/auth/apikeys/:id - Get specific API key details
	authAPI.HandleFunc("/apikeys/{id}", apikeyHandler.GetAPIKey).Methods("GET")

	// DELETE /v1/auth/apikeys/:id - Revoke API key
	authAPI.HandleFunc("/apikeys/{id}", apikeyHandler.RevokeAPIKey).Methods("DELETE")

	// POST /v1/auth/apikeys/:id/rotate - Rotate API key
	authAPI.HandleFunc("/apikeys/{id}/rotate", apikeyHandler.RotateAPIKey).Methods("POST")
}
