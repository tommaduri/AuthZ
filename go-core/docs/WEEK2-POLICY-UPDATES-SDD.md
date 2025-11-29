# Week 2: Real-Time Policy Updates & Validation - Specification-Driven Development (SDD)

**Status**: Ready for Implementation
**Date**: 2025-11-26
**Goal**: 85% → 90% Production Ready
**Timeline**: 5-7 days
**Estimated Effort**: 55 story points

---

## Executive Summary

Week 2 builds on Week 1's foundation (JWT auth, audit logging, Helm deployment) to add **real-time policy management capabilities**. These features enable:
- Zero-downtime policy updates via file watching
- Comprehensive policy validation before deployment
- REST API for policy management
- Integration test suite for E2E validation

**Impact**: Increases production readiness from 85% to 90% with critical policy management features.

---

## Feature Overview

| Feature | Story Points | Priority | Dependencies |
|---------|--------------|----------|--------------|
| **1. Real-Time Policy Updates** | 21 SP | P0 | Week 1 Complete |
| **2. Policy Validation Framework** | 13 SP | P0 | Feature 1 |
| **3. Admin Dashboard API** | 13 SP | P1 | Feature 1 |
| **4. Integration Testing Suite** | 8 SP | P1 | Features 1-3 |
| **Total** | **55 SP** | | |

---

## Feature 1: Real-Time Policy Updates (21 SP)

### 1.1 Current State Analysis

**Existing Implementation**:
- ✅ `internal/policy/watcher.go` - FileWatcher with fsnotify
- ✅ `internal/policy/loader.go` - Policy loading from files
- ✅ `internal/policy/memory.go` - In-memory policy store
- ⚠️  Some test failures in policy validation

**Gap Analysis**:
- Missing: Version tracking for policy updates
- Missing: Rollback capability on failed updates
- Missing: Metrics for policy reload success/failure
- Missing: Integration with audit logging
- Missing: Policy update notifications

### 1.2 Technical Specification

**Components to Enhance**:

1. **PolicyVersioning** - Track policy versions over time
2. **RollbackManager** - Automatic rollback on validation failure
3. **UpdateNotifier** - Publish policy update events
4. **MetricsCollector** - Track reload metrics
5. **AuditIntegration** - Log all policy changes

### 1.3 Implementation Plan

#### Phase 1: Policy Versioning (5 SP, 1 day)

**File**: `internal/policy/versioning.go`

```go
package policy

import (
	"sync"
	"time"
)

// PolicyVersion represents a versioned policy snapshot
type PolicyVersion struct {
	Version   int64
	Timestamp time.Time
	Policies  map[string]*Policy
	Checksum  string
}

// VersionStore manages policy version history
type VersionStore struct {
	mu            sync.RWMutex
	versions      []*PolicyVersion
	currentVersion int64
	maxVersions   int // Default: 10
}

func NewVersionStore(maxVersions int) *VersionStore {
	if maxVersions <= 0 {
		maxVersions = 10
	}
	return &VersionStore{
		versions:    make([]*PolicyVersion, 0, maxVersions),
		maxVersions: maxVersions,
	}
}

func (vs *VersionStore) SaveVersion(policies map[string]*Policy) (*PolicyVersion, error) {
	// Implementation
}

func (vs *VersionStore) GetVersion(version int64) (*PolicyVersion, error) {
	// Implementation
}

func (vs *VersionStore) GetCurrentVersion() (*PolicyVersion, error) {
	// Implementation
}

func (vs *VersionStore) GetPreviousVersion() (*PolicyVersion, error) {
	// For rollback
}
```

**Tests**: `versioning_test.go`
- TestVersionStore_SaveVersion
- TestVersionStore_GetVersion
- TestVersionStore_RollbackToPrevious
- TestVersionStore_MaxVersions (LRU eviction)
- TestVersionStore_Concurrent

#### Phase 2: Rollback Manager (8 SP, 2 days)

**File**: `internal/policy/rollback.go`

