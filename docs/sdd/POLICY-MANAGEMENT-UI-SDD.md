# Policy Management UI - Software Design Document

**Module**: `@authz-engine/ui`
**Version**: 1.0.0
**Status**: Specification
**Author**: AuthZ Engine Team
**Created**: 2024-11-23
**Last Updated**: 2024-11-23
**Reviewers**: TBD

---

## 1. Overview

### 1.1 Purpose

The Policy Management UI provides a comprehensive web-based interface for managing authorization policies within the AuthZ Engine. It enables policy administrators to:

- **Create and edit policies** with visual and code-based editors
- **Test policies** before deployment with real-time validation
- **Manage derived roles** through an intuitive interface
- **Define schemas** for principals and resources
- **Deploy policies** through a controlled workflow
- **View audit trails** for compliance and debugging
- **Support multi-tenancy** with tenant-scoped administration

### 1.2 Scope

**In Scope:**
- Visual policy editor with CEL syntax highlighting
- Policy validation and testing console
- Derived roles management interface
- Schema editor for principals/resources
- Policy deployment workflow with approvals
- Audit trail viewer with filtering
- Multi-tenant administration
- RBAC for admin access
- Integration with REST API

**Out of Scope:**
- Real-time collaborative editing (future enhancement)
- Policy version control UI (uses Git backend)
- Custom visualization builders
- Mobile-specific interfaces

### 1.3 Context

```
+-------------------------------------------------------------------------+
|                         AuthZ Engine Ecosystem                           |
+-------------------------------------------------------------------------+
|                                                                          |
|  +------------------+     +------------------------+                     |
|  | Applications     |     | Policy Management UI   |<-- This SDD        |
|  | (Consumers)      |     | (Administrators)       |                     |
|  +--------+---------+     +-----------+------------+                     |
|           |                           |                                  |
|           v                           v                                  |
|  +-------------------------------------------------------+              |
|  |                   AuthZ Engine Server                   |              |
|  |  +----------------+  +----------------+  +------------+ |              |
|  |  | Check API      |  | Admin API      |  | gRPC API   | |              |
|  |  +----------------+  +----------------+  +------------+ |              |
|  +-------------------------------------------------------+              |
|                                                                          |
+-------------------------------------------------------------------------+
```

### 1.4 Key Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Next.js 14+ with App Router | Server components, streaming, optimal DX | Remix, SvelteKit, Vite+React |
| Monaco Editor for code | Industry-standard, CEL support, extensible | CodeMirror, Ace Editor |
| TailwindCSS + Radix UI | Accessible, customizable, consistent design | Chakra UI, Material UI |
| React Query for data | Caching, mutations, optimistic updates | SWR, RTK Query |
| Zod for validation | TypeScript-first, schema inference | Yup, io-ts |
| Playwright for E2E | Cross-browser, reliable, parallel execution | Cypress, Puppeteer |

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-UI-001 | Display list of policies with filtering and search | Must Have | Pending |
| FR-UI-002 | Create new resource policies via visual editor | Must Have | Pending |
| FR-UI-003 | Edit existing policies with CEL syntax highlighting | Must Have | Pending |
| FR-UI-004 | Validate policy syntax in real-time | Must Have | Pending |
| FR-UI-005 | Test policies against sample requests | Must Have | Pending |
| FR-UI-006 | Manage derived roles definitions | Must Have | Pending |
| FR-UI-007 | Edit principal and resource schemas | Must Have | Pending |
| FR-UI-008 | Deploy policies with approval workflow | Should Have | Pending |
| FR-UI-009 | View policy deployment history | Should Have | Pending |
| FR-UI-010 | View and filter audit logs | Should Have | Pending |
| FR-UI-011 | Support multi-tenant policy management | Should Have | Pending |
| FR-UI-012 | Role-based access control for admin users | Must Have | Pending |
| FR-UI-013 | Import/export policies as YAML/JSON | Should Have | Pending |
| FR-UI-014 | Diff view for policy changes | Could Have | Pending |
| FR-UI-015 | Policy dependency visualization | Could Have | Pending |

### 2.2 Non-Functional Requirements

| ID | Category | Requirement | Target |
|----|----------|-------------|--------|
| NFR-UI-001 | Performance | Initial page load | < 2s (LCP) |
| NFR-UI-002 | Performance | Policy editor responsiveness | < 100ms input latency |
| NFR-UI-003 | Performance | Policy list rendering (1000 items) | < 500ms |
| NFR-UI-004 | Accessibility | WCAG compliance | Level AA |
| NFR-UI-005 | Security | Session timeout | 30 minutes idle |
| NFR-UI-006 | Security | CSRF protection | All mutations |
| NFR-UI-007 | Usability | Mobile responsiveness | Tablet+ supported |
| NFR-UI-008 | Reliability | Error boundary coverage | 100% of routes |

---

## 3. Architecture

### 3.1 Component Diagram

```
+-------------------------------------------------------------------------+
|                       Policy Management UI                               |
+-------------------------------------------------------------------------+
|                                                                          |
|  +------------------+    +------------------------+    +---------------+ |
|  | Authentication   |    | Layout Shell           |    | Theme         | |
|  | (NextAuth.js)    |    | (Navigation, Sidebar)  |    | Provider      | |
|  +------------------+    +------------------------+    +---------------+ |
|                                                                          |
|  +----------------------------------------------------------------------+|
|  |                         Main Content Area                             ||
|  |  +-------------+  +-------------+  +-------------+  +-------------+  ||
|  |  | Policy      |  | Derived     |  | Schema      |  | Test        |  ||
|  |  | Editor      |  | Roles Editor|  | Editor      |  | Console     |  ||
|  |  +-------------+  +-------------+  +-------------+  +-------------+  ||
|  |                                                                       ||
|  |  +-------------+  +-------------+  +-------------+  +-------------+  ||
|  |  | Policy      |  | Deployment  |  | Audit       |  | Settings    |  ||
|  |  | List        |  | Manager     |  | Viewer      |  | Panel       |  ||
|  |  +-------------+  +-------------+  +-------------+  +-------------+  ||
|  +----------------------------------------------------------------------+|
|                                                                          |
|  +----------------------------------------------------------------------+|
|  |                         Shared Components                             ||
|  |  +----------+  +----------+  +----------+  +----------+  +----------+||
|  |  | Monaco   |  | Form     |  | Table    |  | Modal    |  | Toast    |||
|  |  | Editor   |  | Builder  |  | DataGrid |  | Dialog   |  | System   |||
|  |  +----------+  +----------+  +----------+  +----------+  +----------+||
|  +----------------------------------------------------------------------+|
|                                                                          |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
|                         API Integration Layer                            |
|  +----------------+  +----------------+  +----------------+              |
|  | Policy API     |  | Admin API      |  | Audit API      |              |
|  | Client         |  | Client         |  | Client         |              |
|  +----------------+  +----------------+  +----------------+              |
+-------------------------------------------------------------------------+
```

### 3.2 Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| Authentication | User authentication via NextAuth.js, session management |
| Layout Shell | Navigation, sidebar, breadcrumbs, tenant selector |
| Policy Editor | Monaco-based policy editing with CEL support |
| Policy List | Filterable, sortable table of all policies |
| Derived Roles Editor | CRUD operations for derived role definitions |
| Schema Editor | JSON Schema editor for principals/resources |
| Test Console | Execute test requests against policies |
| Deployment Manager | Policy deployment workflow with approvals |
| Audit Viewer | Searchable audit log viewer |
| Settings Panel | User preferences, tenant configuration |

### 3.3 Data Flow

```
User Action                    UI Component                   API                 Server
    |                              |                           |                     |
    |  Edit Policy                 |                           |                     |
    +----------------------------->|                           |                     |
    |                              |                           |                     |
    |                              | Validate (client-side)    |                     |
    |                              +-------------------------->|                     |
    |                              |                           |                     |
    |                              | PUT /api/v1/policies/:id  |                     |
    |                              +-------------------------->|                     |
    |                              |                           |                     |
    |                              |                           | Validate & Compile  |
    |                              |                           +-------------------->|
    |                              |                           |                     |
    |                              |                           | Store Policy        |
    |                              |                           +-------------------->|
    |                              |                           |                     |
    |                              |                           |<--------------------+
    |                              |<--------------------------+                     |
    |                              |                           |                     |
    |                              | Optimistic Update         |                     |
    |<-----------------------------+ Invalidate Cache          |                     |
    |                              |                           |                     |
```

### 3.4 Integration Points

| Integration | Protocol | Direction | Description |
|-------------|----------|-----------|-------------|
| AuthZ Engine API | REST/HTTP | Out | Policy CRUD, validation, testing |
| Identity Provider | OIDC | In | Admin user authentication |
| Audit Log Service | REST/HTTP | Out | Retrieve audit events |
| Storage Backend | Internal | N/A | Policy persistence via API |

---

## 4. Interfaces

### 4.1 TypeScript Type Definitions

#### Core Policy Types

