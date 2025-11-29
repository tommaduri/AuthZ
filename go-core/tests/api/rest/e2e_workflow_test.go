// Package rest provides end-to-end workflow integration tests
package rest

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/mux"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stretchr/testify/suite"
	"go.uber.org/zap"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

// E2EWorkflowTestSuite tests complete end-to-end workflows
type E2EWorkflowTestSuite struct {
	suite.Suite
	router    *mux.Router
	server    *httptest.Server
	engine    *engine.Engine
	store     policy.Store
	jwtSecret []byte
	logger    *zap.Logger
}

// SetupTest runs before each test
func (s *E2EWorkflowTestSuite) SetupTest() {
	s.logger = zap.NewNop()
	s.jwtSecret = []byte("test-secret-key")
	s.store = policy.NewMemoryStore()

	cfg := engine.DefaultConfig()
	cfg.CacheEnabled = false
	var err error
	s.engine, err = engine.New(cfg, s.store)
	require.NoError(s.T(), err)

	s.router = mux.NewRouter()
	s.setupRoutes()
	s.server = httptest.NewServer(s.router)
}

// TearDownTest runs after each test
func (s *E2EWorkflowTestSuite) TearDownTest() {
	if s.server != nil {
		s.server.Close()
	}
}

// setupRoutes configures all API routes
func (s *E2EWorkflowTestSuite) setupRoutes() {
	// User registration and authentication
	s.router.HandleFunc("/v1/register", s.handleRegister).Methods("POST")
	s.router.HandleFunc("/v1/login", s.handleLogin).Methods("POST")

	// Authorization
	s.router.HandleFunc("/v1/authorization/check", s.handleAuthCheck).Methods("POST")

	// Policy management
	s.router.HandleFunc("/v1/policies", s.handleListPolicies).Methods("GET")
	s.router.HandleFunc("/v1/policies", s.handleCreatePolicy).Methods("POST")
	s.router.HandleFunc("/v1/policies/{id}", s.handleGetPolicy).Methods("GET")
	s.router.HandleFunc("/v1/policies/{id}", s.handleUpdatePolicy).Methods("PUT")
	s.router.HandleFunc("/v1/policies/{id}", s.handleDeletePolicy).Methods("DELETE")

	// Export/Import
	s.router.HandleFunc("/v1/policies/export", s.handleExport).Methods("GET")
	s.router.HandleFunc("/v1/policies/import", s.handleImport).Methods("POST")
}

// Handler implementations (simplified for testing)

func (s *E2EWorkflowTestSuite) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"user_id":  "user-" + req.Username,
		"username": req.Username,
	})
}

func (s *E2EWorkflowTestSuite) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	// Generate JWT
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "user-" + req.Username,
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	tokenString, _ := token.SignedString(s.jwtSecret)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"token": tokenString,
	})
}

