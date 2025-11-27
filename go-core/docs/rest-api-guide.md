# REST API Guide

## Quick Start

### Starting the Server

```bash
# Build the server
go build -o authz-server ./cmd/authz-server

# Start with defaults (gRPC: 50051, REST: 8081, Health: 8080)
./authz-server

# Start with custom ports
./authz-server --rest-port 9000 --grpc-port 50051 --http-port 8080

# Disable REST API
./authz-server --enable-rest=false
```

### Test the API

```bash
# Health check
curl http://localhost:8081/health

# Authorization check
curl -X POST http://localhost:8081/v1/authorization/check \
  -H "Content-Type: application/json" \
  -d '{
    "principal": {
      "id": "user123",
      "roles": ["viewer"]
    },
    "resource": {
      "kind": "document",
      "id": "doc456"
    },
    "action": "read"
  }'
```

## Authorization Endpoints

### Single Authorization Check

**Endpoint:** `POST /v1/authorization/check`

**Request Body:**
```json
{
  "principal": {
    "id": "user123",
    "roles": ["developer", "viewer"],
    "attributes": {
      "department": "engineering",
      "level": 5
    },
    "scope": "acme.corp.engineering"
  },
  "resource": {
    "kind": "document",
    "id": "doc456",
    "attributes": {
      "owner": "user123",
      "confidentiality": "internal"
    },
    "scope": "acme.corp.engineering"
  },
  "action": "read",
  "context": {
    "ip": "192.168.1.1",
    "time": "2025-11-27T10:00:00Z"
  }
}
```

**Response (200 OK):**
```json
{
  "allowed": true,
  "effect": "allow",
  "policy": "document-policy",
  "rule": "allow-read-viewer",
  "metadata": {
    "evaluation_duration_ms": 2.5,
    "policies_evaluated": 3,
    "cache_hit": false,
    "timestamp": "2025-11-27T10:00:01Z",
    "request_id": "123e4567-e89b-12d3-a456-426614174000",
    "scope_resolution": {
      "matched_scope": "acme.corp.engineering",
      "inheritance_chain": ["acme.corp.engineering", "acme.corp", "acme"],
      "scoped_policy_matched": true
    },
    "policy_resolution": {
      "principal_policies_matched": false,
      "resource_policies_matched": true,
      "evaluation_order": ["resource-scoped"]
    },
    "derived_roles": ["power-user"]
  }
}
```

**Response (403 Forbidden):**
```json
{
  "allowed": false,
  "effect": "deny",
  "policy": "document-policy",
  "rule": "deny-delete-all"
}
```

**Error Response (400 Bad Request):**
```json
{
  "error": "principal.id is required",
  "message": "principal.id is required",
  "details": null
}
```

### Batch Authorization Check

**Endpoint:** `POST /v1/authorization/check-resources`

Check multiple resources in a single request.

**Request Body:**
```json
{
  "principal": {
    "id": "user123",
    "roles": ["editor"]
  },
  "resources": [
    {
      "resource": {
        "kind": "document",
        "id": "doc1"
      },
      "action": "read"
    },
    {
      "resource": {
        "kind": "document",
        "id": "doc2"
      },
      "action": "write"
    },
    {
      "resource": {
        "kind": "document",
        "id": "doc3"
      },
      "action": "delete"
    }
  ],
  "context": {}
}
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "allowed": true,
      "effect": "allow",
      "policy": "document-policy",
      "rule": "allow-read"
    },
    {
      "allowed": true,
      "effect": "allow",
      "policy": "document-policy",
      "rule": "allow-write"
    },
    {
      "allowed": false,
      "effect": "deny"
    }
  ],
  "metadata": {
    "evaluation_duration_ms": 12.3,
    "policies_evaluated": 3,
    "timestamp": "2025-11-27T10:00:02Z"
  }
}
```

### Get Allowed Actions

**Endpoint:** `GET /v1/authorization/allowed-actions`

Get all actions allowed for a principal on a resource.

**Query Parameters:**
- `principal.id` (required) - Principal identifier
- `principal.roles` (optional) - Comma-separated roles
- `resource.kind` (required) - Resource kind
- `resource.id` (required) - Resource identifier
- `principal.attr.*` (optional) - Principal attributes
- `resource.attr.*` (optional) - Resource attributes

**Example:**
```bash
curl "http://localhost:8081/v1/authorization/allowed-actions?\
principal.id=user123&\
principal.roles=editor,viewer&\
resource.kind=document&\
resource.id=doc456&\
principal.attr.department=engineering&\
resource.attr.owner=user123"
```

