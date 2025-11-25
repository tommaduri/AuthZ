# ADR-011: MCP/A2A Protocol Integration Strategy

**Status:** Accepted
**Date:** 2024-11-25
**Deciders:** Tech Lead, based on Technical Scope P0 requirement
**Technical Story:** Avatar Connex agent-to-agent authorization requirements

## Context

The Technical Scope comparison identified MCP/A2A (Model Context Protocol / Agent-to-Agent) as a P0 (MVP) requirement that is currently missing from the authz-engine implementation. This capability is critical for:

1. **Avatar Connex Integration**: Enabling AI agents to authorize actions on behalf of users and other agents
2. **Delegation Chains**: Supporting complex authorization scenarios where Agent A delegates to Agent B, which delegates to Agent C
3. **AI Agent Ecosystems**: Future-proofing for emerging AI agent communication standards
4. **Model Context Protocol**: Aligning with Anthropic's MCP specification for agent interoperability

### Current State
- Authorization engine supports Principal-based policies (users, services)
- No agent identity lifecycle management
- No support for agent-to-agent delegation chains
- No MCP protocol integration

### Requirements
- Agent registration and credential management
- Agent-to-agent authorization checks
- Delegation chain validation (A → B → C)
- MCP/A2A protocol compliance
- Integration with existing policy evaluation engine

## Decision

Implement MCP/A2A protocol support as a **Phase 5 P0 requirement** with the following scope:

### 1. Agent Identity Foundation
- Create `Agent` type separate from `Principal` with distinct lifecycle
- Agent attributes: ID, Type, Status, Credentials, Metadata, CreatedAt, ExpiresAt
- AgentStore implementation with CRUD operations
- Agent registration/revocation endpoints

### 2. MCP/A2A Protocol Implementation
- MCP/A2A authorization check endpoints
- Delegation chain validation logic
- Agent credential verification
- Agent-to-Principal mapping for policy evaluation

### 3. Integration Points
- Map `Agent.ID` to `Principal.ID` for policy evaluation
- Extend PolicyStore to support agent-specific policies
- Add delegation chain metadata to authorization context
- Integration tests with Avatar Connex scenarios

## Implementation Approach

### Phase 5.1: Agent Identity Foundation (Week 1-3)

**Week 1: Core Agent Type**
```typescript
interface Agent {
  id: string;                    // Unique agent identifier
  type: AgentType;               // 'ai-assistant' | 'automation-bot' | 'service-agent'
  status: AgentStatus;           // 'active' | 'suspended' | 'revoked'
  credentials: AgentCredentials; // API keys, certificates, tokens
  metadata: Record<string, any>; // Custom properties
  createdAt: Date;
  expiresAt?: Date;
  revokedAt?: Date;
}

interface AgentCredentials {
  apiKey?: string;
  certificate?: string;
  publicKey?: string;
  issuer: string;
}
```

**Week 2-3: AgentStore Implementation**
- PostgreSQL schema for agent persistence
- CRUD operations (create, read, update, revoke)
- Agent lifecycle state transitions
- Credential rotation support

### Phase 5.2: MCP/A2A Protocol (Week 4-5)

**Week 4: Authorization Endpoints**
```typescript
// POST /v1/agent/register
interface RegisterAgentRequest {
  type: AgentType;
  credentials: AgentCredentials;
  metadata?: Record<string, any>;
  expiresAt?: Date;
}

// POST /v1/agent/check
interface CheckAgentAuthorizationRequest {
  agentId: string;
  action: string;
  resource: Resource;
  delegationChain?: string[]; // [agentA, agentB, agentC]
}

// POST /v1/agent/delegate
interface DelegateAuthorizationRequest {
  fromAgent: string;
  toAgent: string;
  action: string;
  resource: Resource;
  expiresAt?: Date;
}
```

**Week 5: Delegation Chain Validation**
- Chain length limits (max 5 hops)
- Circular delegation detection
- Expiration validation across chain
- Policy evaluation per delegation hop

### Phase 5.3: Integration & Testing (Week 6-7)

**Week 6: Avatar Connex Integration**
- Avatar agent registration flow
- Multi-hop delegation scenarios
- Performance benchmarks (target: <100ms per check)
- Error handling and recovery

**Week 7: End-to-End Testing**
- Unit tests for AgentStore
- Integration tests for MCP/A2A endpoints
- Load testing for delegation chains
- Security validation (credential leakage, replay attacks)

## Architecture

### Component Diagram
```
┌─────────────────────────────────────────────────────────┐
│                   MCP/A2A Layer                         │
├─────────────────────────────────────────────────────────┤
│  Agent Registration  │  Agent Authorization Check       │
│  Delegation Manager  │  Credential Validator            │
└─────────────────┬───────────────────────┬───────────────┘
                  │                       │
                  ▼                       ▼
         ┌────────────────┐      ┌────────────────┐
         │   AgentStore   │      │  PolicyStore   │
         │  (Lifecycle)   │      │ (Authorization)│
         └────────┬───────┘      └────────┬───────┘
                  │                       │
                  └───────────┬───────────┘
                              ▼
                      ┌────────────────┐
                      │   PostgreSQL   │
                      │  (agent, pol)  │
                      └────────────────┘
```

### Data Model
```sql
CREATE TABLE agents (
  id UUID PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  credentials JSONB NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP,
  revoked_at TIMESTAMP,
  INDEX idx_agent_status (status) WHERE status = 'active'
);

CREATE TABLE agent_delegations (
  id UUID PRIMARY KEY,
  from_agent_id UUID REFERENCES agents(id),
  to_agent_id UUID REFERENCES agents(id),
  action VARCHAR(255) NOT NULL,
  resource JSONB NOT NULL,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  INDEX idx_delegation_chain (from_agent_id, to_agent_id)
);
```

