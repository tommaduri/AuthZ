# Storage Drivers - Software Design Document

**Module**: `@authz-engine/core` (storage subsystem)
**Version**: 1.0.0
**Status**: Draft
**Author**: AuthZ Engine Team
**Created**: 2024-11-23
**Last Updated**: 2024-11-23
**Reviewers**: TBD

---

## 1. Overview

### 1.1 Purpose

Storage drivers abstract the persistence layer for policies, enabling deployment flexibility. Policies can be loaded from local files, Git repositories, databases, or cloud storage, allowing organizations to choose the storage backend that best fits their infrastructure and workflow requirements.

### 1.2 Scope

**In Scope:**
- Driver interface definition
- FileSystem driver (local YAML/JSON files)
- Git driver (repository-based policies)
- Database driver (PostgreSQL/MySQL)
- Blob storage driver (S3/GCS/Azure Blob)
- Hot reload mechanism with change detection
- Multi-source composition and priority ordering

**Out of Scope:**
- Policy authoring/editing capabilities
- Version control UI
- Policy validation logic (handled by core)
- Access control to storage backends

### 1.3 Context

The storage driver system sits between the PolicyLoader and the actual persistence layer. It provides a unified interface for policy retrieval regardless of where policies are stored, enabling organizations to migrate between storage backends without code changes.

```
┌─────────────────────────────────────────────────────────────┐
│                    PolicyLoader                              │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  StorageDriver Interface                     │
├─────────────┬─────────────┬──────────────┬──────────────────┤
│  FileSystem │    Git      │   Database   │   BlobStorage    │
│   Driver    │   Driver    │    Driver    │     Driver       │
└─────────────┴─────────────┴──────────────┴──────────────────┘
```

### 1.4 Key Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Pull-based architecture | Simpler than push; drivers poll for changes | Webhook-based push, event sourcing |
| Async iterator for watch | Memory efficient for large policy sets | Callback-based, RxJS observables |
| Composition over inheritance | Flexible multi-source scenarios | Single driver per deployment |
| YAML as primary format | Human-readable, Cerbos compatible | JSON-only, TOML, HCL |

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-001 | Load policies from local filesystem | Must Have | Planned |
| FR-002 | Load policies from Git repositories | Must Have | Planned |
| FR-003 | Load policies from PostgreSQL/MySQL | Should Have | Planned |
| FR-004 | Load policies from S3/GCS/Azure Blob | Should Have | Planned |
| FR-005 | Detect and notify on policy changes | Must Have | Planned |
| FR-006 | Support atomic policy updates | Must Have | Planned |
| FR-007 | Rollback on validation failure | Must Have | Planned |
| FR-008 | Compose multiple storage sources | Should Have | Planned |
| FR-009 | Health check for driver connectivity | Must Have | Planned |

### 2.2 Non-Functional Requirements

| ID | Category | Requirement | Target |
|----|----------|-------------|--------|
| NFR-001 | Performance | Initial policy load | < 5s for 1000 policies |
| NFR-002 | Performance | Change detection latency | < 1s (filesystem), < 60s (Git) |
| NFR-003 | Reliability | Driver reconnection | Auto-retry with backoff |
| NFR-004 | Availability | Graceful degradation | Serve cached policies on failure |
| NFR-005 | Memory | Policy cache size | < 100MB for 10,000 policies |

---

## 3. Architecture

### 3.1 Component Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                      Storage Driver System                          │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                   CompositeDriver                            │  │
│  │  - Priority ordering                                         │  │
│  │  - Merge strategies                                          │  │
│  │  - Conflict resolution                                       │  │
│  └─────────────────────────┬───────────────────────────────────┘  │
│                            │                                       │
│         ┌──────────────────┼──────────────────┐                   │
│         │                  │                  │                   │
│         ▼                  ▼                  ▼                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │  FileSystem  │  │    Git       │  │  Database    │            │
│  │    Driver    │  │   Driver     │  │   Driver     │            │
│  │              │  │              │  │              │            │
│  │ - chokidar   │  │ - simple-git │  │ - pg/mysql2  │            │
│  │ - debounce   │  │ - polling    │  │ - polling    │            │
│  └──────────────┘  └──────────────┘  └──────────────┘            │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                   ChangeDetector                             │  │
│  │  - File hash comparison                                      │  │
│  │  - Git commit tracking                                       │  │
│  │  - Database timestamp polling                                │  │
│  │  - Event debouncing                                          │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow

