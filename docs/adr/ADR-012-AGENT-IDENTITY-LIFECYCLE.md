# ADR-012: Agent Identity Lifecycle Architecture

**Status:** Accepted
**Date:** 2024-11-25
**Deciders:** Tech Lead, based on Technical Scope requirements

## Context

The current authorization engine has several architectural gaps regarding agent identity management:

- Current `Principal` type lacks lifecycle management (registration, status tracking, expiration)
- Technical Scope requires dedicated `Agent` type with credentials and status tracking
- MCP/A2A integration needs agent-specific lifecycle operations (register, revoke, rotate credentials)
- Need clean separation between authorization subject (Principal) and lifecycle entity (Agent)
- Authorization decisions should remain fast while agent management can be separate concern

## Decision

Implement a **separate Agent type** (Option B) instead of extending the existing Principal type:

```go
// Principal = Authorization subject (unchanged)
// Used exclusively for authorization decisions
type Principal struct {
    ID         string                 // Maps to Agent.ID
    Roles      []string              // RBAC roles
    Attributes map[string]interface{} // ABAC attributes
    Scope      string                // Authorization scope
}

// Agent = Lifecycle entity (NEW)
// Manages agent identity and credentials
type Agent struct {
    ID          string                 // Unique agent identifier
    Type        string                 // "service", "human", "ai-agent", "mcp-agent"
    DisplayName string                 // Human-readable name
    Status      string                 // "active", "suspended", "revoked", "expired"
    Credentials []Credential           // Authentication credentials (API keys, certs)
    Metadata    map[string]interface{} // Custom metadata
    CreatedAt   time.Time             // Registration timestamp
    UpdatedAt   time.Time             // Last modification timestamp
    ExpiresAt   *time.Time            // Optional expiration (nil = no expiration)
}

// Credential = Authentication credential
type Credential struct {
    ID        string
    Type      string    // "api-key", "oauth-token", "certificate", "ed25519-key"
    Value     string    // Hashed/encrypted credential value
    IssuedAt  time.Time
    ExpiresAt *time.Time
}

// Integration Link: Agent.ID maps to Principal.ID for authorization
```

## Rationale

### Why Separate Agent Type (not extend Principal)

1. **Clean Separation of Concerns**
   - Authorization logic (Principal) remains focused and fast
   - Lifecycle management (Agent) can evolve independently
   - Single Responsibility Principle maintained

2. **Technical Scope Alignment**
   - Matches Technical Scope `Agent` type specification exactly
   - Addresses identified gap in Technical Scope Comparison
   - Enables future MCP/A2A protocol requirements

3. **Future-Proof Architecture**
   - Agent-specific APIs (register, revoke, rotate) don't pollute Principal interface
   - Can add agent features (credential rotation, expiration policies) without touching authorization
   - Supports multiple credential types per agent

4. **Testability**
   - Agent management can be tested independently from authorization
   - Mock agents without affecting authorization tests
   - Clear test boundaries

5. **API Clarity**
   - `AgentService` vs `PrincipalService` with distinct responsibilities
   - RESTful endpoints: `/agents/register`, `/agents/{id}/revoke`
   - Clear API contracts for MCP/A2A integration

## Implementation Timeline

**Phase 5: 2-3 weeks total**

### Week 1: Core Types and Store Interface
- Define `Agent`, `Credential` types in `pkg/types/agent.go`
- Implement `AgentStore` interface in `pkg/store/agent_store.go`
- Add validation logic for agent types and statuses
- **Deliverables:**
  - Agent type definitions
  - AgentStore interface
  - Validation functions

### Week 2: In-Memory Implementation and Lifecycle APIs
- Implement `InMemoryAgentStore` in `pkg/store/memory/agent_store.go`
- Create `AgentService` in `pkg/service/agent_service.go`
- Implement lifecycle operations (register, get, update status, revoke)
- **Deliverables:**
  - In-memory agent store
  - Agent service layer
  - Unit tests (>80% coverage)

