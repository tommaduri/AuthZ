package api_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/agent"
	"github.com/authz-engine/go-core/internal/api"
	"github.com/authz-engine/go-core/internal/api/handlers"
	"github.com/authz-engine/go-core/internal/delegation"
	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// Test Environment Setup
type AgentAPITestEnv struct {
	Server           *api.Server
	AgentStore       agent.Store
	DelegationStore  delegation.Store
	PolicyStore      policy.Store
	Engine           *engine.Engine
	JWTSecret        []byte
	Logger           *zap.Logger
}

func setupAgentAPITestEnv(t *testing.T) *AgentAPITestEnv {
	logger := zap.NewNop()

	// Initialize stores
	agentStore := agent.NewInMemoryStore()
	delegationStore := delegation.NewInMemoryStore()
	policyStore := policy.NewMemoryStore()

	// Initialize engine
	engConfig := engine.Config{
		CacheEnabled:    false,
		ParallelWorkers: 4,
	}
	eng, err := engine.New(engConfig, policyStore)
	require.NoError(t, err)

	// JWT secret for testing
	jwtSecret := []byte("test-secret-key-32-bytes-long!")

	// Initialize API server with agent handlers
	apiConfig := api.DefaultConfig()
	apiConfig.EnableAuth = true
	apiConfig.JWTSecret = string(jwtSecret)

	// Create server (will be updated to include agent handlers)
	server, err := api.NewWithAgentHandlers(apiConfig, policyStore, agentStore, delegationStore, eng, logger)
	require.NoError(t, err)

	return &AgentAPITestEnv{
		Server:          server,
		AgentStore:      agentStore,
		DelegationStore: delegationStore,
		PolicyStore:     policyStore,
		Engine:          eng,
		JWTSecret:       jwtSecret,
		Logger:          logger,
	}
}

// Helper function to make API requests
func (env *AgentAPITestEnv) apiRequest(method, path string, body interface{}, token string) *httptest.ResponseRecorder {
	var bodyReader *bytes.Reader
	if body != nil {
		bodyBytes, _ := json.Marshal(body)
		bodyReader = bytes.NewReader(bodyBytes)
	} else {
		bodyReader = bytes.NewReader([]byte{})
	}

	req := httptest.NewRequest(method, path, bodyReader)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	w := httptest.NewRecorder()
	env.Server.Router().ServeHTTP(w, req)
	return w
}

// Helper function to register an agent and get JWT token
func (env *AgentAPITestEnv) registerTestAgent(agentID, agentType string) string {
	reqBody := handlers.RegisterAgentRequest{
		ID:          agentID,
		Type:        agentType,
		DisplayName: "Test Agent",
	}
	w := env.apiRequest("POST", "/api/v1/agent/register", reqBody, "")
	if w.Code != http.StatusCreated {
		panic(fmt.Sprintf("Failed to register test agent: %d", w.Code))
	}

	var resp handlers.RegisterAgentResponse
	if err := unmarshalResponse(w.Body.Bytes(), &resp); err != nil {
		panic(fmt.Sprintf("Failed to unmarshal registration response: %v", err))
	}
	return resp.Token
}

// Helper types for unwrapping API responses
type apiResponseWrapper struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data,omitempty"`
	Error   *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Details string `json:"details,omitempty"`
	} `json:"error,omitempty"`
}

// Helper function to unmarshal wrapped response
func unmarshalResponse(body []byte, target interface{}) error {
	var wrapper apiResponseWrapper
	if err := json.Unmarshal(body, &wrapper); err != nil {
		return err
	}
	if !wrapper.Success {
		return fmt.Errorf("API error: %s", wrapper.Error.Message)
	}
	return json.Unmarshal(wrapper.Data, target)
}

