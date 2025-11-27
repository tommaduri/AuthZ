package security_test

import (
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
)

// TenantContext represents multi-tenant security context
type TenantContext struct {
	TenantID     string
	UserID       string
	Permissions  []string
	ResourceIDs  []string
}

// MultiTenantSecurityManager enforces tenant isolation
type MultiTenantSecurityManager struct {
	tenantTokens   map[string]map[string]bool // tenant -> token -> valid
	tenantAPIKeys  map[string]map[string]bool // tenant -> apikey -> valid
	tenantAuditLog map[string][]string        // tenant -> audit events
	mu             sync.RWMutex
}

func NewMultiTenantSecurityManager() *MultiTenantSecurityManager {
	return &MultiTenantSecurityManager{
		tenantTokens:   make(map[string]map[string]bool),
		tenantAPIKeys:  make(map[string]map[string]bool),
		tenantAuditLog: make(map[string][]string),
	}
}

// TestCrossTenantTokenAccessBlocked validates token isolation
func TestCrossTenantTokenAccessBlocked(t *testing.T) {
	manager := NewMultiTenantSecurityManager()

	// Create tokens for different tenants
	tenant1Token := "token-tenant1-user123"
	tenant2Token := "token-tenant2-user456"

	manager.IssueToken("tenant-1", tenant1Token)
	manager.IssueToken("tenant-2", tenant2Token)

	tests := []struct {
		name       string
		token      string
		tenantID   string
		shouldFail bool
	}{
		{
			name:       "Tenant 1 token with Tenant 1",
			token:      tenant1Token,
			tenantID:   "tenant-1",
			shouldFail: false,
		},
		{
			name:       "Tenant 1 token with Tenant 2 (cross-tenant)",
			token:      tenant1Token,
			tenantID:   "tenant-2",
			shouldFail: true,
		},
		{
			name:       "Tenant 2 token with Tenant 2",
			token:      tenant2Token,
			tenantID:   "tenant-2",
			shouldFail: false,
		},
		{
			name:       "Tenant 2 token with Tenant 1 (cross-tenant)",
			token:      tenant2Token,
			tenantID:   "tenant-1",
			shouldFail: true,
		},
		{
			name:       "Invalid token",
			token:      "invalid-token",
			tenantID:   "tenant-1",
			shouldFail: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			valid := manager.ValidateToken(tt.token, tt.tenantID)
			if tt.shouldFail {
				assert.False(t, valid, "Cross-tenant token access should be blocked")
			} else {
				assert.True(t, valid, "Same-tenant token access should be allowed")
			}
		})
	}
}

// TestCrossTenantAPIKeyAccessBlocked validates API key isolation
func TestCrossTenantAPIKeyAccessBlocked(t *testing.T) {
	manager := NewMultiTenantSecurityManager()

	// Create API keys for different tenants
	tenant1Key := "apikey-tenant1-abc123"
	tenant2Key := "apikey-tenant2-def456"

	manager.IssueAPIKey("tenant-1", tenant1Key)
	manager.IssueAPIKey("tenant-2", tenant2Key)

	tests := []struct {
		name       string
		apiKey     string
		tenantID   string
		shouldFail bool
	}{
		{
			name:       "Tenant 1 key with Tenant 1",
			apiKey:     tenant1Key,
			tenantID:   "tenant-1",
			shouldFail: false,
		},
		{
			name:       "Tenant 1 key with Tenant 2 (cross-tenant)",
			apiKey:     tenant1Key,
			tenantID:   "tenant-2",
			shouldFail: true,
		},
		{
			name:       "Tenant 2 key with Tenant 2",
			apiKey:     tenant2Key,
			tenantID:   "tenant-2",
			shouldFail: false,
		},
		{
			name:       "Tenant 2 key with Tenant 1 (cross-tenant)",
			apiKey:     tenant2Key,
			tenantID:   "tenant-1",
			shouldFail: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			valid := manager.ValidateAPIKey(tt.apiKey, tt.tenantID)
			if tt.shouldFail {
				assert.False(t, valid, "Cross-tenant API key access should be blocked")
			} else {
				assert.True(t, valid, "Same-tenant API key access should be allowed")
			}
		})
	}
}