### Week 3: REST Endpoints and Integration Tests
- Add agent endpoints in `pkg/api/handlers/agent_handlers.go`
- Integrate with existing authentication middleware
- Create integration tests for agent lifecycle
- **Deliverables:**
  - REST API endpoints
  - Integration tests
  - API documentation

## Architecture

### AgentStore Interface

```go
// pkg/store/agent_store.go
type AgentStore interface {
    // Register creates a new agent with credentials
    Register(ctx context.Context, agent *Agent) error

    // Get retrieves an agent by ID
    Get(ctx context.Context, id string) (*Agent, error)

    // UpdateStatus updates agent status (active, suspended, revoked)
    UpdateStatus(ctx context.Context, id string, status string) error

    // Revoke permanently revokes an agent (sets status to "revoked")
    Revoke(ctx context.Context, id string) error

    // List retrieves agents matching filters
    List(ctx context.Context, filters AgentFilters) ([]*Agent, error)

    // AddCredential adds a new credential to an agent
    AddCredential(ctx context.Context, agentID string, credential Credential) error

    // RevokeCredential revokes a specific credential
    RevokeCredential(ctx context.Context, agentID string, credentialID string) error
}

// AgentFilters supports querying agents
type AgentFilters struct {
    Type   string   // Filter by agent type
    Status string   // Filter by status
    Limit  int      // Pagination limit
    Offset int      // Pagination offset
}
```

### Integration with Authorization

```
┌─────────────────────────────────────────────────────────────┐
│                     Authorization Flow                       │
└─────────────────────────────────────────────────────────────┘

1. API Request with Agent Credentials
   │
   ├──> AuthMiddleware validates credentials (AgentStore.Get)
   │    │
   │    └──> Check agent.Status == "active"
   │         Check credentials not expired
   │
   ├──> Create Principal from Agent.ID
   │    Principal.ID = Agent.ID
   │    Principal.Roles = derived from Agent.Metadata
   │
   └──> DecisionEngine.Evaluate(Principal, Resource, Action)
        │
        └──> Returns Decision (uses Principal, not Agent)

Separation:
- AgentStore: Validates agent exists and is active (authentication)
- Principal: Used for authorization decisions (unchanged)
- DecisionEngine: Remains unchanged (still uses Principal)
```

### API Endpoints

```
POST   /api/v1/agents/register          # Register new agent
GET    /api/v1/agents/{id}               # Get agent details
PUT    /api/v1/agents/{id}/status        # Update agent status
DELETE /api/v1/agents/{id}/revoke        # Revoke agent
GET    /api/v1/agents                    # List agents (with filters)
POST   /api/v1/agents/{id}/credentials   # Add credential
DELETE /api/v1/agents/{id}/credentials/{credId}  # Revoke credential
```

### Example Usage

```go
// Register an MCP agent
agent := &Agent{
    ID:          "mcp-agent-123",
    Type:        "mcp-agent",
    DisplayName: "GitHub MCP Agent",
    Status:      "active",
    Credentials: []Credential{
        {
            ID:        "cred-456",
            Type:      "api-key",
            Value:     hashAPIKey("sk_test_..."),
            IssuedAt:  time.Now(),
            ExpiresAt: nil, // No expiration
        },
    },
    Metadata: map[string]interface{}{
        "mcp_protocol_version": "1.0",
        "capabilities": []string{"github.read", "github.write"},
    },
}

if err := agentStore.Register(ctx, agent); err != nil {
    return err
}

// Later: Authenticate and authorize
agent, err := agentStore.Get(ctx, "mcp-agent-123")
if err != nil || agent.Status != "active" {
    return ErrUnauthorized
}

// Create Principal for authorization
principal := &Principal{
    ID:    agent.ID,
    Roles: []string{"github-agent"},
    Scope: "github.repositories",
}

// Authorization decision (unchanged)
decision, err := engine.Evaluate(ctx, principal, resource, action)
```

## Consequences

### Positive

1. **Clean Architecture**
   - Single responsibility per type (Agent = lifecycle, Principal = authorization)
   - Agent lifecycle operations don't touch authorization hot path
   - Clear boundaries for testing and maintenance