**Response (200 OK):**
```json
{
  "actions": ["read", "write", "update", "view", "edit"],
  "metadata": {
    "evaluation_duration_ms": 25.7,
    "policies_evaluated": 7,
    "timestamp": "2025-11-27T10:00:03Z"
  }
}
```

## Policy Management

### List Policies

**Endpoint:** `GET /v1/policies`

**Query Parameters:**
- `limit` (optional, default: 50, max: 1000) - Number of results
- `offset` (optional, default: 0) - Pagination offset
- `kind` (optional) - Filter by kind: "resource" or "principal"
- `scope` (optional) - Filter by scope

**Example:**
```bash
curl "http://localhost:8081/v1/policies?limit=10&offset=0&kind=resource"
```

**Response (200 OK):**
```json
{
  "policies": [
    {
      "id": "policy-1",
      "apiVersion": "api.agsiri.dev/v1",
      "name": "policy-1",
      "resourceKind": "document",
      "rules": [
        {
          "name": "allow-read",
          "actions": ["read"],
          "effect": "allow",
          "roles": ["viewer"]
        }
      ],
      "scope": "acme.corp",
      "created_at": "2025-11-27T08:00:00Z",
      "updated_at": "2025-11-27T08:00:00Z"
    }
  ],
  "total": 150,
  "offset": 0,
  "limit": 10,
  "next_offset": 10
}
```

### Get Policy

**Endpoint:** `GET /v1/policies/{id}`

**Example:**
```bash
curl http://localhost:8081/v1/policies/document-policy
```

**Response (200 OK):**
```json
{
  "id": "document-policy",
  "apiVersion": "api.agsiri.dev/v1",
  "name": "document-policy",
  "resourceKind": "document",
  "rules": [...],
  "created_at": "2025-11-27T08:00:00Z",
  "updated_at": "2025-11-27T08:00:00Z"
}
```

**Response (404 Not Found):**
```json
{
  "error": "Policy not found",
  "details": {
    "policy_id": "non-existent"
  }
}
```

### Create Policy

**Endpoint:** `POST /v1/policies`

**Request Body:**
```json
{
  "apiVersion": "api.agsiri.dev/v1",
  "name": "new-document-policy",
  "resourceKind": "document",
  "rules": [
    {
      "name": "allow-read-viewer",
      "actions": ["read"],
      "effect": "allow",
      "roles": ["viewer", "editor"],
      "condition": "resource.attr.confidentiality != 'secret'"
    },
    {
      "name": "allow-write-editor",
      "actions": ["write", "update"],
      "effect": "allow",
      "roles": ["editor"],
      "condition": "resource.attr.owner == principal.id || 'admin' in principal.roles"
    },
    {
      "name": "deny-delete",
      "actions": ["delete"],
      "effect": "deny"
    }
  ],
  "scope": "acme.corp.engineering"
}
```

**Response (201 Created):**
```json
{
  "id": "new-document-policy",
  "apiVersion": "api.agsiri.dev/v1",
  "name": "new-document-policy",
  ...
}
```

**Response (409 Conflict):**
```json
{
  "error": "Policy already exists",
  "details": {
    "policy_id": "new-document-policy"
  }
}
```

### Update Policy

**Endpoint:** `PUT /v1/policies/{id}`

**Request Body:** Same as create policy

**Response (200 OK):** Updated policy

**Response (404 Not Found):** Policy not found

### Delete Policy

**Endpoint:** `DELETE /v1/policies/{id}`

**Response (204 No Content):** Policy deleted

**Response (404 Not Found):** Policy not found

## Principal Management

### Get Principal

**Endpoint:** `GET /v1/principals/{id}`

**Response (200 OK):**
```json
{
  "id": "user123",
  "roles": ["developer", "viewer"],
  "attributes": {
    "department": "engineering",
    "level": 5
  },
  "scope": "acme.corp.engineering",
  "created_at": "2025-11-27T08:00:00Z",
  "updated_at": "2025-11-27T08:00:00Z"
}
```

### Create Principal

**Endpoint:** `POST /v1/principals`

**Request Body:**
```json
{
  "id": "user456",
  "roles": ["developer"],
  "attributes": {
    "department": "engineering",
    "team": "backend"
  },
  "scope": "acme.corp.engineering"
}
```

**Response (201 Created):** Created principal

### Update Principal

**Endpoint:** `PUT /v1/principals/{id}`

**Request Body:** Same as create principal

**Response (200 OK):** Updated principal

## Health & Status

### Health Check

**Endpoint:** `GET /health`