```typescript
/**
 * API version constant for policy documents
 */
type PolicyApiVersion = 'api.cerbos.dev/v1';

/**
 * Supported policy kinds
 */
type PolicyKind = 'ResourcePolicy' | 'DerivedRoles' | 'PrincipalPolicy' | 'ExportVariables';

/**
 * Effect applied by a policy rule
 */
type Effect = 'EFFECT_ALLOW' | 'EFFECT_DENY';

/**
 * Policy metadata common to all policy types
 */
interface PolicyMetadata {
  /** Unique policy name */
  name: string;
  /** Policy version string */
  version?: string;
  /** Human-readable description */
  description?: string;
  /** Arbitrary key-value annotations */
  annotations?: Record<string, string>;
  /** Policy labels for filtering */
  labels?: Record<string, string>;
  /** Source file path (read-only) */
  sourceFile?: string;
  /** Policy hash for change detection */
  hash?: string;
}

/**
 * CEL condition expression
 */
interface Condition {
  match: {
    /** CEL expression string */
    expr: string;
    /** All conditions must match */
    all?: Condition[];
    /** Any condition must match */
    any?: Condition[];
    /** No conditions must match */
    none?: Condition[];
  };
}

/**
 * Output expression for policy rule
 */
interface Output {
  /** Output key */
  expr: string;
  /** CEL expression for value */
  when?: {
    ruleActivated: string;
    conditionNotMet: string;
  };
}

/**
 * Resource policy rule definition
 */
interface PolicyRule {
  /** Rule name for tracing */
  name?: string;
  /** Actions this rule applies to */
  actions: string[];
  /** Effect when rule matches */
  effect: Effect;
  /** Static roles that can match */
  roles?: string[];
  /** Derived roles that can match */
  derivedRoles?: string[];
  /** Optional condition for rule activation */
  condition?: Condition;
  /** Optional outputs when rule fires */
  output?: Output;
}

/**
 * Resource policy specification
 */
interface ResourcePolicySpec {
  /** Resource kind this policy applies to */
  resource: string;
  /** Policy version for the resource */
  version: string;
  /** Imported derived roles */
  importDerivedRoles?: string[];
  /** Policy rules */
  rules: PolicyRule[];
  /** Scope for multi-tenant policies */
  scope?: string;
  /** Schema validation for resource */
  schemas?: {
    principalSchema?: {
      ref: string;
    };
    resourceSchema?: {
      ref: string;
    };
  };
  /** Local variables for CEL expressions */
  variables?: {
    local?: Record<string, string>;
    import?: string[];
  };
}

/**
 * Complete resource policy document
 */
interface ResourcePolicy {
  apiVersion: PolicyApiVersion;
  kind: 'ResourcePolicy';
  metadata: PolicyMetadata;
  spec: ResourcePolicySpec;
}

/**
 * Derived role definition
 */
interface DerivedRoleDefinition {
  /** Derived role name */
  name: string;
  /** Parent roles required */
  parentRoles: string[];
  /** Condition for role activation */
  condition?: Condition;
}

/**
 * Derived roles policy specification
 */
interface DerivedRolesSpec {
  /** Name for this derived roles set */
  name: string;
  /** Role definitions */
  definitions: DerivedRoleDefinition[];
  /** Local variables */
  variables?: {
    local?: Record<string, string>;
    import?: string[];
  };
}

/**
 * Complete derived roles document
 */
interface DerivedRolesPolicy {
  apiVersion: PolicyApiVersion;
  kind: 'DerivedRoles';
  metadata: PolicyMetadata;
  spec: DerivedRolesSpec;
}

/**
 * Principal policy rule
 */
interface PrincipalRule {
  /** Resource this rule applies to */
  resource: string;
  /** Actions and effects */
  actions: Array<{
    action: string;
    condition?: Condition;
    effect: Effect;
    output?: Output;
  }>;
}

/**
 * Principal policy specification
 */
interface PrincipalPolicySpec {
  /** Principal ID pattern */
  principal: string;
  /** Policy version */
  version: string;
  /** Principal-specific rules */
  rules: PrincipalRule[];
  /** Scope for multi-tenant */
  scope?: string;
  /** Local variables */
  variables?: {
    local?: Record<string, string>;
    import?: string[];
  };
}

/**
 * Complete principal policy document
 */
interface PrincipalPolicy {
  apiVersion: PolicyApiVersion;
  kind: 'PrincipalPolicy';
  metadata: PolicyMetadata;
  spec: PrincipalPolicySpec;
}

/**
 * Union type for all policy documents
 */
type Policy = ResourcePolicy | DerivedRolesPolicy | PrincipalPolicy;
```

#### UI Component Props Types

```typescript
/**
 * Policy editor component props
 */
interface PolicyEditorProps {
  /** Policy to edit (undefined for new) */
  policy?: Policy;
  /** Called when policy is saved */
  onSave: (policy: Policy) => Promise<void>;
  /** Called when editing is cancelled */
  onCancel: () => void;
  /** Read-only mode */
  readOnly?: boolean;
  /** Editor theme */
  theme?: 'light' | 'dark';
  /** Show validation errors inline */
  showValidation?: boolean;
}

/**
 * Policy list component props
 */
interface PolicyListProps {
  /** Initial filter values */
  initialFilters?: PolicyFilters;
  /** Called when policy is selected */
  onSelectPolicy: (policy: PolicySummary) => void;
  /** Enable multi-select */
  multiSelect?: boolean;
  /** Show deleted policies */
  showDeleted?: boolean;
}

/**
 * Policy filter options
 */
interface PolicyFilters {
  /** Filter by policy kind */
  kind?: PolicyKind[];
  /** Filter by resource type */
  resource?: string;
  /** Search by name */
  search?: string;
  /** Filter by scope/tenant */
  scope?: string;
  /** Filter by labels */
  labels?: Record<string, string>;
  /** Sort field */
  sortBy?: 'name' | 'updatedAt' | 'createdAt';
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Policy summary for list views
 */
interface PolicySummary {
  /** Unique policy ID */
  id: string;
  /** Policy kind */
  kind: PolicyKind;
  /** Policy name */
  name: string;
  /** Resource type (for resource policies) */
  resource?: string;
  /** Policy version */
  version?: string;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Deployment status */
  status: PolicyStatus;
  /** Current scope */
  scope?: string;
}

/**
 * Policy deployment status
 */
type PolicyStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'deployed'
  | 'deprecated'
  | 'archived';

/**
 * Derived roles editor props
 */
interface DerivedRolesEditorProps {
  /** Derived roles policy to edit */
  policy?: DerivedRolesPolicy;
  /** Save callback */
  onSave: (policy: DerivedRolesPolicy) => Promise<void>;
  /** Cancel callback */
  onCancel: () => void;
  /** Available parent roles for selection */
  availableRoles?: string[];
}

/**
 * Schema editor props
 */
interface SchemaEditorProps {
  /** Schema type */
  schemaType: 'principal' | 'resource';
  /** Schema content */
  schema?: JSONSchema;
  /** Save callback */
  onSave: (schema: JSONSchema) => Promise<void>;
  /** Validation mode */
  validationMode?: 'strict' | 'permissive';
}

/**
 * JSON Schema type (simplified)
 */
interface JSONSchema {
  $schema?: string;
  $id?: string;
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  additionalProperties?: boolean;
  definitions?: Record<string, JSONSchema>;
}

/**
 * Test console props
 */
interface TestConsoleProps {
  /** Pre-selected policy to test */
  policy?: Policy;
  /** Sample principals for quick selection */
  samplePrincipals?: Principal[];
  /** Sample resources for quick selection */
  sampleResources?: Resource[];
}

/**
 * Principal definition for testing
 */
interface Principal {
  id: string;
  roles: string[];
  attr?: Record<string, unknown>;
  policyVersion?: string;
  scope?: string;
}

/**
 * Resource definition for testing
 */
interface Resource {
  kind: string;
  id: string;
  attr?: Record<string, unknown>;
  policyVersion?: string;
  scope?: string;
}

/**
 * Test request structure
 */
interface TestRequest {
  principal: Principal;
  resource: Resource;
  actions: string[];
  auxData?: {
    jwt?: Record<string, unknown>;
  };
}

/**
 * Test response structure
 */
interface TestResponse {
  requestId: string;
  results: Array<{
    action: string;
    effect: Effect;
    policy: string;
    rule?: string;
  }>;
  effectiveDerivedRoles: string[];
  validationErrors?: ValidationError[];
  evaluationTrace?: EvaluationTrace;
}

/**
 * Validation error details
 */
interface ValidationError {
  path: string;
  message: string;
  code: string;
}

/**
 * CEL evaluation trace for debugging
 */
interface EvaluationTrace {
  policyName: string;
  rules: Array<{
    name?: string;
    matched: boolean;
    conditionResult?: boolean;
    conditionError?: string;
  }>;
  derivedRoles: Array<{
    name: string;
    activated: boolean;
    reason?: string;
  }>;
  duration: number;
}

/**
 * Audit log entry
 */
interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: AuditAction;
  actor: {
    id: string;
    email?: string;
    roles: string[];
  };
  target: {
    type: 'policy' | 'derived_roles' | 'schema' | 'deployment';
    id: string;
    name?: string;
  };
  changes?: {
    before?: unknown;
    after?: unknown;
  };
  metadata?: Record<string, unknown>;
  tenantId?: string;
}

/**
 * Audit action types
 */
type AuditAction =
  | 'policy.create'
  | 'policy.update'
  | 'policy.delete'
  | 'policy.deploy'
  | 'policy.approve'
  | 'policy.reject'
  | 'derived_roles.create'
  | 'derived_roles.update'
  | 'derived_roles.delete'
  | 'schema.create'
  | 'schema.update'
  | 'schema.delete'
  | 'test.execute';

/**
 * Audit log filter options
 */
interface AuditLogFilters {
  startDate?: string;
  endDate?: string;
  actions?: AuditAction[];
  actorId?: string;
  targetType?: string;
  targetId?: string;
  tenantId?: string;
}

/**
 * Deployment request
 */
interface DeploymentRequest {
  policyIds: string[];
  targetEnvironment: 'staging' | 'production';
  description?: string;
  requiresApproval: boolean;
}

/**
 * Deployment status
 */
interface Deployment {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'deployed' | 'failed' | 'rolled_back';
  policies: PolicySummary[];
  requestedBy: string;
  requestedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  deployedAt?: string;
  environment: string;
  rollbackId?: string;
}
```

### 4.2 API Client Interface

