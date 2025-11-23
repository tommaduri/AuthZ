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

    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
    const authzService = protoDescriptor.authz.v1.AuthzService.service;

    // Build service handlers
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

    this.server.addService(authzService, handlers);

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
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): void {
    try {
      const request = this.transformCheckRequest(call.request);
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
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): void {
    try {
      const req = call.request;
      const principal = this.transformPrincipal(req.principal);
      const results: any[] = [];

      for (const resourceCheck of req.resources) {
        const resource = this.transformResource(resourceCheck.resource);
        const checkRequest: CheckRequest = {
          requestId: req.requestId,
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
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): void {
    // PlanResources is a more advanced feature - return conditional for now
    const req = call.request;
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
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): void {
    const stats = this.engine.getStats();
    callback(null, {
      status: 'serving',
      version: '0.1.0',
      policiesLoaded: stats.resourcePolicies + stats.derivedRolesPolicies,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
    });
  }

  /**
   * Transform gRPC request to engine request
   */
  private transformCheckRequest(grpcRequest: any): CheckRequest {
    return {
      requestId: grpcRequest.requestId,
      principal: this.transformPrincipal(grpcRequest.principal),
      resource: this.transformResource(grpcRequest.resource),
      actions: grpcRequest.actions,
      auxData: this.transformAttributes(grpcRequest.auxData),
    };
  }

  /**
   * Transform gRPC Principal
   */
  private transformPrincipal(grpcPrincipal: any): Principal {
    return {
      id: grpcPrincipal.id,
      roles: grpcPrincipal.roles || [],
      attributes: this.transformAttributes(grpcPrincipal.attributes),
    };
  }

  /**
   * Transform gRPC Resource
   */
  private transformResource(grpcResource: any): Resource {
    return {
      kind: grpcResource.kind,
      id: grpcResource.id,
      attributes: this.transformAttributes(grpcResource.attributes),
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
  private transformValue(value: any): unknown {
    if (!value) return null;
    if (value.stringValue !== undefined) return value.stringValue;
    if (value.intValue !== undefined) return parseInt(value.intValue, 10);
    if (value.doubleValue !== undefined) return value.doubleValue;
    if (value.boolValue !== undefined) return value.boolValue;
    if (value.listValue?.values) {
      return value.listValue.values.map((v: any) => this.transformValue(v));
    }
    return null;
  }

  /**
   * Transform engine response to gRPC response
   */
  private transformCheckResponse(response: CheckResponse): any {
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
  private transformActionResults(results: Record<string, any>): Record<string, any> {
    const transformed: Record<string, any> = {};
    for (const [action, result] of Object.entries(results)) {
      transformed[action] = {
        effect: result.effect === 'allow' ? 'EFFECT_ALLOW' : 'EFFECT_DENY',
        policy: result.policy,
        meta: {
          matchedRule: result.meta?.matchedRule || '',
          effectiveDerivedRoles: result.meta?.effectiveDerivedRoles || [],
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
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): Promise<void> {
    if (!this.orchestrator) {
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Agentic features not available',
      });
      return;
    }

    try {
      const req = call.request;
      const checkRequest = this.transformCheckRequest(req);

      // Run standard check
      const response = this.engine.check(checkRequest);

      // Process through agent pipeline
      const agenticResult = await this.orchestrator.processRequest(
        checkRequest,
        response,
        {
          includeExplanation: req.includeExplanation ?? true,
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
            ? this.transformExplanation(agenticResult.explanation)
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
    call: grpc.ServerWritableStream<any, any>,
  ): Promise<void> {
    if (!this.orchestrator) {
      call.emit('error', {
        code: grpc.status.UNAVAILABLE,
        message: 'Agentic features not available',
      });
      return;
    }

    try {
      const req = call.request;
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
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
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
      const agents: Record<string, any> = {};

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
        uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
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
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
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
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
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
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): void {
    if (!this.orchestrator) {
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Agentic features not available',
      });
      return;
    }

    try {
      const { principalId } = call.request;
      const anomalies = this.orchestrator.getAnomalies(principalId);
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
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
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
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): Promise<void> {
    if (!this.orchestrator) {
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Agentic features not available',
      });
      return;
    }

    try {
      const { actionId, approvedBy } = call.request;

      if (!approvedBy) {
        callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'approvedBy is required',
        });
        return;
      }

      const action = await this.orchestrator.approveAction(actionId, approvedBy);
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
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): Promise<void> {
    if (!this.orchestrator) {
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Agentic features not available',
      });
      return;
    }

    try {
      const { question } = call.request;

      if (!question) {
        callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'question is required',
        });
        return;
      }

      const answer = await this.orchestrator.askQuestion(question);
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

  private transformAnomaly(anomaly: Anomaly): any {
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

  private transformExplanation(explanation: any): any {
    return {
      requestId: explanation.requestId,
      summary: explanation.summary,
      factors: explanation.factors.map((f: any) => ({
        type: f.type,
        description: f.description,
        impact: f.impact,
      })),
      naturalLanguage: explanation.naturalLanguage || '',
      recommendations: explanation.recommendations || [],
      pathToAllow: explanation.pathToAllow
        ? {
            missingRoles: explanation.pathToAllow.missingRoles || [],
            missingAttributes: (explanation.pathToAllow.missingAttributes || []).map((a: any) => ({
              key: a.key,
              expectedValue: String(a.expectedValue),
            })),
            requiredConditions: explanation.pathToAllow.requiredConditions || [],
            suggestedActions: explanation.pathToAllow.suggestedActions || [],
          }
        : null,
    };
  }

  private transformEnforcerAction(action: EnforcerAction): any {
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

  private transformPattern(pattern: LearnedPattern): any {
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

  private transformAgentHealth(health: AgentHealth): any {
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
