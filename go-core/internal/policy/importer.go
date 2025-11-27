// Package policy provides policy import functionality
package policy

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/authz-engine/go-core/pkg/types"
	"gopkg.in/yaml.v3"
)

// ImportRequest represents an import request
type ImportRequest struct {
	Format  ExportFormat  `json:"format"`
	Data    string        `json:"data,omitempty"`    // Inline data
	Options *ImportOptions `json:"options,omitempty"`
}

// ImportOptions defines import options
type ImportOptions struct {
	Validate  bool `json:"validate"`  // Validate policies before import
	DryRun    bool `json:"dryRun"`    // Don't actually import, just validate
	Overwrite bool `json:"overwrite"` // Replace existing policies
	Merge     bool `json:"merge"`     // Merge with existing
}

// ImportResult represents the result of an import operation
type ImportResult struct {
	Imported int                `json:"imported"`
	Skipped  int                `json:"skipped"`
	Errors   []*ValidationError `json:"errors,omitempty"`
	Warnings []*ValidationError `json:"warnings,omitempty"`
	Summary  *ImportSummary     `json:"summary"`
}

// ImportSummary provides a summary of imported items
type ImportSummary struct {
	ResourcePolicies  int `json:"resourcePolicies"`
	PrincipalPolicies int `json:"principalPolicies"`
	DerivedRoles      int `json:"derivedRoles"`
}

// Importer handles policy import operations
type Importer struct {
	store     Store
	validator *ImportValidator
}

// NewImporter creates a new policy importer
func NewImporter(store Store) (*Importer, error) {
	validator, err := NewImportValidator(store)
	if err != nil {
		return nil, fmt.Errorf("failed to create validator: %w", err)
	}

	return &Importer{
		store:     store,
		validator: validator,
	}, nil
}

// Import imports policies based on the request
func (i *Importer) Import(req *ImportRequest, r io.Reader) (*ImportResult, error) {
	if req == nil {
		return nil, fmt.Errorf("import request is required")
	}

	// Default options
	if req.Options == nil {
		req.Options = &ImportOptions{
			Validate:  true,
			DryRun:    false,
			Overwrite: false,
			Merge:     false,
		}
	}

	result := &ImportResult{
		Errors:   make([]*ValidationError, 0),
		Warnings: make([]*ValidationError, 0),
		Summary:  &ImportSummary{},
	}

	// Parse based on format
	var exportResult *ExportResult
	var err error

	switch req.Format {
	case FormatJSON:
		exportResult, err = i.importFromJSON(r)
	case FormatYAML:
		exportResult, err = i.importFromYAML(r)
	case FormatBundle:
		exportResult, err = i.importFromBundle(r)
	default:
		return nil, fmt.Errorf("unsupported format: %s", req.Format)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to parse import data: %w", err)
	}

	// Validate if requested
	if req.Options.Validate {
		validationResult := i.validator.ValidateBatch(exportResult.Policies, exportResult.DerivedRoles)
		result.Errors = append(result.Errors, validationResult.Errors...)
		result.Warnings = append(result.Warnings, validationResult.Warnings...)

		if !validationResult.Valid {
			return result, fmt.Errorf("validation failed: %s", FormatValidationErrors(validationResult))
		}
	}

	// Dry run - don't actually import
	if req.Options.DryRun {
		result.Imported = len(exportResult.Policies) + len(exportResult.DerivedRoles)
		result.Summary = i.calculateSummary(exportResult)
		return result, nil
	}

	// Import derived roles first (may be referenced by policies)
	for _, dr := range exportResult.DerivedRoles {
		if err := i.importDerivedRole(dr, req.Options, result); err != nil {
			result.Errors = append(result.Errors, &ValidationError{
				PolicyName: dr.Name,
				Field:      "import",
				Message:    err.Error(),
			})
		}
	}

	// Import policies
	for _, policy := range exportResult.Policies {
		if err := i.importPolicy(policy, req.Options, result); err != nil {
			result.Errors = append(result.Errors, &ValidationError{
				PolicyName: policy.Name,
				Field:      "import",
				Message:    err.Error(),
			})
		}
	}

	result.Summary = i.calculateSummary(exportResult)
	return result, nil
}

// importPolicy imports a single policy
func (i *Importer) importPolicy(policy *types.Policy, options *ImportOptions, result *ImportResult) error {
	// Check if policy exists
	existing, err := i.store.Get(policy.Name)

	if err == nil {
		// Policy exists
		if !options.Overwrite && !options.Merge {
			result.Skipped++
			result.Warnings = append(result.Warnings, &ValidationError{
				PolicyName: policy.Name,
				Field:      "import",
				Message:    "policy already exists, skipped (use overwrite or merge option)",
			})
			return nil
		}

		if options.Merge {
			// Merge logic: keep existing rules and add new ones
			policy = i.mergePolicies(existing, policy)
		}

		// Remove existing policy
		if err := i.store.Remove(policy.Name); err != nil {
			return fmt.Errorf("failed to remove existing policy: %w", err)
		}
	}

	// Add policy
	if err := i.store.Add(policy); err != nil {
		return fmt.Errorf("failed to add policy: %w", err)
	}

	result.Imported++
	return nil
}