```typescript
/**
 * Policy Management API Client
 */
interface PolicyApiClient {
  /**
   * List all policies with optional filters
   */
  listPolicies(filters?: PolicyFilters, pagination?: Pagination): Promise<PaginatedResult<PolicySummary>>;

  /**
   * Get a single policy by ID
   */
  getPolicy(id: string): Promise<Policy>;

  /**
   * Create a new policy
   */
  createPolicy(policy: Policy): Promise<Policy>;

  /**
   * Update an existing policy
   */
  updatePolicy(id: string, policy: Policy): Promise<Policy>;

  /**
   * Delete a policy
   */
  deletePolicy(id: string): Promise<void>;

  /**
   * Validate a policy without saving
   */
  validatePolicy(policy: Policy): Promise<ValidationResult>;

  /**
   * Test a policy against a request
   */
  testPolicy(request: TestRequest, policyId?: string): Promise<TestResponse>;

  /**
   * List derived roles
   */
  listDerivedRoles(filters?: { search?: string }): Promise<DerivedRolesPolicy[]>;

  /**
   * Get derived roles by name
   */
  getDerivedRoles(name: string): Promise<DerivedRolesPolicy>;

  /**
   * Create derived roles
   */
  createDerivedRoles(policy: DerivedRolesPolicy): Promise<DerivedRolesPolicy>;

  /**
   * Update derived roles
   */
  updateDerivedRoles(name: string, policy: DerivedRolesPolicy): Promise<DerivedRolesPolicy>;

  /**
   * Delete derived roles
   */
  deleteDerivedRoles(name: string): Promise<void>;

  /**
   * List schemas
   */
  listSchemas(type?: 'principal' | 'resource'): Promise<Schema[]>;

  /**
   * Get schema by ID
   */
  getSchema(id: string): Promise<Schema>;

  /**
   * Create schema
   */
  createSchema(schema: Schema): Promise<Schema>;

  /**
   * Update schema
   */
  updateSchema(id: string, schema: Schema): Promise<Schema>;

  /**
   * Delete schema
   */
  deleteSchema(id: string): Promise<void>;

  /**
   * Request deployment
   */
  requestDeployment(request: DeploymentRequest): Promise<Deployment>;

  /**
   * Approve deployment
   */
  approveDeployment(id: string): Promise<Deployment>;

  /**
   * Reject deployment
   */
  rejectDeployment(id: string, reason: string): Promise<Deployment>;

  /**
   * Execute deployment
   */
  executeDeployment(id: string): Promise<Deployment>;

  /**
   * Rollback deployment
   */
  rollbackDeployment(id: string): Promise<Deployment>;

  /**
   * List deployments
   */
  listDeployments(filters?: DeploymentFilters): Promise<Deployment[]>;

  /**
   * Get audit logs
   */
  getAuditLogs(filters?: AuditLogFilters, pagination?: Pagination): Promise<PaginatedResult<AuditLogEntry>>;
}

/**
 * Pagination options
 */
interface Pagination {
  page: number;
  pageSize: number;
}

/**
 * Paginated result wrapper
 */
interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Validation result
 */
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * Validation warning
 */
interface ValidationWarning {
  path: string;
  message: string;
  code: string;
}

/**
 * Schema definition
 */
interface Schema {
  id: string;
  type: 'principal' | 'resource';
  name: string;
  schema: JSONSchema;
  createdAt: string;
  updatedAt: string;
}

/**
 * Deployment filters
 */
interface DeploymentFilters {
  status?: Deployment['status'][];
  environment?: string;
  requestedBy?: string;
  startDate?: string;
  endDate?: string;
}
```

---

## 5. UI Components

### 5.1 Policy Editor

The Policy Editor is the core component for creating and editing authorization policies.

```typescript
// components/policy-editor/PolicyEditor.tsx

import React, { useState, useCallback, useMemo } from 'react';
import { Editor } from '@monaco-editor/react';
import { Policy, ValidationError } from '@/types/policy';
import { useValidatePolicy } from '@/hooks/useValidatePolicy';
import { PolicyToolbar } from './PolicyToolbar';
import { ValidationPanel } from './ValidationPanel';
import { CELAutocomplete } from './CELAutocomplete';

interface PolicyEditorState {
  content: string;
  format: 'yaml' | 'json';
  isDirty: boolean;
  validationErrors: ValidationError[];
  isValidating: boolean;
}

export function PolicyEditor({
  policy,
  onSave,
  onCancel,
  readOnly = false,
  theme = 'dark',
  showValidation = true,
}: PolicyEditorProps): JSX.Element {
  const [state, setState] = useState<PolicyEditorState>(() => ({
    content: policy ? serializePolicy(policy, 'yaml') : DEFAULT_RESOURCE_POLICY_TEMPLATE,
    format: 'yaml',
    isDirty: false,
    validationErrors: [],
    isValidating: false,
  }));

  const { validateAsync, isValidating } = useValidatePolicy();

  const handleContentChange = useCallback((value: string | undefined) => {
    if (value === undefined) return;

    setState(prev => ({
      ...prev,
      content: value,
      isDirty: true,
    }));

    // Debounced validation
    validateAsync(value, state.format).then(result => {
      setState(prev => ({
        ...prev,
        validationErrors: result.errors,
      }));
    });
  }, [state.format, validateAsync]);

  const handleFormatChange = useCallback((format: 'yaml' | 'json') => {
    setState(prev => {
      const parsed = parsePolicy(prev.content, prev.format);
      if (!parsed) return prev;

      return {
        ...prev,
        content: serializePolicy(parsed, format),
        format,
      };
    });
  }, []);

  const handleSave = useCallback(async () => {
    const parsed = parsePolicy(state.content, state.format);
    if (!parsed) return;

    const validation = await validateAsync(state.content, state.format);
    if (!validation.valid) {
      setState(prev => ({ ...prev, validationErrors: validation.errors }));
      return;
    }

    await onSave(parsed);
    setState(prev => ({ ...prev, isDirty: false }));
  }, [state.content, state.format, validateAsync, onSave]);

  const editorOptions = useMemo(() => ({
    readOnly,
    minimap: { enabled: false },
    lineNumbers: 'on' as const,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    fontSize: 14,
    wordWrap: 'on' as const,
  }), [readOnly]);

  return (
    <div className="flex flex-col h-full">
      <PolicyToolbar
        format={state.format}
        onFormatChange={handleFormatChange}
        onSave={handleSave}
        onCancel={onCancel}
        isDirty={state.isDirty}
        isValidating={isValidating}
        hasErrors={state.validationErrors.length > 0}
        readOnly={readOnly}
      />

      <div className="flex-1 flex">
        <div className="flex-1">
          <Editor
            height="100%"
            language={state.format}
            value={state.content}
            onChange={handleContentChange}
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            options={editorOptions}
            beforeMount={(monaco) => {
              // Register CEL language support
              registerCELLanguage(monaco);
            }}
          />
        </div>

        {showValidation && state.validationErrors.length > 0 && (
          <ValidationPanel
            errors={state.validationErrors}
            onErrorClick={(error) => {
              // Jump to error line in editor
            }}
          />
        )}
      </div>
    </div>
  );
}

const DEFAULT_RESOURCE_POLICY_TEMPLATE = `apiVersion: api.cerbos.dev/v1
kind: ResourcePolicy
metadata:
  name: my-policy
spec:
  resource: my-resource
  version: "1.0"
  rules:
    - actions: ["view"]
      effect: EFFECT_ALLOW
      roles: ["*"]
`;
```

### 5.2 Policy List

```typescript
// components/policy-list/PolicyList.tsx

import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PolicyFilters, PolicySummary } from '@/types/policy';
import { policyApi } from '@/lib/api';

export function PolicyList({
  initialFilters,
  onSelectPolicy,
  multiSelect = false,
  showDeleted = false,
}: PolicyListProps): JSX.Element {
  const [filters, setFilters] = useState<PolicyFilters>(initialFilters ?? {});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['policies', filters],
    queryFn: () => policyApi.listPolicies(filters),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => policyApi.deletePolicy(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
    },
  });

  const handleSearch = useCallback((search: string) => {
    setFilters(prev => ({ ...prev, search }));
  }, []);

  const handleKindFilter = useCallback((kind: PolicyKind | null) => {
    setFilters(prev => ({
      ...prev,
      kind: kind ? [kind] : undefined,
    }));
  }, []);

  const handleSelect = useCallback((policy: PolicySummary) => {
    if (multiSelect) {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(policy.id)) {
          next.delete(policy.id);
        } else {
          next.add(policy.id);
        }
        return next;
      });
    } else {
      onSelectPolicy(policy);
    }
  }, [multiSelect, onSelectPolicy]);

  const getStatusBadge = (status: PolicyStatus) => {
    const variants: Record<PolicyStatus, string> = {
      draft: 'secondary',
      pending_review: 'warning',
      approved: 'success',
      deployed: 'default',
      deprecated: 'destructive',
      archived: 'outline',
    };
    return <Badge variant={variants[status]}>{status}</Badge>;
  };

  if (error) {
    return <div className="text-red-500">Error loading policies</div>;
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-4">
        <Input
          placeholder="Search policies..."
          value={filters.search ?? ''}
          onChange={(e) => handleSearch(e.target.value)}
          className="max-w-sm"
        />
        <select
          value={filters.kind?.[0] ?? ''}
          onChange={(e) => handleKindFilter(e.target.value as PolicyKind || null)}
          className="border rounded px-3 py-2"
        >
          <option value="">All Types</option>
          <option value="ResourcePolicy">Resource Policy</option>
          <option value="DerivedRoles">Derived Roles</option>
          <option value="PrincipalPolicy">Principal Policy</option>
        </select>
      </div>

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow>
            {multiSelect && <TableHead className="w-12" />}
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Resource</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="w-24">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center">
                Loading...
              </TableCell>
            </TableRow>
          ) : (
            data?.items.map((policy) => (
              <TableRow
                key={policy.id}
                className="cursor-pointer hover:bg-muted"
                onClick={() => handleSelect(policy)}
              >
                {multiSelect && (
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selected.has(policy.id)}
                      onChange={() => {}}
                    />
                  </TableCell>
                )}
                <TableCell className="font-medium">{policy.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">{policy.kind}</Badge>
                </TableCell>
                <TableCell>{policy.resource ?? '-'}</TableCell>
                <TableCell>{policy.version ?? '1.0'}</TableCell>
                <TableCell>{getStatusBadge(policy.status)}</TableCell>
                <TableCell>
                  {new Date(policy.updatedAt).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteMutation.mutate(policy.id);
                    }}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {/* Pagination */}
      {data && data.total > data.pageSize && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            disabled={data.page === 1}
            onClick={() => setFilters(prev => ({ ...prev, page: (prev.page ?? 1) - 1 }))}
          >
            Previous
          </Button>
          <span className="py-2 px-4">
            Page {data.page} of {Math.ceil(data.total / data.pageSize)}
          </span>
          <Button
            variant="outline"
            disabled={!data.hasMore}
            onClick={() => setFilters(prev => ({ ...prev, page: (prev.page ?? 1) + 1 }))}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
```

### 5.3 Derived Roles Editor

