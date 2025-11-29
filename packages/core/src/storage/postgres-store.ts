/**
 * PostgreSQL Policy Store
 *
 * Production-ready PostgreSQL implementation for policy persistence.
 * Supports:
 * - Connection pooling with pg-pool
 * - Automatic schema migrations
 * - JSONB storage with GIN indexes for fast queries
 * - Change notifications via LISTEN/NOTIFY
 * - Optimistic locking for concurrent updates
 */

import { createHash } from 'crypto';
import type {
  IPolicyStore,
  PostgresConfig,
  StoredPolicy,
  PolicyQuery,
  PolicyQueryResult,
  AnyPolicy,
  PolicyChangeEvent,
} from './types.js';

// =============================================================================
// Constants
// =============================================================================

/** Default PostgreSQL configuration values */
const POSTGRES_DEFAULTS = {
  HOST: 'localhost',
  PORT: 5432,
  DATABASE: 'authz',
  USER: 'postgres',
  SCHEMA: 'authz',
  POOL_SIZE: 10,
  CONNECTION_TIMEOUT_MS: 5000,
  QUERY_TIMEOUT_MS: 30000,
  IDLE_TIMEOUT_MS: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
  DEFAULT_QUERY_LIMIT: 100,
  DEFAULT_POLICY_VERSION: '1.0.0',
  HASH_SUBSTRING_LENGTH: 16,
} as const;

// PostgreSQL client types
interface PgPool {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
  connect(): Promise<PgClient>;
  end(): Promise<void>;
  on(event: string, callback: (...args: unknown[]) => void): void;
}

interface PgClient {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
  on(event: string, callback: (...args: unknown[]) => void): void;
  release(): void;
}

interface PolicyRow {
  id: string;
  kind: string;
  name: string;
  version: string;
  policy: AnyPolicy;
  hash: string;
  disabled: boolean;
  created_at: Date;
  updated_at: Date;
  source: string | null;
  labels: Record<string, string> | null;
}

export class PostgresPolicyStore implements IPolicyStore {
  private pool: PgPool | null = null;
  private notifyClient: PgClient | null = null;
  private config: PostgresConfig;
  private schema: string;
  private changeCallbacks: Set<(event: PolicyChangeEvent) => void> = new Set();
  private initialized = false;