**Response (200 OK):**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-27T10:00:00Z",
  "checks": {
    "engine": "ok",
    "policy_store": "ok",
    "cache": "ok"
  }
}
```

### Service Status

**Endpoint:** `GET /v1/status`

**Response (200 OK):**
```json
{
  "version": "1.0.0",
  "uptime": "2h34m12s",
  "cache_enabled": true,
  "cache_stats": {
    "hits": 12345,
    "misses": 234,
    "evictions": 12,
    "size": 5000
  },
  "timestamp": "2025-11-27T10:00:00Z"
}
```

## Authentication

### JWT Authentication

The REST API supports JWT authentication via the Authorization header.

**Request Header:**
```
Authorization: Bearer <jwt-token>
```

**Enable Authentication:**
```go
cfg := rest.Config{
    EnableAuth: true,
    Authenticator: middleware.NewAuthenticator(jwtValidator, skipPaths),
}
```

**Unauthenticated Response (401 Unauthorized):**
```json
{
  "error": "Unauthorized: invalid token"
}
```

## CORS

CORS is enabled by default and can be configured:

```bash
# Enable CORS (default)
./authz-server --enable-cors=true

# Disable CORS
./authz-server --enable-cors=false
```

**CORS Headers:**
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization`
- `Access-Control-Max-Age: 3600`

## Error Handling

All errors return a consistent format:

```json
{
  "error": "Error message",
  "message": "Detailed error message",
  "details": {
    "field": "value"
  },
  "code": "ERROR_CODE"
}
```

### HTTP Status Codes

- `200 OK` - Request successful
- `201 Created` - Resource created
- `204 No Content` - Resource deleted
- `400 Bad Request` - Invalid request
- `401 Unauthorized` - Missing or invalid authentication
- `403 Forbidden` - Authorization denied
- `404 Not Found` - Resource not found
- `409 Conflict` - Resource already exists
- `500 Internal Server Error` - Server error

## Performance

### Targets
- Authorization check: <100ms
- Policy CRUD: <100ms
- Batch operations: <100ms per resource

### Optimization Features
- Decision caching (configurable TTL)
- Connection pooling
- Parallel policy evaluation
- Efficient JSON marshaling

### Performance Metrics in Response
Every response includes performance metadata:
```json
{
  "metadata": {
    "evaluation_duration_ms": 2.5,
    "policies_evaluated": 3,
    "cache_hit": false
  }
}
```

## Client Libraries

### Go
```go
import "net/http"

client := &http.Client{}
req, _ := http.NewRequest("POST", "http://localhost:8081/v1/authorization/check", body)
req.Header.Set("Content-Type", "application/json")
resp, _ := client.Do(req)
```

### JavaScript/Node.js
```javascript
fetch('http://localhost:8081/v1/authorization/check', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(checkRequest)
})
```

### Python
```python
import requests

response = requests.post(
    'http://localhost:8081/v1/authorization/check',
    json=check_request
)
```

### curl
```bash
curl -X POST http://localhost:8081/v1/authorization/check \
  -H "Content-Type: application/json" \
  -d @request.json
```

## Examples

See `/Users/tommaduri/Documents/GitHub/authz-engine/go-core/examples/rest-api-example.go` for a complete working example.

## Troubleshooting

### Server not starting
```bash
# Check if port is already in use
lsof -i :8081

# Try different port
./authz-server --rest-port 9000
```

### 401 Unauthorized
- Check JWT token is valid
- Ensure Authorization header is present
- Verify token hasn't expired

### 403 Forbidden
- Check policy rules allow the action
- Verify principal has required roles
- Review policy conditions

### 404 Not Found
- Verify resource ID is correct
- Check policy exists in store
- Ensure endpoint path is correct

### 500 Internal Server Error
- Check server logs
- Verify policy store is accessible
- Ensure engine is properly initialized

## Monitoring

### Logging
All requests are logged with:
- Method and path
- Status code
- Duration
- Remote address

### Metrics
Cache statistics available via `/v1/status`:
- Hits
- Misses
- Evictions
- Current size

## Migration from gRPC

### Mapping

| gRPC Method | REST Endpoint |
|-------------|---------------|
| Check() | POST /v1/authorization/check |
| CheckBatch() | POST /v1/authorization/check-resources |
| ListPolicies() | GET /v1/policies |
| GetPolicy() | GET /v1/policies/{id} |
| CreatePolicy() | POST /v1/policies |
| UpdatePolicy() | PUT /v1/policies/{id} |
| DeletePolicy() | DELETE /v1/policies/{id} |

### Differences
- REST uses JSON instead of protobuf
- HTTP status codes instead of gRPC status
- Query parameters for GET requests
- Standard HTTP headers

### Running Both
The server runs both gRPC and REST simultaneously:
- gRPC: Port 50051 (default)
- REST: Port 8081 (default)
- Shared engine and cache
- Consistent authorization logic