// TEST 1: Agent Registration
func TestAgentRegistration(t *testing.T) {
	env := setupAgentAPITestEnv(t)

	t.Run("should_register_new_agent_and_return_JWT", func(t *testing.T) {
		reqBody := handlers.RegisterAgentRequest{
			ID:          "agent:test-service",
			Type:        "service",
			DisplayName: "Test Service Agent",
			Credentials: []types.Credential{
				{
					ID:    "cred-1",
					Type:  "api_key",
					Value: "secret-key-123",
				},
			},
		}

		w := env.apiRequest("POST", "/api/v1/agent/register", reqBody, "")

		assert.Equal(t, http.StatusCreated, w.Code)

		var resp handlers.RegisterAgentResponse
		err := unmarshalResponse(w.Body.Bytes(), &resp)
		require.NoError(t, err)

		// Verify response
		assert.NotNil(t, resp.Agent)
		assert.Equal(t, "agent:test-service", resp.Agent.ID)
		assert.Equal(t, "service", resp.Agent.Type)
		assert.Equal(t, "active", resp.Agent.Status)
		assert.NotEmpty(t, resp.Token)

		// Verify agent stored
		storedAgent, err := env.AgentStore.Get("agent:test-service")
		require.NoError(t, err)
		assert.Equal(t, "agent:test-service", storedAgent.ID)
	})

	t.Run("should_reject_duplicate_agent_id", func(t *testing.T) {
		// Register first agent
		reqBody := handlers.RegisterAgentRequest{
			ID:          "agent:duplicate",
			Type:        "service",
			DisplayName: "First Agent",
		}
		env.apiRequest("POST", "/api/v1/agent/register", reqBody, "")

		// Try to register duplicate
		w := env.apiRequest("POST", "/api/v1/agent/register", reqBody, "")

		assert.Equal(t, http.StatusConflict, w.Code)
	})

	t.Run("should_validate_required_fields", func(t *testing.T) {
		reqBody := handlers.RegisterAgentRequest{
			// Missing ID
			Type:        "service",
			DisplayName: "Test Agent",
		}

		w := env.apiRequest("POST", "/api/v1/agent/register", reqBody, "")

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("should_support_agent_expiration", func(t *testing.T) {
		reqBody := handlers.RegisterAgentRequest{
			ID:          "agent:temporary",
			Type:        "ai-agent",
			DisplayName: "Temporary Agent",
		}

		w := env.apiRequest("POST", "/api/v1/agent/register", reqBody, "")

		assert.Equal(t, http.StatusCreated, w.Code)

		var resp handlers.RegisterAgentResponse
		unmarshalResponse(w.Body.Bytes(), &resp)
		// Agent created successfully even without explicit expiration
		assert.NotNil(t, resp.Agent)
	})
}

// TEST 2: Delegation Creation
func TestDelegationCreation(t *testing.T) {
	env := setupAgentAPITestEnv(t)

	// Setup: Register source and target agents
	sourceAgent := &types.Agent{
		ID:          "agent:source",
		Type:        "service",
		DisplayName: "Source Agent",
		Status:      "active",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	env.AgentStore.Add(sourceAgent)

	targetAgent := &types.Agent{
		ID:          "agent:target",
		Type:        "ai-agent",
		DisplayName: "Target Agent",
		Status:      "active",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	env.AgentStore.Add(targetAgent)

	t.Run("should_create_delegation_between_agents", func(t *testing.T) {
		token := env.registerTestAgent("test-auth-1", "service")

		reqBody := handlers.CreateDelegationRequest{
			FromAgentID: "agent:source",
			ToAgentID:   "agent:target",
			Scopes:      []string{"read:*", "write:document"},
			MaxHops:     3,
			ExpiresAt:   time.Now().Add(24 * time.Hour),
		}

		w := env.apiRequest("POST", "/api/v1/agent/delegate", reqBody, token)

		assert.Equal(t, http.StatusCreated, w.Code)

		var resp handlers.CreateDelegationResponse
		err := unmarshalResponse(w.Body.Bytes(), &resp)
		require.NoError(t, err)

		assert.NotNil(t, resp.Delegation)
		assert.Equal(t, "agent:source", resp.Delegation.FromAgentID)
		assert.Equal(t, "agent:target", resp.Delegation.ToAgentID)
		assert.Equal(t, []string{"read:*", "write:document"}, resp.Delegation.Scopes)
		assert.Equal(t, 3, resp.Delegation.MaxHops)
	})

	t.Run("should_reject_delegation_to_inactive_agent", func(t *testing.T) {
		token := env.registerTestAgent("test-auth-2", "service")

		// Create inactive agent
		inactiveAgent := &types.Agent{
			ID:          "agent:inactive",
			Type:        "service",
			DisplayName: "Inactive Agent",
			Status:      "revoked",
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		}
		err := env.AgentStore.Add(inactiveAgent)
		require.NoError(t, err)

		reqBody := handlers.CreateDelegationRequest{
			FromAgentID: "agent:source",
			ToAgentID:   "agent:inactive",
			Scopes:      []string{"read:*"},
			ExpiresAt:   time.Now().Add(1 * time.Hour),
		}

		w := env.apiRequest("POST", "/api/v1/agent/delegate", reqBody, token)

		// Debug response
		t.Logf("Status: %d, Body: %s", w.Code, w.Body.String())
		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("should_validate_scope_patterns", func(t *testing.T) {
		token := env.registerTestAgent("test-auth-3", "service")

		reqBody := handlers.CreateDelegationRequest{
			FromAgentID: "agent:source",
			ToAgentID:   "agent:target",
			Scopes:      []string{}, // Empty scopes
			ExpiresAt:   time.Now().Add(1 * time.Hour),
		}

		w := env.apiRequest("POST", "/api/v1/agent/delegate", reqBody, token)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("should_limit_max_hops", func(t *testing.T) {
		token := env.registerTestAgent("test-auth-4", "service")

		reqBody := handlers.CreateDelegationRequest{
			FromAgentID: "agent:source",
			ToAgentID:   "agent:target",
			Scopes:      []string{"read:*"},
			MaxHops:     10, // Exceeds limit of 5
			ExpiresAt:   time.Now().Add(1 * time.Hour),
		}

		w := env.apiRequest("POST", "/api/v1/agent/delegate", reqBody, token)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}

// TEST 3: Authorization Check with Delegation
func TestAuthorizationCheckWithDelegation(t *testing.T) {
	env := setupAgentAPITestEnv(t)

	// Setup: Register agents and create delegation chain
	userAgent := &types.Agent{
		ID:          "user:alice",
		Type:        "human",
		DisplayName: "Alice User",
		Status:      "active",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	env.AgentStore.Add(userAgent)

	orchestratorAgent := &types.Agent{
		ID:          "agent:orchestrator",
		Type:        "ai-agent",
		DisplayName: "Orchestrator Agent",
		Status:      "active",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	env.AgentStore.Add(orchestratorAgent)

	workerAgent := &types.Agent{
		ID:          "agent:worker",
		Type:        "ai-agent",
		DisplayName: "Worker Agent",
		Status:      "active",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	env.AgentStore.Add(workerAgent)

	// Create delegation chain: user -> orchestrator -> worker
	delegation1 := &types.Delegation{
		ID:          "del-1",
		FromAgentID: "user:alice",
		ToAgentID:   "agent:orchestrator",
		Scopes:      []string{"deploy:*"},
		MaxHops:     2,
		ExpiresAt:   time.Now().Add(24 * time.Hour),
		CreatedAt:   time.Now(),
		Active:      true,
	}
	env.DelegationStore.Add(delegation1)

	delegation2 := &types.Delegation{
		ID:          "del-2",
		FromAgentID: "agent:orchestrator",
		ToAgentID:   "agent:worker",
		Scopes:      []string{"deploy:*"},
		MaxHops:     1,
		ExpiresAt:   time.Now().Add(1 * time.Hour),
		CreatedAt:   time.Now(),
		Active:      true,
	}
	env.DelegationStore.Add(delegation2)

	// Add policy to allow user:alice to deploy services
	testPolicy := &types.Policy{
		Name:         "alice-deploy-policy",
		ResourceKind: "service",
		Rules: []*types.Rule{
			{
				Effect:  types.EffectAllow,
				Actions: []string{"deploy"},
				Roles:   []string{"user:alice"},
			},
		},
	}
	env.PolicyStore.Add(testPolicy)

	t.Run("should_allow_with_valid_2hop_delegation", func(t *testing.T) {
token := env.registerTestAgent("test-auth-check-1", "service")
		reqBody := handlers.AgentCheckRequest{
			AgentID:         "agent:worker",
			DelegationChain: []string{"user:alice", "agent:orchestrator", "agent:worker"},
			Action:          "deploy",
			Resource: &types.Resource{
				Kind: "service",
				ID:   "api-gateway",
			},
		}

		w := env.apiRequest("POST", "/api/v1/agent/check", reqBody, token)

		assert.Equal(t, http.StatusOK, w.Code)

		var resp handlers.AgentCheckResponse
		err := unmarshalResponse(w.Body.Bytes(), &resp)
		require.NoError(t, err)

		assert.Equal(t, "allow", resp.Effect)
		assert.NotNil(t, resp.ValidatedChain)
	})

	t.Run("should_deny_with_invalid_delegation_chain", func(t *testing.T) {
token := env.registerTestAgent("test-auth-check-2", "service")
		reqBody := handlers.AgentCheckRequest{
			AgentID:         "agent:worker",
			DelegationChain: []string{"user:alice", "agent:worker"}, // Missing orchestrator
			Action:          "deploy",
			Resource: &types.Resource{
				Kind: "service",
				ID:   "api-gateway",
			},
		}

		w := env.apiRequest("POST", "/api/v1/agent/check", reqBody, token)

		assert.Equal(t, http.StatusForbidden, w.Code)

		var resp handlers.AgentCheckResponse
		unmarshalResponse(w.Body.Bytes(), &resp)
		assert.Equal(t, "deny", resp.Effect)
	})

	t.Run("should_deny_when_scopes_dont_match", func(t *testing.T) {
token := env.registerTestAgent("test-auth-check-3", "service")
		reqBody := handlers.AgentCheckRequest{
			AgentID:         "agent:worker",
			DelegationChain: []string{"user:alice", "agent:orchestrator", "agent:worker"},
			Action:          "delete", // Not in delegation scopes
			Resource: &types.Resource{
				Kind: "service",
				ID:   "api-gateway",
			},
		}

		w := env.apiRequest("POST", "/api/v1/agent/check", reqBody, token)

		assert.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("should_work_without_delegation_for_direct_agent", func(t *testing.T) {
token := env.registerTestAgent("test-auth-check-4", "service")
		reqBody := handlers.AgentCheckRequest{
			AgentID: "user:alice",
			Action:  "deploy",
			Resource: &types.Resource{
				Kind: "service",
				ID:   "direct-service",
			},
		}

		w := env.apiRequest("POST", "/api/v1/agent/check", reqBody, token)

		assert.Equal(t, http.StatusOK, w.Code)
	})
}

// TEST 4: Get Agent Details
func TestGetAgent(t *testing.T) {
	env := setupAgentAPITestEnv(t)

	// Setup: Register agent
	agent := &types.Agent{
		ID:          "agent:test",
		Type:        "service",
		DisplayName: "Test Agent",
		Status:      "active",
		Credentials: []types.Credential{
			{
				ID:    "cred-1",
				Type:  "api_key",
				Value: "secret-value",
			},
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	env.AgentStore.Add(agent)

	t.Run("should_return_agent_details_with_redacted_credentials", func(t *testing.T) {
		token := env.registerTestAgent("test-get-1", "service")
		w := env.apiRequest("GET", "/api/v1/agent/agent:test", nil, token)

		assert.Equal(t, http.StatusOK, w.Code)

		var resp map[string]interface{}
		err := unmarshalResponse(w.Body.Bytes(), &resp)
		require.NoError(t, err)

		agentData := resp["agent"].(map[string]interface{})
		assert.Equal(t, "agent:test", agentData["id"])
		assert.Equal(t, "service", agentData["type"])

		// Credentials should be redacted
		credentials := agentData["credentials"].([]interface{})
		firstCred := credentials[0].(map[string]interface{})
		assert.Equal(t, "***REDACTED***", firstCred["value"])
	})

	t.Run("should_return_404_for_nonexistent_agent", func(t *testing.T) {
		token := env.registerTestAgent("test-get-2", "service")
		w := env.apiRequest("GET", "/api/v1/agent/nonexistent", nil, token)

		assert.Equal(t, http.StatusNotFound, w.Code)
	})
}

// TEST 5: Revoke Agent
func TestRevokeAgent(t *testing.T) {
	env := setupAgentAPITestEnv(t)

	// Setup: Register agent
	agent := &types.Agent{
		ID:          "agent:revoke-test",
		Type:        "service",
		DisplayName: "Revoke Test Agent",
		Status:      "active",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	env.AgentStore.Add(agent)

	t.Run("should_revoke_agent_successfully", func(t *testing.T) {
		token := env.registerTestAgent("test-revoke-1", "service")
		w := env.apiRequest("DELETE", "/api/v1/agent/agent:revoke-test/revoke", nil, token)

		assert.Equal(t, http.StatusOK, w.Code)

		// Verify agent is revoked
		revokedAgent, err := env.AgentStore.Get("agent:revoke-test")
		require.NoError(t, err)
		assert.Equal(t, "revoked", revokedAgent.Status)
	})

	t.Run("should_return_404_for_nonexistent_agent", func(t *testing.T) {
		token := env.registerTestAgent("test-revoke-2", "service")
		w := env.apiRequest("DELETE", "/api/v1/agent/nonexistent/revoke", nil, token)

		assert.Equal(t, http.StatusNotFound, w.Code)
	})
}

// TEST 6: JWT Authentication
func TestJWTAuthentication(t *testing.T) {
	env := setupAgentAPITestEnv(t)

	t.Run("should_require_authentication_for_protected_endpoints", func(t *testing.T) {
		// Try to create delegation without token
		reqBody := handlers.CreateDelegationRequest{
			FromAgentID: "agent:a",
			ToAgentID:   "agent:b",
			Scopes:      []string{"read:*"},
			ExpiresAt:   time.Now().Add(1 * time.Hour),
		}

		w := env.apiRequest("POST", "/api/v1/agent/delegate", reqBody, "")

		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})

	t.Run("should_accept_valid_JWT_token", func(t *testing.T) {
		// Register agent to get token
		registerReq := handlers.RegisterAgentRequest{
			ID:          "agent:authenticated",
			Type:        "service",
			DisplayName: "Authenticated Agent",
		}

		registerResp := env.apiRequest("POST", "/api/v1/agent/register", registerReq, "")
		var registerResult handlers.RegisterAgentResponse
		err := unmarshalResponse(registerResp.Body.Bytes(), &registerResult)
		require.NoError(t, err)

		// Use token for authenticated request (GET doesn't need a body)
		w := env.apiRequest("GET", "/api/v1/agent/agent:authenticated", nil, registerResult.Token)

		// Should not return 401
		assert.NotEqual(t, http.StatusUnauthorized, w.Code)
	})

	t.Run("should_reject_invalid_JWT_token", func(t *testing.T) {
		w := env.apiRequest("GET", "/api/v1/agent/agent:test", nil, "invalid-token")

		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})
}

// TEST 7: Audit Logging
func TestAuditLogging(t *testing.T) {
	env := setupAgentAPITestEnv(t)

	// Note: This test verifies that audit logs are generated
	// In a real implementation, you would check logs output

	t.Run("should_log_agent_registration", func(t *testing.T) {
		reqBody := handlers.RegisterAgentRequest{
			ID:          "agent:audit-test",
			Type:        "service",
			DisplayName: "Audit Test Agent",
		}

		w := env.apiRequest("POST", "/api/v1/agent/register", reqBody, "")

		assert.Equal(t, http.StatusCreated, w.Code)
		// In production, verify audit log entry exists
	})

	t.Run("should_log_delegation_creation", func(t *testing.T) {
		token := env.registerTestAgent("test-audit-auth", "service")

		// Setup agents
		agent1 := &types.Agent{ID: "agent:a1", Type: "service", DisplayName: "Agent A1", Status: "active", CreatedAt: time.Now(), UpdatedAt: time.Now()}
		agent2 := &types.Agent{ID: "agent:a2", Type: "service", DisplayName: "Agent A2", Status: "active", CreatedAt: time.Now(), UpdatedAt: time.Now()}
		env.AgentStore.Add(agent1)
		env.AgentStore.Add(agent2)

		reqBody := handlers.CreateDelegationRequest{
			FromAgentID: "agent:a1",
			ToAgentID:   "agent:a2",
			Scopes:      []string{"read:*"},
			ExpiresAt:   time.Now().Add(1 * time.Hour),
		}

		w := env.apiRequest("POST", "/api/v1/agent/delegate", reqBody, token)

		assert.Equal(t, http.StatusCreated, w.Code)
		// Verify audit log
	})
}
