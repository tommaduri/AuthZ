# Policy Export/Import Guide

## Table of Contents

1. [Overview](#overview)
2. [Export Formats](#export-formats)
3. [Import Validation](#import-validation)
4. [Dry-Run Mode](#dry-run-mode)
5. [Import Strategies](#import-strategies)
6. [Backup and Restore](#backup-and-restore)
7. [Migration Scenarios](#migration-scenarios)
8. [Troubleshooting](#troubleshooting)

---

## Overview

The Authorization Engine provides comprehensive export/import functionality for policies and principals, enabling:

- **Environment Migration**: Move policies between dev, staging, and production
- **Backup and Restore**: Create point-in-time backups and restore data
- **Version Control**: Track policy changes in Git
- **Disaster Recovery**: Quick recovery from data loss
- **Multi-tenancy**: Migrate policies between tenants

### Key Features

- ✅ **Multiple Formats**: JSON and YAML support
- ✅ **Validation**: Dry-run mode for testing
- ✅ **Flexible Strategies**: Create-only, overwrite, merge modes
- ✅ **Batch Operations**: Import hundreds of policies efficiently
- ✅ **Metadata Preservation**: Include timestamps and authorship
- ✅ **Principal Support**: Export/import principals with policies
- ✅ **Error Recovery**: Detailed error reporting and rollback

---

## Export Formats

### JSON Format

The default format for exports is JSON, providing a structured representation of policies.

**Basic Export Structure:**
```json
{
  "format": "json",
  "policies": [
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
  ],
  "metadata": {
    "exported_at": "2025-01-27T10:30:00Z",
    "exported_by": "admin",
    "total_policies": 1,
    "format_version": "1.0"
  }
}
```

**Export with Principals:**
```json
{
  "format": "json",
  "policies": [ ... ],
  "principals": [
    {
      "id": "user123",
      "roles": ["developer", "team-lead"],
      "attributes": {
        "department": "engineering",
        "level": "senior"
      }
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

### YAML Format

YAML provides a human-readable format ideal for version control.

**Basic Export Structure:**
```yaml
format: yaml
policies:
  - id: policy-dev-read-docs
    version: "1.0"
    description: Developers can read documentation
    resource_policy:
      resource: document
      version: "1.0"
      rules:
        - actions: [read, list]
          effect: EFFECT_ALLOW
          roles: [developer]
metadata:
  exported_at: "2025-01-27T10:30:00Z"
  exported_by: admin
  total_policies: 1
  format_version: "1.0"
```

**Export with Principals:**
```yaml
format: yaml
policies:
  - id: policy-dev-read-docs
    version: "1.0"
    resource_policy:
      resource: document
      version: "1.0"
      rules:
        - actions: [read]
          effect: EFFECT_ALLOW
          roles: [developer]
principals:
  - id: user123
    roles: [developer, team-lead]
    attributes:
      department: engineering
      level: senior
metadata:
  exported_at: "2025-01-27T10:30:00Z"
  exported_by: admin
  total_policies: 1
  total_principals: 1
  format_version: "1.0"
```

### Bundle Format

Bundle format includes checksums and validation data for integrity verification.

```json
{
  "format": "bundle",
  "version": "1.0",
  "bundle_id": "bundle-20250127-103000",
  "created_at": "2025-01-27T10:30:00Z",
  "policies": [ ... ],
  "principals": [ ... ],
  "checksums": {
    "policies": "sha256:abc123...",
    "principals": "sha256:def456...",
    "bundle": "sha256:ghi789..."
  },
  "metadata": {
    "exported_by": "admin",
    "source_environment": "production",
    "total_policies": 150,
    "total_principals": 1000
  }
}
```

### Export All Policies

**API Request:**
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

### Export Specific Policies

**API Request:**
```bash
curl -X POST http://localhost:8080/v1/policies/export \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "policy_ids": [
      "policy-dev-read-docs",
      "policy-admin-all",
      "policy-senior-dev"
    ],
    "format": "json",
    "include_metadata": true
  }' > selected-policies.json
```

### Export by Resource Kind

To export policies for a specific resource kind, use filtering:

**API Request:**
```bash
# First, list policies filtered by resource kind
curl -X GET "http://localhost:8080/v1/policies?resource_kind=document" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  | jq '.policies[].id' > policy-ids.txt

# Then export those specific policies
curl -X POST http://localhost:8080/v1/policies/export \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "policy_ids": '"$(cat policy-ids.txt | jq -Rs 'split("\n") | map(select(length > 0))')"',
    "format": "json"
  }' > document-policies.json
```

### Export Format Comparison

| Feature | JSON | YAML | Bundle |
|---------|------|------|--------|
| Human-readable | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| Machine-readable | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Version control | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Integrity verification | ❌ | ❌ | ✅ |
| Size | Medium | Large | Medium |
| Best for | APIs, automation | Git, manual editing | Backups, compliance |

---

## Import Validation

### Validation Levels

#### Level 1: Schema Validation

Validates JSON/YAML structure and required fields.

**Checks:**
- Valid JSON/YAML syntax
- Required fields present (id, version, etc.)
- Correct data types (strings, arrays, objects)
- Enum values (EFFECT_ALLOW, EFFECT_DENY)

**Example Error:**
```json
{
  "policy_id": "policy-invalid",
  "error": "Schema validation failed: missing required field 'resource_policy.resource'"
}
```

#### Level 2: Semantic Validation

Validates policy logic and references.

**Checks:**
- Valid resource kinds
- Valid action names
- Role references exist
- No circular dependencies
- Condition expressions valid (CEL syntax)

**Example Error:**
```json
{
  "policy_id": "policy-invalid-cel",
  "error": "Invalid CEL expression: 'P.attr.level = senior' (expected '==' not '=')"
}
```

#### Level 3: Conflict Detection

Detects conflicts with existing policies.

**Checks:**
- Duplicate policy IDs
- Conflicting rules (explicit deny vs allow)
- Overlapping derived role conditions
- Principal conflicts

**Example Error:**
```json
{
  "policy_id": "policy-dev-read-docs",
  "error": "Policy already exists (created: 2025-01-20T10:00:00Z)",
  "suggestion": "Use mode='overwrite' to replace existing policy"
}
```

### Validation Process

```
┌─────────────────────────────────────────────────────────────┐
│                    Import Validation Flow                   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  1. Parse Input (JSON/YAML)                                 │
│     - Validate syntax                                       │
│     - Check format version                                  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  2. Schema Validation                                       │
│     - Required fields                                       │
│     - Data types                                            │
│     - Enum values                                           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  3. Semantic Validation                                     │
│     - Resource kinds valid                                  │
│     - Actions valid                                         │
│     - CEL expressions valid                                 │
│     - References resolvable                                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  4. Conflict Detection (if mode != create_only)             │
│     - Check existing policies                               │
│     - Detect overlaps                                       │
│     - Identify conflicts                                    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  5. Dry-Run Report (if dry_run=true)                        │
│     - Validation results                                    │
│     - Warnings                                              │
│     - Recommended actions                                   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  6. Import Execution (if dry_run=false)                     │
│     - Transaction start                                     │
│     - Apply changes                                         │
│     - Update indices                                        │
│     - Transaction commit/rollback                           │
└─────────────────────────────────────────────────────────────┘
```

### Pre-Import Validation Script

**Bash Script:**
```bash
#!/bin/bash

POLICIES_FILE="$1"
API_URL="http://localhost:8080/v1"
JWT_TOKEN="$2"

echo "Validating $POLICIES_FILE..."

# Validate JSON/YAML syntax
if [[ "$POLICIES_FILE" == *.json ]]; then
  if ! jq empty "$POLICIES_FILE" 2>/dev/null; then
    echo "❌ Invalid JSON syntax"
    exit 1
  fi
  echo "✅ JSON syntax valid"
elif [[ "$POLICIES_FILE" == *.yaml ]] || [[ "$POLICIES_FILE" == *.yml ]]; then
  if ! python -c "import yaml; yaml.safe_load(open('$POLICIES_FILE'))" 2>/dev/null; then
    echo "❌ Invalid YAML syntax"
    exit 1
  fi
  echo "✅ YAML syntax valid"
fi

# Perform dry-run import
echo "Performing dry-run import..."
RESPONSE=$(curl -s -X POST "$API_URL/policies/import" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @"$POLICIES_FILE" \
  -d '{"dry_run": true}')

SUCCESS=$(echo "$RESPONSE" | jq -r '.success')
if [ "$SUCCESS" == "true" ]; then
  echo "✅ Validation successful"
  echo "$RESPONSE" | jq '.validation_details'
else
  echo "❌ Validation failed"
  echo "$RESPONSE" | jq '.errors'
  exit 1
fi
```

**Usage:**
```bash
./validate-import.sh policies.json $JWT_TOKEN
```

---

## Dry-Run Mode

### What is Dry-Run?

Dry-run mode validates import operations without applying changes. It's essential for:

- Testing imports before execution
- Identifying issues early
- Planning rollout strategies
- Compliance and change management

### Enable Dry-Run

**API Request:**
```bash
curl -X POST http://localhost:8080/v1/policies/import \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "json",
    "policies": [ ... ],
    "dry_run": true
  }'
```

### Dry-Run Response

**Successful Validation:**
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
      "policy_id": "policy-dev-read-docs",
      "status": "valid",
      "message": "Policy format is valid"
    },
    {
      "policy_id": "policy-admin-all",
      "status": "valid",
      "message": "Policy format is valid"
    }
  ]
}
```

**Validation with Warnings:**
```json
{
  "success": true,
  "imported_count": 0,
  "skipped_count": 0,
  "failed_count": 0,
  "dry_run": true,
  "message": "Validation successful with warnings",
  "validation_details": [
    {
      "policy_id": "policy-existing",
      "status": "valid",
      "message": "Policy is valid",
      "warning": "Policy already exists. Will be skipped in create_only mode."
    },
    {
      "policy_id": "policy-complex-condition",
      "status": "valid",
      "message": "Policy is valid",
      "warning": "Complex CEL expression may impact performance"
    }
  ]
}
```

**Validation Failures:**
```json
{
  "success": false,
  "imported_count": 0,
  "skipped_count": 0,
  "failed_count": 2,
  "dry_run": true,
  "message": "Validation failed: 2 policies have errors",
  "errors": [
    {
      "policy_id": "policy-invalid-1",
      "error": "Missing required field: resource_policy.resource"
    },
    {
      "policy_id": "policy-invalid-2",
      "error": "Invalid CEL expression: P.attr.level = 'senior' (use '==' for comparison)"
    }
  ]
}
```

### Dry-Run Best Practices

1. **Always Dry-Run First**: Test before actual import
2. **Review Warnings**: Address warnings even if validation passes
3. **Test in Staging**: Run dry-run in staging environment first
4. **Document Results**: Save dry-run output for audit trail
5. **Automate**: Include dry-run in CI/CD pipelines

### Dry-Run in CI/CD Pipeline

**GitHub Actions Example:**
```yaml
name: Validate Policy Changes

on:
  pull_request:
    paths:
      - 'policies/**'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Get changed policies
        id: changed-files
        uses: tj-actions/changed-files@v35
        with:
          files: policies/*.json

      - name: Dry-run import
        env:
          JWT_TOKEN: ${{ secrets.AUTHZ_API_TOKEN }}
        run: |
          for file in ${{ steps.changed-files.outputs.all_changed_files }}; do
            echo "Validating $file..."
            response=$(curl -s -X POST http://localhost:8080/v1/policies/import \
              -H "Authorization: Bearer $JWT_TOKEN" \
              -H "Content-Type: application/json" \
              --data-binary @"$file" \
              -d '{"dry_run": true}')

            success=$(echo "$response" | jq -r '.success')
            if [ "$success" != "true" ]; then
              echo "❌ Validation failed for $file"
              echo "$response" | jq '.errors'
              exit 1
            fi
            echo "✅ Validation passed for $file"
          done
```

---

## Import Strategies

### Strategy 1: Create Only (Default)

Only creates new policies. Skips existing policies without error.

**Use Cases:**
- Adding new policies to existing set
- Incremental migrations
- Safe imports without data loss

**API Request:**
```bash
curl -X POST http://localhost:8080/v1/policies/import \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "json",
    "policies": [ ... ],
    "mode": "create_only"
  }'
```

**Response:**
```json
{
  "success": true,
  "imported_count": 3,
  "skipped_count": 2,
  "failed_count": 0,
  "message": "Imported 3 policies, skipped 2 existing policies",
  "skipped": [
    {
      "policy_id": "policy-existing-1",
      "reason": "Policy already exists"
    },
    {
      "policy_id": "policy-existing-2",
      "reason": "Policy already exists"
    }
  ]
}
```

### Strategy 2: Overwrite

Replaces existing policies with imported versions.

**Use Cases:**
- Updating existing policies
- Synchronized deployments
- Version upgrades

**API Request:**
```bash
curl -X POST http://localhost:8080/v1/policies/import \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "json",
    "policies": [ ... ],
    "mode": "overwrite"
  }'
```

**Response:**
```json
{
  "success": true,
  "imported_count": 5,
  "skipped_count": 0,
  "failed_count": 0,
  "message": "Successfully imported 5 policies (3 created, 2 updated)"
}
```

**Warning:** Overwrites can lose data. Always backup before overwriting.

### Strategy 3: Merge

Intelligently merges imported policies with existing ones.

**Use Cases:**
- Complex migrations
- Gradual rollouts
- Policy consolidation

**Merge Behavior:**
- **New policies**: Created
- **Existing policies**: Merged based on rules
  - New rules: Added
  - Existing rules: Updated if different
  - Removed rules: Kept (unless explicitly removed)

**API Request:**
```bash
curl -X POST http://localhost:8080/v1/policies/import \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "json",
    "policies": [ ... ],
    "mode": "merge"
  }'
```

**Response:**
```json
{
  "success": true,
  "imported_count": 5,
  "merged_count": 3,
  "skipped_count": 0,
  "failed_count": 0,
  "message": "Imported 2 new policies, merged 3 existing policies",
  "merge_details": [
    {
      "policy_id": "policy-dev-read-docs",
      "action": "merged",
      "changes": {
        "rules_added": 1,
        "rules_updated": 0,
        "rules_removed": 0
      }
    }
  ]
}
```

### Strategy Comparison

| Strategy | Creates New | Updates Existing | Data Loss Risk | Use Case |
|----------|-------------|------------------|----------------|----------|
| create_only | ✅ | ❌ | ⭐ Low | Safe incremental imports |
| overwrite | ✅ | ✅ (replaces) | ⭐⭐⭐ High | Full synchronization |
| merge | ✅ | ✅ (combines) | ⭐⭐ Medium | Complex migrations |

### Choosing the Right Strategy

**Use create_only when:**
- Adding new policies to production
- Risk of data loss is unacceptable
- Existing policies should not change
- Incremental rollout needed

**Use overwrite when:**
- Synchronizing environments (dev → prod)
- Policy versions are controlled externally (Git)
- You have recent backups
- Complete replacement is desired

**Use merge when:**
- Consolidating policies from multiple sources
- Gradual migration of rules
- Preserving custom changes
- Complex migration scenarios

---

## Backup and Restore

### Creating Backups

**API Request:**
```bash
curl -X POST http://localhost:8080/v1/policies/backup \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "pre-deployment-backup",
    "description": "Backup before v2.0 deployment",
    "include_principals": true
  }'
```

**Response:**
```json
{
  "backup_id": "backup-20250127-103000",
  "name": "pre-deployment-backup",
  "created_at": "2025-01-27T10:30:00Z",
  "size_bytes": 1048576,
  "policy_count": 150,
  "principal_count": 1000,
  "format": "json",
  "checksum": "sha256:abc123def456..."
}
```

### Backup Metadata

Backups include comprehensive metadata:

```json
{
  "backup_id": "backup-20250127-103000",
  "name": "pre-deployment-backup",
  "description": "Backup before v2.0 deployment",
  "created_at": "2025-01-27T10:30:00Z",
  "created_by": "admin",
  "environment": "production",
  "api_version": "1.0",
  "policy_count": 150,
  "principal_count": 1000,
  "size_bytes": 1048576,
  "compressed": true,
  "encrypted": true,
  "checksum": "sha256:abc123def456...",
  "retention_days": 90,
  "tags": ["production", "v2.0", "deployment"]
}
```

### Restoring from Backup

#### Full Restore (Replace All)

**Warning:** This deletes ALL existing data and restores from backup.

**API Request:**
```bash
curl -X POST http://localhost:8080/v1/policies/restore \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "backup_id": "backup-20250127-103000",
    "mode": "replace_all"
  }'
```

**Response:**
```json
{
  "success": true,
  "restored_policies": 150,
  "restored_principals": 1000,
  "deleted_policies": 175,
  "deleted_principals": 1050,
  "skipped_count": 0,
  "failed_count": 0,
  "message": "Successfully restored 150 policies and 1000 principals"
}
```

#### Merge Restore

Merges backup data with existing data.

**API Request:**
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

**Conflict Resolution Options:**
- `keep_existing`: Keep current data on conflict (default)
- `overwrite`: Use backup data on conflict
- `fail`: Fail restore on any conflict

**Response:**
```json
{
  "success": true,
  "restored_policies": 120,
  "restored_principals": 950,
  "skipped_count": 30,
  "failed_count": 0,
  "conflicts_resolved": 30,
  "message": "Restored 120 policies, skipped 30 due to conflicts (kept existing)",
  "skipped": [
    {
      "policy_id": "policy-modified",
      "reason": "Conflict: existing policy modified after backup"
    }
  ]
}
```

### Restore Dry-Run

Always test restore before execution:

**API Request:**
```bash
curl -X POST http://localhost:8080/v1/policies/restore \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "backup_id": "backup-20250127-103000",
    "mode": "replace_all",
    "dry_run": true
  }'
```

**Response:**
```json
{
  "success": true,
  "restored_policies": 0,
  "restored_principals": 0,
  "dry_run": true,
  "message": "Restore validation successful",
  "preview": {
    "will_restore_policies": 150,
    "will_restore_principals": 1000,
    "will_delete_policies": 175,
    "will_delete_principals": 1050,
    "estimated_duration": "5-10 seconds"
  }
}
```

### Backup Verification

Verify backup integrity before restore:

**API Request:**
```bash
curl -X POST http://localhost:8080/v1/policies/backup/{backup_id}/verify \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Response:**
```json
{
  "valid": true,
  "backup_id": "backup-20250127-103000",
  "checksum_verified": true,
  "structure_valid": true,
  "policies_valid": 150,
  "policies_invalid": 0,
  "principals_valid": 1000,
  "principals_invalid": 0,
  "message": "Backup is valid and ready to restore"
}
```

### Automated Backup Strategy

**Daily Backup Script:**
```bash
#!/bin/bash

API_URL="http://localhost:8080/v1"
JWT_TOKEN="your-jwt-token"
BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d-%H%M%S)

echo "Creating backup at $(date)"

# Create backup via API
BACKUP_RESPONSE=$(curl -s -X POST "$API_URL/policies/backup" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"auto-backup-$DATE\",
    \"description\": \"Automated daily backup\",
    \"include_principals\": true
  }")

BACKUP_ID=$(echo "$BACKUP_RESPONSE" | jq -r '.backup_id')
CHECKSUM=$(echo "$BACKUP_RESPONSE" | jq -r '.checksum')

echo "Backup created: $BACKUP_ID"
echo "Checksum: $CHECKSUM"

# Export backup to file
curl -s -X POST "$API_URL/policies/export" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{"format": "json", "include_principals": true}' \
  > "$BACKUP_DIR/backup-$DATE.json"

# Verify checksum
FILE_CHECKSUM=$(sha256sum "$BACKUP_DIR/backup-$DATE.json" | awk '{print $1}')
if [ "$FILE_CHECKSUM" == "${CHECKSUM#sha256:}" ]; then
  echo "✅ Checksum verified"
else
  echo "❌ Checksum mismatch!"
  exit 1
fi

# Compress backup
gzip "$BACKUP_DIR/backup-$DATE.json"

# Delete old backups (keep last 7 days)
find "$BACKUP_DIR" -name "backup-*.json.gz" -mtime +7 -delete

echo "Backup complete: $BACKUP_DIR/backup-$DATE.json.gz"
```

**Cron Job (daily at 2 AM):**
```
0 2 * * * /opt/authz-engine/backup-daily.sh >> /var/log/authz-backup.log 2>&1
```

### Backup Retention Policy

**Recommended Strategy:**
- **Daily backups**: Keep for 7 days
- **Weekly backups**: Keep for 4 weeks
- **Monthly backups**: Keep for 12 months
- **Yearly backups**: Keep indefinitely

**Implementation:**
```bash
#!/bin/bash

BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d)
DAY_OF_WEEK=$(date +%u)  # 1-7 (Monday-Sunday)
DAY_OF_MONTH=$(date +%d)

# Determine backup type
if [ "$DAY_OF_MONTH" == "01" ]; then
  BACKUP_TYPE="monthly"
  RETENTION=365
elif [ "$DAY_OF_WEEK" == "7" ]; then
  BACKUP_TYPE="weekly"
  RETENTION=28
else
  BACKUP_TYPE="daily"
  RETENTION=7
fi

# Create backup with appropriate name
BACKUP_NAME="$BACKUP_TYPE-backup-$DATE"

# ... create backup ...

# Apply retention policy
find "$BACKUP_DIR" -name "$BACKUP_TYPE-backup-*.json.gz" -mtime +$RETENTION -delete
```

---

## Migration Scenarios

### Scenario 1: Development to Production Migration

**Objective**: Safely migrate tested policies from dev to production.

**Steps:**

1. **Export from Development:**
```bash
curl -X POST https://dev-api.example.com/v1/policies/export \
  -H "Authorization: Bearer $DEV_TOKEN" \
  -d '{"format": "json", "include_principals": false}' \
  > dev-policies.json
```

2. **Review Exported Policies:**
```bash
# List policy IDs
jq -r '.policies[].id' dev-policies.json

# Review policy details
jq '.policies[] | {id, version, description}' dev-policies.json
```

3. **Create Production Backup:**
```bash
curl -X POST https://prod-api.example.com/v1/policies/backup \
  -H "Authorization: Bearer $PROD_TOKEN" \
  -d '{
    "name": "pre-migration-backup",
    "description": "Backup before dev→prod migration"
  }'
```

4. **Dry-Run Import to Production:**
```bash
curl -X POST https://prod-api.example.com/v1/policies/import \
  -H "Authorization: Bearer $PROD_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @dev-policies.json \
  -d '{"dry_run": true, "mode": "create_only"}'
```

5. **Review Dry-Run Results:**
```bash
# Check for errors
jq '.errors' dry-run-response.json

# Check for warnings
jq '.validation_details[] | select(.warning)' dry-run-response.json
```

6. **Import to Production:**
```bash
curl -X POST https://prod-api.example.com/v1/policies/import \
  -H "Authorization: Bearer $PROD_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @dev-policies.json \
  -d '{"mode": "create_only"}'
```

7. **Verify Import:**
```bash
# Check imported policies
for policy_id in $(jq -r '.policies[].id' dev-policies.json); do
  echo "Verifying $policy_id..."
  curl -s -X GET "https://prod-api.example.com/v1/policies/$policy_id" \
    -H "Authorization: Bearer $PROD_TOKEN" \
    | jq '{id, version}'
done
```

### Scenario 2: Blue-Green Deployment

**Objective**: Deploy new policy version with zero downtime and instant rollback capability.

**Architecture:**
- **Blue**: Current production environment
- **Green**: New environment with updated policies
- **Load Balancer**: Routes traffic between blue and green

**Steps:**

1. **Prepare Green Environment:**
```bash
# Deploy new infrastructure
terraform apply -var="environment=green"

# Export current policies from blue
curl -X POST https://blue-api.example.com/v1/policies/export \
  -H "Authorization: Bearer $BLUE_TOKEN" \
  -d '{"format": "json", "include_principals": true}' \
  > blue-policies.json
```

2. **Import to Green:**
```bash
# Import existing policies
curl -X POST https://green-api.example.com/v1/policies/import \
  -H "Authorization: Bearer $GREEN_TOKEN" \
  --data-binary @blue-policies.json

# Import new/updated policies
curl -X POST https://green-api.example.com/v1/policies/import \
  -H "Authorization: Bearer $GREEN_TOKEN" \
  --data-binary @new-policies.json \
  -d '{"mode": "overwrite"}'
```

3. **Smoke Test Green:**
```bash
# Test critical authorization flows
./smoke-test.sh https://green-api.example.com
```

4. **Gradual Traffic Shift:**
```bash
# Route 10% traffic to green
aws elbv2 modify-target-group-weight --green-weight 10 --blue-weight 90

# Monitor for 15 minutes
sleep 900

# Route 50% traffic to green
aws elbv2 modify-target-group-weight --green-weight 50 --blue-weight 50

# Monitor for 15 minutes
sleep 900

# Route 100% traffic to green
aws elbv2 modify-target-group-weight --green-weight 100 --blue-weight 0
```

5. **Verify Success:**
```bash
# Monitor error rates
./monitor-errors.sh https://green-api.example.com
```

6. **Rollback if Needed:**
```bash
# Instant rollback to blue
aws elbv2 modify-target-group-weight --green-weight 0 --blue-weight 100
```

7. **Decommission Blue:**
```bash
# After successful deployment
terraform destroy -var="environment=blue"
```

### Scenario 3: Multi-Tenant Policy Migration

**Objective**: Migrate policies for multiple tenants with isolation.

**Steps:**

1. **Export Per-Tenant Policies:**
```bash
#!/bin/bash

TENANTS=("tenant-a" "tenant-b" "tenant-c")

for tenant in "${TENANTS[@]}"; do
  echo "Exporting policies for $tenant..."

  # List policies for tenant (filtered by naming convention)
  curl -X GET "http://localhost:8080/v1/policies" \
    -H "Authorization: Bearer $JWT_TOKEN" \
    | jq ".policies[] | select(.id | startswith(\"$tenant-\"))" \
    > "$tenant-policies.json"

  # Export specific tenant policies
  POLICY_IDS=$(jq -r '.id' "$tenant-policies.json" | jq -Rs 'split("\n") | map(select(length > 0))')

  curl -X POST http://localhost:8080/v1/policies/export \
    -H "Authorization: Bearer $JWT_TOKEN" \
    -d "{
      \"policy_ids\": $POLICY_IDS,
      \"format\": \"json\"
    }" > "$tenant-policies-export.json"

  echo "Exported $(jq '.policies | length' $tenant-policies-export.json) policies for $tenant"
