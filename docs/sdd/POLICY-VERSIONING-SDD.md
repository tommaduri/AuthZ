# Policy Versioning - Software Design Document

**Module**: `@authz-engine/core` (versioning subsystem)
**Version**: 1.0.0
**Status**: Draft
**Author**: AuthZ Engine Team
**Created**: 2024-11-23
**Last Updated**: 2024-11-23
**Reviewers**: TBD

---

## 1. Overview

### 1.1 Purpose

Policy versioning provides a comprehensive version control system for authorization policies, enabling organizations to track changes, audit modifications, rollback to previous versions, and safely promote policies through deployment stages (draft, staging, production). This system implements Git-like semantics with semantic versioning, branch management, and merge capabilities tailored for policy lifecycle management.

### 1.2 Scope

**In Scope:**
- Semantic versioning for all policy types (resource, derived roles, principal, export variables)
- Git-like commit history with metadata (author, timestamp, message)
- Branch support (draft, staging, production) with promotion workflows
- Version diffing and comparison tools
- Rollback capabilities with safety checks
- Conflict detection and merge strategies
- Complete audit trail integration
- Migration path from unversioned policies
- REST and gRPC APIs for version management

**Out of Scope:**
- Visual diff UI (delegated to client applications)
- Git repository synchronization (covered in STORAGE-DRIVERS-SDD.md)
- Policy authoring/editing capabilities
- External version control integration (GitHub, GitLab)
- Multi-cluster policy synchronization

### 1.3 Context

Policy versioning sits between the PolicyLoader and the storage layer, intercepting all policy mutations to create version records. It integrates with the audit system to provide complete traceability of policy changes.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Policy Versioning System                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    PolicyVersionManager                           │   │
│  │  - Version creation & management                                  │   │
│  │  - Branch operations (create, merge, promote)                     │   │
│  │  - Diff generation & conflict detection                           │   │
│  └──────────────────────────┬───────────────────────────────────────┘   │
│                              │                                           │
│           ┌──────────────────┼──────────────────┐                       │
│           │                  │                  │                       │
│           ▼                  ▼                  ▼                       │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐            │
│  │  VersionStore  │  │  BranchManager │  │  DiffEngine    │            │
│  │                │  │                │  │                │            │
│  │ - Commit log   │  │ - Branch CRUD  │  │ - JSON diff    │            │
│  │ - Version tree │  │ - HEAD tracking│  │ - Semantic diff│            │
│  │ - Tagging      │  │ - Merge logic  │  │ - Conflict ID  │            │
│  └────────────────┘  └────────────────┘  └────────────────┘            │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    PromotionWorkflow                              │   │
│  │  - Draft → Staging → Production pipeline                          │   │
│  │  - Approval gates & validation                                    │   │
│  │  - Automatic rollback on failure                                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.4 Key Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Semantic versioning (MAJOR.MINOR.PATCH) | Industry standard, clear breaking change indication | Sequential integers, timestamps, UUIDs |
| Git-like commit model | Familiar to developers, proven branching model | Event sourcing, linear versioning |
| Three-stage branches (draft/staging/production) | Balances safety with simplicity | Two-stage, unlimited custom branches |
| JSON Patch (RFC 6902) for diffs | Standard format, reversible operations | Custom diff format, full snapshots |
| Soft deletes for version history | Compliance requirements, audit trail preservation | Hard deletes with archive |

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-001 | Create new policy version with semantic version number | Must Have | Planned |
| FR-002 | List all versions of a policy with metadata | Must Have | Planned |
| FR-003 | Retrieve specific policy version by version number | Must Have | Planned |
| FR-004 | Generate diff between any two versions | Must Have | Planned |
| FR-005 | Rollback policy to any previous version | Must Have | Planned |
| FR-006 | Create and manage branches (draft, staging, production) | Must Have | Planned |
| FR-007 | Promote policy version between branches | Must Have | Planned |
| FR-008 | Detect and report merge conflicts | Must Have | Planned |
| FR-009 | Tag versions with human-readable labels | Should Have | Planned |
| FR-010 | Compare policies across branches | Should Have | Planned |
| FR-011 | Batch version operations (multiple policies) | Should Have | Planned |
| FR-012 | Version history search and filtering | Should Have | Planned |
| FR-013 | Automatic version increment suggestions | Could Have | Planned |
| FR-014 | Version locking for concurrent edit prevention | Could Have | Planned |

### 2.2 Non-Functional Requirements

| ID | Category | Requirement | Target |
|----|----------|-------------|--------|
| NFR-001 | Performance | Version creation latency | < 50ms p99 |
| NFR-002 | Performance | Version list retrieval (100 versions) | < 100ms p99 |
| NFR-003 | Performance | Diff generation | < 200ms for 10KB policy |
| NFR-004 | Storage | Version metadata overhead | < 5% of policy size |
| NFR-005 | Reliability | Version data durability | 99.999% (5 nines) |
| NFR-006 | Scalability | Versions per policy | > 10,000 |
| NFR-007 | Availability | Version API uptime | 99.9% |
| NFR-008 | Compliance | Audit trail retention | Configurable (default 7 years) |

---

## 3. Architecture

### 3.1 Component Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         Policy Versioning Architecture                       │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        API Layer                                      │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │   │
│  │  │   REST API      │  │   gRPC API      │  │   Internal API      │  │   │
│  │  │ /v1/versions/*  │  │ VersionService  │  │ PolicyVersionManager│  │   │
│  │  └────────┬────────┘  └────────┬────────┘  └──────────┬──────────┘  │   │
│  │           │                    │                      │              │   │
│  └───────────┼────────────────────┼──────────────────────┼──────────────┘   │
│              │                    │                      │                  │
│              └────────────────────┼──────────────────────┘                  │
│                                   │                                         │
│  ┌────────────────────────────────▼────────────────────────────────────┐   │
│  │                    PolicyVersionManager                              │   │
│  │  ┌────────────────────────────────────────────────────────────────┐ │   │
│  │  │  Core Operations                                                │ │   │
│  │  │  - createVersion()     - getVersion()     - listVersions()     │ │   │
│  │  │  - deleteVersion()     - diffVersions()   - rollbackToVersion()│ │   │
│  │  └────────────────────────────────────────────────────────────────┘ │   │
│  │  ┌────────────────────────────────────────────────────────────────┐ │   │
│  │  │  Branch Operations                                              │ │   │
│  │  │  - createBranch()      - mergeBranch()    - promoteToBranch()  │ │   │
│  │  │  - getBranchHead()     - compareBranches()                      │ │   │
│  │  └────────────────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────┬───────────────────────────────────────┘   │
│                                 │                                           │
│         ┌───────────────────────┼───────────────────────┐                  │
│         │                       │                       │                  │
│         ▼                       ▼                       ▼                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐     │
│  │   VersionStore   │  │   DiffEngine     │  │   PromotionEngine    │     │
│  │                  │  │                  │  │                      │     │
│  │ - Commit storage │  │ - JSON Patch     │  │ - Approval workflow  │     │
│  │ - Tree structure │  │ - Semantic diff  │  │ - Validation gates   │     │
│  │ - Tag management │  │ - Conflict detect│  │ - Auto-rollback      │     │
│  └────────┬─────────┘  └──────────────────┘  └──────────────────────┘     │
│           │                                                                │
│           ▼                                                                │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                        Storage Layer                                   │ │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────┐  │ │
│  │  │  PostgreSQL    │  │  Redis Cache   │  │  Audit Log (Kafka)     │  │ │
│  │  │  (Versions)    │  │  (Hot versions)│  │  (Change events)       │  │ │
│  │  └────────────────┘  └────────────────┘  └────────────────────────┘  │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow

```
1. Version Creation Flow
   ┌─────────────────┐
   │   API Request   │
   │ (Create Version)│
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐     ┌─────────────────┐
   │ Validate Policy │────▶│  Validation     │
   │   & Version     │ No  │    Failed       │
   └────────┬────────┘     └─────────────────┘
            │ Yes
            ▼
   ┌─────────────────┐
   │ Compute Content │
   │     Hash        │
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐
   │  Generate Diff  │
   │ (from parent)   │
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐
   │  Store Version  │
   │   (Atomic TX)   │
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐
   │  Emit Audit     │
   │    Event        │
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐
   │  Return Version │
   │    Metadata     │
   └─────────────────┘


2. Promotion Flow (Draft → Staging → Production)
   ┌─────────────────┐
   │  Promotion      │
   │   Request       │
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐
   │  Check Source   │
   │ Branch Version  │
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐     ┌─────────────────┐
   │ Validate for    │────▶│  Validation     │
   │ Target Branch   │ No  │    Failed       │
   └────────┬────────┘     └─────────────────┘
            │ Yes
            ▼
   ┌─────────────────┐     ┌─────────────────┐
   │ Check Conflicts │────▶│   Conflicts     │
   │ with Target     │Yes  │   Detected      │
   └────────┬────────┘     └─────────────────┘
            │ No
            ▼
   ┌─────────────────┐     ┌─────────────────┐
   │ Approval Gate   │────▶│  Awaiting       │
   │  (if required)  │Wait │  Approval       │
   └────────┬────────┘     └─────────────────┘
            │ Approved
            ▼
   ┌─────────────────┐
   │ Create Version  │
   │ on Target Branch│
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐
   │ Update Branch   │
   │     HEAD        │
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐
   │  Hot Reload     │
   │ Active Policies │
   └─────────────────┘
```

### 3.3 Integration Points

| Integration | Protocol | Direction | Purpose |
|-------------|----------|-----------|---------|
| PolicyLoader | Internal API | Both | Load versioned policies |
| Storage Drivers | Internal API | Both | Persist version data |
| Audit System | Kafka/Internal | Out | Emit version change events |
| Decision Engine | Internal API | In | Serve active policy versions |
| REST API | HTTP | In | External version management |
| gRPC API | gRPC | In | External version management |

---

## 4. Version Model

### 4.1 Semantic Versioning Schema

Policies follow [Semantic Versioning 2.0.0](https://semver.org/) with policy-specific interpretations:

```
MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]

Examples:
- 1.0.0          (initial release)
- 1.0.1          (patch: typo fix, no behavior change)
- 1.1.0          (minor: new rule added, backward compatible)
- 2.0.0          (major: breaking change in policy logic)
- 2.0.0-draft.1  (pre-release: draft version)
- 2.0.0-rc.1     (pre-release: release candidate)
- 1.0.0+build.123 (build metadata)
```

#### Version Increment Rules

| Change Type | Version Bump | Examples |
|-------------|--------------|----------|
| Breaking logic change | MAJOR | Remove allowed action, change deny to allow |
| New rule/condition | MINOR | Add new action rule, extend derived role |
| Bug fix/typo | PATCH | Fix CEL expression typo, correct metadata |
| Work in progress | PRERELEASE | draft.1, alpha.2, rc.1 |

### 4.2 Git-Like Commit Model

```typescript
/**
 * Represents a single version commit in the policy history
 */