// TestCrossTenantAuditLogAccessBlocked validates audit log isolation
func TestCrossTenantAuditLogAccessBlocked(t *testing.T) {
	manager := NewMultiTenantSecurityManager()

	// Create audit events for different tenants
	manager.LogAuditEvent("tenant-1", "user-123 logged in")
	manager.LogAuditEvent("tenant-1", "user-123 updated policy")
	manager.LogAuditEvent("tenant-2", "user-456 logged in")
	manager.LogAuditEvent("tenant-2", "user-456 created resource")

	// Tenant 1 should only see their events
	tenant1Events := manager.GetAuditEvents("tenant-1")
	assert.Len(t, tenant1Events, 2)
	for _, event := range tenant1Events {
		assert.NotContains(t, event, "user-456", "Should not see other tenant's events")
	}

	// Tenant 2 should only see their events
	tenant2Events := manager.GetAuditEvents("tenant-2")
	assert.Len(t, tenant2Events, 2)
	for _, event := range tenant2Events {
		assert.NotContains(t, event, "user-123", "Should not see other tenant's events")
	}

	// Cross-tenant access should return empty or error
	nonExistentEvents := manager.GetAuditEvents("tenant-999")
	assert.Empty(t, nonExistentEvents)
}

// TestRLSPolicyEnforcement simulates Row-Level Security enforcement
func TestRLSPolicyEnforcement(t *testing.T) {
	// Simulated database with RLS
	type Resource struct {
		ID       string
		TenantID string
		Name     string
	}

	resources := []Resource{
		{ID: "res-1", TenantID: "tenant-1", Name: "Resource 1"},
		{ID: "res-2", TenantID: "tenant-1", Name: "Resource 2"},
		{ID: "res-3", TenantID: "tenant-2", Name: "Resource 3"},
		{ID: "res-4", TenantID: "tenant-2", Name: "Resource 4"},
	}

	// RLS filter function
	rlsFilter := func(resources []Resource, tenantID string) []Resource {
		var filtered []Resource
		for _, r := range resources {
			if r.TenantID == tenantID {
				filtered = append(filtered, r)
			}
		}
		return filtered
	}

	tests := []struct {
		name          string
		tenantID      string
		expectedCount int
		expectedIDs   []string
	}{
		{
			name:          "Tenant 1 resources",
			tenantID:      "tenant-1",
			expectedCount: 2,
			expectedIDs:   []string{"res-1", "res-2"},
		},
		{
			name:          "Tenant 2 resources",
			tenantID:      "tenant-2",
			expectedCount: 2,
			expectedIDs:   []string{"res-3", "res-4"},
		},
		{
			name:          "Non-existent tenant",
			tenantID:      "tenant-999",
			expectedCount: 0,
			expectedIDs:   []string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			filtered := rlsFilter(resources, tt.tenantID)
			assert.Len(t, filtered, tt.expectedCount)

			for _, res := range filtered {
				assert.Contains(t, tt.expectedIDs, res.ID)
				assert.Equal(t, tt.tenantID, res.TenantID)
			}
		})
	}
}

// TestConcurrentMultiTenantAccess validates isolation under concurrent access
func TestConcurrentMultiTenantAccess(t *testing.T) {
	manager := NewMultiTenantSecurityManager()

	// Setup tokens for multiple tenants
	tenants := []string{"tenant-1", "tenant-2", "tenant-3", "tenant-4", "tenant-5"}
	for _, tenant := range tenants {
		manager.IssueToken(tenant, "token-"+tenant)
	}

	var wg sync.WaitGroup
	violations := 0
	var violationMu sync.Mutex

	// Concurrent access attempts
	for _, tenant := range tenants {
		for i := 0; i < 100; i++ {
			wg.Add(1)
			go func(t string) {
				defer wg.Done()

				// Try to access with correct tenant
				valid := manager.ValidateToken("token-"+t, t)
				if !valid {
					violationMu.Lock()
					violations++
					violationMu.Unlock()
				}

				// Try cross-tenant access (should fail)
				for _, otherTenant := range tenants {
					if otherTenant != t {
						valid := manager.ValidateToken("token-"+t, otherTenant)
						if valid {
							violationMu.Lock()
							violations++
							violationMu.Unlock()
						}
					}
				}
			}(tenant)
		}
	}

	wg.Wait()

	assert.Equal(t, 0, violations, "No tenant isolation violations should occur")
}

