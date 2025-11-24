# AuthZ Engine

**Cerbos-Compatible Authorization + AI-Powered Security Agents**

A production-ready authorization engine that combines policy-based access control with intelligent security agents for real-time threat detection, anomaly analysis, and adaptive protection.

## Why AuthZ Engine?

Traditional authorization systems answer: *"Is this user allowed to do this?"*

AuthZ Engine also answers:
- *"Is this access pattern suspicious?"* (Guardian Agent)
- *"What patterns should we learn from?"* (Analyst Agent)
- *"Why was access denied?"* (Advisor Agent)
- *"What action should we take?"* (Enforcer Agent)

## Quick Comparison

| Feature | Cerbos | OPA | AuthZ Engine |
|---------|--------|-----|--------------|
| Policy-based authorization | ✅ | ✅ | ✅ |
| CEL expressions | ✅ | ❌ (Rego) | ✅ |
| Derived roles | ✅ | Manual | ✅ |
| Real-time anomaly detection | ❌ | ❌ | ✅ Guardian |
| Pattern learning | ❌ | ❌ | ✅ Analyst |
| Natural language explanations | ❌ | ❌ | ✅ Advisor |
| Automated threat response | ❌ | ❌ | ✅ Enforcer |
| Threat scoring | ❌ | ❌ | ✅ 0-1 risk scores |
| Velocity/rate anomaly detection | ❌ | ❌ | ✅ |
| Privilege escalation detection | ❌ | ❌ | ✅ |

## Installation

```bash
# npm
npm install @authz-engine/core @authz-engine/agents

# pnpm
pnpm add @authz-engine/core @authz-engine/agents
```

## Quick Start

### Basic Authorization (Cerbos-Compatible)

```typescript
import { DecisionEngine, PolicyParser } from '@authz-engine/core';

const engine = new DecisionEngine();

// Load policies (Cerbos YAML format supported)
const policy = PolicyParser.parse(`
  apiVersion: api.cerbos.dev/v1
  resourcePolicy:
    resource: document
    rules:
      - actions: ["read"]
        effect: EFFECT_ALLOW
        roles: ["viewer", "editor"]
      - actions: ["write", "delete"]
        effect: EFFECT_ALLOW
        roles: ["editor"]
        condition:
          match:
            expr: request.resource.attr.owner == request.principal.id
`);

engine.loadResourcePolicies([policy]);

// Check authorization
const result = engine.check({
  principal: { id: 'user-123', roles: ['editor'], attributes: {} },
  resource: { kind: 'document', id: 'doc-456', attributes: { owner: 'user-123' } },
  actions: ['read', 'write'],
});

console.log(result.results);
// { read: { effect: 'allow' }, write: { effect: 'allow' } }
```

### With Security Agents

```typescript
import { DecisionEngine } from '@authz-engine/core';
import { GuardianAgent, AgentOrchestrator } from '@authz-engine/agents';

// Initialize Guardian for threat detection
const guardian = new GuardianAgent({
  anomalyThreshold: 0.7,
  enableThreatScoring: true,
  threatBlockThreshold: 0.85,
});

await guardian.initialize();

// Analyze request for threats BEFORE authorization
const threatAssessment = await guardian.assessThreat({
  principal: { id: 'user-123', roles: ['editor'], attributes: {} },
  resource: { kind: 'admin:settings', id: 'system-config', attributes: {} },
  actions: ['delete'],
});

if (threatAssessment.shouldBlock) {
  console.log('Request blocked:', threatAssessment.threatLevel);
  console.log('Indicators:', threatAssessment.indicators);
  // { type: 'privilege_escalation', score: 0.7, ... }
  // { type: 'suspicious_action', score: 0.5, ... }
} else {
  // Proceed with normal authorization
  const result = engine.check(request);
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        AuthZ Engine                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────┐ │
│  │   GUARDIAN  │  │   ANALYST   │  │   ADVISOR   │  │ ENFORCER│ │
│  │   Agent     │  │   Agent     │  │   Agent     │  │  Agent  │ │
│  │             │  │             │  │             │  │         │ │
│  │ • Anomaly   │  │ • Pattern   │  │ • LLM       │  │ • Block │ │
│  │   Detection │  │   Learning  │  │   Explain   │  │ • Alert │ │
│  │ • Threat    │  │ • Recommend │  │ • Suggest   │  │ • Audit │ │
│  │   Scoring   │  │   Policies  │  │   Changes   │  │ • Rate  │ │
│  │ • Velocity  │  │ • Baseline  │  │             │  │   Limit │ │
│  │   Tracking  │  │   Compute   │  │             │  │         │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                     Agent Orchestrator                           │
│  • Pipeline execution • Circuit breakers • Metrics • Events     │
├─────────────────────────────────────────────────────────────────┤
│                      Decision Engine                             │
│  • CEL Evaluator • Derived Roles • Policy Matching • Audit Log  │
├─────────────────────────────────────────────────────────────────┤
│                      Transport Layer                             │
│  • REST API • gRPC Server • WebSocket • SSE Fallback            │
└─────────────────────────────────────────────────────────────────┘
```

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| `@authz-engine/core` | CEL evaluator, decision engine, policy parser | ✅ Production |
| `@authz-engine/agents` | Guardian, Analyst, Advisor, Enforcer agents | ✅ Production |
| `@authz-engine/server` | REST + gRPC server | ✅ Production |
| `@authz-engine/sdk` | TypeScript client SDK | ✅ Production |
| `@authz-engine/nestjs` | NestJS module, guards, decorators | ✅ Production |
| `@authz-engine/grpc-client` | gRPC client with pooling, health monitoring | ✅ Production |
| `@authz-engine/neural` | Neural pattern engine for behavioral analysis | 🔨 Beta |
| `@authz-engine/memory` | Distributed memory (vector store, CRDT) | 🔨 Beta |
| `@authz-engine/consensus` | Distributed consensus protocols | 🔨 Beta |
| `@authz-engine/swarm` | Multi-agent orchestration | 🔨 Beta |
| `@authz-engine/platform` | Unified platform orchestrator | 🔨 Beta |
| `@authz-engine/cli` | Policy management CLI | 🔨 Beta |
| `@authz-engine/playground` | Interactive policy simulator | 🔨 Beta |