```typescript
// components/derived-roles-editor/DerivedRolesEditor.tsx

import React, { useState, useCallback } from 'react';
import { DerivedRolesPolicy, DerivedRoleDefinition, Condition } from '@/types/policy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CELExpressionInput } from '@/components/shared/CELExpressionInput';
import { RoleSelector } from '@/components/shared/RoleSelector';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';

export function DerivedRolesEditor({
  policy,
  onSave,
  onCancel,
  availableRoles = [],
}: DerivedRolesEditorProps): JSX.Element {
  const [definitions, setDefinitions] = useState<DerivedRoleDefinition[]>(
    policy?.spec.definitions ?? []
  );
  const [name, setName] = useState(policy?.spec.name ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleAddDefinition = useCallback(() => {
    setDefinitions(prev => [
      ...prev,
      {
        name: `new-role-${prev.length + 1}`,
        parentRoles: [],
      },
    ]);
  }, []);

  const handleRemoveDefinition = useCallback((index: number) => {
    setDefinitions(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleUpdateDefinition = useCallback(
    (index: number, updates: Partial<DerivedRoleDefinition>) => {
      setDefinitions(prev =>
        prev.map((def, i) => (i === index ? { ...def, ...updates } : def))
      );
    },
    []
  );

  const handleConditionChange = useCallback(
    (index: number, expr: string) => {
      handleUpdateDefinition(index, {
        condition: expr ? { match: { expr } } : undefined,
      });
    },
    [handleUpdateDefinition]
  );

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = 'Name is required';
    }

    definitions.forEach((def, index) => {
      if (!def.name.trim()) {
        newErrors[`def-${index}-name`] = 'Role name is required';
      }
      if (def.parentRoles.length === 0) {
        newErrors[`def-${index}-roles`] = 'At least one parent role is required';
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, definitions]);

  const handleSave = useCallback(async () => {
    if (!validate()) return;

    const policyDoc: DerivedRolesPolicy = {
      apiVersion: 'api.cerbos.dev/v1',
      kind: 'DerivedRoles',
      metadata: {
        name: name,
        ...(policy?.metadata ?? {}),
      },
      spec: {
        name: name,
        definitions: definitions,
      },
    };

    await onSave(policyDoc);
  }, [name, definitions, policy, validate, onSave]);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">
          {policy ? 'Edit Derived Roles' : 'Create Derived Roles'}
        </h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </div>

      {/* Name Input */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Derived Roles Name</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., common-roles"
          className={errors.name ? 'border-red-500' : ''}
        />
        {errors.name && <p className="text-sm text-red-500">{errors.name}</p>}
      </div>

      {/* Definitions */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium">Role Definitions</h3>
          <Button variant="outline" size="sm" onClick={handleAddDefinition}>
            <PlusIcon className="w-4 h-4 mr-2" />
            Add Role
          </Button>
        </div>

        {definitions.map((def, index) => (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between py-3">
              <CardTitle className="text-base">Role Definition #{index + 1}</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveDefinition(index)}
              >
                <TrashIcon className="w-4 h-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Role Name */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Role Name</label>
                <Input
                  value={def.name}
                  onChange={(e) =>
                    handleUpdateDefinition(index, { name: e.target.value })
                  }
                  placeholder="e.g., owner, team_member"
                  className={errors[`def-${index}-name`] ? 'border-red-500' : ''}
                />
                {errors[`def-${index}-name`] && (
                  <p className="text-sm text-red-500">{errors[`def-${index}-name`]}</p>
                )}
              </div>

              {/* Parent Roles */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Parent Roles</label>
                <RoleSelector
                  selected={def.parentRoles}
                  available={availableRoles}
                  onChange={(roles) =>
                    handleUpdateDefinition(index, { parentRoles: roles })
                  }
                />
                {errors[`def-${index}-roles`] && (
                  <p className="text-sm text-red-500">{errors[`def-${index}-roles`]}</p>
                )}
              </div>

              {/* Condition */}
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Condition (CEL Expression)
                </label>
                <CELExpressionInput
                  value={def.condition?.match.expr ?? ''}
                  onChange={(expr) => handleConditionChange(index, expr)}
                  placeholder='e.g., resource.ownerId == principal.id'
                />
                <p className="text-xs text-muted-foreground">
                  When this condition evaluates to true, the derived role is activated.
                </p>
              </div>
            </CardContent>
          </Card>
        ))}

        {definitions.length === 0 && (
          <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
            No role definitions yet. Click "Add Role" to create one.
          </div>
        )}
      </div>
    </div>
  );
}
```

### 5.4 Schema Editor

```typescript
// components/schema-editor/SchemaEditor.tsx

import React, { useState, useCallback } from 'react';
import { Editor } from '@monaco-editor/react';
import { JSONSchema } from '@/types/policy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SchemaVisualizer } from './SchemaVisualizer';
import { SchemaPropertyEditor } from './SchemaPropertyEditor';

export function SchemaEditor({
  schemaType,
  schema,
  onSave,
  validationMode = 'strict',
}: SchemaEditorProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<'visual' | 'code'>('visual');
  const [content, setContent] = useState<JSONSchema>(
    schema ?? getDefaultSchema(schemaType)
  );
  const [errors, setErrors] = useState<string[]>([]);

  const handleVisualChange = useCallback((updates: Partial<JSONSchema>) => {
    setContent(prev => ({ ...prev, ...updates }));
  }, []);

  const handleCodeChange = useCallback((value: string | undefined) => {
    if (!value) return;
    try {
      const parsed = JSON.parse(value);
      setContent(parsed);
      setErrors([]);
    } catch (e) {
      setErrors(['Invalid JSON']);
    }
  }, []);

  const handleAddProperty = useCallback((name: string, type: string) => {
    setContent(prev => ({
      ...prev,
      properties: {
        ...prev.properties,
        [name]: { type },
      },
    }));
  }, []);

  const handleRemoveProperty = useCallback((name: string) => {
    setContent(prev => {
      const { [name]: _, ...rest } = prev.properties ?? {};
      return {
        ...prev,
        properties: rest,
      };
    });
  }, []);

  const handleSave = useCallback(async () => {
    // Validate schema
    const validationErrors = validateSchema(content, validationMode);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    await onSave(content);
  }, [content, validationMode, onSave]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">
          {schemaType === 'principal' ? 'Principal Schema' : 'Resource Schema'}
        </h2>
        <Button onClick={handleSave}>Save Schema</Button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'visual' | 'code')}>
        <TabsList>
          <TabsTrigger value="visual">Visual Editor</TabsTrigger>
          <TabsTrigger value="code">Code Editor</TabsTrigger>
        </TabsList>

        <TabsContent value="visual" className="space-y-4">
          <SchemaVisualizer schema={content} />

          <div className="border rounded-lg p-4 space-y-4">
            <h3 className="font-medium">Properties</h3>

            {Object.entries(content.properties ?? {}).map(([name, prop]) => (
              <SchemaPropertyEditor
                key={name}
                name={name}
                property={prop as JSONSchema}
                onUpdate={(updates) => {
                  setContent(prev => ({
                    ...prev,
                    properties: {
                      ...prev.properties,
                      [name]: { ...prev.properties?.[name], ...updates },
                    },
                  }));
                }}
                onRemove={() => handleRemoveProperty(name)}
              />
            ))}

            <div className="flex gap-2">
              <Input placeholder="Property name" id="new-property-name" />
              <select id="new-property-type" className="border rounded px-3">
                <option value="string">String</option>
                <option value="number">Number</option>
                <option value="boolean">Boolean</option>
                <option value="array">Array</option>
                <option value="object">Object</option>
              </select>
              <Button
                variant="outline"
                onClick={() => {
                  const nameInput = document.getElementById('new-property-name') as HTMLInputElement;
                  const typeSelect = document.getElementById('new-property-type') as HTMLSelectElement;
                  if (nameInput.value) {
                    handleAddProperty(nameInput.value, typeSelect.value);
                    nameInput.value = '';
                  }
                }}
              >
                Add Property
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="code">
          <Editor
            height="500px"
            language="json"
            value={JSON.stringify(content, null, 2)}
            onChange={handleCodeChange}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              formatOnPaste: true,
              formatOnType: true,
            }}
          />
        </TabsContent>
      </Tabs>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded p-4">
          <h4 className="font-medium text-red-800">Validation Errors</h4>
          <ul className="list-disc list-inside text-red-700">
            {errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function getDefaultSchema(type: 'principal' | 'resource'): JSONSchema {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      id: { type: 'string' },
      ...(type === 'principal' ? { roles: { type: 'array', items: { type: 'string' } } } : {}),
      ...(type === 'resource' ? { kind: { type: 'string' } } : {}),
    },
    required: ['id'],
    additionalProperties: true,
  };
}

function validateSchema(schema: JSONSchema, mode: 'strict' | 'permissive'): string[] {
  const errors: string[] = [];

  if (!schema.type) {
    errors.push('Schema must have a type');
  }

  if (mode === 'strict' && schema.additionalProperties !== false) {
    errors.push('Strict mode requires additionalProperties: false');
  }

  return errors;
}
```

### 5.5 Test Console

