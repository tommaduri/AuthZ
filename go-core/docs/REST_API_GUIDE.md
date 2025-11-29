# Authorization Engine REST API Guide

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [Authentication](#authentication)
4. [Authorization Checks](#authorization-checks)
5. [Policy Management](#policy-management)
6. [Principal Management](#principal-management)
7. [Export and Import](#export-and-import)
8. [Backup and Restore](#backup-and-restore)
9. [Error Handling](#error-handling)
10. [Rate Limiting](#rate-limiting)
11. [Best Practices](#best-practices)
12. [Advanced Topics](#advanced-topics)

---

## Introduction

The Authorization Engine REST API provides a comprehensive interface for managing authorization policies, principals, and performing access control checks. This guide covers all aspects of using the API, from basic authorization checks to advanced policy management and backup/restore operations.

### Key Features

- **Policy-Based Access Control (PBAC)**: Define flexible authorization policies
- **Resource and Principal Policies**: Support for both resource-centric and principal-centric policies
- **Derived Roles**: Create dynamic roles based on conditions
- **Batch Operations**: Check authorization for multiple resources efficiently
- **Export/Import**: Migrate policies between environments
- **Backup/Restore**: Create point-in-time backups and restore data
- **RESTful Design**: Standard HTTP methods and status codes
- **JWT Authentication**: Secure token-based authentication
- **Rate Limiting**: Protect against abuse with configurable limits

### API Versioning

The API is versioned using the URL path. The current version is `v1`, and all endpoints are prefixed with `/v1`.

**Base URLs:**
- Production: `https://api.authz-engine.example.com/v1`
- Staging: `https://staging-api.authz-engine.example.com/v1`
- Local: `http://localhost:8083/v1`

---

## Getting Started

### Prerequisites

1. **API Access**: You need an API key or OAuth2 credentials to authenticate
2. **JWT Token**: Generate a JWT token using your credentials
3. **HTTP Client**: Use curl, Postman, or any HTTP client library

### Quick Start Example

```bash
# 1. Obtain JWT token (replace with your credentials)
export JWT_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# 2. Check API health
curl -X GET http://localhost:8082/health

# 3. Perform an authorization check
curl -X POST http://localhost:8083/v1/authorization/check \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "principal": {
      "id": "user123",
      "roles": ["developer"]
    },
    "action": "read",
    "resource": {
      "kind": "document",
      "id": "doc456"
    }
  }'
```

### Response Format

All API responses follow a consistent JSON format:

**Success Response:**
```json
{
  "data": { ... },
  "metadata": {
    "request_id": "abc123",
    "timestamp": "2025-01-27T10:30:00Z"
  }
}
```

**Error Response:**
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": { ... },
    "trace_id": "xyz789"
  }
}
```

---

## Authentication

### JWT Bearer Token

All API endpoints (except `/health`) require authentication using JWT Bearer tokens.

#### Token Format

```
Authorization: Bearer <jwt-token>
```

#### Obtaining a Token

⚠️ **Token Issuance Coming Soon**: Authentication endpoints are currently under development.

**Current Workarounds**:
1. **Use External OAuth2 Provider**: Auth0, Okta, Keycloak, etc.
2. **Generate JWT Manually**: Use a JWT library to create tokens with proper claims
3. **Disable Authentication**: Set `AUTHZ_ENABLE_AUTH=false` for development only

**Planned Endpoints** (not yet implemented):

```bash
# Method 1: Username/Password Authentication (COMING SOON)
curl -X POST http://localhost:8083/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{
    "username": "user@example.com",
    "password": "your-password",
    "tenant_id": "acme-corp"
  }'

# Method 2: API Key Exchange (COMING SOON)
curl -X POST http://localhost:8083/v1/auth/token \
  -H "X-API-Key: YOUR_API_KEY"

# Method 3: Refresh Token (COMING SOON)
curl -X POST http://localhost:8083/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "your-refresh-token"
  }'
```

**Expected Response Format** (when implemented):
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "refresh-token-here"
}
```

#### Token Claims

Your JWT token should include the following claims:

```json
{
  "sub": "user123",
  "iss": "authz-engine",
  "aud": "api.authz-engine.example.com",
  "exp": 1706356800,
  "iat": 1706353200,
  "roles": ["api_user"],
  "permissions": ["read:policies", "write:policies", "check:authorization"]
}
```

#### Token Validation

The API validates:
- Token signature
- Expiration time (`exp`)
- Issuer (`iss`)
- Audience (`aud`)
- Required permissions

#### Token Refresh

Tokens expire after 1 hour by default. Refresh your token before expiration:

```bash
curl -X POST https://auth.authz-engine.example.com/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=YOUR_REFRESH_TOKEN" \
  -d "client_id=YOUR_CLIENT_ID"
```

### Security Best Practices

1. **Never commit tokens**: Store tokens in environment variables or secure vaults
2. **Use HTTPS**: Always use HTTPS in production
3. **Rotate tokens**: Implement automatic token rotation
4. **Scope tokens**: Request only necessary permissions
5. **Monitor usage**: Track token usage and detect anomalies

---

## Authorization Checks

### Basic Authorization Check

Check if a principal can perform an action on a resource.

**Endpoint:** `POST /v1/authorization/check`

**Request:**
```json
{
  "principal": {
    "id": "user123",
    "roles": ["developer"]
  },
  "action": "read",
  "resource": {
    "kind": "document",
    "id": "doc456"
  }
}
```

**Response:**
```json
{
  "allowed": true,
  "decision_time_ms": 5,
  "matched_policies": ["policy-dev-read-docs"]
}
```

**curl Example:**
```bash
curl -X POST http://localhost:8083/v1/authorization/check \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "principal": {
      "id": "user123",
      "roles": ["developer"]
    },
    "action": "read",
    "resource": {
      "kind": "document",
      "id": "doc456"
    }
  }'
```

### Authorization Check with Attributes

Include principal and resource attributes for condition-based policies.

**Request:**
```json
{
  "principal": {
    "id": "user123",
    "roles": ["developer"],
    "attributes": {
      "department": "engineering",
      "level": "senior",
      "location": "US"
    }
  },
  "action": "write",
  "resource": {
    "kind": "repository",
    "id": "repo789",
    "attributes": {
      "visibility": "private",
      "team": "backend"
    }
  }
}
```

**Response:**
```json
{
  "allowed": true,
  "decision_time_ms": 8,
  "matched_policies": ["policy-senior-dev-write"]
}
```

### Authorization Check with Context

Add request context for time-based or IP-based policies.

**Request:**
```json
{
  "principal": {
    "id": "user123",
    "roles": ["developer"]
  },
  "action": "deploy",
  "resource": {
    "kind": "application",
    "id": "app001"
  },
  "context": {
    "ip_address": "192.168.1.100",
    "time": "2025-01-27T10:30:00Z",
    "environment": "production",
    "request_method": "POST"
  }
}
```

### Batch Authorization Checks

Check authorization for multiple resources in a single request.

**Endpoint:** `POST /v1/authorization/check-resources`

**Request:**
```json
{
  "principal": {
    "id": "user123",
    "roles": ["developer"]
  },
  "action": "read",
  "resources": [
    {
      "kind": "document",
      "id": "doc456"
    },
    {
      "kind": "document",
      "id": "doc789"
    },
    {
      "kind": "repository",
      "id": "repo123"
    }
  ]
}
```

**Response:**
```json
{
  "results": [
    {
      "resource": {
        "kind": "document",
        "id": "doc456"
      },
      "allowed": true,
      "decision_time_ms": 3
    },
    {
      "resource": {
        "kind": "document",
        "id": "doc789"
      },
      "allowed": false,
      "decision_time_ms": 2,
      "reason": "No matching policy"
    },
    {
      "resource": {
        "kind": "repository",
        "id": "repo123"
      },
      "allowed": true,
      "decision_time_ms": 4
    }
  ],
  "total_time_ms": 9
}
```

**Benefits:**
- **Performance**: Single round-trip for multiple checks
- **Efficiency**: Reduced network overhead
- **Atomicity**: All checks use the same policy snapshot

**Limits:**
- Maximum 100 resources per request
- Timeout: 30 seconds

### Get Allowed Actions

Discover which actions a principal can perform on a resource.

**Endpoint:** `GET /v1/authorization/allowed-actions`

**Query Parameters:**
- `principal_id` (required): Principal identifier
- `resource_kind` (required): Resource kind
- `resource_id` (required): Resource identifier
- `roles` (optional): Principal roles (comma-separated)

**Example:**
```bash
curl -X GET "http://localhost:8083/v1/authorization/allowed-actions?\
principal_id=user123&\
resource_kind=document&\
resource_id=doc456&\
roles=developer,team-lead" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Response:**
```json
{
  "allowed_actions": ["read", "write", "comment"],
  "denied_actions": ["delete", "share"],
  "decision_time_ms": 8
}
```

**Use Cases:**
- **UI Rendering**: Show/hide buttons based on permissions
- **API Optimization**: Reduce authorization check calls
- **Permission Discovery**: Help users understand their access

### Authorization Decision Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     Authorization Check                     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  1. Validate Request (principal, action, resource)          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  2. Load Applicable Policies                                │
│     - Resource Policies (by resource kind)                  │
│     - Principal Policies (by principal ID/roles)            │
│     - Derived Roles (evaluate conditions)                   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  3. Evaluate Policy Rules                                   │
│     - Check roles/derived roles                             │
│     - Evaluate conditions (CEL expressions)                 │
│     - Match actions                                         │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  4. Apply Effect                                            │
│     - DENY takes precedence over ALLOW                      │
│     - No match = DENY (default-deny)                        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  5. Return Decision + Metadata                              │
│     - allowed: true/false                                   │
│     - matched_policies: [...]                               │
│     - reason: "..." (if denied)                             │
│     - decision_time_ms: X                                   │
└─────────────────────────────────────────────────────────────┘
```

### Performance Optimization

**Caching:**
The engine caches policy evaluation results. Include cache headers:

```bash
curl -X POST http://localhost:8083/v1/authorization/check \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Cache-Control: max-age=60" \
  -d '...'
```

**Batch Requests:**
Use batch checks instead of multiple single checks:
- ✅ 1 batch request with 50 resources: ~50ms
- ❌ 50 individual requests: ~500-1000ms

**Connection Reuse:**
Use HTTP keep-alive to reuse connections:
```bash
curl --keepalive-time 60 ...
```

---

## Policy Management

### Policy Types

#### 1. Resource Policies

Resource policies define what actions can be performed on a specific resource kind.

**Example:**
```json
{
  "id": "policy-dev-read-docs",
  "version": "1.0",
  "description": "Developers can read documentation",
  "resource_policy": {
    "resource": "document",
    "version": "1.0",
    "rules": [
      {
        "actions": ["read", "list"],
        "effect": "EFFECT_ALLOW",
        "roles": ["developer"]
      }
    ]
  }
}
```

#### 2. Principal Policies

Principal policies define what a specific principal (user or role) can do.

**Example:**
```json
{
  "id": "policy-admin-all",
  "version": "1.0",
  "description": "Admin has full access",
  "principal_policy": {
    "principal": "role:admin",
    "version": "1.0",
    "rules": [
      {
        "resource": "*",
        "actions": [
          {
            "name": "*",
            "effect": "EFFECT_ALLOW"
          }
        ]
      }
    ]
  }
}
```

#### 3. Derived Roles

Derived roles are dynamic roles assigned based on conditions.

**Example:**
```json
{
  "id": "derived-role-senior-dev",
  "version": "1.0",
  "description": "Senior developer derived role",
  "derived_roles": {
    "name": "senior_roles",
    "definitions": [
      {
        "name": "senior_developer",
        "parent_roles": ["developer"],
        "condition": {
          "match": {
            "expr": "P.attr.level == 'senior' && P.attr.tenure_years >= 2"
          }
        }
      }
    ]
  }
}
```

### List Policies

**Endpoint:** `GET /v1/policies`

**Query Parameters:**
- `page` (default: 1): Page number
- `page_size` (default: 20, max: 100): Items per page
- `resource_kind`: Filter by resource kind
- `principal_role`: Filter by principal role
- `policy_type`: Filter by type (resource, principal, derived_role)
- `sort` (default: created_at): Sort field (id, created_at, updated_at)
- `order` (default: desc): Sort order (asc, desc)

**Example:**
```bash
curl -X GET "http://localhost:8083/v1/policies?\
page=1&\
page_size=20&\
resource_kind=document&\
sort=created_at&\
order=desc" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Response:**
```json
{
  "policies": [
    {
      "id": "policy-dev-read-docs",
      "version": "1.0",
      "description": "Developers can read documentation",
      "resource_policy": { ... },
      "metadata": {
        "created_at": "2025-01-20T10:00:00Z",
        "updated_at": "2025-01-20T10:00:00Z",
        "created_by": "admin"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total_items": 150,
    "total_pages": 8
  }
}
```

### Get Policy by ID

**Endpoint:** `GET /v1/policies/{id}`

**Example:**
```bash
curl -X GET http://localhost:8083/v1/policies/policy-dev-read-docs \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### Create Policy

**Endpoint:** `POST /v1/policies`

**Request Body:** Complete policy object (see Policy Types above)

**Example - Resource Policy:**
```bash
curl -X POST http://localhost:8083/v1/policies \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "policy-dev-write-docs",
    "version": "1.0",
    "description": "Developers can write documentation",
    "resource_policy": {
      "resource": "document",
      "version": "1.0",
      "rules": [
        {
          "actions": ["write", "update"],
          "effect": "EFFECT_ALLOW",
          "roles": ["developer"],
          "condition": {
            "match": {
              "expr": "resource.attr.type == '\''internal'\''"
            }
          }
        }
      ]
    }
  }'
```

**Response:**
```json
{
  "id": "policy-dev-write-docs",
  "version": "1.0",
  "created_at": "2025-01-27T10:30:00Z",
  "message": "Policy created successfully"
}
```

**Status Codes:**
- `201 Created`: Policy created successfully
- `400 Bad Request`: Invalid policy format
- `409 Conflict`: Policy with this ID already exists

### Update Policy

**Endpoint:** `PUT /v1/policies/{id}`

**Example:**
```bash
curl -X PUT http://localhost:8083/v1/policies/policy-dev-read-docs \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "policy-dev-read-docs",
    "version": "1.1",
    "description": "Developers can read and comment on documentation",
    "resource_policy": {
      "resource": "document",
      "version": "1.1",
      "rules": [
        {
          "actions": ["read", "comment"],
          "effect": "EFFECT_ALLOW",
          "roles": ["developer"]
        }
      ]
    }
  }'
```

**Response:**
```json
{
  "id": "policy-dev-read-docs",
  "version": "1.1",
  "updated_at": "2025-01-27T10:35:00Z",
  "message": "Policy updated successfully"
}
```

**Note:** The entire policy is replaced. To partially update, retrieve the policy first, modify it, then send the complete updated policy.

### Delete Policy

**Endpoint:** `DELETE /v1/policies/{id}`

**Example:**
```bash
curl -X DELETE http://localhost:8083/v1/policies/policy-dev-read-docs \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Response:**
- `204 No Content`: Policy deleted successfully
- `404 Not Found`: Policy doesn't exist

**Warning:** Deletion is permanent. Consider creating a backup first.

### Policy Validation

All policies are validated before creation/update:

1. **Schema Validation**: JSON schema compliance
2. **ID Uniqueness**: No duplicate policy IDs
3. **Version Format**: Semantic versioning (e.g., "1.0", "2.1.3")
4. **Condition Syntax**: CEL expression validation
5. **Reference Integrity**: Valid resource kinds and actions

**Validation Errors:**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid policy format",
    "details": {
      "field": "resource_policy.rules[0].condition.match.expr",
      "error": "Invalid CEL expression: unexpected token"
    }
  }
}
```

### Policy Conditions (CEL)

Policies support conditions using Common Expression Language (CEL).

**Available Variables:**
- `P`: Principal (id, roles, attributes)
- `R`: Resource (kind, id, attributes)
- `C`: Context (ip_address, time, etc.)

**Example Conditions:**

```javascript
// Principal must be senior level
P.attr.level == "senior"

// Resource must be public
R.attr.visibility == "public"

// Principal department matches resource team
P.attr.department == R.attr.team

// Time-based access (business hours only)
C.time.getHours() >= 9 && C.time.getHours() < 17

// IP-based access
C.ip_address.startsWith("192.168.")

// Complex conditions
P.attr.level == "senior" &&
R.attr.sensitivity == "low" &&
(C.time.getDayOfWeek() >= 1 && C.time.getDayOfWeek() <= 5)

// Combining multiple conditions
(P.attr.clearance >= R.attr.required_clearance) ||
("security-override" in P.roles)
```

**CEL Functions:**
- `startsWith(string)`, `endsWith(string)`, `contains(string)`
- `matches(regex)`
- `size()` - length of string/array
- `has(field)` - check field existence
- Comparison: `==`, `!=`, `<`, `>`, `<=`, `>=`
- Logical: `&&`, `||`, `!`
- Arithmetic: `+`, `-`, `*`, `/`, `%`

---

## Principal Management

### Principal Schema

```json
{
  "id": "user123",
  "roles": ["developer", "team-lead"],
  "attributes": {
    "department": "engineering",
    "level": "senior",
    "location": "US",
    "tenure_years": 3
  },
  "metadata": {
    "created_at": "2024-01-15T08:00:00Z",
    "updated_at": "2025-01-20T14:30:00Z"
  }
}
```

### Get Principal

**Endpoint:** `GET /v1/principals/{id}`

**Example:**
```bash
curl -X GET http://localhost:8083/v1/principals/user123 \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### Create Principal

**Endpoint:** `POST /v1/principals/{id}`

**Example:**
```bash
curl -X POST http://localhost:8083/v1/principals/user456 \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "roles": ["developer"],
    "attributes": {
      "department": "engineering",
      "level": "junior",
      "location": "EU"
    }
  }'
```

### Update Principal

**Endpoint:** `PUT /v1/principals/{id}`

**Example:**
```bash
curl -X PUT http://localhost:8083/v1/principals/user123 \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "roles": ["developer", "team-lead", "architect"],
    "attributes": {
      "department": "engineering",
      "level": "senior",
      "location": "US",
      "tenure_years": 4
    }
  }'
```

### Delete Principal

**Endpoint:** `DELETE /v1/principals/{id}`

**Example:**
```bash
curl -X DELETE http://localhost:8083/v1/principals/user123 \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### Principal Best Practices

1. **Use Consistent IDs**: Use UUIDs or consistent naming (e.g., email addresses)
2. **Role Hierarchy**: Define clear role hierarchies
3. **Attribute Naming**: Use snake_case for attribute names
4. **Update Regularly**: Keep attributes current (especially time-based like tenure_years)
5. **Audit Changes**: Log all principal modifications

---

## Export and Import

### Export Policies

Export policies to JSON or YAML format for backup or migration.

**Endpoint:** `POST /v1/policies/export`

#### Export Specific Policies

**Request:**
```json
{
  "policy_ids": [
    "policy-dev-read-docs",
    "policy-admin-all"
  ],
  "format": "json"
}
```

**curl Example:**
```bash
curl -X POST http://localhost:8083/v1/policies/export \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "policy_ids": ["policy-dev-read-docs", "policy-admin-all"],
    "format": "json"
  }' > policies-export.json
```

#### Export All Policies

**Request:**
```json
{
  "format": "yaml"
}
```

**curl Example:**
```bash
curl -X POST http://localhost:8083/v1/policies/export \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"format": "yaml"}' > policies-export.yaml
```

#### Export with Metadata and Principals

**Request:**
```json
{
  "format": "json",
  "include_metadata": true,
  "include_principals": true
}
```

**Response:**
```json
{
  "format": "json",
  "policies": [
    {
      "id": "policy-dev-read-docs",
      "version": "1.0",
      "description": "Developers can read documentation",
      "resource_policy": { ... }
    }
  ],
  "principals": [
    {
      "id": "user123",
      "roles": ["developer"],
      "attributes": { ... }
    }
  ],
  "metadata": {
    "exported_at": "2025-01-27T10:30:00Z",
    "exported_by": "admin",
    "total_policies": 150,
    "total_principals": 1000,
    "format_version": "1.0"
  }
}
```

### Import Policies

Import policies from JSON or YAML format.

**Endpoint:** `POST /v1/policies/import`

#### Import Modes

1. **create_only** (default): Only create new policies, skip existing
2. **overwrite**: Replace existing policies with imported ones
3. **merge**: Merge imported policies with existing (complex scenarios)

#### Import New Policies

**Request:**
```json
{
  "format": "json",
  "policies": [
    {
      "id": "policy-new-dev",
      "version": "1.0",
      "description": "New developer policy",
      "resource_policy": {
        "resource": "document",
        "version": "1.0",
        "rules": [
          {
            "actions": ["read"],
            "effect": "EFFECT_ALLOW",
            "roles": ["developer"]
          }
        ]
      }
    }
  ],
  "mode": "create_only"
}
```

**curl Example:**
```bash
curl -X POST http://localhost:8083/v1/policies/import \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @policies-export.json
```

**Response:**
```json
{
  "success": true,
  "imported_count": 5,
  "skipped_count": 0,
  "failed_count": 0,
  "dry_run": false,
  "message": "Successfully imported 5 policies"
}
```

#### Import with Overwrite

**Request:**
```json
{
  "format": "json",
  "policies": [ ... ],
  "mode": "overwrite"
}
```

#### Dry Run (Validation Only)

Test import without applying changes:

**Request:**
```json
{
  "format": "json",
  "policies": [ ... ],
  "dry_run": true
}
```

**Response:**
```json
{
  "success": true,
  "imported_count": 0,
  "skipped_count": 0,
  "failed_count": 0,
  "dry_run": true,
  "message": "Validation successful: 5 policies are valid and ready to import",
  "validation_details": [
    {
      "policy_id": "policy-test",
      "status": "valid",
      "message": "Policy format is valid"
    }
  ]
}
```

#### Import from File

**Bash Script:**
```bash
#!/bin/bash

POLICIES_FILE="policies-export.json"
JWT_TOKEN="your-jwt-token"

curl -X POST http://localhost:8083/v1/policies/import \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @"$POLICIES_FILE"
```

**Python Script:**
```python
import requests
import json

with open('policies-export.json', 'r') as f:
    data = json.load(f)

response = requests.post(
    'http://localhost:8083/v1/policies/import',
    headers={
        'Authorization': f'Bearer {jwt_token}',
        'Content-Type': 'application/json'
    },
    json=data
)

print(response.json())
```

### Export/Import Workflows

#### Workflow 1: Environment Migration (Dev → Staging → Prod)

```bash
# 1. Export from development
curl -X POST https://dev-api.example.com/v1/policies/export \
  -H "Authorization: Bearer $DEV_TOKEN" \
  -d '{"format": "json", "include_principals": true}' \
  > dev-policies.json

# 2. Validate in staging (dry run)
curl -X POST https://staging-api.example.com/v1/policies/import \
  -H "Authorization: Bearer $STAGING_TOKEN" \
  -d @dev-policies.json \
  -d '{"dry_run": true}'

# 3. Import to staging
curl -X POST https://staging-api.example.com/v1/policies/import \
  -H "Authorization: Bearer $STAGING_TOKEN" \
  -d @dev-policies.json \
  -d '{"mode": "overwrite"}'

# 4. Test in staging...

# 5. Import to production
curl -X POST https://prod-api.example.com/v1/policies/import \
  -H "Authorization: Bearer $PROD_TOKEN" \
  -d @dev-policies.json \
  -d '{"mode": "create_only"}'
```

#### Workflow 2: Selective Policy Migration

```bash
# Export specific policies
curl -X POST http://localhost:8083/v1/policies/export \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "policy_ids": ["policy-a", "policy-b", "policy-c"],
    "format": "json"
  }' > selected-policies.json

# Import to target environment
curl -X POST https://target-api.example.com/v1/policies/import \
  -H "Authorization: Bearer $TARGET_TOKEN" \
  -d @selected-policies.json
```

#### Workflow 3: Policy Version Control with Git

```bash
# Export to Git repository
export DATE=$(date +%Y%m%d-%H%M%S)
curl -X POST http://localhost:8083/v1/policies/export \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{"format": "yaml"}' > policies-$DATE.yaml

# Commit to Git
git add policies-$DATE.yaml
git commit -m "Policy export $DATE"
git push

# Restore from Git
git pull
curl -X POST http://localhost:8083/v1/policies/import \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d @policies-20250127-103000.yaml
```

---

## Backup and Restore

### Create Backup

Create a complete backup of all policies and principals.

**Endpoint:** `POST /v1/policies/backup`

**Request:**
```json
{
  "name": "daily-backup-2025-01-27",
  "description": "Daily backup before maintenance",
  "include_principals": true
}
```

**curl Example:**
```bash
curl -X POST http://localhost:8083/v1/policies/backup \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "daily-backup-2025-01-27",
    "description": "Daily backup before maintenance",
    "include_principals": true
  }'
```

**Response:**
```json
{
  "backup_id": "backup-20250127-103000",
  "name": "daily-backup-2025-01-27",
  "created_at": "2025-01-27T10:30:00Z",
  "size_bytes": 1048576,
  "policy_count": 150,
  "principal_count": 1000,
  "format": "json",
  "checksum": "sha256:abc123..."
}
```

### Restore from Backup

Restore policies and principals from a backup.

**Endpoint:** `POST /v1/policies/restore`

#### Restore Modes

1. **replace_all**: Delete all existing data and restore from backup
2. **merge**: Merge backup data with existing data

#### Full Restore (Replace All)

**Request:**
```json
{
  "backup_id": "backup-20250127-103000",
  "mode": "replace_all"
}
```

**Warning:** This will delete ALL existing policies and principals!

#### Merge Restore

**Request:**
```json
{
  "backup_id": "backup-20250127-103000",
  "mode": "merge",
  "conflict_resolution": "keep_existing"
}
```

**Conflict Resolution Options:**
- `keep_existing`: Keep existing data on conflict
- `overwrite`: Replace with backup data on conflict
- `fail`: Fail on any conflict

#### Dry Run (Test Restore)

**Request:**
```json
{
  "backup_id": "backup-20250127-103000",
  "mode": "replace_all",
  "dry_run": true
}
```

**Response:**
```json
{
  "success": true,
  "restored_policies": 0,
  "restored_principals": 0,
  "skipped_count": 0,
  "failed_count": 0,
  "dry_run": true,
  "message": "Restore validation successful: 150 policies and 1000 principals ready to restore"
}
```

#### Actual Restore

```bash
curl -X POST http://localhost:8083/v1/policies/restore \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "backup_id": "backup-20250127-103000",
    "mode": "merge",
    "conflict_resolution": "keep_existing"
  }'
```

**Response:**
```json
{
  "success": true,
  "restored_policies": 150,
  "restored_principals": 1000,
  "skipped_count": 0,
  "failed_count": 0,
  "dry_run": false,
  "message": "Successfully restored 150 policies and 1000 principals"
}
```

### Backup Best Practices

1. **Regular Backups**: Schedule daily backups
2. **Retention Policy**: Keep 7 daily, 4 weekly, 12 monthly backups
3. **Test Restores**: Regularly test restore procedures
4. **Off-site Storage**: Store backups in separate location
5. **Encryption**: Encrypt backups at rest
6. **Verification**: Verify backup checksums

### Automated Backup Script

**Bash Script:**
```bash
#!/bin/bash

# Configuration
API_URL="http://localhost:8083/v1"
JWT_TOKEN="your-jwt-token"
BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d-%H%M%S)

# Create backup
echo "Creating backup..."
BACKUP_RESPONSE=$(curl -s -X POST "$API_URL/policies/backup" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"auto-backup-$DATE\",
    \"description\": \"Automated daily backup\",
    \"include_principals\": true
  }")

BACKUP_ID=$(echo "$BACKUP_RESPONSE" | jq -r '.backup_id')
echo "Backup created: $BACKUP_ID"

# Export backup to file
echo "Exporting backup..."
curl -s -X POST "$API_URL/policies/export" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{"format": "json", "include_principals": true}' \
  > "$BACKUP_DIR/backup-$DATE.json"

# Verify checksum
CHECKSUM=$(sha256sum "$BACKUP_DIR/backup-$DATE.json" | awk '{print $1}')
echo "Checksum: $CHECKSUM"

# Delete old backups (keep last 7 days)
find "$BACKUP_DIR" -name "backup-*.json" -mtime +7 -delete

echo "Backup complete!"
```

**Cron Job (daily at 2 AM):**
```
0 2 * * * /path/to/backup-script.sh
```

---

## Error Handling

### Error Response Format

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {
      "field": "specific_field",
      "constraint": "validation_rule"
    },
    "trace_id": "abc123-def456-ghi789"
  }
}
```

### HTTP Status Codes

| Code | Meaning | Description |
|------|---------|-------------|
| 200 | OK | Request successful |
| 201 | Created | Resource created successfully |
| 204 | No Content | Request successful, no response body |
| 400 | Bad Request | Invalid request parameters or body |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Resource already exists |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error |
| 503 | Service Unavailable | Service temporarily unavailable |

### Common Error Codes

#### Authentication Errors

**UNAUTHORIZED**
```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required. Please provide a valid JWT token."
  }
}
```

**TOKEN_EXPIRED**
```json
{
  "error": {
    "code": "TOKEN_EXPIRED",
    "message": "JWT token has expired. Please obtain a new token.",
    "details": {
      "expired_at": "2025-01-27T09:30:00Z"
    }
  }
}
```

**INVALID_TOKEN**
```json
{
  "error": {
    "code": "INVALID_TOKEN",
    "message": "Invalid JWT token signature"
  }
}
```

#### Validation Errors

**VALIDATION_ERROR**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request: missing required field 'principal.id'",
    "details": {
      "field": "principal.id",
      "constraint": "required"
    }
  }
}
```

**INVALID_FORMAT**
```json
{
  "error": {
    "code": "INVALID_FORMAT",
    "message": "Invalid policy format: resource_policy.rules must be an array",
    "details": {
      "field": "resource_policy.rules",
      "expected_type": "array",
      "actual_type": "object"
    }
  }
}
```

**INVALID_CEL_EXPRESSION**
```json
{
  "error": {
    "code": "INVALID_CEL_EXPRESSION",
    "message": "Invalid CEL expression in policy condition",
    "details": {
      "expression": "P.attr.level = 'senior'",
      "error": "syntax error: expected '==' but got '='"
    }
  }
}
```

#### Resource Errors

**POLICY_NOT_FOUND**
```json
{
  "error": {
    "code": "POLICY_NOT_FOUND",
    "message": "Policy with ID 'policy-dev-read-docs' not found"
  }
}
```

**POLICY_ALREADY_EXISTS**
```json
{
  "error": {
    "code": "POLICY_ALREADY_EXISTS",
    "message": "A policy with ID 'policy-dev-read-docs' already exists",
    "details": {
      "existing_policy_id": "policy-dev-read-docs",
      "created_at": "2025-01-20T10:00:00Z"
    }
  }
}
```

**PRINCIPAL_NOT_FOUND**
```json
{
  "error": {
    "code": "PRINCIPAL_NOT_FOUND",
    "message": "Principal with ID 'user123' not found"
  }
}
```

#### Rate Limiting Errors

**RATE_LIMIT_EXCEEDED**
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Please try again later.",
    "details": {
      "limit": 100,
      "window": "1 minute",
      "retry_after": 45
    }
  }
}
```

### Error Handling Best Practices

1. **Check Status Code First**: Always check HTTP status code
2. **Parse Error Response**: Extract error code and message
3. **Log Trace ID**: Include trace_id in logs for debugging
4. **Retry Logic**: Implement exponential backoff for 5xx errors
5. **User-Friendly Messages**: Don't expose raw error messages to end users

### Error Handling Examples

**Python:**
```python
import requests
import time