interface PolicyCommit {
  /** Unique commit identifier (SHA-256 hash) */
  commitId: string;

  /** Policy identifier this commit belongs to */
  policyId: string;

  /** Semantic version number */
  version: SemanticVersion;

  /** Parent commit ID (null for initial commit) */
  parentCommitId: string | null;

  /** Merge parent commit ID (for merge commits) */
  mergeParentCommitId?: string;

  /** Branch this commit was created on */
  branch: PolicyBranch;

  /** Full policy content at this version */
  content: PolicyContent;

  /** SHA-256 hash of content for integrity verification */
  contentHash: string;

  /** JSON Patch diff from parent (null for initial) */
  diff: JsonPatch | null;

  /** Commit metadata */
  metadata: CommitMetadata;

  /** Timestamp of commit creation */
  createdAt: Date;
}

interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
}

interface CommitMetadata {
  /** Author identifier (user or system) */
  author: string;

  /** Author email (optional) */
  authorEmail?: string;

  /** Commit message describing the change */
  message: string;

  /** Change classification */
  changeType: 'breaking' | 'feature' | 'fix' | 'refactor' | 'docs';

  /** Related ticket/issue references */
  references?: string[];

  /** Optional key-value labels */
  labels?: Record<string, string>;

  /** Approval information (for promotions) */
  approval?: ApprovalInfo;
}

interface ApprovalInfo {
  approvedBy: string;
  approvedAt: Date;
  approvalComment?: string;
}
```

### 4.3 Branch Model

```typescript
/**
 * Branch types with their purposes and constraints
 */
type PolicyBranch = 'draft' | 'staging' | 'production';

interface BranchConfig {
  /** Branch name */
  name: PolicyBranch;

  /** Human-readable description */
  description: string;

  /** Whether approval is required for commits */
  requiresApproval: boolean;

  /** Minimum approvers needed */
  minApprovers: number;

  /** Branches that can promote to this branch */
  allowedSourceBranches: PolicyBranch[];

  /** Whether this branch serves live traffic */
  isLive: boolean;

  /** Validation rules for this branch */
  validationRules: ValidationRule[];
}

const BRANCH_CONFIGS: Record<PolicyBranch, BranchConfig> = {
  draft: {
    name: 'draft',
    description: 'Work-in-progress policies for development',
    requiresApproval: false,
    minApprovers: 0,
    allowedSourceBranches: [],
    isLive: false,
    validationRules: ['syntax', 'schema'],
  },
  staging: {
    name: 'staging',
    description: 'Policies under testing before production',
    requiresApproval: true,
    minApprovers: 1,
    allowedSourceBranches: ['draft'],
    isLive: false,
    validationRules: ['syntax', 'schema', 'semantic', 'test-suite'],
  },
  production: {
    name: 'production',
    description: 'Live policies serving authorization requests',
    requiresApproval: true,
    minApprovers: 2,
    allowedSourceBranches: ['staging'],
    isLive: true,
    validationRules: ['syntax', 'schema', 'semantic', 'test-suite', 'backward-compat'],
  },
};

/**
 * Branch HEAD tracking
 */
interface BranchHead {
  /** Branch name */
  branch: PolicyBranch;

  /** Policy ID */
  policyId: string;

  /** Current HEAD commit ID */
  headCommitId: string;

  /** Current version at HEAD */
  headVersion: SemanticVersion;

  /** Last updated timestamp */
  updatedAt: Date;

  /** Lock status for concurrent access */
  locked: boolean;

  /** Lock holder (if locked) */
  lockedBy?: string;

  /** Lock expiration */
  lockExpiresAt?: Date;
}
```

### 4.4 Version Tree Structure

```
Policy: "avatar-policy"

                    ┌─────────────────────────────────────────────────────┐
                    │                    PRODUCTION                        │
                    │                                                      │
                    │  v1.0.0 ──── v1.0.1 ──── v1.1.0 ──── v2.0.0        │
                    │    │           │           │           │            │
                    └────┼───────────┼───────────┼───────────┼────────────┘
                         │           │           │           │
    ┌────────────────────┼───────────┼───────────┼───────────┼────────────┐
    │                    │  STAGING  │           │           │            │
    │                    │           │           │           │            │
    │         v1.0.0-rc.1│──v1.0.1-rc.1  v1.1.0-rc.1   v2.0.0-rc.1       │
    │              │     │      │           │               │             │
    └──────────────┼─────┼──────┼───────────┼───────────────┼─────────────┘
                   │     │      │           │               │
    ┌──────────────┼─────┼──────┼───────────┼───────────────┼─────────────┐
    │    DRAFT     │     │      │           │               │             │
    │              │     │      │           │               │             │
    │  v0.0.1 ─ v1.0.0-draft.1  │   v1.1.0-draft.1    v2.0.0-draft.1     │
    │    │              │       │        │                  │             │
    │    └──────────────┴───────┴────────┴──────────────────┘             │
    │                                                                      │
    └──────────────────────────────────────────────────────────────────────┘

Legend:
─────  Version progression (commits)
│      Promotion between branches
```

---

## 5. Version Operations

### 5.1 Create Version

```typescript
interface CreateVersionRequest {
  /** Policy ID to version */
  policyId: string;

  /** Target branch */
  branch: PolicyBranch;

  /** New policy content */
  content: PolicyContent;

  /** Version increment hint (auto-calculated if not provided) */
  versionHint?: 'major' | 'minor' | 'patch' | SemanticVersion;

  /** Commit message */
  message: string;

  /** Change type classification */
  changeType: 'breaking' | 'feature' | 'fix' | 'refactor' | 'docs';

  /** Author information */
  author: string;
  authorEmail?: string;

  /** Related references */
  references?: string[];

  /** Custom labels */
  labels?: Record<string, string>;

  /** Force creation even if validation warnings exist */
  force?: boolean;
}

interface CreateVersionResponse {
  /** Created commit */
  commit: PolicyCommit;

  /** Validation results */
  validation: ValidationResult;

  /** Diff from previous version */
  diff: VersionDiff;

  /** Warnings (if any) */
  warnings?: string[];
}

/**
 * Creates a new version of a policy
 */
async function createVersion(
  request: CreateVersionRequest
): Promise<CreateVersionResponse> {
  // 1. Validate policy content
  const validation = await validatePolicy(request.content, request.branch);
  if (!validation.valid && !request.force) {
    throw new PolicyValidationError(validation.errors);
  }

  // 2. Get current HEAD for branch
  const currentHead = await getBranchHead(request.policyId, request.branch);

  // 3. Calculate new version number
  const newVersion = calculateNextVersion(
    currentHead?.headVersion,
    request.versionHint,
    request.changeType
  );

  // 4. Compute content hash
  const contentHash = computeContentHash(request.content);

  // 5. Generate diff from parent
  const diff = currentHead
    ? await generateDiff(currentHead.headCommitId, request.content)
    : null;

  // 6. Create commit record
  const commit: PolicyCommit = {
    commitId: generateCommitId(request.policyId, newVersion, contentHash),
    policyId: request.policyId,
    version: newVersion,
    parentCommitId: currentHead?.headCommitId ?? null,
    branch: request.branch,
    content: request.content,
    contentHash,
    diff,
    metadata: {
      author: request.author,
      authorEmail: request.authorEmail,
      message: request.message,
      changeType: request.changeType,
      references: request.references,
      labels: request.labels,
    },
    createdAt: new Date(),
  };

  // 7. Store commit and update HEAD (atomic transaction)
  await storeCommitAndUpdateHead(commit, request.branch);

  // 8. Emit audit event
  await emitVersionCreatedEvent(commit);

  return {
    commit,
    validation,
    diff: diff ? formatDiff(diff) : { changes: [] },
    warnings: validation.warnings,
  };
}
```

### 5.2 List Versions

```typescript
interface ListVersionsRequest {
  /** Policy ID */
  policyId: string;

  /** Filter by branch (optional) */
  branch?: PolicyBranch;

  /** Filter by version range (semver range) */
  versionRange?: string;

  /** Filter by date range */
  fromDate?: Date;
  toDate?: Date;

  /** Filter by author */
  author?: string;

  /** Filter by change type */
  changeType?: string;

  /** Pagination */
  limit?: number;
  offset?: number;

  /** Sort order */
  sortBy?: 'version' | 'createdAt';
  sortOrder?: 'asc' | 'desc';

  /** Include full content (default: false for performance) */
  includeContent?: boolean;
}

interface ListVersionsResponse {
  /** Version records */
  versions: PolicyVersionSummary[];

  /** Total count (for pagination) */
  total: number;

  /** Pagination info */
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

interface PolicyVersionSummary {
  commitId: string;
  policyId: string;
  version: SemanticVersion;
  versionString: string;
  branch: PolicyBranch;
  parentCommitId: string | null;
  contentHash: string;
  metadata: CommitMetadata;
  createdAt: Date;
  /** Only included if includeContent=true */
  content?: PolicyContent;
}

/**
 * Lists versions of a policy with filtering and pagination
 */
async function listVersions(
  request: ListVersionsRequest
): Promise<ListVersionsResponse> {
  const query = buildVersionQuery(request);
  const [versions, total] = await Promise.all([
    executeVersionQuery(query),
    countVersions(query),
  ]);

  return {
    versions: versions.map(v => toVersionSummary(v, request.includeContent)),
    total,
    pagination: {
      limit: request.limit ?? 50,
      offset: request.offset ?? 0,
      hasMore: (request.offset ?? 0) + versions.length < total,
    },
  };
}
```

### 5.3 Get Version Diff

```typescript
interface GetVersionDiffRequest {
  /** Policy ID */
  policyId: string;

  /** Base version (from) */
  baseVersion: string | SemanticVersion;

  /** Target version (to) */
  targetVersion: string | SemanticVersion;

  /** Diff format */
  format?: 'json-patch' | 'semantic' | 'unified';

  /** Include context lines (for unified format) */
  contextLines?: number;
}

interface VersionDiff {
  /** Base version info */
  base: {
    commitId: string;
    version: SemanticVersion;
    branch: PolicyBranch;
  };

  /** Target version info */
  target: {
    commitId: string;
    version: SemanticVersion;
    branch: PolicyBranch;
  };

  /** Diff operations */
  changes: DiffChange[];

  /** Summary statistics */
  summary: DiffSummary;

  /** Formatted diff (based on format) */
  formatted: string | JsonPatch;
}

interface DiffChange {
  /** Change type */
  type: 'add' | 'remove' | 'modify' | 'move';

  /** JSON path of the change */
  path: string;

