// Package policy provides policy backup and restore functionality
package policy

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// BackupRequest represents a backup request
type BackupRequest struct {
	Destination string         `json:"destination,omitempty"` // File path or S3 URL
	Format      ExportFormat   `json:"format"`
	Options     *ExportOptions `json:"options,omitempty"`
}

// BackupResult represents the result of a backup operation
type BackupResult struct {
	BackupID  string          `json:"backupId"`
	Timestamp time.Time       `json:"timestamp"`
	Location  string          `json:"location"`
	Metadata  *ExportMetadata `json:"metadata"`
	Size      int64           `json:"size"`
}

// RestoreRequest represents a restore request
type RestoreRequest struct {
	BackupID string         `json:"backupId,omitempty"` // Backup ID or file path
	Location string         `json:"location,omitempty"` // File path or S3 URL
	Options  *ImportOptions `json:"options,omitempty"`
}

// RestoreResult represents the result of a restore operation
type RestoreResult struct {
	Restored      int                `json:"restored"`
	Skipped       int                `json:"skipped"`
	Errors        []*ValidationError `json:"errors,omitempty"`
	BackupID      string             `json:"backupId"`
	BackupTime    time.Time          `json:"backupTime"`
	PreviousState *BackupResult      `json:"previousState,omitempty"` // State before restore
}

// BackupManager manages policy backups
type BackupManager struct {
	store     Store
	exporter  *Exporter
	importer  *Importer
	backupDir string
}

// NewBackupManager creates a new backup manager
func NewBackupManager(store Store, backupDir string) (*BackupManager, error) {
	if backupDir == "" {
		backupDir = "./backups"
	}

	// Ensure backup directory exists
	if err := os.MkdirAll(backupDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create backup directory: %w", err)
	}

	importer, err := NewImporter(store)
	if err != nil {
		return nil, fmt.Errorf("failed to create importer: %w", err)
	}

	return &BackupManager{
		store:     store,
		exporter:  NewExporter(store),
		importer:  importer,
		backupDir: backupDir,
	}, nil
}

// Backup creates a backup of all policies
func (bm *BackupManager) Backup(req *BackupRequest) (*BackupResult, error) {
	if req == nil {
		req = &BackupRequest{
			Format: FormatBundle,
			Options: &ExportOptions{
				IncludeMetadata: true,
				Pretty:          true,
			},
		}
	}

	// Generate backup ID
	backupID := fmt.Sprintf("backup_%s", time.Now().Format("20060102_150405"))

	// Determine backup location
	location := req.Destination
	if location == "" {
		ext := string(req.Format)
		if req.Format == FormatBundle {
			ext = "tar.gz"
		}
		location = filepath.Join(bm.backupDir, fmt.Sprintf("%s.%s", backupID, ext))
	}

	// Create backup file
	file, err := os.Create(location)
	if err != nil {
		return nil, fmt.Errorf("failed to create backup file: %w", err)
	}
	defer file.Close()

	// Export based on format
	exportReq := &ExportRequest{
		Format:  req.Format,
		Options: req.Options,
	}

	var exportErr error
	switch req.Format {
	case FormatJSON:
		exportErr = bm.exporter.ExportToJSON(exportReq, file)
	case FormatYAML:
		exportErr = bm.exporter.ExportToYAML(exportReq, file)
	case FormatBundle:
		exportErr = bm.exporter.ExportToBundle(exportReq, file)
	default:
		return nil, fmt.Errorf("unsupported format: %s", req.Format)
	}

	if exportErr != nil {
		os.Remove(location) // Clean up on error
		return nil, fmt.Errorf("failed to export policies: %w", exportErr)
	}

	// Get file info
	info, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("failed to get backup file info: %w", err)
	}

	// Get metadata
	exportResult, err := bm.exporter.Export(exportReq)
	if err != nil {
		return nil, fmt.Errorf("failed to get export metadata: %w", err)
	}

	result := &BackupResult{
		BackupID:  backupID,
		Timestamp: time.Now(),
		Location:  location,
		Metadata:  exportResult.Metadata,
		Size:      info.Size(),
	}

	return result, nil
}