```
1. Initialization
   ┌─────────────┐     ┌──────────────┐     ┌───────────────┐
   │   Server    │────▶│ StorageDriver │────▶│ Backend Store │
   │   Startup   │     │    init()     │     │   Connect     │
   └─────────────┘     └──────────────┘     └───────────────┘

2. Policy Loading
   ┌─────────────┐     ┌──────────────┐     ┌───────────────┐
   │ PolicyLoader│────▶│ getAllPolicies│────▶│ Parse & Cache │
   └─────────────┘     └──────────────┘     └───────────────┘

3. Change Detection
   ┌─────────────┐     ┌──────────────┐     ┌───────────────┐
   │  Backend    │────▶│  Watcher     │────▶│ PolicyChange  │
   │  Change     │     │  Detects     │     │   Event       │
   └─────────────┘     └──────────────┘     └───────────────┘
                                                   │
                                                   ▼
                                            ┌───────────────┐
                                            │  Validate &   │
                                            │  Hot Reload   │
                                            └───────────────┘
```

### 3.3 Integration Points

| Integration | Protocol | Direction |
|-------------|----------|-----------|
| Local Filesystem | fs/chokidar | In |
| Git Repository | HTTP/SSH | In |
| PostgreSQL | TCP | Both |
| MySQL | TCP | Both |
| AWS S3 | HTTPS | In |
| Google Cloud Storage | HTTPS | In |
| Azure Blob Storage | HTTPS | In |

---

## 4. Interfaces

### 4.1 Core Driver Interface

```typescript
/**
 * Storage driver interface for policy persistence
 * All drivers must implement this interface
 */
interface StorageDriver {
  /** Unique identifier for this driver instance */
  readonly id: string;

  /** Driver type (filesystem, git, database, blob) */
  readonly type: StorageDriverType;

  /**
   * Initialize the driver and establish connections
   * @throws StorageDriverError if initialization fails
   */
  init(): Promise<void>;

  /**
   * List all available policies with metadata
   * @returns Array of policy metadata without full content
   */
  listPolicies(): Promise<PolicyMetadata[]>;

  /**
   * Get a specific policy by ID
   * @param id - Policy identifier
   * @returns Policy if found, null otherwise
   */
  getPolicy(id: string): Promise<Policy | null>;

  /**
   * Get all policies from this driver
   * @returns Array of all policies
   */
  getAllPolicies(): Promise<Policy[]>;

  /**
   * Subscribe to policy changes
   * @param callback - Function called when policies change
   * @returns Unsubscribe function
   */
  watch(callback: PolicyChangeCallback): Unsubscribe;

  /**
   * Check driver health and connectivity
   * @returns Health status with details
   */
  healthCheck(): Promise<HealthStatus>;

  /**
   * Gracefully close connections and stop watching
   */
  close(): Promise<void>;
}

type StorageDriverType = 'filesystem' | 'git' | 'database' | 'blob';
```

### 4.2 Policy Types

```typescript
interface PolicyMetadata {
  /** Unique policy identifier */
  id: string;

  /** Policy name from metadata */
  name: string;

  /** Policy version */
  version: string;

  /** Policy kind (resourcePolicy, derivedRoles, principalPolicy) */
  kind: PolicyKind;

  /** Source file/location */
  source: string;

  /** Last modification timestamp */
  lastModified: Date;

  /** Content hash for change detection */
  contentHash: string;
}

type PolicyKind = 'resourcePolicy' | 'derivedRoles' | 'principalPolicy' | 'exportVariables';

interface Policy extends PolicyMetadata {
  /** Full policy content */
  content: ResourcePolicy | DerivedRolesPolicy | PrincipalPolicy;

  /** Raw YAML/JSON string */
  rawContent: string;
}
```

### 4.3 Change Events

