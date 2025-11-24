import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { DecisionEngine } from '@authz-engine/core';
import type { CheckRequest, CheckResponse, Principal, Resource } from '@authz-engine/core';
import { Logger } from '../utils/logger';
import type { AgentOrchestrator } from '@authz-engine/agents';
import type {
  LearnedPattern,
  Anomaly,
  EnforcerAction,
  AgentHealth,
} from '@authz-engine/agents';

const PROTO_PATH = path.join(__dirname, '../proto/authz.proto');

/**
 * gRPC Server for AuthZ Engine
 * Extended with agentic authorization handlers.
 */
export class GrpcServer {
  private static readonly MILLISECONDS_PER_SECOND = 1000;

  private server: grpc.Server;
  private engine: DecisionEngine;
  private logger: Logger;
  private startTime: number;
  private orchestrator?: AgentOrchestrator;

  constructor(engine: DecisionEngine, logger: Logger, orchestrator?: AgentOrchestrator) {
    this.engine = engine;
    this.logger = logger;
    this.orchestrator = orchestrator;
    this.server = new grpc.Server();
    this.startTime = Date.now();
  }

  /**
   * Initialize and start the gRPC server
   */
  async start(port: number = 3593): Promise<void> {
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as grpc.GrpcObject;
    const authzService = (protoDescriptor.authz as grpc.GrpcObject).v1 as grpc.GrpcObject;
    const service = (authzService.AuthzService as grpc.ServiceClientConstructor).service;

    // Build service handlers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers: Record<string, any> = {
      check: this.handleCheck.bind(this),
      batchCheck: this.handleBatchCheck.bind(this),
      planResources: this.handlePlanResources.bind(this),
      healthCheck: this.handleHealthCheck.bind(this),
    };

    // Add agentic handlers if orchestrator is available
    if (this.orchestrator) {
      handlers.agenticCheck = this.handleAgenticCheck.bind(this);
      handlers.streamExplanation = this.handleStreamExplanation.bind(this);
      handlers.agentHealthCheck = this.handleAgentHealthCheck.bind(this);
      handlers.getPatterns = this.handleGetPatterns.bind(this);
      handlers.discoverPatterns = this.handleDiscoverPatterns.bind(this);
      handlers.getAnomalies = this.handleGetAnomalies.bind(this);
      handlers.getPendingActions = this.handleGetPendingActions.bind(this);
      handlers.approveAction = this.handleApproveAction.bind(this);
      handlers.askQuestion = this.handleAskQuestion.bind(this);
      this.logger.info('Agentic gRPC handlers registered');
    }

    this.server.addService(service, handlers);