def call_api_with_retry(url, max_retries=3):
    for attempt in range(max_retries):
        try:
            response = requests.post(url, json=data, headers=headers)

            if response.status_code == 200:
                return response.json()

            elif response.status_code == 429:
                # Rate limit - use Retry-After header
                retry_after = int(response.headers.get('Retry-After', 60))
                print(f"Rate limited. Waiting {retry_after}s...")
                time.sleep(retry_after)
                continue

            elif response.status_code >= 500:
                # Server error - exponential backoff
                wait_time = 2 ** attempt
                print(f"Server error. Retrying in {wait_time}s...")
                time.sleep(wait_time)
                continue

            else:
                # Client error - don't retry
                error = response.json().get('error', {})
                raise Exception(f"API Error: {error.get('code')} - {error.get('message')}")

        except requests.exceptions.RequestException as e:
            print(f"Request failed: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
            else:
                raise

    raise Exception("Max retries exceeded")
```

**JavaScript:**
```javascript
async function callApiWithRetry(url, options, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.ok) {
        return await response.json();
      }

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
        console.log(`Rate limited. Waiting ${retryAfter}s...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      }

      if (response.status >= 500) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.log(`Server error. Retrying in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      const error = await response.json();
      throw new Error(`API Error: ${error.error.code} - ${error.error.message}`);

    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }

  throw new Error('Max retries exceeded');
}
```

---

## Rate Limiting

### Rate Limit Headers

All API responses include rate limit headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 75
X-RateLimit-Reset: 1706356800
```

