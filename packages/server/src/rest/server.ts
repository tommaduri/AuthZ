import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { DecisionEngine } from '@authz-engine/core';
import type { CheckRequest, ActionResult, Principal, Resource } from '@authz-engine/core';
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
   * Generate a request ID for tracing
   */
  private generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
        uptime_seconds: Math.floor((Date.now() - this.startTime) / RestServer.MILLISECONDS_PER_SECOND),
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
      const requestId = this.generateRequestId();

      // Add request ID to response headers for tracing
      reply.header('x-request-id', requestId);

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
        const results: Record<string, unknown> = {};

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
  private transformPrincipal(p: Record<string, unknown>): Principal {
    return {
      id: p.id as string,
      roles: (p.roles as string[]) || [],
      attributes: (p.attr || p.attributes || {}) as Record<string, unknown>,
    };
  }

  /**
   * Transform REST resource
   */
  private transformResource(r: Record<string, unknown>): Resource {
    return {
      kind: r.kind as string,
      id: r.id as string,
      attributes: (r.attr || r.attributes || {}) as Record<string, unknown>,
    };
  }

  /**
   * Transform engine results to REST format
   */
  private transformResults(results: Record<string, ActionResult>): Record<string, unknown> {
    const transformed: Record<string, unknown> = {};
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
          uptime_seconds: Math.floor((Date.now() - this.startTime) / RestServer.MILLISECONDS_PER_SECOND),
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
        }

        try {
          const { id } = request.params;
          const { approved, validatedBy } = request.body;

          if (approved === undefined || !validatedBy) {
            reply.status(400).send({ error: 'approved (boolean) and validatedBy are required' });
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
        }

        try {
          const { id } = request.params;
          const anomaly = await this.orchestrator.getAnomalyById(id);

          if (!anomaly) {
            reply.status(404).send({ error: 'Anomaly not found' });
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
        }

        try {
          const { id } = request.params;
          const { resolution, notes, resolvedBy } = request.body;

          if (!resolution) {
            reply.status(400).send({ error: 'resolution is required (resolved or false_positive)' });
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
        }

        try {
          const { id } = request.params;
          const { approvedBy } = request.body;

          if (!approvedBy) {
            reply.status(400).send({ error: 'approvedBy is required' });
            return;
          }

          const action = await this.orchestrator.approveAction(id, approvedBy);
          if (!action) {
            reply.status(404).send({ error: 'Enforcement action not found or already processed' });
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
        }

        try {
          const { id } = request.params;
          const { rejectedBy, reason } = request.body;

          if (!rejectedBy) {
            reply.status(400).send({ error: 'rejectedBy is required' });
            return;
          }

          const success = this.orchestrator.rejectAction(id, rejectedBy, reason);
          if (!success) {
            reply.status(404).send({ error: 'Enforcement action not found or already processed' });
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
        }

        try {
          const { principal, resource, actions, decision, policyContext } = request.body;

          if (!principal || !resource || !actions) {
            reply.status(400).send({ error: 'principal, resource, and actions are required' });
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
        }

        try {
          const { question } = request.body;

          if (!question) {
            reply.status(400).send({ error: 'question is required' });
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
        }

        try {
          const { issue, policyYaml } = request.body;

          if (!issue || !policyYaml) {
            reply.status(400).send({ error: 'issue and policyYaml are required' });
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

    // Setup new /api/v1/agentic endpoints
    this.setupAgenticV1Routes();
  }

  /**
   * Setup /api/v1/agentic endpoints
   * These provide a standardized REST API for agentic authorization features
   * with full OpenAPI documentation support
   */
  private setupAgenticV1Routes(): void {
    /**
     * POST /api/v1/agentic/check - Agentic authorization check with full agent pipeline
     * @openapi
     * /api/v1/agentic/check:
     *   post:
     *     summary: Perform agentic authorization check
     *     description: Runs authorization through full agent pipeline including GUARDIAN anomaly detection, ANALYST pattern matching, ADVISOR explanations, and ENFORCER rate limiting
     *     tags: [Agentic]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/AgenticCheckRequest'
     *     responses:
     *       200:
     *         description: Authorization check result with agent insights
     *       400:
     *         description: Invalid request
     *       503:
     *         description: Agentic features not available
     */
    this.server.post<{ Body: AgenticCheckRequestBodyV1 }>(
      '/api/v1/agentic/check',
      async (request, reply) => {
        if (!this.orchestrator) {
          reply.status(503).send({
            error: 'Agentic features not available',
            code: 'AGENTIC_UNAVAILABLE',
          });
          return;
        }

        try {
          const body = request.body;

          // Validate required fields
          if (!body.principal?.id || !body.resource?.kind || !body.actions?.length) {
            reply.status(400).send({
              error: 'Missing required fields: principal.id, resource.kind, and actions are required',
              code: 'VALIDATION_ERROR',
            });
            return;
          }

          const checkRequest = this.transformRequest(body);
          const response = this.engine.check(checkRequest);

          const agenticResult = await this.orchestrator.processRequest(
            checkRequest,
            response,
            {
              includeExplanation: body.includeExplanation ?? true,
              policyContext: {
                matchedRules: response.meta?.policiesEvaluated || [],
                derivedRoles: body.derivedRolesContext || [],
              },
            },
          );

          return {
            requestId: response.requestId,
            timestamp: new Date().toISOString(),
            decision: {
              results: this.transformResults(response.results),
              meta: {
                evaluationDurationMs: response.meta?.evaluationDurationMs,
                policiesEvaluated: response.meta?.policiesEvaluated,
              },
            },
            agentInsights: {
              anomalyDetection: {
                score: agenticResult.anomalyScore,
                anomaly: agenticResult.anomaly ? {
                  id: agenticResult.anomaly.id,
                  type: agenticResult.anomaly.type,
                  severity: agenticResult.anomaly.severity,
                  description: agenticResult.anomaly.description,
                } : null,
              },
              explanation: agenticResult.explanation ? {
                summary: agenticResult.explanation.summary,
                factors: agenticResult.explanation.factors,
                naturalLanguage: agenticResult.explanation.naturalLanguage,
                recommendations: agenticResult.explanation.recommendations,
                pathToAllow: agenticResult.explanation.pathToAllow,
              } : null,
              enforcement: agenticResult.enforcement ? {
                allowed: agenticResult.enforcement.allowed,
                reason: agenticResult.enforcement.reason,
                actionId: agenticResult.enforcement.action?.id,
              } : null,
            },
            processingMetrics: {
              totalTimeMs: agenticResult.processingTimeMs,
              agentsInvolved: agenticResult.agentsInvolved,
            },
          };
        } catch (error) {
          this.logger.error('Agentic check failed', error);
          reply.status(500).send({
            error: error instanceof Error ? error.message : 'Internal server error',
            code: 'INTERNAL_ERROR',
          });
        }
      },
    );

    /**
     * POST /api/v1/agentic/analyze - Get analysis from ANALYST agent
     * @openapi
     * /api/v1/agentic/analyze:
     *   post:
     *     summary: Get pattern analysis from ANALYST agent
     *     description: Analyzes authorization patterns and provides insights about access behaviors
     *     tags: [Agentic]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/AnalyzeRequest'
     *     responses:
     *       200:
     *         description: Analysis results with discovered patterns
     *       400:
     *         description: Invalid request
     *       503:
     *         description: Agentic features not available
     */
    this.server.post<{ Body: AnalyzeRequestBody }>(
      '/api/v1/agentic/analyze',
      async (request, reply) => {
        if (!this.orchestrator) {
          reply.status(503).send({
            error: 'Agentic features not available',
            code: 'AGENTIC_UNAVAILABLE',
          });
          return;
        }

        try {
          const { analysisType, filters, options } = request.body;

          // Validate analysis type
          const validTypes = ['patterns', 'anomalies', 'trends', 'all'];
          if (analysisType && !validTypes.includes(analysisType)) {
            reply.status(400).send({
              error: `Invalid analysisType. Must be one of: ${validTypes.join(', ')}`,
              code: 'VALIDATION_ERROR',
            });
            return;
          }

          const type = analysisType || 'all';
          const result: AnalysisResult = {
            analysisType: type,
            timestamp: new Date().toISOString(),
            patterns: [],
            anomalies: [],
            statistics: {
              totalPatterns: 0,
              totalAnomalies: 0,
              approvedPatterns: 0,
              openAnomalies: 0,
            },
          };

          // Get patterns
          if (type === 'patterns' || type === 'all') {
            let patterns = this.orchestrator.getPatterns();

            // Apply filters
            if (filters?.patternType) {
              patterns = patterns.filter((p: LearnedPattern) => p.type === filters.patternType);
            }
            if (filters?.minConfidence !== undefined) {
              patterns = patterns.filter((p: LearnedPattern) => p.confidence >= filters.minConfidence!);
            }
            if (filters?.approved !== undefined) {
              patterns = patterns.filter((p: LearnedPattern) => p.isApproved === filters.approved);
            }

            result.patterns = patterns.map((p: LearnedPattern) => ({
              id: p.id,
              type: p.type,
              description: p.description,
              confidence: p.confidence,
              sampleSize: p.sampleSize,
              discoveredAt: p.discoveredAt,
              isApproved: p.isApproved,
              suggestedPolicyRule: p.suggestedPolicyRule,
              suggestedOptimization: p.suggestedOptimization,
            }));
            result.statistics.totalPatterns = patterns.length;
            result.statistics.approvedPatterns = patterns.filter((p: LearnedPattern) => p.isApproved).length;
          }

          // Get anomalies
          if (type === 'anomalies' || type === 'all') {
            const anomalies = await this.orchestrator.getAllAnomalies({
              principalId: filters?.principalId,
              status: filters?.anomalyStatus as Anomaly['status'],
              limit: options?.limit || 100,
            });

            result.anomalies = anomalies.map((a: Anomaly) => ({
              id: a.id,
              type: a.type,
              severity: a.severity,
              description: a.description,
              score: a.score,
              detectedAt: a.detectedAt,
              status: a.status,
              principalId: a.principalId,
            }));
            result.statistics.totalAnomalies = anomalies.length;
            result.statistics.openAnomalies = anomalies.filter((a: Anomaly) => a.status === 'open').length;
          }

          // Trigger new pattern discovery if requested
          if (options?.triggerDiscovery) {
            const newPatterns = await this.orchestrator.discoverPatterns();
            result.newlyDiscovered = newPatterns.length;
          }

          return result;
        } catch (error) {
          this.logger.error('Analysis failed', error);
          reply.status(500).send({
            error: error instanceof Error ? error.message : 'Internal server error',
            code: 'INTERNAL_ERROR',
          });
        }
      },
    );

    /**
     * POST /api/v1/agentic/recommend - Get recommendations from ADVISOR agent
     * @openapi
     * /api/v1/agentic/recommend:
     *   post:
     *     summary: Get recommendations from ADVISOR agent
     *     description: Provides policy recommendations, explanations, and suggested actions based on authorization context
     *     tags: [Agentic]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/RecommendRequest'
     *     responses:
     *       200:
     *         description: Recommendations with explanations and suggested actions
     *       400:
     *         description: Invalid request
     *       503:
     *         description: Agentic features not available
     */
    this.server.post<{ Body: RecommendRequestBody }>(
      '/api/v1/agentic/recommend',
      async (request, reply) => {
        if (!this.orchestrator) {
          reply.status(503).send({
            error: 'Agentic features not available',
            code: 'AGENTIC_UNAVAILABLE',
          });
          return;
        }

        try {
          const { recommendationType, context } = request.body;
          // Note: options is available in request.body but not currently used
          // const { options } = request.body;

          // Validate recommendation type
          const validTypes = ['policy', 'access', 'debug', 'question'];
          if (!recommendationType || !validTypes.includes(recommendationType)) {
            reply.status(400).send({
              error: `recommendationType is required and must be one of: ${validTypes.join(', ')}`,
              code: 'VALIDATION_ERROR',
            });
            return;
          }

          const result: RecommendationResult = {
            recommendationType,
            timestamp: new Date().toISOString(),
            recommendations: [],
          };

          switch (recommendationType) {
            case 'policy':
              // Get policy recommendations based on patterns
              if (context?.patternIds && Array.isArray(context.patternIds)) {
                const patterns = this.orchestrator.getPatterns();
                for (const patternId of context.patternIds) {
                  const pattern = patterns.find((p: LearnedPattern) => p.id === patternId);
                  if (pattern) {
                    result.recommendations.push({
                      type: 'policy_suggestion',
                      source: `pattern:${pattern.id}`,
                      title: `Policy suggestion from ${pattern.type}`,
                      description: pattern.description,
                      suggestedAction: pattern.suggestedPolicyRule || pattern.suggestedOptimization,
                      confidence: pattern.confidence,
                      priority: pattern.confidence >= 0.9 ? 'high' : pattern.confidence >= 0.7 ? 'medium' : 'low',
                    });
                  }
                }
              }
              break;

            case 'access':
              // Get access recommendations (path to allow)
              if (!context?.principal || !context?.resource || !context?.actions) {
                reply.status(400).send({
                  error: 'For access recommendations, context must include principal, resource, and actions',
                  code: 'VALIDATION_ERROR',
                });
                return;
              }

              const checkRequest = this.transformRequest({
                principal: context.principal,
                resource: context.resource,
                actions: context.actions,
              });
              const response = this.engine.check(checkRequest);
              const explanation = await this.orchestrator.explainDecision(
                checkRequest,
                response,
                { matchedRules: response.meta?.policiesEvaluated || [], derivedRoles: [] },
              );

              result.explanation = {
                summary: explanation.summary,
                naturalLanguage: explanation.naturalLanguage,
                factors: explanation.factors,
              };

              if (explanation.pathToAllow) {
                result.recommendations.push({
                  type: 'access_path',
                  source: 'advisor',
                  title: 'Path to Allow Access',
                  description: 'Steps to grant access for this request',
                  pathToAllow: explanation.pathToAllow,
                  priority: 'medium',
                });
              }

              if (explanation.recommendations) {
                for (const rec of explanation.recommendations) {
                  result.recommendations.push({
                    type: 'general',
                    source: 'advisor',
                    title: 'Recommendation',
                    description: rec,
                    priority: 'low',
                  });
                }
              }
              break;

            case 'debug':
              // Debug policy
              if (!context?.issue || !context?.policyYaml) {
                reply.status(400).send({
                  error: 'For debug recommendations, context must include issue and policyYaml',
                  code: 'VALIDATION_ERROR',
                });
                return;
              }

              const debugAnalysis = await this.orchestrator.debugPolicy(
                context.issue,
                context.policyYaml,
              );

              result.debugAnalysis = debugAnalysis;
              result.recommendations.push({
                type: 'debug',
                source: 'advisor',
                title: 'Debug Analysis',
                description: 'Policy debugging results',
                suggestedAction: debugAnalysis,
                priority: 'high',
              });
              break;

            case 'question':
              // Answer policy question
              if (!context?.question) {
                reply.status(400).send({
                  error: 'For question recommendations, context must include question',
                  code: 'VALIDATION_ERROR',
                });
                return;
              }

              const answer = await this.orchestrator.askQuestion(context.question);
              result.answer = answer;
              result.recommendations.push({
                type: 'answer',
                source: 'advisor',
                title: 'Policy Question Answer',
                description: answer,
                priority: 'medium',
              });
              break;
          }

          return result;
        } catch (error) {
          this.logger.error('Recommendation failed', error);
          reply.status(500).send({
            error: error instanceof Error ? error.message : 'Internal server error',
            code: 'INTERNAL_ERROR',
          });
        }
      },
    );

    /**
     * GET /api/v1/agentic/health - Agent health status
     * @openapi
     * /api/v1/agentic/health:
     *   get:
     *     summary: Get agent health status
     *     description: Returns health status of all agents in the pipeline including GUARDIAN, ANALYST, ADVISOR, and ENFORCER
     *     tags: [Agentic]
     *     responses:
     *       200:
     *         description: Agent health status
     *       503:
     *         description: Agentic features not available
     */
    this.server.get('/api/v1/agentic/health', async (request, reply) => {
      if (!this.orchestrator) {
        reply.status(503).send({
          error: 'Agentic features not available',
          code: 'AGENTIC_UNAVAILABLE',
        });
        return;
      }

      try {
        const health = await this.orchestrator.getHealth();
        const uptime = Math.floor((Date.now() - this.startTime) / RestServer.MILLISECONDS_PER_SECOND);

        return {
          status: health.status,
          timestamp: new Date().toISOString(),
          uptime: {
            seconds: uptime,
            formatted: this.formatUptime(uptime),
          },
          agents: Object.entries(health.agents).map(([name, agentHealth]) => ({
            name,
            type: agentHealth.agentType,
            state: agentHealth.state,
            lastActivity: agentHealth.lastActivity,
            metrics: {
              processed: agentHealth.metrics.processedCount,
              errors: agentHealth.metrics.errorCount,
              avgLatencyMs: Math.round(agentHealth.metrics.avgProcessingTimeMs * 100) / 100,
            },
            healthy: agentHealth.state === 'ready',
          })),
          infrastructure: {
            store: health.infrastructure.store,
            eventBus: health.infrastructure.eventBus,
          },
          summary: {
            totalAgents: Object.keys(health.agents).length,
            healthyAgents: Object.values(health.agents).filter(a => a.state === 'ready').length,
            unhealthyAgents: Object.values(health.agents).filter(a => a.state === 'error').length,
          },
        };
      } catch (error) {
        this.logger.error('Health check failed', error);
        reply.status(500).send({
          error: error instanceof Error ? error.message : 'Health check failed',
          code: 'HEALTH_CHECK_ERROR',
        });
      }
    });

    /**
     * POST /api/v1/agentic/batch - Batch agentic checks
     * @openapi
     * /api/v1/agentic/batch:
     *   post:
     *     summary: Perform batch agentic authorization checks
     *     description: Process multiple authorization requests through the agent pipeline in a single call
     *     tags: [Agentic]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/BatchAgenticRequest'
     *     responses:
     *       200:
     *         description: Batch results with agent insights
     *       400:
     *         description: Invalid request
     *       503:
     *         description: Agentic features not available
     */
    this.server.post<{ Body: BatchAgenticRequestBody }>(
      '/api/v1/agentic/batch',
      async (request, reply) => {
        if (!this.orchestrator) {
          reply.status(503).send({
            error: 'Agentic features not available',
            code: 'AGENTIC_UNAVAILABLE',
          });
          return;
        }

        try {
          const { requests, options } = request.body;

          // Validate requests array
          if (!requests || !Array.isArray(requests) || requests.length === 0) {
            reply.status(400).send({
              error: 'requests array is required and must not be empty',
              code: 'VALIDATION_ERROR',
            });
            return;
          }

          // Limit batch size
          const maxBatchSize = options?.maxBatchSize || 100;
          if (requests.length > maxBatchSize) {
            reply.status(400).send({
              error: `Batch size exceeds maximum of ${maxBatchSize}`,
              code: 'BATCH_SIZE_EXCEEDED',
            });
            return;
          }

          const startTime = Date.now();
          const results: BatchAgenticResult[] = [];
          const failOnError = options?.failOnError ?? false;
          const includeExplanation = options?.includeExplanation ?? false;
          const parallel = options?.parallel ?? true;

          const processRequest = async (req: BatchAgenticRequestItem, index: number): Promise<BatchAgenticResult> => {
            try {
              // Validate individual request
              if (!req.principal?.id || !req.resource?.kind || !req.actions?.length) {
                return {
                  index,
                  requestId: req.requestId || `batch-${index}`,
                  success: false,
                  error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Missing required fields: principal.id, resource.kind, and actions',
                  },
                };
              }

              const checkRequest = this.transformRequest({
                requestId: req.requestId,
                principal: req.principal,
                resource: req.resource,
                actions: req.actions,
              });

              const response = this.engine.check(checkRequest);

              const agenticResult = await this.orchestrator!.processRequest(
                checkRequest,
                response,
                {
                  includeExplanation,
                  policyContext: {
                    matchedRules: response.meta?.policiesEvaluated || [],
                    derivedRoles: [],
                  },
                },
              );

              return {
                index,
                requestId: response.requestId,
                success: true,
                decision: this.transformResults(response.results),
                agentInsights: {
                  anomalyScore: agenticResult.anomalyScore,
                  hasAnomaly: !!agenticResult.anomaly,
                  enforced: !agenticResult.enforcement?.allowed,
                  explanation: includeExplanation ? agenticResult.explanation?.summary : undefined,
                },
              };
            } catch (error) {
              if (failOnError) {
                throw error;
              }
              return {
                index,
                requestId: req.requestId || `batch-${index}`,
                success: false,
                error: {
                  code: 'PROCESSING_ERROR',
                  message: error instanceof Error ? error.message : 'Unknown error',
                },
              };
            }
          };

          if (parallel) {
            const promises = requests.map((req, index) => processRequest(req, index));
            const batchResults = await Promise.all(promises);
            results.push(...batchResults);
          } else {
            for (let i = 0; i < requests.length; i++) {
              const result = await processRequest(requests[i], i);
              results.push(result);
            }
          }

          const processingTimeMs = Date.now() - startTime;
          const successCount = results.filter(r => r.success).length;
          const failureCount = results.filter(r => !r.success).length;

          return {
            batchId: `batch-${Date.now()}`,
            timestamp: new Date().toISOString(),
            summary: {
              total: requests.length,
              successful: successCount,
              failed: failureCount,
              processingTimeMs,
              avgTimePerRequest: Math.round(processingTimeMs / requests.length),
            },
            results: results.sort((a, b) => a.index - b.index),
          };
        } catch (error) {
          this.logger.error('Batch agentic check failed', error);
          reply.status(500).send({
            error: error instanceof Error ? error.message : 'Internal server error',
            code: 'INTERNAL_ERROR',
          });
        }
      },
    );

    this.logger.info('Agentic V1 API routes registered at /api/v1/agentic/*');
  }

  // Time constants for uptime calculation
  private static readonly SECONDS_PER_DAY = 86400;
  private static readonly SECONDS_PER_HOUR = 3600;
  private static readonly SECONDS_PER_MINUTE = 60;
  private static readonly MILLISECONDS_PER_SECOND = 1000;

  /**
   * Format uptime in human-readable format
   */
  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / RestServer.SECONDS_PER_DAY);
    const hours = Math.floor((seconds % RestServer.SECONDS_PER_DAY) / RestServer.SECONDS_PER_HOUR);
    const minutes = Math.floor((seconds % RestServer.SECONDS_PER_HOUR) / RestServer.SECONDS_PER_MINUTE);
    const secs = seconds % RestServer.SECONDS_PER_MINUTE;

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${secs}s`);

    return parts.join(' ');
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
    meta?: {
      evaluationDurationMs: number;
      policiesEvaluated: string[];
    };
  };
  policyContext?: {
    matchedRules: string[];
    derivedRoles: string[];
  };
}

// V1 Agentic API Request/Response Types

/**
 * Request body for POST /api/v1/agentic/check
 */
interface AgenticCheckRequestBodyV1 extends CheckRequestBody {
  includeExplanation?: boolean;
  derivedRolesContext?: string[];
}

/**
 * Request body for POST /api/v1/agentic/analyze
 */
interface AnalyzeRequestBody {
  analysisType?: 'patterns' | 'anomalies' | 'trends' | 'all';
  filters?: {
    patternType?: string;
    minConfidence?: number;
    approved?: boolean;
    principalId?: string;
    anomalyStatus?: string;
  };
  options?: {
    limit?: number;
    triggerDiscovery?: boolean;
  };
}

/**
 * Analysis result returned by /api/v1/agentic/analyze
 */
interface AnalysisResult {
  analysisType: string;
  timestamp: string;
  patterns: Array<{
    id: string;
    type: string;
    description: string;
    confidence: number;
    sampleSize: number;
    discoveredAt: Date;
    isApproved: boolean;
    suggestedPolicyRule?: string;
    suggestedOptimization?: string;
  }>;
  anomalies: Array<{
    id: string;
    type: string;
    severity: string;
    description: string;
    score: number;
    detectedAt: Date;
    status: string;
    principalId: string;
  }>;
  statistics: {
    totalPatterns: number;
    totalAnomalies: number;
    approvedPatterns: number;
    openAnomalies: number;
  };
  newlyDiscovered?: number;
}

/**
 * Request body for POST /api/v1/agentic/recommend
 */
interface RecommendRequestBody {
  recommendationType: 'policy' | 'access' | 'debug' | 'question';
  context?: {
    patternIds?: string[];
    principal?: {
      id: string;
      roles?: string[];
      attr?: Record<string, unknown>;
    };
    resource?: {
      kind: string;
      id: string;
      attr?: Record<string, unknown>;
    };
    actions?: string[];
    issue?: string;
    policyYaml?: string;
    question?: string;
  };
  options?: {
    includeExplanation?: boolean;
    maxRecommendations?: number;
  };
}

/**
 * Recommendation result returned by /api/v1/agentic/recommend
 */
interface RecommendationResult {
  recommendationType: string;
  timestamp: string;
  recommendations: Array<{
    type: string;
    source: string;
    title: string;
    description: string;
    suggestedAction?: string;
    pathToAllow?: {
      missingRoles?: string[];
      missingAttributes?: Array<{ key: string; expectedValue: unknown }>;
      requiredConditions?: string[];
      suggestedActions?: string[];
    };
    confidence?: number;
    priority: string;
  }>;
  explanation?: {
    summary: string;
    naturalLanguage?: string;
    factors: Array<{
      type: string;
      description: string;
      impact: string;
      details: Record<string, unknown>;
    }>;
  };
  debugAnalysis?: string;
  answer?: string;
}

/**
 * Request body for POST /api/v1/agentic/batch
 */
interface BatchAgenticRequestBody {
  requests: BatchAgenticRequestItem[];
  options?: {
    parallel?: boolean;
    failOnError?: boolean;
    includeExplanation?: boolean;
    maxBatchSize?: number;
  };
}

/**
 * Individual request item in batch
 */
interface BatchAgenticRequestItem {
  requestId?: string;
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

/**
 * Individual result in batch response
 */
interface BatchAgenticResult {
  index: number;
  requestId: string;
  success: boolean;
  decision?: Record<string, unknown>;
  agentInsights?: {
    anomalyScore: number;
    hasAnomaly: boolean;
    enforced: boolean;
    explanation?: string;
  };
  error?: {
    code: string;
    message: string;
  };
}