```typescript
interface PolicyChangeEvent {
  /** Type of change */
  type: 'added' | 'modified' | 'deleted';

  /** Affected policy ID */
  policyId: string;

  /** New/modified policy (undefined for deletions) */
  policy?: Policy;

  /** Previous policy content (for modifications) */
  previousPolicy?: Policy;

  /** Change timestamp */
  timestamp: Date;

  /** Source driver ID */
  driverId: string;
}

type PolicyChangeCallback = (event: PolicyChangeEvent) => void;
type Unsubscribe = () => void;
```

### 4.4 Health Status

```typescript
interface HealthStatus {
  /** Overall health status */
  status: 'healthy' | 'degraded' | 'unhealthy';

  /** Human-readable message */
  message: string;

  /** Driver-specific details */
  details: {
    connected: boolean;
    lastSync?: Date;
    policiesLoaded: number;
    errors?: string[];
    latencyMs?: number;
  };
}
```

---

## 5. Built-in Drivers

### 5.1 FileSystemDriver

Loads policies from local filesystem with file watching support.

#### Configuration

```typescript
interface FileSystemDriverConfig {
  /** Directories to scan for policies */
  paths: string[];

  /** File extensions to include */
  extensions?: string[];  // Default: ['.yaml', '.yml', '.json']

  /** Enable file watching */
  watch?: boolean;        // Default: true

  /** Debounce interval for file changes (ms) */
  watchDebounce?: number; // Default: 1000

  /** Recursive directory scanning */
  recursive?: boolean;    // Default: true

  /** Glob patterns to exclude */
  exclude?: string[];     // Default: ['**/node_modules/**', '**/.git/**']
}
```

#### Implementation Details

```typescript
class FileSystemDriver implements StorageDriver {
  readonly id: string;
  readonly type = 'filesystem' as const;

  private watcher?: FSWatcher;
  private policies: Map<string, Policy> = new Map();
  private changeCallbacks: Set<PolicyChangeCallback> = new Set();

  constructor(private config: FileSystemDriverConfig) {
    this.id = `fs-${config.paths.join('-')}`;
  }

  async init(): Promise<void> {
    // Scan directories and load initial policies
    await this.scanDirectories();

    // Start file watcher if enabled
    if (this.config.watch !== false) {
      this.startWatcher();
    }
  }

  // ... implementation
}
```

#### Change Detection Strategy

- Uses `chokidar` for cross-platform file watching
- Debounces rapid file changes (default: 1000ms)
- Computes content hash to detect actual changes
- Handles add/change/unlink events

### 5.2 GitDriver

Loads policies from Git repositories with polling-based change detection.

#### Configuration

```typescript
interface GitDriverConfig {
  /** Repository URL (HTTPS or SSH) */
  repository: string;

  /** Branch to track */
  branch?: string;        // Default: 'main'

  /** Directory within repo containing policies */
  directory?: string;     // Default: '/'

  /** Polling interval in seconds */
  pollInterval?: number;  // Default: 60

  /** Authentication configuration */
  auth?: GitAuthConfig;

  /** Local clone directory */
  localPath?: string;     // Default: temp directory

  /** File extensions to include */
  extensions?: string[];  // Default: ['.yaml', '.yml', '.json']
}

interface GitAuthConfig {
  type: 'ssh' | 'token' | 'basic';
  credentials: SshCredentials | TokenCredentials | BasicCredentials;
}

interface SshCredentials {
  privateKey: string;
  passphrase?: string;
}

interface TokenCredentials {
  token: string;
}

interface BasicCredentials {
  username: string;
  password: string;
}
```

#### Implementation Details

```typescript
class GitDriver implements StorageDriver {
  readonly id: string;
  readonly type = 'git' as const;

  private git: SimpleGit;
  private currentCommit: string = '';
  private pollTimer?: NodeJS.Timer;
  private policies: Map<string, Policy> = new Map();

  constructor(private config: GitDriverConfig) {
    this.id = `git-${config.repository}-${config.branch ?? 'main'}`;
  }

  async init(): Promise<void> {
    // Clone or pull repository
    await this.cloneOrPull();

    // Load policies from local clone
    await this.loadPolicies();

    // Start polling for changes
    this.startPolling();
  }

  private async checkForUpdates(): Promise<void> {
    await this.git.fetch();
    const remoteCommit = await this.getRemoteHead();

    if (remoteCommit !== this.currentCommit) {
      await this.git.pull();
      await this.detectChanges(this.currentCommit, remoteCommit);
      this.currentCommit = remoteCommit;
    }
  }

  // ... implementation
}
```