- `X-RateLimit-Limit`: Maximum requests per window
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-RateLimit-Reset`: Unix timestamp when limit resets

### Rate Limit Tiers

| Tier | Requests/Minute | Requests/Hour | Requests/Day |
|------|-----------------|---------------|--------------|
| Free | 10 | 100 | 1,000 |
| Basic | 100 | 1,000 | 10,000 |
| Pro | 1,000 | 10,000 | 100,000 |
| Enterprise | Custom | Custom | Custom |

### Rate Limit by Endpoint

| Endpoint | Rate Limit |
|----------|------------|
| POST /authorization/check | 1,000/min |
| POST /authorization/check-resources | 100/min |
| GET /authorization/allowed-actions | 500/min |
| POST /policies | 50/min |
| PUT /policies/{id} | 50/min |
| DELETE /policies/{id} | 20/min |
| POST /policies/export | 10/min |
| POST /policies/import | 5/min |
| POST /policies/backup | 5/min |
| POST /policies/restore | 2/min |

### Handling Rate Limits

**1. Check Headers:**
```bash
curl -i -X POST http://localhost:8083/v1/authorization/check \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '...'

# Response headers:
# X-RateLimit-Limit: 100
# X-RateLimit-Remaining: 99
# X-RateLimit-Reset: 1706356860
```

**2. Respect Retry-After:**
When rate limited (HTTP 429), check `Retry-After` header:
```
HTTP/1.1 429 Too Many Requests
Retry-After: 60
```

**3. Implement Backoff:**
```python
import time