done
```

2. **Validate Tenant Policies:**
```bash
for tenant in "${TENANTS[@]}"; do
  echo "Validating $tenant policies..."

  curl -X POST http://localhost:8080/v1/policies/import \
    -H "Authorization: Bearer $JWT_TOKEN" \
    --data-binary @"$tenant-policies-export.json" \
    -d '{"dry_run": true}'
done
```

3. **Import to Target Environment:**
```bash
for tenant in "${TENANTS[@]}"; do
  echo "Importing $tenant policies..."

  curl -X POST https://target-api.example.com/v1/policies/import \
    -H "Authorization: Bearer $TARGET_TOKEN" \
    --data-binary @"$tenant-policies-export.json" \
    -d '{"mode": "create_only"}'

  echo "Imported policies for $tenant"
  sleep 5  # Rate limiting
done
```

### Scenario 4: Version Control Integration

**Objective**: Track policy changes in Git with automated validation.

**Repository Structure:**
```
policies/
├── production/
│   ├── resource-policies/
│   │   ├── document-policies.json
│   │   ├── repository-policies.json
│   │   └── application-policies.json
│   ├── principal-policies/
│   │   ├── admin-policies.json
│   │   └── developer-policies.json
│   └── derived-roles/
│       └── senior-roles.json
├── staging/
│   └── ...
└── development/
    └── ...
