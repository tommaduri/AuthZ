// Package rest provides policy export endpoint handlers
package rest

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/authz-engine/go-core/internal/policy"
	"go.uber.org/zap"
)

// exportPoliciesHandler handles POST /v1/policies/export
func (s *Server) exportPoliciesHandler(w http.ResponseWriter, r *http.Request) {
	var req policy.ExportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.logger.Error("Failed to decode export request",
			zap.Error(err),
		)
		WriteError(w, http.StatusBadRequest, "Invalid request body", map[string]interface{}{
			"error": err.Error(),
		})
		return
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

	// Create exporter
	exporter := policy.NewExporter(s.policyStore)

	// Set content type and filename based on format
	var contentType, filename, ext string
	switch req.Format {
	case policy.FormatJSON:
		contentType = "application/json"
		ext = "json"
	case policy.FormatYAML:
		contentType = "application/x-yaml"
		ext = "yaml"
	case policy.FormatBundle:
		contentType = "application/gzip"
		ext = "tar.gz"
	}

	filename = fmt.Sprintf("policies-export.%s", ext)

	// Set response headers
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))

	// Export based on format
	var err error
	switch req.Format {
	case policy.FormatJSON:
		err = exporter.ExportToJSON(&req, w)
	case policy.FormatYAML:
		err = exporter.ExportToYAML(&req, w)
	case policy.FormatBundle:
		err = exporter.ExportToBundle(&req, w)
	}

	if err != nil {
		s.logger.Error("Failed to export policies",
			zap.String("format", string(req.Format)),
			zap.Error(err),
		)
		// Can't use WriteError here as headers are already sent
		// Just log the error
		return
	}

	s.logger.Info("Policies exported successfully",
		zap.String("format", string(req.Format)),
	)
}

// backupPoliciesHandler handles POST /v1/policies/backup
func (s *Server) backupPoliciesHandler(w http.ResponseWriter, r *http.Request) {
	var req policy.BackupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		// Use default backup request
		req = policy.BackupRequest{
			Format: policy.FormatBundle,
			Options: &policy.ExportOptions{
				IncludeMetadata: true,
				Pretty:          true,
			},
		}
	}

	// Create backup manager
	backupMgr, err := policy.NewBackupManager(s.policyStore, "./backups")
	if err != nil {
		s.logger.Error("Failed to create backup manager",
			zap.Error(err),
		)
		WriteError(w, http.StatusInternalServerError, "Failed to create backup manager", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	// Create backup
	result, err := backupMgr.Backup(&req)
	if err != nil {
		s.logger.Error("Failed to create backup",
			zap.Error(err),
		)
		WriteError(w, http.StatusInternalServerError, "Failed to create backup", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	s.logger.Info("Backup created successfully",
		zap.String("backup_id", result.BackupID),
		zap.String("location", result.Location),
		zap.Int64("size", result.Size),
	)

	WriteJSON(w, http.StatusCreated, result)
}

// restorePoliciesHandler handles POST /v1/policies/restore
func (s *Server) restorePoliciesHandler(w http.ResponseWriter, r *http.Request) {
	var req policy.RestoreRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.logger.Error("Failed to decode restore request",
			zap.Error(err),
		)
		WriteError(w, http.StatusBadRequest, "Invalid request body", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	if req.BackupID == "" && req.Location == "" {
		WriteError(w, http.StatusBadRequest, "Either backupId or location is required", nil)
		return
	}

	// Create backup manager
	backupMgr, err := policy.NewBackupManager(s.policyStore, "./backups")
	if err != nil {
		s.logger.Error("Failed to create backup manager",
			zap.Error(err),
		)
		WriteError(w, http.StatusInternalServerError, "Failed to create backup manager", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	// Restore from backup
	result, err := backupMgr.Restore(&req)
	if err != nil {
		s.logger.Error("Failed to restore backup",
			zap.String("backup_id", req.BackupID),
			zap.Error(err),
		)
		WriteError(w, http.StatusInternalServerError, "Failed to restore backup", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	s.logger.Info("Backup restored successfully",
		zap.String("backup_id", req.BackupID),
		zap.Int("restored", result.Restored),
		zap.Int("skipped", result.Skipped),
	)

	WriteJSON(w, http.StatusOK, result)
}

// listBackupsHandler handles GET /v1/policies/backups
func (s *Server) listBackupsHandler(w http.ResponseWriter, r *http.Request) {
	// Create backup manager
	backupMgr, err := policy.NewBackupManager(s.policyStore, "./backups")
	if err != nil {
		s.logger.Error("Failed to create backup manager",
			zap.Error(err),
		)
		WriteError(w, http.StatusInternalServerError, "Failed to create backup manager", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	// List backups
	backups, err := backupMgr.ListBackups()
	if err != nil {
		s.logger.Error("Failed to list backups",
			zap.Error(err),
		)
		WriteError(w, http.StatusInternalServerError, "Failed to list backups", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	response := map[string]interface{}{
		"backups": backups,
		"count":   len(backups),
	}

	WriteJSON(w, http.StatusOK, response)
}