def check_rate_limit(response):
    remaining = int(response.headers.get('X-RateLimit-Remaining', 0))
    if remaining < 10:
        reset_time = int(response.headers.get('X-RateLimit-Reset', 0))
        wait_time = reset_time - int(time.time())
        if wait_time > 0:
            print(f"Approaching rate limit. Waiting {wait_time}s...")
            time.sleep(wait_time)
```

### Rate Limit Best Practices

1. **Monitor Headers**: Always check rate limit headers
2. **Batch Requests**: Use batch endpoints when possible
3. **Cache Results**: Cache authorization decisions
4. **Spread Load**: Don't burst all requests at once
5. **Plan Capacity**: Choose appropriate tier for your usage
6. **Handle 429**: Implement proper retry logic

---

## Best Practices

### API Usage

1. **Use HTTPS**: Always use HTTPS in production
2. **Store Tokens Securely**: Never commit tokens to version control
3. **Connection Pooling**: Reuse HTTP connections
4. **Timeouts**: Set reasonable timeouts (30s for most operations)
5. **Idempotency**: Use idempotency keys for critical operations

### Policy Design

1. **Principle of Least Privilege**: Grant minimum necessary permissions
2. **Use Derived Roles**: Reduce policy duplication
3. **Condition-Based Policies**: Use conditions for fine-grained control
4. **Policy Naming**: Use consistent naming (e.g., `policy-{role}-{action}-{resource}`)
5. **Version Policies**: Increment versions when updating
6. **Document Policies**: Add clear descriptions

### Performance Optimization

1. **Batch Authorization Checks**: Use `/check-resources` for multiple checks
2. **Cache Decisions**: Cache authorization results when appropriate
3. **Use Allowed Actions**: Reduce check calls with `/allowed-actions`
4. **Connection Reuse**: Use HTTP keep-alive
5. **Compress Responses**: Use gzip compression

### Security

1. **Rotate Tokens**: Implement token rotation
2. **Audit Logs**: Enable and monitor audit logs
3. **Principle of Least Privilege**: Minimize principal permissions
4. **Input Validation**: Validate all inputs client-side
5. **Secure Storage**: Encrypt backups at rest

### Monitoring

1. **Track Metrics**: Monitor API usage and performance
2. **Set Alerts**: Alert on errors and rate limits
3. **Log Trace IDs**: Include trace IDs in logs
4. **Health Checks**: Regular health check polling
5. **Dashboard**: Create operational dashboard

---

## Advanced Topics

### Webhooks

Subscribe to policy and principal change events.

**Configuration:**
```bash
curl -X POST http://localhost:8083/v1/webhooks \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "url": "https://your-app.com/webhook",
    "events": ["policy.created", "policy.updated", "policy.deleted"],
    "secret": "webhook-secret"
  }'