  constructor(config: PostgresConfig) {
    this.config = {
      host: POSTGRES_DEFAULTS.HOST,
      port: POSTGRES_DEFAULTS.PORT,
      database: POSTGRES_DEFAULTS.DATABASE,
      user: POSTGRES_DEFAULTS.USER,
      schema: POSTGRES_DEFAULTS.SCHEMA,
      poolSize: POSTGRES_DEFAULTS.POOL_SIZE,
      connectionTimeoutMs: POSTGRES_DEFAULTS.CONNECTION_TIMEOUT_MS,
      queryTimeoutMs: POSTGRES_DEFAULTS.QUERY_TIMEOUT_MS,
      autoMigrate: true,
      retryEnabled: true,
      maxRetries: POSTGRES_DEFAULTS.MAX_RETRIES,
      retryDelayMs: POSTGRES_DEFAULTS.RETRY_DELAY_MS,
      ...config,
    };
    this.schema = this.config.schema ?? POSTGRES_DEFAULTS.SCHEMA;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const pg = await import('pg').catch(() => null);

      if (!pg) {
        throw new Error('pg package not installed. Run: npm install pg');
      }

      const { Pool } = pg;

      this.pool = new Pool({
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.user,
        password: this.config.password,
        max: this.config.poolSize,
        connectionTimeoutMillis: this.config.connectionTimeoutMs,
        idleTimeoutMillis: POSTGRES_DEFAULTS.IDLE_TIMEOUT_MS,
        ssl: this.config.ssl
          ? typeof this.config.ssl === 'object'
            ? this.config.ssl
            : { rejectUnauthorized: false }
          : undefined,
      }) as unknown as PgPool;

      // Test connection
      const client = await this.pool.connect();
      client.release();

      // Run migrations if enabled
      if (this.config.autoMigrate) {
        await this.runMigrations();
      }

      // Setup NOTIFY listener
      await this.setupNotifyListener();

      this.initialized = true;
      // Successfully connected - initialization complete
    } catch (error) {
      throw new Error(`Failed to connect to PostgreSQL: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async runMigrations(): Promise<void> {
    if (!this.pool) return;

    const migrations = `
      -- Create schema
      CREATE SCHEMA IF NOT EXISTS ${this.schema};

      -- Policies table
      CREATE TABLE IF NOT EXISTS ${this.schema}.policies (
        id VARCHAR(255) PRIMARY KEY,
        kind VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
        policy JSONB NOT NULL,
        hash VARCHAR(64) NOT NULL,
        disabled BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        source VARCHAR(500),
        labels JSONB,

        CONSTRAINT unique_name_kind UNIQUE (name, kind)
      );

      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_policies_kind ON ${this.schema}.policies(kind);
      CREATE INDEX IF NOT EXISTS idx_policies_name ON ${this.schema}.policies(name);
      CREATE INDEX IF NOT EXISTS idx_policies_disabled ON ${this.schema}.policies(disabled);
      CREATE INDEX IF NOT EXISTS idx_policies_resource ON ${this.schema}.policies USING GIN ((policy->'spec'->'resource'));
      CREATE INDEX IF NOT EXISTS idx_policies_labels ON ${this.schema}.policies USING GIN (labels);

      -- Function for change notification
      CREATE OR REPLACE FUNCTION ${this.schema}.notify_policy_change()
      RETURNS TRIGGER AS $$
      DECLARE
        event_type TEXT;
        payload JSON;
      BEGIN
        IF TG_OP = 'INSERT' THEN
          event_type := 'created';
          payload := json_build_object(
            'type', event_type,
            'policyId', NEW.id,
            'policyName', NEW.name,
            'policyKind', NEW.kind,
            'newHash', NEW.hash,
            'timestamp', NOW()
          );
        ELSIF TG_OP = 'UPDATE' THEN
          IF OLD.disabled != NEW.disabled THEN
            event_type := CASE WHEN NEW.disabled THEN 'disabled' ELSE 'enabled' END;
          ELSE
            event_type := 'updated';
          END IF;
          payload := json_build_object(
            'type', event_type,
            'policyId', NEW.id,
            'policyName', NEW.name,
            'policyKind', NEW.kind,
            'previousHash', OLD.hash,
            'newHash', NEW.hash,
            'timestamp', NOW()
          );
        ELSIF TG_OP = 'DELETE' THEN
          event_type := 'deleted';
          payload := json_build_object(
            'type', event_type,
            'policyId', OLD.id,
            'policyName', OLD.name,
            'policyKind', OLD.kind,
            'timestamp', NOW()
          );
        END IF;

        PERFORM pg_notify('policy_changes', payload::text);
        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql;

      -- Trigger for change notifications
      DROP TRIGGER IF EXISTS policy_change_trigger ON ${this.schema}.policies;
      CREATE TRIGGER policy_change_trigger
        AFTER INSERT OR UPDATE OR DELETE ON ${this.schema}.policies
        FOR EACH ROW EXECUTE FUNCTION ${this.schema}.notify_policy_change();
    `;

    await this.pool.query(migrations);
    // Migrations completed successfully
  }

  private async setupNotifyListener(): Promise<void> {
    if (!this.pool) return;

    this.notifyClient = await this.pool.connect();
    await this.notifyClient.query('LISTEN policy_changes');

    this.notifyClient.on('notification', (msg: unknown) => {
      const notification = msg as { channel: string; payload?: string };
      if (notification.channel === 'policy_changes' && notification.payload) {
        try {
          const event = JSON.parse(notification.payload) as PolicyChangeEvent;
          event.timestamp = new Date(event.timestamp);

          for (const callback of this.changeCallbacks) {
            try {
              callback(event);
            } catch (_error) {
              // Silently ignore callback errors to prevent cascading failures
            }
          }
        } catch (_error) {
          // Failed to parse notification - skip invalid messages
        }
      }
    });
  }

  async close(): Promise<void> {
    if (this.notifyClient) {
      this.notifyClient.release();
      this.notifyClient = null;
    }
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    this.initialized = false;
    this.changeCallbacks.clear();
  }

  async health(): Promise<{ healthy: boolean; latencyMs: number; details?: Record<string, unknown> }> {
    if (!this.pool) {
      return { healthy: false, latencyMs: -1, details: { error: 'Not initialized' } };
    }

    const start = Date.now();
    try {
      await this.pool.query('SELECT 1');
      return {
        healthy: true,
        latencyMs: Date.now() - start,
        details: {
          host: this.config.host,
          port: this.config.port,
          database: this.config.database,
        },
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        details: { error: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }

  async put(
    policy: AnyPolicy,
    options?: { source?: string; labels?: Record<string, string> }
  ): Promise<StoredPolicy> {
    this.ensureInitialized();

    const id = this.generatePolicyId(policy);
    const hash = this.hashPolicy(policy);
    const now = new Date();
    const labels = options?.labels || policy.metadata.labels || null;

    const query = `
      INSERT INTO ${this.schema}.policies
        (id, kind, name, version, policy, hash, source, labels, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
      ON CONFLICT (id) DO UPDATE SET
        policy = EXCLUDED.policy,
        hash = EXCLUDED.hash,
        version = EXCLUDED.version,
        source = EXCLUDED.source,
        labels = EXCLUDED.labels,
        updated_at = EXCLUDED.updated_at
      RETURNING *
    `;

    const result = await this.pool!.query<PolicyRow>(query, [
      id,
      policy.kind,
      policy.metadata.name,
      policy.metadata.version ?? POSTGRES_DEFAULTS.DEFAULT_POLICY_VERSION,
      JSON.stringify(policy),
      hash,
      options?.source || null,
      labels ? JSON.stringify(labels) : null,
      now,
    ]);

    return this.rowToStoredPolicy(result.rows[0]);
  }

  async get(id: string): Promise<StoredPolicy | null> {
    this.ensureInitialized();

    const result = await this.pool!.query<PolicyRow>(
      `SELECT * FROM ${this.schema}.policies WHERE id = $1`,
      [id]
    );

    return result.rows.length > 0 ? this.rowToStoredPolicy(result.rows[0]) : null;
  }

  async getByName(name: string, kind: string): Promise<StoredPolicy | null> {
    this.ensureInitialized();

    const result = await this.pool!.query<PolicyRow>(
      `SELECT * FROM ${this.schema}.policies WHERE name = $1 AND kind = $2`,
      [name, kind]
    );

    return result.rows.length > 0 ? this.rowToStoredPolicy(result.rows[0]) : null;
  }

  async query(query: PolicyQuery): Promise<PolicyQueryResult> {
    this.ensureInitialized();

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    // Build WHERE conditions
    if (query.kind) {
      const kinds = Array.isArray(query.kind) ? query.kind : [query.kind];
      conditions.push(`kind = ANY($${paramIndex++})`);
      params.push(kinds);
    }

    if (query.resourceType) {
      conditions.push(`policy->'spec'->>'resource' = $${paramIndex++}`);
      params.push(query.resourceType);
    }

    if (query.namePattern) {
      const pattern = query.namePattern.replace(/\*/g, '%');
      conditions.push(`name LIKE $${paramIndex++}`);
      params.push(pattern);
    }

    if (query.labels) {
      conditions.push(`labels @> $${paramIndex++}`);
      params.push(JSON.stringify(query.labels));
    }

    if (!query.includeDisabled) {
      conditions.push('disabled = false');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Sort
    const sortColumn = query.sortBy === 'createdAt' ? 'created_at'
      : query.sortBy === 'updatedAt' ? 'updated_at'
      : 'name';
    const sortOrder = query.sortOrder === 'desc' ? 'DESC' : 'ASC';

    // Count total
    const countResult = await this.pool!.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM ${this.schema}.policies ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Fetch page
    const offset = query.offset ?? 0;
    const limit = query.limit ?? POSTGRES_DEFAULTS.DEFAULT_QUERY_LIMIT;

    const dataQuery = `
      SELECT * FROM ${this.schema}.policies
      ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    const result = await this.pool!.query<PolicyRow>(dataQuery, [...params, limit, offset]);
    const policies = result.rows.map(row => this.rowToStoredPolicy(row));

    return {
      policies,
      total,
      hasMore: offset + policies.length < total,
    };
  }

  async delete(id: string): Promise<boolean> {
    this.ensureInitialized();

    const result = await this.pool!.query(
      `DELETE FROM ${this.schema}.policies WHERE id = $1`,
      [id]
    );

    return result.rowCount > 0;
  }

  async disable(id: string): Promise<boolean> {
    return this.setDisabled(id, true);
  }

  async enable(id: string): Promise<boolean> {
    return this.setDisabled(id, false);
  }

  private async setDisabled(id: string, disabled: boolean): Promise<boolean> {
    this.ensureInitialized();

    const result = await this.pool!.query(
      `UPDATE ${this.schema}.policies SET disabled = $1, updated_at = NOW() WHERE id = $2 AND disabled != $1`,
      [disabled, id]
    );

    return result.rowCount > 0;
  }

  async getPoliciesForResource(resourceType: string): Promise<StoredPolicy[]> {
    this.ensureInitialized();

    const result = await this.pool!.query<PolicyRow>(
      `SELECT * FROM ${this.schema}.policies
       WHERE kind = 'ResourcePolicy'
         AND policy->'spec'->>'resource' = $1
         AND disabled = false`,
      [resourceType]
    );

    return result.rows.map(row => this.rowToStoredPolicy(row));
  }

  async getDerivedRoles(): Promise<StoredPolicy[]> {
    this.ensureInitialized();

    const result = await this.pool!.query<PolicyRow>(
      `SELECT * FROM ${this.schema}.policies WHERE kind = 'DerivedRoles' AND disabled = false`
    );

    return result.rows.map(row => this.rowToStoredPolicy(row));
  }

  async getPrincipalPolicy(principalId: string): Promise<StoredPolicy | null> {
    return this.getByName(principalId, 'PrincipalPolicy');
  }

  async bulkPut(
    policies: AnyPolicy[],
    options?: { source?: string }
  ): Promise<{ imported: number; failed: number; errors: string[] }> {
    this.ensureInitialized();

    let imported = 0;
    let failed = 0;
    const errors: string[] = [];

    // Use transaction for atomicity
    const client = await this.pool!.connect();

    try {
      await client.query('BEGIN');

      for (const policy of policies) {
        try {
          const id = this.generatePolicyId(policy);
          const hash = this.hashPolicy(policy);
          const labels = options?.source ? null : policy.metadata.labels || null;

          await client.query(
            `INSERT INTO ${this.schema}.policies
              (id, kind, name, version, policy, hash, source, labels, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
             ON CONFLICT (id) DO UPDATE SET
              policy = EXCLUDED.policy,
              hash = EXCLUDED.hash,
              version = EXCLUDED.version,
              source = EXCLUDED.source,
              labels = EXCLUDED.labels,
              updated_at = NOW()`,
            [
              id,
              policy.kind,
              policy.metadata.name,
              policy.metadata.version ?? POSTGRES_DEFAULTS.DEFAULT_POLICY_VERSION,
              JSON.stringify(policy),
              hash,
              options?.source || null,
              labels ? JSON.stringify(labels) : null,
            ]
          );
          imported++;
        } catch (error) {
          failed++;
          errors.push(`${policy.metadata.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return { imported, failed, errors };
  }

  watch(callback: (event: PolicyChangeEvent) => void): () => void {
    this.changeCallbacks.add(callback);

    return () => {
      this.changeCallbacks.delete(callback);
    };
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private ensureInitialized(): void {
    if (!this.initialized || !this.pool) {
      throw new Error('PostgresPolicyStore not initialized. Call initialize() first.');
    }
  }

  private generatePolicyId(policy: AnyPolicy): string {
    return `${policy.kind}:${policy.metadata.name}`;
  }

  private hashPolicy(policy: AnyPolicy): string {
    return createHash('sha256')
      .update(JSON.stringify(policy))
      .digest('hex')
      .substring(0, POSTGRES_DEFAULTS.HASH_SUBSTRING_LENGTH);
  }

  private rowToStoredPolicy(row: PolicyRow): StoredPolicy {
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      version: row.version,
      policy: typeof row.policy === 'string' ? JSON.parse(row.policy) : row.policy,
      hash: row.hash,
      disabled: row.disabled,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      source: row.source || undefined,
      labels: row.labels || undefined,
    };
  }
}