```

**Git Workflow:**

1. **Developer Makes Changes:**
```bash
# Edit policy file
vim policies/development/resource-policies/document-policies.json

# Commit changes
git add policies/development/
git commit -m "feat: add write permission for senior developers"
git push origin feature/senior-dev-write
```

2. **CI Pipeline Validates (GitHub Actions):**
```yaml
# .github/workflows/validate-policies.yml
name: Validate Policies

on:
  pull_request:
    paths:
      - 'policies/**'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Get changed files
        id: changed-files
        uses: tj-actions/changed-files@v35
        with:
          files: policies/**/*.json

      - name: Validate syntax
        run: |
          for file in ${{ steps.changed-files.outputs.all_changed_files }}; do
            echo "Validating $file..."
            jq empty "$file" || exit 1
          done

      - name: Dry-run import
        env:
          JWT_TOKEN: ${{ secrets.AUTHZ_DEV_TOKEN }}
        run: |
          for file in ${{ steps.changed-files.outputs.all_changed_files }}; do
            response=$(curl -s -X POST http://dev-api.example.com/v1/policies/import \
              -H "Authorization: Bearer $JWT_TOKEN" \
              --data-binary @"$file" \
              -d '{"dry_run": true}')

            success=$(echo "$response" | jq -r '.success')
            if [ "$success" != "true" ]; then
              echo "Validation failed for $file"
              echo "$response" | jq '.errors'
              exit 1
            fi
          done