  /** Human-readable description */
  description: string;

  /** Previous value (for remove/modify) */
  oldValue?: unknown;

  /** New value (for add/modify) */
  newValue?: unknown;

  /** Semantic impact assessment */
  impact: 'breaking' | 'non-breaking' | 'cosmetic';
}

interface DiffSummary {
  /** Number of additions */
  additions: number;

  /** Number of deletions */
  deletions: number;

  /** Number of modifications */
  modifications: number;

  /** Overall change impact */
  overallImpact: 'breaking' | 'non-breaking' | 'cosmetic';

  /** Affected sections */
  affectedSections: string[];
}

/**
 * Generates diff between two versions
 */
async function getVersionDiff(
  request: GetVersionDiffRequest
): Promise<VersionDiff> {
  // 1. Resolve versions to commits
  const baseCommit = await resolveVersionToCommit(
    request.policyId,
    request.baseVersion
  );
  const targetCommit = await resolveVersionToCommit(
    request.policyId,
    request.targetVersion
  );

  // 2. Generate JSON Patch diff
  const jsonPatch = generateJsonPatch(baseCommit.content, targetCommit.content);

  // 3. Analyze changes for semantic impact
  const changes = analyzeChanges(jsonPatch, baseCommit.content, targetCommit.content);

  // 4. Generate summary
  const summary = summarizeChanges(changes);

  // 5. Format output based on requested format
  const formatted = formatDiff(jsonPatch, request.format, request.contextLines);

  return {
    base: {
      commitId: baseCommit.commitId,
      version: baseCommit.version,
      branch: baseCommit.branch,
    },
    target: {
      commitId: targetCommit.commitId,
      version: targetCommit.version,
      branch: targetCommit.branch,
    },
    changes,
    summary,
    formatted,
  };
}
```

### 5.4 Rollback to Version

```typescript
interface RollbackRequest {
  /** Policy ID */
  policyId: string;

  /** Branch to rollback */
  branch: PolicyBranch;

  /** Target version to rollback to */
  targetVersion: string | SemanticVersion;

  /** Rollback reason */
  reason: string;

  /** Author performing rollback */
  author: string;

  /** Skip validation (emergency rollback) */
  skipValidation?: boolean;

  /** Dry run (preview only) */
  dryRun?: boolean;
}

interface RollbackResponse {
  /** Whether rollback was successful */
  success: boolean;

  /** New commit created by rollback */
  commit?: PolicyCommit;

  /** Preview of changes (for dry run) */
  preview?: {
    currentVersion: SemanticVersion;
    targetVersion: SemanticVersion;
    diff: VersionDiff;
    warnings: string[];
  };

  /** Rollback metadata */
  rollbackInfo: {
    rolledBackFrom: string;
    rolledBackTo: string;
    reason: string;
    author: string;
    timestamp: Date;
  };
}

/**
 * Rollback policy to a previous version
 */
async function rollbackToVersion(
  request: RollbackRequest
): Promise<RollbackResponse> {
  // 1. Validate rollback is allowed
  const currentHead = await getBranchHead(request.policyId, request.branch);
  if (!currentHead) {
    throw new PolicyNotFoundError(request.policyId, request.branch);
  }

  // 2. Get target version content
  const targetCommit = await resolveVersionToCommit(
    request.policyId,
    request.targetVersion
  );

  // 3. Generate diff for preview
  const diff = await getVersionDiff({
    policyId: request.policyId,
    baseVersion: currentHead.headVersion,
    targetVersion: targetCommit.version,
  });

  // 4. Validate target content (unless skipped)
  let warnings: string[] = [];
  if (!request.skipValidation) {
    const validation = await validatePolicy(targetCommit.content, request.branch);
    if (!validation.valid) {
      throw new RollbackValidationError(validation.errors);
    }
    warnings = validation.warnings ?? [];
  }

  // 5. Dry run - return preview only
  if (request.dryRun) {
    return {
      success: true,
      preview: {
        currentVersion: currentHead.headVersion,
        targetVersion: targetCommit.version,
        diff,
        warnings,
      },
      rollbackInfo: {
        rolledBackFrom: formatVersion(currentHead.headVersion),
        rolledBackTo: formatVersion(targetCommit.version),
        reason: request.reason,
        author: request.author,
        timestamp: new Date(),
      },
    };
  }

  // 6. Calculate new version (patch increment from current)
  const newVersion = incrementVersion(currentHead.headVersion, 'patch');

  // 7. Create rollback commit
  const rollbackCommit: PolicyCommit = {
    commitId: generateCommitId(request.policyId, newVersion, targetCommit.contentHash),
    policyId: request.policyId,
    version: newVersion,
    parentCommitId: currentHead.headCommitId,
    branch: request.branch,
    content: targetCommit.content, // Use target version's content
    contentHash: targetCommit.contentHash,
    diff: await generateDiff(currentHead.headCommitId, targetCommit.content),
    metadata: {
      author: request.author,
      message: `Rollback to ${formatVersion(targetCommit.version)}: ${request.reason}`,
      changeType: 'fix',
      labels: {
        rollback: 'true',
        rollbackTarget: formatVersion(targetCommit.version),
        rollbackFrom: formatVersion(currentHead.headVersion),
      },
    },
    createdAt: new Date(),
  };

  // 8. Store commit and update HEAD
  await storeCommitAndUpdateHead(rollbackCommit, request.branch);

  // 9. Emit audit event
  await emitRollbackEvent(rollbackCommit, request.reason);

  return {
    success: true,
    commit: rollbackCommit,
    rollbackInfo: {
      rolledBackFrom: formatVersion(currentHead.headVersion),
      rolledBackTo: formatVersion(targetCommit.version),
      reason: request.reason,
      author: request.author,
      timestamp: new Date(),
    },
  };
}
```

### 5.5 Promote Version

```typescript
interface PromoteVersionRequest {
  /** Policy ID */
  policyId: string;

  /** Source branch */
  sourceBranch: PolicyBranch;

  /** Target branch */
  targetBranch: PolicyBranch;

  /** Specific version to promote (defaults to HEAD) */
  sourceVersion?: string | SemanticVersion;

  /** Promotion message */
  message: string;

  /** Author performing promotion */
  author: string;

  /** Approver information (for production) */
  approval?: {
    approver: string;
    comment?: string;
  };

  /** Skip validation */
  skipValidation?: boolean;
}

interface PromoteVersionResponse {
  /** Whether promotion was successful */
  success: boolean;

  /** New commit on target branch */
  commit: PolicyCommit;

  /** Promotion details */
  promotion: {
    sourceBranch: PolicyBranch;
    sourceVersion: SemanticVersion;
    targetBranch: PolicyBranch;
    targetVersion: SemanticVersion;
    promotedAt: Date;
    promotedBy: string;
  };

  /** Validation results */
  validation: ValidationResult;

  /** Actions taken after promotion */
  postActions: {
    hotReloadTriggered: boolean;
    notificationsSent: string[];
    webhooksTriggered: string[];
  };
}

/**
 * Promotes a policy version from one branch to another
 */
async function promoteVersion(
  request: PromoteVersionRequest
): Promise<PromoteVersionResponse> {
  // 1. Validate promotion path
  const targetConfig = BRANCH_CONFIGS[request.targetBranch];
  if (!targetConfig.allowedSourceBranches.includes(request.sourceBranch)) {
    throw new InvalidPromotionPathError(request.sourceBranch, request.targetBranch);
  }

  // 2. Check approval requirements
  if (targetConfig.requiresApproval && !request.approval) {
    throw new ApprovalRequiredError(request.targetBranch, targetConfig.minApprovers);
  }

  // 3. Get source version
  const sourceCommit = request.sourceVersion
    ? await resolveVersionToCommit(request.policyId, request.sourceVersion)
    : await getHeadCommit(request.policyId, request.sourceBranch);

  // 4. Get current target HEAD (if exists)
  const targetHead = await getBranchHead(request.policyId, request.targetBranch);

  // 5. Check for conflicts
  if (targetHead) {
    const conflicts = await detectConflicts(sourceCommit, targetHead.headCommitId);
    if (conflicts.length > 0) {
      throw new MergeConflictError(conflicts);
    }
  }

  // 6. Validate for target branch
  if (!request.skipValidation) {
    const validation = await validatePolicy(
      sourceCommit.content,
      request.targetBranch
    );
    if (!validation.valid) {
      throw new PromotionValidationError(validation.errors);
    }
  }

  // 7. Calculate target version
  const targetVersion = calculatePromotionVersion(
    sourceCommit.version,
    request.targetBranch
  );

  // 8. Create promotion commit
  const promotionCommit: PolicyCommit = {
    commitId: generateCommitId(request.policyId, targetVersion, sourceCommit.contentHash),
    policyId: request.policyId,
    version: targetVersion,
    parentCommitId: targetHead?.headCommitId ?? null,
    mergeParentCommitId: sourceCommit.commitId,
    branch: request.targetBranch,
    content: sourceCommit.content,
    contentHash: sourceCommit.contentHash,
    diff: targetHead
      ? await generateDiff(targetHead.headCommitId, sourceCommit.content)
      : null,
    metadata: {
      author: request.author,
      message: request.message,
      changeType: sourceCommit.metadata.changeType,
      labels: {
        promotion: 'true',
        promotedFrom: request.sourceBranch,
        promotedVersion: formatVersion(sourceCommit.version),
      },
      approval: request.approval
        ? {
            approvedBy: request.approval.approver,
            approvedAt: new Date(),
            approvalComment: request.approval.comment,
          }
        : undefined,
    },
    createdAt: new Date(),
  };

  // 9. Store commit and update HEAD
  await storeCommitAndUpdateHead(promotionCommit, request.targetBranch);

  // 10. Post-promotion actions
  const postActions = await executePostPromotionActions(
    promotionCommit,
    request.targetBranch
  );

  // 11. Emit audit event
  await emitPromotionEvent(promotionCommit, request.sourceBranch);

  return {
    success: true,
    commit: promotionCommit,
    promotion: {
      sourceBranch: request.sourceBranch,
      sourceVersion: sourceCommit.version,
      targetBranch: request.targetBranch,
      targetVersion,
      promotedAt: new Date(),
      promotedBy: request.author,
    },
    validation: { valid: true, errors: [], warnings: [] },
    postActions,
  };
}

/**
 * Calculate version number for promotion
 */
function calculatePromotionVersion(
  sourceVersion: SemanticVersion,
  targetBranch: PolicyBranch
): SemanticVersion {
  switch (targetBranch) {
    case 'staging':
      // Add -rc.N prerelease tag
      return {
        ...sourceVersion,
        prerelease: `rc.${Date.now()}`,
      };
    case 'production':
      // Remove prerelease, keep core version
      return {
        major: sourceVersion.major,
        minor: sourceVersion.minor,
        patch: sourceVersion.patch,
      };
    default:
      return sourceVersion;
  }
}
```

---

## 6. Storage Schema

### 6.1 PostgreSQL Database Schema

```sql
-- Schema version tracking
CREATE TABLE schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT NOW()
);