    return new Promise((resolve, reject) => {
      this.server.bindAsync(
        `0.0.0.0:${port}`,
        grpc.ServerCredentials.createInsecure(),
        (error, boundPort) => {
          if (error) {
            reject(error);
            return;
          }
          this.logger.info(`gRPC server listening on port ${boundPort}`);
          resolve();
        },
      );
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.tryShutdown(() => {
        this.logger.info('gRPC server stopped');
        resolve();
      });
    });
  }

  /**
   * Handle Check RPC
   */
  private handleCheck(
    call: grpc.ServerUnaryCall<unknown, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ): void {
    try {
      const request = this.transformCheckRequest(call.request as Record<string, unknown>);
      const response = this.engine.check(request);
      const grpcResponse = this.transformCheckResponse(response);
      callback(null, grpcResponse);
    } catch (error) {
      this.logger.error('Check failed', error);
      callback({
        code: grpc.status.INTERNAL,
        message: error instanceof Error ? error.message : 'Internal error',
      });
    }
  }

  /**
   * Handle BatchCheck RPC
   */
  private handleBatchCheck(
    call: grpc.ServerUnaryCall<unknown, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ): void {
    try {
      const req = call.request as Record<string, unknown>;
      const principal = this.transformPrincipal(req.principal);
      const results: Array<{ resourceKey: string; results: Record<string, unknown> }> = [];

      for (const resourceCheck of req.resources as Array<{ resource: unknown; actions: string[] }>) {
        const resource = this.transformResource(resourceCheck.resource);
        const checkRequest: CheckRequest = {
          requestId: req.requestId as string | undefined,
          principal,
          resource,
          actions: resourceCheck.actions,
        };
        const response = this.engine.check(checkRequest);
        results.push({
          resourceKey: `${resource.kind}:${resource.id}`,
          results: this.transformActionResults(response.results),
        });
      }

      callback(null, {
        requestId: req.requestId || `batch-${Date.now()}`,
        results,
      });
    } catch (error) {
      this.logger.error('BatchCheck failed', error);
      callback({
        code: grpc.status.INTERNAL,
        message: error instanceof Error ? error.message : 'Internal error',
      });
    }
  }

  /**
   * Handle PlanResources RPC
   */
  private handlePlanResources(
    call: grpc.ServerUnaryCall<unknown, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ): void {
    // PlanResources is a more advanced feature - return conditional for now
    const req = call.request as Record<string, unknown>;
    callback(null, {
      requestId: req.requestId || `plan-${Date.now()}`,
      filterKind: 'FILTER_KIND_CONDITIONAL',
      condition: 'true', // Placeholder - would need policy analysis
    });
  }

  /**
   * Handle HealthCheck RPC
   */
  private handleHealthCheck(
    _call: grpc.ServerUnaryCall<unknown, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ): void {
    const stats = this.engine.getStats();
    callback(null, {
      status: 'serving',
      version: '0.1.0',
      policiesLoaded: stats.resourcePolicies + stats.derivedRolesPolicies,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / GrpcServer.MILLISECONDS_PER_SECOND),
    });
  }

  /**
   * Transform gRPC request to engine request
   */
  private transformCheckRequest(grpcRequest: Record<string, unknown>): CheckRequest {
    return {
      requestId: grpcRequest.requestId as string | undefined,
      principal: this.transformPrincipal(grpcRequest.principal),
      resource: this.transformResource(grpcRequest.resource),
      actions: grpcRequest.actions as string[],
      auxData: this.transformAttributes(grpcRequest.auxData as Record<string, unknown> | undefined),
    };
  }

  /**
   * Transform gRPC Principal
   */
  private transformPrincipal(grpcPrincipal: unknown): Principal {
    const p = grpcPrincipal as Record<string, unknown>;
    return {
      id: p.id as string,
      roles: (p.roles as string[]) || [],
      attributes: this.transformAttributes(p.attributes as Record<string, unknown> | undefined),
    };
  }

  /**
   * Transform gRPC Resource
   */
  private transformResource(grpcResource: unknown): Resource {
    const r = grpcResource as Record<string, unknown>;
    return {
      kind: r.kind as string,
      id: r.id as string,
      attributes: this.transformAttributes(r.attributes as Record<string, unknown> | undefined),
    };
  }

  /**
   * Transform gRPC Value map to Record
   */
  private transformAttributes(attrs: Record<string, any> | undefined): Record<string, unknown> {
    if (!attrs) return {};

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(attrs)) {
      result[key] = this.transformValue(value);
    }
    return result;
  }

  /**
   * Transform a single gRPC Value
   */
  private transformValue(value: unknown): unknown {
    if (!value) return null;
    const v = value as Record<string, unknown>;
    if (v.stringValue !== undefined) return v.stringValue;
    if (v.intValue !== undefined) return parseInt(v.intValue as string, 10);
    if (v.doubleValue !== undefined) return v.doubleValue;
    if (v.boolValue !== undefined) return v.boolValue;
    const listValue = v.listValue as Record<string, unknown> | undefined;
    if (listValue?.values) {
      return (listValue.values as unknown[]).map((item: unknown) => this.transformValue(item));
    }
    return null;
  }

  /**
   * Transform engine response to gRPC response
   */
  private transformCheckResponse(response: CheckResponse): Record<string, unknown> {
    return {
      requestId: response.requestId,
      results: this.transformActionResults(response.results),
      meta: {
        evaluationDurationMs: response.meta?.evaluationDurationMs || 0,
        policiesEvaluated: response.meta?.policiesEvaluated || [],
      },
    };
  }

  /**
   * Transform action results map
   */
  private transformActionResults(results: Record<string, unknown>): Record<string, unknown> {
    const transformed: Record<string, unknown> = {};
    for (const [action, result] of Object.entries(results) as [string, Record<string, unknown>][]) {
      const meta = result.meta as Record<string, unknown> | undefined;
      transformed[action] = {
        effect: result.effect === 'allow' ? 'EFFECT_ALLOW' : 'EFFECT_DENY',
        policy: result.policy,
        meta: {
          matchedRule: meta?.matchedRule || '',
          effectiveDerivedRoles: meta?.effectiveDerivedRoles || [],
        },
      };
    }
    return transformed;
  }

  // === Agentic Handler Methods ===

  /**
   * Handle AgenticCheck RPC
   */
  private async handleAgenticCheck(
    call: grpc.ServerUnaryCall<unknown, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ): Promise<void> {
    if (!this.orchestrator) {
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Agentic features not available',
      });
      return;
    }

    try {
      const req = call.request as Record<string, unknown>;
      const checkRequest = this.transformCheckRequest(req);

      // Run standard check
      const response = this.engine.check(checkRequest);

      // Process through agent pipeline
      const agenticResult = await this.orchestrator.processRequest(
        checkRequest,
        response,
        {
          includeExplanation: (req.includeExplanation as boolean | undefined) ?? true,
          policyContext: {
            matchedRules: response.meta?.policiesEvaluated || [],
            derivedRoles: [],
          },
        },
      );

      callback(null, {
        requestId: response.requestId,
        results: this.transformActionResults(response.results),
        meta: {
          evaluationDurationMs: response.meta?.evaluationDurationMs || 0,
          policiesEvaluated: response.meta?.policiesEvaluated || [],
        },
        agentic: {
          anomalyScore: agenticResult.anomalyScore,
          anomaly: agenticResult.anomaly
            ? this.transformAnomaly(agenticResult.anomaly)
            : null,
          explanation: agenticResult.explanation
            ? this.transformExplanation(agenticResult.explanation as unknown as Record<string, unknown>)
            : null,
          enforcement: {
            allowed: agenticResult.enforcement?.allowed ?? true,
            reason: agenticResult.enforcement?.reason || '',
            action: agenticResult.enforcement?.action
              ? this.transformEnforcerAction(agenticResult.enforcement.action)
              : null,
          },
          processingTimeMs: agenticResult.processingTimeMs,
          agentsInvolved: agenticResult.agentsInvolved,
        },
      });
    } catch (error) {
      this.logger.error('AgenticCheck failed', error);
      callback({
        code: grpc.status.INTERNAL,
        message: error instanceof Error ? error.message : 'Internal error',
      });
    }
  }

  /**
   * Handle StreamExplanation RPC (server streaming)
   */
  private async handleStreamExplanation(
    call: grpc.ServerWritableStream<unknown, unknown>,
  ): Promise<void> {
    if (!this.orchestrator) {
      call.emit('error', {
        code: grpc.status.UNAVAILABLE,
        message: 'Agentic features not available',
      });
      return;
    }

    try {
      const req = call.request as Record<string, unknown>;
      const checkRequest = this.transformCheckRequest(req);

      // Run standard check
      const response = this.engine.check(checkRequest);

      // Get explanation
      const agenticResult = await this.orchestrator.processRequest(
        checkRequest,
        response,
        { includeExplanation: true },
      );

      const explanation = agenticResult.explanation;
      if (!explanation) {
        call.write({
          requestId: response.requestId,
          chunkType: 'error',
          content: 'No explanation available',
          isFinal: true,
        });
        call.end();
        return;
      }

      // Stream summary
      call.write({
        requestId: response.requestId,
        chunkType: 'summary',
        content: explanation.summary,
        isFinal: false,
      });

      // Stream factors
      for (const factor of explanation.factors) {
        call.write({
          requestId: response.requestId,
          chunkType: 'factor',
          content: JSON.stringify(factor),
          isFinal: false,
        });
      }

      // Stream natural language explanation
      if (explanation.naturalLanguage) {
        call.write({
          requestId: response.requestId,
          chunkType: 'natural_language',
          content: explanation.naturalLanguage,
          isFinal: false,
        });
      }

      // Stream recommendations
      if (explanation.recommendations) {
        for (const rec of explanation.recommendations) {
          call.write({
            requestId: response.requestId,
            chunkType: 'recommendation',
            content: rec,
            isFinal: false,
          });
        }
      }

      // Final chunk
      call.write({
        requestId: response.requestId,
        chunkType: 'complete',
        content: '',
        isFinal: true,
      });

      call.end();
    } catch (error) {
      this.logger.error('StreamExplanation failed', error);
      call.emit('error', {
        code: grpc.status.INTERNAL,
        message: error instanceof Error ? error.message : 'Internal error',
      });
    }
  }

  /**
   * Handle AgentHealthCheck RPC
   */
  private async handleAgentHealthCheck(
    _call: grpc.ServerUnaryCall<unknown, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ): Promise<void> {
    if (!this.orchestrator) {
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Agentic features not available',
      });
      return;
    }

    try {
      const health = await this.orchestrator.getHealth();
      const agents: Record<string, unknown> = {};

      for (const [name, agentHealth] of Object.entries(health.agents)) {
        agents[name] = this.transformAgentHealth(agentHealth);
      }

      callback(null, {
        status: health.status,
        agents,
        infrastructure: {
          store: health.infrastructure.store,
          eventBus: health.infrastructure.eventBus,
        },
        uptimeSeconds: Math.floor((Date.now() - this.startTime) / GrpcServer.MILLISECONDS_PER_SECOND),
      });
    } catch (error) {
      this.logger.error('AgentHealthCheck failed', error);
      callback({
        code: grpc.status.INTERNAL,
        message: error instanceof Error ? error.message : 'Internal error',
      });
    }
  }

  /**
   * Handle GetPatterns RPC
   */
  private handleGetPatterns(
    _call: grpc.ServerUnaryCall<unknown, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ): void {
    if (!this.orchestrator) {
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Agentic features not available',
      });
      return;
    }

    try {
      const patterns = this.orchestrator.getPatterns();
      callback(null, {
        count: patterns.length,
        patterns: patterns.map((p: LearnedPattern) => this.transformPattern(p)),
      });
    } catch (error) {
      this.logger.error('GetPatterns failed', error);
      callback({
        code: grpc.status.INTERNAL,
        message: error instanceof Error ? error.message : 'Internal error',
      });
    }
  }

  /**
   * Handle DiscoverPatterns RPC
   */
  private async handleDiscoverPatterns(
    _call: grpc.ServerUnaryCall<unknown, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ): Promise<void> {
    if (!this.orchestrator) {
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Agentic features not available',
      });
      return;
    }

    try {
      const patterns = await this.orchestrator.discoverPatterns();
      callback(null, {
        message: 'Pattern discovery completed',
        discovered: patterns.length,
        patterns: patterns.map((p: LearnedPattern) => this.transformPattern(p)),
      });
    } catch (error) {
      this.logger.error('DiscoverPatterns failed', error);
      callback({
        code: grpc.status.INTERNAL,
        message: error instanceof Error ? error.message : 'Internal error',
      });
    }
  }

  /**
   * Handle GetAnomalies RPC
   */
  private handleGetAnomalies(
    call: grpc.ServerUnaryCall<unknown, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ): void {
    if (!this.orchestrator) {
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Agentic features not available',
      });
      return;
    }

    try {
      const { principalId } = call.request as Record<string, unknown>;
      const anomalies = this.orchestrator.getAnomalies(principalId as string);
      callback(null, {
        principalId,
        count: anomalies.length,
        anomalies: anomalies.map((a: Anomaly) => this.transformAnomaly(a)),
      });
    } catch (error) {
      this.logger.error('GetAnomalies failed', error);
      callback({
        code: grpc.status.INTERNAL,
        message: error instanceof Error ? error.message : 'Internal error',
      });
    }
  }

  /**
   * Handle GetPendingActions RPC
   */
  private handleGetPendingActions(
    _call: grpc.ServerUnaryCall<unknown, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ): void {
    if (!this.orchestrator) {
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Agentic features not available',
      });
      return;
    }

    try {
      const actions = this.orchestrator.getPendingActions();
      callback(null, {
        count: actions.length,
        actions: actions.map((a: EnforcerAction) => this.transformEnforcerAction(a)),
      });
    } catch (error) {
      this.logger.error('GetPendingActions failed', error);
      callback({
        code: grpc.status.INTERNAL,
        message: error instanceof Error ? error.message : 'Internal error',
      });
    }
  }

  /**
   * Handle ApproveAction RPC
   */
  private async handleApproveAction(
    call: grpc.ServerUnaryCall<unknown, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ): Promise<void> {
    if (!this.orchestrator) {
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Agentic features not available',
      });
      return;
    }

    try {
      const { actionId, approvedBy } = call.request as Record<string, unknown>;

      if (!approvedBy) {
        callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'approvedBy is required',
        });
        return;
      }

      const action = await this.orchestrator.approveAction(actionId as string, approvedBy as string);
      if (!action) {
        callback({
          code: grpc.status.NOT_FOUND,
          message: 'Action not found or already processed',
        });
        return;
      }

      callback(null, {
        message: 'Action approved',
        action: this.transformEnforcerAction(action),
      });
    } catch (error) {
      this.logger.error('ApproveAction failed', error);
      callback({
        code: grpc.status.INTERNAL,
        message: error instanceof Error ? error.message : 'Internal error',
      });
    }
  }

  /**
   * Handle AskQuestion RPC
   */
  private async handleAskQuestion(
    call: grpc.ServerUnaryCall<unknown, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ): Promise<void> {
    if (!this.orchestrator) {
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Agentic features not available',
      });
      return;
    }

    try {
      const { question } = call.request as Record<string, unknown>;

      if (!question) {
        callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'question is required',
        });
        return;
      }

      const answer = await this.orchestrator.askQuestion(question as string);
      callback(null, {
        question,
        answer,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error('AskQuestion failed', error);
      callback({
        code: grpc.status.INTERNAL,
        message: error instanceof Error ? error.message : 'Internal error',
      });
    }
  }

  // === Transform Helpers for Agentic Types ===

  private transformAnomaly(anomaly: Anomaly): Record<string, unknown> {
    return {
      id: anomaly.id,
      type: anomaly.type,
      severity: anomaly.severity,
      description: anomaly.description,
      score: anomaly.score,
      detectedAt: anomaly.detectedAt.toISOString(),
      status: anomaly.status,
      resourceKind: anomaly.resourceKind || '',
      action: anomaly.action || '',
    };
  }

  private transformExplanation(explanation: Record<string, unknown>): Record<string, unknown> {
    interface Factor { type: string; description: string; impact: string }
    interface Attribute { key: string; expectedValue: unknown }
    interface PathToAllow {
      missingRoles?: string[];
      missingAttributes?: Attribute[];
      requiredConditions?: string[];
      suggestedActions?: string[];
    }

    const factors = explanation.factors as Factor[];
    const pathToAllow = explanation.pathToAllow as PathToAllow | undefined;

    return {
      requestId: explanation.requestId,
      summary: explanation.summary,
      factors: factors.map((f: Factor) => ({
        type: f.type,
        description: f.description,
        impact: f.impact,
      })),
      naturalLanguage: explanation.naturalLanguage || '',
      recommendations: explanation.recommendations || [],
      pathToAllow: pathToAllow
        ? {
            missingRoles: pathToAllow.missingRoles || [],
            missingAttributes: (pathToAllow.missingAttributes || []).map((a: Attribute) => ({
              key: a.key,
              expectedValue: String(a.expectedValue),
            })),
            requiredConditions: pathToAllow.requiredConditions || [],
            suggestedActions: pathToAllow.suggestedActions || [],
          }
        : null,
    };
  }

  private transformEnforcerAction(action: EnforcerAction): Record<string, unknown> {
    return {
      id: action.id,
      type: action.type,
      priority: action.priority,
      status: action.status,
      triggeredAt: action.triggeredAt.toISOString(),
      triggeredBy: {
        agentType: action.triggeredBy.agentType,
        reason: action.triggeredBy.reason,
        relatedIds: action.triggeredBy.relatedIds,
      },
      canRollback: action.canRollback,
      executedAt: action.executedAt?.toISOString() || '',
      actionResult: action.result
        ? {
            success: action.result.success,
            message: action.result.message,
            affectedEntities: action.result.affectedEntities,
          }
        : null,
    };
  }

  private transformPattern(pattern: LearnedPattern): Record<string, unknown> {
    return {
      id: pattern.id,
      type: pattern.type,
      description: pattern.description,
      confidence: pattern.confidence,
      sampleSize: pattern.sampleSize,
      discoveredAt: pattern.discoveredAt.toISOString(),
      lastUpdated: pattern.lastUpdated.toISOString(),
      isApproved: pattern.isApproved,
      suggestedPolicyRule: pattern.suggestedPolicyRule || '',
    };
  }

  private transformAgentHealth(health: AgentHealth): Record<string, unknown> {
    return {
      agentId: health.agentId,
      agentType: health.agentType,
      state: health.state,
      lastActivity: health.lastActivity.toISOString(),
      metrics: {
        processedCount: health.metrics.processedCount,
        errorCount: health.metrics.errorCount,
        avgProcessingTimeMs: health.metrics.avgProcessingTimeMs,
        lastProcessedAt: health.metrics.lastProcessedAt?.toISOString() || '',
      },
      errors: health.errors || [],
    };
  }
}