```typescript
// components/test-console/TestConsole.tsx

import React, { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Editor } from '@monaco-editor/react';
import { TestRequest, TestResponse, Principal, Resource } from '@/types/policy';
import { policyApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PlayIcon } from '@heroicons/react/24/solid';

export function TestConsole({
  policy,
  samplePrincipals = [],
  sampleResources = [],
}: TestConsoleProps): JSX.Element {
  const [request, setRequest] = useState<TestRequest>({
    principal: { id: '', roles: [] },
    resource: { kind: '', id: '' },
    actions: [],
  });
  const [response, setResponse] = useState<TestResponse | null>(null);
  const [activeRequestTab, setActiveRequestTab] = useState<'principal' | 'resource' | 'actions'>('principal');

  const testMutation = useMutation({
    mutationFn: (req: TestRequest) => policyApi.testPolicy(req, policy?.metadata.name),
    onSuccess: (data) => setResponse(data),
  });

  const handleRunTest = useCallback(() => {
    testMutation.mutate(request);
  }, [request, testMutation]);

  const handlePrincipalChange = useCallback((value: string | undefined) => {
    if (!value) return;
    try {
      const principal = JSON.parse(value);
      setRequest(prev => ({ ...prev, principal }));
    } catch {
      // Invalid JSON, ignore
    }
  }, []);

  const handleResourceChange = useCallback((value: string | undefined) => {
    if (!value) return;
    try {
      const resource = JSON.parse(value);
      setRequest(prev => ({ ...prev, resource }));
    } catch {
      // Invalid JSON, ignore
    }
  }, []);

  const handleActionsChange = useCallback((actions: string[]) => {
    setRequest(prev => ({ ...prev, actions }));
  }, []);

  const getEffectBadge = (effect: string) => {
    return effect === 'EFFECT_ALLOW' ? (
      <Badge className="bg-green-500">ALLOW</Badge>
    ) : (
      <Badge className="bg-red-500">DENY</Badge>
    );
  };

  return (
    <div className="grid grid-cols-2 gap-6 h-full">
      {/* Request Panel */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold">Test Request</h2>
          <Button onClick={handleRunTest} disabled={testMutation.isPending}>
            <PlayIcon className="w-4 h-4 mr-2" />
            {testMutation.isPending ? 'Running...' : 'Run Test'}
          </Button>
        </div>

        <Tabs value={activeRequestTab} onValueChange={(v) => setActiveRequestTab(v as any)}>
          <TabsList className="w-full">
            <TabsTrigger value="principal" className="flex-1">Principal</TabsTrigger>
            <TabsTrigger value="resource" className="flex-1">Resource</TabsTrigger>
            <TabsTrigger value="actions" className="flex-1">Actions</TabsTrigger>
          </TabsList>

          <TabsContent value="principal" className="space-y-2">
            {samplePrincipals.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                <span className="text-sm text-muted-foreground">Quick select:</span>
                {samplePrincipals.map((p, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    onClick={() => setRequest(prev => ({ ...prev, principal: p }))}
                  >
                    {p.id}
                  </Button>
                ))}
              </div>
            )}
            <Editor
              height="300px"
              language="json"
              value={JSON.stringify(request.principal, null, 2)}
              onChange={handlePrincipalChange}
              theme="vs-dark"
              options={{ minimap: { enabled: false } }}
            />
          </TabsContent>

          <TabsContent value="resource" className="space-y-2">
            {sampleResources.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                <span className="text-sm text-muted-foreground">Quick select:</span>
                {sampleResources.map((r, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    onClick={() => setRequest(prev => ({ ...prev, resource: r }))}
                  >
                    {r.kind}:{r.id}
                  </Button>
                ))}
              </div>
            )}
            <Editor
              height="300px"
              language="json"
              value={JSON.stringify(request.resource, null, 2)}
              onChange={handleResourceChange}
              theme="vs-dark"
              options={{ minimap: { enabled: false } }}
            />
          </TabsContent>

          <TabsContent value="actions" className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Actions to Check</label>
              <div className="flex gap-2 flex-wrap">
                {['view', 'create', 'edit', 'delete', 'list', 'manage'].map((action) => (
                  <Button
                    key={action}
                    variant={request.actions.includes(action) ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      handleActionsChange(
                        request.actions.includes(action)
                          ? request.actions.filter((a) => a !== action)
                          : [...request.actions, action]
                      );
                    }}
                  >
                    {action}
                  </Button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Add custom action..."
                className="border rounded px-3 py-2 w-full"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.currentTarget.value) {
                    handleActionsChange([...request.actions, e.currentTarget.value]);
                    e.currentTarget.value = '';
                  }
                }}
              />
            </div>
            <div>
              <h4 className="text-sm font-medium mb-2">Selected Actions:</h4>
              <div className="flex gap-2 flex-wrap">
                {request.actions.map((action) => (
                  <Badge key={action} variant="secondary" className="cursor-pointer" onClick={() => {
                    handleActionsChange(request.actions.filter((a) => a !== action));
                  }}>
                    {action} x
                  </Badge>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Response Panel */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Test Response</h2>

        {!response && !testMutation.isPending && (
          <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
            Run a test to see results here
          </div>
        )}

        {testMutation.isPending && (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
            <p className="mt-2 text-muted-foreground">Evaluating policy...</p>
          </div>
        )}

        {response && (
          <div className="space-y-4">
            {/* Results Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Results</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {response.results.map((result) => (
                    <div
                      key={result.action}
                      className="flex justify-between items-center p-2 bg-muted rounded"
                    >
                      <span className="font-mono">{result.action}</span>
                      <div className="flex items-center gap-2">
                        {getEffectBadge(result.effect)}
                        {result.policy && (
                          <span className="text-xs text-muted-foreground">
                            via {result.policy}
                            {result.rule && ` / ${result.rule}`}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Derived Roles */}
            {response.effectiveDerivedRoles.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Effective Derived Roles</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2 flex-wrap">
                    {response.effectiveDerivedRoles.map((role) => (
                      <Badge key={role} variant="outline">
                        {role}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Validation Errors */}
            {response.validationErrors && response.validationErrors.length > 0 && (
              <Card className="border-red-200">
                <CardHeader>
                  <CardTitle className="text-red-700">Validation Errors</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="list-disc list-inside space-y-1 text-red-600">
                    {response.validationErrors.map((error, i) => (
                      <li key={i}>
                        <span className="font-mono">{error.path}</span>: {error.message}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Evaluation Trace */}
            {response.evaluationTrace && (
              <Card>
                <CardHeader>
                  <CardTitle>Evaluation Trace</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="text-xs overflow-auto max-h-64 bg-muted p-4 rounded">
                    {JSON.stringify(response.evaluationTrace, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## 6. API Integration

### 6.1 REST API Endpoints

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| GET | `/api/v1/policies` | List policies | Query params | `PaginatedResult<PolicySummary>` |
| GET | `/api/v1/policies/:id` | Get policy | - | `Policy` |
| POST | `/api/v1/policies` | Create policy | `Policy` | `Policy` |
| PUT | `/api/v1/policies/:id` | Update policy | `Policy` | `Policy` |
| DELETE | `/api/v1/policies/:id` | Delete policy | - | `void` |
| POST | `/api/v1/policies/validate` | Validate policy | `Policy` | `ValidationResult` |
| POST | `/api/v1/check` | Test authorization | `TestRequest` | `TestResponse` |
| GET | `/api/v1/derived-roles` | List derived roles | - | `DerivedRolesPolicy[]` |
| GET | `/api/v1/derived-roles/:name` | Get derived roles | - | `DerivedRolesPolicy` |
| POST | `/api/v1/derived-roles` | Create derived roles | `DerivedRolesPolicy` | `DerivedRolesPolicy` |
| PUT | `/api/v1/derived-roles/:name` | Update derived roles | `DerivedRolesPolicy` | `DerivedRolesPolicy` |
| DELETE | `/api/v1/derived-roles/:name` | Delete derived roles | - | `void` |
| GET | `/api/v1/schemas` | List schemas | - | `Schema[]` |
| GET | `/api/v1/schemas/:id` | Get schema | - | `Schema` |
| POST | `/api/v1/schemas` | Create schema | `Schema` | `Schema` |
| PUT | `/api/v1/schemas/:id` | Update schema | `Schema` | `Schema` |
| DELETE | `/api/v1/schemas/:id` | Delete schema | - | `void` |
| POST | `/api/v1/deployments` | Request deployment | `DeploymentRequest` | `Deployment` |
| POST | `/api/v1/deployments/:id/approve` | Approve deployment | - | `Deployment` |
| POST | `/api/v1/deployments/:id/reject` | Reject deployment | `{ reason: string }` | `Deployment` |
| POST | `/api/v1/deployments/:id/execute` | Execute deployment | - | `Deployment` |
| POST | `/api/v1/deployments/:id/rollback` | Rollback deployment | - | `Deployment` |
| GET | `/api/v1/deployments` | List deployments | Query params | `Deployment[]` |
| GET | `/api/v1/audit-logs` | Get audit logs | Query params | `PaginatedResult<AuditLogEntry>` |

### 6.2 API Client Implementation

```typescript
// lib/api/policy-api-client.ts

import { createApiClient } from './base-client';
import type {
  Policy,
  PolicySummary,
  PolicyFilters,
  DerivedRolesPolicy,
  Schema,
  TestRequest,
  TestResponse,
  ValidationResult,
  Deployment,
  DeploymentRequest,
  AuditLogEntry,
  AuditLogFilters,
  Pagination,
  PaginatedResult,
} from '@/types/policy';

const client = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

