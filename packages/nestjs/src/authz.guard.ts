import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  HttpException,
  HttpStatus,
  Logger,
  Inject,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Principal, Resource } from '@authz-engine/sdk';
import { AuthzService, AgenticCheckOptions as ServiceAgenticCheckOptions } from './authz.service';
import {
  AUTHZ_METADATA_KEY,
  AUTHZ_EXPLANATION_KEY,
  ANOMALY_PROTECTED_KEY,
  AUDIT_ACTION_KEY,
  AGENTIC_CHECK_KEY,
  REQUIRE_ANALYSIS_KEY,
  WITH_RECOMMENDATIONS_KEY,
  RATE_LIMITED_KEY,
  THREAT_PROTECTED_KEY,
  AuthzMetadata,
  AgenticAuthzMetadata,
  AnomalyProtectionOptions,
  AuditActionOptions,
  AgenticCheckOptions,
  RequireAnalysisOptions,
  WithRecommendationsOptions,
  RateLimitedOptions,
  ThreatProtectedOptions,
  AnalysisData,
  ThreatData,
  RateLimitData,
  AgenticProcessingResult,
} from './decorators';
import { AUTHZ_AGENTIC_SERVICE } from './authz.module';

/**
 * Anomaly protection metadata stored by decorator
 */
interface AnomalyProtectionMetadata extends AnomalyProtectionOptions {
  enabled: boolean;
}

/**
 * Audit action metadata stored by decorator
 */
interface AuditActionMetadata extends AuditActionOptions {
  enabled: boolean;
}

/**
 * Agentic check metadata stored by decorator
 */
interface AgenticCheckMetadata extends AgenticCheckOptions {
  enabled: boolean;
}

/**
 * Analysis metadata stored by decorator
 */
interface RequireAnalysisMetadata extends RequireAnalysisOptions {
  enabled: boolean;
}

/**
 * Recommendations metadata stored by decorator
 */
interface WithRecommendationsMetadata extends WithRecommendationsOptions {
  enabled: boolean;
}

/**
 * Rate limit metadata stored by decorator
 */
interface RateLimitedMetadata extends RateLimitedOptions {
  enabled: boolean;
}

/**
 * Threat protection metadata stored by decorator
 */
interface ThreatProtectedMetadata extends ThreatProtectedOptions {
  enabled: boolean;
}

/**
 * HTTP request with user context
 */
interface AuthenticatedRequest {
  user?: { id: string; roles?: string[]; [key: string]: unknown };
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  authzExplanation?: string;
  authzAnomalyScore?: number;
  authzFactors?: Array<{ factor: string; impact: string; weight: number }>;
  authzConfidence?: number;
  authzResult?: unknown;
  authzRateLimitInfo?: RateLimitData;
  authzThreatInfo?: ThreatData;
  authzAgenticResult?: AgenticProcessingResult;
  authzRecommendations?: string[];
  authzAnalysis?: AnalysisData;
}

/**
 * WebSocket client with user context
 */
interface WebSocketClient {
  user?: { id: string; roles?: string[]; [key: string]: unknown };
  handshake?: { user?: { id: string; roles?: string[]; [key: string]: unknown } };
}

/**
 * GraphQL context
 */
interface GqlContext {
  user?: { id: string; roles?: string[]; [key: string]: unknown };
  req?: AuthenticatedRequest;
}

/**
 * HTTP status code for precondition required
 */
const HTTP_PRECONDITION_REQUIRED = 428;

/**
 * Default max anomaly score threshold
 */
const DEFAULT_MAX_ANOMALY_SCORE = 0.8;

/**
 * Interface for the agentic service (to avoid circular import)
 */
interface IAuthzAgenticService {
  processAgenticRequest(
    principal: Principal,
    resource: Resource,
    action: string,
    options: {
      includeAnalysis?: boolean;
      includeRecommendations?: boolean;
      enableThreatDetection?: boolean;
      enableRateLimiting?: boolean;
      rateLimitConfig?: RateLimitedOptions;
      threatConfig?: ThreatProtectedOptions;
      analysisConfig?: RequireAnalysisOptions;
      recommendationsConfig?: WithRecommendationsOptions;
      context?: Record<string, unknown>;
    },
  ): Promise<{
    allowed: boolean;
    decision: 'allow' | 'deny';
    confidence: number;
    explanation?: string;
    anomalyScore?: number;
    recommendations?: string[];
    analysis?: AnalysisData;
    threatInfo?: ThreatData;
    rateLimitInfo?: RateLimitData;
    agentsInvolved: string[];
    processingTimeMs: number;
  }>;
  checkRateLimit(principalId: string, options: RateLimitedMetadata): Promise<RateLimitData>;
  checkThreat(principalId: string, resource: Resource, action: string, options: ThreatProtectedMetadata): Promise<ThreatData>;
}