-- Policy versions (commits)
CREATE TABLE policy_versions (
    commit_id VARCHAR(64) PRIMARY KEY,
    policy_id VARCHAR(255) NOT NULL,
    version_major INTEGER NOT NULL,
    version_minor INTEGER NOT NULL,
    version_patch INTEGER NOT NULL,
    version_prerelease VARCHAR(100),
    version_build VARCHAR(100),
    version_string VARCHAR(100) NOT NULL,
    parent_commit_id VARCHAR(64),
    merge_parent_commit_id VARCHAR(64),
    branch VARCHAR(50) NOT NULL,
    content JSONB NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    diff JSONB,
    author VARCHAR(255) NOT NULL,
    author_email VARCHAR(255),
    message TEXT NOT NULL,
    change_type VARCHAR(50) NOT NULL,
    references TEXT[],
    labels JSONB DEFAULT '{}',
    approval_by VARCHAR(255),
    approval_at TIMESTAMP,
    approval_comment TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP,

    -- Foreign keys
    CONSTRAINT fk_parent_commit FOREIGN KEY (parent_commit_id)
        REFERENCES policy_versions(commit_id),
    CONSTRAINT fk_merge_parent FOREIGN KEY (merge_parent_commit_id)
        REFERENCES policy_versions(commit_id),

    -- Constraints
    CONSTRAINT valid_branch CHECK (branch IN ('draft', 'staging', 'production')),
    CONSTRAINT valid_change_type CHECK (
        change_type IN ('breaking', 'feature', 'fix', 'refactor', 'docs')
    )
);

-- Branch HEAD tracking
CREATE TABLE branch_heads (
    id SERIAL PRIMARY KEY,
    policy_id VARCHAR(255) NOT NULL,
    branch VARCHAR(50) NOT NULL,
    head_commit_id VARCHAR(64) NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    locked BOOLEAN DEFAULT FALSE,
    locked_by VARCHAR(255),
    lock_expires_at TIMESTAMP,

    -- Unique constraint
    CONSTRAINT unique_policy_branch UNIQUE (policy_id, branch),

    -- Foreign key
    CONSTRAINT fk_head_commit FOREIGN KEY (head_commit_id)
        REFERENCES policy_versions(commit_id)
);

-- Version tags (human-readable labels)
CREATE TABLE version_tags (
    id SERIAL PRIMARY KEY,
    tag_name VARCHAR(100) NOT NULL,
    policy_id VARCHAR(255) NOT NULL,
    commit_id VARCHAR(64) NOT NULL,
    description TEXT,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Unique constraint
    CONSTRAINT unique_policy_tag UNIQUE (policy_id, tag_name),

    -- Foreign key
    CONSTRAINT fk_tag_commit FOREIGN KEY (commit_id)
        REFERENCES policy_versions(commit_id)
);

-- Promotion history
CREATE TABLE promotion_history (
    id SERIAL PRIMARY KEY,
    policy_id VARCHAR(255) NOT NULL,
    source_branch VARCHAR(50) NOT NULL,
    target_branch VARCHAR(50) NOT NULL,
    source_commit_id VARCHAR(64) NOT NULL,
    target_commit_id VARCHAR(64) NOT NULL,
    source_version VARCHAR(100) NOT NULL,
    target_version VARCHAR(100) NOT NULL,
    promoted_by VARCHAR(255) NOT NULL,
    approved_by VARCHAR(255),
    approval_comment TEXT,
    promoted_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Foreign keys
    CONSTRAINT fk_source_commit FOREIGN KEY (source_commit_id)
        REFERENCES policy_versions(commit_id),
    CONSTRAINT fk_target_commit FOREIGN KEY (target_commit_id)
        REFERENCES policy_versions(commit_id)
);

-- Rollback history
CREATE TABLE rollback_history (
    id SERIAL PRIMARY KEY,
    policy_id VARCHAR(255) NOT NULL,
    branch VARCHAR(50) NOT NULL,
    from_commit_id VARCHAR(64) NOT NULL,
    to_commit_id VARCHAR(64) NOT NULL,
    rollback_commit_id VARCHAR(64) NOT NULL,
    from_version VARCHAR(100) NOT NULL,
    to_version VARCHAR(100) NOT NULL,
    reason TEXT NOT NULL,
    rolled_back_by VARCHAR(255) NOT NULL,
    rolled_back_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Foreign keys
    CONSTRAINT fk_from_commit FOREIGN KEY (from_commit_id)
        REFERENCES policy_versions(commit_id),
    CONSTRAINT fk_to_commit FOREIGN KEY (to_commit_id)
        REFERENCES policy_versions(commit_id),
    CONSTRAINT fk_rollback_commit FOREIGN KEY (rollback_commit_id)
        REFERENCES policy_versions(commit_id)
);

-- Pending approvals
CREATE TABLE pending_approvals (
    id SERIAL PRIMARY KEY,
    policy_id VARCHAR(255) NOT NULL,
    commit_id VARCHAR(64) NOT NULL,
    target_branch VARCHAR(50) NOT NULL,
    requested_by VARCHAR(255) NOT NULL,
    requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    approvals JSONB DEFAULT '[]',
    required_approvers INTEGER NOT NULL,

    -- Foreign key
    CONSTRAINT fk_approval_commit FOREIGN KEY (commit_id)
        REFERENCES policy_versions(commit_id),

    -- Constraint
    CONSTRAINT valid_status CHECK (status IN ('pending', 'approved', 'rejected', 'expired'))
);
```

### 6.2 Indexes

```sql
-- Version queries
CREATE INDEX idx_versions_policy_branch ON policy_versions(policy_id, branch);
CREATE INDEX idx_versions_policy_version ON policy_versions(
    policy_id, version_major DESC, version_minor DESC, version_patch DESC
);
CREATE INDEX idx_versions_created_at ON policy_versions(created_at DESC);
CREATE INDEX idx_versions_author ON policy_versions(author);
CREATE INDEX idx_versions_content_hash ON policy_versions(content_hash);

-- Branch HEAD lookups
CREATE INDEX idx_branch_heads_policy ON branch_heads(policy_id);

-- Tag lookups
CREATE INDEX idx_tags_policy ON version_tags(policy_id);

-- Promotion history
CREATE INDEX idx_promotion_policy ON promotion_history(policy_id);
CREATE INDEX idx_promotion_target_branch ON promotion_history(target_branch);
CREATE INDEX idx_promotion_date ON promotion_history(promoted_at DESC);

-- Rollback history
CREATE INDEX idx_rollback_policy ON rollback_history(policy_id);
CREATE INDEX idx_rollback_date ON rollback_history(rolled_back_at DESC);

-- Full-text search on commit messages
CREATE INDEX idx_versions_message_search ON policy_versions
    USING GIN (to_tsvector('english', message));