export const policyApi: PolicyApiClient = {
  // Policies
  async listPolicies(
    filters?: PolicyFilters,
    pagination?: Pagination
  ): Promise<PaginatedResult<PolicySummary>> {
    const params = new URLSearchParams();

    if (filters?.kind) params.append('kind', filters.kind.join(','));
    if (filters?.resource) params.append('resource', filters.resource);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.scope) params.append('scope', filters.scope);
    if (filters?.sortBy) params.append('sortBy', filters.sortBy);
    if (filters?.sortOrder) params.append('sortOrder', filters.sortOrder);
    if (pagination?.page) params.append('page', String(pagination.page));
    if (pagination?.pageSize) params.append('pageSize', String(pagination.pageSize));

    return client.get(`/policies?${params.toString()}`);
  },

  async getPolicy(id: string): Promise<Policy> {
    return client.get(`/policies/${encodeURIComponent(id)}`);
  },

  async createPolicy(policy: Policy): Promise<Policy> {
    return client.post('/policies', policy);
  },

  async updatePolicy(id: string, policy: Policy): Promise<Policy> {
    return client.put(`/policies/${encodeURIComponent(id)}`, policy);
  },

  async deletePolicy(id: string): Promise<void> {
    return client.delete(`/policies/${encodeURIComponent(id)}`);
  },

  async validatePolicy(policy: Policy): Promise<ValidationResult> {
    return client.post('/policies/validate', policy);
  },

  async testPolicy(request: TestRequest, policyId?: string): Promise<TestResponse> {
    const endpoint = policyId
      ? `/policies/${encodeURIComponent(policyId)}/test`
      : '/check';
    return client.post(endpoint, request);
  },

  // Derived Roles
  async listDerivedRoles(filters?: { search?: string }): Promise<DerivedRolesPolicy[]> {
    const params = new URLSearchParams();
    if (filters?.search) params.append('search', filters.search);
    return client.get(`/derived-roles?${params.toString()}`);
  },

  async getDerivedRoles(name: string): Promise<DerivedRolesPolicy> {
    return client.get(`/derived-roles/${encodeURIComponent(name)}`);
  },

  async createDerivedRoles(policy: DerivedRolesPolicy): Promise<DerivedRolesPolicy> {
    return client.post('/derived-roles', policy);
  },

  async updateDerivedRoles(name: string, policy: DerivedRolesPolicy): Promise<DerivedRolesPolicy> {
    return client.put(`/derived-roles/${encodeURIComponent(name)}`, policy);
  },

  async deleteDerivedRoles(name: string): Promise<void> {
    return client.delete(`/derived-roles/${encodeURIComponent(name)}`);
  },

  // Schemas
  async listSchemas(type?: 'principal' | 'resource'): Promise<Schema[]> {
    const params = type ? `?type=${type}` : '';
    return client.get(`/schemas${params}`);
  },

  async getSchema(id: string): Promise<Schema> {
    return client.get(`/schemas/${encodeURIComponent(id)}`);
  },

  async createSchema(schema: Schema): Promise<Schema> {
    return client.post('/schemas', schema);
  },

  async updateSchema(id: string, schema: Schema): Promise<Schema> {
    return client.put(`/schemas/${encodeURIComponent(id)}`, schema);
  },

  async deleteSchema(id: string): Promise<void> {
    return client.delete(`/schemas/${encodeURIComponent(id)}`);
  },

  // Deployments
  async requestDeployment(request: DeploymentRequest): Promise<Deployment> {
    return client.post('/deployments', request);
  },

  async approveDeployment(id: string): Promise<Deployment> {
    return client.post(`/deployments/${encodeURIComponent(id)}/approve`);
  },

  async rejectDeployment(id: string, reason: string): Promise<Deployment> {
    return client.post(`/deployments/${encodeURIComponent(id)}/reject`, { reason });
  },

  async executeDeployment(id: string): Promise<Deployment> {
    return client.post(`/deployments/${encodeURIComponent(id)}/execute`);
  },

  async rollbackDeployment(id: string): Promise<Deployment> {
    return client.post(`/deployments/${encodeURIComponent(id)}/rollback`);
  },

  async listDeployments(filters?: DeploymentFilters): Promise<Deployment[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status.join(','));
    if (filters?.environment) params.append('environment', filters.environment);
    if (filters?.requestedBy) params.append('requestedBy', filters.requestedBy);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    return client.get(`/deployments?${params.toString()}`);
  },

  // Audit Logs
  async getAuditLogs(
    filters?: AuditLogFilters,
    pagination?: Pagination
  ): Promise<PaginatedResult<AuditLogEntry>> {
    const params = new URLSearchParams();

    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.actions) params.append('actions', filters.actions.join(','));
    if (filters?.actorId) params.append('actorId', filters.actorId);
    if (filters?.targetType) params.append('targetType', filters.targetType);
    if (filters?.targetId) params.append('targetId', filters.targetId);
    if (filters?.tenantId) params.append('tenantId', filters.tenantId);
    if (pagination?.page) params.append('page', String(pagination.page));
    if (pagination?.pageSize) params.append('pageSize', String(pagination.pageSize));

    return client.get(`/audit-logs?${params.toString()}`);
  },
};
```

---

## 7. Security

### 7.1 Authentication

```typescript
// lib/auth/auth-config.ts

import NextAuth, { NextAuthOptions } from 'next-auth';
import { JWT } from 'next-auth/jwt';
import KeycloakProvider from 'next-auth/providers/keycloak';
import AzureADProvider from 'next-auth/providers/azure-ad';

export const authOptions: NextAuthOptions = {
  providers: [
    KeycloakProvider({
      clientId: process.env.KEYCLOAK_ID!,
      clientSecret: process.env.KEYCLOAK_SECRET!,
      issuer: process.env.KEYCLOAK_ISSUER!,
    }),
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID!,
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account && profile) {
        token.accessToken = account.access_token;
        token.roles = (profile as any).roles ?? [];
        token.tenantId = (profile as any).tenant_id;
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      session.user.roles = token.roles as string[];
      session.user.tenantId = token.tenantId as string;
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 60, // 30 minutes
  },
};
```

### 7.2 Role-Based Access Control

```typescript
// lib/auth/rbac.ts

/**
 * Admin UI permissions
 */
export const UIPermissions = {
  POLICY_VIEW: 'policy:view',
  POLICY_CREATE: 'policy:create',
  POLICY_EDIT: 'policy:edit',
  POLICY_DELETE: 'policy:delete',
  POLICY_DEPLOY: 'policy:deploy',
  POLICY_APPROVE: 'policy:approve',
  DERIVED_ROLES_VIEW: 'derived_roles:view',
  DERIVED_ROLES_MANAGE: 'derived_roles:manage',
  SCHEMA_VIEW: 'schema:view',
  SCHEMA_MANAGE: 'schema:manage',
  AUDIT_VIEW: 'audit:view',
  TENANT_MANAGE: 'tenant:manage',
  USER_MANAGE: 'user:manage',
} as const;

type UIPermission = typeof UIPermissions[keyof typeof UIPermissions];

/**
 * Role to permission mappings
 */
export const rolePermissions: Record<string, UIPermission[]> = {
  'policy-viewer': [
    UIPermissions.POLICY_VIEW,
    UIPermissions.DERIVED_ROLES_VIEW,
    UIPermissions.SCHEMA_VIEW,
  ],
  'policy-editor': [
    UIPermissions.POLICY_VIEW,
    UIPermissions.POLICY_CREATE,
    UIPermissions.POLICY_EDIT,
    UIPermissions.DERIVED_ROLES_VIEW,
    UIPermissions.DERIVED_ROLES_MANAGE,
    UIPermissions.SCHEMA_VIEW,
    UIPermissions.SCHEMA_MANAGE,
  ],
  'policy-deployer': [
    UIPermissions.POLICY_VIEW,
    UIPermissions.POLICY_CREATE,
    UIPermissions.POLICY_EDIT,
    UIPermissions.POLICY_DEPLOY,
    UIPermissions.DERIVED_ROLES_VIEW,
    UIPermissions.DERIVED_ROLES_MANAGE,
    UIPermissions.SCHEMA_VIEW,
    UIPermissions.SCHEMA_MANAGE,
    UIPermissions.AUDIT_VIEW,
  ],
  'policy-approver': [
    UIPermissions.POLICY_VIEW,
    UIPermissions.POLICY_APPROVE,
    UIPermissions.AUDIT_VIEW,
  ],
  'policy-admin': Object.values(UIPermissions),
  'super-admin': Object.values(UIPermissions),
};

/**
 * Check if user has permission
 */
export function hasPermission(userRoles: string[], permission: UIPermission): boolean {
  for (const role of userRoles) {
    const permissions = rolePermissions[role];
    if (permissions?.includes(permission)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if user has any of the permissions
 */
export function hasAnyPermission(userRoles: string[], permissions: UIPermission[]): boolean {
  return permissions.some(p => hasPermission(userRoles, p));
}

/**
 * Check if user has all permissions
 */
export function hasAllPermissions(userRoles: string[], permissions: UIPermission[]): boolean {
  return permissions.every(p => hasPermission(userRoles, p));
}

/**
 * React hook for checking permissions
 */
export function usePermission(permission: UIPermission): boolean {
  const { data: session } = useSession();
  return hasPermission(session?.user?.roles ?? [], permission);
}
```

### 7.3 Audit Logging

```typescript
// lib/audit/audit-logger.ts

import { AuditAction, AuditLogEntry } from '@/types/policy';

interface AuditContext {
  actor: {
    id: string;
    email?: string;
    roles: string[];
  };
  tenantId?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

interface AuditLogPayload {
  action: AuditAction;
  target: {
    type: string;
    id: string;
    name?: string;
  };
  changes?: {
    before?: unknown;
    after?: unknown;
  };
  metadata?: Record<string, unknown>;
}

class AuditLogger {
  private endpoint: string;

  constructor() {
    this.endpoint = process.env.AUDIT_LOG_ENDPOINT ?? '/api/v1/audit-logs';
  }

  async log(context: AuditContext, payload: AuditLogPayload): Promise<void> {
    const entry: Omit<AuditLogEntry, 'id'> = {
      timestamp: new Date().toISOString(),
      action: payload.action,
      actor: context.actor,
      target: payload.target,
      changes: payload.changes,
      metadata: {
        ...payload.metadata,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      tenantId: context.tenantId,
    };

    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
    } catch (error) {
      console.error('Failed to write audit log:', error);
      // Fail silently but log locally
    }
  }

  // Convenience methods
  policyCreated(context: AuditContext, policy: Policy): Promise<void> {
    return this.log(context, {
      action: 'policy.create',
      target: {
        type: 'policy',
        id: policy.metadata.name,
        name: policy.metadata.name,
      },
      changes: { after: policy },
    });
  }

  policyUpdated(context: AuditContext, before: Policy, after: Policy): Promise<void> {
    return this.log(context, {
      action: 'policy.update',
      target: {
        type: 'policy',
        id: after.metadata.name,
        name: after.metadata.name,
      },
      changes: { before, after },
    });
  }

  policyDeleted(context: AuditContext, policy: Policy): Promise<void> {
    return this.log(context, {
      action: 'policy.delete',
      target: {
        type: 'policy',
        id: policy.metadata.name,
        name: policy.metadata.name,
      },
      changes: { before: policy },
    });
  }

  policyDeployed(context: AuditContext, deployment: Deployment): Promise<void> {
    return this.log(context, {
      action: 'policy.deploy',
      target: {
        type: 'deployment',
        id: deployment.id,
      },
      metadata: {
        environment: deployment.environment,
        policyCount: deployment.policies.length,
      },
    });
  }
}

export const auditLogger = new AuditLogger();
```

---

## 8. Performance

### 8.1 Lazy Loading

```typescript
// app/policies/[id]/page.tsx

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { PolicyEditorSkeleton } from '@/components/skeletons';

// Lazy load Monaco Editor (large bundle)
const PolicyEditor = dynamic(
  () => import('@/components/policy-editor/PolicyEditor'),
  {
    loading: () => <PolicyEditorSkeleton />,
    ssr: false, // Monaco doesn't support SSR
  }
);

export default function PolicyPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<PolicyEditorSkeleton />}>
      <PolicyEditorContainer id={params.id} />
    </Suspense>
  );
}
```

### 8.2 Caching Strategy

```typescript
// lib/cache/query-cache-config.ts

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Policies are relatively static, cache for 5 minutes
      staleTime: 5 * 60 * 1000,
      // Keep in cache for 30 minutes
      gcTime: 30 * 60 * 1000,
      // Refetch on window focus for freshness
      refetchOnWindowFocus: true,
      // Retry failed requests 3 times
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      // Optimistic updates handled per-mutation
      retry: 1,
    },
  },
});

