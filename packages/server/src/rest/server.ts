import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { DecisionEngine } from '@authz-engine/core';
import type { CheckRequest, CheckResponse, ActionResult, Principal, Resource } from '@authz-engine/core';
import { Logger } from '../utils/logger';
import type { AgentOrchestrator } from '@authz-engine/agents';
import type { LearnedPattern, Anomaly, EnforcerAction } from '@authz-engine/agents';

/**
 * REST Server for AuthZ Engine
 *
 * Provides HTTP/REST API compatible with Cerbos REST API format.
 * Extended with agentic authorization endpoints.
 */
export class RestServer {
  private server: FastifyInstance;
  private engine: DecisionEngine;
  private logger: Logger;
  private startTime: number;
  private orchestrator?: AgentOrchestrator;

  constructor(engine: DecisionEngine, logger: Logger, orchestrator?: AgentOrchestrator) {
    this.engine = engine;
    this.logger = logger;
    this.orchestrator = orchestrator;
    this.startTime = Date.now();
    this.server = Fastify({
      logger: false, // We use our own logger
    });

    this.setupRoutes();
    if (this.orchestrator) {
      this.setupAgenticRoutes();
    }
  }

  /**
   * Setup REST routes
   */
  private setupRoutes(): void {
    // CORS
    this.server.register(cors, {
      origin: true,
      methods: ['GET', 'POST'],
    });

    // Health check
    this.server.get('/health', async () => {
      const stats = this.engine.getStats();
      return {
        status: 'healthy',
        version: '0.1.0',
        policies_loaded: stats.resourcePolicies + stats.derivedRolesPolicies,
        uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
      };
    });

    // Ready check
    this.server.get('/ready', async () => {
      const stats = this.engine.getStats();
      const ready = stats.resourcePolicies > 0;
      return {
        ready,
        policies_loaded: stats.resourcePolicies + stats.derivedRolesPolicies,
      };
    });

    // Check authorization (Cerbos-compatible)
    this.server.post<{ Body: CheckRequestBody }>('/api/check', async (request, reply) => {
      try {
        const body = request.body;
        const checkRequest = this.transformRequest(body);
        const response = this.engine.check(checkRequest);

        return {
          requestId: response.requestId,
          results: this.transformResults(response.results),
          meta: {
            evaluationDurationMs: response.meta?.evaluationDurationMs,
            policiesEvaluated: response.meta?.policiesEvaluated,
          },
        };
      } catch (error) {
        this.logger.error('Check failed', error);
        reply.status(400).send({
          error: error instanceof Error ? error.message : 'Invalid request',
        });
      }
    });

    // Batch check
    this.server.post<{ Body: BatchCheckRequestBody }>('/api/check/batch', async (request, reply) => {
      try {
        const body = request.body;
        const principal = this.transformPrincipal(body.principal);
        const results: Record<string, any> = {};

        for (const item of body.resources) {
          const resource = this.transformResource(item.resource);
          const checkRequest: CheckRequest = {
            requestId: body.requestId,
            principal,
            resource,
            actions: item.actions,
          };
          const response = this.engine.check(checkRequest);
          results[`${resource.kind}:${resource.id}`] = this.transformResults(response.results);
        }

        return {
          requestId: body.requestId || `batch-${Date.now()}`,
          results,
        };
      } catch (error) {
        this.logger.error('Batch check failed', error);
        reply.status(400).send({
          error: error instanceof Error ? error.message : 'Invalid request',
        });
        return;
      }
    });

    // Playground endpoint (for testing)
    this.server.post<{ Body: PlaygroundRequestBody }>('/api/playground/evaluate', async (request, reply) => {
      try {
        const { principal, resource, actions } = request.body;
        const checkRequest: CheckRequest = {
          principal: this.transformPrincipal(principal),
          resource: this.transformResource(resource),
          actions,
        };
        const response = this.engine.check(checkRequest);

        return {
          decision: response,
          effectiveRoles: response.results[actions[0]]?.meta?.effectiveDerivedRoles || [],
          policiesMatched: response.meta?.policiesEvaluated || [],
        };
      } catch (error) {
        this.logger.error('Playground evaluate failed', error);
        reply.status(400).send({
          error: error instanceof Error ? error.message : 'Invalid request',
        });
      }
    });

    // Policy info endpoint
    this.server.get('/api/policies', async () => {
      const stats = this.engine.getStats();
      return {
        resourcePolicies: stats.resourcePolicies,
        derivedRolesPolicies: stats.derivedRolesPolicies,
        resources: stats.resources,
      };
    });
  }

