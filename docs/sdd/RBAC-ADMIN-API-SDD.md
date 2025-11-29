# RBAC Admin API - Software Design Document

**Module**: `@authz-engine/server`, `@authz-engine/core`
**Version**: 1.0.0
**Status**: Specification
**Author**: AuthZ Engine Team
**Created**: 2024-11-23
**Last Updated**: 2024-11-23
**Reviewers**: TBD

---

## 1. Overview

### 1.1 Purpose

The RBAC Admin API provides a comprehensive administrative interface for managing Role-Based Access Control (RBAC) configurations within the AuthZ Engine. This API enables operators to define roles, assign permissions, manage role hierarchies, and query effective permissions programmatically.

This feature is critical for:
- **Role Management**: Create, update, and delete roles with associated permissions
- **Permission Assignment**: Map permissions (resource:action patterns) to roles
- **Role Assignment**: Bind principals (users, services) to roles
- **Role Hierarchies**: Support role inheritance for organizational structures
- **Effective Permissions Query**: Compute and retrieve a principal's complete permission set
- **Bulk Operations**: Import/export RBAC configurations for disaster recovery and migration

### 1.2 Scope

**In Scope:**
- Role CRUD operations with validation
- Permission definition and management
- Role-to-principal assignment APIs
- Role hierarchy (inheritance) support
- Effective permissions computation and query
- Bulk import/export operations
- Admin operation audit logging
- Multi-tenant RBAC isolation
- Integration with Policy Engine for enforcement
- Meta-authorization (admin API security)

**Out of Scope:**
- User identity management (handled by IdP)
- Session management
- Authentication (handled externally)
- UI/Admin console (API only)
- Real-time permission propagation to edge nodes (separate SDD)

### 1.3 Context

The RBAC Admin API sits between administrative clients and the core authorization engine:

```
                              Admin Clients
                                   |
                                   v
+------------------------------------------------------------------------+
|                          RBAC Admin API                                 |
|                                                                         |
|  +------------------+  +-------------------+  +---------------------+   |
|  | Role Management  |  | Permission Mgmt   |  | Assignment Mgmt     |   |
|  | - CRUD roles     |  | - Define perms    |  | - Principal->Role   |   |
|  | - Hierarchy      |  | - Patterns        |  | - Effective perms   |   |
|  +--------+---------+  +---------+---------+  +-----------+---------+   |
|           |                      |                        |             |
|           +----------------------+------------------------+             |
|                                  |                                      |
|                                  v                                      |
|                    +---------------------------+                        |
|                    |    RBAC Data Store        |                        |
|                    | (Roles, Perms, Assigns)   |                        |
|                    +-------------+-------------+                        |
|                                  |                                      |
+------------------------------------------------------------------------+
                                   |
                                   v
                    +---------------------------+
                    |    Policy Engine          |
                    | (Authorization Decisions) |
                    +---------------------------+
```

### 1.4 Key Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| REST API with OpenAPI spec | Industry standard, tooling support | gRPC-only, GraphQL |
| Hierarchical RBAC (RBAC1) | Balance of power and complexity | Flat RBAC, Full ARBAC |
| Permission patterns (resource:action) | Flexible, glob-friendly | Fine-grained ACLs |
| Eventual consistency for propagation | Performance, availability | Strong consistency |
| Audit-first design | Compliance requirements | Optional audit |
| Tenant-scoped operations | Multi-tenant isolation | Global namespace |

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-RBAC-001 | Create, read, update, delete roles | Must Have | Pending |
| FR-RBAC-002 | Define permissions with resource:action patterns | Must Have | Pending |
| FR-RBAC-003 | Assign permissions to roles | Must Have | Pending |
| FR-RBAC-004 | Assign roles to principals | Must Have | Pending |
| FR-RBAC-005 | Query effective permissions for principal | Must Have | Pending |
| FR-RBAC-006 | Support role hierarchy (inheritance) | Must Have | Pending |
| FR-RBAC-007 | Detect and prevent circular role inheritance | Must Have | Pending |
| FR-RBAC-008 | Bulk import RBAC configuration | Should Have | Pending |
| FR-RBAC-009 | Bulk export RBAC configuration | Should Have | Pending |
| FR-RBAC-010 | Batch role assignment operations | Should Have | Pending |
| FR-RBAC-011 | Audit log all admin operations | Must Have | Pending |
| FR-RBAC-012 | Support multi-tenant role isolation | Must Have | Pending |
| FR-RBAC-013 | Validate permission patterns against schemas | Should Have | Pending |
| FR-RBAC-014 | Role assignment with conditions (time-bound, scope) | Could Have | Pending |
| FR-RBAC-015 | Meta-authorization for admin API access | Must Have | Pending |

### 2.2 Non-Functional Requirements

| ID | Category | Requirement | Target |
|----|----------|-------------|--------|
| NFR-RBAC-001 | Performance | Role lookup latency | < 5ms p99 |
| NFR-RBAC-002 | Performance | Effective permissions computation | < 20ms p99 |
| NFR-RBAC-003 | Performance | Bulk import (1000 roles) | < 10s |
| NFR-RBAC-004 | Scalability | Maximum roles per tenant | 10,000+ |
| NFR-RBAC-005 | Scalability | Maximum principals per role | 100,000+ |
| NFR-RBAC-006 | Reliability | Data consistency | Eventual (< 5s) |
| NFR-RBAC-007 | Security | Authorization for all endpoints | 100% |
| NFR-RBAC-008 | Security | Audit log completeness | 100% |
| NFR-RBAC-009 | Availability | API uptime | 99.9% |

---

## 3. Architecture

### 3.1 Component Diagram

```
+-----------------------------------------------------------------------------+
|                           RBAC Admin API Layer                               |
+-----------------------------------------------------------------------------+
|                                                                              |
|  +------------------------+   +------------------------+                    |
|  |    REST Controllers    |   |   gRPC Service Impl    |                    |
|  |  /v1/admin/rbac/*      |   |   RBACAdminService     |                    |
|  +----------+-------------+   +----------+-------------+                    |
|             |                            |                                   |
|             +------------+---------------+                                   |
|                          |                                                   |
|                          v                                                   |
|  +-------------------------------------------------------------------+      |
|  |                    RBAC Service Layer                              |      |
|  |                                                                    |      |
|  |  +---------------+  +----------------+  +---------------------+    |      |
|  |  | RoleService   |  | PermService    |  | AssignmentService   |    |      |
|  |  +---------------+  +----------------+  +---------------------+    |      |
|  |                                                                    |      |
|  |  +---------------+  +----------------+  +---------------------+    |      |
|  |  | HierarchySvc  |  | BulkOpService  |  | EffectivePermsCalc  |    |      |
|  |  +---------------+  +----------------+  +---------------------+    |      |
|  +-------------------------------------------------------------------+      |
|                          |                                                   |
|                          v                                                   |
|  +-------------------------------------------------------------------+      |
|  |                    RBAC Data Access Layer                          |      |
|  |                                                                    |      |
|  |  +---------------+  +----------------+  +---------------------+    |      |
|  |  | RoleStore     |  | PermStore      |  | AssignmentStore     |    |      |
|  |  +---------------+  +----------------+  +---------------------+    |      |
|  |                                                                    |      |
|  |  +---------------+  +----------------+                            |      |
|  |  | HierarchyIdx  |  | AuditLogger    |                            |      |
|  |  +---------------+  +----------------+                            |      |
|  +-------------------------------------------------------------------+      |
|                                                                              |
+-----------------------------------------------------------------------------+
                                |
                                v
+-----------------------------------------------------------------------------+
|                         Storage Backends                                     |
|                                                                              |
|  +-------------------+  +------------------+  +--------------------+         |
|  | PostgreSQL/MySQL  |  | Redis (Cache)    |  | Audit Log Sink     |         |
|  +-------------------+  +------------------+  +--------------------+         |
+-----------------------------------------------------------------------------+
```

### 3.2 Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| REST Controllers | HTTP request handling, validation, response formatting |
| gRPC Service | gRPC request handling for high-performance clients |
| RoleService | Role lifecycle management, validation |
| PermService | Permission definition, pattern validation |
| AssignmentService | Role-principal binding management |
| HierarchyService | Role inheritance graph management |
| BulkOpService | Import/export, batch operations |
| EffectivePermsCalc | Permission resolution with inheritance |
| RoleStore | Role persistence |
| PermStore | Permission persistence |
| AssignmentStore | Assignment persistence |
| HierarchyIndex | In-memory hierarchy graph for fast traversal |
| AuditLogger | Immutable audit trail |

### 3.3 Data Flow

#### Role Creation Flow

```
Admin Client
    |
    | POST /v1/admin/rbac/roles
    v
+------------------+
| Auth Middleware  |  <-- Meta-authorization check
+--------+---------+
         |
         v
+------------------+
| Role Controller  |  <-- Request validation
+--------+---------+
         |
         v
+------------------+
| RoleService      |  <-- Business logic, uniqueness check
+--------+---------+
         |
         v
+------------------+
| RoleStore        |  <-- Persist to database
+--------+---------+
         |
         v
+------------------+
| AuditLogger      |  <-- Log operation
+--------+---------+
         |
         v
+------------------+
| Event Publisher  |  <-- Notify subscribers (cache invalidation)
+------------------+
```

#### Effective Permissions Query Flow

```
Client Request: GET /v1/admin/rbac/principals/{id}/effective-permissions
                          |
                          v
                 +------------------+
                 | Auth Middleware  |
                 +--------+---------+
                          |
                          v
                 +------------------+
                 | Assignment Svc   | --> Load principal's direct roles
                 +--------+---------+
                          |
                          v
                 +------------------+
                 | Hierarchy Svc    | --> Resolve inherited roles (BFS/DFS)
                 +--------+---------+
                          |
                          v
                 +------------------+
                 | EffectivePerms   | --> Collect permissions from all roles
                 | Calculator       |     Deduplicate and merge
                 +--------+---------+
                          |
                          v
                 +------------------+
                 | Response         | --> Return merged permission set
                 +------------------+
```

### 3.4 Integration Points

| Integration | Protocol | Direction | Purpose |
|-------------|----------|-----------|---------|
| Policy Engine | Internal API | Outbound | Sync RBAC data for authorization |
| Identity Provider | OIDC/SAML | Inbound | Validate admin tokens |
| Audit System | Event Stream | Outbound | Compliance logging |
| Cache Layer | Redis Protocol | Both | Performance optimization |
| Storage | SQL/NoSQL | Both | Persistence |

---

## 4. Data Model

### 4.1 Entity Relationship Diagram