```

**Webhook Payload:**
```json
{
  "event": "policy.created",
  "timestamp": "2025-01-27T10:30:00Z",
  "data": {
    "policy_id": "policy-new",
    "version": "1.0",
    "created_by": "admin"
  },
  "signature": "sha256=abc123..."
}
```

### Pagination

All list endpoints support pagination:

```bash
curl -X GET "http://localhost:8083/v1/policies?\
page=2&\
page_size=50&\
sort=created_at&\
order=desc"
```

**Response:**
```json
{
  "policies": [ ... ],
  "pagination": {
    "page": 2,
    "page_size": 50,
    "total_items": 250,
    "total_pages": 5,
    "has_next": true,
    "has_prev": true,
    "next_page": 3,
    "prev_page": 1
  }
}
```

### Filtering and Searching

**Filter by Resource Kind:**
```bash
curl -X GET "http://localhost:8083/v1/policies?resource_kind=document"
```

**Filter by Role:**
```bash
curl -X GET "http://localhost:8083/v1/policies?principal_role=developer"
```

**Combine Filters:**
```bash
curl -X GET "http://localhost:8083/v1/policies?\
resource_kind=document&\
principal_role=developer&\
sort=updated_at&\
order=desc"
```

### Async Operations

Long-running operations (import, restore) support async mode:

**Request:**
```bash
curl -X POST http://localhost:8083/v1/policies/import?async=true \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d @large-policies.json
```

**Response:**
```json
{
  "operation_id": "op-abc123",
  "status": "pending",
  "status_url": "/v1/operations/op-abc123"
}
```

**Check Status:**
```bash
curl -X GET http://localhost:8083/v1/operations/op-abc123 \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### Audit Logs