```go
package policy

import (
	"context"
	"fmt"
)

// RollbackManager handles automatic rollback on policy update failures
type RollbackManager struct {
	store          Store
	versionStore   *VersionStore
	validator      *Validator
	auditLogger    AuditLogger
}

func NewRollbackManager(store Store, versionStore *VersionStore, validator *Validator) *RollbackManager {
	return &RollbackManager{
		store:        store,
		versionStore: versionStore,
		validator:    validator,
	}
}

// UpdateWithRollback attempts to update policies with automatic rollback on failure
func (rm *RollbackManager) UpdateWithRollback(ctx context.Context, newPolicies map[string]*Policy) error {
	// 1. Save current version
	currentVersion, err := rm.versionStore.SaveVersion(rm.store.GetAll())
	if err != nil {
		return fmt.Errorf("failed to save current version: %w", err)
	}

	// 2. Validate new policies
	for _, policy := range newPolicies {
		if err := rm.validator.ValidatePolicy(policy); err != nil {
			return fmt.Errorf("validation failed: %w", err)
		}
	}

	// 3. Apply new policies
	if err := rm.store.ReplaceAll(newPolicies); err != nil {
		// Rollback on failure
		if rollbackErr := rm.rollback(ctx, currentVersion); rollbackErr != nil {
			return fmt.Errorf("update failed: %w, rollback failed: %v", err, rollbackErr)
		}
		return fmt.Errorf("update failed (rolled back): %w", err)
	}

	// 4. Log audit event
	rm.auditLogger.LogPolicyChange(ctx, &PolicyChange{
		Operation: "update",
		Version:   currentVersion.Version + 1,
		// ...
	})

	return nil
}

func (rm *RollbackManager) Rollback(ctx context.Context, version int64) error {
	// Manual rollback to specific version
}
```

**Integration Points**:
- `FileWatcher.reloadPolicies()` - Use RollbackManager for updates
- `Store.ReplaceAll()` - Atomic policy replacement
- Audit logging for policy changes

**Tests**: `rollback_test.go`
- TestRollbackManager_SuccessfulUpdate
- TestRollbackManager_FailedValidation
- TestRollbackManager_FailedUpdateWithRollback
- TestRollbackManager_ManualRollback
- TestRollbackManager_ConcurrentUpdates

#### Phase 3: Metrics & Monitoring (4 SP, 1 day)

**File**: `internal/policy/metrics.go`

```go
package policy

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	policyReloadsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "authz_policy_reloads_total",
			Help: "Total number of policy reload attempts",
		},
		[]string{"status"}, // success, failure, rollback
	)

	policyReloadDuration = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "authz_policy_reload_duration_seconds",
			Help:    "Time taken to reload policies",
			Buckets: prometheus.DefBuckets,
		},
	)

	policyVersionCurrent = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "authz_policy_version_current",
			Help: "Current policy version number",
		},
	)

	policyCount = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "authz_policy_count",
			Help: "Number of loaded policies",
		},
	)
)

// MetricsRecorder records policy-related metrics
type MetricsRecorder struct{}

func (mr *MetricsRecorder) RecordReload(status string, duration float64) {
	policyReloadsTotal.WithLabelValues(status).Inc()
	policyReloadDuration.Observe(duration)
}
```

**Integration**:
- Add metrics recording to `FileWatcher.reloadPolicies()`
- Add metrics recording to `RollbackManager.UpdateWithRollback()`

#### Phase 4: Update Notifications (4 SP, 1 day)

**File**: `internal/policy/notifier.go`

```go
package policy

import (
	"sync"
)

// PolicyUpdateEvent represents a policy update notification
type PolicyUpdateEvent struct {
	Type      string // "update", "rollback", "delete"
	Version   int64
	PolicyIDs []string
	Error     error
}

// UpdateNotifier publishes policy update events to subscribers
type UpdateNotifier struct {
	mu          sync.RWMutex
	subscribers []chan<- PolicyUpdateEvent
}

func NewUpdateNotifier() *UpdateNotifier {
	return &UpdateNotifier{
		subscribers: make([]chan<- PolicyUpdateEvent, 0),
	}
}

func (un *UpdateNotifier) Subscribe(ch chan<- PolicyUpdateEvent) {
	un.mu.Lock()
	defer un.mu.Unlock()
	un.subscribers = append(un.subscribers, ch)
}

func (un *UpdateNotifier) Notify(event PolicyUpdateEvent) {
	un.mu.RLock()
	defer un.mu.RUnlock()
	for _, ch := range un.subscribers {
		select {
		case ch <- event:
		default:
			// Non-blocking send
		}
	}
}
```

**Use Cases**:
- Cache invalidation on policy updates
- UI notifications for policy changes
- Integration testing hooks

### 1.4 Success Criteria

**Technical**:
- [ ] Policy versioning with 10-version history
- [ ] Automatic rollback on validation failure
- [ ] Zero-downtime policy updates (<1ms disruption)
- [ ] Metrics exported to Prometheus
- [ ] Audit logging for all policy changes
- [ ] Update notifications working