#### Change Detection Strategy

- Tracks current commit SHA
- Polls remote for new commits at configured interval
- Uses `git diff` to identify changed files
- Only processes policy files based on extensions

### 5.3 DatabaseDriver

Loads policies from PostgreSQL or MySQL databases.

#### Configuration

```typescript
interface DatabaseDriverConfig {
  /** Database connection string or config */
  connection: string | DatabaseConnectionConfig;

  /** Database type */
  dialect: 'postgresql' | 'mysql';

  /** Table name for policies */
  table?: string;         // Default: 'policies'

  /** Polling interval in seconds */
  pollInterval?: number;  // Default: 10

  /** Schema name (PostgreSQL) */
  schema?: string;        // Default: 'public'

  /** Use LISTEN/NOTIFY (PostgreSQL only) */
  useNotify?: boolean;    // Default: true
}

interface DatabaseConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean | TlsOptions;
  poolSize?: number;      // Default: 10
}
```

#### Database Schema

```sql
-- PostgreSQL schema
CREATE TABLE policies (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  version VARCHAR(50) NOT NULL,
  kind VARCHAR(50) NOT NULL,
  content JSONB NOT NULL,
  raw_content TEXT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP NULL
);

CREATE INDEX idx_policies_kind ON policies(kind);
CREATE INDEX idx_policies_updated_at ON policies(updated_at);

-- Trigger for NOTIFY on changes
CREATE OR REPLACE FUNCTION notify_policy_change()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('policy_changes', json_build_object(
    'operation', TG_OP,
    'policy_id', COALESCE(NEW.id, OLD.id)
  )::text);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER policy_change_trigger
AFTER INSERT OR UPDATE OR DELETE ON policies
FOR EACH ROW EXECUTE FUNCTION notify_policy_change();
```

#### Change Detection Strategy

- PostgreSQL: Uses LISTEN/NOTIFY for real-time updates
- MySQL: Polls `updated_at` column for changes
- Soft deletes via `deleted_at` column
- Atomic transactions for multi-policy updates

### 5.4 BlobStorageDriver

Loads policies from cloud blob storage (S3, GCS, Azure Blob).

#### Configuration

```typescript
interface BlobStorageDriverConfig {
  /** Cloud provider */
  provider: 's3' | 'gcs' | 'azure';

  /** Bucket/container name */
  bucket: string;

  /** Key prefix for policies */
  prefix?: string;        // Default: 'policies/'

  /** Polling interval in seconds */
  pollInterval?: number;  // Default: 60

  /** Cloud credentials */
  credentials: S3Credentials | GcsCredentials | AzureCredentials;

  /** File extensions to include */
  extensions?: string[];  // Default: ['.yaml', '.yml', '.json']
}

interface S3Credentials {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;      // For S3-compatible storage
}

interface GcsCredentials {
  projectId: string;
  keyFilename?: string;
  credentials?: object;   // Service account JSON
}

interface AzureCredentials {
  connectionString?: string;
  accountName?: string;
  accountKey?: string;
  sasToken?: string;
}
```

#### Change Detection Strategy

- Tracks ETags/version IDs for each object
- Lists objects with prefix at poll interval
- Compares ETags to detect modifications
- Handles eventual consistency with retries

---

## 6. Hot Reload Mechanism

### 6.1 Change Detection Flow

```
┌─────────────────┐
│  Driver Detects │
│     Change      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Debounce      │
│   (1000ms)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Parse Policy   │
│    Content      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│   Validate      │────▶│  Validation     │
│   Schema        │ No  │  Failed         │
└────────┬────────┘     └────────┬────────┘
         │ Yes                   │
         ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│  Stage Update   │     │   Log Error     │
│  (Transaction)  │     │   Keep Current  │
└────────┬────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐
│  Atomic Swap    │
│  Policy Cache   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Notify         │
│  Subscribers    │
└─────────────────┘
```