Query audit logs for compliance and troubleshooting:

```bash
curl -X GET "http://localhost:8083/v1/audit/logs?\
start_date=2025-01-20&\
end_date=2025-01-27&\
event_type=policy.updated&\
user_id=admin" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Response:**
```json
{
  "logs": [
    {
      "event_id": "evt-123",
      "event_type": "policy.updated",
      "timestamp": "2025-01-27T10:30:00Z",
      "user_id": "admin",
      "ip_address": "192.168.1.100",
      "resource_type": "policy",
      "resource_id": "policy-dev-read-docs",
      "changes": {
        "version": {"old": "1.0", "new": "1.1"},
        "description": {"old": "Old desc", "new": "New desc"}
      }
    }
  ],
  "pagination": { ... }
}
```

### Custom Attributes

Extend principals and resources with custom attributes:

**Principal with Custom Attributes:**
```json
{
  "id": "user123",
  "roles": ["developer"],
  "attributes": {
    "department": "engineering",
    "level": "senior",
    "clearance": 3,
    "projects": ["project-a", "project-b"],
    "manager_id": "user456",
    "hire_date": "2022-01-15",
    "custom_field_1": "value1"
  }
}
```

**Resource with Custom Attributes:**
```json
{
  "kind": "document",
  "id": "doc123",
  "attributes": {
    "visibility": "private",
    "owner_id": "user123",
    "sensitivity": "high",
    "tags": ["engineering", "design"],
    "created_at": "2025-01-20T10:00:00Z",
    "project_id": "project-a"
  }
}
```

### Policy Templates

Use templates for common policy patterns:

```bash
curl -X GET http://localhost:8083/v1/policy-templates \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Available Templates:**
- `role-based-access`: Basic role-based access
- `attribute-based-access`: ABAC with conditions
- `time-based-access`: Time-restricted access
- `owner-based-access`: Resource owner permissions
- `hierarchical-access`: Org hierarchy-based access

