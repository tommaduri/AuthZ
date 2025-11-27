# API Examples

This document provides comprehensive code examples for interacting with the Authorization Engine REST API in multiple languages.

## Table of Contents

1. [curl Examples](#curl-examples)
2. [Python Examples](#python-examples)
3. [JavaScript Examples](#javascript-examples)
4. [Go Examples](#go-examples)
5. [Java Examples](#java-examples)

---

## curl Examples

### Authentication

```bash
# Set your JWT token
export JWT_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Health check (no auth required)
curl -X GET http://localhost:8080/health

# Status check (auth required)
curl -X GET http://localhost:8080/v1/status \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### Authorization Checks

#### Basic Authorization Check

```bash
curl -X POST http://localhost:8080/v1/authorization/check \
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

#### Authorization Check with Attributes

```bash
curl -X POST http://localhost:8080/v1/authorization/check \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "principal": {
      "id": "user123",
      "roles": ["developer"],
      "attributes": {
        "department": "engineering",
        "level": "senior"
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
  }'
```

#### Batch Authorization Check

```bash
curl -X POST http://localhost:8080/v1/authorization/check-resources \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "principal": {
      "id": "user123",
      "roles": ["developer"]
    },
    "action": "read",
    "resources": [
      {"kind": "document", "id": "doc456"},
      {"kind": "document", "id": "doc789"},
      {"kind": "repository", "id": "repo123"}
    ]
  }'
```

#### Get Allowed Actions

```bash
curl -X GET "http://localhost:8080/v1/authorization/allowed-actions?\
principal_id=user123&\
resource_kind=document&\
resource_id=doc456&\
roles=developer,team-lead" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### Policy Management

#### List Policies

```bash
# List all policies (paginated)
curl -X GET "http://localhost:8080/v1/policies?page=1&page_size=20" \
  -H "Authorization: Bearer $JWT_TOKEN"

# Filter by resource kind
curl -X GET "http://localhost:8080/v1/policies?resource_kind=document" \
  -H "Authorization: Bearer $JWT_TOKEN"

# Filter by role
curl -X GET "http://localhost:8080/v1/policies?principal_role=developer" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

#### Get Policy by ID

```bash
curl -X GET http://localhost:8080/v1/policies/policy-dev-read-docs \
  -H "Authorization: Bearer $JWT_TOKEN"
```

#### Create Policy

```bash
curl -X POST http://localhost:8080/v1/policies \
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
          "roles": ["developer"]
        }
      ]
    }
  }'
```

#### Update Policy

```bash
curl -X PUT http://localhost:8080/v1/policies/policy-dev-read-docs \
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

#### Delete Policy

```bash
curl -X DELETE http://localhost:8080/v1/policies/policy-dev-read-docs \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### Export and Import

#### Export All Policies

```bash
curl -X POST http://localhost:8080/v1/policies/export \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "json",
    "include_metadata": true,
    "include_principals": true
  }' > full-export.json
```

#### Export Specific Policies

```bash
curl -X POST http://localhost:8080/v1/policies/export \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "policy_ids": ["policy-dev-read-docs", "policy-admin-all"],
    "format": "json"
  }' > selected-policies.json
```

#### Import Policies (Dry Run)

```bash
curl -X POST http://localhost:8080/v1/policies/import \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @policies.json \
  -d '{"dry_run": true}'
```

#### Import Policies

```bash
curl -X POST http://localhost:8080/v1/policies/import \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @policies.json
```

### Backup and Restore

#### Create Backup

```bash
curl -X POST http://localhost:8080/v1/policies/backup \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "daily-backup-2025-01-27",
    "description": "Daily backup",
    "include_principals": true
  }'
```

#### Restore from Backup

```bash
curl -X POST http://localhost:8080/v1/policies/restore \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "backup_id": "backup-20250127-103000",
    "mode": "merge",
    "conflict_resolution": "keep_existing"
  }'
```

---

## Python Examples

### Setup

```bash
pip install requests
```

### Basic Client

```python
import requests
import json
from typing import Dict, List, Optional

class AuthzClient:
    def __init__(self, base_url: str, jwt_token: str):
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': f'Bearer {jwt_token}',
            'Content-Type': 'application/json'
        })

    def check_authorization(self, principal: Dict, action: str, resource: Dict,
                          context: Optional[Dict] = None) -> Dict:
        """Check if a principal is authorized to perform an action on a resource."""
        payload = {
            'principal': principal,
            'action': action,
            'resource': resource
        }
        if context:
            payload['context'] = context

        response = self.session.post(
            f'{self.base_url}/authorization/check',
            json=payload
        )
        response.raise_for_status()
        return response.json()

    def batch_check_authorization(self, principal: Dict, action: str,
                                 resources: List[Dict]) -> Dict:
        """Check authorization for multiple resources."""
        payload = {
            'principal': principal,
            'action': action,
            'resources': resources
        }

        response = self.session.post(
            f'{self.base_url}/authorization/check-resources',
            json=payload
        )
        response.raise_for_status()
        return response.json()

    def get_allowed_actions(self, principal_id: str, resource_kind: str,
                          resource_id: str, roles: Optional[List[str]] = None) -> Dict:
        """Get all actions a principal can perform on a resource."""
        params = {
            'principal_id': principal_id,
            'resource_kind': resource_kind,
            'resource_id': resource_id
        }
        if roles:
            params['roles'] = roles

        response = self.session.get(
            f'{self.base_url}/authorization/allowed-actions',
            params=params
        )
        response.raise_for_status()
        return response.json()

    def list_policies(self, page: int = 1, page_size: int = 20,
                     resource_kind: Optional[str] = None,
                     principal_role: Optional[str] = None) -> Dict:
        """List policies with optional filtering."""
        params = {'page': page, 'page_size': page_size}
        if resource_kind:
            params['resource_kind'] = resource_kind
        if principal_role:
            params['principal_role'] = principal_role

        response = self.session.get(
            f'{self.base_url}/policies',
            params=params
        )
        response.raise_for_status()
        return response.json()

    def get_policy(self, policy_id: str) -> Dict:
        """Get a specific policy by ID."""
        response = self.session.get(f'{self.base_url}/policies/{policy_id}')
        response.raise_for_status()
        return response.json()

    def create_policy(self, policy: Dict) -> Dict:
        """Create a new policy."""
        response = self.session.post(
            f'{self.base_url}/policies',
            json=policy
        )
        response.raise_for_status()
        return response.json()

    def update_policy(self, policy_id: str, policy: Dict) -> Dict:
        """Update an existing policy."""
        response = self.session.put(
            f'{self.base_url}/policies/{policy_id}',
            json=policy
        )
        response.raise_for_status()
        return response.json()

    def delete_policy(self, policy_id: str) -> None:
        """Delete a policy."""
        response = self.session.delete(f'{self.base_url}/policies/{policy_id}')
        response.raise_for_status()

    def export_policies(self, policy_ids: Optional[List[str]] = None,
                       format: str = 'json', include_principals: bool = False) -> Dict:
        """Export policies."""
        payload = {
            'format': format,
            'include_principals': include_principals
        }
        if policy_ids:
            payload['policy_ids'] = policy_ids

        response = self.session.post(
            f'{self.base_url}/policies/export',
            json=payload
        )
        response.raise_for_status()
        return response.json()

    def import_policies(self, policies: Dict, mode: str = 'create_only',
                       dry_run: bool = False) -> Dict:
        """Import policies."""
        payload = {
            'format': policies.get('format', 'json'),
            'policies': policies['policies'],
            'mode': mode,
            'dry_run': dry_run
        }
        if 'principals' in policies:
            payload['principals'] = policies['principals']

        response = self.session.post(
            f'{self.base_url}/policies/import',
            json=payload
        )
        response.raise_for_status()
        return response.json()

    def create_backup(self, name: str, description: str = '',
                     include_principals: bool = True) -> Dict:
        """Create a backup."""
        payload = {
            'name': name,
            'description': description,
            'include_principals': include_principals
        }

        response = self.session.post(
            f'{self.base_url}/policies/backup',
            json=payload
        )
        response.raise_for_status()
        return response.json()

    def restore_backup(self, backup_id: str, mode: str = 'merge',
                      conflict_resolution: str = 'keep_existing',
                      dry_run: bool = False) -> Dict:
        """Restore from backup."""
        payload = {
            'backup_id': backup_id,
            'mode': mode,
            'conflict_resolution': conflict_resolution,
            'dry_run': dry_run
        }

        response = self.session.post(
            f'{self.base_url}/policies/restore',
            json=payload
        )
        response.raise_for_status()
        return response.json()
```

### Usage Examples

```python
# Initialize client
client = AuthzClient(
    base_url='http://localhost:8080/v1',
    jwt_token='your-jwt-token'
)

# Check authorization
result = client.check_authorization(
    principal={
        'id': 'user123',
        'roles': ['developer'],
        'attributes': {
            'department': 'engineering',
            'level': 'senior'
        }
    },
    action='read',
    resource={
        'kind': 'document',
        'id': 'doc456'
    }
)
print(f"Allowed: {result['allowed']}")

# Batch check
batch_result = client.batch_check_authorization(
    principal={'id': 'user123', 'roles': ['developer']},
    action='read',
    resources=[
        {'kind': 'document', 'id': 'doc456'},
        {'kind': 'document', 'id': 'doc789'}
    ]
)
for result in batch_result['results']:
    print(f"{result['resource']['id']}: {result['allowed']}")

# Get allowed actions
allowed = client.get_allowed_actions(
    principal_id='user123',
    resource_kind='document',
    resource_id='doc456',
    roles=['developer']
)
print(f"Allowed actions: {allowed['allowed_actions']}")

# List policies
policies = client.list_policies(page=1, page_size=20, resource_kind='document')
print(f"Total policies: {policies['pagination']['total_items']}")

# Create policy
new_policy = client.create_policy({
    'id': 'policy-dev-write-docs',
    'version': '1.0',
    'description': 'Developers can write documentation',
    'resource_policy': {
        'resource': 'document',
        'version': '1.0',
        'rules': [
            {
                'actions': ['write', 'update'],
                'effect': 'EFFECT_ALLOW',
                'roles': ['developer']
            }
        ]
    }
})
print(f"Created policy: {new_policy['id']}")

# Export policies
export_data = client.export_policies(
    policy_ids=['policy-dev-read-docs', 'policy-admin-all'],
    format='json',
    include_principals=False
)

# Save to file
with open('policies-export.json', 'w') as f:
    json.dump(export_data, f, indent=2)

# Import policies (dry run first)
with open('policies-export.json', 'r') as f:
    import_data = json.load(f)

dry_run_result = client.import_policies(import_data, dry_run=True)
print(f"Dry run success: {dry_run_result['success']}")

if dry_run_result['success']:
    # Actual import
    import_result = client.import_policies(import_data, mode='create_only')
    print(f"Imported {import_result['imported_count']} policies")

# Create backup
backup = client.create_backup(
    name='daily-backup',
    description='Daily automated backup',
    include_principals=True
)
print(f"Backup created: {backup['backup_id']}")

# Restore from backup (dry run first)
restore_result = client.restore_backup(
    backup_id='backup-20250127-103000',
    mode='merge',
    conflict_resolution='keep_existing',
    dry_run=True
)
print(f"Restore dry run: {restore_result['message']}")
```

### Error Handling

```python
import requests

try:
    result = client.check_authorization(
        principal={'id': 'user123', 'roles': ['developer']},
        action='read',
        resource={'kind': 'document', 'id': 'doc456'}
    )
except requests.exceptions.HTTPError as e:
    if e.response.status_code == 401:
        print("Authentication failed. Check your JWT token.")
    elif e.response.status_code == 403:
        print("Forbidden. Insufficient permissions.")
    elif e.response.status_code == 429:
        retry_after = e.response.headers.get('Retry-After', 60)
        print(f"Rate limited. Retry after {retry_after} seconds.")
    else:
        error = e.response.json().get('error', {})
        print(f"Error: {error.get('message')}")
except requests.exceptions.RequestException as e:
    print(f"Request failed: {e}")
```

---

## JavaScript Examples

### Setup

```bash
npm install axios
```

### Basic Client

```javascript
const axios = require('axios');

class AuthzClient {
  constructor(baseUrl, jwtToken) {
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async checkAuthorization(principal, action, resource, context = null) {
    const payload = { principal, action, resource };
    if (context) payload.context = context;

    const response = await this.client.post('/authorization/check', payload);
    return response.data;
  }

  async batchCheckAuthorization(principal, action, resources) {
    const response = await this.client.post('/authorization/check-resources', {
      principal,
      action,
      resources
    });
    return response.data;
  }

  async getAllowedActions(principalId, resourceKind, resourceId, roles = null) {
    const params = {
      principal_id: principalId,
      resource_kind: resourceKind,
      resource_id: resourceId
    };
    if (roles) params.roles = roles;

    const response = await this.client.get('/authorization/allowed-actions', { params });
    return response.data;
  }

  async listPolicies(page = 1, pageSize = 20, filters = {}) {
    const params = { page, page_size: pageSize, ...filters };
    const response = await this.client.get('/policies', { params });
    return response.data;
  }

  async getPolicy(policyId) {
    const response = await this.client.get(`/policies/${policyId}`);
    return response.data;
  }

  async createPolicy(policy) {
    const response = await this.client.post('/policies', policy);
    return response.data;
  }

  async updatePolicy(policyId, policy) {
    const response = await this.client.put(`/policies/${policyId}`, policy);
    return response.data;
  }

  async deletePolicy(policyId) {
    await this.client.delete(`/policies/${policyId}`);
  }

  async exportPolicies(policyIds = null, format = 'json', includePrincipals = false) {
    const payload = { format, include_principals: includePrincipals };
    if (policyIds) payload.policy_ids = policyIds;

    const response = await this.client.post('/policies/export', payload);
    return response.data;
  }

  async importPolicies(policies, mode = 'create_only', dryRun = false) {
    const payload = {
      format: policies.format || 'json',
      policies: policies.policies,
      mode,
      dry_run: dryRun
    };
    if (policies.principals) payload.principals = policies.principals;

    const response = await this.client.post('/policies/import', payload);
    return response.data;
  }

  async createBackup(name, description = '', includePrincipals = true) {
    const response = await this.client.post('/policies/backup', {
      name,
      description,
      include_principals: includePrincipals
    });
    return response.data;
  }

  async restoreBackup(backupId, mode = 'merge', conflictResolution = 'keep_existing', dryRun = false) {
    const response = await this.client.post('/policies/restore', {
      backup_id: backupId,
      mode,
      conflict_resolution: conflictResolution,
      dry_run: dryRun
    });
    return response.data;
  }
}

module.exports = AuthzClient;
```

### Usage Examples

```javascript
const AuthzClient = require('./authz-client');
const fs = require('fs').promises;

(async () => {
  // Initialize client
  const client = new AuthzClient(
    'http://localhost:8080/v1',
    'your-jwt-token'
  );

  try {
    // Check authorization
    const result = await client.checkAuthorization(
      {
        id: 'user123',
        roles: ['developer'],
        attributes: { department: 'engineering', level: 'senior' }
      },
      'read',
      { kind: 'document', id: 'doc456' }
    );
    console.log(`Allowed: ${result.allowed}`);

    // Batch check
    const batchResult = await client.batchCheckAuthorization(
      { id: 'user123', roles: ['developer'] },
      'read',
      [
        { kind: 'document', id: 'doc456' },
        { kind: 'document', id: 'doc789' }
      ]
    );
    batchResult.results.forEach(r => {
      console.log(`${r.resource.id}: ${r.allowed}`);
    });

    // Get allowed actions
    const allowed = await client.getAllowedActions(
      'user123',
      'document',
      'doc456',
      ['developer']
    );
    console.log(`Allowed actions: ${allowed.allowed_actions}`);

    // List policies
    const policies = await client.listPolicies(1, 20, { resource_kind: 'document' });
    console.log(`Total policies: ${policies.pagination.total_items}`);

    // Create policy
    const newPolicy = await client.createPolicy({
      id: 'policy-dev-write-docs',
      version: '1.0',
      description: 'Developers can write documentation',
      resource_policy: {
        resource: 'document',
        version: '1.0',
        rules: [
          {
            actions: ['write', 'update'],
            effect: 'EFFECT_ALLOW',
            roles: ['developer']
          }
        ]
      }
    });
    console.log(`Created policy: ${newPolicy.id}`);

    // Export policies
    const exportData = await client.exportPolicies(
      ['policy-dev-read-docs', 'policy-admin-all'],
      'json',
      false
    );

    // Save to file
    await fs.writeFile('policies-export.json', JSON.stringify(exportData, null, 2));

    // Import policies (dry run first)
    const importData = JSON.parse(await fs.readFile('policies-export.json', 'utf8'));

    const dryRunResult = await client.importPolicies(importData, 'create_only', true);
    console.log(`Dry run success: ${dryRunResult.success}`);

    if (dryRunResult.success) {
      // Actual import
      const importResult = await client.importPolicies(importData, 'create_only');
      console.log(`Imported ${importResult.imported_count} policies`);
    }

    // Create backup
    const backup = await client.createBackup(
      'daily-backup',
      'Daily automated backup',
      true
    );
    console.log(`Backup created: ${backup.backup_id}`);

    // Restore from backup (dry run first)
    const restoreResult = await client.restoreBackup(
      'backup-20250127-103000',
      'merge',
      'keep_existing',
      true
    );
    console.log(`Restore dry run: ${restoreResult.message}`);

  } catch (error) {
    if (error.response) {
      // Server responded with error
      console.error(`Error ${error.response.status}: ${error.response.data.error.message}`);
    } else {
      // Request failed
      console.error(`Request failed: ${error.message}`);
    }
  }
})();
```

### Error Handling with Retry

```javascript
async function callWithRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error.response) {
        if (error.response.status === 429) {
          // Rate limited
          const retryAfter = parseInt(error.response.headers['retry-after'] || 60);
          console.log(`Rate limited. Waiting ${retryAfter}s...`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          continue;
        } else if (error.response.status >= 500) {
          // Server error
          const waitTime = Math.pow(2, attempt) * 1000;
          console.log(`Server error. Retrying in ${waitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        } else {
          // Client error - don't retry
          throw error;
        }
      } else {
        // Request failed - retry
        if (attempt < maxRetries - 1) {
          const waitTime = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          throw error;
        }
      }
    }
  }
  throw new Error('Max retries exceeded');
}

// Usage
const result = await callWithRetry(() =>
  client.checkAuthorization(principal, action, resource)
);
```

---

## Go Examples

### Basic Client

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "time"
)

type AuthzClient struct {
    BaseURL    string
    HTTPClient *http.Client
    JWTToken   string
}

func NewAuthzClient(baseURL, jwtToken string) *AuthzClient {
    return &AuthzClient{
        BaseURL: baseURL,
        HTTPClient: &http.Client{
            Timeout: 30 * time.Second,
        },
        JWTToken: jwtToken,
    }
}

func (c *AuthzClient) doRequest(method, path string, body interface{}) ([]byte, error) {
    var reqBody io.Reader
    if body != nil {
        jsonData, err := json.Marshal(body)
        if err != nil {
            return nil, fmt.Errorf("marshal request: %w", err)
        }
        reqBody = bytes.NewBuffer(jsonData)
    }

    req, err := http.NewRequest(method, c.BaseURL+path, reqBody)
    if err != nil {
        return nil, fmt.Errorf("create request: %w", err)
    }

    req.Header.Set("Authorization", "Bearer "+c.JWTToken)
    req.Header.Set("Content-Type", "application/json")

    resp, err := c.HTTPClient.Do(req)
    if err != nil {
        return nil, fmt.Errorf("do request: %w", err)
    }
    defer resp.Body.Close()

    respBody, err := io.ReadAll(resp.Body)
    if err != nil {
        return nil, fmt.Errorf("read response: %w", err)
    }

    if resp.StatusCode >= 400 {
        return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, string(respBody))
    }

    return respBody, nil
}

type Principal struct {
    ID         string                 `json:"id"`
    Roles      []string               `json:"roles"`
    Attributes map[string]interface{} `json:"attributes,omitempty"`
}

type Resource struct {
    Kind       string                 `json:"kind"`
    ID         string                 `json:"id"`
    Attributes map[string]interface{} `json:"attributes,omitempty"`
}

type AuthorizationCheckRequest struct {
    Principal Principal              `json:"principal"`
    Action    string                 `json:"action"`
    Resource  Resource               `json:"resource"`
    Context   map[string]interface{} `json:"context,omitempty"`
}

type AuthorizationCheckResponse struct {
    Allowed         bool     `json:"allowed"`
    DecisionTimeMs  int      `json:"decision_time_ms"`
    MatchedPolicies []string `json:"matched_policies,omitempty"`
    Reason          string   `json:"reason,omitempty"`
}

func (c *AuthzClient) CheckAuthorization(req AuthorizationCheckRequest) (*AuthorizationCheckResponse, error) {
    respBody, err := c.doRequest("POST", "/authorization/check", req)
    if err != nil {
        return nil, err
    }

    var result AuthorizationCheckResponse
    if err := json.Unmarshal(respBody, &result); err != nil {
        return nil, fmt.Errorf("unmarshal response: %w", err)
    }

    return &result, nil
}

type BatchAuthorizationCheckRequest struct {
    Principal Principal              `json:"principal"`
    Action    string                 `json:"action"`
    Resources []Resource             `json:"resources"`
    Context   map[string]interface{} `json:"context,omitempty"`
}

type ResourceResult struct {
    Resource        Resource `json:"resource"`
    Allowed         bool     `json:"allowed"`
    DecisionTimeMs  int      `json:"decision_time_ms"`
    MatchedPolicies []string `json:"matched_policies,omitempty"`
    Reason          string   `json:"reason,omitempty"`
}

type BatchAuthorizationCheckResponse struct {
    Results      []ResourceResult `json:"results"`
    TotalTimeMs  int              `json:"total_time_ms"`
}

func (c *AuthzClient) BatchCheckAuthorization(req BatchAuthorizationCheckRequest) (*BatchAuthorizationCheckResponse, error) {
    respBody, err := c.doRequest("POST", "/authorization/check-resources", req)
    if err != nil {
        return nil, err
    }

    var result BatchAuthorizationCheckResponse
    if err := json.Unmarshal(respBody, &result); err != nil {
        return nil, fmt.Errorf("unmarshal response: %w", err)
    }

    return &result, nil
}

type Policy struct {
    ID              string                 `json:"id"`
    Version         string                 `json:"version"`
    Description     string                 `json:"description,omitempty"`
    ResourcePolicy  map[string]interface{} `json:"resource_policy,omitempty"`
    PrincipalPolicy map[string]interface{} `json:"principal_policy,omitempty"`
    DerivedRoles    map[string]interface{} `json:"derived_roles,omitempty"`
}

func (c *AuthzClient) ListPolicies(page, pageSize int, filters map[string]string) (map[string]interface{}, error) {
    path := fmt.Sprintf("/policies?page=%d&page_size=%d", page, pageSize)
    for k, v := range filters {
        path += fmt.Sprintf("&%s=%s", k, v)
    }

    respBody, err := c.doRequest("GET", path, nil)
    if err != nil {
        return nil, err
    }

    var result map[string]interface{}
    if err := json.Unmarshal(respBody, &result); err != nil {
        return nil, fmt.Errorf("unmarshal response: %w", err)
    }

    return result, nil
}

func (c *AuthzClient) CreatePolicy(policy Policy) (map[string]interface{}, error) {
    respBody, err := c.doRequest("POST", "/policies", policy)
    if err != nil {
        return nil, err
    }

    var result map[string]interface{}
    if err := json.Unmarshal(respBody, &result); err != nil {
        return nil, fmt.Errorf("unmarshal response: %w", err)
    }

    return result, nil
}

func (c *AuthzClient) ExportPolicies(policyIDs []string, format string, includePrincipals bool) (map[string]interface{}, error) {
    req := map[string]interface{}{
        "format":             format,
        "include_principals": includePrincipals,
    }
    if len(policyIDs) > 0 {
        req["policy_ids"] = policyIDs
    }

    respBody, err := c.doRequest("POST", "/policies/export", req)
    if err != nil {
        return nil, err
    }

    var result map[string]interface{}
    if err := json.Unmarshal(respBody, &result); err != nil {
        return nil, fmt.Errorf("unmarshal response: %w", err)
    }

    return result, nil
}

func main() {
    client := NewAuthzClient(
        "http://localhost:8080/v1",
        "your-jwt-token",
    )

    // Check authorization
    result, err := client.CheckAuthorization(AuthorizationCheckRequest{
        Principal: Principal{
            ID:    "user123",
            Roles: []string{"developer"},
            Attributes: map[string]interface{}{
                "department": "engineering",
                "level":      "senior",
            },
        },
        Action: "read",
        Resource: Resource{
            Kind: "document",
            ID:   "doc456",
        },
    })
    if err != nil {
        fmt.Printf("Error: %v\n", err)
        return
    }

    fmt.Printf("Allowed: %v\n", result.Allowed)
    fmt.Printf("Decision time: %dms\n", result.DecisionTimeMs)

    // Batch check
    batchResult, err := client.BatchCheckAuthorization(BatchAuthorizationCheckRequest{
        Principal: Principal{
            ID:    "user123",
            Roles: []string{"developer"},
        },
        Action: "read",
        Resources: []Resource{
            {Kind: "document", ID: "doc456"},
            {Kind: "document", ID: "doc789"},
        },
    })
    if err != nil {
        fmt.Printf("Error: %v\n", err)
        return
    }

    for _, r := range batchResult.Results {
        fmt.Printf("%s: %v\n", r.Resource.ID, r.Allowed)
    }

    // Create policy
    newPolicy, err := client.CreatePolicy(Policy{
        ID:          "policy-dev-write-docs",
        Version:     "1.0",
        Description: "Developers can write documentation",
        ResourcePolicy: map[string]interface{}{
            "resource": "document",
            "version":  "1.0",
            "rules": []map[string]interface{}{
                {
                    "actions": []string{"write", "update"},
                    "effect":  "EFFECT_ALLOW",
                    "roles":   []string{"developer"},
                },
            },
        },
    })
    if err != nil {
        fmt.Printf("Error: %v\n", err)
        return
    }

    fmt.Printf("Created policy: %v\n", newPolicy["id"])

    // Export policies
    exportData, err := client.ExportPolicies(
        []string{"policy-dev-read-docs", "policy-admin-all"},
        "json",
        false,
    )
    if err != nil {
        fmt.Printf("Error: %v\n", err)
        return
    }

    fmt.Printf("Exported %v policies\n", len(exportData["policies"].([]interface{})))
}
```

---

## Java Examples

### Basic Client

```java
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;

public class AuthzClient {
    private final String baseUrl;
    private final String jwtToken;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    public AuthzClient(String baseUrl, String jwtToken) {
        this.baseUrl = baseUrl;
        this.jwtToken = jwtToken;
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(30))
            .build();
        this.objectMapper = new ObjectMapper();
    }

    private HttpRequest.Builder requestBuilder(String path) {
        return HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + path))
            .header("Authorization", "Bearer " + jwtToken)
            .header("Content-Type", "application/json");
    }

    public record Principal(
        String id,
        List<String> roles,
        Map<String, Object> attributes
    ) {}

    public record Resource(
        String kind,
        String id,
        Map<String, Object> attributes
    ) {}

    public record AuthorizationCheckRequest(
        Principal principal,
        String action,
        Resource resource,
        Map<String, Object> context
    ) {}

    public record AuthorizationCheckResponse(
        boolean allowed,
        int decisionTimeMs,
        List<String> matchedPolicies,
        String reason
    ) {}

    public AuthorizationCheckResponse checkAuthorization(AuthorizationCheckRequest request)
        throws Exception {
        String json = objectMapper.writeValueAsString(request);

        HttpRequest httpRequest = requestBuilder("/authorization/check")
            .POST(HttpRequest.BodyPublishers.ofString(json))
            .build();

        HttpResponse<String> response = httpClient.send(
            httpRequest,
            HttpResponse.BodyHandlers.ofString()
        );

        if (response.statusCode() >= 400) {
            throw new RuntimeException("API error " + response.statusCode() + ": " + response.body());
        }

        return objectMapper.readValue(response.body(), AuthorizationCheckResponse.class);
    }

    public static void main(String[] args) {
        try {
            AuthzClient client = new AuthzClient(
                "http://localhost:8080/v1",
                "your-jwt-token"
            );

            // Check authorization
            AuthorizationCheckResponse result = client.checkAuthorization(
                new AuthorizationCheckRequest(
                    new Principal(
                        "user123",
                        List.of("developer"),
                        Map.of("department", "engineering", "level", "senior")
                    ),
                    "read",
                    new Resource("document", "doc456", null),
                    null
                )
            );

            System.out.println("Allowed: " + result.allowed());
            System.out.println("Decision time: " + result.decisionTimeMs() + "ms");

        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
```

---

## Additional Resources

- **OpenAPI Specification**: See [api/openapi.yaml](../api/openapi.yaml)
- **REST API Guide**: See [REST_API_GUIDE.md](./REST_API_GUIDE.md)
- **Postman Collection**: See [POSTMAN_COLLECTION.json](./POSTMAN_COLLECTION.json)

---

**Version**: 1.0.0
**Last Updated**: 2025-01-27
**Maintainer**: Authorization Engine Team
