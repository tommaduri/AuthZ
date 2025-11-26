package policy

import (
	"context"
	"fmt"
	"time"

	"github.com/authz-engine/go-core/pkg/types"
)

// RollbackManager handles automatic rollback on policy update failures
type RollbackManager struct {
	store        Store
	versionStore *VersionStore
	validator    *Validator
	metrics      *Metrics
}

// NewRollbackManager creates a new rollback manager
func NewRollbackManager(store Store, versionStore *VersionStore, validator *Validator) *RollbackManager {
	return &RollbackManager{
		store:        store,
		versionStore: versionStore,
		validator:    validator,
		metrics:      NewMetrics(),
	}
}

// UpdateWithRollback attempts to update policies with automatic rollback on failure
// Returns the new version on success, or an error with rollback details on failure
func (rm *RollbackManager) UpdateWithRollback(ctx context.Context, newPolicies map[string]*types.Policy, comment string) (*PolicyVersion, error) {
	startTime := time.Now()
	rm.metrics.RecordReloadAttempt()

	// 1. Save current state as a version (pre-update snapshot)
	currentPolicies := make(map[string]*types.Policy)
	for _, p := range rm.store.GetAll() {
		currentPolicies[p.Name] = p
	}

	currentVersion, err := rm.versionStore.SaveVersion(currentPolicies, fmt.Sprintf("Pre-update snapshot: %s", comment))
	if err != nil {
		duration := time.Since(startTime).Seconds()
		rm.metrics.RecordReloadFailure(duration)
		return nil, fmt.Errorf("failed to save current version: %w", err)
	}

	// 2. Validate all new policies before applying
	validationErrors := make([]error, 0)
	for name, policy := range newPolicies {
		rm.metrics.RecordValidationAttempt()
		if err := rm.validator.ValidatePolicy(policy); err != nil {
			rm.metrics.RecordValidationFailure()
			validationErrors = append(validationErrors, fmt.Errorf("policy %s: %w", name, err))
		} else {
			rm.metrics.RecordValidationSuccess()
		}
	}

	if len(validationErrors) > 0 {
		duration := time.Since(startTime).Seconds()
		rm.metrics.RecordReloadFailure(duration)
		// Validation failed - no need to rollback since we haven't applied yet
		return nil, fmt.Errorf("validation failed (%d errors): %v", len(validationErrors), validationErrors)
	}

	// 3. Apply new policies (clear and re-add)
	rm.store.Clear()
	for _, policy := range newPolicies {
		if err := rm.store.Add(policy); err != nil {
			// Add failed - rollback to previous state
			if rollbackErr := rm.rollback(ctx, currentVersion); rollbackErr != nil {
				return nil, fmt.Errorf("update failed: %w, rollback also failed: %v", err, rollbackErr)
			}
			return nil, fmt.Errorf("update failed (rolled back to version %d): %w", currentVersion.Version, err)
		}
	}

	// 4. Save the new version
	newVersion, err := rm.versionStore.SaveVersion(newPolicies, comment)
	if err != nil {
		duration := time.Since(startTime).Seconds()
		rm.metrics.RecordReloadFailure(duration)
		// Version save failed - rollback policies
		if rollbackErr := rm.rollback(ctx, currentVersion); rollbackErr != nil {
			return nil, fmt.Errorf("failed to save new version: %w, rollback also failed: %v", err, rollbackErr)
		}
		return nil, fmt.Errorf("failed to save new version (rolled back): %w", err)
	}

	// Success - record metrics
	duration := time.Since(startTime).Seconds()
	rm.metrics.RecordReloadSuccess(duration)
	rm.metrics.SetCurrentVersion(newVersion.Version)
	rm.metrics.SetPolicyCount(len(newPolicies))

	return newVersion, nil
}