```
+------------------+       +---------------------+       +------------------+
|      Role        |       |  RolePermission     |       |   Permission     |
+------------------+       +---------------------+       +------------------+
| id: UUID         |<----->| role_id: UUID       |<----->| id: UUID         |
| tenant_id: UUID  |   M:N | permission_id: UUID |   M:N | tenant_id: UUID  |
| name: string     |       | created_at: Date    |       | name: string     |
| description: str |       +---------------------+       | resource: string |
| metadata: JSON   |                                     | action: string   |
| created_at: Date |       +---------------------+       | description: str |
| updated_at: Date |       |  RoleHierarchy      |       | metadata: JSON   |
+--------+---------+       +---------------------+       | created_at: Date |
         |                 | parent_id: UUID     |       +------------------+
         |                 | child_id: UUID      |
         |                 | depth: int          |
         |                 +---------------------+
         |
         v
+------------------+       +---------------------+
| RoleAssignment   |       |     Principal       |
+------------------+       +---------------------+
| id: UUID         |       | id: string          |
| tenant_id: UUID  |       | (external ref)      |
| role_id: UUID    |       +---------------------+
| principal_id: str|
| principal_type:  |
| assigned_at: Date|
| assigned_by: str |
| expires_at: Date?|
| condition: JSON? |
+------------------+
```

### 4.2 TypeScript Interface Definitions

```typescript
/**
 * Role definition with metadata and tenant isolation
 */
interface Role {
  /** Unique role identifier (UUID) */
  id: string;
  /** Tenant identifier for multi-tenancy isolation */
  tenantId: string;
  /** Human-readable role name (unique within tenant) */
  name: string;
  /** Role description */
  description?: string;
  /** Whether role is system-defined (immutable) */
  isSystem?: boolean;
  /** Custom metadata for extensions */
  metadata?: Record<string, unknown>;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last update timestamp */
  updatedAt: string;
  /** User/service who created this role */
  createdBy?: string;
}

/**
 * Permission definition using resource:action pattern
 */
interface Permission {
  /** Unique permission identifier (UUID) */
  id: string;
  /** Tenant identifier */
  tenantId: string;
  /** Human-readable permission name */
  name: string;
  /** Resource pattern (supports wildcards: documents, documents:*, *) */
  resource: string;
  /** Action pattern (supports wildcards: read, write, *, admin:*) */
  action: string;
  /** Permission description */
  description?: string;
  /** Optional CEL condition for attribute-based refinement */
  condition?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
  /** ISO 8601 creation timestamp */
  createdAt: string;
}

/**
 * Role hierarchy relationship for inheritance
 */
interface RoleHierarchy {
  /** Parent role ID (inheriting role) */
  parentRoleId: string;
  /** Child role ID (inherited from role) */
  childRoleId: string;
  /** Depth in hierarchy (1 = direct, 2+ = transitive) */
  depth: number;
  /** ISO 8601 creation timestamp */
  createdAt: string;
}

/**
 * Role-to-principal assignment with optional constraints
 */
interface RoleAssignment {
  /** Unique assignment identifier */
  id: string;
  /** Tenant identifier */
  tenantId: string;
  /** Role being assigned */
  roleId: string;
  /** Principal receiving the role */
  principalId: string;
  /** Type of principal (user, service, group) */
  principalType: 'user' | 'service' | 'group';
  /** Who assigned this role */
  assignedBy: string;
  /** ISO 8601 assignment timestamp */
  assignedAt: string;
  /** Optional expiration (time-bound assignment) */
  expiresAt?: string;
  /** Optional condition for conditional assignment */
  condition?: AssignmentCondition;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Conditional assignment constraints
 */
interface AssignmentCondition {
  /** Time-based constraints */
  temporal?: {
    /** Valid from timestamp */
    validFrom?: string;
    /** Valid until timestamp */
    validUntil?: string;
    /** Time-of-day restrictions (HH:MM format) */
    timeOfDay?: {
      from: string;
      to: string;
      timezone: string;
    };
    /** Day-of-week restrictions (0=Sunday, 6=Saturday) */
    daysOfWeek?: number[];
  };
  /** Scope-based constraints */
  scope?: {
    /** Organization/tenant scope */
    organizationId?: string;
    /** Department scope */
    departmentId?: string;
    /** Project scope */
    projectId?: string;
    /** Geographic region */
    region?: string;
  };
  /** CEL expression for custom conditions */
  expression?: string;
}

/**
 * Effective permissions for a principal
 */
interface EffectivePermissions {
  /** Principal identifier */
  principalId: string;
  /** Principal type */
  principalType: string;
  /** Tenant identifier */
  tenantId: string;
  /** All effective roles (direct + inherited) */
  roles: EffectiveRole[];
  /** Merged permission set */
  permissions: ResolvedPermission[];
  /** Permission summary by resource */
  summary: PermissionSummary[];
  /** Computation timestamp */
  computedAt: string;
  /** Cache validity indicator */
  cacheHit?: boolean;
}

/**
 * Role with inheritance source tracking
 */
interface EffectiveRole {
  /** Role identifier */
  roleId: string;
  /** Role name */
  roleName: string;
  /** How role was obtained */
  source: 'direct' | 'inherited';
  /** Parent role if inherited */
  inheritedFrom?: string;
  /** Inheritance depth (0 = direct) */
  depth: number;
}

/**
 * Resolved permission with source tracking
 */
interface ResolvedPermission {
  /** Permission identifier */
  permissionId: string;
  /** Permission name */
  permissionName: string;
  /** Resource pattern */
  resource: string;
  /** Action pattern */
  action: string;
  /** Roles granting this permission */
  grantedBy: string[];
  /** Condition if any */
  condition?: string;
}

/**
 * Permission summary grouped by resource
 */
interface PermissionSummary {
  /** Resource pattern */
  resource: string;
  /** Allowed actions on this resource */
  allowedActions: string[];
  /** Has wildcard access */
  hasWildcard: boolean;
}

/**
 * Audit log entry for RBAC operations
 */
interface RBACAdminAuditEntry {
  /** Unique audit entry ID */
  id: string;
  /** Tenant identifier */
  tenantId: string;
  /** Timestamp of operation */
  timestamp: string;
  /** Operation type */
  operation: RBACOperation;
  /** Actor performing operation */
  actor: {
    id: string;
    type: string;
    ipAddress?: string;
    userAgent?: string;
  };
  /** Target of operation */
  target: {
    type: 'role' | 'permission' | 'assignment' | 'hierarchy';
    id: string;
    name?: string;
  };
  /** Operation details */
  details: {
    action: 'create' | 'read' | 'update' | 'delete' | 'assign' | 'revoke';
    previousState?: unknown;
    newState?: unknown;
    changes?: Record<string, { from: unknown; to: unknown }>;
  };
  /** Request metadata */
  request: {
    id: string;
    method: string;
    path: string;
  };
  /** Operation result */
  result: 'success' | 'failure';
  /** Error details if failed */
  error?: {
    code: string;
    message: string;
  };
}

type RBACOperation =
  | 'role.create'
  | 'role.read'
  | 'role.update'
  | 'role.delete'
  | 'role.list'
  | 'permission.create'
  | 'permission.read'
  | 'permission.update'
  | 'permission.delete'
  | 'permission.list'
  | 'role.permission.assign'
  | 'role.permission.revoke'
  | 'principal.role.assign'
  | 'principal.role.revoke'
  | 'hierarchy.add'
  | 'hierarchy.remove'
  | 'effective.permissions.query'
  | 'bulk.import'
  | 'bulk.export';
```

### 4.3 Database Schema (PostgreSQL)

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Roles table
CREATE TABLE rbac_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_system BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by VARCHAR(255),

    CONSTRAINT uq_role_name_tenant UNIQUE (tenant_id, name),
    CONSTRAINT chk_role_name CHECK (name ~ '^[a-zA-Z][a-zA-Z0-9_-]*$')
);

CREATE INDEX idx_roles_tenant ON rbac_roles(tenant_id);
CREATE INDEX idx_roles_name ON rbac_roles(tenant_id, name);

-- Permissions table
CREATE TABLE rbac_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    resource VARCHAR(500) NOT NULL,
    action VARCHAR(255) NOT NULL,
    description TEXT,
    condition TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT uq_permission_name_tenant UNIQUE (tenant_id, name),
    CONSTRAINT uq_permission_resource_action UNIQUE (tenant_id, resource, action),
    CONSTRAINT chk_resource_pattern CHECK (resource ~ '^[a-zA-Z*][a-zA-Z0-9_:*-]*$'),
    CONSTRAINT chk_action_pattern CHECK (action ~ '^[a-zA-Z*][a-zA-Z0-9_:*-]*$')
);

CREATE INDEX idx_permissions_tenant ON rbac_permissions(tenant_id);
CREATE INDEX idx_permissions_resource ON rbac_permissions(tenant_id, resource);

-- Role-Permission junction table
CREATE TABLE rbac_role_permissions (
    role_id UUID NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES rbac_permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX idx_role_permissions_role ON rbac_role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission ON rbac_role_permissions(permission_id);

-- Role hierarchy (closure table for efficient ancestor queries)
CREATE TABLE rbac_role_hierarchy (
    parent_role_id UUID NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
    child_role_id UUID NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
    depth INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    PRIMARY KEY (parent_role_id, child_role_id),
    CONSTRAINT chk_no_self_ref CHECK (parent_role_id != child_role_id),
    CONSTRAINT chk_positive_depth CHECK (depth > 0)
);

CREATE INDEX idx_hierarchy_parent ON rbac_role_hierarchy(parent_role_id);
CREATE INDEX idx_hierarchy_child ON rbac_role_hierarchy(child_role_id);

-- Role assignments
CREATE TABLE rbac_role_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    role_id UUID NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
    principal_id VARCHAR(500) NOT NULL,
    principal_type VARCHAR(50) NOT NULL,
    assigned_by VARCHAR(255) NOT NULL,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    condition JSONB,
    metadata JSONB DEFAULT '{}',

    CONSTRAINT uq_assignment UNIQUE (tenant_id, role_id, principal_id, principal_type),
    CONSTRAINT chk_principal_type CHECK (principal_type IN ('user', 'service', 'group'))
);

CREATE INDEX idx_assignments_tenant ON rbac_role_assignments(tenant_id);
CREATE INDEX idx_assignments_principal ON rbac_role_assignments(tenant_id, principal_id, principal_type);
CREATE INDEX idx_assignments_role ON rbac_role_assignments(role_id);
CREATE INDEX idx_assignments_expires ON rbac_role_assignments(expires_at) WHERE expires_at IS NOT NULL;

-- Audit log table
CREATE TABLE rbac_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    operation VARCHAR(100) NOT NULL,
    actor_id VARCHAR(255) NOT NULL,
    actor_type VARCHAR(50) NOT NULL,
    actor_ip VARCHAR(45),
    actor_user_agent TEXT,
    target_type VARCHAR(50) NOT NULL,
    target_id VARCHAR(255) NOT NULL,
    target_name VARCHAR(255),
    action VARCHAR(50) NOT NULL,
    previous_state JSONB,
    new_state JSONB,
    changes JSONB,
    request_id VARCHAR(255),
    request_method VARCHAR(10),
    request_path TEXT,
    result VARCHAR(20) NOT NULL,
    error_code VARCHAR(50),
    error_message TEXT
);