**Testing**:
- [ ] All unit tests passing (20+ tests)
- [ ] Integration tests for full update cycle
- [ ] Rollback tests (validation failure, update failure)
- [ ] Concurrent update tests (race conditions)
- [ ] Performance tests (1000 policies, 100 updates/sec)

**Performance Targets**:
- Policy reload: <100ms for 1000 policies
- Rollback: <50ms
- Version lookup: <1µs (in-memory)
- Update notification: <10ms

**Estimated Effort**: 21 story points (4-5 days)

---

## Feature 2: Policy Validation Framework (13 SP)

### 2.1 Current State

**Existing**: `internal/policy/validator.go` (partial implementation)

**Issues**:
- ⚠️ Test failures: "invalid action format: read"
- Missing: CEL expression validation
- Missing: Schema validation
- Missing: Circular dependency detection
- Missing: Resource/action format validation

### 2.2 Enhanced Validator

**File**: `internal/policy/validator.go` (enhance existing)

```go
// ValidationConfig configures validator behavior
type ValidationConfig struct {
	StrictMode        bool     // Fail on warnings
	AllowedActions    []string // Whitelist of valid actions
	AllowedResources  []string // Whitelist of resource kinds
	MaxRuleDepth      int      // Prevent infinite recursion
	ValidateCEL       bool     // Enable CEL validation
}

// Enhanced Validator
type Validator struct {
	config       ValidationConfig
	celValidator *CELValidator
}

// ValidationResult contains validation outcome
type ValidationResult struct {
	Valid    bool
	Errors   []ValidationError
	Warnings []ValidationWarning
}

type ValidationError struct {
	Type    string // "syntax", "semantic", "cel", "circular_dep"
	Message string
	Path    string // e.g., "rules[0].condition.expr"
}
```

**New Validations**:
1. **Action Format**: Validate against allowed actions list
2. **CEL Expressions**: Syntax and type checking
3. **Circular Dependencies**: Detect derived role loops
4. **Schema Compliance**: Validate against Cerbos schema
5. **Resource Hierarchy**: Validate resource kind patterns

### 2.3 Implementation Tasks

- [ ] Fix existing test failures (action format validation)
- [ ] Implement CEL expression validator
- [ ] Add circular dependency detector
- [ ] Add schema validator
- [ ] Write comprehensive tests (15+ test cases)

**Estimated Effort**: 13 story points (2-3 days)

---

## Feature 3: Admin Dashboard API (13 SP)

### 3.1 REST API Endpoints

**Base Path**: `/api/v1/policies`

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/policies` | List all policies | JWT |
| GET | `/policies/:id` | Get policy details | JWT |
| POST | `/policies` | Create new policy | JWT + Admin |
| PUT | `/policies/:id` | Update policy | JWT + Admin |
| DELETE | `/policies/:id` | Delete policy | JWT + Admin |
| POST | `/policies/validate` | Validate policy | JWT |
| GET | `/policies/versions` | List policy versions | JWT |
| POST | `/policies/rollback/:version` | Rollback to version | JWT + Admin |
| GET | `/health` | Health check | Public |
| GET | `/metrics` | Prometheus metrics | Public |

### 3.2 Implementation

**File**: `internal/server/handlers/policy_handlers.go`

```go
package handlers

type PolicyHandler struct {
	store          policy.Store
	versionStore   *policy.VersionStore
	rollbackMgr    *policy.RollbackManager
	validator      *policy.Validator
	auditLogger    audit.Logger
	jwtValidator   *auth.JWTValidator
}

func (h *PolicyHandler) ListPolicies(w http.ResponseWriter, r *http.Request) {
	// Implementation
}

func (h *PolicyHandler) CreatePolicy(w http.ResponseWriter, r *http.Request) {
	// Validate JWT + admin role
	// Validate policy
	// Save policy
	// Log audit event
}

func (h *PolicyHandler) RollbackPolicy(w http.ResponseWriter, r *http.Request) {
	// Admin only
	// Rollback to version
	// Log audit event
}
```

**Middleware**:
- JWT authentication (reuse Week 1 implementation)
- Admin role check
- Request logging
- Rate limiting

### 3.3 OpenAPI Specification

**File**: `api/openapi.yaml`

```yaml
openapi: 3.0.0
info:
  title: AuthZ Engine Admin API
  version: 1.0.0
  description: Policy management and administration

paths:
  /api/v1/policies:
    get:
      summary: List all policies
      security:
        - BearerAuth: []
      responses:
        '200':
          description: List of policies
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Policy'