2. **Technical Scope Alignment**
   - Directly addresses Agent Identity gap in Technical Scope Comparison
   - Matches Technical Scope requirements exactly
   - Enables MCP/A2A protocol integration

3. **Future Features Enabled**
   - Easy to add credential rotation policies
   - Support for multiple credentials per agent
   - Agent expiration and automatic revocation
   - Audit trail for agent lifecycle events

4. **API Clarity**
   - RESTful agent management endpoints
   - Clear separation: `/agents/*` for lifecycle, `/evaluate` for authorization
   - Self-documenting API structure

### Negative

1. **Implementation Time**
   - 2-3 weeks vs 1-2 weeks for extending Principal
   - Additional complexity in initial implementation

2. **Storage Overhead**
   - Need to maintain two stores (AgentStore + PolicyStore)
   - Additional indexes for agent queries (by type, status)

3. **API Surface Area**
   - More endpoints to document and maintain
   - Additional integration tests required

### Trade-off Justification

The **1-week implementation delay is justified** to avoid:
- Technical debt from conflating authorization and lifecycle concerns
- Future refactoring when MCP/A2A requirements expand
- Unclear API boundaries and responsibilities

The clean architecture enables:
- Faster authorization decisions (Principal unchanged)
- Independent evolution of agent management features
- Clear integration points for MCP/A2A protocols

## Alternatives Considered

### Option A: Extend Principal Type
```go
type Principal struct {
    ID         string
    Roles      []string
    Attributes map[string]interface{}
    Scope      string
    // NEW fields (rejected)
    Status      string
    Credentials []Credential
    CreatedAt   time.Time
    ExpiresAt   *time.Time
}
```

**Rejected because:**
- Violates Single Responsibility Principle
- Slows down authorization hot path (more fields to marshal/unmarshal)
- Lifecycle operations pollute authorization interface
- Harder to test independently

### Option C: Agent as Metadata in Principal
```go
type Principal struct {
    ID         string
    Roles      []string
    Attributes map[string]interface{}
    Scope      string
    Metadata   map[string]interface{} // Store agent info here
}
```

**Rejected because:**
- Untyped agent data (no compile-time safety)
- No schema validation for agent fields
- Lifecycle operations become generic map manipulations
- Poor API ergonomics

## Related Documents

- [ADR-010: Vector Store Production Strategy](/Users/tommaduri/Documents/GitHub/authz-engine/docs/adr/ADR-010-VECTOR-STORE-PRODUCTION-STRATEGY.md)
- [ADR-011: MCP/A2A Protocol Integration Strategy](/Users/tommaduri/Documents/GitHub/authz-engine/docs/adr/ADR-011-MCP-A2A-PROTOCOL-INTEGRATION.md)
- [Technical Scope Comparison](/Users/tommaduri/Documents/GitHub/authz-engine/docs/specs/TECHNICAL-SCOPE-COMPARISON.md) (Agent Identity gap)
- [Technology Decision Matrix](/Users/tommaduri/Documents/GitHub/authz-engine/docs/specs/TECHNOLOGY-DECISION-MATRIX.md) (Decision 3)
- [Technical Scope v0.1.0](/Users/tommaduri/Documents/GitHub/authz-engine/docs/specs/TECHNICAL-SCOPE-v0.1.0.md)

## Implementation Tracking

**GitHub Issue:** #012 (to be created)
**Target Phase:** Phase 5 (Agent Identity & MCP Integration)
**Priority:** High (blocks MCP/A2A integration)

## Success Criteria

1. ✅ Agent type defined with all required fields
2. ✅ AgentStore interface implemented (in-memory)
3. ✅ REST endpoints for agent lifecycle (register, revoke, status)
4. ✅ Unit tests >80% coverage for agent service
5. ✅ Integration tests for agent-principal integration
6. ✅ API documentation generated
7. ✅ Backward compatibility maintained (Principal unchanged)

## Review and Approval

- **Proposed by:** System Architect
- **Reviewed by:** [Pending]
- **Approved by:** [Pending]
- **Supersedes:** None
- **Superseded by:** None