-- JSONB indexes for labels
CREATE INDEX idx_versions_labels ON policy_versions USING GIN (labels);
```

### 6.3 Database Functions

```sql
-- Function to get version history for a policy
CREATE OR REPLACE FUNCTION get_version_history(
    p_policy_id VARCHAR(255),
    p_branch VARCHAR(50) DEFAULT NULL,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    commit_id VARCHAR(64),
    version_string VARCHAR(100),
    branch VARCHAR(50),
    message TEXT,
    author VARCHAR(255),
    created_at TIMESTAMP,
    parent_commit_id VARCHAR(64)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        pv.commit_id,
        pv.version_string,
        pv.branch,
        pv.message,
        pv.author,
        pv.created_at,
        pv.parent_commit_id
    FROM policy_versions pv
    WHERE pv.policy_id = p_policy_id
        AND pv.deleted_at IS NULL
        AND (p_branch IS NULL OR pv.branch = p_branch)
    ORDER BY pv.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- Function to find common ancestor for merge
CREATE OR REPLACE FUNCTION find_common_ancestor(
    p_commit_id_1 VARCHAR(64),
    p_commit_id_2 VARCHAR(64)
)
RETURNS VARCHAR(64) AS $$
DECLARE
    v_ancestors_1 VARCHAR(64)[];
    v_current VARCHAR(64);
BEGIN
    -- Build ancestor chain for commit 1
    v_current := p_commit_id_1;
    WHILE v_current IS NOT NULL LOOP
        v_ancestors_1 := array_append(v_ancestors_1, v_current);
        SELECT parent_commit_id INTO v_current
        FROM policy_versions
        WHERE commit_id = v_current;
    END LOOP;

    -- Walk commit 2's ancestors until we find a match
    v_current := p_commit_id_2;
    WHILE v_current IS NOT NULL LOOP
        IF v_current = ANY(v_ancestors_1) THEN
            RETURN v_current;
        END IF;
        SELECT parent_commit_id INTO v_current
        FROM policy_versions
        WHERE commit_id = v_current;
    END LOOP;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger for audit logging
CREATE OR REPLACE FUNCTION notify_version_change()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('policy_version_changes', json_build_object(
        'operation', TG_OP,
        'commit_id', COALESCE(NEW.commit_id, OLD.commit_id),
        'policy_id', COALESCE(NEW.policy_id, OLD.policy_id),
        'branch', COALESCE(NEW.branch, OLD.branch),
        'version', COALESCE(NEW.version_string, OLD.version_string)
    )::text);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER version_change_trigger
AFTER INSERT OR UPDATE OR DELETE ON policy_versions
FOR EACH ROW EXECUTE FUNCTION notify_version_change();
```

---

## 7. API Endpoints

### 7.1 REST API

```yaml
openapi: 3.0.3
info:
  title: AuthZ Engine Policy Versioning API
  version: 1.0.0
  description: API for managing policy versions, branches, and promotions

servers:
  - url: https://authz-engine.example.com/api/v1

paths:
  /policies/{policyId}/versions:
    get:
      summary: List policy versions
      operationId: listVersions
      tags:
        - Versions
      parameters:
        - name: policyId
          in: path
          required: true
          schema:
            type: string
        - name: branch
          in: query
          schema:
            type: string
            enum: [draft, staging, production]
        - name: limit
          in: query
          schema:
            type: integer
            default: 50
        - name: offset
          in: query
          schema:
            type: integer
            default: 0
        - name: includeContent
          in: query
          schema:
            type: boolean
            default: false
      responses:
        '200':
          description: List of versions
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ListVersionsResponse'
        '404':
          description: Policy not found

    post:
      summary: Create new version
      operationId: createVersion
      tags:
        - Versions
      parameters:
        - name: policyId
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateVersionRequest'
      responses:
        '201':
          description: Version created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CreateVersionResponse'
        '400':
          description: Invalid request
        '409':
          description: Version conflict

  /policies/{policyId}/versions/{version}:
    get:
      summary: Get specific version
      operationId: getVersion
      tags:
        - Versions
      parameters:
        - name: policyId
          in: path
          required: true
          schema:
            type: string
        - name: version
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Version details
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PolicyVersion'
        '404':
          description: Version not found

  /policies/{policyId}/versions/diff:
    get:
      summary: Get diff between versions
      operationId: getVersionDiff
      tags:
        - Versions
      parameters:
        - name: policyId
          in: path
          required: true
          schema:
            type: string
        - name: base
          in: query
          required: true
          schema:
            type: string
        - name: target
          in: query
          required: true
          schema:
            type: string
        - name: format
          in: query
          schema:
            type: string
            enum: [json-patch, semantic, unified]
            default: semantic
      responses:
        '200':
          description: Version diff
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/VersionDiff'

  /policies/{policyId}/rollback:
    post:
      summary: Rollback to previous version
      operationId: rollbackVersion
      tags:
        - Versions
      parameters:
        - name: policyId
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/RollbackRequest'
      responses:
        '200':
          description: Rollback successful
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RollbackResponse'
        '400':
          description: Invalid rollback request
        '409':
          description: Rollback conflict

  /policies/{policyId}/promote:
    post:
      summary: Promote version to target branch
      operationId: promoteVersion
      tags:
        - Branches
      parameters:
        - name: policyId
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/PromoteVersionRequest'
      responses:
        '200':
          description: Promotion successful
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PromoteVersionResponse'
        '400':
          description: Invalid promotion path
        '403':
          description: Approval required
        '409':
          description: Merge conflict

  /policies/{policyId}/branches:
    get:
      summary: List branch heads for policy
      operationId: listBranches
      tags:
        - Branches
      parameters:
        - name: policyId
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Branch information
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ListBranchesResponse'

  /policies/{policyId}/branches/{branch}/compare:
    get:
      summary: Compare branches
      operationId: compareBranches
      tags:
        - Branches
      parameters:
        - name: policyId
          in: path
          required: true
          schema:
            type: string
        - name: branch
          in: path
          required: true
          schema:
            type: string
        - name: compareTo
          in: query
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Branch comparison
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BranchComparison'

  /policies/{policyId}/tags:
    get:
      summary: List version tags
      operationId: listTags
      tags:
        - Tags
      parameters:
        - name: policyId
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: List of tags
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ListTagsResponse'

    post:
      summary: Create version tag
      operationId: createTag
      tags:
        - Tags
      parameters:
        - name: policyId
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateTagRequest'
      responses:
        '201':
          description: Tag created
        '409':
          description: Tag already exists

components:
  schemas:
    SemanticVersion:
      type: object
      properties:
        major:
          type: integer
        minor:
          type: integer
        patch:
          type: integer
        prerelease:
          type: string
        build:
          type: string
      required:
        - major
        - minor
        - patch

    PolicyVersion:
      type: object
      properties:
        commitId:
          type: string
        policyId:
          type: string
        version:
          $ref: '#/components/schemas/SemanticVersion'
        versionString:
          type: string
        branch:
          type: string
          enum: [draft, staging, production]
        parentCommitId:
          type: string
          nullable: true
        contentHash:
          type: string
        content:
          type: object
        metadata:
          $ref: '#/components/schemas/CommitMetadata'
        createdAt:
          type: string
          format: date-time

    CommitMetadata:
      type: object
      properties:
        author:
          type: string
        authorEmail:
          type: string
        message:
          type: string
        changeType:
          type: string
          enum: [breaking, feature, fix, refactor, docs]
        references:
          type: array
          items:
            type: string
        labels:
          type: object
          additionalProperties:
            type: string

    CreateVersionRequest:
      type: object
      properties:
        branch:
          type: string
          enum: [draft, staging, production]
        content:
          type: object
        versionHint:
          type: string
        message:
          type: string
        changeType:
          type: string
          enum: [breaking, feature, fix, refactor, docs]
        author:
          type: string
        authorEmail:
          type: string
        references:
          type: array
          items:
            type: string
        labels:
          type: object
          additionalProperties:
            type: string
        force:
          type: boolean
          default: false
      required:
        - branch
        - content
        - message
        - changeType
        - author

    CreateVersionResponse:
      type: object
      properties:
        commit:
          $ref: '#/components/schemas/PolicyVersion'
        validation:
          $ref: '#/components/schemas/ValidationResult'
        diff:
          $ref: '#/components/schemas/VersionDiff'
        warnings:
          type: array
          items:
            type: string

    ListVersionsResponse:
      type: object
      properties:
        versions:
          type: array
          items:
            $ref: '#/components/schemas/PolicyVersion'
        total:
          type: integer
        pagination:
          type: object
          properties:
            limit:
              type: integer
            offset:
              type: integer
            hasMore:
              type: boolean

    VersionDiff:
      type: object
      properties:
        base:
          type: object
          properties:
            commitId:
              type: string
            version:
              $ref: '#/components/schemas/SemanticVersion'
            branch:
              type: string
        target:
          type: object
          properties:
            commitId:
              type: string
            version:
              $ref: '#/components/schemas/SemanticVersion'
            branch:
              type: string
        changes:
          type: array
          items:
            $ref: '#/components/schemas/DiffChange'
        summary:
          $ref: '#/components/schemas/DiffSummary'

    DiffChange:
      type: object
      properties:
        type:
          type: string
          enum: [add, remove, modify, move]
        path:
          type: string
        description:
          type: string
        oldValue:
          type: object
        newValue:
          type: object
        impact:
          type: string
          enum: [breaking, non-breaking, cosmetic]

    DiffSummary:
      type: object
      properties:
        additions:
          type: integer
        deletions:
          type: integer
        modifications:
          type: integer
        overallImpact:
          type: string
          enum: [breaking, non-breaking, cosmetic]
        affectedSections:
          type: array
          items:
            type: string

    RollbackRequest:
      type: object
      properties:
        branch:
          type: string
          enum: [draft, staging, production]
        targetVersion:
          type: string
        reason:
          type: string
        author:
          type: string
        skipValidation:
          type: boolean
          default: false
        dryRun:
          type: boolean
          default: false
      required:
        - branch
        - targetVersion
        - reason
        - author

    RollbackResponse:
      type: object
      properties:
        success:
          type: boolean
        commit:
          $ref: '#/components/schemas/PolicyVersion'
        preview:
          type: object
        rollbackInfo:
          type: object
          properties:
            rolledBackFrom:
              type: string
            rolledBackTo:
              type: string
            reason:
              type: string
            author:
              type: string
            timestamp:
              type: string
              format: date-time

    PromoteVersionRequest:
      type: object
      properties:
        sourceBranch:
          type: string
          enum: [draft, staging]
        targetBranch:
          type: string
          enum: [staging, production]
        sourceVersion:
          type: string
        message:
          type: string
        author:
          type: string
        approval:
          type: object
          properties:
            approver:
              type: string
            comment:
              type: string
        skipValidation:
          type: boolean
          default: false
      required:
        - sourceBranch
        - targetBranch
        - message
        - author

    PromoteVersionResponse:
      type: object
      properties:
        success:
          type: boolean
        commit:
          $ref: '#/components/schemas/PolicyVersion'
        promotion:
          type: object
          properties:
            sourceBranch:
              type: string
            sourceVersion:
              $ref: '#/components/schemas/SemanticVersion'
            targetBranch:
              type: string
            targetVersion:
              $ref: '#/components/schemas/SemanticVersion'
            promotedAt:
              type: string
              format: date-time
            promotedBy:
              type: string
        validation:
          $ref: '#/components/schemas/ValidationResult'
        postActions:
          type: object

    ValidationResult:
      type: object
      properties:
        valid:
          type: boolean
        errors:
          type: array
          items:
            type: string
        warnings:
          type: array
          items:
            type: string

    ListBranchesResponse:
      type: object
      properties:
        branches:
          type: array
          items:
            type: object
            properties:
              name:
                type: string
              headCommitId:
                type: string
              headVersion:
                $ref: '#/components/schemas/SemanticVersion'
              updatedAt:
                type: string
                format: date-time
              locked:
                type: boolean

    BranchComparison:
      type: object
      properties:
        baseBranch:
          type: string
        compareBranch:
          type: string
        aheadBy:
          type: integer
        behindBy:
          type: integer
        diverged:
          type: boolean
        commonAncestor:
          type: string
        diff:
          $ref: '#/components/schemas/VersionDiff'

    ListTagsResponse:
      type: object
      properties:
        tags:
          type: array
          items:
            type: object
            properties:
              tagName:
                type: string
              commitId:
                type: string
              version:
                $ref: '#/components/schemas/SemanticVersion'
              description:
                type: string
              createdBy:
                type: string
              createdAt:
                type: string
                format: date-time

    CreateTagRequest:
      type: object
      properties:
        tagName:
          type: string
        version:
          type: string
        description:
          type: string
        createdBy:
          type: string
      required:
        - tagName
        - version
        - createdBy
```

### 7.2 gRPC API

```protobuf
syntax = "proto3";

package authz.versioning.v1;

option go_package = "github.com/org/authz-engine/proto/versioning/v1;versioningv1";

import "google/protobuf/timestamp.proto";
import "google/protobuf/struct.proto";

// PolicyVersionService provides version management operations
service PolicyVersionService {
  // Version operations
  rpc CreateVersion(CreateVersionRequest) returns (CreateVersionResponse);
  rpc GetVersion(GetVersionRequest) returns (GetVersionResponse);
  rpc ListVersions(ListVersionsRequest) returns (ListVersionsResponse);
  rpc DeleteVersion(DeleteVersionRequest) returns (DeleteVersionResponse);

  // Diff operations
  rpc GetVersionDiff(GetVersionDiffRequest) returns (GetVersionDiffResponse);

  // Rollback operations
  rpc RollbackToVersion(RollbackRequest) returns (RollbackResponse);

  // Branch operations
  rpc ListBranches(ListBranchesRequest) returns (ListBranchesResponse);
  rpc GetBranchHead(GetBranchHeadRequest) returns (GetBranchHeadResponse);
  rpc PromoteVersion(PromoteVersionRequest) returns (PromoteVersionResponse);
  rpc CompareBranches(CompareBranchesRequest) returns (CompareBranchesResponse);

  // Tag operations
  rpc CreateTag(CreateTagRequest) returns (CreateTagResponse);
  rpc ListTags(ListTagsRequest) returns (ListTagsResponse);
  rpc DeleteTag(DeleteTagRequest) returns (DeleteTagResponse);

  // Streaming operations
  rpc WatchVersionChanges(WatchVersionChangesRequest) returns (stream VersionChangeEvent);
}

// Enums
enum Branch {
  BRANCH_UNSPECIFIED = 0;
  BRANCH_DRAFT = 1;
  BRANCH_STAGING = 2;
  BRANCH_PRODUCTION = 3;
}

enum ChangeType {
  CHANGE_TYPE_UNSPECIFIED = 0;
  CHANGE_TYPE_BREAKING = 1;
  CHANGE_TYPE_FEATURE = 2;
  CHANGE_TYPE_FIX = 3;
  CHANGE_TYPE_REFACTOR = 4;
  CHANGE_TYPE_DOCS = 5;
}

enum DiffFormat {
  DIFF_FORMAT_UNSPECIFIED = 0;
  DIFF_FORMAT_JSON_PATCH = 1;
  DIFF_FORMAT_SEMANTIC = 2;
  DIFF_FORMAT_UNIFIED = 3;
}

enum Impact {
  IMPACT_UNSPECIFIED = 0;
  IMPACT_BREAKING = 1;
  IMPACT_NON_BREAKING = 2;
  IMPACT_COSMETIC = 3;
}

// Messages
message SemanticVersion {
  int32 major = 1;
  int32 minor = 2;
  int32 patch = 3;
  string prerelease = 4;
  string build = 5;
}

message CommitMetadata {
  string author = 1;
  string author_email = 2;
  string message = 3;
  ChangeType change_type = 4;
  repeated string references = 5;
  map<string, string> labels = 6;
  ApprovalInfo approval = 7;
}

message ApprovalInfo {
  string approved_by = 1;
  google.protobuf.Timestamp approved_at = 2;
  string approval_comment = 3;
}

message PolicyVersion {
  string commit_id = 1;
  string policy_id = 2;
  SemanticVersion version = 3;
  string version_string = 4;
  Branch branch = 5;
  string parent_commit_id = 6;
  string merge_parent_commit_id = 7;
  google.protobuf.Struct content = 8;
  string content_hash = 9;
  CommitMetadata metadata = 10;
  google.protobuf.Timestamp created_at = 11;
}

message DiffChange {
  string type = 1; // add, remove, modify, move
  string path = 2;
  string description = 3;
  google.protobuf.Value old_value = 4;
  google.protobuf.Value new_value = 5;
  Impact impact = 6;
}

message DiffSummary {
  int32 additions = 1;
  int32 deletions = 2;
  int32 modifications = 3;
  Impact overall_impact = 4;
  repeated string affected_sections = 5;
}

message VersionDiff {
  PolicyVersion base = 1;
  PolicyVersion target = 2;
  repeated DiffChange changes = 3;
  DiffSummary summary = 4;
  bytes formatted = 5; // JSON Patch or unified diff
}

// Request/Response messages
message CreateVersionRequest {
  string policy_id = 1;
  Branch branch = 2;
  google.protobuf.Struct content = 3;
  string version_hint = 4; // major, minor, patch, or specific version
  string message = 5;
  ChangeType change_type = 6;
  string author = 7;
  string author_email = 8;
  repeated string references = 9;
  map<string, string> labels = 10;
  bool force = 11;
}

message CreateVersionResponse {
  PolicyVersion commit = 1;
  ValidationResult validation = 2;
  VersionDiff diff = 3;
  repeated string warnings = 4;
}

message GetVersionRequest {
  string policy_id = 1;
  string version = 2; // version string or commit ID
}

message GetVersionResponse {
  PolicyVersion version = 1;
}

message ListVersionsRequest {
  string policy_id = 1;
  Branch branch = 2;
  string version_range = 3; // semver range
  google.protobuf.Timestamp from_date = 4;
  google.protobuf.Timestamp to_date = 5;
  string author = 6;
  ChangeType change_type = 7;
  int32 limit = 8;
  int32 offset = 9;
  string sort_by = 10; // version, created_at
  string sort_order = 11; // asc, desc
  bool include_content = 12;
}

message ListVersionsResponse {
  repeated PolicyVersion versions = 1;
  int32 total = 2;
  PaginationInfo pagination = 3;
}

message PaginationInfo {
  int32 limit = 1;
  int32 offset = 2;
  bool has_more = 3;
}

message DeleteVersionRequest {
  string policy_id = 1;
  string version = 2;
  bool soft_delete = 3;
}

message DeleteVersionResponse {
  bool success = 1;
}

message GetVersionDiffRequest {
  string policy_id = 1;
  string base_version = 2;
  string target_version = 3;
  DiffFormat format = 4;
  int32 context_lines = 5;
}

message GetVersionDiffResponse {
  VersionDiff diff = 1;
}

message RollbackRequest {
  string policy_id = 1;
  Branch branch = 2;
  string target_version = 3;
  string reason = 4;
  string author = 5;
  bool skip_validation = 6;
  bool dry_run = 7;
}

message RollbackResponse {
  bool success = 1;
  PolicyVersion commit = 2;
  RollbackPreview preview = 3;
  RollbackInfo rollback_info = 4;
}

message RollbackPreview {
  SemanticVersion current_version = 1;
  SemanticVersion target_version = 2;
  VersionDiff diff = 3;
  repeated string warnings = 4;
}

message RollbackInfo {
  string rolled_back_from = 1;
  string rolled_back_to = 2;
  string reason = 3;
  string author = 4;
  google.protobuf.Timestamp timestamp = 5;
}

message ListBranchesRequest {
  string policy_id = 1;
}

message ListBranchesResponse {
  repeated BranchInfo branches = 1;
}

message BranchInfo {
  Branch name = 1;
  string head_commit_id = 2;
  SemanticVersion head_version = 3;
  google.protobuf.Timestamp updated_at = 4;
  bool locked = 5;
  string locked_by = 6;
}

message GetBranchHeadRequest {
  string policy_id = 1;
  Branch branch = 2;
}

message GetBranchHeadResponse {
  PolicyVersion head = 1;
}

message PromoteVersionRequest {
  string policy_id = 1;
  Branch source_branch = 2;
  Branch target_branch = 3;
  string source_version = 4;
  string message = 5;
  string author = 6;
  ApprovalInfo approval = 7;
  bool skip_validation = 8;
}

message PromoteVersionResponse {
  bool success = 1;
  PolicyVersion commit = 2;
  PromotionInfo promotion = 3;
  ValidationResult validation = 4;
  PostActions post_actions = 5;
}

message PromotionInfo {
  Branch source_branch = 1;
  SemanticVersion source_version = 2;
  Branch target_branch = 3;
  SemanticVersion target_version = 4;
  google.protobuf.Timestamp promoted_at = 5;
  string promoted_by = 6;
}

message PostActions {
  bool hot_reload_triggered = 1;
  repeated string notifications_sent = 2;
  repeated string webhooks_triggered = 3;
}

message CompareBranchesRequest {
  string policy_id = 1;
  Branch base_branch = 2;
  Branch compare_branch = 3;
}

message CompareBranchesResponse {
  Branch base_branch = 1;
  Branch compare_branch = 2;
  int32 ahead_by = 3;
  int32 behind_by = 4;
  bool diverged = 5;
  string common_ancestor = 6;
  VersionDiff diff = 7;
}

message CreateTagRequest {
  string policy_id = 1;
  string tag_name = 2;
  string version = 3;
  string description = 4;
  string created_by = 5;
}

message CreateTagResponse {
  VersionTag tag = 1;
}

message VersionTag {
  string tag_name = 1;
  string policy_id = 2;
  string commit_id = 3;
  SemanticVersion version = 4;
  string description = 5;
  string created_by = 6;
  google.protobuf.Timestamp created_at = 7;
}

message ListTagsRequest {
  string policy_id = 1;
}

message ListTagsResponse {
  repeated VersionTag tags = 1;
}

message DeleteTagRequest {
  string policy_id = 1;
  string tag_name = 2;
}

message DeleteTagResponse {
  bool success = 1;
}

message WatchVersionChangesRequest {
  string policy_id = 1;
  Branch branch = 2;
}

message VersionChangeEvent {
  string event_type = 1; // created, promoted, rolled_back, deleted
  PolicyVersion version = 2;
  google.protobuf.Timestamp timestamp = 3;
}

message ValidationResult {
  bool valid = 1;
  repeated string errors = 2;
  repeated string warnings = 3;
}
```

---

## 8. Conflict Resolution

### 8.1 Conflict Detection

```typescript
interface ConflictDetectionResult {
  /** Whether conflicts exist */
  hasConflicts: boolean;

  /** List of detected conflicts */
  conflicts: MergeConflict[];

  /** Common ancestor commit */
  commonAncestor: string | null;
}

interface MergeConflict {
  /** JSON path where conflict occurs */
  path: string;

  /** Conflict type */
  type: 'modify-modify' | 'modify-delete' | 'add-add';

  /** Value in base version */
  baseValue: unknown;

  /** Value in source version */
  sourceValue: unknown;

  /** Value in target version */
  targetValue: unknown;

  /** Suggested resolution */
  suggestedResolution?: ConflictResolution;
}

interface ConflictResolution {
  /** Resolution strategy */
  strategy: 'use-source' | 'use-target' | 'merge' | 'manual';

  /** Resolved value (for merge strategy) */
  resolvedValue?: unknown;

  /** Explanation of resolution */
  explanation: string;
}

/**
 * Detect conflicts between two versions
 */
async function detectConflicts(
  sourceCommit: PolicyCommit,
  targetCommitId: string
): Promise<ConflictDetectionResult> {
  // 1. Find common ancestor
  const targetCommit = await getCommit(targetCommitId);
  const commonAncestor = await findCommonAncestor(
    sourceCommit.commitId,
    targetCommitId
  );

  if (!commonAncestor) {
    // No common ancestor - cannot merge
    return {
      hasConflicts: true,
      conflicts: [{
        path: '/',
        type: 'add-add',
        baseValue: null,
        sourceValue: sourceCommit.content,
        targetValue: targetCommit.content,
      }],
      commonAncestor: null,
    };
  }

  // 2. Get ancestor content
  const ancestorCommit = await getCommit(commonAncestor);

  // 3. Three-way diff
  const sourceChanges = await generateJsonPatch(
    ancestorCommit.content,
    sourceCommit.content
  );
  const targetChanges = await generateJsonPatch(
    ancestorCommit.content,
    targetCommit.content
  );

  // 4. Find conflicting paths
  const conflicts: MergeConflict[] = [];

  for (const sourceOp of sourceChanges) {
    for (const targetOp of targetChanges) {
      if (pathsOverlap(sourceOp.path, targetOp.path)) {
        const conflict = analyzeConflict(
          sourceOp,
          targetOp,
          ancestorCommit.content
        );
        if (conflict) {
          conflicts.push(conflict);
        }
      }
    }
  }

  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
    commonAncestor,
  };
}
```

### 8.2 Merge Strategies

```typescript
type MergeStrategy =
  | 'source-wins'      // Source changes take precedence
  | 'target-wins'      // Target changes take precedence
  | 'auto-merge'       // Attempt automatic merge
  | 'manual';          // Require manual resolution