/**
 * AuthZ Guard
 *
 * NestJS guard that checks authorization using the AuthZ Engine.
 * Supports both standard checks and agentic authorization features.
 */
@Injectable()
export class AuthzGuard implements CanActivate {
  private readonly logger = new Logger(AuthzGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly authzService: AuthzService,
    @Optional() @Inject(AUTHZ_AGENTIC_SERVICE) private readonly agenticService?: IAuthzAgenticService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get authorization metadata from decorator
    const metadata = this.reflector.get<AuthzMetadata | AgenticAuthzMetadata>(
      AUTHZ_METADATA_KEY,
      context.getHandler(),
    );

    // If no metadata, allow (no authorization required)
    if (!metadata) {
      return true;
    }

    // Check for agentic features (legacy decorators)
    const useExplanation = this.reflector.get<boolean>(
      AUTHZ_EXPLANATION_KEY,
      context.getHandler(),
    );

    const anomalyProtection = this.reflector.get<AnomalyProtectionMetadata>(
      ANOMALY_PROTECTED_KEY,
      context.getHandler(),
    );

    const auditAction = this.reflector.get<AuditActionMetadata>(
      AUDIT_ACTION_KEY,
      context.getHandler(),
    );

    // Check for NEW agentic pipeline decorators
    const agenticCheck = this.reflector.get<AgenticCheckMetadata>(
      AGENTIC_CHECK_KEY,
      context.getHandler(),
    );

    const requireAnalysis = this.reflector.get<RequireAnalysisMetadata>(
      REQUIRE_ANALYSIS_KEY,
      context.getHandler(),
    );

    const withRecommendations = this.reflector.get<WithRecommendationsMetadata>(
      WITH_RECOMMENDATIONS_KEY,
      context.getHandler(),
    );

    const rateLimited = this.reflector.get<RateLimitedMetadata>(
      RATE_LIMITED_KEY,
      context.getHandler(),
    );

    const threatProtected = this.reflector.get<ThreatProtectedMetadata>(
      THREAT_PROTECTED_KEY,
      context.getHandler(),
    );

    // Get request context
    const contextType = context.getType();
    let user: { id: string; roles?: string[]; [key: string]: unknown } | undefined;
    let resourceData: { id?: string; [key: string]: unknown } | undefined;
    let request: AuthenticatedRequest | undefined;

    if (contextType === 'http') {
      request = context.switchToHttp().getRequest<AuthenticatedRequest>();
      user = request.user;
      resourceData = this.extractResourceData(request, metadata);
    } else if (contextType === 'ws') {
      const client = context.switchToWs().getClient<WebSocketClient>();
      user = client.user || client.handshake?.user;
    } else if ((contextType as string) === 'graphql') {
      // GraphQL context
      const gqlContext = this.getGqlContext(context);
      user = gqlContext?.user;
      request = gqlContext?.req || (gqlContext as unknown as AuthenticatedRequest);
      resourceData = this.extractResourceFromArgs(context, metadata);
    } else {
      // Unknown context type
      return true;
    }

    // Ensure user exists
    if (!user || !user.id) {
      throw new UnauthorizedException('Authentication required');
    }

    // Build principal
    const principal = this.authzService.createPrincipal(user);

    // Build resource
    const resource = {
      kind: metadata.resource,
      id: resourceData?.id || '*',
      attributes: resourceData || {},
    };

    // Check if we need FULL agentic pipeline (new decorators)
    const needsFullAgenticPipeline = agenticCheck?.enabled ||
      (this.agenticService && (
        requireAnalysis?.enabled ||
        withRecommendations?.enabled ||
        rateLimited?.enabled ||
        threatProtected?.enabled
      ));

    if (needsFullAgenticPipeline && this.agenticService) {
      return this.processFullAgenticPipeline(
        context,
        request,
        principal,
        resource,
        metadata,
        {
          agenticCheck,
          requireAnalysis,
          withRecommendations,
          rateLimited,
          threatProtected,
        },
      );
    }

    // Determine if we need legacy agentic check
    const agenticMetadata = metadata as AgenticAuthzMetadata;
    const needsAgenticCheck = useExplanation ||
      anomalyProtection?.enabled ||
      auditAction?.enabled ||
      agenticMetadata.includeExplanation ||
      agenticMetadata.checkAnomalies ||
      agenticMetadata.auditAction;

    if (needsAgenticCheck) {
      // Use agentic authorization check (legacy path)
      const agenticOptions: ServiceAgenticCheckOptions = {
        includeExplanation: useExplanation || agenticMetadata.includeExplanation,
        checkAnomalies: anomalyProtection?.enabled || agenticMetadata.checkAnomalies,
        auditAction: auditAction?.enabled || agenticMetadata.auditAction,
        context: agenticMetadata.context,
      };

      const result = await this.authzService.checkWithAgents(
        principal,
        resource,
        metadata.action,
        agenticOptions,
      );

      // Store agentic data in request context for parameter decorators
      if (request) {
        request.authzExplanation = result.explanation;
        request.authzAnomalyScore = result.anomalyScore;
        request.authzFactors = result.factors;
        request.authzConfidence = result.confidence;
        request.authzResult = result;
      }

      // Check anomaly protection
      if (anomalyProtection?.enabled && result.anomalyScore !== undefined) {
        const maxScore = anomalyProtection.maxAnomalyScore ?? DEFAULT_MAX_ANOMALY_SCORE;

        if (result.anomalyScore > maxScore) {
          if (anomalyProtection.logHighAnomaly) {
            this.logger.warn(
              `High anomaly score detected: ${result.anomalyScore} for principal ${principal.id} ` +
              `on ${metadata.resource}:${metadata.action}`,
            );
          }

          if (anomalyProtection.onAnomaly === 'block') {
            throw new ForbiddenException(
              `Request blocked due to anomalous behavior (score: ${result.anomalyScore.toFixed(2)})`,
            );
          } else if (anomalyProtection.onAnomaly === 'warn') {
            // Just log, don't block
            this.logger.warn(
              `Anomaly warning for ${principal.id}: score ${result.anomalyScore}`,
            );
          }
        }
      }

      if (!result.allowed) {
        const message = result.explanation
          ? `Not authorized: ${result.explanation}`
          : `Not authorized to ${metadata.action} ${metadata.resource}`;
        throw new ForbiddenException(message);
      }

      return true;
    }

    // Standard authorization check (non-agentic)
    const allowed = await this.authzService.isAllowed(
      principal,
      resource,
      metadata.action,
    );

    if (!allowed) {
      throw new ForbiddenException(
        `Not authorized to ${metadata.action} ${metadata.resource}`,
      );
    }

    return true;
  }