**Create from Template:**
```bash
curl -X POST http://localhost:8083/v1/policies/from-template \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "template": "role-based-access",
    "parameters": {
      "resource": "document",
      "role": "developer",
      "actions": ["read", "write"]
    }
  }'
```

---

## Troubleshooting

### Common Issues

**Issue: 401 Unauthorized**
- Check token expiration
- Verify token format (Bearer prefix)
- Ensure correct API key/credentials

**Issue: 403 Forbidden**
- Verify token has required permissions
- Check principal roles and attributes
- Review audit logs for denial reason

**Issue: 429 Rate Limit Exceeded**
- Check rate limit headers
- Implement backoff and retry
- Consider upgrading tier
- Use batch endpoints

**Issue: Policy Not Matching**
- Verify principal roles
- Check condition expressions (CEL syntax)
- Review resource attributes
- Test with allowed-actions endpoint

**Issue: Import Fails**
- Validate JSON/YAML format
- Check for duplicate policy IDs
- Review error details in response
- Use dry_run mode first

### Debug Mode

Enable debug mode for detailed logs:

```bash
curl -X POST http://localhost:8083/v1/authorization/check \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "X-Debug: true" \
  -d '...'
```

**Debug Response:**
```json
{
  "allowed": false,
  "decision_time_ms": 8,
  "reason": "No matching policy found",
  "debug": {
    "evaluated_policies": [
      {
        "policy_id": "policy-dev-read-docs",
        "matched": false,
        "reason": "Action 'write' not in allowed actions ['read']"
      }
    ],
    "principal_derived_roles": ["senior_developer"],
    "evaluation_steps": [
      "Loaded 5 resource policies for kind 'document'",
      "Loaded 2 principal policies for principal 'user123'",
      "Evaluated 3 derived role conditions",
      "No policy allowed action 'write' for principal 'user123'"
    ]
  }
}
```