### 6.2 Atomic Policy Updates

```typescript
interface PolicyUpdateTransaction {
  /** Transaction ID for tracking */
  transactionId: string;

  /** Policies to add */
  additions: Policy[];

  /** Policies to update */
  modifications: Policy[];

  /** Policy IDs to remove */
  deletions: string[];

  /** Commit the transaction atomically */
  commit(): Promise<void>;

  /** Rollback all changes */
  rollback(): Promise<void>;
}

class PolicyCache {
  private currentPolicies: Map<string, Policy> = new Map();
  private stagedPolicies: Map<string, Policy> = new Map();

  beginTransaction(): PolicyUpdateTransaction {
    // Clone current state for staging
    this.stagedPolicies = new Map(this.currentPolicies);
    return new PolicyUpdateTransactionImpl(this);
  }

  commitTransaction(tx: PolicyUpdateTransaction): void {
    // Atomic swap
    this.currentPolicies = this.stagedPolicies;
    this.stagedPolicies = new Map();
  }

  rollbackTransaction(): void {
    this.stagedPolicies.clear();
  }
}
```

### 6.3 Rollback on Validation Failure

```typescript
async function handlePolicyChange(event: PolicyChangeEvent): Promise<void> {
  const tx = policyCache.beginTransaction();

  try {
    // Stage the change
    if (event.type === 'deleted') {
      tx.deletions.push(event.policyId);
    } else {
      // Validate before staging
      const validationResult = await validatePolicy(event.policy);
      if (!validationResult.valid) {
        throw new PolicyValidationError(validationResult.errors);
      }

      if (event.type === 'added') {
        tx.additions.push(event.policy);
      } else {
        tx.modifications.push(event.policy);
      }
    }

    // Commit atomically
    await tx.commit();

    // Notify subscribers
    notifySubscribers(event);

  } catch (error) {
    // Rollback and log
    await tx.rollback();
    logger.error({ error, event }, 'Policy update failed, rolled back');

    // Emit error event for monitoring
    emitErrorEvent({
      type: 'policy_validation_failed',
      policyId: event.policyId,
      error: error.message,
    });
  }
}
```

### 6.4 Client Notification

```typescript
interface HotReloadNotifier {
  /** Notify connected clients of policy changes */
  notifyClients(event: PolicyChangeEvent): Promise<void>;

  /** Subscribe to reload events (for SDK/clients) */
  subscribe(callback: ReloadCallback): Unsubscribe;
}

// Server-Sent Events endpoint
app.get('/api/policies/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');

  const unsubscribe = hotReloadNotifier.subscribe((event) => {
    res.write(`event: policy-change\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  req.on('close', unsubscribe);
});
```

---

## 7. Multi-Source Composition

### 7.1 CompositeDriver

```typescript
interface CompositeDriverConfig {
  /** Drivers in priority order (first = highest priority) */
  drivers: StorageDriver[];

  /** Merge strategy for overlapping policies */
  mergeStrategy: 'first-wins' | 'last-wins' | 'merge-rules';

  /** Conflict resolution handler */
  conflictResolver?: ConflictResolver;
}

type ConflictResolver = (
  policyId: string,
  policies: Policy[],
  drivers: string[]
) => Policy;

class CompositeDriver implements StorageDriver {
  readonly id = 'composite';
  readonly type = 'composite' as StorageDriverType;

  constructor(private config: CompositeDriverConfig) {}