```

3. **Deploy to Development:**
```yaml
# .github/workflows/deploy-dev.yml
name: Deploy to Development

on:
  push:
    branches:
      - develop
    paths:
      - 'policies/development/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Import to development
        env:
          JWT_TOKEN: ${{ secrets.AUTHZ_DEV_TOKEN }}
        run: |
          curl -X POST http://dev-api.example.com/v1/policies/import \
            -H "Authorization: Bearer $JWT_TOKEN" \
            --data-binary @policies/development/all-policies.json \
            -d '{"mode": "overwrite"}'
```

4. **Promote to Production:**
```bash
# Merge develop → main
git checkout main
git merge develop
git push origin main

# Trigger production deployment
# (GitHub Actions workflow on main branch)
```

### Scenario 5: Disaster Recovery

**Objective**: Quickly recover from data loss or corruption.

**Preparation:**

1. **Automated Backups:**
```bash
# Cron job: Hourly backups
0 * * * * /opt/authz-engine/backup-hourly.sh

# Backup script
#!/bin/bash
DATE=$(date +%Y%m%d-%H%M%S)

curl -X POST http://localhost:8080/v1/policies/backup \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d "{
    \"name\": \"hourly-backup-$DATE\",
    \"include_principals\": true
  }"
```

2. **Off-Site Storage:**
```bash
# Upload backups to S3
aws s3 cp /backups/backup-$DATE.json.gz \
  s3://authz-backups/production/$(date +%Y/%m/%d)/backup-$DATE.json.gz