interface MergeOptions {
  /** Merge strategy */
  strategy: MergeStrategy;

  /** Manual resolutions for conflicts */
  resolutions?: Record<string, ConflictResolution>;

  /** Whether to allow partial merge */
  allowPartial?: boolean;
}

interface MergeResult {
  /** Whether merge was successful */
  success: boolean;

  /** Merged content */
  content?: PolicyContent;

  /** Unresolved conflicts */
  unresolvedConflicts?: MergeConflict[];

  /** Applied resolutions */
  appliedResolutions: {
    path: string;
    strategy: string;
  }[];
}

/**
 * Merge two policy versions
 */
async function mergeVersions(
  sourceCommit: PolicyCommit,
  targetCommit: PolicyCommit,
  options: MergeOptions
): Promise<MergeResult> {
  // 1. Detect conflicts
  const conflictResult = await detectConflicts(sourceCommit, targetCommit.commitId);

  // 2. If no conflicts, simple merge
  if (!conflictResult.hasConflicts) {
    const mergedContent = applyChanges(
      targetCommit.content,
      await generateJsonPatch(targetCommit.content, sourceCommit.content)
    );
    return {
      success: true,
      content: mergedContent,
      appliedResolutions: [],
    };
  }

  // 3. Apply merge strategy
  const appliedResolutions: { path: string; strategy: string }[] = [];
  const unresolvedConflicts: MergeConflict[] = [];
  let mergedContent = deepClone(targetCommit.content);

  for (const conflict of conflictResult.conflicts) {
    let resolution: ConflictResolution | undefined;

    // Check for manual resolution
    if (options.resolutions?.[conflict.path]) {
      resolution = options.resolutions[conflict.path];
    } else {
      // Apply automatic strategy
      switch (options.strategy) {
        case 'source-wins':
          resolution = {
            strategy: 'use-source',
            resolvedValue: conflict.sourceValue,
            explanation: 'Source version takes precedence',
          };
          break;

        case 'target-wins':
          resolution = {
            strategy: 'use-target',
            resolvedValue: conflict.targetValue,
            explanation: 'Target version takes precedence',
          };
          break;

        case 'auto-merge':
          resolution = attemptAutoMerge(conflict);
          break;

        case 'manual':
          unresolvedConflicts.push(conflict);
          continue;
      }
    }

    if (resolution) {
      mergedContent = applyResolution(mergedContent, conflict.path, resolution);
      appliedResolutions.push({
        path: conflict.path,
        strategy: resolution.strategy,
      });
    }
  }

  // 4. Check if all conflicts resolved
  if (unresolvedConflicts.length > 0 && !options.allowPartial) {
    return {
      success: false,
      unresolvedConflicts,
      appliedResolutions,
    };
  }

  return {
    success: unresolvedConflicts.length === 0,
    content: mergedContent,
    unresolvedConflicts: unresolvedConflicts.length > 0 ? unresolvedConflicts : undefined,
    appliedResolutions,
  };
}