  async getAllPolicies(): Promise<Policy[]> {
    const allPolicies = new Map<string, Policy>();
    const policyDrivers = new Map<string, string[]>();

    // Collect policies from all drivers
    for (const driver of this.config.drivers) {
      const policies = await driver.getAllPolicies();
      for (const policy of policies) {
        if (!policyDrivers.has(policy.id)) {
          policyDrivers.set(policy.id, []);
        }
        policyDrivers.get(policy.id)!.push(driver.id);

        // Apply merge strategy
        if (!allPolicies.has(policy.id)) {
          allPolicies.set(policy.id, policy);
        } else if (this.config.mergeStrategy === 'last-wins') {
          allPolicies.set(policy.id, policy);
        } else if (this.config.mergeStrategy === 'merge-rules') {
          const merged = this.mergePolicies(
            allPolicies.get(policy.id)!,
            policy
          );
          allPolicies.set(policy.id, merged);
        }
        // 'first-wins' keeps existing
      }
    }

    return Array.from(allPolicies.values());
  }

  watch(callback: PolicyChangeCallback): Unsubscribe {
    const unsubscribes = this.config.drivers.map(driver =>
      driver.watch((event) => {
        // Re-apply merge strategy on changes
        this.handleDriverChange(event, driver.id, callback);
      })
    );

    return () => unsubscribes.forEach(unsub => unsub());
  }
}
```

### 7.2 Merge Strategies

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| `first-wins` | First driver with policy wins | Base + overrides |
| `last-wins` | Last driver with policy wins | Layered policies |
| `merge-rules` | Combine rules from all sources | Additive policies |

### 7.3 Conflict Resolution

```typescript
// Example: Log conflicts and use highest version
const conflictResolver: ConflictResolver = (policyId, policies, drivers) => {
  logger.warn({
    policyId,
    drivers,
    versions: policies.map(p => p.version),
  }, 'Policy conflict detected');

  // Sort by semantic version, pick highest
  const sorted = policies.sort((a, b) =>
    semver.compare(b.version, a.version)
  );

  return sorted[0];
};
```

---

## 8. Configuration Examples

### 8.1 Filesystem Only

```yaml
storage:
  driver: filesystem
  filesystem:
    paths:
      - /etc/authz/policies
      - /app/policies
    extensions:
      - .yaml
      - .yml
    watch: true
    watchDebounce: 1000
    recursive: true
```

### 8.2 Git-Based (GitOps)

```yaml
storage:
  driver: git
  git:
    repository: https://github.com/org/authz-policies.git
    branch: main
    directory: policies/
    pollInterval: 60
    auth:
      type: token
      credentials:
        token: ${GITHUB_TOKEN}
```

### 8.3 Database-Backed

```yaml
storage:
  driver: database
  database:
    dialect: postgresql
    connection:
      host: ${PG_HOST}
      port: 5432
      database: authz
      user: ${PG_USER}
      password: ${PG_PASSWORD}
      ssl: true
    table: policies
    pollInterval: 10
    useNotify: true
```

### 8.4 Multi-Source Composition

```yaml
storage:
  driver: composite
  composite:
    mergeStrategy: first-wins
    drivers:
      # Local overrides (highest priority)
      - type: filesystem
        paths: [/app/policies/overrides]
        watch: true

      # Team policies from Git
      - type: git
        repository: git@github.com:org/team-policies.git
        branch: main
        pollInterval: 300

      # Base policies from database
      - type: database
        dialect: postgresql
        connection: ${DATABASE_URL}
```

---

## 9. Error Handling

### 9.1 Error Types

| Error Code | Name | Description | Recovery |
|------------|------|-------------|----------|
| SD-001 | ConnectionFailed | Cannot connect to storage backend | Retry with backoff |
| SD-002 | AuthenticationFailed | Invalid credentials | Check config |
| SD-003 | ParseError | Invalid policy format | Log and skip file |
| SD-004 | ValidationError | Policy schema invalid | Log and skip file |
| SD-005 | WatchError | File watcher failed | Restart watcher |
| SD-006 | TimeoutError | Operation timed out | Retry |
| SD-007 | NotFoundError | Policy/path not found | Log warning |

### 9.2 Error Hierarchy

```typescript
class StorageDriverError extends Error {
  constructor(
    message: string,
    public code: string,
    public driverId: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'StorageDriverError';
  }
}

class ConnectionError extends StorageDriverError {
  constructor(driverId: string, cause: Error) {
    super(
      `Failed to connect to storage: ${cause.message}`,
      'SD-001',
      driverId,
      { cause: cause.message }
    );
  }
}