```

**Recovery Procedure:**

1. **Identify Failure:**
```bash
# Check system health
curl http://localhost:8080/health

# Check last successful backup
aws s3 ls s3://authz-backups/production/ --recursive | tail -1
```

2. **Download Latest Backup:**
```bash
# Download from S3
aws s3 cp s3://authz-backups/production/2025/01/27/backup-20250127-103000.json.gz \
  /tmp/recovery-backup.json.gz

# Decompress
gunzip /tmp/recovery-backup.json.gz
```

3. **Verify Backup Integrity:**
```bash
# Validate JSON
jq empty /tmp/recovery-backup.json

# Check policy count
POLICY_COUNT=$(jq '.policies | length' /tmp/recovery-backup.json)
echo "Backup contains $POLICY_COUNT policies"
```

4. **Restore (Dry-Run First):**
```bash
# Test restore
curl -X POST http://localhost:8080/v1/policies/import \
  -H "Authorization: Bearer $JWT_TOKEN" \
  --data-binary @/tmp/recovery-backup.json \
  -d '{"dry_run": true, "mode": "overwrite"}'
```

5. **Execute Restore:**
```bash
# Full restore
curl -X POST http://localhost:8080/v1/policies/restore \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "backup_file": "/tmp/recovery-backup.json",
    "mode": "replace_all"
  }'