  /**
   * Start the REST server
   */
  async start(port: number = 3592): Promise<void> {
    try {
      await this.server.listen({ port, host: '0.0.0.0' });
      this.logger.info(`REST server listening on port ${port}`);
    } catch (error) {
      this.logger.error('Failed to start REST server', error);
      throw error;
    }
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    await this.server.close();
    this.logger.info('REST server stopped');
  }

  /**
   * Transform REST request to engine request
   */
  private transformRequest(body: CheckRequestBody): CheckRequest {
    return {
      requestId: body.requestId,
      principal: this.transformPrincipal(body.principal),
      resource: this.transformResource(body.resource),
      actions: body.actions,
      auxData: body.auxData,
    };
  }

  /**
   * Transform REST principal
   */
  private transformPrincipal(p: any): Principal {
    return {
      id: p.id,
      roles: p.roles || [],
      attributes: p.attr || p.attributes || {},
    };
  }

  /**
   * Transform REST resource
   */
  private transformResource(r: any): Resource {
    return {
      kind: r.kind,
      id: r.id,
      attributes: r.attr || r.attributes || {},
    };
  }

  /**
   * Transform engine results to REST format
   */
  private transformResults(results: Record<string, any>): Record<string, any> {
    const transformed: Record<string, any> = {};
    for (const [action, result] of Object.entries(results)) {
      transformed[action] = {
        effect: result.effect.toUpperCase(),
        policy: result.policy,
        meta: result.meta,
      };
    }
    return transformed;
  }

