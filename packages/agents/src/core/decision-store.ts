/**
 * Decision Store - Persistence layer for authorization decisions
 *
 * Stores decisions with vector embeddings for:
 * - Pattern learning by ANALYST
 * - Anomaly detection by GUARDIAN
 * - Explanation context for ADVISOR
 */

import type { Pool, PoolConfig } from 'pg';
import type { ActionResult as CoreActionResult } from '@authz-engine/core';
import type {
  DecisionRecord,
  DecisionOutcome,
  DecisionFeedback,
  Anomaly,
  LearnedPattern,
  EnforcerAction,
} from '../types/agent.types.js';

export interface DecisionStoreConfig {
  /** Store type - 'memory' for in-memory, 'postgres' for database */
  type?: 'memory' | 'postgres';
  /** PostgreSQL connection config (required for type: 'postgres') */
  database?: PoolConfig;
  /** Enable vector search with pgvector (postgres only) */
  enableVectorSearch?: boolean;
  /** Vector embedding dimension (default: 1536 for OpenAI) */
  embeddingDimension?: number;
  /** How long to retain decision records */
  retentionDays: number;
}

export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
}

export interface DecisionQuery {
  principalId?: string;
  resourceKind?: string;
  action?: string;
  allowed?: boolean;
  fromDate?: Date;
  toDate?: Date;
  hasAnomaly?: boolean;
  minAnomalyScore?: number;
}

export class DecisionStore {
  private pool: Pool | null = null;
  private config: DecisionStoreConfig;

  // In-memory storage (used when type is 'memory')
  private memoryStore: {
    decisions: Map<string, DecisionRecord>;
    anomalies: Map<string, Anomaly>;
    patterns: Map<string, LearnedPattern>;
    actions: Map<string, EnforcerAction>;
  } = {
    decisions: new Map(),
    anomalies: new Map(),
    patterns: new Map(),
    actions: new Map(),
  };

  constructor(config: DecisionStoreConfig) {
    this.config = config;
  }

  /** Check if using in-memory mode */
  private isMemoryMode(): boolean {
    return this.config.type === 'memory' || !this.config.database;
  }

  /**
   * Initialize the store and create tables if needed
   */
  async initialize(): Promise<void> {
    // For memory mode, no initialization needed
    if (this.isMemoryMode()) {
      console.log('[DecisionStore] Using in-memory storage');
      return;
    }

    // For postgres mode, initialize the pool
    if (!this.config.database) {
      throw new Error('Database config required for postgres mode');
    }

    // Dynamic import to avoid issues when pg is not installed
    const { Pool } = await import('pg');
    this.pool = new Pool(this.config.database);

    await this.createTables();

    if (this.config.enableVectorSearch) {
      await this.enableVectorExtension();
    }
  }

  /**
   * Close the store
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  /**
   * Store a decision record
   */
  async storeDecision(decision: DecisionRecord): Promise<void> {
    // Memory mode
    if (this.isMemoryMode()) {
      this.memoryStore.decisions.set(decision.id, decision);
      return;
    }

    // Postgres mode
    if (!this.pool) throw new Error('Store not initialized');

    const query = `
      INSERT INTO authz_decisions (
        id, request_id, timestamp, principal_id, principal_roles, principal_attributes,
        resource_kind, resource_id, resource_attributes, actions, results,
        derived_roles, matched_policies, enrichment_data, anomaly_score, risk_factors,
        embedding
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
      )
      ON CONFLICT (id) DO UPDATE SET
        anomaly_score = EXCLUDED.anomaly_score,
        risk_factors = EXCLUDED.risk_factors,
        enrichment_data = EXCLUDED.enrichment_data
    `;

    await this.pool.query(query, [
      decision.id,
      decision.requestId,
      decision.timestamp,
      decision.principal.id,
      JSON.stringify(decision.principal.roles),
      JSON.stringify(decision.principal.attributes),
      decision.resource.kind,
      decision.resource.id,
      JSON.stringify(decision.resource.attributes),
      JSON.stringify(decision.actions),
      JSON.stringify(decision.results),
      JSON.stringify(decision.derivedRoles),
      JSON.stringify(decision.matchedPolicies),
      decision.enrichmentData ? JSON.stringify(decision.enrichmentData) : null,
      decision.anomalyScore,
      decision.riskFactors ? JSON.stringify(decision.riskFactors) : null,
      decision.embedding ? JSON.stringify(decision.embedding) : null,
    ]);
  }