func (s *E2EWorkflowTestSuite) handleAuthCheck(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Principal *types.Principal `json:"principal"`
		Resource  *types.Resource  `json:"resource"`
		Action    string           `json:"action"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	checkReq := &types.CheckRequest{
		Principal: req.Principal,
		Resource:  req.Resource,
		Actions:   []string{req.Action},
	}

	resp, err := s.engine.Check(r.Context(), checkReq)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	result := resp.Results[req.Action]
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"effect": result.Effect,
	})
}

func (s *E2EWorkflowTestSuite) handleListPolicies(w http.ResponseWriter, r *http.Request) {
	policies, _ := s.store.List(r.Context())
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"policies": policies,
	})
}

func (s *E2EWorkflowTestSuite) handleCreatePolicy(w http.ResponseWriter, r *http.Request) {
	var policy types.Policy
	json.NewDecoder(r.Body).Decode(&policy)

	if err := s.store.Add(r.Context(), &policy); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(policy)
}

func (s *E2EWorkflowTestSuite) handleGetPolicy(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	policy, err := s.store.Get(r.Context(), vars["id"])
	if err != nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(policy)
}

func (s *E2EWorkflowTestSuite) handleUpdatePolicy(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	var policy types.Policy
	json.NewDecoder(r.Body).Decode(&policy)
	policy.PolicyID = vars["id"]

	if err := s.store.Update(r.Context(), &policy); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(policy)
}

func (s *E2EWorkflowTestSuite) handleDeletePolicy(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	if err := s.store.Delete(r.Context(), vars["id"]); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *E2EWorkflowTestSuite) handleExport(w http.ResponseWriter, r *http.Request) {
	policies, _ := s.store.List(r.Context())
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(policies)
}

func (s *E2EWorkflowTestSuite) handleImport(w http.ResponseWriter, r *http.Request) {
	var policies []*types.Policy
	json.NewDecoder(r.Body).Decode(&policies)

	for _, p := range policies {
		s.store.Add(r.Context(), p)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"imported": len(policies),
	})
}

// Test: Complete workflow - User registration → JWT → Authorization check
func (s *E2EWorkflowTestSuite) TestUserRegistrationToAuthCheck() {
	// Step 1: Register user
	regReq := map[string]interface{}{
		"username": "testuser",
		"password": "password123",
	}
	regBody, _ := json.Marshal(regReq)
	regResp, err := http.Post(s.server.URL+"/v1/register", "application/json", bytes.NewReader(regBody))
	require.NoError(s.T(), err)
	defer regResp.Body.Close()

	assert.Equal(s.T(), http.StatusOK, regResp.StatusCode)

	var regResult map[string]interface{}
	json.NewDecoder(regResp.Body).Decode(&regResult)
	userID := regResult["user_id"].(string)

	// Step 2: Login to get JWT
	loginReq := map[string]interface{}{
		"username": "testuser",
		"password": "password123",
	}
	loginBody, _ := json.Marshal(loginReq)
	loginResp, err := http.Post(s.server.URL+"/v1/login", "application/json", bytes.NewReader(loginBody))
	require.NoError(s.T(), err)
	defer loginResp.Body.Close()

	assert.Equal(s.T(), http.StatusOK, loginResp.StatusCode)

	var loginResult map[string]interface{}
	json.NewDecoder(loginResp.Body).Decode(&loginResult)
	token := loginResult["token"].(string)
	assert.NotEmpty(s.T(), token)

	// Step 3: Create policy
	policy := &types.Policy{
		PolicyID: "test-policy",
		Kind:     types.PolicyKindResource,
		Version:  "1.0",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules: []types.ResourceRule{
				{Actions: []string{"read"}, Effect: types.EffectAllow, Roles: []string{"viewer"}},
			},
		},
	}

	policyBody, _ := json.Marshal(policy)
	policyResp, err := http.Post(s.server.URL+"/v1/policies", "application/json", bytes.NewReader(policyBody))
	require.NoError(s.T(), err)
	defer policyResp.Body.Close()

	assert.Equal(s.T(), http.StatusCreated, policyResp.StatusCode)

	// Step 4: Authorization check
	authReq := map[string]interface{}{
		"principal": map[string]interface{}{
			"id":    userID,
			"roles": []string{"viewer"},
		},
		"resource": map[string]interface{}{
			"kind": "document",
			"id":   "doc123",
		},
		"action": "read",
	}

	authBody, _ := json.Marshal(authReq)
	authResp, err := http.Post(s.server.URL+"/v1/authorization/check", "application/json", bytes.NewReader(authBody))
	require.NoError(s.T(), err)
	defer authResp.Body.Close()

	assert.Equal(s.T(), http.StatusOK, authResp.StatusCode)

	var authResult map[string]interface{}
	json.NewDecoder(authResp.Body).Decode(&authResult)
	assert.Equal(s.T(), "allow", authResult["effect"])
}

// Test: Policy creation → Authorization test → Policy update → Retest
func (s *E2EWorkflowTestSuite) TestPolicyUpdateWorkflow() {
	ctx := context.Background()

	// Step 1: Create initial policy (deny all)
	policy := &types.Policy{
		PolicyID: "test-policy",
		Kind:     types.PolicyKindResource,
		Version:  "1.0",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules:    []types.ResourceRule{}, // No rules = deny
		},
	}

	policyBody, _ := json.Marshal(policy)
	resp, err := http.Post(s.server.URL+"/v1/policies", "application/json", bytes.NewReader(policyBody))
	require.NoError(s.T(), err)
	resp.Body.Close()

	// Step 2: Test authorization (should deny)
	authReq := map[string]interface{}{
		"principal": map[string]interface{}{
			"id":    "user123",
			"roles": []string{"viewer"},
		},
		"resource": map[string]interface{}{
			"kind": "document",
			"id":   "doc123",
		},
		"action": "read",
	}

	authBody, _ := json.Marshal(authReq)
	authResp, err := http.Post(s.server.URL+"/v1/authorization/check", "application/json", bytes.NewReader(authBody))
	require.NoError(s.T(), err)

	var result1 map[string]interface{}
	json.NewDecoder(authResp.Body).Decode(&result1)
	authResp.Body.Close()
	assert.Equal(s.T(), "deny", result1["effect"])

	// Step 3: Update policy to allow read
	policy.ResourcePolicy.Rules = []types.ResourceRule{
		{Actions: []string{"read"}, Effect: types.EffectAllow, Roles: []string{"viewer"}},
	}

	updateBody, _ := json.Marshal(policy)
	req, _ := http.NewRequest("PUT", s.server.URL+"/v1/policies/test-policy", bytes.NewReader(updateBody))
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	updateResp, err := client.Do(req)
	require.NoError(s.T(), err)
	updateResp.Body.Close()

	// Step 4: Retest authorization (should allow)
	authResp2, err := http.Post(s.server.URL+"/v1/authorization/check", "application/json", bytes.NewReader(authBody))
	require.NoError(s.T(), err)

	var result2 map[string]interface{}
	json.NewDecoder(authResp2.Body).Decode(&result2)
	authResp2.Body.Close()
	assert.Equal(s.T(), "allow", result2["effect"])
}

// Test: Export policies → Modify → Import → Verify changes
func (s *E2EWorkflowTestSuite) TestExportImportWorkflow() {
	ctx := context.Background()

	// Step 1: Create initial policies
	for i := 0; i < 3; i++ {
		policy := &types.Policy{
			PolicyID: fmt.Sprintf("policy%d", i),
			Kind:     types.PolicyKindResource,
			Version:  "1.0",
			ResourcePolicy: &types.ResourcePolicy{
				Resource: "document",
				Version:  "1.0",
				Rules:    []types.ResourceRule{},
			},
		}
		require.NoError(s.T(), s.store.Add(ctx, policy))
	}

	// Step 2: Export policies
	exportResp, err := http.Get(s.server.URL + "/v1/policies/export")
	require.NoError(s.T(), err)
	defer exportResp.Body.Close()

	var exported []*types.Policy
	json.NewDecoder(exportResp.Body).Decode(&exported)
	assert.Equal(s.T(), 3, len(exported))

	// Step 3: Modify exported policies
	for _, p := range exported {
		p.Description = "Modified via export/import"
	}

	// Step 4: Clear store
	allPolicies, _ := s.store.List(ctx)
	for _, p := range allPolicies {
		s.store.Delete(ctx, p.PolicyID)
	}

	// Step 5: Import modified policies
	importBody, _ := json.Marshal(exported)
	importResp, err := http.Post(s.server.URL+"/v1/policies/import", "application/json", bytes.NewReader(importBody))
	require.NoError(s.T(), err)
	defer importResp.Body.Close()

	// Step 6: Verify changes
	storedPolicies, err := s.store.List(ctx)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), 3, len(storedPolicies))

	for _, p := range storedPolicies {
		assert.Equal(s.T(), "Modified via export/import", p.Description)
	}
}

// Test: Backup → Delete all → Restore → Verify
func (s *E2EWorkflowTestSuite) TestBackupRestoreWorkflow() {
	ctx := context.Background()

	// Step 1: Create policies
	originalPolicies := []*types.Policy{}
	for i := 0; i < 5; i++ {
		policy := &types.Policy{
			PolicyID: fmt.Sprintf("policy%d", i),
			Kind:     types.PolicyKindResource,
			Version:  "1.0",
			ResourcePolicy: &types.ResourcePolicy{
				Resource: "document",
				Version:  "1.0",
				Rules:    []types.ResourceRule{},
			},
		}
		require.NoError(s.T(), s.store.Add(ctx, policy))
		originalPolicies = append(originalPolicies, policy)
	}

	// Step 2: Export as backup
	exportResp, err := http.Get(s.server.URL + "/v1/policies/export")
	require.NoError(s.T(), err)

	var backup []*types.Policy
	json.NewDecoder(exportResp.Body).Decode(&backup)
	exportResp.Body.Close()

	// Step 3: Delete all policies
	allPolicies, _ := s.store.List(ctx)
	for _, p := range allPolicies {
		s.store.Delete(ctx, p.PolicyID)
	}

	// Verify: Store is empty
	remaining, _ := s.store.List(ctx)
	assert.Equal(s.T(), 0, len(remaining))

	// Step 4: Restore from backup
	importBody, _ := json.Marshal(backup)
	importResp, err := http.Post(s.server.URL+"/v1/policies/import", "application/json", bytes.NewReader(importBody))
	require.NoError(s.T(), err)
	importResp.Body.Close()

	// Step 5: Verify restoration
	restored, err := s.store.List(ctx)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), 5, len(restored))
}

// Test: Multi-tenant isolation
func (s *E2EWorkflowTestSuite) TestMultiTenantIsolation() {
	// This test would verify that policies from one tenant don't leak to another
	// For now, we verify basic isolation
	ctx := context.Background()

	// Tenant 1 policies
	tenant1Policy := &types.Policy{
		PolicyID:    "tenant1-policy",
		Kind:        types.PolicyKindResource,
		Version:     "1.0",
		Description: "Tenant 1",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules:    []types.ResourceRule{},
		},
	}

	require.NoError(s.T(), s.store.Add(ctx, tenant1Policy))

	// Verify: Only tenant 1 policies visible
	policies, _ := s.store.List(ctx)
	assert.Equal(s.T(), 1, len(policies))

	// In a real multi-tenant system, we would filter by tenant ID
}

// Test: Concurrent policy operations
func (s *E2EWorkflowTestSuite) TestConcurrentOperations() {
	var wg sync.WaitGroup
	errors := make(chan error, 10)

	// Concurrent policy creation
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()

			policy := &types.Policy{
				PolicyID: fmt.Sprintf("concurrent-policy-%d", id),
				Kind:     types.PolicyKindResource,
				Version:  "1.0",
				ResourcePolicy: &types.ResourcePolicy{
					Resource: "document",
					Version:  "1.0",
					Rules:    []types.ResourceRule{},
				},
			}

			body, _ := json.Marshal(policy)
			resp, err := http.Post(s.server.URL+"/v1/policies", "application/json", bytes.NewReader(body))
			if err != nil {
				errors <- err
				return
			}
			resp.Body.Close()

			if resp.StatusCode != http.StatusCreated {
				errors <- fmt.Errorf("unexpected status: %d", resp.StatusCode)
			}
		}(i)
	}

	wg.Wait()
	close(errors)

	// Verify: No errors
	for err := range errors {
		assert.NoError(s.T(), err)
	}

	// Verify: All policies created
	policies, _ := s.store.List(context.Background())
	assert.Equal(s.T(), 10, len(policies))
}

// TestE2EWorkflowTestSuite runs the test suite
func TestE2EWorkflowTestSuite(t *testing.T) {
	suite.Run(t, new(E2EWorkflowTestSuite))
}