// Cache keys for invalidation
export const cacheKeys = {
  policies: ['policies'] as const,
  policy: (id: string) => ['policies', id] as const,
  derivedRoles: ['derived-roles'] as const,
  derivedRole: (name: string) => ['derived-roles', name] as const,
  schemas: ['schemas'] as const,
  schema: (id: string) => ['schemas', id] as const,
  deployments: ['deployments'] as const,
  auditLogs: ['audit-logs'] as const,
};
```

### 8.3 Optimistic Updates

```typescript
// hooks/usePolicyMutations.ts

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { policyApi } from '@/lib/api';
import { cacheKeys } from '@/lib/cache/query-cache-config';
import type { Policy, PolicySummary } from '@/types/policy';

export function useUpdatePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, policy }: { id: string; policy: Policy }) =>
      policyApi.updatePolicy(id, policy),

    // Optimistic update
    onMutate: async ({ id, policy }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: cacheKeys.policy(id) });
      await queryClient.cancelQueries({ queryKey: cacheKeys.policies });

      // Snapshot previous values
      const previousPolicy = queryClient.getQueryData<Policy>(cacheKeys.policy(id));
      const previousPolicies = queryClient.getQueryData<PaginatedResult<PolicySummary>>(
        cacheKeys.policies
      );

      // Optimistically update
      queryClient.setQueryData(cacheKeys.policy(id), policy);

      if (previousPolicies) {
        queryClient.setQueryData(cacheKeys.policies, {
          ...previousPolicies,
          items: previousPolicies.items.map((p) =>
            p.id === id
              ? {
                  ...p,
                  name: policy.metadata.name,
                  updatedAt: new Date().toISOString(),
                }
              : p
          ),
        });
      }

      return { previousPolicy, previousPolicies };
    },

    // Rollback on error
    onError: (err, { id }, context) => {
      if (context?.previousPolicy) {
        queryClient.setQueryData(cacheKeys.policy(id), context.previousPolicy);
      }
      if (context?.previousPolicies) {
        queryClient.setQueryData(cacheKeys.policies, context.previousPolicies);
      }
    },

    // Refetch after success
    onSettled: (data, error, { id }) => {
      queryClient.invalidateQueries({ queryKey: cacheKeys.policy(id) });
      queryClient.invalidateQueries({ queryKey: cacheKeys.policies });
    },
  });
}
```

---

## 9. Testing Strategy

### 9.1 Unit Tests

```typescript
// __tests__/components/policy-editor.test.tsx

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PolicyEditor } from '@/components/policy-editor/PolicyEditor';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/cache/query-cache-config';

// Mock Monaco Editor
jest.mock('@monaco-editor/react', () => ({
  Editor: ({ value, onChange }: any) => (
    <textarea
      data-testid="monaco-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

describe('PolicyEditor', () => {
  const mockOnSave = jest.fn();
  const mockOnCancel = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders default template for new policy', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PolicyEditor onSave={mockOnSave} onCancel={mockOnCancel} />
      </QueryClientProvider>
    );

    expect(screen.getByTestId('monaco-editor')).toHaveValue(
      expect.stringContaining('apiVersion: api.cerbos.dev/v1')
    );
  });

  it('loads existing policy for editing', () => {
    const policy = {
      apiVersion: 'api.cerbos.dev/v1',
      kind: 'ResourcePolicy',
      metadata: { name: 'test-policy' },
      spec: {
        resource: 'document',
        version: '1.0',
        rules: [],
      },
    };

    render(
      <QueryClientProvider client={queryClient}>
        <PolicyEditor policy={policy} onSave={mockOnSave} onCancel={mockOnCancel} />
      </QueryClientProvider>
    );

    expect(screen.getByTestId('monaco-editor')).toHaveValue(
      expect.stringContaining('test-policy')
    );
  });

  it('validates policy before saving', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PolicyEditor onSave={mockOnSave} onCancel={mockOnCancel} />
      </QueryClientProvider>
    );

    const editor = screen.getByTestId('monaco-editor');
    await userEvent.clear(editor);
    await userEvent.type(editor, 'invalid yaml: {{');

    const saveButton = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockOnSave).not.toHaveBeenCalled();
    });
  });

  it('calls onSave with valid policy', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PolicyEditor onSave={mockOnSave} onCancel={mockOnCancel} />
      </QueryClientProvider>
    );

    const saveButton = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          apiVersion: 'api.cerbos.dev/v1',
          kind: 'ResourcePolicy',
        })
      );
    });
  });

  it('calls onCancel when cancel button clicked', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PolicyEditor onSave={mockOnSave} onCancel={mockOnCancel} />
      </QueryClientProvider>
    );

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);

    expect(mockOnCancel).toHaveBeenCalled();
  });
});
```

### 9.2 Integration Tests

```typescript
// __tests__/integration/policy-crud.test.ts

import { createTestClient } from '@/lib/test-utils';
import { policyApi } from '@/lib/api';

describe('Policy CRUD Integration', () => {
  const testClient = createTestClient();

  beforeEach(async () => {
    // Clean up test data
    await testClient.cleanup();
  });

  it('creates a new resource policy', async () => {
    const policy = {
      apiVersion: 'api.cerbos.dev/v1',
      kind: 'ResourcePolicy',
      metadata: { name: 'integration-test-policy' },
      spec: {
        resource: 'test-resource',
        version: '1.0',
        rules: [
          {
            actions: ['view'],
            effect: 'EFFECT_ALLOW',
            roles: ['*'],
          },
        ],
      },
    };

    const created = await policyApi.createPolicy(policy);

    expect(created.metadata.name).toBe('integration-test-policy');
    expect(created.spec.resource).toBe('test-resource');
  });

  it('updates an existing policy', async () => {
    // Create policy
    const policy = await policyApi.createPolicy({
      apiVersion: 'api.cerbos.dev/v1',
      kind: 'ResourcePolicy',
      metadata: { name: 'update-test-policy' },
      spec: {
        resource: 'test-resource',
        version: '1.0',
        rules: [],
      },
    });

    // Update policy
    const updated = await policyApi.updatePolicy(policy.metadata.name, {
      ...policy,
      spec: {
        ...policy.spec,
        rules: [
          {
            actions: ['view'],
            effect: 'EFFECT_ALLOW',
            roles: ['admin'],
          },
        ],
      },
    });

    expect(updated.spec.rules).toHaveLength(1);
    expect(updated.spec.rules[0].roles).toContain('admin');
  });

  it('deletes a policy', async () => {
    // Create policy
    const policy = await policyApi.createPolicy({
      apiVersion: 'api.cerbos.dev/v1',
      kind: 'ResourcePolicy',
      metadata: { name: 'delete-test-policy' },
      spec: {
        resource: 'test-resource',
        version: '1.0',
        rules: [],
      },
    });

    // Delete policy
    await policyApi.deletePolicy(policy.metadata.name);

    // Verify deletion
    await expect(policyApi.getPolicy(policy.metadata.name)).rejects.toThrow();
  });

  it('tests policy against a request', async () => {
    // Create policy
    await policyApi.createPolicy({
      apiVersion: 'api.cerbos.dev/v1',
      kind: 'ResourcePolicy',
      metadata: { name: 'test-check-policy' },
      spec: {
        resource: 'document',
        version: '1.0',
        rules: [
          {
            actions: ['view'],
            effect: 'EFFECT_ALLOW',
            roles: ['viewer'],
          },
        ],
      },
    });

    // Test policy
    const response = await policyApi.testPolicy({
      principal: { id: 'user-1', roles: ['viewer'] },
      resource: { kind: 'document', id: 'doc-1' },
      actions: ['view', 'edit'],
    });

    expect(response.results).toHaveLength(2);
    expect(response.results.find(r => r.action === 'view')?.effect).toBe('EFFECT_ALLOW');
    expect(response.results.find(r => r.action === 'edit')?.effect).toBe('EFFECT_DENY');
  });
});
```

### 9.3 E2E Tests with Playwright

```typescript
// e2e/policy-management.spec.ts

import { test, expect } from '@playwright/test';