CREATE INDEX idx_audit_tenant_time ON rbac_audit_log(tenant_id, timestamp DESC);
CREATE INDEX idx_audit_operation ON rbac_audit_log(operation);
CREATE INDEX idx_audit_actor ON rbac_audit_log(actor_id);
CREATE INDEX idx_audit_target ON rbac_audit_log(target_type, target_id);

-- Function to prevent circular hierarchy
CREATE OR REPLACE FUNCTION check_circular_hierarchy()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if adding this edge would create a cycle
    IF EXISTS (
        SELECT 1 FROM rbac_role_hierarchy
        WHERE parent_role_id = NEW.child_role_id
        AND child_role_id = NEW.parent_role_id
    ) THEN
        RAISE EXCEPTION 'Circular role hierarchy detected';
    END IF;

    -- Check for transitive cycles
    IF EXISTS (
        WITH RECURSIVE hierarchy AS (
            SELECT child_role_id, parent_role_id, 1 as depth
            FROM rbac_role_hierarchy
            WHERE parent_role_id = NEW.child_role_id

            UNION ALL

            SELECT h.child_role_id, rh.parent_role_id, h.depth + 1
            FROM hierarchy h
            JOIN rbac_role_hierarchy rh ON rh.child_role_id = h.parent_role_id
            WHERE h.depth < 100
        )
        SELECT 1 FROM hierarchy
        WHERE parent_role_id = NEW.parent_role_id
    ) THEN
        RAISE EXCEPTION 'Circular role hierarchy detected (transitive)';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_circular_hierarchy
BEFORE INSERT OR UPDATE ON rbac_role_hierarchy
FOR EACH ROW EXECUTE FUNCTION check_circular_hierarchy();

-- Function to update closure table on hierarchy changes
CREATE OR REPLACE FUNCTION maintain_hierarchy_closure()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Insert direct relationship
        INSERT INTO rbac_role_hierarchy (parent_role_id, child_role_id, depth)
        VALUES (NEW.parent_role_id, NEW.child_role_id, 1)
        ON CONFLICT DO NOTHING;

        -- Insert transitive relationships
        INSERT INTO rbac_role_hierarchy (parent_role_id, child_role_id, depth)
        SELECT p.parent_role_id, NEW.child_role_id, p.depth + 1
        FROM rbac_role_hierarchy p
        WHERE p.child_role_id = NEW.parent_role_id
        ON CONFLICT DO NOTHING;

        INSERT INTO rbac_role_hierarchy (parent_role_id, child_role_id, depth)
        SELECT NEW.parent_role_id, c.child_role_id, c.depth + 1
        FROM rbac_role_hierarchy c
        WHERE c.parent_role_id = NEW.child_role_id
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## 5. API Endpoints

### 5.1 OpenAPI Specification (Core Endpoints)

