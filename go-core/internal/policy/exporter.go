// Package policy provides policy export functionality
package policy

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/authz-engine/go-core/pkg/types"
	"gopkg.in/yaml.v3"
)

// ExportFormat represents the export format type
type ExportFormat string

const (
	FormatJSON   ExportFormat = "json"
	FormatYAML   ExportFormat = "yaml"
	FormatBundle ExportFormat = "bundle"
)

// ExportRequest represents an export request
type ExportRequest struct {
	Format  ExportFormat   `json:"format"`
	Filters *ExportFilters `json:"filters,omitempty"`
	Options *ExportOptions `json:"options,omitempty"`
}

// ExportFilters defines filtering criteria for export
type ExportFilters struct {
	Kind    string   `json:"kind,omitempty"`    // resource, principal, derived_role
	IDs     []string `json:"ids,omitempty"`     // specific policy IDs
	Version string   `json:"version,omitempty"` // API version
}

// ExportOptions defines export options
type ExportOptions struct {
	IncludeMetadata bool `json:"includeMetadata"`
	Pretty          bool `json:"pretty"`
}

// ExportMetadata contains metadata about the export
type ExportMetadata struct {
	Timestamp       time.Time `json:"timestamp" yaml:"timestamp"`
	Version         string    `json:"version" yaml:"version"`
	PolicyCount     int       `json:"policyCount" yaml:"policyCount"`
	DerivedRoleCount int      `json:"derivedRoleCount" yaml:"derivedRoleCount"`
}

// ExportResult represents the result of an export operation
type ExportResult struct {
	Policies     []*types.Policy      `json:"policies,omitempty" yaml:"policies,omitempty"`
	DerivedRoles []*types.DerivedRole `json:"derivedRoles,omitempty" yaml:"derivedRoles,omitempty"`
	Metadata     *ExportMetadata      `json:"metadata,omitempty" yaml:"metadata,omitempty"`
}

// Exporter handles policy export operations
type Exporter struct {
	store Store
}

// NewExporter creates a new policy exporter
func NewExporter(store Store) *Exporter {
	return &Exporter{
		store: store,
	}
}

// Export exports policies based on the request
func (e *Exporter) Export(req *ExportRequest) (*ExportResult, error) {
	if req == nil {
		return nil, fmt.Errorf("export request is required")
	}

	// Default options
	if req.Options == nil {
		req.Options = &ExportOptions{
			IncludeMetadata: true,
			Pretty:          true,
		}
	}

	// Get filtered policies
	policies, err := e.getFilteredPolicies(req.Filters)
	if err != nil {
		return nil, fmt.Errorf("failed to get filtered policies: %w", err)
	}

	// Get filtered derived roles
	derivedRoles, err := e.getFilteredDerivedRoles(req.Filters)
	if err != nil {
		return nil, fmt.Errorf("failed to get filtered derived roles: %w", err)
	}

	result := &ExportResult{
		Policies:     policies,
		DerivedRoles: derivedRoles,
	}

	// Add metadata if requested
	if req.Options.IncludeMetadata {
		result.Metadata = &ExportMetadata{
			Timestamp:        time.Now(),
			Version:          "v1",
			PolicyCount:      len(policies),
			DerivedRoleCount: len(derivedRoles),
		}
	}

	return result, nil
}

// ExportToJSON exports policies to JSON format
func (e *Exporter) ExportToJSON(req *ExportRequest, w io.Writer) error {
	result, err := e.Export(req)
	if err != nil {
		return err
	}

	encoder := json.NewEncoder(w)
	if req.Options != nil && req.Options.Pretty {
		encoder.SetIndent("", "  ")
	}

	return encoder.Encode(result)
}

// ExportToYAML exports policies to YAML format
func (e *Exporter) ExportToYAML(req *ExportRequest, w io.Writer) error {
	result, err := e.Export(req)
	if err != nil {
		return err
	}

	encoder := yaml.NewEncoder(w)
	encoder.SetIndent(2)
	defer encoder.Close()

	return encoder.Encode(result)
}