### Authorization Flow
1. Agent makes authorization request with delegation chain
2. Validate agent credentials and status
3. For each hop in delegation chain:
   - Verify delegation exists (from_agent → to_agent)
   - Check delegation not expired
   - Validate action/resource match
4. Map final agent ID to Principal ID
5. Evaluate policies using existing engine
6. Return decision (ALLOW/DENY)

## Consequences

### Positive
- **P0 Alignment**: Addresses critical gap in Technical Scope
- **Avatar Connex Ready**: Enables agent-to-agent authorization use cases
- **Clean Separation**: Agent lifecycle independent from authorization logic
- **Future-Proof**: Positions engine for AI agent ecosystem growth
- **Standards-Based**: MCP protocol compliance for interoperability
- **Scalable**: Delegation chain architecture supports complex scenarios

### Negative
- **Timeline Impact**: Adds 3-4 weeks to Phase 5 (total 8-10 weeks vs 4-6 weeks)
- **Complexity Increase**: Delegation chain validation adds ~15-20% code complexity
- **Performance Overhead**: Each delegation hop adds ~10-15ms latency
- **Maintenance Burden**: Need to track MCP spec evolution (Anthropic-controlled)

### Risks & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| MCP spec changes | Medium | High | Abstract MCP layer behind interface, version endpoints |
| Unknown Avatar Connex requirements | Medium | Medium | Early prototype with Avatar team, iterate on feedback |
| Delegation chain performance | Low | Medium | Cache delegation chains, set max depth limit (5 hops) |
| Credential security | Low | High | Hardware security module (HSM) for key storage, audit logging |

## Alternatives Considered

### 1. Simple Service-to-Service (Rejected)
**Approach:** Treat agents as regular service principals, no special agent type.

**Pros:**
- Reuses existing Principal infrastructure
- Faster implementation (2-3 weeks)
- Lower complexity

**Cons:**
- No agent lifecycle management
- No delegation chain support
- Doesn't meet MCP/A2A requirements
- Not aligned with Technical Scope P0

### 2. External Agent Service (Rejected)
**Approach:** Delegate agent management to external service, only do authorization.

**Pros:**
- Smaller scope for authz-engine
- Specialized agent platform handles complexity

**Cons:**
- Creates dependency on external service
- Increased latency for authorization checks
- Doesn't align with self-contained engine architecture
- Higher operational complexity

### 3. Phased MCP Implementation (Considered)
**Approach:** P0 = basic agent auth, P1 = delegation chains, P2 = full MCP compliance.

**Pros:**
- Faster MVP delivery (2-3 weeks for P0)
- Incremental risk reduction

**Cons:**
- Avatar Connex requires delegation chains (P0)
- Technical debt from phased approach
- No significant cost reduction (still ~6-8 weeks total)

## Related Decisions

- **ADR-010**: Vector Store Production Strategy - Agent policies may use embeddings for semantic matching
- **ADR-012**: Agent Identity Lifecycle Architecture - Detailed agent lifecycle design (to be created)
- **Technical Scope Comparison**: Identified MCP/A2A as P0 gap
- **TECHNOLOGY-DECISION-MATRIX.md (Decision 2)**: Agent communication protocol selection

## Implementation Checklist

### Phase 5.1: Agent Identity Foundation
- [ ] Define Agent interface and types
- [ ] Implement AgentStore (PostgreSQL)
- [ ] Create agent CRUD endpoints
- [ ] Add agent credential management
- [ ] Unit tests for agent lifecycle

### Phase 5.2: MCP/A2A Protocol
- [ ] Implement /v1/agent/register endpoint
- [ ] Implement /v1/agent/check endpoint
- [ ] Implement /v1/agent/delegate endpoint
- [ ] Add delegation chain validation logic
- [ ] Create agent-to-principal mapping layer
- [ ] Integration tests for authorization flow

### Phase 5.3: Integration & Testing
- [ ] Avatar Connex prototype integration
- [ ] End-to-end delegation chain tests
- [ ] Performance benchmarks (target: <100ms)
- [ ] Security audit (credentials, replay attacks)
- [ ] Documentation (MCP/A2A API guide)
- [ ] Production deployment runbook

## References

1. **MCP Specification**: https://github.com/anthropics/mcp (Model Context Protocol)
2. **Avatar Connex Requirements**: Internal design doc (to be linked)
3. **Technical Scope Comparison**: `/docs/TECHNICAL-SCOPE-COMPARISON.md`
4. **OAuth 2.0 Token Exchange (RFC 8693)**: Similar delegation patterns
5. **OpenFGA Agent Relationships**: Inspiration for agent policy modeling

## Notes

- **MCP Spec Tracking**: Need to monitor Anthropic's MCP repository for breaking changes
- **Performance Target**: <100ms per authorization check (including delegation chain validation)
- **Security Considerations**: Agent credentials must be stored encrypted, rotated regularly
- **Backward Compatibility**: Existing Principal-based authorization unaffected by agent additions

---

**Approval Required From:**
- Tech Lead (Architecture)
- Avatar Connex Team (Requirements validation)
- Security Team (Credential management review)

**Target Review Date:** 2024-12-02
**Expected Implementation Start:** Phase 5 (after Phase 4 completion)