// TestTenantDataLeakagePrevention validates no data leakage between tenants
func TestTenantDataLeakagePrevention(t *testing.T) {
	manager := NewMultiTenantSecurityManager()

	// Create sensitive data for each tenant
	tenant1Data := []string{"sensitive-1", "secret-1", "confidential-1"}
	tenant2Data := []string{"sensitive-2", "secret-2", "confidential-2"}

	for _, data := range tenant1Data {
		manager.LogAuditEvent("tenant-1", data)
	}
	for _, data := range tenant2Data {
		manager.LogAuditEvent("tenant-2", data)
	}

	// Verify Tenant 1 cannot see Tenant 2 data
	tenant1Events := manager.GetAuditEvents("tenant-1")
	for _, event := range tenant1Events {
		for _, tenant2Secret := range tenant2Data {
			assert.NotContains(t, event, tenant2Secret,
				"Tenant 1 should not see Tenant 2 sensitive data")
		}
	}

	// Verify Tenant 2 cannot see Tenant 1 data
	tenant2Events := manager.GetAuditEvents("tenant-2")
	for _, event := range tenant2Events {
		for _, tenant1Secret := range tenant1Data {
			assert.NotContains(t, event, tenant1Secret,
				"Tenant 2 should not see Tenant 1 sensitive data")
		}
	}
}

// TestTenantContextValidation validates tenant context enforcement
func TestTenantContextValidation(t *testing.T) {
	validateContext := func(ctx *TenantContext, requestedTenant string) bool {
		return ctx.TenantID == requestedTenant
	}

	tests := []struct {
		name           string
		context        *TenantContext
		requestedTenant string
		shouldAllow    bool
	}{
		{
			name: "Matching tenant context",
			context: &TenantContext{
				TenantID: "tenant-1",
				UserID:   "user-123",
			},
			requestedTenant: "tenant-1",
			shouldAllow:     true,
		},
		{
			name: "Mismatched tenant context",
			context: &TenantContext{
				TenantID: "tenant-1",
				UserID:   "user-123",
			},
			requestedTenant: "tenant-2",
			shouldAllow:     false,
		},
		{
			name: "Empty tenant context",
			context: &TenantContext{
				TenantID: "",
				UserID:   "user-123",
			},
			requestedTenant: "tenant-1",
			shouldAllow:     false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			allowed := validateContext(tt.context, tt.requestedTenant)
			assert.Equal(t, tt.shouldAllow, allowed)
		})
	}
}

// Implementation methods

func (m *MultiTenantSecurityManager) IssueToken(tenantID, token string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.tenantTokens[tenantID]; !exists {
		m.tenantTokens[tenantID] = make(map[string]bool)
	}
	m.tenantTokens[tenantID][token] = true
}

func (m *MultiTenantSecurityManager) ValidateToken(token, tenantID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if tokens, exists := m.tenantTokens[tenantID]; exists {
		return tokens[token]
	}
	return false
}

func (m *MultiTenantSecurityManager) IssueAPIKey(tenantID, apiKey string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.tenantAPIKeys[tenantID]; !exists {
		m.tenantAPIKeys[tenantID] = make(map[string]bool)
	}
	m.tenantAPIKeys[tenantID][apiKey] = true
}

func (m *MultiTenantSecurityManager) ValidateAPIKey(apiKey, tenantID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if keys, exists := m.tenantAPIKeys[tenantID]; exists {
		return keys[apiKey]
	}
	return false
}

func (m *MultiTenantSecurityManager) LogAuditEvent(tenantID, event string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.tenantAuditLog[tenantID] = append(m.tenantAuditLog[tenantID], event)
}

func (m *MultiTenantSecurityManager) GetAuditEvents(tenantID string) []string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if events, exists := m.tenantAuditLog[tenantID]; exists {
		// Return copy to prevent external modification
		result := make([]string, len(events))
		copy(result, events)
		return result
	}
	return []string{}
}