  /**
   * Setup agentic authorization routes
   * These endpoints provide access to the agent pipeline features:
   * - GUARDIAN: Anomaly detection
   * - ANALYST: Pattern learning
   * - ADVISOR: Decision explanations
   * - ENFORCER: Rate limiting and blocks
   */
  private setupAgenticRoutes(): void {
    // POST /v1/check/agentic - Check with full agent pipeline
    this.server.post<{ Body: AgenticCheckRequestBody }>(
      '/v1/check/agentic',
      async (request, reply) => {
        if (!this.orchestrator) {
          reply.status(503).send({ error: 'Agentic features not available' });
          return;
          return;
        }

        try {
          const body = request.body;
          const checkRequest = this.transformRequest(body);

          // First, run the standard check
          const response = this.engine.check(checkRequest);

          // Then, process through the agent pipeline
          const agenticResult = await this.orchestrator.processRequest(
            checkRequest,
            response,
            {
              includeExplanation: body.includeExplanation ?? true,
              policyContext: {
                matchedRules: response.meta?.policiesEvaluated || [],
                derivedRoles: [],
              },
            },
          );

          return {
            requestId: response.requestId,
            results: this.transformResults(response.results),
            meta: {
              evaluationDurationMs: response.meta?.evaluationDurationMs,
              policiesEvaluated: response.meta?.policiesEvaluated,
            },
            agentic: {
              anomalyScore: agenticResult.anomalyScore,
              anomaly: agenticResult.anomaly,
              explanation: agenticResult.explanation,
              enforcement: agenticResult.enforcement,
              processingTimeMs: agenticResult.processingTimeMs,
              agentsInvolved: agenticResult.agentsInvolved,
            },
          };
        } catch (error) {
          this.logger.error('Agentic check failed', error);
          reply.status(400).send({
            error: error instanceof Error ? error.message : 'Invalid request',
          });
        }
      },
    );

    // GET /v1/agents/health - Agent health status
    this.server.get('/v1/agents/health', async (request, reply) => {
      if (!this.orchestrator) {
        reply.status(503).send({ error: 'Agentic features not available' });
          return;
        return;
      }

      try {
        const health = await this.orchestrator.getHealth();
        return {
          status: health.status,
          agents: health.agents,
          infrastructure: health.infrastructure,
          uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
        };
      } catch (error) {
        this.logger.error('Health check failed', error);
        reply.status(500).send({
          error: error instanceof Error ? error.message : 'Health check failed',
        });
      }
    });

    /**
     * GET /v1/agents/patterns - List all discovered patterns from ANALYST agent
     * Supports optional query parameters to filter patterns
     */
    this.server.get<{ Querystring: { type?: string; approved?: string } }>(
      '/v1/agents/patterns',
      async (request, reply) => {
        if (!this.orchestrator) {
          reply.status(503).send({ error: 'Agentic features not available' });
          return;
          return;
        }

        try {
          const { type, approved } = request.query;
          let patterns = this.orchestrator.getPatterns();

          // Apply filters if provided
          if (type) {
            patterns = patterns.filter((p: LearnedPattern) => p.type === type);
          }
          if (approved !== undefined) {
            const isApproved = approved === 'true';
            patterns = patterns.filter((p: LearnedPattern) => p.isApproved === isApproved);
          }

          return {
            count: patterns.length,
            filters: { type, approved },
            patterns: patterns.map((p: LearnedPattern) => ({
              id: p.id,
              type: p.type,
              description: p.description,
              confidence: p.confidence,
              sampleSize: p.sampleSize,
              discoveredAt: p.discoveredAt,
              lastUpdated: p.lastUpdated,
              isApproved: p.isApproved,
              validatedAt: p.validatedAt,
              validatedBy: p.validatedBy,
              suggestedPolicyRule: p.suggestedPolicyRule,
              suggestedOptimization: p.suggestedOptimization,
            })),
          };
        } catch (error) {
          this.logger.error('Get patterns failed', error);
          reply.status(500).send({
            error: error instanceof Error ? error.message : 'Failed to get patterns',
          });
        }
      },
    );

    /**
     * POST /v1/agents/patterns/:id/validate - Approve or reject a discovered pattern
     */
    this.server.post<{ Params: { id: string }; Body: ValidatePatternRequestBody }>(
      '/v1/agents/patterns/:id/validate',
      async (request, reply) => {
        if (!this.orchestrator) {
          reply.status(503).send({ error: 'Agentic features not available' });
          return;
          return;
        }

        try {
          const { id } = request.params;
          const { approved, validatedBy } = request.body;

          if (approved === undefined || !validatedBy) {
            reply.status(400).send({ error: 'approved (boolean) and validatedBy are required' });
          return;
            return;
          }

          await this.orchestrator.validatePattern(id, approved, validatedBy);

          return {
            message: approved ? 'Pattern approved' : 'Pattern rejected',
            patternId: id,
            approved,
            validatedBy,
            validatedAt: new Date().toISOString(),
          };
        } catch (error) {
          this.logger.error('Validate pattern failed', error);
          reply.status(500).send({
            error: error instanceof Error ? error.message : 'Failed to validate pattern',
          });
        }
      },
    );

    // POST /v1/agents/patterns/discover - Trigger pattern discovery
    this.server.post('/v1/agents/patterns/discover', async (request, reply) => {
      if (!this.orchestrator) {
        reply.status(503).send({ error: 'Agentic features not available' });
          return;
        return;
      }

      try {
        const patterns = await this.orchestrator.discoverPatterns();
        return {
          message: 'Pattern discovery completed',
          discovered: patterns.length,
          patterns: patterns.map((p: LearnedPattern) => ({
            id: p.id,
            type: p.type,
            description: p.description,
            confidence: p.confidence,
          })),
        };
      } catch (error) {
        this.logger.error('Pattern discovery failed', error);
        reply.status(500).send({
          error: error instanceof Error ? error.message : 'Pattern discovery failed',
        });
      }
    });

    /**
     * GET /v1/agents/anomalies - List all detected anomalies
     * Supports optional query parameter principalId to filter by principal
     */
    this.server.get<{ Querystring: { principalId?: string; status?: string; limit?: string } }>(
      '/v1/agents/anomalies',
      async (request, reply) => {
        if (!this.orchestrator) {
          reply.status(503).send({ error: 'Agentic features not available' });
          return;
          return;
        }

        try {
          const { principalId, status, limit } = request.query;
          const anomalies = await this.orchestrator.getAllAnomalies({
            principalId,
            status: status as Anomaly['status'],
            limit: limit ? parseInt(limit, 10) : undefined,
          });
          return {
            count: anomalies.length,
            filters: { principalId, status, limit },
            anomalies: anomalies.map((a: Anomaly) => ({
              id: a.id,
              type: a.type,
              severity: a.severity,
              description: a.description,
              score: a.score,
              detectedAt: a.detectedAt,
              status: a.status,
              principalId: a.principalId,
              resourceKind: a.resourceKind,
              action: a.action,
            })),
          };
        } catch (error) {
          this.logger.error('Get anomalies failed', error);
          reply.status(500).send({
            error: error instanceof Error ? error.message : 'Failed to get anomalies',
          });
        }
      },
    );

    /**
     * GET /v1/agents/anomalies/:id - Get specific anomaly details
     */
    this.server.get<{ Params: { id: string } }>(
      '/v1/agents/anomalies/:id',
      async (request, reply) => {
        if (!this.orchestrator) {
          reply.status(503).send({ error: 'Agentic features not available' });
          return;
          return;
        }

        try {
          const { id } = request.params;
          const anomaly = await this.orchestrator.getAnomalyById(id);

          if (!anomaly) {
            reply.status(404).send({ error: 'Anomaly not found' });
          return;
            return;
          }

          return {
            id: anomaly.id,
            type: anomaly.type,
            severity: anomaly.severity,
            description: anomaly.description,
            score: anomaly.score,
            detectedAt: anomaly.detectedAt,
            status: anomaly.status,
            principalId: anomaly.principalId,
            resourceKind: anomaly.resourceKind,
            action: anomaly.action,
            evidence: anomaly.evidence,
            baseline: anomaly.baseline,
            observed: anomaly.observed,
            resolvedAt: anomaly.resolvedAt,
            resolution: anomaly.resolution,
          };
        } catch (error) {
          this.logger.error('Get anomaly by ID failed', error);
          reply.status(500).send({
            error: error instanceof Error ? error.message : 'Failed to get anomaly',
          });
        }
      },
    );

    /**
     * POST /v1/agents/anomalies/:id/resolve - Resolve an anomaly
     */
    this.server.post<{ Params: { id: string }; Body: ResolveAnomalyRequestBody }>(
      '/v1/agents/anomalies/:id/resolve',
      async (request, reply) => {
        if (!this.orchestrator) {
          reply.status(503).send({ error: 'Agentic features not available' });
          return;
          return;
        }

        try {
          const { id } = request.params;
          const { resolution, notes, resolvedBy } = request.body;

          if (!resolution) {
            reply.status(400).send({ error: 'resolution is required (resolved or false_positive)' });
          return;
            return;
          }

          await this.orchestrator.resolveAnomaly(id, resolution, notes);

          return {
            message: 'Anomaly resolved',
            anomalyId: id,
            resolution,
            resolvedBy,
            resolvedAt: new Date().toISOString(),
          };
        } catch (error) {
          this.logger.error('Resolve anomaly failed', error);
          reply.status(500).send({
            error: error instanceof Error ? error.message : 'Failed to resolve anomaly',
          });
        }
      },
    );

    /**
     * GET /v1/agents/enforcements - List all pending enforcement actions
     * Includes rate limits, blocks, and queued actions
     */
    this.server.get<{ Querystring: { status?: string } }>(
      '/v1/agents/enforcements',
      async (request, reply) => {
        if (!this.orchestrator) {
          reply.status(503).send({ error: 'Agentic features not available' });
          return;
          return;
        }

        try {
          const { status } = request.query;
          let actions = this.orchestrator.getPendingActions();

          // Filter by status if provided
          if (status) {
            actions = actions.filter((a: EnforcerAction) => a.status === status);
          }

          return {
            count: actions.length,
            filters: { status },
            enforcements: actions.map((a: EnforcerAction) => ({
              id: a.id,
              type: a.type,
              priority: a.priority,
              status: a.status,
              triggeredAt: a.triggeredAt,
              triggeredBy: a.triggeredBy,
              canRollback: a.canRollback,
              executedAt: a.executedAt,
              result: a.result,
            })),
          };
        } catch (error) {
          this.logger.error('Get enforcements failed', error);
          reply.status(500).send({
            error: error instanceof Error ? error.message : 'Failed to get enforcements',
          });
        }
      },
    );

    /**
     * POST /v1/agents/enforcements/:id/approve - Approve a pending enforcement action
     */
    this.server.post<{ Params: { id: string }; Body: ApproveActionRequestBody }>(
      '/v1/agents/enforcements/:id/approve',
      async (request, reply) => {
        if (!this.orchestrator) {
          reply.status(503).send({ error: 'Agentic features not available' });
          return;
          return;
        }

        try {
          const { id } = request.params;
          const { approvedBy } = request.body;

          if (!approvedBy) {
            reply.status(400).send({ error: 'approvedBy is required' });
          return;
            return;
          }

          const action = await this.orchestrator.approveAction(id, approvedBy);
          if (!action) {
            reply.status(404).send({ error: 'Enforcement action not found or already processed' });
          return;
            return;
          }

          return {
            message: 'Enforcement action approved and executed',
            enforcement: {
              id: action.id,
              type: action.type,
              status: action.status,
              executedAt: action.executedAt,
              result: action.result,
              approvedBy,
            },
          };
        } catch (error) {
          this.logger.error('Approve enforcement failed', error);
          reply.status(500).send({
            error: error instanceof Error ? error.message : 'Failed to approve enforcement',
          });
        }
      },
    );

    /**
     * POST /v1/agents/enforcements/:id/reject - Reject a pending enforcement action
     */
    this.server.post<{ Params: { id: string }; Body: RejectActionRequestBody }>(
      '/v1/agents/enforcements/:id/reject',
      async (request, reply) => {
        if (!this.orchestrator) {
          reply.status(503).send({ error: 'Agentic features not available' });
          return;
          return;
        }

        try {
          const { id } = request.params;
          const { rejectedBy, reason } = request.body;

          if (!rejectedBy) {
            reply.status(400).send({ error: 'rejectedBy is required' });
          return;
            return;
          }

          const success = this.orchestrator.rejectAction(id, rejectedBy, reason);
          if (!success) {
            reply.status(404).send({ error: 'Enforcement action not found or already processed' });
          return;
            return;
          }

          return {
            message: 'Enforcement action rejected',
            enforcementId: id,
            rejectedBy,
            reason,
            rejectedAt: new Date().toISOString(),
          };
        } catch (error) {
          this.logger.error('Reject enforcement failed', error);
          reply.status(500).send({
            error: error instanceof Error ? error.message : 'Failed to reject enforcement',
          });
        }
      },
    );

    /**
     * POST /v1/agents/explain - Get LLM-powered explanation for a decision
     * Provides natural language explanation of why an authorization decision was made
     */
    this.server.post<{ Body: ExplainDecisionRequestBody }>(
      '/v1/agents/explain',
      async (request, reply) => {
        if (!this.orchestrator) {
          reply.status(503).send({ error: 'Agentic features not available' });
          return;
          return;
        }

        try {
          const { principal, resource, actions, decision, policyContext } = request.body;

          if (!principal || !resource || !actions) {
            reply.status(400).send({ error: 'principal, resource, and actions are required' });
          return;
            return;
          }

          const checkRequest = this.transformRequest({
            principal,
            resource,
            actions,
          });

          // If no decision provided, run the check first
          let response = decision;
          if (!response) {
            response = this.engine.check(checkRequest);
          }

          const explanation = await this.orchestrator.explainDecision(
            checkRequest,
            response,
            policyContext,
          );

          return {
            requestId: response.requestId,
            explanation: {
              summary: explanation.summary,
              factors: explanation.factors,
              naturalLanguage: explanation.naturalLanguage,
              recommendations: explanation.recommendations,
              pathToAllow: explanation.pathToAllow,
              generatedAt: explanation.generatedAt,
            },
          };
        } catch (error) {
          this.logger.error('Explain decision failed', error);
          reply.status(500).send({
            error: error instanceof Error ? error.message : 'Failed to generate explanation',
          });
        }
      },
    );

    // POST /v1/agents/ask - Ask natural language policy question
    this.server.post<{ Body: AskQuestionRequestBody }>(
      '/v1/agents/ask',
      async (request, reply) => {
        if (!this.orchestrator) {
          reply.status(503).send({ error: 'Agentic features not available' });
          return;
          return;
        }

        try {
          const { question } = request.body;

          if (!question) {
            reply.status(400).send({ error: 'question is required' });
          return;
            return;
          }

          const answer = await this.orchestrator.askQuestion(question);
          return {
            question,
            answer,
            generatedAt: new Date().toISOString(),
          };
        } catch (error) {
          this.logger.error('Ask question failed', error);
          reply.status(500).send({
            error: error instanceof Error ? error.message : 'Failed to process question',
          });
        }
      },
    );

    // POST /v1/agents/debug - Debug a policy
    this.server.post<{ Body: DebugPolicyRequestBody }>(
      '/v1/agents/debug',
      async (request, reply) => {
        if (!this.orchestrator) {
          reply.status(503).send({ error: 'Agentic features not available' });
          return;
          return;
        }

        try {
          const { issue, policyYaml } = request.body;

          if (!issue || !policyYaml) {
            reply.status(400).send({ error: 'issue and policyYaml are required' });
          return;
            return;
          }

          const analysis = await this.orchestrator.debugPolicy(issue, policyYaml);
          return {
            issue,
            analysis,
            generatedAt: new Date().toISOString(),
          };
        } catch (error) {
          this.logger.error('Debug policy failed', error);
          reply.status(500).send({
            error: error instanceof Error ? error.message : 'Failed to debug policy',
          });
        }
      },
    );

    // POST /v1/agents/enforce - Trigger enforcement action manually
    this.server.post<{ Body: TriggerEnforcementRequestBody }>(
      '/v1/agents/enforce',
      async (request, reply) => {
        if (!this.orchestrator) {
          reply.status(503).send({ error: 'Agentic features not available' });
          return;
          return;
        }

        try {
          const { actionType, principalId, reason } = request.body;

          if (!actionType || !principalId || !reason) {
            reply.status(400).send({
              error: 'actionType, principalId, and reason are required',
            });
            return;
          }

          const action = await this.orchestrator.triggerEnforcement(
            actionType,
            principalId,
            reason,
          );
          return {
            message: 'Enforcement action triggered',
            action: {
              id: action.id,
              type: action.type,
              priority: action.priority,
              status: action.status,
              triggeredAt: action.triggeredAt,
            },
          };
        } catch (error) {
          this.logger.error('Trigger enforcement failed', error);
          reply.status(500).send({
            error: error instanceof Error ? error.message : 'Failed to trigger enforcement',
          });
        }
      },
    );

    this.logger.info('Agentic routes registered');
  }
}

