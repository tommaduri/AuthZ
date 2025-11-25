# Phase 5 Remaining Work - Detailed Implementation Plan

**Date**: November 25, 2025
**Current Status**: TDD RED Phase Complete
**Next Phase**: GREEN Phase Implementation
**Target Completion**: January 19, 2026 (8-10 weeks)

---

## 📋 Table of Contents

1. [Week 1-2: Complete Vector Store](#week-1-2-complete-vector-store)
2. [Week 3: Agent Identity Refinement](#week-3-agent-identity-refinement)
3. [Week 4-5: MCP/A2A REST Endpoints](#week-4-5-mcpa2a-rest-endpoints)
4. [Week 6-7: Avatar Connex Integration](#week-6-7-avatar-connex-integration)
5. [Week 8-9: Integration Testing](#week-8-9-integration-testing)
6. [Week 10: Production Readiness](#week-10-production-readiness)
7. [Parallel Track: Documentation Updates](#parallel-track-documentation-updates)

---

## Week 1-2: Complete Vector Store

**Status**: 95% complete → Target 100%
**Priority**: HIGH
**Dependencies**: None

### Tasks

#### Task 1.1: Fix HNSW Adapter Edge Cases
**File**: `internal/vector/hnsw_adapter.go` (266 LOC)
**Estimated Time**: 2-3 days

**Current Issues**:
1. ID mapping between fogfish/hnsw vectors and backend metadata
   - Current: Linear search through all vectors (O(n))
   - Target: Hash map lookup (O(1))

2. Vector dimension validation
   - Add comprehensive dimension mismatch handling
   - Add unit tests for invalid dimensions

3. Context cancellation support
   - Implement proper context.Context cancellation in Insert/Search
   - Add timeout handling

**Implementation Plan**:
```go
// Add ID-to-vector mapping
type HNSWAdapter struct {
    index       *hnsw.HNSW[[]float32]
    backend     *backends.MemoryBackend
    vectorToID  map[*[]float32]string  // NEW: Fast reverse lookup
    idToVector  map[string]*[]float32  // NEW: Fast forward lookup
    dimension   int
    efSearch    int
    config      vector.HNSWConfig
    mu          sync.RWMutex
}

func (a *HNSWAdapter) Insert(ctx context.Context, id string, vec []float32, metadata map[string]interface{}) error {
    // Add context cancellation check
    select {
    case <-ctx.Done():
        return ctx.Err()
    default:
    }

    // Dimension validation
    if len(vec) != a.dimension {
        return fmt.Errorf("vector dimension mismatch: got %d, expected %d", len(vec), a.dimension)
    }

    // Store with bidirectional mapping
    a.mu.Lock()
    defer a.mu.Unlock()

    vecPtr := &vec
    a.index.Insert(*vecPtr)
    a.vectorToID[vecPtr] = id
    a.idToVector[id] = vecPtr

    return a.backend.Insert(id, vec, metadata)
}

func (a *HNSWAdapter) Search(ctx context.Context, query []float32, k int) ([]*vector.SearchResult, error) {
    // Context cancellation
    select {
    case <-ctx.Done():
        return nil, ctx.Err()
    default:
    }

    neighbors := a.index.Search(query, k, a.efSearch)

    a.mu.RLock()
    defer a.mu.RUnlock()

    results := make([]*vector.SearchResult, 0, len(neighbors))
    for _, neighborVec := range neighbors {
        // O(1) lookup instead of O(n) search
        vecPtr := &neighborVec
        id, ok := a.vectorToID[vecPtr]
        if !ok {
            continue
        }

        score := cosineSimilarity(query, neighborVec)
        distance := euclideanDistance(query, neighborVec)

        results = append(results, &vector.SearchResult{
            ID:       id,
            Score:    score,
            Distance: distance,
            Vector:   neighborVec,
            Metadata: a.backend.Metadata[id],
        })
    }

    return results, nil
}
```

**Tests to Add**:
```go
// File: internal/vector/hnsw_adapter_test.go

func TestHNSWAdapter_DimensionMismatch(t *testing.T)
func TestHNSWAdapter_ContextCancellation(t *testing.T)
func TestHNSWAdapter_ContextTimeout(t *testing.T)
func TestHNSWAdapter_ConcurrentInsertSearch(t *testing.T)
func TestHNSWAdapter_LargeVectorSet(t *testing.T)  // 100K+ vectors
```

#### Task 1.2: Run Performance Benchmarks
**File**: `tests/vector/benchmarks_test.go` (320 LOC)
**Estimated Time**: 1-2 days

**Benchmarks to Execute**:
```bash
cd go-core
go test ./tests/vector/... -bench=. -benchmem -benchtime=10s
```

**Expected Results**:
```
BenchmarkInsert_1D               >100M ops/sec
BenchmarkInsert_384D             >97K ops/sec
BenchmarkInsert_1536D            >50K ops/sec
BenchmarkSearch_10K_vectors      <1ms p50, <5ms p99
BenchmarkSearch_100K_vectors     <2ms p50, <10ms p99
BenchmarkSearch_1M_vectors       <5ms p50, <20ms p99
BenchmarkMemoryUsage_1M_vectors  <800MB
BenchmarkConcurrentInsert        >80K ops/sec (4 workers)
BenchmarkConcurrentSearch        >40K ops/sec (4 workers)
```

**If Performance Targets Not Met**:
1. Profile with pprof:
   ```bash
   go test ./tests/vector/... -bench=BenchmarkInsert -cpuprofile=cpu.prof
   go tool pprof cpu.prof
   ```

2. Optimize hot paths:
   - Check for unnecessary allocations
   - Optimize distance calculations
   - Add batch insert optimization

3. Consider HNSW parameter tuning:
   - Increase M (16 → 24) for better recall
   - Adjust EfConstruction (200 → 300)
   - Adjust EfSearch (50 → 100)

#### Task 1.3: Enable Integration Tests
**Files**: `tests/integration/phase5/vector_analyst_integration_test.go`
**Estimated Time**: 1 day

**Steps**:
1. Remove `.Skip()` statements from 3 vector integration tests
2. Run tests:
   ```bash
   go test ./tests/integration/phase5/... -run TestVectorStore -v
   ```
3. Fix any integration issues discovered

**Expected Test Results**:
```
✅ TestAnalystVectorIntegration - PASS
✅ TestVectorStorePerformance - PASS
✅ TestVectorStoreWithAuthorizationHotPath - PASS
```

---

## Week 3: Agent Identity Refinement

**Status**: 100% complete → Target Production Hardening
**Priority**: MEDIUM
**Dependencies**: None

### Tasks

#### Task 3.1: Add Missing AgentStore Methods
**File**: `internal/agent/store.go` (40 LOC)
**Estimated Time**: 1 day

**Current Issue**: Integration tests reference `RevokeCredential()` method which doesn't exist

**Implementation**:
```go
// File: internal/agent/store.go
type AgentStore interface {
    Register(ctx context.Context, agent *types.Agent) error
    Get(ctx context.Context, id string) (*types.Agent, error)
    UpdateStatus(ctx context.Context, id string, status string) error
    Revoke(ctx context.Context, id string) error
    List(ctx context.Context, filter map[string]interface{}) ([]*types.Agent, error)
    AddCredential(ctx context.Context, agentID string, credential types.Credential) error
    RevokeCredential(ctx context.Context, agentID string, credentialID string) error  // NEW
    GetByCredential(ctx context.Context, credentialID string) (*types.Agent, error)    // NEW
}

// File: internal/agent/memory.go
func (s *InMemoryAgentStore) RevokeCredential(ctx context.Context, agentID string, credentialID string) error {
    s.mu.Lock()
    defer s.mu.Unlock()

    agent, exists := s.agents[agentID]
    if !exists {
        return fmt.Errorf("agent %s not found", agentID)
    }

    for i, cred := range agent.Credentials {
        if cred.ID == credentialID {
            // Remove credential
            agent.Credentials = append(agent.Credentials[:i], agent.Credentials[i+1:]...)
            agent.UpdatedAt = time.Now()
            return nil
        }
    }

    return fmt.Errorf("credential %s not found for agent %s", credentialID, agentID)
}

func (s *InMemoryAgentStore) GetByCredential(ctx context.Context, credentialID string) (*types.Agent, error) {
    s.mu.RLock()
    defer s.mu.RUnlock()

    for _, agent := range s.agents {
        for _, cred := range agent.Credentials {
            if cred.ID == credentialID {
                return agent, nil
            }
        }
    }

    return nil, fmt.Errorf("no agent found with credential %s", credentialID)
}
```

**Tests to Add**:
```go
func TestAgentStore_RevokeCredential(t *testing.T)
func TestAgentStore_GetByCredential(t *testing.T)
func TestAgentStore_RevokeCredential_NotFound(t *testing.T)
```

#### Task 3.2: Credential Encryption
**File**: `internal/agent/encryption.go` (NEW, ~150 LOC)
**Estimated Time**: 2 days

**Implementation**:
```go
package agent

import (
    "crypto/aes"
    "crypto/cipher"
    "crypto/rand"
    "encoding/base64"
    "fmt"
    "io"
)

type CredentialEncryptor interface {
    Encrypt(plaintext string) (string, error)
    Decrypt(ciphertext string) (string, error)
}

type AESEncryptor struct {
    key []byte  // 32 bytes for AES-256
}

func NewAESEncryptor(key []byte) (*AESEncryptor, error) {
    if len(key) != 32 {
        return nil, fmt.Errorf("key must be 32 bytes for AES-256")
    }
    return &AESEncryptor{key: key}, nil
}

func (e *AESEncryptor) Encrypt(plaintext string) (string, error) {
    block, err := aes.NewCipher(e.key)
    if err != nil {
        return "", err
    }

    gcm, err := cipher.NewGCM(block)
    if err != nil {
        return "", err
    }

    nonce := make([]byte, gcm.NonceSize())
    if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
        return "", err
    }

    ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
    return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func (e *AESEncryptor) Decrypt(ciphertext string) (string, error) {
    data, err := base64.StdEncoding.DecodeString(ciphertext)
    if err != nil {
        return "", err
    }

    block, err := aes.NewCipher(e.key)
    if err != nil {
        return "", err
    }

    gcm, err := cipher.NewGCM(block)
    if err != nil {
        return "", err
    }

    nonceSize := gcm.NonceSize()
    if len(data) < nonceSize {
        return "", fmt.Errorf("ciphertext too short")
    }

    nonce, ciphertext := data[:nonceSize], data[nonceSize:]
    plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
    if err != nil {
        return "", err
    }

    return string(plaintext), nil
}
```

**Update AgentStore**:
```go
// File: internal/agent/memory.go
type InMemoryAgentStore struct {
    agents    map[string]*types.Agent
    encryptor CredentialEncryptor
    mu        sync.RWMutex
}

func (s *InMemoryAgentStore) AddCredential(ctx context.Context, agentID string, credential types.Credential) error {
    // Encrypt credential value before storage
    encrypted, err := s.encryptor.Encrypt(credential.Value)
    if err != nil {
        return fmt.Errorf("failed to encrypt credential: %w", err)
    }
    credential.Value = encrypted

    // ... rest of implementation
}
```

---

## Week 4-5: MCP/A2A REST Endpoints

**Status**: 0% → Target 100%
**Priority**: HIGH
**Dependencies**: Agent Identity complete

### Tasks

#### Task 4.1: Implement REST API Handler
**File**: `internal/server/handlers/agent_handler.go` (NEW, ~300 LOC)
**Estimated Time**: 3-4 days

**Endpoints to Implement**:

**1. POST /v1/agent/register**
```go
type RegisterAgentRequest struct {
    ID          string                 `json:"id"`
    Type        string                 `json:"type"`  // "service", "human", "ai-agent"
    DisplayName string                 `json:"display_name"`
    Credentials []types.Credential     `json:"credentials"`
    Metadata    map[string]interface{} `json:"metadata"`
    ExpiresAt   *time.Time             `json:"expires_at,omitempty"`
}

type RegisterAgentResponse struct {
    Agent *types.Agent `json:"agent"`
    Token string       `json:"token"`  // JWT for authentication
}

func (h *AgentHandler) RegisterAgent(c *gin.Context) {
    var req RegisterAgentRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(400, gin.H{"error": err.Error()})
        return
    }

    agent := &types.Agent{
        ID:          req.ID,
        Type:        req.Type,
        DisplayName: req.DisplayName,
        Status:      "active",
        Credentials: req.Credentials,
        Metadata:    req.Metadata,
        CreatedAt:   time.Now(),
        UpdatedAt:   time.Now(),
        ExpiresAt:   req.ExpiresAt,
    }

    if err := h.agentStore.Register(c.Request.Context(), agent); err != nil {
        c.JSON(500, gin.H{"error": err.Error()})
        return
    }

    // Generate JWT token
    token, err := h.generateAgentToken(agent)
    if err != nil {
        c.JSON(500, gin.H{"error": "failed to generate token"})
        return
    }

    c.JSON(201, RegisterAgentResponse{
        Agent: agent,
        Token: token,
    })
}
```

**2. POST /v1/agent/delegate**
```go
type CreateDelegationRequest struct {
    FromAgentID string   `json:"from_agent_id"`
    ToAgentID   string   `json:"to_agent_id"`
    Scopes      []string `json:"scopes"`  // ["read:*", "write:document"]
    MaxHops     int      `json:"max_hops"`
    ExpiresAt   time.Time `json:"expires_at"`
}

type CreateDelegationResponse struct {
    Delegation *types.DelegationChain `json:"delegation"`
}

func (h *AgentHandler) CreateDelegation(c *gin.Context) {
    var req CreateDelegationRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(400, gin.H{"error": err.Error()})
        return
    }

    // Validate agents exist and are active
    fromAgent, err := h.agentStore.Get(c.Request.Context(), req.FromAgentID)
    if err != nil || fromAgent.Status != "active" {
        c.JSON(400, gin.H{"error": "source agent invalid or inactive"})
        return
    }

    toAgent, err := h.agentStore.Get(c.Request.Context(), req.ToAgentID)
    if err != nil || toAgent.Status != "active" {
        c.JSON(400, gin.H{"error": "target agent invalid or inactive"})
        return
    }

    delegation := &types.DelegationChain{
        SourceAgentID: req.FromAgentID,
        TargetAgentID: req.ToAgentID,
        Scopes:        req.Scopes,
        MaxHops:       req.MaxHops,
        ExpiresAt:     req.ExpiresAt,
        CreatedAt:     time.Now(),
    }

    if err := h.delegationStore.Create(c.Request.Context(), delegation); err != nil {
        c.JSON(500, gin.H{"error": err.Error()})
        return
    }

    c.JSON(201, CreateDelegationResponse{Delegation: delegation})
}
```

**3. POST /v1/agent/check**
```go
type AgentCheckRequest struct {
    AgentID         string            `json:"agent_id"`
    DelegationChain []string          `json:"delegation_chain,omitempty"`
    Action          string            `json:"action"`
    Resource        *types.Resource   `json:"resource"`
    Metadata        map[string]interface{} `json:"metadata,omitempty"`
}

type AgentCheckResponse struct {
    Effect          string                 `json:"effect"`  // "allow" or "deny"
    ValidatedChain  *types.DelegationChain `json:"validated_chain,omitempty"`
    Reason          string                 `json:"reason,omitempty"`
}

func (h *AgentHandler) CheckAuthorization(c *gin.Context) {
    var req AgentCheckRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(400, gin.H{"error": err.Error()})
        return
    }

    // If delegation chain provided, validate it first
    var validatedChain *types.DelegationChain
    if len(req.DelegationChain) > 0 {
        chain, err := h.delegationValidator.ValidateChain(c.Request.Context(), req.DelegationChain)
        if err != nil {
            c.JSON(403, AgentCheckResponse{
                Effect: "deny",
                Reason: fmt.Sprintf("delegation chain invalid: %v", err),
            })
            return
        }
        validatedChain = chain
    }

    // Get agent
    agent, err := h.agentStore.Get(c.Request.Context(), req.AgentID)
    if err != nil {
        c.JSON(404, gin.H{"error": "agent not found"})
        return
    }

    // Convert agent to principal
    principal := agent.ToPrincipal()

    // Perform authorization check
    checkReq := &types.CheckRequest{
        Principal: principal,
        Resource:  req.Resource,
        Actions:   []string{req.Action},
        Metadata:  req.Metadata,
    }

    resp, err := h.engine.Check(c.Request.Context(), checkReq)
    if err != nil {
        c.JSON(500, gin.H{"error": err.Error()})
        return
    }

    effect := resp.Results[req.Action].Effect

    c.JSON(200, AgentCheckResponse{
        Effect:         string(effect),
        ValidatedChain: validatedChain,
    })
}
```

**4. GET /v1/agent/:id**
```go
func (h *AgentHandler) GetAgent(c *gin.Context) {
    id := c.Param("id")

    agent, err := h.agentStore.Get(c.Request.Context(), id)
    if err != nil {
        c.JSON(404, gin.H{"error": "agent not found"})
        return
    }

    // Redact sensitive credential values
    for i := range agent.Credentials {
        agent.Credentials[i].Value = "***REDACTED***"
    }

    c.JSON(200, gin.H{"agent": agent})
}
```

**5. DELETE /v1/agent/:id/revoke**
```go
func (h *AgentHandler) RevokeAgent(c *gin.Context) {
    id := c.Param("id")

    if err := h.agentStore.Revoke(c.Request.Context(), id); err != nil {
        c.JSON(500, gin.H{"error": err.Error()})
        return
    }

    c.JSON(200, gin.H{"message": "agent revoked successfully"})
}
```

#### Task 4.2: Integration with DecisionEngine
**File**: `internal/engine/delegation.go` (NEW, ~200 LOC)
**Estimated Time**: 2 days

**Implementation**:
```go
package engine

import (
    "context"
    "fmt"
    "github.com/authz-engine/go-core/internal/delegation"
    "github.com/authz-engine/go-core/pkg/types"
)

// CheckWithDelegation performs authorization check with delegation chain validation
func (e *DecisionEngine) CheckWithDelegation(
    ctx context.Context,
    req *types.CheckRequest,
    chain []string,
) (*types.CheckResponse, error) {
    // Step 1: Validate delegation chain
    if len(chain) > 0 {
        validator := delegation.NewValidator(e.agentStore)

        delegationChain, err := validator.ValidateChain(ctx, chain)
        if err != nil {
            return nil, fmt.Errorf("delegation chain validation failed: %w", err)
        }

        // Validate scopes match requested action:resource
        action := req.Actions[0]
        resourceKind := req.Resource.Kind

        if !delegationChain.ValidateScopes(action, resourceKind) {
            return nil, fmt.Errorf("delegation chain does not grant access to %s:%s", action, resourceKind)
        }

        // Add delegation metadata to request
        if req.Metadata == nil {
            req.Metadata = make(map[string]interface{})
        }
        req.Metadata["delegation_chain"] = chain
        req.Metadata["delegation_source"] = delegationChain.SourceAgentID
    }

    // Step 2: Perform normal authorization check
    return e.Check(ctx, req)
}
```

#### Task 4.3: Security Hardening
**File**: `internal/server/middleware/agent_auth.go` (NEW, ~150 LOC)
**Estimated Time**: 2 days

**Implementation**:
```go
package middleware

import (
    "github.com/gin-gonic/gin"
    "github.com/golang-jwt/jwt/v5"
    "strings"
)

type AgentAuthMiddleware struct {
    jwtSecret []byte
}

func NewAgentAuthMiddleware(secret []byte) *AgentAuthMiddleware {
    return &AgentAuthMiddleware{jwtSecret: secret}
}

func (m *AgentAuthMiddleware) Authenticate() gin.HandlerFunc {
    return func(c *gin.Context) {
        authHeader := c.GetHeader("Authorization")
        if authHeader == "" {
            c.JSON(401, gin.H{"error": "missing authorization header"})
            c.Abort()
            return
        }

        tokenString := strings.TrimPrefix(authHeader, "Bearer ")

        token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
            return m.jwtSecret, nil
        })

        if err != nil || !token.Valid {
            c.JSON(401, gin.H{"error": "invalid token"})
            c.Abort()
            return
        }

        claims := token.Claims.(jwt.MapClaims)
        c.Set("agent_id", claims["agent_id"])
        c.Next()
    }
}
```

**Audit Logging**:
```go
// File: internal/server/middleware/audit_log.go

func AuditLogMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        start := time.Now()

        c.Next()

        latency := time.Since(start)

        log.Printf("[AUDIT] %s %s | Status: %d | Latency: %v | Agent: %v",
            c.Request.Method,
            c.Request.URL.Path,
            c.Writer.Status(),
            latency,
            c.GetString("agent_id"),
        )
    }
}
```

---

## Week 6-7: Avatar Connex Integration

**Status**: 0% → Target 100%
**Priority**: HIGH
**Dependencies**: MCP/A2A REST endpoints complete

### Tasks

#### Task 6.1: Avatar Connex Use Case Testing
**Estimated Time**: 3-4 days

**Use Case 1: 2-Hop Delegation (User → Orchestrator → Worker)**
```go
// Scenario: User delegates to orchestrator agent, which delegates to worker agent

// Step 1: Register user agent
userAgent := RegisterAgent("user:alice", "human")

// Step 2: Register orchestrator agent
orchestratorAgent := RegisterAgent("agent:orchestrator", "ai-agent")

// Step 3: Register worker agent
workerAgent := RegisterAgent("agent:worker", "ai-agent")

// Step 4: Create delegation: user → orchestrator
CreateDelegation("user:alice", "agent:orchestrator", []string{"deploy:*"}, 24*time.Hour)

// Step 5: Create delegation: orchestrator → worker
CreateDelegation("agent:orchestrator", "agent:worker", []string{"deploy:service"}, 1*time.Hour)

// Step 6: Worker performs action with delegation chain
CheckAuthorization(
    agentID: "agent:worker",
    delegationChain: ["user:alice", "agent:orchestrator", "agent:worker"],
    action: "deploy",
    resource: {kind: "service", id: "api-gateway"},
)

// Expected: ALLOW (valid 2-hop delegation)
```

**Use Case 2: 3-Hop Delegation (Avatar Connex Scenario)**
```go
// Scenario: User → Avatar → Orchestrator → Worker

// Register all agents
userAgent := RegisterAgent("user:bob", "human")
avatarAgent := RegisterAgent("agent:avatar-123", "ai-agent")
orchestratorAgent := RegisterAgent("agent:orchestrator", "ai-agent")
workerAgent := RegisterAgent("agent:worker-456", "ai-agent")

// Create delegation chain
CreateDelegation("user:bob", "agent:avatar-123", []string{"*"}, 7*24*time.Hour)
CreateDelegation("agent:avatar-123", "agent:orchestrator", []string{"*:document"}, 24*time.Hour)
CreateDelegation("agent:orchestrator", "agent:worker-456", []string{"write:document"}, 1*time.Hour)

// Worker performs action
CheckAuthorization(
    agentID: "agent:worker-456",
    delegationChain: ["user:bob", "agent:avatar-123", "agent:orchestrator", "agent:worker-456"],
    action: "write",
    resource: {kind: "document", id: "report-2024"},
)

// Expected: ALLOW (valid 3-hop delegation with scope narrowing)
```

#### Task 6.2: Performance Testing
**File**: `tests/integration/phase5/performance_integration_test.go`
**Estimated Time**: 2 days

**Remove skip statements and run**:
```bash
go test ./tests/integration/phase5/ -run TestDelegationValidationPerformance -v
```

**Expected Performance**:
- 1-hop delegation: <10ms p50, <50ms p99
- 3-hop delegation: <50ms p50, <100ms p99
- 5-hop delegation: <80ms p50, <150ms p99

**If Performance Not Met**:
1. Add caching for delegation chain validation
2. Optimize agent lookup (already O(1))
3. Profile with pprof

---

## Week 8-9: Integration Testing

**Status**: 0% → Target 100%
**Priority**: HIGH
**Dependencies**: All Phase 5 features complete

### Tasks

#### Task 8.1: Enable All Integration Tests
**Estimated Time**: 1 day

**Remove skip statements**:
```bash
cd go-core
find tests/integration/phase5/ -name "*.go" -exec sed -i '' 's/t.Skip.*//g' {} \;
```

**Run full suite**:
```bash
go test ./tests/integration/phase5/... -v -timeout=30m
```

**Expected Results**:
```
✅ Agent Identity Integration (5 tests) - PASS
✅ Vector + ANALYST Integration (3 tests) - PASS
✅ MCP/A2A Delegation (4 tests) - PASS
✅ Full System Integration (3 tests) - PASS
✅ Performance Benchmarks (5 tests) - PASS
✅ Regression Tests (5 tests) - PASS

Total: 24/24 tests passing
```

#### Task 8.2: Fix Integration Issues
**Estimated Time**: 2-3 days

**Common Issues and Fixes**:

1. **Import Path Errors**:
   - Already fixed (internal/policy/memory → internal/policy)
   - Verify no new import errors

2. **Missing Interfaces**:
   - Add missing methods to interfaces (e.g., RevokeCredential)
   - Update implementations

3. **Type Mismatches**:
   - Ensure consistent types between packages
   - Update test expectations

#### Task 8.3: Regression Testing
**Estimated Time**: 1-2 days

**Run Phases 1-4 tests**:
```bash
# Phase 1: Basic Authorization
go test ./internal/engine/... -v

# Phase 2: Scope Resolution
go test ./internal/scope/... -v

# Phase 3: Principal Policies
go test ./internal/policy/... -run TestPrincipalPolicy -v

# Phase 4: Derived Roles
go test ./internal/derived/... -v
go test ./tests/integration/phase4/... -v
```

**Expected**: All pre-existing tests still pass (zero regressions)

---

## Week 10: Production Readiness

**Status**: 0% → Target 100%
**Priority**: MEDIUM
**Dependencies**: All testing complete

### Tasks

#### Task 10.1: Final Documentation Updates
**Estimated Time**: 2 days

**Documents to Update**:
1. `README.md` - Add Phase 5 features
2. `docs/API.md` - Document MCP/A2A REST endpoints
3. `docs/DEPLOYMENT.md` - Production deployment guide
4. `docs/PERFORMANCE.md` - Actual benchmarks achieved
5. `docs/CHANGELOG.md` - Phase 5 release notes

#### Task 10.2: Deployment Guides
**File**: `docs/DEPLOYMENT.md` (NEW, ~500 LOC)
**Estimated Time**: 2 days

**Content**:
- Docker deployment
- Kubernetes deployment (Helm chart)
- Configuration options
- Environment variables
- TLS/SSL setup
- Scaling recommendations
- Monitoring and alerting

#### Task 10.3: Performance Tuning
**Estimated Time**: 2 days

**Tasks**:
1. Run production-like load tests
2. Tune HNSW parameters based on actual workload
3. Optimize database connection pooling
4. Add connection limits and timeouts

#### Task 10.4: Production Hardening
**Estimated Time**: 2 days

**Circuit Breakers**:
```go
// File: internal/server/middleware/circuit_breaker.go

type CircuitBreaker struct {
    maxFailures   int
    resetTimeout  time.Duration
    state         string  // "closed", "open", "half-open"
    failureCount  int
    lastFailTime  time.Time
    mu            sync.Mutex
}

func (cb *CircuitBreaker) Execute(fn func() error) error {
    cb.mu.Lock()
    defer cb.mu.Unlock()

    if cb.state == "open" {
        if time.Since(cb.lastFailTime) > cb.resetTimeout {
            cb.state = "half-open"
        } else {
            return fmt.Errorf("circuit breaker open")
        }
    }

    err := fn()

    if err != nil {
        cb.failureCount++
        cb.lastFailTime = time.Now()

        if cb.failureCount >= cb.maxFailures {
            cb.state = "open"
        }
        return err
    }

    // Success - reset
    cb.failureCount = 0
    cb.state = "closed"
    return nil
}
```

**Retry Logic**:
```go
// File: internal/server/middleware/retry.go

func RetryWithBackoff(fn func() error, maxRetries int) error {
    backoff := time.Second

    for i := 0; i < maxRetries; i++ {
        err := fn()
        if err == nil {
            return nil
        }

        if i < maxRetries-1 {
            time.Sleep(backoff)
            backoff *= 2  // Exponential backoff
        }
    }

    return fmt.Errorf("max retries exceeded")
}
```

**Observability**:
```go
// Prometheus metrics
var (
    requestDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name: "authz_request_duration_seconds",
            Help: "Authorization request duration",
        },
        []string{"endpoint"},
    )

    requestsTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "authz_requests_total",
            Help: "Total authorization requests",
        },
        []string{"endpoint", "effect"},
    )
)
```

---

## Parallel Track: Documentation Updates

**Throughout Weeks 1-10**

### Weekly Documentation Tasks

#### Week 1-2:
- Update `GO-VECTOR-STORE-SDD.md` with actual implementation
- Document HNSW adapter edge cases fixed
- Update performance benchmarks with actual results

#### Week 3:
- Update `ADR-012` with credential encryption approach
- Document AgentStore interface additions

#### Week 4-5:
- Create `MCP-A2A-API.md` with REST endpoint documentation
- Update `ADR-011` with actual endpoint implementation

#### Week 6-7:
- Document Avatar Connex use cases
- Create integration guide for external systems

#### Week 8-9:
- Update `PHASE5_FINAL_SUMMARY.md` with GREEN phase completion
- Create `PHASE5_GREEN_PHASE_REPORT.md`

#### Week 10:
- Create production deployment guide
- Finalize all documentation
- Create release notes

---

## 📊 Success Metrics

### Phase 5 Complete When:

**Technical**:
- [  ] All 98+ tests passing (unit + integration + E2E)
- [  ] Performance targets met:
  - [  ] Vector Store: >97K insert/sec, <1ms search p50
  - [  ] Agent Lookup: <1µs O(1)
  - [  ] Delegation: <100ms per check
- [  ] MCP/A2A REST endpoints operational
- [  ] Avatar Connex integration validated
- [  ] Zero regressions in Phases 1-4

**Documentation**:
- [  ] All SDDs updated with actual implementation
- [  ] API documentation complete
- [  ] Deployment guides created
- [  ] Performance benchmarks documented

**Production**:
- [  ] Circuit breakers implemented
- [  ] Retry logic added
- [  ] Observability metrics available
- [  ] Security hardening complete
- [  ] Load testing passed

---

## 🚨 Blockers and Risks

### Potential Blockers:

1. **Vector Store Performance**
   - **Risk**: Performance targets not met
   - **Mitigation**: HNSW parameter tuning, profiling, optimization

2. **Delegation Chain Complexity**
   - **Risk**: Complex chains cause performance issues
   - **Mitigation**: Add caching, limit chain depth to 5

3. **Integration Issues**
   - **Risk**: Components don't integrate smoothly
   - **Mitigation**: Comprehensive integration tests, early testing

### Current Blockers: None ✅

---

## 📞 Support and Escalation

### If Blocked:
1. Check `docs/PHASE5_BLOCKERS.md` for known issues
2. Review relevant ADRs for architecture decisions
3. Consult `docs/PHASE5_QUICK_REFERENCE.md` for daily tips
4. Escalate to Phase 5 architect if stuck >1 day

---

## 🎯 Next Steps

**Immediate (This Week)**:
1. Begin Week 1 tasks (Vector Store completion)
2. Set up benchmarking environment
3. Review HNSW adapter code

**Week 2**:
1. Complete Vector Store testing
2. Run performance benchmarks
3. Document results

**Week 3**:
1. Agent Identity refinement
2. Credential encryption
3. Security hardening

**Week 4+**:
1. Follow 10-week plan
2. Update documentation weekly
3. Run integration tests continuously

---

**Report Generated**: November 25, 2025
**GREEN Phase Target**: 8-10 weeks (January 19, 2026)
**Next Milestone**: Vector Store 100% Complete (December 9, 2024)
