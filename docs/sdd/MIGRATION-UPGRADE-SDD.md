# Migration and Upgrade Strategy - Software Design Document

| Field | Value |
|-------|-------|
| **Document ID** | SDD-MIGRATION-001 |
| **Version** | 1.0.0 |
| **Status** | Draft |
| **Created** | 2025-01-15 |
| **Last Updated** | 2025-01-15 |
| **Author** | AuthZ Engine Team |
| **Reviewers** | Platform Team, SRE Team |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Migration Strategy Overview](#2-migration-strategy-overview)
3. [Version Compatibility](#3-version-compatibility)
4. [Database Migrations](#4-database-migrations)
5. [API Versioning](#5-api-versioning)
6. [Policy Migration](#6-policy-migration)
7. [Rolling Updates](#7-rolling-updates)
8. [Blue-Green Deployments](#8-blue-green-deployments)
9. [Canary Releases](#9-canary-releases)
10. [Rollback Procedures](#10-rollback-procedures)
11. [Data Migration](#11-data-migration)
12. [Testing Strategy](#12-testing-strategy)

---

## 1. Executive Summary

### 1.1 Purpose

This document defines the migration and upgrade strategy for the AuthZ Engine, covering version upgrades, database migrations, API versioning, and safe deployment practices to ensure zero-downtime updates and reliable rollback capabilities.

### 1.2 Scope

- Semantic versioning and compatibility
- Database schema migrations
- API version management
- Rolling update procedures
- Blue-green and canary deployment strategies
- Rollback procedures and data recovery
- Policy format migration

### 1.3 Upgrade Principles

```
┌─────────────────────────────────────────────────────────────────┐
│                      UPGRADE PRINCIPLES                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. ZERO DOWNTIME       - No service interruption               │
│  2. BACKWARD COMPATIBLE - N-1 version compatibility             │
│  3. REVERSIBLE          - Every change can be rolled back       │
│  4. INCREMENTAL         - Small, tested changes                 │
│  5. OBSERVABLE          - Full visibility during upgrade        │
│  6. AUTOMATED           - Minimal manual intervention           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Migration Strategy Overview

### 2.1 High-Level Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                      MIGRATION ARCHITECTURE                             │
├────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │                     MIGRATION ORCHESTRATOR                       │  │
│   └───────────────────────────┬─────────────────────────────────────┘  │
│                               │                                         │
│         ┌─────────────────────┼─────────────────────┐                  │
│         │                     │                     │                   │
│   ┌─────▼─────┐         ┌─────▼─────┐         ┌─────▼─────┐           │
│   │  Schema   │         │   API     │         │  Policy   │           │
│   │ Migrator  │         │ Versioner │         │ Migrator  │           │
│   └─────┬─────┘         └─────┬─────┘         └─────┬─────┘           │
│         │                     │                     │                   │
│   ┌─────▼─────┐         ┌─────▼─────┐         ┌─────▼─────┐           │
│   │ Database  │         │  Gateway  │         │  Policy   │           │
│   │           │         │  Router   │         │  Store    │           │
│   └───────────┘         └───────────┘         └───────────┘           │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │                    DEPLOYMENT CONTROLLER                         │  │
│   │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │  │
│   │  │ Rolling  │  │Blue-Green│  │  Canary  │  │ Rollback │        │  │
│   │  │ Update   │  │  Deploy  │  │ Release  │  │ Manager  │        │  │
│   │  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Migration Decision Matrix

| Change Type | Strategy | Downtime | Risk Level |
|-------------|----------|----------|------------|
| Patch (x.x.X) | Rolling Update | Zero | Low |
| Minor (x.X.0) | Canary Release | Zero | Medium |
| Major (X.0.0) | Blue-Green | Zero | High |
| Schema Change | Expand-Contract | Zero | High |
| Breaking API | Version Router | Zero | High |

---

## 3. Version Compatibility

### 3.1 Semantic Versioning

```typescript
// packages/core/src/version/types.ts

export interface Version {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
}

export interface CompatibilityMatrix {
  current: Version;
  compatible: {
    clients: VersionRange;
    servers: VersionRange;
    policies: VersionRange;
    schemas: VersionRange;
  };
}

export interface VersionRange {
  minimum: Version;
  maximum: Version;
  deprecated?: Version[];
}
```

### 3.2 Compatibility Checker

```typescript
// packages/core/src/version/compatibility-checker.ts

export class CompatibilityChecker {
  private matrix: CompatibilityMatrix;

  constructor(currentVersion: Version) {
    this.matrix = this.loadCompatibilityMatrix(currentVersion);
  }

  checkClientCompatibility(clientVersion: Version): CompatibilityResult {
    const { clients } = this.matrix.compatible;

    if (this.isLessThan(clientVersion, clients.minimum)) {
      return {
        compatible: false,
        reason: 'Client version too old',
        recommendation: `Upgrade client to at least ${this.formatVersion(clients.minimum)}`,
      };
    }

    if (this.isGreaterThan(clientVersion, clients.maximum)) {
      return {
        compatible: false,
        reason: 'Client version too new',
        recommendation: `Downgrade client or upgrade server`,
      };
    }

    if (clients.deprecated?.some(v => this.versionEquals(v, clientVersion))) {
      return {
        compatible: true,
        warning: 'Client version is deprecated',
        recommendation: `Upgrade client to latest stable version`,
      };
    }

    return { compatible: true };
  }

  checkSchemaCompatibility(schemaVersion: number): CompatibilityResult {
    const currentSchema = this.getCurrentSchemaVersion();

    if (schemaVersion > currentSchema) {
      return {
        compatible: false,
        reason: 'Database schema is newer than server supports',
        recommendation: 'Upgrade server before connecting to this database',
      };
    }

    if (schemaVersion < currentSchema - 2) {
      return {
        compatible: false,
        reason: 'Database schema is too old',
        recommendation: 'Run database migrations before starting server',
      };
    }

    return { compatible: true };
  }

  async negotiateProtocolVersion(
    clientCapabilities: string[],
  ): Promise<string> {
    const serverCapabilities = this.getServerCapabilities();

    // Find highest mutually supported version
    const common = serverCapabilities.filter(c =>
      clientCapabilities.includes(c)
    );

    if (common.length === 0) {
      throw new IncompatibleVersionError(
        'No compatible protocol version found',
      );
    }

    return common[0]; // Highest version
  }
}

interface CompatibilityResult {
  compatible: boolean;
  reason?: string;
  warning?: string;
  recommendation?: string;
}
```

### 3.3 Version Header Middleware

```typescript
// packages/server/src/middleware/version.ts

export function versionMiddleware(
  compatibilityChecker: CompatibilityChecker,
): RequestHandler {
  return (req, res, next) => {
    const clientVersion = req.headers['x-client-version'] as string;
    const apiVersion = req.headers['x-api-version'] as string;

    // Check client compatibility
    if (clientVersion) {
      const parsed = parseVersion(clientVersion);
      const result = compatibilityChecker.checkClientCompatibility(parsed);

      if (!result.compatible) {
        return res.status(426).json({
          error: 'Upgrade Required',
          message: result.reason,
          recommendation: result.recommendation,
        });
      }

      if (result.warning) {
        res.setHeader('X-Deprecation-Warning', result.warning);
      }
    }

    // Set server version header
    res.setHeader('X-Server-Version', getCurrentVersion());

    next();
  };
}
```

---

## 4. Database Migrations

### 4.1 Migration Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    DATABASE MIGRATION FLOW                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐ │
│   │  Expand  │───▶│ Migrate  │───▶│  Verify  │───▶│ Contract │ │
│   │  Schema  │    │   Data   │    │   Data   │    │  Schema  │ │
│   └──────────┘    └──────────┘    └──────────┘    └──────────┘ │
│        │               │               │               │        │
│        ▼               ▼               ▼               ▼        │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐ │
│   │Add Column│    │ Backfill │    │ Validate │    │Drop Old  │ │
│   │Add Table │    │  Values  │    │Integrity │    │ Columns  │ │
│   └──────────┘    └──────────┘    └──────────┘    └──────────┘ │
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  KEY PRINCIPLE: Schema changes are additive first,       │   │
│   │  then data is migrated, then old schema is removed       │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Migration Manager

```typescript
// packages/core/src/migration/migration-manager.ts

export interface Migration {
  version: number;
  name: string;
  description: string;
  up: (db: Database) => Promise<void>;
  down: (db: Database) => Promise<void>;
  verify: (db: Database) => Promise<boolean>;
}

export class MigrationManager {
  private migrations: Map<number, Migration> = new Map();
  private lockManager: DistributedLockManager;

  constructor(
    private db: Database,
    private config: MigrationConfig,
  ) {
    this.lockManager = new DistributedLockManager(config.lockProvider);
  }

  async getCurrentVersion(): Promise<number> {
    const result = await this.db.query(
      'SELECT MAX(version) as version FROM schema_migrations'
    );
    return result.rows[0]?.version ?? 0;
  }

  async migrate(targetVersion?: number): Promise<MigrationResult> {
    // Acquire distributed lock
    const lock = await this.lockManager.acquire('schema-migration', {
      ttl: 30 * 60 * 1000, // 30 minutes
    });

    try {
      const currentVersion = await this.getCurrentVersion();
      const target = targetVersion ?? this.getLatestVersion();

      if (target === currentVersion) {
        return { status: 'up-to-date', version: currentVersion };
      }

      const direction = target > currentVersion ? 'up' : 'down';
      const migrations = this.getMigrationsToRun(currentVersion, target);

      for (const migration of migrations) {
        await this.runMigration(migration, direction);
      }

      return {
        status: 'completed',
        version: target,
        migrationsRun: migrations.length,
      };
    } finally {
      await lock.release();
    }
  }

  private async runMigration(
    migration: Migration,
    direction: 'up' | 'down',
  ): Promise<void> {
    const startTime = Date.now();

    console.log(`Running migration ${migration.version}: ${migration.name}`);

    await this.db.transaction(async (tx) => {
      // Run migration
      if (direction === 'up') {
        await migration.up(tx);
      } else {
        await migration.down(tx);
      }

      // Record migration
      if (direction === 'up') {
        await tx.query(
          `INSERT INTO schema_migrations (version, name, executed_at)
           VALUES ($1, $2, NOW())`,
          [migration.version, migration.name]
        );
      } else {
        await tx.query(
          'DELETE FROM schema_migrations WHERE version = $1',
          [migration.version]
        );
      }
    });

    // Verify migration
    if (direction === 'up' && this.config.verifyMigrations) {
      const verified = await migration.verify(this.db);
      if (!verified) {
        throw new MigrationVerificationError(
          `Migration ${migration.version} verification failed`
        );
      }
    }

    console.log(
      `Migration ${migration.version} completed in ${Date.now() - startTime}ms`
    );
  }
}

interface MigrationResult {
  status: 'up-to-date' | 'completed' | 'failed';
  version: number;
  migrationsRun?: number;
  error?: Error;
}
```

### 4.3 Example Migration

```typescript
// migrations/20250115_001_add_policy_metadata.ts

import { Migration, Database } from '../types';

export const migration: Migration = {
  version: 20250115001,
  name: 'add_policy_metadata',
  description: 'Add metadata column to policies table for extensibility',

  async up(db: Database): Promise<void> {
    // Phase 1: Expand - Add new column with default
    await db.query(`
      ALTER TABLE policies
      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb
    `);

    // Add index for metadata queries
    await db.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_policies_metadata
      ON policies USING gin (metadata)
    `);
  },

  async down(db: Database): Promise<void> {
    await db.query('DROP INDEX IF EXISTS idx_policies_metadata');
    await db.query('ALTER TABLE policies DROP COLUMN IF EXISTS metadata');
  },

  async verify(db: Database): Promise<boolean> {
    // Verify column exists
    const result = await db.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'policies' AND column_name = 'metadata'
    `);

    return result.rows.length === 1;
  },
};
```

### 4.4 Expand-Contract Pattern

```typescript
// migrations/20250115_002_rename_user_id.ts

// This migration renames user_id to principal_id using expand-contract

export const expandMigration: Migration = {
  version: 20250115002,
  name: 'expand_principal_id',

  async up(db: Database): Promise<void> {
    // Add new column
    await db.query(`
      ALTER TABLE audit_logs
      ADD COLUMN IF NOT EXISTS principal_id VARCHAR(255)
    `);

    // Create trigger to sync old -> new
    await db.query(`
      CREATE OR REPLACE FUNCTION sync_principal_id()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.principal_id = COALESCE(NEW.principal_id, NEW.user_id);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_sync_principal_id
      BEFORE INSERT OR UPDATE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION sync_principal_id();
    `);
  },

  async down(db: Database): Promise<void> {
    await db.query('DROP TRIGGER IF EXISTS trg_sync_principal_id ON audit_logs');
    await db.query('DROP FUNCTION IF EXISTS sync_principal_id');
    await db.query('ALTER TABLE audit_logs DROP COLUMN IF EXISTS principal_id');
  },
};

export const dataMigration: Migration = {
  version: 20250115003,
  name: 'migrate_principal_id_data',

  async up(db: Database): Promise<void> {
    // Backfill in batches
    let processed = 0;
    const batchSize = 10000;

    while (true) {
      const result = await db.query(`
        UPDATE audit_logs
        SET principal_id = user_id
        WHERE id IN (
          SELECT id FROM audit_logs
          WHERE principal_id IS NULL AND user_id IS NOT NULL
          LIMIT $1
        )
        RETURNING id
      `, [batchSize]);

      processed += result.rowCount;

      if (result.rowCount < batchSize) break;

      // Throttle to avoid overwhelming database
      await sleep(100);
    }

    console.log(`Backfilled ${processed} rows`);
  },
};

export const contractMigration: Migration = {
  version: 20250115004,
  name: 'contract_user_id',

  async up(db: Database): Promise<void> {
    // Remove trigger
    await db.query('DROP TRIGGER IF EXISTS trg_sync_principal_id ON audit_logs');
    await db.query('DROP FUNCTION IF EXISTS sync_principal_id');

    // Drop old column (only after all clients updated)
    await db.query('ALTER TABLE audit_logs DROP COLUMN IF EXISTS user_id');
  },
};
```

---

## 5. API Versioning

### 5.1 Version Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                      API VERSIONING STRATEGY                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  URL Versioning:      /api/v1/check, /api/v2/check              │
│  Header Versioning:   Accept: application/vnd.authz.v2+json     │
│  Query Versioning:    /api/check?version=2                      │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    VERSION ROUTER                        │   │
│  │                                                          │   │
│  │   Request ─────┬───▶ v1 Handler (deprecated)            │   │
│  │                │                                         │   │
│  │                ├───▶ v2 Handler (current)               │   │
│  │                │                                         │   │
│  │                └───▶ v3 Handler (beta)                  │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Deprecation Timeline:                                          │
│  ├── v1: Deprecated (sunset: 2025-06-01)                       │
│  ├── v2: Current (stable)                                       │
│  └── v3: Beta (experimental)                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 API Version Router

```typescript
// packages/server/src/routing/version-router.ts

export interface VersionedHandler {
  version: number;
  handler: RequestHandler;
  deprecated?: boolean;
  sunset?: Date;
}

export class APIVersionRouter {
  private handlers: Map<string, VersionedHandler[]> = new Map();
  private defaultVersion: number = 2;

  registerHandler(
    path: string,
    version: number,
    handler: RequestHandler,
    options?: { deprecated?: boolean; sunset?: Date },
  ): void {
    const handlers = this.handlers.get(path) ?? [];
    handlers.push({
      version,
      handler,
      deprecated: options?.deprecated,
      sunset: options?.sunset,
    });
    handlers.sort((a, b) => b.version - a.version);
    this.handlers.set(path, handlers);
  }

  route(): RequestHandler {
    return (req, res, next) => {
      const requestedVersion = this.extractVersion(req);
      const path = this.normalizePath(req.path);
      const handlers = this.handlers.get(path);

      if (!handlers) {
        return next();
      }

      const handler = this.selectHandler(handlers, requestedVersion);

      if (!handler) {
        return res.status(400).json({
          error: 'Invalid API Version',
          supportedVersions: handlers.map(h => h.version),
        });
      }

      // Add deprecation headers
      if (handler.deprecated) {
        res.setHeader('Deprecation', 'true');
        if (handler.sunset) {
          res.setHeader('Sunset', handler.sunset.toISOString());
        }
      }

      res.setHeader('X-API-Version', handler.version.toString());
      handler.handler(req, res, next);
    };
  }

  private extractVersion(req: Request): number | undefined {
    // Check URL path: /api/v2/...
    const pathMatch = req.path.match(/\/v(\d+)\//);
    if (pathMatch) {
      return parseInt(pathMatch[1], 10);
    }

    // Check Accept header
    const accept = req.headers.accept;
    const headerMatch = accept?.match(/vnd\.authz\.v(\d+)/);
    if (headerMatch) {
      return parseInt(headerMatch[1], 10);
    }

    // Check query parameter
    const queryVersion = req.query.version as string;
    if (queryVersion) {
      return parseInt(queryVersion, 10);
    }

    return undefined;
  }

  private selectHandler(
    handlers: VersionedHandler[],
    requestedVersion?: number,
  ): VersionedHandler | undefined {
    if (requestedVersion !== undefined) {
      return handlers.find(h => h.version === requestedVersion);
    }

    // Default to highest non-deprecated version
    return handlers.find(h => !h.deprecated) ?? handlers[0];
  }
}
```

### 5.3 Response Transformers

```typescript
// packages/server/src/transformers/version-transformer.ts

export interface ResponseTransformer<TInternal, TExternal> {
  toExternal(internal: TInternal): TExternal;
  fromExternal(external: TExternal): TInternal;
}

// V1 response format (deprecated)
interface DecisionResponseV1 {
  allowed: boolean;
  reason: string;
}

// V2 response format (current)
interface DecisionResponseV2 {
  decision: {
    effect: 'ALLOW' | 'DENY';
    reasoning: string;
    policyId?: string;
  };
  metadata: {
    evaluationTime: number;
    cacheHit: boolean;
  };
}

export const decisionTransformerV1: ResponseTransformer<
  InternalDecision,
  DecisionResponseV1
> = {
  toExternal(internal) {
    return {
      allowed: internal.effect === 'ALLOW',
      reason: internal.reasoning,
    };
  },
  fromExternal(external) {
    return {
      effect: external.allowed ? 'ALLOW' : 'DENY',
      reasoning: external.reason,
    };
  },
};

export const decisionTransformerV2: ResponseTransformer<
  InternalDecision,
  DecisionResponseV2
> = {
  toExternal(internal) {
    return {
      decision: {
        effect: internal.effect,
        reasoning: internal.reasoning,
        policyId: internal.matchedPolicy?.id,
      },
      metadata: {
        evaluationTime: internal.evaluationTimeMs,
        cacheHit: internal.cacheHit,
      },
    };
  },
  fromExternal(external) {
    return {
      effect: external.decision.effect,
      reasoning: external.decision.reasoning,
      evaluationTimeMs: external.metadata.evaluationTime,
      cacheHit: external.metadata.cacheHit,
    };
  },
};
```

---

## 6. Policy Migration

### 6.1 Policy Version Evolution

```typescript
// packages/core/src/policy/migration/policy-migrator.ts

export interface PolicyMigration {
  fromVersion: number;
  toVersion: number;
  migrate: (policy: PolicyDocument) => PolicyDocument;
  validate: (policy: PolicyDocument) => ValidationResult;
}

export class PolicyMigrator {
  private migrations: PolicyMigration[] = [];

  registerMigration(migration: PolicyMigration): void {
    this.migrations.push(migration);
    this.migrations.sort((a, b) => a.fromVersion - b.fromVersion);
  }

  async migratePolicy(
    policy: PolicyDocument,
    targetVersion: number,
  ): Promise<MigrationResult> {
    let currentPolicy = { ...policy };
    const appliedMigrations: number[] = [];

    while (currentPolicy.version < targetVersion) {
      const migration = this.migrations.find(
        m => m.fromVersion === currentPolicy.version
      );

      if (!migration) {
        throw new Error(
          `No migration path from version ${currentPolicy.version}`
        );
      }

      // Validate before migration
      const preValidation = migration.validate(currentPolicy);
      if (!preValidation.valid) {
        throw new ValidationError(preValidation.errors);
      }

      // Apply migration
      currentPolicy = migration.migrate(currentPolicy);
      appliedMigrations.push(migration.toVersion);

      // Validate after migration
      const postValidation = this.validatePolicy(currentPolicy);
      if (!postValidation.valid) {
        throw new MigrationError(
          `Policy invalid after migration to v${migration.toVersion}`,
          postValidation.errors
        );
      }
    }

    return {
      policy: currentPolicy,
      migrationsApplied: appliedMigrations,
    };
  }

  async migratePoliciesInBatch(
    policies: PolicyDocument[],
    targetVersion: number,
  ): Promise<BatchMigrationResult> {
    const results = await Promise.allSettled(
      policies.map(p => this.migratePolicy(p, targetVersion))
    );

    return {
      successful: results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length,
      results: results.map((r, i) => ({
        policyId: policies[i].id,
        status: r.status,
        result: r.status === 'fulfilled' ? r.value : undefined,
        error: r.status === 'rejected' ? r.reason : undefined,
      })),
    };
  }
}
```

### 6.2 Policy Format Migrations

```typescript
// packages/core/src/policy/migration/migrations.ts

// Migration: v1 -> v2 (CEL expression syntax change)
export const policyMigrationV1ToV2: PolicyMigration = {
  fromVersion: 1,
  toVersion: 2,

  migrate(policy) {
    return {
      ...policy,
      version: 2,
      rules: policy.rules.map(rule => ({
        ...rule,
        // V1 used 'when' for conditions, V2 uses 'condition'
        condition: rule.when ?? rule.condition,
        when: undefined,
        // V1 actions were strings, V2 uses action objects
        actions: rule.actions.map(action =>
          typeof action === 'string'
            ? { name: action }
            : action
        ),
      })),
    };
  },

  validate(policy) {
    const errors: string[] = [];

    if (!policy.rules || !Array.isArray(policy.rules)) {
      errors.push('Policy must have rules array');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  },
};

// Migration: v2 -> v3 (Add resource hierarchy support)
export const policyMigrationV2ToV3: PolicyMigration = {
  fromVersion: 2,
  toVersion: 3,

  migrate(policy) {
    return {
      ...policy,
      version: 3,
      rules: policy.rules.map(rule => ({
        ...rule,
        // V3 adds explicit resource patterns
        resourcePattern: rule.resource
          ? convertResourceToPattern(rule.resource)
          : '*',
        // V3 adds inheritance flag
        inheritParentPermissions: true,
      })),
    };
  },

  validate(policy) {
    return { valid: true, errors: [] };
  },
};

function convertResourceToPattern(resource: string): string {
  // Convert old format: "document:123" to pattern: "document/*"
  const [type] = resource.split(':');
  return `${type}/*`;
}
```

---

## 7. Rolling Updates

### 7.1 Rolling Update Strategy

```yaml
# kubernetes/deployment-rolling.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: authz-engine
  namespace: authz-system
spec:
  replicas: 5
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 2
  selector:
    matchLabels:
      app: authz-engine
  template:
    metadata:
      labels:
        app: authz-engine
    spec:
      containers:
      - name: authz-engine
        image: authz-engine:v2.1.0
        ports:
        - containerPort: 8080
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
          successThreshold: 2
          failureThreshold: 3
        livenessProbe:
          httpGet:
            path: /health/live
            port: 8080
          initialDelaySeconds: 15
          periodSeconds: 10
        lifecycle:
          preStop:
            exec:
              command: ["/bin/sh", "-c", "sleep 15"]
      terminationGracePeriodSeconds: 30
```

### 7.2 Rolling Update Controller

```typescript
// packages/core/src/deployment/rolling-update.ts

export class RollingUpdateController {
  constructor(
    private k8sClient: KubernetesClient,
    private metrics: MetricsCollector,
    private alertManager: AlertManager,
  ) {}

  async performUpdate(
    deployment: string,
    newImage: string,
    options: RollingUpdateOptions,
  ): Promise<UpdateResult> {
    const startTime = Date.now();

    try {
      // 1. Pre-update validation
      await this.validatePreUpdate(deployment);

      // 2. Start update
      await this.k8sClient.patchDeployment(deployment, {
        spec: {
          template: {
            spec: {
              containers: [{
                name: 'authz-engine',
                image: newImage,
              }],
            },
          },
        },
      });

      // 3. Monitor rollout
      const result = await this.monitorRollout(deployment, options);

      // 4. Post-update validation
      if (result.status === 'completed') {
        await this.validatePostUpdate(deployment);
      }

      return result;
    } catch (error) {
      // Auto-rollback on failure
      if (options.autoRollback) {
        await this.rollback(deployment);
      }
      throw error;
    }
  }

  private async monitorRollout(
    deployment: string,
    options: RollingUpdateOptions,
  ): Promise<UpdateResult> {
    const deadline = Date.now() + options.timeoutSeconds * 1000;

    while (Date.now() < deadline) {
      const status = await this.k8sClient.getDeploymentStatus(deployment);

      if (status.updatedReplicas === status.replicas &&
          status.availableReplicas === status.replicas) {
        return { status: 'completed', duration: Date.now() - deadline };
      }

      // Check for failures
      if (status.unavailableReplicas > options.maxUnavailable) {
        return {
          status: 'failed',
          reason: 'Too many unavailable replicas',
        };
      }

      // Monitor error rates during rollout
      const errorRate = await this.metrics.getErrorRate(deployment);
      if (errorRate > options.errorThreshold) {
        return {
          status: 'failed',
          reason: `Error rate ${errorRate}% exceeds threshold ${options.errorThreshold}%`,
        };
      }

      await sleep(5000);
    }

    return { status: 'timeout' };
  }
}

interface RollingUpdateOptions {
  timeoutSeconds: number;
  maxUnavailable: number;
  errorThreshold: number;
  autoRollback: boolean;
}
```

---

## 8. Blue-Green Deployments

### 8.1 Blue-Green Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    BLUE-GREEN DEPLOYMENT                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                     ┌──────────────┐                            │
│                     │   Ingress    │                            │
│                     │   / Router   │                            │
│                     └──────┬───────┘                            │
│                            │                                     │
│              ┌─────────────┴─────────────┐                      │
│              │                           │                       │
│        ┌─────▼─────┐               ┌─────▼─────┐                │
│        │   BLUE    │               │   GREEN   │                │
│        │  (v2.0)   │               │  (v2.1)   │                │
│        │  ACTIVE   │               │  STANDBY  │                │
│        └─────┬─────┘               └─────┬─────┘                │
│              │                           │                       │
│        ┌─────▼─────┐               ┌─────▼─────┐                │
│        │ 5 Replicas│               │ 5 Replicas│                │
│        └───────────┘               └───────────┘                │
│                                                                  │
│   SWITCH PROCESS:                                               │
│   1. Deploy new version to GREEN                                │
│   2. Run smoke tests on GREEN                                   │
│   3. Switch traffic to GREEN                                    │
│   4. Monitor for issues                                         │
│   5. Rollback: Switch back to BLUE                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 Blue-Green Controller

```typescript
// packages/core/src/deployment/blue-green.ts

export class BlueGreenController {
  constructor(
    private k8sClient: KubernetesClient,
    private serviceRouter: ServiceRouter,
    private smokeTests: SmokeTestRunner,
  ) {}

  async deploy(
    deployment: string,
    newImage: string,
  ): Promise<BlueGreenResult> {
    const currentSlot = await this.getCurrentSlot(deployment);
    const targetSlot = currentSlot === 'blue' ? 'green' : 'blue';

    try {
      // 1. Deploy to inactive slot
      console.log(`Deploying to ${targetSlot} slot`);
      await this.deployToSlot(deployment, targetSlot, newImage);

      // 2. Wait for ready
      await this.waitForReady(`${deployment}-${targetSlot}`);

      // 3. Run smoke tests
      console.log('Running smoke tests...');
      const smokeResult = await this.smokeTests.run(
        this.getSlotEndpoint(targetSlot)
      );

      if (!smokeResult.passed) {
        throw new Error(`Smoke tests failed: ${smokeResult.failures}`);
      }

      // 4. Switch traffic
      console.log(`Switching traffic from ${currentSlot} to ${targetSlot}`);
      await this.switchTraffic(deployment, targetSlot);

      // 5. Verify traffic switch
      await this.verifyTrafficSwitch(deployment, targetSlot);

      return {
        status: 'completed',
        previousSlot: currentSlot,
        activeSlot: targetSlot,
      };
    } catch (error) {
      // Cleanup failed deployment
      await this.cleanupSlot(deployment, targetSlot);
      throw error;
    }
  }

  async rollback(deployment: string): Promise<void> {
    const currentSlot = await this.getCurrentSlot(deployment);
    const previousSlot = currentSlot === 'blue' ? 'green' : 'blue';

    // Verify previous slot is healthy
    const health = await this.checkSlotHealth(`${deployment}-${previousSlot}`);
    if (!health.healthy) {
      throw new Error('Previous slot is not healthy, cannot rollback');
    }

    // Switch traffic back
    await this.switchTraffic(deployment, previousSlot);
  }

  private async switchTraffic(
    deployment: string,
    targetSlot: 'blue' | 'green',
  ): Promise<void> {
    // Update service selector
    await this.k8sClient.patchService(deployment, {
      spec: {
        selector: {
          app: deployment,
          slot: targetSlot,
        },
      },
    });

    // Update ingress if needed
    await this.serviceRouter.updateRoute(deployment, targetSlot);
  }
}
```

### 8.3 Blue-Green Kubernetes Configuration

```yaml
# kubernetes/blue-green/deployments.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: authz-engine-blue
  namespace: authz-system
  labels:
    app: authz-engine
    slot: blue
spec:
  replicas: 5
  selector:
    matchLabels:
      app: authz-engine
      slot: blue
  template:
    metadata:
      labels:
        app: authz-engine
        slot: blue
    spec:
      containers:
      - name: authz-engine
        image: authz-engine:v2.0.0

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: authz-engine-green
  namespace: authz-system
  labels:
    app: authz-engine
    slot: green
spec:
  replicas: 5
  selector:
    matchLabels:
      app: authz-engine
      slot: green
  template:
    metadata:
      labels:
        app: authz-engine
        slot: green
    spec:
      containers:
      - name: authz-engine
        image: authz-engine:v2.1.0

---
apiVersion: v1
kind: Service
metadata:
  name: authz-engine
  namespace: authz-system
spec:
  selector:
    app: authz-engine
    slot: blue  # Switch to 'green' for cutover
  ports:
  - port: 8080
    targetPort: 8080
```

---

## 9. Canary Releases

### 9.1 Canary Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      CANARY RELEASE                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Traffic Split:  95% Stable  /  5% Canary                      │
│                                                                  │
│                     ┌──────────────┐                            │
│                     │   Ingress    │                            │
│                     │   (Istio)    │                            │
│                     └──────┬───────┘                            │
│                            │                                     │
│              ┌─────────────┴─────────────┐                      │
│              │ 95%                   5%  │                       │
│        ┌─────▼─────┐               ┌─────▼─────┐                │
│        │  STABLE   │               │  CANARY   │                │
│        │  (v2.0)   │               │  (v2.1)   │                │
│        │           │               │           │                 │
│        │ 9 Replicas│               │ 1 Replica │                │
│        └───────────┘               └───────────┘                │
│                                                                  │
│   PROMOTION PHASES:                                             │
│   Phase 1:  5% canary  (1h monitoring)                         │
│   Phase 2: 25% canary  (2h monitoring)                         │
│   Phase 3: 50% canary  (4h monitoring)                         │
│   Phase 4: 100% stable (promotion complete)                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 9.2 Canary Controller

```typescript
// packages/core/src/deployment/canary.ts

export interface CanaryConfig {
  steps: CanaryStep[];
  metrics: CanaryMetrics;
  autoPromote: boolean;
  autoRollback: boolean;
}

export interface CanaryStep {
  weight: number;
  duration: string;
  analysis: AnalysisConfig;
}

export class CanaryController {
  constructor(
    private istioClient: IstioClient,
    private metricsCollector: MetricsCollector,
    private alertManager: AlertManager,
  ) {}

  async startCanary(
    deployment: string,
    canaryImage: string,
    config: CanaryConfig,
  ): Promise<CanaryResult> {
    // Deploy canary version
    await this.deployCanary(deployment, canaryImage);

    for (const step of config.steps) {
      // Update traffic weight
      await this.updateTrafficWeight(deployment, step.weight);

      // Wait for duration
      const analysis = await this.analyzeCanary(
        deployment,
        step.duration,
        step.analysis,
      );

      if (analysis.status === 'failed') {
        if (config.autoRollback) {
          await this.rollbackCanary(deployment);
          return {
            status: 'rolled_back',
            reason: analysis.reason,
            failedAtStep: step.weight,
          };
        }
        throw new CanaryFailedError(analysis.reason);
      }

      console.log(`Canary at ${step.weight}% passed analysis`);
    }

    // Full promotion
    await this.promoteCanary(deployment);

    return { status: 'promoted' };
  }

  private async analyzeCanary(
    deployment: string,
    duration: string,
    config: AnalysisConfig,
  ): Promise<AnalysisResult> {
    const endTime = Date.now() + parseDuration(duration);

    while (Date.now() < endTime) {
      const metrics = await this.collectCanaryMetrics(deployment);

      // Check success rate
      if (metrics.successRate < config.minSuccessRate) {
        return {
          status: 'failed',
          reason: `Success rate ${metrics.successRate}% below threshold ${config.minSuccessRate}%`,
        };
      }

      // Check latency
      if (metrics.p99Latency > config.maxLatencyP99) {
        return {
          status: 'failed',
          reason: `P99 latency ${metrics.p99Latency}ms exceeds ${config.maxLatencyP99}ms`,
        };
      }

      // Check error rate comparison with stable
      const stableMetrics = await this.collectStableMetrics(deployment);
      const errorRateDiff = metrics.errorRate - stableMetrics.errorRate;

      if (errorRateDiff > config.maxErrorRateIncrease) {
        return {
          status: 'failed',
          reason: `Error rate ${errorRateDiff}% higher than stable`,
        };
      }

      await sleep(30000); // Check every 30 seconds
    }

    return { status: 'passed' };
  }

  private async updateTrafficWeight(
    deployment: string,
    canaryWeight: number,
  ): Promise<void> {
    await this.istioClient.updateVirtualService(deployment, {
      spec: {
        http: [{
          route: [
            {
              destination: {
                host: deployment,
                subset: 'stable',
              },
              weight: 100 - canaryWeight,
            },
            {
              destination: {
                host: deployment,
                subset: 'canary',
              },
              weight: canaryWeight,
            },
          ],
        }],
      },
    });
  }
}
```

### 9.3 Istio Canary Configuration

```yaml
# kubernetes/canary/virtual-service.yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: authz-engine
  namespace: authz-system
spec:
  hosts:
  - authz-engine
  http:
  - match:
    - headers:
        x-canary:
          exact: "true"
    route:
    - destination:
        host: authz-engine
        subset: canary
  - route:
    - destination:
        host: authz-engine
        subset: stable
      weight: 95
    - destination:
        host: authz-engine
        subset: canary
      weight: 5

---
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: authz-engine
  namespace: authz-system
spec:
  host: authz-engine
  subsets:
  - name: stable
    labels:
      version: stable
  - name: canary
    labels:
      version: canary
```

---

## 10. Rollback Procedures

### 10.1 Rollback Decision Matrix

| Condition | Auto-Rollback | Manual Review |
|-----------|---------------|---------------|
| Error rate > 5% | Yes | - |
| Latency P99 > 2x baseline | Yes | - |
| Health check failures | Yes | - |
| Memory/CPU spike > 50% | No | Yes |
| Business metric regression | No | Yes |
| Security vulnerability | - | Immediate |

### 10.2 Rollback Manager

```typescript
// packages/core/src/deployment/rollback-manager.ts

export class RollbackManager {
  private rollbackHistory: Map<string, RollbackRecord[]> = new Map();

  constructor(
    private k8sClient: KubernetesClient,
    private dbMigrator: MigrationManager,
    private policyMigrator: PolicyMigrator,
  ) {}

  async rollback(
    deployment: string,
    options: RollbackOptions,
  ): Promise<RollbackResult> {
    const startTime = Date.now();

    console.log(`Starting rollback for ${deployment}`);

    try {
      // 1. Get current and target revisions
      const current = await this.getCurrentRevision(deployment);
      const target = options.targetRevision ?? current - 1;

      if (target < 1) {
        throw new Error('No previous revision to rollback to');
      }

      // 2. Check if rollback is safe
      const safetyCheck = await this.checkRollbackSafety(deployment, target);
      if (!safetyCheck.safe && !options.force) {
        throw new Error(`Rollback blocked: ${safetyCheck.reason}`);
      }

      // 3. Perform application rollback
      await this.rollbackApplication(deployment, target);

      // 4. Rollback database if needed
      if (options.includeDatabase) {
        await this.rollbackDatabase(deployment, target);
      }

      // 5. Rollback policies if needed
      if (options.includePolicies) {
        await this.rollbackPolicies(deployment, target);
      }

      // 6. Verify rollback
      await this.verifyRollback(deployment, target);

      // 7. Record rollback
      this.recordRollback(deployment, {
        fromRevision: current,
        toRevision: target,
        timestamp: new Date(),
        duration: Date.now() - startTime,
        reason: options.reason,
      });

      return {
        status: 'completed',
        fromRevision: current,
        toRevision: target,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        status: 'failed',
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  private async checkRollbackSafety(
    deployment: string,
    targetRevision: number,
  ): Promise<SafetyCheckResult> {
    // Check schema compatibility
    const schemaVersion = await this.getSchemaVersionForRevision(targetRevision);
    const currentSchema = await this.dbMigrator.getCurrentVersion();

    if (schemaVersion > currentSchema) {
      return {
        safe: false,
        reason: 'Target revision requires newer database schema',
      };
    }

    // Check for data-destructive migrations
    const migrations = await this.getMigrationsBetween(schemaVersion, currentSchema);
    const hasDestructive = migrations.some(m => m.destructive);

    if (hasDestructive) {
      return {
        safe: false,
        reason: 'Rollback would require data-destructive schema changes',
      };
    }

    return { safe: true };
  }

  async createRollbackPoint(deployment: string): Promise<string> {
    const snapshot = {
      id: `rollback-${Date.now()}`,
      deployment,
      revision: await this.getCurrentRevision(deployment),
      schemaVersion: await this.dbMigrator.getCurrentVersion(),
      policyVersion: await this.policyMigrator.getCurrentVersion(),
      timestamp: new Date(),
    };

    await this.saveSnapshot(snapshot);
    return snapshot.id;
  }
}

interface RollbackOptions {
  targetRevision?: number;
  includeDatabase?: boolean;
  includePolicies?: boolean;
  force?: boolean;
  reason: string;
}
```

### 10.3 Rollback Script

```bash
#!/bin/bash
# scripts/rollback.sh

set -euo pipefail

DEPLOYMENT=$1
REVISION=${2:-}
REASON=${3:-"Manual rollback"}

echo "=== AuthZ Engine Rollback ==="
echo "Deployment: $DEPLOYMENT"
echo "Time: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# Get current revision if not specified
if [ -z "$REVISION" ]; then
  CURRENT=$(kubectl rollout history deployment/$DEPLOYMENT -n authz-system | tail -2 | head -1 | awk '{print $1}')
  REVISION=$((CURRENT - 1))
fi

echo "Rolling back to revision: $REVISION"
echo "Reason: $REASON"

# Create rollback point
echo "Creating rollback point..."
kubectl annotate deployment/$DEPLOYMENT -n authz-system \
  rollback.authz/pre-rollback-revision=$(kubectl rollout history deployment/$DEPLOYMENT -n authz-system | tail -1 | awk '{print $1}')

# Perform rollback
echo "Performing rollback..."
kubectl rollout undo deployment/$DEPLOYMENT -n authz-system --to-revision=$REVISION

# Wait for rollout
echo "Waiting for rollback to complete..."
kubectl rollout status deployment/$DEPLOYMENT -n authz-system --timeout=300s

# Verify
echo "Verifying rollback..."
kubectl get pods -n authz-system -l app=$DEPLOYMENT

# Health check
echo "Running health check..."
for i in {1..10}; do
  if curl -s "http://$DEPLOYMENT.authz-system.svc:8080/health" | grep -q "healthy"; then
    echo "Health check passed"
    break
  fi
  sleep 5
done

echo "=== Rollback Complete ==="
```

---

## 11. Data Migration

### 11.1 Data Migration Framework

```typescript
// packages/core/src/migration/data-migrator.ts

export interface DataMigration {
  id: string;
  name: string;
  batchSize: number;
  concurrency: number;
  migrate: (batch: any[], context: MigrationContext) => Promise<any[]>;
  verify: (item: any) => boolean;
}

export class DataMigrator {
  constructor(
    private db: Database,
    private progressTracker: ProgressTracker,
  ) {}

  async migrateData(
    migration: DataMigration,
    query: string,
  ): Promise<DataMigrationResult> {
    const startTime = Date.now();
    let processed = 0;
    let failed = 0;

    // Get total count
    const countResult = await this.db.query(
      `SELECT COUNT(*) as total FROM (${query}) as q`
    );
    const total = parseInt(countResult.rows[0].total);

    console.log(`Starting data migration: ${migration.name}`);
    console.log(`Total records: ${total}`);

    // Process in batches
    let offset = 0;
    while (offset < total) {
      const batch = await this.db.query(
        `${query} LIMIT $1 OFFSET $2`,
        [migration.batchSize, offset]
      );

      const results = await this.processBatch(
        migration,
        batch.rows,
        migration.concurrency,
      );

      processed += results.success;
      failed += results.failed;
      offset += migration.batchSize;

      // Update progress
      await this.progressTracker.update(migration.id, {
        processed,
        failed,
        total,
        percentage: Math.round((processed / total) * 100),
      });

      // Throttle to avoid overwhelming database
      await sleep(100);
    }

    return {
      migration: migration.id,
      total,
      processed,
      failed,
      duration: Date.now() - startTime,
    };
  }

  private async processBatch(
    migration: DataMigration,
    batch: any[],
    concurrency: number,
  ): Promise<{ success: number; failed: number }> {
    const chunks = this.chunkArray(batch, concurrency);
    let success = 0;
    let failed = 0;

    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map(item => this.migrateItem(migration, item))
      );

      success += results.filter(r => r.status === 'fulfilled').length;
      failed += results.filter(r => r.status === 'rejected').length;
    }

    return { success, failed };
  }

  private async migrateItem(
    migration: DataMigration,
    item: any,
  ): Promise<void> {
    const context: MigrationContext = {
      db: this.db,
      logger: console,
    };

    const migrated = await migration.migrate([item], context);

    if (!migration.verify(migrated[0])) {
      throw new Error(`Verification failed for item ${item.id}`);
    }
  }
}
```

---

## 12. Testing Strategy

### 12.1 Migration Testing

```typescript
// tests/migration/migration.test.ts

describe('Database Migrations', () => {
  let testDb: Database;
  let migrator: MigrationManager;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    migrator = new MigrationManager(testDb, { verifyMigrations: true });
  });

  afterEach(async () => {
    await testDb.close();
  });

  describe('Forward Migrations', () => {
    it('should apply all migrations in order', async () => {
      const result = await migrator.migrate();

      expect(result.status).toBe('completed');
      expect(await migrator.getCurrentVersion()).toBe(
        migrator.getLatestVersion()
      );
    });

    it('should be idempotent', async () => {
      await migrator.migrate();
      const result = await migrator.migrate();

      expect(result.status).toBe('up-to-date');
    });
  });

  describe('Backward Migrations', () => {
    it('should rollback cleanly', async () => {
      await migrator.migrate();
      const currentVersion = await migrator.getCurrentVersion();

      await migrator.migrate(currentVersion - 1);

      expect(await migrator.getCurrentVersion()).toBe(currentVersion - 1);
    });
  });

  describe('Data Integrity', () => {
    it('should preserve data during migration', async () => {
      // Insert test data
      await testDb.query(
        'INSERT INTO policies (id, name) VALUES ($1, $2)',
        ['test-1', 'Test Policy']
      );

      // Run migration
      await migrator.migrate();

      // Verify data preserved
      const result = await testDb.query(
        'SELECT * FROM policies WHERE id = $1',
        ['test-1']
      );

      expect(result.rows[0].name).toBe('Test Policy');
    });
  });
});
```

### 12.2 Upgrade Test Suite

```typescript
// tests/upgrade/upgrade-compatibility.test.ts

describe('Version Upgrade Compatibility', () => {
  it('should handle v1 to v2 API upgrade', async () => {
    const v1Client = createClient({ version: 1 });
    const v2Client = createClient({ version: 2 });

    // Create resource with v1
    const v1Response = await v1Client.check({
      principal: 'user:123',
      action: 'read',
      resource: 'document:456',
    });

    // Verify v2 can read
    const v2Response = await v2Client.check({
      principal: { type: 'user', id: '123' },
      action: { name: 'read' },
      resource: { type: 'document', id: '456' },
    });

    expect(v1Response.allowed).toBe(v2Response.decision.effect === 'ALLOW');
  });

  it('should maintain backward compatibility', async () => {
    // Start new server version
    const server = await startServer({ version: '2.1.0' });

    // Connect with old client
    const oldClient = createClient({
      version: 1,
      serverUrl: server.url,
    });

    // Should work with deprecation warning
    const response = await oldClient.check({
      principal: 'user:123',
      action: 'read',
      resource: 'document:456',
    });

    expect(response).toBeDefined();
    expect(response._deprecationWarning).toBeDefined();
  });
});
```

---

## Appendices

### A. Related Documents

| Document | Description |
|----------|-------------|
| [DEPLOYMENT-OPERATIONS-SDD](./DEPLOYMENT-OPERATIONS-SDD.md) | Kubernetes deployment |
| [DISASTER-RECOVERY-SDD](./DISASTER-RECOVERY-SDD.md) | Disaster recovery |
| [CACHING-STRATEGY-SDD](./CACHING-STRATEGY-SDD.md) | Cache invalidation during upgrades |

### B. Version Changelog Template

```markdown
## [2.1.0] - 2025-01-15

### Added
- New policy inheritance feature
- GraphQL subscription support

### Changed
- Improved cache invalidation performance
- Updated CEL expression parser

### Deprecated
- V1 REST API (sunset: 2025-06-01)

### Migration Notes
- Run database migrations before upgrade
- Update client SDK to >= 2.0.0
```

---

**Document Control:**
- **Review Cycle:** Per release
- **Classification:** Internal
- **Distribution:** Engineering, SRE, Platform Teams
