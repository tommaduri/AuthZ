import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthzService, AgenticCheckOptions } from './authz.service';
import {
  AUTHZ_METADATA_KEY,
  AUTHZ_EXPLANATION_KEY,
  ANOMALY_PROTECTED_KEY,
  AUDIT_ACTION_KEY,
  AuthzMetadata,
  AgenticAuthzMetadata,
  AnomalyProtectionOptions,
  AuditActionOptions,
} from './decorators';

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

    // Check for agentic features
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

    // Get request context
    const contextType = context.getType();
    let user: any;
    let resourceData: any;
    let request: any;

    if (contextType === 'http') {
      request = context.switchToHttp().getRequest();
      user = request.user;
      resourceData = this.extractResourceData(request, metadata);
    } else if (contextType === 'ws') {
      const client = context.switchToWs().getClient();
      user = client.user || client.handshake?.user;
    } else if ((contextType as string) === 'graphql') {
      // GraphQL context
      const gqlContext = this.getGqlContext(context);
      user = gqlContext?.user;
      request = gqlContext?.req || gqlContext;
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

    // Determine if we need agentic check
    const agenticMetadata = metadata as AgenticAuthzMetadata;
    const needsAgenticCheck = useExplanation ||
      anomalyProtection?.enabled ||
      auditAction?.enabled ||
      agenticMetadata.includeExplanation ||
      agenticMetadata.checkAnomalies ||
      agenticMetadata.auditAction;

    if (needsAgenticCheck) {
      // Use agentic authorization check
      const agenticOptions: AgenticCheckOptions = {
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
        const maxScore = anomalyProtection.maxAnomalyScore ?? 0.8;

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
   * Extract resource data from HTTP request
   */
  private extractResourceData(request: any, metadata: AuthzMetadata): any {
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
  private extractResourceFromArgs(context: ExecutionContext, metadata: AuthzMetadata): any {
    const args = this.getGqlArgs(context);
    const { resourceIdParam = 'id' } = metadata;

    // Look for ID in args
    const id = args?.[resourceIdParam] || args?.input?.[resourceIdParam];

    return { id, ...args };
  }

  /**
   * Get GraphQL context (compatible with Apollo)
   */
  private getGqlContext(context: ExecutionContext): any {
    const args = context.getArgs();
    // In GraphQL, context is typically the 3rd argument
    return args[2];
  }

  /**
   * Get GraphQL arguments
   */
  private getGqlArgs(context: ExecutionContext): any {
    const args = context.getArgs();
    // In GraphQL, args are typically the 2nd argument
    return args[1];
  }
}