```

6. **Verify Recovery:**
```bash
# Check policy count
curl -X GET http://localhost:8080/v1/policies \
  -H "Authorization: Bearer $JWT_TOKEN" \
  | jq '.pagination.total_items'

# Test authorization checks
curl -X POST http://localhost:8080/v1/authorization/check \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{ ... test data ... }'
```

7. **Document Incident:**
```bash
# Create incident report
cat > incident-report-$(date +%Y%m%d).md <<EOF
# Incident Report: Data Recovery

**Date**: $(date)
**Duration**: [time from failure to recovery]
**Root Cause**: [describe cause]
**Data Restored**: $POLICY_COUNT policies
**Backup Used**: backup-20250127-103000.json
**Verification**: [results of verification tests]
**Action Items**: [preventive measures]
EOF
```

---

## Troubleshooting

### Common Import Issues

#### Issue 1: Invalid JSON/YAML Syntax

**Error:**
```json
{
  "error": {
    "code": "INVALID_FORMAT",
    "message": "Invalid JSON syntax at line 45"
  }
}
```

**Solution:**
```bash
# Validate JSON
jq empty policies.json

# Format JSON
jq '.' policies.json > policies-formatted.json

# Validate YAML
python -c "import yaml; yaml.safe_load(open('policies.yaml'))"
```

#### Issue 2: Duplicate Policy IDs

**Error:**
```json
{
  "success": false,
  "failed_count": 1,
  "errors": [
    {
      "policy_id": "policy-dev-read-docs",
      "error": "Policy already exists"
    }
  ]
}
```

**Solutions:**

**Option A: Use Overwrite Mode**
```bash
curl -X POST http://localhost:8080/v1/policies/import \
  -H "Authorization: Bearer $JWT_TOKEN" \
  --data-binary @policies.json \
  -d '{"mode": "overwrite"}'