// Restore restores policies from a backup
func (bm *BackupManager) Restore(req *RestoreRequest) (*RestoreResult, error) {
	if req == nil {
		return nil, fmt.Errorf("restore request is required")
	}

	// Determine backup location
	location := req.Location
	if location == "" && req.BackupID != "" {
		// Try to find backup by ID
		location = bm.findBackupLocation(req.BackupID)
		if location == "" {
			return nil, fmt.Errorf("backup not found: %s", req.BackupID)
		}
	}

	if location == "" {
		return nil, fmt.Errorf("backup location or ID is required")
	}

	// Create backup of current state before restore
	previousBackup, err := bm.Backup(&BackupRequest{
		Format: FormatBundle,
		Options: &ExportOptions{
			IncludeMetadata: true,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to backup current state: %w", err)
	}

	// Open backup file
	file, err := os.Open(location)
	if err != nil {
		return nil, fmt.Errorf("failed to open backup file: %w", err)
	}
	defer file.Close()

	// Detect format from extension
	format := bm.detectFormat(location)

	// Import policies
	importReq := &ImportRequest{
		Format:  format,
		Options: req.Options,
	}

	if importReq.Options == nil {
		importReq.Options = &ImportOptions{
			Validate:  true,
			DryRun:    false,
			Overwrite: true, // Default to overwrite on restore
		}
	}

	// Clear existing policies for full restore
	if importReq.Options.Overwrite && !importReq.Options.Merge {
		bm.store.Clear()
		bm.store.ClearDerivedRoles()
	}

	// Import from backup
	importResult, err := bm.importer.Import(importReq, file)
	if err != nil {
		// Try to restore previous state on failure
		bm.restorePreviousState(previousBackup)
		return nil, fmt.Errorf("failed to import backup: %w", err)
	}

	result := &RestoreResult{
		Restored:      importResult.Imported,
		Skipped:       importResult.Skipped,
		Errors:        importResult.Errors,
		BackupID:      req.BackupID,
		BackupTime:    time.Now(),
		PreviousState: previousBackup,
	}

	return result, nil
}

// ListBackups lists all available backups
func (bm *BackupManager) ListBackups() ([]*BackupResult, error) {
	entries, err := os.ReadDir(bm.backupDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read backup directory: %w", err)
	}

	var backups []*BackupResult
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		backupID := entry.Name()
		location := filepath.Join(bm.backupDir, entry.Name())

		backups = append(backups, &BackupResult{
			BackupID:  backupID,
			Timestamp: info.ModTime(),
			Location:  location,
			Size:      info.Size(),
		})
	}

	return backups, nil
}

// DeleteBackup deletes a backup
func (bm *BackupManager) DeleteBackup(backupID string) error {
	location := bm.findBackupLocation(backupID)
	if location == "" {
		return fmt.Errorf("backup not found: %s", backupID)
	}

	return os.Remove(location)
}

// findBackupLocation finds the file location for a backup ID
func (bm *BackupManager) findBackupLocation(backupID string) string {
	// Try different extensions
	extensions := []string{".tar.gz", ".json", ".yaml"}

	for _, ext := range extensions {
		location := filepath.Join(bm.backupDir, backupID+ext)
		if _, err := os.Stat(location); err == nil {
			return location
		}
	}

	return ""
}

// detectFormat detects the export format from file extension
func (bm *BackupManager) detectFormat(location string) ExportFormat {
	ext := filepath.Ext(location)

	switch ext {
	case ".json":
		return FormatJSON
	case ".yaml", ".yml":
		return FormatYAML
	case ".gz":
		return FormatBundle
	default:
		return FormatJSON
	}
}

// restorePreviousState attempts to restore the previous state after a failed restore
func (bm *BackupManager) restorePreviousState(backup *BackupResult) error {
	if backup == nil || backup.Location == "" {
		return fmt.Errorf("no previous state to restore")
	}

	file, err := os.Open(backup.Location)
	if err != nil {
		return err
	}
	defer file.Close()

	// Clear current state
	bm.store.Clear()
	bm.store.ClearDerivedRoles()

	// Restore from backup
	importReq := &ImportRequest{
		Format: FormatBundle,
		Options: &ImportOptions{
			Validate:  false, // Skip validation for emergency restore
			Overwrite: true,
		},
	}

	_, err = bm.importer.Import(importReq, file)
	return err
}