/**
 * Attempt automatic merge for a conflict
 */
function attemptAutoMerge(conflict: MergeConflict): ConflictResolution | null {
  // Array concatenation for non-overlapping additions
  if (
    Array.isArray(conflict.sourceValue) &&
    Array.isArray(conflict.targetValue) &&
    conflict.type === 'add-add'
  ) {
    return {
      strategy: 'merge',
      resolvedValue: [...conflict.targetValue, ...conflict.sourceValue],
      explanation: 'Concatenated arrays from both versions',
    };
  }

  // Object merge for non-overlapping keys
  if (
    isObject(conflict.sourceValue) &&
    isObject(conflict.targetValue) &&
    !hasOverlappingKeys(conflict.sourceValue, conflict.targetValue)
  ) {
    return {
      strategy: 'merge',
      resolvedValue: { ...conflict.targetValue, ...conflict.sourceValue },
      explanation: 'Merged objects with non-overlapping keys',
    };
  }

  // Cannot auto-merge
  return null;
}
```

---

## 9. Audit Trail

### 9.1 Audit Event Types

```typescript
type VersionAuditEventType =
  | 'version.created'
  | 'version.deleted'
  | 'version.rollback'
  | 'branch.head_updated'
  | 'branch.locked'
  | 'branch.unlocked'
  | 'promotion.requested'
  | 'promotion.approved'
  | 'promotion.rejected'
  | 'promotion.completed'
  | 'tag.created'
  | 'tag.deleted'
  | 'conflict.detected'
  | 'merge.completed';

interface VersionAuditEvent {
  /** Unique event ID */
  eventId: string;

  /** Event type */
  eventType: VersionAuditEventType;

  /** Timestamp */
  timestamp: Date;

  /** Actor who performed the action */
  actor: {
    id: string;
    type: 'user' | 'system' | 'api_key';
    email?: string;
    ip?: string;
  };

  /** Policy context */
  policy: {
    id: string;
    name?: string;
  };

  /** Version context */
  version?: {
    commitId: string;
    versionString: string;
    branch: PolicyBranch;
  };

  /** Event-specific details */
  details: Record<string, unknown>;

  /** Request metadata */
  request?: {
    requestId: string;
    method: string;
    path: string;
    userAgent?: string;
  };
}
```

### 9.2 Audit Logging Implementation

```typescript
interface AuditLogger {
  /** Log a version audit event */
  log(event: VersionAuditEvent): Promise<void>;

  /** Query audit events */
  query(filter: AuditQueryFilter): Promise<AuditQueryResult>;

  /** Export audit events */
  export(filter: AuditQueryFilter, format: 'json' | 'csv'): Promise<Buffer>;
}

interface AuditQueryFilter {
  policyId?: string;
  eventTypes?: VersionAuditEventType[];
  actorId?: string;
  fromDate?: Date;
  toDate?: Date;
  branch?: PolicyBranch;
  limit?: number;
  offset?: number;
}

interface AuditQueryResult {
  events: VersionAuditEvent[];
  total: number;
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

/**
 * Audit logger implementation with Kafka backend
 */
class KafkaAuditLogger implements AuditLogger {
  constructor(
    private kafka: Kafka,
    private config: AuditLoggerConfig
  ) {}

  async log(event: VersionAuditEvent): Promise<void> {
    const producer = this.kafka.producer();
    await producer.connect();

    try {
      await producer.send({
        topic: this.config.topic,
        messages: [
          {
            key: event.policy.id,
            value: JSON.stringify(event),
            headers: {
              eventType: event.eventType,
              timestamp: event.timestamp.toISOString(),
            },
          },
        ],
      });
    } finally {
      await producer.disconnect();
    }
  }

  async query(filter: AuditQueryFilter): Promise<AuditQueryResult> {
    // Query from time-series database (e.g., TimescaleDB, ClickHouse)
    // Implementation depends on audit storage backend
    throw new Error('Not implemented');
  }

  async export(filter: AuditQueryFilter, format: 'json' | 'csv'): Promise<Buffer> {
    const result = await this.query({ ...filter, limit: 100000 });
    // Format and return
    throw new Error('Not implemented');
  }
}
```

### 9.3 Audit Event Examples

```json
// Version Created Event
{
  "eventId": "evt_01HQ5N2KPXYZ",
  "eventType": "version.created",
  "timestamp": "2024-11-23T10:30:00Z",
  "actor": {
    "id": "user_123",
    "type": "user",
    "email": "dev@example.com",
    "ip": "192.168.1.100"
  },
  "policy": {
    "id": "avatar-policy",
    "name": "Avatar Resource Policy"
  },
  "version": {
    "commitId": "abc123def456",
    "versionString": "1.2.0",
    "branch": "draft"
  },
  "details": {
    "changeType": "feature",
    "message": "Add rate limiting rules",
    "parentVersion": "1.1.0",
    "affectedRules": ["rule_1", "rule_2"]
  },
  "request": {
    "requestId": "req_xyz789",
    "method": "POST",
    "path": "/api/v1/policies/avatar-policy/versions",
    "userAgent": "AuthZ-SDK/1.0"
  }
}

// Promotion Completed Event
{
  "eventId": "evt_01HQ5N3ABCDE",
  "eventType": "promotion.completed",
  "timestamp": "2024-11-23T11:00:00Z",
  "actor": {
    "id": "user_456",
    "type": "user",
    "email": "admin@example.com"
  },
  "policy": {
    "id": "avatar-policy"
  },
  "version": {
    "commitId": "def789ghi012",
    "versionString": "1.2.0",
    "branch": "production"
  },
  "details": {
    "sourceBranch": "staging",
    "sourceVersion": "1.2.0-rc.1",
    "approvedBy": "user_789",
    "approvalComment": "Tested in staging, ready for prod",
    "hotReloadTriggered": true,
    "affectedInstances": 5
  }
}

// Rollback Event
{
  "eventId": "evt_01HQ5N4FGHIJ",
  "eventType": "version.rollback",
  "timestamp": "2024-11-23T12:00:00Z",
  "actor": {
    "id": "user_789",
    "type": "user",
    "email": "oncall@example.com"
  },
  "policy": {
    "id": "avatar-policy"
  },
  "version": {
    "commitId": "jkl345mno678",
    "versionString": "1.2.1",
    "branch": "production"
  },
  "details": {
    "rolledBackFrom": "1.2.0",
    "rolledBackTo": "1.1.0",
    "reason": "Production incident - permission escalation bug",
    "skipValidation": false,
    "incidentId": "INC-2024-1123"
  }
}
```

---

## 10. Migration Path

### 10.1 Migration Strategy

```typescript
interface MigrationConfig {
  /** Source of unversioned policies */
  source: {
    type: 'filesystem' | 'database' | 'git';
    config: Record<string, unknown>;
  };

  /** Target versioning system */
  target: {
    connectionString: string;
    initialBranch: PolicyBranch;
  };

  /** Migration options */
  options: {
    /** Dry run mode */
    dryRun: boolean;

    /** Initial version for all policies */
    initialVersion: SemanticVersion;

    /** Author for migration commits */
    migrationAuthor: string;

    /** Batch size for processing */
    batchSize: number;

    /** Continue on individual policy errors */
    continueOnError: boolean;

    /** Create backup before migration */
    createBackup: boolean;
  };
}

interface MigrationResult {
  /** Migration status */
  status: 'success' | 'partial' | 'failed';

  /** Policies migrated */
  migrated: MigratedPolicy[];