  /**
   * Record decision outcome (for learning)
   */
  async recordOutcome(decisionId: string, outcome: DecisionOutcome): Promise<void> {
    if (!this.pool) throw new Error('Store not initialized');

    await this.pool.query(
      `UPDATE authz_decisions
       SET outcome = $2, outcome_recorded_at = $3
       WHERE id = $1`,
      [decisionId, JSON.stringify(outcome), outcome.recordedAt]
    );
  }

  /**
   * Record feedback on a decision
   */
  async recordFeedback(decisionId: string, feedback: DecisionFeedback): Promise<void> {
    if (!this.pool) throw new Error('Store not initialized');

    await this.pool.query(
      `UPDATE authz_decisions
       SET feedback = $2, feedback_recorded_at = $3
       WHERE id = $1`,
      [decisionId, JSON.stringify(feedback), feedback.providedAt]
    );
  }

  /**
   * Query decisions
   */
  async queryDecisions(query: DecisionQuery, options: QueryOptions = {}): Promise<DecisionRecord[]> {
    if (!this.pool) throw new Error('Store not initialized');

    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (query.principalId) {
      conditions.push(`principal_id = $${paramIndex++}`);
      params.push(query.principalId);
    }
    if (query.resourceKind) {
      conditions.push(`resource_kind = $${paramIndex++}`);
      params.push(query.resourceKind);
    }
    if (query.action) {
      conditions.push(`$${paramIndex++} = ANY(actions)`);
      params.push(query.action);
    }
    if (query.fromDate) {
      conditions.push(`timestamp >= $${paramIndex++}`);
      params.push(query.fromDate);
    }
    if (query.toDate) {
      conditions.push(`timestamp <= $${paramIndex++}`);
      params.push(query.toDate);
    }
    if (query.minAnomalyScore !== undefined) {
      conditions.push(`anomaly_score >= $${paramIndex++}`);
      params.push(query.minAnomalyScore);
    }

    const orderBy = options.orderBy || 'timestamp';
    const orderDir = options.orderDirection || 'desc';
    const limit = options.limit || 100;
    const offset = options.offset || 0;

    const sql = `
      SELECT * FROM authz_decisions
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderBy} ${orderDir}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const result = await this.pool.query(sql, params);
    return result.rows.map(this.rowToDecision);
  }

  /**
   * Find similar decisions using vector search
   */
  async findSimilarDecisions(
    embedding: number[],
    limit = 10,
    threshold = 0.8,
  ): Promise<DecisionRecord[]> {
    if (!this.pool) throw new Error('Store not initialized');
    if (!this.config.enableVectorSearch) {
      throw new Error('Vector search not enabled');
    }

    const sql = `
      SELECT *, 1 - (embedding <=> $1::vector) as similarity
      FROM authz_decisions
      WHERE embedding IS NOT NULL
        AND 1 - (embedding <=> $1::vector) >= $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    `;

    const result = await this.pool.query(sql, [
      JSON.stringify(embedding),
      threshold,
      limit,
    ]);

    return result.rows.map(this.rowToDecision);
  }

  /**
   * Store an anomaly
   */
  async storeAnomaly(anomaly: Anomaly): Promise<void> {
    // Memory mode
    if (this.isMemoryMode()) {
      this.memoryStore.anomalies.set(anomaly.id, anomaly);
      return;
    }

    // Postgres mode
    if (!this.pool) throw new Error('Store not initialized');

    await this.pool.query(
      `INSERT INTO authz_anomalies (
        id, detected_at, type, severity, principal_id, resource_kind, action,
        description, score, evidence, baseline, observed, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        anomaly.id,
        anomaly.detectedAt,
        anomaly.type,
        anomaly.severity,
        anomaly.principalId,
        anomaly.resourceKind,
        anomaly.action,
        anomaly.description,
        anomaly.score,
        JSON.stringify(anomaly.evidence),
        JSON.stringify(anomaly.baseline),
        JSON.stringify(anomaly.observed),
        anomaly.status,
      ]
    );
  }

  /**
   * Update anomaly status
   */
  async updateAnomalyStatus(
    anomalyId: string,
    status: Anomaly['status'],
    resolution?: string,
  ): Promise<void> {
    if (!this.pool) throw new Error('Store not initialized');

    await this.pool.query(
      `UPDATE authz_anomalies
       SET status = $2, resolved_at = $3, resolution = $4
       WHERE id = $1`,
      [anomalyId, status, status === 'resolved' ? new Date() : null, resolution]
    );
  }

  /**
   * Store a learned pattern
   */
  async storePattern(pattern: LearnedPattern): Promise<void> {
    // Memory mode
    if (this.isMemoryMode()) {
      this.memoryStore.patterns.set(pattern.id, pattern);
      return;
    }

    // Postgres mode
    if (!this.pool) throw new Error('Store not initialized');

    await this.pool.query(
      `INSERT INTO authz_patterns (
        id, discovered_at, last_updated, type, confidence, sample_size,
        description, conditions, suggested_policy_rule, suggested_optimization, is_approved
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        last_updated = EXCLUDED.last_updated,
        confidence = EXCLUDED.confidence,
        sample_size = EXCLUDED.sample_size`,
      [
        pattern.id,
        pattern.discoveredAt,
        pattern.lastUpdated,
        pattern.type,
        pattern.confidence,
        pattern.sampleSize,
        pattern.description,
        JSON.stringify(pattern.conditions),
        pattern.suggestedPolicyRule,
        pattern.suggestedOptimization,
        pattern.isApproved,
      ]
    );
  }

  /**
   * Store an enforcer action
   */
  async storeAction(action: EnforcerAction): Promise<void> {
    // Memory mode
    if (this.isMemoryMode()) {
      this.memoryStore.actions.set(action.id, action);
      return;
    }

    // Postgres mode
    if (!this.pool) throw new Error('Store not initialized');

    await this.pool.query(
      `INSERT INTO authz_actions (
        id, triggered_at, type, priority, triggered_by, status, can_rollback
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        action.id,
        action.triggeredAt,
        action.type,
        action.priority,
        JSON.stringify(action.triggeredBy),
        action.status,
        action.canRollback,
      ]
    );
  }

  /**
   * Get aggregate stats for a principal
   */
  async getPrincipalStats(
    principalId: string,
    periodDays: number,
  ): Promise<{
    totalRequests: number;
    uniqueResources: number;
    denialRate: number;
    commonActions: string[];
    avgAnomalyScore: number;
  }> {
    if (!this.pool) throw new Error('Store not initialized');

    const result = await this.pool.query(
      `SELECT
        COUNT(*) as total_requests,
        COUNT(DISTINCT resource_id) as unique_resources,
        AVG(anomaly_score) as avg_anomaly_score,
        SUM(CASE WHEN (results->>'allowed')::boolean = false THEN 1 ELSE 0 END)::float / COUNT(*) as denial_rate
       FROM authz_decisions
       WHERE principal_id = $1
         AND timestamp >= NOW() - INTERVAL '${periodDays} days'`,
      [principalId]
    );

    const actionsResult = await this.pool.query(
      `SELECT unnest(actions) as action, COUNT(*) as cnt
       FROM authz_decisions
       WHERE principal_id = $1
         AND timestamp >= NOW() - INTERVAL '${periodDays} days'
       GROUP BY action
       ORDER BY cnt DESC
       LIMIT 10`,
      [principalId]
    );

    return {
      totalRequests: parseInt(result.rows[0].total_requests, 10),
      uniqueResources: parseInt(result.rows[0].unique_resources, 10),
      denialRate: parseFloat(result.rows[0].denial_rate) || 0,
      avgAnomalyScore: parseFloat(result.rows[0].avg_anomaly_score) || 0,
      commonActions: actionsResult.rows.map(r => r.action),
    };
  }

  private async createTables(): Promise<void> {
    if (!this.pool) return;

    // Decisions table
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS authz_decisions (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        principal_id TEXT NOT NULL,
        principal_roles JSONB NOT NULL,
        principal_attributes JSONB,
        resource_kind TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        resource_attributes JSONB,
        actions JSONB NOT NULL,
        results JSONB NOT NULL,
        derived_roles JSONB,
        matched_policies JSONB,
        enrichment_data JSONB,
        anomaly_score FLOAT,
        risk_factors JSONB,
        embedding VECTOR(${this.config.embeddingDimension}),
        outcome JSONB,
        outcome_recorded_at TIMESTAMPTZ,
        feedback JSONB,
        feedback_recorded_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Indexes
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_decisions_principal ON authz_decisions(principal_id);
      CREATE INDEX IF NOT EXISTS idx_decisions_resource ON authz_decisions(resource_kind, resource_id);
      CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON authz_decisions(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_decisions_anomaly ON authz_decisions(anomaly_score) WHERE anomaly_score IS NOT NULL;
    `);

    // Anomalies table
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS authz_anomalies (
        id TEXT PRIMARY KEY,
        detected_at TIMESTAMPTZ NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        resource_kind TEXT,
        action TEXT,
        description TEXT NOT NULL,
        score FLOAT NOT NULL,
        evidence JSONB NOT NULL,
        baseline JSONB NOT NULL,
        observed JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        resolved_at TIMESTAMPTZ,
        resolution TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Patterns table
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS authz_patterns (
        id TEXT PRIMARY KEY,
        discovered_at TIMESTAMPTZ NOT NULL,
        last_updated TIMESTAMPTZ NOT NULL,
        type TEXT NOT NULL,
        confidence FLOAT NOT NULL,
        sample_size INT NOT NULL,
        description TEXT NOT NULL,
        conditions JSONB NOT NULL,
        suggested_policy_rule TEXT,
        suggested_optimization TEXT,
        validated_at TIMESTAMPTZ,
        validated_by TEXT,
        is_approved BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Actions table
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS authz_actions (
        id TEXT PRIMARY KEY,
        triggered_at TIMESTAMPTZ NOT NULL,
        type TEXT NOT NULL,
        priority TEXT NOT NULL,
        triggered_by JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        executed_at TIMESTAMPTZ,
        result JSONB,
        can_rollback BOOLEAN DEFAULT FALSE,
        rolled_back_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  }

  private async enableVectorExtension(): Promise<void> {
    if (!this.pool) return;

    try {
      await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    } catch (error) {
      console.warn('Could not enable pgvector extension. Vector search will be disabled.');
    }
  }

  private rowToDecision(row: Record<string, unknown>): DecisionRecord {
    return {
      id: row.id as string,
      requestId: row.request_id as string,
      timestamp: new Date(row.timestamp as string),
      principal: {
        id: row.principal_id as string,
        roles: row.principal_roles as string[],
        attributes: row.principal_attributes as Record<string, unknown> || {},
      },
      resource: {
        kind: row.resource_kind as string,
        id: row.resource_id as string,
        attributes: row.resource_attributes as Record<string, unknown> || {},
      },
      actions: row.actions as string[],
      results: row.results as Record<string, CoreActionResult>,
      derivedRoles: row.derived_roles as string[] || [],
      matchedPolicies: row.matched_policies as string[] || [],
      enrichmentData: row.enrichment_data as Record<string, unknown>,
      anomalyScore: row.anomaly_score as number,
      riskFactors: row.risk_factors as DecisionRecord['riskFactors'],
      embedding: row.embedding as number[],
      outcome: row.outcome as DecisionOutcome,
      feedback: row.feedback as DecisionFeedback,
    };
  }
}