// importDerivedRole imports a single derived role
func (i *Importer) importDerivedRole(dr *types.DerivedRole, options *ImportOptions, result *ImportResult) error {
	// Check if derived role exists
	_, err := i.store.GetDerivedRole(dr.Name)

	if err == nil {
		// Derived role exists
		if !options.Overwrite {
			result.Skipped++
			result.Warnings = append(result.Warnings, &ValidationError{
				PolicyName: dr.Name,
				Field:      "import",
				Message:    "derived role already exists, skipped (use overwrite option)",
			})
			return nil
		}

		// Remove existing derived role
		if err := i.store.RemoveDerivedRole(dr.Name); err != nil {
			return fmt.Errorf("failed to remove existing derived role: %w", err)
		}
	}

	// Add derived role
	if err := i.store.AddDerivedRole(dr); err != nil {
		return fmt.Errorf("failed to add derived role: %w", err)
	}

	result.Imported++
	return nil
}

// mergePolicies merges two policies
func (i *Importer) mergePolicies(existing, new *types.Policy) *types.Policy {
	merged := *existing

	// Merge rules by name
	ruleMap := make(map[string]*types.Rule)
	for _, rule := range existing.Rules {
		ruleMap[rule.Name] = rule
	}

	for _, rule := range new.Rules {
		if _, exists := ruleMap[rule.Name]; !exists {
			merged.Rules = append(merged.Rules, rule)
		}
	}

	// Update scope if provided
	if new.Scope != "" {
		merged.Scope = new.Scope
	}

	return &merged
}

// importFromJSON imports from JSON format
func (i *Importer) importFromJSON(r io.Reader) (*ExportResult, error) {
	var result ExportResult
	decoder := json.NewDecoder(r)
	if err := decoder.Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode JSON: %w", err)
	}
	return &result, nil
}

// importFromYAML imports from YAML format
func (i *Importer) importFromYAML(r io.Reader) (*ExportResult, error) {
	var result ExportResult
	decoder := yaml.NewDecoder(r)
	if err := decoder.Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode YAML: %w", err)
	}
	return &result, nil
}

// importFromBundle imports from a tar.gz bundle
func (i *Importer) importFromBundle(r io.Reader) (*ExportResult, error) {
	result := &ExportResult{
		Policies:     make([]*types.Policy, 0),
		DerivedRoles: make([]*types.DerivedRole, 0),
	}

	// Create gzip reader
	gzipReader, err := gzip.NewReader(r)
	if err != nil {
		return nil, fmt.Errorf("failed to create gzip reader: %w", err)
	}
	defer gzipReader.Close()

	// Create tar reader
	tarReader := tar.NewReader(gzipReader)

	// Read all files from archive
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to read tar entry: %w", err)
		}

		// Skip directories
		if header.Typeflag == tar.TypeDir {
			continue
		}

		// Read file content
		content := make([]byte, header.Size)
		if _, err := io.ReadFull(tarReader, content); err != nil {
			return nil, fmt.Errorf("failed to read file %s: %w", header.Name, err)
		}

		// Parse based on path
		if strings.HasPrefix(header.Name, "policies/") {
			var policy types.Policy
			if err := yaml.Unmarshal(content, &policy); err != nil {
				return nil, fmt.Errorf("failed to parse policy %s: %w", header.Name, err)
			}
			result.Policies = append(result.Policies, &policy)
		} else if strings.HasPrefix(header.Name, "derived_roles/") {
			var dr types.DerivedRole
			if err := yaml.Unmarshal(content, &dr); err != nil {
				return nil, fmt.Errorf("failed to parse derived role %s: %w", header.Name, err)
			}
			result.DerivedRoles = append(result.DerivedRoles, &dr)
		} else if header.Name == "metadata.json" {
			var metadata ExportMetadata
			if err := json.Unmarshal(content, &metadata); err != nil {
				return nil, fmt.Errorf("failed to parse metadata: %w", err)
			}
			result.Metadata = &metadata
		}
	}

	return result, nil
}

// calculateSummary calculates import summary
func (i *Importer) calculateSummary(result *ExportResult) *ImportSummary {
	summary := &ImportSummary{}

	for _, policy := range result.Policies {
		if policy.PrincipalPolicy {
			summary.PrincipalPolicies++
		} else {
			summary.ResourcePolicies++
		}
	}

	summary.DerivedRoles = len(result.DerivedRoles)

	return summary
}