```yaml
openapi: 3.0.3
info:
  title: AuthZ Engine RBAC Admin API
  description: Administrative API for Role-Based Access Control management
  version: 1.0.0
  contact:
    name: AuthZ Engine Team
servers:
  - url: https://authz.example.com/v1/admin
    description: Production
  - url: http://localhost:3592/v1/admin
    description: Development

security:
  - bearerAuth: []
  - apiKeyAuth: []

tags:
  - name: Roles
    description: Role management operations
  - name: Permissions
    description: Permission management operations
  - name: Assignments
    description: Role assignment operations
  - name: Hierarchy
    description: Role hierarchy management
  - name: Effective Permissions
    description: Permission resolution queries
  - name: Bulk Operations
    description: Import/export and batch operations

paths:
  # ============= ROLE ENDPOINTS =============
  /rbac/roles:
    get:
      tags: [Roles]
      summary: List all roles
      operationId: listRoles
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
        - name: limit
          in: query
          schema:
            type: integer
            default: 100
            maximum: 1000
        - name: offset
          in: query
          schema:
            type: integer
            default: 0
        - name: search
          in: query
          description: Search by name or description
          schema:
            type: string
        - name: includePermissions
          in: query
          description: Include associated permissions
          schema:
            type: boolean
            default: false
      responses:
        '200':
          description: List of roles
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RoleListResponse'
              example:
                roles:
                  - id: "550e8400-e29b-41d4-a716-446655440000"
                    tenantId: "tenant-abc"
                    name: "admin"
                    description: "Full administrative access"
                    isSystem: true
                    createdAt: "2024-01-15T10:00:00Z"
                    updatedAt: "2024-01-15T10:00:00Z"
                  - id: "550e8400-e29b-41d4-a716-446655440001"
                    tenantId: "tenant-abc"
                    name: "editor"
                    description: "Content editing access"
                    createdAt: "2024-01-16T14:30:00Z"
                    updatedAt: "2024-01-16T14:30:00Z"
                pagination:
                  total: 25
                  limit: 100
                  offset: 0
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'

    post:
      tags: [Roles]
      summary: Create a new role
      operationId: createRole
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateRoleRequest'
            example:
              name: "content-reviewer"
              description: "Can review and approve content"
              permissions:
                - "content:review"
                - "content:approve"
              metadata:
                department: "editorial"
      responses:
        '201':
          description: Role created successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Role'
        '400':
          $ref: '#/components/responses/BadRequest'
        '409':
          description: Role with this name already exists
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  /rbac/roles/{roleId}:
    get:
      tags: [Roles]
      summary: Get role by ID
      operationId: getRole
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
        - $ref: '#/components/parameters/RoleId'
        - name: includePermissions
          in: query
          schema:
            type: boolean
            default: true
        - name: includeHierarchy
          in: query
          schema:
            type: boolean
            default: false
      responses:
        '200':
          description: Role details
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RoleDetail'
        '404':
          $ref: '#/components/responses/NotFound'

    put:
      tags: [Roles]
      summary: Update role
      operationId: updateRole
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
        - $ref: '#/components/parameters/RoleId'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateRoleRequest'
      responses:
        '200':
          description: Role updated
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Role'
        '400':
          $ref: '#/components/responses/BadRequest'
        '403':
          description: Cannot modify system role
        '404':
          $ref: '#/components/responses/NotFound'

    delete:
      tags: [Roles]
      summary: Delete role
      operationId: deleteRole
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
        - $ref: '#/components/parameters/RoleId'
        - name: force
          in: query
          description: Force delete even if role has assignments
          schema:
            type: boolean
            default: false
      responses:
        '204':
          description: Role deleted
        '403':
          description: Cannot delete system role
        '409':
          description: Role has active assignments

  # ============= PERMISSION ENDPOINTS =============
  /rbac/permissions:
    get:
      tags: [Permissions]
      summary: List all permissions
      operationId: listPermissions
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
        - name: resource
          in: query
          description: Filter by resource pattern
          schema:
            type: string
        - name: action
          in: query
          description: Filter by action pattern
          schema:
            type: string
        - name: limit
          in: query
          schema:
            type: integer
            default: 100
        - name: offset
          in: query
          schema:
            type: integer
            default: 0
      responses:
        '200':
          description: List of permissions
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PermissionListResponse'

    post:
      tags: [Permissions]
      summary: Create a new permission
      operationId: createPermission
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreatePermissionRequest'
            example:
              name: "documents:write"
              resource: "documents"
              action: "write"
              description: "Write access to documents"
      responses:
        '201':
          description: Permission created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Permission'
        '409':
          description: Permission already exists

  /rbac/permissions/{permissionId}:
    get:
      tags: [Permissions]
      summary: Get permission by ID
      operationId: getPermission
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
        - $ref: '#/components/parameters/PermissionId'
      responses:
        '200':
          description: Permission details
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Permission'
        '404':
          $ref: '#/components/responses/NotFound'

    delete:
      tags: [Permissions]
      summary: Delete permission
      operationId: deletePermission
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
        - $ref: '#/components/parameters/PermissionId'
      responses:
        '204':
          description: Permission deleted
        '409':
          description: Permission is assigned to roles

  # ============= ROLE-PERMISSION ASSIGNMENT =============
  /rbac/roles/{roleId}/permissions:
    get:
      tags: [Roles, Permissions]
      summary: List permissions assigned to role
      operationId: listRolePermissions
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
        - $ref: '#/components/parameters/RoleId'
      responses:
        '200':
          description: List of permissions
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PermissionListResponse'

    post:
      tags: [Roles, Permissions]
      summary: Assign permissions to role
      operationId: assignPermissionsToRole
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
        - $ref: '#/components/parameters/RoleId'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [permissionIds]
              properties:
                permissionIds:
                  type: array
                  items:
                    type: string
                    format: uuid
            example:
              permissionIds:
                - "550e8400-e29b-41d4-a716-446655440010"
                - "550e8400-e29b-41d4-a716-446655440011"
      responses:
        '200':
          description: Permissions assigned
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RoleDetail'

    delete:
      tags: [Roles, Permissions]
      summary: Revoke permissions from role
      operationId: revokePermissionsFromRole
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
        - $ref: '#/components/parameters/RoleId'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [permissionIds]
              properties:
                permissionIds:
                  type: array
                  items:
                    type: string
                    format: uuid
      responses:
        '200':
          description: Permissions revoked

  # ============= PRINCIPAL ROLE ASSIGNMENT =============
  /rbac/assignments:
    get:
      tags: [Assignments]
      summary: List role assignments
      operationId: listAssignments
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
        - name: principalId
          in: query
          schema:
            type: string
        - name: principalType
          in: query
          schema:
            type: string
            enum: [user, service, group]
        - name: roleId
          in: query
          schema:
            type: string
            format: uuid
        - name: includeExpired
          in: query
          schema:
            type: boolean
            default: false
        - name: limit
          in: query
          schema:
            type: integer
            default: 100
        - name: offset
          in: query
          schema:
            type: integer
            default: 0
      responses:
        '200':
          description: List of assignments
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AssignmentListResponse'

    post:
      tags: [Assignments]
      summary: Assign role to principal
      operationId: assignRole
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateAssignmentRequest'
            example:
              roleId: "550e8400-e29b-41d4-a716-446655440000"
              principalId: "user-12345"
              principalType: "user"
              expiresAt: "2025-12-31T23:59:59Z"
              condition:
                scope:
                  departmentId: "engineering"
      responses:
        '201':
          description: Role assigned
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RoleAssignment'
        '409':
          description: Assignment already exists

  /rbac/assignments/{assignmentId}:
    get:
      tags: [Assignments]
      summary: Get assignment by ID
      operationId: getAssignment
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
        - name: assignmentId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Assignment details
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RoleAssignment'
        '404':
          $ref: '#/components/responses/NotFound'

    delete:
      tags: [Assignments]
      summary: Revoke role assignment
      operationId: revokeAssignment
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
        - name: assignmentId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Assignment revoked

  # ============= PRINCIPAL ENDPOINTS =============
  /rbac/principals/{principalId}/roles:
    get:
      tags: [Assignments]
      summary: Get roles assigned to principal
      operationId: getPrincipalRoles
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
        - name: principalId
          in: path
          required: true
          schema:
            type: string
        - name: principalType
          in: query
          required: true
          schema:
            type: string
            enum: [user, service, group]
        - name: includeInherited
          in: query
          description: Include roles inherited through hierarchy
          schema:
            type: boolean
            default: true
      responses:
        '200':
          description: Principal's roles
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PrincipalRolesResponse'

  /rbac/principals/{principalId}/effective-permissions:
    get:
      tags: [Effective Permissions]
      summary: Get effective permissions for principal
      operationId: getEffectivePermissions
      description: >
        Computes the complete set of permissions for a principal by:
        1. Loading all directly assigned roles
        2. Resolving inherited roles through hierarchy
        3. Collecting permissions from all roles
        4. Merging and deduplicating permissions
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
        - name: principalId
          in: path
          required: true
          schema:
            type: string
        - name: principalType
          in: query
          required: true
          schema:
            type: string
            enum: [user, service, group]
        - name: resource
          in: query
          description: Filter by resource pattern
          schema:
            type: string
        - name: action
          in: query
          description: Filter by action pattern
          schema:
            type: string
        - name: format
          in: query
          description: Response format
          schema:
            type: string
            enum: [full, summary, flat]
            default: full
      responses:
        '200':
          description: Effective permissions
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/EffectivePermissions'
              example:
                principalId: "user-12345"
                principalType: "user"
                tenantId: "tenant-abc"
                roles:
                  - roleId: "550e8400-e29b-41d4-a716-446655440000"
                    roleName: "admin"
                    source: "direct"
                    depth: 0
                  - roleId: "550e8400-e29b-41d4-a716-446655440001"
                    roleName: "editor"
                    source: "inherited"
                    inheritedFrom: "admin"
                    depth: 1
                permissions:
                  - permissionId: "perm-001"
                    permissionName: "documents:read"
                    resource: "documents"
                    action: "read"
                    grantedBy: ["admin", "editor"]
                  - permissionId: "perm-002"
                    permissionName: "documents:write"
                    resource: "documents"
                    action: "write"
                    grantedBy: ["admin"]
                summary:
                  - resource: "documents"
                    allowedActions: ["read", "write", "delete"]
                    hasWildcard: false
                  - resource: "*"
                    allowedActions: ["*"]
                    hasWildcard: true
                computedAt: "2024-01-20T15:30:00Z"
                cacheHit: false

  /rbac/principals/{principalId}/check:
    post:
      tags: [Effective Permissions]
      summary: Check if principal has permission
      operationId: checkPrincipalPermission
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
        - name: principalId
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [resource, action, principalType]
              properties:
                principalType:
                  type: string
                  enum: [user, service, group]
                resource:
                  type: string
                action:
                  type: string
                context:
                  type: object
                  additionalProperties: true
            example:
              principalType: "user"
              resource: "documents"
              action: "delete"
              context:
                documentId: "doc-123"
                department: "engineering"
      responses:
        '200':
          description: Permission check result
          content:
            application/json:
              schema:
                type: object
                properties:
                  allowed:
                    type: boolean
                  matchedPermissions:
                    type: array
                    items:
                      type: string
                  matchedRoles:
                    type: array
                    items:
                      type: string
                  reason:
                    type: string
              example:
                allowed: true
                matchedPermissions: ["documents:delete", "documents:*"]
                matchedRoles: ["admin"]
                reason: "Permission granted via 'admin' role"

  # ============= ROLE HIERARCHY ENDPOINTS =============
  /rbac/hierarchy:
    get:
      tags: [Hierarchy]
      summary: Get role hierarchy
      operationId: getRoleHierarchy
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
        - name: format
          in: query
          schema:
            type: string
            enum: [tree, flat, graph]
            default: tree
      responses:
        '200':
          description: Role hierarchy
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RoleHierarchyResponse'

    post:
      tags: [Hierarchy]
      summary: Add role inheritance relationship
      operationId: addRoleInheritance
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [parentRoleId, childRoleId]
              properties:
                parentRoleId:
                  type: string
                  format: uuid
                  description: Role that will inherit permissions
                childRoleId:
                  type: string
                  format: uuid
                  description: Role whose permissions will be inherited
            example:
              parentRoleId: "550e8400-e29b-41d4-a716-446655440000"
              childRoleId: "550e8400-e29b-41d4-a716-446655440001"
      responses:
        '201':
          description: Inheritance relationship created
        '400':
          description: Invalid hierarchy (e.g., circular dependency)
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
              example:
                code: "CIRCULAR_HIERARCHY"
                message: "Adding this relationship would create a circular dependency"
                details:
                  cycle: ["admin", "manager", "admin"]

  /rbac/hierarchy/{parentRoleId}/{childRoleId}:
    delete:
      tags: [Hierarchy]
      summary: Remove role inheritance relationship
      operationId: removeRoleInheritance
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
        - name: parentRoleId
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: childRoleId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Inheritance relationship removed
        '404':
          description: Relationship not found

  # ============= BULK OPERATIONS =============
  /rbac/bulk/import:
    post:
      tags: [Bulk Operations]
      summary: Import RBAC configuration
      operationId: bulkImport
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
        - name: mode
          in: query
          description: Import mode
          schema:
            type: string
            enum: [merge, replace]
            default: merge
        - name: dryRun
          in: query
          description: Validate without applying changes
          schema:
            type: boolean
            default: false
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/BulkImportRequest'
          application/x-yaml:
            schema:
              $ref: '#/components/schemas/BulkImportRequest'
      responses:
        '200':
          description: Import result
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BulkImportResponse'

  /rbac/bulk/export:
    get:
      tags: [Bulk Operations]
      summary: Export RBAC configuration
      operationId: bulkExport
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
        - name: format
          in: query
          schema:
            type: string
            enum: [json, yaml]
            default: json
        - name: includeAssignments
          in: query
          schema:
            type: boolean
            default: true
        - name: includeAudit
          in: query
          schema:
            type: boolean
            default: false
      responses:
        '200':
          description: RBAC configuration export
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BulkExportResponse'
            application/x-yaml:
              schema:
                $ref: '#/components/schemas/BulkExportResponse'

  /rbac/bulk/assignments:
    post:
      tags: [Bulk Operations]
      summary: Batch assign roles
      operationId: batchAssignRoles
      parameters:
        - $ref: '#/components/parameters/TenantHeader'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [assignments]
              properties:
                assignments:
                  type: array
                  items:
                    $ref: '#/components/schemas/CreateAssignmentRequest'
                  maxItems: 1000
            example:
              assignments:
                - roleId: "role-admin"
                  principalId: "user-1"
                  principalType: "user"
                - roleId: "role-editor"
                  principalId: "user-2"
                  principalType: "user"
                - roleId: "role-viewer"
                  principalId: "group-eng"
                  principalType: "group"
      responses:
        '200':
          description: Batch assignment result
          content:
            application/json:
              schema:
                type: object
                properties:
                  successful:
                    type: integer
                  failed:
                    type: integer
                  errors:
                    type: array
                    items:
                      type: object
                      properties:
                        index:
                          type: integer
                        error:
                          type: string

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
    apiKeyAuth:
      type: apiKey
      in: header
      name: X-API-Key

  parameters:
    TenantHeader:
      name: X-Tenant-ID
      in: header
      required: true
      schema:
        type: string
      description: Tenant identifier for multi-tenancy

    RoleId:
      name: roleId
      in: path
      required: true
      schema:
        type: string
        format: uuid
      description: Role identifier

    PermissionId:
      name: permissionId
      in: path
      required: true
      schema:
        type: string
        format: uuid
      description: Permission identifier

  schemas:
    Role:
      type: object
      required: [id, tenantId, name, createdAt, updatedAt]
      properties:
        id:
          type: string
          format: uuid
        tenantId:
          type: string
        name:
          type: string
          pattern: '^[a-zA-Z][a-zA-Z0-9_-]*$'
          maxLength: 255
        description:
          type: string
        isSystem:
          type: boolean
          default: false
        metadata:
          type: object
          additionalProperties: true
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
        createdBy:
          type: string

    RoleDetail:
      allOf:
        - $ref: '#/components/schemas/Role'
        - type: object
          properties:
            permissions:
              type: array
              items:
                $ref: '#/components/schemas/Permission'
            parentRoles:
              type: array
              items:
                $ref: '#/components/schemas/Role'
            childRoles:
              type: array
              items:
                $ref: '#/components/schemas/Role'
            assignmentCount:
              type: integer

    CreateRoleRequest:
      type: object
      required: [name]
      properties:
        name:
          type: string
          pattern: '^[a-zA-Z][a-zA-Z0-9_-]*$'
          maxLength: 255
        description:
          type: string
        permissions:
          type: array
          items:
            type: string
          description: Permission IDs or names to assign
        parentRoles:
          type: array
          items:
            type: string
          description: Parent role IDs for inheritance
        metadata:
          type: object
          additionalProperties: true

    UpdateRoleRequest:
      type: object
      properties:
        name:
          type: string
          pattern: '^[a-zA-Z][a-zA-Z0-9_-]*$'
        description:
          type: string
        metadata:
          type: object
          additionalProperties: true

    Permission:
      type: object
      required: [id, tenantId, name, resource, action, createdAt]
      properties:
        id:
          type: string
          format: uuid
        tenantId:
          type: string
        name:
          type: string
        resource:
          type: string
          pattern: '^[a-zA-Z*][a-zA-Z0-9_:*-]*$'
        action:
          type: string
          pattern: '^[a-zA-Z*][a-zA-Z0-9_:*-]*$'
        description:
          type: string
        condition:
          type: string
          description: Optional CEL condition
        metadata:
          type: object
          additionalProperties: true
        createdAt:
          type: string
          format: date-time

    CreatePermissionRequest:
      type: object
      required: [name, resource, action]
      properties:
        name:
          type: string
        resource:
          type: string
          pattern: '^[a-zA-Z*][a-zA-Z0-9_:*-]*$'
        action:
          type: string
          pattern: '^[a-zA-Z*][a-zA-Z0-9_:*-]*$'
        description:
          type: string
        condition:
          type: string
        metadata:
          type: object

    RoleAssignment:
      type: object
      required: [id, tenantId, roleId, principalId, principalType, assignedBy, assignedAt]
      properties:
        id:
          type: string
          format: uuid
        tenantId:
          type: string
        roleId:
          type: string
          format: uuid
        principalId:
          type: string
        principalType:
          type: string
          enum: [user, service, group]
        assignedBy:
          type: string
        assignedAt:
          type: string
          format: date-time
        expiresAt:
          type: string
          format: date-time
        condition:
          $ref: '#/components/schemas/AssignmentCondition'
        metadata:
          type: object

    CreateAssignmentRequest:
      type: object
      required: [roleId, principalId, principalType]
      properties:
        roleId:
          type: string
          format: uuid
        principalId:
          type: string
        principalType:
          type: string
          enum: [user, service, group]
        expiresAt:
          type: string
          format: date-time
        condition:
          $ref: '#/components/schemas/AssignmentCondition'
        metadata:
          type: object

    AssignmentCondition:
      type: object
      properties:
        temporal:
          type: object
          properties:
            validFrom:
              type: string
              format: date-time
            validUntil:
              type: string
              format: date-time
            timeOfDay:
              type: object
              properties:
                from:
                  type: string
                  pattern: '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
                to:
                  type: string
                  pattern: '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
                timezone:
                  type: string
            daysOfWeek:
              type: array
              items:
                type: integer
                minimum: 0
                maximum: 6
        scope:
          type: object
          properties:
            organizationId:
              type: string
            departmentId:
              type: string
            projectId:
              type: string
            region:
              type: string
        expression:
          type: string
          description: CEL expression for custom conditions

    EffectivePermissions:
      type: object
      required: [principalId, principalType, tenantId, roles, permissions, computedAt]
      properties:
        principalId:
          type: string
        principalType:
          type: string
        tenantId:
          type: string
        roles:
          type: array
          items:
            $ref: '#/components/schemas/EffectiveRole'
        permissions:
          type: array
          items:
            $ref: '#/components/schemas/ResolvedPermission'
        summary:
          type: array
          items:
            $ref: '#/components/schemas/PermissionSummary'
        computedAt:
          type: string
          format: date-time
        cacheHit:
          type: boolean

    EffectiveRole:
      type: object
      properties:
        roleId:
          type: string
        roleName:
          type: string
        source:
          type: string
          enum: [direct, inherited]
        inheritedFrom:
          type: string
        depth:
          type: integer

    ResolvedPermission:
      type: object
      properties:
        permissionId:
          type: string
        permissionName:
          type: string
        resource:
          type: string
        action:
          type: string
        grantedBy:
          type: array
          items:
            type: string
        condition:
          type: string

    PermissionSummary:
      type: object
      properties:
        resource:
          type: string
        allowedActions:
          type: array
          items:
            type: string
        hasWildcard:
          type: boolean

    RoleHierarchyResponse:
      type: object
      properties:
        format:
          type: string
        tree:
          type: array
          items:
            $ref: '#/components/schemas/RoleTreeNode'
        relationships:
          type: array
          items:
            $ref: '#/components/schemas/RoleHierarchyRelation'

    RoleTreeNode:
      type: object
      properties:
        role:
          $ref: '#/components/schemas/Role'
        children:
          type: array
          items:
            $ref: '#/components/schemas/RoleTreeNode'
        depth:
          type: integer

    RoleHierarchyRelation:
      type: object
      properties:
        parentRoleId:
          type: string
        parentRoleName:
          type: string
        childRoleId:
          type: string
        childRoleName:
          type: string
        depth:
          type: integer

    BulkImportRequest:
      type: object
      properties:
        roles:
          type: array
          items:
            $ref: '#/components/schemas/CreateRoleRequest'
        permissions:
          type: array
          items:
            $ref: '#/components/schemas/CreatePermissionRequest'
        rolePermissions:
          type: array
          items:
            type: object
            properties:
              roleName:
                type: string
              permissionNames:
                type: array
                items:
                  type: string
        hierarchy:
          type: array
          items:
            type: object
            properties:
              parentRoleName:
                type: string
              childRoleName:
                type: string
        assignments:
          type: array
          items:
            type: object
            properties:
              roleName:
                type: string
              principalId:
                type: string
              principalType:
                type: string

    BulkImportResponse:
      type: object
      properties:
        success:
          type: boolean
        dryRun:
          type: boolean
        stats:
          type: object
          properties:
            rolesCreated:
              type: integer
            rolesUpdated:
              type: integer
            permissionsCreated:
              type: integer
            assignmentsCreated:
              type: integer
            hierarchyRelationsCreated:
              type: integer
        errors:
          type: array
          items:
            type: object
            properties:
              type:
                type: string
              name:
                type: string
              error:
                type: string

    BulkExportResponse:
      type: object
      properties:
        exportedAt:
          type: string
          format: date-time
        tenantId:
          type: string
        roles:
          type: array
          items:
            $ref: '#/components/schemas/RoleDetail'
        permissions:
          type: array
          items:
            $ref: '#/components/schemas/Permission'
        hierarchy:
          type: array
          items:
            $ref: '#/components/schemas/RoleHierarchyRelation'
        assignments:
          type: array
          items:
            $ref: '#/components/schemas/RoleAssignment'

    RoleListResponse:
      type: object
      properties:
        roles:
          type: array
          items:
            $ref: '#/components/schemas/Role'
        pagination:
          $ref: '#/components/schemas/Pagination'

    PermissionListResponse:
      type: object
      properties:
        permissions:
          type: array
          items:
            $ref: '#/components/schemas/Permission'
        pagination:
          $ref: '#/components/schemas/Pagination'

    AssignmentListResponse:
      type: object
      properties:
        assignments:
          type: array
          items:
            $ref: '#/components/schemas/RoleAssignment'
        pagination:
          $ref: '#/components/schemas/Pagination'

    PrincipalRolesResponse:
      type: object
      properties:
        principalId:
          type: string
        principalType:
          type: string
        directRoles:
          type: array
          items:
            $ref: '#/components/schemas/Role'
        inheritedRoles:
          type: array
          items:
            $ref: '#/components/schemas/EffectiveRole'

    Pagination:
      type: object
      properties:
        total:
          type: integer
        limit:
          type: integer
        offset:
          type: integer

    Error:
      type: object
      required: [code, message]
      properties:
        code:
          type: string
        message:
          type: string
        details:
          type: object
          additionalProperties: true
        requestId:
          type: string

  responses:
    BadRequest:
      description: Invalid request
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/Error'

    Unauthorized:
      description: Authentication required
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/Error'

    Forbidden:
      description: Insufficient permissions
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/Error'

    NotFound:
      description: Resource not found
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/Error'
```