// Rollback performs a manual rollback to a specific version
func (rm *RollbackManager) Rollback(ctx context.Context, targetVersion int64) error {
	startTime := time.Now()
	rm.metrics.RecordRollbackAttempt()

	// Get the target version
	version, err := rm.versionStore.GetVersion(targetVersion)
	if err != nil {
		duration := time.Since(startTime).Seconds()
		rm.metrics.RecordRollbackFailure(duration)
		return fmt.Errorf("failed to get version %d: %w", targetVersion, err)
	}

	if err := rm.rollback(ctx, version); err != nil {
		duration := time.Since(startTime).Seconds()
		rm.metrics.RecordRollbackFailure(duration)
		return err
	}

	duration := time.Since(startTime).Seconds()
	rm.metrics.RecordRollbackSuccess(duration)
	rm.metrics.SetCurrentVersion(version.Version)
	rm.metrics.SetPolicyCount(len(version.Policies))

	return nil
}

// RollbackToPrevious rolls back to the previous version
func (rm *RollbackManager) RollbackToPrevious(ctx context.Context) error {
	version, err := rm.versionStore.GetPreviousVersion()
	if err != nil {
		return fmt.Errorf("failed to get previous version: %w", err)
	}

	return rm.rollback(ctx, version)
}

// rollback is the internal rollback implementation
func (rm *RollbackManager) rollback(ctx context.Context, version *PolicyVersion) error {
	if version == nil {
		return fmt.Errorf("cannot rollback to nil version")
	}

	// Clear current policies
	rm.store.Clear()

	// Restore policies from version
	for _, policy := range version.Policies {
		if err := rm.store.Add(policy); err != nil {
			return fmt.Errorf("failed to restore policy %s during rollback: %w", policy.Name, err)
		}
	}

	// Save rollback as a new version
	comment := fmt.Sprintf("Rollback to version %d", version.Version)
	if _, err := rm.versionStore.SaveVersion(version.Policies, comment); err != nil {
		// Log error but don't fail the rollback - policies are restored
		return fmt.Errorf("rollback succeeded but failed to save rollback version: %w", err)
	}

	return nil
}

// GetCurrentVersion returns the current policy version
func (rm *RollbackManager) GetCurrentVersion() (*PolicyVersion, error) {
	return rm.versionStore.GetCurrentVersion()
}

// GetVersion retrieves a specific version by number
func (rm *RollbackManager) GetVersion(version int64) (*PolicyVersion, error) {
	return rm.versionStore.GetVersion(version)
}

// ListVersions returns all stored versions
func (rm *RollbackManager) ListVersions() []*PolicyVersion {
	return rm.versionStore.ListVersions()
}

// GetStats returns version store statistics
func (rm *RollbackManager) GetStats() PolicyVersionStats {
	return rm.versionStore.GetStats()
}

// RollbackInfo contains information about a rollback operation
type RollbackInfo struct {
	Success        bool
	FromVersion    int64
	ToVersion      int64
	RollbackTime   time.Time
	PoliciesCount  int
	Error          error
}

// PerformRollbackWithInfo performs rollback and returns detailed information
func (rm *RollbackManager) PerformRollbackWithInfo(ctx context.Context, targetVersion int64) *RollbackInfo {
	info := &RollbackInfo{
		RollbackTime: time.Now(),
		ToVersion:    targetVersion,
	}

	// Get current version
	currentVersion, err := rm.versionStore.GetCurrentVersion()
	if err != nil {
		info.Error = fmt.Errorf("failed to get current version: %w", err)
		return info
	}
	info.FromVersion = currentVersion.Version

	// Perform rollback
	if err := rm.Rollback(ctx, targetVersion); err != nil {
		info.Error = err
		return info
	}

	// Get target version details
	targetVer, err := rm.versionStore.GetVersion(targetVersion)
	if err != nil {
		info.Error = fmt.Errorf("rollback succeeded but failed to get target version: %w", err)
		info.Success = true // Rollback still succeeded
		return info
	}

	info.Success = true
	info.PoliciesCount = len(targetVer.Policies)
	return info
}