### Support

- **Documentation**: https://docs.authz-engine.example.com
- **API Reference**: https://api.authz-engine.example.com/api-docs
- **Support Email**: support@authz-engine.example.com
- **GitHub Issues**: https://github.com/authz-engine/go-core/issues
- **Community Forum**: https://community.authz-engine.example.com

---

## Appendix

### A. Complete curl Examples

See [API_EXAMPLES.md](./API_EXAMPLES.md) for comprehensive examples.

### B. Client SDK Documentation

🚧 **Coming Soon**: Client SDKs for multiple languages

- TypeScript/JavaScript SDK (Planned)
- Python SDK (Planned)
- Go SDK (Planned)

For now, use the REST API directly with your preferred HTTP client.

### C. OpenAPI Specification

Full specification: [api/openapi.yaml](../api/openapi.yaml)

Interactive docs: http://localhost:8083/api-docs

### D. Postman Collection

Import the Postman collection: [docs/POSTMAN_COLLECTION.json](./POSTMAN_COLLECTION.json)

### E. Migration Guides

See [POLICY_EXPORT_IMPORT.md](./POLICY_EXPORT_IMPORT.md) for detailed migration scenarios.

---

**Version**: 1.0.0
**Last Updated**: 2025-01-27
**Maintainer**: Authorization Engine Team
