// Package rest provides policy import endpoint handlers
package rest

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/authz-engine/go-core/internal/policy"
	"go.uber.org/zap"
)

// importPoliciesHandler handles POST /v1/policies/import
func (s *Server) importPoliciesHandler(w http.ResponseWriter, r *http.Request) {
	// Parse content type
	contentType := r.Header.Get("Content-Type")

	var req policy.ImportRequest
	var reader io.Reader

	// Check if multipart/form-data
	if contentType == "multipart/form-data" || r.MultipartForm != nil {
		// Get file from form
		file, _, err := r.FormFile("file")
		if err != nil {
			s.logger.Error("Failed to get file from form",
				zap.Error(err),
			)
			WriteError(w, http.StatusBadRequest, "Failed to get file from form", map[string]interface{}{
				"error": err.Error(),
			})
			return
		}
		defer file.Close()

		reader = file

		// Get format from form
		format := r.FormValue("format")
		if format == "" {
			format = "json"
		}
		req.Format = policy.ExportFormat(format)

		// Get options from form
		req.Options = &policy.ImportOptions{
			Validate:  r.FormValue("validate") != "false",
			DryRun:    r.FormValue("dryRun") == "true",
			Overwrite: r.FormValue("overwrite") == "true",
			Merge:     r.FormValue("merge") == "true",
		}
	} else {
		// Parse JSON request body
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.logger.Error("Failed to decode import request",
				zap.Error(err),
			)
			WriteError(w, http.StatusBadRequest, "Invalid request body", map[string]interface{}{
				"error": err.Error(),
			})
			return
		}

		// Use inline data if provided
		if req.Data != "" {
			reader = io.NopCloser(io.Reader(nil))
			// TODO: Handle inline data
		} else {
			WriteError(w, http.StatusBadRequest, "Either file upload or inline data is required", nil)
			return
		}
	}

	// Validate format
	if req.Format == "" {
		req.Format = policy.FormatJSON
	}

	if req.Format != policy.FormatJSON && req.Format != policy.FormatYAML && req.Format != policy.FormatBundle {
		WriteError(w, http.StatusBadRequest, "Invalid format", map[string]interface{}{
			"format": string(req.Format),
			"valid":  []string{"json", "yaml", "bundle"},
		})
		return
	}

	// Create importer
	importer, err := policy.NewImporter(s.policyStore)
	if err != nil {
		s.logger.Error("Failed to create importer",
			zap.Error(err),
		)
		WriteError(w, http.StatusInternalServerError, "Failed to create importer", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	// Import policies
	result, err := importer.Import(&req, reader)
	if err != nil {
		s.logger.Error("Failed to import policies",
			zap.String("format", string(req.Format)),
			zap.Error(err),
		)

		// Return validation errors if available
		statusCode := http.StatusInternalServerError
		if result != nil && len(result.Errors) > 0 {
			statusCode = http.StatusBadRequest
		}

		WriteError(w, statusCode, "Failed to import policies", map[string]interface{}{
			"error":  err.Error(),
			"result": result,
		})
		return
	}

	s.logger.Info("Policies imported successfully",
		zap.String("format", string(req.Format)),
		zap.Int("imported", result.Imported),
		zap.Int("skipped", result.Skipped),
		zap.Bool("dry_run", req.Options != nil && req.Options.DryRun),
	)

	statusCode := http.StatusOK
	if req.Options != nil && req.Options.DryRun {
		statusCode = http.StatusOK // Dry run success
	}

	WriteJSON(w, statusCode, result)
}

// validatePoliciesHandler handles POST /v1/policies/validate
func (s *Server) validatePoliciesHandler(w http.ResponseWriter, r *http.Request) {
	var req policy.ImportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.logger.Error("Failed to decode validation request",
			zap.Error(err),
		)
		WriteError(w, http.StatusBadRequest, "Invalid request body", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	// Force validation and dry-run
	if req.Options == nil {
		req.Options = &policy.ImportOptions{}
	}
	req.Options.Validate = true
	req.Options.DryRun = true

	// Create importer
	importer, err := policy.NewImporter(s.policyStore)
	if err != nil {
		s.logger.Error("Failed to create importer",
			zap.Error(err),
		)
		WriteError(w, http.StatusInternalServerError, "Failed to create importer", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	// Validate policies (dry-run import)
	result, err := importer.Import(&req, r.Body)

	// Even if there's an error, return the validation result
	statusCode := http.StatusOK
	if err != nil || (result != nil && len(result.Errors) > 0) {
		statusCode = http.StatusBadRequest
	}

	response := map[string]interface{}{
		"valid":    err == nil && (result == nil || len(result.Errors) == 0),
		"result":   result,
	}

	if err != nil {
		response["error"] = err.Error()
	}

	WriteJSON(w, statusCode, response)
}