// ExportToBundle exports policies to a tar.gz bundle
func (e *Exporter) ExportToBundle(req *ExportRequest, w io.Writer) error {
	result, err := e.Export(req)
	if err != nil {
		return err
	}

	// Create gzip writer
	gzipWriter := gzip.NewWriter(w)
	defer gzipWriter.Close()

	// Create tar writer
	tarWriter := tar.NewWriter(gzipWriter)
	defer tarWriter.Close()

	// Add metadata file
	if result.Metadata != nil {
		metadataBytes, err := json.MarshalIndent(result.Metadata, "", "  ")
		if err != nil {
			return fmt.Errorf("failed to marshal metadata: %w", err)
		}

		if err := e.addFileToTar(tarWriter, "metadata.json", metadataBytes); err != nil {
			return err
		}
	}

	// Add policies
	for _, policy := range result.Policies {
		policyBytes, err := yaml.Marshal(policy)
		if err != nil {
			return fmt.Errorf("failed to marshal policy %s: %w", policy.Name, err)
		}

		filename := fmt.Sprintf("policies/%s.yaml", policy.Name)
		if err := e.addFileToTar(tarWriter, filename, policyBytes); err != nil {
			return err
		}
	}

	// Add derived roles
	for _, dr := range result.DerivedRoles {
		drBytes, err := yaml.Marshal(dr)
		if err != nil {
			return fmt.Errorf("failed to marshal derived role %s: %w", dr.Name, err)
		}

		filename := fmt.Sprintf("derived_roles/%s.yaml", dr.Name)
		if err := e.addFileToTar(tarWriter, filename, drBytes); err != nil {
			return err
		}
	}

	return nil
}

// addFileToTar adds a file to the tar archive
func (e *Exporter) addFileToTar(tw *tar.Writer, name string, data []byte) error {
	header := &tar.Header{
		Name:    name,
		Mode:    0644,
		Size:    int64(len(data)),
		ModTime: time.Now(),
	}

	if err := tw.WriteHeader(header); err != nil {
		return fmt.Errorf("failed to write tar header: %w", err)
	}

	if _, err := tw.Write(data); err != nil {
		return fmt.Errorf("failed to write tar data: %w", err)
	}

	return nil
}

// getFilteredPolicies retrieves policies based on filters
func (e *Exporter) getFilteredPolicies(filters *ExportFilters) ([]*types.Policy, error) {
	allPolicies := e.store.GetAll()

	// No filters, return all
	if filters == nil {
		return allPolicies, nil
	}

	var filtered []*types.Policy

	for _, policy := range allPolicies {
		// Filter by specific IDs
		if len(filters.IDs) > 0 {
			found := false
			for _, id := range filters.IDs {
				if policy.Name == id {
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}

		// Filter by kind
		if filters.Kind != "" {
			switch filters.Kind {
			case "resource":
				if policy.PrincipalPolicy {
					continue
				}
			case "principal":
				if !policy.PrincipalPolicy {
					continue
				}
			case "derived_role":
				// Derived roles are handled separately
				continue
			}
		}

		// Filter by version
		if filters.Version != "" && policy.APIVersion != filters.Version {
			continue
		}

		filtered = append(filtered, policy)
	}

	return filtered, nil
}

// getFilteredDerivedRoles retrieves derived roles based on filters
func (e *Exporter) getFilteredDerivedRoles(filters *ExportFilters) ([]*types.DerivedRole, error) {
	// If not filtering for derived roles, return empty
	if filters != nil && filters.Kind != "" && filters.Kind != "derived_role" {
		return nil, nil
	}

	allDerivedRoles := e.store.GetDerivedRoles()

	// No specific ID filters, return all
	if filters == nil || len(filters.IDs) == 0 {
		return allDerivedRoles, nil
	}

	// Filter by specific IDs
	var filtered []*types.DerivedRole
	for _, dr := range allDerivedRoles {
		for _, id := range filters.IDs {
			if dr.Name == id {
				filtered = append(filtered, dr)
				break
			}
		}
	}

	return filtered, nil
}