## Guardian Agent Capabilities

The Guardian agent provides real-time threat assessment with 10 indicator types:

```typescript
type ThreatIndicatorType =
  | 'velocity_anomaly'        // Unusual request rate
  | 'pattern_deviation'       // Actions differ from baseline
  | 'privilege_escalation'    // First access to sensitive resources
  | 'resource_boundary_violation'  // High-risk action on sensitive resource
  | 'suspicious_action'       // Matches suspicious patterns (admin, delete, export)
  | 'derived_role_abuse'      // Elevated roles obtained unexpectedly
  | 'condition_manipulation'  // CEL condition exploitation attempt
  | 'time_based_anomaly'      // Off-hours access
  | 'geographic_anomaly'      // Unusual location (with IP context)
  | 'session_anomaly';        // Session-related issues
```

**Threat Levels:**
- `low` (0.0-0.39): Normal activity
- `medium` (0.4-0.64): Monitor closely
- `high` (0.65-0.84): Require additional verification
- `critical` (0.85-1.0): Block and alert security team

## Use Cases

### 1. Fintech - Payment Authorization
```typescript
// Detect unusual payment patterns
const threat = await guardian.assessThreat({
  principal: { id: 'user-123', roles: ['customer'] },
  resource: { kind: 'payment:transfer', id: 'tx-789' },
  actions: ['execute'],
  context: { amount: 50000, recipient: 'new-account' }
});

// High-value transfer to new recipient = elevated threat score
```

### 2. Healthcare - PHI Access
```typescript
// Monitor access to protected health information
const threat = await guardian.assessThreat({
  principal: { id: 'nurse-456', roles: ['nurse'] },
  resource: { kind: 'patient:record', id: 'patient-789' },
  actions: ['read', 'export'],
});

// Export action on patient records = suspicious pattern match
```

### 3. SaaS - Multi-tenant Isolation
```typescript
// Prevent cross-tenant access
const result = engine.check({
  principal: { id: 'user-123', roles: ['admin'], attributes: { tenant: 'acme' } },
  resource: { kind: 'workspace', id: 'ws-456', attributes: { tenant: 'globex' } },
  actions: ['read'],
});

// Derived role "tenant_member" won't match = deny
```

## NestJS Integration

```typescript
import { Module } from '@nestjs/common';
import { AuthzModule, AuthzGuard, RequirePermission } from '@authz-engine/nestjs';

@Module({
  imports: [
    AuthzModule.forRoot({
      policyPath: './policies',
      enableGuardian: true,
      guardianConfig: {
        anomalyThreshold: 0.7,
        enableThreatScoring: true,
      },
    }),
  ],
})
export class AppModule {}

// In controllers
@Controller('documents')
export class DocumentController {
  @Get(':id')
  @RequirePermission('document', 'read')
  async getDocument(@Param('id') id: string) {
    // Authorization handled by guard
  }

  @Delete(':id')
  @RequirePermission('document', 'delete')
  async deleteDocument(@Param('id') id: string) {
    // Guardian will flag if unusual deletion pattern
  }
}
```

## Configuration

### Environment Variables

```bash
# Server
AUTHZ_PORT=3000
AUTHZ_GRPC_PORT=50051
AUTHZ_POLICY_PATH=./policies

# Guardian Agent
AUTHZ_GUARDIAN_ENABLED=true
AUTHZ_GUARDIAN_ANOMALY_THRESHOLD=0.7
AUTHZ_GUARDIAN_THREAT_BLOCK_THRESHOLD=0.85
AUTHZ_GUARDIAN_VELOCITY_WINDOW_MINUTES=5
AUTHZ_GUARDIAN_MAX_REQUESTS_PER_MINUTE=100

# Telemetry
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
OTEL_SERVICE_NAME=authz-engine
```

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm run build

# Run tests
pnpm test

# Type check
pnpm run typecheck

# Lint
pnpm run lint
```

## Roadmap

- [x] Core decision engine with CEL evaluation
- [x] Cerbos-compatible policy format
- [x] Guardian agent with threat scoring
- [x] Analyst agent with pattern learning
- [x] REST and gRPC servers
- [x] NestJS integration
- [ ] Admin dashboard UI
- [ ] Policy simulation playground
- [ ] Kubernetes operator
- [ ] Cloud-hosted version

## License

MIT

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

**AuthZ Engine** - Authorization that learns, adapts, and protects.
