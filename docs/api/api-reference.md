# AuthZ Engine API Reference

**Version**: 1.0.0
**Last Updated**: 2025-11-23
**Full Specification**: [SERVER-PACKAGE-SDD](./sdd/SERVER-PACKAGE-SDD.md)
**Cerbos Compatibility**: [CERBOS-FEATURE-PARITY-SDD](./sdd/CERBOS-FEATURE-PARITY-SDD.md)

Complete API documentation for the Agentic Authorization Engine.

## Table of Contents

1. [API Overview](#api-overview)
2. [REST API Endpoints](#rest-api-endpoints)
3. [Agentic API Endpoints](#agentic-api-endpoints)
4. [Agentic API Extensions](#agentic-api-extensions)
5. [gRPC Service](#grpc-service)
6. [NestJS Integration](#nestjs-integration)
7. [SDK Methods](#sdk-methods)
8. [Error Codes](#error-codes)
9. [Environment Variables](#environment-variables)
10. [Related Documentation](#related-documentation)

---

## API Overview

| Endpoint | Method | Description | SDD Reference |
|----------|--------|-------------|---------------|
| `/api/check` | POST | Check authorization | [SERVER-PACKAGE-SDD](./sdd/SERVER-PACKAGE-SDD.md) |
| `/api/check/resources` | POST | Batch resource check | [SERVER-PACKAGE-SDD](./sdd/SERVER-PACKAGE-SDD.md) |
| `/api/plan/resources` | POST | Query planning | [PLAN-RESOURCES-API-SDD](./sdd/PLAN-RESOURCES-API-SDD.md) |
| `/health` | GET | Health check | [SERVER-PACKAGE-SDD](./sdd/SERVER-PACKAGE-SDD.md) |
| `/api/agents/process` | POST | Agentic processing | [AGENTS-PACKAGE-SDD](./sdd/AGENTS-PACKAGE-SDD.md) |
| `/api/agents/explain` | POST | Get explanation | [AGENTS-PACKAGE-SDD](./sdd/AGENTS-PACKAGE-SDD.md) |

---

## REST API Endpoints

### Base URL

```
http://localhost:3592
```

### Core Authorization

#### POST /v1/check

Check if a principal is allowed to perform actions on a resource.

**Request Body:**
```json
{
  "principal": {
    "id": "user-123",
    "roles": ["fan", "subscriber"],
    "attributes": {
      "subscriptionTier": "premium"
    }
  },
  "resource": {
    "kind": "avatar",
    "id": "avatar-456",
    "attributes": {
      "ownerId": "influencer-789",
      "status": "active"
    }
  },
  "actions": ["view", "interact"]
}
```

**Response:**
```json
{
  "requestId": "req-abc123",
  "results": {
    "view": { "allowed": true, "matchedRule": "view-public-avatars" },
    "interact": { "allowed": true, "matchedRule": "subscriber-interact" }
  },
  "meta": {
    "evaluationTime": 5,
    "policyCount": 3
  }
}
```

#### POST /v1/batch-check

Check multiple resources in a single request.

**Request Body:**
```json
{
  "principal": { "id": "user-123", "roles": ["fan"] },
  "checks": [
    { "resource": { "kind": "avatar", "id": "av-1" }, "actions": ["view"] },
    { "resource": { "kind": "subscription", "id": "sub-1" }, "actions": ["view"] }
  ]
}
```

### Health & Metrics

#### GET /health

Server health check.

**Response:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "policiesLoaded": 7,
  "uptime": 3600
}
```

#### GET /metrics

Prometheus-compatible metrics.

---

## Agentic API Endpoints

The agentic endpoints require `AGENTIC_ENABLED=true` environment variable.

### Agent Health

#### GET /v1/agents/health

Get health status of all agents.

**Response:**
```json
{
  "status": "healthy",
  "agents": {
    "guardian": { "state": "ready", "metrics": { "anomaliesDetected": 42 } },
    "analyst": { "state": "ready", "metrics": { "patternsDiscovered": 8 } },
    "advisor": { "state": "ready", "metrics": { "explanationsGenerated": 156 } },
    "enforcer": { "state": "ready", "metrics": { "actionsExecuted": 12 } }
  },
  "infrastructure": {
    "store": "connected",
    "eventBus": "connected"
  }
}
```

### Anomaly Detection

#### GET /v1/agents/anomalies

List detected anomalies.

**Query Parameters:**
- `principalId` (optional): Filter by principal
- `status` (optional): Filter by status (`open`, `resolved`, `false_positive`)
- `limit` (optional): Max results (default: 100)

**Response:**
```json
{
  "anomalies": [
    {
      "id": "anomaly-123",
      "detectedAt": "2024-01-15T10:30:00Z",
      "type": "velocity_spike",
      "severity": "high",
      "principalId": "user-456",
      "description": "Unusual request velocity detected",
      "score": 0.85,
      "status": "open"
    }
  ],
  "total": 1
}
```

#### GET /v1/agents/anomalies/:id

Get specific anomaly details.

#### POST /v1/agents/anomalies/:id/resolve

Resolve an anomaly.

**Request Body:**
```json
{
  "resolution": "resolved",
  "notes": "Verified as legitimate batch operation"
}
```

### Pattern Discovery

#### GET /v1/agents/patterns

List discovered patterns.

**Query Parameters:**
- `type` (optional): Filter by type (`denial_pattern`, `access_correlation`, `role_cluster`)
- `approved` (optional): Filter by approval status

**Response:**
```json
{
  "patterns": [
    {
      "id": "pattern-789",
      "discoveredAt": "2024-01-14T08:00:00Z",
      "type": "denial_pattern",
      "confidence": 0.92,
      "sampleSize": 150,
      "description": "Subscribers frequently denied premium-content access",
      "suggestedPolicyRule": "...",
      "isApproved": false
    }
  ]
}
```

#### POST /v1/agents/patterns/:id/validate

Approve or reject a pattern.

**Request Body:**
```json
{
  "approved": true,
  "validatedBy": "admin@company.com"
}
```

### LLM Explanations

#### POST /v1/agents/explain

Get an explanation for a decision.

**Request Body:**
```json
{
  "request": {
    "principal": { "id": "user-123", "roles": ["fan"] },
    "resource": { "kind": "premium-content", "id": "content-456" },
    "actions": ["view"]
  },
  "response": {
    "results": { "view": { "allowed": false } }
  }
}
```

**Response:**
```json
{
  "explanation": "Access was denied because the user has a 'fan' role but the resource requires a 'subscriber' or 'premium' role. The premium-content policy explicitly requires subscription-based access.",
  "confidence": 0.95,
  "pathToAllow": [
    "Upgrade user to 'subscriber' role",
    "Add 'premium' attribute to user"
  ]
}
```

#### POST /v1/agents/ask

Ask natural language questions about policies.

**Request Body:**
```json
{
  "question": "Why can't subscribers access archived content?"
}
```

**Response:**
```json
{
  "answer": "Subscribers cannot access archived content because the content-policy requires the 'archive_access' permission, which is only granted to premium tier subscribers or users with explicit archiveAccess attribute set to true.",
  "relatedPolicies": ["content-policy", "subscription-policy"],
  "confidence": 0.88
}
```

### Enforcement Actions

#### GET /v1/agents/enforcements

List pending enforcement actions.

**Response:**
```json
{
  "actions": [
    {
      "id": "action-123",
      "type": "rate_limit",
      "principalId": "user-789",
      "reason": "High anomaly score detected",
      "severity": "high",
      "status": "pending",
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

#### POST /v1/agents/enforcements/:id/approve

Approve a pending action.

**Request Body:**
```json
{
  "approvedBy": "admin@company.com"
}
```

#### POST /v1/agents/enforcements/:id/reject

Reject a pending action.

**Request Body:**
```json
{
  "rejectedBy": "admin@company.com",
  "reason": "False positive - known batch operation"
}
```

#### POST /v1/agents/enforce

Manually trigger an enforcement action.

**Request Body:**
```json
{
  "actionType": "rate_limit",
  "principalId": "user-456",
  "reason": "Manual rate limit for suspicious activity"
}
```

---

## Agentic API Extensions

### POST /api/agents/process

Process a request through all agents (Guardian, Analyst, Advisor, Enforcer).

**Request:**
```json
{
  "principal": { "id": "user-1", "roles": ["user"], "attr": {} },
  "resource": { "kind": "document", "id": "doc-1", "attr": {} },
  "actions": ["view", "edit"]
}
```

**Response:**
```json
{
  "requestId": "req-123",
  "results": {
    "view": { "effect": "EFFECT_ALLOW", "policy": "document-policy" },
    "edit": { "effect": "EFFECT_DENY", "policy": "document-policy" }
  },
  "agentInsights": {
    "guardian": { "riskScore": 0.15, "anomalies": [] },
    "analyst": { "patterns": [], "suggestions": [] },
    "enforcer": { "actions": [] }
  }
}
```

### POST /api/agents/explain

Get natural language explanation for a decision.

**Request:**
```json
{
  "principal": { "id": "user-1", "roles": ["user"] },
  "resource": { "kind": "document", "id": "doc-1" },
  "action": "edit"
}
```

**Response:**
```json
{
  "effect": "EFFECT_DENY",
  "explanation": "User 'user-1' cannot edit document 'doc-1' because the user only has the 'user' role, which does not grant edit permissions on documents. The document-policy requires either the 'editor' role or ownership of the document to perform edit actions.",
  "pathToAllow": [
    "Option 1: Add user to 'editor' role",
    "Option 2: Set user as document owner"
  ]
}
```

---

## gRPC Service

### Service Definition

```protobuf
service AuthzService {
  rpc Check(CheckRequest) returns (CheckResponse);
  rpc BatchCheck(BatchCheckRequest) returns (BatchCheckResponse);
  rpc CheckWithAgents(AgenticCheckRequest) returns (AgenticCheckResponse);
}
```

### Port

```
localhost:3593
```

---

## NestJS Integration

### Module Setup

```typescript
import { AuthzModule } from '@authz-engine/nestjs';

@Module({
  imports: [
    AuthzModule.forRoot({
      serverUrl: 'http://authz-engine:3592',
    }),
  ],
})
export class AppModule {}
```

### Decorators

#### @Authorize

Basic authorization check.

```typescript
@Authorize({ resource: 'avatar', action: 'view' })
@Get(':id')
async getAvatar(@Param('id') id: string) { ... }
```

#### @AuthorizeWithExplanation

Agentic authorization with explanation.

```typescript
@AuthorizeWithExplanation({ resource: 'subscription', action: 'cancel' })
@Post(':id/cancel')
async cancelSubscription(
  @Param('id') id: string,
  @AuthzExplanation() explanation: string
) {
  console.log(`Cancellation authorized: ${explanation}`);
}
```

#### @AnomalyProtected

Add anomaly detection.

```typescript
@AnomalyProtected({ maxAnomalyScore: 0.7, onAnomaly: 'block' })
@Authorize({ resource: 'payment', action: 'create' })
@Post('payment')
async createPayment(@AnomalyScore() score: number) { ... }
```

#### @AuditAction

Log action for analyst learning.

```typescript
@AuditAction({ actionName: 'data_export' })
@Authorize({ resource: 'user', action: 'export' })
@Post('users/:id/export')
async exportUserData(@Param('id') id: string) { ... }
```

### Parameter Decorators

- `@AuthzExplanation()` - Get explanation string
- `@AnomalyScore()` - Get anomaly score (0-1)
- `@AuthzFactors()` - Get decision factors
- `@AuthzConfidence()` - Get confidence score

### Service Methods

```typescript
@Injectable()
export class MyService {
  constructor(private authzService: AuthzService) {}

  async checkAccess() {
    // Standard check
    const result = await this.authzService.check(principal, resource, ['view']);

    // Agentic check with explanation
    const agenticResult = await this.authzService.checkWithAgents(
      principal,
      resource,
      'view',
      { includeExplanation: true, checkAnomalies: true }
    );

    // Ask questions
    const answer = await this.authzService.askQuestion(
      'Why was this user denied access?'
    );

    // Get anomalies
    const anomalies = await this.authzService.getAnomalies(principalId);

    // Approve enforcement action
    await this.authzService.approveAction(actionId, approverPrincipalId);
  }
}
```

---

## SDK Methods

### Installation

```bash
npm install @authz-engine/sdk
```

### Client Creation

```typescript
import { createClient } from '@authz-engine/sdk';

const client = createClient({
  serverUrl: 'http://localhost:3592',
  timeout: 5000,
});
```

### Methods

#### check(principal, resource, actions)

```typescript
const result = await client.check(
  { id: 'user-123', roles: ['fan'] },
  { kind: 'avatar', id: 'avatar-456' },
  ['view', 'interact']
);
// { results: { view: { allowed: true }, interact: { allowed: false } } }
```

#### isAllowed(principal, resource, action)

```typescript
const allowed = await client.isAllowed(principal, resource, 'view');
// true or false
```

#### batchCheck(principal, checks)

```typescript
const results = await client.batchCheck(principal, [
  { resource: { kind: 'avatar', id: 'av-1' }, actions: ['view'] },
  { resource: { kind: 'chat', id: 'chat-1' }, actions: ['send'] },
]);
```

#### healthCheck()

```typescript
const health = await client.healthCheck();
// { healthy: true, policiesLoaded: 7, version: '1.0.0' }
```

---

## Error Codes

| Code | Description |
|------|-------------|
| 400 | Bad Request - Invalid request body or parameters |
| 401 | Unauthorized - Authentication required |
| 403 | Forbidden - Authorization denied |
| 404 | Not Found - Resource or endpoint not found |
| 500 | Internal Server Error - Server-side error |
| 503 | Service Unavailable - Agentic features not enabled |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REST_PORT` | 3592 | REST API port |
| `GRPC_PORT` | 3593 | gRPC port |
| `POLICY_DIR` | ./policies | Policy files directory |
| `AGENTIC_ENABLED` | false | Enable agentic features |
| `ANOMALY_THRESHOLD` | 0.7 | Threshold for anomaly detection |
| `LLM_PROVIDER` | openai | LLM provider (openai, anthropic, local) |
| `LLM_MODEL` | gpt-4 | LLM model name |
| `AUTO_ENFORCE_ENABLED` | false | Enable automatic enforcement |
| `OPENAI_API_KEY` | - | OpenAI API key (for advisor agent) |
| `ANTHROPIC_API_KEY` | - | Anthropic API key (for advisor agent) |

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [SERVER-PACKAGE-SDD](./sdd/SERVER-PACKAGE-SDD.md) | Full server specification |
| [SDK-PACKAGE-SDD](./sdd/SDK-PACKAGE-SDD.md) | TypeScript SDK |
| [NESTJS-PACKAGE-SDD](./sdd/NESTJS-PACKAGE-SDD.md) | NestJS integration |
| [AGENTS-PACKAGE-SDD](./sdd/AGENTS-PACKAGE-SDD.md) | Agentic features |
| [PLAN-RESOURCES-API-SDD](./sdd/PLAN-RESOURCES-API-SDD.md) | Query planning |
| [CERBOS-FEATURE-PARITY-SDD](./sdd/CERBOS-FEATURE-PARITY-SDD.md) | Cerbos compatibility |
| [CORE-PACKAGE-SDD](./sdd/CORE-PACKAGE-SDD.md) | Core engine specification |
| [CEL-INTEGRATION-SDD](./sdd/CEL-INTEGRATION-SDD.md) | CEL expression evaluation |