---

## 6. Authorization for Admin API (Meta-Authorization)

### 6.1 Overview

The RBAC Admin API itself must be protected by authorization rules. This creates a "meta-authorization" layer where managing RBAC requires specific RBAC permissions.

### 6.2 Admin Permissions Model

```typescript
/**
 * Built-in permissions for RBAC administration
 */
const RBAC_ADMIN_PERMISSIONS = {
  // Role management
  'rbac:roles:create': 'Create new roles',
  'rbac:roles:read': 'View role details',
  'rbac:roles:update': 'Modify existing roles',
  'rbac:roles:delete': 'Delete roles',
  'rbac:roles:list': 'List all roles',

  // Permission management
  'rbac:permissions:create': 'Create new permissions',
  'rbac:permissions:read': 'View permission details',
  'rbac:permissions:update': 'Modify permissions',
  'rbac:permissions:delete': 'Delete permissions',
  'rbac:permissions:list': 'List all permissions',

  // Assignment management
  'rbac:assignments:create': 'Assign roles to principals',
  'rbac:assignments:read': 'View role assignments',
  'rbac:assignments:delete': 'Revoke role assignments',
  'rbac:assignments:list': 'List assignments',

  // Hierarchy management
  'rbac:hierarchy:modify': 'Modify role hierarchy',
  'rbac:hierarchy:read': 'View role hierarchy',

  // Effective permissions
  'rbac:effective:query': 'Query effective permissions',

  // Bulk operations
  'rbac:bulk:import': 'Import RBAC configuration',
  'rbac:bulk:export': 'Export RBAC configuration',

  // Audit
  'rbac:audit:read': 'View RBAC audit logs',

  // Wildcard admin
  'rbac:*': 'Full RBAC administration access',
} as const;
```

### 6.3 Built-in Admin Roles

```yaml
# System-defined admin roles
roles:
  - name: rbac-super-admin
    description: Full RBAC administration access
    isSystem: true
    permissions:
      - rbac:*

  - name: rbac-admin
    description: Standard RBAC administration
    isSystem: true
    permissions:
      - rbac:roles:*
      - rbac:permissions:*
      - rbac:assignments:*
      - rbac:hierarchy:*
      - rbac:effective:query

  - name: rbac-operator
    description: Day-to-day RBAC operations
    isSystem: true
    permissions:
      - rbac:roles:read
      - rbac:roles:list
      - rbac:permissions:read
      - rbac:permissions:list
      - rbac:assignments:create
      - rbac:assignments:read
      - rbac:assignments:delete
      - rbac:assignments:list
      - rbac:effective:query

  - name: rbac-viewer
    description: Read-only RBAC access
    isSystem: true
    permissions:
      - rbac:roles:read
      - rbac:roles:list
      - rbac:permissions:read
      - rbac:permissions:list
      - rbac:assignments:read
      - rbac:assignments:list
      - rbac:hierarchy:read
      - rbac:effective:query

  - name: rbac-auditor
    description: Audit log access
    isSystem: true
    permissions:
      - rbac:audit:read
      - rbac:roles:read
      - rbac:permissions:read
      - rbac:assignments:read
```

### 6.4 Meta-Authorization Middleware