```

**Option B: Remove Duplicates**
```bash
# List existing policies
curl -X GET http://localhost:8080/v1/policies \
  -H "Authorization: Bearer $JWT_TOKEN" \
  | jq -r '.policies[].id' > existing-policies.txt

# Filter out duplicates from import file
jq --slurpfile existing existing-policies.txt \
  '.policies |= map(select(.id | IN($existing[0][]) | not))' \
  policies.json > policies-filtered.json
```

#### Issue 3: Invalid CEL Expression

**Error:**
```json
{
  "policy_id": "policy-invalid-cel",
  "error": "Invalid CEL expression: 'P.attr.level = senior' (expected '==' not '=')"
}
```

**Solution:**
```bash
# Fix CEL syntax (= → ==)
jq '(.policies[] | select(.id == "policy-invalid-cel") |
    .resource_policy.rules[].condition.match.expr) |=
    gsub(" = "; " == ")' \
  policies.json > policies-fixed.json
```

**Common CEL Mistakes:**
- `=` instead of `==` for comparison
- Missing quotes around strings
- Incorrect operator precedence
- Invalid function names

#### Issue 4: Import Timeout

**Error:**
```json
{
  "error": {
    "code": "REQUEST_TIMEOUT",
    "message": "Import operation timed out after 30 seconds"
  }
}
```

**Solutions:**

**Option A: Split Large Import**
```bash
# Split policies.json into chunks of 50 policies each
jq -c '.policies[]' policies.json | split -l 50 - policy-chunk-