test.describe('Policy Management UI', () => {
  test.beforeEach(async ({ page }) => {
    // Login
    await page.goto('/auth/signin');
    await page.fill('[name="email"]', 'admin@example.com');
    await page.fill('[name="password"]', 'test-password');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/dashboard');
  });

  test('displays policy list', async ({ page }) => {
    await page.goto('/policies');

    await expect(page.locator('h1')).toContainText('Policies');
    await expect(page.locator('table')).toBeVisible();
  });

  test('creates a new resource policy', async ({ page }) => {
    await page.goto('/policies');
    await page.click('text=Create Policy');

    // Fill out policy editor
    await page.fill('[data-testid="policy-name"]', 'e2e-test-policy');

    // Monaco editor interaction
    const editor = page.locator('.monaco-editor');
    await editor.click();
    await page.keyboard.type(`
apiVersion: api.cerbos.dev/v1
kind: ResourcePolicy
metadata:
  name: e2e-test-policy
spec:
  resource: test-resource
  version: "1.0"
  rules:
    - actions: ["view"]
      effect: EFFECT_ALLOW
      roles: ["*"]
`);

    await page.click('text=Save');
    await expect(page.locator('.toast-success')).toContainText('Policy created');
  });

  test('edits an existing policy', async ({ page }) => {
    await page.goto('/policies');

    // Click on a policy row
    await page.click('text=e2e-test-policy');

    // Wait for editor to load
    await expect(page.locator('.monaco-editor')).toBeVisible();

    // Make changes
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n    - actions: ["edit"]\n      effect: EFFECT_ALLOW\n      roles: ["admin"]');

    await page.click('text=Save');
    await expect(page.locator('.toast-success')).toContainText('Policy updated');
  });

  test('tests a policy in the test console', async ({ page }) => {
    await page.goto('/policies/test');

    // Fill principal
    await page.click('text=Principal');
    const principalEditor = page.locator('[data-testid="principal-editor"]');
    await principalEditor.fill(JSON.stringify({
      id: 'user-1',
      roles: ['viewer'],
    }));

    // Fill resource
    await page.click('text=Resource');
    const resourceEditor = page.locator('[data-testid="resource-editor"]');
    await resourceEditor.fill(JSON.stringify({
      kind: 'document',
      id: 'doc-1',
    }));

    // Select actions
    await page.click('text=Actions');
    await page.click('text=view');
    await page.click('text=edit');

    // Run test
    await page.click('text=Run Test');

    // Check results
    await expect(page.locator('[data-testid="result-view"]')).toContainText('ALLOW');
    await expect(page.locator('[data-testid="result-edit"]')).toContainText('DENY');
  });

  test('deploys policies to staging', async ({ page }) => {
    await page.goto('/policies');

    // Select policies
    await page.click('[data-testid="select-policy-1"]');
    await page.click('[data-testid="select-policy-2"]');

    // Request deployment
    await page.click('text=Deploy Selected');
    await page.selectOption('[name="environment"]', 'staging');
    await page.fill('[name="description"]', 'E2E test deployment');
    await page.click('text=Request Deployment');

    await expect(page.locator('.toast-success')).toContainText('Deployment requested');
  });

  test('views audit logs', async ({ page }) => {
    await page.goto('/audit-logs');

    // Verify table is visible
    await expect(page.locator('table')).toBeVisible();

    // Filter by action
    await page.selectOption('[name="action"]', 'policy.create');
    await page.click('text=Apply Filters');

    // Verify filtered results
    await expect(page.locator('tbody tr')).toHaveCount.greaterThan(0);
  });

  test('handles multi-tenant context switching', async ({ page }) => {
    await page.goto('/dashboard');

    // Open tenant selector
    await page.click('[data-testid="tenant-selector"]');

    // Switch tenant
    await page.click('text=Tenant B');

    // Verify context switched
    await expect(page.locator('[data-testid="current-tenant"]')).toContainText('Tenant B');

    // Verify policies are filtered
    await page.goto('/policies');
    await expect(page.locator('tbody tr')).toHaveCount.greaterThan(0);
  });
});
```

### 9.4 Test Coverage Targets

| Component | Coverage Target | Test File |
|-----------|-----------------|-----------|
| PolicyEditor | 90% | `__tests__/components/policy-editor.test.tsx` |
| PolicyList | 85% | `__tests__/components/policy-list.test.tsx` |
| DerivedRolesEditor | 90% | `__tests__/components/derived-roles-editor.test.tsx` |
| SchemaEditor | 85% | `__tests__/components/schema-editor.test.tsx` |
| TestConsole | 90% | `__tests__/components/test-console.test.tsx` |
| API Client | 95% | `__tests__/lib/api-client.test.ts` |
| RBAC Utils | 100% | `__tests__/lib/rbac.test.ts` |
| Audit Logger | 90% | `__tests__/lib/audit-logger.test.ts` |

---

## 10. Technology Stack

### 10.1 Core Technologies

| Category | Technology | Version | Purpose |
|----------|------------|---------|---------|
| Framework | Next.js | 14.x | React framework with App Router |
| Language | TypeScript | 5.x | Type-safe development |
| UI Library | React | 18.x | Component rendering |
| Styling | TailwindCSS | 3.x | Utility-first CSS |
| Components | Radix UI | Latest | Accessible primitives |
| Icons | Heroicons | 2.x | Icon library |
| Editor | Monaco Editor | 0.45.x | Code editing with CEL support |
| Data Fetching | TanStack Query | 5.x | Server state management |
| Forms | React Hook Form | 7.x | Form state management |
| Validation | Zod | 3.x | Schema validation |
| Auth | NextAuth.js | 4.x | Authentication |

### 10.2 Development Tools

| Tool | Version | Purpose |
|------|---------|---------|
| pnpm | 8.x | Package management |
| ESLint | 8.x | Code linting |
| Prettier | 3.x | Code formatting |
| Vitest | 1.x | Unit testing |
| Playwright | 1.x | E2E testing |
| Storybook | 7.x | Component development |

### 10.3 Package.json Configuration

```json
{
  "name": "@authz-engine/ui",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest",
    "test:e2e": "playwright test",
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build"
  },
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@monaco-editor/react": "^4.6.0",
    "@tanstack/react-query": "^5.0.0",
    "@radix-ui/react-dialog": "^1.0.0",
    "@radix-ui/react-dropdown-menu": "^2.0.0",
    "@radix-ui/react-tabs": "^1.0.0",
    "@radix-ui/react-toast": "^1.0.0",
    "@heroicons/react": "^2.0.0",
    "next-auth": "^4.24.0",
    "react-hook-form": "^7.48.0",
    "zod": "^3.22.0",
    "@hookform/resolvers": "^3.3.0",
    "yaml": "^2.3.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.0.0",
    "tailwind-merge": "^2.0.0"
  },
  "devDependencies": {
    "typescript": "^5.2.0",
    "@types/node": "^20.9.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "tailwindcss": "^3.3.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "eslint": "^8.53.0",
    "eslint-config-next": "^14.0.0",
    "prettier": "^3.1.0",
    "vitest": "^1.0.0",
    "@testing-library/react": "^14.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@playwright/test": "^1.39.0",
    "@storybook/react": "^7.5.0",
    "@storybook/nextjs": "^7.5.0"
  }
}
```

---

## 11. Related Documents

| Document | Description |
|----------|-------------|
| [CORE-ARCHITECTURE-SDD.md](./CORE-ARCHITECTURE-SDD.md) | Core system architecture |
| [SERVER-PACKAGE-SDD.md](./SERVER-PACKAGE-SDD.md) | Server API implementation |
| [POLICY-TESTING-SDD.md](./POLICY-TESTING-SDD.md) | Policy testing framework |
| [DERIVED-ROLES-SDD.md](./DERIVED-ROLES-SDD.md) | Derived roles specification |
| [SCHEMA-VALIDATION-SDD.md](./SCHEMA-VALIDATION-SDD.md) | Schema validation |
| [MULTI-TENANCY-SDD.md](./MULTI-TENANCY-SDD.md) | Multi-tenant support |
| [OBSERVABILITY-SDD.md](./OBSERVABILITY-SDD.md) | Metrics and logging |
| [COMPLIANCE-SECURITY-SDD.md](./COMPLIANCE-SECURITY-SDD.md) | Security requirements |

---

## 12. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-11-23 | Initial specification |

---

## Appendix A: File Structure

```
packages/ui/
├── app/
│   ├── (auth)/
│   │   ├── signin/
│   │   │   └── page.tsx
│   │   └── layout.tsx
│   ├── (dashboard)/
│   │   ├── dashboard/
│   │   │   └── page.tsx
│   │   ├── policies/
│   │   │   ├── [id]/
│   │   │   │   └── page.tsx
│   │   │   ├── new/
│   │   │   │   └── page.tsx
│   │   │   └── page.tsx
│   │   ├── derived-roles/
│   │   │   ├── [name]/
│   │   │   │   └── page.tsx
│   │   │   └── page.tsx
│   │   ├── schemas/
│   │   │   └── page.tsx
│   │   ├── test/
│   │   │   └── page.tsx
│   │   ├── deployments/
│   │   │   └── page.tsx
│   │   ├── audit-logs/
│   │   │   └── page.tsx
│   │   ├── settings/
│   │   │   └── page.tsx
│   │   └── layout.tsx
│   ├── api/
│   │   └── auth/
│   │       └── [...nextauth]/
│   │           └── route.ts
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── policy-editor/
│   │   ├── PolicyEditor.tsx
│   │   ├── PolicyToolbar.tsx
│   │   ├── ValidationPanel.tsx
│   │   ├── CELAutocomplete.tsx
│   │   └── index.ts
│   ├── policy-list/
│   │   ├── PolicyList.tsx
│   │   ├── PolicyFilters.tsx
│   │   └── index.ts
│   ├── derived-roles-editor/
│   │   ├── DerivedRolesEditor.tsx
│   │   ├── RoleDefinitionCard.tsx
│   │   └── index.ts
│   ├── schema-editor/
│   │   ├── SchemaEditor.tsx
│   │   ├── SchemaVisualizer.tsx
│   │   ├── SchemaPropertyEditor.tsx
│   │   └── index.ts
│   ├── test-console/
│   │   ├── TestConsole.tsx
│   │   ├── RequestBuilder.tsx
│   │   ├── ResponseViewer.tsx
│   │   └── index.ts
│   ├── deployment-manager/
│   │   ├── DeploymentList.tsx
│   │   ├── DeploymentDialog.tsx
│   │   └── index.ts
│   ├── audit-viewer/
│   │   ├── AuditLogTable.tsx
│   │   ├── AuditLogFilters.tsx
│   │   └── index.ts
│   ├── shared/
│   │   ├── CELExpressionInput.tsx
│   │   ├── RoleSelector.tsx
│   │   ├── TenantSelector.tsx
│   │   └── index.ts
│   ├── ui/
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── input.tsx
│   │   ├── table.tsx
│   │   ├── tabs.tsx
│   │   ├── toast.tsx
│   │   └── index.ts
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   ├── Navigation.tsx
│   │   └── index.ts
│   └── skeletons/
│       ├── PolicyEditorSkeleton.tsx
│       ├── TableSkeleton.tsx
│       └── index.ts
├── hooks/
│   ├── useValidatePolicy.ts
│   ├── usePolicyMutations.ts
│   ├── usePermission.ts
│   └── index.ts
├── lib/
│   ├── api/
│   │   ├── base-client.ts
│   │   ├── policy-api-client.ts
│   │   └── index.ts
│   ├── auth/
│   │   ├── auth-config.ts
│   │   ├── rbac.ts
│   │   └── index.ts
│   ├── audit/
│   │   ├── audit-logger.ts
│   │   └── index.ts
│   ├── cache/
│   │   ├── query-cache-config.ts
│   │   └── index.ts
│   ├── monaco/
│   │   ├── cel-language.ts
│   │   └── index.ts
│   └── utils/
│       ├── policy-serializer.ts
│       ├── policy-validator.ts
│       └── index.ts
├── types/
│   ├── policy.ts
│   ├── auth.ts
│   └── index.ts
├── __tests__/
│   ├── components/
│   ├── hooks/
│   ├── lib/
│   └── integration/
├── e2e/
│   ├── policy-management.spec.ts
│   ├── deployment-workflow.spec.ts
│   └── auth.spec.ts
├── .storybook/
│   └── main.ts
├── tailwind.config.ts
├── next.config.js
├── tsconfig.json
└── package.json
```

---

*This document provides a comprehensive specification for the Policy Management UI, enabling administrators to effectively manage authorization policies within the AuthZ Engine ecosystem.*