```typescript
/**
 * Middleware that enforces RBAC admin permissions
 */
class RBACAdminAuthorizationMiddleware {
  private authzClient: AuthzClient;

  constructor(authzClient: AuthzClient) {
    this.authzClient = authzClient;
  }

  /**
   * Permission mapping from HTTP routes to required permissions
   */
  private readonly routePermissions: Map<string, string[]> = new Map([
    // Roles
    ['GET /v1/admin/rbac/roles', ['rbac:roles:list']],
    ['POST /v1/admin/rbac/roles', ['rbac:roles:create']],
    ['GET /v1/admin/rbac/roles/:id', ['rbac:roles:read']],
    ['PUT /v1/admin/rbac/roles/:id', ['rbac:roles:update']],
    ['DELETE /v1/admin/rbac/roles/:id', ['rbac:roles:delete']],

    // Permissions
    ['GET /v1/admin/rbac/permissions', ['rbac:permissions:list']],
    ['POST /v1/admin/rbac/permissions', ['rbac:permissions:create']],
    ['GET /v1/admin/rbac/permissions/:id', ['rbac:permissions:read']],
    ['DELETE /v1/admin/rbac/permissions/:id', ['rbac:permissions:delete']],

    // Assignments
    ['GET /v1/admin/rbac/assignments', ['rbac:assignments:list']],
    ['POST /v1/admin/rbac/assignments', ['rbac:assignments:create']],
    ['DELETE /v1/admin/rbac/assignments/:id', ['rbac:assignments:delete']],

    // Principal queries
    ['GET /v1/admin/rbac/principals/:id/roles', ['rbac:assignments:read']],
    ['GET /v1/admin/rbac/principals/:id/effective-permissions', ['rbac:effective:query']],
    ['POST /v1/admin/rbac/principals/:id/check', ['rbac:effective:query']],

    // Hierarchy
    ['GET /v1/admin/rbac/hierarchy', ['rbac:hierarchy:read']],
    ['POST /v1/admin/rbac/hierarchy', ['rbac:hierarchy:modify']],
    ['DELETE /v1/admin/rbac/hierarchy/:parent/:child', ['rbac:hierarchy:modify']],

    // Bulk operations
    ['POST /v1/admin/rbac/bulk/import', ['rbac:bulk:import']],
    ['GET /v1/admin/rbac/bulk/export', ['rbac:bulk:export']],
    ['POST /v1/admin/rbac/bulk/assignments', ['rbac:assignments:create']],
  ]);

  async authorize(
    request: Request,
    principal: Principal
  ): Promise<AuthorizationResult> {
    const routeKey = `${request.method} ${this.normalizeRoute(request.path)}`;
    const requiredPermissions = this.routePermissions.get(routeKey);

    if (!requiredPermissions) {
      // Unknown route - deny by default
      return {
        allowed: false,
        reason: 'Unknown admin API route',
      };
    }

    // Check if principal has any of the required permissions
    const effectivePerms = await this.getEffectivePermissions(principal);

    for (const required of requiredPermissions) {
      if (this.matchesPermission(effectivePerms, required)) {
        return {
          allowed: true,
          matchedPermission: required,
        };
      }
    }

    return {
      allowed: false,
      reason: `Missing required permissions: ${requiredPermissions.join(', ')}`,
      requiredPermissions,
    };
  }

  private matchesPermission(
    effective: string[],
    required: string
  ): boolean {
    // Direct match
    if (effective.includes(required)) return true;

    // Wildcard match (e.g., rbac:* matches rbac:roles:create)
    for (const perm of effective) {
      if (perm.endsWith(':*')) {
        const prefix = perm.slice(0, -1);
        if (required.startsWith(prefix)) return true;
      }
      if (perm === '*') return true;
    }

    return false;
  }
}
```

### 6.5 Scope-Based Admin Access

```typescript
/**
 * Support for scoped admin access (e.g., department-level admin)
 */
interface ScopedAdminConfig {
  /** Principal can only manage roles/assignments within their scope */
  scope: {
    departments?: string[];
    projects?: string[];
    regions?: string[];
  };
  /** Roles that can be assigned by this admin */
  assignableRoles: string[];
  /** Maximum role hierarchy depth this admin can create */
  maxHierarchyDepth: number;
}

/**
 * Validate scoped admin operations
 */
function validateScopedOperation(
  admin: Principal,
  operation: RBACOperation,
  target: unknown
): ValidationResult {
  const adminScope = admin.attributes.adminScope as ScopedAdminConfig;

  if (!adminScope) {
    // No scope restrictions
    return { valid: true };
  }

  switch (operation) {
    case 'principal.role.assign':
      const assignment = target as CreateAssignmentRequest;

      // Check if role is assignable
      if (!adminScope.assignableRoles.includes(assignment.roleId)) {
        return {
          valid: false,
          reason: `Role ${assignment.roleId} is not in assignable roles list`,
        };
      }

      // Check scope overlap
      if (assignment.condition?.scope) {
        const targetScope = assignment.condition.scope;
        if (adminScope.scope.departments) {
          if (!adminScope.scope.departments.includes(targetScope.departmentId || '')) {
            return {
              valid: false,
              reason: 'Target department outside admin scope',
            };
          }
        }
      }

      return { valid: true };

    // ... other operations

    default:
      return { valid: true };
  }
}
```

---

## 7. Bulk Operations

### 7.1 Import Format

```yaml
# rbac-config.yaml - Full RBAC configuration export/import format
apiVersion: authz.engine/v1
kind: RBACConfiguration
metadata:
  name: production-rbac
  tenant: tenant-abc
  exportedAt: "2024-01-20T15:30:00Z"
  version: "1.0.0"

spec:
  # Role definitions
  roles:
    - name: admin
      description: Full administrative access
      metadata:
        tier: "1"

    - name: manager
      description: Team management access
      metadata:
        tier: "2"

    - name: developer
      description: Development access
      metadata:
        tier: "3"

    - name: viewer
      description: Read-only access
      metadata:
        tier: "4"

  # Permission definitions
  permissions:
    # Document permissions
    - name: documents:create
      resource: documents
      action: create
      description: Create documents

    - name: documents:read
      resource: documents
      action: read
      description: Read documents

    - name: documents:update
      resource: documents
      action: update
      description: Update documents

    - name: documents:delete
      resource: documents
      action: delete
      description: Delete documents

    - name: documents:*
      resource: documents
      action: "*"
      description: Full document access

    # User management permissions
    - name: users:read
      resource: users
      action: read

    - name: users:manage
      resource: users
      action: "*"

    # Conditional permission example
    - name: documents:approve
      resource: documents
      action: approve
      condition: >
        resource.attr.status == "pending" &&
        principal.attr.department == resource.attr.department

  # Role-permission mappings
  rolePermissions:
    admin:
      - documents:*
      - users:manage

    manager:
      - documents:read
      - documents:update
      - documents:approve
      - users:read

    developer:
      - documents:create
      - documents:read
      - documents:update

    viewer:
      - documents:read

  # Role hierarchy (parent inherits from children)
  hierarchy:
    - parent: admin
      children: [manager]

    - parent: manager
      children: [developer]

    - parent: developer
      children: [viewer]

  # Role assignments (optional in import)
  assignments:
    - role: admin
      principal: user-001
      principalType: user

    - role: manager
      principal: user-002
      principalType: user
      expiresAt: "2025-12-31T23:59:59Z"

    - role: developer
      principal: group-engineering
      principalType: group
      condition:
        scope:
          departmentId: engineering
```

### 7.2 Import Service Implementation

```typescript
/**
 * Bulk import service with validation and transaction support
 */
class BulkImportService {
  private roleStore: RoleStore;
  private permissionStore: PermissionStore;
  private hierarchyService: HierarchyService;
  private assignmentStore: AssignmentStore;

  async import(
    tenantId: string,
    config: RBACConfiguration,
    options: ImportOptions
  ): Promise<BulkImportResult> {
    const result: BulkImportResult = {
      success: true,
      dryRun: options.dryRun,
      stats: {
        rolesCreated: 0,
        rolesUpdated: 0,
        permissionsCreated: 0,
        assignmentsCreated: 0,
        hierarchyRelationsCreated: 0,
      },
      errors: [],
    };

    // Validation phase
    const validationErrors = await this.validate(tenantId, config);
    if (validationErrors.length > 0) {
      result.success = false;
      result.errors = validationErrors;
      return result;
    }

    if (options.dryRun) {
      return result;
    }

    // Import with transaction
    await this.db.transaction(async (tx) => {
      // 1. Import permissions first (roles depend on them)
      for (const perm of config.spec.permissions || []) {
        try {
          await this.permissionStore.upsert(tx, tenantId, perm);
          result.stats.permissionsCreated++;
        } catch (error) {
          result.errors.push({
            type: 'permission',
            name: perm.name,
            error: error.message,
          });
        }
      }

      // 2. Import roles
      for (const role of config.spec.roles || []) {
        try {
          const existing = await this.roleStore.findByName(tx, tenantId, role.name);
          if (existing && options.mode === 'merge') {
            await this.roleStore.update(tx, existing.id, role);
            result.stats.rolesUpdated++;
          } else {
            await this.roleStore.create(tx, tenantId, role);
            result.stats.rolesCreated++;
          }
        } catch (error) {
          result.errors.push({
            type: 'role',
            name: role.name,
            error: error.message,
          });
        }
      }

      // 3. Assign permissions to roles
      for (const [roleName, permNames] of Object.entries(config.spec.rolePermissions || {})) {
        const role = await this.roleStore.findByName(tx, tenantId, roleName);
        if (!role) continue;

        for (const permName of permNames) {
          const perm = await this.permissionStore.findByName(tx, tenantId, permName);
          if (!perm) continue;

          await this.roleStore.assignPermission(tx, role.id, perm.id);
        }
      }

      // 4. Build hierarchy
      for (const rel of config.spec.hierarchy || []) {
        try {
          const parentRole = await this.roleStore.findByName(tx, tenantId, rel.parent);
          for (const childName of rel.children) {
            const childRole = await this.roleStore.findByName(tx, tenantId, childName);
            if (parentRole && childRole) {
              await this.hierarchyService.addInheritance(
                tx,
                parentRole.id,
                childRole.id
              );
              result.stats.hierarchyRelationsCreated++;
            }
          }
        } catch (error) {
          result.errors.push({
            type: 'hierarchy',
            name: `${rel.parent}`,
            error: error.message,
          });
        }
      }

      // 5. Create assignments (optional)
      for (const assignment of config.spec.assignments || []) {
        try {
          const role = await this.roleStore.findByName(tx, tenantId, assignment.role);
          if (role) {
            await this.assignmentStore.create(tx, {
              tenantId,
              roleId: role.id,
              principalId: assignment.principal,
              principalType: assignment.principalType,
              expiresAt: assignment.expiresAt,
              condition: assignment.condition,
              assignedBy: 'bulk-import',
            });
            result.stats.assignmentsCreated++;
          }
        } catch (error) {
          result.errors.push({
            type: 'assignment',
            name: `${assignment.role}:${assignment.principal}`,
            error: error.message,
          });
        }
      }
    });

    result.success = result.errors.length === 0;
    return result;
  }

  private async validate(
    tenantId: string,
    config: RBACConfiguration
  ): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    // Validate role names
    for (const role of config.spec.roles || []) {
      if (!this.isValidName(role.name)) {
        errors.push({
          type: 'role',
          name: role.name,
          error: 'Invalid role name format',
        });
      }
    }

    // Validate permission patterns
    for (const perm of config.spec.permissions || []) {
      if (!this.isValidResourcePattern(perm.resource)) {
        errors.push({
          type: 'permission',
          name: perm.name,
          error: `Invalid resource pattern: ${perm.resource}`,
        });
      }
      if (!this.isValidActionPattern(perm.action)) {
        errors.push({
          type: 'permission',
          name: perm.name,
          error: `Invalid action pattern: ${perm.action}`,
        });
      }
    }

    // Validate hierarchy for cycles
    const hierarchyErrors = this.detectHierarchyCycles(config.spec.hierarchy || []);
    errors.push(...hierarchyErrors);

    // Validate references
    const roleNames = new Set((config.spec.roles || []).map(r => r.name));
    const permNames = new Set((config.spec.permissions || []).map(p => p.name));

    for (const [roleName, perms] of Object.entries(config.spec.rolePermissions || {})) {
      if (!roleNames.has(roleName)) {
        errors.push({
          type: 'rolePermission',
          name: roleName,
          error: `Role not defined: ${roleName}`,
        });
      }
      for (const permName of perms) {
        if (!permNames.has(permName)) {
          errors.push({
            type: 'rolePermission',
            name: permName,
            error: `Permission not defined: ${permName}`,
          });
        }
      }
    }

    return errors;
  }
}
```