  /**
   * Process request through the full agentic pipeline
   * Uses all 4 agents: GUARDIAN, ANALYST, ADVISOR, ENFORCER
   */
  private async processFullAgenticPipeline(
    _context: ExecutionContext,
    request: AuthenticatedRequest | undefined,
    principal: Principal,
    resource: Resource,
    metadata: AuthzMetadata,
    decoratorMetadata: {
      agenticCheck?: AgenticCheckMetadata;
      requireAnalysis?: RequireAnalysisMetadata;
      withRecommendations?: WithRecommendationsMetadata;
      rateLimited?: RateLimitedMetadata;
      threatProtected?: ThreatProtectedMetadata;
    },
  ): Promise<boolean> {
    const startTime = Date.now();
    const { agenticCheck, requireAnalysis, withRecommendations, rateLimited, threatProtected } = decoratorMetadata;

    this.logger.debug(`[AgenticPipeline] Starting for ${principal.id} -> ${metadata.resource}:${metadata.action}`);

    // 1. Check rate limiting first (ENFORCER)
    if (rateLimited?.enabled && this.agenticService) {
      const rateLimitResult = await this.agenticService.checkRateLimit(
        principal.id,
        rateLimited,
      );

      if (request) {
        request.authzRateLimitInfo = rateLimitResult;
      }

      if (rateLimitResult.isLimited) {
        const action = rateLimited.onLimitExceeded ?? 'block';

        if (action === 'block') {
          throw new HttpException(
            {
              statusCode: HttpStatus.TOO_MANY_REQUESTS,
              message: 'Rate limit exceeded',
              remaining: rateLimitResult.remaining,
              resetAt: rateLimitResult.resetAt,
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        } else if (action === 'warn') {
          this.logger.warn(
            `Rate limit warning for ${principal.id}: ${rateLimitResult.currentUsage}/${rateLimitResult.limit}`,
          );
        }
      }
    }

    // 2. Check threat protection (GUARDIAN)
    if (threatProtected?.enabled && this.agenticService) {
      const threatResult = await this.agenticService.checkThreat(
        principal.id,
        resource,
        metadata.action,
        threatProtected,
      );

      if (request) {
        request.authzThreatInfo = threatResult;
      }

      const threshold = threatProtected.anomalyThreshold ?? DEFAULT_MAX_ANOMALY_SCORE;
      if (threatResult.anomalyScore > threshold) {
        const action = threatProtected.onThreatDetected ?? 'block';

        this.logger.warn(
          `[GUARDIAN] Threat detected for ${principal.id}: score=${threatResult.anomalyScore}, ` +
          `threats=${threatResult.detectedThreats.map(t => t.type).join(', ')}`,
        );

        if (action === 'block') {
          throw new ForbiddenException({
            message: 'Request blocked due to detected threat',
            anomalyScore: threatResult.anomalyScore,
            threats: threatResult.detectedThreats,
          });
        } else if (action === 'require_mfa') {
          throw new HttpException(
            {
              statusCode: HTTP_PRECONDITION_REQUIRED,
              message: 'Additional verification required',
              requireMfa: true,
              anomalyScore: threatResult.anomalyScore,
            },
            HTTP_PRECONDITION_REQUIRED,
          );
        }
      }
    }

    // 3. Process through full agentic pipeline
    if (this.agenticService) {
      const agenticResult = await this.agenticService.processAgenticRequest(
        principal,
        resource,
        metadata.action,
        {
          includeAnalysis: agenticCheck?.includeAnalysis || requireAnalysis?.enabled,
          includeRecommendations: agenticCheck?.includeRecommendations || withRecommendations?.enabled,
          enableThreatDetection: agenticCheck?.enableThreatDetection || threatProtected?.enabled,
          enableRateLimiting: agenticCheck?.enableRateLimiting || rateLimited?.enabled,
          rateLimitConfig: rateLimited,
          threatConfig: threatProtected,
          analysisConfig: requireAnalysis,
          recommendationsConfig: withRecommendations,
          context: agenticCheck?.context,
        },
      );

      // Store full result in request context
      if (request) {
        const processingResult: AgenticProcessingResult = {
          ...agenticResult,
          processingTimeMs: Date.now() - startTime,
        };

        request.authzAgenticResult = processingResult;
        request.authzExplanation = agenticResult.explanation;
        request.authzAnomalyScore = agenticResult.anomalyScore;
        request.authzConfidence = agenticResult.confidence;
        request.authzRecommendations = agenticResult.recommendations;
        request.authzAnalysis = agenticResult.analysis;
      }

      // Check minimum confidence if analysis required
      if (requireAnalysis?.enabled && requireAnalysis.minConfidence) {
        if (agenticResult.confidence < requireAnalysis.minConfidence) {
          this.logger.warn(
            `[ANALYST] Low confidence for ${principal.id}: ${agenticResult.confidence} < ${requireAnalysis.minConfidence}`,
          );
          throw new ForbiddenException({
            message: 'Authorization decision has insufficient confidence',
            confidence: agenticResult.confidence,
            requiredConfidence: requireAnalysis.minConfidence,
          });
        }
      }

      if (!agenticResult.allowed) {
        const message = agenticResult.explanation
          ? `Not authorized: ${agenticResult.explanation}`
          : `Not authorized to ${metadata.action} ${metadata.resource}`;
        throw new ForbiddenException({
          message,
          decision: agenticResult.decision,
          confidence: agenticResult.confidence,
          recommendations: agenticResult.recommendations,
        });
      }

      this.logger.debug(
        `[AgenticPipeline] Completed in ${Date.now() - startTime}ms, ` +
        `agents: ${agenticResult.agentsInvolved.join(', ')}`,
      );

      return true;
    }

    // Fallback to standard check if agentic service not available
    const allowed = await this.authzService.isAllowed(principal, resource, metadata.action);
    if (!allowed) {
      throw new ForbiddenException(`Not authorized to ${metadata.action} ${metadata.resource}`);
    }

    return true;
  }

  /**
   * Extract resource data from HTTP request
   */
  private extractResourceData(
    request: AuthenticatedRequest,
    metadata: AuthzMetadata,
  ): { id?: string; [key: string]: unknown } {
    const { resourceIdParam = 'id', resourceFromBody } = metadata;

    // Try to get ID from params
    const id = request.params?.[resourceIdParam];

    // Get additional data from body if specified
    if (resourceFromBody && request.body) {
      return { id, ...request.body };
    }

    return { id };
  }

  /**
   * Extract resource from GraphQL arguments
   */
  private extractResourceFromArgs(
    context: ExecutionContext,
    metadata: AuthzMetadata,
  ): { id?: string; [key: string]: unknown } {
    const args = this.getGqlArgs(context);
    const { resourceIdParam = 'id' } = metadata;

    // Look for ID in args
    const id = (args?.[resourceIdParam] as string | undefined) ||
      ((args?.input as Record<string, unknown> | undefined)?.[resourceIdParam] as string | undefined);

    return { id, ...args };
  }

  /**
   * Get GraphQL context (compatible with Apollo)
   */
  private getGqlContext(context: ExecutionContext): GqlContext | undefined {
    const args = context.getArgs<unknown[]>();
    // In GraphQL, context is typically the 3rd argument
    return args[2] as GqlContext | undefined;
  }

  /**
   * Get GraphQL arguments
   */
  private getGqlArgs(context: ExecutionContext): Record<string, unknown> | undefined {
    const args = context.getArgs<unknown[]>();
    // In GraphQL, args are typically the 2nd argument
    return args[1] as Record<string, unknown> | undefined;
  }
}