// Request body types
interface CheckRequestBody {
  requestId?: string;
  principal: {
    id: string;
    roles?: string[];
    attr?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
  };
  resource: {
    kind: string;
    id: string;
    attr?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
  };
  actions: string[];
  auxData?: Record<string, unknown>;
}

interface BatchCheckRequestBody {
  requestId?: string;
  principal: {
    id: string;
    roles?: string[];
    attr?: Record<string, unknown>;
  };
  resources: Array<{
    resource: {
      kind: string;
      id: string;
      attr?: Record<string, unknown>;
    };
    actions: string[];
  }>;
}

interface PlaygroundRequestBody {
  principal: {
    id: string;
    roles?: string[];
    attr?: Record<string, unknown>;
  };
  resource: {
    kind: string;
    id: string;
    attr?: Record<string, unknown>;
  };
  actions: string[];
}

// Agentic request body types
interface AgenticCheckRequestBody extends CheckRequestBody {
  includeExplanation?: boolean;
}

interface ApproveActionRequestBody {
  approvedBy: string;
}

interface AskQuestionRequestBody {
  question: string;
}

interface DebugPolicyRequestBody {
  issue: string;
  policyYaml: string;
}

interface TriggerEnforcementRequestBody {
  actionType:
    | 'rate_limit'
    | 'temporary_block'
    | 'require_mfa'
    | 'alert_admin'
    | 'revoke_session'
    | 'quarantine_resource'
    | 'escalate_review';
  principalId: string;
  reason: string;
}

interface ResolveAnomalyRequestBody {
  resolution: 'resolved' | 'false_positive';
  notes?: string;
  resolvedBy?: string;
}

interface ValidatePatternRequestBody {
  approved: boolean;
  validatedBy: string;
}

interface RejectActionRequestBody {
  rejectedBy: string;
  reason?: string;
}

interface ExplainDecisionRequestBody {
  principal: {
    id: string;
    roles?: string[];
    attr?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
  };
  resource: {
    kind: string;
    id: string;
    attr?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
  };
  actions: string[];
  decision?: {
    requestId: string;
    results: Record<string, ActionResult>;
    meta?: CheckResponse['meta'];
  };
  policyContext?: {
    matchedRules: string[];
    derivedRoles: string[];
  };
}