---

## 8. Audit Logging

### 8.1 Audit Configuration

```typescript
/**
 * Audit logging configuration
 */
interface RBACAuditConfig {
  /** Enable/disable audit logging */
  enabled: boolean;
  /** Log level for different operations */
  levels: {
    reads: 'none' | 'summary' | 'detailed';
    writes: 'summary' | 'detailed';
    deletes: 'detailed';
  };
  /** Retention period in days */
  retentionDays: number;
  /** Async vs sync logging */
  async: boolean;
  /** Additional sinks (e.g., SIEM) */
  sinks: AuditSink[];
}

interface AuditSink {
  type: 'database' | 'kafka' | 'syslog' | 'webhook';
  config: Record<string, unknown>;
}
```

### 8.2 Audit Logger Implementation

```typescript
/**
 * RBAC Admin Audit Logger
 */
class RBACAuditLogger {
  private config: RBACAuditConfig;
  private sinks: AuditSink[];

  /**
   * Log an RBAC admin operation
   */
  async log(entry: Omit<RBACAdminAuditEntry, 'id' | 'timestamp'>): Promise<void> {
    const fullEntry: RBACAdminAuditEntry = {
      id: generateUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    // Determine log level
    const level = this.getLogLevel(entry.details.action);
    if (level === 'none') return;

    // Sanitize entry based on level
    const sanitizedEntry = level === 'summary'
      ? this.summarize(fullEntry)
      : fullEntry;

    // Write to all configured sinks
    await Promise.all(
      this.sinks.map(sink => this.writeToSink(sink, sanitizedEntry))
    );
  }

  /**
   * Create summary version (remove detailed state diffs)
   */
  private summarize(entry: RBACAdminAuditEntry): RBACAdminAuditEntry {
    return {
      ...entry,
      details: {
        action: entry.details.action,
        // Omit previousState, newState, changes for summary
      },
    };
  }

  /**
   * Query audit log with filters
   */
  async query(filters: AuditQueryFilters): Promise<AuditQueryResult> {
    const { tenantId, startTime, endTime, operation, actorId, targetType, limit, offset } = filters;

    // Build query
    let query = this.db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.tenantId, tenantId))
      .orderBy(desc(auditLogTable.timestamp));

    if (startTime) {
      query = query.where(gte(auditLogTable.timestamp, startTime));
    }
    if (endTime) {
      query = query.where(lte(auditLogTable.timestamp, endTime));
    }
    if (operation) {
      query = query.where(eq(auditLogTable.operation, operation));
    }
    if (actorId) {
      query = query.where(eq(auditLogTable.actorId, actorId));
    }
    if (targetType) {
      query = query.where(eq(auditLogTable.targetType, targetType));
    }

    const entries = await query.limit(limit).offset(offset);
    const total = await this.countQuery(filters);

    return { entries, total, limit, offset };
  }
}

/**
 * Audit query filters
 */
interface AuditQueryFilters {
  tenantId: string;
  startTime?: string;
  endTime?: string;
  operation?: RBACOperation;
  actorId?: string;
  targetType?: 'role' | 'permission' | 'assignment' | 'hierarchy';
  limit?: number;
  offset?: number;
}
```

### 8.3 Audit Entry Examples

```json
// Role creation audit entry
{
  "id": "audit-001",
  "tenantId": "tenant-abc",
  "timestamp": "2024-01-20T15:30:00.123Z",
  "operation": "role.create",
  "actor": {
    "id": "admin-user-1",
    "type": "user",
    "ipAddress": "192.168.1.100",
    "userAgent": "Mozilla/5.0..."
  },
  "target": {
    "type": "role",
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "content-reviewer"
  },
  "details": {
    "action": "create",
    "newState": {
      "name": "content-reviewer",
      "description": "Can review and approve content",
      "permissions": ["content:review", "content:approve"]
    }
  },
  "request": {
    "id": "req-123456",
    "method": "POST",
    "path": "/v1/admin/rbac/roles"
  },
  "result": "success"
}

// Role assignment audit entry
{
  "id": "audit-002",
  "tenantId": "tenant-abc",
  "timestamp": "2024-01-20T15:35:00.456Z",
  "operation": "principal.role.assign",
  "actor": {
    "id": "admin-user-1",
    "type": "user",
    "ipAddress": "192.168.1.100"
  },
  "target": {
    "type": "assignment",
    "id": "assign-001",
    "name": "user-12345 -> content-reviewer"
  },
  "details": {
    "action": "assign",
    "newState": {
      "roleId": "550e8400-e29b-41d4-a716-446655440000",
      "principalId": "user-12345",
      "principalType": "user",
      "expiresAt": "2025-12-31T23:59:59Z"
    }
  },
  "request": {
    "id": "req-123457",
    "method": "POST",
    "path": "/v1/admin/rbac/assignments"
  },
  "result": "success"
}

// Hierarchy modification failure
{
  "id": "audit-003",
  "tenantId": "tenant-abc",
  "timestamp": "2024-01-20T16:00:00.789Z",
  "operation": "hierarchy.add",
  "actor": {
    "id": "admin-user-2",
    "type": "user"
  },
  "target": {
    "type": "hierarchy",
    "id": "admin->manager",
    "name": "admin inherits manager"
  },
  "details": {
    "action": "create",
    "newState": {
      "parentRoleId": "role-admin",
      "childRoleId": "role-manager"
    }
  },
  "request": {
    "id": "req-123458",
    "method": "POST",
    "path": "/v1/admin/rbac/hierarchy"
  },
  "result": "failure",
  "error": {
    "code": "CIRCULAR_HIERARCHY",
    "message": "Adding this relationship would create a circular dependency"
  }
}
```

---

## 9. Integration with Policy Engine

### 9.1 RBAC-to-Policy Translation

The RBAC Admin API manages role and permission data, which must be translated into policy rules for the core authorization engine.

```typescript
/**
 * Translates RBAC data into policy format for the decision engine
 */
class RBACPolicyTranslator {
  /**
   * Generate derived roles policy from RBAC assignments
   */
  generateDerivedRolesPolicy(
    tenantId: string,
    roles: Role[],
    assignments: RoleAssignment[]
  ): DerivedRolesPolicy {
    const definitions: DerivedRoleDefinition[] = [];

    for (const role of roles) {
      // Create derived role that checks assignment
      definitions.push({
        name: `rbac_${role.name}`,
        parentRoles: ['*'], // Any base role
        condition: {
          expression: `
            principal.id in rbac_assignments["${role.id}"] ||
            principal.groups.exists(g, g in rbac_group_assignments["${role.id}"])
          `,
        },
      });
    }

    return {
      apiVersion: 'authz.engine/v1',
      kind: 'DerivedRoles',
      metadata: {
        name: `rbac-derived-roles-${tenantId}`,
      },
      spec: {
        definitions,
      },
    };
  }

  /**
   * Generate resource policy from RBAC permissions
   */
  generateResourcePolicy(
    tenantId: string,
    resource: string,
    permissions: Permission[],
    rolePermissions: Map<string, Permission[]>
  ): ResourcePolicy {
    const rules: PolicyRule[] = [];

    // Group permissions by action
    const actionRoles = new Map<string, string[]>();

    for (const [roleId, perms] of rolePermissions.entries()) {
      for (const perm of perms) {
        if (this.matchesResource(perm.resource, resource)) {
          const actions = this.expandAction(perm.action);
          for (const action of actions) {
            if (!actionRoles.has(action)) {
              actionRoles.set(action, []);
            }
            actionRoles.get(action)!.push(`rbac_${roleId}`);
          }
        }
      }
    }

    // Create rules
    for (const [action, derivedRoles] of actionRoles.entries()) {
      rules.push({
        actions: [action],
        effect: 'allow',
        derivedRoles,
      });
    }

    return {
      apiVersion: 'authz.engine/v1',
      kind: 'ResourcePolicy',
      metadata: {
        name: `rbac-policy-${tenantId}-${resource}`,
      },
      spec: {
        resource,
        rules,
      },
    };
  }

  /**
   * Sync RBAC data to policy engine
   */
  async syncToEngine(
    tenantId: string,
    engine: PolicyEngine
  ): Promise<SyncResult> {
    const roles = await this.roleStore.list(tenantId);
    const permissions = await this.permissionStore.list(tenantId);
    const assignments = await this.assignmentStore.list(tenantId);

    // Generate derived roles
    const derivedRolesPolicy = this.generateDerivedRolesPolicy(
      tenantId,
      roles,
      assignments
    );

    // Generate resource policies
    const resources = [...new Set(permissions.map(p => p.resource))];
    const resourcePolicies = resources.map(resource =>
      this.generateResourcePolicy(
        tenantId,
        resource,
        permissions.filter(p => this.matchesResource(p.resource, resource)),
        this.buildRolePermissionMap(roles, permissions)
      )
    );

    // Load into engine
    await engine.loadDerivedRoles(derivedRolesPolicy);
    for (const policy of resourcePolicies) {
      await engine.loadResourcePolicy(policy);
    }

    return {
      success: true,
      policiesLoaded: resourcePolicies.length + 1,
    };
  }
}
```

### 9.2 Auxiliary Data Provider

```typescript
/**
 * Provides RBAC data as auxiliary data for authorization requests
 */
class RBACAuxDataProvider implements AuxDataProvider {
  private cache: RBACCache;
  private roleStore: RoleStore;
  private assignmentStore: AssignmentStore;

  async getAuxData(
    request: CheckRequest
  ): Promise<Record<string, unknown>> {
    const tenantId = request.auxData?.tenantId as string;
    const principalId = request.principal.id;

    // Get cached or fresh data
    const cacheKey = `rbac:${tenantId}:${principalId}`;
    let rbacData = await this.cache.get(cacheKey);

    if (!rbacData) {
      // Load effective roles and permissions
      const effectiveRoles = await this.getEffectiveRoles(tenantId, principalId);
      const effectivePermissions = await this.getEffectivePermissions(
        tenantId,
        effectiveRoles
      );

      rbacData = {
        effectiveRoles: effectiveRoles.map(r => r.name),
        effectivePermissions: effectivePermissions.map(p => `${p.resource}:${p.action}`),
        rbacAssignments: await this.getAssignmentMap(tenantId),
      };

      await this.cache.set(cacheKey, rbacData, { ttl: 60000 }); // 1 minute TTL
    }

    return {
      rbac: rbacData,
    };
  }
}
```