  /** Policies that failed */
  failed: FailedPolicy[];

  /** Migration statistics */
  stats: {
    totalPolicies: number;
    successCount: number;
    failureCount: number;
    durationMs: number;
    backupLocation?: string;
  };
}

interface MigratedPolicy {
  policyId: string;
  commitId: string;
  version: SemanticVersion;
  sourceLocation: string;
}

interface FailedPolicy {
  policyId: string;
  sourceLocation: string;
  error: string;
  recoverable: boolean;
}
```

### 10.2 Migration Process

```typescript
/**
 * Migrate unversioned policies to versioned system
 */
async function migrateToVersionedPolicies(
  config: MigrationConfig
): Promise<MigrationResult> {
  const startTime = Date.now();
  const migrated: MigratedPolicy[] = [];
  const failed: FailedPolicy[] = [];

  // 1. Create backup if requested
  let backupLocation: string | undefined;
  if (config.options.createBackup) {
    backupLocation = await createMigrationBackup(config.source);
    logger.info({ backupLocation }, 'Created migration backup');
  }

  // 2. Load unversioned policies
  const sourcePolicies = await loadUnversionedPolicies(config.source);
  logger.info({ count: sourcePolicies.length }, 'Loaded unversioned policies');

  // 3. Validate all policies first
  for (const policy of sourcePolicies) {
    const validation = await validatePolicy(policy.content, config.target.initialBranch);
    if (!validation.valid) {
      failed.push({
        policyId: policy.id,
        sourceLocation: policy.source,
        error: validation.errors.join('; '),
        recoverable: true,
      });

      if (!config.options.continueOnError) {
        throw new MigrationValidationError(policy.id, validation.errors);
      }
    }
  }

  // 4. Filter to valid policies
  const validPolicies = sourcePolicies.filter(
    p => !failed.some(f => f.policyId === p.id)
  );

  // 5. Migrate in batches
  for (let i = 0; i < validPolicies.length; i += config.options.batchSize) {
    const batch = validPolicies.slice(i, i + config.options.batchSize);

    if (config.options.dryRun) {
      // Dry run - just validate and report
      for (const policy of batch) {
        logger.info({
          policyId: policy.id,
          wouldCreate: formatVersion(config.options.initialVersion),
        }, 'Dry run: would migrate policy');

        migrated.push({
          policyId: policy.id,
          commitId: 'dry-run',
          version: config.options.initialVersion,
          sourceLocation: policy.source,
        });
      }
    } else {
      // Actual migration
      const batchResults = await Promise.allSettled(
        batch.map(policy => migratePolicy(policy, config))
      );

      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        const policy = batch[j];

        if (result.status === 'fulfilled') {
          migrated.push(result.value);
        } else {
          failed.push({
            policyId: policy.id,
            sourceLocation: policy.source,
            error: result.reason.message,
            recoverable: false,
          });

          if (!config.options.continueOnError) {
            throw result.reason;
          }
        }
      }
    }

    logger.info({
      progress: Math.min(i + config.options.batchSize, validPolicies.length),
      total: validPolicies.length,
    }, 'Migration progress');
  }

  // 6. Return results
  const durationMs = Date.now() - startTime;

  return {
    status: failed.length === 0 ? 'success' : migrated.length > 0 ? 'partial' : 'failed',
    migrated,
    failed,
    stats: {
      totalPolicies: sourcePolicies.length,
      successCount: migrated.length,
      failureCount: failed.length,
      durationMs,
      backupLocation,
    },
  };
}

/**
 * Migrate a single policy
 */
async function migratePolicy(
  policy: UnversionedPolicy,
  config: MigrationConfig
): Promise<MigratedPolicy> {
  const version = config.options.initialVersion;

  const createRequest: CreateVersionRequest = {
    policyId: policy.id,
    branch: config.target.initialBranch,
    content: policy.content,
    message: `Migration from unversioned policy (source: ${policy.source})`,
    changeType: 'feature',
    author: config.options.migrationAuthor,
    labels: {
      migration: 'true',
      migrationSource: policy.source,
      migrationDate: new Date().toISOString(),
    },
  };

  const result = await createVersion(createRequest);

  return {
    policyId: policy.id,
    commitId: result.commit.commitId,
    version: result.commit.version,
    sourceLocation: policy.source,
  };
}
```

### 10.3 Rollback Migration

```typescript
/**
 * Rollback a failed migration
 */
async function rollbackMigration(
  backupLocation: string,
  config: MigrationConfig
): Promise<void> {
  logger.warn({ backupLocation }, 'Rolling back migration');

  // 1. Verify backup exists
  const backupExists = await checkBackupExists(backupLocation);
  if (!backupExists) {
    throw new MigrationRollbackError('Backup not found');
  }

  // 2. Delete migrated versions
  const migratedPolicies = await listMigratedPolicies(config.target);
  for (const policy of migratedPolicies) {
    await hardDeleteVersions(policy.policyId, config.target.initialBranch);
  }

  // 3. Restore from backup
  await restoreFromBackup(backupLocation, config.source);

  logger.info('Migration rollback completed');
}
```

---

## 11. Testing Strategy

### 11.1 Unit Tests

| Component | Coverage Target | Test File |
|-----------|-----------------|-----------|
| SemanticVersion | 95% | `tests/version/semantic-version.test.ts` |
| PolicyCommit | 90% | `tests/version/policy-commit.test.ts` |
| DiffEngine | 90% | `tests/version/diff-engine.test.ts` |
| VersionStore | 85% | `tests/version/version-store.test.ts` |
| BranchManager | 90% | `tests/version/branch-manager.test.ts` |
| ConflictDetector | 90% | `tests/version/conflict-detector.test.ts` |
| PromotionEngine | 85% | `tests/version/promotion-engine.test.ts` |

### 11.2 Integration Tests

| Scenario | Components Involved | Test File |
|----------|---------------------|-----------|
| Full version lifecycle | VersionStore, BranchManager | `tests/integration/version-lifecycle.test.ts` |
| Promotion workflow | PromotionEngine, AuditLogger | `tests/integration/promotion-workflow.test.ts` |
| Rollback with validation | VersionStore, PolicyValidator | `tests/integration/rollback-flow.test.ts` |
| Conflict resolution | ConflictDetector, MergeEngine | `tests/integration/merge-conflicts.test.ts` |
| Migration process | MigrationEngine, VersionStore | `tests/integration/migration.test.ts` |

### 11.3 Test Scenarios

```typescript
describe('PolicyVersionManager', () => {
  describe('createVersion', () => {
    it('should create initial version with v1.0.0', async () => {
      const result = await versionManager.createVersion({
        policyId: 'test-policy',
        branch: 'draft',
        content: testPolicyContent,
        message: 'Initial policy',
        changeType: 'feature',
        author: 'test-user',
      });

      expect(result.commit.version).toEqual({
        major: 1,
        minor: 0,
        patch: 0,
      });
      expect(result.commit.parentCommitId).toBeNull();
    });

    it('should increment minor version for feature changes', async () => {
      // Create initial version
      await createInitialVersion();

      const result = await versionManager.createVersion({
        policyId: 'test-policy',
        branch: 'draft',
        content: modifiedPolicyContent,
        versionHint: 'minor',
        message: 'Add new rule',
        changeType: 'feature',
        author: 'test-user',
      });

      expect(result.commit.version.minor).toBe(1);
    });

    it('should reject invalid policy content', async () => {
      await expect(
        versionManager.createVersion({
          policyId: 'test-policy',
          branch: 'draft',
          content: invalidPolicyContent,
          message: 'Invalid policy',
          changeType: 'feature',
          author: 'test-user',
        })
      ).rejects.toThrow(PolicyValidationError);
    });
  });

  describe('promoteVersion', () => {
    it('should promote from draft to staging', async () => {
      await createDraftVersion();

      const result = await versionManager.promoteVersion({
        policyId: 'test-policy',
        sourceBranch: 'draft',
        targetBranch: 'staging',
        message: 'Promote to staging',
        author: 'test-user',
        approval: { approver: 'approver-user' },
      });

      expect(result.success).toBe(true);
      expect(result.commit.branch).toBe('staging');
      expect(result.commit.version.prerelease).toContain('rc');
    });

    it('should reject promotion without required approval', async () => {
      await createDraftVersion();

      await expect(
        versionManager.promoteVersion({
          policyId: 'test-policy',
          sourceBranch: 'staging',
          targetBranch: 'production',
          message: 'Promote to production',
          author: 'test-user',
          // No approval provided
        })
      ).rejects.toThrow(ApprovalRequiredError);
    });
  });

  describe('rollbackToVersion', () => {
    it('should rollback to previous version', async () => {
      const v1 = await createVersion('1.0.0');
      const v2 = await createVersion('1.1.0');

      const result = await versionManager.rollbackToVersion({
        policyId: 'test-policy',
        branch: 'draft',
        targetVersion: '1.0.0',
        reason: 'Bug in v1.1.0',
        author: 'test-user',
      });

      expect(result.success).toBe(true);
      expect(result.commit.content).toEqual(v1.content);
      expect(result.commit.version.patch).toBe(2); // v1.1.1
    });

    it('should emit rollback audit event', async () => {
      const auditSpy = jest.spyOn(auditLogger, 'log');

      await versionManager.rollbackToVersion({
        policyId: 'test-policy',
        branch: 'draft',
        targetVersion: '1.0.0',
        reason: 'Test rollback',
        author: 'test-user',
      });

      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'version.rollback',
        })
      );
    });
  });
});
```

### 11.4 Performance Tests

| Test | Target | Test File |
|------|--------|-----------|
| Version creation latency | < 50ms p99 | `tests/performance/version-create.perf.ts` |
| Version list (1000 versions) | < 100ms | `tests/performance/version-list.perf.ts` |
| Diff generation (10KB policy) | < 200ms | `tests/performance/diff-generate.perf.ts` |
| Concurrent version creates | 100 ops/sec | `tests/performance/concurrent.perf.ts` |

---

## 12. Related Documents

- [STORAGE-DRIVERS-SDD.md](./STORAGE-DRIVERS-SDD.md) - Storage layer integration
- [CORE-PACKAGE-SDD.md](./CORE-PACKAGE-SDD.md) - Core policy types
- [OBSERVABILITY-SDD.md](./OBSERVABILITY-SDD.md) - Audit and metrics integration
- [POLICY-TESTING-SDD.md](./POLICY-TESTING-SDD.md) - Policy validation
- [SERVER-PACKAGE-SDD.md](./SERVER-PACKAGE-SDD.md) - API server integration
- [COMPLIANCE-SECURITY-SDD.md](./COMPLIANCE-SECURITY-SDD.md) - Compliance requirements

---

## 13. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-11-23 | Initial draft - comprehensive policy versioning design |