# Import each chunk
for chunk in policy-chunk-*; do
  echo "Importing $chunk..."
  jq -s '{format: "json", policies: .}' "$chunk" | \
    curl -X POST http://localhost:8080/v1/policies/import \
      -H "Authorization: Bearer $JWT_TOKEN" \
      --data-binary @-
  sleep 2
done
```

**Option B: Increase Timeout**
```bash
# Use longer timeout (if supported by client)
curl --max-time 300 -X POST http://localhost:8080/v1/policies/import \
  -H "Authorization: Bearer $JWT_TOKEN" \
  --data-binary @policies.json
```

#### Issue 5: Character Encoding Issues

**Error:**
```json
{
  "error": {
    "code": "ENCODING_ERROR",
    "message": "Invalid UTF-8 sequence"
  }
}
```

**Solution:**
```bash
# Convert to UTF-8
iconv -f ISO-8859-1 -t UTF-8 policies.json > policies-utf8.json

# Remove invalid characters
jq '.' policies.json > policies-clean.json
```

### Debugging Tools

#### Policy Validator Script

```bash
#!/bin/bash

POLICY_FILE="$1"

echo "Validating $POLICY_FILE..."

# Check 1: File exists
if [ ! -f "$POLICY_FILE" ]; then
  echo "❌ File not found"
  exit 1
fi
echo "✅ File exists"

# Check 2: Valid JSON
if ! jq empty "$POLICY_FILE" 2>/dev/null; then
  echo "❌ Invalid JSON syntax"
  jq empty "$POLICY_FILE"
  exit 1
fi
echo "✅ Valid JSON syntax"

# Check 3: Required fields
MISSING_FIELDS=$(jq -r '
  .policies[] |
  select(.id == null or .version == null) |
  .id // "unknown"
' "$POLICY_FILE")

if [ -n "$MISSING_FIELDS" ]; then
  echo "❌ Missing required fields in policies: $MISSING_FIELDS"
  exit 1
fi
echo "✅ All required fields present"

# Check 4: Valid policy types
INVALID_TYPES=$(jq -r '
  .policies[] |
  select(
    .resource_policy == null and
    .principal_policy == null and
    .derived_roles == null
  ) |
  .id
' "$POLICY_FILE")

if [ -n "$INVALID_TYPES" ]; then
  echo "❌ Policies missing policy type: $INVALID_TYPES"
  exit 1
fi
echo "✅ All policies have valid types"

# Check 5: Dry-run import
if [ -n "$JWT_TOKEN" ]; then
  echo "Running API validation..."
  RESPONSE=$(curl -s -X POST http://localhost:8080/v1/policies/import \
    -H "Authorization: Bearer $JWT_TOKEN" \
    --data-binary @"$POLICY_FILE" \
    -d '{"dry_run": true}')

  SUCCESS=$(echo "$RESPONSE" | jq -r '.success')
  if [ "$SUCCESS" == "true" ]; then
    echo "✅ API validation passed"
  else
    echo "❌ API validation failed"
    echo "$RESPONSE" | jq '.errors'
    exit 1
  fi
else
  echo "⚠️  Skipping API validation (JWT_TOKEN not set)"
fi

echo ""
echo "✅ All validations passed!"
```

**Usage:**
```bash
export JWT_TOKEN="your-token"
./validate-policy.sh policies.json
```

### Best Practices

1. **Always Dry-Run First**: Test imports before execution
2. **Backup Before Import**: Create backup before overwrite/merge operations
3. **Version Control**: Track policy changes in Git
4. **Validate Locally**: Use validation scripts before API calls
5. **Monitor Imports**: Log all import operations
6. **Test in Staging**: Test migrations in staging first
7. **Document Changes**: Maintain changelog for policy updates
8. **Automate**: Use CI/CD for consistent deployments

---

## Appendix

### A. Complete Import/Export Examples

See [API_EXAMPLES.md](./API_EXAMPLES.md) for code examples in multiple languages.

### B. Migration Scripts

See `scripts/` directory for:
- `export-policies.sh` - Export script with filtering
- `import-policies.sh` - Import script with validation
- `migrate-env.sh` - Environment migration script
- `backup-restore.sh` - Backup and restore automation

### C. Policy Format Reference

See [api/openapi.yaml](../api/openapi.yaml) for complete schema definitions.

### D. CEL Expression Guide

See documentation on Common Expression Language for policy conditions.

---

**Version**: 1.0.0
**Last Updated**: 2025-01-27
**Maintainer**: Authorization Engine Team