---

## 10. Multi-tenant RBAC

### 10.1 Tenant Isolation Model

```typescript
/**
 * Multi-tenant RBAC configuration
 */
interface MultiTenantRBACConfig {
  /** Isolation strategy */
  isolation: 'namespace' | 'database' | 'schema';
  /** Whether to share base roles across tenants */
  sharedBaseRoles: boolean;
  /** Global admin roles that can manage all tenants */
  globalAdminRoles: string[];
  /** Per-tenant limits */
  tenantLimits: {
    maxRoles: number;
    maxPermissions: number;
    maxAssignments: number;
    maxHierarchyDepth: number;
  };
}
```

### 10.2 Tenant-Aware Services

```typescript
/**
 * Tenant context for RBAC operations
 */
interface RBACTenantContext {
  tenantId: string;
  config: TenantConfig;
  limits: TenantRBACLimits;
}

/**
 * Tenant-aware role service
 */
class TenantAwareRoleService {
  private roleStore: RoleStore;

  async createRole(
    context: RBACTenantContext,
    request: CreateRoleRequest
  ): Promise<Role> {
    // Check tenant limits
    const currentCount = await this.roleStore.count(context.tenantId);
    if (currentCount >= context.limits.maxRoles) {
      throw new TenantLimitExceededError(
        `Maximum roles (${context.limits.maxRoles}) reached for tenant`
      );
    }

    // Validate name uniqueness within tenant
    const existing = await this.roleStore.findByName(
      context.tenantId,
      request.name
    );
    if (existing) {
      throw new ConflictError(`Role '${request.name}' already exists`);
    }

    // Create role with tenant isolation
    return this.roleStore.create({
      tenantId: context.tenantId,
      ...request,
    });
  }

  async listRoles(
    context: RBACTenantContext,
    options: ListOptions
  ): Promise<Role[]> {
    // Always filter by tenant
    return this.roleStore.list({
      tenantId: context.tenantId,
      ...options,
    });
  }
}
```

### 10.3 Cross-Tenant Operations

```typescript
/**
 * Global admin operations across tenants
 */
class GlobalRBACAdminService {
  /**
   * List roles across all tenants (global admin only)
   */
  async listAllRoles(
    actor: Principal,
    options: CrossTenantListOptions
  ): Promise<{ tenantId: string; roles: Role[] }[]> {
    // Verify global admin permission
    if (!this.isGlobalAdmin(actor)) {
      throw new ForbiddenError('Global admin access required');
    }

    const tenants = options.tenantIds || await this.getTenantIds();
    const results = await Promise.all(
      tenants.map(async (tenantId) => ({
        tenantId,
        roles: await this.roleStore.list({ tenantId }),
      }))
    );

    return results;
  }

  /**
   * Copy role definition to another tenant
   */
  async copyRoleToTenant(
    actor: Principal,
    sourceRole: Role,
    targetTenantId: string
  ): Promise<Role> {
    // Verify global admin or both tenant admin
    if (!this.canCopyBetweenTenants(actor, sourceRole.tenantId, targetTenantId)) {
      throw new ForbiddenError('Insufficient permissions for cross-tenant copy');
    }

    // Create copy in target tenant
    return this.roleStore.create({
      ...sourceRole,
      id: undefined, // Generate new ID
      tenantId: targetTenantId,
      metadata: {
        ...sourceRole.metadata,
        copiedFrom: {
          tenantId: sourceRole.tenantId,
          roleId: sourceRole.id,
          copiedAt: new Date().toISOString(),
        },
      },
    });
  }
}
```

---

## 11. Testing Strategy

### 11.1 Unit Tests

| Component | Coverage Target | Test File |
|-----------|-----------------|-----------|
| RoleService | 90% | `role.service.test.ts` |
| PermissionService | 90% | `permission.service.test.ts` |
| AssignmentService | 90% | `assignment.service.test.ts` |
| HierarchyService | 95% | `hierarchy.service.test.ts` |
| EffectivePermsCalculator | 95% | `effective-permissions.test.ts` |
| BulkImportService | 90% | `bulk-import.service.test.ts` |
| RBACAuditLogger | 85% | `audit-logger.test.ts` |

### 11.2 Integration Tests

| Scenario | Components Involved | Test File |
|----------|---------------------|-----------|
| Full RBAC workflow | All services | `rbac-workflow.integration.test.ts` |
| Role hierarchy resolution | HierarchyService, EffectivePerms | `hierarchy.integration.test.ts` |
| Multi-tenant isolation | TenantAwareServices | `multi-tenant.integration.test.ts` |
| Policy engine sync | RBACPolicyTranslator, Engine | `policy-sync.integration.test.ts` |
| Bulk import/export | BulkImportService | `bulk-operations.integration.test.ts` |

### 11.3 Test Fixtures

```yaml
# tests/fixtures/rbac-test-data.yaml
name: RBAC Integration Test Data

tenants:
  - id: test-tenant-1
    name: Test Tenant 1
  - id: test-tenant-2
    name: Test Tenant 2

roles:
  - name: super-admin
    tenantId: test-tenant-1
    description: Super administrator
  - name: admin
    tenantId: test-tenant-1
    description: Administrator
  - name: manager
    tenantId: test-tenant-1
    description: Manager
  - name: user
    tenantId: test-tenant-1
    description: Regular user

permissions:
  - name: documents:create
    resource: documents
    action: create
  - name: documents:read
    resource: documents
    action: read
  - name: documents:update
    resource: documents
    action: update
  - name: documents:delete
    resource: documents
    action: delete
  - name: users:manage
    resource: users
    action: "*"

hierarchy:
  - parent: super-admin
    child: admin
  - parent: admin
    child: manager
  - parent: manager
    child: user

testCases:
  - name: User inherits permissions through hierarchy
    principal:
      id: test-user-1
      roles: [admin]
    expectedEffectiveRoles:
      - admin (direct)
      - manager (inherited)
      - user (inherited)
    expectedPermissions:
      - documents:create
      - documents:read
      - documents:update
      - documents:delete
      - users:manage

  - name: Circular hierarchy detection
    operation: addHierarchy
    input:
      parent: user
      child: super-admin
    expectedError: CIRCULAR_HIERARCHY

  - name: Tenant isolation
    tenant: test-tenant-1
    operation: listRoles
    expectedRoles:
      - super-admin
      - admin
      - manager
      - user
    notExpectedRoles:
      - test-tenant-2-roles
```

### 11.4 Performance Tests

| Test | Target | Scenario |
|------|--------|----------|
| Role lookup | < 5ms p99 | 10,000 roles, random lookup |
| Effective permissions | < 20ms p99 | 10 roles with 50 permissions each |
| Hierarchy traversal | < 10ms p99 | 5-level hierarchy, 1000 roles |
| Bulk import | < 10s | 1000 roles, 5000 permissions |
| Concurrent assignments | 1000/s | Parallel role assignments |

---

## 12. RBAC Pattern Examples

### 12.1 Flat RBAC (RBAC0)

Simple role-permission mapping without hierarchy.

```yaml
roles:
  - name: admin
    permissions:
      - "*:*"

  - name: editor
    permissions:
      - "documents:create"
      - "documents:read"
      - "documents:update"

  - name: viewer
    permissions:
      - "documents:read"
      - "reports:read"

# No hierarchy - each role is independent
```

### 12.2 Hierarchical RBAC (RBAC1)

Role inheritance for organizational structures.

```yaml
roles:
  - name: ceo
    permissions:
      - "company:*"

  - name: vp
    permissions:
      - "department:*"

  - name: manager
    permissions:
      - "team:*"

  - name: employee
    permissions:
      - "self:*"

hierarchy:
  # CEO inherits all permissions from VP, Manager, Employee
  - parent: ceo
    children: [vp]
  - parent: vp
    children: [manager]
  - parent: manager
    children: [employee]

# Result: CEO has company:* + department:* + team:* + self:*
```

### 12.3 Constrained RBAC (RBAC2)

With separation of duties and cardinality constraints.

```yaml
roles:
  - name: requester
    permissions:
      - "purchase:request"
    constraints:
      mutuallyExclusive: [approver]  # Cannot have both

  - name: approver
    permissions:
      - "purchase:approve"
    constraints:
      mutuallyExclusive: [requester]
      prerequisiteRoles: [manager]  # Must be manager first
      maxAssignments: 10  # Only 10 users can be approvers

constraints:
  separationOfDuty:
    - roles: [requester, approver]
      type: static  # Cannot assign both to same user

    - roles: [buyer, auditor]
      type: dynamic  # Cannot use both in same session
```

### 12.4 Attribute-Enhanced RBAC (ARBAC)

RBAC with attribute-based conditions.

```yaml
roles:
  - name: regional-manager
    permissions:
      - name: "orders:approve"
        condition: >
          resource.attr.region == principal.attr.region &&
          resource.attr.amount <= 10000

      - name: "employees:manage"
        condition: >
          resource.attr.department in principal.attr.managedDepartments

  - name: shift-supervisor
    permissions:
      - name: "schedules:modify"
        condition: >
          now().getHours() >= 6 && now().getHours() <= 22 &&
          resource.attr.shiftId == principal.attr.currentShift

assignments:
  - role: regional-manager
    principal: user-123
    condition:
      temporal:
        validFrom: "2024-01-01T00:00:00Z"
        validUntil: "2024-12-31T23:59:59Z"
      scope:
        region: "us-west"
```

---

## 13. Related Documents

- [CORE-ARCHITECTURE-SDD.md](./CORE-ARCHITECTURE-SDD.md) - System architecture overview
- [DERIVED-ROLES-SDD.md](./DERIVED-ROLES-SDD.md) - Derived roles for dynamic RBAC
- [MULTI-TENANCY-SDD.md](./MULTI-TENANCY-SDD.md) - Multi-tenant isolation
- [OBSERVABILITY-SDD.md](./OBSERVABILITY-SDD.md) - Metrics and audit logging
- [SERVER-PACKAGE-SDD.md](./SERVER-PACKAGE-SDD.md) - REST/gRPC server implementation
- [COMPLIANCE-SECURITY-SDD.md](./COMPLIANCE-SECURITY-SDD.md) - Security and compliance

---

## 14. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-11-23 | Initial specification |

---

*This document specifies the RBAC Admin API for the AuthZ Engine, providing comprehensive role-based access control management capabilities with multi-tenant support, audit logging, and integration with the policy engine.*