class PolicyParseError extends StorageDriverError {
  constructor(driverId: string, source: string, cause: Error) {
    super(
      `Failed to parse policy from ${source}: ${cause.message}`,
      'SD-003',
      driverId,
      { source, cause: cause.message }
    );
  }
}
```

### 9.3 Partial Load Behavior

```typescript
interface LoadResult {
  /** Successfully loaded policies */
  policies: Policy[];

  /** Errors encountered during load */
  errors: PolicyLoadError[];

  /** Whether all policies loaded successfully */
  complete: boolean;
}

interface PolicyLoadError {
  source: string;
  error: StorageDriverError;
  recoverable: boolean;
}

// Partial load strategy
async function loadWithPartialFailure(
  driver: StorageDriver
): Promise<LoadResult> {
  const policies: Policy[] = [];
  const errors: PolicyLoadError[] = [];

  const sources = await driver.listPolicies();

  for (const metadata of sources) {
    try {
      const policy = await driver.getPolicy(metadata.id);
      if (policy) {
        policies.push(policy);
      }
    } catch (error) {
      errors.push({
        source: metadata.source,
        error: error as StorageDriverError,
        recoverable: isRecoverableError(error),
      });

      logger.warn({ error, source: metadata.source }, 'Failed to load policy');
    }
  }

  return {
    policies,
    errors,
    complete: errors.length === 0,
  };
}
```

---

## 10. Security Considerations

1. **Credential Management**: All credentials via environment variables or secret managers
2. **Network Security**: TLS for database connections, SSH for Git
3. **Access Control**: Principle of least privilege for storage access
4. **Audit Logging**: Log all policy changes with source attribution
5. **Input Validation**: Sanitize all policy content before parsing
6. **Path Traversal**: Prevent directory traversal in filesystem driver

---

## 11. Performance Requirements

| Metric | Target | Notes |
|--------|--------|-------|
| Initial load (1000 policies) | < 5s | Cold start |
| Incremental reload | < 500ms | Single policy change |
| Memory (10,000 policies) | < 100MB | Cached policies |
| Watch latency (filesystem) | < 1s | File change to event |
| Poll latency (Git/DB) | Configurable | Default 60s/10s |

---

## 12. Testing Strategy

### 12.1 Unit Tests

| Component | Coverage Target | Test File |
|-----------|-----------------|-----------|
| FileSystemDriver | 90% | `tests/drivers/filesystem.test.ts` |
| GitDriver | 85% | `tests/drivers/git.test.ts` |
| DatabaseDriver | 85% | `tests/drivers/database.test.ts` |
| CompositeDriver | 90% | `tests/drivers/composite.test.ts` |
| ChangeDetector | 90% | `tests/change-detector.test.ts` |

### 12.2 Integration Tests

| Scenario | Components | Test File |
|----------|------------|-----------|
| Hot reload | FileSystem + PolicyLoader | `tests/integration/hot-reload.test.ts` |
| Multi-source | CompositeDriver | `tests/integration/multi-source.test.ts` |
| Git sync | GitDriver + Remote | `tests/integration/git-sync.test.ts` |

---

## 13. Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `chokidar` | ^3.5.0 | File watching |
| `simple-git` | ^3.20.0 | Git operations |
| `pg` | ^8.11.0 | PostgreSQL client |
| `mysql2` | ^3.6.0 | MySQL client |
| `@aws-sdk/client-s3` | ^3.400.0 | S3 client |
| `@google-cloud/storage` | ^7.0.0 | GCS client |
| `@azure/storage-blob` | ^12.15.0 | Azure Blob client |
| `yaml` | ^2.3.0 | YAML parsing |

---

## 14. Related Documents

- [SERVER-PACKAGE-SDD.md](./SERVER-PACKAGE-SDD.md) - Server integration
- [CORE-PACKAGE-SDD.md](./CORE-PACKAGE-SDD.md) - Policy types
- [CERBOS-FEATURE-PARITY-SDD.md](./CERBOS-FEATURE-PARITY-SDD.md) - Feature requirements

---

## 15. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-11-23 | Initial draft |
